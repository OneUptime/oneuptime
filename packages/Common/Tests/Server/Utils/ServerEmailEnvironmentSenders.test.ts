import ServerChannelSetup, {
  EMAIL_NOT_SET_UP_PROBLEM,
  SERVER_CHANNEL_SETTING_COLUMNS,
} from "../../../Server/Utils/ServerSending/ServerChannelSetup";
import {
  getServerEmailEnvironment,
  getServerEmailEnvironmentProblem,
  SERVER_EMAIL_ENVIRONMENT_PROBLEM,
  toServerEmailSettings,
} from "../../../Server/Utils/ServerEmailSettings";
import { getEmailSentThrough } from "../../../Server/Utils/ServerSetup/ServerSetupChecklist";
import GlobalConfig, {
  EmailServerType,
} from "../../../Models/DatabaseModels/GlobalConfig";
import Hostname from "../../../Types/API/Hostname";
import Email from "../../../Types/Email";
import ServerEmailEnvironment, {
  SERVER_EMAIL_COLUMNS,
  SERVER_EMAIL_ENVIRONMENT_VARIABLES,
  ServerEmailEnvironmentReading,
  ServerEmailEnvironmentVariable,
  ServerEmailSettings,
} from "../../../Types/Email/ServerEmailEnvironment";
import Port from "../../../Types/Port";
import { ServerSendingChannel } from "../../../Types/ServerSending/ServerSendingStatus";
import { seededRandom, SeededRandom } from "../../Helpers/SeededRandom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

/*
 * THE SERVER'S EMAIL SETTINGS FROM ENVIRONMENT VARIABLES, AS EVERY READER
 * TAKES THEM (#7738).
 *
 * The Notification service sends with toServerEmailSettings's settings
 * (Notification/Config, tested in App), and the server's sending status,
 * /admin/setup, canSendEmail and the test email ask ServerChannelSetup and
 * the checklist. Once GLOBAL_EMAIL_SERVER_TYPE is set, every one of them
 * reads the settings the GLOBAL_EMAIL_ variables describe, whatever the
 * GlobalConfig row holds; with anything wrong with the variables, none of
 * them falls back to the saved settings - and the status says what is
 * wrong, by the variable's name. Unset, the saved settings apply, as they
 * always did.
 */

const V: typeof ServerEmailEnvironmentVariable = ServerEmailEnvironmentVariable;

const ENV_PASSWORD: string = "environment-smtp-password-sentinel-7738";
const ENV_SENDGRID_KEY: string = "SG.environment-key-sentinel-7738";

// The settings an admin saved in the Admin Dashboard: a mail server that sends.
function savedSettings(values: Partial<GlobalConfig> = {}): GlobalConfig {
  return Object.assign(
    new GlobalConfig(),
    {
      emailServerType: EmailServerType.CustomSMTP,
      smtpHost: new Hostname("saved-smtp.example.com"),
      smtpPort: new Port(25),
      smtpUsername: "saved-user",
      smtpPassword: "saved-password",
      smtpFromEmail: new Email("saved@example.com"),
      smtpFromName: "Saved Sender",
      sendgridApiKey: "SG.saved-key",
      sendgridFromEmail: new Email("saved@example.com"),
      sendgridFromName: "Saved Sender",
    },
    values,
  );
}

const before: Record<string, string | undefined> = {};

function setEnvironment(values: Record<string, string | undefined>): void {
  for (const [variable, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[variable];
    } else {
      process.env[variable] = value;
    }
  }
}

// A mail server the variables set, that sends.
function setEnvironmentSmtp(
  values: Record<string, string | undefined> = {},
): void {
  setEnvironment({
    [V.ServerType]: "custom-smtp",
    [V.SmtpHost]: "env-smtp.example.com",
    [V.SmtpPort]: "587",
    [V.SmtpUsername]: "env-user",
    [V.SmtpPassword]: ENV_PASSWORD,
    [V.FromEmail]: "env@example.com",
    [V.FromName]: "Environment Sender",
    ...values,
  });
}

beforeEach(() => {
  for (const variable of SERVER_EMAIL_ENVIRONMENT_VARIABLES) {
    before[variable] = process.env[variable];
    delete process.env[variable];
  }
});

afterEach(() => {
  for (const variable of SERVER_EMAIL_ENVIRONMENT_VARIABLES) {
    if (before[variable] === undefined) {
      delete process.env[variable];
    } else {
      process.env[variable] = before[variable];
    }
  }

  jest.restoreAllMocks();
});

describe("the settings every reader takes", () => {
  test("unset, the ones saved in the Admin Dashboard, as before", () => {
    const saved: GlobalConfig = savedSettings();

    expect(getServerEmailEnvironment().isSet).toBe(false);
    expect(toServerEmailSettings(saved)).toBe(saved);
    expect(toServerEmailSettings(null)).toBeNull();
    expect(toServerEmailSettings(undefined)).toBeNull();
    expect(getServerEmailEnvironmentProblem()).toBeNull();
  });

  test("set, the variables' settings, whatever the row holds - nothing of it shows through", () => {
    setEnvironment({
      [V.ServerType]: "sendgrid",
      [V.SendgridApiKey]: ENV_SENDGRID_KEY,
      [V.FromEmail]: "env@example.com",
      [V.FromName]: "Environment Sender",
    });

    const settings: ServerEmailSettings =
      toServerEmailSettings(savedSettings())!;

    expect(settings.emailServerType).toBe(EmailServerType.Sendgrid);
    expect(settings.sendgridApiKey).toBe(ENV_SENDGRID_KEY);
    expect(settings.sendgridFromEmail!.toString()).toBe("env@example.com");
    expect(settings.sendgridFromName).toBe("Environment Sender");

    // The saved mail server is not the variables': empty, not inherited.
    expect(settings.smtpHost).toBeUndefined();
    expect(settings.smtpPassword).toBeUndefined();
    expect(JSON.stringify(settings)).not.toContain("saved");
  });

  test("set, with no saved row at all", () => {
    setEnvironmentSmtp();

    expect(toServerEmailSettings(null)!.smtpHost!.toString()).toBe(
      "env-smtp.example.com",
    );
  });

  test("set with something wrong: no settings at all - never the saved ones instead", () => {
    setEnvironmentSmtp({ [V.SmtpPort]: "not-a-port" });

    expect(toServerEmailSettings(savedSettings())).toBeNull();
    expect(getServerEmailEnvironmentProblem()).toBe(
      `${SERVER_EMAIL_ENVIRONMENT_PROBLEM} GLOBAL_EMAIL_SMTP_PORT: "not-a-port" is not a port, a number from 1 to 65535 such as 587.`,
    );
  });

  test("a type that is not one: no settings at all", () => {
    setEnvironment({ [V.ServerType]: "gmail" });

    expect(toServerEmailSettings(savedSettings())).toBeNull();
    expect(getServerEmailEnvironmentProblem()).toContain(
      "GLOBAL_EMAIL_SERVER_TYPE must be",
    );
  });

  test("variables set without GLOBAL_EMAIL_SERVER_TYPE are read by nothing: the saved settings send", () => {
    setEnvironment({
      [V.SmtpHost]: "env-smtp.example.com",
      [V.SmtpPassword]: ENV_PASSWORD,
    });

    const saved: GlobalConfig = savedSettings();

    expect(toServerEmailSettings(saved)).toBe(saved);
    expect(getServerEmailEnvironmentProblem()).toBeNull();
    expect(ServerChannelSetup.getEmailSetUpProblem(saved)).toBeNull();
  });

  test("read again on every call: a change to the variables is what the next reader sees", () => {
    const saved: GlobalConfig = savedSettings();

    expect(toServerEmailSettings(saved)).toBe(saved);

    setEnvironmentSmtp();
    expect(toServerEmailSettings(saved)!.smtpHost!.toString()).toBe(
      "env-smtp.example.com",
    );

    setEnvironment({ [V.SmtpHost]: "other-smtp.example.com" });
    expect(toServerEmailSettings(saved)!.smtpHost!.toString()).toBe(
      "other-smtp.example.com",
    );

    setEnvironment({ [V.ServerType]: undefined });
    expect(toServerEmailSettings(saved)).toBe(saved);
  });

  test("the columns the variables stand in for are the email channel's settings, each of them", () => {
    expect([...SERVER_EMAIL_COLUMNS].sort()).toEqual(
      [...SERVER_CHANNEL_SETTING_COLUMNS[ServerSendingChannel.Email]].sort(),
    );
  });
});

describe("whether the server can send email (ServerChannelSetup)", () => {
  test("unset: the saved settings are checked, as before", () => {
    expect(ServerChannelSetup.getEmailSetUpProblem(savedSettings())).toBeNull();
    expect(ServerChannelSetup.getEmailSetUpProblem(null)).toBe(
      EMAIL_NOT_SET_UP_PROBLEM,
    );
  });

  test("set and complete: set up, even with nothing saved", () => {
    setEnvironmentSmtp();

    expect(ServerChannelSetup.getEmailSetUpProblem(null)).toBeNull();
    expect(ServerChannelSetup.getEmailSetUpProblem(new GlobalConfig())).toBe(
      null,
    );
    expect(
      ServerChannelSetup.getSetUpProblem(
        ServerSendingChannel.Email,
        new GlobalConfig(),
      ),
    ).toBeNull();
  });

  test("set with something wrong: not set up, said by the variable's name - though the saved settings would send", () => {
    setEnvironmentSmtp({
      [V.SmtpHost]: undefined,
      [V.SmtpPassword]: undefined,
    });

    const problem: string | null =
      ServerChannelSetup.getEmailSetUpProblem(savedSettings());

    expect(problem).toBe(
      `${SERVER_EMAIL_ENVIRONMENT_PROBLEM} GLOBAL_EMAIL_SMTP_HOST is not set: email goes out through that mail server, such as smtp.example.com. GLOBAL_EMAIL_SMTP_PASSWORD is not set: the mail server is signed in to with GLOBAL_EMAIL_SMTP_USERNAME and a password. Set it, or set GLOBAL_EMAIL_SMTP_AUTH_TYPE to none to send without signing in.`,
    );
    expect(problem).not.toContain(ENV_PASSWORD);
    expect(problem).not.toContain("saved-password");
  });

  test("set to SendGrid: the saved mail server does not make it set up", () => {
    setEnvironment({
      [V.ServerType]: "sendgrid",
      [V.FromEmail]: "env@example.com",
      [V.FromName]: "Environment Sender",
    });

    expect(ServerChannelSetup.getEmailSetUpProblem(savedSettings())).toBe(
      `${SERVER_EMAIL_ENVIRONMENT_PROBLEM} GLOBAL_EMAIL_SENDGRID_API_KEY is not set: SendGrid sends nothing without it.`,
    );
  });

  test("the other channels are not the email variables' business", () => {
    setEnvironment({ [V.ServerType]: "gmail" });

    expect(
      ServerChannelSetup.getSetUpProblem(
        ServerSendingChannel.Push,
        savedSettings(),
      ),
    ).toBeNull();
  });

  test("every usable reading passes the checks the senders make of a saved row: 2000 from a fixed seed", () => {
    const random: SeededRandom = seededRandom(77380);
    let usable: number = 0;

    const pick: (values: Array<string | undefined>) => string | undefined = (
      values: Array<string | undefined>,
    ): string | undefined => {
      return values[random(values.length)];
    };

    for (let i: number = 0; i < 2000; i++) {
      const values: Record<string, string | undefined> = {
        [V.ServerType]: pick([
          "custom-smtp",
          "sendgrid",
          "amazon-ses",
          "mailgun",
          "postmark",
          "resend",
        ]),
        [V.FromEmail]: pick(["alerts@example.com", undefined]),
        [V.FromName]: pick(["Alerts", undefined]),
        [V.SmtpTransport]: pick(["smtp", "microsoft-graph", undefined]),
        [V.SmtpHost]: pick(["smtp.example.com", undefined]),
        [V.SmtpPort]: pick(["587", undefined]),
        [V.SmtpAuthType]: pick([
          "username-and-password",
          "oauth",
          "none",
          undefined,
        ]),
        [V.SmtpUsername]: pick(["mailer", undefined]),
        [V.SmtpPassword]: pick(["password", undefined]),
        [V.SmtpOAuthProviderType]: pick(["client-credentials", undefined]),
        [V.SmtpOAuthClientId]: pick(["client", undefined]),
        [V.SmtpOAuthClientSecret]: pick(["secret", undefined]),
        [V.SmtpOAuthTokenUrl]: pick([
          "https://login.example.com/token",
          undefined,
        ]),
        [V.SmtpOAuthScope]: pick(["scope", undefined]),
        [V.SendgridApiKey]: pick(["SG.key", undefined]),
        [V.AmazonSesAuthenticationType]: pick([
          "access-key",
          "server-iam-role",
          undefined,
        ]),
        [V.AmazonSesAccessKeyId]: pick(["AKIA", undefined]),
        [V.AmazonSesSecretAccessKey]: pick(["secret", undefined]),
        [V.AmazonSesRegion]: pick(["us-east-1", undefined]),
        [V.MailgunApiKey]: pick(["key", undefined]),
        [V.MailgunDomain]: pick(["mg.example.com", undefined]),
        [V.MailgunRegion]: pick(["us", "eu", undefined]),
        [V.PostmarkServerToken]: pick(["token", undefined]),
        [V.ResendApiKey]: pick(["re_key", undefined]),
      };

      const reading: ServerEmailEnvironmentReading =
        ServerEmailEnvironment.read(values);

      if (!ServerEmailEnvironment.isUsable(reading)) {
        continue;
      }

      usable++;

      // The checks of a saved row, on the variables' settings, with the variables unset.
      expect({
        values: values,
        problem: ServerChannelSetup.getEmailSetUpProblem(reading.settings),
      }).toEqual({ values: values, problem: null });
    }

    expect(usable).toBeGreaterThan(50);
  });
});

describe("what takes the server's email (the setup checklist)", () => {
  test("unset: the saved mail server's host - read from the row's Hostname, as the database gives it", () => {
    expect(getEmailSentThrough(savedSettings())).toBe("saved-smtp.example.com");
  });

  test("set: the variables' mail server, or their provider", () => {
    setEnvironmentSmtp();
    expect(getEmailSentThrough(savedSettings())).toBe("env-smtp.example.com");

    setEnvironment({
      [V.ServerType]: "amazon-ses",
      [V.AmazonSesAuthenticationType]: "server-iam-role",
      [V.AmazonSesRegion]: "eu-west-1",
    });
    expect(getEmailSentThrough(savedSettings())).toBe("Amazon SES (eu-west-1)");

    setEnvironment({
      [V.ServerType]: "custom-smtp",
      [V.SmtpTransport]: "microsoft-graph",
      [V.SmtpOAuthClientId]: "client",
      [V.SmtpOAuthClientSecret]: "secret",
      [V.SmtpOAuthTokenUrl]: "https://login.example.com/token",
      [V.SmtpOAuthScope]: "scope",
    });
    expect(getEmailSentThrough(savedSettings())).toBe("Microsoft Graph");
  });

  test("set with something wrong: nothing takes it - never the saved mail server", () => {
    setEnvironmentSmtp({ [V.FromEmail]: undefined });

    expect(getEmailSentThrough(savedSettings())).toBeNull();
  });
});
