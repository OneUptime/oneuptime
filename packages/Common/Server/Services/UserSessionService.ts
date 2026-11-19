import AuditLogService from "./AuditLogService";
import DatabaseService from "./DatabaseService";
import EnterpriseEdition from "../Enterprise/EnterpriseEdition";
import InMemoryTTLCache from "../Infrastructure/InMemoryTTLCache";
import { OnDelete, OnUpdate } from "../Types/Database/Hooks";
import Query from "../Types/Database/Query";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import { IsNull, SelectQueryBuilder, UpdateResult } from "typeorm";
import RealtimeAccessChanges, {
  RealtimeAccessChangeKind,
} from "../Utils/Realtime/RealtimeAccessChanges";
import UserAgentDevice from "../Utils/RequestOrigin/UserAgentDevice";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Model from "../../Models/DatabaseModels/UserSession";
import AuditLogAction from "../../Types/AuditLog/AuditLogAction";
import {
  getSessionEndAuditLogAction,
  SessionAuditEvent,
} from "../../Types/AuditLog/AuditLogSessionEvent";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../Types/ObjectID";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import { JSONObject } from "../../Types/JSON";
import HashedString from "../../Types/HashedString";
import RequestOrigin from "../../Types/RequestOrigin";
import { EncryptionSecret } from "../EnvironmentConfig";
import OneUptimeDate from "../../Types/Date";
import Text from "../../Types/Text";
import logger from "../Utils/Logger";
import Exception from "../../Types/Exception/Exception";
import {
  getSessionEndCauseRevokedReason,
  NamedSessionEndCause,
  readSessionEndCause,
  SessionEndCause,
} from "../../Types/UserSession/SessionEndCause";
import {
  decideSessionRenewal,
  DEFAULT_SESSION_IDLE_DAYS,
  getIdleTimeoutInMinutes,
  getIdleTimeoutSweepCutoff,
  getSessionEnd,
  getSessionLengthRule,
  IDLE_TIMEOUT_SWEEP_MARGIN_IN_MINUTES,
  ReportedInactivity,
  REPORTS_ACTIVITY_WHILE_IN_USE_FIELD,
  SessionEnd,
  SessionEndReason,
  SessionFacts,
  SessionLengthRule,
  SessionLengths,
  SessionRenewalOutcome,
} from "../../Types/UserSession/SessionLength";
import {
  readSessionSignIn,
  readSessionSignInOrigin,
  SessionSignIn,
  SessionSignInOrigin,
  toSessionSignInInfo,
} from "../../Types/UserSession/SessionSignIn";
import {
  IdentityProviderSignOutRecord,
  isSamlIdentityProviderSignOutRecord,
  readIdentityProviderSignOutRecord,
  SamlIdentityProviderSignOutRecord,
} from "../../Types/SSO/IdentityProviderSignOut";
import SsoProviderType from "../../Types/SSO/SsoProviderType";

export interface SessionMetadata {
  session: Model;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  /*
   * What the session's access token says and how long it lives
   * (Types/UserSession/SessionLength.ts): when the session signed in, when
   * its person was last active, and 15 minutes - or less, when the server's
   * session lengths end the session sooner, so the token never outlives it.
   */
  signedInAt: Date;
  lastActiveAt: Date;
  accessTokenExpiresInSeconds: number;
  /*
   * How long an SSO sign-in's proof lasts (the sso-<project> cookie and the
   * Global SSO token, CookieUtil): 30 days, or the SSO session length when
   * that is shorter, so a project that requires SSO is never let in on a
   * sign-in older than the length allows. Only SSO sign-ins hand one out.
   */
  ssoSignInExpiresInSeconds: number;
}

/*
 * What a renewal of a session decides under the server's session lengths:
 * that the session has ended, why, and when its person was last active
 * before it did (which its end is recorded with: endSessionByLength), or
 * when its person was last active and the lengths it is renewed under.
 */
export type SessionRenewalDecision =
  | { hasEnded: true; reason: SessionEndReason; lastActiveAt: Date }
  | {
      hasEnded: false;
      lastActiveAt: Date;
      lengths: SessionLengths | null;
    };

// What endSessionByLength writes with the end.
export interface EndSessionByLengthOptions {
  /*
   * When its person was last active before it ended, as the renewal that
   * ended it decided: kept on the session with its end, so the audit log
   * says it, and counts the moment an idle timeout ran out from.
   */
  lastActiveAt?: Date | undefined;
}

/*
 * The revocation reason a session ended by the server's session lengths is
 * kept with (UserSession.revokedReason, a ShortText column), one for each
 * reason, so a refresh that comes after can say why it ended - the words of
 * its cause (Types/UserSession/SessionEndCause), which the audit log reads
 * as a timeout.
 */
export const SESSION_END_REVOKED_REASONS: Readonly<
  Record<SessionEndReason, string>
> = {
  [SessionEndReason.LengthReached]: getSessionEndCauseRevokedReason(
    SessionEndCause.LengthReached,
  ),
  [SessionEndReason.Inactive]: getSessionEndCauseRevokedReason(
    SessionEndCause.IdleTimeout,
  ),
};

/*
 * How long back a sweep (endSessionsThatRanOut) looks for sessions that
 * ran out: ones that ran out longer ago are left as they are - they are
 * refused at their next refresh all the same - so the first sweep after an
 * upgrade, or after the workers were down, records a day of them at most.
 */
export const SESSIONS_RAN_OUT_LOOKBACK_IN_HOURS: number = 24;

// Who a change to the session lengths would sign out at once (countPeoplePastLengths).
export interface SessionLengthsImpact {
  // How many people have a session the lengths have ended.
  peopleCount: number;
  // Whether one of those sessions is `sessionId`'s.
  includesSession: boolean;
}

/*
 * WHETHER THE SESSION AN ACCESS TOKEN NAMES IS STILL LIVE, ON EVERY REQUEST,
 * WITHOUT A DATABASE READ PER REQUEST (#9534).
 *
 * An access token is a stateless JWT that lives 15 minutes. Signing out,
 * revoking a session, a new password, a block, a session length and every
 * other end revoke the session in the database, which stops its refresh
 * token at once; the access token used to work on until it expired - after
 * a sign-out whose answer never reached the browser, for whoever sat down
 * at the computer next, and for anyone who had copied it.
 *
 * So every request asks whether its session is live (isSessionLive, from
 * UserAuthorization.readRequestSession), and the answer is kept on each
 * server, the way whether its person is blocked is (UserService
 * .isUserBlocked):
 *
 *   - a live session is read once per server every
 *     LIVE_SESSION_CACHE_TTL_MS, with one primary-key read, and concurrent
 *     requests share it;
 *   - a session that has ended is kept as ended for as long as any access
 *     token of it can live (ENDED_SESSION_CACHE_TTL_MS): it never comes back;
 *   - when a session ends, the server that ended it holds it as ended at
 *     once, and tells every other server (RealtimeAccessChanges,
 *     SessionsEnded), which do the same (forgetEndedSessions,
 *     forgetSessionsOfUser). A server the message cannot reach reads the
 *     session again within LIVE_SESSION_CACHE_TTL_MS, so an ended session's
 *     token is refused there within that bound, never after its own 15
 *     minutes;
 *   - a read that fails is an error, never "live", and nothing about it is
 *     kept.
 */
export const LIVE_SESSION_CACHE_TTL_MS: number = 60_000;

/*
 * How long a server keeps a session it knows has ended as ended: the longest
 * an access token signed for it before it ended can still live. No token is
 * signed for a session that has ended.
 */
export const ENDED_SESSION_CACHE_TTL_MS: number = 15 * 60 * 1000;

// How many sessions one server keeps the standing of at once.
export const SESSION_STANDING_CACHE_MAX_ENTRIES: number = 10_000;

/*
 * What a server knows of one session: whether it is live, and whose it is
 * (lower-case; empty when no such session was found).
 */
export interface SessionStanding {
  isLive: boolean;
  userId: string;
}

// A lookup of a session's standing in flight, and whose session the token named.
interface SessionStandingLookup {
  userId: string;
  lookup: Promise<SessionStanding>;
}

// How many sessions endSessionsPastLengths ends in one go.
const SESSIONS_ENDED_PER_BATCH: number = 500;

// The most batches one pass of endSessionsPastLengths runs, so it always stops.
const MAX_SESSION_END_BATCHES: number = 1000;

export interface CreateSessionOptions {
  userId: ObjectID;
  isGlobalLogin: boolean;
  refreshToken?: string | undefined;
  refreshTokenExpiresAt?: Date | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  deviceName?: string | undefined;
  deviceType?: string | undefined;
  deviceOS?: string | undefined;
  deviceBrowser?: string | undefined;
  additionalInfo?: JSONObject | undefined;
  /*
   * How the person signed in (Types/UserSession/SessionSignIn), and where
   * from (RequestOriginUtil.fromRequest): the session keeps both, and the
   * audit log says them at its sign-in and again when it ends.
   */
  signIn?: SessionSignIn | undefined;
  requestOrigin?: RequestOrigin | undefined;
  /*
   * What signing its person out of their identity provider too takes, for a
   * browser sign-in through an OpenID Connect or SAML provider that asks for
   * it (Types/SSO/IdentityProviderSignOut): kept with the session, its
   * secrets encrypted, and read at the session's sign-out.
   */
  identityProviderSignOut?: IdentityProviderSignOutRecord | undefined;
}

// What a session about to be signed out kept to sign its person out of their provider too.
export interface SessionIdentityProviderSignOut {
  sessionId: ObjectID;
  record: IdentityProviderSignOutRecord;
}

// A live session a SAML sign-in gave, and what it kept of that sign-in.
export interface SessionSignedInThroughSamlProvider {
  sessionId: ObjectID;
  record: SamlIdentityProviderSignOutRecord;
}

export interface RenewSessionOptions {
  session: Model;
  refreshTokenExpiresAt?: Date | undefined;
  /*
   * When its person was last active, as the renewal decided
   * (decideRenewal): now, unless the browser said otherwise.
   */
  lastActiveAt?: Date | undefined;
  /*
   * The server's session lengths it is renewed under, as decideRenewal read
   * them; read again when not handed over.
   */
  lengths?: SessionLengths | null | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  deviceName?: string | undefined;
  deviceType?: string | undefined;
  deviceOS?: string | undefined;
  deviceBrowser?: string | undefined;
  additionalInfo?: JSONObject | undefined;
}

export interface TouchSessionOptions {
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

export interface RevokeSessionOptions {
  /*
   * Why it ended (Types/UserSession/SessionEndCause): kept as its words,
   * which a later refresh and the audit log read. Takes the place of
   * `reason`, which is for a revocation no cause names.
   */
  cause?: NamedSessionEndCause | undefined;
  reason?: string | undefined;
  /*
   * Where the request that ended it came from - a sign-out's - for the
   * audit log's entry about it.
   */
  requestOrigin?: RequestOrigin | undefined;
  /*
   * When its person was last active, when the revocation knows better than
   * the session (a renewal past its idle timeout: endSessionByLength).
   * Written with the end, and what the audit log's entry about it says.
   */
  lastActiveAt?: Date | undefined;
}

/*
 * A session a revocation is about to end, as the audit log's entry about
 * its end needs it (onBeforeUpdate reads them, onUpdateSuccess records).
 */
interface SessionEnding {
  session: Model;
}

// What onBeforeUpdate hands onUpdateSuccess.
interface RevocationCarryForward {
  endingSessions: Array<SessionEnding>;
}

// The columns an entry about a session's end is built from.
const SESSION_END_SELECT: {
  _id: true;
  userId: true;
  isRevoked: true;
  createdAt: true;
  lastActiveAt: true;
  refreshTokenExpiresAt: true;
  additionalInfo: true;
  ipAddress: true;
  userAgent: true;
} = {
  _id: true,
  userId: true,
  isRevoked: true,
  createdAt: true,
  lastActiveAt: true,
  refreshTokenExpiresAt: true,
  additionalInfo: true,
  ipAddress: true,
  userAgent: true,
};

export class Service extends DatabaseService<Model> {
  private static readonly DEFAULT_REFRESH_TOKEN_TTL_DAYS: number =
    DEFAULT_SESSION_IDLE_DAYS;
  private static readonly SHORT_TEXT_LIMIT: number = 100;

  // How long a session's access token lives at most.
  public static readonly ACCESS_TOKEN_LIFETIME_IN_SECONDS: number = 15 * 60;

  // How long an SSO sign-in's proof lives at most (CookieUtil.getSSOToken).
  public static readonly SSO_SIGN_IN_LIFETIME_IN_SECONDS: number =
    30 * 24 * 60 * 60;

  // What isSessionLive read, per server (see LIVE_SESSION_CACHE_TTL_MS).
  private sessionStandingCache: InMemoryTTLCache<SessionStanding> =
    new InMemoryTTLCache(SESSION_STANDING_CACHE_MAX_ENTRIES);

  /*
   * One read per session in flight. A dashboard load fires a burst of
   * requests at once, and without this a cold cache turns the burst into
   * as many identical reads.
   */
  private sessionStandingLookups: Map<string, SessionStandingLookup> =
    new Map();

  public constructor() {
    super(Model);

    /*
     * Bound retention of expired and revoked sessions, including device data,
     * without deleting sessions that have renewed their refresh credentials.
     */
    this.hardDeleteItemsOlderThanInDays("refreshTokenExpiresAt", 30);
  }

  /**
   * Whether the session an access token names is still live: there is such
   * a session, it is `userId`'s, and nothing has ended it - signed out,
   * revoked, a new password, a block, the session lengths. Asked on every
   * authenticated request (UserAuthorization.readRequestSession), so the
   * answer is kept on each server (LIVE_SESSION_CACHE_TTL_MS): one
   * primary-key read per session per server a minute, never one per
   * request, and an end reaches every server at once (forgetEndedSessions).
   *
   * Rejects when the session cannot be read: "we could not find out" is not
   * "live", and nothing about a failure is kept.
   */
  @CaptureSpan()
  public async isSessionLive(data: {
    sessionId: ObjectID;
    userId: ObjectID;
  }): Promise<boolean> {
    const userKey: string = Service.getStandingKey(data.userId);

    const standing: SessionStanding = await this.getSessionStanding({
      key: Service.getStandingKey(data.sessionId),
      userKey: userKey,
    });

    return standing.isLive && standing.userId === userKey;
  }

  /*
   * What this server knows of a session, or one primary-key read of it,
   * kept: a live session for LIVE_SESSION_CACHE_TTL_MS, one that has ended -
   * or that is not there - for ENDED_SESSION_CACHE_TTL_MS.
   */
  private async getSessionStanding(data: {
    key: string;
    userKey: string;
  }): Promise<SessionStanding> {
    const cached: SessionStanding | undefined = this.sessionStandingCache.get(
      data.key,
    );

    if (cached !== undefined) {
      return cached;
    }

    const inFlight: SessionStandingLookup | undefined =
      this.sessionStandingLookups.get(data.key);

    if (inFlight) {
      return inFlight.lookup;
    }

    const lookup: Promise<SessionStanding> = this.findOneById({
      id: new ObjectID(data.key),
      select: {
        _id: true,
        userId: true,
        isRevoked: true,
      },
      props: {
        isRoot: true,
      },
    })
      .then((session: Model | null): SessionStanding => {
        const standing: SessionStanding = {
          isLive: Boolean(session && session.isRevoked === false),
          userId: session?.userId ? Service.getStandingKey(session.userId) : "",
        };

        /*
         * Kept only while this read is still the current one: a session
         * that ended while it was on the wire is held as ended already
         * (forgetEndedSessions), and this read may predate the end.
         */
        if (this.sessionStandingLookups.get(data.key)?.lookup === lookup) {
          this.sessionStandingCache.set(
            data.key,
            standing,
            standing.isLive
              ? LIVE_SESSION_CACHE_TTL_MS
              : ENDED_SESSION_CACHE_TTL_MS,
          );
        }

        return standing;
      })
      .finally((): void => {
        if (this.sessionStandingLookups.get(data.key)?.lookup === lookup) {
          this.sessionStandingLookups.delete(data.key);
        }
      });

    this.sessionStandingLookups.set(data.key, {
      userId: data.userKey,
      lookup: lookup,
    });

    return lookup;
  }

  /*
   * These sessions have ended (signed out, revoked, deleted), here or on
   * another server (RealtimeAccessChanges, SessionsEnded): each one this
   * server knows of, or is reading right now, is held as ended at once, so
   * the next request with its access token is refused without a read. A
   * session it does not know of needs nothing: its next request reads it,
   * ended, from the database.
   */
  public forgetEndedSessions(sessionIds: Array<ObjectID | string>): void {
    for (const sessionId of sessionIds) {
      const key: string = Service.getStandingKey(sessionId);

      const known: SessionStanding | undefined =
        this.sessionStandingCache.get(key);
      const inFlight: SessionStandingLookup | undefined =
        this.sessionStandingLookups.get(key);

      this.sessionStandingLookups.delete(key);

      if (known === undefined && !inFlight) {
        continue;
      }

      this.sessionStandingCache.set(
        key,
        {
          isLive: false,
          userId: known?.userId || inFlight?.userId || "",
        },
        ENDED_SESSION_CACHE_TTL_MS,
      );
    }
  }

  /*
   * Every session of this person ended - their account was deleted, with
   * its sessions - here or on another server: this server forgets each one
   * it held as live, so their next request reads it again. One it holds as
   * ended stays ended.
   */
  public forgetSessionsOfUser(userId: ObjectID | string): void {
    const userKey: string = Service.getStandingKey(userId);

    this.sessionStandingCache.deleteWhere(
      (standing: SessionStanding): boolean => {
        return standing.isLive && standing.userId === userKey;
      },
    );

    for (const [key, inFlight] of Array.from(
      this.sessionStandingLookups.entries(),
    )) {
      if (inFlight.userId === userKey) {
        this.sessionStandingLookups.delete(key);
      }
    }
  }

  /*
   * One session, one entry: the database compares ids without regard to
   * case, so an id written in capitals names the same session.
   */
  private static getStandingKey(id: ObjectID | string): string {
    return id.toString().toLowerCase();
  }

  public async createSession(
    options: CreateSessionOptions,
  ): Promise<SessionMetadata> {
    const refreshToken: string =
      options.refreshToken || Service.generateRefreshToken();
    const refreshTokenExpiresAt: Date =
      options.refreshTokenExpiresAt || Service.getRefreshTokenExpiry();

    const session: Model = this.buildSessionModel(options, {
      refreshToken,
      refreshTokenExpiresAt,
    });

    /*
     * Read before the session is written: a sign-in whose lengths cannot be
     * read is refused (EnterpriseEdition.getUserSessionLengths), never
     * handed a session that would outlive them.
     */
    const lengths: SessionLengths | null =
      await EnterpriseEdition.getUserSessionLengths();

    try {
      const createdSession: Model = await this.create({
        data: session,
        props: {
          isRoot: true,
        },
      });

      /*
       * The sign-in, in the audit log of every project of theirs that keeps
       * one (issue #6762). Never fails the sign-in: the delegate swallows
       * whatever goes wrong.
       */
      await AuditLogService.recordSessionEvents([
        Service.toSignInEvent({
          session: createdSession,
          userId: options.userId,
          requestOrigin: options.requestOrigin,
        }),
      ]);

      return Service.buildSessionMetadata({
        session: createdSession,
        refreshToken: refreshToken,
        refreshTokenExpiresAt: refreshTokenExpiresAt,
        lengths: lengths,
        isSsoSignIn: !options.isGlobalLogin,
        fallbackSignedInAt: session.lastActiveAt!,
        fallbackLastActiveAt: session.lastActiveAt!,
      });
    } catch (error) {
      throw error as Exception;
    }
  }

  /*
   * Whether a session is an SSO sign-in: one a project's SAML or OpenID
   * Connect provider, or the server's, signed in (CreateSessionOptions.
   * isGlobalLogin false). Every other sign-in - a password, a passkey, Sign
   * in with Microsoft - and a session that does not say, is not.
   */
  public static isSsoSignIn(session: Pick<Model, "additionalInfo">): boolean {
    const additionalInfo: JSONObject = (session.additionalInfo ||
      {}) as JSONObject;

    return additionalInfo["isGlobalLogin"] === false;
  }

  /*
   * What a session's end is decided from: when it signed in (its row's
   * createdAt), and when its person was last active.
   */
  public static getSessionFacts(
    session: Pick<Model, "createdAt" | "lastActiveAt" | "additionalInfo">,
    fallbackNow: Date,
  ): SessionFacts {
    const signedInAt: Date = session.createdAt
      ? new Date(session.createdAt)
      : fallbackNow;

    return {
      signedInAt: signedInAt,
      lastActiveAt: session.lastActiveAt
        ? new Date(session.lastActiveAt)
        : signedInAt,
      isSsoSignIn: Service.isSsoSignIn(session),
    };
  }

  /*
   * How long an access token signed for this session at `now` lives:
   * ACCESS_TOKEN_LIFETIME_IN_SECONDS, or until the session ends under the
   * lengths if that comes first. At least a second: a session that has
   * ended is refused before any token is signed for it.
   */
  public static getAccessTokenExpiresInSeconds(data: {
    facts: SessionFacts;
    lengths: SessionLengths | null;
    now: Date;
  }): number {
    const end: SessionEnd = getSessionEnd(data.facts, data.lengths);
    const untilEndInSeconds: number = Math.floor(
      (end.endsAt.getTime() - data.now.getTime()) / 1000,
    );

    return Math.max(
      1,
      Math.min(Service.ACCESS_TOKEN_LIFETIME_IN_SECONDS, untilEndInSeconds),
    );
  }

  /*
   * How long the proof of an SSO sign-in made now lives: 30 days, or the
   * SSO session length when that is shorter.
   */
  public static getSsoSignInExpiresInSeconds(
    lengths: SessionLengths | null,
  ): number {
    const rule: SessionLengthRule = getSessionLengthRule(lengths, true);

    if (rule.lengthInMinutes === null) {
      return Service.SSO_SIGN_IN_LIFETIME_IN_SECONDS;
    }

    return Math.min(
      Service.SSO_SIGN_IN_LIFETIME_IN_SECONDS,
      rule.lengthInMinutes * 60,
    );
  }

  private static buildSessionMetadata(data: {
    session: Model;
    refreshToken: string;
    refreshTokenExpiresAt: Date;
    lengths: SessionLengths | null;
    isSsoSignIn: boolean;
    fallbackSignedInAt: Date;
    fallbackLastActiveAt: Date;
  }): SessionMetadata {
    const now: Date = OneUptimeDate.getCurrentDate();

    const facts: SessionFacts = {
      signedInAt: data.session.createdAt
        ? new Date(data.session.createdAt)
        : data.fallbackSignedInAt,
      lastActiveAt: data.session.lastActiveAt
        ? new Date(data.session.lastActiveAt)
        : data.fallbackLastActiveAt,
      isSsoSignIn: data.isSsoSignIn,
    };

    return {
      session: data.session,
      refreshToken: data.refreshToken,
      refreshTokenExpiresAt: data.refreshTokenExpiresAt,
      signedInAt: facts.signedInAt,
      lastActiveAt: facts.lastActiveAt,
      accessTokenExpiresInSeconds: Service.getAccessTokenExpiresInSeconds({
        facts,
        lengths: data.lengths,
        now,
      }),
      ssoSignInExpiresInSeconds: Service.getSsoSignInExpiresInSeconds(
        data.lengths,
      ),
    };
  }

  /*
   * Whether a session found by its refresh token may be renewed, under the
   * server's session lengths as they are now (Types/UserSession/
   * SessionLength.ts, decideSessionRenewal) - the one place a renewal asks:
   *
   *   - ended when its kind's session length has passed since it signed in;
   *   - ended when its person has not been active for its kind's idle
   *     timeout. While an idle timeout is set, what a browser reports
   *     counts: how long its person has not used OneUptime
   *     (reportedInactivityInSeconds, held within what the session knew
   *     already and now), and the longest time they went without since the
   *     last renewal (reportedLongestInactivity) - a browser closed, a
   *     computer asleep - which ends the session once the part the session
   *     did not know of reached the idle timeout. Otherwise, and for a
   *     renewal without a report, the renewal itself is the activity - as
   *     every renewal has always been.
   *
   * Throws when the lengths cannot be read: the renewal is refused, never
   * made past them.
   */
  @CaptureSpan()
  public async decideRenewal(data: {
    session: Model;
    reportedInactivityInSeconds: number | null;
    reportedLongestInactivity?: ReportedInactivity | null | undefined;
  }): Promise<SessionRenewalDecision> {
    const lengths: SessionLengths | null =
      await EnterpriseEdition.getUserSessionLengths();
    const now: Date = OneUptimeDate.getCurrentDate();

    const outcome: SessionRenewalOutcome = decideSessionRenewal({
      facts: Service.getSessionFacts(data.session, now),
      lengths: lengths,
      report: {
        inactiveForInSeconds: data.reportedInactivityInSeconds,
        longestInactivity: data.reportedLongestInactivity ?? null,
      },
      now: now,
    });

    if (outcome.hasEnded) {
      return {
        hasEnded: true,
        reason: outcome.reason,
        lastActiveAt: outcome.lastActiveAt,
      };
    }

    return {
      hasEnded: false,
      lastActiveAt: outcome.lastActiveAt,
      lengths: lengths,
    };
  }

  /*
   * Ends a session the server's session lengths have ended: revoked, with
   * the reason kept (SESSION_END_REVOKED_REASONS), which also ends its live
   * updates on every server and records its timeout in the audit log
   * (onUpdateSuccess) - with when its person was last active before it
   * ended, when the renewal that ended it knew (options.lastActiveAt).
   */
  @CaptureSpan()
  public async endSessionByLength(
    sessionId: ObjectID,
    reason: SessionEndReason,
    options?: EndSessionByLengthOptions,
  ): Promise<void> {
    const revokeOptions: RevokeSessionOptions = {
      cause:
        reason === SessionEndReason.LengthReached
          ? SessionEndCause.LengthReached
          : SessionEndCause.IdleTimeout,
    };

    if (options?.lastActiveAt) {
      revokeOptions.lastActiveAt = options.lastActiveAt;
    }

    await this.revokeSessionById(sessionId, revokeOptions);
  }

  /*
   * Why the session a refresh token belongs to was ended by the server's
   * session lengths, or null: it is not found, still on, or ended some other
   * way (signed out, a password changed, the person blocked). For a refresh
   * that comes after the session was ended - by endSessionsPastLengths, say
   * - so it can say why, as the one that ended it would have.
   */
  @CaptureSpan()
  public async getSessionLengthEndReason(
    refreshToken: string,
  ): Promise<SessionEndReason | null> {
    const hashedValue: string = await HashedString.hashValue(
      refreshToken,
      EncryptionSecret,
    );

    const session: Model | null = await this.findOneBy({
      query: {
        refreshToken: new HashedString(hashedValue, true),
        isRevoked: true,
      },
      select: {
        _id: true,
        revokedReason: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!session?.revokedReason) {
      return null;
    }

    for (const reason of Object.keys(
      SESSION_END_REVOKED_REASONS,
    ) as Array<SessionEndReason>) {
      if (SESSION_END_REVOKED_REASONS[reason] === session.revokedReason) {
        return reason;
      }
    }

    return null;
  }

  /*
   * Ends, at once, every session the session lengths have already ended:
   * what a master admin's change to them means for the people signed in
   * now. Each one is revoked with its reason, as a renewal would have ended
   * it (endSessionByLength), so its live updates end on every server, its
   * timeout is in the audit log, and its next request and refresh are
   * refused - by the database's clock, which keeps the sessions' own times.
   * Only lengths that are set end anything. Returns how many sessions it
   * ended.
   */
  @CaptureSpan()
  public async endSessionsPastLengths(
    lengths: SessionLengths | null,
  ): Promise<number> {
    let ended: number = 0;

    for (const condition of Service.getPastLengthConditions(lengths)) {
      ended += await this.endSessionsWhere(condition);
    }

    return ended;
  }

  /*
   * Who the lengths would sign out at once, without ending anything: how
   * many people have a session they have ended, and whether `sessionId` is
   * one of those sessions - the Admin Dashboard asks before it saves a
   * change that signs people out.
   */
  @CaptureSpan()
  public async countPeoplePastLengths(data: {
    lengths: SessionLengths | null;
    sessionId?: ObjectID | undefined;
  }): Promise<SessionLengthsImpact> {
    const conditions: Array<PastLengthCondition> =
      Service.getPastLengthConditions(data.lengths);

    if (conditions.length === 0) {
      return { peopleCount: 0, includesSession: false };
    }

    const query: SelectQueryBuilder<Model> = this.getLiveSessionsQuery();

    const sql: Array<string> = [];
    const parameters: Record<string, unknown> = {};

    conditions.forEach((condition: PastLengthCondition, index: number) => {
      sql.push(`(${Service.getPastLengthSql(condition, index, parameters)})`);
    });

    query.andWhere(`(${sql.join(" OR ")})`, parameters);

    const row:
      | { peopleCount?: unknown; includesSession?: unknown }
      | undefined = await query
      .select('COUNT(DISTINCT session."userId")', "peopleCount")
      .addSelect(
        data.sessionId
          ? `COALESCE(BOOL_OR(session._id = :countedSessionId), false)`
          : "false",
        "includesSession",
      )
      .setParameter("countedSessionId", data.sessionId?.toString() || null)
      .getRawOne();

    return {
      peopleCount: Number(row?.peopleCount || 0),
      includesSession:
        row?.includesSession === true || row?.includesSession === "true",
    };
  }

  /*
   * The conditions under which the lengths end a session, one for each
   * length that is set: its kind's session length passed since sign-in, or
   * its kind's idle timeout passed since its person was last active.
   */
  private static getPastLengthConditions(
    lengths: SessionLengths | null,
  ): Array<PastLengthCondition> {
    const conditions: Array<PastLengthCondition> = [];

    if (!lengths) {
      return conditions;
    }

    for (const isSsoSignIn of [false, true]) {
      const rule: SessionLengthRule = getSessionLengthRule(
        lengths,
        isSsoSignIn,
      );

      if (rule.lengthInMinutes !== null) {
        conditions.push({
          isSsoSignIn,
          reason: SessionEndReason.LengthReached,
          minutes: rule.lengthInMinutes,
        });
      }

      if (rule.idleTimeoutInMinutes !== null) {
        conditions.push({
          isSsoSignIn,
          reason: SessionEndReason.Inactive,
          minutes: rule.idleTimeoutInMinutes,
        });
      }
    }

    return conditions;
  }

  // The sessions still on: not revoked, and with a refresh token that has not run out.
  private getLiveSessionsQuery(): SelectQueryBuilder<Model> {
    return this.getQueryBuilder("session")
      .where("session.isRevoked = false")
      .andWhere("session.refreshTokenExpiresAt > NOW()");
  }

  /*
   * One condition as SQL, its parameters named after `index` so several
   * can be joined. Whether a session is an SSO sign-in is what it was
   * created with (isSsoSignIn): additionalInfo.isGlobalLogin false.
   */
  private static getPastLengthSql(
    condition: PastLengthCondition,
    index: number,
    parameters: Record<string, unknown>,
  ): string {
    const minutesParameter: string = `pastLengthMinutes${index}`;
    parameters[minutesParameter] = condition.minutes;

    const kindSql: string = Service.getSessionKindSql(condition.isSsoSignIn);

    const timeSql: string =
      condition.reason === SessionEndReason.LengthReached
        ? `session.createdAt <= NOW() - make_interval(mins => :${minutesParameter})`
        : `session.lastActiveAt <= NOW() - make_interval(mins => :${minutesParameter})`;

    return `${kindSql} AND ${timeSql}`;
  }

  /*
   * The sessions of one kind as SQL: SSO sign-ins, or every other. Whether a
   * session is an SSO sign-in is what it was created with (isSsoSignIn):
   * additionalInfo.isGlobalLogin false.
   */
  private static getSessionKindSql(isSsoSignIn: boolean): string {
    return isSsoSignIn
      ? `(session.additionalInfo ->> 'isGlobalLogin') = 'false'`
      : `(session.additionalInfo ->> 'isGlobalLogin') IS DISTINCT FROM 'false'`;
  }

  /*
   * THE SESSIONS THAT DID NOT SIGN IN WITH SINGLE SIGN-ON, of everyone but
   * master admins (#6116).
   *
   * While the whole server requires SSO (GlobalConfig.requireSsoForLogin),
   * a session that signed in another way - a password or a sign-in link, a
   * passkey, Sign in with Google or Microsoft, from Vercel, or one that does
   * not say - opens no project, but it lives on: its person stays signed in
   * to their account, and it renews for 30 days. A master admin can end
   * them all at once (Admin Dashboard > Settings > Single Sign-On), and asks
   * first how many people that signs out. Master admins are left out: the
   * server never requires SSO of them, and their own session is how the
   * change was made. Whether a session is an SSO sign-in is what it was
   * created with (getSessionKindSql).
   */
  private getSessionsSignedInWithoutSsoQuery(): SelectQueryBuilder<Model> {
    return this.getLiveSessionsQuery()
      .andWhere(Service.getSessionKindSql(false))
      .andWhere(
        `session.userId NOT IN (SELECT "masterAdmin"."_id" FROM "User" "masterAdmin" WHERE "masterAdmin"."isMasterAdmin" = true)`,
      );
  }

  // How many people - not master admins - have a session that did not sign in with SSO.
  @CaptureSpan()
  public async countPeopleSignedInWithoutSso(): Promise<number> {
    const row: { peopleCount?: unknown } | undefined =
      await this.getSessionsSignedInWithoutSsoQuery()
        .select('COUNT(DISTINCT session."userId")', "peopleCount")
        .getRawOne();

    return Number(row?.peopleCount || 0);
  }

  /*
   * Ends every such session, a batch at a time, the way the session lengths
   * end theirs (endSessionsSelectedBy): revoked with SignedInWithoutSso's
   * words, so its refresh token is refused from now on, its access token
   * at its next request (isSessionLive), its live updates end at once and
   * its end is in the audit log. Returns how many sessions it ended.
   */
  @CaptureSpan()
  public async endSessionsSignedInWithoutSso(): Promise<number> {
    return await this.endSessionsSelectedBy({
      buildQuery: (): SelectQueryBuilder<Model> => {
        return this.getSessionsSignedInWithoutSsoQuery();
      },
      revokedReason: getSessionEndCauseRevokedReason(
        SessionEndCause.SignedInWithoutSso,
      ),
      description: "signed in without SSO",
    });
  }

  /*
   * Ends these people's sessions that did not sign in with single sign-on -
   * a password or a sign-in link, a passkey, Google or Microsoft - when a
   * master admin cleared their sign-in settings (#9762,
   * Utils/LocalSignInClearing): what those sessions were signed in with is
   * gone. A session signed in with SSO stays. Ended as every other
   * revocation is (endSessionsSelectedBy), with SignInSettingsCleared's
   * words. Returns how many sessions it ended.
   */
  @CaptureSpan()
  public async endSessionsOfPeopleSignedInWithoutSso(
    userIds: Array<ObjectID>,
  ): Promise<number> {
    if (userIds.length === 0) {
      return 0;
    }

    return await this.endSessionsSelectedBy({
      buildQuery: (): SelectQueryBuilder<Model> => {
        return this.getLiveSessionsQuery()
          .andWhere(Service.getSessionKindSql(false))
          .andWhere(`session.userId IN (:...clearedUserIds)`, {
            clearedUserIds: userIds.map((userId: ObjectID): string => {
              return userId.toString();
            }),
          });
      },
      revokedReason: getSessionEndCauseRevokedReason(
        SessionEndCause.SignInSettingsCleared,
      ),
      description: "of people whose sign-in settings were cleared",
    });
  }

  // Ends the sessions one condition ends, a batch at a time; how many it ended.
  private async endSessionsWhere(
    condition: PastLengthCondition,
  ): Promise<number> {
    return await this.endSessionsSelectedBy({
      buildQuery: (): SelectQueryBuilder<Model> => {
        const parameters: Record<string, unknown> = {};

        return this.getLiveSessionsQuery().andWhere(
          Service.getPastLengthSql(condition, 0, parameters),
          parameters,
        );
      },
      revokedReason: SESSION_END_REVOKED_REASONS[condition.reason],
      description: "past their length",
    });
  }

  /*
   * Ends, a batch at a time, the sessions that have run out and that
   * nobody has ended yet - so their ends are in the audit log within
   * minutes of happening, rather than whenever their browser or app comes
   * back, if it ever does (issue #6762). Three kinds of session are past
   * saving, and only those:
   *
   *   - one whose refresh token ran out: 30 days without use, which its
   *     next refresh refuses all the same;
   *   - one past its session length, when a master admin set one: the
   *     length counts from its sign-in, however active its person is;
   *   - one past its idle timeout, when a master admin set one, that no
   *     browser can still be using (issue #8188): its last renewal said
   *     its browser renews while its person uses OneUptime
   *     (REPORTS_ACTIVITY_WHILE_IN_USE_FIELD), and nothing has been heard
   *     of it for its idle timeout and IDLE_TIMEOUT_SWEEP_MARGIN_IN_MINUTES
   *     more since its last activity (endSessionsPastIdleTimeout).
   *     Recorded as having run out at that last activity plus the idle
   *     timeout, within minutes of it, rather than 30 days later as "Not
   *     used for 30 days".
   *
   * Any other session past its idle timeout alone - its last renewal from
   * the mobile app, or from a tab of an earlier release - is decided at its
   * next renewal, which says how long its person has really been away
   * (decideRenewal), and recorded then.
   *
   * Only sessions that ran out in the last SESSIONS_RAN_OUT_LOOKBACK_IN_HOURS
   * are ended: the first sweep after an upgrade records a day of them at
   * most, not everyone who stopped using OneUptime in the last month. Each
   * is revoked with its cause's words, as a refresh would have ended it.
   * Returns how many sessions it ended.
   */
  @CaptureSpan()
  public async endSessionsThatRanOut(
    lengths: SessionLengths | null,
  ): Promise<number> {
    let ended: number = await this.endSessionsSelectedBy({
      buildQuery: (): SelectQueryBuilder<Model> => {
        return this.getQueryBuilder("session")
          .where("session.isRevoked = false")
          .andWhere("session.refreshTokenExpiresAt <= NOW()")
          .andWhere(
            "session.refreshTokenExpiresAt > NOW() - make_interval(hours => :ranOutLookbackHours)",
            { ranOutLookbackHours: SESSIONS_RAN_OUT_LOOKBACK_IN_HOURS },
          );
      },
      revokedReason: getSessionEndCauseRevokedReason(SessionEndCause.Expired),
      description: "whose refresh token ran out",
    });

    for (const condition of Service.getPastLengthConditions(lengths)) {
      if (condition.reason !== SessionEndReason.LengthReached) {
        ended += await this.endSessionsPastIdleTimeout(condition);
        continue;
      }

      ended += await this.endSessionsSelectedBy({
        buildQuery: (): SelectQueryBuilder<Model> => {
          const parameters: Record<string, unknown> = {
            ranOutLookbackMinutes:
              condition.minutes + SESSIONS_RAN_OUT_LOOKBACK_IN_HOURS * 60,
          };

          return this.getLiveSessionsQuery()
            .andWhere(
              Service.getPastLengthSql(condition, 0, parameters),
              parameters,
            )
            .andWhere(
              "session.createdAt > NOW() - make_interval(mins => :ranOutLookbackMinutes)",
              parameters,
            );
        },
        revokedReason: SESSION_END_REVOKED_REASONS[condition.reason],
        description: "past their length",
      });
    }

    return ended;
  }

  /*
   * Ends the live sessions of one kind past its idle timeout that no
   * browser could still be using (issue #8188): the browser of each said,
   * at the session's last renewal, that it renews within
   * ACTIVITY_REPORTED_WITHIN_IN_MINUTES of its person's activity while they
   * use OneUptime, and has said nothing for the idle timeout and
   * IDLE_TIMEOUT_SWEEP_MARGIN_IN_MINUTES since its last activity. Only those
   * that ran out in the last SESSIONS_RAN_OUT_LOOKBACK_IN_HOURS, by the
   * database's clock. Each is revoked as the idle timeout, and recorded as
   * having run out at its last activity plus the idle timeout (getRanOutAt).
   *
   * A renewal that lands between the read and the write moves the
   * session's last activity on, and the write asks again: a session whose
   * last activity is now later than the cutoff is left as it is.
   */
  private async endSessionsPastIdleTimeout(
    condition: PastLengthCondition,
  ): Promise<number> {
    const cutoff: Date = getIdleTimeoutSweepCutoff({
      idleTimeoutInMinutes: condition.minutes,
      now: OneUptimeDate.getCurrentDate(),
    });

    return await this.endSessionsSelectedBy({
      buildQuery: (): SelectQueryBuilder<Model> => {
        const parameters: Record<string, unknown> = {
          reportsActivityWhileInUseKey: REPORTS_ACTIVITY_WHILE_IN_USE_FIELD,
          idleSweepMinutes:
            condition.minutes + IDLE_TIMEOUT_SWEEP_MARGIN_IN_MINUTES,
          ranOutLookbackMinutes:
            condition.minutes + SESSIONS_RAN_OUT_LOOKBACK_IN_HOURS * 60,
        };

        return this.getLiveSessionsQuery()
          .andWhere(Service.getSessionKindSql(condition.isSsoSignIn))
          .andWhere(
            "(session.additionalInfo ->> :reportsActivityWhileInUseKey) = 'true'",
            parameters,
          )
          .andWhere(
            "session.lastActiveAt <= NOW() - make_interval(mins => :idleSweepMinutes)",
            parameters,
          )
          .andWhere(
            "session.lastActiveAt > NOW() - make_interval(mins => :ranOutLookbackMinutes)",
            parameters,
          );
      },
      revokedReason: SESSION_END_REVOKED_REASONS[SessionEndReason.Inactive],
      description: "past their idle timeout",
      revokeOnlyWhere: {
        lastActiveAt: QueryHelper.lessThanEqualTo(cutoff),
      },
    });
  }

  /*
   * Ends the sessions a query selects, a batch at a time, each revoked with
   * `revokedReason` - through updateBy, so every one ends its live updates
   * and its end is recorded (onUpdateSuccess). How many it ended.
   */
  private async endSessionsSelectedBy(data: {
    buildQuery: () => SelectQueryBuilder<Model>;
    revokedReason: string;
    description: string;
    // What the write asks of each session again, beside being live.
    revokeOnlyWhere?: Query<Model> | undefined;
  }): Promise<number> {
    let ended: number = 0;

    for (let batch: number = 0; batch < MAX_SESSION_END_BATCHES; batch++) {
      const rows: Array<{ sessionId?: unknown }> = await data
        .buildQuery()
        .select("session._id", "sessionId")
        .limit(SESSIONS_ENDED_PER_BATCH)
        .getRawMany();

      const sessionIds: Array<ObjectID> = rows
        .map((row: { sessionId?: unknown }): string => {
          return String(row.sessionId || "");
        })
        .filter((sessionId: string): boolean => {
          return ObjectID.isValidUUID(sessionId);
        })
        .map((sessionId: string): ObjectID => {
          return new ObjectID(sessionId);
        });

      if (sessionIds.length === 0) {
        return ended;
      }

      await this.updateBy({
        query: {
          ...(data.revokeOnlyWhere || {}),
          _id: QueryHelper.any(sessionIds),
          isRevoked: false,
        },
        data: {
          isRevoked: true,
          revokedAt: OneUptimeDate.getCurrentDate(),
          revokedReason: data.revokedReason,
        },
        limit: SESSIONS_ENDED_PER_BATCH,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      ended += sessionIds.length;

      if (sessionIds.length < SESSIONS_ENDED_PER_BATCH) {
        return ended;
      }
    }

    logger.warn(
      `UserSessionService: stopped ending sessions ${data.description} after ${MAX_SESSION_END_BATCHES} batches; the rest are refused at their next refresh.`,
    );

    return ended;
  }

  public async findActiveSessionByRefreshToken(
    refreshToken: string,
  ): Promise<Model | null> {
    const hashedValue: string = await HashedString.hashValue(
      refreshToken,
      EncryptionSecret,
    );

    return await this.findOneBy({
      query: {
        refreshToken: new HashedString(hashedValue, true),
        isRevoked: false,
      },
      select: {
        _id: true,
        userId: true,
        refreshTokenExpiresAt: true,
        lastActiveAt: true,
        // When it signed in, which the session length counts from.
        createdAt: true,
        isRevoked: true,
        additionalInfo: true,
        deviceName: true,
        deviceType: true,
        deviceOS: true,
        deviceBrowser: true,
        ipAddress: true,
        userAgent: true,
      },
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * Gives a session a new refresh token, or answers null when it was ended
   * while this request was on its way.
   *
   * POST /refresh-token reads the session, decides, and only then writes, several
   * statements later. A new password, a block or a sign-out elsewhere can land in
   * between, and a renewal that wrote over it would hand whoever is refreshing a
   * working session the owner has just ended - and somebody refreshing in a loop
   * is inside that window most of the time. So the write's own predicate asks that
   * the session is still live, as exchanging a status page's login code does, and
   * it never writes isRevoked. A write that finds nothing leaves the row exactly as
   * whatever ended it left it: its reason, and the token that says why
   * (getSessionLengthEndReason).
   *
   * Hook-free, as a single conditional write has to be: this writes no column any
   * hook reacts to, and so hashes the token itself.
   */
  public async renewSessionWithNewRefreshToken(
    options: RenewSessionOptions,
  ): Promise<SessionMetadata | null> {
    const refreshToken: string = Service.generateRefreshToken();
    const refreshTokenExpiresAt: Date =
      options.refreshTokenExpiresAt || Service.getRefreshTokenExpiry();
    const lastActiveAt: Date =
      options.lastActiveAt || OneUptimeDate.getCurrentDate();
    const lengths: SessionLengths | null =
      options.lengths === undefined
        ? await EnterpriseEdition.getUserSessionLengths()
        : options.lengths;

    const updatePayload: Partial<Model> = {
      refreshToken: new HashedString(
        await HashedString.hashValue(refreshToken, EncryptionSecret),
        true,
      ),
      refreshTokenExpiresAt: refreshTokenExpiresAt,
      lastActiveAt: lastActiveAt,
    };

    const ipAddress: string | undefined = Text.truncate(
      options.ipAddress,
      Service.SHORT_TEXT_LIMIT,
    );

    if (ipAddress) {
      updatePayload.ipAddress = ipAddress;
    }

    if (options.userAgent) {
      updatePayload.userAgent = options.userAgent;
    }

    const deviceName: string | undefined = Text.truncate(
      options.deviceName,
      Service.SHORT_TEXT_LIMIT,
    );
    if (deviceName) {
      updatePayload.deviceName = deviceName;
    }

    const deviceType: string | undefined = Text.truncate(
      options.deviceType,
      Service.SHORT_TEXT_LIMIT,
    );
    if (deviceType) {
      updatePayload.deviceType = deviceType;
    }

    const deviceOS: string | undefined = Text.truncate(
      options.deviceOS,
      Service.SHORT_TEXT_LIMIT,
    );
    if (deviceOS) {
      updatePayload.deviceOS = deviceOS;
    }

    const deviceBrowser: string | undefined = Text.truncate(
      options.deviceBrowser,
      Service.SHORT_TEXT_LIMIT,
    );
    if (deviceBrowser) {
      updatePayload.deviceBrowser = deviceBrowser;
    }

    if (options.additionalInfo || options.session.additionalInfo) {
      updatePayload.additionalInfo = {
        ...(options.session.additionalInfo || {}),
        ...(options.additionalInfo || {}),
      } as JSONObject;
    }

    const updateResult: UpdateResult = await this.getRepository().update(
      {
        _id: options.session.id!.toString(),
        isRevoked: false,
        deletedAt: IsNull(),
      } as any,
      updatePayload as any,
    );

    if (updateResult.affected !== 1) {
      return null;
    }

    Object.assign(options.session, updatePayload);

    return Service.buildSessionMetadata({
      session: options.session,
      refreshToken: refreshToken,
      refreshTokenExpiresAt: refreshTokenExpiresAt,
      lengths: lengths,
      // As it was signed in: the renewal never changes that.
      isSsoSignIn: Service.isSsoSignIn(options.session),
      fallbackSignedInAt:
        options.session.createdAt || OneUptimeDate.getCurrentDate(),
      fallbackLastActiveAt: lastActiveAt,
    });
  }

  public async touchSession(
    sessionId: ObjectID,
    options: TouchSessionOptions,
  ): Promise<void> {
    const updatePayload: Partial<Model> = {
      lastActiveAt: OneUptimeDate.getCurrentDate(),
    };

    const ipAddress: string | undefined = Text.truncate(
      options.ipAddress,
      Service.SHORT_TEXT_LIMIT,
    );

    if (ipAddress) {
      updatePayload.ipAddress = ipAddress;
    }

    if (options.userAgent) {
      updatePayload.userAgent = options.userAgent;
    }

    try {
      await this.updateOneById({
        id: sessionId,
        data: updatePayload as any,
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      logger.warn(
        `Failed to update session activity timestamp for session ${sessionId.toString()}: ${(err as Error).message}`,
      );
    }
  }

  public async revokeSessionById(
    sessionId: ObjectID,
    options?: RevokeSessionOptions,
  ): Promise<void> {
    const data: {
      isRevoked: boolean;
      revokedAt: Date;
      revokedReason: string | null;
      lastActiveAt?: Date;
    } = {
      isRevoked: true,
      revokedAt: OneUptimeDate.getCurrentDate(),
      revokedReason: Service.getRevokedReason(options),
    };

    if (options?.lastActiveAt) {
      data.lastActiveAt = options.lastActiveAt;
    }

    await this.updateOneById({
      id: sessionId,
      data: data,
      props: Service.getRevocationProps(options),
    });
  }

  // The words a revocation is kept with: its cause's, or the reason it gives.
  private static getRevokedReason(
    options: RevokeSessionOptions | undefined,
  ): string | null {
    if (options?.cause) {
      return getSessionEndCauseRevokedReason(options.cause);
    }

    return options?.reason ?? null;
  }

  /*
   * A revocation is OneUptime's own write, and carries where the request
   * that asked for it came from, for the audit log's entry about it.
   */
  private static getRevocationProps(
    options: RevokeSessionOptions | undefined,
  ): DatabaseCommonInteractionProps {
    const props: DatabaseCommonInteractionProps = { isRoot: true };

    if (options?.requestOrigin) {
      props.requestOrigin = options.requestOrigin;
    }

    return props;
  }

  // Ends the live session a refresh token belongs to, and answers whether there was one.
  public async revokeSessionByRefreshToken(
    refreshToken: string,
    options?: RevokeSessionOptions,
  ): Promise<boolean> {
    const session: Model | null =
      await this.findActiveSessionByRefreshToken(refreshToken);

    if (!session || !session.id) {
      return false;
    }

    await this.revokeSessionById(session.id, options);

    return true;
  }

  /*
   * Ends `sessionId` when it is a live session of `userId`, and answers
   * whether there was one: the session a sign-out names when the refresh
   * token it sent matches no session (POST /identity/logout) - by its own
   * access token, expired or not (JSONWebToken.decode with acceptExpired,
   * issue #8592), or by a browser's sign-out cookie once that token's
   * cookie has gone (JSONWebToken.decodeSessionToSignOut, issue #8638).
   * The server rotates the refresh token at every renewal and keeps only
   * the new one, so a client whose renewal's answer was lost signs out with
   * the refresh token the renewal replaced; the session both tokens name is
   * still the same one. A session of anybody else, or one already over, is
   * left as it is - a sign-out replayed later ends nothing a second time,
   * and records nothing.
   */
  @CaptureSpan()
  public async revokeLiveSessionOfUser(
    data: { userId: ObjectID; sessionId: ObjectID },
    options?: RevokeSessionOptions,
  ): Promise<boolean> {
    const session: Model | null = await this.findOneBy({
      query: {
        _id: data.sessionId,
        userId: data.userId,
        isRevoked: false,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!session || !session.id) {
      return false;
    }

    await this.revokeSessionById(session.id, options);

    return true;
  }

  public async revokeAllSessionsByUserId(
    userId: ObjectID,
    options?: RevokeSessionOptions,
  ): Promise<void> {
    await this.updateBy({
      query: {
        userId: userId,
        isRevoked: false,
      },
      data: {
        isRevoked: true,
        revokedAt: OneUptimeDate.getCurrentDate(),
        revokedReason: Service.getRevokedReason(options),
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: Service.getRevocationProps(options),
    });
  }

  /*
   * The sessions a revocation is about to end, read before it writes them
   * (and the revocation held to exactly those rows), so the audit log can
   * say what each one was once it has ended: whose it was, how and where it
   * signed in, and when it was last used. A session revoked already is
   * left out: it ended before, and its end was recorded then.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    if (updateBy.data.isRevoked !== true) {
      return { updateBy, carryForward: null };
    }

    const sessions: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      SESSION_END_SELECT,
    );

    const carryForward: RevocationCarryForward = {
      endingSessions: sessions
        .filter((session: Model): boolean => {
          return Boolean(session.id && session.userId && !session.isRevoked);
        })
        .map((session: Model): SessionEnding => {
          return { session };
        }),
    };

    return { updateBy, carryForward };
  }

  /*
   * A session that is revoked - signed out, a password changed, the person
   * blocked, a refresh token past its time - ends at once on every server
   * (RealtimeAccessChanges): its access token is refused at its next request
   * (isSessionLive, #9534) and the live updates opened with it end. Its end
   * goes into the audit log (issue #6762). Every revocation is an update
   * through this service (revokeSessionById, revokeAllSessionsByUserId,
   * endSessionsPastLengths, endSessionsThatRanOut,
   * endSessionsSignedInWithoutSso), so this is where they all pass.
   */
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    if (onUpdate.updateBy.data.isRevoked === true) {
      this.endSessionsEverywhere(updatedItemIds);

      await this.recordSessionEnds({
        carryForward: onUpdate.carryForward as
          | RevocationCarryForward
          | null
          | undefined,
        updatedItemIds: updatedItemIds,
        revokedReason: onUpdate.updateBy.data.revokedReason,
        lastActiveAt: onUpdate.updateBy.data.lastActiveAt,
        props: onUpdate.updateBy.props,
      });
    }

    return onUpdate;
  }

  /*
   * The ends of the sessions a revocation ended - those it read before the
   * write (onBeforeUpdate) and the write did end - in the audit log. Why
   * they ended is what the revocation was kept with
   * (Types/UserSession/SessionEndCause), and when their person was last
   * active is what it wrote, when it wrote that too (a renewal that found
   * the session past its idle timeout knows better than the row it read).
   * Never fails the revocation.
   */
  private async recordSessionEnds(data: {
    carryForward: RevocationCarryForward | null | undefined;
    updatedItemIds: Array<ObjectID>;
    revokedReason: unknown;
    lastActiveAt: unknown;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    try {
      const updated: Set<string> = new Set(
        data.updatedItemIds.map((id: ObjectID): string => {
          return id.toString();
        }),
      );

      const endingSessions: Array<SessionEnding> = (
        data.carryForward?.endingSessions || []
      ).filter((ending: SessionEnding): boolean => {
        return updated.has(ending.session.id!.toString());
      });

      if (endingSessions.length === 0) {
        return;
      }

      const writtenLastActiveAt: Date | null = Service.readWrittenDate(
        data.lastActiveAt,
      );

      if (writtenLastActiveAt) {
        for (const ending of endingSessions) {
          ending.session.lastActiveAt = writtenLastActiveAt;
        }
      }

      const cause: SessionEndCause = readSessionEndCause(data.revokedReason);
      const now: Date = OneUptimeDate.getCurrentDate();

      const lengths: SessionLengths | null =
        cause === SessionEndCause.IdleTimeout ||
        cause === SessionEndCause.LengthReached
          ? await Service.readLengthsForAuditLog()
          : null;

      const events: Array<SessionAuditEvent> = [];

      for (const ending of endingSessions) {
        const event: SessionAuditEvent | null = Service.toSessionEndEvent({
          session: ending.session,
          cause: cause,
          lengths: lengths,
          requestOrigin: data.props.requestOrigin,
          now: now,
        });

        if (event) {
          events.push(event);
        }
      }

      await AuditLogService.recordSessionEvents(events);
    } catch (err) {
      logger.warn("UserSessionService: failed to record the end of sessions");
      logger.warn(err);
    }
  }

  // A date an update wrote, or null for none (or one that is no date).
  private static readWrittenDate(value: unknown): Date | null {
    let date: Date | null = null;

    if (value instanceof Date) {
      date = value;
    } else if (typeof value === "string" || typeof value === "number") {
      date = new Date(value);
    }

    return date && Number.isFinite(date.getTime()) ? date : null;
  }

  /*
   * The session lengths, for saying when a timed-out session ran out, or
   * null when they cannot be read: the entry is recorded without that
   * moment rather than not at all.
   */
  private static async readLengthsForAuditLog(): Promise<SessionLengths | null> {
    try {
      return await EnterpriseEdition.getUserSessionLengths();
    } catch {
      return null;
    }
  }

  // A session that is deleted ends the same way.
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    this.endSessionsEverywhere(itemIdsBeforeDelete);

    return onDelete;
  }

  /*
   * Sessions that have just ended: this server refuses their access tokens
   * at once (forgetEndedSessions), and every server is told, which refuses
   * them too and ends the live updates opened with them.
   */
  private endSessionsEverywhere(sessionIds: Array<ObjectID>): void {
    if (sessionIds.length === 0) {
      return;
    }

    this.forgetEndedSessions(sessionIds);

    RealtimeAccessChanges.announce({
      kind: RealtimeAccessChangeKind.SessionsEnded,
      sessionIds: sessionIds.map((sessionId: ObjectID): string => {
        return sessionId.toString();
      }),
    });
  }

  private buildSessionModel(
    options: CreateSessionOptions,
    tokenMeta: { refreshToken: string; refreshTokenExpiresAt: Date },
  ): Model {
    const session: Model = new Model();
    session.userId = options.userId;
    session.refreshToken = HashedString.fromString(tokenMeta.refreshToken);
    session.refreshTokenExpiresAt = tokenMeta.refreshTokenExpiresAt;
    session.lastActiveAt = OneUptimeDate.getCurrentDate();
    if (options.userAgent) {
      session.userAgent = options.userAgent;
    }

    const deviceName: string | undefined = Text.truncate(
      options.deviceName,
      Service.SHORT_TEXT_LIMIT,
    );
    if (deviceName) {
      session.deviceName = deviceName;
    }

    const deviceType: string | undefined = Text.truncate(
      options.deviceType,
      Service.SHORT_TEXT_LIMIT,
    );
    if (deviceType) {
      session.deviceType = deviceType;
    }

    const deviceOS: string | undefined = Text.truncate(
      options.deviceOS,
      Service.SHORT_TEXT_LIMIT,
    );
    if (deviceOS) {
      session.deviceOS = deviceOS;
    }

    const deviceBrowser: string | undefined = Text.truncate(
      options.deviceBrowser,
      Service.SHORT_TEXT_LIMIT,
    );
    if (deviceBrowser) {
      session.deviceBrowser = deviceBrowser;
    }

    const ipAddress: string | undefined = Text.truncate(
      options.ipAddress,
      Service.SHORT_TEXT_LIMIT,
    );
    if (ipAddress) {
      session.ipAddress = ipAddress;
    }

    /*
     * How it signed in and from where, kept for the audit log's entries
     * about it (Types/UserSession/SessionSignIn): its sign-in says them,
     * and so does its end, whenever that comes.
     */
    session.additionalInfo = {
      ...(options.additionalInfo || {}),
      ...toSessionSignInInfo({
        signIn: options.signIn,
        origin: Service.getSignInOrigin(options),
      }),
      isGlobalLogin: options.isGlobalLogin,
    } as JSONObject;

    /*
     * Kept only as a whole record of the shape a sign-out reads back
     * (readIdentityProviderSignOutRecord); its ID token, or its SAML Name ID
     * and SessionIndex, are encrypted on the way in
     * (UserSession.identityProviderSignOut).
     */
    const identityProviderSignOut: IdentityProviderSignOutRecord | null =
      readIdentityProviderSignOutRecord(options.identityProviderSignOut);

    if (identityProviderSignOut) {
      session.identityProviderSignOut = {
        ...identityProviderSignOut,
      } as unknown as JSONObject;
    }

    return session;
  }

  /*
   * What signing the person of a live session out of their identity
   * provider too takes (Types/SSO/IdentityProviderSignOut), or null: the
   * session a sign-out is about to end, named by its refresh token or by its
   * id and person, as POST /identity/logout names it. Read before the
   * session ends; a session ended already gives nothing.
   */
  @CaptureSpan()
  public async findIdentityProviderSignOut(
    data: { refreshToken: string } | { sessionId: ObjectID; userId: ObjectID },
  ): Promise<SessionIdentityProviderSignOut | null> {
    const query: Query<Model> =
      "refreshToken" in data
        ? {
            refreshToken: new HashedString(
              await HashedString.hashValue(data.refreshToken, EncryptionSecret),
              true,
            ),
            isRevoked: false,
          }
        : {
            _id: data.sessionId,
            userId: data.userId,
            isRevoked: false,
          };

    const session: Model | null = await this.findOneBy({
      query: query,
      select: {
        _id: true,
        identityProviderSignOut: true,
      },
      props: {
        isRoot: true,
      },
    });

    const record: IdentityProviderSignOutRecord | null =
      readIdentityProviderSignOutRecord(session?.identityProviderSignOut);

    if (!session?.id || !record) {
      return null;
    }

    return { sessionId: session.id, record: record };
  }

  /*
   * Clears what a session kept to sign its person out of their identity
   * provider, once a sign-out has used it: the ID token is kept no longer
   * than the session. A write of that column alone, which no hook reacts to.
   */
  @CaptureSpan()
  public async forgetIdentityProviderSignOut(
    sessionId: ObjectID,
  ): Promise<void> {
    await this.getRepository().update(
      {
        _id: sessionId.toString(),
      } as any,
      {
        identityProviderSignOut: null,
      } as any,
    );
  }

  /*
   * The live sessions of a person that a browser sign-in through this SAML
   * provider gave while its "Sign out of the identity provider too" switch
   * was on, with what each kept of the sign-in (#9603): what the identity
   * provider's own sign-out request may end - the person signed out there,
   * or of another app that uses it. Only a session that kept a record of
   * this very provider is one: a sign-in through another provider, or
   * without SSO, is never ended by this one.
   */
  @CaptureSpan()
  public async findLiveSessionsSignedInThroughSamlProvider(data: {
    userId: ObjectID;
    providerType: SsoProviderType.GlobalSSO | SsoProviderType.ProjectSSO;
    providerId: ObjectID;
  }): Promise<Array<SessionSignedInThroughSamlProvider>> {
    const sessions: Array<Model> = await this.findBy({
      query: {
        userId: data.userId,
        isRevoked: false,
      },
      select: {
        _id: true,
        identityProviderSignOut: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const found: Array<SessionSignedInThroughSamlProvider> = [];

    for (const session of sessions) {
      const record: IdentityProviderSignOutRecord | null =
        readIdentityProviderSignOutRecord(session.identityProviderSignOut);

      if (
        !session.id ||
        !record ||
        !isSamlIdentityProviderSignOutRecord(record) ||
        record.providerType !== data.providerType ||
        record.providerId.toLowerCase() !==
          data.providerId.toString().toLowerCase()
      ) {
        continue;
      }

      found.push({ sessionId: session.id, record: record });
    }

    return found;
  }

  /*
   * Where a sign-in came from: what the request said (RequestOriginUtil), or
   * the device its User-Agent describes when the caller handed no request
   * over. Only words OneUptime spells out (UserAgentDevice).
   */
  private static getSignInOrigin(
    options: CreateSessionOptions,
  ): SessionSignInOrigin {
    if (options.requestOrigin) {
      return {
        device: options.requestOrigin.device,
        location: options.requestOrigin.location,
      };
    }

    return { device: Service.describeDevice(options.userAgent) };
  }

  // A device in a few words ("Chrome 130 on macOS"), read off a User-Agent.
  private static describeDevice(
    userAgent: string | null | undefined,
  ): string | undefined {
    if (!userAgent) {
      return undefined;
    }

    return UserAgentDevice.describe(
      UserAgentDevice.read({ userAgent: userAgent }),
    );
  }

  /*
   * The audit log's sign-in event for a session just made: how and from
   * where, as the session keeps them - so the entry about its end, read
   * from the same row, says the same.
   */
  public static toSignInEvent(data: {
    session: Model;
    userId: ObjectID;
    requestOrigin?: RequestOrigin | undefined;
  }): SessionAuditEvent {
    const origin: SessionSignInOrigin = readSessionSignInOrigin(
      data.session.additionalInfo,
    );

    return {
      action: AuditLogAction.SignIn,
      userId: data.userId,
      sessionId: data.session.id!,
      signIn: readSessionSignIn(data.session.additionalInfo),
      device: origin.device,
      location: origin.location,
      ipAddress:
        data.requestOrigin?.ipAddress || data.session.ipAddress || undefined,
    };
  }

  /*
   * The audit log's event for a session's end, from the session as it was
   * before the revocation (onBeforeUpdate read it), or null for a row that
   * names no person.
   *
   * The address is the sign-out request's, for a sign-out, and otherwise
   * the last one the session was used from: an entry about a session says
   * where that session was, never where the password change or the block
   * that ended it came from. A timeout says
   * when it ran out: OneUptime notices a session's end at its next refresh,
   * or at the next sweep (endSessionsThatRanOut), which can be later.
   */
  public static toSessionEndEvent(data: {
    session: Model;
    cause: SessionEndCause;
    lengths: SessionLengths | null;
    requestOrigin?: RequestOrigin | undefined;
    now: Date;
  }): SessionAuditEvent | null {
    if (!data.session.id || !data.session.userId) {
      return null;
    }

    const origin: SessionSignInOrigin = readSessionSignInOrigin(
      data.session.additionalInfo,
    );

    const event: SessionAuditEvent = {
      action: getSessionEndAuditLogAction(data.cause),
      userId: data.session.userId,
      sessionId: data.session.id,
      signIn: readSessionSignIn(data.session.additionalInfo),
      device: origin.device || Service.describeDevice(data.session.userAgent),
      location: origin.location,
      ipAddress:
        (data.cause === SessionEndCause.SignedOut
          ? data.requestOrigin?.ipAddress
          : undefined) ||
        data.session.ipAddress ||
        undefined,
      endCause: data.cause,
    };

    if (data.session.createdAt) {
      event.signedInAt = new Date(data.session.createdAt);
    }

    if (data.session.lastActiveAt) {
      event.lastActiveAt = new Date(data.session.lastActiveAt);
    }

    const endedAt: Date | null = Service.getRanOutAt({
      session: data.session,
      cause: data.cause,
      lengths: data.lengths,
      now: data.now,
    });

    if (endedAt) {
      event.endedAt = endedAt;
    }

    return event;
  }

  /*
   * When a timed-out session ran out, or null for any other end (it ended
   * when it was revoked) and for one whose moment cannot be told: its
   * refresh token's end; its last activity plus its idle timeout; its
   * sign-in plus its session length. Never later than now.
   */
  public static getRanOutAt(data: {
    session: Pick<
      Model,
      "createdAt" | "lastActiveAt" | "additionalInfo" | "refreshTokenExpiresAt"
    >;
    cause: SessionEndCause;
    lengths: SessionLengths | null;
    now: Date;
  }): Date | null {
    let ranOutAtMs: number | null = null;

    if (data.cause === SessionEndCause.Expired) {
      ranOutAtMs = data.session.refreshTokenExpiresAt
        ? new Date(data.session.refreshTokenExpiresAt).getTime()
        : null;
    } else if (
      data.cause === SessionEndCause.IdleTimeout ||
      data.cause === SessionEndCause.LengthReached
    ) {
      const facts: SessionFacts = Service.getSessionFacts(
        data.session,
        data.now,
      );
      const rule: SessionLengthRule = getSessionLengthRule(
        data.lengths,
        facts.isSsoSignIn,
      );

      if (data.cause === SessionEndCause.IdleTimeout && data.lengths) {
        ranOutAtMs =
          facts.lastActiveAt.getTime() +
          getIdleTimeoutInMinutes(rule) * 60 * 1000;
      }

      if (
        data.cause === SessionEndCause.LengthReached &&
        rule.lengthInMinutes !== null
      ) {
        ranOutAtMs =
          facts.signedInAt.getTime() + rule.lengthInMinutes * 60 * 1000;
      }
    }

    if (ranOutAtMs === null || !Number.isFinite(ranOutAtMs)) {
      return null;
    }

    return new Date(Math.min(ranOutAtMs, data.now.getTime()));
  }

  private static generateRefreshToken(): string {
    return ObjectID.generate().toString();
  }

  private static getRefreshTokenExpiry(): Date {
    return OneUptimeDate.getSomeDaysAfter(
      Service.DEFAULT_REFRESH_TOKEN_TTL_DAYS,
    );
  }
}

// One way the session lengths end a session (Service.getPastLengthConditions).
interface PastLengthCondition {
  isSsoSignIn: boolean;
  reason: SessionEndReason;
  minutes: number;
}

export default new Service();
