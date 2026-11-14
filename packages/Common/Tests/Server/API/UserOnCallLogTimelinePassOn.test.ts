/*
 * The alert/incident services reach the isolated-vm native addon through the
 * template renderer they import. Nothing here runs a sandbox.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import { mockRouter } from "./Helpers";
import UserNotificationLogTimelineAPI, {
  getPassOnFormLevels,
  readPassOnFormLevel,
} from "../../../Server/API/UserOnCallLogTimelineAPI";
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
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  ON_CALL_PASS_ON_NO_BREAK_SPACE,
  OnCallPassOnAnswer,
  OnCallPassOnOutcome,
  OnCallPassOnRefusal,
  OnCallPassOnResult,
} from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import Timezone from "../../../Types/Timezone";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import {
  MAX_NOTIFICATION_WRITE_ATTEMPTS,
  ON_CALL_CALL_NOT_ACKNOWLEDGED_SAY_MESSAGE,
} from "../../../Server/Utils/OnCall/OnCallNotificationStatus";
import {
  UpdateOneByInput,
  updateNotificationWhileStill,
} from "../TestingUtils/OnCallTimelineRows";
import { beforeAll, beforeEach, describe, expect, test } from "@jest/globals";

// The notification the routes read, and a call's first key acknowledges.
let currentItem: UserOnCallLogTimeline;

/*
 * "CAN'T TAKE IT? ESCALATE" FROM A PERSON'S OWN MESSAGES.
 *
 * Every message a page sends leads, through its links, to pages about that
 * one notification (UserOnCallLogTimelineAPI). These pin what those pages
 * do with escalating: the acknowledge page offers it beside Acknowledge for
 * a link that carries the page's own token; the escalate page asks first -
 * "Escalate this incident?", what it does, then that the person is not
 * paged again, in the order of the Dashboard's dialog - and posts a form;
 * the form escalates the page and says what came of it; and a call's second
 * key escalates it. Every way in refuses a link whose token was not signed
 * for that notification. The addresses keep the action's first name,
 * pass-on, so links already sent work.
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

/*
 * A phrase as a page draws it: its spaces are spaces no line breaks at, so
 * "Level 2 of 2" - or a time - stays on one line of a phone.
 */
function kept(phrase: string): string {
  return phrase.split(" ").join(ON_CALL_PASS_ON_NO_BREAK_SPACE);
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
  // A call, answered: as its provider left it, at the first version.
  item.status = UserNotificationStatus.Sent;
  item.version = 1;
  item.projectId = PROJECT;
  item.userId = ANA;
  item.onCallDutyPolicyExecutionLogId = RUN;
  item.triggeredByIncidentId = INCIDENT;
  currentItem = item;
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
  test("offers Can't take it? Escalate, for a link with the page's token", async () => {
    const token: string = VALID_TOKEN();

    await call({
      method: "GET",
      uri: `${BASE}/acknowledge-page/:itemId`,
      query: { pageToken: token },
    });

    const { variables } = rendered();

    expect(variables["passOn"]).toEqual({
      lead: "Can't take it?",
      explanation: `This will immediately page ${kept("Level 2 of 2")}, without waiting. You will not be paged again for this incident.`,
      buttonText: "Escalate",
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

  test("escalating that would leave nobody paged is a warning beside the button", async () => {
    previewSpy.mockResolvedValue({
      passedOn: false,
      result: preview(OnCallPassOnOutcome.PagingStopped),
    });

    await call({
      method: "GET",
      uri: `${BASE}/acknowledge-page/:itemId`,
      query: { pageToken: VALID_TOKEN() },
    });

    expect(rendered().variables["passOn"]).toMatchObject({
      lead: "Can't take it?",
      explanation: "You will not be paged again for this incident.",
      warning:
        "Nobody else is left to page: paging stops, and somebody needs to take it.",
    });
  });

  test("a page that cannot be escalated any more offers nothing", async () => {
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

describe("the escalate page", () => {
  test("asks first: what escalating would do, and a form that does it", async () => {
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
      title: "Escalate this incident?",
      // They followed "Can't take it? Escalate" here: it is not asked again.
      message: `This will immediately page ${kept("Level 2 of 2")}, without waiting. You will not be paged again for this incident.`,
      passOnText: "Escalate",
      passOnFormUrl: `https://oneuptime.example.com/api/user-notification-log-timeline/pass-on/${ITEM.toString()}`,
      pageTokenParam: "pageToken",
      pageToken: token,
      acknowledgeText: "Acknowledge Incident instead",
      acknowledgeUrl: `https://oneuptime.example.com/api/user-notification-log-timeline/acknowledge/${ITEM.toString()}`,
      resourceTitle: "Checkout is down",
    });
    expect(passOnSpy).not.toHaveBeenCalled();
  });

  test("names the next level as the maintainer's dialog does: its name, then its place", async () => {
    previewSpy.mockResolvedValue({
      passedOn: false,
      result: {
        ...preview(OnCallPassOnOutcome.NextRulePaged),
        rule: { order: 2, name: "Platform leads" },
      },
    });

    await call({
      method: "GET",
      uri: `${BASE}/pass-on-page/:itemId`,
      query: { pageToken: VALID_TOKEN() },
    });

    expect(rendered().variables).toMatchObject({
      title: "Escalate this incident?",
      // The name breaks where it needs to; "(Level 2 of 2)" never does.
      message: `This will immediately page Platform leads (${kept("Level 2 of 2")}), without waiting. You will not be paged again for this incident.`,
      passOnText: "Escalate",
    });
  });

  test("keeps the time the policy moves on on one line of a phone too", async () => {
    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(new Date("2026-10-16T03:00:00.000Z"));
    previewSpy.mockResolvedValue({
      passedOn: false,
      result: {
        ...preview(OnCallPassOnOutcome.OthersStillPaged),
        stillPagedNames: ["Bob Smith"],
        nextStepAt: new Date("2026-10-16T03:30:00.000Z"),
        nextRule: { order: 2, name: "Platform leads" },
      },
    });

    await call({
      method: "GET",
      uri: `${BASE}/pass-on-page/:itemId`,
      query: { pageToken: VALID_TOKEN() },
    });

    const message: string = rendered().variables["message"] as string;

    expect(message).toContain(
      `the policy pages Platform leads (${kept("Level 2 of 2")}) next.`,
    );
    expect(message).toContain(`If nobody acknowledges by ${kept("3:30 AM")}`);
    // Only those phrases: the rest of the sentence wraps as it always did.
    expect(message).toContain("Bob Smith is still being paged. If nobody");
  });

  test("never says the old words, whatever escalating would do", async () => {
    for (const outcome of Object.values(OnCallPassOnOutcome)) {
      previewSpy.mockResolvedValue({
        passedOn: false,
        result: preview(outcome),
      });
      (Response.render as unknown as jest.Mock).mockClear();

      await call({
        method: "GET",
        uri: `${BASE}/pass-on-page/:itemId`,
        query: { pageToken: VALID_TOKEN() },
      });

      const said: string = JSON.stringify(rendered().variables).toLowerCase();

      expect({ outcome, says: said.includes("pass it on") }).toEqual({
        outcome,
        says: false,
      });
      expect(said).not.toContain("pass on");
      expect(said).not.toContain("passed");
    }
  });

  test("without a valid token, says the link cannot escalate the page - and escalates nothing", async () => {
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
      // The heading says it in a few words; the sentence under it, why.
      expect(variables["title"]).toBe(
        "This link has expired - Checkout is down",
      );
      expect(variables["message"]).toBe(
        "This link cannot escalate the page: it is not valid, or it has expired. Use the link in the newest message you were paged with.",
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
      "This incident was already acknowledged by Bob Smith, so there is nothing to escalate.",
    );
    expect(variables["viewDetailsText"]).toBe("View Incident");
    expect(variables["viewDetailsUrl"]).toBe(
      `https://oneuptime.example.com/dashboard/${PROJECT.toString()}/incidents/${INCIDENT.toString()}`,
    );
  });

  test("a page that is over says so under a heading that does not say it twice", async () => {
    previewSpy.mockResolvedValue({
      passedOn: false,
      refusal: OnCallPassOnRefusal.PageOver,
    });

    await call({
      method: "GET",
      uri: `${BASE}/pass-on-page/:itemId`,
      query: { pageToken: VALID_TOKEN() },
    });

    const { variables } = rendered();

    expect(variables["title"]).toBe("Nothing to escalate - Checkout is down");
    expect(variables["message"]).toBe(
      "This page is over: the on-call policy has stopped paging.",
    );
  });

  test("escalating that would leave nobody paged is a warning of its own", async () => {
    previewSpy.mockResolvedValue({
      passedOn: false,
      result: preview(OnCallPassOnOutcome.PagingStopped),
    });

    await call({
      method: "GET",
      uri: `${BASE}/pass-on-page/:itemId`,
      query: { pageToken: VALID_TOKEN() },
    });

    const { path, variables } = rendered();

    expect(path).toBe(
      "/usr/src/Common/Server/Views/PassOnUserOnCallNotification.ejs",
    );
    expect(variables["message"]).toBe(
      "You will not be paged again for this incident.",
    );
    expect(variables["warning"]).toBe(
      "Nobody else is left to page: paging stops, and somebody needs to take it.",
    );
  });

  test("anything else it would do is no warning", async () => {
    for (const outcome of [
      OnCallPassOnOutcome.NextRulePaged,
      OnCallPassOnOutcome.PolicyStartedAgain,
      OnCallPassOnOutcome.OthersStillPaged,
      OnCallPassOnOutcome.AlreadyEscalated,
    ]) {
      (Response.render as unknown as jest.Mock).mockClear();
      previewSpy.mockResolvedValue({
        passedOn: false,
        result: preview(outcome),
      });

      await call({
        method: "GET",
        uri: `${BASE}/pass-on-page/:itemId`,
        query: { pageToken: VALID_TOKEN() },
      });

      expect(rendered().variables["warning"]).toBeUndefined();
    }
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

describe("the Escalate button", () => {
  test("escalates the person's page, from this notification, and says what came of it", async () => {
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
    expect(variables["title"]).toBe("Incident escalated - Checkout is down");
    expect(variables["message"]).toBe(
      `The policy is now paging ${kept("Level 2 of 2")}: Bob Smith. You will not be paged again for this incident.`,
    );
    expect(variables["viewDetailsText"]).toBe("View Incident");
  });

  test("escalated with nobody left to page: says so as a warning", async () => {
    passOnSpy.mockResolvedValue({
      passedOn: true,
      result: {
        ...preview(OnCallPassOnOutcome.PagingStopped),
        isPreview: false,
      },
    });

    await call({
      method: "POST",
      uri: `${BASE}/pass-on/:itemId`,
      body: { pageToken: VALID_TOKEN() },
    });

    const { path, variables } = rendered();

    expect(path).toBe("/usr/src/Common/Server/Views/ViewMessage.ejs");
    expect(variables["title"]).toBe("Incident escalated - Checkout is down");
    expect(variables["message"]).toBe(
      "You will not be paged again for this incident.",
    );
    expect(variables["warning"]).toBe(
      "Nobody else is left to page, so paging stopped. Somebody needs to take it.",
    );
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
      "This link has expired - Checkout is down",
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

    expect(variables["title"]).toBe("Already escalated - Checkout is down");
    expect(variables["message"]).toBe(
      "You escalated it already, so you will not be paged again for it.",
    );
  });
});

/*
 * PICKING THE LEVEL. With two or more levels after the person's, both pages
 * that escalate ask which to page - "Escalate to", a radio for each level,
 * the next one picked - and say until then that escalating pages the level
 * they pick. The next level's radio sends nothing, as a form without levels
 * does, so leaving it picked escalates exactly as before.
 */
describe("picking the level, with two or more after theirs", () => {
  const LEVEL_2_ID: string = "0f900000-0000-4000-8000-000000000012";
  const LEVEL_3_ID: string = "0f900000-0000-4000-8000-000000000013";

  const PICK_SENTENCE: string =
    "This will immediately page the level you pick, without waiting. You will not be paged again for this incident.";

  /*
   * Why the page asks again, above the levels as they are now: pick one
   * again - never "Escalate again to pick a level", which on this page
   * would have the person press Escalate with the next level picked.
   */
  const PICK_AGAIN: string =
    "The policy's levels have changed, so nothing was escalated. Pick a level and escalate again.";

  // With one level left after theirs there is nothing to pick.
  const LEVELS_CHANGED: string =
    "The policy's levels have changed, so nothing was escalated.";

  function withLevels(): OnCallPassOnResult {
    return {
      ...preview(OnCallPassOnOutcome.NextRulePaged),
      rule: { order: 2, name: "Platform leads" },
      ruleCount: 3,
      levelChoices: [
        { escalationRuleId: LEVEL_2_ID, order: 2, name: "Platform leads" },
        { escalationRuleId: LEVEL_3_ID, order: 3, name: "DBA leads" },
      ],
    };
  }

  const LEVELS: JSONObject = {
    label: "Escalate to",
    param: "escalationRuleId",
    options: [
      {
        value: "",
        label: `Platform leads (${kept("Level 2 of 3")})`,
        isPicked: true,
      },
      {
        value: LEVEL_3_ID,
        label: `DBA leads (${kept("Level 3 of 3")})`,
        isPicked: false,
      },
    ],
  };

  beforeEach(() => {
    previewSpy.mockResolvedValue({ passedOn: false, result: withLevels() });
  });

  test("the escalate page asks which, the next level picked", async () => {
    await call({
      method: "GET",
      uri: `${BASE}/pass-on-page/:itemId`,
      query: { pageToken: VALID_TOKEN() },
    });

    const { path, variables } = rendered();

    expect(path).toBe(
      "/usr/src/Common/Server/Views/PassOnUserOnCallNotification.ejs",
    );
    expect(variables["levelChoices"]).toEqual(LEVELS);
    expect(variables["message"]).toBe(PICK_SENTENCE);
    expect(variables["notice"]).toBeUndefined();
  });

  test("the acknowledge page's Can't take it? asks the same", async () => {
    await call({
      method: "GET",
      uri: `${BASE}/acknowledge-page/:itemId`,
      query: { pageToken: VALID_TOKEN() },
    });

    expect(rendered().variables["passOn"]).toMatchObject({
      lead: "Can't take it?",
      explanation: PICK_SENTENCE,
      levelChoices: LEVELS,
      buttonText: "Escalate",
    });
  });

  test("with one level after theirs there is nothing to pick: the page names the level", async () => {
    previewSpy.mockResolvedValue({
      passedOn: false,
      result: {
        ...withLevels(),
        ruleCount: 2,
        levelChoices: [
          { escalationRuleId: LEVEL_2_ID, order: 2, name: "Platform leads" },
        ],
      },
    });

    await call({
      method: "GET",
      uri: `${BASE}/pass-on-page/:itemId`,
      query: { pageToken: VALID_TOKEN() },
    });

    const { variables } = rendered();

    expect(variables["levelChoices"]).toBeUndefined();
    expect(variables["message"]).toBe(
      `This will immediately page Platform leads (${kept("Level 2 of 2")}), without waiting. You will not be paged again for this incident.`,
    );
  });

  test("a later level picked on the form is handed on", async () => {
    await call({
      method: "POST",
      uri: `${BASE}/pass-on/:itemId`,
      body: { pageToken: VALID_TOKEN(), escalationRuleId: LEVEL_3_ID },
    });

    expect(passOnSpy).toHaveBeenCalledTimes(1);

    const asked: { toEscalationRuleId?: ObjectID } = passOnSpy.mock
      .calls[0]![0] as { toEscalationRuleId?: ObjectID };

    expect(asked.toEscalationRuleId).toBeInstanceOf(ObjectID);
    expect(asked.toEscalationRuleId!.toString()).toBe(LEVEL_3_ID);
    expect(rendered().variables["title"]).toBe(
      "Incident escalated - Checkout is down",
    );
  });

  test("the next level, left picked, sends nothing: escalating pages it as before", async () => {
    await call({
      method: "POST",
      uri: `${BASE}/pass-on/:itemId`,
      body: { pageToken: VALID_TOKEN(), escalationRuleId: "" },
    });

    expect(
      (passOnSpy.mock.calls[0]![0] as { toEscalationRuleId?: ObjectID })
        .toEscalationRuleId,
    ).toBeUndefined();
  });

  test("a level not offered any more: the page asks again with the levels as they are, saying why", async () => {
    passOnSpy.mockResolvedValue({
      passedOn: false,
      refusal: OnCallPassOnRefusal.LevelNotAvailable,
    } as OnCallPassOnAnswer);

    const token: string = VALID_TOKEN();

    await call({
      method: "POST",
      uri: `${BASE}/pass-on/:itemId`,
      body: { pageToken: token, escalationRuleId: LEVEL_3_ID },
    });

    const { path, variables } = rendered();

    expect(path).toBe(
      "/usr/src/Common/Server/Views/PassOnUserOnCallNotification.ejs",
    );
    expect(variables["notice"]).toBe(PICK_AGAIN);
    // Read again: the levels as they are now.
    expect(previewSpy).toHaveBeenCalledTimes(1);
    expect(variables["levelChoices"]).toEqual(LEVELS);
    // The same link's token: one more press escalates.
    expect(variables["pageToken"]).toBe(token);
  });

  test("asked again with one level left after theirs, it says only what happened", async () => {
    passOnSpy.mockResolvedValue({
      passedOn: false,
      refusal: OnCallPassOnRefusal.LevelNotAvailable,
    } as OnCallPassOnAnswer);
    previewSpy.mockResolvedValue({
      passedOn: false,
      result: {
        ...withLevels(),
        ruleCount: 2,
        levelChoices: [
          { escalationRuleId: LEVEL_2_ID, order: 2, name: "Platform leads" },
        ],
      },
    });

    await call({
      method: "POST",
      uri: `${BASE}/pass-on/:itemId`,
      body: { pageToken: VALID_TOKEN(), escalationRuleId: LEVEL_3_ID },
    });

    const { variables } = rendered();

    expect(variables["notice"]).toBe(LEVELS_CHANGED);
    expect(variables["levelChoices"]).toBeUndefined();
    // What one more press does, as the page says it with nothing to pick.
    expect(variables["message"]).toBe(
      `This will immediately page Platform leads (${kept("Level 2 of 2")}), without waiting. You will not be paged again for this incident.`,
    );
  });

  test("a page opened from the link, not asked again, says no notice", async () => {
    await call({
      method: "GET",
      uri: `${BASE}/pass-on-page/:itemId`,
      query: { pageToken: VALID_TOKEN() },
    });

    expect(rendered().variables["notice"]).toBeUndefined();
  });

  test("a value that is no level escalates nothing, and asks again", async () => {
    for (const escalationRuleId of ["Level 3", "1 OR 1=1", "   x   "]) {
      (Response.render as unknown as jest.Mock).mockClear();
      passOnSpy.mockClear();

      await call({
        method: "POST",
        uri: `${BASE}/pass-on/:itemId`,
        body: { pageToken: VALID_TOKEN(), escalationRuleId: escalationRuleId },
      });

      expect(passOnSpy).not.toHaveBeenCalled();
      expect(rendered().variables["notice"]).toBe(PICK_AGAIN);
    }
  });

  test("asked again with nothing left to escalate, it says why instead", async () => {
    passOnSpy.mockResolvedValue({
      passedOn: false,
      refusal: OnCallPassOnRefusal.LevelNotAvailable,
    } as OnCallPassOnAnswer);
    previewSpy.mockResolvedValue({
      passedOn: false,
      refusal: OnCallPassOnRefusal.RecordAcknowledged,
      acknowledgedByName: "Bob Smith",
    });

    await call({
      method: "POST",
      uri: `${BASE}/pass-on/:itemId`,
      body: { pageToken: VALID_TOKEN(), escalationRuleId: LEVEL_3_ID },
    });

    const { path, variables } = rendered();

    expect(path).toBe("/usr/src/Common/Server/Views/ViewMessage.ejs");
    expect(variables["title"]).toBe("Already acknowledged - Checkout is down");
  });

  test("the form's levels, read on their own", () => {
    expect(getPassOnFormLevels(withLevels())).toEqual(LEVELS);
    expect(
      getPassOnFormLevels({ ...withLevels(), levelChoices: undefined }),
    ).toBeUndefined();

    expect(readPassOnFormLevel({})).toEqual({ isUnknown: false });
    expect(readPassOnFormLevel({ escalationRuleId: "" })).toEqual({
      isUnknown: false,
    });
    expect(readPassOnFormLevel(undefined)).toEqual({ isUnknown: false });
    expect(readPassOnFormLevel({ escalationRuleId: "Level 3" })).toEqual({
      isUnknown: true,
    });
    expect(readPassOnFormLevel({ escalationRuleId: ["a"] })).toEqual({
      isUnknown: true,
    });
    expect(
      readPassOnFormLevel({
        escalationRuleId: ` ${LEVEL_3_ID} `,
      }).escalationRuleId?.toString(),
    ).toBe(LEVEL_3_ID);
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

  test("escalates the page, and says what came of it", async () => {
    await press("2", VALID_TOKEN());

    expect(passOnSpy).toHaveBeenCalledWith({
      userId: ANA,
      executionLogId: RUN,
      viaUserOnCallLogTimelineId: ITEM,
    });
    expect(sayOf()).toContain(
      "You escalated this incident. The policy is now paging Level 2 of 2: Bob Smith. Good bye.",
    );
    // Read out, not drawn: plain spaces, never the page's no-break ones.
    expect(sayOf()).not.toContain(ON_CALL_PASS_ON_NO_BREAK_SPACE);
  });

  test("reads a time out on the person's own clock, without a date that day", async () => {
    const berlinItem: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    berlinItem.id = ITEM;
    berlinItem.projectId = PROJECT;
    berlinItem.userId = ANA;
    berlinItem.onCallDutyPolicyExecutionLogId = RUN;
    berlinItem.triggeredByIncidentId = INCIDENT;
    const user: User = new User();
    user.timezone = Timezone.EuropeBerlin;
    berlinItem.user = user;

    const findSpy: jest.SpyInstance = jest
      .spyOn(UserOnCallLogTimelineService, "findOneById")
      .mockResolvedValue(berlinItem);
    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(new Date("2026-10-16T03:00:00.000Z"));

    passOnSpy.mockResolvedValue({
      passedOn: true,
      result: {
        ...preview(OnCallPassOnOutcome.OthersStillPaged),
        isPreview: false,
        stillPagedNames: ["Bob Smith"],
        nextStepAt: new Date("2026-10-16T03:30:00.000Z"),
        nextRule: { order: 2, name: "Level 2" },
      },
    });

    await press("2", VALID_TOKEN());

    expect(
      (findSpy.mock.calls[0]![0] as { select: JSONObject }).select["user"],
    ).toEqual({ timezone: true });
    expect(sayOf()).toContain(
      "You escalated this incident. Bob Smith is still being paged. If nobody acknowledges by 5:30 AM CEST, the policy pages Level 2 of 2 next. Good bye.",
    );
    expect(sayOf()).not.toContain(ON_CALL_PASS_ON_NO_BREAK_SPACE);
  });

  test("says why when it could not", async () => {
    passOnSpy.mockResolvedValue({
      passedOn: false,
      refusal: OnCallPassOnRefusal.RecordAcknowledged,
    } as OnCallPassOnAnswer);

    await press("2", VALID_TOKEN());

    expect(sayOf()).toContain(
      "This incident is already acknowledged, so there is nothing to escalate. Good bye.",
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
      .spyOn(UserOnCallLogTimelineService, "updateOneBy")
      .mockImplementation((async (updateBy: UpdateOneByInput) => {
        return updateNotificationWhileStill(currentItem, updateBy);
      }) as never);

    await press("1", VALID_TOKEN());

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]![0]).toEqual({
      query: {
        _id: ITEM.toString(),
        status: UserNotificationStatus.Sent,
        version: 1,
      },
      data: expect.objectContaining({
        status: UserNotificationStatus.Acknowledged,
        statusMessage: "Notification Acknowledged",
        isAcknowledged: true,
      }),
      props: { isRoot: true },
    });
    expect(currentItem.status).toBe(UserNotificationStatus.Acknowledged);
    expect(passOnSpy).not.toHaveBeenCalled();
    expect(sayOf()).toContain("You have acknowledged this incident. Good bye");
  });

  test("the first key on a page acknowledged already, from another of its messages: written once, and the call still says so", async () => {
    currentItem.status = UserNotificationStatus.Acknowledged;
    currentItem.isAcknowledged = true;

    const updateSpy: jest.SpyInstance = jest
      .spyOn(UserOnCallLogTimelineService, "updateOneBy")
      .mockImplementation((async (updateBy: UpdateOneByInput) => {
        return updateNotificationWhileStill(currentItem, updateBy);
      }) as never);

    await press("1", VALID_TOKEN());

    expect(updateSpy).not.toHaveBeenCalled();
    expect(passOnSpy).not.toHaveBeenCalled();
    expect(sayOf()).toContain("You have acknowledged this incident. Good bye");
  });

  /*
   * A write lands before each of the first key's tries - the provider's
   * reports, say - moving the version on; `last` is the one before the
   * last try.
   */
  function changedUnderEveryTry(
    last: (item: UserOnCallLogTimeline) => void,
  ): jest.SpyInstance {
    let writes: number = 0;

    return jest
      .spyOn(UserOnCallLogTimelineService, "updateOneBy")
      .mockImplementation((async (updateBy: UpdateOneByInput) => {
        writes++;

        if (writes < MAX_NOTIFICATION_WRITE_ATTEMPTS) {
          currentItem.statusMessage = `Provider report ${writes}.`;
        } else {
          last(currentItem);
        }

        currentItem.version = (currentItem.version || 0) + 1;

        return updateNotificationWhileStill(currentItem, updateBy);
      }) as never);
  }

  test("the first key, when the notification kept changing under every try: says the page was not acknowledged", async () => {
    const updateSpy: jest.SpyInstance = changedUnderEveryTry(
      (item: UserOnCallLogTimeline) => {
        item.statusMessage = "Provider report, last.";
      },
    );

    await press("1", VALID_TOKEN());

    expect(updateSpy).toHaveBeenCalledTimes(MAX_NOTIFICATION_WRITE_ATTEMPTS);
    expect(currentItem.isAcknowledged).toBeFalsy();
    expect(sayOf()).toContain(ON_CALL_CALL_NOT_ACKNOWLEDGED_SAY_MESSAGE);
    expect(sayOf()).not.toContain("You have acknowledged");
    expect(passOnSpy).not.toHaveBeenCalled();
  });

  test("the first key, when the page was acknowledged meanwhile from another of its messages: the call still says so", async () => {
    changedUnderEveryTry((item: UserOnCallLogTimeline) => {
      item.status = UserNotificationStatus.Acknowledged;
      item.isAcknowledged = true;
    });

    await press("1", VALID_TOKEN());

    expect(sayOf()).toContain("You have acknowledged this incident. Good bye");
    expect(sayOf()).not.toContain(ON_CALL_CALL_NOT_ACKNOWLEDGED_SAY_MESSAGE);
  });
});
