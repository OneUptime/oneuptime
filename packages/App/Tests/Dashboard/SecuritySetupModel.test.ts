import { describe, expect, test } from "@jest/globals";
import PageMap from "../../FeatureSet/Dashboard/src/Utils/PageMap";
import {
  SecurityPipelineStage,
  SecuritySetupStatus,
  SecuritySetupStep,
  SETUP_CALL_FAILED,
  TURN_ON_RECOMMENDED_LOGS_SUBJECT,
  TURN_ON_RECOMMENDED_TELEMETRY_SUBJECT,
  TURN_ON_RECOMMENDED_PLAYBOOK_SUBJECT,
  TURN_ON_RECOMMENDED_RULES_SUBJECT,
  TurnOnRecommendedProblem,
  TurnOnRecommendedProblemWords,
  countSecuritySources,
  describeAddFailure,
  describeSetupCallFailure,
  didTurnOnAnything,
  getSecurityPipelineStages,
  getSecuritySetupSteps,
  getTurnOnRecommendedProblemWords,
  hasSecuritySources,
  isSecuritySetUp,
  parseSecuritySetupStatus,
  parseSetupTestResult,
  parseTurnOnRecommendedResult,
} from "../../FeatureSet/Dashboard/src/Components/SecurityOverview/SecuritySetupModel";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import {
  TURN_ON_RECOMMENDED_ACTIONS,
  TURN_ON_RECOMMENDED_REASONS,
  TurnOnRecommendedAction,
  TurnOnRecommendedPart,
  TurnOnRecommendedReason,
} from "Common/Types/SecurityEvent/TurnOnRecommended";

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
    telemetrySourcesEnabled: 0,
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

  test("each kind of your other OneUptime data counts as a source of its own", () => {
    expect(
      countSecuritySources(
        status({ logsSourceEnabled: true, telemetrySourcesEnabled: 3 }),
      ),
    ).toBe(4);
    expect(hasSecuritySources(status({ telemetrySourcesEnabled: 1 }))).toBe(
      true,
    );
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
        telemetrySourcesEnabled: 3,
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
      telemetrySourcesEnabled: 3,
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
        telemetrySourcesTurnedOn: 3,
        playbookAdded: false,
        playbookTurnedOn: true,
      }),
    ).toEqual({
      rulesAdded: 17,
      rulesTurnedOn: 2,
      logsTurnedOn: true,
      telemetrySourcesTurnedOn: 3,
      playbookAdded: false,
      playbookTurnedOn: true,
      problems: [],
    });
    expect(parseTurnOnRecommendedResult({})).toEqual({
      rulesAdded: 0,
      rulesTurnedOn: 0,
      logsTurnedOn: false,
      telemetrySourcesTurnedOn: 0,
      playbookAdded: false,
      playbookTurnedOn: false,
      problems: [],
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

function problem(
  overrides: Partial<TurnOnRecommendedProblem> = {},
): TurnOnRecommendedProblem {
  return {
    part: TurnOnRecommendedPart.Rule,
    action: TurnOnRecommendedAction.Add,
    name: "Password spraying",
    reason: TurnOnRecommendedReason.Failed,
    detail: "",
    ...overrides,
  };
}

describe("what Turn on recommended could not do", () => {
  test("is read as the server sent it, in its order", () => {
    expect(
      parseTurnOnRecommendedResult({
        rulesAdded: 19,
        problems: [
          {
            part: "rule",
            action: "add",
            name: "Password spraying",
            reason: "refused",
            detail: "Sigma rule YAML is required.",
          },
          {
            part: "playbook",
            action: "turn-on",
            name: "Enrich New Cases",
            reason: "not-allowed",
            detail: "",
          },
          {
            part: "logs",
            action: "check",
            name: "",
            reason: "plan",
            detail: "Please upgrade your plan to Growth",
          },
        ],
      }).problems,
    ).toEqual([
      problem({
        reason: TurnOnRecommendedReason.Refused,
        detail: "Sigma rule YAML is required.",
      }),
      problem({
        part: TurnOnRecommendedPart.Playbook,
        action: TurnOnRecommendedAction.TurnOn,
        name: "Enrich New Cases",
        reason: TurnOnRecommendedReason.NotAllowed,
      }),
      problem({
        part: TurnOnRecommendedPart.Logs,
        action: TurnOnRecommendedAction.Check,
        name: "",
        reason: TurnOnRecommendedReason.Plan,
        detail: "Please upgrade your plan to Growth",
      }),
    ]);
  });

  test("is read defensively: an unknown reason is a failure, an unknown action an add, an entry of no known part is left out", () => {
    expect(
      parseTurnOnRecommendedResult({
        problems: [
          { part: "rule", action: "dance", name: "A", reason: "gremlins" },
          { part: "something-new", action: "add", name: "B", reason: "failed" },
          { part: "playbook", name: 7, detail: false },
          "not a problem",
          null,
          ["nor this"],
        ],
      }).problems,
    ).toEqual([
      problem({ name: "A" }),
      problem({
        part: TurnOnRecommendedPart.Playbook,
        name: "",
      }),
    ]);
    expect(parseTurnOnRecommendedResult({ problems: "none" }).problems).toEqual(
      [],
    );
  });

  test("a click that turned on nothing at all is told from one that did some", () => {
    const nothing: ReturnType<typeof parseTurnOnRecommendedResult> =
      parseTurnOnRecommendedResult({});

    expect(didTurnOnAnything(nothing)).toBe(false);
    expect(didTurnOnAnything({ ...nothing, rulesAdded: 1 })).toBe(true);
    expect(didTurnOnAnything({ ...nothing, rulesTurnedOn: 1 })).toBe(true);
    expect(didTurnOnAnything({ ...nothing, logsTurnedOn: true })).toBe(true);
    expect(
      didTurnOnAnything({ ...nothing, telemetrySourcesTurnedOn: 2 }),
    ).toBe(true);
    expect(didTurnOnAnything({ ...nothing, playbookAdded: true })).toBe(true);
    expect(didTurnOnAnything({ ...nothing, playbookTurnedOn: true })).toBe(
      true,
    );
  });

  test("names each thing as the reader knows it: the rule or playbook by its name, your logs by their switch", () => {
    expect(
      getTurnOnRecommendedProblemWords(problem({ name: "Port scan" })),
    ).toMatchObject({ subject: "Port scan", isSubjectTranslated: false });
    expect(
      getTurnOnRecommendedProblemWords(
        problem({ part: TurnOnRecommendedPart.Logs, name: "" }),
      ),
    ).toMatchObject({
      subject: TURN_ON_RECOMMENDED_LOGS_SUBJECT,
      isSubjectTranslated: true,
    });
    expect(TURN_ON_RECOMMENDED_LOGS_SUBJECT).toBe(
      "Find security events in your logs",
    );
    // Your other OneUptime data reads as its one switch, whichever kind failed.
    expect(
      getTurnOnRecommendedProblemWords(
        problem({
          part: TurnOnRecommendedPart.TelemetrySources,
          name: "network-flows",
        }),
      ),
    ).toMatchObject({
      subject: TURN_ON_RECOMMENDED_TELEMETRY_SUBJECT,
      isSubjectTranslated: true,
    });
    expect(TURN_ON_RECOMMENDED_TELEMETRY_SUBJECT).toBe(
      "Find security events in your OneUptime data",
    );
    // With no name: the recommended rules as a whole, or the playbook.
    expect(
      getTurnOnRecommendedProblemWords(
        problem({ action: TurnOnRecommendedAction.Check, name: "" }),
      ),
    ).toMatchObject({
      subject: TURN_ON_RECOMMENDED_RULES_SUBJECT,
      isSubjectTranslated: true,
    });
    expect(
      getTurnOnRecommendedProblemWords(
        problem({ part: TurnOnRecommendedPart.Playbook, name: "" }),
      ),
    ).toMatchObject({
      subject: TURN_ON_RECOMMENDED_PLAYBOOK_SUBJECT,
      isSubjectTranslated: true,
    });
  });

  test("says why in a sentence for every reason and every action, never the server's raw failure", () => {
    const expected: Record<string, string> = {
      "not-allowed/add": "Your role cannot add it.",
      "not-allowed/turn-on":
        "It is turned off, and your role cannot turn it back on.",
      "not-allowed/check":
        "Your role cannot read what the project already has, so nothing was added.",
      "plan/add": "Your plan does not include it.",
      "plan/turn-on": "Your plan does not include it.",
      "plan/check": "Your plan does not include it.",
      "refused/add": "OneUptime could not save it.",
      "refused/turn-on": "OneUptime could not save it.",
      "refused/check": "OneUptime could not save it.",
      "failed/add": "Something went wrong while adding it.",
      "failed/turn-on": "Something went wrong while turning it back on.",
      "failed/check":
        "Something went wrong while reading what the project already has, so nothing was added.",
    };

    for (const reason of TURN_ON_RECOMMENDED_REASONS) {
      for (const action of TURN_ON_RECOMMENDED_ACTIONS) {
        const words: TurnOnRecommendedProblemWords =
          getTurnOnRecommendedProblemWords(problem({ reason, action }));

        expect({ reason, action, sentence: words.reason }).toEqual({
          reason,
          action,
          sentence: expected[`${reason}/${action}`],
        });
        expect(words.values).toEqual({});
      }
    }
  });

  test("a record refused, or a plan, says the server's own sentence", () => {
    expect(
      getTurnOnRecommendedProblemWords(
        problem({
          reason: TurnOnRecommendedReason.Refused,
          detail: "Sigma rule YAML is required.",
        }),
      ),
    ).toMatchObject({
      reason: "OneUptime could not save it: {{detail}}",
      values: { detail: "Sigma rule YAML is required." },
    });
    expect(
      getTurnOnRecommendedProblemWords(
        problem({
          reason: TurnOnRecommendedReason.Plan,
          detail: "Please upgrade your plan to Growth to access this feature",
        }),
      ),
    ).toMatchObject({
      reason: "Please upgrade your plan to Growth to access this feature",
      values: {},
    });
    // A failure's detail is never shown, even if a server sent one.
    expect(
      getTurnOnRecommendedProblemWords(
        problem({ detail: "ECONNREFUSED 10.0.0.5:5432" }),
      ).reason,
    ).toBe("Something went wrong while adding it.");
  });
});

describe("why the Rule Library could not add a rule itself", () => {
  function failed(statusCode: number, message: string): HTTPErrorResponse {
    return new HTTPErrorResponse(statusCode, { message }, {});
  }

  test.each([
    [401, TurnOnRecommendedReason.NotAllowed, ""],
    [403, TurnOnRecommendedReason.NotAllowed, ""],
    [422, TurnOnRecommendedReason.NotAllowed, ""],
    [402, TurnOnRecommendedReason.Plan, "Please upgrade your plan"],
    [400, TurnOnRecommendedReason.Refused, "Please upgrade your plan"],
    [500, TurnOnRecommendedReason.Failed, ""],
    [502, TurnOnRecommendedReason.Failed, ""],
  ])(
    "an answer of %i reads as %s",
    (statusCode: number, reason: TurnOnRecommendedReason, detail: string) => {
      expect(
        describeAddFailure(failed(statusCode, "Please upgrade your plan")),
      ).toEqual({ reason, detail });
    },
  );

  test("anything that is not an API answer is a failure, its message unread", () => {
    expect(describeAddFailure(new Error("Network Error"))).toEqual({
      reason: TurnOnRecommendedReason.Failed,
      detail: "",
    });
    expect(describeAddFailure("boom")).toEqual({
      reason: TurnOnRecommendedReason.Failed,
      detail: "",
    });
  });
});

describe("why a setup call failed as a whole", () => {
  // As SecurityCaseApi throws it (SecurityApiError): the API's sentence and the status it came with.
  function answered(statusCode: number, message: string): Error {
    return Object.assign(new Error(message), { statusCode });
  }

  const RAW: string = 'relation "DetectionRule" does not exist';

  test("the product's own words are a sentence the Dashboard translates", () => {
    expect(SETUP_CALL_FAILED).toBe(
      "Something went wrong. Try again in a moment.",
    );
  });

  test.each([400, 401, 402, 403, 422])(
    "an answer of %i - a role, a plan, a request refused - is said in the server's sentence",
    (statusCode: number) => {
      expect(
        describeSetupCallFailure(
          answered(
            statusCode,
            "Turning on detection rules takes a role that can create them.",
          ),
        ),
      ).toBe("Turning on detection rules takes a role that can create them.");
    },
  );

  test.each([404, 429, 500, 502, 503, 504])(
    "an answer of %i is said in the product's words, its message unread",
    (statusCode: number) => {
      expect(describeSetupCallFailure(answered(statusCode, RAW))).toBe(
        SETUP_CALL_FAILED,
      );
    },
  );

  test("an API's error answer reads the same way", () => {
    expect(
      describeSetupCallFailure(
        new HTTPErrorResponse(402, { message: "Please upgrade your plan" }, {}),
      ),
    ).toBe("Please upgrade your plan");
    expect(
      describeSetupCallFailure(
        new HTTPErrorResponse(500, { message: RAW }, {}),
      ),
    ).toBe(SETUP_CALL_FAILED);
  });

  test("a request that never got an answer, a blank sentence or anything else is said in the product's words", () => {
    expect(
      describeSetupCallFailure(
        new Error(
          "Request failed to https://oneuptime.example/api/security-case/setup/test. Network error",
        ),
      ),
    ).toBe(SETUP_CALL_FAILED);
    expect(describeSetupCallFailure(answered(403, "   "))).toBe(
      SETUP_CALL_FAILED,
    );
    expect(
      describeSetupCallFailure({ statusCode: "403", message: "Not a number" }),
    ).toBe(SETUP_CALL_FAILED);
    expect(describeSetupCallFailure("boom")).toBe(SETUP_CALL_FAILED);
    expect(describeSetupCallFailure(null)).toBe(SETUP_CALL_FAILED);
    expect(describeSetupCallFailure(undefined)).toBe(SETUP_CALL_FAILED);
  });
});
