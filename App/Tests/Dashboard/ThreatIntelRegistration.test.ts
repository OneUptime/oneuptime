import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
/*
 * Sibling-relative like the modules under test: the `Common` specifier
 * can resolve a checkout that predates this branch's files.
 */
import ThreatIntelIndicator from "../../../Common/Models/AnalyticsModels/ThreatIntelIndicator";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import AnalyticsTableEngine from "Common/Types/AnalyticsDatabase/AnalyticsTableEngine";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";

/*
 * The threat-intel vertical is wired through five registries that fail
 * SILENTLY when an entry is missing: an analytics model absent from the
 * AnalyticsServices array is never created at boot, a cron file not
 * imported in Workers/Index.ts never runs, an unregistered Postgres
 * migration never applies, and an unmounted BaseAPI router just 404s.
 * These tests read the registries as text (the ChangeEventRow test
 * discipline) so a refactor that drops an entry fails here instead of in
 * production.
 */

function repoPath(relative: string): string {
  return path.join(__dirname, "../../..", relative);
}

function readSquashed(relative: string): string {
  return fs.readFileSync(repoPath(relative), "utf8").replace(/\s+/g, " ");
}

describe("ThreatIntelIndicator model shape", () => {
  const model: ThreatIntelIndicator = new ThreatIntelIndicator();

  test("is a ReplacingMergeTree with a column literally named version", () => {
    /*
     * ClusterConfig.getStorageEngine renders ReplacingMergeTree(version),
     * so the version column's NAME is part of the storage contract.
     */
    expect(model.tableEngine).toBe(AnalyticsTableEngine.ReplacingMergeTree);

    const versionColumn: AnalyticsTableColumn | undefined =
      model.tableColumns.find((column: AnalyticsTableColumn): boolean => {
        return column.key === "version";
      });

    expect(versionColumn).toBeDefined();
    expect(versionColumn?.type).toBe(TableColumnType.UInt64);
    expect(versionColumn?.required).toBe(true);
  });

  test("identity and expiry: sorted by (project, feed, value, stix id), TTL on retentionDate", () => {
    expect(model.sortKeys).toEqual([
      "projectId",
      "feedId",
      "indicatorValue",
      "stixId",
    ]);
    expect(model.ttlExpression).toBe("retentionDate DELETE");
    expect(model.partitionKey).toContain("retentionDate");
  });

  test("carries every column the matcher and enricher read version-aware", () => {
    const columnKeys: Array<string> = model.tableColumns.map(
      (column: AnalyticsTableColumn): string => {
        return column.key;
      },
    );

    for (const requiredKey of [
      "projectId",
      "feedId",
      "feedName",
      "stixId",
      "indicatorType",
      "indicatorValue",
      "indicatorName",
      "confidence",
      "stixLabels",
      "validFrom",
      "validUntil",
      "revoked",
      "version",
      "retentionDate",
    ]) {
      expect(columnKeys).toContain(requiredKey);
    }
  });
});

describe("registry wiring", () => {
  test("both analytics registries carry the model — table creation iterates AnalyticsServices", () => {
    expect(readSquashed("Common/Models/AnalyticsModels/Index.ts")).toContain(
      "ThreatIntelIndicator,",
    );
    /*
     * Boot-time createTables() iterates ONLY this array — a model missing
     * here is silently never created.
     */
    expect(readSquashed("Common/Server/Services/Index.ts")).toContain(
      "ThreatIntelIndicatorService,",
    );
  });

  test("the Postgres model and service are registered", () => {
    expect(readSquashed("Common/Models/DatabaseModels/Index.ts")).toContain(
      "ThreatIntelFeed,",
    );
    expect(readSquashed("Common/Server/Services/Index.ts")).toContain(
      "ThreatIntelFeedService,",
    );
  });

  test("the ThreatIntelFeed migration is registered — unregistered migrations never run", () => {
    const migrations: string = readSquashed(
      "Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.ts",
    );
    expect(migrations).toContain("MigrationName1787923136162");
  });

  test("both cron jobs are imported in Workers/Index.ts — RunCron registers by import side effect", () => {
    const workersIndex: string = readSquashed(
      "App/FeatureSet/Workers/Index.ts",
    );
    expect(workersIndex).toContain(
      'import "./Jobs/ThreatIntel/PollThreatIntelFeeds"',
    );
    expect(workersIndex).toContain(
      'import "./Jobs/ThreatIntel/MatchThreatIntelIndicators"',
    );
  });

  test("both APIs are mounted in BaseAPI", () => {
    /*
     * Whitespace-tolerant: prettier line-breaks the generic arguments, so
     * match the construction rather than one exact formatting of it.
     */
    const baseApi: string = readSquashed("App/FeatureSet/BaseAPI/Index.ts");
    expect(baseApi).toMatch(
      /new BaseAPI<\s*ThreatIntelFeed,\s*ThreatIntelFeedServiceType\s*>\(\s*ThreatIntelFeed,\s*ThreatIntelFeedService,?\s*\)/,
    );
    expect(baseApi).toMatch(
      /new BaseAnalyticsAPI<\s*ThreatIntelIndicator,\s*ThreatIntelIndicatorServiceType\s*>\(\s*ThreatIntelIndicator,\s*ThreatIntelIndicatorService,?\s*\)/,
    );
  });

  test("the docs page exists and is in the docs nav", () => {
    expect(
      fs.existsSync(
        repoPath(
          "App/FeatureSet/Docs/Content/en/telemetry/threat-intelligence.md",
        ),
      ),
    ).toBe(true);
    expect(readSquashed("App/FeatureSet/Docs/Utils/Nav.ts")).toContain(
      "/docs/telemetry/threat-intelligence",
    );
  });

  test("the dashboard route is wired end to end", () => {
    expect(
      readSquashed("App/FeatureSet/Dashboard/src/Utils/PageMap.ts"),
    ).toContain("SECURITY_EVENTS_THREAT_INTEL");
    expect(
      readSquashed("App/FeatureSet/Dashboard/src/Utils/RouteMap.ts"),
    ).toContain('[PageMap.SECURITY_EVENTS_THREAT_INTEL]: "threat-intel"');
    expect(
      readSquashed(
        "App/FeatureSet/Dashboard/src/Routes/SecurityEventsRoutes.tsx",
      ),
    ).toContain("SecurityEventsThreatIntelPage");
    expect(
      readSquashed(
        "App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsNavTabs.tsx",
      ),
    ).toContain('"threat-intel"');
  });

  test("both event-producing paths enrich BEFORE row building", () => {
    /*
     * The shared-builder discipline (SecurityEventRow.ts) exists because a
     * step added to only one producer silently skips the other. Enrichment
     * is such a step: HTTP ingest and the SecOps poller must both stamp
     * threat.* on their normalized events before buildSecurityEventDbRow
     * derives attributeKeys.
     */
    expect(
      readSquashed(
        "App/FeatureSet/Telemetry/Services/SecurityEventsIngestService.ts",
      ),
    ).toContain("ThreatIntelEnricher.enrichNormalizedEvents");
    expect(
      readSquashed(
        "Common/Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsPoller.ts",
      ),
    ).toContain("ThreatIntelEnricher.enrichNormalizedEvents");
  });
});
