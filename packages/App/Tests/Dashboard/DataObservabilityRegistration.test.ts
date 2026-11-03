import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { DATA_OBSERVABILITY_API_ROUTES } from "Common/Types/DataObservability/DataObservabilityApiTypes";

/*
 * Data Observability is wired through registries that fail SILENTLY when an
 * entry is missing: a model or service absent from its index is never
 * created, a migration not listed never applies, an unmounted router just
 * 404s, a job file nothing imports never runs, and a probe that does not
 * declare its capability is handed no work. These read the registries as
 * text so a refactor that drops an entry fails here instead of in
 * production.
 */

function repoPath(relative: string): string {
  return path.join(__dirname, "../../..", relative);
}

function readSquashed(relative: string): string {
  return fs.readFileSync(repoPath(relative), "utf8").replace(/\s+/g, " ");
}

const DATA_OBSERVABILITY_MODELS: ReadonlyArray<string> = [
  "DataAsset",
  "DataAssetFeed",
];

describe("Data Observability registry wiring", () => {
  test("every model and its service are registered", () => {
    const models: string = readSquashed(
      "Common/Models/DatabaseModels/Index.ts",
    );
    const services: string = readSquashed("Common/Server/Services/Index.ts");

    for (const model of DATA_OBSERVABILITY_MODELS) {
      expect(models).toContain(`${model},`);
      expect(services).toContain(`${model}Service,`);
      expect(
        fs.existsSync(repoPath(`Common/Models/DatabaseModels/${model}.ts`)),
      ).toBe(true);
      expect(
        fs.existsSync(repoPath(`Common/Server/Services/${model}Service.ts`)),
      ).toBe(true);
    }
  });

  test("its migrations are registered, the online index after the tables", () => {
    const migrations: string = readSquashed(
      "Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.ts",
    );

    expect(migrations).toContain(
      'import { AddDataObservability1808910000000 } from "./1808910000000-AddDataObservability";',
    );
    expect(migrations).toContain(
      'import { AddDataObservabilityStoreIndex1808910100000 } from "./1808910100000-AddDataObservabilityStoreIndex";',
    );
    expect(
      migrations.indexOf("AddDataObservability1808910000000,"),
    ).toBeLessThan(
      migrations.indexOf("AddDataObservabilityStoreIndex1808910100000,"),
    );

    const migration: string = readSquashed(
      "Common/Server/Infrastructure/Postgres/SchemaMigrations/1808910000000-AddDataObservability.ts",
    );

    for (const model of DATA_OBSERVABILITY_MODELS) {
      expect(migration).toContain(`CREATE TABLE "${model}"`);
    }

    // The index on an existing, busy table is built online, never in the table migration.
    expect(migration).not.toContain('ON "DataStore"');
    expect(
      readSquashed(
        "Common/Server/Infrastructure/Postgres/SchemaMigrations/1808910100000-AddDataObservabilityStoreIndex.ts",
      ),
    ).toContain("OnlineDdl.createIndex");
  });

  test("the assets' own API (with its routes) and the feed's CRUD API are mounted", () => {
    const baseApi: string = readSquashed("App/FeatureSet/BaseAPI/Index.ts");

    expect(baseApi).toContain("new DataObservabilityAPI().getRouter()");
    expect(baseApi).toMatch(
      /new BaseAPI<\s*DataAssetFeed,\s*DataAssetFeedServiceType\s*>\(\s*DataAssetFeed,\s*DataAssetFeedService,?\s*\)/,
    );

    const api: string = readSquashed(
      "Common/Server/API/DataObservabilityAPI.ts",
    );

    expect(api).toMatch(
      /class DataObservabilityAPI extends BaseAPI<\s*DataAsset,\s*DataAssetServiceType\s*>/,
    );
    expect(api).toContain("super(DataAsset, DataAssetService)");

    for (const key of ["overview", "stores", "connectStore", "collectNow"]) {
      expect(api).toContain(`DATA_OBSERVABILITY_API_ROUTES.${key}`);
    }

    const paths: Array<string> = [
      DATA_OBSERVABILITY_API_ROUTES.overview,
      DATA_OBSERVABILITY_API_ROUTES.stores,
      DATA_OBSERVABILITY_API_ROUTES.connectStore,
      DATA_OBSERVABILITY_API_ROUTES.collectNow(":id"),
    ];

    expect(new Set(paths).size).toBe(paths.length);
  });

  test("table usage - its model, service, migration, CRUD API and discovery job - is wired", () => {
    expect(readSquashed("Common/Models/DatabaseModels/Index.ts")).toContain(
      "DataAssetUsage,",
    );
    expect(readSquashed("Common/Server/Services/Index.ts")).toContain(
      "DataAssetUsageService,",
    );

    const migrations: string = readSquashed(
      "Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.ts",
    );

    expect(migrations).toContain(
      'import { AddDataAssetUsage1808990000000 } from "./1808990000000-AddDataAssetUsage";',
    );
    expect(migrations).toContain("AddDataAssetUsage1808990000000,");
    expect(
      readSquashed(
        "Common/Server/Infrastructure/Postgres/SchemaMigrations/1808990000000-AddDataAssetUsage.ts",
      ),
    ).toContain('CREATE TABLE "DataAssetUsage"');

    expect(readSquashed("App/FeatureSet/BaseAPI/Index.ts")).toMatch(
      /new BaseAPI<\s*DataAssetUsage,\s*DataAssetUsageServiceType\s*>\(\s*DataAssetUsage,\s*DataAssetUsageService,?\s*\)/,
    );

    const jobs: string = readSquashed(
      "App/FeatureSet/Workers/Jobs/DataObservability/DataObservabilityJobs.ts",
    );

    expect(jobs).toContain(
      "for (const projectId of await TableUsageDiscovery.getProjectIds())",
    );
    expect(jobs).toContain(
      "JobDictionary.setJobFunction( DATA_OBSERVABILITY_DISCOVER_TABLE_USAGE_JOB,",
    );
    expect(jobs).toContain("await TableUsageDiscovery.discoverProject({");
  });

  test("the Workers import its jobs, and the probe ingest mounts its routes", () => {
    expect(readSquashed("App/FeatureSet/Workers/Index.ts")).toContain(
      'import "./Jobs/DataObservability/DataObservabilityJobs"',
    );

    const telemetry: string = readSquashed("App/FeatureSet/Telemetry/Index.ts");

    expect(telemetry).toContain(
      'import ProbeIngestDataObservabilityAPI from "./API/ProbeIngest/DataObservability"',
    );
    expect(telemetry).toContain(
      "app.use(PROBE_INGEST_PREFIXES, ProbeIngestDataObservabilityAPI)",
    );
  });

  test("the probe starts its collector and declares the capability", () => {
    const probe: string = readSquashed("Probe/Index.ts");

    expect(probe).toContain(
      'import CollectDataObservabilityTableHealth from "./Jobs/DataObservability/CollectTableHealth"',
    );
    expect(probe).toContain("CollectDataObservabilityTableHealth();");
    expect(readSquashed("Probe/Utils/ProbeAPIRequest.ts")).toContain(
      "ProbeCapability.DataObservabilityCollect,",
    );
  });
});
