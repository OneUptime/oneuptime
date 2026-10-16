import OnCallDutyPolicyExecutionLogTimeline from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import UserService from "../../../Server/Services/UserService";
import logger from "../../../Server/Utils/Logger";
import URL from "../../../Types/API/URL";
import { Yellow500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import {
  ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE,
  ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
} from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHAT THE RECORD'S FEED SAYS WHEN A PAGE IS PASSED ON.
 *
 * Each line of an on-call run's timeline that changes to a status worth
 * telling becomes one entry in the feed of the incident or alert the run
 * pages about (OnCallDutyPolicyExecutionLogTimelineService). A line that
 * turns "Passed On" is one: the person passed the page on. The line a later
 * rule writes for somebody it passed over, because they passed it on, is
 * not: the feed said once that they passed it on.
 */

const PROJECT: ObjectID = new ObjectID("0f800000-0000-4000-8000-000000000001");
const POLICY: ObjectID = new ObjectID("0f800000-0000-4000-8000-000000000002");
const INCIDENT: ObjectID = new ObjectID("0f800000-0000-4000-8000-000000000003");
const ALERT: ObjectID = new ObjectID("0f800000-0000-4000-8000-000000000004");
const LINE: ObjectID = new ObjectID("0f800000-0000-4000-8000-000000000005");
const ANA: ObjectID = new ObjectID("0f800000-0000-4000-8000-0000000000a1");

interface Entry {
  markdown: string;
  color: Color;
}

let incidentEntries: Array<Entry>;
let alertEntries: Array<Entry>;

function lineOf(
  data: Partial<OnCallDutyPolicyExecutionLogTimeline> & {
    isDirectPage?: boolean;
  },
): OnCallDutyPolicyExecutionLogTimeline {
  const row: OnCallDutyPolicyExecutionLogTimeline =
    new OnCallDutyPolicyExecutionLogTimeline();
  row.id = LINE;
  row.projectId = PROJECT;
  row.alertSentToUserId = ANA;
  row.triggeredByIncidentId = INCIDENT;

  if (!data.isDirectPage) {
    row.onCallDutyPolicyId = POLICY;
    row.onCallDutyPolicy = { id: POLICY, name: "Payments" } as never;
    row.onCallDutyPolicyEscalationRule = { name: "Level 1" } as never;
  } else {
    row.onCallDutyPolicyExecutionLog = {
      triggeredByWorkflowName: "Page SRE",
    } as never;
  }

  const { isDirectPage: _isDirectPage, ...rest } = data;
  Object.assign(row, rest);

  return row;
}

beforeEach(() => {
  incidentEntries = [];
  alertEntries = [];

  jest.spyOn(logger, "debug").mockImplementation((() => {
    return undefined;
  }) as never);

  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
    .mockResolvedValue(
      URL.fromString("https://oneuptime.test/dashboard/policies/payments"),
    );

  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockResolvedValue(mdText`Ana Lopez`);

  jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "getDirectPagePager")
    .mockResolvedValue({ workflowName: "Page SRE" });

  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockImplementation((async (data: {
      feedInfoInMarkdown: string;
      displayColor: Color;
    }) => {
      incidentEntries.push({
        markdown: data.feedInfoInMarkdown,
        color: data.displayColor,
      });
    }) as never);

  jest
    .spyOn(AlertFeedService, "createAlertFeedItem")
    .mockImplementation((async (data: {
      feedInfoInMarkdown: string;
      displayColor: Color;
    }) => {
      alertEntries.push({
        markdown: data.feedInfoInMarkdown,
        color: data.displayColor,
      });
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function feedFor(row: OnCallDutyPolicyExecutionLogTimeline): Promise<void> {
  jest
    .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "findOneById")
    .mockResolvedValue(row);

  await OnCallDutyPolicyExecutionLogTimelineService.addToIncidentOrAlertFeed({
    onCallDutyPolicyExecutionLogTimelineId: LINE,
  });
}

describe("a line that turns Passed On", () => {
  test("is one entry in the incident's feed, in the person's name", async () => {
    await feedFor(
      lineOf({
        status: OnCallDutyExecutionLogTimelineStatus.PassedOn,
        statusMessage: ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
      }),
    );

    expect(incidentEntries).toHaveLength(1);
    expect(incidentEntries[0]!.markdown).toBe(
      "**Ana Lopez** passed on the page from on-call policy **[Payments](https://oneuptime.test/dashboard/policies/payments)** at escalation rule **Level 1**.",
    );
  });

  test("is amber: neither a failure nor an answer, the page moved on", async () => {
    await feedFor(
      lineOf({ status: OnCallDutyExecutionLogTimelineStatus.PassedOn }),
    );

    expect(incidentEntries[0]!.color).toEqual(Yellow500);
    expect(
      OnCallDutyPolicyExecutionLogTimelineService.getColorBasedOnStatus(
        OnCallDutyExecutionLogTimelineStatus.PassedOn,
      ),
    ).toEqual(Yellow500);
  });

  test("goes to an alert's feed for an alert's run", async () => {
    const row: OnCallDutyPolicyExecutionLogTimeline = lineOf({
      status: OnCallDutyExecutionLogTimelineStatus.PassedOn,
    });
    row.triggeredByIncidentId = undefined as never;
    row.triggeredByAlertId = ALERT;

    await feedFor(row);

    expect(incidentEntries).toEqual([]);
    expect(alertEntries).toHaveLength(1);
  });

  test("on a direct page, names whoever started the page", async () => {
    await feedFor(
      lineOf({
        isDirectPage: true,
        status: OnCallDutyExecutionLogTimelineStatus.PassedOn,
      }),
    );

    expect(incidentEntries[0]!.markdown).toBe(
      "**Ana Lopez** passed on the page from workflow **Page SRE**.",
    );
  });
});

describe("the line a later rule writes for somebody who passed it on", () => {
  test("is no feed entry: the feed said once that they passed it on", async () => {
    await feedFor(
      lineOf({
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        statusMessage: ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE,
      }),
    );

    expect(incidentEntries).toEqual([]);
  });

  test("on a direct page either", async () => {
    await feedFor(
      lineOf({
        isDirectPage: true,
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        statusMessage: ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE,
      }),
    );

    expect(incidentEntries).toEqual([]);
  });

  test("while every other skipped line still is one", async () => {
    await feedFor(
      lineOf({
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        statusMessage:
          "Skipped because this user is not a member of the project.",
      }),
    );

    expect(incidentEntries).toHaveLength(1);
  });
});
