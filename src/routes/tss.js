const express = require('express');
const { pool } = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const router = express.Router();

// GET all TSS stock entries
router.get('/', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT t.*, u.name as logged_by_name
      FROM tss_daily_stock t
      LEFT JOIN users u ON t.logged_by = u.id
      ORDER BY t.date DESC, t.id DESC
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST — log a new TSS daily stock entry
router.post('/', authMiddleware, requireRole('admin', 'tss_staff'), async (req, res) => {
  const {
    date,
    opening_stock,
    qty_emptied,
    qty_ready_for_dispatch,
    qty_dispatched,
    notes
  } = req.body;

  if (!date || opening_stock === undefined)
    return res.status(400).json({ error: 'date and opening_stock required' });

  const closing_stock = (parseInt(opening_stock) + parseInt(qty_emptied || 0))
                      - parseInt(qty_dispatched || 0);

  try {
    await pool.query(`
      INSERT INTO tss_daily_stock
        (date, opening_stock, qty_emptied, qty_ready_for_dispatch, qty_dispatched, closing_stock, logged_by, notes)
      VALUES (?,?,?,?,?,?,?,?)
    `, [
      date,
      parseInt(opening_stock),
      parseInt(qty_emptied || 0),
      parseInt(qty_ready_for_dispatch || 0),
      parseInt(qty_dispatched || 0),
      closing_stock,
      req.user.id,
      notes || null
    ]);
    res.json({ message: 'TSS stock entry recorded', closing_stock });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE entry — admin only
router.delete('/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM tss_daily_stock WHERE id = ?', [req.params.id]);
  res.json({ message: 'Entry deleted' });
});

module.exports = router;
