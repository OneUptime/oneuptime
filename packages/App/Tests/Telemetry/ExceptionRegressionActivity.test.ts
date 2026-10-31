/*
 * An exception that comes back after it was resolved goes on its activity
 * timeline, from ingest.
 *
 * The batch upsert reopens a resolved exception on an occurrence after its
 * resolve (REOPENS_RESOLVED_EXCEPTION_SQL) and stamps regressedAt with the
 * statement's now(). The statement hands back the rows it reopened - those
 * whose regressedAt is that now(), which a row reopened by an earlier
 * statement never holds - and each gets a Regressed entry by OneUptime,
 * naming the release of the occurrence that brought it back. Here with the
 * database mocked; ExceptionRegressionPostgres.test.ts runs the statement
 * against a real Postgres.
 */
import ExceptionUtil, {
  RegressedExceptionRow,
  TelemetryExceptionPayload,
  clearExistingV1FingerprintCache,
} from "../../FeatureSet/Telemetry/Utils/Exception";
import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import TelemetryExceptionActivityService, {
  TelemetryExceptionActivityActor,
  TelemetryExceptionActivityEntry,
} from "Common/Server/Services/TelemetryExceptionActivityService";
import { TelemetryExceptionActivityType } from "Common/Models/DatabaseModels/TelemetryExceptionActivity";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000001",
);
const A: string = "30000000-0000-4000-8000-00000000000a";
const B: string = "30000000-0000-4000-8000-00000000000b";

function occurrence(fingerprint: string): TelemetryExceptionPayload {
  return {
    fingerprint,
    projectId: PROJECT_ID,
    primaryEntityId: SERVICE_ID,
    primaryEntityType: ServiceType.OpenTelemetry,
    exceptionType: "TypeError",
    message: `message of ${fingerprint}`,
    release: "2.0.1",
    occurredAt: new Date(Date.now() - 60 * 1000),
  };
}

let upserts: Array<string>;
let reopened: Array<RegressedExceptionRow> | undefined;
let recorded: Array<{
  entries: Array<TelemetryExceptionActivityEntry>;
  actor: TelemetryExceptionActivityActor;
}>;

beforeEach(() => {
  upserts = [];
  reopened = [];
  recorded = [];
  clearExistingV1FingerprintCache();

  jest.spyOn(TelemetryExceptionService, "getRepository").mockReturnValue({
    manager: {
      query: async (sql: string): Promise<unknown> => {
        if (sql.includes("INSERT INTO")) {
          upserts.push(sql);
          return reopened;
        }
        return [];
      },
    },
  } as never);

  jest
    .spyOn(TelemetryExceptionActivityService, "record")
    .mockImplementation((async (data: {
      entries: Array<TelemetryExceptionActivityEntry>;
      actor: TelemetryExceptionActivityActor;
    }) => {
      recorded.push(data);
      return data.entries.length;
    }) as never);

  for (const level of ["debug", "info", "warn"] as const) {
    jest.spyOn(logger, level).mockImplementation((() => {
      return undefined;
    }) as never);
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the upsert hands back the exceptions it reopened", () => {
  test("it is wrapped so only rows reopened by this statement come back", async () => {
    await ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch([
      occurrence("a"),
    ]);

    expect(upserts).toHaveLength(1);
    const sql: string = upserts[0]!;
    expect(sql).toContain('WITH "upserted" AS (');
    expect(sql).toContain(
      'RETURNING "_id", "projectId", "regressedAt", "lastSeenInRelease"',
    );
    expect(sql).toContain('FROM "upserted"');
    expect(sql).toContain('WHERE "regressedAt" = now()');
    // The reopen itself is unchanged: regressedAt is the statement's now().
    expect(sql).toMatch(/"regressedAt" = CASE[\s\S]*THEN now\(\)/);
  });

  test("each one it reopened: Regressed, by OneUptime, with the release that brought it back", async () => {
    reopened = [
      { id: A, projectId: PROJECT_ID.toString(), lastSeenInRelease: "2.0.1" },
      { id: B, projectId: PROJECT_ID.toString(), lastSeenInRelease: null },
    ];

    await ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch([
      occurrence("a"),
      occurrence("b"),
    ]);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.actor).toEqual({});
    expect(
      recorded[0]!.entries.map((entry: TelemetryExceptionActivityEntry) => {
        return [
          entry.telemetryExceptionId.toString(),
          entry.projectId.toString(),
          entry.activityType,
          entry.release,
        ];
      }),
    ).toEqual([
      [
        A,
        PROJECT_ID.toString(),
        TelemetryExceptionActivityType.Regressed,
        "2.0.1",
      ],
      [B, PROJECT_ID.toString(), TelemetryExceptionActivityType.Regressed, null],
    ]);
  });

  test("a batch that reopens nothing records nothing", async () => {
    reopened = [];
    await ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch([
      occurrence("a"),
    ]);

    reopened = undefined;
    await ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch([
      occurrence("a"),
    ]);

    expect(recorded).toHaveLength(0);
  });

  test("a row that is not an exception's is left out", async () => {
    await ExceptionUtil.recordRegressions([
      { id: "nope", projectId: PROJECT_ID.toString(), lastSeenInRelease: "" },
      { id: A, projectId: "", lastSeenInRelease: "" },
      null as unknown as RegressedExceptionRow,
      { id: B, projectId: PROJECT_ID.toString(), lastSeenInRelease: "" },
    ]);

    expect(
      recorded[0]!.entries.map((entry: TelemetryExceptionActivityEntry) => {
        return entry.telemetryExceptionId.toString();
      }),
    ).toEqual([B]);
  });

  test("an entry that cannot be recorded never fails the batch: its occurrences are counted already", async () => {
    (
      TelemetryExceptionActivityService.record as unknown as jest.Mock
    ).mockImplementation(async () => {
      throw new Error("connection lost");
    });

    reopened = [
      { id: A, projectId: PROJECT_ID.toString(), lastSeenInRelease: "2.0.1" },
    ];

    await expect(
      ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch([occurrence("a")]),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  test("a failed upsert still fails loud, and records nothing", async () => {
    jest.spyOn(TelemetryExceptionService, "getRepository").mockReturnValue({
      manager: {
        query: async (sql: string): Promise<unknown> => {
          if (sql.includes("INSERT INTO")) {
            throw new Error("deadlock detected");
          }
          return [];
        },
      },
    } as never);
    jest.spyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);

    await expect(
      ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch([occurrence("a")]),
    ).rejects.toThrow("deadlock detected");
    expect(recorded).toHaveLength(0);
  });
});
