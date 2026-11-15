import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import type { SpyInstance } from "jest-mock";
import Path from "path";
import Handlebars from "handlebars";
import nodemailer, { Transporter } from "nodemailer";
import GlobalConfig, {
  EmailServerType,
} from "Common/Models/DatabaseModels/GlobalConfig";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import EmailLogService from "Common/Server/Services/EmailLogService";
import logger from "Common/Server/Utils/Logger";
import ServerSendingOutcomes, {
  ServerSendingOutcome,
} from "Common/Server/Utils/ServerSending/ServerSendingOutcomes";
import { SERVER_EMAIL_ENVIRONMENT_PROBLEM } from "Common/Server/Utils/ServerEmailSettings";
import Hostname from "Common/Types/API/Hostname";
import Email from "Common/Types/Email";
import AmazonSesAuthenticationType from "Common/Types/Email/AmazonSesAuthenticationType";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import MailgunRegion from "Common/Types/Email/MailgunRegion";
import MailTransportType from "Common/Types/Email/MailTransportType";
import OAuthProviderType from "Common/Types/Email/OAuthProviderType";
import {
  SERVER_EMAIL_ENVIRONMENT_VARIABLES,
  ServerEmailEnvironmentVariable,
} from "Common/Types/Email/ServerEmailEnvironment";
import SMTPAuthenticationType from "Common/Types/Email/SMTPAuthenticationType";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import { ServerSendingChannel } from "Common/Types/ServerSending/ServerSendingStatus";
import { SERVER_EMAIL_NOT_SET_UP_MESSAGE } from "Common/Types/ServerSending/ServerSendingWords";
import ErrorClass, {
  declaredErrorClass,
} from "Common/Types/Telemetry/ErrorClass";

/*
 * THE NOTIFICATION SERVICE SENDS WITH THE SETTINGS THE ENVIRONMENT
 * VARIABLES SET (#7738).
 *
 * A self-hosted installation kept in code sets the server's email settings
 * with GLOBAL_EMAIL_ variables (the Helm chart's email values, or
 * config.env). Here the real Notification/Config getters and the real
 * MailService run, with only the database row, the mail transports and the
 * Email Log stood in for:
 *
 *   - set, the server's own email goes out with the variables' settings -
 *     their mail server, SendGrid key or provider - never the saved ones,
 *     and the saved row is not even read;
 *   - set with something wrong, nothing goes out, through either settings:
 *     the server's log says what is wrong, by the variables' names, and
 *     everyone else reads that email is not set up;
 *   - unset, the saved settings send exactly as before.
 */

jest.mock("Common/Server/Services/GlobalConfigService", () => {
  return { __esModule: true, default: { findOneBy: jest.fn() } };
});

jest.mock("Common/Server/Utils/CallAndSmsGatewayConfig", () => {
  return { __esModule: true, default: { getGateway: jest.fn() } };
});

jest.mock("Common/Server/Services/EmailLogService", () => {
  return { __esModule: true, default: { create: jest.fn() } };
});

jest.mock("Common/Server/Services/UserOnCallLogTimelineService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn(), updateOneBy: jest.fn() },
  };
});

jest.mock("Common/Models/DatabaseModels/EmailLog", () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => {
      return {};
    }),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: {},
    default: {
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

jest.mock("Common/Server/Utils/Telemetry/AppMetrics", () => {
  return {
    __esModule: true,
    default: {
      getNotificationCounter: () => {
        return { add: jest.fn() };
      },
      getNotificationDuration: () => {
        return { record: jest.fn() };
      },
    },
  };
});

jest.mock("Common/Server/Utils/DataSource/EgressGuard", () => {
  return { __esModule: true, default: { assertHostnameAllowed: jest.fn() } };
});

jest.mock("nodemailer", () => {
  return { __esModule: true, default: { createTransport: jest.fn() } };
});

jest.mock("@sendgrid/mail", () => {
  return {
    __esModule: true,
    default: { setApiKey: jest.fn(), send: jest.fn() },
  };
});

jest.mock("../../FeatureSet/Notification/Services/SMTPOAuthService", () => {
  return { __esModule: true, default: { getAccessToken: jest.fn() } };
});

import {
  getEmailServerType,
  getGlobalEmailProviderServer,
  getGlobalSMTPConfig,
  getSendgridConfig,
  SendGridConfig,
} from "../../FeatureSet/Notification/Config";
import MailService from "../../FeatureSet/Notification/Services/MailService";
import AmazonSesMailProvider from "../../FeatureSet/Notification/Services/MailProviders/AmazonSesMailProvider";
import SendGridMailProvider from "../../FeatureSet/Notification/Services/MailProviders/SendGridMailProvider";
import "../../FeatureSet/Notification/Utils/Handlebars";

const V: typeof ServerEmailEnvironmentVariable = ServerEmailEnvironmentVariable;

// A variable left out of the environment is undefined.
type Values = Partial<
  Record<ServerEmailEnvironmentVariable, string | undefined>
>;

const ENV_PASSWORD: string = "environment-smtp-password-sentinel-7738";
const ENV_SENDGRID_KEY: string = "SG.environment-key-sentinel-7738";
const SAVED_PASSWORD: string = "saved-smtp-password";
const PROJECT_ID: ObjectID = new ObjectID(
  "77380000-0000-4000-8000-000000000001",
);

type SendMail = (mail: unknown) => Promise<{ messageId: string }>;

const sendMail: ReturnType<typeof jest.fn<SendMail>> = jest.fn<SendMail>();

const outcomes: Array<ServerSendingOutcome> = [];

// The settings an admin saved in the Admin Dashboard: a mail server that sends.
function savedRow(): GlobalConfig {
  return Object.assign(new GlobalConfig(), {
    emailServerType: EmailServerType.CustomSMTP,
    smtpHost: new Hostname("saved-smtp.example.com"),
    smtpPort: new Port(25),
    smtpUsername: "saved-user",
    smtpPassword: SAVED_PASSWORD,
    isSMTPSecure: false,
    smtpFromEmail: new Email("saved@example.com"),
    smtpFromName: "Saved Sender",
    sendgridApiKey: "SG.saved-key",
    sendgridFromEmail: new Email("saved@example.com"),
    sendgridFromName: "Saved Sender",
  });
}

const before: Record<string, string | undefined> = {};

function setEnvironment(values: Values): void {
  for (const [variable, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[variable];
    } else {
      process.env[variable] = value;
    }
  }
}

function environmentSmtp(values: Values = {}): Values {
  return {
    [V.ServerType]: "custom-smtp",
    [V.SmtpHost]: "env-smtp.example.com",
    [V.SmtpPort]: "587",
    [V.SmtpRequireTls]: "true",
    [V.SmtpUsername]: "env-user",
    [V.SmtpPassword]: ENV_PASSWORD,
    [V.FromEmail]: "env@example.com",
    [V.FromName]: "Environment Sender",
    ...values,
  };
}

function message(): EmailMessage {
  return {
    toEmail: new Email("alice@example.test"),
    subject: "Incident #12: Checkout API is down",
    isSubjectLiteral: true,
    templateType: EmailTemplateType.SimpleMessage,
    vars: { subject: "Incident #12", message: "Checkout API is down" },
    body: "",
  };
}

function findOneBy(): jest.Mock {
  return GlobalConfigService.findOneBy as unknown as jest.Mock;
}

// The options each nodemailer transport was made with.
function transportOptions(): Array<Record<string, unknown>> {
  return (
    jest.mocked(nodemailer.createTransport).mock.calls as Array<Array<unknown>>
  ).map((call: Array<unknown>): Record<string, unknown> => {
    return call[0] as Record<string, unknown>;
  });
}

function warnings(): Array<string> {
  return (jest.mocked(logger.warn).mock.calls as Array<Array<unknown>>).map(
    (call: Array<unknown>): string => {
      return String(call[0]);
    },
  );
}

async function refusal(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }

  throw new Error("Expected a refusal.");
}

beforeAll(async () => {
  const partialsDir: string = Path.resolve(
    __dirname,
    "../../FeatureSet/Notification/Templates/Partials",
  );
  const partialNames: Array<string> = fs
    .readdirSync(partialsDir)
    .filter((name: string): boolean => {
      return name.endsWith(".hbs");
    })
    .map((name: string): string => {
      return name.slice(0, -4);
    });
  const deadline: number = Date.now() + 15000;

  while (
    partialNames.some((name: string): boolean => {
      return typeof Handlebars.partials[name] !== "function";
    })
  ) {
    if (Date.now() >= deadline) {
      throw new Error("Production email partial registration did not finish");
    }

    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 10);
    });
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  outcomes.length = 0;

  for (const variable of SERVER_EMAIL_ENVIRONMENT_VARIABLES) {
    before[variable] = process.env[variable];
    delete process.env[variable];
  }

  findOneBy().mockImplementation(async (): Promise<GlobalConfig> => {
    return savedRow();
  });

  ServerSendingOutcomes.register(
    async (outcome: ServerSendingOutcome): Promise<void> => {
      outcomes.push(outcome);
    },
  );

  sendMail.mockResolvedValue({ messageId: "mocked-delivery" });
  jest.mocked(nodemailer.createTransport).mockReturnValue({
    sendMail,
    close: jest.fn(),
  } as unknown as Transporter);
});

afterEach(async () => {
  for (const variable of SERVER_EMAIL_ENVIRONMENT_VARIABLES) {
    if (before[variable] === undefined) {
      delete process.env[variable];
    } else {
      process.env[variable] = before[variable];
    }
  }

  ServerSendingOutcomes.register(null);
  jest.restoreAllMocks();
  await MailService.cleanup();
});

describe("the settings the Notification service reads", () => {
  test("set: the variables' mail server, whatever the row holds - and the row is not read", async () => {
    setEnvironment(environmentSmtp());

    expect(await getEmailServerType()).toBe(EmailServerType.CustomSMTP);

    const server: EmailServer | null = await getGlobalSMTPConfig();

    expect(server).toMatchObject({
      transportType: MailTransportType.SMTP,
      username: "env-user",
      password: ENV_PASSWORD,
      secure: true,
      fromName: "Environment Sender",
      authType: SMTPAuthenticationType.UsernamePassword,
    });
    expect(server!.host!.toString()).toBe("env-smtp.example.com");
    expect(server!.port!.toNumber()).toBe(587);
    expect(server!.fromEmail.toString()).toBe("env@example.com");
    // Not the saved account's SendGrid either.
    expect(await getSendgridConfig()).toBeNull();
    expect(findOneBy()).not.toHaveBeenCalled();
  });

  test("set to send without signing in: no username, no password", async () => {
    setEnvironment(
      environmentSmtp({
        [V.SmtpAuthType]: "none",
        [V.SmtpUsername]: undefined,
        [V.SmtpPassword]: undefined,
        [V.SmtpRequireTls]: undefined,
      }),
    );

    const server: EmailServer | null = await getGlobalSMTPConfig();

    expect(server).toMatchObject({
      authType: SMTPAuthenticationType.None,
      username: undefined,
      password: undefined,
      secure: false,
    });
  });

  test("set to Microsoft Graph: the OAuth app, and no mail server", async () => {
    setEnvironment({
      [V.ServerType]: "custom-smtp",
      [V.SmtpTransport]: "Microsoft Graph",
      [V.SmtpOAuthClientId]: "client-id",
      [V.SmtpOAuthClientSecret]: "client-secret",
      [V.SmtpOAuthTokenUrl]:
        "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
      [V.SmtpOAuthScope]: "https://graph.microsoft.com/.default",
      [V.FromEmail]: "env@example.com",
      [V.FromName]: "Environment Sender",
    });

    const server: EmailServer | null = await getGlobalSMTPConfig();

    expect(server).toMatchObject({
      transportType: MailTransportType.MicrosoftGraph,
      authType: SMTPAuthenticationType.OAuth,
      clientId: "client-id",
      clientSecret: "client-secret",
      scope: "https://graph.microsoft.com/.default",
      host: undefined,
      port: undefined,
    });
    expect(server!.tokenUrl!.toString()).toBe(
      "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
    );
  });

  test("set to SMTP with OAuth's JWT Bearer: the mailbox, and the private key as the client secret", async () => {
    const privateKey: string =
      "-----BEGIN PRIVATE KEY-----\nMIIEvQ\n-----END PRIVATE KEY-----";

    setEnvironment(
      environmentSmtp({
        [V.SmtpAuthType]: "oauth",
        [V.SmtpOAuthProviderType]: "jwt-bearer",
        [V.SmtpUsername]: "alerts@example.com",
        [V.SmtpPassword]: undefined,
        [V.SmtpOAuthClientId]:
          "service-account@example.iam.gserviceaccount.com",
        [V.SmtpOAuthClientSecret]: privateKey,
        [V.SmtpOAuthTokenUrl]: "https://oauth2.googleapis.com/token",
        [V.SmtpOAuthScope]: "https://mail.google.com/",
      }),
    );

    const server: EmailServer | null = await getGlobalSMTPConfig();

    expect(server).toMatchObject({
      transportType: MailTransportType.SMTP,
      authType: SMTPAuthenticationType.OAuth,
      oauthProviderType: OAuthProviderType.JWTBearer,
      username: "alerts@example.com",
      clientSecret: privateKey,
      password: undefined,
    });
  });

  test("set to SendGrid: the variables' key and sender", async () => {
    setEnvironment({
      [V.ServerType]: "sendgrid",
      [V.SendgridApiKey]: ENV_SENDGRID_KEY,
      [V.FromEmail]: "env@example.com",
      [V.FromName]: "Environment Sender",
    });

    expect(await getEmailServerType()).toBe(EmailServerType.Sendgrid);

    const config: SendGridConfig | null = await getSendgridConfig();

    expect(config?.apiKey).toBe(ENV_SENDGRID_KEY);
    expect(config?.fromEmail.toString()).toBe("env@example.com");
    expect(config?.fromName).toBe("Environment Sender");
    expect(findOneBy()).not.toHaveBeenCalled();
  });

  test("set to Amazon SES with the server's IAM role: the role named, no key", async () => {
    setEnvironment({
      [V.ServerType]: "amazon-ses",
      [V.AmazonSesAuthenticationType]: "server-iam-role",
      [V.AmazonSesRegion]: "EU-WEST-1",
      [V.FromEmail]: "env@example.com",
    });

    expect(await getEmailServerType()).toBe(EmailServerType.AmazonSES);

    const server: EmailServer = await getGlobalEmailProviderServer(
      MailTransportType.AmazonSES,
    );

    expect(server).toMatchObject({
      transportType: MailTransportType.AmazonSES,
      awsAuthenticationType: AmazonSesAuthenticationType.ServerIamRole,
      awsAccessKeyId: undefined,
      awsSecretAccessKey: undefined,
      awsRegion: "eu-west-1",
    });
    // No id: the sender gives the server's role to no config that has one.
    expect(server.id).toBeUndefined();
    // Left empty, the name is the product's.
    expect(server.fromName).toBeTruthy();
  });

  test("set to Amazon SES with an access key: the key", async () => {
    setEnvironment({
      [V.ServerType]: "amazon-ses",
      [V.AmazonSesAccessKeyId]: "AKIAIOSFODNN7EXAMPLE",
      [V.AmazonSesSecretAccessKey]: "ses-secret",
      [V.AmazonSesRegion]: "us-east-1",
      [V.FromEmail]: "env@example.com",
    });

    expect(
      await getGlobalEmailProviderServer(MailTransportType.AmazonSES),
    ).toMatchObject({
      awsAuthenticationType: AmazonSesAuthenticationType.AccessKey,
      awsAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
      awsSecretAccessKey: "ses-secret",
      awsRegion: "us-east-1",
    });
  });

  test("set to Mailgun, Postmark or Resend: each one's key and sender", async () => {
    setEnvironment({
      [V.ServerType]: "mailgun",
      [V.MailgunApiKey]: "mailgun-key",
      [V.MailgunDomain]: "MG.Example.com",
      [V.MailgunRegion]: "eu",
      [V.FromEmail]: "env@example.com",
      [V.FromName]: "Environment Sender",
    });

    expect(
      await getGlobalEmailProviderServer(MailTransportType.Mailgun),
    ).toMatchObject({
      apiKey: "mailgun-key",
      mailgunDomain: "mg.example.com",
      mailgunRegion: MailgunRegion.EU,
      fromName: "Environment Sender",
    });

    setEnvironment({
      [V.ServerType]: "postmark",
      [V.PostmarkServerToken]: "postmark-token",
    });

    expect(await getEmailServerType()).toBe(EmailServerType.Postmark);
    expect(
      await getGlobalEmailProviderServer(MailTransportType.Postmark),
    ).toMatchObject({ apiKey: "postmark-token" });

    setEnvironment({
      [V.ServerType]: "resend",
      [V.ResendApiKey]: "re_key",
    });

    expect(await getEmailServerType()).toBe(EmailServerType.Resend);
    expect(
      await getGlobalEmailProviderServer(MailTransportType.Resend),
    ).toMatchObject({ apiKey: "re_key" });
    expect(findOneBy()).not.toHaveBeenCalled();
  });

  test("set with something wrong: no type but Custom SMTP, whose settings refuse with what is wrong, by the variables' names", async () => {
    setEnvironment({
      [V.ServerType]: "sendgrid",
      [V.FromEmail]: "env@example.com",
      [V.FromName]: "Environment Sender",
    });

    // Never SendGrid's own refusal, about the Admin Dashboard.
    expect(await getEmailServerType()).toBe(EmailServerType.CustomSMTP);
    expect(await getSendgridConfig()).toBeNull();

    const error: Error = await refusal(getGlobalSMTPConfig());

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(
      `${SERVER_EMAIL_ENVIRONMENT_PROBLEM} GLOBAL_EMAIL_SENDGRID_API_KEY is not set: SendGrid sends nothing without it.`,
    );
    expect(findOneBy()).not.toHaveBeenCalled();
  });

  test("set with something wrong for a provider: refused by the variable's name, as the operator's to fix", async () => {
    setEnvironment({
      [V.ServerType]: "amazon-ses",
      [V.AmazonSesAccessKeyId]: "AKIAIOSFODNN7EXAMPLE",
      [V.AmazonSesSecretAccessKey]: "ses-secret",
      [V.AmazonSesRegion]: "moon-1",
      [V.FromEmail]: "env@example.com",
    });

    const error: Error = await refusal(
      getGlobalEmailProviderServer(MailTransportType.AmazonSES),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(
      `${SERVER_EMAIL_ENVIRONMENT_PROBLEM} GLOBAL_EMAIL_AMAZON_SES_REGION: "moon-1" is not an AWS Region code, such as us-east-1.`,
    );
    expect(error.message).not.toContain("ses-secret");
    expect(declaredErrorClass(error)).toEqual({
      errorClass: ErrorClass.UserError,
      authoritative: true,
    });
  });

  test("set with a type that is not one: Custom SMTP, refused by the variable's name", async () => {
    setEnvironment({ [V.ServerType]: "gmail" });

    expect(await getEmailServerType()).toBe(EmailServerType.CustomSMTP);
    expect((await refusal(getGlobalSMTPConfig())).message).toContain(
      'GLOBAL_EMAIL_SERVER_TYPE must be custom-smtp, sendgrid, amazon-ses, mailgun, postmark or resend, not "gmail".',
    );
  });

  test("unset: the saved settings, read from the row, as before", async () => {
    expect(await getEmailServerType()).toBe(EmailServerType.CustomSMTP);

    const server: EmailServer | null = await getGlobalSMTPConfig();

    expect(server!.host!.toString()).toBe("saved-smtp.example.com");
    expect(server!.password).toBe(SAVED_PASSWORD);
    expect(findOneBy()).toHaveBeenCalled();
  });

  test("variables set without GLOBAL_EMAIL_SERVER_TYPE change nothing: the saved settings send", async () => {
    setEnvironment({
      [V.SmtpHost]: "env-smtp.example.com",
      [V.SmtpPassword]: ENV_PASSWORD,
    });

    const server: EmailServer | null = await getGlobalSMTPConfig();

    expect(server!.host!.toString()).toBe("saved-smtp.example.com");
    expect(server!.password).toBe(SAVED_PASSWORD);
  });

  test("read again on every send: a change to the variables is what the next email goes with", async () => {
    expect((await getGlobalSMTPConfig())!.host!.toString()).toBe(
      "saved-smtp.example.com",
    );

    setEnvironment(environmentSmtp());
    expect((await getGlobalSMTPConfig())!.host!.toString()).toBe(
      "env-smtp.example.com",
    );

    setEnvironment({ [V.SmtpHost]: "other-smtp.example.com" });
    expect((await getGlobalSMTPConfig())!.host!.toString()).toBe(
      "other-smtp.example.com",
    );

    setEnvironment({ [V.ServerType]: undefined });
    expect((await getGlobalSMTPConfig())!.host!.toString()).toBe(
      "saved-smtp.example.com",
    );
  });
});

describe("an email the server sends with them (MailService)", () => {
  test("set: it goes out through the variables' mail server, signed in with their password", async () => {
    setEnvironment(environmentSmtp());

    await MailService.send(message(), { projectId: PROJECT_ID });

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(transportOptions()).toHaveLength(1);
    expect(transportOptions()[0]).toMatchObject({
      host: "env-smtp.example.com",
      port: 587,
      auth: { user: "env-user", pass: ENV_PASSWORD },
    });
    expect((sendMail.mock.calls[0]![0] as { from: string }).from).toContain(
      "env@example.com",
    );
    expect(outcomes).toEqual([
      { channel: ServerSendingChannel.Email, succeeded: true },
    ]);
    expect(findOneBy()).not.toHaveBeenCalled();
  });

  test("set to SendGrid: it goes out with the variables' key", async () => {
    setEnvironment({
      [V.ServerType]: "sendgrid",
      [V.SendgridApiKey]: ENV_SENDGRID_KEY,
      [V.FromEmail]: "env@example.com",
      [V.FromName]: "Environment Sender",
    });

    const send: SpyInstance<SendGridMailProvider["send"]> = jest
      .spyOn(SendGridMailProvider.prototype, "send")
      .mockResolvedValue(undefined as never);

    await MailService.send(message());

    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0]![1] as SendGridConfig).apiKey).toBe(
      ENV_SENDGRID_KEY,
    );
    expect(sendMail).not.toHaveBeenCalled();
  });

  test("set to Amazon SES with the server's IAM role: it goes out signed in as the role", async () => {
    setEnvironment({
      [V.ServerType]: "amazon-ses",
      [V.AmazonSesAuthenticationType]: "server-iam-role",
      [V.AmazonSesRegion]: "eu-west-1",
      [V.FromEmail]: "env@example.com",
    });

    const send: SpyInstance<AmazonSesMailProvider["send"]> = jest
      .spyOn(AmazonSesMailProvider.prototype, "send")
      .mockResolvedValue(undefined as never);

    await MailService.send(message());

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![1] as EmailServer).toMatchObject({
      awsAuthenticationType: AmazonSesAuthenticationType.ServerIamRole,
      awsAccessKeyId: undefined,
      awsRegion: "eu-west-1",
    });
  });

  test("set with something wrong: nothing goes out through either settings; the log says what, everyone else that email is not set up", async () => {
    setEnvironment(
      environmentSmtp({
        [V.SmtpHost]: undefined,
      }),
    );

    await expect(
      MailService.send(message(), { projectId: PROJECT_ID }),
    ).rejects.toThrow(SERVER_EMAIL_NOT_SET_UP_MESSAGE);

    expect(sendMail).not.toHaveBeenCalled();
    expect(findOneBy()).not.toHaveBeenCalled();

    // The server's log, by the variable's name - never the password.
    expect(warnings()).toContain(
      `This server's email settings are incomplete: ${SERVER_EMAIL_ENVIRONMENT_PROBLEM} GLOBAL_EMAIL_SMTP_HOST is not set: email goes out through that mail server, such as smtp.example.com.`,
    );
    expect(warnings().join("\n")).not.toContain(ENV_PASSWORD);

    // The Email Log row a project's owners read: not set up, in their words.
    const rows: Array<Record<string, unknown>> = (
      jest.mocked(EmailLogService.create).mock.calls as Array<Array<unknown>>
    ).map((call: Array<unknown>): Record<string, unknown> => {
      return {
        ...((call[0] as { data: Record<string, unknown> }).data || {}),
      };
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      statusMessage: SERVER_EMAIL_NOT_SET_UP_MESSAGE,
    });
    // Nothing reached a mail service: nothing recorded as failing.
    expect(outcomes).toEqual([]);
  });

  test("unset: it goes out through the saved mail server, as before", async () => {
    await MailService.send(message(), { projectId: PROJECT_ID });

    expect(transportOptions()[0]).toMatchObject({
      host: "saved-smtp.example.com",
      port: 25,
      auth: { user: "saved-user", pass: SAVED_PASSWORD },
    });
  });

  test("a project's own mail server is not the variables' business", async () => {
    setEnvironment(environmentSmtp());

    await MailService.send(message(), {
      projectId: PROJECT_ID,
      emailServer: {
        host: new Hostname("smtp.project.example.com"),
        port: new Port(2525),
        secure: false,
        username: "project-user",
        password: "project-password",
        fromName: "Project",
        fromEmail: new Email("project@example.com"),
      },
    });

    expect(transportOptions()[0]).toMatchObject({
      host: "smtp.project.example.com",
      port: 2525,
    });
    expect(outcomes).toEqual([]);
  });
});
