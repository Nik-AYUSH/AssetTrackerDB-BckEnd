const express = require('express');
const { pool } = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const router = express.Router();

async function nextCycleId() {
  const [rows] = await pool.query('SELECT cycle_id FROM cycles ORDER BY id DESC LIMIT 1');
  if (rows.length === 0) return 'C001';
  const last = parseInt(rows[0].cycle_id.replace('C', '')) || 0;
  return 'C' + String(last + 1).padStart(3, '0');
}

async function logAudit(cycle_id, action, user, details) {
  await pool.query(
    'INSERT INTO audit_log (cycle_id, action, performed_by, performed_by_name, details) VALUES (?,?,?,?,?)',
    [cycle_id, action, user.id, user.name, details || null]
  );
}

// ── GET ALL CYCLES ──
router.get('/', authMiddleware, async (req, res) => {
  try {
    let query = `
      SELECT c.*, u1.name as dispatched_by_name
      FROM cycles c
      LEFT JOIN users u1 ON c.dispatched_by = u1.id
    `;
    const params = [];
    if (req.user.role === 'supplier') {
      query += ' WHERE c.vendor = ?';
      params.push(req.user.supplier_name);
    }
    query += ' ORDER BY c.created_at DESC';
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── STATS ──
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const [totals] = await pool.query(`
      SELECT
        SUM(CASE WHEN set_type='FLC Set' THEN qty_ymks_dispatched ELSE 0 END) as total_flc,
        SUM(CASE WHEN set_type='W/C Set' THEN qty_ymks_dispatched ELSE 0 END) as total_wc,
        SUM(qty_ymks_dispatched)       as s1_ymks_to_supplier,
        SUM(qty_supplier_to_tss)       as s2_supplier_to_tss,
        SUM(qty_received_at_tss)       as s3_received_at_tss,
        SUM(qty_dispatched_from_tss)   as s6_dispatched_from_tss,
        SUM(qty_received_at_supplier)  as s8_received_at_supplier,
        SUM(qty_returned_to_ymks)      as s9_returned_to_ymks,
        SUM(CASE WHEN status='pending'    THEN 1 ELSE 0 END) as pending_cycles,
        SUM(CASE WHEN status!='completed' THEN 1 ELSE 0 END) as open_cycles,
        SUM(CASE WHEN status='completed'  THEN 1 ELSE 0 END) as closed_cycles
      FROM cycles
    `);

    // TSS stock totals
    const [tssStock] = await pool.query(`
      SELECT
        SUM(opening_stock)          as total_opening,
        SUM(qty_emptied)            as total_emptied,
        SUM(qty_ready_for_dispatch) as total_ready,
        SUM(qty_dispatched)         as total_dispatched,
        SUM(closing_stock)          as total_closing
      FROM tss_daily_stock
    `);

    // Latest TSS daily stock entry
    const [latestTss] = await pool.query(`
      SELECT * FROM tss_daily_stock ORDER BY date DESC, id DESC LIMIT 1
    `);

    res.json({
      totals: totals[0],
      tss: tssStock[0],
      latestTss: latestTss[0] || null
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── AUDIT LOG ──
router.get('/:id/audit', authMiddleware, async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM audit_log WHERE cycle_id = ? ORDER BY created_at DESC',
    [req.params.id]
  );
  res.json(rows);
});

// ── STEP 1: YMKS → Supplier ──
router.post('/dispatch', authMiddleware, requireRole('admin', 'supplier'), async (req, res) => {
  const { vendor, set_type, qty_ymks_dispatched, vehicle, dispatch_date, notes } = req.body;
  if (!vendor || !set_type || !qty_ymks_dispatched)
    return res.status(400).json({ error: 'vendor, set_type and quantity required' });
  if (vendor === 'Sanvijay' && set_type === 'W/C Set')
    return res.status(400).json({ error: 'Sanvijay only supplies FLC Sets' });
  try {
    const cycle_id = await nextCycleId();
    await pool.query(`
      INSERT INTO cycles (cycle_id, vendor, set_type, qty_ymks_dispatched, vehicle, dispatch_date, status, dispatched_by, notes)
      VALUES (?,?,?,?,?,?,'pending',?,?)
    `, [cycle_id, vendor, set_type, qty_ymks_dispatched, vehicle || null, dispatch_date || null, req.user.id, notes || null]);
    await logAudit(cycle_id, 'YMKS → SUPPLIER', req.user,
      `${qty_ymks_dispatched} × ${set_type} dispatched to ${vendor}`);
    res.json({ message: 'Step 1 recorded', cycle_id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── STEP 2: Supplier → TSS (in transit) ──
router.patch('/:id/supplier-to-tss', authMiddleware, requireRole('admin', 'supplier'), async (req, res) => {
  const { qty, date, notes } = req.body;
  if (!qty) return res.status(400).json({ error: 'qty required' });
  try {
    const [rows] = await pool.query('SELECT * FROM cycles WHERE cycle_id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Cycle not found' });
    const c = rows[0];
    const newQty = (c.qty_supplier_to_tss || 0) + parseInt(qty);
    if (newQty > c.qty_ymks_dispatched)
      return res.status(400).json({ error: `Max allowed: ${c.qty_ymks_dispatched}` });
    await pool.query(
      `UPDATE cycles SET qty_supplier_to_tss=?, status='in_progress' WHERE cycle_id=?`,
      [newQty, req.params.id]
    );
    await logAudit(req.params.id, 'SUPPLIER → TSS', req.user,
      `${qty} sets sent to TSS. Total in transit: ${newQty}`);
    res.json({ message: 'Step 2 recorded' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── STEP 3: TSS Receives (with loaded/empty split) ──
router.patch('/:id/tss-receive', authMiddleware, requireRole('admin', 'tss_staff'), async (req, res) => {
  const { qty_arrived_loaded, qty_arrived_empty, qty_emptied, date, notes } = req.body;
  const loaded = parseInt(qty_arrived_loaded) || 0;
  const empty  = parseInt(qty_arrived_empty)  || 0;
  const emptied = parseInt(qty_emptied)        || 0;
  const total  = loaded + empty;
  if (total < 1) return res.status(400).json({ error: 'Enter loaded + empty quantities' });
  try {
    const [rows] = await pool.query('SELECT * FROM cycles WHERE cycle_id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Cycle not found' });
    const c = rows[0];
    const newTotal = (c.qty_received_at_tss || 0) + total;
    if (newTotal > c.qty_supplier_to_tss)
      return res.status(400).json({ error: `Cannot receive more than in transit (${c.qty_supplier_to_tss})` });
    const newLoaded  = (c.qty_arrived_loaded || 0) + loaded;
    const newEmpty   = (c.qty_arrived_empty  || 0) + empty;
    const newEmptied = (c.qty_emptied_at_tss || 0) + emptied;
    await pool.query(`
      UPDATE cycles SET
        qty_received_at_tss=?,
        qty_arrived_loaded=?,
        qty_arrived_empty=?,
        qty_emptied_at_tss=?
      WHERE cycle_id=?
    `, [newTotal, newLoaded, newEmpty, newEmptied, req.params.id]);
    await logAudit(req.params.id, 'RECEIVED AT TSS', req.user,
      `${total} sets received (${loaded} loaded, ${empty} empty). Emptied: ${emptied}`);
    res.json({ message: 'Step 3 recorded' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── STEP 6: TSS Dispatches back to Supplier ──
router.patch('/:id/tss-to-supplier', authMiddleware, requireRole('admin', 'tss_staff'), async (req, res) => {
  const { qty, date, notes } = req.body;
  if (!qty) return res.status(400).json({ error: 'qty required' });
  try {
    const [rows] = await pool.query('SELECT * FROM cycles WHERE cycle_id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Cycle not found' });
    const c = rows[0];
    const newQty = (c.qty_dispatched_from_tss || 0) + parseInt(qty);
    if (newQty > c.qty_received_at_tss)
      return res.status(400).json({ error: `Cannot dispatch more than received at TSS (${c.qty_received_at_tss})` });
    await pool.query(
      `UPDATE cycles SET qty_dispatched_from_tss=?, return_date=? WHERE cycle_id=?`,
      [newQty, date || null, req.params.id]
    );
    await logAudit(req.params.id, 'TSS → SUPPLIER', req.user,
      `${qty} sets dispatched from TSS. Total: ${newQty}/${c.qty_received_at_tss}`);
    res.json({ message: 'Step 6 recorded' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── STEP 8: Supplier Receives back ──
router.patch('/:id/supplier-receive', authMiddleware, requireRole('admin', 'supplier'), async (req, res) => {
  const { qty, date, notes } = req.body;
  if (!qty) return res.status(400).json({ error: 'qty required' });
  try {
    const [rows] = await pool.query('SELECT * FROM cycles WHERE cycle_id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Cycle not found' });
    const c = rows[0];
    const newQty = (c.qty_received_at_supplier || 0) + parseInt(qty);
    if (newQty > c.qty_dispatched_from_tss)
      return res.status(400).json({ error: `Cannot exceed TSS dispatched (${c.qty_dispatched_from_tss})` });
    await pool.query(
      `UPDATE cycles SET qty_received_at_supplier=? WHERE cycle_id=?`,
      [newQty, req.params.id]
    );
    await logAudit(req.params.id, 'SUPPLIER RECEIVED BACK', req.user,
      `${qty} sets received back at ${c.vendor}. Total: ${newQty}`);
    res.json({ message: 'Step 8 recorded' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── STEP 9: Supplier → YMKS ──
router.patch('/:id/supplier-to-ymks', authMiddleware, requireRole('admin', 'supplier'), async (req, res) => {
  const { qty, date, notes } = req.body;
  if (!qty) return res.status(400).json({ error: 'qty required' });
  try {
    const [rows] = await pool.query('SELECT * FROM cycles WHERE cycle_id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Cycle not found' });
    const c = rows[0];
    const newQty = (c.qty_returned_to_ymks || 0) + parseInt(qty);
    if (newQty > c.qty_received_at_supplier)
      return res.status(400).json({ error: `Cannot exceed supplier received (${c.qty_received_at_supplier})` });
    const isComplete = newQty >= c.qty_ymks_dispatched;
    await pool.query(
      `UPDATE cycles SET qty_returned_to_ymks=?, status=? WHERE cycle_id=?`,
      [newQty, isComplete ? 'completed' : 'in_progress', req.params.id]
    );
    await logAudit(req.params.id, 'SUPPLIER → YMKS', req.user,
      `${qty} sets returned to YMKS. Total: ${newQty}/${c.qty_ymks_dispatched}`);
    res.json({ message: 'Step 9 recorded' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE CYCLE ──
router.delete('/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM cycles WHERE cycle_id = ?', [req.params.id]);
  await pool.query('DELETE FROM audit_log WHERE cycle_id = ?', [req.params.id]);
  res.json({ message: 'Cycle deleted' });
});

router.patch('/:id/force-complete', authMiddleware, requireRole('admin'), async (req, res) => {
  const { notes } = req.body;
  try {
    await pool.query(
      `UPDATE cycles SET status='completed' WHERE cycle_id=?`,
      [req.params.id]
    );
    await logAudit(req.params.id, 'FORCE COMPLETED', req.user,
      notes || 'Cycle manually closed by admin');
    res.json({ message: 'Cycle marked complete' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
