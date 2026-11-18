// UX rule: Docs/ux/README.md#in-every-language
import {
  ADMIN_DASHBOARD_LOCALES,
  ADMIN_DASHBOARD_SOURCE,
  LocaleTree,
  OwnNestedKey,
  OwnStrings,
  OwnText,
  REPOSITORY_ROOT,
  findMissingEntries,
  isSourceFile,
  readAdminCatalogStrings,
  readAdminLocale,
  readAdminOwnStrings,
  readNested,
  readOwnStrings,
  uniqueTexts,
} from "./AdminOwnPagesStrings";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { ADMIN_DASHBOARD_LANGUAGES } from "Common/Tests/Helpers/TranslatedLanguages";
import {
  GIVE_FEEDBACK_CATEGORY_TITLES,
  GUIDED_SETUP_TITLES,
  PRODUCT_FEEDBACK_KIND_TITLES,
} from "Common/Types/ProductFeedback/ProductFeedback";

/*
 * THE ADMIN DASHBOARD'S OWN PAGES, IN EVERY LANGUAGE IT SPEAKS (#8227).
 *
 * The Admin Dashboard looks every English text its own pages hand a
 * shared component up in its own locale files (src/Locales), as a flat
 * key. AdminSharedStringsLocales and AdminImportedCommonStringsLocales hold
 * those locales to the shared components' strings; nothing held them to
 * the Admin Dashboard's own pages. "Poll Telegram for Messages" read
 * English in every language (#8075), and so, after PR #8211 added it, did
 * 186 more: the whole Feedback page ("By Question", "What People Said",
 * "No answers yet"), the Health pages ("Instance Overview", "Background
 * Queues", the ClickHouse capacity policy), the SMS and call provider card,
 * the global SSO and OIDC providers' pages.
 *
 * This reads the Admin Dashboard's src the way the Dashboard's string
 * extractor reads the Dashboard (scanSourceText, AdminOwnPagesStrings.ts)
 * and holds every locale to what it finds:
 *
 *   - every text a page hands a lookup is an entry of English and of every
 *     language, and English's is the text itself, a plural's one form the
 *     English one form;
 *   - every nested key a page reads (t("pages.settings.email.smtpCardTitle"))
 *     is there in every locale;
 *   - each language words them: a text whose entry still reads as English
 *     is a name, a code or an example (READ_AS_WRITTEN), or a word the
 *     language says as English does (SAME_AS_ENGLISH_IN, which only
 *     shrinks: an entry translated since fails it until it comes off).
 *
 * A text the extractor finds that no lookup reads is NOT_LOOKED_UP, with
 * its reason. An element's text a page draws as written (<th>Shard</th>)
 * is not looked up either, so it is left out (readOwnStrings); the Admin's
 * own pages draw none (AdminOwnPagesDrawnAsWrittenGuard, #8555).
 *
 * Add a new text to en.json as itself and to every language, worded as
 * that language's Dashboard words the same text where it has one, at the
 * end of each file, in English's order (ArabicLocaleGuards holds Arabic to
 * it).
 */

const LANGUAGES: ReadonlyArray<string> = [...ADMIN_DASHBOARD_LANGUAGES];

/*
 * Texts the extractor finds in the Admin Dashboard's src that no lookup
 * reads, so an entry would show nothing anywhere.
 */
const NOT_LOOKED_UP: Readonly<Record<string, string>> = {
  name: "a table filter's entity field (filterDropdownField.label), the column the picker reads each option's name from: Pages/Projects/View/UserView.tsx",
  "nginx.service.externalTrafficPolicy: Local":
    "a Helm value VisitorAddressesSummary draws as code, in a <code> element of its own (Setting): never looked up",
};

/*
 * What every language writes as English does, on purpose: product and
 * vendor names, protocols, a vendor's own field labels, example values a
 * person types over, and placeholders that are an address or an identifier.
 */
const READ_AS_WRITTEN: Readonly<Record<string, string>> = {
  ClickHouse: "a product name",
  PostgreSQL: "a product name",
  Valkey: "a product name",
  Twilio: "a product name",
  SendGrid: "a product name",
  SMTP: "a protocol",
  "8012345678:ABCdefGHIjklMNOpqrsTUVwxyz-0987654321":
    "an example Telegram bot token, typed over",
  OneUptimeAlertsBot: "an example Telegram bot username, typed over",
  "EAAG...": "the start of a Meta access token, typed over",
  "John Smith": "an example name, typed over",
  "Acme, Inc.": "an example company, typed over",
  US: "a Mailgun region's code, as Mailgun names it",
  "Client Credentials":
    "the OAuth 2.0 grant's name, as the identity providers' consoles write it",
  "test@example.com": "an example address, typed over",
  "you@company.com": "an example address, typed over",
  "member@company.com": "an example address, typed over",
  "email@company.com": "an example address, typed over",
  "email@yourcompany.com": "an example address, typed over",
  "internal-probe": "an example probe name, typed over",
  "0 USD": "an amount in a currency's code, typed over",
  "OpenID Connect (OIDC)": "a protocol's name",
};

/*
 * The words a language says as English does - a loanword ("Status" in
 * German), a vendor's field label it keeps in English ("Twilio Account
 * SID") - per language. Each must still read as English: one translated
 * since comes off the list.
 */
const SAME_AS_ENGLISH_IN: Readonly<Record<string, ReadonlyArray<string>>> = {
  de: [
    "Feedback",
    "Version",
    "Name",
    "Status",
    "Query Console",
    "Team",
    "Twilio Account SID",
    "Twilio Auth Token",
    "Region",
    "Transport",
    "Teams",
    "Facebook App Secret",
    "Enterprise",
    "Shard",
    "Shard {{shard}}",
    "Host",
  ],
  fr: [
    "Question",
    "Page",
    // The Feedback page's docs pages (#7209): French says "Pages" too.
    "Pages",
    "Version",
    "Questions",
    "Notifications",
    "Migrations",
    "Datastores",
    "Diagnostics",
    "Maintenance",
    "Message",
    "Description",
    "Transport",
    "Total",
    "Enterprise",
    "Shard",
    "Shard {{shard}}",
    "**Variables**",
    "**Variables ({{count}})**",
    // The project Invoices page's actions column: French says "Actions" too.
    "Actions",
  ],
  es: [
    "No",
    "Total",
    "Enterprise",
    "Shard",
    "Shard {{shard}}",
    "Host",
    "**Variables**",
    "**Variables ({{count}})**",
    // What Give feedback was about (#8893): Spanish says "Idea" too.
    "Idea",
  ],
  it: [
    // What Give feedback was about (#8893): Italian says "Idea" too.
    "Idea",
    "Home",
    "Feedback",
    "No",
    "Team",
    "Twilio Account SID",
    "Twilio Auth Token",
    "Client ID",
    "Test",
    "Provider",
    "Facebook App Secret",
    "Password",
    "Enterprise",
    "Shard",
    "Shard {{shard}}",
    "Host",
  ],
  pt: [
    "Feedback",
    "Status",
    "Datastores",
    "OAuth Client ID",
    "Client ID",
    "Total",
    "Enterprise",
    "Shard",
    "Shard {{shard}}",
    "Host",
  ],
  nl: [
    "Feedback",
    "Status",
    "Datastores",
    "Team",
    "Twilio Account SID",
    "Twilio Auth Token",
    "Transport",
    "OAuth Client ID",
    "Project",
    "Teams",
    "Provider",
    "Model",
    "{{count}} products_one",
    "Facebook App Secret",
    "Enterprise",
    "Shard",
    "Shard {{shard}}",
    "Host",
  ],
  da: [
    "Feedback",
    "Version",
    "Status",
    "Datastores",
    "{{count}} people_one",
    "Team",
    "Twilio Account SID",
    "Twilio Auth Token",
    "Region",
    "Transport",
    "Teams",
    "Test",
    "Model",
    "Upload logo",
    "Facebook App Secret",
    "Total",
    "Enterprise",
    "Shard",
    "Shard {{shard}}",
  ],
  no: [
    "Status",
    "{{count}} people_one",
    "Team",
    "Twilio Account SID",
    "Twilio Auth Token",
    "Region",
    "Transport",
    "OAuth Client ID",
    "Test",
    "Enterprise",
    "Shard",
    "Shard {{shard}}",
  ],
  sv: [
    "Version",
    "Status",
    "{{count}} people_one",
    "Team",
    "Twilio Account SID",
    "Twilio Auth Token",
    "Region",
    "Transport",
    "OAuth Client ID",
    "Facebook App Secret",
    "Enterprise",
    "Shard",
    "Shard {{shard}}",
  ],
  ru: [
    "Twilio Account SID",
    "Twilio Auth Token",
    "OAuth Client ID",
    "Client ID",
    "Enterprise",
  ],
  ja: ["App ID", "Enterprise"],
  ko: ["Enterprise"],
  "zh-CN": ["Bot Token", "Facebook App Secret"],
  "zh-TW": [
    "OAuth Client ID",
    "OAuth Scope",
    "Bot Token",
    "Facebook App Secret",
    "App ID",
  ],
  hi: [
    "Twilio Account SID",
    "Twilio Auth Token",
    "OAuth Token URL",
    "Bot Token",
    "Facebook App Secret",
    "App ID",
    "Enterprise",
  ],
  fa: [],
  ar: [],
};

/*
 * The Enterprise pages' names, codes and examples, read as written in every
 * language when the checkout has ee/ (a query console's example queries, an
 * example address, a channel's example name).
 */
const ENTERPRISE_READ_AS_WRITTEN: Readonly<Record<string, string>> = {
  CorpoApp: "an example custom channel's name, typed over",
  "buyer@acme.com": "an example address, typed over",
  "enterprise@oneuptime.com": "an example address, typed over",
  Postgres: "a product name",
  OneUptime: "the product's name, the product name field's example",
  'SELECT * FROM "User" ORDER BY "createdAt" DESC LIMIT 50;':
    "an example query, typed over",
  "SELECT * FROM system.tables WHERE database = currentDatabase() LIMIT 50;":
    "an example query, typed over",
  "# One command per line, redis-cli style.\nDBSIZE\nINFO server\nKEYS *":
    "an example redis-cli script, typed over",
  PID: "a process id's abbreviation, as PostgreSQL writes it",
  "pg {{version}}":
    "PostgreSQL's short name and its version, as psql writes it",
};

/*
 * The Enterprise pages' words a language says as English does - a loanword
 * ("Backup" in German), the deliberate one forms of its same-as-English list
 * (i18n/Progress/<code>.json) - when the checkout has ee/. Each must still
 * read as English.
 */
const ENTERPRISE_SAME_AS_ENGLISH_IN: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  de: [
    "Backups",
    "{{size}} in {{duration}}",
    "Backup",
    "Shards",
    "Online",
    "Commits",
    "Rollbacks",
    "Deadlocks",
    "Website",
    "Logo",
    "Worker",
    "Cluster {{cluster}}",
    "Heap",
    "Signal",
  ],
  fr: [
    "Destination",
    "Type",
    "Shards",
    "Application",
    "{{count}} instances",
    "{{count}} instances_one",
    "{{count}} instance",
    "Activation",
    "{{count}} minutes",
    "Logo",
    "Production",
    "Worker",
    "Cluster {{cluster}}",
    "signal {{signal}}",
    "⌘ / Ctrl + ↵",
    "Signal",
    "Parent",
  ],
  es: ["{{count}} monitors_one", "Shards", "Worker", "Heap", "⌘ / Ctrl + ↵"],
  it: [
    "{{size}} in {{duration}}",
    "Backup",
    "{{count}} monitors_one",
    "{{count}} files_one",
    "Online",
    "Logo",
    "Worker",
    "Shard {{shard}} · Replica {{replica}}",
    "Cluster {{cluster}}",
    "Heap",
    "Query",
    "⌘ / Ctrl + ↵",
    "Database {{size}}",
  ],
  pt: [
    "Backups",
    "Backup",
    "{{count}} monitors_one",
    "Shards",
    "Online",
    "Commits",
    "Deadlocks",
    "Worker",
    "Cluster {{cluster}}",
    "Heap",
    "⌘ / Ctrl + ↵",
  ],
  nl: [
    "{{size}} in {{duration}}",
    "{{count}} projects_one",
    "{{count}} monitors",
    "{{count}} monitors_one",
    "Type",
    "Shards",
    "Online",
    "Commits",
    "Rollbacks",
    "Deadlocks",
    "Website",
    "Logo",
    "Worker",
    "Shard {{shard}} · Replica {{replica}}",
    "Cluster {{cluster}}",
    "{{count}} nodes",
    "{{count}} nodes_one",
    "Crashes (system.crash_log)",
    "Heap",
    "Query",
    "⌘ / Ctrl + ↵",
    "Database {{size}}",
  ],
  da: [
    "Destination",
    "{{count}} monitors_one",
    "Send test",
    "Type",
    "Shards",
    "Online",
    "Commits",
    "Rollbacks",
    "Deadlocks",
    "Download CSV",
    "Upload",
    "Logo",
    "{{count}} nodes_one",
    "signal {{signal}}",
    "Heap",
    "⌘ / Ctrl + ↵",
    "Signal",
    "Database {{size}}",
  ],
  no: [
    "{{count}} monitors_one",
    "Send test",
    "Type",
    "Shards",
    "Commits",
    "Logo",
    "{{count}} over",
    "{{count}} nodes_one",
    "signal {{signal}}",
    "Heap",
    "⌘ / Ctrl + ↵",
    "Signal",
    "Database {{size}}",
  ],
  sv: [
    "{{count}} monitors_one",
    "Shards",
    "Online",
    "Commits",
    "signal {{signal}}",
    "Heap",
    "⌘ / Ctrl + ↵",
    "Signal",
  ],
  ru: ["⌘ / Ctrl + ↵"],
  ja: ["Webhook URL", "⌘ / Ctrl + ↵"],
  ko: ["⌘ / Ctrl + ↵"],
  "zh-CN": ["Webhook URL", "⌘ / Ctrl + ↵"],
  "zh-TW": ["Webhook URL", "⌘ / Ctrl + ↵"],
  hi: ["⌘ / Ctrl + ↵"],
  fa: ["⌘ / Ctrl + ↵"],
  ar: ["⌘ / Ctrl + ↵"],
};

const LETTER: RegExp = /\p{L}/u;

const PLACEHOLDER: RegExp = /\{\{[^{}]*\}\}/g;

// A text with no letter once its {{placeholders}} are gone reads the same everywhere.
const hasLetters: (text: string) => boolean = (text: string): boolean => {
  return LETTER.test(text.replace(PLACEHOLDER, ""));
};

const OWN: OwnStrings = readAdminOwnStrings();

/*
 * The Enterprise Edition's admin pages (ee/AdminDashboard) draw through the
 * same locales (#8554). The App's test job runs without ee/ in the
 * checkout and ee/'s own jobs run with it, so they are read where they are.
 */
const ENTERPRISE_SOURCE: string = path.join(
  REPOSITORY_ROOT,
  "ee",
  "AdminDashboard",
);

const ENTERPRISE_PRESENT: boolean = fs.existsSync(ENTERPRISE_SOURCE);

const ENTERPRISE: OwnStrings = ENTERPRISE_PRESENT
  ? readAdminOwnStrings(ENTERPRISE_SOURCE)
  : { texts: [], nestedKeys: [], files: 0 };

// The shared catalogs the pages draw words from (ADMIN_DASHBOARD_CATALOGS).
const CATALOGS: OwnStrings = readAdminCatalogStrings();

const LOOKED_UP: Array<OwnText> = [
  ...OWN.texts,
  ...ENTERPRISE.texts,
  ...CATALOGS.texts,
].filter((text: OwnText): boolean => {
  return !(text.key in NOT_LOOKED_UP);
});

/*
 * The Enterprise pages' texts that ee/ keeps out of every locale, and says
 * why (ee/AdminDashboard/KeptOutOfTheLocales.json): they are drawn in
 * English, and no locale holds them. Read from ee/, so core names none of
 * them.
 */
const KEPT_OUT_OF_THE_LOCALES: ReadonlyArray<string> = ENTERPRISE_PRESENT
  ? (
      JSON.parse(
        fs.readFileSync(
          path.join(ENTERPRISE_SOURCE, "KeptOutOfTheLocales.json"),
          "utf8",
        ),
      ) as { texts: Array<string> }
    ).texts
  : [];

const isKeptOutOfTheLocales: (key: string) => boolean = (
  key: string,
): boolean => {
  return KEPT_OUT_OF_THE_LOCALES.includes(key);
};

// The texts the locales must hold: every one looked up, but those.
const IN_LOCALES: Array<OwnText> = LOOKED_UP.filter(
  (text: OwnText): boolean => {
    return !isKeptOutOfTheLocales(text.key);
  },
);

const NESTED_KEYS: Array<OwnNestedKey> = [
  ...OWN.nestedKeys,
  ...ENTERPRISE.nestedKeys,
];

// What reads as written, the Enterprise pages' names and examples with it.
const AS_WRITTEN: Readonly<Record<string, string>> = {
  ...READ_AS_WRITTEN,
  ...(ENTERPRISE_PRESENT ? ENTERPRISE_READ_AS_WRITTEN : {}),
};

// Each language's loanwords, the Enterprise pages' with them.
const sameAsEnglishIn: (language: string) => ReadonlyArray<string> = (
  language: string,
): ReadonlyArray<string> => {
  return [
    ...(SAME_AS_ENGLISH_IN[language] || []),
    ...(ENTERPRISE_PRESENT
      ? ENTERPRISE_SAME_AS_ENGLISH_IN[language] || []
      : []),
  ];
};

const TEXTS: Map<string, string> = uniqueTexts(LOOKED_UP);

const ENGLISH: LocaleTree = readAdminLocale("en");

const SOURCE_PREFIX: string = "packages/App/FeatureSet/AdminDashboard/src/";

// "Poll Telegram for Messages (Pages/Settings/Telegram/Index.tsx:120)".
const describeText: (text: OwnText) => string = (text: OwnText): string => {
  return `${text.key} (${text.file.replace(SOURCE_PREFIX, "")}:${text.line})`;
};

// The texts `language` still words as English, beyond what may read so.
const englishLeftIn: (language: string, locale: LocaleTree) => Array<string> = (
  language: string,
  locale: LocaleTree,
): Array<string> => {
  const sameAsEnglish: ReadonlyArray<string> = sameAsEnglishIn(language);

  return Array.from(TEXTS.entries())
    .filter(([key, english]: [string, string]): boolean => {
      return (
        locale[key] === english &&
        hasLetters(english) &&
        !(key in AS_WRITTEN) &&
        !sameAsEnglish.includes(key)
      );
    })
    .map(([key]: [string, string]): string => {
      return key;
    });
};

describe("the Admin Dashboard's own pages", () => {
  test("are read: every source file, and hundreds of texts", () => {
    const sourceFiles: number = fs
      .readdirSync(ADMIN_DASHBOARD_SOURCE, { recursive: true })
      .filter((file: string | Buffer): boolean => {
        return isSourceFile(path.basename(String(file)));
      }).length;

    expect(OWN.files).toBe(sourceFiles);
    expect(OWN.files).toBeGreaterThan(100);
    expect(TEXTS.size).toBeGreaterThan(400);
    expect(OWN.nestedKeys.length).toBeGreaterThan(50);
  });

  test("hand over the texts #8227 found with no entry, and the one #8075 did", () => {
    for (const text of [
      "Poll Telegram for Messages",
      "By Question",
      "What People Said",
      "No answers yet",
      "Instance Overview",
      "Background Queues",
      "Datastores",
      "ClickHouse capacity policy",
      "SMS and Call Provider",
      "OIDC SSO Configuration",
      "SAML SSO Configuration",
      "Attached Projects",
    ]) {
      expect({ text, handedOver: TEXTS.has(text) }).toEqual({
        text,
        handedOver: true,
      });
    }
  });

  test("hand over the milestone catalog's words, which the milestones card drew as written (#8599)", () => {
    expect(CATALOGS.texts.length).toBeGreaterThan(20);

    for (const text of [
      "First monitor created",
      "No monitor yet",
      "Nobody reachable yet",
      "Set up",
    ]) {
      expect({ text, handedOver: TEXTS.has(text) }).toEqual({
        text,
        handedOver: true,
      });
    }

    // The milestones' own names are values, not words.
    expect(TEXTS.has("FirstMonitorCreated")).toBe(false);
  });

  test("hand over what a feedback answer was about, which the Feedback page looks up by its kind and topic (#8893)", () => {
    for (const text of [
      // Each kind of answer, in the By Question table and the Kind filter.
      ...Object.values(PRODUCT_FEEDBACK_KIND_TITLES),
      // A guided setup by its name.
      ...Object.values(GUIDED_SETUP_TITLES),
      // What Give feedback was about.
      ...Object.values(GIVE_FEEDBACK_CATEGORY_TITLES),
      "How OneUptime works",
      "Is OneUptime set up the way you wanted?",
    ]) {
      expect({ text, handedOver: TEXTS.has(text) }).toEqual({
        text,
        handedOver: true,
      });
    }

    // The rules for asking people are no words of the page.
    expect(TEXTS.has("first_week")).toBe(false);
    expect(TEXTS.has("support@oneuptime.com")).toBe(false);
  });

  test("hand over the texts #8555 routed through translation, which they drew as written", () => {
    for (const text of [
      // ClickHouse's capacity table headed its columns as plain text.
      "Shard",
      "Active parts",
      // Glued from "ClickHouse is", "reachable" / "not reachable" and "from this instance.".
      "ClickHouse is reachable from this instance.",
      "ClickHouse is not reachable from this instance.",
      "Fullest of {{count}} disks",
      "Fullest of {{count}} disks_one",
      "Recorded {{time}}",
      "Pending migrations (run in order)",
      "and {{count}} more…",
      "{{count}} pending · failed",
      "Loading teams...",
      "Stuck at: {{step}}.",
      "{{value}} (default)",
      "{{feature}} is a OneUptime Enterprise Edition feature. Switch to the Enterprise Edition build to enable it.",
      // Kept in a constant or handed to a helper the extractor did not read.
      "Disk used",
      "Capacity before",
      "PostgreSQL schema migrations",
      "Instance version & build",
      "PostgreSQL cluster health",
      "Waiting for Reclaim",
    ]) {
      expect({ text, handedOver: TEXTS.has(text) }).toEqual({
        text,
        handedOver: true,
      });
    }

    // The pieces it was glued from are no texts of their own.
    expect(TEXTS.has("not reachable")).toBe(false);
    expect(TEXTS.has("ClickHouse is")).toBe(false);
  });

  test("leave out an element's text a page draws as written, which no entry would change", () => {
    const read: { texts: Array<OwnText> } = readOwnStrings(
      "packages/App/FeatureSet/AdminDashboard/src/Pages/Health/Fixture.tsx",
      [
        'import React from "react";',
        "const Page = (props: { connected: boolean }) => {",
        "  return (",
        "    <table>",
        "      <thead><tr><th>Shard</th></tr></thead>",
        "      <caption>",
        '        ClickHouse is {props.connected ? "reachable" : "not reachable"} from',
        "        this instance.",
        "      </caption>",
        "    </table>",
        "  );",
        "};",
      ].join("\n"),
    );

    expect(
      read.texts.map((text: OwnText): string => {
        return text.key;
      }),
    ).toEqual([]);
  });

  test("every text no lookup reads is one the pages still hand over, with its reason", () => {
    for (const [text, why] of Object.entries(NOT_LOOKED_UP)) {
      expect({
        text,
        found: OWN.texts.some((own: OwnText): boolean => {
          return own.key === text;
        }),
        explained: why.length > 20,
      }).toEqual({ text, found: true, explained: true });
    }
  });

  test("English holds every text as itself, and each plural's one form as English's", () => {
    const missing: Array<string> = findMissingEntries(IN_LOCALES, ENGLISH).map(
      describeText,
    );

    expect(missing).toEqual([]);

    const wrong: Array<string> = Array.from(TEXTS.entries())
      .filter(([key, english]: [string, string]): boolean => {
        return !isKeptOutOfTheLocales(key) && ENGLISH[key] !== english;
      })
      .map(([key]: [string, string]): string => {
        return key;
      });

    expect(wrong).toEqual([]);
  });

  test.each(LANGUAGES)(
    "%s has an entry for every text the pages hand over",
    (language: string) => {
      const missing: Array<string> = findMissingEntries(
        IN_LOCALES,
        readAdminLocale(language),
      ).map(describeText);

      expect({ language, missing }).toEqual({ language, missing: [] });
    },
  );

  test.each(["en", ...LANGUAGES])(
    "%s has every nested key the pages read",
    (language: string) => {
      const locale: LocaleTree = readAdminLocale(language);
      const missing: Array<string> = NESTED_KEYS.filter(
        (key: OwnNestedKey): boolean => {
          return readNested(locale, key.path) === undefined;
        },
      ).map((key: OwnNestedKey): string => {
        return `${key.path.join(".")} (${key.file}:${key.line})`;
      });

      expect({ language, missing }).toEqual({ language, missing: [] });
    },
  );

  test.each(LANGUAGES)(
    "%s words them: only names, codes, examples and its own loanwords read as English",
    (language: string) => {
      expect({
        language,
        english: englishLeftIn(language, readAdminLocale(language)),
      }).toEqual({ language, english: [] });
    },
  );

  test.each(LANGUAGES)(
    "%s's list of words it says as English names only texts it still says so",
    (language: string) => {
      const locale: LocaleTree = readAdminLocale(language);
      const list: ReadonlyArray<string> = sameAsEnglishIn(language);
      const stale: Array<string> = list.filter((key: string): boolean => {
        return !TEXTS.has(key) || locale[key] !== TEXTS.get(key);
      });

      expect({ language, stale }).toEqual({ language, stale: [] });
      expect(new Set(list).size).toBe(list.length);
    },
  );

  test("every language has a list, and the names read as written are texts the pages hand over", () => {
    expect(Object.keys(SAME_AS_ENGLISH_IN).sort()).toEqual(
      [...LANGUAGES].sort(),
    );

    for (const text of Object.keys(AS_WRITTEN)) {
      expect({ text, handedOver: TEXTS.has(text) }).toEqual({
        text,
        handedOver: true,
      });
    }
  });
});

(ENTERPRISE_PRESENT ? describe : describe.skip)(
  "the Enterprise Edition's admin pages (#8554)",
  () => {
    test("are read too: the licenses, live Health and White Label pages", () => {
      expect(ENTERPRISE.files).toBeGreaterThan(50);
      expect(ENTERPRISE.texts.length).toBeGreaterThan(300);

      for (const text of [
        "Total licenses",
        "Over user limit",
        "PostgreSQL health policy",
        "Valkey health policy",
        "Read-only mode is off",
        "Ingestion by project",
        "White Label",
      ]) {
        expect({ text, handedOver: TEXTS.has(text) }).toEqual({
          text,
          handedOver: true,
        });
      }
    });

    test("the texts ee/ keeps out of the locales are texts they hand over, and no locale holds them", () => {
      expect(KEPT_OUT_OF_THE_LOCALES.length).toBeGreaterThan(0);

      for (const text of KEPT_OUT_OF_THE_LOCALES) {
        expect({ text, handedOver: TEXTS.has(text) }).toEqual({
          text,
          handedOver: true,
        });

        for (const language of ["en", ...LANGUAGES]) {
          expect({
            text,
            language,
            held: readAdminLocale(language)[text] !== undefined,
          }).toEqual({ text, language, held: false });
        }
      }
    });

    test("their names and examples read as written are texts they hand over", () => {
      for (const text of Object.keys(ENTERPRISE_READ_AS_WRITTEN)) {
        expect({ text, handedOver: TEXTS.has(text) }).toEqual({
          text,
          handedOver: true,
        });
      }

      expect(Object.keys(ENTERPRISE_SAME_AS_ENGLISH_IN).sort()).toEqual(
        [...LANGUAGES].sort(),
      );
    });
  },
);

/*
 * The checks above, run on fixtures: what they name when an entry goes
 * missing, so a passing run is not a scan that read nothing.
 */
describe("what the guard names", () => {
  const TELEGRAM_PAGE: string = [
    'import React from "react";',
    "const Page = () => {",
    "  return (",
    "    <Card",
    '      title="Poll Telegram for Messages"',
    '      description="OneUptime asks Telegram for new messages every few seconds."',
    "    />",
    "  );",
    "};",
  ].join("\n");

  const FIXTURE_FILE: string =
    "packages/App/FeatureSet/AdminDashboard/src/Pages/Settings/Telegram/Fixture.tsx";

  test("a page's text with no entry, by its text and place: #8075's Poll Telegram for Messages", () => {
    const read: { texts: Array<OwnText> } = readOwnStrings(
      FIXTURE_FILE,
      TELEGRAM_PAGE,
    );
    const locale: LocaleTree = {
      "OneUptime asks Telegram for new messages every few seconds.":
        "OneUptime fragt Telegram alle paar Sekunden nach neuen Nachrichten.",
    };

    expect(
      findMissingEntries(read.texts, locale).map((text: OwnText): string => {
        return `${text.key} @ ${text.line}`;
      }),
    ).toEqual(["Poll Telegram for Messages @ 5"]);
  });

  test.each(LANGUAGES)(
    "%s: one entry taken out of the real file is named, and nothing else",
    (language: string) => {
      const locale: LocaleTree = { ...readAdminLocale(language) };

      delete locale["What People Said"];

      expect(
        findMissingEntries(IN_LOCALES, locale).map((text: OwnText): string => {
          return text.key;
        }),
      ).toEqual(["What People Said"]);
    },
  );

  test("a nested entry that is an object, not a string, counts as missing", () => {
    expect(
      findMissingEntries(
        [{ key: "Answers", english: "Answers", file: "x", line: 1 }],
        { Answers: { nested: "Antworten" } },
      ).map((text: OwnText): string => {
        return text.key;
      }),
    ).toEqual(["Answers"]);
  });

  test("a plural's one form is a key of its own", () => {
    const read: { texts: Array<OwnText> } = readOwnStrings(
      FIXTURE_FILE,
      [
        'import { translatePlural } from "x";',
        "const line = (count: number) => translatePlural(",
        '  { one: "{{count}} answer", other: "{{count}} answers" },',
        "  count,",
        ");",
      ].join("\n"),
    );

    expect(
      read.texts.map((text: OwnText): [string, string] => {
        return [text.key, text.english];
      }),
    ).toEqual([
      ["{{count}} answers", "{{count}} answers"],
      ["{{count}} answers_one", "{{count}} answer"],
    ]);

    expect(
      findMissingEntries(read.texts, {
        "{{count}} answers": "{{count}} Antworten",
      }).map((text: OwnText): string => {
        return text.key;
      }),
    ).toEqual(["{{count}} answers_one"]);
  });

  test("a translation turned back into English is named, and a name read as written is not", () => {
    const locale: LocaleTree = {
      ...readAdminLocale("de"),
      "By Question": "By Question",
    };

    expect(englishLeftIn("de", locale)).toEqual(["By Question"]);
    expect(englishLeftIn("de", readAdminLocale("de"))).toEqual([]);
  });

  test("the guard reads the locale directory the build ships from", () => {
    expect(fs.existsSync(path.join(ADMIN_DASHBOARD_LOCALES, "en.json"))).toBe(
      true,
    );
  });
});
