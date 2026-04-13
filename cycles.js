const express = require('express');
const { pool } = require('./db');
const { authMiddleware, requireRole } = require('./auth_middleware');

const router = express.Router();

// Helper: generate next cycle ID
async function nextCycleId() {
  const [rows] = await pool.query('SELECT cycle_id FROM cycles ORDER BY id DESC LIMIT 1');
  if (rows.length === 0) return 'C001';
  const last = parseInt(rows[0].cycle_id.replace('C', '')) || 0;
  return 'C' + String(last + 1).padStart(3, '0');
}

// Helper: log audit
async function logAudit(cycle_id, action, user, details) {
  await pool.query(
    'INSERT INTO audit_log (cycle_id, action, performed_by, performed_by_name, details) VALUES (?,?,?,?,?)',
    [cycle_id, action, user.id, user.name, details || null]
  );
}

// GET /api/cycles — all cycles (filtered by role)
router.get('/', authMiddleware, async (req, res) => {
  try {
    let query = `
      SELECT c.*,
        u1.name as dispatched_by_name,
        u2.name as received_by_name
      FROM cycles c
      LEFT JOIN users u1 ON c.dispatched_by = u1.id
      LEFT JOIN users u2 ON c.received_by = u2.id
    `;
    const params = [];

    if (req.user.role === 'supplier') {
      query += ' WHERE c.vendor = ?';
      params.push(req.user.supplier_name);
    }

    query += ' ORDER BY c.created_at DESC';
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const [totals] = await pool.query(`
      SELECT
        SUM(CASE WHEN set_type='FLC Set' THEN quantity_sent ELSE 0 END) as total_flc,
        SUM(CASE WHEN set_type='W/C Set' THEN quantity_sent ELSE 0 END) as total_wc,
        SUM(quantity_sent)                  as dispatched_from_supplier,
        SUM(quantity_received)              as received_at_tss,
        SUM(quantity_dispatched_tss)        as dispatched_from_tss,
        SUM(quantity_received_supplier)     as received_at_supplier,
        SUM(CASE WHEN status='pending'    THEN 1 ELSE 0 END) as pending_cycles,
        SUM(CASE WHEN status!='completed' THEN 1 ELSE 0 END) as open_cycles,
        SUM(CASE WHEN status='completed'  THEN 1 ELSE 0 END) as closed_cycles
      FROM cycles
    `);

    const [byLocation] = await pool.query(`
      SELECT vendor, set_type,
        SUM(quantity_sent)              as sent,
        SUM(quantity_received)          as received,
        SUM(quantity_dispatched_tss)    as dispatched_tss,
        SUM(quantity_received_supplier) as received_supplier,
        SUM(quantity_sent - quantity_received_supplier) as balance
      FROM cycles GROUP BY vendor, set_type
    `);

    res.json({ totals: totals[0], byLocation });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/cycles/:id/audit — audit log for a cycle
router.get('/:id/audit', authMiddleware, async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM audit_log WHERE cycle_id = ? ORDER BY created_at DESC',
    [req.params.id]
  );
  res.json(rows);
});

// POST /api/cycles/dispatch
router.post('/dispatch', authMiddleware, requireRole('admin', 'supplier'), async (req, res) => {
  const { vendor, set_type, quantity_sent, vehicle, dispatch_date, notes } = req.body;

  if (!vendor || !set_type || !quantity_sent)
    return res.status(400).json({ error: 'vendor, set_type and quantity_sent are required' });

  if (vendor === 'Sanvijay' && set_type === 'W/C Set')
    return res.status(400).json({ error: 'Sanvijay only supplies FLC Sets' });

  if (req.user.role === 'supplier' && req.user.supplier_name !== vendor)
    return res.status(403).json({ error: 'You can only dispatch for your own company' });

  try {
    const cycle_id = await nextCycleId();
    await pool.query(`
      INSERT INTO cycles (cycle_id, vendor, set_type, quantity_sent, vehicle, dispatch_date, status, dispatched_by, notes)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `, [cycle_id, vendor, set_type, quantity_sent, vehicle || null, dispatch_date || null, req.user.id, notes || null]);

    await logAudit(cycle_id, 'DISPATCHED', req.user,
      `${quantity_sent} × ${set_type} from ${vendor} via ${vehicle || 'unknown vehicle'}`);

    res.json({ message: 'Dispatch recorded', cycle_id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/cycles/:id/receive
// PATCH /api/cycles/:id/dispatch-return — TSS dispatches sets back
router.patch('/:id/dispatch-return', authMiddleware, requireRole('admin', 'tss_staff'), async (req, res) => {
  const { quantity_dispatched_tss, dispatch_return_date, notes } = req.body;

  try {
    const [rows] = await pool.query('SELECT * FROM cycles WHERE cycle_id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Cycle not found' });

    const cycle = rows[0];
    const newQty = (cycle.quantity_dispatched_tss || 0) + parseInt(quantity_dispatched_tss || 0);

    if (newQty > cycle.quantity_received)
      return res.status(400).json({ error: `Cannot dispatch more than received at TSS (${cycle.quantity_received})` });

    await pool.query(`
      UPDATE cycles SET quantity_dispatched_tss = ?, return_date = ?,
      notes = CONCAT(IFNULL(notes,''), ?)
      WHERE cycle_id = ?
    `, [newQty, dispatch_return_date || null, notes ? '\nTSS Dispatch: ' + notes : '', req.params.id]);

    await logAudit(req.params.id, 'DISPATCHED FROM TSS', req.user,
      `${quantity_dispatched_tss} sets dispatched from TSS back to supplier. Total: ${newQty}/${cycle.quantity_received}`);

    res.json({ message: 'TSS dispatch recorded', cycle_id: req.params.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/cycles/:id/receive-supplier — Supplier confirms receipt
router.patch('/:id/receive-supplier', authMiddleware, requireRole('admin', 'supplier'), async (req, res) => {
  const { quantity_received_supplier, received_supplier_date, notes } = req.body;

  try {
    const [rows] = await pool.query('SELECT * FROM cycles WHERE cycle_id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Cycle not found' });

    const cycle = rows[0];
    const newQty = (cycle.quantity_received_supplier || 0) + parseInt(quantity_received_supplier || 0);

    if (newQty > cycle.quantity_dispatched_tss)
      return res.status(400).json({ error: `Cannot receive more than dispatched from TSS (${cycle.quantity_dispatched_tss})` });

    const isComplete = newQty >= cycle.quantity_sent;

    await pool.query(`
      UPDATE cycles SET quantity_received_supplier = ?,
      status = ?, notes = CONCAT(IFNULL(notes,''), ?)
      WHERE cycle_id = ?
    `, [newQty, isComplete ? 'completed' : 'in_progress',
        notes ? '\nSupplier Received: ' + notes : '', req.params.id]);

    await logAudit(req.params.id, 'RECEIVED AT SUPPLIER', req.user,
      `${quantity_received_supplier} sets received back at supplier. Total: ${newQty}/${cycle.quantity_sent}`);

    res.json({ message: 'Supplier receipt recorded', cycle_id: req.params.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/cycles/:id — admin only
router.delete('/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM cycles WHERE cycle_id = ?', [req.params.id]);
  await pool.query('DELETE FROM audit_log WHERE cycle_id = ?', [req.params.id]);
  res.json({ message: 'Cycle deleted' });
});

module.exports = router;
