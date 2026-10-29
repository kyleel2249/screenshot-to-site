import { MemoryDb } from "../db";
import { deserialize, serialize } from "./serialize";

/**
 * Persistence contract. `save` is a compare-and-swap: it must succeed ONLY if the stored version still equals
 * `expectedVersion` (then store json at expectedVersion+1) and return false otherwise.
 */
export interface Persistence {
  load(): Promise<{ json: string | null; version: number }>;
  save(json: string, expectedVersion: number): Promise<boolean>;
}

export class ConflictError extends Error { constructor() { super("Too many concurrent updates, please retry."); this.name = "ConflictError"; } }

/**
 * Runs `fn` against a fresh snapshot and commits atomically. If another writer committed first, the snapshot is
 * reloaded and `fn` re-runs, so invariants (e.g. stock reservation) are always re-checked against current state.
 * `fn` must therefore be safe to re-run (all service functions are: they only mutate the passed db).
 * Read-only calls skip the write when nothing changed.
 */
export async function transact<T>(p: Persistence, fn: (db: MemoryDb) => Promise<T> | T, retries = 8): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const { json, version } = await p.load();
    const db = deserialize(json);
    const result = await fn(db);
    const next = serialize(db);
    if (next === (json ?? serialize(new MemoryDb()))) return result; // nothing changed
    if (await p.save(next, version)) return result;
  }
  throw new ConflictError();
}

export class MemoryPersistence implements Persistence {
  private json: string | null = null; private version = 0;
  async load() { return { json: this.json, version: this.version }; }
  async save(json: string, expected: number) { if (expected !== this.version) return false; this.json = json; this.version++; return true; }
}
