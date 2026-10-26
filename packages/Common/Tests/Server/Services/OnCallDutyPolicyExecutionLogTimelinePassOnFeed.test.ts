import OnCallDutyPolicyExecutionLogTimeline from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import OnCallDutyPolicyEscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import UserService from "../../../Server/Services/UserService";
import logger from "../../../Server/Utils/Logger";
import URL from "../../../Types/API/URL";
import { Yellow500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import {
  LEGACY_ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE,
  LEGACY_ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
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
 * WHAT THE RECORD'S FEED SAYS WHEN A PAGE IS ESCALATED.
 *
 * Each line of an on-call run's timeline that changes to a status worth
 * telling becomes one entry in the feed of the incident or alert the run
 * pages about (OnCallDutyPolicyExecutionLogTimelineService). A line that
 * turns "Passed On" (the status an escalated page is stored with) is one:
 * the person escalated the page. The line a later rule writes for somebody
 * it passed over, because they escalated it, is not: the feed said once
 * that they escalated it - and that holds for lines written before the
 * action was renamed from "Pass it on", in those words.
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

  const rest: Record<string, unknown> = { ...data };
  delete rest["isDirectPage"];
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

async function feedFor(
  row: OnCallDutyPolicyExecutionLogTimeline,
): Promise<void> {
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
      "**Ana Lopez** escalated the page from on-call policy **[Payments](https://oneuptime.test/dashboard/policies/payments)** at escalation rule **Level 1**.",
    );
  });

  test("a line written before the rename reads the same, once", async () => {
    await feedFor(
      lineOf({
        status: OnCallDutyExecutionLogTimelineStatus.PassedOn,
        statusMessage: LEGACY_ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
      }),
    );

    expect(incidentEntries).toHaveLength(1);
    expect(incidentEntries[0]!.markdown).toBe(
      "**Ana Lopez** escalated the page from on-call policy **[Payments](https://oneuptime.test/dashboard/policies/payments)** at escalation rule **Level 1**.",
    );
    expect(incidentEntries[0]!.markdown.toLowerCase()).not.toContain("pass");
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
      "**Ana Lopez** escalated the page from workflow **Page SRE**.",
    );
  });
});

describe("the line a later rule writes for somebody who escalated it", () => {
  test("is no feed entry: the feed said once that they escalated it", async () => {
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

  test("nor is one written before the rename, in the old words", async () => {
    await feedFor(
      lineOf({
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        statusMessage: LEGACY_ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE,
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

/*
 * The level, as the Escalate dialog names it: the line's rule by its place
 * among the policy's levels - "Level 1 of 2" - which the entry reads by
 * counting the policy's escalation rules (#5167).
 */
describe("the level an entry names", () => {
  test("is the rule's place among the policy's levels, counted as OneUptime", async () => {
    const counts: Array<unknown> = [];

    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "countBy")
      .mockImplementation((async (data: unknown) => {
        counts.push(data);
        return new PositiveNumber(2);
      }) as never);

    await feedFor(
      lineOf({
        status: OnCallDutyExecutionLogTimelineStatus.PassedOn,
        statusMessage: ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
        onCallDutyPolicyEscalationRule: {
          name: "Level 1",
          order: 1,
        } as never,
      }),
    );

    expect(incidentEntries[0]!.markdown).toBe(
      "**Ana Lopez** escalated the page from on-call policy **[Payments](https://oneuptime.test/dashboard/policies/payments)** at **Level 1 of 2**.",
    );
    expect(counts).toEqual([
      {
        query: { onCallDutyPolicyId: POLICY },
        props: { isRoot: true },
      },
    ]);
  });

  test("with its own name first", async () => {
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "countBy")
      .mockResolvedValue(new PositiveNumber(3));

    await feedFor(
      lineOf({
        status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        onCallDutyPolicyEscalationRule: {
          name: "Platform leads",
          order: 2,
        } as never,
      }),
    );

    expect(incidentEntries[0]!.markdown).toBe(
      "On-call policy **[Payments](https://oneuptime.test/dashboard/policies/payments)** paged **Ana Lopez** at **Platform leads** (Level 2 of 3).",
    );
  });

  test("when the levels cannot be counted, is the place alone, and the entry is still written", async () => {
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "countBy")
      .mockRejectedValue(new Error("database is down"));

    await feedFor(
      lineOf({
        status: OnCallDutyExecutionLogTimelineStatus.PassedOn,
        onCallDutyPolicyEscalationRule: {
          name: "Platform leads",
          order: 2,
        } as never,
      }),
    );

    expect(incidentEntries).toHaveLength(1);
    expect(incidentEntries[0]!.markdown).toBe(
      "**Ana Lopez** escalated the page from on-call policy **[Payments](https://oneuptime.test/dashboard/policies/payments)** at **Platform leads** (Level 2).",
    );
  });

  test("a line whose rule's place is not known counts nothing, and names the rule as before", async () => {
    let counted: number = 0;

    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "countBy")
      .mockImplementation((async () => {
        counted++;
        return new PositiveNumber(3);
      }) as never);

    await feedFor(
      lineOf({ status: OnCallDutyExecutionLogTimelineStatus.PassedOn }),
    );

    expect(counted).toBe(0);
    expect(incidentEntries[0]!.markdown).toContain(
      "at escalation rule **Level 1**.",
    );
  });
});
