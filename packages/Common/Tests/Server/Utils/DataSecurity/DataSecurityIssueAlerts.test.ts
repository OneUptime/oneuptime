/*
 * The alert creation path pulls the native isolated-vm addon through its
 * template renderer; stub it out before anything imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import DataSecurityIssueAlerts, {
  ClosedDataSecurityIssue,
  getDataSecurityIssueFingerprint,
} from "../../../../Server/Utils/DataSecurity/DataSecurityIssueAlerts";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertStateTimeline from "../../../../Models/DatabaseModels/AlertStateTimeline";
import { DataSecurityIssueFeedEventType } from "../../../../Models/DatabaseModels/DataSecurityIssueFeed";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateTimelineService from "../../../../Server/Services/AlertStateTimelineService";
import DataSecurityIssueFeedService from "../../../../Server/Services/DataSecurityIssueFeedService";
import logger from "../../../../Server/Utils/Logger";
import Includes from "../../../../Types/BaseDatabase/Includes";
import { Green500 } from "../../../../Types/BrandColors";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { getJestSpyOn } from "../../../Spy";
import {
  ALERT_STATE_IDS,
  idsOfAnyFilter,
  mockProjectStates,
  openStateIds,
} from "../../TestingUtils/Services/ProjectStatesHelper";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * An issue's alert ends with the issue (DataSecurityIssueAlerts): once the
 * issue is no longer open - its check passes, its store is no longer
 * checked that way, or a person resolved it, accepted its risk or said it
 * is not an issue - the alert raised for it is resolved, so nobody is
 * paged for a closed exposure, and the issue's timeline says so. Found by
 * the issue's fingerprint, against the project's unresolved states, and
 * best effort throughout. The alerts, their timeline and the issue feed are
 * stood in for, and recorded.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ISSUE_A: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const ISSUE_B: ObjectID = new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const ALERT_A: ObjectID = new ObjectID("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
const ALERT_B: ObjectID = new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd");

let alertFindSpy: Spy;
let timelineCreateSpy: Spy;
let resolvedStateSpy: Spy;
let feedSpy: Spy;
let errorSpy: Spy;

function openAlert(id: ObjectID, issueId: ObjectID): Alert {
  const alert: Alert = new Alert(id);
  alert.seriesFingerprint = getDataSecurityIssueFingerprint(issueId);
  return alert;
}

function closed(
  issueId: ObjectID,
  why: string = "its check passes now",
): ClosedDataSecurityIssue {
  return { issueId, why };
}

function timelines(): Array<AlertStateTimeline> {
  return timelineCreateSpy.mock.calls.map(
    (call: Array<unknown>): AlertStateTimeline => {
      return (call[0] as { data: AlertStateTimeline }).data;
    },
  );
}

function feeds(): Array<JSONObject> {
  return feedSpy.mock.calls.map((call: Array<unknown>): JSONObject => {
    return call[0] as JSONObject;
  });
}

beforeEach(() => {
  // Unresolved is every state above the project's resolved one.
  mockProjectStates();
  alertFindSpy = getJestSpyOn(AlertService, "findBy").mockResolvedValue(
    [] as never,
  );
  resolvedStateSpy = getJestSpyOn(
    AlertStateTimelineService,
    "getResolvedStateIdForProject",
  ).mockResolvedValue(ALERT_STATE_IDS.resolved as never);
  timelineCreateSpy = getJestSpyOn(
    AlertStateTimelineService,
    "create",
  ).mockResolvedValue(new AlertStateTimeline() as never);
  feedSpy = getJestSpyOn(
    DataSecurityIssueFeedService,
    "createDataSecurityIssueFeedItem",
  ).mockResolvedValue(undefined as never);
  errorSpy = getJestSpyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getDataSecurityIssueFingerprint", () => {
  test("is the key everything Data Security opens elsewhere for an issue carries", () => {
    expect(getDataSecurityIssueFingerprint(ISSUE_A)).toBe(
      `data-security-issue:${ISSUE_A.toString()}`,
    );
  });
});

describe("resolveForClosedIssues", () => {
  test("no closed issue: nothing is read and nothing written", async () => {
    await expect(
      DataSecurityIssueAlerts.resolveForClosedIssues({
        projectId: PROJECT_ID,
        issues: [],
      }),
    ).resolves.toBe(0);

    expect(alertFindSpy).not.toHaveBeenCalled();
    expect(resolvedStateSpy).not.toHaveBeenCalled();
    expect(timelineCreateSpy).not.toHaveBeenCalled();
  });

  test("reads the project's open alerts of the closed issues' fingerprints only, as root", async () => {
    await DataSecurityIssueAlerts.resolveForClosedIssues({
      projectId: PROJECT_ID,
      issues: [closed(ISSUE_A), closed(ISSUE_B)],
    });

    const findBy: JSONObject = alertFindSpy.mock.calls[0]![0] as JSONObject;
    const query: JSONObject = findBy["query"] as JSONObject;

    expect(query["projectId"]).toBe(PROJECT_ID);
    expect((query["seriesFingerprint"] as Includes).values).toEqual([
      `data-security-issue:${ISSUE_A.toString()}`,
      `data-security-issue:${ISSUE_B.toString()}`,
    ]);
    expect(idsOfAnyFilter(query["currentAlertStateId"])).toEqual(
      openStateIds(ALERT_STATE_IDS),
    );
    expect(findBy["props"]).toEqual({ isRoot: true });
  });

  test("no open alert: no resolved state read, nothing resolved, nothing on a timeline", async () => {
    await expect(
      DataSecurityIssueAlerts.resolveForClosedIssues({
        projectId: PROJECT_ID,
        issues: [closed(ISSUE_A)],
      }),
    ).resolves.toBe(0);

    expect(resolvedStateSpy).not.toHaveBeenCalled();
    expect(timelineCreateSpy).not.toHaveBeenCalled();
    expect(feedSpy).not.toHaveBeenCalled();
  });

  test("each open alert moves to the project's resolved state, saying why, and its issue's timeline says so", async () => {
    alertFindSpy.mockResolvedValue([
      openAlert(ALERT_A, ISSUE_A),
      openAlert(ALERT_B, ISSUE_B),
    ] as never);

    await expect(
      DataSecurityIssueAlerts.resolveForClosedIssues({
        projectId: PROJECT_ID,
        issues: [
          closed(ISSUE_A, "its check passes now"),
          closed(ISSUE_B, "its risk was accepted"),
        ],
      }),
    ).resolves.toBe(2);

    expect(resolvedStateSpy).toHaveBeenCalledWith(PROJECT_ID);
    expect(
      timelines().map((timeline: AlertStateTimeline) => {
        return {
          alertId: timeline.alertId?.toString(),
          alertStateId: timeline.alertStateId?.toString(),
          projectId: timeline.projectId?.toString(),
          rootCause: timeline.rootCause,
        };
      }),
    ).toEqual([
      {
        alertId: ALERT_A.toString(),
        alertStateId: ALERT_STATE_IDS.resolved.toString(),
        projectId: PROJECT_ID.toString(),
        rootCause:
          "Resolved by Data Security, as the issue it was raised for is no longer open: its check passes now.",
      },
      {
        alertId: ALERT_B.toString(),
        alertStateId: ALERT_STATE_IDS.resolved.toString(),
        projectId: PROJECT_ID.toString(),
        rootCause:
          "Resolved by Data Security, as the issue it was raised for is no longer open: its risk was accepted.",
      },
    ]);
    expect(
      timelineCreateSpy.mock.calls.map((call: Array<unknown>) => {
        return (call[0] as JSONObject)["props"];
      }),
    ).toEqual([{ isRoot: true }, { isRoot: true }]);
    expect(feeds()).toEqual([
      {
        projectId: PROJECT_ID,
        dataSecurityIssueId: ISSUE_A,
        eventType: DataSecurityIssueFeedEventType.AlertResolved,
        displayColor: Green500,
        feedInfoInMarkdown:
          "Its alert was resolved, so nobody is paged for it any more: its check passes now.",
      },
      {
        projectId: PROJECT_ID,
        dataSecurityIssueId: ISSUE_B,
        eventType: DataSecurityIssueFeedEventType.AlertResolved,
        displayColor: Green500,
        feedInfoInMarkdown:
          "Its alert was resolved, so nobody is paged for it any more: its risk was accepted.",
      },
    ]);
  });

  test("an alert of no closed issue is left alone", async () => {
    alertFindSpy.mockResolvedValue([
      openAlert(ALERT_A, ISSUE_A),
      openAlert(ALERT_B, ISSUE_B),
    ] as never);

    await expect(
      DataSecurityIssueAlerts.resolveForClosedIssues({
        projectId: PROJECT_ID,
        issues: [closed(ISSUE_A)],
      }),
    ).resolves.toBe(1);

    expect(
      timelines().map((timeline: AlertStateTimeline) => {
        return timeline.alertId?.toString();
      }),
    ).toEqual([ALERT_A.toString()]);
  });

  test("an alert somebody resolved a moment before is skipped quietly: no error, nothing on the timeline", async () => {
    alertFindSpy.mockResolvedValue([openAlert(ALERT_A, ISSUE_A)] as never);
    timelineCreateSpy.mockRejectedValue(
      new BadDataException(
        "Alert state cannot be same as previous state.",
      ) as never,
    );

    await expect(
      DataSecurityIssueAlerts.resolveForClosedIssues({
        projectId: PROJECT_ID,
        issues: [closed(ISSUE_A)],
      }),
    ).resolves.toBe(0);

    expect(errorSpy).not.toHaveBeenCalled();
    expect(feedSpy).not.toHaveBeenCalled();
  });

  test("one alert that cannot be resolved is logged, and the next one is still resolved", async () => {
    alertFindSpy.mockResolvedValue([
      openAlert(ALERT_A, ISSUE_A),
      openAlert(ALERT_B, ISSUE_B),
    ] as never);
    timelineCreateSpy
      .mockRejectedValueOnce(new Error("lock timed out") as never)
      .mockResolvedValueOnce(new AlertStateTimeline() as never);

    await expect(
      DataSecurityIssueAlerts.resolveForClosedIssues({
        projectId: PROJECT_ID,
        issues: [closed(ISSUE_A), closed(ISSUE_B)],
      }),
    ).resolves.toBe(1);

    expect(errorSpy).toHaveBeenCalledWith(
      `DataSecurity: could not resolve alert ${ALERT_A.toString()} of project ${PROJECT_ID.toString()}:`,
    );
    expect(
      feeds().map((feed: JSONObject) => {
        return (feed["dataSecurityIssueId"] as ObjectID).toString();
      }),
    ).toEqual([ISSUE_B.toString()]);
  });

  test("a project without a resolved state, or a read that fails, is logged and never thrown", async () => {
    alertFindSpy.mockResolvedValue([openAlert(ALERT_A, ISSUE_A)] as never);
    resolvedStateSpy.mockRejectedValue(
      new BadDataException("No resolved state found for the project") as never,
    );

    await expect(
      DataSecurityIssueAlerts.resolveForClosedIssues({
        projectId: PROJECT_ID,
        issues: [closed(ISSUE_A)],
      }),
    ).resolves.toBe(0);

    expect(errorSpy).toHaveBeenCalledWith(
      `DataSecurity: could not resolve the alerts of closed issues in project ${PROJECT_ID.toString()}:`,
    );

    alertFindSpy.mockRejectedValue(new Error("Postgres went away") as never);

    await expect(
      DataSecurityIssueAlerts.resolveForClosedIssues({
        projectId: PROJECT_ID,
        issues: [closed(ISSUE_A)],
      }),
    ).resolves.toBe(0);
    expect(timelineCreateSpy).not.toHaveBeenCalled();
  });
});
