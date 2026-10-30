import { afterEach, describe, expect, jest, test } from "@jest/globals";
import ProductBrandingText from "../../../../../Server/Utils/ProductBrandingText";
import WorkspaceMessageTime from "../../../../../Server/Utils/Workspace/WorkspaceMessageTime";
import OnCallPolicyRunMessageView, {
  ON_CALL_RUN_ALARM_OUTCOME,
  OnCallDirectPageRun,
  OnCallPolicyRun,
  OnCallPolicyRunAlarm,
  OnCallPolicyRunOutcome,
} from "../../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessageView";

/*
 * WHAT A DIRECT PAGE SAYS IN SLACK AND MICROSOFT TEAMS.
 *
 * A direct page - people, a team or a schedule paged with no on-call policy
 * behind the page - is a run, and gets a run's one message: who is paging
 * for which record, one list of everybody (who was paged, how often and how;
 * who was not and why), and a link to every step. Where a policy's run names
 * the policy it names whoever started the page, and as it pages everybody at
 * once it never says which escalation rule it is on. These pin that wording
 * for every way a direct page can stand, the alarms it raises and the line
 * each notification shows.
 */

const WORKFLOW_URL: string =
  "https://oneuptime.test/dashboard/p/workflows/wf-1/builder";
const RUN_URL: string =
  "https://oneuptime.test/dashboard/p/on-call-duty/execution-logs/run-1";
const RECORD_URL: string = "https://oneuptime.test/dashboard/p/incidents/inc-8";

const RECORD: string = `**[Incident INC-8](${RECORD_URL})**`;
const WORKFLOW_LINK: string = `**[Page the on-call engineer](${WORKFLOW_URL})**`;

// What a reader of "nobody could be reached" does next.
const WHAT_TO_DO: string = "Check who is on call, or page someone yourself.";
const WHAT_TO_DO_AT_THE_END: RegExp =
  /\. Check who is on call, or page someone yourself\.$/;

const BY_WORKFLOW: OnCallDirectPageRun = {
  startedByWorkflowName: "Page the on-call engineer",
  startedByWorkflowUrl: WORKFLOW_URL,
};

function page(overrides: Partial<OnCallPolicyRun> = {}): OnCallPolicyRun {
  return {
    policyName: "",
    policyUrl: "",
    directPage: BY_WORKFLOW,
    runUrl: RUN_URL,
    recordLabel: "Incident INC-8",
    recordUrl: RECORD_URL,
    outcome: OnCallPolicyRunOutcome.Paging,
    ruleCount: 0,
    escalateAfterInMinutes: 0,
    repeatNumber: 0,
    repeatsAllowed: 0,
    paged: [
      {
        name: "Nitin",
        timesPaged: 1,
        isBeingPaged: false,
        acknowledged: false,
        methods: ["SMS", "email"],
        coveringFor: [],
      },
      {
        name: "Jane Doe",
        timesPaged: 0,
        isBeingPaged: true,
        acknowledged: false,
        methods: [],
        coveringFor: ["Alex Kim"],
      },
    ],
    notPaged: [
      { personName: "NB User 2", reason: "not a member of this project" },
      { scheduleName: "Secondary", reason: "nobody was on call" },
      { teamName: "Platform", reason: "has no members" },
    ],
    ...overrides,
  };
}

function alarmKeys(alarms: Array<OnCallPolicyRunAlarm>): Array<string> {
  return alarms.map((alarm: OnCallPolicyRunAlarm): string => {
    return alarm.key;
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a direct page that is paging", () => {
  test("is one message: who is paging for what, one list of everybody, and a link to every step", () => {
    expect(OnCallPolicyRunMessageView.getMarkdown(page())).toBe(
      [
        `📟 Workflow ${WORKFLOW_LINK} is paging for ${RECORD}`,
        [
          "- **Nitin**: paged once · by SMS and email",
          "- **Jane Doe** (covering for Alex Kim): being paged now",
          "- **NB User 2**: not paged · not a member of this project",
          "- Nobody was on call in schedule **Secondary**",
          "- Team **Platform** has no members",
        ].join("\n"),
        `[See every step in OneUptime](${RUN_URL})`,
      ].join("\n\n"),
    );
  });

  test("never says which escalation rule it is on: it has none", () => {
    for (const overrides of [
      {},
      // Whatever a run's bookkeeping carries, a direct page has no rule to name.
      { ruleCount: 3, currentRule: { order: 1, name: "first" } },
      { nextStepAt: new Date("2026-10-08T17:28:00.000Z") },
      { repeatNumber: 1, repeatsAllowed: 2 },
    ]) {
      const markdown: string = OnCallPolicyRunMessageView.getMarkdown(
        page(overrides),
      );

      expect(markdown).not.toContain("scalation rule");
      expect(markdown).not.toContain("Starting");
      expect(markdown).not.toContain("if nobody acknowledges");
      expect(markdown).not.toContain("repeat");
      // Three paragraphs: the headline, the list, the link.
      expect(markdown.split("\n\n")).toHaveLength(3);
    }
  });

  test("with nobody listed yet it is the headline and the link", () => {
    expect(
      OnCallPolicyRunMessageView.getMarkdown(page({ paged: [], notPaged: [] })),
    ).toBe(
      [
        `📟 Workflow ${WORKFLOW_LINK} is paging for ${RECORD}`,
        `[See every step in OneUptime](${RUN_URL})`,
      ].join("\n\n"),
    );
  });

  test("its notification says who is paging for what, in plain text", () => {
    expect(OnCallPolicyRunMessageView.getPlainText(page())).toBe(
      "Workflow Page the on-call engineer is paging for Incident INC-8",
    );
  });

  test("it raises no alarm while people are being paged", () => {
    expect(OnCallPolicyRunMessageView.getAlarms(page())).toEqual([]);
  });
});

describe("who a direct page's message names", () => {
  test("the workflow, as a link to it when the run recorded which one", () => {
    expect(
      OnCallPolicyRunMessageView.getMarkdown(page()).split("\n\n")[0],
    ).toBe(`📟 Workflow ${WORKFLOW_LINK} is paging for ${RECORD}`);
  });

  test("the workflow by name alone when the run did not", () => {
    expect(
      OnCallPolicyRunMessageView.getMarkdown(
        page({ directPage: { startedByWorkflowName: "  Page SRE " } }),
      ).split("\n\n")[0],
    ).toBe(`📟 Workflow **Page SRE** is paging for ${RECORD}`);
  });

  test("the person who started it", () => {
    const run: OnCallPolicyRun = page({
      directPage: { startedByPersonName: "Sam Lee" },
    });

    expect(OnCallPolicyRunMessageView.getMarkdown(run).split("\n\n")[0]).toBe(
      `📟 **Sam Lee** is paging for ${RECORD}`,
    );
    expect(OnCallPolicyRunMessageView.getPlainText(run)).toBe(
      "Sam Lee is paging for Incident INC-8",
    );
  });

  test("the workflow rather than the person, when both are known", () => {
    expect(
      OnCallPolicyRunMessageView.getPlainText(
        page({
          directPage: {
            startedByWorkflowName: "Page SRE",
            startedByPersonName: "Sam Lee",
          },
        }),
      ),
    ).toBe("Workflow Page SRE is paging for Incident INC-8");
  });

  test.each<[string, OnCallDirectPageRun]>([
    ["nobody is known", {}],
    [
      "the names are only spaces",
      { startedByWorkflowName: " ", startedByPersonName: "  " },
    ],
  ])(
    "the product itself when %s - never an empty name",
    (_when: string, directPage: OnCallDirectPageRun) => {
      const run: OnCallPolicyRun = page({ directPage: directPage });
      const headline: string =
        OnCallPolicyRunMessageView.getMarkdown(run).split("\n\n")[0]!;

      expect(headline).toBe(
        `📟 ${ProductBrandingText.getProductName()} is paging for ${RECORD}`,
      );
      expect(headline).not.toContain("****");
      expect(headline).not.toContain("[](");
      expect(OnCallPolicyRunMessageView.getPlainText(run)).toBe(
        `${ProductBrandingText.getProductName()} is paging for Incident INC-8`,
      );
    },
  );

  test("the installation's own name when the product goes by one", () => {
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("Acme Status");

    const run: OnCallPolicyRun = page({ directPage: {} });

    expect(OnCallPolicyRunMessageView.getMarkdown(run)).toContain(
      `📟 Acme Status is paging for ${RECORD}`,
    );
    expect(OnCallPolicyRunMessageView.getMarkdown(run)).toContain(
      `[See every step in Acme Status](${RUN_URL})`,
    );
    expect(OnCallPolicyRunMessageView.getPlainText(run)).toBe(
      "Acme Status is paging for Incident INC-8",
    );
  });

  test("never the policy: a direct page has none, whatever the run carries", () => {
    const run: OnCallPolicyRun = page({
      policyName: "PolicyX",
      policyUrl: "https://oneuptime.test/dashboard/p/on-call-duty/policies/x",
    });

    for (const outcome of Object.values(OnCallPolicyRunOutcome)) {
      const told: OnCallPolicyRun = { ...run, outcome: outcome };
      const everything: string = [
        OnCallPolicyRunMessageView.getMarkdown(told),
        OnCallPolicyRunMessageView.getPlainText(told),
        ...OnCallPolicyRunMessageView.getAlarms(told).flatMap(
          (alarm: OnCallPolicyRunAlarm): Array<string> => {
            return [alarm.markdown, alarm.text];
          },
        ),
      ].join("\n");

      expect(everything).not.toContain("PolicyX");
      expect(everything).not.toContain("on-call-duty/policies");
    }
  });
});

describe("a workflow's name is text", () => {
  test("it cannot become a link, a mention or formatting of its own", () => {
    const run: OnCallPolicyRun = page({
      directPage: {
        startedByWorkflowName: "[click](https://evil.example) <!channel> **x**",
        startedByWorkflowUrl: WORKFLOW_URL,
      },
    });

    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(run);

    expect(markdown).not.toContain("[click](https://evil.example)");
    expect(markdown).not.toContain("<!channel>");
    // The one link in the headline's name is the workflow's own.
    expect(markdown).toContain(`](${WORKFLOW_URL})**`);
  });

  test("nor can a person's or a team's", () => {
    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(
      page({
        directPage: { startedByPersonName: "[Sam](https://evil.example)" },
        notPaged: [
          { teamName: "[Platform](https://evil.example)", reason: "x" },
        ],
      }),
    );

    expect(markdown).not.toContain("[Sam](https://evil.example)");
    expect(markdown).not.toContain("[Platform](https://evil.example)");
  });
});

describe("a direct page that somebody answered", () => {
  test("acknowledged by a person: who, and that the workflow stopped paging", () => {
    const run: OnCallPolicyRun = page({
      outcome: OnCallPolicyRunOutcome.Acknowledged,
      acknowledgedByName: "Nitin",
    });

    expect(OnCallPolicyRunMessageView.getMarkdown(run).split("\n\n")[0]).toBe(
      `✅ **Nitin** acknowledged ${RECORD}, so workflow ${WORKFLOW_LINK} stopped paging`,
    );
    expect(OnCallPolicyRunMessageView.getPlainText(run)).toBe(
      "Nitin acknowledged Incident INC-8",
    );
    expect(OnCallPolicyRunMessageView.getAlarms(run)).toEqual([]);
  });

  test("the record handled some other way: its state, and that the workflow stopped paging", () => {
    const run: OnCallPolicyRun = page({
      outcome: OnCallPolicyRunOutcome.RecordHandled,
      outcomeDetail: "Resolved",
    });

    expect(OnCallPolicyRunMessageView.getMarkdown(run).split("\n\n")[0]).toBe(
      `✅ ${RECORD} moved to **Resolved**, so workflow ${WORKFLOW_LINK} stopped paging`,
    );
    expect(OnCallPolicyRunMessageView.getPlainText(run)).toBe(
      "Incident INC-8 moved to Resolved, so workflow Page the on-call engineer stopped paging",
    );
    expect(OnCallPolicyRunMessageView.getAlarms(run)).toEqual([]);
  });

  test("handled, with no state to name", () => {
    const run: OnCallPolicyRun = page({
      outcome: OnCallPolicyRunOutcome.RecordHandled,
    });

    expect(OnCallPolicyRunMessageView.getMarkdown(run).split("\n\n")[0]).toBe(
      `✅ ${RECORD} is being handled, so workflow ${WORKFLOW_LINK} stopped paging`,
    );
    expect(OnCallPolicyRunMessageView.getPlainText(run)).toBe(
      "Workflow Page the on-call engineer stopped paging for Incident INC-8",
    );
  });

  test("a person's page: the paging stopped - the person did not stop it", () => {
    expect(
      OnCallPolicyRunMessageView.getMarkdown(
        page({
          directPage: { startedByPersonName: "Sam Lee" },
          outcome: OnCallPolicyRunOutcome.Acknowledged,
          acknowledgedByName: "Nitin",
        }),
      ).split("\n\n")[0],
    ).toBe(`✅ **Nitin** acknowledged ${RECORD}, so paging stopped`);
  });

  test("the people stay listed once it is over, with who acknowledged", () => {
    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(
      page({
        outcome: OnCallPolicyRunOutcome.Acknowledged,
        acknowledgedByName: "Nitin",
        paged: [
          {
            name: "Nitin",
            timesPaged: 1,
            isBeingPaged: false,
            acknowledged: true,
            methods: ["SMS"],
            coveringFor: [],
          },
        ],
        notPaged: [],
      }),
    );

    expect(markdown).toContain(
      "- **Nitin**: acknowledged · paged once · by SMS",
    );
  });
});

describe("a direct page nobody answered", () => {
  const NOBODY_ACKNOWLEDGED: Partial<OnCallPolicyRun> = {
    outcome: OnCallPolicyRunOutcome.NobodyAcknowledged,
    paged: [
      {
        name: "Nitin",
        timesPaged: 1,
        isBeingPaged: false,
        acknowledged: false,
        methods: ["SMS"],
        coveringFor: [],
      },
      {
        name: "Jane Doe",
        timesPaged: 1,
        isBeingPaged: false,
        acknowledged: false,
        methods: ["email"],
        coveringFor: [],
      },
    ],
    notPaged: [],
  };

  test("its message says it paged and nobody acknowledged - with no escalation rules to have gone through", () => {
    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(
      page(NOBODY_ACKNOWLEDGED),
    );

    expect(markdown.split("\n\n")[0]).toBe(
      `⚠️ Workflow ${WORKFLOW_LINK} paged for ${RECORD} and nobody acknowledged`,
    );
    expect(markdown).not.toContain("escalation rule");
  });

  test("it raises one alarm: who was paged, and that someone needs to take it", () => {
    const alarms: Array<OnCallPolicyRunAlarm> =
      OnCallPolicyRunMessageView.getAlarms(page(NOBODY_ACKNOWLEDGED));

    expect(alarms).toEqual([
      {
        key: ON_CALL_RUN_ALARM_OUTCOME,
        markdown: `⚠️ Nobody has acknowledged ${RECORD}. Workflow ${WORKFLOW_LINK} paged Nitin and Jane Doe, and has stopped paging. Someone needs to take it.`,
        text: "Nobody has acknowledged Incident INC-8: someone needs to take it",
      },
    ]);
  });

  test("the alarm never speaks of escalation rules or repeats", () => {
    const alarms: Array<OnCallPolicyRunAlarm> =
      OnCallPolicyRunMessageView.getAlarms(
        page({ ...NOBODY_ACKNOWLEDGED, repeatNumber: 2, repeatsAllowed: 2 }),
      );

    expect(alarms[0]!.markdown).not.toContain("escalation rule");
    expect(alarms[0]!.markdown).not.toContain("repeated");
  });

  test("more than five people paged are named up to five, and counted after", () => {
    const names: Array<string> = ["A", "B", "C", "D", "E", "F", "G"];
    const alarms: Array<OnCallPolicyRunAlarm> =
      OnCallPolicyRunMessageView.getAlarms(
        page({
          ...NOBODY_ACKNOWLEDGED,
          paged: names.map((name: string) => {
            return {
              name: name,
              timesPaged: 1,
              isBeingPaged: false,
              acknowledged: false,
              methods: [],
              coveringFor: [],
            };
          }),
        }),
      );

    expect(alarms[0]!.markdown).toContain("paged A, B, C, D, E and 2 others,");
  });

  test("its notification is the plain sentence", () => {
    expect(
      OnCallPolicyRunMessageView.getPlainText(page(NOBODY_ACKNOWLEDGED)),
    ).toBe("Nobody acknowledged Incident INC-8");
  });
});

describe("a direct page that reached nobody", () => {
  const AWAY_UNTIL: Date = new Date("2026-10-17T09:00:00.000Z");
  // The moment as each reader sees it in their own time.
  const AWAY_UNTIL_SHOWN: string =
    WorkspaceMessageTime.dateAndTime(AWAY_UNTIL).toString();

  const NOBODY_REACHED: Partial<OnCallPolicyRun> = {
    outcome: OnCallPolicyRunOutcome.NobodyReached,
    paged: [],
    notPaged: [
      {
        personName: "Alex Kim",
        reason: "away",
        awayUntil: AWAY_UNTIL,
      },
      { personName: "NB User 2", reason: "not a member of this project" },
      { scheduleName: "Secondary", reason: "nobody was on call" },
      { teamName: "Platform", reason: "has no members" },
    ],
  };

  test("a moment is shown in each reader's own time, never as UTC text", () => {
    expect(AWAY_UNTIL_SHOWN).toContain("2026-10-17T09:00:00Z");
    expect(AWAY_UNTIL_SHOWN).not.toContain("UTC");
  });

  test("its message says so, lists why for each target, and says what to do next", () => {
    expect(OnCallPolicyRunMessageView.getMarkdown(page(NOBODY_REACHED))).toBe(
      [
        `⚠️ Workflow ${WORKFLOW_LINK} could not reach anyone for ${RECORD}`,
        [
          `- **Alex Kim**: not paged · away until ${AWAY_UNTIL_SHOWN}`,
          "- **NB User 2**: not paged · not a member of this project",
          "- Nobody was on call in schedule **Secondary**",
          "- Team **Platform** has no members",
        ].join("\n"),
        WHAT_TO_DO,
        `[See every step in OneUptime](${RUN_URL})`,
      ].join("\n\n"),
    );
  });

  /*
   * The message is the only thing the channel is told of such a page: it is
   * first posted when the page is over, and a first post raises no alarm on
   * top of itself. So what the alarm ends with, the message ends with.
   */
  test("what to do is the alarm's own closing sentence, once, between the reasons and the link", () => {
    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(
      page(NOBODY_REACHED),
    );
    const paragraphs: Array<string> = markdown.split("\n\n");

    expect(paragraphs).toHaveLength(4);
    expect(paragraphs[2]).toBe(WHAT_TO_DO);
    expect(markdown.split(WHAT_TO_DO)).toHaveLength(2);

    expect(
      OnCallPolicyRunMessageView.getAlarms(page(NOBODY_REACHED))[0]!.markdown,
    ).toMatch(WHAT_TO_DO_AT_THE_END);
  });

  test("with nothing to say why, it is the headline, what to do and the link", () => {
    expect(
      OnCallPolicyRunMessageView.getMarkdown(
        page({ ...NOBODY_REACHED, notPaged: [] }),
      ),
    ).toBe(
      [
        `⚠️ Workflow ${WORKFLOW_LINK} could not reach anyone for ${RECORD}`,
        WHAT_TO_DO,
        `[See every step in OneUptime](${RUN_URL})`,
      ].join("\n\n"),
    );
  });

  test("a page a person started says it too", () => {
    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(
      page({
        ...NOBODY_REACHED,
        directPage: { startedByPersonName: "Sam Lee" },
      }),
    );

    expect(markdown.split("\n\n")[0]).toBe(
      `⚠️ **Sam Lee** could not reach anyone for ${RECORD}`,
    );
    expect(markdown.split("\n\n")).toContain(WHAT_TO_DO);
  });

  test("no other way a direct page stands says it: only this one is all the channel is told", () => {
    for (const outcome of Object.values(OnCallPolicyRunOutcome)) {
      if (outcome === OnCallPolicyRunOutcome.NobodyReached) {
        continue;
      }

      expect(
        OnCallPolicyRunMessageView.getMarkdown(
          page({ outcome: outcome, acknowledgedByName: "Nitin" }),
        ),
      ).not.toContain(WHAT_TO_DO);
    }
  });

  test("a policy's run that reached nobody leaves it to its alarm: its message was posted when its first rule began", () => {
    const policyRun: OnCallPolicyRun = page({
      ...NOBODY_REACHED,
      directPage: undefined,
      policyName: "PolicyX",
      policyUrl: "https://oneuptime.test/dashboard/p/on-call-duty/policies/1",
      ruleCount: 2,
    });

    expect(OnCallPolicyRunMessageView.getMarkdown(policyRun)).not.toContain(
      WHAT_TO_DO,
    );
    expect(
      OnCallPolicyRunMessageView.getAlarms(policyRun)[0]!.markdown,
    ).toMatch(WHAT_TO_DO_AT_THE_END);
  });

  test("it raises one alarm that says why nobody was reached and what to do", () => {
    expect(OnCallPolicyRunMessageView.getAlarms(page(NOBODY_REACHED))).toEqual([
      {
        key: ON_CALL_RUN_ALARM_OUTCOME,
        markdown: `⚠️ Nobody was paged for ${RECORD}: workflow ${WORKFLOW_LINK} could not reach anyone (Alex Kim: away until ${AWAY_UNTIL_SHOWN}; NB User 2: not a member of this project; nobody was on call in schedule Secondary; team Platform has no members). Check who is on call, or page someone yourself.`,
        text: "Nobody was paged for Incident INC-8",
      },
    ]);
  });

  test("with nothing to say why, the alarm has no empty brackets", () => {
    const alarms: Array<OnCallPolicyRunAlarm> =
      OnCallPolicyRunMessageView.getAlarms(
        page({ ...NOBODY_REACHED, notPaged: [] }),
      );

    expect(alarms[0]!.markdown).toBe(
      `⚠️ Nobody was paged for ${RECORD}: workflow ${WORKFLOW_LINK} could not reach anyone. Check who is on call, or page someone yourself.`,
    );
    expect(alarms[0]!.markdown).not.toContain("()");
  });

  test("a person with no reason on record is said to be not paged", () => {
    const alarms: Array<OnCallPolicyRunAlarm> =
      OnCallPolicyRunMessageView.getAlarms(
        page({
          ...NOBODY_REACHED,
          notPaged: [{ personName: "NB User 2", reason: "  " }],
        }),
      );

    expect(alarms[0]!.markdown).toContain("(NB User 2: not paged)");
  });

  test("the alarm never speaks of escalation rules", () => {
    const alarms: Array<OnCallPolicyRunAlarm> =
      OnCallPolicyRunMessageView.getAlarms(page(NOBODY_REACHED));

    expect(alarms[0]!.markdown).not.toContain("escalation rule");
  });

  test("its notification names who could not reach anyone", () => {
    expect(OnCallPolicyRunMessageView.getPlainText(page(NOBODY_REACHED))).toBe(
      "Workflow Page the on-call engineer could not reach anyone for Incident INC-8",
    );
  });
});

describe("a direct page that failed", () => {
  test("before anybody was paged: it could not page anyone, and why", () => {
    const run: OnCallPolicyRun = page({
      outcome: OnCallPolicyRunOutcome.Failed,
      outcomeDetail: "User notification rules could not be read",
      paged: [],
      notPaged: [],
    });

    expect(OnCallPolicyRunMessageView.getMarkdown(run).split("\n\n")[0]).toBe(
      `❌ Workflow ${WORKFLOW_LINK} could not page anyone for ${RECORD}: User notification rules could not be read`,
    );
    expect(OnCallPolicyRunMessageView.getAlarms(run)).toEqual([
      {
        key: ON_CALL_RUN_ALARM_OUTCOME,
        markdown: `❌ Workflow ${WORKFLOW_LINK} could not page anyone for ${RECORD}: User notification rules could not be read. Page someone yourself.`,
        text: "Workflow Page the on-call engineer could not page anyone for Incident INC-8",
      },
    ]);
    expect(OnCallPolicyRunMessageView.getPlainText(run)).toBe(
      "Workflow Page the on-call engineer could not page anyone for Incident INC-8",
    );
  });

  test("part way, after some people were paged: it stopped paging", () => {
    const run: OnCallPolicyRun = page({
      outcome: OnCallPolicyRunOutcome.Failed,
      outcomeDetail: "The schedule could not be read.",
    });

    expect(OnCallPolicyRunMessageView.getMarkdown(run).split("\n\n")[0]).toBe(
      `❌ Workflow ${WORKFLOW_LINK} stopped paging for ${RECORD}: The schedule could not be read.`,
    );
    expect(alarmKeys(OnCallPolicyRunMessageView.getAlarms(run))).toEqual([
      ON_CALL_RUN_ALARM_OUTCOME,
    ]);
    expect(OnCallPolicyRunMessageView.getAlarms(run)[0]!.markdown).toBe(
      `❌ Workflow ${WORKFLOW_LINK} stopped paging for ${RECORD} before anyone acknowledged: The schedule could not be read. Page someone yourself.`,
    );
    expect(OnCallPolicyRunMessageView.getAlarms(run)[0]!.text).toBe(
      "Workflow Page the on-call engineer stopped paging for Incident INC-8 before anyone acknowledged",
    );
  });
});

describe("every way a direct page can stand", () => {
  test("has a headline that names the record, a notification line, and at most one alarm", () => {
    for (const outcome of Object.values(OnCallPolicyRunOutcome)) {
      const run: OnCallPolicyRun = page({
        outcome: outcome,
        acknowledgedByName: "Nitin",
      });
      const markdown: string = OnCallPolicyRunMessageView.getMarkdown(run);

      expect(markdown.split("\n\n")[0]).toContain(RECORD);
      expect(markdown).toContain(`(${RUN_URL})`);
      expect(
        OnCallPolicyRunMessageView.getPlainText(run).length,
      ).toBeGreaterThan(10);
      expect(OnCallPolicyRunMessageView.getPlainText(run)).toContain(
        "Incident INC-8",
      );
      expect(
        OnCallPolicyRunMessageView.getAlarms(run).length,
      ).toBeLessThanOrEqual(1);
    }
  });
});

/*
 * A PAGE A PERSON STARTED - `/oneuptime page` in Slack, "page" typed to the
 * Microsoft Teams bot. It ends as the paging ending: "so paging stopped".
 * "so Sam Lee stopped paging" read as if Sam had called his own page off,
 * when it was somebody acknowledging, the record moving on or the page
 * running its course that stopped it. Whatever Sam did is still said where
 * he did it: he is paging, he paged, he could not reach anyone.
 */
describe("a direct page a person started", () => {
  const BY_SAM: OnCallDirectPageRun = { startedByPersonName: "Sam Lee" };

  function samPage(overrides: Partial<OnCallPolicyRun> = {}): OnCallPolicyRun {
    return page({ directPage: BY_SAM, ...overrides });
  }

  function headline(run: OnCallPolicyRun): string {
    return OnCallPolicyRunMessageView.getMarkdown(run).split("\n\n")[0]!;
  }

  test("paging: the person is who is paging", () => {
    const run: OnCallPolicyRun = samPage();

    expect(headline(run)).toBe(`📟 **Sam Lee** is paging for ${RECORD}`);
    expect(OnCallPolicyRunMessageView.getPlainText(run)).toBe(
      "Sam Lee is paging for Incident INC-8",
    );
  });

  test("acknowledged: who acknowledged, and that paging stopped", () => {
    const run: OnCallPolicyRun = samPage({
      outcome: OnCallPolicyRunOutcome.Acknowledged,
      acknowledgedByName: "Nitin",
    });

    expect(headline(run)).toBe(
      `✅ **Nitin** acknowledged ${RECORD}, so paging stopped`,
    );
    expect(OnCallPolicyRunMessageView.getPlainText(run)).toBe(
      "Nitin acknowledged Incident INC-8",
    );
    expect(OnCallPolicyRunMessageView.getAlarms(run)).toEqual([]);
  });

  test("the record moved on: its state, and that paging stopped", () => {
    const run: OnCallPolicyRun = samPage({
      outcome: OnCallPolicyRunOutcome.RecordHandled,
      outcomeDetail: "Resolved",
    });

    expect(headline(run)).toBe(
      `✅ ${RECORD} moved to **Resolved**, so paging stopped`,
    );
    expect(OnCallPolicyRunMessageView.getPlainText(run)).toBe(
      "Incident INC-8 moved to Resolved, so paging stopped",
    );
  });

  test("the record handled some other way: that paging stopped", () => {
    const run: OnCallPolicyRun = samPage({
      outcome: OnCallPolicyRunOutcome.RecordHandled,
    });

    expect(headline(run)).toBe(
      `✅ ${RECORD} is being handled, so paging stopped`,
    );
    expect(OnCallPolicyRunMessageView.getPlainText(run)).toBe(
      "Paging stopped for Incident INC-8",
    );
  });

  test("nobody acknowledged: who the person paged, and that paging has stopped", () => {
    const run: OnCallPolicyRun = samPage({
      outcome: OnCallPolicyRunOutcome.NobodyAcknowledged,
    });

    expect(headline(run)).toBe(
      `⚠️ **Sam Lee** paged for ${RECORD} and nobody acknowledged`,
    );
    expect(OnCallPolicyRunMessageView.getAlarms(run)).toEqual([
      {
        key: ON_CALL_RUN_ALARM_OUTCOME,
        markdown: `⚠️ Nobody has acknowledged ${RECORD}. **Sam Lee** paged Nitin and Jane Doe, and paging has stopped. Someone needs to take it.`,
        text: "Nobody has acknowledged Incident INC-8: someone needs to take it",
      },
    ]);
  });

  test("reached nobody: the person could not reach anyone, and what to do", () => {
    const run: OnCallPolicyRun = samPage({
      outcome: OnCallPolicyRunOutcome.NobodyReached,
      paged: [],
    });

    expect(headline(run)).toBe(
      `⚠️ **Sam Lee** could not reach anyone for ${RECORD}`,
    );
    expect(OnCallPolicyRunMessageView.getMarkdown(run)).toContain(WHAT_TO_DO);
  });

  test("failed part way: paging stopped, why, and to page someone", () => {
    const run: OnCallPolicyRun = samPage({
      outcome: OnCallPolicyRunOutcome.Failed,
      outcomeDetail: "The schedule could not be read.",
    });

    expect(headline(run)).toBe(
      `❌ Paging stopped for ${RECORD}: The schedule could not be read.`,
    );
    expect(OnCallPolicyRunMessageView.getPlainText(run)).toBe(
      "Paging stopped for Incident INC-8",
    );
    expect(OnCallPolicyRunMessageView.getAlarms(run)).toEqual([
      {
        key: ON_CALL_RUN_ALARM_OUTCOME,
        markdown: `❌ Paging stopped for ${RECORD} before anyone acknowledged: The schedule could not be read. Page someone yourself.`,
        text: "Paging stopped for Incident INC-8 before anyone acknowledged",
      },
    ]);
  });

  test("failed before anybody was paged: the person could not page anyone", () => {
    const run: OnCallPolicyRun = samPage({
      outcome: OnCallPolicyRunOutcome.Failed,
      paged: [],
    });

    expect(headline(run)).toBe(
      `❌ **Sam Lee** could not page anyone for ${RECORD}`,
    );
    expect(OnCallPolicyRunMessageView.getAlarms(run)[0]!.text).toBe(
      "Sam Lee could not page anyone for Incident INC-8",
    );
  });

  test("no ending of a person's page says the person stopped paging", () => {
    // A direct page has no policy that could be archived under it.
    const outcomes: Array<OnCallPolicyRunOutcome> = Object.values(
      OnCallPolicyRunOutcome,
    ).filter((outcome: OnCallPolicyRunOutcome): boolean => {
      return outcome !== OnCallPolicyRunOutcome.PolicyArchived;
    });

    expect(outcomes.length).toBe(
      Object.values(OnCallPolicyRunOutcome).length - 1,
    );

    for (const outcome of outcomes) {
      for (const paged of [page().paged, []]) {
        const run: OnCallPolicyRun = samPage({
          outcome: outcome,
          acknowledgedByName: "Nitin",
          outcomeDetail: "Resolved",
          paged: paged,
        });
        const said: Array<string> = [
          OnCallPolicyRunMessageView.getMarkdown(run),
          OnCallPolicyRunMessageView.getPlainText(run),
          ...OnCallPolicyRunMessageView.getAlarms(run).flatMap(
            (alarm: OnCallPolicyRunAlarm): Array<string> => {
              return [alarm.markdown, alarm.text];
            },
          ),
        ];

        for (const text of said) {
          expect({ outcome, text }).toEqual({
            outcome,
            text: expect.not.stringContaining("Sam Lee** stopped paging"),
          });
          expect({ outcome, text }).toEqual({
            outcome,
            text: expect.not.stringContaining("Sam Lee stopped paging"),
          });
          expect({ outcome, text }).toEqual({
            outcome,
            text: expect.not.stringContaining("has stopped paging"),
          });
        }
      }
    }
  });

  test("a workflow and the product still stop paging themselves", () => {
    const acknowledged: Partial<OnCallPolicyRun> = {
      outcome: OnCallPolicyRunOutcome.Acknowledged,
      acknowledgedByName: "Nitin",
    };

    expect(headline(page(acknowledged))).toBe(
      `✅ **Nitin** acknowledged ${RECORD}, so workflow ${WORKFLOW_LINK} stopped paging`,
    );

    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("Acme Ops");

    expect(headline(page({ ...acknowledged, directPage: {} }))).toBe(
      `✅ **Nitin** acknowledged ${RECORD}, so Acme Ops stopped paging`,
    );
    // A workflow's name wins over the person's, as everywhere else.
    expect(
      headline(
        page({
          ...acknowledged,
          directPage: { ...BY_WORKFLOW, startedByPersonName: "Sam Lee" },
        }),
      ),
    ).toBe(
      `✅ **Nitin** acknowledged ${RECORD}, so workflow ${WORKFLOW_LINK} stopped paging`,
    );
  });
});

/*
 * A PAGE FROM AN INCIDENT'S OWN CHANNEL (block 31) goes on until somebody
 * it paged answers it, whoever else acknowledges the incident
 * (OnCallPersonPage). When it ends unanswered while somebody is on the
 * incident, nobody needs to take the incident: the person who paged needs
 * somebody else.
 */
describe("a person's page nobody answered, about a record somebody else is on", () => {
  const BY_SAM: OnCallDirectPageRun = { startedByPersonName: "Sam Lee" };

  function unanswered(overrides: Partial<OnCallPolicyRun> = {}): OnCallPolicyRun {
    return page({
      directPage: BY_SAM,
      outcome: OnCallPolicyRunOutcome.NobodyAnswered,
      ...overrides,
    });
  }

  test("its headline says the page went unanswered - not that the incident needs taking", () => {
    const run: OnCallPolicyRun = unanswered();

    expect(OnCallPolicyRunMessageView.getMarkdown(run).split("\n\n")[0]).toBe(
      `⚠️ Nobody answered the page from **Sam Lee** for ${RECORD}`,
    );
    expect(OnCallPolicyRunMessageView.getPlainText(run)).toBe(
      "Nobody answered the page from Sam Lee for Incident INC-8",
    );
  });

  test("one alarm: who was paged, that paging stopped, and what to do next", () => {
    expect(OnCallPolicyRunMessageView.getAlarms(unanswered())).toEqual([
      {
        key: ON_CALL_RUN_ALARM_OUTCOME,
        markdown: `⚠️ Nobody answered the page for ${RECORD}: **Sam Lee** paged Nitin and Jane Doe, and paging has stopped. Page someone else, or reach them another way.`,
        text: "Nobody answered the page from Sam Lee for Incident INC-8",
      },
    ]);
  });

  test("it never asks for somebody to take the record, nor says the person stopped paging", () => {
    const run: OnCallPolicyRun = unanswered();
    const said: string = [
      OnCallPolicyRunMessageView.getMarkdown(run),
      OnCallPolicyRunMessageView.getPlainText(run),
      ...OnCallPolicyRunMessageView.getAlarms(run).map(
        (alarm: OnCallPolicyRunAlarm): string => {
          return alarm.markdown;
        },
      ),
    ].join("\n");

    expect(said).not.toContain("Someone needs to take it");
    expect(said).not.toContain("Nobody has acknowledged");
    expect(said).not.toContain("Sam Lee** stopped paging");
  });

  test("the people of a team it paged are named after the team", () => {
    const run: OnCallPolicyRun = unanswered({
      paged: [
        { ...page().paged[0]!, name: "Test User 4", teams: ["Team X"] },
        { ...page().paged[0]!, name: "Test User 3", teams: ["Team X"] },
      ],
    });

    expect(OnCallPolicyRunMessageView.getAlarms(run)[0]!.markdown).toContain(
      "**Sam Lee** paged Team X (Test User 4 and Test User 3), and paging has stopped.",
    );
  });
});

/*
 * WHAT THE PERSON WHO PAGED WROTE (pageMessage): quoted under the first
 * line, wherever the run's message is - the incident's own channel
 * included, where a page about something new quotes nothing.
 */
describe("the page's message", () => {
  const BY_SAM: OnCallDirectPageRun = { startedByPersonName: "Sam Lee" };

  test("quoted under the headline, everywhere the message is", () => {
    const run: OnCallPolicyRun = page({
      directPage: BY_SAM,
      pageMessage: "Can you check the database?",
    });

    expect(OnCallPolicyRunMessageView.getMarkdown(run).split("\n\n")).toEqual([
      `📟 **Sam Lee** is paging for ${RECORD}`,
      "“Can you check the database?”",
      "- **Nitin**: paged once · by SMS and email\n- **Jane Doe** (covering for Alex Kim): being paged now\n- **NB User 2**: not paged · not a member of this project\n- Nobody was on call in schedule **Secondary**\n- Team **Platform** has no members",
      `[See every step in OneUptime](${RUN_URL})`,
    ]);
    expect(OnCallPolicyRunMessageView.getPlainText(run)).toBe(
      "Sam Lee is paging for Incident INC-8: Can you check the database?",
    );
  });

  test("where somebody paged from a chat it is the quote, not the record's title", () => {
    const run: OnCallPolicyRun = page({
      directPage: BY_SAM,
      pageMessage: "Can you check the database?",
    });

    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(run, {
      recordTitle: "Checkout is down",
    });

    expect(markdown).toContain("“Can you check the database?”");
    expect(markdown).not.toContain("Checkout is down");
  });

  test("still told once the page ends", () => {
    const run: OnCallPolicyRun = page({
      directPage: BY_SAM,
      pageMessage: "Can you check the database?",
      outcome: OnCallPolicyRunOutcome.Acknowledged,
      acknowledgedByName: "Nitin",
    });

    expect(OnCallPolicyRunMessageView.getMarkdown(run).split("\n\n")[1]).toBe(
      "“Can you check the database?”",
    );
  });

  test("on one line, cut where a chat line reads at a glance", () => {
    const run: OnCallPolicyRun = page({
      directPage: BY_SAM,
      pageMessage: `${"word ".repeat(100)}\nend`,
    });

    const quote: string =
      OnCallPolicyRunMessageView.getMarkdown(run).split("\n\n")[1]!;

    expect(quote.startsWith("“word word")).toBe(true);
    expect(quote.endsWith("…”")).toBe(true);
    expect(quote.length).toBeLessThanOrEqual(202);
    expect(quote).not.toContain("\n");
  });

  test("a message is text: nothing in it becomes a link or formatting", () => {
    const run: OnCallPolicyRun = page({
      directPage: BY_SAM,
      pageMessage: "**urgent** see [this](https://evil.example)",
    });

    expect(OnCallPolicyRunMessageView.getMarkdown(run).split("\n\n")[1]).toBe(
      "“\\*\\*urgent\\*\\* see \\[this\\](https://evil.example)”",
    );
  });

  test("no message, and no record title: nothing quoted", () => {
    expect(
      OnCallPolicyRunMessageView.getMarkdown(page({ directPage: BY_SAM })).split(
        "\n\n",
      )[1],
    ).toMatch(/^- /);
  });
});

/*
 * A PAGED TEAM, BY ITS NAME (block 31): "If I page a team name / group,
 * the Slack message unfurls it into members. Would be nice to also show the
 * team name." Each person a team was paged for says the team, as a person
 * covering for somebody says whom.
 */
describe("a paged team, named by each of its people", () => {
  test("a team's people: each line says the team", () => {
    const run: OnCallPolicyRun = page({
      paged: [
        {
          name: "Test User 4",
          timesPaged: 1,
          isBeingPaged: false,
          acknowledged: false,
          methods: [],
          coveringFor: [],
          teams: ["Team X"],
        },
        {
          name: "Test User 3",
          timesPaged: 1,
          isBeingPaged: false,
          acknowledged: false,
          methods: ["SMS"],
          coveringFor: [],
          teams: ["Team X"],
        },
      ],
      notPaged: [],
    });

    expect(OnCallPolicyRunMessageView.getMarkdown(run).split("\n\n")[1]).toBe(
      [
        "- **Test User 4** (member of Team X): paged once",
        "- **Test User 3** (member of Team X): paged once · by SMS",
      ].join("\n"),
    );
  });

  test("somebody paged through two teams names both; covering for somebody, says that first", () => {
    const run: OnCallPolicyRun = page({
      paged: [
        {
          name: "Sam",
          timesPaged: 1,
          isBeingPaged: false,
          acknowledged: true,
          methods: ["push"],
          coveringFor: ["Alex Kim"],
          teams: ["Platform", "Database"],
        },
      ],
      notPaged: [],
    });

    expect(OnCallPolicyRunMessageView.getMarkdown(run).split("\n\n")[1]).toBe(
      "- **Sam** (covering for Alex Kim; member of Platform and Database): acknowledged · paged once · by push",
    );
  });

  test("a team's name is text", () => {
    const run: OnCallPolicyRun = page({
      paged: [
        {
          name: "Sam",
          timesPaged: 1,
          isBeingPaged: false,
          acknowledged: false,
          methods: [],
          coveringFor: [],
          teams: ["*Ops* [team](https://evil.example)"],
        },
      ],
      notPaged: [],
    });

    expect(OnCallPolicyRunMessageView.getMarkdown(run)).toContain(
      "(member of \\*Ops\\* \\[team\\](https://evil.example))",
    );
  });

  test("somebody named on their own says no team", () => {
    expect(OnCallPolicyRunMessageView.getMarkdown(page())).toContain(
      "- **Nitin**: paged once · by SMS and email",
    );
  });

  test("an alarm names a team first, then its people; somebody named alone, alone", () => {
    const run: OnCallPolicyRun = page({
      outcome: OnCallPolicyRunOutcome.NobodyAcknowledged,
      paged: [
        { ...page().paged[0]!, name: "Test User 4", teams: ["Team X"] },
        { ...page().paged[0]!, name: "Alex Kim" },
        { ...page().paged[0]!, name: "Test User 3", teams: ["Team X"] },
      ],
    });

    expect(OnCallPolicyRunMessageView.getAlarms(run)[0]!.markdown).toContain(
      `paged Team X (Test User 4 and Test User 3) and Alex Kim, and has stopped paging.`,
    );
  });

  test("an alarm names at most five, people or teams, then how many more", () => {
    const run: OnCallPolicyRun = page({
      outcome: OnCallPolicyRunOutcome.NobodyAcknowledged,
      paged: ["A", "B", "C", "D", "E", "F", "G"].map((name: string) => {
        return { ...page().paged[0]!, name: name };
      }),
    });

    expect(OnCallPolicyRunMessageView.getAlarms(run)[0]!.markdown).toContain(
      "paged A, B, C, D, E and 2 others, and has stopped paging.",
    );
  });

  test("a team of many: its first five, then how many more", () => {
    const run: OnCallPolicyRun = page({
      outcome: OnCallPolicyRunOutcome.NobodyAcknowledged,
      paged: ["A", "B", "C", "D", "E", "F"].map((name: string) => {
        return { ...page().paged[0]!, name: name, teams: ["Platform"] };
      }),
    });

    expect(OnCallPolicyRunMessageView.getAlarms(run)[0]!.markdown).toContain(
      "paged Platform (A, B, C, D, E and 1 other), and has stopped paging.",
    );
  });

  test("the reason a team pages somebody, as other places say it", () => {
    expect(
      OnCallPolicyRunMessageView.getTeamReason(["Platform"]).toString(),
    ).toBe("member of Platform");
    expect(
      OnCallPolicyRunMessageView.getTeamReason([
        "Platform",
        "Database",
        "Edge",
      ]).toString(),
    ).toBe("member of Platform, Database and Edge");
  });
});
