import { beforeEach, describe, expect, test } from "@jest/globals";
import {
  AI_OFF_INVESTIGATION_CODES,
  AI_OFF_LINK_TEXTS,
  AI_OFF_NOTES,
  AI_OFF_REASONS,
  AI_OFF_STEP_TEXTS,
  AI_OFF_TITLES,
  AI_OFF_WHO_CAN_CHANGE,
  AI_SETTINGS_RULES_ANCHOR,
  AI_SETTINGS_WHICH_ANCHOR,
  AiCardFold,
  AiLaneSwitchStates,
  AiOffStep,
  AiOffStepKey,
  AiOffSubjectType,
  AiOffSummary,
  getAiCardFold,
  getAiLane,
  getAiLaneSwitchColumns,
  getAiOffSummary,
  getRemediationFoldState,
  isAiOffInvestigationReason,
  isRemediationFoldedIntoAiCard,
  isSameRemediationFoldState,
  REMEDIATION_FOLD_LOADING,
  RemediationFoldState,
  RemediationOffReason,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AiOffSummaryData";
import { SILENT_REASONS } from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationDecisionLines";
import {
  AI_LANE_SWITCHES,
  AiLane,
  AiLaneAdvancedCard,
  EnableAiCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import Project from "../../../Models/DatabaseModels/Project";
import InvestigationNotStartedReason, {
  InvestigationNotStartedCode,
} from "../../../Types/AI/InvestigationNotStartedReason";
import {
  AutoRemediationDecisionEntry,
  AutoRemediationDecisionLane,
  AutoRemediationDecisionReason,
  AutoRemediationDecisionStage,
} from "../../../Types/AutoRemediation/AutoRemediationDecision";
import Permission from "../../../Types/Permission";
import { getGlobalTranslator } from "../../../UI/Utils/TranslateTemplate";
import { goTo, PROJECT_ID, routeFor } from "./SideMenuHarness";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";

/*
 * When the incident's or alert's AI card folds into one line, and what that
 * line says ("When AI investigation and remediation are off, can we please
 * collapse this card into one simple line that says, 'AI investigation is
 * off. Here's why.' ... Then you can expand that card to see what more you
 * can do to enable AI." - the maintainer).
 *
 *   - It folds only when OneUptime AI did not investigate the record for a
 *     reason the project chose - Enable AI off, automatic investigation off,
 *     no AI rule that investigates matched, the severity below the minimum -
 *     and fixing did nothing for one either. A fault (no provider, no
 *     credits, a limit, a failure), a run, a wait, or a fix that did
 *     something keeps the card whole.
 *   - The line says what is off and why; opened, what to turn on, as the
 *     settings are now ("is on now" for a switch turned on since), where,
 *     and who may - and that none of it reaches back to this record.
 */

const EVALUATED_AT: string = "2026-09-14T18:01:20.000Z";

const ALL_CODES: Array<InvestigationNotStartedCode> = [
  "ai_disabled",
  "automatic_investigation_disabled",
  "provider_missing",
  "insufficient_ai_balance",
  "project_daily_limit_reached",
  "severity_below_threshold",
  "monitor_cooldown",
  "no_investigation_rule_matched",
  "created_resolved",
  "resolved_before_investigation",
  "daily_budget_exhausted",
  "budget_check_failed",
  "enqueue_failed",
  "eligibility_check_failed",
  "no_run_recorded",
];

const SUBJECT_TYPES: Array<AiOffSubjectType> = ["incident", "alert"];

function reasonFor(
  code: InvestigationNotStartedCode,
  source: InvestigationNotStartedReason["source"] = "recorded",
): InvestigationNotStartedReason {
  return {
    code,
    title: `Server title for ${code}`,
    description: `Server description for ${code}.`,
    nextStep: `Server next step for ${code}.`,
    source,
    evaluatedAt: EVALUATED_AT,
  };
}

function entry(
  reason: AutoRemediationDecisionReason,
  extra: Partial<AutoRemediationDecisionEntry> = {},
): AutoRemediationDecisionEntry {
  return {
    lane:
      reason === AutoRemediationDecisionReason.EnableAiOff ||
      reason === AutoRemediationDecisionReason.RemediationOff
        ? AutoRemediationDecisionLane.Project
        : AutoRemediationDecisionLane.Rule,
    reason,
    ...extra,
  };
}

function evaluatedState(
  entries: Array<AutoRemediationDecisionEntry>,
): RemediationFoldState {
  return getRemediationFoldState({
    isLoaded: true,
    suggestionCount: 0,
    decision: { stage: AutoRemediationDecisionStage.Evaluated, entries },
  });
}

function summaryFor(data: {
  subjectType?: AiOffSubjectType;
  code: InvestigationNotStartedCode;
  source?: InvestigationNotStartedReason["source"];
  remediationReason?: RemediationOffReason;
  ruleName?: string;
  isAiOn?: boolean;
  switches?: AiLaneSwitchStates;
}): AiOffSummary {
  return getAiOffSummary({
    subjectType: data.subjectType || "incident",
    reason: reasonFor(data.code, data.source || "recorded"),
    remediationReason: data.remediationReason || "fixing_off",
    ...(data.ruleName ? { ruleName: data.ruleName } : {}),
    isAiOn: data.isAiOn ?? true,
    switches: data.switches || {},
    translator: getGlobalTranslator(),
  });
}

function stepKeys(summary: AiOffSummary): Array<AiOffStepKey> {
  return summary.steps.map((step: AiOffStep): AiOffStepKey => {
    return step.key;
  });
}

function step(summary: AiOffSummary, key: AiOffStepKey): AiOffStep {
  const found: AiOffStep | undefined = summary.steps.find(
    (candidate: AiOffStep): boolean => {
      return candidate.key === key;
    },
  );

  expect(found).toBeDefined();

  return found!;
}

function settingsPath(subjectType: AiOffSubjectType): string {
  return routeFor(
    subjectType === "alert"
      ? PageMap.ALERTS_SETTINGS_AI
      : PageMap.INCIDENTS_SETTINGS_AI,
  );
}

const PAGE_ANCHOR_NAME: RegExp = /^[A-Za-z][A-Za-z0-9_-]*$/;
const ALERT_WORD: RegExp = /\balerts?\b/;
const INCIDENT_WORD: RegExp = /\bincidents?\b/;

beforeEach(() => {
  // Routes are built for the project the address names.
  goTo(`/dashboard/${PROJECT_ID}/incidents`);
});

describe("which reasons a record was not investigated fold the card", () => {
  test("the four that are a choice the project made", () => {
    expect([...AI_OFF_INVESTIGATION_CODES].sort()).toEqual(
      [
        "ai_disabled",
        "automatic_investigation_disabled",
        "no_investigation_rule_matched",
        "severity_below_threshold",
      ].sort(),
    );

    for (const code of AI_OFF_INVESTIGATION_CODES) {
      expect(isAiOffInvestigationReason(reasonFor(code))).toBe(true);
      // Recorded at creation or read from the settings now, alike.
      expect(
        isAiOffInvestigationReason(reasonFor(code, "current_configuration")),
      ).toBe(true);
    }
  });

  test.each(
    ALL_CODES.filter((code: InvestigationNotStartedCode): boolean => {
      return !AI_OFF_INVESTIGATION_CODES.includes(code);
    }),
  )(
    "%s keeps the card whole: something is missing or went wrong, or it was not a choice",
    (code: InvestigationNotStartedCode) => {
      expect(isAiOffInvestigationReason(reasonFor(code))).toBe(false);
    },
  );

  test("no reason at all is not one of them", () => {
    expect(isAiOffInvestigationReason(null)).toBe(false);
    expect(isAiOffInvestigationReason(undefined)).toBe(false);
  });
});

describe("what fixing did, as the AI card reads it", () => {
  test("still reading until the Remediation card has read", () => {
    expect(
      getRemediationFoldState({
        isLoaded: false,
        suggestionCount: 3,
        decision: null,
      }),
    ).toEqual(REMEDIATION_FOLD_LOADING);
    expect(REMEDIATION_FOLD_LOADING).toEqual({ kind: "loading" });
  });

  test("a fix proposed, run or dismissed is something to show, whatever was decided", () => {
    expect(
      getRemediationFoldState({
        isLoaded: true,
        suggestionCount: 1,
        decision: {
          stage: AutoRemediationDecisionStage.Evaluated,
          entries: [entry(AutoRemediationDecisionReason.RemediationOff)],
        },
      }),
    ).toEqual({ kind: "on" });
  });

  test("nothing recorded is nothing to show: an older record", () => {
    expect(
      getRemediationFoldState({
        isLoaded: true,
        suggestionCount: 0,
        decision: null,
      }),
    ).toEqual({ kind: "off", reason: "not_recorded" });
  });

  test("waiting for an investigation is on: remediation will say more", () => {
    expect(
      getRemediationFoldState({
        isLoaded: true,
        suggestionCount: 0,
        decision: {
          stage: AutoRemediationDecisionStage.WaitingForInvestigation,
          entries: [],
        },
      }),
    ).toEqual({ kind: "on" });
  });

  test.each<[AutoRemediationDecisionReason, RemediationOffReason]>([
    [AutoRemediationDecisionReason.EnableAiOff, "ai_off"],
    [AutoRemediationDecisionReason.RemediationOff, "fixing_off"],
    [AutoRemediationDecisionReason.NotMatchedByAnyRule, "no_rule_matched"],
    [AutoRemediationDecisionReason.NoRuleMatched, "no_rule_matched"],
    [AutoRemediationDecisionReason.NoRulesConfigured, "no_rule_matched"],
    [AutoRemediationDecisionReason.MatchedRulesDoNotFix, "rules_do_not_fix"],
  ])("%s is off: %s", (reason: AutoRemediationDecisionReason, expected) => {
    expect(evaluatedState([entry(reason)])).toEqual({
      kind: "off",
      reason: expected,
    });
  });

  test("every other entry means fixing was on and has something to say", () => {
    const offReasons: Array<AutoRemediationDecisionReason> = [
      AutoRemediationDecisionReason.EnableAiOff,
      AutoRemediationDecisionReason.RemediationOff,
      AutoRemediationDecisionReason.NotMatchedByAnyRule,
      AutoRemediationDecisionReason.NoRuleMatched,
      AutoRemediationDecisionReason.NoRulesConfigured,
      AutoRemediationDecisionReason.MatchedRulesDoNotFix,
      ...SILENT_REASONS,
    ];

    const onReasons: Array<AutoRemediationDecisionReason> = Object.values(
      AutoRemediationDecisionReason,
    ).filter((reason: AutoRemediationDecisionReason): boolean => {
      return !offReasons.includes(reason);
    });

    // Linked to nothing, a cluster not ready, a fix started, a limit, ...
    expect(onReasons).toEqual(
      expect.arrayContaining([
        AutoRemediationDecisionReason.ClusterNoneLinked,
        AutoRemediationDecisionReason.ResourceNoneLinked,
        AutoRemediationDecisionReason.ClusterNotReady,
        AutoRemediationDecisionReason.ClusterRoundStarted,
        AutoRemediationDecisionReason.RuleRunbookStarted,
        AutoRemediationDecisionReason.SuggestionLimitReached,
        AutoRemediationDecisionReason.EvaluationFailed,
        AutoRemediationDecisionReason.RuleSkippedNoLlmProvider,
      ]),
    );

    for (const reason of onReasons) {
      expect({ reason, state: evaluatedState([entry(reason)]) }).toEqual({
        reason,
        state: { kind: "on" },
      });
      // Beside an entry that says fixing was off, it still wins.
      expect({
        reason,
        state: evaluatedState([
          entry(AutoRemediationDecisionReason.RemediationOff),
          entry(reason),
        ]),
      }).toEqual({ reason, state: { kind: "on" } });
    }
  });

  test("the lanes that only say another lane took the record say nothing", () => {
    expect(
      evaluatedState([
        entry(AutoRemediationDecisionReason.ClusterSkippedForResourceRound),
        entry(AutoRemediationDecisionReason.RemediationOff),
        entry(AutoRemediationDecisionReason.ResourceSkippedForClusterRound),
      ]),
    ).toEqual({ kind: "off", reason: "fixing_off" });
  });

  test("an evaluation with nothing this build can read keeps the card whole", () => {
    // parseEntries leaves out what a newer server wrote and this build does not know.
    expect(evaluatedState([])).toEqual({ kind: "on" });
    expect(
      evaluatedState([
        entry(AutoRemediationDecisionReason.ClusterSkippedForResourceRound),
      ]),
    ).toEqual({ kind: "on" });
  });

  test("of several reasons the line gives the one that matters most", () => {
    expect(
      evaluatedState([
        entry(AutoRemediationDecisionReason.NotMatchedByAnyRule),
        entry(AutoRemediationDecisionReason.RemediationOff),
      ]),
    ).toEqual({ kind: "off", reason: "fixing_off" });
    expect(
      evaluatedState([
        entry(AutoRemediationDecisionReason.RemediationOff),
        entry(AutoRemediationDecisionReason.EnableAiOff),
      ]),
    ).toEqual({ kind: "off", reason: "ai_off" });
    expect(
      evaluatedState([
        entry(AutoRemediationDecisionReason.NotMatchedByAnyRule),
        entry(AutoRemediationDecisionReason.MatchedRulesDoNotFix, {
          ruleName: "Checkout investigations",
        }),
      ]),
    ).toEqual({
      kind: "off",
      reason: "rules_do_not_fix",
      ruleName: "Checkout investigations",
    });
  });

  test("names the rule only when the rules that matched only investigate", () => {
    expect(
      evaluatedState([
        entry(AutoRemediationDecisionReason.MatchedRulesDoNotFix, {
          ruleName: "Checkout investigations",
        }),
      ]),
    ).toEqual({
      kind: "off",
      reason: "rules_do_not_fix",
      ruleName: "Checkout investigations",
    });
    expect(
      evaluatedState([
        entry(AutoRemediationDecisionReason.MatchedRulesDoNotFix, {
          ruleName: "",
        }),
      ]),
    ).toEqual({ kind: "off", reason: "rules_do_not_fix" });
    expect(
      evaluatedState([
        entry(AutoRemediationDecisionReason.NotMatchedByAnyRule, {
          ruleName: "Not this one",
        }),
      ]),
    ).toEqual({ kind: "off", reason: "no_rule_matched" });
  });

  test("two states that say the same thing are the same", () => {
    const states: Array<RemediationFoldState> = [
      { kind: "loading" },
      { kind: "on" },
      { kind: "off", reason: "fixing_off" },
      { kind: "off", reason: "ai_off" },
      { kind: "off", reason: "rules_do_not_fix", ruleName: "A" },
      { kind: "off", reason: "rules_do_not_fix", ruleName: "B" },
    ];

    states.forEach((a: RemediationFoldState, i: number) => {
      states.forEach((b: RemediationFoldState, j: number) => {
        expect({ i, j, same: isSameRemediationFoldState(a, b) }).toEqual({
          i,
          j,
          same: i === j,
        });
      });
    });

    expect(
      isSameRemediationFoldState(
        { kind: "off", reason: "rules_do_not_fix" },
        { kind: "off", reason: "rules_do_not_fix", ruleName: "" },
      ),
    ).toBe(true);
  });
});

describe("how the AI card is drawn", () => {
  const offReason: InvestigationNotStartedReason = reasonFor(
    "automatic_investigation_disabled",
  );

  test.each<[string, Parameters<typeof getAiCardFold>[0], AiCardFold]>([
    [
      "checking while its own answer is on its way",
      {
        isInvestigationLoaded: false,
        offReason: null,
        remediation: { kind: "off", reason: "fixing_off" },
      },
      "checking",
    ],
    [
      "whole when the record was not off (a run, a wait, any other reason)",
      {
        isInvestigationLoaded: true,
        offReason: null,
        remediation: { kind: "off", reason: "fixing_off" },
      },
      "full",
    ],
    [
      "whole when the page does not say what fixing did",
      {
        isInvestigationLoaded: true,
        offReason,
        remediation: undefined,
      },
      "full",
    ],
    [
      "checking while the Remediation card is still reading",
      {
        isInvestigationLoaded: true,
        offReason,
        remediation: { kind: "loading" },
      },
      "checking",
    ],
    [
      "folded when fixing did nothing either",
      {
        isInvestigationLoaded: true,
        offReason,
        remediation: { kind: "off", reason: "fixing_off" },
      },
      "folded",
    ],
    [
      "folded when nothing was recorded about fixing",
      {
        isInvestigationLoaded: true,
        offReason,
        remediation: { kind: "off", reason: "not_recorded" },
      },
      "folded",
    ],
    [
      "whole when fixing did something",
      {
        isInvestigationLoaded: true,
        offReason,
        remediation: { kind: "on" },
      },
      "full",
    ],
  ])("%s", (_name: string, input, expected: AiCardFold) => {
    expect(getAiCardFold(input)).toBe(expected);
  });

  test("the Remediation card leaves 'nothing was fixed' to the line, and only that", () => {
    const off: RemediationFoldState = { kind: "off", reason: "fixing_off" };
    const folds: Array<AiCardFold | undefined> = [
      "checking",
      "folded",
      "full",
      undefined,
    ];

    for (const aiCardFold of folds) {
      expect({
        aiCardFold,
        hidden: isRemediationFoldedIntoAiCard({ state: off, aiCardFold }),
      }).toEqual({
        aiCardFold,
        hidden: aiCardFold === "checking" || aiCardFold === "folded",
      });

      // A fix to show, or a card still reading, is never left out.
      expect(
        isRemediationFoldedIntoAiCard({ state: { kind: "on" }, aiCardFold }),
      ).toBe(false);
      expect(
        isRemediationFoldedIntoAiCard({
          state: { kind: "loading" },
          aiCardFold,
        }),
      ).toBe(false);
    }
  });
});

describe("the record's switches", () => {
  test("each kind of record reads its own two switches, as its settings page draws them", () => {
    expect(getAiLane("incident")).toBe(AiLane.Incident);
    expect(getAiLane("alert")).toBe(AiLane.Alert);

    for (const subjectType of SUBJECT_TYPES) {
      const columns: { investigate: string; fix: string } =
        getAiLaneSwitchColumns(subjectType);
      const drawn: Array<string> = AI_LANE_SWITCHES[getAiLane(subjectType)].map(
        (definition: { column: string }): string => {
          return definition.column;
        },
      );

      // The page draws the investigate switch first, then the fix switch.
      expect(drawn.indexOf(columns.investigate)).toBe(0);
      expect(drawn.indexOf(columns.fix)).toBe(1);
    }

    expect(getAiLaneSwitchColumns("incident")).toEqual({
      investigate: "enableAutomaticIncidentInvestigation",
      fix: "enableAutomaticIncidentRemediation",
    });
    expect(getAiLaneSwitchColumns("alert")).toEqual({
      investigate: "enableAutomaticAlertInvestigation",
      fix: "enableAutomaticAlertRemediation",
    });
  });

  test("the settings page's places the line links to are its More settings items", () => {
    expect(AI_SETTINGS_RULES_ANCHOR).toBe(AiLaneAdvancedCard.AiRules);
    expect(AI_SETTINGS_WHICH_ANCHOR).toBe(
      AiLaneAdvancedCard.WhichAreInvestigated,
    );
    // Plain names a page can be opened at (Common/UI/Utils/PageAnchor).
    expect(AI_SETTINGS_RULES_ANCHOR).toMatch(PAGE_ANCHOR_NAME);
    expect(AI_SETTINGS_WHICH_ANCHOR).toMatch(PAGE_ANCHOR_NAME);
    // The page's own settings: where the folded line links to.
    expect(settingsPath("incident")).toBe(
      `/dashboard/${PROJECT_ID}/incidents/ai/settings`,
    );
    expect(settingsPath("alert")).toBe(
      `/dashboard/${PROJECT_ID}/alerts/ai/settings`,
    );
  });
});

describe.each(SUBJECT_TYPES)(
  "what the %s's line says",
  (subjectType: AiOffSubjectType) => {
    const noun: string = subjectType;

    test("what is off: the maintainer's words while AI is on, the project's AI when it is not", () => {
      expect(AI_OFF_TITLES.investigationOff).toBe("AI investigation is off");
      expect(
        summaryFor({ subjectType, code: "automatic_investigation_disabled" })
          .title,
      ).toBe("AI investigation is off");
      expect(
        summaryFor({
          subjectType,
          code: "automatic_investigation_disabled",
          isAiOn: false,
        }).title,
      ).toBe("AI is off for this project");
    });

    test.each<[InvestigationNotStartedCode, string, string]>([
      [
        "automatic_investigation_disabled",
        `“Investigate new ${noun}s” was off when this ${noun} was created.`,
        `“Investigate new ${noun}s” is off.`,
      ],
      [
        "no_investigation_rule_matched",
        `This ${noun} matched none of the AI rules that investigate.`,
        `This ${noun} matches none of the AI rules that investigate.`,
      ],
      [
        "severity_below_threshold",
        `This ${noun}'s severity was below the minimum for AI investigation.`,
        `This ${noun}'s severity is below the minimum for AI investigation.`,
      ],
    ])(
      "%s: why, as decided then, or as the settings say now",
      (
        code: InvestigationNotStartedCode,
        recorded: string,
        current: string,
      ) => {
        expect(summaryFor({ subjectType, code }).reason).toBe(recorded);
        expect(
          summaryFor({ subjectType, code, source: "current_configuration" })
            .reason,
        ).toBe(current);
      },
    );

    test("AI off for the project: when it was, or that it still is", () => {
      expect(
        summaryFor({ subjectType, code: "ai_disabled", isAiOn: true }).reason,
      ).toBe(`AI was off for this project when this ${noun} was created.`);
      expect(
        summaryFor({ subjectType, code: "ai_disabled", isAiOn: false }).reason,
      ).toBe(`OneUptime AI did not investigate or fix this ${noun}.`);
    });

    test("names the switch the way its settings page does", () => {
      const switchTitle: string =
        AI_LANE_SWITCHES[getAiLane(subjectType)][0]!.title;

      expect(switchTitle).toBe(`Investigate new ${noun}s`);
      expect(
        summaryFor({ subjectType, code: "automatic_investigation_disabled" })
          .reason,
      ).toContain(`“${switchTitle}”`);
    });

    test("it does not reach back to this record; while AI is on it can still be asked", () => {
      expect(
        summaryFor({ subjectType, code: "automatic_investigation_disabled" })
          .note,
      ).toBe(
        `This applies to new ${noun}s only, not to this one. You can still ask OneUptime AI about it.`,
      );
      expect(
        summaryFor({ subjectType, code: "ai_disabled", isAiOn: false }).note,
      ).toBe(`This applies to new ${noun}s only, not to this one.`);
      expect(AI_OFF_NOTES[subjectType].askAi).toContain("ask OneUptime AI");
      expect(AI_OFF_NOTES[subjectType].aiOff).not.toContain("OneUptime AI");
    });
  },
);

describe.each(SUBJECT_TYPES)(
  "what can be done for an %s",
  (subjectType: AiOffSubjectType) => {
    const noun: string = subjectType;
    const investigateTitle: string = `Investigate new ${noun}s`;
    const fixTitle: string = `Fix new ${noun}s automatically`;

    test("automatic investigation and fixing off: turn both on, on the record's AI settings", () => {
      const summary: AiOffSummary = summaryFor({
        subjectType,
        code: "automatic_investigation_disabled",
        remediationReason: "fixing_off",
      });

      expect(stepKeys(summary)).toEqual(["investigate-switch", "fix-switch"]);
      expect(step(summary, "investigate-switch").text).toBe(
        `Turn on “${investigateTitle}”.`,
      );
      expect(step(summary, "fix-switch").text).toBe(`Turn on “${fixTitle}”.`);

      for (const key of ["investigate-switch", "fix-switch"] as const) {
        const linked: AiOffStep = step(summary, key);

        expect(linked.isDone).toBe(false);
        expect(linked.link?.text).toBe(
          subjectType === "incident"
            ? "Incident AI settings"
            : "Alert AI settings",
        );
        // The switches are at the top of the page, not under More settings.
        expect(linked.link?.route.toString()).toBe(settingsPath(subjectType));
        expect(linked.whoCanChange).toBe(
          `A project owner or admin can make these changes in ${
            subjectType === "incident" ? "Incidents" : "Alerts"
          } → AI → Settings.`,
        );
      }
    });

    test("a switch turned on since is said to be on now, with nothing to follow", () => {
      const summary: AiOffSummary = summaryFor({
        subjectType,
        code: "automatic_investigation_disabled",
        remediationReason: "fixing_off",
        switches: { investigate: true, fix: true },
      });

      expect(
        summary.steps.map((item: AiOffStep): [string, boolean] => {
          return [item.text, item.isDone];
        }),
      ).toEqual([
        [`“${investigateTitle}” is on now.`, true],
        [`“${fixTitle}” is on now.`, true],
      ]);
      expect(
        summary.steps.every((item: AiOffStep): boolean => {
          return item.link === null;
        }),
      ).toBe(true);
    });

    test("a switch not known to be on now is worded as one to turn on", () => {
      for (const switches of [
        {},
        { investigate: false, fix: false },
        { investigate: undefined, fix: false },
      ]) {
        const summary: AiOffSummary = summaryFor({
          subjectType,
          code: "automatic_investigation_disabled",
          remediationReason: "fixing_off",
          switches,
        });

        expect(
          summary.steps.map((item: AiOffStep): boolean => {
            return item.isDone;
          }),
        ).toEqual([false, false]);
      }

      // One on now, one still off.
      const mixed: AiOffSummary = summaryFor({
        subjectType,
        code: "automatic_investigation_disabled",
        remediationReason: "fixing_off",
        switches: { investigate: true, fix: false },
      });

      expect(step(mixed, "investigate-switch").isDone).toBe(true);
      expect(step(mixed, "fix-switch").isDone).toBe(false);
    });

    test("fixing is never suggested when nothing said it was off", () => {
      const summary: AiOffSummary = summaryFor({
        subjectType,
        code: "automatic_investigation_disabled",
        remediationReason: "not_recorded",
        switches: { fix: false },
      });

      expect(stepKeys(summary)).toEqual(["investigate-switch"]);
    });

    test("AI off for the project: Enable AI first, on AI Features, then what is still off", () => {
      const summary: AiOffSummary = summaryFor({
        subjectType,
        code: "ai_disabled",
        remediationReason: "ai_off",
        isAiOn: false,
        switches: { investigate: false, fix: false },
      });

      expect(stepKeys(summary)).toEqual([
        "enable-ai",
        "investigate-switch",
        "fix-switch",
      ]);

      const enableAi: AiOffStep = step(summary, "enable-ai");

      expect(enableAi.text).toBe("Turn on “Enable AI”.");
      expect(EnableAiCopy.switchTitle).toBe("Enable AI");
      expect(enableAi.link?.text).toBe("AI Features");
      expect(enableAi.link?.route.toString()).toBe(
        routeFor(PageMap.SETTINGS_AI_FEATURES),
      );
      expect(routeFor(PageMap.SETTINGS_AI_FEATURES)).toBe(
        `/dashboard/${PROJECT_ID}/settings/ai-features`,
      );
      expect(enableAi.whoCanChange).toBe(
        "A project owner or someone with Manage Billing can turn AI on in Project Settings → AI → AI Features.",
      );
      expect(AI_OFF_WHO_CAN_CHANGE.aiSwitch).toBe(EnableAiCopy.whoCanTurnOn);
    });

    test("AI off then: on now is said; the record's switches only when known to be off", () => {
      const onNowAndOn: AiOffSummary = summaryFor({
        subjectType,
        code: "ai_disabled",
        remediationReason: "ai_off",
        isAiOn: true,
        switches: { investigate: true, fix: true },
      });

      expect(stepKeys(onNowAndOn)).toEqual(["enable-ai"]);
      expect(step(onNowAndOn, "enable-ai").text).toBe("“Enable AI” is on now.");
      expect(step(onNowAndOn, "enable-ai").isDone).toBe(true);
      expect(step(onNowAndOn, "enable-ai").link).toBeNull();

      // Unknown: nothing is said about the switches it did not ask about.
      expect(
        stepKeys(
          summaryFor({
            subjectType,
            code: "ai_disabled",
            remediationReason: "ai_off",
            isAiOn: true,
          }),
        ),
      ).toEqual(["enable-ai"]);

      expect(
        stepKeys(
          summaryFor({
            subjectType,
            code: "ai_disabled",
            remediationReason: "ai_off",
            isAiOn: true,
            switches: { investigate: false, fix: false },
          }),
        ),
      ).toEqual(["enable-ai", "investigate-switch", "fix-switch"]);
    });

    test("AI turned off since the record was created: Enable AI is asked for too", () => {
      const summary: AiOffSummary = summaryFor({
        subjectType,
        code: "automatic_investigation_disabled",
        remediationReason: "fixing_off",
        isAiOn: false,
      });

      expect(stepKeys(summary)).toEqual([
        "enable-ai",
        "investigate-switch",
        "fix-switch",
      ]);
      expect(step(summary, "enable-ai").isDone).toBe(false);
    });

    test("matched no AI rule: one rule step, at the AI rules, says both", () => {
      const summary: AiOffSummary = summaryFor({
        subjectType,
        code: "no_investigation_rule_matched",
        remediationReason: "no_rule_matched",
      });

      expect(stepKeys(summary)).toEqual(["investigate-rules"]);

      const rules: AiOffStep = step(summary, "investigate-rules");

      expect(rules.text).toBe(
        `Add or change an AI rule so it matches ${noun}s like this one.`,
      );
      expect(rules.link?.text).toBe(
        subjectType === "incident" ? "Incident AI rules" : "Alert AI rules",
      );
      // The AI rules are under More settings, which opens at them.
      expect(rules.link?.route.toString()).toBe(
        `${settingsPath(subjectType)}#AiRules`,
      );
      expect(rules.whoCanChange).toBe(
        `A project owner or admin, or someone who may edit AI rules, can change them in ${
          subjectType === "incident" ? "Incidents" : "Alerts"
        } → AI → Settings.`,
      );
    });

    test("matched no rule that investigates, and fixing off: the rule, then the switch", () => {
      expect(
        stepKeys(
          summaryFor({
            subjectType,
            code: "no_investigation_rule_matched",
            remediationReason: "fixing_off",
          }),
        ),
      ).toEqual(["investigate-rules", "fix-switch"]);
    });

    test("investigation switch off, and no rule that fixes matched: the switch, then a rule that fixes", () => {
      const summary: AiOffSummary = summaryFor({
        subjectType,
        code: "automatic_investigation_disabled",
        remediationReason: "no_rule_matched",
      });

      expect(stepKeys(summary)).toEqual(["investigate-switch", "fix-rules"]);
      expect(step(summary, "fix-rules").text).toBe(
        `Add or change an AI rule so it fixes ${noun}s like this one.`,
      );
      expect(step(summary, "fix-rules").link?.route.toString()).toBe(
        `${settingsPath(subjectType)}#AiRules`,
      );
    });

    test("the rules that matched only investigate: names the one to set to fix", () => {
      const named: AiOffSummary = summaryFor({
        subjectType,
        code: "automatic_investigation_disabled",
        remediationReason: "rules_do_not_fix",
        ruleName: "Checkout investigations",
      });

      expect(step(named, "fix-rules").text).toBe(
        "Set AI rule “Checkout investigations” to fix too, or add a rule that does.",
      );

      // Without a name, the rule step says what to do in general.
      expect(
        step(
          summaryFor({
            subjectType,
            code: "automatic_investigation_disabled",
            remediationReason: "rules_do_not_fix",
          }),
          "fix-rules",
        ).text,
      ).toBe(`Add or change an AI rule so it fixes ${noun}s like this one.`);
    });

    test("below the minimum severity: change it, under More settings", () => {
      const summary: AiOffSummary = summaryFor({
        subjectType,
        code: "severity_below_threshold",
        remediationReason: "fixing_off",
      });

      expect(stepKeys(summary)).toEqual(["minimum-severity", "fix-switch"]);

      const severity: AiOffStep = step(summary, "minimum-severity");

      expect(severity.text).toBe(
        "Lower or clear the minimum severity for AI investigation.",
      );
      expect(severity.link?.route.toString()).toBe(
        `${settingsPath(subjectType)}#WhichAreInvestigated`,
      );
      expect(severity.link?.text).toBe(
        subjectType === "incident"
          ? "Incident AI settings"
          : "Alert AI settings",
      );
    });

    test("every reason has at least one thing to do", () => {
      for (const code of AI_OFF_INVESTIGATION_CODES) {
        for (const remediationReason of [
          "ai_off",
          "fixing_off",
          "no_rule_matched",
          "rules_do_not_fix",
          "not_recorded",
        ] as Array<RemediationOffReason>) {
          for (const isAiOn of [true, false]) {
            const summary: AiOffSummary = summaryFor({
              subjectType,
              code,
              remediationReason,
              isAiOn,
            });

            expect({
              code,
              remediationReason,
              isAiOn,
              steps: summary.steps.length >= 1,
            }).toEqual({
              code,
              remediationReason,
              isAiOn,
              steps: true,
            });
            // No step twice.
            expect(new Set(stepKeys(summary)).size).toBe(summary.steps.length);
            // Every line it says is a sentence.
            for (const text of [
              summary.title,
              summary.reason,
              summary.note,
              ...summary.steps.map((item: AiOffStep): string => {
                return item.text;
              }),
            ]) {
              expect(text.trim().length).toBeGreaterThan(0);
              expect(text).not.toContain("{{");
            }
          }
        }
      }
    });
  },
);

describe("who may make each change: what the server accepts", () => {
  const PROJECT: Project = new Project();

  function updateOf(column: string): Array<Permission> {
    return [
      ...(PROJECT.getColumnAccessControlFor(column)?.update || []),
    ].sort();
  }

  function permissionsOf(
    summary: AiOffSummary,
    key: AiOffStepKey,
  ): Array<Permission> {
    return [...step(summary, key).permissions].sort();
  }

  test("Enable AI: what its column takes, as its who-can sentence says", () => {
    const summary: AiOffSummary = summaryFor({
      code: "ai_disabled",
      remediationReason: "ai_off",
      isAiOn: false,
    });

    expect(permissionsOf(summary, "enable-ai")).toEqual(updateOf("enableAi"));
    // "A project owner or someone with Manage Billing can turn AI on".
    expect(updateOf("enableAi")).toEqual(
      [Permission.ProjectOwner, Permission.ManageProjectBilling].sort(),
    );
  });

  test.each(SUBJECT_TYPES)(
    "the %s switches and minimum severity: a project owner or admin, as the sentence says",
    (subjectType: AiOffSubjectType) => {
      const columns: { investigate: string; fix: string } =
        getAiLaneSwitchColumns(subjectType);
      const severityColumn: string =
        subjectType === "alert"
          ? "alertInvestigationMinimumSeverity"
          : "incidentInvestigationMinimumSeverity";
      const ownerOrAdmin: Array<Permission> = [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
      ].sort();

      const switches: AiOffSummary = summaryFor({
        subjectType,
        code: "automatic_investigation_disabled",
        remediationReason: "fixing_off",
      });
      const severity: AiOffSummary = summaryFor({
        subjectType,
        code: "severity_below_threshold",
        remediationReason: "not_recorded",
      });

      expect(permissionsOf(switches, "investigate-switch")).toEqual(
        updateOf(columns.investigate),
      );
      expect(permissionsOf(switches, "fix-switch")).toEqual(
        updateOf(columns.fix),
      );
      expect(permissionsOf(severity, "minimum-severity")).toEqual(
        updateOf(severityColumn),
      );

      for (const column of [columns.investigate, columns.fix, severityColumn]) {
        expect({ column, update: updateOf(column) }).toEqual({
          column,
          update: ownerOrAdmin,
        });
      }
    },
  );

  test("the AI rules: creating one or editing one, as the rules table allows", () => {
    const summary: AiOffSummary = summaryFor({
      code: "no_investigation_rule_matched",
      remediationReason: "no_rule_matched",
    });
    const rule: AutoRemediationRule = new AutoRemediationRule();

    expect(permissionsOf(summary, "investigate-rules")).toEqual(
      Array.from(
        new Set<Permission>([
          ...rule.getCreatePermissions(),
          ...rule.getUpdatePermissions(),
        ]),
      ).sort(),
    );
    // "A project owner or admin, or someone who may edit AI rules".
    expect(permissionsOf(summary, "investigate-rules")).toEqual(
      expect.arrayContaining([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.CreateAutoRemediationRule,
        Permission.EditAutoRemediationRule,
      ]),
    );
  });
});

describe("the words are translation keys", () => {
  test("every sentence the line says is a literal key, with only the placeholders it fills", () => {
    const keys: Array<string> = [
      AI_OFF_TITLES.investigationOff,
      AI_OFF_TITLES.projectAiOff,
      ...SUBJECT_TYPES.flatMap((subjectType: AiOffSubjectType) => {
        return [
          ...Object.values(AI_OFF_REASONS[subjectType]),
          AI_OFF_STEP_TEXTS.rulesMatch[subjectType],
          AI_OFF_STEP_TEXTS.rulesFix[subjectType],
          AI_OFF_LINK_TEXTS.settings[subjectType],
          AI_OFF_LINK_TEXTS.rules[subjectType],
          AI_OFF_WHO_CAN_CHANGE.settings[subjectType],
          AI_OFF_WHO_CAN_CHANGE.rules[subjectType],
          AI_OFF_NOTES[subjectType].askAi,
          AI_OFF_NOTES[subjectType].aiOff,
        ];
      }),
      AI_OFF_STEP_TEXTS.turnOnSwitch,
      AI_OFF_STEP_TEXTS.switchIsOnNow,
      AI_OFF_STEP_TEXTS.ruleFixNamed,
      AI_OFF_STEP_TEXTS.minimumSeverity,
      AI_OFF_LINK_TEXTS.aiFeatures,
    ];
    const PLACEHOLDER: RegExp = /\{\{(\w+)\}\}/g;

    for (const key of keys) {
      const placeholders: Array<string> = Array.from(
        key.matchAll(PLACEHOLDER),
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      );

      for (const placeholder of placeholders) {
        expect(["switchName", "ruleName"]).toContain(placeholder);
      }
    }

    // An incident's sentence never says alert, and the other way round.
    for (const value of Object.values(AI_OFF_REASONS.incident)) {
      expect(value).not.toMatch(ALERT_WORD);
    }
    for (const value of Object.values(AI_OFF_REASONS.alert)) {
      expect(value).not.toMatch(INCIDENT_WORD);
    }
  });
});
