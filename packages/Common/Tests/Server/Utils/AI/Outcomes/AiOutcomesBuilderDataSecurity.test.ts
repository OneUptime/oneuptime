import AiOutcomesBuilder, {
  AiOutcomesDataSecurityAnalysisRow,
  AiOutcomesDataSecurityProposalRow,
  AiOutcomesInput,
} from "../../../../../Server/Utils/AI/Outcomes/AiOutcomesBuilder";
import {
  AiOutcomes,
  AiOutcomesDataSecurity,
  AiOutcomesWeek,
  getDataSecurityChangesMadeCount,
} from "../../../../../Types/AI/AiOutcomes";
import {
  DataSecurityAiProposalKind,
  DataSecurityAiProposalStatus,
} from "../../../../../Types/DataSecurity/DataSecurityAi";
import { describe, expect, test } from "@jest/globals";

/*
 * AiOutcomesBuilder's Data Security part (#10364): what OneUptime AI did
 * about the project's Data Security issues, from the proposals that
 * settled in the window and the times it analyzed an issue. Pure, so every
 * rule is held here with plain rows:
 *
 *   - a change made counts in the week it was made, proven once the issue's
 *     own check passed after it, waiting until then, undone once a person
 *     took it back - proven before or not;
 *   - one that could not be made changed nothing: it is counted, but is no
 *     change of the week;
 *   - a person approved a proposal, or dismissed it; a change made without
 *     asking was approved by nobody;
 *   - an issue analyzed counts once, however often it was analyzed;
 *   - how long an issue took to pass its check is a median over issues,
 *     each counted once, from when it opened;
 *   - a caller who may not read the proposals gets null, never zeros, and
 *     one who may not read the analyses gets a null count of them.
 */

const DAY: number = 24 * 60 * 60 * 1000;
const WEEK: number = 7 * DAY;
const MINUTE: number = 60 * 1000;

// A Friday afternoon, UTC: the window's weeks start on Saturday 22 Aug.
const NOW: Date = new Date("2026-11-13T15:00:00.000Z");
const WINDOW_START: Date = new Date("2026-08-22T00:00:00.000Z");

const SCRUB: string = DataSecurityAiProposalKind.ScrubTelemetry;

// A moment inside week `index` of the window (half a day in, by default).
function inWeek(index: number, offset: number = DAY / 2): Date {
  return new Date(WINDOW_START.getTime() + index * WEEK + offset);
}

function build(overrides: Partial<AiOutcomesInput> = {}): AiOutcomes {
  return AiOutcomesBuilder.build({
    now: NOW,
    pageRows: null,
    remediationRows: null,
    pullRequestRows: null,
    investigationRows: null,
    isPartial: false,
    ...overrides,
  });
}

function dataSecurityOf(
  proposalRows: Array<AiOutcomesDataSecurityProposalRow>,
  analysisRows: Array<AiOutcomesDataSecurityAnalysisRow> | null = [],
): AiOutcomesDataSecurity {
  const outcomes: AiOutcomes = build({
    dataSecurityProposalRows: proposalRows,
    dataSecurityAnalysisRows: analysisRows,
  });

  expect(outcomes.dataSecurity).not.toBeNull();

  return outcomes.dataSecurity!;
}

function proposal(
  status: DataSecurityAiProposalStatus | string | undefined,
  overrides: Partial<AiOutcomesDataSecurityProposalRow> = {},
): AiOutcomesDataSecurityProposalRow {
  return {
    settledAt: inWeek(10),
    status,
    kind: SCRUB,
    ...overrides,
  };
}

function weekly(
  outcomes: AiOutcomes,
  count: "dataSecurityChangesProven" | "dataSecurityChangesMade",
): Array<number> {
  return outcomes.weeks.map((week: AiOutcomesWeek): number => {
    return week[count];
  });
}

// Twelve zeros with `value` at week `index`.
function onlyInWeek(index: number, value: number = 1): Array<number> {
  return Array.from({ length: 12 }, (_value: unknown, at: number): number => {
    return at === index ? value : 0;
  });
}

describe("a part the caller may not read is null; one with nothing in it is zeros", () => {
  test("no proposals read: no Data Security at all, analyses or not", () => {
    expect(build().dataSecurity).toBeNull();
    expect(
      build({
        dataSecurityProposalRows: null,
        dataSecurityAnalysisRows: [
          { createdAt: inWeek(3), dataSecurityIssueId: "issue-1" },
        ],
      }).dataSecurity,
    ).toBeNull();
  });

  test("proposals read, nothing in them: zeros, no kinds, no median", () => {
    expect(dataSecurityOf([])).toEqual({
      issuesAnalyzed: 0,
      changes: { proven: 0, waiting: 0, undone: 0, failed: 0 },
      proposals: { approved: 0, dismissed: 0 },
      kinds: [],
      medianMinutesToCheckPassed: null,
      issuesCheckPassed: 0,
    });
  });

  test("the analyses not read: their count is null, the rest still counted", () => {
    const dataSecurity: AiOutcomesDataSecurity = dataSecurityOf(
      [proposal(DataSecurityAiProposalStatus.AppliedWithoutAsking)],
      null,
    );

    expect(dataSecurity.issuesAnalyzed).toBeNull();
    expect(dataSecurity.changes.waiting).toBe(1);
  });

  test("every week has its Data Security counts, zeros with nothing to count", () => {
    for (const outcomes of [build(), build({ dataSecurityProposalRows: [] })]) {
      expect(weekly(outcomes, "dataSecurityChangesMade")).toEqual(
        onlyInWeek(-1),
      );
      expect(weekly(outcomes, "dataSecurityChangesProven")).toEqual(
        onlyInWeek(-1),
      );
    }
  });
});

describe("what came of each change", () => {
  test.each([
    [DataSecurityAiProposalStatus.Applied, undefined, "waiting"],
    [DataSecurityAiProposalStatus.Applied, inWeek(11), "proven"],
    [DataSecurityAiProposalStatus.AppliedWithoutAsking, undefined, "waiting"],
    [DataSecurityAiProposalStatus.AppliedWithoutAsking, inWeek(11), "proven"],
    // Taken back by a person: undone, whether the check had passed or not.
    [DataSecurityAiProposalStatus.Undone, undefined, "undone"],
    [DataSecurityAiProposalStatus.Undone, inWeek(11), "undone"],
    [DataSecurityAiProposalStatus.Failed, undefined, "failed"],
    // No change came of these.
    [DataSecurityAiProposalStatus.Dismissed, undefined, null],
    [DataSecurityAiProposalStatus.Proposed, undefined, null],
    [DataSecurityAiProposalStatus.Approved, undefined, null],
    [DataSecurityAiProposalStatus.Expired, undefined, null],
    ["SomethingNewer", inWeek(11), null],
    [undefined, undefined, null],
  ] as Array<[string | undefined, Date | undefined, string | null]>)(
    "%s, its check passed at %p: %p",
    (
      status: string | undefined,
      verifiedAt: Date | undefined,
      outcome: string | null,
    ) => {
      expect(
        AiOutcomesBuilder.getDataSecurityChangeOutcome({ status, verifiedAt }),
      ).toBe(outcome);
    },
  );

  test("a check passed at a moment that is no date is no proof", () => {
    expect(
      AiOutcomesBuilder.getDataSecurityChangeOutcome({
        status: DataSecurityAiProposalStatus.Applied,
        verifiedAt: new Date(Number.NaN),
      }),
    ).toBe("waiting");
  });

  test("counts each change once, under what came of it", () => {
    const dataSecurity: AiOutcomesDataSecurity = dataSecurityOf([
      proposal(DataSecurityAiProposalStatus.AppliedWithoutAsking, {
        verifiedAt: inWeek(11),
      }),
      proposal(DataSecurityAiProposalStatus.Applied, {
        verifiedAt: inWeek(11),
      }),
      proposal(DataSecurityAiProposalStatus.Applied),
      proposal(DataSecurityAiProposalStatus.Undone, { verifiedAt: inWeek(11) }),
      proposal(DataSecurityAiProposalStatus.Failed),
      proposal(DataSecurityAiProposalStatus.Failed),
      proposal(DataSecurityAiProposalStatus.Dismissed),
      proposal("SomethingNewer"),
    ]);

    expect(dataSecurity.changes).toEqual({
      proven: 2,
      waiting: 1,
      undone: 1,
      failed: 2,
    });
    // Made: proven, waiting and undone - not the two that changed nothing.
    expect(getDataSecurityChangesMadeCount(dataSecurity.changes)).toBe(4);
  });
});

describe("what people did with the proposals", () => {
  test.each([
    [DataSecurityAiProposalStatus.Applied, true, "approved"],
    [DataSecurityAiProposalStatus.Undone, true, "approved"],
    // Approved, and making it failed: still approved.
    [DataSecurityAiProposalStatus.Failed, true, "approved"],
    [DataSecurityAiProposalStatus.Dismissed, false, "dismissed"],
    [DataSecurityAiProposalStatus.Dismissed, true, "dismissed"],
    // Made without asking: nobody approved it.
    [DataSecurityAiProposalStatus.AppliedWithoutAsking, false, null],
    [DataSecurityAiProposalStatus.Failed, false, null],
    [DataSecurityAiProposalStatus.Undone, false, null],
    // Approved and still being made: no change yet, so not counted yet.
    [DataSecurityAiProposalStatus.Approved, true, null],
    [DataSecurityAiProposalStatus.Proposed, false, null],
    [DataSecurityAiProposalStatus.Expired, false, null],
  ] as Array<[string, boolean, string | null]>)(
    "%s, approved by a person: %p - %p",
    (status: string, isApprovedByPerson: boolean, outcome: string | null) => {
      expect(
        AiOutcomesBuilder.getDataSecurityProposalOutcome({
          status,
          isApprovedByPerson,
        }),
      ).toBe(outcome);
    },
  );

  test("counts the proposals approved and the ones dismissed, beside the changes", () => {
    const dataSecurity: AiOutcomesDataSecurity = dataSecurityOf([
      proposal(DataSecurityAiProposalStatus.Applied, {
        isApprovedByPerson: true,
        verifiedAt: inWeek(11),
      }),
      proposal(DataSecurityAiProposalStatus.Failed, {
        isApprovedByPerson: true,
      }),
      proposal(DataSecurityAiProposalStatus.AppliedWithoutAsking),
      proposal(DataSecurityAiProposalStatus.Dismissed),
      proposal(DataSecurityAiProposalStatus.Dismissed),
      proposal(DataSecurityAiProposalStatus.Dismissed),
    ]);

    expect(dataSecurity.proposals).toEqual({ approved: 2, dismissed: 3 });
    expect(dataSecurity.changes).toEqual({
      proven: 1,
      waiting: 1,
      undone: 0,
      failed: 1,
    });
  });
});

describe("the week each counts in", () => {
  test("a change in the week it settled: its proof in that week too, however long the check took", () => {
    const outcomes: AiOutcomes = build({
      dataSecurityProposalRows: [
        // Made in week 2, proven in week 9.
        proposal(DataSecurityAiProposalStatus.AppliedWithoutAsking, {
          settledAt: inWeek(2),
          verifiedAt: inWeek(9),
        }),
        proposal(DataSecurityAiProposalStatus.Applied, {
          settledAt: inWeek(2),
        }),
        proposal(DataSecurityAiProposalStatus.Undone, {
          settledAt: inWeek(5),
        }),
      ],
    });

    expect(weekly(outcomes, "dataSecurityChangesMade")).toEqual(
      onlyInWeek(2, 2).map((value: number, index: number): number => {
        return index === 5 ? 1 : value;
      }),
    );
    expect(weekly(outcomes, "dataSecurityChangesProven")).toEqual(
      onlyInWeek(2, 1),
    );
  });

  test("a change that could not be made, and a proposal dismissed, are no change of their week", () => {
    const outcomes: AiOutcomes = build({
      dataSecurityProposalRows: [
        proposal(DataSecurityAiProposalStatus.Failed, { settledAt: inWeek(4) }),
        proposal(DataSecurityAiProposalStatus.Dismissed, {
          settledAt: inWeek(4),
        }),
      ],
    });

    expect(weekly(outcomes, "dataSecurityChangesMade")).toEqual(onlyInWeek(-1));
    expect(outcomes.dataSecurity!.changes.failed).toBe(1);
    expect(outcomes.dataSecurity!.proposals.dismissed).toBe(1);
  });

  test("only what settled in the window counts: from its first moment, not before", () => {
    const dataSecurity: AiOutcomesDataSecurity = dataSecurityOf([
      proposal(DataSecurityAiProposalStatus.AppliedWithoutAsking, {
        settledAt: WINDOW_START,
      }),
      proposal(DataSecurityAiProposalStatus.AppliedWithoutAsking, {
        settledAt: new Date(WINDOW_START.getTime() - 1),
      }),
      proposal(DataSecurityAiProposalStatus.Dismissed, {
        settledAt: new Date(WINDOW_START.getTime() - DAY),
      }),
    ]);

    expect(dataSecurity.changes.waiting).toBe(1);
    expect(dataSecurity.proposals.dismissed).toBe(0);
  });

  test("the weeks add up to the totals: what worked of what was made", () => {
    const rows: Array<AiOutcomesDataSecurityProposalRow> = [];
    const statuses: Array<DataSecurityAiProposalStatus> = [
      DataSecurityAiProposalStatus.Applied,
      DataSecurityAiProposalStatus.AppliedWithoutAsking,
      DataSecurityAiProposalStatus.Undone,
      DataSecurityAiProposalStatus.Failed,
      DataSecurityAiProposalStatus.Dismissed,
    ];

    for (let index: number = 0; index < 60; index++) {
      rows.push(
        proposal(statuses[index % statuses.length], {
          settledAt: inWeek(index % 12, (index % 5) * DAY),
          ...(index % 3 === 0 ? { verifiedAt: inWeek(11) } : {}),
          isApprovedByPerson: index % 2 === 0,
        }),
      );
    }

    const outcomes: AiOutcomes = build({ dataSecurityProposalRows: rows });
    const sum: (values: Array<number>) => number = (
      values: Array<number>,
    ): number => {
      return values.reduce((total: number, value: number) => {
        return total + value;
      }, 0);
    };

    expect(sum(weekly(outcomes, "dataSecurityChangesMade"))).toBe(
      getDataSecurityChangesMadeCount(outcomes.dataSecurity!.changes),
    );
    expect(sum(weekly(outcomes, "dataSecurityChangesProven"))).toBe(
      outcomes.dataSecurity!.changes.proven,
    );

    for (const week of outcomes.weeks) {
      expect(week.dataSecurityChangesProven).toBeLessThanOrEqual(
        week.dataSecurityChangesMade,
      );
    }

    // The rows put something in every outcome: the check above means something.
    expect(outcomes.dataSecurity!.changes).toEqual({
      proven: expect.any(Number),
      waiting: expect.any(Number),
      undone: expect.any(Number),
      failed: expect.any(Number),
    });
    expect(outcomes.dataSecurity!.changes.proven).toBeGreaterThan(0);
    expect(outcomes.dataSecurity!.changes.undone).toBeGreaterThan(0);
  });
});

describe("by kind", () => {
  test("each kind's own counts, the most changes first, then by name", () => {
    const dataSecurity: AiOutcomesDataSecurity = dataSecurityOf([
      proposal(DataSecurityAiProposalStatus.Dismissed, { kind: "Zebra" }),
      proposal(DataSecurityAiProposalStatus.Dismissed, { kind: "Alpha" }),
      proposal(DataSecurityAiProposalStatus.Applied, {
        kind: SCRUB,
        verifiedAt: inWeek(11),
        isApprovedByPerson: true,
      }),
      proposal(DataSecurityAiProposalStatus.AppliedWithoutAsking, {
        kind: SCRUB,
      }),
      proposal(DataSecurityAiProposalStatus.Failed, { kind: SCRUB }),
      proposal(DataSecurityAiProposalStatus.Undone, { kind: "RevokeAccess" }),
    ]);

    expect(dataSecurity.kinds).toEqual([
      {
        kind: SCRUB,
        proven: 1,
        waiting: 1,
        undone: 0,
        failed: 1,
        approved: 1,
        dismissed: 0,
      },
      {
        kind: "RevokeAccess",
        proven: 0,
        waiting: 0,
        undone: 1,
        failed: 0,
        approved: 0,
        dismissed: 0,
      },
      {
        kind: "Alpha",
        proven: 0,
        waiting: 0,
        undone: 0,
        failed: 0,
        approved: 0,
        dismissed: 1,
      },
      {
        kind: "Zebra",
        proven: 0,
        waiting: 0,
        undone: 0,
        failed: 0,
        approved: 0,
        dismissed: 1,
      },
    ]);
  });

  test("a kind with nothing counted is not listed; a row with no kind counts in the totals only", () => {
    const dataSecurity: AiOutcomesDataSecurity = dataSecurityOf([
      proposal(DataSecurityAiProposalStatus.Expired, { kind: "Stale" }),
      proposal(DataSecurityAiProposalStatus.Applied, { kind: undefined }),
      proposal(DataSecurityAiProposalStatus.Applied, {
        kind: SCRUB,
        settledAt: new Date(WINDOW_START.getTime() - DAY),
      }),
    ]);

    expect(dataSecurity.kinds).toEqual([]);
    expect(dataSecurity.changes.waiting).toBe(1);
  });
});

describe("the time from an issue opening to its check passing", () => {
  const OPENED: Date = inWeek(8);

  function proven(
    issueId: string,
    minutes: number,
    overrides: Partial<AiOutcomesDataSecurityProposalRow> = {},
  ): AiOutcomesDataSecurityProposalRow {
    return proposal(DataSecurityAiProposalStatus.AppliedWithoutAsking, {
      settledAt: OPENED,
      dataSecurityIssueId: issueId,
      issueOpenedAt: OPENED,
      verifiedAt: new Date(OPENED.getTime() + minutes * MINUTE),
      ...overrides,
    });
  }

  test("the middle issue's time, in whole minutes", () => {
    const dataSecurity: AiOutcomesDataSecurity = dataSecurityOf([
      proven("issue-1", 30),
      proven("issue-2", 600),
      proven("issue-3", 125),
    ]);

    expect(dataSecurity.medianMinutesToCheckPassed).toBe(125);
    expect(dataSecurity.issuesCheckPassed).toBe(3);
  });

  test("with an even number of issues, the mean of the two in the middle, rounded", () => {
    const dataSecurity: AiOutcomesDataSecurity = dataSecurityOf([
      proven("issue-1", 10),
      proven("issue-2", 20),
      proven("issue-3", 31),
      proven("issue-4", 4000),
    ]);

    // (20 + 31) / 2 = 25.5
    expect(dataSecurity.medianMinutesToCheckPassed).toBe(26);
    expect(dataSecurity.issuesCheckPassed).toBe(4);
  });

  test("each issue once: two changes proven for it count its first pass", () => {
    const dataSecurity: AiOutcomesDataSecurity = dataSecurityOf([
      proven("issue-1", 90),
      proven("issue-1", 45),
      proven("issue-2", 50),
    ]);

    // Issue 1 passed after 45 minutes, issue 2 after 50.
    expect(dataSecurity.medianMinutesToCheckPassed).toBe(48);
    expect(dataSecurity.issuesCheckPassed).toBe(2);
    expect(dataSecurity.changes.proven).toBe(3);
  });

  test("from when the issue opened, however late the change was made", () => {
    const dataSecurity: AiOutcomesDataSecurity = dataSecurityOf([
      proven("issue-1", 3 * 24 * 60, {
        // Made two days after the issue opened.
        settledAt: new Date(OPENED.getTime() + 2 * DAY),
      }),
    ]);

    expect(dataSecurity.medianMinutesToCheckPassed).toBe(3 * 24 * 60);
  });

  test("only proven changes count: one waiting, undone or failed says nothing of it", () => {
    const dataSecurity: AiOutcomesDataSecurity = dataSecurityOf([
      proven("issue-1", 60, { status: DataSecurityAiProposalStatus.Undone }),
      proven("issue-2", 60, { status: DataSecurityAiProposalStatus.Failed }),
      proposal(DataSecurityAiProposalStatus.Applied, {
        dataSecurityIssueId: "issue-3",
        issueOpenedAt: OPENED,
      }),
    ]);

    expect(dataSecurity.medianMinutesToCheckPassed).toBeNull();
    expect(dataSecurity.issuesCheckPassed).toBe(0);
  });

  test("an issue whose opening is unknown, or that passed before it opened, says nothing of it", () => {
    const dataSecurity: AiOutcomesDataSecurity = dataSecurityOf([
      proven("issue-1", 60, { issueOpenedAt: undefined }),
      proven("issue-2", -5),
      proven("", 60),
      proven("issue-4", 240),
    ]);

    expect(dataSecurity.changes.proven).toBe(4);
    expect(dataSecurity.medianMinutesToCheckPassed).toBe(240);
    expect(dataSecurity.issuesCheckPassed).toBe(1);
  });

  test("a change made before the window says nothing of it", () => {
    const dataSecurity: AiOutcomesDataSecurity = dataSecurityOf([
      proven("issue-1", 60, {
        settledAt: new Date(WINDOW_START.getTime() - DAY),
      }),
    ]);

    expect(dataSecurity.medianMinutesToCheckPassed).toBeNull();
  });
});

describe("the issues OneUptime AI analyzed", () => {
  test("each issue once, however often it was analyzed in the window", () => {
    const dataSecurity: AiOutcomesDataSecurity = dataSecurityOf(
      [],
      [
        { createdAt: inWeek(1), dataSecurityIssueId: "issue-1" },
        // Analyzed again after it reopened.
        { createdAt: inWeek(9), dataSecurityIssueId: "issue-1" },
        { createdAt: inWeek(4), dataSecurityIssueId: "issue-2" },
        // Before the window.
        {
          createdAt: new Date(WINDOW_START.getTime() - 1),
          dataSecurityIssueId: "issue-3",
        },
        // Of no issue.
        { createdAt: inWeek(4) },
      ],
    );

    expect(dataSecurity.issuesAnalyzed).toBe(2);
  });
});
