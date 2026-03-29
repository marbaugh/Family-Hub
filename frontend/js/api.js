// ── API Helper ────────────────────────────────────────────────
const API = {
  async get(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async post(path, body) {
    const r = await fetch(path, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async put(path, body) {
    const r = await fetch(path, {
      method: 'PUT', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async delete(path) {
    const r = await fetch(path, { method: 'DELETE' });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }
};

// ── Toast ─────────────────────────────────────────────────────
function showToast(msg, type = '') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ── Sidebar Members ───────────────────────────────────────────
async function loadSidebarMembers() {
  const el = document.getElementById('sidebarMembers');
  if (!el) return;
  try {
    const members = await API.get('/members/');
    el.innerHTML = members.map(m => `
      <div class="sidebar-member-chip">
        <div class="member-avatar" style="background:${m.color}22">${m.avatar || '👤'}</div>
        <span>${m.name}</span>
      </div>
    `).join('');
  } catch(e) {}
}

// ── Date Helpers ──────────────────────────────────────────────
let TZ = 'America/New_York';
let _tzLoaded = false;
async function initAppTimezone() {
  if (_tzLoaded) return;
  try {
    const s = await API.get('/api/settings/timezone');
    if (s.value) TZ = s.value;
  } catch(e) {}
  _tzLoaded = true;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', timeZone: TZ });
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', timeZone: TZ });
}

function isToday(dateStr) {
  const d = new Date(dateStr);
  const t = new Date();
  const opts = { timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit' };
  return d.toLocaleDateString('en-US', opts) === t.toLocaleDateString('en-US', opts);
}

function isPast(dateStr) {
  return new Date(dateStr) < new Date();
}

function toETDateStr(date) {
  // Returns YYYY-MM-DD in Eastern Time
  const d = new Date(date);
  const parts = d.toLocaleDateString('en-US', { timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit' }).split('/');
  return `${parts[2]}-${parts[0]}-${parts[1]}`;
}

function toLocalISO(date) {
  const d = new Date(date);
  // Use ET time components
  const etStr = d.toLocaleString('en-US', { timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12: false });
  const [datePart, timePart] = etStr.split(', ');
  const [m, day, yr] = datePart.split('/');
  return `${yr}-${m}-${day}T${timePart.replace('24:', '00:')}`;
}

// ── Night Mode + Auto-dim ──────────────────────────────────────
let _darkStart = 21;
let _darkEnd   = 7;
let _dimDelay  = 5 * 60 * 1000;
let _dimTimer  = null;

function _applyTheme() {
  const h = new Date().getHours();
  const isNight = _darkStart > _darkEnd
    ? (h >= _darkStart || h < _darkEnd)
    : (h >= _darkStart && h < _darkEnd);
  document.documentElement.setAttribute('data-theme', isNight ? 'dark' : 'light');
}

function _resetDim() {
  document.documentElement.classList.remove('dimmed');
  clearTimeout(_dimTimer);
  if (_dimDelay > 0) {
    _dimTimer = setTimeout(() => document.documentElement.classList.add('dimmed'), _dimDelay);
  }
}

async function initTheme() {
  try {
    const [s, e, d] = await Promise.all([
      API.get('/api/settings/dark_mode_start').catch(() => ({value: '21'})),
      API.get('/api/settings/dark_mode_end').catch(() => ({value: '7'})),
      API.get('/api/settings/dim_minutes').catch(() => ({value: '5'}))
    ]);
    _darkStart = parseInt(s.value || '21');
    _darkEnd   = parseInt(e.value || '7');
    _dimDelay  = parseInt(d.value || '5') * 60000;
  } catch(e) {}
  _applyTheme();
  setInterval(_applyTheme, 60000);
  ['touchstart', 'mousemove', 'keydown', 'click'].forEach(ev =>
    document.addEventListener(ev, _resetDim, { passive: true })
  );
  _resetDim();
}

// ── Message Badge (all pages) ─────────────────────────────────
async function loadMessageBadge() {
  const badge = document.getElementById('msgNavBadge');
  if (!badge) return;
  // If on messages page, mark as seen and hide badge
  if (window.location.pathname === '/messages.html') {
    localStorage.setItem('msg_last_seen', new Date().toISOString());
    badge.style.display = 'none';
    return;
  }
  try {
    const msgs = await API.get('/api/messages/');
    const lastSeen = localStorage.getItem('msg_last_seen') || '1970-01-01T00:00:00Z';
    const unread = msgs.filter(m => new Date(m.created_at + 'Z') > new Date(lastSeen));
    if (unread.length > 0) {
      badge.textContent = unread.length > 9 ? '9+' : unread.length;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  } catch(e) {}
}

// ── PWA Install Prompt ────────────────────────────────────────
let _installPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _installPrompt = e;
  const btn = document.getElementById('pwaInstallBtn');
  if (btn) btn.style.display = 'flex';
});
window.addEventListener('appinstalled', () => {
  _installPrompt = null;
  const btn = document.getElementById('pwaInstallBtn');
  if (btn) btn.style.display = 'none';
});
function pwaInstall() {
  if (!_installPrompt) return;
  _installPrompt.prompt();
  _installPrompt.userChoice.then(() => { _installPrompt = null; });
}

// Init sidebar + theme on all pages
document.addEventListener('DOMContentLoaded', () => {
  loadSidebarMembers();
  initTheme();
  loadMessageBadge();
});
