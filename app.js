const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const DEFAULT_PIN = '1234';
let READONLY = true;

// GESTIONE ACCESSO ADMIN
window.handleAuthClick = function() {
  if (READONLY) {
    promptLogin();
  } else {
    sessionStorage.removeItem('partite_admin_auth');
    setAuthMode(false);
    toast('Disconnesso: sola lettura');
  }
};

function isModalOpen() {
  return !!document.querySelector('.ov');
}

// MODULO HAPTIC & TOAST
function triggerHaptic(type = 'light') {
  if (window.Telegram?.WebApp?.HapticFeedback) {
    if (type === 'success') window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
    else if (type === 'warning') window.Telegram.WebApp.HapticFeedback.notificationOccurred('warning');
    else window.Telegram.WebApp.HapticFeedback.impactOccurred('medium');
    return;
  }
  if (navigator.vibrate) {
    if (type === 'success') navigator.vibrate([30, 40, 40]);
    else if (type === 'warning') navigator.vibrate([50, 60, 50]);
    else navigator.vibrate(35);
  }
}

let toastTimer = null;
function toast(t, hapticType = 'light') {
  triggerHaptic(hapticType);
  const m = $('#msg');
  if (m) {
    m.textContent = t;
    m.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => m.classList.remove('on'), 2300);
  }
}

// CONFIGURAZIONE SUPABASE
const SUPABASE_CONFIG = {
  url: 'https://bhyfeoyyuscrsypaiemx.supabase.co',
  key: 'sb_publishable_dQyrFbjusGoZtWr1MHkoiA_VPVngPrC',
  board: 'partite'
};

let swRegistration = null;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(reg => { swRegistration = reg; })
    .catch(() => {});
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    toast('Notifiche non supportate', 'warning');
    return false;
  }
  if (Notification.permission === 'granted') {
    toast('Notifiche già attive');
    return true;
  }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    toast('Notifiche attivate!', 'success');
    checkAndTriggerScheduledNotifications();
    return true;
  }
  toast('Permesso non concesso', 'warning');
  return false;
}

function dispatchAppNotification(title, bodyText, tag = 'partite-alert') {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const cfg = {
    body: bodyText,
    tag: tag,
    icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"%3E%3Crect width="512" height="512" rx="110" fill="%231d5fa8"/%3E%3Ccircle cx="256" cy="256" r="160" fill="none" stroke="white" stroke-width="28"/%3E%3C/svg%3E',
    badge: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"%3E%3Crect width="512" height="512" rx="256" fill="%231d5fa8"/%3E%3C/svg%3E',
    vibrate: [200, 100, 200]
  };
  if (swRegistration && swRegistration.showNotification) {
    swRegistration.showNotification(title, cfg);
  } else {
    new Notification(title, cfg);
  }
}

function isRefereeNeeded(cat, isFriendly) {
  if (isFriendly) return true;
  if (!cat) return true;
  const c = cat.toUpperCase().replace(/\s+/g, '');
  return !(c === 'U15' || c === 'U17' || c === 'U19');
}

function isMissingRequirements(item) {
  const hasT1 = !!(item.t1 && item.t1.trim());
  const hasT2 = !!(item.t2 && item.t2.trim());
  const hasArb = !!(item.arb && item.arb.trim());

  if (!hasT1) return true;
  if (item.friendly) return !hasArb;
  if (!hasT2) return true;
  if (isRefereeNeeded(item.cat, false) && !hasArb) return true;
  return false;
}

function isWithinOneDayOrLess(dateStr) {
  if (!dateStr) return false;
  const now = new Date();
  const todayIso = iso(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return (dateStr === todayIso || dateStr === iso(tomorrow));
}

function getUrgentIncompleteMatches() {
  return items.filter(it => isWithinOneDayOrLess(it.date) && isMissingRequirements(it));
}

// CALCOLO ESITO E PUNTEGGIO
function getMatchOutcome(item) {
  if (item.status === 'sospesa') return { type: 'suspended', label: 'Sospesa' };
  if (item.status === 'vinta') return { type: 'win', label: item.score ? `${item.score} (V)` : 'Vinta' };
  if (item.status === 'persa') return { type: 'loss', label: item.score ? `${item.score} (P)` : 'Persa' };

  if (item.score && String(item.score).includes('-')) {
    const [h, a] = item.score.split('-').map(x => parseInt(x.trim(), 10));
    if (!isNaN(h) && !isNaN(a)) {
      if (h > a) return { type: 'win', label: `${h}-${a}` };
      if (h < a) return { type: 'loss', label: `${h}-${a}` };
      return { type: 'suspended', label: `${h}-${a}` };
    }
  }
  return null;
}

function checkPersonRosterConflicts(targetMatchId, date, timeStr, t1, t2, arb) {
  if (!date || !timeStr) return [];
  const assigned = [t1, t2, arb].map(x => (x || '').trim().toLowerCase()).filter(Boolean);
  if (!assigned.length) return [];

  const [th, tm] = timeStr.split(':').map(Number);
  const targetMinutes = th * 60 + tm;
  const conflicts = [];

  items.filter(it => it.id !== targetMatchId && it.date === date && it.time).forEach(it => {
    const [oh, om] = it.time.split(':').map(Number);
    const otherMinutes = oh * 60 + om;
    const diff = Math.abs(targetMinutes - otherMinutes);

    if (diff < 120) {
      const otherNames = [it.t1, it.t2, it.arb].map(x => (x || '').trim().toLowerCase()).filter(Boolean);
      assigned.forEach(n => {
        if (otherNames.includes(n)) {
          conflicts.push(`⚠️ <b>${n.toUpperCase()}</b> è già impegnato alle ${it.time} (${it.title || 'Altra gara'})`);
        }
      });
    }
  });

  return [...new Set(conflicts)];
}

function checkAndTriggerScheduledNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const now = new Date();
  const todayIso = iso(now);
  const currentHour = now.getHours();

  if (now.getDay() === 3 && currentHour >= 10) {
    const wedKey = `notif_wed_${todayIso}`;
    if (!localStorage.getItem(wedKey)) {
      dispatchAppNotification(
        '🏀 Promemoria Invio Turni',
        'È mercoledì! Ricordati di inviare i turni per le partite da domani a mercoledì prossimo.',
        'wed-rolling-reminder'
      );
      localStorage.setItem(wedKey, '1');
    }
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowIso = iso(tomorrow);

  const urgentToNotify = items.filter(it => {
    if (!isMissingRequirements(it)) return false;
    if (it.date === todayIso) return true;
    if (it.date === tomorrowIso && currentHour >= 10) return true;
    return false;
  });

  if (urgentToNotify.length > 0) {
    const hourlyKey = `notif_urgent_${todayIso}_h${currentHour}`;
    if (!localStorage.getItem(hourlyKey)) {
      dispatchAppNotification(
        '⚠️ Turni partite da completare!',
        `Ci sono ${urgentToNotify.length} partite imminenti senza tutti i refertisti/arbitri assegnati!`,
        'urgent-incomplete-imminent'
      );
      localStorage.setItem(hourlyKey, '1');
    }
  }
}

setInterval(checkAndTriggerScheduledNotifications, 60000);

// GESTIONE TEMI
let currentTheme = localStorage.getItem('partite-theme') || 'default';
function applyTheme(themeName) {
  currentTheme = themeName;
  if (themeName === 'default') document.body.removeAttribute('data-theme');
  else document.body.setAttribute('data-theme', themeName);
  localStorage.setItem('partite-theme', themeName);
}
if (currentTheme !== 'default') applyTheme(currentTheme);

// STATO & MEMORIA LOCALE
const KEY = 'partite-v1';
let items = [];
try { items = JSON.parse(localStorage.getItem(KEY)) || []; } catch(e){}

let dayMeta = {};
try { dayMeta = JSON.parse(localStorage.getItem('partite-giorni-v1')) || {}; } catch(e){}

let molt = {};
try { molt = JSON.parse(localStorage.getItem('partite-molt-v1')) || {}; } catch(e){}

let names = [];
try { names = JSON.parse(localStorage.getItem('partite-nomi-v1')) || []; } catch(e){}

let categories = [];
try { categories = JSON.parse(localStorage.getItem('partite-categorie-v1')) || []; } catch(e){}

let pinHash = null;
let isDirty = false;

const saveLocalOnly = () => {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch(e){}
  updateIncompleteBadge();
  updateAlertStatusBadge();
  isDirty = true;
};
const saveDLocalOnly = () => {
  try { localStorage.setItem('partite-giorni-v1', JSON.stringify(dayMeta)); } catch(e){}
  isDirty = true;
};
const saveMoltLocal = () => {
  try { localStorage.setItem('partite-molt-v1', JSON.stringify(molt)); } catch(e){}
  isDirty = true;
};
const saveNamesLocal = () => {
  try { localStorage.setItem('partite-nomi-v1', JSON.stringify(names)); } catch(e){}
  isDirty = true;
};
const saveCategoriesLocal = () => {
  try { localStorage.setItem('partite-categorie-v1', JSON.stringify(categories)); } catch(e){}
  isDirty = true;
};

const save = () => { saveLocalOnly(); scheduleCloudPush(); };
const saveD = () => { saveDLocalOnly(); scheduleCloudPush(); };
const saveMolt = () => { saveMoltLocal(); scheduleCloudPush(); };
const saveNames = () => { saveNamesLocal(); scheduleCloudPush(); };
const saveCategories = () => { saveCategoriesLocal(); scheduleCloudPush(); };

let sb = null;
try {
  if (window.supabase && SUPABASE_CONFIG.url && SUPABASE_CONFIG.key) {
    sb = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key);
  }
} catch(e) {
  sb = null;
}

function setSyncVisualState(state, tooltip) {
  const dot = document.getElementById('syncDot');
  const wrap = document.getElementById('syncIndicatorWrap');
  if (!wrap || !dot) return;
  wrap.style.display = 'inline-flex';
  if (state === 'orange') {
    dot.className = 'sync-dot sync-orange';
    dot.title = tooltip || 'Sincronizzazione…';
  } else if (state === 'green') {
    dot.className = 'sync-dot sync-green';
    dot.title = tooltip || (sb ? 'Sincronizzato Realtime' : 'Memoria locale');
  } else if (state === 'red') {
    dot.className = 'sync-dot sync-red';
    dot.title = tooltip || 'Cloud non raggiungibile';
  }
}

async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function cloudFetchRaw() {
  if (!sb) return null;
  try {
    const { data, error } = await sb.from('partite_board').select('data').eq('id', SUPABASE_CONFIG.board).maybeSingle();
    if (error) return null;
    return data && data.data ? data.data : null;
  } catch(e) { return null; }
}

function applyCloudData(raw) {
  if (!raw) return;
  items = Array.isArray(raw.items) ? raw.items : [];
  dayMeta = raw.dayMeta && typeof raw.dayMeta === 'object' ? raw.dayMeta : {};
  molt = raw.molt && typeof raw.molt === 'object' ? raw.molt : {};
  names = Array.isArray(raw.names) ? raw.names : [];
  categories = Array.isArray(raw.categories) ? raw.categories : [];
  if (raw.pinHash) pinHash = raw.pinHash;
  isDirty = false;
  saveLocalOnly(); saveDLocalOnly(); saveMoltLocal(); saveNamesLocal(); saveCategoriesLocal();
  isDirty = false;
  renderNamesList(); renderCategoriesList();
}

async function cloudPushNow() {
  if (!sb || READONLY) return false;
  setSyncVisualState('orange');
  try {
    const { error } = await sb.from('partite_board').upsert({
      id: SUPABASE_CONFIG.board,
      data: { items, dayMeta, molt, names, categories, pinHash },
      updated_at: new Date().toISOString()
    });
    if (error) throw error;
    isDirty = false;
    setSyncVisualState('green');
    return true;
  } catch (err) {
    setSyncVisualState('red');
    return false;
  }
}

let syncTimer = null;
function scheduleCloudPush() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(cloudPushNow, 1200);
}

async function cloudPullSafe(silent) {
  if (!sb) return false;
  if (isDirty && !READONLY) await cloudPushNow();
  if (!silent) setSyncVisualState('orange');
  try {
    const raw = await cloudFetchRaw();
    if (raw) {
      applyCloudData(raw);
      setSyncVisualState('green');
      return true;
    }
    setSyncVisualState('green');
    return false;
  } catch(e) {
    setSyncVisualState('red');
    return false;
  }
}

function setupSupabaseRealtime() {
  if (!sb) return;
  try {
    sb.channel('realtime_partite_board')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'partite_board', filter: `id=eq.${SUPABASE_CONFIG.board}` },
        payload => {
          if (payload.new && payload.new.data) {
            if (!isDirty && !isModalOpen()) {
              applyCloudData(payload.new.data);
              render();
              triggerHaptic('light');
              setSyncVisualState('green', 'Aggiornato in tempo reale');
            }
          }
        }
      )
      .subscribe(status => {
        if (status === 'SUBSCRIBED') setSyncVisualState('green', 'Connesso Realtime');
      });
  } catch (e) {
    console.warn('Realtime fallback attivo', e);
  }
}

setInterval(() => {
  if (isDirty && sb && !READONLY && !isModalOpen()) cloudPushNow();
}, 5000);

let filterCat = '';
let filterIncomplete = false;
let searchQuery = '';

function renderNamesList() {
  const dl = document.getElementById('namesList');
  if (dl) dl.innerHTML = names.map(n => `<option value="${esc(n)}">`).join('');
}

function renderCategoriesList() {
  const dl = document.getElementById('categoriesList');
  if (dl) dl.innerHTML = categories.map(c => `<option value="${esc(c)}">`).join('');
  const sel = document.getElementById('filterCat');
  if (sel) {
    const cur = sel.value;
    sel.innerHTML = '<option value="">Tutte le categorie</option>' + categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    sel.value = categories.includes(cur) ? cur : '';
  }
}

function updateIncompleteBadge() {
  const b = document.getElementById('incCount');
  if (!b) return;
  const count = items.filter(isMissingRequirements).length;
  b.textContent = count ? `(${count})` : '';
}

// OTTIMIZZATO O(N): Rileva match in conflitto con Set
function findConflictingMatches() {
  const conflicts = new Map();
  const groups = {};
  items.forEach(it => {
    if (it.date && it.time && it.time.trim()) {
      const key = `${it.date}_${it.time.trim()}`;
      (groups[key] ??= []).push(it);
    }
  });
  Object.values(groups).forEach(list => {
    if (list.length > 1) {
      list.forEach(m => {
        const others = list.filter(o => o.id !== m.id);
        conflicts.set(m.id, others);
      });
    }
  });
  return conflicts;
}

function updateAlertStatusBadge() {
  const btn = document.getElementById('conflictAlertBtn');
  if (!btn) return;

  const conflictsMap = findConflictingMatches();
  const conflictCount = conflictsMap.size;
  const urgentIncomplete = getUrgentIncompleteMatches();

  if (conflictCount > 0) {
    btn.className = 'alert-btn-standalone status-conflict';
    btn.textContent = `❗ ${conflictCount}`;
    btn.title = `${conflictCount} partite in conflitto di orario! Clicca per risolvere.`;
    btn.onclick = openConflictsModal;
    return;
  }

  if (urgentIncomplete.length > 0) {
    btn.className = 'alert-btn-standalone status-urgent-incomplete';
    btn.textContent = `⚠️ ${urgentIncomplete.length}`;
    btn.title = `${urgentIncomplete.length} gara/e a meno di un giorno ancora con turni incompleti!`;
    btn.onclick = openUrgentIncompleteModal;
    return;
  }

  btn.className = 'alert-btn-standalone status-ok';
  btn.textContent = `✓`;
  btn.title = `Nessun conflitto o urgenza rilevata. Calendario regolare.`;
  btn.onclick = () => toast('Calendario regolare: nessun conflitto.');
}

function openConflictsModal() {
  const conflictsMap = findConflictingMatches();
  if (!conflictsMap.size) { toast('Nessun conflitto presente'); return; }

  const ov = document.createElement('div');
  ov.className = 'ov';
  ov.id = 'conflictOv';

  const grouped = {};
  conflictsMap.forEach((others, myId) => {
    const me = items.find(x => x.id === myId);
    if (!me) return;
    const k = `${me.date} alle ${me.time}`;
    (grouped[k] ??= new Set()).add(me);
  });

  let listHtml = '';
  Object.keys(grouped).sort().forEach(dt => {
    const arr = Array.from(grouped[dt]);
    listHtml += `<div style="margin-bottom:12px;border:1px solid #ef4444;border-radius:8px;padding:8px;background:var(--bg)">
      <div style="font-weight:700;color:#ef4444;font-size:13px;margin-bottom:6px">⚠️ Conflitto: ${dt} (${arr.length} gare simultanee)</div>`;
    arr.forEach(it => {
      listHtml += `<div class="conflict-list-item" data-goto="${it.id}">
        <strong>${esc(it.title || 'Partita senza titolo')}</strong>
        <span style="font-size:12px;color:var(--mute)">Cat: ${esc(it.cat || 'n.d.')}${it.friendly ? ' [AMICHEVOLE]' : ''}</span>
        <span style="font-size:11px;color:var(--acc);font-weight:600">Vai alla partita ➔</span>
      </div>`;
    });
    listHtml += `</div>`;
  });

  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Conflitti" style="max-height:90vh;overflow-y:auto">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h3 style="margin:0;color:#ef4444">Conflitti di Orario</h3>
      <button id="confCloseTop" style="min-height:28px;padding:2px 8px">✕</button>
    </div>
    <p style="font-size:13px;color:var(--mute);margin:-4px 0 12px">Partite sovrapposte allo stesso orario:</p>
    <div>${listHtml}</div>
    <div class="mbtns" style="margin-top:14px"><button class="primary" id="confClose">Chiudi</button></div>
  </div>`;

  document.body.appendChild(ov);
  ov.addEventListener('click', e => {
    if (e.target === ov) ov.remove();
    const itemEl = e.target.closest('[data-goto]');
    if (itemEl) {
      const targetId = itemEl.dataset.goto;
      ov.remove();
      const targetMatch = items.find(x => x.id === targetId);
      if (targetMatch) {
        setParam('m', targetMatch.date.slice(0, 7));
        setParam('s', iso(monday(targetMatch.date)));
      }
    }
  });
  document.getElementById('confClose').onclick = () => ov.remove();
  document.getElementById('confCloseTop').onclick = () => ov.remove();
}

function openUrgentIncompleteModal() {
  const urgentList = getUrgentIncompleteMatches();
  if (!urgentList.length) { toast('Nessuna gara urgente nelle prossime 24-48 ore'); return; }

  const ov = document.createElement('div');
  ov.className = 'ov';
  ov.id = 'urgentOv';

  let listHtml = urgentList.map(it => {
    let reqs = [];
    if (!it.t1?.trim()) reqs.push('Tavolo 1');
    if (!it.friendly && !it.t2?.trim()) reqs.push('Tavolo 2');
    if (isRefereeNeeded(it.cat, it.friendly) && !it.arb?.trim()) reqs.push('Arbitro');

    return `<div class="conflict-list-item" style="border-color:#f97316" data-goto="${it.id}">
      <strong>${esc(it.title || 'Partita senza titolo')}</strong>
      <span style="font-size:12px;color:var(--mute)">Data: ${esc(it.date)} | Ore: ${esc(it.time || 'n.d.')} | Cat: ${esc(it.cat || 'n.d.')}${it.friendly ? ' [AMICHEVOLE]' : ''}</span>
      <span style="font-size:11px;color:#f97316;font-weight:700">Mancano: ${reqs.join(', ')} ➔</span>
    </div>`;
  }).join('');

  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Gare imminenti incomplete" style="max-height:90vh;overflow-y:auto">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h3 style="margin:0;color:#f97316">Partite Imminenti Incomplete</h3>
      <button id="urgCloseTop" style="min-height:28px;padding:2px 8px">✕</button>
    </div>
    <p style="font-size:13px;color:var(--mute);margin:-4px 0 12px">Le seguenti gare a un giorno o meno richiedono ancora turni di servizio:</p>
    <div style="display:grid;gap:8px">${listHtml}</div>
    <div class="mbtns" style="margin-top:14px"><button class="primary" id="urgClose">Chiudi</button></div>
  </div>`;

  document.body.appendChild(ov);
  ov.addEventListener('click', e => {
    if (e.target === ov) ov.remove();
    const itemEl = e.target.closest('[data-goto]');
    if (itemEl) {
      const targetId = itemEl.dataset.goto;
      ov.remove();
      const targetMatch = items.find(x => x.id === targetId);
      if (targetMatch) {
        setParam('m', targetMatch.date.slice(0, 7));
        setParam('s', iso(monday(targetMatch.date)));
      }
    }
  });
  document.getElementById('urgClose').onclick = () => ov.remove();
  document.getElementById('urgCloseTop').onclick = () => ov.remove();
}

const COMMON_TIMES = ['09:00', '11:00', '11:15', '11:30', '15:00', '15:30', '17:00', '17:30', '18:00', '20:30', '21:00'];
function buildCustomTimePicker(initialVal) {
  let [h, m] = (initialVal || '15:30').split(':');
  if (!h) h = '15';
  if (!m) m = '30';

  const hoursOpts = Array.from({ length: 16 }, (_, i) => String(i + 8).padStart(2, '0'))
    .map(val => `<option value="${val}"${val === h ? ' selected' : ''}>${val}</option>`).join('');

  const minsOpts = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55']
    .map(val => `<option value="${val}"${val === m ? ' selected' : ''}>${val}</option>`).join('');

  const chipsHtml = COMMON_TIMES.map(t => `
    <button type="button" class="time-chip${t === initialVal ? ' active' : ''}" data-timeval="${t}">${t}</button>
  `).join('');

  return `
    <div class="time-picker-box" id="timePickerBox">
      <div class="time-dropdowns">
        <label style="margin:0;font-size:13px;font-weight:700">Ore:</label>
        <select id="pickHour">${hoursOpts}</select>
        <span style="font-size:18px;font-weight:700">:</span>
        <label style="margin:0;font-size:13px;font-weight:700">Min:</label>
        <select id="pickMin">${minsOpts}</select>
        <input type="hidden" id="finalTimeVal" value="${initialVal || '15:30'}">
      </div>
      <div class="time-chips">${chipsHtml}</div>
    </div>
  `;
}

function bindTimePickerEvents(container) {
  const pHour = container.querySelector('#pickHour');
  const pMin = container.querySelector('#pickMin');
  const hInput = container.querySelector('#finalTimeVal');
  const chips = container.querySelectorAll('.time-chip');

  const updateFromSelects = () => {
    const val = `${pHour.value}:${pMin.value}`;
    hInput.value = val;
    chips.forEach(c => c.classList.toggle('active', c.dataset.timeval === val));
  };

  pHour.onchange = updateFromSelects;
  pMin.onchange = updateFromSelects;

  chips.forEach(chip => {
    chip.onclick = () => {
      triggerHaptic('light');
      const [newH, newM] = chip.dataset.timeval.split(':');
      pHour.value = newH;
      pMin.value = newM;
      hInput.value = chip.dataset.timeval;
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    };
  });
}

function openMoltModal(name, counts, month) {
  if (READONLY) return;
  const key = name.toLowerCase(), v = Object.assign({ p: 10, a: 10, c: 10 }, molt[key]);
  const ov = document.createElement('div'); ov.className = 'ov'; ov.id = 'moltOv';
  const calc = () => {
    const gp = +document.getElementById('mp').value || 0, ga = +document.getElementById('ma').value || 0, gc = +document.getElementById('mc').value || 0;
    return counts.p * gp + counts.a * ga + counts.c * gc;
  };
  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Moltiplicatori">
    <h3>${esc(name)}</h3>
    <div class="frow" style="display:grid;grid-template-columns:1fr 70px;gap:8px;align-items:center"><label for="mp">Partite (${counts.p}) ×</label><input id="mp" type="number" inputmode="numeric" min="0" value="${v.p}"></div>
    <div class="frow" style="display:grid;grid-template-columns:1fr 70px;gap:8px;align-items:center"><label for="ma">Aperture (${counts.a}) ×</label><input id="ma" type="number" inputmode="numeric" min="0" value="${v.a}"></div>
    <div class="frow" style="display:grid;grid-template-columns:1fr 70px;gap:8px;align-items:center"><label for="mc">Chiusure (${counts.c}) ×</label><input id="mc" type="number" inputmode="numeric" min="0" value="${v.c}"></div>
    <div style="display:flex;justify-content:space-between;font-weight:600;margin:10px 0;padding-top:6px;border-top:1px solid var(--line)"><span>Totale</span><span id="mtot">${counts.p * v.p + counts.a * v.a + counts.c * v.c}</span></div>
    <div class="mbtns"><button id="mCancel">Annulla</button><button class="primary" id="mSave">Salva</button></div>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => { document.getElementById('mtot').textContent = calc(); }));
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  document.getElementById('mCancel').onclick = () => ov.remove();
  document.getElementById('mSave').onclick = () => {
    molt[key] = { p: +document.getElementById('mp').value || 0, a: +document.getElementById('ma').value || 0, c: +document.getElementById('mc').value || 0 };
    saveMolt(); ov.remove(); updateRecap(month); toast('Salvati');
  };
  document.getElementById('mp').focus();
}

// SCHEDA COLLABORATORE PERSONALE
function openPersonHistoryModal(personName) {
  const normTarget = (personName || '').trim().toLowerCase();
  if (!normTarget) return;

  const completedMatches = items.filter(it => {
    return !!it.ghost && [it.t1, it.t2, it.arb].some(n => (n || '').trim().toLowerCase() === normTarget);
  }).sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));

  const totalMatchesCount = completedMatches.length;
  const last3Matches = completedMatches.slice(0, 3);

  let winsCount = 0;
  let lossCount = 0;
  let otherCount = 0;

  completedMatches.forEach(it => {
    const outcome = getMatchOutcome(it);
    if (outcome?.type === 'win') winsCount++;
    else if (outcome?.type === 'loss') lossCount++;
    else otherCount++;
  });

  const recentListHtml = last3Matches.length
    ? last3Matches.map(it => {
        const outcome = getMatchOutcome(it);
        let pillHtml = '<span class="score-pill suspended">—</span>';
        if (outcome) {
          pillHtml = `<span class="score-pill ${outcome.type}">${esc(outcome.label)}</span>`;
        }
        
        let role = '';
        if ((it.t1 || '').trim().toLowerCase() === normTarget) role = 'T1';
        else if ((it.t2 || '').trim().toLowerCase() === normTarget) role = 'T2';
        else if ((it.arb || '').trim().toLowerCase() === normTarget) role = 'Arb';

        return `<div class="player-recent-item">
          <div>
            <div style="font-weight:700">${esc(it.title || 'Partita')}</div>
            <div style="font-size:11px;color:var(--mute)">${it.date} (${it.time || 'n.d.'}) • Ruolo: <b>${role}</b></div>
          </div>
          <div>${pillHtml}</div>
        </div>`;
      }).join('')
    : '<p style="color:var(--mute);font-size:12px;margin:4px 0">Nessuna partita svolta con check ✓.</p>';

  const maxStat = Math.max(winsCount, lossCount, otherCount, 1);
  const winHeight = Math.round((winsCount / maxStat) * 100);
  const lossHeight = Math.round((lossCount / maxStat) * 100);
  const otherHeight = Math.round((otherCount / maxStat) * 100);

  const ov = document.createElement('div');
  ov.className = 'ov';
  ov.id = 'personHistoryOv';
  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="max-width:390px;padding:12px">
    <div class="player-card">
      <div class="player-card-header">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="player-card-avatar">👤</div>
          <div>
            <h3 class="player-card-name">${esc(personName)}</h3>
            <span style="font-size:11px;color:var(--mute);font-weight:600">Scheda Collaboratore</span>
          </div>
        </div>
        <div class="player-card-total-badge">
          <div class="num">${totalMatchesCount}</div>
          <div class="lbl">Partite ✓</div>
        </div>
      </div>

      <div style="margin-bottom:12px">
        <div style="font-size:11px;font-weight:700;color:var(--mute);text-transform:uppercase;margin-bottom:6px">Ultime Partite Svolte (3)</div>
        <div class="player-recent-list">
          ${recentListHtml}
        </div>
      </div>

      <button type="button" class="stats-toggle-btn" id="toggleStatsBtn">
        <span>📊 Statistiche & Andamento</span>
        <span id="statsArrow">▼</span>
      </button>

      <div class="stats-drawer" id="statsDrawer" style="display:none">
        <div style="font-size:11px;color:var(--mute);font-weight:700;text-transform:uppercase;margin-bottom:4px">Bilancio Risultati Svolti</div>
        <div class="trend-bars-wrap">
          <div class="trend-bar-col">
            <div style="font-size:10px;font-weight:700;color:#22c55e;margin-bottom:2px">${winsCount}</div>
            <div class="trend-bar-fill win" style="height:${Math.max(winHeight, 8)}%"></div>
            <div class="trend-bar-label">Vinte</div>
          </div>
          <div class="trend-bar-col">
            <div style="font-size:10px;font-weight:700;color:#ef4444;margin-bottom:2px">${lossCount}</div>
            <div class="trend-bar-fill loss" style="height:${Math.max(lossHeight, 8)}%"></div>
            <div class="trend-bar-label">Perse</div>
          </div>
          <div class="trend-bar-col">
            <div style="font-size:10px;font-weight:700;color:#9ca3af;margin-bottom:2px">${otherCount}</div>
            <div class="trend-bar-fill suspended" style="height:${Math.max(otherHeight, 8)}%"></div>
            <div class="trend-bar-label">Altre/Sosp.</div>
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--mute);padding-top:4px">
          <span>% Vittorie: <b>${totalMatchesCount ? Math.round((winsCount / totalMatchesCount) * 100) : 0}%</b></span>
          <span>Totale partite valide: <b>${totalMatchesCount}</b></span>
        </div>
      </div>

      <div class="mbtns" style="margin-top:12px">
        <button class="primary" id="phClose" style="width:100%">Chiudi Scheda</button>
      </div>
    </div>
  </div>`;

  document.body.appendChild(ov);
  triggerHaptic('light');

  const toggleBtn = ov.querySelector('#toggleStatsBtn');
  const drawer = ov.querySelector('#statsDrawer');
  const arrow = ov.querySelector('#statsArrow');
  toggleBtn.onclick = () => {
    triggerHaptic('light');
    const isHidden = drawer.style.display === 'none';
    drawer.style.display = isHidden ? 'block' : 'none';
    arrow.textContent = isHidden ? '▲' : '▼';
  };

  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  ov.querySelector('#phClose').onclick = () => ov.remove();
}

// POST-GARA EXPRESS (POPOVER A 1 TAP SU ✓)
function openQuickCloseModal(matchId) {
  const it = items.find(x => x.id === matchId);
  if (!it) return;

  const ov = document.createElement('div');
  ov.className = 'ov';
  ov.id = 'quickCloseOv';

  let selectedStatus = it.status || '';
  let homeScore = '';
  let awayScore = '';
  if (it.score && String(it.score).includes('-')) {
    const parts = it.score.split('-');
    homeScore = parts[0]?.trim() || '';
    awayScore = parts[1]?.trim() || '';
  }

  ov.innerHTML = `<div class="modal quick-close-modal" role="dialog" aria-modal="true">
    <div class="quick-close-header">🏁 Chiudi Partita</div>
    <div class="quick-close-sub">${esc(it.title || 'Gara')}</div>

    <div class="quick-outcome-grid">
      <button type="button" class="quick-outcome-btn ${selectedStatus === 'vinta' ? 'active' : ''}" data-outcome="vinta">
        <span style="font-size:16px">🟢</span> Vinta
      </button>
      <button type="button" class="quick-outcome-btn ${selectedStatus === 'persa' ? 'active' : ''}" data-outcome="persa">
        <span style="font-size:16px">🔴</span> Persa
      </button>
      <button type="button" class="quick-outcome-btn ${selectedStatus === 'sospesa' ? 'active' : ''}" data-outcome="sospesa">
        <span style="font-size:16px">⚪</span> Sosp.
      </button>
    </div>

    <div style="font-size:11px;color:var(--mute);margin-bottom:4px">Punti (opzionale): Casa - Ospiti</div>
    <div class="quick-score-inputs">
      <input type="number" inputmode="numeric" id="qcHome" placeholder="Casa" value="${esc(homeScore)}">
      <span style="font-weight:800;font-size:16px">:</span>
      <input type="number" inputmode="numeric" id="qcAway" placeholder="Ospiti" value="${esc(awayScore)}">
    </div>

    <div style="display:flex;flex-direction:column;gap:6px">
      <button type="button" class="primary" id="qcSave" style="width:100%;min-height:38px">✓ Conferma & Chiudi</button>
      <div style="display:flex;gap:6px">
        <button type="button" id="qcCancel" style="flex:1">Annulla</button>
        <button type="button" id="qcOnlyCheck" style="flex:1" title="Metti solo il check senza esito">Solo Check</button>
      </div>
    </div>
  </div>`;

  document.body.appendChild(ov);
  triggerHaptic('light');

  const outcomeBtns = ov.querySelectorAll('.quick-outcome-btn');
  outcomeBtns.forEach(btn => {
    btn.onclick = () => {
      triggerHaptic('light');
      const val = btn.dataset.outcome;
      if (selectedStatus === val) {
        selectedStatus = '';
        btn.classList.remove('active');
      } else {
        selectedStatus = val;
        outcomeBtns.forEach(b => b.classList.toggle('active', b === btn));
      }
    };
  });

  const finalizeClose = (withDetails = true) => {
    pushUndo();
    it.ghost = true;
    if (withDetails) {
      const h = ov.querySelector('#qcHome').value.trim();
      const a = ov.querySelector('#qcAway').value.trim();
      if (h !== '' && a !== '') {
        it.score = `${h}-${a}`;
        if (!selectedStatus) {
          const hn = Number(h), an = Number(a);
          if (hn > an) selectedStatus = 'vinta';
          else if (hn < an) selectedStatus = 'persa';
        }
      }
      it.status = selectedStatus;
    }
    save();
    ov.remove();
    render();
    toast('Partita chiusa e svolta ✓', 'success');
  };

  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  ov.querySelector('#qcCancel').onclick = () => ov.remove();
  ov.querySelector('#qcOnlyCheck').onclick = () => finalizeClose(false);
  ov.querySelector('#qcSave').onclick = () => finalizeClose(true);
}

function exportSelectedMonthsJSON(selectedMonths) {
  const days = {};
  items.filter(i => selectedMonths.some(m => i.date.startsWith(m))).forEach(i => {
    (days[i.date] ??= []).push({
      partita: i.title || '',
      tavolo1: i.t1 || '',
      tavolo2: i.t2 || '',
      arbitro: i.arb || '',
      orario: i.time || '',
      amichevole: !!i.friendly,
      score: i.score || '',
      status: i.status || ''
    });
  });
  const out = Object.keys(days).filter(d => days[d].length).sort().map(d => {
    const x = dayMeta[d] || {};
    return {
      data: d,
      apertura: { si: x.ap === 'si', nome: x.ap === 'si' ? (x.apNome || '') : null },
      chiusura: { si: x.ch === 'si', nome: x.ch === 'si' ? (x.chNome || '') : null },
      partite: days[d]
    };
  });
  if (!out.length) { toast('Nessun dato presente', 'warning'); return; }
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  a.download = `partite_${selectedMonths.join('_')}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openExportMultiModal() {
  const months = monthsWithData();
  if (!months.length) { toast('Nessun mese con partite', 'warning'); return; }
  const ov = document.createElement('div');
  ov.className = 'ov';
  ov.id = 'exportMultiOv';

  const listHtml = months.map(m => `
    <label class="checkbox-item">
      <input type="checkbox" name="mExpChk" value="${m}" checked>
      <span style="font-weight:600">${monthLabel(m)}</span>
    </label>
  `).join('');

  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Esporta Mesi">
    <h3>Esporta Mesi in JSON</h3>
    <div style="display:flex;gap:8px;margin-bottom:8px">
      <button type="button" id="chkAllBtn" class="pill-btn-sm">Tutti</button>
      <button type="button" id="chkNoneBtn" class="pill-btn-sm">Nessuno</button>
    </div>
    <div id="mChkWrap" style="display:grid;gap:6px;max-height:220px;overflow-y:auto">
      ${listHtml}
    </div>
    <div class="mbtns" style="margin-top:14px">
      <button id="expCancel">Annulla</button>
      <button class="primary" id="expDownload">Scarica JSON</button>
    </div>
  </div>`;

  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  document.getElementById('expCancel').onclick = () => ov.remove();
  document.getElementById('chkAllBtn').onclick = () => ov.querySelectorAll('input[name=mExpChk]').forEach(c => c.checked = true);
  document.getElementById('chkNoneBtn').onclick = () => ov.querySelectorAll('input[name=mExpChk]').forEach(c => c.checked = false);

  document.getElementById('expDownload').onclick = () => {
    const selected = Array.from(ov.querySelectorAll('input[name=mExpChk]:checked')).map(c => c.value);
    if (!selected.length) { toast('Seleziona un mese', 'warning'); return; }
    exportSelectedMonthsJSON(selected);
    ov.remove();
  };
}

function copyMonthRecapWhatsApp(m) {
  const rows = computeRecapRows(m);
  if (!rows.length) { toast('Nessun dato presente', 'warning'); return; }
  let out = `📊 *RIEPILOGO TURNI — ${monthLabel(m).toUpperCase()}*\n\n`;
  rows.forEach(r => {
    const v = Object.assign({ p: 10, a: 10, c: 10 }, molt[r.n.toLowerCase()]);
    const pv = r.p * v.p, av = r.a * v.a + r.c * v.c, tot = pv + av;
    out += `• *${r.n}*: ${tot}€ (Partite: ${r.p}, Ap/Ch: ${r.a + r.c})\n`;
  });
  try {
    navigator.clipboard.writeText(out.trim());
    toast('Riepilogo copiato per WhatsApp!', 'success');
  } catch(e) { prompt('Copia il testo:', out); }
}

function slotHTML(d, k) {
  const label = k === 'ap' ? 'Apertura' : 'Chiusura', wk = dayMeta[d] || {}, v = wk[k] || '';
  return `<div class="slot" data-d="${d}" data-k="${k}"><span class="sl">${label}:</span>
    <div class="yn" role="group"><button data-yn="si" aria-pressed="${v === 'si'}">Sì</button><button data-yn="no" aria-pressed="${v === 'no'}">No</button></div>
    ${v === 'si' ? `<input data-wn list="namesList" value="${esc(wk[k+'Nome'])}" placeholder="Nome">` : ''}</div>`;
}

function computeRecapRows(m) {
  const rec = {}, add = (n, f) => { n = (n || '').trim(); if (!n) return; const k = n.toLowerCase(); (rec[k] ??= { n, p: 0, a: 0, c: 0 })[f]++; };
  const dates = new Set();
  items.filter(i => i.date.startsWith(m) && (!filterCat || i.cat === filterCat) && !!i.ghost).forEach(i => {
    dates.add(i.date); const seen = new Set();
    [i.t1, i.t2, i.arb].forEach(n => { n = (n || '').trim(); const k = n.toLowerCase(); if (!n || seen.has(k)) return; seen.add(k); add(n, 'p'); });
  });
  Object.keys(dayMeta).filter(dt => dt.startsWith(m)).forEach(dt => {
    const x = dayMeta[dt] || {};
    if (x.ap === 'si') add(x.apNome, 'a');
    if (x.ch === 'si') add(x.chNome, 'c');
  });
  return Object.values(rec).sort((a, b) => b.p - a.p || b.a - a.a || a.n.localeCompare(b.n));
}

function recapHTML(m) {
  const rows = computeRecapRows(m);
  return `<aside class="recap" data-m="${m}"><h4>Riepilogo del mese</h4>` + (rows.length
    ? `<table><thead><tr><th>Nome</th><th>Part.</th><th>Ap/Ch</th><th>Totale</th></tr></thead><tbody>${rows.map(r => {
        const v = Object.assign({ p: 10, a: 10, c: 10 }, molt[r.n.toLowerCase()]);
        const pv = r.p * v.p, av = r.a * v.a + r.c * v.c, tot = pv + av;
        return `<tr><td><button class="nb" data-name="${esc(r.n)}" data-p="${r.p}" data-a="${r.a}" data-c="${r.c}" data-m="${m}">${esc(r.n)}</button></td><td>${pv}</td><td>${av}</td><td>${tot}</td></tr>`;
      }).join('')}</tbody></table>`
    : '<p>Nessun dato (partite con check ✓).</p>') + '</aside>';
}

function updateRecap(m) { const el = document.querySelector(`.recap[data-m="${m}"]`); if (el) el.outerHTML = recapHTML(m); }
const openClose = d => `<div class="oc">${slotHTML(d, 'ap')}${slotHTML(d, 'ch')}</div>`;
const uid = () => Math.random().toString(36).slice(2, 10);
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const monday = s => { const d = new Date(s + 'T12:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; };

function closeMenus() {
  document.querySelectorAll('.menuDrop').forEach(d => {
    if (d.hidden) return;
    d.hidden = true;
    const btn = document.getElementById(d.id.replace('Drop', 'Btn'));
    if (btn) btn.setAttribute('aria-expanded', 'false');
  });
}
function initMenu(btnId, dropId) {
  const btn = $('#' + btnId), drop = $('#' + dropId); if (!btn || !drop) return;
  btn.onclick = e => {
    e.stopPropagation();
    triggerHaptic('light');
    const open = drop.hidden;
    closeMenus();
    drop.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  };
  drop.addEventListener('click', e => { if (e.target.closest('button')) closeMenus(); });
}

let mem = null;
function params() { return new URLSearchParams(mem !== null ? mem : location.hash.slice(1)); }
function writeHash(p) {
  const s = p.toString();
  try { history.replaceState(null, '', location.pathname + (s ? '#' + s : '')); mem = null; }
  catch(e) { mem = s; }
}
function setParam(k, v) { 
  const p = params(); 
  v ? p.set(k, v) : p.delete(k); 
  writeHash(p); 
  render(); // Centralizzato qui
}

function card(i, hasConflict, isUrgentIncomplete) {
  const ghostOn = !READONLY && !!i.ghost;
  const missingReq = isMissingRequirements(i);
  const t1Val = (i.t1 && i.t1.trim()) ? esc(i.t1) : '<span class="empty-req">Da assegnare</span>';
  
  const t2Required = !i.friendly;
  const t2Val = (i.t2 && i.t2.trim()) ? esc(i.t2) : (t2Required ? '<span class="empty-req">Da assegnare</span>' : '<span class="empty-opt">—</span>');

  const arbNeeded = isRefereeNeeded(i.cat, i.friendly);
  const arbVal = (i.arb && i.arb.trim()) ? esc(i.arb) : (arbNeeded ? '<span class="empty-req">Da assegnare</span>' : '<span class="empty-opt">Federazione</span>');

  const catHtml = i.cat ? `<span class="cat-pill">${esc(i.cat)}</span>` : '';
  const friendlyHtml = i.friendly ? `<span class="friendly-badge" title="Partita Amichevole">A</span>` : '';
  
  const outcome = getMatchOutcome(i);
  const scoreHtml = outcome ? `<span class="score-pill ${outcome.type}">${esc(outcome.label)}</span>` : '';

  let badgeHtml = '';
  if (hasConflict) badgeHtml = `<div class="conflict-badge">⚠️ CONFLITTO ORARIO</div>`;
  else if (isUrgentIncomplete) badgeHtml = `<div class="urgent-badge">⏰ GARA IMMINENTE INCOMPLETA</div>`;

  return `<div class="match${ghostOn ? ' ghost' : ''}${missingReq ? ' missing-t1' : ''}${hasConflict ? ' conflict-match' : ''}${isUrgentIncomplete ? ' urgent-incomplete' : ''}" data-id="${i.id}">
    ${badgeHtml}
    <div class="m-top">
      <div class="m-title" title="${esc(i.title)}">${esc(i.title) || 'Partita (senza nome)'}</div>
      <div class="m-actions">
        ${!READONLY ? `<button class="ghostBtn" data-ghost aria-pressed="${!!i.ghost}" title="Segna svolta (Check)">✓</button>` : ''}
        ${!READONLY && !i.ghost ? `<button class="editBtn" data-edit title="Modifica dettagli">✏️</button>` : ''}
      </div>
    </div>
    <div class="m-meta">
      <div class="m-time">${i.time ? 'Ore ' + i.time : 'Orario n.d.'}</div>
      ${catHtml}
      ${friendlyHtml}
      ${scoreHtml}
      <div class="m-date">${i.date}</div>
    </div>
    <div class="m-roster">
      <div class="m-row"><span class="lbl">Tavolo 1</span><span class="val">${t1Val}</span></div>
      <div class="m-row"><span class="lbl">Tavolo 2</span><span class="val">${t2Val}</span></div>
      <div class="m-row"><span class="lbl">Arbitro</span><span class="val">${arbVal}</span></div>
    </div>
  </div>`;
}

function openEditModal(matchId) {
  if (READONLY) return;
  const it = items.find(x => x.id === matchId);
  if (!it) return;

  if (it.ghost) {
    triggerHaptic('warning');
    toast('Togli prima il check ✓ per modificare la partita', 'warning');
    return;
  }

  const isFriendly = !!it.friendly;

  const ov = document.createElement('div');
  ov.className = 'ov';
  ov.id = 'editModalOv';
  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Modifica Partita">
    <h3>Modifica Partita</h3>
    <div class="frow"><label for="edDate">Data *</label><input id="edDate" type="date" value="${it.date}"></div>
    <div class="frow"><label>Orario di Gioco</label>${buildCustomTimePicker(it.time || '15:30')}</div>
    <div class="frow"><label for="edTitle">Partita (Squadre)</label><input id="edTitle" type="text" value="${esc(it.title)}"></div>
    <div class="frow"><label for="edCat">Categoria</label><input id="edCat" type="text" list="categoriesList" value="${esc(it.cat)}"></div>
    
    <div class="frow" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <div>
        <label for="edScore">Punteggio (Casa-Ospite)</label>
        <input id="edScore" type="text" placeholder="Es. 72-65" value="${esc(it.score || '')}">
      </div>
      <div>
        <label for="edStatus">Esito Rapido</label>
        <select id="edStatus">
          <option value="" ${!it.status ? 'selected' : ''}>Automatico (da punti)</option>
          <option value="vinta" ${it.status === 'vinta' ? 'selected' : ''}>🟢 Vinta</option>
          <option value="persa" ${it.status === 'persa' ? 'selected' : ''}>🔴 Persa</option>
          <option value="sospesa" ${it.status === 'sospesa' ? 'selected' : ''}>⚪ Sospesa</option>
        </select>
      </div>
    </div>

    <div class="frow" style="display:flex;align-items:center;justify-content:space-between;margin:10px 0">
      <label style="margin:0;font-size:13px;font-weight:600">Partita Amichevole:</label>
      <div class="yn" id="edFriendlyYN" role="group">
        <button type="button" data-val="si" aria-pressed="${isFriendly}">Sì</button>
        <button type="button" data-val="no" aria-pressed="${!isFriendly}">No</button>
      </div>
    </div>

    <div style="border-top:1px solid var(--line);margin:12px 0 10px;padding-top:8px">
      <div class="frow"><label for="edT1">Tavolo 1 *</label><input id="edT1" type="text" list="namesList" value="${esc(it.t1)}" placeholder="Nome obbligatorio"></div>
      <div class="frow"><label for="edT2">Tavolo 2</label><input id="edT2" type="text" list="namesList" value="${esc(it.t2)}" placeholder="Nome"></div>
      <div class="frow"><label for="edArb">Arbitro</label><input id="edArb" type="text" list="namesList" value="${esc(it.arb)}" placeholder="Nome"></div>
    </div>
    <div id="edConflictBox" style="display:none"></div>
    <div class="mbtns">
      <button id="edDelete" style="background:#fee2e2;border-color:#fca5a5;color:#991b1b;font-weight:600">Elimina</button>
      <div style="display:flex;gap:6px">
        <button id="edCancel">Annulla</button>
        <button class="primary" id="edSave">Salva</button>
      </div>
    </div>
  </div>`;

  document.body.appendChild(ov);
  bindTimePickerEvents(ov);

  let currentFriendlyVal = isFriendly;
  const ynBtns = ov.querySelectorAll('#edFriendlyYN button');
  ynBtns.forEach(b => {
    b.onclick = () => {
      triggerHaptic('light');
      currentFriendlyVal = (b.dataset.val === 'si');
      ynBtns.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    };
  });

  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  document.getElementById('edCancel').onclick = () => ov.remove();

  const delBtn = document.getElementById('edDelete');
  delBtn.onclick = () => {
    if (delBtn.dataset.arm) {
      pushUndo();
      items = items.filter(x => x.id !== matchId);
      save(); ov.remove(); render();
      toast('Partita eliminata', 'warning');
    } else {
      triggerHaptic('warning');
      delBtn.dataset.arm = '1';
      delBtn.textContent = 'Sicuro?';
      delBtn.style.background = '#dc2626';
      delBtn.style.color = '#fff';
      setTimeout(() => {
        if (delBtn.isConnected) {
          delete delBtn.dataset.arm;
          delBtn.textContent = 'Elimina';
          delBtn.style.background = '#fee2e2';
          delBtn.style.color = '#991b1b';
        }
      }, 3500);
    }
  };

  document.getElementById('edSave').onclick = () => {
    const newDate = document.getElementById('edDate').value;
    if (!newDate) { toast('La data è obbligatoria', 'warning'); return; }
    const time = document.getElementById('finalTimeVal').value;
    const t1 = document.getElementById('edT1').value.trim();
    const t2 = document.getElementById('edT2').value.trim();
    const arb = document.getElementById('edArb').value.trim();

    const conflicts = checkPersonRosterConflicts(matchId, newDate, time, t1, t2, arb);
    if (conflicts.length && !document.getElementById('edSave').dataset.confirmed) {
      triggerHaptic('warning');
      const box = document.getElementById('edConflictBox');
      box.className = 'person-conflict-alert';
      box.innerHTML = conflicts.join('<br>') + '<br><small>Tocca di nuovo Salva per forzare.</small>';
      box.style.display = 'block';
      document.getElementById('edSave').dataset.confirmed = '1';
      return;
    }

    pushUndo();
    it.date = newDate;
    it.time = time;
    it.title = document.getElementById('edTitle').value.trim();
    it.cat = document.getElementById('edCat').value.trim();
    it.friendly = currentFriendlyVal;
    it.score = document.getElementById('edScore').value.trim();
    it.status = document.getElementById('edStatus').value;
    it.t1 = t1;
    it.t2 = t2;
    it.arb = arb;
    save(); ov.remove();
    setParam('m', it.date.slice(0, 7));
    setParam('s', iso(monday(it.date)));
    toast('Salvato', 'success');
  };
}

function generateWhatsAppText(startDate, endDate, customTitle) {
  const startStr = iso(startDate), endStr = iso(endDate);
  const filtered = items.filter(i => i.date >= startStr && i.date <= endStr);
  if (!filtered.length) { toast('Nessuna partita nel periodo', 'warning'); return; }

  const fmtDayHeader = dStr => new Date(dStr + 'T12:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();
  const fmtShort = d => d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });

  let out = `📅 *${customTitle || `TURNI PARTITE: ${fmtShort(startDate)} – ${fmtShort(endDate)}`}*\n\n`;
  const daysMap = {};
  filtered.forEach(i => (daysMap[i.date] ??= []).push(i));

  Object.keys(daysMap).sort().forEach(dayStr => {
    const arr = daysMap[dayStr];
    arr.sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
    out += `🏀 *${fmtDayHeader(dayStr)}*\n`;
    arr.forEach(it => {
      const timeStr = it.time ? `Ore ${it.time} - ` : '';
      const catStr = it.cat ? `[${it.cat}${it.friendly ? ' (AMICHEVOLE)' : ''}] ` : (it.friendly ? '[AMICHEVOLE] ' : '');
      const title = it.title || 'Partita';
      const t1 = it.t1 && it.t1.trim() ? it.t1.trim() : '...';
      const t2 = it.t2 && it.t2.trim() ? it.t2.trim() : '...';

      out += `• ${timeStr}${catStr}${title}\n`;
      out += `  - Tavolo 1: ${t1}\n`;
      if (!it.friendly) {
        out += `  - Tavolo 2: ${t2}\n`;
      }
      if (isRefereeNeeded(it.cat, it.friendly)) {
        const arb = it.arb && it.arb.trim() ? it.arb.trim() : '...';
        out += `  - Arbitro: ${arb}\n`;
      }
      out += '\n';
    });
  });

  try {
    navigator.clipboard.writeText(out.trim());
    toast('Turni copiati per WhatsApp!', 'success');
  } catch(e) { prompt('Copia il testo:', out); }
}

function copyWhatsAppRollingToday() {
  const start = new Date();
  start.setHours(12, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  generateWhatsAppText(start, end);
}

function copyWhatsAppFromWeek(wIso) {
  const mon = monday(wIso);
  const start = new Date(mon);
  start.setDate(start.getDate() + 2);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  generateWhatsAppText(start, end);
}

// COSTRUISCE L'ALBERO COLLASSABILE NELLA SIDEBAR SINISTRA
function renderNavTree(groupedData, activeMonth, activeWeek) {
  const treeEl = document.getElementById('navTree');
  if (!treeEl) return;

  const years = {};
  Object.keys(groupedData).sort().forEach(m => {
    const y = m.slice(0, 4);
    (years[y] ??= []).push(m);
  });

  const fmtMonth = mStr => new Date(mStr + '-15T12:00').toLocaleDateString('it-IT', { month: 'long' });

  let html = '';
  Object.keys(years).sort().forEach(y => {
    const monthsArr = years[y];
    const isYearOpen = monthsArr.includes(activeMonth);

    let monthsHtml = monthsArr.map(m => {
      const weeksMap = groupedData[m];
      const isCurMonth = m === activeMonth;
      const totGareMese = Object.values(weeksMap).reduce((acc, arr) => acc + arr.length, 0);

      const weeksHtml = Object.keys(weeksMap).sort().map(w => {
        const a = monday(w), b = new Date(a); b.setDate(b.getDate() + 6);
        const wCount = weeksMap[w].length;
        const isCurW = w === activeWeek;
        const wLabel = `${a.getDate()}/${a.getMonth() + 1} - ${b.getDate()}/${b.getMonth() + 1}`;

        return `<button type="button" class="nav-week-link${isCurW ? ' active-week' : ''}" data-navm="${m}" data-navw="${w}">
          <span>Sett. ${wLabel}</span>
          <span class="nav-badge-count">(${wCount})</span>
        </button>`;
      }).join('');

      return `<details class="nav-month${isCurMonth ? ' active-month' : ''}" data-navm="${m}" ${isCurMonth ? 'open' : ''}>
        <summary data-pickm="${m}">
          <span>${fmtMonth(m)}</span>
          <span class="nav-badge-count" style="margin-left:auto">(${totGareMese})</span>
        </summary>
        <div class="nav-weeks-list">
          ${weeksHtml}
        </div>
      </details>`;
    }).join('');

    html += `<details class="nav-year" ${isYearOpen ? 'open' : ''}>
      <summary><span>${y}</span></summary>
      <div>${monthsHtml}</div>
    </details>`;
  });

  treeEl.innerHTML = html;
}

let ready = false;
function render(focusId) {
  ready = false;
  const listEl = $('#list');
  if (!listEl) return;
  const idxOf = new Map(items.map((it, i) => [it.id, i]));
  const p = params();
  
  const qLower = searchQuery.toLowerCase().trim();
  const filtered = items.filter(i => {
    if (filterCat && i.cat !== filterCat) return false;
    if (filterIncomplete && !isMissingRequirements(i)) return false;
    if (qLower) {
      const matchText = [i.title, i.cat, i.t1, i.t2, i.arb, i.date, i.time].join(' ').toLowerCase();
      if (!matchText.includes(qLower)) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => a.date.localeCompare(b.date));
  const months = {};
  sorted.forEach(i => { 
    const m = i.date.slice(0, 7); 
    const w = iso(monday(i.date)); 
    ((months[m] ??= {})[w] ??= []).push(i); 
  });
  
  const keys = Object.keys(months).sort();
  if (!keys.length) {
    listEl.innerHTML = '<div class="empty">Nessuna partita trovata.' + (!READONLY ? ' Tocca “+ Partita” per iniziare.' : '') + '</div>';
    const treeEl = document.getElementById('navTree');
    if (treeEl) treeEl.innerHTML = '<p style="color:var(--mute);font-size:12px;padding:6px">Nessuna gara</p>';
    updateIncompleteBadge();
    updateAlertStatusBadge();
    return;
  }

  const nowM = iso(new Date()).slice(0, 7);
  let activeM = p.get('m');
  if (!activeM || !months[activeM]) {
    activeM = months[nowM] ? nowM : keys[keys.length - 1];
    setParam('m', activeM);
  }
  const activeW = p.get('s');

  renderNavTree(months, activeM, activeW);

  const fmt = (d, o) => d.toLocaleDateString('it-IT', o);
  const conflictsMap = findConflictingMatches();
  const label = fmt(new Date(activeM + '-15T12:00'), { month: 'long', year: 'numeric' });
  const count = Object.values(months[activeM]).reduce((n, a) => n + a.length, 0);

  const wkHtml = Object.keys(months[activeM]).sort().map(w => {
    const a = monday(w), b = new Date(a); b.setDate(b.getDate() + 6);
    const list = months[activeM][w];
    const isOpen = activeW ? activeW === w : true;
    const days = {}; 
    list.forEach(i => (days[i.date] ??= []).push(i));
    
    Object.values(days).forEach(arr => arr.sort((a, b) => {
      if (!a.time && !b.time) return (b.ts ?? idxOf.get(b.id)) - (a.ts ?? idxOf.get(a.id));
      if (!a.time) return -1;
      if (!b.time) return 1;
      return a.time.localeCompare(b.time);
    }));

    const dayHtml = Object.keys(days).sort().map(dt => {
      const isUrgentDay = isWithinOneDayOrLess(dt);
      return `<div class="day">
        <h4>${fmt(new Date(dt + 'T12:00'), { weekday: 'short', day: 'numeric', month: 'short' })}</h4>
        ${openClose(dt)}
        <div class="matches">${days[dt].map(it => card(it, conflictsMap.has(it.id), isUrgentDay && isMissingRequirements(it))).join('')}</div>
      </div>`;
    }).join('');

    return `<details class="week${activeW === w ? ' hl' : ''}" id="w-${w}" data-m="${activeM}" data-w="${w}"${isOpen ? ' open' : ''}>
      <summary>
        <span class="t">Settimana ${fmt(a, { day: 'numeric', month: 'short' })} – ${fmt(b, { day: 'numeric', month: 'short' })}</span>
        <span class="n">${list.length} ${list.length === 1 ? 'gara' : 'gare'}<button class="waBtn" data-wamsg="${w}" type="button" title="Copia turni">📲 WA</button></span>
      </summary>
      ${dayHtml}
    </details>`;
  }).join('');

  listEl.innerHTML = `<div class="selected-month-view">
    <div class="selected-month-header">
      <h2>
        ${label}
        <button class="waBtn" data-warecap="${activeM}" type="button" title="Copia riepilogo">📲 WA Riepilogo</button>
      </h2>
      <span style="color:var(--mute);font-weight:600;font-size:14px">${count} gare totali</span>
    </div>
    <div class="mbody">
      ${recapHTML(activeM)}
      <div class="mweeks">${wkHtml}</div>
    </div>
  </div>`;

  setTimeout(() => { ready = true; }, 150);
  updateIncompleteBadge();
  updateAlertStatusBadge();

  if (activeW) {
    const el = document.getElementById('w-' + activeW);
    if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  if (focusId) {
    const el = document.querySelector(`[data-id="${focusId}"]`);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

document.addEventListener('input', e => {
  if (READONLY) return;
  if (e.target.matches('[data-wn]')) {
    const sl = e.target.closest('.slot'); (dayMeta[sl.dataset.d] ??= {})[sl.dataset.k + 'Nome'] = e.target.value; saveD(); updateRecap(sl.dataset.d.slice(0, 7));
  }
});

document.addEventListener('click', e => {
  const pickM = e.target.closest('[data-pickm]');
  if (pickM) {
    e.preventDefault();
    const targetMonth = pickM.dataset.pickm;
    setParam('m', targetMonth);
    setParam('s', '');
    triggerHaptic('light');
    return;
  }

  const pickW = e.target.closest('[data-navw]');
  if (pickW) {
    e.preventDefault();
    const targetMonth = pickW.dataset.navm;
    const targetWeek = pickW.dataset.navw;
    setParam('m', targetMonth);
    setParam('s', targetWeek);
    triggerHaptic('light');
    return;
  }

  const gh = e.target.closest('[data-ghost]');
  if (gh && !READONLY) {
    e.stopPropagation();
    const id = gh.closest('.match').dataset.id;
    const it = items.find(x => x.id === id); if (!it) return;

    if (it.ghost) {
      pushUndo();
      it.ghost = false;
      save();
      render();
      triggerHaptic('light');
      toast('Check rimosso: modifiche riabilitate', 'warning');
    } else {
      openQuickCloseModal(id);
    }
    return;
  }

  const editBtn = e.target.closest('[data-edit]');
  if (editBtn && !READONLY) {
    e.stopPropagation();
    const id = editBtn.closest('.match')?.dataset?.id;
    if (id) {
      const it = items.find(x => x.id === id);
      if (it?.ghost) {
        toast('Togli prima il check ✓ per modificare', 'warning');
        return;
      }
      triggerHaptic('light'); 
      openEditModal(id); 
    }
    return;
  }

  const matchCard = e.target.closest('.match');
  if (matchCard && !READONLY && !e.target.closest('button')) {
    const it = items.find(x => x.id === matchCard.dataset.id);
    if (it?.ghost) {
      toast('Partita con check: togli il ✓ per modificarla');
      return;
    }
    triggerHaptic('light');
    openEditModal(matchCard.dataset.id);
    return;
  }

  const warecap = e.target.closest('[data-warecap]');
  if (warecap) {
    e.preventDefault(); e.stopPropagation();
    copyMonthRecapWhatsApp(warecap.dataset.warecap);
    return;
  }

  const wa = e.target.closest('[data-wamsg]');
  if (wa) {
    e.preventDefault(); e.stopPropagation();
    copyWhatsAppFromWeek(wa.dataset.wamsg);
    return;
  }

  const yn = e.target.closest('[data-yn]');
  if (yn && !READONLY) {
    triggerHaptic('light');
    const sl = yn.closest('.slot'), d = sl.dataset.d, k = sl.dataset.k, wk = (dayMeta[d] ??= {});
    pushUndo(); wk[k] = yn.dataset.yn; if (wk[k] === 'no') delete wk[k + 'Nome']; saveD(); updateRecap(d.slice(0, 7));
    sl.outerHTML = slotHTML(d, k);
    if (wk[k] === 'si') { const n = document.querySelector(`.slot[data-d="${d}"][data-k="${k}"] input`); if (n) n.focus(); }
    return;
  }

  const nb = e.target.closest('[data-name]');
  if (nb && !READONLY) { 
    triggerHaptic('light');
    openMoltModal(nb.dataset.name, { p: +nb.dataset.p, a: +nb.dataset.a, c: +nb.dataset.c }, nb.dataset.m); 
    return; 
  }
});

document.addEventListener('toggle', e => {
  if (!ready || !e.target.open) return;
  if (e.target.matches('details.week')) { 
    setParam('m', e.target.dataset.m); 
    setParam('s', e.target.dataset.w); 
  }
}, true);

function openAddModal() {
  if (READONLY) return;
  const ov = document.createElement('div'); ov.className = 'ov'; ov.id = 'addOv';
  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Nuova partita">
    <h3>Nuova partita</h3>
    <div class="frow"><label for="nDate">Data *</label><input id="nDate" type="date" value="${iso(new Date())}"></div>
    <div class="frow"><label>Orario di Gioco</label>${buildCustomTimePicker('15:30')}</div>
    <div class="frow"><label for="nTitle">Partita</label><input id="nTitle" type="text" placeholder="Squadra A – Squadra B"></div>
    <div class="frow"><label for="nCat">Categoria</label><input id="nCat" type="text" list="categoriesList" placeholder="Es. U17"></div>
    
    <div class="frow" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <div>
        <label for="nScore">Punteggio (Casa-Ospite)</label>
        <input id="nScore" type="text" placeholder="Es. 72-65">
      </div>
      <div>
        <label for="nStatus">Esito Rapido</label>
        <select id="nStatus">
          <option value="" selected>Automatico (da punti)</option>
          <option value="vinta">🟢 Vinta</option>
          <option value="persa">🔴 Persa</option>
          <option value="sospesa">⚪ Sospesa</option>
        </select>
      </div>
    </div>

    <div class="frow" style="display:flex;align-items:center;justify-content:space-between;margin:10px 0">
      <label style="margin:0;font-size:13px;font-weight:600">Partita Amichevole:</label>
      <div class="yn" id="nFriendlyYN" role="group">
        <button type="button" data-val="si" aria-pressed="false">Sì</button>
        <button type="button" data-val="no" aria-pressed="true">No</button>
      </div>
    </div>

    <div class="frow"><label for="nT1">Tavolo 1</label><input id="nT1" type="text" list="namesList" placeholder="Nome"></div>
    <div class="frow"><label for="nT2">Tavolo 2</label><input id="nT2" type="text" list="namesList" placeholder="Nome"></div>
    <div class="frow"><label for="nArb">Arbitro</label><input id="nArb" type="text" list="namesList" placeholder="Nome"></div>
    <div id="nConflictBox" style="display:none"></div>
    <p class="err" id="nErr">Inserisci almeno la data.</p>
    <div class="mbtns"><button id="nCancel">Annulla</button><button class="primary" id="nSave">Aggiungi</button></div>
  </div>`;
  document.body.appendChild(ov);
  bindTimePickerEvents(ov);

  let currentFriendlyVal = false;
  const ynBtns = ov.querySelectorAll('#nFriendlyYN button');
  ynBtns.forEach(b => {
    b.onclick = () => {
      triggerHaptic('light');
      currentFriendlyVal = (b.dataset.val === 'si');
      ynBtns.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    };
  });

  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  document.getElementById('nCancel').onclick = () => ov.remove();
  document.getElementById('nSave').onclick = () => {
    const date = document.getElementById('nDate').value;
    if (!date) { 
      toast('Inserisci almeno la data', 'warning');
      document.getElementById('nErr').classList.add('on'); 
      document.getElementById('nDate').focus(); 
      return; 
    }
    const time = document.getElementById('finalTimeVal').value;
    const t1 = document.getElementById('nT1').value.trim();
    const t2 = document.getElementById('nT2').value.trim();
    const arb = document.getElementById('nArb').value.trim();

    const conflicts = checkPersonRosterConflicts(null, date, time, t1, t2, arb);
    if (conflicts.length && !document.getElementById('nSave').dataset.confirmed) {
      triggerHaptic('warning');
      const box = document.getElementById('nConflictBox');
      box.className = 'person-conflict-alert';
      box.innerHTML = conflicts.join('<br>') + '<br><small>Tocca di nuovo Aggiungi per forzare.</small>';
      box.style.display = 'block';
      document.getElementById('nSave').dataset.confirmed = '1';
      return;
    }

    const it = { 
      id: uid(), 
      title: document.getElementById('nTitle').value, 
      date, 
      time, 
      cat: document.getElementById('nCat').value,
      friendly: currentFriendlyVal,
      score: document.getElementById('nScore').value.trim(),
      status: document.getElementById('nStatus').value,
      t1, t2, arb, 
      ghost: false,
      ts: Date.now() 
    };
    pushUndo(); items.push(it); save(); ov.remove();
    setParam('m', it.date.slice(0, 7)); setParam('s', iso(monday(it.date)));
    toast('Partita aggiunta!', 'success');
  };
  document.getElementById('nDate').focus();
}

function openResocontoModal() {
  const months = monthsWithData();
  const ov = document.createElement('div');
  ov.className = 'ov';
  ov.id = 'resocontoOv';

  const grandTotal = {};
  let totalSpentGeneral = 0;

  months.forEach(m => {
    const rows = computeRecapRows(m);
    rows.forEach(r => {
      const k = r.n.toLowerCase();
      const v = Object.assign({ p: 10, a: 10, c: 10 }, molt[k]);
      const tot = (r.p * v.p) + ((r.a + r.c) * v.a);
      if (!grandTotal[k]) grandTotal[k] = { n: r.n, p: 0, ac: 0, tot: 0 };
      grandTotal[k].p += r.p;
      grandTotal[k].ac += (r.a + r.c);
      grandTotal[k].tot += tot;
      totalSpentGeneral += tot;
    });
  });

  const grandRows = Object.values(grandTotal).sort((a, b) => b.tot - a.tot || a.n.localeCompare(b.n));

  const grandTableHtml = grandRows.length
    ? `<table>
        <thead><tr><th>Nome</th><th>Partite</th><th>Ap/Ch</th><th>Totale</th></tr></thead>
        <tbody>
          ${grandRows.map(r => `<tr><td><strong>${esc(r.n)}</strong></td><td>${r.p}</td><td>${r.ac}</td><td><strong>${r.tot}€</strong></td></tr>`).join('')}
          <tr style="border-top:2px solid var(--ink);font-weight:700"><td>TOTALE GENERALE</td><td colspan="2"></td><td>${totalSpentGeneral}€</td></tr>
        </tbody>
      </table>`
    : '<p>Nessun dato registrato nella stagione.</p>';

  const monthsBlocksHtml = months.map(m => {
    const rows = computeRecapRows(m);
    let monthSum = 0;
    const table = rows.length
      ? `<table>
          <thead><tr><th>Nome</th><th>Part.</th><th>Ap/Ch</th><th>Totale</th></tr></thead>
          <tbody>
            ${rows.map(r => {
              const v = Object.assign({ p: 10, a: 10, c: 10 }, molt[r.n.toLowerCase()]);
              const tot = (r.p * v.p) + ((r.a + r.c) * v.a);
              monthSum += tot;
              return `<tr><td>${esc(r.n)}</td><td>${r.p}</td><td>${r.a + r.c}</td><td>${tot}€</td></tr>`;
            }).join('')}
            <tr style="border-top:1px solid var(--line);font-weight:700"><td>Totale Mese</td><td colspan="2"></td><td>${monthSum}€</td></tr>
          </tbody>
        </table>`
      : '<p style="color:var(--mute);font-size:12px">Nessuna partita con check.</p>';

    return `<details class="res-month-block">
      <summary style="display:flex;justify-content:space-between;align-items:center">
        <span>${monthLabel(m)}</span>
        <button class="waBtn" data-warecap="${m}" type="button">📲 WA</button>
      </summary>
      <div style="margin-top:6px">${table}</div>
    </details>`;
  }).join('');

  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Resoconto" style="max-height:90vh;overflow-y:auto">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h3 style="margin:0">Resoconto Compensi</h3>
      <button id="resCloseTop" style="min-height:28px;padding:2px 8px">✕</button>
    </div>
    <div class="grand-total-box">
      <h4>Totale Generale Compensi</h4>
      ${grandTableHtml}
    </div>
    <h4 style="margin:14px 0 8px;font:700 16px var(--font-title);color:var(--mute);text-transform:uppercase">Dettaglio Singoli Mesi</h4>
    <div class="resoconto-months">${monthsBlocksHtml}</div>
    <div class="mbtns" style="margin-top:16px"><button class="primary" id="resClose">Chiudi</button></div>
  </div>`;

  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  document.getElementById('resClose').onclick = () => ov.remove();
  document.getElementById('resCloseTop').onclick = () => ov.remove();
}

function fromExportFormat(arr) {
  const newItems = [], wi = {};
  arr.forEach(day => {
    const d = day && day.data; if (!d) return;
    wi[d] = {
      ap: (day.apertura && day.apertura.si) ? 'si' : 'no',
      apNome: (day.apertura && day.apertura.si) ? (day.apertura.nome || '') : '',
      ch: (day.chiusura && day.chiusura.si) ? 'si' : 'no',
      chNome: (day.chiusura && day.chiusura.si) ? (day.chiusura.nome || '') : ''
    };
    (day.partite || []).forEach(p => {
      newItems.push({ 
        id: uid(), 
        date: d, 
        title: p.partita || '', 
        t1: p.tavolo1 || '', 
        t2: p.tavolo2 || '', 
        arb: p.arbitro || '', 
        time: p.orario || '',
        friendly: !!p.amichevole,
        score: p.score || '',
        status: p.status || '',
        ghost: false
      });
    });
  });
  return { newItems, wi };
}

function monthsWithData() {
  const s = new Set();
  items.forEach(i => s.add(i.date.slice(0, 7)));
  Object.keys(dayMeta).forEach(d => s.add(d.slice(0, 7)));
  return [...s].sort();
}
function monthLabel(m) { return new Date(m + '-15T12:00').toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }); }

async function pdfToLines(file) {
  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const rows = {};
    tc.items.forEach(it => {
      const y = Math.round(it.transform[5] / 3) * 3;
      (rows[y] = rows[y] || []).push(it);
    });
    Object.keys(rows).map(Number).sort((a, b) => b - a).forEach(y => {
      const txt = rows[y].sort((a, b) => a.transform[4] - b.transform[4]).map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
      if (txt) lines.push(txt);
    });
  }
  return lines;
}

function normName(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function extractHomeMatches(lines, teamName) {
  const needle = normName(teamName);
  const out = [];
  let detectedCat = '';
  for (let l of lines.slice(0, 15)) {
    const m = l.match(/Under\s*(\d{1,2})|U\s*(\d{1,2})|Serie\s*([A-D])|Divisione/i);
    if (m) {
      if (m[1] || m[2]) detectedCat = 'U' + (m[1] || m[2]);
      else if (m[3]) detectedCat = 'Serie ' + m[3].toUpperCase();
      break;
    }
  }
  const dtRegex = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[\s\-–—T]+(\d{1,2}:\d{2}))?\b/;
  for (let i = 0; i < lines.length; i++) {
    const lineNorm = normName(lines[i]);
    if (needle && lineNorm.includes(needle)) {
      const homeTeam = lines[i].replace(/^\d+\s*/, '').trim();
      let awayTeam = '';
      let matchDate = null;
      let matchTime = '';
      for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
        const nextLine = lines[j].trim();
        const dtMatch = nextLine.match(dtRegex);
        if (dtMatch && !matchDate) {
          let [, d, mo, y, t] = dtMatch;
          if (y.length === 2) y = '20' + y;
          matchDate = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
          if (t) matchTime = t;
        }
        if (!awayTeam && nextLine && !dtMatch && !nextLine.match(/^(Palestra|PALASPORT|PALABURSI|PALAZZETTO|Via|pag\.|00\d{4}|\d+ Giornata)/i)) {
          if (!nextLine.match(/^\d+[\s\-]+\d+$/) && !nextLine.includes('(')) awayTeam = nextLine.replace(/^\d+\s*/, '').trim();
        }
      }
      if (!matchDate) {
        const dtMatch = lines[i].match(dtRegex);
        if (dtMatch) {
          let [, d, mo, y, t] = dtMatch;
          if (y.length === 2) y = '20' + y;
          matchDate = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
          if (t) matchTime = t;
        }
      }
      if (matchDate) {
        out.push({
          date: matchDate,
          time: matchTime,
          title: (homeTeam + ' - ' + (awayTeam || 'Avversario')).replace(/\s+/g, ' '),
          cat: detectedCat,
          friendly: false
        });
      }
    }
  }
  const unique = [];
  const seen = new Set();
  for (let it of out) {
    const k = it.date + '_' + it.time + '_' + it.title;
    if (!seen.has(k)) {
      seen.add(k);
      unique.push(it);
    }
  }
  return unique;
}

let pdfCandidates = [];
function renderPdfPreview() {
  const wrap = document.getElementById('pdfPreviewWrap'); if (!wrap) return;
  if (!pdfCandidates.length) { 
    wrap.innerHTML = '<p style="color:var(--warn);font-size:13px;padding:6px 0">Nessuna gara in casa trovata.</p>'; 
    return; 
  }
  wrap.innerHTML = `<p style="color:var(--mute);font-size:12px;margin:4px 0 8px">Trovate ${pdfCandidates.length} gare:</p>` +
    pdfCandidates.map((c, i) => `<div style="border-bottom:1px solid var(--line);padding:8px 0;display:flex;flex-direction:column;gap:6px">
    <input data-pf="title" data-pi="${i}" value="${esc(c.title)}" style="font-weight:700">
    <div style="display:flex;gap:6px">
      <input data-pf="date" data-pi="${i}" type="date" value="${c.date || ''}" style="flex:1">
      <input data-pf="time" data-pi="${i}" type="time" value="${c.time || ''}" style="width:95px">
      <input data-pf="cat" data-pi="${i}" list="categoriesList" value="${esc(c.cat)}" placeholder="Cat." style="width:75px">
      <button data-pf="rm" data-pi="${i}" style="min-height:34px;padding:0 10px">✕</button>
    </div>
  </div>`).join('');
}

let undoStack = [];
function pushUndo() {
  undoStack.push(JSON.stringify({ items, dayMeta }));
  if (undoStack.length > 20) undoStack.shift();
  refreshUndoBtn();
}
function refreshUndoBtn() { const b = $('#undoBtn'); if (b) b.disabled = !undoStack.length; }
function performUndo() {
  if (READONLY || !undoStack.length) return;
  const prev = JSON.parse(undoStack.pop());
  items = prev.items; dayMeta = prev.dayMeta;
  save(); saveD();
  refreshUndoBtn(); render();
  toast('Modifica annullata', 'warning');
}

window.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    if (e.shiftKey) return;
    e.preventDefault();
    performUndo();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (!READONLY) cloudPushNow().then(() => toast('Modifiche salvate', 'success'));
  }
  // Supporto Escape per chiudere tutti i popup
  if (e.key === 'Escape') {
    const modals = document.querySelectorAll('.ov');
    if (modals.length) {
      modals.forEach(m => m.remove());
    } else {
      closeMenus();
    }
  }
});

function generateMonthPDF(m) {
  if (!(window.jspdf && window.jspdf.jsPDF)) { toast('Libreria non caricata', 'warning'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pw = doc.internal.pageSize.getWidth(), ph = doc.internal.pageSize.getHeight();
  const ml = 40, mr = 40, mt = 48, mb = 40; let y = mt;
  const nl = (h = 14) => { y += h; if (y > ph - mb) { doc.addPage(); y = mt; } };

  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('Partite — ' + monthLabel(m), ml, y);
  nl(24); doc.setDrawColor(200); doc.line(ml, y, pw - mr, y); nl(16);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text('Riepilogo del mese', ml, y); nl(16);

  const rows = computeRecapRows(m);
  doc.setFontSize(10);
  if (!rows.length) { doc.setFont('helvetica', 'normal'); doc.text('Nessun dato.', ml, y); nl(16); }
  else {
    const cols = [{ w: 170, h: 'Nome' }, { w: 90, h: 'Partite' }, { w: 110, h: 'Apert./Chius.' }, { w: 80, h: 'Totale' }];
    doc.setFont('helvetica', 'bold'); let x = ml; cols.forEach(c => { doc.text(c.h, x, y); x += c.w; }); nl(14);
    doc.setDrawColor(220); doc.line(ml, y - 10, pw - mr, y - 10);
    doc.setFont('helvetica', 'normal');
    rows.forEach(r => {
      const v = Object.assign({ p: 10, a: 10, c: 10 }, molt[r.n.toLowerCase()]);
      const pv = r.p * v.p, av = r.a * v.a + r.c * v.c, tot = pv + av;
      let x = ml;
      [r.n, String(pv), String(av), String(tot)].forEach((t, i) => { doc.text(t, x, y); x += cols[i].w; });
      nl(15);
    });
  }
  nl(10);
  const days = {};
  items.filter(i => i.date.startsWith(m)).forEach(i => (days[i.date] ??= []).push(i));
  Object.keys(dayMeta).filter(d => d.startsWith(m)).forEach(d => { if (!days[d]) days[d] = []; });
  const dateKeys = Object.keys(days).sort();
  dateKeys.forEach(dt => {
    const list = days[dt]; if (!list.length) return;
    const x = dayMeta[dt] || {};
    doc.setDrawColor(210); doc.line(ml, y, pw - mr, y); nl(16);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
    doc.text(new Date(dt + 'T12:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }), ml, y);
    nl(14);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    const ap = x.ap === 'si' ? ('Apertura: sì (' + (x.apNome || '—') + ')') : 'Apertura: no';
    const ch = x.ch === 'si' ? ('Chiusura: sì (' + (x.chNome || '—') + ')') : 'Chiusura: no';
    doc.text(ap + '    ' + ch, ml, y); nl(16);
    list.forEach(it => {
      doc.setFont('helvetica', 'bold'); doc.text(`• ${it.time ? it.time + ' - ' : ''}${it.title || '(senza titolo)'}${it.friendly ? ' [AMICHEVOLE]' : ''}`, ml + 6, y); nl(13);
      doc.setFont('helvetica', 'normal');
      doc.text(`Tavolo 1: ${it.t1 || '—'}    Tavolo 2: ${it.t2 || '—'}    Arbitro: ${it.arb || '—'}`, ml + 16, y);
      nl(16);
    });
    nl(4);
  });
  doc.save('partite_' + m + '.pdf');
  toast('PDF scaricato', 'success');
}

function setAuthMode(isAdmin) {
  READONLY = !isAdmin;
  if (document.body) {
    document.body.classList.toggle('ro', READONLY);
  }
  const authBtn = $('#authBtn');
  if (authBtn) {
    authBtn.textContent = isAdmin ? '🔓 Esci' : '🔒 Accedi';
    authBtn.title = isAdmin ? 'Termina sessione amministratore' : 'Accedi con Password per modificare';
  }
  const roEl = document.getElementById('roBanner');
  if (roEl) roEl.style.display = READONLY ? 'block' : 'none';
  render();
}

async function verifyPin(entered) {
  const enteredHash = await sha256hex(entered);
  const targetHash = pinHash || await sha256hex(DEFAULT_PIN);
  return enteredHash === targetHash;
}

function promptLogin() {
  const oldOv = document.getElementById('loginOv');
  if (oldOv) oldOv.remove();

  const ov = document.createElement('div');
  ov.className = 'ov';
  ov.id = 'loginOv';
  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Accesso Amministratore">
    <h3>Accesso Gestione</h3>
    <p style="font-size:13px;color:var(--mute);margin:-6px 0 10px">Inserisci la password per abilitare modifiche e turni.</p>
    <div class="frow">
      <label for="loginPin">Password Admin</label>
      <input id="loginPin" type="password" placeholder="Inserisci Password" autocomplete="current-password" autofocus>
    </div>
    <p class="err" id="loginErr">Password errata. Riprova.</p>
    <div class="mbtns">
      <button type="button" id="loginCancel">Annulla</button>
      <button type="button" class="primary" id="loginGo">Sblocca</button>
    </div>
  </div>`;
  document.body.appendChild(ov);

  const go = async () => {
    const val = document.getElementById('loginPin').value;
    if (await verifyPin(val)) {
      sessionStorage.setItem('partite_admin_auth', '1');
      setAuthMode(true);
      ov.remove();
      toast('Accesso consentito', 'success');
    } else {
      triggerHaptic('warning');
      document.getElementById('loginErr').classList.add('on');
      document.getElementById('loginPin').value = '';
      document.getElementById('loginPin').focus();
    }
  };

  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  document.getElementById('loginCancel').onclick = () => ov.remove();
  document.getElementById('loginGo').onclick = go;
  document.getElementById('loginPin').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  setTimeout(() => document.getElementById('loginPin')?.focus(), 80);
}

function promptChangePin() {
  if (READONLY) return;
  const ov = document.createElement('div');
  ov.className = 'ov';
  ov.id = 'changePinOv';
  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Cambia Password">
    <h3>Cambia Password Admin</h3>
    <div class="frow"><label for="oldPin">Password Attuale</label><input id="oldPin" type="password" autofocus></div>
    <div class="frow"><label for="newPin">Nuova Password</label><input id="newPin" type="password"></div>
    <p class="err" id="chPinErr">Password errata.</p>
    <div class="mbtns">
      <button type="button" id="chPinCancel">Annulla</button>
      <button type="button" class="primary" id="chPinSave">Salva</button>
    </div>
  </div>`;
  document.body.appendChild(ov);

  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  document.getElementById('chPinCancel').onclick = () => ov.remove();

  document.getElementById('chPinSave').onclick = async () => {
    const oldP = document.getElementById('oldPin').value;
    const newP = document.getElementById('newPin').value;
    if (!newP) { toast('Inserisci una password', 'warning'); return; }

    if (!(await verifyPin(oldP))) {
      triggerHaptic('warning');
      document.getElementById('chPinErr').classList.add('on');
      return;
    }

    pinHash = await sha256hex(newP);
    await cloudPushNow();
    ov.remove();
    toast('Password salvata', 'success');
  };
}

function bindEvents() {
  const authBtn = $('#authBtn');
  if (authBtn) {
    authBtn.onclick = () => window.handleAuthClick();
  }

  const notifyBtn = $('#notifyBtn');
  if (notifyBtn) notifyBtn.onclick = () => requestNotificationPermission();

  const changePinBtn = $('#changePinBtn');
  if (changePinBtn) changePinBtn.onclick = promptChangePin;

  const shareLinkBtn = $('#shareLinkBtn');
  if (shareLinkBtn) {
    shareLinkBtn.onclick = async () => {
      const cleanUrl = location.origin + location.pathname;
      try {
        await navigator.clipboard.writeText(cleanUrl);
        toast('Link copiato!', 'success');
      } catch(e) { prompt('Copia il link:', cleanUrl); }
    };
  }

  const themeBtn = $('#themeBtn');
  if (themeBtn) {
    themeBtn.onclick = () => {
      const ov = document.createElement('div'); ov.className = 'ov'; ov.id = 'themeOv';
      ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Scegli Tema">
        <h3>Tema / Stile</h3>
        <div class="frow">
          <label for="themeSelectModal">Aspetto grafico</label>
          <select id="themeSelectModal">
            <option value="default"${currentTheme === 'default' ? ' selected' : ''}>🎨 Standard (Auto)</option>
            <option value="synthwave"${currentTheme === 'synthwave' ? ' selected' : ''}>🕹 Synthwave Neon</option>
            <option value="gazzetta"${currentTheme === 'gazzetta' ? ' selected' : ''}>📰 Gazzetta Rosa</option>
            <option value="tv"${currentTheme === 'tv' ? ' selected' : ''}>📺 Tabellone TV</option>
          </select>
        </div>
        <div class="mbtns"><button type="button" id="themeClose" class="primary">Fatto</button></div>
      </div>`;
      document.body.appendChild(ov);
      ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
      document.getElementById('themeSelectModal').onchange = e => applyTheme(e.target.value);
      document.getElementById('themeClose').onclick = () => ov.remove();
    };
  }

  const qSave = $('#quickSaveBtn');
  if (qSave) qSave.onclick = async () => {
    const ok = await cloudPushNow();
    toast(ok ? 'Salvataggio completato!' : 'Errore salvataggio', ok ? 'success' : 'warning');
  };

  const qPull = $('#quickPullBtn');
  if (qPull) qPull.onclick = async () => {
    await cloudPullSafe(false);
    render();
    toast('Aggiornato!', 'success');
  };

  const expMulti = $('#exportMultiJsonBtn');
  if (expMulti) expMulti.onclick = openExportMultiModal;

  const resBtn = $('#resocontoBtn');
  if (resBtn) resBtn.onclick = openResocontoModal;

  const addBtn = $('#add');
  if (addBtn) addBtn.onclick = openAddModal;

  const waToday = $('#waTodayBtn');
  if (waToday) waToday.onclick = () => copyWhatsAppRollingToday();

  const undoB = $('#undoBtn');
  if (undoB) { undoB.disabled = true; undoB.onclick = performUndo; }

  const todayB = $('#todayBtn');
  if (todayB) {
    todayB.onclick = () => {
      triggerHaptic('light');
      const t = iso(new Date());
      setParam('m', t.slice(0, 7)); 
      setParam('s', iso(monday(t)));
    };
  }

  const searchInput = $('#searchFilter');
  if (searchInput) {
    searchInput.oninput = e => {
      searchQuery = e.target.value;
      render();
    };
  }

  const fCat = $('#filterCat');
  if (fCat) fCat.onchange = e => { filterCat = e.target.value; render(); };

  const fInc = $('#filterIncomplete');
  if (fInc) {
    fInc.onclick = e => {
      triggerHaptic('light');
      filterIncomplete = !filterIncomplete;
      e.target.setAttribute('aria-pressed', String(filterIncomplete));
      render();
    };
  }

  // GESTIONE NOMI E SCHEDA PERSONALE
  const namesB = $('#namesBtn');
  if (namesB) {
    namesB.onclick = () => {
      if (READONLY) return;
      const ov = document.createElement('div'); ov.className = 'ov'; ov.id = 'namesOv';
      const rowsHtml = () => names.length
        ? names.map(n => `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--line)">
            <span style="font-weight:600;font-size:14px">${esc(n)}</span>
            <div style="display:flex;gap:6px">
              <button type="button" data-viewcard="${esc(n)}" style="min-height:26px;padding:2px 8px;font-size:12px" title="Vedi scheda">📊 Scheda</button>
              <button type="button" data-rmname="${esc(n)}" style="min-height:26px;padding:2px 8px;font-size:12px" title="Rimuovi">✕</button>
            </div>
          </div>`).join('')
        : '<p style="color:var(--mute);font-size:13px;margin:4px 0">Nessun nome inserito.</p>';
      ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Nomi">
        <h3>Elenco Collaboratori</h3>
        <p style="font-size:12px;color:var(--mute);margin:-6px 0 10px">Tocca "📊 Scheda" per visualizzare presenze e andamento.</p>
        <div id="namesListWrap" style="max-height:220px;overflow-y:auto;margin-bottom:8px">${rowsHtml()}</div>
        <div class="frow" style="display:flex;gap:6px"><input id="newNameInput" type="text" placeholder="Nuovo nome" style="flex:1"><button type="button" class="primary" id="addNameBtn">Aggiungi</button></div>
        <div class="mbtns"><button type="button" id="namesClose">Chiudi</button></div>
      </div>`;
      document.body.appendChild(ov);
      const refreshList = () => { document.getElementById('namesListWrap').innerHTML = rowsHtml(); };
      ov.addEventListener('click', e => {
        if (e.target === ov) { ov.remove(); return; }

        const cardBtn = e.target.closest('[data-viewcard]');
        if (cardBtn) {
          openPersonHistoryModal(cardBtn.dataset.viewcard);
          return;
        }

        const rm = e.target.closest('[data-rmname]');
        if (rm) { names = names.filter(n => n.toLowerCase() !== rm.dataset.rmname.toLowerCase()); saveNames(); renderNamesList(); refreshList(); return; }
        if (e.target.id === 'addNameBtn') {
          const inp = document.getElementById('newNameInput'), v = inp.value.trim();
          if (v && !names.some(n => n.toLowerCase() === v.toLowerCase())) {
            names.push(v); names.sort((a, b) => a.localeCompare(b)); saveNames(); renderNamesList(); refreshList();
          }
          inp.value = ''; inp.focus();
        }
      });
      document.getElementById('newNameInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('addNameBtn').click(); } });
      document.getElementById('namesClose').onclick = () => ov.remove();
      document.getElementById('newNameInput').focus();
    };
  }

  const catB = $('#catBtn');
  if (catB) {
    catB.onclick = () => {
      if (READONLY) return;
      const ov = document.createElement('div'); ov.className = 'ov'; ov.id = 'catOv';
      const rowsHtml = () => categories.length
        ? categories.map(c => `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--line)"><span>${esc(c)}</span><button type="button" data-rmcat="${esc(c)}" style="min-height:26px;padding:2px 8px;font-size:12px">✕</button></div>`).join('')
        : '<p style="color:var(--mute);font-size:13px;margin:4px 0">Nessuna categoria.</p>';
      ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Categorie">
        <h3>Categorie</h3>
        <div id="catListWrap" style="max-height:220px;overflow-y:auto;margin-bottom:8px">${rowsHtml()}</div>
        <div class="frow" style="display:flex;gap:6px"><input id="newCatInput" type="text" placeholder="Es. U17" style="flex:1"><button type="button" class="primary" id="addCatBtn">Aggiungi</button></div>
        <div class="mbtns"><button type="button" id="catClose">Chiudi</button></div>
      </div>`;
      document.body.appendChild(ov);
      const refreshList = () => { document.getElementById('catListWrap').innerHTML = rowsHtml(); };
      ov.addEventListener('click', e => {
        if (e.target === ov) { ov.remove(); return; }
        const rm = e.target.closest('[data-rmcat]');
        if (rm) { categories = categories.filter(c => c.toLowerCase() !== rm.dataset.rmcat.toLowerCase()); saveCategories(); renderCategoriesList(); refreshList(); return; }
        if (e.target.id === 'addCatBtn') {
          const inp = document.getElementById('newCatInput'), v = inp.value.trim();
          if (v && !categories.some(c => c.toLowerCase() === v.toLowerCase())) {
            categories.push(v); categories.sort((a, b) => a.localeCompare(b)); saveCategories(); renderCategoriesList(); refreshList();
          }
          inp.value = ''; inp.focus();
        }
      });
      document.getElementById('newCatInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('addCatBtn').click(); } });
      document.getElementById('catClose').onclick = () => ov.remove();
      document.getElementById('newCatInput').focus();
    };
  }

  const prnB = $('#printBtn');
  if (prnB) {
    prnB.onclick = () => {
      const months = monthsWithData();
      if (!months.length) { toast('Nessuna gara presente', 'warning'); return; }
      const cur = params().get('m');
      const def = months.includes(cur) ? cur : months[months.length - 1];
      const ov = document.createElement('div'); ov.className = 'ov'; ov.id = 'printOv';
      ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Stampa PDF">
        <h3>Stampa PDF</h3>
        <div class="frow"><label for="pMonth">Mese</label>
          <select id="pMonth">
            ${months.map(m => `<option value="${m}"${m === def ? ' selected' : ''}>${monthLabel(m)}</option>`).join('')}
          </select>
        </div>
        <div class="mbtns"><button type="button" id="pCancel">Annulla</button><button type="button" class="primary" id="pGo">Genera PDF</button></div>
      </div>`;
      document.body.appendChild(ov);
      ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
      document.getElementById('pCancel').onclick = () => ov.remove();
      document.getElementById('pGo').onclick = () => {
        const m = document.getElementById('pMonth').value; ov.remove();
        generateMonthPDF(m);
      };
    };
  }

  const impB = $('#importBtn');
  if (impB) impB.onclick = () => $('#importFile')?.click();

  const impF = $('#importFile');
  if (impF) {
    impF.onchange = e => {
      if (READONLY) return;
      const file = e.target.files[0]; e.target.value = ''; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!Array.isArray(data)) throw new Error();
          const { newItems, wi } = fromExportFormat(data);
          pushUndo();
          const map = new Map(items.map(i => [i.id, i]));
          newItems.forEach(i => map.set(i.id, i));
          items = [...map.values()];
          Object.assign(dayMeta, wi);
          save(); saveD(); render();
          toast(`${newItems.length} partite importate`, 'success');
        } catch(err) { toast('File non valido', 'warning'); }
      };
      reader.readAsText(file);
    };
  }

  const pdfBtn = $('#pdfImportBtn');
  if (pdfBtn) {
    pdfBtn.onclick = () => {
      if (READONLY) return;
      const ov = document.createElement('div'); ov.className = 'ov'; ov.id = 'pdfOv';
      ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Importa PDF">
        <h3>Importa da PDF</h3>
        <div class="frow"><label for="pdfFile">File PDF</label><input id="pdfFile" type="file" accept="application/pdf,.pdf"></div>
        <div class="frow"><label for="pdfTeam">Nome squadra di casa</label><input id="pdfTeam" type="text" placeholder="Es. VIS PERSICETO"></div>
        <div class="mbtns"><button type="button" id="pdfCancel">Annulla</button><button type="button" class="primary" id="pdfGo">Estrai</button></div>
        <div id="pdfPreviewWrap" style="margin-top:10px;max-height:220px;overflow-y:auto"></div>
        <div class="mbtns" id="pdfConfirmBtns" style="display:none;margin-top:10px"><button type="button" id="pdfAddAll" class="primary" style="width:100%">Aggiungi al calendario</button></div>
      </div>`;
      document.body.appendChild(ov);
      ov.addEventListener('click', e => {
        if (e.target === ov) { ov.remove(); return; }
        const rm = e.target.closest('[data-pf="rm"]');
        if (rm) { pdfCandidates.splice(+rm.dataset.pi, 1); renderPdfPreview(); return; }
      });
      ov.addEventListener('input', e => {
        const f = e.target.dataset.pf; if (!f || f === 'rm') return;
        pdfCandidates[+e.target.dataset.pi][f] = e.target.value;
      });
      document.getElementById('pdfCancel').onclick = () => ov.remove();
      document.getElementById('pdfGo').onclick = async () => {
        const file = document.getElementById('pdfFile').files[0];
        const team = document.getElementById('pdfTeam').value.trim();
        if (!file || !team) { toast('Dati mancanti', 'warning'); return; }
        if (!window.pdfjsLib) { toast('Libreria non caricata', 'warning'); return; }
        const btn = document.getElementById('pdfGo'); btn.disabled = true; btn.textContent = 'Estrazione…';
        try {
          const lines = await pdfToLines(file);
          pdfCandidates = extractHomeMatches(lines, team);
          document.getElementById('pdfConfirmBtns').style.display = pdfCandidates.length ? 'flex' : 'none';
          renderPdfPreview();
        } catch(e) { toast('Errore lettura', 'warning'); }
        btn.disabled = false; btn.textContent = 'Estrai';
      };
      document.getElementById('pdfAddAll').onclick = () => {
        const valid = pdfCandidates.filter(c => c.date);
        pushUndo();
        valid.forEach(c => {
          items.push({ 
            id: uid(), 
            title: c.title, 
            date: c.date, 
            time: c.time || '', 
            cat: c.cat || '', 
            friendly: false,
            score: '',
            status: '',
            t1: '', t2: '', arb: '', 
            ghost: false,
            ts: Date.now() 
          });
        });
        save(); 
        ov.remove(); 
        render();
        toast(`${valid.length} gare aggiunte`, 'success');
      };
    };
  }

  initMenu('menuBtn', 'menuDrop');
  initMenu('gearBtn', 'gearDrop');
  document.addEventListener('click', e => { if (!e.target.closest('.menuWrap')) closeMenus(); });
}

window.addEventListener('DOMContentLoaded', async () => {
  if (window.Telegram?.WebApp) {
    try {
      window.Telegram.WebApp.ready();
      window.Telegram.WebApp.expand();
      if (window.Telegram.WebApp.setHeaderColor) {
        window.Telegram.WebApp.setHeaderColor('#1f2020');
      }
    } catch(e) {}
  }

  bindEvents();
  renderNamesList();
  renderCategoriesList();

  const isAuth = sessionStorage.getItem('partite_admin_auth') === '1';
  setAuthMode(isAuth);

  window.addEventListener('hashchange', () => { 
    mem = null; 
    render(); 
  });

  if (sb) {
    setSyncVisualState('orange');
    try {
      const raw = await cloudFetchRaw();
      if (raw) {
        applyCloudData(raw);
        setSyncVisualState('green');
      } else {
        setSyncVisualState('green');
      }
    } catch(e) {
      setSyncVisualState('red');
    }
    setupSupabaseRealtime();
  } else {
    setSyncVisualState('green', 'Memoria locale attiva');
  }

  render();
  checkAndTriggerScheduledNotifications();
});