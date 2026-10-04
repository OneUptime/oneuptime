import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The SMTP guide (emails/smtp.md), against the forms it describes, in every
 * docs language.
 *
 * Adding a mail server - a project's Custom SMTP config, or the instance's
 * own server in the Admin Dashboard - walks two steps: Server (the name, the
 * hostname, the port, the username and the password) and Sender (From Email,
 * From Name). Transport, Require TLS, the authentication type, the OAuth
 * fields and the description wait folded under Advanced
 * (Common/UI/Components/SmtpConfig/SmtpConfigFormFields). The guide only
 * told people how to fill in OAuth, called the TLS switch "Secure (TLS)",
 * and said nothing of Microsoft Graph, whose Transport moved under
 * Advanced. These pin it to the forms: each language's guide says where
 * each setting is in the words that language's dashboard shows, quotes the
 * folded header as the dashboard words it, says what Require TLS does as
 * the switch's own help does, and walks a Microsoft Graph user to its
 * Transport. Persian guides keep the dashboard's English names, as the rest
 * of the Persian docs do.
 *
 * Markdown is not compiled and App tests read no React module, so the
 * builder's English is read from its source file.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

const DASHBOARD_LOCALES_DIR: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Locales",
);

const ADMIN_LOCALES_DIR: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/AdminDashboard/src/Locales",
);

const BUILDER_FILE: string = path.join(
  REPO_ROOT,
  "Common/UI/Components/SmtpConfig/SmtpConfigFormFields.ts",
);

const PAGE: string = "emails/smtp.md";

// The labels the guide names, as the forms write them in English.
const STEP_SERVER: string = "Server";
const STEP_SENDER: string = "Sender";
const ADVANCED: string = "Advanced";
const REQUIRE_TLS: string = "Require TLS";
const TRANSPORT: string = "Transport";
const AUTHENTICATION_TYPE: string = "Authentication Type";

const LABELS: Array<string> = [
  "Name",
  "Hostname",
  "Port",
  "Username",
  "Password",
  "From Email",
  "From Name",
  STEP_SERVER,
  STEP_SENDER,
  ADVANCED,
  TRANSPORT,
  REQUIRE_TLS,
  AUTHENTICATION_TYPE,
  "Description",
  "Send Test Email",
];

// What the folded header says for a new config, sentence by sentence.
const SUMMARY_PASSWORD: string =
  "Mail is sent over SMTP, signing in with the username and password.";
const SUMMARY_TLS_REQUIRED: string = "TLS is required.";

// The Require TLS switch's own help.
const REQUIRE_TLS_HELP: string =
  "Mail is sent only over an encrypted connection with a valid certificate. When this is off, mail is encrypted only if the server offers it, and the certificate is not checked. Port 465 is always encrypted.";

// The names the old guide gave the TLS switch, in each language.
const OLD_TLS_LABELS: Array<string> = [
  "Secure (TLS)",
  "Sicher (TLS)",
  "Sécurisé (TLS)",
  "Seguro (TLS)",
  "Beveiligd (TLS)",
  "Sikker (TLS)",
  "Säker (TLS)",
  "セキュア（TLS）",
  "보안 (TLS)",
  "安全（TLS）",
];

type Locale = Record<string, unknown>;

function readJson(file: string): Locale {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Locale;
}

function readPage(lang: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, lang, PAGE), "utf8");
}

/*
 * The words the guide uses for a dashboard label: the dashboard's own
 * translation, or English in the Persian guides (and where a language has
 * none).
 */
function dashboardWords(lang: string): (english: string) => string {
  const locale: Locale = readJson(
    path.join(DASHBOARD_LOCALES_DIR, `${lang}.json`),
  );

  return (english: string): string => {
    if (lang === "fa") {
      return english;
    }

    const translated: unknown = locale[english];

    return typeof translated === "string" && translated ? translated : english;
  };
}

// A sentence as the dashboard shows it in this language (Persian included).
function dashboardSentence(lang: string, english: string): string {
  const translated: unknown = readJson(
    path.join(DASHBOARD_LOCALES_DIR, `${lang}.json`),
  )[english];

  return typeof translated === "string" && translated ? translated : english;
}

function adminText(lang: string, nestedKey: string): string {
  let node: unknown = readJson(path.join(ADMIN_LOCALES_DIR, `${lang}.json`));

  for (const part of nestedKey.split(".")) {
    node = (node as Record<string, unknown>)[part];
  }

  return String(node);
}

function withoutSpaces(text: string): string {
  return text.replace(/\s+/g, "");
}

// The page's "## " sections, by heading, with their text.
function sections(markdown: string): Array<{ heading: string; body: string }> {
  return markdown
    .split(/^## /m)
    .slice(1)
    .map((part: string): { heading: string; body: string } => {
      const newline: number = part.indexOf("\n");

      return {
        heading: part.slice(0, newline).trim(),
        body: part.slice(newline + 1),
      };
    });
}

/*
 * The section that walks through adding a server: the one that names both
 * steps of the form.
 */
function addingSection(lang: string): string {
  const words: (english: string) => string = dashboardWords(lang);

  const found: Array<{ heading: string; body: string }> = sections(
    readPage(lang),
  ).filter((section: { body: string }): boolean => {
    return (
      section.body.includes(`**${words(STEP_SERVER)}**`) &&
      section.body.includes(`**${words(STEP_SENDER)}**`) &&
      section.body.includes(`**${words(ADVANCED)}**`)
    );
  });

  expect(found).toHaveLength(1);

  return found[0]!.body;
}

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

describe("the SMTP guide says where each setting of the two-step form is", () => {
  it("is written in all seventeen docs languages", () => {
    expect(LANGUAGES).toHaveLength(17);
    expect(LANGUAGES).toContain("en");
    expect(LANGUAGES).toContain("fa");
  });

  it("quotes the builder's own English", () => {
    const builder: string = fs.readFileSync(BUILDER_FILE, "utf8");

    for (const text of [
      SUMMARY_PASSWORD,
      SUMMARY_TLS_REQUIRED,
      REQUIRE_TLS_HELP,
      `title: "${REQUIRE_TLS}"`,
      `{ title: "${STEP_SERVER}", id: "server" }`,
      `{ title: "${STEP_SENDER}", id: "sender" }`,
    ]) {
      expect({ text, inBuilder: builder.includes(text) }).toEqual({
        text,
        inBuilder: true,
      });
    }
  });

  it.each(LANGUAGES)(
    "%s: has one section that names every field of the form in the dashboard's words",
    (lang: string) => {
      const words: (english: string) => string = dashboardWords(lang);
      const section: string = addingSection(lang);

      for (const label of LABELS) {
        expect({
          label,
          named: section.includes(`**${words(label)}**`),
        }).toEqual({ label, named: true });
      }

      // A new config's port, and the transport values, as typed.
      expect(section).toContain("`587`");
      expect(section).toContain("`Microsoft Graph`");
      expect(section).toContain("`SMTP`");
      expect(section).toContain("`Username and Password`");
      expect(section).toContain("`None`");
    },
  );

  it.each(LANGUAGES)(
    "%s: names both places a server is added, by their cards",
    (lang: string) => {
      const words: (english: string) => string = dashboardWords(lang);
      const section: string = addingSection(lang);

      expect(section).toContain(`**${words("Custom SMTP Configs")}**`);
      expect(section).toContain("Admin Dashboard");

      const adminCard: string =
        lang === "fa"
          ? adminText("en", "pages.settings.email.smtpCardTitle")
          : adminText(lang, "pages.settings.email.smtpCardTitle");

      expect(section).toContain(`**${adminCard}**`);
    },
  );

  it.each(LANGUAGES)(
    "%s: quotes the folded header as the dashboard words it",
    (lang: string) => {
      const section: string = addingSection(lang);
      const header: string =
        dashboardSentence(lang, SUMMARY_PASSWORD) +
        dashboardSentence(lang, SUMMARY_TLS_REQUIRED);

      expect(withoutSpaces(section)).toContain(withoutSpaces(header));
    },
  );

  it.each(LANGUAGES)(
    "%s: says what Require TLS does as the switch's help does, port 465 included",
    (lang: string) => {
      const words: (english: string) => string = dashboardWords(lang);
      const row: string | undefined = addingSection(lang)
        .split("\n")
        .find((line: string): boolean => {
          return line.startsWith(`| **${words(REQUIRE_TLS)}**`);
        });

      expect(row).toBeDefined();
      expect(withoutSpaces(row!)).toContain(
        withoutSpaces(dashboardSentence(lang, REQUIRE_TLS_HELP)),
      );
    },
  );

  it.each(LANGUAGES)(
    "%s: walks a Microsoft Graph user to Transport under Advanced, with the scope Graph takes",
    (lang: string) => {
      const words: (english: string) => string = dashboardWords(lang);
      const graph: string | undefined = addingSection(lang)
        .split("\n")
        .find((line: string): boolean => {
          return line.startsWith("**Microsoft Graph");
        });

      expect(graph).toBeDefined();
      expect(graph).toContain(`**${words(ADVANCED)}**`);
      expect(graph).toContain(`**${words(TRANSPORT)}**`);
      expect(graph).toContain("**Mail.Send**");
      expect(graph).toContain("`https://graph.microsoft.com/.default`");
      expect(graph).toContain(
        "`https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token`",
      );
      expect(graph).toContain(`**${words("From Email")}**`);
    },
  );

  it.each(LANGUAGES)(
    "%s: comes before the OAuth walkthroughs, which say the OAuth fields are under Advanced",
    (lang: string) => {
      const words: (english: string) => string = dashboardWords(lang);
      const page: string = readPage(lang);
      const headings: Array<string> = sections(page).map(
        (section: { heading: string }): string => {
          return section.heading;
        },
      );
      const adding: string = addingSection(lang);
      const addingIndex: number = sections(page).findIndex(
        (section: { body: string }): boolean => {
          return section.body === adding;
        },
      );

      expect(addingIndex).toBe(0);
      expect(headings[1]).toContain("OAuth 2.0");

      const oauth: string = sections(page)[1]!.body;

      expect(oauth).toContain(`**${words(AUTHENTICATION_TYPE)}**`);
      expect(
        oauth.split("\n").some((line: string): boolean => {
          return (
            !line.startsWith("|") &&
            line.includes(`**${words(AUTHENTICATION_TYPE)}**`) &&
            line.includes(`**${words(ADVANCED)}**`)
          );
        }),
      ).toBe(true);
    },
  );

  it.each(LANGUAGES)(
    "%s: names the TLS switch Require TLS in the provider tables, and never by its old name",
    (lang: string) => {
      const words: (english: string) => string = dashboardWords(lang);
      const page: string = readPage(lang);

      const rows: Array<string> = page
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith(`| ${words(REQUIRE_TLS)} `);
        });

      // The Microsoft 365 and the Google Workspace settings.
      expect(rows).toHaveLength(2);

      for (const oldLabel of OLD_TLS_LABELS) {
        expect({ oldLabel, found: page.includes(oldLabel) }).toEqual({
          oldLabel,
          found: false,
        });
      }

      expect(page).not.toContain("Use SSL");
    },
  );
});
