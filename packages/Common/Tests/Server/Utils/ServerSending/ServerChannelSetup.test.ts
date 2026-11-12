import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ServerChannelSetup, {
  CALL_NOT_SET_UP_PROBLEM,
  EMAIL_NOT_SET_UP_PROBLEM,
  PUSH_TURNED_OFF_PROBLEM,
  SERVER_CHANNEL_SETTING_COLUMNS,
  SERVER_CHANNEL_SETUP_SELECT,
  SMS_NOT_SET_UP_PROBLEM,
  ServerChannelSetupSettings,
} from "../../../../Server/Utils/ServerSending/ServerChannelSetup";
import { EmailServerType } from "../../../../Models/DatabaseModels/GlobalConfig";
import { CallAndSmsProvider } from "../../../../Types/CallAndSMS/CallAndSmsProvider";
import { TwilioConfigUse } from "../../../../Types/CallAndSMS/TwilioConfigUse";
import Email from "../../../../Types/Email";
import AmazonSesAuthenticationType from "../../../../Types/Email/AmazonSesAuthenticationType";
import Hostname from "../../../../Types/API/Hostname";
import MailTransportType from "../../../../Types/Email/MailTransportType";
import SMTPAuthenticationType from "../../../../Types/Email/SMTPAuthenticationType";
import Phone from "../../../../Types/Phone";
import Port from "../../../../Types/Port";
import { ServerSendingChannel } from "../../../../Types/ServerSending/ServerSendingStatus";
import { TwilioMessageKind } from "../../../../Utils/Project/TwilioAccount";

/*
 * WHETHER THE SERVER'S OWN SETTINGS LET IT SEND (#6825).
 *
 * Read from the GlobalConfig row as the Notification service reads it when
 * it sends, so "not set up" is exactly "an email would be refused for a
 * setting left blank": a fresh server's empty Custom SMTP, each provider's
 * key and sender, Microsoft Graph's OAuth app. App/Tests/Notification/
 * ServerChannelSetupAgreesWithSender holds this to the sender itself.
 * Each problem names what is missing for the server's admin, never a value.
 */

/*
 * These settings with the named ones left blank: their keys taken out. The
 * check reads a missing setting as it reads an undefined one, and the
 * settings' type takes no `undefined` (exactOptionalPropertyTypes).
 */
function leftBlank(
  settings: ServerChannelSetupSettings,
  ...keys: Array<keyof ServerChannelSetupSettings>
): ServerChannelSetupSettings {
  const blanked: ServerChannelSetupSettings = { ...settings };

  for (const key of keys) {
    delete blanked[key];
  }

  return blanked;
}

function smtp(
  overrides: Partial<ServerChannelSetupSettings> = {},
): ServerChannelSetupSettings {
  return {
    emailServerType: EmailServerType.CustomSMTP,
    smtpHost: new Hostname("smtp.example.com"),
    smtpPort: new Port(587),
    smtpUsername: "mailer",
    smtpPassword: "secret-password",
    smtpFromEmail: new Email("alerts@example.com"),
    smtpFromName: "OneUptime",
    ...overrides,
  };
}

describe("email", () => {
  test("a fresh server - nothing filled in, no provider picked - is not set up", () => {
    expect(ServerChannelSetup.getEmailSetUpProblem({})).toBe(
      EMAIL_NOT_SET_UP_PROBLEM,
    );
    expect(ServerChannelSetup.getEmailSetUpProblem(null)).toBe(
      EMAIL_NOT_SET_UP_PROBLEM,
    );
    expect(
      ServerChannelSetup.getEmailSetUpProblem({
        emailServerType: EmailServerType.CustomSMTP,
      }),
    ).toBe(EMAIL_NOT_SET_UP_PROBLEM);
  });

  test("a mail server with its host, port and sender is set up", () => {
    expect(ServerChannelSetup.getEmailSetUpProblem(smtp())).toBeNull();
    // No provider picked reads as Custom SMTP, as the sender reads it.
    expect(
      ServerChannelSetup.getEmailSetUpProblem(
        leftBlank(smtp(), "emailServerType"),
      ),
    ).toBeNull();
  });

  test.each([
    ["smtpFromEmail", "From Email"],
    ["smtpFromName", "From Name"],
    ["smtpHost", "Host"],
    ["smtpPort", "Port"],
  ] as Array<[keyof ServerChannelSetupSettings, string]>)(
    "a mail server without its %s is not set up, and says so",
    (column: keyof ServerChannelSetupSettings, field: string) => {
      const problem: string | null = ServerChannelSetup.getEmailSetUpProblem(
        smtp({ [column]: undefined }),
      );

      expect(problem).toBe(
        `SMTP: the ${field} is not set under Settings > Emails.`,
      );
    },
  );

  test("a mail server that signs in with OAuth needs its OAuth app", () => {
    const oauth: ServerChannelSetupSettings = smtp({
      smtpAuthType: SMTPAuthenticationType.OAuth,
      smtpClientId: "client",
      smtpClientSecret: "client-secret",
      smtpTokenUrl: "https://login.example.com/token",
      smtpScope: "https://outlook.office365.com/.default",
    });

    expect(ServerChannelSetup.getEmailSetUpProblem(oauth)).toBeNull();
    expect(
      ServerChannelSetup.getEmailSetUpProblem({ ...oauth, smtpScope: "" }),
    ).toBe("SMTP: the OAuth Scope is not set under Settings > Emails.");
    expect(
      ServerChannelSetup.getEmailSetUpProblem(
        leftBlank(oauth, "smtpClientSecret"),
      ),
    ).toBe("SMTP: the OAuth Client Secret is not set under Settings > Emails.");
  });

  test("Microsoft Graph needs no host or port, only its OAuth app and sender", () => {
    const graph: ServerChannelSetupSettings = {
      emailServerType: EmailServerType.CustomSMTP,
      smtpTransportType: MailTransportType.MicrosoftGraph,
      smtpFromEmail: new Email("alerts@example.com"),
      smtpFromName: "OneUptime",
      smtpClientId: "client",
      smtpClientSecret: "client-secret",
      smtpTokenUrl:
        "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
      smtpScope: "https://graph.microsoft.com/.default",
    };

    expect(ServerChannelSetup.getEmailSetUpProblem(graph)).toBeNull();
    expect(
      ServerChannelSetup.getEmailSetUpProblem(leftBlank(graph, "smtpClientId")),
    ).toBe(
      "Microsoft Graph: the OAuth Client ID is not set under Settings > Emails.",
    );
    // A host typed in for Graph counts for nothing.
    expect(
      ServerChannelSetup.getEmailSetUpProblem({
        emailServerType: EmailServerType.CustomSMTP,
        smtpTransportType: MailTransportType.MicrosoftGraph,
        smtpHost: new Hostname("smtp.example.com"),
      }),
    ).toBe(EMAIL_NOT_SET_UP_PROBLEM);
  });

  test("SendGrid needs its key, sender and name", () => {
    const sendgrid: ServerChannelSetupSettings = {
      emailServerType: EmailServerType.Sendgrid,
      sendgridApiKey: "SG.key",
      sendgridFromEmail: new Email("alerts@example.com"),
      sendgridFromName: "OneUptime",
    };

    expect(ServerChannelSetup.getEmailSetUpProblem(sendgrid)).toBeNull();
    expect(
      ServerChannelSetup.getEmailSetUpProblem({
        ...sendgrid,
        sendgridApiKey: "",
      }),
    ).toBe("SendGrid: the API Key is not set under Settings > Emails.");
    expect(
      ServerChannelSetup.getEmailSetUpProblem(
        leftBlank(sendgrid, "sendgridFromName"),
      ),
    ).toBe("SendGrid: the From Name is not set under Settings > Emails.");
    // A full mail server does not stand in for the provider that is picked.
    expect(
      ServerChannelSetup.getEmailSetUpProblem({
        ...smtp(),
        emailServerType: EmailServerType.Sendgrid,
      }),
    ).toBe("SendGrid: the API Key is not set under Settings > Emails.");
  });

  test("Amazon SES needs its keys, a real Region and a sender", () => {
    const ses: ServerChannelSetupSettings = {
      emailServerType: EmailServerType.AmazonSES,
      amazonSesAccessKeyId: "AKIA",
      amazonSesSecretAccessKey: "secret",
      amazonSesRegion: " US-EAST-1 ",
      amazonSesFromEmail: new Email("alerts@example.com"),
    };

    expect(ServerChannelSetup.getEmailSetUpProblem(ses)).toBeNull();
    expect(
      ServerChannelSetup.getEmailSetUpProblem({
        ...ses,
        amazonSesRegion: "moon-1",
      }),
    ).toContain("Region");
    expect(
      ServerChannelSetup.getEmailSetUpProblem({
        ...ses,
        amazonSesAccessKeyId: "   ",
      }),
    ).toBe("Amazon SES: the Access Key ID is not set under Settings > Emails.");
    expect(
      ServerChannelSetup.getEmailSetUpProblem(
        leftBlank(ses, "amazonSesSecretAccessKey"),
      ),
    ).toBe(
      "Amazon SES: the Secret Access Key is not set under Settings > Emails.",
    );

    /*
     * An access key picked, or a choice the sender does not know: the same.
     * The column is free text in Postgres, so a row can hold a value the
     * enum lacks.
     */
    for (const amazonSesAuthenticationType of [
      AmazonSesAuthenticationType.AccessKey,
      "Instance Profile" as AmazonSesAuthenticationType,
    ]) {
      expect(
        ServerChannelSetup.getEmailSetUpProblem({
          ...leftBlank(ses, "amazonSesAccessKeyId"),
          amazonSesAuthenticationType,
        }),
      ).toBe(
        "Amazon SES: the Access Key ID is not set under Settings > Emails.",
      );
    }
  });

  test("Amazon SES signing in with the server's IAM role needs no key, only a real Region and a sender (#7000)", () => {
    const role: ServerChannelSetupSettings = {
      emailServerType: EmailServerType.AmazonSES,
      amazonSesAuthenticationType: AmazonSesAuthenticationType.ServerIamRole,
      amazonSesRegion: "eu-west-1",
      amazonSesFromEmail: new Email("alerts@example.com"),
    };

    expect(ServerChannelSetup.getEmailSetUpProblem(role)).toBeNull();
    expect(
      ServerChannelSetup.getEmailSetUpProblem(
        leftBlank(role, "amazonSesRegion"),
      ),
    ).toBe(
      "Amazon SES: the Region (an AWS Region code, such as us-east-1) is not set under Settings > Emails.",
    );
    expect(
      ServerChannelSetup.getEmailSetUpProblem({
        ...role,
        amazonSesRegion: "moon-1",
      }),
    ).toBe(
      "Amazon SES: the Region (an AWS Region code, such as us-east-1) is not set under Settings > Emails.",
    );
    expect(
      ServerChannelSetup.getEmailSetUpProblem(
        leftBlank(role, "amazonSesFromEmail"),
      ),
    ).toBe("Amazon SES: the From Email is not set under Settings > Emails.");

    // A key kept from before is never asked for, nor read.
    expect(
      ServerChannelSetup.getEmailSetUpProblem({
        ...role,
        amazonSesAccessKeyId: "   ",
      }),
    ).toBeNull();
  });

  test("Mailgun needs its key, a sending domain and a sender", () => {
    const mailgun: ServerChannelSetupSettings = {
      emailServerType: EmailServerType.Mailgun,
      mailgunApiKey: "key",
      mailgunDomain: "mg.example.com",
      mailgunFromEmail: new Email("alerts@example.com"),
    };

    expect(ServerChannelSetup.getEmailSetUpProblem(mailgun)).toBeNull();
    expect(
      ServerChannelSetup.getEmailSetUpProblem({
        ...mailgun,
        mailgunDomain: "not a domain",
      }),
    ).toContain("Domain");
  });

  test.each([
    [
      EmailServerType.Postmark,
      "postmarkServerToken",
      "postmarkFromEmail",
      "Server API Token",
    ],
    [EmailServerType.Resend, "resendApiKey", "resendFromEmail", "API Key"],
  ] as Array<
    [
      EmailServerType,
      keyof ServerChannelSetupSettings,
      keyof ServerChannelSetupSettings,
      string,
    ]
  >)(
    "%s needs its key and a sender",
    (
      type: EmailServerType,
      keyColumn: keyof ServerChannelSetupSettings,
      fromColumn: keyof ServerChannelSetupSettings,
      keyName: string,
    ) => {
      const config: ServerChannelSetupSettings = {
        emailServerType: type,
        [keyColumn]: "key",
        [fromColumn]: new Email("alerts@example.com"),
      };

      expect(ServerChannelSetup.getEmailSetUpProblem(config)).toBeNull();
      expect(
        ServerChannelSetup.getEmailSetUpProblem({
          ...config,
          [keyColumn]: undefined,
        }),
      ).toBe(`${type}: the ${keyName} is not set under Settings > Emails.`);
      expect(
        ServerChannelSetup.getEmailSetUpProblem({
          ...config,
          [fromColumn]: undefined,
        }),
      ).toBe(`${type}: the From Email is not set under Settings > Emails.`);
    },
  );

  test("a problem never carries a value: a password, a key, an address", () => {
    const secrets: ServerChannelSetupSettings = leftBlank(
      smtp({
        smtpPassword: "hunter2-password",
        smtpUsername: "mailer-user",
      }),
      "smtpHost",
    );

    const problem: string = ServerChannelSetup.getEmailSetUpProblem(secrets)!;

    expect(problem).not.toContain("hunter2");
    expect(problem).not.toContain("mailer-user");
    expect(problem).not.toContain("alerts@example.com");
  });
});

describe("SMS and calls", () => {
  const twilio: ServerChannelSetupSettings = {
    twilioAccountSID: "AC123",
    twilioAuthToken: "token",
    twilioPrimaryPhoneNumber: new Phone("+14155550123"),
  };

  test("nothing set up: neither goes out", () => {
    expect(
      ServerChannelSetup.getTwilioSetUpProblem({}, TwilioMessageKind.SMS),
    ).toBe(SMS_NOT_SET_UP_PROBLEM);
    expect(
      ServerChannelSetup.getTwilioSetUpProblem(null, TwilioMessageKind.Call),
    ).toBe(CALL_NOT_SET_UP_PROBLEM);
  });

  test("a Twilio account with its number sends both", () => {
    expect(
      ServerChannelSetup.getTwilioSetUpProblem(twilio, TwilioMessageKind.SMS),
    ).toBeNull();
    expect(
      ServerChannelSetup.getTwilioSetUpProblem(twilio, TwilioMessageKind.Call),
    ).toBeNull();
  });

  test("an account used for SMS only makes no calls, and says why", () => {
    const smsOnly: ServerChannelSetupSettings = leftBlank(
      {
        ...twilio,
        twilioUsedFor: TwilioConfigUse.SmsOnly,
        twilioSmsPhoneNumbers: "+14155550123",
      },
      "twilioPrimaryPhoneNumber",
    );

    expect(
      ServerChannelSetup.getTwilioSetUpProblem(smsOnly, TwilioMessageKind.SMS),
    ).toBeNull();
    expect(
      ServerChannelSetup.getTwilioSetUpProblem(smsOnly, TwilioMessageKind.Call),
    ).toMatch(/SMS only/);
  });

  test("the server's own gateway carries both, whatever its Twilio account holds", () => {
    const gateway: ServerChannelSetupSettings = {
      callAndSmsProvider: CallAndSmsProvider.Gateway,
      callAndSmsGatewayUrl: "https://gateway.example.com/send",
    };

    expect(
      ServerChannelSetup.getSetUpProblem(ServerSendingChannel.SMS, gateway),
    ).toBeNull();
    expect(
      ServerChannelSetup.getSetUpProblem(ServerSendingChannel.Call, gateway),
    ).toBeNull();
  });
});

describe("push notifications", () => {
  test("need nothing set up until a master admin turns them off", () => {
    expect(
      ServerChannelSetup.getSetUpProblem(ServerSendingChannel.Push, {}),
    ).toBeNull();
    expect(
      ServerChannelSetup.getSetUpProblem(ServerSendingChannel.Push, {
        disablePushNotifications: true,
      }),
    ).toBe(PUSH_TURNED_OFF_PROBLEM);
  });
});

describe("which channels a settings save starts again", () => {
  test.each([
    [{ smtpHost: "smtp.example.com" }, [ServerSendingChannel.Email]],
    [{ emailServerType: EmailServerType.Resend }, [ServerSendingChannel.Email]],
    [{ resendApiKey: null }, [ServerSendingChannel.Email]],
    [
      { twilioAuthToken: "token" },
      [ServerSendingChannel.SMS, ServerSendingChannel.Call],
    ],
    [{ disablePushNotifications: false }, [ServerSendingChannel.Push]],
    [{ disableSignup: true }, []],
    [{ serverSendingHealth: {} }, []],
  ] as Array<[Record<string, unknown>, Array<ServerSendingChannel>]>)(
    "a write of %j starts %j again",
    (data: Record<string, unknown>, expected: Array<ServerSendingChannel>) => {
      expect(ServerChannelSetup.getChannelsWrittenBy(data)).toEqual(expected);
    },
  );

  test.each([null, undefined, "text"])("%p writes nothing", (data: unknown) => {
    expect(ServerChannelSetup.getChannelsWrittenBy(data)).toEqual([]);
  });

  test("every email setting GlobalConfig holds is one that starts email again", () => {
    const model: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../Models/DatabaseModels/GlobalConfig.ts",
      ),
      "utf8",
    );

    const emailColumns: Array<string> = Array.from(
      model.matchAll(
        /public ((?:smtp|isSMTP|sendgrid|amazonSes|mailgun|postmark|resend|emailServer)[A-Za-z]*)\?:/g,
      ),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(emailColumns.length).toBeGreaterThan(25);
    expect(
      [...SERVER_CHANNEL_SETTING_COLUMNS[ServerSendingChannel.Email]].sort(),
    ).toEqual(emailColumns.sort());
  });

  test("every column the answers read is in the select", () => {
    for (const column of [
      ...SERVER_CHANNEL_SETTING_COLUMNS[ServerSendingChannel.SMS],
      "disablePushNotifications",
      "emailServerType",
      "smtpHost",
      "sendgridApiKey",
      "resendFromEmail",
    ]) {
      expect(
        (SERVER_CHANNEL_SETUP_SELECT as Record<string, unknown>)[column],
      ).toBe(true);
    }

    // What the server remembers is read beside it, never as a setting.
    expect(
      (SERVER_CHANNEL_SETUP_SELECT as Record<string, unknown>)[
        "serverSendingHealth"
      ],
    ).toBeUndefined();
  });
});
