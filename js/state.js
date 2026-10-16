import { STORAGE_KEYS } from './config.js';

export const state = {
  READONLY: true,
  currentTheme: localStorage.getItem(STORAGE_KEYS.THEME) || 'default',
  items: [],
  dayMeta: {},
  molt: {},
  names: [],
  categories: [],
  isDirty: false,
  filterCat: '',
  filterIncomplete: false,
  searchQuery: '',
  undoStack: [],
  pdfCandidates: [],
  swRegistration: null,
  ready: false,
  mem: null
};

// Inizializzazione dati da localStorage
try { state.items = JSON.parse(localStorage.getItem(STORAGE_KEYS.ITEMS)) || []; } catch(e) {}
try { state.dayMeta = JSON.parse(localStorage.getItem(STORAGE_KEYS.DAYS)) || {}; } catch(e) {}
try { state.molt = JSON.parse(localStorage.getItem(STORAGE_KEYS.MOLT)) || {}; } catch(e) {}
try { state.names = JSON.parse(localStorage.getItem(STORAGE_KEYS.NAMES)) || []; } catch(e) {}
try { state.categories = JSON.parse(localStorage.getItem(STORAGE_KEYS.CATEGORIES)) || []; } catch(e) {}

let onSaveCallback = null;
let onBadgeUpdateCallback = null;

export function registerStateCallbacks({ onSave, onBadgeUpdate }) {
  onSaveCallback = onSave;
  onBadgeUpdateCallback = onBadgeUpdate;
}

export const saveLocalOnly = () => {
  try { localStorage.setItem(STORAGE_KEYS.ITEMS, JSON.stringify(state.items)); } catch(e) {}
  if (onBadgeUpdateCallback) onBadgeUpdateCallback();
  state.isDirty = true;
};

export const saveDLocalOnly = () => {
  try { localStorage.setItem(STORAGE_KEYS.DAYS, JSON.stringify(state.dayMeta)); } catch(e) {}
  state.isDirty = true;
};

export const saveMoltLocal = () => {
  try { localStorage.setItem(STORAGE_KEYS.MOLT, JSON.stringify(state.molt)); } catch(e) {}
  state.isDirty = true;
};

export const saveNamesLocal = () => {
  try { localStorage.setItem(STORAGE_KEYS.NAMES, JSON.stringify(state.names)); } catch(e) {}
  state.isDirty = true;
};

export const saveCategoriesLocal = () => {
  try { localStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(state.categories)); } catch(e) {}
  state.isDirty = true;
};

export const save = () => { saveLocalOnly(); if (onSaveCallback) onSaveCallback(); };
export const saveD = () => { saveDLocalOnly(); if (onSaveCallback) onSaveCallback(); };
export const saveMolt = () => { saveMoltLocal(); if (onSaveCallback) onSaveCallback(); };
export const saveNames = () => { saveNamesLocal(); if (onSaveCallback) onSaveCallback(); };
export const saveCategories = () => { saveCategoriesLocal(); if (onSaveCallback) onSaveCallback(); };

export function applyTheme(themeName) {
  state.currentTheme = themeName;
  if (themeName === 'default') document.body.removeAttribute('data-theme');
  else document.body.setAttribute('data-theme', themeName);
  localStorage.setItem(STORAGE_KEYS.THEME, themeName);
}

export function pushUndo() {
  state.undoStack.push(JSON.stringify({ items: state.items, dayMeta: state.dayMeta }));
  if (state.undoStack.length > 20) state.undoStack.shift();
  refreshUndoBtn();
}

export function refreshUndoBtn() {
  const b = document.querySelector('#undoBtn');
  if (b) b.disabled = !state.undoStack.length;
}

export function popUndoState() {
  if (state.READONLY || !state.undoStack.length) return false;
  const prev = JSON.parse(state.undoStack.pop());
  state.items = prev.items;
  state.dayMeta = prev.dayMeta;
  save();
  saveD();
  refreshUndoBtn();
  return true;
}