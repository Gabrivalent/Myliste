// js/supabase.js

export const SUPABASE_CONFIG = {
  url: 'https://aiagtwiqeecaxhaaqzmx.supabase.co',
  anonKey: 'sb_publishable_PodV98vtRyuW329msfQKrA_goxv6C_c'
};

export let supabaseClient = null;
export let realtimeChannel = null;
export let currentUser = null;

export function setCloudStatus(status) {
  const cloudStatusDot = document.getElementById('cloudStatusDot');
  if (!cloudStatusDot) return;
  cloudStatusDot.classList.remove('online', 'error');
  if (status === 'online') {
    cloudStatusDot.classList.add('online');
    cloudStatusDot.title = 'Sincronizzazione Cloud Realtime attiva';
  } else if (status === 'error') {
    cloudStatusDot.classList.add('error');
    cloudStatusDot.title = 'Errore di connessione a Supabase';
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
    date: row.date,
    number: row.number,
    isbn: row.isbn || null,
    rating: row.rating,
    unplayed: Boolean(row.unplayed),
    purchased: Boolean(row.purchased),
    completed: Boolean(row.completed),
    isRead: Boolean(row.is_read || row.isRead),
    isVariant: Boolean(row.is_variant || row.isVariant || (row.number && String(row.number).toLowerCase().includes('variant'))),
    missingGapNotice: row.missing_gap_notice,
    readingChapter: row.reading_chapter || '',
    privateComment: row.private_comment || '',
    createdAt: row.created_at || new Date().toISOString()
  };
}

export function createPayloadFromItem(item) {
  const payload = {
    title: item.title,
    set_type: item.set,
    category: item.category || 'Generale',
    date: item.date || null,
    number: item.number ? String(item.number) : null,
    isbn: item.isbn ? String(item.isbn).trim() : null,
    rating: (item.rating !== null && item.rating !== undefined && !isNaN(item.rating)) ? Number(item.rating) : null,
    unplayed: Boolean(item.unplayed),
    purchased: Boolean(item.purchased),
    completed: Boolean(item.completed),
    is_read: Boolean(item.isRead),
    is_variant: Boolean(item.isVariant),
    missing_gap_notice: item.missingGapNotice || null,
    reading_chapter: item.readingChapter || null,
    private_comment: item.privateComment || ''
  };

  const numericId = parseInt(item.id, 10);
  // Se l'id è reale e già confermato dal database, lo passiamo per l'aggiornamento
  if (!isNaN(numericId) && numericId > 0 && !item._isTempId) {
    payload.id = numericId;
  }

  return payload;
}

export async function syncItemToSupabase(item, onSaveCallback) {
  if (!supabaseClient || !currentUser) return;

  try {
    const payload = createPayloadFromItem(item);

    const { data, error } = await supabaseClient
      .from('items')
      .upsert(payload)
      .select();

    if (error) throw error;

    if (data && data[0] && data[0].id) {
      const serverId = Number(data[0].id);
      item.id = serverId;
      delete item._isTempId;
      if (onSaveCallback) onSaveCallback();
    }
    setCloudStatus('online');
  } catch (err) {
    console.error(`Errore sync item #${item.id}:`, err);
    setCloudStatus('error');
  }
}

export async function syncBatchItemsToSupabase(itemsArray) {
  if (!supabaseClient || !currentUser || itemsArray.length === 0) return;

  try {
    const payload = itemsArray.map(createPayloadFromItem);
    const { data, error } = await supabaseClient.from('items').upsert(payload).select();
    if (error) throw error;

    if (data && data.length === itemsArray.length) {
      data.forEach((row, idx) => {
        itemsArray[idx].id = Number(row.id);
        delete itemsArray[idx]._isTempId;
      });
    }

    setCloudStatus('online');
  } catch (err) {
    console.error('Errore sync batch items:', err);
    setCloudStatus('error');
  }
}

export async function deleteItemFromSupabase(id) {
  if (!supabaseClient || !currentUser) return;

  try {
    const numericId = parseInt(id, 10);
    if (isNaN(numericId) || numericId <= 0) return;

    const { error } = await supabaseClient.from('items').delete().eq('id', numericId);
    if (error) throw error;
    setCloudStatus('online');
  } catch (err) {
    console.error(`Errore eliminazione item #${id}:`, err);
    setCloudStatus('error');
  }
}

export async function syncCategoriesToSupabase(categories) {
  if (!supabaseClient || !currentUser) return;

  try {
    const payload = categories.map(c => ({ id: c, name: c }));
    const { error } = await supabaseClient.from('categories').upsert(payload);
    if (error) throw error;
    setCloudStatus('online');
  } catch (err) {
    console.error('Errore sync categorie:', err);
    setCloudStatus('error');
  }
}

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
        if (eventType === 'INSERT') {
          const exists = appData.items.some(i => i.id === Number(newRow.id));
          if (!exists) {
            appData.items.unshift(formatRowToItem(newRow));
            callbacks.onDataChange();
          }
        } else if (eventType === 'UPDATE') {
          const idx = appData.items.findIndex(i => i.id === Number(newRow.id));
          if (idx !== -1) {
            appData.items[idx] = formatRowToItem(newRow);
            callbacks.onDataChange();
          }
        } else if (eventType === 'DELETE') {
          if (oldRow && oldRow.id) {
            appData.items = appData.items.filter(i => i.id !== Number(oldRow.id));
            callbacks.onDataChange();
          }
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
