import ServerSendingSettings, {
  SERVER_EMAIL_TYPE_COLUMNS,
} from "../../../../Server/Utils/ServerSending/ServerSendingSettings";
import { getServerEmailEnvironment } from "../../../../Server/Utils/ServerEmailSettings";
import GlobalConfig, {
  EmailServerType,
} from "../../../../Models/DatabaseModels/GlobalConfig";
import Hostname from "../../../../Types/API/Hostname";
import Email from "../../../../Types/Email";
import AmazonSesAuthenticationType from "../../../../Types/Email/AmazonSesAuthenticationType";
import MailgunRegion from "../../../../Types/Email/MailgunRegion";
import MailTransportType from "../../../../Types/Email/MailTransportType";
import OAuthProviderType from "../../../../Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "../../../../Types/Email/SMTPAuthenticationType";
import ServerEmailEnvironment, {
  SERVER_EMAIL_COLUMNS,
  SERVER_EMAIL_ENVIRONMENT_VARIABLES,
  ServerEmailColumn,
  ServerEmailEnvironmentVariable,
} from "../../../../Types/Email/ServerEmailEnvironment";
import Port from "../../../../Types/Port";
import {
  ServerSendingChannel,
  ServerSendingSettingsFingerprints,
} from "../../../../Types/ServerSending/ServerSendingStatus";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHICH EMAIL SETTINGS THE SERVER'S OWN EMAIL GOES OUT WITH, AS A
 * FINGERPRINT (#7803).
 *
 * What the server remembers of its own email is marked with the settings it
 * was learned with, so that the settings changing without a save - the
 * GLOBAL_EMAIL_ environment variables set (#7738), changed or unset -
 * starts email again at untested. The settings are read as the senders
 * read them: the variables' once GLOBAL_EMAIL_SERVER_TYPE is set, else the
 * saved ones - the Email Server Type and every column of that type, a
 * password or a key included. `unmarked` is always the saved settings:
 * what an entry from before there were fingerprints was learned with.
 */

const V: typeof ServerEmailEnvironmentVariable = ServerEmailEnvironmentVariable;

const SAVED_PASSWORD: string = "saved-smtp-password-sentinel-7803";
const ENV_PASSWORD: string = "environment-smtp-password-sentinel-7803";

const HEX_DIGEST: RegExp = /^[0-9a-f]{64}$/;

type OwnColumn = Exclude<ServerEmailColumn, "emailServerType">;

// Every column but the type itself: each is one Email Server Type's.
const OWN_COLUMNS: Array<OwnColumn> = SERVER_EMAIL_COLUMNS.filter(
  (column: ServerEmailColumn): column is OwnColumn => {
    return column !== "emailServerType";
  },
);

/*
 * The Email Server Type a column is sent with, by its name: what the
 * implementation's SERVER_EMAIL_TYPE_COLUMNS is checked against.
 */
function typeOfColumn(column: string): EmailServerType {
  if (column.startsWith("smtp") || column === "isSMTPSecure") {
    return EmailServerType.CustomSMTP;
  }

  if (column.startsWith("sendgrid")) {
    return EmailServerType.Sendgrid;
  }

  if (column.startsWith("amazonSes")) {
    return EmailServerType.AmazonSES;
  }

  if (column.startsWith("mailgun")) {
    return EmailServerType.Mailgun;
  }

  if (column.startsWith("postmark")) {
    return EmailServerType.Postmark;
  }

  if (column.startsWith("resend")) {
    return EmailServerType.Resend;
  }

  throw new Error(`${column} is no Email Server Type's column.`);
}

// Each column filled in, and another value for it - a choice not the one it defaults to.
const COLUMN_VALUES: Record<OwnColumn, [unknown, unknown]> = {
  isSMTPSecure: [true, false],
  smtpTransportType: [MailTransportType.SMTP, MailTransportType.MicrosoftGraph],
  smtpAuthType: [
    SMTPAuthenticationType.UsernamePassword,
    SMTPAuthenticationType.None,
  ],
  smtpHost: [
    new Hostname("smtp.example.com"),
    new Hostname("smtp.example.org"),
  ],
  smtpPort: [new Port(587), new Port(465)],
  smtpUsername: ["alerts", "alerts-2"],
  smtpPassword: [SAVED_PASSWORD, "a-fixed-smtp-password"],
  smtpFromEmail: [
    new Email("alerts@example.com"),
    new Email("alerts@example.org"),
  ],
  smtpFromName: ["Alerts", "Other Alerts"],
  smtpClientId: ["client-id-1", "client-id-2"],
  smtpClientSecret: ["client-secret-1", "client-secret-2"],
  smtpTokenUrl: [
    "https://login.example.com/token",
    "https://login.example.org/token",
  ],
  smtpScope: [
    "https://outlook.office365.com/.default",
    "https://graph.microsoft.com/.default",
  ],
  smtpOAuthProviderType: [
    OAuthProviderType.JWTBearer,
    OAuthProviderType.ClientCredentials,
  ],
  sendgridApiKey: ["SG.key-1", "SG.key-2"],
  sendgridFromEmail: [
    new Email("alerts@example.com"),
    new Email("alerts@example.org"),
  ],
  sendgridFromName: ["Alerts", "Other Alerts"],
  amazonSesAuthenticationType: [
    AmazonSesAuthenticationType.ServerIamRole,
    AmazonSesAuthenticationType.AccessKey,
  ],
  amazonSesAccessKeyId: ["AKIA11111111", "AKIA22222222"],
  amazonSesSecretAccessKey: ["ses-secret-1", "ses-secret-2"],
  amazonSesRegion: ["us-east-1", "eu-west-1"],
  amazonSesFromEmail: [
    new Email("alerts@example.com"),
    new Email("alerts@example.org"),
  ],
  amazonSesFromName: ["Alerts", "Other Alerts"],
  mailgunApiKey: ["mailgun-key-1", "mailgun-key-2"],
  mailgunDomain: ["mg.example.com", "mg.example.org"],
  mailgunRegion: [MailgunRegion.EU, MailgunRegion.US],
  mailgunFromEmail: [
    new Email("alerts@example.com"),
    new Email("alerts@example.org"),
  ],
  mailgunFromName: ["Alerts", "Other Alerts"],
  postmarkServerToken: ["postmark-token-1", "postmark-token-2"],
  postmarkFromEmail: [
    new Email("alerts@example.com"),
    new Email("alerts@example.org"),
  ],
  postmarkFromName: ["Alerts", "Other Alerts"],
  resendApiKey: ["re_key_1", "re_key_2"],
  resendFromEmail: [
    new Email("alerts@example.com"),
    new Email("alerts@example.org"),
  ],
  resendFromName: ["Alerts", "Other Alerts"],
};

// A row with an Email Server Type picked and every column of that type filled in.
function rowOfType(
  type: EmailServerType,
  values: Partial<Record<ServerEmailColumn, unknown>> = {},
): GlobalConfig {
  const filled: Partial<Record<ServerEmailColumn, unknown>> = {
    emailServerType: type,
  };

  for (const column of OWN_COLUMNS) {
    if (typeOfColumn(column) === type) {
      filled[column] = COLUMN_VALUES[column][0];
    }
  }

  return Object.assign(new GlobalConfig(), filled, values);
}

// The settings an admin saved in the Admin Dashboard: a mail server that sends.
function savedRow(
  values: Partial<Record<ServerEmailColumn, unknown>> = {},
): GlobalConfig {
  return Object.assign(
    new GlobalConfig(),
    {
      emailServerType: EmailServerType.CustomSMTP,
      smtpHost: new Hostname("smtp.saved.example.com"),
      smtpPort: new Port(587),
      isSMTPSecure: true,
      smtpUsername: "saved-user",
      smtpPassword: SAVED_PASSWORD,
      smtpFromEmail: new Email("alerts@saved.example.com"),
      smtpFromName: "Saved Alerts",
    },
    values,
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

// A mail server the variables set, that sends.
function setEnvironmentSmtp(
  values: Partial<Record<ServerEmailEnvironmentVariable, string>> = {},
): void {
  setEnvironment({
    [V.ServerType]: "custom-smtp",
    [V.FromEmail]: "alerts@env.example.com",
    [V.FromName]: "Environment Alerts",
    [V.SmtpHost]: "smtp.env.example.com",
    [V.SmtpPort]: "587",
    [V.SmtpRequireTls]: "true",
    [V.SmtpUsername]: "env-user",
    [V.SmtpPassword]: ENV_PASSWORD,
    ...values,
  });
}

function unsetEnvironment(): void {
  for (const variable of SERVER_EMAIL_ENVIRONMENT_VARIABLES) {
    delete process.env[variable];
  }
}

// The variables as they are now describe settings that send: a test of them is not of a mistake.
function expectUsableEnvironment(): void {
  expect(getServerEmailEnvironment().problems).toEqual([]);
  expect(ServerEmailEnvironment.isUsable(getServerEmailEnvironment())).toBe(
    true,
  );
}

function fingerprintsOf(
  row: GlobalConfig | null,
): ServerSendingSettingsFingerprints {
  const fingerprints: ServerSendingSettingsFingerprints | null =
    ServerSendingSettings.getFingerprints(ServerSendingChannel.Email, row);

  expect(fingerprints).not.toBeNull();

  return fingerprints!;
}

function currentOf(row: GlobalConfig | null): string {
  return fingerprintsOf(row).current;
}

beforeEach(() => {
  for (const variable of SERVER_EMAIL_ENVIRONMENT_VARIABLES) {
    before[variable] = process.env[variable];
  }

  unsetEnvironment();
});

afterEach(() => {
  for (const variable of SERVER_EMAIL_ENVIRONMENT_VARIABLES) {
    if (before[variable] === undefined) {
      delete process.env[variable];
    } else {
      process.env[variable] = before[variable];
    }
  }
});

describe("the columns each Email Server Type sends with", () => {
  test("every email column but the type is one type's: none left out, none of two types", () => {
    const listed: Array<ServerEmailColumn> = Object.values(
      SERVER_EMAIL_TYPE_COLUMNS,
    ).flat();

    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...OWN_COLUMNS].sort());

    for (const column of OWN_COLUMNS) {
      expect(SERVER_EMAIL_TYPE_COLUMNS[typeOfColumn(column)]).toContain(column);
    }
  });

  test("every Email Server Type has its columns", () => {
    expect(Object.keys(SERVER_EMAIL_TYPE_COLUMNS).sort()).toEqual(
      Object.values(EmailServerType).sort(),
    );
  });
});

describe("the email settings saved in the Admin Dashboard", () => {
  test("without the variables, the saved settings are the ones sending now", () => {
    const fingerprints: ServerSendingSettingsFingerprints =
      fingerprintsOf(savedRow());

    expect(fingerprints.current).toMatch(HEX_DIGEST);
    expect(fingerprints.current).toBe(fingerprints.unmarked);
  });

  test("the same saved settings give the same fingerprint every time", () => {
    expect(currentOf(savedRow())).toBe(currentOf(savedRow()));
  });

  test.each(OWN_COLUMNS)(
    "another %s is other settings",
    (column: OwnColumn) => {
      const type: EmailServerType = typeOfColumn(column);

      expect(
        currentOf(rowOfType(type, { [column]: COLUMN_VALUES[column][1] })),
      ).not.toBe(currentOf(rowOfType(type)));
    },
  );

  test.each(Object.values(EmailServerType))(
    "%s: what another type would send with changes nothing",
    (type: EmailServerType) => {
      const otherTypes: (
        index: 0 | 1,
      ) => Partial<Record<ServerEmailColumn, unknown>> = (
        index: 0 | 1,
      ): Partial<Record<ServerEmailColumn, unknown>> => {
        const values: Partial<Record<ServerEmailColumn, unknown>> = {};

        for (const column of OWN_COLUMNS) {
          if (typeOfColumn(column) !== type) {
            values[column] = COLUMN_VALUES[column][index];
          }
        }

        return values;
      };

      expect(currentOf(rowOfType(type, otherTypes(0)))).toBe(
        currentOf(rowOfType(type)),
      );
      expect(currentOf(rowOfType(type, otherTypes(1)))).toBe(
        currentOf(rowOfType(type)),
      );
    },
  );

  test("the type is part of the settings: Postmark and Resend with the same key and sender are other settings", () => {
    const sameKeyAndSender: Partial<Record<ServerEmailColumn, unknown>> = {
      postmarkServerToken: "one-key",
      postmarkFromEmail: new Email("alerts@example.com"),
      postmarkFromName: "Alerts",
      resendApiKey: "one-key",
      resendFromEmail: new Email("alerts@example.com"),
      resendFromName: "Alerts",
    };

    expect(
      currentOf(rowOfType(EmailServerType.Postmark, sameKeyAndSender)),
    ).not.toBe(currentOf(rowOfType(EmailServerType.Resend, sameKeyAndSender)));
  });

  test.each([
    ["emailServerType", EmailServerType.CustomSMTP],
    ["smtpTransportType", MailTransportType.SMTP],
    ["isSMTPSecure", false],
    ["smtpAuthType", SMTPAuthenticationType.UsernamePassword],
    ["smtpOAuthProviderType", OAuthProviderType.ClientCredentials],
    ["amazonSesAuthenticationType", AmazonSesAuthenticationType.AccessKey],
    ["mailgunRegion", MailgunRegion.US],
  ] as Array<[ServerEmailColumn, unknown]>)(
    "%s left empty is %p, as the senders read it",
    (column: ServerEmailColumn, value: unknown) => {
      const type: EmailServerType =
        column === "emailServerType"
          ? EmailServerType.CustomSMTP
          : typeOfColumn(column);

      expect(currentOf(rowOfType(type, { [column]: null }))).toBe(
        currentOf(rowOfType(type, { [column]: value })),
      );
      expect(currentOf(rowOfType(type, { [column]: undefined }))).toBe(
        currentOf(rowOfType(type, { [column]: value })),
      );
    },
  );

  test("a saved value is read as the mail server is handed it: a space after a password is another password", () => {
    expect(
      currentOf(savedRow({ smtpPassword: `${SAVED_PASSWORD} ` })),
    ).not.toBe(currentOf(savedRow()));
  });

  test("an address, a host and a port read the same as the text they hold", () => {
    expect(
      currentOf(
        savedRow({
          smtpHost: "smtp.saved.example.com",
          smtpPort: 587,
          smtpFromEmail: "alerts@saved.example.com",
        }),
      ),
    ).toBe(currentOf(savedRow()));
  });

  test("no saved settings, a null row and an empty row are the same: nothing set up", () => {
    const empty: string = currentOf(new GlobalConfig());

    expect(currentOf(null)).toBe(empty);
    expect(fingerprintsOf(null).unmarked).toBe(empty);
    expect(empty).not.toBe(currentOf(savedRow()));
  });

  test("a type that is not one is still read, never thrown on, and is not Custom SMTP", () => {
    const row: GlobalConfig = savedRow({
      emailServerType: "Carrier Pigeon" as EmailServerType,
    });

    expect(() => {
      return currentOf(row);
    }).not.toThrow();
    expect(currentOf(row)).not.toBe(currentOf(savedRow()));
  });
});

describe("the email settings the GLOBAL_EMAIL_ variables set", () => {
  test("once GLOBAL_EMAIL_SERVER_TYPE is set, their settings are the ones sending; the saved ones stay unmarked", () => {
    const saved: ServerSendingSettingsFingerprints = fingerprintsOf(savedRow());

    setEnvironmentSmtp();
    expectUsableEnvironment();

    const underVariables: ServerSendingSettingsFingerprints =
      fingerprintsOf(savedRow());

    expect(underVariables.current).toMatch(HEX_DIGEST);
    expect(underVariables.current).not.toBe(saved.current);
    expect(underVariables.unmarked).toBe(saved.current);
  });

  test("whatever the row holds: an empty row or none under the same variables is the same settings", () => {
    setEnvironmentSmtp();

    expect(currentOf(new GlobalConfig())).toBe(currentOf(savedRow()));
    expect(currentOf(null)).toBe(currentOf(savedRow()));
  });

  test.each([
    [V.SmtpPassword, "a-fixed-smtp-password"],
    [V.SmtpHost, "smtp.other.example.com"],
    [V.SmtpPort, "465"],
    [V.SmtpRequireTls, "false"],
    [V.SmtpUsername, "another-user"],
    [V.SmtpAuthType, "none"],
    [V.FromEmail, "alerts@other.example.com"],
    [V.FromName, "Other Alerts"],
  ])(
    "changing %s is other settings",
    (variable: ServerEmailEnvironmentVariable, value: string) => {
      setEnvironmentSmtp();
      expectUsableEnvironment();

      const first: string = currentOf(savedRow());

      setEnvironment({ [variable]: value });
      expectUsableEnvironment();

      expect(currentOf(savedRow())).not.toBe(first);
    },
  );

  test.each([
    [
      "SendGrid's API key",
      {
        [V.ServerType]: "sendgrid",
        [V.SendgridApiKey]: "SG.environment-key-1",
        [V.FromName]: "Alerts",
      },
      { [V.SendgridApiKey]: "SG.environment-key-2" },
    ],
    [
      "Amazon SES's secret access key",
      {
        [V.ServerType]: "amazon-ses",
        [V.AmazonSesAccessKeyId]: "AKIA11111111",
        [V.AmazonSesSecretAccessKey]: "ses-secret-1",
        [V.AmazonSesRegion]: "us-east-1",
      },
      { [V.AmazonSesSecretAccessKey]: "ses-secret-2" },
    ],
    [
      "Amazon SES's Region",
      {
        [V.ServerType]: "amazon-ses",
        [V.AmazonSesAuthenticationType]: "server-iam-role",
        [V.AmazonSesRegion]: "us-east-1",
      },
      { [V.AmazonSesRegion]: "eu-west-1" },
    ],
    [
      "Amazon SES's sign-in",
      {
        [V.ServerType]: "amazon-ses",
        [V.AmazonSesAccessKeyId]: "AKIA11111111",
        [V.AmazonSesSecretAccessKey]: "ses-secret-1",
        [V.AmazonSesRegion]: "us-east-1",
      },
      { [V.AmazonSesAuthenticationType]: "server-iam-role" },
    ],
    [
      "Mailgun's domain",
      {
        [V.ServerType]: "mailgun",
        [V.MailgunApiKey]: "mailgun-key-1",
        [V.MailgunDomain]: "mg.example.com",
      },
      { [V.MailgunDomain]: "mg.example.org" },
    ],
    [
      "Mailgun's region",
      {
        [V.ServerType]: "mailgun",
        [V.MailgunApiKey]: "mailgun-key-1",
        [V.MailgunDomain]: "mg.example.com",
      },
      { [V.MailgunRegion]: "eu" },
    ],
    [
      "Postmark's server token",
      {
        [V.ServerType]: "postmark",
        [V.PostmarkServerToken]: "postmark-token-1",
      },
      { [V.PostmarkServerToken]: "postmark-token-2" },
    ],
    [
      "Resend's API key",
      {
        [V.ServerType]: "resend",
        [V.ResendApiKey]: "re_key_1",
      },
      { [V.ResendApiKey]: "re_key_2" },
    ],
    [
      "Microsoft Graph's client secret",
      {
        [V.ServerType]: "custom-smtp",
        [V.SmtpTransport]: "microsoft-graph",
        [V.FromName]: "Alerts",
        [V.SmtpOAuthClientId]: "client-id",
        [V.SmtpOAuthClientSecret]: "client-secret-1",
        [V.SmtpOAuthTokenUrl]:
          "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
        [V.SmtpOAuthScope]: "https://graph.microsoft.com/.default",
      },
      { [V.SmtpOAuthClientSecret]: "client-secret-2" },
    ],
  ])(
    "changing %s is other settings",
    (
      _label: string,
      settings: Partial<Record<ServerEmailEnvironmentVariable, string>>,
      change: Partial<Record<ServerEmailEnvironmentVariable, string>>,
    ) => {
      setEnvironment({ [V.FromEmail]: "alerts@example.com", ...settings });
      expectUsableEnvironment();

      const first: string = currentOf(savedRow());

      setEnvironment(change);
      expectUsableEnvironment();

      expect(currentOf(savedRow())).not.toBe(first);
    },
  );

  test("another Email Server Type is other settings", () => {
    setEnvironmentSmtp({ [V.SendgridApiKey]: "SG.environment-key-1" });
    expectUsableEnvironment();

    const smtp: string = currentOf(savedRow());

    setEnvironment({ [V.ServerType]: "sendgrid" });
    expectUsableEnvironment();

    expect(currentOf(savedRow())).not.toBe(smtp);
  });

  test("a variable the chosen settings do not read changes nothing", () => {
    setEnvironment({
      [V.ServerType]: "sendgrid",
      [V.SendgridApiKey]: "SG.environment-key-1",
      [V.FromEmail]: "alerts@example.com",
      [V.FromName]: "Alerts",
    });

    const first: string = currentOf(savedRow());

    setEnvironment({
      [V.SmtpHost]: "smtp.ignored.example.com",
      [V.SmtpPassword]: "an-ignored-password",
    });

    expect(getServerEmailEnvironment().ignored).toContain(V.SmtpHost);
    expect(currentOf(savedRow())).toBe(first);
  });

  test("variables that repeat the saved settings are the same settings: what was learned with them stays", () => {
    // Saved before the transport and sign-in were choices: both left empty.
    const row: GlobalConfig = savedRow({
      smtpTransportType: undefined,
      smtpAuthType: undefined,
    });

    setEnvironment({
      [V.ServerType]: "Custom SMTP",
      [V.SmtpTransport]: "smtp",
      [V.SmtpHost]: "smtp.saved.example.com",
      [V.SmtpPort]: "587",
      [V.SmtpRequireTls]: "true",
      [V.SmtpAuthType]: "username-and-password",
      [V.SmtpUsername]: "saved-user",
      [V.SmtpPassword]: SAVED_PASSWORD,
      [V.FromEmail]: "alerts@saved.example.com",
      [V.FromName]: "Saved Alerts",
    });
    expectUsableEnvironment();

    const fingerprints: ServerSendingSettingsFingerprints = fingerprintsOf(row);

    expect(fingerprints.current).toBe(fingerprints.unmarked);
  });

  test("variables set without GLOBAL_EMAIL_SERVER_TYPE are read by nothing: the saved settings stay", () => {
    const saved: string = currentOf(savedRow());

    setEnvironmentSmtp();
    delete process.env[V.ServerType];

    expect(fingerprintsOf(savedRow())).toEqual({
      current: saved,
      unmarked: saved,
    });
  });

  test.each([
    ["a port that is not one", { [V.SmtpPort]: "smtp" }],
    ["a password that did not arrive", { [V.SmtpPassword]: "" }],
    ["a type that is not one", { [V.ServerType]: "carrier-pigeon" }],
  ])(
    "with %s, the variables send nothing: settings of their own, never the saved ones or the ones before the mistake",
    (
      _label: string,
      mistake: Partial<Record<ServerEmailEnvironmentVariable, string>>,
    ) => {
      setEnvironmentSmtp();

      const beforeTheMistake: string = currentOf(savedRow());

      setEnvironment(mistake);

      expect(ServerEmailEnvironment.isUsable(getServerEmailEnvironment())).toBe(
        false,
      );

      const fingerprints: ServerSendingSettingsFingerprints =
        fingerprintsOf(savedRow());

      expect(fingerprints.current).toMatch(HEX_DIGEST);
      expect(fingerprints.current).not.toBe(fingerprints.unmarked);
      expect(fingerprints.current).not.toBe(beforeTheMistake);
      // Nor nothing set up in the saved row: only the variables send nothing.
      expect(fingerprints.current).not.toBe(
        fingerprintsOf(new GlobalConfig()).unmarked,
      );
    },
  );

  test("the variables are read again on every call", () => {
    const saved: string = currentOf(savedRow());

    setEnvironmentSmtp();

    expect(currentOf(savedRow())).not.toBe(saved);

    delete process.env[V.ServerType];

    expect(currentOf(savedRow())).toBe(saved);
  });
});

describe("what an email fingerprint holds", () => {
  test("a hex digest: no password, key, address or host in it", () => {
    setEnvironmentSmtp();

    const fingerprints: ServerSendingSettingsFingerprints =
      fingerprintsOf(savedRow());

    for (const fingerprint of [fingerprints.current, fingerprints.unmarked]) {
      expect(fingerprint).toMatch(HEX_DIGEST);

      for (const secret of [
        SAVED_PASSWORD,
        ENV_PASSWORD,
        "saved-user",
        "env-user",
        "smtp.saved.example.com",
        "smtp.env.example.com",
        "alerts@saved.example.com",
        "alerts@env.example.com",
      ]) {
        expect(fingerprint).not.toContain(secret);
      }
    }
  });

  test("email's settings are not SMS and calls': the Twilio account is no part of them", () => {
    const email: ServerSendingSettingsFingerprints = fingerprintsOf(savedRow());

    expect(
      ServerSendingSettings.getFingerprints(
        ServerSendingChannel.SMS,
        savedRow(),
      ),
    ).not.toEqual(email);

    expect(
      currentOf(
        Object.assign(savedRow(), {
          twilioAccountSID: "AC11111111111111111111111111111111",
          twilioAuthToken: "a-twilio-token",
        }),
      ),
    ).toBe(email.current);
  });
});
