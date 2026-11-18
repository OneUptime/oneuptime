import {
  countTickedKeys,
  getDefaultToolImportSelection,
  getInitialInviteTeamId,
  getLeftOutReferences,
  getOtherRunningImport,
  getSelectedKeys,
  getToolImportItemsByKey,
  getToolImportPlanSections,
  getToolImportReportRecords,
  getToolImportReportSections,
  hasTickedInvites,
  isToolImportRunInFlight,
  isToolImportRunWorking,
  pickToolImportRunToShow,
  setToolImportKeys,
  ToolImportPlanSection,
  ToolImportReportSection,
} from "../../FeatureSet/Dashboard/src/Components/ToolImport/ToolImportPlanView";
import {
  ToolImportAction,
  ToolImportOutcome,
  ToolImportPlan,
  ToolImportPlanItem,
  ToolImportReport,
  ToolImportReportItem,
} from "Common/Types/ToolImport/ToolImportPlan";
import ToolImportResourceKind, {
  getToolImportItemKey,
} from "Common/Types/ToolImport/ToolImportResourceKind";
import ToolImportRunStatus from "Common/Types/ToolImport/ToolImportRunStatus";
import ToolImportSource from "Common/Types/ToolImport/ToolImportSource";
import { describe, expect, test } from "@jest/globals";

/*
 * What the preview shows and what ticking does, worked out apart from React:
 * the sections in the order OneUptime builds them, what starts ticked, what
 * a ticked item uses that will not come over, the keys a start sends, and
 * which run the page opens on.
 */

function item(
  kind: ToolImportResourceKind,
  sourceId: string,
  name: string,
  data: Partial<ToolImportPlanItem> = {},
): ToolImportPlanItem {
  return {
    key: getToolImportItemKey(kind, sourceId),
    kind,
    sourceId,
    name,
    action: ToolImportAction.Create,
    notes: [],
    isSelectable: true,
    isSelectedByDefault: true,
    summary: {},
    references: [],
    ...data,
  };
}

const ALICE: ToolImportPlanItem = item(
  ToolImportResourceKind.Person,
  "alice",
  "Alice",
  { action: ToolImportAction.Invite },
);
const BOB: ToolImportPlanItem = item(
  ToolImportResourceKind.Person,
  "bob",
  "Bob",
  {
    action: ToolImportAction.Match,
    isSelectable: false,
    isSelectedByDefault: false,
  },
);
const CAROL: ToolImportPlanItem = item(
  ToolImportResourceKind.Person,
  "carol",
  "Carol",
  { action: ToolImportAction.Invite, isSelectedByDefault: false },
);
const DAN: ToolImportPlanItem = item(
  ToolImportResourceKind.Person,
  "dan",
  "Dan",
  {
    action: ToolImportAction.Skip,
    isSelectable: false,
    isSelectedByDefault: false,
  },
);
const PLATFORM: ToolImportPlanItem = item(
  ToolImportResourceKind.Team,
  "platform",
  "Platform",
  {
    references: [
      ALICE.key,
      BOB.key,
      CAROL.key,
      DAN.key,
      CAROL.key,
      "Person:gone",
    ],
  },
);
const PRIMARY: ToolImportPlanItem = item(
  ToolImportResourceKind.OnCallSchedule,
  "primary",
  "Primary",
);
const OLD_ROTA: ToolImportPlanItem = item(
  ToolImportResourceKind.OnCallSchedule,
  "old",
  "Old rota",
  {
    action: ToolImportAction.AlreadyImported,
    isSelectable: false,
    isSelectedByDefault: false,
  },
);
const ESCALATION: ToolImportPlanItem = item(
  ToolImportResourceKind.OnCallPolicy,
  "esc",
  "Escalation",
  { references: [PRIMARY.key, PLATFORM.key] },
);

const PLAN: ToolImportPlan = {
  source: ToolImportSource.OpsGenie,
  readAt: "2026-10-08T10:00:00.000Z",
  // Listed in an order the page must not keep.
  items: [ESCALATION, OLD_ROTA, PRIMARY, DAN, BOB, PLATFORM, CAROL, ALICE],
  inviteTeams: [
    { id: "team-a", name: "Platform Engineers" },
    { id: "team-members", name: "Members" },
  ],
  defaultInviteTeamId: "team-members",
  notes: [],
};

describe("the preview's sections", () => {
  const sections: Array<ToolImportPlanSection> =
    getToolImportPlanSections(PLAN);

  test("come in the order OneUptime builds them, empty kinds left out", () => {
    expect(
      sections.map((section: ToolImportPlanSection) => {
        return section.kind;
      }),
    ).toEqual([
      ToolImportResourceKind.Person,
      ToolImportResourceKind.Team,
      ToolImportResourceKind.OnCallSchedule,
      ToolImportResourceKind.OnCallPolicy,
    ]);
  });

  test("list what would be created first, then what is in OneUptime, imported before and left out, each by name", () => {
    expect(
      sections[0]!.items.map((planItem: ToolImportPlanItem) => {
        return planItem.name;
      }),
    ).toEqual(["Alice", "Carol", "Bob", "Dan"]);
    expect(
      sections[2]!.items.map((planItem: ToolImportPlanItem) => {
        return planItem.name;
      }),
    ).toEqual(["Primary", "Old rota"]);
  });

  test("know which of their items can be ticked, and count each action", () => {
    expect(sections[0]!.selectableKeys).toEqual([ALICE.key, CAROL.key]);
    expect(sections[0]!.actionCounts).toEqual({
      [ToolImportAction.Create]: 0,
      [ToolImportAction.Invite]: 2,
      [ToolImportAction.Match]: 1,
      [ToolImportAction.AlreadyImported]: 0,
      [ToolImportAction.Skip]: 1,
    });
  });
});

describe("ticking", () => {
  test("starts from what the plan ticks, and only from what can be ticked", () => {
    expect([...getDefaultToolImportSelection(PLAN)].sort()).toEqual(
      [ALICE.key, ESCALATION.key, PLATFORM.key, PRIMARY.key].sort(),
    );
  });

  test("ticks and unticks into a new set, leaving the old one as it was", () => {
    const before: Set<string> = new Set<string>([ALICE.key]);
    const after: Set<string> = setToolImportKeys(
      before,
      [CAROL.key, ALICE.key],
      true,
    );
    const cleared: Set<string> = setToolImportKeys(after, [ALICE.key], false);

    expect([...before]).toEqual([ALICE.key]);
    expect([...after].sort()).toEqual([ALICE.key, CAROL.key].sort());
    expect([...cleared]).toEqual([CAROL.key]);
    expect(countTickedKeys([ALICE.key, CAROL.key, BOB.key], after)).toBe(2);
  });

  test("sends only keys that can be ticked, in the plan's order", () => {
    const selection: Set<string> = new Set<string>([
      PRIMARY.key,
      BOB.key,
      ALICE.key,
      "Person:nobody",
    ]);

    expect(getSelectedKeys(PLAN, selection)).toEqual([PRIMARY.key, ALICE.key]);
  });

  test("knows when somebody ticked will be invited", () => {
    expect(hasTickedInvites(PLAN, new Set<string>([PLATFORM.key]))).toBe(false);
    expect(hasTickedInvites(PLAN, new Set<string>([CAROL.key]))).toBe(true);
  });
});

describe("what a ticked item uses that will not come over", () => {
  const itemsByKey: Map<string, ToolImportPlanItem> =
    getToolImportItemsByKey(PLAN);

  test("is what is left unticked and what cannot come over, once each, never what OneUptime already has", () => {
    const leftOut: Array<ToolImportPlanItem> = getLeftOutReferences({
      item: PLATFORM,
      itemsByKey,
      selection: new Set<string>([PLATFORM.key, ALICE.key]),
    });

    expect(
      leftOut.map((planItem: ToolImportPlanItem) => {
        return planItem.name;
      }),
    ).toEqual(["Carol", "Dan"]);
  });

  test("is nothing once everything it uses is ticked or in OneUptime", () => {
    expect(
      getLeftOutReferences({
        item: ESCALATION,
        itemsByKey,
        selection: new Set<string>([PRIMARY.key, PLATFORM.key]),
      }),
    ).toEqual([]);
    expect(
      getLeftOutReferences({
        item: ESCALATION,
        itemsByKey,
        selection: new Set<string>([PLATFORM.key]),
      }),
    ).toEqual([PRIMARY]);
  });
});

describe("the team new people are invited to", () => {
  test("is the plan's pick when it is one of the teams offered", () => {
    expect(getInitialInviteTeamId(PLAN)).toBe("team-members");
  });

  test("is the first team offered when the plan picked none, or one not offered", () => {
    expect(getInitialInviteTeamId({ ...PLAN, defaultInviteTeamId: null })).toBe(
      "team-a",
    );
    expect(
      getInitialInviteTeamId({ ...PLAN, defaultInviteTeamId: "elsewhere" }),
    ).toBe("team-a");
  });

  test("is none when no team is offered", () => {
    expect(getInitialInviteTeamId({ ...PLAN, inviteTeams: [] })).toBeNull();
  });
});

describe("the report's sections", () => {
  function reportItem(
    kind: ToolImportResourceKind,
    name: string,
    outcome: ToolImportOutcome,
  ): ToolImportReportItem {
    return {
      key: getToolImportItemKey(kind, name),
      kind,
      sourceId: name,
      name,
      outcome,
      recordIds: [],
      notes: [],
    };
  }

  test("follow the import's order, failures first in each, then what was created, then the rest", () => {
    const sections: Array<ToolImportReportSection> =
      getToolImportReportSections({
        items: [
          reportItem(
            ToolImportResourceKind.OnCallPolicy,
            "B policy",
            ToolImportOutcome.Created,
          ),
          reportItem(
            ToolImportResourceKind.Person,
            "Zed",
            ToolImportOutcome.Skipped,
          ),
          reportItem(
            ToolImportResourceKind.OnCallPolicy,
            "A policy",
            ToolImportOutcome.Failed,
          ),
          reportItem(
            ToolImportResourceKind.Person,
            "Amy",
            ToolImportOutcome.Matched,
          ),
          reportItem(
            ToolImportResourceKind.Person,
            "Bea",
            ToolImportOutcome.Invited,
          ),
        ],
      });

    expect(
      sections.map((section: ToolImportReportSection) => {
        return [
          section.kind,
          section.items.map((reported: ToolImportReportItem) => {
            return reported.name;
          }),
        ];
      }),
    ).toEqual([
      [ToolImportResourceKind.Person, ["Bea", "Amy", "Zed"]],
      [ToolImportResourceKind.OnCallPolicy, ["A policy", "B policy"]],
    ]);
  });
});

/*
 * What the report's next steps act on (#7032): the on-call policies a test
 * page can page, the status pages whose addresses it shows. A record the
 * import left in OneUptime, created or found, each once; never an item that
 * failed or was not brought over.
 */
describe("the records the report's next steps act on", () => {
  const ID_A: string = "5a000000-0000-4000-8000-0000000000a1";
  const ID_B: string = "5a000000-0000-4000-8000-0000000000b2";
  const ID_C: string = "5a000000-0000-4000-8000-0000000000c3";
  const ID_D: string = "5a000000-0000-4000-8000-0000000000d4";

  function reported(
    kind: ToolImportResourceKind,
    name: string,
    outcome: ToolImportOutcome,
    recordIds: Array<string>,
  ): ToolImportReportItem {
    return {
      key: getToolImportItemKey(kind, name),
      kind,
      sourceId: name,
      name,
      outcome,
      recordIds,
      notes: [],
    };
  }

  const POLICY: ToolImportResourceKind = ToolImportResourceKind.OnCallPolicy;

  test("created first, then found, each by name", () => {
    expect(
      getToolImportReportRecords(
        {
          items: [
            reported(POLICY, "Delta", ToolImportOutcome.AlreadyImported, [
              ID_D,
            ]),
            reported(POLICY, "Charlie", ToolImportOutcome.Matched, [ID_C]),
            reported(POLICY, "Bravo", ToolImportOutcome.Created, [ID_B]),
            reported(POLICY, "Alpha", ToolImportOutcome.Created, [ID_A]),
          ],
        },
        POLICY,
      ),
    ).toEqual([
      { id: ID_A, name: "Alpha" },
      { id: ID_B, name: "Bravo" },
      { id: ID_C, name: "Charlie" },
      { id: ID_D, name: "Delta" },
    ]);
  });

  test("an item that failed, was skipped or invited names no record of the kind", () => {
    expect(
      getToolImportReportRecords(
        {
          items: [
            reported(POLICY, "Failed", ToolImportOutcome.Failed, [ID_A]),
            reported(POLICY, "Skipped", ToolImportOutcome.Skipped, []),
            reported(POLICY, "Invited", ToolImportOutcome.Invited, [ID_B]),
            reported(POLICY, "Kept", ToolImportOutcome.Created, [ID_C]),
          ],
        },
        POLICY,
      ),
    ).toEqual([{ id: ID_C, name: "Kept" }]);
  });

  test("a record two items name is listed once, by the first", () => {
    expect(
      getToolImportReportRecords(
        {
          items: [
            reported(POLICY, "Second", ToolImportOutcome.Matched, [ID_A]),
            reported(POLICY, "First", ToolImportOutcome.Created, [ID_A]),
          ],
        },
        POLICY,
      ),
    ).toEqual([{ id: ID_A, name: "First" }]);
  });

  test("only the kind asked for, and only an id that is one", () => {
    const report: ToolImportReport = {
      items: [
        reported(
          ToolImportResourceKind.StatusPage,
          "Acme Status",
          ToolImportOutcome.Created,
          [ID_A],
        ),
        reported(POLICY, "Primary", ToolImportOutcome.Created, [ID_B]),
        reported(POLICY, "Odd", ToolImportOutcome.Created, ["not-an-id"]),
        reported(POLICY, "Nothing", ToolImportOutcome.Created, []),
      ],
    };

    expect(
      getToolImportReportRecords(report, ToolImportResourceKind.StatusPage),
    ).toEqual([{ id: ID_A, name: "Acme Status" }]);
    expect(getToolImportReportRecords(report, POLICY)).toEqual([
      { id: ID_B, name: "Primary" },
    ]);
    expect(
      getToolImportReportRecords(report, ToolImportResourceKind.Monitor),
    ).toEqual([]);
  });

  test("a schedule that became several is named by its first record", () => {
    expect(
      getToolImportReportRecords(
        {
          items: [
            reported(
              ToolImportResourceKind.OnCallSchedule,
              "Rota",
              ToolImportOutcome.Created,
              [ID_A, ID_B],
            ),
          ],
        },
        ToolImportResourceKind.OnCallSchedule,
      ),
    ).toEqual([{ id: ID_A, name: "Rota" }]);
  });

  test("an empty report has none", () => {
    expect(getToolImportReportRecords({ items: [] }, POLICY)).toEqual([]);
  });
});

describe("the run the page opens on", () => {
  const mine: { id: string; status: ToolImportRunStatus; isMine: boolean } = {
    id: "mine",
    status: ToolImportRunStatus.ReadyToReview,
    isMine: true,
  };
  const theirs: { id: string; status: ToolImportRunStatus; isMine: boolean } = {
    id: "theirs",
    status: ToolImportRunStatus.Importing,
    isMine: false,
  };
  const done: { id: string; status: ToolImportRunStatus; isMine: boolean } = {
    id: "done",
    status: ToolImportRunStatus.Completed,
    isMine: true,
  };

  test("is the one the address names, when the list has it", () => {
    expect(
      pickToolImportRunToShow({
        runs: [mine, done],
        requestedRunId: "done",
      }),
    ).toBe("done");
  });

  test("is otherwise the person's own run still in flight", () => {
    expect(
      pickToolImportRunToShow({
        runs: [done, theirs, mine],
        requestedRunId: "not-listed",
      }),
    ).toBe("mine");
  });

  test("is otherwise somebody else's run that is working now", () => {
    expect(
      pickToolImportRunToShow({ runs: [done, theirs], requestedRunId: null }),
    ).toBe("theirs");
  });

  test("is none when nothing is in flight: the page opens on the tool picker", () => {
    expect(
      pickToolImportRunToShow({ runs: [done], requestedRunId: null }),
    ).toBeNull();
  });

  test("somebody else's working run is the one a new import waits for", () => {
    expect(getOtherRunningImport([mine, done, theirs])).toBe(theirs);
    expect(getOtherRunningImport([mine, done])).toBeNull();
    expect(
      getOtherRunningImport([
        { ...theirs, status: ToolImportRunStatus.ReadyToReview },
      ]),
    ).toBeNull();
  });

  test("a run is asked about again while it reads or imports, and in flight until it ends", () => {
    expect(isToolImportRunWorking(ToolImportRunStatus.Reading)).toBe(true);
    expect(isToolImportRunWorking(ToolImportRunStatus.Importing)).toBe(true);
    expect(isToolImportRunWorking(ToolImportRunStatus.ReadyToReview)).toBe(
      false,
    );
    expect(isToolImportRunInFlight(ToolImportRunStatus.ReadyToReview)).toBe(
      true,
    );

    for (const status of [
      ToolImportRunStatus.Completed,
      ToolImportRunStatus.Failed,
      ToolImportRunStatus.Cancelled,
      ToolImportRunStatus.Expired,
    ]) {
      expect(isToolImportRunInFlight(status)).toBe(false);
      expect(isToolImportRunWorking(status)).toBe(false);
    }
  });
});
