// js/state.js
import { STORAGE_KEYS, SECTIONS } from './config.js';

class StateManager {
  constructor() {
    this.items = this.loadInitialData();
    this.currentSection = SECTIONS.POSSEDUTI;
    this.searchQuery = "";
    this.typeFilter = "all";
    this.recentScans = this.loadRecentScans();
    
    // Ordinamenti indipendenti per sezione
    this.sectionSorts = this.loadSortSettings();

    // Stack Undo/Redo in memoria
    this.undoStack = [];
    this.redoStack = [];
    this.maxHistory = 30;

    this.listeners = new Set();
  }

  loadInitialData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.APP_DATA);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  saveData() {
    try {
      localStorage.setItem(STORAGE_KEYS.APP_DATA, JSON.stringify(this.items));
    } catch (err) {
      console.error("Errore salvataggio localStorage:", err);
    }
    this.notify();
  }

  loadSortSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SORT_SETTINGS);
      return raw ? JSON.parse(raw) : {
        [SECTIONS.POSSEDUTI]: "title_asc",
        [SECTIONS.ACQUISTI]: "updated_desc",
        [SECTIONS.VOTI]: "rating_desc",
        [SECTIONS.LISTE]: "title_asc"
      };
    } catch {
      return {};
    }
  }

  setSortOrder(section, sortKey) {
    this.sectionSorts[section] = sortKey;
    localStorage.setItem(STORAGE_KEYS.SORT_SETTINGS, JSON.stringify(this.sectionSorts));
    this.notify();
  }

  getSortOrder(section) {
    return this.sectionSorts[section] || "title_asc";
  }

  loadRecentScans() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.HISTORY_RECENT);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  addRecentScan(scanRecord) {
    this.recentScans = [scanRecord, ...this.recentScans.filter(s => s.isbn !== scanRecord.isbn)].slice(0, 20);
    localStorage.setItem(STORAGE_KEYS.HISTORY_RECENT, JSON.stringify(this.recentScans));
  }

  // Registrazione Observer
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    this.listeners.forEach(fn => fn(this));
  }

  // --- Snapshot per Undo / Redo ---
  pushSnapshot() {
    const snapshot = JSON.stringify(this.items);
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = []; // Resetta redo su nuova operazione
    this.updateUndoRedoButtons();
  }

  undo() {
    if (this.undoStack.length === 0) return null;
    const currentSnapshot = JSON.stringify(this.items);
    this.redoStack.push(currentSnapshot);
    const prevSnapshot = this.undoStack.pop();
    this.items = JSON.parse(prevSnapshot);
    this.saveData();
    this.updateUndoRedoButtons();
    return this.items;
  }

  redo() {
    if (this.redoStack.length === 0) return null;
    const currentSnapshot = JSON.stringify(this.items);
    this.undoStack.push(currentSnapshot);
    const nextSnapshot = this.redoStack.pop();
    this.items = JSON.parse(nextSnapshot);
    this.saveData();
    this.updateUndoRedoButtons();
    return this.items;
  }

  updateUndoRedoButtons() {
    const btnUndo = document.getElementById("btnUndo");
    const btnRedo = document.getElementById("btnRedo");
    if (btnUndo) btnUndo.disabled = this.undoStack.length === 0;
    if (btnRedo) btnRedo.disabled = this.redoStack.length === 0;
  }

  // CRUD Locale
  upsertItemLocally(item) {
    this.pushSnapshot();
    const idx = this.items.findIndex(i => i.id === item.id);
    if (idx >= 0) {
      this.items[idx] = { ...this.items[idx], ...item, updated_at: new Date().toISOString() };
    } else {
      this.items.push({
        ...item,
        created_at: item.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }
    this.saveData();
  }

  deleteItemLocally(id) {
    this.pushSnapshot();
    this.items = this.items.filter(i => i.id !== id);
    this.saveData();
  }
}

export const state = new StateManager();