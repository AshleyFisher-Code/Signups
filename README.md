# Sign-ups

Ashley's own SignUpGenius alternative. Guests open a link on their phone, tap, type a name, and they're done. Nobody signs in. Each sign-up closes automatically at the time you set and moves to your Archive.

**Three kinds of sign-up**
- **Things to bring & time slots**: potluck dishes, supplies, volunteer shifts. Paste a list; `x2` means two people can take an item; lines ending in `:` become headings; a line that starts with `9:30-10:30` becomes a time slot.
- **Headcount RSVP**: a name (e.g. "Player name") plus how many are coming, with a running total. You can set an optional overall limit.
- **Find a date**: guests answer Yes / Maybe / No for each date. When you tap **Pick this date**, everyone who can make it gets a calendar invite.

**On every sign-up**
- Optional email for guests. The confirmation includes a real calendar invite. If you change the time or place, the invite on their calendar updates itself. If they cancel, or you remove them, it comes off their calendar.
- Extra questions (allergies, jersey #, …), a waitlist that moves people up automatically, and reminder emails 1–7 days before.
- Names shown to guests or hidden (your choice). Guests never see each other's emails.
- Print sheet with blank lines for open spots. CSV download. **Copy results as text** to paste to Claude or into an email.

| Page | Address |
|---|---|
| Your organizer screens | `signup.ashleyfisher.com/admin` |
| A guest link | `signup.ashleyfisher.com/brunch` (you choose the end) |

---

## One-time setup (about 30 minutes)

### 1. Firebase project
1. Go to https://console.firebase.google.com → **Add project** → name it `ashley-signups`. If that ID is taken, use whatever ID Firebase gives you and replace `ashley-signups` in `.firebaserc` and `public/js/config.js`. Skip Google Analytics.
2. Click **Upgrade**, choose the **Blaze** plan, and pick the billing account you already use for Burke's apps. Family-scale use stays inside the free allowance. Set a $5 budget alert to be safe.
3. **Build → Firestore Database → Create database** → location **us-east4 (Northern Virginia)** → start in **production mode**.
4. **Build → Authentication → Get started → Email/Password → Enable**. Then **Users → Add user** with `ashley@ashleyfisher.com` and a password. That's your organizer login.
5. **Project settings (gear) → Your apps → Web (</>)** → nickname `signups` → **Register**. Copy the `firebaseConfig` values into `public/js/config.js`, or just send them to Claude.

### 2. Resend (the email sender)
1. Sign up at https://resend.com with ashley@ashleyfisher.com.
2. **Domains → Add domain** → `ashleyfisher.com`. Resend shows 3–4 DNS records (TXT/MX on `send.` and `resend._domainkey`). Add them wherever ashleyfisher.com's DNS is managed, usually your registrar or WordPress host. They don't touch your website or your existing email.
3. Once the domain shows **Verified**, go to **API Keys → Create** (sending access) and copy the key.

### 3. Deploy (on your computer, in Terminal)
```sh
# once: install Node 22 from nodejs.org, then
npm install -g firebase-tools
firebase login

# in this folder
cd functions && npm install && cd ..
firebase functions:secrets:set RESEND_API_KEY      # paste the Resend key
firebase deploy
```
The first deploy takes a few minutes, and Google may ask you to enable a few APIs (click yes).

### 4. Your address
**Firebase console → Hosting → Add custom domain** → `signup.ashleyfisher.com` → add the DNS records it shows (same place as step 2.2). Then go to **Authentication → Settings → Authorized domains** and add `signup.ashleyfisher.com`. HTTPS turns on by itself within an hour.

Until the domain is live, the app also works at `https://ashley-signups.web.app/admin`.

---

## Using it
1. Brainstorm the list with Claude, then paste it into **New sign-up → The list**. The preview shows exactly what guests will see.
2. Tap **Share link** and send it by text or email.
3. Watch it fill in live. **Print** gives you a sheet for the event. **More → Copy results as text** is for sharing with Claude or anyone else.
4. At the closing time it archives itself. Open **Archive** to look back. **Reopen** if you need to.

## For Claude / developers
- `functions/`: Cloud Functions (region us-east4). Guests write only through these: `submit`, `lookup`, `cancel`. You remove people with `adminRemove`. `onSignupUpdated` sends updated or cancelled invites and moves the waitlist up. `tick` runs every 15 minutes to archive sign-ups and send reminders.
  - `lib/logic.js`: validation, spot allocation, waitlist, invite contents. `lib/ics.js`: calendar files. `lib/email.js`: email text plus the Resend call. `config.js`: addresses.
- `firestore.rules`: public can read a sign-up and its names. Only the host can read emails/answers or edit. Nobody writes guest data directly. The admin email is listed here **and** in `functions/config.js`.
- `public/`: plain HTML/JS, no build step. `guest.html` serves every `/<link>`. `admin.html` holds the organizer screens. `print.html` is the print sheet.
- Tests: `node tests/test.mjs` (rules, invites, list parsing). `tests/run-ui.sh` is a full phone walkthrough against an in-memory stand-in for Firebase (`tests/fake/`), with screenshots in `tests/shots/`.
