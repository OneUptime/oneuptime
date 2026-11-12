import { mockRouter } from "./Helpers";
import CommonAPI from "../../../Server/API/CommonAPI";
import {
  USED_BY_API_PATH,
  readRecordIdParam,
  readRecordKindParam,
  readRelationParam,
} from "../../../Server/API/UsedByAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import UsedByService from "../../../Server/Services/UsedByService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { isErrorSentence } from "../../../Types/Exception/ErrorMessageRule";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  UsedByPage,
  UsedByRecordKind,
  UsedByRelation,
  UsedByRowKind,
  UsedBySummary,
} from "../../../Types/UsedBy/UsedBy";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * GET /used-by/:recordKind/:recordId and /:relation (#6813): a signed-in
 * member of the project asks; the service reads with their permissions;
 * the record kind, id and relation are checked before anything is read.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

const PROJECT: ObjectID = new ObjectID("68134444-0000-4000-8000-000000000001");
const MONITOR: ObjectID = new ObjectID("68134444-0000-4000-8000-000000000002");
const PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT,
  userId: new ObjectID("68134444-0000-4000-8000-0000000000a1"),
};

const SUMMARY: UsedBySummary = {
  recordKind: UsedByRecordKind.Monitor,
  recordId: MONITOR.toString(),
  groups: [
    {
      relation: UsedByRelation.MonitorStatusPages,
      rowKind: UsedByRowKind.StatusPage,
      count: 1,
      hiddenCount: 2,
      rows: [{ id: "s", name: "Public status" }],
    },
  ],
};

const PAGE: UsedByPage = {
  recordKind: UsedByRecordKind.Monitor,
  recordId: MONITOR.toString(),
  relation: UsedByRelation.MonitorStatusPages,
  rowKind: UsedByRowKind.StatusPage,
  count: 1,
  hiddenCount: 2,
  pageStart: 0,
  pageSize: 50,
  rows: [{ id: "s", name: "Public status" }],
};

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

const SUMMARY_ROUTE: string = `${USED_BY_API_PATH}/:recordKind/:recordId`;
const PAGE_ROUTE: string = `${USED_BY_API_PATH}/:recordKind/:recordId/:relation`;

async function call(data: {
  route: string;
  params?: JSONObject;
  query?: JSONObject;
}): Promise<{ thrown: unknown; sent: unknown }> {
  const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
    "GET",
    data.route,
  );

  let thrown: unknown = undefined;

  await (route.handlerFunction as RouterFunction)(
    {
      params: data.params || {},
      query: data.query || {},
      headers: {},
    } as unknown as ExpressRequest,
    {} as ExpressResponse,
    ((err: unknown) => {
      thrown = err;
    }) as NextFunction,
  );

  return {
    thrown: thrown,
    sent: (Response.sendJsonObjectResponse as unknown as jest.Mock).mock
      .calls[0]?.[2],
  };
}

let getSummary: jest.SpyInstance;
let getPage: jest.SpyInstance;

beforeEach(() => {
  jest.restoreAllMocks();
  (Response.sendJsonObjectResponse as unknown as jest.Mock).mockClear();
  (Response.setNoCacheHeaders as unknown as jest.Mock).mockClear();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(PROPS as never);
  jest
    .spyOn(CommonAPI, "assertAuthenticatedProjectMember")
    .mockReturnValue(PROJECT as never);
  getSummary = jest
    .spyOn(UsedByService, "getSummary")
    .mockResolvedValue(SUMMARY as never);
  getPage = jest
    .spyOn(UsedByService, "getPage")
    .mockResolvedValue(PAGE as never);
});

describe("GET /used-by/:recordKind/:recordId", () => {
  test("asks the signed-in member's middleware first, on both routes", () => {
    expect(mockRouter.match("GET", SUMMARY_ROUTE).middleware).toBe(
      UserMiddleware.getUserMiddleware,
    );
    expect(mockRouter.match("GET", PAGE_ROUTE).middleware).toBe(
      UserMiddleware.getUserMiddleware,
    );
  });

  test("hands back what refers to the record, read for the caller in the project they were let into", async () => {
    const { thrown, sent } = await call({
      route: SUMMARY_ROUTE,
      params: { recordKind: "monitor", recordId: MONITOR.toString() },
    });

    expect(thrown).toBeUndefined();
    expect(sent).toEqual(SUMMARY);
    expect(getSummary).toHaveBeenCalledWith({
      recordKind: UsedByRecordKind.Monitor,
      recordId: MONITOR,
      projectId: PROJECT,
      props: PROPS,
    });
    // Never cached: what refers to a record changes as people work.
    expect(Response.setNoCacheHeaders).toHaveBeenCalled();
  });

  test("a caller who is not a member of the project is refused before anything is read", async () => {
    jest
      .spyOn(CommonAPI, "assertAuthenticatedProjectMember")
      .mockImplementation(() => {
        throw new NotAuthorizedException("Not a member.");
      });

    const { thrown } = await call({
      route: SUMMARY_ROUTE,
      params: { recordKind: "monitor", recordId: MONITOR.toString() },
    });

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect(getSummary).not.toHaveBeenCalled();
  });

  test("a kind of record that shows no Used by is refused", async () => {
    const { thrown } = await call({
      route: SUMMARY_ROUTE,
      params: { recordKind: "incident", recordId: MONITOR.toString() },
    });

    expect(thrown).toBeInstanceOf(BadDataException);
    expect(getSummary).not.toHaveBeenCalled();
  });

  test("a record id that is not one is refused", async () => {
    const { thrown } = await call({
      route: SUMMARY_ROUTE,
      params: { recordKind: "monitor", recordId: "not-an-id" },
    });

    expect(thrown).toBeInstanceOf(BadDataException);
    expect(getSummary).not.toHaveBeenCalled();
  });

  test("a record the caller may not read is passed on as not found", async () => {
    getSummary.mockRejectedValue(
      new NotFoundException(
        "This record was not found in the project, or you may not read it. Check the link, or ask a project admin for access.",
      ),
    );

    const { thrown } = await call({
      route: SUMMARY_ROUTE,
      params: { recordKind: "monitor", recordId: MONITOR.toString() },
    });

    expect(thrown).toBeInstanceOf(NotFoundException);
  });
});

describe("GET /used-by/:recordKind/:recordId/:relation", () => {
  test("one relation's page, with the skip and limit asked for", async () => {
    const { thrown, sent } = await call({
      route: PAGE_ROUTE,
      params: {
        recordKind: "monitor",
        recordId: MONITOR.toString(),
        relation: "MonitorStatusPages",
      },
      query: { skip: "50", limit: "50" },
    });

    expect(thrown).toBeUndefined();
    expect(sent).toEqual(PAGE);
    expect(getPage).toHaveBeenCalledWith({
      recordKind: UsedByRecordKind.Monitor,
      recordId: MONITOR,
      relation: UsedByRelation.MonitorStatusPages,
      projectId: PROJECT,
      props: PROPS,
      skip: "50",
      limit: "50",
    });
  });

  test("a relation that is not one is refused", async () => {
    const { thrown } = await call({
      route: PAGE_ROUTE,
      params: {
        recordKind: "monitor",
        recordId: MONITOR.toString(),
        relation: "Subscribers",
      },
    });

    expect(thrown).toBeInstanceOf(BadDataException);
    expect(getPage).not.toHaveBeenCalled();
  });
});

describe("reading the request", () => {
  test("the kind, the id and the relation, trimmed", () => {
    const req: ExpressRequest = {
      params: {
        recordKind: " team ",
        recordId: ` ${MONITOR.toString()} `,
        relation: " TeamOwnedMonitors ",
      },
    } as unknown as ExpressRequest;

    expect(readRecordKindParam(req)).toBe(UsedByRecordKind.Team);
    expect(readRecordIdParam(req).toString()).toBe(MONITOR.toString());
    expect(readRelationParam(req)).toBe(UsedByRelation.TeamOwnedMonitors);
  });

  test("each refusal is a sentence that says what to do", () => {
    const empty: ExpressRequest = { params: {} } as unknown as ExpressRequest;

    for (const read of [
      readRecordKindParam,
      readRecordIdParam,
      readRelationParam,
    ]) {
      let message: string = "";

      try {
        read(empty);
      } catch (err) {
        message = (err as Error).message;
      }

      expect(message).not.toBe("");
      expect(isErrorSentence(message)).toBe(true);
    }
  });
});
