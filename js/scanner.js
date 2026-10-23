// js/scanner.js

export let html5QrCodeScanner = null;
export let lastDetectedCheckItem = null;
let isScanThrottled = false;
let lastDecodedCode = null;

export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ----------------------------------------------------
// 1. NORMALIZZAZIONE RIGIDA ISBN (EAN-13 SENZA ADD-ON EDICOLA)
// ----------------------------------------------------
export function cleanAndExtractIsbn(rawBarcode) {
  if (!rawBarcode) return null;
  const digitsOnly = String(rawBarcode).replace(/[^0-9X]/gi, '');

  // Cerca un pattern ISBN-13 standard (inizia con 978 o 979, seguito da 10 cifre)
  const match13 = digitsOnly.match(/(97[89]\d{10})/);
  if (match13) {
    return match13[1];
  }

  // Fallback per vecchi codici a 10 cifre
  if (digitsOnly.length === 10) {
    return digitsOnly;
  }

  // Se è più lungo ma comincia con 978/979, taglia i primi 13 caratteri
  if (digitsOnly.startsWith('978') || digitsOnly.startsWith('979')) {
    return digitsOnly.slice(0, 13);
  }

  return digitsOnly;
}

// ----------------------------------------------------
// 2. PARSING TITOLO, SOTTOTITOLO E NUMERO VOLUME
// ----------------------------------------------------
export function parseMangaMetadata(mainTitle = '', subTitle = '') {
  let combined = `${mainTitle} ${subTitle}`.trim();
  let title = mainTitle.trim();
  let volume = '1';
  let isVariant = /variant/i.test(combined);

  // Pattern per identificare il volume (es: Vol. 5, N. 12, #3, Volume 4, o numero isolato nel sottotitolo)
  const volRegex = /(?:[#№]|vol\.?|volume|n\.?|numero)\s*(\d+)/i;
  const trailingNumRegex = /(?:^|\s+)(\d+)(?:\s*\[.*\]|\s*\(.*\))?$/;

  // 1. Prova prima ad estrarre il volume dal sottotitolo (dove spesso gli editori IT lo inseriscono)
  if (subTitle) {
    const subVolMatch = subTitle.match(volRegex) || subTitle.match(trailingNumRegex);
    if (subVolMatch) {
      volume = subVolMatch[1];
    }
  }

  // 2. Se non trovato nel sottotitolo, cercalo nel titolo principale
  if (volume === '1') {
    const titleVolMatch = title.match(volRegex);
    if (titleVolMatch) {
      volume = titleVolMatch[1];
      title = title.replace(titleVolMatch[0], '').trim();
    } else {
      const trailingMatch = title.match(trailingNumRegex);
      if (trailingMatch) {
        volume = trailingMatch[1];
        title = title.replace(trailingMatch[0], '').trim();
      }
    }
  }

  // Pulizia suffissi editoriali standard
  title = title
    .replace(/[:\-–]\s*$/g, '')
    .replace(/\s*-\s*edizione italiana.*$/i, '')
    .replace(/\s*\(.*variant.*\)$/i, '')
    .replace(/\s*\[.*variant.*\]$/i, '')
    .trim();

  return {
    title: title || mainTitle.trim(),
    volume: String(parseInt(volume, 10) || 1),
    isVariant
  };
}

// ----------------------------------------------------
// 3. RICERCA ULTRA-RAPIDA CON TIMEOUT (GOOGLE BOOKS IT + OPEN LIBRARY)
// ----------------------------------------------------
async function fetchWithTimeout(url, timeoutMs = 1800) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    return null;
  }
}

export async function searchIsbnData(rawIsbn) {
  const cleanIsbn = cleanAndExtractIsbn(rawIsbn);
  if (!cleanIsbn) {
    return { title: '', volume: '1', category: 'Manga', isVariant: false, isbn: '' };
  }

  // A) Google Books IT diretto (Senza CORS, veloce)
  try {
    const gUrl = `https://www.googleapis.com/books/v1/volumes?q=isbn:${cleanIsbn}&langRestrict=it&maxResults=1`;
    const res = await fetchWithTimeout(gUrl, 1800);

    if (res && res.ok) {
      const data = await res.json();
      if (data.totalItems > 0 && data.items && data.items[0]) {
        const info = data.items[0].volumeInfo;
        const parsed = parseMangaMetadata(info.title || '', info.subtitle || '');

        let cat = 'Manga';
        if (info.categories && info.categories.some(c => /comic|fumett|graphic/i.test(c))) {
          cat = 'Comics';
        }

        return {
          title: parsed.title,
          volume: parsed.volume,
          category: cat,
          isVariant: parsed.isVariant,
          isbn: cleanIsbn,
          found: true
        };
      }
    }
  } catch (e) {
    console.warn('Google Books IT timeout/errore');
  }

  // B) Fallback immediato Open Library (se Google non ha l'opera)
  try {
    const olUrl = `https://openlibrary.org/api/books?bibkeys=ISBN:${cleanIsbn}&format=json&jscmd=data`;
    const res = await fetchWithTimeout(olUrl, 1200);

    if (res && res.ok) {
      const data = await res.json();
      const bookKey = `ISBN:${cleanIsbn}`;
      if (data[bookKey]) {
        const parsed = parseMangaMetadata(data[bookKey].title || '', data[bookKey].subtitle || '');
        return {
          title: parsed.title,
          volume: parsed.volume,
          category: 'Manga',
          isVariant: parsed.isVariant,
          isbn: cleanIsbn,
          found: true
        };
      }
    }
  } catch (e) {}

  // C) Default se non censito nei cataloghi generici
  return {
    title: '',
    volume: '1',
    category: 'Manga',
    isVariant: false,
    isbn: cleanIsbn,
    found: false
  };
}

// ----------------------------------------------------
// 4. MOTORE SCANNER CAMERA CON PREVENZIONE DOPPIE SCANSIONI
// ----------------------------------------------------
export function openCheckerModal(appData, activeCategory, onFastAddCallback) {
  const modal = document.getElementById('checkerModalBackdrop');
  if (!modal) return;

  resetCheckerPreview();
  modal.classList.add('active');

  const readerId = 'checkerCameraReader';

  if (html5QrCodeScanner) {
    try {
      html5QrCodeScanner.stop().catch(() => {}).then(() => {
        startScannerEngine(readerId, appData, activeCategory, onFastAddCallback);
      });
      return;
    } catch (e) {
      html5QrCodeScanner = null;
    }
  }

  startScannerEngine(readerId, appData, activeCategory, onFastAddCallback);
}

function startScannerEngine(readerId, appData, activeCategory, onFastAddCallback) {
  html5QrCodeScanner = new Html5Qrcode(readerId);
  isScanThrottled = false;
  lastDecodedCode = null;

  const config = {
    fps: 12,
    qrbox: (w, h) => {
      const minEdge = Math.min(w, h);
      return {
        width: Math.floor(minEdge * 0.85),
        height: Math.floor(minEdge * 0.55)
      };
    }
  };

  const onSuccess = async (decodedText) => {
    const validIsbn = cleanAndExtractIsbn(decodedText);
    if (!validIsbn || isScanThrottled || validIsbn === lastDecodedCode) return;

    isScanThrottled = true;
    lastDecodedCode = validIsbn;

    await handleBarcodeScanned(validIsbn, appData, activeCategory, onFastAddCallback);

    setTimeout(() => {
      isScanThrottled = false;
    }, 1500);
  };

  html5QrCodeScanner.start({ facingMode: "environment" }, config, onSuccess, () => {})
    .catch(() => {
      Html5Qrcode.getCameras().then(devices => {
        if (devices && devices.length > 0) {
          const cameraId = devices[devices.length - 1].id;
          html5QrCodeScanner.start(cameraId, config, onSuccess, () => {}).catch(reportCameraError);
        } else {
          reportCameraError();
        }
      }).catch(reportCameraError);
    });
}

function reportCameraError() {
  const titleElem = document.getElementById('checkerStatusTitle');
  const descElem = document.getElementById('checkerStatusDesc');
  if (titleElem) titleElem.textContent = 'Fotocamera non disponibile';
  if (descElem) descElem.textContent = 'Verifica che i permessi della fotocamera siano attivi nelle impostazioni del browser.';
}

export function stopCheckerModal() {
  const modal = document.getElementById('checkerModalBackdrop');
  if (modal) modal.classList.remove('active');

  if (html5QrCodeScanner) {
    html5QrCodeScanner.stop().catch(() => {}).then(() => {
      html5QrCodeScanner = null;
    });
  }
}

export function resetCheckerPreview() {
  const resultBox = document.getElementById('checkerResultBox');
  const signalIcon = document.getElementById('checkerSignalIcon');
  const titleElem = document.getElementById('checkerStatusTitle');
  const descElem = document.getElementById('checkerStatusDesc');
  const fastAddBtn = document.getElementById('checkerFastAddBtn');
  const editDetailsBtn = document.getElementById('checkerEditDetailsBtn');
  const detailsPanel = document.getElementById('checkerManualDetailsPanel');

  if (resultBox) resultBox.className = 'checker-result-box idle';
  if (signalIcon) signalIcon.textContent = '📷';
  if (titleElem) titleElem.textContent = 'Inquadra il codice a barre';
  if (descElem) descElem.textContent = 'Punta la fotocamera sull\'ISBN per verificare o aggiungere istantaneamente.';
  if (fastAddBtn) fastAddBtn.style.display = 'none';
  if (editDetailsBtn) editDetailsBtn.style.display = 'none';
  if (detailsPanel) detailsPanel.style.display = 'none';

  lastDetectedCheckItem = null;
}

// ----------------------------------------------------
// 5. GESTIONE RISULTATO E AZIONE 1-TAP
// ----------------------------------------------------
async function handleBarcodeScanned(cleanIsbn, appData, activeCategory, onFastAddCallback) {
  const resultBox = document.getElementById('checkerResultBox');
  const signalIcon = document.getElementById('checkerSignalIcon');
  const titleElem = document.getElementById('checkerStatusTitle');
  const descElem = document.getElementById('checkerStatusDesc');
  const fastAddBtn = document.getElementById('checkerFastAddBtn');
  const editDetailsBtn = document.getElementById('checkerEditDetailsBtn');
  const detailsPanel = document.getElementById('checkerManualDetailsPanel');

  if (signalIcon) signalIcon.textContent = '⏳';
  if (titleElem) titleElem.textContent = 'Ricerca in corso...';
  if (descElem) descElem.textContent = `ISBN: ${cleanIsbn}`;

  const searchResult = await searchIsbnData(cleanIsbn);

  lastDetectedCheckItem = {
    isbn: cleanIsbn,
    title: searchResult.title || '',
    number: searchResult.volume || '1',
    category: searchResult.category || (activeCategory !== 'Tutte' ? activeCategory : 'Generale'),
    isVariant: searchResult.isVariant
  };

  const customTitle = document.getElementById('scannerCustomTitle');
  const customVol = document.getElementById('scannerCustomVol');
  const customCat = document.getElementById('scannerCustomCat');
  const customVariant = document.getElementById('scannerCustomVariant');

  if (customTitle) customTitle.value = lastDetectedCheckItem.title;
  if (customVol) customVol.value = lastDetectedCheckItem.number;
  if (customCat) customCat.value = lastDetectedCheckItem.category;
  if (customVariant) customVariant.checked = Boolean(lastDetectedCheckItem.isVariant);

  // Controllo se è già presente nella collezione locale
  const ownedMatch = appData.items.find(i =>
    i.set === 'Posseduti' &&
    (
      (i.isbn && i.isbn === cleanIsbn) ||
      (lastDetectedCheckItem.title && i.title.trim().toLowerCase() === lastDetectedCheckItem.title.toLowerCase() && String(i.number || '') === String(lastDetectedCheckItem.number || ''))
    )
  );

  const acquistiMatch = appData.items.find(i =>
    i.set === 'Acquisti' &&
    (
      (i.isbn && i.isbn === cleanIsbn) ||
      (lastDetectedCheckItem.title && i.title.trim().toLowerCase() === lastDetectedCheckItem.title.toLowerCase() && String(i.number || '') === String(lastDetectedCheckItem.number || ''))
    )
  );

  if (ownedMatch) {
    if (resultBox) resultBox.className = 'checker-result-box red-signal';
    if (signalIcon) signalIcon.textContent = '❌';
    if (titleElem) titleElem.textContent = `GIÀ POSSEDUTO (Vol. #${ownedMatch.number || '1'})`;
    if (descElem) descElem.textContent = `"${ownedMatch.title}" è già nella tua collezione nei Posseduti.`;

    if (fastAddBtn) fastAddBtn.style.display = 'none';
    if (editDetailsBtn) editDetailsBtn.style.display = 'none';
    return;
  }

  if (acquistiMatch) {
    if (resultBox) resultBox.className = 'checker-result-box green-signal';
    if (signalIcon) signalIcon.textContent = '📋';
    if (titleElem) titleElem.textContent = `PRESENTE IN ACQUISTI (Vol. #${acquistiMatch.number || '1'})`;
    if (descElem) descElem.textContent = `"${acquistiMatch.title}" è in lista da comprare.`;

    if (fastAddBtn) {
      fastAddBtn.style.display = 'inline-flex';
      fastAddBtn.textContent = '✓ Spunta come Comprato';
      fastAddBtn.onclick = () => {
        if (onFastAddCallback) onFastAddCallback('BUY_EXISTING', acquistiMatch);
      };
    }
    if (editDetailsBtn) editDetailsBtn.style.display = 'inline-flex';
    return;
  }

  const targetSetSelect = document.getElementById('scannerTargetSetPreset');
  const targetSet = targetSetSelect ? targetSetSelect.value : 'Posseduti';

  if (searchResult.found) {
    // Titolo riconosciuto online
    if (resultBox) resultBox.className = 'checker-result-box green-signal';
    if (signalIcon) signalIcon.textContent = '✨';
    if (titleElem) titleElem.textContent = `${lastDetectedCheckItem.title} #${lastDetectedCheckItem.number}`;
    if (descElem) descElem.textContent = `Trovato! Pronto da aggiungere a ${targetSet}.`;

    if (fastAddBtn) {
      fastAddBtn.style.display = 'inline-flex';
      fastAddBtn.textContent = `+ Aggiungi a ${targetSet} (1-Tap)`;
      fastAddBtn.onclick = () => {
        if (onFastAddCallback) onFastAddCallback('ADD_NEW', lastDetectedCheckItem);
      };
    }
    if (editDetailsBtn) editDetailsBtn.style.display = 'inline-flex';
  } else {
    // Barcode valido ma titolo non indicizzato online: apre subito i campi per digitare al volo
    if (resultBox) resultBox.className = 'checker-result-box idle';
    if (signalIcon) signalIcon.textContent = '✏️';
    if (titleElem) titleElem.textContent = `ISBN: ${cleanIsbn}`;
    if (descElem) descElem.textContent = `Non censito online. Digita il titolo qui sotto e salva:`;

    if (detailsPanel) detailsPanel.style.display = 'flex';
    if (editDetailsBtn) editDetailsBtn.style.display = 'none';

    if (fastAddBtn) {
      fastAddBtn.style.display = 'inline-flex';
      fastAddBtn.textContent = `+ Salva in ${targetSet}`;
      fastAddBtn.onclick = () => {
        if (onFastAddCallback) onFastAddCallback('ADD_NEW', lastDetectedCheckItem);
      };
    }

    if (customTitle) customTitle.focus();
  }
}
