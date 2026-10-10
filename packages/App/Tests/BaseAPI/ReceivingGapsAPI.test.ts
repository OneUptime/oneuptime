import { mockRouter } from "Common/Tests/Server/API/Helpers";
import CommonAPI from "Common/Server/API/CommonAPI";
import CallerPermission from "Common/Server/Utils/Permission/CallerPermission";
import Response from "Common/Server/Utils/Response";
import ReceivingCoverage from "Common/Server/Utils/Telemetry/ReceivingCoverage";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  ReceivingGap,
  ReceivingGapReason,
} from "Common/Utils/Telemetry/ReceivingGaps";
import Metric from "Common/Models/AnalyticsModels/Metric";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";
import fs from "fs";
import path from "path";

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: jest.fn(),
    },
  };
});

/*
 * Contract under test - POST /receiving-gaps (issue #2825).
 *
 * The availability charts ask when OneUptime itself was not receiving data
 * for the window they show, to draw that time as "not monitored" instead of
 * "down". What the endpoint owns: who may ask (signed in, in a project,
 * allowed to read its metrics), that every input is validated rather than
 * guessed, and that the answer is the gaps ReceivingCoverage reports for
 * exactly the window asked about.
 */

// Importing the module registers its route on the mocked router.
import ReceivingGapsAPI from "../../FeatureSet/BaseAPI/API/ReceivingGaps";

new ReceivingGapsAPI().getRouter();

const ROUTE: string = "/receiving-gaps";
const PROJECT_ID: ObjectID = ObjectID.generate();

const STARTS_AT: string = "2026-10-09T10:00:00.000Z";
const ENDS_AT: string = "2026-10-09T12:00:00.000Z";

const responseUtil: { sendJsonObjectResponse: Mock } = Response as unknown as {
  sendJsonObjectResponse: Mock;
};

function mockProps(
  extra: Partial<DatabaseCommonInteractionProps> & {
    tenantId?: ObjectID | undefined;
  } = { tenantId: PROJECT_ID },
): DatabaseCommonInteractionProps {
  const props: DatabaseCommonInteractionProps = {
    userId: ObjectID.generate(),
    ...extra,
  } as unknown as DatabaseCommonInteractionProps;

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(props);

  return props;
}

async function callRoute(body: JSONObject): Promise<NextFunction> {
  const next: NextFunction = jest.fn() as unknown as NextFunction;

  const req: ExpressRequest = {
    params: {},
    body,
  } as unknown as ExpressRequest;

  await mockRouter
    .match("post", ROUTE)
    .handlerFunction(req, {} as ExpressResponse, next);

  return next;
}

function errorFrom(next: NextFunction): Error {
  const calls: Array<Array<unknown>> = (next as unknown as Mock).mock
    .calls as Array<Array<unknown>>;
  expect(calls).toHaveLength(1);
  return calls[0]![0] as Error;
}

const GAPS: Array<ReceivingGap> = [
  {
    startsAt: new Date("2026-10-09T10:40:00.000Z"),
    endsAt: new Date("2026-10-09T10:52:00.000Z"),
    reason: ReceivingGapReason.NotReceiving,
  },
  {
    startsAt: new Date("2026-10-09T10:52:00.000Z"),
    endsAt: new Date("2026-10-09T10:54:00.000Z"),
    reason: ReceivingGapReason.Reconnecting,
  },
];

describe("ReceivingGapsAPI", () => {
  let getGaps: SpyInstance<typeof ReceivingCoverage.getGaps>;
  let holdsPermission: SpyInstance<
    typeof CallerPermission.holdsModelPermission
  >;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    getGaps = jest.spyOn(ReceivingCoverage, "getGaps").mockResolvedValue(GAPS);
    holdsPermission = jest
      .spyOn(CallerPermission, "holdsModelPermission")
      .mockReturnValue(true);
  });

  test("answers the gaps for exactly the window asked about", async () => {
    mockProps();

    const next: NextFunction = await callRoute({
      startsAt: STARTS_AT,
      endsAt: ENDS_AT,
    });

    expect(next).not.toHaveBeenCalled();
    expect(getGaps).toHaveBeenCalledWith({
      startsAt: new Date(STARTS_AT),
      endsAt: new Date(ENDS_AT),
    });
    expect(responseUtil.sendJsonObjectResponse.mock.calls[0]![2]).toEqual({
      gaps: [
        {
          startsAt: "2026-10-09T10:40:00.000Z",
          endsAt: "2026-10-09T10:52:00.000Z",
          reason: "NotReceiving",
        },
        {
          startsAt: "2026-10-09T10:52:00.000Z",
          endsAt: "2026-10-09T10:54:00.000Z",
          reason: "Reconnecting",
        },
      ],
    });
  });

  test("an empty answer when OneUptime was receiving throughout", async () => {
    mockProps();
    getGaps.mockResolvedValue([]);

    await callRoute({ startsAt: STARTS_AT, endsAt: ENDS_AT });

    expect(responseUtil.sendJsonObjectResponse.mock.calls[0]![2]).toEqual({
      gaps: [],
    });
  });

  test("dates may arrive as epoch milliseconds", async () => {
    mockProps();

    await callRoute({
      startsAt: Date.parse(STARTS_AT),
      endsAt: Date.parse(ENDS_AT),
    });

    expect(getGaps).toHaveBeenCalledWith({
      startsAt: new Date(STARTS_AT),
      endsAt: new Date(ENDS_AT),
    });
  });

  test("is only answered within a project", async () => {
    mockProps({ tenantId: undefined });

    const next: NextFunction = await callRoute({
      startsAt: STARTS_AT,
      endsAt: ENDS_AT,
    });

    expect(errorFrom(next)).toBeInstanceOf(BadDataException);
    expect(getGaps).not.toHaveBeenCalled();
  });

  test("is only answered to someone who may read the project's metrics", async () => {
    const props: DatabaseCommonInteractionProps = mockProps();
    holdsPermission.mockReturnValue(false);

    const next: NextFunction = await callRoute({
      startsAt: STARTS_AT,
      endsAt: ENDS_AT,
    });

    expect(errorFrom(next)).toBeInstanceOf(NotAuthorizedException);
    expect(getGaps).not.toHaveBeenCalled();
    expect(holdsPermission.mock.calls[0]![0]).toBe(props);
    expect(holdsPermission.mock.calls[0]![1].operation).toBe("read");
    expect(holdsPermission.mock.calls[0]![1].model).toBeInstanceOf(Metric);
  });

  test("a master admin is answered without a project permission check", async () => {
    mockProps({ tenantId: PROJECT_ID, isMasterAdmin: true });
    holdsPermission.mockReturnValue(false);

    const next: NextFunction = await callRoute({
      startsAt: STARTS_AT,
      endsAt: ENDS_AT,
    });

    expect(next).not.toHaveBeenCalled();
    expect(holdsPermission).not.toHaveBeenCalled();
  });

  test.each([
    ["no startsAt", { endsAt: ENDS_AT }],
    ["no endsAt", { startsAt: STARTS_AT }],
    ["an unreadable startsAt", { startsAt: "yesterday", endsAt: ENDS_AT }],
    ["an object for a date", { startsAt: { at: 1 }, endsAt: ENDS_AT }],
    ["an end before the start", { startsAt: ENDS_AT, endsAt: STARTS_AT }],
    ["an empty window", { startsAt: STARTS_AT, endsAt: STARTS_AT }],
    [
      "a window longer than 400 days",
      {
        startsAt: "2025-01-01T00:00:00.000Z",
        endsAt: "2026-10-09T00:00:00.000Z",
      },
    ],
  ])("refuses %s", async (_name: string, body: JSONObject) => {
    mockProps();

    const next: NextFunction = await callRoute(body);

    expect(errorFrom(next)).toBeInstanceOf(BadDataException);
    expect(getGaps).not.toHaveBeenCalled();
  });
});

describe("ReceivingGapsAPI registration", () => {
  test("BaseAPI mounts the router under the API prefix, once", () => {
    const index: string = fs
      .readFileSync(
        path.join(__dirname, "../../FeatureSet/BaseAPI/Index.ts"),
        "utf8",
      )
      .replace(/\s+/g, "");

    expect(
      index.split('importReceivingGapsAPIfrom"./API/ReceivingGaps";').length -
        1,
    ).toBe(1);
    expect(
      index.split(
        "app.use(`/${APP_NAME.toLocaleLowerCase()}`,newReceivingGapsAPI().getRouter(),);",
      ).length - 1,
    ).toBe(1);
  });
});
