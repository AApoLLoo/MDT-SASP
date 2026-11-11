# Accès justice au MDT : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter les comptes magistrat et avocat au MDT, faire juger les rapports d'arrestation par un magistrat, rattacher des avocats aux dossiers et permettre le blanchiment de casier.

**Architecture:** Deux nouveaux rôles hors de la hiérarchie police (`hasRole` reste linéaire sur `agent < superviseur < etat_major < admin`, un magistrat n'hérite donc de rien). Un middleware unique `justiceGate` filtre toutes les routes `/api` pour ces rôles par liste blanche (refus par défaut) ; les contrôles fins (avocat rattaché, rapport blanchi) vivent dans les routes. Le front masque menus et boutons mais n'est jamais la barrière.

**Tech Stack:** Node ≥ 22.13, Express 5, `node:sqlite`, `node --test`, front en modules ES sans build.

**Spec:** `docs/superpowers/specs/2026-11-11-acces-justice-design.md`

## Global Constraints

- Pas de nouvelle dépendance.
- Rôles : `magistrat`, `avocat`. Fonctions (colonne `grade` existante) : magistrat ∈ `Procureur`, `Juge` ; avocat = `Avocat`.
- Statuts du rapport d'arrestation : `brouillon` → `en_attente` → `finalise`.
- Seuls magistrat et admin finalisent (`canJudge`). Aucun rôle police en dessous d'admin ne finalise, ne rouvre, ne blanchit.
- Les rapports d'incident ne changent pas de circuit.
- Toute action de justice est journalisée avec `logAction` (libellés donnés dans chaque tâche).
- Libellés UI en français, comme le reste du MDT.
- Migration de schéma : `PRAGMA user_version` passe à 6 ; reconstruction de table sur le modèle de la v4 de `server/db.js`. `npm run backup` avant mise en production.
- Tests : `npm test` (= `node --disable-warning=ExperimentalWarning --test`) doit rester vert à chaque commit.

## Review Focus

1. Un avocat qui change l'id dans l'URL (`GET /api/reports/<autre>`) doit recevoir 403. → test Task 3.
2. Un agent ou un superviseur qui appelle directement `POST /reports/:id/finalize` doit recevoir 403. → test Task 3.
3. Un superviseur qui modifie un rapport `en_attente` ou `finalise` via `PUT /reports/:id` doit recevoir 403. → test Task 3.
4. Un rapport blanchi ne compte plus dans le casier ni dans les statistiques du tableau de bord pour la police, mais reste visible pour un magistrat. → test Task 4.
5. Un compte justice ne peut pas se connecter à l'espace agent du site public (`siteAuth`). → test Task 2.

---

### Task 1: Schéma v6 et rôles justice

**Files:**
- Modify: `server/db.js` (CHECK de `users.role` et `arrest_reports.statut` dans les `CREATE TABLE`, `ensureColumns`, bloc v6 après la v5)
- Modify: `server/auth.js` (exports rôles)
- Test: `test/migration-v6.test.js`

**Interfaces:**
- Produces (`server/auth.js`):
  - `JUSTICE_ROLES = ['magistrat', 'avocat']`
  - `ALL_ROLES = [...ROLES, ...JUSTICE_ROLES]`
  - `JUSTICE_FONCTIONS = { magistrat: ['Procureur', 'Juge'], avocat: ['Avocat'] }`
  - `isJustice(user) -> boolean`
  - `canJudge(user) -> boolean` : `user.role === 'magistrat' || hasRole(user, 'admin')`
  - `requireJudge` middleware Express : 403 `{ error: 'Réservé aux magistrats' }`
- Produces (schéma) : `arrest_reports` gagne `avocat_id INTEGER REFERENCES users(id)`, `calc_input_police TEXT`, `calc_result_police TEXT`, `depose_at TEXT`, `juge_id INTEGER REFERENCES users(id)`, `renvoi_motif TEXT NOT NULL DEFAULT ''`, `blanchi_at TEXT`, `blanchi_par INTEGER REFERENCES users(id)`, `blanchi_motif TEXT NOT NULL DEFAULT ''` ; `complaints` gagne `avocat_ids TEXT NOT NULL DEFAULT '[]'` (JSON d'ids users).

- [ ] **Step 1: Write the failing test** `test/migration-v6.test.js`

Avant d'importer `db.js`, créer dans un `DATA_DIR` temporaire un `mdt.sqlite` contenant les tables `users` et `arrest_reports` **telles que définies dans `server/db.js` avant cette tâche** (copier leurs `CREATE TABLE`, avec les anciens CHECK), `PRAGMA user_version = 5`, un utilisateur et un rapport `finalise`. Puis importer `db.js`.

```js
test('v6 : rôles justice et statut en_attente acceptés, données conservées', () => {
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 6);
  assert.equal(db.prepare('SELECT statut FROM arrest_reports WHERE numero = ?').get('SASP-OLD').statut, 'finalise');
  db.prepare(`INSERT INTO users (matricule, role, password_hash) VALUES ('J1', 'magistrat', 'x')`).run();
  db.prepare(`INSERT INTO users (matricule, role, password_hash) VALUES ('L1', 'avocat', 'x')`).run();
  db.prepare(`UPDATE arrest_reports SET statut = 'en_attente' WHERE numero = 'SASP-OLD'`).run();
  const cols = db.prepare('PRAGMA table_info(arrest_reports)').all().map(c => c.name);
  for (const c of ['avocat_id', 'calc_input_police', 'calc_result_police', 'depose_at', 'juge_id', 'renvoi_motif', 'blanchi_at', 'blanchi_par', 'blanchi_motif']) assert.ok(cols.includes(c), c);
  assert.ok(db.prepare('PRAGMA table_info(complaints)').all().some(c => c.name === 'avocat_ids'));
});

test('magistrat et avocat hors hiérarchie police', () => {
  assert.equal(hasRole({ role: 'magistrat' }, 'agent'), false);
  assert.equal(hasRole({ role: 'avocat' }, 'agent'), false);
  assert.equal(canJudge({ role: 'magistrat' }), true);
  assert.equal(canJudge({ role: 'admin' }), true);
  assert.equal(canJudge({ role: 'etat_major' }), false);
});
```

- [ ] **Step 2: Run** `node --disable-warning=ExperimentalWarning --test test/migration-v6.test.js` — Expected: FAIL (CHECK constraint failed / `canJudge` non exporté).

- [ ] **Step 3: Implement**
  - Dans les `CREATE TABLE` de `db.js` : role CHECK `('agent', 'superviseur', 'etat_major', 'admin', 'magistrat', 'avocat')`, statut CHECK `('brouillon', 'en_attente', 'finalise')`.
  - `ensureColumns('arrest_reports', {...})` et `ensureColumns('complaints', { avocat_ids: ... })` avec les définitions ci-dessus.
  - Bloc v6 : même technique que la v4 (définition lue dans `sqlite_master`, `replace` du CHECK, `CREATE TABLE <t>_v6 … INSERT SELECT * … DROP … RENAME`, `foreign_keys` OFF/ON dans `try/finally`), appliquée à `users` puis `arrest_reports`, dans une seule transaction, puis `user_version = 6`. Les index de `arrest_reports` (`idx_reports_citizen`) sont recréés après le RENAME. Ne pas toucher au bloc v4.
  - `auth.js` : exports listés dans Interfaces.

- [ ] **Step 4: Run** le même test puis `npm test` — Expected: PASS, aucun test existant cassé.

- [ ] **Step 5: Commit** `git add server/db.js server/auth.js test/migration-v6.test.js && git commit -m "feat(justice): schéma v6, rôles magistrat et avocat"`

---

### Task 2: Barrière justice et comptes

**Files:**
- Create: `server/justice.js`
- Modify: `server/index.js:53` (monter la barrière juste après `app.use('/api', requireAuth)`, et `app.use('/api/justice', justice)`)
- Modify: `server/auth.js` (`activeUser` de `siteAuth` exclut les rôles justice)
- Modify: `server/routes/users.js` (annuaire, liste des avocats, création/modification des comptes justice)
- Test: `test/justice.test.js` (créé ici, enrichi par les tâches 3 à 5)

**Interfaces:**
- Consumes: `isJustice`, `canJudge`, `ALL_ROLES`, `JUSTICE_FONCTIONS` (Task 1).
- Produces (`server/justice.js`):
  - `justiceGate(req, res, next)` : police → `next()` ; sinon la requête doit correspondre à une entrée `[méthode, RegExp sur req.path]` de la liste du rôle, sinon 403 `{ error: 'Accès réservé à la police' }`.
  - `cleanAvocatId(value) -> number | null` : vide → `null` ; sinon id d'un compte actif de rôle `avocat`, sinon `fail(400, 'Avocat inconnu')`.
  - `cleanAvocatIds(values) -> string` : JSON d'ids uniques validés par `cleanAvocatId`, 4 au plus.
  - Router par défaut, monté sur `/api/justice` : `GET /mes-dossiers` (avocat) → `{ reports: [{ id, numero, statut, date_faits, suspect_nom, suspect_prenom }], complaints: [{ id, numero, statut, date_depot }] }`, dossiers où il est rattaché.
- Produces (`server/routes/users.js`) : `GET /users` exclut les rôles justice ; `GET /users?justice=1` (admin seulement, sinon 403) renvoie uniquement les comptes justice ; `GET /users/avocats` → `[{ id, matricule, nom, prenom }]` des avocats actifs (déclarer la route **avant** `/:id`).

Listes blanches (chemins relatifs à `/api`) :
- magistrat — `GET` : `/(citizens|vehicles|warrants|reports|incidents|complaints|evidence)(/\d+)?`, `/(penal-code|weapons|settings|users|users/avocats)` ; `POST` : `/warrants`, `/uploads`, `/complaints/\d+/close`, `/penal-code`, `/reports/\d+/(finalize|send-back|reopen|blanchir|unblanchir)`, `/citizens/\d+/blanchir` ; `PUT` : `/penal-code/\d+`, `/reports/\d+/jugement`.
- avocat — `GET` : `/reports/\d+`, `/complaints/\d+`, `/justice/mes-dossiers`, `/settings`, `/penal-code` (lu par les vues de dossier, public de fait).

Comptes : dans `clean()` de `users.js`, `role` doit appartenir à `ALL_ROLES` ; quand le rôle final (nouveau ou actuel) est un rôle justice, `grade` doit appartenir à `JUSTICE_FONCTIONS[role]` au lieu de `getList('grades')`.

- [ ] **Step 1: Write the failing tests** dans `test/justice.test.js`

Même structure que `test/dossiers.test.js` (DATA_DIR temporaire, app Express de test), avec un utilisateur par rôle (`agent`, `superviseur`, `admin`, `magistrat` grade `Juge`, `avocat` grade `Avocat`, un second `avocat`) et un middleware de test qui pose `req.user` d'après un en-tête `x-user` (id). Monter `justiceGate` puis les routes réelles (`citizens`, `reports`, `complaints`, `warrants`, `users`, `reference`, `misc`, `service`, `justice`) comme dans `index.js`.

```js
test('barrière : le magistrat lit les dossiers, pas le personnel', async () => {
  assert.equal((await req('GET', '/citizens', magistrat)).status, 200);
  assert.equal((await req('GET', '/service', magistrat)).status, 403);
  assert.equal((await req('GET', '/audit', magistrat)).status, 403);
  assert.equal((await req('POST', '/warrants', magistrat, { type: 'mandat_arret', motif: 'Vol' })).status, 201);
});

test("barrière : l'avocat ne voit que ses dossiers", async () => {
  assert.equal((await req('GET', '/citizens', avocat)).status, 403);
  assert.equal((await req('GET', '/reports', avocat)).status, 403);
  assert.equal((await req('GET', '/justice/mes-dossiers', avocat)).status, 200);
});

test('annuaire : les comptes justice ne sont pas des agents', async () => {
  const roles = (await req('GET', '/users', agent)).body.map(u => u.role);
  assert.ok(!roles.includes('magistrat') && !roles.includes('avocat'));
  assert.deepEqual((await req('GET', '/users/avocats', agent)).body.map(u => u.matricule).sort(), ['L1', 'L2']);
  assert.equal((await req('GET', '/users?justice=1', agent)).status, 403);
  assert.equal((await req('GET', '/users?justice=1', admin)).body.length, 3);
});

test('comptes justice : fonction contrôlée, site public refusé', async () => {
  assert.equal((await req('POST', '/users', admin, { matricule: 'J9', role: 'magistrat', grade: 'Officier I', password: '12345678' })).status, 400);
  assert.equal((await req('POST', '/users', admin, { matricule: 'J9', role: 'magistrat', grade: 'Procureur', password: '12345678' })).status, 201);
  assert.equal(siteAuth.find('J9'), null);
});
```

(Adapter le corps du `POST /warrants` aux champs obligatoires réels de `server/routes/warrants.js`.)

- [ ] **Step 2: Run** `node --disable-warning=ExperimentalWarning --test test/justice.test.js` — Expected: FAIL (`server/justice.js` absent).
- [ ] **Step 3: Implement** `server/justice.js`, le montage dans `index.js`, `siteAuth`, `users.js` selon Interfaces.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(justice): barrière d'accès et comptes magistrat/avocat"`

---

### Task 3: Circuit de jugement du rapport d'arrestation

**Files:**
- Modify: `server/routes/reports.js`
- Test: `test/justice.test.js`

**Interfaces:**
- Consumes: `canJudge`, `requireJudge`, `cleanAvocatId`.
- Produces (routes, sous `/api/reports`) :
  - `POST /:id/submit` — rédacteur ou superviseur, statut `brouillon` ; mêmes contrôles que l'actuel finalize (suspect, au moins un chef, approbateur si retenue MAX) ; pose `statut='en_attente'`, `depose_at`, `calc_input_police`/`calc_result_police` (copie du calcul courant), vide `renvoi_motif`. Journal : « Rapport déposé pour jugement ».
  - `PUT /:id/jugement` — `requireJudge`, statut `en_attente` ; corps `{ calc_input?, avocat_id? }` ; recalcule `calc_result` comme `PUT /:id`. Journal : « Jugement modifié » avec l'écart d'amende.
  - `POST /:id/finalize` — `requireJudge`, statut `en_attente` (sinon 400 « Seul un rapport en attente de jugement peut être finalisé ») ; comportement actuel conservé (mandats, scellés, journal) + `juge_id = req.user.id`.
  - `POST /:id/send-back` — `requireJudge`, statut `en_attente`, `{ motif }` obligatoire (400 sinon) → `brouillon`, `renvoi_motif = motif`, `depose_at = NULL`. Journal : « Rapport renvoyé à l'agent ».
  - `POST /:id/reopen` — `requireJudge` (remplace superviseur), `finalise` → `en_attente`, `finalized_at = NULL`, `juge_id = NULL`.
  - `PUT /:id` — `can_edit` devient `statut === 'brouillon' && (rédacteur || hasRole superviseur)` ; accepte `avocat_id` (via `cleanAvocatId`).
  - `DELETE /:id` — rapport non brouillon : admin seulement.
  - `GET /:id` — avocat : 403 si `avocat_id !== req.user.id`.
  - `GET /` — `statut` accepte `en_attente` ; avec `statut=en_attente`, tri `depose_at ASC`.
  - `loadReport` ajoute `avocat` (`{ id, matricule, nom, prenom }` ou `null`), `juge` (`{ matricule, nom, prenom, grade }` ou `null`), `calc_input_police`/`calc_result_police` parsés, `can_judge`.

- [ ] **Step 1: Write the failing tests**

```js
test('circuit : dépôt par l’agent, finalisation par le magistrat seulement', async () => {
  const id = await rapportPret(agent);            // helper : crée un rapport avec suspect + 1 chef
  assert.equal((await req('POST', `/reports/${id}/finalize`, agent)).status, 403);
  assert.equal((await req('POST', `/reports/${id}/submit`, agent)).status, 200);
  assert.equal((await req('PUT', `/reports/${id}`, agent, { faits: 'x' })).status, 403);
  assert.equal((await req('PUT', `/reports/${id}`, superviseur, { faits: 'x' })).status, 403);
  assert.equal((await req('POST', `/reports/${id}/finalize`, superviseur)).status, 403);
  await req('PUT', `/reports/${id}/jugement`, magistrat, { calc_input: { charges: [] } });
  const fin = await req('POST', `/reports/${id}/finalize`, magistrat);
  assert.equal(fin.status, 400, 'aucun chef après jugement');
  await req('PUT', `/reports/${id}/jugement`, magistrat, { calc_input: chargesInitiales });
  const ok = (await req('POST', `/reports/${id}/finalize`, magistrat)).body;
  assert.equal(ok.statut, 'finalise');
  assert.equal(ok.juge.matricule, 'J1');
  assert.ok(ok.calc_result_police, 'calcul police conservé');
});

test('renvoi et réouverture', async () => {
  const id = await rapportPret(agent);
  await req('POST', `/reports/${id}/submit`, agent);
  assert.equal((await req('POST', `/reports/${id}/send-back`, magistrat, {})).status, 400);
  const back = (await req('POST', `/reports/${id}/send-back`, magistrat, { motif: 'Faits incomplets' })).body;
  assert.equal(back.statut, 'brouillon');
  assert.equal(back.renvoi_motif, 'Faits incomplets');
  await req('POST', `/reports/${id}/submit`, agent);
  await req('POST', `/reports/${id}/finalize`, admin);
  assert.equal((await req('POST', `/reports/${id}/reopen`, superviseur)).status, 403);
  assert.equal((await req('POST', `/reports/${id}/reopen`, magistrat)).status, 200);
});

test('avocat rattaché : accès à son dossier seulement', async () => {
  const id = await rapportPret(agent);
  await req('PUT', `/reports/${id}`, agent, { avocat_id: avocatId });
  assert.equal((await req('GET', `/reports/${id}`, avocat)).status, 200);
  assert.equal((await req('GET', `/reports/${id}`, avocat2)).status, 403);
  assert.equal((await req('PUT', `/reports/${id}`, agent, { avocat_id: agentId })).status, 400);
  assert.deepEqual((await req('GET', '/justice/mes-dossiers', avocat)).body.reports.map(r => r.id), [id]);
});
```

- [ ] **Step 2: Run** `node --disable-warning=ExperimentalWarning --test test/justice.test.js` — Expected: FAIL (routes absentes).
- [ ] **Step 3: Implement** selon Interfaces ; les contrôles du dépôt et de la finalisation partagent une fonction `checkReady(rep)` dans `reports.js`.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(justice): dépôt pour jugement, jugement et finalisation par magistrat"`

---

### Task 4: Blanchiment de casier

**Files:**
- Modify: `server/routes/reports.js`, `server/routes/citizens.js`, `server/routes/misc.js` (statistiques du tableau de bord)
- Test: `test/justice.test.js`

**Interfaces:**
- Consumes: `canJudge`, `requireJudge`.
- Produces :
  - `POST /reports/:id/blanchir { motif }` — `requireJudge`, rapport `finalise` non blanchi, motif obligatoire ; pose `blanchi_at`, `blanchi_par`, `blanchi_motif`. Journal : « Condamnation blanchie ».
  - `POST /citizens/:id/blanchir { motif }` — `requireJudge` ; blanchit tous les rapports `finalise` non blanchis du citoyen → `{ count }`. Journal : « Casier blanchi ».
  - `POST /reports/:id/unblanchir { motif }` — `requireJudge` ; remet les trois colonnes à `NULL`/`''`. Journal : « Blanchiment annulé ».
  - Lecture : pour un utilisateur où `canJudge` est faux, les rapports blanchis sont exclus de `GET /citizens/:id` (`reports`), de `GET /reports`, des compteurs `casiers` et `rapports_mois` de `GET /dashboard`, et `GET /reports/:id` répond 404. Pour `canJudge`, `GET /citizens/:id` renvoie aussi `blanchi_at` et `blanchi_motif` par rapport.

- [ ] **Step 1: Write the failing test**

```js
test('blanchiment : caché à la police, visible du magistrat, réversible', async () => {
  const { id, citizenId } = await rapportFinalise();   // helper : dépôt + finalisation par magistrat
  assert.equal((await req('POST', `/reports/${id}/blanchir`, superviseur, { motif: 'x' })).status, 403);
  assert.equal((await req('POST', `/reports/${id}/blanchir`, magistrat, {})).status, 400);
  await req('POST', `/reports/${id}/blanchir`, magistrat, { motif: 'Réhabilitation' });
  assert.equal((await req('GET', `/citizens/${citizenId}`, agent)).body.reports.length, 0);
  assert.equal((await req('GET', `/reports/${id}`, agent)).status, 404);
  assert.equal((await req('GET', '/dashboard', agent)).body.stats.casiers, 0);
  const vu = (await req('GET', `/citizens/${citizenId}`, magistrat)).body.reports[0];
  assert.equal(vu.blanchi_motif, 'Réhabilitation');
  await req('POST', `/reports/${id}/unblanchir`, magistrat, { motif: 'Erreur' });
  assert.equal((await req('GET', `/citizens/${citizenId}`, agent)).body.reports.length, 1);
});
```

(`/dashboard` est refusé au magistrat par la barrière : ce test l'appelle en tant qu'agent.)

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** selon Interfaces.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(justice): blanchiment de casier"`

---

### Task 5: Plaintes, code pénal

**Files:**
- Modify: `server/routes/complaints.js`, `server/routes/reference.js`
- Test: `test/justice.test.js`

**Interfaces:**
- Consumes: `requireJudge`, `cleanAvocatIds`.
- Produces :
  - `POST`/`PUT /complaints` acceptent `avocat_ids` (tableau d'ids) via `cleanAvocatIds` ; `load()` ajoute `avocats: [{ id, matricule, nom, prenom }]`.
  - `GET /complaints/:id` — avocat : 403 s'il n'est pas dans `avocat_ids`.
  - `POST /complaints/:id/close { statut }` — `requireJudge`, `statut ∈ ['classee', 'resolue']` (400 sinon) ; même gestion de `closed_at` et même journal que `PUT`.
  - `POST /penal-code` et `PUT /penal-code/:id` : `requireJudge` à la place de `requireRole('admin')`.

- [ ] **Step 1: Write the failing test**

```js
test('plaintes : avocats rattachés, clôture par le magistrat', async () => {
  const { id } = (await req('POST', '/complaints', agent, { plaignant: { nom: 'Doe' }, avocat_ids: [avocatId] })).body;
  assert.equal((await req('GET', `/complaints/${id}`, avocat)).status, 200);
  assert.equal((await req('GET', `/complaints/${id}`, avocat2)).status, 403);
  assert.equal((await req('POST', `/complaints/${id}/close`, magistrat, { statut: 'ouverte' })).status, 400);
  assert.equal((await req('POST', `/complaints/${id}/close`, magistrat, { statut: 'classee' })).body.statut, 'classee');
});

test('code pénal modifiable par le magistrat, pas par l’agent', async () => {
  assert.equal((await req('PUT', '/penal-code/1', agent, { amende: 10 })).status, 403);
  assert.equal((await req('PUT', '/penal-code/1', magistrat, { amende: 10 })).status, 200);
});
```

(Adapter le corps du `POST /complaints` aux champs obligatoires réels.)

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(justice): avocats sur les plaintes, clôture et code pénal par le magistrat"`

---

### Task 6: Front — session justice, menu, accueil

**Files:**
- Modify: `public/mdt/js/api.js` (helpers de rôle)
- Modify: `public/mdt/js/app.js` (menu, routes, appels au démarrage)
- Create: `public/mdt/js/views/justice.js`
- Modify: `public/mdt/js/views/reports.js` (`statutBadge`, filtre), `public/mdt/js/views/bci.js:28` (libellé de statut)
- Modify: `public/mdt/js/views/agents.js` (rôles et fonctions justice à la création/modification ; section « Comptes justice » pour l'admin via `GET /users?justice=1`)

**Interfaces:**
- Consumes: routes des tâches 2 à 5.
- Produces (`api.js`) : `isMagistrat()`, `isAvocat()`, `isJustice()`, `canJudge()` (miroirs de `auth.js` sur `state.user`) ; `loadAvocats() -> Promise<Array<{ id, matricule, nom, prenom }>>` (cache dans `state.avocats`).
- Produces (`reports.js`) : `statutBadge('en_attente')` → badge « En attente de jugement » ; `statutLabel(statut) -> string` réutilisé par `bci.js`.
- Produces (`views/justice.js`) : `render(main)` — magistrat : tableau des rapports `GET /reports?statut=en_attente` (n°, suspect, date de dépôt, rédacteur), clic → `#/rapports/:id` ; avocat : « Mes dossiers » depuis `GET /justice/mes-dossiers`.

Menu : magistrat → entrée `/` « En attente de jugement » + groupes Dossiers, Rapports, Outils existants ; avocat → seule entrée `/` « Mes dossiers ». Pour un compte justice, la route `/` rend `justice.render`, toute route hors de ces groupes affiche « Page introuvable », et `updateUnread()` (annonces) n'est pas appelé.

- [ ] **Step 1: Implement** selon Interfaces.
- [ ] **Step 2: Verify** `node --check` sur chaque fichier modifié, puis `npm start` et contrôle manuel : connexion magistrat (menu et accueil), connexion avocat (menu réduit, `#/casiers` → page introuvable, aucune erreur 403 en console au démarrage), connexion agent (menu inchangé), création d'un compte magistrat « Juge » par un admin.
- [ ] **Step 3: Commit** `git commit -m "feat(justice): menu, accueil et comptes justice côté MDT"`

---

### Task 7: Front — rapport d'arrestation

**Files:**
- Modify: `public/mdt/js/views/report-edit.js` (bouton dépôt, choix de l'avocat, motif de renvoi)
- Modify: `public/mdt/js/views/report-view.js` (actions de jugement, comparaison, mentions)
- Create: `public/mdt/js/views/report-judge.js` ; route `#/rapports/(\d+)/juger` dans `app.js`

**Interfaces:**
- Consumes: `mountCalculator(root, { value, onChange })` de `components/charges-calculator.js` ; `loadAvocats()`, `canJudge()`, `isAvocat()` ; routes de la tâche 3.
- Produces (`report-judge.js`) : `render(main, [id])` — calculatrice montée sur `rep.calc_input`, sélecteur d'avocat, boutons « Enregistrer » (`PUT /jugement`), « Finaliser le jugement » (`POST /finalize`, après enregistrement), « Renvoyer à l'agent » (demande le motif, `POST /send-back`).

Comportements :
- Éditeur : « Finaliser » devient « Déposer pour jugement » (`POST /submit`, puis vue du rapport) ; dans les droits exercés, case avocat + `<select>` des comptes avocats (`avocat_id`) en plus du nom libre existant ; si `renvoi_motif` est non vide, alerte « Renvoyé par la justice : … » en tête.
- Vue : badge « En attente de jugement » ; bouton « Juger » si `can_judge` et `en_attente` ; « Rouvrir » si `can_judge` et `finalise` (remplace la condition superviseur) ; bloc « Calcul proposé par la police » sous la calculatrice quand `calc_result_police` diffère de `calc_result` (amende, GAV, chefs) ; pied du bordereau « Jugé par <grade> <nom> le <date> » ; ligne « Avocat : <nom> » dans les droits ; pour un avocat, pas d'appel à `loadUsers()` (les agents s'affichent par matricule) ni de boutons d'action, impression et Google Docs conservés.

- [ ] **Step 1: Implement**.
- [ ] **Step 2: Verify** `node --check`, puis parcours manuel complet : agent crée → dépose → ne peut plus modifier ; magistrat juge (retire une charge) → finalise → bordereau montre « Jugé par » et l'écart police/jugé ; renvoi avec motif visible par l'agent ; avocat rattaché ouvre le rapport, un autre avocat reçoit l'erreur.
- [ ] **Step 3: Commit** `git commit -m "feat(justice): dépôt, jugement et lecture avocat du rapport d'arrestation"`

---

### Task 8: Front — casier, plaintes, code pénal

**Files:**
- Modify: `public/mdt/js/views/citizens.js` (blanchiment)
- Modify: `public/mdt/js/views/complaints.js` (avocats, clôture magistrat, lecture avocat)
- Modify: `public/mdt/js/views/penal-code.js:36` (`admin` → `canJudge()`)

**Interfaces:**
- Consumes: routes des tâches 4 et 5 ; `canJudge()`, `isAvocat()`, `loadAvocats()`.

Comportements :
- Casier (magistrat/admin) : bouton « Blanchir le casier » (motif demandé) ; par ligne de rapport, « Blanchir » ou, si blanchi, badge « Blanchi » + motif au survol et « Annuler le blanchiment ». Les rapports blanchis sont exclus des statistiques affichées (arrestations, amendes, GAV). Bouton « Nouveau rapport d'arrestation » masqué pour les comptes justice.
- Plainte : éditeur (police) avec sélection multiple des avocats (`avocat_ids`) ; vue : boutons « Classer » / « Résoudre » pour `canJudge()` sur une plainte non close ; pour un avocat, pas de « Modifier » ni « Créer le rapport ».
- Code pénal : édition visible pour `canJudge()`.

- [ ] **Step 1: Implement**.
- [ ] **Step 2: Verify** `node --check`, `npm test`, puis contrôle manuel : blanchir une condamnation (disparaît du casier vu par un agent), annuler ; clôture d'une plainte par un magistrat ; modification d'une amende du code pénal par un magistrat.
- [ ] **Step 3: Commit** `git commit -m "feat(justice): blanchiment, plaintes et code pénal côté MDT"`
