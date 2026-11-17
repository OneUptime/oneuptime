import AuditLogService from "./AuditLogService";
import DatabaseService from "./DatabaseService";
import StatusPagePrivateUserService from "./StatusPagePrivateUserService";
import StatusPageService from "./StatusPageService";
import { OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import UserAgentDevice from "../Utils/RequestOrigin/UserAgentDevice";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Model from "../../Models/DatabaseModels/StatusPagePrivateUserSession";
import StatusPage from "../../Models/DatabaseModels/StatusPage";
import StatusPagePrivateUser from "../../Models/DatabaseModels/StatusPagePrivateUser";
import AuditLogAction from "../../Types/AuditLog/AuditLogAction";
import { SessionEventAuditLogAction } from "../../Types/AuditLog/AuditLogSessionEvent";
import {
  readStatusPageSessionEnd,
  STATUS_PAGE_SESSION_SIGN_IN_NO_LONGER_ACCEPTED_REASON,
  StatusPageSessionAuditEvent,
  StatusPageSessionEnd,
} from "../../Types/AuditLog/AuditLogStatusPageSession";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import RequestOrigin from "../../Types/RequestOrigin";
import {
  readSessionSignIn,
  readSessionSignInOrigin,
  SessionSignIn,
  SessionSignInOrigin,
  toSessionSignInInfo,
} from "../../Types/UserSession/SessionSignIn";
import StatusPageOidc from "../../Models/DatabaseModels/StatusPageOidc";
import StatusPageSso from "../../Models/DatabaseModels/StatusPageSso";
import ObjectID from "../../Types/ObjectID";
import { JSONObject } from "../../Types/JSON";
import HashedString from "../../Types/HashedString";
import { EncryptionSecret } from "../EnvironmentConfig";
import OneUptimeDate from "../../Types/Date";
import Text from "../../Types/Text";
import logger from "../Utils/Logger";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import Exception from "../../Types/Exception/Exception";
import {
  capRefreshTokenExpiry,
  MAX_PRIVATE_USER_SESSION_LENGTH_IN_HOURS,
  PRIVATE_USER_SESSION_IDLE_DAYS,
  readPrivateUserSessionLength,
} from "../../Types/StatusPage/PrivateUserSessionLength";
import {
  Brackets,
  IsNull,
  JsonContains,
  MoreThan,
  SelectQueryBuilder,
  UpdateResult,
  WhereExpressionBuilder,
} from "typeorm";

export interface SessionMetadata {
  session: Model;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export interface CreateSessionOptions {
  projectId: ObjectID;
  statusPageId: ObjectID;
  statusPagePrivateUserId: ObjectID;
  /*
   * The status page SAML or OIDC provider that signed the person in, when
   * one did: the session counts only while it vouches for it (addSignInRule).
   */
  statusPageSsoId?: ObjectID | undefined;
  statusPageOidcId?: ObjectID | undefined;
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
   * How the reader signed in (Types/UserSession/SessionSignIn), and where
   * from (RequestOriginUtil.fromRequest): the session keeps both, and the
   * audit log says them at its sign-in and again when it ends (issue
   * #6790).
   */
  signIn?: SessionSignIn | undefined;
  requestOrigin?: RequestOrigin | undefined;
}

export interface RenewSessionOptions {
  session: Model;
  refreshTokenExpiresAt?: Date | undefined;
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
  /*
   * Where the request that ended it came from - a sign-out's - for the
   * audit log's entry about it.
   */
  requestOrigin?: RequestOrigin | undefined;
}

export interface ExchangeLoginCodeOptions {
  statusPageId: ObjectID;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  deviceName?: string | undefined;
  deviceType?: string | undefined;
  deviceOS?: string | undefined;
  deviceBrowser?: string | undefined;
  additionalInfo?: JSONObject | undefined;
}

export const STATUS_PAGE_LOGIN_CODE_TTL_MINUTES: number = 5;

// Why a session that no longer counts was ended, as the session records it.
export const SIGN_IN_NO_LONGER_ACCEPTED_REASON: string =
  STATUS_PAGE_SESSION_SIGN_IN_NO_LONGER_ACCEPTED_REASON;

/*
 * A session a revocation is about to end, as the audit log's entry about
 * its end needs it (onBeforeUpdate reads them, onUpdateSuccess records).
 */
interface RevocationCarryForward {
  endingSessions: Array<Model>;
}

// A reader's session, and what happened to it, for the audit log.
export interface SessionEventToRecord {
  session: Model;
  action: SessionEventAuditLogAction;
  // Why it ended (readStatusPageSessionEnd). Not on a sign-in.
  endReason?: string | undefined;
  /*
   * The address of the request the entry is about - the sign-in's, the
   * sign-out's - or none, for the last one the session was used from.
   */
  ipAddress?: string | undefined;
}

// The columns an entry about a reader's session is built from.
const SESSION_AUDIT_SELECT: {
  _id: true;
  projectId: true;
  statusPageId: true;
  statusPagePrivateUserId: true;
  isRevoked: true;
  createdAt: true;
  lastActiveAt: true;
  additionalInfo: true;
  ipAddress: true;
  userAgent: true;
} = {
  _id: true,
  projectId: true,
  statusPageId: true,
  statusPagePrivateUserId: true,
  isRevoked: true,
  createdAt: true,
  lastActiveAt: true,
  additionalInfo: true,
  ipAddress: true,
  userAgent: true,
};

// A session no SSO provider signed in: a password sign-in, or one from before sessions named their provider.
const SESSION_NAMES_NO_PROVIDER_SQL: string =
  "session.statusPageSsoId IS NULL AND session.statusPageOidcId IS NULL";

export class Service extends DatabaseService<Model> {
  private static readonly DEFAULT_REFRESH_TOKEN_TTL_DAYS: number =
    PRIVATE_USER_SESSION_IDLE_DAYS;
  private static readonly LOGIN_CODE_PURPOSE_KEY: string =
    "oneuptimeStatusPageSessionPurpose";
  private static readonly LOGIN_CODE_PURPOSE_VALUE: string = "login-code";
  private static readonly SHORT_TEXT_LIMIT: number = 100;

  public constructor() {
    super(Model);

    /*
     * Login codes use this same column for their five-minute expiry. Purge
     * expired credentials and their device metadata after 30 more days.
     */
    this.hardDeleteItemsOlderThanInDays("refreshTokenExpiresAt", 30);
  }

  public async createSession(
    options: CreateSessionOptions,
  ): Promise<SessionMetadata> {
    const refreshToken: string =
      options.refreshToken || Service.generateRefreshToken();
    const refreshTokenExpiresAt: Date =
      options.refreshTokenExpiresAt ||
      (await this.getRefreshTokenExpiryForPage({
        statusPageId: options.statusPageId,
        startedAt: OneUptimeDate.getCurrentDate(),
      }));

    const session: Model = this.buildSessionModel(options, {
      refreshToken,
      refreshTokenExpiresAt,
    });

    try {
      const createdSession: Model = await this.create({
        data: session,
        props: {
          isRoot: true,
        },
      });

      // Password sign-in and both SSO callbacks issue their session here.
      await this.recordSuccessfulSignIn(options);

      /*
       * The sign-in, in the status page's project's audit log (issue
       * #6790) - unless this is an SSO login code, which signs nobody in
       * until it is exchanged (exchangeLoginCode). Never fails the sign-in.
       */
      if (!this.isLoginCodeSession(createdSession)) {
        await this.recordSessionEvents([
          {
            session: createdSession,
            action: AuditLogAction.SignIn,
            ipAddress: options.requestOrigin?.ipAddress,
          },
        ]);
      }

      return {
        session: createdSession,
        refreshToken,
        refreshTokenExpiresAt,
      };
    } catch (error) {
      throw error as Exception;
    }
  }

  public async createLoginCodeSession(
    options: Omit<
      CreateSessionOptions,
      "refreshToken" | "refreshTokenExpiresAt"
    >,
  ): Promise<SessionMetadata> {
    return await this.createSession({
      ...options,
      additionalInfo: {
        ...(options.additionalInfo || {}),
        [Service.LOGIN_CODE_PURPOSE_KEY]: Service.LOGIN_CODE_PURPOSE_VALUE,
      } as JSONObject,
      refreshTokenExpiresAt: OneUptimeDate.getSomeMinutesAfter(
        STATUS_PAGE_LOGIN_CODE_TTL_MINUTES,
      ),
    });
  }

  public isLoginCodeSession(session: Model): boolean {
    return (
      session.additionalInfo?.[Service.LOGIN_CODE_PURPOSE_KEY] ===
      Service.LOGIN_CODE_PURPOSE_VALUE
    );
  }

  /*
   * WHETHER A STATUS PAGE SESSION STILL COUNTS, AS FAR AS HOW IT SIGNED IN
   * GOES - added to a query over the sessions, aliased "session", so the
   * answer comes from the same database read as the session itself.
   *
   *   - A session signed in with one of the status page's SAML or OIDC
   *     providers (statusPageSsoId, statusPageOidcId) counts only while that
   *     provider vouches for it: it is still there, still this status
   *     page's, turned on, and it was not turned off after the session began
   *     (signInsEndedAt before the session's createdAt, both the database's
   *     time). So turning the provider off, or deleting it, ends the
   *     sessions it signed in, and turning it on again does not bring them
   *     back (Utils/SsoSignInsEnded).
   *   - A session that names no provider - a password sign-in, or an SSO
   *     sign-in from before sessions named their provider - counts only
   *     while the status page does not require SSO (`requiresSso`, its
   *     Require SSO to Sign In, read by the caller with the page): Require
   *     SSO for Login lets in only people an SSO provider signs in.
   *   - Whichever way it signed in, a session counts only for as long as the
   *     page's Sign Readers Out After allows (`sessionLengthInHours`, read by
   *     the caller with the page), counted from its sign-in by the
   *     database's clock: past it, the reader signs in again however active
   *     they are (Types/StatusPage/PrivateUserSessionLength). No limit when
   *     the page has none.
   */
  public addSignInRule(
    query: SelectQueryBuilder<Model>,
    data: { requiresSso: boolean; sessionLengthInHours?: unknown },
  ): SelectQueryBuilder<Model> {
    // A page that requires SSO counts nothing but an SSO sign-in.
    const ruled: SelectQueryBuilder<Model> = this.addSignInRuleCounting(
      query,
      data.requiresSso ? "1 = 0" : SESSION_NAMES_NO_PROVIDER_SQL,
    );

    const sessionLengthInHours: number | null = readPrivateUserSessionLength(
      data.sessionLengthInHours,
    );

    if (sessionLengthInHours === null) {
      return ruled;
    }

    return ruled.andWhere(
      "session.createdAt > NOW() - make_interval(hours => CAST(:sessionLengthInHours AS integer))",
      { sessionLengthInHours },
    );
  }

  /*
   * The rule above, with what it counts of a session no provider signed in
   * given as SQL over the query's aliases.
   */
  private addSignInRuleCounting(
    query: SelectQueryBuilder<Model>,
    sessionWithoutProviderSql: string,
  ): SelectQueryBuilder<Model> {
    const vouchedForBy: (alias: string, column: string) => string = (
      alias: string,
      column: string,
    ): string => {
      return [
        `session.${column} IS NOT NULL`,
        `${alias}._id = session.${column}`,
        `${alias}.statusPageId = session.statusPageId`,
        `${alias}.isEnabled = true`,
        `${alias}.deletedAt IS NULL`,
        `(${alias}.signInsEndedAt IS NULL OR ${alias}.signInsEndedAt < session.createdAt)`,
      ].join(" AND ");
    };

    return query
      .leftJoin(
        StatusPageSso,
        "sessionStatusPageSso",
        "sessionStatusPageSso._id = session.statusPageSsoId",
      )
      .leftJoin(
        StatusPageOidc,
        "sessionStatusPageOidc",
        "sessionStatusPageOidc._id = session.statusPageOidcId",
      )
      .andWhere(
        new Brackets((rule: WhereExpressionBuilder): void => {
          rule.where(sessionWithoutProviderSql);

          rule
            .orWhere(vouchedForBy("sessionStatusPageSso", "statusPageSsoId"))
            .orWhere(vouchedForBy("sessionStatusPageOidc", "statusPageOidcId"));
        }),
      );
  }

  /*
   * Whether this session still counts by the sign-in rule above
   * (addSignInRule), read now, with its status page's own Require SSO to
   * Sign In and Sign Readers Out After, in one database read: a refresh and a
   * login code ask it before they hand the session a new access token. A
   * session whose status page is gone does not count.
   */
  public async doesSignInStillCount(data: {
    sessionId: ObjectID;
  }): Promise<boolean> {
    const session: Model | null = await this.addSignInRuleCounting(
      this.getQueryBuilder("session")
        .select(["session._id"])
        .innerJoin(
          StatusPage,
          "sessionStatusPage",
          "sessionStatusPage._id = session.statusPageId AND sessionStatusPage.deletedAt IS NULL",
        )
        .where("session._id = :sessionId", {
          sessionId: data.sessionId.toString(),
        })
        /*
         * Within the page's Sign Readers Out After, as addSignInRule asks
         * it. A value outside what can be written (a whole number of hours
         * from 1 to a year) is no limit there, and is here too.
         */
        .andWhere(
          `(sessionStatusPage.privateUserSessionLengthInHours IS NULL OR sessionStatusPage.privateUserSessionLengthInHours < 1 OR sessionStatusPage.privateUserSessionLengthInHours > ${MAX_PRIVATE_USER_SESSION_LENGTH_IN_HOURS} OR session.createdAt > NOW() - make_interval(hours => sessionStatusPage.privateUserSessionLengthInHours))`,
        ),
      `sessionStatusPage.requireSsoForLogin IS NOT TRUE AND ${SESSION_NAMES_NO_PROVIDER_SQL}`,
    ).getOne();

    return Boolean(session);
  }

  public async findActiveSessionByRefreshToken(
    refreshToken: string,
  ): Promise<Model | null> {
    const hashedValue: string = await HashedString.hashValue(
      refreshToken,
      EncryptionSecret,
    );

    const session: Model | null = await this.findOneBy({
      query: {
        refreshToken: new HashedString(hashedValue, true),
        isRevoked: false,
      },
      select: {
        _id: true,
        projectId: true,
        statusPageId: true,
        statusPagePrivateUserId: true,
        refreshTokenExpiresAt: true,
        lastActiveAt: true,
        // When it signed in, which Sign Readers Out After counts from.
        createdAt: true,
        additionalInfo: true,
        deviceName: true,
        deviceType: true,
        deviceOS: true,
        deviceBrowser: true,
        ipAddress: true,
        userAgent: true,
        isRevoked: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!session) {
      return null;
    }

    if (
      !session.refreshTokenExpiresAt ||
      OneUptimeDate.hasExpired(session.refreshTokenExpiresAt)
    ) {
      return null;
    }

    return session;
  }

  /*
   * Gives a session a new refresh token, or answers null when it was ended
   * while this request was on its way.
   *
   * POST /status-page-api/refresh-token reads the session, decides, and only then
   * writes, several statements later. A reader's new password or a sign-out can
   * land in between, and a renewal that wrote over it would hand whoever is
   * refreshing a working session the reader has just ended - and somebody
   * refreshing in a loop is inside that window most of the time. So the write's
   * own predicate asks that the session is still live, as exchanging a login code
   * does below, and it never writes isRevoked. A write that finds nothing leaves
   * the row exactly as whatever ended it left it.
   *
   * Hook-free, as a single conditional write has to be: this service has no hook
   * that reacts to these columns, and so it hashes the token itself.
   */
  public async renewSessionWithNewRefreshToken(
    options: RenewSessionOptions,
  ): Promise<SessionMetadata | null> {
    const refreshToken: string = Service.generateRefreshToken();
    const refreshTokenExpiresAt: Date =
      options.refreshTokenExpiresAt ||
      (await this.getRefreshTokenExpiryForPage({
        statusPageId: options.session.statusPageId,
        startedAt: options.session.createdAt,
      }));

    const updatePayload: Partial<Model> = await this.buildRenewalUpdatePayload({
      options,
      refreshToken,
      refreshTokenExpiresAt,
    });

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

    return {
      session: options.session,
      refreshToken,
      refreshTokenExpiresAt,
    };
  }

  /**
   * Atomically consume the short-lived login code and replace it with the
   * long-lived refresh credential that is delivered only as an HttpOnly
   * cookie. The refresh-token column is unique and included in the UPDATE
   * predicate, so concurrent redemption attempts cannot both succeed.
   */
  public async exchangeLoginCode(
    loginCode: string,
    options: ExchangeLoginCodeOptions,
  ): Promise<SessionMetadata | null> {
    if (!ObjectID.isValidUUID(loginCode)) {
      return null;
    }

    const session: Model | null =
      await this.findActiveSessionByRefreshToken(loginCode);

    if (
      !session?.id ||
      !session.statusPageId ||
      !session.statusPagePrivateUserId ||
      !session.projectId ||
      !this.isLoginCodeSession(session) ||
      session.statusPageId.toString() !== options.statusPageId.toString()
    ) {
      return null;
    }

    const refreshToken: string = Service.generateRefreshToken();
    // The login code was issued at the sign-in: the session counts from it.
    const refreshTokenExpiresAt: Date = await this.getRefreshTokenExpiryForPage(
      {
        statusPageId: session.statusPageId,
        startedAt: session.createdAt,
      },
    );
    const renewalOptions: RenewSessionOptions = {
      session,
      ipAddress: options.ipAddress,
      userAgent: options.userAgent,
      deviceName: options.deviceName,
      deviceType: options.deviceType,
      deviceOS: options.deviceOS,
      deviceBrowser: options.deviceBrowser,
      additionalInfo: options.additionalInfo,
    };
    const updatePayload: Partial<Model> = await this.buildRenewalUpdatePayload({
      options: renewalOptions,
      refreshToken,
      refreshTokenExpiresAt,
    });
    const additionalInfo: JSONObject = {
      ...(updatePayload.additionalInfo || {}),
    } as JSONObject;
    delete additionalInfo[Service.LOGIN_CODE_PURPOSE_KEY];
    updatePayload.additionalInfo = additionalInfo;
    const loginCodeHash: string = await HashedString.hashValue(
      loginCode,
      EncryptionSecret,
    );

    const updateResult: UpdateResult = await this.getRepository().update(
      {
        _id: session._id!,
        statusPageId: options.statusPageId,
        refreshToken: new HashedString(loginCodeHash, true),
        refreshTokenExpiresAt: MoreThan(OneUptimeDate.getCurrentDate()),
        isRevoked: false,
        additionalInfo: JsonContains({
          [Service.LOGIN_CODE_PURPOSE_KEY]: Service.LOGIN_CODE_PURPOSE_VALUE,
        }),
      } as any,
      updatePayload as any,
    );

    if (updateResult.affected !== 1) {
      return null;
    }

    Object.assign(session, updatePayload);

    await this.recordSuccessfulSignIn({
      projectId: session.projectId,
      statusPageId: session.statusPageId,
      statusPagePrivateUserId: session.statusPagePrivateUserId,
    });

    /*
     * The code is exchanged: the reader is signed in now, with the provider
     * the code's session keeps. Never fails the sign-in.
     */
    await this.recordSessionEvents([
      {
        session: session,
        action: AuditLogAction.SignIn,
        ipAddress: options.ipAddress,
      },
    ]);

    return {
      session,
      refreshToken,
      refreshTokenExpiresAt,
    };
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
        `Failed to update status page session activity for session ${sessionId.toString()}: ${(err as Error).message}`,
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
      props: Service.getRevocationProps(options),
    });
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
   * Ends `sessionId` when it is a live session of `statusPagePrivateUserId`
   * on `statusPageId`, and answers whether there was one: the session a
   * browser's sign-out cookie for that page names, when the refresh token
   * its sign-out sent matches none (POST /status-page-identity-api/logout,
   * issue #8671). The refresh token is rotated at every renewal and only
   * the new one is kept, so a browser whose renewal's answer was lost signs
   * out with the one the renewal replaced. A session of anybody else, of
   * another page, one already over, or a login code not yet exchanged is
   * left as it is - a sign-out replayed later ends nothing a second time.
   */
  public async revokeLiveSessionOfPrivateUser(
    data: {
      statusPageId: ObjectID;
      statusPagePrivateUserId: ObjectID;
      sessionId: ObjectID;
    },
    options?: RevokeSessionOptions,
  ): Promise<boolean> {
    const session: Model | null = await this.findOneBy({
      query: {
        _id: data.sessionId,
        statusPageId: data.statusPageId,
        statusPagePrivateUserId: data.statusPagePrivateUserId,
        isRevoked: false,
      },
      select: {
        _id: true,
        additionalInfo: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!session || !session.id || this.isLoginCodeSession(session)) {
      return false;
    }

    await this.revokeSessionById(session.id, options);

    return true;
  }

  /*
   * Ends every session of this private user, and any SSO login code of theirs
   * not yet exchanged (a login code is a session until it is). One that already
   * ended keeps when and why it did.
   */
  public async revokeAllSessionsByPrivateUserId(
    statusPagePrivateUserId: ObjectID,
    options?: RevokeSessionOptions,
  ): Promise<void> {
    await this.updateBy({
      query: {
        statusPagePrivateUserId: statusPagePrivateUserId,
        isRevoked: false,
      },
      data: {
        isRevoked: true,
        revokedAt: OneUptimeDate.getCurrentDate(),
        revokedReason: options?.reason ?? null,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: Service.getRevocationProps(options),
    });
  }

  /*
   * The sessions a revocation is about to end, read before it writes them
   * (and the revocation held to exactly those rows), so the audit log can
   * say what each one was once it has ended (issue #6790). One revoked
   * already ended before, and its end was recorded then; an SSO login code
   * not yet exchanged never signed anybody in.
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
      SESSION_AUDIT_SELECT,
    );

    const carryForward: RevocationCarryForward = {
      endingSessions: sessions.filter((session: Model): boolean => {
        return Boolean(
          session.id && !session.isRevoked && !this.isLoginCodeSession(session),
        );
      }),
    };

    return { updateBy, carryForward };
  }

  /*
   * A reader's session that is revoked - signed out, a new password, a
   * sign-in the page no longer accepts - goes into the status page's
   * project's audit log as its end (issue #6790). Every revocation is an
   * update through this service (revokeSessionById,
   * revokeAllSessionsByPrivateUserId), so this is where they all pass.
   * Never fails the revocation.
   */
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    if (onUpdate.updateBy.data.isRevoked !== true) {
      return onUpdate;
    }

    try {
      const updated: Set<string> = new Set(
        updatedItemIds.map((id: ObjectID): string => {
          return id.toString();
        }),
      );
      const endingSessions: Array<Model> = (
        (onUpdate.carryForward as RevocationCarryForward | null | undefined)
          ?.endingSessions || []
      ).filter((session: Model): boolean => {
        return updated.has(session.id!.toString());
      });
      const end: StatusPageSessionEnd = readStatusPageSessionEnd(
        onUpdate.updateBy.data.revokedReason,
      );

      await this.recordSessionEvents(
        endingSessions.map((session: Model): SessionEventToRecord => {
          return {
            session: session,
            action: end.action,
            endReason: end.reason,
            // A sign-out's own address; any other end, the session's last.
            ipAddress:
              end.action === AuditLogAction.SignOut
                ? onUpdate.updateBy.props.requestOrigin?.ipAddress
                : undefined,
          };
        }),
      );
    } catch (err) {
      logger.warn(
        "StatusPagePrivateUserSessionService: failed to record the end of sessions",
      );
      logger.warn(err);
    }

    return onUpdate;
  }

  /*
   * Readers' session events, into their status pages' projects' audit logs
   * (AuditLogService.recordStatusPageSessionEvents): how and from where each
   * signed in, as the session keeps it, and each reader by their address.
   * Only where something records audit logs, and never throws.
   */
  private async recordSessionEvents(
    sessions: Array<SessionEventToRecord>,
  ): Promise<void> {
    try {
      if (sessions.length === 0 || !AuditLogService.hasRecorder()) {
        return;
      }

      const readerEmails: Map<string, string> = await this.findReaderEmails(
        sessions.map((item: SessionEventToRecord): ObjectID | undefined => {
          return item.session.statusPagePrivateUserId;
        }),
      );

      const events: Array<StatusPageSessionAuditEvent> = [];

      for (const item of sessions) {
        const event: StatusPageSessionAuditEvent | null = Service.toAuditEvent({
          ...item,
          readerEmail: item.session.statusPagePrivateUserId
            ? readerEmails.get(item.session.statusPagePrivateUserId.toString())
            : undefined,
        });

        if (event) {
          events.push(event);
        }
      }

      await AuditLogService.recordStatusPageSessionEvents(events);
    } catch (err) {
      logger.warn(
        "StatusPagePrivateUserSessionService: failed to record session events",
      );
      logger.warn(err);
    }
  }

  // The address each reader signs in with, by their id.
  private async findReaderEmails(
    readerIds: Array<ObjectID | undefined>,
  ): Promise<Map<string, string>> {
    const ids: Array<ObjectID> = [];
    const seen: Set<string> = new Set();

    for (const readerId of readerIds) {
      if (readerId && !seen.has(readerId.toString())) {
        seen.add(readerId.toString());
        ids.push(readerId);
      }
    }

    const emails: Map<string, string> = new Map();

    if (ids.length === 0) {
      return emails;
    }

    const readers: Array<StatusPagePrivateUser> =
      await StatusPagePrivateUserService.findBy({
        query: { _id: QueryHelper.any(ids) },
        select: { _id: true, email: true },
        limit: ids.length,
        skip: 0,
        props: { isRoot: true },
      });

    for (const reader of readers) {
      if (reader.id && reader.email) {
        emails.set(reader.id.toString(), reader.email.toString());
      }
    }

    return emails;
  }

  /*
   * The audit log's event for a reader's session: how and where it signed
   * in, as the session keeps it - so its end, read from the same row, says
   * the same - or null for a row that does not say whose page it is.
   */
  public static toAuditEvent(
    data: SessionEventToRecord & { readerEmail?: string | undefined },
  ): StatusPageSessionAuditEvent | null {
    const session: Model = data.session;

    if (!session.id || !session.projectId || !session.statusPageId) {
      return null;
    }

    const origin: SessionSignInOrigin = readSessionSignInOrigin(
      session.additionalInfo,
    );

    const event: StatusPageSessionAuditEvent = {
      action: data.action,
      sessionId: session.id,
      projectId: session.projectId,
      statusPageId: session.statusPageId,
      readerEmail: data.readerEmail,
      signIn: readSessionSignIn(session.additionalInfo),
      device: origin.device || Service.describeDevice(session.userAgent),
      location: origin.location,
      ipAddress: data.ipAddress || session.ipAddress || undefined,
    };

    if (data.action !== AuditLogAction.SignIn) {
      event.endReason = data.endReason;

      if (session.createdAt) {
        event.signedInAt = new Date(session.createdAt);
      }

      if (session.lastActiveAt) {
        event.lastActiveAt = new Date(session.lastActiveAt);
      }
    }

    return event;
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

  private async recordSuccessfulSignIn(
    options: Pick<
      CreateSessionOptions,
      "projectId" | "statusPageId" | "statusPagePrivateUserId"
    >,
  ): Promise<void> {
    /*
     * Scope the write to the complete identity carried by the session. A
     * deleted or moved user must not gain activity from an old login code.
     */
    try {
      await StatusPagePrivateUserService.getRepository().update(
        {
          _id: options.statusPagePrivateUserId.toString(),
          projectId: options.projectId,
          statusPageId: options.statusPageId,
          deletedAt: IsNull(),
        },
        {
          lastActive: OneUptimeDate.getCurrentDate(),
        },
      );
    } catch {
      // Activity bookkeeping must not burn an already-consumed login code.
      logger.warn(
        `Failed to record sign-in activity for status page private user ${options.statusPagePrivateUserId.toString()}`,
      );
    }
  }

  private buildSessionModel(
    options: CreateSessionOptions,
    tokenMeta: { refreshToken: string; refreshTokenExpiresAt: Date },
  ): Model {
    const session: Model = new Model();
    session.projectId = options.projectId;
    session.statusPageId = options.statusPageId;
    session.statusPagePrivateUserId = options.statusPagePrivateUserId;
    session.refreshToken = HashedString.fromString(tokenMeta.refreshToken);
    session.refreshTokenExpiresAt = tokenMeta.refreshTokenExpiresAt;
    session.lastActiveAt = OneUptimeDate.getCurrentDate();

    // The provider that signed the person in, if one did (addSignInRule).
    if (options.statusPageSsoId) {
      session.statusPageSsoId = options.statusPageSsoId;
    }

    if (options.statusPageOidcId) {
      session.statusPageOidcId = options.statusPageOidcId;
    }

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
     * How the reader signed in and from where, kept for the audit log's
     * entries about the session (Types/UserSession/SessionSignIn): its
     * sign-in says them, and so does its end, whenever that comes. A login
     * code keeps them for the session it is exchanged for.
     */
    session.additionalInfo = {
      ...(options.additionalInfo || {}),
      ...toSessionSignInInfo({
        signIn: options.signIn,
        origin: Service.getSignInOrigin(options),
      }),
    } as JSONObject;

    return session;
  }

  /*
   * What a renewal or a login code's exchange writes, in a conditional write: so
   * the token is hashed here, and isRevoked is left to the write's own predicate.
   */
  private async buildRenewalUpdatePayload(data: {
    options: RenewSessionOptions;
    refreshToken: string;
    refreshTokenExpiresAt: Date;
  }): Promise<Partial<Model>> {
    const updatePayload: Partial<Model> = {
      refreshToken: new HashedString(
        await HashedString.hashValue(data.refreshToken, EncryptionSecret),
        true,
      ),
      refreshTokenExpiresAt: data.refreshTokenExpiresAt,
      lastActiveAt: OneUptimeDate.getCurrentDate(),
    };

    const ipAddress: string | undefined = Text.truncate(
      data.options.ipAddress,
      Service.SHORT_TEXT_LIMIT,
    );

    if (ipAddress) {
      updatePayload.ipAddress = ipAddress;
    }

    if (data.options.userAgent) {
      updatePayload.userAgent = data.options.userAgent;
    }

    const deviceName: string | undefined = Text.truncate(
      data.options.deviceName,
      Service.SHORT_TEXT_LIMIT,
    );
    if (deviceName) {
      updatePayload.deviceName = deviceName;
    }

    const deviceType: string | undefined = Text.truncate(
      data.options.deviceType,
      Service.SHORT_TEXT_LIMIT,
    );
    if (deviceType) {
      updatePayload.deviceType = deviceType;
    }

    const deviceOS: string | undefined = Text.truncate(
      data.options.deviceOS,
      Service.SHORT_TEXT_LIMIT,
    );
    if (deviceOS) {
      updatePayload.deviceOS = deviceOS;
    }

    const deviceBrowser: string | undefined = Text.truncate(
      data.options.deviceBrowser,
      Service.SHORT_TEXT_LIMIT,
    );
    if (deviceBrowser) {
      updatePayload.deviceBrowser = deviceBrowser;
    }

    if (data.options.additionalInfo || data.options.session.additionalInfo) {
      updatePayload.additionalInfo = {
        ...(data.options.session.additionalInfo || {}),
        ...(data.options.additionalInfo || {}),
      } as JSONObject;
    }

    return updatePayload;
  }

  private static generateRefreshToken(): string {
    return ObjectID.generate().toString();
  }

  private static getRefreshTokenExpiry(): Date {
    return OneUptimeDate.getSomeDaysAfter(
      Service.DEFAULT_REFRESH_TOKEN_TTL_DAYS,
    );
  }

  /*
   * The refresh token's expiry for a session of this status page being
   * issued or renewed: 30 days from now, or the end of the page's Sign
   * Readers Out After for a session that began at `startedAt`, whichever
   * comes first - so the browser drops the session on time as well as
   * every read refusing it (addSignInRule). A session whose page or start
   * is unknown keeps the 30 days; the reads still end it on time.
   */
  private async getRefreshTokenExpiryForPage(data: {
    statusPageId: ObjectID | undefined;
    startedAt: Date | undefined;
  }): Promise<Date> {
    const expiresAt: Date = Service.getRefreshTokenExpiry();

    if (!data.statusPageId || !data.startedAt) {
      return expiresAt;
    }

    const statusPage: StatusPage | null = await StatusPageService.findOneById({
      id: data.statusPageId,
      select: {
        privateUserSessionLengthInHours: true,
      },
      props: {
        isRoot: true,
      },
    });

    return capRefreshTokenExpiry({
      expiresAt,
      startedAt: data.startedAt,
      lengthInHours: statusPage?.privateUserSessionLengthInHours,
    });
  }
}

export default new Service();
