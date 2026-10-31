import { Database } from "bun:sqlite";
import { describe, expect, test } from "vitest";
import { SEED_CATEGORIES } from "../lib/domain/categories";
import { MemoryDb } from "../server/db";
import { deserialize, serialize } from "../server/persistence/serialize";
import { CHUNK_SIZE, D1Persistence, INLINE_MAX, ORPHAN_AGE_MS, type D1Like } from "../server/persistence/sql";
import { ConflictError, MemoryPersistence, transact, type Persistence } from "../server/persistence/transact";
import { createProduct } from "../server/services/catalog-admin";
import { placeOrder } from "../server/services/orders";
import type { Actor } from "../server/rbac";

const owner: Actor = { id: "s1", kind: "staff", roles: ["owner"], recentAuthAt: Date.now() };
const addr = { recipient: "R", region: "Greater Accra", city: "Accra", street: "1 St" };

function fakeD1(sqlite = new Database(":memory:")): D1Like {
  return {
    exec: async (sql) => { sqlite.exec(sql); },
    prepare: (sql) => ({ bind: (...v) => ({
      first: async <T,>() => (sqlite.query(sql).get(...(v as never[])) as T | null) ?? null,
      all: async <T,>() => ({ results: sqlite.query(sql).all(...(v as never[])) as T[] }),
      run: async () => { const r = sqlite.query(sql).run(...(v as never[])); return { meta: { changes: r.changes } }; },
    }) }),
  };
}

async function seed(p: Persistence, stock: number) {
  await transact(p, (db) => {
    db.categories = [...SEED_CATEGORIES];
    db.zones.set("z", { id: "z", name: "z", regions: ["Greater Accra"], currency: "GHS", baseFee: 0, perKgFee: 0, estimate: "est" });
    createProduct(db, owner, { name: "Last One", categoryId: "cat-cars", shortDescription: "s", image: "i", imageAlt: "a", sku: "S", priceGhs: 1000, onHand: stock, published: true });
  });
  return (await transact(p, (db) => [...db.variants.keys()][0]!));
}
const buy = (p: Persistence, variantId: string, key: string) => transact(p, (db) => placeOrder(db, { guestEmail: "g@x.com", lines: [{ variantId, qty: 1 }], currency: "GHS", region: "Greater Accra", address: addr, idempotencyKey: key, acceptedTerms: true, zoneId: "z" }));

describe("serialization", () => {
  test("Maps, Sets and nested data round-trip", () => {
    const db = new MemoryDb(); db.categories = [...SEED_CATEGORIES]; db.wishlist.set("u", new Set(["a", "b"])); db.settings["x"] = "y";
    const back = deserialize(serialize(db));
    expect(back.wishlist.get("u")).toEqual(new Set(["a", "b"])); expect(back.categories.length).toBe(db.categories.length); expect(back.settings["x"]).toBe("y");
    expect(back.nextId("t")).toMatch(/^t_/);
  });
});

for (const [name, make] of [["memory", () => new MemoryPersistence() as Persistence], ["D1/SQLite", () => new D1Persistence(fakeD1()) as Persistence]] as const) {
  describe(`transactional persistence (${name})`, () => {
    test("state persists between transactions", async () => {
      const p = make(); const v = await seed(p, 3);
      expect(await transact(p, (db) => db.variants.get(v)!.onHand)).toBe(3);
    });
    test("10 concurrent buyers of the LAST unit: exactly one succeeds, no oversell", async () => {
      const p = make(); const v = await seed(p, 1);
      const results = await Promise.all(Array.from({ length: 10 }, (_, i) => buy(p, v, `k${i}`)));
      expect(results.filter((r) => r.ok).length).toBe(1);
      const state = await transact(p, (db) => ({ reserved: db.variants.get(v)!.reserved, orders: db.orders.size }));
      expect(state).toEqual({ reserved: 1, orders: 1 });
    });
    test("concurrent double-submit with the same idempotency key creates one order", async () => {
      const p = make(); const v = await seed(p, 5);
      const rs = await Promise.all(Array.from({ length: 6 }, () => buy(p, v, "same")));
      expect(rs.every((r) => r.ok)).toBe(true);
      expect(await transact(p, (db) => db.orders.size)).toBe(1);
      expect(await transact(p, (db) => db.variants.get(v)!.reserved)).toBe(1);
    });
    test("read-only transactions don't write (version unchanged)", async () => {
      const p = make(); await seed(p, 1); const before = (await p.load()).version;
      await transact(p, (db) => db.orders.size); expect((await p.load()).version).toBe(before);
    });
  });
}

test("stale writer loses compare-and-swap; persistent conflicts surface as ConflictError", async () => {
  const p = new D1Persistence(fakeD1());
  expect(await p.save("{}", 0)).toBe(true);
  expect(await p.save("{}", 0)).toBe(false); // second first-writer loses
  expect(await p.save('{"a":1}', 1)).toBe(true);
  expect(await p.save('{"a":2}', 1)).toBe(false); // stale version
  const always: Persistence = { load: async () => ({ json: null, version: 0 }), save: async () => false };
  await expect(transact(always, (db) => { db.settings["k"] = "v"; }, 2)).rejects.toBeInstanceOf(ConflictError);
});

describe("large state is chunked under the D1 row limit", () => {
  const big = (n: number) => JSON.stringify({ pad: "x".repeat(n) });
  const rows = (sq: Database) => (sq.query("SELECT COUNT(*) AS n FROM app_state_chunks").get() as { n: number }).n;
  test("small state stays inline; large state round-trips across chunks; shrinking cleans the old chunks", async () => {
    const sq = new Database(":memory:"); const p = new D1Persistence(fakeD1(sq));
    expect(await p.save(big(1000), 0)).toBe(true); expect(rows(sq)).toBe(0); expect((await p.load()).json).toBe(big(1000));
    const huge = big(INLINE_MAX * 3 + 123); // ~2.1 MB, which a single D1 row could not hold
    expect(await p.save(huge, 1)).toBe(true); const l = await p.load(); expect(l.json).toBe(huge); expect(l.version).toBe(2);
    expect(rows(sq)).toBe(Math.ceil(huge.length / CHUNK_SIZE)); expect((sq.query("SELECT MAX(LENGTH(data)) AS m FROM app_state_chunks").get() as { m: number }).m).toBeLessThanOrEqual(CHUNK_SIZE);
    const huge2 = big(INLINE_MAX * 2); expect(await p.save(huge2, 2)).toBe(true); expect((await p.load()).json).toBe(huge2); expect(rows(sq)).toBe(Math.ceil(huge2.length / CHUNK_SIZE)); // old generation removed
    expect(await p.save(big(10), 3)).toBe(true); expect(rows(sq)).toBe(0); expect((await p.load()).json).toBe(big(10)); // back to inline
  });
  test("first write of large state works; a lost race leaves no orphan chunks and the winner's state intact", async () => {
    const sq = new Database(":memory:"); const a = new D1Persistence(fakeD1(sq)), b = new D1Persistence(fakeD1(sq));
    const A = big(INLINE_MAX * 2), B = big(INLINE_MAX * 2 + 7);
    expect(await a.save(A, 0)).toBe(true);
    expect(await b.save(B, 0)).toBe(false); // someone else created it first
    expect(await b.save(B, 1)).toBe(true); expect(await a.save(A, 1)).toBe(false); // stale writer loses
    expect((await a.load()).json).toBe(B); expect(rows(sq)).toBe(Math.ceil(B.length / CHUNK_SIZE));
  });
  test("a crashed write's unreferenced chunks are removed by cleanup — but only once they are old enough", async () => {
    const sq = new Database(":memory:"); const p = new D1Persistence(fakeD1(sq));
    await p.save(big(INLINE_MAX * 2), 0); const live = rows(sq);
    const now = Date.now(); sq.run("INSERT INTO app_state_chunks (token, idx, data, at) VALUES ('ghost', 0, 'x', ?)", [now]); // an in-flight write from another Worker
    expect(await p.cleanup(now + 1000)).toBe(0); expect(rows(sq)).toBe(live + 1); // too recent: leave it alone
    expect(await p.cleanup(now + ORPHAN_AGE_MS + 1)).toBe(1); expect(rows(sq)).toBe(live);
    expect((await p.load()).json).toBe(big(INLINE_MAX * 2)); // live data untouched
  });
  test("a reader that races a commit never returns a half-written state", async () => {
    const sq = new Database(":memory:"); const w = new D1Persistence(fakeD1(sq)), r = new D1Persistence(fakeD1(sq));
    let v = 0; const gens = [big(INLINE_MAX * 2 + 1), big(INLINE_MAX * 2 + 2), big(INLINE_MAX * 2 + 3)];
    const writer = (async () => { for (const g of gens) { await w.save(g, v); v++; } })();
    const seen: string[] = []; for (let i = 0; i < 12; i++) { const l = await r.load(); if (l.json) seen.push(l.json); }
    await writer; for (const j of seen) expect(gens).toContain(j);
  });
  test("transact works end to end on a state that outgrows one row", async () => {
    const sq = new Database(":memory:"); const p = new D1Persistence(fakeD1(sq));
    await transact(p, (db) => { for (let i = 0; i < 3000; i++) db.settings[`k${i}`] = "v".repeat(300); });
    expect(rows(sq)).toBeGreaterThan(1);
    expect(await transact(p, (db) => Object.keys(db.settings).length)).toBe(3001); // 3000 + displayMode
    await transact(p, (db) => { db.settings["extra"] = "1"; }); expect(await transact(p, (db) => db.settings["extra"])).toBe("1");
  });
});
