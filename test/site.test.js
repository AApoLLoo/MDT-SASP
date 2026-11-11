import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/site/app.js";
import { slugify, validateApplication, validateTicket } from "../server/site/validate.js";

const PASSWORD = "test-password-123";

// Stand-in for the MDT link given by server/index.js: accounts (siteAuth in server/auth.js) and settings lists.
const ACCOUNTS = [
  { matricule: "1001", password: "pass-doe", name: "J. Doe", rank: "Officier I", command: false },
  { matricule: "1002", password: "pass-smith", name: "A. Smith", rank: "Sergent", command: true },
  { matricule: "1003", password: "pass-lee", name: "K. Lee", rank: "Rookie", command: false },
];
const officerOf = (a) => (a ? { matricule: a.matricule, name: a.name, rank: a.rank, command: a.command } : null);
const auth = {
  find: (m) => officerOf(ACCOUNTS.find((a) => a.matricule === m)),
  verify: (m, p) => officerOf(ACCOUNTS.find((a) => a.matricule === m && a.password === p)),
};
const mdtList = (key) => ({
  secteurs: ["Sud", "Nord"], divisions: ["Patrouille", "S.W.A.T.", "Unité canine"], postes: ["Mission Row"],
  grades: ["Rookie", "Officier I", "Major", "Sergent", "Chief"], grades_swat: ["Recrue", "Opérateur"], grades_bci: ["Detective", "Head of BCI"], qualifications: ["PPA"],
})[key];
const SERVICES = ["SASP Sud", "SASP Nord", "Peu importe"];

const validApp = {
  discord: "jdoe", service: "SASP Nord", fullname: "Doe John", birth: "14/03/1998, 28 ans", phone: "555-0142",
  nationality: "Américaine", goal: "Devenir sergent", availability: "Tous les soirs", record: "Oui",
  traits: "Calme, rigoureux, loyal ; impatient, têtu", career: "Mécanicien à Sandy Shores",
  whyYou: "w".repeat(200), motivation: "m".repeat(350), lastWord: "",
};

const main = async () => {
  // Unit checks
  assert.equal(slugify("L'Air Support reçoit un second hélicoptère"), "l-air-support-recoit-un-second-helicoptere");
  assert.deepEqual(Object.keys(validateApplication({}).errors).sort(),
    ["availability", "birth", "career", "discord", "fullname", "goal", "motivation", "nationality", "phone", "service", "traits", "whyYou"],
    "every Google Form question marked required is required (record and lastWord are optional)");
  assert.deepEqual(validateApplication(validApp, SERVICES).errors, {});
  assert.match(validateApplication({ ...validApp, motivation: "m".repeat(349) }, SERVICES).errors.motivation, /Encore 1 caractères/);
  assert.ok(validateApplication({ ...validApp, record: "Peut-être" }, SERVICES).errors.record);

  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sasp-test-"));
  await fs.copyFile(path.join(import.meta.dirname, "site-news.json"), path.join(dataDir, "news.json"));
  const server = createApp({ adminPassword: PASSWORD, dataDir, mdtUrl: "/mdt/", discordWebhook: "", siteUrl: "", auth, mdtList });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const req = (method, url, body, cookie) =>
    fetch(base + url, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });

  try {
    // Public pages
    let res = await req("GET", "/");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-security-policy"), /script-src 'self'/);
    // Aucun service tiers : la police du journal est servie par le site, Google Fonts n'est plus autorisé
    assert.doesNotMatch(res.headers.get("content-security-policy"), /googleapis|gstatic/);
    const font = await req("GET", "/fonts/oswald-latin.woff2");
    assert.equal(font.status, 200);
    assert.equal(font.headers.get("content-type"), "font/woff2");
    const home = await res.text();
    assert.match(home, /Session de recrutement d&#39;hiver ouverte/);
    // Divisions and recruitment services follow the MDT lists
    assert.match(home, /<dt>S\.W\.A\.T\.<\/dt><dd>Interventions/);
    assert.match(home, /<dt>Unité canine<\/dt><\/div>/, "a division without public text shows its name only");
    assert.deepEqual([...home.matchAll(/name="service" value="([^"]+)"/g)].map((m) => m[1]), SERVICES);

    // Assets are referenced with a version so a browser never runs an outdated cached script
    const assetUrl = home.match(/src="(\/main\.js\?v=[a-z0-9]+)"/)?.[1];
    assert.ok(assetUrl, "main.js is versioned in the page");
    assert.match((await req("GET", assetUrl)).headers.get("cache-control"), /immutable/);

    // /service: grades in MDT order, split into tiers; a grade without public text shows its name only
    const service = await (await req("GET", "/service")).text();
    assert.deepEqual([...service.matchAll(/<span class="ranks__n">(\d+)<\/span><strong>([^<]+)/g)].map((m) => `${m[1]} ${m[2]}`),
      ["1 Rookie", "2 Officier I", "3 Major", "4 Sergent", "5 Chief"]);
    assert.deepEqual([...service.matchAll(/<div class="rank-tier"><h3>([^<]+)/g)].map((m) => m[1]), ["Officiers", "Encadrement"]);
    assert.match(service, /<strong>Major<\/strong><\/li>/);
    assert.match(service, /<strong>5 grades<\/strong>de Rookie à Chief/);
    assert.match(service, /<strong>1 poste<\/strong>Mission Row/);
    // Les grades internes des divisions restent dans le MDT
    assert.doesNotMatch(service, /Grades internes|Opérateur|Head of BCI/);
    // Formations : leur nombre et les domaines de l'Academy, jamais leurs noms
    assert.match(service, /1 formation au catalogue, réparties en 6 domaines\./);
    assert.match(service, /<dt>Armement<\/dt>/);
    assert.doesNotMatch(service, /PPA/);

    for (const url of ["/actualites", "/contact", "/suivi", "/mentions-legales", "/admin", "/agent", "/styles.css", "/civil.js"]) {
      assert.equal((await req("GET", url)).status, 200, url);
    }
    for (const url of ["/effectifs", "/reglement"]) assert.equal((await req("GET", url)).status, 404, `${url} removed`);
    assert.equal((await req("GET", "/actualites/operation-route-68-bilan")).status, 200);
    assert.equal((await req("GET", "/actualites/inexistant")).status, 404);
    assert.equal((await req("GET", "/%2e%2e/package.json")).status, 404, "path traversal must not serve files outside public/");
    assert.equal((await req("GET", "/%E0%A4%A")).status, 400, "malformed URI");

    // Applications
    res = await req("POST", "/api/applications", { ...validApp, service: "SASP Ouest" });
    assert.equal(res.status, 400);
    assert.ok((await res.json()).errors.service);

    res = await req("POST", "/api/applications", { ...validApp, website: "spam" });
    assert.equal(res.status, 201, "honeypot answers success");

    res = await req("POST", "/api/applications", validApp);
    assert.equal(res.status, 201);
    assert.equal((await req("POST", "/api/applications", validApp)).status, 429, "rate limit: 3 per hour per IP");

    const stored = JSON.parse(await fs.readFile(path.join(dataDir, "applications.json"), "utf8"));
    assert.equal(stored.length, 1, "honeypot submission is not stored");
    assert.equal(stored[0].status, "pending");

    // Admin auth
    assert.equal((await req("GET", "/api/admin/applications")).status, 401);
    assert.equal((await req("POST", "/api/admin/login", { password: "wrong" })).status, 401);
    res = await req("POST", "/api/admin/login", { password: PASSWORD });
    assert.equal(res.status, 200);
    const setCookie = res.headers.get("set-cookie");
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    const cookie = setCookie.split(";")[0];

    // Admin: applications
    res = await req("GET", "/api/admin/applications", null, cookie);
    const [app] = await res.json();
    assert.deepEqual([app.fullname, app.service, app.whyYou.length], ["Doe John", "SASP Nord", 200]);
    res = await req("PATCH", `/api/admin/applications/${app.id}`, { status: "accepted" }, cookie);
    assert.equal((await res.json()).status, "accepted");
    assert.equal((await req("PATCH", `/api/admin/applications/${app.id}`, { status: "nope" }, cookie)).status, 400);

    // Admin: news, with HTML in the title to check escaping
    const post = { title: "<script>alert(1)</script> Test", category: "Communiqué", date: "2026-11-01", excerpt: "Un résumé de test.", body: "Paragraphe un assez long.\n\nParagraphe deux.", published: true };
    res = await req("POST", "/api/admin/news", post, cookie);
    assert.equal(res.status, 201);
    const created = await res.json();
    assert.equal(created.slug, "script-alert-1-script-test");
    const article = await (await req("GET", `/actualites/${created.slug}`)).text();
    assert.ok(!article.includes("<script>alert"), "titles are escaped");
    assert.match(article, /<p>Paragraphe deux\.<\/p>/);

    res = await req("PUT", `/api/admin/news/${created.id}`, { ...post, published: false }, cookie);
    assert.equal(res.status, 200);
    assert.equal((await req("GET", `/actualites/${created.slug}`)).status, 404, "drafts are not public");
    assert.equal((await req("DELETE", `/api/admin/news/${created.id}`, null, cookie)).status, 200);

    // Logout invalidates the session
    await req("POST", "/api/admin/logout", null, cookie);
    assert.equal((await req("GET", "/api/admin/applications", null, cookie)).status, 401);

    // --- Civil requests (tracking code, no account)
    const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
    const ticket = {
      category: "Rendez-vous", name: "Jane Roe", contact: "555-0101", subject: "Déclaration de perte",
      body: "Je souhaite déclarer la perte de mes papiers d'identité.", appointmentDate: day(1), appointmentSlot: "Soir",
    };
    // Appointment rules: no more "Plainte", date between today and +60 days, slot required, ignored for other types
    // (only one rejected HTTP call here: tickets are rate-limited to 3 per hour per IP)
    assert.ok((await (await req("POST", "/api/tickets", { ...ticket, category: "Plainte" })).json()).errors.category, "complaints are no longer a request type");
    const errs = validateTicket({ ...ticket, appointmentDate: day(-1), appointmentSlot: "" }).errors;
    assert.deepEqual([Boolean(errs.appointmentDate), Boolean(errs.appointmentSlot)], [true, true]);
    assert.ok(validateTicket({ ...ticket, appointmentDate: day(61) }).errors.appointmentDate, "max 60 days ahead");
    assert.deepEqual(validateTicket(ticket).errors, {});
    assert.equal(validateTicket({ ...ticket, category: "Question" }).value.appointment, null, "date ignored for other request types");
    assert.equal((await req("POST", "/api/tickets", { ...ticket, body: "trop court" })).status, 400);
    res = await req("POST", "/api/tickets", ticket);
    assert.equal(res.status, 201);
    const { code } = await res.json();
    assert.match(code, /^SASP-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const storedThreads = await fs.readFile(path.join(dataDir, "threads.json"), "utf8");
    assert.ok(!storedThreads.includes(code) && !storedThreads.includes(code.replace(/-/g, "").slice(4)), "tracking code is not stored in clear");

    assert.equal((await req("POST", "/api/tickets/lookup", { code: "SASP-AAAA-AAAA-AAAA" })).status, 404);
    res = await req("POST", "/api/tickets/lookup", { code: code.toLowerCase().replace(/-/g, " ") });
    assert.equal(res.status, 200, "code lookup ignores case and separators");
    const civilSeen = await res.json();
    assert.equal(civilSeen.messages.length, 1);
    assert.deepEqual(civilSeen.appointment, { date: day(1), slot: "Soir" }, "the civilian sees the requested appointment");
    assert.equal(civilSeen.trackingHash, undefined);

    // --- Officers (MDT accounts)
    assert.equal((await req("GET", "/api/agent/threads")).status, 401);
    assert.equal((await req("POST", "/api/agent/login", { matricule: "1001", password: "nope" })).status, 401);
    assert.equal((await req("POST", "/api/agent/login", { matricule: "9999", password: "x" })).status, 401);
    const agentCookie = async (matricule, password) => {
      const r = await req("POST", "/api/agent/login", { matricule, password });
      assert.equal(r.status, 200);
      return r.headers.get("set-cookie").split(";")[0];
    };
    const doe = await agentCookie("1001", "pass-doe");
    const smith = await agentCookie("1002", "pass-smith");
    const session = await (await req("GET", "/api/agent/session", null, doe)).json();
    assert.deepEqual([session.officer.name, session.mdtUrl], ["J. Doe", "/mdt/"]);

    res = await req("GET", "/api/agent/threads", null, doe);
    const [civilThread] = await res.json();
    assert.equal(civilThread.type, "civil");
    assert.equal(civilThread.unread, true);

    res = await req("POST", `/api/agent/threads/${civilThread.id}/messages`, { body: "Bonjour, une patrouille passe ce soir." }, doe);
    assert.equal(res.status, 201);
    res = await req("POST", "/api/tickets/lookup", { code });
    const afterReply = await res.json();
    assert.equal(afterReply.messages[1].author, "Officier I J. Doe — SASP");
    assert.ok(!JSON.stringify(afterReply).includes("1001"), "civilians never see officer matricules");

    res = await req("POST", "/api/tickets/reply", { code, body: "Merci !" });
    assert.equal(res.status, 200);

    // --- MDT role: supervisors/admins (command flag) are command staff, agents are not
    const smithSession = await (await req("GET", "/api/agent/session", null, smith)).json();
    assert.deepEqual([session.officer.command, smithSession.officer.command], [false, true]);
    assert.equal((await req("GET", "/api/admin/applications", null, doe)).status, 401, "agent has no admin access");
    assert.equal((await req("GET", "/api/admin/applications", null, smith)).status, 200, "command staff reaches admin with the MDT session");
    assert.equal((await (await req("GET", "/api/admin/session", null, smith)).json()).via, "agent");

    // --- PR rights: granted from the admin by command staff, news only, effective without re-login
    assert.equal((await req("GET", "/api/admin/news", null, doe)).status, 401);
    assert.equal((await req("POST", "/api/admin/permissions", { matricule: "4242" }, smith)).status, 400, "unknown matricule");
    assert.equal((await req("POST", "/api/admin/permissions", { matricule: "1001" }, smith)).status, 201);
    const prSession = await (await req("GET", "/api/admin/session", null, doe)).json();
    assert.deepEqual(prSession.scopes, ["news"]);
    assert.equal((await (await req("GET", "/api/agent/session", null, doe)).json()).officer.pr, true);
    assert.equal((await req("GET", "/api/admin/applications", null, doe)).status, 403, "PR cannot read applications");
    assert.equal((await req("POST", "/api/admin/permissions", { matricule: "1003" }, doe)).status, 403, "PR cannot grant rights");
    res = await req("POST", "/api/admin/news", { title: "Communiqué PR", category: "Communiqué", date: "2026-11-02", excerpt: "Publié par un agent PR.", body: "Contenu du communiqué publié par le PR.", published: true }, doe);
    assert.equal(res.status, 201, "PR publishes news");
    const prPost = await res.json();
    assert.equal((await req("DELETE", "/api/admin/permissions/1001", null, smith)).status, 200);
    assert.equal((await req("DELETE", `/api/admin/news/${prPost.id}`, null, doe)).status, 401, "revoked immediately");
    await req("DELETE", `/api/admin/news/${prPost.id}`, null, smith);

    // --- Photos: type sniffed from bytes, scoped upload rights, internal photos for agents only, cleanup
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    const upload = (kind, data, cookieHeader) =>
      fetch(`${base}/api/uploads?kind=${kind}`, { method: "POST", headers: { "Content-Type": "image/png", ...(cookieHeader ? { Cookie: cookieHeader } : {}) }, body: data });
    assert.equal((await upload("public", png)).status, 401);
    assert.equal((await upload("public", png, doe)).status, 401, "agent without PR cannot upload news photos");
    assert.equal((await upload("internal", png, doe)).status, 403, "agent cannot upload service-note photos");
    assert.equal((await upload("public", Buffer.from("<svg onload=alert(1)>"), smith)).status, 415, "non-image bytes are refused");
    const publicUrl = (await (await upload("public", png, smith)).json()).url;
    assert.match(publicUrl, /^\/uploads\/public\/[0-9a-f-]{36}\.png$/);
    assert.equal((await req("GET", publicUrl)).headers.get("content-type"), "image/png");

    const photoPost = { title: "Avec photo", category: "Communiqué", date: "2026-11-03", excerpt: "Un communiqué illustré.", body: "Contenu du communiqué illustré.", published: true };
    assert.ok((await (await req("POST", "/api/admin/news", { ...photoPost, image: publicUrl }, smith)).json()).errors.imageAlt, "photo needs a description");
    assert.ok((await (await req("POST", "/api/admin/news", { ...photoPost, image: "https://evil.test/x.png", imageAlt: "x x x" }, smith)).json()).errors.image, "only local uploads");
    res = await req("POST", "/api/admin/news", { ...photoPost, image: publicUrl, imageAlt: "Agents devant le poste" }, smith);
    const illustrated = await res.json();
    assert.match(await (await req("GET", `/actualites/${illustrated.slug}`)).text(), new RegExp(`<img src="${publicUrl}" alt="Agents devant le poste"`));
    await req("DELETE", `/api/admin/news/${illustrated.id}`, null, smith);
    assert.equal((await req("GET", publicUrl)).status, 404, "photo deleted with its news");

    // --- Block editor: structured content rendered safely, drafts previewable, legacy text converted
    const inlinePhoto = (await (await upload("public", png, smith)).json()).url;
    const blocks = [
      { type: "h2", text: "Ce qui change" },
      { type: "p", text: "Un **point clé** et un [lien officiel](https://sasp.test/doc). <img src=x onerror=alert(1)> [piège](javascript:alert(1))" },
      { type: "quote", text: "La sécurité avant tout." },
      { type: "list", items: ["Premier point", "", "Second point"] },
      { type: "image", image: inlinePhoto, alt: "Le poste de police", caption: "Poste de Sandy Shores" },
      { type: "p", text: "   " },
    ];
    const draftInput = { title: "Article en blocs", category: "Communiqué", date: "2026-11-04", excerpt: "Un article construit en blocs.", blocks, published: false };
    assert.ok((await (await req("POST", "/api/admin/news", { ...draftInput, blocks: [{ type: "image", image: inlinePhoto, alt: "" }, { type: "p", text: "x".repeat(30) }] }, smith)).json()).errors.body, "inline photos need a description");
    res = await req("POST", "/api/admin/news", draftInput, smith);
    const draft = await res.json();
    assert.equal(draft.blocks.length, 5, "empty blocks are dropped");
    assert.deepEqual(draft.blocks[3].items, ["Premier point", "Second point"]);
    assert.equal((await req("GET", `/actualites/${draft.slug}`)).status, 404, "drafts are not public");
    assert.equal((await req("GET", `/admin/apercu/${draft.id}`)).status, 404, "preview needs news rights");
    const previewHtml = await (await req("GET", `/admin/apercu/${draft.id}`, null, smith)).text();
    assert.match(previewHtml, /brouillon non publié/);
    assert.match(previewHtml, /<h2>Ce qui change<\/h2>/);
    assert.match(previewHtml, /<strong>point clé<\/strong>/);
    assert.match(previewHtml, /<a href="https:\/\/sasp\.test\/doc" rel="noopener nofollow" target="_blank">lien officiel<\/a>/);
    assert.ok(!previewHtml.includes("<img src=x") && previewHtml.includes("&lt;img src=x"), "raw HTML in text is escaped");
    assert.ok(!previewHtml.includes('href="javascript'), "only http(s) links become links");
    assert.match(previewHtml, /<blockquote><p>La sécurité avant tout\.<\/p><\/blockquote>/);
    assert.match(previewHtml, /<figcaption>Poste de Sandy Shores<\/figcaption>/);
    const legacy = await (await req("GET", "/api/admin/news/3f6c1a2e-8d4b-4c1e-9a7f-1b2c3d4e5f02", null, smith)).json();
    assert.deepEqual(legacy.blocks.map((b) => b.type), ["p", "p"], "plain-text news opens as paragraph blocks");
    await req("PUT", `/api/admin/news/${draft.id}`, { ...draftInput, blocks: blocks.filter((b) => b.type !== "image") }, smith);
    assert.equal((await req("GET", inlinePhoto)).status, 404, "photo removed from the content is deleted");
    await req("DELETE", `/api/admin/news/${draft.id}`, null, smith);

    // Journal: an edition with its own masthead texts, one rubrique per "section" block
    const edition = await (await req("POST", "/api/admin/news", {
      title: "Opération d'envergure", category: "Journal", date: "2026-11-05", excerpt: "L'édition de la semaine.", published: true,
      masthead: { kicker: "", name: "SASP TIP", slogan: "Votre source <b>officielle</b>", edition: "Édition n°12-2026", motto: "Protéger\nServir", footer: "" },
      blocks: [
        { type: "p", text: "Avant toute rubrique." },
        { type: "section", text: "Arrestations" }, { type: "h2", text: "Plusieurs individus appréhendés" },
        { type: "p", text: "Ce mercredi, les unités du SASP ont mené une opération." }, { type: "quote", text: "Le SASP reste mobilisé." },
        { type: "section", text: "Saisies" }, { type: "list", items: ["2,5 kg de cocaïne", "1 arme à feu"] },
      ],
    }, smith)).json();
    const editionHtml = await (await req("GET", `/actualites/${edition.slug}`)).text();
    assert.match(editionHtml, /<p class="edition__title">SASP TIP<\/p><p class="edition__slogan">Votre source &lt;b&gt;officielle&lt;\/b&gt;<\/p>/, "masthead texts are escaped");
    assert.match(editionHtml, /<span class="edition__number">Édition n°12-2026<\/span>/);
    assert.match(editionHtml, /<p class="edition__motto">Protéger<br>Servir<\/p>/);
    assert.ok(!editionHtml.includes("edition__kicker") && !editionHtml.includes("edition__foot"), "empty masthead texts are left out");
    assert.deepEqual([...editionHtml.matchAll(/class="rubrique__label">([^<]+)/g)].map((m) => m[1]), ["Arrestations", "Saisies"]);
    assert.match(editionHtml, /<section class="rubrique">\s*<div class="rubrique__body"><div class="rubrique__text"><p>Avant toute rubrique\.<\/p>/, "content before the first rubrique gets an unlabelled one");
    assert.match(editionHtml, /<h3 class="rubrique__title">Plusieurs individus appréhendés<\/h3>/);
    assert.match(editionHtml, /<p class="rubrique__tagline">Le SASP reste mobilisé\.<\/p>/);
    assert.ok((await (await req("POST", "/api/admin/news", { ...draftInput, blocks: [{ type: "section", text: "x".repeat(61) }, { type: "p", text: "x".repeat(30) }] }, smith)).json()).errors.body, "rubrique names are short");
    await req("DELETE", `/api/admin/news/${edition.id}`, null, smith);

    const internalUrl = (await (await upload("internal", png, smith)).json()).url;
    assert.equal((await req("GET", internalUrl)).status, 404, "internal photos hidden from visitors");
    assert.equal((await req("GET", internalUrl, null, doe)).status, 200, "internal photos visible to agents");
    assert.equal((await req("POST", "/api/agent/announcements", { title: "Note photo", body: "Avec photo jointe.", image: publicUrl }, smith)).status, 400, "notes only take internal photos");
    res = await req("POST", "/api/agent/announcements", { title: "Note photo", body: "Avec photo jointe.", image: internalUrl }, smith);
    await req("DELETE", `/api/agent/announcements/${(await res.json()).id}`, null, smith);
    assert.equal((await req("GET", internalUrl, null, doe)).status, 404, "photo deleted with its note");

    // --- Request management: assignee, priority, internal notes, history
    assert.equal((await req("PATCH", `/api/agent/threads/${civilThread.id}`, { assignee: "4242" }, doe)).status, 400, "unknown assignee");
    assert.equal((await req("PATCH", `/api/agent/threads/${civilThread.id}`, { priority: "extrême" }, doe)).status, 400);
    res = await req("PATCH", `/api/agent/threads/${civilThread.id}`, { assignee: "1001", priority: "haute" }, doe);
    const managed = await res.json();
    assert.deepEqual([managed.assignee.matricule, managed.priority], ["1001", "haute"]);
    res = await req("POST", `/api/agent/threads/${civilThread.id}/notes`, { body: "Suspect connu, voir dossier MDT 77." }, doe);
    const withNote = await res.json();
    assert.equal(withNote.notes.length, 1);
    assert.ok(withNote.history.some((h) => h.action.startsWith("Assignée à")));
    const civilAfterNote = JSON.stringify(await (await req("POST", "/api/tickets/lookup", { code })).json());
    assert.ok(!civilAfterNote.includes("Suspect connu") && !civilAfterNote.includes("haute"), "civilians never see notes or management data");
    assert.ok(!(await fs.readFile(path.join(dataDir, "threads.json"), "utf8")).includes('"command"'), "session flags are not stored");

    let dash = await (await req("GET", "/api/agent/dashboard", null, doe)).json();
    assert.deepEqual([dash.counts.mine, dash.counts.unassigned, dash.mine[0].id], [1, 0, civilThread.id]);

    // --- Service notes: command publishes, everyone reads
    const noteInput = { title: "Briefing du soir", body: "Rassemblement à 21 h au poste de Sandy Shores.", pinned: true };
    assert.equal((await req("POST", "/api/agent/announcements", noteInput, doe)).status, 403, "agents cannot publish");
    res = await req("POST", "/api/agent/announcements", noteInput, smith);
    assert.equal(res.status, 201);
    const note = await res.json();
    dash = await (await req("GET", "/api/agent/dashboard", null, doe)).json();
    assert.equal(dash.announcements[0].title, "Briefing du soir");
    assert.equal((await req("DELETE", `/api/agent/announcements/${note.id}`, null, doe)).status, 403);
    assert.equal((await req("DELETE", `/api/agent/announcements/${note.id}`, null, smith)).status, 200);

    res = await req("PATCH", `/api/agent/threads/${civilThread.id}`, { status: "closed" }, smith);
    assert.equal((await res.json()).status, "closed");
    assert.equal((await req("POST", "/api/tickets/reply", { code, body: "Encore ?" })).status, 409, "closed requests refuse replies");

    // Internal messaging: only participants see the thread
    assert.equal((await req("POST", "/api/agent/threads", { to: ["4242"], subject: "Test", body: "Salut" }, doe)).status, 400, "unknown matricule");
    res = await req("POST", "/api/agent/threads", { to: ["1002"], subject: "Patrouille", body: "Dispo ce soir ?" }, doe);
    assert.equal(res.status, 201);
    const internal = await res.json();
    const third = await agentCookie("1003", "pass-lee");
    assert.equal((await req("GET", `/api/agent/threads/${internal.id}`, null, third)).status, 404, "non-participant cannot read");
    res = await req("GET", "/api/agent/threads", null, smith);
    assert.ok((await res.json()).some((t) => t.id === internal.id && t.unread));
    assert.equal((await req("GET", "/api/agent/officers/1002", null, doe)).status, 200);
  } finally {
    server.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
};

test("site : pages, demandes civiles, espace agent et administration", main);
