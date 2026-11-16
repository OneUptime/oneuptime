import { describe, expect, jest, test, afterEach } from "@jest/globals";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import OnCallFeedText from "../../../../Server/Utils/OnCall/OnCallFeedText";
import OnCallDutyExecutionLogTimelineStatus from "../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import { getOnCallPageMergedMessage } from "../../../../Types/OnCallDutyPolicy/OnCallPageMerge";
import { Green500 } from "../../../../Types/BrandColors";
import FeedMarkdown, {
  MarkdownText,
} from "../../../../Utils/Markdown/FeedMarkdown";

/*
 * A PERSON ANOTHER POLICY IS PAGING ALREADY, IN THE RECORD'S FEED
 * (issue #7837, OnCallPageMerge).
 *
 * Billing's level reached Ana while Payments was paging her about the same
 * incident, and did not page her again: one entry says so, naming the
 * policy that is paging her - in green, as a page that reached its person.
 * Its line's own words would only say it again.
 */

const BILLING: MarkdownText = FeedMarkdown.link(
  "Billing",
  "https://oneuptime.com/dashboard/p/on-call-duty/policies/b",
);
const ANA: MarkdownText = FeedMarkdown.link(
  "Ana Lopez",
  "https://oneuptime.com/dashboard/p/users/a",
);

const BILLING_MD: string =
  "**[Billing](https://oneuptime.com/dashboard/p/on-call-duty/policies/b)**";
const ANA_MD: string =
  "**[Ana Lopez](https://oneuptime.com/dashboard/p/users/a)**";

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a person not paged again, as another policy is paging them", () => {
  test("is one sentence: which policy did not page whom again, at which rule, and which policy is paging them", () => {
    expect(
      OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.AlreadyPaged,
        policyLink: BILLING,
        ruleName: "Level 1",
        recipient: ANA,
        statusMessage: getOnCallPageMergedMessage({ policyName: "Payments" }),
      }),
    ).toBe(
      `On-call policy ${BILLING_MD} did not page ${ANA_MD} again at escalation rule **Level 1**: on-call policy **Payments** is paging them about this already.`,
    );
  });

  test("names the level, the schedule and the team they were reached through", () => {
    expect(
      OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.AlreadyPaged,
        policyLink: BILLING,
        ruleName: "First line",
        ruleOrder: 1,
        ruleCount: 2,
        scheduleName: "Billing primary",
        teamName: "Platform",
        recipient: ANA,
        statusMessage: getOnCallPageMergedMessage({ policyName: "Payments" }),
      }),
    ).toBe(
      `On-call policy ${BILLING_MD} did not page ${ANA_MD} again at **First line** (Level 1 of 2, schedule **Billing primary**), as a member of **Platform**: on-call policy **Payments** is paging them about this already.`,
    );
  });

  test("a line naming no policy says another on-call policy", () => {
    expect(
      OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.AlreadyPaged,
        policyLink: BILLING,
        ruleName: "Level 1",
        recipient: ANA,
        statusMessage: getOnCallPageMergedMessage({ policyName: null }),
      }),
    ).toContain(
      "on-call policy **another on-call policy** is paging them about this already.",
    );
  });

  test("is drawn in green, as a page that reached its person", () => {
    expect(
      OnCallDutyPolicyExecutionLogTimelineService.getColorBasedOnStatus(
        OnCallDutyExecutionLogTimelineStatus.AlreadyPaged,
      ),
    ).toEqual(Green500);
  });
});
