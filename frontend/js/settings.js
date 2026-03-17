const COLORS = ['#4F6EF7','#FF6B6B','#FFB347','#34C759','#AF52DE','#FF2D55','#5AC8FA','#FF9500','#30D158','#64D2FF'];
const EMOJIS = ['👤','👨','👩','👧','👦','👶','🧑','👴','👵','🧔','👸','🤴','🦸','🧙','🧝','🐱','🐶','🦊','🐼','🦁'];
let members = [];
let editingMemberId = null;

document.addEventListener('DOMContentLoaded', async () => {
  loadMembers();
  loadGoogleStatus();
  loadSlideshowSettings();
  loadWeatherZip();
  loadHASettings();
  loadTimezone();
  loadLunchSettings();
  loadStockSettings();
  loadCameraSettings();

  document.getElementById('addMemberBtn').onclick = () => openMemberModal();
  document.getElementById('closeMemberModal').onclick = closeMemberModal;
  document.getElementById('cancelMemberModal').onclick = closeMemberModal;
  document.getElementById('saveMember').onclick = saveMember;
  document.getElementById('memberModal').onclick = e => { if (e.target.id === 'memberModal') closeMemberModal(); };

  document.getElementById('disconnectFamilyBtn').onclick = async () => {
    if (!confirm('Disconnect the family Google Calendar?')) return;
    await API.delete('/api/auth/google/disconnect/family');
    showToast('Disconnected', '');
    loadGoogleStatus();
  };

  document.getElementById('colorPresets').innerHTML = COLORS.map(c =>
    `<div class="color-preset" style="background:${c}" data-color="${c}" onclick="selectColor('${c}')"></div>`
  ).join('');

  document.getElementById('emojiPicker').innerHTML = EMOJIS.map(e =>
    `<div class="emoji-opt" data-emoji="${e}" onclick="selectEmoji('${e}')">${e}</div>`
  ).join('');

  document.getElementById('memberColor').oninput = e => selectColor(e.target.value);

  const params = new URLSearchParams(window.location.search);
  if (params.get('connected') === 'member') {
    showToast('✅ Google Calendar connected!', 'success');
    history.replaceState({}, '', '/settings.html');
  }
});

async function loadMembers() {
  members = await API.get('/api/members/');
  const el = document.getElementById('membersList');
  if (!members.length) {
    el.innerHTML = '<div class="empty-state">No family members yet — add your first one!</div>';
    return;
  }
  el.innerHTML = members.map(m => `
    <div class="member-item">
      <div class="member-item-avatar">${m.avatar || '👤'}</div>
      <div class="member-item-info">
        <div class="member-item-name">
          <span class="member-color-swatch" style="background:${m.color}"></span>
          ${m.name}
        </div>
        <div class="member-item-sub">${m.google_email ? '📅 ' + m.google_email : 'No Google Calendar connected'}</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="chore-action-btn" onclick="openMemberModal(${m.id})">✏️ Edit</button>
        <button class="chore-action-btn delete" onclick="deleteMember(${m.id})">🗑</button>
      </div>
    </div>`).join('');
}

async function loadGoogleStatus() {
  try {
    const status = await API.get('/api/auth/google/status');
    const dot = document.querySelector('#familyCalStatus .status-dot');
    const text = document.querySelector('#familyCalStatus .status-text');
    const connectBtn = document.getElementById('connectFamilyBtn');
    const disconnectBtn = document.getElementById('disconnectFamilyBtn');

    if (status.family.connected) {
      dot.className = 'status-dot connected';
      text.textContent = `Connected: ${status.family.email}`;
      text.className = 'status-text connected';
      connectBtn.style.display = 'none';
      disconnectBtn.style.display = 'inline-flex';
      const pickerSection = document.getElementById('familyCalPickerSection');
      if (pickerSection) pickerSection.style.display = 'block';
      loadCalendarPicker('family', null);
      loadWriteCalendarPicker();
    } else {
      dot.className = 'status-dot disconnected';
      text.textContent = 'Not connected';
      text.className = 'status-text';
      connectBtn.style.display = 'inline-flex';
      disconnectBtn.style.display = 'none';
    }

    const el = document.getElementById('memberCalendars');
    if (!status.members.length) { el.innerHTML = ''; return; }
    el.innerHTML = status.members.map(m => `
      <div class="settings-card">
        <div class="settings-card-info">
          <h3>${members.find(mb => mb.id == m.id)?.avatar || '👤'} ${m.name}'s Calendar</h3>
          <div class="google-status">
            <span class="status-dot ${m.connected ? 'connected' : 'disconnected'}"></span>
            <span class="status-text ${m.connected ? 'connected' : ''}">${m.connected ? 'Connected: ' + m.email : 'Not connected'}</span>
          </div>
        </div>
        <div id="memberCalPicker_${m.id}"></div>
        </div>
        <div class="settings-card-actions">
          ${!m.connected ? `<a href="/api/auth/google/connect/member/${m.id}" class="btn btn-google">
            <svg width="16" height="16" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/></svg>
            Connect Google
          </a>` : `<button class="btn btn-danger-ghost" onclick="disconnectMember(${m.id})">Disconnect</button>`}
        </div>
      </div>`).join('');
    setTimeout(() => {
      for (const m of (status?.members || [])) {
        if (m.connected) loadCalendarPicker('member', m.id);
      }
    }, 100);
  } catch(e) {}
}

function openMemberModal(memberId) {
  editingMemberId = memberId || null;
  document.getElementById('memberModalTitle').textContent = memberId ? 'Edit Member' : 'Add Family Member';
  if (memberId) {
    const m = members.find(m => m.id === memberId);
    if (m) {
      document.getElementById('memberName').value = m.name;
      selectColor(m.color);
      selectEmoji(m.avatar || '👤');
    }
  } else {
    document.getElementById('memberName').value = '';
    selectColor(COLORS[0]);
    selectEmoji('👤');
  }
  document.getElementById('memberModal').style.display = 'flex';
  document.getElementById('memberName').focus();
}

function closeMemberModal() {
  document.getElementById('memberModal').style.display = 'none';
}

function selectColor(color) {
  document.getElementById('memberColor').value = color;
  document.querySelectorAll('.color-preset').forEach(el => {
    el.classList.toggle('selected', el.dataset.color === color);
  });
}

function selectEmoji(emoji) {
  document.getElementById('memberAvatar').value = emoji;
  document.querySelectorAll('.emoji-opt').forEach(el => {
    el.classList.toggle('selected', el.dataset.emoji === emoji);
  });
}

async function saveMember() {
  const name = document.getElementById('memberName').value.trim();
  if (!name) { showToast('Please enter a name', 'error'); return; }
  const payload = {
    name,
    color: document.getElementById('memberColor').value,
    avatar: document.getElementById('memberAvatar').value,
  };
  try {
    if (editingMemberId) {
      await API.put(`/api/members/${editingMemberId}`, payload);
      showToast('✅ Member updated!', 'success');
    } else {
      await API.post('/api/members/', payload);
      showToast('✅ Member added!', 'success');
    }
    closeMemberModal();
    loadMembers();
    loadSidebarMembers();
    loadGoogleStatus();
  } catch(e) {
    showToast('Failed to save member', 'error');
  }
}

async function deleteMember(id) {
  if (!confirm('Remove this family member? Their chores and events will remain.')) return;
  try {
    await API.delete(`/api/members/${id}`);
    showToast('Member removed', '');
    loadMembers();
    loadSidebarMembers();
  } catch(e) {
    showToast('Failed to delete', 'error');
  }
}

async function disconnectMember(id) {
  if (!confirm('Disconnect their Google Calendar?')) return;
  await API.delete(`/api/auth/google/disconnect/member/${id}`);
  showToast('Disconnected', '');
  loadGoogleStatus();
}

async function loadCalendarPicker(type, memberId) {
  const containerId = type === 'family' ? 'familyCalPicker' : `memberCalPicker_${memberId}`;
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '<div style="font-size:13px;color:var(--text2);padding:8px">Loading calendars...</div>';
  try {
    const url = type === 'family'
      ? '/api/calendar/google-calendars/family'
      : `/api/calendar/google-calendars/member/${memberId}`;
    const data = await API.get(url);
    if (!data || !data.calendars) throw new Error('Bad response');
    const { calendars, selected } = data;
    let selectedIds = new Set(selected);
    container.innerHTML = `
      <div class="cal-picker">
        <div class="cal-picker-title">Choose calendars to sync:</div>
        ${calendars.map(c => `
          <div class="cal-option ${selectedIds.has(c.id) ? 'selected' : ''}"
               data-id="${c.id}"
               onclick="toggleCalOption(this, '${containerId}')">
            <div class="cal-option-dot" style="background:${c.backgroundColor}"></div>
            <div class="cal-option-name">${c.summary}${c.primary ? ' ⭐' : ''}</div>
            ${selectedIds.has(c.id) ? '<div class="cal-option-check">✓</div>' : '<div class="cal-option-check" style="opacity:0">✓</div>'}
          </div>`).join('')}
        <button class="btn btn-primary cal-picker-save" onclick="saveCalendarSelection('${type}', ${memberId || 'null'}, '${containerId}')">
          Save Selection
        </button>
      </div>`;
  } catch(e) {
    container.innerHTML = `<div style="font-size:13px;color:var(--red);padding:8px">Error: ${e.message}</div>`;
  }
}

function toggleCalOption(el, _containerId) {
  el.classList.toggle('selected');
  const check = el.querySelector('.cal-option-check');
  check.style.opacity = el.classList.contains('selected') ? '1' : '0';
}

async function saveCalendarSelection(type, memberId, containerId) {
  const container = document.getElementById(containerId);
  const selected = [...container.querySelectorAll('.cal-option.selected')].map(el => el.dataset.id);
  if (!selected.length) { showToast('Select at least one calendar', 'error'); return; }
  try {
    const url = type === 'family'
      ? '/api/calendar/google-calendars/family/select'
      : `/api/calendar/google-calendars/member/${memberId}/select`;
    await API.post(url, { calendar_ids: selected });
    showToast(`✅ Saved! ${selected.length} calendar${selected.length !== 1 ? 's' : ''} will sync`, 'success');
    // Refresh write calendar picker with updated list
    if (type === 'family') loadWriteCalendarPicker();
  } catch(e) {
    showToast('Failed to save selection', 'error');
  }
}

async function loadWriteCalendarPicker() {
  const el = document.getElementById('writeCalendarPicker');
  if (!el) return;
  try {
    const [data, settings] = await Promise.all([
      API.get('/api/calendar/google-calendars/family'),
      API.get('/api/settings/')
    ]);
    const saved = settings.family_write_calendar_id || 'primary';
    el.innerHTML = data.calendars.map(c =>
      `<option value="${c.id}" ${c.id === saved ? 'selected' : ''}>${c.summary}${c.primary ? ' ⭐' : ''}</option>`
    ).join('');
  } catch(e) { el.innerHTML = '<option value="primary">primary ⭐</option>'; }
}

async function saveWriteCalendar() {
  const val = document.getElementById('writeCalendarPicker')?.value || 'primary';
  try {
    await API.post('/api/settings/', { family_write_calendar_id: val });
    showToast('✅ Write calendar saved!', 'success');
  } catch(e) {
    showToast('Failed to save', 'error');
  }
}

// ── Photo Upload ──────────────────────────────────────────────

async function loadSlideshowSettings() {
  try {
    const s = await API.get('/api/settings/');
    const timeout = document.getElementById('slideshowTimeout');
    const interval = document.getElementById('slideshowInterval');
    if (timeout && s.slideshow_timeout) timeout.value = s.slideshow_timeout;
    if (interval && s.slideshow_interval) interval.value = s.slideshow_interval;
  } catch(e) {}
  await loadPhotosGrid();
}

async function loadPhotosGrid() {
  try {
    const data = await API.get('/api/photos/');
    const grid = document.getElementById('photosGrid');
    const empty = document.getElementById('photosEmpty');
    const label = document.getElementById('photosCountLabel');
    const clearBtn = document.getElementById('clearAllPhotosBtn');

    label.textContent = `Uploaded Photos (${data.count})`;
    clearBtn.style.display = data.count > 0 ? 'inline-flex' : 'none';

    if (!data.photos.length) {
      grid.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';
    grid.innerHTML = data.photos.map(url => {
      const filename = url.split('/').pop();
      return `
        <div style="position:relative;aspect-ratio:1;border-radius:8px;overflow:hidden;background:var(--bg2)">
          <img src="${url}" style="width:100%;height:100%;object-fit:cover" loading="lazy">
          <button onclick="deletePhoto('${filename}')"
            style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.6);color:#fff;border:none;border-radius:50%;width:22px;height:22px;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center">✕</button>
        </div>`;
    }).join('');
  } catch(e) {
    console.error('loadPhotosGrid error:', e);
  }
}

function handleDragOver(e) {
  e.preventDefault();
  const zone = document.getElementById('photoDropZone');
  zone.style.borderColor = 'var(--primary)';
  zone.style.background = 'var(--bg2)';
}

function handleDragLeave(_e) {
  const zone = document.getElementById('photoDropZone');
  zone.style.borderColor = 'var(--border)';
  zone.style.background = '';
}

function handleDrop(e) {
  e.preventDefault();
  handleDragLeave(e);
  const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
  if (files.length) uploadFiles(files);
}

function handleFileSelect(e) {
  const files = [...e.target.files];
  if (files.length) uploadFiles(files);
  e.target.value = '';
}

async function uploadFiles(files) {
  const statusEl = document.getElementById('uploadStatus');
  statusEl.style.display = 'block';
  statusEl.textContent = `⏳ Uploading ${files.length} photo${files.length !== 1 ? 's' : ''}...`;

  const formData = new FormData();
  for (const file of files) formData.append('files', file);

  try {
    const resp = await fetch('/api/photos/upload', { method: 'POST', body: formData });
    const result = await resp.json();
    if (result.uploaded > 0) {
      statusEl.textContent = `✅ ${result.uploaded} photo${result.uploaded !== 1 ? 's' : ''} uploaded!`;
      showToast(`✅ ${result.uploaded} photos added to slideshow`, 'success');
      await loadPhotosGrid();
    }
    if (result.errors?.length) statusEl.textContent += ` (${result.errors.length} failed)`;
    setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
  } catch(e) {
    statusEl.textContent = '❌ Upload failed: ' + e.message;
  }
}

async function deletePhoto(filename) {
  try {
    await API.delete(`/api/photos/file/${filename}`);
    await loadPhotosGrid();
  } catch(e) {
    showToast('Failed to delete photo', 'error');
  }
}

async function clearAllPhotos() {
  if (!confirm('Remove all photos from the slideshow?')) return;
  try {
    const data = await API.get('/api/photos/');
    for (const url of data.photos) {
      const filename = url.split('/').pop();
      await API.delete(`/api/photos/file/${filename}`);
    }
    await loadPhotosGrid();
    showToast('All photos removed', '');
  } catch(e) {
    showToast('Failed to clear photos', 'error');
  }
}

async function loadWeatherZip() {
  try {
    const data = await API.get('/api/settings/weather_zip');
    const el = document.getElementById('weatherZip');
    if (el && data.value) el.value = data.value;
  } catch(e) { /* not set yet */ }
}

async function saveWeatherZip() {
  const zip = (document.getElementById('weatherZip')?.value || '').trim();
  const status = document.getElementById('weatherSaveStatus');
  try {
    await API.post('/api/settings/', { weather_zip: zip, weather_lat: '', weather_lon: '', weather_city: '' });
    if (status) { status.textContent = '✅ Saved!'; setTimeout(() => { status.textContent = ''; }, 2000); }
  } catch(e) {
    if (status) status.textContent = '❌ Failed to save';
  }
}

async function loadTimezone() {
  try {
    const s = await API.get('/api/settings/timezone');
    const sel = document.getElementById('timezoneSelect');
    if (sel && s.value) sel.value = s.value;
  } catch(e) {}
}

async function saveTimezone() {
  const tz = document.getElementById('timezoneSelect')?.value || 'America/New_York';
  const status = document.getElementById('timezoneSaveStatus');
  try {
    await API.post('/api/settings/', { timezone: tz });
    if (status) { status.textContent = '✅ Saved!'; setTimeout(() => { status.textContent = ''; }, 2000); }
  } catch(e) {
    if (status) status.textContent = '❌ Failed to save';
  }
}

async function loadHASettings() {
  try {
    const s = await API.get('/api/settings/');
    if (s.ha_url) document.getElementById('haUrl').value = s.ha_url;
    if (s.ha_token) document.getElementById('haToken').value = s.ha_token;
    if (s.ha_alarm_code) document.getElementById('haAlarmCode').value = s.ha_alarm_code;
    const entities = s.ha_entities ? JSON.parse(s.ha_entities) : [];
    const list = document.getElementById('haEntityList');
    list.innerHTML = '';
    if (entities.length) {
      entities.forEach(e => addHAEntityRow(e.entity_id, e.name));
    }
  } catch(e) { /* settings not set yet */ }
}

function addHAEntityRow(entityId = '', name = '') {
  const list = document.getElementById('haEntityList');
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;align-items:center';
  row.innerHTML = `
    <input type="text" class="form-input ha-entity-id" placeholder="cover.garage_door" value="${entityId}" style="flex:1.5">
    <input type="text" class="form-input ha-entity-name" placeholder="Friendly name" value="${name}" style="flex:1">
    <button class="btn btn-danger-ghost" onclick="this.parentElement.remove()" style="padding:8px 10px">✕</button>
  `;
  list.appendChild(row);
}

function toggleHATokenVisibility() {
  const el = document.getElementById('haToken');
  el.type = el.type === 'password' ? 'text' : 'password';
}

function toggleAlarmCodeVisibility() {
  const el = document.getElementById('haAlarmCode');
  el.type = el.type === 'password' ? 'text' : 'password';
}

async function saveHASettings() {
  const url = document.getElementById('haUrl')?.value.trim() || '';
  const token = document.getElementById('haToken')?.value.trim() || '';
  const rows = document.querySelectorAll('#haEntityList > div');
  const entities = [];
  rows.forEach(row => {
    const eid = row.querySelector('.ha-entity-id')?.value.trim();
    const name = row.querySelector('.ha-entity-name')?.value.trim();
    if (eid) entities.push({ entity_id: eid, name: name || eid });
  });
  const status = document.getElementById('haSaveStatus');
  try {
    const alarmCode = document.getElementById('haAlarmCode')?.value.trim() || '';
    await API.post('/api/settings/', {
      ha_url: url,
      ha_token: token,
      ha_entities: JSON.stringify(entities),
      ha_alarm_code: alarmCode,
    });
    if (status) { status.textContent = '✅ Saved!'; setTimeout(() => { status.textContent = ''; }, 2000); }
  } catch(e) {
    if (status) status.textContent = '❌ Failed to save';
  }
}

async function loadLunchSettings() {
  try {
    const s = await API.get('/api/settings/');
    const district = document.getElementById('lunchDistrict');
    const slug = document.getElementById('lunchSchoolSlug');
    const menuType = document.getElementById('lunchMenuType');
    if (district) district.value = s.lunch_district || 'bcps';
    if (slug) slug.value = s.lunch_school_slug || 'bcps-weekly-menus';
    if (menuType) menuType.value = s.lunch_menu_type || 'weekly-menus';
  } catch(e) {}
}

async function saveLunchSettings() {
  const district = (document.getElementById('lunchDistrict')?.value || '').trim();
  const slug = (document.getElementById('lunchSchoolSlug')?.value || '').trim();
  const menuType = (document.getElementById('lunchMenuType')?.value || '').trim();
  const status = document.getElementById('lunchSaveStatus');
  try {
    await API.post('/api/settings/', {
      lunch_district: district,
      lunch_school_slug: slug,
      lunch_menu_type: menuType,
    });
    if (status) { status.textContent = '✅ Saved!'; setTimeout(() => { status.textContent = ''; }, 2000); }
  } catch(e) {
    if (status) status.textContent = '❌ Failed to save';
  }
}

async function loadStockSettings() {
  try {
    const data = await API.get('/api/stocks/settings');
    const el = document.getElementById('stockSymbols');
    if (el && data.symbols) el.value = data.symbols;
  } catch(e) {}
}

async function saveStockSettings() {
  const symbols = (document.getElementById('stockSymbols')?.value || '').trim();
  const status = document.getElementById('stockSaveStatus');
  try {
    await API.post('/api/settings/', { stock_symbols: symbols });
    if (status) { status.textContent = '✅ Saved!'; setTimeout(() => { status.textContent = ''; }, 2000); }
  } catch(e) {
    if (status) status.textContent = '❌ Failed to save';
  }
}

async function loadCameraSettings() {
  try {
    const data = await API.get('/api/security/cameras');
    const cameras = data.cameras || [];
    const list = document.getElementById('cameraList');
    list.innerHTML = '';
    cameras.forEach(c => addCameraRow(c.name, c.rtsp_url));
  } catch(e) {}
}

function addCameraRow(name = '', rtspUrl = '') {
  const list = document.getElementById('cameraList');
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';
  row.innerHTML = `
    <input type="text" class="form-input cam-name" placeholder="FrontDoor" value="${name}" style="flex:1;min-width:120px;max-width:180px">
    <input type="text" class="form-input cam-url" placeholder="rtsps://192.168.1.1:7441/token" value="${rtspUrl}" style="flex:3;min-width:200px">
    <button class="btn btn-danger-ghost" onclick="this.parentElement.remove()" style="padding:8px 10px">✕</button>
  `;
  list.appendChild(row);
}

async function saveCameraSettings() {
  const rows = document.querySelectorAll('#cameraList > div');
  const cameras = [];
  rows.forEach(row => {
    const name = row.querySelector('.cam-name')?.value.trim();
    const url = row.querySelector('.cam-url')?.value.trim();
    if (name && url) cameras.push({ name, rtsp_url: url });
  });
  const status = document.getElementById('cameraSaveStatus');
  try {
    await API.post('/api/security/cameras', { cameras });
    if (status) { status.textContent = '✅ Saved!'; setTimeout(() => { status.textContent = ''; }, 2000); }
  } catch(e) {
    if (status) status.textContent = '❌ Failed to save';
  }
}

async function saveSlideShowSettings() {
  const timeout = document.getElementById('slideshowTimeout')?.value || '120';
  const interval = document.getElementById('slideshowInterval')?.value || '5';
  try {
    await API.post('/api/settings/', {
      slideshow_timeout: timeout,
      slideshow_interval: interval,
    });
    showToast('✅ Slideshow settings saved!', 'success');
  } catch(e) {
    showToast('Failed to save settings', 'error');
  }
}
