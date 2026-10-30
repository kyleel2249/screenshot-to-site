/**
 * Saved items for signed-in customers. One shared store so every heart button on a page stays in step. Guests see a prompt to sign in
 * (nothing is stored for them). Changes are optimistic and roll back if the server refuses.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { api } from "@/lib/api";

type State = { status: "idle" | "loading" | "ready" | "guest"; slugs: ReadonlySet<string>; error: string };
let state: State = { status: "idle", slugs: new Set(), error: "" };
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => { state = { ...state, ...next }; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => state;

async function load() {
  if (state.status === "loading") return;
  set({ status: "loading" });
  const r = await api.wishlist();
  if (r.status === 401) set({ status: "guest", slugs: new Set() });
  else if (r.ok && r.data) set({ status: "ready", slugs: new Set(r.data), error: "" });
  else set({ status: "ready", error: r.errors[0] ?? "Couldn't load your saved items." });
}
async function toggle(slug: string): Promise<boolean> {
  const was = state.slugs.has(slug), next = new Set(state.slugs);
  if (was) next.delete(slug); else next.add(slug);
  set({ slugs: next, error: "" });
  const r = await api.setWishlist(slug, !was);
  if (r.status === 401) { set({ status: "guest", slugs: new Set() }); return false; }
  if (!r.ok) { const back = new Set(state.slugs); if (was) back.add(slug); else back.delete(slug); set({ slugs: back, error: r.errors[0] ?? "That didn't save. Please try again." }); return false; }
  return true;
}
/** Call after sign-out so the next person on this browser never sees someone else's list. */
export const resetWishlist = () => set({ status: "idle", slugs: new Set(), error: "" });

export function useWishlist() {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => { if (s.status === "idle") void load(); }, [s.status]);
  const has = useCallback((slug: string) => s.slugs.has(slug), [s.slugs]);
  return { status: s.status, slugs: s.slugs, error: s.error, has, toggle, signedIn: s.status === "ready" };
}
