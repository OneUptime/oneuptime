import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * An SLO is an affected resource of every alert and incident its burn rate
 * rules raise (Incident.serviceLevelObjectives / Alert.serviceLevelObjectives,
 * written by the SLO worker). The behaviour is covered where it can run:
 *   Common/Tests/App/Dashboard/AffectedResourcesSlo.test.tsx   - card + cell
 *   Common/Tests/App/Dashboard/SloElement.test.tsx             - the link
 *   Common/Tests/App/Dashboard/SloViewSideMenuCounts.test.tsx  - badges
 *   App/Tests/Dashboard/AffectedResourcesFacetServiceLevelObjective.test.ts
 *   Common/Tests/Server/Services/IncidentAlertSloLinkSurvivesEdit.test.ts
 *
 * What none of those reach is the wiring between pages, tables and the
 * relation, and that is where this goes wrong quietly: a table that shows the
 * cell but forgets to select the relation renders an empty cell; a select
 * that reaches an unflagged SLO column breaks the whole incident list for a
 * role without SLO read access; a form that registers the relation lets an
 * edit drop the link the SLO's own tabs list by. This App suite has no
 * renderer, so those are pinned by reading the sources (comment-stripped,
 * whitespace-squashed). The checks are invariants - they scan for every site
 * rather than pinning another feature's file contents.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const MODELS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "Models",
  "DatabaseModels",
);

// Mirrors ColumnPermissions.getExcludedColumnNames().
const EXCLUDED_COLUMN_NAMES: Array<string> = [
  "_id",
  "createdAt",
  "deletedAt",
  "updatedAt",
  "version",
];

const BLOCK_COMMENT_PATTERN: RegExp = /\/\*[\s\S]*?\*\//g;
// A `//` that is not part of a URL (`https://`) or inside a quote.
const LINE_COMMENT_PATTERN: RegExp = /(^|[^:"'`])\/\/.*$/gm;
const WHITESPACE_PATTERN: RegExp = /\s+/g;

function normalizeSource(text: string): string {
  return text
    .replace(BLOCK_COMMENT_PATTERN, " ")
    .replace(LINE_COMMENT_PATTERN, "$1 ")
    .replace(WHITESPACE_PATTERN, " ");
}

function readSource(...relativeParts: Array<string>): string {
  return normalizeSource(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
  );
}

function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  // A named RegExp, because eslint's wrap-regex and prettier fight over a bare literal.
  const sourceFilePattern: RegExp = /\.tsx?$/;

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
    } else if (sourceFilePattern.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

/*
 * The balanced `{...}` that starts at the first "{" at or after `fromIndex`.
 * The blocks read here are select / props objects with no braces in strings.
 */
function braceBlockFrom(source: string, fromIndex: number): string {
  const start: number = source.indexOf("{", fromIndex);

  if (start === -1) {
    throw new Error(`No "{" after index ${fromIndex}.`);
  }

  let depth: number = 0;

  for (let i: number = start; i < source.length; i++) {
    if (source[i] === "{") {
      depth++;
    } else if (source[i] === "}") {
      depth--;

      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }

  throw new Error(`Unbalanced block starting at index ${start}.`);
}

function blockAfter(source: string, marker: string): string {
  const index: number = source.indexOf(marker);

  if (index === -1) {
    throw new Error(`Marker not found: ${marker}`);
  }

  return braceBlockFrom(source, index + marker.length - 1);
}

// The `field: { ... }` block of the column / detail field that renders `jsx`.
function fieldBlockRendering(source: string, jsx: string): string {
  const renderIndex: number = source.indexOf(jsx);

  if (renderIndex === -1) {
    throw new Error(`Nothing renders ${jsx}.`);
  }

  const fieldIndex: number = source.lastIndexOf("field: {", renderIndex);

  if (fieldIndex === -1) {
    throw new Error(`No field block before ${jsx}.`);
  }

  return braceBlockFrom(source, fieldIndex);
}

// The props of the first `<Component ... />` occurrence.
function jsxPropsOf(source: string, component: string): string {
  const start: number = source.indexOf(`<${component}`);

  if (start === -1) {
    throw new Error(`<${component}> is not rendered.`);
  }

  return source.slice(start, source.indexOf("/>", start));
}

describe("the SLO Alerts and Incidents tabs list through the relation", () => {
  test.each([
    ["Alerts.tsx", "AlertsTable"],
    ["Incidents.tsx", "IncidentsTable"],
  ])(
    "Pages/Slo/View/%s filters %s by serviceLevelObjectives",
    (fileName: string, table: string) => {
      const source: string = readSource("Pages", "Slo", "View", fileName);

      expect(source).toContain(
        "serviceLevelObjectives: new Includes([modelId])",
      );
      expect(source).toContain(`<${table} query={query}`);
      /*
       * The fingerprint prefix was the old link. The relation is what the
       * side menu badge counts, so the list must use it too.
       */
      expect(source).not.toContain("seriesFingerprint");
      expect(source).not.toContain("StartsWith");
      // The link cannot be made by hand, so a hand-made record would never list here.
      expect(source).toContain("disableCreate={true}");
    },
  );
});

describe("the incident and alert tables load the relation the resources cell reads", () => {
  test.each([
    ["Incident", ["Components", "Incident", "IncidentsTable.tsx"]],
    ["Alert", ["Components", "Alert", "AlertsTable.tsx"]],
  ])(
    "the %s table selects serviceLevelObjectives in both selects, renders it and opts into the SLO filter",
    (modelName: string, fileParts: Array<string>) => {
      const source: string = readSource(...fileParts);

      /*
       * BaseModelTable auto-selects only the FIRST key of a column's field
       * block, so every other relation the cell reads must also be in
       * selectMoreFields - and the column block is what the column
       * chooser and export read.
       */
      expect(blockAfter(source, "selectMoreFields={{")).toContain(
        "serviceLevelObjectives: {",
      );
      expect(fieldBlockRendering(source, "<AffectedResourcesCell")).toContain(
        "serviceLevelObjectives: {",
      );
      expect(jsxPropsOf(source, "AffectedResourcesCell")).toContain(
        "serviceLevelObjectives={item.serviceLevelObjectives || []}",
      );
      expect(
        blockAfter(source, `buildAffectedResourcesFacet<${modelName}>({`),
      ).toContain("includeServiceLevelObjective: true");
    },
  );
});

describe("the incident and alert pages show the SLOs they are linked to", () => {
  test.each([["Incidents"], ["Alerts"]])(
    "Pages/%s/View/Index.tsx selects the relation and hands it to the display",
    (productFolder: string) => {
      const source: string = readSource(
        "Pages",
        productFolder,
        "View",
        "Index.tsx",
      );

      expect(
        fieldBlockRendering(source, "<AffectedResourcesDisplay"),
      ).toContain("serviceLevelObjectives: {");
      expect(jsxPropsOf(source, "AffectedResourcesDisplay")).toMatch(
        /serviceLevelObjectives=\{ ?item\.serviceLevelObjectives \|\| \[\] ?\}/,
      );
    },
  );
});

describe("only relation-readable SLO columns are selected through serviceLevelObjectives", () => {
  test("every serviceLevelObjectives select in the dashboard reaches only flagged columns", () => {
    const sloModel: ServiceLevelObjective = new ServiceLevelObjective();
    const sites: Array<string> = [];
    const violations: Array<string> = [];
    const selectPattern: RegExp = /serviceLevelObjectives: \{/g;
    const keyPattern: RegExp = /([A-Za-z_$][\w$]*) ?:/g;

    for (const filePath of listSourceFiles(DASHBOARD_SRC)) {
      const source: string = normalizeSource(fs.readFileSync(filePath, "utf8"));
      let match: RegExpExecArray | null = selectPattern.exec(source);

      while (match) {
        const block: string = braceBlockFrom(source, match.index);
        const relativePath: string = path.relative(DASHBOARD_SRC, filePath);

        sites.push(relativePath);

        let keyMatch: RegExpExecArray | null = keyPattern.exec(block);

        while (keyMatch) {
          const column: string = keyMatch[1]!;
          const metadata: TableColumnMetadata | undefined =
            sloModel.getTableColumnMetadata(column);

          if (
            !EXCLUDED_COLUMN_NAMES.includes(column) &&
            !metadata?.canReadOnRelationQuery
          ) {
            violations.push(
              `${relativePath}: serviceLevelObjectives.${column}`,
            );
          }

          keyMatch = keyPattern.exec(block);
        }

        keyPattern.lastIndex = 0;
        match = selectPattern.exec(source);
      }
    }

    /*
     * Both tables (two selects each) and both view pages. Fewer means the
     * scan stopped matching the call shape and is checking nothing.
     */
    expect(sites.length).toBeGreaterThanOrEqual(6);
    expect(violations).toEqual([]);
  });
});

describe("the SLO filter type is offered only where the parent model has the relation", () => {
  test("every buildAffectedResourcesFacet call opts in exactly when its model has serviceLevelObjectives", () => {
    const callPattern: RegExp = /buildAffectedResourcesFacet<(\w+)>\(\{/g;
    const optedIn: Array<string> = [];
    const mismatches: Array<string> = [];
    let calls: number = 0;

    for (const filePath of listSourceFiles(DASHBOARD_SRC)) {
      const source: string = normalizeSource(fs.readFileSync(filePath, "utf8"));
      let match: RegExpExecArray | null = callPattern.exec(source);

      while (match) {
        calls++;

        const modelName: string = match[1]!;
        const options: string = braceBlockFrom(source, match.index);
        const modelSource: string = fs.readFileSync(
          path.join(MODELS_DIR, `${modelName}.ts`),
          "utf8",
        );
        const modelHasRelation: boolean = modelSource.includes(
          "public serviceLevelObjectives?:",
        );
        const optsIn: boolean = options.includes(
          "includeServiceLevelObjective: true",
        );

        if (optsIn) {
          optedIn.push(modelName);
        }

        if (optsIn !== modelHasRelation) {
          mismatches.push(
            `${path.relative(DASHBOARD_SRC, filePath)}: ${modelName} ${
              modelHasRelation
                ? "has the relation but does not opt in"
                : "opts in without the relation"
            }`,
          );
        }

        match = callPattern.exec(source);
      }
    }

    expect(calls).toBeGreaterThanOrEqual(3);
    expect(optedIn).toEqual(expect.arrayContaining(["Incident", "Alert"]));
    expect(optedIn).not.toContain("ScheduledMaintenance");
    expect(mismatches).toEqual([]);
  });
});

describe("the SLO link is view-only on incidents and alerts", () => {
  /*
   * The worker writes the link; the SLO's tabs, badges and filter all read
   * it. ModelForm submits only the fields it registers, so as long as no
   * incident or alert form registers the relation (and no picker writes it
   * back), saving an edit cannot drop it.
   */
  const INCIDENT_AND_ALERT_UI: Array<Array<string>> = [
    ["Pages", "Incidents"],
    ["Pages", "Alerts"],
    ["Components", "Incident"],
    ["Components", "Alert"],
    ["Components", "AffectedResources"],
  ];

  const files: Array<string> = INCIDENT_AND_ALERT_UI.flatMap(
    (parts: Array<string>): Array<string> => {
      return listSourceFiles(path.join(DASHBOARD_SRC, ...parts));
    },
  );

  test("the scan covers the incident and alert pages", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  test("no incident or alert form registers serviceLevelObjectives as a field", () => {
    const fieldRegistrationPattern: RegExp =
      /field: \{ ?serviceLevelObjectives: true/;

    const offenders: Array<string> = files.filter(
      (filePath: string): boolean => {
        return fieldRegistrationPattern.test(
          normalizeSource(fs.readFileSync(filePath, "utf8")),
        );
      },
    );

    expect(offenders).toEqual([]);
  });

  test("no picker payload is written back into serviceLevelObjectives", () => {
    const payloadWriteBackPattern: RegExp =
      /serviceLevelObjectives: ?payload\./;

    const offenders: Array<string> = files.filter(
      (filePath: string): boolean => {
        return payloadWriteBackPattern.test(
          normalizeSource(fs.readFileSync(filePath, "utf8")),
        );
      },
    );

    expect(offenders).toEqual([]);
  });

  test("the affected resources picker does not offer SLOs", () => {
    expect(
      readSource(
        "Components",
        "AffectedResources",
        "AffectedResourcesPicker.tsx",
      ),
    ).not.toContain("ServiceLevelObjective");
  });
});
