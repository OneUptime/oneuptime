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
import DataMigrationService from "../../../Server/Services/DataMigrationService";
import IncidentService from "../../../Server/Services/IncidentService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import logger from "../../../Server/Utils/Logger";
import OnCallAcknowledgementTimeout from "../../../Server/Utils/OnCall/OnCallAcknowledgementTimeout";
import OnCallAcknowledgeLink, {
  ON_CALL_ACKNOWLEDGE_TOKEN_MIGRATION_NAME,
} from "../../../Server/Utils/OnCall/OnCallAcknowledgeLink";
import OnCallPageLinkToken from "../../../Server/Utils/OnCall/OnCallPageLinkToken";
import OnCallPagePassOn from "../../../Server/Utils/OnCall/OnCallPagePassOn";
import Response from "../../../Server/Utils/Response";
import DataMigration from "../../../Models/DatabaseModels/DataMigration";
import Incident from "../../../Models/DatabaseModels/Incident";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import User from "../../../Models/DatabaseModels/User";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { OnCallPassOnOutcome } from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import Timezone from "../../../Types/Timezone";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import {
  UpdateOneByInput,
  updateNotificationWhileStill,
} from "../TestingUtils/OnCallTimelineRows";
import { beforeAll, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A LINK ACKNOWLEDGES A PAGE ONLY WITH THE PAGE'S OWN TOKEN, AND ONLY WHEN
 * ITS BUTTON IS PRESSED (#10025).
 *
 * The acknowledge address used to acknowledge a page on a GET, with the
 * notification's id alone: anyone who knew the id - it is in every link and
 * call about it, in Twilio's request logs, and in what people who may read
 * the on-call policy can read - could take a page nobody had seen, and a
 * mail scanner or a link preview that followed the acknowledge page's
 * button did exactly that, and the page stopped paging. Now:
 *
 *   - opening a link changes nothing: the acknowledge page asks, and so
 *     does the acknowledge address itself when it is opened;
 *   - only the page's button acknowledges: a form that posts the page's
 *     token (OnCallPageLinkToken), which every link OneUptime sends carries;
 *   - a link without a valid token cannot acknowledge the page, says so,
 *     and still opens the record in the Dashboard;
 *   - a link sent before links carried a token - an email's, or the button
 *     of an acknowledge page drawn before this release - still acknowledges
 *     a page sent before the server was upgraded (or within the hour after,
 *     while the release before may still send them), for a week after it
 *     was sent (OnCallAcknowledgeLink).
 *
 * The database is stubbed throughout. It is 9 AM UTC on 19 November 2026,
 * and the server was upgraded at 6 AM.
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

const ITEM: ObjectID = new ObjectID("0fc00000-0000-4000-8000-000000000001");
const OTHER_ITEM: ObjectID = new ObjectID(
  "0fc00000-0000-4000-8000-000000000002",
);
const PROJECT: ObjectID = new ObjectID("0fc00000-0000-4000-8000-000000000003");
const INCIDENT: ObjectID = new ObjectID("0fc00000-0000-4000-8000-000000000004");
const RUN: ObjectID = new ObjectID("0fc00000-0000-4000-8000-000000000005");
const PERSON: ObjectID = new ObjectID("0fc00000-0000-4000-8000-0000000000a0");

const ACKNOWLEDGE_VIEW: string = "AcknowledgeUserOnCallNotification.ejs";
const MESSAGE_VIEW: string = "ViewMessage.ejs";

const HOUR_MS: number = 60 * 60 * 1000;
const DAY_MS: number = 24 * HOUR_MS;

const NOW: Date = new Date("2026-11-19T09:00:00.000Z");
const UPGRADED_AT: Date = new Date("2026-11-19T06:00:00.000Z");

const INCIDENT_URL: string = `https://oneuptime.example.com/dashboard/${PROJECT.toString()}/incidents/${INCIDENT.toString()}`;

const CANNOT_ACKNOWLEDGE: string =
  "This link cannot acknowledge the page: it is not valid, or it has expired. Use the link in the newest message you were paged with.";

const CANNOT_MARK_SEEN: string =
  "This link cannot mark the page as seen: it is not valid, or it has expired. Use the link in the newest message you were paged with.";

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

function pageToken(notification: ObjectID = ITEM): string {
  return OnCallPageLinkToken.sign({ userOnCallLogTimelineId: notification });
}

// A page link token signed eight days ago: past its week.
function expiredPageToken(): string {
  const clock: jest.SpyInstance = jest
    .spyOn(Date, "now")
    .mockReturnValue(Date.now() - 8 * DAY_MS);

  const token: string = pageToken();

  clock.mockRestore();

  return token;
}

// Opens a page, as a person - or a mail scanner - follows a link.
async function open(uri: string, query: JSONObject = {}): Promise<void> {
  const handler: RouterFunction = mockRouter.match("GET", uri)
    .handlerFunction as RouterFunction;

  await handler(
    {
      params: { itemId: ITEM.toString() },
      query: query,
      body: {},
    } as unknown as ExpressRequest,
    {} as unknown as ExpressResponse,
    ((err: unknown) => {
      throw err || new Error("the route handler must not fall through");
    }) as unknown as NextFunction,
  );
}

// Presses the page's Acknowledge button: its form, posted.
async function press(body: JSONObject, query: JSONObject = {}): Promise<void> {
  const handler: RouterFunction = mockRouter.match("POST", ACKNOWLEDGE_ROUTE)
    .handlerFunction as RouterFunction;

  await handler(
    {
      params: { itemId: ITEM.toString() },
      query: query,
      body: body,
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

// The page that says the link cannot acknowledge it - and changed nothing.
function expectCannotAcknowledge(sentence: string = CANNOT_ACKNOWLEDGE): void {
  const { path, variables } = rendered();

  expect(path).toContain(MESSAGE_VIEW);
  expect(variables["title"]).toBe("This link has expired - Checkout is down");
  expect(variables["message"]).toBe(sentence);
  // What the page is about, and the way to it in the Dashboard.
  expect(variables["resourceTitle"]).toBe("Checkout is down");
  expect(variables["viewDetailsText"]).toBe("View Incident");
  expect(variables["viewDetailsUrl"]).toBe(INCIDENT_URL);
  // Nothing to press.
  expect(variables["acknowledgeUrl"]).toBeUndefined();
  expect(variables["passOn"]).toBeUndefined();
  expect(updateSpy).not.toHaveBeenCalled();
  expect(Response.redirect).not.toHaveBeenCalled();
}

// The acknowledge page, its button a form that posts `token` (or nothing).
function expectAcknowledgeForm(token: string): JSONObject {
  const { path, variables } = rendered();

  expect(path).toContain(ACKNOWLEDGE_VIEW);
  expect(variables["acknowledgeText"]).toBe("Acknowledge Incident");
  expect(variables["acknowledgeUrl"]).toBe(
    `https://oneuptime.example.com/api/user-notification-log-timeline/acknowledge/${ITEM.toString()}`,
  );
  expect(variables["pageTokenParam"]).toBe("pageToken");
  expect(variables["pageToken"]).toBe(token);
  expect(updateSpy).not.toHaveBeenCalled();

  return variables;
}

function expectAcknowledged(): void {
  expect(updateSpy).toHaveBeenCalledTimes(1);
  expect(currentItem.status).toBe(UserNotificationStatus.Acknowledged);

  const redirect: jest.Mock = Response.redirect as unknown as jest.Mock;

  expect(redirect).toHaveBeenCalledTimes(1);
  expect(String(redirect.mock.calls[0]?.[2])).toBe(INCIDENT_URL);
}

let currentItem: UserOnCallLogTimeline;
let updateSpy: jest.SpyInstance;
let upgradeRead: jest.SpyInstance;
let previewSpy: jest.SpyInstance;
let findRun: jest.SpyInstance;

// The person's notification about the incident, sent `sentAgoMs` before now.
function givenSent(
  sentAgoMs: number,
  overrides: Partial<UserOnCallLogTimeline> = {},
): void {
  const item: UserOnCallLogTimeline = new UserOnCallLogTimeline();
  item.id = ITEM;
  item.status = UserNotificationStatus.Sent;
  item.version = 1;
  item.projectId = PROJECT;
  item.userId = PERSON;
  item.onCallDutyPolicyExecutionLogId = RUN;
  item.triggeredByIncidentId = INCIDENT;
  item.createdAt = new Date(NOW.getTime() - sentAgoMs);

  const user: User = new User();
  user.timezone = Timezone.UTC;
  item.user = user;

  Object.assign(item, overrides);

  currentItem = item;
}

// When the server was upgraded, as the DataMigrations table records it.
function givenUpgradedAt(at: Date | null): void {
  upgradeRead.mockImplementation(async (): Promise<DataMigration | null> => {
    if (!at) {
      return null;
    }

    const migration: DataMigration = new DataMigration();
    migration.name = ON_CALL_ACKNOWLEDGE_TOKEN_MIGRATION_NAME;
    migration.executed = true;
    migration.executedAt = at;

    return migration;
  });
}

function givenObserverPage(): void {
  const run: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  run.id = RUN;
  run.isObserverPage = true;
  findRun.mockResolvedValue(run);
}

beforeAll(() => {
  new UserNotificationLogTimelineAPI();
});

beforeEach(() => {
  jest.restoreAllMocks();
  OnCallAcknowledgeLink.forget();
  (Response.render as unknown as jest.Mock).mockClear();
  (Response.redirect as unknown as jest.Mock).mockClear();
  (Response.sendErrorResponse as unknown as jest.Mock).mockClear();

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(new Date(NOW));

  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname("oneuptime.example.com"));
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);

  // Sent an hour ago: after the upgrade.
  givenSent(HOUR_MS);

  jest
    .spyOn(UserOnCallLogTimelineService, "findOneById")
    .mockImplementation((async () => {
      return currentItem;
    }) as never);

  updateSpy = jest
    .spyOn(UserOnCallLogTimelineService, "updateOneBy")
    .mockImplementation((async (updateBy: UpdateOneByInput) => {
      return updateNotificationWhileStill(currentItem, updateBy);
    }) as never);

  upgradeRead = jest.spyOn(DataMigrationService, "findOneBy");
  givenUpgradedAt(UPGRADED_AT);

  // A responder's page nobody has answered, about an open incident.
  const run: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  run.id = RUN;
  run.isObserverPage = false;
  findRun = jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
    .mockResolvedValue(run);

  jest
    .spyOn(OnCallAcknowledgementTimeout, "readRecordStanding")
    .mockResolvedValue({ isAcknowledged: false, isResolved: false });

  const incident: Incident = new Incident();
  incident.title = "Checkout is down";
  jest.spyOn(IncidentService, "findOneById").mockResolvedValue(incident);

  previewSpy = jest.spyOn(OnCallPagePassOn, "getPreview").mockResolvedValue({
    passedOn: false,
    result: {
      outcome: OnCallPassOnOutcome.NextRulePaged,
      isPreview: true,
      isDirectPage: false,
      policyName: "Payments",
      rule: { order: 2, name: "Level 2" },
      pagedNames: [],
      stillPagedNames: [],
      ruleCount: 2,
    },
  });
});

describe("the acknowledge page a message's link opens", () => {
  test("with the page's token: Acknowledge is a form that posts the token, with Escalate beside it", async () => {
    const token: string = pageToken();

    await open(ACKNOWLEDGE_PAGE_ROUTE, { pageToken: token });

    const variables: JSONObject = expectAcknowledgeForm(token);

    expect(variables["passOn"]).toMatchObject({
      lead: "Can't take it?",
      token: token,
    });
  });

  test("without a token, on a page sent after the upgrade: it cannot acknowledge the page, says why, and still opens the incident", async () => {
    await open(ACKNOWLEDGE_PAGE_ROUTE);

    expectCannotAcknowledge();
    // Nothing is offered, so nothing about escalating is read.
    expect(previewSpy).not.toHaveBeenCalled();
  });

  test("with a token for another notification, a garbled one, or one past its week: the same", async () => {
    for (const token of [
      pageToken(OTHER_ITEM),
      "not.a.token",
      expiredPageToken(),
      // A token OneUptime signed for something else.
      JSONWebToken.signJsonPayload({ notification: ITEM.toString() }, 3600),
    ]) {
      (Response.render as unknown as jest.Mock).mockClear();

      await open(ACKNOWLEDGE_PAGE_ROUTE, { pageToken: token });

      expectCannotAcknowledge();
    }
  });

  test("an observer's page, without a valid token: it cannot mark the page as seen", async () => {
    givenObserverPage();

    await open(ACKNOWLEDGE_PAGE_ROUTE);

    expectCannotAcknowledge(CANNOT_MARK_SEEN);
  });

  test("a page somebody already took says so whatever the link carries: the page is over", async () => {
    jest
      .spyOn(OnCallAcknowledgementTimeout, "readRecordStanding")
      .mockResolvedValue({ isAcknowledged: true, isResolved: true });

    await open(ACKNOWLEDGE_PAGE_ROUTE);

    const { path, variables } = rendered();

    expect(path).toContain(MESSAGE_VIEW);
    expect(variables["title"]).toBe("Already resolved - Checkout is down");
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

/*
 * THE TRANSITION. A link sent before links carried a token - an email's
 * Acknowledge, an acknowledge page drawn before this release - has none.
 * It still acknowledges a page sent before the upgrade, or within the hour
 * after it while the release before may still be sending, for a week after
 * the page was sent: as long as a page's token lasts.
 */
describe("a link sent before links carried a token", () => {
  test("on a page sent before the upgrade, still asks, and its form posts no token", async () => {
    givenSent(DAY_MS);

    await open(ACKNOWLEDGE_PAGE_ROUTE);

    const variables: JSONObject = expectAcknowledgeForm("");

    // Escalating has always needed the page's token.
    expect(variables["passOn"]).toBeUndefined();
  });

  test("and its press acknowledges the page", async () => {
    givenSent(DAY_MS);

    await press({});

    expectAcknowledged();
  });

  test("a page sent six days and 23 hours ago: still in its week", async () => {
    givenSent(7 * DAY_MS - HOUR_MS);

    await press({});

    expectAcknowledged();
  });

  test("a page sent more than a week ago: its link has expired", async () => {
    givenSent(7 * DAY_MS + HOUR_MS);

    await press({});

    expectCannotAcknowledge();
  });

  test("a page sent within the hour after the upgrade: the release before may still have sent it", async () => {
    // Sent 59 minutes after the upgrade.
    givenSent(NOW.getTime() - UPGRADED_AT.getTime() - 59 * 60 * 1000);

    await press({});

    expectAcknowledged();
  });

  test("a page sent an hour and a minute after the upgrade: this release sent it, with its token", async () => {
    givenSent(NOW.getTime() - UPGRADED_AT.getTime() - 61 * 60 * 1000);

    await press({});

    expectCannotAcknowledge();
  });

  test("while the upgrade is not recorded yet, a page sent in the last week still asks, as it always did", async () => {
    givenUpgradedAt(null);
    givenSent(HOUR_MS);

    await open(ACKNOWLEDGE_PAGE_ROUTE);

    expectAcknowledgeForm("");
  });

  test("while the upgrade is not recorded yet, a page sent more than a week ago does not", async () => {
    givenUpgradedAt(null);
    givenSent(8 * DAY_MS);

    await open(ACKNOWLEDGE_PAGE_ROUTE);

    expectCannotAcknowledge();
  });

  test("when the upgrade's record cannot be read, it counts as not recorded yet - and the error says so, with no token in it", async () => {
    upgradeRead.mockRejectedValue(new Error("the database is away"));
    const errorSpy: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {});

    const token: string = pageToken(OTHER_ITEM);

    await open(ACKNOWLEDGE_PAGE_ROUTE, { pageToken: token });

    expectAcknowledgeForm("");

    const logged: string = errorSpy.mock.calls
      .map((call: Array<unknown>): string => {
        return String(call[0]);
      })
      .join("\n");

    expect(logged).toContain("OnCallAcknowledgeLink: could not read");
    expect(logged).not.toContain(token);
  });

  test("the upgrade is read from the data migration that records it", async () => {
    givenSent(DAY_MS);

    await open(ACKNOWLEDGE_PAGE_ROUTE);

    expect(upgradeRead).toHaveBeenCalledTimes(1);
    expect(
      (upgradeRead.mock.calls[0]![0] as { query: JSONObject }).query,
    ).toEqual({
      name: "RequireTokenToAcknowledgeOnCallPages",
      executed: true,
    });
  });

  test("a link with the page's token asks nothing of the upgrade", async () => {
    await open(ACKNOWLEDGE_PAGE_ROUTE, { pageToken: pageToken() });

    expect(upgradeRead).not.toHaveBeenCalled();
  });
});

/*
 * GET MUST NOT CHANGE STATE. Mail scanners - Outlook Safe Links and the
 * like - and chat link unfurlers open every link before the person does,
 * and some follow the links on the page they open. The acknowledge page's
 * button was a link to the acknowledge address, which acknowledged on a
 * GET: a scanner could take a page nobody had seen, and paging stopped.
 */
describe("opening the acknowledge address changes nothing", () => {
  test("it shows the acknowledge page, with a button that posts", async () => {
    const token: string = pageToken();

    await open(ACKNOWLEDGE_ROUTE, { pageToken: token });

    expectAcknowledgeForm(token);
    expect(Response.redirect).not.toHaveBeenCalled();
  });

  test("the button of an acknowledge page drawn before this release: the page, on a page sent before the upgrade", async () => {
    givenSent(DAY_MS);

    await open(ACKNOWLEDGE_ROUTE);

    expectAcknowledgeForm("");
    expect(Response.redirect).not.toHaveBeenCalled();
  });

  test("a scanner that opens every link, with or without a token, on any page, acknowledges nothing", async () => {
    for (const sentAgoMs of [HOUR_MS, DAY_MS, 8 * DAY_MS]) {
      for (const query of [{}, { pageToken: pageToken() }]) {
        for (const uri of [ACKNOWLEDGE_PAGE_ROUTE, ACKNOWLEDGE_ROUTE]) {
          givenSent(sentAgoMs);
          (Response.render as unknown as jest.Mock).mockClear();

          await open(uri, query);

          expect({
            uri,
            sentAgoMs,
            query,
            written: updateSpy.mock.calls,
          }).toEqual({ uri, sentAgoMs, query, written: [] });
          expect(currentItem.status).toBe(UserNotificationStatus.Sent);
        }
      }
    }

    expect(Response.redirect).not.toHaveBeenCalled();
  });

  test("an id that is no id is refused before anything is read", async () => {
    const findSpy: jest.SpyInstance = jest.spyOn(
      UserOnCallLogTimelineService,
      "findOneById",
    );

    for (const route of [ACKNOWLEDGE_PAGE_ROUTE, ACKNOWLEDGE_ROUTE]) {
      const handler: RouterFunction = mockRouter.match("GET", route)
        .handlerFunction as RouterFunction;

      await handler(
        {
          params: { itemId: "not-an-id" },
          query: {},
        } as unknown as ExpressRequest,
        {} as unknown as ExpressResponse,
        (() => {}) as unknown as NextFunction,
      );
    }

    expect(Response.sendErrorResponse).toHaveBeenCalledTimes(2);
    expect(findSpy).not.toHaveBeenCalled();
  });
});

describe("the Acknowledge button", () => {
  test("with the page's token: acknowledges the page, and opens the incident", async () => {
    await press({ pageToken: pageToken() });

    expectAcknowledged();
    expect(updateSpy.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        query: {
          _id: ITEM.toString(),
          status: UserNotificationStatus.Sent,
          version: 1,
        },
        data: expect.objectContaining({
          isAcknowledged: true,
          statusMessage: "Notification Acknowledged",
        }),
      }),
    );
  });

  test("reads the token from the form, not the address", async () => {
    await press({}, { pageToken: pageToken() });

    expectCannotAcknowledge();
  });

  test("without a token, on a page sent after the upgrade: acknowledges nothing, and says why", async () => {
    await press({});

    expectCannotAcknowledge();
  });

  test("with a token for another notification: the id in an address cannot be swapped", async () => {
    await press({ pageToken: pageToken(OTHER_ITEM) });

    expectCannotAcknowledge();
  });

  test("with a token past its week: acknowledges nothing", async () => {
    await press({ pageToken: expiredPageToken() });

    expectCannotAcknowledge();
  });

  test("an observer's page with its token is marked as seen", async () => {
    givenObserverPage();

    await press({ pageToken: pageToken() });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          statusMessage: "Marked as seen, paged as an observer",
        }),
      }),
    );
  });

  test("an observer's page without a valid token: it cannot mark the page as seen", async () => {
    givenObserverPage();

    await press({ pageToken: "nonsense" });

    expectCannotAcknowledge(CANNOT_MARK_SEEN);
  });

  test("a notification that is gone is refused", async () => {
    jest
      .spyOn(UserOnCallLogTimelineService, "findOneById")
      .mockResolvedValue(null);

    await press({ pageToken: pageToken() });

    expect(Response.sendErrorResponse).toHaveBeenCalledTimes(1);
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
