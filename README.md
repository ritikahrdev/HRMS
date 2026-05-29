# HR Software

A simple, complete HR system for startups — employees, attendance, leave,
payroll with payslips, reimbursements, email notifications, company settings,
and reports. Runs as a local web app; no cloud or database server needed.

## Quick start

1. Install **Node.js (LTS)** from https://nodejs.org (one time).
2. Double-click **`start.bat`**.
3. Open **http://localhost:4000** (opens automatically).
4. Log in as admin:
   - Email: `admin@company.local`
   - Password: `Admin@12345`

New to this? Read **SETUP_GUIDE.md** (written for non-technical users).
Day-to-day usage is in **USER_GUIDE.md**.

## Features

- **5 roles** with access control on backend and frontend:
  Super Admin, HR Admin, Finance Admin, Manager, Employee
- **Managers** see only their own team and approve their team's leave,
  reimbursements, and attendance corrections
- Employee management + **bulk import from Excel** with on-screen error fixing
- Attendance: employee check-in/check-out; present/absent view & corrections;
  **employee correction requests** approved by manager/HR
- Leave: apply, approve/reject, balances, auto-reflected in attendance & payroll
- Payroll: monthly salary from attendance & leave; **PDF payslips**; email payslip
  (Finance generates; HR can view)
- Reimbursements: upload bills, approve/reject, added to payslip
- Email notifications (welcome, leave/correction/reimbursement decisions, payslip) — optional
- Company settings: name, legal name, GST/CIN/PAN, address, logo, currency,
  working hours/days, weekend policy, leave policy, salary rules, payroll closing day, slip footer
- Reports: monthly attendance & payroll summaries

### Roles at a glance

| Role | Can do |
|---|---|
| **Super Admin** | Everything |
| **HR Admin** | Employees, attendance, leave, settings; view payroll & reports |
| **Finance Admin** | Payroll, payslips, reimbursements, salary; view employees & reports |
| **Manager** | View own team; approve their team's leave, reimbursements & attendance corrections |
| **Employee** | Own profile, attendance, leave, reimbursements, payslips |

The default `admin@company.local` account is a **Super Admin**. To create other
roles, add an employee and pick a Role; to build a team, set each member's
**Reporting Manager** to the manager.

## Tech (for the curious)

- Node.js + Express (web server & API)
- Built-in `node:sqlite` database — a single file at `data/hr.db`, **no install, no compiler**
- Plain HTML/CSS/JavaScript front end — **no build step**
- `pdfkit` (payslips), `xlsx` (Excel import), `nodemailer` (email), `bcryptjs` (passwords)

## Project layout

```
hr-software/
  start.bat            <- double-click to run
  config.json          <- settings (port, admin, email); created on first run
  server/              <- backend (API, database, services)
  public/              <- frontend (the web pages)
  data/                <- your database (back this up)
  uploads/             <- bills, logos, generated PDFs (back this up)
```

## Notes

- Default port is `4000` (change it in `config.json`).
- Email is **disabled by default**; the app works fully without it. See SETUP_GUIDE.md to enable.
- Back up the `data/` and `uploads/` folders to protect your data.
- `npm audit` reports advisories in the `xlsx` and `multer` packages; they are
  used only for local, authenticated admin actions. Review before exposing the
  app to the public internet.
