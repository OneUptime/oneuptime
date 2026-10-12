import { describe, expect, test } from "@jest/globals";
import OnCallPolicyRunMessageView, {
  ON_CALL_RUN_ALARM_NOBODY_PAGED_AT_A_RULE,
  ON_CALL_RUN_ALARM_OUTCOME,
  OnCallPolicyRun,
  OnCallPolicyRunAlarm,
  OnCallPolicyRunOutcome,
} from "../../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessageView";

/*
 * WHAT ONE ON-CALL POLICY RUN SAYS IN SLACK AND MICROSOFT TEAMS.
 *
 * A run is one message, edited as it goes: which policy is paging for which
 * record, where the escalation is, who was paged (how often, how), who was
 * not and why, and what happens next. It raises a new message (an alarm)
 * only where somebody must act. These pin every part of that wording, for
 * every way a run can stand.
 */

const POLICY_URL: string =
  "https://oneuptime.test/dashboard/p/on-call-duty/policies/x";
const RUN_URL: string =
  "https://oneuptime.test/dashboard/p/on-call-duty/execution-logs/run-1";
const RECORD_URL: string = "https://oneuptime.test/dashboard/p/incidents/inc-8";

function run(overrides: Partial<OnCallPolicyRun> = {}): OnCallPolicyRun {
  return {
    policyName: "PolicyX",
    policyUrl: POLICY_URL,
    runUrl: RUN_URL,
    recordLabel: "Incident INC-8",
    recordUrl: RECORD_URL,
    outcome: OnCallPolicyRunOutcome.Paging,
    ruleCount: 3,
    currentRule: { order: 2, name: "second" },
    nextRule: { order: 3, name: "third" },
    escalateAfterInMinutes: 5,
    repeatNumber: 0,
    repeatsAllowed: 2,
    paged: [
      {
        name: "Nitin",
        timesPaged: 3,
        isBeingPaged: false,
        acknowledged: false,
        methods: ["call", "SMS", "email"],
        coveringFor: [],
      },
      {
        name: "NB User 3",
        timesPaged: 2,
        isBeingPaged: false,
        acknowledged: false,
        methods: ["email"],
        coveringFor: [],
      },
    ],
    notPaged: [
      { personName: "NB User 2", reason: "not a member of this project" },
      { scheduleName: "sec", reason: "nobody was on call" },
      { rule: { order: 3, name: "third" }, reason: "nobody to page" },
    ],
    ...overrides,
  };
}

function alarmKeys(alarms: Array<OnCallPolicyRunAlarm>): Array<string> {
  return alarms.map((alarm: OnCallPolicyRunAlarm): string => {
    return alarm.key;
  });
}

describe("OnCallPolicyRunMessageView.getMarkdown - a run that is paging", () => {
  test("is one message: headline, progress, who was paged, who was not, what is next, and a link to every step", () => {
    expect(OnCallPolicyRunMessageView.getMarkdown(run())).toBe(
      [
        `📟 **[PolicyX](${POLICY_URL})** is paging for **[Incident INC-8](${RECORD_URL})**`,
        "**Escalation rule 2 of 3 (second)** · repeats up to twice if nobody acknowledges",
        "**Paged**\n- **Nitin**: paged 3 times · by call, SMS, email\n- **NB User 3**: paged twice · by email",
        "**Not paged**\n- **NB User 2**: not a member of this project\n- Nobody was on call in schedule **sec**\n- Escalation rule 3 (third): nobody to page",
        "If nobody acknowledges within 5 minutes, escalation rule 3 of 3 (third) is next.",
        `[See every step in OneUptime](${RUN_URL})`,
      ].join("\n\n"),
    );
  });

  test("on a repeat, the progress says which repeat of how many", () => {
    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(
      run({ repeatNumber: 1, currentRule: { order: 1, name: "fhirst" } }),
    );

    expect(markdown).toContain(
      "**Escalation rule 1 of 3 (fhirst)** · repeat 1 of 2",
    );
    expect(markdown).not.toContain("repeats up to");
  });

  test("a policy that never repeats says nothing about repeats", () => {
    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(
      run({ repeatsAllowed: 0 }),
    );

    expect(markdown).toContain("**Escalation rule 2 of 3 (second)**\n\n");
    expect(markdown).not.toContain("repeat");
  });

  test("a policy allowed one repeat says it repeats once", () => {
    expect(
      OnCallPolicyRunMessageView.getMarkdown(run({ repeatsAllowed: 1 })),
    ).toContain("· repeats up to once if nobody acknowledges");
  });

  test("before its first rule has started, the run says it is starting", () => {
    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(
      run({
        currentRule: undefined,
        nextRule: undefined,
        paged: [],
        notPaged: [],
        repeatsAllowed: 0,
      }),
    );

    expect(markdown).toContain("**Starting with escalation rule 1 of 3**");
    expect(markdown).not.toContain("**Paged**");
    expect(markdown).not.toContain("**Not paged**");
  });

  test("a rule without a name is named by its place alone", () => {
    expect(
      OnCallPolicyRunMessageView.getMarkdown(
        run({ currentRule: { order: 2 }, nextRule: { order: 3, name: " " } }),
      ),
    ).toContain(
      "**Escalation rule 2 of 3** · repeats up to twice if nobody acknowledges",
    );
  });

  test("what happens next: the next rule, the policy starting again, or paging ending", () => {
    expect(
      OnCallPolicyRunMessageView.getMarkdown(
        run({ nextRule: undefined, repeatNumber: 0, repeatsAllowed: 2 }),
      ),
    ).toContain(
      "If nobody acknowledges within 5 minutes, the policy starts again from escalation rule 1.",
    );

    expect(
      OnCallPolicyRunMessageView.getMarkdown(
        run({ nextRule: undefined, repeatNumber: 2, repeatsAllowed: 2 }),
      ),
    ).toContain(
      "This is the last step: if nobody acknowledges within 5 minutes, paging ends.",
    );

    expect(
      OnCallPolicyRunMessageView.getMarkdown(
        run({ nextRule: undefined, repeatsAllowed: 0 }),
      ),
    ).toContain("This is the last step:");
  });

  test("the wait reads as a minute, one minute or N minutes", () => {
    expect(
      OnCallPolicyRunMessageView.getMarkdown(
        run({ escalateAfterInMinutes: 0 }),
      ),
    ).toContain("If nobody acknowledges within a minute,");
    expect(
      OnCallPolicyRunMessageView.getMarkdown(
        run({ escalateAfterInMinutes: 1 }),
      ),
    ).toContain("If nobody acknowledges within 1 minute,");
    expect(
      OnCallPolicyRunMessageView.getMarkdown(
        run({ escalateAfterInMinutes: 30 }),
      ),
    ).toContain("If nobody acknowledges within 30 minutes,");
  });

  test("a person: how often, still being paged, acknowledged, covering for somebody, how it reached them", () => {
    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(
      run({
        paged: [
          {
            name: "Alice",
            timesPaged: 1,
            isBeingPaged: false,
            acknowledged: true,
            methods: ["push"],
            coveringFor: [],
          },
          {
            name: "Bob",
            timesPaged: 1,
            isBeingPaged: true,
            acknowledged: false,
            methods: [],
            coveringFor: ["Carol", "Dave"],
          },
          {
            name: "Erin",
            timesPaged: 0,
            isBeingPaged: true,
            acknowledged: false,
            methods: [],
            coveringFor: [],
          },
          {
            name: "Frank",
            timesPaged: 0,
            isBeingPaged: false,
            acknowledged: false,
            methods: [],
            coveringFor: [],
          },
        ],
      }),
    );

    expect(markdown).toContain(
      "- **Alice**: acknowledged ✅ · paged once · by push",
    );
    expect(markdown).toContain(
      "- **Bob** (covering for Carol, Dave): paged once · being paged now",
    );
    expect(markdown).toContain("- **Erin**: being paged now");
    expect(markdown).toContain("- **Frank**\n");
  });
});

describe("OnCallPolicyRunMessageView.getMarkdown - how a run ended", () => {
  test("acknowledged: who acknowledged, and that paging stopped; no progress, no next step", () => {
    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(
      run({
        outcome: OnCallPolicyRunOutcome.Acknowledged,
        acknowledgedByName: "Nitin",
      }),
    );

    expect(markdown.split("\n\n")[0]).toBe(
      `✅ **Nitin** acknowledged **[Incident INC-8](${RECORD_URL})**: **[PolicyX](${POLICY_URL})** stopped paging`,
    );
    expect(markdown).not.toContain("Escalation rule 2 of 3");
    expect(markdown).not.toContain("If nobody acknowledges");
    expect(markdown).toContain("**Paged**");
    expect(markdown).toContain(`[See every step in OneUptime](${RUN_URL})`);
  });

  test("acknowledged by somebody the run cannot name", () => {
    expect(
      OnCallPolicyRunMessageView.getMarkdown(
        run({ outcome: OnCallPolicyRunOutcome.Acknowledged }),
      ),
    ).toContain("✅ **Someone** acknowledged");
  });

  test("the record was handled some other way: the run says what state it is in", () => {
    expect(
      OnCallPolicyRunMessageView.getMarkdown(
        run({
          outcome: OnCallPolicyRunOutcome.RecordHandled,
          outcomeDetail: "Resolved",
        }),
      ).split("\n\n")[0],
    ).toBe(
      `✅ **[PolicyX](${POLICY_URL})** stopped paging: **[Incident INC-8](${RECORD_URL})** is Resolved`,
    );

    expect(
      OnCallPolicyRunMessageView.getMarkdown(
        run({ outcome: OnCallPolicyRunOutcome.RecordHandled }),
      ),
    ).toContain("is being handled");
  });

  test("every other ending has a headline of its own", () => {
    const headline: (overrides: Partial<OnCallPolicyRun>) => string = (
      overrides: Partial<OnCallPolicyRun>,
    ): string => {
      return OnCallPolicyRunMessageView.getMarkdown(run(overrides)).split(
        "\n\n",
      )[0]!;
    };

    expect(headline({ outcome: OnCallPolicyRunOutcome.PolicyArchived })).toBe(
      `⏹️ **[PolicyX](${POLICY_URL})** stopped paging for **[Incident INC-8](${RECORD_URL})**: the policy was archived`,
    );
    expect(
      headline({ outcome: OnCallPolicyRunOutcome.NobodyAcknowledged }),
    ).toBe(
      `⚠️ **[PolicyX](${POLICY_URL})** went through every escalation rule for **[Incident INC-8](${RECORD_URL})** and nobody acknowledged`,
    );
    expect(headline({ outcome: OnCallPolicyRunOutcome.NobodyReached })).toBe(
      `⚠️ **[PolicyX](${POLICY_URL})** could not reach anyone for **[Incident INC-8](${RECORD_URL})**`,
    );
    expect(
      headline({
        outcome: OnCallPolicyRunOutcome.Failed,
        outcomeDetail: "No Escalation Rules in Policy.",
      }),
    ).toBe(
      `❌ **[PolicyX](${POLICY_URL})** could not page anyone for **[Incident INC-8](${RECORD_URL})**: No Escalation Rules in Policy.`,
    );
    expect(headline({ outcome: OnCallPolicyRunOutcome.Failed })).toBe(
      `❌ **[PolicyX](${POLICY_URL})** could not page anyone for **[Incident INC-8](${RECORD_URL})**`,
    );
  });
});

describe("OnCallPolicyRunMessageView.getAlarms - loud only where somebody has to act", () => {
  test("a run that is paging normally raises nothing", () => {
    expect(OnCallPolicyRunMessageView.getAlarms(run())).toEqual([]);
  });

  test("the first rule that reached nobody raises one alarm, with why", () => {
    const alarms: Array<OnCallPolicyRunAlarm> =
      OnCallPolicyRunMessageView.getAlarms(
        run({
          firstRuleThatReachedNobody: {
            rule: { order: 3, name: "third" },
            reasons: [
              "nobody was on call in schedule sec",
              "NB User 2: not a member of this project",
            ],
          },
        }),
      );

    expect(alarms).toEqual([
      {
        key: ON_CALL_RUN_ALARM_NOBODY_PAGED_AT_A_RULE,
        markdown: `⚠️ Nobody was paged for **[Incident INC-8](${RECORD_URL})** at escalation rule 3 of 3 (third) of **[PolicyX](${POLICY_URL})**: nobody was on call in schedule sec; NB User 2: not a member of this project. If nobody is on it yet, page someone or fix the policy.`,
      },
    ]);
  });

  test("nobody acknowledged: names who was paged, and how often the policy repeated", () => {
    const alarms: Array<OnCallPolicyRunAlarm> =
      OnCallPolicyRunMessageView.getAlarms(
        run({
          outcome: OnCallPolicyRunOutcome.NobodyAcknowledged,
          repeatNumber: 2,
        }),
      );

    expect(alarms).toEqual([
      {
        key: ON_CALL_RUN_ALARM_OUTCOME,
        markdown: `⚠️ Nobody has acknowledged **[Incident INC-8](${RECORD_URL})**. **[PolicyX](${POLICY_URL})** paged Nitin and NB User 3 and went through every escalation rule and repeated 2 times. Someone needs to take it.`,
      },
    ]);

    expect(
      OnCallPolicyRunMessageView.getAlarms(
        run({
          outcome: OnCallPolicyRunOutcome.NobodyAcknowledged,
          repeatNumber: 1,
          paged: [run().paged[0]!],
        }),
      )[0]!.markdown,
    ).toContain(
      "paged Nitin and went through every escalation rule and repeated once.",
    );

    expect(
      OnCallPolicyRunMessageView.getAlarms(
        run({
          outcome: OnCallPolicyRunOutcome.NobodyAcknowledged,
          repeatNumber: 0,
          paged: [
            run().paged[0]!,
            run().paged[1]!,
            { ...run().paged[1]!, name: "Zed" },
          ],
        }),
      )[0]!.markdown,
    ).toContain(
      "paged Nitin, NB User 3 and Zed and went through every escalation rule. Someone",
    );
  });

  test("nobody reached, a failed run and an archived policy each raise their own alarm", () => {
    expect(
      OnCallPolicyRunMessageView.getAlarms(
        run({ outcome: OnCallPolicyRunOutcome.NobodyReached }),
      ),
    ).toEqual([
      {
        key: ON_CALL_RUN_ALARM_OUTCOME,
        markdown: `⚠️ Nobody was paged for **[Incident INC-8](${RECORD_URL})**: no escalation rule of **[PolicyX](${POLICY_URL})** reached anyone. Check who is on call, or page someone yourself.`,
      },
    ]);

    expect(
      OnCallPolicyRunMessageView.getAlarms(
        run({
          outcome: OnCallPolicyRunOutcome.Failed,
          outcomeDetail: "No Escalation Rules in Policy.",
        }),
      ),
    ).toEqual([
      {
        key: ON_CALL_RUN_ALARM_OUTCOME,
        markdown: `❌ **[PolicyX](${POLICY_URL})** could not page anyone for **[Incident INC-8](${RECORD_URL})**: No Escalation Rules in Policy.`,
      },
    ]);

    expect(
      OnCallPolicyRunMessageView.getAlarms(
        run({ outcome: OnCallPolicyRunOutcome.PolicyArchived }),
      ),
    ).toEqual([
      {
        key: ON_CALL_RUN_ALARM_OUTCOME,
        markdown: `⏹️ **[PolicyX](${POLICY_URL})** stopped paging for **[Incident INC-8](${RECORD_URL})** because the policy was archived. Nobody else will be paged: someone needs to take it.`,
      },
    ]);
  });

  test("a run that ends with somebody on it raises no alarm: the state change says who", () => {
    expect(
      OnCallPolicyRunMessageView.getAlarms(
        run({
          outcome: OnCallPolicyRunOutcome.Acknowledged,
          acknowledgedByName: "Nitin",
        }),
      ),
    ).toEqual([]);
    expect(
      OnCallPolicyRunMessageView.getAlarms(
        run({
          outcome: OnCallPolicyRunOutcome.RecordHandled,
          outcomeDetail: "Acknowledged",
        }),
      ),
    ).toEqual([]);
  });

  test("a rule that reached nobody and an ending raise one alarm each, never more", () => {
    expect(
      alarmKeys(
        OnCallPolicyRunMessageView.getAlarms(
          run({
            outcome: OnCallPolicyRunOutcome.NobodyReached,
            firstRuleThatReachedNobody: {
              rule: { order: 1, name: "first" },
              reasons: [],
            },
          }),
        ),
      ),
    ).toEqual([
      ON_CALL_RUN_ALARM_NOBODY_PAGED_AT_A_RULE,
      ON_CALL_RUN_ALARM_OUTCOME,
    ]);
  });

  test("a rule that reached nobody without a reason says so without a dangling colon", () => {
    expect(
      OnCallPolicyRunMessageView.getAlarms(
        run({
          firstRuleThatReachedNobody: {
            rule: { order: 1 },
            reasons: [],
          },
        }),
      )[0]!.markdown,
    ).toContain(
      "at escalation rule 1 of 3 of **[PolicyX](https://oneuptime.test/dashboard/p/on-call-duty/policies/x)**. If nobody",
    );
  });
});

describe("OnCallPolicyRunMessageView.getPlainText - what a notification shows", () => {
  test("one line of plain text for every way a run stands", () => {
    expect(OnCallPolicyRunMessageView.getPlainText(run())).toBe(
      "PolicyX is paging for Incident INC-8",
    );
    expect(
      OnCallPolicyRunMessageView.getPlainText(
        run({
          outcome: OnCallPolicyRunOutcome.Acknowledged,
          acknowledgedByName: "Nitin",
        }),
      ),
    ).toBe("Nitin acknowledged Incident INC-8");
    expect(
      OnCallPolicyRunMessageView.getPlainText(
        run({ outcome: OnCallPolicyRunOutcome.RecordHandled }),
      ),
    ).toBe("PolicyX stopped paging for Incident INC-8");
    expect(
      OnCallPolicyRunMessageView.getPlainText(
        run({ outcome: OnCallPolicyRunOutcome.PolicyArchived }),
      ),
    ).toBe(
      "PolicyX stopped paging for Incident INC-8: the policy was archived",
    );
    expect(
      OnCallPolicyRunMessageView.getPlainText(
        run({ outcome: OnCallPolicyRunOutcome.NobodyAcknowledged }),
      ),
    ).toBe("Nobody acknowledged Incident INC-8");
    expect(
      OnCallPolicyRunMessageView.getPlainText(
        run({ outcome: OnCallPolicyRunOutcome.NobodyReached }),
      ),
    ).toBe("PolicyX could not reach anyone for Incident INC-8");
    expect(
      OnCallPolicyRunMessageView.getPlainText(
        run({ outcome: OnCallPolicyRunOutcome.Failed }),
      ),
    ).toBe("PolicyX could not page anyone for Incident INC-8");
  });
});

/*
 * The Markdown with every escaped character taken out: what is left is what
 * a renderer reads as Markdown syntax. A name placed as text leaves nothing
 * of its brackets, emphasis or mention behind.
 */
const ESCAPED_CHARACTER: RegExp = /\\./gu;

function syntaxOf(markdown: string): string {
  return markdown.replace(ESCAPED_CHARACTER, "");
}

describe("OnCallPolicyRunMessageView - names are text, never Markdown", () => {
  const hostile: OnCallPolicyRun = run({
    policyName: "Ops *on call* [click](evil-target)",
    recordLabel: "Incident <!channel>",
    paged: [
      {
        name: "Mallory **boss** <@U123>",
        timesPaged: 1,
        isBeingPaged: false,
        acknowledged: false,
        methods: [],
        coveringFor: ["_Eve_"],
      },
    ],
    notPaged: [
      {
        personName: "Trent`code`",
        reason: "has opted out of notifications for [Sev1](evil-target)",
      },
      { scheduleName: "![img](tracker-target)", reason: "" },
    ],
    outcome: OnCallPolicyRunOutcome.Acknowledged,
    acknowledgedByName: "<!here> Bob",
  });

  test("no name becomes a link, an image, a mention or formatting", () => {
    const syntax: string = syntaxOf(
      OnCallPolicyRunMessageView.getMarkdown(hostile),
    );

    expect(syntax).not.toContain("](evil-target)");
    expect(syntax).not.toContain("](tracker-target)");
    expect(syntax).not.toContain("<!channel>");
    expect(syntax).not.toContain("<!here>");
    expect(syntax).not.toContain("<@U123>");
    expect(syntax).not.toContain("**boss**");
    expect(syntax).not.toContain("*on call*");
    expect(syntax).not.toContain("`code`");
    expect(syntax).not.toContain("_Eve_");
  });

  test("the alarms escape names the same way", () => {
    const alarms: Array<OnCallPolicyRunAlarm> =
      OnCallPolicyRunMessageView.getAlarms({
        ...hostile,
        outcome: OnCallPolicyRunOutcome.Failed,
        outcomeDetail: "[evil](evil-target) <!channel>",
        firstRuleThatReachedNobody: {
          rule: { order: 1, name: "[x](evil-target)" },
          reasons: ["<!channel>"],
        },
      });

    expect(alarms).toHaveLength(2);

    for (const alarm of alarms) {
      const syntax: string = syntaxOf(alarm.markdown);

      expect(syntax).not.toContain("](evil-target)");
      expect(syntax).not.toContain("<!channel>");
      expect(syntax).not.toContain("*on call*");
    }
  });
});
