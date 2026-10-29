import { describe, expect, test } from "@jest/globals";
import OnCallFeedText from "../../../../Server/Utils/OnCall/OnCallFeedText";
import OnCallDutyExecutionLogTimelineStatus from "../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import { NOBODY_NEXT_IN_ROTATION_TIMELINE_MESSAGE } from "../../../../Types/OnCallDutyPolicy/NextInRotation";
import FeedMarkdown, {
  MarkdownText,
} from "../../../../Utils/Markdown/FeedMarkdown";

/*
 * THE FEED SAYS WHY THE BACKUP WAS PAGED.
 *
 * An escalation rule can page the next person in an on-call schedule's
 * rotation - the backup after whoever is on call. The record's feed then
 * says so in place of the schedule: "(next in the **Payments primary**
 * rotation)", where a page to the schedule's on-call person reads
 * "(schedule **Payments primary**)". A rule that found nobody next says
 * that, not that nobody was on call.
 */

const POLICY: MarkdownText = FeedMarkdown.link(
  "Payments",
  "https://oneuptime.com/dashboard/p/on-call-duty/policies/x",
);
const SAM: MarkdownText = FeedMarkdown.link(
  "Sam Lee",
  "https://oneuptime.com/dashboard/p/users/s",
);

const POLICY_MD: string =
  "**[Payments](https://oneuptime.com/dashboard/p/on-call-duty/policies/x)**";
const SAM_MD: string =
  "**[Sam Lee](https://oneuptime.com/dashboard/p/users/s)**";

describe("a page to the next person in a rotation", () => {
  test("sent: the rule's clause says they are next in the schedule's rotation", () => {
    expect(
      OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        policyLink: POLICY,
        ruleName: "Level 2",
        scheduleName: "Payments primary",
        isNextInRotation: true,
        recipient: SAM,
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} paged ${SAM_MD} at escalation rule **Level 2** (next in the **Payments primary** rotation).`,
    );
  });

  test("acknowledged: the same clause", () => {
    expect(
      OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
        policyLink: POLICY,
        ruleName: "Level 2",
        scheduleName: "Payments primary",
        isNextInRotation: true,
        recipient: SAM,
      }),
    ).toBe(
      `${SAM_MD} acknowledged the page from on-call policy ${POLICY_MD} at escalation rule **Level 2** (next in the **Payments primary** rotation).`,
    );
  });

  test("being sent, skipped and failed: the same clause", () => {
    for (const [status, verb] of [
      [OnCallDutyExecutionLogTimelineStatus.Executing, "is paging"],
      [OnCallDutyExecutionLogTimelineStatus.Skipped, "did not page"],
      [OnCallDutyExecutionLogTimelineStatus.Error, "could not page"],
    ] as Array<[OnCallDutyExecutionLogTimelineStatus, string]>) {
      expect(
        OnCallFeedText.getStepMarkdown({
          status: status,
          policyLink: POLICY,
          ruleName: "Level 2",
          scheduleName: "Payments primary",
          isNextInRotation: true,
          recipient: SAM,
        }),
      ).toBe(
        `On-call policy ${POLICY_MD} ${verb} ${SAM_MD} at escalation rule **Level 2** (next in the **Payments primary** rotation).`,
      );
    }
  });

  test("a page to the schedule's on-call person still names the schedule, as before", () => {
    expect(
      OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        policyLink: POLICY,
        ruleName: "Level 1",
        scheduleName: "Payments primary",
        isNextInRotation: false,
        recipient: SAM,
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} paged ${SAM_MD} at escalation rule **Level 1** (schedule **Payments primary**).`,
    );
  });

  test("the schedule's name is text: Markdown in it formats nothing", () => {
    const markdown: string = OnCallFeedText.getStepMarkdown({
      status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
      policyLink: POLICY,
      ruleName: "Level 2",
      scheduleName: "*Primary* [x](https://evil.example)",
      isNextInRotation: true,
      recipient: SAM,
    });

    expect(markdown).toContain(
      "(next in the **\\*Primary\\* \\[x\\](https://evil.example)** rotation)",
    );
  });
});

describe("a rule that found nobody next in the rotation", () => {
  test("says nobody was next in the schedule's rotation - not that nobody was on call", () => {
    expect(
      OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        policyLink: POLICY,
        ruleName: "Level 2",
        scheduleName: "Payments primary",
        isNextInRotation: true,
        statusMessage: NOBODY_NEXT_IN_ROTATION_TIMELINE_MESSAGE,
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} paged nobody at escalation rule **Level 2**: nobody was next in the **Payments primary** rotation.\n\n${NOBODY_NEXT_IN_ROTATION_TIMELINE_MESSAGE}`,
    );
  });

  test("a schedule with nobody on call reads as it always did", () => {
    expect(
      OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        policyLink: POLICY,
        ruleName: "Level 2",
        scheduleName: "Payments primary",
        statusMessage:
          "Skipped because no active users are found in this schedule.",
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} paged nobody at escalation rule **Level 2**: nobody was on call in schedule **Payments primary**.\n\nSkipped because no active users are found in this schedule.`,
    );
  });
});
