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
      'import { AddDataAssetUsage1808991300000 } from "./1808991300000-AddDataAssetUsage";',
    );
    expect(migrations).toContain("AddDataAssetUsage1808991300000,");
    expect(
      readSquashed(
        "Common/Server/Infrastructure/Postgres/SchemaMigrations/1808991300000-AddDataAssetUsage.ts",
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

  test("data checks - model, service, migration, CRUD API and their own routes - are wired", () => {
    expect(readSquashed("Common/Models/DatabaseModels/Index.ts")).toContain(
      "DataCheck,",
    );
    expect(readSquashed("Common/Server/Services/Index.ts")).toContain(
      "DataCheckService,",
    );

    const migrations: string = readSquashed(
      "Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.ts",
    );

    expect(migrations).toContain(
      'import { AddDataChecks1808991400000 } from "./1808991400000-AddDataChecks";',
    );
    expect(migrations).toContain("AddDataChecks1808991400000,");
    expect(
      readSquashed(
        "Common/Server/Infrastructure/Postgres/SchemaMigrations/1808991400000-AddDataChecks.ts",
      ),
    ).toContain('CREATE TABLE "DataCheck"');

    expect(readSquashed("App/FeatureSet/BaseAPI/Index.ts")).toMatch(
      /new BaseAPI<\s*DataCheck,\s*DataCheckServiceType\s*>\(\s*DataCheck,\s*DataCheckService,?\s*\)/,
    );

    const api: string = readSquashed(
      "Common/Server/API/DataObservabilityAPI.ts",
    );

    expect(api).toContain('DATA_OBSERVABILITY_API_ROUTES.checkAlert(":id")');
    expect(api).toContain('DATA_OBSERVABILITY_API_ROUTES.checkRunNow(":id")');

    // Checks run with their store's collection, on a worker or a probe.
    expect(
      readSquashed(
        "Common/Server/Utils/DataObservability/DataObservabilityRunner.ts",
      ),
    ).toContain("checks: plan.planned,");
    expect(
      readSquashed(
        "App/FeatureSet/Telemetry/API/ProbeIngest/DataObservability.ts",
      ),
    ).toContain("buildProbeCollectWork(store, plan.planned)");
  });

  test("pipelines from OpenLineage - models, services, migration, CRUD APIs and the ingest route - are wired", () => {
    const models: string = readSquashed(
      "Common/Models/DatabaseModels/Index.ts",
    );
    const services: string = readSquashed("Common/Server/Services/Index.ts");
    const baseApi: string = readSquashed("App/FeatureSet/BaseAPI/Index.ts");

    for (const model of [
      "DataPipeline",
      "DataPipelineRun",
      "DataAssetLineage",
    ]) {
      expect(models).toContain(`${model},`);
      expect(services).toContain(`${model}Service,`);
      expect(baseApi).toMatch(
        new RegExp(
          `new BaseAPI<\\s*${model},\\s*${model}ServiceType\\s*>\\(\\s*${model},\\s*${model}Service,?\\s*\\)`,
        ),
      );
    }

    const migrations: string = readSquashed(
      "Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.ts",
    );

    expect(migrations).toContain(
      'import { AddDataPipelines1808991500000 } from "./1808991500000-AddDataPipelines";',
    );
    expect(migrations).toContain("AddDataPipelines1808991500000,");

    const migration: string = readSquashed(
      "Common/Server/Infrastructure/Postgres/SchemaMigrations/1808991500000-AddDataPipelines.ts",
    );

    for (const table of [
      "DataPipeline",
      "DataPipelineRun",
      "DataAssetLineage",
    ]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }

    const telemetry: string = readSquashed("App/FeatureSet/Telemetry/Index.ts");

    expect(telemetry).toContain(
      'import OpenLineageIngestAPI from "./API/OpenLineageIngest"',
    );
    expect(telemetry).toContain(
      "app.use(TELEMETRY_PREFIXES, OpenLineageIngestAPI)",
    );
  });

  test("a pipeline's schedule - its migration and five-minute check - is wired", () => {
    const migrations: string = readSquashed(
      "Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.ts",
    );

    expect(migrations).toContain(
      'import { AddDataPipelineSchedule1808991600000 } from "./1808991600000-AddDataPipelineSchedule";',
    );
    expect(
      migrations.indexOf("AddDataPipelineSchedule1808991600000,"),
    ).toBeGreaterThan(migrations.indexOf("AddDataPipelines1808991500000,"));

    const migration: string = readSquashed(
      "Common/Server/Infrastructure/Postgres/SchemaMigrations/1808991600000-AddDataPipelineSchedule.ts",
    );

    expect(migration).toContain(
      'ALTER TABLE "DataPipeline" ADD "typicalRunDurationInSeconds" integer',
    );
    expect(migration).toContain(
      'ALTER TABLE "DataPipeline" ADD "expectedRunIntervalInSeconds" integer',
    );
    expect(migration).toContain(
      'ALTER TABLE "DataPipelineRun" ADD "scheduledAt" TIMESTAMP WITH TIME ZONE',
    );

    const jobs: string = readSquashed(
      "App/FeatureSet/Workers/Jobs/DataObservability/DataObservabilityJobs.ts",
    );

    expect(jobs).toContain('"DataObservability:CheckPipelineSchedules"');
    expect(jobs).toContain(
      "await DataPipelineScheduleCheck.checkAll(OneUptimeDate.getCurrentDate());",
    );
  });

  test("alerts on failed Power BI refreshes - migration, five-minute check, route and page - are wired", () => {
    const migrations: string = readSquashed(
      "Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.ts",
    );

    expect(migrations).toContain(
      'import { AddDataBiConnectionRefreshAlerts1809110200000 } from "./1809110200000-AddDataBiConnectionRefreshAlerts";',
    );
    expect(
      migrations.indexOf("AddDataBiConnectionRefreshAlerts1809110200000,"),
    ).toBeGreaterThan(
      migrations.indexOf("AddDataDashboardUsageAndRefreshes1809100612000,"),
    );

    const migration: string = readSquashed(
      "Common/Server/Infrastructure/Postgres/SchemaMigrations/1809110200000-AddDataBiConnectionRefreshAlerts.ts",
    );

    expect(migration).toContain(
      'ALTER TABLE "DataBiConnection" ADD "alertOnFailedRefreshes" boolean DEFAULT false',
    );
    expect(migration).toContain(
      'ALTER TABLE "DataBiConnection" ADD "refreshMonitorId" uuid',
    );
    expect(migration).toContain(
      'ALTER TABLE "DataBiConnection" ADD "failedRefreshes" jsonb',
    );

    const jobs: string = readSquashed(
      "App/FeatureSet/Workers/Jobs/DataObservability/DataObservabilityJobs.ts",
    );

    expect(jobs).toContain('"DataObservability:CheckBiRefreshes"');
    expect(jobs).toContain(
      "await DataBiRefreshCheck.checkAll(OneUptimeDate.getCurrentDate());",
    );

    expect(DATA_OBSERVABILITY_API_ROUTES.biRefreshAlert("abc")).toBe(
      "/data-observability/bi-connections/abc/refresh-alert",
    );

    const api: string = readSquashed(
      "Common/Server/API/DataObservabilityAPI.ts",
    );

    expect(api).toContain(
      'DATA_OBSERVABILITY_API_ROUTES.biRefreshAlert(":id")',
    );
    expect(api).toContain("await DataBiRefreshAlerts.sync({");

    // Saving a BI tool - Add or Edit - keeps its monitor as saved.
    expect(
      readSquashed(
        "App/FeatureSet/Dashboard/src/Pages/DataObservability/BiDashboards.tsx",
      ),
    ).toContain(
      "await keepRefreshAlert(connection); await readTool(connection);",
    );
  });

  test("dbt artifacts - migration, ingest route and CLI command - are wired", () => {
    const migrations: string = readSquashed(
      "Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.ts",
    );

    expect(migrations).toContain(
      'import { AddDbtArtifacts1808991700000 } from "./1808991700000-AddDbtArtifacts";',
    );
    expect(migrations.indexOf("AddDbtArtifacts1808991700000,")).toBeGreaterThan(
      migrations.indexOf("AddDataPipelineSchedule1808991600000,"),
    );

    const migration: string = readSquashed(
      "Common/Server/Infrastructure/Postgres/SchemaMigrations/1808991700000-AddDbtArtifacts.ts",
    );

    expect(migration).toContain('ALTER TABLE "DataAsset" ADD "dbtNode" jsonb');
    expect(migration).toContain(
      'ALTER TABLE "DataCheck" ADD "externalId" character varying(500)',
    );

    const telemetry: string = readSquashed("App/FeatureSet/Telemetry/Index.ts");

    expect(telemetry).toContain(
      'import DbtArtifactsIngestAPI from "./API/DbtArtifactsIngest"',
    );
    expect(telemetry).toContain(
      "app.use(TELEMETRY_PREFIXES, DbtArtifactsIngestAPI)",
    );

    const cli: string = readSquashed("CLI/Program.ts");

    expect(cli).toContain(
      'import { registerDbtCommands } from "./Commands/DbtCommands";',
    );
    expect(cli).toContain("registerDbtCommands(program);");
  });

  test("data alerts - model, service, migration and CRUD API - are wired, and the monitor records them", () => {
    expect(readSquashed("Common/Models/DatabaseModels/Index.ts")).toContain(
      "DataAlert,",
    );
    expect(readSquashed("Common/Server/Services/Index.ts")).toContain(
      "DataAlertService,",
    );
    expect(readSquashed("App/FeatureSet/BaseAPI/Index.ts")).toMatch(
      /new BaseAPI<\s*DataAlert,\s*DataAlertServiceType\s*>\(\s*DataAlert,\s*DataAlertService,?\s*\)/,
    );

    const migrations: string = readSquashed(
      "Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.ts",
    );

    expect(migrations).toContain(
      'import { AddDataAlerts1808991800000 } from "./1808991800000-AddDataAlerts";',
    );
    expect(migrations.indexOf("AddDataAlerts1808991800000,")).toBeGreaterThan(
      migrations.indexOf("AddDbtArtifacts1808991700000,"),
    );
    expect(
      readSquashed(
        "Common/Server/Infrastructure/Postgres/SchemaMigrations/1808991800000-AddDataAlerts.ts",
      ),
    ).toContain('CREATE TABLE "DataAlert"');

    // The cause is looked for before the alert is created, and recorded after.
    const monitorAlert: string = readSquashed(
      "Common/Server/Utils/Monitor/MonitorAlert.ts",
    );

    /*
     * The alert is created inside its page timing (OnCallPageTiming), from
     * the create its owners' Created notification waits on
     * (CreatedNotificationHold): wherever it is, the cause is read around it.
     */
    const created: number = monitorAlert.indexOf(
      "createdAlert = await OnCallPageTiming.runAsMonitorTriggered(",
    );

    expect(created).toBeGreaterThan(-1);
    expect(
      monitorAlert.indexOf("return AlertService.create(createBy);"),
    ).toBeGreaterThan(created);
    expect(
      monitorAlert.indexOf("await DataAlertCause.findCause({"),
    ).toBeGreaterThan(-1);
    expect(
      monitorAlert.indexOf("await DataAlertCause.findCause({"),
    ).toBeLessThan(created);
    expect(
      monitorAlert.indexOf("await DataAlertCause.record({"),
    ).toBeGreaterThan(created);
    expect(
      readSquashed("App/FeatureSet/Dashboard/src/Pages/Alerts/View/Index.tsx"),
    ).toContain("<DataAlertLineage alertId={modelId} />");
  });

  test("a table's reads - its migration - are wired", () => {
    const migrations: string = readSquashed(
      "Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.ts",
    );

    expect(migrations).toContain(
      'import { AddDataAssetReads1808991900000 } from "./1808991900000-AddDataAssetReads";',
    );
    expect(
      migrations.indexOf("AddDataAssetReads1808991900000,"),
    ).toBeGreaterThan(migrations.indexOf("AddDataAlerts1808991800000,"));

    const migration: string = readSquashed(
      "Common/Server/Infrastructure/Postgres/SchemaMigrations/1808991900000-AddDataAssetReads.ts",
    );

    expect(migration).toContain(
      'ALTER TABLE "DataAsset" ADD "lastReadAt" TIMESTAMP WITH TIME ZONE',
    );
    expect(migration).toContain(
      'ALTER TABLE "DataAsset" ADD "unreadSince" TIMESTAMP WITH TIME ZONE',
    );
  });

  test("data products - model, service, migration, CRUD API, their check job and pages - are wired", () => {
    expect(readSquashed("Common/Models/DatabaseModels/Index.ts")).toContain(
      "DataProduct,",
    );
    expect(readSquashed("Common/Server/Services/Index.ts")).toContain(
      "DataProductService,",
    );
    expect(readSquashed("App/FeatureSet/BaseAPI/Index.ts")).toMatch(
      /new BaseAPI<\s*DataProduct,\s*DataProductServiceType\s*>\(\s*DataProduct,\s*DataProductService,?\s*\)/,
    );

    const migrations: string = readSquashed(
      "Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.ts",
    );

    expect(migrations).toContain(
      'import { AddDataProducts1808992100000 } from "./1808992100000-AddDataProducts";',
    );
    expect(migrations.indexOf("AddDataProducts1808992100000,")).toBeGreaterThan(
      migrations.indexOf("AddDataAssetLineageSource1808992000000,"),
    );

    const migration: string = readSquashed(
      "Common/Server/Infrastructure/Postgres/SchemaMigrations/1808992100000-AddDataProducts.ts",
    );

    expect(migration).toContain('CREATE TABLE "DataProduct"');
    expect(migration).toContain('CREATE TABLE "DataProductDataAsset"');

    expect(
      readSquashed(
        "App/FeatureSet/Workers/Jobs/DataObservability/DataObservabilityJobs.ts",
      ),
    ).toContain("DataProductCheck.checkAll(OneUptimeDate.getCurrentDate())");

    const routes: string = readSquashed(
      "App/FeatureSet/Dashboard/src/Routes/DataObservabilityRoutes.tsx",
    );

    for (const page of [
      "DataObservabilityDataProductsPage",
      "DataProductViewLayout",
      "DataProductOverviewPage",
      "DataProductSettingsPage",
      "DataProductDeletePage",
    ]) {
      expect(routes).toContain(`<${page}`);
    }
  });

  test("reconciliations - model, service, migration, CRUD API, their sweep, comparing on ingest, and their page - are wired", () => {
    expect(readSquashed("Common/Models/DatabaseModels/Index.ts")).toContain(
      "DataReconciliation,",
    );
    expect(readSquashed("Common/Server/Services/Index.ts")).toContain(
      "DataReconciliationService,",
    );
    expect(readSquashed("App/FeatureSet/BaseAPI/Index.ts")).toMatch(
      /new BaseAPI<\s*DataReconciliation,\s*DataReconciliationServiceType\s*>\(\s*DataReconciliation,\s*DataReconciliationService,?\s*\)/,
    );

    const migrations: string = readSquashed(
      "Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.ts",
    );

    expect(migrations).toContain(
      'import { AddDataReconciliations1808992200000 } from "./1808992200000-AddDataReconciliations";',
    );
    expect(
      migrations.indexOf("AddDataReconciliations1808992200000,"),
    ).toBeGreaterThan(migrations.indexOf("AddDataProducts1808992100000,"));

    const migration: string = readSquashed(
      "Common/Server/Infrastructure/Postgres/SchemaMigrations/1808992200000-AddDataReconciliations.ts",
    );

    expect(migration).toContain('CREATE TABLE "DataReconciliation"');
    expect(migration).toContain(
      'ALTER TABLE "DataCheck" ADD "dataReconciliationId" uuid',
    );

    expect(
      readSquashed(
        "App/FeatureSet/Workers/Jobs/DataObservability/DataObservabilityJobs.ts",
      ),
    ).toContain("DataReconciliationCompare.compareAll(");
    expect(
      readSquashed("Common/Server/Utils/DataObservability/DataCheckIngest.ts"),
    ).toContain("DataReconciliationCompare.compareForReconciliations(");
    expect(
      readSquashed(
        "App/FeatureSet/Dashboard/src/Routes/DataObservabilityRoutes.tsx",
      ),
    ).toContain("<DataObservabilityReconciliationsPage");
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
