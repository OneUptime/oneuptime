import SessionIdentity, {
  SessionRotationDecision,
  SessionRotationReason,
  StoredSessionState,
} from "Common/Utils/Rum/SessionIdentity";
import UrlScrubber from "Common/Utils/Rum/UrlScrubber";

/*
 * Browser-side session and tab identity.
 *
 * All of the *decisions* (rollover, duration cap, corrupt-state handling)
 * live in Common/Utils/Rum/SessionIdentity so they are shared with, and
 * tested independently of, the browser. This file owns only storage: which
 * key, which storage area, and what to do when the storage area throws.
 *
 * Every storage access is wrapped. localStorage throws outright in Safari
 * private browsing and when a user has blocked site data, and an exception
 * escaping from here would take down the customer's page — which is the
 * one outcome a RUM recorder may never cause.
 */

const SESSION_STORAGE_KEY: string = "oneuptime.replay.session";
const TAB_STORAGE_KEY: string = "oneuptime.replay.tab";
const CHUNK_INDEX_STORAGE_KEY: string = "oneuptime.replay.chunkIndex";
const RELOAD_LOG_STORAGE_KEY: string = "oneuptime.replay.reloads";

/* Refresh rage: 3+ reloads of the same scrubbed pathname inside a minute. */
const REFRESH_RAGE_WINDOW_MS: number = 60 * 1000;
const REFRESH_RAGE_THRESHOLD: number = 3;

/* Bound on the reload log so a long-lived tab cannot grow it without limit. */
const MAX_RELOAD_LOG_ENTRIES: number = 12;

export interface SessionIdentityState {
  sessionId: string;
  tabId: string;
  sessionStartUnixMs: number;
  previousSessionId?: string;
  rotationReason?: SessionRotationReason;
}

interface ReloadLogEntry {
  path: string;
  atUnixMs: number;
}

export default class SessionId {
  /*
   * 32 lowercase hex characters, matching the sessionId column width on
   * RumSessionV1. crypto.getRandomValues is used when available; the
   * Math.random fallback exists only for ancient or locked-down browsers
   * and is documented as such because a collision there costs us a merged
   * recording, not a security boundary.
   */
  public static generateId(): string {
    const bytes: Uint8Array = new Uint8Array(16);

    const cryptoRef: Crypto | undefined =
      typeof globalThis !== "undefined"
        ? (globalThis.crypto as Crypto | undefined)
        : undefined;

    if (cryptoRef && typeof cryptoRef.getRandomValues === "function") {
      cryptoRef.getRandomValues(bytes);
    } else {
      for (let i: number = 0; i < bytes.length; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }

    let out: string = "";

    for (let i: number = 0; i < bytes.length; i++) {
      const byte: number | undefined = bytes[i];
      out += (byte === undefined ? 0 : byte).toString(16).padStart(2, "0");
    }

    return out;
  }

  /*
   * Would the CURRENT stored state rotate right now?
   *
   * Exposed separately from resolveSession so a live recorder can ask the
   * question on its flush timer without also minting a new id as a side
   * effect. Before this existed, the only callers of resolveSession were the
   * constructor and the bfcache restore, so neither the 30 minute idle
   * rollover nor the 4 hour duration cap could ever fire while the recorder
   * was alive - a dashboard tab left open all day accumulated one sessionId
   * and one unbounded chunk sequence, which is exactly what the cap exists to
   * prevent.
   */
  public static shouldRotate(nowUnixMs: number): SessionRotationDecision {
    return SessionIdentity.shouldRotateSession(
      SessionId.readStoredSession(),
      nowUnixMs,
    );
  }

  /*
   * Resolve the session id, rotating when SessionIdentity says to.
   *
   * previousSessionId and rotationReason are returned (and later reported)
   * so a support engineer looking at two adjacent 20-minute sessions can
   * tell "the user went to lunch" from "the recorder lost its state".
   */
  public static resolveSession(
    nowUnixMs: number,
    tabId: string,
  ): SessionIdentityState {
    const stored: StoredSessionState | null = SessionId.readStoredSession();

    const decision: SessionRotationDecision =
      SessionIdentity.shouldRotateSession(stored, nowUnixMs);

    if (!decision.shouldRotate && stored) {
      SessionId.writeStoredSession({
        sessionId: stored.sessionId,
        sessionStartUnixMs: stored.sessionStartUnixMs,
        lastActivityUnixMs: nowUnixMs,
      });

      return {
        sessionId: stored.sessionId,
        tabId: tabId,
        sessionStartUnixMs: stored.sessionStartUnixMs,
      };
    }

    const sessionId: string = SessionId.generateId();

    SessionId.writeStoredSession({
      sessionId: sessionId,
      sessionStartUnixMs: nowUnixMs,
      lastActivityUnixMs: nowUnixMs,
    });

    /*
     * A rotated session starts its own chunk sequence. This matters on a
     * bfcache restore or an idle rollover, where the session id changes
     * while the tab id does not: without the reset the new session's first
     * chunk would claim an index the finalizer then reports as preceded by
     * missing chunks.
     */
    SessionId.resetChunkIndex(tabId);

    const state: SessionIdentityState = {
      sessionId: sessionId,
      tabId: tabId,
      sessionStartUnixMs: nowUnixMs,
    };

    if (stored && stored.sessionId) {
      state.previousSessionId = stored.sessionId;
    }

    if (decision.reason) {
      state.rotationReason = decision.reason;
    }

    return state;
  }

  /*
   * The tab id is regenerated on EVERY recorder init, never reused from
   * sessionStorage.
   *
   * sessionStorage is COPIED when a tab is duplicated, so reusing the
   * stored value would give two concurrently recording tabs the same id.
   * Both would then mint chunk indexes under one (sessionId, tabId)
   * sort-key prefix and read-time dedup would silently discard one tab's
   * entire stream. It is still written to storage so the previous value can
   * be reported, and so the chunk counter can be scoped to it.
   */
  public static rotateTabId(): string {
    const tabId: string = SessionId.generateId();

    SessionId.writeSessionStorage(TAB_STORAGE_KEY, tabId);

    return tabId;
  }

  public static readTabId(): string | null {
    return SessionId.readSessionStorage(TAB_STORAGE_KEY);
  }

  public static touch(nowUnixMs: number): void {
    const stored: StoredSessionState | null = SessionId.readStoredSession();

    if (!stored) {
      return;
    }

    SessionId.writeStoredSession({
      sessionId: stored.sessionId,
      sessionStartUnixMs: stored.sessionStartUnixMs,
      lastActivityUnixMs: nowUnixMs,
    });
  }

  /*
   * Chunk indexes are counted per tab id and held in sessionStorage rather
   * than in memory, so a recorder that is torn down and re-created inside
   * the same page instance (a framework remount, a consent re-grant) does
   * not reuse an index it has already posted. Scoping the key to the tab id
   * is what makes a duplicated tab start cleanly at 0 instead of inheriting
   * the copied counter.
   */
  public static getNextChunkIndex(tabId: string): number {
    const next: number = SessionId.peekChunkIndex(tabId);

    SessionId.highWaterChunkIndex.set(tabId, next + 1);

    SessionId.writeSessionStorage(
      SessionId.getChunkIndexKey(tabId),
      String(next + 1),
    );

    return next;
  }

  public static peekChunkIndex(tabId: string): number {
    const raw: string | null = SessionId.readSessionStorage(
      SessionId.getChunkIndexKey(tabId),
    );

    const parsed: number = raw === null ? 0 : Number.parseInt(raw, 10);

    const stored: number = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;

    /*
     * NEVER go backwards within a live recorder.
     *
     * The counter lives in sessionStorage so a recorder torn down and
     * re-created inside the same page (a framework remount, a consent
     * re-grant) does not reuse an index it has already posted. But
     * sessionStorage is not ours: a host page that calls
     * sessionStorage.clear() - which plenty do on sign-out - resets the
     * counter under a recorder that is still running, and the next chunk
     * goes out as index 0 again.
     *
     * That is not a duplicate, it is a DELETION. The chunk table is a
     * ReplacingMergeTree keyed on (projectId, sessionId, tabId, chunkIndex)
     * with the ingest timestamp as the version, so the second index 0
     * REPLACES the first - and index 0 is the chunk that carries the
     * session's opening full snapshot. The recording becomes unplayable
     * from its own start, with nothing anywhere reporting a problem.
     *
     * The in-memory high-water mark is the source of truth while the
     * recorder is alive; storage is only ever allowed to move it forward.
     */
    const inMemory: number = SessionId.highWaterChunkIndex.get(tabId) ?? 0;

    return Math.max(stored, inMemory);
  }

  public static resetChunkIndex(tabId: string): void {
    SessionId.highWaterChunkIndex.delete(tabId);
    SessionId.writeSessionStorage(SessionId.getChunkIndexKey(tabId), "0");
  }

  /*
   * Highest index this process has already handed out, per tab. See
   * peekChunkIndex for why storage alone is not enough.
   *
   * Keyed by tab because the chunk counter is. A session rollover REUSES the
   * tab id, and starts clean only because resolveSession calls
   * resetChunkIndex, which deletes the entry - do not remove that call on
   * the strength of the key shape.
   */
  private static readonly highWaterChunkIndex: Map<string, number> = new Map<
    string,
    number
  >();

  private static getChunkIndexKey(tabId: string): string {
    return `${CHUNK_INDEX_STORAGE_KEY}.${tabId}`;
  }

  /*
   * Record this page load and report how many loads of the SAME scrubbed
   * path happened inside the refresh-rage window.
   *
   * Lives here rather than in FrustrationDetector because it is the one
   * frustration signal that must survive a page load, which makes it a
   * storage concern.
   */
  public static recordPageLoad(rawUrl: string, nowUnixMs: number): number {
    const path: string = UrlScrubber.getScrubbedPathname(rawUrl);

    const log: Array<ReloadLogEntry> = SessionId.readReloadLog().filter(
      (entry: ReloadLogEntry): boolean => {
        return nowUnixMs - entry.atUnixMs <= REFRESH_RAGE_WINDOW_MS;
      },
    );

    log.push({ path: path, atUnixMs: nowUnixMs });

    const trimmed: Array<ReloadLogEntry> = log.slice(-MAX_RELOAD_LOG_ENTRIES);

    SessionId.writeReloadLog(trimmed);

    return trimmed.filter((entry: ReloadLogEntry): boolean => {
      return entry.path === path;
    }).length;
  }

  public static isRefreshRage(loadCountInWindow: number): boolean {
    return loadCountInWindow >= REFRESH_RAGE_THRESHOLD;
  }

  /*
   * Drop every trace of the recorder's identity state. Called on
   * revokeConsent(): a user who withdraws consent must not be re-linked to
   * the same session id when they come back.
   */
  public static clearAll(): void {
    SessionId.removeLocalStorage(SESSION_STORAGE_KEY);
    SessionId.removeLocalStorage(RELOAD_LOG_STORAGE_KEY);
    SessionId.removeSessionStorage(TAB_STORAGE_KEY);

    /*
     * The in-memory high-water marks go too. clearAll is "forget this
     * session entirely" - a consent revocation or a stop() - and a counter
     * that outlived it would push the NEXT session's first chunk past index
     * 0, leaving its opening full snapshot at an index the player's seek
     * anchors do not expect.
     */
    SessionId.highWaterChunkIndex.clear();

    try {
      const keys: Array<string> = [];

      for (let i: number = 0; i < window.sessionStorage.length; i++) {
        const key: string | null = window.sessionStorage.key(i);

        if (key && key.startsWith(CHUNK_INDEX_STORAGE_KEY)) {
          keys.push(key);
        }
      }

      for (const key of keys) {
        SessionId.removeSessionStorage(key);
      }
    } catch {
      /* See writeLocalStorage. */
    }
  }

  private static readStoredSession(): StoredSessionState | null {
    const raw: string | null = SessionId.readLocalStorage(SESSION_STORAGE_KEY);

    if (!raw) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(raw);

      if (!parsed || typeof parsed !== "object") {
        return null;
      }

      const record: Record<string, unknown> = parsed as Record<string, unknown>;

      const sessionId: unknown = record["sessionId"];
      const sessionStartUnixMs: unknown = record["sessionStartUnixMs"];
      const lastActivityUnixMs: unknown = record["lastActivityUnixMs"];

      if (
        typeof sessionId !== "string" ||
        typeof sessionStartUnixMs !== "number" ||
        typeof lastActivityUnixMs !== "number"
      ) {
        return null;
      }

      return {
        sessionId: sessionId,
        sessionStartUnixMs: sessionStartUnixMs,
        lastActivityUnixMs: lastActivityUnixMs,
      };
    } catch {
      /* Unparseable state rotates rather than being repaired. */
      return null;
    }
  }

  private static writeStoredSession(state: StoredSessionState): void {
    SessionId.writeLocalStorage(SESSION_STORAGE_KEY, JSON.stringify(state));
  }

  private static readReloadLog(): Array<ReloadLogEntry> {
    const raw: string | null = SessionId.readLocalStorage(
      RELOAD_LOG_STORAGE_KEY,
    );

    if (!raw) {
      return [];
    }

    try {
      const parsed: unknown = JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .filter((entry: unknown): boolean => {
          if (!entry || typeof entry !== "object") {
            return false;
          }

          const record: Record<string, unknown> = entry as Record<
            string,
            unknown
          >;

          return (
            typeof record["path"] === "string" &&
            typeof record["atUnixMs"] === "number"
          );
        })
        .map((entry: unknown): ReloadLogEntry => {
          const record: Record<string, unknown> = entry as Record<
            string,
            unknown
          >;

          return {
            path: record["path"] as string,
            atUnixMs: record["atUnixMs"] as number,
          };
        });
    } catch {
      return [];
    }
  }

  private static writeReloadLog(log: Array<ReloadLogEntry>): void {
    SessionId.writeLocalStorage(RELOAD_LOG_STORAGE_KEY, JSON.stringify(log));
  }

  private static readLocalStorage(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private static writeLocalStorage(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /*
       * Storage denied or quota exceeded. Swallowed on purpose: the
       * recorder degrades to a per-page-load session rather than throwing
       * inside the host page.
       */
    }
  }

  private static removeLocalStorage(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* See writeLocalStorage. */
    }
  }

  private static readSessionStorage(key: string): string | null {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private static writeSessionStorage(key: string, value: string): void {
    try {
      window.sessionStorage.setItem(key, value);
    } catch {
      /* See writeLocalStorage. */
    }
  }

  private static removeSessionStorage(key: string): void {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      /* See writeLocalStorage. */
    }
  }
}
