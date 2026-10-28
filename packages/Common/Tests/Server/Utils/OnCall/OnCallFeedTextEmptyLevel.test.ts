import { describe, expect, test } from "@jest/globals";
import OnCallFeedText, {
  OnCallStepFeedTextInput,
} from "../../../../Server/Utils/OnCall/OnCallFeedText";
import { ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE } from "../../../../Types/OnCallDutyPolicy/OnCallDirectPage";
import {
  LEGACY_ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE,
  ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_FIX,
  ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE,
} from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import {
  LEGACY_ON_CALL_LEVEL_NO_USERS_TIMELINE_MESSAGE,
  ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE,
  ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE,
} from "../../../../Types/OnCallDutyPolicy/OnCallEmptyLevel";
import OnCallDutyExecutionLogTimelineStatus from "../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import FeedMarkdown, {
  MarkdownText,
} from "../../../../Utils/Markdown/FeedMarkdown";

/*
 * A LEVEL THAT PAGED NOBODY, IN THE RECORD'S FEED.
 *
 * The maintainer's alert read:
 *
 *   16:20  On-call policy sg - irm paged nobody at Level 1 of 2: this
 *          escalation rule has no responders.
 *          Skipped because no users in this rule.
 *   16:24  On-call policy sg - irm paged Nitin Main at Level 2 of 2.
 *
 * A level with nobody to page now holds no wait (OnCallEmptyLevel), and its
 * entry says so - once, in its own words, with no status message saying it
 * again - and the next level's entries follow in the same minute:
 *
 *   16:20  On-call policy sg - irm paged nobody at Level 1 of 2: this
 *          escalation rule has no responders, so it moved on to the next
 *          level at once.
 *   16:20  On-call policy sg - irm paged Nitin Main at Level 2 of 2.
 */

const POLICY: MarkdownText = FeedMarkdown.link(
  "sg - irm",
  "https://oneuptime.com/dashboard/p/on-call-duty/policies/x",
);
// A link written in a name, its opening bracket not escaped.
const UNESCAPED_LINK: RegExp = /(?<!\\)\[x\]\(/;

const POLICY_MD: string =
  "**[sg - irm](https://oneuptime.com/dashboard/p/on-call-duty/policies/x)**";

function levelLine(
  statusMessage: string,
  more: Partial<OnCallStepFeedTextInput> = {},
): string {
  return OnCallFeedText.getStepMarkdown({
    status: OnCallDutyExecutionLogTimelineStatus.Skipped,
    policyLink: POLICY,
    ruleOrder: 1,
    ruleCount: 2,
    statusMessage: statusMessage,
    ...more,
  });
}

describe("a level that names nobody at all", () => {
  test("the maintainer's Level 1 of 2: no responders, so it moved on to the next level at once", () => {
    expect(levelLine(ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE)).toBe(
      `On-call policy ${POLICY_MD} paged nobody at **Level 1 of 2**: this escalation rule has no responders, so it moved on to the next level at once.`,
    );
  });

  test("the status message is not said again after it", () => {
    const entry: string = levelLine(
      ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE,
    );

    expect(entry).not.toContain("\n\n");
    expect(entry).not.toContain("so the policy moved on at once");
    expect(entry.split("moved on").length - 1).toBe(1);
  });

  test("a named level is named, then its place", () => {
    expect(
      levelLine(ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE, {
        ruleName: "First line",
        ruleOrder: 1,
        ruleCount: 3,
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} paged nobody at **First line** (Level 1 of 3): this escalation rule has no responders, so it moved on to the next level at once.`,
    );
  });

  test("the last level says nothing of moving on: the run's next entry says whether it started again or stopped", () => {
    expect(
      levelLine(ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE, {
        ruleOrder: 2,
        ruleCount: 2,
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} paged nobody at **Level 2 of 2**: this escalation rule has no responders.`,
    );
  });

  test("with the levels not counted, it says the run moved on at once - not where to", () => {
    expect(
      levelLine(ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE, {
        ruleCount: undefined,
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} paged nobody at **Level 1**: this escalation rule has no responders, so it moved on at once.`,
    );
  });

  test("a level whose place is not known is named as before, and still moved on at once", () => {
    expect(
      levelLine(ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE, {
        ruleName: "Managers",
        ruleOrder: undefined,
        ruleCount: undefined,
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} paged nobody at escalation rule **Managers**: this escalation rule has no responders, so it moved on at once.`,
    );
  });
});

describe("a level that named people, teams or schedules and paged nobody", () => {
  test("its own entry says it paged nobody and moved on - the entries before it say why", () => {
    expect(
      levelLine(ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE, {
        ruleOrder: 1,
        ruleCount: 3,
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} paged nobody at **Level 1 of 3**, so it moved on to the next level at once.`,
    );
  });

  test("at the last level: that it paged nobody, and nothing more", () => {
    expect(
      levelLine(ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE, {
        ruleOrder: 3,
        ruleCount: 3,
      }),
    ).toBe(`On-call policy ${POLICY_MD} paged nobody at **Level 3 of 3**.`);
  });

  test("it never says the level has no responders: it has some", () => {
    expect(
      levelLine(ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE),
    ).not.toContain("no responders");
  });

  test("a level's name is text: Markdown in it formats nothing and links nowhere", () => {
    const entry: string = levelLine(
      ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE,
      { ruleName: "**Night** [x](https://evil.example/x)" },
    );

    expect(entry).toContain("\\*\\*Night\\*\\*");
    // The brackets are escaped: no link can form from them.
    expect(entry).toContain("\\[x\\](https://evil.example/x)");
    expect(entry).not.toMatch(UNESCAPED_LINK);
  });
});

describe("the entries that say why a level paged nobody", () => {
  test("a team with no members is named - and the step's message is not said again", () => {
    expect(
      levelLine(ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE, {
        teamName: "Night Shift",
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} paged nobody at **Level 1 of 2**: team **Night Shift** has no members.`,
    );
  });

  test("a schedule with nobody on call keeps its message after it, as it always has", () => {
    expect(
      levelLine("Skipped because no active users are found in this schedule.", {
        scheduleName: "Primary",
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} paged nobody at **Level 1 of 2**: nobody was on call in schedule **Primary**.\n\nSkipped because no active users are found in this schedule.`,
    );
  });

  test("a schedule's line names the schedule even when a team is set on it", () => {
    expect(
      levelLine("Skipped because no active users are found in this schedule.", {
        scheduleName: "Primary",
        teamName: "Night Shift",
      }),
    ).toContain("nobody was on call in schedule **Primary**");
  });

  test("a line from before levels were passed at once reads as it did, without its message said again", () => {
    expect(levelLine(LEGACY_ON_CALL_LEVEL_NO_USERS_TIMELINE_MESSAGE)).toBe(
      `On-call policy ${POLICY_MD} paged nobody at **Level 1 of 2**: this escalation rule has no responders.`,
    );
  });
});

describe("a run that paged nobody at any level", () => {
  test("says who should fix the policy, rather than that nobody was notified a second time", () => {
    expect(
      OnCallFeedText.getRunStatusMarkdown({
        status: OnCallDutyPolicyStatus.CompletedWithNoNotifications,
        policyLink: POLICY,
        statusMessage: ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE,
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} went through every escalation rule and paged nobody.\n\nThis policy's owners should add responders to its escalation rules, or check who is on call in its schedules.`,
    );
  });

  test("a run that ended so before says the same", () => {
    expect(
      OnCallFeedText.getRunStatusMarkdown({
        status: OnCallDutyPolicyStatus.CompletedWithNoNotifications,
        policyLink: POLICY,
        statusMessage: LEGACY_ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE,
      }),
    ).toContain(ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_FIX);
  });

  test("any other message is kept as it is, as before", () => {
    expect(
      OnCallFeedText.getRunStatusMarkdown({
        status: OnCallDutyPolicyStatus.CompletedWithNoNotifications,
        policyLink: POLICY,
        statusMessage: "Something else happened",
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} went through every escalation rule and paged nobody.\n\nSomething else happened.`,
    );
  });

  test("the run's message and the feed's sentence say the same thing to fix", () => {
    expect(
      ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE.endsWith(
        ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_FIX,
      ),
    ).toBe(true);
  });
});
