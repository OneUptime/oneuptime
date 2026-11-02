import DatabaseService from "./DatabaseService";
import EnterpriseEdition from "../Enterprise/EnterpriseEdition";
import { OnDelete, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import { SelectQueryBuilder } from "typeorm";
import RealtimeAccessChanges, {
  RealtimeAccessChangeKind,
} from "../Utils/Realtime/RealtimeAccessChanges";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Model from "../../Models/DatabaseModels/UserSession";
import ObjectID from "../../Types/ObjectID";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import { JSONObject } from "../../Types/JSON";
import HashedString from "../../Types/HashedString";
import { EncryptionSecret } from "../EnvironmentConfig";
import OneUptimeDate from "../../Types/Date";
import Text from "../../Types/Text";
import logger from "../Utils/Logger";
import Exception from "../../Types/Exception/Exception";
import BadDataException from "../../Types/Exception/BadDataException";
import {
  DEFAULT_SESSION_IDLE_DAYS,
  getActivityAtRenewal,
  getSessionEnd,
  getSessionEndReachedBy,
  getSessionLengthRule,
  SessionEnd,
  SessionEndReason,
  SessionFacts,
  SessionLengthRule,
  SessionLengths,
} from "../../Types/UserSession/SessionLength";

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
 * reason, so a refresh that comes after can say why it ended.
 */
export const SESSION_END_REVOKED_REASONS: Readonly<
  Record<SessionEndReason, string>
> = {
  [SessionEndReason.LengthReached]: "Session length reached",
  [SessionEndReason.Inactive]: "Idle timeout reached",
};

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
  reason?: string | undefined;
}

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
   * updates on every server (onUpdateSuccess).
   */
  @CaptureSpan()
  public async endSessionByLength(
    sessionId: ObjectID,
    reason: SessionEndReason,
  ): Promise<void> {
    await this.revokeSessionById(sessionId, {
      reason: SESSION_END_REVOKED_REASONS[reason],
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
   * it (endSessionByLength), so its live updates end on every server and
   * its next request and refresh are refused - by the database's clock,
   * which keeps the sessions' own times. Only lengths that are set end
   * anything. Returns how many sessions it ended.
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

    const row: { peopleCount?: unknown; includesSession?: unknown } | undefined =
      await query
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
    let ended: number = 0;

    for (let batch: number = 0; batch < MAX_SESSION_END_BATCHES; batch++) {
      const parameters: Record<string, unknown> = {};
      const rows: Array<{ sessionId?: unknown }> =
        await this.getLiveSessionsQuery()
          .andWhere(Service.getPastLengthSql(condition, 0, parameters), parameters)
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
          revokedReason: SESSION_END_REVOKED_REASONS[condition.reason],
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
      `UserSessionService: stopped ending sessions past their length after ${MAX_SESSION_END_BATCHES} batches; the rest are refused at their next refresh.`,
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

  public async renewSessionWithNewRefreshToken(
    options: RenewSessionOptions,
  ): Promise<SessionMetadata> {
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
      refreshToken: HashedString.fromString(refreshToken),
      refreshTokenExpiresAt: refreshTokenExpiresAt,
      lastActiveAt: lastActiveAt,
      isRevoked: false,
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

    const updatedSession: Model | null = await this.updateOneByIdAndFetch({
      id: options.session.id!,
      data: updatePayload as any,
      props: {
        isRoot: true,
      },
    });

    if (!updatedSession) {
      throw new BadDataException("Unable to renew user session");
    }

    return Service.buildSessionMetadata({
      session: updatedSession,
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
        revokedReason: options?.reason ?? null,
      },
      props: {
        isRoot: true,
      },
    });
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
        revokedReason: options?.reason ?? null,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * A session that is revoked - signed out, a password changed, the person
   * blocked, a refresh token past its time - ends the live updates opened
   * with it at once, on every server (RealtimeAccessChanges). Every
   * revocation is an update through this service (revokeSessionById,
   * revokeAllSessionsByUserId), so this is where they all pass.
   */
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    if (onUpdate.updateBy.data.isRevoked === true) {
      Service.endLiveUpdatesOfSessions(updatedItemIds);
    }

    return onUpdate;
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

    session.additionalInfo = {
      ...(options.additionalInfo || {}),
      isGlobalLogin: options.isGlobalLogin,
    } as JSONObject;

    return session;
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
