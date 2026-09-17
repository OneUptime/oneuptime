import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { mockRouter } from "./Helpers";
import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
} from "@jest/globals";

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

const UPDATE_SUBSCRIPTION_ROUTE: string =
  "/status-page/update-subscription/:statusPageId/:subscriberId";
const GET_SUBSCRIPTION_ROUTE: string =
  "/status-page/get-subscription/:statusPageId/:subscriberId";

/*
 * The subscription endpoints authorize the caller against the status page named
 * in the URL, but the subscriber is addressed by its own UUID. If the lookup is
 * not also scoped to that status page, holding a subscriber UUID is enough to
 * edit a subscriber belonging to any other status page — including a private
 * one the caller cannot read. These routes are reachable without
 * authentication (getUserMiddleware attaches a user but does not require one),
 * so the scope on the query is the whole access control.
 */

describe("StatusPageAPI subscriber ownership", () => {
  let victimStatusPageId: ObjectID;
  let attackerStatusPageId: ObjectID;
  let subscriberId: ObjectID;
  let projectId: ObjectID;
  let victimSubscriber: StatusPageSubscriber;
  let mockResponse: ExpressResponse;
  let nextFunction: NextFunction;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new StatusPageAPI();
  });

  /*
   * Stands in for the database: only returns the subscriber when the query
   * actually scopes to the status page that owns it.
   */
  const findOneByFake: (findBy: {
    query: JSONObject;
  }) => Promise<StatusPageSubscriber | null> = (findBy: {
    query: JSONObject;
  }): Promise<StatusPageSubscriber | null> => {
    const query: JSONObject = findBy.query;

    if (query["_id"]?.toString() !== subscriberId.toString()) {
      return Promise.resolve(null);
    }

    if (
      query["statusPageId"] &&
      query["statusPageId"].toString() !== victimStatusPageId.toString()
    ) {
      return Promise.resolve(null);
    }

    return Promise.resolve(victimSubscriber);
  };

  const callUpdateSubscription: (data: {
    statusPageId: ObjectID;
  }) => Promise<void> = async (data: {
    statusPageId: ObjectID;
  }): Promise<void> => {
    const request: ExpressRequest = {
      params: {
        statusPageId: data.statusPageId.toString(),
        subscriberId: subscriberId.toString(),
      },
      body: {
        data: {
          isUnsubscribed: true,
          isSubscribedToAllResources: true,
        },
      },
      query: {},
      cookies: {},
      headers: {},
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;

    await mockRouter
      .match("put", UPDATE_SUBSCRIPTION_ROUTE)
      .handlerFunction(request, mockResponse, nextFunction);
  };

  const callGetSubscription: (data: {
    statusPageId: ObjectID;
  }) => Promise<void> = async (data: {
    statusPageId: ObjectID;
  }): Promise<void> => {
    const request: ExpressRequest = {
      params: {
        statusPageId: data.statusPageId.toString(),
        subscriberId: subscriberId.toString(),
      },
      body: { data: {} },
      query: {},
      cookies: {},
      headers: {},
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;

    await mockRouter
      .match("post", GET_SUBSCRIPTION_ROUTE)
      .handlerFunction(request, mockResponse, nextFunction);
  };

  const getThrownError: () => unknown = (): unknown => {
    const calls: Array<Array<unknown>> = (nextFunction as jest.Mock).mock
      .calls as Array<Array<unknown>>;

    expect(calls.length).toBe(1);
    return calls[0]![0];
  };

  const getSubscriberQuery: () => JSONObject = (): JSONObject => {
    const calls: Array<Array<unknown>> = (
      StatusPageSubscriberService.findOneBy as unknown as jest.Mock
    ).mock.calls as Array<Array<unknown>>;

    expect(calls.length).toBe(1);
    return (calls[0]![0] as { query: JSONObject }).query;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    victimStatusPageId = ObjectID.generate();
    attackerStatusPageId = ObjectID.generate();
    subscriberId = ObjectID.generate();
    projectId = ObjectID.generate();

    victimSubscriber = new StatusPageSubscriber();
    victimSubscriber.id = subscriberId;
    victimSubscriber.statusPageId = victimStatusPageId;
    victimSubscriber.projectId = projectId;
    victimSubscriber.isUnsubscribed = false;

    // The caller can read whichever status page they name in the URL.
    jest
      .spyOn(StatusPageService, "hasReadAccess")
      .mockResolvedValue({ hasReadAccess: true });

    jest
      .spyOn(StatusPageService, "findOneBy")
      .mockImplementation((findBy: any): Promise<StatusPage | null> => {
        const statusPage: StatusPage = new StatusPage();
        statusPage.id = new ObjectID(findBy.query["_id"].toString());
        statusPage.projectId = projectId;
        statusPage.showSubscriberPageOnStatusPage = true;
        statusPage.allowSubscribersToChooseResources = true;
        statusPage.allowSubscribersToChooseEventTypes = true;
        return Promise.resolve(statusPage);
      });

    jest
      .spyOn(StatusPageSubscriberService, "findOneBy")
      .mockImplementation(findOneByFake as never);

    jest
      .spyOn(StatusPageSubscriberService, "updateOneById")
      .mockResolvedValue(undefined as never);

    jest
      .spyOn(StatusPageSubscriberService, "create")
      .mockResolvedValue(victimSubscriber as never);

    mockResponse = {
      cookie: jest.fn(),
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;
    nextFunction = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("update-subscription", () => {
    it("does not update a subscriber belonging to another status page", async () => {
      await callUpdateSubscription({ statusPageId: attackerStatusPageId });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expect(StatusPageSubscriberService.updateOneById).not.toHaveBeenCalled();
    });

    it("scopes the subscriber lookup to the status page in the route", async () => {
      await callUpdateSubscription({ statusPageId: attackerStatusPageId });

      const query: JSONObject = getSubscriberQuery();
      expect(query["statusPageId"]?.toString()).toBe(
        attackerStatusPageId.toString(),
      );
      expect(query["_id"]?.toString()).toBe(subscriberId.toString());
    });

    it("reports a foreign subscriber exactly as a missing one, revealing nothing", async () => {
      await callUpdateSubscription({ statusPageId: attackerStatusPageId });
      const foreignError: unknown = getThrownError();

      jest.clearAllMocks();
      nextFunction = jest.fn();
      subscriberId = ObjectID.generate(); // a UUID that exists nowhere
      await callUpdateSubscription({ statusPageId: attackerStatusPageId });
      const missingError: unknown = getThrownError();

      expect((foreignError as BadDataException).message).toBe(
        (missingError as BadDataException).message,
      );
    });

    it("still updates a subscriber through its own status page", async () => {
      await callUpdateSubscription({ statusPageId: victimStatusPageId });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(StatusPageSubscriberService.updateOneById).toHaveBeenCalledTimes(
        1,
      );

      const updateArgs: { id: ObjectID; data: JSONObject } = (
        StatusPageSubscriberService.updateOneById as unknown as jest.Mock
      ).mock.calls[0]![0] as { id: ObjectID; data: JSONObject };
      expect(updateArgs.id.toString()).toBe(subscriberId.toString());
      expect(updateArgs.data["isUnsubscribed"]).toBe(true);
    });
  });

  describe("get-subscription", () => {
    it("does not read a subscriber belonging to another status page", async () => {
      await callGetSubscription({ statusPageId: attackerStatusPageId });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
    });

    it("scopes the subscriber lookup to the status page in the route", async () => {
      await callGetSubscription({ statusPageId: attackerStatusPageId });

      expect(getSubscriberQuery()["statusPageId"]?.toString()).toBe(
        attackerStatusPageId.toString(),
      );
    });

    it("still reads a subscriber through its own status page", async () => {
      await callGetSubscription({ statusPageId: victimStatusPageId });

      expect(nextFunction).not.toHaveBeenCalled();
    });
  });
});
