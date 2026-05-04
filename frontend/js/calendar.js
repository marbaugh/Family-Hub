
// Returns true if an event occurs on the given dateStr (YYYY-MM-DD)
// Handles all-day multi-day events and timed events
function eventOccursOnDate(e, dateStr) {
  if (!e.start_datetime) return false;
  const start = e.start_datetime.split('T')[0];
  // For all-day events, end_datetime is exclusive (Google style) — subtract 1 day
  let end = e.end_datetime ? e.end_datetime.split('T')[0] : start;
  if (e.all_day && end > start) {
    // Move end back one day so we don't show on the day after it ends
    const endDate = new Date(end + 'T12:00:00');
    endDate.setDate(endDate.getDate() - 1);
    end = endDate.toISOString().split('T')[0];
  }
  return dateStr >= start && dateStr <= end;
}

let currentDate = new Date();
let allEvents = [];
let members = [];
let selectedDay = null;
let editingEventId = null;
let _calendarOptions = [];

async function loadCalendarOptions() {
  try {
    const status = await API.get('/api/auth/google/status');
    if (!status.family.connected) return;
    const data = await API.get('/api/calendar/google-calendars/family');
    // Show only the calendars chosen for sync
    _calendarOptions = data.calendars.filter(c => data.selected.includes(c.id));
    if (!_calendarOptions.length) _calendarOptions = data.calendars;
    const sel = document.getElementById('eventCalendarId');
    sel.innerHTML = '<option value="none">Don\'t sync to Google</option>' +
      _calendarOptions.map(c => `<option value="${c.id}">${c.summary}</option>`).join('');
    document.getElementById('calendarPickerGroup').style.display = '';
  } catch(e) {
    // Google not connected — keep picker hidden
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await initAppTimezone();
  members = await API.get('/api/members/');
  populateMemberSelect();
  loadCalendarOptions();
  renderCalendar();
  loadEvents();
  loadSyncStatus();

  document.getElementById('prevMonth').onclick = () => { currentDate.setMonth(currentDate.getMonth() - 1); renderCalendar(); loadEvents(); };
  document.getElementById('nextMonth').onclick = () => { currentDate.setMonth(currentDate.getMonth() + 1); renderCalendar(); loadEvents(); };
  document.getElementById('todayBtn').onclick = () => { currentDate = new Date(); renderCalendar(); loadEvents(); };
  document.getElementById('addEventBtn').onclick = () => openEventModal();
  document.getElementById('closeEventModal').onclick = closeEventModal;
  document.getElementById('cancelEventModal').onclick = closeEventModal;
  document.getElementById('saveEvent').onclick = saveEvent;
  document.getElementById('addEventDayBtn').onclick = () => openEventModal(selectedDay);
  document.getElementById('closeDayPanel').onclick = () => {
    document.getElementById('dayEventsPanel').style.display = 'none';
  };
  document.getElementById('syncBtn').onclick = syncGoogle;

  document.getElementById('eventModal').onclick = (e) => {
    if (e.target.id === 'eventModal') closeEventModal();
  };
});

function populateMemberSelect() {
  const sel = document.getElementById('eventMember');
  sel.innerHTML = '<option value="">Whole family</option>' +
    members.map(m => `<option value="${m.id}">${m.avatar || '👤'} ${m.name}</option>`).join('');
}

function renderCalendar() {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  document.getElementById('calendarTitle').textContent =
    new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: TZ });

  const grid = document.getElementById('calendarGrid');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let html = days.map(d => `<div class="cal-day-header">${d}</div>`).join('');

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();
  const today = new Date();

  // Prev month padding
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = prevDays - i;
    html += `<div class="cal-day other-month"><div class="cal-date">${d}</div></div>`;
  }

  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = d === today.getDate() && month === today.getMonth() && year === today.getFullYear();
    const isSelected = selectedDay === dateStr;
    const dayEvents = allEvents.filter(e => eventOccursOnDate(e, dateStr));
    const hasEvents = dayEvents.length > 0;

    html += `<div class="cal-day ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${hasEvents ? 'has-events' : ''}"
               data-date="${dateStr}" onclick="selectDay('${dateStr}')">
      <div class="cal-date">${isToday ? `<span>${d}</span>` : d}</div>
      <div class="cal-events">
        ${dayEvents.slice(0, 3).map(e => {
          const color = e.color || (e.is_family ? '#F6BF26' : e.member_color) || '#F6BF26';
          return `<div class="cal-event-dot" style="background:${color}" onclick="showEventDetail(${e.id},event)">${e.title}</div>`;
        }).join('')}
        ${dayEvents.length > 3 ? `<div style="font-size:10px;color:var(--text3);font-weight:700">+${dayEvents.length - 3} more</div>` : ''}
      </div>
    </div>`;
  }

  // Next month padding
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
  for (let d = 1; d <= totalCells - firstDay - daysInMonth; d++) {
    html += `<div class="cal-day other-month"><div class="cal-date">${d}</div></div>`;
  }

  grid.innerHTML = html;
}

async function loadEvents() {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const start = `${year}-${String(month+1).padStart(2,'0')}-01T00:00:00`;
  const end = `${year}-${String(month+1).padStart(2,'0')}-31T23:59:59`;
  try {
    allEvents = await API.get(`/api/calendar/events?start=${start}&end=${end}`);
    renderCalendar();
  } catch(e) {
    showToast('Failed to load events', 'error');
  }
}

function selectDay(dateStr) {
  selectedDay = dateStr;
  renderCalendar();
  const panel = document.getElementById('dayEventsPanel');
  const dayEvents = allEvents.filter(e => eventOccursOnDate(e, dateStr));
  const date = new Date(dateStr + 'T12:00:00');
  document.getElementById('dayEventTitle').textContent =
    date.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', timeZone: TZ });

  if (!dayEvents.length) {
    document.getElementById('dayEventsList').innerHTML =
      `<div class="empty-state" style="margin-top:12px">No events. <a href="#" onclick="openEventModal('${dateStr}');return false" style="color:var(--primary);font-weight:800">+ Add one</a></div>`;
  } else {
    document.getElementById('dayEventsList').innerHTML = dayEvents.map(e => {
      const color = e.color || (e.is_family ? '#F6BF26' : e.member_color) || '#F6BF26';
      return `
        <div class="event-card" style="border-left-color:${color};margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div>
              <div class="event-card-title">${e.title}</div>
              <div class="event-card-time">${e.all_day ? 'All day' : formatTime(e.start_datetime) + ' – ' + formatTime(e.end_datetime)}</div>
              ${e.description ? `<div style="font-size:13px;color:var(--text2);margin-top:4px">${e.description}</div>` : ''}
            </div>
            <button onclick="deleteEvent(${e.id})" class="chore-action-btn delete" style="opacity:1">🗑</button>
          </div>
          ${e.member_name ? `<div class="event-card-member" style="background:${color}22;color:${color}">${e.member_name}</div>` : ''}
          ${e.is_family ? '<div class="event-card-member" style="background:#F6BF2622;color:#c49a00">🏠 Family</div>' : ''}
        </div>`;
    }).join('');
  }
  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function openEventModal(dateStr) {
  editingEventId = null;
  document.getElementById('eventModalTitle').textContent = 'Add Event';
  document.getElementById('eventTitle').value = '';
  document.getElementById('eventDesc').value = '';
  document.getElementById('eventLocation').value = '';
  document.getElementById('eventAllDay').checked = false;
  document.getElementById('eventMember').value = '';
  // Default to first real calendar (index 1, after "Don't sync")
  const calSel = document.getElementById('eventCalendarId');
  if (calSel.options.length > 1) calSel.selectedIndex = 1;
  if (dateStr) {
    document.getElementById('eventStart').value = dateStr + 'T09:00';
    document.getElementById('eventEnd').value = dateStr + 'T10:00';
  } else {
    const now = new Date();
    document.getElementById('eventStart').value = toLocalISO(now);
    document.getElementById('eventEnd').value = toLocalISO(new Date(now.getTime() + 3600000));
  }
  document.getElementById('eventModal').style.display = 'flex';
  document.getElementById('eventTitle').focus();
}

function closeEventModal() {
  document.getElementById('eventModal').style.display = 'none';
}

async function saveEvent() {
  const title = document.getElementById('eventTitle').value.trim();
  if (!title) { showToast('Please enter a title', 'error'); return; }
  const calId = document.getElementById('eventCalendarId').value;
  const memberId = document.getElementById('eventMember').value || null;
  const payload = {
    title,
    description: document.getElementById('eventDesc').value.trim(),
    location: document.getElementById('eventLocation').value.trim(),
    start_datetime: document.getElementById('eventStart').value,
    end_datetime: document.getElementById('eventEnd').value,
    all_day: document.getElementById('eventAllDay').checked,
    member_id: memberId,
    is_family: !memberId,
    target_calendar_id: calId !== 'none' ? calId : null,
  };
  try {
    await API.post('/api/calendar/events', payload);
    closeEventModal();
    showToast('✅ Event saved!', 'success');
    loadEvents();
  } catch(e) {
    showToast('Failed to save event', 'error');
  }
}

async function deleteEvent(id) {
  if (!confirm('Delete this event?')) return;
  try {
    await API.delete(`/api/calendar/events/${id}`);
    showToast('Event deleted', '');
    loadEvents();
    if (selectedDay) selectDay(selectedDay);
  } catch(e) {
    showToast('Failed to delete', 'error');
  }
}

function showEventDetail(eventId, domEvent) {
  domEvent.stopPropagation();
  const e = allEvents.find(ev => ev.id === eventId);
  if (!e) return;

  const color = e.color || (e.is_family ? '#F6BF26' : e.member_color) || '#F6BF26';

  // Color bar
  document.getElementById('eventDetailBar').style.background = color;

  // Title
  document.getElementById('eventDetailTitle').textContent = e.title;

  // Time
  let timeStr;
  if (e.all_day) {
    const start = new Date(e.start_datetime.split('T')[0] + 'T12:00:00');
    const end   = e.end_datetime ? new Date(e.end_datetime.split('T')[0] + 'T12:00:00') : null;
    const fmt = d => d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', timeZone: TZ });
    timeStr = end && e.end_datetime.split('T')[0] !== e.start_datetime.split('T')[0]
      ? `${fmt(start)} – ${fmt(end)}`
      : fmt(start);
    timeStr += ' · All day';
  } else {
    const start = new Date(e.start_datetime);
    timeStr = start.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', timeZone: TZ })
      + ' · ' + formatTime(e.start_datetime);
    if (e.end_datetime) timeStr += ' – ' + formatTime(e.end_datetime);
  }
  document.getElementById('eventDetailTime').textContent = timeStr;

  // Location
  const locEl = document.getElementById('eventDetailLocation');
  if (e.location && e.location.trim()) {
    const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent(e.location)}`;
    locEl.innerHTML = `<a href="${mapsUrl}" target="_blank" rel="noopener" style="color:var(--primary);text-decoration:none">📍 ${e.location}</a>`;
    locEl.style.display = 'block';
  } else {
    locEl.style.display = 'none';
  }

  // Description
  const descEl = document.getElementById('eventDetailDesc');
  if (e.description && e.description.trim()) {
    descEl.textContent = e.description;
    descEl.style.display = 'block';
  } else {
    descEl.style.display = 'none';
  }

  // Tags (member / family)
  const tagsEl = document.getElementById('eventDetailTags');
  let tags = '';
  if (e.member_name) {
    tags += `<span class="event-detail-tag" style="background:${color}22;color:${color}">${e.member_name}</span>`;
  } else if (e.is_family) {
    tags += `<span class="event-detail-tag" style="background:#F6BF2622;color:#c49a00">🏠 Family</span>`;
  }
  tagsEl.innerHTML = tags;

  // Delete button
  document.getElementById('eventDetailDelete').onclick = () => {
    closeEventDetail();
    deleteEvent(eventId);
  };

  document.getElementById('eventDetailModal').style.display = 'flex';
}

function closeEventDetail() {
  document.getElementById('eventDetailModal').style.display = 'none';
}

async function loadSyncStatus() {
  try {
    const data = await API.get('/api/calendar/sync/status');
    const el = document.getElementById('syncStatus');
    if (!el || !data.last_synced) return;
    const mins = Math.round((Date.now() - new Date(data.last_synced + 'Z').getTime()) / 60000);
    el.textContent = mins < 2 ? 'Synced just now' : `Synced ${mins}m ago`;
  } catch(e) {}
}

async function syncGoogle() {
  const btn = document.getElementById('syncBtn');
  btn.textContent = '⏳ Syncing...';
  btn.disabled = true;
  try {
    const status = await API.get('/api/auth/google/status');
    let synced = 0;
    if (status.family.connected) {
      const r = await API.post('/api/calendar/sync/family', {});
      synced += r.synced;
    }
    for (const m of status.members) {
      if (m.connected) {
        const r = await API.post(`/api/calendar/sync/member/${m.id}`, {});
        synced += r.synced;
      }
    }
    showToast(`✅ Synced ${synced} events from Google`, 'success');
    loadEvents();
    loadSyncStatus();
  } catch(e) {
    showToast('Sync failed — check Google connections in Settings', 'error');
  } finally {
    btn.textContent = '🔄 Sync Google';
    btn.disabled = false;
  }
}
