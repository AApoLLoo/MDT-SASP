// Import d'un bordereau d'arrestation Google Docs (modèle SASP) en brouillon de rapport.
// Le document est lu dans son export HTML, qui contient le texte et les photos (images intégrées en base64).
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { db, UPLOAD_DIR, transaction } from './db.js';
import { fail, updateRow, logAction } from './util.js';
import { createReport, SUSPECT_FIELDS } from './routes/reports.js';
import { upsertCitizen, useIdentityPhoto } from './routes/citizens.js';
import { imageExtension } from './routes/misc.js';

const MAX_BYTES = 60 * 1024 * 1024; // l'export d'un bordereau illustré pèse ~12 Mo
const FETCH_TIMEOUT_MS = 30000;

// Seul un lien https://docs.google.com/document/d/<id> est accepté : le serveur ne contacte jamais une autre adresse
export function docIdFromUrl(url) {
  const m = /^https:\/\/docs\.google\.com\/document\/d\/([A-Za-z0-9_-]{20,100})(?:[/?#]|$)/.exec(String(url ?? '').trim());
  if (!m) fail(400, 'Collez le lien d’un document Google Docs (https://docs.google.com/document/d/…)');
  return m[1];
}

export async function fetchGoogleDoc(id) {
  const url = `https://docs.google.com/document/d/${id}/export?format=html`;
  let res;
  try {
    res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (err) {
    fail(502, `Google Docs ne répond pas (${err.message})`);
  }
  // Document non partagé : Google renvoie vers sa page de connexion
  if (!res.ok || new URL(res.url).hostname !== 'docs.google.com') {
    fail(400, 'Document inaccessible : partagez-le en « Toute personne disposant du lien » (lecteur), puis réessayez');
  }
  if (Number(res.headers.get('content-length')) > MAX_BYTES) fail(413, 'Document trop volumineux');
  const html = await res.text();
  if (html.length > MAX_BYTES * 1.4) fail(413, 'Document trop volumineux');
  return html;
}

// ---------- Lecture du document ----------

const NAMED = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', deg: '°', laquo: '«', raquo: '»', ndash: '–', mdash: '—' };
const ACCENTED = { eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', agrave: 'à', acirc: 'â', ccedil: 'ç', icirc: 'î', iuml: 'ï', ocirc: 'ô', ugrave: 'ù', ucirc: 'û', uuml: 'ü', Eacute: 'É', Egrave: 'È', Agrave: 'À', Ccedil: 'Ç' };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  return NAMED[e] ?? ACCENTED[e] ?? m;
});

// Comparaison tolérante : sans accents, sans casse, ponctuation et apostrophes (’ ou ') remplacées par des espaces
export const normalize = s => String(s).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Suite de lignes de texte et d'images, dans l'ordre du document
function tokens(html) {
  const body = html.slice(Math.max(0, html.indexOf('<body')));
  const out = [];
  let text = '';
  const flush = () => {
    // Les traits de séparation du modèle (« ________ ») ne sont pas du texte
    for (const line of decode(text).split('\n')) {
      if (line.trim() && !/^_+$/.test(line.trim())) out.push({ text: line.replace(/\s+/g, ' ').trim() });
    }
    text = '';
  };
  for (const m of body.matchAll(/<img\b[^>]*>|<\/?([a-z0-9]+)\b[^>]*>|[^<]+/gi)) {
    const [chunk, tag] = m;
    if (chunk.startsWith('<img')) {
      flush();
      const src = /src="data:image\/(png|jpe?g|gif|webp);base64,([^"]+)"/i.exec(chunk);
      if (src) out.push({ image: { type: src[1].toLowerCase(), data: src[2] } });
    } else if (tag) {
      if ((chunk.startsWith('</') && /^(p|li|tr|td|h\d|div)$/i.test(tag)) || /^br$/i.test(tag)) text += '\n';
    } else {
      text += chunk;
    }
  }
  flush();
  return out;
}

const date = s => { const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; };
const after = line => line.slice(line.indexOf(':') + 1).trim();
// Valeur de modèle laissée telle quelle (« xxx », « … », « - »)
const filled = v => (/^[x.\-_…\s]*$/i.test(v) ? '' : v);
const matricules = lines => lines.flatMap(l => [...l.matchAll(/『\s*([^』\s][^』]*?)\s*』/g)].map(m => m[1]));

// Sections photo du bordereau → emplacements du MDT (components/photos.js), dans l'ordre du modèle
const PHOTO_SECTIONS = [
  [/^carte d identite/, ['carte_identite']],
  [/^permis de conduire/, ['permis']],
  [/^photo avec vetements/, ['vetu_face', 'vetu_dos']],
  [/^photo sans vetements/, ['nu_face', 'nu_dos', 'profil_g', 'profil_d']],
  [/^voitures?\b/, ['voiture_1', 'voiture_2', 'voiture_3']],
  [/^objets? saisis?/, ['objet_1', 'objet_2']],
];

export function parseBordereau(html) {
  const toks = tokens(html);
  const lines = toks.filter(t => t.text).map(t => t.text);
  const norm = lines.map(normalize);
  if (!norm.some(l => l.startsWith('rapport d arrestation')) || !norm.some(l => l.startsWith('information du suspect'))) {
    fail(400, "Ce document ne ressemble pas à un bordereau d'arrestation SASP");
  }
  const find = re => lines[norm.findIndex(l => re.test(l))] ?? '';
  // Lignes entre un intitulé et le suivant (étiquettes connues du modèle)
  const LABELS = /^(fait le|date des faits|grade|information du suspect|nom prenom|date de naissance|empreinte|n secu|numero de telephone|droit miranda|objet s illegal|agent redacteur|agents? presents?|chef s|faits$|photo s appuyant)/;
  const block = re => {
    const start = norm.findIndex(l => re.test(l));
    if (start < 0) return [];
    const end = norm.findIndex((l, i) => i > start && LABELS.test(l));
    return lines.slice(start + 1, end < 0 ? undefined : end);
  };

  const [nom = '', ...prenom] = after(find(/^nom prenom/)).split(/\s+/).filter(Boolean);
  const miranda = after(find(/^droit miranda/));
  const heure = /(\d{1,2})\s*[h:]\s*(\d{2})/i.exec(miranda);

  const objets = block(/^objet s illegal/).map(l => l.replace(/^[-*•]\s*/, '').trim()).filter(Boolean).map(l => {
    const m = /^(.*?)\s*[x×]\s*(\d+)$/i.exec(l);
    return m ? { description: m[1].trim(), quantite: m[2] } : { description: l, quantite: '' };
  });

  // Chefs : lignes de la liste, « x2 Intitulé » ; les fragments de l'intitulé de colonne sont ignorés
  const charges = block(/^chef s/).map(l => l.replace(/^[-*•]\s*/, '').trim())
    .filter(l => l && !/^(d.?accusation|\(sous tirets\))/i.test(l))
    .map(l => {
      const m = /^x\s*(\d+)\s+(.+)$/i.exec(l);
      return m ? { label: m[2].trim(), quantite: Number(m[1]) } : { label: l, quantite: 1 };
    });

  const faitsStart = norm.findIndex(l => l === 'faits');
  const faitsEnd = norm.findIndex((l, i) => i > faitsStart && l.startsWith('photo s appuyant'));

  return {
    date_rapport: date(find(/^fait le/)),
    date_faits: date(find(/^date des faits/)),
    suspect: {
      nom, prenom: prenom.join(' '),
      date_naissance: date(find(/^date de naissance/)),
      empreinte: filled(after(find(/^empreinte/))),
      id_unique: filled(after(find(/^n secu/))),
      telephone: filled(after(find(/^numero de telephone/))),
    },
    miranda_heure: heure ? `${heure[1].padStart(2, '0')}:${heure[2]}` : '',
    miranda_par: /par\s*『?\s*([^\s』]+)/i.exec(miranda)?.[1] ?? '',
    objets_illegaux: objets,
    redacteur: matricules(block(/^agent redacteur/))[0] ?? '',
    agents_presents: [...new Set(matricules(block(/^agents? presents?/)))],
    charges,
    faits: faitsStart < 0 ? '' : lines.slice(faitsStart + 1, faitsEnd < 0 ? undefined : faitsEnd).join('\n'),
    photos: photosOf(toks),
  };
}

// Images de la partie photos, rangées dans les emplacements de leur section ; une image présente plusieurs fois
// (logo du modèle) est décorative, celles de la calculatrice (captures) ne sont pas des preuves
function photosOf(toks) {
  const count = new Map();
  for (const t of toks) if (t.image) count.set(t.image.data, (count.get(t.image.data) ?? 0) + 1);
  const photos = {};
  let active = false;
  let slots = [];
  let extra = 0;
  for (const t of toks) {
    if (t.text) {
      const l = normalize(t.text);
      if (l.startsWith('photo s appuyant')) active = true;
      else if (l.startsWith('calculatrice')) active = false;
      const section = PHOTO_SECTIONS.find(([re]) => re.test(l));
      if (section) slots = [...section[1]];
    } else if (active && count.get(t.image.data) === 1) {
      const slot = slots.shift() ?? `autre_${++extra}`;
      if (extra <= 20) photos[slot] = t.image;
    }
  }
  return photos;
}

// Chefs retrouvés dans le code pénal : intitulé identique, sinon une infraction qui commence par l'intitulé du bordereau
export function matchCharges(charges, codes) {
  const named = codes.map(c => ({ id: c.id, norm: normalize(c.infraction) }));
  const out = { charges: [], unmatched: [] };
  for (const { label, quantite } of charges) {
    const l = normalize(label);
    const code = named.find(c => c.norm === l) ?? named.filter(c => c.norm.startsWith(`${l} `)).sort((a, b) => a.norm.length - b.norm.length)[0];
    if (code) out.charges.push({ code_id: code.id, quantite });
    else out.unmatched.push(label);
  }
  return out;
}

// Format vérifié sur le contenu (comme les envois d'images du MDT), pas sur le type annoncé par le document
const saveImage = ({ data }) => {
  const buf = Buffer.from(data, 'base64');
  const ext = imageExtension(buf);
  if (!ext) return null;
  const name = `${randomBytes(12).toString('hex')}.${ext}`;
  writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return `/mdt/uploads/${name}`;
};

// Crée le brouillon ; renvoie son id et les points que l'agent doit vérifier
export async function importBordereau(user, url, fetchDoc = fetchGoogleDoc) {
  const docId = docIdFromUrl(url);
  const b = parseBordereau(await fetchDoc(docId));
  const codes = db.prepare('SELECT id, infraction FROM penal_code WHERE actif = 1').all();
  const { charges, unmatched } = matchCharges(b.charges, codes);
  const warnings = unmatched.map(l => `Chef introuvable dans le Code pénal : « ${l} » — ajoutez-le à la main.`);
  if (!b.suspect.nom) warnings.push("Nom du suspect absent du bordereau.");
  if (b.redacteur && b.redacteur.toLowerCase() !== String(user.matricule).toLowerCase()) {
    warnings.push(`Le bordereau indique le rédacteur 『${b.redacteur}』 : le rapport est créé à votre nom.`);
  }
  const photos = Object.fromEntries(Object.entries(b.photos).map(([slot, image]) => [slot, saveImage(image)]).filter(([, url]) => url));

  const id = transaction(() => {
    // Fiche citoyen existante retrouvée par son n° sécu, sinon créée
    const known = b.suspect.id_unique && db.prepare('SELECT id FROM citizens WHERE id_unique = ?').get(b.suspect.id_unique);
    const { citizen_id, snapshot } = upsertCitizen({ ...b.suspect, id: known?.id }, SUSPECT_FIELDS, user, "Depuis l'import d'un bordereau");
    const reportId = createReport(user, { citizenId: citizen_id, calcInput: { charges }, faits: b.faits });
    updateRow('arrest_reports', reportId, {
      suspect: JSON.stringify(snapshot),
      ...(b.date_rapport && { date_rapport: b.date_rapport }),
      ...(b.date_faits && { date_faits: b.date_faits }),
      miranda_heure: b.miranda_heure,
      miranda_par: b.miranda_par || user.matricule,
      agents_presents: JSON.stringify(b.agents_presents.slice(0, 20)),
      objets_illegaux: JSON.stringify(b.objets_illegaux.slice(0, 50)),
      photos: JSON.stringify(photos),
    });
    useIdentityPhoto(user, citizen_id, photos.carte_identite, "Depuis l'import d'un bordereau");
    logAction(user, 'Bordereau Google Docs importé', 'report', reportId, '', `Document ${docId}`);
    return reportId;
  });
  return { id, warnings };
}

// POST /api/reports/import { url } : réservé à la police (la barrière justice refuse cette route)
const r = Router();
r.post('/', async (req, res) => res.status(201).json(await importBordereau(req.user, req.body?.url)));
export default r;
