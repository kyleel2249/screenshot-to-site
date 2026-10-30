import { describe, expect, test } from "vitest";
import { buildMessage, createMailer } from "../server/mailer";

const env = { SITE_ORIGIN: "https://shop.test/", EMAIL_API_KEY: "key_123", EMAIL_FROM: "Dera Darko Trade <no-reply@shop.test>" };

describe("mailer", () => {
  test("links point at the configured site, encode the token, and html is escaped", () => {
    for (const [t, path] of [["verify_email", "/verify-email"], ["owner_verify", "/verify-email"], ["password_reset", "/reset-password"], ["staff_invite", "/accept-invite"]] as const) {
      const m = buildMessage(env, "a@x.com", t, "a b&c");
      expect(m.text).toContain(`https://shop.test${path}?token=a%20b%26c`); expect(m.html).toContain(`href="https://shop.test${path}?token=a%20b%26c"`); expect(m.subject).toMatch(/Dera Darko Trade/);
    }
    expect(buildMessage(env, "a@x.com", "password_reset", `"><script>`).html).not.toContain("<script>");
  });
  test("not configured → no mailer; configured → authenticated POST with message", async () => {
    expect(createMailer({ SITE_ORIGIN: "https://s" })).toBeUndefined();
    let seen: { url: string; init: RequestInit } | undefined;
    const mail = createMailer(env, async (url, init) => { seen = { url, init }; return new Response("{}", { status: 200 }); })!;
    await mail("u@x.com", "verify_email", { token: "tok" });
    expect(seen!.url).toBe("https://api.resend.com/emails");
    expect((seen!.init.headers as Record<string, string>)["Authorization"]).toBe("Bearer key_123");
    const body = JSON.parse(seen!.init.body as string); expect(body).toMatchObject({ to: ["u@x.com"], from: env.EMAIL_FROM }); expect(body.text).toContain("tok");
  });
  test("provider errors and network failures never throw and never log the token", async () => {
    const logs: string[] = [];
    await createMailer(env, async () => new Response("no", { status: 500 }), (m) => logs.push(m))!("u@x.com", "staff_invite", { token: "SECRET-TOKEN" });
    await createMailer(env, async () => { throw new Error("down SECRET-TOKEN"); }, (m) => logs.push(m))!("u@x.com", "password_reset", { token: "SECRET-TOKEN" });
    expect(logs).toHaveLength(2); expect(logs.join(" ")).not.toContain("SECRET-TOKEN");
  });
});
