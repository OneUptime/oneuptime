import CommonAPI from "../../../Server/API/CommonAPI";
import OnCallDutyPolicyScheduleAPI from "../../../Server/API/OnCallDutyPolicyScheduleAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "../../../Server/Utils/Express";
import ScheduleLayersSave from "../../../Server/Utils/OnCall/ScheduleLayersSave";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ConflictException from "../../../Types/Exception/ConflictException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import {
  ScheduleLayersSaveRequest,
  ScheduleLayersSaveResult,
} from "../../../Types/OnCallDutyPolicy/ScheduleLayersSave";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

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
 * POST /on-call-duty-policy-schedule/:id/save-layers: the Save of a
 * schedule's Layers page (issue #7575) - who takes turns in each layer, in
 * what order, the layers' priority and the layers deleted, saved at once.
 *
 * The route is behind a signed-in caller (a person or an API key), must
 * name the project in the tenant header, reads the body before anything
 * is asked of the database, hands it to the save as the caller, and
 * answers what was saved. Every refusal - a body that is no save, a save
 * made to layers changed since (409), a change the caller may not make -
 * is the answer. ScheduleLayersSave covers the save.
 */

const PATH: string = "/on-call-duty-policy-schedule/:id/save-layers";

const PROJECT_ID: ObjectID = new ObjectID(
  "0d750000-0000-4000-8000-000000000001",
);
const SCHEDULE_ID: string = "0d750000-0000-4000-8000-000000000004";
const LAYER_ID: string = "0d750000-0000-4000-8000-000000000005";
const LAYER_USER_ID: string = "0d750000-0000-4000-8000-000000000101";
const USER_ID: string = "0d750000-0000-4000-8000-0000000000a1";
const ADDED_USER_ID: string = "0d750000-0000-4000-8000-0000000000b1";

const BODY: Record<string, unknown> = {
  basedOnVersion: "1-1-1-abc-def",
  layers: [
    {
      layerId: LAYER_ID,
      users: [
        { userId: ADDED_USER_ID },
        { layerUserId: LAYER_USER_ID, userId: USER_ID },
      ],
    },
  ],
  deletedLayerIds: [],
};

const RESULT: ScheduleLayersSaveResult = {
  version: "1-1-2-ghi-jkl",
  deletedLayers: 0,
  movedLayers: 0,
  addedLayerUsers: 1,
  removedLayerUsers: 0,
  movedLayerUsers: 0,
};

describe("POST /on-call-duty-policy-schedule/:id/save-layers", () => {
  let request: OneUptimeRequest;
  let response: OneUptimeResponse;
  let next: jest.Mock;
  let props: DatabaseCommonInteractionProps;
  let save: jest.SpyInstance;

  async function post(
    body: unknown,
    scheduleId: string = SCHEDULE_ID,
  ): Promise<void> {
    request.body = body;
    request.params = { id: scheduleId };

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

    new OnCallDutyPolicyScheduleAPI();

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

    save = jest
      .spyOn(ScheduleLayersSave, "save")
      .mockResolvedValue(RESULT as never);

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

  it("sits under the schedule's own path, behind a signed-in caller", () => {
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

  it("keeps the schedule's own routes - list, read, create, edit, delete", () => {
    const uris: Array<string> = mockRouter.routes.map(
      (route: { method: string; uri: string }): string => {
        return `${route.method} ${route.uri}`;
      },
    );

    expect(uris).toContain("POST /on-call-duty-policy-schedule/get-list");
    expect(uris).toContain("POST /on-call-duty-policy-schedule");
    expect(uris).toContain("PUT /on-call-duty-policy-schedule/:id");
    expect(uris).toContain("DELETE /on-call-duty-policy-schedule/:id");
  });

  it("hands the save to the schedule, as the caller, and answers what was saved", async () => {
    await post(BODY);

    expect(save).toHaveBeenCalledTimes(1);
    const asked: {
      scheduleId: ObjectID;
      request: ScheduleLayersSaveRequest;
      props: DatabaseCommonInteractionProps;
    } = save.mock.calls[0]![0] as {
      scheduleId: ObjectID;
      request: ScheduleLayersSaveRequest;
      props: DatabaseCommonInteractionProps;
    };

    expect(asked.scheduleId.toString()).toBe(SCHEDULE_ID);
    expect(asked.props).toBe(props);
    expect(asked.request).toEqual({
      basedOnVersion: "1-1-1-abc-def",
      layers: [
        {
          layerId: LAYER_ID,
          users: [
            { userId: ADDED_USER_ID },
            { layerUserId: LAYER_USER_ID, userId: USER_ID },
          ],
        },
      ],
      deletedLayerIds: [],
    });

    expect(Response.setNoCacheHeaders).toHaveBeenCalledWith(response);
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
      request,
      response,
      {
        version: "1-1-2-ghi-jkl",
        deletedLayers: 0,
        movedLayers: 0,
        addedLayerUsers: 1,
        removedLayerUsers: 0,
        movedLayerUsers: 0,
      },
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("an API key saves as itself", async () => {
    props = {
      tenantId: PROJECT_ID,
      apiKeyId: ObjectID.generate(),
      userType: UserType.API,
    };

    await post(BODY);

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ props: props }),
    );
  });

  it("a request that names no project is refused before anything is read", async () => {
    delete props.tenantId;

    await post(BODY);

    expect(save).not.toHaveBeenCalled();
    expect(refusal().message).toBe(
      "Project ID is required. Please pass the project ID in the 'tenantid' header.",
    );
  });

  it("a schedule id that is no id is refused before anything is read", async () => {
    await post(BODY, "not-a-schedule");

    expect(save).not.toHaveBeenCalled();
    expect(refusal()).toBeInstanceOf(BadDataException);
  });

  const notASave: Array<{ name: string; body: unknown; says: RegExp }> = [
    { name: "no body", body: undefined, says: /Send the layers to save/ },
    {
      name: "no version",
      body: { ...BODY, basedOnVersion: undefined },
      says: /Send basedOnVersion/,
    },
    {
      name: "a layer named twice",
      body: {
        ...BODY,
        layers: [
          { layerId: LAYER_ID, users: [] },
          { layerId: LAYER_ID, users: [] },
        ],
      },
      says: /Name each layer once/,
    },
    {
      name: "a person with no user id",
      body: { ...BODY, layers: [{ layerId: LAYER_ID, users: [{}] }] },
      says: /named by their userId/,
    },
  ];

  it.each(notASave)(
    "a body with $name is refused, in plain words, before anything is read",
    async (sent: { name: string; body: unknown; says: RegExp }) => {
      await post(sent.body);

      expect(save).not.toHaveBeenCalled();
      const error: Error = refusal();
      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toMatch(sent.says);
    },
  );

  it("a save made to layers changed since is answered as a conflict, for the page to reload", async () => {
    save.mockRejectedValue(
      new ConflictException(ScheduleLayersSave.CONFLICT_MESSAGE) as never,
    );

    await post(BODY);

    const error: Error = refusal();
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe(ScheduleLayersSave.CONFLICT_MESSAGE);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  it("a change the caller may not make is the answer", async () => {
    save.mockRejectedValue(
      new NotAuthorizedException(
        "You do not have permission to delete the layers of this schedule.",
      ) as never,
    );

    await post(BODY);

    expect(refusal()).toBeInstanceOf(NotAuthorizedException);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});
