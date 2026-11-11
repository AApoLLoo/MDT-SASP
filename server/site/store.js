import fs from "node:fs/promises";
import path from "node:path";

// ponytail: JSON files + per-file write queue; fine for a few thousand records, move to SQLite (node:sqlite) beyond that.
const createStore = (dir) => {
  const queues = new Map();
  const file = (name) => path.join(dir, `${name}.json`);

  const read = async (name) => {
    try {
      return JSON.parse(await fs.readFile(file(name), "utf8"));
    } catch (err) {
      if (err.code === "ENOENT") return [];
      throw new Error(`Lecture de ${name}.json impossible : ${err.message}`);
    }
  };

  // fn mutates the array in place and returns the operation result.
  // Writes go to a temp file then rename, so a crash never leaves a half-written file.
  const update = (name, fn) => {
    const run = async () => {
      const data = await read(name);
      const result = fn(data);
      await fs.mkdir(dir, { recursive: true });
      const tmp = `${file(name)}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(data, null, 2));
      await fs.rename(tmp, file(name));
      return result;
    };
    const next = (queues.get(name) || Promise.resolve()).then(run, run);
    queues.set(name, next);
    return next;
  };

  return { read, update };
};

export { createStore };
