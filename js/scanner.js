// js/scanner.js
import { state } from './state.js';
import { syncItemToRemote } from './supabase.js';

let html5QrCodeScanner = null;
let currentDetectedIsbn = null;

export function initScannerModal() {
  const btnOpen = document.getElementById("btnOpenScanner");
  const mobBtnScanner = document.getElementById("mobBtnScanner");
  const btnClose = document.getElementById("btnCloseScanner");
  const backdrop = document.getElementById("scannerBackdrop");
  const btnConfirm = document.getElementById("btnConfirmScannedAdd");

  if (btnOpen) btnOpen.addEventListener("click", startCameraScanner);
  if (mobBtnScanner) mobBtnScanner.addEventListener("click", startCameraScanner);
  if (btnClose) btnClose.addEventListener("click", stopCameraScanner);

  if (btnConfirm) {
    btnConfirm.addEventListener("click", handleConfirmScannedAdd);
  }
}

export async function startCameraScanner() {
  const backdrop = document.getElementById("scannerBackdrop");
  const resultCard = document.getElementById("scannerResultCard");
  const reticle = document.getElementById("scannerReticle");

  backdrop.hidden = false;
  if (resultCard) resultCard.hidden = true;
  if (reticle) reticle.className = "scanner-target-reticle";

  if (!html5QrCodeScanner) {
    html5QrCodeScanner = new window.Html5Qrcode("scannerReader");
  }

  const config = {
    fps: 15,
    qrbox: { width: 250, height: 160 },
    aspectRatio: 1.0
  };

  try {
    await html5QrCodeScanner.start(
      { facingMode: "environment" },
      config,
      onScanSuccess,
      () => {} // Ignora frame senza barcode
    );
  } catch (err) {
    console.error("Errore avvio fotocamera:", err);
    alert("Impossibile accedere alla fotocamera. Verifica i permessi del browser.");
    stopCameraScanner();
  }
}

export async function stopCameraScanner() {
  const backdrop = document.getElementById("scannerBackdrop");
  backdrop.hidden = true;

  if (html5QrCodeScanner) {
    try {
      await html5QrCodeScanner.stop();
    } catch {}
  }
}

async function onScanSuccess(decodedText) {
  currentDetectedIsbn = decodedText.trim();
  const reticle = document.getElementById("scannerReticle");
  const resultCard = document.getElementById("scannerResultCard");
  const banner = document.getElementById("resultFeedbackBanner");
  const feedbackIcon = document.getElementById("feedbackIcon");
  const feedbackText = document.getElementById("feedbackText");
  const previewTitle = document.getElementById("scanPreviewTitle");
  const previewVolBadge = document.getElementById("scanPreviewVolBadge");
  const previewIsbn = document.getElementById("scanPreviewIsbn");
  const isVariantCheck = document.getElementById("scanPreviewVariantCheckbox");

  // Controllo di possesso nella collezione
  const existingItem = state.items.find(i => i.isbn === currentDetectedIsbn && !i.is_variant);

  if (existingItem) {
    // ROSSO: Già posseduto
    reticle.className = "scanner-target-reticle feedback-red";
    banner.className = "result-feedback-banner duplicate-red";
    feedbackIcon.textContent = "⚠️";
    feedbackText.textContent = `Già posseduto in collezione (#${existingItem.volume || 1})`;
    previewTitle.textContent = existingItem.title;
    previewVolBadge.textContent = `Vol. ${existingItem.volume || 1}`;
  } else {
    // VERDE: Nuovo volume
    reticle.className = "scanner-target-reticle feedback-green";
    banner.className = "result-feedback-banner success";
    feedbackIcon.textContent = "✔️";
    feedbackText.textContent = "Non posseduto (Pronto per l'aggiunta)";
    previewTitle.textContent = "Ricerca dettagli in corso...";
    
    // Query Google Books API per metadata
    fetchGoogleBookInfo(currentDetectedIsbn);
  }

  previewIsbn.textContent = `ISBN: ${currentDetectedIsbn}`;
  isVariantCheck.checked = false;
  resultCard.hidden = false;
}

async function fetchGoogleBookInfo(isbn) {
  const previewTitle = document.getElementById("scanPreviewTitle");
  const previewVolBadge = document.getElementById("scanPreviewVolBadge");

  try {
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
    const data = await res.json();
    if (data.items && data.items.length > 0) {
      const volumeInfo = data.items[0].volumeInfo;
      previewTitle.textContent = volumeInfo.title || "Titolo non reperito";
      
      // Tentativo di estrazione del numero volume dal titolo o sottotitolo
      const volMatch = (volumeInfo.title + " " + (volumeInfo.subtitle || "")).match(/(?:vol(?:ume)?\.?|n\.?|#)\s*(\d+)/i);
      const volNum = volMatch ? parseInt(volMatch[1], 10) : 1;
      previewVolBadge.textContent = `Vol. ${volNum}`;
      previewVolBadge.dataset.extractedVol = volNum;
    } else {
      previewTitle.textContent = "Opera Barcode " + isbn;
      previewVolBadge.textContent = "Vol. 1";
      previewVolBadge.dataset.extractedVol = 1;
    }
  } catch {
    previewTitle.textContent = "Opera Barcode " + isbn;
    previewVolBadge.textContent = "Vol. 1";
    previewVolBadge.dataset.extractedVol = 1;
  }
}

async function handleConfirmScannedAdd() {
  const title = document.getElementById("scanPreviewTitle").textContent;
  const volBadge = document.getElementById("scanPreviewVolBadge");
  const volume = parseInt(volBadge.dataset.extractedVol || "1", 10);
  const isVariant = document.getElementById("scanPreviewVariantCheckbox").checked;

  const newItem = {
    id: crypto.randomUUID(),
    title: title,
    volume: volume,
    current_chapter: 0,
    type: "manga",
    status: "in_corso",
    isbn: currentDetectedIsbn,
    is_variant: isVariant,
    section: "posseduti"
  };

  // 1. Salva in Posseduti
  state.upsertItemLocally(newItem);
  await syncItemToRemote(newItem);

  // 2. Sincronizzazione automatica con Voti (escluse le Variant)
  if (!isVariant) {
    const existsInVoti = state.items.some(i => i.section === "voti" && i.title.toLowerCase() === title.toLowerCase());
    if (!existsInVoti) {
      const votiEntry = {
        id: crypto.randomUUID(),
        title: title,
        type: newItem.type,
        status: "da_iniziare",
        rating: null,
        section: "voti",
        is_variant: false
      };
      state.upsertItemLocally(votiEntry);
      await syncItemToRemote(votiEntry);
    }
  }

  // 3. Aggiunta alla cronologia recente
  state.addRecentScan({
    isbn: currentDetectedIsbn,
    title: title,
    volume: volume,
    is_variant: isVariant,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  });

  stopCameraScanner();
}