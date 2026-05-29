# Hrika — Deployment Guide

## Quick Start

This guide walks you through deploying **Hrika** to production. Choose your deployment method below.

---

## ⚠️ Security Checklist Before Deploy

- [ ] Copy `.env.example` to `.env` and fill in all values
- [ ] Generate secure SESSION_SECRET (use `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
- [ ] Generate secure CSRF_SECRET (use same method)
- [ ] **Never** commit `.env` or `config.json` to git
- [ ] Verify `.gitignore` includes `.env` and `config.json`
- [ ] Use HTTPS in production (set `REQUIRE_HTTPS=true` in `.env`)
- [ ] Change `DEFAULT_ADMIN_PASSWORD` from default
- [ ] Review `npm audit` for vulnerabilities: `npm audit`
- [ ] Verify email credentials are correct (if using email)

---

## Option A: Deploy to Render.com (Recommended for small teams)

**Cost:** Free tier with limits (app sleeps), or $7/month for always-on  
**Best for:** Testing, demos, or small teams (<50 people)

### Step 1: Push to GitHub

```bash
# Create a GitHub account (free)
# Install GitHub Desktop: https://desktop.github.com
# In GitHub Desktop:
#   1. File → Add Local Repository → select C:\Users\K S\Projects\hr-software
#   2. Click "Publish repository" and choose PRIVATE (important!)
```

### Step 2: Create .env on Render

Go to https://render.com and sign up with your GitHub account.

1. Click **New +** → **Web Service**
2. Select the `hr-software` repository
3. Configure:
   - **Name:** `hrika` (or your choice)
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free (or Standard $7/month for persistent data)

4. Click **Advanced** and add Environment Variables:
   ```
   NODE_ENV = production
   SESSION_SECRET = (paste generated secret)
   CSRF_SECRET = (paste generated secret)
   DEFAULT_ADMIN_EMAIL = admin@company.local
   DEFAULT_ADMIN_PASSWORD = ChangeMe@12345
   REQUIRE_HTTPS = true
   PUBLIC_URL = https://hrika.onrender.com (or your custom domain)
   ```

5. Click **Create Web Service**

Render will auto-detect the Node.js environment and deploy. The app will be live at `https://hrika.onrender.com` in 2–5 minutes.

**Note:** On the free plan, the app sleeps after 15 minutes of inactivity (first user waits ~30 sec). On the paid plan, it stays always-on.

---

## Option B: Deploy to Railway.app (Cheaper + Persistent Storage)

**Cost:** ~₹450–600/month (~$5–7)  
**Best for:** Production use with real employee data

### Step 1: Push to GitHub (same as above)

### Step 2: Deploy on Railway

1. Go to https://railway.app and sign up with GitHub
2. Click **New Project** → **Deploy from GitHub Repo**
3. Select `hr-software`
4. Railway auto-detects Node.js
5. Add Environment Variables:
   ```
   NODE_ENV = production
   SESSION_SECRET = (generated)
   CSRF_SECRET = (generated)
   DEFAULT_ADMIN_EMAIL = admin@company.local
   DEFAULT_ADMIN_PASSWORD = ChangeMe@12345
   REQUIRE_HTTPS = true
   PUBLIC_URL = https://yourdomain.railway.app
   ```

6. Your app is live in ~2 minutes at a Railway URL
7. (Optional) Connect a custom domain (like `hr.digistay.ai`)

---

## Option C: Deploy on Your Own Server (VPS)

**Cost:** ₹300–600/month for a small VPS  
**Best for:** Full control, always-on, custom domain

### Requirements
- A Linux VPS (Ubuntu 22.04 recommended)
- SSH access
- Node.js 22+ installed

### Step-by-step

```bash
# SSH into your server
ssh root@your-server-ip

# Install Node.js (if not already installed)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git

# Clone your GitHub repo
git clone https://github.com/your-username/hr-software.git
cd hr-software

# Create .env file
nano .env
# Paste the content below, then save (Ctrl+X, Y, Enter)

# Install dependencies
npm install

# Start the app
npm start
```

**.env file content:**
```
NODE_ENV=production
PORT=3000
SESSION_SECRET=(generated 32-char secret)
CSRF_SECRET=(generated 32-char secret)
DEFAULT_ADMIN_EMAIL=admin@company.local
DEFAULT_ADMIN_PASSWORD=ChangeMe@12345
REQUIRE_HTTPS=true
PUBLIC_URL=https://hr.digistay.ai
```

### Set up HTTPS + Domain

Install Nginx + Let's Encrypt for free SSL:

```bash
sudo apt install -y nginx certbot python3-certbot-nginx

sudo nano /etc/nginx/sites-available/default
# Paste the config below
```

**Nginx config** (`/etc/nginx/sites-available/default`):
```nginx
server {
    listen 80;
    server_name hr.digistay.ai;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo systemctl restart nginx
sudo certbot --nginx -d hr.digistay.ai
sudo systemctl restart nginx
```

Your app is now at `https://hr.digistay.ai`.

### Keep App Running (PM2)

```bash
sudo npm install -g pm2
pm2 start "npm start" --name hrika
pm2 startup
pm2 save
```

The app will auto-restart on server reboot.

---

## Environment Variables Reference

| Variable | Required | Example | Notes |
|----------|----------|---------|-------|
| `NODE_ENV` | Yes | `production` | Must be `production` in deployment |
| `PORT` | No | `3000` | Default 4000; most hosts set via PORT env var |
| `SESSION_SECRET` | Yes | `(32-char random string)` | Generate with `crypto.randomBytes(32).toString('hex')` |
| `CSRF_SECRET` | Yes | `(32-char random string)` | Generate with `crypto.randomBytes(32).toString('hex')` |
| `DEFAULT_ADMIN_EMAIL` | Yes | `admin@company.local` | Super Admin login email |
| `DEFAULT_ADMIN_PASSWORD` | Yes | `ChangeMe@12345` | Change immediately on first login |
| `REQUIRE_HTTPS` | No | `true` | Enforce HTTPS in production |
| `PUBLIC_URL` | Yes | `https://hr.digistay.ai` | Used in email links; must match your domain |
| `EMAIL_ENABLED` | No | `true` | Enable email notifications (optional) |
| `SMTP_HOST` | If email | `smtp.gmail.com` | Gmail, SendGrid, etc. |
| `SMTP_PORT` | If email | `587` | Usually 587 (TLS) or 465 (SSL) |
| `SMTP_USER` | If email | `your-email@gmail.com` | Your SMTP account |
| `SMTP_PASS` | If email | `your-app-password` | NOT your regular password; use app-specific password |
| `EMAIL_FROM` | If email | `HR Team <noreply@digistay.ai>` | From address for emails |
| `DATABASE_PATH` | No | `/var/lib/hrika/hr.db` | Custom SQLite path (defaults to ./data/hr.db) |
| `UPLOAD_DIR` | No | `/var/lib/hrika/uploads` | Where to store file uploads |

---

## Post-Deployment Checklist

- [ ] Visit your live app (e.g., `https://hr.digistay.ai`)
- [ ] Log in with default admin (email, password from `.env`)
- [ ] Change admin password on first login
- [ ] Test attendance marking (clock in/out)
- [ ] Test leave request workflow
- [ ] Verify reports page loads
- [ ] Test file upload (document verification)
- [ ] (If email enabled) Test leave approval email links
- [ ] Enable Slack sync (if using Slack)
- [ ] Set up backup (automated daily backup of SQLite DB)

---

## Backup Strategy

SQLite database is at `./data/hr.db` (or `DATABASE_PATH`).

### For Render/Railway
- Platforms provide filesystem snapshots, but **not guaranteed**
- **Recommended:** Export data weekly via `/api/export` (if implemented) or download via SFTP

### For VPS
```bash
# Daily backup script (save as backup.sh)
#!/bin/bash
BACKUP_DIR="/var/backups/hrika"
mkdir -p $BACKUP_DIR
cp /home/user/hr-software/data/hr.db $BACKUP_DIR/hr.db.$(date +%Y%m%d)
# Keep last 30 days
find $BACKUP_DIR -name "hr.db.*" -mtime +30 -delete
```

Add to crontab:
```bash
crontab -e
# Add: 0 2 * * * /home/user/backup.sh (runs daily at 2 AM)
```

---

## Troubleshooting

### App crashes on deploy
- Check logs: `heroku logs --tail` (Heroku) or `/var/log/nginx/error.log` (VPS)
- Verify `.env` variables are set (especially `SESSION_SECRET`)
- Ensure all required dependencies installed: `npm install`

### Port already in use
```bash
# On VPS, if port 3000 is taken:
lsof -i :3000
kill -9 <PID>
```

### Database not persisting on Render (free tier)
- Free tier doesn't keep persistent disk; use paid plan or export/import data
- Alternatively, use a PostgreSQL add-on (https://render.com/docs/postgres)

### "Cannot find module" errors
```bash
npm install --production
npm start
```

### HTTPS certificate issues
```bash
# On VPS with Let's Encrypt:
sudo certbot renew --dry-run
```

---

## Security Notes

1. **Sensitive data**: Your `hr.db` contains real Aadhaar, PAN, and salary information.
   - Always use HTTPS (never HTTP in production)
   - Regularly back up; store backups securely
   - Restrict access to your app (VPN, firewall, etc.)

2. **Dependencies**: Run `npm audit` periodically and keep packages updated:
   ```bash
   npm update
   npm audit fix
   ```

3. **Session security**: `SESSION_SECRET` must be at least 32 characters and random.
   - Regenerate before each deployment to a new environment
   - Never reuse in multiple environments

---

## Need Help?

- **Local testing**: Run `npm start` and visit `http://localhost:4000`
- **Questions**: Check the USER_GUIDE.md for feature documentation
- **Bugs**: File an issue with logs and steps to reproduce

---

**Happy deploying! 🚀**
