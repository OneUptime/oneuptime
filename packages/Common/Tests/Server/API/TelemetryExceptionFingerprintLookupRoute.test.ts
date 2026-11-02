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
  MAX_EXCEPTION_FINGERPRINT_LENGTH,
  MAX_EXCEPTION_FINGERPRINT_LOOKUP,
  readExceptionsOfFingerprints,
} from "../../../Types/Telemetry/ExceptionFingerprintLookup";
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

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

/*
 * POST /telemetry-exception/by-fingerprints: the exception each of a batch
 * of fingerprints of occurrences counts on - its own, or the one it was
 * merged into - read as the caller. What a session replay's exception
 * groups link to. A malformed request never reaches a read.
 */

const ROUTE: string = "/telemetry-exception/by-fingerprints";
const PROJECT_ID: ObjectID = new ObjectID(
  "60000000-0000-4000-8000-000000000001",
);
const SURVIVOR_ID: string = "60000000-0000-4000-8000-00000000000a";
const OTHER_ID: string = "60000000-0000-4000-8000-00000000000c";
const CALLER: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  tenantId: PROJECT_ID,
};

let sent: Array<JSONObject>;

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

function exceptionRow(
  id: string,
  fingerprint: string,
  exceptionType: string,
): TelemetryException {
  const row: TelemetryException = new TelemetryException();
  row._id = id;
  row.fingerprint = fingerprint;
  row.exceptionType = exceptionType;
  row.message = `${exceptionType} at ${fingerprint}`;
  return row;
}

describe("the fingerprint lookup route", () => {
  beforeAll(async () => {
    mockRouter.routes.length = 0;
    const module: { default: new () => unknown } = await import(
      "../../../Server/API/TelemetryExceptionAPI"
    );
    new module.default();
  });

  beforeEach(() => {
    sent = [];
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
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("answers each fingerprint with the exceptions it counts on, in the order asked, as the caller", async () => {
    const find: SpyInstance<
      typeof TelemetryExceptionService.findByOccurrenceFingerprints
    > = jest
      .spyOn(TelemetryExceptionService, "findByOccurrenceFingerprints")
      .mockResolvedValue(
        new Map([
          ["fp-c", [exceptionRow(OTHER_ID, "fp-c", "RangeError")]],
          ["fp-b", [exceptionRow(SURVIVOR_ID, "fp-a", "TypeError")]],
        ]),
      );

    const next: NextFunction = await post({
      fingerprints: ["fp-b", " fp-c ", "fp-b", "fp-d"],
    });

    expect(next).not.toHaveBeenCalled();

    const args: Parameters<
      typeof TelemetryExceptionService.findByOccurrenceFingerprints
    >[0] = find.mock.calls[0]![0];
    expect(args.props).toBe(CALLER);
    expect(args.projectId).toBe(PROJECT_ID);
    // Each once, trimmed, as asked.
    expect(args.fingerprints).toEqual(["fp-b", "fp-c", "fp-d"]);
    expect(args.select).toEqual({
      _id: true,
      fingerprint: true,
      exceptionType: true,
      message: true,
    });
    expect(args.limit).toBe(6);

    expect(sent).toEqual([
      {
        exceptions: [
          {
            fingerprint: "fp-b",
            telemetryExceptionId: SURVIVOR_ID,
            exceptionType: "TypeError",
            message: "TypeError at fp-a",
          },
          {
            fingerprint: "fp-c",
            telemetryExceptionId: OTHER_ID,
            exceptionType: "RangeError",
            message: "RangeError at fp-c",
          },
        ],
      },
    ]);
    // What the Dashboard reads back is what was sent.
    expect(readExceptionsOfFingerprints(sent[0])).toHaveLength(2);
  });

  /*
   * Through the service, with Postgres mocked: fp-b's exception was merged
   * into fp-a's. The lookup leaves the merged row out and reads fp-a's
   * rows, and the answer for fp-b is the exception fp-b's occurrences
   * count on - not nothing, as matching the rows by their own fingerprint
   * gave, and not another service's exception that only shares fp-a.
   */
  test("a merged exception's fingerprint is answered with the exception it was merged into", async () => {
    const LOOKALIKE_ID: string = "60000000-0000-4000-8000-0000000000ff";

    jest.spyOn(TelemetryExceptionService, "findBy").mockImplementation((async (
      findBy: FindBy<TelemetryException>,
    ) => {
      if (
        "mergedIntoTelemetryExceptionId" in
        (findBy.query as Record<string, unknown>)
      ) {
        const merged: TelemetryException = new TelemetryException();
        merged.fingerprint = "fp-b";
        merged.mergedIntoTelemetryExceptionId = new ObjectID(SURVIVOR_ID);
        merged.mergedIntoTelemetryException = new TelemetryException();
        merged.mergedIntoTelemetryException.fingerprint = "fp-a";
        return [merged];
      }

      return [
        exceptionRow(LOOKALIKE_ID, "fp-a", "SyntaxError"),
        exceptionRow(SURVIVOR_ID, "fp-a", "TypeError"),
      ];
    }) as never);

    await post({ fingerprints: ["fp-b"] });

    expect(sent).toEqual([
      {
        exceptions: [
          {
            fingerprint: "fp-b",
            telemetryExceptionId: SURVIVOR_ID,
            exceptionType: "TypeError",
            message: "TypeError at fp-a",
          },
        ],
      },
    ]);
  });

  test("an empty list is answered with nothing, and reads nothing", async () => {
    const find: SpyInstance<
      typeof TelemetryExceptionService.findByOccurrenceFingerprints
    > = jest.spyOn(TelemetryExceptionService, "findByOccurrenceFingerprints");

    await post({ fingerprints: [] });

    expect(find).not.toHaveBeenCalled();
    expect(sent).toEqual([{ exceptions: [] }]);
  });

  test(`as many as ${MAX_EXCEPTION_FINGERPRINT_LOOKUP} fingerprints are taken at once`, async () => {
    const find: SpyInstance<
      typeof TelemetryExceptionService.findByOccurrenceFingerprints
    > = jest
      .spyOn(TelemetryExceptionService, "findByOccurrenceFingerprints")
      .mockResolvedValue(new Map());

    const next: NextFunction = await post({
      fingerprints: Array.from(
        { length: MAX_EXCEPTION_FINGERPRINT_LOOKUP },
        (_value: unknown, index: number): string => {
          return `fp-${index}`;
        },
      ),
    });

    expect(next).not.toHaveBeenCalled();
    expect(find.mock.calls[0]![0].fingerprints).toHaveLength(
      MAX_EXCEPTION_FINGERPRINT_LOOKUP,
    );
  });

  test.each([
    ["no list", {}],
    ["a list that is not one", { fingerprints: "fp-b" }],
    [
      "more fingerprints than one request takes",
      {
        fingerprints: Array.from(
          { length: MAX_EXCEPTION_FINGERPRINT_LOOKUP + 1 },
          (_value: unknown, index: number): string => {
            return `fp-${index}`;
          },
        ),
      },
    ],
    ["a fingerprint that is not text", { fingerprints: ["fp-b", 7] }],
    ["a blank fingerprint", { fingerprints: ["fp-b", "  "] }],
    [
      "a fingerprint longer than any",
      { fingerprints: ["f".repeat(MAX_EXCEPTION_FINGERPRINT_LENGTH + 1)] },
    ],
  ])(
    "%s is refused before anything is read",
    async (_name: string, body: unknown) => {
      const find: SpyInstance<
        typeof TelemetryExceptionService.findByOccurrenceFingerprints
      > = jest.spyOn(TelemetryExceptionService, "findByOccurrenceFingerprints");

      const next: NextFunction = await post(body);

      expect(refusal(next)).toBeInstanceOf(BadDataException);
      expect(find).not.toHaveBeenCalled();
      expect(sent).toHaveLength(0);
    },
  );

  test("a caller without a project is refused", async () => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue({ userId: ObjectID.generate() });
    const find: SpyInstance<
      typeof TelemetryExceptionService.findByOccurrenceFingerprints
    > = jest.spyOn(TelemetryExceptionService, "findByOccurrenceFingerprints");

    const next: NextFunction = await post({ fingerprints: ["fp-b"] });

    expect(refusal(next)).toBeInstanceOf(BadDataException);
    expect(find).not.toHaveBeenCalled();
  });

  test("a caller who may not read exceptions is refused, as the read refused them", async () => {
    jest
      .spyOn(TelemetryExceptionService, "findByOccurrenceFingerprints")
      .mockRejectedValue(
        new NotAuthorizedException("You do not have permission"),
      );

    const next: NextFunction = await post({ fingerprints: ["fp-b"] });

    expect(refusal(next)).toBeInstanceOf(NotAuthorizedException);
    expect(sent).toHaveLength(0);
  });
});
