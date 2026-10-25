import { describe, expect, test } from "@jest/globals";
import {
  TELEMETRY_AI_INSIGHTS_SCOPES,
  TELEMETRY_AI_INSIGHTS_SCOPES_WHILE_OFF,
  TELEMETRY_AI_LANE_COPY,
  TELEMETRY_AI_LOGS_COULD_NOT_LOAD,
  TELEMETRY_AI_LOG_FINDINGS,
  TELEMETRY_AI_LOG_KIND_LABELS,
  TELEMETRY_AI_LOG_STATE_CLASS_NAMES,
  TELEMETRY_AI_LOG_STATE_LABELS,
  TELEMETRY_AI_PAGES,
  TELEMETRY_AI_READINESS_COPY,
  TELEMETRY_AI_RUNNER_HINT,
  TELEMETRY_AI_SWITCHES,
  TelemetryAiLaneCopy,
  describeTelemetryAiRuleTiming,
  getTelemetryAiFixOptions,
  getTelemetryAiInsightsScope,
  getTelemetryAiLogFinding,
  getTelemetryAiLogFindingRunIds,
  getTelemetryAiRulesTableId,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiCopy";
import { AI_RULE_FIX_OPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/AiRuleCopy";
import { InvestigationRuleTiming } from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/InvestigationRuleTiming";
import {
  PROJECT_AI_NOTICE_CONTEXT_COPY,
  ProjectAiNoticeContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { AiRuleFix } from "../../../Types/AI/AiRule";
import {
  TELEMETRY_AI_LANES,
  TELEMETRY_AI_LANE_LIST,
  TelemetryAiLane,
} from "../../../Types/AI/TelemetryAi";
import {
  TelemetryAiLogKind,
  TelemetryAiLogState,
} from "../../../Types/AI/TelemetryAiActivity";
import { RuleCriteriaSubject } from "../../../Types/Rules/RuleCriteriaSubject";
import ErrorClass from "../../../Types/Telemetry/ErrorClass";
import { CardSelectOption } from "../../../UI/Components/CardSelect/CardSelect";

/*
 * What the AI section of a telemetry product says (TelemetryAiCopy), held
 * here where the short-descriptions guard cannot read it: a lane's words
 * are indexed by the lane, which the guard does not follow. Lines under a
 * label stay within two short lines (150 characters), a card's description
 * within two lines across the page (210), as everywhere else.
 */

const LINE_LIMIT: number = 150;
const CARD_LIMIT: number = 210;

describe("every lane has its words, its pages and its switch", () => {
  test.each(TELEMETRY_AI_LANE_LIST)("%s", (lane: TelemetryAiLane) => {
    const copy: TelemetryAiLaneCopy = TELEMETRY_AI_LANE_COPY[lane];

    expect(copy).toBeDefined();
    expect(TELEMETRY_AI_PAGES[lane]).toBeDefined();
    expect(
      TELEMETRY_AI_SWITCHES[lane].map((entry: { column: string }): string => {
        return entry.column;
      }),
    ).toEqual([TELEMETRY_AI_LANES[lane].switchColumn]);
    expect(PROJECT_AI_NOTICE_CONTEXT_COPY[copy.noticeContext]).toBeDefined();
  });
});

describe("the Profiler's AI section", () => {
  const copy: TelemetryAiLaneCopy =
    TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Profile];

  test("lives under the Profiler: its four pages are the Profiler's", () => {
    expect(TELEMETRY_AI_PAGES[TelemetryAiLane.Profile]).toEqual({
      insights: PageMap.PROFILES_AI_INSIGHTS,
      insightView: PageMap.PROFILES_AI_INSIGHT_VIEW,
      logs: PageMap.PROFILES_AI_LOGS,
      settings: PageMap.PROFILES_AI_SETTINGS,
    });

    expect(RouteMap[PageMap.PROFILES_AI_INSIGHTS]?.toString()).toBe(
      "/dashboard/:projectId/profiles/ai/insights",
    );
    expect(RouteMap[PageMap.PROFILES_AI_INSIGHT_VIEW]?.toString()).toBe(
      "/dashboard/:projectId/profiles/ai/insights/:id",
    );
    expect(RouteMap[PageMap.PROFILES_AI_LOGS]?.toString()).toBe(
      "/dashboard/:projectId/profiles/ai/logs",
    );
    expect(RouteMap[PageMap.PROFILES_AI_SETTINGS]?.toString()).toBe(
      "/dashboard/:projectId/profiles/ai/settings",
    );
  });

  test("its rules are about services, and its notice about slow code", () => {
    expect(copy.ruleCriteriaSubject).toBe(RuleCriteriaSubject.Services);
    expect(copy.noticeContext).toBe(ProjectAiNoticeContext.Profiles);
    expect(
      PROJECT_AI_NOTICE_CONTEXT_COPY[ProjectAiNoticeContext.Profiles]
        .aiOffDescription,
    ).toContain("Slow code is still found");
  });

  test("its inbox lists the lane's own kinds of finding, opened in its own view", () => {
    expect(TELEMETRY_AI_INSIGHTS_SCOPES[TelemetryAiLane.Profile]).toEqual({
      insightTypes: TELEMETRY_AI_LANES[TelemetryAiLane.Profile].insightTypes,
      viewPage: PageMap.PROFILES_AI_INSIGHT_VIEW,
      settingsPage: PageMap.PROFILES_AI_SETTINGS,
      intro: copy.insightsIntro,
      emptyTitle: copy.insightsEmptyTitle,
      emptyDescription: copy.insightsEmptyDescription,
    });
  });

  /*
   * While "Find and fix slow code" is off, nothing is looked for: the
   * inbox's empty state says so and names the switch - the same list, read
   * the same way, only its empty state's words differ.
   */
  test("while its switch is off, the inbox's empty state says nothing is looked for", () => {
    const off: ReturnType<typeof getTelemetryAiInsightsScope> =
      getTelemetryAiInsightsScope(TelemetryAiLane.Profile, true);

    expect(off).toBe(
      TELEMETRY_AI_INSIGHTS_SCOPES_WHILE_OFF[TelemetryAiLane.Profile],
    );
    expect(off).toEqual({
      ...TELEMETRY_AI_INSIGHTS_SCOPES[TelemetryAiLane.Profile],
      emptyTitle: copy.insightsOffEmptyTitle,
      emptyDescription: copy.insightsOffEmptyDescription,
    });
    // The same kinds, the same array: the list is not read again for it.
    expect(off.insightTypes).toBe(
      TELEMETRY_AI_INSIGHTS_SCOPES[TelemetryAiLane.Profile].insightTypes,
    );
    expect(getTelemetryAiInsightsScope(TelemetryAiLane.Profile, false)).toBe(
      TELEMETRY_AI_INSIGHTS_SCOPES[TelemetryAiLane.Profile],
    );
    expect(copy.insightsOffEmptyDescription).toContain(
      TELEMETRY_AI_SWITCHES[TelemetryAiLane.Profile][0]!.title,
    );
  });

  test("its switch is the rule turned on by default, named for what it does", () => {
    const [findAndFix] = TELEMETRY_AI_SWITCHES[TelemetryAiLane.Profile];

    expect(findAndFix!.title).toBe("Find and fix slow code");
    expect(findAndFix!.description).toContain("pull request");
    expect(findAndFix!.note).toBe("Needs a repository connected in Code.");
  });

  test("its Fix step asks the one question every AI rule asks, in pull requests", () => {
    const options: Array<CardSelectOption> = getTelemetryAiFixOptions(
      TelemetryAiLane.Profile,
    );

    // The same answers and titles as every AI rule's: only the lines differ.
    expect(
      options.map((option: CardSelectOption) => {
        return [option.value, option.title, option.icon];
      }),
    ).toEqual(
      AI_RULE_FIX_OPTIONS.map((option: CardSelectOption) => {
        return [option.value, option.title, option.icon];
      }),
    );
    expect(
      options.map((option: CardSelectOption): string => {
        return option.description || "";
      }),
    ).toEqual([
      copy.fixOptionDescriptions[AiRuleFix.DoNotFix],
      copy.fixOptionDescriptions[AiRuleFix.AskFirst],
      copy.fixOptionDescriptions[AiRuleFix.WithoutAsking],
    ]);
    expect(copy.fixOptionDescriptions[AiRuleFix.DoNotFix]).toContain(
      "opens no pull request",
    );
    expect(copy.fixOptionDescriptions[AiRuleFix.AskFirst]).toContain(
      "one click",
    );
    expect(copy.fixOptionDescriptions[AiRuleFix.WithoutAsking]).toContain(
      "Nothing is ever merged",
    );
  });

  test("says why a rule picks no Runner: the repository's own picks it", () => {
    expect(TELEMETRY_AI_RUNNER_HINT).toBe(
      "Pull requests are made on the Runner each repository picks in Code.",
    );
  });

  test("a rule's wait reads as still being found", () => {
    expect(describeTelemetryAiRuleTiming(null)).toBe("Right away");
    expect(describeTelemetryAiRuleTiming(0)).toBe("Right away");
    expect(describeTelemetryAiRuleTiming(1)).toBe(
      "If still found after 1 minute",
    );
    expect(describeTelemetryAiRuleTiming(60)).toBe(
      "If still found after 60 minutes",
    );
    expect(copy.timing[InvestigationRuleTiming.AfterWait].title).toBe(
      "Only if still found after a wait",
    );
  });

  test("its rules table has an id of its own, apart from the incidents' and alerts'", () => {
    expect(getTelemetryAiRulesTableId(TelemetryAiLane.Profile)).toBe(
      "telemetry-ai-rules-table-Profile",
    );
  });
});

describe("the logs' words", () => {
  test("every kind and state has a label, and every state its colours", () => {
    for (const kind of Object.values(TelemetryAiLogKind)) {
      expect(TELEMETRY_AI_LOG_KIND_LABELS[kind]).toBeTruthy();
    }

    for (const state of Object.values(TelemetryAiLogState)) {
      expect(TELEMETRY_AI_LOG_STATE_LABELS[state]).toBeTruthy();
      expect(TELEMETRY_AI_LOG_STATE_CLASS_NAMES[state]).toBeTruthy();
    }

    // "Working" reads as working elsewhere ("the monitor is working").
    expect(TELEMETRY_AI_LOG_STATE_LABELS[TelemetryAiLogState.Working]).toBe(
      "In progress",
    );
  });

  /*
   * A done investigation says what OneUptime AI found: the verdict its
   * triage ended with, in ErrorClass - why a finding whose pull request
   * waits for a fault of the code got one, or did not. One sentence each,
   * true of every lane's findings, and never a promise of a pull request:
   * the rules decide that.
   */
  test("every verdict has a sentence of its own, short, about what was found", () => {
    expect(Object.keys(TELEMETRY_AI_LOG_FINDINGS).sort()).toEqual(
      Object.values(ErrorClass).sort(),
    );

    const sentences: Array<string> = Object.values(TELEMETRY_AI_LOG_FINDINGS);

    expect(new Set(sentences).size).toBe(sentences.length);

    for (const sentence of sentences) {
      expect(sentence.startsWith("OneUptime AI ")).toBe(true);
      expect(sentence.endsWith(".")).toBe(true);
      expect(sentence.length).toBeLessThanOrEqual(LINE_LIMIT);
      expect(sentence).not.toContain("pull request");
    }

    expect(TELEMETRY_AI_LOG_FINDINGS[ErrorClass.CodeFault]).toBe(
      "OneUptime AI found that a change to the code fixes it.",
    );
    expect(TELEMETRY_AI_LOG_FINDINGS[ErrorClass.Infrastructure]).toContain(
      "outside the code",
    );
    expect(TELEMETRY_AI_LOG_FINDINGS[ErrorClass.Unknown]).toBe(
      "OneUptime AI could not tell the cause from the evidence.",
    );
  });

  test("only a done investigation says what was found, and only a verdict it can say right", () => {
    const done: {
      kind: TelemetryAiLogKind;
      state: TelemetryAiLogState;
    } = {
      kind: TelemetryAiLogKind.Investigation,
      state: TelemetryAiLogState.Done,
    };

    for (const errorClass of Object.values(ErrorClass)) {
      expect(
        getTelemetryAiLogFinding({ ...done, classification: errorClass }),
      ).toBe(TELEMETRY_AI_LOG_FINDINGS[errorClass]);
    }

    // No verdict yet, or none the platform's vocabulary holds.
    expect(getTelemetryAiLogFinding(done)).toBeNull();
    expect(
      getTelemetryAiLogFinding({ ...done, classification: "" }),
    ).toBeNull();
    expect(
      getTelemetryAiLogFinding({ ...done, classification: "Actionable" }),
    ).toBeNull();
    expect(
      getTelemetryAiLogFinding({ ...done, classification: "CODE-FAULT" }),
    ).toBeNull();

    // An investigation on its way, stopped or failed has found nothing.
    for (const state of Object.values(TelemetryAiLogState)) {
      if (state === TelemetryAiLogState.Done) {
        continue;
      }

      expect(
        getTelemetryAiLogFinding({
          kind: TelemetryAiLogKind.Investigation,
          state,
          classification: ErrorClass.CodeFault,
        }),
      ).toBeNull();
    }

    // A pull request's row says how it stands, never a verdict.
    expect(
      getTelemetryAiLogFinding({
        kind: TelemetryAiLogKind.PullRequest,
        state: TelemetryAiLogState.Done,
        classification: ErrorClass.CodeFault,
      }),
    ).toBeNull();
  });

  /*
   * A finding keeps one verdict, the one its last triage wrote: only its
   * newest done investigation says it, never an older one that may have
   * found otherwise - nor anything without a verdict to say.
   */
  test("each finding's verdict is said once, by its newest done investigation", () => {
    const investigation: (
      runId: string,
      insightId: string,
      state: TelemetryAiLogState,
      classification?: string,
    ) => {
      runId: string;
      kind: TelemetryAiLogKind;
      state: TelemetryAiLogState;
      classification?: string;
      insight: { id: string };
    } = (
      runId: string,
      insightId: string,
      state: TelemetryAiLogState,
      classification?: string,
    ) => {
      return {
        runId,
        kind: TelemetryAiLogKind.Investigation,
        state,
        ...(classification ? { classification } : {}),
        insight: { id: insightId },
      };
    };

    expect(
      Array.from(
        getTelemetryAiLogFindingRunIds([
          // Newest first, as the list is.
          investigation("r1", "a", TelemetryAiLogState.Working, "code-fault"),
          investigation("r2", "a", TelemetryAiLogState.Done, "code-fault"),
          investigation("r3", "b", TelemetryAiLogState.Done, "infrastructure"),
          investigation("r4", "a", TelemetryAiLogState.Done, "code-fault"),
          {
            ...investigation("r5", "c", TelemetryAiLogState.Done, "code-fault"),
            kind: TelemetryAiLogKind.PullRequest,
          },
          investigation("r6", "c", TelemetryAiLogState.Done, "Actionable"),
          investigation("r7", "b", TelemetryAiLogState.Failed),
          investigation("r8", "b", TelemetryAiLogState.Done, "infrastructure"),
        ]),
      ),
    ).toEqual(["r2", "r3"]);

    expect(getTelemetryAiLogFindingRunIds([]).size).toBe(0);
  });

  test("a failed read names the page as its lane does: Activity in Logs, the AI logs elsewhere", () => {
    expect(TELEMETRY_AI_LOGS_COULD_NOT_LOAD).toBe(
      "Could not load the AI logs: {{error}}",
    );
    expect(TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Log].logsCouldNotLoad).toBe(
      "Could not load the AI activity: {{error}}",
    );
    expect(
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Profile].logsCouldNotLoad,
    ).toBeUndefined();
    expect(
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Trace].logsCouldNotLoad,
    ).toBeUndefined();
  });
});

describe("every description is short", () => {
  test.each(TELEMETRY_AI_LANE_LIST)("%s", (lane: TelemetryAiLane) => {
    const copy: TelemetryAiLaneCopy = TELEMETRY_AI_LANE_COPY[lane];

    const lines: Record<string, string> = {
      insightsEmptyDescription: copy.insightsEmptyDescription,
      insightsOffEmptyTitle: copy.insightsOffEmptyTitle,
      insightsOffEmptyDescription: copy.insightsOffEmptyDescription,
      logsEmptyDescription: copy.logsEmptyDescription,
      advancedDescription: copy.advancedDescription,
      advancedDefaultsSummary: copy.advancedDefaultsSummary,
      noRulesMessage: copy.noRulesMessage,
      waitDescription: copy.waitDescription,
      rightAway: copy.timing[InvestigationRuleTiming.RightAway].description,
      afterWait: copy.timing[InvestigationRuleTiming.AfterWait].description,
      doNotFix: copy.fixOptionDescriptions[AiRuleFix.DoNotFix],
      askFirst: copy.fixOptionDescriptions[AiRuleFix.AskFirst],
      withoutAsking: copy.fixOptionDescriptions[AiRuleFix.WithoutAsking],
      runnerHint: TELEMETRY_AI_RUNNER_HINT,
      connectRepository: TELEMETRY_AI_READINESS_COPY.connectRepository,
    };

    for (const entry of TELEMETRY_AI_SWITCHES[lane]) {
      lines[`switch ${entry.column}`] = entry.description;
    }

    const cards: Record<string, string> = {
      switchesCardDescription: copy.switchesCardDescription,
      rulesCardDescription: copy.rulesCardDescription,
    };

    const tooLong: Array<string> = [
      ...Object.entries(lines)
        .filter(([, text]: [string, string]): boolean => {
          return text.length > LINE_LIMIT;
        })
        .map(([name, text]: [string, string]): string => {
          return `${name}: ${text.length} > ${LINE_LIMIT}`;
        }),
      ...Object.entries(cards)
        .filter(([, text]: [string, string]): boolean => {
          return text.length > CARD_LIMIT;
        })
        .map(([name, text]: [string, string]): string => {
          return `${name}: ${text.length} > ${CARD_LIMIT}`;
        }),
    ];

    expect(tooLong).toEqual([]);
  });
});

describe("Traces' AI section", () => {
  const copy: TelemetryAiLaneCopy =
    TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Trace];

  test("lives under Traces: its four pages are Traces'", () => {
    expect(TELEMETRY_AI_PAGES[TelemetryAiLane.Trace]).toEqual({
      insights: PageMap.TRACES_AI_INSIGHTS,
      insightView: PageMap.TRACES_AI_INSIGHT_VIEW,
      logs: PageMap.TRACES_AI_LOGS,
      settings: PageMap.TRACES_AI_SETTINGS,
    });
  });

  test("its rules are about services, and its notice about slow and failing operations", () => {
    expect(copy.ruleCriteriaSubject).toBe(RuleCriteriaSubject.Services);
    expect(copy.noticeContext).toBe(ProjectAiNoticeContext.Traces);
    expect(
      PROJECT_AI_NOTICE_CONTEXT_COPY[ProjectAiNoticeContext.Traces]
        .aiOffDescription,
    ).toContain("Slow and failing operations are still found");
  });

  test("its inbox lists its three kinds of finding, opened in its own view, apart from the Profiler's", () => {
    expect(TELEMETRY_AI_INSIGHTS_SCOPES[TelemetryAiLane.Trace]).toEqual({
      insightTypes: TELEMETRY_AI_LANES[TelemetryAiLane.Trace].insightTypes,
      viewPage: PageMap.TRACES_AI_INSIGHT_VIEW,
      settingsPage: PageMap.TRACES_AI_SETTINGS,
      intro: copy.insightsIntro,
      emptyTitle: copy.insightsEmptyTitle,
      emptyDescription: copy.insightsEmptyDescription,
    });
    expect(copy.insightsEmptyTitle).toBe("No slow or failing operations found");
  });

  test("while its switch is off, the inbox says nothing is looked for, and names the switch", () => {
    const off: ReturnType<typeof getTelemetryAiInsightsScope> =
      getTelemetryAiInsightsScope(TelemetryAiLane.Trace, true);

    expect(off).toBe(
      TELEMETRY_AI_INSIGHTS_SCOPES_WHILE_OFF[TelemetryAiLane.Trace],
    );
    expect(off.insightTypes).toBe(
      TELEMETRY_AI_INSIGHTS_SCOPES[TelemetryAiLane.Trace].insightTypes,
    );
    expect(off.emptyTitle).toBe(
      "OneUptime is not looking for slow and failing operations",
    );
    expect(copy.insightsOffEmptyDescription).toContain(
      TELEMETRY_AI_SWITCHES[TelemetryAiLane.Trace][0]!.title,
    );
  });

  /*
   * A failing operation's pull request waits for the code to be found at
   * fault, and a fix may find nothing to change: no line may promise a pull
   * request for every problem.
   */
  test("its summaries promise a pull request for each problem it can fix, not for each problem", () => {
    for (const line of [
      copy.advancedDefaultsSummary,
      copy.rulesCardDescription,
      copy.noRulesMessage,
    ]) {
      expect(line).toContain("can fix");
      expect(line).not.toMatch(/pull request for each\./u);
      expect(line).not.toContain("a pull request opened for it.");
    }

    const [traceSwitch] = TELEMETRY_AI_SWITCHES[TelemetryAiLane.Trace];

    expect(traceSwitch!.description).toContain("fixes what it can");
    expect(traceSwitch!.description).not.toContain("to fix each");
  });

  test("its switch is the rule turned on by default, named for what it does", () => {
    const [findAndFix] = TELEMETRY_AI_SWITCHES[TelemetryAiLane.Trace];

    expect(findAndFix!.column).toBe("enableAutomaticTraceRemediation");
    expect(findAndFix!.title).toBe("Find and fix slow and failing operations");
    expect(findAndFix!.description).toContain("missing tracing");
    expect(findAndFix!.description).toContain("pull request");
    expect(findAndFix!.note).toBe("Needs a repository connected in Code.");
  });

  test("its Fix step's answers, in its words: a failing operation's pull request waits for the code to be found at fault", () => {
    const options: Array<CardSelectOption> = getTelemetryAiFixOptions(
      TelemetryAiLane.Trace,
    );

    expect(
      options.map((option: CardSelectOption) => {
        return [option.value, option.title, option.icon];
      }),
    ).toEqual(
      AI_RULE_FIX_OPTIONS.map((option: CardSelectOption) => {
        return [option.value, option.title, option.icon];
      }),
    );
    expect(copy.fixOptionDescriptions[AiRuleFix.DoNotFix]).toContain(
      "opens no pull request",
    );
    expect(copy.fixOptionDescriptions[AiRuleFix.AskFirst]).toContain(
      "one click",
    );
    expect(copy.fixOptionDescriptions[AiRuleFix.WithoutAsking]).toContain(
      "for a failing operation once it finds the code at fault",
    );
    expect(copy.fixOptionDescriptions[AiRuleFix.WithoutAsking]).toContain(
      "Nothing is ever merged",
    );
  });

  test("its rules table has an id of its own, apart from the Profiler's", () => {
    expect(getTelemetryAiRulesTableId(TelemetryAiLane.Trace)).toBe(
      "telemetry-ai-rules-table-Trace",
    );
    expect(getTelemetryAiRulesTableId(TelemetryAiLane.Trace)).not.toBe(
      getTelemetryAiRulesTableId(TelemetryAiLane.Profile),
    );
  });
});

describe("Logs' AI section", () => {
  const copy: TelemetryAiLaneCopy = TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Log];

  /*
   * Its record of what OneUptime AI did is Activity: inside Logs, a page
   * called Logs would read as log lines.
   */
  test("lives under Logs: its four pages are Logs', its logs page Activity", () => {
    expect(TELEMETRY_AI_PAGES[TelemetryAiLane.Log]).toEqual({
      insights: PageMap.LOGS_AI_INSIGHTS,
      insightView: PageMap.LOGS_AI_INSIGHT_VIEW,
      logs: PageMap.LOGS_AI_ACTIVITY,
      settings: PageMap.LOGS_AI_SETTINGS,
    });
    expect(RouteMap[PageMap.LOGS_AI_ACTIVITY]?.toString()).toBe(
      "/dashboard/:projectId/logs/ai/activity",
    );
  });

  test("its rules are about services, and its notice about error, missing and noisy logs", () => {
    expect(copy.ruleCriteriaSubject).toBe(RuleCriteriaSubject.Services);
    expect(copy.noticeContext).toBe(ProjectAiNoticeContext.Logs);
    expect(
      PROJECT_AI_NOTICE_CONTEXT_COPY[ProjectAiNoticeContext.Logs]
        .aiOffDescription,
    ).toContain("Error, missing and noisy logs are still found");
    expect(
      PROJECT_AI_NOTICE_CONTEXT_COPY[ProjectAiNoticeContext.Logs]
        .providerConsequence,
    ).toContain("none are looked into or fixed");
  });

  test("its inbox lists its three kinds of finding, opened in its own view, apart from the others'", () => {
    expect(TELEMETRY_AI_INSIGHTS_SCOPES[TelemetryAiLane.Log]).toEqual({
      insightTypes: TELEMETRY_AI_LANES[TelemetryAiLane.Log].insightTypes,
      viewPage: PageMap.LOGS_AI_INSIGHT_VIEW,
      settingsPage: PageMap.LOGS_AI_SETTINGS,
      intro: copy.insightsIntro,
      emptyTitle: copy.insightsEmptyTitle,
      emptyDescription: copy.insightsEmptyDescription,
    });
    expect(copy.insightsEmptyTitle).toBe(
      "No error, missing or noisy logs found",
    );
  });

  /*
   * The inbox says what OneUptime checks the logs for in the switch's own
   * words, so Insights and Settings name the same three problems the same
   * way.
   */
  test("its inbox intro names the three problems as the switch does", () => {
    const words: string = "repeated errors, unlogged failures and noisy lines";

    expect(copy.insightsIntro).toBe(
      "Every hour OneUptime checks your services' logs for repeated errors, unlogged failures and noisy lines, and files what it finds here with the evidence. OneUptime AI looks into each finding and opens a pull request to fix it, as your AI settings say.",
    );
    expect(copy.insightsIntro).toContain(words);
    expect(
      TELEMETRY_AI_SWITCHES[TelemetryAiLane.Log][0]!.description,
    ).toContain(words);
  });

  test("while its switch is off, the inbox says nothing is looked for, and names the switch", () => {
    const off: ReturnType<typeof getTelemetryAiInsightsScope> =
      getTelemetryAiInsightsScope(TelemetryAiLane.Log, true);

    expect(off).toBe(
      TELEMETRY_AI_INSIGHTS_SCOPES_WHILE_OFF[TelemetryAiLane.Log],
    );
    expect(off.insightTypes).toBe(
      TELEMETRY_AI_INSIGHTS_SCOPES[TelemetryAiLane.Log].insightTypes,
    );
    expect(off.emptyTitle).toBe(
      "OneUptime is not looking for error, missing or noisy logs",
    );
    expect(copy.insightsOffEmptyDescription).toContain(
      TELEMETRY_AI_SWITCHES[TelemetryAiLane.Log][0]!.title,
    );
    expect(getTelemetryAiInsightsScope(TelemetryAiLane.Log, false)).toBe(
      TELEMETRY_AI_INSIGHTS_SCOPES[TelemetryAiLane.Log],
    );
  });

  /*
   * An error log's pull request waits for the code to be found at fault,
   * and a fix may find nothing to change: no line may promise a pull
   * request for every problem.
   */
  test("its summaries promise a pull request for each problem it can fix, not for each problem", () => {
    for (const line of [
      copy.advancedDefaultsSummary,
      copy.rulesCardDescription,
      copy.noRulesMessage,
    ]) {
      expect(line).toContain("can fix");
      expect(line).not.toMatch(/pull request for each\./u);
    }

    const [logSwitch] = TELEMETRY_AI_SWITCHES[TelemetryAiLane.Log];

    expect(logSwitch!.description).toContain("fixes what it can");
  });

  test("its switch is the rule turned on by default, named for the three kinds", () => {
    const [findAndFix] = TELEMETRY_AI_SWITCHES[TelemetryAiLane.Log];

    expect(findAndFix!.column).toBe("enableAutomaticLogRemediation");
    expect(findAndFix!.title).toBe(
      "Find and fix error, missing and noisy logs",
    );
    expect(findAndFix!.description).toContain("repeated errors");
    expect(findAndFix!.description).toContain("unlogged failures");
    expect(findAndFix!.description).toContain("noisy lines");
    expect(findAndFix!.note).toBe("Needs a repository connected in Code.");
  });

  test("its Fix step's answers, in its words: an error log's pull request waits for the code to be found at fault", () => {
    const options: Array<CardSelectOption> = getTelemetryAiFixOptions(
      TelemetryAiLane.Log,
    );

    expect(
      options.map((option: CardSelectOption) => {
        return [option.value, option.title, option.icon];
      }),
    ).toEqual(
      AI_RULE_FIX_OPTIONS.map((option: CardSelectOption) => {
        return [option.value, option.title, option.icon];
      }),
    );
    expect(copy.fixOptionDescriptions[AiRuleFix.WithoutAsking]).toContain(
      "for an error log once it finds the code at fault",
    );
    expect(copy.fixOptionDescriptions[AiRuleFix.WithoutAsking]).toContain(
      "Nothing is ever merged",
    );
  });

  test("its rules table has an id of its own, apart from the other lanes'", () => {
    expect(getTelemetryAiRulesTableId(TelemetryAiLane.Log)).toBe(
      "telemetry-ai-rules-table-Log",
    );
  });
});
