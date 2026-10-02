import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "This doesn't have a colour, just like the incident severity on top. Can
 * you please add colours to incident state as well?"
 *
 * Every state, severity and monitor status has a colour, and a dropdown
 * draws an option's colour as a dot before its name. The dot goes missing
 * whenever a list of them is turned into options by hand without it - the
 * incident template's Initial Incident State did exactly that, and so did
 * the monitor criteria, the bulk Change State dialogs, the workspace rule
 * conditions, the dashboard filters, the monitor recommendation severities
 * and the Forms On Submit severity. These rules keep a new picker from
 * quietly doing it again:
 *
 *   1. a hand-written option built from a state, severity or status row
 *      carries the row's colour (or the list goes through
 *      DropdownUtil.getDropdownOptionsFromEntityArray, which does);
 *   2. a field's own fetchDropdownOptions that lists one selects its colour;
 *   3. each bulk Change State dialog gets its options from its state rows,
 *      fetched with their colour;
 *   4. the incident and alert state fields list the states in their order
 *      through ModelForm (dropdownModal.sort), not through a list of their
 *      own;
 *   5. the monitor criteria and monitor recommendation pickers fetch their
 *      statuses and severities with their colours;
 *   6. the "Change state to" menu in an event's header shows each state's
 *      colour.
 */

const PACKAGES: string = path.join(__dirname, "..", "..", "..");
const DASHBOARD_SRC: string = path.join(
  PACKAGES,
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

// Where states, severities and statuses are turned into dropdown options.
const SCAN_ROOTS: Array<string> = [
  DASHBOARD_SRC,
  path.join(PACKAGES, "App", "FeatureSet", "AdminDashboard", "src"),
  path.join(PACKAGES, "Common", "UI"),
  path.join(PACKAGES, "Common", "Types"),
  path.join(PACKAGES, "..", "ee", "Dashboard"),
];

const COLORED_MODELS: Array<string> = [
  "IncidentState",
  "IncidentSeverity",
  "AlertState",
  "AlertSeverity",
  "ScheduledMaintenanceState",
  "MonitorStatus",
];

interface SourceFile {
  relativePath: string;
  source: string;
}

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

const SOURCES: Array<SourceFile> = SCAN_ROOTS.flatMap(
  (root: string): Array<string> => {
    return listSourceFiles(root);
  },
).map((fullPath: string): SourceFile => {
  return {
    relativePath: path.relative(path.join(PACKAGES, ".."), fullPath),
    source: fs.readFileSync(fullPath, "utf8"),
  };
});

function readDashboardSource(relativePath: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8");
}

/*
 * The index of the bracket that closes the one at `openIndex`, skipping
 * strings, template literals and comments - so a "{" inside a string or a
 * comment does not throw the count off.
 */
function matchingBracket(source: string, openIndex: number): number {
  const open: string = source[openIndex] as string;
  const close: string = open === "{" ? "}" : open === "(" ? ")" : "]";
  let depth: number = 0;

  for (let index: number = openIndex; index < source.length; index++) {
    const char: string = source[index] as string;
    const next: string = source[index + 1] || "";

    if (char === "/" && next === "/") {
      index = source.indexOf("\n", index);
      if (index === -1) {
        return -1;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      index = source.indexOf("*/", index + 2) + 1;
      if (index === 0) {
        return -1;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      for (index = index + 1; index < source.length; index++) {
        if (source[index] === "\\") {
          index++;
          continue;
        }
        if (source[index] === char) {
          break;
        }
      }
      continue;
    }

    if (char === open) {
      depth++;
    } else if (char === close) {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

const MODEL_PATTERN: string = COLORED_MODELS.join("|");

/*
 * Every `.map((row: <Model>) => ...)` over a state, severity or status row,
 * with the callback's source.
 */
function rowMaps(file: SourceFile): Array<{ line: number; callback: string }> {
  const pattern: RegExp = new RegExp(
    `\\.map\\(\\s*\\(\\s*\\w+\\s*:\\s*(?:${MODEL_PATTERN})\\b`,
    "g",
  );
  const maps: Array<{ line: number; callback: string }> = [];

  for (const match of file.source.matchAll(pattern)) {
    const openParen: number = file.source.indexOf("(", match.index);
    const closeParen: number = matchingBracket(file.source, openParen);

    maps.push({
      line: lineOf(file.source, match.index),
      callback: file.source.slice(openParen, closeParen + 1),
    });
  }

  return maps;
}

// The inline function given as a field's fetchDropdownOptions, if any.
function inlineFetchDropdownOptions(
  file: SourceFile,
): Array<{ line: number; body: string }> {
  const bodies: Array<{ line: number; body: string }> = [];
  const pattern: RegExp = /fetchDropdownOptions:\s*(async\s*)?\(/g;

  for (const match of file.source.matchAll(pattern)) {
    const arrow: number = file.source.indexOf("=>", match.index);
    const bodyStart: number = file.source.indexOf("{", arrow);

    if (arrow === -1 || bodyStart === -1) {
      continue;
    }

    bodies.push({
      line: lineOf(file.source, match.index),
      body: file.source.slice(
        bodyStart,
        matchingBracket(file.source, bodyStart) + 1,
      ),
    });
  }

  return bodies;
}

// The select block of every list request for `model` in `source`.
function listSelectsFor(source: string, model: string): Array<string> {
  const selects: Array<string> = [];
  const pattern: RegExp = new RegExp(`modelType:\\s*${model}\\b`, "g");

  for (const match of source.matchAll(pattern)) {
    const selectIndex: number = source.indexOf("select:", match.index);
    const braceIndex: number = source.indexOf("{", selectIndex);

    // Only a select that belongs to this request (before the next request).
    const nextRequest: number = source.indexOf("modelType:", match.index + 1);

    if (
      selectIndex === -1 ||
      (nextRequest !== -1 && selectIndex > nextRequest)
    ) {
      continue;
    }

    selects.push(
      source.slice(braceIndex, matchingBracket(source, braceIndex) + 1),
    );
  }

  return selects;
}

describe("the guard reads the code it guards", () => {
  test("it scans the Dashboard and the shared UI", () => {
    const paths: Array<string> = SOURCES.map((file: SourceFile): string => {
      return file.relativePath;
    });

    expect(paths).toContain(
      path.join(
        "packages",
        "App",
        "FeatureSet",
        "Dashboard",
        "src",
        "Pages",
        "Incidents",
        "Settings",
        "IncidentTemplates.tsx",
      ),
    );
    expect(paths).toContain(
      path.join(
        "packages",
        "Common",
        "Types",
        "Workspace",
        "NotificationRules",
        "NotificationRuleCondition.ts",
      ),
    );
  });

  test("it finds the hand-written option lists that carry a colour", () => {
    // The incidents table's State facet maps its rows by hand, with colour.
    const incidentsTable: SourceFile = SOURCES.find(
      (file: SourceFile): boolean => {
        return file.relativePath.endsWith(
          path.join("Components", "Incident", "IncidentsTable.tsx"),
        );
      },
    )!;

    expect(rowMaps(incidentsTable).length).toBeGreaterThan(0);
  });

  test("the bracket matcher skips strings and comments", () => {
    const source: string = 'f({ a: "}", b: `{`, /* } */ c: 1 // }\n})';

    expect(matchingBracket(source, 1)).toBe(source.length - 1);
    expect(matchingBracket(source, 2)).toBe(source.length - 2);
  });
});

describe("state, severity and status options keep their colours", () => {
  test("1. a hand-written option from a state, severity or status row carries its colour", () => {
    const missing: Array<string> = [];

    for (const file of SOURCES) {
      for (const map of rowMaps(file)) {
        // Only maps that build a dropdown option (they set its label).
        if (!/\blabel\s*:/.test(map.callback)) {
          continue;
        }

        if (!/\bcolor\b/.test(map.callback)) {
          missing.push(`${file.relativePath}:${map.line}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  test("2. a field's own fetchDropdownOptions that lists one selects its colour", () => {
    const missing: Array<string> = [];

    for (const file of SOURCES) {
      for (const fetch of inlineFetchDropdownOptions(file)) {
        for (const model of COLORED_MODELS) {
          for (const select of listSelectsFor(fetch.body, model)) {
            if (!/\bcolor\s*:\s*true\b/.test(select)) {
              missing.push(`${file.relativePath}:${fetch.line} (${model})`);
            }
          }
        }
      }
    }

    expect(missing).toEqual([]);
  });
});

const BULK_TABLES: Array<{ file: string; model: string }> = [
  { file: "Components/Incident/IncidentsTable.tsx", model: "IncidentState" },
  { file: "Components/Alert/AlertsTable.tsx", model: "AlertState" },
  {
    file: "Components/IncidentEpisode/IncidentEpisodesTable.tsx",
    model: "IncidentState",
  },
  {
    file: "Components/AlertEpisode/AlertEpisodesTable.tsx",
    model: "AlertState",
  },
  {
    file: "Components/ScheduledMaintenance/ScheduledMaintenanceTable.tsx",
    model: "ScheduledMaintenanceState",
  },
];

describe("3. the bulk Change State dialogs show each state's colour", () => {
  test("every table that opens one is listed here", () => {
    const opening: Array<string> = SOURCES.filter(
      (file: SourceFile): boolean => {
        return (
          file.source.includes("<BulkChangeStateModal") &&
          !file.relativePath.endsWith("BulkChangeStateModal.tsx")
        );
      },
    )
      .map((file: SourceFile): string => {
        return file.relativePath.split(path.join("Dashboard", "src") + path.sep)[1]!;
      })
      .map((relativePath: string): string => {
        return relativePath.split(path.sep).join("/");
      })
      .sort();

    expect(opening).toEqual(
      BULK_TABLES.map((table: { file: string }): string => {
        return table.file;
      }).sort(),
    );
  });

  test.each(BULK_TABLES)(
    "$file builds its state options from the state rows",
    (table: { file: string; model: string }) => {
      const source: string = readDashboardSource(table.file);
      const modalIndex: number = source.indexOf("<BulkChangeStateModal");
      const stateOptionsIndex: number = source.indexOf(
        "stateOptions={",
        modalIndex,
      );

      expect(stateOptionsIndex).toBeGreaterThan(modalIndex);
      expect(
        source.slice(stateOptionsIndex, stateOptionsIndex + 80),
      ).toContain("DropdownUtil.getDropdownOptionsFromEntityArray(");
    },
  );

  test.each(BULK_TABLES)(
    "$file fetches its $model rows with their colour",
    (table: { file: string; model: string }) => {
      const selects: Array<string> = listSelectsFor(
        readDashboardSource(table.file),
        table.model,
      );

      expect(selects.length).toBeGreaterThan(0);

      for (const select of selects) {
        expect(select).toMatch(/\bcolor:\s*true\b/);
      }
    },
  );
});

const STATE_FIELDS: Array<{ file: string; model: string }> = [
  {
    file: "Pages/Incidents/Settings/IncidentTemplates.tsx",
    model: "IncidentState",
  },
  {
    file: "Pages/Incidents/Settings/IncidentTemplatesView.tsx",
    model: "IncidentState",
  },
  { file: "Pages/Incidents/Create.tsx", model: "IncidentState" },
  { file: "Pages/Incidents/EpisodeCreate.tsx", model: "IncidentState" },
  { file: "Pages/Alerts/Create.tsx", model: "AlertState" },
  { file: "Pages/Alerts/EpisodeCreate.tsx", model: "AlertState" },
];

describe("4. the incident and alert state fields list the states in order, with colours", () => {
  test.each(STATE_FIELDS)(
    "$file asks ModelForm for the $model list in its order",
    (stateField: { file: string; model: string }) => {
      const source: string = readDashboardSource(stateField.file);
      const pattern: RegExp = new RegExp(
        `dropdownModal:\\s*\\{\\s*type:\\s*${stateField.model},`,
      );
      const match: RegExpMatchArray | null = source.match(pattern);

      expect(match).not.toBeNull();

      const braceIndex: number = source.indexOf("{", match!.index);
      const dropdownModal: string = source.slice(
        braceIndex,
        matchingBracket(source, braceIndex) + 1,
      );

      expect(dropdownModal).toMatch(
        /sort:\s*\{\s*order:\s*SortOrder\.Ascending,?\s*\}/,
      );
    },
  );

  test.each(STATE_FIELDS)(
    "$file does not fetch its states a second time",
    (stateField: { file: string; model: string }) => {
      const file: SourceFile = {
        relativePath: stateField.file,
        source: readDashboardSource(stateField.file),
      };

      for (const fetch of inlineFetchDropdownOptions(file)) {
        expect(fetch.body).not.toMatch(
          new RegExp(`modelType:\\s*${stateField.model}\\b`),
        );
      }
    },
  );
});

describe("5. the monitor criteria and recommendations show status and severity colours", () => {
  const criteriaSteps: string = readDashboardSource(
    "Components/Form/Monitor/MonitorSteps.tsx",
  );

  test.each(["MonitorStatus", "IncidentSeverity", "AlertSeverity", "Label"])(
    "the criteria fetch every %s with its colour",
    (model: string) => {
      const selects: Array<string> = listSelectsFor(criteriaSteps, model);

      expect(selects.length).toBeGreaterThan(0);

      for (const select of selects) {
        expect(select).toMatch(/\bcolor:\s*true\b/);
      }
    },
  );

  test.each([
    "setMonitorStatusDropdownOptions",
    "setIncidentSeverityDropdownOptions",
    "setAlertSeverityDropdownOptions",
    "setLabelDropdownOptions",
  ])("%s gets options built from the rows", (setter: string) => {
    const index: number = criteriaSteps.indexOf(`${setter}(`);

    expect(index).toBeGreaterThan(-1);
    expect(criteriaSteps.slice(index, index + 120)).toContain(
      "DropdownUtil.getDropdownOptionsFromEntityArray(",
    );
  });

  test.each(["IncidentSeverity", "AlertSeverity"])(
    "the recommendations fetch every %s with its colour",
    (model: string) => {
      const selects: Array<string> = listSelectsFor(
        readDashboardSource("Components/Recommendations/MonitorRecommendations.tsx"),
        model,
      );

      expect(selects.length).toBeGreaterThan(0);

      for (const select of selects) {
        expect(select).toMatch(/\bcolor:\s*true\b/);
      }
    },
  );
});

describe("6. the Change state to menu shows each state's colour", () => {
  test("the header's state menu items get the state's colour", () => {
    const source: string = readDashboardSource(
      "Components/EventView/EventStatusPanel.tsx",
    );
    const menuIndex: number = source.indexOf("statesForMenu.map(");
    const itemIndex: number = source.indexOf("<MoreMenuItem", menuIndex);
    const itemEnd: number = source.indexOf("/>", itemIndex);

    expect(menuIndex).toBeGreaterThan(-1);
    expect(source.slice(itemIndex, itemEnd)).toContain("color={state.color}");
  });

  test.each([
    "Components/Incident/ChangeState.tsx",
    "Components/Alert/ChangeState.tsx",
    "Components/IncidentEpisode/ChangeState.tsx",
    "Components/AlertEpisode/ChangeState.tsx",
    "Components/ScheduledMaintenance/ChangeState.tsx",
  ])("%s hands the panel its states with their colours", (file: string) => {
    const source: string = readDashboardSource(file);
    const statesIndex: number = source.indexOf("<EventStatusPanel");
    const panel: string = source.slice(statesIndex, statesIndex + 600);

    expect(panel).toMatch(/color:\s*state\.color/);
  });
});
