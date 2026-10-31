import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// Runs under `bun test` (uses bun:sqlite). Vitest skips this file via vitest.config exclude.
const sql = readFileSync(new URL("../../db/migrations/0001_init.sql", import.meta.url), "utf8");
const fresh = () => { const db = new Database(":memory:"); db.exec(sql); return db; };

describe("schema", () => {
  test("migration applies cleanly", () => { expect(() => fresh()).not.toThrow(); });
  test("rejects negative stock and over-reservation", () => {
    const db = fresh();
    db.exec("INSERT INTO categories (id,slug,name) VALUES ('c','c','C'); INSERT INTO products (id,slug,name,primary_category_id) VALUES ('p','p','P','c');");
    expect(() => db.exec("INSERT INTO product_variants (id,product_id,sku,name,on_hand) VALUES ('v','p','S','V',-1)")).toThrow();
    expect(() => db.exec("INSERT INTO product_variants (id,product_id,sku,name,on_hand,reserved) VALUES ('v','p','S','V',1,2)")).toThrow();
    db.exec("INSERT INTO product_variants (id,product_id,sku,name,on_hand,reserved) VALUES ('v','p','S','V',5,2)");
  });
  test("invalid availability status rejected", () => {
    const db = fresh();
    db.exec("INSERT INTO categories (id,slug,name) VALUES ('c','c','C')");
    expect(() => db.exec("INSERT INTO products (id,slug,name,primary_category_id,availability) VALUES ('p','p','P','c','bogus')")).toThrow();
  });
  test("duplicate payment webhook event is rejected by the database", () => {
    const db = fresh();
    db.exec("INSERT INTO payment_events (provider,event_id,outcome) VALUES ('x','e1','applied')");
    expect(() => db.exec("INSERT INTO payment_events (provider,event_id,outcome) VALUES ('x','e1','applied')")).toThrow();
  });
  test("audit log is append-only", () => {
    const db = fresh();
    db.exec("INSERT INTO audit_logs (event) VALUES ('a')");
    expect(() => db.exec("UPDATE audit_logs SET event='b'")).toThrow();
    expect(() => db.exec("DELETE FROM audit_logs")).toThrow();
  });
  test("admin setup is a single row; fixed discount requires currency; idempotency key unique", () => {
    const db = fresh();
    expect(() => db.exec("INSERT INTO admin_setup (id) VALUES (2)")).toThrow();
    expect(() => db.exec("INSERT INTO discounts (code,kind,value) VALUES ('X','fixed',100)")).toThrow();
    const o = (id: string) => `INSERT INTO orders (id,ref,idempotency_key,currency,subtotal,total,shipping_address_json) VALUES ('${id}','R${id}','same','GHS',1,1,'{}')`;
    db.exec(o("1")); expect(() => db.exec(o("2"))).toThrow();
  });
});
