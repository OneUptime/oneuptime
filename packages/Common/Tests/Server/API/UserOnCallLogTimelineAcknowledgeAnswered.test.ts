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
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentService from "../../../Server/Services/IncidentService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import UserService from "../../../Server/Services/UserService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import OnCallAcknowledgementTimeout, {
  OnCallTimeoutRecordStanding,
} from "../../../Server/Utils/OnCall/OnCallAcknowledgementTimeout";
import OnCallPageLinkToken, {
  ON_CALL_PAGE_LINK_TOKEN_PARAM,
} from "../../../Server/Utils/OnCall/OnCallPageLinkToken";
import OnCallPagePassOn from "../../../Server/Utils/OnCall/OnCallPagePassOn";
import Response from "../../../Server/Utils/Response";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import User from "../../../Models/DatabaseModels/User";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import {
  ON_CALL_PASS_ON_NO_BREAK_SPACE,
  OnCallPassOnOutcome,
} from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import Timezone from "../../../Types/Timezone";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import {
  MAX_NOTIFICATION_WRITE_ATTEMPTS,
  ON_CALL_NOTIFICATION_NOT_ACKNOWLEDGED_MESSAGE,
} from "../../../Server/Utils/OnCall/OnCallNotificationStatus";
import {
  UpdateOneByInput,
  updateNotificationWhileStill,
} from "../TestingUtils/OnCallTimelineRows";
import { beforeAll, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE ACKNOWLEDGE PAGE ONCE THE PAGE IS OVER, AND ITS "VIEW INCIDENT"
 * (https://github.com/OneUptime/oneuptime/issues/6706).
 *
 * A message's link opens the acknowledge page. It asked "Do you want to
 * acknowledge this Incident?" whatever had happened since - a colleague
 * acknowledged it, the person answered another of their messages, the
 * incident moved on to a state after Acknowledged or was resolved - and it
 * had no way to the incident itself. These pin what the route hands its
 * views now: the record's own link under Acknowledge, and, once the page is
 * over, why - with no Acknowledge - by the rule the worker ends a person's
 * page with (OnCallAcknowledgePage). The address the button opens asks
 * again, so a page left open does not acknowledge a taken incident.
 *
 * The database is stubbed throughout: the run, the record's standing
 * (OnCallAcknowledgementTimeout.readRecordStanding, with who took it there and
 * when - issue #6711), the people's names and the context. It is 9 AM UTC on
 * 11 November 2026, so a time that day reads "at 3:01 AM UTC".
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

const ITEM: ObjectID = new ObjectID("0f670600-0000-4000-8000-000000000001");
const PROJECT: ObjectID = new ObjectID("0f670600-0000-4000-8000-000000000002");
const RECORD: ObjectID = new ObjectID("0f670600-0000-4000-8000-000000000003");
const RUN: ObjectID = new ObjectID("0f670600-0000-4000-8000-000000000004");
const POLICY: ObjectID = new ObjectID("0f670600-0000-4000-8000-000000000005");
const PERSON: ObjectID = new ObjectID("0f670600-0000-4000-8000-0000000000a0");
const ANA: ObjectID = new ObjectID("0f670600-0000-4000-8000-0000000000a1");

const ACKNOWLEDGE_VIEW: string = "AcknowledgeUserOnCallNotification.ejs";
const MESSAGE_VIEW: string = "ViewMessage.ejs";

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

type RecordKind = "incident" | "alert" | "alert episode" | "incident episode";

// A person's message about a record of `kind`, part of run RUN.
function timelineItem(
  kind: RecordKind | null,
  overrides: Partial<UserOnCallLogTimeline> = {},
): UserOnCallLogTimeline {
  const item: UserOnCallLogTimeline = new UserOnCallLogTimeline();
  item.id = ITEM;
  // As the send left it, at the first version.
  item.status = UserNotificationStatus.Sent;
  item.version = 1;
  item.projectId = PROJECT;
  item.userId = PERSON;
  item.onCallDutyPolicyExecutionLogId = RUN;

  if (kind === "incident") {
    item.triggeredByIncidentId = RECORD;
  }

  if (kind === "alert") {
    item.triggeredByAlertId = RECORD;
  }

  if (kind === "alert episode") {
    item.triggeredByAlertEpisodeId = RECORD;
  }

  if (kind === "incident episode") {
    item.triggeredByIncidentEpisodeId = RECORD;
  }

  const user: User = new User();
  user.timezone = Timezone.UTC;
  item.user = user;

  Object.assign(item, overrides);

  if (overrides.isAcknowledged && !overrides.status) {
    item.status = UserNotificationStatus.Acknowledged;
  }

  return item;
}

// A run of an on-call policy - a responder's page - nobody has answered.
function policyRun(
  overrides: Partial<OnCallDutyPolicyExecutionLog> = {},
): OnCallDutyPolicyExecutionLog {
  const run: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  run.id = RUN;
  run.onCallDutyPolicyId = POLICY;
  run.isObserverPage = false;
  Object.assign(run, overrides);
  return run;
}

// A page a person asked for from Slack or Microsoft Teams: no policy, started by a person.
function personPageRun(): OnCallDutyPolicyExecutionLog {
  const run: OnCallDutyPolicyExecutionLog = policyRun({
    triggeredByUserId: ANA,
  });
  delete run.onCallDutyPolicyId;
  return run;
}

function answeredBy(
  userId: ObjectID,
  name: string,
): Partial<OnCallDutyPolicyExecutionLog> {
  const user: User = new User();
  user.name = new Name(name);
  user.email = new Email("ana@example.com");

  return {
    acknowledgedAt: new Date("2026-11-11T03:01:35.000Z"),
    acknowledgedByUserId: userId,
    acknowledgedByUser: user,
  };
}

let findItem: jest.SpyInstance;
let findRun: jest.SpyInstance;
let recordState: jest.SpyInstance;
let previewSpy: jest.SpyInstance;
let updateSpy: jest.SpyInstance;

// The notification every read returns, and every write lands on.
let currentItem: UserOnCallLogTimeline;

function givenItem(item: UserOnCallLogTimeline): void {
  currentItem = item;
  findItem.mockResolvedValue(item);
}

function givenRun(run: OnCallDutyPolicyExecutionLog | null): void {
  findRun.mockResolvedValue(run);
}

function givenRecord(state: OnCallTimeoutRecordStanding | null): void {
  recordState.mockResolvedValue(state);
}

const ACKNOWLEDGED: OnCallTimeoutRecordStanding = {
  isAcknowledged: true,
  isResolved: false,
};

const RESOLVED: OnCallTimeoutRecordStanding = {
  isAcknowledged: true,
  isResolved: true,
};

const OPEN: OnCallTimeoutRecordStanding = {
  isAcknowledged: false,
  isResolved: false,
};

const NOW: Date = new Date("2026-11-11T09:00:00.000Z");

// A time as the page writes it: on one line of a phone.
function kept(phrase: string): string {
  return phrase.split(" ").join(ON_CALL_PASS_ON_NO_BREAK_SPACE);
}

// When answeredBy's run was answered, as the page says it.
const AT_ANSWERED: string = `at ${kept("3:01 AM UTC")}`;

const ACKNOWLEDGED_AT: Date = new Date("2026-11-11T02:15:00.000Z");
const RESOLVED_AT: Date = new Date("2026-11-11T04:40:00.000Z");

const NAMES: Record<string, string> = {
  [ANA.toString()]: "Ana Lopez",
  [PERSON.toString()]: "Sam Rivera",
};

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

  findItem = jest.spyOn(UserOnCallLogTimelineService, "findOneById");
  givenItem(timelineItem("incident"));

  findRun = jest.spyOn(OnCallDutyPolicyExecutionLogService, "findOneById");
  givenRun(policyRun());

  recordState = jest.spyOn(OnCallAcknowledgementTimeout, "readRecordStanding");
  givenRecord(OPEN);

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(new Date(NOW));

  jest.spyOn(UserService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
  }) => {
    const user: User = new User();
    user.id = data.id;
    user.name = new Name(NAMES[data.id.toString()] || "Someone");
    return user;
  }) as never);

  // The context the page shows: the incident as the Dashboard has it.
  const incident: Incident = new Incident();
  incident.title = "Checkout is down";
  incident.incidentNumberWithPrefix = "INC-7";
  const state: IncidentState = new IncidentState();
  state.name = "Monitor";
  incident.currentIncidentState = state;
  jest.spyOn(IncidentService, "findOneById").mockResolvedValue(incident);

  const alert: Alert = new Alert();
  alert.title = "CPU above 90%";
  alert.alertNumberWithPrefix = "ALT-42";
  jest.spyOn(AlertService, "findOneById").mockResolvedValue(alert);

  const alertEpisode: AlertEpisode = new AlertEpisode();
  alertEpisode.title = "Elevated error rate";
  alertEpisode.episodeNumberWithPrefix = "AEP-3";
  jest
    .spyOn(AlertEpisodeService, "findOneById")
    .mockResolvedValue(alertEpisode);

  const incidentEpisode: IncidentEpisode = new IncidentEpisode();
  incidentEpisode.title = "Payments degradation";
  incidentEpisode.episodeNumberWithPrefix = "IEP-9";
  jest
    .spyOn(IncidentEpisodeService, "findOneById")
    .mockResolvedValue(incidentEpisode);

  previewSpy = jest.spyOn(OnCallPagePassOn, "getPreview").mockResolvedValue({
    passedOn: false,
  });

  /*
   * The acknowledgement is written as OnCallNotificationStatus writes it:
   * only while the notification still holds the status and the version read.
   */
  updateSpy = jest
    .spyOn(UserOnCallLogTimelineService, "updateOneBy")
    .mockImplementation((async (updateBy: UpdateOneByInput) => {
      return updateNotificationWhileStill(currentItem, updateBy);
    }) as never);
});

describe("the acknowledge page links the record in the Dashboard", () => {
  test.each([
    [
      "incident" as RecordKind,
      "View Incident",
      `https://oneuptime.example.com/dashboard/${PROJECT.toString()}/incidents/${RECORD.toString()}`,
    ],
    [
      "alert" as RecordKind,
      "View Alert",
      `https://oneuptime.example.com/dashboard/${PROJECT.toString()}/alerts/${RECORD.toString()}`,
    ],
    [
      "alert episode" as RecordKind,
      "View Alert Episode",
      `https://oneuptime.example.com/dashboard/${PROJECT.toString()}/alerts/episodes/${RECORD.toString()}`,
    ],
    [
      "incident episode" as RecordKind,
      "View Incident Episode",
      `https://oneuptime.example.com/dashboard/${PROJECT.toString()}/incidents/episodes/${RECORD.toString()}`,
    ],
  ])("an %s: %p", async (kind: RecordKind, text: string, url: string) => {
    givenItem(timelineItem(kind));

    await callRoute(ACKNOWLEDGE_PAGE_ROUTE);

    const { path, variables } = rendered();

    expect(path).toContain(ACKNOWLEDGE_VIEW);
    expect(variables["viewDetailsText"]).toBe(text);
    expect(variables["viewDetailsUrl"]).toBe(url);
  });

  test("beside Acknowledge, which is still offered and still asks first", async () => {
    await callRoute(ACKNOWLEDGE_PAGE_ROUTE);

    const { variables } = rendered();

    expect(variables["title"]).toBe("Acknowledge Incident - Checkout is down");
    expect(variables["message"]).toBe(
      "Do you want to acknowledge this Incident?",
    );
    expect(variables["acknowledgeText"]).toBe("Acknowledge Incident");
    expect(variables["acknowledgeUrl"]).toBe(
      `https://oneuptime.example.com/api/user-notification-log-timeline/acknowledge/${ITEM.toString()}`,
    );
  });

  test("an observer's page links it too, beside I've seen it", async () => {
    givenRun(policyRun({ isObserverPage: true }));

    await callRoute(ACKNOWLEDGE_PAGE_ROUTE);

    const { path, variables } = rendered();

    expect(path).toContain(ACKNOWLEDGE_VIEW);
    expect(variables["acknowledgeText"]).toBe("I've seen it");
    expect(variables["viewDetailsText"]).toBe("View Incident");
  });

  test("a notification that points at nothing gets no link to a page that is not there", async () => {
    givenItem(timelineItem(null));

    await callRoute(ACKNOWLEDGE_PAGE_ROUTE);

    const { path, variables } = rendered();

    expect(path).toContain(ACKNOWLEDGE_VIEW);
    expect(variables["viewDetailsUrl"]).toBe("");
  });

  test("the record's standing is read for the record the page shows", async () => {
    givenItem(timelineItem("alert episode"));

    await callRoute(ACKNOWLEDGE_PAGE_ROUTE);

    expect(recordState).toHaveBeenCalledWith({
      kind: "alert episode",
      recordId: RECORD,
    });
  });
});

describe("the acknowledge page once the page is over offers no Acknowledge", () => {
  test("a colleague answered their page: it says who, under a check, with the incident and its link", async () => {
    givenRun(policyRun(answeredBy(ANA, "Ana Lopez")));
    givenRecord(ACKNOWLEDGED);

    await callRoute(ACKNOWLEDGE_PAGE_ROUTE, {
      [ON_CALL_PAGE_LINK_TOKEN_PARAM]: OnCallPageLinkToken.sign({
        userOnCallLogTimelineId: ITEM,
      }),
    });

    const { path, variables } = rendered();

    expect(path).toContain(MESSAGE_VIEW);
    expect(variables["title"]).toBe("Already acknowledged - Checkout is down");
    expect(variables["message"]).toBe(
      `Incident INC-7 was already acknowledged by Ana Lopez ${AT_ANSWERED}.`,
    );
    expect(variables["statusIcon"]).toBe("check");
    expect(variables["viewDetailsText"]).toBe("View Incident");
    expect(variables["viewDetailsUrl"]).toBe(
      `https://oneuptime.example.com/dashboard/${PROJECT.toString()}/incidents/${RECORD.toString()}`,
    );
    // What it is about, as the acknowledge page showed it.
    expect(variables["resourceNumber"]).toBe("INC-7");
    expect(variables["resourceTitle"]).toBe("Checkout is down");
    expect(variables["details"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Current State", value: "Monitor" }),
      ]),
    );
    // Nothing to acknowledge, and nothing to escalate either.
    expect(variables["acknowledgeUrl"]).toBeUndefined();
    expect(variables["acknowledgeText"]).toBeUndefined();
    expect(variables["passOn"]).toBeUndefined();
    expect(previewSpy).not.toHaveBeenCalled();
  });

  test("moved on to a state after Acknowledged in the Dashboard - the issue's screenshot - says it is acknowledged", async () => {
    givenRecord(ACKNOWLEDGED);

    await callRoute(ACKNOWLEDGE_PAGE_ROUTE);

    const { path, variables } = rendered();

    expect(path).toContain(MESSAGE_VIEW);
    expect(variables["title"]).toBe("Already acknowledged - Checkout is down");
    expect(variables["message"]).toBe(
      "Incident INC-7 is already acknowledged.",
    );
  });

  test("resolved", async () => {
    givenRecord(RESOLVED);

    await callRoute(ACKNOWLEDGE_PAGE_ROUTE);

    const { path, variables } = rendered();

    expect(path).toContain(MESSAGE_VIEW);
    expect(variables["title"]).toBe("Already resolved - Checkout is down");
    expect(variables["message"]).toBe("Incident INC-7 is already resolved.");
    expect(variables["statusIcon"]).toBe("check");
  });

  test("the person answered another of their messages", async () => {
    givenRun(policyRun(answeredBy(PERSON, "Sam Rivera")));
    givenRecord(ACKNOWLEDGED);

    await callRoute(ACKNOWLEDGE_PAGE_ROUTE);

    const { variables } = rendered();

    expect(variables["title"]).toBe("Already acknowledged - Checkout is down");
    expect(variables["message"]).toBe(
      `You already acknowledged Incident INC-7 ${AT_ANSWERED}.`,
    );
  });

  test("this very message was answered from its own link", async () => {
    givenItem(timelineItem("incident", { isAcknowledged: true }));

    await callRoute(ACKNOWLEDGE_PAGE_ROUTE);

    const { path, variables } = rendered();

    expect(path).toContain(MESSAGE_VIEW);
    expect(variables["message"]).toBe(
      "You already acknowledged Incident INC-7.",
    );
  });

  test("a record without a number is 'this incident'", async () => {
    const incident: Incident = new Incident();
    incident.title = "Checkout is down";
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(incident);
    givenRun(policyRun(answeredBy(ANA, "Ana Lopez")));
    givenRecord(ACKNOWLEDGED);

    await callRoute(ACKNOWLEDGE_PAGE_ROUTE);

    expect(rendered().variables["message"]).toBe(
      `This incident was already acknowledged by Ana Lopez ${AT_ANSWERED}.`,
    );
  });

  test("an alert episode says so in its own words", async () => {
    givenItem(timelineItem("alert episode"));
    givenRun(policyRun(answeredBy(ANA, "Ana Lopez")));
    givenRecord(ACKNOWLEDGED);

    await callRoute(ACKNOWLEDGE_PAGE_ROUTE);

    const { variables } = rendered();

    expect(variables["title"]).toBe(
      "Already acknowledged - Elevated error rate",
    );
    expect(variables["message"]).toBe(
      `Alert Episode AEP-3 was already acknowledged by Ana Lopez ${AT_ANSWERED}.`,
    );
    expect(variables["viewDetailsText"]).toBe("View Alert Episode");
  });

  test("an observer's page another observer answered is marked as seen, never acknowledged", async () => {
    givenRun(
      policyRun({ isObserverPage: true, ...answeredBy(ANA, "Ana Lopez") }),
    );
    givenRecord(ACKNOWLEDGED);

    await callRoute(ACKNOWLEDGE_PAGE_ROUTE);

    const { path, variables } = rendered();

    expect(path).toContain(MESSAGE_VIEW);
    expect(variables["title"]).toBe(
      "Already marked as seen - Checkout is down",
    );
    expect(variables["message"]).toBe(
      `Ana Lopez already marked this page as seen ${AT_ANSWERED}.`,
    );
  });
});

describe("who took it, and when, off the incident's own timeline (#6711)", () => {
  test("acknowledged in the Dashboard by a colleague: who, and when", async () => {
    givenRecord({
      ...ACKNOWLEDGED,
      acknowledgement: { createdByUserId: ANA, startsAt: ACKNOWLEDGED_AT },
    });

    await callRoute(ACKNOWLEDGE_PAGE_ROUTE);

    const { path, variables } = rendered();

    expect(path).toContain(MESSAGE_VIEW);
    expect(variables["message"]).toBe(
      `Incident INC-7 was already acknowledged by Ana Lopez at ${kept("2:15 AM UTC")}.`,
    );
  });

  test("acknowledged in the Dashboard by the person themselves: theirs", async () => {
    givenRecord({
      ...ACKNOWLEDGED,
      acknowledgement: { createdByUserId: PERSON, startsAt: ACKNOWLEDGED_AT },
    });

    await callRoute(ACKNOWLEDGE_PAGE_ROUTE);

    expect(rendered().variables["message"]).toBe(
      `You already acknowledged Incident INC-7 at ${kept("2:15 AM UTC")}.`,
    );
  });

  test("acknowledged by a workflow: when, without who", async () => {
    givenRecord({
      ...ACKNOWLEDGED,
      acknowledgement: { createdByUserId: null, startsAt: ACKNOWLEDGED_AT },
    });

    await callRoute(ACKNOWLEDGE_PAGE_ROUTE);

    expect(rendered().variables["message"]).toBe(
      `Incident INC-7 was already acknowledged at ${kept("2:15 AM UTC")}.`,
    );
  });

  test("resolved by a colleague: who, and when", async () => {
    givenRecord({
      ...RESOLVED,
      acknowledgement: { createdByUserId: ANA, startsAt: ACKNOWLEDGED_AT },
      resolution: { createdByUserId: ANA, startsAt: RESOLVED_AT },
    });

    await callRoute(ACKNOWLEDGE_PAGE_ROUTE);

    const { variables } = rendered();

    expect(variables["title"]).toBe("Already resolved - Checkout is down");
    expect(variables["message"]).toBe(
      `Incident INC-7 was already resolved by Ana Lopez at ${kept("4:40 AM UTC")}.`,
    );
  });

  test("a time on another day says its date", async () => {
    givenRecord({
      ...ACKNOWLEDGED,
      acknowledgement: {
        createdByUserId: ANA,
        startsAt: new Date("2026-11-10T23:54:00.000Z"),
      },
    });

    await callRoute(ACKNOWLEDGE_PAGE_ROUTE);

    expect(rendered().variables["message"]).toBe(
      `Incident INC-7 was already acknowledged by Ana Lopez on ${kept("Nov 10, 2026, 11:54 PM UTC")}.`,
    );
  });

  test("times are on the person's own clock", async () => {
    const item: UserOnCallLogTimeline = timelineItem("incident");
    const user: User = new User();
    user.timezone = Timezone.AmericaNew_York;
    item.user = user;
    givenItem(item);
    givenRecord({
      ...ACKNOWLEDGED,
      acknowledgement: { createdByUserId: ANA, startsAt: ACKNOWLEDGED_AT },
    });

    await callRoute(ACKNOWLEDGE_PAGE_ROUTE);

    // 2:15 AM UTC on the 11th is 9:15 PM in New York on the 10th.
    expect(rendered().variables["message"]).toBe(
      `Incident INC-7 was already acknowledged by Ana Lopez on ${kept("Nov 10, 2026, 9:15 PM EST")}.`,
    );
  });

  test("the address the button opens says the same when pressed too late", async () => {
    givenRecord({
      ...ACKNOWLEDGED,
      acknowledgement: { createdByUserId: ANA, startsAt: ACKNOWLEDGED_AT },
    });

    await callRoute(ACKNOWLEDGE_ROUTE);

    expect(updateSpy).not.toHaveBeenCalled();
    expect(rendered().variables["message"]).toBe(
      `Incident INC-7 was already acknowledged by Ana Lopez at ${kept("2:15 AM UTC")}.`,
    );
  });
});

describe("pages the record being acknowledged does not end still offer their answer", () => {
  test("a page again: its record was acknowledged all along", async () => {
    givenRun(policyRun({ pageAgainNumber: 1 }));
    givenRecord(ACKNOWLEDGED);

    await callRoute(ACKNOWLEDGE_PAGE_ROUTE);

    const { path, variables } = rendered();

    expect(path).toContain(ACKNOWLEDGE_VIEW);
    expect(variables["acknowledgeText"]).toBe("Acknowledge Incident");
    expect(variables["viewDetailsText"]).toBe("View Incident");
  });

  test("a page a person asked for from Slack or Microsoft Teams", async () => {
    givenRun(personPageRun());
    givenRecord(ACKNOWLEDGED);

    await callRoute(ACKNOWLEDGE_PAGE_ROUTE);

    expect(rendered().path).toContain(ACKNOWLEDGE_VIEW);
  });

  test("a page a person asked for offers Can't take it? Escalate beside Acknowledge (#6710)", async () => {
    givenRun(personPageRun());
    givenRecord(ACKNOWLEDGED);
    previewSpy.mockResolvedValue({
      passedOn: false,
      result: {
        outcome: OnCallPassOnOutcome.PagingStopped,
        isPreview: true,
        isDirectPage: true,
        policyName: "",
        pagedNames: [],
        stillPagedNames: [],
        ruleCount: 0,
      },
    });

    await callRoute(ACKNOWLEDGE_PAGE_ROUTE, {
      [ON_CALL_PAGE_LINK_TOKEN_PARAM]: OnCallPageLinkToken.sign({
        userOnCallLogTimelineId: ITEM,
      }),
    });

    const { path, variables } = rendered();

    expect(path).toContain(ACKNOWLEDGE_VIEW);
    expect(previewSpy).toHaveBeenCalledWith({
      userId: PERSON,
      executionLogId: RUN,
    });
    expect(variables["passOn"]).toEqual(
      expect.objectContaining({
        lead: "Can't take it?",
        buttonText: "Escalate",
      }),
    );
  });

  test("an observer's page", async () => {
    givenRun(policyRun({ isObserverPage: true }));
    givenRecord(ACKNOWLEDGED);

    await callRoute(ACKNOWLEDGE_PAGE_ROUTE);

    const { path, variables } = rendered();

    expect(path).toContain(ACKNOWLEDGE_VIEW);
    expect(variables["acknowledgeText"]).toBe("I've seen it");
  });

  test("a page again somebody answered is over", async () => {
    givenRun(
      policyRun({ pageAgainNumber: 2, ...answeredBy(ANA, "Ana Lopez") }),
    );
    givenRecord(ACKNOWLEDGED);

    await callRoute(ACKNOWLEDGE_PAGE_ROUTE);

    const { path, variables } = rendered();

    expect(path).toContain(MESSAGE_VIEW);
    expect(variables["message"]).toBe(
      `Incident INC-7 was already acknowledged by Ana Lopez ${AT_ANSWERED}.`,
    );
  });

  test("a page again whose record was resolved is over", async () => {
    givenRun(policyRun({ pageAgainNumber: 1 }));
    givenRecord(RESOLVED);

    await callRoute(ACKNOWLEDGE_PAGE_ROUTE);

    expect(rendered().variables["message"]).toBe(
      "Incident INC-7 is already resolved.",
    );
  });
});

describe("what cannot be read never takes Acknowledge away", () => {
  test("the run cannot be read", async () => {
    findRun.mockRejectedValue(new Error("the database is away"));
    givenRecord(ACKNOWLEDGED);

    await callRoute(ACKNOWLEDGE_PAGE_ROUTE);

    const { path, variables } = rendered();

    expect(path).toContain(ACKNOWLEDGE_VIEW);
    expect(variables["acknowledgeText"]).toBe("Acknowledge Incident");
  });

  test("the run is gone", async () => {
    givenRun(null);
    givenRecord(ACKNOWLEDGED);

    await callRoute(ACKNOWLEDGE_PAGE_ROUTE);

    expect(rendered().path).toContain(ACKNOWLEDGE_VIEW);
  });

  test("the record's standing cannot be read", async () => {
    recordState.mockRejectedValue(new Error("the database is away"));

    await callRoute(ACKNOWLEDGE_PAGE_ROUTE);

    expect(rendered().path).toContain(ACKNOWLEDGE_VIEW);
  });

  test("the record is gone", async () => {
    givenRecord(null);

    await callRoute(ACKNOWLEDGE_PAGE_ROUTE);

    expect(rendered().path).toContain(ACKNOWLEDGE_VIEW);
  });
});

describe("the address the Acknowledge button opens asks again", () => {
  test("a page still waiting is acknowledged, and opens the incident", async () => {
    await callRoute(ACKNOWLEDGE_ROUTE);

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        query: {
          _id: ITEM.toString(),
          status: UserNotificationStatus.Sent,
          version: 1,
        },
        data: expect.objectContaining({
          isAcknowledged: true,
          status: UserNotificationStatus.Acknowledged,
          statusMessage: "Notification Acknowledged",
        }),
      }),
    );

    const redirect: jest.Mock = Response.redirect as unknown as jest.Mock;

    expect(redirect).toHaveBeenCalledTimes(1);
    expect(String(redirect.mock.calls[0]?.[2])).toBe(
      `https://oneuptime.example.com/dashboard/${PROJECT.toString()}/incidents/${RECORD.toString()}`,
    );
  });

  test("a colleague got there while the page was open: nothing is acknowledged a second time", async () => {
    givenRun(policyRun(answeredBy(ANA, "Ana Lopez")));
    givenRecord(ACKNOWLEDGED);

    await callRoute(ACKNOWLEDGE_ROUTE);

    expect(updateSpy).not.toHaveBeenCalled();
    expect(Response.redirect).not.toHaveBeenCalled();

    const { path, variables } = rendered();

    expect(path).toContain(MESSAGE_VIEW);
    expect(variables["title"]).toBe("Already acknowledged - Checkout is down");
    expect(variables["message"]).toBe(
      `Incident INC-7 was already acknowledged by Ana Lopez ${AT_ANSWERED}.`,
    );
    expect(variables["viewDetailsText"]).toBe("View Incident");
    expect(variables["statusIcon"]).toBe("check");
  });

  test("resolved while the page was open", async () => {
    givenRecord(RESOLVED);

    await callRoute(ACKNOWLEDGE_ROUTE);

    expect(updateSpy).not.toHaveBeenCalled();
    expect(rendered().variables["title"]).toBe(
      "Already resolved - Checkout is down",
    );
  });

  test("a page again about an acknowledged record is still acknowledged as the page it is", async () => {
    givenRun(policyRun({ pageAgainNumber: 1 }));
    givenRecord(ACKNOWLEDGED);

    await callRoute(ACKNOWLEDGE_ROUTE);

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(Response.redirect).toHaveBeenCalledTimes(1);
  });

  test("an observer's page is still marked as seen", async () => {
    givenRun(policyRun({ isObserverPage: true }));
    givenRecord(ACKNOWLEDGED);

    await callRoute(ACKNOWLEDGE_ROUTE);

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          statusMessage: "Marked as seen, paged as an observer",
        }),
      }),
    );
  });

  test("an observer's page answered already says it was marked as seen", async () => {
    givenItem(timelineItem("incident", { isAcknowledged: true }));
    givenRun(policyRun({ isObserverPage: true }));

    await callRoute(ACKNOWLEDGE_ROUTE);

    expect(updateSpy).not.toHaveBeenCalled();

    const { variables } = rendered();

    expect(variables["title"]).toBe(
      "Already marked as seen - Checkout is down",
    );
    expect(variables["message"]).toBe("You already marked this page as seen.");
  });

  test("what cannot be read leaves the press to acknowledge, as it always did", async () => {
    findRun.mockRejectedValue(new Error("the database is away"));
    recordState.mockRejectedValue(new Error("the database is away"));

    await callRoute(ACKNOWLEDGE_ROUTE);

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(Response.redirect).toHaveBeenCalledTimes(1);
  });
});

/*
 * Issue #7082: the press is asked again as it lands, and the acknowledgement
 * is then written at the status and the version read
 * (OnCallNotificationStatus.recordAcknowledgement). A second press landing
 * between the two - the button pressed twice, the link open on two phones -
 * wins; this one acknowledges nothing again, and says what the page says
 * now.
 */
describe("two presses at once", () => {
  // The other press: it lands just before this one's write.
  function pressedMeanwhile(): void {
    let landed: boolean = false;

    updateSpy.mockImplementation((async (updateBy: UpdateOneByInput) => {
      if (!landed) {
        landed = true;
        updateNotificationWhileStill(currentItem, {
          query: {
            _id: ITEM.toString(),
            status: currentItem.status,
            version: currentItem.version,
          },
          data: {
            status: UserNotificationStatus.Acknowledged,
            statusMessage: "Notification Acknowledged",
            isAcknowledged: true,
            acknowledgedAt: ACKNOWLEDGED_AT,
          },
        });
      }

      return updateNotificationWhileStill(currentItem, updateBy);
    }) as never);
  }

  test("the other press wins: this one is told the page was acknowledged already, and opens nothing", async () => {
    pressedMeanwhile();

    await callRoute(ACKNOWLEDGE_ROUTE);

    // Written once - by the other press - and refused here at the version read.
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(currentItem.acknowledgedAt).toBe(ACKNOWLEDGED_AT);
    expect(Response.redirect).not.toHaveBeenCalled();

    const { path, variables } = rendered();

    expect(path).toContain(MESSAGE_VIEW);
    expect(variables["title"]).toBe("Already acknowledged - Checkout is down");
    // When the other press acknowledged it.
    expect(variables["message"]).toBe(
      `You already acknowledged Incident INC-7 at ${kept("2:15 AM UTC")}.`,
    );
    expect(variables["viewDetailsText"]).toBe("View Incident");
  });

  test("an observer's second press is told the page was marked as seen already", async () => {
    givenRun(policyRun({ isObserverPage: true }));
    pressedMeanwhile();

    await callRoute(ACKNOWLEDGE_ROUTE);

    expect(Response.redirect).not.toHaveBeenCalled();
    expect(rendered().variables["title"]).toBe(
      "Already marked as seen - Checkout is down",
    );
  });

  test("the send's own result landing meanwhile is no answer: the press reads it again and acknowledges", async () => {
    givenItem(
      timelineItem("incident", { status: UserNotificationStatus.Sending }),
    );

    let sent: boolean = false;

    updateSpy.mockImplementation((async (updateBy: UpdateOneByInput) => {
      if (!sent) {
        sent = true;
        currentItem.status = UserNotificationStatus.Sent;
        currentItem.version = (currentItem.version || 0) + 1;
      }

      return updateNotificationWhileStill(currentItem, updateBy);
    }) as never);

    await callRoute(ACKNOWLEDGE_ROUTE);

    expect(updateSpy).toHaveBeenCalledTimes(2);
    expect(currentItem.status).toBe(UserNotificationStatus.Acknowledged);
    expect(Response.redirect).toHaveBeenCalledTimes(1);
  });

  test("a notification that keeps changing under every try, and still answers nothing: try again", async () => {
    updateSpy.mockImplementation((async () => {
      currentItem.version = (currentItem.version || 0) + 1;
      return 0;
    }) as never);

    await callRoute(ACKNOWLEDGE_ROUTE);

    expect(updateSpy).toHaveBeenCalledTimes(MAX_NOTIFICATION_WRITE_ATTEMPTS);
    expect(Response.redirect).not.toHaveBeenCalled();
    expect(Response.render).not.toHaveBeenCalled();

    const sendErrorResponse: jest.Mock =
      Response.sendErrorResponse as unknown as jest.Mock;

    expect(sendErrorResponse).toHaveBeenCalledTimes(1);
    expect((sendErrorResponse.mock.calls[0]?.[2] as Error).message).toBe(
      ON_CALL_NOTIFICATION_NOT_ACKNOWLEDGED_MESSAGE,
    );
  });

  test("not written, while a colleague acknowledged the incident meanwhile: told so, by name", async () => {
    updateSpy.mockImplementation((async () => {
      // The colleague's acknowledgement reaches the run and the record.
      givenRun(policyRun(answeredBy(ANA, "Ana Lopez")));
      givenRecord(ACKNOWLEDGED);
      currentItem.version = (currentItem.version || 0) + 1;
      return 0;
    }) as never);

    await callRoute(ACKNOWLEDGE_ROUTE);

    expect(Response.redirect).not.toHaveBeenCalled();
    expect(rendered().variables["message"]).toBe(
      `Incident INC-7 was already acknowledged by Ana Lopez ${AT_ANSWERED}.`,
    );
  });
});
