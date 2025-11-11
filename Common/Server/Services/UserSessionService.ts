import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/UserSession";
import ObjectID from "../../Types/ObjectID";
import { JSONObject } from "../../Types/JSON";
import HashedString from "../../Types/HashedString";
import { EncryptionSecret } from "../EnvironmentConfig";
import OneUptimeDate from "../../Types/Date";
import Text from "../../Types/Text";
import logger from "../Utils/Logger";
import Exception from "../../Types/Exception/Exception";
import BadDataException from "../../Types/Exception/BadDataException";

export interface SessionMetadata {
  session: Model;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

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
  private static readonly DEFAULT_REFRESH_TOKEN_TTL_DAYS: number = 30;
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
        refreshToken: refreshToken,
        refreshTokenExpiresAt: refreshTokenExpiresAt,
      };
    } catch (error) {
      throw error as Exception;
    }
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

    const updatePayload: Partial<Model> = {
      refreshToken: HashedString.fromString(refreshToken),
      refreshTokenExpiresAt: refreshTokenExpiresAt,
      lastActiveAt: OneUptimeDate.getCurrentDate(),
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

    return {
      session: updatedSession,
      refreshToken: refreshToken,
      refreshTokenExpiresAt: refreshTokenExpiresAt,
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

export default new Service();
