import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Session } from "./session";

// What every screen needs: the paired session, navigation and a toast.
export type Route =
  | { kind: "job"; id: string }
  | { kind: "assignment"; id: string }
  | { kind: "batch"; id: string }
  | { kind: "gig"; id: string }
  | { kind: "contract"; id: string }
  | { kind: "review"; id: string }
  | { kind: "taskBatch"; batch: any };
export type Tab = "home" | "work" | "posted" | "pay" | "account";

export type AppState = {
  session: Session;
  profile: any | null;
  reloadProfile: () => void;
  go: (route: Route) => void;
  back: () => void;
  setTab: (tab: Tab) => void;
  notify: (message: string) => void;
  unpair: () => Promise<void>;
};
export const AppContext = createContext<AppState | null>(null);
export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp outside AppContext");
  return value;
}

/** Load data for a screen, with pull-to-refresh and a stale-response guard. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);
  const run = useCallback(async (asRefresh = false) => {
    const mine = ++generation.current;
    if (asRefresh) setRefreshing(true);
    try {
      const result = await load();
      if (mine === generation.current) { setData(result); setError(null); }
    } catch (e) {
      if (mine === generation.current) setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      if (mine === generation.current) setRefreshing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void run(); }, [run]);
  return { data, error, refreshing, reload: () => run(true) };
}
