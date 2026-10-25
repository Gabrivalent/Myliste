// js/ui.js
import { escapeHtml } from './scanner.js';

export const CATEGORY_COLORS = ['#38bdf8', '#c084fc', '#f59e0b', '#34d399', '#f472b6', '#a78bfa', '#fb923c'];

export function getCategoryColor(catName) {
  if (!catName) return '#38bdf8';
  let hash = 0;
  for (let i = 0; i < catName.length; i++) {
    hash = catName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % CATEGORY_COLORS.length;
  return CATEGORY_COLORS[index];
}

export function getTodayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDisplayDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
  return date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

export function getDateStatus(dateStr) {
  if (!dateStr) return { colorClass: 'status-orange', label: '', isToday: false, badgeType: 'standard', badgeText: '' };

  const todayStr = getTodayString();
  const [ty, tm, td] = todayStr.split('-').map(Number);
  const todayDate = new Date(ty, tm - 1, td);

  const [iy, im, id] = dateStr.split('-').map(Number);
  const itemDate = new Date(iy, im - 1, id);

  const diffTime = itemDate - todayDate;
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return { colorClass: 'status-today', label: id, isToday: true, badgeType: 'today', badgeText: 'OGGI' };
  } else if (diffDays === -1) {
    return { colorClass: 'status-green', label: id, isToday: false, badgeType: 'yesterday', badgeText: 'IERI' };
  } else if (diffDays > 0 && diffDays <= 7) {
    return { colorClass: 'status-red', label: id, isToday: false, badgeType: 'countdown', badgeText: `-${diffDays} gg` };
  } else if (diffDays < 0) {
    return { colorClass: 'status-green', label: id, isToday: false, badgeType: 'standard', badgeText: formatDisplayDate(dateStr) };
  } else {
    return { colorClass: 'status-red', label: id, isToday: false, badgeType: 'standard', badgeText: formatDisplayDate(dateStr) };
  }
}

export function getMonthYearTitle(dateStr) {
  const [y, m] = dateStr.split('-');
  const date = new Date(parseInt(y), parseInt(m) - 1, 1);
  const monthName = date.toLocaleDateString('it-IT', { month: 'long' });
  return monthName.charAt(0).toUpperCase() + monthName.slice(1);
}

export function getScoreBadgeClass(rating) {
  if (rating >= 95) return 'score-top';
  if (rating >= 85) return 'score-high';
  if (rating >= 75) return 'score-good';
  if (rating >= 60) return 'score-mid';
  return 'score-low';
}

// Calcolo pulito del numero: se vuoto, N, o non numerico valido, restituisce null
export function cleanVolumeNumber(rawNum) {
  if (!rawNum) return '';
  const trimmed = String(rawNum).trim();
  if (/^(n|none|u|unico|-)$/i.test(trimmed)) {
    return '';
  }
  return trimmed;
}

// Formatta il titolo per la visualizzazione: se è volume unico, omette #1 o #N
export function formatDisplayTitle(item) {
  const num = cleanVolumeNumber(item.number);
  if (!num) {
    return item.title;
  }
  return `${item.title} #${num}`;
}

export function calculateMissingGaps(volumesArray) {
  const nums = volumesArray
    .filter(v => !v.isVariant)
    .map(v => parseInt(cleanVolumeNumber(v.number), 10))
    .filter(n => !isNaN(n) && n > 0);

  if (nums.length < 2) return [];

  nums.sort((a, b) => a - b);
  const min = nums[0];
  const max = nums[nums.length - 1];
  const presentSet = new Set(nums);
  const missing = [];

  for (let i = min; i <= max; i++) {
    if (!presentSet.has(i)) {
      missing.push(i);
    }
  }
  return missing;
}
