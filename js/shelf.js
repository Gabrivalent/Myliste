// js/shelf.js
import { appData, saveData, pushHistoryAction, generateUniqueId } from './state.js';
import { syncItemToSupabase } from './supabase.js';
import { getCategoryColor, cleanVolumeNumber } from './ui.js';
import { escapeHtml } from './scanner.js';

const shelfModalBackdrop = document.getElementById('shelfModalBackdrop');
const closeShelfModalBtn = document.getElementById('closeShelfModalBtn');
const shelfSeriesTitle = document.getElementById('shelfSeriesTitle');
const shelfCategoryTag = document.getElementById('shelfCategoryTag');
const shelfSpineContainer = document.getElementById('shelfSpineContainer');

let onEditItemCallback = null;
let onDataChangedCallback = null;
let onToastNoticeCallback = null;

export function initShelfModule({ onEditItem, onDataChanged, onToastNotice }) {
  onEditItemCallback = onEditItem;
  onDataChangedCallback = onDataChanged;
  onToastNoticeCallback = onToastNotice;

  if (closeShelfModalBtn) {
    closeShelfModalBtn.addEventListener('click', closeShelfModal);
  }
  if (shelfModalBackdrop) {
    shelfModalBackdrop.addEventListener('click', (e) => {
      if (e.target === shelfModalBackdrop) closeShelfModal();
    });
  }
}

export function closeShelfModal() {
  if (shelfModalBackdrop) {
    shelfModalBackdrop.classList.remove('active');
  }
}

export function openMangaShelf3D(seriesTitle, category) {
  if (!shelfModalBackdrop || !shelfSpineContainer) return;

  shelfSeriesTitle.textContent = seriesTitle;
  shelfCategoryTag.textContent = category || 'Generale';
  shelfCategoryTag.style.color = getCategoryColor(category || 'Generale');

  shelfSpineContainer.innerHTML = '';

  const ownedSeriesVolumes = appData.items.filter(i => 
    i.set === 'Posseduti' && 
    i.title.toLowerCase() === seriesTitle.toLowerCase()
  );

  const regularVols = ownedSeriesVolumes.filter(v => !v.isVariant);
  const variantVols = ownedSeriesVolumes.filter(v => v.isVariant);

  const ownedNumbersMap = new Map();
  regularVols.forEach(it => {
    const n = parseInt(cleanVolumeNumber(it.number), 10);
    if (!isNaN(n)) ownedNumbersMap.set(n, it);
  });

  const numbers = Array.from(ownedNumbersMap.keys()).sort((a, b) => a - b);
  const minVol = numbers.length > 0 ? Math.min(1, numbers[0]) : 1;
  const maxVol = numbers.length > 0 ? Math.max(...numbers) : 1;

  const spineColor = getCategoryColor(category);

  for (let v = minVol; v <= maxVol; v++) {
    const ownedItem = ownedNumbersMap.get(v);

    if (ownedItem) {
      const spine = document.createElement('div');
      spine.className = 'manga-spine';
      spine.style.backgroundColor = spineColor;

      spine.innerHTML = `
        <span class="spine-vol-num">#${v}</span>
        <span class="spine-title-vertical">${escapeHtml(seriesTitle)}</span>
        <span style="font-size: 0.6rem; font-weight: 800; color: rgba(255,255,255,0.7);">VOL</span>
      `;

      spine.addEventListener('click', () => {
        closeShelfModal();
        if (onEditItemCallback) onEditItemCallback(ownedItem);
      });

      shelfSpineContainer.appendChild(spine);
    } else {
      const ghost = document.createElement('div');
      ghost.className = 'manga-spine missing-ghost';
      ghost.title = `Volume #${v} mancante! Clicca per aggiungerlo ad Acquisti`;

      ghost.innerHTML = `
        <span class="spine-vol-num" style="border-color: #f59e0b; color: #f59e0b;">#${v}</span>
        <span class="spine-ghost-label">+ Prendi</span>
      `;

      ghost.addEventListener('click', () => {
        if (confirm(`Aggiungere "${seriesTitle} #${v}" alla lista Acquisti?`)) {
          const newItem = {
            id: generateUniqueId(),
            title: seriesTitle,
            set: 'Acquisti',
            category: category || 'Generale',
            date: null,
            number: String(v),
            isbn: null,
            rating: null,
            unplayed: false,
            purchased: false,
            completed: false,
            isRead: false,
            isVariant: false,
            missingGapNotice: null,
            readingChapter: '',
            privateComment: '',
            createdAt: new Date().toISOString()
          };
          appData.items.unshift(newItem);
          pushHistoryAction({ type: 'INSERT', data: { ...newItem } });
          saveData();
          syncItemToSupabase(newItem, saveData);
          closeShelfModal();
          if (onDataChangedCallback) onDataChangedCallback();
          if (onToastNoticeCallback) onToastNoticeCallback(`"${seriesTitle} #${v}" aggiunto ad Acquisti!`);
        }
      });

      shelfSpineContainer.appendChild(ghost);
    }
  }

  if (variantVols.length > 0) {
    const divider = document.createElement('div');
    divider.style.width = '100%';
    divider.style.padding = '12px 4px 6px';
    divider.style.fontSize = '0.78rem';
    divider.style.fontWeight = '800';
    divider.style.color = 'var(--accent-cyan)';
    divider.textContent = `★ Edizioni Variant (${variantVols.length})`;
    shelfSpineContainer.appendChild(divider);

    variantVols.forEach(vItem => {
      const vSpine = document.createElement('div');
      vSpine.className = 'manga-spine foil-hologram';
      vSpine.style.backgroundColor = '#181a20';

      vSpine.innerHTML = `
        <span class="spine-vol-num" style="border-color: #fbbf24; color: #fbbf24;">#${escapeHtml(vItem.number || 'V')}</span>
        <span class="spine-title-vertical">${escapeHtml(seriesTitle)} [Variant]</span>
        <span class="foil-sparkle-badge" style="transform: rotate(90deg); margin-bottom: 8px;">VAR</span>
      `;

      vSpine.addEventListener('click', () => {
        closeShelfModal();
        if (onEditItemCallback) onEditItemCallback(vItem);
      });

      shelfSpineContainer.appendChild(vSpine);
    });
  }

  shelfModalBackdrop.classList.add('active');
}
