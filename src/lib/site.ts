/** Public business details (contact, address, registration) from GET /api/site. Fields the owner hasn't set are absent and never shown. */
import { useEffect, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import type { BusinessInfo } from "@/lib/business";

let state: { status: "idle" | "loading" | "ready"; info: BusinessInfo } = { status: "idle", info: {} };
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => state;
const set = (next: typeof state) => { state = next; listeners.forEach((l) => l()); };
async function load() { set({ ...state, status: "loading" }); const r = await api.site(); set({ status: "ready", info: r.ok && r.data ? r.data : {} }); }

export function useSite(): BusinessInfo {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => { if (s.status === "idle") void load(); }, [s.status]);
  return s.info;
}
