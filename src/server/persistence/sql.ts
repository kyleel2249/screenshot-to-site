import type { Persistence } from "./transact";

export const STATE_DDL = "CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, json TEXT NOT NULL)";

/** Minimal structural subset of Cloudflare D1, so this compiles without @cloudflare/workers-types. */
export interface D1Like {
  prepare(sql: string): { bind(...v: unknown[]): { first<T>(): Promise<T | null>; run(): Promise<{ meta: { changes: number } }> } };
  exec(sql: string): Promise<unknown>;
}

/** Works with Cloudflare D1 (and anything exposing the same surface). The UPDATE ... WHERE version = ? is the compare-and-swap. */
export class D1Persistence implements Persistence {
  private ready = false;
  constructor(private db: D1Like) {}
  private async init() { if (!this.ready) { await this.db.exec(STATE_DDL); this.ready = true; } }
  async load() {
    await this.init();
    const row = await this.db.prepare("SELECT version, json FROM app_state WHERE id = 1").bind().first<{ version: number; json: string }>();
    return row ? { json: row.json, version: row.version } : { json: null, version: 0 };
  }
  async save(json: string, expected: number) {
    await this.init();
    if (expected === 0) { // first write: INSERT OR IGNORE then check it landed
      const r = await this.db.prepare("INSERT OR IGNORE INTO app_state (id, version, json) VALUES (1, 1, ?)").bind(json).run();
      return r.meta.changes === 1;
    }
    const r = await this.db.prepare("UPDATE app_state SET json = ?, version = version + 1 WHERE id = 1 AND version = ?").bind(json, expected).run();
    return r.meta.changes === 1;
  }
}
