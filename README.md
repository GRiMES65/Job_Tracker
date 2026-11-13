# Tech Sales Pipeline

A private, spreadsheet-style job application tracker. Built with vanilla JavaScript and [Vite](https://vite.dev), with [Supabase](https://supabase.com) for authentication and a Postgres database, and deployed on [Vercel](https://vercel.com).

## Features

- Email and password sign-in for a single owner. Public sign-ups are disabled.
- An inline-editable grid with sorting, search and a stage filter.
- A weekly application goal, a response rate, and follow-up reminders that turn amber when due soon and red when overdue.
- Follow-up dates that fill in automatically 7 days after you apply.
- CSV export and import.

## Security

- **Row Level Security** in Postgres (`supabase/schema.sql`) means a signed-in user can only read or change their own rows, and logged-out visitors get no access at all.
- The app only uses Supabase's **publishable key**, which is designed to be public. The secret / `service_role` key is never used here and must never be added.
- Keys live in environment variables (`.env.local` locally, Vercel settings in production). `.env*` files are git-ignored.
- Security headers (CSP, no framing, nosniff) and `noindex` are set in `vercel.json`.

## Setup

### 1. Supabase

1. Create a new project at supabase.com.
2. Go to **SQL Editor → New query**, paste in the contents of `supabase/schema.sql`, and click **Run**. If you ran an older copy of `schema.sql` before Base, OTE and Size became ranges, also run `supabase/migrations/002_ranges.sql`. If you ran it before rows could be dragged into order, also run `supabase/migrations/003_row_order.sql`.
3. Go to **Authentication → Sign In / Providers**, turn **off** "Allow new users to sign up", and leave Email enabled.
4. Go to **Authentication → Users → Add user → Create new user**. Enter your email and a strong password, and tick **Auto Confirm User**.
5. Go to **Project Settings → API Keys** and copy the **publishable** key. The Project URL is under **Project Settings → Data API**, or on the project's home page.

### 2. Run locally

```bash
cp .env.example .env.local      # on Windows PowerShell: copy .env.example .env.local
# open .env.local and paste in your URL and publishable key
npm install
npm run dev
```

Open the address it prints (usually http://localhost:5173) and sign in.

### 3. Moving data over from the old tracker

In the old tracker, click **Export CSV**. In this app, click **Import CSV** and choose that file.

## Project structure

```
index.html            page shell (login + tracker)
src/main.js           auth, data loading/saving, grid rendering
src/csv.js            CSV parse/export helpers
src/range.js          parses/formats ranges like "80k-95k" for Base, OTE, Size
src/style.css         styles (light + dark)
supabase/schema.sql   table, Row Level Security policies, triggers
vercel.json           security headers
```
