// js/scanner.js

export let html5QrCodeScanner = null;
export let lastDetectedCheckItem = null;
let isScanThrottled = false;
let lastDecodedCode = null;

// Endpoint del tuo Cloudflare Worker personale
const WORKER_ENDPOINT = "https://weathered-salad-0133.valentegabriele00.workers.dev/";

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
// 1. NORMALIZZAZIONE E PULIZIA ISBN-13 / EAN
// ----------------------------------------------------
export function cleanAndExtractIsbn(rawBarcode) {
  if (!rawBarcode) return null;
  const digitsOnly = String(rawBarcode).replace(/[^0-9X]/gi, '');

  const match13 = digitsOnly.match(/(97[89]\d{10})/);
  if (match13) return match13[1];

  if (digitsOnly.length === 10) return digitsOnly;
  if (digitsOnly.startsWith('978') || digitsOnly.startsWith('979')) return digitsOnly.slice(0, 13);

  return digitsOnly;
}

// ----------------------------------------------------
// 2. PARSING METADATI MANGA E NUMERO VOLUME
// ----------------------------------------------------
export function parseMangaMetadata(mainTitle = '', subTitle = '') {
  let combined = `${mainTitle} ${subTitle}`.trim();
  let title = mainTitle.trim();
  let volume = '1';
  let isVariant = /variant/i.test(combined);

  const volRegex = /(?:[#№]|vol\.?|volume|n\.?|numero)\s*(\d+)/i;
  const trailingNumRegex = /(?:^|\s+)(\d+)(?:\s*\[.*\]|\s*\(.*\))?$/;

  if (subTitle) {
    const subVolMatch = subTitle.match(volRegex) || subTitle.match(trailingNumRegex);
    if (subVolMatch) volume = subVolMatch[1];
  }

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
// 3. RICERCA ISBN TRAMITE CLOUDFLARE WORKER
// ----------------------------------------------------
async function fetchWithTimeout(url, timeoutMs = 3500) {
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
    return { title: '', volume: '1', category: 'Manga', isVariant: false, isbn: '', found: false };
  }

  try {
    const targetUrl = `${WORKER_ENDPOINT}?isbn=${cleanIsbn}`;
    const res = await fetchWithTimeout(targetUrl, 3500);

    if (res && res.ok) {
      const data = await res.json();
      if (data.found && data.title) {
        const parsed = parseMangaMetadata(data.title, data.subtitle || '');
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
  } catch (e) {
    console.warn("Worker non raggiungibile:", e);
  }

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
// 4. GESTIONE SCANNER FOTOCAMERA (ANTI-FLICKER)
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
    fps: 10,
    experimentalFeatures: {
      useBarCodeDetectorIfSupported: true
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
    }, 2000);
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
  if (descElem) descElem.textContent = 'Verifica i permessi fotocamera nelle impostazioni del browser.';
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
// 5. GESTIONE RISULTATO E AZIONE RAPIDA
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
    category: searchResult.category || (activeCategory !== 'Tutte' ? activeCategory : 'Manga'),
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

  // Controllo se già in Posseduti
  const ownedMatch = appData.items.find(i =>
    i.set === 'Posseduti' &&
    (
      (i.isbn && i.isbn === cleanIsbn) ||
      (lastDetectedCheckItem.title && i.title.trim().toLowerCase() === lastDetectedCheckItem.title.toLowerCase() && String(i.number || '') === String(lastDetectedCheckItem.number || ''))
    )
  );

  // Controllo se già in Acquisti
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
    if (titleElem) titleElem.textContent = `GIÀ POSSEDUTO (#${ownedMatch.number || '1'})`;
    if (descElem) descElem.textContent = `"${ownedMatch.title}" è già presente nella tua collezione.`;

    if (fastAddBtn) fastAddBtn.style.display = 'none';
    if (editDetailsBtn) editDetailsBtn.style.display = 'none';
    return;
  }

  if (acquistiMatch) {
    if (resultBox) resultBox.className = 'checker-result-box green-signal';
    if (signalIcon) signalIcon.textContent = '📋';
    if (titleElem) titleElem.textContent = `IN ACQUISTI (#${acquistiMatch.number || '1'})`;
    if (descElem) descElem.textContent = `"${acquistiMatch.title}" è nella lista da comprare.`;

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
    if (resultBox) resultBox.className = 'checker-result-box green-signal';
    if (signalIcon) signalIcon.textContent = '✨';
    if (titleElem) titleElem.textContent = `${lastDetectedCheckItem.title} #${lastDetectedCheckItem.number}`;
    if (descElem) descElem.textContent = `Trovato! Pronto per ${targetSet}.`;

    if (fastAddBtn) {
      fastAddBtn.style.display = 'inline-flex';
      fastAddBtn.textContent = `+ Aggiungi a ${targetSet}`;
      fastAddBtn.onclick = () => {
        if (onFastAddCallback) onFastAddCallback('ADD_NEW', lastDetectedCheckItem);
      };
    }
    if (editDetailsBtn) editDetailsBtn.style.display = 'inline-flex';
  } else {
    if (resultBox) resultBox.className = 'checker-result-box idle';
    if (signalIcon) signalIcon.textContent = '✏️';
    if (titleElem) titleElem.textContent = `ISBN: ${cleanIsbn}`;
    if (descElem) descElem.textContent = `Non censito online. Inserisci il titolo:`;

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
