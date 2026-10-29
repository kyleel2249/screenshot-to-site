import { Database } from "bun:sqlite";
import { describe, expect, test } from "vitest";
import { SEED_CATEGORIES } from "../lib/domain/categories";
import { MemoryDb } from "../server/db";
import { deserialize, serialize } from "../server/persistence/serialize";
import { D1Persistence, type D1Like } from "../server/persistence/sql";
import { ConflictError, MemoryPersistence, transact, type Persistence } from "../server/persistence/transact";
import { createProduct } from "../server/services/catalog-admin";
import { placeOrder } from "../server/services/orders";
import type { Actor } from "../server/rbac";

const owner: Actor = { id: "s1", kind: "staff", roles: ["owner"], recentAuthAt: Date.now() };
const addr = { recipient: "R", region: "Greater Accra", city: "Accra", street: "1 St" };

function fakeD1(): D1Like {
  const sqlite = new Database(":memory:");
  return {
    exec: async (sql) => { sqlite.exec(sql); },
    prepare: (sql) => ({ bind: (...v) => ({
      first: async <T,>() => (sqlite.query(sql).get(...(v as never[])) as T | null) ?? null,
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
