# Goyal Attendance + Salary App

Premium static PWA app for Attendance, Break Out/In, Leave Apply, Salary View and Admin Panel.

## Features

### Employee Panel
- Employee login by Employee Code + Password
- Punch In with GPS + Selfie
- Punch Out with GPS + Selfie
- Break Out / Break In with GPS
- Leave Apply + status view
- My Salary view
- Salary Slip print/download as PDF
- Attendance history

### Admin Panel
- Admin login
- Employee add/deactivate
- Employee type: Office / Godown / Field
- Office employee: fixed timing rules ON
- Godown employee: no late/11 AM half-day timing restriction
- Field employee: geofence OFF, GPS capture ON
- Attendance report with selfie links
- Leave approve/reject
- Salary advance / deduction entry
- Office/Godown location add
- Attendance settings

## Default Admin Login

Email: `admin@goyalattendance.com`  
Password: `admin123`

Password ko production me change karna.

## Supabase Project

This project is already connected to:

```js
SUPABASE_URL = 'https://ojcrfdebmwekxvfgtixs.supabase.co'
SUPABASE_ANON_KEY = 'sb_publishable_jBUljE6iZcXkaadGMP77iw_yJvnkzhL'
```

> Service Role key kabhi frontend code me mat dalna.

## How to Run Locally

Because this is a static app, direct `index.html` bhi open ho sakta hai, but camera/GPS/PWA ke liye local server better hai.

```bash
npx serve .
```

Then open the local URL in browser.

## Vercel Deploy

1. Is folder ko GitHub repository me upload karo.
2. Vercel dashboard open karo.
3. Import GitHub repo.
4. Framework preset: Other / Static.
5. Deploy.

After deploy, Vercel free URL dega, example:

`https://goyal-attendance.vercel.app`

Mobile Chrome me open karke **Add to Home Screen** karo.

## Important Security Note

Current MVP me employees/admin passwords plain text table me stored hain. Testing ke liye okay hai, lekin final production se pehle:

- Supabase Auth use karo
- RLS policies secure karo
- Password hashing/auth flow implement karo
- Storage policies employee/admin based secure karo
- Admin role permissions tighten karo

## Required Supabase Tables

Your Supabase must have these tables:

- office_locations
- employees
- admin_users
- attendance_rules
- leave_requests
- attendance_records
- salary_advances
- salary_deductions
- monthly_salary_records
- salary_slips
- correction_requests
- holidays
- audit_logs
- break_records

## Required Buckets

- attendance-selfies
- salary-slips



## Live Camera Selfie Security

- Punch In aur Punch Out me gallery/file upload option disabled hai.
- Browser live camera stream (`getUserMedia`) se selfie capture hoti hai.
- Selfie par employee name/code, punch type, date/time, GPS aur location label ka watermark lagta hai.
- Upload se pehle image canvas par resize/compress hoke JPEG format me Supabase `attendance-selfies` bucket me save hoti hai.
- Break Out/Break In me GPS capture hota hai; selfie optional future setting ke liye rakhi ja sakti hai.


## Role Permission Update
- HR/Admin cannot access Settings or Locations.
- Only Super Admin/Owner can change attendance rules, location, radius, and system settings.
