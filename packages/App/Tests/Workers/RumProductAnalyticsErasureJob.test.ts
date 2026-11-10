import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import RumSessionErasureRequest, {
  RumSessionErasureRequestStatus,
  RumSessionErasureRequestType,
} from "Common/Models/DatabaseModels/RumSessionErasureRequest";
import RumSessionErasureRequestService from "Common/Server/Services/RumSessionErasureRequestService";
import RumSessionPinService from "Common/Server/Services/RumSessionPinService";
import ProjectService from "Common/Server/Services/ProjectService";
import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import RumSessionChunkService from "Common/Server/Services/RumSessionChunkService";
import RumSessionService from "Common/Server/Services/RumSessionService";
import RumProductAnalyticsSessionService from "Common/Server/Services/RumProductAnalyticsSessionService";
import RumProductAnalyticsUserService from "Common/Server/Services/RumProductAnalyticsUserService";
import {
  ClickhouseExecuteOptions,
  MigrationExecuteOptions,
} from "Common/Server/Services/AnalyticsDatabaseService";
import AnalyticsTableName from "Common/Types/AnalyticsDatabase/AnalyticsTableName";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Session replay erasure, as it reaches product analytics (issue #6444).
 *
 * Product analytics keeps a session's summary for 13 months, longer than
 * most recordings, so the job erases it twice over: by id with every batch
 * of recordings (the anonymous first row of a session somebody signed in
 * during included), and - once a request has erased every recording it
 * will - by subject, for what only product analytics still holds. These
 * tests drive the job with every ClickHouse call answered in memory and
 * pin which tables each request type reaches, in what order, and when a
 * request comes back for another run.
 */

jest.mock("../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

/* In-memory Redis: the tombstone set and the finalizer's activity sets. */
const sets: Map<string, Set<string>> = new Map<string, Set<string>>();

jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: (): unknown => {
        return {
          sadd: (
            key: string,
            members: Array<string> | string,
          ): Promise<number> => {
            const set: Set<string> = sets.get(key) || new Set<string>();

            for (const member of Array.isArray(members) ? members : [members]) {
              set.add(member);
            }

            sets.set(key, set);
            return Promise.resolve(set.size);
          },
          smembers: (key: string): Promise<Array<string>> => {
            return Promise.resolve(Array.from(sets.get(key) || []));
          },
          sismember: (key: string, member: string): Promise<number> => {
            return Promise.resolve(sets.get(key)?.has(member) ? 1 : 0);
          },
          expire: (): Promise<number> => {
            return Promise.resolve(1);
          },
          zscan: (): Promise<[string, Array<string>]> => {
            return Promise.resolve(["0", []]);
          },
          zrem: (): Promise<number> => {
            return Promise.resolve(0);
          },
        };
      },
      isConnected: (): boolean => {
        return true;
      },
    },
  };
});

import {
  MAX_SESSION_IDS_PER_REQUEST_PER_RUN,
  ProductAnalyticsErasureResult,
  eraseProductAnalyticsSubject,
  getErasedSessionsKey,
  processErasureRequest,
} from "../../FeatureSet/Workers/Jobs/Rum/ProcessSessionErasureRequests";

const projectId: ObjectID = new ObjectID("6600000000000000000000a1");
const applicationId: ObjectID = new ObjectID("6600000000000000000000b1");
const requestId: ObjectID = new ObjectID("6600000000000000000000d4");
const databaseName: string = "oneuptime";
const userKey: string = "c".repeat(64);
const sessionA: string = "1f0c9a4b6d2e47f8a1b3c5d7e9f00112";
const sessionB: string = "2a1d0b5c7e3f48a9b2c4d6e8f0a11223";
const expiredSession: string = "3b2e1c6d8f4059b0c3d5e7f9a1b22334";

type TableLabel =
  | "chunks"
  | "headers"
  | "logs"
  | "spans"
  | "exceptions"
  | "analyticsSessions"
  | "analyticsUsers";

interface Delete {
  label: TableLabel;
  /* The bound values of the statement, ids lists flattened. */
  values: Array<unknown>;
  statement: Statement;
  options: ClickhouseExecuteOptions | undefined;
}

interface Harness {
  deletes: Array<Delete>;
  /* Lookups that read product analytics' session table. */
  analyticsLookups: Array<Statement>;
}

function resultSetOf(rows: Array<JSONObject>): unknown {
  return {
    json: (): Promise<{ data: Array<JSONObject> }> => {
      return Promise.resolve({ data: rows });
    },
  };
}

function boundValues(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params).flatMap((value: unknown) => {
    return Array.isArray(value) ? value : [value];
  });
}

function hexIds(count: number, seed: string): Array<string> {
  return Array.from({ length: count }, (_unused: unknown, index: number) => {
    return `${seed}${index.toString(16).padStart(32 - seed.length, "0")}`;
  });
}

/*
 * Every ClickHouse call the job makes, answered in memory: the header
 * lookup finds `headerSessions`, product analytics' own lookup finds
 * `analyticsSessions`, and every delete is recorded instead of run.
 */
function installHarness(data: {
  headerSessions: Array<string>;
  analyticsSessions: Array<string>;
  failAnalyticsDelete?: boolean | undefined;
}): Harness {
  const harness: Harness = { deletes: [], analyticsLookups: [] };

  jest
    .spyOn(RumSessionService, "executeQuery")
    .mockImplementation(((): Promise<unknown> => {
      return Promise.resolve(
        resultSetOf(
          data.headerSessions.map((sessionId: string): JSONObject => {
            return { sessionId: sessionId };
          }),
        ),
      );
    }) as never);

  jest
    .spyOn(RumSessionChunkService, "executeQuery")
    .mockResolvedValue(resultSetOf([{ chunkCount: 2 }]) as never);

  /* No stamped spans: the trace-id path has its own file. */
  jest
    .spyOn(SpanService, "executeQuery")
    .mockResolvedValue(resultSetOf([]) as never);

  jest
    .spyOn(RumProductAnalyticsSessionService, "executeQuery")
    .mockImplementation(((statement: Statement): Promise<unknown> => {
      harness.analyticsLookups.push(statement);

      return Promise.resolve(
        resultSetOf(
          data.analyticsSessions.map((sessionId: string): JSONObject => {
            return { paSessionId: sessionId };
          }),
        ),
      );
    }) as never);

  const services: Array<{ label: TableLabel; service: unknown }> = [
    { label: "chunks", service: RumSessionChunkService },
    { label: "headers", service: RumSessionService },
    { label: "logs", service: LogService },
    { label: "spans", service: SpanService },
    { label: "exceptions", service: ExceptionInstanceService },
    { label: "analyticsSessions", service: RumProductAnalyticsSessionService },
    { label: "analyticsUsers", service: RumProductAnalyticsUserService },
  ];

  for (const entry of services) {
    jest
      .spyOn(
        entry.service as {
          execute: (
            statement: Statement,
            options?: ClickhouseExecuteOptions,
          ) => Promise<unknown>;
        },
        "execute",
      )
      .mockImplementation(((
        statement: Statement,
        options?: ClickhouseExecuteOptions,
      ): Promise<unknown> => {
        if (
          data.failAnalyticsDelete &&
          entry.label.startsWith("analytics") &&
          !statement.query.includes("sessionId IN")
        ) {
          return Promise.reject(new Error("Too many mutations"));
        }

        harness.deletes.push({
          label: entry.label,
          values: boundValues(statement),
          statement: statement,
          options: options,
        });

        return Promise.resolve({});
      }) as never);
  }

  jest.spyOn(RumSessionPinService, "deleteBy").mockResolvedValue(0 as never);

  return harness;
}

interface RequestHarness {
  markCompleted: ReturnType<typeof jest.fn>;
  updateOneById: ReturnType<typeof jest.fn>;
  markFailed: ReturnType<typeof jest.fn>;
}

function installRequestHarness(): RequestHarness {
  jest
    .spyOn(RumSessionErasureRequestService, "markInProgress")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ProjectService, "sendEmailToProjectOwners")
    .mockResolvedValue(undefined as never);

  return {
    markCompleted: jest
      .spyOn(RumSessionErasureRequestService, "markCompleted")
      .mockResolvedValue(undefined as never) as unknown as ReturnType<
      typeof jest.fn
    >,
    updateOneById: jest
      .spyOn(RumSessionErasureRequestService, "updateOneById")
      .mockResolvedValue(undefined as never) as unknown as ReturnType<
      typeof jest.fn
    >,
    markFailed: jest
      .spyOn(RumSessionErasureRequestService, "markFailed")
      .mockResolvedValue(undefined as never) as unknown as ReturnType<
      typeof jest.fn
    >,
  };
}

function requestOf(data: {
  requestType?: RumSessionErasureRequestType | undefined;
  targetValue?: string | undefined;
  rumApplicationId?: ObjectID | undefined;
  startDate?: Date | undefined;
  endDate?: Date | undefined;
  attempts?: number | undefined;
  withoutProject?: boolean | undefined;
}): RumSessionErasureRequest {
  const request: RumSessionErasureRequest = new RumSessionErasureRequest();

  request.id = requestId;
  request.attempts = data.attempts || 0;

  if (!data.withoutProject) {
    request.projectId = projectId;
  }

  if (data.requestType) {
    request.requestType = data.requestType;
  }

  if (data.targetValue !== undefined) {
    request.targetValue = data.targetValue;
  }

  if (data.rumApplicationId) {
    request.rumApplicationId = data.rumApplicationId;
  }

  if (data.startDate) {
    request.startDate = data.startDate;
  }

  if (data.endDate) {
    request.endDate = data.endDate;
  }

  return request;
}

function labels(deletes: Array<Delete>): Array<TableLabel> {
  return deletes.map((entry: Delete): TableLabel => {
    return entry.label;
  });
}

function analyticsDeletes(deletes: Array<Delete>): Array<Delete> {
  return deletes.filter((entry: Delete): boolean => {
    return entry.label.startsWith("analytics");
  });
}

beforeEach(() => {
  sets.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("each batch takes product analytics' summaries of its sessions", () => {
  test("by id, before the header, in the batch's own mutation shape", async () => {
    const harness: Harness = installHarness({
      headerSessions: [],
      analyticsSessions: [],
    });
    installRequestHarness();

    await processErasureRequest({
      databaseName: databaseName,
      request: requestOf({
        requestType: RumSessionErasureRequestType.BySessionId,
        targetValue: `${sessionA},${sessionB}`,
      }),
    });

    expect(labels(harness.deletes)).toEqual([
      "chunks",
      "logs",
      "spans",
      "exceptions",
      "analyticsSessions",
      "headers",
    ]);

    const summaries: Delete = harness.deletes[4]!;

    expect(summaries.statement.query).toContain("ALTER TABLE");
    expect(summaries.statement.query).toContain("ON CLUSTER");
    expect(summaries.statement.query).toContain("sessionId IN");
    expect(summaries.values).toContain(
      `${AnalyticsTableName.RumProductAnalyticsSession}Local`,
    );
    expect(summaries.values).toEqual(
      expect.arrayContaining([projectId.toString(), sessionA, sessionB]),
    );
    expect(summaries.options).toBe(MigrationExecuteOptions);
  });

  test("an id list needs nothing more: no lookup, no subject delete", async () => {
    const harness: Harness = installHarness({
      headerSessions: [],
      analyticsSessions: [sessionA],
    });
    const requests: RequestHarness = installRequestHarness();

    await processErasureRequest({
      databaseName: databaseName,
      request: requestOf({
        requestType: RumSessionErasureRequestType.BySessionId,
        targetValue: sessionA,
      }),
    });

    expect(harness.analyticsLookups).toEqual([]);
    expect(analyticsDeletes(harness.deletes)).toHaveLength(1);
    expect(requests.markCompleted).toHaveBeenCalledTimes(1);
  });
});

describe("a user's erasure reaches what only product analytics still holds", () => {
  test("their sessions are looked up in product analytics and deleted by id, then their monthly rows", async () => {
    const harness: Harness = installHarness({
      headerSessions: [sessionA],
      /* sessionA was just queued for deletion; expiredSession's recording is long gone. */
      analyticsSessions: [sessionA, expiredSession],
    });
    const requests: RequestHarness = installRequestHarness();

    await processErasureRequest({
      databaseName: databaseName,
      request: requestOf({
        requestType: RumSessionErasureRequestType.ByIdentifiedUserKey,
        targetValue: userKey,
      }),
    });

    expect(harness.analyticsLookups).toHaveLength(1);

    const lookup: Statement = harness.analyticsLookups[0]!;

    expect(lookup.query).toContain("identifiedUserKey = ");
    expect(Object.values(lookup.query_params)).toContain(userKey);
    expect(Object.values(lookup.query_params)).toContain(
      MAX_SESSION_IDS_PER_REQUEST_PER_RUN,
    );

    /* The batch's own delete, then the subject's: summaries by id, months by key. */
    expect(labels(analyticsDeletes(harness.deletes))).toEqual([
      "analyticsSessions",
      "analyticsSessions",
      "analyticsUsers",
    ]);

    const subjectSessions: Delete = analyticsDeletes(harness.deletes)[1]!;

    expect(subjectSessions.values).toEqual(
      expect.arrayContaining([sessionA, expiredSession]),
    );
    expect(subjectSessions.options).toBe(MigrationExecuteOptions);

    const months: Delete = analyticsDeletes(harness.deletes)[2]!;

    expect(months.statement.query).toContain("personKey = ");
    expect(months.values).toContain(`u:${userKey}`);
    expect(months.values).toContain(
      `${AnalyticsTableName.RumProductAnalyticsUser}Local`,
    );
    expect(months.options).toBe(MigrationExecuteOptions);

    /* The subject's deletes come after every recording's. */
    expect(labels(harness.deletes).indexOf("headers")).toBeLessThan(
      harness.deletes.indexOf(subjectSessions),
    );

    expect(requests.markCompleted).toHaveBeenCalledTimes(1);
    expect(requests.updateOneById).not.toHaveBeenCalled();
  });

  test("a user with no recordings left is still erased from product analytics", async () => {
    const harness: Harness = installHarness({
      headerSessions: [],
      analyticsSessions: [expiredSession],
    });
    const requests: RequestHarness = installRequestHarness();

    await processErasureRequest({
      databaseName: databaseName,
      request: requestOf({
        requestType: RumSessionErasureRequestType.ByIdentifiedUserKey,
        targetValue: userKey,
      }),
    });

    expect(labels(harness.deletes)).toEqual([
      "analyticsSessions",
      "analyticsUsers",
    ]);
    expect(harness.deletes[0]!.values).toContain(expiredSession);
    expect(requests.markCompleted).toHaveBeenCalledTimes(1);
  });

  test("a request scoped to an application looks up and deletes in it only", async () => {
    const harness: Harness = installHarness({
      headerSessions: [],
      analyticsSessions: [expiredSession],
    });
    installRequestHarness();

    await processErasureRequest({
      databaseName: databaseName,
      request: requestOf({
        requestType: RumSessionErasureRequestType.ByIdentifiedUserKey,
        targetValue: userKey,
        rumApplicationId: applicationId,
      }),
    });

    expect(harness.analyticsLookups[0]!.query).toContain(
      "AND rumApplicationId = ",
    );
    expect(Object.values(harness.analyticsLookups[0]!.query_params)).toContain(
      applicationId.toString(),
    );

    for (const entry of analyticsDeletes(harness.deletes)) {
      expect(entry.statement.query).toContain("AND rumApplicationId = ");
      expect(entry.values).toContain(applicationId.toString());
    }
  });

  test("a full page of the user's sessions brings the request back next run, uncharged", async () => {
    const ids: Array<string> = hexIds(MAX_SESSION_IDS_PER_REQUEST_PER_RUN, "e");
    const harness: Harness = installHarness({
      headerSessions: [],
      analyticsSessions: ids,
    });
    const requests: RequestHarness = installRequestHarness();

    await processErasureRequest({
      databaseName: databaseName,
      request: requestOf({
        requestType: RumSessionErasureRequestType.ByIdentifiedUserKey,
        targetValue: userKey,
      }),
    });

    /* Ten mutations of a thousand ids, and the monthly rows. */
    expect(analyticsDeletes(harness.deletes)).toHaveLength(11);

    expect(requests.markCompleted).not.toHaveBeenCalled();
    expect(requests.updateOneById).toHaveBeenCalledTimes(1);

    const update: { data: Record<string, unknown> } = requests.updateOneById
      .mock.calls[0]![0] as never;

    expect(update.data["status"]).toBe(RumSessionErasureRequestStatus.Pending);
    expect(update.data["attempts"]).toBeUndefined();
  });

  test("a run the header lookup cut off leaves product analytics for the run that finishes", async () => {
    const ids: Array<string> = hexIds(MAX_SESSION_IDS_PER_REQUEST_PER_RUN, "f");

    /* Every one already tombstoned: their mutations are in flight. */
    sets.set(getErasedSessionsKey(projectId.toString()), new Set(ids));

    const harness: Harness = installHarness({
      headerSessions: ids,
      analyticsSessions: [expiredSession],
    });
    const requests: RequestHarness = installRequestHarness();

    await processErasureRequest({
      databaseName: databaseName,
      request: requestOf({
        requestType: RumSessionErasureRequestType.ByIdentifiedUserKey,
        targetValue: userKey,
      }),
    });

    expect(harness.analyticsLookups).toEqual([]);
    expect(analyticsDeletes(harness.deletes)).toEqual([]);
    expect(requests.markCompleted).not.toHaveBeenCalled();
    expect(requests.updateOneById).toHaveBeenCalledTimes(1);
  });

  test("a failed product analytics delete is retried, not reported complete", async () => {
    installHarness({
      headerSessions: [],
      analyticsSessions: [],
      failAnalyticsDelete: true,
    });
    const requests: RequestHarness = installRequestHarness();

    await processErasureRequest({
      databaseName: databaseName,
      request: requestOf({
        requestType: RumSessionErasureRequestType.ByIdentifiedUserKey,
        targetValue: userKey,
      }),
    });

    expect(requests.markCompleted).not.toHaveBeenCalled();
    expect(requests.markFailed).not.toHaveBeenCalled();

    const update: { data: Record<string, unknown> } = requests.updateOneById
      .mock.calls[0]![0] as never;

    expect(update.data["status"]).toBe(RumSessionErasureRequestStatus.Pending);
    expect(update.data["attempts"]).toBe(1);
    expect(String(update.data["failureReason"])).toContain(
      "Too many mutations",
    );
  });
});

describe("an application's and a date range's erasure", () => {
  test("an application loses every row of it in both tables, without a lookup", async () => {
    const harness: Harness = installHarness({
      headerSessions: [sessionA],
      analyticsSessions: [],
    });
    const requests: RequestHarness = installRequestHarness();

    await processErasureRequest({
      databaseName: databaseName,
      request: requestOf({
        requestType: RumSessionErasureRequestType.ByRumApplication,
        targetValue: applicationId.toString(),
      }),
    });

    expect(harness.analyticsLookups).toEqual([]);

    const subject: Array<Delete> = analyticsDeletes(harness.deletes).slice(1);

    expect(labels(subject)).toEqual(["analyticsSessions", "analyticsUsers"]);

    for (const entry of subject) {
      expect(entry.statement.query).toContain("AND rumApplicationId = ");
      expect(entry.statement.query).not.toContain("sessionId IN");
      expect(entry.values).toContain(applicationId.toString());
      expect(entry.values).toContain(projectId.toString());
    }

    expect(requests.markCompleted).toHaveBeenCalledTimes(1);
  });

  test("a date range loses the summaries of sessions that started in it, and keeps the monthly rows", async () => {
    const startDate: Date = new Date("2026-01-01T00:00:00.000Z");
    const endDate: Date = new Date("2026-02-01T00:00:00.000Z");
    const harness: Harness = installHarness({
      headerSessions: [],
      analyticsSessions: [],
    });
    installRequestHarness();

    await processErasureRequest({
      databaseName: databaseName,
      request: requestOf({
        requestType: RumSessionErasureRequestType.ByDateRange,
        startDate: startDate,
        endDate: endDate,
      }),
    });

    expect(labels(harness.deletes)).toEqual(["analyticsSessions"]);
    expect(harness.deletes[0]!.statement.query).toContain("startTime >= ");
    expect(harness.deletes[0]!.statement.query).toContain("startTime <= ");
  });
});

describe("eraseProductAnalyticsSubject", () => {
  test("says how much it did", async () => {
    installHarness({
      headerSessions: [],
      analyticsSessions: [sessionA, sessionB],
    });

    const result: ProductAnalyticsErasureResult =
      await eraseProductAnalyticsSubject({
        databaseName: databaseName,
        request: requestOf({
          requestType: RumSessionErasureRequestType.ByIdentifiedUserKey,
          targetValue: userKey,
        }),
      });

    expect(result).toEqual({
      deletesSubmitted: 2,
      userSessionsFound: 2,
      moreMayRemain: false,
    });
  });

  test("refuses a request with no project or no type before reading anything", async () => {
    const harness: Harness = installHarness({
      headerSessions: [],
      analyticsSessions: [],
    });

    await expect(
      eraseProductAnalyticsSubject({
        databaseName: databaseName,
        request: requestOf({
          requestType: RumSessionErasureRequestType.ByRumApplication,
          targetValue: applicationId.toString(),
          withoutProject: true,
        }),
      }),
    ).rejects.toThrow("no projectId");

    await expect(
      eraseProductAnalyticsSubject({
        databaseName: databaseName,
        request: requestOf({ targetValue: applicationId.toString() }),
      }),
    ).rejects.toThrow("no request type");

    expect(harness.deletes).toEqual([]);
  });

  test("a user request with an empty key reads and deletes nothing", async () => {
    const harness: Harness = installHarness({
      headerSessions: [],
      analyticsSessions: [sessionA],
    });

    await expect(
      eraseProductAnalyticsSubject({
        databaseName: databaseName,
        request: requestOf({
          requestType: RumSessionErasureRequestType.ByIdentifiedUserKey,
          targetValue: "  ",
        }),
      }),
    ).rejects.toThrow("no user key");

    expect(harness.analyticsLookups).toEqual([]);
    expect(harness.deletes).toEqual([]);
  });
});
