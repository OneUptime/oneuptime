import { describe, expect, test } from "@jest/globals";
import OnCallFeedText from "../../../../Server/Utils/OnCall/OnCallFeedText";
import OnCallDutyExecutionLogTimelineStatus from "../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import {
  ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE,
  ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
} from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import { ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE } from "../../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import FeedMarkdown, {
  MarkdownText,
} from "../../../../Utils/Markdown/FeedMarkdown";

/*
 * A PAGE PASSED ON, IN THE RECORD'S FEED.
 *
 * Somebody who cannot take a page passes it on: one entry, in their name,
 * in the words the run's chat message uses - and, when everybody the run
 * paged passed it on, the run's ending says that is why paging stopped.
 */

const POLICY: MarkdownText = FeedMarkdown.link(
  "Payments",
  "https://oneuptime.com/dashboard/p/on-call-duty/policies/x",
);
const ANA: MarkdownText = FeedMarkdown.link(
  "Ana Lopez",
  "https://oneuptime.com/dashboard/p/settings/users/a",
);

const POLICY_MD: string =
  "**[Payments](https://oneuptime.com/dashboard/p/on-call-duty/policies/x)**";
const ANA_MD: string =
  "**[Ana Lopez](https://oneuptime.com/dashboard/p/settings/users/a)**";

describe("a page passed on, on a policy's run", () => {
  test("is one sentence: who passed on the page from which policy, at which rule", () => {
    expect(
      OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.PassedOn,
        policyLink: POLICY,
        ruleName: "Level 1",
        recipient: ANA,
        statusMessage: ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
      }),
    ).toBe(
      `${ANA_MD} passed on the page from on-call policy ${POLICY_MD} at escalation rule **Level 1**.`,
    );
  });

  test("names the schedule and team they were paged through", () => {
    expect(
      OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.PassedOn,
        policyLink: POLICY,
        ruleName: "Level 1",
        scheduleName: "Payments primary",
        teamName: "Platform",
        recipient: ANA,
        statusMessage: ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
      }),
    ).toBe(
      `${ANA_MD} passed on the page from on-call policy ${POLICY_MD} at escalation rule **Level 1** (schedule **Payments primary**), as a member of **Platform**.`,
    );
  });

  test("a message other than the usual one still follows, as a sentence of its own", () => {
    expect(
      OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.PassedOn,
        policyLink: POLICY,
        ruleName: "Level 1",
        recipient: ANA,
        statusMessage: "Passed on from the mobile app",
      }),
    ).toBe(
      `${ANA_MD} passed on the page from on-call policy ${POLICY_MD} at escalation rule **Level 1**.\n\nPassed on from the mobile app.`,
    );
  });

  test("the usual message is said once, by the sentence itself", () => {
    expect(
      OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.PassedOn,
        policyLink: POLICY,
        ruleName: "Level 1",
        recipient: ANA,
        statusMessage: ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
      }),
    ).not.toContain(ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE);
  });
});

describe("a page passed on, on a direct page", () => {
  test("names whoever started the page, as its other entries do", () => {
    expect(
      OnCallFeedText.getDirectPageStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.PassedOn,
        pager: { workflowName: "Page SRE" },
        recipient: ANA,
        statusMessage: ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
      }),
    ).toBe(`${ANA_MD} passed on the page from workflow **Page SRE**.`);
  });

  test("a person who paged from a chat", () => {
    expect(
      OnCallFeedText.getDirectPageStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.PassedOn,
        pager: {
          startedByUser: FeedMarkdown.link(
            "Simon Lee",
            "https://oneuptime.com/dashboard/p/settings/users/s",
          ),
        },
        recipient: ANA,
      }),
    ).toBe(
      `${ANA_MD} passed on the page from **[Simon Lee](https://oneuptime.com/dashboard/p/settings/users/s)**.`,
    );
  });
});

describe("a run everybody passed on", () => {
  test("a policy's run stopped paging: everybody it paged passed the page on", () => {
    expect(
      OnCallFeedText.getRunStatusMarkdown({
        status: OnCallDutyPolicyStatus.Completed,
        policyLink: POLICY,
        statusMessage: ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE,
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} stopped paging: everybody it paged passed the page on.`,
    );
  });

  test("is told apart from a run that went through every rule unanswered", () => {
    expect(
      OnCallFeedText.getRunStatusMarkdown({
        status: OnCallDutyPolicyStatus.Completed,
        policyLink: POLICY,
        statusMessage: ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} went through every escalation rule and stopped paging.`,
    );
  });

  test("a direct page a workflow started stopped paging", () => {
    expect(
      OnCallFeedText.getDirectPageStatusMarkdown({
        status: OnCallDutyPolicyStatus.Completed,
        pager: { workflowName: "Page SRE" },
        statusMessage: ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE,
      }),
    ).toBe(
      "Workflow **Page SRE** stopped paging: everybody it paged passed the page on.",
    );
  });

  test("a page a person started stopped - the paging, not the person", () => {
    expect(
      OnCallFeedText.getDirectPageStatusMarkdown({
        status: OnCallDutyPolicyStatus.Completed,
        pager: {
          startedByUser: FeedMarkdown.link(
            "Simon Lee",
            "https://oneuptime.com/dashboard/p/settings/users/s",
          ),
        },
        statusMessage: ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE,
      }),
    ).toBe(
      "The page from **[Simon Lee](https://oneuptime.com/dashboard/p/settings/users/s)** stopped: everybody it paged passed the page on.",
    );
  });

  test("is news for the feed, as every ending is", () => {
    expect(
      OnCallFeedText.isRunStatusFeedNews(OnCallDutyPolicyStatus.Completed),
    ).toBe(true);
  });
});
