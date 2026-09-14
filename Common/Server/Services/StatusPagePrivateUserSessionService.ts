import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/StatusPagePrivateUserSession";
import ObjectID from "../../Types/ObjectID";
import { JSONObject } from "../../Types/JSON";
import HashedString from "../../Types/HashedString";
import { EncryptionSecret } from "../EnvironmentConfig";
import OneUptimeDate from "../../Types/Date";
import Text from "../../Types/Text";
import logger from "../Utils/Logger";
import Exception from "../../Types/Exception/Exception";
import BadDataException from "../../Types/Exception/BadDataException";
import { JsonContains, MoreThan, UpdateResult } from "typeorm";

export interface SessionMetadata {
  session: Model;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export interface CreateSessionOptions {
  projectId: ObjectID;
  statusPageId: ObjectID;
  statusPagePrivateUserId: ObjectID;
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

export class Service extends DatabaseService<Model> {
  private static readonly DEFAULT_REFRESH_TOKEN_TTL_DAYS: number = 30;
  private static readonly LOGIN_CODE_PURPOSE_KEY: string =
    "oneuptimeStatusPageSessionPurpose";
  private static readonly LOGIN_CODE_PURPOSE_VALUE: string = "login-code";
  private static readonly SHORT_TEXT_LIMIT: number = 100;

  public constructor() {
    super(Model);
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
