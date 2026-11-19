import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import MonitorStatusService, {
  Service as MonitorStatusServiceType,
} from "../../../Server/Services/MonitorStatusService";
import NetworkDeviceDiscoveryScanService, {
  Service as NetworkDeviceDiscoveryScanServiceType,
} from "../../../Server/Services/NetworkDeviceDiscoveryScanService";
import StatusPageGroupService, {
  Service as StatusPageGroupServiceType,
} from "../../../Server/Services/StatusPageGroupService";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import ServerProducts from "../../../Server/Utils/ServerProducts/ServerProducts";
import { mockRouter } from "./Helpers";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import NetworkDeviceDiscoveryScan from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import MoveInListUtil, {
  NUMBERED_LIST_TABLES,
} from "../../../Types/Database/MoveInList";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

jest.mock("../../../Server/Utils/Logger");

/*
 * POST /<an ordered list's path>/:id/move (issues #9573, #9609): a row of an
 * ordered list moved to the place of the row named, the rows between
 * stepping aside. What the Dashboard's drag and Move up / Move down send,
 * now that a write of a list's number places the row alone (what Terraform
 * needs).
 *
 * Every table whose rows make up such lists answers it beside its CRUD
 * routes (BaseAPI): the five numbered lists (status page groups here) and
 * every drag-ordered list (@ListOrderColumn: monitor statuses here). It sits
 * behind a signed-in caller (a person or an API key), refuses a record of a
 * product switched off on the server first thing, must name the project in
 * the tenant header, reads the body before anything is asked of the
 * database, hands the move to the service as the caller, and answers the
 * rows given another number under the list's own number column. Every
 * refusal is the answer. A table that is no list has no such route.
 * ContiguousOrder, ListOrderMoves and ContiguousOrderWrites cover the move
 * itself.
 */

const GROUP_PATH: string = "/status-page-group/:id/move";
const STATUS_PATH: string = "/monitor-status/:id/move";

const PROJECT_ID: ObjectID = new ObjectID(
  "95730000-0000-4000-8000-000000000001",
);
const ROW_ID: string = "95730000-0000-4000-8000-0000000000a3";
const PLACE_OF_ID: string = "95730000-0000-4000-8000-0000000000a1";
const USER_ID: string = "95730000-0000-4000-8000-0000000000f1";

type ModelType = { new (): BaseModel };

describe("the move of an ordered list's row", () => {
  let request: OneUptimeRequest;
  let response: OneUptimeResponse;
  let next: jest.Mock;
  let props: DatabaseCommonInteractionProps;
  let moveGroup: jest.SpyInstance;
  let moveStatus: jest.SpyInstance;
  let productIsOn: jest.SpyInstance;

  async function post(
    uri: string,
    body: unknown,
    rowId: string = ROW_ID,
  ): Promise<void> {
    request.body = body;
    request.params = { id: rowId };

    await mockRouter
      .match("post", uri)
      .handlerFunction(request, response, next as unknown as NextFunction);
  }

  function refusal(): Error {
    expect(next).toHaveBeenCalledTimes(1);
    return next.mock.calls[0]![0] as Error;
  }

  function routeAt(uri: string): { middlewares: Array<unknown> } | undefined {
    return mockRouter.routes.find(
      (candidate: { method: string; uri: string }): boolean => {
        return candidate.method === "POST" && candidate.uri === uri;
      },
    ) as { middlewares: Array<unknown> } | undefined;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockRouter.routes.length = 0;

    new BaseAPI<StatusPageGroup, StatusPageGroupServiceType>(
      StatusPageGroup,
      StatusPageGroupService,
    );
    new BaseAPI<MonitorStatus, MonitorStatusServiceType>(
      MonitorStatus,
      MonitorStatusService,
    );
    new BaseAPI<
      NetworkDeviceDiscoveryScan,
      NetworkDeviceDiscoveryScanServiceType
    >(NetworkDeviceDiscoveryScan, NetworkDeviceDiscoveryScanService);

    props = {
      tenantId: PROJECT_ID,
      userId: new ObjectID(USER_ID),
      userType: UserType.User,
    };

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockImplementation(async () => {
        return props;
      });

    productIsOn = jest
      .spyOn(ServerProducts, "assertRecordTableIsOn")
      .mockResolvedValue(undefined as never);

    moveGroup = jest
      .spyOn(StatusPageGroupService, "moveInList")
      .mockResolvedValue({
        changedRows: [
          { id: ROW_ID, order: 1 },
          { id: PLACE_OF_ID, order: 2 },
        ],
      } as never);

    moveStatus = jest
      .spyOn(MonitorStatusService, "moveInList")
      .mockResolvedValue({
        changedRows: [
          { id: ROW_ID, order: 2 },
          { id: PLACE_OF_ID, order: 3 },
        ],
      } as never);

    request = { headers: {}, params: {} } as unknown as OneUptimeRequest;
    response = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as OneUptimeResponse;
    next = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([GROUP_PATH, STATUS_PATH])(
    "%s sits under the table's own path, behind a signed-in caller",
    (uri: string) => {
      const route: { middlewares: Array<unknown> } | undefined = routeAt(uri);

      expect(route).toBeDefined();
      expect(route!.middlewares).toEqual([
        UserMiddleware.getUserMiddleware,
        UserMiddleware.requireUserAuthentication,
      ]);
    },
  );

  it("is no route of a table that is no list", () => {
    expect(routeAt("/network-device-discovery-scan/:id/move")).toBeUndefined();
    // Its CRUD routes are there as ever.
    expect(routeAt("/network-device-discovery-scan/get-list")).toBeDefined();
  });

  it("keeps the table's own routes - list, read, create, edit, delete", () => {
    const uris: Array<string> = mockRouter.routes.map(
      (route: { method: string; uri: string }): string => {
        return `${route.method} ${route.uri}`;
      },
    );

    for (const table of ["status-page-group", "monitor-status"]) {
      expect(uris).toContain(`POST /${table}/get-list`);
      expect(uris).toContain(`POST /${table}`);
      expect(uris).toContain(`PUT /${table}/:id`);
      expect(uris).toContain(`DELETE /${table}/:id`);
    }
  });

  it("hands a numbered list's move to its service, as the caller, and answers the rows given another number", async () => {
    await post(GROUP_PATH, { placeOfId: PLACE_OF_ID });

    expect(moveGroup).toHaveBeenCalledTimes(1);

    const asked: {
      id: ObjectID;
      placeOfId: ObjectID;
      props: DatabaseCommonInteractionProps;
    } = moveGroup.mock.calls[0]![0] as {
      id: ObjectID;
      placeOfId: ObjectID;
      props: DatabaseCommonInteractionProps;
    };

    expect(asked.id.toString()).toBe(ROW_ID);
    expect(asked.placeOfId.toString()).toBe(PLACE_OF_ID);
    expect(asked.props).toBe(props);

    expect(Response.setNoCacheHeaders).toHaveBeenCalledWith(response);
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
      request,
      response,
      {
        changedRows: [
          { _id: ROW_ID, order: 1 },
          { _id: PLACE_OF_ID, order: 2 },
        ],
      },
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("answers a drag-ordered list's rows under its own number column", async () => {
    await post(STATUS_PATH, { placeOfId: PLACE_OF_ID });

    expect(moveStatus).toHaveBeenCalledWith(
      expect.objectContaining({ props: props }),
    );
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
      request,
      response,
      {
        changedRows: [
          { _id: ROW_ID, priority: 2 },
          { _id: PLACE_OF_ID, priority: 3 },
        ],
      },
    );
  });

  it("asks whether the table's product is on first, for this table", async () => {
    await post(GROUP_PATH, { placeOfId: PLACE_OF_ID });
    await post(STATUS_PATH, { placeOfId: PLACE_OF_ID });

    expect(productIsOn).toHaveBeenCalledWith("StatusPageGroup");
    expect(productIsOn).toHaveBeenCalledWith("MonitorStatus");
  });

  it("a product switched off on the server is refused before anything is read", async () => {
    productIsOn.mockRejectedValue(
      new BadDataException("Status Pages is switched off.") as never,
    );

    await post(GROUP_PATH, { placeOfId: PLACE_OF_ID });

    expect(moveGroup).not.toHaveBeenCalled();
    expect(refusal().message).toBe("Status Pages is switched off.");
  });

  it("an API key moves as itself", async () => {
    props = {
      tenantId: PROJECT_ID,
      apiKeyId: ObjectID.generate(),
      userType: UserType.API,
    };

    await post(STATUS_PATH, { placeOfId: PLACE_OF_ID });

    expect(moveStatus).toHaveBeenCalledWith(
      expect.objectContaining({ props: props }),
    );
  });

  it("a request that names no project is refused before anything is read", async () => {
    delete props.tenantId;

    await post(STATUS_PATH, { placeOfId: PLACE_OF_ID });

    expect(moveStatus).not.toHaveBeenCalled();
    expect(refusal().message).toBe(
      "Project ID is required. Please pass the project ID in the 'tenantid' header.",
    );
  });

  it("a row id that is no id is refused before anything is read", async () => {
    await post(GROUP_PATH, { placeOfId: PLACE_OF_ID }, "not-a-group");

    expect(moveGroup).not.toHaveBeenCalled();
    expect(refusal()).toBeInstanceOf(BadDataException);
  });

  it.each([
    ["no body", undefined],
    ["no placeOfId", {}],
    ["a placeOfId that is no id", { placeOfId: "the top" }],
    ["the place as a number", { priority: 1 }],
  ] as Array<[string, unknown]>)(
    "a body with %s is refused, saying what to send, before anything is read",
    async (_label: string, body: unknown) => {
      await post(STATUS_PATH, body);

      expect(moveStatus).not.toHaveBeenCalled();

      const error: Error = refusal();

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toContain('{ "placeOfId": "<id>" }');
    },
  );

  it("a move the caller may not make is the answer", async () => {
    moveStatus.mockRejectedValue(
      new NotAuthorizedException(
        "You do not have permissions to update Monitor Status.",
      ) as never,
    );

    await post(STATUS_PATH, { placeOfId: PLACE_OF_ID });

    expect(refusal()).toBeInstanceOf(NotAuthorizedException);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});

/*
 * Every table whose rows make up ordered lists is served by BaseAPI, or an
 * API that extends it (App's BaseAPI feature set), so each answers the move
 * beside its CRUD routes: the Dashboard moves the rows one at a time, and an
 * API caller can move any of them.
 */
describe("the ordered lists' APIs", () => {
  const index: string = fs.readFileSync(
    path.join(__dirname, "../../../../App/FeatureSet/BaseAPI/Index.ts"),
    "utf-8",
  );
  // The file with no white space, so each registration reads one way.
  const compact: string = index.replace(/\s+/g, "");

  const listTables: Array<string> = (
    AllModelTypes as unknown as Array<ModelType>
  )
    .filter((modelType: ModelType): boolean => {
      return Boolean(MoveInListUtil.getListColumn(new modelType()));
    })
    .map((modelType: ModelType): string => {
      return modelType.name;
    })
    .sort();

  it("are the five numbered lists and every drag-ordered list", () => {
    for (const table of NUMBERED_LIST_TABLES) {
      expect(listTables).toContain(table);
    }

    expect(listTables.length).toBe(NUMBERED_LIST_TABLES.length + 39);
  });

  it.each(listTables)(
    "serve %s with an API that answers the move",
    (model: string) => {
      const servedBy: Array<string> = [
        "BaseAPI",
        "ArchivableValueAPI",
        "CustomFieldDefinitionAPI",
      ].filter((api: string): boolean => {
        return compact.includes(`new${api}<${model},${model}ServiceType>`);
      });

      expect({ model, servedBy }).toEqual({
        model,
        servedBy: [expect.any(String)],
      });
    },
  );

  it("no longer have an API of their own for the move", () => {
    expect(index).not.toContain("MoveInListAPI");
  });
});
