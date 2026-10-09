import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Huntress pages (Incidents > Integrations > Huntress) look every visible
 * string up in the Dashboard locale files by its English text, so a string
 * the pages render but no locale carries would stay English for everyone.
 * This pins both halves: the Huntress components and models still render
 * exactly these strings, and every locale translates each of them.
 *
 * Huntress's own portal is English only, so a translated instruction keeps
 * the names of Huntress's menus and buttons ("View Signing Secret", "Add
 * Endpoint", ...) exactly as Huntress shows them: a reader has to find those
 * words on Huntress's screen.
 */

const PACKAGES_DIR: string = path.join(__dirname, "..", "..", "..");

const DASHBOARD_SRC: string = path.join(
  PACKAGES_DIR,
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const SOURCE_FILES: Array<string> = [
  path.join(DASHBOARD_SRC, "Components", "Huntress", "HuntressSetupCard.tsx"),
  path.join(
    DASHBOARD_SRC,
    "Components",
    "Huntress",
    "HuntressSigningSecretModal.tsx",
  ),
  path.join(
    DASHBOARD_SRC,
    "Components",
    "Huntress",
    "HuntressSigningSecret.ts",
  ),
  path.join(
    DASHBOARD_SRC,
    "Components",
    "Huntress",
    "HuntressConnectionDisplay.ts",
  ),
  path.join(
    DASHBOARD_SRC,
    "Components",
    "Huntress",
    "HuntressIncidentReportsTable.tsx",
  ),
  path.join(
    DASHBOARD_SRC,
    "Pages",
    "Incidents",
    "Integrations",
    "Huntress.tsx",
  ),
  path.join(
    DASHBOARD_SRC,
    "Pages",
    "Incidents",
    "Integrations",
    "HuntressView.tsx",
  ),
  path.join(
    DASHBOARD_SRC,
    "Pages",
    "Incidents",
    "Integrations",
    "HuntressConnectionFormFields.ts",
  ),
  // Column titles and descriptions, shown as table headers and form labels.
  path.join(
    PACKAGES_DIR,
    "Common",
    "Models",
    "DatabaseModels",
    "HuntressConnection.ts",
  ),
  path.join(
    PACKAGES_DIR,
    "Common",
    "Models",
    "DatabaseModels",
    "HuntressIncidentReport.ts",
  ),
  // The "Connect" create button and dialog title the connection list uses.
  path.join(
    PACKAGES_DIR,
    "Common",
    "UI",
    "Components",
    "ModelTable",
    "BaseModelTable.tsx",
  ),
];

const STRINGS: Array<string> = [
  // The setup card.
  "Connect Huntress",
  "Three steps in Huntress. You need the Account Admin role there.",
  "Add a webhook endpoint in Huntress",
  "In Huntress, open Integrations, choose Add an Integration, then Webhooks, and Add Endpoint. Paste this URL, and turn on Incident Reports.",
  "Huntress sends its incident reports to this URL, signed with the endpoint's signing secret.",
  "Copy webhook URL",
  "Save the endpoint's signing secret",
  "In Huntress, open the endpoint's menu (⋯) and choose View Signing Secret. Requests are refused until it is saved here.",
  "Save Signing Secret",
  "Replace Signing Secret",
  "Signing secret saved",
  "Send a test",
  "In Huntress, choose Send Test on the endpoint. This card changes as soon as the test arrives.",
  "The last request was refused",
  "Last event",
  // The signing secret dialog.
  "In Huntress, open the endpoint's menu (⋯), choose View Signing Secret, and paste it here. It is encrypted, and never shown again.",
  "This is not a signing secret. In Huntress, choose View Signing Secret on the endpoint and copy all of it: it starts with whsec_.",
  // Connection states, severities and report outcomes.
  "Signing secret needed",
  "Waiting for Huntress",
  "Receiving reports",
  "Refusing requests",
  "Critical reports only",
  "High and critical reports",
  "Every report",
  "Hands-on-keyboard attackers, ransomware and active compromise: what Huntress says needs containing now.",
  "Also confirmed malware and identity compromise that need urgent remediation.",
  "Also potentially unwanted programs and older findings.",
  "Opening the incident",
  "Incident opened",
  "Incident resolved",
  "Skipped: organization not watched",
  "Skipped: already closed in Huntress",
  "Most severe (by rank)",
  "Second most severe (by rank)",
  "Third most severe (by rank)",
  "Dismissed by your team",
  "Auto-remediating",
  "Deleting",
  "Draft",
  // The incident reports table.
  "Incident Reports",
  "What Huntress sent, and what was done with each report.",
  "No incident reports yet",
  "Each incident report Huntress sends shows here, with the incident it opened or why it opened none.",
  "In Huntress",
  "Outcome",
  "View incident",
  "Incident deleted",
  "Paged on-call",
  // The connection list.
  "Huntress incident reports open incidents here and page your on-call team. Closing a report in Huntress resolves its incident.",
  "Page on-call for Huntress incident reports",
  "Last Event",
  "Nobody",
  "Connect {{itemName}}",
  // The connection's settings and its form.
  "Who is paged, and how a Huntress report becomes an incident.",
  "Paged for: {{reports}}",
  "Nobody: incidents open without paging. Your incident on-call rules still apply.",
  "Organizations",
  "Every organization in your Huntress account",
  "{{labels}}, and the report's organization",
  "The report's organization",
  "Who is paged when Huntress reports an incident. Leave empty to open incidents without paging anyone; your incident on-call rules still apply.",
  "Page On-Call For",
  "Every report opens an incident. Reports below this severity open one without paging.",
  "Critical, high and low reports open at your three most severe incident severities, from every Huntress organization, and are resolved when Huntress closes them.",
  "What this connection is called here, such as the Huntress account it receives from.",
  "Severity For Critical Reports",
  "Severity For High Reports",
  "Severity For Low Reports",
  "Only These Organizations",
  "Leave empty to open incidents for every organization in your Huntress account. Otherwise, one organization name or ID per line.",
  "Every incident this connection opens gets these labels, besides one named after the report's Huntress organization.",
  "Resolve When Huntress Closes The Report",
  "Resolve the incident when its report is closed or dismissed in Huntress. When off, a note on the incident says so instead.",
  // Model names and columns.
  "Huntress Connection",
  "Huntress Connections",
  "Huntress webhook endpoints. Every Huntress incident report opens an incident that pages on-call, and closing the report in Huntress resolves it.",
  "Signing Secret Saved",
  "Severity For Critical Reports ID",
  "Severity For High Reports ID",
  "Severity For Low Reports ID",
  "Last Event Received At",
  "Last Event Type",
  "Huntress Incident Report",
  "Huntress Incident Reports",
  "Huntress incident reports received through a Huntress connection, each with the incident it opened or the reason it opened none.",
  "Huntress Connection ID",
  "Huntress Account ID",
  "Huntress Incident Report ID",
  "Organization ID",
  "Affected",
  "Paged On-Call",
  "Applied Message IDs",
];

/*
 * Translations that are legitimately the same as English. Keep this short
 * and explicit: anything else identical to English is a copy someone forgot
 * to translate.
 */
const IDENTICAL_TO_ENGLISH: Record<string, Array<string>> = {
  // "In" is the same word in German, Italian and Dutch; Huntress is a name.
  de: ["In Huntress"],
  it: ["In Huntress"],
  nl: ["In Huntress"],
};

/*
 * Words from Huntress's own (English only) portal that every translation of
 * the instruction keeps verbatim, so the reader can find them on screen.
 */
const HUNTRESS_WORDS_KEPT: Record<string, Array<string>> = {
  "Three steps in Huntress. You need the Account Admin role there.": [
    "Account Admin",
  ],
  "In Huntress, open Integrations, choose Add an Integration, then Webhooks, and Add Endpoint. Paste this URL, and turn on Incident Reports.":
    [
      "Integrations",
      "Add an Integration",
      "Webhooks",
      "Add Endpoint",
      "Incident Reports",
    ],
  "In Huntress, open the endpoint's menu (⋯) and choose View Signing Secret. Requests are refused until it is saved here.":
    ["(⋯)", "View Signing Secret"],
  "In Huntress, open the endpoint's menu (⋯), choose View Signing Secret, and paste it here. It is encrypted, and never shown again.":
    ["(⋯)", "View Signing Secret"],
  "In Huntress, choose Send Test on the endpoint. This card changes as soon as the test arrives.":
    ["Send Test"],
  "This is not a signing secret. In Huntress, choose View Signing Secret on the endpoint and copy all of it: it starts with whsec_.":
    ["View Signing Secret", "whsec_"],
};

const PLACEHOLDER_PATTERN: RegExp = /\{\{\s*\w+\s*\}\}/g;

function readSources(): string {
  return SOURCE_FILES.map((filePath: string): string => {
    return fs.readFileSync(filePath, "utf8");
  }).join("\n");
}

function readLocale(file: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
  ) as Record<string, unknown>;
}

function getPlaceholders(text: string): Array<string> {
  return (text.match(PLACEHOLDER_PATTERN) || []).sort();
}

const localeFiles: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((name: string): boolean => {
    return name.endsWith(".json");
  })
  .sort();

const translatedLocaleFiles: Array<string> = localeFiles.filter(
  (file: string): boolean => {
    return file !== "en.json";
  },
);

describe("Huntress translations", () => {
  test("the list has no duplicates", () => {
    expect(new Set<string>(STRINGS).size).toBe(STRINGS.length);
  });

  test("every string is still rendered by the Huntress pages or models", () => {
    const sources: string = readSources();
    const missing: Array<string> = STRINGS.filter((text: string): boolean => {
      return !sources.includes(`"${text}"`);
    });
    expect(missing).toEqual([]);
  });

  test("every kept Huntress word is one the English instruction uses", () => {
    for (const [text, words] of Object.entries(HUNTRESS_WORDS_KEPT)) {
      expect(STRINGS).toContain(text);
      for (const word of words) {
        expect({ text, word, inEnglish: text.includes(word) }).toEqual({
          text,
          word,
          inEnglish: true,
        });
      }
    }
  });

  test("all 17 Dashboard locales are covered", () => {
    expect(localeFiles).toHaveLength(17);
    expect(localeFiles).toContain("en.json");
  });

  test("English maps every string to itself", () => {
    const english: Record<string, unknown> = readLocale("en.json");
    for (const text of STRINGS) {
      expect({ text, value: english[text] }).toEqual({ text, value: text });
    }
  });

  test.each(translatedLocaleFiles)(
    "%s translates every string",
    (file: string) => {
      const locale: Record<string, unknown> = readLocale(file);
      const allowedCopies: Array<string> =
        IDENTICAL_TO_ENGLISH[file.replace(/\.json$/, "")] || [];

      for (const text of STRINGS) {
        const value: unknown = locale[text];
        expect({ text, type: typeof value }).toEqual({
          text,
          type: "string",
        });
        expect((value as string).trim().length).toBeGreaterThan(0);
        if (!allowedCopies.includes(text)) {
          expect({ text, value }).not.toEqual({ text, value: text });
        }
      }
    },
  );

  test.each(translatedLocaleFiles)(
    "%s keeps Huntress, the placeholders and Huntress's own words",
    (file: string) => {
      const locale: Record<string, unknown> = readLocale(file);

      for (const text of STRINGS) {
        const value: string = String(locale[text]);

        expect({ text, placeholders: getPlaceholders(value) }).toEqual({
          text,
          placeholders: getPlaceholders(text),
        });

        if (text.includes("Huntress")) {
          expect({ text, keepsHuntress: value.includes("Huntress") }).toEqual({
            text,
            keepsHuntress: true,
          });
        }

        for (const word of HUNTRESS_WORDS_KEPT[text] || []) {
          expect({ text, word, kept: value.includes(word) }).toEqual({
            text,
            word,
            kept: true,
          });
        }
      }
    },
  );
});
