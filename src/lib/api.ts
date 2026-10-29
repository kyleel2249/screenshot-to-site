import { createClient } from "./api-client";
/** Browser singleton. Same-origin, cookie-based; never holds tokens in JS. */
export const api = createClient();
export const newIdempotencyKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`);
