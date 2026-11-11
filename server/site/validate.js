import { isUploadUrl } from "./uploads.js";

const CATEGORIES = ["Recrutement", "Opérations", "Communiqué", "Communauté", "Journal"];
const STATUSES = ["pending", "accepted", "refused"];

const str = (v) => (typeof v === "string" ? v.trim() : "");

const slugify = (s) =>
  String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const isIsoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

// Free-text questions of the recruitment form (mirrors the SASP Google Form). min 0 = optional.
// "3 / 5 lignes minimum sur ordinateur" from the original form became 200 / 350 characters.
const APPLICATION_TEXT_FIELDS = {
  fullname: { min: 3, max: 60, label: "Nom et prénom" },
  birth: { min: 2, max: 60, label: "Date de naissance et âge" },
  phone: { min: 2, max: 20, label: "Numéro de téléphone" },
  nationality: { min: 2, max: 40, label: "Nationalité" },
  goal: { min: 3, max: 300, label: "Objectif" },
  availability: { min: 3, max: 300, label: "Disponibilités" },
  traits: { min: 10, max: 600, label: "Qualités et défauts" },
  career: { min: 3, max: 1500, label: "Parcours professionnel" },
  whyYou: { min: 200, max: 3000, label: "Pourquoi vous" },
  motivation: { min: 350, max: 5000, label: "Lettre de motivation" },
  lastWord: { min: 0, max: 600, label: "Dernier mot" },
};

// services: the choices offered on the form, built from the MDT patrol sectors.
const validateApplication = (input = {}, services = []) => {
  const value = {
    discord: str(input.discord).toLowerCase(),
    service: str(input.service),
    record: str(input.record),
    ...Object.fromEntries(Object.keys(APPLICATION_TEXT_FIELDS).map((k) => [k, str(input[k])])),
  };
  const errors = {};
  if (!/^[a-z0-9_.]{2,32}$/.test(value.discord)) errors.discord = "Pseudo Discord invalide : minuscules, chiffres, « _ » et « . ».";
  if (!services.includes(value.service)) errors.service = "Choisissez un service.";
  if (value.record && !["Oui", "Non"].includes(value.record)) errors.record = "Réponse invalide.";
  for (const [key, { min, max }] of Object.entries(APPLICATION_TEXT_FIELDS)) {
    const len = value[key].length;
    if (min && !len) errors[key] = "Ce champ est requis.";
    else if (len < min) errors[key] = `Encore ${min - len} caractères minimum.`;
    else if (len > max) errors[key] = `${max} caractères maximum.`;
  }
  return { errors, value };
};

// Article content is a list of typed blocks, never raw HTML: the server escapes everything when rendering.
// "section" opens a rubrique in a Journal edition (server/site/app.js).
const BLOCK_TYPES = ["p", "h2", "quote", "list", "image", "section"];

const normalizeBlock = (b = {}) => {
  const type = str(b.type);
  if (type === "image") return { type, image: str(b.image), alt: str(b.alt), caption: str(b.caption) };
  if (type === "list") return { type, items: (Array.isArray(b.items) ? b.items : []).map(str).filter(Boolean) };
  return { type, text: str(b.text) };
};
const isEmptyBlock = (b) => (b.type === "image" ? !b.image : b.type === "list" ? !b.items.length : !b.text);

// Plain-text version, used for the length check and anywhere a summary of the content is needed.
const blocksToText = (blocks) =>
  blocks.map((b) => (b.type === "list" ? b.items.join("\n") : b.type === "image" ? b.caption : b.text)).filter(Boolean).join("\n\n");

// Old articles stored plain text: one paragraph block per blank-line-separated chunk.
const textToBlocks = (text) => String(text || "").split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean).map((t) => ({ type: "p", text: t }));

const blockError = (b) => {
  if (!BLOCK_TYPES.includes(b.type)) return "Type de bloc inconnu.";
  if (b.type === "image") {
    if (!isUploadUrl(b.image, "public")) return "Une photo du contenu est invalide : envoyez-la à nouveau.";
    if (b.alt.length < 3 || b.alt.length > 150) return "Chaque photo du contenu a besoin d'une description (3 à 150 caractères).";
    if (b.caption.length > 200) return "Légende de photo : 200 caractères maximum.";
    return null;
  }
  if (b.type === "section") return b.text.length > 60 ? "Nom de rubrique : 60 caractères maximum." : null;
  if (b.type === "list") return b.items.length > 50 || b.items.some((i) => i.length > 500) ? "Liste trop longue." : null;
  return b.text.length > 5000 ? "Un bloc dépasse 5000 caractères." : null;
};

// Journal masthead and closing line: all written by the editor, all optional (an empty text is not shown).
const MASTHEAD = { kicker: 80, name: 40, slogan: 80, edition: 40, motto: 80, footer: 120 };

const validateNews = (input = {}) => {
  const blocks = Array.isArray(input.blocks)
    ? input.blocks.slice(0, 201).map(normalizeBlock).filter((b) => !isEmptyBlock(b))
    : textToBlocks(input.body);
  const value = {
    title: str(input.title),
    category: str(input.category),
    date: str(input.date),
    excerpt: str(input.excerpt),
    blocks,
    body: blocksToText(blocks),
    published: input.published === true,
    image: str(input.image) || null,
    imageAlt: str(input.imageAlt),
  };
  value.masthead = value.category === "Journal" ? Object.fromEntries(Object.keys(MASTHEAD).map((k) => [k, str(input.masthead?.[k])])) : null;
  const errors = {};
  if (value.masthead && Object.entries(MASTHEAD).some(([k, max]) => value.masthead[k].length > max)) errors.masthead = "En-tête du journal : un texte est trop long.";
  if (blocks.length > 200) errors.body = "200 blocs maximum.";
  const badBlock = blocks.map(blockError).find(Boolean);
  if (badBlock) errors.body = badBlock;
  // Only photos uploaded to this server (public space) are accepted, and they need a description.
  if (value.image && !isUploadUrl(value.image, "public")) errors.image = "Photo invalide : envoyez-la à nouveau.";
  if (value.image && (value.imageAlt.length < 3 || value.imageAlt.length > 150)) errors.imageAlt = "Décrivez la photo en quelques mots (3 à 150 caractères).";
  if (!value.image) value.imageAlt = "";
  if (value.title.length < 3 || value.title.length > 120) errors.title = "Titre entre 3 et 120 caractères.";
  if (!CATEGORIES.includes(value.category)) errors.category = "Catégorie inconnue.";
  if (!isIsoDate(value.date)) errors.date = "Date invalide.";
  if (value.excerpt.length < 10 || value.excerpt.length > 300) errors.excerpt = "Résumé entre 10 et 300 caractères.";
  if (!errors.body && (value.body.length < 20 || value.body.length > 20000)) errors.body = "Contenu entre 20 et 20 000 caractères.";
  if (!slugify(value.title)) errors.title = "Le titre doit contenir des lettres ou des chiffres.";
  return { errors, value };
};

const TICKET_CATEGORIES = ["Rendez-vous", "Signalement", "Question", "Autre"];
const APPOINTMENT_SLOTS = ["Matin", "Après-midi", "Soir"];
const APPOINTMENT_MAX_DAYS = 60;
const MATRICULE = /^[A-Za-z0-9-]{1,20}$/;

const validateBody = (body, errors, min = 1) => {
  if (body.length < min) errors.body = min > 1 ? `Encore ${min - body.length} caractères minimum.` : "Le message est vide.";
  else if (body.length > 4000) errors.body = "4000 caractères maximum.";
};

const validateTicket = (input = {}) => {
  const value = {
    category: str(input.category),
    name: str(input.name),
    contact: str(input.contact),
    subject: str(input.subject),
    body: str(input.body),
  };
  const errors = {};
  if (!TICKET_CATEGORIES.includes(value.category)) errors.category = "Choisissez le type de demande.";
  if (value.name.length < 2 || value.name.length > 60) errors.name = "Indiquez vos nom et prénom (60 caractères max).";
  if (value.contact.length > 60) errors.contact = "60 caractères maximum.";
  if (value.subject.length < 3 || value.subject.length > 120) errors.subject = "Objet entre 3 et 120 caractères.";
  validateBody(value.body, errors, 20);

  // Appointment requests carry a preferred date (today to +60 days) and time slot; an agent confirms by replying.
  value.appointment = null;
  if (value.category === "Rendez-vous") {
    const date = str(input.appointmentDate);
    const slot = str(input.appointmentSlot);
    const today = new Date().toISOString().slice(0, 10);
    const last = new Date(Date.now() + APPOINTMENT_MAX_DAYS * 86400000).toISOString().slice(0, 10);
    if (!isIsoDate(date)) errors.appointmentDate = "Choisissez une date.";
    else if (date < today) errors.appointmentDate = "Cette date est déjà passée.";
    else if (date > last) errors.appointmentDate = `Choisissez une date dans les ${APPOINTMENT_MAX_DAYS} prochains jours.`;
    if (!APPOINTMENT_SLOTS.includes(slot)) errors.appointmentSlot = "Choisissez un créneau.";
    value.appointment = { date, slot };
  }
  return { errors, value };
};

const validateMessage = (input = {}) => {
  const value = { body: str(input.body) };
  const errors = {};
  validateBody(value.body, errors);
  return { errors, value };
};

const validateInternal = (input = {}) => {
  const to = [...new Set((Array.isArray(input.to) ? input.to : []).map(str).filter(Boolean))];
  const value = { to, subject: str(input.subject), body: str(input.body) };
  const errors = {};
  if (!to.length || to.length > 10 || !to.every((m) => MATRICULE.test(m))) errors.to = "Indiquez 1 à 10 matricules valides.";
  if (value.subject.length < 3 || value.subject.length > 120) errors.subject = "Objet entre 3 et 120 caractères.";
  validateBody(value.body, errors);
  return { errors, value };
};

const PRIORITIES = ["basse", "normale", "haute"];

const validateAnnouncement = (input = {}) => {
  const value = { title: str(input.title), body: str(input.body), pinned: input.pinned === true, image: str(input.image) || null };
  const errors = {};
  if (value.title.length < 3 || value.title.length > 120) errors.title = "Titre entre 3 et 120 caractères.";
  if (value.image && !isUploadUrl(value.image, "internal")) errors.image = "Photo invalide : envoyez-la à nouveau.";
  validateBody(value.body, errors);
  return { errors, value };
};

export {
  APPLICATION_TEXT_FIELDS, CATEGORIES, STATUSES, TICKET_CATEGORIES, APPOINTMENT_SLOTS, MATRICULE, PRIORITIES,
  slugify, textToBlocks, validateApplication, validateNews, validateTicket, validateMessage, validateInternal, validateAnnouncement,
};
