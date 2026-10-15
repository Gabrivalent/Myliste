// js/main.js

// Registrazione PWA Service Worker
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
  anonKey: 'sb_publishable_PodV98vtRyuW329msfQKrA_goxv6C_c'
};

let supabaseClient = null;
let realtimeChannel = null;
let currentUser = null;

// Elementi Auth & Overlay
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

// 1. Generatore ID che non sfora il limite di int4 (max 2 miliardi)
function generateUniqueId() {
  // Genera un intero a 31 bit positivo (massimo 2.147.483.647)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return (arr[0] & 0x7FFFFFFF) % 2000000000;
  }
  return Math.floor(Math.random() * 1900000000) + 1;
}

// 2. syncItemToSupabase senza forzatura di ID fittizi se non serve
async function syncItemToSupabase(item) {
  if (!supabaseClient || !currentUser) return;

  try {
    // NOTA CRITICA: non includere user_id o is_read (causano errore PGRST204 / 400)
    const payload = {
      title: item.title,
      set_type: item.set,
      category: item.category || 'Generale',
      date: item.date || null,
      number: item.number ? String(item.number) : null,
      rating: (item.rating !== null && item.rating !== undefined && !isNaN(item.rating)) ? Number(item.rating) : null,
      unplayed: Boolean(item.unplayed),
      purchased: Boolean(item.purchased),
      completed: Boolean(item.completed),
      missing_gap_notice: item.missingGapNotice || null,
      reading_chapter: item.readingChapter || null,
      private_comment: item.privateComment || ''
    };

    const numericId = parseInt(item.id, 10);
    if (!isNaN(numericId) && numericId > 0 && numericId <= 2147483647) {
      payload.id = numericId;
    }

    const { data, error } = await supabaseClient
      .from('items')
      .upsert(payload)
      .select();

    if (error) throw error;

    if (data && data[0] && data[0].id) {
      item.id = Number(data[0].id);
      saveData();
    }

    setCloudStatus('online');
  } catch (err) {
    console.error(`Errore sync item #${item.id}:`, err);
    setCloudStatus('error');
  }
}
// 3. syncBatchItemsToSupabase compatibile con int4
async function syncBatchItemsToSupabase(itemsArray) {
  if (!supabaseClient || !currentUser || itemsArray.length === 0) return;

  try {
    const payload = itemsArray.map(item => {
      const obj = {
        title: item.title,
        set_type: item.set,
        category: item.category || 'Generale',
        date: item.date || null,
        number: item.number ? String(item.number) : null,
        rating: (item.rating !== null && item.rating !== undefined && !isNaN(item.rating)) ? Number(item.rating) : null,
        unplayed: Boolean(item.unplayed),
        purchased: Boolean(item.purchased),
        completed: Boolean(item.completed),
        missing_gap_notice: item.missingGapNotice || null,
        reading_chapter: item.readingChapter || null,
        private_comment: item.privateComment || ''
      };

      const numericId = parseInt(item.id, 10);
      if (!isNaN(numericId) && numericId > 0 && numericId <= 2147483647) {
        obj.id = numericId;
      }
      return obj;
    });

    const { error } = await supabaseClient.from('items').upsert(payload);
    if (error) throw error;
    setCloudStatus('online');
  } catch (err) {
    console.error('Errore sync batch items:', err);
    setCloudStatus('error');
  }
}
// ----------------------------------------------------
// INIZIALIZZAZIONE & GESTIONE SESSIONE (AUTH)
// ----------------------------------------------------
async function initAuthAndApp() {
  if (!window.supabase) {
    alert('Libreria Supabase non caricata. Verifica la connessione internet.');
    return;
  }

  try {
    supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);

    supabaseClient.auth.onAuthStateChange((event, session) => {
      if (session && session.user) {
        handleAuthenticatedState(session.user);
      } else {
        handleUnauthenticatedState();
      }
    });

    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;

    if (data && data.session && data.session.user) {
      handleAuthenticatedState(data.session.user);
    } else {
      handleUnauthenticatedState();
    }
  } catch (err) {
    console.error("Errore inizializzazione Supabase Auth:", err);
    handleUnauthenticatedState();
  }
}

function handleAuthenticatedState(user) {
  currentUser = user;
  if (authOverlay) authOverlay.style.display = 'none';
  if (appContent) appContent.style.display = 'flex';
  if (openModalBtn) openModalBtn.style.display = 'flex';

  if (accountUserEmail) accountUserEmail.textContent = user.email;
  if (currentAccountDisplay) currentAccountDisplay.textContent = user.email;

  fetchDataFromSupabase();
  setupRealtimeSubscriptions();
  checkAndTriggerTodayNotifications();
}

function handleUnauthenticatedState() {
  currentUser = null;
  if (authOverlay) authOverlay.style.display = 'flex';
  if (appContent) appContent.style.display = 'none';
  if (openModalBtn) openModalBtn.style.display = 'none';
  setCloudStatus('offline');

  if (realtimeChannel && supabaseClient) {
    supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = loginEmail.value.trim();
    const password = loginPassword.value;

    loginSubmitBtn.disabled = true;
    loginSubmitBtn.textContent = 'Verifica in corso...';
    if (authErrorMsg) {
      authErrorMsg.style.display = 'none';
      authErrorMsg.textContent = '';
    }

    try {
      if (!supabaseClient) {
        supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
      }

      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: email,
        password: password
      });

      if (error) throw error;

      loginForm.reset();
      handleAuthenticatedState(data.user);
    } catch (err) {
      console.error("Errore durante il login:", err);
      if (authErrorMsg) {
        authErrorMsg.textContent = err.message || 'Credenziali non valide o errore di connessione.';
        authErrorMsg.style.display = 'block';
      }
    } finally {
      loginSubmitBtn.disabled = false;
      loginSubmitBtn.textContent = 'Accedi';
    }
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    if (confirm('Vuoi davvero disconnettere questo account?')) {
      closeSettingsModal();
      await supabaseClient.auth.signOut();
    }
  });
}

// ----------------------------------------------------
// REALTIME & DATI SUPABASE (SENZA user_id NEL PAYLOAD)
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
    isRead: Boolean(row.is_read),
    isVariant: Boolean(row.is_variant || (row.number && String(row.number).toLowerCase().includes('variant'))),
    missingGapNotice: row.missing_gap_notice,
    readingChapter: row.reading_chapter || '',
    privateComment: row.private_comment || '',
    createdAt: row.created_at || new Date().toISOString()
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
// STATO APPLICAZIONE LOCALE & SISTEMA UNDO / REDO
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
  if (typeof item.isRead === 'undefined') item.isRead = false;
  if (typeof item.isVariant === 'undefined') {
    item.isVariant = Boolean(item.number && String(item.number).toLowerCase().includes('variant'));
  }
  if (typeof item.readingChapter === 'undefined') item.readingChapter = '';
  if (typeof item.privateComment === 'undefined') item.privateComment = '';
  if (item.rating && item.rating <= 5) item.rating = item.rating * 20;
  if (!item.createdAt) item.createdAt = new Date().toISOString();
});

let activeSet = localStorage.getItem('pref_set') || 'Acquisti';
let activeCategory = localStorage.getItem('pref_category') || 'Generale';
let activeTimeFilter = localStorage.getItem('pref_time_filter') || 'all';

let setSortModes = JSON.parse(localStorage.getItem('pref_set_sort_modes')) || {
  Acquisti: 'date',
  Posseduti: 'name',
  Voti: 'number',
  Liste: 'name'
};

function getCurrentSortMode() {
  return setSortModes[activeSet] || 'date';
}

function setCurrentSortMode(mode) {
  setSortModes[activeSet] = mode;
  localStorage.setItem('pref_set_sort_modes', JSON.stringify(setSortModes));
}

let isPurchasedSectionOpen = localStorage.getItem('pref_purchased_open') === 'true';
let notificationsEnabled = localStorage.getItem('pref_notifications') === 'true';

let searchSeriesQuery = '';
let deletedItemBuffer = null;
let undoTimeoutId = null;
let currentOverviewItemId = null;

let html5QrCodeScanner = null;
let checkerScanner = null;
let lastDetectedCheckItem = null;

const historyUndoStack = [];
const historyRedoStack = [];
const MAX_HISTORY_STEPS = 35;

function pushHistoryAction(action) {
  historyUndoStack.push(action);
  if (historyUndoStack.length > MAX_HISTORY_STEPS) {
    historyUndoStack.shift();
  }
  historyRedoStack.length = 0;
  updateHistoryButtonsUI();
}

function updateHistoryButtonsUI() {
  const undoBtnElem = document.getElementById('historyUndoBtn');
  const redoBtnElem = document.getElementById('historyRedoBtn');
  if (undoBtnElem) undoBtnElem.disabled = historyUndoStack.length === 0;
  if (redoBtnElem) redoBtnElem.disabled = historyRedoStack.length === 0;
}

async function executeUndo() {
  if (historyUndoStack.length === 0) return;
  const action = historyUndoStack.pop();

  if (action.type === 'INSERT') {
    const ids = Array.isArray(action.data) ? action.data.map(i => i.id) : [action.data.id];
    appData.items = appData.items.filter(i => !ids.includes(i.id));
    saveData();
    for (const id of ids) {
      await deleteItemFromSupabase(id);
    }
    showToastNotice('Creazione annullata');
  } else if (action.type === 'DELETE') {
    appData.items.unshift(action.data);
    saveData();
    await syncItemToSupabase(action.data);
    showToastNotice(`Ripristinato "${action.data.title}"`);
  } else if (action.type === 'UPDATE') {
    const idx = appData.items.findIndex(i => i.id === action.prev.id);
    if (idx !== -1) {
      appData.items[idx] = { ...action.prev };
      saveData();
      await syncItemToSupabase(appData.items[idx]);
      showToastNotice(`Modifica annullata per "${action.prev.title}"`);
    }
  }

  historyRedoStack.push(action);
  updateHistoryButtonsUI();
  renderList();
}

async function executeRedo() {
  if (historyRedoStack.length === 0) return;
  const action = historyRedoStack.pop();

  if (action.type === 'INSERT') {
    const items = Array.isArray(action.data) ? action.data : [action.data];
    items.forEach(it => appData.items.unshift(it));
    saveData();
    if (Array.isArray(action.data)) {
      await syncBatchItemsToSupabase(items);
    } else {
      await syncItemToSupabase(items[0]);
    }
    showToastNotice('Creazione riapplicata');
  } else if (action.type === 'DELETE') {
    appData.items = appData.items.filter(i => i.id !== action.data.id);
    saveData();
    await deleteItemFromSupabase(action.data.id);
    showToastNotice(`Eliminato "${action.data.title}"`);
  } else if (action.type === 'UPDATE') {
    const idx = appData.items.findIndex(i => i.id === action.next.id);
    if (idx !== -1) {
      appData.items[idx] = { ...action.next };
      saveData();
      await syncItemToSupabase(appData.items[idx]);
      showToastNotice(`Modifica ripristinata per "${action.next.title}"`);
    }
  }

  historyUndoStack.push(action);
  updateHistoryButtonsUI();
  renderList();
}

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

// Giroscopio per riflesso foil su smartphone
if (window.DeviceOrientationEvent) {
  window.addEventListener('deviceorientation', (event) => {
    if (event.gamma !== null) {
      const angle = Math.round(135 + (event.gamma * 1.5));
      document.documentElement.style.setProperty('--foil-angle', `${angle}deg`);
    }
  }, { passive: true });
}

// ----------------------------------------------------
// SINCRONIZZAZIONE AUTOMATICA POSSEDUTI -> VOTI
// ----------------------------------------------------
async function ensureItemInVoti(title, category) {
  const titleClean = title.trim().toLowerCase();
  const catClean = (category || 'Generale').trim().toLowerCase();

  const existsInVoti = appData.items.some(
    i => i.set === 'Voti' &&
         i.title.trim().toLowerCase() === titleClean &&
         (i.category || 'Generale').trim().toLowerCase() === catClean
  );

  if (!existsInVoti) {
    const votiItem = {
      id: generateUniqueId(),
      title: title.trim(),
      set: 'Voti',
      category: category || 'Generale',
      date: null,
      number: null,
      rating: null,
      unplayed: true,
      purchased: false,
      completed: false,
      isRead: false,
      isVariant: false,
      missingGapNotice: null,
      readingChapter: '',
      privateComment: '',
      createdAt: new Date().toISOString()
    };
    appData.items.unshift(votiItem);
    saveData();
    await syncItemToSupabase(votiItem);
  }
}

// ----------------------------------------------------
// CALCOLO BUCHI NUMERICI DI UNA COLLANA
// ----------------------------------------------------
function calculateMissingGaps(volumesArray) {
  const nums = volumesArray
    .filter(v => !v.isVariant)
    .map(v => parseInt(v.number, 10))
    .filter(n => !isNaN(n) && n > 0);

  if (nums.length < 2) return [];

  nums.sort((a, b) => a - b);
  const min = nums[0];
  const max = nums[nums.length - 1];
  const presentSet = new Set(nums);
  const missing = [];

  for (let i = min; i <= max; i++) {
    if (!presentSet.has(i)) {
      missing.push(i);
    }
  }
  return missing;
}

// Elementi DOM Principali
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

const historyUndoBtn = document.getElementById('historyUndoBtn');
const historyRedoBtn = document.getElementById('historyRedoBtn');

if (historyUndoBtn) historyUndoBtn.addEventListener('click', executeUndo);
if (historyRedoBtn) historyRedoBtn.addEventListener('click', executeRedo);

const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
const twitchSidebar = document.getElementById('twitchSidebar');

if (toggleSidebarBtn && twitchSidebar) {
  toggleSidebarBtn.addEventListener('click', () => {
    twitchSidebar.classList.toggle('collapsed');
  });
}

// Modale Manga Spine Shelf 3D
const shelfModalBackdrop = document.getElementById('shelfModalBackdrop');
const closeShelfModalBtn = document.getElementById('closeShelfModalBtn');
const shelfSeriesTitle = document.getElementById('shelfSeriesTitle');
const shelfCategoryTag = document.getElementById('shelfCategoryTag');
const shelfSpineContainer = document.getElementById('shelfSpineContainer');

// Modale Form Singolo
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
const itemVariantCheckbox = document.getElementById('itemVariantCheckbox');
const completedGroupWrapper = document.getElementById('completedGroupWrapper');
const itemCompletedCheckbox = document.getElementById('itemCompletedCheckbox');
const itemReadCheckbox = document.getElementById('itemReadCheckbox');
const ratingInputGroup = document.getElementById('ratingInputGroup');
const itemScoreInput = document.getElementById('itemScoreInput');
const itemUnplayedCheckbox = document.getElementById('itemUnplayedCheckbox');

const categorySelect = document.getElementById('categorySelect');
const newCategoryGroup = document.getElementById('newCategoryGroup');
const newCategoryInput = document.getElementById('newCategoryInput');
const existingTitlesList = document.getElementById('existingTitlesList');

// Modale Form Batch
const openBatchModalBtn = document.getElementById('openBatchModalBtn');
const openBatchTopBtn = document.getElementById('openBatchTopBtn');
const batchModalBackdrop = document.getElementById('batchModalBackdrop');
const closeBatchModalBtn = document.getElementById('closeBatchModalBtn');
const cancelBatchBtn = document.getElementById('cancelBatchBtn');
const batchItemForm = document.getElementById('batchItemForm');
const batchTitle = document.getElementById('batchTitle');
const batchStartVol = document.getElementById('batchStartVol');
const batchEndVol = document.getElementById('batchEndVol');
const batchTargetSet = document.getElementById('batchTargetSet');
const batchCategorySelect = document.getElementById('batchCategorySelect');
const existingTitlesListBatch = document.getElementById('existingTitlesListBatch');

// Modale Verifica Barcode
const openCheckerScanBtn = document.getElementById('openCheckerScanBtn');
const openCheckerTopBtn = document.getElementById('openCheckerTopBtn');
const checkerModalBackdrop = document.getElementById('checkerModalBackdrop');
const closeCheckerModalBtn = document.getElementById('closeCheckerModalBtn');
const checkerResultBox = document.getElementById('checkerResultBox');
const checkerSignalIcon = document.getElementById('checkerSignalIcon');
const checkerStatusTitle = document.getElementById('checkerStatusTitle');
const checkerStatusDesc = document.getElementById('checkerStatusDesc');
const checkerResetBtn = document.getElementById('checkerResetBtn');
const checkerAddToAcquistiBtn = document.getElementById('checkerAddToAcquistiBtn');
const checkerAddToPossedutiBtn = document.getElementById('checkerAddToPossedutiBtn');

// Scanner ISBN nel Form
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
  let mode = getCurrentSortMode();
  if (mode === 'date') mode = 'name';
  else if (mode === 'name') mode = 'number';
  else mode = 'date';

  setCurrentSortMode(mode);
  sortIndicatorText.textContent = SORT_LABELS[mode];
  renderList();
});

setTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-item-btn') || e.target.closest('.segment-btn');
  if (!btn || !btn.dataset.set) return;

  document.querySelectorAll('#setTabs .nav-item-btn, #setTabs .segment-btn').forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
  });

  btn.classList.add('active');
  btn.setAttribute('aria-selected', 'true');
  activeSet = btn.dataset.set;
  localStorage.setItem('pref_set', activeSet);

  sortIndicatorText.textContent = SORT_LABELS[getCurrentSortMode()] || 'Per Data';

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
  } else if (activeSet === 'Posseduti') {
    timeFilterRow.style.display = 'flex';
    timeFilterRow.innerHTML = `
      <button class="time-chip ${activeTimeFilter === 'all' ? 'active' : ''}" data-filter="all" type="button">Tutti</button>
      <button class="time-chip ${activeTimeFilter === 'regular' ? 'active' : ''}" data-filter="regular" type="button">Regolari</button>
      <button class="time-chip ${activeTimeFilter === 'variant' ? 'active' : ''}" data-filter="variant" type="button">★ Solo Variant</button>
      <button class="time-chip ${activeTimeFilter === 'unread' ? 'active' : ''}" data-filter="unread" type="button">Da Leggere</button>
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
  } else if (activeSet === 'Posseduti') {
    if (activeTimeFilter === 'variant') return Boolean(item.isVariant);
    if (activeTimeFilter === 'regular') return !item.isVariant;
    if (activeTimeFilter === 'unread') return !item.isRead;
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
  const currentSortMode = getCurrentSortMode();

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

  if (activeCategory !== 'Tutte' && activeCategory !== 'Generale') {
    filtered = filtered.filter(item => item.category === activeCategory);
  }

  if (searchSeriesQuery) {
    filtered = filtered.filter(item => item.title.toLowerCase().includes(searchSeriesQuery));
  }

  if (activeSet === 'Acquisti') {
    renderPurchasesLayout(filtered);
  } else if (activeSet === 'Posseduti') {
    renderPossedutiAggregatedLayout(filtered);
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

  if (getCurrentSortMode() !== 'date') {
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

// ----------------------------------------------------
// ACCORPAMENTO PER OPERA NEI POSSEDUTI
// ----------------------------------------------------
function renderPossedutiAggregatedLayout(items) {
  purchasedSection.style.display = 'none';
  const filtered = items.filter(matchesActiveFilter);

  if (filtered.length === 0) {
    contentList.innerHTML = `<div class="empty-state-box">Nessun volume posseduto con questi filtri.</div>`;
    return;
  }

  if (activeTimeFilter === 'variant') {
    sortItems(filtered).forEach(item => {
      contentList.appendChild(createItemCard(item, false));
    });
    return;
  }

  const seriesMap = new Map();
  filtered.forEach(item => {
    const key = `${item.title.trim().toLowerCase()}|||${(item.category || 'Generale').trim().toLowerCase()}`;
    if (!seriesMap.has(key)) {
      seriesMap.set(key, []);
    }
    seriesMap.get(key).push(item);
  });

  const aggregatedSeriesList = [];

  seriesMap.forEach((vols) => {
    const regularVols = vols.filter(v => !v.isVariant);
    const variantVols = vols.filter(v => v.isVariant);

    regularVols.sort((a, b) => (parseInt(a.number, 10) || 0) - (parseInt(b.number, 10) || 0));

    const highestVolItem = regularVols.length > 0 
      ? regularVols[regularVols.length - 1] 
      : vols[0];

    const missingGaps = calculateMissingGaps(regularVols);

    aggregatedSeriesList.push({
      representativeItem: highestVolItem,
      allVolumes: vols,
      regularCount: regularVols.length,
      variantCount: variantVols.length,
      missingGaps: missingGaps,
      maxNumber: highestVolItem.number || '1'
    });
  });

  aggregatedSeriesList.sort((a, b) => {
    if (getCurrentSortMode() === 'name') {
      return a.representativeItem.title.localeCompare(b.representativeItem.title);
    }
    return (parseInt(b.maxNumber, 10) || 0) - (parseInt(a.maxNumber, 10) || 0);
  });

  aggregatedSeriesList.forEach(series => {
    contentList.appendChild(createPossedutiAggregatedCard(series));
  });
}

function createPossedutiAggregatedCard(series) {
  const item = series.representativeItem;
  const card = document.createElement('div');
  card.dataset.id = item.id;
  const catName = escapeHtml(item.category || 'Generale');
  const catColor = getCategoryColor(item.category || 'Generale');

  const hasGaps = series.missingGaps.length > 0;
  const statusClass = hasGaps ? 'status-orange' : 'status-green';
  card.className = `item-card ${statusClass}`;

  const gapBadgeHtml = hasGaps 
    ? `<span class="gap-badge clickable-gap" title="Clicca per vedere i volumi mancanti">⚠️ Mancano ${series.missingGaps.length} vol.</span>` 
    : '';

  const variantBadgeHtml = series.variantCount > 0 
    ? `<span class="foil-sparkle-badge" title="${series.variantCount} Variant possedute">★ ${series.variantCount} Variant</span>` 
    : '';

  const completedHtml = item.completed ? `<span class="completed-badge">Fine</span>` : '';
  const readBadgeClass = item.isRead ? '' : 'is-unread';
  const readHtml = `<span class="read-badge ${readBadgeClass}" title="Stato lettura">${item.isRead ? 'Letto' : 'In corso'}</span>`;

  card.innerHTML = `
    <div class="card-left-section">
      <div class="item-main-details">
        <div class="item-tags-row">
          <span class="item-tag-inline" style="color: ${catColor};">${catName}</span>
          ${completedHtml}
          ${readHtml}
          ${variantBadgeHtml}
        </div>
        <span class="item-name item-name-clickable" title="Clicca per aprire lo scaffale 3D della collana">${escapeHtml(item.title)}</span>
        <div class="chapter-stepper-wrap" title="Avanzamento rapido capitolo letto">
          <span class="chapter-stepper-label">Cap:</span>
          <button type="button" class="chapter-step-btn step-minus" aria-label="Capitolo precedente">-</button>
          <span class="chapter-stepper-val" title="Clicca per inserire il capitolo a mano">${escapeHtml(item.readingChapter || '0')}</span>
          <button type="button" class="chapter-step-btn step-plus" aria-label="Capitolo successivo">+</button>
          <button type="button" class="chapter-edit-pencil" title="Inserisci capitolo esatto a mano">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>

    <div class="card-right-section">
      ${gapBadgeHtml}
      <div class="volume-stepper-wrap" title="Ultimo volume posseduto">
        <button type="button" class="vol-step-btn vol-step-minus" aria-label="Volume precedente">-</button>
        <span class="item-num">#${escapeHtml(series.maxNumber)}</span>
        <button type="button" class="vol-step-btn vol-step-plus" aria-label="Volume successivo">+</button>
      </div>
      <div class="card-actions">
        <button class="icon-btn shelf-open-btn" title="Apri scaffale 3D" type="button">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/>
          </svg>
        </button>
        <button class="icon-btn edit-btn" title="Modifica" type="button">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
          </svg>
        </button>
      </div>
    </div>
  `;

  const gapBtn = card.querySelector('.clickable-gap');
  if (gapBtn) {
    gapBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showGapsDetailModal(item.title, series.missingGaps, item.category);
    });
  }

  const shelfBtn = card.querySelector('.shelf-open-btn');
  const nameBtn = card.querySelector('.item-name');
  [shelfBtn, nameBtn].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openMangaShelf3D(item.title, item.category);
      });
    }
  });

  const stepMinus = card.querySelector('.step-minus');
  const stepPlus = card.querySelector('.step-plus');
  const chapVal = card.querySelector('.chapter-stepper-val');
  const chapPencil = card.querySelector('.chapter-edit-pencil');

  if (stepMinus) stepMinus.addEventListener('click', (e) => { e.stopPropagation(); updateChapterStep(item.id, -1); });
  if (stepPlus) stepPlus.addEventListener('click', (e) => { e.stopPropagation(); updateChapterStep(item.id, 1); });
  if (chapVal) chapVal.addEventListener('click', (e) => { e.stopPropagation(); setManualChapter(item.id); });
  if (chapPencil) chapPencil.addEventListener('click', (e) => { e.stopPropagation(); setManualChapter(item.id); });

  const volMinus = card.querySelector('.vol-step-minus');
  const volPlus = card.querySelector('.vol-step-plus');
  if (volMinus) volMinus.addEventListener('click', (e) => { e.stopPropagation(); updateVolumeStep(item.id, -1); });
  if (volPlus) volPlus.addEventListener('click', (e) => { e.stopPropagation(); updateVolumeStep(item.id, 1); });

  card.querySelector('.edit-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openOverviewModal(item);
  });

  return card;
}

function showGapsDetailModal(seriesTitle, missingNumbers, category) {
  const missingStr = missingNumbers.map(n => `#${n}`).join(', ');
  const shouldAdd = confirm(
    `Per "${seriesTitle}" mancano i seguenti volumi:\n${missingStr}\n\nVuoi aggiungere questi volumi mancanti alla tua lista Acquisti?`
  );

  if (shouldAdd) {
    const newItems = missingNumbers.map(n => ({
      id: generateUniqueId(),
      title: seriesTitle,
      set: 'Acquisti',
      category: category || 'Generale',
      date: null,
      number: String(n),
      rating: null,
      unplayed: false,
      purchased: false,
      completed: false,
      isRead: false,
      isVariant: false,
      missingGapNotice: null,
      readingChapter: '',
      privateComment: '',
      createdAt: new Date().toISOString()
    }));

    appData.items.unshift(...newItems);
    pushHistoryAction({ type: 'INSERT', data: newItems.map(i => ({ ...i })) });
    saveData();
    syncBatchItemsToSupabase(newItems);
    renderList();
    showToastNotice(`Aggiunti ${newItems.length} volumi mancanti agli Acquisti!`);
  }
}

function renderStandardLayout(items) {
  const filtered = items.filter(matchesActiveFilter);

  if (filtered.length === 0) {
    contentList.innerHTML = `<div class="empty-state-box">Nessun elemento presente in "${activeSet}".</div>`;
    return;
  }

  const sorted = sortItems(filtered);

  sorted.forEach((item, index) => {
    let medal = null;
    if (activeSet === 'Voti' && !item.unplayed && item.rating !== null) {
      if (index === 0) medal = '🥇';
      else if (index === 1) medal = '🥈';
      else if (index === 2) medal = '🥉';
    }
    contentList.appendChild(createItemCard(item, false, medal));
  });
}

function syncPurchasedWithPosseduti(purchasedItem) {
  const itemCategory = purchasedItem.category || 'Generale';

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
    isRead: false,
    isVariant: Boolean(purchasedItem.isVariant),
    autoGeneratedFromPurchase: true,
    missingGapNotice: null,
    readingChapter: '',
    privateComment: '',
    createdAt: new Date().toISOString()
  };

  appData.items.unshift(newItem);
  syncItemToSupabase(newItem);

  if (!newItem.isVariant) {
    ensureItemInVoti(newItem.title, newItem.category);
  }

  showToastNotice(`"${purchasedItem.title}" aggiunto in Posseduti (Vol. #${purchasedItem.number || '1'})`);
  saveData();
}

function rollbackPurchasedFromPosseduti(uncheckItem) {
  const titleClean = uncheckItem.title.trim().toLowerCase();
  const itemCategory = uncheckItem.category || 'Generale';

  const existingPosseduto = appData.items.find(
    i => i.set === 'Posseduti' && 
         i.title.trim().toLowerCase() === titleClean &&
         (i.category || 'Generale') === itemCategory &&
         String(i.number || '') === String(uncheckItem.number || '')
  );

  if (existingPosseduto) {
    appData.items = appData.items.filter(i => i.id !== existingPosseduto.id);
    deleteItemFromSupabase(existingPosseduto.id);
    showToastNotice(`"${uncheckItem.title}" rimosso da Posseduti`);
  }

  saveData();
}

async function updateChapterStep(itemId, delta) {
  const item = appData.items.find(i => i.id === itemId);
  if (!item) return;

  const prev = { ...item };
  const currentStr = String(item.readingChapter || '').trim();
  const currentNumMatch = currentStr.match(/\d+/);
  const currentVal = currentNumMatch ? parseInt(currentNumMatch[0], 10) : 0;
  const nextVal = Math.max(0, currentVal + delta);

  let updatedString = '';
  if (currentStr && isNaN(Number(currentStr))) {
    updatedString = currentStr.replace(/\d+/, String(nextVal));
  } else {
    updatedString = String(nextVal);
  }

  item.readingChapter = updatedString;
  pushHistoryAction({ type: 'UPDATE', prev: prev, next: { ...item } });

  const card = document.querySelector(`.item-card[data-id="${itemId}"]`);
  if (card) {
    const valSpan = card.querySelector('.chapter-stepper-val');
    if (valSpan) valSpan.textContent = updatedString || '0';
  }

  saveData();
  await syncItemToSupabase(item);
}

async function setManualChapter(itemId) {
  const item = appData.items.find(i => i.id === itemId);
  if (!item) return;

  const currentStr = String(item.readingChapter || '0').trim();
  const currentNumMatch = currentStr.match(/\d+/);
  const currentVal = currentNumMatch ? currentNumMatch[0] : '0';

  const inputVal = prompt(`A che capitolo sei arrivato per "${item.title}"?`, currentVal);
  if (inputVal === null) return;

  const parsed = parseInt(inputVal.trim(), 10);
  if (isNaN(parsed) || parsed < 0) {
    alert("Inserisci un numero di capitolo valido (maggiore o uguale a 0).");
    return;
  }

  const prev = { ...item };
  let updatedString = '';
  if (currentStr && isNaN(Number(currentStr))) {
    updatedString = currentStr.replace(/\d+/, String(parsed));
  } else {
    updatedString = String(parsed);
  }

  item.readingChapter = updatedString;
  pushHistoryAction({ type: 'UPDATE', prev: prev, next: { ...item } });

  const card = document.querySelector(`.item-card[data-id="${itemId}"]`);
  if (card) {
    const valSpan = card.querySelector('.chapter-stepper-val');
    if (valSpan) valSpan.textContent = updatedString;
  }

  saveData();
  await syncItemToSupabase(item);
  showToastNotice(`Capitolo di "${item.title}" impostato a ${parsed}`);
}

async function updateVolumeStep(itemId, delta) {
  const item = appData.items.find(i => i.id === itemId);
  if (!item) return;

  const prev = { ...item };
  const currentNum = parseInt(item.number || '0', 10);
  const nextNum = Math.max(1, (isNaN(currentNum) ? 0 : currentNum) + delta);

  item.number = String(nextNum);
  pushHistoryAction({ type: 'UPDATE', prev: prev, next: { ...item } });

  saveData();
  await syncItemToSupabase(item);
  renderList();
  showToastNotice(`"${item.title}" aggiornato al Vol. #${nextNum}`);
}

async function toggleReadStatus(itemId) {
  const item = appData.items.find(i => i.id === itemId);
  if (!item) return;

  const prev = { ...item };
  item.isRead = !item.isRead;
  pushHistoryAction({ type: 'UPDATE', prev: prev, next: { ...item } });

  saveData();
  await syncItemToSupabase(item);
  renderList();
  showToastNotice(item.isRead ? `Segnato come LETTO` : `Segnato come NON LETTO`);
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

function getScoreBadgeClass(rating) {
  if (rating >= 95) return 'score-top';
  if (rating >= 85) return 'score-high';
  if (rating >= 75) return 'score-good';
  if (rating >= 60) return 'score-mid';
  return 'score-low';
}

function createItemCard(item, isCompact, medalIcon = null) {
  const card = document.createElement('div');
  card.dataset.id = item.id;
  const catName = escapeHtml(item.category || 'Generale');
  const catColor = getCategoryColor(item.category || 'Generale');
  const dateInfo = getDateStatus(item.date);

  const isVariant = Boolean(item.isVariant || (item.number && String(item.number).toLowerCase().includes('variant')));
  const foilClass = isVariant ? 'foil-hologram' : '';

  const statusClass = (item.set === 'Acquisti') ? dateInfo.colorClass : '';
  const compactClass = isCompact ? 'compact-purchased' : '';
  card.className = `item-card ${statusClass} ${compactClass} ${foilClass}`;

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

  let mainValueHtml = '';
  if (item.set === 'Acquisti' || item.set === 'Liste') {
    if (item.number) {
      mainValueHtml = `<span class="item-num">#${escapeHtml(item.number)}</span>`;
    }
  } else if (item.set === 'Posseduti') {
    mainValueHtml = `<span class="item-num">#${escapeHtml(item.number || '1')}</span>`;
  } else if (item.set === 'Voti') {
    if (item.unplayed) {
      mainValueHtml = `
        <span class="unplayed-badge" title="Non ancora letto o giocato">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
            <path d="M6 2v6h.01L6 8.01 10 12l-4 4 .01.01H6V22h12v-5.99h-.01L18 16l-4-4 4-3.99-.01-.01H18V2H6zm10 14.5V20H8v-3.5l4-4 4 4zm-4-5l-4-4V4h8v3.5l-4 4z"/>
          </svg>
          Da iniziare
        </span>
      `;
    } else if (item.rating !== null && item.rating !== undefined) {
      const scoreClass = getScoreBadgeClass(item.rating);
      const medalHtml = medalIcon ? `<span class="medal-badge">${medalIcon}</span>` : '';
      mainValueHtml = `${medalHtml}<span class="score-badge-100 ${scoreClass}">${item.rating}/100</span>`;
    }
  }

  let nextVolHtml = '';
  if (item.set === 'Acquisti' && item.number && !isNaN(parseInt(item.number, 10)) && !item.completed) {
    nextVolHtml = `<button class="icon-btn next-btn" title="Crea volume successivo (+1)" type="button">+1</button>`;
  }

  const completedHtml = item.completed ? `<span class="completed-badge">Fine</span>` : '';
  const readBadgeClass = item.isRead ? '' : 'is-unread';
  const readHtml = item.set === 'Posseduti' 
    ? `<span class="read-badge ${readBadgeClass}" title="Clicca per cambiare stato">${item.isRead ? 'Letto' : 'Non letto'}</span>` 
    : '';
  const foilBadgeHtml = isVariant ? `<span class="foil-sparkle-badge">★ Variant</span>` : '';

  card.innerHTML = `
    <div class="card-left-section">
      ${checkHtml}
      <div class="item-main-details">
        <div class="item-tags-row">
          <span class="item-tag-inline" style="color: ${catColor};">${catName}</span>
          ${completedHtml}
          ${readHtml}
          ${foilBadgeHtml}
        </div>
        <span class="item-name">${escapeHtml(item.title)}</span>
      </div>
    </div>

    <div class="card-right-section">
      ${mainValueHtml}
      ${nextVolHtml}
      <div class="card-actions">
        <button class="icon-btn edit-btn" title="Modifica" type="button">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
          </svg>
        </button>
        <button class="icon-btn delete-btn" title="Elimina" type="button">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
        </button>
      </div>
    </div>
  `;

  const readBadgeElem = card.querySelector('.read-badge');
  if (readBadgeElem) {
    readBadgeElem.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleReadStatus(item.id);
    });
  }

  card.addEventListener('click', (e) => {
    if (e.target.closest('.check-btn') || e.target.closest('.icon-btn') || e.target.closest('.read-badge')) return;
    if (item.set === 'Posseduti') {
      openOverviewModal(item);
    } else {
      openEditModal(item);
    }
  });

  if (item.set === 'Acquisti') {
    card.querySelector('.check-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const prev = { ...item };
      item.purchased = !item.purchased;

      pushHistoryAction({ type: 'UPDATE', prev: prev, next: { ...item } });

      saveData();
      syncItemToSupabase(item);

      if (item.purchased) {
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

// ----------------------------------------------------
// SCAFFALE COSTE 3D (REGOLARI CON BUCHI + RIPARTO VARIANT)
// ----------------------------------------------------
function openMangaShelf3D(seriesTitle, category) {
  shelfSeriesTitle.textContent = seriesTitle;
  shelfCategoryTag.textContent = category || 'Generale';
  shelfCategoryTag.style.color = getCategoryColor(category || 'Generale');

  shelfSpineContainer.innerHTML = '';

  const ownedSeriesVolumes = appData.items.filter(i => 
    i.set === 'Posseduti' && 
    i.title.toLowerCase() === seriesTitle.toLowerCase()
  );

  const regularVols = ownedSeriesVolumes.filter(v => !v.isVariant);
  const variantVols = ownedSeriesVolumes.filter(v => v.isVariant);

  const ownedNumbersMap = new Map();
  regularVols.forEach(it => {
    const n = parseInt(it.number, 10);
    if (!isNaN(n)) ownedNumbersMap.set(n, it);
  });

  const numbers = Array.from(ownedNumbersMap.keys()).sort((a, b) => a - b);
  const minVol = numbers.length > 0 ? Math.min(1, numbers[0]) : 1;
  const maxVol = numbers.length > 0 ? Math.max(...numbers) : 1;

  const spineColor = getCategoryColor(category);

  for (let v = minVol; v <= maxVol; v++) {
    const ownedItem = ownedNumbersMap.get(v);

    if (ownedItem) {
      const spine = document.createElement('div');
      spine.className = 'manga-spine';
      spine.style.backgroundColor = spineColor;

      spine.innerHTML = `
        <span class="spine-vol-num">#${v}</span>
        <span class="spine-title-vertical">${escapeHtml(seriesTitle)}</span>
        <span style="font-size: 0.6rem; font-weight: 800; color: rgba(255,255,255,0.7);">VOL</span>
      `;

      spine.addEventListener('click', () => {
        closeShelfModal();
        openOverviewModal(ownedItem);
      });

      shelfSpineContainer.appendChild(spine);
    } else {
      const ghost = document.createElement('div');
      ghost.className = 'manga-spine missing-ghost';
      ghost.title = `Volume #${v} mancante! Clicca per aggiungerlo ad Acquisti`;

      ghost.innerHTML = `
        <span class="spine-vol-num" style="border-color: #f59e0b; color: #f59e0b;">#${v}</span>
        <span class="spine-ghost-label">+ Prendi</span>
      `;

      ghost.addEventListener('click', () => {
        if (confirm(`Aggiungere "${seriesTitle} #${v}" alla lista Acquisti?`)) {
          const newItem = {
            id: generateUniqueId(),
            title: seriesTitle,
            set: 'Acquisti',
            category: category || 'Generale',
            date: null,
            number: String(v),
            rating: null,
            unplayed: false,
            purchased: false,
            completed: false,
            isRead: false,
            isVariant: false,
            missingGapNotice: null,
            readingChapter: '',
            privateComment: '',
            createdAt: new Date().toISOString()
          };
          appData.items.unshift(newItem);
          pushHistoryAction({ type: 'INSERT', data: { ...newItem } });
          saveData();
          syncItemToSupabase(newItem);
          closeShelfModal();
          renderList();
          showToastNotice(`"${seriesTitle} #${v}" aggiunto ad Acquisti!`);
        }
      });

      shelfSpineContainer.appendChild(ghost);
    }
  }

  if (variantVols.length > 0) {
    const divider = document.createElement('div');
    divider.style.width = '100%';
    divider.style.padding = '12px 4px 6px';
    divider.style.fontSize = '0.78rem';
    divider.style.fontWeight = '800';
    divider.style.color = 'var(--accent-cyan)';
    divider.textContent = `★ Edizioni Variant (${variantVols.length})`;
    shelfSpineContainer.appendChild(divider);

    variantVols.forEach(vItem => {
      const vSpine = document.createElement('div');
      vSpine.className = 'manga-spine foil-hologram';
      vSpine.style.backgroundColor = '#181a20';

      vSpine.innerHTML = `
        <span class="spine-vol-num" style="border-color: #fbbf24; color: #fbbf24;">#${escapeHtml(vItem.number || 'V')}</span>
        <span class="spine-title-vertical">${escapeHtml(seriesTitle)} [Variant]</span>
        <span class="foil-sparkle-badge" style="transform: rotate(90deg); margin-bottom: 8px;">VAR</span>
      `;

      vSpine.addEventListener('click', () => {
        closeShelfModal();
        openOverviewModal(vItem);
      });

      shelfSpineContainer.appendChild(vSpine);
    });
  }

  shelfModalBackdrop.classList.add('active');
}

function closeShelfModal() {
  shelfModalBackdrop.classList.remove('active');
}

if (closeShelfModalBtn) closeShelfModalBtn.addEventListener('click', closeShelfModal);
if (shelfModalBackdrop) {
  shelfModalBackdrop.addEventListener('click', (e) => {
    if (e.target === shelfModalBackdrop) closeShelfModal();
  });
}

// ----------------------------------------------------
// SCANNER BARCODE CON ANTEPRIMA SCHEDA & STORICO
// ----------------------------------------------------
function openCheckerModal() {
  resetCheckerPreview();
  checkerModalBackdrop.classList.add('active');

  if (!checkerScanner) {
    checkerScanner = new Html5Qrcode('checkerCameraReader');
  }

  checkerScanner.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: { width: 260, height: 160 } },
    async (decodedText) => {
      await processBarcodeVerification(decodedText);
    },
    () => {}
  ).catch(() => {
    checkerStatusTitle.textContent = 'Fotocamera non disponibile';
    checkerStatusDesc.textContent = 'Verifica i permessi della fotocamera nel browser.';
  });
}

function resetCheckerPreview() {
  checkerResultBox.className = 'checker-result-box idle';
  checkerSignalIcon.textContent = '📷';
  checkerStatusTitle.textContent = 'Inquadra il codice a barre';
  checkerStatusDesc.textContent = 'Punta la fotocamera sull\'ISBN per verificare se è già presente in collezione.';
  checkerAddToAcquistiBtn.style.display = 'none';
  checkerAddToPossedutiBtn.style.display = 'none';
  lastDetectedCheckItem = null;
}

function stopCheckerModal() {
  if (checkerScanner) {
    checkerScanner.stop().catch(() => {}).then(() => {
      checkerModalBackdrop.classList.remove('active');
    });
  } else {
    checkerModalBackdrop.classList.remove('active');
  }
}

async function processBarcodeVerification(isbn) {
  if (checkerScanner) {
    try { await checkerScanner.pause(); } catch(e) {}
  }

  checkerSignalIcon.textContent = '⏳';
  checkerStatusTitle.textContent = 'Ricerca dati ISBN...';
  checkerStatusDesc.textContent = `Codice: ${isbn}`;

  try {
    const cleanIsbn = isbn.replace(/[^0-9X]/gi, '');
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${cleanIsbn}`);
    const data = await res.json();

    let titleFound = '';
    let volumeFound = null;
    let isVariant = false;

    if (data.items && data.items.length > 0) {
      const volumeInfo = data.items[0].volumeInfo;
      const rawTitle = volumeInfo.title || '';
      const rawDesc = volumeInfo.description || '';

      if (/variant|cover\s*[b-z]|limited|special\s*edition/i.test(`${rawTitle} ${rawDesc}`)) {
        isVariant = true;
      }

      titleFound = rawTitle;
      const numMatch = titleFound.match(/^(.*?)\s+#?(\d+)$/);
      if (numMatch) {
        titleFound = numMatch[1].trim();
        volumeFound = numMatch[2].trim();
      }
    } else {
      titleFound = `Volume ISBN ${cleanIsbn}`;
    }

    lastDetectedCheckItem = {
      title: titleFound,
      number: volumeFound || '1',
      isVariant: isVariant
    };

    displayBarcodeEvaluation();
  } catch (err) {
    checkerResultBox.className = 'checker-result-box idle';
    checkerSignalIcon.textContent = '⚠️';
    checkerStatusTitle.textContent = 'Errore di connessione';
    checkerStatusDesc.textContent = 'Impossibile verificare l\'ISBN sui server online.';
  }
}

function displayBarcodeEvaluation() {
  if (!lastDetectedCheckItem) return;

  const { title, number, isVariant } = lastDetectedCheckItem;
  const titleLower = title.toLowerCase();

  const exactOwned = appData.items.find(i => 
    i.set === 'Posseduti' && 
    i.title.toLowerCase() === titleLower && 
    String(i.number || '') === String(number) &&
    Boolean(i.isVariant) === Boolean(isVariant)
  );

  if (exactOwned) {
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    checkerResultBox.className = 'checker-result-box red-signal';
    checkerSignalIcon.textContent = '⛔';
    checkerStatusTitle.textContent = isVariant ? 'VARIANT GIÀ IN COLLEZIONE!' : 'GIÀ PRESENTE IN COLLEZIONE!';
    checkerStatusDesc.innerHTML = `
      Possiedi già "${escapeHtml(title)} #${escapeHtml(number)}" nei tuoi Posseduti!
    `;
    checkerAddToAcquistiBtn.style.display = 'none';
    checkerAddToPossedutiBtn.style.display = 'none';
  } else {
    if (navigator.vibrate) navigator.vibrate(80);
    checkerResultBox.className = 'checker-result-box green-signal';
    checkerSignalIcon.textContent = '✅';
    checkerStatusTitle.textContent = 'NON PRESENTE: PUOI ACQUISTARLO!';
    checkerStatusDesc.innerHTML = `
      <div class="scanner-preview-card" style="background: rgba(0,0,0,0.3); padding: 8px; border-radius: 8px; margin-top: 6px;">
        <div style="font-weight: 700; color: #fff;">${escapeHtml(title)}</div>
        <div style="font-size: 0.85rem; color: var(--accent-cyan);">Volume: #${escapeHtml(number)}</div>
        <label class="checkbox-row" style="margin-top: 6px;">
          <input type="checkbox" id="scannerVariantCheck" ${isVariant ? 'checked' : ''}>
          <span class="custom-chk"></span>
          <span style="font-size: 0.8rem; font-weight: 700;">★ Edizione Variant</span>
        </label>
      </div>
    `;

    document.getElementById('scannerVariantCheck').addEventListener('change', (e) => {
      lastDetectedCheckItem.isVariant = e.target.checked;
    });

    checkerAddToAcquistiBtn.style.display = 'inline-flex';
    checkerAddToPossedutiBtn.style.display = 'inline-flex';
  }
}

if (openCheckerScanBtn) openCheckerScanBtn.addEventListener('click', openCheckerModal);
if (openCheckerTopBtn) openCheckerTopBtn.addEventListener('click', openCheckerModal);
if (closeCheckerModalBtn) closeCheckerModalBtn.addEventListener('click', stopCheckerModal);

if (checkerResetBtn) {
  checkerResetBtn.addEventListener('click', () => {
    resetCheckerPreview();
    if (checkerScanner) {
      try { checkerScanner.resume(); } catch(e) {}
    }
  });
}

if (checkerAddToAcquistiBtn) {
  checkerAddToAcquistiBtn.addEventListener('click', () => {
    if (!lastDetectedCheckItem) return;
    const isVar = Boolean(lastDetectedCheckItem.isVariant);
    const newItem = {
      id: generateUniqueId(),
      title: lastDetectedCheckItem.title,
      set: 'Acquisti',
      category: 'Generale',
      date: null,
      number: lastDetectedCheckItem.number || '1',
      rating: null,
      unplayed: false,
      purchased: false,
      completed: false,
      isRead: false,
      isVariant: isVar,
      missingGapNotice: null,
      readingChapter: '',
      privateComment: '',
      createdAt: new Date().toISOString()
    };
    appData.items.unshift(newItem);
    pushHistoryAction({ type: 'INSERT', data: { ...newItem } });
    saveData();
    syncItemToSupabase(newItem);
    renderList();
    stopCheckerModal();
    showToastNotice(`"${newItem.title}" aggiunto agli Acquisti!`);
  });
}

if (checkerAddToPossedutiBtn) {
  checkerAddToPossedutiBtn.addEventListener('click', () => {
    if (!lastDetectedCheckItem) return;
    const isVar = Boolean(lastDetectedCheckItem.isVariant);
    const newItem = {
      id: generateUniqueId(),
      title: lastDetectedCheckItem.title,
      set: 'Posseduti',
      category: 'Generale',
      date: null,
      number: lastDetectedCheckItem.number || '1',
      rating: null,
      unplayed: false,
      purchased: false,
      completed: false,
      isRead: false,
      isVariant: isVar,
      missingGapNotice: null,
      readingChapter: '',
      privateComment: '',
      createdAt: new Date().toISOString()
    };
    appData.items.unshift(newItem);
    pushHistoryAction({ type: 'INSERT', data: { ...newItem } });
    saveData();
    syncItemToSupabase(newItem);

    if (!isVar) {
      ensureItemInVoti(newItem.title, newItem.category);
    }

    renderList();
    stopCheckerModal();
    showToastNotice(`"${newItem.title}" aggiunto ai Posseduti!`);
  });
}

if (checkerModalBackdrop) {
  checkerModalBackdrop.addEventListener('click', (e) => {
    if (e.target === checkerModalBackdrop) stopCheckerModal();
  });
}

// ----------------------------------------------------
// TENDINA E MODALE STORICO RECENTI
// ----------------------------------------------------
function renderQuickHistoryDropdown() {
  const container = document.getElementById('historyDropdownMenu');
  if (!container) return;

  const recentItems = [...appData.items]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 8);

  container.innerHTML = '';
  if (recentItems.length === 0) {
    container.innerHTML = '<div style="padding: 10px; font-size: 0.8rem; color: var(--text-dim);">Nessuna aggiunta recente</div>';
    return;
  }

  recentItems.forEach(it => {
    const row = document.createElement('div');
    row.className = 'history-dropdown-row';
    row.style.cssText = 'padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 0.82rem; cursor: pointer;';
    row.innerHTML = `
      <div style="font-weight: 700; color: #fff;">${escapeHtml(it.title)} ${it.number ? '#' + it.number : ''} ${it.isVariant ? '★' : ''}</div>
      <div style="font-size: 0.72rem; color: var(--text-dim);">${escapeHtml(it.set)} [${escapeHtml(it.category || 'Generale')}]</div>
    `;
    row.addEventListener('click', () => {
      container.classList.remove('open');
      openOverviewModal(it);
    });
    container.appendChild(row);
  });

  const expandAllBtn = document.createElement('button');
  expandAllBtn.type = 'button';
  expandAllBtn.className = 'btn-primary';
  expandAllBtn.style.cssText = 'width: 100%; font-size: 0.78rem; padding: 6px; margin-top: 6px; border-radius: 6px;';
  expandAllBtn.textContent = 'Espandi Tutto lo Storico';
  expandAllBtn.addEventListener('click', () => {
    container.classList.remove('open');
    openFullHistoryModal();
  });
  container.appendChild(expandAllBtn);
}

function openFullHistoryModal() {
  const modal = document.getElementById('fullHistoryModalBackdrop');
  const listElem = document.getElementById('fullHistoryModalList');
  if (!modal || !listElem) return;

  const sortedAll = [...appData.items].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  listElem.innerHTML = '';
  sortedAll.forEach(it => {
    const d = document.createElement('div');
    d.style.cssText = 'padding: 8px 12px; background: var(--bg-item-inner); border-radius: 8px; margin-bottom: 6px; border: 1px solid var(--border-card); display: flex; justify-content: space-between; align-items: center;';
    d.innerHTML = `
      <div>
        <strong style="color: #fff;">${escapeHtml(it.title)} ${it.number ? '#' + it.number : ''}</strong>
        <span style="font-size: 0.74rem; color: var(--text-dim); margin-left: 6px;">[${escapeHtml(it.set)}]</span>
      </div>
      <span style="font-size: 0.7rem; color: var(--accent-cyan);">${it.createdAt ? new Date(it.createdAt).toLocaleDateString('it-IT') : ''}</span>
    `;
    listElem.appendChild(d);
  });

  modal.classList.add('active');
}

const historyTopBtn = document.getElementById('historyDropdownBtn');
if (historyTopBtn) {
  historyTopBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const dropdown = document.getElementById('historyDropdownMenu');
    if (dropdown) {
      dropdown.classList.toggle('open');
      if (dropdown.classList.contains('open')) {
        renderQuickHistoryDropdown();
      }
    }
  });
}

document.addEventListener('click', () => {
  const dropdown = document.getElementById('historyDropdownMenu');
  if (dropdown) dropdown.classList.remove('open');
});

const closeFullHistoryModalBtn = document.getElementById('closeFullHistoryModalBtn');
const fullHistoryModalBackdrop = document.getElementById('fullHistoryModalBackdrop');

if (closeFullHistoryModalBtn && fullHistoryModalBackdrop) {
  closeFullHistoryModalBtn.addEventListener('click', () => {
    fullHistoryModalBackdrop.classList.remove('active');
  });
  fullHistoryModalBackdrop.addEventListener('click', (e) => {
    if (e.target === fullHistoryModalBackdrop) {
      fullHistoryModalBackdrop.classList.remove('active');
    }
  });
}

// ----------------------------------------------------
// BATCH INSERT (BLOCCO VOLUMI)
// ----------------------------------------------------
function openBatchModal() {
  batchItemForm.reset();
  batchStartVol.value = 1;
  batchEndVol.value = 10;
  batchTargetSet.value = (activeSet === 'Posseduti' || activeSet === 'Acquisti') ? activeSet : 'Posseduti';

  batchCategorySelect.innerHTML = '';
  appData.categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    if (cat === activeCategory && activeCategory !== 'Tutte') opt.selected = true;
    batchCategorySelect.appendChild(opt);
  });

  const uniqueTitles = [...new Set(appData.items.map(i => i.title))];
  existingTitlesListBatch.innerHTML = '';
  uniqueTitles.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    existingTitlesListBatch.appendChild(opt);
  });

  batchModalBackdrop.classList.add('active');
  batchTitle.focus();
}

function closeBatchModal() {
  batchModalBackdrop.classList.remove('active');
  batchItemForm.reset();
}

if (openBatchModalBtn) openBatchModalBtn.addEventListener('click', openBatchModal);
if (openBatchTopBtn) openBatchTopBtn.addEventListener('click', openBatchModal);
if (closeBatchModalBtn) closeBatchModalBtn.addEventListener('click', closeBatchModal);
if (cancelBatchBtn) cancelBatchBtn.addEventListener('click', closeBatchModal);

if (batchModalBackdrop) {
  batchModalBackdrop.addEventListener('click', (e) => {
    if (e.target === batchModalBackdrop) closeBatchModal();
  });
}

if (batchItemForm) {
  batchItemForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const title = batchTitle.value.trim();
    const start = parseInt(batchStartVol.value, 10);
    const end = parseInt(batchEndVol.value, 10);
    const set = batchTargetSet.value;
    const cat = batchCategorySelect.value || 'Generale';

    if (!title) {
      alert('Inserisci un titolo per la serie.');
      return;
    }
    if (isNaN(start) || isNaN(end) || start > end) {
      alert('Intervallo non valido: il volume iniziale deve essere minore o uguale al volume finale.');
      return;
    }

    const createdItems = [];
    for (let v = start; v <= end; v++) {
      const exists = appData.items.some(i => 
        i.title.toLowerCase() === title.toLowerCase() &&
        i.set === set &&
        String(i.number || '') === String(v) &&
        !i.isVariant
      );

      if (!exists) {
        createdItems.push({
          id: generateUniqueId(),
          title: title,
          set: set,
          category: cat,
          date: null,
          number: String(v),
          rating: null,
          unplayed: false,
          purchased: set === 'Posseduti',
          completed: false,
          isRead: false,
          isVariant: false,
          missingGapNotice: null,
          readingChapter: '',
          privateComment: '',
          createdAt: new Date().toISOString()
        });
      }
    }

    if (createdItems.length === 0) {
      alert(`Tutti i volumi selezionati di "${title}" sono già presenti nella collezione!`);
      return;
    }

    appData.items.unshift(...createdItems);
    pushHistoryAction({ type: 'INSERT', data: createdItems.map(i => ({ ...i })) });
    saveData();
    closeBatchModal();

    await syncBatchItemsToSupabase(createdItems);

    if (set === 'Posseduti') {
      ensureItemInVoti(title, cat);
    }

    showToastNotice(`Aggiunti ${createdItems.length} volumi di "${title}"!`);

    if (activeSet !== set) {
      activeSet = set;
      localStorage.setItem('pref_set', activeSet);
      document.querySelectorAll('#setTabs .nav-item-btn, #setTabs .segment-btn').forEach(b => {
        const isSelected = b.dataset.set === set;
        b.classList.toggle('active', isSelected);
        b.setAttribute('aria-selected', String(isSelected));
      });
      sortIndicatorText.textContent = SORT_LABELS[getCurrentSortMode()] || 'Per Data';
      updateFilterBarChips();
    }

    renderList();
  });
}

// ----------------------------------------------------
// SCANNER ISBN NEL FORM
// ----------------------------------------------------
if (startScanBtn) {
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
      () => {}
    ).catch(() => {
      scannerStatus.textContent = 'Impossibile accedere alla fotocamera. Verifica i permessi.';
    });
  });
}

function stopScanner() {
  if (html5QrCodeScanner) {
    html5QrCodeScanner.stop().catch(() => {}).then(() => {
      if (scannerContainer) scannerContainer.style.display = 'none';
    });
  } else {
    if (scannerContainer) scannerContainer.style.display = 'none';
  }
}

if (closeScannerBtn) closeScannerBtn.addEventListener('click', stopScanner);

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

// ----------------------------------------------------
// STATISTICHE DETTAGLIATE PER SOTTO-CATEGORIA
// ----------------------------------------------------
if (openStatsBtn) {
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
    const catStats = {};

    appData.categories.forEach(c => {
      catStats[c] = { ownedCount: 0, scores: [] };
    });

    ownedItems.forEach(i => {
      const c = i.category || 'Generale';
      if (!catStats[c]) catStats[c] = { ownedCount: 0, scores: [] };
      catStats[c].ownedCount++;
    });

    scoredItems.forEach(i => {
      const c = i.category || 'Generale';
      if (!catStats[c]) catStats[c] = { ownedCount: 0, scores: [] };
      catStats[c].scores.push(i.rating);
    });

    Object.entries(catStats).forEach(([cat, stat]) => {
      const row = document.createElement('div');
      row.className = 'stat-cat-row-detailed';

      const color = getCategoryColor(cat);
      const totalOwned = ownedItems.length || 1;
      const percent = Math.round((stat.ownedCount / totalOwned) * 100);

      let avgRatingText = 'N.D.';
      if (stat.scores.length > 0) {
        const avg = Math.round(stat.scores.reduce((a, b) => a + b, 0) / stat.scores.length);
        avgRatingText = `${avg}/100`;
      }

      row.innerHTML = `
        <div class="stat-cat-row-top">
          <span style="color: ${color}; font-weight: 700; font-size: 0.95rem;">${escapeHtml(cat)}</span>
          <span style="font-weight: 800; font-size: 0.95rem;">${stat.ownedCount} volumi</span>
        </div>
        <div class="stat-cat-progress-bg">
          <div class="stat-cat-progress-fill" style="width: ${percent}%; background-color: ${color};"></div>
        </div>
        <div class="stat-cat-meta-row">
          <span>${percent}% della collezione</span>
          <span>Media Voti: <strong style="color: var(--accent-cyan);">${avgRatingText}</strong></span>
        </div>
      `;
      statsCatList.appendChild(row);
    });

    statsModalBackdrop.classList.add('active');
  });
}

if (closeStatsBtn) closeStatsBtn.addEventListener('click', () => statsModalBackdrop.classList.remove('active'));
if (statsModalBackdrop) {
  statsModalBackdrop.addEventListener('click', (e) => {
    if (e.target === statsModalBackdrop) statsModalBackdrop.classList.remove('active');
  });
}

// ----------------------------------------------------
// PANORAMICA POSSEDUTI
// ----------------------------------------------------
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

if (closeOverviewBtn) closeOverviewBtn.addEventListener('click', closeOverviewModal);
if (overviewModalBackdrop) {
  overviewModalBackdrop.addEventListener('click', (e) => {
    if (e.target === overviewModalBackdrop) closeOverviewModal();
  });
}

if (saveOverviewDetailsBtn) {
  saveOverviewDetailsBtn.addEventListener('click', () => {
    if (!currentOverviewItemId) return;
    const item = appData.items.find(i => i.id === currentOverviewItemId);
    if (item) {
      const prev = { ...item };
      item.readingChapter = overviewReadingProgressInput.value.trim();
      item.privateComment = overviewCommentInput.value.trim();
      pushHistoryAction({ type: 'UPDATE', prev: prev, next: { ...item } });

      saveData();
      syncItemToSupabase(item);
      closeOverviewModal();
      renderList();
      showToastNotice(`Panoramica di "${item.title}" salvata!`);
    }
  });
}

if (overviewEditFullBtn) {
  overviewEditFullBtn.addEventListener('click', () => {
    if (!currentOverviewItemId) return;
    const item = appData.items.find(i => i.id === currentOverviewItemId);
    if (item) {
      closeOverviewModal();
      openEditModal(item);
    }
  });
}

function deleteItemWithUndo(item) {
  pushHistoryAction({ type: 'DELETE', data: { ...item } });
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

if (undoBtn) {
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
}

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
    isRead: false,
    isVariant: false,
    missingGapNotice: null,
    readingChapter: '',
    privateComment: '',
    createdAt: new Date().toISOString()
  };

  appData.items.unshift(newItem);
  pushHistoryAction({ type: 'INSERT', data: { ...newItem } });
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
  if (itemVariantCheckbox) itemVariantCheckbox.checked = false;
  if (itemReadCheckbox) itemReadCheckbox.checked = false;

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
  if (itemReadCheckbox) itemReadCheckbox.checked = Boolean(item.isRead);
  if (itemVariantCheckbox) itemVariantCheckbox.checked = Boolean(item.isVariant);

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

// ----------------------------------------------------
// SALVATAGGIO CON BLOCCO DUPLICATI E DEROGA VARIANT
// ----------------------------------------------------
itemForm.addEventListener('submit', (e) => {
  e.preventDefault();

  const idToEdit = editItemId.value;
  let title = itemTitle.value.trim();
  const set = targetSet.value;
  const typedCat = newCategoryInput.value.trim();
  let category = categorySelect.value;
  const isVariantChecked = itemVariantCheckbox ? itemVariantCheckbox.checked : false;
  const isReadChecked = itemReadCheckbox ? itemReadCheckbox.checked : false;

  const numInTitleMatch = title.match(/^(.*?)\s+#?(\d+)$/);
  if (numInTitleMatch && itemNumber.value === numInTitleMatch[2] && (set === 'Acquisti' || set === 'Posseduti' || set === 'Liste')) {
    title = numInTitleMatch[1];
  }

  const number = (set === 'Acquisti' || set === 'Posseduti' || set === 'Liste') ? (itemNumber.value.trim() || null) : null;

  // CONTROLLO DUPLICATI:
  if (!idToEdit) {
    if (set === 'Voti' || set === 'Liste') {
      const duplicateInOther = appData.items.find(i => 
        i.title.toLowerCase() === title.toLowerCase() &&
        (i.set === 'Voti' || i.set === 'Liste')
      );

      if (duplicateInOther) {
        alert(`Impossibile aggiungere: "${title}" è già presente nella sezione "${duplicateInOther.set}"!`);
        return;
      }
    }

    if (!isVariantChecked) {
      const duplicateSame = appData.items.find(i => 
        i.title.toLowerCase() === title.toLowerCase() &&
        i.set === set &&
        String(i.number || '') === String(number || '') &&
        !i.isVariant
      );

      if (duplicateSame) {
        alert(`"${title}" ${number ? '#' + number : ''} è già presente in "${set}"! Se si tratta di una variant, spunta "Edizione Variant".`);
        return;
      }
    }
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
      const prev = { ...existing };
      existing.title = title;
      existing.set = set;
      existing.category = category;
      existing.date = date;
      existing.number = number;
      existing.completed = completed;
      existing.isRead = isReadChecked;
      existing.rating = rating;
      existing.unplayed = unplayed;
      existing.isVariant = isVariantChecked;
      finalItem = existing;
      pushHistoryAction({ type: 'UPDATE', prev: prev, next: { ...existing } });
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
      isRead: isReadChecked,
      rating,
      unplayed,
      isVariant: isVariantChecked,
      purchased: false,
      missingGapNotice: null,
      readingChapter: '',
      privateComment: '',
      createdAt: new Date().toISOString()
    };
    appData.items.unshift(finalItem);
    pushHistoryAction({ type: 'INSERT', data: { ...finalItem } });

    if (set === 'Posseduti' && !isVariantChecked) {
      ensureItemInVoti(title, category);
    }
  }

  saveData();
  if (finalItem) syncItemToSupabase(finalItem);
  closeModal();
  updateCategoryDropdown();

  if (activeSet !== set) {
    activeSet = set;
    localStorage.setItem('pref_set', activeSet);
    document.querySelectorAll('#setTabs .nav-item-btn, #setTabs .segment-btn').forEach(b => {
      const isSelected = b.dataset.set === set;
      b.classList.toggle('active', isSelected);
      b.setAttribute('aria-selected', String(isSelected));
    });
    sortIndicatorText.textContent = SORT_LABELS[getCurrentSortMode()] || 'Per Data';
    updateFilterBarChips();
  }

  renderList();
});

// Scorciatoie da tastiera
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    if (e.key === 'z' || e.key === 'Z') {
      if (e.shiftKey) {
        e.preventDefault();
        executeRedo();
      } else {
        e.preventDefault();
        executeUndo();
      }
      return;
    } else if (e.key === 'y' || e.key === 'Y') {
      e.preventDefault();
      executeRedo();
      return;
    }
  }

  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    if (e.key === 'Escape') {
      document.activeElement.blur();
      closeModal();
      closeBatchModal();
      stopCheckerModal();
      closeShelfModal();
      closeOverviewModal();
      closeSettingsModal();
      if (statsModalBackdrop) statsModalBackdrop.classList.remove('active');
      if (fullHistoryModalBackdrop) fullHistoryModalBackdrop.classList.remove('active');
    }
    return;
  }

  if (e.key === 'n' || e.key === 'N') {
    e.preventDefault();
    openCreateModal();
  } else if (e.key === 'b' || e.key === 'B') {
    e.preventDefault();
    openBatchModal();
  } else if (e.key === '/') {
    e.preventDefault();
    seriesSearchInput.focus();
  } else if (e.key === 'Escape') {
    closeModal();
    closeBatchModal();
    stopCheckerModal();
    closeShelfModal();
    closeOverviewModal();
    closeSettingsModal();
    if (statsModalBackdrop) statsModalBackdrop.classList.remove('active');
    if (fullHistoryModalBackdrop) fullHistoryModalBackdrop.classList.remove('active');
  }
});

// Sotto-viste Impostazioni
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
      isRead: Boolean(item.isRead),
      rating: item.rating !== undefined ? item.rating : null,
      unplayed: Boolean(item.unplayed),
      isVariant: Boolean(item.isVariant),
      purchased: Boolean(item.purchased),
      missingGapNotice: item.missingGapNotice || null,
      readingChapter: item.readingChapter || '',
      privateComment: item.privateComment || '',
      createdAt: item.createdAt || new Date().toISOString()
    }));

  const exportPayload = {
    appVersion: '4.0',
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

// Importazione JSON
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
      let skippedCount = 0;
      const newlyImported = [];

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
        const incomingIsVariant = Boolean(incoming.isVariant || (incoming.number && String(incoming.number).toLowerCase().includes('variant')));

        if (!appData.categories.includes(category)) {
          appData.categories.push(category);
        }

        const isDuplicateGlobally = appData.items.some(existing => 
          existing.title.toLowerCase() === incoming.title.toLowerCase() &&
          (existing.set === 'Voti' || existing.set === 'Liste')
        );

        const isDuplicateInSameSet = appData.items.some(existing => 
          existing.title.toLowerCase() === incoming.title.toLowerCase() &&
          existing.set === target &&
          String(existing.number || '') === String(incoming.number || '') &&
          !incomingIsVariant &&
          !existing.isVariant
        );

        if (isDuplicateGlobally || isDuplicateInSameSet) {
          skippedCount++;
          return;
        }

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
          number: incoming.number ? String(incoming.number) : null,
          completed: Boolean(incoming.completed),
          isRead: Boolean(incoming.isRead),
          rating: incomingRating !== undefined ? incomingRating : null,
          unplayed: Boolean(incoming.unplayed),
          isVariant: incomingIsVariant,
          purchased: Boolean(incoming.purchased),
          missingGapNotice: incoming.missingGapNotice || null,
          readingChapter: incoming.readingChapter || '',
          privateComment: incoming.privateComment || '',
          createdAt: incoming.createdAt || new Date().toISOString()
        };

        appData.items.unshift(newItem);
        newlyImported.push(newItem);
        syncItemToSupabase(newItem);

        if (target === 'Posseduti' && !incomingIsVariant) {
          ensureItemInVoti(newItem.title, newItem.category);
        }

        importedCount++;
      });

      if (newlyImported.length > 0) {
        pushHistoryAction({ type: 'INSERT', data: newlyImported.map(i => ({ ...i })) });
      }

      saveData();
      updateCategoryDropdown();
      renderList();
      closeSettingsModal();
      importJsonFileInput.value = '';

      alert(`Importazione completata! Aggiunti: ${importedCount}, saltati: ${skippedCount}.`);
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
  setSortModes = { Acquisti: 'date', Posseduti: 'name', Voti: 'number', Liste: 'name' };
  localStorage.setItem('pref_set_sort_modes', JSON.stringify(setSortModes));
  searchSeriesQuery = '';

  historyUndoStack.length = 0;
  historyRedoStack.length = 0;
  updateHistoryButtonsUI();

  closeSettingsModal();
  initApp();
  alert('Dati ripristinati allo stato iniziale sia in locale che su Supabase.');
});

function initApp() {
  document.querySelectorAll('#setTabs .nav-item-btn, #setTabs .segment-btn').forEach(b => {
    const isSelected = b.dataset.set === activeSet;
    b.classList.toggle('active', isSelected);
    b.setAttribute('aria-selected', String(isSelected));
  });

  updateFilterBarChips();
  sortIndicatorText.textContent = SORT_LABELS[getCurrentSortMode()] || 'Per Data';

  if (isPurchasedSectionOpen) {
    purchasedList.classList.add('open');
    chevronIcon.classList.add('open');
    togglePurchasedBtn.setAttribute('aria-expanded', 'true');
  }

  updateCategoryDropdown();
  updateHistoryButtonsUI();
  renderList();
}

// Avvio applicazione e autenticazione
initApp();
initAuthAndApp();