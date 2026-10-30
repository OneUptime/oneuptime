import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ExceptionListStatsReader, {
  ExceptionListStatsQuery,
} from "../../../../Server/Utils/Telemetry/ExceptionListStatsReader";
import TelemetryExceptionService from "../../../../Server/Services/TelemetryExceptionService";
import ExceptionInstanceService from "../../../../Server/Services/ExceptionInstanceService";
import TelemetryReadAccess from "../../../../Server/Utils/Telemetry/TelemetryReadAccess";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import logger from "../../../../Server/Utils/Logger";
import ExceptionInstance from "../../../../Models/AnalyticsModels/ExceptionInstance";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import AnalyticsTableName from "../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  EXCEPTION_TREND_BUCKET_COUNT,
  ExceptionListStats,
  MAX_EXCEPTION_LIST_STATS_IDS,
} from "../../../../Types/Telemetry/ExceptionListStats";

/*
 * ExceptionListStatsReader with Postgres and ClickHouse mocked: the
 * exceptions are read as the caller (one they may not read is not answered
 * for), their occurrences only within the caller's telemetry read scope and
 * only for those exceptions' fingerprints, and each exception gets its
 * distinct users and a 24-bar trend over the range.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000001",
);
const OTHER_SERVICE_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000002",
);
const CALLER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: ObjectID.generate(),
};

const E1: string = "30000000-0000-4000-8000-000000000001";
const E2: string = "30000000-0000-4000-8000-000000000002";
const E3: string = "30000000-0000-4000-8000-000000000003";

const START: Date = new Date("2026-10-29T12:00:00.000Z");
const END: Date = new Date("2026-10-30T12:00:00.000Z");

function exception(
  id: string,
  fingerprint: string,
  serviceId: ObjectID = SERVICE_ID,
): TelemetryException {
  const row: TelemetryException = new TelemetryException();
  row._id = id;
  row.fingerprint = fingerprint;
  row.primaryEntityId = serviceId;
  return row;
}

interface FindCall {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  limit: number;
  props: unknown;
}

let findCalls: Array<FindCall>;
let readable: Array<TelemetryException>;
let statements: Array<Statement>;
let trendRows: Array<JSONObject>;
let userRows: Array<JSONObject> | Error;
let serviceFilterCalls: Array<Record<string, unknown>>;

function queryText(statement: Statement): string {
  return statement.query.replace(/\s+/g, " ").trim();
}

function paramValues(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

// The fingerprints a read is narrowed to: its one list of strings.
function fingerprintParam(statement: Statement): Array<unknown> {
  const lists: Array<Array<unknown>> = paramValues(statement).filter(
    (value: unknown): value is Array<unknown> => {
      return (
        Array.isArray(value) &&
        value.every((item: unknown): boolean => {
          return typeof item === "string" && item.startsWith("fp-");
        })
      );
    },
  );

  expect(lists).toHaveLength(1);
  return lists[0]!;
}

beforeEach(() => {
  findCalls = [];
  statements = [];
  serviceFilterCalls = [];
  readable = [exception(E1, "fp-1"), exception(E2, "fp-2", OTHER_SERVICE_ID)];
  trendRows = [];
  userRows = [];

  jest.spyOn(TelemetryExceptionService, "findBy").mockImplementation((async (
    args: FindCall,
  ) => {
    findCalls.push(args);
    return readable;
  }) as never);

  jest
    .spyOn(TelemetryReadAccess, "getServiceFilter")
    .mockImplementation((async (args: Record<string, unknown>) => {
      serviceFilterCalls.push(args);
      return { serviceIds: [SERVICE_ID, OTHER_SERVICE_ID] };
    }) as never);

  jest
    .spyOn(ExceptionInstanceService, "executeQuery")
    .mockImplementation((async (statement: Statement) => {
      statements.push(statement);
      const isUsers: boolean = statement.query.includes("uniq(userId)");

      if (isUsers && userRows instanceof Error) {
        throw userRows;
      }

      return {
        json: async () => {
          return { data: isUsers ? userRows : trendRows };
        },
      };
    }) as never);

  jest.spyOn(logger, "warn").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function read(
  ids: Array<string> = [E1, E2],
  props: DatabaseCommonInteractionProps = CALLER,
): Promise<ExceptionListStats> {
  return ExceptionListStatsReader.read({
    telemetryExceptionIds: ids.map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
    startTime: START,
    endTime: END,
    props,
  });
}

describe("what is read, and as whom", () => {
  test("the exceptions are read as the caller, in the caller's project, only their fingerprints and services", async () => {
    await read();

    expect(findCalls).toHaveLength(1);
    expect(findCalls[0]!.props).toBe(CALLER);
    expect(findCalls[0]!.query["projectId"]).toBe(PROJECT_ID);
    expect(findCalls[0]!.select).toEqual({
      _id: true,
      fingerprint: true,
      primaryEntityId: true,
    });
    expect(findCalls[0]!.limit).toBe(2);
  });

  test("the occurrences are read within the caller's telemetry scope, narrowed to these exceptions' services", async () => {
    await read();

    expect(serviceFilterCalls).toHaveLength(1);
    expect(serviceFilterCalls[0]!["modelType"]).toBe(ExceptionInstance);
    expect(serviceFilterCalls[0]!["props"]).toBe(CALLER);
    expect(serviceFilterCalls[0]!["requested"]).toEqual([
      SERVICE_ID.toString(),
      OTHER_SERVICE_ID.toString(),
    ]);

    for (const statement of statements) {
      expect(queryText(statement)).toContain("AND primaryEntityId IN (");
    }
  });

  test("an exception the caller may not read is not answered for, and its fingerprint is never queried", async () => {
    readable = [exception(E1, "fp-1")];

    const stats: ExceptionListStats = await read([E1, E3]);

    expect(
      stats.items.map((item: { telemetryExceptionId: string }) => {
        return item.telemetryExceptionId;
      }),
    ).toEqual([E1]);

    for (const statement of statements) {
      expect(fingerprintParam(statement)).toEqual(["fp-1"]);
    }
  });

  test("none readable: nothing is asked of ClickHouse", async () => {
    readable = [];

    const stats: ExceptionListStats = await read();

    expect(stats.items).toEqual([]);
    expect(statements).toHaveLength(0);
    expect(serviceFilterCalls).toHaveLength(0);
  });

  test("no ids: nothing is read at all", async () => {
    const stats: ExceptionListStats = await read([]);

    expect(stats.items).toEqual([]);
    expect(findCalls).toHaveLength(0);
    expect(statements).toHaveLength(0);
  });

  test("no project: refused before anything is read", async () => {
    await expect(read([E1], { userId: ObjectID.generate() })).rejects.toThrow(
      BadDataException,
    );
    expect(findCalls).toHaveLength(0);
  });

  test("a range that ends before it starts is refused before anything is read", async () => {
    await expect(
      ExceptionListStatsReader.read({
        telemetryExceptionIds: [new ObjectID(E1)],
        startTime: END,
        endTime: START,
        props: CALLER,
      }),
    ).rejects.toThrow("The end time must be after the start time");
    expect(findCalls).toHaveLength(0);
  });
});

describe("the two ClickHouse reads", () => {
  const query: ExceptionListStatsQuery = {
    projectId: PROJECT_ID,
    fingerprints: ["fp-1", "fp-2"],
    startTime: START,
    endTime: END,
    bucketSizeInSeconds: 3600,
    serviceFilter: { serviceIds: [SERVICE_ID] },
  };

  test("the trend counts occurrences per fingerprint and slice, slices counted from the range's start", () => {
    const statement: Statement =
      ExceptionListStatsReader.buildTrendStatement(query);
    const text: string = queryText(statement);

    expect(text).toContain(
      "SELECT fingerprint, intDiv(toInt64(toUnixTimestamp(time)) - {p0:Int64}, {p1:Int32}) AS bucket, count() AS cnt FROM {p2:Identifier}",
    );
    expect(text).toContain("GROUP BY fingerprint, bucket");
    expect(paramValues(statement).slice(0, 3)).toEqual([
      Math.floor(START.getTime() / 1000),
      3600,
      AnalyticsTableName.ExceptionInstance,
    ]);
  });

  test("users are counted distinct, and an occurrence naming nobody is left out", () => {
    const text: string = queryText(
      ExceptionListStatsReader.buildAffectedUsersStatement(query),
    );

    expect(text).toContain("SELECT fingerprint, uniq(userId) AS users FROM");
    expect(text).toContain("AND userId != ''");
    expect(text).toContain("GROUP BY fingerprint");
  });

  test.each([
    ["trend", ExceptionListStatsReader.buildTrendStatement],
    ["users", ExceptionListStatsReader.buildAffectedUsersStatement],
  ])(
    "the %s read keeps to the project, the range, the fingerprints, the retention and the scope, with a time limit",
    (_name: string, build: (query: ExceptionListStatsQuery) => Statement) => {
      const statement: Statement = build(query);
      const text: string = queryText(statement);

      expect(text).toMatch(/WHERE projectId = \{p\d+:String\}/);
      expect(text).toMatch(/AND time >= \{p\d+:DateTime\}/);
      expect(text).toMatch(/AND time <= \{p\d+:DateTime\}/);
      expect(text).toMatch(/AND fingerprint IN \(\{p\d+:Array\(String\)\}\)/);
      expect(text).toContain("AND retentionDate >= now()");
      expect(text).toContain("AND primaryEntityId IN (");
      expect(text).toContain("max_execution_time = 45");

      expect(paramValues(statement)).toContain(PROJECT_ID.toString());
      expect(fingerprintParam(statement)).toEqual(["fp-1", "fp-2"]);
    },
  );
});

describe("the answer", () => {
  test("each exception gets its distinct users and its occurrences in each of 24 bars", async () => {
    trendRows = [
      { fingerprint: "fp-1", bucket: 0, cnt: "3" },
      { fingerprint: "fp-1", bucket: 23, cnt: "5" },
      { fingerprint: "fp-2", bucket: 7, cnt: 2 },
    ];
    userRows = [
      { fingerprint: "fp-1", users: "4" },
      { fingerprint: "fp-2", users: 1 },
    ];

    const stats: ExceptionListStats = await read();

    expect(stats.bucketSizeInSeconds).toBe(3600);
    expect(stats.startTime).toBe(START.toISOString());
    expect(stats.endTime).toBe(END.toISOString());
    expect(stats.items).toHaveLength(2);

    const [first, second] = stats.items;
    expect(first!.telemetryExceptionId).toBe(E1);
    expect(first!.affectedUsers).toBe(4);
    expect(first!.trend).toHaveLength(EXCEPTION_TREND_BUCKET_COUNT);
    expect(first!.trend[0]).toBe(3);
    expect(first!.trend[23]).toBe(5);
    expect(second!.affectedUsers).toBe(1);
    expect(second!.trend[7]).toBe(2);
  });

  test("the range's last instant lands in the last bar, and a row before the range is dropped", async () => {
    trendRows = [
      { fingerprint: "fp-1", bucket: 24, cnt: 2 },
      { fingerprint: "fp-1", bucket: -1, cnt: 9 },
    ];

    const stats: ExceptionListStats = await read([E1]);

    expect(stats.items[0]!.trend[23]).toBe(2);
    expect(
      stats.items[0]!.trend.reduce((a: number, b: number) => {
        return a + b;
      }),
    ).toBe(2);
  });

  test("an exception with no occurrence in the range gets a flat trend and no users", async () => {
    const stats: ExceptionListStats = await read([E1]);

    expect(stats.items[0]!.trend).toEqual(new Array(24).fill(0));
    expect(stats.items[0]!.affectedUsers).toBe(0);
  });

  test("users that cannot be counted leave the trends standing, and read as unknown", async () => {
    trendRows = [{ fingerprint: "fp-1", bucket: 2, cnt: 1 }];
    userRows = new Error("Missing columns: 'userId'");

    const stats: ExceptionListStats = await read([E1]);

    expect(stats.items[0]!.trend[2]).toBe(1);
    expect(stats.items[0]!.affectedUsers).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  test("a failing trend read fails the answer", async () => {
    (
      ExceptionInstanceService.executeQuery as unknown as jest.Mock
    ).mockImplementation(async () => {
      throw new Error("ClickHouse is down");
    });

    await expect(read([E1])).rejects.toThrow("ClickHouse is down");
  });

  test("in the order asked, each once", async () => {
    readable = [exception(E2, "fp-2"), exception(E1, "fp-1")];

    const stats: ExceptionListStats = await read([E1, E2, E1]);

    expect(
      stats.items.map((item: { telemetryExceptionId: string }) => {
        return item.telemetryExceptionId;
      }),
    ).toEqual([E1, E2]);
  });
});

describe("the ids a request may carry", () => {
  test("ids are read once each", () => {
    expect(
      ExceptionListStatsReader.readIds([E1, E1.toUpperCase(), E2]).map(
        (id: ObjectID): string => {
          return id.toString();
        },
      ),
    ).toEqual([E1, E2]);
  });

  test("a malformed id, a list that is not one, or too many are refused", () => {
    expect(() => {
      return ExceptionListStatsReader.readIds(["not-an-id"]);
    }).toThrow(BadDataException);
    expect(() => {
      return ExceptionListStatsReader.readIds([7]);
    }).toThrow(BadDataException);
    expect(() => {
      return ExceptionListStatsReader.readIds(E1);
    }).toThrow(BadDataException);
    expect(() => {
      return ExceptionListStatsReader.readIds(
        new Array(MAX_EXCEPTION_LIST_STATS_IDS + 1).fill(E1),
      );
    }).toThrow(BadDataException);
  });
});
