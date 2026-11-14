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
import { AdminDashboardClientURL } from "Common/Server/EnvironmentConfig";
import EmailLogService from "Common/Server/Services/EmailLogService";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import logger from "Common/Server/Utils/Logger";
import ServerChannelSetup from "Common/Server/Utils/ServerSending/ServerChannelSetup";
import ServerSendingOutcomes, {
  ServerSendingOutcome,
} from "Common/Server/Utils/ServerSending/ServerSendingOutcomes";
import Hostname from "Common/Types/API/Hostname";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import MailTransportType from "Common/Types/Email/MailTransportType";
import OAuthProviderType from "Common/Types/Email/OAuthProviderType";
import { SERVER_EMAIL_ENVIRONMENT_VARIABLES } from "Common/Types/Email/ServerEmailEnvironment";
import SMTPAuthenticationType from "Common/Types/Email/SMTPAuthenticationType";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import { SERVER_EMAIL_NOT_SET_UP_MESSAGE } from "Common/Types/ServerSending/ServerSendingWords";

/*
 * THE SERVER'S OWN MAIL SERVER, SIGNING IN WITH OAUTH, NAMES ITS MAILBOX
 * (#7833).
 *
 * Over SMTP, OAuth signs in as a mailbox: the XOAUTH2 sign-in names its
 * user, with either grant, and MailService.createOAuthTransporter refuses
 * every email without one. The saved settings (Admin Dashboard > Settings >
 * Emails, Custom SMTP, Authentication Type OAuth) were taken without it:
 * getGlobalSMTPConfig handed them on, ServerChannelSetup read them as set
 * up - the sending banner, /admin/setup and canSendEmail, so the sign-in
 * pages offered Forgot password - and then every email was refused at the
 * transport, with only the server's log to say why.
 *
 * Now a blank username is a setting left blank, like a blank OAuth Client
 * ID: the email is refused before a token is asked for, the server's log
 * names the Username and where to set it, everyone else reads that email is
 * not set up, and the pages say which field. Microsoft Graph sends as the
 * From Email, and needs none. Signing in with a password, or not at all,
 * the server's settings take a blank username as before.
 *
 * The real Notification/Config getters, MailService and ServerChannelSetup
 * run here; the saved row, the mail transports, the token endpoint and the
 * Email Log are stood in for.
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

jest.mock("../../FeatureSet/Notification/Services/SMTPOAuthService", () => {
  return { __esModule: true, default: { getAccessToken: jest.fn() } };
});

import { getGlobalSMTPConfig } from "../../FeatureSet/Notification/Config";
import MailService from "../../FeatureSet/Notification/Services/MailService";
import MicrosoftGraphMailProvider from "../../FeatureSet/Notification/Services/MailProviders/MicrosoftGraphMailProvider";
import SMTPOAuthService from "../../FeatureSet/Notification/Services/SMTPOAuthService";
import "../../FeatureSet/Notification/Utils/Handlebars";

const MAILBOX: string = "alerts@example.com";
const CLIENT_SECRET: string = "oauth-client-secret-sentinel-7833";
const ACCESS_TOKEN: string = "access-token-sentinel-7833";
const PROJECT_ID: ObjectID = new ObjectID(
  "78330000-0000-4000-8000-000000000001",
);

const USERNAME_NOT_SET_REFUSAL: string = `SMTP Username not found. Please set this in the Admin Dashboard: ${AdminDashboardClientURL.toString()}`;

const USERNAME_NOT_SET_PROBLEM: string =
  "SMTP: the Username is not set under Settings > Emails.";

type SendMail = (mail: unknown) => Promise<{ messageId: string }>;

const sendMail: ReturnType<typeof jest.fn<SendMail>> = jest.fn<SendMail>();

const outcomes: Array<ServerSendingOutcome> = [];

let savedRow: GlobalConfig = new GlobalConfig();

/*
 * Custom SMTP through Microsoft 365, signing in with OAuth as the mailbox
 * - the settings the Admin Dashboard's form saves - with these changed.
 */
function oauthRow(values: Record<string, unknown> = {}): GlobalConfig {
  return Object.assign(new GlobalConfig(), {
    emailServerType: EmailServerType.CustomSMTP,
    smtpTransportType: MailTransportType.SMTP,
    smtpHost: new Hostname("smtp.office365.com"),
    smtpPort: new Port(587),
    isSMTPSecure: true,
    smtpAuthType: SMTPAuthenticationType.OAuth,
    smtpOAuthProviderType: OAuthProviderType.ClientCredentials,
    smtpUsername: MAILBOX,
    smtpClientId: "client-id",
    smtpClientSecret: CLIENT_SECRET,
    smtpTokenUrl: "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
    smtpScope: "https://outlook.office365.com/.default",
    smtpFromEmail: new Email(MAILBOX),
    smtpFromName: "Alerts",
    ...values,
  });
}

function message(): EmailMessage {
  return {
    toEmail: new Email("alice@example.test"),
    subject: "Reset your password",
    isSubjectLiteral: true,
    templateType: EmailTemplateType.SimpleMessage,
    vars: { subject: "Reset your password", message: "Your reset link." },
    body: "",
  };
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

// The Email Log rows a project's owners read.
function emailLogRows(): Array<Record<string, unknown>> {
  return (
    jest.mocked(EmailLogService.create).mock.calls as Array<Array<unknown>>
  ).map((call: Array<unknown>): Record<string, unknown> => {
    return {
      ...((call[0] as { data: Record<string, unknown> }).data || {}),
    };
  });
}

const environmentBefore: Record<string, string | undefined> = {};

beforeAll(async () => {
  // The production templates' partials register as the module loads.
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

  // The saved settings send: no GLOBAL_EMAIL_ variable is set (#7738).
  for (const variable of SERVER_EMAIL_ENVIRONMENT_VARIABLES) {
    environmentBefore[variable] = process.env[variable];
    delete process.env[variable];
  }

  savedRow = oauthRow();

  jest
    .mocked(GlobalConfigService.findOneBy)
    .mockImplementation(async (): Promise<GlobalConfig> => {
      return savedRow;
    });

  ServerSendingOutcomes.register(
    async (outcome: ServerSendingOutcome): Promise<void> => {
      outcomes.push(outcome);
    },
  );

  jest.mocked(SMTPOAuthService.getAccessToken).mockResolvedValue(ACCESS_TOKEN);

  sendMail.mockResolvedValue({ messageId: "mocked-delivery" });
  jest.mocked(nodemailer.createTransport).mockReturnValue({
    sendMail,
    close: jest.fn(),
  } as unknown as Transporter);
});

afterEach(async () => {
  for (const variable of SERVER_EMAIL_ENVIRONMENT_VARIABLES) {
    if (environmentBefore[variable] === undefined) {
      delete process.env[variable];
    } else {
      process.env[variable] = environmentBefore[variable];
    }
  }

  ServerSendingOutcomes.register(null);
  jest.restoreAllMocks();
  await MailService.cleanup();
});

describe("the settings getGlobalSMTPConfig hands on", () => {
  test.each([
    [OAuthProviderType.ClientCredentials, undefined],
    [OAuthProviderType.ClientCredentials, ""],
    [OAuthProviderType.JWTBearer, null],
    [OAuthProviderType.JWTBearer, ""],
  ])(
    "SMTP with OAuth (%s) and a username of %p: refused, by the Username and where to set it",
    async (grant: OAuthProviderType, username: string | null | undefined) => {
      savedRow = oauthRow({
        smtpOAuthProviderType: grant,
        smtpUsername: username,
      });

      await expect(getGlobalSMTPConfig()).rejects.toThrow(
        USERNAME_NOT_SET_REFUSAL,
      );
    },
  );

  test.each([OAuthProviderType.ClientCredentials, OAuthProviderType.JWTBearer])(
    "SMTP with OAuth (%s) and the mailbox: taken, signing in as it",
    async (grant: OAuthProviderType) => {
      savedRow = oauthRow({ smtpOAuthProviderType: grant });

      await expect(getGlobalSMTPConfig()).resolves.toMatchObject({
        transportType: MailTransportType.SMTP,
        authType: SMTPAuthenticationType.OAuth,
        oauthProviderType: grant,
        username: MAILBOX,
      });
    },
  );

  test("Microsoft Graph with no username: taken, sending as the From Email", async () => {
    savedRow = oauthRow({
      smtpTransportType: MailTransportType.MicrosoftGraph,
      smtpUsername: undefined,
      smtpHost: undefined,
      smtpPort: undefined,
      smtpScope: "https://graph.microsoft.com/.default",
    });

    const emailServer: EmailServer | null = await getGlobalSMTPConfig();

    expect(emailServer).toMatchObject({
      transportType: MailTransportType.MicrosoftGraph,
      authType: SMTPAuthenticationType.OAuth,
      username: undefined,
    });
    expect(emailServer!.fromEmail.toString()).toBe(MAILBOX);
  });

  test.each([
    SMTPAuthenticationType.UsernamePassword,
    SMTPAuthenticationType.None,
  ])(
    "signing in with %p, a blank username is taken as before: the server then sends without signing in",
    async (authType: SMTPAuthenticationType) => {
      savedRow = oauthRow({
        smtpAuthType: authType,
        smtpUsername: "",
        smtpPassword: "",
      });

      await expect(getGlobalSMTPConfig()).resolves.toMatchObject({
        authType: authType,
        username: undefined,
      });
    },
  );
});

describe("an email the server sends with them (MailService)", () => {
  test("with the mailbox: it goes out over XOAUTH2, signed in as that mailbox, and the pages say email is set up", async () => {
    await MailService.send(message(), { projectId: PROJECT_ID });

    expect(SMTPOAuthService.getAccessToken).toHaveBeenCalledTimes(1);
    expect(
      jest.mocked(SMTPOAuthService.getAccessToken).mock.calls[0]![0],
    ).toMatchObject({
      username: MAILBOX,
      providerType: OAuthProviderType.ClientCredentials,
    });
    expect(transportOptions()).toHaveLength(1);
    expect(transportOptions()[0]).toMatchObject({
      host: "smtp.office365.com",
      port: 587,
      authMethod: "XOAUTH2",
      auth: { type: "OAuth2", user: MAILBOX, accessToken: ACCESS_TOKEN },
    });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(ServerChannelSetup.getEmailSetUpProblem(savedRow)).toBeNull();
  });

  test.each([
    [OAuthProviderType.ClientCredentials, undefined],
    [OAuthProviderType.JWTBearer, ""],
  ])(
    "OAuth (%s) with a username of %p: nothing goes out and no token is asked for; the log names the Username, everyone else reads email is not set up, and the pages say what is missing",
    async (grant: OAuthProviderType, username: string | undefined) => {
      savedRow = oauthRow({
        smtpOAuthProviderType: grant,
        smtpUsername: username,
      });

      await expect(
        MailService.send(message(), { projectId: PROJECT_ID }),
      ).rejects.toThrow(SERVER_EMAIL_NOT_SET_UP_MESSAGE);

      expect(SMTPOAuthService.getAccessToken).not.toHaveBeenCalled();
      expect(nodemailer.createTransport).not.toHaveBeenCalled();
      expect(sendMail).not.toHaveBeenCalled();

      // The server's log: the field, and where to set it - never the secret.
      expect(warnings()).toContain(
        `This server's email settings are incomplete: ${USERNAME_NOT_SET_REFUSAL}`,
      );
      expect(warnings().join("\n")).not.toContain(CLIENT_SECRET);

      // The Email Log row a project's owners read: not set up, in their words.
      const rows: Array<Record<string, unknown>> = emailLogRows();

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        statusMessage: SERVER_EMAIL_NOT_SET_UP_MESSAGE,
      });

      /*
       * It never reached a mail server, so no failure is recorded: the
       * banner and canSendEmail read "not set up" from the settings, which
       * now say so.
       */
      expect(outcomes).toEqual([]);
      expect(ServerChannelSetup.getEmailSetUpProblem(savedRow)).toBe(
        USERNAME_NOT_SET_PROBLEM,
      );
    },
  );

  test("Microsoft Graph with no username: it goes out, as the From Email", async () => {
    const graphSend: SpyInstance<MicrosoftGraphMailProvider["send"]> = jest
      .spyOn(MicrosoftGraphMailProvider.prototype, "send")
      .mockResolvedValue(undefined as never);

    savedRow = oauthRow({
      smtpTransportType: MailTransportType.MicrosoftGraph,
      smtpUsername: undefined,
      smtpHost: undefined,
      smtpPort: undefined,
      smtpScope: "https://graph.microsoft.com/.default",
    });

    await MailService.send(message(), { projectId: PROJECT_ID });

    expect(graphSend).toHaveBeenCalledTimes(1);

    const emailServer: EmailServer = graphSend.mock.calls[0]![1];

    expect(emailServer.username).toBeUndefined();
    expect(emailServer.fromEmail.toString()).toBe(MAILBOX);
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
    expect(ServerChannelSetup.getEmailSetUpProblem(savedRow)).toBeNull();
  });
});
