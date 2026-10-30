import DetectionRuleService from "../../../Server/Services/DetectionRuleService";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Saving a correlation rule: the whole file is checked when it is saved -
 * its type, timespan and condition, and every rule it reads, from its own
 * YAML or by Sigma id or name from the project's other detection rules -
 * so a correlation that stores is one the engine can run. The rule is named
 * after the correlation's title, and a rule it names that the project does
 * not have is refused naming it.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

type HookCaller = {
  onBeforeCreate: (
    createBy: CreateBy<DetectionRule>,
  ) => Promise<OnCreate<DetectionRule>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<DetectionRule>,
  ) => Promise<OnUpdate<DetectionRule>>;
};

const service: HookCaller = DetectionRuleService as unknown as HookCaller;

const PROJECT_ID: ObjectID = new ObjectID(
  "67676767-6767-4767-8767-676767676767",
);
const RULE_ID: ObjectID = new ObjectID("78787878-7878-4878-8878-787878787878");

const FAILED: string = `title: Failed sign-in
name: failed_sign_in
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection`;

const SUCCEEDED: string = `title: Successful sign-in
name: successful_sign_in
detection:
  selection:
    className: Authentication
    statusName: Success
  condition: selection`;

const SELF_CONTAINED: string = `title: Failed sign-ins then a success
correlation:
  type: temporal_ordered
  rules: [failed_sign_in, successful_sign_in]
  group-by: [principalUser]
  timespan: 10m
---
${FAILED}
---
${SUCCEEDED}`;

const READS_PROJECT_RULES: string = `title: Failure then success
correlation:
  type: temporal_ordered
  rules: [failed_sign_in, successful_sign_in]
  group-by: [principalUser]
  timespan: 10m`;

function storedRule(id: string, sigmaRuleYaml: string): DetectionRule {
  const rule: DetectionRule = new DetectionRule();
  rule._id = id;
  rule.projectId = PROJECT_ID;
  rule.sigmaRuleYaml = sigmaRuleYaml;
  return rule;
}

function createBy(sigmaRuleYaml: string): CreateBy<DetectionRule> {
  const rule: DetectionRule = new DetectionRule();
  rule.projectId = PROJECT_ID;
  rule.sigmaRuleYaml = sigmaRuleYaml;
  return { data: rule, props: { isRoot: true } };
}

function updateBy(
  data: UpdateBy<DetectionRule>["data"],
): UpdateBy<DetectionRule> {
  return {
    query: { _id: RULE_ID.toString() },
    data,
    props: { isRoot: true },
    limit: 1,
    skip: 0,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("DetectionRuleService: correlation rules", () => {
  test("a self-contained correlation saves, named after the correlation, without reading other rules", async () => {
    const findAllBy: Spy = getJestSpyOn(DetectionRuleService, "findAllBy");

    const result: OnCreate<DetectionRule> = await service.onBeforeCreate(
      createBy(SELF_CONTAINED),
    );

    expect(result.createBy.data.name).toBe("Failed sign-ins then a success");
    expect(findAllBy).not.toHaveBeenCalled();
  });

  test("a correlation reading the project's rules saves when the project has them", async () => {
    const findAllBy: Spy = getJestSpyOn(
      DetectionRuleService,
      "findAllBy",
    ).mockResolvedValue([
      storedRule("11111111-1111-4111-8111-111111111111", FAILED),
      storedRule("22222222-2222-4222-8222-222222222222", SUCCEEDED),
    ] as never);

    const result: OnCreate<DetectionRule> = await service.onBeforeCreate(
      createBy(READS_PROJECT_RULES),
    );

    expect(result.createBy.data.name).toBe("Failure then success");
    expect(findAllBy).toHaveBeenCalledTimes(1);

    const query: { projectId: ObjectID } = (
      findAllBy.mock.calls[0]![0] as { query: { projectId: ObjectID } }
    ).query;
    expect(query.projectId.toString()).toBe(PROJECT_ID.toString());
  });

  test("a rule the project does not have is refused, by name", async () => {
    getJestSpyOn(DetectionRuleService, "findAllBy").mockResolvedValue([
      storedRule("11111111-1111-4111-8111-111111111111", FAILED),
    ] as never);

    await expect(
      service.onBeforeCreate(createBy(READS_PROJECT_RULES)),
    ).rejects.toThrow(
      'Sigma correlation "Failure then success": "successful_sign_in" is not in this YAML, nor the name or id of one of your detection rules.',
    );
  });

  test("a correlation with no project to read rules from is refused", async () => {
    const rule: DetectionRule = new DetectionRule();
    rule.sigmaRuleYaml = READS_PROJECT_RULES;

    await expect(
      service.onBeforeCreate({ data: rule, props: { isRoot: true } }),
    ).rejects.toThrow(
      "A correlation that reads your other detection rules needs the project it belongs to.",
    );
  });

  test("an unsupported type and a bad timespan are refused when saved", async () => {
    await expect(
      service.onBeforeCreate(
        createBy(`title: Sum
correlation:
  type: value_sum
  rules: [failed_sign_in]
  timespan: 5m
  condition:
    field: bytes
    gt: 10
---
${FAILED}`),
      ),
    ).rejects.toThrow(BadDataException);

    await expect(
      service.onBeforeCreate(
        createBy(SELF_CONTAINED.replace("timespan: 10m", "timespan: forever")),
      ),
    ).rejects.toThrow("timespan");
  });

  test("every rule a correlation reads is compiled when it is saved", async () => {
    await expect(
      service.onBeforeCreate(
        createBy(`title: Count
correlation:
  type: event_count
  rules: [numbers]
  timespan: 5m
  condition:
    gte: 3
---
title: Numbers
name: numbers
detection:
  selection:
    targetPort|gt: lots
  condition: selection`),
      ),
    ).rejects.toThrow("uses a numeric comparison with non-numeric value");
  });

  test("an update to a correlation reading the project's rules reads them for the rows it writes, leaving the rule itself out", async () => {
    const hold: Spy = getJestSpyOn(
      DetectionRuleService,
      "findRowsAndHoldUpdateToThem",
    ).mockResolvedValue([storedRule(RULE_ID.toString(), FAILED)] as never);
    const findAllBy: Spy = getJestSpyOn(
      DetectionRuleService,
      "findAllBy",
    ).mockResolvedValue([
      // The rule being saved: never one of its own steps.
      storedRule(RULE_ID.toString(), FAILED),
      storedRule("22222222-2222-4222-8222-222222222222", SUCCEEDED),
    ] as never);

    await expect(
      service.onBeforeUpdate(updateBy({ sigmaRuleYaml: READS_PROJECT_RULES })),
    ).rejects.toThrow('"failed_sign_in" is not in this YAML');

    expect(hold).toHaveBeenCalledTimes(1);
    expect(findAllBy).toHaveBeenCalledTimes(1);
  });

  test("an update with a self-contained correlation reads no other rule, and its own rows only to see whether they run in real time", async () => {
    const hold: Spy = getJestSpyOn(
      DetectionRuleService,
      "findRowsAndHoldUpdateToThem",
    ).mockResolvedValue([storedRule(RULE_ID.toString(), FAILED)] as never);
    const findAllBy: Spy = getJestSpyOn(DetectionRuleService, "findAllBy");

    const result: OnUpdate<DetectionRule> = await service.onBeforeUpdate(
      updateBy({ sigmaRuleYaml: SELF_CONTAINED }),
    );

    expect(result.carryForward).toBeNull();
    // A correlation cannot run in real time: the rows are read once, for that.
    expect(hold).toHaveBeenCalledTimes(1);
    expect(
      (hold.mock.calls[0]![1] as { isRealTime?: boolean }).isRealTime,
    ).toBe(true);
    expect(findAllBy).not.toHaveBeenCalled();
  });

  test("a real-time rule's YAML cannot become a correlation: it is told to go back to its interval first", async () => {
    const realTime: DetectionRule = storedRule(RULE_ID.toString(), FAILED);
    realTime.isRealTime = true;

    getJestSpyOn(
      DetectionRuleService,
      "findRowsAndHoldUpdateToThem",
    ).mockResolvedValue([realTime] as never);

    await expect(
      service.onBeforeUpdate(updateBy({ sigmaRuleYaml: SELF_CONTAINED })),
    ).rejects.toThrow(
      "This rule cannot run in real time. A correlation reads several events together over its timespan, so it runs on its interval.",
    );
  });
});
