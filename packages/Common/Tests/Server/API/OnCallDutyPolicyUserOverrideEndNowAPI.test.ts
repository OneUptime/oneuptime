import CommonAPI from "../../../Server/API/CommonAPI";
import OnCallDutyPolicyUserOverrideAPI from "../../../Server/API/OnCallDutyPolicyUserOverrideAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import OnCallDutyPolicyUserOverrideService from "../../../Server/Services/OnCallDutyPolicyUserOverrideService";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import { USER_OVERRIDE_END_NOW_NOT_STARTED_REFUSAL } from "../../../Types/OnCallDutyPolicy/UserOverrideEdit";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { withoutRefusals } from "./RouteRefusals";

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
 * POST /on-call-duty-policy-user-override/:id/end-now: End Now (issue
 * #7899). The route is behind a signed-in caller (a person or an API key),
 * must name the project in the tenant header, refuses an id that is no id
 * before anything is read, hands the override to the service as the caller
 * - which ends it at the server's own now - and answers when it ends now.
 * Every refusal is the answer. OnCallDutyPolicyUserOverrideEndNow covers
 * the service.
 */

const PATH: string = "/on-call-duty-policy-user-override/:id/end-now";

const PROJECT_ID: ObjectID = new ObjectID(
  "0d789900-0000-4000-8000-000000000001",
);
const OVERRIDE_ID: string = "0d789900-0000-4000-8000-000000000002";
const USER_ID: string = "0d789900-0000-4000-8000-0000000000a1";
const ENDS_AT: Date = new Date("2026-11-13T12:00:00.000Z");

describe("POST /on-call-duty-policy-user-override/:id/end-now", () => {
  let request: OneUptimeRequest;
  let response: OneUptimeResponse;
  let next: jest.Mock;
  let props: DatabaseCommonInteractionProps;
  let endNow: jest.SpyInstance;

  async function post(overrideId: string = OVERRIDE_ID): Promise<void> {
    request.body = {};
    request.params = { id: overrideId };

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

    new OnCallDutyPolicyUserOverrideAPI();

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

    endNow = jest
      .spyOn(OnCallDutyPolicyUserOverrideService, "endNow")
      .mockResolvedValue(ENDS_AT as never);

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

  it("sits under the override's own path, behind a signed-in caller", () => {
    const route: { middlewares: Array<unknown> } | undefined =
      mockRouter.routes.find(
        (candidate: { method: string; uri: string }): boolean => {
          return candidate.method === "POST" && candidate.uri === PATH;
        },
      ) as { middlewares: Array<unknown> } | undefined;

    expect(route).toBeDefined();
    // Its chain as it was, beside the refusal while its product is off (#7479).
    expect(withoutRefusals(route!.middlewares)).toEqual([
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
    ]);
  });

  it("keeps the override's own routes, and add-access beside it", () => {
    const uris: Array<string> = mockRouter.routes.map(
      (route: { method: string; uri: string }): string => {
        return `${route.method} ${route.uri}`;
      },
    );

    expect(uris).toContain("PUT /on-call-duty-policy-user-override/:id");
    expect(uris).toContain("DELETE /on-call-duty-policy-user-override/:id");
    expect(uris).toContain(
      "POST /on-call-duty-policy-user-override/add-access",
    );
  });

  it("hands the override to End Now, as the caller, and answers when it ends now", async () => {
    await post();

    expect(endNow).toHaveBeenCalledTimes(1);

    const asked: { id: ObjectID; props: DatabaseCommonInteractionProps } =
      endNow.mock.calls[0]![0] as {
        id: ObjectID;
        props: DatabaseCommonInteractionProps;
      };

    expect(asked.id.toString()).toBe(OVERRIDE_ID);
    expect(asked.props).toBe(props);
    expect(Response.setNoCacheHeaders).toHaveBeenCalledWith(response);
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
      request,
      response,
      { _id: OVERRIDE_ID, endsAt: ENDS_AT.toISOString() },
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("an API key ends one as itself", async () => {
    props = {
      tenantId: PROJECT_ID,
      apiKeyId: ObjectID.generate(),
      userType: UserType.API,
    };

    await post();

    expect(endNow).toHaveBeenCalledWith(
      expect.objectContaining({ props: props }),
    );
  });

  it("a request that names no project is refused before anything is read", async () => {
    delete props.tenantId;

    await post();

    expect(endNow).not.toHaveBeenCalled();
    expect(refusal().message).toBe(
      "Project ID is required. Please pass the project ID in the 'tenantid' header.",
    );
  });

  it("an override id that is no id is refused before anything is read", async () => {
    await post("not-an-override");

    expect(endNow).not.toHaveBeenCalled();
    expect(refusal()).toBeInstanceOf(BadDataException);
  });

  it("End Now's refusal is the answer: one that has not started has nothing to end", async () => {
    endNow.mockRejectedValue(
      new BadDataException(USER_OVERRIDE_END_NOW_NOT_STARTED_REFUSAL) as never,
    );

    await post();

    expect(refusal().message).toBe(USER_OVERRIDE_END_NOW_NOT_STARTED_REFUSAL);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  it("so is the permission's", async () => {
    endNow.mockRejectedValue(
      new NotAuthorizedException(
        "You do not have permission to edit this user override.",
      ) as never,
    );

    await post();

    expect(refusal()).toBeInstanceOf(NotAuthorizedException);
  });
});
