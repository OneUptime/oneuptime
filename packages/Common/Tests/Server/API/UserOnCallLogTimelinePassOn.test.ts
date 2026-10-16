/*
 * The alert/incident services reach the isolated-vm native addon through the
 * template renderer they import. Nothing here runs a sandbox.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import { mockRouter } from "./Helpers";
import UserNotificationLogTimelineAPI from "../../../Server/API/UserOnCallLogTimelineAPI";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import AlertService from "../../../Server/Services/AlertService";
import IncidentService from "../../../Server/Services/IncidentService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import OnCallPageLinkToken from "../../../Server/Utils/OnCall/OnCallPageLinkToken";
import OnCallPagePassOn from "../../../Server/Utils/OnCall/OnCallPagePassOn";
import Response from "../../../Server/Utils/Response";
import Incident from "../../../Models/DatabaseModels/Incident";
import User from "../../../Models/DatabaseModels/User";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  OnCallPassOnAnswer,
  OnCallPassOnOutcome,
  OnCallPassOnRefusal,
  OnCallPassOnResult,
} from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import Timezone from "../../../Types/Timezone";
import { beforeAll, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * "CAN'T TAKE IT? PASS IT ON" FROM A PERSON'S OWN MESSAGES.
 *
 * Every message a page sends leads, through its links, to pages about that
 * one notification (UserOnCallLogTimelineAPI). These pin what those pages
 * do with passing on: the acknowledge page offers it beside Acknowledge for
 * a link that carries the page's own token; the pass-on page asks first and
 * posts a form; the form passes the page on and says what came of it; and a
 * call's second key passes it on. Every way in refuses a link whose token
 * was not signed for that notification.
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
    render: jest.fn(),
    redirect: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendXmlResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendJsonArrayResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
  };
});

const BASE: string = "/user-notification-log-timeline";

const ITEM: ObjectID = new ObjectID("0f900000-0000-4000-8000-000000000001");
const OTHER_ITEM: ObjectID = new ObjectID(
  "0f900000-0000-4000-8000-000000000002",
);
const PROJECT: ObjectID = new ObjectID("0f900000-0000-4000-8000-000000000003");
const INCIDENT: ObjectID = new ObjectID("0f900000-0000-4000-8000-000000000004");
const RUN: ObjectID = new ObjectID("0f900000-0000-4000-8000-000000000005");
const ANA: ObjectID = new ObjectID("0f900000-0000-4000-8000-0000000000a1");

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

async function call(data: {
  method: "GET" | "POST";
  uri: string;
  query?: JSONObject;
  body?: JSONObject;
  extra?: JSONObject;
}): Promise<void> {
  const handler: RouterFunction = mockRouter.match(data.method, data.uri)
    .handlerFunction as RouterFunction;

  await handler(
    {
      params: { itemId: ITEM.toString() },
      query: data.query || {},
      body: data.body || {},
      ...(data.extra || {}),
    } as unknown as ExpressRequest,
    {} as unknown as ExpressResponse,
    ((err: unknown) => {
      throw err || new Error("the route handler must not fall through");
    }) as unknown as NextFunction,
  );
}

function rendered(): { path: string; variables: JSONObject } {
  const render: jest.Mock = Response.render as unknown as jest.Mock;

  expect(render).toHaveBeenCalledTimes(1);

  return {
    path: render.mock.calls[0]![2] as string,
    variables: render.mock.calls[0]![3] as JSONObject,
  };
}

function preview(outcome: OnCallPassOnOutcome): OnCallPassOnResult {
  return {
    outcome: outcome,
    isPreview: true,
    isDirectPage: false,
    policyName: "Payments",
    rule: { order: 2, name: "Level 2" },
    pagedNames: [],
    stillPagedNames: [],
    ruleCount: 2,
  };
}

const VALID_TOKEN: () => string = (): string => {
  return OnCallPageLinkToken.sign({ userOnCallLogTimelineId: ITEM });
};

let previewSpy: jest.SpyInstance;
let passOnSpy: jest.SpyInstance;

beforeAll(() => {
  new UserNotificationLogTimelineAPI();
});

beforeEach(() => {
  jest.restoreAllMocks();
  (Response.render as unknown as jest.Mock).mockClear();
  (Response.sendErrorResponse as unknown as jest.Mock).mockClear();
  (Response.sendXmlResponse as unknown as jest.Mock).mockClear();

  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname("oneuptime.example.com"));
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);

  const item: UserOnCallLogTimeline = new UserOnCallLogTimeline();
  item.id = ITEM;
  item.projectId = PROJECT;
  item.userId = ANA;
  item.onCallDutyPolicyExecutionLogId = RUN;
  item.triggeredByIncidentId = INCIDENT;
  const incident: Incident = new Incident();
  incident.title = "Checkout is down";
  item.triggeredByIncident = incident;
  const user: User = new User();
  user.timezone = Timezone.UTC;
  item.user = user;

  jest
    .spyOn(UserOnCallLogTimelineService, "findOneById")
    .mockResolvedValue(item);

  // The page's context is best effort: none here, the timeline's title stands.
  jest.spyOn(IncidentService, "findOneById").mockResolvedValue(null);
  jest.spyOn(AlertService, "findOneById").mockResolvedValue(null);

  previewSpy = jest.spyOn(OnCallPagePassOn, "getPreview").mockResolvedValue({
    passedOn: false,
    result: preview(OnCallPassOnOutcome.NextRulePaged),
  });

  passOnSpy = jest.spyOn(OnCallPagePassOn, "passOn").mockResolvedValue({
    passedOn: true,
    result: {
      ...preview(OnCallPassOnOutcome.NextRulePaged),
      isPreview: false,
      pagedNames: ["Bob Smith"],
    },
  });
});

describe("the acknowledge page", () => {
  test("offers Can't take it? Pass it on, for a link with the page's token", async () => {
    const token: string = VALID_TOKEN();

    await call({
      method: "GET",
      uri: `${BASE}/acknowledge-page/:itemId`,
      query: { pageToken: token },
    });

    const { variables } = rendered();

    expect(variables["passOn"]).toEqual({
      lead: "Can't take it?",
      explanation:
        "You won't be paged about it again. Escalation rule 2 of 2 (Level 2) is paged right away, without waiting.",
      buttonText: "Pass it on",
      formUrl: `https://oneuptime.example.com/api/user-notification-log-timeline/pass-on/${ITEM.toString()}`,
      tokenParam: "pageToken",
      token: token,
    });
    expect(previewSpy).toHaveBeenCalledWith({
      userId: ANA,
      executionLogId: RUN,
    });
  });

  test("keeps Acknowledge as it always was beside it", async () => {
    await call({
      method: "GET",
      uri: `${BASE}/acknowledge-page/:itemId`,
      query: { pageToken: VALID_TOKEN() },
    });

    const { variables } = rendered();

    expect(variables["acknowledgeText"]).toBe("Acknowledge Incident");
    expect(variables["acknowledgeUrl"]).toBe(
      `https://oneuptime.example.com/api/user-notification-log-timeline/acknowledge/${ITEM.toString()}`,
    );
  });

  test("a link with no token - one sent before - acknowledges only", async () => {
    await call({ method: "GET", uri: `${BASE}/acknowledge-page/:itemId` });

    expect(rendered().variables["passOn"]).toBeUndefined();
    expect(previewSpy).not.toHaveBeenCalled();
  });

  test("a token signed for another notification is no token for this one", async () => {
    await call({
      method: "GET",
      uri: `${BASE}/acknowledge-page/:itemId`,
      query: {
        pageToken: OnCallPageLinkToken.sign({
          userOnCallLogTimelineId: OTHER_ITEM,
        }),
      },
    });

    expect(rendered().variables["passOn"]).toBeUndefined();
  });

  test("a page that cannot be passed on any more offers nothing", async () => {
    previewSpy.mockResolvedValue({
      passedOn: false,
      refusal: OnCallPassOnRefusal.AlreadyPassedOn,
    });

    await call({
      method: "GET",
      uri: `${BASE}/acknowledge-page/:itemId`,
      query: { pageToken: VALID_TOKEN() },
    });

    expect(rendered().variables["passOn"]).toBeUndefined();
  });
});

describe("the pass-on page", () => {
  test("asks first: what passing on would do, and a form that does it", async () => {
    const token: string = VALID_TOKEN();

    await call({
      method: "GET",
      uri: `${BASE}/pass-on-page/:itemId`,
      query: { pageToken: token },
    });

    const { path, variables } = rendered();

    expect(path).toBe(
      "/usr/src/Common/Server/Views/PassOnUserOnCallNotification.ejs",
    );
    expect(variables).toMatchObject({
      title: "Pass on this incident?",
      message:
        "Can't take it? You won't be paged about it again. Escalation rule 2 of 2 (Level 2) is paged right away, without waiting.",
      passOnText: "Pass it on",
      passOnFormUrl: `https://oneuptime.example.com/api/user-notification-log-timeline/pass-on/${ITEM.toString()}`,
      pageTokenParam: "pageToken",
      pageToken: token,
      acknowledgeText: "Acknowledge Incident instead",
      acknowledgeUrl: `https://oneuptime.example.com/api/user-notification-log-timeline/acknowledge/${ITEM.toString()}`,
      resourceTitle: "Checkout is down",
    });
    expect(passOnSpy).not.toHaveBeenCalled();
  });

  test("without a valid token, says the link cannot pass the page on - and passes nothing on", async () => {
    for (const query of [
      {},
      { pageToken: "nonsense" },
      {
        pageToken: OnCallPageLinkToken.sign({
          userOnCallLogTimelineId: OTHER_ITEM,
        }),
      },
    ]) {
      (Response.render as unknown as jest.Mock).mockClear();

      await call({
        method: "GET",
        uri: `${BASE}/pass-on-page/:itemId`,
        query: query,
      });

      const { path, variables } = rendered();

      expect(path).toBe("/usr/src/Common/Server/Views/ViewMessage.ejs");
      expect(variables["title"]).toBe(
        "This link cannot pass the page on - Checkout is down",
      );
      expect(variables["message"]).toBe(
        "This link cannot pass the page on: it is not valid, or it has expired. Use the link in the newest message you were paged with.",
      );
    }

    expect(previewSpy).not.toHaveBeenCalled();
    expect(passOnSpy).not.toHaveBeenCalled();
  });

  test("a page that is over says why, with the record one click away", async () => {
    previewSpy.mockResolvedValue({
      passedOn: false,
      refusal: OnCallPassOnRefusal.RecordAcknowledged,
      acknowledgedByName: "Bob Smith",
    });

    await call({
      method: "GET",
      uri: `${BASE}/pass-on-page/:itemId`,
      query: { pageToken: VALID_TOKEN() },
    });

    const { variables } = rendered();

    expect(variables["title"]).toBe("Already acknowledged - Checkout is down");
    expect(variables["message"]).toBe(
      "This incident was already acknowledged by Bob Smith, so there is nothing to pass on.",
    );
    expect(variables["viewDetailsText"]).toBe("View Incident");
    expect(variables["viewDetailsUrl"]).toBe(
      `https://oneuptime.example.com/dashboard/${PROJECT.toString()}/incidents/${INCIDENT.toString()}`,
    );
  });

  test("an id that is no id is refused before anything is read", async () => {
    const handler: RouterFunction = mockRouter.match(
      "GET",
      `${BASE}/pass-on-page/:itemId`,
    ).handlerFunction as RouterFunction;

    await handler(
      {
        params: { itemId: "not-an-id" },
        query: {},
      } as unknown as ExpressRequest,
      {} as unknown as ExpressResponse,
      (() => {}) as unknown as NextFunction,
    );

    expect(Response.sendErrorResponse).toHaveBeenCalledTimes(1);
    expect(UserOnCallLogTimelineService.findOneById).not.toHaveBeenCalled();
  });

  test("a notification that is gone is refused", async () => {
    jest
      .spyOn(UserOnCallLogTimelineService, "findOneById")
      .mockResolvedValue(null);

    await call({
      method: "GET",
      uri: `${BASE}/pass-on-page/:itemId`,
      query: { pageToken: VALID_TOKEN() },
    });

    expect(Response.render).not.toHaveBeenCalled();
    expect(Response.sendErrorResponse).toHaveBeenCalledTimes(1);
  });
});

describe("the pass-on button", () => {
  test("passes the person's page on, from this notification, and says what came of it", async () => {
    await call({
      method: "POST",
      uri: `${BASE}/pass-on/:itemId`,
      body: { pageToken: VALID_TOKEN() },
    });

    expect(passOnSpy).toHaveBeenCalledWith({
      userId: ANA,
      executionLogId: RUN,
      viaUserOnCallLogTimelineId: ITEM,
    });

    const { path, variables } = rendered();

    expect(path).toBe("/usr/src/Common/Server/Views/ViewMessage.ejs");
    expect(variables["title"]).toBe("You passed it on - Checkout is down");
    expect(variables["message"]).toBe(
      "Escalation rule 2 of 2 (Level 2) is paging Bob Smith now. You won't be paged about it again.",
    );
    expect(variables["viewDetailsText"]).toBe("View Incident");
  });

  test("reads the token from the form, not the address", async () => {
    await call({
      method: "POST",
      uri: `${BASE}/pass-on/:itemId`,
      query: { pageToken: VALID_TOKEN() },
      body: {},
    });

    expect(passOnSpy).not.toHaveBeenCalled();
    expect(rendered().variables["title"]).toBe(
      "This link cannot pass the page on - Checkout is down",
    );
  });

  test("a token for another notification passes nothing on: the id in a link cannot be swapped", async () => {
    await call({
      method: "POST",
      uri: `${BASE}/pass-on/:itemId`,
      body: {
        pageToken: OnCallPageLinkToken.sign({
          userOnCallLogTimelineId: OTHER_ITEM,
        }),
      },
    });

    expect(passOnSpy).not.toHaveBeenCalled();
  });

  test("says why when it could not", async () => {
    passOnSpy.mockResolvedValue({
      passedOn: false,
      refusal: OnCallPassOnRefusal.AlreadyPassedOn,
    } as OnCallPassOnAnswer);

    await call({
      method: "POST",
      uri: `${BASE}/pass-on/:itemId`,
      body: { pageToken: VALID_TOKEN() },
    });

    const { variables } = rendered();

    expect(variables["title"]).toBe("Already passed on - Checkout is down");
    expect(variables["message"]).toBe(
      "You passed this page on already. You won't be paged about it again.",
    );
  });
});

describe("a call's second key", () => {
  function sayOf(): string {
    const xml: jest.Mock = Response.sendXmlResponse as unknown as jest.Mock;

    expect(xml).toHaveBeenCalledTimes(1);

    return String(xml.mock.calls[0]![2]);
  }

  const CALL_TOKEN_DATA: JSONObject = {
    "1": { sayMessage: "You have acknowledged this incident. Good bye" },
    default: { sayMessage: "Invalid input. Good bye" },
  };

  async function press(digits: string, pageToken?: string): Promise<void> {
    await call({
      method: "POST",
      uri: `${BASE}/call/gather-input/:itemId`,
      query: pageToken ? { pageToken: pageToken, token: "call" } : {},
      body: { Digits: digits },
      extra: { callTokenData: CALL_TOKEN_DATA },
    });
  }

  test("passes the page on, and says what came of it", async () => {
    await press("2", VALID_TOKEN());

    expect(passOnSpy).toHaveBeenCalledWith({
      userId: ANA,
      executionLogId: RUN,
      viaUserOnCallLogTimelineId: ITEM,
    });
    expect(sayOf()).toContain(
      "You passed this incident on. Escalation rule 2 of 2 (Level 2) is paging Bob Smith now. Good bye.",
    );
  });

  test("says why when it could not", async () => {
    passOnSpy.mockResolvedValue({
      passedOn: false,
      refusal: OnCallPassOnRefusal.RecordAcknowledged,
    } as OnCallPassOnAnswer);

    await press("2", VALID_TOKEN());

    expect(sayOf()).toContain(
      "This incident is already acknowledged, so there is nothing to pass on. Good bye.",
    );
  });

  test("on a call that did not offer it - no token - is the wrong key, as it always was", async () => {
    await press("2");

    expect(passOnSpy).not.toHaveBeenCalled();
    expect(sayOf()).toContain("Invalid input. Good bye");
  });

  test("a token for another notification passes nothing on", async () => {
    await press(
      "2",
      OnCallPageLinkToken.sign({ userOnCallLogTimelineId: OTHER_ITEM }),
    );

    expect(passOnSpy).not.toHaveBeenCalled();
  });

  test("the first key still acknowledges, and passes nothing on", async () => {
    const updateSpy: jest.SpyInstance = jest
      .spyOn(UserOnCallLogTimelineService, "updateOneById")
      .mockResolvedValue(1 as never);

    await press("1", VALID_TOKEN());

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(passOnSpy).not.toHaveBeenCalled();
    expect(sayOf()).toContain("You have acknowledged this incident. Good bye");
  });
});
