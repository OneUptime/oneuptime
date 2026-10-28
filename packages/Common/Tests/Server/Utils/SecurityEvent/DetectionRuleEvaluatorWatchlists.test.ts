/*
 * The alert creation path pulls the native isolated-vm addon through its
 * template renderer; nothing here touches the sandbox.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import DetectionRuleEvaluator from "../../../../Server/Utils/SecurityEvent/DetectionRuleEvaluator";
import CorrelationRuleMatcher, {
  CorrelationMatchResult,
} from "../../../../Server/Utils/SecurityEvent/Correlation/CorrelationRuleMatcher";
import SecurityWatchlists from "../../../../Server/Utils/SecurityEvent/Watchlists/SecurityWatchlists";
import DetectionRule from "../../../../Models/DatabaseModels/DetectionRule";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import DetectionRuleService from "../../../../Server/Services/DetectionRuleService";
import DetectionRuleExceptionService from "../../../../Server/Services/DetectionRuleExceptionService";
import SecurityEventService, {
  FindDetectionMatchesData,
} from "../../../../Server/Services/SecurityEventService";
import SecurityCaseIngest from "../../../../Server/Utils/SecurityCase/SecurityCaseIngest";
import SecurityEntityRiskRecorder from "../../../../Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskRecorder";
import logger from "../../../../Server/Utils/Logger";
import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import { SigmaWatchlist } from "../../../../Types/SecurityEvent/SecurityWatchlist";
import { SigmaCorrelationStep } from "../../../../Types/SecurityEvent/SigmaCorrelation";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A RULE THAT READS WATCHLISTS, AT ITS RUNS: the lists it names are read
 * from its project and bound to it before it is compiled, so the read the
 * engine sends matches the list's values; a list the project no longer has
 * is the rule's error, by name; and one turn of a project reads each list
 * once, however many of its rules name it.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RULE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_RULE_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111112",
);

const VIP_RULE: string = `title: VIP sign-in
detection:
  selection:
    className: Authentication
    principalUser|expand: '%vip_users%'
  condition: selection
`;

const VIP_SEQUENCE: string = `title: VIP fails, then succeeds
correlation:
  type: temporal_ordered
  rules:
    - vip_failure
    - vip_success
  group-by:
    - principalUser
  timespan: 10m
---
title: VIP failure
name: vip_failure
detection:
  selection:
    principalUser|expand: '%vip_users%'
    statusName: Failure
  condition: selection
---
title: VIP success
name: vip_success
detection:
  selection:
    principalUser|expand: '%vip_users%'
    statusName: Success
  condition: selection
`;

const VIP_LIST: SigmaWatchlist = {
  name: "vip_users",
  entityType: SecurityEntityType.User,
  exactValues: ["alice", "bob"],
  patterns: [],
  ranges: [],
};

function buildRule(
  yaml: string,
  id: ObjectID = RULE_ID,
): DetectionRule {
  const rule: DetectionRule = new DetectionRule();
  rule._id = id.toString();
  rule.projectId = PROJECT_ID;
  rule.name = "VIP sign-in";
  rule.sigmaRuleYaml = yaml;
  rule.evaluationIntervalInMinutes = 5;
  rule.isEnabled = true;
  return rule;
}

let findDetectionMatches: Spy;
let updateRule: Spy;
let loadLists: Spy;

beforeEach(() => {
  getJestSpyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
  getJestSpyOn(logger, "warn").mockImplementation((() => {
    return undefined;
  }) as never);
  getJestSpyOn(SecurityCaseIngest, "recordDetections").mockResolvedValue({
    casesOpened: 0,
    detectionsAdded: 0,
    detectionsRepeated: 0,
  } as never);
  getJestSpyOn(SecurityEntityRiskRecorder, "record").mockResolvedValue({
    entitiesUpdated: 0,
    riskCasesRaised: 0,
  } as never);
  getJestSpyOn(DetectionRuleExceptionService, "findAllBy").mockResolvedValue(
    [] as never,
  );
  getJestSpyOn(AlertSeverityService, "findBy").mockResolvedValue([] as never);
  findDetectionMatches = getJestSpyOn(
    SecurityEventService,
    "findDetectionMatches",
  ).mockResolvedValue([] as never);
  updateRule = getJestSpyOn(
    DetectionRuleService,
    "updateOneById",
  ).mockResolvedValue(undefined as never);
  loadLists = getJestSpyOn(SecurityWatchlists, "load").mockResolvedValue(
    new Map([["vip_users", VIP_LIST]]) as never,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a run of a rule that reads a watchlist", () => {
  test("the list it names is read from its project and matched in the read the engine sends", async () => {
    await DetectionRuleEvaluator.evaluateRule(buildRule(VIP_RULE));

    expect(loadLists).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      names: ["vip_users"],
    });

    const data: FindDetectionMatchesData = findDetectionMatches.mock
      .calls[0]![0] as FindDetectionMatchesData;

    expect(data.whereFragment.query).toContain(
      "lowerUTF8(principalUser) IN {p1:Array(String)}",
    );
    expect(Object.values(data.whereFragment.query_params)).toContainEqual([
      "alice",
      "bob",
    ]);
  });

  test("a list the project no longer has is the rule's error, by name", async () => {
    loadLists.mockResolvedValue(new Map() as never);

    await expect(
      DetectionRuleEvaluator.evaluateRule(buildRule(VIP_RULE)),
    ).rejects.toThrow(
      "There is no watchlist named vip_users in this project. Create it under Security Events > Detections > Watchlists, or fix its name in the rule.",
    );
    expect(findDetectionMatches).not.toHaveBeenCalled();
  });

  test("a turn records the missing list on the rule, and goes on to the next rule", async () => {
    loadLists.mockResolvedValue(new Map() as never);
    getJestSpyOn(DetectionRuleService, "findAllBy").mockResolvedValue([
      buildRule(VIP_RULE),
      buildRule(
        "title: Plain\ndetection:\n  s:\n    statusName: Failure\n  condition: s\n",
        OTHER_RULE_ID,
      ),
    ] as never);

    await DetectionRuleEvaluator.evaluateDueRulesForProject(PROJECT_ID);

    const failed: { id: ObjectID; data: JSONObject } | undefined =
      updateRule.mock.calls
        .map((call: Array<unknown>) => {
          return call[0] as { id: ObjectID; data: JSONObject };
        })
        .find((call: { id: ObjectID; data: JSONObject }): boolean => {
          return call.id.toString() === RULE_ID.toString();
        });

    expect(String(failed!.data["lastError"])).toContain(
      "There is no watchlist named vip_users",
    );
    // The plain rule still ran.
    expect(findDetectionMatches).toHaveBeenCalledTimes(1);
  });

  test("one turn reads each list once, however many of its rules name it", async () => {
    getJestSpyOn(DetectionRuleService, "findAllBy").mockResolvedValue([
      buildRule(VIP_RULE),
      buildRule(VIP_RULE, OTHER_RULE_ID),
    ] as never);

    await DetectionRuleEvaluator.evaluateDueRulesForProject(PROJECT_ID);

    expect(findDetectionMatches).toHaveBeenCalledTimes(2);
    expect(loadLists).toHaveBeenCalledTimes(1);
  });

  test("a correlation's steps carry the lists they name to the reads", async () => {
    const findMatches: Spy = getJestSpyOn(
      CorrelationRuleMatcher,
      "findMatches",
    ).mockResolvedValue({
      groups: [],
      candidatesCapped: false,
    } as unknown as CorrelationMatchResult as never);

    await DetectionRuleEvaluator.evaluateRule(buildRule(VIP_SEQUENCE));

    const steps: Array<SigmaCorrelationStep> = (
      findMatches.mock.calls[0]![0] as { steps: Array<SigmaCorrelationStep> }
    ).steps;

    expect(steps).toHaveLength(2);

    for (const step of steps) {
      expect(step.rule!.watchlists).toEqual({ vip_users: VIP_LIST });
    }
  });

  test("a rule that names no list reads none", async () => {
    await DetectionRuleEvaluator.evaluateRule(
      buildRule(
        "title: Plain\ndetection:\n  s:\n    statusName: Failure\n  condition: s\n",
      ),
    );

    expect(loadLists).not.toHaveBeenCalled();
    expect(findDetectionMatches).toHaveBeenCalledTimes(1);
  });
});
