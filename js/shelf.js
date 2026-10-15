// js/shelf.js
import { state } from './state.js';
import { syncItemToRemote } from './supabase.js';

export function openShelfModal(seriesTitle) {
  const backdrop = document.getElementById("shelfBackdrop");
  const titleEl = document.getElementById("shelfSeriesTitle");
  const statsEl = document.getElementById("shelfSeriesStats");
  const regularShelf = document.getElementById("regularSpineShelf");
  const variantShelf = document.getElementById("variantSpineShelf");
  const variantSection = document.getElementById("variantShelfSection");
  const btnClose = document.getElementById("btnCloseShelf");

  titleEl.textContent = seriesTitle;
  regularShelf.innerHTML = "";
  variantShelf.innerHTML = "";

  // Recupera tutti i volumi della serie
  const allSeriesItems = state.items.filter(
    i => i.section === "posseduti" && i.title.toLowerCase() === seriesTitle.toLowerCase()
  );

  const regularVolumes = allSeriesItems.filter(i => !i.is_variant);
  const variantVolumes = allSeriesItems.filter(i => i.is_variant);

  // Calcolo sequenza e buchi per i regolari
  const volNumbers = regularVolumes.map(i => i.volume || 1);
  const maxVol = volNumbers.length > 0 ? Math.max(...volNumbers) : 1;

  statsEl.textContent = `${regularVolumes.length} volumi regolari (+ ${variantVolumes.length} variant)`;

  // Popolamento ripiano regolari (con ghost spine per i buchi)
  for (let num = 1; num <= maxVol; num++) {
    const item = regularVolumes.find(i => (i.volume || 1) === num);

    const spine = document.createElement("div");
    if (item) {
      spine.className = "manga-spine";
      spine.title = `Volume ${num} (Clicca per modificare)`;
      spine.innerHTML = `
        <span class="spine-number">${num}</span>
        <span class="spine-vertical-title">${seriesTitle}</span>
        <span class="spine-number">#</span>
      `;
      spine.addEventListener("click", () => {
        backdrop.hidden = true;
        window.dispatchEvent(new CustomEvent("open-edit-item", { detail: item }));
      });
    } else {
      // Sagoma Fantasma buco mancante
      spine.className = "manga-spine ghost-gap";
      spine.title = `Volume ${num} mancante (Clicca per aggiungere ad Acquisti)`;
      spine.innerHTML = `
        <span class="spine-number">${num}</span>
        <span class="ghost-plus">+</span>
        <span class="spine-number">?</span>
      `;
      spine.addEventListener("click", async () => {
        const wishItem = {
          id: crypto.randomUUID(),
          title: seriesTitle,
          volume: num,
          section: "acquisti",
          type: regularVolumes[0]?.type || "manga",
          is_variant: false
        };
        state.upsertItemLocally(wishItem);
        await syncItemToRemote(wishItem);
        spine.style.borderColor = "var(--success)";
        spine.title = `Volume ${num} aggiunto ad Acquisti!`;
      });
    }
    regularShelf.appendChild(spine);
  }

  // Popolamento ripiano separato per le Variant
  if (variantVolumes.length > 0) {
    variantSection.hidden = false;
    variantVolumes.forEach(item => {
      const spine = document.createElement("div");
      spine.className = "manga-spine shelf-variant-spine";
      spine.title = `Variant Vol. ${item.volume || 1} - ${item.notes || 'Ed. Speciale'}`;
      spine.innerHTML = `
        <span class="spine-number">${item.volume || 1}</span>
        <span class="spine-vertical-title">${seriesTitle}</span>
        <span class="spine-number">★</span>
      `;
      spine.addEventListener("click", () => {
        backdrop.hidden = true;
        window.dispatchEvent(new CustomEvent("open-edit-item", { detail: item }));
      });
      variantShelf.appendChild(spine);
    });
  } else {
    variantSection.hidden = true;
  }

  backdrop.hidden = false;
  btnClose.onclick = () => { backdrop.hidden = true; };
}