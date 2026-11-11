import crypto from "node:crypto";
import { httpError, readJson, sendJson, sha256, parseCookies, cookie, throwIfInvalid } from "./http.js";
import { MATRICULE, PRIORITIES, validateTicket, validateMessage, validateInternal, validateAnnouncement } from "./validate.js";
import { field, postEmbed } from "./discord.js";

const COOKIE = "sasp_agent";
const RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 symbols, no 0/O/1/I

// 12 symbols x 5 bits = 60 bits of entropy. 256 % 32 === 0, so `byte % 32` is unbiased.
const newTrackingCode = () => {
  const chars = [...crypto.randomBytes(12)].map((b) => CODE_ALPHABET[b % 32]).join("");
  return `SASP-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
};

const normalizeCode = (code) => {
  const raw = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return raw.length === 16 && raw.startsWith("SASP") ? raw.slice(4) : raw;
};
const hashCode = (code) => sha256(normalizeCode(code)).toString("hex");

const officerLabel = (o) => [o.rank, o.name].filter(Boolean).join(" ") || o.matricule;
// What gets stored about an officer: never the session-only flags (e.g. `command`).
const who = ({ matricule, name, rank }) => ({ matricule, name, rank });

// Fields added after the first release: older stored threads may lack them.
const withDefaults = (t) =>
  t.type === "civil" ? { priority: "normale", assignee: null, notes: [], history: [], ...t } : t;

const logEvent = (t, officer, action) => {
  t.history = [...(t.history || []), { at: new Date().toISOString(), by: officer ? officerLabel(officer) : "Civil", action }];
};

const newMessage = (from, body, officer) => ({
  id: crypto.randomUUID(), from, ...(officer ? { officer } : {}), body, createdAt: new Date().toISOString(),
});

// What a civilian sees: no tracking hash, no officer matricule.
const civilView = (t) => ({
  subject: t.subject, category: t.category, status: t.status, createdAt: t.createdAt, appointment: t.appointment || null,
  messages: t.messages.map((m) => ({
    from: m.from, body: m.body, createdAt: m.createdAt,
    author: m.from === "civil" ? t.civil.name : `${officerLabel(m.officer)} — SASP`,
  })),
});

const agentView = ({ trackingHash, ...t }) => withDefaults(t);

const isUnread = (t, matricule) => {
  const last = t.messages.at(-1);
  if (!last || last.officer?.matricule === matricule) return false;
  return last.createdAt > (t.readBy?.[matricule] || "");
};

const summary = (raw, matricule) => {
  const t = withDefaults(raw);
  const last = t.messages.at(-1);
  return {
    id: t.id, type: t.type, subject: t.subject, category: t.category, status: t.status,
    priority: t.priority, assignee: t.assignee, appointment: t.appointment || null,
    civilName: t.civil?.name, participants: t.participants,
    updatedAt: t.updatedAt, count: t.messages.length, unread: isUnread(t, matricule),
    lastFrom: last.from === "civil" ? t.civil.name : officerLabel(last.officer),
    preview: last.body.slice(0, 120),
  };
};

const createMessaging = ({ store, auth, sessions, limiters, config, clientIp, uploads }) => {
  const requireCommand = (officer) => {
    if (!officer.command) throw httpError(403, "Réservé au commandement.");
  };

  const officerFrom = (req) => sessions.get(parseCookies(req.headers.cookie)[COOKIE]);
  // Read on every check (not cached in the session) so granting or revoking PR applies immediately.
  const isPr = async (officer) =>
    (await store.read("permissions")).some((p) => p.matricule === officer.matricule && p.roles.includes("pr"));
  const requireOfficer = (req) => {
    const officer = officerFrom(req);
    if (!officer) throw httpError(401, "Session expirée. Reconnectez-vous avec votre matricule.");
    return officer;
  };
  const canSee = (t, officer) => t.type === "civil" || t.participants.some((p) => p.matricule === officer.matricule);

  const findThread = (list, id, officer) => {
    const t = list.find((x) => x.id === id);
    if (!t || (officer && !canSee(t, officer))) throw httpError(404, "Conversation introuvable.");
    return t;
  };

  const findByCode = (list, code) => {
    const hash = hashCode(code);
    const t = list.find((x) => x.type === "civil" && x.trackingHash === hash);
    if (!t) throw httpError(404, "Aucune demande ne correspond à ce code. Vérifiez la saisie.");
    return t;
  };

  const notifyTicket = (t) =>
    postEmbed(config.discordTicketsWebhook || config.discordWebhook, {
      title: `Nouvelle demande civile : ${t.category}`,
      url: config.siteUrl ? `${config.siteUrl.replace(/\/$/, "")}/agent` : undefined,
      timestamp: t.createdAt,
      fields: [
        field("Objet", t.subject, false), field("De", t.civil.name),
        t.appointment ? field("Rendez-vous souhaité", `${t.appointment.date} — ${t.appointment.slot}`) : null,
      ].filter(Boolean),
    }).catch((err) => console.error("[discord]", err.message));

  // Closed civil requests are deleted 6 months after closing (promised on /mentions-legales).
  const purge = () =>
    store.update("threads", (list) => {
      const cutoff = Date.now() - RETENTION_MS;
      const keep = list.filter((t) => t.type !== "civil" || t.status !== "closed" || Date.parse(t.closedAt) > cutoff);
      list.splice(0, list.length, ...keep);
    }).catch((err) => console.error("[purge threads]", err.message));

  const handle = async (req, res, method, pathname) => {
    const id = pathname.match(/\/([0-9a-f-]{36})(?:\/|$)/)?.[1];
    const route = `${method} ${pathname.replace(/\/[0-9a-f-]{36}(?=\/|$)/, "/:id").replace(/\/officers\/[^/]+$/, "/officers/:m")}`;
    const ip = clientIp(req);

    switch (route) {
      // --- Civilians (no account, tracking code)
      case "POST /api/tickets": {
        if (!limiters.ticket.allow(ip)) throw httpError(429, "Trop de demandes envoyées. Réessayez dans une heure.");
        const input = await readJson(req);
        if (input.website) return sendJson(res, 201, { code: newTrackingCode() }); // honeypot
        const { errors, value } = validateTicket(input);
        throwIfInvalid(errors);
        const code = newTrackingCode();
        const now = new Date().toISOString();
        const thread = {
          id: crypto.randomUUID(), type: "civil", category: value.category, subject: value.subject, appointment: value.appointment,
          civil: { name: value.name, contact: value.contact }, status: "open", trackingHash: hashCode(code),
          messages: [newMessage("civil", value.body)], readBy: {}, createdAt: now, updatedAt: now, closedAt: null,
          priority: "normale", assignee: null, notes: [], history: [{ at: now, by: "Civil", action: "Demande envoyée" }],
        };
        await store.update("threads", (list) => { list.push(thread); });
        notifyTicket(thread);
        return sendJson(res, 201, { code });
      }
      case "POST /api/tickets/lookup": {
        if (!limiters.lookup.allow(ip)) throw httpError(429, "Trop de tentatives. Réessayez dans 15 minutes.");
        const { code } = await readJson(req);
        return sendJson(res, 200, civilView(findByCode(await store.read("threads"), code)));
      }
      case "POST /api/tickets/reply": {
        if (!limiters.lookup.allow(ip)) throw httpError(429, "Trop de tentatives. Réessayez dans 15 minutes.");
        const input = await readJson(req);
        const { errors, value } = validateMessage(input);
        throwIfInvalid(errors);
        const thread = await store.update("threads", (list) => {
          const t = findByCode(list, input.code);
          if (t.status === "closed") throw httpError(409, "Cette demande est clôturée. Envoyez une nouvelle demande si besoin.");
          t.messages.push(newMessage("civil", value.body));
          t.updatedAt = new Date().toISOString();
          return t;
        });
        return sendJson(res, 200, civilView(thread));
      }

      // --- Officers (MDT matricule + password)
      case "POST /api/agent/login": {
        if (!auth) throw httpError(503, "Connexion MDT non configurée sur ce serveur.");
        if (!limiters.agentLogin.allow(ip)) throw httpError(429, "Trop de tentatives. Réessayez dans 15 minutes.");
        const { matricule, password } = await readJson(req);
        const mat = String(matricule || "").trim();
        if (!MATRICULE.test(mat) || !password) throw httpError(400, "Matricule et mot de passe requis.");
        const found = await auth.verify(mat, String(password));
        if (!found) throw httpError(401, "Matricule ou mot de passe incorrect.");
        // Command staff = MDT supervisors and admins (flag set by the auth provider).
        const officer = { ...who(found), command: Boolean(found.command) };
        const token = sessions.create(officer);
        return sendJson(res, 200, { officer }, { "Set-Cookie": cookie(COOKIE, token, 8 * 3600, config.secureCookies) });
      }
      case "POST /api/agent/logout":
        sessions.destroy(parseCookies(req.headers.cookie)[COOKIE]);
        return sendJson(res, 200, { ok: true }, { "Set-Cookie": cookie(COOKIE, "", 0, config.secureCookies) });
      case "GET /api/agent/session": {
        const officer = officerFrom(req);
        const full = officer ? { ...officer, pr: await isPr(officer) } : null;
        return sendJson(res, 200, { authenticated: Boolean(officer), officer: full, mdtUrl: config.mdtUrl });
      }
    }

    if (!pathname.startsWith("/api/agent/")) return false;
    const officer = requireOfficer(req);

    switch (route) {
      case "GET /api/agent/threads": {
        const list = (await store.read("threads")).filter((t) => canSee(t, officer)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return sendJson(res, 200, list.map((t) => summary(t, officer.matricule)));
      }
      case "GET /api/agent/threads/:id": {
        const thread = await store.update("threads", (list) => {
          const t = findThread(list, id, officer);
          t.readBy = { ...t.readBy, [officer.matricule]: new Date().toISOString() };
          return t;
        });
        return sendJson(res, 200, agentView(thread));
      }
      case "POST /api/agent/threads/:id/messages": {
        const { errors, value } = validateMessage(await readJson(req));
        throwIfInvalid(errors);
        const thread = await store.update("threads", (list) => {
          const t = findThread(list, id, officer);
          if (t.status === "closed") throw httpError(409, "Demande clôturée. Rouvrez-la pour répondre.");
          const msg = newMessage("officer", value.body, who(officer));
          t.messages.push(msg);
          t.updatedAt = msg.createdAt;
          t.readBy = { ...t.readBy, [officer.matricule]: msg.createdAt };
          if (t.type === "civil") logEvent(t, officer, "A répondu au civil");
          return t;
        });
        return sendJson(res, 201, agentView(thread));
      }
      // Civil request management: status, priority, assignee (each change is logged in the history)
      case "PATCH /api/agent/threads/:id": {
        const input = await readJson(req);
        if (input.status !== undefined && !["open", "closed"].includes(input.status)) throw httpError(400, "Statut inconnu.");
        if (input.priority !== undefined && !PRIORITIES.includes(input.priority)) throw httpError(400, "Priorité inconnue.");
        let assignee;
        if (input.assignee !== undefined && input.assignee !== null) {
          const mat = String(input.assignee).trim();
          assignee = MATRICULE.test(mat) ? await auth.find(mat) : null;
          if (!assignee) throw httpError(400, `Matricule inconnu : ${mat}.`);
          assignee = who(assignee);
        }
        const thread = await store.update("threads", (list) => {
          const t = findThread(list, id, officer);
          if (t.type !== "civil") throw httpError(400, "Seules les demandes civiles se gèrent ainsi.");
          Object.assign(t, withDefaults(t));
          if (input.status !== undefined && input.status !== t.status) {
            Object.assign(t, { status: input.status, closedAt: input.status === "closed" ? new Date().toISOString() : null });
            logEvent(t, officer, input.status === "closed" ? "A clôturé la demande" : "A rouvert la demande");
          }
          if (input.priority !== undefined && input.priority !== t.priority) {
            t.priority = input.priority;
            logEvent(t, officer, `Priorité : ${input.priority}`);
          }
          if (input.assignee !== undefined) {
            t.assignee = assignee || null;
            logEvent(t, officer, assignee ? `Assignée à ${officerLabel(assignee)} (${assignee.matricule})` : "Retirée de l'assignation");
          }
          return t;
        });
        return sendJson(res, 200, agentView(thread));
      }
      // Internal notes: officers only, never shown to the civilian
      case "POST /api/agent/threads/:id/notes": {
        const { errors, value } = validateMessage(await readJson(req));
        throwIfInvalid(errors);
        const thread = await store.update("threads", (list) => {
          const t = findThread(list, id, officer);
          if (t.type !== "civil") throw httpError(400, "Les notes internes concernent les demandes civiles.");
          Object.assign(t, withDefaults(t));
          t.notes.push({ id: crypto.randomUUID(), officer: who(officer), body: value.body, createdAt: new Date().toISOString() });
          logEvent(t, officer, "A ajouté une note interne");
          return t;
        });
        return sendJson(res, 201, agentView(thread));
      }
      case "GET /api/agent/dashboard": {
        const threads = (await store.read("threads")).filter((t) => canSee(t, officer)).map(withDefaults);
        const open = threads.filter((t) => t.type === "civil" && t.status === "open");
        const mine = open.filter((t) => t.assignee?.matricule === officer.matricule);
        const notes = (await store.read("announcements")).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));
        return sendJson(res, 200, {
          counts: {
            open: open.length,
            unassigned: open.filter((t) => !t.assignee).length,
            mine: mine.length,
            unread: threads.filter((t) => t.type === "internal" && isUnread(t, officer.matricule)).length,
          },
          mine: mine.sort((a, b) => PRIORITIES.indexOf(b.priority) - PRIORITIES.indexOf(a.priority)).map((t) => summary(t, officer.matricule)),
          announcements: notes.slice(0, 3),
        });
      }
      // Service notes: everyone reads, command staff publishes
      case "GET /api/agent/announcements": {
        const notes = await store.read("announcements");
        return sendJson(res, 200, notes.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt)));
      }
      case "POST /api/agent/announcements": {
        requireCommand(officer);
        const { errors, value } = validateAnnouncement(await readJson(req));
        throwIfInvalid(errors);
        const note = { id: crypto.randomUUID(), ...value, author: who(officer), createdAt: new Date().toISOString() };
        await store.update("announcements", (list) => { list.push(note); });
        return sendJson(res, 201, note);
      }
      case "DELETE /api/agent/announcements/:id": {
        requireCommand(officer);
        const [removed] = await store.update("announcements", (list) => {
          const i = list.findIndex((n) => n.id === id);
          if (i === -1) throw httpError(404, "Note introuvable.");
          return list.splice(i, 1);
        });
        if (removed.image) await uploads.remove(removed.image);
        return sendJson(res, 200, { ok: true });
      }
      case "POST /api/agent/threads": {
        const { errors, value } = validateInternal(await readJson(req));
        throwIfInvalid(errors);
        const others = value.to.filter((m) => m !== officer.matricule);
        if (!others.length) throwIfInvalid({ to: "Ajoutez au moins un autre matricule que le vôtre." });
        const found = await Promise.all(others.map((m) => auth.find(m)));
        const unknown = others.filter((_, i) => !found[i]);
        if (unknown.length) throwIfInvalid({ to: `Matricule inconnu : ${unknown.join(", ")}.` });
        const msg = newMessage("officer", value.body, who(officer));
        const thread = {
          id: crypto.randomUUID(), type: "internal", subject: value.subject, participants: [who(officer), ...found.map(who)],
          messages: [msg], readBy: { [officer.matricule]: msg.createdAt }, createdAt: msg.createdAt, updatedAt: msg.createdAt,
        };
        await store.update("threads", (list) => { list.push(thread); });
        return sendJson(res, 201, agentView(thread));
      }
      case "GET /api/agent/officers/:m": {
        const mat = decodeURIComponent(pathname.split("/").pop());
        const found = MATRICULE.test(mat) ? await auth.find(mat) : null;
        if (!found) throw httpError(404, "Matricule inconnu.");
        return sendJson(res, 200, who(found));
      }
      default:
        throw httpError(404, "Route inconnue.");
    }
  };

  return { handle, purge, officerFrom, isPr };
};

export { createMessaging, newTrackingCode, normalizeCode };
