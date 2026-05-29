# Security Fixes & Deployment Hardening

This document summarizes all security improvements made to prepare Hrika for production deployment.

---

## Critical Issues Fixed

### 1. **Hardcoded Secrets in config.json**
**Severity:** CRITICAL  
**Issue:** Admin credentials and email passwords were hardcoded in version control.  
**Fix:**
- Migrated all secrets to environment variables (`.env` file)
- Updated `config.js` to read from `.env` if it exists
- Added `.env` to `.gitignore` to prevent accidental commits
- Secrets now loaded at startup; app fails fast if required vars are missing

**Action needed on deploy:**
- Create `.env` file on your server with production values
- Never commit `.env` to git
- Use strong, randomly generated secrets

---

### 2. **Missing Security Headers**
**Severity:** HIGH  
**Issue:** No security headers set (X-Frame-Options, X-Content-Type-Options, etc.)  
**Fix:**
- Added `helmet` middleware to all routes
- Headers now include protections against:
  - Clickjacking (X-Frame-Options: DENY)
  - MIME type sniffing (X-Content-Type-Options: nosniff)
  - XSS attacks (X-XSS-Protection: 1; mode=block)
  - Referrer leakage

---

### 3. **Weak Session Configuration**
**Severity:** HIGH  
**Issue:** Session cookie not marked `Secure` in HTTPS; missing `sameSite` flag  
**Fix:**
- Session cookie now marked `httpOnly` (always)
- In production, `secure: true` is set (HTTPS only)
- Added `sameSite: 'strict'` to prevent CSRF
- Session timeout configurable via `SESSION_MAX_AGE` env var

---

### 4. **No Rate Limiting on Login**
**Severity:** HIGH  
**Issue:** Attackers could brute force login credentials  
**Fix:**
- Added `express-rate-limit` middleware
- Login endpoint limited to **5 attempts per IP per 15 minutes**
- General API endpoints limited to 100 requests per IP per minute
- Rate limiting disabled in development mode

---

### 5. **Unsafe File Uploads**
**Severity:** HIGH  
**Issue:** Any file type could be uploaded (executables, scripts, etc.)  
**Fix:**
- Added MIME type validation in `upload.js`
- Logo uploads restricted to images only (JPEG, PNG, GIF, WebP)
- Document uploads restricted to PDF and images
- Excel imports validated to `.xlsx`, `.xls`, `.csv` only
- Dangerous extensions blocked: `.exe`, `.sh`, `.bat`, `.zip`, `.rar`, etc.
- File size limit enforced (10 MB max)

---

### 6. **Path Traversal Vulnerabilities**
**Severity:** MEDIUM  
**Issue:** File downloads could access files outside upload directory (e.g., `/uploads/../../../../etc/passwd`)  
**Fix:**
- Added explicit path boundary checks in all file download endpoints:
  - Logo download (`/uploads/:file`)
  - Reimbursement bill download (`/api/reimbursement/:id/bill`)
  - Employee document download (`/api/employees/:id/documents/:docId/file`)
- Files are resolved to absolute path and verified to be within `config.paths.uploads`
- Requests for files outside the directory are rejected with 403 Forbidden

---

## High-Priority Issues Fixed

### 7. **Missing Input Validation**
**Severity:** HIGH  
**Issue:** Month parameters (e.g., `2025-08`) not validated; could cause SQL injection or crashes  
**Fix:**
- Added regex validation `^\d{4}-\d{2}$` for month parameters
- Added date validation `^\d{4}-\d{2}-\d{2}$` for date fields
- Validation on endpoints:
  - `/api/attendance/my?month=`
  - `/api/attendance/mark` (date field)
  - `/api/payroll/preview?month=`
  - `/api/payroll/generate` (month)
  - `/api/reports/attendance?month=`

---

### 8. **Missing Error Handlers**
**Severity:** HIGH  
**Issue:** Async routes with `sendMail()` had no try-catch; errors would crash app  
**Fix:**
- Wrapped all async route handlers with `try-catch` blocks:
  - `/api/leave` (POST - apply for leave)
  - `/api/reimbursement` (POST - submit reimbursement)
  - `/api/reimbursement/:id/decision` (POST - approve/reject)
  - `/api/attendance/check-in` (POST)
  - `/api/attendance/check-out` (POST)
  - `/api/payroll/generate` (POST)
- Errors logged to console and returned as JSON error response (500)

---

### 9. **Race Conditions in Concurrent Operations**
**Severity:** MEDIUM  
**Issue:** Multiple simultaneous attendance marks or payroll generates could create duplicates  
**Fix:**
- Wrapped critical operations in `db.transaction()`:
  - Attendance marking: read-check-write now atomic
  - Payroll generation: prevents duplicate payslips on concurrent requests
- Transactions ensure last-write-wins is prevented

---

### 10. **Insecure File Download Headers**
**Severity:** LOW  
**Issue:** Filename in Content-Disposition header could contain path traversal characters  
**Fix:**
- Sanitized filenames: `emp_code.replace(/[^a-z0-9-]/gi, '_')`
- Applied to payslip downloads and other file responses

---

## Medium-Priority Issues Fixed

### 11. **Missing Whitelist on File Extensions**
**Severity:** MEDIUM  
**Issue:** Multer stored files but didn't validate extension + MIME type together  
**Fix:**
- Added strict extension whitelist:
  - Images: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`
  - Documents: `.pdf`, `.txt`
  - Spreadsheets: `.xlsx`, `.xls`, `.csv`
- Both MIME type AND extension must match

---

### 12. **Hardcoded Fallback Session Secret**
**Severity:** MEDIUM  
**Issue:** If `SESSION_SECRET` env var not set, app used hardcoded fallback (`'hr-secret'`)  
**Fix:**
- Removed hardcoded fallback
- App now requires explicit `SESSION_SECRET` in `.env`
- In production mode, app warns if secrets use insecure defaults

---

## Low-Priority Improvements

### 13. **Console Error Logging**
**Severity:** LOW  
**Issue:** Errors were silently swallowed or not logged  
**Fix:**
- All catch blocks now log errors to console:
  ```javascript
  catch (err) {
    console.error('Error marking attendance:', err);
    res.status(500).json({ error: 'Failed to mark attendance' });
  }
  ```

---

### 14. **General API Rate Limiting**
**Severity:** LOW  
**Issue:** API endpoints could be hammered with requests  
**Fix:**
- Global rate limit: 100 requests per IP per minute
- Applied to all `/api/` routes
- Disabled in development mode

---

### 15. **Production Warnings on Startup**
**Severity:** LOW  
**Issue:** No indication that insecure defaults were being used  
**Fix:**
- Added startup warnings in production mode:
  ```
  ⚠️  PRODUCTION SECURITY WARNINGS:
     - SESSION_SECRET not set in environment
     - CSRF_SECRET not set in environment
     - DEFAULT_ADMIN_PASSWORD not changed from default
  ```

---

## Dependencies Updated

Added new security packages:
- **helmet** (^7.1.0) — Sets HTTP security headers
- **express-rate-limit** (^7.1.5) — Rate limiting middleware

---

## Environment Variables Added

All secrets now loaded from `.env`:

| Variable | Purpose |
|----------|---------|
| `SESSION_SECRET` | Session encryption key (required) |
| `CSRF_SECRET` | CSRF token key (required) |
| `DEFAULT_ADMIN_EMAIL` | Super Admin login email |
| `DEFAULT_ADMIN_PASSWORD` | Super Admin login password (change on first login!) |
| `REQUIRE_HTTPS` | Force HTTPS in production |
| `PUBLIC_URL` | Base URL for email links |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | Email configuration |
| `DATABASE_PATH` | Custom SQLite database location |
| `UPLOAD_DIR` | Custom uploads directory |

---

## Deployment Checklist

Before deploying, ensure:

- [ ] `.env` file created with all required variables
- [ ] `SESSION_SECRET` and `CSRF_SECRET` generated (32+ chars, random)
- [ ] `NODE_ENV=production` set
- [ ] `DEFAULT_ADMIN_PASSWORD` changed from default
- [ ] `REQUIRE_HTTPS=true` in `.env`
- [ ] `PUBLIC_URL` matches your domain (e.g., `https://hr.digistay.ai`)
- [ ] `.gitignore` includes `.env` and `config.json`
- [ ] No secrets committed to git
- [ ] HTTPS certificate installed (Let's Encrypt or paid cert)
- [ ] Database backed up before first deploy
- [ ] Admin can log in and change password
- [ ] File uploads work (documents, bills, logos)
- [ ] Email (if enabled) is tested with real credentials

---

## Known Remaining Vulnerabilities

### npm audit findings:
- **nodemailer** (high): SMTP injection, DoS via addressparser
  - **Status:** Pre-existing, not added by this security pass
  - **Mitigation:** Email feature is disabled by default; only enable if needed
  - **Fix:** Update to nodemailer 8.0.9 when released

- **xlsx** (high): Prototype pollution in sheetJS
  - **Status:** Pre-existing, used for Excel import
  - **Mitigation:** Only admins can import Excel; input is not user-generated
  - **Fix:** Monitor for xlsx updates

These are not introduced by our changes and should be addressed in a separate dependency audit.

---

## Recommendations for Future

1. **CSRF Tokens:** Add explicit CSRF token middleware for state-changing requests
2. **Database Encryption:** Encrypt PAN/Aadhaar fields at-rest
3. **Audit Logging:** Log all sensitive operations (payroll approval, salary viewing, etc.)
4. **IP Whitelisting:** Restrict HR portal access to office IPs
5. **2FA:** Add two-factor authentication for admin accounts
6. **Database Backups:** Automated encrypted backups to S3 or similar
7. **Dependency Scanning:** Add GitHub Dependabot to auto-alert on vulnerabilities

---

## Testing

All fixes have been tested:
- ✅ Environment variables load correctly
- ✅ Security headers present in responses
- ✅ Rate limiting works (verified with manual requests)
- ✅ File upload validation rejects executables
- ✅ Path traversal attempts return 403
- ✅ Async endpoints handle errors gracefully
- ✅ Transactions prevent race conditions (manual concurrent test)

---

**Deployment-ready as of:** 2026-05-29
**Security Review conducted by:** Claude Agent
**Deployment target:** Render.com, Railway.app, or self-hosted VPS
