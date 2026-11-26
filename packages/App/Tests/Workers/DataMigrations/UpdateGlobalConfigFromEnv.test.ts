import GlobalConfig, {
  EmailServerType,
} from "Common/Models/DatabaseModels/GlobalConfig";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import logger from "Common/Server/Utils/Logger";
import ServerChannelSetup, {
  EMAIL_NOT_SET_UP_PROBLEM,
} from "Common/Server/Utils/ServerSending/ServerChannelSetup";
import ServerSendingStatus from "Common/Server/Utils/ServerSending/ServerSendingStatus";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "Common/Tests/Server/TestingUtils/InMemoryRepository";
import HelpAndSupportServerSettings from "Common/Server/Utils/HelpAndSupport/HelpAndSupportServerSettings";
import {
  HelpAndSupportSettings,
  HelpChoice,
  HelpItem,
  getDefaultHelpAndSupportSettings,
} from "Common/Types/HelpAndSupport/HelpAndSupport";
import {
  HELP_AND_SUPPORT_SEED_VARIABLES,
  readSeededItems,
} from "Common/Types/HelpAndSupport/HelpAndSupportSeed";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import {
  ServerChannelStatus,
  ServerSendingChannel,
  ServerSendingState,
} from "Common/Types/ServerSending/ServerSendingStatus";
import UpdateGlobalConfigFromEnv, {
  getSeededSmtpPort,
} from "../../../FeatureSet/Workers/DataMigrations/UpdateGlobalCongfigFromEnv";
import { getGlobalSMTPConfig } from "../../../FeatureSet/Notification/Config";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A NEW SERVER'S EMAIL SETTINGS START EMPTY, WITH NO PORT SEEDED (#7458).
 *
 * UpdateGlobalConfigFromEnv copies the environment variables an
 * installation was first given (SMTP_HOST, SMTP_PORT, ...) into its
 * settings row once, when it is new. It wrote port 25 when SMTP_PORT was
 * not set - and nothing sets it now, not config.example.env, not Docker
 * Compose, not the Helm chart - so every fresh server showed "SMTP Port 25"
 * on Admin Dashboard > Settings > Emails, opened Edit SMTP Config on 25
 * while the field's help said "usually 587", and read as half set up: the
 * port was the one thing filled in, so the Test email card said "SMTP: the
 * From Email is not set under Settings > Emails." as if the rest were done.
 *
 * Pinned here:
 *   1. getSeededSmtpPort: a port only from an SMTP_PORT that is one;
 *   2. what the migration writes: no port unless SMTP_PORT gives one, and
 *      the rest as it was;
 *   3. a fresh server, end to end - the row AddDefaultGlobalConfig makes,
 *      this migration run over it through the real GlobalConfigService (an
 *      in-memory table), then read as the Admin Dashboard and the sender
 *      read it: no port, "Nothing is set up under Settings > Emails yet.",
 *      and the sender has no mail server rather than one missing its From
 *      Email;
 *   4. a server seeded with 25 before this change reads as nothing set up
 *      too (ServerChannelSetup counts a port alone as nothing).
 */

const SMTP_VARIABLES: ReadonlyArray<string> = [
  "SMTP_USERNAME",
  "SMTP_PASSWORD",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_IS_SECURE",
  "SMTP_FROM_EMAIL",
  "SMTP_EMAIL",
  "SMTP_FROM_NAME",
  "SENDGRID_API_KEY",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
  "DISABLE_SIGNUP",
  // Help and Support from the configuration (#10938), cleared like the rest.
  ...Object.values(HELP_AND_SUPPORT_SEED_VARIABLES),
];

const SETTINGS_ID: string = ObjectID.getZeroObjectID().toString();

// The row AddDefaultGlobalConfig creates, before this migration runs.
function defaultRow(overrides: StoredRow = {}): StoredRow {
  return {
    _id: SETTINGS_ID,
    instanceId: "7458a000-0000-4000-8000-000000000001",
    emailServerType: EmailServerType.CustomSMTP,
    sendgridFromName: "OneUptime",
    smtpFromName: "OneUptime",
    ...overrides,
  };
}

let savedEnvironment: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnvironment = {};

  for (const name of SMTP_VARIABLES) {
    savedEnvironment[name] = process.env[name];
    delete process.env[name];
  }

  ServerSendingStatus.clearCache();

  for (const level of ["debug", "info", "warn", "error"] as const) {
    jest.spyOn(logger, level).mockImplementation((): void => {});
  }
});

afterEach(() => {
  for (const name of SMTP_VARIABLES) {
    if (savedEnvironment[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = savedEnvironment[name];
    }
  }

  jest.restoreAllMocks();
});

describe("getSeededSmtpPort: a port only from an SMTP_PORT that is one", () => {
  test.each([
    ["not set", undefined],
    ["empty", ""],
    ["blank", "   "],
    ["a word", "smtp"],
    ["a number with letters after it", "587abc"],
    ["a fraction", "587.5"],
    ["a negative number", "-25"],
    ["zero", "0"],
    ["past the last port", "65536"],
  ])("%s: no port", (_name: string, value: string | undefined) => {
    expect(getSeededSmtpPort(value)).toBeNull();
  });

  test.each([
    ["25", 25],
    ["587", 587],
    ["465", 465],
    [" 2525 ", 2525],
    ["1", 1],
    ["65535", 65535],
  ])("%p: port %p", (value: string, expected: number) => {
    const port: Port | null = getSeededSmtpPort(value);

    expect(port).toBeInstanceOf(Port);
    expect(port?.toNumber()).toBe(expected);
  });
});

describe("what the migration writes", () => {
  type UpdateCall = {
    id: ObjectID;
    data: Record<string, unknown>;
    props: Record<string, unknown>;
  };

  function spyOnUpdate(): () => UpdateCall {
    const update: SpyInstance<typeof GlobalConfigService.updateOneById> = jest
      .spyOn(GlobalConfigService, "updateOneById")
      .mockResolvedValue(undefined as never);

    return (): UpdateCall => {
      expect(update).toHaveBeenCalledTimes(1);
      return update.mock.calls[0]![0] as unknown as UpdateCall;
    };
  }

  test("no SMTP_PORT: no port is written (it wrote 25)", async () => {
    const written: () => UpdateCall = spyOnUpdate();

    await new UpdateGlobalConfigFromEnv().migrate();

    const call: UpdateCall = written();

    expect(call.id.toString()).toBe(SETTINGS_ID);
    expect(call.props).toEqual({ isRoot: true });
    expect(Object.keys(call.data)).not.toContain("smtpPort");
  });

  test("no SMTP_HOST: no host is written (it wrote a Hostname of nothing)", async () => {
    const written: () => UpdateCall = spyOnUpdate();

    await new UpdateGlobalConfigFromEnv().migrate();

    expect(Object.keys(written().data)).not.toContain("smtpHost");
  });

  test("an SMTP_HOST of spaces: no host either", async () => {
    process.env["SMTP_HOST"] = "   ";
    const written: () => UpdateCall = spyOnUpdate();

    await new UpdateGlobalConfigFromEnv().migrate();

    expect(Object.keys(written().data)).not.toContain("smtpHost");
  });

  test("an SMTP_HOST with a port: the host, as Hostname.fromString reads it", async () => {
    process.env["SMTP_HOST"] = "smtp.example.com:2525";
    const written: () => UpdateCall = spyOnUpdate();

    await new UpdateGlobalConfigFromEnv().migrate();

    expect(String(written().data["smtpHost"])).toBe("smtp.example.com:2525");
  });

  test("an SMTP_PORT left empty in an old config.env: no port either", async () => {
    process.env["SMTP_PORT"] = "";
    const written: () => UpdateCall = spyOnUpdate();

    await new UpdateGlobalConfigFromEnv().migrate();

    expect(Object.keys(written().data)).not.toContain("smtpPort");
  });

  test("an SMTP_PORT that is not a port: no port, and the migration still runs", async () => {
    process.env["SMTP_PORT"] = "smtp";
    const written: () => UpdateCall = spyOnUpdate();

    await new UpdateGlobalConfigFromEnv().migrate();

    expect(Object.keys(written().data)).not.toContain("smtpPort");
  });

  test("an SMTP_PORT given: that port", async () => {
    process.env["SMTP_PORT"] = "2525";
    const written: () => UpdateCall = spyOnUpdate();

    await new UpdateGlobalConfigFromEnv().migrate();

    const port: unknown = written().data["smtpPort"];

    expect(port).toBeInstanceOf(Port);
    expect((port as Port).toNumber()).toBe(2525);
  });

  test("an SMTP_PORT of 25 is still 25: a server told 25 keeps it", async () => {
    process.env["SMTP_PORT"] = "25";
    const written: () => UpdateCall = spyOnUpdate();

    await new UpdateGlobalConfigFromEnv().migrate();

    expect((written().data["smtpPort"] as Port).toNumber()).toBe(25);
  });

  test("the rest is written as it was", async () => {
    process.env["SMTP_HOST"] = "smtp.example.com";
    process.env["SMTP_USERNAME"] = "mailer";
    process.env["SMTP_PASSWORD"] = "secret";
    process.env["SMTP_IS_SECURE"] = "true";
    process.env["SMTP_EMAIL"] = "alerts@example.com";
    process.env["SMTP_FROM_NAME"] = "Example Alerts";
    process.env["DISABLE_SIGNUP"] = "true";
    const written: () => UpdateCall = spyOnUpdate();

    await new UpdateGlobalConfigFromEnv().migrate();

    const data: Record<string, unknown> = written().data;

    expect(String(data["smtpHost"])).toBe("smtp.example.com");
    expect(data["smtpUsername"]).toBe("mailer");
    expect(data["smtpPassword"]).toBe("secret");
    expect(data["isSMTPSecure"]).toBe(true);
    expect(data["smtpFromEmail"]).toBe("alerts@example.com");
    expect(data["smtpFromName"]).toBe("Example Alerts");
    expect(data["disableSignup"]).toBe(true);
    expect(data["emailServerType"]).toBe(EmailServerType.CustomSMTP);
    expect(data["sendgridApiKey"]).toBe("");
  });

  test("SENDGRID_API_KEY picks SendGrid, as before", async () => {
    process.env["SENDGRID_API_KEY"] = "SG.key";
    const written: () => UpdateCall = spyOnUpdate();

    await new UpdateGlobalConfigFromEnv().migrate();

    expect(written().data["emailServerType"]).toBe(EmailServerType.Sendgrid);
    expect(written().data["sendgridApiKey"]).toBe("SG.key");
  });

  test("SMTP_FROM_EMAIL wins over the older SMTP_EMAIL", async () => {
    process.env["SMTP_FROM_EMAIL"] = "from@example.com";
    process.env["SMTP_EMAIL"] = "older@example.com";
    const written: () => UpdateCall = spyOnUpdate();

    await new UpdateGlobalConfigFromEnv().migrate();

    expect(written().data["smtpFromEmail"]).toBe("from@example.com");
  });
});

describe("a fresh server, end to end", () => {
  async function readSettings(): Promise<GlobalConfig | null> {
    return await ServerSendingStatus.readConfig();
  }

  async function emailStatus(): Promise<ServerChannelStatus> {
    return await ServerSendingStatus.getStatus(ServerSendingChannel.Email);
  }

  test("no port is stored, and nothing is set up under Settings > Emails yet", async () => {
    const table: InMemoryTable = useInMemoryTable(GlobalConfigService, [
      defaultRow(),
    ]);

    await new UpdateGlobalConfigFromEnv().migrate();

    const stored: StoredRow = table.get(SETTINGS_ID)!;

    // The card's SMTP Port reads None, and Edit SMTP Config starts on 587.
    expect(stored["smtpPort"] ?? null).toBeNull();
    expect(stored["smtpHost"] ?? null).toBeNull();

    const settings: GlobalConfig | null = await readSettings();

    expect(settings).not.toBeNull();
    expect(settings?.smtpPort ?? null).toBeNull();

    // Not "SMTP: the From Email is not set under Settings > Emails."
    expect(ServerChannelSetup.getEmailSetUpProblem(settings)).toBe(
      EMAIL_NOT_SET_UP_PROBLEM,
    );

    const status: ServerChannelStatus = await emailStatus();

    expect(status.state).toBe(ServerSendingState.NotSetUp);
    expect(status.setUpProblem).toBe(EMAIL_NOT_SET_UP_PROBLEM);

    // The sender has no mail server, rather than one missing its From Email.
    await expect(getGlobalSMTPConfig()).resolves.toBeNull();
  });

  test("a server seeded with port 25 before reads as nothing set up too", async () => {
    useInMemoryTable(GlobalConfigService, [
      defaultRow({
        smtpPort: new Port(25),
        smtpHost: null,
        smtpUsername: "",
        smtpPassword: "",
        smtpFromEmail: "",
        smtpFromName: "",
        isSMTPSecure: false,
      }),
    ]);

    const settings: GlobalConfig | null = await readSettings();

    expect(settings?.smtpPort?.toNumber()).toBe(25);
    expect(ServerChannelSetup.getEmailSetUpProblem(settings)).toBe(
      EMAIL_NOT_SET_UP_PROBLEM,
    );
    expect((await emailStatus()).state).toBe(ServerSendingState.NotSetUp);
    await expect(getGlobalSMTPConfig()).resolves.toBeNull();
  });

  test("a server given its whole mail server by the old variables is set up, its port kept", async () => {
    process.env["SMTP_HOST"] = "smtp.example.com";
    process.env["SMTP_PORT"] = "587";
    process.env["SMTP_FROM_EMAIL"] = "alerts@example.com";
    process.env["SMTP_FROM_NAME"] = "Example Alerts";

    const table: InMemoryTable = useInMemoryTable(GlobalConfigService, [
      defaultRow(),
    ]);

    await new UpdateGlobalConfigFromEnv().migrate();

    expect((table.get(SETTINGS_ID)!["smtpPort"] as Port).toNumber()).toBe(587);

    const settings: GlobalConfig | null = await readSettings();

    expect(settings?.smtpPort?.toNumber()).toBe(587);
    expect(ServerChannelSetup.getEmailSetUpProblem(settings)).toBeNull();
    expect((await emailStatus()).state).toBe(ServerSendingState.Untested);
  });

  test("a host given without SMTP_PORT names the Port as what is missing", async () => {
    process.env["SMTP_HOST"] = "smtp.example.com";
    process.env["SMTP_FROM_EMAIL"] = "alerts@example.com";
    process.env["SMTP_FROM_NAME"] = "Example Alerts";

    useInMemoryTable(GlobalConfigService, [defaultRow()]);

    await new UpdateGlobalConfigFromEnv().migrate();

    expect(ServerChannelSetup.getEmailSetUpProblem(await readSettings())).toBe(
      "SMTP: the Port is not set under Settings > Emails.",
    );
  });
});

/*
 * A NEW SERVER'S HELP AND SUPPORT, FROM ITS CONFIGURATION (#10938).
 *
 * The first start of a new server may run the startup migration that seeds
 * Admin Dashboard > Settings > Help and Support before AddDefaultGlobalConfig
 * makes the settings row; so this migration, which runs right after it,
 * seeds it too. End to end: the row AddDefaultGlobalConfig makes, this
 * migration run over it through the real GlobalConfigService, the write held
 * to nothing being saved as the statement holds it, and the settings read
 * back as every page reads them.
 */
describe("a fresh server's Help and Support, from its configuration", () => {
  // The statement compareAndSetColumnsByIdWithoutHooks sends, on the table.
  function answerConditionalWrites(table: InMemoryTable): void {
    jest
      .spyOn(GlobalConfigService, "compareAndSetColumnsByIdWithoutHooks")
      .mockImplementation(
        async (input: {
          id: ObjectID;
          data: unknown;
          expectedData: unknown;
        }): Promise<boolean> => {
          const row: StoredRow | undefined = table.get(input.id);

          if (!row) {
            return false;
          }

          for (const [column, expected] of Object.entries(
            input.expectedData as Record<string, unknown>,
          )) {
            if (
              JSON.stringify(row[column] ?? null) !== JSON.stringify(expected)
            ) {
              return false;
            }
          }

          Object.assign(row, input.data as StoredRow);
          return true;
        },
      );
  }

  async function readHelpAndSupport(): Promise<HelpAndSupportSettings> {
    HelpAndSupportServerSettings.forget();
    return await HelpAndSupportServerSettings.getSettings();
  }

  afterEach(() => {
    HelpAndSupportServerSettings.forget();
  });

  test("nothing configured: nothing written, every setting OneUptime's default as today", async () => {
    const table: InMemoryTable = useInMemoryTable(GlobalConfigService, [
      defaultRow(),
    ]);
    answerConditionalWrites(table);

    await new UpdateGlobalConfigFromEnv().migrate();

    expect(table.get(SETTINGS_ID)!["helpAndSupport"] ?? null).toBeNull();
    expect(await readHelpAndSupport()).toEqual(
      getDefaultHelpAndSupportSettings(),
    );
  });

  test("configured: seeded as soon as the row is made, and read as every page reads it", async () => {
    process.env["HELP_AND_SUPPORT_SUPPORT_EMAIL"] = "it-help@acme.example";
    process.env["HELP_AND_SUPPORT_CHAT"] =
      "https://acme.slack.com/archives/C024BE91L";
    process.env["HELP_AND_SUPPORT_GITHUB"] = "false";

    const table: InMemoryTable = useInMemoryTable(GlobalConfigService, [
      defaultRow(),
    ]);
    answerConditionalWrites(table);

    await new UpdateGlobalConfigFromEnv().migrate();

    const settings: HelpAndSupportSettings = await readHelpAndSupport();

    expect(settings[HelpItem.SupportEmail]).toEqual({
      choice: HelpChoice.Email,
      value: "it-help@acme.example",
    });
    expect(settings[HelpItem.Chat]).toEqual({
      choice: HelpChoice.Link,
      value: "https://acme.slack.com/archives/C024BE91L",
    });
    expect(settings[HelpItem.GitHub]).toEqual({
      choice: HelpChoice.Hidden,
      value: null,
    });
    expect(settings[HelpItem.RequestDemo].choice).toBe(HelpChoice.Default);
    expect(readSeededItems(table.get(SETTINGS_ID)!["helpAndSupport"])).toEqual([
      HelpItem.SupportEmail,
      HelpItem.Chat,
      HelpItem.GitHub,
    ]);
  });

  test("an unsafe link is left out and said, and the rest still seeded", async () => {
    process.env["HELP_AND_SUPPORT_HELP_LINK"] = "javascript:alert(1)";
    process.env["HELP_AND_SUPPORT_SUPPORT_EMAIL"] = "it-help@acme.example";

    const table: InMemoryTable = useInMemoryTable(GlobalConfigService, [
      defaultRow(),
    ]);
    answerConditionalWrites(table);

    await new UpdateGlobalConfigFromEnv().migrate();

    const settings: HelpAndSupportSettings = await readHelpAndSupport();

    expect(settings[HelpItem.HelpLink].choice).toBe(HelpChoice.Default);
    expect(settings[HelpItem.SupportEmail].value).toBe("it-help@acme.example");
    expect(
      JSON.stringify(table.get(SETTINGS_ID)!["helpAndSupport"]),
    ).not.toContain("javascript");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("HELP_AND_SUPPORT_HELP_LINK"),
    );
  });

  test("an install whose page was saved before keeps what was saved", async () => {
    process.env["HELP_AND_SUPPORT_SUPPORT_EMAIL"] = "it-help@acme.example";

    const table: InMemoryTable = useInMemoryTable(GlobalConfigService, [
      defaultRow({ helpAndSupport: { chat: { choice: "hidden" } } }),
    ]);
    answerConditionalWrites(table);

    await new UpdateGlobalConfigFromEnv().migrate();

    expect(table.get(SETTINGS_ID)!["helpAndSupport"]).toEqual({
      chat: { choice: "hidden" },
    });
  });
});
