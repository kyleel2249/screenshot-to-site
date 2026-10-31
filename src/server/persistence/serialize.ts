import { MemoryDb } from "../db";

const replacer = (_k: string, v: unknown) => v instanceof Map ? { $t: "Map", v: [...v] } : v instanceof Set ? { $t: "Set", v: [...v] } : v;
const reviver = (_k: string, v: unknown) => {
  if (v && typeof v === "object" && "$t" in v) { const o = v as { $t: string; v: unknown[] }; if (o.$t === "Map") return new Map(o.v as [unknown, unknown][]); if (o.$t === "Set") return new Set(o.v); }
  return v;
};
export const serialize = (db: MemoryDb): string => JSON.stringify(db, replacer);
export function deserialize(json: string | null): MemoryDb {
  const db = new MemoryDb();
  if (json) Object.assign(db, JSON.parse(json, reviver));
  return db;
}
