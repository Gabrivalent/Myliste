// js/supabase.js
import { SUPABASE_CONFIG } from './config.js';
import { state } from './state.js';

let supabaseClient = null;

export function initSupabase() {
  if (window.supabase) {
    supabaseClient = window.supabase.createClient(
      SUPABASE_CONFIG.url,
      SUPABASE_CONFIG.anonKey
    );
    setupRealtimeSubscription();
    updateSyncIndicator("online", "Connesso");
  } else {
    console.warn("Supabase SDK non trovato nel window object.");
    updateSyncIndicator("offline", "Modalità Offline");
  }
}

export function getSupabase() {
  return supabaseClient;
}

function updateSyncIndicator(statusClass, label) {
  const syncStatus = document.getElementById("syncStatus");
  const syncText = document.getElementById("syncText");
  if (!syncStatus || !syncText) return;

  syncStatus.className = `sync-indicator ${statusClass}`;
  syncText.textContent = label;
}

// NOTA CRITICA: user_id è tassativamente rimosso prima dell'upsert
function sanitizePayload(rawItem) {
  const payload = { ...rawItem };
  delete payload.user_id; // Previene PGRST204 / 400
  return payload;
}

export async function fetchRemoteItems() {
  if (!supabaseClient) return [];
  try {
    updateSyncIndicator("syncing", "Sincronizzazione...");
    const { data, error } = await supabaseClient
      .from(SUPABASE_CONFIG.tableName)
      .select("*")
      .order("title", { ascending: true });

    if (error) throw error;
    if (data && Array.isArray(data)) {
      state.items = data;
      state.saveData();
    }
    updateSyncIndicator("online", "Sincronizzato");
    return data;
  } catch (err) {
    console.error("Errore fetch Supabase:", err);
    updateSyncIndicator("online", "Locale / Errore Sync");
    return [];
  }
}

export async function syncItemToRemote(item) {
  if (!supabaseClient) return;
  const cleanPayload = sanitizePayload(item);

  try {
    updateSyncIndicator("syncing", "Salvataggio...");
    const { error } = await supabaseClient
      .from(SUPABASE_CONFIG.tableName)
      .upsert(cleanPayload);

    if (error) throw error;
    updateSyncIndicator("online", "Sincronizzato");
  } catch (err) {
    console.error("Errore upsert Supabase:", err);
    updateSyncIndicator("online", "Errore salvataggio remoto");
  }
}

export async function deleteRemoteItem(id) {
  if (!supabaseClient) return;
  try {
    updateSyncIndicator("syncing", "Eliminazione...");
    const { error } = await supabaseClient
      .from(SUPABASE_CONFIG.tableName)
      .delete()
      .eq("id", id);

    if (error) throw error;
    updateSyncIndicator("online", "Sincronizzato");
  } catch (err) {
    console.error("Errore eliminazione Supabase:", err);
  }
}

function setupRealtimeSubscription() {
  if (!supabaseClient) return;

  supabaseClient
    .channel("public:items_changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: SUPABASE_CONFIG.tableName },
      (payload) => {
        const { eventType, new: newRecord, old: oldRecord } = payload;
        if (eventType === "INSERT" || eventType === "UPDATE") {
          const idx = state.items.findIndex(i => i.id === newRecord.id);
          if (idx >= 0) {
            state.items[idx] = newRecord;
          } else {
            state.items.push(newRecord);
          }
          state.saveData();
        } else if (eventType === "DELETE") {
          state.items = state.items.filter(i => i.id !== oldRecord.id);
          state.saveData();
        }
      }
    )
    .subscribe();
}