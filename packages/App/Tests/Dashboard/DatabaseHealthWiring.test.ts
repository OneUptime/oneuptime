import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  getDatabaseHealthPill,
  getDatabaseStatusCell,
} from "../../FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseHealthPresentation";
import { getDatabaseFleetAttentionItems } from "../../FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseFleetAttention";
import { ResourceOverviewHealth } from "../../FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceOverviewHealth";
import { assessDatabase } from "Common/Types/DatabaseServer/DatabaseHealth";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import Route from "Common/Types/API/Route";

/*
 * Where a database's health is drawn, pinned at the source level (the App
 * suite has no renderer; Common/Tests/App/Dashboard/DatabaseHealthPages and
 * DatabaseFleetAttentionCard render them). The invariants:
 *
 *   - the Databases list's Status column, its Needs attention card and a
 *     database's hero and Needs attention all read DatabaseHealth's rules,
 *     never a rule of their own;
 *   - the pages read the readings columns the rules judge;
 *   - the rules and the pages' helpers stay React-free, so this suite - and
 *     the ingest, and the API - can load them (they are loaded below, with
 *     no React installed).
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const COMMON: string = path.join(__dirname, "..", "..", "..", "Common");

const WHITESPACE: RegExp = /\s+/g;
const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;
const REACT_IMPORT: RegExp = /from "react"/;
const TSX_IMPORT: RegExp = /from "[^"]*\.tsx"/;

function readSource(relativePath: string): string {
  return fs.readFileSync(
    path.join(DASHBOARD_SRC, ...relativePath.split("/")),
    "utf8",
  );
}

function readCode(relativePath: string): string {
  return readSource(relativePath)
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, "$1")
    .replace(WHITESPACE, " ");
}

function between(source: string, from: string, to: string): string {
  const start: number = source.indexOf(from);
  if (start < 0) {
    throw new Error(`Expected the source to contain "${from}".`);
  }
  const end: number = source.indexOf(to, start + from.length);
  return end >= 0 ? source.slice(start, end) : source.slice(start);
}

describe("the Databases list", () => {
  const code: string = readCode("Pages/Database/Databases.tsx");
  const columns: string = between(code, "columns={[", "onViewPage={");

  test("Status comes right after the name, judged by the rules for every row", () => {
    expect(columns.indexOf('title: "Name"')).toBeLessThan(
      columns.indexOf('title: "Status"'),
    );
    expect(columns.indexOf('title: "Status"')).toBeLessThan(
      columns.indexOf('title: "Engine"'),
    );
    const status: string = between(columns, 'title: "Status",', "title:");
    expect(status).toContain("<ResourceStatusCell");
    expect(status).toContain("getDatabaseStatusCell({");
    expect(status).toContain("assessDatabase(item, { now: now })");
    expect(status).toContain("headerTooltip: DATABASE_STATUS_COLUMN_DESCRIPTION");
    expect(status).toContain("disableSort: true");
    // The CSV says the same word.
    expect(status).toContain("getExportValue:");
  });

  test("it reads the columns the rules judge", () => {
    const select: string = between(code, "selectMoreFields={{", "}}");
    for (const field of [
      "dbSystem: true",
      "collectorLastSeenAt: true",
      "engineReadings: true",
      "engineReadingsAt: true",
    ]) {
      expect(select).toContain(field);
    }
  });

  test("Needs attention sits above the list, once the project has a database", () => {
    const card: string = between(
      code,
      "<DatabaseServerSummaryStrip",
      "<ModelTable<DatabaseServer>",
    );
    expect(card).toContain("(firstRecordWatch.count ?? 0) > 0 ?");
    expect(card).toContain("<DatabaseFleetAttentionCard");
  });

  test("filter options are drawn in the reader's language", () => {
    expect(code).toContain(
      "translateDatabaseOptions(DISCOVERY_SOURCE_OPTIONS, translator)",
    );
    expect(code).toContain("options: discoverySourceOptions");
    expect(code).toContain('label: "Discovered From"');
  });
});

describe("a database's Overview", () => {
  const code: string = readCode("Pages/Database/View/Overview.tsx");

  test("reads the readings and judges them by the rules", () => {
    expect(code).toContain("engineReadings: true");
    expect(code).toContain("engineReadingsAt: true");
    expect(code).toContain("assessDatabase(r, {");
  });

  test("its hero has the health pill, and Needs attention comes before any number", () => {
    expect(code).toContain("health={getDatabaseHealthPill(assessment)}");
    const attention: string = between(code, "needsAttention={", "lastSeenAt=");
    expect(attention).toContain('testId="database-needs-attention"');
    expect(attention).toContain("getDatabaseOwnAttentionItems({");
    expect(attention).toContain("showKind={false}");
  });

  test("Database alerts says which of its engine's alerts watch it", () => {
    const alerts: string = between(
      code,
      "<ResourcePartAlertsCard",
      "getMonitorRoute",
    );
    expect(alerts).toContain(
      "resourceType={MonitorRecommendationResourceType.DatabaseServer}",
    );
    expect(alerts).toContain("templateIds={alertTemplateIds}");
    expect(alerts).toContain("resourceIdentifier={modelId.toString()}");
    expect(alerts).toContain(
      "databaseEngineMetricsReported: Boolean(r.collectorLastSeenAt)",
    );
  });

  test("the shared hero draws the pill only when a page hands it one", () => {
    const hero: string = readCode(
      "Components/TelemetryResource/ResourceOverview.tsx",
    );
    expect(hero).toContain("{props.health ? (");
    expect(hero).toContain('data-testid="resource-overview-health"');
    expect(hero).toContain(
      "{props.needsAttention ? props.needsAttention : <></>}",
    );
    // Under the hero and its connection guide, before the tiles.
    expect(hero.indexOf("{props.needsAttention ?")).toBeGreaterThan(
      hero.indexOf("{props.connectionGuide ?"),
    );
    expect(hero.indexOf("{props.needsAttention ?")).toBeLessThan(
      hero.indexOf('data-testid="resource-overview-tiles"'),
    );
  });
});

describe("the rules and the pages' helpers stay React-free", () => {
  test.each([
    "Pages/Database/Utils/DatabaseHealthPresentation.ts",
    "Pages/Database/Utils/DatabaseFleetAttention.ts",
    "Components/TelemetryResource/ResourceOverviewHealth.ts",
  ])("%s", (relativePath: string) => {
    const source: string = readSource(relativePath);
    expect(REACT_IMPORT.test(source)).toBe(false);
    expect(TSX_IMPORT.test(source)).toBe(false);
  });

  test.each([
    "Types/DatabaseServer/DatabaseHealth.ts",
    "Types/DatabaseServer/DatabaseEngineReadings.ts",
    "Server/Utils/Telemetry/DatabaseEngineReadingsScan.ts",
  ])("Common/%s", (relativePath: string) => {
    const source: string = fs.readFileSync(
      path.join(COMMON, ...relativePath.split("/")),
      "utf8",
    );
    expect(REACT_IMPORT.test(source)).toBe(false);
    expect(source).not.toContain("UI/Utils/TranslateTemplate");
  });

  test("they load and answer here, with no React installed", () => {
    const row: DatabaseServer = new DatabaseServer();
    row.dbSystem = "postgresql";
    row.otelCollectorStatus = "connected";
    row.collectorLastSeenAt = new Date();
    row.engineReadings = {
      instances: {
        "-": {
          at: new Date().toISOString(),
          values: {
            "Sum|postgresql.backends|": 99,
            "Sum|postgresql.connection.max|": 100,
          },
        },
      },
    };
    const pill: ResourceOverviewHealth | undefined = getDatabaseHealthPill(
      assessDatabase(row),
    );
    expect(pill?.label).toBe("Unhealthy");
    expect(pill?.tone).toBe("danger");
    expect(
      getDatabaseStatusCell({
        assessment: assessDatabase(row),
        language: "en",
        now: new Date(),
      }).statusReasons[0]?.values,
    ).toEqual({ percent: "99%" });
    row._id = "11111111-1111-4111-8111-111111111111";
    row.name = "orders-db";
    expect(
      getDatabaseFleetAttentionItems({
        databases: [row],
        now: new Date(),
        getDatabaseRoute: (id: string): Route => {
          return new Route(`/databases/${id}`);
        },
      }).map((item: { name: string; kind: string }): string => {
        return `${item.name} (${item.kind})`;
      }),
    ).toEqual(["orders-db (PostgreSQL)"]);
  });
});
