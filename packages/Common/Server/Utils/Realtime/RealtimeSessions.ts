import type { Socket } from "../../Infrastructure/SocketIO";
import logger from "../Logger";
import Dictionary from "../../../Types/Dictionary";
import EventName from "../../../Types/Realtime/EventName";
import type { RealtimeReaderIdentity } from "./RealtimeReaders";

/*
 * THE SESSION A SOCKET'S LIVE UPDATES BELONG TO.
 *
 * A socket joins rooms with the session its handshake carried: the access
 * token of the person signed in, which names their sign-in (UserSession).
 * Realtime keeps that session on the socket when a join is allowed
 * (RealtimeJoinAccess decides, as an API request is decided), and the
 * socket hears live updates only while the session lasts:
 *
 *   - until the access token expires: a timer per socket ends its live
 *     updates then, and no delivery reaches a socket past that time anyway
 *     (getSession);
 *   - until the session ends: signing out, a revoked session (a password
 *     change, a block) and a deleted account end it at once, on every
 *     server (RealtimeAccessChanges calls endWhere).
 *
 * Ending a socket's session leaves every room it joined, forgets who it
 * is, and tells the client with EventName.AuthenticationRequired. The
 * client then refreshes its session and reconnects, so its new handshake
 * carries the new session and every subscription is asked for again; when
 * the session cannot be refreshed, the refresh sends the person to sign
 * in. A socket whose session ended joins nothing more: its handshake is
 * spent.
 *
 * A session that ended is remembered for a while (wasEnded), so a join
 * that was being decided as it ended, or one made later with an access
 * token issued before it ended, is refused too.
 *
 * What is kept on the socket (socket.data) is plain JSON, so it would
 * survive an adapter that hands sockets of other servers over the wire.
 * The timers, and the sockets this server holds, are kept here.
 */

// A socket's session, as Realtime keeps it on the socket.
export interface RealtimeSocketSession extends RealtimeReaderIdentity {
  // The sign-in (UserSession) the access token was issued for.
  sessionId?: string | undefined;
  // When the access token stops being accepted, as Date.now() counts.
  expiresAtMs: number;
}

// Where the session is kept on the socket: who it is, for every delivery.
export const SESSION_OF_SOCKET_KEY: string = "realtimeReader";

// Set once the socket's session has ended: it joins nothing more.
export const SESSION_ENDED_KEY: string = "realtimeSessionEnded";

interface LiveSocket {
  socket: Socket;
  session: RealtimeSocketSession;
  timer: ReturnType<typeof setTimeout> | null;
}

// A session (or every session of a person) that ended, and when.
interface EndedEntry {
  endedAtMs: number;
}

export default class RealtimeSessions {
  /*
   * The longest one setTimeout waits (about 24.8 days). An access token
   * that lives longer is waited for in steps of this.
   */
  public static readonly MAX_TIMER_DELAY_IN_MS: number = 2_147_483_647;

  /*
   * How long an ended session is remembered: longer than an access token
   * lives (15 minutes), so every token issued before the end has expired
   * by the time it is forgotten.
   */
  public static readonly ENDED_MEMORY_IN_MS: number = 60 * 60 * 1000;

  // Ended sessions remembered at once; past this the oldest goes first.
  public static readonly MAX_ENDED_ENTRIES: number = 10_000;

  // This server's sockets with a session, by socket id.
  private static live: Map<string, LiveSocket> = new Map<string, LiveSocket>();

  // Sessions ("session:<id>") and people ("user:<id>") whose sessions ended.
  private static ended: Map<string, EndedEntry> = new Map<
    string,
    EndedEntry
  >();

  /*
   * The session a socket's live updates belong to, while it lasts: null
   * once its access token has expired or the session has ended, and for a
   * socket that never joined a room. Every delivery asks this, so a
   * socket nobody checked, or whose session is over, hears nothing.
   */
  public static getSession(
    socket: { data: unknown },
    nowMs: number = Date.now(),
  ): RealtimeSocketSession | null {
    const data: unknown = socket.data;

    if (!data || typeof data !== "object") {
      return null;
    }

    if ((data as Dictionary<unknown>)[SESSION_ENDED_KEY] === true) {
      return null;
    }

    const stored: unknown = (data as Dictionary<unknown>)[
      SESSION_OF_SOCKET_KEY
    ];

    if (!stored || typeof stored !== "object") {
      return null;
    }

    const session: Dictionary<unknown> = stored as Dictionary<unknown>;
    const userId: unknown = session["userId"];
    const expiresAtMs: unknown = session["expiresAtMs"];
    const sessionId: unknown = session["sessionId"];

    if (typeof userId !== "string" || !userId) {
      return null;
    }

    // Without a time it ends, a session is not one a socket may hear with.
    if (
      typeof expiresAtMs !== "number" ||
      !Number.isFinite(expiresAtMs) ||
      expiresAtMs <= nowMs
    ) {
      return null;
    }

    return {
      userId: userId,
      isMasterAdmin: session["isMasterAdmin"] === true,
      sessionId:
        typeof sessionId === "string" && sessionId ? sessionId : undefined,
      expiresAtMs: expiresAtMs,
    };
  }

  // Whether the socket's session has ended: it may join nothing more.
  public static hasEnded(socket: { data: unknown }): boolean {
    const data: unknown = socket.data;

    return Boolean(
      data &&
        typeof data === "object" &&
        (data as Dictionary<unknown>)[SESSION_ENDED_KEY] === true,
    );
  }

  /*
   * Keeps `session` on the socket as the one its live updates belong to,
   * and ends them when its access token expires. Called for every join
   * that is allowed: a socket's handshake carries one session, so a later
   * join only confirms it (and an earlier expiry, should one ever come,
   * wins).
   */
  public static begin(socket: Socket, session: RealtimeSocketSession): void {
    const data: Dictionary<unknown> =
      socket.data && typeof socket.data === "object"
        ? (socket.data as Dictionary<unknown>)
        : {};

    const existing: LiveSocket | undefined = RealtimeSessions.live.get(
      socket.id,
    );

    const kept: RealtimeSocketSession =
      existing && existing.socket === socket
        ? {
            ...session,
            expiresAtMs: Math.min(
              existing.session.expiresAtMs,
              session.expiresAtMs,
            ),
          }
        : session;

    socket.data = {
      ...data,
      [SESSION_OF_SOCKET_KEY]: {
        userId: kept.userId,
        isMasterAdmin: kept.isMasterAdmin,
        sessionId: kept.sessionId,
        expiresAtMs: kept.expiresAtMs,
      },
    };

    if (existing && existing.socket === socket) {
      const expiresEarlier: boolean =
        kept.expiresAtMs < existing.session.expiresAtMs;

      existing.session = kept;

      if (expiresEarlier) {
        RealtimeSessions.arm(existing);
      }

      return;
    }

    const entry: LiveSocket = { socket: socket, session: kept, timer: null };

    RealtimeSessions.live.set(socket.id, entry);
    RealtimeSessions.arm(entry);

    // A socket that goes away takes its timer with it.
    socket.on("disconnect", (): void => {
      RealtimeSessions.forget(socket);
    });
  }

  /*
   * Ends one socket's live updates: it leaves every room it joined, is no
   * longer anyone, joins nothing more, and is told why (see the top of
   * this file). Harmless on a socket whose session has already ended.
   */
  public static end(socket: Socket): void {
    const wasEnded: boolean = RealtimeSessions.hasEnded(socket);

    RealtimeSessions.forget(socket);

    const data: Dictionary<unknown> =
      socket.data && typeof socket.data === "object"
        ? { ...(socket.data as Dictionary<unknown>) }
        : {};

    delete data[SESSION_OF_SOCKET_KEY];
    data[SESSION_ENDED_KEY] = true;
    socket.data = data;

    for (const room of Array.from(socket.rooms || [])) {
      // Every socket is in a room of its own id; that one is not a subscription.
      if (room === socket.id) {
        continue;
      }

      try {
        void Promise.resolve(socket.leave(room)).catch((err: unknown) => {
          logger.error(err);
        });
      } catch (err) {
        logger.error(err);
      }
    }

    if (!wasEnded) {
      socket.emit(EventName.AuthenticationRequired, {});
    }
  }

  /*
   * Ends the live updates of this server's sockets whose session is one of
   * `sessionIds`, or whose person is `userId` (every session of theirs).
   * Returns how many were ended.
   */
  public static endWhere(match: {
    userId?: string | undefined;
    sessionIds?: Array<string> | undefined;
  }): number {
    const userId: string | undefined = match.userId
      ? match.userId.toString().trim().toLowerCase()
      : undefined;
    const sessionIds: Set<string> = new Set<string>(
      (match.sessionIds || []).map((sessionId: string): string => {
        return sessionId.toString().trim().toLowerCase();
      }),
    );

    if (!userId && sessionIds.size === 0) {
      return 0;
    }

    // Remembered first, so a join being decided right now is refused too.
    const endedAtMs: number = Date.now();

    if (userId) {
      RealtimeSessions.rememberEnded(`user:${userId}`, endedAtMs);
    }

    for (const sessionId of sessionIds) {
      RealtimeSessions.rememberEnded(`session:${sessionId}`, endedAtMs);
    }

    const ending: Array<Socket> = [];

    for (const entry of RealtimeSessions.live.values()) {
      const ofPerson: boolean = Boolean(
        userId && entry.session.userId.toLowerCase() === userId,
      );
      const ofSession: boolean = Boolean(
        entry.session.sessionId &&
          sessionIds.has(entry.session.sessionId.toLowerCase()),
      );

      if (ofPerson || ofSession) {
        ending.push(entry.socket);
      }
    }

    for (const socket of ending) {
      RealtimeSessions.end(socket);
    }

    return ending.length;
  }

  /*
   * Whether a session a socket would join with has ended: the session
   * itself was signed out or revoked, or every session of the person ended
   * (blocked, deleted) after its access token was issued. Read right
   * before a join is kept, so a join decided while the session ended is
   * refused, and so is one made later with a token from before the end.
   */
  public static wasEnded(session: {
    userId: string;
    sessionId?: string | undefined;
    // When the access token was issued, as Date.now() counts.
    issuedAtMs: number;
  }): boolean {
    const nowMs: number = Date.now();

    if (session.sessionId) {
      const ofSession: EndedEntry | undefined = RealtimeSessions.getEnded(
        `session:${session.sessionId.toString().trim().toLowerCase()}`,
        nowMs,
      );

      if (ofSession) {
        return true;
      }
    }

    const ofPerson: EndedEntry | undefined = RealtimeSessions.getEnded(
      `user:${session.userId.toString().trim().toLowerCase()}`,
      nowMs,
    );

    return Boolean(ofPerson && session.issuedAtMs <= ofPerson.endedAtMs);
  }

  // Sockets of this server with a session right now. For tests.
  public static size(): number {
    return RealtimeSessions.live.size;
  }

  // Ended sessions remembered right now. For tests.
  public static endedSize(): number {
    return RealtimeSessions.ended.size;
  }

  // Forgets every socket and ended session, and stops every timer. For tests.
  public static clear(): void {
    for (const entry of RealtimeSessions.live.values()) {
      if (entry.timer) {
        clearTimeout(entry.timer);
      }
    }

    RealtimeSessions.live.clear();
    RealtimeSessions.ended.clear();
  }

  private static rememberEnded(key: string, endedAtMs: number): void {
    // Newest last, so the cap drops the oldest first.
    RealtimeSessions.ended.delete(key);

    if (RealtimeSessions.ended.size >= RealtimeSessions.MAX_ENDED_ENTRIES) {
      const oldestKey: string | undefined = RealtimeSessions.ended
        .keys()
        .next().value;

      if (oldestKey !== undefined) {
        RealtimeSessions.ended.delete(oldestKey);
      }
    }

    RealtimeSessions.ended.set(key, { endedAtMs: endedAtMs });
  }

  private static getEnded(key: string, nowMs: number): EndedEntry | undefined {
    const entry: EndedEntry | undefined = RealtimeSessions.ended.get(key);

    if (!entry) {
      return undefined;
    }

    if (nowMs - entry.endedAtMs > RealtimeSessions.ENDED_MEMORY_IN_MS) {
      RealtimeSessions.ended.delete(key);
      return undefined;
    }

    return entry;
  }

  private static forget(socket: Socket): void {
    const entry: LiveSocket | undefined = RealtimeSessions.live.get(socket.id);

    if (!entry || entry.socket !== socket) {
      return;
    }

    if (entry.timer) {
      clearTimeout(entry.timer);
    }

    RealtimeSessions.live.delete(socket.id);
  }

  private static arm(entry: LiveSocket): void {
    if (entry.timer) {
      clearTimeout(entry.timer);
    }

    const delayMs: number = Math.min(
      Math.max(0, entry.session.expiresAtMs - Date.now()),
      RealtimeSessions.MAX_TIMER_DELAY_IN_MS,
    );

    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
      entry.timer = null;

      // Gone, or ended some other way, since.
      if (RealtimeSessions.live.get(entry.socket.id) !== entry) {
        return;
      }

      // One step of a longer wait.
      if (Date.now() < entry.session.expiresAtMs) {
        RealtimeSessions.arm(entry);
        return;
      }

      RealtimeSessions.end(entry.socket);
    }, delayMs);

    // A socket's timer never keeps the process up.
    if (typeof timer === "object" && timer && "unref" in timer) {
      timer.unref();
    }

    entry.timer = timer;
  }
}
