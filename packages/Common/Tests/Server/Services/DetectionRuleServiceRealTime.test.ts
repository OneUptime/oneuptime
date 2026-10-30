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
import RealTimeJobs, {
  REAL_TIME_HANDOVER_MARGIN_MS,
  REAL_TIME_RULES_CACHE_TTL_MS,
} from "../../../Server/Utils/SecurityEvent/RealTime/RealTimeJobs";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Saving a rule that runs in real time: only one that fires on one event -
 * no correlation, a threshold of 1, no distinct count field, no regular
 * expression - and at most 50 in a project, whenever a write turns real
 * time on or changes what a real-time rule reads; a rule put back on its
 * schedule starts it from now, so it never reads again what real time did;
 * and a rule that starts to run in real time is handed over, so it misses
 * nothing between its schedule and the screen.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

type HookCaller = {
  onBeforeCreate: (
    createBy: CreateBy<DetectionRule>,
  ) => Promise<OnCreate<DetectionRule>>;
  onCreateSuccess: (
    onCreate: OnCreate<DetectionRule>,
    createdItem: DetectionRule,
  ) => Promise<DetectionRule>;
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
    expect((count.mock.calls[0]![0] as { query: JSONObject }).query).toEqual({
      projectId: PROJECT_ID,
      isRealTime: true,
    });
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

const NOW: Date = new Date("2026-10-30T09:00:00.000Z");
const LAST_RUN: Date = new Date("2026-10-30T08:52:00.000Z");
// When every process screens for a rule that starts now, and a little more.
const HANDED_UNTIL: Date = new Date(
  NOW.getTime() + REAL_TIME_RULES_CACHE_TTL_MS + REAL_TIME_HANDOVER_MARGIN_MS,
);

function atNow(): void {
  getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW as never);
}

describe("turning real time on, or changing what a real-time rule reads", () => {
  test("turning it on checks the rule as it will be, and counts the project's others", async () => {
    atNow();
    const hold: Spy = holding(
      storedRule({ isRealTime: false, lastEvaluatedAt: LAST_RUN }),
    );
    const count: Spy = realTimeRulesInProject(10);

    const result: OnUpdate<DetectionRule> = await service.onBeforeUpdate(
      updateBy({ isRealTime: true }),
    );

    expect(hold).toHaveBeenCalledTimes(1);
    expect(
      (count.mock.calls[0]![0] as { query: JSONObject }).query["_id"],
    ).toBeDefined();
    // Off its schedule: handed over from its last run.
    expect(result.carryForward).toEqual({
      enteringRealTime: [
        {
          id: RULE_ID,
          projectId: PROJECT_ID,
          startTime: LAST_RUN,
          endTime: HANDED_UNTIL,
        },
      ],
    });
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

  test("an update that can neither start nor end real time reads no row", async () => {
    const hold: Spy = getJestSpyOn(
      DetectionRuleService,
      "findRowsAndHoldUpdateToThem",
    );

    await service.onBeforeUpdate(updateBy({ description: "Renamed" }));
    await service.onBeforeUpdate(updateBy({ sigmaRuleYaml: SINGLE }));
    await service.onBeforeUpdate(updateBy({ matchCountThreshold: 1 }));
    await service.onBeforeUpdate(updateBy({ distinctCountField: " " }));
    // Turning a rule off starts nothing.
    await service.onBeforeUpdate(updateBy({ isEnabled: false }));

    expect(hold).not.toHaveBeenCalled();
  });
});

describe("handing a rule over to real time", () => {
  let handover: Spy;

  beforeEach(() => {
    atNow();
    realTimeRulesInProject(0);
    handover = getJestSpyOn(RealTimeJobs, "enqueueHandover").mockResolvedValue(
      undefined as never,
    );
  });

  test("off its schedule: from its last scheduled run until every process screens for it, once the rule is written", async () => {
    holding(storedRule({ isRealTime: false, lastEvaluatedAt: LAST_RUN }));

    const result: OnUpdate<DetectionRule> = await service.onBeforeUpdate(
      updateBy({ isRealTime: true }),
    );

    expect(handover).not.toHaveBeenCalled();

    await service.onUpdateSuccess(result, [RULE_ID]);

    expect(handover).toHaveBeenCalledTimes(1);
    expect(handover).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      ruleId: RULE_ID,
      startTime: LAST_RUN,
      endTime: HANDED_UNTIL,
    });
  });

  test("a rule that never ran: the interval a scheduled rule's first run reads", async () => {
    holding(storedRule({ isRealTime: false, evaluationIntervalInMinutes: 10 }));

    const result: OnUpdate<DetectionRule> = await service.onBeforeUpdate(
      updateBy({ isRealTime: true }),
    );

    expect(
      (result.carryForward as { enteringRealTime: Array<JSONObject> })
        .enteringRealTime[0]!["startTime"],
    ).toEqual(
      new Date(
        NOW.getTime() -
          DETECTION_EVALUATION_DELAY_IN_SECONDS * 1000 -
          10 * 60 * 1000,
      ),
    );
  });

  test("a real-time rule turned back on: from now, as every run reads", async () => {
    holding(
      storedRule({
        isRealTime: true,
        isEnabled: false,
        lastEvaluatedAt: LAST_RUN,
      }),
    );

    const result: OnUpdate<DetectionRule> = await service.onBeforeUpdate(
      updateBy({ isEnabled: true }),
    );

    expect(result.carryForward).toEqual({
      enteringRealTime: [
        {
          id: RULE_ID,
          projectId: PROJECT_ID,
          startTime: new Date(
            NOW.getTime() - DETECTION_EVALUATION_DELAY_IN_SECONDS * 1000,
          ),
          endTime: HANDED_UNTIL,
        },
      ],
    });
  });

  test("a rule put in real time while off is handed over only when it is turned on", async () => {
    holding(storedRule({ isRealTime: false, isEnabled: false }));

    const result: OnUpdate<DetectionRule> = await service.onBeforeUpdate(
      updateBy({ isRealTime: true }),
    );

    expect(result.carryForward).toBeNull();
  });

  test("saving a rule that is on and in real time already hands nothing over", async () => {
    holding(storedRule({ isRealTime: true, isEnabled: true }));

    const result: OnUpdate<DetectionRule> = await service.onBeforeUpdate(
      updateBy({ isEnabled: true, isRealTime: true, name: "Renamed" }),
    );

    expect(result.carryForward).toBeNull();

    await service.onUpdateSuccess(result, [RULE_ID]);

    expect(handover).not.toHaveBeenCalled();
  });

  test("a row the update did not write is not handed over", async () => {
    await service.onUpdateSuccess(
      {
        updateBy: updateBy({ isRealTime: true }),
        carryForward: {
          enteringRealTime: [
            {
              id: RULE_ID,
              projectId: PROJECT_ID,
              startTime: LAST_RUN,
              endTime: HANDED_UNTIL,
            },
          ],
        },
      },
      [],
    );

    expect(handover).not.toHaveBeenCalled();
  });

  test("a handover that cannot be queued never fails the save", async () => {
    handover.mockRejectedValue(new Error("Redis is down") as never);
    holding(storedRule({ isRealTime: false, lastEvaluatedAt: LAST_RUN }));

    const result: OnUpdate<DetectionRule> = await service.onBeforeUpdate(
      updateBy({ isRealTime: true }),
    );

    await expect(
      service.onUpdateSuccess(result, [RULE_ID]),
    ).resolves.toBeDefined();
    expect(handover).toHaveBeenCalledTimes(1);
  });

  test("a rule created in real time: the interval a first run reads; a scheduled or switched-off one, nothing", async () => {
    const created: DetectionRule = storedRule({
      isRealTime: true,
      evaluationIntervalInMinutes: 5,
    });

    await expect(
      service.onCreateSuccess(
        { createBy: createBy({}), carryForward: null },
        created,
      ),
    ).resolves.toBe(created);
    expect(handover).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      ruleId: RULE_ID,
      startTime: new Date(
        NOW.getTime() -
          DETECTION_EVALUATION_DELAY_IN_SECONDS * 1000 -
          5 * 60 * 1000,
      ),
      endTime: HANDED_UNTIL,
    });

    handover.mockClear();

    for (const other of [
      storedRule({ isRealTime: false }),
      storedRule({ isRealTime: true, isEnabled: false }),
    ]) {
      await service.onCreateSuccess(
        { createBy: createBy({}), carryForward: null },
        other,
      );
    }

    expect(handover).not.toHaveBeenCalled();
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
