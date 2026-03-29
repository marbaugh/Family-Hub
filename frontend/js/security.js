let _secEntities = [];

document.addEventListener('DOMContentLoaded', async () => {
  await initAppTimezone();
  loadSidebarMembers();
  loadSecurityDevices();
  loadCameraFeeds();
  setInterval(loadSecurityDevices, 30000);
});

// ── HA Devices ────────────────────────────────────────────────

async function loadSecurityDevices() {
  try {
    const data = await API.get('/api/homeassistant/states');
    if (data.error || !data.entities || !data.entities.length) {
      document.getElementById('haNotConfigured').style.display = 'block';
      return;
    }
    document.getElementById('haNotConfigured').style.display = 'none';
    _secEntities = data.entities;

    const covers  = data.entities.filter(e => e.entity_id.startsWith('cover.'));
    const alarms  = data.entities.filter(e => e.entity_type === 'alarm');
    const others  = data.entities.filter(e => !e.entity_id.startsWith('cover.') && e.entity_type !== 'alarm');

    renderGarageCards(covers);
    renderAlarmCards(alarms);
    renderOtherCards(others);
  } catch(e) {
    document.getElementById('haNotConfigured').style.display = 'block';
  }
}

function renderGarageCards(covers) {
  const section = document.getElementById('garageSection');
  const el = document.getElementById('garageCards');
  if (!covers.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  el.innerHTML = covers.map(e => {
    const isOpen = e.state === 'open' || e.state === 'opening';
    const busy   = e.state === 'opening' || e.state === 'closing';
    const badge  = isOpen ? 'open' : 'closed';
    return `
      <div class="sec-row ${isOpen ? 'sec-open' : 'sec-closed'}">
        <div class="sec-row-icon">${e.icon || (isOpen ? '🚗' : '🏠')}</div>
        <div class="sec-row-info">
          <div class="sec-row-name">${e.name}</div>
          <span class="sec-row-badge ${badge}">${e.state_label || e.state}</span>
        </div>
        <div class="sec-row-btns">
          <button class="btn btn-secondary sec-btn" ${e.state === 'open' || busy ? 'disabled' : ''}
            onclick="coverAction('open_cover','${e.entity_id}')">🔼 Open</button>
          <button class="btn btn-primary sec-btn" ${e.state === 'closed' || busy ? 'disabled' : ''}
            onclick="coverAction('close_cover','${e.entity_id}')">🔽 Close</button>
        </div>
      </div>`;
  }).join('');
}

function renderAlarmCards(alarms) {
  const section = document.getElementById('alarmSection');
  const el = document.getElementById('alarmCards');
  if (!alarms.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  el.innerHTML = alarms.map(e => {
    const s = e.state;
    const busy    = s === 'arming' || s === 'pending';
    const isArmed = s.startsWith('armed');
    const badge   = isArmed ? 'armed' : 'disarmed';
    const label   = e.state_label || e.state;
    return `
      <div class="alarm-card ${isArmed ? 'sec-armed' : ''}">
        <div class="alarm-card-header">
          <span class="alarm-card-icon">${isArmed ? '🔒' : '🔓'}</span>
          <div>
            <div class="alarm-card-name">${e.name}</div>
            <span class="sec-row-badge ${badge}">${label}</span>
          </div>
        </div>
        <div class="alarm-card-btns">
          <button class="btn btn-secondary" ${s === 'disarmed' || busy ? 'disabled' : ''}
            onclick="alarmAction('alarm_disarm','${e.entity_id}')">🔓 Disarm</button>
          <button class="btn ${s === 'armed_home' ? 'btn-primary' : 'btn-ghost'}" ${s === 'armed_home' || busy ? 'disabled' : ''}
            onclick="alarmAction('alarm_arm_home','${e.entity_id}')">🏠 Arm Home</button>
          <button class="btn ${s === 'armed_away' ? 'btn-primary' : 'btn-ghost'}" ${s === 'armed_away' || busy ? 'disabled' : ''}
            onclick="alarmAction('alarm_arm_away','${e.entity_id}')">🏃 Arm Away</button>
        </div>
      </div>`;
  }).join('');
}

function renderOtherCards(others) {
  const section = document.getElementById('otherSection');
  const el = document.getElementById('otherCards');
  if (!others.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  el.innerHTML = others.map(e => `
    <div class="sec-row">
      <div class="sec-row-icon">${e.icon || '📡'}</div>
      <div class="sec-row-info">
        <div class="sec-row-name">${e.name}</div>
        <span class="sec-row-badge">${e.state_label || e.state}</span>
      </div>
    </div>`).join('');
}

async function coverAction(action, entityId) {
  try {
    await API.post(`/api/homeassistant/cover/${action}`, { entity_id: entityId });
    showToast(action === 'open_cover' ? '🔼 Opening…' : '🔽 Closing…', 'success');
    setTimeout(loadSecurityDevices, 3000);
  } catch(e) {
    showToast('Failed to send command', 'error');
  }
}

async function alarmAction(action, entityId) {
  try {
    await API.post(`/api/homeassistant/alarm/${action}`, { entity_id: entityId });
    showToast(action === 'alarm_disarm' ? '🔓 Disarmed' : '🔒 Armed', 'success');
    setTimeout(loadSecurityDevices, 3000);
  } catch(e) {
    showToast('Failed to send alarm command', 'error');
  }
}

// ── Camera Feeds ──────────────────────────────────────────────

async function loadCameraFeeds() {
  const section = document.getElementById('cameraSection');
  const notConfigured = document.getElementById('cameraNotConfigured');
  const grid = document.getElementById('cameraGrid');
  try {
    const data = await API.get('/api/security/cameras');
    const cameras = data.cameras || [];
    if (!cameras.length) {
      section.style.display = 'none';
      notConfigured.style.display = 'block';
      return;
    }
    notConfigured.style.display = 'none';
    section.style.display = 'block';
    grid.innerHTML = cameras.map(cam => {
      const streamUrl = `/api/security/camera/${encodeURIComponent(cam.ha_entity_id)}/stream`;
      const safeUrl = streamUrl.replace(/'/g, "\\'");
      const safeName = cam.name.replace(/'/g, "\\'");
      return `
        <div class="camera-feed-card" onclick="openCameraModal('${safeName}','${safeUrl}')">
          <div class="camera-feed-label">${cam.name}</div>
          <div class="camera-placeholder" id="ph-${cam.ha_entity_id}">
            <div class="camera-placeholder-icon">📷</div>
            <div>Connecting to ${cam.name}…</div>
          </div>
          <img src="${streamUrl}" class="camera-feed-img" alt="${cam.name}"
               onload="this.classList.add('loaded');document.getElementById('ph-${cam.ha_entity_id}')?.remove()"
               onerror="document.getElementById('ph-${cam.ha_entity_id}').innerHTML='<div class=camera-placeholder-icon>⚠️</div><div>Feed unavailable</div>'">
        </div>`;
    }).join('');
  } catch(e) {
    section.style.display = 'none';
    notConfigured.style.display = 'block';
  }
}

// ── Camera Fullscreen Modal ────────────────────────────────────
let _modalCameras = [];
let _modalIndex = 0;
let _swipeStartX = null;

function openCameraModal(name, streamUrl) {
  // Build ordered list from rendered grid
  const cards = document.querySelectorAll('.camera-feed-card');
  _modalCameras = Array.from(cards).map(card => ({
    name: card.querySelector('.camera-feed-label').textContent,
    url:  card.querySelector('.camera-feed-img')?.src || ''
  }));
  _modalIndex = _modalCameras.findIndex(c => c.name === name);
  if (_modalIndex < 0) _modalIndex = 0;
  _showModalCamera(_modalIndex);
  document.getElementById('cameraModal').style.display = 'flex';
  document.addEventListener('keydown', _modalKeyHandler);
  // Swipe support
  const img = document.getElementById('cameraModalImg');
  img.addEventListener('touchstart', _swipeStart, { passive: true });
  img.addEventListener('touchend',   _swipeEnd,   { passive: true });
}

function _showModalCamera(idx) {
  const cam = _modalCameras[idx];
  document.getElementById('cameraModalTitle').textContent = cam.name;
  document.getElementById('cameraModalImg').src = cam.url;
  // Dots
  const dots = document.getElementById('cameraModalDots');
  dots.innerHTML = _modalCameras.map((_, i) =>
    `<span class="cam-dot ${i === idx ? 'active' : ''}"></span>`
  ).join('');
  // Hide nav arrows if only one camera
  document.getElementById('camPrev').style.visibility = _modalCameras.length > 1 ? 'visible' : 'hidden';
  document.getElementById('camNext').style.visibility = _modalCameras.length > 1 ? 'visible' : 'hidden';
}

function cycleCameraModal(dir) {
  _modalIndex = (_modalIndex + dir + _modalCameras.length) % _modalCameras.length;
  _showModalCamera(_modalIndex);
}

function closeCameraModal() {
  document.getElementById('cameraModal').style.display = 'none';
  document.getElementById('cameraModalImg').src = '';
  document.removeEventListener('keydown', _modalKeyHandler);
  const img = document.getElementById('cameraModalImg');
  img.removeEventListener('touchstart', _swipeStart);
  img.removeEventListener('touchend',   _swipeEnd);
}

function _modalKeyHandler(e) {
  if (e.key === 'Escape')      closeCameraModal();
  if (e.key === 'ArrowRight')  cycleCameraModal(1);
  if (e.key === 'ArrowLeft')   cycleCameraModal(-1);
}

function _swipeStart(e) { _swipeStartX = e.touches[0].clientX; }
function _swipeEnd(e) {
  if (_swipeStartX === null) return;
  const dx = e.changedTouches[0].clientX - _swipeStartX;
  if (Math.abs(dx) > 50) cycleCameraModal(dx < 0 ? 1 : -1);
  _swipeStartX = null;
}
