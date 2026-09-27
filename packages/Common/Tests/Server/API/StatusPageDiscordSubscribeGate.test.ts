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
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
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

const SUBSCRIBE_ROUTE: string = "/status-page/subscribe/:statusPageId";

const VALID_DISCORD_WEBHOOK: string =
  "https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOp-token";

/*
 * The public subscribe endpoint is reachable without authentication. When a
 * status page has Discord subscriptions disabled, no Discord field — the
 * webhook credential or the channel label — may create a subscription, alone
 * or together. A webhook-only request must not slip past a gate that only
 * checks the label.
 */

describe("StatusPageAPI Discord subscribe enable gate", () => {
  let statusPageId: ObjectID;
  let mockResponse: ExpressResponse;
  let nextFunction: NextFunction;
  let enableDiscordSubscribers: boolean;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new StatusPageAPI();
  });

  const invokeSubscribe: (data: JSONObject) => Promise<void> = async (
    data: JSONObject,
  ): Promise<void> => {
    const request: ExpressRequest = {
      params: { statusPageId: statusPageId.toString() },
      body: { data },
      query: {},
      cookies: {},
      headers: {},
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;

    await mockRouter
      .match("post", SUBSCRIBE_ROUTE)
      .handlerFunction(request, mockResponse, nextFunction);
  };

  const getThrownError: () => unknown = (): unknown => {
    const calls: Array<Array<unknown>> = (nextFunction as jest.Mock).mock
      .calls as Array<Array<unknown>>;
    expect(calls.length).toBe(1);
    return calls[0]![0];
  };

  beforeEach(() => {
    jest.clearAllMocks();
    statusPageId = ObjectID.generate();
    enableDiscordSubscribers = false;
    nextFunction = jest.fn() as unknown as NextFunction;
    mockResponse = {} as ExpressResponse;

    const statusPage: StatusPage = new StatusPage();
    statusPage.id = statusPageId;
    statusPage.projectId = ObjectID.generate();

    jest
      .spyOn(StatusPageService, "hasReadAccess")
      .mockResolvedValue({ hasReadAccess: true });

    jest.spyOn(StatusPageService, "findOneBy").mockImplementation(() => {
      // Rebuild each call so per-test flag flips are honoured.
      const page: StatusPage = new StatusPage();
      page.id = statusPageId;
      page.projectId = ObjectID.generate();
      page.enableEmailSubscribers = true;
      page.enableDiscordSubscribers = enableDiscordSubscribers;
      page.showSubscriberPageOnStatusPage = true;
      page.allowSubscribersToChooseResources = false;
      page.allowSubscribersToChooseEventTypes = false;
      return Promise.resolve(page);
    });

    jest
      .spyOn(StatusPageService, "getStatusPageURL")
      .mockResolvedValue("https://status.example.com");

    jest
      .spyOn(StatusPageSubscriberService, "create")
      .mockResolvedValue(new StatusPageSubscriber());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects a Discord-webhook-only subscription while Discord is disabled", async () => {
    await invokeSubscribe({
      discordIncomingWebhookUrl: VALID_DISCORD_WEBHOOK,
    });

    expect(getThrownError()).toMatchObject({
      message: "Discord subscribers not enabled for this status page.",
    });
    expect(StatusPageSubscriberService.create).not.toHaveBeenCalled();
  });

  it("rejects a Discord-channel-label-only subscription while Discord is disabled", async () => {
    await invokeSubscribe({
      discordChannelName: "alerts",
    });

    expect(getThrownError()).toMatchObject({
      message: "Discord subscribers not enabled for this status page.",
    });
    expect(StatusPageSubscriberService.create).not.toHaveBeenCalled();
  });

  it("rejects a webhook plus label while Discord is disabled", async () => {
    await invokeSubscribe({
      discordIncomingWebhookUrl: VALID_DISCORD_WEBHOOK,
      discordChannelName: "alerts",
    });

    expect(getThrownError()).toMatchObject({
      message: "Discord subscribers not enabled for this status page.",
    });
    expect(StatusPageSubscriberService.create).not.toHaveBeenCalled();
  });
});
