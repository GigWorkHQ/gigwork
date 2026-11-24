import * as SecureStore from "expo-secure-store";

// The device session from pairing, kept in Android Keystore-backed storage. It is the only credential the app has.
export type Session = { token: string; expiresAt: string; sessionId: string; walletAddress: string; handle: string | null };
const KEY = "gigwork.session.v1";

export async function loadSession(): Promise<Session | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    if (!session.token || new Date(session.expiresAt) <= new Date()) { await clearSession(); return null; }
    return session;
  } catch { return null; }
}
export const saveSession = (session: Session) => SecureStore.setItemAsync(KEY, JSON.stringify(session));
export const clearSession = () => SecureStore.deleteItemAsync(KEY).catch(() => undefined);
