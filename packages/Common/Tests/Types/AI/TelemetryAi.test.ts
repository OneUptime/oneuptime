/*
 * What OneUptime AI does with a problem a telemetry product found
 * (Types/AI/TelemetryAi): the shared piece the Profiles AI section is
 * built on, and the one Traces, Exceptions, Logs and Metrics reuse.
 *
 * Pinned here:
 *  - the Profile lane: its insight type, its rules' trigger, its switch and
 *    how often it looks;
 *  - the decision: Enable AI first, then the lane's switch, then the rules -
 *    none is "investigate and fix everything" (the rule turned on by
 *    default), with rules only what they match, the careful Fix answer
 *    winning, the shortest wait, the rules' repositories, MCP servers and
 *    LLM provider;
 *  - what to do now for one problem: one triage and one fix, ever, after the
 *    wait, only while the problem is still being found, and never for a
 *    problem a person closed.
 */

import AIInsightType from "../../../Types/AI/AIInsightType";
import { AiRuleFix } from "../../../Types/AI/AiRule";
import {
  INSIGHT_SCAN_EVERY_MINUTES,
  STILL_FOUND_TICKS,
  TELEMETRY_AI_LANES,
  TELEMETRY_AI_LANE_LIST,
  TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY,
  TELEMETRY_AI_MAX_PROBLEMS_PER_SWEEP,
  TelemetryAiLane,
  TelemetryAiNextSteps,
  TelemetryAiProblemState,
  TelemetryAiRuleFacts,
  TelemetryAiSkip,
  TelemetryAiWork,
  decideTelemetryAiWork,
  getAiInsightDashboardPath,
  getStillFoundMinutes,
  getTelemetryAiInsightTypes,
  getTelemetryAiLaneOfInsightType,
  getTelemetryAiLaneOfTrigger,
  getTelemetryAiNextSteps,
  isTelemetryAiLane,
  isTelemetryAiLaneScanTick,
  isTelemetryAiWorkToDo,
} from "../../../Types/AI/TelemetryAi";
import AutoRemediationExecutionMode from "../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationTriggerEntity from "../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import {
  EVERY_CODE_REPOSITORY,
  NO_CODE_REPOSITORY,
} from "../../../Types/CodeRepository/CodeRepositoryAllowance";
import {
  EVERY_EXTERNAL_MCP_SERVER,
  NO_EXTERNAL_MCP_SERVER,
} from "../../../Types/AI/ExternalMcpServer/ExternalMcpServerAllowance";
import { isProfileInsightScanTick } from "../../../Utils/Profiles/ProfileInsight";
import { describe, expect, test } from "@jest/globals";

const REPO_A: string = "11111111-1111-4111-8111-111111111111";
const REPO_B: string = "22222222-2222-4222-8222-222222222222";
const MCP_A: string = "33333333-3333-4333-8333-333333333333";
const LLM_A: string = "44444444-4444-4444-8444-444444444444";
const LLM_B: string = "55555555-5555-4555-8555-555555555555";

// A rule as the dashboard saves one: it investigates, and fixes or not.
function rule(
  overrides: Partial<TelemetryAiRuleFacts> = {},
): TelemetryAiRuleFacts {
  return {
    _id: "66666666-6666-4666-8666-666666666666",
    name: "Every service",
    investigates: true,
    fixes: true,
    executionMode: AutoRemediationExecutionMode.FullAuto,
    onlyIfOpenAfterMinutes: null,
    codeRepositories: [],
    externalMcpServers: [],
    llmProviderId: null,
    ...overrides,
  };
}

function decide(
  matchingRules: Array<TelemetryAiRuleFacts>,
  rulesSetUp: boolean = true,
): TelemetryAiWork {
  return decideTelemetryAiWork({
    isAiEnabled: true,
    isLaneOn: true,
    rules: { rulesSetUp, matchingRules },
  });
}

describe("the Profile lane", () => {
  test("files slow code, decides with profile AI rules, and is switched by its own column", () => {
    expect(TELEMETRY_AI_LANES[TelemetryAiLane.Profile]).toEqual({
      lane: TelemetryAiLane.Profile,
      triggerEntityType: AutoRemediationTriggerEntity.Profile,
      insightTypes: [AIInsightType.ProfileHotspot],
      switchColumn: "enableAutomaticProfileRemediation",
      scanEveryMinutes: 60,
      dashboardPath: "profiles",
    });
  });

  test("a lane's insight opens in the lane's product; every other insight in AI Insights", () => {
    expect(
      getAiInsightDashboardPath({
        projectId: "p1",
        insightId: "i1",
        insightType: AIInsightType.ProfileHotspot,
      }),
    ).toBe("/p1/profiles/ai/insights/i1");

    for (const insightType of [
      AIInsightType.NewException,
      AIInsightType.TraceLatencyRegression,
      undefined,
      "Unknown",
    ]) {
      expect(
        getAiInsightDashboardPath({
          projectId: "p1",
          insightId: "i1",
          insightType,
        }),
      ).toBe("/p1/ai/insights/i1");
    }
  });

  test("every lane is listed, and each one's definition names it", () => {
    expect(TELEMETRY_AI_LANE_LIST).toEqual(Object.values(TelemetryAiLane));

    for (const lane of TELEMETRY_AI_LANE_LIST) {
      expect(TELEMETRY_AI_LANES[lane].lane).toBe(lane);
      expect(TELEMETRY_AI_LANES[lane].insightTypes.length).toBeGreaterThan(0);
    }
  });

  test("an insight type belongs to at most one lane", () => {
    const types: Array<AIInsightType> = getTelemetryAiInsightTypes();

    expect(new Set(types).size).toBe(types.length);
  });

  test("a lane's insight types and its rules lead back to it", () => {
    expect(getTelemetryAiLaneOfInsightType(AIInsightType.ProfileHotspot)).toBe(
      TelemetryAiLane.Profile,
    );
    expect(
      getTelemetryAiLaneOfTrigger(AutoRemediationTriggerEntity.Profile),
    ).toBe(TelemetryAiLane.Profile);
  });

  test("incident and alert AI rules, and AI Insights' own findings, belong to no lane", () => {
    for (const type of [
      AIInsightType.NewException,
      AIInsightType.ExceptionSpike,
      AIInsightType.ErrorLogSpike,
      AIInsightType.TraceLatencyRegression,
      AIInsightType.MetricDrift,
      AIInsightType.DeployRegression,
    ]) {
      expect(getTelemetryAiLaneOfInsightType(type)).toBeNull();
    }

    expect(
      getTelemetryAiLaneOfTrigger(AutoRemediationTriggerEntity.Incident),
    ).toBeNull();
    expect(
      getTelemetryAiLaneOfTrigger(AutoRemediationTriggerEntity.Alert),
    ).toBeNull();
    expect(getTelemetryAiLaneOfInsightType("ProfileHotspot ")).toBeNull();
    expect(getTelemetryAiLaneOfInsightType(undefined)).toBeNull();
  });

  test("isTelemetryAiLane reads exact values only", () => {
    expect(isTelemetryAiLane("Profile")).toBe(true);
    expect(isTelemetryAiLane("profile")).toBe(false);
    expect(isTelemetryAiLane("Incident")).toBe(false);
    expect(isTelemetryAiLane(null)).toBe(false);
  });
});

describe("the limits that keep it quiet", () => {
  test("at most five pull requests a day, fifty problems a look, found again within two looks", () => {
    expect(TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY).toBe(5);
    expect(TELEMETRY_AI_MAX_PROBLEMS_PER_SWEEP).toBe(50);
    expect(STILL_FOUND_TICKS).toBe(2);
    expect(getStillFoundMinutes(TelemetryAiLane.Profile)).toBe(120);
  });
});

describe("isTelemetryAiLaneScanTick", () => {
  test("Profiles looks on the scanner's first look of each hour (UTC)", () => {
    for (let minute: number = 0; minute < 60; minute++) {
      const now: Date = new Date(Date.UTC(2026, 9, 24, 7, minute, 30));

      expect(isTelemetryAiLaneScanTick(TelemetryAiLane.Profile, now)).toBe(
        minute < INSIGHT_SCAN_EVERY_MINUTES,
      );
    }
  });

  test("agrees with the profile detector's own tick, every minute of a day", () => {
    for (let minuteOfDay: number = 0; minuteOfDay < 24 * 60; minuteOfDay++) {
      const now: Date = new Date(Date.UTC(2026, 9, 24, 0, minuteOfDay, 0));

      expect(isTelemetryAiLaneScanTick(TelemetryAiLane.Profile, now)).toBe(
        isProfileInsightScanTick(now),
      );
    }
  });
});

describe("decideTelemetryAiWork - the switches", () => {
  test("Enable AI off: nothing, whatever else says", () => {
    const work: TelemetryAiWork = decideTelemetryAiWork({
      isAiEnabled: false,
      isLaneOn: true,
      rules: { rulesSetUp: false, matchingRules: [] },
    });

    expect(work.skip).toBe(TelemetryAiSkip.AiOff);
    expect(work.investigate).toBe(false);
    expect(work.fix).toBe(AiRuleFix.DoNotFix);
    expect(work.repositories).toEqual(NO_CODE_REPOSITORY);
    expect(isTelemetryAiWorkToDo(work)).toBe(false);
  });

  test("the lane's switch off: nothing", () => {
    const work: TelemetryAiWork = decideTelemetryAiWork({
      isAiEnabled: true,
      isLaneOn: false,
      rules: { rulesSetUp: true, matchingRules: [rule()] },
    });

    expect(work.skip).toBe(TelemetryAiSkip.LaneOff);
    expect(isTelemetryAiWorkToDo(work)).toBe(false);
  });

  test("rules that could not be read: nothing a rule may have kept out", () => {
    const work: TelemetryAiWork = decideTelemetryAiWork({
      isAiEnabled: true,
      isLaneOn: true,
      rules: null,
    });

    expect(work.skip).toBe(TelemetryAiSkip.RulesUnreadable);
    expect(isTelemetryAiWorkToDo(work)).toBe(false);
  });

  test("Enable AI is asked first, then the switch, then the rules", () => {
    expect(
      decideTelemetryAiWork({
        isAiEnabled: false,
        isLaneOn: false,
        rules: null,
      }).skip,
    ).toBe(TelemetryAiSkip.AiOff);
    expect(
      decideTelemetryAiWork({ isAiEnabled: true, isLaneOn: false, rules: null })
        .skip,
    ).toBe(TelemetryAiSkip.LaneOff);
  });
});

describe("decideTelemetryAiWork - no rule: the rule turned on by default", () => {
  test("investigate and fix without asking, right away, in any repository, with the default provider", () => {
    const work: TelemetryAiWork = decide([], false);

    expect(work).toEqual({
      skip: null,
      investigate: true,
      fix: AiRuleFix.WithoutAsking,
      waitMinutes: 0,
      investigationRepositories: EVERY_CODE_REPOSITORY,
      mcpServers: EVERY_EXTERNAL_MCP_SERVER,
      repositories: EVERY_CODE_REPOSITORY,
      llmProviderId: "",
      rules: [],
    });
    expect(isTelemetryAiWorkToDo(work)).toBe(true);
  });
});

describe("decideTelemetryAiWork - with rules", () => {
  test("rules set up and none matching: the problem is left alone", () => {
    const work: TelemetryAiWork = decide([]);

    expect(work.skip).toBe(TelemetryAiSkip.NoMatchingRule);
    expect(work.investigate).toBe(false);
    expect(work.fix).toBe(AiRuleFix.DoNotFix);
    expect(isTelemetryAiWorkToDo(work)).toBe(false);
  });

  test("a matching rule that fixes without asking: investigate and open the pull request", () => {
    const work: TelemetryAiWork = decide([rule()]);

    expect(work.skip).toBeNull();
    expect(work.investigate).toBe(true);
    expect(work.fix).toBe(AiRuleFix.WithoutAsking);
    expect(work.repositories).toEqual(EVERY_CODE_REPOSITORY);
  });

  test("a matching rule that asks first: the fix is offered, never opened on its own", () => {
    const work: TelemetryAiWork = decide([
      rule({ executionMode: AutoRemediationExecutionMode.Suggest }),
    ]);

    expect(work.fix).toBe(AiRuleFix.AskFirst);
  });

  test("a matching rule that does not fix: investigated only, and no repository to open in", () => {
    const work: TelemetryAiWork = decide([
      rule({ fixes: false, codeRepositories: [{ _id: REPO_A }] }),
    ]);

    expect(work.investigate).toBe(true);
    expect(work.fix).toBe(AiRuleFix.DoNotFix);
    expect(work.repositories).toEqual(NO_CODE_REPOSITORY);
    // It may still read the repository it names while it investigates.
    expect(work.investigationRepositories).toEqual({
      isEveryRepository: false,
      repositoryIds: [REPO_A],
    });
    expect(isTelemetryAiWorkToDo(work)).toBe(true);
  });

  test("the careful answer wins: one rule asking first makes the fix wait for a person", () => {
    const work: TelemetryAiWork = decide([
      rule({
        name: "Fixes",
        executionMode: AutoRemediationExecutionMode.FullAuto,
      }),
      rule({
        name: "Asks",
        executionMode: AutoRemediationExecutionMode.Suggest,
      }),
    ]);

    expect(work.fix).toBe(AiRuleFix.AskFirst);
  });

  test("a rule that does not fix does not stop another from fixing", () => {
    const work: TelemetryAiWork = decide([
      rule({ name: "Looks", fixes: false }),
      rule({ name: "Fixes" }),
    ]);

    expect(work.fix).toBe(AiRuleFix.WithoutAsking);
  });

  test("a rule that only fixes is not investigated - unless another matching rule investigates", () => {
    expect(decide([rule({ investigates: false })]).investigate).toBe(false);
    expect(decide([rule({ investigates: false })]).fix).toBe(
      AiRuleFix.WithoutAsking,
    );
    expect(
      decide([rule({ investigates: false }), rule({ fixes: false })])
        .investigate,
    ).toBe(true);
  });

  test("the shortest wait of the matching rules decides, and none when one has none", () => {
    expect(decide([rule({ onlyIfOpenAfterMinutes: 120 })]).waitMinutes).toBe(
      120,
    );
    expect(
      decide([
        rule({ onlyIfOpenAfterMinutes: 120 }),
        rule({ onlyIfOpenAfterMinutes: 30 }),
      ]).waitMinutes,
    ).toBe(30);
    expect(
      decide([
        rule({ onlyIfOpenAfterMinutes: 120 }),
        rule({ onlyIfOpenAfterMinutes: null }),
      ]).waitMinutes,
    ).toBe(0);
  });

  test("a pull request opens only in the repositories the fixing rules name", () => {
    const work: TelemetryAiWork = decide([
      rule({ name: "A", codeRepositories: [{ _id: REPO_A }] }),
      rule({ name: "B", codeRepositories: [REPO_B] }),
      rule({ name: "C", fixes: false, codeRepositories: [{ _id: "x" }] }),
    ]);

    expect(work.repositories).toEqual({
      isEveryRepository: false,
      repositoryIds: [REPO_A, REPO_B],
    });
  });

  test("a fixing rule that names no repository lets it open in any of them", () => {
    const work: TelemetryAiWork = decide([
      rule({ name: "A", codeRepositories: [{ _id: REPO_A }] }),
      rule({ name: "B", codeRepositories: [] }),
    ]);

    expect(work.repositories).toEqual(EVERY_CODE_REPOSITORY);
  });

  test("the investigation may use the MCP servers the investigating rules name", () => {
    expect(
      decide([rule({ externalMcpServers: [{ _id: MCP_A }] })]).mcpServers,
    ).toEqual({ isEveryServer: false, serverIds: [MCP_A] });
    expect(decide([rule()]).mcpServers).toEqual(EVERY_EXTERNAL_MCP_SERVER);
    expect(
      decide([rule({ investigates: false, externalMcpServers: [MCP_A] })])
        .mcpServers,
    ).toEqual(NO_EXTERNAL_MCP_SERVER);
  });

  test("the LLM provider is the pick of the first matching rule by name that picks one", () => {
    expect(decide([rule()]).llmProviderId).toBe("");
    expect(
      decide([
        rule({ name: "Zeta", llmProviderId: LLM_B }),
        rule({ name: "Alpha", llmProviderId: LLM_A }),
        rule({ name: "Aaa (picks none)" }),
      ]).llmProviderId,
    ).toBe(LLM_A);
  });

  test("the matching rules are handed on, for what a log line says", () => {
    const matching: Array<TelemetryAiRuleFacts> = [rule({ name: "Mine" })];

    expect(decide(matching).rules).toEqual(matching);
  });
});

describe("getTelemetryAiNextSteps", () => {
  const NOW: Date = new Date(Date.UTC(2026, 9, 24, 9, 5, 0));
  const lane: TelemetryAiLane = TelemetryAiLane.Profile;

  function problem(
    overrides: Partial<TelemetryAiProblemState> = {},
  ): TelemetryAiProblemState {
    return {
      firstSeenAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
      lastSeenAt: new Date(NOW.getTime() - 5 * 60 * 1000),
      hasInvestigation: false,
      hasFix: false,
      isClosed: false,
      ...overrides,
    };
  }

  function steps(
    work: TelemetryAiWork,
    state: TelemetryAiProblemState = problem(),
  ): TelemetryAiNextSteps {
    return getTelemetryAiNextSteps({ lane, work, problem: state, now: NOW });
  }

  test("a new problem with no rule: investigate and open the pull request now", () => {
    expect(steps(decide([], false))).toEqual({
      startInvestigation: true,
      startFix: true,
      offerFix: false,
      isWaiting: false,
      isNoLongerFound: false,
    });
  });

  test("one investigation and one fix, ever: what was started is not started again", () => {
    const work: TelemetryAiWork = decide([], false);

    expect(steps(work, problem({ hasInvestigation: true }))).toMatchObject({
      startInvestigation: false,
      startFix: true,
    });
    expect(steps(work, problem({ hasFix: true }))).toMatchObject({
      startInvestigation: true,
      startFix: false,
    });
    expect(
      steps(work, problem({ hasInvestigation: true, hasFix: true })),
    ).toMatchObject({ startInvestigation: false, startFix: false });
  });

  test("ask before fixing: the fix is offered, and nothing opens on its own", () => {
    const work: TelemetryAiWork = decide([
      rule({ executionMode: AutoRemediationExecutionMode.Suggest }),
    ]);

    expect(steps(work)).toMatchObject({
      startInvestigation: true,
      startFix: false,
      offerFix: true,
    });
    // Once a person opened it, it is no longer offered.
    expect(steps(work, problem({ hasFix: true })).offerFix).toBe(false);
  });

  test("don't fix: investigated only", () => {
    expect(steps(decide([rule({ fixes: false })]))).toMatchObject({
      startInvestigation: true,
      startFix: false,
      offerFix: false,
    });
  });

  test("a problem a person closed is never worked on", () => {
    expect(steps(decide([], false), problem({ isClosed: true }))).toEqual({
      startInvestigation: false,
      startFix: false,
      offerFix: false,
      isWaiting: false,
      isNoLongerFound: false,
    });
  });

  test("work that does nothing starts nothing", () => {
    for (const skip of [
      decideTelemetryAiWork({
        isAiEnabled: false,
        isLaneOn: true,
        rules: null,
      }),
      decideTelemetryAiWork({
        isAiEnabled: true,
        isLaneOn: false,
        rules: null,
      }),
      decideTelemetryAiWork({ isAiEnabled: true, isLaneOn: true, rules: null }),
      decide([]),
    ]) {
      expect(steps(skip)).toMatchObject({
        startInvestigation: false,
        startFix: false,
        offerFix: false,
      });
    }
  });

  test("a problem no longer being found starts nothing - it is worked on if found again", () => {
    const work: TelemetryAiWork = decide([], false);
    const limitMs: number = getStillFoundMinutes(lane) * 60 * 1000;

    expect(
      steps(work, problem({ lastSeenAt: new Date(NOW.getTime() - limitMs) })),
    ).toMatchObject({ startFix: true, isNoLongerFound: false });
    expect(
      steps(
        work,
        problem({ lastSeenAt: new Date(NOW.getTime() - limitMs - 1) }),
      ),
    ).toEqual({
      startInvestigation: false,
      startFix: false,
      offerFix: false,
      isWaiting: false,
      isNoLongerFound: true,
    });
  });

  test("the rules' wait is counted from when the problem was first found", () => {
    const work: TelemetryAiWork = decide([
      rule({ onlyIfOpenAfterMinutes: 120 }),
    ]);

    expect(
      steps(
        work,
        problem({
          firstSeenAt: new Date(NOW.getTime() - 119 * 60 * 1000),
        }),
      ),
    ).toEqual({
      startInvestigation: false,
      startFix: false,
      offerFix: false,
      isWaiting: true,
      isNoLongerFound: false,
    });
    expect(
      steps(
        work,
        problem({
          firstSeenAt: new Date(NOW.getTime() - 120 * 60 * 1000),
        }),
      ),
    ).toMatchObject({
      startInvestigation: true,
      startFix: true,
      isWaiting: false,
    });
  });

  test("a problem that went away during the wait is not worked on when the wait ends", () => {
    const work: TelemetryAiWork = decide([
      rule({ onlyIfOpenAfterMinutes: 60 }),
    ]);

    expect(
      steps(
        work,
        problem({
          firstSeenAt: new Date(NOW.getTime() - 5 * 60 * 60 * 1000),
          lastSeenAt: new Date(NOW.getTime() - 4 * 60 * 60 * 1000),
        }),
      ).isNoLongerFound,
    ).toBe(true);
  });
});
