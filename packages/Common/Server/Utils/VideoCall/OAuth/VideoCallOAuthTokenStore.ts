import Semaphore, { SemaphoreMutex } from "../../../Infrastructure/Semaphore";
import VideoCallConnectionService, {
  Service as VideoCallConnectionServiceType,
} from "../../../Services/VideoCallConnectionService";
import logger, { LogAttributes } from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import VideoCallConnection from "../../../../Models/DatabaseModels/VideoCallConnection";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import VideoCallAuthMethod from "../../../../Types/VideoCall/VideoCallAuthMethod";
import VideoCallProvider, {
  getVideoCallProviderDisplayName,
} from "../../../../Types/VideoCall/VideoCallProvider";
import VideoCallConnectionSettingsUtil from "../VideoCallConnectionSettings";
import VideoCallHttpClient from "../VideoCallHttpClient";
import VideoCallOAuthUtil, {
  VideoCallOAuthAccess,
  VideoCallOAuthAccessToken,
  VideoCallOAuthApp,
  VideoCallOAuthSecrets,
  VideoCallOAuthTokens,
} from "./VideoCallOAuth";
import VideoCallOAuthApps from "./VideoCallOAuthApps";

/*
 * THE SIGN-IN OF A CONNECTION MADE BY SIGNING IN.
 *
 * A call is started with a short-lived access token, which the stored
 * refresh token is exchanged for when the last one has run out.
 *
 * One sign-in per account. Zoom keeps a single sign-in for each person and
 * app - signing in again retires the refresh token it issued before - and
 * its refresh tokens are good for one use. So the connections signed in as
 * the same account (the same provider and connectedAccountId, in any
 * project) share one sign-in: they hold the same tokens, a refresh is
 * written to all of them, and a sign-in that replaces it is too
 * (VideoCallOAuthAPI). Google and Microsoft would allow one per connection,
 * but sharing costs them nothing and keeps one rule.
 *
 * One refresh at a time. Two at once - two incidents declared together, or
 * one while the daily keep-alive runs - would spend a Zoom refresh token
 * twice and leave the account signed out. So a refresh holds the account's
 * lock, reads the tokens again once it has it (whoever held it may have
 * refreshed already), and stores the new ones before handing out the access
 * token.
 *
 * Only this store and the sign-in write an OAuth connection's secrets, and
 * they write nothing else: an edit of the connection's settings never
 * touches them, so it can never put back a refresh token that was already
 * spent (VideoCallConnectionService.onBeforeUpdate).
 *
 * Without Valkey a refresh goes ahead unlocked, as the rest of OneUptime's
 * locks do.
 */
export default class VideoCallOAuthTokenStore {
  // An access token is handed out only while it has at least this long left.
  public static readonly ACCESS_TOKEN_MARGIN_IN_MS: number = 2 * 60 * 1000;

  /*
   * The daily keep-alive refreshes a sign-in it has not refreshed in this
   * long. Zoom's and Microsoft's refresh tokens expire after 90 days without
   * use, Google's after six months, so a week leaves every sign-in many
   * chances to be kept.
   */
  public static readonly KEEP_ALIVE_AFTER_IN_MS: number =
    7 * 24 * 60 * 60 * 1000;

  public static readonly LOCK_NAMESPACE: string = "video-call-oauth-sign-in";

  // Longer than a refresh takes: the token request's own deadline plus the write.
  private static readonly LOCK_TIMEOUT_IN_MS: number = 45 * 1000;
  private static readonly LOCK_ACQUIRE_TIMEOUT_IN_MS: number = 40 * 1000;

  /*
   * What a meeting client is handed for a connection made by signing in: a
   * current access token on demand, and the account it is for.
   */
  public static getAccess(data: {
    connectionId: ObjectID;
    provider: VideoCallProvider;
    accountLabel: string;
    http?: VideoCallHttpClient | undefined;
  }): VideoCallOAuthAccess {
    return {
      accountLabel: data.accountLabel,
      getAccessToken: (): Promise<VideoCallOAuthAccessToken> => {
        return VideoCallOAuthTokenStore.getAccessToken(data);
      },
    };
  }

  /*
   * A current access token for the connection: the stored one while it
   * lasts, or a new one from the refresh token.
   */
  @CaptureSpan()
  public static async getAccessToken(data: {
    connectionId: ObjectID;
    provider: VideoCallProvider;
    accountLabel: string;
    http?: VideoCallHttpClient | undefined;
  }): Promise<VideoCallOAuthAccessToken> {
    const stored: StoredSignIn =
      await VideoCallOAuthTokenStore.readConnection(data);

    if (
      VideoCallOAuthUtil.hasFreshAccessToken(
        stored.secrets,
        VideoCallOAuthTokenStore.ACCESS_TOKEN_MARGIN_IN_MS,
      )
    ) {
      return VideoCallOAuthTokenStore.toAccessToken(stored.secrets);
    }

    return await VideoCallOAuthTokenStore.refreshIf({
      ...data,
      accountId: stored.accountId,
      needsRefresh: (current: VideoCallOAuthSecrets): boolean => {
        return !VideoCallOAuthUtil.hasFreshAccessToken(
          current,
          VideoCallOAuthTokenStore.ACCESS_TOKEN_MARGIN_IN_MS,
        );
      },
    });
  }

  /*
   * Refreshes the connection's sign-in when it has not been refreshed for
   * KEEP_ALIVE_AFTER_IN_MS, so its refresh token never expires for want of
   * use. True when it refreshed.
   */
  @CaptureSpan()
  public static async keepAlive(data: {
    connectionId: ObjectID;
    provider: VideoCallProvider;
    accountLabel: string;
    http?: VideoCallHttpClient | undefined;
    now?: Date | undefined;
  }): Promise<boolean> {
    const now: Date = data.now || new Date();
    const stored: StoredSignIn =
      await VideoCallOAuthTokenStore.readConnection(data);
    let refreshed: boolean = false;

    await VideoCallOAuthTokenStore.refreshIf({
      ...data,
      accountId: stored.accountId,
      needsRefresh: (current: VideoCallOAuthSecrets): boolean => {
        refreshed = VideoCallOAuthTokenStore.isDueForKeepAlive(current, now);
        return refreshed;
      },
    });

    return refreshed;
  }

  public static isDueForKeepAlive(
    secrets: VideoCallOAuthSecrets,
    now: Date,
  ): boolean {
    const refreshedAt: number = Date.parse(secrets.tokensRefreshedAt || "");

    return (
      !Number.isFinite(refreshedAt) ||
      now.getTime() - refreshedAt >=
        VideoCallOAuthTokenStore.KEEP_ALIVE_AFTER_IN_MS
    );
  }

  /*
   * Every sign-in, kept alive, once each. One that cannot be refreshed - it
   * was removed from the account, or has expired - says so on its
   * connections the day it happens (lastError), not at the next incident.
   */
  @CaptureSpan()
  public static async keepAllAlive(data?: {
    http?: VideoCallHttpClient | undefined;
    now?: Date | undefined;
  }): Promise<void> {
    const connections: Array<VideoCallConnection> =
      await VideoCallConnectionService.findAllBy({
        query: { authMethod: VideoCallAuthMethod.OAuth },
        select: {
          _id: true,
          projectId: true,
          provider: true,
          connectedAccount: true,
          connectedAccountId: true,
        },
        props: { isRoot: true },
      });

    const kept: Set<string> = new Set();

    for (const connection of connections) {
      // A sign-in that was removed has nothing to keep: it waits for a reconnect.
      if (
        !connection.id ||
        !connection.provider ||
        !connection.connectedAccount
      ) {
        continue;
      }

      const signInKey: string = VideoCallOAuthTokenStore.getSignInKey({
        provider: connection.provider,
        accountId: connection.connectedAccountId,
        connectionId: connection.id,
      });

      if (kept.has(signInKey)) {
        continue;
      }

      kept.add(signInKey);

      try {
        await VideoCallOAuthTokenStore.keepAlive({
          connectionId: connection.id,
          provider: connection.provider,
          accountLabel: connection.connectedAccount,
          http: data?.http,
          now: data?.now,
        });
      } catch (error) {
        logger.warn(
          `Could not keep the sign-in of a video call connection alive: ${VideoCallConnectionServiceType.getErrorMessage(error)}`,
          {
            projectId: connection.projectId?.toString(),
            videoCallConnectionId: connection.id.toString(),
          } as LogAttributes,
        );

        await VideoCallConnectionService.recordSignInProblem({
          provider: connection.provider,
          accountId: connection.connectedAccountId,
          connectionId: connection.id,
          error,
        });
      }
    }
  }

  /*
   * The lock and the rows one sign-in lives in: the provider and the
   * account, or the connection alone for one stored without an account.
   */
  public static getSignInKey(data: {
    provider: VideoCallProvider;
    accountId?: string | undefined;
    connectionId: ObjectID;
  }): string {
    return data.accountId
      ? `${data.provider}-${data.accountId}`
      : `connection-${data.connectionId.toString()}`;
  }

  /*
   * Takes the sign-in's lock, for writing a new sign-in over it
   * (VideoCallOAuthAPI) as well as for a refresh. Null without Valkey, or
   * when a refresh held it for longer than anyone waits: the caller goes
   * ahead without it.
   */
  public static async takeLock(data: {
    signInKey: string;
    logAttributes: LogAttributes;
  }): Promise<SemaphoreMutex | null> {
    try {
      return await Semaphore.lock({
        key: data.signInKey,
        namespace: VideoCallOAuthTokenStore.LOCK_NAMESPACE,
        lockTimeout: VideoCallOAuthTokenStore.LOCK_TIMEOUT_IN_MS,
        acquireTimeout: VideoCallOAuthTokenStore.LOCK_ACQUIRE_TIMEOUT_IN_MS,
      });
    } catch (err) {
      logger.warn(
        `Going ahead with a video call connection's sign-in without its lock: ${(err as Error)?.message || String(err)}`,
        data.logAttributes,
      );
      return null;
    }
  }

  // Never throws: the lock runs out on its own if giving it back fails.
  public static async giveBack(
    mutex: SemaphoreMutex | null,
    logAttributes: LogAttributes,
  ): Promise<void> {
    if (!mutex) {
      return;
    }

    try {
      await Semaphore.release(mutex);
    } catch (err) {
      logger.error(err, logAttributes);
    }
  }

  /*
   * Stores a sign-in in every connection that shares it. Zoom has already
   * retired the refresh token the new one replaces, so a write that fails
   * is tried again before giving up.
   */
  public static async writeSignIn(data: {
    provider: VideoCallProvider;
    accountId?: string | undefined;
    connectionId: ObjectID;
    secrets: VideoCallOAuthSecrets;
    logAttributes: LogAttributes;
  }): Promise<void> {
    const attempts: number = 3;

    for (let attempt: number = 1; ; attempt++) {
      try {
        if (data.accountId) {
          await VideoCallConnectionService.updateBy({
            query: {
              provider: data.provider,
              authMethod: VideoCallAuthMethod.OAuth,
              connectedAccountId: data.accountId,
            },
            data: {
              secrets: JSON.stringify(data.secrets),
            },
            limit: LIMIT_MAX,
            skip: 0,
            props: { isRoot: true, ignoreHooks: true },
          });
        } else {
          await VideoCallConnectionService.updateOneById({
            id: data.connectionId,
            data: {
              secrets: JSON.stringify(data.secrets),
            },
            props: { isRoot: true, ignoreHooks: true },
          });
        }

        return;
      } catch (error) {
        if (attempt >= attempts) {
          throw error;
        }

        logger.warn(
          `Could not store a video call connection's sign-in (attempt ${attempt} of ${attempts}); trying again.`,
          data.logAttributes,
        );

        await new Promise((resolve: (value: unknown) => void) => {
          setTimeout(resolve, 250 * attempt);
        });
      }
    }
  }

  // Under the sign-in's lock: refreshes when `needsRefresh` says so of the tokens as they are now.
  private static async refreshIf(data: {
    connectionId: ObjectID;
    provider: VideoCallProvider;
    accountLabel: string;
    accountId?: string | undefined;
    http?: VideoCallHttpClient | undefined;
    needsRefresh: (current: VideoCallOAuthSecrets) => boolean;
  }): Promise<VideoCallOAuthAccessToken> {
    const logAttributes: LogAttributes = {
      videoCallConnectionId: data.connectionId.toString(),
    } as LogAttributes;

    const mutex: SemaphoreMutex | null =
      await VideoCallOAuthTokenStore.takeLock({
        signInKey: VideoCallOAuthTokenStore.getSignInKey(data),
        logAttributes,
      });

    try {
      const current: VideoCallOAuthSecrets =
        await VideoCallOAuthTokenStore.readSignIn(data);

      if (!data.needsRefresh(current)) {
        return VideoCallOAuthTokenStore.toAccessToken(current);
      }

      const app: VideoCallOAuthApp = VideoCallOAuthApps.getOrThrow(
        data.provider,
        data.http,
      );

      const tokens: VideoCallOAuthTokens = await app.refresh({
        secrets: current,
        accountLabel: data.accountLabel,
      });

      const next: VideoCallOAuthSecrets = VideoCallOAuthUtil.toSecrets({
        tokens,
        previous: current,
      });

      await VideoCallOAuthTokenStore.writeSignIn({
        provider: data.provider,
        accountId: data.accountId,
        connectionId: data.connectionId,
        secrets: next,
        logAttributes,
      });

      return VideoCallOAuthTokenStore.toAccessToken(next);
    } finally {
      await VideoCallOAuthTokenStore.giveBack(mutex, logAttributes);
    }
  }

  private static toAccessToken(
    secrets: VideoCallOAuthSecrets,
  ): VideoCallOAuthAccessToken {
    return {
      accessToken: secrets.accessToken || "",
      apiBaseUrl: secrets.apiBaseUrl,
    };
  }

  // The connection's own copy of its sign-in, and the account it is for.
  private static async readConnection(data: {
    connectionId: ObjectID;
    provider: VideoCallProvider;
  }): Promise<StoredSignIn> {
    const connection: VideoCallConnection | null =
      await VideoCallConnectionService.findOneById({
        id: data.connectionId,
        select: { _id: true, secrets: true, connectedAccountId: true },
        props: { isRoot: true },
      });

    if (!connection) {
      throw new BadDataException(
        "The video call connection no longer exists. Pick another one, or connect a provider again in Project Settings > Video Calls.",
      );
    }

    const secrets: VideoCallOAuthSecrets | null =
      VideoCallOAuthTokenStore.parseSecrets(connection.secrets);

    if (!secrets) {
      throw VideoCallOAuthTokenStore.getSignedOutError(data.provider);
    }

    return {
      secrets,
      accountId: connection.connectedAccountId || undefined,
    };
  }

  /*
   * The newest copy of the sign-in among the connections that share it: a
   * copy a failed write left behind is never the one refreshed.
   */
  private static async readSignIn(data: {
    connectionId: ObjectID;
    provider: VideoCallProvider;
    accountId?: string | undefined;
  }): Promise<VideoCallOAuthSecrets> {
    if (!data.accountId) {
      return (await VideoCallOAuthTokenStore.readConnection(data)).secrets;
    }

    const connections: Array<VideoCallConnection> =
      await VideoCallConnectionService.findBy({
        query: {
          provider: data.provider,
          authMethod: VideoCallAuthMethod.OAuth,
          connectedAccountId: data.accountId,
        },
        select: { _id: true, secrets: true },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

    let newest: VideoCallOAuthSecrets | null = null;

    for (const connection of connections) {
      const secrets: VideoCallOAuthSecrets | null =
        VideoCallOAuthTokenStore.parseSecrets(connection.secrets);

      if (
        secrets &&
        (!newest ||
          VideoCallOAuthTokenStore.refreshedAt(secrets) >
            VideoCallOAuthTokenStore.refreshedAt(newest))
      ) {
        newest = secrets;
      }
    }

    if (!newest) {
      throw VideoCallOAuthTokenStore.getSignedOutError(data.provider);
    }

    return newest;
  }

  private static refreshedAt(secrets: VideoCallOAuthSecrets): number {
    const time: number = Date.parse(secrets.tokensRefreshedAt || "");
    return Number.isFinite(time) ? time : 0;
  }

  private static parseSecrets(
    value: string | undefined,
  ): VideoCallOAuthSecrets | null {
    let stored: JSONObject = {};

    try {
      stored = VideoCallConnectionSettingsUtil.parseJsonObject(
        value,
        "Credentials",
      );
    } catch {
      return null;
    }

    return VideoCallOAuthUtil.readSecrets(stored);
  }

  private static getSignedOutError(provider: VideoCallProvider): Error {
    const title: string = getVideoCallProviderDisplayName(provider);

    return new BadDataException(
      `This ${title} connection is signed out: the account that connected it removed OneUptime, or the sign-in never finished. Reconnect ${title} in Project Settings > Video Calls.`,
    );
  }
}

interface StoredSignIn {
  secrets: VideoCallOAuthSecrets;
  accountId?: string | undefined;
}
