import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { httpError } from "./http.js";

const MAX_BYTES = 3 * 1024 * 1024;
const KINDS = ["public", "internal"]; // public: news photos; internal: service-note photos, agents only
const MIME = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

// Trust the bytes, not the Content-Type header. SVG is deliberately not accepted (it can carry scripts).
const sniffImage = (buf) => {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "webp";
  return null;
};

const URL_RE = /^\/uploads\/(public|internal)\/([0-9a-f-]{36}\.(?:jpg|png|webp))$/;
const isUploadUrl = (url, kind) => URL_RE.exec(String(url || ""))?.[1] === kind;

const readRaw = async (req) => {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) throw httpError(413, "Photo trop lourde : 3 Mo maximum.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

const createUploads = (dataDir) => {
  const root = path.join(dataDir, "uploads");
  const fileFor = (url) => {
    const m = URL_RE.exec(String(url || ""));
    return m ? path.join(root, m[1], m[2]) : null;
  };

  const save = async (kind, req) => {
    if (!KINDS.includes(kind)) throw httpError(400, "Type d'envoi inconnu.");
    const buf = await readRaw(req);
    const ext = sniffImage(buf);
    if (!ext) throw httpError(415, "Format non pris en charge : envoyez une photo JPEG, PNG ou WebP.");
    const name = `${crypto.randomUUID()}.${ext}`;
    await fs.mkdir(path.join(root, kind), { recursive: true });
    await fs.writeFile(path.join(root, kind, name), buf);
    return `/uploads/${kind}/${name}`;
  };

  // Returns { data, type } or null when the file does not exist.
  const read = async (url) => {
    const file = fileFor(url);
    if (!file) return null;
    try {
      return { data: await fs.readFile(file), type: MIME[path.extname(file).slice(1)] };
    } catch (err) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
  };

  const remove = async (url) => {
    const file = fileFor(url);
    if (!file) return;
    try {
      await fs.unlink(file);
    } catch (err) {
      if (err.code !== "ENOENT") console.error("[uploads] suppression impossible :", err.message);
    }
  };

  // Deletes files no record points to (uploaded then abandoned in an editor), once they are a day old.
  const purgeOrphans = async (referenced) => {
    const keep = new Set(referenced.filter(Boolean));
    const now = Date.now();
    for (const kind of KINDS) {
      let names;
      try {
        names = await fs.readdir(path.join(root, kind));
      } catch (err) {
        if (err.code === "ENOENT") continue;
        throw err;
      }
      for (const name of names) {
        const url = `/uploads/${kind}/${name}`;
        if (keep.has(url)) continue;
        const { mtimeMs } = await fs.stat(path.join(root, kind, name));
        if (now - mtimeMs > ORPHAN_AGE_MS) await remove(url);
      }
    }
  };

  return { save, read, remove, purgeOrphans };
};

export { createUploads, isUploadUrl, sniffImage };
