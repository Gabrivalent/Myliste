// js/state.js
import {
  syncItemToSupabase,
  syncBatchItemsToSupabase,
  deleteItemFromSupabase
} from './supabase.js';

export const DEFAULT_DATA = {
  categories: ['Generale', 'Manga', 'Comics', 'Libri', 'Film', 'Serie TV', 'Videogiochi'],
  items: []
};

export const appData = JSON.parse(localStorage.getItem('collection_data')) || JSON.parse(JSON.stringify(DEFAULT_DATA));

// Migrazione e validazione iniziale dei campi mancanti
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

// Parametri di navigazione e filtri
export const state = {
  activeSet: localStorage.getItem('pref_set') || 'Acquisti',
  activeCategory: localStorage.getItem('pref_category') || 'Generale',
  activeTimeFilter: localStorage.getItem('pref_time_filter') || 'all',
  setSortModes: JSON.parse(localStorage.getItem('pref_set_sort_modes')) || {
    Acquisti: 'date',
    Posseduti: 'name',
    Voti: 'number',
    Liste: 'name'
  },
  isPurchasedSectionOpen: localStorage.getItem('pref_purchased_open') === 'true',
  notificationsEnabled: localStorage.getItem('pref_notifications') === 'true',
  searchSeriesQuery: '',
  deletedItemBuffer: null,
  undoTimeoutId: null,
  currentActiveSeries: null
};

export const SORT_LABELS = {
  date: 'Per Data',
  name: 'Per Nome (A-Z)',
  number: 'Per Valore / #'
};

export function getCurrentSortMode() {
  return state.setSortModes[state.activeSet] || 'date';
}

export function setCurrentSortMode(mode) {
  state.setSortModes[state.activeSet] = mode;
  localStorage.setItem('pref_set_sort_modes', JSON.stringify(state.setSortModes));
}

export function saveData() {
  localStorage.setItem('collection_data', JSON.stringify(appData));
}

export function generateUniqueId() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return (arr[0] & 0x7FFFFFFF) % 2000000000;
  }
  return Math.floor(Math.random() * 1900000000) + 1;
}

// Stack Undo / Redo
export const historyUndoStack = [];
export const historyRedoStack = [];
const MAX_HISTORY_STEPS = 35;

export function pushHistoryAction(action) {
  historyUndoStack.push(action);
  if (historyUndoStack.length > MAX_HISTORY_STEPS) historyUndoStack.shift();
  historyRedoStack.length = 0;
  updateHistoryButtonsUI();
}

export function updateHistoryButtonsUI() {
  const undoBtnElem = document.getElementById('historyUndoBtn');
  const redoBtnElem = document.getElementById('historyRedoBtn');
  if (undoBtnElem) undoBtnElem.disabled = historyUndoStack.length === 0;
  if (redoBtnElem) redoBtnElem.disabled = historyRedoStack.length === 0;
}

export async function executeUndo(renderCallback, toastCallback) {
  if (historyUndoStack.length === 0) return;
  const action = historyUndoStack.pop();

  if (action.type === 'INSERT') {
    const ids = Array.isArray(action.data) ? action.data.map(i => i.id) : [action.data.id];
    appData.items = appData.items.filter(i => !ids.includes(i.id));
    saveData();
    for (const id of ids) await deleteItemFromSupabase(id);
    if (toastCallback) toastCallback('Creazione annullata');
  } else if (action.type === 'DELETE') {
    if (Array.isArray(action.data)) {
      action.data.forEach(it => appData.items.unshift(it));
      saveData();
      await syncBatchItemsToSupabase(action.data);
      if (toastCallback) toastCallback(`Ripristinati ${action.data.length} elementi`);
    } else {
      appData.items.unshift(action.data);
      saveData();
      await syncItemToSupabase(action.data, saveData);
      if (toastCallback) toastCallback(`Ripristinato "${action.data.title}"`);
    }
  } else if (action.type === 'UPDATE') {
    const idx = appData.items.findIndex(i => i.id === action.prev.id);
    if (idx !== -1) {
      appData.items[idx] = { ...action.prev };
      saveData();
      await syncItemToSupabase(appData.items[idx], saveData);
      if (toastCallback) toastCallback(`Modifica annullata per "${action.prev.title}"`);
    }
  }

  historyRedoStack.push(action);
  updateHistoryButtonsUI();
  if (renderCallback) renderCallback();
}

export async function executeRedo(renderCallback, toastCallback) {
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
    if (toastCallback) toastCallback('Creazione riapplicata');
  } else if (action.type === 'DELETE') {
    const ids = Array.isArray(action.data) ? action.data.map(i => i.id) : [action.data.id];
    appData.items = appData.items.filter(i => !ids.includes(i.id));
    saveData();
    for (const id of ids) await deleteItemFromSupabase(id);
    if (toastCallback) toastCallback('Eliminazione riapplicata');
  } else if (action.type === 'UPDATE') {
    const idx = appData.items.findIndex(i => i.id === action.next.id);
    if (idx !== -1) {
      appData.items[idx] = { ...action.next };
      saveData();
      await syncItemToSupabase(appData.items[idx], saveData);
      if (toastCallback) toastCallback(`Modifica ripristinata per "${action.next.title}"`);
    }
  }

  historyUndoStack.push(action);
  updateHistoryButtonsUI();
  if (renderCallback) renderCallback();
}

export async function ensureItemInVoti(title, category) {
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
