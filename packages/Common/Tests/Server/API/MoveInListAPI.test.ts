import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import MoveInListAPI from "../../../Server/API/MoveInListAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
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
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
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
 * POST /<a numbered list's path>/:id/move (issue #9573): a row of a
 * numbered list - a status page's groups here - moved to the place of the
 * row named, the rows between stepping aside. What the Dashboard's drag and
 * Move up / Move down send, now that a write of `order` places the row
 * alone (what Terraform needs).
 *
 * The route sits beside the table's CRUD routes, behind a signed-in caller
 * (a person or an API key), refuses a record of a product switched off on
 * the server first thing, must name the project in the tenant header,
 * reads the body before anything is asked of the database, hands the move
 * to the service as the caller, and answers the rows given another number.
 * Every refusal is the answer. ContiguousOrder and ContiguousOrderWrites
 * cover the move itself.
 */

const PATH: string = "/status-page-group/:id/move";

const PROJECT_ID: ObjectID = new ObjectID(
  "95730000-0000-4000-8000-000000000001",
);
const GROUP_ID: string = "95730000-0000-4000-8000-0000000000a3";
const PLACE_OF_ID: string = "95730000-0000-4000-8000-0000000000a1";
const USER_ID: string = "95730000-0000-4000-8000-0000000000f1";

describe("POST /status-page-group/:id/move", () => {
  let request: OneUptimeRequest;
  let response: OneUptimeResponse;
  let next: jest.Mock;
  let props: DatabaseCommonInteractionProps;
  let moveInList: jest.SpyInstance;
  let productIsOn: jest.SpyInstance;

  async function post(
    body: unknown,
    groupId: string = GROUP_ID,
  ): Promise<void> {
    request.body = body;
    request.params = { id: groupId };

    await mockRouter
      .match("post", PATH)
      .handlerFunction(request, response, next as unknown as NextFunction);
  }

  function refusal(): Error {
    expect(next).toHaveBeenCalledTimes(1);
    return next.mock.calls[0]![0] as Error;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockRouter.routes.length = 0;

    new MoveInListAPI<StatusPageGroup, StatusPageGroupServiceType>(
      StatusPageGroup,
      StatusPageGroupService,
    );

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

    moveInList = jest
      .spyOn(StatusPageGroupService, "moveInList")
      .mockResolvedValue({
        changedRows: [
          { id: GROUP_ID, order: 1 },
          { id: PLACE_OF_ID, order: 2 },
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

  it("sits under the table's own path, behind a signed-in caller", () => {
    const route: { middlewares: Array<unknown> } | undefined =
      mockRouter.routes.find(
        (candidate: { method: string; uri: string }): boolean => {
          return candidate.method === "POST" && candidate.uri === PATH;
        },
      ) as { middlewares: Array<unknown> } | undefined;

    expect(route).toBeDefined();
    expect(route!.middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
    ]);
  });

  it("keeps the table's own routes - list, read, create, edit, delete", () => {
    const uris: Array<string> = mockRouter.routes.map(
      (route: { method: string; uri: string }): string => {
        return `${route.method} ${route.uri}`;
      },
    );

    expect(uris).toContain("POST /status-page-group/get-list");
    expect(uris).toContain("POST /status-page-group");
    expect(uris).toContain("PUT /status-page-group/:id");
    expect(uris).toContain("DELETE /status-page-group/:id");
  });

  it("hands the move to the service, as the caller, and answers the rows given another number", async () => {
    await post({ placeOfId: PLACE_OF_ID });

    expect(moveInList).toHaveBeenCalledTimes(1);

    const asked: {
      id: ObjectID;
      placeOfId: ObjectID;
      props: DatabaseCommonInteractionProps;
    } = moveInList.mock.calls[0]![0] as {
      id: ObjectID;
      placeOfId: ObjectID;
      props: DatabaseCommonInteractionProps;
    };

    expect(asked.id.toString()).toBe(GROUP_ID);
    expect(asked.placeOfId.toString()).toBe(PLACE_OF_ID);
    expect(asked.props).toBe(props);

    expect(Response.setNoCacheHeaders).toHaveBeenCalledWith(response);
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
      request,
      response,
      {
        changedRows: [
          { _id: GROUP_ID, order: 1 },
          { _id: PLACE_OF_ID, order: 2 },
        ],
      },
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("asks whether the table's product is on first, for this table", async () => {
    await post({ placeOfId: PLACE_OF_ID });

    expect(productIsOn).toHaveBeenCalledWith("StatusPageGroup");
  });

  it("a product switched off on the server is refused before anything is read", async () => {
    productIsOn.mockRejectedValue(
      new BadDataException("Status Pages is switched off.") as never,
    );

    await post({ placeOfId: PLACE_OF_ID });

    expect(moveInList).not.toHaveBeenCalled();
    expect(refusal().message).toBe("Status Pages is switched off.");
  });

  it("an API key moves as itself", async () => {
    props = {
      tenantId: PROJECT_ID,
      apiKeyId: ObjectID.generate(),
      userType: UserType.API,
    };

    await post({ placeOfId: PLACE_OF_ID });

    expect(moveInList).toHaveBeenCalledWith(
      expect.objectContaining({ props: props }),
    );
  });

  it("a request that names no project is refused before anything is read", async () => {
    delete props.tenantId;

    await post({ placeOfId: PLACE_OF_ID });

    expect(moveInList).not.toHaveBeenCalled();
    expect(refusal().message).toBe(
      "Project ID is required. Please pass the project ID in the 'tenantid' header.",
    );
  });

  it("a row id that is no id is refused before anything is read", async () => {
    await post({ placeOfId: PLACE_OF_ID }, "not-a-group");

    expect(moveInList).not.toHaveBeenCalled();
    expect(refusal()).toBeInstanceOf(BadDataException);
  });

  it.each([
    ["no body", undefined],
    ["no placeOfId", {}],
    ["a placeOfId that is no id", { placeOfId: "the top" }],
    ["the place as an order", { order: 1 }],
  ] as Array<[string, unknown]>)(
    "a body with %s is refused, saying what to send, before anything is read",
    async (_label: string, body: unknown) => {
      await post(body);

      expect(moveInList).not.toHaveBeenCalled();

      const error: Error = refusal();

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toContain('{ "placeOfId": "<id>" }');
    },
  );

  it("a move the caller may not make is the answer", async () => {
    moveInList.mockRejectedValue(
      new NotAuthorizedException(
        "You do not have permissions to update Status Page Group.",
      ) as never,
    );

    await post({ placeOfId: PLACE_OF_ID });

    expect(refusal()).toBeInstanceOf(NotAuthorizedException);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});

/*
 * The five numbered lists are served by MoveInListAPI, each beside its own
 * CRUD routes (App's BaseAPI feature set): the Dashboard moves status page
 * groups and resources and escalation rules one row at a time, and an API
 * caller can move any of the five.
 */
describe("the numbered lists' APIs", () => {
  const index: string = fs.readFileSync(
    path.join(__dirname, "../../../../App/FeatureSet/BaseAPI/Index.ts"),
    "utf-8",
  );
  // The file with no white space, so each registration reads one way.
  const compact: string = index.replace(/\s+/g, "");

  it.each([
    "StatusPageGroup",
    "StatusPageResource",
    "OnCallDutyPolicyEscalationRule",
    "OnCallDutyPolicyScheduleLayer",
    "OnCallDutyPolicyScheduleLayerUser",
  ])("serve %s with the move beside its CRUD routes", (model: string) => {
    expect(compact).toContain(
      `newMoveInListAPI<${model},${model}ServiceType>(${model},${model}Service,)`,
    );
    expect(compact).not.toContain(`newBaseAPI<${model},${model}ServiceType>`);
  });
});

/*
 * Every drag-ordered list (@ListOrderColumn) has the move too (issue
 * #9609), through BaseAPI itself - whichever API class serves it
 * (ArchivableValueAPI, CustomFieldDefinitionAPI...): a write of its number
 * places the row alone now, so the Dashboard's drag sends the move.
 */
describe("every drag-ordered list's API", () => {
  type ModelType = { new (): BaseModel; name: string };

  // Every model marked @ListOrderColumn.
  const LIST_ORDER_MODELS: Array<ModelType> = (
    AllModelTypes as unknown as Array<ModelType>
  ).filter((modelType: ModelType): boolean => {
    return Boolean(new modelType().getListOrder());
  });

  /*
   * A service the routes are registered for: registering a route asks
   * nothing of it, and a move hands it the request (moveInList).
   */
  const serviceFor: (moveInList?: jest.Mock) => DatabaseService<BaseModel> = (
    moveInList?: jest.Mock,
  ): DatabaseService<BaseModel> => {
    return {
      moveInList: moveInList || jest.fn(),
    } as unknown as DatabaseService<BaseModel>;
  };

  const routesOf: (api: () => void) => Array<string> = (
    api: () => void,
  ): Array<string> => {
    mockRouter.routes.length = 0;
    api();

    return mockRouter.routes.map(
      (route: { method: string; uri: string }): string => {
        return `${route.method} ${route.uri}`;
      },
    );
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("there are drag-ordered lists to check", () => {
    expect(LIST_ORDER_MODELS.length).toBeGreaterThan(30);
  });

  it.each(
    LIST_ORDER_MODELS.map((modelType: ModelType) => {
      return [modelType.name, modelType] as [string, ModelType];
    }),
  )(
    "%s has the move beside its CRUD routes, behind a signed-in caller",
    (_name: string, modelType: ModelType) => {
      const path: string = `${new modelType()
        .getCrudApiPath()!
        .toString()}/:id/move`;

      const uris: Array<string> = routesOf((): void => {
        new BaseAPI(modelType, serviceFor());
      });

      expect(
        uris.filter((uri: string) => {
          return uri === `POST ${path}`;
        }),
      ).toHaveLength(1);

      const route: { middlewares: Array<unknown> } = mockRouter.routes.find(
        (candidate: { method: string; uri: string }): boolean => {
          return candidate.method === "POST" && candidate.uri === path;
        },
      ) as unknown as { middlewares: Array<unknown> };

      expect(route.middlewares).toEqual([
        UserMiddleware.getUserMiddleware,
        UserMiddleware.requireUserAuthentication,
      ]);
    },
  );

  it("a table that is no list kept in order has none", () => {
    const uris: Array<string> = routesOf((): void => {
      new BaseAPI(Monitor, serviceFor());
    });

    expect(uris).toContain("POST /monitor/get-list");
    expect(
      uris.some((uri: string) => {
        return uri.endsWith("/move");
      }),
    ).toBe(false);
  });

  it("hands a drag-ordered list's move to its own service, and answers the rows given another number", async () => {
    const moveInList: jest.Mock = jest.fn(async () => {
      return {
        changedRows: [
          { id: GROUP_ID, order: 1 },
          { id: PLACE_OF_ID, order: 2 },
        ],
      };
    });

    mockRouter.routes.length = 0;
    new BaseAPI(IncidentSeverity, serviceFor(moveInList));

    const props: DatabaseCommonInteractionProps = {
      tenantId: PROJECT_ID,
      userId: new ObjectID(USER_ID),
      userType: UserType.User,
    };

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(props as never);
    const productIsOn: jest.SpyInstance = jest
      .spyOn(ServerProducts, "assertRecordTableIsOn")
      .mockResolvedValue(undefined as never);

    const request: OneUptimeRequest = {
      headers: {},
      params: { id: GROUP_ID },
      body: { placeOfId: PLACE_OF_ID },
    } as unknown as OneUptimeRequest;
    const response: OneUptimeResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as OneUptimeResponse;
    const next: jest.Mock = jest.fn();

    await mockRouter
      .match("post", "/incident-severity/:id/move")
      .handlerFunction(request, response, next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(productIsOn).toHaveBeenCalledWith("IncidentSeverity");
    expect(moveInList).toHaveBeenCalledTimes(1);

    const asked: { id: ObjectID; placeOfId: ObjectID; props: unknown } =
      moveInList.mock.calls[0]![0] as {
        id: ObjectID;
        placeOfId: ObjectID;
        props: unknown;
      };

    expect(asked.id.toString()).toBe(GROUP_ID);
    expect(asked.placeOfId.toString()).toBe(PLACE_OF_ID);
    expect(asked.props).toBe(props);
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
      request,
      response,
      {
        changedRows: [
          { _id: GROUP_ID, order: 1 },
          { _id: PLACE_OF_ID, order: 2 },
        ],
      },
    );
  });

  it("MoveInListAPI adds the move once, for a drag-ordered list as for the five", () => {
    const uris: Array<string> = routesOf((): void => {
      new MoveInListAPI(IncidentSeverity, serviceFor());
    });

    expect(
      uris.filter((uri: string) => {
        return uri === "POST /incident-severity/:id/move";
      }),
    ).toHaveLength(1);
  });
});
