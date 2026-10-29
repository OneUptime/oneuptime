import { describe, expect, test } from "@jest/globals";
import OnCallFeedText from "../../../../Server/Utils/OnCall/OnCallFeedText";
import OnCallDutyExecutionLogTimelineStatus from "../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { getAwayTimelineMessage } from "../../../../Types/OnCallDutyPolicy/AwayTimelineMessage";
import {
  ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
  getOnCallPolicyRunRecordHandledMessage,
} from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import FeedMarkdown, {
  MarkdownText,
} from "../../../../Utils/Markdown/FeedMarkdown";

/*
 * The feed entries of an on-call run - the run starting, each page sent,
 * acknowledged, skipped or failed, and the run ending - read as one sentence
 * each, in the words the run's Slack and Teams message uses, and never name
 * the record whose feed they are in.
 */

const POLICY: MarkdownText = FeedMarkdown.link(
  "Payments primary",
  "https://oneuptime.com/dashboard/p/on-call-duty/policies/x",
);
const NITIN: MarkdownText = FeedMarkdown.link(
  "Nitin Kumar",
  "https://oneuptime.com/dashboard/p/users/n",
);
const SAM: MarkdownText = FeedMarkdown.link(
  "Sam Lee",
  "https://oneuptime.com/dashboard/p/users/s",
);

const POLICY_MD: string =
  "**[Payments primary](https://oneuptime.com/dashboard/p/on-call-duty/policies/x)**";
const NITIN_MD: string =
  "**[Nitin Kumar](https://oneuptime.com/dashboard/p/users/n)**";

describe("a page sent", () => {
  test("is one sentence: the policy paged the person at the rule", () => {
    expect(
      OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        policyLink: POLICY,
        ruleName: "first",
        recipient: NITIN,
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} paged ${NITIN_MD} at escalation rule **first**.`,
    );
  });

  test("names the schedule and the team the person was paged through", () => {
    expect(
      OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        policyLink: POLICY,
        ruleName: "first",
        scheduleName: "EU primary",
        teamName: "Payments",
        recipient: NITIN,
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} paged ${NITIN_MD} at escalation rule **first** (schedule **EU primary**), as a member of **Payments**.`,
    );
  });

  test("the step's own message follows as a sentence of its own", () => {
    expect(
      OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        policyLink: POLICY,
        ruleName: "first",
        recipient: NITIN,
        statusMessage: "Notification sent by SMS",
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} paged ${NITIN_MD} at escalation rule **first**.\n\nNotification sent by SMS.`,
    );
  });

  test("a message that ends its own sentence is not given a second full stop", () => {
    const markdown: string = OnCallFeedText.getStepMarkdown({
      status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
      policyLink: POLICY,
      ruleName: "first",
      recipient: NITIN,
      statusMessage: "Sent by email!",
    });

    expect(markdown.endsWith("Sent by email!")).toBe(true);
  });
});

describe("the other outcomes of a page", () => {
  test.each<[OnCallDutyExecutionLogTimelineStatus, string]>([
    [
      OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
      `${NITIN_MD} acknowledged the page from on-call policy ${POLICY_MD} at escalation rule **first**.`,
    ],
    [
      OnCallDutyExecutionLogTimelineStatus.Error,
      `On-call policy ${POLICY_MD} could not page ${NITIN_MD} at escalation rule **first**.`,
    ],
    [
      OnCallDutyExecutionLogTimelineStatus.Skipped,
      `On-call policy ${POLICY_MD} did not page ${NITIN_MD} at escalation rule **first**.`,
    ],
    [
      OnCallDutyExecutionLogTimelineStatus.Started,
      `On-call policy ${POLICY_MD} is paging ${NITIN_MD} at escalation rule **first**.`,
    ],
  ])("%s", (status: OnCallDutyExecutionLogTimelineStatus, expected: string) => {
    expect(
      OnCallFeedText.getStepMarkdown({
        status,
        policyLink: POLICY,
        ruleName: "first",
        recipient: NITIN,
      }),
    ).toBe(expected);
  });

  test("a person covering for someone else says so", () => {
    expect(
      OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        policyLink: POLICY,
        ruleName: "first",
        recipient: NITIN,
        overriddenUser: SAM,
      }),
    ).toContain(
      "They are covering for [Sam Lee](https://oneuptime.com/dashboard/p/users/s) (a user override).",
    );
  });

  test("somebody away gets their return time as a moment each reader sees in their own zone", () => {
    const until: Date = new Date("2026-10-17T09:00:00.000Z");
    const markdown: string = OnCallFeedText.getStepMarkdown({
      status: OnCallDutyExecutionLogTimelineStatus.Skipped,
      policyLink: POLICY,
      ruleName: "second",
      recipient: SAM,
      statusMessage: getAwayTimelineMessage(until),
    });

    expect(markdown).toContain(
      "Away until `2026-10-17T09:00:00.000Z`, and nobody is named to cover for them.",
    );
    // Not the UTC wording the run writes for its own page.
    expect(markdown).not.toContain("09:00 UTC");
  });
});

describe("a rule that reached nobody", () => {
  test("says the policy paged nobody, and why: nobody on call in the schedule", () => {
    const markdown: string = OnCallFeedText.getStepMarkdown({
      status: OnCallDutyExecutionLogTimelineStatus.Skipped,
      policyLink: POLICY,
      ruleName: "Level 1",
      scheduleName: "Weekend Rotation",
      statusMessage: "Skipped because no one is on call.",
    });

    expect(markdown).toBe(
      `On-call policy ${POLICY_MD} paged nobody at escalation rule **Level 1**: nobody was on call in schedule **Weekend Rotation**.\n\nSkipped because no one is on call.`,
    );
  });

  test("or that the rule has no responders at all", () => {
    expect(
      OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        policyLink: POLICY,
        ruleName: "third",
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} paged nobody at escalation rule **third**: this escalation rule has no responders.`,
    );
  });

  test("never claims anyone was paged, and never draws an empty name", () => {
    const markdown: string = OnCallFeedText.getStepMarkdown({
      status: OnCallDutyExecutionLogTimelineStatus.Skipped,
      policyLink: POLICY,
      ruleName: "third",
      recipient: FeedMarkdown.empty(),
      overriddenUser: SAM,
    });

    expect(markdown).toContain("paged nobody");
    expect(markdown).not.toContain("****");
    expect(markdown).not.toContain("covering for");
  });

  test("a rule without a name reads 'Unnamed Rule', never an empty bold", () => {
    const markdown: string = OnCallFeedText.getStepMarkdown({
      status: OnCallDutyExecutionLogTimelineStatus.Skipped,
      policyLink: POLICY,
      ruleName: "  ",
    });

    expect(markdown).toContain("escalation rule **Unnamed Rule**");
    expect(markdown).not.toContain("****");
    expect(markdown).not.toContain("undefined");
  });
});

describe("names are text", () => {
  test("a rule, schedule or team name cannot become a link, an image or a mention", () => {
    const markdown: string = OnCallFeedText.getStepMarkdown({
      status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
      policyLink: POLICY,
      ruleName: "[click](https://evil.example)",
      scheduleName: "![x](https://tracker.example/p.png)",
      teamName: "<!channel>",
      recipient: NITIN,
    });

    // Escaped where they sit: the brackets are text, not a link or image.
    expect(markdown).not.toContain("[click](https://evil.example)");
    expect(markdown).toContain("\\[click\\](https://evil.example)");
    expect(markdown).not.toContain("![x](");
    expect(markdown).toContain("!\\[x\\]");
    expect(markdown).not.toContain("<!channel>");
  });

  test("a status message is text too", () => {
    const markdown: string = OnCallFeedText.getStepMarkdown({
      status: OnCallDutyExecutionLogTimelineStatus.Error,
      policyLink: POLICY,
      ruleName: "first",
      recipient: NITIN,
      statusMessage: "Could not reach [a phone](https://evil.example).",
    });

    expect(markdown).not.toContain("[a phone](https://evil.example)");
    expect(markdown).toContain("\\[a phone\\](https://evil.example)");
  });
});

describe("the run starting", () => {
  test("by itself: the policy started paging", () => {
    expect(
      OnCallFeedText.getRunStartedMarkdown({
        policyLink: POLICY,
        isStartedBySomeone: false,
      }),
    ).toBe(`On-call policy ${POLICY_MD} started paging.`);
  });

  test("by someone: a sentence that follows their name in the feed", () => {
    expect(
      OnCallFeedText.getRunStartedMarkdown({
        policyLink: POLICY,
        isStartedBySomeone: true,
      }),
    ).toBe(`started on-call policy ${POLICY_MD}.`);
  });
});

describe("where the run stands", () => {
  test("went through every rule", () => {
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

  test.each<[string, string]>([
    ["incident", "the incident is acknowledged or resolved."],
    ["alert", "the alert is acknowledged or resolved."],
    ["alert episode", "the alert episode is acknowledged or resolved."],
    ["incident episode", "the incident episode is acknowledged or resolved."],
  ])(
    "stopped because its %s was handled",
    (recordKind: string, ending: string) => {
      expect(
        OnCallFeedText.getRunStatusMarkdown({
          status: OnCallDutyPolicyStatus.Completed,
          policyLink: POLICY,
          statusMessage: getOnCallPolicyRunRecordHandledMessage(recordKind),
        }),
      ).toBe(`On-call policy ${POLICY_MD} stopped paging because ${ending}`);
    },
  );

  test("finished without paging anyone - the failure it is", () => {
    expect(
      OnCallFeedText.getRunStatusMarkdown({
        status: OnCallDutyPolicyStatus.CompletedWithNoNotifications,
        policyLink: POLICY,
        statusMessage: "No one was on call in any schedule.",
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} went through every escalation rule and paged nobody.\n\nNo one was on call in any schedule.`,
    );
  });

  test("stopped with an error, which it names", () => {
    expect(
      OnCallFeedText.getRunStatusMarkdown({
        status: OnCallDutyPolicyStatus.Error,
        policyLink: POLICY,
        statusMessage: "The policy has no escalation rules",
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} stopped with an error.\n\nThe policy has no escalation rules.`,
    );
  });

  test.each<[OnCallDutyPolicyStatus, string]>([
    [OnCallDutyPolicyStatus.Scheduled, "is scheduled to start paging."],
    [OnCallDutyPolicyStatus.Started, "started paging."],
    [OnCallDutyPolicyStatus.Executing, "is paging."],
  ])("%s", (status: OnCallDutyPolicyStatus, ending: string) => {
    expect(
      OnCallFeedText.getRunStatusMarkdown({ status, policyLink: POLICY }),
    ).toBe(`On-call policy ${POLICY_MD} ${ending}`);
  });

  test("any other ending is kept, with its message", () => {
    expect(
      OnCallFeedText.getRunStatusMarkdown({
        status: OnCallDutyPolicyStatus.Completed,
        policyLink: POLICY,
        statusMessage: "Stopped by an administrator",
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} stopped paging.\n\nStopped by an administrator.`,
    );
  });
});

describe("which of a run's statuses are news for the feed", () => {
  /*
   * The run's start is written when it is created and every page it sends
   * is an entry of its own: the statuses it passes through on the way said
   * "started paging" a second time and "is paging" once more, on every run.
   * How it ended is news.
   */
  test.each<[OnCallDutyPolicyStatus, boolean]>([
    // Said when the run is created (getRunWaitingMarkdown).
    [OnCallDutyPolicyStatus.Waiting, false],
    [OnCallDutyPolicyStatus.Scheduled, false],
    [OnCallDutyPolicyStatus.Started, false],
    [OnCallDutyPolicyStatus.Executing, false],
    [OnCallDutyPolicyStatus.Completed, true],
    [OnCallDutyPolicyStatus.CompletedWithNoNotifications, true],
    [OnCallDutyPolicyStatus.Error, true],
  ])("%s: %p", (status: OnCallDutyPolicyStatus, isNews: boolean) => {
    expect(OnCallFeedText.isRunStatusFeedNews(status)).toBe(isNews);
  });

  test("every status the enum has is decided (a new one is news until said otherwise)", () => {
    for (const status of Object.values(OnCallDutyPolicyStatus)) {
      expect(typeof OnCallFeedText.isRunStatusFeedNews(status)).toBe("boolean");
    }

    expect(
      OnCallFeedText.isRunStatusFeedNews(
        "Paused by an administrator" as OnCallDutyPolicyStatus,
      ),
    ).toBe(true);
  });

  test("no status at all is not news", () => {
    expect(OnCallFeedText.isRunStatusFeedNews(undefined)).toBe(false);
  });
});

describe("the record is never named", () => {
  test("no entry links back to the incident, alert or episode it is in the feed of", () => {
    const entries: Array<string> = [
      OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        policyLink: POLICY,
        ruleName: "first",
        recipient: NITIN,
      }),
      OnCallFeedText.getRunStartedMarkdown({
        policyLink: POLICY,
        isStartedBySomeone: false,
      }),
      OnCallFeedText.getRunStatusMarkdown({
        status: OnCallDutyPolicyStatus.Completed,
        policyLink: POLICY,
        statusMessage: getOnCallPolicyRunRecordHandledMessage("incident"),
      }),
    ];

    for (const entry of entries) {
      expect(entry).not.toMatch(/\[Incident /);
      expect(entry).not.toMatch(/\[Alert /);
      expect(entry).not.toContain("On-Call Alert");
      expect(entry).not.toContain("has been triggered");
    }
  });
});
