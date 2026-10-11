if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('Service Worker non registrato:', err);
    });
  });
}

// ----------------------------------------------------
// CONFIGURAZIONE INTERNA SUPABASE
// ----------------------------------------------------
const SUPABASE_CONFIG = {
  url: 'https://aiagtwiqeecaxhaaqzmx.supabase.co',
  anonKey: 'sb_publishable_PodV98vtRyuW329msfQKrA_goxv6C_c' // La chiave anon pubblica di Supabase
};

let supabaseClient = null;
let realtimeChannel = null;
let currentUser = null;

// Elementi Auth
const authOverlay = document.getElementById('authOverlay');
const appContent = document.getElementById('appContent');
const loginForm = document.getElementById('loginForm');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const loginSubmitBtn = document.getElementById('loginSubmitBtn');
const authErrorMsg = document.getElementById('authErrorMsg');

const accountUserEmail = document.getElementById('accountUserEmail');
const currentAccountDisplay = document.getElementById('currentAccountDisplay');
const logoutBtn = document.getElementById('logoutBtn');
const cloudStatusDot = document.getElementById('cloudStatusDot');

function setCloudStatus(status) {
  if (!cloudStatusDot) return;
  cloudStatusDot.classList.remove('online', 'error');
  if (status === 'online') {
    cloudStatusDot.classList.add('online');
    cloudStatusDot.title = 'Sincronizzazione Cloud Realtime attiva';
  } else if (status === 'error') {
    cloudStatusDot.classList.add('error');
    cloudStatusDot.title = 'Errore di connessione a Supabase';
  } else {
    cloudStatusDot.title = 'In attesa di autenticazione';
  }
}

// Generatore ID sicuro
function generateUniqueId() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    return Math.floor(Date.now() / 1000) * 1000000 + (array[0] % 1000000);
  }
  return Date.now() + Math.floor(Math.random() * 10000);
}

// ----------------------------------------------------
// INIZIALIZZAZIONE & GESTIONE SESSIONE (AUTH)
// ----------------------------------------------------
async function initAuthAndApp() {
  if (!window.supabase) {
    alert('Libreria Supabase non caricata. Verifica la connessione a internet.');
    return;
  }

  supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);

  // Ascolta i cambiamenti di autenticazione (Login, Logout, Token Refresh)
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (session && session.user) {
      handleAuthenticatedState(session.user);
    } else {
      handleUnauthenticatedState();
    }
  });

  // Controlla se esiste già una sessione attiva
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session && session.user) {
    handleAuthenticatedState(session.user);
  } else {
    handleUnauthenticatedState();
  }
}

function handleAuthenticatedState(user) {
  currentUser = user;
  authOverlay.style.display = 'none';
  appContent.style.display = 'flex';
  openModalBtn.style.display = 'flex';

  if (accountUserEmail) accountUserEmail.textContent = user.email;
  if (currentAccountDisplay) currentAccountDisplay.textContent = user.email;

  fetchDataFromSupabase();
  setupRealtimeSubscriptions();
  checkAndTriggerTodayNotifications();
}

function handleUnauthenticatedState() {
  currentUser = null;
  authOverlay.style.display = 'flex';
  appContent.style.display = 'none';
  openModalBtn.style.display = 'none';
  setCloudStatus('offline');

  if (realtimeChannel && supabaseClient) {
    supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

// Invio Login Form
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = loginEmail.value.trim();
  const password = loginPassword.value;

  loginSubmitBtn.disabled = true;
  loginSubmitBtn.textContent = 'Verifica in corso...';
  authErrorMsg.style.display = 'none';

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    loginForm.reset();
  } catch (err) {
    authErrorMsg.textContent = err.message || 'Credenziali non corrette o utente non trovato.';
    authErrorMsg.style.display = 'block';
  } finally {
    loginSubmitBtn.disabled = false;
    loginSubmitBtn.textContent = 'Accedi';
  }
});

// Logout
logoutBtn.addEventListener('click', async () => {
  if (confirm('Vuoi davvero disconnettere questo account?')) {
    closeSettingsModal();
    await supabaseClient.auth.signOut();
  }
});

// ----------------------------------------------------
// REALTIME & DATI SUPABASE
// ----------------------------------------------------
function setupRealtimeSubscriptions() {
  if (!supabaseClient || !currentUser) return;

  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
  }

  realtimeChannel = supabaseClient
    .channel('public:items')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'items' },
      (payload) => {
        handleRealtimeEvent(payload);
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setCloudStatus('online');
      }
    });
}

function handleRealtimeEvent(payload) {
  const { eventType, new: newRow, old: oldRow } = payload;

  if (eventType === 'INSERT') {
    const exists = appData.items.some(i => i.id === Number(newRow.id));
    if (!exists) {
      appData.items.unshift(formatRowToItem(newRow));
      saveData();
      renderList();
    }
  } else if (eventType === 'UPDATE') {
    const idx = appData.items.findIndex(i => i.id === Number(newRow.id));
    if (idx !== -1) {
      appData.items[idx] = formatRowToItem(newRow);
      saveData();
      renderList();
    }
  } else if (eventType === 'DELETE') {
    if (oldRow && oldRow.id) {
      appData.items = appData.items.filter(i => i.id !== Number(oldRow.id));
      saveData();
      renderList();
    }
  }
}

function formatRowToItem(row) {
  return {
    id: Number(row.id),
    title: row.title,
    set: row.set_type,
    category: row.category,
    date: row.date,
    number: row.number,
    rating: row.rating,
    unplayed: Boolean(row.unplayed),
    purchased: Boolean(row.purchased),
    completed: Boolean(row.completed),
    missingGapNotice: row.missing_gap_notice,
    readingChapter: row.reading_chapter || '',
    privateComment: row.private_comment || ''
  };
}

async function fetchDataFromSupabase() {
  if (!supabaseClient || !currentUser) return;

  try {
    const { data: catData, error: catErr } = await supabaseClient
      .from('categories')
      .select('name');

    if (!catErr && catData && catData.length > 0) {
      appData.categories = catData.map(c => c.name);
    }

    const { data: itemData, error: itemErr } = await supabaseClient
      .from('items')
      .select('*');

    if (itemErr) throw itemErr;

    if (itemData) {
      appData.items = itemData.map(formatRowToItem);
    }

    setCloudStatus('online');
    saveData();
    updateCategoryDropdown();
    renderList();
  } catch (err) {
    console.error('Errore durante il recupero dei dati da Supabase:', err);
    setCloudStatus('error');
  }
}

async function syncItemToSupabase(item) {
  if (!supabaseClient || !currentUser) return;

  try {
    const { error } = await supabaseClient.from('items').upsert({
      id: item.id,
      title: item.title,
      set_type: item.set,
      category: item.category || 'Generale',
      date: item.date || null,
      number: item.number || null,
      rating: item.rating !== undefined ? item.rating : null,
      unplayed: Boolean(item.unplayed),
      purchased: Boolean(item.purchased),
      completed: Boolean(item.completed),
      missing_gap_notice: item.missingGapNotice || null,
      reading_chapter: item.readingChapter || null,
      private_comment: item.privateComment || null
    });

    if (error) throw error;
    setCloudStatus('online');
  } catch (err) {
    console.error(`Errore sync item #${item.id}:`, err);
    setCloudStatus('error');
  }
}

async function deleteItemFromSupabase(id) {
  if (!supabaseClient || !currentUser) return;

  try {
    const { error } = await supabaseClient.from('items').delete().eq('id', id);
    if (error) throw error;
    setCloudStatus('online');
  } catch (err) {
    console.error(`Errore eliminazione item #${id}:`, err);
    setCloudStatus('error');
  }
}

async function syncCategoriesToSupabase() {
  if (!supabaseClient || !currentUser) return;

  try {
    const payload = appData.categories.map(c => ({ id: c, name: c }));
    const { error } = await supabaseClient.from('categories').upsert(payload);
    if (error) throw error;
    setCloudStatus('online');
  } catch (err) {
    console.error('Errore sync categorie:', err);
    setCloudStatus('error');
  }
}

// ----------------------------------------------------
// STATO APPLICAZIONE LOCALE
// ----------------------------------------------------
const DEFAULT_DATA = {
  categories: ['Generale', 'Manga', 'Comics', 'Libri', 'Videogiochi'],
  items: []
};

let appData = JSON.parse(localStorage.getItem('collection_data')) || JSON.parse(JSON.stringify(DEFAULT_DATA));

appData.items.forEach(item => {
  if (typeof item.purchased === 'undefined') item.purchased = false;
  if (typeof item.unplayed === 'undefined') item.unplayed = false;
  if (typeof item.completed === 'undefined') item.completed = false;
  if (typeof item.readingChapter === 'undefined') item.readingChapter = '';
  if (typeof item.privateComment === 'undefined') item.privateComment = '';
  if (item.rating && item.rating <= 5) item.rating = item.rating * 20;
});

let activeSet = localStorage.getItem('pref_set') || 'Acquisti';
let activeCategory = localStorage.getItem('pref_category') || 'Generale';
let activeTimeFilter = localStorage.getItem('pref_time_filter') || 'all';
let currentSortMode = localStorage.getItem('pref_sort_mode') || 'date';
let isPurchasedSectionOpen = localStorage.getItem('pref_purchased_open') === 'true';
let notificationsEnabled = localStorage.getItem('pref_notifications') === 'true';

let searchSeriesQuery = '';
let deletedItemBuffer = null;
let undoTimeoutId = null;
let currentOverviewItemId = null;
let html5QrCodeScanner = null;

const SORT_LABELS = {
  date: 'Per Data',
  name: 'Per Nome (A-Z)',
  number: 'Per Valore / #'
};

const CATEGORY_COLORS = ['#38bdf8', '#c084fc', '#f59e0b', '#34d399', '#f472b6', '#a78bfa', '#fb923c'];

function getCategoryColor(catName) {
  if (!catName) return '#38bdf8';
  let hash = 0;
  for (let i = 0; i < catName.length; i++) {
    hash = catName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % CATEGORY_COLORS.length;
  return CATEGORY_COLORS[index];
}

// Elementi DOM
const contentList = document.getElementById('contentList');
const categoryFilter = document.getElementById('categoryFilter');
const setTabs = document.getElementById('setTabs');
const timeFilterRow = document.getElementById('timeFilterRow');
const toggleSortBtn = document.getElementById('toggleSortBtn');
const sortIndicatorText = document.getElementById('sortIndicatorText');

const searchBarWrap = document.getElementById('searchBarWrap');
const seriesSearchInput = document.getElementById('seriesSearchInput');
const clearSearchBtn = document.getElementById('clearSearchBtn');

const purchasedSection = document.getElementById('purchasedSection');
const purchasedList = document.getElementById('purchasedList');
const togglePurchasedBtn = document.getElementById('togglePurchasedBtn');
const purchasedCount = document.getElementById('purchasedCount');
const chevronIcon = document.getElementById('chevronIcon');

const undoToast = document.getElementById('undoToast');
const undoToastMsg = document.getElementById('undoToastMsg');
const undoBtn = document.getElementById('undoBtn');

// Modale Form
const openModalBtn = document.getElementById('openModalBtn');
const closeModalBtn = document.getElementById('closeModalBtn');
const cancelBtn = document.getElementById('cancelBtn');
const modalBackdrop = document.getElementById('modalBackdrop');
const itemForm = document.getElementById('itemForm');
const modalTitle = document.getElementById('modalTitle');
const editItemId = document.getElementById('editItemId');

const itemTitle = document.getElementById('itemTitle');
const targetSet = document.getElementById('targetSet');
const purchasesFields = document.getElementById('purchasesFields');
const dateGroupWrapper = document.getElementById('dateGroupWrapper');
const itemDate = document.getElementById('itemDate');
const itemNumber = document.getElementById('itemNumber');
const completedGroupWrapper = document.getElementById('completedGroupWrapper');
const itemCompletedCheckbox = document.getElementById('itemCompletedCheckbox');
const ratingInputGroup = document.getElementById('ratingInputGroup');
const itemScoreInput = document.getElementById('itemScoreInput');
const itemUnplayedCheckbox = document.getElementById('itemUnplayedCheckbox');

const categorySelect = document.getElementById('categorySelect');
const newCategoryGroup = document.getElementById('newCategoryGroup');
const newCategoryInput = document.getElementById('newCategoryInput');
const existingTitlesList = document.getElementById('existingTitlesList');

// Scanner Barcode
const startScanBtn = document.getElementById('startScanBtn');
const scannerContainer = document.getElementById('scannerContainer');
const closeScannerBtn = document.getElementById('closeScannerBtn');
const scannerStatus = document.getElementById('scannerStatus');

// Modale Panoramica Posseduti
const overviewModalBackdrop = document.getElementById('overviewModalBackdrop');
const closeOverviewBtn = document.getElementById('closeOverviewBtn');
const overviewCategoryTag = document.getElementById('overviewCategoryTag');
const overviewTitleDisplay = document.getElementById('overviewTitleDisplay');
const overviewVolumeDisplay = document.getElementById('overviewVolumeDisplay');
const overviewGapPill = document.getElementById('overviewGapPill');
const overviewGapDisplay = document.getElementById('overviewGapDisplay');
const overviewReadingProgressInput = document.getElementById('overviewReadingProgressInput');
const overviewCommentInput = document.getElementById('overviewCommentInput');
const overviewEditFullBtn = document.getElementById('overviewEditFullBtn');
const saveOverviewDetailsBtn = document.getElementById('saveOverviewDetailsBtn');

// Modale Statistiche
const openStatsBtn = document.getElementById('openStatsBtn');
const closeStatsBtn = document.getElementById('closeStatsBtn');
const statsModalBackdrop = document.getElementById('statsModalBackdrop');
const statTotalItems = document.getElementById('statTotalItems');
const statTotalOwned = document.getElementById('statTotalOwned');
const statAverageRating = document.getElementById('statAverageRating');
const statCompleteRate = document.getElementById('statCompleteRate');
const statsCatList = document.getElementById('statsCatList');

// Modale Impostazioni
const openSettingsBtn = document.getElementById('openSettingsBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const settingsModalBackdrop = document.getElementById('settingsModalBackdrop');
const settingsTitle = document.getElementById('settingsTitle');
const settingsBackBtn = document.getElementById('settingsBackBtn');

const settingsMainView = document.getElementById('settingsMainView');
const settingsAccountView = document.getElementById('settingsAccountView');
const settingsCategoriesView = document.getElementById('settingsCategoriesView');
const settingsExportView = document.getElementById('settingsExportView');
const settingsImportView = document.getElementById('settingsImportView');
const settingsResetView = document.getElementById('settingsResetView');

const goToAccountBtn = document.getElementById('goToAccountBtn');
const goToCategoriesBtn = document.getElementById('goToCategoriesBtn');
const goToExportBtn = document.getElementById('goToExportBtn');
const goToImportBtn = document.getElementById('goToImportBtn');
const goToResetBtn = document.getElementById('goToResetBtn');
const notificationsToggleCheckbox = document.getElementById('notificationsToggleCheckbox');

// CRUD Categorie
const manageCatList = document.getElementById('manageCatList');
const newCatManageInput = document.getElementById('newCatManageInput');
const addCatManageBtn = document.getElementById('addCatManageBtn');

// Backup & Reset
const confirmExportBtn = document.getElementById('confirmExportBtn');
const exportAcquisti = document.getElementById('exportAcquisti');
const exportPosseduti = document.getElementById('exportPosseduti');
const exportVoti = document.getElementById('exportVoti');
const exportListe = document.getElementById('exportListe');
const triggerImportBtn = document.getElementById('triggerImportBtn');
const importJsonFileInput = document.getElementById('importJsonFileInput');
const cancelResetBtn = document.getElementById('cancelResetBtn');
const confirmFactoryResetBtn = document.getElementById('confirmFactoryResetBtn');

function saveData() {
  localStorage.setItem('collection_data', JSON.stringify(appData));
}

function getTodayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDateStatus(dateStr) {
  if (!dateStr) return { colorClass: 'status-orange', label: '', isToday: false, badgeType: 'standard', badgeText: '' };

  const todayStr = getTodayString();
  const [ty, tm, td] = todayStr.split('-').map(Number);
  const todayDate = new Date(ty, tm - 1, td);

  const [iy, im, id] = dateStr.split('-').map(Number);
  const itemDate = new Date(iy, im - 1, id);

  const diffTime = itemDate - todayDate;
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return { colorClass: 'status-today', label: id, isToday: true, badgeType: 'today', badgeText: 'OGGI' };
  } else if (diffDays === -1) {
    return { colorClass: 'status-green', label: id, isToday: false, badgeType: 'yesterday', badgeText: 'IERI' };
  } else if (diffDays > 0 && diffDays <= 7) {
    return { colorClass: 'status-red', label: id, isToday: false, badgeType: 'countdown', badgeText: `-${diffDays} gg` };
  } else if (diffDays < 0) {
    return { colorClass: 'status-green', label: id, isToday: false, badgeType: 'standard', badgeText: formatDisplayDate(dateStr) };
  } else {
    return { colorClass: 'status-red', label: id, isToday: false, badgeType: 'standard', badgeText: formatDisplayDate(dateStr) };
  }
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
  return date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

function getMonthYearTitle(dateStr) {
  const [y, m] = dateStr.split('-');
  const date = new Date(parseInt(y), parseInt(m) - 1, 1);
  const monthName = date.toLocaleDateString('it-IT', { month: 'long' });
  return monthName.charAt(0).toUpperCase() + monthName.slice(1);
}

function updateCategoryDropdown() {
  const previous = activeCategory;
  categoryFilter.innerHTML = '<option value="Tutte">Tutte le Categorie</option>';

  appData.categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    if (cat === previous) opt.selected = true;
    categoryFilter.appendChild(opt);
  });

  if (!appData.categories.includes(activeCategory) && activeCategory !== 'Tutte') {
    activeCategory = 'Generale';
    categoryFilter.value = 'Generale';
  }
}

categoryFilter.addEventListener('change', (e) => {
  activeCategory = e.target.value;
  localStorage.setItem('pref_category', activeCategory);
  renderList();
});

toggleSortBtn.addEventListener('click', () => {
  if (currentSortMode === 'date') currentSortMode = 'name';
  else if (currentSortMode === 'name') currentSortMode = 'number';
  else currentSortMode = 'date';

  localStorage.setItem('pref_sort_mode', currentSortMode);
  sortIndicatorText.textContent = SORT_LABELS[currentSortMode];
  renderList();
});

setTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('.segment-btn');
  if (!btn) return;

  document.querySelectorAll('.segment-btn').forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
  });

  btn.classList.add('active');
  btn.setAttribute('aria-selected', 'true');
  activeSet = btn.dataset.set;
  localStorage.setItem('pref_set', activeSet);

  updateFilterBarChips();
  renderList();
});

function updateFilterBarChips() {
  if (activeSet === 'Acquisti') {
    timeFilterRow.style.display = 'flex';
    timeFilterRow.innerHTML = `
      <button class="time-chip ${activeTimeFilter === 'all' ? 'active' : ''}" data-filter="all" type="button">Tutti</button>
      <button class="time-chip ${activeTimeFilter === 'today' ? 'active' : ''}" data-filter="today" type="button">Oggi</button>
      <button class="time-chip ${activeTimeFilter === 'week' ? 'active' : ''}" data-filter="week" type="button">Questa Settimana</button>
      <button class="time-chip ${activeTimeFilter === 'month' ? 'active' : ''}" data-filter="month" type="button">Questo Mese</button>
      <button class="time-chip ${activeTimeFilter === 'nodate' ? 'active' : ''}" data-filter="nodate" type="button">Senza Data</button>
    `;
  } else if (activeSet === 'Voti') {
    timeFilterRow.style.display = 'flex';
    timeFilterRow.innerHTML = `
      <button class="time-chip ${activeTimeFilter === 'all' ? 'active' : ''}" data-filter="all" type="button">Tutti</button>
      <button class="time-chip ${activeTimeFilter === 'scored' ? 'active' : ''}" data-filter="scored" type="button">★ Valutati</button>
      <button class="time-chip ${activeTimeFilter === 'unplayed' ? 'active' : ''}" data-filter="unplayed" type="button">⏳ Da iniziare</button>
    `;
  } else if (activeSet === 'Liste') {
    timeFilterRow.style.display = 'flex';
    timeFilterRow.innerHTML = `
      <button class="time-chip ${activeTimeFilter === 'all' ? 'active' : ''}" data-filter="all" type="button">Tutti</button>
      <button class="time-chip ${activeTimeFilter === 'hasnum' ? 'active' : ''}" data-filter="hasnum" type="button">Con Volume #</button>
      <button class="time-chip ${activeTimeFilter === 'nonum' ? 'active' : ''}" data-filter="nonum" type="button">Generici</button>
    `;
  } else {
    timeFilterRow.style.display = 'none';
  }

  timeFilterRow.querySelectorAll('.time-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      timeFilterRow.querySelectorAll('.time-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeTimeFilter = chip.dataset.filter;
      localStorage.setItem('pref_time_filter', activeTimeFilter);
      renderList();
    });
  });
}

seriesSearchInput.addEventListener('input', (e) => {
  searchSeriesQuery = e.target.value.trim().toLowerCase();
  clearSearchBtn.style.display = searchSeriesQuery ? 'flex' : 'none';
  renderList();
});

clearSearchBtn.addEventListener('click', () => {
  seriesSearchInput.value = '';
  searchSeriesQuery = '';
  clearSearchBtn.style.display = 'none';
  renderList();
});

togglePurchasedBtn.addEventListener('click', () => {
  isPurchasedSectionOpen = !isPurchasedSectionOpen;
  localStorage.setItem('pref_purchased_open', isPurchasedSectionOpen);
  purchasedList.classList.toggle('open', isPurchasedSectionOpen);
  chevronIcon.classList.toggle('open', isPurchasedSectionOpen);
  togglePurchasedBtn.setAttribute('aria-expanded', String(isPurchasedSectionOpen));
});

function matchesActiveFilter(item) {
  if (activeTimeFilter === 'all') return true;

  if (activeSet === 'Acquisti') {
    if (activeTimeFilter === 'nodate') return !item.date;
    if (!item.date) return false;

    const todayStr = getTodayString();
    const [ty, tm, td] = todayStr.split('-').map(Number);
    const today = new Date(ty, tm - 1, td);

    const [iy, im, id] = item.date.split('-').map(Number);
    const itemDateObj = new Date(iy, im - 1, id);

    if (activeTimeFilter === 'today') return item.date === todayStr;
    if (activeTimeFilter === 'month') return item.date.slice(0, 7) === todayStr.slice(0, 7);
    if (activeTimeFilter === 'week') {
      const currentDayOfWeek = today.getDay();
      const distanceToMonday = (currentDayOfWeek + 6) % 7;
      const monday = new Date(today);
      monday.setDate(today.getDate() - distanceToMonday);
      monday.setHours(0, 0, 0, 0);

      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      sunday.setHours(23, 59, 59, 999);

      return itemDateObj >= monday && itemDateObj <= sunday;
    }
  } else if (activeSet === 'Voti') {
    if (activeTimeFilter === 'unplayed') return item.unplayed === true;
    if (activeTimeFilter === 'scored') return item.unplayed !== true && item.rating !== null && item.rating !== undefined;
  } else if (activeSet === 'Liste') {
    if (activeTimeFilter === 'hasnum') return Boolean(item.number);
    if (activeTimeFilter === 'nonum') return !item.number;
  }

  return true;
}

function sortItems(itemsArray) {
  return [...itemsArray].sort((a, b) => {
    if (currentSortMode === 'name') {
      return a.title.localeCompare(b.title);
    } else if (currentSortMode === 'number') {
      if (activeSet === 'Voti') {
        const scoreA = (a.unplayed ? -1 : (a.rating || 0));
        const scoreB = (b.unplayed ? -1 : (b.rating || 0));
        return scoreB - scoreA;
      } else {
        const numA = parseInt(a.number, 10) || 0;
        const numB = parseInt(b.number, 10) || 0;
        return numA - numB;
      }
    } else {
      if (!a.date && !b.date) return 0;
      if (!a.date) return -1;
      if (!b.date) return 1;
      return a.date.localeCompare(b.date);
    }
  });
}

function renderList() {
  contentList.innerHTML = '';
  purchasedList.innerHTML = '';

  let filtered = appData.items.filter(item => item.set === activeSet);

  if (activeCategory !== 'Tutte') {
    filtered = filtered.filter(item => (item.category || 'Generale') === activeCategory);
  }

  if (searchSeriesQuery) {
    filtered = filtered.filter(item => item.title.toLowerCase().includes(searchSeriesQuery));
  }

  if (activeSet === 'Acquisti') {
    renderPurchasesLayout(filtered);
  } else {
    purchasedSection.style.display = 'none';
    renderStandardLayout(filtered);
  }
}

function renderPurchasesLayout(items) {
  const timeFiltered = items.filter(matchesActiveFilter);

  const activeItems = timeFiltered.filter(i => !i.purchased);
  const purchasedItems = timeFiltered.filter(i => i.purchased);

  if (purchasedItems.length > 0) {
    purchasedSection.style.display = 'block';
    purchasedCount.textContent = purchasedItems.length;
    sortItems(purchasedItems).forEach(item => {
      purchasedList.appendChild(createItemCard(item, true));
    });
  } else {
    purchasedSection.style.display = 'none';
  }

  if (activeItems.length === 0 && purchasedItems.length === 0) {
    if (searchSeriesQuery) {
      contentList.innerHTML = `
        <div class="empty-state-box">
          <span>Nessun volume trovato per "${escapeHtml(searchSeriesQuery)}".</span>
          <button type="button" class="quick-add-search-btn" id="quickAddSearchedBtn">
            + Aggiungi "${escapeHtml(searchSeriesQuery)}" agli Acquisti
          </button>
        </div>
      `;
      document.getElementById('quickAddSearchedBtn').addEventListener('click', () => {
        openCreateModalWithTitle(searchSeriesQuery);
      });
    } else {
      contentList.innerHTML = `<div class="empty-state-box">Nessun elemento presente con questi filtri.</div>`;
    }
    return;
  }

  if (currentSortMode !== 'date') {
    sortItems(activeItems).forEach(item => {
      contentList.appendChild(createItemCard(item, false));
    });
    return;
  }

  const noDateItems = activeItems.filter(i => !i.date);
  const withDateItems = activeItems.filter(i => i.date);

  withDateItems.sort((a, b) => a.date.localeCompare(b.date));

  noDateItems.forEach(item => {
    contentList.appendChild(createItemCard(item, false));
  });

  const monthGroups = {};
  withDateItems.forEach(item => {
    const groupKey = item.date.slice(0, 7);
    if (!monthGroups[groupKey]) monthGroups[groupKey] = [];
    monthGroups[groupKey].push(item);
  });

  Object.keys(monthGroups).sort().forEach(groupKey => {
    const header = document.createElement('div');
    header.className = 'month-group-header';

    const count = monthGroups[groupKey].length;
    const countLabel = count === 1 ? '1 volume' : `${count} volumi`;

    header.innerHTML = `
      <span class="month-group-title">${getMonthYearTitle(monthGroups[groupKey][0].date)}</span>
      <span class="month-count-pill">${countLabel}</span>
    `;
    contentList.appendChild(header);

    monthGroups[groupKey].forEach(item => {
      contentList.appendChild(createItemCard(item, false));
    });
  });
}

function renderStandardLayout(items) {
  const filtered = items.filter(matchesActiveFilter);

  if (filtered.length === 0) {
    contentList.innerHTML = `<div class="empty-state-box">Nessun elemento presente in "${activeSet}".</div>`;
    return;
  }
  sortItems(filtered).forEach(item => {
    contentList.appendChild(createItemCard(item, false));
  });
}

// Sincronizzazione automatica al check
function syncPurchasedWithPosseduti(purchasedItem) {
  const purchasedNum = parseInt(purchasedItem.number, 10);
  const titleClean = purchasedItem.title.trim().toLowerCase();
  const itemCategory = purchasedItem.category || 'Generale';

  const existingPosseduto = appData.items.find(
    i => i.set === 'Posseduti' && 
         i.title.trim().toLowerCase() === titleClean &&
         (i.category || 'Generale') === itemCategory
  );

  if (!existingPosseduto) {
    const newItem = {
      id: generateUniqueId(),
      title: purchasedItem.title,
      set: 'Posseduti',
      category: itemCategory,
      date: null,
      number: purchasedItem.number || '1',
      rating: null,
      unplayed: false,
      purchased: false,
      completed: Boolean(purchasedItem.completed),
      autoGeneratedFromPurchase: true,
      missingGapNotice: null,
      readingChapter: '',
      privateComment: ''
    };
    appData.items.unshift(newItem);
    syncItemToSupabase(newItem);

    showToastNotice(`"${purchasedItem.title}" aggiunto in Posseduti (Vol. #${purchasedItem.number || '1'})`);
  } else {
    const currentOwnedNum = parseInt(existingPosseduto.number, 10);

    if (isNaN(purchasedNum) || isNaN(currentOwnedNum)) {
      if (purchasedItem.number && existingPosseduto.number !== purchasedItem.number) {
        existingPosseduto.number = purchasedItem.number;
        syncItemToSupabase(existingPosseduto);
        showToastNotice(`Aggiornato ${existingPosseduto.title} a #${purchasedItem.number}`);
      }
    } else if (purchasedNum === currentOwnedNum + 1) {
      existingPosseduto.number = String(purchasedNum);
      existingPosseduto.missingGapNotice = null;
      syncItemToSupabase(existingPosseduto);
      showToastNotice(`Posseduti aggiornato: ${existingPosseduto.title} ora al Vol. #${purchasedNum}`);
    } else if (purchasedNum > currentOwnedNum + 1) {
      const startMissing = currentOwnedNum + 1;
      const endMissing = purchasedNum - 1;
      const missingRange = (startMissing === endMissing) ? `#${startMissing}` : `#${startMissing} - #${endMissing}`;
      
      existingPosseduto.missingGapNotice = `Mancano vol. ${missingRange}`;
      syncItemToSupabase(existingPosseduto);
      showToastNotice(`⚠️ Attenzione: per "${existingPosseduto.title}" mancano i volumi ${missingRange}!`);
    }
  }

  saveData();
}

function rollbackPurchasedFromPosseduti(uncheckItem) {
  const uncheckNum = parseInt(uncheckItem.number, 10);
  const titleClean = uncheckItem.title.trim().toLowerCase();
  const itemCategory = uncheckItem.category || 'Generale';

  const existingPosseduto = appData.items.find(
    i => i.set === 'Posseduti' && 
         i.title.trim().toLowerCase() === titleClean &&
         (i.category || 'Generale') === itemCategory
  );

  if (!existingPosseduto) return;

  const currentOwnedNum = parseInt(existingPosseduto.number, 10);

  if (existingPosseduto.autoGeneratedFromPurchase && (existingPosseduto.number === uncheckItem.number)) {
    appData.items = appData.items.filter(i => i.id !== existingPosseduto.id);
    deleteItemFromSupabase(existingPosseduto.id);
    showToastNotice(`"${uncheckItem.title}" rimosso da Posseduti (errore annullato)`);
  } else if (!isNaN(uncheckNum) && !isNaN(currentOwnedNum) && currentOwnedNum === uncheckNum) {
    const previousNum = currentOwnedNum - 1;
    if (previousNum > 0) {
      existingPosseduto.number = String(previousNum);
      existingPosseduto.missingGapNotice = null;
      syncItemToSupabase(existingPosseduto);
      showToastNotice(`Posseduti scalato: ${existingPosseduto.title} tornato al Vol. #${previousNum}`);
    } else {
      appData.items = appData.items.filter(i => i.id !== existingPosseduto.id);
      deleteItemFromSupabase(existingPosseduto.id);
      showToastNotice(`"${uncheckItem.title}" rimosso da Posseduti`);
    }
  } else if (existingPosseduto.missingGapNotice) {
    existingPosseduto.missingGapNotice = null;
    syncItemToSupabase(existingPosseduto);
    showToastNotice(`Avviso volumi mancanti rimosso per "${existingPosseduto.title}"`);
  }

  saveData();
}

function checkAndTriggerTodayNotifications() {
  if (!notificationsEnabled) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const todayStr = getTodayString();
  const lastNotifiedDate = localStorage.getItem('last_notified_date');

  if (lastNotifiedDate === todayStr) return;

  const todayReleases = appData.items.filter(
    i => i.set === 'Acquisti' && !i.purchased && i.date === todayStr
  );

  if (todayReleases.length > 0) {
    const titleText = todayReleases.length === 1 
      ? `In uscita oggi: ${todayReleases[0].title} ${todayReleases[0].number ? '#' + todayReleases[0].number : ''}`
      : `Oggi ci sono ${todayReleases.length} uscite in fumetteria!`;

    const bodyText = todayReleases.map(i => `${i.title} ${i.number ? '#' + i.number : ''}`).join(', ');

    try {
      new Notification(titleText, {
        body: bodyText,
        icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'><rect width='192' height='192' rx='40' fill='%230d0e12'/><circle cx='96' cy='96' r='48' fill='%2338bdf8'/></svg>"
      });
      localStorage.setItem('last_notified_date', todayStr);
    } catch (e) {}
  }
}

notificationsToggleCheckbox.checked = notificationsEnabled;
notificationsToggleCheckbox.addEventListener('change', async (e) => {
  if (e.target.checked) {
    if (!('Notification' in window)) {
      alert('Il tuo browser non supporta le notifiche native.');
      e.target.checked = false;
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      notificationsEnabled = true;
      localStorage.setItem('pref_notifications', 'true');
      showToastNotice('Notifiche native attivate!');
      checkAndTriggerTodayNotifications();
    } else {
      notificationsEnabled = false;
      localStorage.setItem('pref_notifications', 'false');
      e.target.checked = false;
      alert('Permesso per le notifiche negato nelle impostazioni.');
    }
  } else {
    notificationsEnabled = false;
    localStorage.setItem('pref_notifications', 'false');
    showToastNotice('Notifiche disattivate.');
  }
});

function showToastNotice(message) {
  undoToastMsg.textContent = message;
  undoBtn.style.display = 'none';
  undoToast.classList.add('show');

  if (undoTimeoutId) clearTimeout(undoTimeoutId);
  undoTimeoutId = setTimeout(() => {
    undoToast.classList.remove('show');
    undoBtn.style.display = 'inline-block';
  }, 4500);
}

async function shareItemDetails(item) {
  const numStr = item.number ? ` #${item.number}` : '';
  const dateStr = item.date ? ` (Uscita: ${formatDisplayDate(item.date)})` : '';
  const shareText = `Dalla mia collezione: "${item.title}${numStr}" [${item.category || 'Generale'}]${dateStr}`;

  if (navigator.share) {
    try {
      await navigator.share({
        title: item.title,
        text: shareText
      });
    } catch (err) {}
  } else {
    navigator.clipboard.writeText(shareText);
    showToastNotice('Dettagli copiati negli appunti!');
  }
}

function createItemCard(item, isCompact) {
  const card = document.createElement('div');
  const catName = escapeHtml(item.category || 'Generale');
  const catColor = getCategoryColor(item.category || 'Generale');
  const dateInfo = getDateStatus(item.date);

  const statusClass = (item.set === 'Acquisti') ? dateInfo.colorClass : '';
  const compactClass = isCompact ? 'compact-purchased' : '';
  card.className = `item-card ${statusClass} ${compactClass}`;

  let checkHtml = '';
  if (item.set === 'Acquisti') {
    checkHtml = `
      <button type="button" class="check-btn ${item.purchased ? 'checked' : ''}" aria-label="${item.purchased ? 'Segna come da acquistare' : 'Segna come acquistato'}" title="${item.purchased ? 'Segna come da acquistare' : 'Segna come acquistato'}">
        <div class="custom-checkbox">
          <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
            <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>
          </svg>
        </div>
      </button>
    `;
  }

  let dateHtml = '';
  if (item.set === 'Acquisti') {
    if (dateInfo.badgeType === 'today') {
      dateHtml = `<span class="date-badge badge-today">OGGI</span>`;
    } else if (dateInfo.badgeType === 'yesterday') {
      dateHtml = `<span class="date-badge badge-yesterday">IERI</span>`;
    } else if (dateInfo.badgeType === 'countdown') {
      dateHtml = `<span class="date-badge badge-countdown">${dateInfo.badgeText}</span>`;
    } else if (dateInfo.badgeText) {
      dateHtml = `<span class="date-badge">${dateInfo.badgeText}</span>`;
    }
  }

  let mainValueHtml = '';
  if (item.set === 'Acquisti' || item.set === 'Liste') {
    if (item.number) {
      mainValueHtml = `<span class="item-num">#${escapeHtml(item.number)}</span>`;
    }
  } else if (item.set === 'Posseduti') {
    const numDisplay = item.number ? `<span class="item-num">#${escapeHtml(item.number)}</span>` : '';
    const gapDisplay = item.missingGapNotice ? `<span class="gap-badge" title="Volumi intermedi non ancora registrati">${escapeHtml(item.missingGapNotice)}</span>` : '';
    mainValueHtml = `${gapDisplay} ${numDisplay}`;
  } else if (item.set === 'Voti') {
    if (item.unplayed) {
      mainValueHtml = `
        <span class="unplayed-badge" title="Non ancora letto o giocato">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
            <path d="M6 2v6h.01L6 8.01 10 12l-4 4 .01.01H6V22h12v-5.99h-.01L18 16l-4-4 4-3.99-.01-.01H18V2H6zm10 14.5V20H8v-3.5l4-4 4 4zm-4-5l-4-4V4h8v3.5l-4 4z"/>
          </svg>
          Da iniziare
        </span>
      `;
    } else if (item.rating !== null && item.rating !== undefined) {
      mainValueHtml = `<span class="score-badge-100">${item.rating}/100</span>`;
    }
  }

  let nextVolHtml = '';
  if (item.set === 'Acquisti' && item.number && !isNaN(parseInt(item.number, 10)) && !item.completed) {
    nextVolHtml = `<button class="icon-btn next-btn" title="Crea volume successivo (+1)" aria-label="Crea volume successivo" type="button">+1</button>`;
  }

  const completedHtml = item.completed ? `<span class="completed-badge">Fine</span>` : '';

  card.innerHTML = `
    <div class="card-left-section">
      ${checkHtml}
      <div class="item-main-details">
        <div class="item-tags-row">
          <span class="item-tag-inline" style="color: ${catColor};">${catName}</span>
          ${completedHtml}
        </div>
        <span class="item-name">${escapeHtml(item.title)}</span>
      </div>
    </div>

    <div class="card-right-section">
      ${dateHtml}
      ${mainValueHtml}
      ${nextVolHtml}
      <div class="card-actions">
        <button class="icon-btn share-btn" title="Condividi" aria-label="Condividi dettagli" type="button">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
            <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92c0-1.61-1.31-2.92-2.92-2.92z"/>
          </svg>
        </button>
        <button class="icon-btn edit-btn" title="Modifica" aria-label="Modifica elemento" type="button">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
          </svg>
        </button>
        <button class="icon-btn delete-btn" title="Elimina" aria-label="Elimina elemento" type="button">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
        </button>
      </div>
    </div>
  `;

  card.addEventListener('click', (e) => {
    if (e.target.closest('.check-btn') || e.target.closest('.icon-btn')) return;
    if (item.set === 'Posseduti') {
      openOverviewModal(item);
    } else {
      openEditModal(item);
    }
  });

  if (item.set === 'Acquisti') {
    card.querySelector('.check-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const willBePurchased = !item.purchased;
      item.purchased = willBePurchased;
      saveData();
      syncItemToSupabase(item);

      if (willBePurchased) {
        syncPurchasedWithPosseduti(item);
      } else {
        rollbackPurchasedFromPosseduti(item);
      }

      renderList();
    });
  }

  const nextBtn = card.querySelector('.next-btn');
  if (nextBtn) {
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      createNextVolume(item);
    });
  }

  card.querySelector('.share-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    shareItemDetails(item);
  });

  card.querySelector('.edit-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openEditModal(item);
  });

  card.querySelector('.delete-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteItemWithUndo(item);
  });

  return card;
}

// Scanner ISBN
startScanBtn.addEventListener('click', () => {
  scannerContainer.style.display = 'block';
  scannerStatus.textContent = 'Avvio fotocamera in corso...';

  if (!html5QrCodeScanner) {
    html5QrCodeScanner = new Html5Qrcode('scannerReader');
  }

  html5QrCodeScanner.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: { width: 250, height: 150 } },
    async (decodedText) => {
      scannerStatus.textContent = `Trovato: ${decodedText}. Ricerca dati...`;
      stopScanner();
      await fetchBookDataByISBN(decodedText);
    },
    (errorMessage) => {}
  ).catch(err => {
    scannerStatus.textContent = 'Impossibile accedere alla fotocamera. Verifica i permessi.';
  });
});

function stopScanner() {
  if (html5QrCodeScanner) {
    html5QrCodeScanner.stop().catch(() => {}).then(() => {
      scannerContainer.style.display = 'none';
    });
  } else {
    scannerContainer.style.display = 'none';
  }
}

closeScannerBtn.addEventListener('click', stopScanner);

async function fetchBookDataByISBN(isbn) {
  try {
    const cleanIsbn = isbn.replace(/[^0-9X]/gi, '');
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${cleanIsbn}`);
    const data = await res.json();

    if (data.items && data.items.length > 0) {
      const volumeInfo = data.items[0].volumeInfo;
      let titleFound = volumeInfo.title || '';
      
      const numMatch = titleFound.match(/^(.*?)\s+#?(\d+)$/);
      if (numMatch) {
        itemTitle.value = numMatch[1];
        itemNumber.value = numMatch[2];
      } else {
        itemTitle.value = titleFound;
      }

      showToastNotice(`Riconosciuto: "${titleFound}"!`);
    } else {
      showToastNotice(`Nessun titolo trovato per ISBN ${isbn}`);
    }
  } catch (err) {
    showToastNotice('Errore nella ricerca online dell\'ISBN.');
  }
}

// Statistiche
openStatsBtn.addEventListener('click', () => {
  const allItems = appData.items;
  const ownedItems = allItems.filter(i => i.set === 'Posseduti');
  const scoredItems = allItems.filter(i => i.set === 'Voti' && !i.unplayed && i.rating !== null && i.rating !== undefined);
  const gapsCount = ownedItems.filter(i => Boolean(i.missingGapNotice)).length;

  statTotalItems.textContent = allItems.length;
  statTotalOwned.textContent = ownedItems.length;

  if (scoredItems.length > 0) {
    const avg = Math.round(scoredItems.reduce((acc, curr) => acc + curr.rating, 0) / scoredItems.length);
    statAverageRating.textContent = `${avg}/100`;
  } else {
    statAverageRating.textContent = '-';
  }

  if (ownedItems.length > 0) {
    const completeRate = Math.round(((ownedItems.length - gapsCount) / ownedItems.length) * 100);
    statCompleteRate.textContent = `${completeRate}%`;
  } else {
    statCompleteRate.textContent = '100%';
  }

  statsCatList.innerHTML = '';
  const catCounts = {};
  appData.categories.forEach(c => catCounts[c] = 0);
  ownedItems.forEach(i => {
    const c = i.category || 'Generale';
    catCounts[c] = (catCounts[c] || 0) + 1;
  });

  Object.entries(catCounts).forEach(([cat, count]) => {
    const row = document.createElement('div');
    row.className = 'stat-cat-row';
    row.innerHTML = `
      <span style="color: ${getCategoryColor(cat)}; font-weight: 600;">${escapeHtml(cat)}</span>
      <span style="font-weight: 700;">${count} vol.</span>
    `;
    statsCatList.appendChild(row);
  });

  statsModalBackdrop.classList.add('active');
});

closeStatsBtn.addEventListener('click', () => statsModalBackdrop.classList.remove('active'));
statsModalBackdrop.addEventListener('click', (e) => {
  if (e.target === statsModalBackdrop) statsModalBackdrop.classList.remove('active');
});

// Panoramica Posseduti
function openOverviewModal(item) {
  currentOverviewItemId = item.id;
  overviewTitleDisplay.textContent = item.title;
  overviewCategoryTag.textContent = item.category || 'Generale';
  overviewCategoryTag.style.color = getCategoryColor(item.category || 'Generale');

  overviewVolumeDisplay.textContent = item.number ? `#${item.number}` : 'N.D.';

  if (item.missingGapNotice) {
    overviewGapPill.style.display = 'flex';
    overviewGapDisplay.textContent = item.missingGapNotice;
  } else {
    overviewGapPill.style.display = 'none';
  }

  overviewReadingProgressInput.value = item.readingChapter || '';
  overviewCommentInput.value = item.privateComment || '';

  overviewModalBackdrop.classList.add('active');
}

function closeOverviewModal() {
  overviewModalBackdrop.classList.remove('active');
  currentOverviewItemId = null;
}

closeOverviewBtn.addEventListener('click', closeOverviewModal);

overviewModalBackdrop.addEventListener('click', (e) => {
  if (e.target === overviewModalBackdrop) closeOverviewModal();
});

saveOverviewDetailsBtn.addEventListener('click', () => {
  if (!currentOverviewItemId) return;
  const item = appData.items.find(i => i.id === currentOverviewItemId);
  if (item) {
    item.readingChapter = overviewReadingProgressInput.value.trim();
    item.privateComment = overviewCommentInput.value.trim();
    saveData();
    syncItemToSupabase(item);
    closeOverviewModal();
    showToastNotice(`Panoramica di "${item.title}" salvata!`);
  }
});

overviewEditFullBtn.addEventListener('click', () => {
  if (!currentOverviewItemId) return;
  const item = appData.items.find(i => i.id === currentOverviewItemId);
  if (item) {
    closeOverviewModal();
    openEditModal(item);
  }
});

function deleteItemWithUndo(item) {
  deletedItemBuffer = { ...item };
  appData.items = appData.items.filter(i => i.id !== item.id);
  saveData();
  deleteItemFromSupabase(item.id);
  renderList();

  undoBtn.style.display = 'inline-block';
  undoToastMsg.textContent = `"${item.title}" eliminato`;
  undoToast.classList.add('show');

  if (undoTimeoutId) clearTimeout(undoTimeoutId);
  undoTimeoutId = setTimeout(() => {
    undoToast.classList.remove('show');
    deletedItemBuffer = null;
  }, 5000);
}

undoBtn.addEventListener('click', () => {
  if (deletedItemBuffer) {
    appData.items.unshift(deletedItemBuffer);
    saveData();
    syncItemToSupabase(deletedItemBuffer);
    renderList();
    deletedItemBuffer = null;
    undoToast.classList.remove('show');
    if (undoTimeoutId) clearTimeout(undoTimeoutId);
  }
});

function createNextVolume(item) {
  const currentNum = parseInt(item.number, 10);
  const nextNum = isNaN(currentNum) ? '' : String(currentNum + 1);

  const newItem = {
    id: generateUniqueId(),
    title: item.title,
    set: 'Acquisti',
    category: item.category || 'Generale',
    date: null,
    number: nextNum,
    rating: null,
    unplayed: false,
    purchased: false,
    completed: false,
    missingGapNotice: null,
    readingChapter: '',
    privateComment: ''
  };

  appData.items.unshift(newItem);
  saveData();
  syncItemToSupabase(newItem);
  renderList();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function populateFormCategories() {
  categorySelect.innerHTML = '';
  appData.categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    categorySelect.appendChild(opt);
  });
}

function updateAutoCompletionList() {
  const uniqueTitles = [...new Set(appData.items.map(i => i.title))];
  existingTitlesList.innerHTML = '';
  uniqueTitles.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    existingTitlesList.appendChild(opt);
  });
}

function adjustModalFields(set) {
  purchasesFields.style.display = (set === 'Acquisti' || set === 'Posseduti' || set === 'Liste') ? 'flex' : 'none';
  dateGroupWrapper.style.display = (set === 'Acquisti') ? 'flex' : 'none';
  completedGroupWrapper.style.display = (set === 'Acquisti' || set === 'Posseduti') ? 'block' : 'none';
  ratingInputGroup.style.display = (set === 'Voti') ? 'block' : 'none';
}

targetSet.addEventListener('change', (e) => {
  adjustModalFields(e.target.value);
});

itemUnplayedCheckbox.addEventListener('change', (e) => {
  if (e.target.checked) {
    itemScoreInput.value = '';
    itemScoreInput.disabled = true;
    itemScoreInput.placeholder = 'Non applicabile (Da iniziare)';
  } else {
    itemScoreInput.disabled = false;
    itemScoreInput.placeholder = 'es. 85';
  }
});

itemTitle.addEventListener('input', (e) => {
  const val = e.target.value;

  const matched = appData.items.find(i => i.title.toLowerCase() === val.trim().toLowerCase());
  if (matched && matched.category) {
    categorySelect.value = matched.category;
  }

  const numberMatch = val.match(/^(.*?)\s+#?(\d+)$/);
  if (numberMatch && (targetSet.value === 'Acquisti' || targetSet.value === 'Posseduti' || targetSet.value === 'Liste') && !itemNumber.value) {
    itemNumber.value = numberMatch[2];
  }
});

function openCreateModal() {
  openCreateModalWithTitle('');
}

function openCreateModalWithTitle(initialTitle) {
  modalTitle.textContent = 'Nuovo Elemento';
  editItemId.value = '';
  itemForm.reset();
  stopScanner();
  itemScoreInput.disabled = false;
  itemScoreInput.placeholder = 'es. 85';

  populateFormCategories();
  updateAutoCompletionList();

  newCategoryGroup.style.display = 'flex';
  targetSet.value = activeSet;
  adjustModalFields(activeSet);
  categorySelect.value = (activeCategory !== 'Tutte') ? activeCategory : 'Generale';

  if (initialTitle) {
    itemTitle.value = initialTitle;
  }

  modalBackdrop.classList.add('active');
  itemTitle.focus();
}

function openEditModal(item) {
  modalTitle.textContent = 'Modifica Elemento';
  editItemId.value = item.id;
  stopScanner();
  populateFormCategories();
  updateAutoCompletionList();

  newCategoryGroup.style.display = 'none';
  newCategoryInput.value = '';

  itemTitle.value = item.title;
  targetSet.value = item.set;
  adjustModalFields(item.set);

  itemDate.value = item.date || '';
  itemNumber.value = item.number || '';
  itemCompletedCheckbox.checked = Boolean(item.completed);

  itemUnplayedCheckbox.checked = Boolean(item.unplayed);
  if (item.unplayed) {
    itemScoreInput.value = '';
    itemScoreInput.disabled = true;
    itemScoreInput.placeholder = 'Non applicabile (Da iniziare)';
  } else {
    itemScoreInput.disabled = false;
    itemScoreInput.value = (item.rating !== null && item.rating !== undefined) ? item.rating : '';
    itemScoreInput.placeholder = 'es. 85';
  }

  categorySelect.value = item.category || 'Generale';
  modalBackdrop.classList.add('active');
}

function closeModal() {
  stopScanner();
  modalBackdrop.classList.remove('active');
  itemForm.reset();
  editItemId.value = '';
}

openModalBtn.addEventListener('click', openCreateModal);
closeModalBtn.addEventListener('click', closeModal);
cancelBtn.addEventListener('click', closeModal);

modalBackdrop.addEventListener('click', (e) => {
  if (e.target === modalBackdrop) closeModal();
});

itemForm.addEventListener('submit', (e) => {
  e.preventDefault();

  const idToEdit = editItemId.value;
  let title = itemTitle.value.trim();
  const set = targetSet.value;
  const typedCat = newCategoryInput.value.trim();
  let category = categorySelect.value;

  const numInTitleMatch = title.match(/^(.*?)\s+#?(\d+)$/);
  if (numInTitleMatch && itemNumber.value === numInTitleMatch[2] && (set === 'Acquisti' || set === 'Posseduti' || set === 'Liste')) {
    title = numInTitleMatch[1];
  }

  if (!idToEdit && typedCat) {
    category = typedCat;
    if (!appData.categories.includes(category)) {
      appData.categories.push(category);
      syncCategoriesToSupabase();
    }
  }

  if (!category) category = 'Generale';

  const date = (set === 'Acquisti') ? (itemDate.value || null) : null;
  const number = (set === 'Acquisti' || set === 'Posseduti' || set === 'Liste') ? (itemNumber.value.trim() || null) : null;
  const completed = (set === 'Acquisti' || set === 'Posseduti') ? itemCompletedCheckbox.checked : false;

  let rating = null;
  let unplayed = false;

  if (set === 'Voti') {
    unplayed = itemUnplayedCheckbox.checked;
    if (!unplayed && itemScoreInput.value !== '') {
      let scoreNum = parseInt(itemScoreInput.value, 10);
      if (isNaN(scoreNum)) scoreNum = 0;
      if (scoreNum < 0) scoreNum = 0;
      if (scoreNum > 100) scoreNum = 100;
      rating = scoreNum;
    }
  }

  let finalItem = null;

  if (idToEdit) {
    const existing = appData.items.find(i => i.id == idToEdit);
    if (existing) {
      existing.title = title;
      existing.set = set;
      existing.category = category;
      existing.date = date;
      existing.number = number;
      existing.completed = completed;
      existing.rating = rating;
      existing.unplayed = unplayed;
      finalItem = existing;
    }
  } else {
    finalItem = {
      id: generateUniqueId(),
      title,
      set,
      category,
      date,
      number,
      completed,
      rating,
      unplayed,
      purchased: false,
      missingGapNotice: null,
      readingChapter: '',
      privateComment: ''
    };
    appData.items.unshift(finalItem);
  }

  saveData();
  if (finalItem) syncItemToSupabase(finalItem);
  closeModal();
  updateCategoryDropdown();

  if (activeSet !== set) {
    activeSet = set;
    localStorage.setItem('pref_set', activeSet);
    document.querySelectorAll('.segment-btn').forEach(b => {
      const isSelected = b.dataset.set === set;
      b.classList.toggle('active', isSelected);
      b.setAttribute('aria-selected', String(isSelected));
    });
    updateFilterBarChips();
  }

  renderList();
});

// Scorciatoie tastiera
window.addEventListener('keydown', (e) => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    if (e.key === 'Escape') {
      document.activeElement.blur();
      closeModal();
      closeOverviewModal();
      closeSettingsModal();
      statsModalBackdrop.classList.remove('active');
    }
    return;
  }

  if (e.key === 'n' || e.key === 'N') {
    e.preventDefault();
    openCreateModal();
  } else if (e.key === '/') {
    e.preventDefault();
    seriesSearchInput.focus();
  } else if (e.key === 'Escape') {
    closeModal();
    closeOverviewModal();
    closeSettingsModal();
    statsModalBackdrop.classList.remove('active');
  }
});

// Impostazioni
function showSettingsView(viewName) {
  settingsMainView.style.display = (viewName === 'main') ? 'block' : 'none';
  settingsAccountView.style.display = (viewName === 'account') ? 'block' : 'none';
  settingsCategoriesView.style.display = (viewName === 'categories') ? 'block' : 'none';
  settingsExportView.style.display = (viewName === 'export') ? 'block' : 'none';
  settingsImportView.style.display = (viewName === 'import') ? 'block' : 'none';
  settingsResetView.style.display = (viewName === 'reset') ? 'block' : 'none';

  if (viewName === 'main') {
    settingsTitle.textContent = 'Impostazioni';
    settingsBackBtn.style.display = 'none';
  } else if (viewName === 'account') {
    settingsTitle.textContent = 'Account Supabase';
    settingsBackBtn.style.display = 'flex';
  } else if (viewName === 'categories') {
    settingsTitle.textContent = 'Gestione Categorie';
    settingsBackBtn.style.display = 'flex';
    renderManageCategoriesList();
  } else if (viewName === 'export') {
    settingsTitle.textContent = 'Esporta Backup JSON';
    settingsBackBtn.style.display = 'flex';
  } else if (viewName === 'import') {
    settingsTitle.textContent = 'Importa Backup JSON';
    settingsBackBtn.style.display = 'flex';
  } else if (viewName === 'reset') {
    settingsTitle.textContent = 'Ripristino di Fabbrica';
    settingsBackBtn.style.display = 'flex';
  }
}

function openSettingsModal() {
  showSettingsView('main');
  settingsModalBackdrop.classList.add('active');
}

function closeSettingsModal() {
  settingsModalBackdrop.classList.remove('active');
}

openSettingsBtn.addEventListener('click', openSettingsModal);
closeSettingsBtn.addEventListener('click', closeSettingsModal);
settingsBackBtn.addEventListener('click', () => showSettingsView('main'));

goToAccountBtn.addEventListener('click', () => showSettingsView('account'));
goToCategoriesBtn.addEventListener('click', () => showSettingsView('categories'));
goToExportBtn.addEventListener('click', () => showSettingsView('export'));
goToImportBtn.addEventListener('click', () => showSettingsView('import'));
goToResetBtn.addEventListener('click', () => showSettingsView('reset'));

settingsModalBackdrop.addEventListener('click', (e) => {
  if (e.target === settingsModalBackdrop) closeSettingsModal();
});

// CRUD Categorie
function renderManageCategoriesList() {
  manageCatList.innerHTML = '';

  appData.categories.forEach(cat => {
    const li = document.createElement('li');
    li.className = 'manage-cat-item';
    const color = getCategoryColor(cat);

    li.innerHTML = `
      <div class="cat-item-left">
        <span class="cat-color-dot" style="background-color: ${color};"></span>
        <span class="cat-name-display">${escapeHtml(cat)}</span>
      </div>
      <div class="cat-actions">
        <button class="icon-btn edit-cat-btn" title="Rinomina" aria-label="Rinomina categoria ${escapeHtml(cat)}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
          </svg>
        </button>
        ${cat !== 'Generale' ? `
        <button class="icon-btn delete-cat-btn" title="Elimina" aria-label="Elimina categoria ${escapeHtml(cat)}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
        </button>` : ''}
      </div>
    `;

    li.querySelector('.edit-cat-btn').addEventListener('click', () => {
      const newName = prompt(`Rinomina la categoria "${cat}" in:`, cat);
      if (newName && newName.trim() && newName.trim() !== cat) {
        const cleanName = newName.trim();
        const idx = appData.categories.indexOf(cat);
        if (idx !== -1) appData.categories[idx] = cleanName;
        appData.items.forEach(i => {
          if (i.category === cat) {
            i.category = cleanName;
            syncItemToSupabase(i);
          }
        });
        if (activeCategory === cat) activeCategory = cleanName;

        saveData();
        syncCategoriesToSupabase();
        updateCategoryDropdown();
        renderManageCategoriesList();
        renderList();
      }
    });

    const delBtn = li.querySelector('.delete-cat-btn');
    if (delBtn) {
      delBtn.addEventListener('click', () => {
        if (confirm(`Eliminare la categoria "${cat}"? I volumi associati torneranno a "Generale".`)) {
          appData.categories = appData.categories.filter(c => c !== cat);
          appData.items.forEach(i => {
            if (i.category === cat) {
              i.category = 'Generale';
              syncItemToSupabase(i);
            }
          });
          if (activeCategory === cat) activeCategory = 'Generale';

          saveData();
          syncCategoriesToSupabase();
          updateCategoryDropdown();
          renderManageCategoriesList();
          renderList();
        }
      });
    }

    manageCatList.appendChild(li);
  });
}

addCatManageBtn.addEventListener('click', () => {
  const newName = newCatManageInput.value.trim();
  if (!newName) return;

  if (appData.categories.includes(newName)) {
    alert('Questa categoria esiste già.');
    return;
  }

  appData.categories.push(newName);
  newCatManageInput.value = '';
  saveData();
  syncCategoriesToSupabase();
  updateCategoryDropdown();
  renderManageCategoriesList();
  renderList();
});

// Esporta JSON
confirmExportBtn.addEventListener('click', () => {
  const selectedSets = [];
  if (exportAcquisti.checked) selectedSets.push('Acquisti');
  if (exportPosseduti.checked) selectedSets.push('Posseduti');
  if (exportVoti.checked) selectedSets.push('Voti');
  if (exportListe.checked) selectedSets.push('Liste');

  if (selectedSets.length === 0) {
    alert('Seleziona almeno un insieme da esportare.');
    return;
  }

  const exportedItems = appData.items
    .filter(item => selectedSets.includes(item.set))
    .map(item => ({
      id: item.id,
      title: item.title,
      targetSet: item.set,
      category: item.category || 'Generale',
      date: item.date || null,
      number: item.number || null,
      completed: Boolean(item.completed),
      rating: item.rating !== undefined ? item.rating : null,
      unplayed: Boolean(item.unplayed),
      purchased: Boolean(item.purchased),
      missingGapNotice: item.missingGapNotice || null,
      readingChapter: item.readingChapter || '',
      privateComment: item.privateComment || ''
    }));

  const exportPayload = {
    appVersion: '3.9',
    exportedAt: new Date().toISOString(),
    exportedBySet: selectedSets,
    categoriesList: appData.categories,
    itemsCount: exportedItems.length,
    items: exportedItems
  };

  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportPayload, null, 2));
  const downloadAnchor = document.createElement('a');
  const now = new Date();
  const dateFormatted = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  
  downloadAnchor.setAttribute('href', dataStr);
  downloadAnchor.setAttribute('download', `collezione_${selectedSets.join('_').toLowerCase()}_${dateFormatted}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();

  closeSettingsModal();
});

// Importa JSON
triggerImportBtn.addEventListener('click', () => {
  importJsonFileInput.click();
});

importJsonFileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const importedData = JSON.parse(event.target.result);

      if (!importedData || !Array.isArray(importedData.items)) {
        alert('Formato file non valido: proprietà "items" mancante.');
        return;
      }

      let importedCount = 0;

      if (Array.isArray(importedData.categoriesList)) {
        importedData.categoriesList.forEach(cat => {
          if (!appData.categories.includes(cat)) {
            appData.categories.push(cat);
          }
        });
        syncCategoriesToSupabase();
      }

      importedData.items.forEach(incoming => {
        if (!incoming.title) return;

        const target = incoming.targetSet || incoming.set || 'Acquisti';
        const category = incoming.category || 'Generale';

        if (!appData.categories.includes(category)) {
          appData.categories.push(category);
        }

        const exists = appData.items.some(existing => 
          existing.title.toLowerCase() === incoming.title.toLowerCase() &&
          existing.set === target &&
          existing.number === (incoming.number || null)
        );

        if (!exists) {
          let incomingRating = incoming.rating;
          if (incomingRating !== null && incomingRating !== undefined && incomingRating <= 5) {
            incomingRating = incomingRating * 20;
          }

          const newItem = {
            id: incoming.id || generateUniqueId(),
            title: incoming.title,
            set: target,
            category: category,
            date: incoming.date || null,
            number: incoming.number || null,
            completed: Boolean(incoming.completed),
            rating: incomingRating !== undefined ? incomingRating : null,
            unplayed: Boolean(incoming.unplayed),
            purchased: Boolean(incoming.purchased),
            missingGapNotice: incoming.missingGapNotice || null,
            readingChapter: incoming.readingChapter || '',
            privateComment: incoming.privateComment || ''
          };

          appData.items.unshift(newItem);
          syncItemToSupabase(newItem);
          importedCount++;
        }
      });

      saveData();
      updateCategoryDropdown();
      renderList();
      closeSettingsModal();
      importJsonFileInput.value = '';

      alert(`Importazione completata con successo! Aggiunti ${importedCount} nuovi elementi.`);
    } catch (err) {
      alert('Errore durante la lettura del file JSON: file corrotto o non leggibile.');
    }
  };

  reader.readAsText(file);
});

// Ripristino di fabbrica
cancelResetBtn.addEventListener('click', () => {
  showSettingsView('main');
});

confirmFactoryResetBtn.addEventListener('click', async () => {
  localStorage.clear();
  appData = JSON.parse(JSON.stringify(DEFAULT_DATA));
  saveData();

  if (supabaseClient && currentUser) {
    try {
      await supabaseClient.from('items').delete().neq('id', 0);
      await supabaseClient.from('categories').delete().neq('id', '');
    } catch (e) {
      console.error('Errore durante il reset su Supabase:', e);
    }
  }

  activeSet = 'Acquisti';
  activeCategory = 'Generale';
  activeTimeFilter = 'all';
  currentSortMode = 'date';
  searchSeriesQuery = '';

  closeSettingsModal();
  initApp();
  alert('Dati ripristinati allo stato iniziale sia in locale che su Supabase.');
});

function initApp() {
  document.querySelectorAll('.segment-btn').forEach(b => {
    const isSelected = b.dataset.set === activeSet;
    b.classList.toggle('active', isSelected);
    b.setAttribute('aria-selected', String(isSelected));
  });

  updateFilterBarChips();
  sortIndicatorText.textContent = SORT_LABELS[currentSortMode] || 'Per Data';

  if (isPurchasedSectionOpen) {
    purchasedList.classList.add('open');
    chevronIcon.classList.add('open');
    togglePurchasedBtn.setAttribute('aria-expanded', 'true');
  }

  updateCategoryDropdown();
  renderList();
}

// Avvio applicazione con controllo autenticazione
initApp();
initAuthAndApp();