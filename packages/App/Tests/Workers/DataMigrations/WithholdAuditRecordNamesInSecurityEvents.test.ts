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
 * The security events the audit log's scan stored before #10663 named the
 * records they were about - an API key, a custom role, a team - to every
 * reader of security events, and so did what was made of them. This
 * migration says them all without the names, once.
 *
 * What is pinned here: Postgres first - every project's copies, through the
 * SQL of AuditRecordNameCopies, on the security case repository's
 * connection - then exactly the mutation AuditRecordNamesRepair builds,
 * against the local storage table ON CLUSTER, with the migration
 * connection, queued without waiting; it never halts the chain over a table
 * that does not exist yet, never puts a name back, and is registered once,
 * before the two slots kept last. What the mutation computes is pinned
 * against a real ClickHouse in Common's
 * AuditRecordNamesRepairClickhouseIntegration suite, and the copies against
 * a real Postgres in AuditRecordNameCopiesPostgres.
 */

jest.mock("Common/Server/Services/SecurityEventService", () => {
  return {
    __esModule: true,
    default: {
      execute: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/SecurityCaseService", () => {
  return {
    __esModule: true,
    default: {
      getRepository: jest.fn(),
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
import SecurityCaseService from "Common/Server/Services/SecurityCaseService";
import { MigrationExecuteOptions } from "Common/Server/Services/AnalyticsDatabaseService";
import logger from "Common/Server/Utils/Logger";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import AuditRecordNameCopies from "Common/Server/Utils/SecurityEvent/TelemetryScan/AuditRecordNameCopies";
import AuditRecordNamesRepair from "Common/Server/Utils/SecurityEvent/TelemetryScan/AuditRecordNamesRepair";
import ClickHouseMigrationUtil from "../../../FeatureSet/Workers/DataMigrations/ClickHouseMigrationUtil";
import WithholdAuditRecordNamesInSecurityEvents from "../../../FeatureSet/Workers/DataMigrations/WithholdAuditRecordNamesInSecurityEvents";

type MockFunction = ReturnType<typeof jest.fn>;

const securityEventService: { execute: MockFunction } =
  SecurityEventService as unknown as { execute: MockFunction };

const securityCaseService: { getRepository: MockFunction } =
  SecurityCaseService as unknown as { getRepository: MockFunction };

const migrationUtil: { tableExists: MockFunction } =
  ClickHouseMigrationUtil as unknown as { tableExists: MockFunction };

const CLUSTER_ENV_KEY: string = "CLICKHOUSE_CLUSTER_NAME";

let savedClusterName: string | undefined;
let steps: Array<string>;
const manager: { query: MockFunction } = { query: jest.fn() };

beforeEach(() => {
  savedClusterName = process.env[CLUSTER_ENV_KEY];
  delete process.env[CLUSTER_ENV_KEY];
  steps = [];

  securityEventService.execute.mockReset();
  securityCaseService.getRepository.mockReset();
  migrationUtil.tableExists.mockReset();

  securityCaseService.getRepository.mockImplementation(() => {
    return { manager };
  });
  migrationUtil.tableExists.mockImplementation(() => {
    return Promise.resolve(true);
  });
  securityEventService.execute.mockImplementation(() => {
    steps.push("clickhouse");
    return Promise.resolve(undefined);
  });
  jest
    .spyOn(AuditRecordNameCopies, "rewordEveryProject")
    .mockImplementation(async () => {
      steps.push("postgres");
      return 3;
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

describe("WithholdAuditRecordNamesInSecurityEvents", () => {
  test("has a stable name and runs on the clustered schema", () => {
    const migration: WithholdAuditRecordNamesInSecurityEvents =
      new WithholdAuditRecordNamesInSecurityEvents();

    // The runner records migrations by name; renaming it would re-run it.
    expect(migration.name).toBe("WithholdAuditRecordNamesInSecurityEvents");
    expect(migration.runsInClusterMode()).toBe(true);
  });

  test("rewords the security event table's local storage ON CLUSTER", () => {
    expect(new SecurityEvent().tableName).toBe("SecurityEventItemV1");

    const statement: string =
      WithholdAuditRecordNamesInSecurityEvents.getRepairStatement(
        "SecurityEventItemV1",
      );

    expect(statement).toBe(
      AuditRecordNamesRepair.repairStatement({
        storageTable: "SecurityEventItemV1Local",
        onCluster: " ON CLUSTER 'oneuptime'",
      }),
    );
    expect(
      statement.startsWith(
        "ALTER TABLE SecurityEventItemV1Local ON CLUSTER 'oneuptime' UPDATE message = ",
      ),
    ).toBe(true);
  });

  test("targets the configured cluster", () => {
    process.env[CLUSTER_ENV_KEY] = "analytics";

    expect(
      WithholdAuditRecordNamesInSecurityEvents.getRepairStatement(
        "SecurityEventItemV1",
      ),
    ).toContain(
      "ALTER TABLE SecurityEventItemV1Local ON CLUSTER 'analytics' UPDATE",
    );
  });

  test("rewords the copies in Postgres first, then queues the mutation once, on the migration connection", async () => {
    await new WithholdAuditRecordNamesInSecurityEvents().migrate();

    expect(steps).toEqual(["postgres", "clickhouse"]);
    expect(AuditRecordNameCopies.rewordEveryProject).toHaveBeenCalledWith({
      manager,
    });
    expect(migrationUtil.tableExists).toHaveBeenCalledWith(
      "SecurityEventItemV1Local",
    );
    expect(securityEventService.execute).toHaveBeenCalledTimes(1);
    expect(securityEventService.execute).toHaveBeenCalledWith(
      WithholdAuditRecordNamesInSecurityEvents.getRepairStatement(
        "SecurityEventItemV1",
      ),
      MigrationExecuteOptions,
    );
  });

  test("does not wait for the mutation to finish", async () => {
    await new WithholdAuditRecordNamesInSecurityEvents().migrate();

    const statement: string = securityEventService.execute.mock
      .calls[0]![0] as string;

    expect(statement).not.toContain("mutations_sync");
  });

  test("rewords the copies, and does not fail, when the events' table does not exist yet", async () => {
    migrationUtil.tableExists.mockImplementation(() => {
      return Promise.resolve(false);
    });

    await expect(
      new WithholdAuditRecordNamesInSecurityEvents().migrate(),
    ).resolves.toBeUndefined();

    expect(steps).toEqual(["postgres"]);
    expect(securityEventService.execute).not.toHaveBeenCalled();
  });

  test("a failed mutation fails the migration, so the runner retries it on the next run", async () => {
    securityEventService.execute.mockImplementation(() => {
      return Promise.reject(new Error("TIMEOUT_EXCEEDED"));
    });

    await expect(
      new WithholdAuditRecordNamesInSecurityEvents().migrate(),
    ).rejects.toThrow("TIMEOUT_EXCEEDED");
  });

  test("rollback puts no name back", async () => {
    await expect(
      new WithholdAuditRecordNamesInSecurityEvents().rollback(),
    ).resolves.toBeUndefined();
    expect(securityEventService.execute).not.toHaveBeenCalled();
    expect(AuditRecordNameCopies.rewordEveryProject).not.toHaveBeenCalled();
  });

  test("is registered once, before the two slots kept last", () => {
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
      'import WithholdAuditRecordNamesInSecurityEvents from "./WithholdAuditRecordNamesInSecurityEvents";',
    );

    const registered: Array<string> = Array.from(
      index.matchAll(/new ([A-Za-z0-9]+)\(\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(
      registered.filter((name: string): boolean => {
        return name === "WithholdAuditRecordNamesInSecurityEvents";
      }),
    ).toHaveLength(1);
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
    expect(registered[registered.length - 2]).toBe(
      "BackfillIncidentCallTranscriptSignInAccount",
    );
    expect(registered.indexOf("WithholdAuditRecordNamesInSecurityEvents")).toBe(
      registered.length - 3,
    );
    // After the scan that wrote the names, and the copies' tables, existed.
    expect(
      registered.indexOf("WithholdAuditRecordNamesInSecurityEvents"),
    ).toBeGreaterThan(
      registered.indexOf("RepairGoogleSecOpsDetectionSeverity"),
    );
  });
});
