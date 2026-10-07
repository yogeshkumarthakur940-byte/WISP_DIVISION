# ⚡ Wisp Division
Esports organisation website with **sign up / login**, an **admin dashboard that edits everything**, trial applications and a members-only payout area.
Zero npm dependencies · Node.js 18+ · data stored in `data/*.json`.

## Run
```
node server.js        # open http://localhost:3000
node test.js          # 33 automated tests
```
**Admin login:** click **Login** and type your Admin ID + password in the same box team members use (members type their email). Whoever logs in with them can edit everything.
Set them with environment variables `ADMIN_ID` and `ADMIN_KEY`, or copy `admin.local.example.js` to `admin.local.js` and edit it (that file is git-ignored). If neither is set, the site asks you to create the admin on first run using the setup code printed in the server console.

## Roles
- **Guest:** view the site, apply for a trial, check a result by Application ID
- **Pending:** signed up, waiting for approval
- **Member:** everything above + weekly payouts
- **Admin:** edit everything, review applications, approve members

## Deploy (GitHub Pages cannot run this: it needs Node)
Use Render (free): **New + → Blueprint** (uses `render.yaml`) or **New + → Web Service** with start command `node server.js`. Set `ADMIN_ID`, `ADMIN_KEY`, `COOKIE_SECURE=1`.
Free hosting erases `data/` on restart. For permanent data add a persistent disk and set `DATA_DIR` to its path.

## Admin dashboard (Login → Admin button)
Settings (incl. About, social links, **open/close trials**) · Games · Roster · Matches · **News** · **Achievements** · Applications · **Messages** inbox · Payments · FAQ · Users (approve members)

## Trials
Applicants choose a role (Rusher, Secondary Rusher, Nader, Sniper), say if they can be IGL (Yes/No) and give a mobile number (admin-only). Every applicant appears on the public **Results board** as 🟡 Pending, 🟢 Selected or 🔴 Not Selected. Admins must write a reason (min 5 characters) when declaring a result; it is shown publicly. Application IDs and mobile numbers are never shown publicly.

## Security built in
- Passwords hashed with scrypt, HttpOnly + SameSite=Strict session cookie, 8+ char minimum
- Rate limits on login, sign-up, applications and result lookups
- Every field is whitelisted, length-limited and enum-checked on the server (clients can't inject extra data)
- Applicants can't self-select (status is forced to Pending); IDs can't be overwritten
- Discord webhook is stored privately and fired by the server (never sent to visitors)
- CSRF header check, CSP and security headers; last admin can't be demoted
- Password hashes never leave the server; admin credentials live in a git-ignored file / env vars, and logins are rate-limited
- First-run setup is protected by a one-time code shown only in the server console

## Structure
```
server.js     API, roles, validation      lib/db.js    JSON file database
lib/auth.js   hashing + sessions          lib/seed.js  default content (first run)
public/index.html   the site + admin      test.js      automated tests
```
Deploying: any Node host (Render, Railway, VPS). Keep the `data/` folder on a persistent disk and back it up.
