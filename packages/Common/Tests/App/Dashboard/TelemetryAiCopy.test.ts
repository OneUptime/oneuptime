import { describe, expect, test } from "@jest/globals";
import {
  TELEMETRY_AI_INSIGHTS_SCOPES,
  TELEMETRY_AI_INSIGHTS_SCOPES_WHILE_OFF,
  TELEMETRY_AI_LANE_COPY,
  TELEMETRY_AI_LOGS_COULD_NOT_LOAD,
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
  getTelemetryAiLogVerdict,
  getTelemetryAiLogVerdictRunIds,
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
   * Logs opt in to saying what each investigation found (master's
   * investigationVerdicts, Exceptions' first): an error log's verdict
   * decides its pull request, so Activity says it - in the very words
   * Exceptions' Logs say it, so the product says one thing one way.
   */
  test("Logs' Activity says what each investigation found, in the words Exceptions' Logs say it", () => {
    const verdicts: Readonly<Partial<Record<ErrorClass, string>>> =
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Log].investigationVerdicts || {};

    expect(Object.keys(verdicts).sort()).toEqual(
      [...Object.values(ErrorClass)].sort(),
    );
    expect(verdicts).toEqual(
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Exception].investigationVerdicts,
    );

    for (const words of Object.values(verdicts)) {
      expect(words!.length).toBeLessThanOrEqual(LINE_LIMIT);
      // What was found, never a promise of a pull request: the rules say that.
      expect(words).not.toContain("pull request");
    }

    expect(verdicts[ErrorClass.CodeFault]).toBe("Found a fault in the code");
    expect(verdicts[ErrorClass.Infrastructure]).toBe(
      "Found a cause outside the code",
    );

    for (const verdict of Object.values(ErrorClass)) {
      expect(
        getTelemetryAiLogVerdict(TelemetryAiLane.Log, {
          kind: TelemetryAiLogKind.Investigation,
          classification: verdict,
        }),
      ).toBe(verdicts[verdict]);
      expect(
        getTelemetryAiLogVerdict(TelemetryAiLane.Log, {
          kind: TelemetryAiLogKind.PullRequest,
          classification: verdict,
        }),
      ).toBeNull();
    }
  });

  /*
   * A finding keeps one verdict, the one its last triage wrote, which the
   * server hands every finished investigation of it: only its newest
   * investigation with a verdict says it, never an older one that may have
   * found otherwise - nor a row without a verdict the lane says.
   */
  test("each finding's verdict is said once, by its newest investigation", () => {
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

    const done: TelemetryAiLogState = TelemetryAiLogState.Done;
    const entries: Array<ReturnType<typeof investigation>> = [
      // Newest first, as the list is: one still on its way has found nothing.
      investigation("r1", "a", TelemetryAiLogState.Working, "code-fault"),
      investigation("r2", "a", done, "code-fault"),
      investigation("r3", "b", done, "infrastructure"),
      investigation("r4", "a", done, "code-fault"),
      {
        ...investigation("r5", "c", done, "code-fault"),
        kind: TelemetryAiLogKind.PullRequest,
      },
      investigation("r6", "c", done, "something-else"),
      investigation("r7", "b", TelemetryAiLogState.Failed),
      investigation("r8", "b", done, "infrastructure"),
    ];

    expect(
      Array.from(getTelemetryAiLogVerdictRunIds(TelemetryAiLane.Log, entries)),
    ).toEqual(["r2", "r3"]);
    // A lane that says no verdict says none, once or at all.
    expect(
      getTelemetryAiLogVerdictRunIds(TelemetryAiLane.Profile, entries).size,
    ).toBe(0);
    expect(getTelemetryAiLogVerdictRunIds(TelemetryAiLane.Log, []).size).toBe(
      0,
    );
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

/*
 * Exceptions' AI section: new and rising exceptions, and the ones with no
 * stack trace. An exception's pull request opens on its own only once the
 * investigation finds the code at fault - or an expected error to handle
 * better - so no line promises one for every exception.
 */
describe("Exceptions' AI section", () => {
  const copy: TelemetryAiLaneCopy =
    TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Exception];

  test("lives under Exceptions: its four pages are Exceptions'", () => {
    expect(TELEMETRY_AI_PAGES[TelemetryAiLane.Exception]).toEqual({
      insights: PageMap.EXCEPTIONS_AI_INSIGHTS,
      insightView: PageMap.EXCEPTIONS_AI_INSIGHT_VIEW,
      logs: PageMap.EXCEPTIONS_AI_LOGS,
      settings: PageMap.EXCEPTIONS_AI_SETTINGS,
    });

    expect(RouteMap[PageMap.EXCEPTIONS_AI_INSIGHTS]?.toString()).toBe(
      "/dashboard/:projectId/exceptions/ai/insights",
    );
    expect(RouteMap[PageMap.EXCEPTIONS_AI_INSIGHT_VIEW]?.toString()).toBe(
      "/dashboard/:projectId/exceptions/ai/insights/:id",
    );
    expect(RouteMap[PageMap.EXCEPTIONS_AI_LOGS]?.toString()).toBe(
      "/dashboard/:projectId/exceptions/ai/logs",
    );
    expect(RouteMap[PageMap.EXCEPTIONS_AI_SETTINGS]?.toString()).toBe(
      "/dashboard/:projectId/exceptions/ai/settings",
    );
  });

  test("its rules are about services, and its notice about new and rising exceptions", () => {
    expect(copy.ruleCriteriaSubject).toBe(RuleCriteriaSubject.Services);
    expect(copy.noticeContext).toBe(ProjectAiNoticeContext.Exceptions);
    expect(
      PROJECT_AI_NOTICE_CONTEXT_COPY[ProjectAiNoticeContext.Exceptions]
        .aiOffDescription,
    ).toContain("New and rising exceptions are still found");
    expect(
      PROJECT_AI_NOTICE_CONTEXT_COPY[ProjectAiNoticeContext.Exceptions]
        .providerConsequence,
    ).toContain("none are looked into or fixed");
  });

  test("its inbox lists its three kinds of finding, opened in its own view", () => {
    expect(TELEMETRY_AI_INSIGHTS_SCOPES[TelemetryAiLane.Exception]).toEqual({
      insightTypes: TELEMETRY_AI_LANES[TelemetryAiLane.Exception].insightTypes,
      viewPage: PageMap.EXCEPTIONS_AI_INSIGHT_VIEW,
      settingsPage: PageMap.EXCEPTIONS_AI_SETTINGS,
      intro: copy.insightsIntro,
      emptyTitle: copy.insightsEmptyTitle,
      emptyDescription: copy.insightsEmptyDescription,
    });
    expect(copy.insightsEmptyTitle).toBe("No new or rising exceptions found");
    expect(copy.insightsIntro).toContain("no stack trace");
  });

  test("while its switch is off, the inbox says so, and names the switch", () => {
    const off: ReturnType<typeof getTelemetryAiInsightsScope> =
      getTelemetryAiInsightsScope(TelemetryAiLane.Exception, true);

    expect(off).toBe(
      TELEMETRY_AI_INSIGHTS_SCOPES_WHILE_OFF[TelemetryAiLane.Exception],
    );
    expect(off.insightTypes).toBe(
      TELEMETRY_AI_INSIGHTS_SCOPES[TelemetryAiLane.Exception].insightTypes,
    );
    expect(off.emptyTitle).toBe("Finding and fixing exceptions is off");
    expect(copy.insightsOffEmptyDescription).toContain(
      TELEMETRY_AI_SWITCHES[TelemetryAiLane.Exception][0]!.title,
    );
    expect(getTelemetryAiInsightsScope(TelemetryAiLane.Exception, false)).toBe(
      TELEMETRY_AI_INSIGHTS_SCOPES[TelemetryAiLane.Exception],
    );
  });

  /*
   * Every project made before the switch has it off, and AI Insights still
   * files its new and rising exceptions in this inbox: above them, the
   * words say the section is off, whose they are, that nothing looks for
   * missing stack traces, and where to turn it on - not that OneUptime
   * looks for missing stack traces every 15 minutes.
   */
  test("while its switch is off, the findings still listed are said to be AI Insights', under the switch's name", () => {
    const off: ReturnType<typeof getTelemetryAiInsightsScope> =
      getTelemetryAiInsightsScope(TelemetryAiLane.Exception, true);

    expect(copy.insightsOffIntro).toBeDefined();
    expect(off.intro).toBe(copy.insightsOffIntro);
    expect(off.intro).toContain(
      `'${TELEMETRY_AI_SWITCHES[TelemetryAiLane.Exception][0]!.title}' is off`,
    );
    expect(off.intro).toContain("AI Insights");
    expect(off.intro).toContain("does not look for missing stack traces");
    expect(off.intro).toContain("AI Settings");
    expect(off.intro).not.toContain("Every 15 minutes");

    // On, the lane's own opening words.
    expect(TELEMETRY_AI_INSIGHTS_SCOPES[TelemetryAiLane.Exception].intro).toBe(
      copy.insightsIntro,
    );
  });

  // The lanes whose kinds nobody finds while they are off keep their words.
  test.each([TelemetryAiLane.Profile, TelemetryAiLane.Trace])(
    "%s keeps its opening words while its switch is off",
    (lane: TelemetryAiLane) => {
      expect(TELEMETRY_AI_LANE_COPY[lane].insightsOffIntro).toBeUndefined();
      expect(TELEMETRY_AI_INSIGHTS_SCOPES_WHILE_OFF[lane].intro).toBe(
        TELEMETRY_AI_INSIGHTS_SCOPES[lane].intro,
      );
    },
  );

  test("its summaries promise a pull request for each exception it can fix, not for each exception", () => {
    for (const line of [
      copy.advancedDefaultsSummary,
      copy.rulesCardDescription,
      copy.noRulesMessage,
    ]) {
      expect(line).toContain("can fix");
      expect(line).not.toMatch(/pull request for each\./u);
    }

    const [exceptionSwitch] = TELEMETRY_AI_SWITCHES[TelemetryAiLane.Exception];

    expect(exceptionSwitch!.description).toContain("fixes what it can");
  });

  test("its switch is the rule turned on by default, named for what it does", () => {
    const [findAndFix] = TELEMETRY_AI_SWITCHES[TelemetryAiLane.Exception];

    expect(findAndFix!.column).toBe("enableAutomaticExceptionRemediation");
    expect(findAndFix!.title).toBe("Find and fix new and rising exceptions");
    expect(findAndFix!.description).toContain("no stack trace");
    expect(findAndFix!.description).toContain("pull request");
    expect(findAndFix!.note).toBe("Needs a repository connected in Code.");
  });

  test("its Fix step's answers: on its own, once the code is found at fault or the error expected", () => {
    const options: Array<CardSelectOption> = getTelemetryAiFixOptions(
      TelemetryAiLane.Exception,
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
      "once it finds the code at fault, or an expected error to handle better",
    );
    expect(copy.fixOptionDescriptions[AiRuleFix.WithoutAsking]).toContain(
      "Nothing is ever merged",
    );
  });

  /*
   * The verdict decides a new or rising exception's pull request - a fix,
   * better handling, or none on its own - so Logs says what each
   * investigation found, for every verdict the investigation may reach.
   */
  test("its Logs say what each investigation found, for every verdict, in a short line", () => {
    const verdicts: Readonly<Partial<Record<ErrorClass, string>>> =
      copy.investigationVerdicts || {};

    expect(Object.keys(verdicts).sort()).toEqual(
      [...Object.values(ErrorClass)].sort(),
    );

    for (const words of Object.values(verdicts)) {
      expect(words!.length).toBeGreaterThan(0);
      expect(words!.length).toBeLessThanOrEqual(LINE_LIMIT);
    }

    expect(verdicts[ErrorClass.CodeFault]).toBe("Found a fault in the code");
    // Both expected errors read as one, each saying which.
    expect(verdicts[ErrorClass.UserError]).toMatch(
      /^Found an expected error: /u,
    );
    expect(verdicts[ErrorClass.ExpectedDenial]).toMatch(
      /^Found an expected error: /u,
    );
    expect(verdicts[ErrorClass.UserError]).not.toBe(
      verdicts[ErrorClass.ExpectedDenial],
    );
    expect(verdicts[ErrorClass.Unknown]).toBe("Could not tell the cause");
  });

  test("a Logs entry's verdict: an investigation's, in its lane's words, and only one the lane words", () => {
    for (const verdict of Object.values(ErrorClass)) {
      expect(
        getTelemetryAiLogVerdict(TelemetryAiLane.Exception, {
          kind: TelemetryAiLogKind.Investigation,
          classification: verdict,
        }),
      ).toBe(copy.investigationVerdicts![verdict]);

      // A pull request is not a verdict, whatever its finding's was.
      expect(
        getTelemetryAiLogVerdict(TelemetryAiLane.Exception, {
          kind: TelemetryAiLogKind.PullRequest,
          classification: verdict,
        }),
      ).toBeNull();
    }

    // No verdict yet, or one the lane has no words for.
    expect(
      getTelemetryAiLogVerdict(TelemetryAiLane.Exception, {
        kind: TelemetryAiLogKind.Investigation,
      }),
    ).toBeNull();
    expect(
      getTelemetryAiLogVerdict(TelemetryAiLane.Exception, {
        kind: TelemetryAiLogKind.Investigation,
        classification: "something-else",
      }),
    ).toBeNull();
  });

  test("Metrics' Logs say what each investigation found, in Exceptions' words, for the three verdicts a metric problem can reach", () => {
    const verdicts: Readonly<Partial<Record<ErrorClass, string>>> =
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Metric].investigationVerdicts ||
      {};
    const exceptions: Readonly<Partial<Record<ErrorClass, string>>> =
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Exception].investigationVerdicts ||
      {};

    expect(Object.keys(verdicts).sort()).toEqual(
      [
        ErrorClass.CodeFault,
        ErrorClass.Infrastructure,
        ErrorClass.Unknown,
      ].sort(),
    );

    for (const verdict of [
      ErrorClass.CodeFault,
      ErrorClass.Infrastructure,
      ErrorClass.Unknown,
    ]) {
      // One wording for one verdict, whichever lane's Logs say it.
      expect(verdicts[verdict]).toBe(exceptions[verdict]);
      expect(
        getTelemetryAiLogVerdict(TelemetryAiLane.Metric, {
          kind: TelemetryAiLogKind.Investigation,
          classification: verdict,
        }),
      ).toBe(verdicts[verdict]);
    }

    // The expected errors are not a metric problem's: nothing is said.
    for (const verdict of [ErrorClass.UserError, ErrorClass.ExpectedDenial]) {
      expect(
        getTelemetryAiLogVerdict(TelemetryAiLane.Metric, {
          kind: TelemetryAiLogKind.Investigation,
          classification: verdict,
        }),
      ).toBeNull();
    }
  });

  test("a lane opts in to saying verdicts: the Profiler's and Traces' Logs say none", () => {
    for (const lane of [TelemetryAiLane.Profile, TelemetryAiLane.Trace]) {
      expect(
        TELEMETRY_AI_LANE_COPY[lane].investigationVerdicts,
      ).toBeUndefined();
      expect(
        getTelemetryAiLogVerdict(lane, {
          kind: TelemetryAiLogKind.Investigation,
          classification: ErrorClass.CodeFault,
        }),
      ).toBeNull();
    }
  });

  test("its rules table has an id of its own, apart from the other lanes'", () => {
    expect(getTelemetryAiRulesTableId(TelemetryAiLane.Exception)).toBe(
      "telemetry-ai-rules-table-Exception",
    );
    expect(
      new Set(
        TELEMETRY_AI_LANE_LIST.map((lane: TelemetryAiLane): string => {
          return getTelemetryAiRulesTableId(lane);
        }),
      ).size,
    ).toBe(TELEMETRY_AI_LANE_LIST.length);
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

describe("Metrics' AI section", () => {
  const copy: TelemetryAiLaneCopy =
    TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Metric];

  test("lives under Metrics: its four pages are Metrics'", () => {
    expect(TELEMETRY_AI_PAGES[TelemetryAiLane.Metric]).toEqual({
      insights: PageMap.METRICS_AI_INSIGHTS,
      insightView: PageMap.METRICS_AI_INSIGHT_VIEW,
      logs: PageMap.METRICS_AI_LOGS,
      settings: PageMap.METRICS_AI_SETTINGS,
    });

    for (const page of Object.values(
      TELEMETRY_AI_PAGES[TelemetryAiLane.Metric],
    )) {
      expect(RouteMap[page]?.toString()).toMatch(
        /^\/dashboard\/:projectId\/metrics\/ai\//u,
      );
    }
  });

  test("its rules are about services, and its notice about problems in metrics", () => {
    expect(copy.ruleCriteriaSubject).toBe(RuleCriteriaSubject.Services);
    expect(copy.noticeContext).toBe(ProjectAiNoticeContext.Metrics);
    expect(
      PROJECT_AI_NOTICE_CONTEXT_COPY[ProjectAiNoticeContext.Metrics]
        .aiOffDescription,
    ).toBe(
      "OneUptime AI is off for this project. Problems in your metrics are still found, but none are looked into and no pull requests are opened.",
    );
  });

  test("its inbox lists its three kinds of finding, opened in its own view, apart from Traces'", () => {
    expect(TELEMETRY_AI_INSIGHTS_SCOPES[TelemetryAiLane.Metric]).toEqual({
      insightTypes: TELEMETRY_AI_LANES[TelemetryAiLane.Metric].insightTypes,
      viewPage: PageMap.METRICS_AI_INSIGHT_VIEW,
      settingsPage: PageMap.METRICS_AI_SETTINGS,
      intro: copy.insightsIntro,
      emptyTitle: copy.insightsEmptyTitle,
      emptyDescription: copy.insightsEmptyDescription,
    });
    expect(copy.insightsEmptyTitle).toBe("No metric problems found");
  });

  test("while its switch is off, the inbox says nothing is looked for, and names the switch", () => {
    const off: ReturnType<typeof getTelemetryAiInsightsScope> =
      getTelemetryAiInsightsScope(TelemetryAiLane.Metric, true);

    expect(off).toBe(
      TELEMETRY_AI_INSIGHTS_SCOPES_WHILE_OFF[TelemetryAiLane.Metric],
    );
    expect(off.insightTypes).toBe(
      TELEMETRY_AI_INSIGHTS_SCOPES[TelemetryAiLane.Metric].insightTypes,
    );
    expect(off.emptyTitle).toBe("OneUptime is not looking for metric problems");
    expect(copy.insightsOffEmptyDescription).toContain(
      TELEMETRY_AI_SWITCHES[TelemetryAiLane.Metric][0]!.title,
    );
  });

  test("its summaries promise a pull request for each problem it can fix, not for each problem", () => {
    for (const line of [
      copy.advancedDefaultsSummary,
      copy.rulesCardDescription,
      copy.noRulesMessage,
    ]) {
      expect(line).toContain("can fix");
      expect(line).not.toMatch(/pull request for each\./u);
    }

    const [metricSwitch] = TELEMETRY_AI_SWITCHES[TelemetryAiLane.Metric];

    expect(metricSwitch!.description).toContain("fixes what it can");
  });

  test("its switch is the rule turned on by default, named for what it does", () => {
    const [improve] = TELEMETRY_AI_SWITCHES[TelemetryAiLane.Metric];

    expect(TELEMETRY_AI_SWITCHES[TelemetryAiLane.Metric]).toHaveLength(1);
    expect(improve!.column).toBe("enableAutomaticMetricRemediation");
    expect(improve!.title).toBe("Improve metrics and add missing ones");
    expect(improve!.description).toBe(
      "Every hour OneUptime looks for metrics to improve and for metrics that are missing. OneUptime AI fixes what it can with pull requests.",
    );
    expect(improve!.note).toBe("Needs a repository connected in Code.");
  });

  test("its Fix step's answers: none waits for a verdict, nothing is merged", () => {
    const options: Array<CardSelectOption> = getTelemetryAiFixOptions(
      TelemetryAiLane.Metric,
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
    expect(copy.fixOptionDescriptions[AiRuleFix.WithoutAsking]).toBe(
      "OneUptime AI opens the pull request on its own. Nothing is ever merged: your team reviews it.",
    );
    expect(copy.fixOptionDescriptions[AiRuleFix.WithoutAsking]).not.toContain(
      "at fault",
    );
  });

  test("its rules table has an id of its own, apart from the other lanes'", () => {
    expect(getTelemetryAiRulesTableId(TelemetryAiLane.Metric)).toBe(
      "telemetry-ai-rules-table-Metric",
    );
    expect(getTelemetryAiRulesTableId(TelemetryAiLane.Metric)).not.toBe(
      getTelemetryAiRulesTableId(TelemetryAiLane.Trace),
    );
  });
});
