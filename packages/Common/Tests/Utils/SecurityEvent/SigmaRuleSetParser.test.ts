import BadDataException from "../../../Types/Exception/BadDataException";
import SigmaRule, { SigmaLevel } from "../../../Types/SecurityEvent/SigmaRule";
import {
  DetectionRuleDefinition,
  DetectionRuleType,
  SIGMA_CORRELATION_MAX_TEMPORAL_RULES,
  SigmaCorrelationType,
  detectionRuleTypeOf,
  getDetectionRuleTypeDefinition,
  isDetectionRuleType,
} from "../../../Types/SecurityEvent/SigmaCorrelation";
import SigmaRuleParser from "../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import SigmaRuleSetParser, {
  SIGMA_RULE_SET_MAX_DOCUMENTS,
  correlationAsSigmaRule,
  countMeetsComparisons,
  describeSigmaTimespan,
  detectionRuleHeader,
  minimumCountFor,
  parseSigmaTimespan,
} from "../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import { indexSigmaRules } from "../../../Utils/SecurityEvent/Sigma/SigmaRuleIndex";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * A detection rule's YAML is one Sigma rule or a Sigma correlation with
 * the rules it reads, in one file of YAML documents (the Sigma correlation
 * specification's own layout). Everything is checked when the rule is
 * saved, so these pin what the parser accepts - the specification's own
 * examples, each type, references in the file and among the project's
 * rules, aliases - and every refusal, with the sentence a person reads.
 */

const FAILED: string = `title: Failed sign-in
name: failed_sign_in
id: 11111111-1111-4111-8111-111111111111
tags:
  - attack.credential_access
  - attack.t1110
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

function correlation(
  yaml: string,
): Extract<DetectionRuleDefinition, { kind: "correlation" }> {
  const definition: DetectionRuleDefinition = SigmaRuleSetParser.parse(yaml);

  if (definition.kind !== "correlation") {
    throw new Error("expected a correlation");
  }

  return definition;
}

function refusal(yaml: string): string {
  try {
    SigmaRuleSetParser.parse(yaml);
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("expected the YAML to be refused");
}

describe("SigmaRuleSetParser: a single Sigma rule", () => {
  test("one document without a correlation is parsed exactly as SigmaRuleParser parses it", () => {
    const definition: DetectionRuleDefinition =
      SigmaRuleSetParser.parse(FAILED);

    expect(definition.kind).toBe("single");

    if (definition.kind !== "single") {
      return;
    }

    expect(definition.rule).toEqual(SigmaRuleParser.parse(FAILED));
    expect(definition.name).toBe("failed_sign_in");
    expect(detectionRuleTypeOf(definition)).toBe(DetectionRuleType.SingleEvent);
    expect(detectionRuleHeader(definition)).toBe(definition.rule);
  });

  test("a leading and a trailing document marker still make one rule", () => {
    const definition: DetectionRuleDefinition = SigmaRuleSetParser.parse(
      `---\n${FAILED}\n---\n`,
    );

    expect(definition.kind).toBe("single");
  });

  test("a single rule's own errors keep their sentences", () => {
    expect(refusal("title: Just a title")).toBe(
      "Sigma rule: a `detection` mapping is required.",
    );
    expect(refusal("")).toBe("Sigma rule: YAML is empty.");
    expect(refusal("---\n---\n")).toBe("Sigma rule: YAML is empty.");
    expect(refusal("- a\n- b")).toBe("Sigma rule: YAML must be a mapping.");
    expect(refusal("title: [unclosed")).toContain("Sigma rule: invalid YAML");
  });

  test("Sigma v1 aggregation pipes are still refused", () => {
    expect(
      refusal(`title: Old style
detection:
  selection:
    className: Authentication
  condition: selection | count() by principalIp > 5`),
    ).toContain("aggregation expressions");
  });
});

describe("SigmaRuleSetParser: the specification's example", () => {
  // Failed logins followed by a successful login, as the Sigma correlation specification writes it.
  const SPECIFICATION_EXAMPLE: string = `title: Correlation - Multiple Failed Logins Followed by Successful Login
id: b180ead8-d58f-40b2-ae54-c8940995b9b6
status: experimental
description: Detects multiple failed logins by a single user followed by a successful login of that user
level: high
correlation:
    type: temporal_ordered
    rules:
        - multiple_failed_login
        - successful_login
    group-by:
        - User
    timespan: 10m
---
title: Multiple failed logons
id: a8418a5a-5fc4-46b5-b23b-6c73beb19d41
name: multiple_failed_login
correlation:
    type: event_count
    rules:
        - failed_login
    group-by:
        - User
    timespan: 10m
    condition:
        gte: 10
---
title: Single failed login
id: 53ba33fd-3a50-4468-a5ef-c583635cfa92
name: failed_login
detection:
    selection:
        EventID:
            - 529
            - 4625
    condition: selection
---
title: Successful login
id: 4d0a2c83-c62c-4ed4-b475-c7e23a9269b8
name: successful_login
detection:
    selection:
        EventID:
            - 528
            - 4624
    condition: selection`;

  test("parses into a sequence whose first step counts", () => {
    const definition: Extract<
      DetectionRuleDefinition,
      { kind: "correlation" }
    > = correlation(SPECIFICATION_EXAMPLE);

    expect(definition.correlation.type).toBe(
      SigmaCorrelationType.TemporalOrdered,
    );
    expect(definition.correlation.title).toBe(
      "Correlation - Multiple Failed Logins Followed by Successful Login",
    );
    expect(definition.correlation.level).toBe(SigmaLevel.High);
    expect(definition.correlation.groupBy).toEqual(["User"]);
    expect(definition.correlation.timespanInSeconds).toBe(600);
    expect(definition.unresolvedReferences).toEqual([]);
    expect(
      definition.steps.map((step: { reference: string }): string => {
        return step.reference;
      }),
    ).toEqual(["multiple_failed_login", "successful_login"]);

    const [first, second] = definition.steps;

    expect(first!.count?.correlation.type).toBe(
      SigmaCorrelationType.EventCount,
    );
    expect(first!.count?.correlation.condition.comparisons).toEqual([
      { operator: "gte", value: 10 },
    ]);
    expect(
      first!.count?.rules.map((rule: SigmaRule): string => {
        return rule.title;
      }),
    ).toEqual(["Single failed login"]);
    expect(second!.rule?.title).toBe("Successful login");
    expect(second!.origin).toBe("file");
    expect(detectionRuleTypeOf(definition)).toBe(
      DetectionRuleType.TemporalOrdered,
    );
  });

  test("the documents can come in any order", () => {
    const documents: Array<string> = SPECIFICATION_EXAMPLE.split("\n---\n");
    const reversed: string = [...documents].reverse().join("\n---\n");

    expect(correlation(reversed).correlation.title).toBe(
      "Correlation - Multiple Failed Logins Followed by Successful Login",
    );
  });

  test("the rule is written as the correlation: its title, level and id", () => {
    const header: SigmaRule = detectionRuleHeader(
      correlation(SPECIFICATION_EXAMPLE),
    );

    expect(header.title).toBe(
      "Correlation - Multiple Failed Logins Followed by Successful Login",
    );
    expect(header.level).toBe(SigmaLevel.High);
    expect(header.id).toBe("b180ead8-d58f-40b2-ae54-c8940995b9b6");
  });
});

describe("SigmaRuleSetParser: each type", () => {
  test("event_count with a range condition", () => {
    const definition: Extract<
      DetectionRuleDefinition,
      { kind: "correlation" }
    > = correlation(`title: Between 101 and 200 failures
correlation:
  type: event_count
  rules: [failed_sign_in]
  group-by: [principalIp]
  timespan: 1h
  condition:
    gt: 100
    lte: 200
---
${FAILED}`);

    expect(definition.correlation.condition.comparisons).toEqual([
      { operator: "gt", value: 100 },
      { operator: "lte", value: 200 },
    ]);
    expect(detectionRuleTypeOf(definition)).toBe(DetectionRuleType.EventCount);
  });

  test("value_count reads the field it counts, one or several", () => {
    const one: Extract<DetectionRuleDefinition, { kind: "correlation" }> =
      correlation(`title: Spraying
correlation:
  type: value_count
  rules: [failed_sign_in]
  group-by: [principalIp]
  timespan: 10m
  condition:
    field: principalUser
    gte: 5
---
${FAILED}`);

    expect(one.correlation.condition.fields).toEqual(["principalUser"]);
    expect(detectionRuleTypeOf(one)).toBe(DetectionRuleType.ValueCount);

    const several: Extract<DetectionRuleDefinition, { kind: "correlation" }> =
      correlation(`title: Spraying
correlation:
  type: value_count
  rules: [failed_sign_in]
  group-by: [principalIp]
  timespan: 10m
  condition:
    field: [principalUser, targetHost]
    gte: 5
---
${FAILED}`);

    expect(several.correlation.condition.fields).toEqual([
      "principalUser",
      "targetHost",
    ]);
  });

  test("temporal, with and without how many of its rules must match", () => {
    const all: Extract<DetectionRuleDefinition, { kind: "correlation" }> =
      correlation(`title: Together
correlation:
  type: temporal
  rules: [failed_sign_in, successful_sign_in]
  group-by: [principalUser]
  timespan: 5m
---
${FAILED}
---
${SUCCEEDED}`);

    expect(all.correlation.condition.comparisons).toEqual([]);
    expect(detectionRuleTypeOf(all)).toBe(DetectionRuleType.Temporal);

    const twoOfThree: Extract<
      DetectionRuleDefinition,
      { kind: "correlation" }
    > = correlation(`title: Two of three
correlation:
  type: temporal
  rules: [failed_sign_in, successful_sign_in, third]
  group-by: [principalUser]
  timespan: 5m
  condition:
    gte: 2
---
${FAILED}
---
${SUCCEEDED}
---
title: Third
name: third
detection:
  selection:
    className: Account Change
  condition: selection`);

    expect(twoOfThree.correlation.condition.comparisons).toEqual([
      { operator: "gte", value: 2 },
    ]);
  });

  test("new_value, OneUptime's own type", () => {
    const definition: Extract<
      DetectionRuleDefinition,
      { kind: "correlation" }
    > = correlation(`title: New address for an account
correlation:
  type: new_value
  rules: [successful_sign_in]
  group-by: [principalUser]
  timespan: 14d
  condition:
    field: principalIp
---
${SUCCEEDED}`);

    expect(definition.correlation.type).toBe(SigmaCorrelationType.NewValue);
    expect(definition.correlation.timespanInSeconds).toBe(14 * 24 * 60 * 60);
    expect(definition.correlation.condition.fields).toEqual(["principalIp"]);
    expect(detectionRuleTypeOf(definition)).toBe(DetectionRuleType.NewValue);
  });

  test("group_by and groupBy are read as group-by", () => {
    for (const key of ["group_by", "groupBy"]) {
      expect(
        correlation(`title: Count
correlation:
  type: event_count
  rules: [failed_sign_in]
  ${key}: [principalIp]
  timespan: 5m
  condition:
    gte: 3
---
${FAILED}`).correlation.groupBy,
      ).toEqual(["principalIp"]);
    }
  });

  test("a correlation without ATT&CK tags takes its rules'", () => {
    const definition: Extract<
      DetectionRuleDefinition,
      { kind: "correlation" }
    > = correlation(`title: Count
correlation:
  type: event_count
  rules: [failed_sign_in]
  timespan: 5m
  condition:
    gte: 3
---
${FAILED}`);

    expect(definition.correlation.mitreTactics).toEqual(["TA0006"]);
    expect(definition.correlation.mitreTechniques).toEqual(["T1110"]);
  });

  test("a correlation's own tags win over its rules'", () => {
    const definition: Extract<
      DetectionRuleDefinition,
      { kind: "correlation" }
    > = correlation(`title: Count
tags:
  - attack.t1078
correlation:
  type: event_count
  rules: [failed_sign_in]
  timespan: 5m
  condition:
    gte: 3
---
${FAILED}`);

    expect(definition.correlation.mitreTechniques).toEqual(["T1078"]);
  });

  test("a rule is read by its id as well as its name", () => {
    const definition: Extract<
      DetectionRuleDefinition,
      { kind: "correlation" }
    > = correlation(`title: Count
correlation:
  type: event_count
  rules: [11111111-1111-4111-8111-111111111111]
  timespan: 5m
  condition:
    gte: 3
---
${FAILED}`);

    expect(definition.steps[0]!.rule?.title).toBe("Failed sign-in");
  });

  test("aliases say which field each rule keeps the grouped value in", () => {
    const definition: Extract<
      DetectionRuleDefinition,
      { kind: "correlation" }
    > = correlation(`title: Aliased
correlation:
  type: temporal
  rules: [failed_sign_in, successful_sign_in]
  group-by: [address]
  timespan: 5m
  aliases:
    address:
      failed_sign_in: principalIp
      successful_sign_in: targetIp
---
${FAILED}
---
${SUCCEEDED}`);

    expect(definition.correlation.aliases).toEqual({
      address: {
        failed_sign_in: "principalIp",
        successful_sign_in: "targetIp",
      },
    });
  });
});

describe("SigmaRuleSetParser: rules of the project", () => {
  test("a reference the file does not hold is left for the project's rules", () => {
    const definition: Extract<
      DetectionRuleDefinition,
      { kind: "correlation" }
    > = correlation(`title: Failures then success
correlation:
  type: temporal_ordered
  rules: [failed_sign_in, successful_sign_in]
  group-by: [principalUser]
  timespan: 10m`);

    expect(definition.unresolvedReferences).toEqual([
      "failed_sign_in",
      "successful_sign_in",
    ]);
    expect(definition.steps[0]!.title).toBe("failed_sign_in");
    expect(definition.steps[0]!.rule).toBeUndefined();
  });

  test("the project's rules resolve them, by Sigma id or name, on or off", () => {
    const resolveReference: (reference: string) => SigmaRule | undefined =
      indexSigmaRules([
        { id: "rule-1", sigmaRuleYaml: FAILED },
        { id: "rule-2", sigmaRuleYaml: SUCCEEDED },
      ]);

    const definition: DetectionRuleDefinition = SigmaRuleSetParser.parse(
      `title: Failures then success
correlation:
  type: temporal_ordered
  rules: [11111111-1111-4111-8111-111111111111, successful_sign_in]
  group-by: [principalUser]
  timespan: 10m`,
      { resolveReference },
    );

    expect(definition.kind).toBe("correlation");

    if (definition.kind !== "correlation") {
      return;
    }

    expect(definition.unresolvedReferences).toEqual([]);
    expect(
      definition.steps.map((step: { origin: string }): string => {
        return step.origin;
      }),
    ).toEqual(["project", "project"]);
    expect(definition.steps[1]!.rule?.title).toBe("Successful sign-in");
  });

  test("a reference nothing resolves is refused, naming it", () => {
    expect(() => {
      SigmaRuleSetParser.parse(
        `title: Failures then success
correlation:
  type: temporal_ordered
  rules: [failed_sign_in, gone_rule]
  group-by: [principalUser]
  timespan: 10m`,
        { resolveReference: indexSigmaRules([{ sigmaRuleYaml: FAILED }]) },
      );
    }).toThrow(
      'Sigma correlation "Failures then success": "gone_rule" is not in this YAML, nor the name or id of one of your detection rules.',
    );
  });

  test("the index leaves out the rule being saved, correlations, and rules that do not parse", () => {
    const resolve: (reference: string) => SigmaRule | undefined =
      indexSigmaRules(
        [
          { id: "self", sigmaRuleYaml: FAILED },
          { id: "broken", sigmaRuleYaml: "title: [unclosed" },
          {
            id: "a-correlation",
            sigmaRuleYaml: `title: Count
name: a_correlation
correlation:
  type: event_count
  rules: [x]
  timespan: 5m
  condition:
    gte: 3`,
          },
          { id: "empty", sigmaRuleYaml: undefined },
        ],
        { excludeRuleId: "self" },
      );

    expect(resolve("failed_sign_in")).toBeUndefined();
    expect(resolve("a_correlation")).toBeUndefined();
  });

  test("when two rules carry one name, the first is read", () => {
    const resolve: (reference: string) => SigmaRule | undefined =
      indexSigmaRules([
        { sigmaRuleYaml: FAILED },
        { sigmaRuleYaml: FAILED.replace("Failed sign-in", "Second copy") },
      ]);

    expect(resolve("failed_sign_in")?.title).toBe("Failed sign-in");
  });
});

describe("SigmaRuleSetParser: refusals", () => {
  test("unsupported Sigma types are refused by name", () => {
    for (const type of ["value_sum", "value_avg", "value_percentile"]) {
      expect(
        refusal(`title: Sum
correlation:
  type: ${type}
  rules: [failed_sign_in]
  timespan: 5m
  condition:
    field: bytes
    gt: 100
---
${FAILED}`),
      ).toBe(
        `Sigma correlation: type "${type}" is not supported. Supported: event_count, value_count, temporal, temporal_ordered, new_value.`,
      );
    }
  });

  test("an unknown or missing type", () => {
    expect(
      refusal(`title: X
correlation:
  type: sometimes
  rules: [failed_sign_in]
  timespan: 5m
---
${FAILED}`),
    ).toContain(
      '`type` must be one of event_count, value_count, temporal, temporal_ordered, new_value, not "sometimes".',
    );

    expect(
      refusal(`title: X
correlation:
  rules: [failed_sign_in]
  timespan: 5m
---
${FAILED}`),
    ).toContain("`type` must be one of");
  });

  test("no rules, a rule named twice, or more rules than a correlation reads", () => {
    expect(
      refusal(`title: X
correlation:
  type: event_count
  rules: []
  timespan: 5m
  condition:
    gte: 2`),
    ).toContain("`rules` must name at least one rule");

    expect(
      refusal(`title: X
correlation:
  type: temporal
  rules: [failed_sign_in, failed_sign_in]
  timespan: 5m
---
${FAILED}`),
    ).toBe('Sigma correlation: `rules` names "failed_sign_in" twice.');

    const eleven: string = Array.from({ length: 11 })
      .map((_value: unknown, index: number): string => {
        return `r${index}`;
      })
      .join(", ");

    expect(
      refusal(`title: Too many
correlation:
  type: event_count
  rules: [${eleven}]
  timespan: 5m
  condition:
    gte: 2`),
    ).toBe(
      'Sigma correlation "Too many": a correlation reads at most 10 rules.',
    );
  });

  test("a temporal correlation reads two to five rules", () => {
    expect(
      refusal(`title: One step
correlation:
  type: temporal_ordered
  rules: [failed_sign_in]
  timespan: 5m
---
${FAILED}`),
    ).toBe(
      `Sigma correlation "One step": a temporal_ordered correlation reads 2 to ${SIGMA_CORRELATION_MAX_TEMPORAL_RULES} rules.`,
    );
  });

  test("timespans: a whole number and a unit, within bounds", () => {
    for (const bad of ["10", "m", "1.5h", "-5m", "10x", "10 m", "0m", "5mm"]) {
      expect(
        refusal(`title: X
correlation:
  type: event_count
  rules: [failed_sign_in]
  timespan: "${bad}"
  condition:
    gte: 2
---
${FAILED}`),
      ).toMatch(/timespan|longer than nothing/);
    }

    expect(
      refusal(`title: Too long
correlation:
  type: event_count
  rules: [failed_sign_in]
  timespan: 2d
  condition:
    gte: 2
---
${FAILED}`),
    ).toBe('Sigma correlation "Too long": its timespan is at most 24h.');

    expect(
      refusal(`title: No timespan
correlation:
  type: event_count
  rules: [failed_sign_in]
  condition:
    gte: 2
---
${FAILED}`),
    ).toContain("`timespan` is required");
  });

  test("conditions: what each type asks for", () => {
    expect(
      refusal(`title: No condition
correlation:
  type: event_count
  rules: [failed_sign_in]
  timespan: 5m
---
${FAILED}`),
    ).toBe(
      'Sigma correlation "No condition": an event_count correlation needs a condition, such as `gte: 10`.',
    );

    expect(
      refusal(`title: Field on a count
correlation:
  type: event_count
  rules: [failed_sign_in]
  timespan: 5m
  condition:
    field: principalUser
    gte: 3
---
${FAILED}`),
    ).toContain("use value_count");

    expect(
      refusal(`title: No field
correlation:
  type: value_count
  rules: [failed_sign_in]
  timespan: 5m
  condition:
    gte: 3
---
${FAILED}`),
    ).toContain("needs `condition.field`");

    expect(
      refusal(`title: Bad operator
correlation:
  type: event_count
  rules: [failed_sign_in]
  timespan: 5m
  condition:
    above: 3
---
${FAILED}`),
    ).toContain('"above" is not a condition');

    expect(
      refusal(`title: Not a number
correlation:
  type: event_count
  rules: [failed_sign_in]
  timespan: 5m
  condition:
    gte: lots
---
${FAILED}`),
    ).toContain('condition "gte" must be a whole number, not "lots"');

    expect(
      refusal(`title: Ordered with a condition
correlation:
  type: temporal_ordered
  rules: [failed_sign_in, successful_sign_in]
  timespan: 5m
  condition:
    gte: 1
---
${FAILED}
---
${SUCCEEDED}`),
    ).toContain("Leave its condition out");

    expect(
      refusal(`title: Temporal asking for one
correlation:
  type: temporal
  rules: [failed_sign_in, successful_sign_in]
  timespan: 5m
  condition:
    gte: 1
---
${FAILED}
---
${SUCCEEDED}`),
    ).toContain("as `gte: N` with N from 2 to 2");
  });

  test("new_value needs a group, a field, no count and a history of a day to thirty", () => {
    const base: (lines: string) => string = (lines: string): string => {
      return `title: New
correlation:
  type: new_value
  rules: [successful_sign_in]
${lines}
---
${SUCCEEDED}`;
    };

    expect(
      refusal(base("  timespan: 14d\n  condition:\n    field: principalIp")),
    ).toContain("needs `group-by`");
    expect(
      refusal(base("  group-by: [principalUser]\n  timespan: 14d")),
    ).toContain("needs `condition.field`");
    expect(
      refusal(
        base(
          "  group-by: [principalUser]\n  timespan: 14d\n  condition:\n    field: principalIp\n    gte: 2",
        ),
      ),
    ).toContain("its condition takes only `field`");
    expect(
      refusal(
        base(
          "  group-by: [principalUser]\n  timespan: 12h\n  condition:\n    field: principalIp",
        ),
      ),
    ).toContain("1d to 30d");
    expect(
      refusal(
        base(
          "  group-by: [principalUser]\n  timespan: 31d\n  condition:\n    field: principalIp",
        ),
      ),
    ).toContain("1d to 30d");
  });

  test("more than three group-by fields", () => {
    expect(
      refusal(`title: Wide
correlation:
  type: event_count
  rules: [failed_sign_in]
  group-by: [a, b, c, d]
  timespan: 5m
  condition:
    gte: 2
---
${FAILED}`),
    ).toBe("Sigma correlation: `group-by` takes at most 3 fields.");
  });

  test("several rules with no correlation", () => {
    expect(refusal(`${FAILED}\n---\n${SUCCEEDED}`)).toContain(
      "need a correlation that says how they go together",
    );
  });

  test("two correlations that nothing reads", () => {
    expect(
      refusal(`title: First
correlation:
  type: event_count
  rules: [failed_sign_in]
  timespan: 5m
  condition:
    gte: 2
---
title: Second
correlation:
  type: event_count
  rules: [failed_sign_in]
  timespan: 5m
  condition:
    gte: 3
---
${FAILED}`),
    ).toContain('this file has 2 that nothing else reads ("First", "Second")');
  });

  test("correlations reading each other in a circle, or themselves", () => {
    expect(
      refusal(`title: A
name: a
correlation:
  type: temporal
  rules: [b, failed_sign_in]
  timespan: 5m
---
title: B
name: b
correlation:
  type: temporal
  rules: [a, failed_sign_in]
  timespan: 5m
---
${FAILED}`),
    ).toContain("read each other in a circle");

    expect(
      refusal(`title: Self
name: self
correlation:
  type: event_count
  rules: [self]
  timespan: 5m
  condition:
    gte: 2`),
    ).toBe('Sigma correlation "Self" reads itself.');
  });

  test("a rule in the file that no correlation reads", () => {
    expect(
      refusal(`title: Count
correlation:
  type: event_count
  rules: [failed_sign_in]
  timespan: 5m
  condition:
    gte: 2
---
${FAILED}
---
${SUCCEEDED}`),
    ).toContain(
      '"successful_sign_in" (document 3) is in the file, but no correlation reads it',
    );
  });

  test("one name or id for two documents", () => {
    expect(
      refusal(`title: Count
correlation:
  type: event_count
  rules: [failed_sign_in]
  timespan: 5m
  condition:
    gte: 2
---
${FAILED}
---
${FAILED}`),
    ).toContain('"failed_sign_in" names both document 2 and document 3');
  });

  test("only temporal correlations read other correlations, and only event_count ones", () => {
    expect(
      refusal(`title: Count of counts
correlation:
  type: event_count
  rules: [inner]
  timespan: 5m
  condition:
    gte: 2
---
title: Inner
name: inner
correlation:
  type: event_count
  rules: [failed_sign_in]
  timespan: 5m
  condition:
    gte: 2
---
${FAILED}`),
    ).toContain(
      "only temporal and temporal_ordered correlations can read another correlation",
    );

    expect(
      refusal(`title: Sequence of distinct values
correlation:
  type: temporal_ordered
  rules: [inner, successful_sign_in]
  timespan: 5m
---
title: Inner
name: inner
correlation:
  type: value_count
  rules: [failed_sign_in]
  timespan: 5m
  condition:
    field: principalUser
    gte: 2
---
${FAILED}
---
${SUCCEEDED}`),
    ).toContain("A step can be a Sigma rule or an event_count correlation.");

    expect(
      refusal(`title: Fewer than
correlation:
  type: temporal_ordered
  rules: [inner, successful_sign_in]
  timespan: 5m
---
title: Inner
name: inner
correlation:
  type: event_count
  rules: [failed_sign_in]
  timespan: 5m
  condition:
    lt: 2
---
${FAILED}
---
${SUCCEEDED}`),
    ).toContain("as a step, its condition says how many events it takes");
  });

  test("an alias that does not say where one of the rules keeps it", () => {
    expect(
      refusal(`title: Aliased
correlation:
  type: temporal
  rules: [failed_sign_in, successful_sign_in]
  group-by: [address]
  timespan: 5m
  aliases:
    address:
      failed_sign_in: principalIp
---
${FAILED}
---
${SUCCEEDED}`),
    ).toBe(
      'Sigma correlation "Aliased": alias "address" does not say which field "successful_sign_in" keeps it in.',
    );
  });

  test("a document that is neither a rule nor a correlation, or both", () => {
    expect(
      refusal(`title: Count
correlation:
  type: event_count
  rules: [failed_sign_in]
  timespan: 5m
  condition:
    gte: 2
---
title: Nothing
description: no detection, no correlation`),
    ).toContain("document 2 is neither a rule");

    expect(
      refusal(`title: Both
correlation:
  type: event_count
  rules: [x]
  timespan: 5m
  condition:
    gte: 2
detection:
  selection:
    a: b
  condition: selection`),
    ).toContain("a document is a rule (detection) or a correlation, not both");
  });

  test("a rule of the file with a broken detection says which document", () => {
    expect(
      refusal(`title: Count
correlation:
  type: event_count
  rules: [broken]
  timespan: 5m
  condition:
    gte: 2
---
title: Broken
name: broken
detection:
  selection:
    a: b
  condition: nothing_here`),
    ).toContain("document 2: Sigma condition: unknown selection");
  });

  test(`more than ${SIGMA_RULE_SET_MAX_DOCUMENTS} documents`, () => {
    const documents: Array<string> = [];

    for (
      let index: number = 0;
      index <= SIGMA_RULE_SET_MAX_DOCUMENTS;
      index++
    ) {
      documents.push(
        `title: Rule ${index}\nname: r${index}\ndetection:\n  selection:\n    a: b\n  condition: selection`,
      );
    }

    expect(refusal(documents.join("\n---\n"))).toContain(
      `at most ${SIGMA_RULE_SET_MAX_DOCUMENTS} YAML documents`,
    );
  });
});

describe("SigmaRuleSetParser helpers", () => {
  test("isCorrelationYaml never throws", () => {
    expect(SigmaRuleSetParser.isCorrelationYaml(FAILED)).toBe(false);
    expect(SigmaRuleSetParser.isCorrelationYaml(undefined)).toBe(false);
    expect(SigmaRuleSetParser.isCorrelationYaml("title: [unclosed")).toBe(
      false,
    );
    expect(
      SigmaRuleSetParser.isCorrelationYaml(`title: Count
correlation:
  type: event_count
  rules: [failed_sign_in]
  timespan: 5m
  condition:
    gte: 2`),
    ).toBe(true);
  });

  test("timespans in seconds and as a person says them", () => {
    expect(parseSigmaTimespan("30s")).toBe(30);
    expect(parseSigmaTimespan("10m")).toBe(600);
    expect(parseSigmaTimespan("2h")).toBe(7200);
    expect(parseSigmaTimespan("7d")).toBe(604800);
    expect(parseSigmaTimespan("1w")).toBe(604800);
    expect(describeSigmaTimespan(600)).toBe("10 minutes");
    expect(describeSigmaTimespan(60)).toBe("1 minute");
    expect(describeSigmaTimespan(3600)).toBe("1 hour");
    expect(describeSigmaTimespan(14 * 86400)).toBe("2 weeks");
    expect(describeSigmaTimespan(86400)).toBe("1 day");
    expect(describeSigmaTimespan(90)).toBe("90 seconds");
  });

  test("a timespan of any length is read at once", () => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        expect(() => {
          parseSigmaTimespan(`${"9".repeat(400000)}m`);
        }).toThrow(BadDataException);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });

  test("the count a condition is first met at, and whether a count meets it", () => {
    expect(minimumCountFor([{ operator: "gte", value: 10 }])).toBe(10);
    expect(minimumCountFor([{ operator: "gt", value: 10 }])).toBe(11);
    expect(minimumCountFor([{ operator: "lt", value: 10 }])).toBe(1);
    expect(minimumCountFor([])).toBe(1);

    const range: Array<{ operator: "gt" | "lte"; value: number }> = [
      { operator: "gt", value: 100 },
      { operator: "lte", value: 200 },
    ];

    expect(countMeetsComparisons(100, range)).toBe(false);
    expect(countMeetsComparisons(101, range)).toBe(true);
    expect(countMeetsComparisons(200, range)).toBe(true);
    expect(countMeetsComparisons(201, range)).toBe(false);
    expect(countMeetsComparisons(3, [{ operator: "eq", value: 3 }])).toBe(true);
    expect(countMeetsComparisons(3, [{ operator: "neq", value: 3 }])).toBe(
      false,
    );
  });

  test("a correlation written as a Sigma rule carries no selection of its own", () => {
    const rule: SigmaRule = correlationAsSigmaRule(
      correlation(`title: Count
level: critical
correlation:
  type: event_count
  rules: [failed_sign_in]
  timespan: 5m
  condition:
    gte: 2
---
${FAILED}`).correlation,
    );

    expect(rule.title).toBe("Count");
    expect(rule.level).toBe(SigmaLevel.Critical);
    expect(rule.selections).toEqual([]);
  });

  test("every type has a title and a description, and unknown types read as a single event", () => {
    for (const type of Object.values(DetectionRuleType)) {
      expect(isDetectionRuleType(type)).toBe(true);
      expect(getDetectionRuleTypeDefinition(type).type).toBe(type);
      expect(getDetectionRuleTypeDefinition(type).title.length).toBeGreaterThan(
        0,
      );
    }

    expect(isDetectionRuleType("nope")).toBe(false);
    expect(getDetectionRuleTypeDefinition("nope").type).toBe(
      DetectionRuleType.SingleEvent,
    );
  });
});
