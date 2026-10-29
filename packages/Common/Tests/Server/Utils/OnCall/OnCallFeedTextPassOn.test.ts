import { describe, expect, test } from "@jest/globals";
import OnCallFeedText from "../../../../Server/Utils/OnCall/OnCallFeedText";
import OnCallDutyExecutionLogTimelineStatus from "../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import {
  LEGACY_ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE,
  ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE,
  ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
  isOnCallPolicyRunEverybodyPassedOnMessage,
} from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import {
  LEGACY_ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
  ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
} from "../../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import FeedMarkdown, {
  MarkdownText,
} from "../../../../Utils/Markdown/FeedMarkdown";

/*
 * A PAGE ESCALATED, IN THE RECORD'S FEED.
 *
 * Somebody who cannot take a page escalates it: one entry, in their name,
 * in the words the run's chat message uses - and, when everybody the run
 * paged escalated it, the run's ending says that is why paging stopped.
 *
 * The action was called "Pass it on" before (task escalate-incident-copy):
 * runs from then wrote their messages in those words, and their feed entries
 * read exactly as today's.
 */

const POLICY: MarkdownText = FeedMarkdown.link(
  "Payments",
  "https://oneuptime.com/dashboard/p/on-call-duty/policies/x",
);
const ANA: MarkdownText = FeedMarkdown.link(
  "Ana Lopez",
  "https://oneuptime.com/dashboard/p/users/a",
);

const POLICY_MD: string =
  "**[Payments](https://oneuptime.com/dashboard/p/on-call-duty/policies/x)**";
const ANA_MD: string =
  "**[Ana Lopez](https://oneuptime.com/dashboard/p/users/a)**";

const STOPPED: string =
  "everybody it paged escalated it, and nobody was left to page.";

describe("a page escalated, on a policy's run", () => {
  test("is one sentence: who escalated the page from which policy, at which rule", () => {
    expect(
      OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.PassedOn,
        policyLink: POLICY,
        ruleName: "Level 1",
        recipient: ANA,
        statusMessage: ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
      }),
    ).toBe(
      `${ANA_MD} escalated the page from on-call policy ${POLICY_MD} at escalation rule **Level 1**.`,
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
      `${ANA_MD} escalated the page from on-call policy ${POLICY_MD} at escalation rule **Level 1** (schedule **Payments primary**), as a member of **Platform**.`,
    );
  });

  test("a message other than the usual one still follows, as a sentence of its own", () => {
    expect(
      OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.PassedOn,
        policyLink: POLICY,
        ruleName: "Level 1",
        recipient: ANA,
        statusMessage: "Escalated from the mobile app",
      }),
    ).toBe(
      `${ANA_MD} escalated the page from on-call policy ${POLICY_MD} at escalation rule **Level 1**.\n\nEscalated from the mobile app.`,
    );
  });

  test("the usual message is said once, by the sentence itself - in today's words and in those before the rename", () => {
    for (const statusMessage of [
      ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
      LEGACY_ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
    ]) {
      const markdown: string = OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.PassedOn,
        policyLink: POLICY,
        ruleName: "Level 1",
        recipient: ANA,
        statusMessage: statusMessage,
      });

      expect(markdown).toBe(
        `${ANA_MD} escalated the page from on-call policy ${POLICY_MD} at escalation rule **Level 1**.`,
      );
      expect(markdown).not.toContain(statusMessage);
    }
  });

  test("never says the old words", () => {
    expect(
      OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.PassedOn,
        policyLink: POLICY,
        ruleName: "Level 1",
        recipient: ANA,
        statusMessage: LEGACY_ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
      }).toLowerCase(),
    ).not.toContain("pass");
  });
});

describe("a page escalated, on a direct page", () => {
  test("names whoever started the page, as its other entries do", () => {
    expect(
      OnCallFeedText.getDirectPageStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.PassedOn,
        pager: { workflowName: "Page SRE" },
        recipient: ANA,
        statusMessage: ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
      }),
    ).toBe(`${ANA_MD} escalated the page from workflow **Page SRE**.`);
  });

  test("a person who paged from a chat", () => {
    expect(
      OnCallFeedText.getDirectPageStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.PassedOn,
        pager: {
          startedByUser: FeedMarkdown.link(
            "Simon Lee",
            "https://oneuptime.com/dashboard/p/users/s",
          ),
        },
        recipient: ANA,
      }),
    ).toBe(
      `${ANA_MD} escalated the page from **[Simon Lee](https://oneuptime.com/dashboard/p/users/s)**.`,
    );
  });
});

describe("a run everybody escalated", () => {
  test("its ending is written in today's words, and read in both", () => {
    expect(ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE).toBe(
      "Execution completed: everybody it paged escalated it.",
    );
    expect(LEGACY_ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE).toBe(
      "Execution completed: everybody it paged passed it on.",
    );
    expect(
      isOnCallPolicyRunEverybodyPassedOnMessage(
        ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE,
      ),
    ).toBe(true);
    expect(
      isOnCallPolicyRunEverybodyPassedOnMessage(
        ` ${LEGACY_ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE}`,
      ),
    ).toBe(true);

    for (const other of [
      undefined,
      null,
      "",
      ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
      "Execution completed because incident is acknowledged or resolved.",
    ]) {
      expect(isOnCallPolicyRunEverybodyPassedOnMessage(other)).toBe(false);
    }
  });

  test("a policy's run stopped paging: everybody it paged escalated it - whichever words its ending was written in", () => {
    for (const statusMessage of [
      ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE,
      LEGACY_ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE,
    ]) {
      expect(
        OnCallFeedText.getRunStatusMarkdown({
          status: OnCallDutyPolicyStatus.Completed,
          policyLink: POLICY,
          statusMessage: statusMessage,
        }),
      ).toBe(`On-call policy ${POLICY_MD} stopped paging: ${STOPPED}`);
    }
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
    for (const statusMessage of [
      ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE,
      LEGACY_ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE,
    ]) {
      expect(
        OnCallFeedText.getDirectPageStatusMarkdown({
          status: OnCallDutyPolicyStatus.Completed,
          pager: { workflowName: "Page SRE" },
          statusMessage: statusMessage,
        }),
      ).toBe(`Workflow **Page SRE** stopped paging: ${STOPPED}`);
    }
  });

  test("a page a person started stopped - the paging, not the person", () => {
    expect(
      OnCallFeedText.getDirectPageStatusMarkdown({
        status: OnCallDutyPolicyStatus.Completed,
        pager: {
          startedByUser: FeedMarkdown.link(
            "Simon Lee",
            "https://oneuptime.com/dashboard/p/users/s",
          ),
        },
        statusMessage: ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE,
      }),
    ).toBe(
      `The page from **[Simon Lee](https://oneuptime.com/dashboard/p/users/s)** stopped: ${STOPPED}`,
    );
  });

  test("is news for the feed, as every ending is", () => {
    expect(
      OnCallFeedText.isRunStatusFeedNews(OnCallDutyPolicyStatus.Completed),
    ).toBe(true);
  });
});
