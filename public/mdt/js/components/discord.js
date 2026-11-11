import { html, openModal, toast } from '../dom.js';
import { icon } from '../icons.js';

const DISCORD_MAX = 2000;

// Découpe en messages Discord en coupant de préférence entre les lignes
export function splitDiscord(text, max = DISCORD_MAX) {
  const parts = [];
  let cur = '';
  for (let line of text.split('\n')) {
    while (line.length > max) {
      if (cur) { parts.push(cur); cur = ''; }
      parts.push(line.slice(0, max));
      line = line.slice(max);
    }
    const next = cur ? `${cur}\n${line}` : line;
    if (next.length > max) { parts.push(cur); cur = line; } else cur = next;
  }
  if (cur) parts.push(cur);
  return parts;
}

// Lien absolu partageable (les uploads du MDT sont servis en chemin relatif)
export const absoluteUrl = url => new URL(url, location.origin).href;

// Retire les lignes vides consécutives
export const joinLines = lines => lines.filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function openDiscordModal(text) {
  const parts = splitDiscord(text);
  const dialog = openModal('Copier pour Discord', html`
    <p class="muted small">${parts.length > 1 ? `Le texte dépasse ${DISCORD_MAX} caractères : il est découpé en ${parts.length} messages à coller dans l'ordre.` : 'Collez ce message dans le salon Discord.'}
      Les photos importées dans le MDT ne s'affichent que pour les agents connectés.</p>
    ${parts.map((p, i) => html`<div class="discord-part">
      <div class="card-head"><strong>Message ${i + 1} / ${parts.length}</strong><small class="muted">${p.length} caractères</small>
        <button type="button" class="btn btn-sm btn-primary" data-copy="${i}">${icon('copy')} Copier</button></div>
      <textarea class="input mono" rows="8" readonly>${p}</textarea></div>`)}`, { wide: true });
  dialog.addEventListener('click', async e => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    if (await copy(parts[btn.dataset.copy])) {
      toast(`Message ${Number(btn.dataset.copy) + 1} copié`);
    } else {
      btn.closest('.discord-part').querySelector('textarea').select();
      toast('Copie automatique indisponible : texte sélectionné, faites Ctrl+C', 'error');
    }
  });
}
