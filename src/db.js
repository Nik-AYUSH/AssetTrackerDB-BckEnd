const mysql = require('mysql2/promise');
require('dotenv').config();
 
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});
 
async function initDB() {
  const conn = await pool.getConnection();
  try {
 
    // ── Users ──
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role ENUM('admin','supplier','tss_staff') NOT NULL,
        supplier_name VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
 
    // ── Cycles ──
    await conn.query(`
      CREATE TABLE IF NOT EXISTS cycles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        cycle_id VARCHAR(20) UNIQUE NOT NULL,
        vendor ENUM('Mahasai','Sanvijay') NOT NULL,
        set_type ENUM('FLC Set','W/C Set') NOT NULL,
 
        -- Step 1: YMKS → Supplier
        qty_ymks_dispatched      INT NOT NULL DEFAULT 0,
 
        -- Step 2: Supplier → TSS
        qty_supplier_to_tss      INT NOT NULL DEFAULT 0,
 
        -- Step 3: TSS Receives
        qty_received_at_tss      INT NOT NULL DEFAULT 0,
        qty_arrived_loaded       INT NOT NULL DEFAULT 0,
        qty_arrived_empty        INT NOT NULL DEFAULT 0,
        qty_emptied_at_tss       INT NOT NULL DEFAULT 0,
 
        -- Step 6: TSS → Supplier
        qty_dispatched_from_tss  INT NOT NULL DEFAULT 0,
 
        -- Step 8: Supplier receives back
        qty_received_at_supplier INT NOT NULL DEFAULT 0,
 
        -- Step 9: Supplier → YMKS
        qty_returned_to_ymks     INT NOT NULL DEFAULT 0,
 
        -- Meta
        vehicle VARCHAR(50),
        dispatch_date DATE,
        return_date DATE,
        status ENUM('pending','in_progress','completed') DEFAULT 'pending',
        dispatched_by INT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (dispatched_by) REFERENCES users(id)
      )
    `);
 
    // ── TSS Daily Stock ──
    await conn.query(`
      CREATE TABLE IF NOT EXISTS tss_daily_stock (
        id INT AUTO_INCREMENT PRIMARY KEY,
        date DATE NOT NULL,
        opening_stock           INT NOT NULL DEFAULT 0,
        qty_emptied             INT NOT NULL DEFAULT 0,
        qty_ready_for_dispatch  INT NOT NULL DEFAULT 0,
        qty_dispatched          INT NOT NULL DEFAULT 0,
        closing_stock           INT NOT NULL DEFAULT 0,
        logged_by INT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (logged_by) REFERENCES users(id)
      )
    `);
 
    // ── Audit Log ──
    await conn.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        cycle_id VARCHAR(20) NOT NULL,
        action VARCHAR(100) NOT NULL,
        performed_by INT,
        performed_by_name VARCHAR(100),
        details TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
 
    // ── Seed default admin ──
    const bcrypt = require('bcryptjs');
    const [rows] = await conn.query(`SELECT id FROM users WHERE username = 'admin'`);
    if (rows.length === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      await conn.query(
        `INSERT INTO users (name, username, password_hash, role) VALUES ('Administrator','admin',?,'admin')`,
        [hash]
      );
      console.log('✅ Default admin created — username: admin / password: admin123');
    }
 
    console.log('✅ Database initialized');
  } finally {
    conn.release();
  }
}
 
module.exports = { pool, initDB };
