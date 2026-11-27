// js/modals.js
import {
  appData,
  state,
  saveData,
  pushHistoryAction,
  generateUniqueId,
  ensureItemInVoti
} from './state.js';

import {
  syncItemToSupabase,
  syncBatchItemsToSupabase,
  deleteItemFromSupabase,
  syncCategoriesToSupabase,
  supabaseClient,
  currentUser
} from './supabase.js';

import {
  getCategoryColor,
  cleanVolumeNumber,
  formatDisplayTitle
} from './ui.js';

import {
  getLastScanCategory,
  setLastScanCategory,
  escapeHtml
} from './scanner.js';

import { openMangaShelf3D } from './shelf.js';

// SVG Cestino
const TRASH_SVG = `
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    <line x1="10" y1="11" x2="10" y2="17"></line>
    <line x1="14" y1="11" x2="14" y2="17"></line>
  </svg>
`;

let callbacks = {
  renderList: () => {},
  showToastNotice: () => {},
  updateCategoryDropdown: () => {},
  updateFilterBarChips: () => {},
  deleteItemWithUndo: () => {},
  syncPurchasedWithPosseduti: () => {},
  rollbackPurchasedFromPosseduti: () => {},
  initApp: () => {}
};

// ELEMENTI DOM
const modalBackdrop = document.getElementById('modalBackdrop');
const modalTitle = document.getElementById('modalTitle');
const closeModalBtn = document.getElementById('closeModalBtn');
const cancelBtn = document.getElementById('cancelBtn');
const openModalBtn = document.getElementById('openModalBtn');
const itemForm = document.getElementById('itemForm');
const editItemId = document.getElementById('editItemId');
const formDeleteBtn = document.getElementById('formDeleteBtn');
const itemTitle = document.getElementById('itemTitle');
const targetSet = document.getElementById('targetSet');
const categorySelect = document.getElementById('categorySelect');
const purchasesFields = document.getElementById('purchasesFields');
const dateGroupWrapper = document.getElementById('dateGroupWrapper');
const itemDate = document.getElementById('itemDate');
const itemNumber = document.getElementById('itemNumber');
const itemNumberLabel = document.getElementById('itemNumberLabel');
const variantGroupWrapper = document.getElementById('variantGroupWrapper');
const itemVariantCheckbox = document.getElementById('itemVariantCheckbox');
const completedGroupWrapper = document.getElementById('completedGroupWrapper');
const itemCompletedCheckbox = document.getElementById('itemCompletedCheckbox');
const itemReadCheckbox = document.getElementById('itemReadCheckbox');
const ratingInputGroup = document.getElementById('ratingInputGroup');
const itemScoreInput = document.getElementById('itemScoreInput');
const itemUnplayedCheckbox = document.getElementById('itemUnplayedCheckbox');
const existingTitlesList = document.getElementById('existingTitlesList');

// Quick Action Sheet
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

// Batch Modal
const batchModalBackdrop = document.getElementById('batchModalBackdrop');
const openBatchTopBtn = document.getElementById('openBatchTopBtn');
const closeBatchModalBtn = document.getElementById('closeBatchModalBtn');
const cancelBatchBtn = document.getElementById('cancelBatchBtn');
const batchItemForm = document.getElementById('batchItemForm');
const batchTitle = document.getElementById('batchTitle');
const batchStartVol = document.getElementById('batchStartVol');
const batchEndVol = document.getElementById('batchEndVol');
const batchTargetSet = document.getElementById('batchTargetSet');
const batchCategorySelect = document.getElementById('batchCategorySelect');
const existingTitlesListBatch = document.getElementById('existingTitlesListBatch');

// Stats Modal
const statsModalBackdrop = document.getElementById('statsModalBackdrop');
const openStatsBtn = document.getElementById('openStatsBtn');
const closeStatsBtn = document.getElementById('closeStatsBtn');
const statTotalItems = document.getElementById('statTotalItems');
const statTotalOwned = document.getElementById('statTotalOwned');
const statAverageRating = document.getElementById('statAverageRating');
const statCompleteRate = document.getElementById('statCompleteRate');
const statsCatList = document.getElementById('statsCatList');

// History Modal
const fullHistoryModalBackdrop = document.getElementById('fullHistoryModalBackdrop');
const closeFullHistoryModalBtn = document.getElementById('closeFullHistoryModalBtn');
const fullHistoryModalList = document.getElementById('fullHistoryModalList');

// Settings Modal
const settingsModalBackdrop = document.getElementById('settingsModalBackdrop');
const openSettingsBtn = document.getElementById('openSettingsBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
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
const manageCatList = document.getElementById('manageCatList');
const newCatManageInput = document.getElementById('newCatManageInput');
const addCatManageBtn = document.getElementById('addCatManageBtn');
const confirmExportBtn = document.getElementById('confirmExportBtn');
const exportAcquisti = document.getElementById('exportAcquisti');
const exportPosseduti = document.getElementById('exportPosseduti');
const exportVoti = document.getElementById('exportVoti');
const exportListe = document.getElementById('exportListe');
const triggerImportBtn = document.getElementById('triggerImportBtn');
const importJsonFileInput = document.getElementById('importJsonFileInput');
const cancelResetBtn = document.getElementById('cancelResetBtn');
const confirmFactoryResetBtn = document.getElementById('confirmFactoryResetBtn');

export function initModals(appCallbacks) {
  callbacks = { ...callbacks, ...appCallbacks };

  // Form Singolo Listeners
  if (openModalBtn) openModalBtn.addEventListener('click', openCreateModal);
  if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) closeModal();
    });
  }

  if (targetSet) {
    targetSet.addEventListener('change', (e) => adjustModalFields(e.target.value));
  }

  if (itemUnplayedCheckbox) {
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
  }

  if (itemTitle) {
    itemTitle.addEventListener('input', (e) => {
      const val = e.target.value;
      const matched = appData.items.find(i => i.title.toLowerCase() === val.trim().toLowerCase());
      if (matched && matched.category) {
        categorySelect.value = matched.category;
        updateFormCategoryContext(matched.category);
      }
      const numberMatch = val.match(/^(.*?)\s+#?(\d+)$/);
      if (numberMatch && (targetSet.value === 'Acquisti' || targetSet.value === 'Posseduti' || targetSet.value === 'Liste') && !itemNumber.value) {
        itemNumber.value = numberMatch[2];
      }
    });
  }

  if (categorySelect) {
    categorySelect.addEventListener('change', (e) => {
      if (e.target.value === '__NEW_CATEGORY__') {
        const newCat = prompt('Nome della nuova categoria:');
        if (newCat && newCat.trim()) {
          const cleanName = newCat.trim();
          if (!appData.categories.includes(cleanName)) {
            appData.categories.push(cleanName);
            syncCategoriesToSupabase(appData.categories);
          }
          setLastScanCategory(cleanName);
          populateFormCategories(cleanName);
          callbacks.updateCategoryDropdown();
          updateFormCategoryContext(cleanName);
        } else {
          populateFormCategories(appData.categories[0]);
          updateFormCategoryContext(appData.categories[0]);
        }
        return;
      }
      setLastScanCategory(e.target.value);
      updateFormCategoryContext(e.target.value);
    });
  }

  if (formDeleteBtn) {
    formDeleteBtn.addEventListener('click', () => {
      const idToEdit = editItemId.value;
      if (!idToEdit) return;
      const item = appData.items.find(i => i.id == idToEdit);
      if (!item) return;
      if (confirm(`Vuoi davvero eliminare definitivamente "${formatDisplayTitle(item)}"?`)) {
        closeModal();
        callbacks.deleteItemWithUndo(item);
      }
    });
  }

  if (itemForm) {
    itemForm.addEventListener('submit', handleSingleItemSubmit);
  }

  // Quick Action Sheet Listeners
  if (closeQuickSheetBtn) closeQuickSheetBtn.addEventListener('click', closeQuickActionSheet);
  if (quickActionModalBackdrop) {
    quickActionModalBackdrop.addEventListener('click', (e) => {
      if (e.target === quickActionModalBackdrop) closeQuickActionSheet();
    });
  }

  if (quickVolPlusBtn) {
    quickVolPlusBtn.addEventListener('click', async () => {
      if (!state.currentActiveSeries) return;
      const item = state.currentActiveSeries.representativeItem;
      await updateVolumeStep(item.id, 1);
      const updatedClean = cleanVolumeNumber(item.number);
      quickVolValue.textContent = updatedClean ? `#${updatedClean}` : 'Singolo';
    });
  }

  if (quickVolMinusBtn) {
    quickVolMinusBtn.addEventListener('click', async () => {
      if (!state.currentActiveSeries) return;
      const item = state.currentActiveSeries.representativeItem;
      await updateVolumeStep(item.id, -1);
      const updatedClean = cleanVolumeNumber(item.number);
      quickVolValue.textContent = updatedClean ? `#${updatedClean}` : 'Singolo';
    });
  }

  if (quickChapPlusBtn) {
    quickChapPlusBtn.addEventListener('click', async () => {
      if (!state.currentActiveSeries) return;
      const item = state.currentActiveSeries.representativeItem;
      await updateChapterStep(item.id, 1);
      quickChapValue.textContent = item.readingChapter || '0';
    });
  }

  if (quickChapMinusBtn) {
    quickChapMinusBtn.addEventListener('click', async () => {
      if (!state.currentActiveSeries) return;
      const item = state.currentActiveSeries.representativeItem;
      await updateChapterStep(item.id, -1);
      quickChapValue.textContent = item.readingChapter || '0';
    });
  }

  if (quickToggleReadBtn) {
    quickToggleReadBtn.addEventListener('click', async () => {
      if (!state.currentActiveSeries) return;
      const item = state.currentActiveSeries.representativeItem;
      await toggleReadStatus(item.id);
      quickReadBtnText.textContent = item.isRead ? 'Segna da Leggere' : 'Segna come Letto';
    });
  }

  if (quickOpenShelfBtn) {
    quickOpenShelfBtn.addEventListener('click', () => {
      if (!state.currentActiveSeries) return;
      const title = state.currentActiveSeries.representativeItem.title;
      const cat = state.currentActiveSeries.representativeItem.category;
      closeQuickActionSheet();
      openMangaShelf3D(title, cat);
    });
  }

  if (quickOpenFullEditBtn) {
    quickOpenFullEditBtn.addEventListener('click', () => {
      if (!state.currentActiveSeries) return;
      const item = state.currentActiveSeries.representativeItem;
      closeQuickActionSheet();
      openEditModal(item);
    });
  }

  if (quickDeleteBtn) {
    quickDeleteBtn.addEventListener('click', () => {
      if (!state.currentActiveSeries) return;
      const s = state.currentActiveSeries;
      closeQuickActionSheet();
      handleDeletePossedutiPrompt(s);
    });
  }

  // Batch Listeners
  if (openBatchTopBtn) openBatchTopBtn.addEventListener('click', openBatchModal);
  if (closeBatchModalBtn) closeBatchModalBtn.addEventListener('click', closeBatchModal);
  if (cancelBatchBtn) cancelBatchBtn.addEventListener('click', closeBatchModal);
  if (batchModalBackdrop) {
    batchModalBackdrop.addEventListener('click', (e) => {
      if (e.target === batchModalBackdrop) closeBatchModal();
    });
  }
  if (batchItemForm) {
    batchItemForm.addEventListener('submit', handleBatchSubmit);
  }

  // Stats Listeners
  if (openStatsBtn) openStatsBtn.addEventListener('click', openStatsModal);
  if (closeStatsBtn) closeStatsBtn.addEventListener('click', () => statsModalBackdrop.classList.remove('active'));
  if (statsModalBackdrop) {
    statsModalBackdrop.addEventListener('click', (e) => {
      if (e.target === statsModalBackdrop) statsModalBackdrop.classList.remove('active');
    });
  }

  // History Listeners
  if (closeFullHistoryModalBtn && fullHistoryModalBackdrop) {
    closeFullHistoryModalBtn.addEventListener('click', () => fullHistoryModalBackdrop.classList.remove('active'));
    fullHistoryModalBackdrop.addEventListener('click', (e) => {
      if (e.target === fullHistoryModalBackdrop) fullHistoryModalBackdrop.classList.remove('active');
    });
  }

  // Settings Listeners
  if (openSettingsBtn) openSettingsBtn.addEventListener('click', openSettingsModal);
  if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettingsModal);
  if (settingsBackBtn) settingsBackBtn.addEventListener('click', () => showSettingsView('main'));
  if (goToAccountBtn) goToAccountBtn.addEventListener('click', () => showSettingsView('account'));
  if (goToCategoriesBtn) goToCategoriesBtn.addEventListener('click', () => showSettingsView('categories'));
  if (goToExportBtn) goToExportBtn.addEventListener('click', () => showSettingsView('export'));
  if (goToImportBtn) goToImportBtn.addEventListener('click', () => showSettingsView('import'));
  if (goToResetBtn) goToResetBtn.addEventListener('click', () => showSettingsView('reset'));
  if (settingsModalBackdrop) {
    settingsModalBackdrop.addEventListener('click', (e) => {
      if (e.target === settingsModalBackdrop) closeSettingsModal();
    });
  }
  if (addCatManageBtn) addCatManageBtn.addEventListener('click', handleAddCategory);
  if (confirmExportBtn) confirmExportBtn.addEventListener('click', handleExportJson);
  if (triggerImportBtn) triggerImportBtn.addEventListener('click', () => importJsonFileInput.click());
  if (importJsonFileInput) importJsonFileInput.addEventListener('change', handleImportJson);
  if (cancelResetBtn) cancelResetBtn.addEventListener('click', () => showSettingsView('main'));
  if (confirmFactoryResetBtn) confirmFactoryResetBtn.addEventListener('click', handleFactoryReset);
}

// FORM SINGOLO
export function updateFormCategoryContext(category) {
  const isComicOrManga = /manga|comic|fumett/i.test(category);
  const isMediaOrMovie = /film|serie|videogioc/i.test(category);

  if (variantGroupWrapper) {
    variantGroupWrapper.style.display = isComicOrManga ? 'block' : 'none';
    if (!isComicOrManga && itemVariantCheckbox) {
      itemVariantCheckbox.checked = false;
    }
  }

  if (itemNumberLabel && itemNumber) {
    if (isMediaOrMovie) {
      itemNumberLabel.textContent = 'Edizione / Formato';
      itemNumber.placeholder = 'es. 4K, DVD o N se singolo';
    } else {
      itemNumberLabel.textContent = 'Numero / Vol.';
      itemNumber.placeholder = 'Es. 1 (o N se volume unico)';
    }
  }
}

export function populateFormCategories(selectedCategory = null) {
  const chosenCat = selectedCategory || getLastScanCategory('Manga');
  categorySelect.innerHTML = appData.categories
    .map(c => `<option value="${escapeHtml(c)}" ${c === chosenCat ? 'selected' : ''}>${escapeHtml(c)}</option>`)
    .join('') + `<option value="__NEW_CATEGORY__">+ Nuova categoria...</option>`;
}

export function updateAutoCompletionList() {
  const uniqueTitles = [...new Set(appData.items.map(i => i.title))];
  existingTitlesList.innerHTML = '';
  uniqueTitles.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    existingTitlesList.appendChild(opt);
  });
}

export function adjustModalFields(set) {
  purchasesFields.style.display = (set === 'Acquisti' || set === 'Posseduti' || set === 'Liste') ? 'flex' : 'none';
  dateGroupWrapper.style.display = (set === 'Acquisti') ? 'flex' : 'none';
  completedGroupWrapper.style.display = (set === 'Acquisti' || set === 'Posseduti') ? 'block' : 'none';
  ratingInputGroup.style.display = (set === 'Voti') ? 'block' : 'none';
}

export function openCreateModal() {
  openCreateModalWithTitle('');
}

export function openCreateModalWithTitle(initialTitle) {
  modalTitle.textContent = 'Nuovo Elemento';
  editItemId.value = '';
  itemForm.reset();
  formDeleteBtn.style.display = 'none';

  itemScoreInput.disabled = false;
  itemScoreInput.placeholder = 'es. 85';
  if (itemVariantCheckbox) itemVariantCheckbox.checked = false;
  if (itemReadCheckbox) itemReadCheckbox.checked = false;

  const defaultCat = getLastScanCategory((state.activeCategory !== 'Tutte') ? state.activeCategory : (appData.categories[0] || 'Manga'));
  populateFormCategories(defaultCat);
  updateAutoCompletionList();
  updateFormCategoryContext(defaultCat);

  targetSet.value = state.activeSet;
  adjustModalFields(state.activeSet);

  if (initialTitle) itemTitle.value = initialTitle;

  modalBackdrop.classList.add('active');
  itemTitle.focus();
}

export function openEditModal(item) {
  modalTitle.textContent = 'Modifica Elemento';
  editItemId.value = item.id;
  formDeleteBtn.style.display = 'inline-flex';

  populateFormCategories(item.category || 'Generale');
  updateAutoCompletionList();
  updateFormCategoryContext(item.category || 'Generale');

  itemTitle.value = item.title;
  targetSet.value = item.set;
  adjustModalFields(item.set);

  itemDate.value = item.date || '';
  itemNumber.value = cleanVolumeNumber(item.number);
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

  modalBackdrop.classList.add('active');
}

export function closeModal() {
  modalBackdrop.classList.remove('active');
  itemForm.reset();
  editItemId.value = '';
}

async function handleSingleItemSubmit(e) {
  e.preventDefault();

  const idToEdit = editItemId.value;
  let title = itemTitle.value.trim();
  const set = targetSet.value;
  let category = categorySelect.value;

  if (!category || category === '__NEW_CATEGORY__') category = 'Generale';
  setLastScanCategory(category);

  const isComicOrManga = /manga|comic|fumett/i.test(category);
  const isVariantChecked = isComicOrManga && itemVariantCheckbox ? itemVariantCheckbox.checked : false;
  const isReadChecked = itemReadCheckbox ? itemReadCheckbox.checked : false;

  const rawNum = itemNumber.value.trim();
  const numInTitleMatch = title.match(/^(.*?)\s+#?(\d+)$/);
  if (numInTitleMatch && rawNum === numInTitleMatch[2] && (set === 'Acquisti' || set === 'Posseduti' || set === 'Liste')) {
    title = numInTitleMatch[1];
  }

  const number = (set === 'Acquisti' || set === 'Posseduti' || set === 'Liste') ? (cleanVolumeNumber(rawNum) || null) : null;
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
  callbacks.updateCategoryDropdown();

  if (state.activeSet !== set) {
    state.activeSet = set;
    localStorage.setItem('pref_set', state.activeSet);
    document.querySelectorAll('#setTabs .nav-item-btn').forEach(b => {
      const isSelected = b.dataset.set === set;
      b.classList.toggle('active', isSelected);
      b.setAttribute('aria-selected', String(isSelected));
    });
    callbacks.updateFilterBarChips();
  }

  callbacks.renderList();
}

// QUICK ACTION SHEET
export function openQuickActionSheet(series) {
  state.currentActiveSeries = series;
  const item = series.representativeItem;

  quickSheetTitle.textContent = item.title;
  quickSheetCategoryTag.textContent = item.category || 'Generale';
  quickSheetCategoryTag.style.color = getCategoryColor(item.category || 'Generale');

  quickVolValue.textContent = series.maxNumber ? `#${series.maxNumber}` : 'Singolo';
  quickChapValue.textContent = item.readingChapter || '0';
  quickReadBtnText.textContent = item.isRead ? 'Segna da Leggere' : 'Segna come Letto';

  quickActionModalBackdrop.classList.add('active');
}

export function closeQuickActionSheet() {
  quickActionModalBackdrop.classList.remove('active');
  state.currentActiveSeries = null;
}

export async function updateChapterStep(itemId, delta) {
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
  callbacks.renderList();
}

export async function updateVolumeStep(itemId, delta) {
  const item = appData.items.find(i => i.id === itemId);
  if (!item) return;

  const prev = { ...item };
  const currentNum = parseInt(cleanVolumeNumber(item.number) || '0', 10);
  const nextNum = Math.max(1, (isNaN(currentNum) ? 0 : currentNum) + delta);

  item.number = String(nextNum);
  pushHistoryAction({ type: 'UPDATE', prev: prev, next: { ...item } });

  saveData();
  await syncItemToSupabase(item, saveData);
  callbacks.renderList();
  callbacks.showToastNotice(`"${item.title}" aggiornato al Vol. #${nextNum}`);
}

export async function toggleReadStatus(itemId) {
  const item = appData.items.find(i => i.id === itemId);
  if (!item) return;

  const prev = { ...item };
  item.isRead = !item.isRead;
  pushHistoryAction({ type: 'UPDATE', prev: prev, next: { ...item } });

  saveData();
  await syncItemToSupabase(item, saveData);
  callbacks.renderList();
  callbacks.showToastNotice(item.isRead ? `Segnato come LETTO` : `Segnato come NON LETTO`);
}

export async function handleDeletePossedutiPrompt(series) {
  const title = series.representativeItem.title;
  const count = series.allVolumes.length;

  if (count <= 1) {
    if (confirm(`Vuoi eliminare definitivamente "${title}" dalla collezione?`)) {
      callbacks.deleteItemWithUndo(series.representativeItem);
    }
    return;
  }

  const choice = prompt(
    `Gestione eliminazione per "${title}":\n` +
    `1. Elimina SOLO l'ultimo volume (${series.maxNumber ? '#' + series.maxNumber : 'Singolo'})\n` +
    `2. Elimina TUTTI i ${count} volumi della serie\n\n` +
    `Digita 1 o 2 (oppure Annulla):`
  );

  if (choice === '1') {
    callbacks.deleteItemWithUndo(series.representativeItem);
  } else if (choice === '2') {
    if (confirm(`Confermi di voler cancellare TUTTI i ${count} volumi di "${title}"?`)) {
      pushHistoryAction({ type: 'DELETE', data: [...series.allVolumes] });
      const idsToDelete = series.allVolumes.map(v => v.id);
      appData.items = appData.items.filter(i => !idsToDelete.includes(i.id));
      saveData();
      for (const id of idsToDelete) await deleteItemFromSupabase(id);
      callbacks.renderList();
      callbacks.showToastNotice(`Cancellata l'intera serie "${title}"`);
    }
  }
}

// BATCH
export function openBatchModal() {
  batchItemForm.reset();
  batchStartVol.value = 1;
  batchEndVol.value = 10;
  batchTargetSet.value = (state.activeSet === 'Posseduti' || state.activeSet === 'Acquisti') ? state.activeSet : 'Posseduti';

  const defaultCat = getLastScanCategory(state.activeCategory !== 'Tutte' ? state.activeCategory : 'Manga');
  batchCategorySelect.innerHTML = '';
  appData.categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    if (cat === defaultCat) opt.selected = true;
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

export function closeBatchModal() {
  batchModalBackdrop.classList.remove('active');
  batchItemForm.reset();
}

async function handleBatchSubmit(e) {
  e.preventDefault();

  const title = batchTitle.value.trim();
  const start = parseInt(batchStartVol.value, 10);
  const end = parseInt(batchEndVol.value, 10);
  const set = batchTargetSet.value;
  const cat = batchCategorySelect.value || 'Generale';
  setLastScanCategory(cat);

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

  callbacks.showToastNotice(`Aggiunti ${createdItems.length} volumi di "${title}"!`);
  callbacks.renderList();
}

// STORICO
export function openFullHistoryModal() {
  const modal = document.getElementById('fullHistoryModalBackdrop');
  if (!modal || !fullHistoryModalList) return;

  const sortedAll = [...appData.items].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  fullHistoryModalList.innerHTML = '';
  sortedAll.forEach(it => {
    const numClean = cleanVolumeNumber(it.number);
    const d = document.createElement('div');
    d.style.cssText = 'padding: 8px 12px; background: var(--bg-item-inner); border-radius: 8px; margin-bottom: 6px; border: 1px solid var(--border-card); display: flex; justify-content: space-between; align-items: center;';
    d.innerHTML = `
      <div>
        <strong style="color: #fff;">${escapeHtml(it.title)} ${numClean ? '#' + numClean : ''}</strong>
        <span style="font-size: 0.74rem; color: var(--text-dim); margin-left: 6px;">[${escapeHtml(it.set)}]</span>
      </div>
      <span style="font-size: 0.7rem; color: var(--accent-cyan);">${it.createdAt ? new Date(it.createdAt).toLocaleDateString('it-IT') : ''}</span>
    `;
    fullHistoryModalList.appendChild(d);
  });

  modal.classList.add('active');
}

// STATISTICHE
export function openStatsModal() {
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
}

// IMPOSTAZIONI
export function showSettingsView(viewName) {
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

export function openSettingsModal() {
  showSettingsView('main');
  settingsModalBackdrop.classList.add('active');
}

export function closeSettingsModal() {
  settingsModalBackdrop.classList.remove('active');
}

export function renderManageCategoriesList() {
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
          ${TRASH_SVG}
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
        if (state.activeCategory === cat) state.activeCategory = cleanName;

        saveData();
        syncCategoriesToSupabase(appData.categories);
        callbacks.updateCategoryDropdown();
        renderManageCategoriesList();
        callbacks.renderList();
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
          if (state.activeCategory === cat) state.activeCategory = 'Generale';

          saveData();
          syncCategoriesToSupabase(appData.categories);
          callbacks.updateCategoryDropdown();
          renderManageCategoriesList();
          callbacks.renderList();
        }
      });
    }

    manageCatList.appendChild(li);
  });
}

function handleAddCategory() {
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
  callbacks.updateCategoryDropdown();
  renderManageCategoriesList();
  callbacks.renderList();
}

function handleExportJson() {
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
      number: cleanVolumeNumber(item.number) || null,
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
}

function handleImportJson(e) {
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
        
        const rawIncNum = incoming.number !== undefined && incoming.number !== null 
          ? String(incoming.number).trim() 
          : (incoming.volume !== undefined && incoming.volume !== null ? String(incoming.volume).trim() : null);

        const incomingNumber = cleanVolumeNumber(rawIncNum) || null;

        const incomingIsVariant = Boolean(
          incoming.isVariant || 
          incoming.is_variant || 
          (rawIncNum && rawIncNum.toLowerCase().includes('variant'))
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

        if (target === 'Posseduti' && !incomingIsVariant) {
          ensureItemInVoti(newItem.title, newItem.category);
        }

        importedCount++;
      }

      if (newlyImported.length > 0) {
        pushHistoryAction({ type: 'INSERT', data: newlyImported.map(i => ({ ...i })) });
        await syncBatchItemsToSupabase(newlyImported);
      }

      saveData();
      callbacks.updateCategoryDropdown();
      callbacks.renderList();
      closeSettingsModal();
      importJsonFileInput.value = '';

      callbacks.showToastNotice(`Importati ${importedCount} elementi (Saltati: ${skippedCount})`);
    } catch (err) {
      console.error("Errore import JSON:", err);
      alert('Errore durante la lettura del file: sintassi JSON non valida.');
    }
  };

  reader.readAsText(file);
}

async function handleFactoryReset() {
  localStorage.clear();
  appData.categories = ['Generale', 'Manga', 'Comics', 'Libri', 'Film', 'Serie TV', 'Videogiochi'];
  appData.items = [];
  saveData();

  if (supabaseClient && currentUser) {
    try {
      await supabaseClient.from('items').delete().neq('id', 0);
      await supabaseClient.from('categories').delete().neq('id', '');
    } catch (e) {
      console.error('Errore durante il reset su Supabase:', e);
    }
  }

  state.activeSet = 'Acquisti';
  state.activeCategory = 'Generale';
  state.activeTimeFilter = 'all';
  state.setSortModes = { Acquisti: 'date', Posseduti: 'name', Voti: 'number', Liste: 'name' };
  localStorage.setItem('pref_set_sort_modes', JSON.stringify(state.setSortModes));
  state.searchSeriesQuery = '';

  closeSettingsModal();
  callbacks.initApp();
  alert('Dati ripristinati allo stato iniziale sia in locale che su Supabase.');
}

