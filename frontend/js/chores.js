let allChores = [];
let members = [];
let editingChoreId = null;
let showingAll = false;

const CHORE_TEMPLATES = [
  // Daily household
  { emoji: '🛏️', title: 'Make bed',           points: 1, recurrence: 'daily',    time_of_day: 'morning'   },
  { emoji: '🍽️', title: 'Set the table',       points: 1, recurrence: 'daily',    time_of_day: 'evening'   },
  { emoji: '🧊', title: 'Empty dishwasher',    points: 1, recurrence: 'daily',    time_of_day: 'morning'   },
  { emoji: '🫧', title: 'Do the dishes',        points: 2, recurrence: 'daily',    time_of_day: 'evening'   },
  { emoji: '🗑️', title: 'Take out trash',      points: 2, recurrence: 'weekly',   time_of_day: 'evening'   },
  { emoji: '🧹', title: 'Sweep floors',         points: 2, recurrence: 'daily',    time_of_day: ''          },
  { emoji: '🧺', title: 'Do laundry',           points: 3, recurrence: 'weekly',   time_of_day: ''          },
  { emoji: '🧹', title: 'Vacuum',               points: 2, recurrence: 'weekly',   time_of_day: ''          },
  { emoji: '🪣', title: 'Mop floors',           points: 3, recurrence: 'weekly',   time_of_day: ''          },
  { emoji: '🚿', title: 'Clean bathroom',       points: 3, recurrence: 'weekly',   time_of_day: ''          },
  { emoji: '🪟', title: 'Wipe counters',        points: 1, recurrence: 'daily',    time_of_day: 'evening'   },
  // Pets
  { emoji: '🐕', title: 'Feed dog',             points: 1, recurrence: 'daily',    time_of_day: 'morning'   },
  { emoji: '🐕', title: 'Walk dog',             points: 2, recurrence: 'daily',    time_of_day: 'morning'   },
  { emoji: '🐈', title: 'Feed cat',             points: 1, recurrence: 'daily',    time_of_day: 'morning'   },
  { emoji: '🐠', title: 'Feed fish',            points: 1, recurrence: 'daily',    time_of_day: 'morning'   },
  // Outdoor
  { emoji: '🌿', title: 'Water plants',         points: 1, recurrence: 'daily',    time_of_day: 'morning'   },
  { emoji: '🌱', title: 'Mow lawn',             points: 5, recurrence: 'weekly',   time_of_day: ''          },
  // Kids / school
  { emoji: '🎒', title: 'Pack school bag',      points: 1, recurrence: 'weekdays', time_of_day: 'evening'   },
  { emoji: '📚', title: 'Read for 20 minutes',  points: 2, recurrence: 'daily',    time_of_day: 'evening'   },
  { emoji: '🧸', title: 'Clean room',           points: 2, recurrence: 'weekly',   time_of_day: ''          },
  { emoji: '🍱', title: 'Pack lunch',           points: 2, recurrence: 'weekdays', time_of_day: 'evening'   },
];

const TOD_CONFIG = {
  morning:   { label: 'Morning',   emoji: '🌅', color: '#FF9500', light: '#FFF3E0' },
  afternoon: { label: 'Afternoon', emoji: '☀️',  color: '#FF6B35', light: '#FFF0E6' },
  evening:   { label: 'Evening',   emoji: '🌙', color: '#5C6BC0', light: '#EDE7F6' },
  anytime:   { label: 'Anytime',   emoji: '📋', color: '#78909C', light: '#ECEFF1' },
};

document.addEventListener('DOMContentLoaded', async () => {
  members = await API.get('/api/members/');
  populateMemberSelect();
  loadChores();
  loadLeaderboard();

  document.getElementById('addChoreBtn').onclick = () => openChoreModal();
  document.getElementById('closeChoreModal').onclick = closeChoreModal;
  document.getElementById('cancelChoreModal').onclick = closeChoreModal;
  document.getElementById('saveChore').onclick = saveChore;
  document.getElementById('choreModal').onclick = e => { if (e.target.id === 'choreModal') closeChoreModal(); };
  document.getElementById('toggleAllChores').onclick = () => {
    showingAll = !showingAll;
    document.getElementById('toggleAllChores').textContent = showingAll ? '📅 Today Only' : '📋 All Chores';
    loadChores();
  };
});

function populateMemberSelect() {
  document.getElementById('choreAssigned').innerHTML =
    '<option value="">Unassigned</option>' +
    members.map(m => `<option value="${m.id}">${m.avatar || '👤'} ${m.name}</option>`).join('');
  const container = document.getElementById('multiAssignCheckboxes');
  if (container) {
    container.innerHTML = members.map(m => `
      <label class="member-checkbox-label" id="mcheck_${m.id}">
        <input type="checkbox" value="${m.id}" onchange="updateMemberCheckStyle(${m.id}, '${m.color}')">
        ${m.avatar || '👤'} ${m.name}
      </label>`).join('');
  }
  const multiSection = document.getElementById('multiAssignSection');
  if (multiSection && members.length > 1) multiSection.style.display = 'block';
}

function updateMemberCheckStyle(id, color) {
  const label = document.getElementById('mcheck_' + id);
  const input = label.querySelector('input');
  if (input.checked) { label.classList.add('checked'); label.style.background = color; }
  else { label.classList.remove('checked'); label.style.background = ''; }
}

function onRecurrenceChange() {
  const val = document.getElementById('choreRecurrence').value;
  document.getElementById('customDaysSection').style.display = val === 'custom_days' ? 'block' : 'none';
}

function updateTodBtnStyles() {
  document.querySelectorAll('.tod-btn').forEach(label => {
    const input = label.querySelector('input');
    label.classList.toggle('active', input.checked && input.value !== '');
  });
}

async function loadChores() {
  try {
    const url = showingAll ? '/api/chores/' : '/api/chores/?hide_future=true';
    allChores = await API.get(url);
    renderChores();
  } catch(e) {
    document.getElementById('choresList').innerHTML = '<div class="empty-state">Failed to load chores</div>';
  }
}

function isTodayChore(c) {
  const _d = new Date();
  const today = `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,'0')}-${String(_d.getDate()).padStart(2,'0')}`;
  const todayDow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][_d.getDay()];

  // If there's a specific due_date, that's the source of truth
  if (c.due_date) return c.due_date === today;

  // No due_date — fall back to recurrence type to decide if due today
  if (!c.recurrence) return true;
  if (c.recurrence === 'weekdays') return new Date().getDay() >= 1 && new Date().getDay() <= 5;
  if (c.recurrence === 'custom_days') {
    return (c.recurrence_days||'').split(',').map(d=>d.trim()).includes(todayDow);
  }
  return true;
}

function isOverdueChore(c) {
  if (c.completed || !c.due_date) return false;
  const today = toETDateStr(new Date());
  const cutoff = toETDateStr(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000));
  return c.due_date < today && c.due_date >= cutoff;
}

function missedDateLabel(dateStr) {
  const yesterday = toETDateStr(new Date(Date.now() - 1 * 24 * 60 * 60 * 1000));
  const twoDaysAgo = toETDateStr(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
  if (dateStr === yesterday) return 'Yesterday';
  if (dateStr === twoDaysAgo) return '2 days ago';
  return '3 days ago';
}

function renderChores() {
  const el = document.getElementById('choresList');
  const chores = showingAll ? allChores : allChores.filter(isTodayChore);

  if (!chores.length) {
    el.innerHTML = showingAll
      ? '<div class="empty-state">No chores yet — add one!</div>'
      : '<div class="empty-state">🎉 No chores due today!</div>';
    return;
  }

  if (showingAll) {
    // Simple grouped-by-person list for All view
    el.innerHTML = buildAllView(chores);
    return;
  }

  // TODAY VIEW: columns per person, each with time-of-day sections
  const missed = allChores.filter(isOverdueChore);
  const memberCols = members.map(m => ({
    member: m,
    chores: chores.filter(c => c.assigned_to == m.id),
    missed: missed.filter(c => c.assigned_to == m.id),
  })).filter(b => b.chores.length || b.missed.length);

  const unassigned = chores.filter(c => !c.assigned_to);
  if (unassigned.length) {
    memberCols.push({ member: { id: null, name: 'Unassigned', avatar: '📋', color: '#9AA0B8' }, chores: unassigned, missed: [] });
  }

  if (!memberCols.length) {
    el.innerHTML = '<div class="empty-state">🎉 All done for today!</div>';
    return;
  }

  el.innerHTML = `<div class="chore-columns">${memberCols.map(b => buildPersonColumn(b.member, b.chores, b.missed)).join('')}</div>`;
}

function buildPersonColumn(member, chores, missed = []) {
  const total = chores.length;
  const done = chores.filter(c => c.completed).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const circumference = 2 * Math.PI * 18; // radius 18
  const dashOffset = circumference - (pct / 100) * circumference;

  const overallRing = `
    <svg width="44" height="44" viewBox="0 0 44 44" style="transform:rotate(-90deg)">
      <circle cx="22" cy="22" r="18" fill="none" stroke="${member.color}22" stroke-width="4"/>
      <circle cx="22" cy="22" r="18" fill="none" stroke="${member.color}" stroke-width="4"
        stroke-dasharray="${circumference}" stroke-dashoffset="${dashOffset}"
        stroke-linecap="round" style="transition:stroke-dashoffset 0.4s ease"/>
    </svg>
    <span style="position:absolute;font-size:10px;font-weight:900;color:${member.color}">${done}/${total}</span>`;

  // Group chores into time-of-day buckets
  const buckets = { morning: [], afternoon: [], evening: [], anytime: [] };
  for (const c of chores) {
    const tod = c.time_of_day || 'anytime';
    buckets[tod].push(c);
  }

  const todSummary = Object.entries(TOD_CONFIG).map(([key, cfg]) => {
    const b = buckets[key];
    if (!b.length) return '';
    const bdone = b.filter(c => c.completed).length;
    const allDone = bdone === b.length;
    return `<div class="tod-summary-chip ${allDone ? 'done' : ''}" style="color:${cfg.color};background:${allDone ? cfg.color+'22' : 'var(--bg)'}">
      ${cfg.emoji} ${bdone}/${b.length}
    </div>`;
  }).join('');

  const sections = Object.entries(TOD_CONFIG).map(([key, cfg]) => {
    const b = buckets[key];
    if (!b.length) return '';
    const bdone = b.filter(c => c.completed).length;
    return `
      <div class="tod-section">
        <div class="tod-section-header" style="color:${cfg.color}">
          <span>${cfg.emoji} ${cfg.label}</span>
          <span class="tod-section-progress">${bdone}/${b.length}</span>
        </div>
        ${b.map(c => renderChoreCard(c, member.color)).join('')}
      </div>`;
  }).join('');

  const missedSection = missed.length ? `
    <div class="tod-section missed-section">
      <div class="tod-section-header" style="color:var(--text-muted)">
        <span>❌ Missed</span>
        <span class="tod-section-progress">${missed.length}</span>
      </div>
      ${missed.map(c => renderMissedChoreCard(c)).join('')}
    </div>` : '';

  return `
    <div class="chore-column">
      <div class="chore-column-header" style="border-bottom:3px solid ${member.color}">
        <div style="position:relative;display:flex;align-items:center;justify-content:center;width:44px;height:44px;flex-shrink:0">
          ${overallRing}
        </div>
        <div style="flex:1;min-width:0">
          <div class="chore-column-name" style="color:${member.color}">${member.avatar || '👤'} ${member.name}</div>
          <div class="tod-summary-row">${todSummary}</div>
        </div>
      </div>
      <div class="chore-column-body">${sections || '<div class="empty-state" style="padding:16px">🎉 All done!</div>'}${missedSection}</div>
    </div>`;
}

function renderMissedChoreCard(c) {
  return `
    <div class="chore-card missed">
      <div class="chore-card-check missed-x">✕</div>
      <div class="chore-card-body">
        <div class="chore-card-title done">${c.title}</div>
        <div class="chore-card-pts" style="color:var(--text-muted)">📅 ${missedDateLabel(c.due_date)}</div>
      </div>
    </div>`;
}

function renderChoreCard(c, color) {
  const isDone = c.completed;
  return `
    <div class="chore-card ${isDone ? 'done' : ''}" id="chore-${c.id}" style="border-left:3px solid ${color};background:${color}18">
      <div class="chore-card-check ${isDone ? 'checked' : ''}"
           style="${isDone ? `background:${color};border-color:${color}` : `border-color:${color}`}"
           onclick="toggleChore(${c.id}, ${isDone})">
        ${isDone ? '✓' : ''}
      </div>
      <div class="chore-card-body">
        <div class="chore-card-title ${isDone ? 'done' : ''}">${c.title}</div>
        ${c.description ? `<div class="chore-card-desc">${c.description}</div>` : ''}
        <div class="chore-card-pts">🌟 ${c.points} pt${c.points !== 1 ? 's' : ''}</div>
      </div>
      <div class="chore-card-actions">
        <button class="chore-action-btn" onclick="openChoreModal(${c.id})">✏️</button>
        <button class="chore-action-btn delete" onclick="deleteChore(${c.id})">🗑</button>
      </div>
    </div>`;
}

function buildAllView(chores) {
  const byMember = {};
  const unassigned = [];
  for (const c of chores) {
    if (c.assigned_to) {
      if (!byMember[c.assigned_to]) byMember[c.assigned_to] = [];
      byMember[c.assigned_to].push(c);
    } else unassigned.push(c);
  }
  let cols = '';
  for (const m of members) {
    if (!byMember[m.id]?.length) continue;
    cols += `
      <div class="chore-column">
        <div class="chore-column-header" style="border-bottom:3px solid ${m.color}">
          <span style="font-size:24px">${m.avatar||'👤'}</span>
          <div class="chore-column-name" style="color:${m.color}">${m.name}</div>
        </div>
        <div class="chore-column-body">${byMember[m.id].map(c => renderChoreItemFull(c)).join('')}</div>
      </div>`;
  }
  if (unassigned.length) {
    cols += `
      <div class="chore-column">
        <div class="chore-column-header" style="border-bottom:3px solid #9AA0B8">
          <span style="font-size:24px">📋</span>
          <div class="chore-column-name">Unassigned</div>
        </div>
        <div class="chore-column-body">${unassigned.map(c => renderChoreItemFull(c)).join('')}</div>
      </div>`;
  }
  return cols ? `<div class="chore-columns">${cols}</div>` : '<div class="empty-state">No chores yet!</div>';
}

function renderChoreItemFull(c) {
  const color = c.member_color || '#9AA0B8';
  const isDone = c.completed;
  const rec = c.recurrence ? `🔁 ${c.recurrence === 'custom_days' ? c.recurrence_days : c.recurrence}` : '';
  const tod = c.time_of_day ? `<span class="chore-tod chore-tod-${c.time_of_day}">${TOD_CONFIG[c.time_of_day]?.emoji} ${c.time_of_day}</span>` : '';
  return `
    <div class="chore-item ${isDone ? 'completed' : ''}" id="chore-${c.id}" style="border-left:3px solid ${color};background:${color}18">
      <div class="chore-check ${isDone ? 'checked' : ''}"
           style="${isDone ? `background:${color};border-color:${color}` : `border-color:${color}`}"
           onclick="toggleChore(${c.id}, ${isDone})">${isDone ? '✓' : ''}</div>
      <div class="chore-info">
        <div class="chore-title ${isDone ? 'done' : ''}">${c.title}</div>
        <div class="chore-meta">
          ${c.due_date ? `<span class="chore-due">📅 ${c.due_date}</span>` : ''}
          ${tod}
          <span class="chore-points">🌟 ${c.points}pt</span>
          ${rec ? `<span class="chore-recurrence">${rec}</span>` : ''}
          ${c.member_name ? `<span class="chore-badge" style="background:${color}">${c.member_name}</span>` : ''}
        </div>
      </div>
      <div class="chore-actions">
        <button class="chore-action-btn" onclick="openChoreModal(${c.id})">✏️</button>
        <button class="chore-action-btn delete" onclick="deleteChore(${c.id})">🗑</button>
      </div>
    </div>`;
}

async function toggleChore(id, currentlyCompleted) {
  const el = document.getElementById(`chore-${id}`);
  if (el && !currentlyCompleted) el.style.opacity = '0.5';
  try {
    await API.put(`/api/chores/${id}`, { completed: !currentlyCompleted });
    await loadChores();
    if (!currentlyCompleted) showToast('🌟 Great job! Points earned!', 'success');
  } catch(e) {
    showToast('Failed to update chore', 'error');
    if (el) el.style.opacity = '';
  }
}

function renderChoreTemplates() {
  const grid = document.getElementById('choreTemplateGrid');
  if (!grid) return;
  grid.innerHTML = CHORE_TEMPLATES.map((t, i) =>
    `<button class="chore-template-chip" onclick="selectChoreTemplate(${i})">${t.emoji} ${t.title}</button>`
  ).join('');
}

function selectChoreTemplate(i) {
  const t = CHORE_TEMPLATES[i];
  document.getElementById('choreTitle').value = t.title;
  document.getElementById('chorePoints').value = t.points;
  document.getElementById('choreRecurrence').value = t.recurrence || '';
  document.querySelectorAll('input[name="timeOfDay"]').forEach(r => r.checked = (r.value === (t.time_of_day || '')));
  updateTodBtnStyles();
  onRecurrenceChange();
  // Highlight selected chip
  document.querySelectorAll('.chore-template-chip').forEach((btn, idx) => btn.classList.toggle('selected', idx === i));
  document.getElementById('choreTitle').focus();
}

function openChoreModal(choreId) {
  editingChoreId = choreId || null;
  document.getElementById('choreModalTitle').textContent = choreId ? 'Edit Chore' : 'Add Chore';
  // Show templates only when adding new chore
  const templateSection = document.getElementById('choreTemplateSection');
  if (templateSection) templateSection.style.display = choreId ? 'none' : '';
  if (choreId) {
    const c = allChores.find(c => c.id === choreId);
    if (c) {
      document.getElementById('choreTitle').value = c.title;
      document.getElementById('choreDesc').value = c.description || '';
      document.getElementById('choreAssigned').value = c.assigned_to || '';
      document.getElementById('choreDue').value = c.due_date || '';
      document.getElementById('choreRecurrence').value = c.recurrence || '';
      document.getElementById('chorePoints').value = c.points || 1;
      document.querySelectorAll('input[name="timeOfDay"]').forEach(r => r.checked = (r.value === (c.time_of_day || '')));
      updateTodBtnStyles();
      onRecurrenceChange();
      if (c.recurrence_days) {
        const days = c.recurrence_days.split(',');
        document.querySelectorAll('#customDaysSection input[type=checkbox]').forEach(cb => {
          cb.checked = days.includes(cb.value);
        });
      }
    }
  } else {
    document.getElementById('choreTitle').value = '';
    document.getElementById('choreDesc').value = '';
    document.getElementById('choreAssigned').value = '';
    document.getElementById('choreDue').value = '';
    document.getElementById('choreRecurrence').value = '';
    document.getElementById('chorePoints').value = 1;
    const noneRadio = document.querySelector('input[name="timeOfDay"][value=""]');
    if (noneRadio) { noneRadio.checked = true; updateTodBtnStyles(); }
    document.getElementById('customDaysSection').style.display = 'none';
    document.querySelectorAll('#customDaysSection input').forEach(cb => cb.checked = false);
    document.querySelectorAll('#multiAssignCheckboxes .member-checkbox-label').forEach(l => {
      l.classList.remove('checked'); l.style.background = ''; l.querySelector('input').checked = false;
    });
    renderChoreTemplates();
  }
  document.getElementById('choreModal').style.display = 'flex';
  document.getElementById('choreTitle').focus();
}

function closeChoreModal() {
  document.getElementById('choreModal').style.display = 'none';
}

async function saveChore() {
  const title = document.getElementById('choreTitle').value.trim();
  if (!title) { showToast('Please enter a chore title', 'error'); return; }
  const recurrence = document.getElementById('choreRecurrence').value || null;
  const customDays = recurrence === 'custom_days'
    ? [...document.querySelectorAll('#customDaysSection input:checked')].map(cb => cb.value).join(',')
    : null;
  const checkedMembers = [...document.querySelectorAll('#multiAssignCheckboxes input:checked')].map(cb => parseInt(cb.value));
  const singleAssign = document.getElementById('choreAssigned').value || null;
  const timeOfDay = document.querySelector('input[name="timeOfDay"]:checked')?.value || null;
  const payload = {
    title,
    description: document.getElementById('choreDesc').value.trim(),
    assigned_to: checkedMembers.length === 1 ? checkedMembers[0] : (singleAssign ? parseInt(singleAssign) : null),
    assign_to_members: checkedMembers.length > 1 ? checkedMembers : null,
    due_date: document.getElementById('choreDue').value || null,
    recurrence,
    recurrence_days: customDays,
    points: parseInt(document.getElementById('chorePoints').value) || 1,
    time_of_day: timeOfDay || null,
  };
  try {
    if (editingChoreId) {
      await API.put(`/api/chores/${editingChoreId}`, payload);
      showToast('✅ Chore updated!', 'success');
    } else {
      await API.post('/api/chores/', payload);
      showToast('✅ Chore added!', 'success');
    }
    closeChoreModal();
    loadChores();
  } catch(e) {
    showToast('Failed to save chore', 'error');
  }
}

async function deleteChore(id) {
  if (!confirm('Delete this chore?')) return;
  try {
    await API.delete(`/api/chores/${id}`);
    showToast('Chore deleted', '');
    loadChores();
  } catch(e) {
    showToast('Failed to delete', 'error');
  }
}

// Attach tod change listener after DOM ready
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('input[name="timeOfDay"]').forEach(r => {
    r.addEventListener('change', updateTodBtnStyles);
  });
});

async function loadLeaderboard() {
  const el = document.getElementById('leaderboard');
  if (!el) return;
  try {
    const data = await API.get('/api/chores/leaderboard');
    if (!data.length) {
      el.innerHTML = '<div class="empty-state">No family members yet</div>';
      return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    const rankClass = ['first', 'second', 'third'];
    el.innerHTML = data.map((m, i) => `
      <div class="leaderboard-item">
        <div class="leaderboard-rank ${rankClass[i] || ''}">${medals[i] || (i + 1)}</div>
        <div class="member-avatar" style="background:${m.color}22;font-size:22px;width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;">${m.avatar || '👤'}</div>
        <div class="leaderboard-info">
          <div class="leaderboard-name">${m.name}</div>
          <div class="leaderboard-sub">${m.completed_chores || 0} chores done</div>
        </div>
        <div>
          <div class="leaderboard-points">${m.points || 0}</div>
          <div class="leaderboard-pts-label">pts</div>
        </div>
      </div>
    `).join('');
  } catch(e) {
    el.innerHTML = '<div class="empty-state">Failed to load leaderboard</div>';
  }
}
