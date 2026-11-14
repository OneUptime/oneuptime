import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ExtractedString,
  SOURCE_ROOTS,
  scanSourceRoots,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import { getDefaultContext } from "../../FeatureSet/Dashboard/scripts/i18n/I18n";
import { REPLAY_TAB_COUNT } from "../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTabs";

/*
 * A KEY THE DASHBOARD LOOKS UP HAS ONE MEANING (#6689, #6768, #6635).
 *
 * A translator words a key once, for every place that looks it up. Where
 * one English word stood for two things, every language but English got
 * one of them wrong:
 *
 *   - "Line" headed the CSV imports' column of a row's line in the file
 *     and named the metric chart's line type: Japanese 折れ線 ("line
 *     chart") over a column of row numbers, German "Zeile" (a row of text)
 *     in the chart picker. The column reads "CSV line" now.
 *   - "Open" is the verb of every Open button, and Session Replay and the
 *     OpenStack load balancer chart used it for a state: a tab that is
 *     still open read "Öffnen" in German, an Arabic legend "open it". The
 *     states have keys of their own ("{{count}} still open", "{{tab}}
 *     (still open)", "Open connections").
 *   - "{{count}} open" counts the Home page's open incidents ("2
 *     unresolved" in Japanese and Chinese, masculine "abiertos" in
 *     Spanish), and counted a session's (feminine) browser tabs too. The
 *     tabs count with REPLAY_TAB_COUNT.
 *
 * What is pinned here is where each of those keys is looked up, read from
 * the source as npm run i18n:extract reads it: a new place that looks one
 * up fails until it is checked to mean the same thing.
 */

const CONTEXT: ReturnType<typeof getDefaultContext> = getDefaultContext();
const REPOSITORY_ROOT: string = CONTEXT.repositoryRoot;
const SOURCE: string = "packages/App/FeatureSet/Dashboard/src";
const LOCALES_DIR: string = path.join(REPOSITORY_ROOT, SOURCE, "Locales");

const STRINGS: Array<ExtractedString> = scanSourceRoots(
  SOURCE_ROOTS,
  REPOSITORY_ROOT,
).strings;

// The files that look `key` up, each once, sorted.
function filesLookingUp(key: string): Array<string> {
  return [
    ...new Set(
      STRINGS.filter((entry: ExtractedString): boolean => {
        return entry.text === key && !entry.nestedPath;
      }).map((entry: ExtractedString): string => {
        return entry.file.replace(`${SOURCE}/`, "");
      }),
    ),
  ].sort();
}

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

const LANGUAGES: ReadonlyArray<string> = CONTEXT.locales.slice();

/*
 * Every place "Open" is looked up, and why it is the verb there. A place
 * that means a state (a tab still recording, a connection, an incident)
 * takes a key of its own instead.
 */
const OPEN_IS_THE_VERB: Record<string, string> = {
  "Components/AIChat/Widgets/ResourceCardWidget.tsx":
    "the button that opens the resource a chat answer cites",
  "Components/AIChat/Widgets/WidgetRenderer.tsx":
    "the button that opens a cited record",
  "Components/DataSecurity/DataSecurityCatalogTerms.ts":
    "the issue's Open button, listed beside the state's own key, Open (status)",
  "Components/NetworkTraffic/TrafficAddressCard.tsx":
    "the link that opens an address's record",
  "Components/ResourceTopology/ResourceTopologyNodes.tsx":
    "a group's toggle, Open beside Close",
  "Components/SecurityCase/SecurityCasesTable.tsx":
    "the create verb of Open Security Case",
  "Components/SecurityEvents/Hunts/HuntsCopy.ts":
    "a starter hunt's button that opens its page",
  "Components/ToolImport/ToolImportHistory.tsx":
    "the button that opens an imported record",
  "Components/Topology/EdgeDetailPanel.tsx":
    "the heading over the links that open a connection's ends",
  "Components/Topology/EntityDetailPanel.tsx":
    "the heading over the links that open an entity's pages",
  "Components/Topology/InfrastructureExplorer.tsx":
    "the column a row's open button sits in (the button is named by Open {{name}})",
  "Components/Topology/NetworkDeviceDetailPanel.tsx":
    "the heading over the links that open a device's pages",
};

describe("one meaning per key", () => {
  test("the extractor finds a bare key wherever a file looks it up (negative control)", () => {
    const strings: Array<ExtractedString> = scanSourceText(
      `${SOURCE}/Components/Example/Example.tsx`,
      [
        'import { translationKey } from "Common/Types/Translator";',
        'export const STATE: string = translationKey("Open");',
        'export const COLUMN: string = translationKey("Line");',
      ].join("\n"),
      { kind: "ui" },
    ).strings;

    expect(
      strings.map((entry: ExtractedString): string => {
        return entry.text;
      }),
    ).toEqual(["Open", "Line"]);
  });

  test('"Line" is the metric chart\'s line type, and nothing else', () => {
    expect(filesLookingUp("Line")).toEqual([
      "Components/Metrics/MetricQueryConfig.tsx",
    ]);
  });

  test('"CSV line" heads the CSV imports\' line column, in preview and results', () => {
    const lookups: Array<string> = STRINGS.filter(
      (entry: ExtractedString): boolean => {
        return entry.text === "CSV line";
      },
    ).map((entry: ExtractedString): string => {
      return entry.file.replace(`${SOURCE}/`, "");
    });

    expect(lookups.sort()).toEqual([
      "Components/NetworkSite/ImportSitesFromCsvModal.tsx",
      "Components/NetworkSite/ImportSitesFromCsvModal.tsx",
      "Components/StatusPage/ImportGroupsFromCsvModal.tsx",
      "Components/StatusPage/ImportGroupsFromCsvModal.tsx",
    ]);
  });

  test('"Open" is looked up only where it is the Open button\'s verb', () => {
    expect(filesLookingUp("Open")).toEqual(
      Object.keys(OPEN_IS_THE_VERB).sort(),
    );
  });

  /*
   * #7781: an open invoice's status read the button's verb, "Abrir" ("open
   * it"), in its pill and the Invoice Status filter. It has a key of its own.
   */
  test("an open invoice's status is its own key, looked up only by the invoices' list", () => {
    expect(filesLookingUp("Open (invoice status)")).toEqual([
      "Pages/Settings/Invoices.tsx",
    ]);
  });

  test("a session's tabs are counted with keys of their own, never the Home page's", () => {
    expect(filesLookingUp("{{count}} open")).toEqual([
      "Components/Home/NeedsAttention.tsx",
    ]);

    for (const template of Object.values(REPLAY_TAB_COUNT)) {
      expect(["{{count}} open", "Open"]).not.toContain(template.other);
      expect(["{{count}} open", "Open"]).not.toContain(template.one);
    }

    expect(filesLookingUp("{{count}} still open")).toEqual([
      "Components/SessionReplay/ReplayTabs.ts",
    ]);
    expect(filesLookingUp("{{tab}} (still open)")).toEqual([
      "Components/SessionReplay/ReplayTabSwitcher.tsx",
    ]);
  });

  /*
   * #7097: an import's results mark a row "Created" with the outcome's own
   * key; the bare "Created" is a date column's title (Arabic تاريخ الإنشاء,
   * "creation date"), so no import screen looks it up.
   */
  test("an import's Created is the outcome's own key, and no import screen looks up the date column's", () => {
    expect(filesLookingUp("Created (import result)")).toEqual([
      "Utils/ImportResultWords.ts",
    ]);

    const created: Array<string> = filesLookingUp("Created");

    for (const file of [
      "Components/NetworkSite/ImportSitesFromCsvModal.tsx",
      "Components/StatusPage/ImportGroupsFromCsvModal.tsx",
      "Components/ToolImport/ToolImportReport.tsx",
      "Components/ToolImport/ToolImportText.ts",
      "Utils/NetworkSiteImportRunner.ts",
      "Utils/StatusPageGroupImportRunner.ts",
    ]) {
      expect({ file, looksUpCreated: created.includes(file) }).toEqual({
        file,
        looksUpCreated: false,
      });
    }
  });

  /*
   * #7108: "Search" is the Search button's verb in every language. A
   * filter's name, an AI call's kind and a family of data stores are
   * nouns, each with a key of its own.
   */
  test('"Search" is never looked up where it names a thing', () => {
    const search: Array<string> = filesLookingUp("Search");

    for (const file of [
      "Components/SessionReplay/SessionReplayFilterFields.ts",
      "Components/LlmConversations/LlmConversationCopy.ts",
      "Components/DataSecurity/DataSecurityCatalogTerms.ts",
    ]) {
      expect({ file, looksUpSearch: search.includes(file) }).toEqual({
        file,
        looksUpSearch: false,
      });
    }

    expect(filesLookingUp("Retrieval")).toEqual([
      "Components/LlmConversations/LlmConversationCopy.ts",
    ]);
    expect(filesLookingUp("Search engine")).toEqual([
      "Components/DataSecurity/DataSecurityCatalogTerms.ts",
    ]);
  });

  test("the tab strip's divider says Closed tabs, never a case's bare Closed", () => {
    expect(filesLookingUp("Closed tabs")).toEqual([
      "Components/SessionReplay/ReplayTabSwitcher.tsx",
    ]);
    expect(filesLookingUp("Closed")).not.toContain(
      "Components/SessionReplay/ReplayTabSwitcher.tsx",
    );
  });
});

describe("the locales word each meaning as its own", () => {
  const ENGLISH: Record<string, string> = readLocale("en");

  test("every language words the new keys", () => {
    const keys: Array<string> = [
      "CSV line",
      "{{count}} still open",
      "{{tab}} (still open)",
      "{{tab}} (closed)",
      "Open connections",
      "Closed tabs",
    ];

    for (const language of LANGUAGES) {
      const locale: Record<string, string> = readLocale(language);

      for (const key of keys) {
        expect({
          language,
          key,
          worded: Boolean(locale[key]) && locale[key] !== ENGLISH[key],
        }).toEqual({ language, key, worded: true });
      }
    }
  });

  test("a line of a CSV file is never worded as the line chart", () => {
    for (const language of LANGUAGES) {
      const locale: Record<string, string> = readLocale(language);

      expect({ language, same: locale["CSV line"] === locale["Line"] }).toEqual(
        {
          language,
          same: false,
        },
      );
    }

    // German's chart picker offers a line ("Linie"), not a row ("Zeile").
    expect(readLocale("de")["Line"]).toBe("Linie");
  });

  test("an import's Created is never worded as the date column's", () => {
    for (const language of LANGUAGES.filter((code: string): boolean => {
      return code !== "en";
    })) {
      const locale: Record<string, string> = readLocale(language);

      expect({
        language,
        worded: Boolean(locale["Created (import result)"]),
      }).toEqual({ language, worded: true });
    }

    // Where the column's word is a date's heading, the outcome's is not.
    expect(readLocale("ar")["Created"]).toBe("تاريخ الإنشاء");
    expect(readLocale("ar")["Created (import result)"]).toBe("تم الإنشاء");
    expect(readLocale("ja")["Created"]).toBe("作成");
    expect(readLocale("ja")["Created (import result)"]).toBe("作成済み");
  });

  test("the bare Open is the verb, and a tab's state is never worded with it", () => {
    for (const language of LANGUAGES) {
      const locale: Record<string, string> = readLocale(language);
      const verb: string = locale["Open"] as string;

      expect({ language, same: verb === locale["Open (status)"] }).toEqual({
        language,
        same: false,
      });
      expect({
        language,
        same: verb === locale["Open (invoice status)"],
      }).toEqual({ language, same: false });

      /*
       * The tooltip's "Tab 2 · Öffnen", put back as a sentence: the state is
       * the tab's own word, not the button's.
       */
      expect({
        language,
        stateIsTheVerb: [
          `{{tab}} (${verb})`,
          `{{tab}}（${verb}）`,
          `{{tab}} · ${verb}`,
        ].includes(locale["{{tab}} (still open)"] as string),
      }).toEqual({ language, stateIsTheVerb: false });

      // The open tabs are not counted as the Home page counts open incidents.
      expect({
        language,
        same: locale["{{count}} still open"] === locale["{{count}} open"],
      }).toEqual({ language, same: false });
    }

    // Arabic's Open buttons read "فتح" (open it), as Persian's "باز کردن".
    expect(readLocale("ar")["Open"]).toBe("فتح");
    expect(readLocale("fa")["Open"]).toBe("باز کردن");
  });
});
