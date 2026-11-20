// UX rule: Docs/ux/README.md#in-every-language
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
import { MEANING_KEYS, getWordOfMeaningKey } from "Common/Types/MeaningKeys";
import { LABELS_DRAWN_BY_OWN_KEY } from "../FeatureSet/Docs/DocsDashboardLabels";

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

// The lists, the page and the menu section titled with a database's table (#8176).
const TITLED_WITH_THE_DATABASES_TABLE: ReadonlyArray<string> = [
  "Components/DataObservability/DataAssetTable.tsx",
  "Pages/DataObservability/Reconciliations.tsx",
  "Pages/DataObservability/SchemaChanges.tsx",
  "Pages/DataObservability/TableView/Layout.tsx",
  "Pages/DataObservability/TableView/Lineage.tsx",
  "Pages/DataObservability/TableView/SideMenu.tsx",
  "Pages/DataObservability/UnusedTables.tsx",
  "Pages/DataProduct/View/Overview.tsx",
];

/*
 * The model columns that relate a record to the table it is about: a
 * table's owning team and user, and a report that a table's data looks
 * wrong (#8344). The model's metadata calls them by the word, "Table"
 * (TableColumn's withTitleAsItsWord), for the API reference and the
 * server's messages.
 */
const MODEL_COLUMNS_OF_THE_DATABASES_TABLE: ReadonlyArray<string> = [
  "packages/Common/Models/DatabaseModels/DataAssetOwnerTeam.ts",
  "packages/Common/Models/DatabaseModels/DataAssetOwnerUser.ts",
  "packages/Common/Models/DatabaseModels/DataIssueReport.ts",
];

/*
 * A table's Metrics: the chip that says which table its charts are scoped
 * to. Its label is a value of a map, which the extractor does not read, so
 * only its source is checked.
 */
const LABELLED_WITH_THE_DATABASES_TABLE: ReadonlyArray<string> = [
  "Pages/DataObservability/TableView/Metrics.tsx",
];

// A title, a menu section's or a metric attribute's label that is the bare "Table".
const BARE_TABLE_TITLE: RegExp =
  /(?:\btitle(?::\s*|=)|\]:\s*)"Table"(?=[,\s>}])/;

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
   * #9588: a mobile app's screens (app.screen.name) are its menu, its cart,
   * its checkout - not a device's display, which the bare "Screen" names.
   * zh-TW words them 畫面 and 螢幕.
   */
  test("an app's screen is its own key, looked up only by the frames-by-screen card", () => {
    expect(filesLookingUp("Screen (app screen)")).toEqual([
      "Components/Rum/MobileOverview/FramesByScreenCard.tsx",
    ]);
    expect(filesLookingUp("Screen")).not.toContain(
      "Components/Rum/MobileOverview/FramesByScreenCard.tsx",
    );
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

  /*
   * #8078: a data asset of kind View read "Ver" (the View buttons' verb) in
   * Spanish, and French named a database's table "Tableau", a table on the
   * page. A database's view and table have keys of their own, and every
   * place that names a data asset's kind reads them through
   * DataAssetKindWords: the Tables lists, a table's Overview and the
   * lineage cards. A database's table is also the title over the lists of
   * tables, a table's page and its side menu's section (#8176), so those
   * look its key up too.
   */
  test("a database's view and table are their own keys, looked up only by the kinds' words and the titles over tables", () => {
    expect(filesLookingUp("View (database object)")).toEqual([
      "Components/DataObservability/DataAssetKindWords.ts",
    ]);
    expect(filesLookingUp("Table (database object)")).toEqual(
      [
        "Components/DataObservability/DataAssetKindWords.ts",
        ...TITLED_WITH_THE_DATABASES_TABLE,
        ...MODEL_COLUMNS_OF_THE_DATABASES_TABLE,
      ].sort(),
    );

    for (const file of [
      "Components/DataObservability/DataAssetKindWords.ts",
      "Components/DataObservability/DataAssetTable.tsx",
      "Components/DataObservability/LineageGraph.tsx",
      "Pages/DataObservability/TableView/Overview.tsx",
    ]) {
      expect({
        file,
        looksUpTheVerb: filesLookingUp("View").includes(file),
      }).toEqual({ file, looksUpTheVerb: false });
    }

    expect(filesLookingUp("Table")).not.toContain(
      "Components/DataObservability/DataAssetKindWords.ts",
    );
  });

  /*
   * #8176: Data Observability titled a database's table with the bare
   * "Table", which most places mean as a table on the page (a chart's
   * Table view, a widget): French read "Tableau" and Chinese 表格 over a
   * list of database tables, beside a Kind filter that said "Table".
   */
  test("no Data Observability or data product page titles a database's table with the bare Table", () => {
    const DATA_OBSERVABILITY_FILE: RegExp =
      /^(Components|Pages)\/(DataObservability|DataProduct)\//;

    for (const file of filesLookingUp("Table")) {
      expect({
        file,
        isDataObservability: DATA_OBSERVABILITY_FILE.test(file),
      }).toEqual({ file, isDataObservability: false });
    }

    for (const file of [
      ...TITLED_WITH_THE_DATABASES_TABLE,
      ...LABELLED_WITH_THE_DATABASES_TABLE,
    ]) {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, SOURCE, file),
        "utf8",
      );

      expect({ file, bareTable: BARE_TABLE_TITLE.test(source) }).toEqual({
        file,
        bareTable: false,
      });
      expect({
        file,
        databasesTable: source.includes('"Table (database object)"'),
      }).toEqual({ file, databasesTable: true });
    }
  });

  /*
   * #8344: a table's owners and a data issue report titled their table
   * column with the bare "Table", which French reads as "Tableau" and
   * Chinese as 表格 wherever the Dashboard draws a model's own column
   * titles (a form's permission error, a reset dialog).
   */
  test("no Data Observability model titles a column of a database's table with the bare Table", () => {
    const DATA_OBSERVABILITY_MODEL: RegExp =
      /^packages\/Common\/Models\/DatabaseModels\/Data(Asset|Issue|Check|Pipeline|Reconciliation|Product|Alert)/;

    for (const file of filesLookingUp("Table")) {
      expect({
        file,
        isDataObservabilityModel: DATA_OBSERVABILITY_MODEL.test(file),
      }).toEqual({ file, isDataObservabilityModel: false });
    }

    for (const file of MODEL_COLUMNS_OF_THE_DATABASES_TABLE) {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, file),
        "utf8",
      );

      expect({ file, bareTable: BARE_TABLE_TITLE.test(source) }).toEqual({
        file,
        bareTable: false,
      });
    }
  });

  test("the checks above find a bare Table title (negative control)", () => {
    for (const bare of [
      '          title: "Table",\n',
      '      title="Table"\n',
      '<SideMenuSection title="Table">',
      '[DataObservabilityAttribute.TableId]: "Table",',
    ]) {
      expect({ bare, found: BARE_TABLE_TITLE.test(bare) }).toEqual({
        bare,
        found: true,
      });
    }

    for (const fine of [
      'title: "Table (database object)",',
      'title: "Tables",',
      'Table = "Table",',
    ]) {
      expect({ fine, found: BARE_TABLE_TITLE.test(fine) }).toEqual({
        fine,
        found: false,
      });
    }

    const strings: Array<ExtractedString> = scanSourceText(
      `${SOURCE}/Pages/DataObservability/Example.tsx`,
      'export const COLUMNS = [{ title: "Table", type: FieldType.Text }];',
      { kind: "ui" },
    ).strings;

    expect(
      strings.map((entry: ExtractedString): string => {
        return entry.text;
      }),
    ).toContain("Table");
  });

  /*
   * #7535: the dbt Tests card headed its column of test names, and the
   * filter for them, with the shared "Test", the Test buttons' verb:
   * "Testen", "Probar" ("to try"), "Tester".
   */
  test("a dbt test is its own key, looked up only by the dbt Tests card, which never looks up the bare Test", () => {
    expect(filesLookingUp("Test (dbt test)")).toEqual([
      "Components/DataObservability/DbtTestTable.tsx",
    ]);
    expect(filesLookingUp("Test")).not.toContain(
      "Components/DataObservability/DbtTestTable.tsx",
    );
  });

  /*
   * #8342: Data Security named a store's Test environment with the shared
   * "Test", the Test buttons' verb: a German store read "Testen" beside
   * "Produktion", a Spanish one "Probar". The environment is its own key,
   * looked up only by Data Security's words for environments and the
   * store form's options; no Data Security page looks up the bare Test, nor
   * draws an environment by looking its stored value up.
   */
  test("a store's test environment is its own key, looked up only by Data Security's environment words, which never look up the bare Test", () => {
    expect(filesLookingUp("Test (environment)")).toEqual([
      "Components/DataSecurity/DataSecurityCatalogTerms.ts",
      "Components/DataSecurity/StoreFieldOptions.ts",
    ]);

    const DATA_SECURITY_FILE: RegExp = /^(Components|Pages)\/DataSecurity\//;

    for (const file of filesLookingUp("Test")) {
      expect({
        file,
        isDataSecurity: DATA_SECURITY_FILE.test(file),
      }).toEqual({ file, isDataSecurity: false });
    }
  });

  test("no Data Security page draws a store's environment by looking its stored value up", () => {
    const LOOKED_UP_ENVIRONMENT: RegExp =
      /translate(?:Text|Term)\(\s*[\w.?]*environment\b/;

    for (const file of [
      "Pages/DataSecurity/DataStores.tsx",
      "Pages/DataSecurity/StoreView/Overview.tsx",
      "Pages/DataSecurity/StoreView/Settings.tsx",
    ]) {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, SOURCE, file),
        "utf8",
      );

      expect({
        file,
        looksUpTheEnvironment: LOOKED_UP_ENVIRONMENT.test(source),
        drawsItsTitle: source.includes("getDataStoreEnvironmentTitle("),
      }).toEqual({ file, looksUpTheEnvironment: false, drawsItsTitle: true });
    }

    // The check finds the lookup it replaced (negative control).
    expect(
      LOOKED_UP_ENVIRONMENT.test(
        "{translator.translateText(item.environment) || (",
      ),
    ).toBe(true);
  });

  /*
   * #8343: a data alert's Why This Happened card headed each likely cause
   * with its stored kind, looked up as it was stored. Each kind has its
   * name in DataAlertCauseWords; "Deploy" and "Database" are nouns
   * wherever they are looked up, so a cause shares them.
   */
  test("a likely cause's kinds are looked up by the cause's words, and Deploy is a deploy wherever it is looked up", () => {
    for (const key of [
      "Upstream Alert",
      "Failed Run",
      "Failing Writes",
      "Schema Change",
    ]) {
      expect({ key, files: filesLookingUp(key) }).toEqual({
        key,
        files: ["Components/DataObservability/DataAlertCauseWords.ts"],
      });
    }

    // A deploy marker on a chart, and a deploy before a data alert: the noun.
    expect(filesLookingUp("Deploy")).toEqual([
      "Components/DataObservability/DataAlertCauseWords.ts",
      "Components/Metrics/Utils/UseEventTimeReferenceLines.ts",
    ]);

    const card: string = fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        SOURCE,
        "Components/DataObservability/DataAlertExplanationCard.tsx",
      ),
      "utf8",
    );

    const LOOKED_UP_CAUSE_KIND: RegExp = /translateText\(\s*cause\.kind\b/;

    expect(LOOKED_UP_CAUSE_KIND.test(card)).toBe(false);
    // The check finds the lookup it replaced (negative control).
    expect(
      LOOKED_UP_CAUSE_KIND.test("{translator.translateText(cause.kind)}"),
    ).toBe(true);
    expect(card.includes("getDataAlertCauseKindLabel(")).toBe(true);
  });

  test("no page names a data asset's kind by looking up its stored value", () => {
    const LOOKED_UP_KIND: RegExp = /translateText\(\s*[\w.?]*assetKind\b/;

    for (const file of [
      "Components/DataObservability/DataAssetTable.tsx",
      "Components/DataObservability/LineageGraph.tsx",
      "Pages/DataObservability/TableView/Overview.tsx",
    ]) {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, SOURCE, file),
        "utf8",
      );

      expect({ file, looksUpTheKind: LOOKED_UP_KIND.test(source) }).toEqual({
        file,
        looksUpTheKind: false,
      });
      expect({
        file,
        drawsItsWords: source.includes("getDataAssetKindText("),
      }).toEqual({ file, drawsItsWords: true });
    }
  });

  // #8078: "Change" alone headed the schema changes' column as "Cambiar".
  test("a schema change's title is its own key, looked up only by the Schema Changes list, which never looks up the bare Change", () => {
    expect(filesLookingUp("Change (schema change)")).toEqual([
      "Pages/DataObservability/SchemaChanges.tsx",
    ]);
    expect(filesLookingUp("Change")).not.toContain(
      "Pages/DataObservability/SchemaChanges.tsx",
    );
  });

  /*
   * #7522: the storage widgets headed their array column, and a tile's
   * first row, with the bare "Array", which six languages word as a
   * programming array. The storage array has a key of its own, looked up
   * only by the two storage widgets; nothing in the Dashboard looks up the
   * bare word now, so a data array that needs it gets a meaning of its own.
   */
  /*
   * #9658: the Tables Matched dialog marked a data source OneUptime watches
   * with the bare "Watched", the session replay audit's column of time
   * spent watching a replay, so the source read "Durée de visionnage" in
   * French and "مدة المشاهدة" in Arabic. Its standing has a key of its own,
   * and only the replay audit looks up the bare word.
   */
  test("a BI data source's watched standing is its own key, and only the replay audit looks up the bare Watched", () => {
    expect(filesLookingUp("Watched by OneUptime")).toEqual([
      "Components/DataObservability/BiLineageWords.ts",
    ]);
    expect(filesLookingUp("Watched")).toEqual([
      "Pages/Rum/View/SessionReplayAudit.tsx",
    ]);
  });

  test("a storage array is its own key, looked up only by the storage widgets, and nothing looks up the bare Array", () => {
    expect(filesLookingUp("Array (storage array)")).toEqual([
      "Components/Dashboard/Components/DashboardStorageArrayHardwareListComponent.tsx",
      "Components/Dashboard/Components/DashboardStorageArrayVolumeListComponent.tsx",
    ]);
    expect(filesLookingUp("Array")).toEqual([]);
  });

  /*
   * #9838: a device's Model read 模型 in Chinese, a machine-learning model,
   * on Inventory's Asset Details card, the Managed Devices list and a managed
   * device's Esper card. A machine's model - an Android device's, a network
   * device's, a storage array controller's, and the models' columns the
   * lists filter by - is its own key; the bare Model stays an AI model's.
   */
  test("a machine's model is its own key, looked up by the machines' pages, and the bare Model only by the AI pages", () => {
    expect(filesLookingUp("Model (hardware model)")).toEqual([
      "Components/DeviceManagement/ManagedDeviceCard.tsx",
      "Components/DeviceManagement/ManagedDevicesTable.tsx",
      "Components/Inventory/InventoryAssetLabels.ts",
      "Components/NetworkDevice/DeviceInventoryCard.tsx",
      "Components/Topology/NetworkDeviceDetailPanel.tsx",
      "Pages/StorageArray/View/Hardware.tsx",
      "packages/Common/Models/DatabaseModels/ManagedDevice.ts",
      "packages/Common/Models/DatabaseModels/NetworkDevice.ts",
      "packages/Common/Models/DatabaseModels/StorageArrayResource.ts",
    ]);
    expect(filesLookingUp("Model")).toEqual([
      "Components/AI/LlmCallsTable.tsx",
      "Components/AI/LlmProviderUsageQuery.ts",
      "Components/AI/LlmUsageBreakdown.tsx",
      "Components/Form/Monitor/LlmMonitor/LlmMonitorStepForm.tsx",
      "Components/ProductOnboarding/Showcases/ObservabilityShowcases.ts",
      "Components/Traces/LlmSpanPanel.tsx",
      "Pages/Llm/Pricing.tsx",
      "Pages/Settings/LlmProviders.tsx",
      "Utils/MonitorStepViewModel.ts",
      // A workflow's AI step, and the fallback name of a record type.
      "packages/Common/Types/Workflow/Components/AI.ts",
      "packages/Common/UI/Components/Workflow/Utils.ts",
    ]);
    expect(MEANING_KEYS).toContain("Model (hardware model)");
  });

  /*
   * #8078: Paid, Void and Uncollectible are worded for an invoice - Spanish
   * "Pagada", "Anulada", as a factura is - so a new place that looks one up
   * is checked to mean an invoice too.
   */
  test("an invoice's Paid, Void and Uncollectible are looked up only by the invoices' list", () => {
    for (const key of ["Paid", "Void", "Uncollectible"]) {
      expect({ key, files: filesLookingUp(key) }).toEqual({
        key,
        files: ["Pages/Settings/Invoices.tsx"],
      });
    }
  });

  /*
   * #8181: the bare "Deleted" and "Undefined" are the whole Dashboard's,
   * worded masculine ("Eliminado", "Supprimé"), so a deleted invoice read
   * "Eliminado" under a paid one's "Pagada". An invoice's take keys of
   * their own, looked up only by the invoices' list, which no longer looks
   * up the bare words.
   */
  test("an invoice's Deleted and Undefined are their own keys, and the invoices' list never looks up the bare words", () => {
    for (const key of [
      "Deleted (invoice status)",
      "Undefined (invoice status)",
    ]) {
      expect({ key, files: filesLookingUp(key) }).toEqual({
        key,
        files: ["Pages/Settings/Invoices.tsx"],
      });
      expect(MEANING_KEYS).toContain(key);
    }

    for (const word of ["Deleted", "Undefined"]) {
      expect({
        word,
        invoices: filesLookingUp(word).includes("Pages/Settings/Invoices.tsx"),
      }).toEqual({ word, invoices: false });
    }

    // The bare words stay the rest of the Dashboard's.
    expect(filesLookingUp("Deleted").length).toBeGreaterThan(0);
  });

  /*
   * #8201: the bare "From" and "To" are a message's sender and recipient -
   * the notification logs' columns - so a German date filter read "Von" ...
   * "An" (to someone), a Japanese one 差出人 ... 宛先. A range's two ends
   * have keys of their own, looked up where a range is drawn: the shared
   * filters and time ranges read them through RangeEnds, a status
   * timeline's column and a lone start in an investigation's evidence by
   * name.
   */
  test("a range's two ends are their own keys, and no range looks up the bare From or To", () => {
    const RANGE_FILES: Array<string> = [
      "Pages/NetworkSite/View/StatusTimeline.tsx",
      "Utils/InvestigationEvidenceFormat.ts",
      "packages/Common/UI/Components/Filters/RangeEnds.ts",
    ].sort();

    expect(filesLookingUp("From (range start)")).toEqual(RANGE_FILES);
    expect(filesLookingUp("To (range end)")).toEqual([
      "packages/Common/UI/Components/Filters/RangeEnds.ts",
    ]);

    for (const file of [
      ...RANGE_FILES,
      "Components/ResourceOwners/FilterChipDateRange.tsx",
      "packages/Common/UI/Components/Filters/DateFilter.tsx",
      "packages/Common/UI/Components/Filters/NumberFilter.tsx",
      "packages/Common/UI/Components/Date/CustomTimeRangeModal.tsx",
      "packages/Common/UI/Components/Date/RangeStartAndEndDateEdit.tsx",
    ]) {
      expect({
        file,
        bareFrom: filesLookingUp("From").includes(file),
        bareTo: filesLookingUp("To").includes(file),
      }).toEqual({ file, bareFrom: false, bareTo: false });
    }

    // A message's recipient keeps the bare word.
    expect(filesLookingUp("To")).toContain(
      "Components/NotificationLogs/EmailLogsTable.tsx",
    );
  });

  /*
   * #10009: a device manager connection's Status on Inventory > Managed
   * Devices. Russian's bare Waiting, Catching up and Failing are a noun
   * ("Ожидание"), a verb ("Догоняет") and a masculine noun ("Сбой"),
   * where the connection's other states are neuter ("Выключено",
   * "Устарело", "Исправно"): its words look up keys of their own, and the
   * bare words stay the on-call logs', the security connections' and the
   * other pages'.
   */
  test("a device manager connection's Waiting, Catching up and Failing are its own keys, and its words never look up the bare ones", () => {
    const WORDS: string =
      "Components/DeviceManagement/DeviceManagementWords.ts";

    for (const [key, bare] of [
      ["Waiting (device manager connection)", "Waiting"],
      ["Catching up (device manager connection)", "Catching up"],
      ["Failing (device manager connection)", "Failing"],
    ] as Array<[string, string]>) {
      expect({ key, files: filesLookingUp(key) }).toEqual({
        key,
        files: [WORDS],
      });
      expect(MEANING_KEYS).toContain(key);
      expect({
        key,
        bareLookedUp: filesLookingUp(bare).includes(WORDS),
      }).toEqual({ key, bareLookedUp: false });
    }

    expect(filesLookingUp("Waiting")).toContain(
      "Components/OnCallPolicy/ExecutionLogs/OnCallLogStatusLabels.ts",
    );
    expect(filesLookingUp("Catching up")).toEqual([
      "Components/SecurityEvents/SecurityEventConnectionDiagnosticsUtil.ts",
    ]);
  });

  /*
   * #8659: a state shared by pages whose other states take two genders.
   * Russian's Expired was a token's "Истёк" (masculine) beside a threat
   * indicator's and a rule exception's neuter "Активно"; Not fetched yet a
   * feminine "Ещё не запрашивалась" beside a token's "Действителен" and a
   * calendar link's "Отключено"; Arabic's Valid a certificate's feminine
   * صالحة beside a token's masculine states, and Spanish's Upcoming a
   * list's plural "Próximos" beside an exception's "Activo". Each page
   * words its state with a key of its own and no longer looks up the bare
   * word, which stays the other pages'.
   */
  test("a threat indicator's, a rule exception's, a token's and a calendar link's states are their own keys, and their pages never look up the bare words", () => {
    const OWN_KEYS: Record<string, { file: string; bare: string }> = {
      "Expired (threat indicator)": {
        file: "Pages/SecurityEvents/ThreatIntel.tsx",
        bare: "Expired",
      },
      "Expired (rule exception)": {
        file: "Components/SecurityEvents/RuleExceptions/RuleExceptionsCopy.ts",
        bare: "Expired",
      },
      "Upcoming (rule exception)": {
        file: "Components/SecurityEvents/RuleExceptions/RuleExceptionsCopy.ts",
        bare: "Upcoming",
      },
      "Not fetched yet (OAuth token)": {
        file: "Components/Workflow/WorkflowVariableTokenStatusLabels.ts",
        bare: "Not fetched yet",
      },
      "Valid (OAuth token)": {
        file: "Components/Workflow/WorkflowVariableTokenStatusLabels.ts",
        bare: "Valid",
      },
      "Not fetched yet (calendar feed)": {
        file: "Components/OnCallPolicy/CalendarFeed/CalendarFeedUtil.ts",
        bare: "Not fetched yet",
      },
    };

    for (const [key, { file, bare }] of Object.entries(OWN_KEYS)) {
      expect({ key, files: filesLookingUp(key) }).toEqual({
        key,
        files: [file],
      });
      expect(MEANING_KEYS).toContain(key);
      expect({
        key,
        bare,
        pageLooksUpTheBareWord: filesLookingUp(bare).includes(file),
      }).toEqual({ key, bare, pageLooksUpTheBareWord: false });
    }

    /*
     * The docs name each in bold as its screen draws it: every label the
     * docs map to a key of its own is one of these, read in English as the
     * label itself, on a page that exists.
     */
    for (const [page, labels] of Object.entries(LABELS_DRAWN_BY_OWN_KEY)) {
      expect(
        fs.existsSync(
          path.join(
            REPOSITORY_ROOT,
            "packages/App/FeatureSet/Docs/Content/en",
            `${page}.md`,
          ),
        ),
      ).toBe(true);

      for (const [label, key] of Object.entries(labels)) {
        expect({ page, label, key, own: MEANING_KEYS.includes(key) }).toEqual({
          page,
          label,
          key,
          own: true,
        });
        expect({ key, word: getWordOfMeaningKey(key) }).toEqual({
          key,
          word: label,
        });
      }
    }

    // The bare words stay the pages' that share them.
    expect(filesLookingUp("Expired")).toContain(
      "Components/Workflow/WorkflowVariableTokenStatusLabels.ts",
    );
    expect(filesLookingUp("Not fetched yet")).toContain(
      "Components/SessionReplay/ReplayCorrelationPanel.tsx",
    );
    expect(filesLookingUp("Valid")).toContain(
      "Components/Monitor/SummaryView/SSLCertificateMonitorView.tsx",
    );
  });

  // Every key that names its meaning is one a place looks up.
  test("every key that names its meaning is looked up somewhere", () => {
    for (const key of MEANING_KEYS) {
      expect({ key, lookedUp: filesLookingUp(key).length > 0 }).toEqual({
        key,
        lookedUp: true,
      });
    }
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

  /*
   * #9658: a data source OneUptime watches is worded as each language's
   * Tables Watched words a watched table, never as a replay's watching time.
   */
  test("a data source OneUptime watches is never worded as a replay's watching time", () => {
    for (const language of LANGUAGES.filter((code: string): boolean => {
      return code !== "en";
    })) {
      const locale: Record<string, string> = readLocale(language);

      expect({
        language,
        worded:
          Boolean(locale["Watched by OneUptime"]) &&
          locale["Watched by OneUptime"] !== ENGLISH["Watched by OneUptime"],
        same: locale["Watched by OneUptime"] === locale["Watched"],
      }).toEqual({ language, worded: true, same: false });
    }

    expect(readLocale("fr")["Watched"]).toBe("Durée de visionnage");
    expect(readLocale("fr")["Tables Watched"]).toBe("Tables surveillées");
    expect(readLocale("fr")["Watched by OneUptime"]).toBe(
      "Surveillé par OneUptime",
    );
    expect(readLocale("ar")["Watched"]).toBe("مدة المشاهدة");
    expect(readLocale("ar")["Tables Watched"]).toBe("الجداول المراقَبة");
    expect(readLocale("ar")["Watched by OneUptime"]).toBe("يراقبه OneUptime");
  });

  // #8078: a data asset of kind View read "Ver", "Anzeigen", "Voir".
  test("a database's view is never worded as the View buttons' verb", () => {
    for (const language of LANGUAGES.filter((code: string): boolean => {
      return code !== "en";
    })) {
      const locale: Record<string, string> = readLocale(language);

      expect({
        language,
        worded: Boolean(locale["View (database object)"]),
        same: locale["View (database object)"] === locale["View"],
      }).toEqual({ language, worded: true, same: false });
    }

    expect(readLocale("es")["View (database object)"]).toBe("Vista");
    expect(readLocale("de")["View (database object)"]).toBe("Sicht");
    expect(readLocale("fr")["View (database object)"]).toBe("Vue");
  });

  /*
   * #7522: the storage widgets' "Array" read 配列 (a list in code), Matriz,
   * Tableau (a table), 배열, 数组 and Matrise. Each language words the
   * storage array's key as its Storage Arrays pages name an array - the
   * word its "Array Controller" and its "Storage Array" are made of.
   */
  test("a storage array is worded as the language's storage array, never a programming array", () => {
    const PROGRAMMING_ARRAY: Record<string, string> = {
      ja: "配列",
      es: "Matriz",
      fr: "Tableau",
      ko: "배열",
      "zh-CN": "数组",
      no: "Matrise",
    };
    const STORAGE_ARRAY: Record<string, string> = {
      ja: "アレイ",
      es: "Cabina",
      fr: "Baie",
      ko: "어레이",
      "zh-CN": "阵列",
      no: "Array",
    };

    // Whether `word` is the one a language's storage array names are made of.
    const namesItsStorageArrays: (
      locale: Record<string, string>,
      word: string,
    ) => boolean = (locale: Record<string, string>, word: string): boolean => {
      return [
        locale["Storage Array"] as string,
        locale["Array Controller"] as string,
      ].some((name: string): boolean => {
        return name.toLowerCase().includes(word.toLowerCase());
      });
    };

    for (const language of LANGUAGES.filter((code: string): boolean => {
      return code !== "en";
    })) {
      const locale: Record<string, string> = readLocale(language);
      const storageArray: string = locale["Array (storage array)"] as string;

      expect({
        language,
        worded:
          Boolean(storageArray) && storageArray !== "Array (storage array)",
        namesItsStorageArrays: namesItsStorageArrays(locale, storageArray),
      }).toEqual({ language, worded: true, namesItsStorageArrays: true });
    }

    for (const language of Object.keys(PROGRAMMING_ARRAY)) {
      const locale: Record<string, string> = readLocale(language);

      expect({ language, word: locale["Array (storage array)"] }).toEqual({
        language,
        word: STORAGE_ARRAY[language],
      });

      // The negative control: the check refuses each programming array.
      expect({
        language,
        programming: namesItsStorageArrays(
          locale,
          PROGRAMMING_ARRAY[language] as string,
        ),
      }).toEqual({ language, programming: false });
    }
  });

  // French named a database's table "Tableau", and Chinese 表格: a table on the page.
  test("a database's table is a table of rows, never a table on the page, where a language words them apart", () => {
    const words: Record<string, { page: string; database: string }> = {
      fr: { page: "Tableau", database: "Table" },
      "zh-CN": { page: "表格", database: "表" },
      "zh-TW": { page: "表格", database: "資料表" },
    };

    for (const language of Object.keys(words)) {
      const locale: Record<string, string> = readLocale(language);

      expect({
        language,
        page: locale["Table"],
        database: locale["Table (database object)"],
      }).toEqual({ language, ...words[language] });
    }

    // Where one word is both, the database's is that word.
    expect(readLocale("es")["Table (database object)"]).toBe(
      readLocale("es")["Table"],
    );
    expect(readLocale("de")["Table (database object)"]).toBe("Tabelle");
  });

  /*
   * #9838: Chinese named a device's model 模型, a machine-learning model,
   * and Arabic النموذج; a device's model is 型号 / 型號 (as Android's own
   * About phone screen says) and الطراز. Every other language names both
   * with one word, so a machine's model is worded as its bare Model there.
   */
  test("a machine's model is worded as a device's model, never an AI model's, where a language words them apart", () => {
    const words: Record<string, { ai: string; machine: string }> = {
      "zh-CN": { ai: "模型", machine: "型号" },
      "zh-TW": { ai: "模型", machine: "型號" },
      ar: { ai: "النموذج", machine: "الطراز" },
    };

    for (const language of LANGUAGES) {
      const locale: Record<string, string> = readLocale(language);
      const expected: { ai: string; machine: string } = words[language] || {
        ai: locale["Model"] as string,
        machine: locale["Model"] as string,
      };

      expect({
        language,
        ai: locale["Model"],
        machine: locale["Model (hardware model)"],
      }).toEqual({ language, ...expected });

      // Worded, never left as its English key.
      expect({
        language,
        worded: locale["Model (hardware model)"] !== "Model (hardware model)",
      }).toEqual({ language, worded: true });
    }
  });

  /*
   * #8078: the schema changes' column and filter read "Cambiar", "Ändern",
   * "Modifier". Only Persian writes the noun as it writes the Change
   * buttons, تغییر: its buttons are named with the noun.
   */
  /*
   * #7535: the shared "Test" is the Test buttons' verb in most languages,
   * which headed a column of dbt's tests "Testen", "Tester", "Probar",
   * "Testa", "Testar". A dbt test is the noun in every language, the noun
   * its "dbt Test" check type is named with.
   */
  test("a dbt test is worded as the noun, never the Test buttons' verb, where a language words them apart", () => {
    const WORDS: Record<string, { verb: string; noun: string }> = {
      de: { verb: "Testen", noun: "Test" },
      fr: { verb: "Tester", noun: "Test" },
      es: { verb: "Probar", noun: "Prueba" },
      nl: { verb: "Testen", noun: "Test" },
      sv: { verb: "Testa", noun: "Test" },
      pt: { verb: "Testar", noun: "Teste" },
    };

    for (const language of Object.keys(WORDS)) {
      const locale: Record<string, string> = readLocale(language);

      expect({
        language,
        verb: locale["Test"],
        noun: locale["Test (dbt test)"],
      }).toEqual({ language, ...WORDS[language] });
    }

    for (const language of LANGUAGES.filter((code: string): boolean => {
      return code !== "en";
    })) {
      const locale: Record<string, string> = readLocale(language);
      const noun: string = locale["Test (dbt test)"] || "";

      expect({
        language,
        worded: noun.length > 0 && noun !== "Test (dbt test)",
        inItsCheckType: (locale["dbt Test"] || "")
          .toLocaleLowerCase(language)
          .includes(noun.toLocaleLowerCase(language) || "?"),
      }).toEqual({ language, worded: true, inItsCheckType: true });
    }
  });

  /*
   * #8342: a store's Test environment read the Test buttons' verb -
   * "Testen", "Probar", "Tester". It is the noun an environment is named
   * with, beside Production and Staging.
   */
  test("a test environment is worded as the noun, never the Test buttons' verb, where a language words them apart", () => {
    const WORDS: Record<string, { verb: string; noun: string }> = {
      de: { verb: "Testen", noun: "Test" },
      fr: { verb: "Tester", noun: "Test" },
      es: { verb: "Probar", noun: "Pruebas" },
      nl: { verb: "Testen", noun: "Test" },
      sv: { verb: "Testa", noun: "Test" },
      pt: { verb: "Testar", noun: "Teste" },
    };

    for (const language of Object.keys(WORDS)) {
      const locale: Record<string, string> = readLocale(language);

      expect({
        language,
        verb: locale["Test"],
        noun: locale["Test (environment)"],
      }).toEqual({ language, ...WORDS[language] });
    }

    for (const language of LANGUAGES.filter((code: string): boolean => {
      return code !== "en";
    })) {
      const locale: Record<string, string> = readLocale(language);
      const noun: string = locale["Test (environment)"] || "";

      expect({
        language,
        worded: noun.length > 0 && noun !== "Test (environment)",
      }).toEqual({ language, worded: true });
    }
  });

  test("a schema change is worded as the noun, never the Change buttons' verb, where a language words them apart", () => {
    const WORDED_ALIKE: ReadonlyArray<string> = ["fa"];

    for (const language of LANGUAGES.filter((code: string): boolean => {
      return code !== "en";
    })) {
      const locale: Record<string, string> = readLocale(language);

      expect({
        language,
        worded: Boolean(locale["Change (schema change)"]),
        same: locale["Change (schema change)"] === locale["Change"],
      }).toEqual({
        language,
        worded: true,
        same: WORDED_ALIKE.includes(language),
      });
    }

    expect(readLocale("es")["Change (schema change)"]).toBe("Cambio");
    expect(readLocale("de")["Change (schema change)"]).toBe("Änderung");
    expect(readLocale("fr")["Change (schema change)"]).toBe("Modification");
    // Italian's "Modifica" is the Edit buttons' word: a change is a Cambiamento.
    expect(readLocale("it")["Change (schema change)"]).toBe("Cambiamento");
    expect(readLocale("it")["Edit"]).toBe("Modifica");
  });
});
