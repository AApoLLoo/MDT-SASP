import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compute, computeLine, cautionCoefficient } from '../public/mdt/js/calc.js';

const CODES = {
  superette: { id: 1, infraction: 'Braquage de Supérette', categorie: 'Délit mineur', amende: 3250, peine_minutes: 20, supplements: 'Saisie armes / argent' },
  munition: { id: 2, infraction: 'Possession ILLEGALE de Munition de pistolet', categorie: 'Délit mineur', amende: 100, peine_minutes: 10, supplements: 'X PAR munitions' },
  meurtre: { id: 3, infraction: 'Meurtre', categorie: 'Crime', amende: 200000, peine_minutes: 60, supplements: 'Retrait PPA' },
  armeA: { id: 4, infraction: "Possession d'ARME DE CATEGORIE A", categorie: 'Délit majeur', amende: 50000, peine_minutes: 25, supplements: '' },
  feu: { id: 5, infraction: 'Non respect d\'un feu rouge', categorie: 'Contravention', amende: 500, peine_minutes: 0, supplements: '' },
};
const byId = new Map(Object.values(CODES).map(c => [c.id, c]));
const getCode = id => byId.get(id);
const charge = (code, opts = {}) => ({ code_id: code.id, quantite: 1, ...opts });

test('tentative : amende divisée par 2, peine ×0,8', () => {
  assert.deepEqual(computeLine(CODES.superette, { tentative: true }), { amende: 1625, peine: 16 });
});

test('complicité : amende divisée par 2, peine ×0,9', () => {
  assert.deepEqual(computeLine(CODES.superette, { complicite: true }), { amende: 1625, peine: 18 });
});

test('tentative + complicité : amende divisée une seule fois, peine ×0,72', () => {
  const r = computeLine(CODES.superette, { tentative: true, complicite: true });
  assert.equal(r.amende, 1625);
  assert.ok(Math.abs(r.peine - 14.4) < 1e-9);
  assert.equal(compute({ charges: [charge(CODES.superette, { tentative: true, complicite: true })] }, getCode).gavMinutes, 14);
});

test('atténuation : ×0,8 sur amende et peine', () => {
  assert.deepEqual(computeLine(CODES.superette, { attenuation: true }), { amende: 2600, peine: 16 });
});

test('quantité : multiplie l\'amende mais pas la peine', () => {
  assert.deepEqual(computeLine(CODES.munition, { quantite: 30 }), { amende: 3000, peine: 10 });
});

test('totaux nominaux et sanctions', () => {
  const r = compute({ charges: [charge(CODES.superette), charge(CODES.munition, { quantite: 30 })] }, getCode);
  assert.equal(r.nbChefs, 2);
  assert.equal(r.amende, 6250);
  assert.equal(r.gavMinutes, 30);
  assert.deepEqual(r.sanctions, ['Saisie armes / argent', 'X PAR munitions']);
  assert.equal(r.lignes[1].amende, 3000);
});

test('retenue MAX double amende et peine', () => {
  const r = compute({ charges: [charge(CODES.superette)], retenue: 'max' }, getCode);
  assert.equal(r.amende, 6500);
  assert.equal(r.gavMinutes, 40);
});

test('prévenu mineur divise par 2', () => {
  const r = compute({ charges: [charge(CODES.superette)], mineur: true }, getCode);
  assert.equal(r.amende, 1625);
  assert.equal(r.gavMinutes, 10);
});

test('vice de procédure annule tout', () => {
  const r = compute({ charges: [charge(CODES.superette)], retenue: 'max', viceProcedure: true }, getCode);
  assert.equal(r.amende, 0);
  assert.equal(r.gavMinutes, 0);
  assert.equal(r.caution.montant, 0);
});

test('majoration Defcon ne s\'applique qu\'à l\'amende', () => {
  const r = compute({ charges: [charge(CODES.superette)], majoration: 1.5 }, getCode);
  assert.equal(r.amende, 4875);
  assert.equal(r.gavMinutes, 20);
});

test('crime : alerte Proc/Juge et caution impossible', () => {
  const r = compute({ charges: [charge(CODES.meurtre)], cautionDemandee: true }, getCode);
  assert.equal(r.compteurs.crime, 1);
  assert.equal(r.alertes.crime, true);
  assert.equal(r.alerteProc, true);
  assert.equal(r.caution.possible, false);
  assert.equal(r.caution.montant, 0);
});

test('seuils d\'alerte : 5 délits mineurs, 3 délits majeurs', () => {
  const quatre = compute({ charges: Array(4).fill(charge(CODES.superette)) }, getCode);
  assert.equal(quatre.alerteProc, false);
  const cinq = compute({ charges: Array(5).fill(charge(CODES.superette)) }, getCode);
  assert.equal(cinq.alertes.mineur, true);
  assert.equal(cinq.alerteProc, true);
  const majeurs = compute({ charges: Array(3).fill(charge(CODES.armeA)) }, getCode);
  assert.equal(majeurs.alertes.majeur, true);
});

test('coefficient de caution selon le nombre de chefs', () => {
  assert.equal(cautionCoefficient(0), 0);
  assert.equal(cautionCoefficient(1), 1.3);
  assert.equal(cautionCoefficient(5), 1.3);
  assert.equal(cautionCoefficient(6), 1.7);
  assert.equal(cautionCoefficient(10), 1.7);
  assert.equal(cautionCoefficient(11), 2);
  const r = compute({ charges: Array(6).fill(charge(CODES.feu)), cautionDemandee: true }, getCode);
  assert.equal(r.caution.coefficient, 1.7);
  assert.equal(r.caution.montant, 5100);
});

test('caution non demandée : montant nul', () => {
  const r = compute({ charges: [charge(CODES.superette)] }, getCode);
  assert.equal(r.caution.possible, true);
  assert.equal(r.caution.montant, 0);
});

test('conversion amende → GAV au-delà de 50 000 $', () => {
  const sans = compute({ charges: [charge(CODES.armeA), charge(CODES.armeA), charge(CODES.armeA, { quantite: 1 })] }, getCode);
  assert.equal(sans.amende, 150000);
  assert.equal(sans.conversion.eligible, true);
  assert.equal(sans.conversion.appliquee, false);
  const avec = compute({ charges: Array(3).fill(charge(CODES.armeA)), conversionGav: true }, getCode);
  assert.equal(avec.amende, 50000);
  assert.equal(avec.conversion.excedent, 100000);
  assert.equal(avec.conversion.minutesEnPlus, 60);
  assert.equal(avec.gavMinutes, 75 + 60);
});

test('conversion ignorée sous 50 000 $', () => {
  const r = compute({ charges: [charge(CODES.superette)], conversionGav: true }, getCode);
  assert.equal(r.conversion.eligible, false);
  assert.equal(r.amende, 3250);
});

test('chefs vides ou inconnus ignorés, maximum 16 chefs', () => {
  const r = compute({ charges: [{ code_id: null }, { code_id: 999 }, ...Array(20).fill(charge(CODES.feu))] }, getCode);
  assert.equal(r.nbChefs, 16);
});

test('le Code pénal importé contient les valeurs de l\'Excel', () => {
  const seed = JSON.parse(readFileSync(new URL('../server/seed/penal-code.json', import.meta.url)));
  const superette = seed.find(c => c.infraction === 'Braquage de Supérette');
  assert.equal(superette.amende, 3250);
  assert.equal(superette.peine_minutes, 20);
  assert.equal(superette.categorie, 'Délit mineur');
  assert.equal(seed.find(c => c.infraction === 'Meurtre').categorie, 'Crime');
});
