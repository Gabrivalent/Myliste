// js/scanner.js

export let html5QrCodeScanner = null;
export let lastDetectedCheckItem = null;
let isScanThrottled = false;
let lastDecodedCode = null;

// Endpoint Cloudflare Worker
const WORKER_ENDPOINT = "https://weathered-salad-0133.valentegabriele00.workers.dev/";

// Memorizzazione categoria persistente per le scansioni
export function getLastScanCategory(fallback = 'Manga') {
  return localStorage.getItem('last_scan_category') || fallback;
}

export function setLastScanCategory(category) {
  if (category) {
    localStorage.setItem('last_scan_category', category);
  }
}

export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function cleanAndExtractIsbn(rawBarcode) {
  if (!rawBarcode) return null;
  const digitsOnly = String(rawBarcode).replace(/[^0-9X]/gi, '');
  const match13 = digitsOnly.match(/(97[89]\d{10})/);
  if (match13) return match13[1];
  if (digitsOnly.length === 10) return digitsOnly;
  if (digitsOnly.startsWith('978') || digitsOnly.startsWith('979')) return digitsOnly.slice(0, 13);
  return digitsOnly;
}

export function cleanVolumeNumber(rawNum) {
  if (!rawNum) return '';
  const trimmed = String(rawNum).trim();
  if (/^(n|none|u|unico|-)$/i.test(trimmed)) {
    return '';
  }
  return trimmed;
}

export function parseMangaMetadata(mainTitle = '', subTitle = '') {
  let combined = `${mainTitle} ${subTitle}`.trim();
  let title = mainTitle.trim();
  let volume = '';
  let isVariant = /variant/i.test(combined);

  const volRegex = /(?:[#№]|vol\.?|volume|n\.?|numero)\s*(\d+)/i;
  const trailingNumRegex = /(?:^|\s+)(\d+)(?:\s*\[.*\]|\s*\(.*\))?$/;

  if (subTitle) {
    const subVolMatch = subTitle.match(volRegex) || subTitle.match(trailingNumRegex);
    if (subVolMatch) volume = subVolMatch[1];
  }

  if (!volume) {
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
    volume: cleanVolumeNumber(volume),
    isVariant
  };
}

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
  const rememberedCategory = getLastScanCategory('Manga');

  if (!cleanIsbn) {
    return { title: '', volume: '', category: rememberedCategory, isVariant: false, isbn: '', found: false };
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
          category: rememberedCategory,
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
    volume: '',
    category: rememberedCategory,
    isVariant: false,
    isbn: cleanIsbn,
    found: false
  };
}

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

  // La categoria di default è l'ultima usata in precedenza
  const defaultCategory = getLastScanCategory(activeCategory !== 'Tutte' ? activeCategory : 'Manga');

  lastDetectedCheckItem = {
    isbn: cleanIsbn,
    title: searchResult.title || '',
    number: cleanVolumeNumber(searchResult.volume),
    category: defaultCategory,
    isVariant: searchResult.isVariant
  };

  const customTitle = document.getElementById('scannerCustomTitle');
  const customVol = document.getElementById('scannerCustomVol');
  const customCat = document.getElementById('scannerCustomCat');
  const customVariant = document.getElementById('scannerCustomVariant');
  const scannerVariantWrapper = document.getElementById('scannerVariantGroupWrapper');

  if (customTitle) customTitle.value = lastDetectedCheckItem.title;
  if (customVol) customVol.value = lastDetectedCheckItem.number;
  if (customCat) {
    customCat.value = defaultCategory;
    // Ascolta il cambio per memorizzarlo come default
    customCat.onchange = (e) => {
      setLastScanCategory(e.target.value);
      const isManga = /manga|comic|fumett/i.test(e.target.value);
      if (scannerVariantWrapper) scannerVariantWrapper.style.display = isManga ? 'flex' : 'none';
    };
  }
  if (customVariant) customVariant.checked = Boolean(lastDetectedCheckItem.isVariant);

  const isComicOrManga = /manga|comic|fumett/i.test(defaultCategory);
  if (scannerVariantWrapper) {
    scannerVariantWrapper.style.display = isComicOrManga ? 'flex' : 'none';
  }

  const ownedMatch = appData.items.find(i =>
    i.set === 'Posseduti' &&
    (
      (i.isbn && i.isbn === cleanIsbn) ||
      (lastDetectedCheckItem.title && i.title.trim().toLowerCase() === lastDetectedCheckItem.title.toLowerCase() && cleanVolumeNumber(i.number) === lastDetectedCheckItem.number)
    )
  );

  const acquistiMatch = appData.items.find(i =>
    i.set === 'Acquisti' &&
    (
      (i.isbn && i.isbn === cleanIsbn) ||
      (lastDetectedCheckItem.title && i.title.trim().toLowerCase() === lastDetectedCheckItem.title.toLowerCase() && cleanVolumeNumber(i.number) === lastDetectedCheckItem.number)
    )
  );

  if (ownedMatch) {
    const ownedDisplayNum = ownedMatch.number ? ` (#${ownedMatch.number})` : '';
    if (resultBox) resultBox.className = 'checker-result-box red-signal';
    if (signalIcon) signalIcon.textContent = '❌';
    if (titleElem) titleElem.textContent = `GIÀ POSSEDUTO${ownedDisplayNum}`;
    if (descElem) descElem.textContent = `"${ownedMatch.title}" è già presente nella tua collezione.`;

    if (fastAddBtn) fastAddBtn.style.display = 'none';
    if (editDetailsBtn) editDetailsBtn.style.display = 'none';
    if (detailsPanel) detailsPanel.style.display = 'none';
    return;
  }

  if (acquistiMatch) {
    const acqDisplayNum = acquistiMatch.number ? ` (#${acquistiMatch.number})` : '';
    if (resultBox) resultBox.className = 'checker-result-box green-signal';
    if (signalIcon) signalIcon.textContent = '📋';
    if (titleElem) titleElem.textContent = `IN ACQUISTI${acqDisplayNum}`;
    if (descElem) descElem.textContent = `"${acquistiMatch.title}" è nella lista da comprare.`;

    if (fastAddBtn) {
      fastAddBtn.style.display = 'inline-flex';
      fastAddBtn.textContent = '✓ Spunta come Comprato';
      fastAddBtn.onclick = () => {
        if (onFastAddCallback) onFastAddCallback('BUY_EXISTING', acquistiMatch);
      };
    }
    if (editDetailsBtn) editDetailsBtn.style.display = 'none';
    if (detailsPanel) detailsPanel.style.display = 'none';
    return;
  }

  const targetSetSelect = document.getElementById('scannerTargetSetPreset');
  const targetSet = targetSetSelect ? targetSetSelect.value : 'Posseduti';

  // In entrambi i casi (riconosciuto o non riconosciuto) mostriamo il pannello
  // con la categoria sempre selezionabile e impostata sulla precedente
  if (detailsPanel) detailsPanel.style.display = 'flex';
  if (editDetailsBtn) editDetailsBtn.style.display = 'none';

  if (searchResult.found) {
    const displayNum = lastDetectedCheckItem.number ? ` #${lastDetectedCheckItem.number}` : '';
    if (resultBox) resultBox.className = 'checker-result-box green-signal';
    if (signalIcon) signalIcon.textContent = '✨';
    if (titleElem) titleElem.textContent = `${lastDetectedCheckItem.title}${displayNum}`;
    if (descElem) descElem.textContent = `Verifica la categoria e premi per aggiungere a ${targetSet}:`;

    if (fastAddBtn) {
      fastAddBtn.style.display = 'inline-flex';
      fastAddBtn.textContent = `+ Aggiungi a ${targetSet}`;
      fastAddBtn.onclick = () => {
        if (onFastAddCallback) onFastAddCallback('ADD_NEW', lastDetectedCheckItem);
      };
    }
  } else {
    if (resultBox) resultBox.className = 'checker-result-box idle';
    if (signalIcon) signalIcon.textContent = '✏️';
    if (titleElem) titleElem.textContent = `ISBN: ${cleanIsbn}`;
    if (descElem) descElem.textContent = `Non censito online. Inserisci il titolo:`;

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
