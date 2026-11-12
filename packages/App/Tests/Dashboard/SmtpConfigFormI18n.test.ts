import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Adding a mail server asks for the server, the sign-in and the sender, with
 * the transport, TLS, sign-in type and OAuth folded under an Advanced header
 * that says how mail is sent (Common/UI/Components/SmtpConfig/
 * SmtpConfigFormFields). The same builder draws a project's Custom SMTP
 * config in the Dashboard and the instance's mail server in the Admin
 * Dashboard, and both look every word up by its English text in their own
 * locale files - so a string either app's locales do not carry stays
 * English for everyone. This pins the strings the change added, translated,
 * in all seventeen locales of both apps, and that the old form's words for
 * the TLS switch and the From Email are drawn no more.
 *
 * A project's config can also send through a provider's HTTP API (Amazon
 * SES, SendGrid, Mailgun, Postmark, Resend): the provider is picked from a
 * card each, and its key asked on a step of its own. The instance's
 * provider cards in the Admin Dashboard ask the same fields, so those
 * strings are pinned in both apps, worded alike.
 *
 * The instance's Amazon SES card also asks how the server signs in: with an
 * access key, or with the IAM role AWS gives the server itself (#7000). A
 * project's config always signs in with a key, so those strings are the
 * Admin Dashboard's alone.
 */

const APP_ROOT: string = path.join(__dirname, "..", "..");

const DASHBOARD_SRC: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Dashboard",
  "src",
);

const ADMIN_SRC: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "AdminDashboard",
  "src",
);

const COMMON_UI: string = path.join(APP_ROOT, "..", "Common", "UI");

const BUILDER_FILE: string = path.join(
  COMMON_UI,
  "Components",
  "SmtpConfig",
  "SmtpConfigFormFields.ts",
);

const DASHBOARD_LOCALES: string = path.join(DASHBOARD_SRC, "Locales");
const ADMIN_LOCALES: string = path.join(ADMIN_SRC, "Locales");

// Every string the change added, as the builder writes it.
const NEW_STRINGS: Array<string> = [
  // The steps and the switch.
  "Sender",
  "Require TLS",
  // What each field is for.
  "The port your provider gives you, usually 587. Port 465 is always encrypted.",
  "The account OneUptime signs in as, often the email address you send from. With OAuth, enter the email address of the mailbox that sends.",
  "The account's password, or the API key your provider gives you for SMTP.",
  "Send mail only over an encrypted connection with a valid certificate. When off, the certificate is not checked. Port 465 is always encrypted.",
  "The address your emails come from. Your server must allow sending from it; with Microsoft Graph, it is the mailbox that sends.",
  // What the folded Advanced header says.
  "Mail is sent over SMTP, signing in with the username and password.",
  "Mail is sent over SMTP, signing in with OAuth.",
  "Mail is sent over SMTP without signing in.",
  "Mail is sent through Microsoft Graph, signing in with OAuth.",
  "TLS is required.",
  "TLS is used only if the server offers it.",
  "Port 465 is always encrypted, but the certificate is not checked.",
  /*
   * Transport, Authentication Type and OAuth Provider Type as plain
   * answers: what each asks, and one line under each answer.
   */
  "How OneUptime sends your mail.",
  "Works with most mail servers.",
  "For a Microsoft 365 tenant with SMTP AUTH turned off.",
  "How OneUptime signs in to your mail server.",
  "The account's password, or an API key your provider gives you.",
  "For Microsoft 365 and Google Workspace, where passwords are often turned off.",
  "For a relay that needs no sign-in.",
  "The OAuth grant your provider uses.",
  "Microsoft 365 and most other providers.",
  "Google Workspace service accounts.",
  // The From Name's line.
  "The name people see your emails come from.",
];

/*
 * Labels the builder draws that the Admin Dashboard's small locale files
 * did not carry before (the Dashboard's already had them), and the sign-in
 * answer both apps now word the same.
 */
const ADMIN_ALSO: Array<string> = [
  "Server",
  "Username",
  "Username and Password",
];

/*
 * The provider strings both apps draw: a project's provider cards and
 * steps, and the instance's provider cards, from the same builder.
 */
const PROVIDER_STRINGS: Array<string> = [
  // The provider cards' titles and lines.
  "Provider",
  "SMTP Server",
  "Send through Amazon Simple Email Service with an IAM access key.",
  "Send through Mailgun's API with an API key and a sending domain.",
  "Send through Postmark's API with a server API token.",
  "Send through Resend's API with an API key.",
  // Each provider's fields, and what each is for.
  "Access Key ID",
  "Secret Access Key",
  "Region",
  "API Key",
  "Domain",
  "Server API Token",
  "The access key ID of an IAM user allowed to send with Amazon SES (ses:SendEmail).",
  "The secret that goes with the access key ID. It is stored encrypted.",
  "The AWS Region your sender's identity is verified in, such as us-east-1 or eu-west-1.",
  "An API key from your Mailgun account, or a sending key made for this domain. It is stored encrypted.",
  "The sending domain, as Mailgun lists it under Sending > Domains.",
  "The region the domain was created in.",
  "US",
  "EU",
  "Sent through api.mailgun.net.",
  "Sent through api.eu.mailgun.net.",
  "The API token of the Postmark server that sends, from the server's API Tokens tab. It is stored encrypted.",
  "A Resend API key with sending access, from API Keys in Resend. It is stored encrypted.",
  // A provider's sender.
  "The address your emails come from. Your mail server or provider must allow sending from it, such as an address or domain verified there.",
];

/*
 * The provider strings only a project's form draws: its OAuth step, what
 * the provider cards are for, and SendGrid, whose instance card is its own.
 */
const PROJECT_PROVIDER_STRINGS: Array<string> = [
  "OAuth",
  "How OneUptime sends this project's email.",
  "Send through SendGrid's API with an API key.",
  "A SendGrid API key with the Mail Send permission, from SendGrid's Settings > API Keys. It is stored encrypted.",
];

/*
 * The strings only the instance's Amazon SES card draws: how it signs in,
 * its two answers, and the provider card's line that names the role.
 */
const ADMIN_PROVIDER_STRINGS: Array<string> = [
  "How OneUptime signs in to Amazon SES.",
  "Access Key",
  "An IAM user's access key ID and secret access key, stored encrypted.",
  "This Server's IAM Role",
  "The role AWS gives this server on Amazon EKS, ECS or EC2. No key is stored, and its credentials renew on their own.",
  "Send through Amazon SES with an access key or this server's IAM role.",
];

const DASHBOARD_STRINGS: Array<string> = [
  ...NEW_STRINGS,
  ...PROVIDER_STRINGS,
  ...PROJECT_PROVIDER_STRINGS,
];

const ADMIN_STRINGS: Array<string> = [
  ...NEW_STRINGS,
  ...ADMIN_ALSO,
  ...PROVIDER_STRINGS,
];

/*
 * Labels that read the same in some languages: "Server" in German, "Region"
 * in the Scandinavian languages and German, "Provider" in Dutch and Italian;
 * OAuth, and Mailgun's two regions, US and EU, everywhere.
 */
const MAY_READ_AS_ENGLISH: Array<string> = [
  "Server",
  "Region",
  "Provider",
  "OAuth",
  "US",
  "EU",
];

/*
 * The old form's words for what changed. Their keys stay in the locale
 * files, as retired keys do, but nothing draws them. ("SMTP Server", the
 * old form's step, is drawn again: it is the provider card of a mail
 * server now, and its translations name a mail server.)
 */
const RETIRED_STRINGS: Array<string> = [
  "Use SSL / TLS",
  "Enable secure email communication. Recommended for most providers.",
  "If you use port 465, please enable this. Do not enable this if you use port 587.",
  "SMTP port. Common ports: 587 (STARTTLS), 465 (SSL/TLS)",
  "Email used to log in to this SMTP Server. This is also the email your customers will see. ",
  "For OAuth, this should be the email address you want to send from.",
  "Required for Username and Password authentication. Not used for OAuth.",
  "How OneUptime delivers mail for this config. Choose 'SMTP' for most servers. Choose 'Microsoft Graph' if your Microsoft 365 tenant has SMTP AUTH disabled — Graph uses the Mail.Send application permission and bypasses SMTP entirely.",
  "How OneUptime delivers mail using the global SMTP config. Choose 'SMTP' for most servers. Choose 'Microsoft Graph' if your Microsoft 365 tenant has SMTP AUTH disabled — Graph uses the Mail.Send application permission and bypasses SMTP entirely.",
  "Email From",
  "Username / Email",
  "OAuth Settings",
  // The descriptions that named every answer, before the answers said it.
  "SMTP works with most mail servers. Pick Microsoft Graph if your Microsoft 365 tenant has SMTP AUTH turned off.",
  "Select the authentication method. Use OAuth for providers like Microsoft 365, Google Workspace, etc.",
  "Select the OAuth grant type. Use 'Client Credentials' for Microsoft 365 and most providers. Use 'JWT Bearer' for Google Workspace service accounts.",
  "This is the display name your team and customers see, when they receive emails from OneUptime.",
  "Friendly description for this config so you remember what this is about.",
  "Friendly name for this config so you remember what this is about.",
];

const SENTENCE_ENDINGS: Array<string> = [".", "。", "।"];

type Locale = Record<string, unknown>;

function readLocale(directory: string, file: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(directory, file), "utf8"),
  ) as Locale;
}

function localeFiles(directory: string): Array<string> {
  return fs
    .readdirSync(directory)
    .filter((file: string): boolean => {
      return file.endsWith(".json");
    })
    .sort();
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

const TYPESCRIPT_FILE: RegExp = /\.tsx?$/;

function listSources(directory: string): Array<string> {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return ["node_modules", "Locales", "build", "dist"].includes(entry.name)
          ? []
          : listSources(full);
      }

      return TYPESCRIPT_FILE.test(entry.name) ? [full] : [];
    });
}

// The code the strings are drawn from, without the prose about it.
const CODE: string = [
  ...listSources(DASHBOARD_SRC),
  ...listSources(ADMIN_SRC),
  ...listSources(COMMON_UI),
]
  .map((file: string): string => {
    return stripComments(fs.readFileSync(file, "utf8"));
  })
  .join("\n");

const BUILDER: string = stripComments(fs.readFileSync(BUILDER_FILE, "utf8"));

/*
 * What is wrong with a translation: missing, still English (unless the
 * word reads the same), or a sentence turned into a label or back.
 */
function findProblems(text: string, value: unknown): Array<string> {
  if (typeof value !== "string" || value.trim().length === 0) {
    return [`missing: ${text}`];
  }

  if (value === text && !MAY_READ_AS_ENGLISH.includes(text)) {
    return [`left in English: ${text}`];
  }

  const isSentence: boolean = text.endsWith(".");
  const endsLikeSentence: boolean = SENTENCE_ENDINGS.some(
    (ending: string): boolean => {
      return value.trim().endsWith(ending);
    },
  );

  if (isSentence !== endsLikeSentence) {
    return [`punctuation differs: ${text}`];
  }

  return [];
}

const DASHBOARD_FILES: Array<string> = localeFiles(DASHBOARD_LOCALES);
const ADMIN_FILES: Array<string> = localeFiles(ADMIN_LOCALES);

describe("the mail server forms' strings", () => {
  test("eighteen locales of each app are checked", () => {
    expect(DASHBOARD_FILES).toHaveLength(18);
    expect(ADMIN_FILES).toEqual(DASHBOARD_FILES);
  });

  test("each new string is the builder's, written whole", () => {
    const unused: Array<string> = [
      ...NEW_STRINGS,
      ...ADMIN_ALSO,
      ...PROVIDER_STRINGS,
      ...PROJECT_PROVIDER_STRINGS,
      ...ADMIN_PROVIDER_STRINGS,
    ].filter((text: string): boolean => {
      return !BUILDER.includes(`"${text}"`);
    });

    expect(unused).toEqual([]);
  });

  test("none of the old form's words for what changed is drawn any more", () => {
    const drawn: Array<string> = RETIRED_STRINGS.filter(
      (text: string): boolean => {
        return CODE.includes(`"${text}"`);
      },
    );

    expect(drawn).toEqual([]);
  });

  test("English carries every new string as itself, in both apps", () => {
    for (const [directory, strings] of [
      [DASHBOARD_LOCALES, DASHBOARD_STRINGS],
      [ADMIN_LOCALES, [...ADMIN_STRINGS, ...ADMIN_PROVIDER_STRINGS]],
    ] as Array<[string, Array<string>]>) {
      const english: Locale = readLocale(directory, "en.json");

      expect(
        strings.filter((text: string): boolean => {
          return english[text] !== text;
        }),
      ).toEqual([]);
    }
  });

  test.each(
    DASHBOARD_FILES.filter((file: string) => {
      return file !== "en.json";
    }),
  )("the Dashboard's %s translates every new string", (file: string) => {
    const locale: Locale = readLocale(DASHBOARD_LOCALES, file);

    expect(
      DASHBOARD_STRINGS.flatMap((text: string): Array<string> => {
        return findProblems(text, locale[text]);
      }),
    ).toEqual([]);
  });

  test.each(
    ADMIN_FILES.filter((file: string) => {
      return file !== "en.json";
    }),
  )(
    "the Admin Dashboard's %s translates every new string, as the Dashboard does",
    (file: string) => {
      const admin: Locale = readLocale(ADMIN_LOCALES, file);
      const dashboard: Locale = readLocale(DASHBOARD_LOCALES, file);

      expect(
        ADMIN_STRINGS.flatMap((text: string): Array<string> => {
          return findProblems(text, admin[text]);
        }),
      ).toEqual([]);

      // One wording per language, whichever app draws the form.
      expect(
        ADMIN_STRINGS.filter((text: string): boolean => {
          return admin[text] !== dashboard[text];
        }),
      ).toEqual([]);
    },
  );

  test.each(
    ADMIN_FILES.filter((file: string) => {
      return file !== "en.json";
    }),
  )(
    "the Admin Dashboard's %s translates how the server signs in to Amazon SES",
    (file: string) => {
      const admin: Locale = readLocale(ADMIN_LOCALES, file);

      expect(
        ADMIN_PROVIDER_STRINGS.flatMap((text: string): Array<string> => {
          return findProblems(text, admin[text]);
        }),
      ).toEqual([]);
    },
  );

  /*
   * npm run i18n:extract reads Common's UI for the Dashboard too, so the
   * instance's Amazon SES strings are in its files as well, and the
   * GlobalConfig column's title with them. Worded as the Admin Dashboard
   * words them, never left as the English the extractor put there.
   */
  test.each(
    DASHBOARD_FILES.filter((file: string) => {
      return file !== "en.json";
    }),
  )(
    "the Dashboard's %s words how the server signs in to Amazon SES as the Admin Dashboard does",
    (file: string) => {
      const admin: Locale = readLocale(ADMIN_LOCALES, file);
      const dashboard: Locale = readLocale(DASHBOARD_LOCALES, file);

      expect(
        [...ADMIN_PROVIDER_STRINGS, "Amazon SES Authentication Type"].flatMap(
          (text: string): Array<string> => {
            return findProblems(text, dashboard[text]);
          },
        ),
      ).toEqual([]);

      expect(
        ADMIN_PROVIDER_STRINGS.filter((text: string): boolean => {
          return admin[text] !== dashboard[text];
        }),
      ).toEqual([]);
    },
  );

  test.each(
    DASHBOARD_FILES.filter((file: string) => {
      return file !== "en.json";
    }),
  )(
    "the Dashboard's %s names From Email in its own language, as the old Email From was",
    (file: string) => {
      const locale: Locale = readLocale(DASHBOARD_LOCALES, file);

      expect(findProblems("From Email", locale["From Email"])).toEqual([]);
    },
  );
});
