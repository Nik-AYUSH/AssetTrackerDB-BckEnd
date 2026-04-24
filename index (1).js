require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initDB } = require('./db');
const authRoutes  = require('./routes/auth');
const cycleRoutes = require('./routes/cycles');
const tssRoutes   = require('./routes/tss');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
  methods: ['GET','POST','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));
app.options('*', cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

app.use('/api/auth',   authRoutes);
app.use('/api/cycles', cycleRoutes);
app.use('/api/tss',    tssRoutes);

initDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}).catch(err => {
  console.error('❌ DB init failed:', err);
  process.exit(1);
});
