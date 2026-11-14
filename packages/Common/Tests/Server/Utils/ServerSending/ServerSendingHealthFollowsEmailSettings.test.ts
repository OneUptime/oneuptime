import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * EMAIL STARTS AGAIN AT UNTESTED WHEN ITS SETTINGS CHANGE WITHOUT A SAVE
 * (#7803).
 *
 * Once GLOBAL_EMAIL_SERVER_TYPE is set, the server's email settings are the
 * ones the GLOBAL_EMAIL_ environment variables describe (#7738), and they
 * change when the variables do and OneUptime restarts - with no save in the
 * Admin Dashboard to forget what the server remembered of the settings
 * before. So an operator who fixed a wrong SMTP password in their Helm
 * values went on seeing "Email failing since..." - and the sign-in pages
 * offered no email, canSendEmail being false - until an email happened to
 * go out, and settings nobody had tried showed as working.
 *
 * ServerSendingStatus reads an email entry learned with other settings as
 * nothing remembered, and the next send writes its news marked with the
 * settings it went out with. The row is stood in for, as in
 * ServerSendingHealthFollowsTwilioAccount.test.ts - and read with only the
 * columns the reader selects, as the database reads it - and every write is
 * caught. A restart is this server forgetting what it read (clearCache).
 */

let storedConfig: Record<string, unknown> | null = null;
const findOneById: Mock = jest.fn();
const writeServerSendingHealth: Mock = jest.fn();

jest.mock("../../../../Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: Array<unknown>): unknown => {
        return findOneById(...args);
      },
      writeServerSendingHealth: (...args: Array<unknown>): unknown => {
        return writeServerSendingHealth(...args);
      },
      forgetServerSendingHealthOf: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/ProbeService", () => {
  return {
    __esModule: true,
    default: {
      countBy: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import ServerSendingStatus from "../../../../Server/Utils/ServerSending/ServerSendingStatus";
import ServerSendingSettings from "../../../../Server/Utils/ServerSending/ServerSendingSettings";
import GlobalConfig, {
  EmailServerType,
} from "../../../../Models/DatabaseModels/GlobalConfig";
import Hostname from "../../../../Types/API/Hostname";
import { SERVER_TWILIO_ENVIRONMENT_VARIABLES } from "../../../../Types/CallAndSMS/ServerTwilioEnvironment";
import Email from "../../../../Types/Email";
import {
  SERVER_EMAIL_COLUMNS,
  SERVER_EMAIL_ENVIRONMENT_VARIABLES,
  ServerEmailEnvironmentVariable,
} from "../../../../Types/Email/ServerEmailEnvironment";
import Phone from "../../../../Types/Phone";
import Port from "../../../../Types/Port";
import ServerSendingStatusUtil, {
  ServerChannelStatus,
  ServerSendingChannel,
  ServerSendingHealth,
  ServerSendingHealthEntry,
  ServerSendingSettingsFingerprints,
  ServerSendingState,
} from "../../../../Types/ServerSending/ServerSendingStatus";

const V: typeof ServerEmailEnvironmentVariable = ServerEmailEnvironmentVariable;

// The email settings an admin saved in the Admin Dashboard: a mail server.
const SAVED_EMAIL: Record<string, unknown> = {
  emailServerType: EmailServerType.CustomSMTP,
  smtpHost: new Hostname("smtp.saved.example.com"),
  smtpPort: new Port(587),
  isSMTPSecure: true,
  smtpUsername: "saved-user",
  smtpPassword: "saved-smtp-password-sentinel",
  smtpFromEmail: new Email("alerts@saved.example.com"),
  smtpFromName: "Saved Alerts",
};

// The variables that repeat the saved settings, each of them.
const SAVED_EMAIL_AS_VARIABLES: Partial<
  Record<ServerEmailEnvironmentVariable, string>
> = {
  [V.ServerType]: "custom-smtp",
  [V.SmtpHost]: "smtp.saved.example.com",
  [V.SmtpPort]: "587",
  [V.SmtpRequireTls]: "true",
  [V.SmtpUsername]: "saved-user",
  [V.SmtpPassword]: "saved-smtp-password-sentinel",
  [V.FromEmail]: "alerts@saved.example.com",
  [V.FromName]: "Saved Alerts",
};

// A mail server of the variables' own, that sends.
const ENVIRONMENT_EMAIL: Partial<
  Record<ServerEmailEnvironmentVariable, string>
> = {
  [V.ServerType]: "custom-smtp",
  [V.SmtpHost]: "smtp.example.com",
  [V.SmtpPort]: "587",
  [V.SmtpRequireTls]: "true",
  [V.SmtpUsername]: "alerts",
  [V.SmtpPassword]: "environment-smtp-password-sentinel",
  [V.FromEmail]: "alerts@example.com",
  [V.FromName]: "OneUptime Alerts",
};

const SAVED_ACCOUNT: Record<string, unknown> = {
  twilioAccountSID: "AC11111111111111111111111111111111",
  twilioAuthToken: "saved-auth-token-sentinel-1111",
  twilioPrimaryPhoneNumber: new Phone("+15550001111"),
};

const RECENTLY: string = new Date(Date.now() - 5 * 60 * 1000).toISOString();
const YESTERDAY: string = new Date(
  Date.now() - 24 * 60 * 60 * 1000,
).toISOString();

const AUTHENTICATION_FAILED: string = "535 5.7.8 Authentication failed";

// What the server remembered before there were fingerprints: entries learned with the saved settings.
const FAILING: ServerSendingHealthEntry = {
  lastSucceededAt: YESTERDAY,
  lastFailedAt: RECENTLY,
  failingSince: RECENTLY,
  lastFailure: AUTHENTICATION_FAILED,
};

const WORKING: ServerSendingHealthEntry = {
  lastSucceededAt: RECENTLY,
  lastFailedAt: null,
  failingSince: null,
  lastFailure: null,
};

function row(
  settings: Record<string, unknown>,
  health?: ServerSendingHealth,
): Record<string, unknown> {
  return {
    ...SAVED_EMAIL,
    ...SAVED_ACCOUNT,
    ...settings,
    serverSendingHealth: health,
  };
}

// The row as a reader that selects these columns gets it: nothing else.
function readWith(select: Record<string, unknown>): Record<string, unknown> {
  const read: Record<string, unknown> = {};

  for (const column of Object.keys(select)) {
    if (select[column] === true && storedConfig && column in storedConfig) {
      read[column] = storedConfig[column];
    }
  }

  return read;
}

function storedHealth(): ServerSendingHealth {
  return ServerSendingStatusUtil.readHealth(
    storedConfig?.["serverSendingHealth"],
  );
}

async function statusOf(
  channel: ServerSendingChannel,
): Promise<ServerChannelStatus> {
  return await ServerSendingStatus.getStatus(channel);
}

async function stateOf(
  channel: ServerSendingChannel,
): Promise<ServerSendingState> {
  return (await statusOf(channel)).state;
}

async function emailFingerprints(): Promise<ServerSendingSettingsFingerprints> {
  return ServerSendingSettings.getFingerprints(
    ServerSendingChannel.Email,
    await ServerSendingStatus.readConfig(),
  )!;
}

async function recordEmail(failure?: string): Promise<void> {
  await ServerSendingStatus.recordOutcome(
    failure === undefined
      ? { channel: ServerSendingChannel.Email, succeeded: true }
      : {
          channel: ServerSendingChannel.Email,
          succeeded: false,
          reason: failure,
        },
  );
}

const before: Record<string, string | undefined> = {};

function setEnvironment(
  values: Partial<Record<ServerEmailEnvironmentVariable, string>>,
): void {
  for (const [variable, value] of Object.entries(values)) {
    process.env[variable] = value;
  }
}

function setEnvironmentEmail(
  values: Partial<Record<ServerEmailEnvironmentVariable, string>> = {},
): void {
  setEnvironment({ ...ENVIRONMENT_EMAIL, ...values });
}

function unsetEnvironment(): void {
  for (const variable of SERVER_EMAIL_ENVIRONMENT_VARIABLES) {
    delete process.env[variable];
  }
}

// OneUptime restarts: nothing this server read is kept.
function restart(): void {
  ServerSendingStatus.clearCache();
}

beforeEach(() => {
  for (const variable of [
    ...SERVER_EMAIL_ENVIRONMENT_VARIABLES,
    ...SERVER_TWILIO_ENVIRONMENT_VARIABLES,
  ]) {
    before[variable] = process.env[variable];
    delete process.env[variable];
  }

  ServerSendingStatus.clearCache();
  storedConfig = null;
  findOneById.mockReset();
  writeServerSendingHealth.mockReset();

  findOneById.mockImplementation(async (args: unknown): Promise<unknown> => {
    if (!storedConfig) {
      return null;
    }

    return Object.assign(
      new GlobalConfig(),
      readWith((args as { select: Record<string, unknown> }).select),
    );
  });

  writeServerSendingHealth.mockImplementation(
    async (health: unknown): Promise<void> => {
      storedConfig = {
        ...(storedConfig || {}),
        serverSendingHealth: JSON.parse(JSON.stringify(health)),
      };
    },
  );
});

afterEach(() => {
  for (const variable of [
    ...SERVER_EMAIL_ENVIRONMENT_VARIABLES,
    ...SERVER_TWILIO_ENVIRONMENT_VARIABLES,
  ]) {
    if (before[variable] === undefined) {
      delete process.env[variable];
    } else {
      process.env[variable] = before[variable];
    }
  }
});

describe("what the server says of email when its settings change without a save", () => {
  test("an upgrade alone changes nothing: what was learned with the saved settings stays", async () => {
    storedConfig = row({}, { email: FAILING, sms: WORKING });

    const email: ServerChannelStatus = await statusOf(
      ServerSendingChannel.Email,
    );

    expect(email.state).toBe(ServerSendingState.Failing);
    expect(email.lastFailure).toBe(AUTHENTICATION_FAILED);
    expect(email.hasWorked).toBe(true);
  });

  test.each([
    ["the saved settings", false],
    ["the variables' settings", true],
  ])(
    "the same settings - %s - are read as remembered, after a restart too",
    async (_label: string, underVariables: boolean) => {
      storedConfig = row({});

      if (underVariables) {
        setEnvironmentEmail();
      }

      await recordEmail(AUTHENTICATION_FAILED);

      expect(await stateOf(ServerSendingChannel.Email)).toBe(
        ServerSendingState.Failing,
      );

      restart();

      expect(await stateOf(ServerSendingChannel.Email)).toBe(
        ServerSendingState.Failing,
      );

      // The same failure again within the hour is no news: these are the settings it was learned with.
      await recordEmail(AUTHENTICATION_FAILED);

      expect(writeServerSendingHealth).toHaveBeenCalledTimes(1);
    },
  );

  test.each([
    ["password", { [V.SmtpPassword]: "a-fixed-smtp-password" }],
    ["host", { [V.SmtpHost]: "smtp.other.example.com" }],
    ["port", { [V.SmtpPort]: "465" }],
    ["from address", { [V.FromEmail]: "alerts@other.example.com" }],
    [
      "server type",
      { [V.ServerType]: "sendgrid", [V.SendgridApiKey]: "SG.environment-key" },
    ],
  ] as Array<
    [string, Partial<Record<ServerEmailEnvironmentVariable, string>>]
  >)(
    "a changed %s in the variables: email is untested; SMS, calls and push are kept",
    async (
      _label: string,
      change: Partial<Record<ServerEmailEnvironmentVariable, string>>,
    ) => {
      storedConfig = row(
        {},
        {
          sms: WORKING,
          call: { ...FAILING, lastFailure: "busy" },
          push: WORKING,
        },
      );

      setEnvironmentEmail();
      await recordEmail(AUTHENTICATION_FAILED);

      expect(await stateOf(ServerSendingChannel.Email)).toBe(
        ServerSendingState.Failing,
      );

      // The operator changes the variables, and OneUptime restarts.
      setEnvironment(change);
      restart();

      const statuses: Array<ServerChannelStatus> =
        await ServerSendingStatus.getStatuses();

      expect(
        statuses.map((status: ServerChannelStatus) => {
          return [status.channel, status.state];
        }),
      ).toEqual([
        [ServerSendingChannel.Email, ServerSendingState.Untested],
        [ServerSendingChannel.SMS, ServerSendingState.Working],
        [ServerSendingChannel.Call, ServerSendingState.Failing],
        [ServerSendingChannel.Push, ServerSendingState.Working],
      ]);

      const email: ServerChannelStatus = statuses[0]!;

      // Nothing of the old settings' streak is shown as these ones'.
      expect(email.setUpProblem).toBeNull();
      expect(email.hasWorked).toBe(false);
      expect(email.lastWorkedAt).toBeNull();
      expect(email.failingSince).toBeNull();
      expect(email.lastFailure).toBeNull();
    },
  );

  test("from the saved settings to the variables and back: the other side's entries read as untested", async () => {
    storedConfig = row({});

    // Learned with the saved settings.
    await recordEmail();

    expect(await stateOf(ServerSendingChannel.Email)).toBe(
      ServerSendingState.Working,
    );

    // The operator sets the email settings with the variables instead, and restarts.
    setEnvironmentEmail();
    restart();

    expect(await stateOf(ServerSendingChannel.Email)).toBe(
      ServerSendingState.Untested,
    );

    // Learned with the variables' settings: they have never worked.
    await recordEmail("Connection refused");

    const underVariables: ServerChannelStatus = await statusOf(
      ServerSendingChannel.Email,
    );

    expect(underVariables.state).toBe(ServerSendingState.Failing);
    expect(underVariables.hasWorked).toBe(false);

    // And back, by unsetting GLOBAL_EMAIL_SERVER_TYPE.
    unsetEnvironment();
    restart();

    expect(await stateOf(ServerSendingChannel.Email)).toBe(
      ServerSendingState.Untested,
    );
  });

  test("an entry without a fingerprint stays while the saved settings send, and reads as untested under the variables", async () => {
    storedConfig = row({}, { email: FAILING });

    expect(await stateOf(ServerSendingChannel.Email)).toBe(
      ServerSendingState.Failing,
    );

    setEnvironmentEmail();
    restart();

    expect(await stateOf(ServerSendingChannel.Email)).toBe(
      ServerSendingState.Untested,
    );

    unsetEnvironment();
    restart();

    expect(await stateOf(ServerSendingChannel.Email)).toBe(
      ServerSendingState.Failing,
    );
  });

  test("a fixed SMTP password: the failure goes, the sign-in pages may offer email again, and the first email shows it works", async () => {
    storedConfig = row({});

    setEnvironmentEmail({ [V.SmtpPassword]: "a-wrong-smtp-password" });
    await recordEmail(AUTHENTICATION_FAILED);

    let config: GlobalConfig | null = await ServerSendingStatus.readConfig();

    expect(
      ServerSendingStatus.getStatusFrom(config, ServerSendingChannel.Email)
        .state,
    ).toBe(ServerSendingState.Failing);
    // Never sent with these settings: nobody is promised an email.
    expect(ServerSendingStatus.canSendEmailPubliclyFrom(config)).toBe(false);

    // The operator fixes the password in their Helm values and redeploys.
    setEnvironment({ [V.SmtpPassword]: "the-right-smtp-password" });
    restart();

    config = await ServerSendingStatus.readConfig();

    expect(
      ServerSendingStatus.getStatusFrom(config, ServerSendingChannel.Email)
        .state,
    ).toBe(ServerSendingState.Untested);
    expect(ServerSendingStatus.canSendEmailPubliclyFrom(config)).toBe(true);

    await recordEmail();

    expect(await stateOf(ServerSendingChannel.Email)).toBe(
      ServerSendingState.Working,
    );
  });

  test("variables that repeat the saved settings keep what was learned with them", async () => {
    storedConfig = row({}, { email: FAILING });

    setEnvironment(SAVED_EMAIL_AS_VARIABLES);
    restart();

    expect(await stateOf(ServerSendingChannel.Email)).toBe(
      ServerSendingState.Failing,
    );
  });

  test("variables that repeat the saved settings but for requiring TLS are other settings", async () => {
    storedConfig = row({}, { email: FAILING });

    setEnvironment({
      ...SAVED_EMAIL_AS_VARIABLES,
      [V.SmtpRequireTls]: "false",
    });
    restart();

    expect(await stateOf(ServerSendingChannel.Email)).toBe(
      ServerSendingState.Untested,
    );
  });

  test("variables with something wrong: not set up, whatever was learned", async () => {
    storedConfig = row({}, { email: WORKING });

    setEnvironmentEmail({ [V.SmtpPort]: "smtp" });
    restart();

    const config: GlobalConfig | null = await ServerSendingStatus.readConfig();
    const email: ServerChannelStatus = ServerSendingStatus.getStatusFrom(
      config,
      ServerSendingChannel.Email,
    );

    expect(email.state).toBe(ServerSendingState.NotSetUp);
    expect(email.setUpProblem).toContain(V.SmtpPort);
    expect(email.hasWorked).toBe(false);
    expect(ServerSendingStatus.canSendEmailPubliclyFrom(config)).toBe(false);
  });

  test("email's news is marked with the settings it went out with", async () => {
    storedConfig = row({});

    await recordEmail();

    const saved: ServerSendingSettingsFingerprints = await emailFingerprints();

    expect(storedHealth().email?.settingsFingerprint).toBe(saved.current);
    expect(storedHealth().email?.settingsFingerprint).toBe(saved.unmarked);

    setEnvironmentEmail();
    restart();

    await recordEmail();

    const underVariables: ServerSendingSettingsFingerprints =
      await emailFingerprints();

    expect(storedHealth().email?.settingsFingerprint).toBe(
      underVariables.current,
    );
    expect(storedHealth().email?.settingsFingerprint).not.toBe(saved.current);
  });

  test("a write keeps the other channels' entries and their marks", async () => {
    const marked: ServerSendingHealthEntry = {
      ...WORKING,
      settingsFingerprint: "c".repeat(64),
    };

    storedConfig = row({}, { sms: marked, call: WORKING });
    setEnvironmentEmail();

    await recordEmail();

    expect(storedHealth().sms).toEqual(marked);
    expect(storedHealth().call).toEqual(WORKING);
  });
});

describe("what the answers read", () => {
  test("every column of the email settings, with what the server remembers, as root", async () => {
    storedConfig = row({}, { email: FAILING });

    await ServerSendingStatus.getStatuses();
    await recordEmail();

    expect(findOneById).toHaveBeenCalled();

    for (const call of findOneById.mock.calls) {
      const args: Record<string, any> = call[0] as Record<string, any>;

      expect(args["props"]).toEqual({ isRoot: true });
      expect(args["select"]["serverSendingHealth"]).toBe(true);

      for (const column of SERVER_EMAIL_COLUMNS) {
        expect([column, args["select"][column]]).toEqual([column, true]);
      }
    }
  });
});
