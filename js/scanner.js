// js/scanner.js

export let html5QrCodeScanner = null;
export let checkerScanner = null;
export let lastDetectedCheckItem = null;

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function detectCategory(title) {
  const t = (title || '').toLowerCase();
  if (/batman|superman|spider-man|x-men|marvel|dc|comic|deadpool|avengers/i.test(t)) {
    return 'Comics';
  }
  return 'Manga';
}

export async function searchIsbnData(isbn) {
  const rawDigits = isbn.replace(/[^0-9X]/gi, '');
  const cleanIsbn = rawDigits.length > 13 ? rawDigits.slice(0, 13) : rawDigits;

  let titleFound = '';
  let volumeFound = '1';
  let categoryFound = 'Manga';

  // 1. Google Books API
  try {
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${cleanIsbn}`);
    const data = await res.json();
    if (data.items && data.items.length > 0) {
      const info = data.items[0].volumeInfo;
      titleFound = info.title || '';
      const numMatch = (info.title + ' ' + (info.subtitle || '')).match(/(?:vol(?:ume)?\.?|n\.?|#)\s*(\d+)/i) || titleFound.match(/^(.*?)\s+#?(\d+)$/);
      if (numMatch) {
        volumeFound = numMatch[1] && !isNaN(numMatch[1]) ? numMatch[1] : (numMatch[2] || '1');
      }
      return { title: titleFound, volume: volumeFound, category: detectCategory(titleFound) };
    }
  } catch (e) {
    console.warn("Google Books fallito:", e);
  }

  // 2. Catalogo SBN / OPAC Italiano (ICCU)
  try {
    const sbnUrl = `https://opac.sbn.it/opacmobile/ricercaAvanzata?isbn=${cleanIsbn}&formato=json`;
    const resSbn = await fetch(sbnUrl);
    if (resSbn.ok) {
      const sbnData = await resSbn.json();
      if (sbnData && sbnData.risultati && sbnData.risultati.length > 0) {
        const item = sbnData.risultati[0];
        titleFound = item.titolo || item.titoloUniforme || '';

        if (titleFound.includes('/')) {
          titleFound = titleFound.split('/')[0].trim();
        }

        const numMatch = titleFound.match(/(?:vol(?:ume)?\.?|n\.?|#)\s*(\d+)/i) || titleFound.match(/(\d+)$/);
        if (numMatch) {
          volumeFound = numMatch[1];
          titleFound = titleFound.replace(numMatch[0], '').trim();
        }

        return { title: titleFound, volume: volumeFound, category: detectCategory(titleFound) };
      }
    }
  } catch (e) {
    console.warn("SBN OPAC fallito:", e);
  }

  // 3. Open Library (Fallback internazionale)
  try {
    const resOl = await fetch(`https://openlibrary.org/isbn/${cleanIsbn}.json`);
    if (resOl.ok) {
      const dataOl = await resOl.json();
      if (dataOl && dataOl.title) {
        titleFound = dataOl.title.trim();
        const numMatch = titleFound.match(/^(.*?)\s+#?(\d+)$/);
        if (numMatch) {
          titleFound = numMatch[1].trim();
          volumeFound = numMatch[2].trim();
        }
        return { title: titleFound, volume: volumeFound, category: detectCategory(titleFound) };
      }
    }
  } catch (e) {
    console.warn("Open Library fallito:", e);
  }

  return { title: '', volume: '1', category: 'Manga' };
}

export function resetCheckerPreview() {
  const box = document.getElementById('checkerResultBox');
  const icon = document.getElementById('checkerSignalIcon');
  const title = document.getElementById('checkerStatusTitle');
  const desc = document.getElementById('checkerStatusDesc');
  const btnAcquisti = document.getElementById('checkerAddToAcquistiBtn');
  const btnPosseduti = document.getElementById('checkerAddToPossedutiBtn');

  if (box) box.className = 'checker-result-box idle';
  if (icon) icon.textContent = '📷';
  if (title) title.textContent = 'Inquadra il codice a barre';
  if (desc) desc.textContent = 'Punta la fotocamera sull\'ISBN per verificare se è già presente in collezione.';
  if (btnAcquisti) btnAcquisti.style.display = 'none';
  if (btnPosseduti) btnPosseduti.style.display = 'none';
  lastDetectedCheckItem = null;
}

export function openCheckerModal(appData, activeCategory) {
  resetCheckerPreview();
  const modal = document.getElementById('checkerModalBackdrop');
  if (modal) modal.classList.add('active');

  if (!checkerScanner) {
    checkerScanner = new Html5Qrcode('checkerCameraReader');
  }

  checkerScanner.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: { width: 260, height: 160 } },
    async (decodedText) => {
      await processBarcodeVerification(decodedText, appData, activeCategory);
    },
    () => {}
  ).catch(() => {
    const t = document.getElementById('checkerStatusTitle');
    const d = document.getElementById('checkerStatusDesc');
    if (t) t.textContent = 'Fotocamera non disponibile';
    if (d) d.textContent = 'Verifica i permessi della fotocamera nel browser.';
  });
}

export function stopCheckerModal() {
  const modal = document.getElementById('checkerModalBackdrop');
  if (checkerScanner) {
    checkerScanner.stop().catch(() => {}).then(() => {
      if (modal) modal.classList.remove('active');
    });
  } else {
    if (modal) modal.classList.remove('active');
  }
}

export async function processBarcodeVerification(isbn, appData, activeCategory) {
  if (checkerScanner) {
    try { await checkerScanner.pause(); } catch(e) {}
  }

  const icon = document.getElementById('checkerSignalIcon');
  const statusTitle = document.getElementById('checkerStatusTitle');
  const statusDesc = document.getElementById('checkerStatusDesc');

  if (icon) icon.textContent = '⏳';
  if (statusTitle) statusTitle.textContent = 'Ricerca nel catalogo italiano...';
  if (statusDesc) statusDesc.textContent = `Codice: ${isbn}`;

  const rawDigits = isbn.replace(/[^0-9X]/gi, '');
  const cleanIsbn = rawDigits.length > 13 ? rawDigits.slice(0, 13) : rawDigits;

  const result = await searchIsbnData(cleanIsbn);

  let cat = result.category;
  if (activeCategory !== 'Tutte') {
    cat = activeCategory;
  }

  lastDetectedCheckItem = {
    isbn: cleanIsbn,
    title: result.title || '',
    number: result.volume || '1',
    category: cat,
    isVariant: false
  };

  displayBarcodeEvaluation(appData);
}

export function displayBarcodeEvaluation(appData) {
  if (!lastDetectedCheckItem) return;

  const { isbn, title, number, category, isVariant } = lastDetectedCheckItem;
  const box = document.getElementById('checkerResultBox');
  const icon = document.getElementById('checkerSignalIcon');
  const statusTitle = document.getElementById('checkerStatusTitle');
  const statusDesc = document.getElementById('checkerStatusDesc');
  const btnAcquisti = document.getElementById('checkerAddToAcquistiBtn');
  const btnPosseduti = document.getElementById('checkerAddToPossedutiBtn');

  const exactOwnedByIsbn = appData.items.find(i => 
    i.set === 'Posseduti' && 
    i.isbn && 
    i.isbn === isbn && 
    Boolean(i.isVariant) === Boolean(isVariant)
  );

  const exactOwnedByTitle = title ? appData.items.find(i => 
    i.set === 'Posseduti' && 
    i.title.toLowerCase() === title.toLowerCase() && 
    String(i.number || '') === String(number) &&
    Boolean(i.isVariant) === Boolean(isVariant)
  ) : null;

  const existingItem = exactOwnedByIsbn || exactOwnedByTitle;

  if (existingItem) {
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    if (box) box.className = 'checker-result-box red-signal';
    if (icon) icon.textContent = '⛔';
    if (statusTitle) statusTitle.textContent = isVariant ? 'VARIANT GIÀ IN COLLEZIONE!' : 'GIÀ PRESENTE IN COLLEZIONE!';
    if (statusDesc) {
      statusDesc.innerHTML = `
        Possiedi già "<strong>${escapeHtml(existingItem.title)}</strong>" (Vol. #${escapeHtml(existingItem.number || '1')}) nei tuoi Posseduti!
        <div style="font-size: 0.75rem; color: var(--text-dim); margin-top: 4px;">ISBN: ${escapeHtml(isbn)}</div>
      `;
    }
    if (btnAcquisti) btnAcquisti.style.display = 'none';
    if (btnPosseduti) btnPosseduti.style.display = 'none';
  } else {
    if (navigator.vibrate) navigator.vibrate(80);
    if (box) box.className = 'checker-result-box green-signal';
    if (icon) icon.textContent = '✅';
    if (statusTitle) statusTitle.textContent = 'NON PRESENTE: CONFERMA I DATI';

    const categoryOptionsHtml = appData.categories.map(c => {
      const isSelected = c.toLowerCase() === (category || 'Generale').toLowerCase();
      return `<option value="${escapeHtml(c)}" ${isSelected ? 'selected' : ''}>${escapeHtml(c)}</option>`;
    }).join('');

    if (statusDesc) {
      statusDesc.innerHTML = `
        <div class="scanner-preview-card" style="background: rgba(0,0,0,0.35); padding: 10px; border-radius: 8px; margin-top: 8px; display: flex; flex-direction: column; gap: 8px;">
          <div>
            <label style="font-size: 0.72rem; color: var(--text-dim); text-transform: uppercase; font-weight: 700;">Titolo Opera:</label>
            <input type="text" id="scannerCustomTitle" value="${escapeHtml(title)}" placeholder="Inserisci il titolo dell'opera..." style="width: 100%; margin-top: 2px; padding: 6px 8px; font-size: 0.9rem; font-weight: 600;">
          </div>
          <div style="display: flex; gap: 8px;">
            <div style="flex: 1;">
              <label style="font-size: 0.72rem; color: var(--text-dim); text-transform: uppercase; font-weight: 700;">Volume #:</label>
              <input type="text" id="scannerCustomVol" value="${escapeHtml(number)}" placeholder="es. 1" style="width: 100%; margin-top: 2px; padding: 6px 8px; font-size: 0.85rem;">
            </div>
            <div style="flex: 1.2;">
              <label style="font-size: 0.72rem; color: var(--text-dim); text-transform: uppercase; font-weight: 700;">Categoria:</label>
              <select id="scannerCustomCat" style="width: 100%; margin-top: 2px; padding: 6px 8px; font-size: 0.85rem;">
                ${categoryOptionsHtml}
              </select>
            </div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 6px; margin-top: 2px;">
            <div style="font-size: 0.75rem; color: var(--accent-cyan); font-weight: 700;">ISBN: ${escapeHtml(isbn)}</div>
            <label class="checkbox-row">
              <input type="checkbox" id="scannerVariantCheck" ${isVariant ? 'checked' : ''}>
              <span class="custom-chk"></span>
              <span style="font-size: 0.8rem; font-weight: 700;">★ Variant</span>
            </label>
          </div>
        </div>
      `;

      const variantChk = document.getElementById('scannerVariantCheck');
      if (variantChk) {
        variantChk.addEventListener('change', (e) => {
          lastDetectedCheckItem.isVariant = e.target.checked;
        });
      }
    }

    if (btnAcquisti) btnAcquisti.style.display = 'inline-flex';
    if (btnPosseduti) btnPosseduti.style.display = 'inline-flex';
  }
}
