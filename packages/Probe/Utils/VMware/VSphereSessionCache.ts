import crypto from "crypto";

/*
 * vCenter sessions the probe keeps between collections.
 *
 * A collection every two minutes that logged in and out each time would
 * write two events to vCenter's event log every two minutes, for ever - the
 * VMware agent keeps one session alive instead, and so does this. A session
 * is kept per vCenter and per set of credentials (the key hashes the
 * address, user name, password and trusted certificate, so a changed
 * password or certificate never reuses a session opened with the old ones),
 * in memory only, and forgotten after half an hour unused - vCenter's own
 * idle timeout - or when vCenter refuses it.
 */

export const SESSION_IDLE_TIMEOUT_IN_MS: number = 30 * 60 * 1000;
export const MAX_CACHED_SESSIONS: number = 500;

interface CachedSession {
  cookie: string;
  lastUsedAt: number;
}

export function getSessionKey(data: {
  vmwareVCenterId: string;
  vcenterUrl: string;
  username: string;
  password: string;
  trustedFingerprint: string | null;
}): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify([
        data.vmwareVCenterId,
        data.vcenterUrl,
        data.username,
        data.password,
        data.trustedFingerprint || "",
      ]),
    )
    .digest("hex");
}

export default class VSphereSessionCache {
  private static sessions: Map<string, CachedSession> = new Map();

  public static get(key: string, now: number = Date.now()): string | null {
    const session: CachedSession | undefined = this.sessions.get(key);

    if (!session) {
      return null;
    }

    if (now - session.lastUsedAt > SESSION_IDLE_TIMEOUT_IN_MS) {
      this.sessions.delete(key);
      return null;
    }

    return session.cookie;
  }

  public static set(key: string, cookie: string, now: number = Date.now()): void {
    this.sessions.delete(key);
    this.sessions.set(key, { cookie: cookie, lastUsedAt: now });

    // The oldest go first: a Map iterates in insertion order.
    while (this.sessions.size > MAX_CACHED_SESSIONS) {
      const oldest: string | undefined = this.sessions.keys().next().value;

      if (oldest === undefined) {
        break;
      }

      this.sessions.delete(oldest);
    }
  }

  public static forget(key: string): void {
    this.sessions.delete(key);
  }

  // Exported for tests.
  public static clear(): void {
    this.sessions.clear();
  }

  public static size(): number {
    return this.sessions.size;
  }
}
