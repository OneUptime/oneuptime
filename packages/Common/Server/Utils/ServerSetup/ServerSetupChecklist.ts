import BackupRunService from "../../Services/BackupRunService";
import GlobalConfigService from "../../Services/GlobalConfigService";
import GlobalOidcService from "../../Services/GlobalOidcService";
import GlobalSsoService from "../../Services/GlobalSsoService";
import LlmProviderService from "../../Services/LlmProviderService";
import UserService from "../../Services/UserService";
import EnterpriseEdition from "../../Enterprise/EnterpriseEdition";
import {
  DisableUpdateCheck,
  HttpProtocol,
  VapidPrivateKey,
  VapidPublicKey,
} from "../../EnvironmentConfig";
import { SERVER_CHANNEL_SETUP_SELECT } from "../ServerSending/ServerChannelSetup";
import { toServerEmailSettings } from "../ServerEmailSettings";
import ServerSendingStatus from "../ServerSending/ServerSendingStatus";
import CaptureSpan from "../Telemetry/CaptureSpan";
import logger from "../Logger";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import BackupRun from "../../../Models/DatabaseModels/BackupRun";
import GlobalConfig, {
  EmailServerType,
} from "../../../Models/DatabaseModels/GlobalConfig";
import User from "../../../Models/DatabaseModels/User";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import {
  BackupRunKind,
  BackupRunStatus,
} from "../../../Types/Backup/BackupRunTypes";
import CallAndSmsProviders from "../../../Types/CallAndSMS/CallAndSmsProvider";
import MailTransportType from "../../../Types/Email/MailTransportType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  ServerChannelStatus,
  ServerGlobalProbesStatus,
  ServerSendingChannel,
} from "../../../Types/ServerSending/ServerSendingStatus";
import ServerSetupChecklistUtil, {
  ServerSetupCheckId,
  ServerSetupCheckResult,
  ServerSetupChecklistAnswer,
  ServerSetupChoiceKind,
  ServerSetupChoices,
  ServerSetupFacts,
} from "../../../Types/ServerSetup/ServerSetupChecklist";

/*
 * THE SERVER'S SETUP CHECKLIST, READ FROM WHAT THE SERVER IS.
 *
 * Reads every fact the checks need (Types/ServerSetup/ServerSetupChecklist
 * says what each check is for and decides it from these): the email, SMS
 * and call channels as ServerSendingStatus words them - the same answer the
 * banner reads, so the two never disagree - HTTP_PROTOCOL, the sign-up
 * switch, the global probes, the update check, the last backup, VAPID keys,
 * the global LLM providers and single sign-on, and what admins chose
 * (GlobalConfig.serverSetupChoices).
 *
 * Every read is as OneUptime itself, and the answer is for master admins
 * only (GET /global-config/setup-checklist). `npm run doctor` (#6826) calls
 * getAnswer() too, and prints each check with SERVER_SETUP_STATUS_WORDS.
 */

// What the answers read of the settings row, beside the channels' settings.
export const SERVER_SETUP_CONFIG_SELECT: Select<GlobalConfig> = {
  ...SERVER_CHANNEL_SETUP_SELECT,
  serverSendingHealth: true,
  disableSignup: true,
  latestReleaseCheckedAt: true,
  updateCheckLastAttemptAt: true,
  updateCheckLastFailure: true,
  serverSetupChoices: true,
};

/*
 * What takes the server's email: the mail server's host name, or the
 * provider's name (with its Region for Amazon SES). Null when nothing is
 * set up. Never a key, a username or a password. The settings are the ones
 * the GLOBAL_EMAIL_ environment variables set, once they are (#7738):
 * whatever the row holds, and none while something is wrong with them.
 */
export const getEmailSentThrough: (
  row: Partial<GlobalConfig> | null,
) => string | null = (row: Partial<GlobalConfig> | null): string | null => {
  const config: Partial<GlobalConfig> | null = toServerEmailSettings(row);

  if (!config) {
    return null;
  }

  const text: (value: unknown) => string = (value: unknown): string => {
    // A host as the row holds it, and as the variables give it: a Hostname.
    if (value instanceof Hostname) {
      return value.toString().trim();
    }

    return typeof value === "string" ? value.trim() : "";
  };

  switch (config.emailServerType || EmailServerType.CustomSMTP) {
    case EmailServerType.Sendgrid:
      return "SendGrid";
    case EmailServerType.AmazonSES: {
      const region: string = text(config.amazonSesRegion).toLowerCase();
      return region ? `Amazon SES (${region})` : "Amazon SES";
    }
    case EmailServerType.Mailgun:
      return "Mailgun";
    case EmailServerType.Postmark:
      return "Postmark";
    case EmailServerType.Resend:
      return "Resend";
    default:
      break;
  }

  if (config.smtpTransportType === MailTransportType.MicrosoftGraph) {
    return "Microsoft Graph";
  }

  return text(config.smtpHost) || null;
};

/*
 * What takes the server's SMS and calls: its gateway's host name, or
 * Twilio. Never the gateway's secret or a path that might carry one.
 */
export const getCallAndSmsSentThrough: (
  config: Partial<GlobalConfig> | null,
) => string = (config: Partial<GlobalConfig> | null): string => {
  const gateway: { url: string } | null = config
    ? CallAndSmsProviders.getGateway(config)
    : null;

  if (gateway) {
    try {
      return (
        new globalThis.URL(gateway.url).hostname || "your SMS and call gateway"
      );
    } catch {
      return "your SMS and call gateway";
    }
  }

  return "Twilio";
};

export default class ServerSetupChecklist {
  @CaptureSpan()
  public static async readConfig(): Promise<GlobalConfig | null> {
    return await GlobalConfigService.findOneById({
      id: ObjectID.getZeroObjectID(),
      select: SERVER_SETUP_CONFIG_SELECT,
      props: {
        isRoot: true,
      },
    });
  }

  // A read that fails answers as nothing there: one check, not the page.
  private static async orDefault<T>(
    read: () => Promise<T>,
    fallback: T,
    what: string,
  ): Promise<T> {
    try {
      return await read();
    } catch (err) {
      logger.warn(`Server setup checklist could not read ${what}.`);
      logger.warn(err);
      return fallback;
    }
  }

  @CaptureSpan()
  public static async readLastBackup(): Promise<
    ServerSetupFacts["lastBackup"]
  > {
    const run: BackupRun | null = await BackupRunService.findOneBy({
      query: {
        kind: BackupRunKind.Backup,
        status: QueryHelper.any([
          BackupRunStatus.Succeeded,
          BackupRunStatus.Failed,
        ]),
      },
      select: {
        status: true,
        finishedAt: true,
        error: true,
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      props: {
        isRoot: true,
      },
    });

    if (!run) {
      return null;
    }

    return {
      succeeded: run.status === BackupRunStatus.Succeeded,
      finishedAt: run.finishedAt
        ? new Date(run.finishedAt).toISOString()
        : null,
      error: run.error || null,
    };
  }

  @CaptureSpan()
  public static async hasAiProvider(): Promise<boolean> {
    const count: PositiveNumber = await LlmProviderService.countBy({
      query: {
        isGlobalLlm: true,
      },
      props: {
        isRoot: true,
      },
    });

    return count.toNumber() > 0;
  }

  @CaptureSpan()
  public static async hasSingleSignOn(): Promise<boolean> {
    const [sso, oidc] = await Promise.all([
      GlobalSsoService.countBy({
        query: {
          isEnabled: true,
        },
        props: {
          isRoot: true,
        },
      }),
      GlobalOidcService.countBy({
        query: {
          isEnabled: true,
        },
        props: {
          isRoot: true,
        },
      }),
    ]);

    return sso.toNumber() + oidc.toNumber() > 0;
  }

  // Every fact, from a settings row read with readConfig.
  @CaptureSpan()
  public static async readFacts(
    config: GlobalConfig | null,
  ): Promise<ServerSetupFacts> {
    const statuses: Array<ServerChannelStatus> =
      ServerSendingStatus.getStatusesFrom(config);

    const statusOf: (channel: ServerSendingChannel) => ServerChannelStatus = (
      channel: ServerSendingChannel,
    ): ServerChannelStatus => {
      return statuses.find((status: ServerChannelStatus): boolean => {
        return status.channel === channel;
      })!;
    };

    const [globalProbes, lastBackup, hasAiProvider, hasSingleSignOn] =
      await Promise.all([
        ServerSetupChecklist.orDefault<ServerGlobalProbesStatus | null>(
          () => {
            return ServerSendingStatus.getGlobalProbesStatus();
          },
          null,
          "the global probes",
        ),
        ServerSetupChecklist.orDefault<ServerSetupFacts["lastBackup"]>(
          () => {
            return ServerSetupChecklist.readLastBackup();
          },
          null,
          "the last backup",
        ),
        ServerSetupChecklist.orDefault<boolean>(
          () => {
            return ServerSetupChecklist.hasAiProvider();
          },
          false,
          "the global LLM providers",
        ),
        ServerSetupChecklist.orDefault<boolean>(
          () => {
            return ServerSetupChecklist.hasSingleSignOn();
          },
          false,
          "single sign-on",
        ),
      ]);

    const callAndSmsSentThrough: string = getCallAndSmsSentThrough(config);

    return {
      isHttpsSetUp: HttpProtocol === Protocol.HTTPS,
      areSignupsClosed: config?.disableSignup === true,
      email: statusOf(ServerSendingChannel.Email),
      sms: statusOf(ServerSendingChannel.SMS),
      call: statusOf(ServerSendingChannel.Call),
      emailSentThrough: getEmailSentThrough(config),
      smsSentThrough: callAndSmsSentThrough,
      callSentThrough: callAndSmsSentThrough,
      globalProbes: globalProbes,
      updateChecks: {
        isDisabled: DisableUpdateCheck,
        lastCheckedAt: config?.latestReleaseCheckedAt
          ? new Date(config.latestReleaseCheckedAt).toISOString()
          : null,
        lastFailure: config?.updateCheckLastFailure || null,
      },
      lastBackup: lastBackup,
      hasScheduledBackups: EnterpriseEdition.isLoaded(),
      isBrowserPushSetUp: Boolean(VapidPublicKey && VapidPrivateKey),
      hasAiProvider: hasAiProvider,
      hasSingleSignOn: hasSingleSignOn,
      choices: ServerSetupChecklistUtil.readChoices(config?.serverSetupChoices),
    };
  }

  // Who made each choice shown, by name: the page says "Chosen by Ada".
  private static async nameChoosers(
    checks: Array<ServerSetupCheckResult>,
  ): Promise<void> {
    const userIds: Array<string> = Array.from(
      new Set(
        checks
          .map((check: ServerSetupCheckResult): string | null => {
            return check.choice?.byUserId || null;
          })
          .filter((id: string | null): id is string => {
            return Boolean(id) && ObjectID.isValidUUID(id!);
          }),
      ),
    );

    if (userIds.length === 0) {
      return;
    }

    const users: Array<User> = await UserService.findBy({
      query: {
        _id: QueryHelper.any(userIds),
      },
      select: {
        _id: true,
        name: true,
      },
      limit: userIds.length,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const check of checks) {
      const user: User | undefined = users.find((candidate: User): boolean => {
        return candidate.id?.toString() === check.choice?.byUserId;
      });

      if (check.choice && user?.name) {
        check.choice.byName = user.name.toString();
      }
    }
  }

  /*
   * The whole checklist, for the admin asking (whose "Hide" it reads), or
   * for nobody in particular (the command line).
   */
  @CaptureSpan()
  public static async getAnswer(data?: {
    readerUserId?: ObjectID | null | undefined;
  }): Promise<ServerSetupChecklistAnswer> {
    const config: GlobalConfig | null = await ServerSetupChecklist.readConfig();
    const facts: ServerSetupFacts =
      await ServerSetupChecklist.readFacts(config);

    const answer: ServerSetupChecklistAnswer =
      ServerSetupChecklistUtil.getAnswer({
        facts: facts,
        readerUserId: data?.readerUserId ? data.readerUserId.toString() : null,
      });

    await ServerSetupChecklist.orDefault<void>(
      () => {
        return ServerSetupChecklist.nameChoosers(answer.checks);
      },
      undefined,
      "who made each choice",
    );

    return answer;
  }

  private static async readChoices(): Promise<ServerSetupChoices> {
    const config: GlobalConfig | null = await GlobalConfigService.findOneById({
      id: ObjectID.getZeroObjectID(),
      select: {
        serverSetupChoices: true,
      },
      props: {
        isRoot: true,
      },
    });

    return ServerSetupChecklistUtil.readChoices(config?.serverSetupChoices);
  }

  /*
   * Makes (or, with null, undoes) an admin's choice for one check: "We will
   * use email and push only", "This server is backed up". Refuses a choice
   * the catalogue does not allow for it.
   */
  @CaptureSpan()
  public static async choose(data: {
    check: ServerSetupCheckId;
    kind: ServerSetupChoiceKind | null;
    byUserId: ObjectID | null;
  }): Promise<void> {
    const next: ServerSetupChoices = ServerSetupChecklistUtil.withChoice({
      choices: await ServerSetupChecklist.readChoices(),
      check: data.check,
      kind: data.kind,
      byUserId: data.byUserId ? data.byUserId.toString() : null,
      now: new Date(),
    });

    await GlobalConfigService.writeServerSetupChoices(
      next as unknown as JSONObject,
    );
  }

  /*
   * Hides the card for one admin, in every browser, until a required check
   * opens that is not open now.
   */
  @CaptureSpan()
  public static async hideFor(userId: ObjectID): Promise<void> {
    const answer: ServerSetupChecklistAnswer =
      await ServerSetupChecklist.getAnswer();

    const next: ServerSetupChoices = ServerSetupChecklistUtil.withHidden({
      choices: await ServerSetupChecklist.readChoices(),
      userId: userId.toString(),
      openRequired: answer.openRequired,
      now: new Date(),
    });

    await GlobalConfigService.writeServerSetupChoices(
      next as unknown as JSONObject,
    );
  }
}
