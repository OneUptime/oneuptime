import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * REPEAT OFFENDERS ON A CASE (#10354), through the route the case's block
 * step reads:
 *
 *   POST /security-block/repeat-offenders  { values, securityCaseId }
 *
 * "Blocked twice before, last on 12 Nov (case CASE-812)" counts the blocks
 * of the address - or of a range around it - in the 30 days before the
 * case opened, never the case's own, and the block offered is the ladder's
 * next step (#10350's, shared). An address blocked never before is left
 * out of the answer. Whoever reads the Blocklist may ask; a case they may
 * not read is not found. Refused while Security Events is switched off,
 * as the Blocklist's other routes are.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger");

import CommonAPI from "../../../Server/API/CommonAPI";
import SecurityBlockAPI, {
  SECURITY_BLOCK_REPEAT_OFFENDERS_ROUTE,
} from "../../../Server/API/SecurityBlockAPI";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import SecurityRepeatOffenders from "../../../Server/Utils/SecurityAutomaticResponse/SecurityRepeatOffenders";
import ServerProductRoutes from "../../../Server/Utils/ServerProducts/ServerProductRoutes";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Exception from "../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  SecurityRepeatOffenderBlock,
  SecurityRepeatOffenderSummary,
  readSecurityRepeatOffenderSummary,
} from "../../../Types/SecurityAutomaticResponse/SecurityRepeatOffenders";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
  SecurityBlockSource,
  SecurityBlockState,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import { customDomainCaller } from "./CustomDomainCallers";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { everyServerProductIsOn } from "../TestingUtils/ServerProductsOn";
import { getJestSpyOn } from "../../Spy";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "10354000-0000-4000-8000-0000000000c1",
);
const CASE_ID: string = "10354000-0000-4000-8000-0000000000c2";
const CASE_OPENED: Date = new Date("2026-11-20T10:00:00.000Z");

const sendJsonObjectResponseMock: MockedFn =
  Response.sendJsonObjectResponse as unknown as MockedFn;

let props: DatabaseCommonInteractionProps;

function caller(permission: Permission): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: [permission], projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

function block(
  overrides: Partial<SecurityRepeatOffenderBlock>,
): SecurityRepeatOffenderBlock {
  return {
    securityBlockId: ObjectID.generate().toString(),
    value: "35.205.11.131",
    action: SecurityBlockAction.Block,
    source: SecurityBlockSource.Person,
    state: SecurityBlockState.Expired,
    createdAt: new Date("2026-11-12T09:00:00.000Z"),
    securityCaseId: "case-812",
    caseNumber: "CASE-812",
    ...overrides,
  };
}

async function call(body: JSONObject): Promise<{ refusal: Exception | null }> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    headers: {},
    body,
  } as unknown as ExpressRequest;
  const res: ExpressResponse = {
    setHeader: jest.fn(),
  } as unknown as ExpressResponse;
  const next: MockedFn = jest.fn();

  await mockRouter
    .match("post", SECURITY_BLOCK_REPEAT_OFFENDERS_ROUTE)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    refusal: (next.mock.calls[0]?.[0] as Exception | undefined) || null,
  };
}

function offenders(): Array<SecurityRepeatOffenderSummary> {
  const calls: Array<Array<unknown>> = sendJsonObjectResponseMock.mock.calls;
  const answer: JSONObject = calls[calls.length - 1]![2] as JSONObject;

  return (answer["offenders"] as Array<JSONObject>).map(
    (json: JSONObject): SecurityRepeatOffenderSummary => {
      return readSecurityRepeatOffenderSummary(
        JSON.parse(JSON.stringify(json)),
      )!;
    },
  );
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new SecurityBlockAPI();
});

beforeEach(() => {
  jest.clearAllMocks();
  everyServerProductIsOn();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });

  const securityCase: SecurityCase = new SecurityCase();
  securityCase.id = new ObjectID(CASE_ID);
  securityCase.createdAt = CASE_OPENED;
  getJestSpyOn(SecurityCaseService, "findOneBy").mockResolvedValue(
    securityCase as never,
  );

  // Every block of 35.205.11.131: two before the case opened, the case's own, one since.
  getJestSpyOn(SecurityRepeatOffenders, "read").mockImplementation(
    (async (data: { value: string }) => {
      const blocks: Array<SecurityRepeatOffenderBlock> =
        data.value === "35.205.11.131"
          ? [
              block({
                securityBlockId: "since",
                createdAt: new Date("2026-11-21T09:00:00.000Z"),
                securityCaseId: "case-900",
              }),
              block({
                securityBlockId: "own",
                createdAt: new Date("2026-11-20T09:30:00.000Z"),
                securityCaseId: CASE_ID,
              }),
              block({
                securityBlockId: "twelfth",
                createdAt: new Date("2026-11-12T09:00:00.000Z"),
              }),
              block({
                securityBlockId: "range",
                value: "35.205.11.0/24",
                action: SecurityBlockAction.Challenge,
                createdAt: new Date("2026-11-05T09:00:00.000Z"),
                securityCaseId: null,
                caseNumber: null,
              }),
            ]
          : [];

      return {
        value: data.value,
        since: new Date("2026-10-21T10:00:00.000Z"),
        blocks,
        offenceCount: blocks.length,
        last: blocks[0] || null,
      };
    }) as never,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /security-block/repeat-offenders", () => {
  test("a case's address blocked twice before it opened: when, by which case, and 7 days next", async () => {
    props = caller(Permission.SecurityViewer);

    const { refusal } = await call({
      values: ["35.205.11.131", "198.51.100.7"],
      securityCaseId: CASE_ID,
    });

    expect(refusal).toBeNull();

    const [offender, ...rest] = offenders();

    // Only the address blocked before: one blocked never before is no offender.
    expect(rest).toEqual([]);
    expect(offender!.value).toBe("35.205.11.131");
    // Its own block and the one since the case opened are not "before".
    expect(offender!.offenceCount).toBe(2);
    expect(offender!.last?.caseNumber).toBe("CASE-812");
    expect(offender!.last?.createdAt.toISOString()).toBe(
      "2026-11-12T09:00:00.000Z",
    );
    expect(offender!.suggestedDuration).toBe(SecurityBlockDuration.SevenDays);

    // Read from the case's opening.
    expect(
      (
        (SecurityRepeatOffenders.read as unknown as MockedFn).mock
          .calls[0]![0] as { now: Date }
      ).now,
    ).toEqual(CASE_OPENED);
  });

  test("without a case, the record is read up to now, and every block counts", async () => {
    props = caller(Permission.SecurityViewer);

    await call({ values: ["35.205.11.131"] });

    expect(offenders()[0]!.offenceCount).toBe(4);
  });

  test("only addresses and ranges are asked about, each once, at most 50", async () => {
    props = caller(Permission.SecurityViewer);
    const values: Array<string> = ["AS14061", "evil.example", "35.205.11.131"];

    for (let index: number = 0; index < 60; index++) {
      values.push(`198.51.100.${index}`);
    }

    await call({ values: [...values, "35.205.11.131"] });

    const asked: Array<string> = (
      SecurityRepeatOffenders.read as unknown as MockedFn
    ).mock.calls.map((call: Array<unknown>): string => {
      return (call[0] as { value: string }).value;
    });

    expect(asked[0]).toBe("35.205.11.131");
    expect(asked).toHaveLength(50);
    expect(asked).not.toContain("AS14061");
  });

  test("a case the person may not read is not found", async () => {
    props = caller(Permission.SecurityViewer);
    getJestSpyOn(SecurityCaseService, "findOneBy").mockResolvedValue(
      null as never,
    );

    const { refusal } = await call({
      values: ["35.205.11.131"],
      securityCaseId: CASE_ID,
    });

    expect(refusal?.message).toBe("Security case not found.");
  });

  test("a member with no Security role may not read it", async () => {
    props = caller(Permission.ProjectMember);

    const { refusal } = await call({ values: ["35.205.11.131"] });

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
  });

  test("it is refused while Security Events is switched off, as the Blocklist's routes are", () => {
    expect(
      mockRouter
        .match("post", SECURITY_BLOCK_REPEAT_OFFENDERS_ROUTE)
        .middlewares.some(ServerProductRoutes.isRefusal),
    ).toBe(true);
  });
});
