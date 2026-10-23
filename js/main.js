// js/main.js
import {
  supabaseClient,
  currentUser,
  initAuth,
  setCloudStatus,
  syncItemToSupabase,
  syncBatchItemsToSupabase,
  deleteItemFromSupabase,
  syncCategoriesToSupabase,
  setupRealtimeSubscriptions,
  formatRowToItem
} from './supabase.js';

import {
  openCheckerModal,
  stopCheckerModal,
  resetCheckerPreview,
  searchIsbnData,
  escapeHtml,
  lastDetectedCheckItem
} from './scanner.js';

import {
  getCategoryColor,
  getTodayString,
  getDateStatus,
  getMonthYearTitle,
  getScoreBadgeClass,
  calculateMissingGaps
} from './ui.js';

// Registrazione PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('Service Worker non registrato:', err);
    });
  });
}

function generateUniqueId() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return (arr[0] & 0x7FFFFFFF) % 2000000000;
  }
  return Math.floor(Math.random() * 1900000000) + 1;
}

// ----------------------------------------------------
// STATO APPLICAZIONE LOCALE
// ----------------------------------------------------
const DEFAULT_DATA = {
  categories: ['Generale', 'Manga', 'Comics', 'Libri', 'Videogiochi'],
  items: []
};

let appData = JSON.parse(localStorage.getItem('collection_data')) || JSON.parse(JSON.stringify(DEFAULT_DATA));

let dataNeedsResave = false;
appData.items.forEach(item => {
  if (!item.id || item.id > 2147483647 || isNaN(parseInt(item.id, 10))) {
    item.id = Math.floor(Math.random() * 1900000000) + 1;
    dataNeedsResave = true;
  }
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

if (dataNeedsResave) {
  localStorage.setItem('collection_data', JSON.stringify(appData));
}

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
let currentActiveSeries = null;
let inlineHtml5Scanner = null;

const historyUndoStack = [];
const historyRedoStack = [];
const MAX_HISTORY_STEPS = 35;

function pushHistoryAction(action) {
  historyUndoStack.push(action);
  if (historyUndoStack.length > MAX_HISTORY_STEPS) historyUndoStack.shift();
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
    for (const id of ids) await deleteItemFromSupabase(id);
    showToastNotice('Creazione annullata');
  } else if (action.type === 'DELETE') {
    if (Array.isArray(action.data)) {
      action.data.forEach(it => appData.items.unshift(it));
      saveData();
      await syncBatchItemsToSupabase(action.data);
      showToastNotice(`Ripristinati ${action.data.length} elementi`);
    } else {
      appData.items.unshift(action.data);
      saveData();
      await syncItemToSupabase(action.data, saveData);
      showToastNotice(`Ripristinato "${action.data.title}"`);
    }
  } else if (action.type === 'UPDATE') {
    const idx = appData.items.findIndex(i => i.id === action.prev.id);
    if (idx !== -1) {
      appData.items[idx] = { ...action.prev };
      saveData();
      await syncItemToSupabase(appData.items[idx], saveData);
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
      await syncItemToSupabase(items[0], saveData);
    }
    showToastNotice('Creazione riapplicata');
  } else if (action.type === 'DELETE') {
    const ids = Array.isArray(action.data) ? action.data.map(i => i.id) : [action.data.id];
    appData.items = appData.items.filter(i => !ids.includes(i.id));
    saveData();
    for (const id of ids) await deleteItemFromSupabase(id);
    showToastNotice('Eliminazione riapplicata');
  } else if (action.type === 'UPDATE') {
    const idx = appData.items.findIndex(i => i.id === action.next.id);
    if (idx !== -1) {
      appData.items[idx] = { ...action.next };
      saveData();
      await syncItemToSupabase(appData.items[idx], saveData);
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

function saveData() {
  localStorage.setItem('collection_data', JSON.stringify(appData));
}

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
      isbn: null,
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
    await syncItemToSupabase(votiItem, saveData);
  }
}

// Elementi DOM Principali
const contentList = document.getElementById('contentList');
const categoryFilter = document.getElementById('categoryFilter');
const setTabs = document.getElementById('setTabs');
const timeFilterRow = document.getElementById('timeFilterRow');
const toggleSortBtn = document.getElementById('toggleSortBtn');
const sortIndicatorText = document.getElementById('sortIndicatorText');

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

const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
const twitchSidebar = document.getElementById('twitchSidebar');

if (toggleSidebarBtn && twitchSidebar) {
  toggleSidebarBtn.addEventListener('click', () => {
    twitchSidebar.classList.toggle('collapsed');
  });
}

// Action Sheet Rapida
const quickActionModalBackdrop = document.getElementById('quickActionModalBackdrop');
const closeQuickSheetBtn = document.getElementById('closeQuickSheetBtn');
const quickSheetCategoryTag = document.getElementById('quickSheetCategoryTag');
const quickSheetTitle = document.getElementById('quickSheetTitle');
const quickVolMinusBtn = document.getElementById('quickVolMinusBtn');
const quickVolValue = document.getElementById('quickVolValue');
const quickVolPlusBtn = document.getElementById('quickVolPlusBtn');
const quickChapMinusBtn = document.getElementById('quickChapMinusBtn');
const quickChapValue = document.getElementById('quickChapValue');
const quickChapPlusBtn = document.getElementById('quickChapPlusBtn');
const quickToggleReadBtn = document.getElementById('quickToggleReadBtn');
const quickReadBtnText = document.getElementById('quickReadBtnText');
const quickOpenShelfBtn = document.getElementById('quickOpenShelfBtn');
const quickOpenFullEditBtn = document.getElementById('quickOpenFullEditBtn');
const quickDeleteBtn = document.getElementById('quickDeleteBtn');

// Modale Scaffale 3D
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

// Modale Scanner Rapido 1-Tap & Pulsante Mobile Centrale
const mobileCenterScanBtn = document.getElementById('mobileCenterScanBtn');
const openCheckerScanBtn = document.getElementById('openCheckerScanBtn');
const closeCheckerModalBtn = document.getElementById('closeCheckerModalBtn');
const checkerEditDetailsBtn = document.getElementById('checkerEditDetailsBtn');
const checkerManualDetailsPanel = document.getElementById('checkerManualDetailsPanel');

// Scanner Form Singolo
const startScanBtn = document.getElementById('startScanBtn');
const scannerContainer = document.getElementById('scannerContainer');
const closeScannerBtn = document.getElementById('closeScannerBtn');
const scannerStatus = document.getElementById('scannerStatus');

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
  const btn = e.target.closest('.nav-item-btn');
  if (!btn || !btn.dataset.set) return;

  document.querySelectorAll('#setTabs .nav-item-btn').forEach(b => {
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
// LAYOUT AGGREGATO POSSEDUTI (CON RANGE REALE DI TUTTI I VOLUMI)
// ----------------------------------------------------
function formatVolumeSequence(numbersArray) {
  if (numbersArray.length === 0) return 'Nessuno';
  const nums = [...numbersArray].sort((a, b) => a - b);

  if (nums.length === 1) return `#${nums[0]}`;

  const isContinuous = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
  if (isContinuous) {
    return `#${nums[0]} - #${nums[nums.length - 1]}`;
  }

  return nums.map(n => `#${n}`).join(', ');
}

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

    const highestVolItem = regularVols.length > 0 ? regularVols[regularVols.length - 1] : vols[0];
    const missingGaps = calculateMissingGaps(regularVols);

    const validNumbers = regularVols
      .map(v => parseInt(v.number, 10))
      .filter(n => !isNaN(n));

    aggregatedSeriesList.push({
      representativeItem: highestVolItem,
      allVolumes: vols,
      regularVolumes: regularVols,
      regularCount: regularVols.length,
      variantCount: variantVols.length,
      missingGaps: missingGaps,
      maxNumber: highestVolItem.number || '1',
      ownedNumbers: validNumbers,
      formattedSequence: formatVolumeSequence(validNumbers)
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

// ----------------------------------------------------
// CARD POSSEDUTI: MOSTRA TUTTI I VOLUMI + TASTO RAPIDO (+1)
// ----------------------------------------------------
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
    ? `<span class="gap-badge" title="Mancano volumi nella sequenza">⚠️ Mancano ${series.missingGaps.length}</span>` 
    : '';

  const variantBadgeHtml = series.variantCount > 0 
    ? `<span class="foil-sparkle-badge">★ ${series.variantCount}</span>` 
    : '';

  const completedHtml = item.completed ? `<span class="completed-badge">Fine</span>` : '';
  const readBadgeClass = item.isRead ? '' : 'is-unread';
  const readHtml = `<span class="read-badge ${readBadgeClass}">${item.isRead ? 'Letto' : 'In corso'}</span>`;

  const readingSubtitle = item.readingChapter 
    ? `· Cap. <span class="reading-pill-highlight">${escapeHtml(item.readingChapter)}</span>` 
    : '';

  card.innerHTML = `
    <div class="card-left-section">
      <div class="item-main-details">
        <div class="item-tags-row">
          <span class="item-tag-inline" style="color: ${catColor};">${catName}</span>
          ${completedHtml}
          ${readHtml}
          ${variantBadgeHtml}
        </div>
        <span class="item-name">${escapeHtml(item.title)}</span>
        <div class="item-meta-subtitle">
          <span>Volumi: <strong style="color: var(--text-primary);">${escapeHtml(series.formattedSequence)}</strong> (${series.regularCount} vol.)</span>
          ${readingSubtitle}
        </div>
      </div>
    </div>

    <div class="card-right-section">
      ${gapBadgeHtml}
      <button type="button" class="quick-plus-btn" title="Aggiungi rapidamente il volume successivo">+1</button>
      <span class="item-num">#${escapeHtml(series.maxNumber)}</span>
    </div>
  `;

  // Tasto rapido +1: crea istantaneamente il volume successivo
  const plusBtn = card.querySelector('.quick-plus-btn');
  plusBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await createDirectNextOwnedVolume(series);
  });

  // Tocco su tutta la card: apre la scheda rapida
  card.addEventListener('click', () => {
    openQuickActionSheet(series);
  });

  return card;
}

// Creazione istantanea del volume successivo per Posseduti (+1)
async function createDirectNextOwnedVolume(series) {
  const currentMax = parseInt(series.maxNumber, 10);
  const nextNumber = isNaN(currentMax) ? 1 : currentMax + 1;
  const item = series.representativeItem;

  const newItem = {
    id: generateUniqueId(),
    title: item.title,
    set: 'Posseduti',
    category: item.category || 'Generale',
    date: null,
    number: String(nextNumber),
    isbn: null,
    rating: null,
    unplayed: false,
    purchased: true,
    completed: false,
    isRead: false,
    isVariant: false,
    missingGapNotice: null,
    readingChapter: item.readingChapter || '',
    privateComment: '',
    createdAt: new Date().toISOString()
  };

  appData.items.unshift(newItem);
  pushHistoryAction({ type: 'INSERT', data: { ...newItem } });
  saveData();
  await syncItemToSupabase(newItem, saveData);
  ensureItemInVoti(newItem.title, newItem.category);

  renderList();
  showToastNotice(`Aggiunto "${newItem.title} #${nextNumber}" a Posseduti!`);
}

// ----------------------------------------------------
// CARD ACQUISTI, VOTI E LISTE
// ----------------------------------------------------
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
      <button type="button" class="check-btn ${item.purchased ? 'checked' : ''}" aria-label="${item.purchased ? 'Segna da comprare' : 'Segna come acquistato'}">
        <div class="custom-checkbox">
          <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
            <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>
          </svg>
        </div>
      </button>
    `;
  }

  let dateBadgeHtml = '';
  if (item.set === 'Acquisti' && item.date) {
    const badgeClass = dateInfo.badgeType === 'today' ? 'badge-today' :
                       dateInfo.badgeType === 'yesterday' ? 'badge-yesterday' :
                       dateInfo.badgeType === 'countdown' ? 'badge-countdown' : '';
    dateBadgeHtml = `<span class="date-badge ${badgeClass}">${escapeHtml(dateInfo.badgeText)}</span>`;
  }

  let plusNextHtml = '';
  if (item.set === 'Acquisti' && item.number && !isNaN(parseInt(item.number, 10)) && !item.completed) {
    plusNextHtml = `<button type="button" class="quick-plus-btn" title="Aggiungi il volume successivo">+1</button>`;
  }

  let mainValueHtml = '';
  if (item.number) {
    mainValueHtml = `<span class="item-num">#${escapeHtml(item.number)}</span>`;
  }

  if (item.set === 'Voti') {
    if (item.unplayed) {
      mainValueHtml = `
        <span class="unplayed-badge">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
            <path d="M6 2v6h.01L6 8.01 10 12l-4 4 .01.01H6V22h12v-5.99h-.01L18 16l-4-4 4-3.99-.01-.01H18V2H6zm10 14.5V20H8v-3.5l4-4 4 4zm-4-5l-4-4V4h8v3.5l-4 4z"/>
          </svg>
          Da iniziare
        </span>
      `;
    } else if (item.rating !== null && item.rating !== undefined) {
      const scoreClass = getScoreBadgeClass(item.rating);
      const medalHtml = medalIcon ? `<span>${medalIcon}</span> ` : '';
      mainValueHtml = `${medalHtml}<span class="score-badge-100 ${scoreClass}">${item.rating}/100</span>`;
    }
  }

  const completedHtml = item.completed ? `<span class="completed-badge">Fine</span>` : '';
  const foilBadgeHtml = isVariant ? `<span class="foil-sparkle-badge">★ Variant</span>` : '';

  card.innerHTML = `
    <div class="card-left-section">
      ${checkHtml}
      <div class="item-main-details">
        <div class="item-tags-row">
          <span class="item-tag-inline" style="color: ${catColor};">${catName}</span>
          ${completedHtml}
          ${foilBadgeHtml}
        </div>
        <span class="item-name">${escapeHtml(item.title)}</span>
      </div>
    </div>

    <div class="card-right-section">
      ${dateBadgeHtml}
      ${plusNextHtml}
      ${mainValueHtml}
    </div>
  `;

  if (item.set === 'Acquisti') {
    card.querySelector('.check-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const prev = { ...item };
      item.purchased = !item.purchased;

      pushHistoryAction({ type: 'UPDATE', prev: prev, next: { ...item } });
      saveData();
      syncItemToSupabase(item, saveData);

      if (item.purchased) {
        syncPurchasedWithPosseduti(item);
      } else {
        rollbackPurchasedFromPosseduti(item);
      }

      renderList();
    });

    const plusBtn = card.querySelector('.quick-plus-btn');
    if (plusBtn) {
      plusBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const nextNum = (parseInt(item.number, 10) || 0) + 1;
        const newItem = {
          id: generateUniqueId(),
          title: item.title,
          set: 'Acquisti',
          category: item.category || 'Generale',
          date: null,
          number: String(nextNum),
          isbn: null,
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
        await syncItemToSupabase(newItem, saveData);
        renderList();
        showToastNotice(`"${newItem.title} #${nextNum}" aggiunto agli Acquisti!`);
      });
    }
  }

  card.addEventListener('click', (e) => {
    if (e.target.closest('.check-btn') || e.target.closest('.quick-plus-btn')) return;
    openEditModal(item);
  });

  return card;
}

// ----------------------------------------------------
// GESTIONE ACTION SHEET RAPIDA 1-TAP (POSSEDUTI)
// ----------------------------------------------------
function openQuickActionSheet(series) {
  currentActiveSeries = series;
  const item = series.representativeItem;

  quickSheetTitle.textContent = item.title;
  quickSheetCategoryTag.textContent = item.category || 'Generale';
  quickSheetCategoryTag.style.color = getCategoryColor(item.category || 'Generale');

  quickVolValue.textContent = `#${series.maxNumber}`;
  quickChapValue.textContent = item.readingChapter || '0';
  quickReadBtnText.textContent = item.isRead ? 'Segna da Leggere' : 'Segna come Letto';

  quickActionModalBackdrop.classList.add('active');
}

function closeQuickActionSheet() {
  quickActionModalBackdrop.classList.remove('active');
  currentActiveSeries = null;
}

if (closeQuickSheetBtn) closeQuickSheetBtn.addEventListener('click', closeQuickActionSheet);
if (quickActionModalBackdrop) {
  quickActionModalBackdrop.addEventListener('click', (e) => {
    if (e.target === quickActionModalBackdrop) closeQuickActionSheet();
  });
}

if (quickVolPlusBtn) {
  quickVolPlusBtn.addEventListener('click', async () => {
    if (!currentActiveSeries) return;
    const item = currentActiveSeries.representativeItem;
    await updateVolumeStep(item.id, 1);
    quickVolValue.textContent = `#${item.number}`;
  });
}

if (quickVolMinusBtn) {
  quickVolMinusBtn.addEventListener('click', async () => {
    if (!currentActiveSeries) return;
    const item = currentActiveSeries.representativeItem;
    await updateVolumeStep(item.id, -1);
    quickVolValue.textContent = `#${item.number}`;
  });
}

if (quickChapPlusBtn) {
  quickChapPlusBtn.addEventListener('click', async () => {
    if (!currentActiveSeries) return;
    const item = currentActiveSeries.representativeItem;
    await updateChapterStep(item.id, 1);
    quickChapValue.textContent = item.readingChapter || '0';
  });
}

if (quickChapMinusBtn) {
  quickChapMinusBtn.addEventListener('click', async () => {
    if (!currentActiveSeries) return;
    const item = currentActiveSeries.representativeItem;
    await updateChapterStep(item.id, -1);
    quickChapValue.textContent = item.readingChapter || '0';
  });
}

if (quickToggleReadBtn) {
  quickToggleReadBtn.addEventListener('click', async () => {
    if (!currentActiveSeries) return;
    const item = currentActiveSeries.representativeItem;
    await toggleReadStatus(item.id);
    quickReadBtnText.textContent = item.isRead ? 'Segna da Leggere' : 'Segna come Letto';
  });
}

if (quickOpenShelfBtn) {
  quickOpenShelfBtn.addEventListener('click', () => {
    if (!currentActiveSeries) return;
    const title = currentActiveSeries.representativeItem.title;
    const cat = currentActiveSeries.representativeItem.category;
    closeQuickActionSheet();
    openMangaShelf3D(title, cat);
  });
}

if (quickOpenFullEditBtn) {
  quickOpenFullEditBtn.addEventListener('click', () => {
    if (!currentActiveSeries) return;
    const item = currentActiveSeries.representativeItem;
    closeQuickActionSheet();
    openEditModal(item);
  });
}

if (quickDeleteBtn) {
  quickDeleteBtn.addEventListener('click', () => {
    if (!currentActiveSeries) return;
    const s = currentActiveSeries;
    closeQuickActionSheet();
    handleDeletePossedutiPrompt(s);
  });
}

async function handleDeletePossedutiPrompt(series) {
  const title = series.representativeItem.title;
  const count = series.allVolumes.length;

  if (count <= 1) {
    if (confirm(`Vuoi eliminare definitivamente "${title}" dalla collezione?`)) {
      deleteItemWithUndo(series.representativeItem);
    }
    return;
  }

  const choice = prompt(
    `Gestione eliminazione per "${title}":\n` +
    `1. Elimina SOLO l'ultimo volume (#${series.maxNumber})\n` +
    `2. Elimina TUTTI i ${count} volumi della serie\n\n` +
    `Digita 1 o 2 (oppure Annulla):`
  );

  if (choice === '1') {
    deleteItemWithUndo(series.representativeItem);
  } else if (choice === '2') {
    if (confirm(`Confermi di voler cancellare TUTTI i ${count} volumi di "${title}"?`)) {
      pushHistoryAction({ type: 'DELETE', data: [...series.allVolumes] });
      const idsToDelete = series.allVolumes.map(v => v.id);
      appData.items = appData.items.filter(i => !idsToDelete.includes(i.id));
      saveData();
      for (const id of idsToDelete) await deleteItemFromSupabase(id);
      renderList();
      showToastNotice(`Cancellata l'intera serie "${title}"`);
    }
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
    isbn: purchasedItem.isbn || null,
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
  syncItemToSupabase(newItem, saveData);

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

  saveData();
  await syncItemToSupabase(item, saveData);
  renderList();
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
  await syncItemToSupabase(item, saveData);
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
  await syncItemToSupabase(item, saveData);
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

// ----------------------------------------------------
// SCAFFALE COSTE 3D
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
        openEditModal(ownedItem);
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
            isbn: null,
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
          syncItemToSupabase(newItem, saveData);
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
        openEditModal(vItem);
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
// SCANNER RAPIDO CONTINUO
// ----------------------------------------------------
function handleFastScanAction(actionType, payload) {
  const targetSetSelect = document.getElementById('scannerTargetSetPreset');
  const targetSet = targetSetSelect ? targetSetSelect.value : 'Posseduti';

  const customTitle = document.getElementById('scannerCustomTitle');
  const customVol = document.getElementById('scannerCustomVol');
  const customCat = document.getElementById('scannerCustomCat');
  const customVariant = document.getElementById('scannerCustomVariant');

  if (actionType === 'BUY_EXISTING') {
    const prev = { ...payload };
    payload.purchased = true;
    pushHistoryAction({ type: 'UPDATE', prev: prev, next: { ...payload } });
    saveData();
    syncItemToSupabase(payload, saveData);
    syncPurchasedWithPosseduti(payload);
    renderList();
    showToastNotice(`"${payload.title} #${payload.number}" acquistato e spostato in Posseduti!`);
    resetCheckerPreview();
  } else if (actionType === 'ADD_NEW') {
    const finalTitle = (customTitle && customTitle.value.trim()) ? customTitle.value.trim() : payload.title;
    const finalVol = (customVol && customVol.value.trim()) ? customVol.value.trim() : payload.number;
    const finalCat = (customCat && customCat.value) ? customCat.value : payload.category;
    const finalVariant = customVariant ? customVariant.checked : Boolean(payload.isVariant);

    const newItem = {
      id: generateUniqueId(),
      title: finalTitle,
      set: targetSet,
      category: finalCat || 'Generale',
      date: null,
      number: finalVol || '1',
      isbn: payload.isbn || null,
      rating: null,
      unplayed: false,
      purchased: targetSet === 'Posseduti',
      completed: false,
      isRead: false,
      isVariant: finalVariant,
      missingGapNotice: null,
      readingChapter: '',
      privateComment: '',
      createdAt: new Date().toISOString()
    };

    appData.items.unshift(newItem);
    pushHistoryAction({ type: 'INSERT', data: { ...newItem } });
    saveData();
    syncItemToSupabase(newItem, saveData);

    if (targetSet === 'Posseduti' && !finalVariant) {
      ensureItemInVoti(newItem.title, newItem.category);
    }

    renderList();
    showToastNotice(`"${newItem.title} #${newItem.number}" aggiunto a ${targetSet}!`);
    resetCheckerPreview();
  }
}

function populateScannerCategories() {
  const customCat = document.getElementById('scannerCustomCat');
  if (!customCat) return;
  customCat.innerHTML = '';
  appData.categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    customCat.appendChild(opt);
  });
}

function triggerFastScanner() {
  populateScannerCategories();
  const targetSetSelect = document.getElementById('scannerTargetSetPreset');
  if (targetSetSelect) {
    targetSetSelect.value = (activeSet === 'Acquisti' || activeSet === 'Posseduti') ? activeSet : 'Posseduti';
  }
  openCheckerModal(appData, activeCategory, handleFastScanAction);
}

// Collegamento tasti scanner (Centrale mobile + Top desktop)
if (mobileCenterScanBtn) mobileCenterScanBtn.addEventListener('click', triggerFastScanner);
if (openCheckerScanBtn) openCheckerScanBtn.addEventListener('click', triggerFastScanner);
if (closeCheckerModalBtn) closeCheckerModalBtn.addEventListener('click', stopCheckerModal);

if (checkerEditDetailsBtn && checkerManualDetailsPanel) {
  checkerEditDetailsBtn.addEventListener('click', () => {
    const isHidden = checkerManualDetailsPanel.style.display === 'none';
    checkerManualDetailsPanel.style.display = isHidden ? 'flex' : 'none';
    checkerEditDetailsBtn.textContent = isHidden ? 'Nascondi Dettagli' : 'Modifica Dettagli';
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
      syncItemToSupabase(deletedItemBuffer, saveData);
      renderList();
      deletedItemBuffer = null;
      undoToast.classList.remove('show');
      if (undoTimeoutId) clearTimeout(undoTimeoutId);
    }
  });
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

  if (initialTitle) itemTitle.value = initialTitle;

  modalBackdrop.classList.add('active');
  itemTitle.focus();
}

function openEditModal(item) {
  modalTitle.textContent = 'Modifica Elemento';
  editItemId.value = item.id;
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
  const isVariantChecked = itemVariantCheckbox ? itemVariantCheckbox.checked : false;
  const isReadChecked = itemReadCheckbox ? itemReadCheckbox.checked : false;

  const numInTitleMatch = title.match(/^(.*?)\s+#?(\d+)$/);
  if (numInTitleMatch && itemNumber.value === numInTitleMatch[2] && (set === 'Acquisti' || set === 'Posseduti' || set === 'Liste')) {
    title = numInTitleMatch[1];
  }

  const number = (set === 'Acquisti' || set === 'Posseduti' || set === 'Liste') ? (itemNumber.value.trim() || null) : null;

  if (!idToEdit && typedCat) {
    category = typedCat;
    if (!appData.categories.includes(category)) {
      appData.categories.push(category);
      syncCategoriesToSupabase(appData.categories);
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
      isbn: null,
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
  if (finalItem) syncItemToSupabase(finalItem, saveData);
  closeModal();
  updateCategoryDropdown();

  if (activeSet !== set) {
    activeSet = set;
    localStorage.setItem('pref_set', activeSet);
    document.querySelectorAll('#setTabs .nav-item-btn').forEach(b => {
      const isSelected = b.dataset.set === set;
      b.classList.toggle('active', isSelected);
      b.setAttribute('aria-selected', String(isSelected));
    });
    sortIndicatorText.textContent = SORT_LABELS[getCurrentSortMode()] || 'Per Data';
    updateFilterBarChips();
  }

  renderList();
});

// Modale Batch (Blocco Volumi)
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

    if (!title) return;
    if (isNaN(start) || isNaN(end) || start > end) {
      alert('Intervallo non valido: il volume iniziale deve essere minore o uguale al volume finale.');
      return;
    }

    const createdItems = [];
    for (let v = start; v <= end; v++) {
      createdItems.push({
        id: generateUniqueId(),
        title,
        set,
        category: cat,
        date: null,
        number: String(v),
        isbn: null,
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

    appData.items.unshift(...createdItems);
    pushHistoryAction({ type: 'INSERT', data: createdItems.map(i => ({ ...i })) });
    saveData();
    closeBatchModal();

    await syncBatchItemsToSupabase(createdItems);

    if (set === 'Posseduti') {
      ensureItemInVoti(title, cat);
    }

    showToastNotice(`Aggiunti ${createdItems.length} volumi di "${title}"!`);
    renderList();
  });
}

// Storico Modale
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

const closeFullHistoryModalBtn = document.getElementById('closeFullHistoryModalBtn');
const fullHistoryModalBackdrop = document.getElementById('fullHistoryModalBackdrop');

if (closeFullHistoryModalBtn && fullHistoryModalBackdrop) {
  closeFullHistoryModalBtn.addEventListener('click', () => {
    fullHistoryModalBackdrop.classList.remove('active');
  });
  fullHistoryModalBackdrop.addEventListener('click', (e) => {
    if (e.target === fullHistoryModalBackdrop) fullHistoryModalBackdrop.classList.remove('active');
  });
}

// Statistiche
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
            syncItemToSupabase(i, saveData);
          }
        });
        if (activeCategory === cat) activeCategory = cleanName;

        saveData();
        syncCategoriesToSupabase(appData.categories);
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
              syncItemToSupabase(i, saveData);
            }
          });
          if (activeCategory === cat) activeCategory = 'Generale';

          saveData();
          syncCategoriesToSupabase(appData.categories);
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
  syncCategoriesToSupabase(appData.categories);
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
      isbn: item.isbn || null,
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
  reader.onload = async (event) => {
    try {
      const importedData = JSON.parse(event.target.result);

      const itemsList = Array.isArray(importedData)
        ? importedData
        : (importedData && Array.isArray(importedData.items) ? importedData.items : null);

      if (!itemsList) {
        alert('Formato file non valido.');
        return;
      }

      if (importedData && Array.isArray(importedData.categoriesList)) {
        importedData.categoriesList.forEach(cat => {
          if (cat && !appData.categories.includes(cat)) {
            appData.categories.push(cat);
          }
        });
        syncCategoriesToSupabase(appData.categories);
      }

      let importedCount = 0;
      let skippedCount = 0;
      const newlyImported = [];

      for (const incoming of itemsList) {
        if (!incoming) continue;

        const title = (incoming.title || incoming.name || 'Senza Titolo').toString().trim();
        const target = incoming.targetSet || incoming.set || incoming.section || 'Acquisti';
        const category = (incoming.category || 'Generale').toString().trim();
        
        const incomingNumber = incoming.number !== undefined && incoming.number !== null 
          ? String(incoming.number).trim() 
          : (incoming.volume !== undefined && incoming.volume !== null ? String(incoming.volume).trim() : null);

        const incomingIsVariant = Boolean(
          incoming.isVariant || 
          incoming.is_variant || 
          (incomingNumber && incomingNumber.toLowerCase().includes('variant'))
        );

        if (!appData.categories.includes(category)) {
          appData.categories.push(category);
        }

        const isDuplicateGlobally = appData.items.some(existing => 
          existing.title.toLowerCase() === title.toLowerCase() &&
          (existing.set === 'Voti' || existing.set === 'Liste') &&
          (target === 'Voti' || target === 'Liste')
        );

        const isDuplicateInSameSet = appData.items.some(existing => 
          existing.title.toLowerCase() === title.toLowerCase() &&
          existing.set === target &&
          String(existing.number || '') === String(incomingNumber || '') &&
          !incomingIsVariant &&
          !existing.isVariant
        );

        if (isDuplicateGlobally || isDuplicateInSameSet) {
          skippedCount++;
          continue;
        }

        let incomingRating = null;
        if (incoming.rating !== undefined && incoming.rating !== null && incoming.rating !== '') {
          const num = Number(incoming.rating);
          if (!isNaN(num)) {
            incomingRating = num <= 5 ? num * 20 : Math.min(100, Math.max(0, num));
          }
        }

        const newItem = {
          id: generateUniqueId(),
          title: title,
          set: target,
          category: category,
          date: incoming.date || null,
          number: incomingNumber,
          isbn: incoming.isbn || null,
          completed: Boolean(incoming.completed),
          isRead: Boolean(incoming.isRead || incoming.is_read),
          rating: incomingRating,
          unplayed: Boolean(incoming.unplayed),
          isVariant: incomingIsVariant,
          purchased: Boolean(incoming.purchased),
          missingGapNotice: incoming.missingGapNotice || incoming.missing_gap_notice || null,
          readingChapter: incoming.readingChapter || incoming.reading_chapter || incoming.current_chapter || '',
          privateComment: incoming.privateComment || incoming.private_comment || incoming.notes || '',
          createdAt: incoming.createdAt || incoming.created_at || new Date().toISOString()
        };

        appData.items.unshift(newItem);
        newlyImported.push(newItem);
        await syncItemToSupabase(newItem, saveData);

        if (target === 'Posseduti' && !incomingIsVariant) {
          ensureItemInVoti(newItem.title, newItem.category);
        }

        importedCount++;
      }

      if (newlyImported.length > 0) {
        pushHistoryAction({ type: 'INSERT', data: newlyImported.map(i => ({ ...i })) });
      }

      saveData();
      updateCategoryDropdown();
      renderList();
      closeSettingsModal();
      importJsonFileInput.value = '';

      showToastNotice(`Importati ${importedCount} elementi (Saltati: ${skippedCount})`);
    } catch (err) {
      console.error("Errore import JSON:", err);
      alert('Errore durante la lettura del file: sintassi JSON non valida.');
    }
  };

  reader.readAsText(file);
});

// Reset di Fabbrica
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

// Tastiera
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
      closeQuickActionSheet();
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
    closeQuickActionSheet();
    closeSettingsModal();
    if (statsModalBackdrop) statsModalBackdrop.classList.remove('active');
    if (fullHistoryModalBackdrop) fullHistoryModalBackdrop.classList.remove('active');
  }
});

// Auth & Supabase Realtime
const authOverlay = document.getElementById('authOverlay');
const appContent = document.getElementById('appContent');
const accountUserEmail = document.getElementById('accountUserEmail');
const currentAccountDisplay = document.getElementById('currentAccountDisplay');
const loginForm = document.getElementById('loginForm');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const loginSubmitBtn = document.getElementById('loginSubmitBtn');
const authErrorMsg = document.getElementById('authErrorMsg');
const logoutBtn = document.getElementById('logoutBtn');

const moreActionsBtn = document.getElementById('moreActionsBtn');
const moreDropdownMenu = document.getElementById('moreDropdownMenu');

if (moreActionsBtn && moreDropdownMenu) {
  moreActionsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    moreDropdownMenu.classList.toggle('open');
  });

  document.addEventListener('click', () => {
    moreDropdownMenu.classList.remove('open');
  });
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
    console.error('Errore recupero dati Supabase:', err);
    setCloudStatus('error');
  }
}

function handleAuthSuccess(user) {
  if (authOverlay) authOverlay.style.display = 'none';
  if (appContent) appContent.style.display = 'flex';
  if (openModalBtn) openModalBtn.style.display = 'flex';

  if (accountUserEmail) accountUserEmail.textContent = user.email;
  if (currentAccountDisplay) currentAccountDisplay.textContent = user.email;

  fetchDataFromSupabase();
  setupRealtimeSubscriptions(appData, {
    onDataChange: () => {
      saveData();
      renderList();
    }
  });
  checkAndTriggerTodayNotifications();
}

function handleAuthLogout() {
  if (authOverlay) authOverlay.style.display = 'flex';
  if (appContent) appContent.style.display = 'none';
  if (openModalBtn) openModalBtn.style.display = 'none';
  setCloudStatus('offline');
}

if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginSubmitBtn.disabled = true;
    loginSubmitBtn.textContent = 'Verifica in corso...';
    if (authErrorMsg) authErrorMsg.style.display = 'none';

    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: loginEmail.value.trim(),
        password: loginPassword.value
      });
      if (error) throw error;
      loginForm.reset();
      handleAuthSuccess(data.user);
    } catch (err) {
      if (authErrorMsg) {
        authErrorMsg.textContent = err.message || 'Credenziali non valide.';
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

const historyMenuBtn = document.getElementById('historyDropdownBtn');
if (historyMenuBtn) {
  historyMenuBtn.addEventListener('click', () => {
    if (moreDropdownMenu) moreDropdownMenu.classList.remove('open');
    openFullHistoryModal();
  });
}

function initApp() {
  document.querySelectorAll('#setTabs .nav-item-btn').forEach(b => {
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

initApp();
initAuth({
  onAuthSuccess: handleAuthSuccess,
  onAuthLogout: handleAuthLogout
});
