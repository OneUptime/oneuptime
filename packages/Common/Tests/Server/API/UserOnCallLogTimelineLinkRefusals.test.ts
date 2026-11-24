jest.mock("isolated-vm", () => {
  return {};
});

import { mockRouter } from "./Helpers";
import UserNotificationLogTimelineAPI from "../../../Server/API/UserOnCallLogTimelineAPI";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import BadDataException from "../../../Types/Exception/BadDataException";
import { meetsErrorMessageRule } from "../../../Types/Exception/ErrorMessageRule";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  getOnCallLinkRefusalWords,
  ON_CALL_LINK_ACKNOWLEDGED_MESSAGE,
  ON_CALL_LINK_INCOMPLETE_MESSAGE,
  ON_CALL_LINK_INCOMPLETE_TITLE,
  ON_CALL_LINK_PAGE_NOT_AVAILABLE_MESSAGE,
  ON_CALL_LINK_PAGE_NOT_AVAILABLE_TITLE,
  OnCallLinkRefusal,
} from "../../../Types/OnCallDutyPolicy/OnCallLinkRefusals";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
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
    render: jest.fn(),
    redirect: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendJsonArrayResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
  };
});

/*
 * AN ON-CALL LINK THAT OPENS NO PAGE SAYS WHY, AND WHAT TO DO (#11056).
 *
 * The links in an on-call page's messages - Acknowledge, "Can't take it?
 * Escalate", and a call's keypad - name their notification in the address.
 * One with no notification in it, or cut short, answered "Item ID is
 * required"; one whose notification is not there answered "Invalid item
 * Id", as the JSON of an API error, to a responder at night on a phone.
 *
 * The pages a person opens answer with a page now: what happened, what to
 * do next, and a button to OneUptime. A notification that is not there
 * reads the same whatever the address, with the status it had, and nothing
 * of the address in it. A call's keypad, which Twilio posts, answers with
 * the same sentences as before answered with fragments.
 */

const BROWSER_ROUTES: Array<{ name: string; method: string; uri: string }> = [
  {
    name: "the acknowledge page",
    method: "GET",
    uri: "/user-notification-log-timeline/acknowledge-page/:itemId",
  },
  {
    name: "the acknowledge page's button, opened",
    method: "GET",
    uri: "/user-notification-log-timeline/acknowledge/:itemId",
  },
  {
    name: "the Acknowledge button",
    method: "POST",
    uri: "/user-notification-log-timeline/acknowledge/:itemId",
  },
  {
    name: "the Escalate page",
    method: "GET",
    uri: "/user-notification-log-timeline/pass-on-page/:itemId",
  },
  {
    name: "the Escalate button",
    method: "POST",
    uri: "/user-notification-log-timeline/pass-on/:itemId",
  },
];

const CALL_ROUTE: string =
  "/user-notification-log-timeline/call/gather-input/:itemId";

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

interface Answer {
  status: number | undefined;
  rendered: JSONObject | undefined;
  view: string | undefined;
  refusal: Error | undefined;
}

const call: (data: {
  method: string;
  uri: string;
  itemId: string;
}) => Promise<Answer> = async (data: {
  method: string;
  uri: string;
  itemId: string;
}): Promise<Answer> => {
  const render: jest.Mock = Response.render as unknown as jest.Mock;
  const sendError: jest.Mock = Response.sendErrorResponse as unknown as jest.Mock;
  render.mockClear();
  sendError.mockClear();

  let status: number | undefined = undefined;

  const res: ExpressResponse = {
    status: jest.fn((code: number) => {
      status = code;
      return res;
    }),
  } as unknown as ExpressResponse;

  const handler: RouterFunction = mockRouter.match(data.method, data.uri)
    .handlerFunction as RouterFunction;

  await handler(
    {
      params: { itemId: data.itemId },
      query: {},
      body: {},
    } as unknown as ExpressRequest,
    res,
    ((err: unknown) => {
      throw err;
    }) as unknown as NextFunction,
  );

  const renderCall: Array<unknown> | undefined = render.mock.calls[0] as
    | Array<unknown>
    | undefined;
  const errorCall: Array<unknown> | undefined = sendError.mock.calls[0] as
    | Array<unknown>
    | undefined;

  return {
    status: status,
    view: renderCall ? (renderCall[2] as string) : undefined,
    rendered: renderCall ? (renderCall[3] as JSONObject) : undefined,
    refusal: errorCall ? (errorCall[2] as Error) : undefined,
  };
};

const MISSING_ID: string = "6f1d7f2e-1b3c-4d5e-8f90-a1b2c3d4e5f6";

let findOneById: ReturnType<typeof getJestSpyOn>;

beforeAll(() => {
  mockRouter.routes.length = 0;
  new UserNotificationLogTimelineAPI();
});

beforeEach(() => {
  findOneById = getJestSpyOn(
    UserOnCallLogTimelineService,
    "findOneById",
  ).mockResolvedValue(null as never);
  getJestSpyOn(DatabaseConfig, "getHost").mockResolvedValue(
    Hostname.fromString("oneuptime.example.com") as never,
  );
  getJestSpyOn(DatabaseConfig, "getHttpProtocol").mockResolvedValue(
    Protocol.HTTPS as never,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the words", () => {
  test("each says what happened and what to do next, in a sentence", () => {
    for (const message of [
      ON_CALL_LINK_INCOMPLETE_MESSAGE,
      ON_CALL_LINK_PAGE_NOT_AVAILABLE_MESSAGE,
      ON_CALL_LINK_ACKNOWLEDGED_MESSAGE,
    ]) {
      expect(meetsErrorMessageRule(message)).toBe(true);
    }

    expect(ON_CALL_LINK_INCOMPLETE_MESSAGE).toContain(
      "Use the link in the newest message you were paged with.",
    );
    expect(ON_CALL_LINK_PAGE_NOT_AVAILABLE_MESSAGE).toContain(
      "Use the link in the newest message you were paged with",
    );
  });

  test("never the fragments they replaced", () => {
    for (const refusal of Object.values(OnCallLinkRefusal)) {
      const words: { title: string; message: string } =
        getOnCallLinkRefusalWords(refusal);

      for (const fragment of ["Item ID", "item Id", "Invalid"]) {
        expect(words.title).not.toContain(fragment);
        expect(words.message).not.toContain(fragment);
      }
    }
  });
});

describe.each(BROWSER_ROUTES)("$name ($method)", (route: {
  name: string;
  method: string;
  uri: string;
}) => {
  test("a link with no notification in it, or cut short, opens a page that says the link is not complete, and reads nothing", async () => {
    const answer: Answer = await call({
      method: route.method,
      uri: route.uri,
      itemId: "6f1d7f2e-1b3c-4d5e",
    });

    expect(answer.refusal).toBeUndefined();
    expect(answer.status).toBe(400);
    expect(answer.view).toBe("/usr/src/Common/Server/Views/ViewMessage.ejs");
    expect(answer.rendered?.["title"]).toBe(ON_CALL_LINK_INCOMPLETE_TITLE);
    expect(answer.rendered?.["message"]).toBe(ON_CALL_LINK_INCOMPLETE_MESSAGE);
    expect(findOneById).not.toHaveBeenCalled();
  });

  test("a link whose notification is not there opens a page that says so, with a way to OneUptime, and nothing of the address", async () => {
    const answer: Answer = await call({
      method: route.method,
      uri: route.uri,
      itemId: MISSING_ID,
    });

    expect(answer.refusal).toBeUndefined();
    expect(answer.status).toBe(400);
    expect(answer.view).toBe("/usr/src/Common/Server/Views/ViewMessage.ejs");
    expect(answer.rendered).toEqual({
      title: ON_CALL_LINK_PAGE_NOT_AVAILABLE_TITLE,
      message: ON_CALL_LINK_PAGE_NOT_AVAILABLE_MESSAGE,
      viewDetailsText: "Open OneUptime",
      viewDetailsUrl: "https://oneuptime.example.com/dashboard",
    });
    expect(JSON.stringify(answer.rendered)).not.toContain(MISSING_ID);
  });

  test("every address whose notification is not there is answered alike", async () => {
    const first: Answer = await call({
      method: route.method,
      uri: route.uri,
      itemId: MISSING_ID,
    });
    const second: Answer = await call({
      method: route.method,
      uri: route.uri,
      itemId: ObjectID.generate().toString(),
    });

    expect(second).toEqual(first);
  });
});

describe("a call's keypad, which Twilio posts", () => {
  test("an address with no notification in it is refused with the sentence, not a fragment", async () => {
    const answer: Answer = await call({
      method: "POST",
      uri: CALL_ROUTE,
      itemId: "",
    });

    expect(answer.refusal).toBeInstanceOf(BadDataException);
    expect(answer.refusal?.message).toBe(ON_CALL_LINK_INCOMPLETE_MESSAGE);
  });

  test("a notification that is not there is refused with the sentence, and nothing is pressed", async () => {
    const answer: Answer = await call({
      method: "POST",
      uri: CALL_ROUTE,
      itemId: MISSING_ID,
    });

    expect(answer.refusal).toBeInstanceOf(BadDataException);
    expect(answer.refusal?.message).toBe(
      ON_CALL_LINK_PAGE_NOT_AVAILABLE_MESSAGE,
    );
    expect(answer.rendered).toBeUndefined();
  });
});
