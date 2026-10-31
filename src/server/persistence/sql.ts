import type { Persistence } from "./transact";

export const STATE_DDL = "CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, json TEXT NOT NULL)";
export const CHUNK_DDL = "CREATE TABLE IF NOT EXISTS app_state_chunks (token TEXT NOT NULL, idx INTEGER NOT NULL, data TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (token, idx))";

/** Minimal structural subset of Cloudflare D1, so this compiles without @cloudflare/workers-types. */
export interface D1Like {
  prepare(sql: string): { bind(...v: unknown[]): { first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }>; run(): Promise<{ meta: { changes: number } }> } };
  exec(sql: string): Promise<unknown>;
}

/** D1 rejects rows over ~2 MB, so state is stored inline only while small; beyond that it is split into chunks well under the limit. */
export const INLINE_MAX = 700_000, CHUNK_SIZE = 400_000;
const MARK = "@chunks:";
/** Chunk rows nobody points at for this long are leftovers of a crashed or lost write and may be deleted. */
export const ORPHAN_AGE_MS = 10 * 60_000;

/**
 * Works with Cloudflare D1 (and anything exposing the same surface).
 *
 * Small state lives in `app_state.json`. Large state is written FIRST as chunk rows under a fresh random token (nothing points at them yet),
 * and only then does the compare-and-swap `UPDATE ... WHERE version = ?` flip the pointer (`json = "@chunks:<token>:<count>"`) to them.
 * A reader therefore always sees either the complete old state or the complete new one; a lost race or crash leaves only unreferenced
 * chunks, which are deleted straight away (or by `cleanup()` if the Worker died). The UPDATE ... WHERE version = ? is the compare-and-swap.
 */
export class D1Persistence implements Persistence {
  private ready = false;
  constructor(private db: D1Like) {}
  private async init() { if (!this.ready) { await this.db.exec(STATE_DDL); await this.db.exec(CHUNK_DDL); this.ready = true; } }

  async load() {
    await this.init();
    for (let attempt = 0; attempt < 6; attempt++) {
      const row = await this.db.prepare("SELECT version, json FROM app_state WHERE id = 1").bind().first<{ version: number; json: string }>();
      if (!row) return { json: null, version: 0 };
      if (!row.json.startsWith(MARK)) return { json: row.json, version: row.version };
      const [token, countRaw] = row.json.slice(MARK.length).split(":"); const count = Number(countRaw);
      const { results } = await this.db.prepare("SELECT idx, data FROM app_state_chunks WHERE token = ? ORDER BY idx").bind(token).all<{ idx: number; data: string }>();
      // A concurrent commit may have replaced (and deleted) these chunks after we read the pointer: if so, read the pointer again.
      if (results.length === count && results.every((r, i) => r.idx === i)) return { json: results.map((r) => r.data).join(""), version: row.version };
    }
    throw new Error("Could not read a consistent copy of the data; please retry.");
  }

  async save(json: string, expected: number) {
    await this.init();
    let stored = json, token: string | null = null;
    if (json.length > INLINE_MAX) {
      token = crypto.randomUUID().replace(/-/g, ""); const parts = Math.ceil(json.length / CHUNK_SIZE), now = Date.now();
      for (let i = 0; i < parts; i++) await this.db.prepare("INSERT INTO app_state_chunks (token, idx, data, at) VALUES (?, ?, ?, ?)").bind(token, i, json.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE), now).run();
      stored = `${MARK}${token}:${parts}`;
    }
    const previous = expected === 0 ? null : await this.db.prepare("SELECT json FROM app_state WHERE id = 1").bind().first<{ json: string }>();
    let won: boolean;
    if (expected === 0) won = (await this.db.prepare("INSERT OR IGNORE INTO app_state (id, version, json) VALUES (1, 1, ?)").bind(stored).run()).meta.changes === 1;
    else won = (await this.db.prepare("UPDATE app_state SET json = ?, version = version + 1 WHERE id = 1 AND version = ?").bind(stored, expected).run()).meta.changes === 1;
    if (won) { const old = previous?.json?.startsWith(MARK) ? previous.json.slice(MARK.length).split(":")[0] : undefined; if (old && old !== token) await this.dropChunks(old); }
    else if (token) await this.dropChunks(token); // lost the race: our chunks were never referenced
    return won;
  }

  private async dropChunks(token: string) { await this.db.prepare("DELETE FROM app_state_chunks WHERE token = ?").bind(token).run(); }

  /** Deletes unreferenced chunk rows older than ORPHAN_AGE_MS (left by a Worker that died mid-write). Returns how many rows were removed. */
  async cleanup(now = Date.now()): Promise<number> {
    await this.init();
    const row = await this.db.prepare("SELECT json FROM app_state WHERE id = 1").bind().first<{ json: string }>();
    const live = row?.json?.startsWith(MARK) ? row.json.slice(MARK.length).split(":")[0] ?? "" : "";
    return (await this.db.prepare("DELETE FROM app_state_chunks WHERE token <> ? AND at < ?").bind(live, now - ORPHAN_AGE_MS).run()).meta.changes;
  }
}
