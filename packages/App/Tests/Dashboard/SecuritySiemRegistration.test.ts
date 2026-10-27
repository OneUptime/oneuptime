import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import SecurityEventDestinationRegistry from "Common/Server/Utils/SecurityEvent/Destinations/SecurityEventDestinationRegistry";
import {
  SecurityEventDestinationCatalog,
  SecurityEventDestinationDefinition,
} from "Common/Types/SecurityEvent/Destinations/SecurityEventDestinationCatalog";

/*
 * "Your logs" and "Send to your SIEM" are wired through registries that
 * fail SILENTLY when an entry is missing: a model or service absent from
 * its index is never created, a migration not listed never applies, a cron
 * file not imported in Workers/Index.ts never runs, an unmounted router
 * just 404s, and a SIEM with no sender is a destination that never sends.
 * These read the registries as text so a refactor that drops an entry
 * fails here instead of in production.
 */

function repoPath(relative: string): string {
  return path.join(__dirname, "../../..", relative);
}

function readSquashed(relative: string): string {
  return fs.readFileSync(repoPath(relative), "utf8").replace(/\s+/g, " ");
}

describe("registry wiring", () => {
  test("both Postgres models and their services are registered", () => {
    const models: string = readSquashed(
      "Common/Models/DatabaseModels/Index.ts",
    );
    const services: string = readSquashed("Common/Server/Services/Index.ts");

    for (const model of [
      "SecurityEventDestination",
      "SecurityLogSource",
      "SecurityTelemetrySource",
    ]) {
      expect(models).toContain(`${model},`);
      expect(services).toContain(`${model}Service,`);
    }
  });

  test("their migration is registered: an unregistered migration never runs", () => {
    expect(
      readSquashed(
        "Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.ts",
      ),
    ).toContain("AddSecurityEventDestinationsAndLogSources1804250000000,");
  });

  test("both cron jobs are imported in Workers/Index.ts, and each runs every minute", () => {
    const workersIndex: string = readSquashed(
      "App/FeatureSet/Workers/Index.ts",
    );

    expect(workersIndex).toContain(
      'import "./Jobs/SecurityEvents/ScanLogsForSecurityEvents"',
    );
    expect(workersIndex).toContain(
      'import "./Jobs/SecurityEvents/ForwardSecurityEvents"',
    );

    const scan: string = readSquashed(
      "App/FeatureSet/Workers/Jobs/SecurityEvents/ScanLogsForSecurityEvents.ts",
    );
    const forward: string = readSquashed(
      "App/FeatureSet/Workers/Jobs/SecurityEvents/ForwardSecurityEvents.ts",
    );

    expect(scan).toContain("schedule: EVERY_MINUTE");
    expect(scan).toContain(
      "await SecurityLogScanner.enqueueProjectsWithEnabledSources();",
    );
    expect(scan).toContain(
      "return SecurityLogScanner.scanProject(projectId, lease);",
    );
    expect(forward).toContain("schedule: EVERY_MINUTE");
    expect(forward).toContain(
      "await SecurityEventForwarder.enqueueProjectsWithEnabledDestinations();",
    );
    expect(forward).toContain(
      "return SecurityEventForwarder.forwardProject(projectId, lease);",
    );
  });

  test("the destination API (with its test route) and the log source API are mounted", () => {
    const baseApi: string = readSquashed("App/FeatureSet/BaseAPI/Index.ts");

    expect(baseApi).toContain("new SecurityEventDestinationAPI().getRouter()");
    expect(baseApi).toMatch(
      /new BaseAPI<\s*SecurityLogSource,\s*SecurityLogSourceServiceType\s*>\(\s*SecurityLogSource,\s*SecurityLogSourceService,?\s*\)/,
    );
    expect(baseApi).toMatch(
      /new BaseAPI<\s*SecurityTelemetrySource,\s*SecurityTelemetrySourceServiceType\s*>\(\s*SecurityTelemetrySource,\s*SecurityTelemetrySourceService,?\s*\)/,
    );
  });

  test("your OneUptime data: its scan runs every minute, and its migration is registered", () => {
    const workersIndex: string = readSquashed(
      "App/FeatureSet/Workers/Index.ts",
    );
    const scan: string = readSquashed(
      "App/FeatureSet/Workers/Jobs/SecurityEvents/ScanTelemetryForSecurityEvents.ts",
    );
    const migrations: string = readSquashed(
      "Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.ts",
    );

    expect(workersIndex).toContain(
      'import "./Jobs/SecurityEvents/ScanTelemetryForSecurityEvents"',
    );
    expect(scan).toContain("schedule: EVERY_MINUTE");
    expect(scan).toContain(
      "await SecurityTelemetryScanner.enqueueProjectsWithEnabledSources();",
    );
    expect(scan).toContain(
      "return SecurityTelemetryScanner.scanProject(projectId, lease);",
    );
    expect(migrations).toMatch(/AddSecurityTelemetrySource\d+,/);
  });

  test("every SIEM the form offers has a sender", () => {
    for (const definition of SecurityEventDestinationCatalog) {
      expect([
        definition.provider,
        typeof SecurityEventDestinationRegistry.getSender(definition.provider)
          .send,
      ]).toEqual([definition.provider, "function"]);
    }

    expect(
      SecurityEventDestinationCatalog.map(
        (definition: SecurityEventDestinationDefinition): string => {
          return definition.provider;
        },
      ),
    ).toEqual([
      "google-secops",
      "splunk",
      "microsoft-sentinel",
      "elastic-security",
    ]);
  });

  test("the Connections page draws your logs and your SIEM", () => {
    const page: string = readSquashed(
      "App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Connections.tsx",
    );

    expect(page).toContain("<SecurityLogsSourceCard />");
    expect(page).toContain("<SecurityEventDestinationsTable />");
  });

  test("the setup routes the Overview calls are the ones the API serves", () => {
    const api: string = readSquashed(
      "App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi.ts",
    );
    const server: string = readSquashed("Common/Server/API/SecurityCaseAPI.ts");

    for (const route of [
      "/security-case/setup/status",
      "/security-case/setup/turn-on-recommended",
      "/security-case/setup/test",
    ]) {
      expect([route, api.includes(`"${route}"`)]).toEqual([route, true]);
      expect([
        route,
        server.includes(route.replace("/security-case", "")),
      ]).toEqual([route, true]);
    }
  });
});
