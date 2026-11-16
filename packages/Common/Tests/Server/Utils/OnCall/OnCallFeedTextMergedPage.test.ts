import { describe, expect, jest, test, afterEach } from "@jest/globals";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import OnCallFeedText from "../../../../Server/Utils/OnCall/OnCallFeedText";
import OnCallDutyExecutionLogTimelineStatus from "../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import {
  OnCallPageCoverKind,
  getOnCallPageMergedLine,
  getOnCallPageMergedMessage,
} from "../../../../Types/OnCallDutyPolicy/OnCallPageMerge";
import { Green500 } from "../../../../Types/BrandColors";
import FeedMarkdown, {
  MarkdownText,
} from "../../../../Utils/Markdown/FeedMarkdown";

/*
 * A PERSON ANOTHER PAGE IS PAGING ALREADY, IN THE RECORD'S FEED
 * (issues #7837, #8859, OnCallPageMerge).
 *
 * Billing's level reached Ana while Payments was paging her about the same
 * incident, and did not page her again: one entry says so, naming the
 * policy that is paging her - in green, as a page that reached its person.
 * Its line's own words would only say it again. A page Jane sent from a
 * chat, or a workflow's, is named as the feed names a direct page: Jane, or
 * the workflow - never as an on-call policy (#8859).
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

  test("a line naming no policy says another on-call policy - no name, so not in bold, and not 'on-call policy another on-call policy'", () => {
    const markdown: string = OnCallFeedText.getStepMarkdown({
      status: OnCallDutyExecutionLogTimelineStatus.AlreadyPaged,
      policyLink: BILLING,
      ruleName: "Level 1",
      recipient: ANA,
      statusMessage: getOnCallPageMergedMessage({ policyName: null }),
    });

    expect(markdown).toBe(
      `On-call policy ${BILLING_MD} did not page ${ANA_MD} again at escalation rule **Level 1**: another on-call policy is paging them about this already.`,
    );
    expect(markdown).not.toContain("on-call policy **another on-call policy**");
  });

  test("a line that cannot be read says another on-call policy too", () => {
    expect(
      OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.AlreadyPaged,
        policyLink: BILLING,
        ruleName: "Level 1",
        recipient: ANA,
        statusMessage: "Something else.",
      }),
    ).toContain(": another on-call policy is paging them about this already.");
  });

  test("merged into a page Jane sent from a chat: names Jane, as the feed names who sent a direct page (#8859)", () => {
    expect(
      OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.AlreadyPaged,
        policyLink: BILLING,
        ruleName: "Level 1",
        recipient: ANA,
        statusMessage: getOnCallPageMergedLine({
          kind: OnCallPageCoverKind.PersonPage,
          name: "Jane Doe",
        }),
      }),
    ).toBe(
      `On-call policy ${BILLING_MD} did not page ${ANA_MD} again at escalation rule **Level 1**: **Jane Doe** is paging them about this already.`,
    );
  });

  test("merged into a workflow's page: names the workflow (#8859)", () => {
    expect(
      OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.AlreadyPaged,
        policyLink: BILLING,
        ruleName: "Level 1",
        recipient: ANA,
        statusMessage: getOnCallPageMergedLine({
          kind: OnCallPageCoverKind.WorkflowPage,
          name: "Nightly Checks",
        }),
      }),
    ).toBe(
      `On-call policy ${BILLING_MD} did not page ${ANA_MD} again at escalation rule **Level 1**: workflow **Nightly Checks** is paging them about this already.`,
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

/*
 * A WORKFLOW'S PAGE OF SOMEBODY ANOTHER PAGE IS PAGING ALREADY (#8859): the
 * direct page's entry, in its own words - the workflow, where a policy's
 * entry names the policy and the level.
 */
describe("a workflow's direct page that did not page somebody again", () => {
  test("says the workflow did not page them again, and which policy is paging them", () => {
    expect(
      OnCallFeedText.getDirectPageStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.AlreadyPaged,
        pager: { workflowName: "Nightly Checks" },
        recipient: ANA,
        statusMessage: getOnCallPageMergedMessage({ policyName: "Payments" }),
      }),
    ).toBe(
      `Workflow **Nightly Checks** did not page ${ANA_MD} again: on-call policy **Payments** is paging them about this already.`,
    );
  });

  test("names the team or the schedule they were reached through, and who else is paging them", () => {
    expect(
      OnCallFeedText.getDirectPageStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.AlreadyPaged,
        pager: { workflowName: "Nightly Checks" },
        teamName: "Platform",
        recipient: ANA,
        statusMessage: getOnCallPageMergedLine({
          kind: OnCallPageCoverKind.PersonPage,
          name: "Jane Doe",
        }),
      }),
    ).toBe(
      `Workflow **Nightly Checks** did not page ${ANA_MD} again, as a member of **Platform**: **Jane Doe** is paging them about this already.`,
    );
  });

  test("says nothing of its line's words again", () => {
    expect(
      OnCallFeedText.getDirectPageStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.AlreadyPaged,
        pager: { workflowName: "Nightly Checks" },
        recipient: ANA,
        statusMessage: getOnCallPageMergedMessage({ policyName: "Payments" }),
      }),
    ).not.toContain("Already paged");
  });

  test("is not 'is paging' them: it sent nothing", () => {
    expect(
      OnCallFeedText.getDirectPageStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.AlreadyPaged,
        pager: { workflowName: "Nightly Checks" },
        recipient: ANA,
        statusMessage: getOnCallPageMergedMessage({ policyName: "Payments" }),
      }),
    ).not.toContain(`is paging ${ANA_MD}`);
  });
});
