export const SUPABASE_CONFIG = {
  url: 'https://aiagtwiqeecaxhaaqzmx.supabase.co',
  anonKey: 'sb_publishable_PodV98vtRyuW329msfQKrA_goxv6C_c'
};

export let supabaseClient = null;
export let realtimeChannel = null;
export let currentUser = null;

const SYNC_QUEUE_KEY = 'kolekt_sync_queue';

export function getSyncQueue() {
  try {
    return JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY)) || [];
  } catch (e) {
    return [];
  }
}

export function saveSyncQueue(queue) {
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
}

export function enqueueSyncAction(actionType, data) {
  const queue = getSyncQueue();
  queue.push({
    actionType,
    data,
    queuedAt: new Date().toISOString()
  });
  saveSyncQueue(queue);
}

export async function flushSyncQueue() {
  if (!supabaseClient || !currentUser || !navigator.onLine) return;
  const queue = getSyncQueue();
  if (queue.length === 0) return;

  const remainingQueue = [];

  for (const item of queue) {
    try {
      if (item.actionType === 'ITEM_UPSERT') {
        const payload = createPayloadFromItem(item.data);
        const { error } = await supabaseClient.from('items').upsert(payload);
        if (error) {
          console.error('Errore Supabase su ITEM_UPSERT:', error);
          if (error.code !== 'PGRST100' && error.code !== '42703' && error.code !== '22P02') {
            remainingQueue.push(item);
          }
        }
      } else if (item.actionType === 'ITEM_DELETE') {
        const numericId = parseInt(item.data, 10);
        if (!isNaN(numericId) && numericId > 0) {
          const { error } = await supabaseClient.from('items').delete().eq('id', numericId);
          if (error) {
            console.error('Errore Supabase su ITEM_DELETE:', error);
            remainingQueue.push(item);
          }
        }
      } else if (item.actionType === 'BATCH_UPSERT') {
        const payload = item.data.map(createPayloadFromItem);
        const { error } = await supabaseClient.from('items').upsert(payload);
        if (error) {
          console.error('Errore Supabase su BATCH_UPSERT:', error);
        }
      } else if (item.actionType === 'CATEGORIES_UPSERT') {
        const payload = item.data.map(c => ({ id: c, name: c }));
        const { error } = await supabaseClient.from('categories').upsert(payload);
        if (error) {
          console.error('Errore Supabase su CATEGORIES_UPSERT:', error);
        }
      }
    } catch (err) {
      console.error('Eccezione durante flush queue:', err);
    }
  }

  saveSyncQueue(remainingQueue);
  if (remainingQueue.length === 0) {
    setCloudStatus('online');
  } else {
    setCloudStatus('error');
  }
}

export function setCloudStatus(status) {
  const cloudStatusDot = document.getElementById('cloudStatusDot');
  if (!cloudStatusDot) return;
  cloudStatusDot.classList.remove('online', 'error');
  if (status === 'online') {
    cloudStatusDot.classList.add('online');
    cloudStatusDot.title = 'Sincronizzazione Cloud Realtime attiva';
  } else if (status === 'error') {
    cloudStatusDot.classList.add('error');
    cloudStatusDot.title = 'Errore connessione Supabase (modifiche in coda locale)';
  } else {
    cloudStatusDot.title = 'In attesa di autenticazione';
  }
}

export function formatRowToItem(row) {
  return {
    id: Number(row.id),
    title: row.title,
    set: row.set_type,
    category: row.category,
    date: row.date || null,
    number: row.number || null,
    isbn: row.isbn || null,
    rating: (row.rating !== null && row.rating !== undefined) ? Number(row.rating) : null,
    unplayed: Boolean(row.unplayed),
    purchased: Boolean(row.purchased),
    completed: Boolean(row.completed),
    isRead: Boolean(row.is_read || row.isRead),
    isVariant: Boolean(row.is_variant || row.isVariant || (row.number && String(row.number).toLowerCase().includes('variant'))),
    missingGapNotice: row.missing_gap_notice || null,
    readingChapter: row.reading_chapter || '',
    privateComment: row.private_comment || '',
    createdAt: row.created_at || new Date().toISOString()
  };
}

export function createPayloadFromItem(item) {
  const payload = {
    title: String(item.title || 'Senza Titolo').trim(),
    set_type: item.set || item.targetSet || 'Acquisti',
    category: item.category || 'Generale',
    date: (item.date && String(item.date).trim()) ? String(item.date).trim() : null,
    number: (item.number !== null && item.number !== undefined && String(item.number).trim()) ? String(item.number).trim() : null,
    isbn: (item.isbn && String(item.isbn).trim()) ? String(item.isbn).trim() : null,
    rating: (item.rating !== null && item.rating !== undefined && !isNaN(Number(item.rating))) ? Number(item.rating) : null,
    unplayed: Boolean(item.unplayed),
    purchased: Boolean(item.purchased),
    completed: Boolean(item.completed),
    is_read: Boolean(item.isRead || item.is_read),
    is_variant: Boolean(item.isVariant || item.is_variant)
  };

  const numericId = parseInt(item.id, 10);
  if (!isNaN(numericId) && numericId > 0 && String(item.id).length < 10 && !item._isTempId) {
    payload.id = numericId;
  }

  return payload;
}

export async function syncItemToSupabase(item, onSaveCallback) {
  if (!supabaseClient || !currentUser) {
    enqueueSyncAction('ITEM_UPSERT', item);
    return;
  }

  try {
    const payload = createPayloadFromItem(item);
    const { data, error } = await supabaseClient
      .from('items')
      .upsert(payload)
      .select();

    if (error) {
      console.error('Dettaglio errore Supabase upsert:', error);
      throw error;
    }

    if (data && data[0] && data[0].id) {
      item.id = Number(data[0].id);
      delete item._isTempId;
      if (onSaveCallback) onSaveCallback();
    }
    setCloudStatus('online');
  } catch (err) {
    console.error(`Offline o errore sync item #${item.id}, salvato in coda locale:`, err);
    enqueueSyncAction('ITEM_UPSERT', item);
    setCloudStatus('error');
  }
}

export async function syncBatchItemsToSupabase(itemsArray) {
  if (!supabaseClient || !currentUser || itemsArray.length === 0) {
    if (itemsArray.length > 0) enqueueSyncAction('BATCH_UPSERT', itemsArray);
    return;
  }

  try {
    const payload = itemsArray.map(createPayloadFromItem);
    const { data, error } = await supabaseClient.from('items').upsert(payload).select();
    if (error) {
      console.error('Dettaglio errore Supabase batch:', error);
      throw error;
    }

    if (data && data.length === itemsArray.length) {
      data.forEach((row, idx) => {
        itemsArray[idx].id = Number(row.id);
        delete itemsArray[idx]._isTempId;
      });
    }
    setCloudStatus('online');
  } catch (err) {
    console.error('Offline o errore batch items, salvati in coda locale:', err);
    enqueueSyncAction('BATCH_UPSERT', itemsArray);
    setCloudStatus('error');
  }
}

export async function deleteItemFromSupabase(id) {
  if (!supabaseClient || !currentUser) {
    enqueueSyncAction('ITEM_DELETE', id);
    return;
  }

  try {
    const numericId = parseInt(id, 10);
    if (isNaN(numericId) || numericId <= 0) return;

    const { error } = await supabaseClient.from('items').delete().eq('id', numericId);
    if (error) throw error;
    setCloudStatus('online');
  } catch (err) {
    console.error(`Offline o errore eliminazione #${id}, salvata in coda locale:`, err);
    enqueueSyncAction('ITEM_DELETE', id);
    setCloudStatus('error');
  }
}

export async function syncCategoriesToSupabase(categories) {
  if (!supabaseClient || !currentUser) {
    enqueueSyncAction('CATEGORIES_UPSERT', categories);
    return;
  }

  try {
    const payload = categories.map(c => ({ id: c, name: c }));
    const { error } = await supabaseClient.from('categories').upsert(payload);
    if (error) throw error;
    setCloudStatus('online');
  } catch (err) {
    console.error('Offline o errore categorie, salvate in coda locale:', err);
    enqueueSyncAction('CATEGORIES_UPSERT', categories);
    setCloudStatus('error');
  }
}

let realtimeDebounceTimer = null;

export function setupRealtimeSubscriptions(appData, callbacks) {
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
        const { eventType, new: newRow, old: oldRow } = payload;
        let hasChanges = false;

        if (eventType === 'INSERT') {
          const exists = appData.items.some(i => i.id === Number(newRow.id));
          if (!exists) {
            appData.items.unshift(formatRowToItem(newRow));
            hasChanges = true;
          }
        } else if (eventType === 'UPDATE') {
          const idx = appData.items.findIndex(i => i.id === Number(newRow.id));
          if (idx !== -1) {
            appData.items[idx] = formatRowToItem(newRow);
            hasChanges = true;
          }
        } else if (eventType === 'DELETE') {
          if (oldRow && oldRow.id) {
            appData.items = appData.items.filter(i => i.id !== Number(oldRow.id));
            hasChanges = true;
          }
        }

        if (hasChanges && callbacks.onDataChange) {
          if (realtimeDebounceTimer) clearTimeout(realtimeDebounceTimer);
          realtimeDebounceTimer = setTimeout(() => {
            callbacks.onDataChange();
          }, 80);
        }
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setCloudStatus('online');
      }
    });
}

export async function initAuth(callbacks) {
  if (!window.supabase) return;

  supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);

  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (session && session.user) {
      currentUser = session.user;
      callbacks.onAuthSuccess(session.user);
    } else {
      currentUser = null;
      callbacks.onAuthLogout();
    }
  });

  const { data } = await supabaseClient.auth.getSession();
  if (data && data.session && data.session.user) {
    currentUser = data.session.user;
    callbacks.onAuthSuccess(data.session.user);
  } else {
    currentUser = null;
    callbacks.onAuthLogout();
  }
}
