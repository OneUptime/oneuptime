import ServerEmailEnvironment, {
  SERVER_EMAIL_AMAZON_SES_AUTHENTICATION_TYPE_VALUES,
  SERVER_EMAIL_COLUMNS,
  SERVER_EMAIL_ENVIRONMENT_ROUTE,
  SERVER_EMAIL_ENVIRONMENT_VARIABLES,
  SERVER_EMAIL_MAILGUN_REGION_VALUES,
  SERVER_EMAIL_SECRET_VARIABLES,
  SERVER_EMAIL_SERVER_TYPE_VALUES,
  SERVER_EMAIL_SET_BY_ENVIRONMENT_MESSAGE,
  SERVER_EMAIL_SMTP_AUTH_TYPE_VALUES,
  SERVER_EMAIL_SMTP_OAUTH_PROVIDER_TYPE_VALUES,
  SERVER_EMAIL_SMTP_TRANSPORT_VALUES,
  ServerEmailEnvironmentAnswer,
  ServerEmailEnvironmentField,
  ServerEmailEnvironmentReading,
  ServerEmailEnvironmentVariable,
  ServerEmailSettings,
} from "../../../Types/Email/ServerEmailEnvironment";
import { EmailServerType } from "../../../Models/DatabaseModels/GlobalConfig";
import Hostname from "../../../Types/API/Hostname";
import Email from "../../../Types/Email";
import AmazonSesAuthenticationType from "../../../Types/Email/AmazonSesAuthenticationType";
import MailgunRegion from "../../../Types/Email/MailgunRegion";
import MailTransportType from "../../../Types/Email/MailTransportType";
import OAuthProviderType from "../../../Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "../../../Types/Email/SMTPAuthenticationType";
import Port from "../../../Types/Port";
import {
  MAX_REFUSED_VALUE_LENGTH,
  REFUSED_VALUE_CUT_MARK,
} from "../../../Utils/RefusedValue";
import { seededRandom, SeededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * THE SERVER'S EMAIL SETTINGS, SET BY ENVIRONMENT VARIABLES (#7738).
 *
 * A self-hosted customer keeps their installation in code (Terraform, Helm)
 * and asked to set the server's settings there, not by hand in the Admin
 * Dashboard (#7515). Once GLOBAL_EMAIL_SERVER_TYPE is set, the
 * GLOBAL_EMAIL_ variables are the whole of the server's email settings;
 * anything wrong with them is said by the variable's name, never with a
 * password or a key, and nothing is then sent. These pin the reading every
 * other piece takes: the senders, the Admin Dashboard's answer, the
 * server's startup lines and the docs.
 */

const V: typeof ServerEmailEnvironmentVariable = ServerEmailEnvironmentVariable;

// Never in a problem, an answer or a startup line.
const SMTP_PASSWORD: string = "smtp-password-sentinel-7738";
const CLIENT_SECRET: string = "oauth-client-secret-sentinel-7738";
const SENDGRID_KEY: string = "SG.sendgrid-key-sentinel-7738";
const SES_SECRET: string = "ses-secret-access-key-sentinel-7738";
const MAILGUN_KEY: string = "mailgun-key-sentinel-7738";
const POSTMARK_TOKEN: string = "postmark-token-sentinel-7738";
const RESEND_KEY: string = "re_resend-key-sentinel-7738";
const PEM_KEY: string =
  "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC-sentinel-7738\n-----END PRIVATE KEY-----";

const SECRETS: Array<string> = [
  SMTP_PASSWORD,
  CLIENT_SECRET,
  SENDGRID_KEY,
  SES_SECRET,
  MAILGUN_KEY,
  POSTMARK_TOKEN,
  RESEND_KEY,
  PEM_KEY,
  "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC-sentinel-7738",
];

type Values = Record<string, string | undefined>;

const SENDER: Values = {
  [V.FromEmail]: "alerts@example.com",
  [V.FromName]: "Example Alerts",
};

function smtp(values: Values = {}): Values {
  return {
    [V.ServerType]: "custom-smtp",
    ...SENDER,
    [V.SmtpHost]: "smtp.example.com",
    [V.SmtpPort]: "587",
    [V.SmtpUsername]: "mailer@example.com",
    [V.SmtpPassword]: SMTP_PASSWORD,
    ...values,
  };
}

function graph(values: Values = {}): Values {
  return {
    [V.ServerType]: "custom-smtp",
    ...SENDER,
    [V.SmtpTransport]: "microsoft-graph",
    [V.SmtpOAuthClientId]: "graph-client-id",
    [V.SmtpOAuthClientSecret]: CLIENT_SECRET,
    [V.SmtpOAuthTokenUrl]:
      "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
    [V.SmtpOAuthScope]: "https://graph.microsoft.com/.default",
    ...values,
  };
}

function smtpOAuth(values: Values = {}): Values {
  return {
    [V.ServerType]: "custom-smtp",
    ...SENDER,
    [V.SmtpHost]: "smtp.office365.com",
    [V.SmtpPort]: "587",
    [V.SmtpAuthType]: "oauth",
    // The mailbox OAuth signs in as: the mail server's XOAUTH2 user.
    [V.SmtpUsername]: "alerts@example.com",
    [V.SmtpOAuthClientId]: "smtp-client-id",
    [V.SmtpOAuthClientSecret]: CLIENT_SECRET,
    [V.SmtpOAuthTokenUrl]:
      "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
    [V.SmtpOAuthScope]: "https://outlook.office365.com/.default",
    ...values,
  };
}

function sendgrid(values: Values = {}): Values {
  return {
    [V.ServerType]: "sendgrid",
    ...SENDER,
    [V.SendgridApiKey]: SENDGRID_KEY,
    ...values,
  };
}

function ses(values: Values = {}): Values {
  return {
    [V.ServerType]: "amazon-ses",
    ...SENDER,
    [V.AmazonSesAccessKeyId]: "AKIAEXAMPLE7738",
    [V.AmazonSesSecretAccessKey]: SES_SECRET,
    [V.AmazonSesRegion]: "us-east-1",
    ...values,
  };
}

function mailgun(values: Values = {}): Values {
  return {
    [V.ServerType]: "mailgun",
    ...SENDER,
    [V.MailgunApiKey]: MAILGUN_KEY,
    [V.MailgunDomain]: "mg.example.com",
    ...values,
  };
}

function postmark(values: Values = {}): Values {
  return {
    [V.ServerType]: "postmark",
    ...SENDER,
    [V.PostmarkServerToken]: POSTMARK_TOKEN,
    ...values,
  };
}

function resend(values: Values = {}): Values {
  return {
    [V.ServerType]: "resend",
    ...SENDER,
    [V.ResendApiKey]: RESEND_KEY,
    ...values,
  };
}

const COMPLETE: Array<[string, Values]> = [
  ["Custom SMTP", smtp()],
  [
    "Custom SMTP without signing in",
    smtp({
      [V.SmtpAuthType]: "none",
      [V.SmtpUsername]: undefined,
      [V.SmtpPassword]: undefined,
    }),
  ],
  ["Custom SMTP signing in with OAuth", smtpOAuth()],
  [
    "Custom SMTP signing in with OAuth, JWT Bearer",
    smtpOAuth({
      [V.SmtpOAuthProviderType]: "jwt-bearer",
      [V.SmtpUsername]: "alerts@example.com",
      [V.SmtpOAuthClientSecret]: PEM_KEY,
    }),
  ],
  ["Microsoft Graph", graph()],
  ["SendGrid", sendgrid()],
  ["Amazon SES with an access key", ses()],
  [
    "Amazon SES with the server's IAM role",
    ses({
      [V.AmazonSesAuthenticationType]: "server-iam-role",
      [V.AmazonSesAccessKeyId]: undefined,
      [V.AmazonSesSecretAccessKey]: undefined,
    }),
  ],
  ["Mailgun", mailgun()],
  ["Mailgun in the EU", mailgun({ [V.MailgunRegion]: "eu" })],
  ["Postmark", postmark()],
  ["Resend", resend()],
];

function read(values: Values): ServerEmailEnvironmentReading {
  return ServerEmailEnvironment.read(values);
}

function problemsOf(values: Values): Array<string> {
  return read(values).problems;
}

// Everything a reading says out loud: its problems, its answer, its startup lines.
function everythingSaid(reading: ServerEmailEnvironmentReading): string {
  return JSON.stringify([
    reading.problems,
    reading.ignored,
    ServerEmailEnvironment.toAnswer(reading),
    ServerEmailEnvironment.getStartupNotice(reading),
    ServerEmailEnvironment.getStartupWarning(reading),
    ServerEmailEnvironment.getIgnoredMessage(reading),
  ]);
}

function expectNoSecret(said: string): void {
  for (const secret of SECRETS) {
    expect(said).not.toContain(secret);
  }
}

// The columns a reading gives that hold something, as plain values.
function filled(settings: ServerEmailSettings | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [column, value] of Object.entries(settings || {})) {
    if (value === undefined) {
      continue;
    }

    out[column] =
      value instanceof Hostname ||
      value instanceof Port ||
      value instanceof Email
        ? value.toString()
        : value;
  }

  return out;
}

describe("the variables", () => {
  test("are twenty-five GLOBAL_EMAIL_ names, the switch first, each once", () => {
    expect(SERVER_EMAIL_ENVIRONMENT_VARIABLES[0]).toBe(
      "GLOBAL_EMAIL_SERVER_TYPE",
    );
    expect(SERVER_EMAIL_ENVIRONMENT_VARIABLES).toHaveLength(25);
    expect(new Set(SERVER_EMAIL_ENVIRONMENT_VARIABLES).size).toBe(25);
    expect([...SERVER_EMAIL_ENVIRONMENT_VARIABLES].sort()).toEqual(
      [...Object.values(ServerEmailEnvironmentVariable)].sort(),
    );

    for (const variable of SERVER_EMAIL_ENVIRONMENT_VARIABLES) {
      expect(variable).toMatch(/^GLOBAL_EMAIL_[A-Z0-9_]+$/);
    }
  });

  test("the passwords and keys are the seven that hold one", () => {
    expect([...SERVER_EMAIL_SECRET_VARIABLES].sort()).toEqual(
      [
        "GLOBAL_EMAIL_AMAZON_SES_SECRET_ACCESS_KEY",
        "GLOBAL_EMAIL_MAILGUN_API_KEY",
        "GLOBAL_EMAIL_POSTMARK_SERVER_TOKEN",
        "GLOBAL_EMAIL_RESEND_API_KEY",
        "GLOBAL_EMAIL_SENDGRID_API_KEY",
        "GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_SECRET",
        "GLOBAL_EMAIL_SMTP_PASSWORD",
      ].sort(),
    );
  });

  test("are new names: the legacy import's SMTP_ and SENDGRID_ variables are not read", () => {
    const reading: ServerEmailEnvironmentReading = read({
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
      SMTP_USERNAME: "mailer",
      SMTP_PASSWORD: SMTP_PASSWORD,
      SMTP_IS_SECURE: "true",
      SMTP_FROM_EMAIL: "alerts@example.com",
      SMTP_EMAIL: "alerts@example.com",
      SMTP_FROM_NAME: "Alerts",
      SENDGRID_API_KEY: SENDGRID_KEY,
    });

    expect(reading).toEqual({
      isSet: false,
      serverType: null,
      settings: null,
      problems: [],
      ignored: [],
      values: {},
    });
  });

  test("nothing set: not set, and nothing to say", () => {
    const reading: ServerEmailEnvironmentReading = read({});

    expect(reading.isSet).toBe(false);
    expect(ServerEmailEnvironment.isUsable(reading)).toBe(false);
    expect(ServerEmailEnvironment.getStartupNotice(reading)).toBeNull();
    expect(ServerEmailEnvironment.getStartupWarning(reading)).toBeNull();
    expect(ServerEmailEnvironment.toAnswer(reading)).toEqual({
      isSetByEnvironment: false,
      serverType: null,
      fields: [],
      problems: [],
      ignored: [],
    });
  });

  test("the Admin Dashboard asks for them at one route", () => {
    expect(SERVER_EMAIL_ENVIRONMENT_ROUTE).toBe(
      "/global-config/email-environment",
    );
  });

  test("the refusal of a write names the switch and where the settings are changed", () => {
    expect(SERVER_EMAIL_SET_BY_ENVIRONMENT_MESSAGE).toContain(
      "GLOBAL_EMAIL_SERVER_TYPE",
    );
    expect(SERVER_EMAIL_SET_BY_ENVIRONMENT_MESSAGE).toContain(
      "email in the Helm chart's values",
    );
    expect(SERVER_EMAIL_SET_BY_ENVIRONMENT_MESSAGE).toContain("config.env");
    expect(SERVER_EMAIL_SET_BY_ENVIRONMENT_MESSAGE).toContain(
      "restart OneUptime",
    );
  });

  test("they stand in for the columns of the server's email settings, and only those", () => {
    expect(new Set(SERVER_EMAIL_COLUMNS).size).toBe(
      SERVER_EMAIL_COLUMNS.length,
    );

    for (const [, values] of COMPLETE) {
      const settings: ServerEmailSettings = read(values).settings!;

      for (const column of Object.keys(settings)) {
        expect(SERVER_EMAIL_COLUMNS).toContain(column);
      }

      // A column left empty is not there at all, rather than there as nothing.
      for (const value of Object.values(settings)) {
        expect(value).not.toBeUndefined();
        expect(value).not.toBe("");
      }
    }
  });
});

describe("GLOBAL_EMAIL_SERVER_TYPE", () => {
  test("is written custom-smtp, sendgrid, amazon-ses, mailgun, postmark or resend, one for each type", () => {
    expect(SERVER_EMAIL_SERVER_TYPE_VALUES).toEqual({
      [EmailServerType.CustomSMTP]: "custom-smtp",
      [EmailServerType.Sendgrid]: "sendgrid",
      [EmailServerType.AmazonSES]: "amazon-ses",
      [EmailServerType.Mailgun]: "mailgun",
      [EmailServerType.Postmark]: "postmark",
      [EmailServerType.Resend]: "resend",
    });

    for (const type of Object.values(EmailServerType)) {
      expect(
        ServerEmailEnvironment.readServerType(
          SERVER_EMAIL_SERVER_TYPE_VALUES[type],
        ),
      ).toBe(type);
    }
  });

  test.each([
    ["Custom SMTP", EmailServerType.CustomSMTP],
    ["custom_smtp", EmailServerType.CustomSMTP],
    ["CUSTOM-SMTP", EmailServerType.CustomSMTP],
    ["smtp", EmailServerType.CustomSMTP],
    ["SMTP", EmailServerType.CustomSMTP],
    ["Sendgrid", EmailServerType.Sendgrid],
    ["SendGrid", EmailServerType.Sendgrid],
    ["Amazon SES", EmailServerType.AmazonSES],
    ["amazon_ses", EmailServerType.AmazonSES],
    ["AmazonSES", EmailServerType.AmazonSES],
    ["Mailgun", EmailServerType.Mailgun],
    ["POSTMARK", EmailServerType.Postmark],
    ["  resend \n", EmailServerType.Resend],
  ])(
    "takes the Admin Dashboard's own words too: %p",
    (written: string, type: EmailServerType) => {
      expect(ServerEmailEnvironment.readServerType(written)).toBe(type);
      expect(read(sendgrid({ [V.ServerType]: written })).serverType).toBe(type);
    },
  );

  test("a type that is not one sends nothing, and says which values it takes", () => {
    const reading: ServerEmailEnvironmentReading = read(
      sendgrid({ [V.ServerType]: "gmail" }),
    );

    expect(reading.isSet).toBe(true);
    expect(reading.serverType).toBeNull();
    expect(reading.settings).toBeNull();
    expect(ServerEmailEnvironment.isUsable(reading)).toBe(false);
    expect(reading.problems).toEqual([
      'GLOBAL_EMAIL_SERVER_TYPE must be custom-smtp, sendgrid, amazon-ses, mailgun, postmark or resend, not "gmail".',
    ]);
  });

  test("a long value is cut where it is quoted", () => {
    const written: string = "x".repeat(500);
    const problem: string = problemsOf(
      sendgrid({ [V.ServerType]: written }),
    )[0]!;

    expect(problem).toContain(REFUSED_VALUE_CUT_MARK);
    expect(problem).not.toContain(written);
    expect(problem.length).toBeLessThan(MAX_REFUSED_VALUE_LENGTH + 200);
  });

  test("whitespace alone is not set", () => {
    expect(read(sendgrid({ [V.ServerType]: "  \n" })).isSet).toBe(false);
  });
});

describe("complete settings, for every type", () => {
  test.each(COMPLETE)(
    "%s: usable, nothing to say but that the variables set it",
    (_name: string, values: Values) => {
      const reading: ServerEmailEnvironmentReading = read(values);

      expect(reading.problems).toEqual([]);
      expect(reading.ignored).toEqual([]);
      expect(ServerEmailEnvironment.isUsable(reading)).toBe(true);
      expect(ServerEmailEnvironment.getStartupNotice(reading)).toBe(
        "The server's email settings are set by environment variables (GLOBAL_EMAIL_SERVER_TYPE and the other GLOBAL_EMAIL_ variables): the settings saved in the Admin Dashboard are not used.",
      );
      expect(ServerEmailEnvironment.getStartupWarning(reading)).toBeNull();
      expectNoSecret(everythingSaid(reading));
    },
  );

  test("Custom SMTP: the mail server, signed in to with its username and password", () => {
    expect(filled(read(smtp()).settings)).toEqual({
      emailServerType: EmailServerType.CustomSMTP,
      smtpTransportType: MailTransportType.SMTP,
      smtpHost: "smtp.example.com",
      smtpPort: "587",
      isSMTPSecure: false,
      smtpAuthType: SMTPAuthenticationType.UsernamePassword,
      smtpUsername: "mailer@example.com",
      smtpPassword: SMTP_PASSWORD,
      smtpFromEmail: "alerts@example.com",
      smtpFromName: "Example Alerts",
    });

    const settings: ServerEmailSettings = read(smtp()).settings!;

    expect(settings.smtpHost).toBeInstanceOf(Hostname);
    expect(settings.smtpPort).toBeInstanceOf(Port);
    expect(settings.smtpFromEmail).toBeInstanceOf(Email);
  });

  test("Custom SMTP: Require TLS true or false, in any case", () => {
    for (const [written, secure] of [
      ["true", true],
      ["TRUE", true],
      ["false", false],
      ["False", false],
      ["", false],
    ] as Array<[string, boolean]>) {
      expect(
        read(smtp({ [V.SmtpRequireTls]: written })).settings!.isSMTPSecure,
      ).toBe(secure);
    }
  });

  test("Custom SMTP without signing in: no username or password", () => {
    const settings: ServerEmailSettings = read(
      smtp({
        [V.SmtpAuthType]: "none",
        [V.SmtpUsername]: undefined,
        [V.SmtpPassword]: undefined,
      }),
    ).settings!;

    expect(settings.smtpAuthType).toBe(SMTPAuthenticationType.None);
    expect(settings.smtpUsername).toBeUndefined();
    expect(settings.smtpPassword).toBeUndefined();
  });

  test("Custom SMTP signing in with neither a username nor a password, as the Admin Dashboard allows", () => {
    const reading: ServerEmailEnvironmentReading = read(
      smtp({ [V.SmtpUsername]: undefined, [V.SmtpPassword]: undefined }),
    );

    expect(reading.problems).toEqual([]);
    expect(reading.settings!.smtpAuthType).toBe(
      SMTPAuthenticationType.UsernamePassword,
    );
  });

  test("Custom SMTP with OAuth: the app's credentials, Client Credentials when no provider type is named", () => {
    expect(filled(read(smtpOAuth()).settings)).toEqual({
      emailServerType: EmailServerType.CustomSMTP,
      smtpTransportType: MailTransportType.SMTP,
      smtpHost: "smtp.office365.com",
      smtpPort: "587",
      isSMTPSecure: false,
      smtpAuthType: SMTPAuthenticationType.OAuth,
      smtpUsername: "alerts@example.com",
      smtpClientId: "smtp-client-id",
      smtpClientSecret: CLIENT_SECRET,
      smtpTokenUrl:
        "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
      smtpScope: "https://outlook.office365.com/.default",
      smtpFromEmail: "alerts@example.com",
      smtpFromName: "Example Alerts",
    });

    expect(
      read(smtpOAuth({ [V.SmtpOAuthProviderType]: "Client Credentials" }))
        .settings!.smtpOAuthProviderType,
    ).toBe(OAuthProviderType.ClientCredentials);
  });

  test("Custom SMTP with JWT Bearer: the mailbox it signs in as, and the private key", () => {
    const settings: ServerEmailSettings = read(
      smtpOAuth({
        [V.SmtpOAuthProviderType]: "jwt-bearer",
        [V.SmtpUsername]: "alerts@example.com",
        [V.SmtpOAuthClientSecret]: PEM_KEY,
      }),
    ).settings!;

    expect(settings.smtpOAuthProviderType).toBe(OAuthProviderType.JWTBearer);
    expect(settings.smtpUsername).toBe("alerts@example.com");
    expect(settings.smtpClientSecret).toBe(PEM_KEY);
  });

  test("Microsoft Graph: the app's credentials, and no mail server", () => {
    expect(filled(read(graph()).settings)).toEqual({
      emailServerType: EmailServerType.CustomSMTP,
      smtpTransportType: MailTransportType.MicrosoftGraph,
      smtpClientId: "graph-client-id",
      smtpClientSecret: CLIENT_SECRET,
      smtpTokenUrl:
        "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
      smtpScope: "https://graph.microsoft.com/.default",
      smtpFromEmail: "alerts@example.com",
      smtpFromName: "Example Alerts",
    });
  });

  test("SendGrid: the key and the sender, nothing else", () => {
    expect(filled(read(sendgrid()).settings)).toEqual({
      emailServerType: EmailServerType.Sendgrid,
      sendgridApiKey: SENDGRID_KEY,
      sendgridFromEmail: "alerts@example.com",
      sendgridFromName: "Example Alerts",
    });
  });

  test("Amazon SES with an access key", () => {
    expect(filled(read(ses()).settings)).toEqual({
      emailServerType: EmailServerType.AmazonSES,
      amazonSesAuthenticationType: AmazonSesAuthenticationType.AccessKey,
      amazonSesAccessKeyId: "AKIAEXAMPLE7738",
      amazonSesSecretAccessKey: SES_SECRET,
      amazonSesRegion: "us-east-1",
      amazonSesFromEmail: "alerts@example.com",
      amazonSesFromName: "Example Alerts",
    });
  });

  test("Amazon SES with the server's IAM role: no key at all (#7000)", () => {
    expect(
      filled(
        read(
          ses({
            [V.AmazonSesAuthenticationType]: "server-iam-role",
            [V.AmazonSesAccessKeyId]: undefined,
            [V.AmazonSesSecretAccessKey]: undefined,
            [V.AmazonSesRegion]: "EU-WEST-1",
          }),
        ).settings,
      ),
    ).toEqual({
      emailServerType: EmailServerType.AmazonSES,
      amazonSesAuthenticationType: AmazonSesAuthenticationType.ServerIamRole,
      amazonSesRegion: "eu-west-1",
      amazonSesFromEmail: "alerts@example.com",
      amazonSesFromName: "Example Alerts",
    });

    expect(
      read(
        ses({
          [V.AmazonSesAuthenticationType]: "Server IAM Role",
          [V.AmazonSesAccessKeyId]: undefined,
          [V.AmazonSesSecretAccessKey]: undefined,
        }),
      ).problems,
    ).toEqual([]);
  });

  test("Mailgun: US unless EU", () => {
    expect(filled(read(mailgun()).settings)).toEqual({
      emailServerType: EmailServerType.Mailgun,
      mailgunApiKey: MAILGUN_KEY,
      mailgunDomain: "mg.example.com",
      mailgunRegion: MailgunRegion.US,
      mailgunFromEmail: "alerts@example.com",
      mailgunFromName: "Example Alerts",
    });
    expect(
      read(mailgun({ [V.MailgunRegion]: "EU" })).settings!.mailgunRegion,
    ).toBe(MailgunRegion.EU);
  });

  test("Postmark and Resend: the token or key, and the sender", () => {
    expect(filled(read(postmark()).settings)).toEqual({
      emailServerType: EmailServerType.Postmark,
      postmarkServerToken: POSTMARK_TOKEN,
      postmarkFromEmail: "alerts@example.com",
      postmarkFromName: "Example Alerts",
    });
    expect(filled(read(resend()).settings)).toEqual({
      emailServerType: EmailServerType.Resend,
      resendApiKey: RESEND_KEY,
      resendFromEmail: "alerts@example.com",
      resendFromName: "Example Alerts",
    });
  });

  test("the providers with an API of their own send with the product's name when no From Name is set", () => {
    for (const values of [ses(), mailgun(), postmark(), resend()]) {
      const reading: ServerEmailEnvironmentReading = read({
        ...values,
        [V.FromName]: undefined,
      });

      expect(reading.problems).toEqual([]);
    }
  });

  test("each value is read without the whitespace around it: a key from a file keeps its final newline", () => {
    const settings: ServerEmailSettings = read(
      sendgrid({
        [V.SendgridApiKey]: `${SENDGRID_KEY}\n`,
        [V.FromEmail]: "  alerts@example.com ",
        [V.FromName]: " Example Alerts\n",
      }),
    ).settings!;

    expect(settings.sendgridApiKey).toBe(SENDGRID_KEY);
    expect(settings.sendgridFromEmail!.toString()).toBe("alerts@example.com");
    expect(settings.sendgridFromName).toBe("Example Alerts");
  });
});

describe("what is wrong, by the variable's name", () => {
  test.each([
    [
      "no From Email",
      sendgrid({ [V.FromEmail]: undefined }),
      [
        "GLOBAL_EMAIL_FROM_EMAIL is not set: every email needs the address it comes from.",
      ],
    ],
    [
      "a From Email that is not one",
      postmark({ [V.FromEmail]: "alerts at example" }),
      ['GLOBAL_EMAIL_FROM_EMAIL: "alerts at example" is not an email address.'],
    ],
    [
      "Custom SMTP without a From Name",
      smtp({ [V.FromName]: undefined }),
      [
        "GLOBAL_EMAIL_FROM_NAME is not set: custom-smtp sends every email with the name it comes from.",
      ],
    ],
    [
      "SendGrid without a From Name",
      sendgrid({ [V.FromName]: "" }),
      [
        "GLOBAL_EMAIL_FROM_NAME is not set: sendgrid sends every email with the name it comes from.",
      ],
    ],
    [
      "no SMTP host",
      smtp({ [V.SmtpHost]: undefined }),
      [
        "GLOBAL_EMAIL_SMTP_HOST is not set: email goes out through that mail server, such as smtp.example.com.",
      ],
    ],
    [
      "an SMTP host with its port",
      smtp({ [V.SmtpHost]: "smtp.example.com:587" }),
      [
        'GLOBAL_EMAIL_SMTP_HOST: "smtp.example.com:587" is not a host name, such as smtp.example.com. The port goes in GLOBAL_EMAIL_SMTP_PORT.',
      ],
    ],
    [
      "an SMTP host that is a URL",
      smtp({ [V.SmtpHost]: "smtp://smtp.example.com" }),
      [
        'GLOBAL_EMAIL_SMTP_HOST: "smtp://smtp.example.com" is not a host name, such as smtp.example.com. The port goes in GLOBAL_EMAIL_SMTP_PORT.',
      ],
    ],
    [
      "no SMTP port",
      smtp({ [V.SmtpPort]: undefined }),
      ["GLOBAL_EMAIL_SMTP_PORT is not set: most mail servers take 587."],
    ],
    [
      "an SMTP port that is not a number",
      smtp({ [V.SmtpPort]: "submission" }),
      [
        'GLOBAL_EMAIL_SMTP_PORT: "submission" is not a port, a number from 1 to 65535 such as 587.',
      ],
    ],
    [
      "an SMTP port past the last",
      smtp({ [V.SmtpPort]: "65536" }),
      [
        'GLOBAL_EMAIL_SMTP_PORT: "65536" is not a port, a number from 1 to 65535 such as 587.',
      ],
    ],
    [
      "SMTP port 0",
      smtp({ [V.SmtpPort]: "0" }),
      [
        'GLOBAL_EMAIL_SMTP_PORT: "0" is not a port, a number from 1 to 65535 such as 587.',
      ],
    ],
    [
      "Require TLS that is not true or false",
      smtp({ [V.SmtpRequireTls]: "yes" }),
      ['GLOBAL_EMAIL_SMTP_REQUIRE_TLS must be true or false, not "yes".'],
    ],
    [
      "a transport that is not one",
      smtp({ [V.SmtpTransport]: "pigeon" }),
      [
        'GLOBAL_EMAIL_SMTP_TRANSPORT must be smtp or microsoft-graph, not "pigeon".',
      ],
    ],
    [
      "an authentication type that is not one",
      smtp({ [V.SmtpAuthType]: "kerberos" }),
      [
        'GLOBAL_EMAIL_SMTP_AUTH_TYPE must be username-and-password, oauth or none, not "kerberos".',
      ],
    ],
    [
      "a username without its password",
      smtp({ [V.SmtpPassword]: undefined }),
      [
        "GLOBAL_EMAIL_SMTP_PASSWORD is not set: the mail server is signed in to with GLOBAL_EMAIL_SMTP_USERNAME and a password. Set it, or set GLOBAL_EMAIL_SMTP_AUTH_TYPE to none to send without signing in.",
      ],
    ],
    [
      "a password without its username",
      smtp({ [V.SmtpUsername]: undefined }),
      [
        "GLOBAL_EMAIL_SMTP_USERNAME is not set: the mail server is signed in to with a username and GLOBAL_EMAIL_SMTP_PASSWORD.",
      ],
    ],
    [
      "an OAuth provider type that is not one",
      smtpOAuth({ [V.SmtpOAuthProviderType]: "device-code" }),
      [
        'GLOBAL_EMAIL_SMTP_OAUTH_PROVIDER_TYPE must be client-credentials or jwt-bearer, not "device-code".',
      ],
    ],
    [
      "JWT Bearer without the mailbox it signs in as",
      smtpOAuth({
        [V.SmtpOAuthProviderType]: "jwt-bearer",
        [V.SmtpOAuthClientSecret]: PEM_KEY,
        [V.SmtpUsername]: undefined,
      }),
      [
        "GLOBAL_EMAIL_SMTP_USERNAME is not set: with GLOBAL_EMAIL_SMTP_AUTH_TYPE oauth, the mail server is signed in to as that mailbox, such as alerts@example.com.",
      ],
    ],
    /*
     * Client Credentials signs in as a mailbox too: the mail server's
     * XOAUTH2 sign-in names its user, and MailService refuses every email
     * without one - so the settings are not usable, rather than said to be
     * and then refuse each email.
     */
    [
      "Client Credentials without the mailbox it signs in as",
      smtpOAuth({ [V.SmtpUsername]: undefined }),
      [
        "GLOBAL_EMAIL_SMTP_USERNAME is not set: with GLOBAL_EMAIL_SMTP_AUTH_TYPE oauth, the mail server is signed in to as that mailbox, such as alerts@example.com.",
      ],
    ],
    [
      "OAuth, no provider type named, with a username of white space alone",
      smtpOAuth({ [V.SmtpUsername]: "   " }),
      [
        "GLOBAL_EMAIL_SMTP_USERNAME is not set: with GLOBAL_EMAIL_SMTP_AUTH_TYPE oauth, the mail server is signed in to as that mailbox, such as alerts@example.com.",
      ],
    ],
    [
      "JWT Bearer with a client secret that is not a private key",
      smtpOAuth({
        [V.SmtpOAuthProviderType]: "jwt-bearer",
        [V.SmtpUsername]: "alerts@example.com",
      }),
      [
        "GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_SECRET is not a private key in PEM format (-----BEGIN PRIVATE KEY-----), which jwt-bearer signs in with.",
      ],
    ],
    [
      "OAuth without its app",
      smtpOAuth({
        [V.SmtpOAuthClientId]: undefined,
        [V.SmtpOAuthClientSecret]: undefined,
        [V.SmtpOAuthTokenUrl]: undefined,
        [V.SmtpOAuthScope]: undefined,
      }),
      [
        "GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_ID is not set: the mail server is signed in to with an OAuth app's client ID, client secret, token URL and scope.",
        "GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_SECRET is not set: the mail server is signed in to with an OAuth app's client ID, client secret, token URL and scope.",
        "GLOBAL_EMAIL_SMTP_OAUTH_TOKEN_URL is not set: the mail server is signed in to with an OAuth app's client ID, client secret, token URL and scope.",
        "GLOBAL_EMAIL_SMTP_OAUTH_SCOPE is not set: the mail server is signed in to with an OAuth app's client ID, client secret, token URL and scope.",
      ],
    ],
    [
      "Microsoft Graph without its app's secret",
      graph({ [V.SmtpOAuthClientSecret]: "" }),
      [
        "GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_SECRET is not set: Microsoft Graph sends with an OAuth app's client ID, client secret, token URL and scope.",
      ],
    ],
    [
      "a token URL that is not one",
      graph({ [V.SmtpOAuthTokenUrl]: "login.microsoftonline.com/token" }),
      [
        'GLOBAL_EMAIL_SMTP_OAUTH_TOKEN_URL: "login.microsoftonline.com/token" is not a URL, such as https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token.',
      ],
    ],
    [
      "SendGrid without its key",
      sendgrid({ [V.SendgridApiKey]: undefined }),
      [
        "GLOBAL_EMAIL_SENDGRID_API_KEY is not set: SendGrid sends nothing without it.",
      ],
    ],
    [
      "Amazon SES without its access key",
      ses({
        [V.AmazonSesAccessKeyId]: undefined,
        [V.AmazonSesSecretAccessKey]: undefined,
      }),
      [
        "GLOBAL_EMAIL_AMAZON_SES_ACCESS_KEY_ID is not set: Amazon SES is signed in to with an access key, unless GLOBAL_EMAIL_AMAZON_SES_AUTHENTICATION_TYPE is server-iam-role.",
        "GLOBAL_EMAIL_AMAZON_SES_SECRET_ACCESS_KEY is not set: Amazon SES is signed in to with an access key, unless GLOBAL_EMAIL_AMAZON_SES_AUTHENTICATION_TYPE is server-iam-role.",
      ],
    ],
    [
      "Amazon SES signing in a way that is not one",
      ses({ [V.AmazonSesAuthenticationType]: "instance-profile" }),
      [
        'GLOBAL_EMAIL_AMAZON_SES_AUTHENTICATION_TYPE must be access-key or server-iam-role, not "instance-profile".',
      ],
    ],
    [
      "Amazon SES without a Region",
      ses({ [V.AmazonSesRegion]: undefined }),
      [
        "GLOBAL_EMAIL_AMAZON_SES_REGION is not set: Amazon SES sends from the Region your sender is verified in, such as us-east-1.",
      ],
    ],
    [
      "Amazon SES with a Region that is not one",
      ses({ [V.AmazonSesRegion]: "moon-1" }),
      [
        'GLOBAL_EMAIL_AMAZON_SES_REGION: "moon-1" is not an AWS Region code, such as us-east-1.',
      ],
    ],
    [
      "Mailgun without its key and domain",
      mailgun({ [V.MailgunApiKey]: undefined, [V.MailgunDomain]: undefined }),
      [
        "GLOBAL_EMAIL_MAILGUN_API_KEY is not set: Mailgun sends nothing without it.",
        "GLOBAL_EMAIL_MAILGUN_DOMAIN is not set: Mailgun sends from that domain, such as mg.example.com.",
      ],
    ],
    [
      "a Mailgun domain that is a path",
      mailgun({ [V.MailgunDomain]: "mg.example.com/../v3" }),
      [
        'GLOBAL_EMAIL_MAILGUN_DOMAIN: "mg.example.com/../v3" is not a domain, such as mg.example.com.',
      ],
    ],
    [
      "a Mailgun region that is not one",
      mailgun({ [V.MailgunRegion]: "asia" }),
      ['GLOBAL_EMAIL_MAILGUN_REGION must be us or eu, not "asia".'],
    ],
    [
      "Postmark without its token",
      postmark({ [V.PostmarkServerToken]: " " }),
      [
        "GLOBAL_EMAIL_POSTMARK_SERVER_TOKEN is not set: Postmark sends nothing without the server's API token.",
      ],
    ],
    [
      "Resend without its key",
      resend({ [V.ResendApiKey]: undefined }),
      [
        "GLOBAL_EMAIL_RESEND_API_KEY is not set: Resend sends nothing without it.",
      ],
    ],
  ] as Array<[string, Values, Array<string>]>)(
    "%s: said, and nothing is sent",
    (_name: string, values: Values, problems: Array<string>) => {
      const reading: ServerEmailEnvironmentReading = read(values);

      expect(reading.problems).toEqual(problems);
      expect(reading.isSet).toBe(true);
      expect(ServerEmailEnvironment.isUsable(reading)).toBe(false);
      expect(ServerEmailEnvironment.getStartupWarning(reading)).toBe(
        `The email settings set by environment variables send no email until this is fixed: ${problems.join(" ")}`,
      );
      expectNoSecret(everythingSaid(reading));
    },
  );

  test("every problem at once is said in the variables' own order", () => {
    const problems: Array<string> = problemsOf({
      [V.ServerType]: "custom-smtp",
      [V.FromEmail]: "not an address",
      [V.SmtpHost]: "smtp.example.com:25",
      [V.SmtpPort]: "x",
      [V.SmtpAuthType]: "oauth",
      [V.SmtpOAuthProviderType]: "jwt-bearer",
      [V.SmtpOAuthClientSecret]: "not a key",
    });

    const variables: Array<string> = problems.map((problem: string) => {
      return problem.split(/[ :]/)[0]!;
    });

    expect(variables).toEqual([
      "GLOBAL_EMAIL_FROM_EMAIL",
      "GLOBAL_EMAIL_FROM_NAME",
      "GLOBAL_EMAIL_SMTP_HOST",
      "GLOBAL_EMAIL_SMTP_PORT",
      "GLOBAL_EMAIL_SMTP_USERNAME",
      "GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_ID",
      "GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_SECRET",
      "GLOBAL_EMAIL_SMTP_OAUTH_TOKEN_URL",
      "GLOBAL_EMAIL_SMTP_OAUTH_SCOPE",
    ]);
  });

  test("a secret that is wrongly shaped is never quoted", () => {
    const reading: ServerEmailEnvironmentReading = read(
      smtpOAuth({
        [V.SmtpOAuthProviderType]: "jwt-bearer",
        [V.SmtpUsername]: "alerts@example.com",
        [V.SmtpOAuthClientSecret]: CLIENT_SECRET,
      }),
    );

    expect(reading.problems).toHaveLength(1);
    expectNoSecret(everythingSaid(reading));
  });
});

describe("variables the chosen settings do not read", () => {
  test.each([
    [
      "an SMTP host with SendGrid",
      sendgrid({ [V.SmtpHost]: "smtp.example.com" }),
      ["GLOBAL_EMAIL_SMTP_HOST"],
    ],
    [
      "a mail server with Microsoft Graph",
      graph({
        [V.SmtpHost]: "smtp.example.com",
        [V.SmtpPort]: "587",
        [V.SmtpPassword]: SMTP_PASSWORD,
      }),
      [
        "GLOBAL_EMAIL_SMTP_HOST",
        "GLOBAL_EMAIL_SMTP_PORT",
        "GLOBAL_EMAIL_SMTP_PASSWORD",
      ],
    ],
    [
      "a username and password while signing in with none",
      smtp({ [V.SmtpAuthType]: "none" }),
      ["GLOBAL_EMAIL_SMTP_USERNAME", "GLOBAL_EMAIL_SMTP_PASSWORD"],
    ],
    [
      "a password while signing in with OAuth",
      smtpOAuth({ [V.SmtpPassword]: SMTP_PASSWORD }),
      ["GLOBAL_EMAIL_SMTP_PASSWORD"],
    ],
    [
      "OAuth credentials while signing in with a password",
      smtp({ [V.SmtpOAuthClientId]: "client" }),
      ["GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_ID"],
    ],
    [
      "an access key with the server's IAM role",
      ses({ [V.AmazonSesAuthenticationType]: "server-iam-role" }),
      [
        "GLOBAL_EMAIL_AMAZON_SES_ACCESS_KEY_ID",
        "GLOBAL_EMAIL_AMAZON_SES_SECRET_ACCESS_KEY",
      ],
    ],
    [
      "every other provider's key with Resend",
      resend({
        [V.SendgridApiKey]: SENDGRID_KEY,
        [V.MailgunApiKey]: MAILGUN_KEY,
        [V.PostmarkServerToken]: POSTMARK_TOKEN,
      }),
      [
        "GLOBAL_EMAIL_SENDGRID_API_KEY",
        "GLOBAL_EMAIL_MAILGUN_API_KEY",
        "GLOBAL_EMAIL_POSTMARK_SERVER_TOKEN",
      ],
    ],
  ] as Array<[string, Values, Array<string>]>)(
    "%s: named, and nothing stops sending",
    (_name: string, values: Values, ignored: Array<string>) => {
      const reading: ServerEmailEnvironmentReading = read(values);

      expect(reading.ignored).toEqual(ignored);
      expect(reading.problems).toEqual([]);
      expect(ServerEmailEnvironment.isUsable(reading)).toBe(true);

      const message: string =
        ServerEmailEnvironment.getIgnoredMessage(reading)!;

      for (const variable of ignored) {
        expect(message).toContain(variable);
      }

      expect(ServerEmailEnvironment.getStartupWarning(reading)).toBe(message);
      expectNoSecret(everythingSaid(reading));
    },
  );

  test("one is said as one, several as several", () => {
    expect(
      ServerEmailEnvironment.getIgnoredMessage(
        read(sendgrid({ [V.SmtpHost]: "smtp.example.com" })),
      ),
    ).toBe(
      "GLOBAL_EMAIL_SMTP_HOST is set, but the email settings the GLOBAL_EMAIL_ variables describe do not read it, so it changes nothing. Remove it, or check GLOBAL_EMAIL_SERVER_TYPE and the variables that pick how email is sent.",
    );
    expect(
      ServerEmailEnvironment.getIgnoredMessage(
        read(
          sendgrid({
            [V.SmtpHost]: "smtp.example.com",
            [V.SmtpPort]: "25",
          }),
        ),
      ),
    ).toBe(
      "GLOBAL_EMAIL_SMTP_HOST and GLOBAL_EMAIL_SMTP_PORT are set, but the email settings the GLOBAL_EMAIL_ variables describe do not read them, so they change nothing. Remove them, or check GLOBAL_EMAIL_SERVER_TYPE and the variables that pick how email is sent.",
    );
  });

  test("they are named after the problems when there are both", () => {
    const reading: ServerEmailEnvironmentReading = read(
      sendgrid({ [V.SendgridApiKey]: undefined, [V.SmtpHost]: "smtp" }),
    );

    expect(ServerEmailEnvironment.getStartupWarning(reading)).toBe(
      `The email settings set by environment variables send no email until this is fixed: ${reading.problems.join(" ")} ${ServerEmailEnvironment.getIgnoredMessage(reading)}`,
    );
  });
});

describe("variables set without GLOBAL_EMAIL_SERVER_TYPE", () => {
  test("are read by nothing: the saved settings send, and the variables are named", () => {
    const reading: ServerEmailEnvironmentReading = read({
      [V.SmtpHost]: "smtp.example.com",
      [V.SmtpPassword]: SMTP_PASSWORD,
      [V.FromEmail]: "alerts@example.com",
    });

    expect(reading.isSet).toBe(false);
    expect(reading.settings).toBeNull();
    expect(reading.problems).toEqual([
      "GLOBAL_EMAIL_FROM_EMAIL, GLOBAL_EMAIL_SMTP_HOST and GLOBAL_EMAIL_SMTP_PASSWORD are set, but GLOBAL_EMAIL_SERVER_TYPE is not, so nothing reads them: the email settings saved in the Admin Dashboard are used. Set GLOBAL_EMAIL_SERVER_TYPE too, or remove them.",
    ]);
    expect(ServerEmailEnvironment.getStartupNotice(reading)).toBeNull();
    expect(ServerEmailEnvironment.getStartupWarning(reading)).toBe(
      reading.problems[0],
    );
    expect(ServerEmailEnvironment.toAnswer(reading)).toEqual({
      isSetByEnvironment: false,
      serverType: null,
      fields: [],
      problems: reading.problems,
      ignored: [],
    });
    expectNoSecret(everythingSaid(reading));
  });

  test("one variable is said as one", () => {
    expect(problemsOf({ [V.SendgridApiKey]: SENDGRID_KEY })).toEqual([
      "GLOBAL_EMAIL_SENDGRID_API_KEY is set, but GLOBAL_EMAIL_SERVER_TYPE is not, so nothing reads it: the email settings saved in the Admin Dashboard are used. Set GLOBAL_EMAIL_SERVER_TYPE too, or remove it.",
    ]);
  });
});

describe("what the Admin Dashboard is told", () => {
  function fieldsOf(values: Values): Array<ServerEmailEnvironmentField> {
    return ServerEmailEnvironment.toAnswer(read(values)).fields;
  }

  function variablesOf(values: Values): Array<string> {
    return fieldsOf(values).map((field: ServerEmailEnvironmentField) => {
      return field.variable;
    });
  }

  test("the variables each type reads, the type first and the sender last", () => {
    expect(variablesOf(smtp())).toEqual([
      "GLOBAL_EMAIL_SERVER_TYPE",
      "GLOBAL_EMAIL_SMTP_TRANSPORT",
      "GLOBAL_EMAIL_SMTP_HOST",
      "GLOBAL_EMAIL_SMTP_PORT",
      "GLOBAL_EMAIL_SMTP_REQUIRE_TLS",
      "GLOBAL_EMAIL_SMTP_AUTH_TYPE",
      "GLOBAL_EMAIL_SMTP_USERNAME",
      "GLOBAL_EMAIL_SMTP_PASSWORD",
      "GLOBAL_EMAIL_FROM_EMAIL",
      "GLOBAL_EMAIL_FROM_NAME",
    ]);
    expect(variablesOf(smtp({ [V.SmtpAuthType]: "none" }))).toEqual([
      "GLOBAL_EMAIL_SERVER_TYPE",
      "GLOBAL_EMAIL_SMTP_TRANSPORT",
      "GLOBAL_EMAIL_SMTP_HOST",
      "GLOBAL_EMAIL_SMTP_PORT",
      "GLOBAL_EMAIL_SMTP_REQUIRE_TLS",
      "GLOBAL_EMAIL_SMTP_AUTH_TYPE",
      "GLOBAL_EMAIL_FROM_EMAIL",
      "GLOBAL_EMAIL_FROM_NAME",
    ]);
    expect(variablesOf(smtpOAuth())).toEqual([
      "GLOBAL_EMAIL_SERVER_TYPE",
      "GLOBAL_EMAIL_SMTP_TRANSPORT",
      "GLOBAL_EMAIL_SMTP_HOST",
      "GLOBAL_EMAIL_SMTP_PORT",
      "GLOBAL_EMAIL_SMTP_REQUIRE_TLS",
      "GLOBAL_EMAIL_SMTP_AUTH_TYPE",
      "GLOBAL_EMAIL_SMTP_USERNAME",
      "GLOBAL_EMAIL_SMTP_OAUTH_PROVIDER_TYPE",
      "GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_ID",
      "GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_SECRET",
      "GLOBAL_EMAIL_SMTP_OAUTH_TOKEN_URL",
      "GLOBAL_EMAIL_SMTP_OAUTH_SCOPE",
      "GLOBAL_EMAIL_FROM_EMAIL",
      "GLOBAL_EMAIL_FROM_NAME",
    ]);
    expect(variablesOf(graph())).toEqual([
      "GLOBAL_EMAIL_SERVER_TYPE",
      "GLOBAL_EMAIL_SMTP_TRANSPORT",
      "GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_ID",
      "GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_SECRET",
      "GLOBAL_EMAIL_SMTP_OAUTH_TOKEN_URL",
      "GLOBAL_EMAIL_SMTP_OAUTH_SCOPE",
      "GLOBAL_EMAIL_FROM_EMAIL",
      "GLOBAL_EMAIL_FROM_NAME",
    ]);
    expect(variablesOf(sendgrid())).toEqual([
      "GLOBAL_EMAIL_SERVER_TYPE",
      "GLOBAL_EMAIL_SENDGRID_API_KEY",
      "GLOBAL_EMAIL_FROM_EMAIL",
      "GLOBAL_EMAIL_FROM_NAME",
    ]);
    expect(variablesOf(ses())).toEqual([
      "GLOBAL_EMAIL_SERVER_TYPE",
      "GLOBAL_EMAIL_AMAZON_SES_AUTHENTICATION_TYPE",
      "GLOBAL_EMAIL_AMAZON_SES_ACCESS_KEY_ID",
      "GLOBAL_EMAIL_AMAZON_SES_SECRET_ACCESS_KEY",
      "GLOBAL_EMAIL_AMAZON_SES_REGION",
      "GLOBAL_EMAIL_FROM_EMAIL",
      "GLOBAL_EMAIL_FROM_NAME",
    ]);
    expect(
      variablesOf(ses({ [V.AmazonSesAuthenticationType]: "server-iam-role" })),
    ).toEqual([
      "GLOBAL_EMAIL_SERVER_TYPE",
      "GLOBAL_EMAIL_AMAZON_SES_AUTHENTICATION_TYPE",
      "GLOBAL_EMAIL_AMAZON_SES_REGION",
      "GLOBAL_EMAIL_FROM_EMAIL",
      "GLOBAL_EMAIL_FROM_NAME",
    ]);
    expect(variablesOf(mailgun())).toEqual([
      "GLOBAL_EMAIL_SERVER_TYPE",
      "GLOBAL_EMAIL_MAILGUN_API_KEY",
      "GLOBAL_EMAIL_MAILGUN_DOMAIN",
      "GLOBAL_EMAIL_MAILGUN_REGION",
      "GLOBAL_EMAIL_FROM_EMAIL",
      "GLOBAL_EMAIL_FROM_NAME",
    ]);
    expect(variablesOf(postmark())).toEqual([
      "GLOBAL_EMAIL_SERVER_TYPE",
      "GLOBAL_EMAIL_POSTMARK_SERVER_TOKEN",
      "GLOBAL_EMAIL_FROM_EMAIL",
      "GLOBAL_EMAIL_FROM_NAME",
    ]);
    expect(variablesOf(resend())).toEqual([
      "GLOBAL_EMAIL_SERVER_TYPE",
      "GLOBAL_EMAIL_RESEND_API_KEY",
      "GLOBAL_EMAIL_FROM_EMAIL",
      "GLOBAL_EMAIL_FROM_NAME",
    ]);
  });

  test("each value as written, and never a password or a key: only whether it is set", () => {
    const answer: ServerEmailEnvironmentAnswer =
      ServerEmailEnvironment.toAnswer(
        read(smtp({ [V.SmtpRequireTls]: "true" })),
      );

    expect(answer.isSetByEnvironment).toBe(true);
    expect(answer.serverType).toBe(EmailServerType.CustomSMTP);
    expect(answer.fields).toEqual([
      {
        variable: "GLOBAL_EMAIL_SERVER_TYPE",
        value: "custom-smtp",
        isSecret: false,
        isSet: true,
      },
      {
        variable: "GLOBAL_EMAIL_SMTP_TRANSPORT",
        value: null,
        isSecret: false,
        isSet: false,
      },
      {
        variable: "GLOBAL_EMAIL_SMTP_HOST",
        value: "smtp.example.com",
        isSecret: false,
        isSet: true,
      },
      {
        variable: "GLOBAL_EMAIL_SMTP_PORT",
        value: "587",
        isSecret: false,
        isSet: true,
      },
      {
        variable: "GLOBAL_EMAIL_SMTP_REQUIRE_TLS",
        value: "true",
        isSecret: false,
        isSet: true,
      },
      {
        variable: "GLOBAL_EMAIL_SMTP_AUTH_TYPE",
        value: null,
        isSecret: false,
        isSet: false,
      },
      {
        variable: "GLOBAL_EMAIL_SMTP_USERNAME",
        value: "mailer@example.com",
        isSecret: false,
        isSet: true,
      },
      {
        variable: "GLOBAL_EMAIL_SMTP_PASSWORD",
        value: null,
        isSecret: true,
        isSet: true,
      },
      {
        variable: "GLOBAL_EMAIL_FROM_EMAIL",
        value: "alerts@example.com",
        isSecret: false,
        isSet: true,
      },
      {
        variable: "GLOBAL_EMAIL_FROM_NAME",
        value: "Example Alerts",
        isSecret: false,
        isSet: true,
      },
    ]);
  });

  test.each(COMPLETE)(
    "%s: the answer, as sent, holds no password or key",
    (_name: string, values: Values) => {
      const answer: ServerEmailEnvironmentAnswer =
        ServerEmailEnvironment.toAnswer(read(values));
      const sent: string = JSON.stringify(answer);

      expectNoSecret(sent);

      for (const field of answer.fields) {
        if (field.isSecret) {
          expect(field.value).toBeNull();
          expect(field.isSet).toBe(true);
        }
      }

      // Read back as the Admin Dashboard reads it, it is the same answer.
      expect(ServerEmailEnvironment.answerFromJSON(JSON.parse(sent))).toEqual(
        answer,
      );
    },
  );

  test("a secret left empty is shown as not set", () => {
    const field: ServerEmailEnvironmentField = fieldsOf(
      sendgrid({ [V.SendgridApiKey]: undefined }),
    ).find((candidate: ServerEmailEnvironmentField) => {
      return candidate.variable === V.SendgridApiKey;
    })!;

    expect(field).toEqual({
      variable: "GLOBAL_EMAIL_SENDGRID_API_KEY",
      value: null,
      isSecret: true,
      isSet: false,
    });
  });

  test("a type that is not one: only it, beside the problem", () => {
    const answer: ServerEmailEnvironmentAnswer =
      ServerEmailEnvironment.toAnswer(
        read(sendgrid({ [V.ServerType]: "gmail" })),
      );

    expect(answer.isSetByEnvironment).toBe(true);
    expect(answer.serverType).toBeNull();
    expect(answer.fields).toEqual([
      {
        variable: "GLOBAL_EMAIL_SERVER_TYPE",
        value: "gmail",
        isSecret: false,
        isSet: true,
      },
    ]);
    expect(answer.problems).toHaveLength(1);
  });
});

describe("the answer as the Admin Dashboard reads it back", () => {
  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a list", []],
    ["a string", "set"],
    ["a number", 7738],
  ])("%s reads as the variables not set", (_name: string, json: unknown) => {
    expect(ServerEmailEnvironment.answerFromJSON(json)).toEqual({
      isSetByEnvironment: false,
      serverType: null,
      fields: [],
      problems: [],
      ignored: [],
    });
  });

  test("a secret's value is never kept, whatever came back", () => {
    const answer: ServerEmailEnvironmentAnswer =
      ServerEmailEnvironment.answerFromJSON({
        isSetByEnvironment: true,
        serverType: EmailServerType.Sendgrid,
        fields: [
          {
            variable: V.SendgridApiKey,
            value: SENDGRID_KEY,
            isSecret: false,
            isSet: true,
          },
        ],
        problems: [],
        ignored: [],
      });

    expect(answer.fields).toEqual([
      {
        variable: "GLOBAL_EMAIL_SENDGRID_API_KEY",
        value: null,
        isSecret: true,
        isSet: true,
      },
    ]);
  });

  test("what is not part of the answer is left out", () => {
    const answer: ServerEmailEnvironmentAnswer =
      ServerEmailEnvironment.answerFromJSON({
        isSetByEnvironment: "yes",
        serverType: "Gmail",
        fields: [
          { variable: "PATH", value: "/usr/bin", isSet: true },
          "GLOBAL_EMAIL_FROM_EMAIL",
          { variable: V.FromEmail, value: 7738, isSet: "yes" },
        ],
        problems: ["one", 2, "", null],
        ignored: ["GLOBAL_EMAIL_SMTP_HOST", "HOME"],
      });

    expect(answer).toEqual({
      isSetByEnvironment: false,
      serverType: null,
      fields: [
        {
          variable: "GLOBAL_EMAIL_FROM_EMAIL",
          value: null,
          isSecret: false,
          isSet: false,
        },
      ],
      problems: ["one"],
      ignored: ["GLOBAL_EMAIL_SMTP_HOST"],
    });
  });
});

describe("the choices", () => {
  test("each is written in kebab-case, and the Admin Dashboard's own words are taken too", () => {
    const tables: Array<[Readonly<Record<string, string>>, string]> = [
      [SERVER_EMAIL_SMTP_TRANSPORT_VALUES, "transport"],
      [SERVER_EMAIL_SMTP_AUTH_TYPE_VALUES, "auth type"],
      [SERVER_EMAIL_SMTP_OAUTH_PROVIDER_TYPE_VALUES, "provider type"],
      [SERVER_EMAIL_AMAZON_SES_AUTHENTICATION_TYPE_VALUES, "SES sign-in"],
      [SERVER_EMAIL_MAILGUN_REGION_VALUES, "Mailgun region"],
    ];

    for (const [values] of tables) {
      for (const [choice, written] of Object.entries(values)) {
        expect(written).toMatch(/^[a-z]+(-[a-z]+)*$/);
        expect(ServerEmailEnvironment.readChoice(written, values, null)).toBe(
          choice,
        );
        expect(ServerEmailEnvironment.readChoice(choice, values, null)).toBe(
          choice,
        );
        expect(
          ServerEmailEnvironment.readChoice(
            ` ${choice.toUpperCase().replace(/ /g, "_")} `,
            values,
            null,
          ),
        ).toBe(choice);
      }
    }
  });

  test("an empty choice is its default; one that is not a choice is null", () => {
    expect(
      ServerEmailEnvironment.readChoice(
        "",
        SERVER_EMAIL_MAILGUN_REGION_VALUES,
        MailgunRegion.US,
      ),
    ).toBe(MailgunRegion.US);
    expect(
      ServerEmailEnvironment.readChoice(
        "asia",
        SERVER_EMAIL_MAILGUN_REGION_VALUES,
        MailgunRegion.US,
      ),
    ).toBeNull();
  });
});

describe("a mail server's host", () => {
  test.each([
    ["smtp.example.com", true],
    ["mail", true],
    ["10.0.0.25", true],
    ["2001:db8::25", true],
    ["smtp.example.com:587", false],
    ["user@smtp.example.com", false],
    ["smtp://smtp.example.com", false],
    ["smtp.example.com/path", false],
    ["[2001:db8::25]", false],
    ["smtp example com", false],
    ["", false],
  ])("%p is a host: %p", (host: string, isHost: boolean) => {
    expect(ServerEmailEnvironment.isBareHost(host)).toBe(isHost);
  });
});

describe("an OAuth token URL", () => {
  test.each([
    ["https://login.microsoftonline.com/t/oauth2/v2.0/token", true],
    ["http://localhost:8080/token", true],
    ["login.microsoftonline.com/token", false],
    ["ftp://example.com/token", false],
    ["https://", false],
    ["https://example.com/a token", false],
  ])("%p is one: %p", (url: string, isUrl: boolean) => {
    expect(ServerEmailEnvironment.isTokenUrl(url)).toBe(isUrl);
  });
});

describe("every reading, generated", () => {
  // One variable: left out, blank, a good value, or one that is not.
  function pick<T>(random: SeededRandom, values: Array<T>): T {
    return values[random(values.length)]!;
  }

  const CHOICES: Partial<
    Record<ServerEmailEnvironmentVariable, Array<string>>
  > = {
    [V.ServerType]: [
      "custom-smtp",
      "sendgrid",
      "amazon-ses",
      "mailgun",
      "postmark",
      "resend",
      "Amazon SES",
      "gmail",
    ],
    [V.FromEmail]: ["alerts@example.com", "not an address"],
    [V.FromName]: ["Alerts"],
    [V.SmtpTransport]: ["smtp", "microsoft-graph", "pigeon"],
    [V.SmtpHost]: ["smtp.example.com", "smtp.example.com:25"],
    [V.SmtpPort]: ["587", "465", "x", "70000"],
    [V.SmtpRequireTls]: ["true", "false", "maybe"],
    [V.SmtpAuthType]: ["username-and-password", "oauth", "none", "magic"],
    [V.SmtpUsername]: ["mailer"],
    [V.SmtpPassword]: [SMTP_PASSWORD],
    [V.SmtpOAuthProviderType]: ["client-credentials", "jwt-bearer", "x"],
    [V.SmtpOAuthClientId]: ["client"],
    [V.SmtpOAuthClientSecret]: [CLIENT_SECRET, PEM_KEY],
    [V.SmtpOAuthTokenUrl]: ["https://login.example.com/token", "token"],
    [V.SmtpOAuthScope]: ["scope"],
    [V.SendgridApiKey]: [SENDGRID_KEY],
    [V.AmazonSesAuthenticationType]: ["access-key", "server-iam-role", "x"],
    [V.AmazonSesAccessKeyId]: ["AKIA"],
    [V.AmazonSesSecretAccessKey]: [SES_SECRET],
    [V.AmazonSesRegion]: ["us-east-1", "moon-1"],
    [V.MailgunApiKey]: [MAILGUN_KEY],
    [V.MailgunDomain]: ["mg.example.com", "not a domain"],
    [V.MailgunRegion]: ["us", "eu", "asia"],
    [V.PostmarkServerToken]: [POSTMARK_TOKEN],
    [V.ResendApiKey]: [RESEND_KEY],
  };

  function generated(random: SeededRandom): Values {
    const values: Values = {};

    for (const variable of SERVER_EMAIL_ENVIRONMENT_VARIABLES) {
      values[variable] = pick(random, [
        undefined,
        "",
        ...(CHOICES[variable] || []),
        ...(CHOICES[variable] || []),
      ]);
    }

    return values;
  }

  test("2000 readings from a fixed seed: never a secret said, usable exactly when nothing is wrong", () => {
    const random: SeededRandom = seededRandom(7738);
    let usable: number = 0;
    let withProblems: number = 0;

    for (let i: number = 0; i < 2000; i++) {
      const values: Values = generated(random);
      const reading: ServerEmailEnvironmentReading = read(values);

      expectNoSecret(everythingSaid(reading));
      expect(ServerEmailEnvironment.isUsable(reading)).toBe(
        reading.isSet && reading.problems.length === 0,
      );

      // Every problem names one of the variables, first.
      for (const problem of reading.problems) {
        expect(problem).toMatch(/^GLOBAL_EMAIL_[A-Z_]+[ :,]/);
      }

      // A variable is either read, or named as ignored - never both.
      const fieldVariables: Array<string> = ServerEmailEnvironment.toAnswer(
        reading,
      ).fields.map((field: ServerEmailEnvironmentField) => {
        return field.variable;
      });

      for (const variable of reading.ignored) {
        expect(fieldVariables).not.toContain(variable);
      }

      if (ServerEmailEnvironment.isUsable(reading)) {
        usable++;
      } else if (reading.isSet) {
        withProblems++;
      }
    }

    // Both answers come up: the sweep is not all one way.
    expect(usable).toBeGreaterThan(10);
    expect(withProblems).toBeGreaterThan(100);
  });
});
