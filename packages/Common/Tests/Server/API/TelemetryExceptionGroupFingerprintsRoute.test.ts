import CommonAPI from "../../../Server/API/CommonAPI";
import TelemetryExceptionService from "../../../Server/Services/TelemetryExceptionService";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import FindBy from "../../../Server/Types/Database/FindBy";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  MAX_EXCEPTION_GROUP_FINGERPRINTS_LOOKUP,
  readExceptionGroupFingerprints,
} from "../../../Types/Telemetry/ExceptionGroupFingerprints";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { FindOperator } from "typeorm";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

/*
 * POST /telemetry-exception/group-fingerprints: the fingerprints the
 * occurrences of each of a batch of exceptions carry - its own, then those of
 * the exceptions merged into it (TelemetryExceptionService
 * .getGroupFingerprints) - for the exceptions the caller may read, in the
 * order asked. What an exception's page reads its security events by, and
 * what the Exceptions monitor form's preview leaves out with a resolved one.
 * The caller's read and Postgres's answer of what was merged are stubbed;
 * the service between them is the real one. A malformed request never
 * reaches a read.
 */

const ROUTE: string = "/telemetry-exception/group-fingerprints";
const PROJECT_ID: ObjectID = new ObjectID(
  "70000000-0000-4000-8000-000000000001",
);
const SURVIVOR_ID: string = "70000000-0000-4000-8000-00000000000a";
const PLAIN_ID: string = "70000000-0000-4000-8000-00000000000b";
const MERGED_ID: string = "70000000-0000-4000-8000-00000000000c";
const UNREADABLE_ID: string = "70000000-0000-4000-8000-00000000000d";
const CALLER: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  tenantId: PROJECT_ID,
};

let sent: Array<JSONObject>;
// What the caller may read, by id: its own fingerprint.
let readable: Record<string, string>;
// What was merged into what, as Postgres answers it.
let mergedInto: Array<{ survivorId: string; fingerprint: string }>;
let memberReads: Array<Array<unknown>>;
let find: SpyInstance<typeof TelemetryExceptionService.findBy>;

async function post(body: unknown): Promise<NextFunction> {
  const req: ExpressRequest = {
    params: {},
    headers: {},
    query: {},
    body,
  } as unknown as ExpressRequest;
  const next: NextFunction = jest.fn() as unknown as NextFunction;

  await mockRouter
    .match("POST", ROUTE)
    .handlerFunction(req, {} as ExpressResponse, next);

  return next;
}

function refusal(next: NextFunction): unknown {
  return (next as unknown as jest.Mock).mock.calls[0]?.[0];
}

// The ids a QueryHelper.any filter holds.
function idsOf(filter: unknown): Array<string> {
  const parameters: Record<string, unknown> =
    (filter as { objectLiteralParameters?: Record<string, unknown> })
      .objectLiteralParameters || {};

  return (Object.values(parameters).flat() as Array<unknown>).map(
    (id: unknown): string => {
      return String(id).toLowerCase();
    },
  );
}

describe("the group fingerprints route", () => {
  beforeAll(async () => {
    mockRouter.routes.length = 0;
    const module: { default: new () => unknown } = await import(
      "../../../Server/API/TelemetryExceptionAPI"
    );
    new module.default();
  });

  beforeEach(() => {
    sent = [];
    memberReads = [];
    readable = {
      [SURVIVOR_ID]: "fp-a",
      [PLAIN_ID]: "fp-p",
      [MERGED_ID]: "fp-b",
    };
    mergedInto = [
      { survivorId: SURVIVOR_ID, fingerprint: "fp-b" },
      { survivorId: SURVIVOR_ID, fingerprint: "fp-c" },
    ];
    TelemetryExceptionService.clearGroupFingerprints();

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(CALLER);
    jest.spyOn(Response, "sendJsonObjectResponse").mockImplementation(((
      _req: ExpressRequest,
      _res: ExpressResponse,
      json: JSONObject,
    ) => {
      sent.push(json);
    }) as never);

    // The caller's read: only what they may read is found.
    find = jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockImplementation((async (findBy: FindBy<TelemetryException>) => {
        const asked: Array<string> = idsOf(
          (findBy.query as Record<string, unknown>)["_id"],
        );

        return asked
          .filter((id: string): boolean => {
            return Boolean(readable[id]);
          })
          .map((id: string): TelemetryException => {
            const row: TelemetryException = new TelemetryException();
            row._id = id;
            row.fingerprint = readable[id]!;
            return row;
          });
      }) as never);

    // What was merged into what: the service's own read, as root.
    jest.spyOn(TelemetryExceptionService, "getRepository").mockReturnValue({
      manager: {
        query: async (_sql: string, params: Array<unknown>) => {
          memberReads.push(params);
          const ids: Array<string> = params[1] as Array<string>;
          return mergedInto.filter((row: { survivorId: string }): boolean => {
            return ids.includes(row.survivorId);
          });
        },
      },
    } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    TelemetryExceptionService.clearGroupFingerprints();
  });

  test("answers each exception the caller may read with its own fingerprint and those merged into it, in the order asked", async () => {
    const next: NextFunction = await post({
      telemetryExceptionIds: [PLAIN_ID, SURVIVOR_ID.toUpperCase(), PLAIN_ID],
    });

    expect(next).not.toHaveBeenCalled();
    // Each id once, as it was asked.
    expect(sent).toEqual([
      {
        exceptions: [
          { telemetryExceptionId: PLAIN_ID, fingerprints: ["fp-p"] },
          {
            telemetryExceptionId: SURVIVOR_ID.toUpperCase(),
            fingerprints: ["fp-a", "fp-b", "fp-c"],
          },
        ],
      },
    ]);
    // What the Dashboard reads back is what was sent.
    expect(readExceptionGroupFingerprints(sent[0])).toEqual(
      sent[0]!["exceptions"],
    );
  });

  test("the exceptions are read as the caller, in the caller's project, each once", async () => {
    await post({ telemetryExceptionIds: [SURVIVOR_ID, PLAIN_ID, SURVIVOR_ID] });

    expect(find).toHaveBeenCalledTimes(1);
    const findBy: FindBy<TelemetryException> = find.mock
      .calls[0]![0] as FindBy<TelemetryException>;
    const query: Record<string, unknown> = findBy.query as Record<
      string,
      unknown
    >;

    expect(findBy.props).toBe(CALLER);
    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["_id"]).toBeInstanceOf(FindOperator);
    expect(idsOf(query["_id"]).sort()).toEqual([PLAIN_ID, SURVIVOR_ID].sort());
    expect(findBy.limit).toBe(2);
    expect(findBy.select).toEqual({ _id: true, fingerprint: true });

    // One read of what was merged, for the ones read, in the caller's project.
    expect(memberReads).toHaveLength(1);
    expect(memberReads[0]![0]).toBe(PROJECT_ID.toString());
    expect((memberReads[0]![1] as Array<string>).sort()).toEqual(
      [PLAIN_ID, SURVIVOR_ID].sort(),
    );
  });

  test("an exception the caller may not read is not answered, and what was merged into it is not read", async () => {
    mergedInto.push({ survivorId: UNREADABLE_ID, fingerprint: "fp-secret" });

    await post({ telemetryExceptionIds: [UNREADABLE_ID, SURVIVOR_ID] });

    expect(sent).toEqual([
      {
        exceptions: [
          {
            telemetryExceptionId: SURVIVOR_ID,
            fingerprints: ["fp-a", "fp-b", "fp-c"],
          },
        ],
      },
    ]);
    expect(memberReads[0]![1]).toEqual([SURVIVOR_ID]);
    expect(JSON.stringify(sent)).not.toContain("fp-secret");
  });

  test("a merged exception named by its id is answered by its own fingerprint, as its own page reads it", async () => {
    await post({ telemetryExceptionIds: [MERGED_ID] });

    expect(sent).toEqual([
      {
        exceptions: [
          { telemetryExceptionId: MERGED_ID, fingerprints: ["fp-b"] },
        ],
      },
    ]);
  });

  test("when what was merged cannot be read, each is answered by its own fingerprint", async () => {
    jest.spyOn(TelemetryExceptionService, "getRepository").mockReturnValue({
      manager: {
        query: async () => {
          throw new Error("Postgres is down");
        },
      },
    } as never);

    await post({ telemetryExceptionIds: [SURVIVOR_ID] });

    expect(sent).toEqual([
      {
        exceptions: [
          { telemetryExceptionId: SURVIVOR_ID, fingerprints: ["fp-a"] },
        ],
      },
    ]);
  });

  test("an empty list is answered with nothing, and reads nothing", async () => {
    await post({ telemetryExceptionIds: [] });

    expect(find).not.toHaveBeenCalled();
    expect(memberReads).toHaveLength(0);
    expect(sent).toEqual([{ exceptions: [] }]);
  });

  test(`as many as ${MAX_EXCEPTION_GROUP_FINGERPRINTS_LOOKUP} exceptions are taken at once`, async () => {
    const ids: Array<string> = Array.from(
      { length: MAX_EXCEPTION_GROUP_FINGERPRINTS_LOOKUP },
      (): string => {
        return ObjectID.generate().toString();
      },
    );

    const next: NextFunction = await post({ telemetryExceptionIds: ids });

    expect(next).not.toHaveBeenCalled();
    expect((find.mock.calls[0]![0] as FindBy<TelemetryException>).limit).toBe(
      MAX_EXCEPTION_GROUP_FINGERPRINTS_LOOKUP,
    );
  });

  test.each([
    ["no list", {}],
    ["a list that is not one", { telemetryExceptionIds: SURVIVOR_ID }],
    [
      "more exceptions than one request takes",
      {
        telemetryExceptionIds: Array.from(
          { length: MAX_EXCEPTION_GROUP_FINGERPRINTS_LOOKUP + 1 },
          (): string => {
            return ObjectID.generate().toString();
          },
        ),
      },
    ],
    ["an id that is not text", { telemetryExceptionIds: [SURVIVOR_ID, 7] }],
    [
      "an id that is not an id",
      { telemetryExceptionIds: [SURVIVOR_ID, "not-an-id"] },
    ],
    ["a blank id", { telemetryExceptionIds: [""] }],
  ])(
    "%s is refused before anything is read",
    async (_name: string, body: unknown) => {
      const next: NextFunction = await post(body);

      expect(refusal(next)).toBeInstanceOf(BadDataException);
      expect(find).not.toHaveBeenCalled();
      expect(memberReads).toHaveLength(0);
      expect(sent).toHaveLength(0);
    },
  );

  test("a caller without a project is refused", async () => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue({ userId: ObjectID.generate() });

    const next: NextFunction = await post({
      telemetryExceptionIds: [SURVIVOR_ID],
    });

    expect(refusal(next)).toBeInstanceOf(BadDataException);
    expect(find).not.toHaveBeenCalled();
  });

  test("a caller who may not read exceptions is refused, as the read refused them", async () => {
    find.mockRejectedValue(
      new NotAuthorizedException("You do not have permission"),
    );

    const next: NextFunction = await post({
      telemetryExceptionIds: [SURVIVOR_ID],
    });

    expect(refusal(next)).toBeInstanceOf(NotAuthorizedException);
    expect(memberReads).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });
});
