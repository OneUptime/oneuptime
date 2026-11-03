// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";

import { describe, expect, test } from "@jest/globals";
import DataAssetKind from "Common/Types/DataObservability/DataAssetKind";
import { DatabaseConnection } from "Common/Server/Utils/DataSecurity/Content/DatabaseSampler";
import {
  DataObservabilityProbeResultReport,
  DataObservabilityProbeStoreWork,
} from "Common/Server/Utils/DataObservability/DataObservabilityProbeCollect";
import {
  TableHealthCollectOptions,
  TableHealthSnapshot,
} from "Common/Server/Utils/DataObservability/TableHealthCollector";
import {
  collectStore,
  CollectTableHealthDependencies,
  isTableHealthCollectAllowedOnThisProbe,
} from "../../../Jobs/DataObservability/CollectTableHealth";
import { PROBE_CAPABILITIES } from "../../../Utils/ProbeAPIRequest";
import ProbeCapability from "Common/Types/Probe/ProbeCapability";

/*
 * THE PROBE COLLECTS A STORE WITHOUT EVER SENDING ITS CONNECTION STRING.
 *
 * Each store handed out is answered: a variable the probe will not read or
 * does not have, a database it cannot reach - each becomes a report of the
 * error, with the connection string's secrets taken out, and a collection
 * that runs becomes a snapshot.
 */

const WORK: DataObservabilityProbeStoreWork = {
  dataStoreId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  engine: "postgresql",
  probeConnectionVariable: "ORDERS_DB_URL",
  maxTables: 100,
  maxColumns: 1000,
  exclusions: ["audit"],
};

const SNAPSHOT: TableHealthSnapshot = {
  engine: "postgresql",
  collectedAt: "2026-11-03T12:00:00.000Z",
  tables: [
    {
      schema: "public",
      name: "orders",
      kind: DataAssetKind.Table,
      estimatedRows: 10,
      sizeInBytes: 8192,
      writeCount: 4,
      secondsSinceChange: null,
      columns: [],
    },
  ],
  isComplete: true,
  warnings: [],
};

function dependencies(data: {
  environment: Record<string, string | undefined>;
  collect?: CollectTableHealthDependencies["collect"];
}): CollectTableHealthDependencies & {
  calls: Array<{
    connection: DatabaseConnection;
    options: TableHealthCollectOptions;
  }>;
} {
  const calls: Array<{
    connection: DatabaseConnection;
    options: TableHealthCollectOptions;
  }> = [];

  return {
    calls,
    environment: data.environment,
    collect: async (
      connection: DatabaseConnection,
      options: TableHealthCollectOptions,
    ): Promise<TableHealthSnapshot> => {
      calls.push({ connection, options });

      if (data.collect) {
        return await data.collect(connection, options);
      }

      return SNAPSHOT;
    },
  };
}

describe("collectStore", () => {
  test("collects with the connection string from the variable the store names", async () => {
    const deps: ReturnType<typeof dependencies> = dependencies({
      environment: { ORDERS_DB_URL: "  postgres://reader:pw@db:5432/orders  " },
    });
    const report: DataObservabilityProbeResultReport = await collectStore(
      WORK,
      deps,
    );

    expect(report.error).toBeUndefined();
    expect(report.snapshot).toEqual(SNAPSHOT);
    expect(deps.calls).toEqual([
      {
        connection: {
          engine: "postgresql",
          connectionString: "postgres://reader:pw@db:5432/orders",
        },
        options: { maxTables: 100, maxColumns: 1000, exclusions: ["audit"] },
      },
    ]);
  });

  test("a variable the probe does not have is a report of the error", async () => {
    const report: DataObservabilityProbeResultReport = await collectStore(
      WORK,
      dependencies({ environment: {} }),
    );

    expect(report.snapshot).toBeUndefined();
    expect(report.error).toBe(
      "The probe has no environment variable ORDERS_DB_URL.",
    );
  });

  test("the probe's own settings are never read as a connection string", async () => {
    const deps: ReturnType<typeof dependencies> = dependencies({
      environment: { PROBE_KEY: "secret" },
    });
    const report: DataObservabilityProbeResultReport = await collectStore(
      { ...WORK, probeConnectionVariable: "PROBE_KEY" },
      deps,
    );

    expect(report.error).toContain("does not read the environment variable");
    expect(deps.calls).toHaveLength(0);
  });

  test("an error never carries the password", async () => {
    const report: DataObservabilityProbeResultReport = await collectStore(
      WORK,
      dependencies({
        environment: {
          ORDERS_DB_URL: "postgres://reader:hunter2secret@db/orders",
        },
        collect: async (): Promise<TableHealthSnapshot> => {
          throw new Error(
            "could not connect to postgres://reader:hunter2secret@db/orders",
          );
        },
      }),
    );

    expect(report.error).toBeDefined();
    expect(report.error).not.toContain("hunter2secret");
  });
});

describe("where it runs", () => {
  test("never on a global probe of a billing-enabled instance", () => {
    expect(
      isTableHealthCollectAllowedOnThisProbe({
        isAutoRegisteredGlobalProbe: true,
        isBillingEnabled: true,
      }),
    ).toBe(false);
    expect(
      isTableHealthCollectAllowedOnThisProbe({
        isAutoRegisteredGlobalProbe: false,
        isBillingEnabled: true,
      }),
    ).toBe(true);
    expect(
      isTableHealthCollectAllowedOnThisProbe({
        isAutoRegisteredGlobalProbe: true,
        isBillingEnabled: false,
      }),
    ).toBe(true);
  });

  test("the probe declares the capability, so the server hands it work", () => {
    expect(PROBE_CAPABILITIES).toContain(
      ProbeCapability.DataObservabilityCollect,
    );
  });
});
