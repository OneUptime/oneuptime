import {
  SESSION_REPLAY_IDLE_ROLLOVER_MS,
  SESSION_REPLAY_MAX_SESSION_MS,
  SESSION_REPLAY_VISITOR_ID_PATTERN,
} from "../../Types/Rum/SessionReplay";

/*
 * Session identity lifecycle, expressed as pure functions of timestamps
 * so it can be tested exhaustively without a browser, a clock, or storage.
 *
 * The recorder owns the storage (localStorage for the session, sessionStorage
 * for the tab); this module owns the *decisions*.
 *
 * Must stay dependency-free apart from the shared constants — bundled
 * into the browser recorder. What only the ingest decides (a session's
 * start, a chunk's wait, a clock's skew, the retention) is in
 * SessionReplayIngestBounds: a class's members are never tree-shaken, so
 * here they rode along to every customer page for nothing (#8019).
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

  /*
   * The page identified a DIFFERENT user than the one the session already
   * belongs to - one person signed out and another signed in on the same
   * browser. A session is one person's: the recording so far stays theirs
   * and the new person's activity starts a session of its own.
   */
  IdentityChange = "identity-change",
}

/*
 * What identify(userRef) does to the session it is called in.
 *
 *  - Same: the session already belongs to this user. Nothing changes.
 *  - Attach: the session is anonymous so far. It becomes this user's,
 *    from its start: a visitor who signs in part-way through a visit is
 *    still the one person who made it, and the pages before the sign-in
 *    are usually the part worth watching.
 *  - SwitchUser: the session belongs to someone else. It ends, and a new
 *    one starts for this user.
 */
export enum SessionIdentifyDecision {
  Same = "same",
  Attach = "attach",
  SwitchUser = "switch-user",
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
   * Do two end-user references name the same person?
   *
   * Compared trimmed and case-sensitively, exactly as the server keys them
   * (SessionReplayIdentity.buildUserKey trims and never folds case): two
   * references the server would file under one key must never split a
   * session, and two it would file under different keys must never share
   * one.
   */
  public static isSameUserRef(a: string, b: string): boolean {
    return a.trim() === b.trim();
  }

  /*
   * See SessionIdentifyDecision. `sessionUserRef` is who the session
   * belongs to so far - the reference this page gave it, or the one an
   * earlier page or another tab of the same session stored - and null for
   * an anonymous session.
   */
  public static decideIdentify(
    sessionUserRef: string | null,
    nextUserRef: string,
  ): SessionIdentifyDecision {
    if (sessionUserRef === null || sessionUserRef.trim().length === 0) {
      return SessionIdentifyDecision.Attach;
    }

    return SessionIdentity.isSameUserRef(sessionUserRef, nextUserRef)
      ? SessionIdentifyDecision.Same
      : SessionIdentifyDecision.SwitchUser;
  }

  /*
   * Is this a visitor id the recorder could have minted?
   *
   * Shared by the recorder (which only ever stores what passes) and the
   * ingest parser (which drops what does not), so a hand-crafted POST can
   * never file a recording under an arbitrary string. Strict on purpose:
   * the id is random and ours, so there is no legitimate "almost" shape
   * to be lenient towards.
   */
  public static isVisitorId(value: unknown): value is string {
    return (
      typeof value === "string" && SESSION_REPLAY_VISITOR_ID_PATTERN.test(value)
    );
  }

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

  /*
   * Did activity at `activityUnixMs` happen after the stored session had
   * already gone idle?
   *
   * The idle rule says a session ends at its last activity once the idle
   * window has passed with nothing in it. Activity that arrives AFTER that -
   * the user back from lunch, a laptop woken from sleep - is the first thing
   * of a NEW session, never more of the old one. Written through to the
   * stored record it would revive the expired session instead: its
   * lastActivity moves forward, shouldRotateSession() answers "no", and the
   * one session now holds a dead zone as long as the user was away.
   *
   * False with no stored session: there is nothing to have expired, and
   * shouldRotateSession() already answers that case.
   */
  public static isActivityAfterIdleExpiry(
    stored: StoredSessionState | null,
    activityUnixMs: number,
    idleRolloverMs: number = SESSION_REPLAY_IDLE_ROLLOVER_MS,
  ): boolean {
    if (
      !stored ||
      !Number.isFinite(activityUnixMs) ||
      !Number.isFinite(stored.lastActivityUnixMs)
    ) {
      return false;
    }

    return activityUnixMs - stored.lastActivityUnixMs >= idleRolloverMs;
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
}
