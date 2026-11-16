// The claim's file reaches the job queue, which needs Redis; nothing here queues.
jest.mock("../../../../Server/Utils/DataSecurity/DataSecurityJobs", () => {
  return {
    queueDataSecurityEvaluation: jest.fn(),
    queueDataStoreScan: jest.fn(),
  };
});

import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import { getServedProjectSql } from "../../../../Server/Utils/DataSecurity/DataSecurityProbeClaim";
import {
  CLAIM_DUE_DATA_STORES_FOR_WORKERS_STATEMENT,
  DATA_SECURITY_WORKER_CLAIM_IN_HOURS,
  DATA_STORE_SCANNABLE_BY_WORKERS_STATEMENT,
  claimDueDataStoresForWorkers,
  getWorkerContentScannableSql,
  isDataStoreContentScannableByWorkers,
} from "../../../../Server/Utils/DataSecurity/DataSecurityWorkerClaim";
import { SubscriptionStatusUtil } from "../../../../Types/Billing/SubscriptionStatus";
import OneUptimeDate from "../../../../Types/Date";
import { WORKER_CLAIMED_DATA_STORE_KINDS } from "../../../../Types/DataSecurity/DataStoreKind";
import ObjectID from "../../../../Types/ObjectID";

/*
 * The workers' content-scan claim (DataSecurityWorkerClaim, OneUptime issue
 * #8325): one self-committing statement shaped like the probe's, which
 * reads the project's content switch and whether the project is served -
 * the old claim read neither, so a suspended project's stores were sampled
 * and a project that turned scanning off had its stores claimed and dropped
 * every hour - and the same rule asked again by the scan, for the one store
 * it was handed, before it reads any content. Postgres is stood in for
 * here; DataStoreProbeClaimPostgres runs the statements.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STORE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const NOW: Date = new Date("2026-11-15T12:00:00.000Z");
const HOUR_IN_MS: number = 60 * 60 * 1000;

let queryRows: unknown;
let querySpy: jest.Mock;

function normalized(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

beforeEach(() => {
  queryRows = [];
  querySpy = jest.fn(async () => {
    return queryRows;
  });
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(NOW.getTime());
  });
  jest.spyOn(DataStoreService, "getRepository").mockReturnValue({
    manager: { query: querySpy },
  } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the rule", () => {
  test("the store's switch, archived, the kinds a worker samples, the project's switch, and the served project", () => {
    expect(
      getWorkerContentScannableSql({
        kindsParameter: "$7",
        statusesParameter: "$8",
      }).split("\n    AND "),
    ).toEqual([
      'ds."deletedAt" IS NULL',
      'ds."isContentScanEnabled" = true',
      'ds."isArchived" = false',
      'ds."kind" = ANY($7::text[])',
      'COALESCE(s."isContentScanEnabled", true) = true',
      ...getServedProjectSql("$8"),
    ]);
  });
});

describe("the claim's statement", () => {
  const sql: string = normalized(CLAIM_DUE_DATA_STORES_FOR_WORKERS_STATEMENT);

  test("reads the store's project and its settings, never a probe's store", () => {
    expect(sql).toContain(
      'FROM "DataStore" ds INNER JOIN "Project" p ON ds."projectId" = p."_id"',
    );
    expect(sql).toContain(
      'LEFT JOIN "DataSecuritySetting" s ON s."projectId" = ds."projectId" AND s."deletedAt" IS NULL',
    );
    expect(sql).toContain('WHERE ds."scanProbeId" IS NULL');
    expect(sql).not.toContain('"Probe"');
  });

  test("hands out only what the rule says, with the kinds and served statuses bound", () => {
    expect(sql).toContain(
      normalized(
        getWorkerContentScannableSql({
          kindsParameter: "$2",
          statusesParameter: "$3",
        }),
      ),
    );
  });

  test("the due stores, the longest overdue first and a store never scanned before any, at most the limit", () => {
    expect(sql).toContain(
      'AND (ds."nextContentScanAt" IS NULL OR ds."nextContentScanAt" <= $1)',
    );
    expect(sql).toContain(
      'ORDER BY ds."nextContentScanAt" ASC NULLS FIRST LIMIT $4',
    );
    expect(sql.endsWith('ORDER BY "due"."dueAt" ASC NULLS FIRST')).toBe(true);
  });

  test("locks only the stores it takes, skipping one another holds, and holds them in the same statement", () => {
    expect(sql).toContain("FOR NO KEY UPDATE OF ds SKIP LOCKED");
    expect(sql).toContain(
      'UPDATE "DataStore" AS ds SET "nextContentScanAt" = $5::timestamptz FROM "due"',
    );
    expect(sql).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/);
  });
});

describe("claimDueDataStoresForWorkers", () => {
  test("binds now, the kinds, the served statuses, the limit and an hour's hold, and answers the rows", async () => {
    queryRows = [
      { _id: STORE_ID.toString(), projectId: PROJECT_ID.toString() },
    ];

    expect(await claimDueDataStoresForWorkers({ limit: 50.9 })).toEqual([
      { _id: STORE_ID.toString(), projectId: PROJECT_ID.toString() },
    ]);
    expect(querySpy).toHaveBeenCalledTimes(1);
    expect(querySpy.mock.calls[0]![0]).toBe(
      CLAIM_DUE_DATA_STORES_FOR_WORKERS_STATEMENT,
    );
    expect(querySpy.mock.calls[0]![1]).toEqual([
      NOW,
      [...WORKER_CLAIMED_DATA_STORE_KINDS],
      SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
      50,
      new Date(
        NOW.getTime() + DATA_SECURITY_WORKER_CLAIM_IN_HOURS * HOUR_IN_MS,
      ),
    ]);
  });

  test("no limit: nothing is asked", async () => {
    expect(await claimDueDataStoresForWorkers({ limit: 0 })).toEqual([]);
    expect(await claimDueDataStoresForWorkers({ limit: -3 })).toEqual([]);
    expect(querySpy).not.toHaveBeenCalled();
  });

  test("an answer that is not rows is nothing claimed", async () => {
    queryRows = undefined;

    expect(await claimDueDataStoresForWorkers({ limit: 5 })).toEqual([]);
  });
});

describe("the scan's question, for one store", () => {
  const sql: string = normalized(DATA_STORE_SCANNABLE_BY_WORKERS_STATEMENT);

  test("is the claim's rule, for the store and project named, with no scan probe", () => {
    expect(sql).toContain(
      'WHERE ds."_id" = $1 AND ds."projectId" = $2 AND ds."scanProbeId" IS NULL',
    );
    expect(sql).toContain(
      normalized(
        getWorkerContentScannableSql({
          kindsParameter: "$3",
          statusesParameter: "$4",
        }),
      ),
    );
    expect(sql).toContain('INNER JOIN "Project" p');
    expect(sql).not.toContain("UPDATE");
    expect(sql).not.toContain("FOR NO KEY UPDATE");
  });

  test("a row: the store may be read", async () => {
    queryRows = [{ _id: STORE_ID.toString() }];

    expect(
      await isDataStoreContentScannableByWorkers({
        projectId: PROJECT_ID,
        dataStoreId: STORE_ID,
      }),
    ).toBe(true);
    expect(querySpy.mock.calls[0]![1]).toEqual([
      STORE_ID.toString(),
      PROJECT_ID.toString(),
      [...WORKER_CLAIMED_DATA_STORE_KINDS],
      SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
    ]);
  });

  test("no row, or no answer: it may not", async () => {
    for (const rows of [[], undefined, null, {}]) {
      queryRows = rows;

      expect(
        await isDataStoreContentScannableByWorkers({
          projectId: PROJECT_ID,
          dataStoreId: STORE_ID,
        }),
      ).toBe(false);
    }
  });
});
