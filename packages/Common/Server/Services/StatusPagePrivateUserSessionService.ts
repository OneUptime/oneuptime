import DatabaseService from "./DatabaseService";
import StatusPagePrivateUserService from "./StatusPagePrivateUserService";
import Model from "../../Models/DatabaseModels/StatusPagePrivateUserSession";
import StatusPage from "../../Models/DatabaseModels/StatusPage";
import StatusPageOidc from "../../Models/DatabaseModels/StatusPageOidc";
import StatusPageSso from "../../Models/DatabaseModels/StatusPageSso";
import ObjectID from "../../Types/ObjectID";
import { JSONObject } from "../../Types/JSON";
import HashedString from "../../Types/HashedString";
import { EncryptionSecret } from "../EnvironmentConfig";
import OneUptimeDate from "../../Types/Date";
import Text from "../../Types/Text";
import logger from "../Utils/Logger";
import Exception from "../../Types/Exception/Exception";
import BadDataException from "../../Types/Exception/BadDataException";
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
  "Its sign-in is no longer accepted by the status page";

// A session no SSO provider signed in: a password sign-in, or one from before sessions named their provider.
const SESSION_NAMES_NO_PROVIDER_SQL: string =
  "session.statusPageSsoId IS NULL AND session.statusPageOidcId IS NULL";

export class Service extends DatabaseService<Model> {
  private static readonly DEFAULT_REFRESH_TOKEN_TTL_DAYS: number = 30;
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
      options.refreshTokenExpiresAt || Service.getRefreshTokenExpiry();

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
   *     Require SSO for Login, read by the caller with the page): Require
   *     SSO for Login lets in only people an SSO provider signs in.
   */
  public addSignInRule(
    query: SelectQueryBuilder<Model>,
    data: { requiresSso: boolean },
  ): SelectQueryBuilder<Model> {
    // A page that requires SSO counts nothing but an SSO sign-in.
    return this.addSignInRuleCounting(
      query,
      data.requiresSso ? "1 = 0" : SESSION_NAMES_NO_PROVIDER_SQL,
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
   * (addSignInRule), read now, with its status page's own Require SSO for
   * Login, in one database read: a refresh and a login code ask it before
   * they hand the session a new access token. A session whose status page
   * is gone does not count.
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
        }),
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

  public async renewSessionWithNewRefreshToken(
    options: RenewSessionOptions,
  ): Promise<SessionMetadata> {
    const refreshToken: string = Service.generateRefreshToken();
    const refreshTokenExpiresAt: Date =
      options.refreshTokenExpiresAt || Service.getRefreshTokenExpiry();

    const updatePayload: Partial<Model> = this.buildRenewalUpdatePayload({
      options,
      refreshToken,
      refreshTokenExpiresAt,
    });

    const updatedSession: Model | null = await this.updateOneByIdAndFetch({
      id: options.session.id!,
      data: updatePayload as any,
      props: {
        isRoot: true,
      },
    });

    if (!updatedSession) {
      throw new BadDataException("Unable to renew status page user session");
    }

    return {
      session: updatedSession,
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
    const refreshTokenExpiresAt: Date = Service.getRefreshTokenExpiry();
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
    const updatePayload: Partial<Model> = this.buildRenewalUpdatePayload({
      options: renewalOptions,
      refreshToken,
      refreshTokenExpiresAt,
    });
    const refreshTokenHash: string = await HashedString.hashValue(
      refreshToken,
      EncryptionSecret,
    );
    updatePayload.refreshToken = new HashedString(refreshTokenHash, true);
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

    session.additionalInfo = {
      ...(options.additionalInfo || {}),
    } as JSONObject;

    return session;
  }

  private buildRenewalUpdatePayload(data: {
    options: RenewSessionOptions;
    refreshToken: string;
    refreshTokenExpiresAt: Date;
  }): Partial<Model> {
    const updatePayload: Partial<Model> = {
      refreshToken: HashedString.fromString(data.refreshToken),
      refreshTokenExpiresAt: data.refreshTokenExpiresAt,
      lastActiveAt: OneUptimeDate.getCurrentDate(),
      isRevoked: false,
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
}

export default new Service();
