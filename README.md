# Returnable Packaging Tracker

Full-stack web app — Vercel (frontend) + Railway (backend + MySQL)

## Project Structure
```
packaging-tracker/
├── frontend/
│   └── index.html          ← Deploy to Vercel
└── backend/
    ├── package.json
    ├── .env.example
    └── src/
        ├── index.js         ← Express server entry
        ├── db/index.js      ← MySQL connection + schema init
        ├── middleware/auth.js
        └── routes/
            ├── auth.js      ← Login, user management
            └── cycles.js    ← Dispatch, receive, return, stats
```

---

## Backend Setup (Railway)

### 1. Create Railway project
1. Go to https://railway.app → New Project
2. Add a **MySQL** database service
3. Copy the connection details from Railway dashboard

### 2. Deploy backend
1. Push the `backend/` folder to a GitHub repo
2. In Railway → New Service → GitHub Repo → select your repo
3. Set root directory to `/backend`

### 3. Set environment variables in Railway
```
DB_HOST=your-railway-mysql-host
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your-password
DB_NAME=packaging_tracker
JWT_SECRET=any-long-random-string
FRONTEND_URL=https://your-app.vercel.app
PORT=5000
```

### 4. First run
The server auto-creates all tables and a default admin user:
- Username: `admin`
- Password: `admin123`
**Change the admin password after first login!**

---

## Frontend Setup (Vercel)

### 1. Edit API URL
Open `frontend/index.html` and change line:
```js
const API = 'https://your-api.railway.app';
```
to your actual Railway backend URL.

### 2. Deploy to Vercel
Option A — Drag and drop:
1. Go to https://vercel.com → New Project
2. Drag the `frontend/` folder onto the deploy area

Option B — GitHub:
1. Push `frontend/` to GitHub
2. Import in Vercel, set root directory to `/frontend`

---

## User Roles

| Role | Can do |
|---|---|
| **Admin** | Everything + manage users |
| **Supplier** | Only dispatch (own company only) |
| **TSS Staff** | Receive + Return only |

## Creating Users (after first login as admin)
1. Log in as `admin`
2. Go to **Users** tab
3. Click **+ Add User**
4. Set role:
   - Mahasai staff → Role: Supplier → Company: Mahasai Aluminium
   - Sanvijay staff → Role: Supplier → Company: Sanvijay
   - TSS staff → Role: TSS Staff

---

## Local Development

```bash
# Backend
cd backend
npm install
cp .env.example .env   # fill in your DB details
npm run dev            # runs on http://localhost:5000

# Frontend — just open in browser
open frontend/index.html
# Or use Live Server in VS Code
```
