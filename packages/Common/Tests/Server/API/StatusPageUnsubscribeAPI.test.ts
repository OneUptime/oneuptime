import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import StatusPageSubscriberAPI, {
  OUT_OF_DATE_UNSUBSCRIBE_LINK_HTML,
} from "../../../Server/API/StatusPageSubscriberAPI";
import MailService from "../../../Server/Services/MailService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import URL from "../../../Types/API/URL";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { StatusPageSubscriberUnsubscribeState } from "../../../Types/StatusPage/StatusPageSubscriberUnsubscribe";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
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
    redirect: jest.fn(),
    sendHtmlResponse: jest.fn(),
  };
});

/*
 * The endpoints behind the status page's unsubscribe page, and the old
 * unsubscribe route that notifications carried until the end of 2023.
 *
 * The page's link works on public and private status pages without signing
 * in, so these routes carry no user middleware and never ask whether the
 * caller can read the page: the token in the link is the whole
 * authorisation. What they must guarantee instead:
 *
 *   - GET only describes the link. Mail scanners fetch every link.
 *   - POST unsubscribes, once, and answers the same way again.
 *   - a wrong token and a deleted subscriber are indistinguishable.
 *   - the old id-only route no longer unsubscribes on GET, and never hands
 *     out the token.
 */

const UNSUBSCRIBE_ROUTE: string =
  "/status-page/unsubscribe/:statusPageId/:subscriberId/:token";
const LEGACY_ROUTE: string = "/status-page-subscriber/unsubscribe/:id";

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000002",
);
const SUBSCRIBER_ID: ObjectID = new ObjectID(
  "30000000-0000-4000-8000-000000000004",
);
const TOKEN: string = "7c".repeat(32);
const STATUS_PAGE_URL: string = "https://site03.status.acme.com";

let storedSubscriber: StatusPageSubscriber | null;
let query: MockFunction;
let mockResponse: ExpressResponse;
let nextFunction: NextFunction;

function subscriberRow(isUnsubscribed: boolean = false): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();
  row._id = SUBSCRIBER_ID.toString();
  row.projectId = PROJECT_ID;
  row.statusPageId = STATUS_PAGE_ID;
  row.subscriberEmail = new Email("site03-all@acme.com");
  row.unsubscribeToken = TOKEN;
  row.isUnsubscribed = isUnsubscribed;
  return row;
}

function request(data: {
  token?: string;
  subscriberId?: string;
  body?: unknown;
}): ExpressRequest {
  return {
    params: {
      statusPageId: STATUS_PAGE_ID.toString(),
      subscriberId: data.subscriberId || SUBSCRIBER_ID.toString(),
      token: data.token || TOKEN,
    },
    body: data.body ?? {},
    query: {},
    cookies: {},
    headers: {},
  } as unknown as ExpressRequest;
}

async function call(
  method: "get" | "post",
  req: ExpressRequest,
): Promise<JSONObject> {
  (Response.sendJsonObjectResponse as unknown as jest.Mock).mockClear();

  await mockRouter
    .match(method, UNSUBSCRIBE_ROUTE)
    .handlerFunction(req, mockResponse, nextFunction);

  expect(nextFunction).not.toHaveBeenCalled();

  const calls: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as unknown as jest.Mock
  ).mock.calls;

  expect(calls).toHaveLength(1);

  return calls[0]![2] as JSONObject;
}

describe("the unsubscribe page's API", () => {
  beforeAll(() => {
    mockRouter.routes.length = 0;
    new StatusPageAPI();
    new StatusPageSubscriberAPI();
  });

  beforeEach(() => {
    storedSubscriber = subscriberRow();

    query = getJestMockFunction();
    query.mockResolvedValue([
      [{ _id: SUBSCRIBER_ID.toString(), projectId: PROJECT_ID.toString() }],
      1,
    ] as never);

    jest.spyOn(StatusPageSubscriberService, "getRepository").mockReturnValue({
      manager: { query: query },
    } as never);

    jest
      .spyOn(StatusPageSubscriberService, "findOneBy")
      .mockImplementation(((findBy: { query: JSONObject }) => {
        const lookup: JSONObject = findBy.query;

        if (
          !storedSubscriber ||
          lookup["_id"]?.toString() !== storedSubscriber._id ||
          (lookup["statusPageId"] &&
            lookup["statusPageId"].toString() !== STATUS_PAGE_ID.toString())
        ) {
          return Promise.resolve(null);
        }

        return Promise.resolve(storedSubscriber);
      }) as never);

    jest
      .spyOn(StatusPageSubscriberService, "updateOneBy")
      .mockResolvedValue(1 as never);
    jest
      .spyOn(StatusPageSubscriberService, "updateOneById")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(StatusPageSubscriberService, "onTriggerWorkflow")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(StatusPageSubscriberService, "onTriggerRealtime")
      .mockResolvedValue(undefined as never);
    // The team notice has its own tests; here it only must not reach a database.
    jest
      .spyOn(StatusPageSubscriberService, "notifyTeamOfUnsubscribe")
      .mockResolvedValue(undefined as never);
    jest.spyOn(MailService, "sendMail").mockResolvedValue(undefined as never);

    // A private status page, and a caller who is not signed in to it.
    jest
      .spyOn(StatusPageService, "hasReadAccess")
      .mockResolvedValue({ hasReadAccess: false } as never);
    jest
      .spyOn(StatusPageService, "getStatusPageURL")
      .mockResolvedValue(STATUS_PAGE_URL as never);

    mockResponse = {
      cookie: jest.fn(),
      send: jest.fn(),
      json: jest.fn(),
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;
    nextFunction = jest.fn() as unknown as NextFunction;

    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("serves the page's GET and POST without any user middleware", () => {
    for (const method of ["get", "post"]) {
      expect(
        mockRouter.match(method, UNSUBSCRIBE_ROUTE).middlewares,
      ).toHaveLength(0);
    }
  });

  describe("GET: opening the link", () => {
    it("describes the subscription and changes nothing", async () => {
      const body: JSONObject = await call("get", request({}));

      expect(body["state"]).toBe(
        StatusPageSubscriberUnsubscribeState.Subscribed,
      );
      expect(body["contact"]).toBe("site03-all@acme.com");

      expect(query).not.toHaveBeenCalled();
      expect(StatusPageSubscriberService.updateOneBy).not.toHaveBeenCalled();
      expect(StatusPageSubscriberService.updateOneById).not.toHaveBeenCalled();
      expect(
        StatusPageSubscriberService.notifyTeamOfUnsubscribe,
      ).not.toHaveBeenCalled();
    });

    it("opening it any number of times still changes nothing", async () => {
      for (let i: number = 0; i < 5; i++) {
        await call("get", request({}));
      }

      expect(query).not.toHaveBeenCalled();
    });

    it("never returns the token, and is not cached", async () => {
      const body: JSONObject = await call("get", request({}));

      expect(JSON.stringify(body)).not.toContain(TOKEN);
      expect(Response.setNoCacheHeaders).toHaveBeenCalled();
    });
  });

  describe("POST: confirming", () => {
    it("unsubscribes on a private status page, without signing in", async () => {
      const body: JSONObject = await call("post", request({}));

      expect(body).toEqual({
        state: StatusPageSubscriberUnsubscribeState.Unsubscribed,
      });
      expect(query).toHaveBeenCalledTimes(1);
      expect(
        (query.mock.calls[0]![0] as string).replace(/\s+/g, " "),
      ).toContain('SET "isUnsubscribed" = true, "unsubscribedAt" = $1');
      expect(StatusPageService.hasReadAccess).not.toHaveBeenCalled();
    });

    it("works the same on a public status page", async () => {
      jest
        .spyOn(StatusPageService, "hasReadAccess")
        .mockResolvedValue({ hasReadAccess: true } as never);

      const body: JSONObject = await call("post", request({}));

      expect(body["state"]).toBe(
        StatusPageSubscriberUnsubscribeState.Unsubscribed,
      );
      expect(query).toHaveBeenCalledTimes(1);
    });

    it("accepts a one-click unsubscribe request's body (RFC 8058)", async () => {
      const body: JSONObject = await call(
        "post",
        request({ body: { "List-Unsubscribe": "One-Click" } }),
      );

      expect(body["state"]).toBe(
        StatusPageSubscriberUnsubscribeState.Unsubscribed,
      );
      expect(query).toHaveBeenCalledTimes(1);
    });

    it("is idempotent: confirming again answers the same and writes nothing more", async () => {
      await call("post", request({}));
      storedSubscriber = subscriberRow(true);

      const again: JSONObject = await call("post", request({}));

      expect(again).toEqual({
        state: StatusPageSubscriberUnsubscribeState.Unsubscribed,
      });
      expect(query).toHaveBeenCalledTimes(1);
    });

    it("refuses a wrong token exactly as it refuses a deleted subscriber", async () => {
      const wrongToken: JSONObject = await call(
        "post",
        request({ token: "7d".repeat(32) }),
      );

      storedSubscriber = null;
      const deleted: JSONObject = await call("post", request({}));

      expect(wrongToken).toEqual({
        state: StatusPageSubscriberUnsubscribeState.Invalid,
      });
      expect(deleted).toEqual(wrongToken);
      expect(query).not.toHaveBeenCalled();
    });

    it("refuses a malformed link the same way, without a lookup", async () => {
      const body: JSONObject = await call(
        "post",
        request({ subscriberId: "not-a-subscriber", token: "x" }),
      );

      expect(body).toEqual({
        state: StatusPageSubscriberUnsubscribeState.Invalid,
      });
      expect(StatusPageSubscriberService.findOneBy).not.toHaveBeenCalled();
    });
  });

  describe("the old id-only link, /status-page-subscriber/unsubscribe/:id", () => {
    async function callLegacy(id: string): Promise<void> {
      await mockRouter.match("get", LEGACY_ROUTE).handlerFunction(
        {
          params: { id: id },
          query: {},
          headers: {},
        } as unknown as ExpressRequest,
        mockResponse,
        nextFunction,
      );

      expect(nextFunction).not.toHaveBeenCalled();
    }

    it("no longer unsubscribes on GET", async () => {
      await callLegacy(SUBSCRIBER_ID.toString());

      expect(StatusPageSubscriberService.updateOneBy).not.toHaveBeenCalled();
      expect(StatusPageSubscriberService.updateOneById).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
    });

    it("leads to the status page's unsubscribe page, without the token", async () => {
      await callLegacy(SUBSCRIBER_ID.toString());

      const redirect: Array<unknown> = (
        Response.redirect as unknown as jest.Mock
      ).mock.calls[0]!;
      const to: string = (redirect[2] as URL).toString();

      expect(to).toBe(
        `${STATUS_PAGE_URL}/unsubscribe/${SUBSCRIBER_ID.toString()}`,
      );
      expect(to).not.toContain(TOKEN);
      expect(Response.setNoCacheHeaders).toHaveBeenCalled();
    });

    it("answers an unknown or malformed id with a static page", async () => {
      storedSubscriber = null;
      await callLegacy(SUBSCRIBER_ID.toString());
      await callLegacy("<script>alert(1)</script>");

      expect(Response.redirect).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(404);

      const sent: Array<Array<unknown>> = (
        mockResponse.send as unknown as jest.Mock
      ).mock.calls;
      expect(sent).toHaveLength(2);
      for (const call of sent) {
        expect(call[0]).toBe(OUT_OF_DATE_UNSUBSCRIBE_LINK_HTML);
      }
      expect(OUT_OF_DATE_UNSUBSCRIBE_LINK_HTML).not.toContain("<script>");
    });
  });
});
