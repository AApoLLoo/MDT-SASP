import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createStore } from "./store.js";
import { CATEGORIES, STATUSES, MATRICULE, slugify, textToBlocks, validateApplication, validateNews } from "./validate.js";
import {
  esc, httpError, sameSecret, parseCookies, createLimiter, createSessions,
  readJson, send, sendJson, cookie, throwIfInvalid,
} from "./http.js";
import { field, postEmbed } from "./discord.js";
import { createMessaging } from "./messaging.js";
import { createUploads } from "./uploads.js";

const ROOT = path.join(import.meta.dirname, "..", "..");
const PUBLIC = path.join(ROOT, "public");
const VIEWS = path.join(ROOT, "views");
const SESSION_TTL = 8 * 60 * 60 * 1000;
const RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
// Changes on every start, so browsers fetch fresh CSS/JS after an update instead of running a stale cached copy.
const ASSET_VERSION = Date.now().toString(36);
const ADMIN_COOKIE = "sasp_session";

const MIME = {
  ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2",
};

const ARROW = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

const fmtDate = (iso) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const byDateDesc = (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);

// --- HTML fragments

const tag = (cat) => `<span class="tag tag--${slugify(cat)}">${esc(cat)}</span>`;

const newsCard = (post, featured) => `
  <a class="post${featured ? " post--featured" : ""}${post.image ? " post--photo" : ""}" href="/actualites/${esc(post.slug)}" data-cat="${esc(post.category)}">
    ${post.image ? `<img class="post__img" src="${esc(post.image)}" alt="${esc(post.imageAlt)}" loading="lazy" decoding="async">` : ""}
    <span class="post__meta">${tag(post.category)}${esc(fmtDate(post.date))}</span>
    <h3>${esc(post.title)}</h3>
    <p>${esc(post.excerpt)}</p>
    <span class="post__more">Lire l'article ${ARROW}</span>
  </a>`;

const newsGrid = (posts) =>
  posts.length
    ? posts.map((p, i) => newsCard(p, i === 0)).join("")
    : '<p class="news__empty">Aucune actualité publiée pour le moment.</p>';

const filterChips = (posts) =>
  ["Tout", ...CATEGORIES.filter((c) => posts.some((p) => p.category === c))]
    .map((c, i) => `<button type="button" class="chip" aria-pressed="${i === 0}" data-filter="${esc(c)}">${esc(c)}</button>`)
    .join("");

// Home "newsroom": one lead story with image, then a ruled list of headlines.
const leadStory = (post) =>
  post
    ? `<a class="story" href="/actualites/${esc(post.slug)}">
        ${post.image
          ? `<img class="story__img" src="${esc(post.image)}" alt="${esc(post.imageAlt)}" loading="lazy" decoding="async">`
          : '<img class="story__img" src="/img/institution.webp" alt="" width="1670" height="942" loading="lazy" decoding="async">'}
        <span class="story__body">
          <span class="post__meta">${tag(post.category)}<time>${esc(fmtDate(post.date))}</time></span>
          <span class="story__title">${esc(post.title)}</span>
          <span class="story__excerpt">${esc(post.excerpt)}</span>
        </span>
      </a>`
    : '<p class="news__empty">Aucun communiqué publié pour le moment.</p>';

const headlines = (posts) =>
  posts.map((p) => `
    <li><a class="headline" href="/actualites/${esc(p.slug)}">
      <span class="post__meta">${tag(p.category)}<time>${esc(fmtDate(p.date))}</time></span>
      <span class="headline__title">${esc(p.title)}</span>
    </a></li>`).join("");

// Divisions and patrol sectors come from the MDT (Administration → Paramètres). Only the public description lives here:
// a division renamed or added in the MDT shows up without one until it is written below.
const DIVISION_TEXT = {
  "Patrouille": "Présence quotidienne sur les routes et dans les communes de l'État : prévention, contrôles routiers et première réponse aux appels.",
  "S.W.A.T.": "Interventions à haut risque : individus armés retranchés, prises d'otages, arrestations sensibles et appui des patrouilles sur les opérations dangereuses.",
  "Basic Criminal Investigations": "Enquêtes criminelles : constatations, recueil des preuves, auditions et suivi des dossiers jusqu'à leur transmission à la justice.",
  "Formateur SASPA": "Formation des nouvelles recrues à la San Andreas State Police Academy : procédures, conduite d'intervention, usage du MDT, puis encadrement de la probation sur le terrain.",
};
const divisionList = (divisions) =>
  divisions.map((d) => `<div><dt>${esc(d)}</dt>${DIVISION_TEXT[d] ? `<dd>${esc(DIVISION_TEXT[d])}</dd>` : ""}</div>`).join("");

// /service: grades come from the MDT, in its order. Public text follows the manual (chapter II); a grade added
// or renamed in the MDT shows without one until it is written below.
const GRADE_TEXT = {
  "Rookie": "Apprentissage du métier : patrouilles accompagnées et programme de formation, suivi par un tuteur de l'Academy.",
  "Officier I": "Premier grade d'officier : patrouille, contrôles routiers et rapports, en poursuivant l'apprentissage.",
  "Officier II": "Perfectionnement sur le terrain et développement des formations.",
  "Officier III": "Officier expérimenté, qui complète ses formations et peut viser une division spécialisée.",
  "Senior Lead Officer": "Soutien des officiers I à III sur le terrain, conseil et écoute active.",
  "Sergent": "Encadrement des équipes, supervision du terrain et maintien de la discipline.",
  "Sergent-Chef": "Sergent confirmé : encadre les équipes et les sergents, et veille à la discipline du service.",
  "Lieutenant": "Coordination des équipes et gestion des opérations.",
  "Lieutenant-Chef": "Coordination des équipes, gestion des opérations et supervision générale.",
  "Capitaine": "Seconde supervision générale : gestion des unités et appui stratégique.",
  "Commandant": "Supervision générale, prise de décision et gestion globale des opérations.",
  "Chief": "Direction de l'ensemble du département.",
};
// First grade of each tier
const GRADE_TIERS = { "Rookie": "Officiers", "Sergent": "Encadrement", "Capitaine": "Commandement" };

const gradeLadder = (grades) => {
  const tiers = [];
  grades.forEach((g, i) => {
    if (!tiers.length || GRADE_TIERS[g]) tiers.push({ name: GRADE_TIERS[g] || "Officiers", grades: [] });
    tiers.at(-1).grades.push([i + 1, g]);
  });
  return tiers.map((t) => `
    <div class="rank-tier"><h3>${esc(t.name)}</h3><ol class="ranks">${t.grades.map(([n, g]) =>
      `<li><span class="ranks__n">${n}</span><strong>${esc(g)}</strong>${GRADE_TEXT[g] ? `<span>${esc(GRADE_TEXT[g])}</span>` : ""}</li>`).join("")}</ol></div>`).join("");
};

const plural = (n, word) => `${n} ${word}${n > 1 ? "s" : ""}`;
const serviceFacts = ({ grades, divisions, postes, secteurs }) => [
  grades.length && [plural(grades.length, "grade"), `de ${grades[0]} à ${grades.at(-1)}`],
  divisions.length && [plural(divisions.length, "division"), divisions.join(", ")],
  postes.length && [plural(postes.length, "poste"), postes.join(", ")],
  secteurs.length && [plural(secteurs.length, "secteur"), `de patrouille : ${secteurs.join(", ")}`],
].filter(Boolean).map(([n, detail]) => `<li><strong>${esc(n)}</strong>${esc(detail)}</li>`).join("");

// /service : les formations ne sont pas publiées une à une (noms et codes internes restent dans le MDT),
// seulement leur nombre et les domaines du catalogue de l'Academy (catégories de `catalogue`, service-kinds.js)
const FORMATION_DOMAINS = [
  ["Fondamentaux", "Procédures, cadre légal et outils du service, dès la Police Academy."],
  ["Armement", "Maniement des armes de service et des moyens de force intermédiaire."],
  ["Conduite", "Conduite d'intervention et poursuites, en sécurité pour tous."],
  ["Intervention", "Coordination des unités sur le terrain et gestion des situations à risque."],
  ["Communication", "Relation avec les citoyens, échanges radio et désescalade."],
  ["Spécialisation", "Formations d'accès aux divisions et aux fonctions d'encadrement."],
];
const formationDomains = () =>
  FORMATION_DOMAINS.map(([nom, texte]) => `<div><dt>${esc(nom)}</dt><dd>${esc(texte)}</dd></div>`).join("");
const formationsCount = (n) => (n ? `${plural(n, "formation")} au catalogue, réparties en ${FORMATION_DOMAINS.length} domaines.` : "");

const servicesOf = (config) => [...config.mdtList("secteurs").map((s) => `SASP ${s}`), "Peu importe"];
const serviceChoices = (services) =>
  services.map((s, i) => `<label class="choice"><input type="radio" name="service" value="${esc(s)}"${i ? "" : " required"}><span>${esc(s)}</span></label>`).join("");

// Inline formatting, applied AFTER escaping: **bold** and [label](https://url). Escaping first means
// the text can never inject markup, and the URL pattern only accepts http(s) without quotes or spaces.
const inline = (text) =>
  esc(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noopener nofollow" target="_blank">$1</a>')
    .replace(/\n/g, "<br>");

const renderBlock = (b) => {
  switch (b.type) {
    case "h2": case "section": return `<h2>${inline(b.text)}</h2>`;
    case "quote": return `<blockquote><p>${inline(b.text)}</p></blockquote>`;
    case "list": return `<ul>${b.items.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`;
    case "image":
      return `<figure class="article__inline-figure"><img src="${esc(b.image)}" alt="${esc(b.alt)}" loading="lazy" decoding="async">${b.caption ? `<figcaption>${inline(b.caption)}</figcaption>` : ""}</figure>`;
    default: return `<p>${inline(b.text)}</p>`;
  }
};
const blocksOf = (post) => post.blocks || textToBlocks(post.body);
const renderBlocks = (post) => blocksOf(post).map(renderBlock).join("");
// "Journal" news render as a SASP TIP edition: each "section" block opens a rubrique, filled by the blocks that follow.
// Inside a rubrique the intertitle is its headline, photos sit beside the text and a quote is its closing banner.
const rubriquesOf = (blocks) => {
  const list = [];
  for (const b of blocks) {
    if (b.type === "section" || !list.length) list.push({ label: b.type === "section" ? b.text : "", blocks: [] });
    if (b.type !== "section") list.at(-1).blocks.push(b);
  }
  return list;
};
const rubrique = ({ label, blocks }) => {
  const photos = blocks.filter((b) => b.type === "image");
  const text = blocks.filter((b) => b.type !== "image").map((b) =>
    b.type === "h2" ? `<h3 class="rubrique__title">${inline(b.text)}</h3>`
    : b.type === "quote" ? `<p class="rubrique__tagline">${inline(b.text)}</p>`
    : renderBlock(b)).join("");
  return `<section class="rubrique${photos.length ? " rubrique--photo" : ""}">
    ${label ? `<h2 class="rubrique__label">${esc(label)}</h2>` : ""}
    <div class="rubrique__body"><div class="rubrique__text">${text}</div>${photos.length ? `<div class="rubrique__photos">${photos.map(renderBlock).join("")}</div>` : ""}</div>
  </section>`;
};
// Masthead texts of an edition, each left out when empty
const mastheadOf = (post) => {
  const m = post.masthead || {};
  const line = (cls, text, tag = "p") => (text ? `<${tag} class="${cls}">${esc(text).replace(/\n/g, "<br>")}</${tag}>` : "");
  return {
    kicker: line("edition__kicker", m.kicker), name: line("edition__title", m.name), slogan: line("edition__slogan", m.slogan),
    motto: line("edition__motto", m.motto), edition: line("edition__number", m.edition, "span"),
    foot: m.footer ? `<footer class="edition__foot"><p>${esc(m.footer)}</p><img src="/img/logo-128.webp" alt="" decoding="async"></footer>` : "",
  };
};
// Police du journal (Oswald, licence OFL) hébergée sur le site : aucune requête vers Google Fonts
const EDITION_FONT = '<link rel="preload" href="/fonts/oswald-latin.woff2" as="font" type="font/woff2" crossorigin>';

// Every uploaded photo a news item uses: cover + photos inside the content.
const photosOf = (post) => [post.image, ...blocksOf(post).filter((b) => b.type === "image").map((b) => b.image)].filter(Boolean);

// --- App

const createHandler = (config) => {
  const store = createStore(config.dataDir);
  const adminSessions = createSessions(SESSION_TTL);
  const agentSessions = createSessions(SESSION_TTL);
  const limiters = {
    adminLogin: createLimiter(5, 15 * 60 * 1000),
    agentLogin: createLimiter(5, 15 * 60 * 1000),
    apply: createLimiter(3, 60 * 60 * 1000),
    ticket: createLimiter(3, 60 * 60 * 1000),
    lookup: createLimiter(30, 15 * 60 * 1000),
  };
  const viewCache = new Map();

  const clientIp = (req) =>
    (config.trustProxy && String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()) || req.socket.remoteAddress;

  const uploads = createUploads(config.dataDir);
  const messaging = createMessaging({ store, auth: config.auth, sessions: agentSessions, limiters, config, clientIp, uploads });

  const sweeper = setInterval(() => {
    Object.values(limiters).forEach((l) => l.sweep());
    adminSessions.sweep();
    agentSessions.sweep();
  }, 10 * 60 * 1000);
  sweeper.unref();

  // Retention promised on /mentions-legales: decided applications are deleted 6 months after the decision.
  const purgeOldApplications = () =>
    store.update("applications", (list) => {
      const cutoff = Date.now() - RETENTION_MS;
      const keep = list.filter((a) => a.status === "pending" || Date.parse(a.decidedAt) > cutoff);
      list.splice(0, list.length, ...keep);
    }).catch((err) => console.error("[purge]", err.message));
  const purgeOrphanPhotos = async () => {
    try {
      const [news, notes] = await Promise.all([store.read("news"), store.read("announcements")]);
      await uploads.purgeOrphans([...news.flatMap(photosOf), ...notes.map((x) => x.image)]);
    } catch (err) {
      console.error("[purge photos]", err.message);
    }
  };
  const purgeAll = () => { purgeOldApplications(); messaging.purge(); purgeOrphanPhotos(); };
  purgeAll();
  setInterval(purgeAll, 24 * 60 * 60 * 1000).unref();

  const view = (name) => {
    if (!viewCache.has(name)) {
      const p = fs.readFile(path.join(VIEWS, `${name}.html`), "utf8");
      p.catch(() => viewCache.delete(name));
      viewCache.set(name, p);
    }
    return viewCache.get(name);
  };

  // {{x}} is escaped, {{{x}}} is trusted HTML built by this file.
  const render = async (name, vars = {}) => {
    const all = { mdtUrl: config.mdtUrl, year: new Date().getFullYear(), description: "", bodyClass: "", v: ASSET_VERSION, ...vars };
    const html = (await view(name))
      .replace("{{> header}}", await view("partials/header"))
      .replace("{{> footer}}", await view("partials/footer"));
    return html.replace(/\{\{\{(\w+)\}\}\}|\{\{(\w+)\}\}/g, (_, raw, safe) => (raw ? String(all[raw] ?? "") : esc(all[safe] ?? "")));
  };

  const sendPage = async (res, status, name, vars, headers) =>
    send(res, status, await render(name, vars), { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", ...headers });

  const publishedNews = async () => (await store.read("news")).filter((n) => n.published).sort(byDateDesc);

  // Admin access and what it covers. Each /api/admin/<scope>/... route requires its scope.
  //   shared SITE_ADMIN_PASSWORD or MDT supervisor/admin -> everything; agent granted PR -> news only.
  const ALL_SCOPES = ["applications", "news", "permissions"];
  const adminAccess = async (req) => {
    if (adminSessions.get(parseCookies(req.headers.cookie)[ADMIN_COOKIE])) return { via: "password", scopes: ALL_SCOPES, officer: null };
    const officer = messaging.officerFrom(req);
    if (!officer) return null;
    if (officer.command) return { via: "agent", scopes: ALL_SCOPES, officer };
    if (await messaging.isPr(officer)) return { via: "agent", scopes: ["news"], officer };
    return null;
  };

  // --- Pages

  const PRIVATE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
  const pages = {
    "/": async (res) => {
      const [latest, ...others] = (await publishedNews()).slice(0, 5);
      return sendPage(res, 200, "index", {
        title: "SASP — San Andreas State Police",
        description: "San Andreas State Police : contacter la police, suivre une demande, actualités et recrutement.",
        bodyClass: "home", leadStory: leadStory(latest), headlines: headlines(others),
        divisions: divisionList(config.mdtList("divisions")), serviceChoices: serviceChoices(servicesOf(config)),
        notice: latest
          ? `<a class="hero__notice" href="/actualites/${esc(latest.slug)}"><strong>Dernier communiqué</strong><span>${esc(latest.title)}</span></a>`
          : "",
      });
    },
    "/actualites": async (res) => {
      const news = await publishedNews();
      return sendPage(res, 200, "actualites", {
        title: "Actualités — SASP", description: "Communiqués, opérations et vie du service de la SASP.",
        news: newsGrid(news), filters: filterChips(news),
      });
    },
    "/service": (res) => {
      // Les grades internes des divisions (S.W.A.T., BCI) restent dans le MDT, ils ne sont pas publiés
      const [grades, divisions, postes, secteurs, qualifications] =
        ["grades", "divisions", "postes", "secteurs", "qualifications"].map(config.mdtList);
      return sendPage(res, 200, "service", {
        title: "Le service — SASP",
        description: "Mission, grades, divisions, formations et perspectives de carrière à la San Andreas State Police.",
        facts: serviceFacts({ grades, divisions, postes, secteurs }), grades: gradeLadder(grades),
        divisions: divisionList(divisions), formations: formationDomains(), formationsCount: formationsCount(qualifications.length),
      });
    },
    "/contact": (res) => sendPage(res, 200, "contact", { title: "Contacter la SASP", description: "Prendre rendez-vous, faire un signalement ou poser une question à la SASP.", bodyClass: "page-contact" }),
    "/suivi": (res) => sendPage(res, 200, "suivi", { title: "Suivre ma demande — SASP", description: "Consultez la réponse de la SASP avec votre code de suivi." }),
    "/mentions-legales": (res) => sendPage(res, 200, "mentions-legales", { title: "Mentions légales & confidentialité — SASP" }),
    "/agent": (res) => sendPage(res, 200, "agent", {}, PRIVATE),
    "/admin": (res) => sendPage(res, 200, "admin", {}, PRIVATE),
    // Full-page news editor. The page itself is public HTML; every API call it makes checks the "news" scope.
    "/admin/actualites/editer": (res) => sendPage(res, 200, "news-editor", {}, PRIVATE),
  };

  const renderArticle = (res, post, extra = {}) => {
    const journal = post.category === "Journal";
    // Discord/social previews need an absolute URL
    const { headExtra = post.image && config.siteUrl ? `<meta property="og:image" content="${esc(config.siteUrl.replace(/\/$/, "") + post.image)}">` : "", ...rest } = extra;
    return sendPage(res, 200, journal ? "edition" : "article", {
      title: `${post.title} — SASP`, description: post.excerpt, postTitle: post.title,
      tag: tag(post.category), date: fmtDate(post.date), banner: "",
      body: journal ? rubriquesOf(blocksOf(post)).map(rubrique).join("") : renderBlocks(post),
      ...(journal ? mastheadOf(post) : {}),
      figure: post.image
        ? `<figure class="article__figure"><img src="${esc(post.image)}" alt="${esc(post.imageAlt)}" decoding="async"></figure>`
        : "",
      headExtra: (journal ? EDITION_FONT : "") + headExtra,
      ...rest,
    });
  };

  const articlePage = async (res, slug) => {
    const post = (await publishedNews()).find((n) => n.slug === slug);
    return post ? renderArticle(res, post) : null;
  };

  // Exact public rendering of any news item, drafts included, for people allowed to edit news.
  const previewPage = async (req, res, id) => {
    const access = await adminAccess(req);
    const post = access?.scopes.includes("news") && (await store.read("news")).find((n) => n.id === id);
    if (!post) return null;
    return renderArticle(res, post, {
      headExtra: '<meta name="robots" content="noindex">',
      banner: `<div class="preview-banner" role="note"><div class="wrap"><strong>Aperçu${post.published ? "" : " — brouillon non publié"}</strong><a href="/admin/actualites/editer?id=${esc(post.id)}">Retour à l'éditeur</a></div></div>`,
    });
  };

  // Templates reference assets as /file.js?v={{v}}: those URLs change on every restart, so they can be cached for good.
  const serveStatic = async (res, pathname, versioned) => {
    if (pathname.includes("\0")) return null;
    const filePath = path.join(PUBLIC, path.normalize(pathname));
    if (!filePath.startsWith(PUBLIC + path.sep)) return null;
    try {
      const data = await fs.readFile(filePath);
      const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
      return send(res, 200, data, { "Content-Type": type, "Cache-Control": versioned ? "public, max-age=31536000, immutable" : "public, max-age=300" });
    } catch (err) {
      if (err.code === "ENOENT" || err.code === "EISDIR") return null;
      throw err;
    }
  };

  // --- Applications & admin API

  const findIndex = (list, id) => {
    const i = list.findIndex((x) => x.id === id);
    if (i === -1) throw httpError(404, "Élément introuvable.");
    return i;
  };

  const uniqueSlug = (list, title) => {
    const base = slugify(title);
    let slug = base;
    for (let n = 2; list.some((x) => x.slug === slug); n++) slug = `${base}-${n}`;
    return slug;
  };

  const notifyApplication = (app) =>
    postEmbed(config.discordWebhook, {
      title: "Nouvelle candidature SASP",
      url: config.siteUrl ? `${config.siteUrl.replace(/\/$/, "")}/admin` : undefined,
      timestamp: app.createdAt,
      fields: [
        field("Candidat", `${app.fullname} — ${app.birth}`),
        field("Discord", app.discord),
        field("Service", app.service),
        field("Objectif", app.goal, false),
        field("Pourquoi lui/elle", app.whyYou, false),
      ],
    }).catch((err) => console.error("[discord]", err.message));

  const api = async (req, res, method, pathname) => {
    if (await messaging.handle(req, res, method, pathname)) return;

    const route = `${method} ${pathname
      .replace(/\/[0-9a-f-]{36}$/, "/:id")
      .replace(/^\/api\/admin\/permissions\/[A-Za-z0-9-]{1,20}$/, "/api/admin/permissions/:matricule")}`;
    const id = pathname.match(/\/([0-9a-f-]{36})$/)?.[1];
    const secure = config.secureCookies;

    // Photo upload (raw image body). public: news photos (news scope); internal: service notes (command staff).
    if (route === "POST /api/uploads") {
      const kind = new URL(req.url, "http://localhost").searchParams.get("kind");
      if (kind === "internal") {
        const officer = messaging.officerFrom(req);
        if (!officer) throw httpError(401, "Session expirée. Reconnectez-vous.");
        if (!officer.command) throw httpError(403, "Réservé au commandement.");
      } else {
        const access = await adminAccess(req);
        if (!access) throw httpError(401, "Session expirée. Reconnectez-vous.");
        if (!access.scopes.includes("news")) throw httpError(403, "Vous n'avez pas le droit de publier des actualités.");
      }
      return sendJson(res, 201, { url: await uploads.save(kind, req) });
    }

    if (route === "POST /api/applications") {
      if (!limiters.apply.allow(clientIp(req))) throw httpError(429, "Trop de candidatures envoyées. Réessayez dans une heure.");
      const body = await readJson(req);
      if (body.website) return sendJson(res, 201, { ok: true }); // honeypot: bots fill hidden fields
      const { errors, value } = validateApplication(body, servicesOf(config));
      throwIfInvalid(errors);
      const app = { id: crypto.randomUUID(), ...value, status: "pending", createdAt: new Date().toISOString(), decidedAt: null };
      await store.update("applications", (list) => { list.push(app); });
      notifyApplication(app);
      return sendJson(res, 201, { ok: true });
    }

    if (route === "POST /api/admin/login") {
      if (!config.adminPassword) throw httpError(503, "Connexion par mot de passe désactivée : connectez-vous avec votre compte MDT dans l'espace agent.");
      if (!limiters.adminLogin.allow(clientIp(req))) throw httpError(429, "Trop de tentatives. Réessayez dans 15 minutes.");
      const { password } = await readJson(req);
      if (!password || !sameSecret(password, config.adminPassword)) throw httpError(401, "Mot de passe incorrect.");
      const token = adminSessions.create({ admin: true });
      return sendJson(res, 200, { ok: true }, { "Set-Cookie": cookie(ADMIN_COOKIE, token, SESSION_TTL / 1000, secure) });
    }

    if (route === "POST /api/admin/logout") {
      adminSessions.destroy(parseCookies(req.headers.cookie)[ADMIN_COOKIE]);
      return sendJson(res, 200, { ok: true }, { "Set-Cookie": cookie(ADMIN_COOKIE, "", 0, secure) });
    }

    if (route === "GET /api/admin/session") {
      const access = await adminAccess(req);
      return sendJson(res, 200, { authenticated: Boolean(access), via: access?.via || null, scopes: access?.scopes || [] });
    }

    if (!pathname.startsWith("/api/admin/")) throw httpError(404, "Route inconnue.");
    const access = await adminAccess(req);
    if (!access) throw httpError(401, "Session expirée. Reconnectez-vous.");
    if (!access.scopes.includes(pathname.split("/")[3])) throw httpError(403, "Vous n'avez pas accès à cette section.");

    switch (route) {
      // PR rights: granted to MDT matricules by command staff
      case "GET /api/admin/permissions":
        return sendJson(res, 200, (await store.read("permissions")).sort((a, b) => a.matricule.localeCompare(b.matricule)));
      case "POST /api/admin/permissions": {
        if (!config.auth) throw httpError(503, "Connexion MDT non configurée : impossible de vérifier le matricule.");
        const mat = String((await readJson(req)).matricule || "").trim();
        const found = MATRICULE.test(mat) ? await config.auth.find(mat) : null;
        if (!found) throwIfInvalid({ matricule: "Matricule inconnu dans le MDT." });
        const grantedBy = access.officer ? `${[access.officer.rank, access.officer.name].filter(Boolean).join(" ")} (${access.officer.matricule})` : "Administration";
        const entry = await store.update("permissions", (list) => {
          const existing = list.find((p) => p.matricule === found.matricule);
          if (existing) return existing;
          const item = { matricule: found.matricule, name: found.name, rank: found.rank, roles: ["pr"], grantedBy, grantedAt: new Date().toISOString() };
          list.push(item);
          return item;
        });
        return sendJson(res, 201, entry);
      }
      case "DELETE /api/admin/permissions/:matricule": {
        const mat = pathname.split("/").pop();
        await store.update("permissions", (list) => {
          const i = list.findIndex((p) => p.matricule === mat);
          if (i === -1) throw httpError(404, "Cet agent n'a pas le droit PR.");
          list.splice(i, 1);
        });
        return sendJson(res, 200, { ok: true });
      }

      case "GET /api/admin/applications": {
        const list = await store.read("applications");
        return sendJson(res, 200, list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      }
      case "PATCH /api/admin/applications/:id": {
        const { status } = await readJson(req);
        if (!STATUSES.includes(status)) throw httpError(400, "Statut inconnu.");
        const app = await store.update("applications", (list) => {
          const item = list[findIndex(list, id)];
          Object.assign(item, { status, decidedAt: status === "pending" ? null : new Date().toISOString() });
          return item;
        });
        return sendJson(res, 200, app);
      }
      case "DELETE /api/admin/applications/:id":
        await store.update("applications", (list) => { list.splice(findIndex(list, id), 1); });
        return sendJson(res, 200, { ok: true });

      case "GET /api/admin/news":
        return sendJson(res, 200, (await store.read("news")).sort(byDateDesc));
      case "GET /api/admin/news/:id": {
        const post = (await store.read("news")).find((n) => n.id === id);
        if (!post) throw httpError(404, "Actualité introuvable.");
        return sendJson(res, 200, { ...post, blocks: blocksOf(post) });
      }
      case "POST /api/admin/news": {
        const { errors, value } = validateNews(await readJson(req));
        throwIfInvalid(errors);
        const post = await store.update("news", (list) => {
          const item = { id: crypto.randomUUID(), slug: uniqueSlug(list, value.title), ...value, createdAt: new Date().toISOString() };
          list.push(item);
          return item;
        });
        return sendJson(res, 201, post);
      }
      case "PUT /api/admin/news/:id": {
        const { errors, value } = validateNews(await readJson(req));
        throwIfInvalid(errors);
        // Slug is fixed at creation so shared links keep working after a title edit.
        let previousPhotos = [];
        const post = await store.update("news", (list) => {
          const item = list[findIndex(list, id)];
          previousPhotos = photosOf(item);
          return Object.assign(item, value);
        });
        const kept = new Set(photosOf(post));
        await Promise.all(previousPhotos.filter((url) => !kept.has(url)).map(uploads.remove));
        return sendJson(res, 200, post);
      }
      case "DELETE /api/admin/news/:id": {
        const [removed] = await store.update("news", (list) => list.splice(findIndex(list, id), 1));
        await Promise.all(photosOf(removed).map(uploads.remove));
        return sendJson(res, 200, { ok: true });
      }
      default:
        throw httpError(404, "Route inconnue.");
    }
  };

  // --- Router

  const handle = async (req, res) => {
    const { pathname, searchParams } = new URL(req.url, "http://localhost");
    if (pathname.startsWith("/api/")) return api(req, res, req.method, pathname);
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Méthode non autorisée", { Allow: "GET, HEAD" });

    const clean = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
    if (Object.hasOwn(pages, clean)) return pages[clean](res);
    const article = clean.match(/^\/actualites\/([a-z0-9-]+)$/);
    if (article && (await articlePage(res, article[1]))) return;
    const preview = clean.match(/^\/admin\/apercu\/([0-9a-f-]{36})$/);
    if (preview && (await previewPage(req, res, preview[1]))) return;

    // Uploaded photos. Internal ones (service notes) answer 404 to anyone not signed in as an agent.
    if (pathname.startsWith("/uploads/")) {
      const internal = pathname.startsWith("/uploads/internal/");
      const file = internal && !messaging.officerFrom(req) ? null : await uploads.read(pathname);
      if (!file) return sendPage(res, 404, "404", { title: "Page introuvable — SASP" });
      return send(res, 200, file.data, {
        "Content-Type": file.type,
        "Cache-Control": internal ? "private, max-age=3600" : "public, max-age=31536000, immutable",
      });
    }
    if (await serveStatic(res, decodeURIComponent(pathname), searchParams.get("v") === ASSET_VERSION)) return;
    return sendPage(res, 404, "404", { title: "Page introuvable — SASP" });
  };

  return async (req, res) => {
    try {
      await handle(req, res);
    } catch (err) {
      const status = err.status || (err instanceof URIError ? 400 : 500);
      if (status === 500) console.error(`[${req.method} ${req.url}]`, err);
      if (res.headersSent) return res.end();
      const message = status === 500 ? "Erreur interne. Réessayez plus tard." : err.message;
      if (req.url.startsWith("/api/")) return sendJson(res, status, { error: message, ...err.extra });
      return send(res, status, message, { "Content-Type": "text/plain; charset=utf-8" });
    }
  };
};

// Site settings from the project .env. The MDT link (accounts, lists) is passed in by server/index.js.
const configFromEnv = (env) => {
  const config = {
    adminPassword: env.SITE_ADMIN_PASSWORD || "",
    discordWebhook: env.DISCORD_WEBHOOK_URL || "",
    discordTicketsWebhook: env.DISCORD_TICKETS_WEBHOOK_URL || "",
    siteUrl: env.SITE_URL || "",
    secureCookies: env.SECURE_COOKIES === "true",
  };
  if (config.adminPassword && config.adminPassword.length < 12) console.warn("[config] SITE_ADMIN_PASSWORD fait moins de 12 caractères.");
  if (!config.discordWebhook) console.warn("[config] DISCORD_WEBHOOK_URL absent : pas de notification Discord.");
  return config;
};

const createApp = (config) => http.createServer(createHandler(config));

export { createApp, createHandler, configFromEnv };
