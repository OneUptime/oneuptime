jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import DatabaseService from "../../../Server/Services/DatabaseService";
import DataStoreService from "../../../Server/Services/DataStoreService";
import { claimDueTableHealthStoresForProbe } from "../../../Server/Utils/DataObservability/DataObservabilityProbeClaim";
import { claimDueDataStoresForProbe } from "../../../Server/Utils/DataSecurity/DataSecurityProbeClaim";
import OpenStackCheckStore, {
  OpenStackCheckService,
} from "../../../Server/Utils/OpenStack/OpenStackCheckStore";
import OpenStackProbeCollectionStore, {
  OpenStackCollectionCloudService,
} from "../../../Server/Utils/OpenStack/OpenStackProbeCollectionStore";
import VMwareProbeCollectionStore from "../../../Server/Utils/VMware/VMwareProbeCollectionStore";
import ObjectID from "../../../Types/ObjectID";
import {
  CapturedStatement,
  captureClaimQueries,
  expectPlaceholdersMatchParameters,
  normalizeSql,
} from "../TestingUtils/PastDueMonitoringClaimSql";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * THE PROBES' CLAIMS ARE EACH ONE STATEMENT (OneUptime issues #7194, #7390).
 *
 * The claims that hand a probe its vCenters, OpenStack clouds and checks,
 * and data stores lock the due rows FOR NO KEY UPDATE SKIP LOCKED and move
 * them on in the same self-committing statement. They used to be a
 * transaction - SELECT ... FOR UPDATE, the next times worked out in Node,
 * an UPDATE, COMMIT - which held every claimed row FOR UPDATE across round
 * trips, so every write of a row that names one waited for it, past
 * lock_timeout on a busy database.
 *
 * Each claim here is captured at its connection (captureClaimQueries makes
 * a claim that opens a transaction fail), and its one statement is held to
 * the shape: the locking CTE, the UPDATE in a CTE (TypeORM answers a
 * top-level UPDATE ... RETURNING as [rows, count]), the ids answered in
 * claim order, and every placeholder bound - the limit and the probe where
 * the statement says. After it, in a statement of its own, the due rows it
 * stepped over are set aside (Utils/Probe/ClaimSetAside, pinned in
 * ProbeCollectionClaimSetAside). The real Postgres suites run them
 * (VMwareProbeCollectionSqlPostgres, OpenStackProbeCollectionSqlPostgres,
 * OpenStackCheckSqlPostgres, DataStoreProbeClaimPostgres,
 * ProbeCollectionClaimSetAsidePostgres).
 */

const PROBE_ID: ObjectID = new ObjectID("b5000000-0000-4000-8000-000000000007");
const RUNNING_ID: string = "66666666-6666-4666-8666-666666666666";
const LIMIT: number = 7;

afterEach(() => {
  jest.restoreAllMocks();
});

// A connection to capture the claim on; captureClaimQueries replaces both.
function claimingService(): {
  getRepository: () => unknown;
  executeTransaction: () => Promise<unknown>;
} {
  return {
    getRepository: (): unknown => {
      return undefined;
    },
    executeTransaction: async (): Promise<unknown> => {
      return [];
    },
  };
}

interface ProbeClaim {
  name: string;
  table: string;
  alias: string;
  nextColumn: string;
  /*
   * The statement's first, locking CTE. An OpenStack check runs on the probe
   * it names or on its cloud's, so its claim locks in two branches, one for
   * each, and keeps the oldest of the two ("due").
   */
  firstCte: string;
  // Whether the probe says which of these it is still running.
  hasRunningIds: boolean;
  // Runs the claim for PROBE_ID with room for LIMIT: the statements it sent.
  run: () => Promise<Array<CapturedStatement>>;
}

const CLAIMS: Array<ProbeClaim> = [
  {
    name: "VMware collection",
    table: "VMwareVCenter",
    alias: "vc",
    nextColumn: "nextCollectionAt",
    firstCte: "due",
    hasRunningIds: true,
    run: async (): Promise<Array<CapturedStatement>> => {
      const service: ReturnType<typeof claimingService> = claimingService();
      const statements: Array<CapturedStatement> = captureClaimQueries(service);

      await VMwareProbeCollectionStore.claimDueVCenters(
        service as unknown as DatabaseService<VMwareVCenter>,
        {
          probeId: PROBE_ID,
          runningVMwareVCenterIds: [RUNNING_ID, "not-an-id"],
          limit: LIMIT,
        },
      );

      return statements;
    },
  },
  {
    name: "OpenStack collection",
    table: "OpenStackCloud",
    alias: "c",
    nextColumn: "nextCollectionAt",
    firstCte: "due",
    hasRunningIds: true,
    run: async (): Promise<Array<CapturedStatement>> => {
      const service: ReturnType<typeof claimingService> = claimingService();
      const statements: Array<CapturedStatement> = captureClaimQueries(service);

      await OpenStackProbeCollectionStore.claimDueClouds(
        service as unknown as OpenStackCollectionCloudService,
        {
          probeId: PROBE_ID,
          runningOpenStackCloudIds: [RUNNING_ID, "not-an-id"],
          limit: LIMIT,
        },
      );

      return statements;
    },
  },
  {
    name: "OpenStack API check",
    table: "OpenStackCloudCheck",
    alias: "ck",
    nextColumn: "nextApiCheckAt",
    firstCte: "ownProbeDue",
    hasRunningIds: true,
    run: async (): Promise<Array<CapturedStatement>> => {
      const service: ReturnType<typeof claimingService> = claimingService();
      const statements: Array<CapturedStatement> = captureClaimQueries(service);

      await OpenStackCheckStore.claimApiChecks(
        service as unknown as OpenStackCheckService,
        {
          probeId: PROBE_ID,
          runningIds: [RUNNING_ID, "not-an-id"],
          limit: LIMIT,
        },
      );

      return statements;
    },
  },
  {
    name: "OpenStack lifecycle check",
    table: "OpenStackCloudCheck",
    alias: "ck",
    nextColumn: "nextLifecycleCheckAt",
    firstCte: "ownProbeDue",
    hasRunningIds: true,
    run: async (): Promise<Array<CapturedStatement>> => {
      const service: ReturnType<typeof claimingService> = claimingService();
      const statements: Array<CapturedStatement> = captureClaimQueries(service);

      await OpenStackCheckStore.claimLifecycleChecks(
        service as unknown as OpenStackCheckService,
        {
          probeId: PROBE_ID,
          runningIds: [RUNNING_ID, "not-an-id"],
          limit: LIMIT,
        },
      );

      return statements;
    },
  },
  {
    name: "Data Security content scan",
    table: "DataStore",
    alias: "ds",
    nextColumn: "nextContentScanAt",
    firstCte: "due",
    hasRunningIds: false,
    run: async (): Promise<Array<CapturedStatement>> => {
      const statements: Array<CapturedStatement> =
        captureClaimQueries(DataStoreService);

      await claimDueDataStoresForProbe({ probeId: PROBE_ID, limit: LIMIT });

      return statements;
    },
  },
  {
    name: "Data Observability table health",
    table: "DataStore",
    alias: "ds",
    nextColumn: "nextTableHealthCollectionAt",
    firstCte: "due",
    hasRunningIds: false,
    run: async (): Promise<Array<CapturedStatement>> => {
      const statements: Array<CapturedStatement> =
        captureClaimQueries(DataStoreService);

      await claimDueTableHealthStoresForProbe({
        probeId: PROBE_ID,
        limit: LIMIT,
      });

      return statements;
    },
  },
];

/*
 * The values bound to every placeholder `pattern` captures: one for each
 * place the statement says it (an OpenStack check claim says its limit and
 * its running checks in each of its branches).
 */
function boundTo(
  statement: CapturedStatement,
  pattern: RegExp,
): Array<unknown> {
  const matches: Array<RegExpMatchArray> = [
    ...normalizeSql(statement.sql).matchAll(pattern),
  ];

  expect(matches.length).toBeGreaterThan(0);

  return matches.map((match: RegExpMatchArray): unknown => {
    return statement.parameters[Number(match[1]) - 1];
  });
}

describe.each(CLAIMS)("the $name claim", (claim: ProbeClaim) => {
  test("is one statement that locks the due rows FOR NO KEY UPDATE SKIP LOCKED and moves them on itself", async () => {
    const statements: Array<CapturedStatement> = await claim.run();

    // The claim, then the set-aside of the due rows it stepped over.
    expect(statements).toHaveLength(2);
    expect(normalizeSql(statements[1]!.sql)).toContain('"unclaimable" AS (');

    const sql: string = normalizeSql(statements[0]!.sql);

    expect(sql.startsWith(`WITH "${claim.firstCte}" AS ( SELECT `)).toBe(true);
    expect(sql).toContain(`FOR NO KEY UPDATE OF ${claim.alias} SKIP LOCKED`);
    // FOR UPDATE would make a foreign key check of a row naming one wait.
    expect(sql).not.toMatch(/FOR UPDATE/);

    expect(sql).toContain(
      `"claimed" AS ( UPDATE "${claim.table}" AS ${claim.alias} SET "${claim.nextColumn}" = `,
    );
    expect(sql).toContain(
      `FROM "due" WHERE ${claim.alias}."_id" = "due"."_id" RETURNING ${claim.alias}."_id" )`,
    );

    /*
     * Only what the statement wrote is answered, the longest overdue first.
     * A claimed row always has a due time now: the read is `due <= now`.
     */
    expect(
      sql.endsWith(
        'FROM "due" INNER JOIN "claimed" ON "claimed"."_id" = "due"."_id" ORDER BY "due"."dueAt" ASC',
      ),
    ).toBe(true);
    expect(sql).not.toContain("NULLS FIRST");
  });

  test("binds every placeholder it names: the probe, the limit, and the rows the probe is still running", async () => {
    const statement: CapturedStatement = (await claim.run())[0]!;

    expectPlaceholdersMatchParameters(statement);

    expect(statement.parameters[0]).toBe(PROBE_ID.toString());

    for (const limit of boundTo(statement, /\bLIMIT \$(\d+)/g)) {
      expect(limit).toBe(LIMIT);
    }

    if (claim.hasRunningIds) {
      // Only real ids, as a bound array - never as SQL.
      for (const running of boundTo(
        statement,
        new RegExp(
          `NOT \\(${claim.alias}\\."_id" = ANY\\(\\$(\\d+)::uuid\\[\\]\\)\\)`,
          "g",
        ),
      )) {
        expect(running).toEqual([RUNNING_ID]);
      }
    }
  });
});
