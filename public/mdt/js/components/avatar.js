import { html } from '../dom.js';

const initials = u => `${u?.prenom?.[0] ?? ''}${u?.nom?.[0] ?? ''}`.toUpperCase() || (u?.matricule?.[0] ?? '?').toUpperCase();

// Photo de l'agent, ou ses initiales à défaut ; size : sm | md | lg
export const avatar = (u, size = 'md') => (u?.photo_url
  ? html`<img class="avatar avatar-${size}" src="${u.photo_url}" alt="">`
  : html`<span class="avatar avatar-${size}" aria-hidden="true">${initials(u)}</span>`);
