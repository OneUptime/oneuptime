import AiOutcomesBuilder, {
  AiOutcomesInput,
  AiOutcomesInvestigationRow,
  AiOutcomesPullRequestRow,
  AiOutcomesRemediationRow,
  AiOutcomesSubjectKey,
  getSubjectKey,
} from "../../../../../Server/Utils/AI/Outcomes/AiOutcomesBuilder";
import AIRunAutoGrade from "../../../../../Types/AI/AIRunAutoGrade";
import AIRunHumanVerdict from "../../../../../Types/AI/AIRunHumanVerdict";
import {
  AI_OUTCOMES_UNKNOWN_MODEL,
  AiOutcomes,
  AiOutcomesModelChange,
  AiOutcomesModelResult,
  AiOutcomesModels,
} from "../../../../../Types/AI/AiOutcomes";
import FixProductionStatus from "../../../../../Types/AI/FixProductionStatus";
import AutoRemediationVerificationStatus from "../../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import { OnCallPolicyAiHoldOutcome } from "../../../../../Types/OnCallDutyPolicy/OnCallPolicyAiHold";
import { describe, expect, test } from "@jest/globals";

/*
 * AI RESULTS BY MODEL (issue #7762): AiOutcomesBuilder counts the
 * investigations by the model that wrote each one's answer, and the fixes
 * that came from an investigation by its model, and marks the weeks the
 * investigations moved to another model. Pure, so every rule is held here
 * with plain rows:
 *
 *   - models is null for a caller who may not read the project's AI Logs;
 *   - Root Causes Confirmed: confirmed of judged, by model, the most
 *     judged first and work with no model recorded last;
 *   - Fixes Verified: verified of checked, for the fixes that came from an
 *     investigation - the latest one of the fix's incident or alert that
 *     started before the fix did - by that investigation's model;
 *   - a change of model is a week whose main model (the one that ran most
 *     of its investigations) is not the main model of the week before that
 *     had one: a switch, and a switch back, but never the week recording
 *     began, nor an AI rule's few investigations on another model.
 */

const DAY: number = 24 * 60 * 60 * 1000;
const WEEK: number = 7 * DAY;

// A Friday afternoon, UTC: the window opens on Saturday 22 Aug.
const NOW: Date = new Date("2026-11-13T15:00:00.000Z");
const WINDOW_START: Date = new Date("2026-08-22T00:00:00.000Z");

const WEEK_STARTS: Array<string> = [
  "2026-08-22",
  "2026-08-29",
  "2026-09-05",
  "2026-09-12",
  "2026-09-19",
  "2026-09-26",
  "2026-10-03",
  "2026-10-10",
  "2026-10-17",
  "2026-10-24",
  "2026-10-31",
  "2026-11-07",
];

// Neutral model names: no vendor's.
const MODEL_A: string = "chat-large";
const MODEL_B: string = "chat-medium";
const MODEL_C: string = "reasoning-small";

const INCIDENT_1: AiOutcomesSubjectKey = getSubjectKey("incident-1", null)!;
const INCIDENT_2: AiOutcomesSubjectKey = getSubjectKey("incident-2", null)!;
const ALERT_1: AiOutcomesSubjectKey = getSubjectKey(null, "alert-1")!;

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
    canReadModels: true,
    ...overrides,
  });
}

function models(overrides: Partial<AiOutcomesInput> = {}): AiOutcomesModels {
  const built: AiOutcomesModels | null = build(overrides).models;

  if (!built) {
    throw new Error("Expected models.");
  }

  return built;
}

function investigation(
  modelName: string | undefined,
  judged: Partial<AiOutcomesInvestigationRow> = {},
  overrides: Partial<AiOutcomesInvestigationRow> = {},
): AiOutcomesInvestigationRow {
  return {
    createdAt: inWeek(6),
    modelName,
    subjectKey: INCIDENT_1,
    ...judged,
    ...overrides,
  };
}

const MATCH: Partial<AiOutcomesInvestigationRow> = {
  autoGrade: AIRunAutoGrade.Match,
};
const PARTIAL: Partial<AiOutcomesInvestigationRow> = {
  autoGrade: AIRunAutoGrade.Partial,
};
const MISMATCH: Partial<AiOutcomesInvestigationRow> = {
  autoGrade: AIRunAutoGrade.Mismatch,
};
const CONFIRMED: Partial<AiOutcomesInvestigationRow> = {
  humanVerdict: AIRunHumanVerdict.Confirmed,
};
const REJECTED: Partial<AiOutcomesInvestigationRow> = {
  humanVerdict: AIRunHumanVerdict.Rejected,
};

function remediation(
  status: AutoRemediationVerificationStatus,
  overrides: Partial<AiOutcomesRemediationRow> = {},
): AiOutcomesRemediationRow {
  return {
    createdAt: inWeek(6, DAY),
    verificationStatus: status,
    subjectKey: INCIDENT_1,
    ...overrides,
  };
}

function pullRequest(
  status: FixProductionStatus,
  overrides: Partial<AiOutcomesPullRequestRow> = {},
): AiOutcomesPullRequestRow {
  return {
    createdAt: inWeek(6, 2 * DAY),
    productionStatus: status,
    subjectKey: INCIDENT_1,
    ...overrides,
  };
}

function result(
  modelName: string,
  value: number,
  total: number,
): AiOutcomesModelResult {
  return { modelName, value, total };
}

function change(weekIndex: number, modelName: string): AiOutcomesModelChange {
  return { weekStart: WEEK_STARTS[weekIndex]!, modelName };
}

// `count` investigations on a model in each of the weeks given.
function weeksOf(
  modelName: string | undefined,
  weeks: Array<number>,
  count: number = 1,
): Array<AiOutcomesInvestigationRow> {
  return weeks.flatMap((week: number): Array<AiOutcomesInvestigationRow> => {
    return Array.from(
      { length: count },
      (_value: unknown, index: number): AiOutcomesInvestigationRow => {
        return investigation(modelName, {
          createdAt: inWeek(week, DAY / 2 + index * 1000),
        });
      },
    );
  });
}

function range(from: number, to: number): Array<number> {
  return Array.from({ length: to - from + 1 }, (_value: unknown, i: number) => {
    return from + i;
  });
}

describe("who is told the models", () => {
  test("nobody who may not read the project's AI Logs: models is null", () => {
    for (const canReadModels of [false, undefined]) {
      const outcomes: AiOutcomes = build({
        canReadModels,
        investigationRows: [investigation(MODEL_A, MATCH)],
      });

      expect({ canReadModels, models: outcomes.models }).toEqual({
        canReadModels,
        models: null,
      });
    }
  });

  test("a reader of AI Logs with nothing to count gets empty lists, not null", () => {
    expect(models()).toEqual({ rootCauses: [], fixes: [], changes: [] });
    expect(
      models({
        investigationRows: [],
        remediationRows: [],
        pullRequestRows: [],
      }),
    ).toEqual({ rootCauses: [], fixes: [], changes: [] });
  });

  test("counting by model changes no other number", () => {
    const input: Partial<AiOutcomesInput> = {
      pageRows: [
        {
          createdAt: inWeek(3),
          outcome: OnCallPolicyAiHoldOutcome.ResolvedByAI,
        },
      ],
      remediationRows: [
        remediation(AutoRemediationVerificationStatus.Verified),
        remediation(AutoRemediationVerificationStatus.Failed),
      ],
      pullRequestRows: [pullRequest(FixProductionStatus.Regressed)],
      investigationRows: [
        investigation(MODEL_A, MATCH),
        investigation(MODEL_B, MISMATCH, { createdAt: inWeek(8) }),
      ],
    };

    const withModels: AiOutcomes = build({ ...input, canReadModels: true });
    const without: AiOutcomes = build({ ...input, canReadModels: false });

    expect({ ...withModels, models: null }).toEqual(without);
  });
});

describe("Root Causes Confirmed by model", () => {
  test("confirmed of judged, each investigation under the model that wrote its answer", () => {
    expect(
      models({
        investigationRows: [
          investigation(MODEL_A, CONFIRMED),
          investigation(MODEL_A, MATCH),
          investigation(MODEL_A, PARTIAL),
          investigation(MODEL_A, MISMATCH),
          // A person's verdict wins over the grade, as on the card.
          investigation(MODEL_A, { ...REJECTED, ...MATCH }),
          investigation(MODEL_B, MATCH),
          investigation(MODEL_B, { ...CONFIRMED, ...MISMATCH }),
          investigation(MODEL_B, MISMATCH),
        ],
      }).rootCauses,
    ).toEqual([result(MODEL_A, 2, 5), result(MODEL_B, 2, 3)]);
  });

  test("an investigation nobody judged is in no model's count", () => {
    expect(
      models({
        investigationRows: [
          investigation(MODEL_A, MATCH),
          investigation(MODEL_A),
          investigation(MODEL_B),
        ],
      }).rootCauses,
    ).toEqual([result(MODEL_A, 1, 1)]);
  });

  test("one with no model recorded counts under the unknown model, last, however many it has", () => {
    expect(
      models({
        investigationRows: [
          investigation(undefined, MATCH),
          investigation(undefined, MATCH),
          investigation(undefined, MISMATCH),
          investigation("", MATCH),
          investigation("   ", MISMATCH),
          investigation(MODEL_B, MATCH),
        ],
      }).rootCauses,
    ).toEqual([result(MODEL_B, 1, 1), result(AI_OUTCOMES_UNKNOWN_MODEL, 3, 5)]);
  });

  test("the most judged first, by name among equals", () => {
    expect(
      models({
        investigationRows: [
          investigation(MODEL_C, MATCH),
          investigation(MODEL_B, MATCH),
          investigation(MODEL_A, MISMATCH),
          investigation(MODEL_C, MISMATCH),
        ],
      }).rootCauses.map((row: AiOutcomesModelResult): string => {
        return row.modelName;
      }),
    ).toEqual([MODEL_C, MODEL_A, MODEL_B]);
  });

  test("a model name is kept as written, trimmed", () => {
    expect(
      models({
        investigationRows: [investigation(`  ${MODEL_A}  `, MATCH)],
      }).rootCauses,
    ).toEqual([result(MODEL_A, 1, 1)]);
  });

  test("only the window's investigations count", () => {
    expect(
      models({
        investigationRows: [
          investigation(MODEL_A, MATCH, {
            createdAt: new Date(WINDOW_START.getTime() - 1),
          }),
          investigation(MODEL_B, MATCH, { createdAt: WINDOW_START }),
          investigation(MODEL_C, MATCH, {
            createdAt: new Date(NOW.getTime() + 2 * DAY),
          }),
        ],
      }).rootCauses,
    ).toEqual([result(MODEL_B, 1, 1)]);
  });
});

describe("Fixes Verified by the model of the investigation each fix came from", () => {
  test("a fix counts under the latest investigation of its incident that started before it", () => {
    expect(
      models({
        investigationRows: [
          investigation(MODEL_A, {}, { createdAt: inWeek(5) }),
          investigation(MODEL_B, {}, { createdAt: inWeek(6) }),
          // Started after the fix: not what it came from.
          investigation(MODEL_C, {}, { createdAt: inWeek(7) }),
        ],
        remediationRows: [
          remediation(AutoRemediationVerificationStatus.Verified, {
            createdAt: inWeek(6, DAY),
          }),
        ],
      }).fixes,
    ).toEqual([result(MODEL_B, 1, 1)]);
  });

  test("an investigation that started the same moment as the fix counts as its source", () => {
    const at: Date = inWeek(4);

    expect(
      models({
        investigationRows: [investigation(MODEL_A, {}, { createdAt: at })],
        remediationRows: [
          remediation(AutoRemediationVerificationStatus.Failed, {
            createdAt: at,
          }),
        ],
      }).fixes,
    ).toEqual([result(MODEL_A, 0, 1)]);
  });

  test("verified of checked: a fix still checking, or that nothing could check, is in no model's count", () => {
    expect(
      models({
        investigationRows: [investigation(MODEL_A)],
        remediationRows: [
          remediation(AutoRemediationVerificationStatus.Verified),
          remediation(AutoRemediationVerificationStatus.Failed),
          remediation(AutoRemediationVerificationStatus.Pending),
          remediation(AutoRemediationVerificationStatus.Skipped),
        ],
        pullRequestRows: [
          pullRequest(FixProductionStatus.Verified),
          pullRequest(FixProductionStatus.Regressed),
          pullRequest(FixProductionStatus.Watching),
          pullRequest(FixProductionStatus.AwaitingDeploy),
          pullRequest(FixProductionStatus.Unverifiable),
        ],
      }).fixes,
    ).toEqual([result(MODEL_A, 2, 4)]);
  });

  test("a fix of an incident or alert with no investigation on the page, or of neither, came from none", () => {
    expect(
      models({
        investigationRows: [investigation(MODEL_A)],
        remediationRows: [
          remediation(AutoRemediationVerificationStatus.Verified, {
            subjectKey: INCIDENT_2,
          }),
          remediation(AutoRemediationVerificationStatus.Verified, {
            subjectKey: ALERT_1,
          }),
          remediation(AutoRemediationVerificationStatus.Verified, {
            subjectKey: undefined,
          }),
          // Before its incident's only investigation.
          remediation(AutoRemediationVerificationStatus.Verified, {
            createdAt: inWeek(2),
          }),
        ],
        pullRequestRows: [
          // An exception's fix: about no incident or alert.
          pullRequest(FixProductionStatus.Verified, { subjectKey: undefined }),
        ],
      }).fixes,
    ).toEqual([]);
  });

  test("an alert's fix finds the alert's investigation, never an incident's of the same id", () => {
    const sameId: string = "same-id";

    expect(
      models({
        investigationRows: [
          investigation(
            MODEL_A,
            {},
            { subjectKey: getSubjectKey(sameId, null) },
          ),
          investigation(
            MODEL_B,
            {},
            { subjectKey: getSubjectKey(null, sameId) },
          ),
        ],
        remediationRows: [
          remediation(AutoRemediationVerificationStatus.Verified, {
            subjectKey: getSubjectKey(null, sameId),
          }),
        ],
      }).fixes,
    ).toEqual([result(MODEL_B, 1, 1)]);
  });

  test("a fix pull request is matched by when its fix task started, not when the pull request was opened", () => {
    expect(
      models({
        investigationRows: [
          investigation(MODEL_A, {}, { createdAt: inWeek(5) }),
          // After the task started, before its pull request: not its source.
          investigation(MODEL_B, {}, { createdAt: inWeek(6, DAY) }),
        ],
        pullRequestRows: [
          pullRequest(FixProductionStatus.Verified, {
            fixStartedAt: inWeek(6),
            createdAt: inWeek(6, 2 * DAY),
          }),
          // Without its task's start: the pull request's own date.
          pullRequest(FixProductionStatus.Regressed, {
            createdAt: inWeek(6, 2 * DAY),
          }),
        ],
      }).fixes,
    ).toEqual([result(MODEL_A, 1, 1), result(MODEL_B, 0, 1)]);
  });

  test("fixes from investigations with no model recorded count under the unknown model", () => {
    expect(
      models({
        investigationRows: [investigation(undefined)],
        remediationRows: [
          remediation(AutoRemediationVerificationStatus.Verified),
          remediation(AutoRemediationVerificationStatus.Failed),
        ],
      }).fixes,
    ).toEqual([result(AI_OUTCOMES_UNKNOWN_MODEL, 1, 2)]);
  });

  test("only the window's fixes count, and only the window's investigations are their sources", () => {
    expect(
      models({
        investigationRows: [
          investigation(MODEL_A, {}, { createdAt: inWeek(0) }),
          investigation(
            MODEL_B,
            {},
            {
              createdAt: new Date(WINDOW_START.getTime() - DAY),
              subjectKey: INCIDENT_2,
            },
          ),
        ],
        remediationRows: [
          remediation(AutoRemediationVerificationStatus.Verified, {
            createdAt: new Date(WINDOW_START.getTime() - 1),
          }),
          remediation(AutoRemediationVerificationStatus.Verified, {
            createdAt: inWeek(1),
          }),
          // Its only investigation started before the window.
          remediation(AutoRemediationVerificationStatus.Verified, {
            createdAt: inWeek(0),
            subjectKey: INCIDENT_2,
          }),
        ],
      }).fixes,
    ).toEqual([result(MODEL_A, 1, 1)]);
  });

  test("the fixes of a part the caller may not read are not counted by model", () => {
    expect(
      models({
        investigationRows: [investigation(MODEL_A)],
        remediationRows: null,
        pullRequestRows: null,
      }).fixes,
    ).toEqual([]);
  });
});

describe("the weeks investigations moved to another model", () => {
  test("a switch shows in the first week the new model ran most of them", () => {
    expect(
      models({
        investigationRows: [
          ...weeksOf(MODEL_A, range(0, 4), 3),
          ...weeksOf(MODEL_B, range(5, 11), 3),
        ],
      }).changes,
    ).toEqual([change(5, MODEL_B)]);
  });

  test("a switch back shows too", () => {
    expect(
      models({
        investigationRows: [
          ...weeksOf(MODEL_A, range(0, 3)),
          ...weeksOf(MODEL_B, range(4, 7)),
          ...weeksOf(MODEL_A, range(8, 11)),
        ],
      }).changes,
    ).toEqual([change(4, MODEL_B), change(8, MODEL_A)]);
  });

  test("the week recording began is no change: investigations with no model say nothing", () => {
    expect(
      models({
        investigationRows: [
          ...weeksOf(undefined, range(0, 5), 4),
          ...weeksOf(MODEL_A, range(6, 11)),
        ],
      }).changes,
    ).toEqual([]);
  });

  test("an AI rule that sends a few investigations to another model changes nothing", () => {
    expect(
      models({
        investigationRows: [
          ...weeksOf(MODEL_A, range(0, 11), 3),
          ...weeksOf(MODEL_B, range(0, 11), 1),
        ],
      }).changes,
    ).toEqual([]);
  });

  test("a tie keeps the model the weeks before ran on", () => {
    expect(
      models({
        investigationRows: [
          ...weeksOf(MODEL_B, [0], 2),
          ...weeksOf(MODEL_A, [1]),
          ...weeksOf(MODEL_B, [1]),
          ...weeksOf(MODEL_A, [2], 2),
        ],
      }).changes,
    ).toEqual([change(2, MODEL_A)]);
  });

  test("a tie with nothing before it takes the first name, so the result never depends on order", () => {
    const rows: Array<AiOutcomesInvestigationRow> = [
      ...weeksOf(MODEL_B, [0]),
      ...weeksOf(MODEL_A, [0]),
      ...weeksOf(MODEL_B, [3], 2),
    ];

    expect(models({ investigationRows: rows }).changes).toEqual([
      change(3, MODEL_B),
    ]);
    expect(models({ investigationRows: [...rows].reverse() }).changes).toEqual([
      change(3, MODEL_B),
    ]);
  });

  test("weeks with no investigations are passed over", () => {
    expect(
      models({
        investigationRows: [...weeksOf(MODEL_A, [0]), ...weeksOf(MODEL_B, [9])],
      }).changes,
    ).toEqual([change(9, MODEL_B)]);
  });

  test("every finished investigation counts, judged or not, but only the window's", () => {
    expect(
      models({
        investigationRows: [
          investigation(MODEL_C, MATCH, {
            createdAt: new Date(WINDOW_START.getTime() - DAY),
          }),
          ...weeksOf(MODEL_A, [0, 1]),
          investigation(MODEL_B, MATCH, { createdAt: inWeek(2) }),
        ],
      }).changes,
    ).toEqual([change(2, MODEL_B)]);
  });

  test("one model all along: no change", () => {
    expect(
      models({ investigationRows: weeksOf(MODEL_A, range(0, 11), 2) }).changes,
    ).toEqual([]);
  });
});
