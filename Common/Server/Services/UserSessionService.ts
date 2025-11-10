import DatabaseService from "./DatabaseService";
import UserSession from "../../Models/DatabaseModels/UserSession";
import User from "../../Models/DatabaseModels/User";
import ObjectID from "../../Types/ObjectID";
import HashedString from "../../Types/HashedString";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import JSONWebToken from "../Utils/JsonWebToken";
import OneUptimeDate from "../../Types/Date";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  GeneratedAuthTokens,
  SessionMetadata,
  computeRefreshTokenExpiryDate,
  generateRefreshToken,
  getAccessTokenExpiresInSeconds,
  getRefreshTokenExpiresInSeconds,
  hashRefreshToken,
} from "../Utils/SessionToken";
import QueryDeepPartialEntity from "../../Types/Database/PartialEntity";

export type UserSessionWithTokens = GeneratedAuthTokens & {
  session: UserSession;
};

export class Service extends DatabaseService<UserSession> {
  public constructor() {
    super(UserSession);
  }

  @CaptureSpan()
  public async createSessionWithTokens(data: {
    user: User;
    isGlobalLogin: boolean;
    projectId?: ObjectID;
    metadata?: SessionMetadata;
    props?: DatabaseCommonInteractionProps;
  }): Promise<UserSessionWithTokens> {
    const { user, isGlobalLogin, projectId, metadata, props } = data;

    if (!user.id) {
      throw new Error("User must have an id to create a session.");
    }

    const now: Date = OneUptimeDate.getCurrentDate();
    const refreshToken: string = generateRefreshToken();
    const refreshTokenHash: string = hashRefreshToken(refreshToken);
    const refreshTokenExpiresAt: Date = computeRefreshTokenExpiryDate();

    const session: UserSession = new UserSession();
    session.userId = user.id;
    session.isGlobalLogin = isGlobalLogin;

    if (projectId) {
      session.projectId = projectId;
    }

    session.refreshToken = new HashedString(refreshTokenHash, true);
    session.refreshTokenExpiresAt = refreshTokenExpiresAt;
    session.lastUsedAt = now;
    if (metadata?.ipAddress !== undefined) {
      session.ipAddress = metadata.ipAddress;
    }

    if (metadata?.userAgent !== undefined) {
      session.userAgent = metadata.userAgent;
    }

    if (metadata?.device !== undefined) {
      session.device = metadata.device;
    }

    const createdSession: UserSession = await this.create({
      data: session,
      props: props || {
        isRoot: true,
      },
    });

    const accessToken: string = this.createAccessToken({
      user,
      isGlobalLogin,
      ...(projectId ? { projectId } : {}),
    });

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresInSeconds: getAccessTokenExpiresInSeconds(),
      refreshTokenExpiresInSeconds: getRefreshTokenExpiresInSeconds(),
      refreshTokenExpiresAt,
      session: createdSession,
    };
  }

  @CaptureSpan()
  public async rotateSessionTokens(data: {
    session: UserSession;
    user: User;
    metadata?: SessionMetadata;
    props?: DatabaseCommonInteractionProps;
  }): Promise<UserSessionWithTokens> {
    const { session, user, metadata, props } = data;

    if (!session.id) {
      throw new Error("Session id is required to rotate tokens.");
    }

    const refreshToken: string = generateRefreshToken();
    const refreshTokenHash: string = hashRefreshToken(refreshToken);
    const refreshTokenExpiresAt: Date = computeRefreshTokenExpiryDate();
    const now: Date = OneUptimeDate.getCurrentDate();

    session.refreshToken = new HashedString(refreshTokenHash, true);
    session.refreshTokenExpiresAt = refreshTokenExpiresAt;
    session.lastUsedAt = now;
    if (metadata?.ipAddress !== undefined) {
      session.ipAddress = metadata.ipAddress;
    }

    if (metadata?.userAgent !== undefined) {
      session.userAgent = metadata.userAgent;
    }

    if (metadata?.device !== undefined) {
      session.device = metadata.device;
    }
    session.isRevoked = false;

    const updateData: QueryDeepPartialEntity<UserSession> = {
      refreshToken: session.refreshToken,
      refreshTokenExpiresAt,
      lastUsedAt: now,
      isRevoked: false,
    };

    if (metadata?.ipAddress !== undefined) {
      updateData.ipAddress = metadata.ipAddress;
    }

    if (metadata?.userAgent !== undefined) {
      updateData.userAgent = metadata.userAgent;
    }

    if (metadata?.device !== undefined) {
      updateData.device = metadata.device;
    }

    await this.updateOneById({
      id: session.id,
      data: updateData,
      props: props || {
        isRoot: true,
      },
    });

    const accessToken: string = this.createAccessToken({
      user,
      isGlobalLogin: Boolean(session.isGlobalLogin),
      ...(session.projectId ? { projectId: session.projectId } : {}),
    });

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresInSeconds: getAccessTokenExpiresInSeconds(),
      refreshTokenExpiresInSeconds: getRefreshTokenExpiresInSeconds(),
      refreshTokenExpiresAt,
      session,
    };
  }

  @CaptureSpan()
  public async getActiveSessionByRefreshToken(data: {
    refreshToken: string;
    props?: DatabaseCommonInteractionProps;
  }): Promise<UserSession | null> {
    const { refreshToken, props } = data;

    if (!refreshToken) {
      return null;
    }

    const refreshTokenHash: string = hashRefreshToken(refreshToken);

    const session: UserSession | null = await this.findOneBy({
      query: {
        refreshToken: new HashedString(refreshTokenHash, true),
        isRevoked: false,
      },
      select: {
        _id: true,
        userId: true,
        isGlobalLogin: true,
        projectId: true,
        refreshTokenExpiresAt: true,
      },
      props: props || {
        isRoot: true,
      },
    });

    if (!session) {
      return null;
    }

    if (session.refreshTokenExpiresAt) {
      const refreshExpired: boolean = OneUptimeDate.hasExpired(
        session.refreshTokenExpiresAt,
      );

      if (refreshExpired) {
        await this.revokeSessionById({
          sessionId: session.id!,
          ...(props ? { props } : {}),
        });
        return null;
      }
    }

    return session;
  }

  @CaptureSpan()
  public async revokeSessionByRefreshToken(data: {
    refreshToken: string;
    props?: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const { refreshToken, props } = data;

    if (!refreshToken) {
      return;
    }

    const refreshTokenHash: string = hashRefreshToken(refreshToken);

    await this.updateOneBy({
      query: {
        refreshToken: new HashedString(refreshTokenHash, true),
      },
      data: {
        isRevoked: true,
        refreshTokenExpiresAt: OneUptimeDate.getCurrentDate(),
      },
      props: props || {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async revokeSessionById(data: {
    sessionId: ObjectID;
    props?: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const { sessionId, props } = data;

    await this.updateOneById({
      id: sessionId,
      data: {
        isRevoked: true,
        refreshTokenExpiresAt: OneUptimeDate.getCurrentDate(),
      },
      props: props || {
        isRoot: true,
      },
    });
  }

  private createAccessToken(data: {
    user: User;
    isGlobalLogin: boolean;
    projectId?: ObjectID;
  }): string {
    const { user, isGlobalLogin, projectId } = data;

    return JSONWebToken.sign({
      data: {
        userId: user.id!,
        email: user.email!,
        name: user.name!,
        timezone: user.timezone || null,
        isMasterAdmin: Boolean(user.isMasterAdmin),
        isGlobalLogin,
        projectId: projectId || undefined,
      },
      expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
    });
  }
}

export default new Service();
