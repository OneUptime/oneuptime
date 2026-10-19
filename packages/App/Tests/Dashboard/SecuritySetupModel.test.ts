import { describe, expect, test } from "@jest/globals";
import PageMap from "../../FeatureSet/Dashboard/src/Utils/PageMap";
import {
  SecurityPipelineStage,
  SecuritySetupStatus,
  SecuritySetupStep,
  countSecuritySources,
  getSecurityPipelineStages,
  getSecuritySetupSteps,
  hasSecuritySources,
  isSecuritySetUp,
  parseSecuritySetupStatus,
  parseSetupTestResult,
  parseTurnOnRecommendedResult,
} from "../../FeatureSet/Dashboard/src/Components/SecurityOverview/SecuritySetupModel";

/*
 * What the Overview's pipeline and "Get started" are drawn from: the steps
 * in the order they pay off, when each counts as done, when Security counts
 * as set up, and the server's answers read defensively - a figure the
 * server left out or garbled is 0, never NaN on the page.
 */

function status(
  overrides: Partial<SecuritySetupStatus> = {},
): SecuritySetupStatus {
  return {
    connections: 0,
    logsSourceEnabled: false,
    eventsLast24Hours: 0,
    lastEventAt: null,
    enabledRules: 0,
    recommendedRules: 19,
    recommendedRulesOn: 0,
    threatIntelFeeds: 0,
    openCases: 0,
    enabledPlaybooks: 0,
    destinations: 0,
    ...overrides,
  };
}

describe("Get started", () => {
  test("four steps in the order they pay off, each linking to where it is done by hand", () => {
    expect(
      getSecuritySetupSteps(status()).map(
        (step: SecuritySetupStep): [string, string, string, string] => {
          return [step.key, step.title, step.page, step.linkText];
        },
      ),
    ).toEqual([
      [
        "sources",
        "Choose what to watch",
        PageMap.SECURITY_EVENTS_CONNECTIONS,
        "Connections",
      ],
      [
        "detections",
        "Turn on detections",
        PageMap.SECURITY_EVENTS_RULE_LIBRARY,
        "Rule Library",
      ],
      [
        "responses",
        "Respond automatically",
        PageMap.SECURITY_PLAYBOOKS,
        "Playbooks",
      ],
      ["test", "See it work", PageMap.SECURITY_CASES, "Security Cases"],
    ]);
  });

  test.each([
    ["nothing", status(), [false, false, false, false]],
    [
      "your logs alone",
      status({ logsSourceEnabled: true }),
      [true, false, false, false],
    ],
    [
      "a connection alone",
      status({ connections: 2 }),
      [true, false, false, false],
    ],
    ["a rule", status({ enabledRules: 1 }), [false, true, false, false]],
    [
      "a playbook",
      status({ enabledPlaybooks: 1 }),
      [false, false, true, false],
    ],
    ["an open case", status({ openCases: 1 }), [false, false, false, true]],
  ])(
    "with %s, the done steps are %j",
    (_label: string, value: SecuritySetupStatus, done: Array<boolean>) => {
      expect(
        getSecuritySetupSteps(value).map((step: SecuritySetupStep): boolean => {
          return step.isDone;
        }),
      ).toEqual(done);
    },
  );

  test("Security is set up once something feeds it, something finds threats and something responds", () => {
    expect(isSecuritySetUp(status())).toBe(false);
    expect(
      isSecuritySetUp(status({ logsSourceEnabled: true, enabledRules: 3 })),
    ).toBe(false);
    expect(
      isSecuritySetUp(status({ enabledRules: 3, enabledPlaybooks: 1 })),
    ).toBe(false);
    expect(
      isSecuritySetUp(
        status({ connections: 1, enabledRules: 3, enabledPlaybooks: 1 }),
      ),
    ).toBe(true);
    expect(
      isSecuritySetUp(
        status({
          logsSourceEnabled: true,
          enabledRules: 1,
          enabledPlaybooks: 1,
        }),
      ),
    ).toBe(true);
    // An open case is not a set-up step: a project can be set up and quiet.
    expect(
      isSecuritySetUp(
        status({
          logsSourceEnabled: true,
          enabledRules: 1,
          enabledPlaybooks: 1,
          openCases: 0,
        }),
      ),
    ).toBe(true);
  });

  test("your logs count as one source beside the connections", () => {
    expect(countSecuritySources(status())).toBe(0);
    expect(countSecuritySources(status({ logsSourceEnabled: true }))).toBe(1);
    expect(
      countSecuritySources(status({ logsSourceEnabled: true, connections: 2 })),
    ).toBe(3);
    expect(hasSecuritySources(status({ connections: 1 }))).toBe(true);
    expect(hasSecuritySources(status())).toBe(false);
  });
});

describe("the pipeline", () => {
  test("sources, detections, cases and playbooks, each linked to its page", () => {
    expect(
      getSecurityPipelineStages(status()).map(
        (stage: SecurityPipelineStage): [string, string, string] => {
          return [stage.key, stage.title, stage.page];
        },
      ),
    ).toEqual([
      ["sources", "Sources", PageMap.SECURITY_EVENTS_CONNECTIONS],
      ["detections", "Detections", PageMap.SECURITY_EVENTS_DETECTION_RULES],
      ["cases", "Security Cases", PageMap.SECURITY_CASES],
      ["playbooks", "Playbooks", PageMap.SECURITY_PLAYBOOKS],
    ]);
  });

  test("a stage not set up says so; the cases stage is always there and asks for a person when cases are open", () => {
    const stages: Array<SecurityPipelineStage> = getSecurityPipelineStages(
      status({ openCases: 2 }),
    );

    expect(
      stages.map((stage: SecurityPipelineStage): [string, boolean, boolean] => {
        return [stage.key, stage.isReady, stage.needsAttention];
      }),
    ).toEqual([
      ["sources", false, false],
      ["detections", false, false],
      ["cases", true, true],
      ["playbooks", false, false],
    ]);
  });
});

describe("reading the server's answers", () => {
  test("a full status reads as it was sent", () => {
    expect(
      parseSecuritySetupStatus({
        connections: 2,
        logsSourceEnabled: true,
        eventsLast24Hours: 1500,
        lastEventAt: "2026-10-19T11:59:00.000Z",
        enabledRules: 19,
        recommendedRules: 19,
        recommendedRulesOn: 17,
        threatIntelFeeds: 1,
        openCases: 3,
        enabledPlaybooks: 2,
        destinations: 1,
      }),
    ).toEqual({
      connections: 2,
      logsSourceEnabled: true,
      eventsLast24Hours: 1500,
      lastEventAt: new Date("2026-10-19T11:59:00.000Z"),
      enabledRules: 19,
      recommendedRules: 19,
      recommendedRulesOn: 17,
      threatIntelFeeds: 1,
      openCases: 3,
      enabledPlaybooks: 2,
      destinations: 1,
    });
  });

  test("a figure left out, negative, not a number or text is 0; a bad date is none; only true is on", () => {
    expect(
      parseSecuritySetupStatus({
        connections: -1,
        logsSourceEnabled: "true",
        eventsLast24Hours: "12",
        lastEventAt: "not a date",
        enabledRules: Number.NaN,
        openCases: null,
      }),
    ).toEqual(status({ recommendedRules: 0 }));
  });

  test("the one click's answer and the test's answer", () => {
    expect(
      parseTurnOnRecommendedResult({
        rulesAdded: 17,
        rulesTurnedOn: 2,
        logsTurnedOn: true,
        playbookAdded: false,
        playbookTurnedOn: true,
      }),
    ).toEqual({
      rulesAdded: 17,
      rulesTurnedOn: 2,
      logsTurnedOn: true,
      playbookAdded: false,
      playbookTurnedOn: true,
    });
    expect(parseTurnOnRecommendedResult({})).toEqual({
      rulesAdded: 0,
      rulesTurnedOn: 0,
      logsTurnedOn: false,
      playbookAdded: false,
      playbookTurnedOn: false,
    });
    expect(
      parseSetupTestResult({
        eventsSent: 12,
        caseId: "44444444-4444-4444-8444-444444444444",
        caseNumber: "#7",
        ruleAdded: true,
      }),
    ).toEqual({
      eventsSent: 12,
      caseId: "44444444-4444-4444-8444-444444444444",
      caseNumber: "#7",
      ruleAdded: true,
    });
    expect(parseSetupTestResult({ caseId: "", caseNumber: 7 })).toEqual({
      eventsSent: 0,
      caseId: null,
      caseNumber: null,
      ruleAdded: false,
    });
  });
});
