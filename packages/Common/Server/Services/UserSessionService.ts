import AuditLogService from "./AuditLogService";
import DatabaseService from "./DatabaseService";
import EnterpriseEdition from "../Enterprise/EnterpriseEdition";
import { OnDelete, OnUpdate } from "../Types/Database/Hooks";
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
  DEFAULT_SESSION_IDLE_DAYS,
  getActivityAtRenewal,
  getIdleTimeoutInMinutes,
  getSessionEnd,
  getSessionEndReachedBy,
  getSessionLengthRule,
  SessionEnd,
  SessionEndReason,
  SessionFacts,
  SessionLengthRule,
  SessionLengths,
} from "../../Types/UserSession/SessionLength";
import {
  readSessionSignIn,
  readSessionSignInOrigin,
  SessionSignIn,
  SessionSignInOrigin,
  toSessionSignInInfo,
} from "../../Types/UserSession/SessionSignIn";

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
 * that the session has ended, and why, or when its person was last active
 * and the lengths it is renewed under.
 */
export type SessionRenewalDecision =
  | { hasEnded: true; reason: SessionEndReason }
  | {
      hasEnded: false;
      lastActiveAt: Date;
      lengths: SessionLengths | null;
    };

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

  public constructor() {
    super(Model);

    /*
     * Bound retention of expired and revoked sessions, including device data,
     * without deleting sessions that have renewed their refresh credentials.
     */
    this.hardDeleteItemsOlderThanInDays("refreshTokenExpiresAt", 30);
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
   * SessionLength.ts) - the one place a renewal asks:
   *
   *   - ended when its kind's session length has passed since it signed in;
   *   - ended when its person has not been active for its kind's idle
   *     timeout. While an idle timeout is set, a browser's report of how
   *     long its person has not used OneUptime counts
   *     (reportedInactivityInSeconds, held within what the session knew
   *     already and now); otherwise, and for a renewal without one, the
   *     renewal itself is the activity - as every renewal has always been.
   *
   * Throws when the lengths cannot be read: the renewal is refused, never
   * made past them.
   */
  @CaptureSpan()
  public async decideRenewal(data: {
    session: Model;
    reportedInactivityInSeconds: number | null;
  }): Promise<SessionRenewalDecision> {
    const lengths: SessionLengths | null =
      await EnterpriseEdition.getUserSessionLengths();
    const now: Date = OneUptimeDate.getCurrentDate();
    const facts: SessionFacts = Service.getSessionFacts(data.session, now);
    const rule: SessionLengthRule = getSessionLengthRule(
      lengths,
      facts.isSsoSignIn,
    );

    const reportedInactivityInSeconds: number | null =
      rule.idleTimeoutInMinutes === null
        ? null
        : data.reportedInactivityInSeconds;

    const lastActiveAt: Date = getActivityAtRenewal({
      storedLastActiveAt: facts.lastActiveAt,
      reportedInactivityInSeconds: reportedInactivityInSeconds,
      now: now,
    });

    const reason: SessionEndReason | null = getSessionEndReachedBy(
      {
        ...facts,
        // Without a report, inactivity is what the session knew of it.
        lastActiveAt:
          reportedInactivityInSeconds === null
            ? facts.lastActiveAt
            : lastActiveAt,
      },
      lengths,
      now,
    );

    if (reason) {
      return { hasEnded: true, reason: reason };
    }

    return { hasEnded: false, lastActiveAt: lastActiveAt, lengths: lengths };
  }

  /*
   * Ends a session the server's session lengths have ended: revoked, with
   * the reason kept (SESSION_END_REVOKED_REASONS), which also ends its live
   * updates on every server and records its timeout in the audit log
   * (onUpdateSuccess).
   */
  @CaptureSpan()
  public async endSessionByLength(
    sessionId: ObjectID,
    reason: SessionEndReason,
  ): Promise<void> {
    await this.revokeSessionById(sessionId, {
      cause:
        reason === SessionEndReason.LengthReached
          ? SessionEndCause.LengthReached
          : SessionEndCause.IdleTimeout,
    });
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

    const kindSql: string = condition.isSsoSignIn
      ? `(session.additionalInfo ->> 'isGlobalLogin') = 'false'`
      : `(session.additionalInfo ->> 'isGlobalLogin') IS DISTINCT FROM 'false'`;

    const timeSql: string =
      condition.reason === SessionEndReason.LengthReached
        ? `session.createdAt <= NOW() - make_interval(mins => :${minutesParameter})`
        : `session.lastActiveAt <= NOW() - make_interval(mins => :${minutesParameter})`;

    return `${kindSql} AND ${timeSql}`;
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
   * back, if it ever does (issue #6762). Two kinds of session are past
   * saving, and only those:
   *
   *   - one whose refresh token ran out: 30 days without use, which its
   *     next refresh refuses all the same;
   *   - one past its session length, when a master admin set one: the
   *     length counts from its sign-in, however active its person is.
   *
   * Never a session past its idle timeout alone: a browser that renews it
   * says how long its person has not used OneUptime, and that is what the
   * timeout counts from (decideRenewal) - so whether it has timed out is
   * decided at its renewal, and recorded then.
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
   * Ends the sessions a query selects, a batch at a time, each revoked with
   * `revokedReason` - through updateBy, so every one ends its live updates
   * and its end is recorded (onUpdateSuccess). How many it ended.
   */
  private async endSessionsSelectedBy(data: {
    buildQuery: () => SelectQueryBuilder<Model>;
    revokedReason: string;
    description: string;
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
    await this.updateOneById({
      id: sessionId,
      data: {
        isRevoked: true,
        revokedAt: OneUptimeDate.getCurrentDate(),
        revokedReason: Service.getRevokedReason(options),
      },
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

  public async revokeSessionByRefreshToken(
    refreshToken: string,
    options?: RevokeSessionOptions,
  ): Promise<void> {
    const session: Model | null =
      await this.findActiveSessionByRefreshToken(refreshToken);

    if (!session || !session.id) {
      return;
    }

    await this.revokeSessionById(session.id, options);
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
   * blocked, a refresh token past its time - ends the live updates opened
   * with it at once, on every server (RealtimeAccessChanges), and its end
   * goes into the audit log (issue #6762). Every revocation is an update
   * through this service (revokeSessionById, revokeAllSessionsByUserId,
   * endSessionsPastLengths, endSessionsThatRanOut), so this is where they
   * all pass.
   */
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    if (onUpdate.updateBy.data.isRevoked === true) {
      Service.endLiveUpdatesOfSessions(updatedItemIds);

      await this.recordSessionEnds({
        carryForward: onUpdate.carryForward as
          | RevocationCarryForward
          | null
          | undefined,
        updatedItemIds: updatedItemIds,
        revokedReason: onUpdate.updateBy.data.revokedReason,
        props: onUpdate.updateBy.props,
      });
    }

    return onUpdate;
  }

  /*
   * The ends of the sessions a revocation ended - those it read before the
   * write (onBeforeUpdate) and the write did end - in the audit log. Why
   * they ended is what the revocation was kept with
   * (Types/UserSession/SessionEndCause). Never fails the revocation.
   */
  private async recordSessionEnds(data: {
    carryForward: RevocationCarryForward | null | undefined;
    updatedItemIds: Array<ObjectID>;
    revokedReason: unknown;
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

  // A session that is deleted ends its live updates the same way.
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    Service.endLiveUpdatesOfSessions(itemIdsBeforeDelete);

    return onDelete;
  }

  private static endLiveUpdatesOfSessions(sessionIds: Array<ObjectID>): void {
    if (sessionIds.length === 0) {
      return;
    }

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

    return session;
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
