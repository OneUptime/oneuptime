// The rule's file reaches the job queue, which needs Redis; nothing here queues.
jest.mock("../../../../Server/Utils/DataSecurity/DataSecurityJobs", () => {
  return {
    queueDataSecurityEvaluation: jest.fn(),
    queueDataStoreScan: jest.fn(),
  };
});

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import { getServedProjectSql } from "../../../../Server/Utils/DataSecurity/DataSecurityProbeClaim";
import {
  MAX_TELEMETRY_STORES_NOT_SCANNED,
  PROJECT_TELEMETRY_SCANNABLE_STATEMENT,
  TELEMETRY_STORES_NOT_SCANNED_STATEMENT,
  getTelemetryOwnersNotScanned,
  getTelemetryProjectScannableSql,
  getTelemetryStoreScannableSql,
  isProjectTelemetryScannable,
  isTelemetryOwnerNotScanned,
} from "../../../../Server/Utils/DataSecurity/DataSecurityTelemetryScanRule";
import { TelemetryOwnersNotScanned } from "../../../../Server/Utils/DataSecurity/Telemetry/TelemetryDataScanner";
import { SubscriptionStatusUtil } from "../../../../Types/Billing/SubscriptionStatus";
import { telemetryDataStoreKey } from "../../../../Types/DataSecurity/DataStoreKey";
import {
  DataStoreKind,
  TELEMETRY_DATA_STORE_KINDS,
} from "../../../../Types/DataSecurity/DataStoreKind";
import ObjectID from "../../../../Types/ObjectID";

/*
 * What the hourly telemetry scan may read (DataSecurityTelemetryScanRule,
 * OneUptime issues #8323 and #8325): a project that is served and scans
 * telemetry, and of it only the services whose store's Scan Content switch
 * is on. The scan read every service of every project. Postgres is stood
 * in for here; DataStoreProbeClaimPostgres runs the statements.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CHECKOUT: string = "0192f1a0-0000-7000-8000-0000000da001";
const WEB_APP: string = "0192f1a0-0000-7000-8000-0000000db001";

let queryRows: unknown;
let querySpy: jest.Mock;

function normalized(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function offRow(ownerId: string, kind: DataStoreKind): Record<string, string> {
  return {
    storeKey: telemetryDataStoreKey({ serviceId: ownerId, kind }),
    kind,
  };
}

beforeEach(() => {
  queryRows = [];
  querySpy = jest.fn(async () => {
    return queryRows;
  });
  jest.spyOn(DataStoreService, "getRepository").mockReturnValue({
    manager: { query: querySpy },
  } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the rules", () => {
  test("a project: its telemetry switch, and the served project", () => {
    expect(
      getTelemetryProjectScannableSql({ statusesParameter: "$4" }).split(
        "\n    AND ",
      ),
    ).toEqual([
      'COALESCE(s."isTelemetryScanEnabled", true) = true',
      ...getServedProjectSql("$4"),
    ]);
  });

  test("a store: its own Scan Content switch", () => {
    expect(getTelemetryStoreScannableSql()).toBe(
      'ds."isContentScanEnabled" = true',
    );
  });
});

describe("whether the project's telemetry may be read", () => {
  test("the statement asks the project, through its settings, by the rule", () => {
    const sql: string = normalized(PROJECT_TELEMETRY_SCANNABLE_STATEMENT);

    expect(sql).toContain(
      'FROM "Project" p LEFT JOIN "DataSecuritySetting" s ON s."projectId" = p."_id" AND s."deletedAt" IS NULL',
    );
    expect(sql).toContain(
      `WHERE p."_id" = $1 AND ${normalized(
        getTelemetryProjectScannableSql({ statusesParameter: "$2" }),
      )}`,
    );
  });

  test("a row: it may, bound to the project and the served statuses", async () => {
    queryRows = [{ _id: PROJECT_ID.toString() }];

    expect(await isProjectTelemetryScannable(PROJECT_ID)).toBe(true);
    expect(querySpy.mock.calls[0]![0]).toBe(
      PROJECT_TELEMETRY_SCANNABLE_STATEMENT,
    );
    expect(querySpy.mock.calls[0]![1]).toEqual([
      PROJECT_ID.toString(),
      SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
    ]);
  });

  test("no row (not served, or telemetry scanning off), or no answer: it may not", async () => {
    for (const rows of [[], undefined, null]) {
      queryRows = rows;

      expect(await isProjectTelemetryScannable(PROJECT_ID)).toBe(false);
    }
  });
});

describe("the services whose telemetry is left out", () => {
  test("the statement: the project's telemetry stores whose switch is not on, deleted ones aside, at most the limit", () => {
    const sql: string = normalized(TELEMETRY_STORES_NOT_SCANNED_STATEMENT);

    expect(sql).toContain(
      'WHERE ds."projectId" = $1 AND ds."deletedAt" IS NULL AND ds."kind" = ANY($2::text[])',
    );
    expect(sql).toContain(
      `AND (${getTelemetryStoreScannableSql()}) IS NOT TRUE LIMIT $3`,
    );
  });

  test("bound to the project, every telemetry kind and the limit", async () => {
    await getTelemetryOwnersNotScanned(PROJECT_ID);

    expect(querySpy.mock.calls[0]![1]).toEqual([
      PROJECT_ID.toString(),
      [...TELEMETRY_DATA_STORE_KINDS],
      MAX_TELEMETRY_STORES_NOT_SCANNED,
    ]);
  });

  test("none off: an empty map", async () => {
    expect((await getTelemetryOwnersNotScanned(PROJECT_ID)).size).toBe(0);
  });

  test("each off store's service, by kind, in lower case: a RUM application for session replays", async () => {
    queryRows = [
      offRow(CHECKOUT.toUpperCase(), DataStoreKind.TelemetryLogs),
      offRow(CHECKOUT, DataStoreKind.TelemetryAiConversations),
      offRow(WEB_APP, DataStoreKind.TelemetrySessionReplays),
    ];

    const off: TelemetryOwnersNotScanned =
      await getTelemetryOwnersNotScanned(PROJECT_ID);

    expect(Array.from(off.get(DataStoreKind.TelemetryLogs) || [])).toEqual([
      CHECKOUT,
    ]);
    expect(
      Array.from(off.get(DataStoreKind.TelemetryAiConversations) || []),
    ).toEqual([CHECKOUT]);
    expect(
      Array.from(off.get(DataStoreKind.TelemetrySessionReplays) || []),
    ).toEqual([WEB_APP]);
    expect(off.has(DataStoreKind.TelemetryTraces)).toBe(false);

    expect(
      isTelemetryOwnerNotScanned(off, DataStoreKind.TelemetryLogs, CHECKOUT),
    ).toBe(true);
    expect(
      isTelemetryOwnerNotScanned(
        off,
        DataStoreKind.TelemetryLogs,
        CHECKOUT.toUpperCase(),
      ),
    ).toBe(true);
    expect(
      isTelemetryOwnerNotScanned(off, DataStoreKind.TelemetryTraces, CHECKOUT),
    ).toBe(false);
    expect(
      isTelemetryOwnerNotScanned(off, DataStoreKind.TelemetryLogs, WEB_APP),
    ).toBe(false);
  });

  test("a row that names no telemetry owner, or no kind, is passed over", async () => {
    queryRows = [
      {
        storeKey: "cloud:aws:AWS S3 Bucket:arn",
        kind: DataStoreKind.TelemetryLogs,
      },
      { storeKey: null, kind: DataStoreKind.TelemetryLogs },
      { storeKey: `telemetry:${CHECKOUT}:Logs`, kind: "Not a kind" },
      offRow(WEB_APP, DataStoreKind.TelemetryTraces),
    ];

    const off: TelemetryOwnersNotScanned =
      await getTelemetryOwnersNotScanned(PROJECT_ID);

    expect(Array.from(off.keys())).toEqual([DataStoreKind.TelemetryTraces]);
    expect(Array.from(off.get(DataStoreKind.TelemetryTraces) || [])).toEqual([
      WEB_APP,
    ]);
  });

  test("an answer that is not rows: it cannot tell, and says so", async () => {
    queryRows = undefined;

    await expect(getTelemetryOwnersNotScanned(PROJECT_ID)).rejects.toThrow(
      "The telemetry stores whose content scanning is off could not be read.",
    );
  });

  test("as many as one read takes: it cannot tell which it missed, and says so", async () => {
    queryRows = Array.from({ length: MAX_TELEMETRY_STORES_NOT_SCANNED }, () => {
      return offRow(
        ObjectID.generate().toString(),
        DataStoreKind.TelemetryLogs,
      );
    });

    await expect(getTelemetryOwnersNotScanned(PROJECT_ID)).rejects.toThrow(
      "so the scan cannot tell which services to leave out.",
    );
  });
});
