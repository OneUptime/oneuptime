import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Google SecOps custom-rule detections were imported as Unknown because the
 * normalizer never read the rule's meta severity (detection[].ruleLabels).
 * The poller skips event ids it already holds, so a re-import cannot fix
 * them; this migration re-grades the stored rows in place.
 *
 * What is pinned here: the migration queues exactly the repair statement
 * GoogleSecOpsSeverityRepair builds, against the local storage table ON
 * CLUSTER, with the migration connection; it never halts the chain over a
 * table that does not exist yet; and it is registered once, after the
 * migrations that existed before it. What the statement computes is pinned
 * against a real ClickHouse in Common's
 * GoogleSecOpsSeverityRepairClickhouseIntegration suite.
 */

jest.mock("Common/Server/Services/SecurityEventService", () => {
  return {
    __esModule: true,
    default: {
      execute: jest.fn(),
    },
  };
});

jest.mock(
  "../../../FeatureSet/Workers/DataMigrations/ClickHouseMigrationUtil",
  () => {
    return {
      __esModule: true,
      default: { tableExists: jest.fn() },
    };
  },
);

import SecurityEventService from "Common/Server/Services/SecurityEventService";
import { MigrationExecuteOptions } from "Common/Server/Services/AnalyticsDatabaseService";
import logger from "Common/Server/Utils/Logger";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import GoogleSecOpsSeverityRepair from "Common/Server/Utils/SecurityEvent/GoogleSecOpsSeverityRepair";
import ClickHouseMigrationUtil from "../../../FeatureSet/Workers/DataMigrations/ClickHouseMigrationUtil";
import RepairGoogleSecOpsDetectionSeverity from "../../../FeatureSet/Workers/DataMigrations/RepairGoogleSecOpsDetectionSeverity";

type MockFunction = ReturnType<typeof jest.fn>;

const securityEventService: { execute: MockFunction } =
  SecurityEventService as unknown as { execute: MockFunction };

const migrationUtil: { tableExists: MockFunction } =
  ClickHouseMigrationUtil as unknown as { tableExists: MockFunction };

const CLUSTER_ENV_KEY: string = "CLICKHOUSE_CLUSTER_NAME";

let savedClusterName: string | undefined;

beforeEach(() => {
  savedClusterName = process.env[CLUSTER_ENV_KEY];
  delete process.env[CLUSTER_ENV_KEY];

  securityEventService.execute.mockReset();
  migrationUtil.tableExists.mockReset();

  migrationUtil.tableExists.mockImplementation(() => {
    return Promise.resolve(true);
  });
  securityEventService.execute.mockImplementation(() => {
    return Promise.resolve(undefined);
  });

  jest.spyOn(logger, "info").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  if (savedClusterName === undefined) {
    delete process.env[CLUSTER_ENV_KEY];
  } else {
    process.env[CLUSTER_ENV_KEY] = savedClusterName;
  }

  jest.restoreAllMocks();
});

describe("RepairGoogleSecOpsDetectionSeverity", () => {
  test("has a stable name and runs on the clustered schema", () => {
    const migration: RepairGoogleSecOpsDetectionSeverity =
      new RepairGoogleSecOpsDetectionSeverity();

    // The runner records migrations by name; renaming it would re-run it.
    expect(migration.name).toBe("RepairGoogleSecOpsDetectionSeverity");
    expect(migration.runsInClusterMode()).toBe(true);
  });

  test("repairs the security event table's local storage ON CLUSTER", () => {
    expect(new SecurityEvent().tableName).toBe("SecurityEventItemV1");

    const statement: string =
      RepairGoogleSecOpsDetectionSeverity.getRepairStatement(
        "SecurityEventItemV1",
      );

    expect(statement).toBe(
      GoogleSecOpsSeverityRepair.repairStatement({
        storageTable: "SecurityEventItemV1Local",
        onCluster: " ON CLUSTER 'oneuptime'",
      }),
    );
    expect(
      statement.startsWith(
        "ALTER TABLE SecurityEventItemV1Local ON CLUSTER 'oneuptime' UPDATE severityName = ",
      ),
    ).toBe(true);
  });

  test("targets the configured cluster", () => {
    process.env[CLUSTER_ENV_KEY] = "analytics";

    expect(
      RepairGoogleSecOpsDetectionSeverity.getRepairStatement(
        "SecurityEventItemV1",
      ),
    ).toContain(
      "ALTER TABLE SecurityEventItemV1Local ON CLUSTER 'analytics' UPDATE",
    );
  });

  test("only rewrites Google SecOps findings still stored as Unknown", () => {
    const statement: string =
      RepairGoogleSecOpsDetectionSeverity.getRepairStatement(
        "SecurityEventItemV1",
      );

    expect(statement).toContain(
      " WHERE vendorName = 'Google' AND productName = 'Google SecOps' AND classUid = 2004 AND severityId = 0 AND ",
    );
  });

  test("queues the mutation once, on the migration connection", async () => {
    await new RepairGoogleSecOpsDetectionSeverity().migrate();

    expect(migrationUtil.tableExists).toHaveBeenCalledWith(
      "SecurityEventItemV1Local",
    );
    expect(securityEventService.execute).toHaveBeenCalledTimes(1);
    expect(securityEventService.execute).toHaveBeenCalledWith(
      RepairGoogleSecOpsDetectionSeverity.getRepairStatement(
        "SecurityEventItemV1",
      ),
      MigrationExecuteOptions,
    );
  });

  test("does not wait for the mutation to finish", async () => {
    await new RepairGoogleSecOpsDetectionSeverity().migrate();

    const statement: string = securityEventService.execute.mock
      .calls[0]![0] as string;

    expect(statement).not.toContain("mutations_sync");
  });

  test("does nothing, and does not fail, when the table does not exist yet", async () => {
    migrationUtil.tableExists.mockImplementation(() => {
      return Promise.resolve(false);
    });

    await expect(
      new RepairGoogleSecOpsDetectionSeverity().migrate(),
    ).resolves.toBeUndefined();

    expect(securityEventService.execute).not.toHaveBeenCalled();
  });

  test("a failed mutation fails the migration, so the runner retries it on the next run", async () => {
    securityEventService.execute.mockImplementation(() => {
      return Promise.reject(new Error("TIMEOUT_EXCEEDED"));
    });

    await expect(
      new RepairGoogleSecOpsDetectionSeverity().migrate(),
    ).rejects.toThrow("TIMEOUT_EXCEEDED");
  });

  test("rollback leaves the grades in place", async () => {
    await expect(
      new RepairGoogleSecOpsDetectionSeverity().rollback(),
    ).resolves.toBeUndefined();
    expect(securityEventService.execute).not.toHaveBeenCalled();
  });

  test("is registered once, after every migration that existed before it", () => {
    const index: string = fs
      .readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "FeatureSet",
          "Workers",
          "DataMigrations",
          "Index.ts",
        ),
        "utf8",
      )
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

    expect(index).toContain(
      'import RepairGoogleSecOpsDetectionSeverity from "./RepairGoogleSecOpsDetectionSeverity";',
    );

    const registered: Array<string> = Array.from(
      index.matchAll(/new ([A-Za-z0-9]+)\(\)/g),
    ).map((match: RegExpMatchArray) => {
      return match[1]!;
    });

    expect(
      registered.filter((name: string) => {
        return name === "RepairGoogleSecOpsDetectionSeverity";
      }),
    ).toHaveLength(1);
    expect(
      registered.indexOf("RepairGoogleSecOpsDetectionSeverity"),
    ).toBeGreaterThan(registered.indexOf("BackfillAuditLogRootResource"));
    expect(
      registered.indexOf("RepairGoogleSecOpsDetectionSeverity"),
    ).toBeGreaterThan(
      registered.indexOf(
        "MoveGoogleSecOpsConnectionsToSecurityEventConnections",
      ),
    );
  });
});
