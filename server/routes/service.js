import { Router } from 'express';
import { db, parseJson, transaction, getList } from '../db.js';
import { hasRole } from '../auth.js';
import { fail, str, intParam, insertRow, updateRow, cleanPhotos, listLimit, logAction, nextNumero } from '../util.js';
import { KINDS, DIVISION_KINDS, SPECIAL_DIVISIONS, UNIT_STATUTS, initialStatut, isMember, managesDivision } from '../../public/mdt/js/service-kinds.js';

const ALL_KINDS = { ...KINDS, ...DIVISION_KINDS };

const r = Router();

// ---------- Unités de patrouille (tableau partagé, modifiable par tous les agents) ----------

const parseUnit = u => ({ ...u, agents: parseJson(u.agents, []) });

function cleanUnit(b) {
  const f = {};
  for (const k of ['indicatif', 'secteur', 'poste', 'vehicule', 'notes']) if (b[k] !== undefined) f[k] = str(b[k]).slice(0, 200);
  if ('indicatif' in f && !f.indicatif) fail(400, "L'indicatif est obligatoire");
  const secteurs = getList('secteurs');
  const postes = getList('postes');
  if (f.secteur && !secteurs.includes(f.secteur)) fail(400, `Secteur invalide (${secteurs.join(', ')})`);
  if (f.poste && !postes.includes(f.poste)) fail(400, `Poste de rattachement invalide (${postes.join(', ')})`);
  if (b.statut !== undefined) {
    if (!UNIT_STATUTS[b.statut]) fail(400, 'Statut invalide');
    f.statut = b.statut;
  }
  if (b.agents !== undefined) {
    f.agents = JSON.stringify([...new Set((Array.isArray(b.agents) ? b.agents : []).map(str).filter(Boolean))].slice(0, 8));
  }
  return f;
}

// Un agent ne peut être que dans une seule unité à la fois
function removeFromOtherUnits(unitId, agentsJson) {
  const mine = parseJson(agentsJson, []).map(m => m.toLowerCase());
  if (!mine.length) return;
  for (const u of db.prepare('SELECT id, agents FROM patrol_units WHERE id <> ?').all(unitId)) {
    const kept = parseJson(u.agents, []).filter(m => !mine.includes(m.toLowerCase()));
    if (kept.length !== parseJson(u.agents, []).length) db.prepare('UPDATE patrol_units SET agents = ? WHERE id = ?').run(JSON.stringify(kept), u.id);
  }
}

r.get('/units', (req, res) => {
  res.json(db.prepare(`SELECT p.*, u.matricule AS updated_matricule FROM patrol_units p LEFT JOIN users u ON u.id = p.updated_by ORDER BY p.indicatif`).all().map(parseUnit));
});

r.post('/units', (req, res) => {
  const f = cleanUnit(req.body ?? {});
  if (!f.indicatif) fail(400, "L'indicatif est obligatoire");
  const id = transaction(() => {
    const newId = insertRow('patrol_units', { ...f, updated_by: req.user.id });
    if (f.agents) removeFromOtherUnits(newId, f.agents);
    return newId;
  });
  res.status(201).json({ id });
});

r.put('/units/:id', (req, res) => {
  const id = intParam(req.params.id);
  const f = cleanUnit(req.body ?? {});
  transaction(() => {
    updateRow('patrol_units', id, { ...f, updated_by: req.user.id });
    if (f.agents) removeFromOtherUnits(id, f.agents);
  });
  res.json({ ok: true });
});

r.delete('/units/:id', (req, res) => {
  const { changes } = db.prepare('DELETE FROM patrol_units WHERE id = ?').run(intParam(req.params.id));
  if (!changes) fail(404, 'Unité introuvable');
  res.json({ ok: true });
});

// ---------- Dossiers : convocations, absences, matériel perdu, sanctions ----------

const RECORD_SELECT = `
  SELECT s.*, a.matricule AS agent_matricule, a.nom AS agent_nom, a.prenom AS agent_prenom, a.grade AS agent_grade,
    c.matricule AS auteur_matricule
  FROM service_records s JOIN users a ON a.id = s.agent_id LEFT JOIN users c ON c.id = s.created_by`;

const parseRecord = rec => ({ ...rec, data: parseJson(rec.data, {}) });

function kindOf(name) {
  if (!Object.hasOwn(ALL_KINDS, name)) fail(404, 'Catégorie inconnue');
  return ALL_KINDS[name];
}

// Dossier de service : superviseurs et au-dessus ; dossier de division : ceux qui encadrent la division
const canManage = (kind, user) => (kind.division ? managesDivision(kind.division, user) : hasRole(user, 'superviseur'));

const canSeeAll = (kind, user) => kind.view === 'all' || canManage(kind, user);
const canSee = (kind, user, rec) => canSeeAll(kind, user) || rec.agent_id === user.id;

// Membre de la division autorisée à adresser des demandes (`request`) à ce type de dossier
const isRequester = (kind, user) => !!kind.request && !canManage(kind, user) && isMember(kind.request.division, user);

// L'agent peut modifier/supprimer sa propre déclaration (ou demande) tant qu'elle n'a pas été traitée
const canModify = (kind, user, rec) => canManage(kind, user)
  || (kind.create === 'self' && rec.agent_id === user.id && rec.statut === initialStatut(kind))
  || (isRequester(kind, user) && rec.agent_id === user.id && rec.statut === kind.request.statut);

// Lignes d'un champ `rows` : colonnes du champ uniquement, lignes vides retirées
function cleanRows(f, rows) {
  return (Array.isArray(rows) ? rows : []).slice(0, 40).map(row => {
    const out = {};
    for (const c of f.columns) {
      let v = str(row?.[c.key]).slice(0, 500);
      if (c.doc) v = v.toUpperCase();
      if (v && c.options && !c.options.includes(v)) fail(400, `${f.label} : ${c.label} invalide`);
      if (v && c.citizen && !/^\d{1,10}$/.test(v)) fail(400, `${f.label} : ${c.label} invalide`);
      if (v) out[c.key] = v;
    }
    return out;
  }).filter(row => Object.keys(row).length);
}

// Objet d'un croquis (modèle décrit dans components/sketch.js) : type connu, nombres entiers,
// couleur hexadécimale, pion de la liste du champ
const SKETCH_POINTS = { trait: [4, 2000], fleche: [4, 4], zone: [4, 4], texte: [2, 2], unite: [2, 2] };
const OBJECT_ID = /^[a-z0-9]{4,24}$/;
const validId = id => typeof id === 'string' && OBJECT_ID.test(id);
function cleanObjet(f, o) {
  if (!validId(o?.id) || !Object.hasOwn(SKETCH_POINTS, o.t) || (o.t === 'unite' && !f.units.some(u => u[0] === o.u))) return null;
  const [min, max] = SKETCH_POINTS[o.t];
  const p = (Array.isArray(o.p) ? o.p : []).slice(0, max).map(n => Math.round(Number(n)) || 0);
  if (p.length < min) return null;
  return {
    id: o.id, t: o.t, p: p.slice(0, p.length - (p.length % 2)),
    c: /^#[0-9a-f]{6}$/i.test(o.c) ? o.c : '#ffffff',
    w: Math.min(Math.max(Math.round(Number(o.w)) || 3, 1), 20),
    s: str(o.s).slice(0, 120),
    ...(o.t === 'unite' && { u: o.u }),
  };
}

function cleanData(kind, body, isSup, previous = {}) {
  const data = { ...previous };
  for (const f of kind.fields) {
    // Les croquis ne passent que par leur canal en temps réel (plus bas)
    if (!f.key || f.type === 'sketch' || (f.sup && !isSup)) continue;
    if (body[f.key] === undefined || (f.fixed && previous[f.key])) continue;
    if (f.type === 'rows') { data[f.key] = cleanRows(f, body[f.key]); continue; }
    if (f.type === 'photos') { data[f.key] = cleanPhotos(body[f.key]); continue; }
    let v = str(body[f.key]).slice(0, f.settings ? 60 : f.max ?? 4000);
    if (f.link) v = v.toUpperCase();
    if (v && f.link && v !== previous[f.key] && !byNumero(f.link, v)) fail(400, `${f.label} : aucun dossier ne porte le numéro ${v}`);
    if (v && f.options && !f.options.includes(v)) fail(400, `${f.label} : valeur invalide`);
    // Une valeur retirée depuis de la liste reste acceptée sur le dossier qui la porte déjà
    if (v && f.settings && !f.extend && v !== previous[f.key] && !getList(f.settings).includes(v)) fail(400, `${f.label} : valeur absente de la liste réglée par l'administration`);
    if (v && f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) fail(400, `${f.label} : date invalide`);
    data[f.key] = v;
  }
  for (const f of kind.fields) if (f.required && !data[f.key]) fail(400, `${f.label} : champ obligatoire`);
  const error = kind.validate?.(data);
  if (error) fail(400, error);
  return data;
}

// Champs `unique` : un seul dossier du type par valeur (ex. une fiche par formation)
function checkUnique(kindName, kind, data, id = 0) {
  for (const f of kind.fields.filter(x => x.unique && data[x.key])) {
    if (db.prepare(`SELECT 1 FROM service_records WHERE kind = ? AND id <> ? AND json_extract(data, ?) = ?`).get(kindName, id, `$.${f.key}`, data[f.key])) {
      fail(409, `${f.label} « ${data[f.key]} » : une fiche existe déjà`);
    }
  }
}

// Champs `extend` : une valeur nouvelle rejoint sa liste réglable (ex. formation créée par l'Academy)
function extendLists(kind, data, user) {
  for (const f of kind.fields.filter(x => x.extend && data[x.key])) {
    const list = getList(f.settings);
    if (list.includes(data[f.key])) continue;
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(JSON.stringify([...list, data[f.key]]), f.settings);
    logAction(user, 'Paramètres modifiés', 'settings', null, f.settings === 'qualifications' ? 'Qualifications' : f.settings, `Ajouté : ${data[f.key]} (${kind.titre})`);
  }
}

// `grant` : formation validée → qualification ajoutée au profil de l'agent (30 au plus, comme sur le profil)
function grant(kind, rec, user) {
  const q = kind.grant && rec.statut === kind.grant.statut && rec.data[kind.grant.field];
  const u = q && db.prepare('SELECT qualifications FROM users WHERE id = ?').get(rec.agent_id);
  const list = parseJson(u?.qualifications, []);
  if (!u || list.includes(q) || list.length >= 30) return;
  db.prepare('UPDATE users SET qualifications = ? WHERE id = ?').run(JSON.stringify([...list, q]), rec.agent_id);
  logAction(user, 'Qualification obtenue', 'user', rec.agent_id, rec.agent_matricule, `${q} (${kind.titre})`);
}

// « Sanctions : ajout » sur 『matricule』 ; le type est gardé dans entity (service:sanctions)
const logRecord = (user, kind, rec, verbe, details = '') =>
  logAction(user, `${kind.titre} : ${verbe}`, `service:${rec.kind}`, rec.id, rec.agent_matricule,
    details || [rec.data.numero ?? rec.data.dossier, rec.data.nom ?? rec.data.titre ?? rec.data.objet ?? rec.data.code, rec.data.type, rec.data.motif].filter(Boolean).join(' · '));

function loadRecord(kindName, id) {
  const rec = db.prepare(`${RECORD_SELECT} WHERE s.kind = ? AND s.id = ?`).get(kindName, id);
  if (!rec) fail(404, 'Élément introuvable');
  return parseRecord(rec);
}

// Dossier numéroté (`numero` du type) d'après son numéro
function byNumero(kindName, numero) {
  const rec = db.prepare(`${RECORD_SELECT} WHERE s.kind = ? AND json_extract(s.data, '$.numero') = ?`).get(kindName, numero);
  return rec && parseRecord(rec);
}

// ---------- Liens entre dossiers et documents ----------

// Un dossier lié que l'agent ne peut pas lire n'est montré qu'en résumé : numéro, titre, type, lieu, statut, agent ;
// un type `masque` (enquêtes du BCI) ne montre que son nom de code : ni numéro, ni objet, ni agent, ni lien
export const MASQUE_PAR_DEFAUT = 'Dossier confidentiel';
function shown(rec, user) {
  const kind = ALL_KINDS[rec.kind];
  if (canSee(kind, user, rec)) return rec;
  if (kind.masque) return { kind: rec.kind, data: { [kind.masque]: rec.data[kind.masque] || MASQUE_PAR_DEFAUT }, resume: true, masque: true };
  const keys = ['numero', 'dossier', kind.fields[0].key, 'type', 'lieu'];
  return { ...rec, data: Object.fromEntries(keys.filter(k => rec.data[k]).map(k => [k, rec.data[k]])), resume: true };
}

// Documents du MDT cités par leur numéro (préfixe → requête) ; un dossier numéroté peut aussi en citer un autre
const DOCUMENTS = {
  SASP: `SELECT 'rapport' AS doc, id, numero, statut, TRIM(COALESCE(json_extract(suspect, '$.prenom'), '') || ' ' || COALESCE(json_extract(suspect, '$.nom'), '')) AS label, date_faits AS date FROM arrest_reports WHERE numero = ? AND blanchi_at IS NULL`,
  PLT: `SELECT 'plainte' AS doc, id, numero, statut, TRIM(COALESCE(json_extract(plaignant, '$.prenom'), '') || ' ' || COALESCE(json_extract(plaignant, '$.nom'), '')) AS label, date_depot AS date FROM complaints WHERE numero = ?`,
  PV: `SELECT 'amende' AS doc, t.id, t.numero, t.statut, TRIM(c.prenom || ' ' || c.nom) AS label, t.date_faits AS date FROM tickets t JOIN citizens c ON c.id = t.citizen_id WHERE t.numero = ?`,
  INC: `SELECT 'incident' AS doc, id, numero, statut, type, lieu AS label, date_faits AS date FROM incident_reports WHERE numero = ?`,
  PRV: `SELECT 'scelle' AS doc, id, numero, statut, description AS label, '' AS date FROM evidence WHERE numero = ?`,
};
const NUMEROTES = Object.entries(ALL_KINDS).filter(([, k]) => k.numero);

export function findDocument(numero, user) {
  const prefix = numero.split('-')[0];
  const sql = DOCUMENTS[prefix];
  if (sql) return db.prepare(sql).get(numero) ?? { numero, introuvable: true };
  const [kindName] = NUMEROTES.find(([, k]) => k.numero === prefix) ?? [];
  const rec = kindName && byNumero(kindName, numero);
  if (!rec) return { numero, introuvable: true };
  const dossier = shown(rec, user);
  return { doc: 'dossier', numero: dossier.masque ? '' : numero, dossier };
}

// Liens d'un dossier : le dossier qu'il vise (`link`), les dossiers d'autres types qui le visent (ex. opérations
// du S.W.A.T. et actes d'une enquête), les documents (`doc`) et les fiches citoyens (`citizen`) de ses lignes
function liensOf(kindName, kind, rec, user) {
  const link = kind.fields.find(f => f.link);
  const cible = link && rec.data.dossier && byNumero(link.link, rec.data.dossier);
  const sources = Object.keys(ALL_KINDS).filter(k => ALL_KINDS[k].fields.some(f => f.link === kindName));
  const entrants = rec.data.numero && sources.length ? db.prepare(`${RECORD_SELECT}
    WHERE s.kind IN (SELECT value FROM json_each(?)) AND json_extract(s.data, '$.dossier') = ? ORDER BY s.date DESC, s.id DESC`)
    .all(JSON.stringify(sources), rec.data.numero).map(r => shown(parseRecord(r), user)) : [];
  const cells = flag => [...new Set(kind.fields.filter(f => f.type === 'rows')
    .flatMap(f => f.columns.filter(c => c[flag]).flatMap(c => (rec.data[f.key] ?? []).map(row => row[c.key]))).filter(Boolean))];
  const citoyens = db.prepare(`SELECT c.id, c.nom, c.prenom, c.photo_url,
      (SELECT COUNT(*) FROM warrants w WHERE w.citizen_id = c.id AND w.statut = 'actif') AS mandats_actifs,
      (SELECT COUNT(*) FROM arrest_reports a WHERE a.citizen_id = c.id AND a.statut = 'finalise' AND a.blanchi_at IS NULL) AS nb_arrestations
    FROM citizens c WHERE c.id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(cells('citizen').map(Number)));
  return {
    dossier: cible ? shown(cible, user) : null,
    entrants,
    documents: cells('doc').map(n => findDocument(n.toUpperCase(), user)),
    citoyens,
  };
}

// Dossier administratif d'un agent : visible par lui-même et par les superviseurs
r.get('/dossier/:agentId', (req, res) => {
  const agentId = intParam(req.params.agentId);
  if (agentId !== req.user.id && !hasRole(req.user, 'superviseur')) fail(403, 'Dossier réservé à l’agent et aux superviseurs');
  const rows = db.prepare(`${RECORD_SELECT} WHERE s.agent_id = ? ORDER BY s.date DESC, s.id DESC`).all(agentId).map(parseRecord);
  res.json(Object.fromEntries(Object.keys(KINDS).map(k => [k, rows.filter(rec => rec.kind === k)])));
});

// ---------- Croquis partagés en temps réel (champs `sketch`) ----------
// Chaque croquis ouvert a une « salle » en mémoire : son état, les éditeurs connectés (flux SSE) et la sauvegarde.
// Les opérations reçues (POST) sont appliquées dans leur ordre d'arrivée puis renvoyées à tous les éditeurs,
// expéditeur compris : chacun reçoit la même suite, dans le même ordre (voir components/sketch.js).
// ponytail: salles en mémoire d'un seul processus ; plusieurs instances du serveur demanderaient un bus partagé (Redis…)
const rooms = new Map();
const SAVE_EVERY_MS = 1000;
const MAX_OBJETS = 400;

function sketchOf(req) {
  const kind = kindOf(req.params.kind);
  const f = kind.fields.find(x => x.key === req.params.field && x.type === 'sketch');
  if (!f) fail(404, 'Croquis inconnu');
  return { kind, f, rec: loadRecord(req.params.kind, intParam(req.params.id)) };
}

// Les objets d'un croquis enregistré sans identifiant (première version) en reçoivent un
function roomOf(rec, f) {
  const key = `${rec.id}:${f.key}`;
  if (!rooms.has(key)) {
    const saved = rec.data[f.key] ?? {};
    const objets = (saved.objets ?? []).map((o, i) => ({ ...o, id: validId(o.id) ? o.id : `ancien${i}` }));
    rooms.set(key, { key, id: rec.id, field: f.key, sketch: { fond: saved.fond ?? '', objets }, clients: new Set(), savedAt: 0, timer: null, dirty: false });
  }
  return rooms.get(key);
}

function saveRoom(room) {
  clearTimeout(room.timer);
  room.timer = null;
  if (room.dirty) {
    const row = db.prepare('SELECT data FROM service_records WHERE id = ?').get(room.id);
    if (row) db.prepare(`UPDATE service_records SET data = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(JSON.stringify({ ...parseJson(row.data, {}), [room.field]: room.sketch }), room.id);
    room.dirty = false;
    room.savedAt = Date.now();
  }
  if (!room.clients.size) rooms.delete(room.key);
}

// Au plus une écriture par seconde et par croquis ; la dernière modification est toujours écrite
function scheduleSave(room) {
  room.dirty = true;
  if (Date.now() - room.savedAt >= SAVE_EVERY_MS) saveRoom(room);
  else room.timer ??= setTimeout(() => saveRoom(room), SAVE_EVERY_MS);
}

const sse = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
const broadcast = (room, event, data) => { for (const c of room.clients) sse(c.res, event, data); };
const presence = room => broadcast(room, 'presence', [...new Set([...room.clients].map(c => c.matricule))]);

// Opérations : set (ajout ou remplacement d'un objet), del, clear (tout effacer), fond
function cleanOp(f, op) {
  const n = Number.isSafeInteger(op?.n) ? op.n : 0;
  if (op?.k === 'set') {
    const o = cleanObjet(f, op.o);
    return o && { n, k: 'set', o };
  }
  if (op?.k === 'del') return validId(op.id) && { n, k: 'del', id: op.id };
  if (op?.k === 'clear') return { n, k: 'clear' };
  if (op?.k === 'fond') return { n, k: 'fond', url: cleanPhotos({ fond: op.url }).fond ?? '' };
  return null;
}

function applyOp(sketch, op) {
  if (op.k === 'set') {
    const i = sketch.objets.findIndex(o => o.id === op.o.id);
    if (i >= 0) sketch.objets[i] = op.o;
    else sketch.objets.push(op.o);
  } else if (op.k === 'del') sketch.objets = sketch.objets.filter(o => o.id !== op.id);
  else if (op.k === 'clear') sketch.objets = [];
  else sketch.fond = op.url;
}

// Flux du croquis : état complet à la connexion, puis opérations et liste des agents connectés
r.get('/:kind/:id/live/:field', (req, res) => {
  const { kind, f, rec } = sketchOf(req);
  if (!canSee(kind, req.user, rec)) fail(403, 'Croquis réservé à la division');
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
  const room = roomOf(rec, f);
  const client = { res, matricule: req.user.matricule };
  room.clients.add(client);
  sse(res, 'state', room.sketch);
  presence(room);
  // Garde la connexion ouverte derrière un reverse proxy
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  res.on('close', () => {
    clearInterval(ping);
    room.clients.delete(client);
    presence(room);
    if (!room.clients.size) saveRoom(room);
  });
});

// Les brouillons de croquis ne sont pas tracés dans l'historique : ils changent à chaque coup de crayon
r.post('/:kind/:id/live/:field', (req, res) => {
  const { kind, f, rec } = sketchOf(req);
  if (!canModify(kind, req.user, rec)) fail(403, 'Vous ne pouvez pas modifier ce croquis');
  const room = roomOf(rec, f);
  const ops = (Array.isArray(req.body?.ops) ? req.body.ops : []).slice(0, 200).map(op => cleanOp(f, op)).filter(Boolean);
  const added = new Set(ops.filter(op => op.k === 'set' && !room.sketch.objets.some(o => o.id === op.o.id)).map(op => op.o.id));
  if (room.sketch.objets.length + added.size > MAX_OBJETS) fail(400, `Croquis plein : ${MAX_OBJETS} éléments au maximum`);
  for (const op of ops) applyOp(room.sketch, op);
  broadcast(room, 'ops', { client: str(req.body?.client).slice(0, 40), ops });
  scheduleSave(room);
  res.json({ ok: true });
});

// citoyen : dossiers dont une ligne `citizen` vise cette fiche (ex. enquêtes où la personne apparaît)
r.get('/:kind', (req, res) => {
  const kind = kindOf(req.params.kind);
  const all = canSeeAll(kind, req.user) ? 1 : 0;
  const agent = req.query.agent_id ? intParam(req.query.agent_id) : null;
  const statut = kind.statuts[req.query.statut] ? req.query.statut : null;
  const rows = kind.fields.find(f => f.columns?.some(c => c.citizen));
  const citoyen = rows && req.query.citoyen ? String(intParam(req.query.citoyen)) : null;
  res.json(db.prepare(`${RECORD_SELECT}
    WHERE s.kind = ? AND (? = 1 OR s.agent_id = ?) AND (? IS NULL OR s.agent_id = ?) AND (? IS NULL OR s.statut = ?)
      AND (? IS NULL OR EXISTS (SELECT 1 FROM json_each(s.data, ?) p WHERE json_extract(p.value, ?) = ?))
    ORDER BY s.date DESC, s.id DESC LIMIT ?`)
    .all(req.params.kind, all, req.user.id, agent, agent, statut, statut,
      citoyen, `$.${rows?.key}`, `$.${rows?.columns.find(c => c.citizen).key}`, citoyen, listLimit(req)).map(parseRecord));
});

// Un dossier et ses liens (page d'une enquête, dossier BCI d'une opération)
r.get('/:kind/:id', (req, res) => {
  const kind = kindOf(req.params.kind);
  const rec = loadRecord(req.params.kind, intParam(req.params.id));
  if (!canSee(kind, req.user, rec)) fail(403, `Dossier réservé${kind.division ? ` à la division ${SPECIAL_DIVISIONS[kind.division].nom}` : ''}`);
  res.json({ ...rec, liens: liensOf(req.params.kind, kind, rec, req.user) });
});

r.post('/:kind', (req, res) => {
  const kind = kindOf(req.params.kind);
  const isSup = canManage(kind, req.user);
  const requester = isRequester(kind, req.user);
  if (kind.create === 'sup' && !isSup && !requester) fail(403, `Réservé aux superviseurs${kind.division ? ` et à la division ${SPECIAL_DIVISIONS[kind.division].nom}` : ''}`);
  const b = req.body ?? {};
  const agentId = isSup && b.agent_id ? intParam(b.agent_id) : req.user.id;
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(agentId)) fail(400, 'Agent introuvable');
  const data = cleanData(kind, b, isSup);
  if (requester && !data.dossier) fail(400, 'Une demande doit citer le numéro de votre dossier');
  checkUnique(req.params.kind, kind, data);
  const statut = isSup && kind.statuts[b.statut] ? b.statut : requester ? kind.request.statut : initialStatut(kind);
  const rec = transaction(() => {
    if (kind.numero) data.numero = nextNumero('service_records', kind.numero, `json_extract(data, '$.numero')`);
    extendLists(kind, data, req.user);
    const id = insertRow('service_records', {
      kind: req.params.kind, agent_id: agentId, statut, date: data[kind.dateKey] ?? '',
      data: JSON.stringify(data), created_by: req.user.id, updated_by: req.user.id,
    });
    const created = loadRecord(req.params.kind, id);
    grant(kind, created, req.user);
    return created;
  });
  logRecord(req.user, kind, rec, 'ajout');
  res.status(201).json(rec);
});

r.put('/:kind/:id', (req, res) => {
  const kind = kindOf(req.params.kind);
  const rec = loadRecord(req.params.kind, intParam(req.params.id));
  if (!canModify(kind, req.user, rec)) fail(403, 'Vous ne pouvez plus modifier cet élément');
  const isSup = canManage(kind, req.user);
  const b = req.body ?? {};
  const data = cleanData(kind, b, isSup, rec.data);
  if (isRequester(kind, req.user) && !data.dossier) fail(400, 'Une demande doit citer le numéro de votre dossier');
  checkUnique(req.params.kind, kind, data, rec.id);
  const f = { data: JSON.stringify(data), date: data[kind.dateKey] ?? '', updated_by: req.user.id };
  if (isSup && kind.statuts[b.statut]) f.statut = b.statut;
  if (isSup && b.agent_id) f.agent_id = intParam(b.agent_id);
  const updated = transaction(() => {
    extendLists(kind, data, req.user);
    updateRow('service_records', rec.id, f);
    const saved = loadRecord(req.params.kind, rec.id);
    grant(kind, saved, req.user);
    return saved;
  });
  logRecord(req.user, kind, updated, 'modification', f.statut && f.statut !== rec.statut ? `${kind.statuts[rec.statut][0]} → ${kind.statuts[f.statut][0]}` : '');
  res.json(updated);
});

r.delete('/:kind/:id', (req, res) => {
  const kind = kindOf(req.params.kind);
  const rec = loadRecord(req.params.kind, intParam(req.params.id));
  if (!canModify(kind, req.user, rec)) fail(403, 'Vous ne pouvez pas supprimer cet élément');
  db.prepare('DELETE FROM service_records WHERE id = ?').run(rec.id);
  logRecord(req.user, kind, rec, 'suppression');
  res.json({ ok: true });
});

export default r;
