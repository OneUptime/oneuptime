import { describe, expect, test } from "@jest/globals";
import OnCallFeedText from "../../../../Server/Utils/OnCall/OnCallFeedText";
import OnCallDutyExecutionLogTimelineStatus from "../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import { getOnCallPassOnLevelLabel } from "../../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import FeedMarkdown, {
  MarkdownText,
} from "../../../../Utils/Markdown/FeedMarkdown";

/*
 * A LEVEL IN A RECORD'S FEED IS NAMED AS THE ESCALATE DIALOG NAMES IT.
 *
 * The dialog says "Platform leads (Level 2 of 3)"; the feed said "at
 * escalation rule **Platform leads**" for the same level, and the run's
 * Slack and Teams message "escalation rule 2 of 3 (Platform leads)" (#5167).
 * A feed entry now names the level by its name, then its place - or its
 * place alone when it has no name of its own - the dialog's own wording.
 * The schedule the person was paged from shares the place's brackets:
 * "(Level 1 of 3, schedule **Primary**)", never "(Level 1 of 3) (schedule
 * **Primary**)". An entry whose level's place is not known is written as
 * before.
 */

const POLICY: MarkdownText = FeedMarkdown.link(
  "Payments primary",
  "https://oneuptime.com/dashboard/p/on-call-duty/policies/x",
);
const NITIN: MarkdownText = FeedMarkdown.link(
  "Nitin Kumar",
  "https://oneuptime.com/dashboard/p/users/n",
);

const POLICY_MD: string =
  "**[Payments primary](https://oneuptime.com/dashboard/p/on-call-duty/policies/x)**";
const NITIN_MD: string =
  "**[Nitin Kumar](https://oneuptime.com/dashboard/p/users/n)**";

function paged(
  rule: {
    ruleName?: string | undefined;
    ruleOrder?: number | undefined;
    ruleCount?: number | undefined;
  },
  more: Record<string, unknown> = {},
): string {
  return OnCallFeedText.getStepMarkdown({
    status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
    policyLink: POLICY,
    recipient: NITIN,
    ...rule,
    ...more,
  });
}

describe("a page sent at a level", () => {
  test("names the level by its name, then its place", () => {
    expect(
      paged({ ruleName: "Platform leads", ruleOrder: 2, ruleCount: 3 }),
    ).toBe(
      `On-call policy ${POLICY_MD} paged ${NITIN_MD} at **Platform leads** (Level 2 of 3).`,
    );
  });

  test.each([
    ["no name", undefined],
    ["an empty name", "  "],
    ["only the name its place gives it", "Level 2"],
  ])(
    "a level with %s is its place alone",
    (_name: string, ruleName: string | undefined) => {
      expect(paged({ ruleName: ruleName, ruleOrder: 2, ruleCount: 3 })).toBe(
        `On-call policy ${POLICY_MD} paged ${NITIN_MD} at **Level 2 of 3**.`,
      );
    },
  );

  test("reads as the dialog's own label, word for word", () => {
    const sentenceEnd: RegExp = /\.$/;

    for (const ruleName of ["Platform leads", "Level 2", "", "night shift"]) {
      const entry: string = paged({
        ruleName: ruleName,
        ruleOrder: 2,
        ruleCount: 3,
      });

      expect([
        ruleName,
        entry.split(" at ")[1]!.split("**").join("").replace(sentenceEnd, ""),
      ]).toEqual([
        ruleName,
        getOnCallPassOnLevelLabel({ order: 2, name: ruleName }, 3),
      ]);
    }
  });

  test("a name somebody typed is kept as typed, and is text", () => {
    expect(
      paged({ ruleName: "night *shift* [x](y)", ruleOrder: 3, ruleCount: 3 }),
    ).toBe(
      `On-call policy ${POLICY_MD} paged ${NITIN_MD} at **night \\*shift\\* \\[x\\](y)** (Level 3 of 3).`,
    );
  });

  test("never says fewer levels than the level's own place", () => {
    expect(paged({ ruleName: "Late", ruleOrder: 4, ruleCount: 3 })).toBe(
      `On-call policy ${POLICY_MD} paged ${NITIN_MD} at **Late** (Level 4 of 4).`,
    );
  });

  test("when the policy's levels could not be counted, says the place alone", () => {
    expect(paged({ ruleName: "Platform leads", ruleOrder: 2 })).toBe(
      `On-call policy ${POLICY_MD} paged ${NITIN_MD} at **Platform leads** (Level 2).`,
    );
    expect(paged({ ruleOrder: 2, ruleCount: 0 })).toBe(
      `On-call policy ${POLICY_MD} paged ${NITIN_MD} at **Level 2**.`,
    );
  });

  test("the schedule and the rotation share the place's brackets, and the team follows", () => {
    expect(
      paged(
        { ruleName: "Primary", ruleOrder: 1, ruleCount: 2 },
        { scheduleName: "EU primary", teamName: "Payments" },
      ),
    ).toBe(
      `On-call policy ${POLICY_MD} paged ${NITIN_MD} at **Primary** (Level 1 of 2, schedule **EU primary**), as a member of **Payments**.`,
    );
    expect(
      paged(
        { ruleName: "Backup", ruleOrder: 2, ruleCount: 2 },
        { scheduleName: "EU primary", isNextInRotation: true },
      ),
    ).toBe(
      `On-call policy ${POLICY_MD} paged ${NITIN_MD} at **Backup** (Level 2 of 2, next in the **EU primary** rotation).`,
    );
    // A level with no name of its own is its place: the schedule has the brackets.
    expect(
      paged(
        { ruleOrder: 2, ruleCount: 2 },
        { scheduleName: "EU primary", isNextInRotation: true },
      ),
    ).toBe(
      `On-call policy ${POLICY_MD} paged ${NITIN_MD} at **Level 2 of 2** (next in the **EU primary** rotation).`,
    );
    expect(
      paged({ ruleOrder: 1, ruleCount: 2 }, { scheduleName: "EU primary" }),
    ).toBe(
      `On-call policy ${POLICY_MD} paged ${NITIN_MD} at **Level 1 of 2** (schedule **EU primary**).`,
    );
  });

  test("REGRESSION: never two brackets in a row - '(Level 1 of 3) (schedule Primary)' read like a stutter", () => {
    for (const ruleName of ["First line", "Level 1", undefined]) {
      for (const isNextInRotation of [false, true]) {
        const markdown: string = paged(
          { ruleName: ruleName, ruleOrder: 1, ruleCount: 3 },
          { scheduleName: "Primary", isNextInRotation: isNextInRotation },
        );

        // Where the page was sent from: everything after " at ".
        const where: string = markdown.split(" at ")[1]!;

        expect(where).not.toContain(") (");
        expect(where.split("(").length - 1).toBe(1);
      }
    }
  });

  test("a level whose place is not known is named as before", () => {
    expect(paged({ ruleName: "first" })).toBe(
      `On-call policy ${POLICY_MD} paged ${NITIN_MD} at escalation rule **first**.`,
    );
    expect(paged({ ruleName: "first", ruleOrder: 0, ruleCount: 3 })).toBe(
      `On-call policy ${POLICY_MD} paged ${NITIN_MD} at escalation rule **first**.`,
    );
  });
});

describe("every kind of step names its level the same way", () => {
  test.each([
    [
      OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
      `${NITIN_MD} acknowledged the page from on-call policy ${POLICY_MD} at **Platform leads** (Level 2 of 3).`,
    ],
    [
      OnCallDutyExecutionLogTimelineStatus.PassedOn,
      `${NITIN_MD} escalated the page from on-call policy ${POLICY_MD} at **Platform leads** (Level 2 of 3).`,
    ],
    [
      OnCallDutyExecutionLogTimelineStatus.Skipped,
      `On-call policy ${POLICY_MD} did not page ${NITIN_MD} at **Platform leads** (Level 2 of 3).`,
    ],
    [
      OnCallDutyExecutionLogTimelineStatus.Error,
      `On-call policy ${POLICY_MD} could not page ${NITIN_MD} at **Platform leads** (Level 2 of 3).`,
    ],
  ])("%s", (status: OnCallDutyExecutionLogTimelineStatus, entry: string) => {
    expect(
      OnCallFeedText.getStepMarkdown({
        status: status,
        policyLink: POLICY,
        recipient: NITIN,
        ruleName: "Platform leads",
        ruleOrder: 2,
        ruleCount: 3,
      }),
    ).toBe(entry);
  });

  test("a level that paged nobody", () => {
    expect(
      OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        policyLink: POLICY,
        ruleName: "Night shift",
        ruleOrder: 3,
        ruleCount: 3,
        scheduleName: "Nights",
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} paged nobody at **Night shift** (Level 3 of 3): nobody was on call in schedule **Nights**.`,
    );
    expect(
      OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        policyLink: POLICY,
        ruleOrder: 3,
        ruleCount: 3,
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} paged nobody at **Level 3 of 3**: this escalation rule has no responders.`,
    );
  });
});
