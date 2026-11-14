import { describe, expect, jest, test } from "@jest/globals";
import ProjectSmtpConfig from "../../../Models/DatabaseModels/ProjectSmtpConfig";
import ProjectSmtpConfigService from "../../../Server/Services/ProjectSmtpConfigService";
import { PROJECT_SMTP_CONFIG_SEND_SELECT } from "../../../Server/Utils/Mail/ProjectSmtpConfigSelect";
import Email from "../../../Types/Email";
import EmailServer from "../../../Types/Email/EmailServer";
import MailgunRegion from "../../../Types/Email/MailgunRegion";
import MailTransportType from "../../../Types/Email/MailTransportType";
import ObjectID from "../../../Types/ObjectID";
import Hostname from "../../../Types/API/Hostname";
import Port from "../../../Types/Port";
import {
  TableColumnMetadata,
  getTableColumns,
} from "../../../Types/Database/TableColumn";
import Dictionary from "../../../Types/Dictionary";

jest.mock("../../../Server/Utils/Logger");

/*
 * A PROJECT'S CONFIG OF A PROVIDER WITH AN HTTP API OF ITS OWN, AS IT IS
 * SENT WITH (ProjectSmtpConfigService.toEmailServer): its key alone - an
 * Amazon SES access key and Region, a SendGrid, Mailgun, Postmark or Resend
 * key, Mailgun's domain and region - and its sender. Every refusal names
 * the field to fill in; a key typed in for another transport, a mail
 * server's password or an OAuth secret is never handed on.
 */

const ID: ObjectID = new ObjectID("11111111-2222-4333-8444-555555555555");

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
    _id: ID.toString(),
    id: ID,
    fromEmail: new Email("alerts@example.test"),
    fromName: "Acme Alerts",
    // Every other transport's settings, as a config edited from one to another holds them.
    hostname: undefined,
    password: "smtp-password",
    clientSecret: "oauth-secret",
    amazonSesAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
    amazonSesSecretAccessKey: "ses-secret",
    amazonSesRegion: "us-east-1",
    sendgridApiKey: "SG.key",
    mailgunApiKey: "key-mailgun",
    mailgunDomain: "mg.example.test",
    postmarkServerToken: "pm-token",
    resendApiKey: "re_key",
    ...values,
  });

  return item;
}

function server(values: ConfigValues): EmailServer {
  return ProjectSmtpConfigService.toEmailServer(config(values))!;
}

// What an EmailServer carries besides who it is and who sends.
function credentialsOf(emailServer: EmailServer): Record<string, unknown> {
  const carried: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(emailServer)) {
    if (
      !["id", "transportType", "fromEmail", "fromName"].includes(key) &&
      value !== undefined
    ) {
      carried[key] = value;
    }
  }

  return carried;
}

describe("each provider is sent with its own key alone", () => {
  test("Amazon SES: the access key and the Region", () => {
    const emailServer: EmailServer = server({
      transportType: MailTransportType.AmazonSES,
      amazonSesRegion: " EU-West-1 ",
    });

    expect(emailServer.transportType).toBe(MailTransportType.AmazonSES);
    expect(emailServer.id?.toString()).toBe(ID.toString());
    expect(emailServer.fromEmail.toString()).toBe("alerts@example.test");
    expect(credentialsOf(emailServer)).toEqual({
      awsAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
      awsSecretAccessKey: "ses-secret",
      awsRegion: "eu-west-1",
    });
  });

  test("Amazon SES: never the server's IAM role, whatever the row holds - a project's config signs in with its own key (#7000)", () => {
    // A project's config has no such column; a value set on the row anyway is not read.
    const row: ProjectSmtpConfig = config({
      transportType: MailTransportType.AmazonSES,
    });

    Object.assign(row, {
      amazonSesAuthenticationType: "Server IAM Role",
      awsAuthenticationType: "Server IAM Role",
    });

    const emailServer: EmailServer =
      ProjectSmtpConfigService.toEmailServer(row)!;

    expect(emailServer.awsAuthenticationType).toBeUndefined();
    // Its id goes along: the sender refuses the server's role to any config that has one.
    expect(emailServer.id?.toString()).toBe(ID.toString());
    expect(credentialsOf(emailServer)).toEqual({
      awsAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
      awsSecretAccessKey: "ses-secret",
      awsRegion: "us-east-1",
    });
  });

  test.each([
    [MailTransportType.SendGrid, "SG.key"],
    [MailTransportType.Postmark, "pm-token"],
    [MailTransportType.Resend, "re_key"],
  ])("%s: its key", (transport: MailTransportType, key: string) => {
    expect(credentialsOf(server({ transportType: transport }))).toEqual({
      apiKey: key,
    });
  });

  test("Mailgun: its key, its domain and its region - US unless EU", () => {
    expect(
      credentialsOf(
        server({
          transportType: MailTransportType.Mailgun,
          mailgunDomain: " MG.Example.TEST ",
        }),
      ),
    ).toEqual({
      apiKey: "key-mailgun",
      mailgunDomain: "mg.example.test",
      mailgunRegion: MailgunRegion.US,
    });

    expect(
      server({
        transportType: MailTransportType.Mailgun,
        mailgunRegion: MailgunRegion.EU,
      }).mailgunRegion,
    ).toBe(MailgunRegion.EU);
  });
});

describe("a setting left blank, or not what the provider takes, names the field", () => {
  test.each([
    [
      MailTransportType.AmazonSES,
      { amazonSesAccessKeyId: "" },
      "Project SMTP config Amazon SES Access Key ID is not set",
    ],
    [
      MailTransportType.AmazonSES,
      { amazonSesSecretAccessKey: undefined },
      "Project SMTP config Amazon SES Secret Access Key is not set",
    ],
    [
      MailTransportType.AmazonSES,
      { amazonSesRegion: "  " },
      "Project SMTP config Amazon SES Region is not set",
    ],
    [
      MailTransportType.AmazonSES,
      { amazonSesRegion: "us-east-1.evil.test" },
      'Project SMTP config Amazon SES Region "us-east-1.evil.test" is not an AWS Region. Use a code such as us-east-1.',
    ],
    [
      MailTransportType.SendGrid,
      { sendgridApiKey: undefined },
      "Project SMTP config SendGrid API Key is not set",
    ],
    [
      MailTransportType.Mailgun,
      { mailgunApiKey: "" },
      "Project SMTP config Mailgun API Key is not set",
    ],
    [
      MailTransportType.Mailgun,
      { mailgunDomain: undefined },
      "Project SMTP config Mailgun Domain is not set",
    ],
    [
      MailTransportType.Mailgun,
      { mailgunDomain: "mg.example.test/../../v4" },
      'Project SMTP config Mailgun Domain "mg.example.test/../../v4" is not a domain. Use the sending domain as Mailgun lists it, such as mg.example.com.',
    ],
    [
      MailTransportType.Postmark,
      { postmarkServerToken: " " },
      "Project SMTP config Postmark Server API Token is not set",
    ],
    [
      MailTransportType.Resend,
      { resendApiKey: undefined },
      "Project SMTP config Resend API Key is not set",
    ],
  ])(
    "%s with %j",
    (transport: MailTransportType, values: ConfigValues, message: string) => {
      expect(() => {
        return server({ transportType: transport, ...values });
      }).toThrow(message);
    },
  );

  test("every provider needs its sender, as a mail server does", () => {
    for (const transport of [
      MailTransportType.AmazonSES,
      MailTransportType.SendGrid,
      MailTransportType.Mailgun,
      MailTransportType.Postmark,
      MailTransportType.Resend,
    ]) {
      expect(() => {
        return server({ transportType: transport, fromEmail: undefined });
      }).toThrow("Project SMTP config from email is not set");
      expect(() => {
        return server({ transportType: transport, fromName: "" });
      }).toThrow("Project SMTP config from name is not set");
    }
  });

  test("a provider needs no host, port, username or OAuth app", () => {
    expect(() => {
      return server({
        transportType: MailTransportType.Resend,
        hostname: undefined,
        port: undefined,
        username: undefined,
        clientId: undefined,
      });
    }).not.toThrow();
  });
});

describe("a mail server's config reads as it always did", () => {
  test("an unknown transport is SMTP, and needs its host", () => {
    expect(() => {
      return server({ transportType: "Carrier Pigeon" as MailTransportType });
    }).toThrow("Project SMTP config host is not set");
  });

  test("an SMTP config never carries a provider's key", () => {
    const emailServer: EmailServer = server({
      transportType: MailTransportType.SMTP,
      hostname: new Hostname("smtp.example.test"),
      port: new Port(587),
      username: "alerts@example.test",
    });

    expect(emailServer.host?.toString()).toBe("smtp.example.test");
    expect(emailServer.password).toBe("smtp-password");

    for (const key of [
      "apiKey",
      "awsAccessKeyId",
      "awsSecretAccessKey",
      "awsRegion",
      "mailgunDomain",
      "mailgunRegion",
    ]) {
      expect({
        key,
        value: (emailServer as unknown as Record<string, unknown>)[key],
      }).toEqual({
        key,
        value: undefined,
      });
    }
  });

  test("neither does a Microsoft Graph config", () => {
    const emailServer: EmailServer = server({
      transportType: MailTransportType.MicrosoftGraph,
      clientId: "client-id",
      tokenUrl: "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
      scope: "https://graph.microsoft.com/.default",
    });

    expect(emailServer.clientSecret).toBe("oauth-secret");
    expect(emailServer.apiKey).toBeUndefined();
    expect(emailServer.awsSecretAccessKey).toBeUndefined();
  });
});

describe("what a send reads of a config (PROJECT_SMTP_CONFIG_SEND_SELECT)", () => {
  test("every column toEmailServer reads, for every transport", () => {
    expect(Object.keys(PROJECT_SMTP_CONFIG_SEND_SELECT).sort()).toEqual(
      [
        "_id",
        "transportType",
        "hostname",
        "port",
        "username",
        "password",
        "fromEmail",
        "fromName",
        "secure",
        "authType",
        "clientId",
        "clientSecret",
        "tokenUrl",
        "scope",
        "oauthProviderType",
        "amazonSesAccessKeyId",
        "amazonSesSecretAccessKey",
        "amazonSesRegion",
        "sendgridApiKey",
        "mailgunApiKey",
        "mailgunDomain",
        "mailgunRegion",
        "postmarkServerToken",
        "resendApiKey",
      ].sort(),
    );
  });

  test("every provider's key is a secret, encrypted at rest and read only by those who may", () => {
    const columns: Dictionary<TableColumnMetadata> = getTableColumns(
      new ProjectSmtpConfig(),
    );

    for (const name of [
      "amazonSesSecretAccessKey",
      "sendgridApiKey",
      "mailgunApiKey",
      "postmarkServerToken",
      "resendApiKey",
    ]) {
      expect({ name, encrypted: columns[name]?.encrypted }).toEqual({
        name,
        encrypted: true,
      });
    }

    // Identifiers that sign in to nothing stay plain text.
    for (const name of [
      "amazonSesAccessKeyId",
      "amazonSesRegion",
      "mailgunDomain",
      "mailgunRegion",
    ]) {
      expect({ name, encrypted: Boolean(columns[name]?.encrypted) }).toEqual({
        name,
        encrypted: false,
      });
    }
  });
});
