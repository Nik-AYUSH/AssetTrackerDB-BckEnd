const express = require('express');
const { pool } = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const router = express.Router();
 
 
// ════════════════════════════════════════
//  LOG 1 — YMKS → Supplier
// ════════════════════════════════════════
 
// GET all
router.get('/ymks-to-supplier', authMiddleware, async (req, res) => {
  try {
    let query = 'SELECT * FROM log_ymks_to_supplier';
    const params = [];
    if (req.user.role === 'supplier') {
      query += ' WHERE vendor = ?';
      params.push(req.user.supplier_name);
    }
    query += ' ORDER BY date DESC, id DESC';
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
 
// POST new entry
router.post('/ymks-to-supplier', authMiddleware, requireRole('admin', 'supplier'), async (req, res) => {
  const { date, vendor, set_type, quantity, vehicle, remarks } = req.body;
  if (!date || !vendor || !set_type || !quantity)
    return res.status(400).json({ error: 'date, vendor, set_type and quantity are required' });
  if (vendor === 'Sanvijay' && set_type === 'W/C Set')
    return res.status(400).json({ error: 'Sanvijay only supplies FLC Sets' });
  try {
    await pool.query(`
      INSERT INTO log_ymks_to_supplier (date, vendor, set_type, quantity, vehicle, remarks, logged_by, logged_by_name)
      VALUES (?,?,?,?,?,?,?,?)
    `, [date, vendor, set_type, quantity, vehicle || null, remarks || null, req.user.id, req.user.name]);
    res.json({ message: 'Entry logged' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
 
// DELETE
router.delete('/ymks-to-supplier/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM log_ymks_to_supplier WHERE id = ?', [req.params.id]);
  res.json({ message: 'Entry deleted' });
});
 
 
// ════════════════════════════════════════
//  LOG 2 — Supplier → TSS
// ════════════════════════════════════════
 
// GET all
router.get('/supplier-to-tss', authMiddleware, async (req, res) => {
  try {
    let query = 'SELECT * FROM log_supplier_to_tss';
    const params = [];
    if (req.user.role === 'supplier') {
      query += ' WHERE vendor = ?';
      params.push(req.user.supplier_name);
    }
    query += ' ORDER BY date DESC, id DESC';
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
 
// POST new entry
router.post('/supplier-to-tss', authMiddleware, requireRole('admin', 'tss_staff'), async (req, res) => {
  const { date, vendor, opening_flc, opening_wc, closing_flc, closing_wc, dispatched_flc, dispatched_wc, remarks } = req.body;
  if (!date || !vendor)
    return res.status(400).json({ error: 'date and vendor required' });
  try {
    await pool.query(`
      INSERT INTO log_supplier_to_tss
        (date, vendor, opening_flc, opening_wc, closing_flc, closing_wc, dispatched_flc, dispatched_wc, remarks, logged_by, logged_by_name)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `, [date, vendor,
        opening_flc||0, opening_wc||0,
        closing_flc||0, closing_wc||0,
        dispatched_flc||0, dispatched_wc||0,
        remarks||null, req.user.id, req.user.name]);
    res.json({ message: 'Entry logged' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

 
 
// ════════════════════════════════════════
//  LOG 3 — TSS → Supplier
// ════════════════════════════════════════
 
// GET all
router.get('/tss-to-supplier', authMiddleware, async (req, res) => {
  try {
    let query = 'SELECT * FROM log_tss_to_supplier';
    const params = [];
    if (req.user.role === 'supplier') {
      query += ' WHERE vendor = ?';
      params.push(req.user.supplier_name);
    }
    query += ' ORDER BY date DESC, id DESC';
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
 
// POST new entry
router.post('/tss-to-supplier', authMiddleware, requireRole('admin', 'tss_staff'), async (req, res) => {
  const { date, vendor, opening_flc, opening_wc, closing_flc, closing_wc, dispatched_flc, dispatched_wc, remarks } = req.body;
  if (!date || !vendor)
    return res.status(400).json({ error: 'date and vendor required' });
  try {
    await pool.query(`
      INSERT INTO log_tss_to_supplier
        (date, vendor, opening_flc, opening_wc, closing_flc, closing_wc, dispatched_flc, dispatched_wc, remarks, logged_by, logged_by_name)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `, [date, vendor,
        opening_flc||0, opening_wc||0,
        closing_flc||0, closing_wc||0,
        dispatched_flc||0, dispatched_wc||0,
        remarks||null, req.user.id, req.user.name]);
    res.json({ message: 'Entry logged' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
 
// DELETE
router.delete('/tss-to-supplier/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM log_tss_to_supplier WHERE id = ?', [req.params.id]);
  res.json({ message: 'Entry deleted' });
});
 
 
module.exports = router;