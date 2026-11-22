import AiOutcomesBuilder, {
  AiOutcomesDataSecurityProposalRow,
  AiOutcomesInvestigationRow,
  getSubjectKey,
} from "../../../../../Server/Utils/AI/Outcomes/AiOutcomesBuilder";
import AIRunAutoGrade from "../../../../../Types/AI/AIRunAutoGrade";
import AIRunHumanVerdict from "../../../../../Types/AI/AIRunHumanVerdict";
import {
  AI_OUTCOMES_DATA_SECURITY_PARTS,
  AI_OUTCOMES_ISSUE_VERDICT_OUTCOMES,
  AI_OUTCOMES_PAGE_OUTCOMES,
  AI_OUTCOMES_PART_OUTCOMES,
  AI_OUTCOMES_PARTS,
  AI_OUTCOMES_PULL_REQUEST_FIX_OUTCOMES,
  AI_OUTCOMES_REMEDIATION_FIX_OUTCOMES,
  AI_OUTCOMES_ROOT_CAUSE_OUTCOMES,
  AiOutcomes,
  AiOutcomesPart,
  isAiOutcomesPartOutcome,
} from "../../../../../Types/AI/AiOutcomes";
import FixProductionStatus from "../../../../../Types/AI/FixProductionStatus";
import AutoRemediationVerificationStatus from "../../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import { DataSecurityAiProposalStatus } from "../../../../../Types/DataSecurity/DataSecurityAi";
import DataSecurityIssueStatus from "../../../../../Types/DataSecurity/DataSecurityIssueStatus";
import { DataSecurityAiVerdict } from "../../../../../Types/DataSecurity/DataSecurityIssueAnalysis";
import ObjectID from "../../../../../Types/ObjectID";
import { OnCallPolicyAiHoldOutcome } from "../../../../../Types/OnCallDutyPolicy/OnCallPolicyAiHold";
import { describe, expect, test } from "@jest/globals";

/*
 * ONE RULE FOR A NUMBER AND THE RECORDS IT OPENS (issue #7768). Each row
 * AiOutcomesBuilder counts counts under one outcome - the key its count has
 * in its part's counts - and the records a number opens are the rows of
 * that outcome (AiOutcomesReader.readRecords). These hold the two together:
 * every value a row can have counts exactly where its outcome says, the
 * outcomes a record request may name are exactly the part's count keys,
 * and the window is the one the counts use.
 */

const DAY: number = 24 * 60 * 60 * 1000;
const NOW: Date = new Date("2026-11-13T15:00:00.000Z");
const WINDOW_START: Date = new Date("2026-08-22T00:00:00.000Z");
const IN_WINDOW: Date = new Date(NOW.getTime() - 3 * DAY);

function build(
  overrides: Partial<Parameters<typeof AiOutcomesBuilder.build>[0]>,
): AiOutcomes {
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

describe("held pages", () => {
  test.each(Object.values(OnCallPolicyAiHoldOutcome))(
    "%s counts under its outcome, and only there",
    (outcome: OnCallPolicyAiHoldOutcome) => {
      const key: string | null = AiOutcomesBuilder.getPageOutcome({ outcome });
      const outcomes: AiOutcomes = build({
        pageRows: [{ createdAt: IN_WINDOW, outcome }],
      });

      expect(key).not.toBeNull();
      expect(AI_OUTCOMES_PAGE_OUTCOMES).toContain(key);

      for (const other of AI_OUTCOMES_PAGE_OUTCOMES) {
        expect({ other, count: outcomes.pages![other] }).toEqual({
          other,
          count: other === key ? 1 : 0,
        });
      }
    },
  );

  test("a value this server does not know counts nowhere", () => {
    for (const outcome of ["Paused by a plugin", "", undefined]) {
      expect(AiOutcomesBuilder.getPageOutcome({ outcome })).toBeNull();
    }
  });
});

describe("fixes OneUptime AI ran", () => {
  test.each(Object.values(AutoRemediationVerificationStatus))(
    "%s counts under its outcome, and only there",
    (verificationStatus: AutoRemediationVerificationStatus) => {
      const key: string | null = AiOutcomesBuilder.getRemediationOutcome({
        verificationStatus,
      });
      const outcomes: AiOutcomes = build({
        remediationRows: [{ createdAt: IN_WINDOW, verificationStatus }],
      });

      expect(key).not.toBeNull();

      for (const other of AI_OUTCOMES_REMEDIATION_FIX_OUTCOMES) {
        expect({ other, count: outcomes.remediationFixes![other] }).toEqual({
          other,
          count: other === key ? 1 : 0,
        });
      }
    },
  );

  test("a status this server does not know counts nowhere", () => {
    for (const verificationStatus of ["Rolled back", undefined]) {
      expect(
        AiOutcomesBuilder.getRemediationOutcome({ verificationStatus }),
      ).toBeNull();
    }
  });
});

describe("fix pull requests", () => {
  test.each(Object.values(FixProductionStatus))(
    "%s counts under its outcome, and only there",
    (productionStatus: FixProductionStatus) => {
      const key: string | null = AiOutcomesBuilder.getPullRequestOutcome({
        productionStatus,
      });
      const outcomes: AiOutcomes = build({
        pullRequestRows: [{ createdAt: IN_WINDOW, productionStatus }],
      });

      expect(key).not.toBeNull();

      for (const other of AI_OUTCOMES_PULL_REQUEST_FIX_OUTCOMES) {
        expect({ other, count: outcomes.pullRequestFixes![other] }).toEqual({
          other,
          count: other === key ? 1 : 0,
        });
      }
    },
  );

  test("a status this server does not know counts nowhere", () => {
    for (const productionStatus of ["Reverted", undefined]) {
      expect(
        AiOutcomesBuilder.getPullRequestOutcome({ productionStatus }),
      ).toBeNull();
    }
  });
});

describe("investigations", () => {
  test.each([
    [{ humanVerdict: AIRunHumanVerdict.Confirmed }, "confirmed"],
    [{ humanVerdict: AIRunHumanVerdict.Rejected }, "wrong"],
    [{ autoGrade: AIRunAutoGrade.Match }, "confirmed"],
    [{ autoGrade: AIRunAutoGrade.Partial }, "partial"],
    [{ autoGrade: AIRunAutoGrade.Mismatch }, "wrong"],
    // A person's verdict before the grade.
    [
      {
        humanVerdict: AIRunHumanVerdict.Rejected,
        autoGrade: AIRunAutoGrade.Match,
      },
      "wrong",
    ],
    [
      {
        humanVerdict: AIRunHumanVerdict.Confirmed,
        autoGrade: AIRunAutoGrade.Mismatch,
      },
      "confirmed",
    ],
    // Nobody judged it: in no outcome.
    [{}, null],
  ] as Array<[Partial<AiOutcomesInvestigationRow>, string | null]>)(
    "%j counts as %s",
    (judged: Partial<AiOutcomesInvestigationRow>, expected: string | null) => {
      const row: AiOutcomesInvestigationRow = {
        createdAt: IN_WINDOW,
        ...judged,
      };
      const outcomes: AiOutcomes = build({ investigationRows: [row] });

      expect(AiOutcomesBuilder.getRootCauseOutcome(row)).toBe(expected);

      for (const other of AI_OUTCOMES_ROOT_CAUSE_OUTCOMES) {
        expect({ other, count: outcomes.rootCauses![other] }).toEqual({
          other,
          count: other === expected ? 1 : 0,
        });
      }
    },
  );
});

describe("what a record request may name", () => {
  test("each part's outcomes are exactly the keys of its counts", () => {
    const outcomes: AiOutcomes = build({
      pageRows: [],
      remediationRows: [],
      pullRequestRows: [],
      investigationRows: [],
    });

    expect([...AI_OUTCOMES_PART_OUTCOMES[AiOutcomesPart.Pages]].sort()).toEqual(
      Object.keys(outcomes.pages!).sort(),
    );
    expect(
      [...AI_OUTCOMES_PART_OUTCOMES[AiOutcomesPart.RemediationFixes]].sort(),
    ).toEqual(Object.keys(outcomes.remediationFixes!).sort());
    expect(
      [...AI_OUTCOMES_PART_OUTCOMES[AiOutcomesPart.PullRequestFixes]].sort(),
    ).toEqual(Object.keys(outcomes.pullRequestFixes!).sort());
    // Of the root causes' counts, the three a judgement lands in.
    expect(
      [...AI_OUTCOMES_PART_OUTCOMES[AiOutcomesPart.RootCauses]].sort(),
    ).toEqual(["confirmed", "partial", "wrong"]);
    expect(Object.keys(outcomes.rootCauses!)).toEqual(
      expect.arrayContaining(["confirmed", "partial", "wrong"]),
    );
    // Of the verdicts' counts, the four what people decided lands in.
    expect(
      [...AI_OUTCOMES_PART_OUTCOMES[AiOutcomesPart.IssueVerdicts]].sort(),
    ).toEqual(["agreed", "cannotTell", "disagreed", "waiting"]);
    expect(Object.keys(build({ issueVerdictRows: [] }).issueVerdicts!)).toEqual(
      expect.arrayContaining(["agreed", "cannotTell", "disagreed", "waiting"]),
    );
  });

  test("an outcome of one part is no outcome of another", () => {
    expect(
      isAiOutcomesPartOutcome(AiOutcomesPart.Pages, "holdTimeRanOut"),
    ).toBe(true);
    expect(
      isAiOutcomesPartOutcome(
        AiOutcomesPart.RemediationFixes,
        "holdTimeRanOut",
      ),
    ).toBe(false);
    expect(
      isAiOutcomesPartOutcome(AiOutcomesPart.PullRequestFixes, "failed"),
    ).toBe(false);
    expect(
      isAiOutcomesPartOutcome(AiOutcomesPart.RootCauses, "judgedByPeople"),
    ).toBe(false);
    expect(
      isAiOutcomesPartOutcome(AiOutcomesPart.RootCauses, "completed"),
    ).toBe(false);
  });

  test("the parts, in the page's order", () => {
    expect(AI_OUTCOMES_PARTS).toEqual([
      AiOutcomesPart.Pages,
      AiOutcomesPart.RemediationFixes,
      AiOutcomesPart.PullRequestFixes,
      AiOutcomesPart.RootCauses,
      AiOutcomesPart.DataSecurityAnalyses,
      AiOutcomesPart.DataSecurityChanges,
      AiOutcomesPart.DataSecurityProposals,
      AiOutcomesPart.IssueVerdicts,
    ]);
    expect(AI_OUTCOMES_DATA_SECURITY_PARTS).toEqual(
      AI_OUTCOMES_PARTS.slice(4, 7),
    );
  });

  test("Data Security's outcomes are exactly the keys of its counts (#10364)", () => {
    const outcomes: AiOutcomes = build({
      dataSecurityProposalRows: [],
      dataSecurityAnalysisRows: [],
    });

    expect(
      [...AI_OUTCOMES_PART_OUTCOMES[AiOutcomesPart.DataSecurityChanges]].sort(),
    ).toEqual(Object.keys(outcomes.dataSecurity!.changes).sort());
    expect(
      [
        ...AI_OUTCOMES_PART_OUTCOMES[AiOutcomesPart.DataSecurityProposals],
      ].sort(),
    ).toEqual(Object.keys(outcomes.dataSecurity!.proposals).sort());
    // One outcome: the issues analyzed, AiOutcomesDataSecurity.issuesAnalyzed.
    expect(
      AI_OUTCOMES_PART_OUTCOMES[AiOutcomesPart.DataSecurityAnalyses],
    ).toEqual(["analyzed"]);
    expect(outcomes.dataSecurity!.issuesAnalyzed).toBe(0);
    // A change's outcome is no proposal's, and the other way round.
    expect(
      isAiOutcomesPartOutcome(AiOutcomesPart.DataSecurityChanges, "approved"),
    ).toBe(false);
    expect(
      isAiOutcomesPartOutcome(AiOutcomesPart.DataSecurityProposals, "proven"),
    ).toBe(false);
    expect(
      isAiOutcomesPartOutcome(AiOutcomesPart.DataSecurityAnalyses, "failed"),
    ).toBe(false);
  });
});

describe("Data Security proposals (#10364)", () => {
  test.each(
    Object.values(DataSecurityAiProposalStatus).flatMap(
      (status: DataSecurityAiProposalStatus) => {
        return [
          [status, false, false],
          [status, true, false],
          [status, false, true],
        ] as Array<[DataSecurityAiProposalStatus, boolean, boolean]>;
      },
    ),
  )(
    "%s (proven: %p, approved by a person: %p) counts under its outcomes, and only there",
    (
      status: DataSecurityAiProposalStatus,
      isProven: boolean,
      isApprovedByPerson: boolean,
    ) => {
      const row: AiOutcomesDataSecurityProposalRow = {
        settledAt: IN_WINDOW,
        status,
        kind: "ScrubTelemetry",
        isApprovedByPerson,
        ...(isProven ? { verifiedAt: IN_WINDOW } : {}),
      };
      const change: string | null =
        AiOutcomesBuilder.getDataSecurityChangeOutcome(row);
      const proposal: string | null =
        AiOutcomesBuilder.getDataSecurityProposalOutcome(row);
      const outcomes: AiOutcomes = build({ dataSecurityProposalRows: [row] });

      for (const other of AI_OUTCOMES_PART_OUTCOMES[
        AiOutcomesPart.DataSecurityChanges
      ]) {
        expect({
          other,
          count: (
            outcomes.dataSecurity!.changes as unknown as Record<string, number>
          )[other],
        }).toEqual({ other, count: other === change ? 1 : 0 });
      }

      for (const other of AI_OUTCOMES_PART_OUTCOMES[
        AiOutcomesPart.DataSecurityProposals
      ]) {
        expect({
          other,
          count: (
            outcomes.dataSecurity!.proposals as unknown as Record<
              string,
              number
            >
          )[other],
        }).toEqual({ other, count: other === proposal ? 1 : 0 });
      }
    },
  );
});

describe("the window a number and its records share", () => {
  test("from the window's first moment to now", () => {
    expect(AiOutcomesBuilder.isInWindow(NOW, WINDOW_START)).toBe(true);
    expect(
      AiOutcomesBuilder.isInWindow(NOW, new Date(WINDOW_START.getTime() - 1)),
    ).toBe(false);
    expect(AiOutcomesBuilder.isInWindow(NOW, NOW)).toBe(true);
    expect(AiOutcomesBuilder.isInWindow(NOW, IN_WINDOW)).toBe(true);
  });

  test("a row counted in a week is in the window, and one in no week is not", () => {
    for (const createdAt of [
      WINDOW_START,
      IN_WINDOW,
      new Date(WINDOW_START.getTime() - 1),
      new Date(NOW.getTime() + 2 * DAY),
    ]) {
      const outcomes: AiOutcomes = build({
        pageRows: [
          { createdAt, outcome: OnCallPolicyAiHoldOutcome.HoldTimeRanOut },
        ],
      });

      expect({
        createdAt,
        counted: outcomes.pages!.holdTimeRanOut === 1,
      }).toEqual({
        createdAt,
        counted: AiOutcomesBuilder.isInWindow(NOW, createdAt),
      });
    }
  });
});

describe("what a row is about", () => {
  const INCIDENT_ID: ObjectID = new ObjectID(
    "11111111-1111-4111-8111-111111111111",
  );
  const ALERT_ID: ObjectID = new ObjectID(
    "22222222-2222-4222-8222-222222222222",
  );

  test("an incident, alert or not; else an alert; else nothing", () => {
    expect(getSubjectKey(INCIDENT_ID, ALERT_ID)).toBe(
      `incident:${INCIDENT_ID.toString()}`,
    );
    expect(getSubjectKey(INCIDENT_ID, undefined)).toBe(
      `incident:${INCIDENT_ID.toString()}`,
    );
    expect(getSubjectKey(undefined, ALERT_ID)).toBe(
      `alert:${ALERT_ID.toString()}`,
    );
    expect(getSubjectKey(null, null)).toBeUndefined();
  });
});

describe("OneUptime AI's verdicts on Data Security issues (#10369)", () => {
  interface VerdictRow {
    verdict: string;
    status: DataSecurityIssueStatus;
    isStorePublicByDesign?: boolean;
    outcome: string | null;
  }

  const ROWS: Array<VerdictRow> = [
    {
      verdict: DataSecurityAiVerdict.Real,
      status: DataSecurityIssueStatus.Open,
      outcome: "waiting",
    },
    {
      verdict: DataSecurityAiVerdict.Real,
      status: DataSecurityIssueStatus.Resolved,
      outcome: "agreed",
    },
    {
      verdict: DataSecurityAiVerdict.Real,
      status: DataSecurityIssueStatus.Accepted,
      outcome: "agreed",
    },
    {
      verdict: DataSecurityAiVerdict.Real,
      status: DataSecurityIssueStatus.NotAnIssue,
      outcome: "disagreed",
    },
    {
      verdict: DataSecurityAiVerdict.LikelyByDesign,
      status: DataSecurityIssueStatus.Accepted,
      outcome: "agreed",
    },
    {
      verdict: DataSecurityAiVerdict.LikelyByDesign,
      status: DataSecurityIssueStatus.NotAnIssue,
      outcome: "agreed",
    },
    // Resolved by marking the store public by design: agreed.
    {
      verdict: DataSecurityAiVerdict.LikelyByDesign,
      status: DataSecurityIssueStatus.Resolved,
      isStorePublicByDesign: true,
      outcome: "agreed",
    },
    // Resolved by closing what was public: people thought it was real.
    {
      verdict: DataSecurityAiVerdict.LikelyByDesign,
      status: DataSecurityIssueStatus.Resolved,
      outcome: "disagreed",
    },
    {
      verdict: DataSecurityAiVerdict.LikelyWrongFinding,
      status: DataSecurityIssueStatus.NotAnIssue,
      outcome: "agreed",
    },
    {
      verdict: DataSecurityAiVerdict.LikelyWrongFinding,
      status: DataSecurityIssueStatus.Resolved,
      outcome: "disagreed",
    },
    {
      verdict: DataSecurityAiVerdict.LikelyWrongFinding,
      status: DataSecurityIssueStatus.Accepted,
      outcome: "disagreed",
    },
    {
      verdict: DataSecurityAiVerdict.CannotTell,
      status: DataSecurityIssueStatus.Resolved,
      outcome: "cannotTell",
    },
    {
      verdict: DataSecurityAiVerdict.CannotTell,
      status: DataSecurityIssueStatus.Open,
      outcome: "cannotTell",
    },
    {
      verdict: "Probably fine",
      status: DataSecurityIssueStatus.Resolved,
      outcome: null,
    },
  ];

  test.each(ROWS)(
    "$verdict, then $status (public by design: $isStorePublicByDesign) is $outcome",
    (row: VerdictRow) => {
      expect(AiOutcomesBuilder.getIssueVerdictOutcome(row)).toBe(row.outcome);

      const outcomes: AiOutcomes = build({
        issueVerdictRows: [{ createdAt: IN_WINDOW, ...row }],
      });

      for (const other of AI_OUTCOMES_ISSUE_VERDICT_OUTCOMES) {
        expect({ other, count: outcomes.issueVerdicts![other] }).toEqual({
          other,
          count: other === row.outcome ? 1 : 0,
        });
      }
    },
  );

  test("each verdict is counted by itself, and the week counts what people decided and agreed with", () => {
    const outcomes: AiOutcomes = build({
      issueVerdictRows: ROWS.map((row: VerdictRow) => {
        return { createdAt: IN_WINDOW, ...row };
      }),
    });

    expect(outcomes.issueVerdicts).toEqual({
      agreed: 6,
      disagreed: 4,
      waiting: 1,
      cannotTell: 2,
      real: 4,
      likelyByDesign: 4,
      likelyWrongFinding: 3,
    });

    const week: AiOutcomes["weeks"][number] | undefined = outcomes.weeks.find(
      (candidate: AiOutcomes["weeks"][number]): boolean => {
        return (candidate.verdictsDecided || 0) > 0;
      },
    );

    expect(week?.verdictsDecided).toBe(10);
    expect(week?.verdictsAgreed).toBe(6);
  });

  test("before the window, nothing; no rows read is no number, not zeros; a server that reads none says nothing", () => {
    expect(
      build({
        issueVerdictRows: [
          {
            createdAt: new Date(WINDOW_START.getTime() - 1),
            verdict: DataSecurityAiVerdict.Real,
            status: DataSecurityIssueStatus.Resolved,
          },
        ],
      }).issueVerdicts!.agreed,
    ).toBe(0);
    expect(build({ issueVerdictRows: null }).issueVerdicts).toBeNull();
    expect("issueVerdicts" in build({})).toBe(false);
  });
});
