import { afterEach, describe, expect, jest, test } from "@jest/globals";
import ProductBrandingText from "../../../../../Server/Utils/ProductBrandingText";
import OnCallPolicyRunMessageView, {
  ON_CALL_RUN_ALARM_NOBODY_PAGED_AT_A_RULE,
  ON_CALL_RUN_ALARM_OUTCOME,
  OnCallPolicyRun,
  OnCallPolicyRunAlarm,
  OnCallPolicyRunOutcome,
} from "../../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessageView";
import { getOnCallPassOnLevelLabel } from "../../../../../Types/OnCallDutyPolicy/OnCallPagePassOn";

/*
 * WHAT ONE ON-CALL POLICY RUN SAYS IN SLACK AND MICROSOFT TEAMS.
 *
 * A run is one message, edited as it goes: which policy is paging for which
 * record; where the escalation is, what happens next and when; one list of
 * everybody - who was paged (how often, how) and who was not and why; and a
 * link to every step. It raises a new message (an alarm) only where
 * somebody must act. These pin every part of that wording, for every way a
 * run can stand.
 */

const POLICY_URL: string =
  "https://oneuptime.test/dashboard/p/on-call-duty/policies/x";
const RUN_URL: string =
  "https://oneuptime.test/dashboard/p/on-call-duty/execution-logs/run-1";
const RECORD_URL: string = "https://oneuptime.test/dashboard/p/incidents/inc-8";

const POLICY: string = `**[PolicyX](${POLICY_URL})**`;
const RECORD: string = `**[Incident INC-8](${RECORD_URL})**`;

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

// Where a list starts: a blank line, then its first bullet.
const LIST_START: RegExp = /\n\n- /g;

// The paragraph that says where the run is and what comes next.
function progressOf(markdown: string): string {
  return markdown.split("\n\n")[1]!;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("OnCallPolicyRunMessageView.getMarkdown - a run that is paging", () => {
  test("is one message: headline, where it is and what is next, one list of everybody, and a link to every step", () => {
    expect(OnCallPolicyRunMessageView.getMarkdown(run())).toBe(
      [
        `📟 ${POLICY} is paging for ${RECORD}`,
        "**second (Level 2 of 3)**: if nobody acknowledges within 5 minutes, third (Level 3 of 3) is next.",
        [
          "- **Nitin**: paged 3 times · by call, SMS and email",
          "- **NB User 3**: paged twice · by email",
          "- **NB User 2**: not paged · not a member of this project",
          "- Nobody was on call in schedule **sec**",
          "- third (Level 3 of 3): nobody to page",
        ].join("\n"),
        `[See every step in OneUptime](${RUN_URL})`,
      ].join("\n\n"),
    );
  });

  test("REGRESSION: no label over each list - in Slack each label sat a blank line above its list, and the message ran to fifteen lines", () => {
    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(run());

    expect(markdown).not.toContain("**Paged**");
    expect(markdown).not.toContain("**Not paged**");
    // One list: the people paged first, then who was not.
    expect(markdown.match(LIST_START) || []).toHaveLength(1);
    expect(markdown.indexOf("**NB User 3**")).toBeLessThan(
      markdown.indexOf("**NB User 2**"),
    );
    // Four paragraphs at most: headline, progress, the list, the link.
    expect(markdown.split("\n\n")).toHaveLength(4);
  });

  test("the next step names a moment, in each reader's own time, when the run knows when the rule started", () => {
    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(
      run({ nextStepAt: new Date("2026-10-08T17:28:00.000Z") }),
    );

    expect(progressOf(markdown)).toBe(
      "**second (Level 2 of 3)**: if nobody acknowledges by {{TIME(2026-10-08T17:28:00Z)}}, third (Level 3 of 3) is next.",
    );
    expect(markdown).not.toContain("within");
  });

  test("REGRESSION: 'within 5 minutes' in a message edited for half an hour never said from when - it is only the fallback", () => {
    expect(progressOf(OnCallPolicyRunMessageView.getMarkdown(run()))).toContain(
      "within 5 minutes",
    );
    expect(
      progressOf(
        OnCallPolicyRunMessageView.getMarkdown(
          run({ nextStepAt: new Date("not a date") }),
        ),
      ),
    ).toContain("within 5 minutes");
  });

  test("on a repeat, the progress says which repeat of how many", () => {
    expect(
      progressOf(
        OnCallPolicyRunMessageView.getMarkdown(
          run({ repeatNumber: 1, currentRule: { order: 1, name: "fhirst" } }),
        ),
      ),
    ).toBe(
      "**fhirst (Level 1 of 3)**, repeat 1 of 2: if nobody acknowledges within 5 minutes, third (Level 3 of 3) is next.",
    );

    // A policy changed under the run, now allowing fewer repeats: no "3 of 2".
    expect(
      progressOf(
        OnCallPolicyRunMessageView.getMarkdown(
          run({ repeatNumber: 3, repeatsAllowed: 2 }),
        ),
      ),
    ).toContain("**second (Level 2 of 3)**, repeat 3: if nobody");
  });

  test("the first pass says nothing about repeats: the last rule says when the policy starts again", () => {
    for (const repeatsAllowed of [0, 1, 3]) {
      expect(
        progressOf(
          OnCallPolicyRunMessageView.getMarkdown(run({ repeatsAllowed })),
        ),
      ).not.toContain("repeat");
    }
  });

  test("what happens next: the next rule, the policy starting again, or paging stopping", () => {
    const next: (overrides: Partial<OnCallPolicyRun>) => string = (
      overrides: Partial<OnCallPolicyRun>,
    ): string => {
      return progressOf(
        OnCallPolicyRunMessageView.getMarkdown(
          run({ currentRule: { order: 3, name: "third" }, ...overrides }),
        ),
      );
    };

    expect(next({ nextRule: undefined, repeatNumber: 0 })).toBe(
      "**third (Level 3 of 3)**: if nobody acknowledges within 5 minutes, the policy starts again from Level 1.",
    );
    expect(next({ nextRule: undefined, repeatNumber: 2 })).toBe(
      "**third (Level 3 of 3)**, repeat 2 of 2: if nobody acknowledges within 5 minutes, paging stops.",
    );
    expect(next({ nextRule: undefined, repeatsAllowed: 0 })).toBe(
      "**third (Level 3 of 3)**: if nobody acknowledges within 5 minutes, paging stops.",
    );
  });

  test("the wait reads as a moment, a minute, one minute or N minutes", () => {
    const when: (overrides: Partial<OnCallPolicyRun>) => string = (
      overrides: Partial<OnCallPolicyRun>,
    ): string => {
      return progressOf(OnCallPolicyRunMessageView.getMarkdown(run(overrides)));
    };

    expect(
      when({
        escalateAfterInMinutes: 30,
        nextStepAt: new Date("2026-10-08T17:45:00.000Z"),
      }),
    ).toContain("if nobody acknowledges by {{TIME(2026-10-08T17:45:00Z)}},");
    // A rule that moves on at once has no moment worth naming.
    expect(
      when({
        escalateAfterInMinutes: 0,
        nextStepAt: new Date("2026-10-08T17:15:00.000Z"),
      }),
    ).toContain("if nobody acknowledges within a minute,");
    expect(when({ escalateAfterInMinutes: 1 })).toContain(
      "if nobody acknowledges within 1 minute,",
    );
    expect(when({ escalateAfterInMinutes: 30 })).toContain(
      "if nobody acknowledges within 30 minutes,",
    );
  });

  /*
   * A level with nobody to page is passed at once (OnCallEmptyLevel): the
   * run is never held on it, trying it again, so the message never says it
   * is - it says where the run is now, which is the level after.
   */
  test("a level is never said to be tried again: the run moved on from it, and its progress is the next level's", () => {
    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(
      run({
        currentRule: { order: 2, name: "second" },
        nextRule: { order: 3, name: "third" },
        escalateAfterInMinutes: 7,
        nextStepAt: new Date("2026-10-08T17:22:00.000Z"),
        notPaged: [
          {
            rule: { order: 1, name: "fhirst" },
            reason: "nobody to page",
            movedOnTo: { order: 2, name: "second" },
          },
        ],
      }),
    );

    expect(progressOf(markdown)).toBe(
      "**second (Level 2 of 3)**: if nobody acknowledges by {{TIME(2026-10-08T17:22:00Z)}}, third (Level 3 of 3) is next.",
    );
    expect(markdown).not.toContain("trying again");
    expect(markdown).not.toContain("on call yet");
  });

  test("before its first rule has started, the run says it is starting, and nothing is promised", () => {
    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(
      run({
        currentRule: undefined,
        nextRule: undefined,
        paged: [],
        notPaged: [],
        repeatsAllowed: 0,
      }),
    );

    expect(markdown).toBe(
      [
        `📟 ${POLICY} is paging for ${RECORD}`,
        "**Starting with Level 1 of 3**",
        `[See every step in OneUptime](${RUN_URL})`,
      ].join("\n\n"),
    );
  });

  test("a policy with no rules at all says it is starting", () => {
    expect(
      progressOf(
        OnCallPolicyRunMessageView.getMarkdown(
          run({
            ruleCount: 0,
            currentRule: undefined,
            nextRule: undefined,
            paged: [],
            notPaged: [],
          }),
        ),
      ),
    ).toBe("**Starting**");
  });

  test("a rule without a name is named by its place alone", () => {
    expect(
      progressOf(
        OnCallPolicyRunMessageView.getMarkdown(
          run({ currentRule: { order: 2 }, nextRule: { order: 3, name: " " } }),
        ),
      ),
    ).toBe(
      "**Level 2 of 3**: if nobody acknowledges within 5 minutes, Level 3 of 3 is next.",
    );
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
            methods: ["SMS", "email", "Microsoft Teams"],
            coveringFor: ["Carol", "Dave", "Ed"],
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

    // The headline has the ✅ of an acknowledgement; the list just says so.
    expect(markdown).toContain(
      "- **Alice**: acknowledged · paged once · by push",
    );
    expect(markdown).toContain(
      "- **Bob** (covering for Carol and Dave): paged once · being paged now",
    );
    expect(markdown).toContain(
      "- **Erin** (covering for Carol, Dave and Ed): being paged now · by SMS, email and Microsoft Teams",
    );
    expect(markdown).toContain("- **Frank**\n");
  });

  test("who was not paged: skipped and why, a page that failed, a schedule with nobody on call, a rule with nobody", () => {
    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(
      run({
        paged: [],
        notPaged: [
          {
            personName: "Jane Doe",
            reason: "has opted out of notifications for Sev4 incidents",
          },
          { personName: "Zed", reason: "not paged" },
          { personName: "Yan", reason: " " },
          {
            personName: "Nitin",
            reason:
              "could not be paged (Nitin has no verified notification method)",
            failed: true,
          },
          { scheduleName: "sec", reason: "nobody was on call" },
          { rule: { order: 3 }, reason: "nobody to page" },
          { reason: "nobody was on call" },
        ],
      }),
    );

    expect(markdown.split("\n\n")[2]).toBe(
      [
        "- **Jane Doe**: not paged · has opted out of notifications for Sev4 incidents",
        "- **Zed**: not paged",
        "- **Yan**: not paged",
        "- **Nitin**: could not be paged (Nitin has no verified notification method)",
        "- Nobody was on call in schedule **sec**",
        "- Level 3 of 3: nobody to page",
        "- Nobody was on call",
      ].join("\n"),
    );
  });

  test("the link to every step names the product as the installation does", () => {
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("Acme Status");

    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(run());

    expect(markdown).toContain(`[See every step in Acme Status](${RUN_URL})`);
    expect(markdown).not.toContain("OneUptime");
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
      `✅ **Nitin** acknowledged ${RECORD}, so ${POLICY} stopped paging`,
    );
    expect(markdown).not.toContain("Level 2 of 3");
    expect(markdown).not.toContain("if nobody acknowledges");
    expect(markdown.split("\n\n")[1]).toContain(
      "- **Nitin**: paged 3 times · by call, SMS and email",
    );
    expect(markdown).toContain(`[See every step in OneUptime](${RUN_URL})`);
  });

  test("REGRESSION: 'Incident INC-8: PolicyX' - two links joined by a colon read as one title", () => {
    expect(
      OnCallPolicyRunMessageView.getMarkdown(
        run({
          outcome: OnCallPolicyRunOutcome.Acknowledged,
          acknowledgedByName: "Nitin",
        }),
      ),
    ).not.toContain(`${RECORD}: ${POLICY}`);
  });

  test("acknowledged by somebody the run cannot name", () => {
    expect(
      OnCallPolicyRunMessageView.getMarkdown(
        run({ outcome: OnCallPolicyRunOutcome.Acknowledged }),
      ),
    ).toContain("✅ **Someone** acknowledged");
  });

  test("the record was handled some other way: the state it moved to, in the past tense - the message is not edited after", () => {
    expect(
      OnCallPolicyRunMessageView.getMarkdown(
        run({
          outcome: OnCallPolicyRunOutcome.RecordHandled,
          outcomeDetail: "Resolved",
        }),
      ).split("\n\n")[0],
    ).toBe(`✅ ${RECORD} moved to **Resolved**, so ${POLICY} stopped paging`);

    expect(
      OnCallPolicyRunMessageView.getMarkdown(
        run({ outcome: OnCallPolicyRunOutcome.RecordHandled }),
      ).split("\n\n")[0],
    ).toBe(`✅ ${RECORD} is being handled, so ${POLICY} stopped paging`);
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
      `⏹️ ${POLICY} stopped paging for ${RECORD}: the policy was archived`,
    );
    expect(
      headline({ outcome: OnCallPolicyRunOutcome.NobodyAcknowledged }),
    ).toBe(
      `⚠️ ${POLICY} went through every escalation rule for ${RECORD} and nobody acknowledged`,
    );
    expect(headline({ outcome: OnCallPolicyRunOutcome.NobodyReached })).toBe(
      `⚠️ ${POLICY} could not reach anyone for ${RECORD}`,
    );
    expect(
      headline({
        outcome: OnCallPolicyRunOutcome.Failed,
        outcomeDetail: "No Escalation Rules in Policy.",
        paged: [],
      }),
    ).toBe(
      `❌ ${POLICY} could not page anyone for ${RECORD}: No Escalation Rules in Policy.`,
    );
    expect(
      headline({ outcome: OnCallPolicyRunOutcome.Failed, paged: [] }),
    ).toBe(`❌ ${POLICY} could not page anyone for ${RECORD}`);
  });

  test("REGRESSION: a run that went wrong after paging people says it stopped - not that it could not page anyone", () => {
    const failed: OnCallPolicyRun = run({
      outcome: OnCallPolicyRunOutcome.Failed,
      outcomeDetail: "Policy Execution timed out.",
    });

    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(failed);

    expect(markdown.split("\n\n")[0]).toBe(
      `❌ ${POLICY} stopped paging for ${RECORD}: Policy Execution timed out.`,
    );
    expect(markdown).not.toContain("could not page anyone");
    // Who it paged before it stopped is still listed.
    expect(markdown).toContain("- **Nitin**: paged 3 times");

    expect(OnCallPolicyRunMessageView.getPlainText(failed)).toBe(
      "PolicyX stopped paging for Incident INC-8",
    );
  });
});

describe("OnCallPolicyRunMessageView.getAlarms - loud only where somebody has to act", () => {
  test("a run that is paging normally raises nothing", () => {
    expect(OnCallPolicyRunMessageView.getAlarms(run())).toEqual([]);
  });

  test("the first rule that reached nobody raises one alarm: the policy and the rule first, why, and what to do", () => {
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
        markdown: `⚠️ ${POLICY} paged nobody at third (Level 3 of 3) for ${RECORD} (nobody was on call in schedule sec; NB User 2: not a member of this project). If nobody is on it yet, page someone or fix the policy.`,
        text: "PolicyX paged nobody at third (Level 3 of 3) for Incident INC-8",
      },
    ]);
  });

  test("REGRESSION: it never opens with 'Nobody was paged for Incident INC-8' - earlier rules may have paged people", () => {
    const alarm: OnCallPolicyRunAlarm = OnCallPolicyRunMessageView.getAlarms(
      run({
        firstRuleThatReachedNobody: {
          rule: { order: 3, name: "third" },
          reasons: [],
        },
      }),
    )[0]!;

    expect(alarm.markdown.startsWith("⚠️ Nobody was paged")).toBe(false);
    expect(alarm.text.startsWith("Nobody")).toBe(false);
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
        markdown: `⚠️ Nobody has acknowledged ${RECORD}. ${POLICY} paged Nitin and NB User 3, went through every escalation rule (repeated twice) and has stopped paging. Someone needs to take it.`,
        text: "Nobody has acknowledged Incident INC-8: someone needs to take it",
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
      "paged Nitin, went through every escalation rule (repeated once) and has stopped paging.",
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
      "paged Nitin, NB User 3 and Zed, went through every escalation rule and has stopped paging. Someone",
    );
  });

  test("a big rule's alarm names five people, and counts the rest", () => {
    const named: (count: number) => string = (count: number): string => {
      return OnCallPolicyRunMessageView.getAlarms(
        run({
          outcome: OnCallPolicyRunOutcome.NobodyAcknowledged,
          paged: Array.from({ length: count }, (_: unknown, index: number) => {
            return { ...run().paged[0]!, name: `P${index + 1}` };
          }),
        }),
      )[0]!.markdown;
    };

    expect(named(5)).toContain("paged P1, P2, P3, P4 and P5, went through");
    expect(named(6)).toContain(
      "paged P1, P2, P3, P4, P5 and 1 other, went through",
    );
    expect(named(8)).toContain(
      "paged P1, P2, P3, P4, P5 and 3 others, went through",
    );
  });

  test("nobody reached, a failed run and an archived policy each raise their own alarm, each with what to do", () => {
    expect(
      OnCallPolicyRunMessageView.getAlarms(
        run({ outcome: OnCallPolicyRunOutcome.NobodyReached }),
      ),
    ).toEqual([
      {
        key: ON_CALL_RUN_ALARM_OUTCOME,
        markdown: `⚠️ Nobody was paged for ${RECORD}: no escalation rule of ${POLICY} reached anyone. Check who is on call, or page someone yourself.`,
        text: "Nobody was paged for Incident INC-8",
      },
    ]);

    expect(
      OnCallPolicyRunMessageView.getAlarms(
        run({
          outcome: OnCallPolicyRunOutcome.Failed,
          outcomeDetail: "No Escalation Rules in Policy.",
          paged: [],
        }),
      ),
    ).toEqual([
      {
        key: ON_CALL_RUN_ALARM_OUTCOME,
        markdown: `❌ ${POLICY} could not page anyone for ${RECORD}: No Escalation Rules in Policy. Page someone yourself.`,
        text: "PolicyX could not page anyone for Incident INC-8",
      },
    ]);

    expect(
      OnCallPolicyRunMessageView.getAlarms(
        run({
          outcome: OnCallPolicyRunOutcome.Failed,
          outcomeDetail: "Error occurred while executing the on-call policy",
          paged: [],
        }),
      )[0]!.markdown,
    ).toBe(
      `❌ ${POLICY} could not page anyone for ${RECORD}: Error occurred while executing the on-call policy. Page someone yourself.`,
    );

    expect(
      OnCallPolicyRunMessageView.getAlarms(
        run({ outcome: OnCallPolicyRunOutcome.Failed, paged: [] }),
      )[0]!.markdown,
    ).toBe(
      `❌ ${POLICY} could not page anyone for ${RECORD}. Page someone yourself.`,
    );

    // Gone wrong after some rules paged people: it stopped before anyone acknowledged.
    expect(
      OnCallPolicyRunMessageView.getAlarms(
        run({
          outcome: OnCallPolicyRunOutcome.Failed,
          outcomeDetail: "Policy Execution timed out.",
        }),
      ),
    ).toEqual([
      {
        key: ON_CALL_RUN_ALARM_OUTCOME,
        markdown: `❌ ${POLICY} stopped paging for ${RECORD} before anyone acknowledged: Policy Execution timed out. Page someone yourself.`,
        text: "PolicyX stopped paging for Incident INC-8 before anyone acknowledged",
      },
    ]);

    expect(
      OnCallPolicyRunMessageView.getAlarms(
        run({ outcome: OnCallPolicyRunOutcome.PolicyArchived }),
      ),
    ).toEqual([
      {
        key: ON_CALL_RUN_ALARM_OUTCOME,
        markdown: `⏹️ ${POLICY} stopped paging for ${RECORD} because the policy was archived. Nobody else will be paged: someone needs to take it.`,
        text: "PolicyX stopped paging for Incident INC-8: the policy was archived",
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

  test("REGRESSION: a rule that reached nobody is not said once somebody is on the record", () => {
    const reachedNobody: Partial<OnCallPolicyRun> = {
      firstRuleThatReachedNobody: {
        rule: { order: 1, name: "fhirst" },
        reasons: ["Nitin: has opted out of notifications for Sev4 incidents"],
      },
    };

    expect(
      OnCallPolicyRunMessageView.getAlarms(
        run({
          ...reachedNobody,
          outcome: OnCallPolicyRunOutcome.Acknowledged,
          acknowledgedByName: "Carol",
        }),
      ),
    ).toEqual([]);
    expect(
      OnCallPolicyRunMessageView.getAlarms(
        run({
          ...reachedNobody,
          outcome: OnCallPolicyRunOutcome.RecordHandled,
          outcomeDetail: "Acknowledged",
        }),
      ),
    ).toEqual([]);

    // While nobody is on it, it is said - also at an ending that leaves nobody on it.
    expect(
      alarmKeys(
        OnCallPolicyRunMessageView.getAlarms(
          run({
            ...reachedNobody,
            outcome: OnCallPolicyRunOutcome.NobodyAcknowledged,
          }),
        ),
      ),
    ).toEqual([
      ON_CALL_RUN_ALARM_NOBODY_PAGED_AT_A_RULE,
      ON_CALL_RUN_ALARM_OUTCOME,
    ]);
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

  test("a rule that reached nobody without a reason says so without empty brackets", () => {
    expect(
      OnCallPolicyRunMessageView.getAlarms(
        run({
          firstRuleThatReachedNobody: {
            rule: { order: 1 },
            reasons: [],
          },
        }),
      )[0]!.markdown,
    ).toBe(
      `⚠️ ${POLICY} paged nobody at Level 1 of 3 for ${RECORD}. If nobody is on it yet, page someone or fix the policy.`,
    );
  });
});

/*
 * A LEVEL PASSED AT ONCE (OnCallEmptyLevel): nobody was there to page, so
 * the run paged the next level that same moment. Nobody waited, so there is
 * nobody to page by hand: the alarm asks for the policy to be fixed, and
 * says where the run went - as the level's line in the list does.
 */
describe("OnCallPolicyRunMessageView - a level passed at once because it had nobody to page", () => {
  test("its alarm says why, that the run moved on to the next level at once, and that the policy needs fixing", () => {
    expect(
      OnCallPolicyRunMessageView.getAlarms(
        run({
          firstRuleThatReachedNobody: {
            rule: { order: 1, name: "fhirst" },
            reasons: ["the rule has nobody to page"],
            movedOnTo: { order: 2, name: "second" },
          },
        }),
      ),
    ).toEqual([
      {
        key: ON_CALL_RUN_ALARM_NOBODY_PAGED_AT_A_RULE,
        markdown: `⚠️ ${POLICY} paged nobody at fhirst (Level 1 of 3) for ${RECORD} (the rule has nobody to page), so second (Level 2 of 3) was paged at once. Fix the policy so this level pages someone.`,
        text: "PolicyX paged nobody at fhirst (Level 1 of 3) for Incident INC-8, so second (Level 2 of 3) was paged at once",
      },
    ]);
  });

  test("levels with no name of their own are named by their place, as everywhere", () => {
    const alarm: OnCallPolicyRunAlarm = OnCallPolicyRunMessageView.getAlarms(
      run({
        firstRuleThatReachedNobody: {
          rule: { order: 1 },
          reasons: [],
          movedOnTo: { order: 2 },
        },
      }),
    )[0]!;

    expect(alarm.markdown).toBe(
      `⚠️ ${POLICY} paged nobody at Level 1 of 3 for ${RECORD}, so Level 2 of 3 was paged at once. Fix the policy so this level pages someone.`,
    );
    expect(alarm.markdown).not.toContain("page someone or");
  });

  test("its line in the list says the next level was paged at once; the last level's says nothing more", () => {
    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(
      run({
        notPaged: [
          {
            rule: { order: 1, name: "fhirst" },
            reason: "nobody to page",
            movedOnTo: { order: 2, name: "second" },
          },
          {
            rule: { order: 2 },
            reason: "nobody to page",
            movedOnTo: { order: 3 },
          },
          { rule: { order: 3 }, reason: "nobody to page" },
        ],
      }),
    );

    expect(markdown).toContain(
      "- fhirst (Level 1 of 3): nobody to page, so second (Level 2 of 3) was paged at once\n- Level 2 of 3: nobody to page, so Level 3 of 3 was paged at once\n- Level 3 of 3: nobody to page",
    );
  });

  test("a level's name is text in the line and in the alarm: Markdown in it formats nothing, and links nowhere", () => {
    const name: string = "*Night* [open](https://evil.example/x)";
    const shown: OnCallPolicyRun = run({
      notPaged: [
        {
          rule: { order: 1, name: "fhirst" },
          reason: "nobody to page",
          movedOnTo: { order: 2, name: name },
        },
      ],
      firstRuleThatReachedNobody: {
        rule: { order: 1, name: "fhirst" },
        reasons: [],
        movedOnTo: { order: 2, name: name },
      },
    });

    for (const markdown of [
      OnCallPolicyRunMessageView.getMarkdown(shown),
      OnCallPolicyRunMessageView.getAlarms(shown)[0]!.markdown,
    ]) {
      expect(markdown).toContain("\\*Night\\*");
      expect(syntaxOf(markdown)).not.toContain("](https://evil.example/x)");
    }
  });

  test("a run that went through every level and reached nobody: the level's alarm and the ending's, once each", () => {
    const alarms: Array<OnCallPolicyRunAlarm> =
      OnCallPolicyRunMessageView.getAlarms(
        run({
          outcome: OnCallPolicyRunOutcome.NobodyReached,
          paged: [],
          firstRuleThatReachedNobody: {
            rule: { order: 1, name: "fhirst" },
            reasons: ["the rule has nobody to page"],
            movedOnTo: { order: 2, name: "second" },
          },
        }),
      );

    expect(alarmKeys(alarms)).toEqual([
      ON_CALL_RUN_ALARM_NOBODY_PAGED_AT_A_RULE,
      ON_CALL_RUN_ALARM_OUTCOME,
    ]);
    expect(alarms[1]!.markdown).toBe(
      `⚠️ Nobody was paged for ${RECORD}: no escalation rule of ${POLICY} reached anyone. Check who is on call, or page someone yourself.`,
    );
  });

  test("once somebody acknowledged, a level passed at once raises nothing", () => {
    expect(
      OnCallPolicyRunMessageView.getAlarms(
        run({
          outcome: OnCallPolicyRunOutcome.Acknowledged,
          acknowledgedByName: "Nitin",
          firstRuleThatReachedNobody: {
            rule: { order: 1, name: "fhirst" },
            reasons: [],
            movedOnTo: { order: 2, name: "second" },
          },
        }),
      ),
    ).toEqual([]);
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
        run({
          outcome: OnCallPolicyRunOutcome.RecordHandled,
          outcomeDetail: "Resolved",
        }),
      ),
    ).toBe("Incident INC-8 moved to Resolved, so PolicyX stopped paging");
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
        run({ outcome: OnCallPolicyRunOutcome.Failed, paged: [] }),
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
        coveringFor: ["_Eve_", "[x](evil-target)"],
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

  test("the alarms escape names the same way; their notification line is the names as typed", () => {
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

    /*
     * Plain text, as typed: each workspace escapes it for its own
     * notification (SlackUtil.getNotificationText).
     */
    expect(alarms[0]!.text).toBe(
      "Ops *on call* [click](evil-target) paged nobody at [x](evil-target) (Level 1 of 3) for Incident <!channel>",
    );
  });
});

/*
 * A LEVEL IS NAMED AS THE ESCALATE DIALOG NAMES IT.
 *
 * The dialog says "This will immediately page Platform leads (Level 2 of
 * 3)"; the run's Slack and Teams message said "escalation rule 2 of 3
 * (Platform leads)" for the same level (#5167). Both name it by one
 * function now (getOnCallPassOnLevelLabel): its name, then its place - or
 * its place alone when it has no name, or only the one its place gives it.
 */
describe("OnCallPolicyRunMessageView - levels, in the Escalate dialog's words", () => {
  test.each([
    [{ order: 2, name: "Platform leads" }, "Platform leads (Level 2 of 3)"],
    [{ order: 2, name: "  Platform leads  " }, "Platform leads (Level 2 of 3)"],
    [{ order: 2, name: "Level 2" }, "Level 2 of 3"],
    [{ order: 2, name: "" }, "Level 2 of 3"],
    [{ order: 2 }, "Level 2 of 3"],
    // A name somebody typed is kept as typed: never capitalized.
    [{ order: 2, name: "second shift" }, "second shift (Level 2 of 3)"],
  ])(
    "the level the run is on, %p, reads %p - the dialog's own label",
    (rule: { order: number; name?: string }, label: string) => {
      const markdown: string = OnCallPolicyRunMessageView.getMarkdown(
        run({ currentRule: rule, nextRule: undefined, repeatsAllowed: 0 }),
      );

      expect(getOnCallPassOnLevelLabel(rule, 3)).toBe(label);
      expect(progressOf(markdown)).toBe(
        `**${label}**: if nobody acknowledges within 5 minutes, paging stops.`,
      );
    },
  );

  test("the next level, a level that reached nobody and its alarm are named the same way", () => {
    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(
      run({
        currentRule: { order: 1, name: "Primary" },
        nextRule: { order: 2, name: "Platform leads" },
        notPaged: [{ rule: { order: 3 }, reason: "nobody to page" }],
      }),
    );

    expect(progressOf(markdown)).toBe(
      "**Primary (Level 1 of 3)**: if nobody acknowledges within 5 minutes, Platform leads (Level 2 of 3) is next.",
    );
    expect(markdown).toContain("- Level 3 of 3: nobody to page");

    const alarms: Array<OnCallPolicyRunAlarm> =
      OnCallPolicyRunMessageView.getAlarms(
        run({
          firstRuleThatReachedNobody: {
            rule: { order: 2, name: "Platform leads" },
            reasons: [],
          },
        }),
      );

    expect(alarms[0]!.text).toBe(
      "PolicyX paged nobody at Platform leads (Level 2 of 3) for Incident INC-8",
    );
  });

  test("the policy starting again starts from Level 1, and a run not under way yet starts with it", () => {
    expect(
      progressOf(
        OnCallPolicyRunMessageView.getMarkdown(
          run({ currentRule: { order: 3 }, nextRule: undefined }),
        ),
      ),
    ).toBe(
      "**Level 3 of 3**: if nobody acknowledges within 5 minutes, the policy starts again from Level 1.",
    );
    expect(
      progressOf(
        OnCallPolicyRunMessageView.getMarkdown(
          run({
            currentRule: undefined,
            nextRule: undefined,
            paged: [],
            notPaged: [],
          }),
        ),
      ),
    ).toBe("**Starting with Level 1 of 3**");
  });

  test("never the old words", () => {
    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(run());

    expect(markdown.toLowerCase()).not.toContain("escalation rule 2");
    expect(markdown.toLowerCase()).not.toContain("escalation rule 3");
  });
});
