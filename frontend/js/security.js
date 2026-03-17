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
    const busy = e.state === 'opening' || e.state === 'closing';
    return `
      <div class="security-device-card ${isOpen ? 'sec-open' : 'sec-closed'}">
        <div class="sec-card-icon">${e.icon || (isOpen ? '🚗' : '🏠')}</div>
        <div class="sec-card-name">${e.name}</div>
        <div class="sec-card-state ${isOpen ? 'state-open' : 'state-closed'}">${e.state_label || e.state}</div>
        <div class="sec-card-actions">
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
    const busy = s === 'arming' || s === 'pending';
    const isArmed = s.startsWith('armed');
    return `
      <div class="security-device-card ${isArmed ? 'sec-open' : 'sec-closed'}">
        <div class="sec-card-icon">${e.icon || '🔐'}</div>
        <div class="sec-card-name">${e.name}</div>
        <div class="sec-card-state ${isArmed ? 'state-open' : 'state-closed'}">${e.state_label || e.state}</div>
        <div class="sec-card-actions" style="flex-wrap:wrap">
          <button class="btn btn-secondary sec-btn" ${s === 'disarmed' || busy ? 'disabled' : ''}
            onclick="alarmAction('alarm_disarm','${e.entity_id}')">🔓 Disarm</button>
          <button class="btn sec-btn ${s === 'armed_home' ? 'btn-primary' : 'btn-ghost'}" ${s === 'armed_home' || busy ? 'disabled' : ''}
            onclick="alarmAction('alarm_arm_home','${e.entity_id}')">🏠 Arm Home</button>
          <button class="btn sec-btn ${s === 'armed_away' ? 'btn-primary' : 'btn-ghost'}" ${s === 'armed_away' || busy ? 'disabled' : ''}
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
    <div class="security-device-card">
      <div class="sec-card-icon">${e.icon || '📡'}</div>
      <div class="sec-card-name">${e.name}</div>
      <div class="sec-card-state">${e.state_label || e.state}</div>
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
      return `
        <div class="camera-feed-card">
          <div class="camera-feed-label">${cam.name}</div>
          <img src="${streamUrl}" class="camera-feed-img" alt="${cam.name}">
        </div>`;
    }).join('');
  } catch(e) {
    section.style.display = 'none';
    notConfigured.style.display = 'block';
  }
}
