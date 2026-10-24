import { describe, expect, test } from "@jest/globals";
import {
  TELEMETRY_AI_INSIGHTS_SCOPES,
  TELEMETRY_AI_INSIGHTS_SCOPES_WHILE_OFF,
  TELEMETRY_AI_LANE_COPY,
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
