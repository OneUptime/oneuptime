import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import EscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * The records these tests name are their project's own: the services check
 * every reference against the project (ProjectReferencesService).
 */
beforeEach(() => {
  stubProjectDirectory({});
});

/*
 * A RULE NOBODY NAMED IS CALLED AFTER ITS LEVEL.
 *
 * Adding an escalation rule in the dashboard asks who to notify and how long
 * to wait; the name waits under Advanced, and a rule left without one is
 * "Level 3" - the third rung of its policy's ladder. The server is where that
 * name is given, so an API caller who leaves the name out gets the same rule
 * the dashboard makes, and the dashboard's placeholder is what is saved.
 *
 * The name column stays required: the hook fills it in before the
 * required-field check runs, and a rule created past the hook (ignoreHooks)
 * still has to bring a name of its own.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const POLICY_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000001",
);

interface CountCall {
  query: Record<string, unknown>;
  props: Record<string, unknown>;
}

let countCalls: Array<CountCall>;
let rulesInPolicy: number;
let rulesBeforeOrder: number;

function makeRule(fields: Partial<OnCallDutyPolicyEscalationRule> = {}): {
  createBy: CreateBy<OnCallDutyPolicyEscalationRule>;
  rule: OnCallDutyPolicyEscalationRule;
} {
  const rule: OnCallDutyPolicyEscalationRule =
    new OnCallDutyPolicyEscalationRule();
  rule.projectId = PROJECT_ID;
  rule.onCallDutyPolicyId = POLICY_ID;
  rule.escalateAfterInMinutes = 30;
  Object.assign(rule, fields);

  return {
    rule,
    createBy: {
      data: rule,
      props: { isRoot: true },
    },
  };
}

async function runOnBeforeCreate(
  createBy: CreateBy<OnCallDutyPolicyEscalationRule>,
): Promise<OnCreate<OnCallDutyPolicyEscalationRule>> {
  return await (
    EscalationRuleService as unknown as {
      onBeforeCreate: (
        createBy: CreateBy<OnCallDutyPolicyEscalationRule>,
      ) => Promise<OnCreate<OnCallDutyPolicyEscalationRule>>;
    }
  ).onBeforeCreate(createBy);
}

function checkRequiredFields(rule: OnCallDutyPolicyEscalationRule): void {
  (
    EscalationRuleService as unknown as {
      checkRequiredFields: (
        data: OnCallDutyPolicyEscalationRule,
      ) => OnCallDutyPolicyEscalationRule;
    }
  ).checkRequiredFields(rule);
}

// The operator QueryHelper.lessThan builds, read back.
interface RawOperator {
  type: string;
  objectLiteralParameters: Record<string, unknown>;
  getSql: (alias: string) => string;
}

beforeEach(() => {
  countCalls = [];
  rulesInPolicy = 0;
  rulesBeforeOrder = 0;

  jest
    .spyOn(EscalationRuleService, "countBy")
    .mockImplementation(async (request: any): Promise<PositiveNumber> => {
      countCalls.push({ query: request.query, props: request.props });

      return new PositiveNumber(
        request.query.order !== undefined ? rulesBeforeOrder : rulesInPolicy,
      );
    });

  // The rules that make room for a rule inserted in the middle: none here.
  jest.spyOn(EscalationRuleService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(EscalationRuleService, "updateOneBy")
    .mockResolvedValue(0 as never);
  stubProjectDirectory({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a rule created without a name", () => {
  test("is called after the level it takes at the end of the ladder", async () => {
    rulesInPolicy = 2;
    rulesBeforeOrder = 2;

    const { createBy } = makeRule();
    const result: OnCreate<OnCallDutyPolicyEscalationRule> =
      await runOnBeforeCreate(createBy);

    expect(result.createBy.data.order).toBe(3);
    expect(result.createBy.data.name).toBe("Level 3");
  });

  test("is Level 1 on a policy with no rules yet", async () => {
    const { createBy } = makeRule();
    const result: OnCreate<OnCallDutyPolicyEscalationRule> =
      await runOnBeforeCreate(createBy);

    expect(result.createBy.data.order).toBe(1);
    expect(result.createBy.data.name).toBe("Level 1");
  });

  test("counts the rules ordered before it, of its own policy, as root", async () => {
    rulesInPolicy = 2;
    rulesBeforeOrder = 2;

    const { createBy } = makeRule();
    await runOnBeforeCreate(createBy);

    const levelCount: CountCall | undefined = countCalls.find(
      (call: CountCall): boolean => {
        return call.query["order"] !== undefined;
      },
    );

    expect(levelCount).toBeDefined();
    expect(String(levelCount!.query["onCallDutyPolicyId"])).toBe(
      POLICY_ID.toString(),
    );
    expect(levelCount!.props["isRoot"]).toBe(true);

    const operator: RawOperator = levelCount!.query[
      "order"
    ] as unknown as RawOperator;

    expect(operator.type).toBe("raw");
    expect(Object.values(operator.objectLiteralParameters)).toEqual([3]);
    expect(operator.getSql("rule.order")).toContain("rule.order <");
  });

  test("put in the middle by an API caller, is named by its place, not its order number", async () => {
    // Orders with a gap: rules at 1 and 5, the new one asks for 4.
    rulesInPolicy = 2;
    rulesBeforeOrder = 1;

    const { createBy } = makeRule({ order: 4 });
    const result: OnCreate<OnCallDutyPolicyEscalationRule> =
      await runOnBeforeCreate(createBy);

    expect(result.createBy.data.order).toBe(4);
    expect(result.createBy.data.name).toBe("Level 2");
  });

  test("put first by an API caller, is Level 1", async () => {
    rulesInPolicy = 3;
    rulesBeforeOrder = 0;

    const { createBy } = makeRule({ order: 1 });
    const result: OnCreate<OnCallDutyPolicyEscalationRule> =
      await runOnBeforeCreate(createBy);

    expect(result.createBy.data.name).toBe("Level 1");
  });

  test.each([
    ["an empty name", ""],
    ["a name of spaces", "   "],
  ])("with %s is named the same way", async (_label: string, name: string) => {
    rulesInPolicy = 1;
    rulesBeforeOrder = 1;

    const { createBy } = makeRule({ name });
    const result: OnCreate<OnCallDutyPolicyEscalationRule> =
      await runOnBeforeCreate(createBy);

    expect(result.createBy.data.name).toBe("Level 2");
  });

  test("passes the required-field check that runs after the hook", async () => {
    const { createBy } = makeRule();
    const result: OnCreate<OnCallDutyPolicyEscalationRule> =
      await runOnBeforeCreate(createBy);

    expect(() => {
      checkRequiredFields(result.createBy.data);
    }).not.toThrow();
  });
});

/*
 * Through the real create pipeline, up to the write: the hook names the rule
 * before the required-field check looks for a name, so an API create without
 * one reaches the database as "Level 2" rather than failing "name is
 * required". The write itself is stopped, so no database is needed.
 */
describe("an API create without a name, through the create pipeline", () => {
  const STOP: string = "stopped before the write";

  test("is written as Level N", async () => {
    rulesInPolicy = 1;
    rulesBeforeOrder = 1;

    let written: OnCallDutyPolicyEscalationRule | null = null;

    jest.spyOn(EscalationRuleService, "getRepository").mockReturnValue({
      save: async (
        data: OnCallDutyPolicyEscalationRule,
      ): Promise<OnCallDutyPolicyEscalationRule> => {
        written = data;
        throw new Error(STOP);
      },
    } as never);

    const { createBy } = makeRule();

    await expect(EscalationRuleService.create(createBy)).rejects.toThrow(STOP);

    expect(written).not.toBeNull();
    expect(written!.name).toBe("Level 2");
    expect(written!.order).toBe(2);
  });

  test("past the hooks (ignoreHooks) still has to bring a name", async () => {
    jest.spyOn(EscalationRuleService, "getRepository").mockReturnValue({
      save: async (): Promise<never> => {
        throw new Error(STOP);
      },
    } as never);

    const { rule } = makeRule({ order: 1 });

    await expect(
      EscalationRuleService.create({
        data: rule,
        props: { isRoot: true, ignoreHooks: true },
      }),
    ).rejects.toThrow("name is required");
  });
});

describe("the name column", () => {
  test("is still required where the hook does not run", () => {
    const { rule } = makeRule();
    rule.order = 1;

    expect(() => {
      checkRequiredFields(rule);
    }).toThrow("name is required");
  });

  test("is still required in the model, so the API and Terraform schemas are unchanged", () => {
    expect(
      new OnCallDutyPolicyEscalationRule().getRequiredColumns().columns,
    ).toContain("name");
  });
});

describe("a rule created with a name", () => {
  test("keeps it, and no level is counted for it", async () => {
    rulesInPolicy = 2;

    const { createBy } = makeRule({ name: "Managers" });
    const result: OnCreate<OnCallDutyPolicyEscalationRule> =
      await runOnBeforeCreate(createBy);

    expect(result.createBy.data.name).toBe("Managers");
    expect(
      countCalls.filter((call: CountCall): boolean => {
        return call.query["order"] !== undefined;
      }),
    ).toHaveLength(0);
  });

  test("keeps a name that only looks like a level's", async () => {
    rulesInPolicy = 2;

    const { createBy } = makeRule({ name: "Level 9" });
    const result: OnCreate<OnCallDutyPolicyEscalationRule> =
      await runOnBeforeCreate(createBy);

    expect(result.createBy.data.name).toBe("Level 9");
  });

  test("keeps its spacing as sent", async () => {
    const { createBy } = makeRule({ name: " Night shift " });
    const result: OnCreate<OnCallDutyPolicyEscalationRule> =
      await runOnBeforeCreate(createBy);

    expect(result.createBy.data.name).toBe(" Night shift ");
  });
});

describe("the rest of the create hook", () => {
  test("makes room for a rule inserted in the middle only once it is saved", async () => {
    rulesInPolicy = 3;
    rulesBeforeOrder = 1;

    const { createBy, rule } = makeRule({ order: 2 });
    await runOnBeforeCreate(createBy);

    // Nothing is moved before the rule exists.
    expect(EscalationRuleService.findBy).not.toHaveBeenCalled();
    expect(EscalationRuleService.updateOneBy).not.toHaveBeenCalled();

    rule._id = "30000000-0000-4000-8000-000000000001";

    await (
      EscalationRuleService as unknown as {
        onCreateSuccess: (
          onCreate: OnCreate<OnCallDutyPolicyEscalationRule>,
          createdItem: OnCallDutyPolicyEscalationRule,
        ) => Promise<OnCallDutyPolicyEscalationRule>;
      }
    ).onCreateSuccess({ createBy, carryForward: null }, rule);

    // The rules of the same policy, in the rule's own project.
    expect(EscalationRuleService.findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          onCallDutyPolicyId: POLICY_ID,
          projectId: PROJECT_ID,
        }),
      }),
    );
  });

  test("still refuses a rule with no policy", async () => {
    const { createBy, rule } = makeRule();
    delete (rule as Partial<OnCallDutyPolicyEscalationRule>).onCallDutyPolicyId;

    await expect(runOnBeforeCreate(createBy)).rejects.toThrow(
      "onCallDutyPolicyId is required",
    );
  });
});
