import { describe, expect, test } from "@jest/globals";
import OnCallFeedText from "../../../../Server/Utils/OnCall/OnCallFeedText";
import { getOnCallPolicyRunRecordHandledMessage } from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import {
  ON_CALL_POLICY_RUN_STARTED_EARLY_REASON_MAX_LENGTH,
  getOnCallPolicyRunEndedWhileWaitingMessage,
  getOnCallPolicyRunStartedEarlyReason,
  getOnCallPolicyRunWaitingMessage,
  isOnCallPolicyRunEndedWhileWaiting,
  isOnCallPolicyRunWaitingForWorkingHours,
} from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunWait";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import FeedMarkdown, {
  MarkdownText,
} from "../../../../Utils/Markdown/FeedMarkdown";

/*
 * WHAT A RUN THAT WAITS TO PAGE SAYS IN ITS RECORD'S FEED.
 *
 * Created waiting - an on-call rule held it until working hours - it says it
 * is not paging yet, and its status message says why and until when: the
 * words its Execution Logs row shows too. Ended before it paged, because
 * its record was handled, it says it did not page anyone - never that it
 * "stopped paging", which it never began.
 */

const POLICY: MarkdownText = FeedMarkdown.link(
  "Payments primary",
  "https://oneuptime.com/dashboard/p/on-call-duty/policies/x",
);

const POLICY_MD: string =
  "**[Payments primary](https://oneuptime.com/dashboard/p/on-call-duty/policies/x)**";

const WAITING_MESSAGE: string =
  "Waiting for working hours. Paging starts Tue 09:00 (Europe/London).";

describe("the message a waiting run is given", () => {
  test("says it waits for working hours, and when paging starts, in the rule's zone", () => {
    expect(
      getOnCallPolicyRunWaitingMessage({
        pagingStartsAt: new Date("2026-10-20T08:00:00Z"),
        timezone: "Europe/London",
        now: new Date("2026-10-20T01:00:00Z"),
        isWaitingForWorkingHours: true,
      }),
    ).toBe(WAITING_MESSAGE);
  });

  test("held for another reason, says only when paging starts, on UTC's clock without a zone", () => {
    expect(
      getOnCallPolicyRunWaitingMessage({
        pagingStartsAt: new Date("2026-10-21T08:00:00Z"),
        now: new Date("2026-10-20T01:00:00Z"),
        isWaitingForWorkingHours: false,
      }),
    ).toBe("Waiting. Paging starts Wed 08:00 (UTC).");
  });

  test("is told apart from every other message by how it starts", () => {
    expect(isOnCallPolicyRunWaitingForWorkingHours(WAITING_MESSAGE)).toBe(true);
    expect(
      isOnCallPolicyRunWaitingForWorkingHours(
        "Waiting. Paging starts Tue 08:00 (UTC).",
      ),
    ).toBe(false);
    expect(isOnCallPolicyRunWaitingForWorkingHours(undefined)).toBe(false);
  });
});

describe("the message of a run that ended while it waited", () => {
  test("says it completed without paging, and why", () => {
    expect(getOnCallPolicyRunEndedWhileWaitingMessage("alert")).toBe(
      "Execution completed without paging because alert is acknowledged or resolved.",
    );
  });

  test("is not the message of a run that stopped paging", () => {
    expect(
      isOnCallPolicyRunEndedWhileWaiting(
        getOnCallPolicyRunEndedWhileWaitingMessage("incident"),
      ),
    ).toBe(true);
    expect(
      isOnCallPolicyRunEndedWhileWaiting(
        getOnCallPolicyRunRecordHandledMessage("incident"),
      ),
    ).toBe(false);
    expect(isOnCallPolicyRunEndedWhileWaiting(null)).toBe(false);
  });
});

/*
 * A run that waited for working hours, started before they began: its record
 * changed and now matches an on-call rule that pages right away
 * (WaitingRunsOnRecordChange).
 */
describe("why a run that waited started early", () => {
  test("names the rule that pages right away, and the kind of record", () => {
    expect(
      getOnCallPolicyRunStartedEarlyReason({
        recordKind: "alert",
        ruleNames: ["P1 alerts"],
      }),
    ).toBe(
      'The alert now matches on-call rule "P1 alerts", which pages right away.',
    );
    expect(
      getOnCallPolicyRunStartedEarlyReason({
        recordKind: "incident episode",
        ruleNames: ["SEV1"],
      }),
    ).toBe(
      'The incident episode now matches on-call rule "SEV1", which pages right away.',
    );
  });

  test("names two rules, counts any more, and names each once", () => {
    expect(
      getOnCallPolicyRunStartedEarlyReason({
        recordKind: "incident",
        ruleNames: ["SEV1", "Payments", "SEV1"],
      }),
    ).toBe(
      'The incident now matches on-call rules "SEV1" and "Payments", which page right away.',
    );
    expect(
      getOnCallPolicyRunStartedEarlyReason({
        recordKind: "alert",
        ruleNames: ["A", "B", "C", "D"],
      }),
    ).toBe(
      'The alert now matches on-call rules "A", "B" and 2 more, which page right away.',
    );
  });

  test("rules with no names still say what happened", () => {
    expect(
      getOnCallPolicyRunStartedEarlyReason({
        recordKind: "alert",
        ruleNames: ["", "  "],
      }),
    ).toBe("The alert now matches an on-call rule that pages right away.");
  });

  test("long names are cut, so it always fits the run's column", () => {
    const reason: string = getOnCallPolicyRunStartedEarlyReason({
      recordKind: "incident episode",
      ruleNames: ["x".repeat(2000), "y".repeat(2000), "z"],
    });

    expect(reason.length).toBeLessThanOrEqual(
      ON_CALL_POLICY_RUN_STARTED_EARLY_REASON_MAX_LENGTH,
    );
    expect(reason).toContain("…");
    expect(reason).toMatch(/and 1 more, which page right away\.$/);
  });

  test("its record's feed says it started paging early, and why", () => {
    expect(
      OnCallFeedText.getRunStartedMarkdown({
        policyLink: POLICY,
        isStartedBySomeone: false,
        startedEarlyReason:
          'The alert now matches on-call rule "P1 alerts", which pages right away.',
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} started paging early. The alert now matches on-call rule "P1 alerts", which pages right away.`,
    );
  });

  test("a rule's name is text in the feed, never Markdown", () => {
    const markdown: string = OnCallFeedText.getRunStartedMarkdown({
      policyLink: POLICY,
      isStartedBySomeone: false,
      startedEarlyReason: getOnCallPolicyRunStartedEarlyReason({
        recordKind: "alert",
        ruleNames: ["[click](https://evil.example)"],
      }),
    });

    expect(markdown).toContain("\\[click\\](https://evil.example)");
  });

  test("a run that started at its moment says only that it started paging", () => {
    expect(
      OnCallFeedText.getRunStartedMarkdown({
        policyLink: POLICY,
        isStartedBySomeone: false,
      }),
    ).toBe(`On-call policy ${POLICY_MD} started paging.`);
  });
});

describe("a run created waiting, in its record's feed", () => {
  test("is not paging yet, and says why and until when", () => {
    expect(
      OnCallFeedText.getRunWaitingMarkdown({
        policyLink: POLICY,
        isStartedBySomeone: false,
        waitingMessage: WAITING_MESSAGE,
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} is not paging yet. Waiting for working hours. Paging starts Tue 09:00 (Europe/London).`,
    );
  });

  test("with no message, says only that it is not paging yet", () => {
    expect(
      OnCallFeedText.getRunWaitingMarkdown({
        policyLink: POLICY,
        isStartedBySomeone: false,
      }),
    ).toBe(`On-call policy ${POLICY_MD} is not paging yet.`);
  });

  test("started by somebody, reads after their name, as a start does", () => {
    expect(
      OnCallFeedText.getRunWaitingMarkdown({
        policyLink: POLICY,
        isStartedBySomeone: true,
        waitingMessage: WAITING_MESSAGE,
      }),
    ).toBe(
      `started on-call policy ${POLICY_MD}. It is not paging yet. Waiting for working hours. Paging starts Tue 09:00 (Europe/London).`,
    );
  });

  test("started by a workflow, names the workflow", () => {
    expect(
      OnCallFeedText.getRunWaitingMarkdown({
        policyLink: POLICY,
        isStartedBySomeone: false,
        startedByWorkflowName: "Page SRE",
      }),
    ).toBe(
      `Workflow **Page SRE** started on-call policy ${POLICY_MD}. It is not paging yet.`,
    );
  });

  test("a policy's name and the message are text, never Markdown", () => {
    const sneaky: MarkdownText = FeedMarkdown.link(
      "**[click](https://evil.example)**",
      "https://oneuptime.com/dashboard/p/on-call-duty/policies/x",
    );

    const entry: string = OnCallFeedText.getRunWaitingMarkdown({
      policyLink: sneaky,
      isStartedBySomeone: false,
      waitingMessage: "Waiting: [paging](https://evil.example) starts.",
    });

    // Every bracket of theirs is escaped: no link but the policy's own.
    expect(entry).toContain("\\*\\*\\[click\\]\\(https://evil.example\\)");
    expect(entry).toContain(
      "Waiting: \\[paging\\](https://evil.example) starts.",
    );
  });
});

describe("a waiting run's status, in its record's feed", () => {
  test("waiting is not news: the run said so when it was created", () => {
    expect(
      OnCallFeedText.isRunStatusFeedNews(OnCallDutyPolicyStatus.Waiting),
    ).toBe(false);
  });

  test("if it is ever written, it says the run is not paging yet, and why", () => {
    expect(
      OnCallFeedText.getRunStatusMarkdown({
        status: OnCallDutyPolicyStatus.Waiting,
        policyLink: POLICY,
        statusMessage: WAITING_MESSAGE,
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} is not paging yet.\n\nWaiting for working hours. Paging starts Tue 09:00 (Europe/London).`,
    );
  });

  test("ended because its record was handled, it did not page anyone - it never stopped paging", () => {
    const ended: string = OnCallFeedText.getRunStatusMarkdown({
      status: OnCallDutyPolicyStatus.Completed,
      policyLink: POLICY,
      statusMessage: getOnCallPolicyRunEndedWhileWaitingMessage("alert"),
    });

    expect(ended).toBe(
      `On-call policy ${POLICY_MD} did not page anyone because the alert is acknowledged or resolved.`,
    );
    expect(ended).not.toContain("stopped paging");
  });

  test("a run that stopped paging because its record was handled still says so", () => {
    expect(
      OnCallFeedText.getRunStatusMarkdown({
        status: OnCallDutyPolicyStatus.Completed,
        policyLink: POLICY,
        statusMessage: getOnCallPolicyRunRecordHandledMessage("alert"),
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} stopped paging because the alert is acknowledged or resolved.`,
    );
  });
});
