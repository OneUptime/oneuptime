import { afterAll, describe, expect, jest, test } from "@jest/globals";

/*
 * "SET UP" MEANS WHAT THE SENDER MEANS (#6825).
 *
 * Whether the server can send email is answered in two places: the
 * Notification service, as it sends (Notification/Config's
 * getEmailServerType, getGlobalSMTPConfig, getSendgridConfig and
 * getGlobalEmailProviderServer), and ServerChannelSetup, which every page
 * and the sign-in routes read without sending anything. If they disagreed,
 * a page could say "this server cannot send email" while it can, or a
 * fresh server could look set up. This holds them to the same answer for
 * the same GlobalConfig row: every provider, every field left blank or
 * filled, valid or not - generated from a fixed seed - and the rows a
 * person meets most, by name.
 *
 * A Custom SMTP row is followed one step further, to the SMTP transport
 * MailService makes for it (TransporterPool.getTransporter), which refuses
 * a sign-in it cannot make: settings handed on and then refused there read
 * as set up while every email failed (#7833, OAuth with no username).
 */

let storedRow: Record<string, unknown> | null = null;

jest.mock("Common/Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: async (): Promise<unknown> => {
        return storedRow ? { ...storedRow } : null;
      },
    },
  };
});

jest.mock("Common/Server/Utils/CallAndSmsGatewayConfig", () => {
  return { __esModule: true, default: { getGateway: jest.fn() } };
});

// The transport is made, never connected; OAuth's token is not fetched.
jest.mock("nodemailer", () => {
  return {
    __esModule: true,
    default: {
      createTransport: jest.fn(() => {
        return { sendMail: jest.fn(), close: jest.fn() };
      }),
    },
  };
});

jest.mock("../../FeatureSet/Notification/Services/SMTPOAuthService", () => {
  return {
    __esModule: true,
    default: {
      getAccessToken: jest.fn(async (): Promise<string> => {
        return "access-token";
      }),
    },
  };
});

import {
  getEmailServerType,
  getGlobalEmailProviderServer,
  getGlobalSMTPConfig,
  getSendgridConfig,
} from "../../FeatureSet/Notification/Config";
import { TransporterPool } from "../../FeatureSet/Notification/Services/MailService";
import ServerChannelSetup from "Common/Server/Utils/ServerSending/ServerChannelSetup";
import { EmailServerType } from "Common/Models/DatabaseModels/GlobalConfig";
import Email from "Common/Types/Email";
import AmazonSesAuthenticationType from "Common/Types/Email/AmazonSesAuthenticationType";
import EmailServer from "Common/Types/Email/EmailServer";
import Hostname from "Common/Types/API/Hostname";
import MailTransportType from "Common/Types/Email/MailTransportType";
import OAuthProviderType from "Common/Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "Common/Types/Email/SMTPAuthenticationType";
import Port from "Common/Types/Port";
import { seededRandom, SeededRandom } from "Common/Tests/Helpers/SeededRandom";

afterAll(async () => {
  await TransporterPool.cleanup();
});

/*
 * Whether the sender would hand an email to a mail server for this row:
 * the settings it reads, and - over SMTP - the transport it signs in with.
 * Microsoft Graph sends with the settings themselves.
 */
async function senderWouldSend(row: Record<string, unknown>): Promise<boolean> {
  storedRow = row;

  const type: EmailServerType = await getEmailServerType();

  try {
    switch (type) {
      case EmailServerType.Sendgrid:
        return (await getSendgridConfig()) !== null;
      case EmailServerType.AmazonSES:
        await getGlobalEmailProviderServer(MailTransportType.AmazonSES);
        return true;
      case EmailServerType.Mailgun:
        await getGlobalEmailProviderServer(MailTransportType.Mailgun);
        return true;
      case EmailServerType.Postmark:
        await getGlobalEmailProviderServer(MailTransportType.Postmark);
        return true;
      case EmailServerType.Resend:
        await getGlobalEmailProviderServer(MailTransportType.Resend);
        return true;
      default: {
        const emailServer: EmailServer | null = await getGlobalSMTPConfig();

        if (!emailServer) {
          return false;
        }

        if (emailServer.transportType !== MailTransportType.MicrosoftGraph) {
          await TransporterPool.getTransporter(emailServer, {});
        }

        return true;
      }
    }
  } catch {
    // A setting left blank: refused.
    return false;
  }
}

function pagesSaySetUp(row: Record<string, unknown>): boolean {
  return ServerChannelSetup.getEmailSetUpProblem(row) === null;
}

// Custom SMTP through Microsoft 365, signing in with OAuth as the mailbox.
const SMTP_OAUTH_ROW: Record<string, unknown> = {
  emailServerType: EmailServerType.CustomSMTP,
  smtpTransportType: MailTransportType.SMTP,
  smtpHost: new Hostname("smtp.office365.com"),
  smtpPort: new Port(587),
  smtpAuthType: SMTPAuthenticationType.OAuth,
  smtpOAuthProviderType: OAuthProviderType.ClientCredentials,
  smtpUsername: "alerts@example.com",
  smtpClientId: "client",
  smtpClientSecret: "secret",
  smtpTokenUrl: "https://login.microsoftonline.com/t/oauth2/v2.0/token",
  smtpScope: "https://outlook.office365.com/.default",
  smtpFromEmail: new Email("alerts@example.com"),
  smtpFromName: "OneUptime",
};

const NAMED_ROWS: Array<[string, Record<string, unknown>]> = [
  ["a fresh server", {}],
  [
    "Custom SMTP picked, nothing filled in",
    { emailServerType: EmailServerType.CustomSMTP },
  ],
  [
    "a mail server, complete",
    {
      emailServerType: EmailServerType.CustomSMTP,
      smtpHost: new Hostname("smtp.example.com"),
      smtpPort: new Port(587),
      smtpFromEmail: new Email("alerts@example.com"),
      smtpFromName: "OneUptime",
    },
  ],
  [
    "a mail server without its port",
    {
      smtpHost: new Hostname("smtp.example.com"),
      smtpFromEmail: new Email("alerts@example.com"),
      smtpFromName: "OneUptime",
    },
  ],
  ["only a username typed", { smtpUsername: "mailer" }],
  ["a mail server signing in with OAuth as its mailbox", SMTP_OAUTH_ROW],
  [
    "a mail server signing in with OAuth, no mailbox named",
    { ...SMTP_OAUTH_ROW, smtpUsername: "" },
  ],
  [
    "a mail server signing in with OAuth's JWT Bearer, no mailbox named",
    {
      ...SMTP_OAUTH_ROW,
      smtpOAuthProviderType: OAuthProviderType.JWTBearer,
      smtpUsername: null,
    },
  ],
  [
    "Microsoft Graph, complete",
    {
      smtpTransportType: MailTransportType.MicrosoftGraph,
      smtpFromEmail: new Email("alerts@example.com"),
      smtpFromName: "OneUptime",
      smtpClientId: "client",
      smtpClientSecret: "secret",
      smtpTokenUrl: "https://login.microsoftonline.com/t/oauth2/v2.0/token",
      smtpScope: "https://graph.microsoft.com/.default",
    },
  ],
  [
    "SendGrid without its name",
    {
      emailServerType: EmailServerType.Sendgrid,
      sendgridApiKey: "SG.key",
      sendgridFromEmail: new Email("alerts@example.com"),
    },
  ],
  [
    "Amazon SES with a Region that is not one",
    {
      emailServerType: EmailServerType.AmazonSES,
      amazonSesAccessKeyId: "AKIA",
      amazonSesSecretAccessKey: "secret",
      amazonSesRegion: "moon-1",
      amazonSesFromEmail: new Email("alerts@example.com"),
    },
  ],
  [
    "Amazon SES with this server's IAM role, no key at all",
    {
      emailServerType: EmailServerType.AmazonSES,
      amazonSesAuthenticationType: AmazonSesAuthenticationType.ServerIamRole,
      amazonSesRegion: "eu-west-1",
      amazonSesFromEmail: new Email("alerts@example.com"),
    },
  ],
  [
    "Amazon SES with this server's IAM role, no Region",
    {
      emailServerType: EmailServerType.AmazonSES,
      amazonSesAuthenticationType: AmazonSesAuthenticationType.ServerIamRole,
      amazonSesFromEmail: new Email("alerts@example.com"),
    },
  ],
  [
    "Resend, complete",
    {
      emailServerType: EmailServerType.Resend,
      resendApiKey: "re_key",
      resendFromEmail: new Email("alerts@example.com"),
    },
  ],
];

describe("the rows a person meets most", () => {
  test.each(NAMED_ROWS)(
    "%s: the pages and the sender agree",
    async (_name: string, row: Record<string, unknown>) => {
      expect(pagesSaySetUp(row)).toBe(await senderWouldSend(row));
    },
  );

  test("a fresh server cannot send, and both say so", async () => {
    expect(pagesSaySetUp({})).toBe(false);
    expect(await senderWouldSend({})).toBe(false);
  });

  test("Amazon SES signing in with this server's IAM role needs no key, and both say so (#7000)", async () => {
    const row: Record<string, unknown> = {
      emailServerType: EmailServerType.AmazonSES,
      amazonSesAuthenticationType: AmazonSesAuthenticationType.ServerIamRole,
      amazonSesRegion: "eu-west-1",
      amazonSesFromEmail: new Email("alerts@example.com"),
    };

    expect(pagesSaySetUp(row)).toBe(true);
    expect(await senderWouldSend(row)).toBe(true);

    // With an access key picked, the same row has no key: neither sends.
    const withKey: Record<string, unknown> = {
      ...row,
      amazonSesAuthenticationType: AmazonSesAuthenticationType.AccessKey,
    };

    expect(pagesSaySetUp(withKey)).toBe(false);
    expect(await senderWouldSend(withKey)).toBe(false);
  });

  /*
   * Over SMTP, OAuth signs in as a mailbox, with either grant: without one,
   * neither the pages nor the sender call email set up - not "set up" on
   * the pages and then refused at the transport (#7833). Microsoft Graph
   * sends as the From Email.
   */
  test("a mail server signing in with OAuth needs the mailbox it signs in as, and both say so; Microsoft Graph does not (#7833)", async () => {
    expect(pagesSaySetUp(SMTP_OAUTH_ROW)).toBe(true);
    expect(await senderWouldSend(SMTP_OAUTH_ROW)).toBe(true);

    for (const grant of [
      OAuthProviderType.ClientCredentials,
      OAuthProviderType.JWTBearer,
    ]) {
      for (const username of [undefined, null, ""]) {
        const row: Record<string, unknown> = {
          ...SMTP_OAUTH_ROW,
          smtpOAuthProviderType: grant,
          smtpUsername: username,
        };

        expect({ grant, username, pages: pagesSaySetUp(row) }).toEqual({
          grant,
          username,
          pages: false,
        });
        expect({
          grant,
          username,
          sender: await senderWouldSend(row),
        }).toEqual({ grant, username, sender: false });
      }
    }

    const graph: Record<string, unknown> = {
      ...SMTP_OAUTH_ROW,
      smtpTransportType: MailTransportType.MicrosoftGraph,
      smtpUsername: undefined,
      smtpHost: undefined,
      smtpPort: undefined,
    };

    expect(pagesSaySetUp(graph)).toBe(true);
    expect(await senderWouldSend(graph)).toBe(true);
  });
});

// One field: left out, blank, whitespace, a valid value, or (for some) an invalid one.
function pick<T>(random: SeededRandom, values: Array<T>): T {
  return values[random(values.length)]!;
}

function maybe(random: SeededRandom, value: unknown): unknown {
  return pick(random, [undefined, null, "", value, value, value]);
}

function generatedRow(random: SeededRandom): Record<string, unknown> {
  const type: EmailServerType | undefined = pick(random, [
    undefined,
    EmailServerType.CustomSMTP,
    EmailServerType.Sendgrid,
    EmailServerType.AmazonSES,
    EmailServerType.Mailgun,
    EmailServerType.Postmark,
    EmailServerType.Resend,
  ]);

  return {
    emailServerType: type,
    smtpTransportType: pick(random, [
      undefined,
      MailTransportType.SMTP,
      MailTransportType.MicrosoftGraph,
    ]),
    smtpAuthType: pick(random, [
      undefined,
      SMTPAuthenticationType.UsernamePassword,
      SMTPAuthenticationType.OAuth,
      SMTPAuthenticationType.None,
    ]),
    smtpHost: maybe(random, new Hostname("smtp.example.com")),
    smtpPort: maybe(random, new Port(587)),
    smtpUsername: maybe(random, "mailer"),
    smtpPassword: maybe(random, "password"),
    smtpFromEmail: maybe(random, new Email("alerts@example.com")),
    smtpFromName: maybe(random, "OneUptime"),
    smtpClientId: maybe(random, "client"),
    smtpClientSecret: maybe(random, "secret"),
    smtpTokenUrl: maybe(random, "https://login.example.com/token"),
    smtpScope: maybe(random, "scope"),
    sendgridApiKey: maybe(random, "SG.key"),
    sendgridFromEmail: maybe(random, new Email("alerts@example.com")),
    sendgridFromName: maybe(random, "OneUptime"),
    amazonSesAccessKeyId: maybe(random, pick(random, ["AKIA", "   "])),
    amazonSesSecretAccessKey: maybe(random, "secret"),
    amazonSesRegion: maybe(
      random,
      pick(random, ["us-east-1", " EU-WEST-1 ", "moon-1"]),
    ),
    amazonSesFromEmail: maybe(random, new Email("alerts@example.com")),
    mailgunApiKey: maybe(random, "key"),
    mailgunDomain: maybe(
      random,
      pick(random, ["mg.example.com", "not a domain"]),
    ),
    mailgunFromEmail: maybe(random, new Email("alerts@example.com")),
    postmarkServerToken: maybe(random, "token"),
    postmarkFromEmail: maybe(random, new Email("alerts@example.com")),
    resendApiKey: maybe(random, "re_key"),
    resendFromEmail: maybe(random, new Email("alerts@example.com")),
    // Last, so every field before it comes out of the seed as it did.
    amazonSesAuthenticationType: pick(random, [
      undefined,
      null,
      "",
      AmazonSesAuthenticationType.AccessKey,
      AmazonSesAuthenticationType.ServerIamRole,
      "Instance Profile",
    ]),
    // After it, for the same reason (#7833).
    smtpOAuthProviderType: pick(random, [
      undefined,
      OAuthProviderType.ClientCredentials,
      OAuthProviderType.JWTBearer,
    ]),
  };
}

describe("every row, generated", () => {
  test("the pages and the sender agree on 2000 rows from a fixed seed", async () => {
    const random: SeededRandom = seededRandom(6825);
    let setUp: number = 0;
    const disagreements: Array<Record<string, unknown>> = [];

    for (let i: number = 0; i < 2000; i++) {
      const row: Record<string, unknown> = generatedRow(random);
      const pages: boolean = pagesSaySetUp(row);
      const sender: boolean = await senderWouldSend(row);

      if (pages) {
        setUp++;
      }

      if (pages !== sender) {
        disagreements.push({ ...row, pages: pages, sender: sender });
      }
    }

    expect(disagreements.slice(0, 3)).toEqual([]);
    // Both answers come up: the sweep is not all one way.
    expect(setUp).toBeGreaterThan(50);
    expect(setUp).toBeLessThan(1950);
  });
});
