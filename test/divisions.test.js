import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';

// Base jetable : DATA_DIR doit être fixé avant le chargement de db.js
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'mdt-test-'));
const { db, getList } = await import('../server/db.js');
const { default: service } = await import('../server/routes/service.js');
const { default: users } = await import('../server/routes/users.js');
const { default: search } = await import('../server/routes/search.js');

const addUser = (matricule, role, divisions = []) => Number(db.prepare(
  `INSERT INTO users (matricule, role, divisions, password_hash) VALUES (?, ?, ?, 'x')`,
).run(matricule, role, JSON.stringify(divisions)).lastInsertRowid);

const swat = addUser('S1', 'agent', ['S.W.A.T.']);
// Deux divisions : la patrouille et l'Academy
const formateur = addUser('F1', 'agent', ['Patrouille', 'Formateur SASPA']);
const recrue = addUser('R1', 'agent', ['Patrouille']);
const sup = addUser('C1', 'superviseur');
// Superviseur membre du BCI ; état-major : toutes les divisions
const supBci = addUser('C2', 'superviseur', ['Basic Criminal Investigations']);
const em = addUser('E1', 'etat_major');
const enqueteur = addUser('B1', 'agent', ['Basic Criminal Investigations']);

const app = express();
app.use(express.json());
// Même forme que req.user dans authenticate (server/auth.js)
app.use((req, res, next) => {
  const u = db.prepare('SELECT id, matricule, role, divisions, qualifications FROM users WHERE id = ?').get(Number(req.headers['x-user']));
  req.user = { ...u, divisions: JSON.parse(u.divisions), qualifications: JSON.parse(u.qualifications) };
  next();
});
app.use('/service', service);
app.use('/users', users);
app.use('/search', search);
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
const server = app.listen(0);
after(() => server.close());

const call = (user, method, url, body) => fetch(`http://localhost:${server.address().port}${url}`, {
  method, headers: { 'Content-Type': 'application/json', 'x-user': user }, body: body && JSON.stringify(body),
});

const op = {
  agent_id: swat, nom: 'Tempête', type: 'Braquage', lieu: 'Pacific Bank', date: '2026-11-06', statut: 'en_cours',
  objectif: 'Libérer les otages', plan: 'Pacific Bank, assaut principal',
  composition: [{ agent: 'S1', equipe: 'David', role: 'Pointeur' }, { agent: '', equipe: '', role: '' }],
  journal: [{ heure: '21:04', evenement: 'Top assaut', inconnu: 'x' }],
};

test("seuls la division et l'état-major gèrent les dossiers de division", async () => {
  assert.equal((await call(recrue, 'POST', '/service/operations', op)).status, 403);
  const created = await call(swat, 'POST', '/service/operations', op);
  assert.equal(created.status, 201);
  assert.equal((await created.json()).statut, 'en_cours');
  assert.equal((await (await call(recrue, 'GET', '/service/operations')).json()).length, 0);
  assert.equal((await (await call(em, 'GET', '/service/operations')).json()).length, 1);
  assert.equal((await (await call(sup, 'GET', '/service/operations')).json()).length, 0);
  assert.equal((await call(sup, 'POST', '/service/operations', op)).status, 403);
  assert.equal((await call(formateur, 'POST', '/service/enquetes', { objet: 'X', type: 'Autre', date_ouverture: '2026-11-06' })).status, 403);
});

test("fiche d'opération : lignes nettoyées, valeurs de liste contrôlées, plan lié", async () => {
  const [rec] = await (await call(swat, 'GET', '/service/operations')).json();
  assert.deepEqual(rec.data.composition, [{ agent: 'S1', equipe: 'David', role: 'Pointeur' }]);
  assert.deepEqual(rec.data.journal, [{ heure: '21:04', evenement: 'Top assaut' }]);
  assert.equal(rec.data.plan, 'Pacific Bank, assaut principal');
  const bad = await call(swat, 'PUT', `/service/operations/${rec.id}`, { composition: [{ agent: 'S1', role: 'Sorcier' }] });
  assert.equal(bad.status, 400);
});

test("plan d'assaut : schémas limités aux liens d'image valides", async () => {
  const res = await call(swat, 'POST', '/service/plans', {
    titre: 'Pacific Bank, assaut principal', cible: 'Banque', lieu: 'Vinewood', date: '2026-11-06',
    phases: [{ phase: 'Assaut', equipe: 'Goliath', action: 'Entrée par le toit' }],
    schemas: { schemas_1: '/mdt/uploads/plan.png', schemas_2: 'javascript:alert(1)' },
  });
  assert.equal(res.status, 201);
  assert.deepEqual((await res.json()).data.schemas, { schemas_1: '/mdt/uploads/plan.png' });
});

// Flux SSE lu avec fetch : next(event) attend le prochain événement de ce nom
async function openStream(user, url) {
  const ctrl = new AbortController();
  const res = await fetch(`http://localhost:${server.address().port}${url}`, { headers: { 'x-user': user }, signal: ctrl.signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const next = async event => {
    for (;;) {
      const end = buffer.indexOf('\n\n');
      if (end < 0) {
        const { value, done } = await reader.read();
        if (done) throw new Error('flux fermé');
        buffer += decoder.decode(value, { stream: true });
        continue;
      }
      const m = buffer.slice(0, end).match(/^event: (\w+)\ndata: (.*)$/s);
      buffer = buffer.slice(end + 2);
      if (m?.[1] === event) return JSON.parse(m[2]);
    }
  };
  return { status: res.status, next, close: () => ctrl.abort() };
}

test('croquis partagé : diffusion en direct, objets filtrés, sauvegarde, accès de la division', async () => {
  const [plan] = await (await call(swat, 'GET', '/service/plans')).json();
  const live = `/service/plans/${plan.id}/live/croquis`;
  assert.equal((await call(recrue, 'POST', live, { ops: [] })).status, 403);
  assert.equal((await openStream(recrue, live)).status, 403);

  const stream = await openStream(swat, live);
  assert.deepEqual(await stream.next('state'), { fond: '', objets: [] });
  assert.deepEqual(await stream.next('presence'), ['S1']);

  // L'état-major dessine : l'éditeur ouvert par S1 reçoit ses opérations, nettoyées
  const ops = [
    { n: 1, k: 'set', o: { id: 'trait01', t: 'trait', c: '#e5484d', w: 6, p: [10, 10, 20.6, 30, 40] } },
    { n: 2, k: 'set', o: { id: 'fleche1', t: 'fleche', c: 'red;x', w: 99, p: [0, 0, 100, 100, 5, 5] } },
    { n: 3, k: 'set', o: { id: 'unite01', t: 'unite', u: 'david', p: [400, 300], s: 'D1' } },
    { n: 4, k: 'set', o: { id: 'licorne', t: 'unite', u: 'licorne', p: [1, 1] } },
    { n: 5, k: 'set', o: { id: 'undefined0', t: 'constructor', p: [1, 1] } },
    { n: 6, k: 'set', o: { t: 'texte', p: [5, 5], s: 'sans id' } },
    { n: 7, k: 'fond', url: 'javascript:alert(1)' },
    { n: 8, k: 'pirater' },
  ];
  assert.equal((await call(sup, 'POST', live, { ops: [] })).status, 403);
  assert.equal((await call(em, 'POST', live, { client: 'abc', ops })).status, 200);
  const received = await stream.next('ops');
  assert.equal(received.client, 'abc');
  assert.deepEqual(received.ops, [
    { n: 1, k: 'set', o: { id: 'trait01', t: 'trait', p: [10, 10, 21, 30], c: '#e5484d', w: 6, s: '' } },
    { n: 2, k: 'set', o: { id: 'fleche1', t: 'fleche', p: [0, 0, 100, 100], c: '#ffffff', w: 20, s: '' } },
    { n: 3, k: 'set', o: { id: 'unite01', t: 'unite', p: [400, 300], c: '#ffffff', w: 3, s: 'D1', u: 'david' } },
    { n: 7, k: 'fond', url: '' },
  ]);

  // Première modification écrite tout de suite ; la suivante (moins d'une seconde après) à la fermeture du dernier éditeur
  const saved = async () => (await (await call(em, 'GET', '/service/plans')).json())[0].data.croquis.objets.map(o => o.id);
  assert.deepEqual(await saved(), ['trait01', 'fleche1', 'unite01']);
  await call(swat, 'POST', live, { client: 'xyz', ops: [{ n: 1, k: 'del', id: 'fleche1' }] });
  assert.deepEqual(await saved(), ['trait01', 'fleche1', 'unite01']);
  stream.close();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(await saved(), ['trait01', 'unite01']);

  // « Enregistrer » du formulaire ne touche pas au croquis
  await call(swat, 'PUT', `/service/plans/${plan.id}`, { croquis: { fond: '', objets: [] }, titre: 'Pacific Bank, assaut principal' });
  assert.deepEqual(await saved(), ['trait01', 'unite01']);
});

test('un agent Patrouille + Academy gère le suivi des recrues, la recrue voit ses évaluations', async () => {
  const res = await call(formateur, 'POST', '/service/formations', { agent_id: recrue, module: 'Secourisme', type: 'Examen théorique', date: '2026-11-06' });
  assert.equal(res.status, 201);
  const { id } = await res.json();
  assert.equal((await (await call(recrue, 'GET', '/service/formations')).json()).length, 1);
  assert.equal((await call(recrue, 'PUT', `/service/formations/${id}`, { note: '20/20' })).status, 403);
  assert.equal((await (await call(swat, 'GET', '/service/formations')).json()).length, 0);
});

test('catalogue : une fiche par formation de « Qualifications & formations », lue par tous, tenue par l’Academy', async () => {
  const formation = {
    agent_id: formateur, nom: 'Arme lourde niv. 2', rookie: 'Non', grade_min: 'Officier I',
    prerequis: [{ formation: 'Secourisme' }, { formation: '' }],
  };
  assert.equal((await call(recrue, 'POST', '/service/catalogue', formation)).status, 403);
  assert.equal((await call(formateur, 'POST', '/service/catalogue', { ...formation, grade_min: 'Général' })).status, 400);
  assert.ok(!getList('qualifications').includes('Arme lourde niv. 2'));

  // Une formation nouvelle rejoint la liste ; son nom est ensuite figé, et elle n'a qu'une fiche
  const res = await call(formateur, 'POST', '/service/catalogue', formation);
  assert.equal(res.status, 201);
  const fiche = await res.json();
  assert.deepEqual(fiche.data.prerequis, [{ formation: 'Secourisme' }]);
  assert.ok(getList('qualifications').includes('Arme lourde niv. 2'));
  assert.equal((await call(formateur, 'POST', '/service/catalogue', formation)).status, 409);
  const renamed = await call(formateur, 'PUT', `/service/catalogue/${fiche.id}`, { nom: 'Autre nom', duree: '2 h' });
  assert.deepEqual([(await renamed.json()).data.nom, getList('qualifications').includes('Autre nom')], ['Arme lourde niv. 2', false]);
  assert.deepEqual((await (await call(recrue, 'GET', '/service/catalogue')).json()).map(c => c.data.nom), ['Arme lourde niv. 2']);

  // Les formations attribuées sont prises dans la liste ; validée, la formation rejoint le profil de l'agent
  assert.equal((await call(formateur, 'POST', '/service/formations', { agent_id: recrue, module: 'Inconnue', type: 'Examen théorique', date: '2026-11-06' })).status, 400);
  const evaluation = await call(formateur, 'POST', '/service/formations', { agent_id: recrue, module: 'Arme lourde niv. 2', type: 'Évaluation pratique', date: '2026-11-06' });
  const qualifs = () => JSON.parse(db.prepare('SELECT qualifications FROM users WHERE id = ?').get(recrue).qualifications);
  assert.deepEqual(qualifs(), []);
  await call(formateur, 'PUT', `/service/formations/${(await evaluation.json()).id}`, { statut: 'validee', note: '17/20' });
  assert.deepEqual(qualifs(), ['Arme lourde niv. 2']);
});

test('notes de suivi : posées par un formateur, lues par le rookie concerné seulement', async () => {
  const note = { agent_id: recrue, type: 'Point positif', date: '2026-11-06', texte: 'Bon contact avec les citoyens' };
  assert.equal((await call(recrue, 'POST', '/service/notes_recrue', { ...note, agent_id: recrue })).status, 403);
  assert.equal((await call(formateur, 'POST', '/service/notes_recrue', note)).status, 201);
  assert.equal((await (await call(recrue, 'GET', '/service/notes_recrue')).json()).length, 1);
  assert.equal((await (await call(swat, 'GET', '/service/notes_recrue')).json()).length, 0);
});

test("tutorat : un rookie confié à un ou plusieurs agents de l'Academy, par l'Academy ou un superviseur", async () => {
  const formateur2 = addUser('F2', 'agent', ['Formateur SASPA']);
  const recrue2 = addUser('R2', 'agent', ['Patrouille']);
  const tuteurs = id => JSON.parse(db.prepare('SELECT tuteurs FROM users WHERE id = ?').get(id).tuteurs);
  assert.equal((await call(swat, 'PUT', `/users/${recrue}`, { tuteurs: [formateur] })).status, 403);
  assert.equal((await call(formateur, 'PUT', `/users/${recrue}`, { tuteurs: [swat] })).status, 400);
  // Plusieurs tuteurs pour un rookie, plusieurs rookies pour un tuteur ; l'Academy ne touche qu'aux tuteurs
  assert.equal((await call(formateur, 'PUT', `/users/${recrue}`, { tuteurs: [formateur, formateur2, formateur], divisions: ['SWAT'] })).status, 200);
  assert.equal((await call(sup, 'PUT', `/users/${recrue2}`, { tuteurs: [formateur] })).status, 200);
  assert.deepEqual([tuteurs(recrue), tuteurs(recrue2)], [[formateur, formateur2], [formateur]]);
  assert.equal(db.prepare('SELECT divisions FROM users WHERE id = ?').get(recrue).divisions, '["Patrouille"]');
  const [profil] = (await (await call(swat, 'GET', '/users')).json()).filter(u => u.id === recrue);
  assert.deepEqual(profil.tuteurs, [formateur, formateur2]);

  // Promu officier, le rookie sort du tutorat ; resté rookie, il le garde
  const admin = addUser('A1', 'admin');
  assert.equal((await call(admin, 'PUT', `/users/${recrue2}`, { grade: 'Rookie' })).status, 200);
  assert.deepEqual(tuteurs(recrue2), [formateur]);
  assert.equal((await call(admin, 'PUT', `/users/${recrue2}`, { grade: 'Officier I' })).status, 200);
  assert.deepEqual(tuteurs(recrue2), []);
});

test('plusieurs divisions par agent, sauf BCI avec S.W.A.T.', async () => {
  const put = divisions => call(sup, 'PUT', `/users/${recrue}`, { divisions });
  const res = await put(['Investigation', 'Formation', 'Investigation']);
  assert.deepEqual((await res.json()).divisions, ['Investigation', 'Formation']);
  const conflict = await put(['Investigation', 'SWAT']);
  assert.deepEqual([conflict.status, (await conflict.json()).error], [400, 'Un agent ne peut pas être à la fois au BCI et au S.W.A.T.']);
  assert.equal((await put(['Division imaginaire'])).status, 400);
  assert.equal((await put(['Patrouille'])).status, 200);
});

test('grades SWAT et BCI : posés par un superviseur, pris dans leur liste réglable', async () => {
  assert.equal(getList('grades_swat')[0], 'Recrue');
  assert.equal((await call(swat, 'PUT', `/users/${recrue}`, { grade_swat: 'Opérateur' })).status, 403);
  assert.equal((await call(sup, 'PUT', `/users/${swat}`, { grade_swat: 'Chef suprême' })).status, 400);
  const res = await call(sup, 'PUT', `/users/${swat}`, { grade_swat: 'Chef de colonne' });
  assert.equal((await res.json()).grade_swat, 'Chef de colonne');

  // BCI : même principe, liste initiale du plus bas au plus élevé
  assert.deepEqual(getList('grades_bci'), ['Detective', 'Formateur BCI', 'Superviseur BCI', 'C.O. BCI', 'Head of BCI']);
  // Un enquêteur ne se nomme pas lui-même : le champ est ignoré sur son profil
  assert.equal((await (await call(enqueteur, 'PUT', `/users/${enqueteur}`, { grade_bci: 'Head of BCI' })).json()).grade_bci, '');
  assert.equal((await call(sup, 'PUT', `/users/${enqueteur}`, { grade_bci: 'Commissaire' })).status, 400);
  assert.equal((await (await call(sup, 'PUT', `/users/${enqueteur}`, { grade_bci: 'Detective' })).json()).grade_bci, 'Detective');
});

test("enquêtes du BCI : numéro de dossier, actes, documents et personnes liés", async () => {
  const year = new Date().getFullYear();
  const citizen = Number(db.prepare(`INSERT INTO citizens (nom, prenom) VALUES ('Vance', 'Tony')`).run().lastInsertRowid);
  db.prepare(`INSERT INTO complaints (numero, created_by, plaignant) VALUES ('PLT-2026-0007', ?, '{"prenom":"Ana","nom":"Diaz"}')`).run(sup);
  const ouvrir = (user, body) => call(user, 'POST', '/service/enquetes', { agent_id: enqueteur, objet: 'Trafic à Davis', type: 'Stupéfiants', date_ouverture: '2026-11-06', ...body });
  assert.equal((await ouvrir(swat, {})).status, 403);

  // Numéro donné par le serveur, jamais par le formulaire, et gardé à la modification
  const first = await (await ouvrir(enqueteur, {
    numero: 'BCI-1999-0001',
    personnes: [{ role: 'Suspect', nom: 'Tony Vance', citoyen: String(citizen) }],
    pieces: [{ numero: 'plt-2026-0007' }, { numero: 'SASP-2026-9999' }],
  })).json();
  assert.equal(first.data.numero, `BCI-${year}-0001`);
  const second = await (await ouvrir(enqueteur, { pieces: [{ numero: first.data.numero, note: 'Même réseau' }] })).json();
  assert.equal(second.data.numero, `BCI-${year}-0002`);
  const put = await call(enqueteur, 'PUT', `/service/enquetes/${first.id}`, { numero: 'X', objet: 'Trafic de cocaïne à Davis' });
  assert.equal((await put.json()).data.numero, first.data.numero);
  assert.equal((await call(enqueteur, 'PUT', `/service/enquetes/${first.id}`, { personnes: [{ nom: 'X', citoyen: 'abc' }] })).status, 400);

  // Actes rattachés par le numéro, contrôlé
  assert.equal((await call(enqueteur, 'POST', '/service/actes', { dossier: 'BCI-1999-0042', type: 'Perquisition', date: '2026-11-06', compte_rendu: 'x' })).status, 400);
  const acte = await call(enqueteur, 'POST', '/service/actes', { dossier: first.data.numero.toLowerCase(), type: 'Audition de témoin', date: '2026-11-06', compte_rendu: 'Le témoin a vu…' });
  assert.equal(acte.status, 201);

  // Page du dossier : actes, documents résolus par leur numéro, fiches citoyens
  const { liens } = await (await call(enqueteur, 'GET', `/service/enquetes/${first.id}`)).json();
  assert.deepEqual(liens.entrants.map(r => [r.kind, r.data.compte_rendu]), [['actes', 'Le témoin a vu…']]);
  assert.deepEqual(liens.documents.map(d => [d.numero, d.doc ?? 'introuvable', d.label]), [['PLT-2026-0007', 'plainte', 'Ana Diaz'], ['SASP-2026-9999', 'introuvable', undefined]]);
  assert.deepEqual(liens.citoyens.map(c => [c.id, c.mandats_actifs]), [[citizen, 0]]);
  const connexe = await (await call(enqueteur, 'GET', `/service/enquetes/${second.id}`)).json();
  assert.equal(connexe.liens.documents[0].dossier.data.objet, 'Trafic de cocaïne à Davis');

  // Fiche citoyen → enquêtes où la personne apparaît ; rien pour les autres agents
  assert.deepEqual((await (await call(enqueteur, 'GET', `/service/enquetes?citoyen=${citizen}`)).json()).map(r => r.id), [first.id]);
  assert.deepEqual(await (await call(recrue, 'GET', `/service/enquetes?citoyen=${citizen}`)).json(), []);
  assert.equal((await call(swat, 'GET', `/service/enquetes/${first.id}`)).status, 403);
});

test("opérations du S.W.A.T. liées aux enquêtes par le numéro de dossier, demandes d'appui du BCI", async () => {
  const [enquete] = (await (await call(enqueteur, 'GET', '/service/enquetes')).json()).filter(e => e.data.personnes?.length);
  const { numero } = enquete.data;
  const base = { nom: 'Coup de filet', type: 'Mandat à haut risque', lieu: 'Davis', date: '2026-11-08', objectif: 'Interpeller Tony Vance' };
  assert.equal((await call(swat, 'POST', '/service/operations', { ...base, dossier: 'BCI-1999-0042' })).status, 400);
  const op = await (await call(swat, 'POST', '/service/operations', { ...base, dossier: numero.toLowerCase() })).json();
  assert.equal(op.data.dossier, numero);

  // Chacun voit l'autre dossier en résumé : l'enquête par son seul nom de code (masque), nom et lieu de l'opération
  const vu = (await (await call(swat, 'GET', `/service/operations/${op.id}`)).json()).liens.dossier;
  assert.deepEqual([vu.resume, vu.masque, vu.data, vu.agent_matricule], [true, true, { nom_code: 'Dossier confidentiel' }, undefined]);
  const vue = (await (await call(enqueteur, 'GET', `/service/enquetes/${enquete.id}`)).json()).liens.entrants.find(r => r.kind === 'operations');
  assert.deepEqual([vue.resume, vue.data], [true, { dossier: numero, nom: 'Coup de filet', type: 'Mandat à haut risque', lieu: 'Davis' }]);
  const complet = (await (await call(em, 'GET', `/service/enquetes/${enquete.id}`)).json()).liens.entrants.find(r => r.kind === 'operations');
  assert.equal(complet.data.objectif, 'Interpeller Tony Vance');
  // Un superviseur du BCI voit son enquête en entier, l'opération du S.W.A.T. en résumé ; hors BCI, rien
  const vueSup = (await (await call(supBci, 'GET', `/service/enquetes/${enquete.id}`)).json()).liens.entrants.find(r => r.kind === 'operations');
  assert.equal(vueSup.resume, true);
  assert.equal((await call(sup, 'GET', `/service/enquetes/${enquete.id}`)).status, 403);

  // Demande d'appui : un enquêteur la crée depuis son dossier, statut imposé, modifiable jusqu'à sa prise en charge
  assert.equal((await call(recrue, 'POST', '/service/operations', { ...base, dossier: numero })).status, 403);
  assert.equal((await call(enqueteur, 'POST', '/service/operations', base)).status, 400);
  const res = await call(enqueteur, 'POST', '/service/operations', { ...base, nom: 'Appui Davis', dossier: numero, statut: 'en_cours', agent_id: swat });
  const demande = await res.json();
  assert.deepEqual([res.status, demande.statut, demande.agent_id], [201, 'demandee', enqueteur]);
  assert.equal((await call(enqueteur, 'PUT', `/service/operations/${demande.id}`, { lieu: 'Davis, entrepôt' })).status, 200);
  assert.equal((await call(enqueteur, 'PUT', `/service/operations/${demande.id}`, { dossier: '' })).status, 400);
  assert.equal((await call(enqueteur, 'PUT', `/service/operations/${op.id}`, { lieu: 'Ailleurs' })).status, 403);
  await call(swat, 'PUT', `/service/operations/${demande.id}`, { statut: 'planifiee', agent_id: swat });
  assert.equal((await call(enqueteur, 'PUT', `/service/operations/${demande.id}`, { lieu: 'Ailleurs' })).status, 403);
});

test('superviseur : la Police Academy et ses propres divisions, pas les autres', async () => {
  const evaluation = { agent_id: recrue, module: 'Secourisme', type: 'Évaluation pratique', date: '2026-11-07' };
  assert.equal((await call(sup, 'POST', '/service/formations', evaluation)).status, 201);
  assert.ok((await (await call(sup, 'GET', '/service/formations')).json()).length >= 2);
  assert.equal((await call(supBci, 'POST', '/service/enquetes', { objet: 'Recel', type: 'Autre', date_ouverture: '2026-11-07' })).status, 201);
  assert.equal((await call(sup, 'POST', '/service/enquetes', { objet: 'Recel', type: 'Autre', date_ouverture: '2026-11-07' })).status, 403);
  assert.equal((await (await call(sup, 'GET', '/service/informateurs')).json()).length, 0);
  assert.equal((await call(supBci, 'POST', '/service/plans', { titre: 'X', cible: 'Banque', lieu: 'Y', date: '2026-11-07' })).status, 403);
  // Les dossiers de service restent ouverts à tous les superviseurs
  assert.equal((await call(sup, 'POST', '/service/sanctions', { agent_id: recrue, type: 'Avertissement', motif: 'Retard', date: '2026-11-07' })).status, 201);
});

test('les dossiers de service gardent leurs règles', async () => {
  assert.equal((await call(swat, 'POST', '/service/sanctions', { type: 'Avertissement', motif: 'X', date: '2026-11-06' })).status, 403);
  assert.equal((await call(swat, 'GET', '/service/constructor')).status, 404);
});

test("enquête du BCI vue ailleurs : nom de code seul, sans numéro ni lien, hors BCI et état-major", async () => {
  const created = await call(enqueteur, 'POST', '/service/enquetes', { agent_id: enqueteur, objet: 'Réseau de faux papiers', nom_code: 'Faucon', type: 'Fraude / corruption', date_ouverture: '2026-11-12' });
  assert.equal(created.status, 201);
  const enquete = await created.json();
  const numero = enquete.data.numero;
  const opRes = await call(swat, 'POST', '/service/operations', { ...op, nom: 'Appui Faucon', dossier: numero });
  assert.equal(opRes.status, 201);
  const { id } = await opRes.json();

  // S.W.A.T. : la fiche liée n'est que le nom de code
  const vu = (await (await call(swat, 'GET', `/service/operations/${id}`)).json()).liens.dossier;
  assert.deepEqual(vu, { kind: 'enquetes', data: { nom_code: 'Faucon' }, resume: true, masque: true });
  // État-major (qui lit les deux divisions) : le dossier complet
  const full = (await (await call(em, 'GET', `/service/operations/${id}`)).json()).liens.dossier;
  assert.equal(full.data.objet, 'Réseau de faux papiers');
  assert.ok(!full.masque);
  // Sans nom de code : libellé générique
  db.prepare(`UPDATE service_records SET data = json_remove(data, '$.nom_code') WHERE id = ?`).run(enquete.id);
  assert.equal((await (await call(swat, 'GET', `/service/operations/${id}`)).json()).liens.dossier.data.nom_code, 'Dossier confidentiel');

  // Recherche de documents : les enquêtes seulement pour le BCI et l'état-major
  const docs = async u => (await (await call(u, 'GET', '/search/documents?q=faux')).json()).filter(d => d.type === 'Enquête BCI');
  assert.equal((await docs(enqueteur)).length, 1);
  assert.equal((await docs(em)).length, 1);
  assert.equal((await docs(swat)).length, 0);
  assert.equal((await docs(sup)).length, 0);
});
