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
      { retryingCurrentRule: true },
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

  test("a person who started the page reads the same inside a sentence", () => {
    expect(
      OnCallPolicyRunMessageView.getMarkdown(
        page({
          directPage: { startedByPersonName: "Sam Lee" },
          outcome: OnCallPolicyRunOutcome.Acknowledged,
          acknowledgedByName: "Nitin",
        }),
      ).split("\n\n")[0],
    ).toBe(
      `✅ **Nitin** acknowledged ${RECORD}, so **Sam Lee** stopped paging`,
    );
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

  test("its message says so, and lists why for each target", () => {
    expect(OnCallPolicyRunMessageView.getMarkdown(page(NOBODY_REACHED))).toBe(
      [
        `⚠️ Workflow ${WORKFLOW_LINK} could not reach anyone for ${RECORD}`,
        [
          `- **Alex Kim**: not paged · away until ${AWAY_UNTIL_SHOWN}`,
          "- **NB User 2**: not paged · not a member of this project",
          "- Nobody was on call in schedule **Secondary**",
          "- Team **Platform** has no members",
        ].join("\n"),
        `[See every step in OneUptime](${RUN_URL})`,
      ].join("\n\n"),
    );
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
