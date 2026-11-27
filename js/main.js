// js/main.js
import {
  supabaseClient,
  currentUser,
  initAuth,
  setCloudStatus,
  syncItemToSupabase,
  deleteItemFromSupabase,
  setupRealtimeSubscriptions,
  formatRowToItem
} from './supabase.js';

import {
  openCheckerModal,
  stopCheckerModal,
  resetCheckerPreview,
  escapeHtml,
  getLastScanCategory,
  setLastScanCategory
} from './scanner.js';

import {
  getCategoryColor,
  getTodayString,
  getDateStatus,
  getMonthYearTitle,
  getScoreBadgeClass,
  calculateMissingGaps,
  cleanVolumeNumber,
  formatDisplayTitle
} from './ui.js';

import {
  appData,
  state,
  saveData,
  pushHistoryAction,
  generateUniqueId,
  ensureItemInVoti,
  getCurrentSortMode,
  setCurrentSortMode,
  executeUndo,
  executeRedo,
  SORT_LABELS
} from './state.js';

import {
  initShelfModule,
  openMangaShelf3D
} from './shelf.js';

import {
  initModals,
  openCreateModal,
  openCreateModalWithTitle,
  openEditModal,
  openQuickActionSheet,
  closeQuickActionSheet,
  closeModal,
  closeBatchModal,
  openBatchModal,
  openStatsModal,
  openFullHistoryModal,
  openSettingsModal,
  closeSettingsModal,
  handleDeletePossedutiPrompt
} from './modals.js';

// Icona SVG Vettoriale Cestino
const TRASH_SVG = `
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    <line x1="10" y1="11" x2="10" y2="17"></line>
    <line x1="14" y1="11" x2="14" y2="17"></line>
  </svg>
`;

// Registrazione PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('Service Worker non registrato:', err);
    });
  });
}

// ELEMENTI DOM PRINCIPALI
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

const mobileCenterScanBtn = document.getElementById('mobileCenterScanBtn');
const closeCheckerModalBtn = document.getElementById('closeCheckerModalBtn');
const checkerEditDetailsBtn = document.getElementById('checkerEditDetailsBtn');
const checkerManualDetailsPanel = document.getElementById('checkerManualDetailsPanel');
const scannerVariantGroupWrapper = document.getElementById('scannerVariantGroupWrapper');

const notificationsToggleCheckbox = document.getElementById('notificationsToggleCheckbox');
const moreActionsBtn = document.getElementById('moreActionsBtn');
const moreDropdownMenu = document.getElementById('moreDropdownMenu');
const historyMenuBtn = document.getElementById('historyDropdownBtn');

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

if (toggleSidebarBtn && twitchSidebar) {
  toggleSidebarBtn.addEventListener('click', () => {
    twitchSidebar.classList.toggle('collapsed');
  });
}

// NAVIGAZIONE E FILTRI
export function updateCategoryDropdown() {
  const previous = state.activeCategory;
  categoryFilter.innerHTML = '<option value="Tutte">Tutte le Categorie</option>';

  appData.categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    if (cat === previous) opt.selected = true;
    categoryFilter.appendChild(opt);
  });

  if (!appData.categories.includes(state.activeCategory) && state.activeCategory !== 'Tutte') {
    state.activeCategory = 'Generale';
    categoryFilter.value = 'Generale';
  }
}

categoryFilter.addEventListener('change', (e) => {
  state.activeCategory = e.target.value;
  localStorage.setItem('pref_category', state.activeCategory);
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
  state.activeSet = btn.dataset.set;
  localStorage.setItem('pref_set', state.activeSet);

  sortIndicatorText.textContent = SORT_LABELS[getCurrentSortMode()] || 'Per Data';
  updateFilterBarChips();
  renderList();
});

export function updateFilterBarChips() {
  if (state.activeSet === 'Acquisti') {
    timeFilterRow.style.display = 'flex';
    timeFilterRow.innerHTML = `
      <button class="time-chip ${state.activeTimeFilter === 'all' ? 'active' : ''}" data-filter="all" type="button">Tutti</button>
      <button class="time-chip ${state.activeTimeFilter === 'today' ? 'active' : ''}" data-filter="today" type="button">Oggi</button>
      <button class="time-chip ${state.activeTimeFilter === 'week' ? 'active' : ''}" data-filter="week" type="button">Questa Settimana</button>
      <button class="time-chip ${state.activeTimeFilter === 'month' ? 'active' : ''}" data-filter="month" type="button">Questo Mese</button>
      <button class="time-chip ${state.activeTimeFilter === 'nodate' ? 'active' : ''}" data-filter="nodate" type="button">Senza Data</button>
    `;
  } else if (state.activeSet === 'Posseduti') {
    timeFilterRow.style.display = 'flex';
    timeFilterRow.innerHTML = `
      <button class="time-chip ${state.activeTimeFilter === 'all' ? 'active' : ''}" data-filter="all" type="button">Tutti</button>
      <button class="time-chip ${state.activeTimeFilter === 'regular' ? 'active' : ''}" data-filter="regular" type="button">Regolari</button>
      <button class="time-chip ${state.activeTimeFilter === 'variant' ? 'active' : ''}" data-filter="variant" type="button">★ Solo Variant</button>
      <button class="time-chip ${state.activeTimeFilter === 'unread' ? 'active' : ''}" data-filter="unread" type="button">Da Leggere</button>
    `;
  } else if (state.activeSet === 'Voti') {
    timeFilterRow.style.display = 'flex';
    timeFilterRow.innerHTML = `
      <button class="time-chip ${state.activeTimeFilter === 'all' ? 'active' : ''}" data-filter="all" type="button">Tutti</button>
      <button class="time-chip ${state.activeTimeFilter === 'scored' ? 'active' : ''}" data-filter="scored" type="button">★ Valutati</button>
      <button class="time-chip ${state.activeTimeFilter === 'unplayed' ? 'active' : ''}" data-filter="unplayed" type="button">⏳ Da iniziare</button>
    `;
  } else if (state.activeSet === 'Liste') {
    timeFilterRow.style.display = 'flex';
    timeFilterRow.innerHTML = `
      <button class="time-chip ${state.activeTimeFilter === 'all' ? 'active' : ''}" data-filter="all" type="button">Tutti</button>
      <button class="time-chip ${state.activeTimeFilter === 'hasnum' ? 'active' : ''}" data-filter="hasnum" type="button">Con Volume #</button>
      <button class="time-chip ${state.activeTimeFilter === 'nonum' ? 'active' : ''}" data-filter="nonum" type="button">Generici</button>
    `;
  } else {
    timeFilterRow.style.display = 'none';
  }

  timeFilterRow.querySelectorAll('.time-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      timeFilterRow.querySelectorAll('.time-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.activeTimeFilter = chip.dataset.filter;
      localStorage.setItem('pref_time_filter', state.activeTimeFilter);
      renderList();
    });
  });
}

seriesSearchInput.addEventListener('input', (e) => {
  state.searchSeriesQuery = e.target.value.trim().toLowerCase();
  clearSearchBtn.style.display = state.searchSeriesQuery ? 'flex' : 'none';
  renderList();
});

clearSearchBtn.addEventListener('click', () => {
  seriesSearchInput.value = '';
  state.searchSeriesQuery = '';
  clearSearchBtn.style.display = 'none';
  renderList();
});

togglePurchasedBtn.addEventListener('click', () => {
  state.isPurchasedSectionOpen = !state.isPurchasedSectionOpen;
  localStorage.setItem('pref_purchased_open', state.isPurchasedSectionOpen);
  purchasedList.classList.toggle('open', state.isPurchasedSectionOpen);
  chevronIcon.classList.toggle('open', state.isPurchasedSectionOpen);
  togglePurchasedBtn.setAttribute('aria-expanded', String(state.isPurchasedSectionOpen));
});

function matchesActiveFilter(item) {
  if (state.activeTimeFilter === 'all') return true;

  if (state.activeSet === 'Acquisti') {
    if (state.activeTimeFilter === 'nodate') return !item.date;
    if (!item.date) return false;

    const todayStr = getTodayString();
    const [ty, tm, td] = todayStr.split('-').map(Number);
    const today = new Date(ty, tm - 1, td);
    today.setHours(0, 0, 0, 0);

    const [iy, im, id] = item.date.split('-').map(Number);
    const itemDateObj = new Date(iy, im - 1, id);
    itemDateObj.setHours(0, 0, 0, 0);

    if (state.activeTimeFilter === 'today') return item.date === todayStr;
    if (state.activeTimeFilter === 'month') return item.date.slice(0, 7) === todayStr.slice(0, 7);
    if (state.activeTimeFilter === 'week') {
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
  } else if (state.activeSet === 'Posseduti') {
    if (state.activeTimeFilter === 'variant') return Boolean(item.isVariant);
    if (state.activeTimeFilter === 'regular') return !item.isVariant;
    if (state.activeTimeFilter === 'unread') return !item.isRead;
  } else if (state.activeSet === 'Voti') {
    if (state.activeTimeFilter === 'unplayed') return item.unplayed === true;
    if (state.activeTimeFilter === 'scored') return item.unplayed !== true && item.rating !== null && item.rating !== undefined;
  } else if (state.activeSet === 'Liste') {
    const hasNum = cleanVolumeNumber(item.number) !== '';
    if (state.activeTimeFilter === 'hasnum') return hasNum;
    if (state.activeTimeFilter === 'nonum') return !hasNum;
  }

  return true;
}

function sortItems(itemsArray) {
  const currentSortMode = getCurrentSortMode();

  return [...itemsArray].sort((a, b) => {
    if (currentSortMode === 'name') {
      return a.title.localeCompare(b.title);
    } else if (currentSortMode === 'number') {
      if (state.activeSet === 'Voti') {
        const scoreA = (a.unplayed ? -1 : (a.rating || 0));
        const scoreB = (b.unplayed ? -1 : (b.rating || 0));
        return scoreB - scoreA;
      } else {
        const numA = parseInt(cleanVolumeNumber(a.number), 10) || 0;
        const numB = parseInt(cleanVolumeNumber(b.number), 10) || 0;
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

// RENDERING LISTE E CARDS
export function renderList() {
  contentList.innerHTML = '';
  purchasedList.innerHTML = '';

  let filtered = appData.items.filter(item => item.set === state.activeSet);

  if (state.activeCategory !== 'Tutte' && state.activeCategory !== 'Generale') {
    filtered = filtered.filter(item => item.category === state.activeCategory);
  }

  if (state.searchSeriesQuery) {
    filtered = filtered.filter(item => item.title.toLowerCase().includes(state.searchSeriesQuery));
  }

  if (state.activeSet === 'Acquisti') {
    renderPurchasesLayout(filtered);
  } else if (state.activeSet === 'Posseduti') {
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
    if (state.searchSeriesQuery) {
      contentList.innerHTML = `
        <div class="empty-state-box">
          <span>Nessun volume trovato per "${escapeHtml(state.searchSeriesQuery)}".</span>
          <button type="button" class="quick-add-search-btn" id="quickAddSearchedBtn">
            + Aggiungi "${escapeHtml(state.searchSeriesQuery)}" agli Acquisti
          </button>
        </div>
      `;
      document.getElementById('quickAddSearchedBtn').addEventListener('click', () => {
        openCreateModalWithTitle(state.searchSeriesQuery);
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

function formatVolumeSequence(numbersArray) {
  if (numbersArray.length === 0) return 'Volume Singolo';
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

  if (state.activeTimeFilter === 'variant') {
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

    regularVols.sort((a, b) => (parseInt(cleanVolumeNumber(a.number), 10) || 0) - (parseInt(cleanVolumeNumber(b.number), 10) || 0));

    const highestVolItem = regularVols.length > 0 ? regularVols[regularVols.length - 1] : vols[0];
    const missingGaps = calculateMissingGaps(regularVols);

    const validNumbers = [...new Set(
      regularVols
        .map(v => parseInt(cleanVolumeNumber(v.number), 10))
        .filter(n => !isNaN(n) && n > 0)
    )].sort((a, b) => a - b);

    const maxNumClean = cleanVolumeNumber(highestVolItem.number);

    aggregatedSeriesList.push({
      representativeItem: highestVolItem,
      allVolumes: vols,
      regularVolumes: regularVols,
      regularCount: regularVols.length,
      variantCount: variantVols.length,
      missingGaps: missingGaps,
      maxNumber: maxNumClean,
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

  const displayNumHtml = series.maxNumber ? `<span class="item-num">#${escapeHtml(series.maxNumber)}</span>` : '';

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
      ${series.maxNumber ? `<button type="button" class="quick-plus-btn" title="Aggiungi rapidamente il volume successivo">+1</button>` : ''}
      ${displayNumHtml}
      <button type="button" class="icon-btn delete-card-btn" title="Elimina volume o serie" aria-label="Elimina">
        ${TRASH_SVG}
      </button>
    </div>
  `;

  const plusBtn = card.querySelector('.quick-plus-btn');
  if (plusBtn) {
    plusBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await createDirectNextOwnedVolume(series);
    });
  }

  const delBtn = card.querySelector('.delete-card-btn');
  if (delBtn) {
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleDeletePossedutiPrompt(series);
    });
  }

  card.addEventListener('click', () => {
    openQuickActionSheet(series);
  });

  return card;
}

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

function createItemCard(item, isCompact, medalIcon = null) {
  const card = document.createElement('div');
  card.dataset.id = item.id;
  const catName = escapeHtml(item.category || 'Generale');
  const catColor = getCategoryColor(item.category || 'Generale');
  const dateInfo = getDateStatus(item.date);

  const cleanNum = cleanVolumeNumber(item.number);
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
  if (item.set === 'Acquisti' && cleanNum && !isNaN(parseInt(cleanNum, 10)) && !item.completed) {
    plusNextHtml = `<button type="button" class="quick-plus-btn" title="Aggiungi il volume successivo">+1</button>`;
  }

  let mainValueHtml = '';
  if (cleanNum) {
    mainValueHtml = `<span class="item-num">#${escapeHtml(cleanNum)}</span>`;
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
      <button type="button" class="icon-btn delete-card-btn" title="Elimina volume" aria-label="Elimina volume">
        ${TRASH_SVG}
      </button>
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
        const nextNum = (parseInt(cleanNum, 10) || 0) + 1;
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

  const delBtn = card.querySelector('.delete-card-btn');
  if (delBtn) {
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const displayTitle = formatDisplayTitle(item);
      if (confirm(`Vuoi davvero eliminare "${displayTitle}"?`)) {
        deleteItemWithUndo(item);
      }
    });
  }

  card.addEventListener('click', (e) => {
    if (e.target.closest('.check-btn') || e.target.closest('.quick-plus-btn') || e.target.closest('.delete-card-btn')) return;
    openEditModal(item);
  });

  return card;
}

function renderStandardLayout(items) {
  const filtered = items.filter(matchesActiveFilter);

  if (filtered.length === 0) {
    contentList.innerHTML = `<div class="empty-state-box">Nessun elemento presente in "${state.activeSet}".</div>`;
    return;
  }

  const sorted = sortItems(filtered);

  sorted.forEach((item, index) => {
    let medal = null;
    if (state.activeSet === 'Voti' && !item.unplayed && item.rating !== null) {
      if (index === 0) medal = '🥇';
      else if (index === 1) medal = '🥈';
      else if (index === 2) medal = '🥉';
    }
    contentList.appendChild(createItemCard(item, false, medal));
  });
}

export function syncPurchasedWithPosseduti(purchasedItem) {
  const itemCategory = purchasedItem.category || 'Generale';
  const cleanNum = cleanVolumeNumber(purchasedItem.number);

  const newItem = {
    id: generateUniqueId(),
    title: purchasedItem.title,
    set: 'Posseduti',
    category: itemCategory,
    date: null,
    number: cleanNum,
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

  showToastNotice(`"${purchasedItem.title}" aggiunto in Posseduti ${cleanNum ? '(Vol. #' + cleanNum + ')' : ''}`);
  saveData();
}

export function rollbackPurchasedFromPosseduti(uncheckItem) {
  const titleClean = uncheckItem.title.trim().toLowerCase();
  const itemCategory = uncheckItem.category || 'Generale';
  const cleanNum = cleanVolumeNumber(uncheckItem.number);

  const existingPosseduto = appData.items.find(
    i => i.set === 'Posseduti' && 
         i.title.trim().toLowerCase() === titleClean &&
         (i.category || 'Generale') === itemCategory &&
         cleanVolumeNumber(i.number) === cleanNum
  );

  if (existingPosseduto) {
    appData.items = appData.items.filter(i => i.id !== existingPosseduto.id);
    deleteItemFromSupabase(existingPosseduto.id);
    showToastNotice(`"${uncheckItem.title}" rimosso da Posseduti`);
  }

  saveData();
}

// ELIMINA CON UNDO
export function deleteItemWithUndo(item) {
  pushHistoryAction({ type: 'DELETE', data: { ...item } });
  state.deletedItemBuffer = { ...item };
  appData.items = appData.items.filter(i => i.id !== item.id);
  saveData();
  deleteItemFromSupabase(item.id);
  renderList();

  undoBtn.style.display = 'inline-block';
  undoToastMsg.textContent = `"${item.title}" eliminato`;
  undoToast.classList.add('show');

  if (state.undoTimeoutId) clearTimeout(state.undoTimeoutId);
  state.undoTimeoutId = setTimeout(() => {
    undoToast.classList.remove('show');
    state.deletedItemBuffer = null;
  }, 5000);
}

if (undoBtn) {
  undoBtn.addEventListener('click', () => {
    if (state.deletedItemBuffer) {
      appData.items.unshift(state.deletedItemBuffer);
      saveData();
      syncItemToSupabase(state.deletedItemBuffer, saveData);
      renderList();
      state.deletedItemBuffer = null;
      undoToast.classList.remove('show');
      if (state.undoTimeoutId) clearTimeout(state.undoTimeoutId);
    }
  });
}

export function showToastNotice(message) {
  undoToastMsg.textContent = message;
  undoBtn.style.display = 'none';
  undoToast.classList.add('show');

  if (state.undoTimeoutId) clearTimeout(state.undoTimeoutId);
  state.undoTimeoutId = setTimeout(() => {
    undoToast.classList.remove('show');
    undoBtn.style.display = 'inline-block';
  }, 4500);
}

// SCANNER RAPIDO CONTINUO
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
    showToastNotice(`"${payload.title}" acquistato e spostato in Posseduti!`);
    resetCheckerPreview();
  } else if (actionType === 'ADD_NEW') {
    const finalTitle = (customTitle && customTitle.value.trim()) ? customTitle.value.trim() : payload.title;
    const finalVol = (customVol && customVol.value.trim()) ? cleanVolumeNumber(customVol.value.trim()) : cleanVolumeNumber(payload.number);
    const finalCat = (customCat && customCat.value) ? customCat.value : payload.category;

    setLastScanCategory(finalCat);

    const isComicOrManga = /manga|comic|fumett/i.test(finalCat);
    const finalVariant = (isComicOrManga && customVariant) ? customVariant.checked : Boolean(payload.isVariant);

    const newItem = {
      id: generateUniqueId(),
      title: finalTitle,
      set: targetSet,
      category: finalCat || 'Generale',
      date: null,
      number: finalVol,
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
    showToastNotice(`"${newItem.title}" aggiunto a ${targetSet}!`);
    resetCheckerPreview();
  }
}

function populateScannerCategories() {
  const customCat = document.getElementById('scannerCustomCat');
  if (!customCat) return;
  customCat.innerHTML = '';
  
  const rememberedCategory = getLastScanCategory(state.activeCategory !== 'Tutte' ? state.activeCategory : 'Manga');

  appData.categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    if (cat === rememberedCategory) opt.selected = true;
    customCat.appendChild(opt);
  });

  const isComicOrManga = /manga|comic|fumett/i.test(customCat.value);
  if (scannerVariantGroupWrapper) {
    scannerVariantGroupWrapper.style.display = isComicOrManga ? 'flex' : 'none';
  }

  customCat.addEventListener('change', (e) => {
    setLastScanCategory(e.target.value);
    const isManga = /manga|comic|fumett/i.test(e.target.value);
    if (scannerVariantGroupWrapper) {
      scannerVariantGroupWrapper.style.display = isManga ? 'flex' : 'none';
    }
  });
}

function triggerFastScanner() {
  populateScannerCategories();
  const targetSetSelect = document.getElementById('scannerTargetSetPreset');
  if (targetSetSelect) {
    targetSetSelect.value = (state.activeSet === 'Acquisti' || state.activeSet === 'Posseduti') ? state.activeSet : 'Posseduti';
  }
  openCheckerModal(appData, state.activeCategory, handleFastScanAction);
}

if (mobileCenterScanBtn) mobileCenterScanBtn.addEventListener('click', triggerFastScanner);
if (closeCheckerModalBtn) closeCheckerModalBtn.addEventListener('click', stopCheckerModal);

if (checkerEditDetailsBtn && checkerManualDetailsPanel) {
  checkerEditDetailsBtn.addEventListener('click', () => {
    const isHidden = checkerManualDetailsPanel.style.display === 'none';
    checkerManualDetailsPanel.style.display = isHidden ? 'flex' : 'none';
    checkerEditDetailsBtn.textContent = isHidden ? 'Nascondi Dettagli' : 'Modifica Dettagli';
  });
}

// NOTIFICHE
function checkAndTriggerTodayNotifications() {
  if (!state.notificationsEnabled) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const todayStr = getTodayString();
  const lastNotifiedDate = localStorage.getItem('last_notified_date');

  if (lastNotifiedDate === todayStr) return;

  const todayReleases = appData.items.filter(
    i => i.set === 'Acquisti' && !i.purchased && i.date === todayStr
  );

  if (todayReleases.length > 0) {
    const titleText = todayReleases.length === 1 
      ? `In uscita oggi: ${todayReleases[0].title} ${cleanVolumeNumber(todayReleases[0].number) ? '#' + cleanVolumeNumber(todayReleases[0].number) : ''}`
      : `Oggi ci sono ${todayReleases.length} uscite in fumetteria!`;

    const bodyText = todayReleases.map(i => `${i.title} ${cleanVolumeNumber(i.number) ? '#' + cleanVolumeNumber(i.number) : ''}`).join(', ');

    try {
      new Notification(titleText, {
        body: bodyText,
        icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'><rect width='192' height='192' rx='40' fill='%230d0e12'/><circle cx='96' cy='96' r='48' fill='%2338bdf8'/></svg>"
      });
      localStorage.setItem('last_notified_date', todayStr);
    } catch (e) {}
  }
}

if (notificationsToggleCheckbox) {
  notificationsToggleCheckbox.checked = state.notificationsEnabled;
  notificationsToggleCheckbox.addEventListener('change', async (e) => {
    if (e.target.checked) {
      if (!('Notification' in window)) {
        alert('Il tuo browser non supporta le notifiche native.');
        e.target.checked = false;
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        state.notificationsEnabled = true;
        localStorage.setItem('pref_notifications', 'true');
        showToastNotice('Notifiche native attivate!');
        checkAndTriggerTodayNotifications();
      } else {
        state.notificationsEnabled = false;
        localStorage.setItem('pref_notifications', 'false');
        e.target.checked = false;
        alert('Permesso per le notifiche negato nelle impostazioni.');
      }
    } else {
      state.notificationsEnabled = false;
      localStorage.setItem('pref_notifications', 'false');
      showToastNotice('Notifiche disattivate.');
    }
  });
}

// SCORCIATOIE TASTIERA
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    if (e.key === 'z' || e.key === 'Z') {
      if (e.shiftKey) {
        e.preventDefault();
        executeRedo(renderList, showToastNotice);
      } else {
        e.preventDefault();
        executeUndo(renderList, showToastNotice);
      }
      return;
    } else if (e.key === 'y' || e.key === 'Y') {
      e.preventDefault();
      executeRedo(renderList, showToastNotice);
      return;
    }
  }

  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    if (e.key === 'Escape') {
      document.activeElement.blur();
      closeModal();
      closeBatchModal();
      stopCheckerModal();
      closeQuickActionSheet();
      closeSettingsModal();
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
    closeQuickActionSheet();
    closeSettingsModal();
  }
});

// AUTH & REALTIME
if (moreActionsBtn && moreDropdownMenu) {
  moreActionsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    moreDropdownMenu.classList.toggle('open');
  });

  document.addEventListener('click', () => {
    moreDropdownMenu.classList.remove('open');
  });
}

if (historyMenuBtn) {
  historyMenuBtn.addEventListener('click', () => {
    if (moreDropdownMenu) moreDropdownMenu.classList.remove('open');
    openFullHistoryModal();
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
  const openModalBtn = document.getElementById('openModalBtn');
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
  const openModalBtn = document.getElementById('openModalBtn');
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

export function initApp() {
  document.querySelectorAll('#setTabs .nav-item-btn').forEach(b => {
    const isSelected = b.dataset.set === state.activeSet;
    b.classList.toggle('active', isSelected);
    b.setAttribute('aria-selected', String(isSelected));
  });

  updateFilterBarChips();
  sortIndicatorText.textContent = SORT_LABELS[getCurrentSortMode()] || 'Per Data';

  if (state.isPurchasedSectionOpen) {
    purchasedList.classList.add('open');
    chevronIcon.classList.add('open');
    togglePurchasedBtn.setAttribute('aria-expanded', 'true');
  }

  updateCategoryDropdown();
  renderList();
}

// INIZIALIZZAZIONE MODULI
initShelfModule({
  onEditItem: (item) => openEditModal(item),
  onDataChanged: () => renderList(),
  onToastNotice: (msg) => showToastNotice(msg)
});

initModals({
  renderList,
  showToastNotice,
  updateCategoryDropdown,
  updateFilterBarChips,
  deleteItemWithUndo,
  syncPurchasedWithPosseduti,
  rollbackPurchasedFromPosseduti,
  initApp
});

initApp();

initAuth({
  onAuthSuccess: handleAuthSuccess,
  onAuthLogout: handleAuthLogout
});
