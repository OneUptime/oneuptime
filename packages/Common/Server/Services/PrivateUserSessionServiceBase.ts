import crypto from "crypto";
import DatabaseService from "./DatabaseService";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OneUptimeDate from "../../Types/Date";
import Exception from "../../Types/Exception/Exception";
import HashedString from "../../Types/HashedString";
import { JSONObject } from "../../Types/JSON";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import Text from "../../Types/Text";
import {
  SessionSignIn,
  SessionSignInOrigin,
  toSessionSignInInfo,
} from "../../Types/UserSession/SessionSignIn";
import RequestOrigin from "../../Types/RequestOrigin";
import { PRIVATE_USER_SESSION_IDLE_DAYS } from "../../Types/StatusPage/PrivateUserSessionLength";
import { EncryptionSecret } from "../EnvironmentConfig";
import Query from "../Types/Database/Query";
import UserAgentDevice from "../Utils/RequestOrigin/UserAgentDevice";
import logger from "../Utils/Logger";
import {
  Brackets,
  IsNull,
  JsonContains,
  MoreThan,
  SelectQueryBuilder,
  UpdateResult,
  WhereExpressionBuilder,
} from "typeorm";

/*
 * ---------------------------------------------------------------------------
 * THE SESSIONS OF A PUBLIC RESOURCE'S PRIVATE USERS.
 *
 * A dashboard (#10250) - and a form after it (#10249) - can ask the
 * visitors of its public link to sign in as one of its private users, with
 * a password or its single sign-on, as a status page's private users have
 * for years (StatusPagePrivateUserSessionService). Each kind keeps its
 * sessions in a table of its own (DashboardPrivateUserSession), with the
 * same columns but for four: the resource it belongs to, its private user,
 * and the SAML or OIDC provider that signed it in. This is the one
 * implementation of what such a session is, handed those four names:
 *
 *   - a session is created at a sign-in, with a refresh token the browser
 *     keeps in an HttpOnly cookie and the server keeps only as its hash;
 *   - an SSO sign-in creates a login code first - a session that signs
 *     nobody in until the resource's own page exchanges it, on its own host,
 *     for the real thing (exchangeLoginCode), so the cookies are set on the
 *     host the visitor uses, a custom domain included;
 *   - every renewal rotates the refresh token, in one conditional write
 *     that never brings back a session something ended meanwhile;
 *   - a session counts only while its sign-in still counts
 *     (addSignInRule): one an SSO provider signed in, while that provider
 *     is the resource's, on, and was not turned off since; one with a
 *     password, while the resource does not require SSO;
 *   - it ends at a sign-out, a new password, or when its private user is
 *     removed, and its credentials are purged 30 days after they lapse.
 *
 * Status pages keep their own service for now - it also records each
 * session in the audit log and follows the page's Sign Readers Out After -
 * and is pinned by its own suites; it reads the same rules.
 * ---------------------------------------------------------------------------
 */

// The four columns that differ between the kinds, as each kind's model names them.
export interface PrivateUserSessionColumns {
  // The resource the session is for: "dashboardId".
  resource: string;
  // Its private user's id column, and the relation: "dashboardPrivateUserId", "dashboardPrivateUser".
  privateUser: string;
  privateUserRelation: string;
  // The SAML and OIDC providers that may have signed it in: "dashboardSsoId", "dashboardOidcId".
  sso: string;
  oidc: string;
}

export interface PrivateUserSessionKind {
  // What the resource is called in log lines: "dashboard".
  name: string;
  columns: PrivateUserSessionColumns;
  // The resource's own model, which holds requireSsoForLogin.
  resourceModel: { new (): BaseModel };
  // Its SAML and OIDC provider models.
  ssoModel: { new (): BaseModel };
  oidcModel: { new (): BaseModel };
  // Its private user model, whose lastActive a sign-in writes.
  privateUserModel: { new (): BaseModel };
}

export interface PrivateUserSessionMetadata<TModel extends BaseModel> {
  session: TModel;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export interface PrivateUserSessionDevice {
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  deviceName?: string | undefined;
  deviceType?: string | undefined;
  deviceOS?: string | undefined;
  deviceBrowser?: string | undefined;
}

export interface CreatePrivateUserSessionOptions
  extends PrivateUserSessionDevice {
  projectId: ObjectID;
  resourceId: ObjectID;
  privateUserId: ObjectID;
  /*
   * The resource's SAML or OIDC provider that signed the person in, when
   * one did: the session counts only while it vouches for it (addSignInRule).
   */
  ssoProviderId?: ObjectID | undefined;
  oidcProviderId?: ObjectID | undefined;
  additionalInfo?: JSONObject | undefined;
  // How and where from the person signed in, kept with the session.
  signIn?: SessionSignIn | undefined;
  requestOrigin?: RequestOrigin | undefined;
  refreshTokenExpiresAt?: Date | undefined;
}

export interface RevokePrivateUserSessionOptions {
  reason?: string | undefined;
}

// How long an SSO login code works before the resource's page exchanges it.
export const PRIVATE_USER_LOGIN_CODE_TTL_MINUTES: number = 5;

/*
 * How long a session lasts without being used: its refresh token's life,
 * renewed at every refresh - the status pages' 30 days.
 */
export const PRIVATE_USER_SESSION_TTL_DAYS: number =
  PRIVATE_USER_SESSION_IDLE_DAYS;

// Why a session that no longer counts was ended, as the session records it.
export const PRIVATE_USER_SIGN_IN_NO_LONGER_ACCEPTED_REASON: string =
  "Sign-in no longer accepted";

export const PRIVATE_USER_SESSION_SIGNED_OUT_REASON: string = "Signed out";

export const PRIVATE_USER_SESSION_PASSWORD_CHANGED_REASON: string =
  "Password changed";

const LOGIN_CODE_PURPOSE_KEY: string = "oneuptimePrivateUserSessionPurpose";
const LOGIN_CODE_PURPOSE_VALUE: string = "login-code";
const SHORT_TEXT_LIMIT: number = 100;

export default abstract class PrivateUserSessionServiceBase<
  TModel extends BaseModel,
> extends DatabaseService<TModel> {
  protected readonly kind: PrivateUserSessionKind;

  public constructor(
    modelType: { new (): TModel },
    kind: PrivateUserSessionKind,
  ) {
    super(modelType);
    this.kind = kind;

    /*
     * Login codes use this same column for their five-minute expiry. Purge
     * expired credentials and their device metadata after 30 more days.
     * The daily purge reads only Server/Services/Index.ts, so each kind's
     * service is listed there (#10792, PurgedServicesRegisteredGuard).
     */
    this.hardDeleteItemsOlderThanInDays("refreshTokenExpiresAt", 30);
  }

  // A session of this kind's columns, read as a plain record.
  protected read(session: TModel, column: string): unknown {
    return (session as unknown as Record<string, unknown>)[column];
  }

  protected readId(session: TModel, column: string): ObjectID | undefined {
    const value: unknown = this.read(session, column);

    if (value instanceof ObjectID) {
      return value;
    }

    if (typeof value === "string" && ObjectID.isValidUUID(value)) {
      return new ObjectID(value);
    }

    return undefined;
  }

  public getResourceId(session: TModel): ObjectID | undefined {
    return this.readId(session, this.kind.columns.resource);
  }

  public getPrivateUserId(session: TModel): ObjectID | undefined {
    return this.readId(session, this.kind.columns.privateUser);
  }

  public isLoginCodeSession(session: TModel): boolean {
    const additionalInfo: unknown = this.read(session, "additionalInfo");

    return (
      typeof additionalInfo === "object" &&
      additionalInfo !== null &&
      (additionalInfo as JSONObject)[LOGIN_CODE_PURPOSE_KEY] ===
        LOGIN_CODE_PURPOSE_VALUE
    );
  }

  public async createSession(
    options: CreatePrivateUserSessionOptions,
  ): Promise<PrivateUserSessionMetadata<TModel>> {
    const refreshToken: string = PrivateUserSessionServiceBase.generateToken();
    const refreshTokenExpiresAt: Date =
      options.refreshTokenExpiresAt ||
      OneUptimeDate.getSomeDaysAfter(PRIVATE_USER_SESSION_TTL_DAYS);

    const session: TModel = this.buildSessionModel(options, {
      refreshToken,
      refreshTokenExpiresAt,
    });

    try {
      const createdSession: TModel = await this.create({
        data: session,
        props: {
          isRoot: true,
        },
      });

      // A login code signs nobody in until it is exchanged.
      if (!this.isLoginCodeSession(createdSession)) {
        await this.recordSuccessfulSignIn(options);
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

  /*
   * What an SSO sign-in creates on OneUptime's own address: a code good for
   * five minutes, handed to the resource's page in its address, which
   * exchanges it on the host the visitor uses (exchangeLoginCode). Until
   * then it signs nobody in.
   */
  public async createLoginCodeSession(
    options: Omit<CreatePrivateUserSessionOptions, "refreshTokenExpiresAt">,
  ): Promise<PrivateUserSessionMetadata<TModel>> {
    return await this.createSession({
      ...options,
      additionalInfo: {
        ...(options.additionalInfo || {}),
        [LOGIN_CODE_PURPOSE_KEY]: LOGIN_CODE_PURPOSE_VALUE,
      } as JSONObject,
      refreshTokenExpiresAt: OneUptimeDate.getSomeMinutesAfter(
        PRIVATE_USER_LOGIN_CODE_TTL_MINUTES,
      ),
    });
  }

  /*
   * WHETHER A SESSION STILL COUNTS, AS FAR AS HOW IT SIGNED IN GOES - added
   * to a query over the sessions, aliased "session", so the answer comes
   * from the same database read as the session itself.
   *
   *   - A session one of the resource's SAML or OIDC providers signed in
   *     counts only while that provider vouches for it: it is still there,
   *     still this resource's, turned on, and it was not turned off after
   *     the session began (signInsEndedAt before the session's createdAt,
   *     both the database's time). Turning the provider off, or deleting
   *     it, ends the sessions it signed in, and turning it on again does
   *     not bring them back (Utils/SsoSignInsEnded).
   *   - A session that names no provider - a password sign-in - counts only
   *     while the resource does not require SSO (`requiresSso`, read by the
   *     caller with the resource).
   */
  public addSignInRule(
    query: SelectQueryBuilder<TModel>,
    data: { requiresSso: boolean },
  ): SelectQueryBuilder<TModel> {
    return this.addSignInRuleCounting(
      query,
      data.requiresSso ? "1 = 0" : this.getNamesNoProviderSql(),
    );
  }

  private getNamesNoProviderSql(): string {
    return `session.${this.kind.columns.sso} IS NULL AND session.${this.kind.columns.oidc} IS NULL`;
  }

  private addSignInRuleCounting(
    query: SelectQueryBuilder<TModel>,
    sessionWithoutProviderSql: string,
  ): SelectQueryBuilder<TModel> {
    const columns: PrivateUserSessionColumns = this.kind.columns;

    const vouchedForBy: (alias: string, column: string) => string = (
      alias: string,
      column: string,
    ): string => {
      return [
        `session.${column} IS NOT NULL`,
        `${alias}._id = session.${column}`,
        `${alias}.${columns.resource} = session.${columns.resource}`,
        `${alias}.isEnabled = true`,
        `${alias}.deletedAt IS NULL`,
        `(${alias}.signInsEndedAt IS NULL OR ${alias}.signInsEndedAt < session.createdAt)`,
      ].join(" AND ");
    };

    return query
      .leftJoin(
        this.kind.ssoModel,
        "sessionSsoProvider",
        `sessionSsoProvider._id = session.${columns.sso}`,
      )
      .leftJoin(
        this.kind.oidcModel,
        "sessionOidcProvider",
        `sessionOidcProvider._id = session.${columns.oidc}`,
      )
      .andWhere(
        new Brackets((rule: WhereExpressionBuilder): void => {
          rule.where(sessionWithoutProviderSql);

          rule
            .orWhere(vouchedForBy("sessionSsoProvider", columns.sso))
            .orWhere(vouchedForBy("sessionOidcProvider", columns.oidc));
        }),
      );
  }

  /*
   * Whether this session still counts by the sign-in rule above, read now,
   * with its resource's own Require SSO to Sign In, in one database read: a
   * refresh and a login code ask it before they hand the session a new
   * access token. A session whose resource is gone does not count.
   */
  public async doesSignInStillCount(data: {
    sessionId: ObjectID;
  }): Promise<boolean> {
    const session: TModel | null = await this.addSignInRuleCounting(
      this.getQueryBuilder("session")
        .select(["session._id"])
        .innerJoin(
          this.kind.resourceModel,
          "sessionResource",
          `sessionResource._id = session.${this.kind.columns.resource} AND sessionResource.deletedAt IS NULL`,
        )
        .where("session._id = :sessionId", {
          sessionId: data.sessionId.toString(),
        }),
      `sessionResource.requireSsoForLogin IS NOT TRUE AND ${this.getNamesNoProviderSql()}`,
    ).getOne();

    return Boolean(session);
  }

  /*
   * The live session of a private user of this resource that an access
   * token names, or null: not revoked, not expired, its private user not
   * removed, its sign-in still counting (addSignInRule), and no login code.
   * One primary-key lookup joined to the private user. Never cached:
   * revocation and removal take effect at the next request, even while the
   * access token has not run out.
   */
  public async findSignedInSession(data: {
    resourceId: ObjectID;
    sessionId: ObjectID;
    privateUserId: ObjectID;
    requiresSso: boolean;
    select?: Array<string> | undefined;
  }): Promise<TModel | null> {
    const columns: PrivateUserSessionColumns = this.kind.columns;

    const session: TModel | null = await this.addSignInRule(
      this.getQueryBuilder("session")
        .select(data.select || ["session._id", "session.additionalInfo"])
        .innerJoin(`session.${columns.privateUserRelation}`, "privateUser")
        .where("session._id = :sessionId", {
          sessionId: data.sessionId.toString(),
        })
        .andWhere(`session.${columns.resource} = :resourceId`, {
          resourceId: data.resourceId.toString(),
        })
        .andWhere(`session.${columns.privateUser} = :privateUserId`, {
          privateUserId: data.privateUserId.toString(),
        })
        .andWhere(`privateUser.${columns.resource} = :resourceId`)
        .andWhere("privateUser.deletedAt IS NULL")
        .andWhere("session.isRevoked = false")
        .andWhere("session.refreshTokenExpiresAt > :now", {
          now: OneUptimeDate.getCurrentDate(),
        }),
      { requiresSso: data.requiresSso },
    ).getOne();

    if (!session || this.isLoginCodeSession(session)) {
      return null;
    }

    return session;
  }

  public async findActiveSessionByRefreshToken(
    refreshToken: string,
  ): Promise<TModel | null> {
    if (!refreshToken) {
      return null;
    }

    const hashedValue: string = await HashedString.hashValue(
      refreshToken,
      EncryptionSecret,
    );

    const session: TModel | null = await this.findOneBy({
      query: {
        refreshToken: new HashedString(hashedValue, true),
        isRevoked: false,
      } as unknown as Query<TModel>,
      select: {
        _id: true,
        projectId: true,
        [this.kind.columns.resource]: true,
        [this.kind.columns.privateUser]: true,
        refreshTokenExpiresAt: true,
        createdAt: true,
        additionalInfo: true,
        isRevoked: true,
      } as never,
      props: {
        isRoot: true,
      },
    });

    if (!session) {
      return null;
    }

    const expiresAt: unknown = this.read(session, "refreshTokenExpiresAt");

    if (!(expiresAt instanceof Date) || OneUptimeDate.hasExpired(expiresAt)) {
      return null;
    }

    return session;
  }

  /*
   * Gives a session a new refresh token, or answers null when it was ended
   * while this request was on its way. The write's own predicate asks that
   * the session is still live, so a sign-out or a new password that lands
   * between the read and this write is never written over. Hook-free, as a
   * single conditional write has to be: it hashes the token itself.
   */
  public async renewSessionWithNewRefreshToken(
    options: PrivateUserSessionDevice & { session: TModel },
  ): Promise<PrivateUserSessionMetadata<TModel> | null> {
    const refreshToken: string = PrivateUserSessionServiceBase.generateToken();
    const refreshTokenExpiresAt: Date = OneUptimeDate.getSomeDaysAfter(
      PRIVATE_USER_SESSION_TTL_DAYS,
    );

    const updatePayload: Record<string, unknown> =
      await this.buildRenewalUpdatePayload({
        options,
        refreshToken,
        refreshTokenExpiresAt,
      });

    const updateResult: UpdateResult = await this.getRepository().update(
      {
        _id: options.session.id!.toString(),
        isRevoked: false,
        deletedAt: IsNull(),
      } as never,
      updatePayload as never,
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

  /*
   * Atomically spends the short-lived login code an SSO sign-in made and
   * replaces it with the long-lived refresh credential, delivered only as an
   * HttpOnly cookie on the host that asked. The code, the resource, the
   * expiry and the code's purpose are all in the UPDATE's predicate, so of
   * two redemptions of one code only one succeeds. A code of another
   * resource exchanges nothing.
   */
  public async exchangeLoginCode(
    loginCode: string,
    options: PrivateUserSessionDevice & { resourceId: ObjectID },
  ): Promise<PrivateUserSessionMetadata<TModel> | null> {
    if (!ObjectID.isValidUUID(loginCode)) {
      return null;
    }

    const session: TModel | null =
      await this.findActiveSessionByRefreshToken(loginCode);

    const resourceId: ObjectID | undefined = session
      ? this.getResourceId(session)
      : undefined;

    if (
      !session?.id ||
      !resourceId ||
      !this.getPrivateUserId(session) ||
      !this.isLoginCodeSession(session) ||
      resourceId.toString() !== options.resourceId.toString()
    ) {
      return null;
    }

    const refreshToken: string = PrivateUserSessionServiceBase.generateToken();
    const refreshTokenExpiresAt: Date = OneUptimeDate.getSomeDaysAfter(
      PRIVATE_USER_SESSION_TTL_DAYS,
    );

    const updatePayload: Record<string, unknown> =
      await this.buildRenewalUpdatePayload({
        options: { ...options, session },
        refreshToken,
        refreshTokenExpiresAt,
      });

    const additionalInfo: JSONObject = {
      ...((updatePayload["additionalInfo"] as JSONObject | undefined) || {}),
    };
    delete additionalInfo[LOGIN_CODE_PURPOSE_KEY];
    updatePayload["additionalInfo"] = additionalInfo;

    const loginCodeHash: string = await HashedString.hashValue(
      loginCode,
      EncryptionSecret,
    );

    const updateResult: UpdateResult = await this.getRepository().update(
      {
        _id: session.id.toString(),
        [this.kind.columns.resource]: options.resourceId,
        refreshToken: new HashedString(loginCodeHash, true),
        refreshTokenExpiresAt: MoreThan(OneUptimeDate.getCurrentDate()),
        isRevoked: false,
        additionalInfo: JsonContains({
          [LOGIN_CODE_PURPOSE_KEY]: LOGIN_CODE_PURPOSE_VALUE,
        }),
      } as never,
      updatePayload as never,
    );

    if (updateResult.affected !== 1) {
      return null;
    }

    Object.assign(session, updatePayload);

    await this.recordSuccessfulSignIn({
      projectId: this.readId(session, "projectId")!,
      resourceId: resourceId,
      privateUserId: this.getPrivateUserId(session)!,
    });

    return {
      session,
      refreshToken,
      refreshTokenExpiresAt,
    };
  }

  public async revokeSessionById(
    sessionId: ObjectID,
    options?: RevokePrivateUserSessionOptions,
  ): Promise<void> {
    await this.updateOneById({
      id: sessionId,
      data: {
        isRevoked: true,
        revokedAt: OneUptimeDate.getCurrentDate(),
        revokedReason: options?.reason ?? null,
      } as never,
      props: { isRoot: true },
    });
  }

  // Ends the live session a refresh token belongs to, and answers whether there was one.
  public async revokeSessionByRefreshToken(
    refreshToken: string,
    options?: RevokePrivateUserSessionOptions,
  ): Promise<boolean> {
    const session: TModel | null =
      await this.findActiveSessionByRefreshToken(refreshToken);

    if (!session || !session.id) {
      return false;
    }

    await this.revokeSessionById(session.id, options);

    return true;
  }

  /*
   * Ends `sessionId` when it is a live session of `privateUserId` on
   * `resourceId`, and answers whether there was one: the session a
   * browser's sign-out cookie names, when the refresh token its sign-out
   * sent matches none - a renewal whose answer never reached the browser
   * rotated it. A session of anybody else, of another resource, one
   * already over, or a login code not yet exchanged is left as it is.
   */
  public async revokeLiveSessionOfPrivateUser(
    data: {
      resourceId: ObjectID;
      privateUserId: ObjectID;
      sessionId: ObjectID;
    },
    options?: RevokePrivateUserSessionOptions,
  ): Promise<boolean> {
    const session: TModel | null = await this.findOneBy({
      query: {
        _id: data.sessionId,
        [this.kind.columns.resource]: data.resourceId,
        [this.kind.columns.privateUser]: data.privateUserId,
        isRevoked: false,
      } as unknown as Query<TModel>,
      select: {
        _id: true,
        additionalInfo: true,
      } as never,
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
   * not yet exchanged. One that already ended keeps when and why it did.
   */
  public async revokeAllSessionsByPrivateUserId(
    privateUserId: ObjectID,
    options?: RevokePrivateUserSessionOptions,
  ): Promise<void> {
    await this.updateBy({
      query: {
        [this.kind.columns.privateUser]: privateUserId,
        isRevoked: false,
      } as unknown as Query<TModel>,
      data: {
        isRevoked: true,
        revokedAt: OneUptimeDate.getCurrentDate(),
        revokedReason: options?.reason ?? null,
      } as never,
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });
  }

  /*
   * When the private user last signed in, written with the whole identity
   * the session carries, so a removed or moved user gains nothing from an
   * old login code. Never fails the sign-in.
   */
  private async recordSuccessfulSignIn(data: {
    projectId: ObjectID;
    resourceId: ObjectID;
    privateUserId: ObjectID;
  }): Promise<void> {
    try {
      await this.getRepository()
        .manager.getRepository(this.kind.privateUserModel)
        .update(
          {
            _id: data.privateUserId.toString(),
            projectId: data.projectId,
            [this.kind.columns.resource]: data.resourceId,
            deletedAt: IsNull(),
          } as never,
          {
            lastActive: OneUptimeDate.getCurrentDate(),
          } as never,
        );
    } catch {
      logger.warn(
        `Failed to record sign-in activity for ${this.kind.name} private user ${data.privateUserId.toString()}`,
      );
    }
  }

  private buildSessionModel(
    options: CreatePrivateUserSessionOptions,
    tokenMeta: { refreshToken: string; refreshTokenExpiresAt: Date },
  ): TModel {
    const session: TModel = new this.modelType();
    const record: Record<string, unknown> = session as unknown as Record<
      string,
      unknown
    >;
    const columns: PrivateUserSessionColumns = this.kind.columns;

    record["projectId"] = options.projectId;
    record[columns.resource] = options.resourceId;
    record[columns.privateUser] = options.privateUserId;
    record["refreshToken"] = HashedString.fromString(tokenMeta.refreshToken);
    record["refreshTokenExpiresAt"] = tokenMeta.refreshTokenExpiresAt;
    record["lastActiveAt"] = OneUptimeDate.getCurrentDate();

    // The provider that signed the person in, if one did (addSignInRule).
    if (options.ssoProviderId) {
      record[columns.sso] = options.ssoProviderId;
    }

    if (options.oidcProviderId) {
      record[columns.oidc] = options.oidcProviderId;
    }

    if (options.userAgent) {
      record["userAgent"] = options.userAgent;
    }

    PrivateUserSessionServiceBase.writeDevice(record, options);

    /*
     * How the person signed in and from where, kept with the session
     * (Types/UserSession/SessionSignIn). A login code keeps them for the
     * session it is exchanged for.
     */
    record["additionalInfo"] = {
      ...(options.additionalInfo || {}),
      ...toSessionSignInInfo({
        signIn: options.signIn,
        origin: PrivateUserSessionServiceBase.getSignInOrigin(options),
      }),
    } as JSONObject;

    return session;
  }

  /*
   * What a renewal or a login code's exchange writes, in a conditional
   * write: so the token is hashed here, and isRevoked is left to the
   * write's own predicate.
   */
  private async buildRenewalUpdatePayload(data: {
    options: PrivateUserSessionDevice & { session: TModel };
    refreshToken: string;
    refreshTokenExpiresAt: Date;
  }): Promise<Record<string, unknown>> {
    const updatePayload: Record<string, unknown> = {
      refreshToken: new HashedString(
        await HashedString.hashValue(data.refreshToken, EncryptionSecret),
        true,
      ),
      refreshTokenExpiresAt: data.refreshTokenExpiresAt,
      lastActiveAt: OneUptimeDate.getCurrentDate(),
    };

    if (data.options.userAgent) {
      updatePayload["userAgent"] = data.options.userAgent;
    }

    PrivateUserSessionServiceBase.writeDevice(updatePayload, data.options);

    const additionalInfo: unknown = this.read(
      data.options.session,
      "additionalInfo",
    );

    if (additionalInfo && typeof additionalInfo === "object") {
      updatePayload["additionalInfo"] = {
        ...(additionalInfo as JSONObject),
      };
    }

    return updatePayload;
  }

  // The device a request describes, each value cut to what its column holds.
  private static writeDevice(
    record: Record<string, unknown>,
    device: PrivateUserSessionDevice,
  ): void {
    const fields: Array<keyof PrivateUserSessionDevice> = [
      "deviceName",
      "deviceType",
      "deviceOS",
      "deviceBrowser",
      "ipAddress",
    ];

    for (const field of fields) {
      const value: string | undefined = Text.truncate(
        device[field],
        SHORT_TEXT_LIMIT,
      );

      if (value) {
        record[field] = value;
      }
    }
  }

  // Where a sign-in came from, in words OneUptime spells out (UserAgentDevice).
  private static getSignInOrigin(
    options: CreatePrivateUserSessionOptions,
  ): SessionSignInOrigin {
    if (options.requestOrigin) {
      return {
        device: options.requestOrigin.device,
        location: options.requestOrigin.location,
      };
    }

    if (!options.userAgent) {
      return {};
    }

    return {
      device: UserAgentDevice.describe(
        UserAgentDevice.read({ userAgent: options.userAgent }),
      ),
    };
  }

  // A bearer secret: a random UUID, from the CSPRNG.
  private static generateToken(): string {
    return crypto.randomUUID();
  }
}
