import { afterEach, describe, expect, jest, test } from "@jest/globals";
import OnCallFeedText, {
  OnCallDirectPagePager,
} from "../../../../Server/Utils/OnCall/OnCallFeedText";
import ProductBrandingText from "../../../../Server/Utils/ProductBrandingText";
import OnCallDutyExecutionLogTimelineStatus from "../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { getAwayTimelineMessage } from "../../../../Types/OnCallDutyPolicy/AwayTimelineMessage";
import {
  ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE,
  ON_CALL_DIRECT_PAGE_NOBODY_PAGED_MESSAGE,
  ON_CALL_DIRECT_PAGE_NOBODY_TO_PAGE_TIMELINE_MESSAGE,
  getOnCallDirectPagePagingMessage,
} from "../../../../Types/OnCallDutyPolicy/OnCallDirectPage";
import {
  ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
  getOnCallPolicyRunRecordHandledMessage,
} from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import FeedMarkdown, {
  MarkdownText,
} from "../../../../Utils/Markdown/FeedMarkdown";

/*
 * THE FEED ENTRIES OF A DIRECT PAGE.
 *
 * A direct page - people, a team or a schedule paged with no on-call policy
 * behind the page - writes to its record's feed as a policy's run does, one
 * sentence an entry, with whoever started the page where the policy is and
 * no escalation rule: "Workflow Page the on-call engineer paged Nitin Kumar,
 * on call in schedule Primary." This suite pins every sentence, who is named
 * as the pager, that every name in them is text, and the sentence a policy's
 * run gets when a workflow's step started it.
 */

const NITIN: MarkdownText = FeedMarkdown.link(
  "Nitin Kumar",
  "https://oneuptime.com/dashboard/p/users/n",
);
const SAM: MarkdownText = FeedMarkdown.link(
  "Sam Lee",
  "https://oneuptime.com/dashboard/p/users/s",
);
const POLICY: MarkdownText = FeedMarkdown.link(
  "Payments primary",
  "https://oneuptime.com/dashboard/p/on-call-duty/policies/x",
);

const NITIN_MD: string =
  "**[Nitin Kumar](https://oneuptime.com/dashboard/p/users/n)**";
const SAM_MD: string =
  "**[Sam Lee](https://oneuptime.com/dashboard/p/users/s)**";
const POLICY_MD: string =
  "**[Payments primary](https://oneuptime.com/dashboard/p/on-call-duty/policies/x)**";

const WORKFLOW: OnCallDirectPagePager = {
  workflowName: "Page the on-call engineer",
};
const WORKFLOW_MD: string = "Workflow **Page the on-call engineer**";

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a person a direct page paged", () => {
  test("named themselves: the workflow paged the person", () => {
    expect(
      OnCallFeedText.getDirectPageStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        pager: WORKFLOW,
        recipient: NITIN,
      }),
    ).toBe(`${WORKFLOW_MD} paged ${NITIN_MD}.`);
  });

  test("on call in a schedule: the schedule is named", () => {
    expect(
      OnCallFeedText.getDirectPageStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        pager: WORKFLOW,
        recipient: NITIN,
        scheduleName: "Primary",
      }),
    ).toBe(
      `${WORKFLOW_MD} paged ${NITIN_MD}, on call in schedule **Primary**.`,
    );
  });

  test("a member of a team: the team is named", () => {
    expect(
      OnCallFeedText.getDirectPageStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        pager: WORKFLOW,
        recipient: NITIN,
        teamName: "Platform",
      }),
    ).toBe(`${WORKFLOW_MD} paged ${NITIN_MD}, as a member of **Platform**.`);
  });

  test("a line that names a schedule and a team says the schedule, once", () => {
    const markdown: string = OnCallFeedText.getDirectPageStepMarkdown({
      status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
      pager: WORKFLOW,
      recipient: NITIN,
      scheduleName: "Primary",
      teamName: "Platform",
    });

    expect(markdown).toBe(
      `${WORKFLOW_MD} paged ${NITIN_MD}, on call in schedule **Primary**.`,
    );
  });

  test("names of a schedule or a team that are only spaces are not named", () => {
    expect(
      OnCallFeedText.getDirectPageStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        pager: WORKFLOW,
        recipient: NITIN,
        scheduleName: "   ",
        teamName: " ",
      }),
    ).toBe(`${WORKFLOW_MD} paged ${NITIN_MD}.`);
  });

  test("how the page went out follows as a sentence of its own", () => {
    expect(
      OnCallFeedText.getDirectPageStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        pager: WORKFLOW,
        recipient: NITIN,
        scheduleName: "Primary",
        statusMessage: "Notification sent by SMS",
      }),
    ).toBe(
      `${WORKFLOW_MD} paged ${NITIN_MD}, on call in schedule **Primary**.\n\nNotification sent by SMS.`,
    );
  });

  test("no escalation rule is ever named: a direct page has none", () => {
    for (const status of Object.values(OnCallDutyExecutionLogTimelineStatus)) {
      const markdown: string = OnCallFeedText.getDirectPageStepMarkdown({
        status: status,
        pager: WORKFLOW,
        recipient: NITIN,
        scheduleName: "Primary",
        statusMessage: "Notification sent by SMS.",
      });

      expect(markdown).not.toContain("escalation rule");
      expect(markdown).not.toContain("Unnamed Rule");
      expect(markdown).not.toContain("On-call policy");
      expect(markdown).not.toContain("on-call policy");
    }
  });
});

describe("the other outcomes of a direct page's page", () => {
  test.each<[OnCallDutyExecutionLogTimelineStatus, string]>([
    [
      OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
      `${NITIN_MD} acknowledged the page from workflow **Page the on-call engineer**.`,
    ],
    [
      OnCallDutyExecutionLogTimelineStatus.Error,
      `${WORKFLOW_MD} could not page ${NITIN_MD}, as a member of **Platform**.`,
    ],
    [
      OnCallDutyExecutionLogTimelineStatus.Skipped,
      `${WORKFLOW_MD} did not page ${NITIN_MD}, as a member of **Platform**.`,
    ],
    [
      OnCallDutyExecutionLogTimelineStatus.Started,
      `${WORKFLOW_MD} is paging ${NITIN_MD}, as a member of **Platform**.`,
    ],
    [
      OnCallDutyExecutionLogTimelineStatus.Executing,
      `${WORKFLOW_MD} is paging ${NITIN_MD}, as a member of **Platform**.`,
    ],
  ])("%s", (status: OnCallDutyExecutionLogTimelineStatus, expected: string) => {
    expect(
      OnCallFeedText.getDirectPageStepMarkdown({
        status: status,
        pager: WORKFLOW,
        recipient: NITIN,
        teamName: "Platform",
      }),
    ).toBe(expected);
  });

  test("every status the timeline has gets a sentence that names the person", () => {
    for (const status of Object.values(OnCallDutyExecutionLogTimelineStatus)) {
      const markdown: string = OnCallFeedText.getDirectPageStepMarkdown({
        status: status,
        pager: WORKFLOW,
        recipient: NITIN,
      });

      expect(markdown).toContain(NITIN_MD);
      expect(markdown).toContain("Page the on-call engineer");
      expect(markdown.charAt(markdown.length - 1)).toBe(".");
    }
  });

  test("a person covering for someone else says so", () => {
    expect(
      OnCallFeedText.getDirectPageStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        pager: WORKFLOW,
        recipient: NITIN,
        overriddenUser: SAM,
      }),
    ).toBe(
      `${WORKFLOW_MD} paged ${NITIN_MD}.\n\nThey are covering for [Sam Lee](https://oneuptime.com/dashboard/p/users/s) (a user override).`,
    );
  });

  test("somebody away is not paged, and their return time is a moment each reader sees in their own zone", () => {
    const until: Date = new Date("2026-10-17T09:00:00.000Z");
    const markdown: string = OnCallFeedText.getDirectPageStepMarkdown({
      status: OnCallDutyExecutionLogTimelineStatus.Skipped,
      pager: WORKFLOW,
      recipient: SAM,
      statusMessage: getAwayTimelineMessage(until),
    });

    expect(markdown).toBe(
      `${WORKFLOW_MD} did not page ${SAM_MD}.\n\nAway until \`2026-10-17T09:00:00.000Z\`, and nobody is named to cover for them.`,
    );
    // Not the UTC wording the run writes on its own timeline.
    expect(markdown).not.toContain("09:00 UTC");
  });
});

describe("a target a direct page found nobody in", () => {
  test("a schedule with nobody on call", () => {
    expect(
      OnCallFeedText.getDirectPageStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        pager: WORKFLOW,
        scheduleName: "Weekend Rotation",
        statusMessage: "Skipped because no one is on call.",
      }),
    ).toBe(
      `${WORKFLOW_MD} paged nobody: nobody was on call in schedule **Weekend Rotation**.`,
    );
  });

  test("a team with no members", () => {
    expect(
      OnCallFeedText.getDirectPageStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        pager: WORKFLOW,
        teamName: "Platform",
        statusMessage: ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE,
      }),
    ).toBe(`${WORKFLOW_MD} paged nobody: team **Platform** has no members.`);
  });

  test("a page with nobody to page at all", () => {
    expect(
      OnCallFeedText.getDirectPageStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        pager: WORKFLOW,
        statusMessage: ON_CALL_DIRECT_PAGE_NOBODY_TO_PAGE_TIMELINE_MESSAGE,
      }),
    ).toBe(`${WORKFLOW_MD} paged nobody.`);
  });

  test("the line's own 'Skipped because' is not said again after the reason", () => {
    for (const statusMessage of [
      "Skipped because no one is on call.",
      ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE,
      ON_CALL_DIRECT_PAGE_NOBODY_TO_PAGE_TIMELINE_MESSAGE,
    ]) {
      const markdown: string = OnCallFeedText.getDirectPageStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        pager: WORKFLOW,
        scheduleName: "Weekend Rotation",
        teamName: "Platform",
        statusMessage: statusMessage,
      });

      expect(markdown).not.toContain("Skipped because");
      expect(markdown).not.toContain("\n");
    }
  });

  test("never claims anyone was paged, and never draws an empty name", () => {
    const markdown: string = OnCallFeedText.getDirectPageStepMarkdown({
      status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
      pager: WORKFLOW,
      recipient: FeedMarkdown.empty(),
      overriddenUser: SAM,
      scheduleName: "Weekend Rotation",
    });

    expect(markdown).toBe(
      `${WORKFLOW_MD} paged nobody: nobody was on call in schedule **Weekend Rotation**.`,
    );
    expect(markdown).not.toContain("****");
    expect(markdown).not.toContain("covering for");
  });
});

describe("who is named as having paged", () => {
  test("the workflow whose step started the page", () => {
    expect(
      OnCallFeedText.getDirectPageStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        pager: { workflowName: "  Page SRE  " },
        recipient: NITIN,
      }),
    ).toBe(`Workflow **Page SRE** paged ${NITIN_MD}.`);
  });

  test("the person who started it, as the link to them", () => {
    expect(
      OnCallFeedText.getDirectPageStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        pager: { startedByUser: SAM },
        recipient: NITIN,
      }),
    ).toBe(`${SAM_MD} paged ${NITIN_MD}.`);
  });

  test("the person who acknowledged a person's page reads after their name", () => {
    expect(
      OnCallFeedText.getDirectPageStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
        pager: { startedByUser: SAM },
        recipient: NITIN,
      }),
    ).toBe(`${NITIN_MD} acknowledged the page from ${SAM_MD}.`);
  });

  test("the workflow rather than the person, when both are known", () => {
    expect(
      OnCallFeedText.getDirectPageStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        pager: { workflowName: "Page SRE", startedByUser: SAM },
        recipient: NITIN,
      }),
    ).toBe(`Workflow **Page SRE** paged ${NITIN_MD}.`);
  });

  test.each<[string, OnCallDirectPagePager]>([
    ["nobody is known", {}],
    ["the workflow's name is only spaces", { workflowName: "   " }],
    ["the person's link is empty", { startedByUser: FeedMarkdown.empty() }],
  ])(
    "the product itself, when %s",
    (_when: string, pager: OnCallDirectPagePager) => {
      const productName: string = ProductBrandingText.getProductName();

      expect(productName.length).toBeGreaterThan(0);
      expect(
        OnCallFeedText.getDirectPageStepMarkdown({
          status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
          pager: pager,
          recipient: NITIN,
        }),
      ).toBe(`${productName} paged ${NITIN_MD}.`);
      expect(
        OnCallFeedText.getDirectPageStatusMarkdown({
          status: OnCallDutyPolicyStatus.CompletedWithNoNotifications,
          pager: pager,
        }),
      ).toBe(`${productName} paged nobody.`);
    },
  );

  test("the product goes by the installation's own name when it has one", () => {
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("Acme Status");

    expect(
      OnCallFeedText.getDirectPageStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        pager: {},
        recipient: NITIN,
      }),
    ).toBe(`Acme Status paged ${NITIN_MD}.`);
    expect(
      OnCallFeedText.getDirectPageStatusMarkdown({
        status: OnCallDutyPolicyStatus.Error,
        pager: {},
        statusMessage: "Could not read the schedule",
      }),
    ).toBe(
      "Acme Status stopped with an error.\n\nCould not read the schedule.",
    );
  });
});

describe("names are text", () => {
  test("a workflow's name cannot become a link, an image or a mention", () => {
    const markdown: string = OnCallFeedText.getDirectPageStepMarkdown({
      status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
      pager: { workflowName: "[click](https://evil.example) <!channel>" },
      recipient: NITIN,
    });

    expect(markdown).not.toContain("[click](https://evil.example)");
    expect(markdown).toContain("\\[click\\](https://evil.example)");
    expect(markdown).not.toContain("<!channel>");
  });

  test("nor can a schedule's or a team's, where somebody was paged or nobody was", () => {
    for (const recipient of [NITIN, undefined]) {
      const viaSchedule: string = OnCallFeedText.getDirectPageStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        pager: WORKFLOW,
        recipient: recipient,
        scheduleName: "![x](https://tracker.example/p.png)",
      });

      expect(viaSchedule).not.toContain("![x](");
      expect(viaSchedule).toContain("!\\[x\\]");

      const viaTeam: string = OnCallFeedText.getDirectPageStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        pager: WORKFLOW,
        recipient: recipient,
        teamName: "**bold** [team](https://evil.example)",
      });

      expect(viaTeam).not.toContain("[team](https://evil.example)");
      expect(viaTeam).toContain("\\[team\\](https://evil.example)");
    }
  });

  test("a status message is text too, on a page and on the run's ending", () => {
    const step: string = OnCallFeedText.getDirectPageStepMarkdown({
      status: OnCallDutyExecutionLogTimelineStatus.Error,
      pager: WORKFLOW,
      recipient: NITIN,
      statusMessage: "Could not reach [a phone](https://evil.example).",
    });

    expect(step).not.toContain("[a phone](https://evil.example)");
    expect(step).toContain("\\[a phone\\](https://evil.example)");

    const ending: string = OnCallFeedText.getDirectPageStatusMarkdown({
      status: OnCallDutyPolicyStatus.Error,
      pager: WORKFLOW,
      statusMessage: "See [the log](https://evil.example).",
    });

    expect(ending).not.toContain("[the log](https://evil.example)");
    expect(ending).toContain("\\[the log\\](https://evil.example)");
  });

  test("a workflow's name in a policy's 'started' sentence is text as well", () => {
    const markdown: string = OnCallFeedText.getRunStartedMarkdown({
      policyLink: POLICY,
      isStartedBySomeone: false,
      startedByWorkflowName: "[click](https://evil.example)",
    });

    expect(markdown).not.toContain("[click](https://evil.example)");
    expect(markdown).toContain("\\[click\\](https://evil.example)");
    // The policy stays the link it is.
    expect(markdown).toContain(POLICY_MD);
  });
});

describe("where a direct page stands", () => {
  test("everybody's notifications went out and nobody acknowledged", () => {
    expect(
      OnCallFeedText.getDirectPageStatusMarkdown({
        status: OnCallDutyPolicyStatus.Completed,
        pager: WORKFLOW,
        statusMessage: ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
      }),
    ).toBe(`${WORKFLOW_MD} stopped paging: nobody acknowledged.`);
  });

  test.each<[string, string]>([
    ["incident", "the incident is acknowledged or resolved."],
    ["alert", "the alert is acknowledged or resolved."],
  ])(
    "stopped because its %s was handled",
    (recordKind: string, ending: string) => {
      expect(
        OnCallFeedText.getDirectPageStatusMarkdown({
          status: OnCallDutyPolicyStatus.Completed,
          pager: WORKFLOW,
          statusMessage: getOnCallPolicyRunRecordHandledMessage(recordKind),
        }),
      ).toBe(`${WORKFLOW_MD} stopped paging because ${ending}`);
    },
  );

  test("paged nobody: one sentence, as each target's own entry says why", () => {
    expect(
      OnCallFeedText.getDirectPageStatusMarkdown({
        status: OnCallDutyPolicyStatus.CompletedWithNoNotifications,
        pager: WORKFLOW,
        statusMessage: ON_CALL_DIRECT_PAGE_NOBODY_PAGED_MESSAGE,
      }),
    ).toBe(`${WORKFLOW_MD} paged nobody.`);
  });

  test("stopped with an error, which it names", () => {
    expect(
      OnCallFeedText.getDirectPageStatusMarkdown({
        status: OnCallDutyPolicyStatus.Error,
        pager: WORKFLOW,
        statusMessage: "User notification rules could not be read",
      }),
    ).toBe(
      `${WORKFLOW_MD} stopped with an error.\n\nUser notification rules could not be read.`,
    );
  });

  test("an error with nothing to add is one sentence", () => {
    expect(
      OnCallFeedText.getDirectPageStatusMarkdown({
        status: OnCallDutyPolicyStatus.Error,
        pager: WORKFLOW,
      }),
    ).toBe(`${WORKFLOW_MD} stopped with an error.`);
  });

  test.each<[OnCallDutyPolicyStatus, string | undefined, string]>([
    [OnCallDutyPolicyStatus.Scheduled, "Scheduled.", "is about to page."],
    [OnCallDutyPolicyStatus.Started, "Paging started...", "started paging."],
    [
      OnCallDutyPolicyStatus.Executing,
      getOnCallDirectPagePagingMessage(2),
      "is paging.\n\n2 people were paged.",
    ],
    [OnCallDutyPolicyStatus.Executing, undefined, "is paging."],
  ])(
    "%s (%s)",
    (
      status: OnCallDutyPolicyStatus,
      statusMessage: string | undefined,
      ending: string,
    ) => {
      expect(
        OnCallFeedText.getDirectPageStatusMarkdown({
          status: status,
          pager: WORKFLOW,
          statusMessage: statusMessage,
        }),
      ).toBe(`${WORKFLOW_MD} ${ending}`);
    },
  );

  test("any other ending is kept, with its message", () => {
    expect(
      OnCallFeedText.getDirectPageStatusMarkdown({
        status: OnCallDutyPolicyStatus.Completed,
        pager: WORKFLOW,
        statusMessage: "Stopped by an administrator",
      }),
    ).toBe(`${WORKFLOW_MD} stopped paging.\n\nStopped by an administrator.`);
  });

  test("a status nobody has written a sentence for is still said", () => {
    expect(
      OnCallFeedText.getDirectPageStatusMarkdown({
        status: "Paused" as OnCallDutyPolicyStatus,
        pager: WORKFLOW,
        statusMessage: "Paused by an administrator",
      }),
    ).toBe(`${WORKFLOW_MD} is now **Paused**.\n\nPaused by an administrator.`);
  });

  test("every status the enum has gets a sentence that names the pager and no policy", () => {
    for (const status of Object.values(OnCallDutyPolicyStatus)) {
      const markdown: string = OnCallFeedText.getDirectPageStatusMarkdown({
        status: status,
        pager: WORKFLOW,
        statusMessage: ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
      });

      expect(markdown.indexOf(WORKFLOW_MD)).toBe(0);
      expect(markdown).not.toContain("On-call policy");
      expect(markdown).not.toContain("on-call policy");
      expect(markdown).not.toContain("went through every escalation rule");
    }
  });
});

/*
 * A page a PERSON started - from Slack or Microsoft Teams - ends as their
 * page ending, the words its chat message uses ("so paging stopped"): the
 * person did not stop it. What the person did is still theirs: they are
 * about to page, started paging, are paging, paged nobody.
 */
describe("where a direct page a person started stands", () => {
  const BY_SAM: OnCallDirectPagePager = { startedByUser: SAM };

  function status(
    pageStatus: OnCallDutyPolicyStatus,
    statusMessage?: string | undefined,
  ): string {
    return OnCallFeedText.getDirectPageStatusMarkdown({
      status: pageStatus,
      pager: BY_SAM,
      statusMessage: statusMessage,
    });
  }

  test("nobody acknowledged: the page from them stopped", () => {
    expect(
      status(
        OnCallDutyPolicyStatus.Completed,
        ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
      ),
    ).toBe(`The page from ${SAM_MD} stopped: nobody acknowledged.`);
  });

  test.each<[string, string]>([
    ["incident", "the incident is acknowledged or resolved."],
    ["alert", "the alert is acknowledged or resolved."],
  ])(
    "its %s was handled: the page from them stopped, and why",
    (recordKind: string, ending: string) => {
      expect(
        status(
          OnCallDutyPolicyStatus.Completed,
          getOnCallPolicyRunRecordHandledMessage(recordKind),
        ),
      ).toBe(`The page from ${SAM_MD} stopped because ${ending}`);
    },
  );

  test("any other ending, with its message", () => {
    expect(
      status(OnCallDutyPolicyStatus.Completed, "Stopped by an administrator"),
    ).toBe(`The page from ${SAM_MD} stopped.\n\nStopped by an administrator.`);
  });

  test("an error: the page from them stopped with it", () => {
    expect(
      status(
        OnCallDutyPolicyStatus.Error,
        "User notification rules could not be read",
      ),
    ).toBe(
      `The page from ${SAM_MD} stopped with an error.\n\nUser notification rules could not be read.`,
    );
  });

  test.each<[OnCallDutyPolicyStatus, string | undefined, string]>([
    [OnCallDutyPolicyStatus.Scheduled, "Scheduled.", "is about to page."],
    [OnCallDutyPolicyStatus.Started, "Paging started...", "started paging."],
    [OnCallDutyPolicyStatus.Executing, undefined, "is paging."],
    [
      OnCallDutyPolicyStatus.CompletedWithNoNotifications,
      ON_CALL_DIRECT_PAGE_NOBODY_PAGED_MESSAGE,
      "paged nobody.",
    ],
  ])(
    "what they did is still theirs: %s",
    (
      pageStatus: OnCallDutyPolicyStatus,
      statusMessage: string | undefined,
      ending: string,
    ) => {
      expect(status(pageStatus, statusMessage)).toBe(`${SAM_MD} ${ending}`);
    },
  );

  test("no status says the person stopped paging", () => {
    for (const pageStatus of Object.values(OnCallDutyPolicyStatus)) {
      for (const statusMessage of [
        ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
        getOnCallPolicyRunRecordHandledMessage("alert"),
        "Stopped by an administrator",
        undefined,
      ]) {
        const text: string = status(pageStatus, statusMessage);

        // "The page from Sam stopped", never "Sam stopped ...".
        expect({ pageStatus, startsWithSam: text.startsWith(SAM_MD) }).toEqual({
          pageStatus,
          startsWithSam: !text.includes(" stopped"),
        });
        expect({ pageStatus, text }).toEqual({
          pageStatus,
          text: expect.not.stringContaining("stopped paging"),
        });
      }
    }
  });

  test("a workflow's page still stops paging itself, when both are known", () => {
    expect(
      OnCallFeedText.getDirectPageStatusMarkdown({
        status: OnCallDutyPolicyStatus.Completed,
        pager: { ...WORKFLOW, startedByUser: SAM },
        statusMessage: ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
      }),
    ).toBe(`${WORKFLOW_MD} stopped paging: nobody acknowledged.`);
  });
});

describe("a policy's run a workflow's step started", () => {
  test("says the workflow started the policy", () => {
    expect(
      OnCallFeedText.getRunStartedMarkdown({
        policyLink: POLICY,
        isStartedBySomeone: false,
        startedByWorkflowName: "Page the on-call engineer",
      }),
    ).toBe(`${WORKFLOW_MD} started on-call policy ${POLICY_MD}.`);
  });

  test("a person who started it by hand is credited instead, after their name", () => {
    expect(
      OnCallFeedText.getRunStartedMarkdown({
        policyLink: POLICY,
        isStartedBySomeone: true,
        startedByWorkflowName: "Page the on-call engineer",
      }),
    ).toBe(`started on-call policy ${POLICY_MD}.`);
  });

  test.each<[string, string | undefined]>([
    ["no name", undefined],
    ["an empty name", ""],
    ["a name of spaces", "   "],
  ])(
    "a workflow with %s reads as a run nobody started by hand",
    (_what: string, startedByWorkflowName: string | undefined) => {
      expect(
        OnCallFeedText.getRunStartedMarkdown({
          policyLink: POLICY,
          isStartedBySomeone: false,
          startedByWorkflowName: startedByWorkflowName,
        }),
      ).toBe(`On-call policy ${POLICY_MD} started paging.`);
    },
  );
});

describe("the record is never named", () => {
  test("no entry links back to the incident or alert it is in the feed of", () => {
    const entries: Array<string> = [
      OnCallFeedText.getDirectPageStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        pager: WORKFLOW,
        recipient: NITIN,
        scheduleName: "Primary",
      }),
      OnCallFeedText.getDirectPageStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        pager: WORKFLOW,
        teamName: "Platform",
      }),
      OnCallFeedText.getDirectPageStatusMarkdown({
        status: OnCallDutyPolicyStatus.Completed,
        pager: WORKFLOW,
        statusMessage: getOnCallPolicyRunRecordHandledMessage("incident"),
      }),
      OnCallFeedText.getRunStartedMarkdown({
        policyLink: POLICY,
        isStartedBySomeone: false,
        startedByWorkflowName: "Page the on-call engineer",
      }),
    ];

    for (const entry of entries) {
      expect(entry).not.toContain("[Incident ");
      expect(entry).not.toContain("[Alert ");
      expect(entry).not.toContain("On-Call Alert");
      expect(entry).not.toContain("has been triggered");
    }
  });
});
