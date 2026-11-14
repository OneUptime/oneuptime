import GlobalConfig, {
  EmailServerType,
} from "Common/Models/DatabaseModels/GlobalConfig";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import { LICENSE_RESPONSE_CONFIG_SELECT } from "Common/Server/API/GlobalConfigAPI";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import Encryption from "Common/Server/Utils/Encryption";
import logger from "Common/Server/Utils/Logger";
import ServerSendingSettings from "Common/Server/Utils/ServerSending/ServerSendingSettings";
import ServerSendingStatus from "Common/Server/Utils/ServerSending/ServerSendingStatus";
import ServerSetupChecklist, {
  getCallAndSmsSentThrough,
  getEmailSentThrough,
} from "Common/Server/Utils/ServerSetup/ServerSetupChecklist";
import TelegramUpdatePolling from "Common/Server/Utils/TelegramUpdatePolling";
import TelegramVerificationToken from "Common/Server/Utils/TelegramVerificationToken";
import { CallAndSmsProvider } from "Common/Types/CallAndSMS/CallAndSmsProvider";
import SMTPAuthenticationType from "Common/Types/Email/SMTPAuthenticationType";
import ObjectID from "Common/Types/ObjectID";
import ServerSendingStatusUtil, {
  ServerChannelStatus,
  ServerSendingChannel,
  ServerSendingHealth,
  ServerSendingHealthEntry,
  ServerSendingSettingsFingerprints,
  ServerSendingState,
} from "Common/Types/ServerSending/ServerSendingStatus";
import { JSONObject } from "Common/Types/JSON";
import {
  getCallAndSmsGateway,
  getEmailServerType,
  getGlobalSMTPConfig,
  getMetaWhatsAppConfig,
  getSendgridConfig,
  getTelegramConfig,
  getTwilioConfig,
} from "../../../FeatureSet/Notification/Config";
import { SqlRow } from "./Fixtures/GlobalConfigCredentialsSql";
import {
  CREDENTIALS_AS_WRITTEN,
  GATEWAY_URL,
  migrateServerSettings,
  ServerSettings,
  serverSettingsAsWritten,
  TWILIO_ACCOUNT_SID,
  useServerSettings,
} from "./Fixtures/ServerSettingsAsWritten";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * EVERY READER READS THE SERVER'S CREDENTIALS AS BEFORE, ONCE THE DATA
 * MIGRATION HAS ENCRYPTED THEM (#7739).
 *
 * The server's settings row is seeded as it was stored before its
 * credential columns were encrypted - every credential as written - and
 * read through the real service (GlobalConfigService over an in-memory
 * table, decrypting as it does over Postgres) by every reader of them: the
 * Notification service's settings for each sender, the Telegram webhook's
 * secret and update polling, what the Admin Dashboard and the license
 * dialog read, the setup checklist, the public vars, and the fingerprints
 * of the settings the server's sends were learned with. Then the real
 * EncryptGlobalConfigCredentials runs over the same row, and every reader
 * reads it again: the same, value for value.
 *
 * The fingerprints matter most: what the server remembers of its sends is
 * marked with them, and one that changed would read every channel as
 * untested after the upgrade. Here every channel was working before, and
 * still is.
 */

const NOW: Date = new Date();

// The fixture's, not the migration's own list: a column it leaves off is caught.
const CREDENTIAL_COLUMNS: Array<string> = Object.keys(CREDENTIALS_AS_WRITTEN);

const FINGERPRINTED_CHANNELS: Array<ServerSendingChannel> = [
  ServerSendingChannel.Email,
  ServerSendingChannel.SMS,
  ServerSendingChannel.Call,
];

const VARIANTS: Array<[string, SqlRow]> = [
  ["Custom SMTP with a password, SMS and calls through Twilio", {}],
  [
    "Custom SMTP signed in with OAuth, SMS and calls through the gateway",
    {
      smtpAuthType: SMTPAuthenticationType.OAuth,
      callAndSmsProvider: CallAndSmsProvider.Gateway,
    },
  ],
  [
    "SendGrid, SMS and calls through Twilio",
    { emailServerType: EmailServerType.Sendgrid },
  ],
];

function selectAll(columns: Array<string>): Record<string, true> {
  const select: Record<string, true> = {};

  for (const column of columns) {
    select[column] = true;
  }

  return select;
}

// The credentials as a read through the service returns them.
async function readCredentials(
  props: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const config: GlobalConfig | null = await GlobalConfigService.findOneById({
    id: ObjectID.getZeroObjectID(),
    select: selectAll(CREDENTIAL_COLUMNS) as never,
    props: props as never,
  });

  const read: Record<string, unknown> = {};

  for (const column of CREDENTIAL_COLUMNS) {
    read[column] = (config as unknown as Record<string, unknown>)[column];
  }

  return read;
}

async function fingerprints(): Promise<
  Record<string, ServerSendingSettingsFingerprints | null>
> {
  const config: GlobalConfig | null = await ServerSendingStatus.readConfig();
  const read: Record<string, ServerSendingSettingsFingerprints | null> = {};

  for (const channel of FINGERPRINTED_CHANNELS) {
    read[channel] = ServerSendingSettings.getFingerprints(channel, config);
  }

  return read;
}

async function orRefusal<T>(read: () => Promise<T>): Promise<T | string> {
  try {
    return await read();
  } catch (err) {
    return `refused: ${(err as Error).message}`;
  }
}

// Everything every reader reads of the row.
async function readEverything(): Promise<Record<string, unknown>> {
  const checklistConfig: GlobalConfig | null =
    await ServerSetupChecklist.readConfig();
  const license: GlobalConfig | null = await GlobalConfigService.findOneById({
    id: ObjectID.getZeroObjectID(),
    select: LICENSE_RESPONSE_CONFIG_SELECT,
    props: { isRoot: true },
  });

  return {
    asOneUptime: await readCredentials({ isRoot: true }),
    asMasterAdmin: await readCredentials({
      isMasterAdmin: true,
      userId: new ObjectID("7739a000-0000-4000-8000-000000000001"),
    }),
    emailServerType: await getEmailServerType(),
    smtp: await orRefusal(getGlobalSMTPConfig),
    sendgrid: await getSendgridConfig(),
    twilio: await getTwilioConfig(),
    gateway: await getCallAndSmsGateway(),
    whatsApp: await getMetaWhatsAppConfig(),
    telegram: await getTelegramConfig(),
    telegramWebhookSecret:
      await GlobalConfigService.getTelegramWebhookSecretToken(),
    telegramPollingBotToken: await TelegramUpdatePolling.getPollingBotToken(),
    license: {
      key: license?.enterpriseLicenseKey,
      token: license?.enterpriseLicenseToken,
    },
    fingerprints: await fingerprints(),
    statuses: await ServerSendingStatus.getStatuses(),
    checklist: {
      statuses: ServerSendingStatus.getStatusesFrom(checklistConfig),
      emailSentThrough: getEmailSentThrough(checklistConfig),
      callAndSmsSentThrough: getCallAndSmsSentThrough(checklistConfig),
    },
    canSendEmailPublicly: await ServerSendingStatus.canSendEmailPublicly(),
  };
}

// What the server remembers: every channel worked, with the settings it sends with now.
async function rememberEveryChannelWorking(
  settings: ServerSettings,
): Promise<void> {
  const current: Record<string, ServerSendingSettingsFingerprints | null> =
    await fingerprints();
  const health: ServerSendingHealth = {};
  const empty: ServerSendingHealthEntry = {
    lastSucceededAt: null,
    lastFailedAt: null,
    failingSince: null,
    lastFailure: null,
  };

  for (const channel of FINGERPRINTED_CHANNELS) {
    health[channel] = ServerSendingStatusUtil.withSettingsFingerprint(
      ServerSendingStatusUtil.withSucceeded(empty, NOW),
      current[channel] || null,
    );
  }

  settings.table.rows[0]!["serverSendingHealth"] =
    health as unknown as JSONObject;
}

function stateOf(
  statuses: Array<ServerChannelStatus>,
  channel: ServerSendingChannel,
): ServerSendingState | undefined {
  return statuses.find((status: ServerChannelStatus): boolean => {
    return status.channel === channel;
  })?.state;
}

describe("EncryptGlobalConfigCredentials: every reader reads as before", () => {
  beforeEach(() => {
    ServerSendingStatus.clearCache();

    for (const level of ["debug", "info", "warn", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation((): void => {});
    }

    // The Telegram webhook's secret, read from the row every time.
    jest.spyOn(GlobalCache, "getString").mockResolvedValue(null as never);
    jest.spyOn(GlobalCache, "setString").mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each(VARIANTS)(
    "%s: every read the same, value for value",
    async (_name: string, overrides: SqlRow) => {
      const settings: ServerSettings = useServerSettings(
        serverSettingsAsWritten(overrides),
      );

      await rememberEveryChannelWorking(settings);

      const before: Record<string, unknown> = await readEverything();

      await migrateServerSettings(settings);

      // Stored encrypted now: every credential column.
      for (const column of CREDENTIAL_COLUMNS) {
        const stored: unknown = settings.table.rows[0]![column];

        expect([column, Encryption.looksEncrypted(String(stored))]).toEqual([
          column,
          true,
        ]);
      }

      const after: Record<string, unknown> = await readEverything();

      expect(after).toEqual(before);

      // And what they read is what was written.
      expect(after["asOneUptime"]).toEqual(CREDENTIALS_AS_WRITTEN);
      expect(after["asMasterAdmin"]).toEqual(CREDENTIALS_AS_WRITTEN);
    },
  );

  test("the fingerprints the server's sends were learned with are the same: every channel still working", async () => {
    for (const [, overrides] of VARIANTS) {
      jest.restoreAllMocks();
      jest.spyOn(GlobalCache, "getString").mockResolvedValue(null as never);
      jest
        .spyOn(GlobalCache, "setString")
        .mockResolvedValue(undefined as never);

      const settings: ServerSettings = useServerSettings(
        serverSettingsAsWritten(overrides),
      );

      await rememberEveryChannelWorking(settings);

      const before: Record<string, ServerSendingSettingsFingerprints | null> =
        await fingerprints();

      await migrateServerSettings(settings);

      expect(await fingerprints()).toEqual(before);

      const statuses: Array<ServerChannelStatus> =
        await ServerSendingStatus.getStatuses();

      for (const channel of FINGERPRINTED_CHANNELS) {
        expect([channel, stateOf(statuses, channel)]).toEqual([
          channel,
          ServerSendingState.Working,
        ]);
      }
    }
  });

  test("each sender's settings carry the credentials as written", async () => {
    const settings: ServerSettings = useServerSettings(
      serverSettingsAsWritten(),
    );

    await migrateServerSettings(settings);

    const w: Readonly<Record<string, string>> = CREDENTIALS_AS_WRITTEN;

    expect(await getGlobalSMTPConfig()).toMatchObject({
      password: w["smtpPassword"],
      clientSecret: w["smtpClientSecret"],
    });
    expect((await getSendgridConfig())?.apiKey).toBe(w["sendgridApiKey"]);
    expect(await getTwilioConfig()).toMatchObject({
      accountSid: TWILIO_ACCOUNT_SID,
      authToken: w["twilioAuthToken"],
    });
    expect(await getMetaWhatsAppConfig()).toMatchObject({
      accessToken: w["metaWhatsAppAccessToken"],
      appSecret: w["metaWhatsAppAppSecret"],
    });
    expect((await getTelegramConfig()).botToken).toBe(w["telegramBotToken"]);
    expect(await TelegramUpdatePolling.getPollingBotToken()).toBe(
      w["telegramBotToken"],
    );

    // The Telegram webhook takes the secret as written, and nothing else.
    const configuredSecret: string | undefined =
      await GlobalConfigService.getTelegramWebhookSecretToken();

    expect(configuredSecret).toBe(w["telegramWebhookSecretToken"]);
    expect(
      TelegramVerificationToken.isWebhookSecretStrong(configuredSecret),
    ).toBe(true);
    expect(
      TelegramVerificationToken.isWebhookSecretValid({
        configuredSecret: configuredSecret,
        providedSecret: w["telegramWebhookSecretToken"],
      }),
    ).toBe(true);
    expect(
      TelegramVerificationToken.isWebhookSecretValid({
        configuredSecret: configuredSecret,
        providedSecret: String(
          settings.table.rows[0]!["telegramWebhookSecretToken"],
        ),
      }),
    ).toBe(false);

    // Through the gateway: its address and secret as written.
    settings.table.rows[0]!["callAndSmsProvider"] = CallAndSmsProvider.Gateway;

    expect(await getCallAndSmsGateway()).toEqual({
      url: GATEWAY_URL,
      secret: w["callAndSmsGatewaySecret"],
    });
  });

  test("a value saved after the migration is stored encrypted and reads as saved, as the newer keys always did", async () => {
    const settings: ServerSettings = useServerSettings(
      serverSettingsAsWritten(),
    );

    await migrateServerSettings(settings);

    await GlobalConfigService.updateOneById({
      id: ObjectID.getZeroObjectID(),
      data: {
        sendgridApiKey: "SG.saved-after.the-upgrade",
        metaWhatsAppAccessToken: "EAAG-saved-after-the-upgrade",
      },
      props: { isRoot: true },
    });

    const stored: SqlRow = settings.table.rows[0]!;

    expect(Encryption.looksEncrypted(String(stored["sendgridApiKey"]))).toBe(
      true,
    );
    expect(
      Encryption.looksEncrypted(String(stored["metaWhatsAppAccessToken"])),
    ).toBe(true);
    expect((await getSendgridConfig())?.apiKey).toBe(
      "SG.saved-after.the-upgrade",
    );
    expect((await getMetaWhatsAppConfig()).accessToken).toBe(
      "EAAG-saved-after-the-upgrade",
    );

    // A second run leaves the row as it is.
    const afterSave: SqlRow = { ...stored };

    await migrateServerSettings(settings);

    expect(settings.sql.writes).toHaveLength(CREDENTIAL_COLUMNS.length);
    expect(settings.table.rows[0]).toEqual(afterSave);
  });
});
