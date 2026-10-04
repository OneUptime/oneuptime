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
  "The account OneUptime signs in as, often the email address you send from.",
  "The account's password, or the API key your provider gives you for SMTP.",
  "SMTP works with most mail servers. Choose Microsoft Graph if your Microsoft 365 tenant has SMTP AUTH turned off: mail then goes through the Graph API with an app that has the Mail.Send permission, and the hostname, port and password are not used.",
  "Mail is sent only over an encrypted connection with a valid certificate. When this is off, mail is encrypted only if the server offers it, and the certificate is not checked. Port 465 is always encrypted.",
  "The address your emails come from. Your server must allow sending from it; with Microsoft Graph, it is the mailbox that sends.",
  // What the folded Advanced header says.
  "Mail is sent over SMTP, signing in with the username and password.",
  "Mail is sent over SMTP, signing in with OAuth.",
  "Mail is sent over SMTP without signing in.",
  "Mail is sent through Microsoft Graph, signing in with OAuth.",
  "TLS is required.",
  "TLS is used only if the server offers it.",
];

/*
 * Labels the builder draws that the Admin Dashboard's small locale files
 * did not carry before (the Dashboard's already had them).
 */
const ADMIN_ALSO: Array<string> = ["Server", "Username"];

// Labels that read the same in some languages ("Server" in German).
const MAY_READ_AS_ENGLISH: Array<string> = ["Server"];

/*
 * The old form's words for what changed. Their keys stay in the locale
 * files, as retired keys do, but nothing draws them.
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
  "SMTP Server",
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
  test("seventeen locales of each app are checked", () => {
    expect(DASHBOARD_FILES).toHaveLength(17);
    expect(ADMIN_FILES).toEqual(DASHBOARD_FILES);
  });

  test("each new string is the builder's, written whole", () => {
    const unused: Array<string> = [...NEW_STRINGS, ...ADMIN_ALSO].filter(
      (text: string): boolean => {
        return !BUILDER.includes(`"${text}"`);
      },
    );

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
      [DASHBOARD_LOCALES, NEW_STRINGS],
      [ADMIN_LOCALES, [...NEW_STRINGS, ...ADMIN_ALSO]],
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
      NEW_STRINGS.flatMap((text: string): Array<string> => {
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
        [...NEW_STRINGS, ...ADMIN_ALSO].flatMap(
          (text: string): Array<string> => {
            return findProblems(text, admin[text]);
          },
        ),
      ).toEqual([]);

      // One wording per language, whichever app draws the form.
      expect(
        [...NEW_STRINGS, ...ADMIN_ALSO].filter((text: string): boolean => {
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
