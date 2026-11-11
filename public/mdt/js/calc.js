// Moteur de la calculatrice de peine — reprend les formules de
// « Calculatrice de peine - SASP - SPIRIT.xlsx ». Module pur, partagé
// entre le navigateur et le serveur (qui recalcule à la finalisation).

export const MAX_CHARGES = 16;
export const SEUIL_CONVERSION = 50000; // amende convertible en GAV au-delà
export const DOLLARS_PAR_HEURE = 100000; // 1 h de GAV = 100 000 $
export const SEUILS_ALERTE = { mineur: 5, majeur: 3, crime: 1 };
// Majoration maximale des amendes selon le niveau Defcon (onglet Defcon)
export const MAJORATION_DEFCON = { 5: 1, 4: 1, 3: 1.5, 2: 3, 1: 3 };

const CATEGORIE_CLE = { 'Contravention': 'contravention', 'Délit mineur': 'mineur', 'Délit majeur': 'majeur', 'Crime': 'crime' };

// amende = A × qté × atténuation ÷ (tentative ou complicité ? 2 : 1)
// peine  = P × tentative(0,8) × complicité(0,9) × atténuation(0,8)
export function computeLine(code, { quantite = 1, tentative = false, complicite = false, attenuation = false } = {}) {
  const att = attenuation ? 0.8 : 1;
  const amende = code.amende * (Number(quantite) || 0) * att / (tentative || complicite ? 2 : 1);
  const peine = code.peine_minutes * (tentative ? 0.8 : 1) * (complicite ? 0.9 : 1) * att;
  return { amende, peine };
}

export function cautionCoefficient(nbChefs) {
  if (nbChefs > 10) return 2;
  if (nbChefs > 5) return 1.7;
  if (nbChefs > 0) return 1.3;
  return 0;
}

export function compute(input = {}, getCode) {
  const {
    charges = [], retenue = 'nominal', viceProcedure = false, mineur = false,
    majoration = 1, conversionGav = false, cautionDemandee = false,
  } = input;

  const lignes = [];
  for (const ch of charges) {
    const code = ch.code_id != null && getCode(ch.code_id);
    if (!code) continue;
    if (lignes.length >= MAX_CHARGES) break;
    const opts = { quantite: ch.quantite ?? 1, tentative: !!ch.tentative, complicite: !!ch.complicite, attenuation: !!ch.attenuation };
    lignes.push({ code_id: code.id, infraction: code.infraction, categorie: code.categorie, supplements: code.supplements || '', ...opts, ...computeLine(code, opts) });
  }

  const compteurs = { contravention: 0, mineur: 0, majeur: 0, crime: 0 };
  for (const l of lignes) compteurs[CATEGORIE_CLE[l.categorie]] = (compteurs[CATEGORIE_CLE[l.categorie]] || 0) + 1;
  const alertes = Object.fromEntries(Object.entries(SEUILS_ALERTE).map(([k, seuil]) => [k, compteurs[k] >= seuil]));

  const amendeBase = lignes.reduce((s, l) => s + l.amende, 0);
  const peineBase = lignes.reduce((s, l) => s + l.peine, 0);
  const facteur = (viceProcedure ? 0 : 1) * (retenue === 'max' ? 2 : 1) * (mineur ? 0.5 : 1);

  let amende = Math.round(amendeBase * facteur * (Number(majoration) || 1));
  let peine = peineBase * facteur;

  // La caution se calcule sur l'amende due, avant conversion en GAV
  const nbChefs = lignes.length;
  const coefficient = cautionCoefficient(nbChefs);
  const caution = compteurs.crime > 0
    ? { possible: false, coefficient, montant: 0, raison: 'Pas de caution possible : crime' }
    : { possible: true, coefficient, montant: cautionDemandee ? Math.round(coefficient * amende) : 0, raison: '' };

  const eligible = amende > SEUIL_CONVERSION;
  const conversion = { eligible, appliquee: false, excedent: 0, minutesEnPlus: 0 };
  if (eligible && conversionGav) {
    conversion.appliquee = true;
    conversion.excedent = amende - SEUIL_CONVERSION;
    conversion.minutesEnPlus = conversion.excedent / DOLLARS_PAR_HEURE * 60;
    amende = SEUIL_CONVERSION;
    peine += conversion.minutesEnPlus;
  }

  return {
    lignes, nbChefs, compteurs, alertes,
    alerteProc: Object.values(alertes).some(Boolean),
    amendeBase: Math.round(amendeBase), amende,
    gavMinutes: Math.trunc(peine + 1e-9),
    conversion, caution,
    sanctions: lignes.map(l => l.supplements).filter(Boolean),
  };
}

export const formatDollars = n => Math.round(n).toLocaleString('fr-FR').replace(/ | /g, ' ') + ' $';

export function formatDuree(minutes) {
  const m = Math.trunc(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
}
