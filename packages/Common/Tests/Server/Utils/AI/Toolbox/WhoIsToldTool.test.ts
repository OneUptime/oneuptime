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
  WhoIsToldEvent,
  WhoIsToldFix,
  WhoIsToldOwnerAddedBy,
  WhoIsToldOwnerKind,
  WhoIsToldOwnerProblem,
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
const OWNERS_WORDS_PATTERN: RegExp =
  /^(?:its|the) [A-Za-z' ]*[Oo]wner[a-z ]*$/u;

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
      '  - opens an incident (Critical Incident) titled "example.com is offline"; emails the Project Owners (Me Myself)',
    );
    expect(text).toContain(
      `    - pages on-call policy "Default on-call policy" (1 escalation level), run by "Page Default for every new incident", whose first level pages: Me Myself: by email, SMS (what the fallback picks of their verified methods, as no rule of theirs covers this severity); Ana Lopez (Team Platform): can't be paged, because Ana Lopez has no verified notification method`,
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
      '  - opens an alert (High) titled "example.com is slow"; emails its owners (team Platform)',
    );
    expect(text).toContain(
      "    - pages nobody: no on-call rule runs a policy for it",
    );
    expect(text.split("\n")).toContain(
      '  - opens an incident (Low) titled "example.com is slow"; emails the owners added by owner rules (Dana Reyes)',
    );
    expect(text).toContain(
      "an on-call policy the person may not read (paging is set up, and who is hidden), named by the criteria",
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
  [WhoIsToldOwnersSource.ProjectOwners, "the Project Owners"],
  [WhoIsToldOwnersSource.MonitorOwners, "the monitor's owners"],
];

const OPENS: string =
  '  - opens an incident (Critical Incident) titled "example.com is offline"; emails ';
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
      "    - no on-call rule matches",
      "    - pages nobody: no on-call rule runs a policy for it",
      "Nothing breaks the chain.",
    ]);
    // Never the project's owners, nor a guess about whether a rule adds anyone.
    expect(lines.join("\n")).not.toContain("the Project Owners");
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
      `${OPENS}the Project Owners (Me Myself, Ana Lopez)`,
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
    ).toContain(`${STATUS}the Project Owners (Me Myself) of the change`);
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

  /*
   * AN OWNER THE PAGE REACHES FIRST (#8860). The owners' Created email
   * leaves out an owner the record's on-call page reached already (#7987):
   * the model is told whom the email still reaches, and who is paged
   * instead - so Ask AI never says Ana is emailed when only the page tells
   * her.
   */
  test("an owner the on-call page reaches first is said not to be emailed as an owner too", () => {
    expect(
      linesOf(
        opening({
          source: WhoIsToldOwnersSource.Named,
          userNames: ["Ben Ito"],
          teamNames: ["Checkout SRE"],
          pagedOwners: [{ userId: "u2", name: "Ana Lopez" }],
        }),
      ),
    ).toContain(
      `${OPENS}its owners (Ben Ito, team Checkout SRE) - not Ana Lopez, whom the on-call page reaches first, so is not emailed as an owner too`,
    );
  });

  test("several owners the page reaches first are said together", () => {
    expect(
      linesOf(
        opening({
          source: WhoIsToldOwnersSource.OwnerRules,
          userNames: ["Dana Reyes"],
          teamNames: [],
          pagedOwners: [
            { userId: "u2", name: "Ana Lopez" },
            { userId: "u3", name: "Ben Ito" },
          ],
        }),
      ),
    ).toContain(
      `${OPENS}the owners added by owner rules (Dana Reyes) - not Ana Lopez, Ben Ito, whom the on-call page reaches first, so are not emailed as owners too`,
    );
  });

  test("the one-person project, its owner paged: nobody is emailed as an owner, and why", () => {
    expect(
      linesOf(
        opening({
          source: WhoIsToldOwnersSource.ProjectOwners,
          userNames: [],
          teamNames: [],
          pagedOwners: [{ userId: "u1", name: "Me Myself" }],
        }),
      ),
    ).toContain(
      `${OPENS}nobody as an owner: Me Myself, whom the on-call page reaches first, so is not emailed as a Project Owner too`,
    );
  });

  test("through redactWhoIsTold: whom the page reaches first is worked out from the policies the person may read, and nobody's address list reaches the model", () => {
    const owners: WhoIsToldOwners = {
      source: WhoIsToldOwnersSource.ProjectOwners,
      userNames: ["Me Myself"],
      teamNames: [],
      recipients: [
        { userId: "u1", name: "Me Myself", isNamed: true, teamNames: [] },
      ],
    };
    const paging: WhoIsToldResult = {
      ...opening(owners),
      criteria: [
        {
          ...opening(owners).criteria[0]!,
          events: [
            {
              ...opening(owners).criteria[0]!.events[0]!,
              rules: [
                { id: "r1", name: "Page Default for every new incident" },
              ],
              policies: [
                {
                  ...RESULT.criteria[0]!.events[0]!.policies[0]!,
                  pagesAtOnce: true,
                  people: [
                    {
                      userId: "u1",
                      name: "Me Myself",
                      channels: [OnCallPageChannel.Email],
                      channelsAtOnce: [OnCallPageChannel.Email],
                      isFallback: true,
                      isReachable: true,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const readable: string = describeWhoIsToldForModel(
      redactWhoIsTold({
        result: paging,
        readablePolicyIds: new Set<string>(["p1"]),
        readableRuleIds: new Set<string>(["r1"]),
        readableOwnerRuleIds: new Set<string>(),
        readableStatusPageIds: new Set<string>(),
      }),
    );
    const hidden: string = describeWhoIsToldForModel(
      redactWhoIsTold({
        result: paging,
        readablePolicyIds: new Set<string>(),
        readableRuleIds: new Set<string>(["r1"]),
        readableOwnerRuleIds: new Set<string>(),
        readableStatusPageIds: new Set<string>(),
      }),
    );

    expect(readable.split("\n")).toContain(
      `${OPENS}nobody as an owner: Me Myself, whom the on-call page reaches first, so is not emailed as a Project Owner too`,
    );
    // A policy the person may not read says nothing of whom it pages.
    expect(hidden.split("\n")).toContain(
      `${OPENS}the Project Owners (Me Myself)`,
    );
    expect(hidden).not.toContain("reaches first");
  });

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
      lines.indexOf(
        '  - opens an alert (High) titled "example.com is offline"; emails its owners (Ben Ito)',
      ),
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

/*
 * WHAT THE CARD SHOWS AND THE MODEL WAS NOT TOLD (#7525): the title an
 * incident or alert opens with, which the on-call rules are matched on; the
 * on-call rules that match, and which of them runs each policy; and why a
 * person can't be paged, in the card's words rather than the problem's code.
 */

// A criteria that opens one event with these rules, policies and title.
function openingWith(data: {
  title?: string;
  rules?: Array<WhoIsToldRule>;
  policies?: WhoIsToldResult["criteria"][number]["events"][number]["policies"];
}): WhoIsToldResult {
  return {
    ...RESULT,
    criteria: [
      {
        id: "c6",
        name: "Check if offline",
        events: [
          {
            kind: OnCallTestPageRecordKind.Incident,
            title: data.title ?? "example.com is offline",
            severityName: "Critical",
            owners: {
              source: WhoIsToldOwnersSource.ProjectOwners,
              userNames: [],
              teamNames: [],
            },
            ownerRules: [],
            rules: data.rules || [],
            policies: data.policies || [],
            statusPages: [],
          },
        ],
      },
    ],
    breaks: [],
  };
}

const DEFAULT_POLICY: WhoIsToldResult["criteria"][number]["events"][number]["policies"][number] =
  {
    id: "p1",
    name: "Default",
    isHidden: false,
    isNamedByCriteria: false,
    ruleIds: [],
    levelCount: 1,
    people: [],
    notPaged: [],
  };

function unreachable(
  problem: WhoIsToldPersonProblem,
  name: string = "Ana Lopez",
): WhoIsToldResult {
  return openingWith({
    rules: [{ id: "r1", name: "Page Default for every new incident" }],
    policies: [
      {
        ...DEFAULT_POLICY,
        ruleIds: ["r1"],
        people: [
          {
            userId: "u2",
            name: name,
            reachedThrough: "Team Platform",
            channels: [],
            isFallback: false,
            isReachable: false,
            problem: problem,
          },
        ],
      },
    ],
  });
}

describe("describeWhoIsToldForModel: the title, the on-call rules, and why someone can't be paged (#7525)", () => {
  test("the event's line says the title it opens with, quoted, which the rules are matched on", () => {
    expect(linesOf(openingWith({}))).toContain(
      '  - opens an incident (Critical) titled "example.com is offline"; emails the Project Owners',
    );
  });

  test("an event with no title says none, never an empty pair of quotes", () => {
    const text: string = describeWhoIsToldForModel(openingWith({ title: "" }));

    expect(text.split("\n")).toContain(
      "  - opens an incident (Critical); emails the Project Owners",
    );
    expect(text).not.toContain("titled");
    expect(text).not.toContain('""');
  });

  test("the on-call rule that matches is named under the event", () => {
    expect(
      linesOf(
        openingWith({
          rules: [{ id: "r1", name: "Page Default for every new incident" }],
        }),
      ),
    ).toContain(
      '    - on-call rules that match: "Page Default for every new incident"',
    );
  });

  test("several rules that match are named in the order they match", () => {
    expect(
      linesOf(
        openingWith({
          rules: [
            { id: "r1", name: "Page Default for every new incident" },
            { id: "r2", name: "Checkout to Payments" },
          ],
        }),
      ),
    ).toContain(
      '    - on-call rules that match: "Page Default for every new incident", "Checkout to Payments"',
    );
  });

  test("no rule that matches is said, as the card's None match", () => {
    const lines: Array<string> = linesOf(openingWith({}));

    expect(lines).toContain("    - no on-call rule matches");
    expect(lines.join("\n")).not.toContain("on-call rules that match");
  });

  test("each policy says what runs it: the rules of the event by name, and the criteria that names it", () => {
    const lines: Array<string> = linesOf(
      openingWith({
        rules: [
          { id: "r1", name: "Page Default for every new incident" },
          { id: "r2", name: "Checkout to Payments" },
        ],
        policies: [
          { ...DEFAULT_POLICY, ruleIds: ["r1", "r2"] },
          {
            ...DEFAULT_POLICY,
            id: "p2",
            name: "Payments",
            isNamedByCriteria: true,
            ruleIds: ["r2"],
          },
          {
            ...DEFAULT_POLICY,
            id: "p3",
            name: "Named only",
            isNamedByCriteria: true,
          },
        ],
      }),
    );

    expect(lines).toContain(
      '    - pages on-call policy "Default" (1 escalation level), run by "Page Default for every new incident", "Checkout to Payments", whose first level pages: nobody right now',
    );
    expect(lines).toContain(
      '    - pages on-call policy "Payments" (1 escalation level), named by the criteria and run by "Checkout to Payments", whose first level pages: nobody right now',
    );
    expect(lines).toContain(
      '    - pages on-call policy "Named only" (1 escalation level), named by the criteria, whose first level pages: nobody right now',
    );
  });

  /*
   * The rules line is new text the model reads: held to the resolver's own
   * redaction (getForMonitor hands the tool redactWhoIsTold's answer). A rule
   * the person may not read keeps its place, on the rules line and on the
   * line of the policy it runs, and never reaches the model by name.
   */
  test("through redactWhoIsTold, an on-call rule the person may not read is never named, on the rules line or a policy's", () => {
    const text: string = describeWhoIsToldForModel(
      redactWhoIsTold({
        result: openingWith({
          rules: [
            { id: "r1", name: "Secret night rule" },
            { id: "r2", name: "Checkout to Payments" },
          ],
          policies: [
            { ...DEFAULT_POLICY, ruleIds: ["r1"] },
            { ...DEFAULT_POLICY, id: "p2", name: "Hidden", ruleIds: ["r2"] },
          ],
        }),
        readablePolicyIds: new Set<string>(["p1"]),
        readableRuleIds: new Set<string>(["r2"]),
        readableOwnerRuleIds: new Set<string>(),
        readableStatusPageIds: new Set<string>(),
      }),
    );
    const lines: Array<string> = text.split("\n");

    expect(text).not.toContain("Secret");
    expect(text).not.toContain('""');
    expect(lines).toContain(
      '    - on-call rules that match: an on-call rule the person may not read, "Checkout to Payments"',
    );
    expect(lines).toContain(
      '    - pages on-call policy "Default" (1 escalation level), run by an on-call rule the person may not read, whose first level pages: nobody right now',
    );
    // A policy the person may not read is named by nothing of its own.
    expect(lines).toContain(
      '    - pages an on-call policy the person may not read (paging is set up, and who is hidden), run by "Checkout to Payments"',
    );
    expect(text).not.toContain('"Hidden"');
  });

  test.each(Object.values(WhoIsToldPersonProblem))(
    "%s: why the person can't be paged is said in words, never as its code",
    (problem: WhoIsToldPersonProblem) => {
      const text: string = describeWhoIsToldForModel(unreachable(problem));
      const line: string | undefined = text
        .split("\n")
        .find((item: string): boolean => {
          return item.includes("Ana Lopez (Team Platform): ");
        });

      expect(line).toBeDefined();
      expect(line).toContain(
        "Ana Lopez (Team Platform): can't be paged, because Ana Lopez ",
      );
      for (const code of Object.values(WhoIsToldPersonProblem)) {
        expect(text).not.toContain(code);
      }
    },
  );

  test("every problem WhoIsTold defines is worded, and no two alike", () => {
    const problems: Array<WhoIsToldPersonProblem> = Object.values(
      WhoIsToldPersonProblem,
    );
    const said: Array<string> = problems.map(
      (problem: WhoIsToldPersonProblem): string => {
        const line: string =
          linesOf(unreachable(problem)).find((item: string): boolean => {
            return item.includes("can't be paged, because ");
          }) || "";

        return line.slice(
          line.indexOf("can't be paged, because Ana Lopez ") +
            "can't be paged, because Ana Lopez ".length,
        );
      },
    );

    expect(problems).toHaveLength(4);
    for (const words of said) {
      expect(words.length).toBeGreaterThan(10);
    }
    expect(new Set(said).size).toBe(problems.length);
  });

  test("a person with no name is said as someone, never as an empty name", () => {
    expect(
      describeWhoIsToldForModel(
        unreachable(WhoIsToldPersonProblem.OptedOut, ""),
      ),
    ).toContain(
      "someone (Team Platform): can't be paged, because someone opted out of pages of this severity",
    );
  });
});

/*
 * WHAT THE CARD NOW SAYS, ASK AI SAYS TOO: a private record and whether it
 * is the person's to see (#7213), the label rules that change who is paged
 * (#7212), the monitor group a status page shows it through (#7214), the
 * incident an alert's incident rule declares (#7216), and the owners no
 * Created email reaches (#7572).
 */
describe("describeWhoIsToldForModel: privacy, label and incident rules, groups and owners not emailed", () => {
  const OWNERS: WhoIsToldOwners = {
    source: WhoIsToldOwnersSource.ProjectOwners,
    userNames: ["Me Myself"],
    teamNames: [],
  };

  function withEvent(event: Partial<WhoIsToldEvent>): WhoIsToldResult {
    const result: WhoIsToldResult = opening(OWNERS);
    result.criteria[0]!.events[0] = {
      ...result.criteria[0]!.events[0]!,
      ...event,
    };
    return result;
  }

  test("a private record the person may not see: what opens and that it is private, nothing of whom it tells", () => {
    const lines: Array<string> = linesOf(
      redactWhoIsTold({
        result: withEvent({
          isPrivate: true,
          privacyRules: [
            { id: "pr1", name: "Payments are private" },
            { id: "pr2", name: "Secret rule" },
          ],
          ownerRules: [{ id: "o1", name: "Payments owners" }],
        }),
        readablePolicyIds: new Set<string>(),
        readableRuleIds: new Set<string>(),
        readableOwnerRuleIds: new Set<string>(["o1"]),
        readableStatusPageIds: new Set<string>(),
        readablePrivacyRuleIds: new Set<string>(["pr1"]),
      }),
    );

    expect(lines).toContain(
      '  - opens an incident (Critical Incident) that is private and not the person\'s to see, so who it tells is not shown to them; made private by "Payments are private", a privacy rule the person may not read',
    );
    expect(lines.join("\n")).not.toContain("Payments owners");
    expect(lines.join("\n")).not.toContain("Me Myself)");
    expect(lines.join("\n")).not.toContain("Secret rule");
  });

  test("a private record the person may see says so, and why it is on no status page", () => {
    expect(
      linesOf(
        withEvent({
          isPrivate: true,
          privacyRules: [{ id: "pr1", name: "Payments are private" }],
        }),
      ),
    ).toContain(
      '    - is private (made private by "Payments are private"): it shows on no status page and tells no subscriber, and only its owners, Project Owners and Project Admins can see it',
    );
    expect(linesOf(withEvent({ isPrivate: true, privacyRules: [] }))).toContain(
      "    - is private (the criteria makes it private): it shows on no status page and tells no subscriber, and only its owners, Project Owners and Project Admins can see it",
    );
  });

  test("the label rules whose labels decide which on-call rules page it", () => {
    expect(
      linesOf(
        withEvent({
          labelRules: [
            { id: "l1", name: "Tag payments" },
            { id: "l2", name: "" },
          ],
        }),
      ),
    ).toContain(
      '    - label rules whose labels decide which on-call rules page it: "Tag payments", a label rule the person may not read',
    );
  });

  test("the monitor group a status page shows the monitor through, by name as the person may read it", () => {
    expect(
      linesOf(
        withEvent({
          statusPages: [
            {
              id: "s1",
              name: "Acme Status",
              groups: [
                { id: "g1", name: "Checkout" },
                { id: "g2", name: "" },
              ],
            },
            { id: "s2", name: "Ops Status", groups: [] },
          ],
        }),
      ),
    ).toContain(
      '    - shows on status pages: "Acme Status" (through monitor group "Checkout", a monitor group the person may not read), "Ops Status"',
    );
  });

  test("the incident an alert incident rule declares is said as any incident, under the alert", () => {
    const lines: Array<string> = linesOf(
      withEvent({
        kind: OnCallTestPageRecordKind.Alert,
        severityName: "Warning",
        declares: {
          rule: { id: "ai1", name: "Lasting alerts" },
          waitInMinutes: 15,
          incident: {
            kind: OnCallTestPageRecordKind.Incident,
            title: "example.com is offline",
            severityName: "Critical Incident",
            owners: OWNERS,
            ownerRules: [],
            rules: [],
            policies: [],
            statusPages: [{ id: "s1", name: "Acme Status" }],
          },
        },
      }),
    );

    const at: number = lines.indexOf(
      '    - alert incident rule "Lasting alerts" turns it into an incident once it has stayed open 15 minutes, which:',
    );

    expect(at).toBeGreaterThan(0);
    expect(lines.slice(at + 1)).toEqual([
      '      - opens an incident (Critical Incident) titled "example.com is offline"; emails the Project Owners (Me Myself)',
      "        - no on-call rule matches",
      "        - pages nobody: no on-call rule runs a policy for it",
      '        - shows on status pages: "Acme Status"',
      "Nothing breaks the chain.",
    ]);
  });

  test("owners no Created email reaches, why, and what named them - never a person who is not a member by name", () => {
    expect(
      linesOf(
        withEvent({
          owners: {
            ...OWNERS,
            notReached: [
              {
                kind: WhoIsToldOwnerKind.User,
                id: "u9",
                name: "",
                problem: WhoIsToldOwnerProblem.NotInProject,
                addedBy: WhoIsToldOwnerAddedBy.Criteria,
              },
              {
                kind: WhoIsToldOwnerKind.Team,
                id: "t1",
                name: "Night Shift",
                problem: WhoIsToldOwnerProblem.TeamHasNobodyInProject,
                addedBy: WhoIsToldOwnerAddedBy.OwnerRule,
                rule: { id: "o1", name: "Payments owners" },
              },
              {
                kind: WhoIsToldOwnerKind.Team,
                id: "t2",
                name: "",
                problem: WhoIsToldOwnerProblem.TeamOfAnotherProject,
                addedBy: WhoIsToldOwnerAddedBy.NetworkDevice,
              },
            ],
          },
        }),
      ),
    ).toContain(
      '    - not emailed, as no Created email can reach them: a person who is not a member of the project (named by the criteria); team "Night Shift", which has nobody in it who is a member of the project (added by owner rule "Payments owners"); a team of another project (an owner of the network device the monitor watches)',
    );
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
