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

export function parseMangaTitleAndVolume(rawTitle) {
  if (!rawTitle) return { title: '', volume: '1', isVariant: false };

  let title = rawTitle.trim();
  let volume = '1';
  let isVariant = false;

  if (/variant/i.test(title)) {
    isVariant = true;
  }

  // Cerca pattern tipo: Titolo 12, Titolo n. 12, Titolo #12, Titolo vol. 12
  const volRegex = /(?:[#№]|vol\.?|volume|n\.?)\s*(\d+)/i;
  const trailingNumRegex = /\s+(\d+)(?:\s*\[.*\]|\s*\(.*\))?$/;

  const matchVol = title.match(volRegex);
  if (matchVol) {
    volume = matchVol[1];
    title = title.replace(matchVol[0], '').trim();
  } else {
    const matchTrailing = title.match(trailingNumRegex);
    if (matchTrailing) {
      volume = matchTrailing[1];
      title = title.replace(matchTrailing[0], '').trim();
    }
  }

  // Pulizia suffissi editoriali tipici italiani
  title = title.replace(/\s*-\s*edizione italiana.*$/i, '');
  title = title.replace(/\s*\(.*variant.*\)$/i, '');
  title = title.replace(/\s*\[.*variant.*\]$/i, '');

  return {
    title: title.trim(),
    volume: String(parseInt(volume, 10) || 1),
    isVariant
  };
}

// ----------------------------------------------------
// MULTI-PROVIDER ISBN LOOKUP (SBN OPAC -> GOOGLE BOOKS -> OPEN LIBRARY)
// ----------------------------------------------------
export async function searchIsbnData(isbn) {
  const cleanIsbn = isbn.replace(/[^0-9X]/gi, '');

  // 1. Tenta query su SBN OPAC Italiano (Migliore per manga italiani)
  try {
    const sbnUrl = `https://opac.sbn.it/oai-pmh?verb=GetRecord&identifier=oai:oaicat.sbn.it:${cleanIsbn}&metadataPrefix=marc21`;
    const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(sbnUrl)}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data.contents && data.contents.includes('<title>')) {
        const titleMatch = data.contents.match(/<title>(.*?)<\/title>/i);
        if (titleMatch && titleMatch[1]) {
          const parsed = parseMangaTitleAndVolume(titleMatch[1]);
          return {
            title: parsed.title,
            volume: parsed.volume,
            category: 'Manga',
            isVariant: parsed.isVariant,
            isbn: cleanIsbn,
            provider: 'SBN OPAC'
          };
        }
      }
    }
  } catch (e) {
    console.warn('Fallback da SBN a Google Books...');
  }

  // 2. Fallback su Google Books API
  try {
    const gUrl = `https://www.googleapis.com/books/v1/volumes?q=isbn:${cleanIsbn}`;
    const res = await fetch(gUrl);
    if (res.ok) {
      const data = await res.json();
      if (data.totalItems > 0 && data.items && data.items[0]) {
        const info = data.items[0].volumeInfo;
        const parsed = parseMangaTitleAndVolume(info.title);
        
        let cat = 'Manga';
        if (info.categories && info.categories.some(c => /comic|graphic novel/i.test(c))) {
          cat = 'Comics';
        }

        return {
          title: parsed.title,
          volume: parsed.volume,
          category: cat,
          isVariant: parsed.isVariant,
          isbn: cleanIsbn,
          provider: 'Google Books'
        };
      }
    }
  } catch (e) {
    console.warn('Fallback da Google Books a Open Library...');
  }

  // 3. Fallback su Open Library
  try {
    const olUrl = `https://openlibrary.org/api/books?bibkeys=ISBN:${cleanIsbn}&format=json&jscmd=data`;
    const res = await fetch(olUrl);
    if (res.ok) {
      const data = await res.json();
      const bookKey = `ISBN:${cleanIsbn}`;
      if (data[bookKey]) {
        const parsed = parseMangaTitleAndVolume(data[bookKey].title);
        return {
          title: parsed.title,
          volume: parsed.volume,
          category: 'Manga',
          isVariant: parsed.isVariant,
          isbn: cleanIsbn,
          provider: 'Open Library'
        };
      }
    }
  } catch (e) {}

  return {
    title: '',
    volume: '1',
    category: 'Manga',
    isVariant: false,
    isbn: cleanIsbn,
    provider: 'Manuale'
  };
}

// ----------------------------------------------------
// GESTIONE MODALE VERIFICA & SCANNER RAPIDO
// ----------------------------------------------------
export function openCheckerModal(appData, activeCategory, onFastAddCallback) {
  const modal = document.getElementById('checkerModalBackdrop');
  if (!modal) return;

  resetCheckerPreview();
  modal.classList.add('active');

  const readerId = 'checkerCameraReader';
  if (!html5QrCodeScanner) {
    html5QrCodeScanner = new Html5Qrcode(readerId);
  }

  isScanThrottled = false;
  lastDecodedCode = null;

  html5QrCodeScanner.start(
    { facingMode: 'environment' },
    {
      fps: 12,
      qrbox: { width: 260, height: 160 }
    },
    async (decodedText) => {
      if (isScanThrottled || decodedText === lastDecodedCode) return;
      isScanThrottled = true;
      lastDecodedCode = decodedText;

      handleBarcodeScanned(decodedText, appData, activeCategory, onFastAddCallback);

      // Throttling di 1.5s per evitare doppie letture involontarie
      setTimeout(() => {
        isScanThrottled = false;
      }, 1500);
    },
    () => {}
  ).catch((err) => {
    console.warn('Errore fotocamera scanner:', err);
    const titleElem = document.getElementById('checkerStatusTitle');
    const descElem = document.getElementById('checkerStatusDesc');
    if (titleElem) titleElem.textContent = 'Errore Accesso Fotocamera';
    if (descElem) descElem.textContent = 'Verifica i permessi per l\'uso della fotocamera nel browser.';
  });
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

  if (resultBox) {
    resultBox.className = 'checker-result-box idle';
  }
  if (signalIcon) signalIcon.textContent = '📷';
  if (titleElem) titleElem.textContent = 'Inquadra il codice a barre';
  if (descElem) descElem.textContent = 'Punta la fotocamera sull\'ISBN per verificare o aggiungere istantaneamente.';
  if (fastAddBtn) fastAddBtn.style.display = 'none';
  if (editDetailsBtn) editDetailsBtn.style.display = 'none';
  if (detailsPanel) detailsPanel.style.display = 'none';

  lastDetectedCheckItem = null;
}

// ----------------------------------------------------
// ANALISI DEL CODICE SCANSIONATO
// ----------------------------------------------------
async function handleBarcodeScanned(isbnText, appData, activeCategory, onFastAddCallback) {
  const resultBox = document.getElementById('checkerResultBox');
  const signalIcon = document.getElementById('checkerSignalIcon');
  const titleElem = document.getElementById('checkerStatusTitle');
  const descElem = document.getElementById('checkerStatusDesc');
  const fastAddBtn = document.getElementById('checkerFastAddBtn');
  const editDetailsBtn = document.getElementById('checkerEditDetailsBtn');

  if (signalIcon) signalIcon.textContent = '⏳';
  if (titleElem) titleElem.textContent = 'Ricerca ISBN in corso...';
  if (descElem) descElem.textContent = `Codice: ${isbnText}. Interrogo database SBN...`;

  const cleanDigits = isbnText.replace(/[^0-9X]/gi, '');
  const searchResult = await searchIsbnData(cleanDigits);

  lastDetectedCheckItem = {
    isbn: cleanDigits,
    title: searchResult.title || `Opera ISBN ${cleanDigits}`,
    number: searchResult.volume || '1',
    category: searchResult.category || (activeCategory !== 'Tutte' ? activeCategory : 'Generale'),
    isVariant: searchResult.isVariant
  };

  // Compila i campi nel pannello manuale opzionale
  const customTitle = document.getElementById('scannerCustomTitle');
  const customVol = document.getElementById('scannerCustomVol');
  const customCat = document.getElementById('scannerCustomCat');
  const customVariant = document.getElementById('scannerCustomVariant');

  if (customTitle) customTitle.value = lastDetectedCheckItem.title;
  if (customVol) customVol.value = lastDetectedCheckItem.number;
  if (customCat) customCat.value = lastDetectedCheckItem.category;
  if (customVariant) customVariant.checked = Boolean(lastDetectedCheckItem.isVariant);

  // Controllo se è già presente in collezione (per ISBN o Titolo + Volume)
  const ownedMatch = appData.items.find(i => 
    i.set === 'Posseduti' && 
    (
      (i.isbn && i.isbn === cleanDigits) ||
      (i.title.trim().toLowerCase() === lastDetectedCheckItem.title.toLowerCase() && String(i.number || '') === String(lastDetectedCheckItem.number || ''))
    )
  );

  const acquistiMatch = appData.items.find(i => 
    i.set === 'Acquisti' && 
    (
      (i.isbn && i.isbn === cleanDigits) ||
      (i.title.trim().toLowerCase() === lastDetectedCheckItem.title.toLowerCase() && String(i.number || '') === String(lastDetectedCheckItem.number || ''))
    )
  );

  if (ownedMatch) {
    if (resultBox) resultBox.className = 'checker-result-box red-signal';
    if (signalIcon) signalIcon.textContent = '❌';
    if (titleElem) titleElem.textContent = `GIÀ POSSEDUTO (Vol. #${ownedMatch.number || '1'})`;
    if (descElem) descElem.textContent = `"${ownedMatch.title}" fa già parte della tua collezione nei Posseduti.`;

    if (fastAddBtn) fastAddBtn.style.display = 'none';
    if (editDetailsBtn) editDetailsBtn.style.display = 'none';
  } else if (acquistiMatch) {
    if (resultBox) resultBox.className = 'checker-result-box green-signal';
    if (signalIcon) signalIcon.textContent = '📋';
    if (titleElem) titleElem.textContent = `PRESENTE IN ACQUISTI (Vol. #${acquistiMatch.number || '1'})`;
    if (descElem) descElem.textContent = `"${acquistiMatch.title}" è nella lista da comprare.`;

    if (fastAddBtn) {
      fastAddBtn.style.display = 'inline-flex';
      fastAddBtn.textContent = '✓ Spunta come Comprato';
      fastAddBtn.onclick = () => {
        if (onFastAddCallback) onFastAddCallback('BUY_EXISTING', acquistiMatch);
      };
    }
    if (editDetailsBtn) editDetailsBtn.style.display = 'inline-flex';
  } else {
    // Non posseduto: pronto per l'aggiunta 1-Tap rapida
    if (resultBox) resultBox.className = 'checker-result-box green-signal';
    if (signalIcon) signalIcon.textContent = '✨';
    if (titleElem) titleElem.textContent = `${lastDetectedCheckItem.title} #${lastDetectedCheckItem.number}`;
    if (descElem) descElem.textContent = `Non presente in collezione. Pronto da aggiungere subito!`;

    const targetSetSelect = document.getElementById('scannerTargetSetPreset');
    const targetSet = targetSetSelect ? targetSetSelect.value : 'Posseduti';

    if (fastAddBtn) {
      fastAddBtn.style.display = 'inline-flex';
      fastAddBtn.textContent = `+ Aggiungi a ${targetSet} (1-Tap)`;
      fastAddBtn.onclick = () => {
        if (onFastAddCallback) onFastAddCallback('ADD_NEW', lastDetectedCheckItem);
      };
    }
    if (editDetailsBtn) editDetailsBtn.style.display = 'inline-flex';
  }
}
