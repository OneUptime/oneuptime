import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Every table's empty state, at the level of the Dashboard's sources.
 *
 * The empty state itself is drawn by the shared table components (Common's
 * suite renders it). What a page has to get right is what it tells the
 * table, and those are invariants a renderer-less suite can hold:
 *
 *  - a table under a facet bar passes the bar's emptyState on, or a chip
 *    that matches nothing is presented as an empty project ("No monitors
 *    yet", and a Create button) instead of "nothing matches";
 *  - lists where empty is good news (active incidents, monitors that are
 *    not operational) say so with isAllClear, and get no Create button;
 *  - no page tells the reader to click a button that is now right under
 *    its message;
 *  - every new sentence is translated in all sixteen other languages.
 *
 * Sources are read with comments stripped and whitespace squashed, so prose
 * and prettier cannot turn a real regression check into a false alarm.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const FEATURE_SETS: string = path.join(__dirname, "..", "..", "FeatureSet");
const EE_ROOT: string = path.join(__dirname, "..", "..", "..", "..", "ee");

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function readCodeAt(absolutePath: string): string {
  return squash(stripComments(fs.readFileSync(absolutePath, "utf8")));
}

function readDashboardCode(relativePath: string): string {
  return readCodeAt(path.join(DASHBOARD_SRC, relativePath));
}

const SOURCE_FILE: RegExp = new RegExp("\\.(ts|tsx)$");

function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return files;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === "Locales" ||
        entry.name === "build" ||
        entry.name === "dist" ||
        entry.name === "Tests"
      ) {
        continue;
      }

      files.push(...listSourceFiles(fullPath));
    } else if (SOURCE_FILE.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

const DASHBOARD_FILES: Array<string> = listSourceFiles(DASHBOARD_SRC);

const HOOK_CALL: RegExp = new RegExp("useResourceOwners(<[^>]*>)?\\(");

/*
 * The pages and tables that put the facet bar into a table card. Found, not
 * listed, so a new one is held to this the day it is written.
 */
const FACET_TABLES: Array<string> = DASHBOARD_FILES.filter(
  (file: string): boolean => {
    const code: string = readCodeAt(file);

    return (
      HOOK_CALL.test(code) &&
      code.includes("topContent={filterBar}") &&
      !file.endsWith(path.join("ResourceOwners", "useResourceOwners.tsx"))
    );
  },
).map((file: string): string => {
  return path.relative(DASHBOARD_SRC, file);
});

describe("tables under a facet bar tell their empty state about the chips", () => {
  test("the hook hands one over, made of the bar's own state", () => {
    const hook: string = readDashboardCode(
      "Components/ResourceOwners/useResourceOwners.tsx",
    );

    expect(hook).toContain("emptyState: EmptyStateOptions;");
    expect(hook).toContain(
      squash(
        "return { isFiltered: hasActiveFilters, onClearFilters: clearAllFacets, };",
      ),
    );
    expect(hook).toContain("[hasActiveFilters, clearAllFacets]");
    expect(hook).toMatch(/clearAllFacets, emptyState, facetSaveState,/);
  });

  test("the scan found the facet tables, so the checks below are not vacuous", () => {
    // Monitors, Incidents, Alerts, Scheduled Maintenance and some 25 pages.
    expect(FACET_TABLES.length).toBeGreaterThanOrEqual(29);
    expect(FACET_TABLES).toEqual(
      expect.arrayContaining([
        path.join("Components", "Monitor", "MonitorTable.tsx"),
        path.join("Components", "Incident", "IncidentsTable.tsx"),
        path.join("Components", "Alert", "AlertsTable.tsx"),
        path.join("Pages", "Service", "Services.tsx"),
        path.join("Pages", "NetworkSite", "Sites.tsx"),
        path.join("Pages", "Slo", "Slos.tsx"),
      ]),
    );
  });

  test.each(FACET_TABLES)(
    "%s passes the hook's emptyState to its table",
    (file: string) => {
      const code: string = readDashboardCode(file);

      expect(code).toContain("emptyState: facetEmptyState,");
      expect(
        code.includes("emptyState={facetEmptyState}") ||
          code.includes("...facetEmptyState"),
      ).toBe(true);
    },
  );

  /*
   * The old way: each page worded its own "No X matches the filters above."
   * on hasActiveFilters - no way to clear them, the wrong illustration, and
   * a Create button under it once pages' own sentences got one.
   */
  test.each(FACET_TABLES)(
    "%s does not word the filtered state itself",
    (file: string) => {
      const code: string = readDashboardCode(file);

      expect(code).not.toMatch(/noItemsMessage=\{ ?hasActiveFilters/);
      expect(code).not.toMatch(/matches the (filters|facets) above/);
    },
  );

  test.each([
    "Components/Incident/IncidentsTable.tsx",
    "Components/Alert/AlertsTable.tsx",
    "Components/Monitor/MonitorTable.tsx",
    "Components/ScheduledMaintenance/ScheduledMaintenanceTable.tsx",
  ])(
    "%s merges its page's own emptyState with the chips' (the chips' last)",
    (file: string) => {
      const code: string = readDashboardCode(file);

      expect(code).toContain("emptyState?: EmptyStateOptions | undefined;");
      expect(code).toContain(
        "emptyState={{ ...props.emptyState, ...facetEmptyState }}",
      );
    },
  );

  test.each([
    "Components/IncidentEpisode/IncidentEpisodesTable.tsx",
    "Components/AlertEpisode/AlertEpisodesTable.tsx",
  ])("%s passes its page's emptyState on", (file: string) => {
    const code: string = readDashboardCode(file);

    expect(code).toContain("emptyState?: EmptyStateOptions | undefined;");
    expect(code).toContain("emptyState={props.emptyState}");
  });
});

interface AllClearPage {
  file: string;
  // The sentence or the title the page says it with.
  says: string;
}

/*
 * The lists that are slices of a bigger one, where empty is the good news.
 * Creating one is the wrong answer there - you do not declare an incident
 * because none is active - so they get the green check and no button.
 */
const ALL_CLEAR_PAGES: Array<AllClearPage> = [
  { file: "Pages/Incidents/Unresolved.tsx", says: "No active incidents" },
  { file: "Pages/Home/Home.tsx", says: "No active incidents" },
  { file: "Pages/Global/ActiveIncidents.tsx", says: "No active incidents" },
  { file: "Pages/Alerts/Unresolved.tsx", says: "No active alerts" },
  { file: "Pages/Home/ActiveAlerts.tsx", says: "No active alerts" },
  { file: "Pages/Global/ActiveAlerts.tsx", says: "No active alerts" },
  {
    file: "Pages/Incidents/UnresolvedEpisodes.tsx",
    says: "No active episodes. All episodes are resolved.",
  },
  {
    file: "Pages/Alerts/UnresolvedEpisodes.tsx",
    says: "No active episodes. All episodes are resolved.",
  },
  {
    file: "Pages/Home/ActiveIncidentEpisodes.tsx",
    says: "No active episodes. All episodes are resolved.",
  },
  {
    file: "Pages/Home/ActiveEpisodes.tsx",
    says: "No active episodes. All episodes are resolved.",
  },
  {
    file: "Pages/Global/ActiveIncidentEpisodes.tsx",
    says: "No active episodes. All episodes are resolved.",
  },
  {
    file: "Pages/Global/ActiveAlertEpisodes.tsx",
    says: "No active episodes. All episodes are resolved.",
  },
  {
    file: "Pages/ScheduledMaintenanceEvents/Ongoing.tsx",
    says: "No ongoing events so far.",
  },
  {
    file: "Pages/Home/OngoingScheduledMaintenance.tsx",
    says: "No ongoing events so far.",
  },
  {
    file: "Pages/Monitor/NotOperationalMonitors.tsx",
    says: "No monitors are reporting a problem.",
  },
  {
    file: "Pages/Home/NotOperationalMonitors.tsx",
    says: "No monitors are reporting a problem.",
  },
  {
    file: "Pages/Monitor/ProbeDisconnected.tsx",
    says: "No monitors with disconnected probes.",
  },
  {
    file: "Pages/Monitor/ProbeDisabled.tsx",
    says: "No monitors with disabled probes.",
  },
  {
    file: "Pages/Monitor/DisabledMonitors.tsx",
    says: "No disabled monitors.",
  },
];

describe("lists where empty is good news say so", () => {
  test.each(ALL_CLEAR_PAGES)("$file is all clear", (page: AllClearPage) => {
    const code: string = readDashboardCode(page.file);

    expect(code).toContain("isAllClear: true");
    expect(code).toContain(page.says);
  });

  test.each(ALL_CLEAR_PAGES)(
    "$file no longer says 'Nice work! No Active ... so far.'",
    (page: AllClearPage) => {
      const code: string = readDashboardCode(page.file);

      expect(code).not.toMatch(/Nice work! No Active/);
      expect(code).not.toMatch(/"No (incident|alert) found\."/);
    },
  );

  test("active incidents and alerts lead with the fact, then the good news", () => {
    for (const file of [
      "Pages/Incidents/Unresolved.tsx",
      "Pages/Home/Home.tsx",
      "Pages/Global/ActiveIncidents.tsx",
    ]) {
      expect([file, readDashboardCode(file)]).toEqual([
        file,
        expect.stringContaining(
          squash(
            'title: "No active incidents", description: "Nice work! Every incident is resolved.",',
          ),
        ),
      ]);
    }

    for (const file of [
      "Pages/Alerts/Unresolved.tsx",
      "Pages/Home/ActiveAlerts.tsx",
      "Pages/Global/ActiveAlerts.tsx",
    ]) {
      expect([file, readDashboardCode(file)]).toEqual([
        file,
        expect.stringContaining(
          squash(
            'title: "No active alerts", description: "Nice work! Every alert is resolved.",',
          ),
        ),
      ]);
    }
  });
});

/*
 * Every product surface whose tables share the components: the Dashboard,
 * the Admin Dashboard and the enterprise pages.
 */
const ALL_TABLE_SOURCES: Array<string> = [
  ...DASHBOARD_FILES,
  ...listSourceFiles(path.join(FEATURE_SETS, "AdminDashboard", "src")),
  ...listSourceFiles(path.join(EE_ROOT, "Dashboard")),
  ...listSourceFiles(path.join(EE_ROOT, "AdminDashboard")),
];

// Named rather than inline: eslint's wrap-regex and prettier disagree on these.
const POINTS_AT_CREATE_BUTTON: RegExp = new RegExp(
  "Click on the \\\\?[\"']Create\\\\?[\"'] button",
  "i",
);
const POINTS_ABOVE: RegExp = new RegExp("above to add", "i");
const ENDS_IN_FULL_STOP: RegExp = new RegExp("[.。]$");

const NO_ITEMS_LITERAL: RegExp = new RegExp(
  "noItemsMessage=\\{?\\s*(\"[^\"]*\"|'[^']*'|`[^`]*`)",
  "g",
);

describe("no empty table sends the reader to a button elsewhere", () => {
  const messages: Array<[string, string]> = [];

  for (const file of ALL_TABLE_SOURCES) {
    const code: string = readCodeAt(file);

    for (const match of code.matchAll(NO_ITEMS_LITERAL)) {
      messages.push([path.basename(file), match[1]!]);
    }
  }

  test("the scan found the pages' messages", () => {
    expect(messages.length).toBeGreaterThan(100);
  });

  /*
   * 'Click on the "Create" button' and "Click 'Add Processor' above" were
   * true when the only button was in the card's header. The empty state now
   * repeats that button right under the message.
   */
  test("no message points at a create button above it", () => {
    const pointers: Array<[string, string]> = messages.filter(
      ([, message]: [string, string]): boolean => {
        return (
          POINTS_AT_CREATE_BUTTON.test(message) || POINTS_ABOVE.test(message)
        );
      },
    );

    expect(pointers).toEqual([]);
  });
});

describe("the empty states' words are translated everywhere", () => {
  type Locale = Record<string, unknown>;

  const locales: Record<string, Locale> = {};

  for (const file of fs.readdirSync(LOCALES_DIR).sort()) {
    if (file.endsWith(".json")) {
      locales[file.replace(/\.json$/, "")] = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
      ) as Locale;
    }
  }

  const nonEnglish: Array<string> = Object.keys(locales).filter(
    (code: string): boolean => {
      return code !== "en";
    },
  );

  // Restated, not imported: the App suite cannot load React modules.
  const KEYS: Array<string> = [
    "Couldn't load this list.",
    "Try again",
    "Clear Search",
    "Clear Filters",
    "Clear Search and Filters",
    "View Documentation",
    "You don't have permission to create these. Ask a project admin for access.",
    "You don't have access to this list",
    "Ask a project admin for one of these permissions:",
    "Nothing here yet.",
    "Nothing matches your search or filters.",
    "No active incidents",
    "Nice work! Every incident is resolved.",
    "No active alerts",
    "Nice work! Every alert is resolved.",
    "No active episodes. All episodes are resolved.",
    "No items found.",
    "No items match your search",
    "Read the setup guide",
  ];

  test("there are seventeen locales", () => {
    expect(Object.keys(locales)).toHaveLength(17);
  });

  test.each(KEYS)("%s", (key: string) => {
    expect([key, locales["en"]![key]]).toEqual([key, key]);

    for (const code of nonEnglish) {
      const value: unknown = locales[code]![key];

      expect([code, key, typeof value]).toEqual([code, key, "string"]);
      expect((value as string).trim().length).toBeGreaterThan(0);
      expect([code, key, value]).not.toEqual([code, key, key]);
    }
  });

  /*
   * A title is drawn without its full stop and a sentence is split where a
   * reader would: a translation that ends its title in the wrong place, or
   * runs the good news into one sentence, would read oddly.
   */
  test("the all-clear titles are one short line, and the good news one sentence", () => {
    for (const code of Object.keys(locales)) {
      for (const title of ["No active incidents", "No active alerts"]) {
        const value: string = locales[code]![title] as string;

        expect([code, title, value.length < 60]).toEqual([code, title, true]);
        expect([code, title, ENDS_IN_FULL_STOP.test(value)]).toEqual([
          code,
          title,
          false,
        ]);
      }
    }
  });
});
