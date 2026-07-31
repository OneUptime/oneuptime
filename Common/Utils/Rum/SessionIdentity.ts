import {
  SESSION_REPLAY_IDLE_ROLLOVER_MS,
  SESSION_REPLAY_MAX_SESSION_MS,
} from "../../Types/Rum/SessionReplay";

/*
 * Session identity lifecycle, expressed as pure functions of timestamps
 * so it can be tested exhaustively without a browser, a clock, or storage.
 *
 * The recorder owns the storage (localStorage for the session, sessionStorage
 * for the tab); this module owns the *decisions*.
 *
 * Must stay dependency-free apart from the shared constants — bundled
 * into the browser recorder.
 */

export enum SessionRotationReason {
  /* No prior session, or storage was cleared. */
  New = "new",

  /* More than the idle window elapsed since the last recorded activity. */
  Idle = "idle",

  /* The session hit its absolute duration ceiling. */
  DurationCap = "duration-cap",

  /* Stored state was unreadable or inconsistent; fail into a fresh session. */
  Corrupt = "corrupt",
}

export interface StoredSessionState {
  sessionId: string;
  sessionStartUnixMs: number;
  lastActivityUnixMs: number;
}

export interface SessionRotationDecision {
  shouldRotate: boolean;
  reason?: SessionRotationReason;
}

export default class SessionIdentity {
  /*
   * Should the recorder mint a new session id?
   *
   * Two independent conditions, checked in this order because the idle
   * check is the common case and the duration cap is the backstop:
   *
   *  - idle: the user walked away and came back. A single "session" that
   *    spans a lunch break is not a session, and stitching one produces a
   *    recording with a 40-minute dead zone in the middle.
   *  - duration cap: a tab left open for days would otherwise accumulate
   *    an unbounded chunk sequence under one sort-key prefix.
   *
   * Inconsistent stored state (missing id, non-finite or future-dated
   * timestamps, start after last activity) rotates rather than being
   * repaired — a fresh session loses at most a little context, whereas
   * trusting corrupt state can attribute one user's chunks to another
   * user's session id.
   */
  public static shouldRotateSession(
    stored: StoredSessionState | null,
    nowUnixMs: number,
    idleRolloverMs: number = SESSION_REPLAY_IDLE_ROLLOVER_MS,
    maxSessionMs: number = SESSION_REPLAY_MAX_SESSION_MS,
  ): SessionRotationDecision {
    if (!stored) {
      return { shouldRotate: true, reason: SessionRotationReason.New };
    }

    if (!SessionIdentity.isStoredStateValid(stored, nowUnixMs)) {
      return { shouldRotate: true, reason: SessionRotationReason.Corrupt };
    }

    if (nowUnixMs - stored.lastActivityUnixMs >= idleRolloverMs) {
      return { shouldRotate: true, reason: SessionRotationReason.Idle };
    }

    if (nowUnixMs - stored.sessionStartUnixMs >= maxSessionMs) {
      return {
        shouldRotate: true,
        reason: SessionRotationReason.DurationCap,
      };
    }

    return { shouldRotate: false };
  }

  public static isStoredStateValid(
    stored: StoredSessionState,
    nowUnixMs: number,
  ): boolean {
    if (!stored.sessionId) {
      return false;
    }

    if (
      !Number.isFinite(stored.sessionStartUnixMs) ||
      !Number.isFinite(stored.lastActivityUnixMs)
    ) {
      return false;
    }

    if (stored.sessionStartUnixMs <= 0 || stored.lastActivityUnixMs <= 0) {
      return false;
    }

    /* Activity cannot precede the session start. */
    if (stored.lastActivityUnixMs < stored.sessionStartUnixMs) {
      return false;
    }

    /*
     * Tolerate a small amount of forward skew (the device clock may have
     * been corrected between writes) but reject state stamped far in the
     * future, which indicates either a clock jump or tampering.
     */
    const forwardToleranceMs: number = 5 * 60 * 1000;

    if (stored.sessionStartUnixMs > nowUnixMs + forwardToleranceMs) {
      return false;
    }

    return true;
  }

  /*
   * Clamp a client-reported session start against the server's own clock.
   *
   * End-user device clocks are wrong constantly — by minutes, by hours,
   * occasionally by years. An unclamped client timestamp lands in the
   * partition key and the TTL expression, so a device clock set to 2035
   * would create a partition that never expires, and one set to 2015
   * would create a row that is deleted on arrival.
   *
   * The clamp is one-directional in effect: the returned value is always
   * within [serverNow - maxBackwardMs, serverNow]. A session cannot start
   * in the future, and cannot claim to have started before the window we
   * are willing to accept.
   */
  public static clampSessionStart(
    clientReportedStartUnixMs: number,
    serverNowUnixMs: number,
    maxBackwardMs: number = SESSION_REPLAY_MAX_SESSION_MS,
  ): number {
    if (!Number.isFinite(clientReportedStartUnixMs)) {
      return serverNowUnixMs;
    }

    if (clientReportedStartUnixMs > serverNowUnixMs) {
      return serverNowUnixMs;
    }

    const earliestAcceptable: number = serverNowUnixMs - maxBackwardMs;

    if (clientReportedStartUnixMs < earliestAcceptable) {
      return earliestAcceptable;
    }

    return clientReportedStartUnixMs;
  }

  /*
   * Observed clock skew, stored on the session header so a support
   * engineer can see "this recording's timings are 40 minutes off"
   * instead of being quietly misled by them.
   *
   * Positive means the client clock runs ahead of the server.
   */
  public static getClockSkewMs(
    clientSendUnixMs: number,
    serverReceiveUnixMs: number,
  ): number {
    if (
      !Number.isFinite(clientSendUnixMs) ||
      !Number.isFinite(serverReceiveUnixMs)
    ) {
      return 0;
    }

    return clientSendUnixMs - serverReceiveUnixMs;
  }

  /*
   * Clamp a retention day count to the allowed closed set, rounding *up*
   * to the next allowed value.
   *
   * Rounding up rather than to the nearest is deliberate: silently
   * shortening a customer's configured retention destroys evidence they
   * expected to keep, whereas keeping it slightly longer costs only disk.
   */
  public static clampRetentionDays(
    requestedDays: number,
    allowedDays: Array<number>,
    fallbackDays: number,
  ): number {
    if (allowedDays.length === 0) {
      return fallbackDays;
    }

    const sorted: Array<number> = [...allowedDays].sort(
      (a: number, b: number): number => {
        return a - b;
      },
    );

    const smallest: number | undefined = sorted[0];
    const largest: number | undefined = sorted[sorted.length - 1];

    if (smallest === undefined || largest === undefined) {
      return fallbackDays;
    }

    if (!Number.isFinite(requestedDays) || requestedDays <= 0) {
      return fallbackDays;
    }

    if (requestedDays >= largest) {
      return largest;
    }

    for (const allowed of sorted) {
      if (requestedDays <= allowed) {
        return allowed;
      }
    }

    return fallbackDays;
  }
}
