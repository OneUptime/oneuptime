import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  NAMING_APPLY_DEVICE_GONE_REASON,
  NAMING_APPLY_NAME_CHANGED_REASON,
  NAMING_APPLY_RULES_CHANGED_REASON,
  DeviceNamingOutcome,
} from "Common/Types/NetworkDevice/DeviceNaming";
import { NamePlaceholder } from "Common/Utils/NetworkDevice/Naming/NamePattern";
import {
  createTranslator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import {
  MISSING_VALUE_SENTENCES,
  NAMING_APPLY_TRANSLATED_REASONS,
  describeNamingProblem,
  isNamingProblem,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/Naming/DeviceNamingCopy";
import { SOURCE_ROOTS } from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";

/*
 * Naming rules (OneUptime issue #6619), wired: the Dashboard's calls reach
 * the routes the server serves, every outcome and every placeholder a rule
 * can lack has a sentence, the server's reasons for leaving a device alone
 * are keys the Dashboard translates, and the page is reachable from the
 * Network menu, the command palette and its breadcrumbs. The files are read
 * as source where React would be loaded otherwise: App's tests load no
 * Dashboard file that imports React.
 */

const REPOSITORY_ROOT: string = path.join(__dirname, "..", "..", "..", "..");
const DASHBOARD_SOURCE: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet/Dashboard/src",
);

function read(relativePath: string): string {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath), "utf8");
}

function readDashboard(relativePath: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SOURCE, relativePath), "utf8");
}

const english: Translator = createTranslator(undefined, "en");

/*
 * The routes the Dashboard calls, read from its API module's source: the
 * module reads the browser's configuration when it loads, which a test in
 * Node has none of.
 */
function getDashboardRoutes(): Array<string> {
  const source: string = readDashboard(
    "Components/NetworkDevice/Naming/DeviceNamingApi.ts",
  );
  const block: string =
    source.match(/DEVICE_NAMING_ROUTES[\s\S]*?= \{([\s\S]*?)\};/)?.[1] || "";

  return Array.from(
    block.matchAll(/:\s*"([^"]+)"/g),
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

describe("the Dashboard's calls reach the server's routes", () => {
  const api: string = read(
    "packages/Common/Server/API/NetworkDeviceNamingAPI.ts",
  );

  test("the Dashboard calls the preview, plan and apply routes", () => {
    expect(getDashboardRoutes()).toEqual([
      "/network-device-naming/preview-scan",
      "/network-device-naming/preview-discovered-devices",
      "/network-device-naming/plan",
      "/network-device-naming/apply",
    ]);
  });

  test.each(getDashboardRoutes())("%s is served", (route: string) => {
    expect(api).toContain(`router.post(\n  "${route}",`);
  });

  test("the router is mounted by the API", () => {
    const baseApi: string = read("packages/App/FeatureSet/BaseAPI/Index.ts");

    expect(baseApi).toContain(
      'import NetworkDeviceNamingAPI from "Common/Server/API/NetworkDeviceNamingAPI";',
    );
    expect(baseApi).toMatch(
      /app\.use\(`\/\$\{APP_NAME\.toLocaleLowerCase\(\)\}`,\s*NetworkDeviceNamingAPI\)/,
    );
    // And the rules' own CRUD API, for the rules page.
    expect(baseApi).toMatch(
      /new BaseAPI<NetworkDeviceNamingRule, NetworkDeviceNamingRuleServiceType>\(/,
    );
  });
});

describe("every outcome has words", () => {
  test("every placeholder a rule can lack has a sentence", () => {
    expect(Object.keys(MISSING_VALUE_SENTENCES).sort()).toEqual(
      Object.values(NamePlaceholder).sort(),
    );
  });

  test("every outcome but a name reads as a sentence, and a name as none", () => {
    for (const outcome of Object.values(DeviceNamingOutcome)) {
      const sentence: string | null = describeNamingProblem(
        { outcome: outcome, name: "UN1216MNUPLR01", missing: "site.code" },
        english,
      );

      if (
        outcome === DeviceNamingOutcome.Named ||
        outcome === DeviceNamingOutcome.FollowsRules
      ) {
        expect(sentence).toBeNull();
      } else {
        expect(sentence).toBeTruthy();
        expect(sentence).not.toMatch(/\{\{\w+\}\}/);
      }
    }
  });

  test("a missing value names what is missing; an unknown one still reads", () => {
    expect(
      describeNamingProblem(
        { outcome: DeviceNamingOutcome.MissingValue, missing: "lookup" },
        english,
      ),
    ).toBe("The rule's lookup table has no row for it.");
    expect(
      describeNamingProblem(
        { outcome: DeviceNamingOutcome.MissingValue, missing: "serial" },
        english,
      ),
    ).toBe("A value the rule's name pattern needs is missing.");
    expect(
      describeNamingProblem(
        {
          outcome: DeviceNamingOutcome.NameTaken,
          name: "UN1216MNUPLR01",
          takenName: "un1216mnuplr01",
        },
        english,
      ),
    ).toContain('"un1216mnuplr01"');
  });

  test("which outcomes need a person's attention", () => {
    expect(
      Object.values(DeviceNamingOutcome).filter(
        (outcome: DeviceNamingOutcome) => {
          return isNamingProblem({ outcome: outcome });
        },
      ),
    ).toEqual([
      DeviceNamingOutcome.MissingValue,
      DeviceNamingOutcome.NameTaken,
      DeviceNamingOutcome.NameTooLong,
    ]);
  });

  test("the server's reasons for leaving a device alone are the Dashboard's keys", () => {
    expect([...NAMING_APPLY_TRANSLATED_REASONS].sort()).toEqual(
      [
        NAMING_APPLY_DEVICE_GONE_REASON,
        NAMING_APPLY_NAME_CHANGED_REASON,
        NAMING_APPLY_RULES_CHANGED_REASON,
      ].sort(),
    );

    const locale: Record<string, string> = JSON.parse(
      readDashboard("Locales/en.json"),
    ) as Record<string, string>;

    for (const reason of NAMING_APPLY_TRANSLATED_REASONS) {
      expect(locale[reason]).toBe(reason);
    }
  });

  test("the engine's own sentences are extracted for translation", () => {
    const directories: Array<string> = SOURCE_ROOTS.map(
      (root: { directory: string }) => {
        return root.directory;
      },
    );

    expect(directories).toContain(
      "packages/Common/Utils/NetworkDevice/Naming/NamePattern.ts",
    );
    expect(directories).toContain(
      "packages/Common/Utils/NetworkDevice/Naming/NamingLookup.ts",
    );
  });
});

describe("the page is reachable", () => {
  test("from the Network menu's Rules, after the site rules", () => {
    const menu: string = readDashboard(
      "Components/Network/NetworkSideMenu.tsx",
    );
    const siteRules: number = menu.indexOf('title: "Site Assignment Rules"');
    const namingRules: number = menu.indexOf('title: "Naming Rules"');
    const ownerRules: number = menu.indexOf('title: "Owner Rules"');

    expect(siteRules).toBeGreaterThan(-1);
    expect(namingRules).toBeGreaterThan(siteRules);
    expect(ownerRules).toBeGreaterThan(namingRules);
    expect(menu).toContain("PageMap.NETWORK_DEVICE_SETTINGS_NAMING_RULES");
  });

  test("by its route, its breadcrumbs and the command palette", () => {
    expect(readDashboard("Utils/RouteMap.ts")).toContain(
      "[PageMap.NETWORK_DEVICE_SETTINGS_NAMING_RULES]: `settings/naming-rules`",
    );
    expect(readDashboard("Routes/NetworkDeviceRoutes.tsx")).toContain(
      "<NetworkDeviceSettingsNamingRules",
    );
    expect(readDashboard("Pages/NetworkDevice/Utils/Breadcrumbs.ts")).toContain(
      '["Project", "Network", "Rules", "Naming Rules"]',
    );
    expect(
      readDashboard("Components/CommandPalette/PageSearchIndex.ts"),
    ).toMatch(
      /page: PageMap\.NETWORK_DEVICE_SETTINGS_NAMING_RULES,\s*title: "Naming Rules"/,
    );
  });

  test("Apply Naming Rules is in the Devices list's Bulk Actions, with its dialog", () => {
    const devices: string = readDashboard("Pages/NetworkDevice/Devices.tsx");

    expect(devices).toContain("...applyNamingRulesBulkActions,");
    expect(devices).toContain("{applyNamingRulesModals}");
  });

  test("both import dialogs preview the names", () => {
    expect(
      readDashboard(
        "Components/NetworkDevice/DiscoveryImport/DiscoveryImportDialog.tsx",
      ),
    ).toContain("namingPreview={namingPreview.byKey}");
    expect(
      readDashboard(
        "Components/NetworkDevice/DiscoveredDevices/AddDiscoveredDevicesDialog.tsx",
      ),
    ).toContain("<NamingPreviewList preview={namingPreview.preview} />");
  });

  test("the site forms offer a site code, folded under More fields", () => {
    for (const page of [
      "Pages/NetworkSite/Sites.tsx",
      "Pages/NetworkSite/View/Settings.tsx",
    ]) {
      expect(readDashboard(page)).toMatch(
        /field: \{\s*code: true,\s*\},\s*title: "Site Code",\s*stepId: "site-details",\s*collapsibleSection: SITE_MORE_FIELDS,/,
      );
    }
  });
});
