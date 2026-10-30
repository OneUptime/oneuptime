import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { DATA_SECURITY_API_ROUTES } from "Common/Types/DataSecurity/DataSecurityApiTypes";

/*
 * Data Security is wired through registries that fail SILENTLY when an
 * entry is missing: a model or service absent from its index is never
 * created, a migration not listed never applies, an unmounted router just
 * 404s, and a job file Workers/Index.ts does not import never runs. These
 * read the registries as text so a refactor that drops an entry fails here
 * instead of in production.
 */

function repoPath(relative: string): string {
  return path.join(__dirname, "../../..", relative);
}

function readSquashed(relative: string): string {
  return fs.readFileSync(repoPath(relative), "utf8").replace(/\s+/g, " ");
}

// Every Postgres model Data Security keeps, each with its own service.
const DATA_SECURITY_MODELS: ReadonlyArray<string> = [
  "DataStore",
  "DataStoreFinding",
  "DataStoreAccess",
  "DataStoreFeed",
  "DataStoreOwnerUser",
  "DataStoreOwnerTeam",
  "DataStoreOwnerRule",
  "DataStoreLabelRule",
  "DataSecurityFlow",
  "DataSecurityIssue",
  "DataSecurityIssueFeed",
  "DataSecurityScan",
  "DataSecurityCustomDataType",
  "DataSecurityCheckSetting",
  "DataSecurityResidencyRule",
  "DataSecuritySetting",
];

describe("Data Security registry wiring", () => {
  test("every model and its service are registered", () => {
    const models: string = readSquashed(
      "Common/Models/DatabaseModels/Index.ts",
    );
    const services: string = readSquashed("Common/Server/Services/Index.ts");

    for (const model of DATA_SECURITY_MODELS) {
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

  test("its migration is registered, last, so it runs after every table it references", () => {
    const migrations: string = readSquashed(
      "Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.ts",
    );

    expect(migrations).toContain(
      'import { AddDataSecurity1808500000000 } from "./1808500000000-AddDataSecurity";',
    );
    expect(migrations).toContain("AddDataSecurity1808500000000,");

    const migration: string = readSquashed(
      "Common/Server/Infrastructure/Postgres/SchemaMigrations/1808500000000-AddDataSecurity.ts",
    );

    for (const model of DATA_SECURITY_MODELS) {
      expect(migration).toContain(`CREATE TABLE "${model}"`);
    }
  });

  test("the stores' own API (with its actions) and every other model's CRUD API are mounted", () => {
    const baseApi: string = readSquashed("App/FeatureSet/BaseAPI/Index.ts");

    // DataStore's CRUD routes come with Data Security's own: the Overview, Scan now, Scrub It...
    expect(baseApi).toContain("new DataSecurityAPI().getRouter()");

    for (const model of DATA_SECURITY_MODELS) {
      if (model === "DataStore") {
        continue;
      }

      expect(baseApi).toMatch(
        new RegExp(
          `new BaseAPI<\\s*${model},\\s*${model}ServiceType\\s*>\\(\\s*${model},\\s*${model}Service,?\\s*\\)`,
        ),
      );
    }
  });

  test("Data Security's API extends the DataStore CRUD API, so the Dashboard's model calls and its own routes share one router", () => {
    const api: string = readSquashed("Common/Server/API/DataSecurityAPI.ts");

    expect(api).toMatch(
      /class DataSecurityAPI extends BaseAPI<\s*DataStore,\s*DataStoreServiceType\s*>/,
    );
    expect(api).toContain("super(DataStore, DataStoreService)");
  });

  test("every route the Dashboard calls is one the API serves", () => {
    const api: string = readSquashed("Common/Server/API/DataSecurityAPI.ts");
    const client: string = readSquashed(
      "App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityApi.ts",
    );

    for (const key of [
      "overview",
      "compliance",
      "recordOfProcessing",
      "scanNow",
      "checkNow",
      "scrubFinding",
      "explainIssue",
      "fixIssueWithAi",
    ]) {
      expect(api).toContain(`DATA_SECURITY_API_ROUTES.${key}`);
      expect(client).toContain(`DATA_SECURITY_API_ROUTES.${key}`);
    }

    // Each route is a path of its own, under the API's prefix.
    const paths: Array<string> = [
      DATA_SECURITY_API_ROUTES.overview,
      DATA_SECURITY_API_ROUTES.compliance,
      DATA_SECURITY_API_ROUTES.recordOfProcessing,
      DATA_SECURITY_API_ROUTES.scanNow(":id"),
      DATA_SECURITY_API_ROUTES.checkNow(":id"),
      DATA_SECURITY_API_ROUTES.scrubFinding(":id"),
      DATA_SECURITY_API_ROUTES.explainIssue(":id"),
      DATA_SECURITY_API_ROUTES.fixIssueWithAi(":id"),
    ];

    expect(new Set(paths).size).toBe(paths.length);

    for (const route of paths) {
      expect(route.startsWith("/")).toBe(true);
    }
  });

  test("the Workers import Data Security's jobs: a job file nothing imports never runs", () => {
    expect(readSquashed("App/FeatureSet/Workers/Index.ts")).toContain(
      'import "./Jobs/DataSecurity/DataSecurityJobs"',
    );
  });

  test("a Critical issue reaches Security Operations as a Data Store entity from the Data Security source", () => {
    const entity: string = readSquashed(
      "Common/Types/SecurityCase/SecurityEntity.ts",
    );
    const source: string = readSquashed(
      "Common/Types/SecurityCase/SecurityDetectionSource.ts",
    );
    const integrations: string = readSquashed(
      "Common/Server/Utils/DataSecurity/DataSecurityIntegrations.ts",
    );

    expect(entity).toContain('DataStore = "Data Store"');
    expect(source).toContain('DataSecurity = "Data Security"');
    expect(integrations).toContain("SecurityDetectionSource.DataSecurity");
    expect(integrations).toContain("SecurityEntityType.DataStore");
  });
});
