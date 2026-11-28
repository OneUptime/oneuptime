import { beforeAll, describe, expect, test } from "@jest/globals";
import path from "path";
import {
  buildFirstLoad,
  FirstLoadBuild,
  inputsUnder,
} from "../Helpers/FirstLoadBuild";

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..");
const FEATURE_SETS: string = path.resolve(
  COMMON_ROOT,
  "..",
  "App",
  "FeatureSet",
);

/*
 * WHAT A PUBLIC DASHBOARD'S VISITOR DOWNLOADS BEFORE THE BOARD DRAWS
 * (issues #7871 and #8821).
 *
 * A public dashboard draws the Dashboard's own board (Dashboard/Canvas),
 * with no edit mode. The board opens a widget's settings only in edit mode,
 * yet imported them statically, and with them every widget's arguments
 * form, the metric query editor and the models its pickers search: some 390
 * KB before gzip of the page's first load. They are a file of their own
 * (LazyComponentSettingsModal), asked for as a board turns to edit mode,
 * which a public dashboard never does. Reading JSON and the Monitor model
 * no longer bring every monitor type either (JoinedSerializableObjects,
 * MonitorStepsColumnTransformer), and a form asks for the rule condition
 * builder only when it is a rule's (LazyRuleCriteriaModelForm).
 *
 * Built as the public dashboard builds (the shared esbuild config, for
 * production), with its dashboard page as the entry (Helpers/FirstLoadBuild).
 * Its sources and the Dashboard's read "Common/..." and their packages
 * through Common, which is all this suite installs.
 */

let built: FirstLoadBuild | null = null;

beforeAll(() => {
  built = buildFirstLoad({
    entryLines: [
      `export { default as DashboardViewPage } from ${JSON.stringify(
        path.join(
          FEATURE_SETS,
          "PublicDashboard/src/Pages/DashboardView/DashboardViewPage",
        ),
      )};`,
    ],
    serviceName: "PublicDashboard",
    publicPath: "/public-dashboard/dist/",
    additionalAlias: { Common: COMMON_ROOT },
    nodePaths: [path.join(COMMON_ROOT, "node_modules")],
  });
}, 300000);

const DASHBOARD: string = "Dashboard/src/Components";

describe("a public dashboard's first load", () => {
  test("has the board, which it draws", () => {
    expect(
      inputsUnder(built!.firstLoad, `${DASHBOARD}/Dashboard/Canvas/Index.tsx`)
        .length,
    ).toBe(1);
    expect(
      inputsUnder(
        built!.firstLoad,
        `${DASHBOARD}/Dashboard/Canvas/LazyComponentSettingsModal.tsx`,
      ).length,
    ).toBe(1);
  });

  test.each([
    [
      "a widget's settings",
      `${DASHBOARD}/Dashboard/Canvas/ComponentSettingsModal.tsx`,
    ],
    [
      "every widget's arguments form",
      `${DASHBOARD}/Dashboard/Canvas/ArgumentsForm.tsx`,
    ],
    ["the metric query editor", `${DASHBOARD}/Metrics/MetricQueryConfig.tsx`],
    [
      "the names of the entities a picker searches",
      "UI/Utils/Telemetry/TelemetryEntityNames.ts",
    ],
    [
      "the sentences about deleting records",
      "UI/Components/DeleteConfirmation/DeleteConsequences.ts",
    ],
  ])(
    "leaves out %s, which loads when an editor opens them",
    (_name: string, file: string) => {
      expect(inputsUnder(built!.firstLoad, file)).toEqual([]);
      expect(inputsUnder(built!.loadedLater, file).length).toBeGreaterThan(0);
    },
  );

  test.each([
    ["a monitor's steps", "Types/Monitor/MonitorSteps.ts"],
    ["a monitor's step", "Types/Monitor/MonitorStep.ts"],
    ["a criterion", "Types/Monitor/MonitorCriteriaInstance.ts"],
    [
      "the steps column's transformer for the server",
      "Types/Monitor/MonitorStepsColumnTransformer.ts",
    ],
    [
      "the rule condition builder",
      "UI/Components/RuleCriteria/RuleCriteriaBuilder.tsx",
    ],
    [
      "the checks of a rule's conditions",
      "UI/Components/RuleCriteria/RuleCriteriaFields.ts",
    ],
  ])("leaves out %s", (_name: string, file: string) => {
    expect(inputsUnder(built!.firstLoad, file)).toEqual([]);
  });

  /*
   * A Monitor List widget's rows say "No results yet" of a monitor whose
   * first check is overdue (MonitorRowStatus), by a rule that reads the
   * monitor's schedule and its type's family. The family is read from a
   * module of its own (MonitorTypeFamily): read from the monitor overview's
   * layout, it brought every monitor type's metrics and the database metric
   * catalog with it, some 45 KB before gzip that the rows never read.
   */
  test("has the rule a Monitor List widget's rows say No results yet by, and the family it reads", () => {
    expect(
      inputsUnder(built!.firstLoad, "Utils/Monitor/MonitorFirstCheckOverdue.ts")
        .length,
    ).toBe(1);
    expect(
      inputsUnder(built!.firstLoad, "Utils/Monitor/MonitorTypeFamily.ts")
        .length,
    ).toBe(1);
  });

  test.each([
    ["the monitor overview's layout", "Utils/Monitor/MonitorOverviewFamily.ts"],
    ["every monitor type's metrics", "Utils/Monitor/MonitorMetricType.ts"],
    ["the monitor metrics", "Types/Monitor/MonitorMetricType.ts"],
    ["the database metric catalog", "Types/Monitor/DatabaseMetricCatalog.ts"],
  ])(
    "leaves out %s, which a Monitor List widget's rows do not read",
    (_name: string, file: string) => {
      expect(inputsUnder(built!.firstLoad, file)).toEqual([]);
    },
  );

  /*
   * The Ceph Pool List widget draws its own rows and writes their memory
   * with ResourceMemoryValue. It read that from ResourceTable, which
   * brought the table the helper was written for with it - the shared
   * Table, its filters, its bulk update form and its pagination, some 140
   * KB before gzip - though no widget draws a table of resources.
   */
  test("has the Ceph Pool List widget's memory figures, which its rows write", () => {
    expect(
      inputsUnder(
        built!.firstLoad,
        `${DASHBOARD}/Infrastructure/ResourceMemoryValue.ts`,
      ).length,
    ).toBe(1);
  });

  test.each([
    ["the resource table", `${DASHBOARD}/Infrastructure/ResourceTable.tsx`],
    ["the shared table", "UI/Components/Table/Table.tsx"],
    ["a table's filters", "UI/Components/Filters/FilterViewer.tsx"],
    ["the bulk update form", "UI/Components/BulkUpdate/BulkUpdateForm.tsx"],
    ["a table's pagination", "UI/Components/Pagination/Pagination.tsx"],
  ])("leaves out %s, which no widget draws", (_name: string, file: string) => {
    expect(inputsUnder(built!.firstLoad, file)).toEqual([]);
  });

  /*
   * The Storage Array widgets name a hardware component, a drive and a
   * controller, and word a component's status as the Storage Array pages
   * do. They read those words from StorageArrayResourceKindLabels and
   * StorageArrayStatusWords: read from StorageArrayResourceKindUtil and the
   * pages' health rules (StorageArrayHealth), they brought the storage
   * platforms' registry with them, and with it every platform's metrics and
   * alert templates - some 60 KB before gzip that no widget reads.
   */
  test("has the Storage Array widgets' words, which their rows write", () => {
    expect(
      inputsUnder(
        built!.firstLoad,
        "Types/StorageArray/StorageArrayResourceKindLabels.ts",
      ).length,
    ).toBe(1);
    expect(
      inputsUnder(
        built!.firstLoad,
        "Dashboard/src/Pages/StorageArray/Utils/StorageArrayStatusWords.ts",
      ).length,
    ).toBe(1);
  });

  test.each([
    [
      "the storage platforms' registry",
      "Types/StorageArray/StorageArrayPlatformRegistry.ts",
    ],
    [
      "every storage platform, with its metrics and alert templates",
      "Types/StorageArray/Platforms/",
    ],
    [
      "the words of every platform's kinds",
      "Types/StorageArray/StorageArrayResourceKindUtil.ts",
    ],
    [
      "the Storage Array pages' health rules",
      "Dashboard/src/Pages/StorageArray/Utils/StorageArrayHealth.ts",
    ],
  ])(
    "leaves out %s, which no Storage Array widget reads",
    (_name: string, file: string) => {
      expect(inputsUnder(built!.firstLoad, file)).toEqual([]);
    },
  );
});
