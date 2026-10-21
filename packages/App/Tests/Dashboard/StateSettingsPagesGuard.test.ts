import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The state, severity and monitor status settings pages, read as source, and
 * the shared UI they used to be drawn with.
 *
 * "This page is extremely hard to understand and use" - a stack of big
 * centred cards with raw IDs, chevrons and an "Add New Item" bubble between
 * every pair. These rules keep it from coming back:
 *
 *   1. the ordered-states list component and its ShowAs mode are gone, and
 *      nothing in the Dashboard, the admin dashboard, the shared UI or ee
 *      asks for them;
 *   2. each of the six pages is a drag-ordered table that takes its columns,
 *      form and words from Components/StateSettings, shows the ID only
 *      behind Show ID, and locks the built-in rows through
 *      getDeleteDisabledReason rather than refusing in onBeforeDelete;
 *   3. no page anywhere asks for "the state numbered 1" - states are
 *      dragged into any order, so "active" is the created state itself.
 */

const PACKAGES: string = path.join(__dirname, "..", "..", "..");
const REPO: string = path.join(PACKAGES, "..");
const DASHBOARD_SRC: string = path.join(
  PACKAGES,
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

const SCAN_ROOTS: Array<string> = [
  DASHBOARD_SRC,
  path.join(PACKAGES, "App", "FeatureSet", "AdminDashboard", "src"),
  path.join(PACKAGES, "Common", "UI"),
  path.join(REPO, "ee", "Dashboard"),
];

function listSourceFiles(directory: string): Array<string> {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (
        ["node_modules", "Locales", "build", "dist", "Tests"].includes(
          entry.name,
        )
      ) {
        continue;
      }

      files.push(...listSourceFiles(fullPath));
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.includes(".test.")
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

const SOURCES: Array<{ file: string; source: string }> = SCAN_ROOTS.flatMap(
  (root: string): Array<string> => {
    return listSourceFiles(root);
  },
).map((file: string) => {
  return {
    file: path.relative(REPO, file),
    source: fs.readFileSync(file, "utf8"),
  };
});

const PAGES: Array<{
  file: string;
  model: string;
  orderColumn: string;
  hasBuiltIns: boolean;
}> = [
  {
    file: "Pages/Incidents/Settings/IncidentState.tsx",
    model: "IncidentState",
    orderColumn: "order",
    hasBuiltIns: true,
  },
  {
    file: "Pages/Alerts/Settings/AlertState.tsx",
    model: "AlertState",
    orderColumn: "order",
    hasBuiltIns: true,
  },
  {
    file: "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceState.tsx",
    model: "ScheduledMaintenanceState",
    orderColumn: "order",
    hasBuiltIns: true,
  },
  {
    file: "Pages/Monitor/Settings/MonitorStatus.tsx",
    model: "MonitorStatus",
    orderColumn: "priority",
    hasBuiltIns: true,
  },
  {
    file: "Pages/Incidents/Settings/IncidentSeverity.tsx",
    model: "IncidentSeverity",
    orderColumn: "order",
    hasBuiltIns: false,
  },
  {
    file: "Pages/Alerts/Settings/AlertSeverity.tsx",
    model: "AlertSeverity",
    orderColumn: "order",
    hasBuiltIns: false,
  },
];

function readPage(file: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, file), "utf8");
}

describe("the guard reads the code it guards", () => {
  test("it scans the Dashboard and the shared UI", () => {
    const files: Array<string> = SOURCES.map(
      (entry: { file: string }): string => {
        return entry.file;
      },
    );

    expect(files.length).toBeGreaterThan(1000);
    expect(files).toContain(
      path.join(
        "packages",
        "Common",
        "UI",
        "Components",
        "ModelTable",
        "BaseModelTable.tsx",
      ),
    );
  });
});

const ORDERED_STATES_LIST: RegExp = /OrderedStatesList|orderedStatesListProps/;

describe("1. the ordered-states list is gone", () => {
  test("its component is deleted", () => {
    expect(
      fs.existsSync(
        path.join(PACKAGES, "Common", "UI", "Components", "OrderedStatesList"),
      ),
    ).toBe(false);
  });

  test("nothing asks for it", () => {
    const users: Array<string> = SOURCES.filter(
      (entry: { source: string }): boolean => {
        return ORDERED_STATES_LIST.test(entry.source);
      },
    ).map((entry: { file: string }): string => {
      return entry.file;
    });

    expect(users).toEqual([]);
  });

  test("and no list draws an 'Add New Item' bubble", () => {
    const users: Array<string> = SOURCES.filter(
      (entry: { source: string }): boolean => {
        return entry.source.includes('"Add New Item"');
      },
    ).map((entry: { file: string }): string => {
      return entry.file;
    });

    expect(users).toEqual([]);
  });
});

describe.each(PAGES)(
  "2. $file",
  (page: {
    file: string;
    model: string;
    orderColumn: string;
    hasBuiltIns: boolean;
  }) => {
    const source: string = readPage(page.file);

    test("is one drag-ordered table of its model", () => {
      expect(source).toContain(`<ModelTable<${page.model}>`);
      expect(source).toContain("enableDragAndDrop={true}");
      expect(source).toContain(`dragDropIndexField="${page.orderColumn}"`);
      expect(source).toContain(`sortBy="${page.orderColumn}"`);
      expect(source).not.toContain("showAs=");
    });

    test("takes its columns, form and words from the shared state settings", () => {
      expect(source).toContain(`getStateSettingsColumns<${page.model}>(`);
      expect(source).toContain(`getStateSettingsFormFields<${page.model}>(`);
      expect(source).toContain("STATE_SETTINGS_COPY[StateListType.");
      // No sentence of its own in the card.
      expect(source).not.toMatch(/description:\s*\n?\s*"/);
    });

    test("keeps the ID behind Show ID, never on the row", () => {
      expect(source).toContain("showViewIdButton={true}");
      expect(source).not.toMatch(/ID:\s*\{/);
      expect(source).not.toContain('item["_id"]');
    });

    test("locks the built-in rows instead of refusing in onBeforeDelete", () => {
      expect(source).not.toContain("onBeforeDelete");

      if (page.hasBuiltIns) {
        expect(source).toContain("getDeleteDisabledReason=");
        expect(source).toContain("getStateSettingsDeleteLockedReason(");
      } else {
        expect(source).not.toContain("getDeleteDisabledReason=");
      }
    });

    test("drops the cached lists the pickers read whenever it fetches", () => {
      expect(source).toContain(`ModelListCache.invalidate(${page.model})`);
    });
  },
);

describe("3. nothing asks for the state numbered 1", () => {
  const RELATIONS: RegExp =
    /current(?:Incident|Alert|ScheduledMaintenance)State:\s*\{\s*(?:\/\*[\s\S]*?\*\/\s*)?order:\s*1\b/;

  test("no query pins a current state's order to 1", () => {
    const pinned: Array<string> = SOURCES.filter(
      (entry: { source: string }): boolean => {
        return RELATIONS.test(entry.source);
      },
    ).map((entry: { file: string }): string => {
      return entry.file;
    });

    expect(pinned).toEqual([]);
  });

  test.each([
    "Components/Header/Header.tsx",
    "Pages/Global/ActiveIncidents.tsx",
    "Pages/Global/ActiveIncidentEpisodes.tsx",
    "Pages/Global/ActiveAlerts.tsx",
    "Pages/Global/ActiveAlertEpisodes.tsx",
  ])("%s asks for the created state itself", (file: string) => {
    expect(readPage(file)).toMatch(
      /current(?:Incident|Alert)State:\s*\{[\s\S]*?isCreatedState:\s*true/,
    );
  });
});
