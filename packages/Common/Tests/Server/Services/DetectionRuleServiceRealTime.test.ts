import DetectionRuleService from "../../../Server/Services/DetectionRuleService";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { DETECTION_EVALUATION_DELAY_IN_SECONDS } from "../../../Types/SecurityEvent/DetectionFindingConstants";
import { DETECTION_REAL_TIME_RULES_MAX } from "../../../Types/SecurityEvent/RealTimeDetection";
import { getJestSpyOn } from "../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Saving a rule that runs in real time: only one that fires on one event -
 * no correlation, a threshold of 1, no distinct count field, no regular
 * expression - and at most 50 in a project, whenever a write turns real
 * time on or changes what a real-time rule reads; a rule put back on its
 * schedule starts it from now, so it never reads again what real time did.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

type HookCaller = {
  onBeforeCreate: (
    createBy: CreateBy<DetectionRule>,
  ) => Promise<OnCreate<DetectionRule>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<DetectionRule>,
  ) => Promise<OnUpdate<DetectionRule>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<DetectionRule>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<DetectionRule>>;
};

const service: HookCaller = DetectionRuleService as unknown as HookCaller;

const PROJECT_ID: ObjectID = new ObjectID(
  "61616161-6161-4616-8616-616161616161",
);
const RULE_ID: ObjectID = new ObjectID("62626262-6262-4626-8626-626262626262");

const SINGLE: string = `title: Root sign-in
level: critical
detection:
  selection:
    principalUser: root
  condition: selection`;

const REGEX: string = `title: Encoded command
detection:
  selection:
    CommandLine|re: 'enc [A-Za-z0-9+/=]{40,}'
  condition: selection`;

const CORRELATION: string = `title: Many
correlation:
  type: event_count
  rules: [a]
  timespan: 5m
  condition:
    gte: 3
---
title: A
name: a
detection:
  selection:
    principalUser: root
  condition: selection`;

function createBy(data: Partial<DetectionRule>): CreateBy<DetectionRule> {
  const rule: DetectionRule = new DetectionRule();
  rule.projectId = PROJECT_ID;
  rule.name = "Rule";
  rule.sigmaRuleYaml = SINGLE;
  Object.assign(rule, data);

  return { data: rule, props: { isRoot: true } };
}

function updateBy(data: JSONObject): UpdateBy<DetectionRule> {
  return {
    query: { _id: RULE_ID.toString() },
    data: data as never,
    props: { isRoot: true },
    limit: 1,
    skip: 0,
  };
}

function storedRule(data: Partial<DetectionRule>): DetectionRule {
  const rule: DetectionRule = new DetectionRule();
  rule._id = RULE_ID.toString();
  rule.projectId = PROJECT_ID;
  rule.sigmaRuleYaml = SINGLE;
  rule.matchCountThreshold = 1;
  rule.isRealTime = false;
  Object.assign(rule, data);
  return rule;
}

function holding(rule: DetectionRule): Spy {
  return getJestSpyOn(
    DetectionRuleService,
    "findRowsAndHoldUpdateToThem",
  ).mockResolvedValue([rule] as never);
}

function realTimeRulesInProject(count: number): Spy {
  return getJestSpyOn(DetectionRuleService, "countBy").mockResolvedValue(
    new PositiveNumber(count) as never,
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("creating a rule that runs in real time", () => {
  test("a rule that fires on one event can", async () => {
    const count: Spy = realTimeRulesInProject(3);

    await expect(
      service.onBeforeCreate(createBy({ isRealTime: true })),
    ).resolves.toBeDefined();

    // The project's real-time rules are counted.
    expect(
      (count.mock.calls[0]![0] as { query: JSONObject }).query,
    ).toEqual({ projectId: PROJECT_ID, isRealTime: true });
  });

  test("any other is refused, saying why and what to change", async () => {
    realTimeRulesInProject(0);

    await expect(
      service.onBeforeCreate(
        createBy({ isRealTime: true, matchCountThreshold: 5 }),
      ),
    ).rejects.toThrow(
      "This rule cannot run in real time. It waits for a count of matches, so it runs on its interval: set Match Count Threshold to 1 to run it in real time.",
    );
    await expect(
      service.onBeforeCreate(
        createBy({ isRealTime: true, distinctCountField: "principalUser" }),
      ),
    ).rejects.toThrow("clear Distinct Count Field");
    await expect(
      service.onBeforeCreate(
        createBy({ isRealTime: true, sigmaRuleYaml: REGEX }),
      ),
    ).rejects.toThrow("regular expression (|re)");
    await expect(
      service.onBeforeCreate(
        createBy({ isRealTime: true, sigmaRuleYaml: CORRELATION }),
      ),
    ).rejects.toThrow("A correlation reads several events together");
  });

  test("a project runs at most 50 rules in real time", async () => {
    realTimeRulesInProject(DETECTION_REAL_TIME_RULES_MAX);

    await expect(
      service.onBeforeCreate(createBy({ isRealTime: true })),
    ).rejects.toThrow(
      "A project runs at most 50 rules in real time, since every event it receives is checked against each. Turn real time off on another rule first.",
    );
  });

  test("a scheduled rule is never counted or checked for it", async () => {
    const count: Spy = realTimeRulesInProject(DETECTION_REAL_TIME_RULES_MAX);

    await expect(
      service.onBeforeCreate(createBy({ matchCountThreshold: 5 })),
    ).resolves.toBeDefined();
    expect(count).not.toHaveBeenCalled();
  });
});

describe("turning real time on, or changing what a real-time rule reads", () => {
  test("turning it on checks the rule as it will be, and counts the project's others", async () => {
    const hold: Spy = holding(storedRule({ isRealTime: false }));
    const count: Spy = realTimeRulesInProject(10);

    const result: OnUpdate<DetectionRule> = await service.onBeforeUpdate(
      updateBy({ isRealTime: true }),
    );

    expect(hold).toHaveBeenCalledTimes(1);
    expect(
      (count.mock.calls[0]![0] as { query: JSONObject }).query["_id"],
    ).toBeDefined();
    expect(result.carryForward).toBeNull();
  });

  test("turning it on for a rule that waits for a count is refused", async () => {
    holding(storedRule({ matchCountThreshold: 10 }));
    realTimeRulesInProject(0);

    await expect(
      service.onBeforeUpdate(updateBy({ isRealTime: true })),
    ).rejects.toThrow("set Match Count Threshold to 1");

    // ...unless the same write sets the threshold to 1.
    await expect(
      service.onBeforeUpdate(
        updateBy({ isRealTime: true, matchCountThreshold: 1 }),
      ),
    ).resolves.toBeDefined();
  });

  test("a switch as Postgres may hand it over reads the same", async () => {
    holding(storedRule({ matchCountThreshold: 10 }));
    realTimeRulesInProject(0);

    await expect(
      service.onBeforeUpdate(updateBy({ isRealTime: "true" })),
    ).rejects.toThrow("set Match Count Threshold to 1");
  });

  test("a real-time rule cannot be given a threshold, a distinct count or a correlation", async () => {
    holding(storedRule({ isRealTime: true }));

    await expect(
      service.onBeforeUpdate(updateBy({ matchCountThreshold: 3 })),
    ).rejects.toThrow("This rule cannot run in real time.");
    await expect(
      service.onBeforeUpdate(updateBy({ distinctCountField: "targetPort" })),
    ).rejects.toThrow("This rule cannot run in real time.");
    await expect(
      service.onBeforeUpdate(updateBy({ sigmaRuleYaml: CORRELATION })),
    ).rejects.toThrow("This rule cannot run in real time.");
  });

  test("a rule already in real time is not counted again", async () => {
    holding(storedRule({ isRealTime: true }));
    const count: Spy = realTimeRulesInProject(DETECTION_REAL_TIME_RULES_MAX);

    await expect(
      service.onBeforeUpdate(updateBy({ isRealTime: true })),
    ).resolves.toBeDefined();
    expect(count).not.toHaveBeenCalled();
  });

  test("an update that cannot end real time reads no row", async () => {
    const hold: Spy = getJestSpyOn(
      DetectionRuleService,
      "findRowsAndHoldUpdateToThem",
    );

    await service.onBeforeUpdate(updateBy({ description: "Renamed" }));
    await service.onBeforeUpdate(updateBy({ sigmaRuleYaml: SINGLE }));
    await service.onBeforeUpdate(updateBy({ matchCountThreshold: 1 }));
    await service.onBeforeUpdate(updateBy({ distinctCountField: " " }));

    expect(hold).not.toHaveBeenCalled();
  });
});

describe("putting a rule back on its schedule", () => {
  test("starts its schedule from now: it never reads again what real time did", async () => {
    holding(storedRule({ isRealTime: true }));

    const result: OnUpdate<DetectionRule> = await service.onBeforeUpdate(
      updateBy({ isRealTime: false }),
    );

    expect(result.carryForward).toEqual({ leavingRealTime: [RULE_ID] });

    const now: Date = new Date("2026-10-30T09:00:00.000Z");
    getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(now as never);
    const write: Spy = getJestSpyOn(
      DetectionRuleService,
      "updateColumnsByIdWithoutHooks",
    ).mockResolvedValue(undefined as never);

    await service.onUpdateSuccess(result, [RULE_ID]);

    expect(write).toHaveBeenCalledWith({
      id: RULE_ID,
      data: {
        lastEvaluatedAt: new Date(
          now.getTime() - DETECTION_EVALUATION_DELAY_IN_SECONDS * 1000,
        ),
      },
    });
  });

  test("a rule that was on its schedule already keeps where its schedule is", async () => {
    holding(storedRule({ isRealTime: false }));

    const result: OnUpdate<DetectionRule> = await service.onBeforeUpdate(
      updateBy({ isRealTime: false }),
    );

    expect(result.carryForward).toBeNull();

    const write: Spy = getJestSpyOn(
      DetectionRuleService,
      "updateColumnsByIdWithoutHooks",
    );

    await service.onUpdateSuccess(result, [RULE_ID]);

    expect(write).not.toHaveBeenCalled();
  });

  test("a row the update did not write is left alone", async () => {
    const write: Spy = getJestSpyOn(
      DetectionRuleService,
      "updateColumnsByIdWithoutHooks",
    );

    await service.onUpdateSuccess(
      {
        updateBy: updateBy({ isRealTime: false }),
        carryForward: { leavingRealTime: [RULE_ID] },
      },
      [],
    );

    expect(write).not.toHaveBeenCalled();
  });
});
