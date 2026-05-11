/*
  Goyal Attendance + Salary App
  Static PWA + Supabase MVP
  Important: Publishable key is safe for browser. Never use Service Role key here.
*/
const SUPABASE_URL = 'https://rpqdlfhjnbexblrqsshk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_jBUljE6iZcXkaadGMP77iw_yJvnkzhL';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const DEFAULT_ADMIN_EMAIL = 'admin@goyalattendance.com';
const DEFAULT_ADMIN_PASSWORD = 'Ansh1@superadmin';
function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}
function currentAdminId() {
  return isUuid(state?.user?.id) ? state.user.id : null;
}

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');

const state = {
  user: JSON.parse(localStorage.getItem('goyal_user') || 'null'),
  role: localStorage.getItem('goyal_role') || null,
  page: localStorage.getItem('goyal_page') || 'dashboard',
  attendanceRules: null,
  locations: [],
  todayAttendance: null,
  openBreak: null,
};

const employeeNav = [
  ['dashboard', '🏠', 'Dashboard'],
  ['punch', '⏱️', 'Punch'],
  ['break', '☕', 'Break'],
  ['leave', '📝', 'Leave'],
  ['salary', '💰', 'Salary'],
  ['history', '📊', 'History'],
];

const adminNav = [
  ['dashboard', '📈', 'Dashboard'],
  ['employees', '👥', 'Employees'],
  ['attendance', '🕒', 'Attendance'],
  ['leaves', '📝', 'Leaves'],
  ['salary', '💰', 'Salary'],
  ['locations', '📍', 'Locations'],
  ['settings', '⚙️', 'Settings'],
];

function isSuperAdmin() {
  return state.role === 'admin' && String(state.user?.role || '').toLowerCase() === 'super_admin';
}

function getAdminNav() {
  // HR/Admin cannot change Settings or Location controls.
  if (isSuperAdmin()) return adminNav;
  return adminNav.filter(([key]) => !['locations', 'settings'].includes(key));
}

function noPermissionPage(title = 'Access Denied') {
  layout(title, 'This section is restricted to Owner / Super Admin access.', `
    <div class="card">
      <div class="empty">
        <b>Permission blocked.</b><br>
        HR/Admin users cannot change timing rules, location radius, or system settings.
        Please use an Owner / Super Admin account for this action.
      </div>
      <br>
      <button class="primary-btn" id="backDashboard">Go to Dashboard</button>
    </div>`);
  document.getElementById('backDashboard')?.addEventListener('click', () => {
    state.page = 'dashboard';
    localStorage.setItem('goyal_page', state.page);
    render();
  });
}

function showToast(message, type = 'success') {
  toastEl.textContent = message;
  toastEl.className = `toast ${type}`;
  setTimeout(() => toastEl.classList.add('hidden'), 3800);
}

function setLoading(btn, isLoading, label) {
  if (!btn) return;
  if (isLoading) {
    btn.dataset.oldHtml = btn.innerHTML;
    btn.innerHTML = `<span class="loader"></span> ${label || 'Please wait...'}`;
    btn.disabled = true;
  } else {
    btn.innerHTML = btn.dataset.oldHtml || btn.innerHTML;
    btn.disabled = false;
  }
}

function localDateISO(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function fmtDate(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtTime(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function fmtDateTime(dateStr) {
  if (!dateStr) return '-';
  return `${fmtDate(dateStr)} • ${fmtTime(dateStr)}`;
}

function money(num) {
  const value = Number(num || 0);
  return value.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
}

function minutesToHM(minutes) {
  const m = Number(minutes || 0);
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return `${h}h ${r}m`;
}

function parseTimeToMinutes(t) {
  if (!t) return 0;
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
}

function minutesOfDate(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}

function statusClass(status) {
  const s = String(status || '').toLowerCase();
  if (s.includes('present') || s === 'approved' || s === 'active') return 'pill-present';
  if (s.includes('late') || s === 'pending' || s === 'open' || s.includes('short')) return 'pill-late';
  if (s.includes('half') || s === 'rejected' || s === 'inactive' || s.includes('absent')) return 'pill-half_day';
  if (s.includes('field')) return 'pill-field';
  if (s.includes('godown')) return 'pill-godown';
  return 'pill-info';
}

function badge(text) {
  return `<span class="status-pill ${statusClass(text)}">${text || '-'}</span>`;
}

async function loadRules() {
  const { data, error } = await supabaseClient.from('attendance_rules').select('*').limit(1).maybeSingle();
  if (!error) state.attendanceRules = data;
}

async function loadLocations() {
  const { data, error } = await supabaseClient.from('office_locations').select('*').eq('status', 'active').order('created_at', { ascending: false });
  state.locations = error ? [] : (data || []);
}

async function getLocation() {
  if (!navigator.geolocation) throw new Error('Location is not supported on this device.');
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => reject(new Error('Please allow location permission.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (v) => (Number(v) * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function assignedLocationForEmployee(emp = state.user) {
  if (!emp?.assigned_location_id) return null;
  return state.locations.find((l) => l.id === emp.assigned_location_id) || null;
}

function checkGeofence(emp, loc) {
  if (!emp?.geofence_required) return { ok: true, note: 'Field/flexible GPS captured' };
  const assigned = assignedLocationForEmployee(emp);
  if (!assigned) return { ok: true, note: 'No assigned location set, GPS only captured' };
  const d = distanceMeters(loc.latitude, loc.longitude, assigned.latitude, assigned.longitude);
  const allowed = Number(assigned.allowed_radius_meter || 100);
  return { ok: d <= allowed, distance: Math.round(d), allowed, assigned };
}

function safeText(value) {
  return String(value || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function assignedLocationLabel(emp = state.user) {
  const assigned = assignedLocationForEmployee(emp);
  if (assigned?.location_name) return assigned.location_name;
  if (emp?.employee_type === 'field') return 'Field GPS';
  return emp?.employee_type || 'Location';
}

async function captureLiveSelfie({ punchType = 'Punch', loc, status = '' } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Live camera is not supported. Please use Chrome or Edge on mobile.');
  }

  const overlay = document.createElement('div');
  overlay.className = 'camera-overlay';
  overlay.innerHTML = `
    <div class="camera-box">
      <div class="camera-head">
        <div>
          <h3>Live Selfie Required</h3>
          <p>Gallery upload is disabled for ${safeText(punchType)}.</p>
        </div>
        <button type="button" class="camera-close" aria-label="Close camera">×</button>
      </div>
      <div class="camera-frame">
        <video class="live-video" autoplay playsinline muted></video>
        <div class="camera-watermark-preview">
          <b>${safeText(state.user?.name)} | ${safeText(state.user?.employee_code)}</b><br>
          ${safeText(punchType)} • GPS + Time Auto
        </div>
      </div>
      <div class="camera-actions">
        <button type="button" class="ghost-btn cancel-camera">Cancel</button>
        <button type="button" class="primary-btn capture-camera">📸 Capture Live Selfie</button>
      </div>
      <p class="camera-note">The photo will be compressed before upload. Gallery upload is intentionally disabled.</p>
    </div>`;
  document.body.appendChild(overlay);

  const video = overlay.querySelector('video');
  const closeBtn = overlay.querySelector('.camera-close');
  const cancelBtn = overlay.querySelector('.cancel-camera');
  const captureBtn = overlay.querySelector('.capture-camera');
  let stream;

  const cleanup = () => {
    try { stream?.getTracks()?.forEach((track) => track.stop()); } catch (_) {}
    overlay.remove();
  };

  return new Promise(async (resolve, reject) => {
    const fail = (err) => { cleanup(); reject(err instanceof Error ? err : new Error(String(err || 'Camera failed'))); };
    closeBtn.addEventListener('click', () => fail(new Error('Selfie capture cancel ho gaya.')));
    cancelBtn.addEventListener('click', () => fail(new Error('Selfie capture cancel ho gaya.')));
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 1280 } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
    } catch (err) {
      fail(new Error('Please allow camera permission. Gallery upload is not allowed.'));
      return;
    }

    captureBtn.addEventListener('click', () => {
      try {
        const videoW = video.videoWidth || 640;
        const videoH = video.videoHeight || 800;
        const targetW = 640;
        const targetH = Math.round(targetW * (videoH / videoW));
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, targetW, targetH);

        const now = new Date();
        const lines = [
          `${state.user?.name || 'Employee'} | ${state.user?.employee_code || ''}`,
          `${punchType} • ${status || 'GPS Captured'}`,
          `${now.toLocaleDateString('en-IN')} • ${now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}`,
          `${assignedLocationLabel()} • Lat ${Number(loc?.latitude || 0).toFixed(6)}, Long ${Number(loc?.longitude || 0).toFixed(6)}`,
        ];

        const pad = 18;
        const lineH = 24;
        const boxH = pad * 2 + lineH * lines.length;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
        ctx.fillRect(0, targetH - boxH, targetW, boxH);
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 18px Arial';
        lines.forEach((line, i) => {
          ctx.font = i === 0 ? '800 20px Arial' : '700 16px Arial';
          ctx.fillText(line, pad, targetH - boxH + pad + 18 + i * lineH);
        });

        canvas.toBlob((blob) => {
          if (!blob) { fail(new Error('Photo compression failed.')); return; }
          blob.name = `${punchType.toLowerCase().replace(/\s+/g, '-')}.jpg`;
          cleanup();
          resolve(blob);
        }, 'image/jpeg', 0.68);
      } catch (err) { fail(err); }
    });
  });
}

async function uploadSelfie(file, type) {
  if (!file) return null;
  const path = `${state.user.id}/${localDateISO()}-${type}-${Date.now()}.jpg`;
  const { error } = await supabaseClient.storage.from('attendance-selfies').upload(path, file, { upsert: true, contentType: 'image/jpeg' });
  if (error) throw error;
  return path;
}

async function signedPhoto(path) {
  if (!path) return '';
  if (String(path).startsWith('http')) return path;
  const { data, error } = await supabaseClient.storage.from('attendance-selfies').createSignedUrl(path, 60 * 60);
  return error ? '' : data.signedUrl;
}

function currentMonthRange(monthInput) {
  const now = new Date();
  const [y, m] = (monthInput || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`).split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const endDate = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2, '0')}-${String(endDate).padStart(2, '0')}`;
  return { y, m, start, end, days: endDate, label: new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) };
}

function daysElapsedInMonth(y, m) {
  const today = new Date();
  if (today.getFullYear() === y && today.getMonth() + 1 === m) return today.getDate();
  return new Date(y, m, 0).getDate();
}

function shouldDeductAutoLunch(punchIn, punchOut) {
  if (!state.attendanceRules || !punchIn || !punchOut) return 0;
  const start = parseTimeToMinutes(state.attendanceRules.lunch_start_time || '14:00');
  const end = parseTimeToMinutes(state.attendanceRules.lunch_end_time || '14:40');
  const inM = minutesOfDate(new Date(punchIn));
  const outM = minutesOfDate(new Date(punchOut));
  return inM < end && outM > start ? Math.max(0, end - start) : 0;
}

function calculateInitialStatus(emp, punchTime = new Date()) {
  const rules = state.attendanceRules;
  if (!emp.time_restriction_enabled || emp.attendance_policy !== 'fixed_time') {
    return { status: 'present', deduction: 0, note: 'Flexible timing: late rule was not applied' };
  }
  const nowMin = minutesOfDate(punchTime);
  const grace = parseTimeToMinutes(rules?.grace_time || '10:40');
  const half = parseTimeToMinutes(rules?.half_day_after_time || '11:00');
  const lateDeduction = Number(rules?.late_deduction_amount || 50);
  if (nowMin > half) return { status: 'half_day', deduction: 0, note: 'Punch In after 11:00 AM' };
  if (nowMin > grace) return { status: 'late', deduction: lateDeduction, note: `Late after ${rules?.grace_time || '10:40'}` };
  return { status: 'present', deduction: 0, note: 'On time / grace time' };
}

function calculateFinalStatus(emp, record, breakMinutes) {
  const gross = Math.max(0, Math.round((new Date(record.punch_out_time) - new Date(record.punch_in_time)) / 60000));
  const autoLunch = breakMinutes > 0 ? 0 : shouldDeductAutoLunch(record.punch_in_time, record.punch_out_time);
  const breakDeducted = breakMinutes > 0 ? breakMinutes : autoLunch;
  const allowedLunch = parseTimeToMinutes(state.attendanceRules?.lunch_end_time || '14:40') - parseTimeToMinutes(state.attendanceRules?.lunch_start_time || '14:00');
  const extraBreak = breakMinutes > 0 ? Math.max(0, breakMinutes - allowedLunch) : 0;
  const net = Math.max(0, gross - breakDeducted);
  const minimum = Number(state.attendanceRules?.minimum_working_minutes || 480);
  let final = record.initial_status || 'present';
  let note = record.rule_note || '';
  let dayCount = final === 'half_day' ? 0.5 : 1;
  if (emp.minimum_hours_enabled && net < minimum) {
    final = emp.time_restriction_enabled ? 'half_day_short_working' : 'short_working';
    dayCount = 0.5;
    note = `Net working time is ${minutesToHM(net)}, below the required minimum of ${minutesToHM(minimum)}`;
  } else if (record.initial_status === 'late') {
    final = 'late_present';
    dayCount = 1;
  } else if (record.initial_status === 'half_day') {
    final = 'half_day';
    dayCount = 0.5;
  } else {
    final = 'present';
    dayCount = 1;
  }
  return { gross, breakDeducted, extraBreak, net, final, dayCount, note };
}

async function todayAttendance() {
  const { data, error } = await supabaseClient
    .from('attendance_records')
    .select('*')
    .eq('employee_id', state.user.id)
    .eq('attendance_date', localDateISO())
    .maybeSingle();
  state.todayAttendance = error ? null : data;
  return state.todayAttendance;
}

async function openBreakRecord() {
  if (!state.todayAttendance) return null;
  const { data, error } = await supabaseClient
    .from('break_records')
    .select('*')
    .eq('employee_id', state.user.id)
    .eq('attendance_id', state.todayAttendance.id)
    .eq('status', 'open')
    .maybeSingle();
  state.openBreak = error ? null : data;
  return state.openBreak;
}

function loginPage() {
  const validModes = ['employee-login', 'admin-login', 'super-admin-login'];
  let selected = localStorage.getItem('goyal_login_mode') || 'employee-login';
  if (!validModes.includes(selected)) selected = 'employee-login';

  const modeInfo = {
    'employee-login': { title: 'Employee Login', roleLabel: 'Employee', icon: '👤', fieldLabel: 'Employee Code', fieldName: 'employee_code', fieldPlaceholder: 'Enter employee code', inputType: 'text' },
    'admin-login': { title: 'Admin Login', roleLabel: 'Admin', icon: '🧑‍💼', fieldLabel: 'Admin Email', fieldName: 'email', fieldPlaceholder: 'Enter admin email', inputType: 'email' },
    'super-admin-login': { title: 'Super Admin Login', roleLabel: 'Super Admin', icon: '👑', fieldLabel: 'Super Admin Email', fieldName: 'email', fieldPlaceholder: 'Enter super admin email', inputType: 'email' },
  };
  const info = modeInfo[selected];
  const isEmployee = selected === 'employee-login';
  const isSuperAdmin = selected === 'super-admin-login';

  app.innerHTML = `
    <main class="clean-login-page">
      <section class="clean-login-shell">
        <div class="clean-brand">
          <div class="clean-logo">G</div>
          <div>
            <h1>Goyal Attendance</h1>
            <p>Attendance • Salary • Leave</p>
          </div>
        </div>

        <div class="clean-login-card">
          <div class="clean-card-head">
            <span class="clean-role-icon">${info.icon}</span>
            <div>
              <h2>${safeText(info.title)}</h2>
              <p>Sign in to continue</p>
            </div>
          </div>

          <div class="role-tabs" aria-label="Login type">
            <button type="button" class="${selected === 'employee-login' ? 'active' : ''}" data-mode="employee-login">Employee</button>
            <button type="button" class="${selected === 'admin-login' ? 'active' : ''}" data-mode="admin-login">Admin</button>
            <button type="button" class="${selected === 'super-admin-login' ? 'active' : ''}" data-mode="super-admin-login">Super Admin</button>
          </div>

          <form id="loginForm" class="form clean-form">
            <div class="form-row">
              <label>${safeText(info.fieldLabel)}</label>
              <input class="input clean-input" name="${safeText(info.fieldName)}" type="${safeText(info.inputType)}" placeholder="${safeText(info.fieldPlaceholder)}" autocomplete="username" required />
            </div>
            <div class="form-row">
              <label>Password</label>
              <input class="input clean-input" name="password" type="password" placeholder="Enter password" autocomplete="current-password" required />
            </div>
            <button class="primary-btn full clean-login-btn" type="submit">Login</button>
          </form>
        </div>
      </section>
    </main>`;

  document.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.onclick = () => {
      localStorage.setItem('goyal_login_mode', btn.dataset.mode);
      loginPage();
    };
  });

  document.getElementById('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    setLoading(btn, true, 'Logging in');
    const fd = new FormData(e.target);
    try {
      if (isEmployee) {
        const code = String(fd.get('employee_code') || '').trim();
        const password = String(fd.get('password') || '').trim();
        const { data, error } = await supabaseClient.from('employees').select('*').eq('employee_code', code).eq('password', password).eq('status', 'active').maybeSingle();
        if (error || !data) throw new Error('Invalid employee code or password, or the account is inactive.');
        state.user = data;
        state.role = 'employee';
        state.page = 'dashboard';
      } else {
        const email = String(fd.get('email') || '').trim().toLowerCase();
        const password = String(fd.get('password') || '').trim();
        const defaultSuperOk = isSuperAdmin && email === DEFAULT_ADMIN_EMAIL && password === DEFAULT_ADMIN_PASSWORD;

        if (defaultSuperOk) {
          let dbAdmin = null;
          try {
            const ownerLookup = await supabaseClient
              .from('admin_users')
              .select('*')
              .ilike('email', DEFAULT_ADMIN_EMAIL)
              .limit(1)
              .maybeSingle();
            dbAdmin = ownerLookup.data || null;
          } catch (lookupErr) {
            console.warn('Default super admin DB lookup skipped:', lookupErr);
          }
          state.user = dbAdmin || {
            id: null,
            name: 'Ankit Goyal',
            email: DEFAULT_ADMIN_EMAIL,
            role: 'super_admin',
            status: 'active'
          };
          state.role = 'admin';
          state.page = 'dashboard';
        } else {
          const { data, error } = await supabaseClient
            .from('admin_users')
            .select('*')
            .ilike('email', email)
            .eq('status', 'active')
            .limit(1)
            .maybeSingle();

          if (error) console.error('Admin login Supabase error:', error);
          if (!data || String(data.password || '').trim() !== password) {
            throw new Error(`Invalid ${isSuperAdmin ? 'Super Admin' : 'Admin'} email or password.`);
          }
          const roleName = String(data.role || '').toLowerCase();
          if (isSuperAdmin && roleName !== 'super_admin') throw new Error('This account does not have Super Admin access.');
          if (!isSuperAdmin && roleName === 'super_admin') throw new Error('Please select the Super Admin login tab for this account.');

          state.user = data;
          state.role = 'admin';
          state.page = 'dashboard';
        }
      }
      localStorage.setItem('goyal_user', JSON.stringify(state.user));
      localStorage.setItem('goyal_role', state.role);
      localStorage.setItem('goyal_page', state.page);
      history.pushState('', document.title, location.pathname + location.search);
      await bootstrap();
      showToast('Login successful');
    } catch (err) {
      showToast(err.message || 'Login failed', 'error');
    } finally {
      setLoading(btn, false);
    }
  };
}

function layout(title, subtitle, content) {
  const nav = state.role === 'admin' ? getAdminNav() : employeeNav;
  const userLine = state.role === 'admin' ? (state.user.role || 'admin') : `${state.user.employee_type || 'employee'} • ${state.user.employee_code || ''}`;
  app.innerHTML = `
    <div class="main-layout">
      <aside class="sidebar">
        <div class="side-brand"><div class="logo-mark">G</div><div><h2>Goyal Attendance</h2><p>Smart Staff App</p></div></div>
        <div class="user-card"><b>${state.user.name || 'User'}</b><span>${userLine}</span></div>
        <nav class="nav">${nav.map(([key, icon, label]) => `<button class="${state.page === key ? 'active' : ''}" data-page="${key}">${icon} ${label}</button>`).join('')}</nav>
        <div class="nav-spacer"></div>
        <nav class="nav"><button class="logout" id="logoutBtn">↩ Logout</button></nav>
      </aside>
      <main class="content">
        <div class="topbar">
          <div><h1>${title}</h1><p>${subtitle || ''}</p></div>
          <div class="clock-pill" id="clockPill">${new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:true })}</div>
        </div>
        ${content}
      </main>
      <nav class="mobile-tabbar">${nav.map(([key, icon, label]) => `<button class="${state.page === key ? 'active' : ''}" data-page="${key}">${icon}<br>${label}</button>`).join('')}</nav>
    </div>`;
  document.querySelectorAll('[data-page]').forEach((btn) => {
    btn.onclick = () => { state.page = btn.dataset.page; localStorage.setItem('goyal_page', state.page); render(); };
  });
  document.getElementById('logoutBtn')?.addEventListener('click', logout);
  setInterval(() => {
    const el = document.getElementById('clockPill');
    if (el) el.textContent = new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:true });
  }, 30000);
}

function logout() {
  localStorage.removeItem('goyal_user');
  localStorage.removeItem('goyal_role');
  localStorage.removeItem('goyal_page');
  state.user = null; state.role = null; state.page = 'dashboard';
  loginPage();
}

async function render() {
  if (!state.user || !state.role) return loginPage();
  if (state.role === 'admin') return renderAdmin();
  return renderEmployee();
}

async function renderEmployee() {
  await todayAttendance();
  await openBreakRecord();
  if (state.page === 'dashboard') return employeeDashboard();
  if (state.page === 'punch') return employeePunchPage();
  if (state.page === 'break') return employeeBreakPage();
  if (state.page === 'leave') return employeeLeavePage();
  if (state.page === 'salary') return employeeSalaryPage();
  if (state.page === 'history') return employeeHistoryPage();
  return employeeDashboard();
}

function employeeRuleNote() {
  if (state.user.employee_type === 'office') return 'Office staff follow fixed timing: 10:30 AM start, 10:40 AM grace, ₹50 late deduction, half-day after 11:00 AM.';
  if (state.user.employee_type === 'godown') return 'Godown staff have flexible timing. GPS and working hours will be tracked.';
  return 'Field staff have no geofence restriction. GPS will be captured at the punch location.';
}

async function employeeDashboard() {
  const att = state.todayAttendance;
  const status = att?.final_status || att?.initial_status || 'Not punched';
  layout('Employee Dashboard', `Welcome, ${state.user.name}`, `
    <div class="quick-note"><b>Rule:</b> ${employeeRuleNote()}</div>
    <div class="cards">
      <div class="card stat"><div class="label">Today Status</div><div class="value">${status}</div><div class="hint">${att ? 'Attendance started' : 'Punch in pending'}</div></div>
      <div class="card stat"><div class="label">Punch In</div><div class="value">${fmtTime(att?.punch_in_time)}</div><div class="hint">GPS + selfie proof</div></div>
      <div class="card stat"><div class="label">Punch Out</div><div class="value">${fmtTime(att?.punch_out_time)}</div><div class="hint">Day end punch</div></div>
      <div class="card stat"><div class="label">Net Working</div><div class="value">${minutesToHM(att?.net_working_minutes)}</div><div class="hint">Break/lunch adjusted</div></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="section-title"><div><h2>Quick Attendance</h2><p>Manage punch and break actions from here.</p></div></div>
        <div class="action-panel">
          ${att?.punch_in_time ? `<button class="success-btn full" disabled>✅ Punch In Done • ${fmtTime(att.punch_in_time)}</button>` : `<button class="primary-btn full" id="goPunchIn">⏱️ Punch In Now</button>`}
          ${state.openBreak ? `<button class="warning-btn full" id="goBreakIn">☕ Break In Pending</button>` : `<button class="ghost-btn full" id="goBreak">☕ Break Out / In</button>`}
          ${att?.punch_out_time ? `<button class="success-btn full" disabled>✅ Punch Out Done • ${fmtTime(att.punch_out_time)}</button>` : `<button class="ghost-btn full" id="goPunchOut">🏁 Punch Out</button>`}
        </div>
      </div>
      <div class="card salary-slip">
        <div class="section-title"><div><h2>My Salary</h2><p>Current month salary status.</p></div></div>
        <div id="dashSalary">Loading salary...</div>
      </div>
    </div>`);
  document.getElementById('goPunchIn')?.addEventListener('click', () => { state.page = 'punch'; render(); });
  document.getElementById('goPunchOut')?.addEventListener('click', () => { state.page = 'punch'; render(); });
  document.getElementById('goBreak')?.addEventListener('click', () => { state.page = 'break'; render(); });
  document.getElementById('goBreakIn')?.addEventListener('click', () => { state.page = 'break'; render(); });
  const salary = await calculateSalaryForEmployee(state.user.id);
  const target = document.getElementById('dashSalary');
  if (target) target.innerHTML = `<div class="salary-total">${money(salary.netPayable)}</div><p class="muted">Late: ${salary.lateDays}, Half: ${salary.halfDays}, Advance: ${money(salary.advance)}</p>`;
}

function employeePunchPage() {
  const att = state.todayAttendance;
  layout('Punch In / Punch Out', 'Mark attendance with live camera selfie and GPS. Gallery upload is disabled.', `
    <div class="grid-2">
      <div class="card">
        <div class="section-title"><div><h2>Punch In</h2><p>Day start ke liye live selfie required.</p></div>${att?.punch_in_time ? badge('done') : ''}</div>
        ${att?.punch_in_time ? `<div class="soft-card"><b>Already punched in:</b> ${fmtDateTime(att.punch_in_time)}<br>${badge(att.initial_status)}</div>` : `
          <form id="punchInForm" class="form">
            <div class="quick-note"><b>Live Camera Only:</b> Gallery/file upload is disabled. The employee must capture a live selfie with watermark and compression before upload.</div>
            <div class="location-warning">Location permission is required. ${employeeRuleNote()}</div>
            <button class="primary-btn full" type="submit">📸 Open Camera & Punch In</button>
          </form>`}
      </div>
      <div class="card">
        <div class="section-title"><div><h2>Punch Out</h2><p>Day end ke liye live selfie required.</p></div>${att?.punch_out_time ? badge('done') : ''}</div>
        ${!att?.punch_in_time ? `<div class="empty">Please punch in first.</div>` : att?.punch_out_time ? `<div class="soft-card"><b>Already punched out:</b> ${fmtDateTime(att.punch_out_time)}<br>${badge(att.final_status)}</div>` : `
          <form id="punchOutForm" class="form">
            <div class="quick-note"><b>Watermark Auto:</b> Name, employee code, punch type, date/time, and GPS will be added to the photo.</div>
            ${state.openBreak ? `<div class="location-warning">Break In is pending. Please complete Break In before Punch Out.</div>` : ''}
            <button class="ghost-btn full" type="submit" ${state.openBreak ? 'disabled' : ''}>🏁 Open Camera & Punch Out</button>
          </form>`}
      </div>
    </div>`);
  document.getElementById('punchInForm')?.addEventListener('submit', handlePunchIn);
  document.getElementById('punchOutForm')?.addEventListener('submit', handlePunchOut);
}

async function handlePunchIn(e) {
  e.preventDefault();
  const btn = e.submitter;
  setLoading(btn, true, 'Punching in');
  try {
    await loadLocations();
    const loc = await getLocation();
    const geo = checkGeofence(state.user, loc);
    if (!geo.ok) throw new Error(`You are outside the allowed location. Distance: ${geo.distance}m, allowed: ${geo.allowed}m.`);
    const now = new Date();
    const initial = calculateInitialStatus(state.user, now);
    const liveSelfie = await captureLiveSelfie({ punchType: 'Punch In', loc, status: initial.status });
    const path = await uploadSelfie(liveSelfie, 'punch-in');
    const payload = {
      employee_id: state.user.id,
      attendance_date: localDateISO(),
      punch_in_time: now.toISOString(),
      punch_in_latitude: loc.latitude,
      punch_in_longitude: loc.longitude,
      punch_in_selfie_url: path,
      initial_status: initial.status,
      final_status: initial.status,
      late_deduction: initial.deduction,
      total_deduction: initial.deduction,
      day_count: initial.status === 'half_day' ? 0.5 : 1,
      employee_type: state.user.employee_type,
      attendance_policy: state.user.attendance_policy,
      time_restriction_applied: !!state.user.time_restriction_enabled,
      geofence_applied: !!state.user.geofence_required,
      rule_note: initial.note,
      salary_impact: initial.status,
    };
    const { error } = await supabaseClient.from('attendance_records').insert(payload);
    if (error) throw error;
    showToast(`Punch In successful: ${initial.status}`);
    await render();
  } catch (err) {
    showToast(err.message || 'Punch In failed', 'error');
  } finally { setLoading(btn, false); }
}

async function handlePunchOut(e) {
  e.preventDefault();
  const btn = e.submitter;
  setLoading(btn, true, 'Punching out');
  try {
    await openBreakRecord();
    if (state.openBreak) throw new Error('Break In is pending. Please complete Break In first.');
    const loc = await getLocation();
    const geo = checkGeofence(state.user, loc);
    if (!geo.ok) throw new Error(`You are outside the allowed location. Distance: ${geo.distance}m, allowed: ${geo.allowed}m.`);
    const nowISO = new Date().toISOString();
    const { data: breaks } = await supabaseClient.from('break_records').select('*').eq('attendance_id', state.todayAttendance.id);
    const totalBreak = (breaks || []).reduce((sum, b) => sum + Number(b.total_break_minutes || 0), 0);
    const draft = { ...state.todayAttendance, punch_out_time: nowISO };
    const calc = calculateFinalStatus(state.user, draft, totalBreak);
    const liveSelfie = await captureLiveSelfie({ punchType: 'Punch Out', loc, status: calc.final });
    const path = await uploadSelfie(liveSelfie, 'punch-out');
    const { error } = await supabaseClient.from('attendance_records').update({
      punch_out_time: nowISO,
      punch_out_latitude: loc.latitude,
      punch_out_longitude: loc.longitude,
      punch_out_selfie_url: path,
      gross_working_minutes: calc.gross,
      lunch_deducted_minutes: calc.breakDeducted,
      total_break_minutes: totalBreak || calc.breakDeducted,
      extra_break_minutes: calc.extraBreak,
      net_working_minutes: calc.net,
      final_status: calc.final,
      day_count: calc.dayCount,
      salary_impact: calc.final,
      rule_note: calc.note,
      total_deduction: Number(state.todayAttendance.late_deduction || 0),
    }).eq('id', state.todayAttendance.id);
    if (error) throw error;
    showToast(`Punch Out successful: ${calc.final}`);
    await render();
  } catch (err) {
    showToast(err.message || 'Punch Out failed', 'error');
  } finally { setLoading(btn, false); }
}

function employeeBreakPage() {
  const att = state.todayAttendance;
  layout('Break Out / Break In', 'Lunch and outdoor break time will be tracked separately.', `
    <div class="grid-2">
      <div class="card">
        <div class="section-title"><div><h2>Break Control</h2><p>Break Out and Break In are separate from Punch Out.</p></div></div>
        ${!att?.punch_in_time ? `<div class="empty">Please punch in first.</div>` : att?.punch_out_time ? `<div class="empty">Punch Out is already completed. Break entry is no longer allowed.</div>` : `
          <div class="quick-note"><b>Lunch Allowed:</b> 2:00 PM to 2:40 PM. Extra break time will be deducted from working hours.</div><br>
          ${state.openBreak ? `
            <div class="soft-card"><b>Break Out:</b> ${fmtDateTime(state.openBreak.break_out_time)}<br><b>Reason:</b> ${state.openBreak.break_reason || '-'}</div><br>
            <button class="primary-btn full" id="breakInBtn">☕ Break In with GPS</button>` : `
            <form id="breakOutForm" class="form">
              <div class="form-row"><label>Break Reason</label><select class="select" name="break_reason"><option>Lunch</option><option>Site Visit</option><option>Bank Work</option><option>Material Work</option><option>Other</option></select></div>
              <button class="warning-btn full" type="submit">☕ Break Out with GPS</button>
            </form>`}
        `}
      </div>
      <div class="card">
        <div class="section-title"><div><h2>Today Breaks</h2><p>Aaj ke break records.</p></div></div>
        <div id="todayBreaks">Loading...</div>
      </div>
    </div>`);
  document.getElementById('breakOutForm')?.addEventListener('submit', handleBreakOut);
  document.getElementById('breakInBtn')?.addEventListener('click', handleBreakIn);
  loadTodayBreaks();
}

async function loadTodayBreaks() {
  const target = document.getElementById('todayBreaks');
  if (!target || !state.todayAttendance) return;
  const { data, error } = await supabaseClient.from('break_records').select('*').eq('attendance_id', state.todayAttendance.id).order('created_at', { ascending: false });
  if (error || !data?.length) { target.innerHTML = `<div class="empty">No break records.</div>`; return; }
  target.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Out</th><th>In</th><th>Total</th><th>Extra</th><th>Status</th></tr></thead><tbody>${data.map(b => `<tr><td>${fmtTime(b.break_out_time)}</td><td>${fmtTime(b.break_in_time)}</td><td>${minutesToHM(b.total_break_minutes)}</td><td>${minutesToHM(b.extra_break_minutes)}</td><td>${badge(b.status)}</td></tr>`).join('')}</tbody></table></div>`;
}

async function handleBreakOut(e) {
  e.preventDefault();
  const btn = e.submitter; setLoading(btn, true, 'Starting break');
  try {
    const loc = await getLocation();
    const reason = new FormData(e.target).get('break_reason');
    const { error } = await supabaseClient.from('break_records').insert({
      employee_id: state.user.id,
      attendance_id: state.todayAttendance.id,
      break_date: localDateISO(),
      break_type: String(reason || 'Lunch').toLowerCase(),
      break_out_time: new Date().toISOString(),
      break_out_latitude: loc.latitude,
      break_out_longitude: loc.longitude,
      break_reason: reason,
      allowed_break_minutes: 40,
      status: 'open',
    });
    if (error) throw error;
    showToast('Break Out saved');
    await render();
  } catch (err) { showToast(err.message || 'Break Out failed', 'error'); }
  finally { setLoading(btn, false); }
}

async function handleBreakIn(e) {
  const btn = e.currentTarget; setLoading(btn, true, 'Ending break');
  try {
    const loc = await getLocation();
    const open = state.openBreak;
    const now = new Date();
    const total = Math.max(0, Math.round((now - new Date(open.break_out_time)) / 60000));
    const allowed = Number(open.allowed_break_minutes || 40);
    const extra = Math.max(0, total - allowed);
    const { error } = await supabaseClient.from('break_records').update({
      break_in_time: now.toISOString(),
      break_in_latitude: loc.latitude,
      break_in_longitude: loc.longitude,
      total_break_minutes: total,
      extra_break_minutes: extra,
      status: 'closed',
    }).eq('id', open.id);
    if (error) throw error;
    showToast(`Break In saved. Total break: ${minutesToHM(total)}`);
    await render();
  } catch (err) { showToast(err.message || 'Break In failed', 'error'); }
  finally { setLoading(btn, false); }
}

async function employeeLeavePage() {
  layout('Leave Apply', 'Apply for leave and track request status.', `
    <div class="grid-2">
      <div class="card">
        <div class="section-title"><div><h2>Apply Leave</h2><p>Salary impact will apply after Admin/HR approval.</p></div></div>
        <form id="leaveForm" class="form">
          <div class="form-row"><label>Leave Type</label><select class="select" name="leave_type" required><option>Full Day Leave</option><option>Half Day Leave</option><option>Paid Leave</option><option>Unpaid Leave</option><option>Sick Leave</option><option>Emergency Leave</option></select></div>
          <div class="grid-2"><div class="form-row"><label>From Date</label><input class="input" type="date" name="from_date" required></div><div class="form-row"><label>To Date</label><input class="input" type="date" name="to_date" required></div></div>
          <div class="form-row"><label>Reason</label><textarea class="textarea" name="reason" placeholder="Reason likho" required></textarea></div>
          <button class="primary-btn full" type="submit">Submit Leave Request</button>
        </form>
      </div>
      <div class="card"><div class="section-title"><div><h2>My Leave Status</h2><p>Latest requests.</p></div></div><div id="leaveList">Loading...</div></div>
    </div>`);
  document.getElementById('leaveForm').addEventListener('submit', handleLeaveApply);
  loadEmployeeLeaves();
}

async function handleLeaveApply(e) {
  e.preventDefault();
  const btn = e.submitter; setLoading(btn, true, 'Submitting');
  const fd = new FormData(e.target);
  try {
    const from = new Date(fd.get('from_date'));
    const to = new Date(fd.get('to_date'));
    const diff = Math.max(1, Math.round((to - from) / 86400000) + 1);
    const { error } = await supabaseClient.from('leave_requests').insert({
      employee_id: state.user.id,
      leave_type: fd.get('leave_type'),
      from_date: fd.get('from_date'),
      to_date: fd.get('to_date'),
      total_days: diff,
      reason: fd.get('reason'),
      status: 'pending',
    });
    if (error) throw error;
    e.target.reset();
    showToast('Leave request submitted');
    loadEmployeeLeaves();
  } catch (err) { showToast(err.message || 'Leave failed', 'error'); }
  finally { setLoading(btn, false); }
}

async function loadEmployeeLeaves() {
  const target = document.getElementById('leaveList');
  const { data, error } = await supabaseClient.from('leave_requests').select('*').eq('employee_id', state.user.id).order('created_at', { ascending: false });
  if (error || !data?.length) { target.innerHTML = `<div class="empty">No leave request yet.</div>`; return; }
  target.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Dates</th><th>Type</th><th>Status</th><th>Remark</th></tr></thead><tbody>${data.map(l => `<tr><td>${fmtDate(l.from_date)} - ${fmtDate(l.to_date)}<br><span class="muted">${l.total_days} day(s)</span></td><td>${l.leave_type}</td><td>${badge(l.status)}</td><td>${l.admin_remark || '-'}</td></tr>`).join('')}</tbody></table></div>`;
}

async function calculateSalaryForEmployee(employeeId, monthInput) {
  const emp = employeeId === state.user?.id ? state.user : null;
  let employee = emp;
  if (!employee) {
    const { data } = await supabaseClient.from('employees').select('*').eq('id', employeeId).maybeSingle();
    employee = data || {};
  }
  const range = currentMonthRange(monthInput);
  const { data: att } = await supabaseClient.from('attendance_records').select('*').eq('employee_id', employeeId).gte('attendance_date', range.start).lte('attendance_date', range.end);
  const { data: adv } = await supabaseClient.from('salary_advances').select('*').eq('employee_id', employeeId).gte('advance_date', range.start).lte('advance_date', range.end);
  const { data: ded } = await supabaseClient.from('salary_deductions').select('*').eq('employee_id', employeeId).gte('deduction_date', range.start).lte('deduction_date', range.end);
  const { data: leaves } = await supabaseClient.from('leave_requests').select('*').eq('employee_id', employeeId).eq('status', 'approved').gte('from_date', range.start).lte('to_date', range.end);
  const records = att || [];
  const presentDays = records.filter(r => String(r.final_status || '').includes('present')).reduce((s, r) => s + Number(r.day_count || 1), 0);
  const lateDays = records.filter(r => String(r.final_status || r.initial_status || '').includes('late')).length;
  const halfDays = records.filter(r => String(r.final_status || '').includes('half') || Number(r.day_count || 1) === 0.5).length;
  const paidLeaveDays = (leaves || []).filter(l => String(l.leave_type || '').toLowerCase().includes('paid') || String(l.leave_type || '').toLowerCase().includes('sick')).reduce((s, l) => s + Number(l.total_days || 1), 0);
  const unpaidLeaveDays = (leaves || []).filter(l => String(l.leave_type || '').toLowerCase().includes('unpaid')).reduce((s, l) => s + Number(l.total_days || 1), 0);
  const elapsed = daysElapsedInMonth(range.y, range.m);
  const uniqueAttendanceDays = new Set(records.map(r => r.attendance_date)).size;
  const absentDays = Math.max(0, elapsed - uniqueAttendanceDays - paidLeaveDays - unpaidLeaveDays);
  const monthlySalary = Number(employee.monthly_salary || 0);
  const daily = monthlySalary / 30;
  const lateDeduction = records.reduce((s, r) => s + Number(r.late_deduction || 0), 0);
  const halfDeduction = halfDays * daily * 0.5;
  const absentDeduction = absentDays * daily;
  const unpaidDeduction = unpaidLeaveDays * daily;
  const advance = (adv || []).reduce((s, a) => s + Number(a.amount || 0), 0);
  const otherDeduction = (ded || []).reduce((s, d) => s + Number(d.amount || 0), 0);
  const totalDeduction = lateDeduction + halfDeduction + absentDeduction + unpaidDeduction + advance + otherDeduction;
  const netPayable = Math.max(0, monthlySalary - totalDeduction);
  return { employee, range, records, presentDays, lateDays, halfDays, absentDays, paidLeaveDays, unpaidLeaveDays, monthlySalary, lateDeduction, halfDeduction, absentDeduction, unpaidDeduction, advance, otherDeduction, totalDeduction, netPayable };
}

async function employeeSalaryPage() {
  const defaultMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  layout('My Salary', 'View your monthly salary, deductions, and salary slip.', `
    <div class="card salary-slip">
      <div class="section-title"><div><h2>Salary Summary</h2><p>Employees can view only their own salary details.</p></div><input id="salaryMonth" class="input" type="month" value="${defaultMonth}" style="max-width:180px"></div>
      <div id="salaryBox">Loading...</div>
    </div>`);
  document.getElementById('salaryMonth').addEventListener('change', (e) => loadSalaryBox(e.target.value));
  loadSalaryBox(defaultMonth);
}

async function loadSalaryBox(monthValue) {
  const target = document.getElementById('salaryBox');
  const s = await calculateSalaryForEmployee(state.user.id, monthValue);
  target.innerHTML = salarySummaryHTML(s, true);
  document.getElementById('downloadSlipBtn')?.addEventListener('click', () => printSalarySlip(s));
}

function salarySummaryHTML(s, withSlipButton = false) {
  return `
    <div class="grid-3">
      <div><div class="muted small">Net Payable</div><div class="salary-total">${money(s.netPayable)}</div></div>
      <div class="soft-card"><b>Monthly Salary</b><br>${money(s.monthlySalary)}</div>
      <div class="soft-card"><b>Total Deduction</b><br><span class="danger-text">${money(s.totalDeduction)}</span></div>
    </div><br>
    <div class="cards">
      <div class="card stat"><div class="label">Present</div><div class="value">${s.presentDays}</div></div>
      <div class="card stat"><div class="label">Late</div><div class="value">${s.lateDays}</div><div class="hint">${money(s.lateDeduction)}</div></div>
      <div class="card stat"><div class="label">Half Day</div><div class="value">${s.halfDays}</div><div class="hint">${money(s.halfDeduction)}</div></div>
      <div class="card stat"><div class="label">Absent</div><div class="value">${s.absentDays}</div><div class="hint">${money(s.absentDeduction)}</div></div>
    </div>
    <div class="table-wrap"><table><tbody>
      <tr><th>Salary Month</th><td>${s.range.label}</td></tr>
      <tr><th>Paid Leave</th><td>${s.paidLeaveDays}</td></tr>
      <tr><th>Unpaid Leave</th><td>${s.unpaidLeaveDays} • ${money(s.unpaidDeduction)}</td></tr>
      <tr><th>Advance Taken</th><td>${money(s.advance)}</td></tr>
      <tr><th>Other Deduction</th><td>${money(s.otherDeduction)}</td></tr>
      <tr><th>Net Payable</th><td><b>${money(s.netPayable)}</b></td></tr>
    </tbody></table></div>
    ${withSlipButton ? `<br><button class="primary-btn" id="downloadSlipBtn">📄 Salary Slip Download / Print PDF</button>` : ''}`;
}

function printSalarySlip(s) {
  const html = `<!doctype html><html><head><title>Salary Slip</title><style>${document.querySelector('style')?.textContent || ''} body{font-family:Inter,Arial,sans-serif;padding:30px;color:#0f172a}.print-table{width:100%;border-collapse:collapse}.print-table td,.print-table th{border:1px solid #cbd5e1;padding:10px;text-align:left}.print-total{font-size:28px;font-weight:900}</style></head><body><div class="print-slip"><h1>Goyal Attendance</h1><p>Salary Slip - ${s.range.label}</p><hr><h2>${s.employee.name || 'Employee'}</h2><p>${s.employee.employee_code || ''} • ${s.employee.designation || ''}</p><table class="print-table"><tr><th>Monthly Salary</th><td>${money(s.monthlySalary)}</td></tr><tr><th>Present Days</th><td>${s.presentDays}</td></tr><tr><th>Late Days / Deduction</th><td>${s.lateDays} / ${money(s.lateDeduction)}</td></tr><tr><th>Half Days / Deduction</th><td>${s.halfDays} / ${money(s.halfDeduction)}</td></tr><tr><th>Absent Days / Deduction</th><td>${s.absentDays} / ${money(s.absentDeduction)}</td></tr><tr><th>Advance</th><td>${money(s.advance)}</td></tr><tr><th>Other Deduction</th><td>${money(s.otherDeduction)}</td></tr><tr><th>Net Payable</th><td><b>${money(s.netPayable)}</b></td></tr></table><p class="print-total">Net Payable: ${money(s.netPayable)}</p><p>Generated on ${new Date().toLocaleString('en-IN')}</p></div><script>window.print();<\/script></body></html>`;
  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}

async function employeeHistoryPage() {
  layout('Attendance History', 'View your attendance history.', `<div class="card"><div id="historyList">Loading...</div></div>`);
  const { data, error } = await supabaseClient.from('attendance_records').select('*').eq('employee_id', state.user.id).order('attendance_date', { ascending: false }).limit(60);
  const target = document.getElementById('historyList');
  if (error || !data?.length) { target.innerHTML = `<div class="empty">No attendance history.</div>`; return; }
  target.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Punch In</th><th>Punch Out</th><th>Net</th><th>Status</th><th>Deduction</th></tr></thead><tbody>${data.map(r => `<tr><td>${fmtDate(r.attendance_date)}</td><td>${fmtTime(r.punch_in_time)}</td><td>${fmtTime(r.punch_out_time)}</td><td>${minutesToHM(r.net_working_minutes)}</td><td>${badge(r.final_status || r.initial_status)}</td><td>${money(r.total_deduction)}</td></tr>`).join('')}</tbody></table></div>`;
}

async function renderAdmin() {
  await loadLocations();
  if (!isSuperAdmin() && ['locations', 'settings'].includes(state.page)) {
    return noPermissionPage('Owner Access Required');
  }
  if (state.page === 'dashboard') return adminDashboard();
  if (state.page === 'employees') return adminEmployeesPage();
  if (state.page === 'attendance') return adminAttendancePage();
  if (state.page === 'leaves') return adminLeavesPage();
  if (state.page === 'salary') return adminSalaryPage();
  if (state.page === 'locations') return adminLocationsPage();
  if (state.page === 'settings') return adminSettingsPage();
  return adminDashboard();
}

async function adminDashboard() {
  const today = localDateISO();
  const [{ count: employeeCount }, { data: todayRecords }, { data: leavePending }] = await Promise.all([
    supabaseClient.from('employees').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabaseClient.from('attendance_records').select('*, employees(name, employee_code, employee_type)').eq('attendance_date', today),
    supabaseClient.from('leave_requests').select('*').eq('status', 'pending'),
  ]);
  const records = todayRecords || [];
  layout('Admin Dashboard', `Welcome, ${state.user.name}`, `
    <div class="cards">
      <div class="card stat"><div class="label">Total Employees</div><div class="value">${employeeCount || 0}</div></div>
      <div class="card stat"><div class="label">Present Today</div><div class="value">${records.length}</div></div>
      <div class="card stat"><div class="label">Late Today</div><div class="value">${records.filter(r => String(r.final_status || r.initial_status).includes('late')).length}</div></div>
      <div class="card stat"><div class="label">Leave Pending</div><div class="value">${leavePending?.length || 0}</div></div>
    </div>
    <div class="grid-2">
      <div class="card"><div class="section-title"><div><h2>Today Attendance</h2><p>Latest punch records.</p></div></div>${adminAttendanceTable(records)}</div>
      <div class="card"><div class="section-title"><div><h2>System Rules</h2><p>Office/Godown/Field policy.</p></div></div>
        <div class="tag-list"><span class="mini-tag">Office fixed time</span><span class="mini-tag">Godown flexible</span><span class="mini-tag">Field GPS only</span><span class="mini-tag">Break Out/In</span><span class="mini-tag">Salary module</span></div>
      </div>
    </div>`);
}

function adminAttendanceTable(records) {
  if (!records?.length) return `<div class="empty">No records found.</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>Employee</th><th>Type</th><th>In</th><th>Out</th><th>Net</th><th>Status</th></tr></thead><tbody>${records.map(r => `<tr><td><b>${r.employees?.name || '-'}</b><br><span class="muted">${r.employees?.employee_code || ''}</span></td><td>${badge(r.employees?.employee_type || r.employee_type)}</td><td>${fmtTime(r.punch_in_time)}</td><td>${fmtTime(r.punch_out_time)}</td><td>${minutesToHM(r.net_working_minutes)}</td><td>${badge(r.final_status || r.initial_status)}</td></tr>`).join('')}</tbody></table></div>`;
}

async function adminEmployeesPage() {
  const locOptions = state.locations.map(l => `<option value="${l.id}">${l.location_name} (${l.location_type})</option>`).join('');
  layout('Employee Management', 'Add/edit employees and configure attendance policy.', `
    <div class="grid-2">
      <div class="card">
        <div class="section-title"><div><h2>Add Employee</h2><p>Rules are applied automatically based on Office/Godown/Field type.</p></div></div>
        <form id="employeeForm" class="form">
          <div class="grid-2"><div class="form-row"><label>Name</label><input class="input" name="name" required></div><div class="form-row"><label>Employee Code</label><input class="input" name="employee_code" placeholder="EMP001" required></div></div>
          <div class="grid-2"><div class="form-row"><label>Mobile</label><input class="input" name="mobile"></div><div class="form-row"><label>Email</label><input class="input" name="email" type="email"></div></div>
          <div class="grid-2"><div class="form-row"><label>Password</label><input class="input" name="password" value="123456" required></div><div class="form-row"><label>Monthly Salary</label><input class="input" name="monthly_salary" type="number" value="15000"></div></div>
          <div class="grid-2"><div class="form-row"><label>Department</label><input class="input" name="department" placeholder="Office / Godown / Field"></div><div class="form-row"><label>Designation</label><input class="input" name="designation"></div></div>
          <div class="grid-2"><div class="form-row"><label>Employee Type</label><select class="select" name="employee_type" id="empType"><option value="office">Office</option><option value="godown">Godown</option><option value="field">Field</option></select></div><div class="form-row"><label>Assigned Location</label><select class="select" name="assigned_location_id" id="empLocation"><option value="">None</option>${locOptions}</select></div></div>
          <div class="quick-note" id="policyPreview">Office: time restriction ON, geofence ON, late/half-day rule ON.</div>
          <button class="primary-btn full" type="submit">+ Add Employee</button>
        </form>
      </div>
      <div class="card"><div class="section-title"><div><h2>Employee List</h2><p>Active employees.</p></div><button class="ghost-btn" id="refreshEmployees">Refresh</button></div><div id="employeeList">Loading...</div></div>
    </div>`);
  const empType = document.getElementById('empType');
  const preview = document.getElementById('policyPreview');
  empType.onchange = () => {
    const v = empType.value;
    if (v === 'office') preview.textContent = 'Office: time restriction ON, geofence ON, late/half-day rule ON.';
    if (v === 'godown') preview.textContent = 'Godown: time restriction OFF, geofence ON, late/half-day rule OFF.';
    if (v === 'field') preview.textContent = 'Field: time restriction OFF, geofence OFF, only live GPS capture.';
  };
  document.getElementById('employeeForm').addEventListener('submit', handleAddEmployee);
  document.getElementById('refreshEmployees').onclick = loadEmployeeList;
  loadEmployeeList();
}

function policyForType(type) {
  if (type === 'office') return { attendance_policy: 'fixed_time', time_restriction_enabled: true, geofence_required: true, minimum_hours_enabled: true };
  if (type === 'godown') return { attendance_policy: 'flexible_time', time_restriction_enabled: false, geofence_required: true, minimum_hours_enabled: true };
  return { attendance_policy: 'field_work', time_restriction_enabled: false, geofence_required: false, minimum_hours_enabled: true };
}

async function handleAddEmployee(e) {
  e.preventDefault();
  const btn = e.submitter; setLoading(btn, true, 'Adding');
  const fd = new FormData(e.target);
  const type = fd.get('employee_type');
  const policy = policyForType(type);
  const payload = {
    employee_code: String(fd.get('employee_code')).trim(),
    name: String(fd.get('name')).trim(),
    mobile: fd.get('mobile'),
    email: fd.get('email'),
    password: fd.get('password'),
    role: 'employee',
    department: fd.get('department'),
    designation: fd.get('designation'),
    monthly_salary: Number(fd.get('monthly_salary') || 0),
    employee_type: type,
    assigned_location_id: fd.get('assigned_location_id') || null,
    status: 'active',
    ...policy,
  };
  try {
    const { error } = await supabaseClient.from('employees').insert(payload);
    if (error) throw error;
    e.target.reset();
    showToast('Employee added successfully. successfully');
    loadEmployeeList();
  } catch (err) { showToast(err.message || 'Employee add failed', 'error'); }
  finally { setLoading(btn, false); }
}

async function loadEmployeeList() {
  const target = document.getElementById('employeeList');
  const { data, error } = await supabaseClient.from('employees').select('*, office_locations(location_name)').order('created_at', { ascending: false });
  if (error || !data?.length) { target.innerHTML = `<div class="empty">No employee found.</div>`; return; }
  target.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Employee</th><th>Type</th><th>Policy</th><th>Salary</th><th>Location</th><th>Action</th></tr></thead><tbody>${data.map(e => `<tr><td><b>${e.name}</b><br><span class="muted">${e.employee_code} • ${e.mobile || '-'}</span></td><td>${badge(e.employee_type)}</td><td>${e.attendance_policy}<br><span class="muted">Time: ${e.time_restriction_enabled ? 'ON' : 'OFF'} • Geo: ${e.geofence_required ? 'ON' : 'OFF'}</span></td><td>${money(e.monthly_salary)}</td><td>${e.office_locations?.location_name || '-'}</td><td><button class="danger-btn" data-deactivate="${e.id}">Deactivate</button></td></tr>`).join('')}</tbody></table></div>`;
  document.querySelectorAll('[data-deactivate]').forEach(btn => btn.onclick = () => deactivateEmployee(btn.dataset.deactivate));
}

async function deactivateEmployee(id) {
  if (!confirm('Do you want to deactivate this employee?')) return;
  const { error } = await supabaseClient.from('employees').update({ status: 'inactive' }).eq('id', id);
  if (error) showToast(error.message, 'error'); else { showToast('Employee deactivated successfully.'); loadEmployeeList(); }
}

async function adminAttendancePage() {
  const today = localDateISO();
  layout('Attendance Report', 'View date-wise attendance, GPS, selfie, and status.', `
    <div class="card"><div class="section-title"><div><h2>Reports</h2><p>Filter by date.</p></div><div class="tools"><input id="attendanceDate" class="input" type="date" value="${today}"><button id="loadAttendance" class="primary-btn">Load</button></div></div><div id="adminAttendanceList">Loading...</div></div>`);
  document.getElementById('loadAttendance').onclick = () => loadAdminAttendance(document.getElementById('attendanceDate').value);
  loadAdminAttendance(today);
}

async function loadAdminAttendance(date) {
  const target = document.getElementById('adminAttendanceList');
  const { data, error } = await supabaseClient.from('attendance_records').select('*, employees(name, employee_code, employee_type)').eq('attendance_date', date).order('created_at', { ascending: false });
  if (error || !data?.length) { target.innerHTML = `<div class="empty">No records for selected date.</div>`; return; }
  const rows = await Promise.all(data.map(async r => {
    const inUrl = await signedPhoto(r.punch_in_selfie_url);
    const outUrl = await signedPhoto(r.punch_out_selfie_url);
    return `<tr><td><b>${r.employees?.name || '-'}</b><br><span class="muted">${r.employees?.employee_code || ''}</span></td><td>${badge(r.employees?.employee_type || r.employee_type)}</td><td>${fmtTime(r.punch_in_time)}<br>${inUrl ? `<a class="photo-link" target="_blank" href="${inUrl}">Selfie</a>` : ''}</td><td>${fmtTime(r.punch_out_time)}<br>${outUrl ? `<a class="photo-link" target="_blank" href="${outUrl}">Selfie</a>` : ''}</td><td>${minutesToHM(r.net_working_minutes)}<br><span class="muted">Break: ${minutesToHM(r.total_break_minutes)}</span></td><td>${badge(r.final_status || r.initial_status)}<br><span class="muted">${r.rule_note || ''}</span></td><td>${money(r.total_deduction)}</td></tr>`;
  }));
  target.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Employee</th><th>Type</th><th>Punch In</th><th>Punch Out</th><th>Working</th><th>Status</th><th>Deduction</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

async function adminLeavesPage() {
  layout('Leave Approval', 'Approve or reject employee leave requests.', `<div class="card"><div class="section-title"><div><h2>Leave Requests</h2><p>Pending and previous requests.</p></div><button id="refreshLeaves" class="ghost-btn">Refresh</button></div><div id="adminLeaveList">Loading...</div></div>`);
  document.getElementById('refreshLeaves').onclick = loadAdminLeaves;
  loadAdminLeaves();
}

async function loadAdminLeaves() {
  const target = document.getElementById('adminLeaveList');
  const { data, error } = await supabaseClient.from('leave_requests').select('*, employees(name, employee_code)').order('created_at', { ascending: false });
  if (error || !data?.length) { target.innerHTML = `<div class="empty">No leave requests.</div>`; return; }
  target.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Employee</th><th>Dates</th><th>Type</th><th>Reason</th><th>Status</th><th>Action</th></tr></thead><tbody>${data.map(l => `<tr><td><b>${l.employees?.name || '-'}</b><br><span class="muted">${l.employees?.employee_code || ''}</span></td><td>${fmtDate(l.from_date)} - ${fmtDate(l.to_date)}<br>${l.total_days} day(s)</td><td>${l.leave_type}</td><td>${l.reason || '-'}</td><td>${badge(l.status)}<br><span class="muted">${l.admin_remark || ''}</span></td><td>${l.status === 'pending' ? `<button class="success-btn" data-approve="${l.id}">Approve</button> <button class="danger-btn" data-reject="${l.id}">Reject</button>` : '-'}</td></tr>`).join('')}</tbody></table></div>`;
  document.querySelectorAll('[data-approve]').forEach(btn => btn.onclick = () => updateLeave(btn.dataset.approve, 'approved'));
  document.querySelectorAll('[data-reject]').forEach(btn => btn.onclick = () => updateLeave(btn.dataset.reject, 'rejected'));
}

async function updateLeave(id, status) {
  const remark = prompt(`Admin remark for ${status}:`) || '';
  const { error } = await supabaseClient.from('leave_requests').update({ status, admin_remark: remark, approved_by: currentAdminId(), approved_at: new Date().toISOString() }).eq('id', id);
  if (error) showToast(error.message, 'error'); else { showToast(`Leave request ${status}`); loadAdminLeaves(); }
}

async function adminSalaryPage() {
  const defaultMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const { data: employees } = await supabaseClient.from('employees').select('*').eq('status', 'active').order('name');
  const options = (employees || []).map(e => `<option value="${e.id}">${e.name} (${e.employee_code})</option>`).join('');
  layout('Salary Management', 'Manage advances, deductions, and monthly salary reports.', `
    <div class="grid-2">
      <div class="card"><div class="section-title"><div><h2>Add Advance / Deduction</h2><p>Add advance or deduction entries here.</p></div></div>
        <form id="moneyForm" class="form">
          <div class="form-row"><label>Employee</label><select class="select" name="employee_id" required>${options}</select></div>
          <div class="grid-2"><div class="form-row"><label>Type</label><select class="select" name="type"><option value="advance">Advance</option><option value="deduction">Other Deduction</option></select></div><div class="form-row"><label>Amount</label><input class="input" name="amount" type="number" required></div></div>
          <div class="form-row"><label>Reason</label><input class="input" name="reason" placeholder="Reason"></div>
          <button class="primary-btn full" type="submit">Save Entry</button>
        </form>
      </div>
      <div class="card"><div class="section-title"><div><h2>Salary Summary</h2><p>Select employee and month.</p></div></div>
        <div class="tools"><select class="select" id="salaryEmp">${options}</select><input class="input" id="adminSalaryMonth" type="month" value="${defaultMonth}"><button class="primary-btn" id="loadAdminSalary">Load</button></div><br><div id="adminSalaryBox">Select employee.</div>
      </div>
    </div>`);
  document.getElementById('moneyForm').addEventListener('submit', handleMoneyEntry);
  document.getElementById('loadAdminSalary').onclick = loadAdminSalaryBox;
  loadAdminSalaryBox();
}

async function handleMoneyEntry(e) {
  e.preventDefault();
  const btn = e.submitter; setLoading(btn, true, 'Saving');
  const fd = new FormData(e.target);
  const type = fd.get('type');
  const table = type === 'advance' ? 'salary_advances' : 'salary_deductions';
  const payload = type === 'advance'
    ? { employee_id: fd.get('employee_id'), amount: Number(fd.get('amount')), reason: fd.get('reason'), added_by: currentAdminId() }
    : { employee_id: fd.get('employee_id'), amount: Number(fd.get('amount')), deduction_type: 'other', reason: fd.get('reason'), added_by: currentAdminId() };
  const { error } = await supabaseClient.from(table).insert(payload);
  setLoading(btn, false);
  if (error) showToast(error.message, 'error'); else { showToast('Entry saved successfully.'); e.target.reset(); loadAdminSalaryBox(); }
}

async function loadAdminSalaryBox() {
  const empId = document.getElementById('salaryEmp')?.value;
  const month = document.getElementById('adminSalaryMonth')?.value;
  const target = document.getElementById('adminSalaryBox');
  if (!empId || !target) return;
  const s = await calculateSalaryForEmployee(empId, month);
  target.innerHTML = salarySummaryHTML(s, true);
  document.getElementById('downloadSlipBtn')?.addEventListener('click', () => printSalarySlip(s));
}

async function adminLocationsPage() {
  if (!isSuperAdmin()) return noPermissionPage('Owner Access Required');
  layout('Office / Godown Locations', 'Set Office and Godown geofence locations.', `
    <div class="grid-2">
      <div class="card"><div class="section-title"><div><h2>Add Location</h2><p>Copy latitude/longitude from Google Maps.</p></div></div>
        <form id="locationForm" class="form">
          <div class="form-row"><label>Location Name</label><input class="input" name="location_name" placeholder="Office / Godown" required></div>
          <div class="grid-2"><div class="form-row"><label>Latitude</label><input class="input" name="latitude" required></div><div class="form-row"><label>Longitude</label><input class="input" name="longitude" required></div></div>
          <div class="grid-2"><div class="form-row"><label>Radius Meter</label><input class="input" name="allowed_radius_meter" type="number" value="100"></div><div class="form-row"><label>Type</label><select class="select" name="location_type"><option value="office">Office</option><option value="godown">Godown</option></select></div></div>
          <button class="primary-btn full" type="submit">Add Location</button>
        </form>
      </div>
      <div class="card"><div class="section-title"><div><h2>Location List</h2><p>Active locations.</p></div></div><div id="locationList">Loading...</div></div>
    </div>`);
  document.getElementById('locationForm').addEventListener('submit', handleAddLocation);
  loadLocationList();
}

async function handleAddLocation(e) {
  e.preventDefault();
  const btn = e.submitter; setLoading(btn, true, 'Saving');
  const fd = new FormData(e.target);
  const { error } = await supabaseClient.from('office_locations').insert({
    location_name: fd.get('location_name'),
    latitude: Number(fd.get('latitude')),
    longitude: Number(fd.get('longitude')),
    allowed_radius_meter: Number(fd.get('allowed_radius_meter') || 100),
    location_type: fd.get('location_type'),
    status: 'active',
  });
  setLoading(btn, false);
  if (error) showToast(error.message, 'error'); else { showToast('Location added successfully.'); e.target.reset(); await loadLocations(); loadLocationList(); }
}

function loadLocationList() {
  const target = document.getElementById('locationList');
  if (!state.locations?.length) { target.innerHTML = `<div class="empty">No location added.</div>`; return; }
  target.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Type</th><th>Lat/Lng</th><th>Radius</th></tr></thead><tbody>${state.locations.map(l => `<tr><td><b>${l.location_name}</b></td><td>${badge(l.location_type)}</td><td>${l.latitude}, ${l.longitude}</td><td>${l.allowed_radius_meter}m</td></tr>`).join('')}</tbody></table></div>`;
}

async function adminSettingsPage() {
  if (!isSuperAdmin()) return noPermissionPage('Owner Access Required');
  await loadRules();
  const r = state.attendanceRules || {};
  layout('Attendance Settings', 'Manage office timing and deduction rules.', `
    <div class="card">
      <div class="section-title"><div><h2>Office Fixed-Time Rule</h2><p>This rule applies only to Office employees. Godown and Field employees remain flexible.</p></div></div>
      <form id="settingsForm" class="form">
        <div class="grid-3">
          <div class="form-row"><label>Office Start</label><input class="input" type="time" name="office_start_time" value="${String(r.office_start_time || '10:30').slice(0,5)}"></div>
          <div class="form-row"><label>Office End</label><input class="input" type="time" name="office_end_time" value="${String(r.office_end_time || '19:30').slice(0,5)}"></div>
          <div class="form-row"><label>Grace Time</label><input class="input" type="time" name="grace_time" value="${String(r.grace_time || '10:40').slice(0,5)}"></div>
          <div class="form-row"><label>Late After</label><input class="input" type="time" name="late_after_time" value="${String(r.late_after_time || '10:40').slice(0,5)}"></div>
          <div class="form-row"><label>Half Day After</label><input class="input" type="time" name="half_day_after_time" value="${String(r.half_day_after_time || '11:00').slice(0,5)}"></div>
          <div class="form-row"><label>Late Deduction</label><input class="input" type="number" name="late_deduction_amount" value="${r.late_deduction_amount || 50}"></div>
          <div class="form-row"><label>Lunch Start</label><input class="input" type="time" name="lunch_start_time" value="${String(r.lunch_start_time || '14:00').slice(0,5)}"></div>
          <div class="form-row"><label>Lunch End</label><input class="input" type="time" name="lunch_end_time" value="${String(r.lunch_end_time || '14:40').slice(0,5)}"></div>
          <div class="form-row"><label>Minimum Working Minutes</label><input class="input" type="number" name="minimum_working_minutes" value="${r.minimum_working_minutes || 480}"></div>
        </div>
        <button class="primary-btn" type="submit">Save Settings</button>
      </form>
    </div>`);
  document.getElementById('settingsForm').addEventListener('submit', handleSettingsSave);
}

async function handleSettingsSave(e) {
  e.preventDefault();
  const btn = e.submitter; setLoading(btn, true, 'Saving');
  const fd = new FormData(e.target);
  const payload = Object.fromEntries(fd.entries());
  payload.minimum_working_minutes = Number(payload.minimum_working_minutes || 480);
  payload.late_deduction_amount = Number(payload.late_deduction_amount || 50);
  payload.updated_at = new Date().toISOString();
  const id = state.attendanceRules?.id;
  const { error } = id ? await supabaseClient.from('attendance_rules').update(payload).eq('id', id) : await supabaseClient.from('attendance_rules').insert(payload);
  setLoading(btn, false);
  if (error) showToast(error.message, 'error'); else { await loadRules(); showToast('Settings saved successfully.'); }
}

async function bootstrap() {
  await Promise.all([loadRules(), loadLocations()]);
  render();
}

bootstrap();
