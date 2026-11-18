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
  ServerSetUpProblemReading,
} from "../../../../Server/Utils/ServerSending/ServerChannelSetup";
import ServerSetUpProblem, {
  SERVER_EMAIL_SETTING_NAMES,
  SERVER_SET_UP_PROBLEMS,
} from "../../../../Types/ServerSending/ServerSetUpProblem";
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

  /*
   * #7458: an installation's settings were seeded with port 25 when
   * SMTP_PORT was not set (UpdateGlobalConfigFromEnv), and a port is what
   * every mail server has, so it says nothing about whether anybody set
   * one up. Counted, a server nobody had touched read as half set up, and
   * its first missing field was named: "SMTP: the From Email is not set
   * under Settings > Emails." - as if the host, the sign-in and the name
   * were done.
   */
  describe("a port alone is nothing set up (#7458)", () => {
    test("the row a fresh server was seeded with: port 25, the rest empty", () => {
      expect(
        ServerChannelSetup.getEmailSetUpProblem({
          emailServerType: EmailServerType.CustomSMTP,
          smtpPort: new Port(25),
          smtpUsername: "",
          smtpPassword: "",
          smtpFromName: "",
          smtpAuthType: SMTPAuthenticationType.UsernamePassword,
        }),
      ).toBe(EMAIL_NOT_SET_UP_PROBLEM);
    });

    test.each([25, 465, 587, 2525])("port %p on its own", (port: number) => {
      expect(
        ServerChannelSetup.getEmailSetUpProblem({ smtpPort: new Port(port) }),
      ).toBe(EMAIL_NOT_SET_UP_PROBLEM);
    });

    test("a port with only how to sign in picked is still nothing set up", () => {
      for (const authType of [
        SMTPAuthenticationType.UsernamePassword,
        SMTPAuthenticationType.OAuth,
        SMTPAuthenticationType.None,
      ]) {
        expect({
          authType,
          problem: ServerChannelSetup.getEmailSetUpProblem({
            smtpPort: new Port(25),
            smtpAuthType: authType,
            smtpTransportType: MailTransportType.SMTP,
          }),
        }).toEqual({ authType, problem: EMAIL_NOT_SET_UP_PROBLEM });
      }
    });

    test("Microsoft Graph with only a port left from SMTP is nothing set up", () => {
      expect(
        ServerChannelSetup.getEmailSetUpProblem({
          smtpTransportType: MailTransportType.MicrosoftGraph,
          smtpPort: new Port(25),
        }),
      ).toBe(EMAIL_NOT_SET_UP_PROBLEM);
    });

    /*
     * Anything else filled in is a start: what is still missing is named,
     * the port among it.
     */
    test.each([
      [
        "a host",
        { smtpHost: new Hostname("smtp.example.com") },
        "SMTP: the From Email is not set under Settings > Emails.",
      ],
      [
        "a From Email",
        { smtpFromEmail: new Email("alerts@example.com") },
        "SMTP: the From Name is not set under Settings > Emails.",
      ],
      [
        "a From Name",
        { smtpFromName: "OneUptime" },
        "SMTP: the From Email is not set under Settings > Emails.",
      ],
      [
        "a username",
        { smtpUsername: "mailer" },
        "SMTP: the From Email is not set under Settings > Emails.",
      ],
      [
        "a password",
        { smtpPassword: "secret" },
        "SMTP: the From Email is not set under Settings > Emails.",
      ],
    ] as Array<[string, ServerChannelSetupSettings, string]>)(
      "a port with %s: what is still missing is named",
      (_name: string, set: ServerChannelSetupSettings, expected: string) => {
        expect(
          ServerChannelSetup.getEmailSetUpProblem({
            smtpPort: new Port(25),
            ...set,
          }),
        ).toBe(expected);
      },
    );

    test("a mail server with everything but its port names the Port", () => {
      expect(
        ServerChannelSetup.getEmailSetUpProblem(leftBlank(smtp(), "smtpPort")),
      ).toBe("SMTP: the Port is not set under Settings > Emails.");
    });

    test("a seeded port 25 with the rest filled in is set up: 25 is a port like any other", () => {
      expect(
        ServerChannelSetup.getEmailSetUpProblem(
          smtp({ smtpPort: new Port(25) }),
        ),
      ).toBeNull();
    });
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

  /*
   * Over SMTP, OAuth signs in as a mailbox - the user the XOAUTH2 sign-in
   * names, with either grant - and the sender refuses every email without
   * one (#7833). Read as set up, the sign-in pages would offer a reset
   * email that never comes.
   */
  test("a mail server that signs in with OAuth needs the mailbox it signs in as; Microsoft Graph does not", () => {
    // No password: OAuth signs in with a token, as the mailbox.
    const oauth: ServerChannelSetupSettings = leftBlank(
      smtp({
        smtpAuthType: SMTPAuthenticationType.OAuth,
        smtpUsername: "alerts@example.com",
        smtpClientId: "client",
        smtpClientSecret: "client-secret",
        smtpTokenUrl: "https://login.example.com/token",
        smtpScope: "https://outlook.office365.com/.default",
      }),
      "smtpPassword",
    );

    expect(ServerChannelSetup.getEmailSetUpProblem(oauth)).toBeNull();

    for (const withoutUsername of [
      leftBlank(oauth, "smtpUsername"),
      { ...oauth, smtpUsername: "" },
    ]) {
      expect(ServerChannelSetup.getEmailSetUpProblem(withoutUsername)).toBe(
        "SMTP: the Username is not set under Settings > Emails.",
      );
    }

    // Named before the OAuth app, as the form asks for it first.
    expect(
      ServerChannelSetup.getEmailSetUpProblem(
        leftBlank(oauth, "smtpUsername", "smtpClientId"),
      ),
    ).toBe("SMTP: the Username is not set under Settings > Emails.");

    // Microsoft Graph sends as the From Email: a username left over is not read.
    const graph: ServerChannelSetupSettings = {
      ...leftBlank(oauth, "smtpUsername", "smtpHost", "smtpPort"),
      smtpTransportType: MailTransportType.MicrosoftGraph,
    };

    expect(ServerChannelSetup.getEmailSetUpProblem(graph)).toBeNull();

    // Signing in with a password, or not at all, it never asked for OAuth's mailbox.
    expect(
      ServerChannelSetup.getEmailSetUpProblem(
        leftBlank(
          smtp({ smtpAuthType: SMTPAuthenticationType.None }),
          "smtpUsername",
          "smtpPassword",
        ),
      ),
    ).toBeNull();
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

/*
 * #9437: what a channel's settings are missing is sent as words too - one
 * of OneUptime's own sentences, a provider's name and a setting's name -
 * so the Admin Dashboard says it in its reader's language. The English is
 * the same sentence, word for word; what is wrong with the environment
 * variables has no words, and is drawn as it came.
 */
describe("what is missing, in words every language has", () => {
  // Every problem a row can have, from settings left blank one way after another.
  const emailRows: Array<ServerChannelSetupSettings> = [
    {},
    { smtpPort: new Port(25) },
    leftBlank(smtp(), "smtpFromEmail"),
    leftBlank(smtp(), "smtpFromName"),
    leftBlank(smtp(), "smtpHost"),
    leftBlank(smtp(), "smtpPort"),
    smtp({ smtpAuthType: SMTPAuthenticationType.OAuth }),
    leftBlank(
      smtp({ smtpAuthType: SMTPAuthenticationType.OAuth }),
      "smtpUsername",
    ),
    smtp({
      smtpAuthType: SMTPAuthenticationType.OAuth,
      smtpClientId: "client",
    }),
    smtp({
      smtpAuthType: SMTPAuthenticationType.OAuth,
      smtpClientId: "client",
      smtpClientSecret: "secret",
    }),
    smtp({
      smtpAuthType: SMTPAuthenticationType.OAuth,
      smtpClientId: "client",
      smtpClientSecret: "secret",
      smtpTokenUrl: "https://login.example.com/token",
    }),
    {
      smtpTransportType: MailTransportType.MicrosoftGraph,
      smtpFromEmail: new Email("alerts@example.com"),
    },
    { emailServerType: EmailServerType.Sendgrid },
    { emailServerType: EmailServerType.Sendgrid, sendgridApiKey: "key" },
    {
      emailServerType: EmailServerType.Sendgrid,
      sendgridApiKey: "key",
      sendgridFromEmail: new Email("alerts@example.com"),
    },
    { emailServerType: EmailServerType.AmazonSES },
    {
      emailServerType: EmailServerType.AmazonSES,
      amazonSesAccessKeyId: "AKIA",
    },
    {
      emailServerType: EmailServerType.AmazonSES,
      amazonSesAccessKeyId: "AKIA",
      amazonSesSecretAccessKey: "secret",
      amazonSesRegion: "moon-1",
    },
    {
      emailServerType: EmailServerType.AmazonSES,
      amazonSesAccessKeyId: "AKIA",
      amazonSesSecretAccessKey: "secret",
      amazonSesRegion: "us-east-1",
    },
    { emailServerType: EmailServerType.Mailgun },
    { emailServerType: EmailServerType.Mailgun, mailgunApiKey: "key" },
    {
      emailServerType: EmailServerType.Mailgun,
      mailgunApiKey: "key",
      mailgunDomain: "mg.example.com",
    },
    { emailServerType: EmailServerType.Postmark },
    { emailServerType: EmailServerType.Postmark, postmarkServerToken: "t" },
    { emailServerType: EmailServerType.Resend },
    { emailServerType: EmailServerType.Resend, resendApiKey: "key" },
  ];

  test("every email problem has words, and they say the English sentence word for word", () => {
    const templates: Set<string> = new Set<string>();

    for (const row of emailRows) {
      const english: string | null =
        ServerChannelSetup.getEmailSetUpProblem(row);
      const reading: ServerSetUpProblemReading | null =
        ServerChannelSetup.readEmailSetUpProblem(row);

      expect({ row, hasProblem: Boolean(english) }).toEqual({
        row,
        hasProblem: true,
      });
      expect(reading?.english).toBe(english);
      expect(reading?.words).toBeTruthy();
      expect(ServerSetUpProblem.toEnglish(reading!.words!)).toBe(english);

      // What a browser reads back is the same words.
      expect(
        ServerSetUpProblem.parse(JSON.parse(JSON.stringify(reading!.words))),
      ).toEqual(reading!.words);

      templates.add(reading!.words!.template);
    }

    expect(Array.from(templates).sort()).toEqual(
      [
        SERVER_SET_UP_PROBLEMS.emailNotSetUp,
        SERVER_SET_UP_PROBLEMS.emailSettingNotSet,
      ].sort(),
    );
  });

  test("a setting is named by the key the settings form draws it with", () => {
    expect(
      ServerChannelSetup.readEmailSetUpProblem({
        emailServerType: EmailServerType.Sendgrid,
      })?.words,
    ).toEqual({
      template: SERVER_SET_UP_PROBLEMS.emailSettingNotSet,
      values: {
        provider: "SendGrid",
        field: SERVER_EMAIL_SETTING_NAMES.apiKey,
      },
    });
    expect(
      ServerChannelSetup.readEmailSetUpProblem({
        emailServerType: EmailServerType.Mailgun,
        mailgunApiKey: "key",
      })?.words?.values.field,
    ).toBe(SERVER_EMAIL_SETTING_NAMES.mailgunDomain);
  });

  test("SMS and calls: not set up, used for one kind only, or no number to send from", () => {
    const twilio: ServerChannelSetupSettings = {
      twilioAccountSID: "AC123",
      twilioAuthToken: "token",
      twilioPrimaryPhoneNumber: new Phone("+14155550123"),
    };
    const smsOnly: ServerChannelSetupSettings = leftBlank(
      {
        ...twilio,
        twilioUsedFor: TwilioConfigUse.SmsOnly,
        twilioSmsPhoneNumbers: "+14155550123",
      },
      "twilioPrimaryPhoneNumber",
    );
    const callsOnly: ServerChannelSetupSettings = {
      ...twilio,
      twilioUsedFor: TwilioConfigUse.CallsOnly,
    };

    const cases: Array<{
      config: ServerChannelSetupSettings | null;
      kind: TwilioMessageKind;
      template: string;
    }> = [
      {
        config: null,
        kind: TwilioMessageKind.SMS,
        template: SERVER_SET_UP_PROBLEMS.smsNotSetUp,
      },
      {
        config: {},
        kind: TwilioMessageKind.Call,
        template: SERVER_SET_UP_PROBLEMS.callNotSetUp,
      },
      {
        config: smsOnly,
        kind: TwilioMessageKind.Call,
        template: SERVER_SET_UP_PROBLEMS.twilioUsedForSmsOnly,
      },
      {
        config: callsOnly,
        kind: TwilioMessageKind.SMS,
        template: SERVER_SET_UP_PROBLEMS.twilioUsedForCallsOnly,
      },
    ];

    for (const item of cases) {
      const reading: ServerSetUpProblemReading | null =
        ServerChannelSetup.readTwilioSetUpProblem(item.config, item.kind);

      expect(reading?.words).toEqual({ template: item.template, values: {} });
      expect(reading?.english).toBe(item.template);
      expect(reading?.english).toBe(
        ServerChannelSetup.getTwilioSetUpProblem(item.config, item.kind),
      );
    }

    expect(
      ServerChannelSetup.readTwilioSetUpProblem(twilio, TwilioMessageKind.SMS),
    ).toBeNull();
  });

  test("push turned off: the test push's own words", () => {
    expect(
      ServerChannelSetup.readSetUpProblem(ServerSendingChannel.Push, {
        disablePushNotifications: true,
      }),
    ).toEqual({
      english: PUSH_TURNED_OFF_PROBLEM,
      words: { template: PUSH_TURNED_OFF_PROBLEM, values: {} },
    });
  });

  test("every channel's reading is its sentence: nothing for a channel that is set up", () => {
    for (const channel of [
      ServerSendingChannel.Email,
      ServerSendingChannel.SMS,
      ServerSendingChannel.Call,
      ServerSendingChannel.Push,
    ]) {
      const reading: ServerSetUpProblemReading | null =
        ServerChannelSetup.readSetUpProblem(channel, {});

      expect(reading?.english || null).toBe(
        ServerChannelSetup.getSetUpProblem(channel, {}),
      );
    }

    expect(
      ServerChannelSetup.readSetUpProblem(ServerSendingChannel.Email, smtp()),
    ).toBeNull();
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

  test("every column the answers and the settings' fingerprints read is in the select", () => {
    for (const column of [
      ...SERVER_CHANNEL_SETTING_COLUMNS[ServerSendingChannel.SMS],
      "disablePushNotifications",
      // Every email column: email's fingerprint reads all of its type's (#7803).
      ...SERVER_CHANNEL_SETTING_COLUMNS[ServerSendingChannel.Email],
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
