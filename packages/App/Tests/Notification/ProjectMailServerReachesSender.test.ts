import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A PROJECT'S MAIL SERVER IS SENT WITH AS ITS CONFIG SAYS (#7833).
 *
 * A project's Custom SMTP config is checked twice before an email goes
 * out: as the project hands the email on (ProjectSmtpConfigService
 * .toEmailServer), and again in the Notification service, from the
 * request's SMTP_ fields (MailService.getEmailServer, isSMTPConfigValid).
 * If the second refused what the first took, a config its form saved and
 * its own check passed would send nothing - "SMTP Config is not valid",
 * with only the Notification service's log to say which field.
 *
 * Here a config goes the real way: toEmailServer, then Common's
 * MailService.sendMail, whose request is caught as it leaves and read back
 * as JSON, then the Notification service's getEmailServer. What the first
 * takes, the last takes, with every setting as it was: the configs a
 * person meets most, by name, and every mix of transport, sign-in and
 * blank fields, generated from a fixed seed.
 *
 * A relay that needs no sign-in (Authentication Type None) was refused at
 * the last step: the Notification service asked every SMTP server for a
 * username, which only a sign-in needs.
 */

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
  };
});

jest.mock("../../FeatureSet/Notification/Config", () => {
  return {
    getEmailServerType: jest.fn(),
    getGlobalSMTPConfig: jest.fn(),
    getSendgridConfig: jest.fn(),
    getGlobalEmailProviderServer: jest.fn(),
  };
});

import ProjectSmtpConfig from "Common/Models/DatabaseModels/ProjectSmtpConfig";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import CommonMailService from "Common/Server/Services/MailService";
import ProjectSmtpConfigService from "Common/Server/Services/ProjectSmtpConfigService";
import { seededRandom, SeededRandom } from "Common/Tests/Helpers/SeededRandom";
import Hostname from "Common/Types/API/Hostname";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Email from "Common/Types/Email";
import EmailServer from "Common/Types/Email/EmailServer";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import MailTransportType from "Common/Types/Email/MailTransportType";
import OAuthProviderType from "Common/Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "Common/Types/Email/SMTPAuthenticationType";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import API from "Common/Utils/API";
import MailService from "../../FeatureSet/Notification/Services/MailService";

const CONFIG_ID: ObjectID = new ObjectID(
  "78330000-0000-4000-8000-000000000002",
);

/*
 * A config's fields, any of them unset: a stored config can hold a field as
 * undefined, which Partial<> cannot say under exactOptionalPropertyTypes.
 */
type ConfigValues = {
  [Key in keyof ProjectSmtpConfig]?: ProjectSmtpConfig[Key] | undefined;
};

function config(values: ConfigValues): ProjectSmtpConfig {
  const item: ProjectSmtpConfig = new ProjectSmtpConfig();

  Object.assign(item, {
    _id: CONFIG_ID.toString(),
    id: CONFIG_ID,
    name: "Company mail server",
    fromEmail: new Email("alerts@example.com"),
    fromName: "Acme Alerts",
    ...values,
  });

  return item;
}

let posted: Array<JSONObject> = [];

beforeEach(() => {
  posted = [];

  jest
    .spyOn(API, "post")
    .mockImplementation(
      async (options: { data?: unknown }): Promise<HTTPResponse<never>> => {
        posted.push(options.data as JSONObject);

        return new HTTPResponse(200, {}, {}) as HTTPResponse<never>;
      },
    );

  jest
    .spyOn(ClusterKeyAuthorization, "getClusterKeyHeaders")
    .mockReturnValue({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * The request the Notification service is sent for an email through this
 * mail server, as it reads it: JSON.
 */
async function requestFor(emailServer: EmailServer): Promise<JSONObject> {
  await CommonMailService.sendMail(
    {
      toEmail: new Email("alice@example.test"),
      subject: "Incident #12: Checkout API is down",
      templateType: EmailTemplateType.SimpleMessage,
      vars: { subject: "Incident #12", message: "Checkout API is down" },
      body: "",
    },
    { mailServer: emailServer },
  );

  expect(posted).toHaveLength(1);

  return JSON.parse(JSON.stringify(posted.pop())) as JSONObject;
}

// What a mail server is sent with, as text, so the two sides compare.
function settingsOf(emailServer: EmailServer): Record<string, unknown> {
  return {
    id: emailServer.id?.toString(),
    transportType: emailServer.transportType,
    authType: emailServer.authType,
    host: emailServer.host?.toString(),
    port: emailServer.port?.toNumber(),
    secure: Boolean(emailServer.secure),
    username: emailServer.username || undefined,
    password: emailServer.password || undefined,
    clientId: emailServer.clientId || undefined,
    clientSecret: emailServer.clientSecret || undefined,
    tokenUrl: emailServer.tokenUrl?.toString(),
    scope: emailServer.scope || undefined,
    oauthProviderType: emailServer.oauthProviderType || undefined,
    fromEmail: emailServer.fromEmail.toString(),
    fromName: emailServer.fromName,
  };
}

/*
 * What the Notification service makes of a project's config: the settings
 * it sends with, or why it refused them.
 */
async function notificationServiceReads(
  item: ProjectSmtpConfig,
): Promise<{ sent: EmailServer; read: EmailServer | Error }> {
  const sent: EmailServer = ProjectSmtpConfigService.toEmailServer(item)!;
  const request: JSONObject = await requestFor(sent);

  try {
    return { sent, read: MailService.getEmailServer(request) };
  } catch (error) {
    return { sent, read: error as Error };
  }
}

const OAUTH_APP: ConfigValues = {
  clientId: "0f0e0d0c-0b0a-4000-8000-000000000001",
  clientSecret: "oauth-client-secret",
  tokenUrl: "https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token",
  scope: "https://outlook.office365.com/.default",
};

const NAMED_CONFIGS: Array<[string, ConfigValues]> = [
  [
    "a relay that needs no sign-in: no username, no password",
    {
      transportType: MailTransportType.SMTP,
      hostname: new Hostname("relay.example.com"),
      port: new Port(25),
      secure: false,
      authType: SMTPAuthenticationType.None,
    },
  ],
  [
    "a relay with a username left from before it stopped signing in",
    {
      transportType: MailTransportType.SMTP,
      hostname: new Hostname("relay.example.com"),
      port: new Port(25),
      authType: SMTPAuthenticationType.None,
      username: "old-user",
    },
  ],
  [
    "a mail server signed in to with a username and password",
    {
      transportType: MailTransportType.SMTP,
      hostname: new Hostname("smtp.example.com"),
      port: new Port(587),
      secure: true,
      authType: SMTPAuthenticationType.UsernamePassword,
      username: "mailer",
      password: "smtp-password",
    },
  ],
  [
    "a mail server that never picked a sign-in: a username and password",
    {
      hostname: new Hostname("smtp.example.com"),
      port: new Port(465),
      username: "mailer",
      password: "smtp-password",
    },
  ],
  [
    "a mail server signed in to with OAuth, as its mailbox",
    {
      transportType: MailTransportType.SMTP,
      hostname: new Hostname("smtp.office365.com"),
      port: new Port(587),
      secure: true,
      authType: SMTPAuthenticationType.OAuth,
      oauthProviderType: OAuthProviderType.ClientCredentials,
      username: "alerts@example.com",
      ...OAUTH_APP,
    },
  ],
  [
    "a mail server signed in to with OAuth's JWT Bearer, as the mailbox it impersonates",
    {
      transportType: MailTransportType.SMTP,
      hostname: new Hostname("smtp.gmail.com"),
      port: new Port(587),
      authType: SMTPAuthenticationType.OAuth,
      oauthProviderType: OAuthProviderType.JWTBearer,
      username: "alerts@example.com",
      ...OAUTH_APP,
      tokenUrl: "https://oauth2.googleapis.com/token",
      scope: "https://mail.google.com/",
    },
  ],
  [
    "Microsoft Graph, sending as the From Email: no username",
    {
      transportType: MailTransportType.MicrosoftGraph,
      ...OAUTH_APP,
      scope: "https://graph.microsoft.com/.default",
    },
  ],
];

describe("the configs a person meets most", () => {
  test.each(NAMED_CONFIGS)(
    "%s: the Notification service sends with it, as it was saved",
    async (_name: string, values: ConfigValues) => {
      const { sent, read } = await notificationServiceReads(config(values));

      expect(read).not.toBeInstanceOf(Error);
      expect(settingsOf(read as EmailServer)).toEqual(settingsOf(sent));
    },
  );

  test("a relay that needs no sign-in is sent to without one", async () => {
    const { read } = await notificationServiceReads(
      config(NAMED_CONFIGS[0]![1]),
    );

    expect(read).toMatchObject({
      authType: SMTPAuthenticationType.None,
      username: undefined,
      password: undefined,
    });
  });

  test.each([
    [
      "signing in with a password, without the username",
      {
        authType: SMTPAuthenticationType.UsernamePassword,
        password: "smtp-password",
      },
      "Project SMTP config username is not set",
    ],
    [
      "signing in with OAuth, without the mailbox",
      {
        authType: SMTPAuthenticationType.OAuth,
        ...OAUTH_APP,
      },
      "Project SMTP config username (email address) is not set for OAuth",
    ],
  ] as Array<[string, ConfigValues, string]>)(
    "%s: refused as the project hands it on, by the field - before the Notification service is asked",
    (_name: string, values: ConfigValues, refusal: string) => {
      expect(() => {
        return ProjectSmtpConfigService.toEmailServer(
          config({
            transportType: MailTransportType.SMTP,
            hostname: new Hostname("smtp.example.com"),
            port: new Port(587),
            ...values,
          }),
        );
      }).toThrow(refusal);
    },
  );
});

/*
 * The Notification service's own check, on the request alone: a sign-in
 * names who it signs in as - a password sign-in without one would go out
 * without signing in at all - while a relay that needs no sign-in, and
 * Microsoft Graph, need no username.
 */
describe("the request the Notification service is sent", () => {
  function request(values: JSONObject): JSONObject {
    return {
      SMTP_ID: CONFIG_ID.toString(),
      SMTP_EMAIL: "alerts@example.com",
      SMTP_FROM_NAME: "Acme Alerts",
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: 587,
      ...values,
    };
  }

  const OAUTH_FIELDS: JSONObject = {
    SMTP_CLIENT_ID: "client-id",
    SMTP_CLIENT_SECRET: "client-secret",
    SMTP_TOKEN_URL: "https://login.example.com/token",
    SMTP_SCOPE: "https://outlook.office365.com/.default",
  };

  test.each([
    [
      "a password sign-in",
      {
        SMTP_AUTH_TYPE: SMTPAuthenticationType.UsernamePassword,
        SMTP_PASSWORD: "smtp-password",
      },
    ],
    [
      "no sign-in named, read as a password",
      { SMTP_PASSWORD: "smtp-password" },
    ],
    [
      "an OAuth sign-in",
      { SMTP_AUTH_TYPE: SMTPAuthenticationType.OAuth, ...OAUTH_FIELDS },
    ],
  ] as Array<[string, JSONObject]>)(
    "%s without the username is refused; with it, taken",
    (_name: string, values: JSONObject) => {
      expect(() => {
        return MailService.getEmailServer(request(values));
      }).toThrow("SMTP Config is not valid");

      expect(
        MailService.getEmailServer(
          request({ ...values, SMTP_USERNAME: "mailer" }),
        ).username,
      ).toBe("mailer");
    },
  );

  test("a relay that needs no sign-in, and Microsoft Graph, are taken without one", () => {
    expect(
      MailService.getEmailServer(
        request({ SMTP_AUTH_TYPE: SMTPAuthenticationType.None }),
      ),
    ).toMatchObject({
      authType: SMTPAuthenticationType.None,
      username: undefined,
    });

    expect(
      MailService.getEmailServer({
        SMTP_ID: CONFIG_ID.toString(),
        SMTP_TRANSPORT_TYPE: MailTransportType.MicrosoftGraph,
        SMTP_EMAIL: "alerts@example.com",
        SMTP_FROM_NAME: "Acme Alerts",
        ...OAUTH_FIELDS,
      }),
    ).toMatchObject({
      transportType: MailTransportType.MicrosoftGraph,
      username: undefined,
    });
  });
});

// One field: left out, blank, or a value.
function pick<T>(random: SeededRandom, values: Array<T>): T {
  return values[random(values.length)]!;
}

function maybe<T>(random: SeededRandom, value: T): T | undefined {
  return pick(random, [undefined, "" as unknown as T, value, value]);
}

function generatedConfig(random: SeededRandom): ConfigValues {
  return {
    transportType: pick(random, [
      undefined,
      MailTransportType.SMTP,
      MailTransportType.MicrosoftGraph,
    ]),
    authType: pick(random, [
      undefined,
      SMTPAuthenticationType.UsernamePassword,
      SMTPAuthenticationType.OAuth,
      SMTPAuthenticationType.None,
    ]),
    oauthProviderType: pick(random, [
      undefined,
      OAuthProviderType.ClientCredentials,
      OAuthProviderType.JWTBearer,
    ]),
    hostname: pick(random, [undefined, new Hostname("smtp.example.com")]),
    port: pick(random, [undefined, new Port(587), new Port(25)]),
    secure: pick(random, [undefined, false, true]),
    username: maybe(random, "alerts@example.com"),
    password: maybe(random, "smtp-password"),
    clientId: maybe(random, "client-id"),
    clientSecret: maybe(random, "client-secret"),
    tokenUrl: maybe(random, "https://login.example.com/token"),
    scope: maybe(random, "https://outlook.office365.com/.default"),
  };
}

describe("every config, generated", () => {
  test("whatever the project hands on, the Notification service sends with, as it was: 1000 configs from a fixed seed", async () => {
    const random: SeededRandom = seededRandom(7833);
    const disagreements: Array<Record<string, unknown>> = [];
    let handedOn: number = 0;
    let refusedFirst: number = 0;

    for (let i: number = 0; i < 1000; i++) {
      const values: ConfigValues = generatedConfig(random);
      let sent: EmailServer | undefined = undefined;

      try {
        sent = ProjectSmtpConfigService.toEmailServer(config(values));
      } catch {
        // Refused by its field before it is sent: nothing to agree on.
        refusedFirst++;
        continue;
      }

      handedOn++;

      const request: JSONObject = await requestFor(sent!);
      let read: EmailServer | null = null;

      try {
        read = MailService.getEmailServer(request);
      } catch {
        read = null;
      }

      if (!read || !isDeepEqual(settingsOf(read), settingsOf(sent!))) {
        disagreements.push({
          transportType: values.transportType,
          authType: values.authType,
          username: values.username,
          read: read ? settingsOf(read) : "refused",
        });
      }
    }

    expect(disagreements.slice(0, 3)).toEqual([]);
    // Both kinds come up: the sweep is not all one way.
    expect(handedOn).toBeGreaterThan(100);
    expect(refusedFirst).toBeGreaterThan(100);
  });
});

function isDeepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
