const QUOTES = [
  { text: "Family is not an important thing. It's everything.", author: "Michael J. Fox" },
  { text: "In family life, love is the oil that eases friction.", author: "Friedrich Nietzsche" },
  { text: "The love of a family is life's greatest blessing.", author: "" },
  { text: "A happy family is but an earlier heaven.", author: "George Bernard Shaw" },
  { text: "Family means nobody gets left behind or forgotten.", author: "Lilo & Stitch" },
  { text: "The most important thing in the world is family and love.", author: "" },
  { text: "Home is where love resides, memories are created, friends always belong.", author: "" },
  { text: "Families are the compass that guides us.", author: "" },
  { text: "Every day is a gift — unwrap it together.", author: "" },
  { text: "Small moments make big memories.", author: "" },
  { text: "Together is our favorite place to be.", author: "" },
  { text: "Be the reason someone smiles today.", author: "" },
];

document.addEventListener('DOMContentLoaded', async () => {
  await initAppTimezone();
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  document.getElementById('timeGreeting').textContent = greet;
  document.getElementById('todayDate').textContent = new Date().toLocaleDateString('en-US', { timeZone: TZ,
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  // Daily quote — rotate by day of year
  const q = QUOTES[Math.floor(Date.now() / 86400000) % QUOTES.length];
  const qEl = document.getElementById('dailyQuote');
  if (qEl) {
    qEl.innerHTML = `"${q.text}"${q.author ? `<span class="quote-author"> — ${q.author}</span>` : ''}`;
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get('connected') === 'family') {
    showToast('✅ Family Google Calendar connected!', 'success');
    history.replaceState({}, '', '/');
  }

  loadTodayEvents();
  loadUpcomingChores();
  loadLunchMenu();
  loadWeather();
  loadHAStatus();
  loadStocks();
  setInterval(loadHAStatus, 30000);
  setInterval(loadStocks, 5 * 60 * 1000);
});

async function loadTodayEvents() {
  const el = document.getElementById('todayEvents');
  try {
    const now = new Date();
    const start = now.toISOString().replace('.000', '');
    const end48 = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const end = end48.toISOString().replace('.000', '');
    const allFetched = await API.get(`/api/calendar/events?start=${start}&end=${end}`);
    const events = allFetched.filter(e => {
      const endTime = e.end_datetime ? new Date(e.end_datetime) : new Date(e.start_datetime);
      return endTime > now;
    });
    if (!events.length) {
      el.innerHTML = '<div class="empty-state">🎉 Nothing coming up!</div>';
      return;
    }
    el.innerHTML = events.map(e => {
      const color = e.color || e.member_color || '#F6BF26';
      const eventDate = e.start_datetime ? new Date(e.start_datetime) : null;
      const eventDateStr = e.start_datetime ? e.start_datetime.slice(0, 10) : null;
      const todayStr = toETDateStr(new Date());
      const isToday = eventDateStr === todayStr;
      let dateLabel = '';
      if (eventDateStr) {
        if (isToday) {
          dateLabel = 'Today';
        } else if (e.all_day) {
          // Parse date-only string as local time to avoid UTC-shift bug
          const [yr, mo, dy] = eventDateStr.split('-').map(Number);
          dateLabel = new Date(yr, mo - 1, dy).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        } else {
          dateLabel = eventDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ });
        }
      }
      // Countdown — integrate into date label
      if (eventDateStr && !isToday) {
        const todayDate = new Date(todayStr + 'T12:00:00');
        const evDate = new Date(eventDateStr + 'T12:00:00');
        const days = Math.round((evDate - todayDate) / 86400000);
        if (days === 1) dateLabel = 'Tomorrow';
        else if (days > 1 && days <= 14) dateLabel += ` · in ${days} days`;
      }

      return `
        <div class="event-card" style="border-left-color:${color}">
          <div class="event-card-title">${e.title}</div>
          <div class="event-card-time">${e.all_day ? `${dateLabel} · All day` : `${dateLabel}${dateLabel ? ' · ' : ''}${formatTime(e.start_datetime)}`}</div>
          ${e.member_name ? `<div class="event-card-member" style="background:${color}22;color:${color}">${e.member_name}</div>` : ''}
          ${e.is_family ? '<div class="event-card-member" style="background:#F6BF2622;color:#c49a00">🏠 Family</div>' : ''}
        </div>`;
    }).join('');
  } catch(e) {
    el.innerHTML = '<div class="empty-state">Failed to load events</div>';
  }
}

const TOD_ORDER = ['morning', 'afternoon', 'evening'];
const TOD_LABEL = { morning: '🌅 Morning', afternoon: '☀️ Afternoon', evening: '🌙 Evening' };

function renderChoresByTOD(chores, color) {
  const grouped = { morning: [], afternoon: [], evening: [], none: [] };
  for (const c of chores) {
    (grouped[c.time_of_day] || grouped.none).push(c);
  }
  let html = '';
  for (const tod of TOD_ORDER) {
    if (!grouped[tod].length) continue;
    html += `<div class="chore-tod-group-header">${TOD_LABEL[tod]}</div>`;
    html += grouped[tod].map(c => renderDashboardChore(c, color)).join('');
  }
  html += grouped.none.map(c => renderDashboardChore(c, color)).join('');
  return html;
}

async function loadUpcomingChores() {
  const el = document.getElementById('upcomingChores');
  try {
    const [chores, members] = await Promise.all([
      API.get('/api/chores/?hide_future=true&completed=false'),
      API.get('/api/members/')
    ]);

    if (!chores.length) {
      el.innerHTML = '<div class="empty-state">🙌 All chores done!</div>';
      return;
    }

    // Group by member
    const byMember = {};
    const unassigned = [];
    for (const c of chores) {
      if (c.assigned_to) {
        if (!byMember[c.assigned_to]) byMember[c.assigned_to] = [];
        byMember[c.assigned_to].push(c);
      } else {
        unassigned.push(c);
      }
    }

    let html = '';
    for (const m of members) {
      const mChores = (byMember[m.id] || []).slice(0, 10);
      if (!mChores.length) continue;
      html += `<div class="person-chores-section">
        <div class="person-chores-header">
          <span style="font-size:20px">${m.avatar || '👤'}</span>
          <span style="color:${m.color}">${m.name}</span>
        </div>
        ${renderChoresByTOD(mChores, m.color)}
      </div>`;
    }
    if (unassigned.length) {
      html += `<div class="person-chores-section">
        <div class="person-chores-header">📋 Unassigned</div>
        ${renderChoresByTOD(unassigned.slice(0, 5), '#9AA0B8')}
      </div>`;
    }
    el.innerHTML = html || '<div class="empty-state">🙌 All chores done!</div>';
  } catch(e) {
    el.innerHTML = '<div class="empty-state">Failed to load chores</div>';
  }
}

function renderDashboardChore(c, color) {
  return `
    <div class="dashboard-chore-item ${c.completed ? 'done' : ''}" id="dchore-${c.id}" style="border-left:3px solid ${color}">
      <div class="dashboard-chore-check ${c.completed ? 'checked' : ''}"
           style="${c.completed ? `background:${color}` : `border-color:${color}`}"
           onclick="toggleDashboardChore(${c.id}, ${c.completed})">
        ${c.completed ? '✓' : ''}
      </div>
      <div class="dashboard-chore-title ${c.completed ? 'done' : ''}">${c.title}</div>
      <div class="dashboard-chore-pts">🌟${c.points}</div>
    </div>`;
}

async function toggleDashboardChore(id, currentlyCompleted) {
  try {
    await API.put(`/api/chores/${id}`, { completed: !currentlyCompleted });
    if (!currentlyCompleted) showToast('✅ Nice work! Points earned!', 'success');
    loadUpcomingChores();
  } catch(e) {
    showToast('Failed to update chore', 'error');
  }
}


// Track last-fetched HA entities for the popover
let _haEntities = [];

async function loadHAStatus() {
  const badge = document.getElementById('haStatusBadge');
  if (!badge) return;
  try {
    const data = await API.get('/api/homeassistant/states');
    if (data.error || !data.entities || !data.entities.length) {
      badge.innerHTML = '';
      _haEntities = [];
      return;
    }
    _haEntities = data.entities;
    badge.innerHTML = data.entities.map(e => {
      const isAlarm = e.entity_type === 'alarm';
      const isCover = e.entity_id.startsWith('cover.');
      const clickable = (isAlarm || isCover) ? 'ha-alarm-clickable' : '';
      const onclick = isAlarm
        ? `onclick="toggleAlarmPopover(event,'${e.entity_id}')"`
        : isCover
          ? `onclick="toggleCoverPopover(event,'${e.entity_id}')"`
          : '';
      return `
        <div class="ha-badge-item ${e.css_class} ${clickable}" ${onclick} data-entity-id="${e.entity_id}">
          <span class="ha-badge-icon">${e.icon}</span>
          <span class="ha-badge-label">${e.name}:</span>
          <span class="ha-badge-state">${e.state_label || e.state}</span>
        </div>`;
    }).join('');
  } catch(e) {
    badge.innerHTML = '';
  }
}

function toggleAlarmPopover(evt, entityId) {
  evt.stopPropagation();
  const existing = document.getElementById('haAlarmPopover');
  if (existing) { existing.remove(); return; }

  const entity = _haEntities.find(e => e.entity_id === entityId);
  if (!entity) return;

  const s = entity.state;
  const busy = s === 'arming' || s === 'pending';

  const popover = document.createElement('div');
  popover.id = 'haAlarmPopover';
  popover.className = 'ha-alarm-popover';
  popover.innerHTML = `
    <div class="ha-popover-title">🔐 ${entity.name}</div>
    <button class="ha-popover-btn ${s === 'disarmed' ? 'active' : ''}"
      ${s === 'disarmed' || busy ? 'disabled' : ''}
      onclick="popoverAlarmAction('alarm_disarm','${entityId}')">🔓 Disarm</button>
    <button class="ha-popover-btn ${s === 'armed_away' ? 'active-arm' : ''}"
      ${s === 'armed_away' || busy ? 'disabled' : ''}
      onclick="popoverAlarmAction('alarm_arm_away','${entityId}')">🏃 Arm Away</button>
    <button class="ha-popover-btn ${s === 'armed_home' ? 'active-arm' : ''}"
      ${s === 'armed_home' || busy ? 'disabled' : ''}
      onclick="popoverAlarmAction('alarm_arm_home','${entityId}')">🏠 Arm Home</button>
  `;

  // Position below the clicked badge
  const rect = evt.currentTarget.getBoundingClientRect();
  popover.style.top = (rect.bottom + 8) + 'px';
  popover.style.right = (window.innerWidth - rect.right) + 'px';
  document.body.appendChild(popover);

  // Close on outside click
  setTimeout(() => document.addEventListener('click', closeAlarmPopover, { once: true }), 0);
}

function closeAlarmPopover() {
  document.getElementById('haAlarmPopover')?.remove();
}

function optimisticHAUpdate(entityId, newState) {
  const entity = _haEntities.find(e => e.entity_id === entityId);
  if (!entity) return;
  entity.state = newState;
  // Re-derive visuals for the new state
  if (entity.entity_type === 'alarm') {
    const ALARM_LABELS = {
      disarmed: ['🔓', 'ha-alarm-disarmed', 'Disarmed'],
      armed_away: ['🔒', 'ha-alarm-armed', 'Armed Away'],
      armed_home: ['🔒', 'ha-alarm-armed', 'Armed Home'],
      arming: ['⏳', 'ha-alarm-pending', 'Arming…'],
    };
    const [icon, css, label] = ALARM_LABELS[newState] || ['❓', 'ha-state-unknown', newState];
    entity.icon = icon; entity.css_class = css; entity.state_label = label;
  } else if (entity.entity_id.startsWith('cover.')) {
    entity.icon = newState === 'open' ? '🚗' : '🏠';
    entity.css_class = newState === 'open' ? 'ha-state-open' : 'ha-state-closed';
    entity.state_label = newState;
  }
  // Re-render the badge immediately
  const badge = document.getElementById('haStatusBadge');
  if (!badge) return;
  badge.innerHTML = _haEntities.map(e => {
    const isAlarm = e.entity_type === 'alarm';
    const isCover = e.entity_id.startsWith('cover.');
    const clickable = (isAlarm || isCover) ? 'ha-alarm-clickable' : '';
    const onclick = isAlarm
      ? `onclick="toggleAlarmPopover(event,'${e.entity_id}')"`
      : isCover ? `onclick="toggleCoverPopover(event,'${e.entity_id}')"` : '';
    return `
      <div class="ha-badge-item ${e.css_class} ${clickable}" ${onclick} data-entity-id="${e.entity_id}">
        <span class="ha-badge-icon">${e.icon}</span>
        <span class="ha-badge-label">${e.name}:</span>
        <span class="ha-badge-state">${e.state_label || e.state}</span>
      </div>`;
  }).join('');
}

function toggleCoverPopover(evt, entityId) {
  evt.stopPropagation();
  const existing = document.getElementById('haCoverPopover');
  if (existing) { existing.remove(); return; }

  const entity = _haEntities.find(e => e.entity_id === entityId);
  if (!entity) return;

  const s = entity.state;
  const busy = s === 'opening' || s === 'closing';

  const popover = document.createElement('div');
  popover.id = 'haCoverPopover';
  popover.className = 'ha-alarm-popover';
  popover.innerHTML = `
    <div class="ha-popover-title">🚗 ${entity.name}</div>
    <button class="ha-popover-btn ${s === 'open' ? 'active-arm' : ''}"
      ${s === 'open' || busy ? 'disabled' : ''}
      onclick="coverAction('open_cover','${entityId}')">🔼 Open</button>
    <button class="ha-popover-btn ${s === 'closed' ? 'active' : ''}"
      ${s === 'closed' || busy ? 'disabled' : ''}
      onclick="coverAction('close_cover','${entityId}')">🔽 Close</button>
  `;

  const rect = evt.currentTarget.getBoundingClientRect();
  popover.style.top = (rect.bottom + 8) + 'px';
  popover.style.right = (window.innerWidth - rect.right) + 'px';
  document.body.appendChild(popover);

  setTimeout(() => document.addEventListener('click', () => document.getElementById('haCoverPopover')?.remove(), { once: true }), 0);
}

async function coverAction(action, entityId) {
  const btns = document.querySelectorAll('#haCoverPopover button');
  btns.forEach(b => b.disabled = true);
  try {
    await API.post(`/api/homeassistant/cover/${action}`, { entity_id: entityId });
    showToast(action === 'open_cover' ? '🔼 Opening garage…' : '🔽 Closing garage…', 'success');
    document.getElementById('haCoverPopover')?.remove();
    optimisticHAUpdate(entityId, action === 'open_cover' ? 'opening' : 'closing');
    setTimeout(loadHAStatus, 4000);
  } catch(e) {
    showToast('Failed to send command', 'error');
    btns.forEach(b => b.disabled = false);
  }
}

async function popoverAlarmAction(action, entityId) {
  const btns = document.querySelectorAll('#haAlarmPopover button');
  btns.forEach(b => b.disabled = true);
  const expectedState = action === 'alarm_disarm' ? 'disarmed'
    : action === 'alarm_arm_away' ? 'armed_away'
    : action === 'alarm_arm_home' ? 'armed_home' : 'arming';
  try {
    await API.post(`/api/homeassistant/alarm/${action}`, { entity_id: entityId });
    showToast(action === 'alarm_disarm' ? '🔓 Alarm disarmed' : '🔒 Alarm armed', 'success');
    closeAlarmPopover();
    optimisticHAUpdate(entityId, expectedState);
    setTimeout(loadHAStatus, 5000);
  } catch(e) {
    showToast('Failed to send alarm command', 'error');
    btns.forEach(b => b.disabled = false);
  }
}

async function loadWeather() {
  const el = document.getElementById('weatherWidget');
  if (!el) return;
  try {
    const data = await API.get('/api/weather/');
    if (data.error === 'no_location') { el.innerHTML = ''; return; }
    if (data.error) { el.innerHTML = ''; return; }
    el.innerHTML = `
      <div class="weather-icon">${data.icon}</div>
      <div class="weather-temp">${Math.round(data.temp)}°F</div>
      <div class="weather-condition">${data.condition}</div>
      <div class="weather-hilo">↑${Math.round(data.high)}° ↓${Math.round(data.low)}°</div>
      ${data.city ? `<div class="weather-city">${data.city}</div>` : ''}
    `;
  } catch(e) {
    el.innerHTML = '';
  }
}

async function loadStocks() {
  const el = document.getElementById('stockTicker');
  if (!el) return;
  try {
    const settingsRes = await API.get('/api/stocks/settings');
    const symbols = settingsRes.symbols || 'BTC,TSLA,SPY';
    const stocks = await API.get(`/api/stocks/?symbols=${encodeURIComponent(symbols)}`);
    if (!stocks.length) { el.style.display = 'none'; return; }
    el.style.display = 'flex';
    el.innerHTML = stocks.map(s => {
      const up = s.change_pct >= 0;
      return `<div class="ticker-item">
        <span class="ticker-symbol">${s.symbol}</span>
        <span class="ticker-price">$${s.price_fmt}</span>
        <span class="ticker-change ${up ? 'ticker-up' : 'ticker-down'}">${up ? '▲' : '▼'} ${Math.abs(s.change_pct).toFixed(2)}%</span>
      </div>`;
    }).join('<div class="ticker-sep">·</div>');
  } catch(e) {
    if (el) el.style.display = 'none';
  }
}

async function loadLunchMenu() {
  const el = document.getElementById('lunchMenu');
  if (!el) return;

  // After 5pm show tomorrow's menu
  const now = new Date();
  const isAfter5pm = now.getHours() >= 17;
  const target = new Date(now);
  if (isAfter5pm) target.setDate(target.getDate() + 1);
  const dateKey = target.getFullYear() + '-' +
    String(target.getMonth() + 1).padStart(2, '0') + '-' +
    String(target.getDate()).padStart(2, '0');
  const displayDate = target.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const titleEl = document.getElementById('lunchMenuTitle');
  if (titleEl) titleEl.textContent = '🍽️ ' + (isAfter5pm ? 'Tomorrow — ' : '') + displayDate;

  try {
    const data = await API.get(`/api/lunch/today?date=${dateKey}`);

    // Hide section entirely if lunch menu is not configured in Settings
    if (data.not_configured) {
      const section = document.getElementById('lunchSection');
      if (section) section.style.display = 'none';
      return;
    }

    // Update the "Full menu →" link using values returned from backend
    const link = document.getElementById('lunchFullMenuLink');
    if (link && data.district && data.school_slug && data.menu_type) {
      link.href = `https://${data.district}.nutrislice.com/menu/${data.school_slug}/${data.menu_type}`;
      link.style.display = '';
    }

    const { breakfast, lunch } = data;

    if (!breakfast.length && !lunch.length) {
      el.innerHTML = '<div class="empty-state">No menu available' + (isAfter5pm ? ' tomorrow' : ' today') + '</div>';
      return;
    }

    // Filter to entrees + meaningful items, skip pure condiments/milk
    const skipCategories = ['milk', 'fluid milk', 'condiment', 'condiments'];
    const filterItems = items => items.filter(i =>
      i.name && !skipCategories.includes(i.category)
    );

    const bItems = filterItems(breakfast);
    const lItems = filterItems(lunch);

    const renderRow = (emoji, label, items) => {
      if (!items.length) return '';
      const text = items.slice(0, 6).map(i =>
        i.is_entree ? `<span class="menu-entree">${i.name}</span>` : i.name
      ).join(' · ');
      return `<div class="menu-row">
        <span class="menu-row-label">${emoji} ${label}</span>
        <span class="menu-row-items">${text}</span>
      </div>`;
    };

    el.innerHTML = `<div class="menu-compact">
      ${renderRow('🌅', 'Breakfast', bItems)}
      ${renderRow('🍕', 'Lunch', lItems)}
    </div>`;
  } catch(e) {
    el.innerHTML = '<div class="empty-state">Menu unavailable today</div>';
  }
}
