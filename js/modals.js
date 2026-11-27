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

  if (!category
