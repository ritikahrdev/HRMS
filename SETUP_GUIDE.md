# HR Software — Setup Guide (for non-technical users)

This guide explains, step by step, how to start and use the HR software on a
Windows computer. No coding knowledge is needed. Just follow each step.

---

## What you need (one time)

The software needs a free program called **Node.js** to run. You only install
this once.

1. Open your web browser and go to: **https://nodejs.org**
2. Click the big button that says **"LTS"** (it means the stable version).
3. Open the downloaded file and click **Next → Next → Install** (accept all defaults).
4. When it finishes, click **Finish**.

That's it. You do not need to understand what it does.

---

## Starting the software

1. Open the **hr-software** folder.
2. Double-click the file named **`start.bat`**.
   - A black window will open. This is normal.
   - The **first time only**, it will say "installing components" and take 1–2 minutes.
   - After that it will say *"HR Software is running!"*
3. Your web browser will open automatically at **http://localhost:4000**.
   - If it doesn't, open your browser and type that address yourself.

> **Important:** Keep the black window open while you use the software.
> To stop the software, simply close that black window.

---

## Logging in the first time

Use the built-in administrator account:

- **Email:** `admin@company.local`
- **Password:** `Admin@12345`

> **Please change this password** after your first login
> (click your name area → Profile is for employees; for admin, you can keep it
> or change it later — see below). For safety, change it soon.

---

## First things to do as Admin

1. Go to **Settings** (left menu):
   - Type your **Company Name**, **Address**, and upload your **Logo**.
   - Set your **Working Hours** and tick your **Working Days**.
   - Set your **Leave Policy** (how many casual / sick / earned leaves per year).
   - Set your **Salary Rules** (how absent days reduce salary).
   - Click **Save Settings**.

2. Add your employees, either:
   - **One by one:** go to **Employees → Add Employee**, or
   - **All at once from Excel:** go to **Import Excel** (see next section).

---

## Importing employees from Excel

1. Click **Import Excel** in the left menu.
2. Click **Download Template** and open the file in Excel.
3. Fill in your employees (one per row). Keep the column titles as they are.
4. Save the file, come back, and click **Choose File** to upload it.
5. The screen shows every row and **highlights anything missing or wrong**
   (for example a missing salary or a duplicate email).
6. Fix any red issues **directly in the table** on screen.
7. Click **Import These Employees**. Done!

Each employee with an email gets a **login account** automatically and (if email
is set up) receives a welcome message with a temporary password.

---

## Setting up email (optional)

Email is **off by default**, and everything still works without it — the system
just records what *would* have been sent. To actually send emails (welcome
messages, leave decisions, payslips, etc.):

1. Open the file **`config.json`** in the hr-software folder (use Notepad).
2. Find the `"email"` section and change:
   - `"enabled": false` → `"enabled": true`
   - Fill in your email provider details (`host`, `port`, `user`, `pass`, `from`).
   - For **Gmail**, you must create an **App Password** (Google Account →
     Security → 2-Step Verification → App passwords) and use that as `pass`.
3. Save the file and restart the software (close the black window, double-click
   `start.bat` again).

**Gmail app password (most common):** Gmail won't accept your normal password.
Go to your Google Account → **Security** → turn on **2-Step Verification** →
then **App passwords** → create one for "Mail". Use that 16-character code as
`pass` in `config.json`.

**Approve/Reject from email links:** approval emails contain Approve/Reject
buttons. They open a link back to this app, so the link must be reachable from
wherever you read the email. On the same PC it works immediately. For your phone
or another computer, the app must be reachable on your network or deployed online
(see "Letting your team use it"). When you deploy, set `"publicUrl"` in
`config.json` to your real address (e.g. `https://hr.yourcompany.com`) so the
links point there instead of `localhost`.

---

## Common questions

**Q: I closed the window by mistake.**
Just double-click `start.bat` again. Your data is safe.

**Q: Where is my data stored?**
In the `data` folder (file `hr.db`). Uploaded bills and logos are in `uploads`.
**Back up these two folders** to keep your data safe.

**Q: It says the address is already in use / port 4000.**
The software is probably already running in another window. Close extra black
windows and try again.

**Q: How do I move it to another computer?**
Copy the whole `hr-software` folder (including `data` and `uploads`). Install
Node.js on the new computer and run `start.bat`.

**Q: Can others on my office network use it?**
Yes. On the computer running it, find its IP address (e.g. 192.168.1.20) and
others can open `http://192.168.1.20:4000` in their browser, as long as they are
on the same network.

---

See **USER_GUIDE.md** for how to use each feature day to day.
