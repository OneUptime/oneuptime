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
import IncidentService from "../../../Server/Services/IncidentService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import UserOnCallLogService from "../../../Server/Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  ON_CALL_TEST_PAGE_ACKNOWLEDGE_MESSAGE,
  ON_CALL_TEST_PAGE_ACKNOWLEDGE_TITLE,
  ON_CALL_TEST_PAGE_ANSWERED_MESSAGE,
  ON_CALL_TEST_PAGE_ANSWERED_TITLE,
  ON_CALL_TEST_PAGE_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import {
  UpdateOneByInput,
  updateNotificationWhileStill,
} from "../TestingUtils/OnCallTimelineRows";
import { beforeAll, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A TEST PAGE'S LINK (UserOnCallLogTimelineAPI, OnCallTestPage).
 *
 * A test page is about no record: its link opens a page of its own - TEST,
 * nothing is wrong, Acknowledge test page - and its Acknowledge says it
 * works, rather than sending the person to an incident that is not there
 * (or refusing them with "Invalid item Id"). Once they acknowledged it,
 * from this message or another of theirs, both say it works and change
 * nothing more.
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

const ACKNOWLEDGE_PAGE_ROUTE: string =
  "/user-notification-log-timeline/acknowledge-page/:itemId";

const ACKNOWLEDGE_ROUTE: string =
  "/user-notification-log-timeline/acknowledge/:itemId";

const ITEM: ObjectID = new ObjectID("7e5ad000-0000-4000-8000-000000000001");
const PROJECT: ObjectID = new ObjectID("7e5ad000-0000-4000-8000-000000000002");
const RUN: ObjectID = new ObjectID("7e5ad000-0000-4000-8000-000000000003");
const LOG: ObjectID = new ObjectID("7e5ad000-0000-4000-8000-000000000004");
const PERSON: ObjectID = new ObjectID("7e5ad000-0000-4000-8000-0000000000a0");

const NOW: Date = new Date("2026-11-11T09:00:00.000Z");

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

async function callRoute(uri: string, query: JSONObject = {}): Promise<void> {
  const handler: RouterFunction = mockRouter.match("GET", uri)
    .handlerFunction as RouterFunction;

  await handler(
    {
      params: { itemId: ITEM.toString() },
      query: query,
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

function testPageMessage(
  overrides: Partial<UserOnCallLogTimeline> = {},
): UserOnCallLogTimeline {
  const item: UserOnCallLogTimeline = new UserOnCallLogTimeline();
  item.id = ITEM;
  item.projectId = PROJECT;
  item.userId = PERSON;
  item.onCallDutyPolicyExecutionLogId = RUN;
  item.userNotificationLogId = LOG;
  item.userNotificationEventType = UserNotificationEventType.TestPage;
  item.isAcknowledged = false;
  // As the send left it, at the first version.
  item.status = UserNotificationStatus.Sent;
  item.version = 1;
  Object.assign(item, overrides);

  if (overrides.isAcknowledged && !overrides.status) {
    item.status = UserNotificationStatus.Acknowledged;
  }

  return item;
}

// The test page's message every read returns, and every write lands on.
let currentItem: UserOnCallLogTimeline;

function givenItem(item: UserOnCallLogTimeline): void {
  currentItem = item;
  findItem.mockResolvedValue(item as never);
}

let findItem: jest.SpyInstance;
let findLog: jest.SpyInstance;
let updateSpy: jest.SpyInstance;
let incidentRead: jest.SpyInstance;
let runRead: jest.SpyInstance;

beforeAll(() => {
  new UserNotificationLogTimelineAPI();
});

beforeEach(() => {
  jest.restoreAllMocks();
  (Response.render as unknown as jest.Mock).mockClear();
  (Response.redirect as unknown as jest.Mock).mockClear();
  (Response.sendErrorResponse as unknown as jest.Mock).mockClear();

  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname("oneuptime.example.com"));
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(new Date(NOW));

  findItem = jest.spyOn(UserOnCallLogTimelineService, "findOneById");
  givenItem(testPageMessage());

  findLog = jest
    .spyOn(UserOnCallLogService, "findOneById")
    .mockResolvedValue({ id: LOG, acknowledgedAt: undefined } as never);

  // Written as OnCallNotificationStatus writes: while still at the status and the version read.
  updateSpy = jest
    .spyOn(UserOnCallLogTimelineService, "updateOneBy")
    .mockImplementation((async (updateBy: UpdateOneByInput) => {
      return updateNotificationWhileStill(currentItem, updateBy);
    }) as never);

  // A test reads no record and no run to draw its page.
  incidentRead = jest
    .spyOn(IncidentService, "findOneById")
    .mockResolvedValue(null as never);
  runRead = jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
    .mockResolvedValue(null as never);
});

describe("a test page's link", () => {
  test("opens a page of its own: TEST, nothing is wrong, Acknowledge test page", async () => {
    await callRoute(ACKNOWLEDGE_PAGE_ROUTE);

    const { path, variables } = rendered();

    expect(path).toContain("AcknowledgeUserOnCallNotification.ejs");
    expect(variables).toEqual({
      title: ON_CALL_TEST_PAGE_ACKNOWLEDGE_TITLE,
      message: ON_CALL_TEST_PAGE_ACKNOWLEDGE_MESSAGE,
      acknowledgeText: ON_CALL_TEST_PAGE_ACKNOWLEDGE_TITLE,
      acknowledgeUrl: `https://oneuptime.example.com/api/user-notification-log-timeline/acknowledge/${ITEM.toString()}`,
    });
    expect(ON_CALL_TEST_PAGE_ACKNOWLEDGE_TITLE).toBe("Acknowledge test page");
    expect(ON_CALL_TEST_PAGE_ACKNOWLEDGE_MESSAGE).toBe(
      "This is a test page. Nothing is wrong: acknowledge it to show that on-call pages reach you.",
    );
    // No Escalate: a test is acknowledged, never passed on.
    expect(variables["passOn"]).toBeUndefined();
    expect(incidentRead).not.toHaveBeenCalled();
    expect(runRead).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("once acknowledged from this message, says it works, with nothing to press", async () => {
    givenItem(testPageMessage({ isAcknowledged: true }));

    await callRoute(ACKNOWLEDGE_PAGE_ROUTE);

    const { path, variables } = rendered();

    expect(path).toContain("ViewMessage.ejs");
    expect(variables).toEqual({
      title: ON_CALL_TEST_PAGE_ANSWERED_TITLE,
      message: ON_CALL_TEST_PAGE_ANSWERED_MESSAGE,
      statusIcon: "check",
    });
  });

  test("once acknowledged from another of the person's messages, says so too", async () => {
    findLog.mockResolvedValue({ id: LOG, acknowledgedAt: NOW } as never);

    await callRoute(ACKNOWLEDGE_PAGE_ROUTE);

    expect(rendered().path).toContain("ViewMessage.ejs");
  });
});

describe("a test page's Acknowledge", () => {
  test("acknowledges the message, and says it works - no redirect to a record", async () => {
    await callRoute(ACKNOWLEDGE_ROUTE);

    expect(updateSpy).toHaveBeenCalledWith({
      query: {
        _id: ITEM.toString(),
        status: UserNotificationStatus.Sent,
        version: 1,
      },
      data: {
        acknowledgedAt: NOW,
        isAcknowledged: true,
        status: UserNotificationStatus.Acknowledged,
        statusMessage: ON_CALL_TEST_PAGE_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
      },
      props: { isRoot: true },
    });
    expect(currentItem.status).toBe(UserNotificationStatus.Acknowledged);
    expect(Response.redirect).not.toHaveBeenCalled();
    expect(Response.sendErrorResponse).not.toHaveBeenCalled();

    const { path, variables } = rendered();

    expect(path).toContain("ViewMessage.ejs");
    expect(variables["title"]).toBe("Test page acknowledged");
  });

  test("pressed twice at once: the second press finds it acknowledged, writes nothing, and still says it works", async () => {
    let pressedMeanwhile: boolean = false;

    updateSpy.mockImplementation((async (updateBy: UpdateOneByInput) => {
      if (!pressedMeanwhile) {
        // The other press lands first.
        pressedMeanwhile = true;
        currentItem.status = UserNotificationStatus.Acknowledged;
        currentItem.isAcknowledged = true;
        currentItem.version = (currentItem.version || 0) + 1;
      }

      return updateNotificationWhileStill(currentItem, updateBy);
    }) as never);

    await callRoute(ACKNOWLEDGE_ROUTE);

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(Response.sendErrorResponse).not.toHaveBeenCalled();
    expect(rendered().variables["title"]).toBe("Test page acknowledged");
  });

  test("pressed again, changes nothing and says it works", async () => {
    givenItem(testPageMessage({ isAcknowledged: true }));

    await callRoute(ACKNOWLEDGE_ROUTE);

    expect(updateSpy).not.toHaveBeenCalled();
    expect(rendered().variables["title"]).toBe("Test page acknowledged");
  });

  test("after another of the person's messages was acknowledged, changes nothing", async () => {
    findLog.mockResolvedValue({ id: LOG, acknowledgedAt: NOW } as never);

    await callRoute(ACKNOWLEDGE_ROUTE);

    expect(updateSpy).not.toHaveBeenCalled();
    expect(rendered().path).toContain("ViewMessage.ejs");
  });
});
