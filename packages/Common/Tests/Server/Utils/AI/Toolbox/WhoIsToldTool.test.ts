import AIToolbox from "../../../../../Server/Utils/AI/Toolbox/Index";
import {
  WhoIsToldTool,
  describeWhoIsToldForModel,
} from "../../../../../Server/Utils/AI/Toolbox/WhoIsToldTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import MonitorService from "../../../../../Server/Services/MonitorService";
import WhoIsToldService from "../../../../../Server/Services/WhoIsToldService";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import { AIChatCitationTargetType } from "../../../../../Types/AI/AIChatTypes";
import AIChatPermissionMode from "../../../../../Types/AI/AIChatPermissionMode";
import {
  WhoIsToldBreakKind,
  WhoIsToldFix,
  WhoIsToldOwners,
  WhoIsToldOwnersSource,
  WhoIsToldPersonProblem,
  WhoIsToldResult,
  WhoIsToldRule,
  WhoIsToldStatusPage,
  redactWhoIsTold,
} from "../../../../../Types/Monitor/WhoIsTold";
import ObjectID from "../../../../../Types/ObjectID";
import { OnCallPageChannel } from "../../../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import { OnCallTestPageRecordKind } from "../../../../../Types/OnCallDutyPolicy/OnCallTestPage";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * "WHO IS TOLD WHEN EXAMPLE.COM GOES DOWN?" (issues #6829 and #6810).
 *
 * After Ask AI set a monitor up, it answers that from the resolver the
 * monitor's own page draws ("When this goes down"), as the person may see
 * it: every criteria, what it opens, who it emails and pages and by what,
 * and each break in the resolver's own words. Never a guess.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const MONITOR_ID: string = "55555555-5555-4555-8555-555555555555";

const ctx: ToolContext = {
  projectId: PROJECT_ID,
  props: { userId: ObjectID.generate(), tenantId: PROJECT_ID },
};

type Spy = jest.SpyInstance;

// Words that say who, never a gap ("undefined", an empty string) or a hedge.
const OWNERS_WORDS_PATTERN: RegExp = /^(?:its|the) [a-z' ]*owner[a-z ]*$/u;

afterEach(() => {
  jest.restoreAllMocks();
});

const RESULT: WhoIsToldResult = {
  monitorId: MONITOR_ID,
  monitorName: "example.com",
  checkedAt: "2026-11-12T10:00:00.000Z",
  criteria: [
    {
      id: "c1",
      name: "Check if offline",
      statusName: "Offline",
      statusOwners: {
        source: WhoIsToldOwnersSource.MonitorOwners,
        userNames: ["Me Myself"],
        teamNames: [],
      },
      events: [
        {
          kind: OnCallTestPageRecordKind.Incident,
          title: "example.com is offline",
          severityName: "Critical Incident",
          owners: {
            source: WhoIsToldOwnersSource.ProjectOwners,
            userNames: ["Me Myself"],
            teamNames: [],
          },
          ownerRules: [],
          rules: [{ id: "r1", name: "Page Default for every new incident" }],
          policies: [
            {
              id: "p1",
              name: "Default on-call policy",
              isHidden: false,
              isNamedByCriteria: false,
              ruleIds: ["r1"],
              levelCount: 1,
              people: [
                {
                  userId: "u1",
                  name: "Me Myself",
                  channels: [OnCallPageChannel.Email, OnCallPageChannel.SMS],
                  isFallback: true,
                  isReachable: true,
                },
                {
                  userId: "u2",
                  name: "Ana Lopez",
                  reachedThrough: "Team Platform",
                  channels: [],
                  isFallback: false,
                  isReachable: false,
                  problem: WhoIsToldPersonProblem.NoVerifiedMethod,
                },
              ],
              notPaged: [],
            },
          ],
          statusPages: [{ id: "s1", name: "Acme Status" }],
        },
      ],
    },
  ],
  channels: {
    isBillingEnabled: false,
    isSmsOn: true,
    isCallOn: true,
    isWhatsAppOn: false,
    isTelegramOn: false,
    hasOwnTwilioForSms: false,
    hasOwnTwilioForCalls: false,
    serverCanSendEmail: true,
    serverCanSendSms: true,
    serverCanCall: true,
  },
  breaks: [
    {
      kind: WhoIsToldBreakKind.PersonUnreachable,
      message:
        "Ana Lopez can't be reached by this page: no method of theirs is verified.",
      fix: WhoIsToldFix.OnCallReadiness,
    },
  ],
};

describe("describeWhoIsToldForModel", () => {
  test("says the chain as the resolver read it: criteria, what opens, who is emailed and paged and by what, and the breaks", () => {
    const text: string = describeWhoIsToldForModel(RESULT);

    expect(text).toContain(
      'Who is told when monitor "example.com" goes down (checked 2026-11-12T10:00:00.000Z):',
    );
    expect(text).toContain(
      '- Criteria "Check if offline": sets status Offline; emails the monitor\'s owners (Me Myself) of the change',
    );
    expect(text.split("\n")).toContain(
      "  - opens an incident (Critical Incident); emails the project's owners (Me Myself)",
    );
    expect(text).toContain(
      '    - pages on-call policy "Default on-call policy" (1 escalation level), whose first level pages: Me Myself: by email, SMS (their verified methods, as no rule of theirs covers this severity); Ana Lopez (Team Platform): cannot be reached by this page (NoVerifiedMethod)',
    );
    expect(text).toContain('    - shows on status pages: "Acme Status"');
    expect(text).toContain(
      "Where the chain breaks:\n- Ana Lopez can't be reached by this page: no method of theirs is verified.",
    );
  });

  test("an alert that pages nobody, a hidden policy, and a chain with no break are said as such", () => {
    const text: string = describeWhoIsToldForModel({
      ...RESULT,
      criteria: [
        {
          id: "c2",
          name: "Slow",
          events: [
            {
              kind: OnCallTestPageRecordKind.Alert,
              title: "example.com is slow",
              severityName: "High",
              owners: {
                source: WhoIsToldOwnersSource.Named,
                userNames: [],
                teamNames: ["Platform"],
              },
              ownerRules: [],
              rules: [],
              policies: [],
              statusPages: [],
            },
            {
              kind: OnCallTestPageRecordKind.Incident,
              title: "example.com is slow",
              severityName: "Low",
              owners: {
                source: WhoIsToldOwnersSource.OwnerRules,
                userNames: ["Dana Reyes"],
                teamNames: [],
              },
              ownerRules: [{ id: "o1", name: "Slow sites to Dana" }],
              rules: [],
              policies: [
                {
                  id: "p2",
                  name: "",
                  isHidden: true,
                  isNamedByCriteria: true,
                  ruleIds: [],
                  levelCount: 0,
                  people: [],
                  notPaged: [],
                },
              ],
              statusPages: [],
            },
          ],
        },
      ],
      breaks: [],
    });

    expect(text.split("\n")).toContain(
      "  - opens an alert (High); emails its owners (team Platform)",
    );
    expect(text).toContain(
      "    - pages nobody: no on-call rule runs a policy for it",
    );
    expect(text.split("\n")).toContain(
      "  - opens an incident (Low); emails the owners added by owner rules (Dana Reyes)",
    );
    expect(text).toContain(
      "an on-call policy the person may not read (paging is set up, and who is hidden)",
    );
    expect(text).toContain("Nothing breaks the chain.");
  });

  test("a monitor whose criteria do nothing says so", () => {
    expect(
      describeWhoIsToldForModel({ ...RESULT, criteria: [], breaks: [] }),
    ).toContain("- No criteria changes its status or opens anything.");
  });
});

/*
 * WHO IT EMAILS, FOR EACH SOURCE WHOISTOLD DEFINES (#7396).
 *
 * The resolver says where an event's owners come from - named on the
 * criteria (or the network device), added only by the project's owner rules,
 * the project's owners when nobody is either, or, for a status change, the
 * monitor's own owners - and the monitor's "When this goes down" card says
 * each in its own words. The tool says the same, one exact line per source,
 * so Ask AI never tells someone the project's owners are emailed when an
 * owner rule picks Dana.
 */

// A criteria that opens one incident, which emails `owners`.
function opening(
  owners: WhoIsToldOwners,
  ownerRules: Array<WhoIsToldRule> = [],
  statusPages: Array<WhoIsToldStatusPage> = [],
): WhoIsToldResult {
  return {
    ...RESULT,
    criteria: [
      {
        id: "c3",
        name: "Check if offline",
        events: [
          {
            kind: OnCallTestPageRecordKind.Incident,
            title: "example.com is offline",
            severityName: "Critical Incident",
            owners: owners,
            ownerRules: ownerRules,
            rules: [],
            policies: [],
            statusPages: statusPages,
          },
        ],
      },
    ],
    breaks: [],
  };
}

// A criteria that only changes the status, which emails `owners` of it.
function statusChange(owners: WhoIsToldOwners): WhoIsToldResult {
  return {
    ...RESULT,
    criteria: [
      {
        id: "c4",
        name: "Check if offline",
        statusName: "Offline",
        statusOwners: owners,
        events: [],
      },
    ],
    breaks: [],
  };
}

function linesOf(result: WhoIsToldResult): Array<string> {
  return describeWhoIsToldForModel(result).split("\n");
}

// Each source by itself, as the card's "It emails ..." says it with no names.
const BARE_WORDS: Array<[WhoIsToldOwnersSource, string]> = [
  [WhoIsToldOwnersSource.Named, "its owners"],
  [WhoIsToldOwnersSource.OwnerRules, "the owners added by owner rules"],
  [WhoIsToldOwnersSource.ProjectOwners, "the project's owners"],
  [WhoIsToldOwnersSource.MonitorOwners, "the monitor's owners"],
];

const OPENS: string = "  - opens an incident (Critical Incident); emails ";
const STATUS: string =
  '- Criteria "Check if offline": sets status Offline; emails ';

describe("describeWhoIsToldForModel: who it emails, for each owners source", () => {
  test("Named: the owners the criteria names, people first and then teams", () => {
    const lines: Array<string> = linesOf(
      opening({
        source: WhoIsToldOwnersSource.Named,
        userNames: ["Ben Ito", "Ana Lopez"],
        teamNames: ["Checkout SRE"],
      }),
    );

    expect(lines).toContain(
      `${OPENS}its owners (Ben Ito, Ana Lopez, team Checkout SRE)`,
    );
    // No owner rule adds anyone, so none is named.
    expect(lines.join("\n")).not.toContain("owner rule");
  });

  test("Named, with owner rules that add more owners: the rules are named right under it", () => {
    const lines: Array<string> = linesOf(
      opening(
        {
          source: WhoIsToldOwnersSource.Named,
          userNames: ["Ben Ito", "Dana Reyes"],
          teamNames: [],
        },
        [{ id: "o1", name: "Slow sites to Dana" }],
      ),
    );
    const opens: number = lines.indexOf(
      `${OPENS}its owners (Ben Ito, Dana Reyes)`,
    );

    expect(opens).toBeGreaterThan(-1);
    expect(lines[opens + 1]).toBe(
      '    - owner rules that add its owners: "Slow sites to Dana"',
    );
  });

  test("OwnerRules: nobody is named, so only the owners the project's owner rules add - and which rules", () => {
    const lines: Array<string> = linesOf(
      opening(
        {
          source: WhoIsToldOwnersSource.OwnerRules,
          userNames: ["Dana Reyes"],
          teamNames: ["Platform"],
        },
        [
          { id: "o1", name: "Slow sites to Dana" },
          { id: "o2", name: "Everything to Platform" },
        ],
      ),
    );

    expect(lines).toEqual([
      'Who is told when monitor "example.com" goes down (checked 2026-11-12T10:00:00.000Z):',
      '- Criteria "Check if offline"',
      `${OPENS}the owners added by owner rules (Dana Reyes, team Platform)`,
      '    - owner rules that add its owners: "Slow sites to Dana", "Everything to Platform"',
      "    - pages nobody: no on-call rule runs a policy for it",
      "Nothing breaks the chain.",
    ]);
    // Never the project's owners, nor a guess about whether a rule adds anyone.
    expect(lines.join("\n")).not.toContain("the project's owners");
    expect(lines.join("\n")).not.toContain("unless");
  });

  test("ProjectOwners: nobody is named or added by a rule, so the project's owners - with nothing about owner rules", () => {
    const lines: Array<string> = linesOf(
      opening({
        source: WhoIsToldOwnersSource.ProjectOwners,
        userNames: ["Me Myself", "Ana Lopez"],
        teamNames: [],
      }),
    );

    expect(lines).toContain(
      `${OPENS}the project's owners (Me Myself, Ana Lopez)`,
    );
    // The resolver read the owner rules: none adds anyone, so nothing hedges.
    expect(lines.join("\n")).not.toContain("owner rule");
    expect(lines.join("\n")).not.toContain("unless");
  });

  test("MonitorOwners: a status change emails the monitor's own owners", () => {
    expect(
      linesOf(
        statusChange({
          source: WhoIsToldOwnersSource.MonitorOwners,
          userNames: ["Me Myself"],
          teamNames: [],
        }),
      ),
    ).toContain(`${STATUS}the monitor's owners (Me Myself) of the change`);
  });

  test("ProjectOwners for a status change: a monitor with no owners of its own emails the project's", () => {
    expect(
      linesOf(
        statusChange({
          source: WhoIsToldOwnersSource.ProjectOwners,
          userNames: ["Me Myself"],
          teamNames: [],
        }),
      ),
    ).toContain(`${STATUS}the project's owners (Me Myself) of the change`);
  });

  test.each(BARE_WORDS)(
    "with no names to say, %s is still said by where its owners come from: %s",
    (source: WhoIsToldOwnersSource, words: string) => {
      const owners: WhoIsToldOwners = {
        source: source,
        userNames: [],
        teamNames: [],
      };

      expect(linesOf(opening(owners))).toContain(`${OPENS}${words}`);
      expect(linesOf(statusChange(owners))).toContain(
        `${STATUS}${words} of the change`,
      );
    },
  );

  test("every source WhoIsTold defines is worded, and no two alike", () => {
    const sources: Array<WhoIsToldOwnersSource> = Object.values(
      WhoIsToldOwnersSource,
    );
    const said: Array<string> = sources.map(
      (source: WhoIsToldOwnersSource): string => {
        const line: string | undefined = linesOf(
          opening({ source: source, userNames: [], teamNames: [] }),
        ).find((item: string): boolean => {
          return item.startsWith(OPENS);
        });

        return (line || "").slice(OPENS.length);
      },
    );

    expect(sources).toHaveLength(4);
    for (const words of said) {
      expect(words).toMatch(OWNERS_WORDS_PATTERN);
    }
    expect(new Set(said).size).toBe(sources.length);
  });

  test("an owner rule the person may not read keeps its place, without its name", () => {
    expect(
      linesOf(
        opening(
          {
            source: WhoIsToldOwnersSource.OwnerRules,
            userNames: ["Dana Reyes"],
            teamNames: [],
          },
          [
            { id: "o1", name: "" },
            { id: "o2", name: "Slow sites to Dana" },
          ],
        ),
      ),
    ).toContain(
      '    - owner rules that add its owners: an owner rule the person may not read, "Slow sites to Dana"',
    );
  });

  /*
   * The owner-rules line is new text the model reads, so it is held to the
   * resolver's own redaction (getForMonitor hands the tool redactWhoIsTold's
   * answer): a rule the person may not read never reaches Ask AI by name,
   * on an incident or an alert, and one they may read is named.
   */
  test("through redactWhoIsTold, an owner rule the person may not read is never named to the model", () => {
    const answer: WhoIsToldResult = {
      ...RESULT,
      criteria: [
        {
          id: "c5",
          name: "Check if offline",
          events: [
            {
              kind: OnCallTestPageRecordKind.Incident,
              title: "example.com is offline",
              severityName: "Critical Incident",
              owners: {
                source: WhoIsToldOwnersSource.OwnerRules,
                userNames: ["Dana Reyes"],
                teamNames: [],
              },
              ownerRules: [
                { id: "o1", name: "Secret escalation to Dana" },
                { id: "o2", name: "Slow sites to Dana" },
              ],
              rules: [],
              policies: [],
              statusPages: [],
            },
            {
              kind: OnCallTestPageRecordKind.Alert,
              title: "example.com is offline",
              severityName: "High",
              owners: {
                source: WhoIsToldOwnersSource.Named,
                userNames: ["Ben Ito"],
                teamNames: [],
              },
              ownerRules: [{ id: "o3", name: "Secret alert rule" }],
              rules: [],
              policies: [],
              statusPages: [],
            },
          ],
        },
      ],
      breaks: [],
    };

    const text: string = describeWhoIsToldForModel(
      redactWhoIsTold({
        result: answer,
        readablePolicyIds: new Set<string>(),
        readableRuleIds: new Set<string>(),
        readableOwnerRuleIds: new Set<string>(["o2"]),
        readableStatusPageIds: new Set<string>(),
      }),
    );
    const lines: Array<string> = text.split("\n");

    expect(text).not.toContain("Secret");
    expect(lines).toContain(
      '    - owner rules that add its owners: an owner rule the person may not read, "Slow sites to Dana"',
    );
    expect(lines).toContain(
      "    - owner rules that add its owners: an owner rule the person may not read",
    );
    // Each event's rules sit under its own line, in order.
    expect(
      lines.indexOf("  - opens an alert (High); emails its owners (Ben Ito)"),
    ).toBe(
      lines.indexOf(
        "    - owner rules that add its owners: an owner rule the person may not read",
      ) - 1,
    );
  });

  /*
   * The same for a status page: one the person may not read keeps its place
   * in the list, said as such - never as an empty "" the model would read as
   * a page with no name, nor by the name redaction took away.
   */
  test("through redactWhoIsTold, a status page the person may not read is said as such, never as an empty name", () => {
    const text: string = describeWhoIsToldForModel(
      redactWhoIsTold({
        result: opening(
          {
            source: WhoIsToldOwnersSource.ProjectOwners,
            userNames: ["Me Myself"],
            teamNames: [],
          },
          [],
          [
            { id: "s1", name: "Acme Status" },
            { id: "s2", name: "Internal Ops Status" },
          ],
        ),
        readablePolicyIds: new Set<string>(),
        readableRuleIds: new Set<string>(),
        readableOwnerRuleIds: new Set<string>(),
        readableStatusPageIds: new Set<string>(["s1"]),
      }),
    );

    expect(text.split("\n")).toContain(
      '    - shows on status pages: "Acme Status", a status page the person may not read',
    );
    expect(text).not.toContain("Internal Ops");
    expect(text).not.toContain('""');
  });
});

describe("who_is_told", () => {
  test("is a read the toolbox offers in every mode, Read-only included", () => {
    expect(WhoIsToldTool.isMutation).toBeFalsy();
    expect(AIToolbox.getToolByName("who_is_told")).toBe(WhoIsToldTool);

    const readOnlyNames: Array<string> = AIToolbox.getLlmToolDefinitions(
      AIChatPermissionMode.ReadOnly,
    ).map((definition: { name: string }) => {
      return definition.name;
    });
    expect(readOnlyNames).toContain("who_is_told");
  });

  test("finds the monitor by its name or address, as the person, and answers from the resolver as they may see it", async () => {
    const find: Spy = jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([
        Object.assign(new Monitor(), { _id: MONITOR_ID, name: "example.com" }),
      ] as never);
    const resolve: Spy = jest
      .spyOn(WhoIsToldService, "getForMonitor")
      .mockResolvedValue(RESULT as never);

    const result: ToolExecutionResult = await WhoIsToldTool.execute(
      { monitor: "https://example.com" },
      ctx,
    );

    expect((find.mock.calls[0]![0] as { props: unknown }).props).toBe(
      ctx.props,
    );
    const asked: {
      projectId: ObjectID;
      monitorId: ObjectID;
      props: unknown;
    } = resolve.mock.calls[0]![0] as {
      projectId: ObjectID;
      monitorId: ObjectID;
      props: unknown;
    };
    expect(asked.props).toBe(ctx.props);
    expect(asked.projectId).toBe(PROJECT_ID);
    expect(asked.monitorId.toString()).toBe(MONITOR_ID);

    expect(result.dataForLlm).toContain(
      'Who is told when monitor "example.com" goes down',
    );
    expect(result.citationLabel).toBe(
      'Who is told when "example.com" goes down',
    );
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.MonitorView,
      params: { monitorId: MONITOR_ID },
    });
  });

  test("finds a monitor by its id", async () => {
    const findOne: Spy = jest
      .spyOn(MonitorService, "findOneBy")
      .mockResolvedValue(
        Object.assign(new Monitor(), {
          _id: MONITOR_ID,
          name: "example.com",
        }) as never,
      );
    jest
      .spyOn(WhoIsToldService, "getForMonitor")
      .mockResolvedValue(RESULT as never);

    await WhoIsToldTool.execute({ monitor: MONITOR_ID }, ctx);

    const asked: { query: { _id: string; projectId: ObjectID } } = findOne.mock
      .calls[0]![0] as { query: { _id: string; projectId: ObjectID } };
    expect(asked.query._id).toBe(MONITOR_ID);
    expect(asked.query.projectId).toBe(PROJECT_ID);
  });

  test("a monitor the project does not have is said, never guessed", async () => {
    jest.spyOn(MonitorService, "findBy").mockResolvedValue([] as never);
    const resolve: Spy = jest.spyOn(WhoIsToldService, "getForMonitor");

    await expect(
      WhoIsToldTool.execute({ monitor: "nothing.example" }, ctx),
    ).rejects.toThrow('No monitor named "nothing.example" in this project.');
    await expect(WhoIsToldTool.execute({}, ctx)).rejects.toThrow(
      "No monitor named",
    );
    expect(resolve).not.toHaveBeenCalled();
  });
});
