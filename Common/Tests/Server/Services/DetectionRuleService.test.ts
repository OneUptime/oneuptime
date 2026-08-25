import DetectionRuleService from "../../../Server/Services/DetectionRuleService";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * DetectionRuleService parses AND compiles the Sigma rule at save time, so
 * a rule that stores is a rule the detection engine can evaluate — a YAML
 * typo must surface to the person editing the rule, not as a cron-side
 * lastError hours later. These tests drive the create/update hooks
 * directly: invalid or aggregation-based Sigma is rejected, the rule name
 * defaults from the Sigma title, the evaluation interval is clamped to
 * whole minutes between 1 and 1440, and the match count threshold must be
 * a whole number between 1 and 1000000 (or omitted — the column defaults
 * to 1, so old API clients that never send it keep working).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const VALID_SIGMA_YAML: string = `
title: Failed Logins
description: Multiple failed logins detected
level: high
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection
`;

/*
 * The hooks are protected; the tests call them through a structural cast
 * (same instance, so \`this\` still binds to the service).
 */
type HookCaller = {
  onBeforeCreate: (
    createBy: CreateBy<DetectionRule>,
  ) => Promise<OnCreate<DetectionRule>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<DetectionRule>,
  ) => Promise<OnUpdate<DetectionRule>>;
};

const service: HookCaller = DetectionRuleService as unknown as HookCaller;

function buildRule(
  options: {
    name?: string;
    sigmaRuleYaml?: string;
    evaluationIntervalInMinutes?: number;
    matchCountThreshold?: number;
  } = {},
): DetectionRule {
  const rule: DetectionRule = new DetectionRule();
  rule.projectId = PROJECT_ID;
  rule.sigmaRuleYaml = options.sigmaRuleYaml ?? VALID_SIGMA_YAML;

  if (options.name !== undefined) {
    rule.name = options.name;
  }

  if (options.evaluationIntervalInMinutes !== undefined) {
    rule.evaluationIntervalInMinutes = options.evaluationIntervalInMinutes;
  }

  if (options.matchCountThreshold !== undefined) {
    rule.matchCountThreshold = options.matchCountThreshold;
  }

  return rule;
}

function buildCreateBy(rule: DetectionRule): CreateBy<DetectionRule> {
  return {
    data: rule,
    props: {
      isRoot: true,
    },
  };
}

function buildUpdateBy(
  data: UpdateBy<DetectionRule>["data"],
): UpdateBy<DetectionRule> {
  return {
    query: {},
    data,
    props: {
      isRoot: true,
    },
    limit: 1,
    skip: 0,
  };
}

describe("DetectionRuleService.onBeforeCreate", () => {
  test("a valid Sigma rule passes", async () => {
    const rule: DetectionRule = buildRule({ name: "My Rule" });

    const result: OnCreate<DetectionRule> = await service.onBeforeCreate(
      buildCreateBy(rule),
    );

    expect(result.createBy.data.name).toBe("My Rule");
    expect(result.carryForward).toBeNull();
  });

  test("missing YAML is rejected", async () => {
    const rule: DetectionRule = new DetectionRule();
    rule.projectId = PROJECT_ID;
    rule.name = "No YAML";

    await expect(service.onBeforeCreate(buildCreateBy(rule))).rejects.toThrow(
      BadDataException,
    );
  });

  test("syntactically invalid YAML is rejected with BadDataException", async () => {
    const rule: DetectionRule = buildRule({
      name: "Broken",
      sigmaRuleYaml: "title: [unclosed",
    });

    await expect(service.onBeforeCreate(buildCreateBy(rule))).rejects.toThrow(
      BadDataException,
    );
  });

  test("YAML without a detection mapping is rejected", async () => {
    const rule: DetectionRule = buildRule({
      name: "No Detection",
      sigmaRuleYaml: "title: Just a title",
    });

    await expect(service.onBeforeCreate(buildCreateBy(rule))).rejects.toThrow(
      BadDataException,
    );
  });

  test("an aggregation condition is rejected", async () => {
    const rule: DetectionRule = buildRule({
      name: "Aggregation",
      sigmaRuleYaml: `
title: Aggregating
detection:
  selection:
    className: Authentication
  condition: selection | count() > 5
`,
    });

    await expect(service.onBeforeCreate(buildCreateBy(rule))).rejects.toThrow(
      "aggregation",
    );
  });

  test("the rule name defaults from the Sigma title when absent", async () => {
    const rule: DetectionRule = buildRule();

    const result: OnCreate<DetectionRule> = await service.onBeforeCreate(
      buildCreateBy(rule),
    );

    expect(result.createBy.data.name).toBe("Failed Logins");
  });

  describe("evaluation interval validation", () => {
    test("0 is rejected", async () => {
      const rule: DetectionRule = buildRule({
        name: "Zero",
        evaluationIntervalInMinutes: 0,
      });

      await expect(service.onBeforeCreate(buildCreateBy(rule))).rejects.toThrow(
        BadDataException,
      );
    });

    test("1441 is rejected", async () => {
      const rule: DetectionRule = buildRule({
        name: "Too Long",
        evaluationIntervalInMinutes: 1441,
      });

      await expect(service.onBeforeCreate(buildCreateBy(rule))).rejects.toThrow(
        BadDataException,
      );
    });

    test("a fractional interval is rejected", async () => {
      const rule: DetectionRule = buildRule({
        name: "Fraction",
        evaluationIntervalInMinutes: 2.5,
      });

      await expect(service.onBeforeCreate(buildCreateBy(rule))).rejects.toThrow(
        BadDataException,
      );
    });

    test("1 is accepted", async () => {
      const rule: DetectionRule = buildRule({
        name: "Every Minute",
        evaluationIntervalInMinutes: 1,
      });

      await expect(
        service.onBeforeCreate(buildCreateBy(rule)),
      ).resolves.toBeDefined();
    });

    test("1440 is accepted", async () => {
      const rule: DetectionRule = buildRule({
        name: "Daily",
        evaluationIntervalInMinutes: 1440,
      });

      await expect(
        service.onBeforeCreate(buildCreateBy(rule)),
      ).resolves.toBeDefined();
    });
  });

  describe("match count threshold validation", () => {
    const THRESHOLD_ERROR: string =
      "Match count threshold must be a whole number between 1 and 1000000.";

    test.each([1, 5, 1000000])("%d is accepted", async (threshold: number) => {
      const rule: DetectionRule = buildRule({
        name: "Thresholded",
        matchCountThreshold: threshold,
      });

      await expect(
        service.onBeforeCreate(buildCreateBy(rule)),
      ).resolves.toBeDefined();
    });

    test.each([0, -1, 1.5, 1000001])(
      "%d is rejected with the exact message",
      async (threshold: number) => {
        const rule: DetectionRule = buildRule({
          name: "Bad Threshold",
          matchCountThreshold: threshold,
        });

        await expect(
          service.onBeforeCreate(buildCreateBy(rule)),
        ).rejects.toThrow(THRESHOLD_ERROR);
      },
    );

    test("an omitted threshold passes — the column defaults to 1, so old API clients that never send it still create rules", async () => {
      const rule: DetectionRule = buildRule({ name: "No Threshold" });

      expect(rule.matchCountThreshold).toBeUndefined();

      await expect(
        service.onBeforeCreate(buildCreateBy(rule)),
      ).resolves.toBeDefined();
    });

    test("a valid threshold does not bypass the Sigma validation that runs before it", async () => {
      const rule: DetectionRule = buildRule({
        name: "Still Broken YAML",
        sigmaRuleYaml: "title: [unclosed",
        matchCountThreshold: 5,
      });

      await expect(service.onBeforeCreate(buildCreateBy(rule))).rejects.toThrow(
        BadDataException,
      );
    });
  });
});

describe("DetectionRuleService.onBeforeUpdate", () => {
  test("an update without sigmaRuleYaml skips YAML validation", async () => {
    const result: OnUpdate<DetectionRule> = await service.onBeforeUpdate(
      buildUpdateBy({ description: "Just renaming things" }),
    );

    expect(result.carryForward).toBeNull();
  });

  test("an update with invalid sigmaRuleYaml is rejected", async () => {
    await expect(
      service.onBeforeUpdate(buildUpdateBy({ sigmaRuleYaml: "title: [nope" })),
    ).rejects.toThrow(BadDataException);
  });

  test("an update with valid sigmaRuleYaml passes", async () => {
    await expect(
      service.onBeforeUpdate(
        buildUpdateBy({ sigmaRuleYaml: VALID_SIGMA_YAML }),
      ),
    ).resolves.toBeDefined();
  });

  test("an update with an out-of-range interval is rejected", async () => {
    await expect(
      service.onBeforeUpdate(
        buildUpdateBy({ evaluationIntervalInMinutes: 1441 }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("an update with an invalid matchCountThreshold is rejected with the exact message", async () => {
    await expect(
      service.onBeforeUpdate(buildUpdateBy({ matchCountThreshold: 0 })),
    ).rejects.toThrow(
      "Match count threshold must be a whole number between 1 and 1000000.",
    );
  });

  test("an update with a valid matchCountThreshold passes", async () => {
    await expect(
      service.onBeforeUpdate(buildUpdateBy({ matchCountThreshold: 42 })),
    ).resolves.toBeDefined();
  });

  test("an update that omits matchCountThreshold skips the threshold validation", async () => {
    await expect(
      service.onBeforeUpdate(buildUpdateBy({ description: "No threshold" })),
    ).resolves.toBeDefined();
  });
});

describe("DetectionRuleService field-name trimming", () => {
  /*
   * groupByField / distinctCountField are looked up verbatim by the
   * evaluator — an unknown name silently becomes an attributes[] lookup
   * yielding '' on every row, and for a distinct-count rule that is a
   * permanent zero-fire outage with no error anywhere. Trimming at save
   * time kills the whitespace-from-a-paste class of that failure.
   */
  test("create trims whitespace from groupByField and distinctCountField", async () => {
    const rule: DetectionRule = buildRule();
    rule.groupByField = " principalIp ";
    rule.distinctCountField = "principalUser\t";

    const result: OnCreate<DetectionRule> = await service.onBeforeCreate(
      buildCreateBy(rule),
    );

    expect(result.createBy.data.groupByField).toBe("principalIp");
    expect(result.createBy.data.distinctCountField).toBe("principalUser");
  });

  test("create leaves omitted field names undefined", async () => {
    const result: OnCreate<DetectionRule> = await service.onBeforeCreate(
      buildCreateBy(buildRule()),
    );

    expect(result.createBy.data.groupByField).toBeUndefined();
    expect(result.createBy.data.distinctCountField).toBeUndefined();
  });

  test("update trims field names and collapses whitespace-only to the cleared value", async () => {
    const result: OnUpdate<DetectionRule> = await service.onBeforeUpdate(
      buildUpdateBy({
        groupByField: "  ",
        distinctCountField: " targetUser ",
      }),
    );

    // '' is the documented "feature off" value, so clearing still works.
    expect(result.updateBy.data.groupByField).toBe("");
    expect(result.updateBy.data.distinctCountField).toBe("targetUser");
  });

  test("an update that omits the field names does not add them", async () => {
    const result: OnUpdate<DetectionRule> = await service.onBeforeUpdate(
      buildUpdateBy({ description: "No field names" }),
    );

    expect("groupByField" in result.updateBy.data).toBe(false);
    expect("distinctCountField" in result.updateBy.data).toBe(false);
  });
});
