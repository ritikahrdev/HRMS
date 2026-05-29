# HR Software — User Guide

This explains what each part of the software does. The menu each person sees
depends on their **role**.

## Roles

| Role | What they can do |
|---|---|
| **Super Admin** | Everything. The default `admin@company.local` is a Super Admin. |
| **HR Admin** | Manage employees, attendance, leave, and company settings; view payroll and reports. |
| **Finance Admin** | Run payroll, manage payslips, salaries and reimbursements; view employees and reports. |
| **Manager** | See their own team only; approve their team's leave, reimbursements, and attendance corrections. |
| **Employee** | See and manage their own profile, attendance, leave, reimbursements, and payslips. |

**How to set roles:** add or edit an employee and choose a **Role**. To make
someone a manager of others, set each team member's **Reporting Manager** to
that person — the manager will then see and approve only those people.

### Access levels (what each person sees)
The left menu is split into sections so user vs admin access is clear:
- **My Space** — personal self-service: Dashboard, My Attendance, My Leave, My
  Reimbursements, My Payslips, My Profile. *(Everyone gets this.)*
- **Company** — shared self-service: Directory, Notice Board, Holidays,
  Recognition, Performance, Surveys, Helpdesk. *(Everyone gets this.)*
- **Admin** — management screens: Employees, Import, Attendance, Approvals,
  Payroll, Loans, Reports, Settings, etc. **A plain Employee never sees the Admin
  section at all**, and the server also blocks those actions (so even a direct
  link is denied). Only SUPER_ADMIN / HR_ADMIN / FINANCE_ADMIN / MANAGER see the
  Admin items their role allows.

So to give someone **employee-only access**, set their Role to **Employee** — they
will see only *My Space* and *Company*, never the company dashboard or admin tools.

Anyone who is also an employee (e.g. a Manager or HR person with their own
profile) additionally gets the self-service "My ..." menus.

> **Important:** the built-in `admin@company.local` login is an administrator
> with **no employee profile**, so it only sees the *approval* menus (Leave
> Approvals, Corrections, Reimbursement Approvals) and cannot itself *apply* for
> leave or reimbursements. To test or use the employee side (apply for leave,
> submit a reimbursement, request an attendance correction), log in with an
> **employee** account. Your own admins (e.g. Abhinav, Ritika) who were added as
> employees have both sets of menus.

---

## Core HR (everyone)

These appear for all users:
- **Directory** — searchable list of all active staff with department, designation, manager, email and phone.
- **Notice Board** — company announcements. HR/Admin can post (and pin) notices; everyone can read them.
- **Holidays** — the company holiday calendar. HR/Admin add holidays; on a holiday everyone is shown **Holiday** (not Absent) and payroll treats it as a **paid** day.

Admin/HR also get:
- **Assets** — track company assets (laptops, phones, etc.), assign them to employees, and see who holds what. Employees see their assigned items under **My Profile → My Assets**.
- **Documents** — on the Employees list, **Docs** opens a **mandatory-document checklist**: every required document (set in Settings → Mandatory Documents) shows **✓ Uploaded** or **Missing**, with a per-document Upload button and an "X/Y uploaded" count. Extra files go under "Other Documents". Employees can upload/view their own under **My Profile → My Documents**.
  - **Edit the required list** in **Settings → Mandatory Documents** (one document name per line).
  - **Verification:** the Docs screen shows an **Identity Checks** panel that auto-validates the **PAN format** and **Aadhaar checksum (Verhoeff)** and flags **duplicate** PAN/Aadhaar/email/phone across employees. HR can mark each uploaded document **✓ Verified** or **✗ Rejected** (recorded with who/when).
  - **Automatic Aadhaar verification (UIDAI Offline e-KYC) — free, no API:** click **Auto-verify Aadhaar** and upload the resident's **UIDAI Offline e-KYC XML** (downloaded from myaadhaar.uidai.gov.in and unzipped with their share code). The app checks **UIDAI's digital signature** — a valid signature proves the Aadhaar is genuine and untampered, auto-marks the Government-ID document **Verified**, and cross-checks the name. **Setup:** paste UIDAI's public certificate in **Settings → Mandatory Documents → UIDAI Public Certificate**, and test with one real file before relying on it. *(PAN has no free offline equivalent — verify PAN via a KYC API or manually.)*
- **Richer employee profiles** — date of birth, gender, blood group, emergency contact, ID proof (Aadhaar), education and experience, in addition to the existing fields.

## Performance & engagement (everyone)

- **Recognition** — give public kudos (with a badge + message) to any colleague; everyone sees the Recognition Wall.
- **Performance** — set and track **Goals** with % progress; view your **Reviews**. Managers/HR can set goals and write reviews (rating + strengths + areas to improve) for their team via the "Manage Team Member" picker.
- **Surveys** — HR/Admin create surveys (text or 1–5 rating questions, optionally anonymous); employees fill active ones; HR sees results with rating averages.
- **Helpdesk** — employees raise tickets (IT/HR/Payroll/etc.) and track them; HR/Admin update status and reply (the employee is emailed when a ticket is closed).
- **Onboarding** — on the Employees list, **Onboarding** opens a checklist for a new hire (use the one-click default template or add your own tasks); tasks can be ticked off.

## Recruitment & Onboarding (HR / Admin)

Open **Recruitment** to hire end-to-end:
1. **New Job** — add the role with **required skills** and **minimum experience** (these are the matching criteria).
2. **Post on LinkedIn** — copies the job details and opens LinkedIn's "Post a job" page so you can publish in one click (LinkedIn doesn't allow auto-posting, so you finish it there).
3. **Add Applicant** — capture name, contact, experience, skills, source, and upload a résumé. Each applicant gets an automatic **match score %** against the job's criteria.
4. **⚡ Auto-shortlist** — moves everyone who meets the criteria (≥60% match) into *Shortlisted*.
5. **Pipeline board** — drag candidates through stages with the dropdown: Applied → Shortlisted → Interview → Offer → Hired / Rejected.
6. **Interview** — pick a date/time and interviewer; it saves the interview and **opens Google Calendar pre-filled** (candidate + interviewer invited) to confirm.
7. **Hire** — one click **creates the employee record + login and applies the onboarding checklist** automatically.

You can turn Recruitment on/off in **Settings → Modules**.

## Manager features

A Manager logs in and sees only their own team:
- **Dashboard** — counts for their team (size, pending leave, reimbursements, corrections).
- **My Team** — the list of people who report to them.
- **Leave Approvals / Reimbursement Approvals / Corrections** — only their team's
  requests appear, and they can approve or reject each one.
- **Attendance** — present/absent view for their team.

Managers cannot see the full employee list, payroll, or company settings.

## Admin (HR / Finance) features

### Dashboard
A quick overview: total employees, who is present/absent today, and how many
leave and reimbursement requests are waiting for your approval.

### Employees
- **Add Employee** — create a new staff member. If you enter their email, a
  login is created automatically with a temporary password (shown on screen).
- **Edit** — update any detail, including salary, or mark someone inactive.
- **Reset PW** — give an employee a new temporary password if they forget theirs.
- **Search** — filter by name, code, department, or email.

### Import Excel
Bulk-add employees from a spreadsheet. The system checks every row and lets you
fix problems on screen before saving. (Full steps in SETUP_GUIDE.md.)

### Attendance
Pick any date to see who was **Present / Half-day / On leave / Absent**, with
their check-in and check-out times. The colored counters at the top give a
quick summary.

- **Edit** any row to set the status and check-in/out times by hand.
- **Delete** removes a day's record (it then counts as absent again).
- **Sync from Google Sheet** pulls attendance from your own sheet (see below).

> Why does everyone show "Absent"? A person is shown Absent on a day when there
> is no check-in record and they are not on approved leave. Until employees
> check in (or you import attendance from your Google Sheet, or edit it by hand),
> days with no data show as Absent. This is expected — add a data source and it
> fills in.

#### Importing attendance (Excel file or Google Sheet)
Click **Import Attendance** on the Attendance page. You have two options:

**Option 1 — Upload a file.** Choose an **Excel (.xlsx/.xls)** or **CSV** file.
(From Google Sheets: File → Download → Microsoft Excel or CSV, then upload it.)

**Option 2 — Link a Google Sheet.** Paste your Google Sheet link. Either set the
sheet to **"Anyone with the link can view"** (Share button) or **Publish to web**
as CSV. The app converts normal sheet links automatically and remembers the link.

**Two sheet layouts are supported:**
- **List style** — one row per day with columns **Emp Code** (or **Email** or
  **Name**), **Date**, and a **Status** (Present/Absent/Half/Leave) or **Check
  In**/**Check Out** times.
- **Grid/roster style** — one row per employee with a **column for each date**
  (e.g. 01/08/2025 … 31/08/2025) and a status mark in each cell. Metadata rows
  like Month/Year on top are handled automatically.

Employees are matched by **Emp Code, Email, or Name**. After importing, the app
tells you how many rows synced and lists any names/codes it could **not** match
(usually because that person isn't added as an employee yet, or the name is
spelled differently). Dates use **DD/MM/YYYY**.

> After importing, set the **Date** picker to a day in that month to see the
> results (e.g. an August sheet shows up on August dates).

### Corrections
Attendance correction requests submitted by employees. Approve or reject each;
approving updates that day's attendance automatically. The employee is emailed.

### Leave
See all leave requests. For pending ones, click **Approve** or **Reject**
(you can add a reason when rejecting). Approved leave is automatically recorded
in attendance and considered during payroll. The employee is emailed the result.

**Comp-off:** click **Grant Comp-off** to credit an employee comp-off days (e.g.
for working a weekend/holiday); they can then apply for Comp-off leave.

**Leave Calendar:** the **Leave Calendar** menu shows everyone on approved leave
for a chosen month (managers see only their team).

**Leave types & policy** are configured in **Settings → Leave Types** (name, code,
annual quota, and whether it's paid). **Attendance reports** also show **Late Days**
and **Overtime (OT) hours**, derived automatically from clock-in/out vs the shift.

**Approve straight from your email:** when an employee applies, the approver
(their manager, plus HR/Finance/Super Admin) gets an email with **Approve** and
**Reject** buttons. Clicking one decides the request without logging in. These
buttons work when the app is reachable from the device opening the email — i.e.
on the same computer/network now, or from anywhere once the app is deployed
online (see SETUP_GUIDE).

### Reimbursement
See all reimbursement claims and the uploaded bills (click **View**).
**Approve** or **Reject** each one. Approved amounts are added to that month's
payslip. The employee is emailed the result.

### Payroll
1. Pick a **Month**.
2. Click **Generate / Recalculate**. The system calculates each person's salary
   based on attendance and approved leave.
3. For each employee you can download the **PDF payslip** or **Email** it to them.

How salary is calculated:
- Per-day salary = monthly gross ÷ working days (or calendar days — your choice in Settings).
- Absent days and unpaid-leave days are deducted as **Loss of Pay** (you control this in Settings).
- Approved paid leave and company holidays are **not** deducted.
- Approved reimbursements for the month are added to the net amount.

### Salary structure (CTC breakup)
On the Employees list, **Salary** lets Finance define each person's monthly
components — **Basic, HRA, Special Allowance**, etc. (use **Auto-generate breakup**
to split a gross figure instantly) plus any custom deductions. The total of the
earnings is the monthly gross.

### Statutory deductions
On each payslip the system auto-calculates **PF** (12% of Basic, capped),
**ESI** (0.75% of gross if gross ≤ ₹21,000) and **Professional Tax** (flat). Turn
these on/off and set the rates in **Settings → Statutory Deductions**.

### Loans & Advances
Under **Loans & Advances**, Finance records a loan/advance with a **monthly EMI**;
that EMI is automatically deducted on the employee's payslip while the loan is Active.

### Payroll run approval
A month's payroll is **Draft** until you click **Approve Payroll**, which **locks**
it (no accidental regeneration). Use **Unlock** to reopen it for changes. Payslips
are fully **itemized** (all earnings and deductions) in the PDF.

### Reports
Monthly **attendance summary** (present/half/leave/absent per employee) and a
**payroll summary** with company-wide totals.

### Settings → Modules (turn sections on/off)
In **Settings** there's a **Modules** panel. Tick/untick sections you don't use —
Directory, Notice Board, Holidays, Recognition, Performance, Surveys, Helpdesk,
Assets, Loans & Advances, Reimbursements — and they disappear from everyone's
menu. Core HR (Employees, Attendance, Leave, Payroll) is always on. Save and the
menu reloads.

### Settings → Slack Attendance (mark attendance from Slack)
Instead of giving everyone a login to clock in, you can pull attendance from your
Slack channel where staff post daily:
1. Create a Slack app at api.slack.com → add a **Bot token** with scopes
   **channels:history**, **users:read**, **users:read.email**; install it and
   **invite the bot to your attendance channel**.
2. In **Settings → Slack Attendance**, enable it and paste the **Bot token** and
   **Channel ID** (and tweak the Leave/Half keywords if needed). Save.
3. On the **Attendance** page → **Import Attendance → Option 3: Sync from Slack**,
   pick the date and click **Sync from Slack**.

Anyone who posted in the channel that day is marked **Present** (their first post
time becomes clock-in); messages containing a *leave* keyword mark **On Leave**,
and *half-day* keywords mark **Half**. Employees are matched by their **Slack
email = their HR email** (or set a Slack Member ID on the employee record).

### Recognition (shoutouts)
Anyone can post a **Shoutout** with a badge (Star Performer, Team Player, …) and
message — with a confetti celebration. Colleagues can **Cheer** (👏) a shoutout,
and the **Wall of Fame** ranks the most-recognised people each month.

### Settings
Company details (name, legal name, GST/CIN/PAN, email, phone, website, address,
logo, currency, salary-slip footer), attendance rules (working hours and days,
weekend policy), leave policy, and salary rules (per-day basis, payroll closing
day, what to deduct). These feed into payslips and payroll. Save changes before
leaving the page.

---

## Employee features

### Dashboard
A live clock with **Check In** and **Check Out** buttons, remaining leave
balance, and recent payslips.

### My Attendance
**Mark your attendance here** using the **Clock In** and **Clock Out** buttons in
the "Mark Today's Attendance" card (also on your Dashboard).

How the day is decided (based on the company shift, default 10:00 AM–7:00 PM = 9 hrs):
- **Clock In** is allowed only until **shift start + grace** (default until **10:30 AM**). After that the button is disabled and you must raise a request.
- **Clock Out** records your hours, and the day is marked automatically:
  - worked **≥ 9 hrs → Present**
  - worked **≥ 4.5 hrs → Half Day**
  - worked **< 4.5 hrs → Absent**

If you **missed the clock-in window**, **forgot to mark**, or need a **half-day**
for a past day, click **Raise Attendance Request** — your manager/HR approves or
rejects it, and approved requests update the day automatically. (Self clock-in/out
only works for *today*, so attendance can't be back-dated without approval.)

Admins/managers see and approve these under the **Attendance Requests** menu, and
can set the shift times, grace minutes, and full/half-day hours in **Settings →
Attendance**.

### Leave
Apply for leave and track whether each request is pending, approved, or rejected.
Your **balance cards** show remaining days per type. You can:
- pick any **leave type** your company configured (Casual, Sick, Earned, Comp-off, Unpaid, …),
- tick **Half day** for a single-date half-day leave (counts as 0.5),
- apply **Comp-off** using credits your manager/HR granted you.
Paid leave types and company holidays are never deducted from salary.

### Reimbursement
Submit an expense claim with an optional bill/receipt upload, and track its
status.

### My Payslips
Download any of your payslips as a PDF.

### My Profile
View your details and **change your password**.

---

## Tips
- The very first time an employee logs in with a temporary password, they are
  asked to set a new one.
- If email is turned off, approvals and payslips still work inside the app — only
  the email notification is skipped.
- Back up the `data` and `uploads` folders regularly.
