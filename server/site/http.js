import crypto from "node:crypto";

const MAX_BODY = 64 * 1024;

const SECURITY_HEADERS = {
  "Content-Security-Policy": [
    "default-src 'self'", "script-src 'self'", "style-src 'self'",
    "font-src 'self'", "img-src 'self' data:", "connect-src 'self'",
    "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'",
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const httpError = (status, message, extra) => Object.assign(new Error(message), { status, extra });

const sha256 = (v) => crypto.createHash("sha256").update(String(v)).digest();
const sameSecret = (a, b) => crypto.timingSafeEqual(sha256(a), sha256(b));

const parseCookies = (header = "") =>
  Object.fromEntries(header.split(";").map((c) => c.trim().split("=")).filter(([k, v]) => k && v));

// Sliding-window limiter. allow() returns false once `max` hits happened in `windowMs` for that key.
const createLimiter = (max, windowMs) => {
  const hits = new Map();
  const allow = (key) => {
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    const ok = recent.length < max;
    if (ok) recent.push(now);
    hits.set(key, recent);
    return ok;
  };
  const sweep = () => {
    const now = Date.now();
    hits.forEach((list, key) => { if (list.every((t) => now - t >= windowMs)) hits.delete(key); });
  };
  return { allow, sweep };
};

// In-memory sessions keyed by a random token. ponytail: lost on restart, move to the store if that becomes annoying.
const createSessions = (ttlMs) => {
  const sessions = new Map();
  const create = (data) => {
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { data, exp: Date.now() + ttlMs });
    return token;
  };
  const get = (token) => {
    const s = token && sessions.get(token);
    if (!s || s.exp < Date.now()) return null;
    s.exp = Date.now() + ttlMs;
    return s.data;
  };
  const destroy = (token) => sessions.delete(token);
  const sweep = () => {
    const now = Date.now();
    sessions.forEach((s, token) => { if (s.exp < now) sessions.delete(token); });
  };
  return { create, get, destroy, sweep };
};

const readJson = async (req) => {
  if (!String(req.headers["content-type"]).startsWith("application/json")) throw httpError(415, "JSON attendu.");
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw httpError(413, "Requête trop volumineuse.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw httpError(400, "JSON invalide.");
  }
};

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(res.req.method === "HEAD" ? undefined : body);
  return true; // lets route helpers signal "handled"
};

const sendJson = (res, status, data, headers = {}) =>
  send(res, status, JSON.stringify(data), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });

const cookie = (name, value, maxAgeSec, secure) =>
  `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure ? "; Secure" : ""}`;

const throwIfInvalid = (errors) => {
  if (Object.keys(errors).length) throw httpError(400, "Certains champs sont invalides.", { errors });
};

export {
  esc, httpError, sameSecret, sha256, parseCookies, createLimiter, createSessions,
  readJson, send, sendJson, cookie, throwIfInvalid,
};
