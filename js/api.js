import { SUPABASE_CONFIG } from './config.js';
import {
  state,
  saveLocalOnly,
  saveDLocalOnly,
  saveMoltLocal,
  saveNamesLocal,
  saveCategoriesLocal
} from './state.js';

export let sb = null;
try {
  if (window.supabase && SUPABASE_CONFIG.url && SUPABASE_CONFIG.key) {
    sb = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key);
  }
} catch(e) {
  sb = null;
}

export function setSyncVisualState(syncState, tooltip) {
  const dot = document.getElementById('syncDot');
  const wrap = document.getElementById('syncIndicatorWrap');
  if (!wrap || !dot) return;
  wrap.style.display = 'inline-flex';
  if (syncState === 'orange') {
    dot.className = 'sync-dot sync-orange';
    dot.title = tooltip || 'Sincronizzazione…';
  } else if (syncState === 'green') {
    dot.className = 'sync-dot sync-green';
    dot.title = tooltip || (sb ? 'Sincronizzato Realtime' : 'Memoria locale');
  } else if (syncState === 'red') {
    dot.className = 'sync-dot sync-red';
    dot.title = tooltip || 'Cloud non raggiungibile';
  }
}

export async function cloudFetchRaw() {
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from('partite_board')
      .select('data')
      .eq('id', SUPABASE_CONFIG.board)
      .maybeSingle();
    if (error) return null;
    return data && data.data ? data.data : null;
  } catch(e) {
    return null;
  }
}

let onCloudDataAppliedCallback = null;
export function registerCloudCallback(cb) {
  onCloudDataAppliedCallback = cb;
}

export function applyCloudData(raw) {
  if (!raw) return;
  state.items = Array.isArray(raw.items) ? raw.items : [];
  state.dayMeta = raw.dayMeta && typeof raw.dayMeta === 'object' ? raw.dayMeta : {};
  state.molt = raw.molt && typeof raw.molt === 'object' ? raw.molt : {};
  state.names = Array.isArray(raw.names) ? raw.names : [];
  state.categories = Array.isArray(raw.categories) ? raw.categories : [];
  state.isDirty = false;
  saveLocalOnly();
  saveDLocalOnly();
  saveMoltLocal();
  saveNamesLocal();
  saveCategoriesLocal();
  state.isDirty = false;
  if (onCloudDataAppliedCallback) onCloudDataAppliedCallback();
}

export async function cloudPushNow() {
  if (!sb || state.READONLY) return false;
  setSyncVisualState('orange');
  try {
    const { error } = await sb.from('partite_board').upsert({
      id: SUPABASE_CONFIG.board,
      data: {
        items: state.items,
        dayMeta: state.dayMeta,
        molt: state.molt,
        names: state.names,
        categories: state.categories
      },
      updated_at: new Date().toISOString()
    });
    if (error) throw error;
    state.isDirty = false;
    setSyncVisualState('green');
    return true;
  } catch (err) {
    setSyncVisualState('red');
    return false;
  }
}

let syncTimer = null;
export function scheduleCloudPush() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(cloudPushNow, 1200);
}

export async function cloudPullSafe(silent) {
  if (!sb) return false;
  if (state.isDirty && !state.READONLY) await cloudPushNow();
  if (!silent) setSyncVisualState('orange');
  try {
    const raw = await cloudFetchRaw();
    if (raw) {
      applyCloudData(raw);
      setSyncVisualState('green');
      return true;
    }
    setSyncVisualState('green');
    return false;
  } catch(e) {
    setSyncVisualState('red');
    return false;
  }
}

export function setupSupabaseRealtime({ isModalOpen, onRealtimeUpdate }) {
  if (!sb) return;
  try {
    sb.channel('realtime_partite_board')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'partite_board', filter: `id=eq.${SUPABASE_CONFIG.board}` },
        payload => {
          if (payload.new && payload.new.data) {
            if (!state.isDirty && !isModalOpen()) {
              applyCloudData(payload.new.data);
              if (onRealtimeUpdate) onRealtimeUpdate();
              setSyncVisualState('green', 'Aggiornato in tempo reale');
            }
          }
        }
      )
      .subscribe(status => {
        if (status === 'SUBSCRIBED') setSyncVisualState('green', 'Connesso Realtime');
      });
  } catch (e) {
    console.warn('Realtime fallback attivo', e);
  }
}