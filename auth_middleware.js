const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('./db');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required' });

  try {
    const [rows] = await pool.query(
      'SELECT * FROM users WHERE username = ?', [username]
    );
    if (rows.length === 0)
      return res.status(401).json({ error: 'Invalid credentials' });

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, name: user.name, supplier_name: user.supplier_name },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: { id: user.id, name: user.name, username: user.username, role: user.role, supplier_name: user.supplier_name }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// GET /api/auth/users — admin only
router.get('/users', authMiddleware, requireRole('admin'), async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, name, username, role, supplier_name, created_at FROM users ORDER BY created_at DESC'
  );
  res.json(rows);
});

// POST /api/auth/users — admin creates users
router.post('/users', authMiddleware, requireRole('admin'), async (req, res) => {
  const { name, username, password, role, supplier_name } = req.body;
  if (!name || !username || !password || !role)
    return res.status(400).json({ error: 'All fields required' });

  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (name, username, password_hash, role, supplier_name) VALUES (?,?,?,?,?)',
      [name, username, hash, role, supplier_name || null]
    );
    res.json({ message: 'User created successfully' });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY')
      return res.status(400).json({ error: 'Username already exists' });
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/auth/users/:id — admin only
router.delete('/users/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM users WHERE id = ? AND username != "admin"', [req.params.id]);
  res.json({ message: 'User deleted' });
});

module.exports = router;
