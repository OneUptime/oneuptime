import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import SimilarExceptionsReader, {
  MAX_SAME_SERVICE_CANDIDATES,
  MAX_SAME_TYPE_CANDIDATES,
  MESSAGE_HEAD_LENGTH,
  STACK_TRACE_HEAD_LENGTH,
} from "../../../../Server/Utils/Telemetry/SimilarExceptionsReader";
import TelemetryExceptionService from "../../../../Server/Services/TelemetryExceptionService";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import ObjectID from "../../../../Types/ObjectID";
import {
  SimilarException,
  SimilarExceptionReason,
} from "../../../../Types/Telemetry/SimilarExceptions";

/*
 * SimilarExceptionsReader with the exceptions mocked: the exception is read
 * as the caller (one they may not read is not found), then the most
 * recently seen exceptions of its type and of its service, as the caller,
 * every status; the most similar few come back with why.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const TARGET_ID: string = "30000000-0000-4000-8000-000000000001";
const CALLER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: ObjectID.generate(),
};

const TRACE: string =
  "TypeError: x\n    at checkout (/app/src/cart.ts:42:17)\n    at run (/app/node_modules/x/index.js:1:1)";

function row(
  id: string,
  overrides: Partial<TelemetryException> = {},
): TelemetryException {
  const exception: TelemetryException = new TelemetryException();
  exception._id = id;
  exception.projectId = PROJECT_ID;
  exception.primaryEntityId = SERVICE_ID;
  exception.exceptionType = "TypeError";
  exception.message = "Order 10000001 failed";
  exception.stackTrace = TRACE;
  exception.occuranceCount = 3;
  exception.lastSeenAt = new Date("2026-10-30T11:00:00.000Z");
  exception.isResolved = false;
  exception.isArchived = false;
  Object.assign(exception, overrides);
  return exception;
}

interface FindCall {
  query: Record<string, unknown>;
  limit: number;
  props: unknown;
  select?: Record<string, unknown> | undefined;
}

let texts: Map<string, { message: string; stackTrace: string }>;
let headReads: Array<Array<string>>;

let findCalls: Array<FindCall>;
let target: TelemetryException | null;
let sameType: Array<TelemetryException>;
let sameService: Array<TelemetryException>;

beforeEach(() => {
  findCalls = [];
  target = row(TARGET_ID);
  sameType = [
    row(TARGET_ID),
    row("30000000-0000-4000-8000-000000000002", {
      message: "Order 10000002 failed",
      isResolved: true,
      occuranceCount: 40,
    }),
    row("30000000-0000-4000-8000-000000000003", {
      message: "disk full",
      stackTrace: "Error\n    at write (/app/src/disk.ts:1:1)",
    }),
  ];
  sameService = [
    row("30000000-0000-4000-8000-000000000004", {
      exceptionType: "ReferenceError",
      message: "items is not defined",
    }),
  ];

  jest
    .spyOn(TelemetryExceptionService, "findOneById")
    .mockImplementation((async () => {
      return target;
    }) as never);
  jest.spyOn(TelemetryExceptionService, "findBy").mockImplementation((async (
    args: FindCall,
  ) => {
    findCalls.push({
      query: args.query,
      limit: args.limit,
      props: args.props,
      select: args.select,
    });
    return "exceptionType" in args.query ? sameType : sameService;
  }) as never);

  /*
   * The text heads Postgres cuts (readTextHeads), from the rows as they were
   * made: the reads above select neither message nor stack trace.
   */
  texts = new Map<string, { message: string; stackTrace: string }>();
  for (const row of [target, ...sameType, ...sameService]) {
    if (row) {
      texts.set(row.id!.toString(), {
        message: row.message || "",
        stackTrace: row.stackTrace || "",
      });
    }
  }
  headReads = [];
  jest
    .spyOn(SimilarExceptionsReader, "readTextHeads")
    .mockImplementation((async (args: { ids: Array<string> }) => {
      headReads.push(args.ids);
      return texts;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SimilarExceptionsReader.find", () => {
  test("reads candidates of the same type and of the same service as the caller, every status", async () => {
    await SimilarExceptionsReader.find({
      telemetryExceptionId: new ObjectID(TARGET_ID),
      props: CALLER,
    });

    expect(findCalls).toHaveLength(2);
    for (const call of findCalls) {
      expect(call.props).toBe(CALLER);
      expect(call.query["projectId"]).toBe(PROJECT_ID);
      expect("isResolved" in call.query).toBe(false);
      expect("isArchived" in call.query).toBe(false);
    }
    expect(
      findCalls.map((call: FindCall) => {
        return call.limit;
      }),
    ).toEqual([MAX_SAME_TYPE_CANDIDATES, MAX_SAME_SERVICE_CANDIDATES]);
  });

  test("the most similar first, with why and the status; never the exception itself", async () => {
    const similar: Array<SimilarException> = await SimilarExceptionsReader.find(
      {
        telemetryExceptionId: new ObjectID(TARGET_ID),
        props: CALLER,
      },
    );

    expect(
      similar.map((entry: SimilarException) => {
        return [entry.telemetryExceptionId, entry.reason, entry.isResolved];
      }),
    ).toEqual([
      [
        "30000000-0000-4000-8000-000000000002",
        SimilarExceptionReason.SameMessage,
        true,
      ],
      [
        "30000000-0000-4000-8000-000000000004",
        SimilarExceptionReason.SameCodeLocation,
        false,
      ],
    ]);
    expect(similar[0]?.occurrenceCount).toBe(40);
    expect(similar[0]?.lastSeenAt).toBe("2026-10-30T11:00:00.000Z");
  });

  test("an exception the caller may not read is not found, and nothing else is read", async () => {
    target = null;

    await expect(
      SimilarExceptionsReader.find({
        telemetryExceptionId: new ObjectID(TARGET_ID),
        props: CALLER,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(findCalls).toHaveLength(0);
  });
});

/*
 * Cheap to open: the message and the stack trace of each candidate - each
 * possibly megabytes - are never read through the caller's query; only the
 * first characters of each are, cut by Postgres, for the exceptions the
 * caller's own read returned.
 */
describe("what is read of each exception", () => {
  test("the reads through the caller's permissions select neither message nor stack trace", async () => {
    await SimilarExceptionsReader.find({
      telemetryExceptionId: new ObjectID(TARGET_ID),
      props: CALLER,
    });

    for (const call of findCalls) {
      expect(call.select?.["message"]).toBeUndefined();
      expect(call.select?.["stackTrace"]).toBeUndefined();
    }
    // One read of heads, for the exception and the candidates the caller read.
    expect(headReads).toHaveLength(1);
    expect([...new Set(headReads[0])].sort()).toEqual(
      [
        TARGET_ID,
        "30000000-0000-4000-8000-000000000002",
        "30000000-0000-4000-8000-000000000003",
        "30000000-0000-4000-8000-000000000004",
      ].sort(),
    );
  });

  test("the heads are cut by Postgres, for the caller's project and those ids only", async () => {
    jest.restoreAllMocks();
    const queries: Array<{ sql: string; params: Array<unknown> }> = [];
    jest.spyOn(TelemetryExceptionService, "getRepository").mockReturnValue({
      manager: {
        query: async (sql: string, params: Array<unknown>) => {
          queries.push({ sql, params });
          return [
            {
              id: TARGET_ID.toUpperCase(),
              message: "m",
              stackTrace: "s",
            },
          ];
        },
      },
    } as never);

    const heads: Map<string, { message: string; stackTrace: string }> =
      await SimilarExceptionsReader.readTextHeads({
        projectId: PROJECT_ID,
        ids: [TARGET_ID, TARGET_ID, "not-an-id"],
      });

    expect(queries).toHaveLength(1);
    expect(queries[0]!.sql).toContain("LEFT(COALESCE(\"message\", ''), $3)");
    expect(queries[0]!.sql).toContain("LEFT(COALESCE(\"stackTrace\", ''), $4)");
    expect(queries[0]!.sql).toContain('"projectId" = $1');
    expect(queries[0]!.params).toEqual([
      PROJECT_ID.toString(),
      [TARGET_ID],
      MESSAGE_HEAD_LENGTH,
      STACK_TRACE_HEAD_LENGTH,
    ]);
    expect(heads.get(TARGET_ID)).toEqual({ message: "m", stackTrace: "s" });
  });

  test("no ids, no query", async () => {
    jest.restoreAllMocks();
    const query: jest.SpiedFunction<() => unknown> = jest.fn() as never;
    jest
      .spyOn(TelemetryExceptionService, "getRepository")
      .mockReturnValue({ manager: { query } } as never);

    expect(
      (
        await SimilarExceptionsReader.readTextHeads({
          projectId: PROJECT_ID,
          ids: [],
        })
      ).size,
    ).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});
