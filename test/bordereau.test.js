import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'mdt-bordereau-'));
const { db, UPLOAD_DIR } = await import('../server/db.js');
const { parseBordereau, matchCharges, docIdFromUrl, importBordereau } = await import('../server/bordereau.js');

// Image PNG distincte par appel (signature PNG + octets propres) ; le logo décoratif revient plusieurs fois à l'identique
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let n = 0;
const img = (data = `photo-${++n}`) => `<p><span><img alt="" src="data:image/png;base64,${Buffer.concat([PNG, Buffer.from(data)]).toString('base64')}" style="width: 305.00px; height: 400.00px;"></span></p>`;
const logo = () => img('logo-decoratif');
const p = text => `<p class="c1"><span class="c2">${text}</span></p>`;

// Structure de l'export HTML d'un bordereau Google Docs (tableaux, entités, logo répété)
const BORDEREAU = `<html><head><style>.c1{}</style></head><body>
${img('banniere')}${p('Rapport d&rsquo;arrestation')}${logo()}
<table><tr><td>${p('Fait le : 11/11/2026')}${p('Date des faits :11/11/2026')}</td></tr>
<tr><td>${p('Grade: ')}</td><td>${p('Officier IRookie')}</td></tr></table>
${p('Information du suspect')}
${p('NOM Pr&eacute;nom: Miler Jayden')}${p('Date de naissance: 13/12/2003')}${p('Empreinte: &nbsp; xxxxxxx')}
${p('N&deg; s&eacute;cu (ID Unique): 24928')}${p('Num&eacute;ro de t&eacute;l&eacute;phone: (666)423-6164')}
${p('Droit Miranda: lu &agrave; 02H18 par 29')}${p('Objet(s) ill&eacute;gal(ux): &nbsp;')}${p('-Argent x1420')}${p('-Pesos x2750')}${p('-')}
<table><tr><td>${p('Agent R&eacute;dacteur')}${p('(Matricule):')}</td><td>${p('&#12302;&#12303;')}${p('&#12302;29&#12303;')}</td></tr>
<tr><td>${p('Agent pr&eacute;sents ')}${p('(Matricule):')}</td><td>${p('&#12302;&#12303;')}${p('&#12302;29&#12303;&#12302;70&#12303;')}</td></tr>
<tr><td>${p('Chef(s) ')}${p('d&rsquo;accusation(s)')}${p('(sous tirets):')}</td><td><ul><li>x1 Braquage de Sup&eacute;rette</li><li>x2 Conduite sans permis</li><li>x1 Vol de licorne</li></ul></td></tr></table>
${p(' Faits')}${p('Nous avons &eacute;t&eacute; appel&eacute;s sur un braquage de sup&eacute;rette.')}${p('Le suspect a demand&eacute; un appel.')}
${p('Photo(s) appuyant le(s) fait(s)')}
${p('Carte d&rsquo;identit&eacute; : ')}${img('carte')}
${p('Permis de conduire : ')}${logo()}${p('xxx')}
${p('Photo avec v&ecirc;tements: ')}${logo()}<table><tr><td>${p('FACE')}</td><td>${p('DOS')}</td></tr><tr><td>${img('vetu-face')}</td><td>${img('vetu-dos')}</td></tr></table>
${p('Photo sans v&ecirc;tements: ')}<table><tr><td>${p('FACE')}</td><td>${p('DOS')}</td></tr><tr><td>${img('nu-face')}</td><td>${img('nu-dos')}</td></tr>
<tr><td>${p('PROFIL G')}</td><td>${p('PROFIL D')}</td></tr><tr><td>${img('profil-g')}</td><td>${img('profil-d')}</td></tr></table>
${p('Voiture :')}${logo()}${img('voiture-1')}${img('voiture-2')}
${p('Objet saisi : ')}${img('objet')}
${p('Calculatrice: ')}${img('calculatrice')}${logo()}
${p('LOS SANTOS POLICE DEPARTMENT, LOS SANTOS')}
</body></html>`;

test('bordereau : champs, objets, agents, chefs et faits', () => {
  const b = parseBordereau(BORDEREAU);
  assert.equal(b.date_rapport, '2026-11-11');
  assert.equal(b.date_faits, '2026-11-11');
  assert.deepEqual(b.suspect, { nom: 'Miler', prenom: 'Jayden', date_naissance: '2003-12-13', empreinte: '', id_unique: '24928', telephone: '(666)423-6164' });
  assert.equal(b.miranda_heure, '02:18');
  assert.equal(b.miranda_par, '29');
  assert.deepEqual(b.objets_illegaux, [{ description: 'Argent', quantite: '1420' }, { description: 'Pesos', quantite: '2750' }]);
  assert.deepEqual(b.agents_presents, ['29', '70']);
  assert.deepEqual(b.charges, [{ label: 'Braquage de Supérette', quantite: 1 }, { label: 'Conduite sans permis', quantite: 2 }, { label: 'Vol de licorne', quantite: 1 }]);
  assert.equal(b.faits, 'Nous avons été appelés sur un braquage de supérette.\nLe suspect a demandé un appel.');
});

test('bordereau : photos rangées par section, logo répété et calculatrice ignorés', () => {
  const { photos } = parseBordereau(BORDEREAU);
  const label = slot => Buffer.from(photos[slot].data, 'base64').subarray(8).toString();
  assert.deepEqual(Object.keys(photos), ['carte_identite', 'vetu_face', 'vetu_dos', 'nu_face', 'nu_dos', 'profil_g', 'profil_d', 'voiture_1', 'voiture_2', 'objet_1']);
  assert.equal(label('carte_identite'), 'carte');
  assert.equal(label('profil_d'), 'profil-d');
  assert.equal(label('voiture_2'), 'voiture-2');
});

test("bordereau : un document qui n'en est pas un est refusé", () => {
  assert.throws(() => parseBordereau(`<html><body>${p('Liste de courses')}</body></html>`), /bordereau/);
});

test('chefs : retrouvés dans le code pénal sans tenir compte des accents ni de la casse', () => {
  const codes = [{ id: 7, infraction: 'Braquage de supérette' }, { id: 9, infraction: 'Conduite sans permis de conduire' }, { id: 3, infraction: 'Vol' }];
  const { charges, unmatched } = matchCharges([{ label: 'Braquage de Supérette', quantite: 1 }, { label: 'Conduite sans permis', quantite: 2 }, { label: 'Vol de licorne', quantite: 1 }], codes);
  assert.deepEqual(charges, [{ code_id: 7, quantite: 1 }, { code_id: 9, quantite: 2 }]);
  assert.deepEqual(unmatched, ['Vol de licorne']);
});

test('lien : seuls les documents Google Docs sont acceptés', () => {
  assert.equal(docIdFromUrl('https://docs.google.com/document/d/1aRWS7yHfGsjhZx2DtzXqzHDu1LD_2tY5myHG_X_v9-0/edit?usp=sharing'), '1aRWS7yHfGsjhZx2DtzXqzHDu1LD_2tY5myHG_X_v9-0');
  for (const bad of ['http://docs.google.com/document/d/1aRWS7yHfGsjhZx2DtzXqzHDu1LD_2tY5myHG_X_v9-0', 'https://docs.google.com.evil.test/document/d/1aRWS7yHfGsjhZx2DtzXqzHDu1LD_2tY5myHG_X_v9-0',
    'https://evil.test/?https://docs.google.com/document/d/1aRWS7yHfGsjhZx2DtzXqzHDu1LD_2tY5myHG_X_v9-0', 'https://docs.google.com/spreadsheets/d/1aRWS7yHfGsjhZx2DtzXqzHDu1LD_2tY5myHG_X_v9-0', '']) {
    assert.throws(() => docIdFromUrl(bad), /Google Docs/, bad);
  }
});

test('import : brouillon pré-rempli, citoyen retrouvé par son n° sécu, photos enregistrées', async () => {
  const agent = Number(db.prepare(`INSERT INTO users (matricule, role, password_hash) VALUES ('29', 'agent', 'x')`).run().lastInsertRowid);
  const existing = Number(db.prepare(`INSERT INTO citizens (nom, prenom, id_unique) VALUES ('Miler', 'J.', '24928')`).run().lastInsertRowid);
  const braquage = db.prepare(`SELECT id FROM penal_code WHERE infraction LIKE 'Braquage de sup%'`).get();
  let fetched;
  const fakeFetch = async id => { fetched = id; return BORDEREAU; };
  const { id, warnings } = await importBordereau({ id: agent, matricule: '29' }, 'https://docs.google.com/document/d/1aRWS7yHfGsjhZx2DtzXqzHDu1LD_2tY5myHG_X_v9-0/edit', fakeFetch);
  assert.equal(fetched, '1aRWS7yHfGsjhZx2DtzXqzHDu1LD_2tY5myHG_X_v9-0');
  const rep = db.prepare('SELECT * FROM arrest_reports WHERE id = ?').get(id);
  assert.equal(rep.statut, 'brouillon');
  assert.equal(rep.redacteur_id, agent);
  assert.equal(rep.citizen_id, existing, 'fiche existante réutilisée');
  assert.equal(rep.miranda_heure, '02:18');
  assert.deepEqual(JSON.parse(rep.agents_presents), ['29', '70']);
  if (braquage) assert.ok(JSON.parse(rep.calc_input).charges.some(c => c.code_id === braquage.id));
  assert.ok(warnings.some(w => w.includes('Vol de licorne')), 'chef introuvable signalé');
  const photos = JSON.parse(rep.photos);
  assert.equal(Object.keys(photos).length, 10);
  assert.ok(existsSync(path.join(UPLOAD_DIR, path.basename(photos.carte_identite))));
});
