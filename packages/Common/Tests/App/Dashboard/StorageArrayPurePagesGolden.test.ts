import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";
import ObjectID from "../../../Types/ObjectID";
import StorageSystem from "../../../Types/StorageArray/StorageSystem";
import StorageArrayPlatformRegistry from "../../../Types/StorageArray/StorageArrayPlatformRegistry";
// A registered platform; the setup guide's StorageArrayPlatform is a key.
import { StorageArrayPlatform as RegisteredPlatform } from "../../../Types/StorageArray/StorageArrayPlatform";
import { SetupGuideOption } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import { getInventoryMenuItems } from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/SideMenu";
import {
  getAlertMetricNames,
  getGoldenChartQueries,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Index";
import {
  InsightsSection,
  getInsightsQueries,
  getInsightsSections,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Insights";
import { getResourceFilterFields } from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/StorageArrayMonitor/StorageArrayMonitorStepForm";
import {
  DEFAULT_STORAGE_ARRAY_PLATFORM,
  STORAGE_ARRAY_AGENT_FILES,
  STORAGE_ARRAY_COLLECTOR_CONFIGS,
  STORAGE_ARRAY_PLATFORMS,
  STORAGE_ARRAY_PLATFORM_SETTINGS,
  StorageArrayPlatform,
  StorageArrayWholeConfigPlatform,
  getStorageArrayEnvFile,
  getStorageArrayInstallScriptCommand,
  getStorageArrayPlatformForSystem,
  getStorageArraySetupGuide,
  resolveStorageArrayPlatform,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/DocumentationMarkdown";
import { assessStorageArray } from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/StorageArrayHealth";
import {
  loadFileSystemAvailableRatios,
  loadStorageArrayLatency,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/StorageArrayReadings";
import { getStorageArrayPartRoutes } from "../../../../App/FeatureSet/Dashboard/src/Components/StorageArray/Part/StorageArrayPartRoutes";
import { isLaterSystem } from "../../Helpers/StorageArray/PureSlice";

/*
 * WHAT A PURE STORAGE ARRAY'S PAGES ARE TOLD ABOUT ITS PLATFORM, PINNED
 * BEFORE THE PAGES READ IT FROM THE PLATFORM REGISTRY (#11000).
 *
 * Every switch the Storage Array pages made on FlashArray or FlashBlade, as
 * its helpers answered it before the split, for both platforms, an array
 * whose platform is not known yet and one OneUptime has no catalog for:
 *
 *   - the side menu's inventory tabs;
 *   - the Overview's golden charts and the series its open alerts are read
 *     from;
 *   - the Resource Usage page's sections and the queries each draws;
 *   - the monitor form's object filters;
 *   - the setup guide's platform picker, each option's settings, the guide
 *     each option shows, its .env and its install command;
 *   - how the array's own health is judged from its alerts, capacity and
 *     latency, and which series its latency and file systems' free space
 *     are read from;
 *   - where each kind of part's page is.
 *
 * StorageArrayPurePagesGolden.golden.json was written by this test from the
 * code before #11000 (UPDATE_PURE_STORAGE_GOLDEN=1) and is only ever
 * compared with since.
 */

const GOLDEN_PATH: string = path.join(
  __dirname,
  "StorageArrayPurePagesGolden.golden.json",
);

const PROJECT_ID: string = "10000000-0000-4000-8000-0000000011a0";
const ARRAY_ID: ObjectID = new ObjectID("58000000-0000-4000-8000-0000000011a0");

const SYSTEMS: Array<string | null | undefined> = [
  StorageSystem.PureStorageFlashArray,
  StorageSystem.PureStorageFlashBlade,
  "hitachi.vsp",
  "",
  null,
  undefined,
];

let mockReadings: Array<JSONObject> = [];

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (request: {
        query: Record<string, unknown>;
        limit?: number;
        sort?: Record<string, unknown>;
      }): Promise<unknown> => {
        mockReadings.push({
          name: request.query["name"] as string,
          attributes: request.query["attributes"] as JSONObject,
          limit: request.limit ?? null,
          sort: (request.sort || {}) as JSONObject,
        });
        return Promise.resolve({ data: [], count: 0 });
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): ObjectID => {
        return new ObjectID("10000000-0000-4000-8000-0000000011a0");
      },
    },
  };
});

beforeEach(() => {
  mockReadings = [];
});

afterEach(() => {
  mockReadings = [];
});

function labelOf(value: string | null | undefined): string {
  return value === undefined ? "undefined" : JSON.stringify(value);
}

function asJson(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

/*
 * Pure's slice of the monitor form's object filters. A filter Pure shares
 * with a platform registered since (Dell PowerStore names its volumes and
 * its parts with the same keys) lists that platform among its systems too,
 * and a filter only a later platform has is not Pure's: both are left out,
 * as PureSlice leaves the later platforms out of the other goldens. Every
 * Pure filter, its words, its systems' order and the filters' order are
 * compared whole.
 */
function pureFilterFields(value: JSONValue): JSONValue {
  return (value as Array<JSONObject>)
    .map((field: JSONObject): JSONObject => {
      return {
        ...field,
        storageSystems: (field["storageSystems"] as Array<string>).filter(
          (system: string): boolean => {
            return !isLaterSystem(system);
          },
        ),
      };
    })
    .filter((field: JSONObject): boolean => {
      return (field["storageSystems"] as Array<string>).length > 0;
    });
}

/*
 * Pure Storage's picker options. The picker also offers a Dell PowerScale
 * since #11003, whose guide is its own (PowerScaleSetupGuide.test.ts).
 */
const PURE_OPTIONS: Array<SetupGuideOption<StorageArrayPlatform>> =
  STORAGE_ARRAY_PLATFORMS.filter(
    (option: SetupGuideOption<StorageArrayPlatform>): boolean => {
      return option.key !== "powerscale";
    },
  );

async function computeGolden(): Promise<JSONObject> {
  const bySystem: JSONObject = {};

  for (const system of SYSTEMS) {
    mockReadings = [];
    await loadStorageArrayLatency({
      arrayName: "fa-prod-01",
      storageSystem: system,
    });
    const latencyReads: JSONValue = asJson(mockReadings);

    const sections: Array<InsightsSection> = getInsightsSections(system);

    const health: JSONObject = {};
    for (const [name, read, write] of [
      ["no latency", null, null],
      ["read 4 ms", 4000, null],
      ["read 6 ms", 6000, null],
      ["read 12 ms", 12000, null],
      ["write 6 ms", null, 6000],
      ["write 12 ms", null, 12000],
      ["both 7 ms", 7000, 7000],
    ] as Array<[string, number | null, number | null]>) {
      health[name] = asJson(
        assessStorageArray({
          storageSystem: system,
          criticalAlertCount: 0,
          warningAlertCount: 0,
          capacityUsedPercent: 50,
          readLatencyUsec: read,
          writeLatencyUsec: write,
        }),
      );
    }

    bySystem[labelOf(system)] = {
      inventoryMenu: asJson(getInventoryMenuItems(system)),
      goldenCharts: asJson(
        getGoldenChartQueries({
          storageSystem: system,
          arrayName: "fa-prod-01",
        }),
      ),
      alertMetricNames: getAlertMetricNames(system),
      insightsSections: asJson(sections),
      insightsQueries: asJson(
        sections.map((section: InsightsSection): unknown => {
          return getInsightsQueries({
            section,
            arrayName: "fa-prod-01",
            storageSystem: system,
          });
        }),
      ),
      resourceFilterFields: pureFilterFields(
        asJson(getResourceFilterFields(system)),
      ),
      setupGuidePlatform: getStorageArrayPlatformForSystem(system) || null,
      latencyReads,
      health,
    };
  }

  mockReadings = [];
  await loadFileSystemAvailableRatios("fb-prod-01");
  const fileSystemReads: JSONValue = asJson(mockReadings);

  const guides: JSONObject = {};
  for (const option of PURE_OPTIONS) {
    const platform: StorageArrayPlatform = option.key;
    guides[platform] = {
      settings: asJson(STORAGE_ARRAY_PLATFORM_SETTINGS[platform]),
      collectorConfigLength:
        STORAGE_ARRAY_COLLECTOR_CONFIGS[
          platform as StorageArrayWholeConfigPlatform
        ].length,
      guideForAnArray: asJson(
        getStorageArraySetupGuide({
          oneuptimeUrl: "https://oneuptime.example.com",
          apiKey: "a-real-ingestion-key",
          hasApiKey: true,
          platform,
          arrayName: "fa-prod-01",
        }),
      ),
      guideForTheProduct: asJson(
        getStorageArraySetupGuide({
          oneuptimeUrl: "https://oneuptime.example.com",
          apiKey: "<YOUR_ONEUPTIME_INGESTION_KEY>",
          hasApiKey: false,
          platform,
        }),
      ),
      envFile: getStorageArrayEnvFile({
        oneuptimeUrl: "https://oneuptime.example.com",
        apiKey: "a-real-ingestion-key",
        platform,
        arrayName: "fa-prod-01",
      }),
      installCommand: getStorageArrayInstallScriptCommand({
        oneuptimeUrl: "https://oneuptime.example.com",
        apiKey: "a-real-ingestion-key",
        hasApiKey: true,
        platform,
        arrayName: "fa-prod-01",
      }),
    };
  }

  const resolved: JSONObject = {};
  for (const input of [
    "flasharray",
    "flasharray-exporter",
    "flashblade",
    "hitachi",
    "",
    null,
    undefined,
  ]) {
    resolved[labelOf(input)] = resolveStorageArrayPlatform(input);
  }

  const partRoutes: JSONObject = {};
  for (const kind of [
    "Volume",
    "Host",
    "Pod",
    "Hardware",
    "Drive",
    "Controller",
    "NetworkInterface",
    "Directory",
    "FileSystem",
    "Bucket",
    "Aggregate",
  ]) {
    partRoutes[kind] = getStorageArrayPartRoutes(ARRAY_ID)
      .getPartRoute(kind, "pod-prod::vol-sync-01")
      .toString();
  }

  return {
    projectId: PROJECT_ID,
    bySystem,
    fileSystemReads,
    picker: asJson(PURE_OPTIONS),
    defaultPlatform: DEFAULT_STORAGE_ARRAY_PLATFORM,
    resolved,
    agentFiles: STORAGE_ARRAY_AGENT_FILES,
    guides,
    partRoutes,
  };
}

function readGolden(): JSONObject {
  return JSON.parse(fs.readFileSync(GOLDEN_PATH, "utf8")) as JSONObject;
}

/*
 * The golden is what the pages answered when Pure's were the only
 * platforms. A filter another platform shares (an ONTAP volume's, #11001)
 * lists that platform too, so the golden is computed with Pure's alone.
 */
async function withPurePlatformsAlone<T>(
  compute: () => Promise<T>,
): Promise<T> {
  const others: Array<RegisteredPlatform> =
    StorageArrayPlatformRegistry.getPlatforms().filter(
      (platform: RegisteredPlatform): boolean => {
        return platform.vendorName !== "Pure Storage";
      },
    );
  for (const platform of others) {
    StorageArrayPlatformRegistry.unregister(platform.storageSystem);
  }
  try {
    return await compute();
  } finally {
    for (const platform of others) {
      StorageArrayPlatformRegistry.register(platform);
    }
  }
}

describe("a Pure Storage array's pages are told about its platform as before #11000", () => {
  test("every switch the pages make on the platform answers as it did", async () => {
    const computed: JSONObject = await withPurePlatformsAlone(computeGolden);

    if (process.env["UPDATE_PURE_STORAGE_GOLDEN"] === "1") {
      fs.writeFileSync(
        GOLDEN_PATH,
        `${JSON.stringify(
          {
            note: "Written by StorageArrayPurePagesGolden.test.ts from the code before #11000. Compared with, never rewritten, unless a Pure array's pages are meant to change.",
            ...computed,
          },
          null,
          2,
        )}\n`,
      );
    }

    const golden: JSONObject = readGolden();
    delete golden["note"];

    // Each platform first, then each part, so a difference says where it is.
    const computedBySystem: JSONObject = computed["bySystem"] as JSONObject;
    const goldenBySystem: JSONObject = golden["bySystem"] as JSONObject;
    for (const system of Object.keys(goldenBySystem)) {
      const actual: JSONObject = computedBySystem[system] as JSONObject;
      const expected: JSONObject = goldenBySystem[system] as JSONObject;
      for (const part of Object.keys(expected)) {
        expect({ system, part, value: actual[part] }).toEqual({
          system,
          part,
          value: expected[part],
        });
      }
    }
    for (const key of Object.keys(golden)) {
      expect({ key, value: computed[key] }).toEqual({
        key,
        value: golden[key],
      });
    }
    expect(computed).toEqual(golden);
  });

  /*
   * And with ONTAP and PowerStore registered beside them, as they are in
   * the product: a Pure array's every page answers as it did.
   */
  test("beside ONTAP and PowerStore, a Pure array's pages answer as they did", async () => {
    const withoutOntap: (value: JSONValue) => JSONValue = (
      value: JSONValue,
    ): JSONValue => {
      if (Array.isArray(value)) {
        return value.map(withoutOntap);
      }
      if (value && typeof value === "object") {
        const result: JSONObject = {};
        for (const [key, inner] of Object.entries(value as JSONObject)) {
          result[key] =
            key === "storageSystems" && Array.isArray(inner)
              ? inner.filter((system: JSONValue): boolean => {
                  return system !== "netapp.ontap";
                })
              : withoutOntap(inner as JSONValue);
        }
        return result;
      }
      return value;
    };

    const computedBySystem: JSONObject = (await computeGolden())[
      "bySystem"
    ] as JSONObject;
    const goldenBySystem: JSONObject = readGolden()["bySystem"] as JSONObject;
    const pure: Array<string> = Object.keys(goldenBySystem).filter(
      (system: string): boolean => {
        return system.includes("purestorage.");
      },
    );
    expect(pure.length).toBeGreaterThanOrEqual(2);
    for (const system of pure) {
      const actual: JSONObject = computedBySystem[system] as JSONObject;
      const expected: JSONObject = goldenBySystem[system] as JSONObject;
      for (const part of Object.keys(expected)) {
        if (part === "resourceFilterFields") {
          expect({ system, part, value: withoutOntap(actual[part]!) }).toEqual({
            system,
            part,
            value: expected[part],
          });
          continue;
        }
        expect({ system, part, value: actual[part] }).toEqual({
          system,
          part,
          value: expected[part],
        });
      }
    }
  });
});
