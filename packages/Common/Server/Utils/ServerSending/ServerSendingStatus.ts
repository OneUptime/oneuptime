import GlobalConfigService from "../../Services/GlobalConfigService";
import ProbeService from "../../Services/ProbeService";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import ServerChannelSetup, {
  SERVER_CHANNEL_SETUP_SELECT,
} from "./ServerChannelSetup";
import ServerSendingOutcomes, {
  ServerSendingOutcome,
} from "./ServerSendingOutcomes";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import { ProbeConnectionStatus } from "../../../Models/DatabaseModels/Probe";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import ServerSendingStatusUtil, {
  SERVER_SENDING_CHANNELS,
  ServerChannelStatus,
  ServerGlobalProbesStatus,
  ServerSendingChannel,
  ServerSendingHealth,
  ServerSendingHealthEntry,
  ServerSendingStatusAnswer,
} from "../../../Types/ServerSending/ServerSendingStatus";

/*
 * CAN THIS SERVER SEND? THE ONE ANSWER ON THE SERVER.
 *
 * Per channel - email, SMS, calls, push - from the server's own settings
 * (ServerChannelSetup, the rules the Notification service sends by) and from
 * what the server remembers of its own last sends (GlobalConfig.
 * serverSendingHealth), as Types/ServerSending/ServerSendingStatus words it:
 * not-set-up, untested, working, or failing since when and why.
 *
 * Read by:
 *
 *   - GET /global-config/vars (anybody): canSendEmail, so the sign-in pages,
 *     the invite dialogs, Home and Create Monitor stop promising an email the
 *     server cannot send;
 *   - GET /global-config/sending-status (master admins): every channel, and
 *     whether the global probes report - the banner, and the server's setup
 *     checklist (#6824) and Welcome checklist (#6803) after it;
 *   - Forgot password, sign-in links and a sign-up that needs a link emailed
 *     (Identity): refused while email is not set up, the same answer for
 *     every address.
 *
 * Written by:
 *
 *   - the senders, through ServerSendingOutcomes, which the Notification
 *     service points at recordOutcome when it starts;
 *   - GlobalConfigService, which starts a channel again at untested when its
 *     settings are saved (forgetChannels).
 */

/*
 * How long this server keeps what it read of the server's last sends before
 * it reads them again, for deciding whether a send is news worth a write.
 * Whatever is written is read fresh first.
 */
export const SERVER_SENDING_HEALTH_CACHE_TTL_MS: number = 60 * 1000;

interface CachedHealth {
  health: ServerSendingHealth;
  readAt: number;
}

export default class ServerSendingStatus {
  private static cachedHealth: CachedHealth | null = null;

  // For tests: forget what this server read.
  public static clearCache(): void {
    ServerSendingStatus.cachedHealth = null;
  }

  // The row the answers read: the settings, and what the server remembers.
  @CaptureSpan()
  public static async readConfig(): Promise<GlobalConfig | null> {
    return await GlobalConfigService.findOneById({
      id: ObjectID.getZeroObjectID(),
      select: {
        ...SERVER_CHANNEL_SETUP_SELECT,
        serverSendingHealth: true,
      },
      props: {
        isRoot: true,
      },
    });
  }

  // Every channel's status, from a row read with readConfig.
  public static getStatusesFrom(
    config: GlobalConfig | null,
  ): Array<ServerChannelStatus> {
    const health: ServerSendingHealth = ServerSendingStatusUtil.readHealth(
      config?.serverSendingHealth,
    );

    return SERVER_SENDING_CHANNELS.map(
      (channel: ServerSendingChannel): ServerChannelStatus => {
        return ServerSendingStatusUtil.getStatus({
          channel: channel,
          setUpProblem: ServerChannelSetup.getSetUpProblem(channel, config),
          entry: ServerSendingStatusUtil.getEntry(health, channel),
        });
      },
    );
  }

  public static getStatusFrom(
    config: GlobalConfig | null,
    channel: ServerSendingChannel,
  ): ServerChannelStatus {
    const health: ServerSendingHealth = ServerSendingStatusUtil.readHealth(
      config?.serverSendingHealth,
    );

    return ServerSendingStatusUtil.getStatus({
      channel: channel,
      setUpProblem: ServerChannelSetup.getSetUpProblem(channel, config),
      entry: ServerSendingStatusUtil.getEntry(health, channel),
    });
  }

  @CaptureSpan()
  public static async getStatuses(): Promise<Array<ServerChannelStatus>> {
    return ServerSendingStatus.getStatusesFrom(
      await ServerSendingStatus.readConfig(),
    );
  }

  @CaptureSpan()
  public static async getStatus(
    channel: ServerSendingChannel,
  ): Promise<ServerChannelStatus> {
    return ServerSendingStatus.getStatusFrom(
      await ServerSendingStatus.readConfig(),
      channel,
    );
  }

  /*
   * Whether the server's email settings would let an email go out at all.
   * What a sign-in page's request is refused on: not set up is known for
   * certain, so nobody is sent to wait for an email that cannot come.
   */
  @CaptureSpan()
  public static async isEmailSetUp(): Promise<boolean> {
    return (
      ServerChannelSetup.getEmailSetUpProblem(
        await ServerSendingStatus.readConfig(),
      ) === null
    );
  }

  /*
   * Whether the server's email settings are read, and are missing or
   * incomplete: what Forgot password, sign-in links and a sign-up that needs
   * a link emailed are refused on, the same answer for every address. A
   * read that fails, or finds no row, is not that: the request goes on as it
   * always did, and the send says how it went.
   */
  @CaptureSpan()
  public static async isEmailKnownNotSetUp(): Promise<boolean> {
    try {
      const config: GlobalConfig | null =
        await ServerSendingStatus.readConfig();

      if (!config) {
        return false;
      }

      return ServerChannelSetup.getEmailSetUpProblem(config) !== null;
    } catch (err) {
      logger.warn("Could not read whether this server's email is set up.");
      logger.warn(err);
      return false;
    }
  }

  /*
   * What a page anybody can open may say about email: false while it is not
   * set up, or is and has never managed to send (canSendPublicly).
   */
  public static canSendEmailPubliclyFrom(config: GlobalConfig | null): boolean {
    return ServerSendingStatusUtil.canSendPublicly(
      ServerSendingStatus.getStatusFrom(config, ServerSendingChannel.Email),
    );
  }

  @CaptureSpan()
  public static async canSendEmailPublicly(): Promise<boolean> {
    return ServerSendingStatus.canSendEmailPubliclyFrom(
      await ServerSendingStatus.readConfig(),
    );
  }

  /*
   * How many global probes the server has and how many report: monitors
   * that run on them go unchecked when none does. Null when it has none.
   */
  @CaptureSpan()
  public static async getGlobalProbesStatus(): Promise<ServerGlobalProbesStatus | null> {
    const total: PositiveNumber = await ProbeService.countBy({
      query: {
        isGlobalProbe: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (total.toNumber() === 0) {
      return null;
    }

    const reporting: PositiveNumber = await ProbeService.countBy({
      query: {
        isGlobalProbe: true,
        connectionStatus: ProbeConnectionStatus.Connected,
      },
      props: {
        isRoot: true,
      },
    });

    return {
      total: total.toNumber(),
      reporting: reporting.toNumber(),
    };
  }

  // The body of GET /global-config/sending-status.
  @CaptureSpan()
  public static async getAnswer(): Promise<ServerSendingStatusAnswer> {
    const [channels, globalProbes] = await Promise.all([
      ServerSendingStatus.getStatuses(),
      ServerSendingStatus.getGlobalProbesStatus(),
    ]);

    return {
      channels: channels,
      globalProbes: globalProbes,
    };
  }

  // What the server remembers, read fresh.
  private static async readHealthFromDatabase(): Promise<ServerSendingHealth> {
    const config: GlobalConfig | null = await GlobalConfigService.findOneById({
      id: ObjectID.getZeroObjectID(),
      select: {
        serverSendingHealth: true,
      },
      props: {
        isRoot: true,
      },
    });

    const health: ServerSendingHealth = ServerSendingStatusUtil.readHealth(
      config?.serverSendingHealth,
    );

    ServerSendingStatus.cachedHealth = {
      health: health,
      readAt: Date.now(),
    };

    return health;
  }

  private static async readHealth(): Promise<ServerSendingHealth> {
    const cached: CachedHealth | null = ServerSendingStatus.cachedHealth;

    if (
      cached &&
      Date.now() - cached.readAt < SERVER_SENDING_HEALTH_CACHE_TTL_MS
    ) {
      return cached.health;
    }

    return await ServerSendingStatus.readHealthFromDatabase();
  }

  private static async writeHealth(health: ServerSendingHealth): Promise<void> {
    await GlobalConfigService.writeServerSendingHealth(health);

    ServerSendingStatus.cachedHealth = {
      health: health,
      readAt: Date.now(),
    };
  }

  /*
   * Writes down how one of the server's own sends went, when it is news: a
   * change at once (the first that goes out, the first that fails, a new
   * reason), the same news at most once an hour
   * (SERVER_SENDING_HEALTH_REWRITE_INTERVAL_MS). What is written is decided
   * again on a fresh read, so two servers sending at once lose nothing but
   * the order of their news.
   */
  @CaptureSpan()
  public static async recordOutcome(
    outcome: ServerSendingOutcome,
  ): Promise<void> {
    const now: Date = new Date();
    const reason: string = outcome.reason || "";

    const isNews: (entry: ServerSendingHealthEntry) => boolean = (
      entry: ServerSendingHealthEntry,
    ): boolean => {
      return outcome.succeeded
        ? ServerSendingStatusUtil.shouldWriteSucceeded(entry, now)
        : ServerSendingStatusUtil.shouldWriteFailed(entry, reason, now);
    };

    const known: ServerSendingHealth = await ServerSendingStatus.readHealth();

    if (!isNews(ServerSendingStatusUtil.getEntry(known, outcome.channel))) {
      return;
    }

    const health: ServerSendingHealth =
      await ServerSendingStatus.readHealthFromDatabase();
    const entry: ServerSendingHealthEntry = ServerSendingStatusUtil.getEntry(
      health,
      outcome.channel,
    );

    if (!isNews(entry)) {
      return;
    }

    health[outcome.channel] = outcome.succeeded
      ? ServerSendingStatusUtil.withSucceeded(entry, now)
      : ServerSendingStatusUtil.withFailed(entry, reason, now);

    await ServerSendingStatus.writeHealth(health);
  }

  /*
   * Starts channels again at untested: their settings were saved, and what
   * the server remembers was learned with the ones before.
   */
  @CaptureSpan()
  public static async forgetChannels(
    channels: Array<ServerSendingChannel>,
  ): Promise<void> {
    await GlobalConfigService.forgetServerSendingHealthOf(channels);
    ServerSendingStatus.clearCache();
  }

  /*
   * Points the senders at recordOutcome (ServerSendingOutcomes). Called once
   * by the Notification service as it starts.
   */
  public static startRecordingOutcomes(): void {
    ServerSendingOutcomes.register(
      async (outcome: ServerSendingOutcome): Promise<void> => {
        try {
          await ServerSendingStatus.recordOutcome(outcome);
        } catch (err) {
          logger.warn(
            `Could not write down how one of this server's own ${outcome.channel} sends went.`,
          );
          logger.warn(err);
        }
      },
    );
  }
}
