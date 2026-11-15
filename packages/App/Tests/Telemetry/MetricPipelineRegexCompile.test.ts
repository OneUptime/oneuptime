/*
 * These tests exercise applyRules/clearCache only — loadRules (the one
 * Postgres touchpoint) is never called, so stub the DatabaseService module
 * out before it drags the whole server-side service graph into the ts-jest
 * compile.
 */
jest.mock("Common/Server/Services/DatabaseService", () => {
  /*
   * Service constructors touch a little base-class API before any database
   * work happens, so the stub has to answer it. `hardDeleteItemsOlderThanInDays`
   * is the one that bites: ~100 services call it from their constructor, but
   * only `if (IsBillingEnabled)` — which is off in a plain local checkout and
   * ON in CI (Common/test-setup.sh writes BILLING_ENABLED=true). A bare
   * `class {}` therefore passes locally and dies in CI the moment this test's
   * import graph reaches one of those services, with a suite-level
   * "hardDeleteItemsOlderThanInDays is not a function" and no failing test to
   * point at. The state timeline services also call `keepRowsOnDeleteByQuery`
   * from their constructors, always. Anything genuinely used by the code under
   * test belongs in the test's own mocks, not here.
   */
  return {
    __esModule: true,
    default: class DatabaseServiceStub {
      public hardDeleteItemsOlderThanInDays(): void {
        // no-op: retention config, nothing for a pure unit test to do.
      }

      public setDoNotAllowDelete(): void {
        // no-op: delete-permission config, same.
      }

      public keepRowsOnDeleteByQuery(): void {
        // no-op: the rows a delete by query keeps, config too.
      }
    },
  };
});

import MetricPipelineRuleService, {
  MetricRulesForProject,
} from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import MetricPipelineRule from "Common/Models/DatabaseModels/MetricPipelineRule";
import MetricPipelineRuleType from "Common/Types/Metrics/MetricPipelineRuleType";
import {
  MetricPipelineRuleFilterCheckOn,
  MetricPipelineRuleFilterConditionType,
} from "Common/Types/Metrics/MetricPipelineRuleFilterCondition";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import { INHERITED_PROPERTY_NAMES } from "Common/Tests/Helpers/InheritedNames";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Contract under test — regex handling and attribute-key bookkeeping in the
 * metric pipeline rule engine, which runs per metric ROW on the ingest hot
 * path.
 *
 * Regexes: a MatchesRegex / DoesNotMatchRegex filter used to construct its
 * RegExp (and warn-log invalid patterns) on EVERY datapoint evaluation.
 * Patterns are now compiled once per process and memoized; an invalid
 * pattern is stored as null and warned about exactly once. The
 * constructor-count test is the mutation guard for the memo.
 *
 * attributeKeys: mutating rules (Rename/Add/RemoveAttribute) used to re-sort
 * the full key list per rule per row. The sort is now deferred and runs at
 * most once per row, after all rules — these tests pin that the final
 * attributeKeys is still correct (sorted, matching the attributes map) in
 * every mutation scenario, including rule chains.
 */

function regexRule(data: {
  conditionType: MetricPipelineRuleFilterConditionType;
  pattern: string;
  ruleType?: MetricPipelineRuleType;
}): MetricPipelineRule {
  const rule: MetricPipelineRule = new MetricPipelineRule();
  rule.id = ObjectID.generate();
  rule.ruleType = data.ruleType ?? MetricPipelineRuleType.Drop;
  rule.filters = [
    {
      checkOn: MetricPipelineRuleFilterCheckOn.MetricName,
      conditionType: data.conditionType,
      value: data.pattern,
    },
  ];
  return rule;
}

function attributeRule(data: {
  ruleType: MetricPipelineRuleType;
  addAttributeKey?: string;
  addAttributeValue?: string;
  renameFromKey?: string;
  renameToKey?: string;
}): MetricPipelineRule {
  const rule: MetricPipelineRule = new MetricPipelineRule();
  rule.id = ObjectID.generate();
  rule.ruleType = data.ruleType;
  rule.filters = []; // matches everything
  if (data.addAttributeKey !== undefined) {
    rule.addAttributeKey = data.addAttributeKey;
  }
  if (data.addAttributeValue !== undefined) {
    rule.addAttributeValue = data.addAttributeValue;
  }
  if (data.renameFromKey !== undefined) {
    rule.renameFromKey = data.renameFromKey;
  }
  if (data.renameToKey !== undefined) {
    rule.renameToKey = data.renameToKey;
  }
  return rule;
}

function projectRules(
  ...rules: Array<MetricPipelineRule>
): MetricRulesForProject {
  return { projectRules: rules, rulesByServiceId: new Map() };
}

/*
 * Minimal structural view of a jest spy — the @jest/globals and @types/jest
 * spy types disagree in this repo, so annotate with just the surface these
 * tests read.
 */
type SpyLike = {
  mock: { calls: Array<Array<unknown>> };
  mockRestore: () => void;
};

function metricRow(name: string, attributes?: JSONObject): JSONObject {
  const attrs: JSONObject = attributes ?? { region: "eu", zone: "a" };
  return {
    name: name,
    attributes: attrs,
    attributeKeys: Object.keys(attrs).sort(),
  };
}

beforeEach(() => {
  MetricPipelineRuleService.clearCache();
  jest.restoreAllMocks();
});

describe("regex filters match correctly", () => {
  test("MatchesRegex drops matching rows and keeps the rest", () => {
    const rules: MetricRulesForProject = projectRules(
      regexRule({
        conditionType: MetricPipelineRuleFilterConditionType.MatchesRegex,
        pattern: "^node_.*_seconds$",
      }),
    );

    expect(
      MetricPipelineRuleService.applyRules(
        metricRow("node_cpu_seconds"),
        undefined,
        rules,
      ),
    ).toBeNull();
    expect(
      MetricPipelineRuleService.applyRules(
        metricRow("http_requests_total"),
        undefined,
        rules,
      ),
    ).not.toBeNull();
  });

  test("DoesNotMatchRegex inverts the match", () => {
    const rules: MetricRulesForProject = projectRules(
      regexRule({
        conditionType: MetricPipelineRuleFilterConditionType.DoesNotMatchRegex,
        pattern: "^keep_",
      }),
    );

    expect(
      MetricPipelineRuleService.applyRules(
        metricRow("keep_this"),
        undefined,
        rules,
      ),
    ).not.toBeNull();
    expect(
      MetricPipelineRuleService.applyRules(
        metricRow("drop_this"),
        undefined,
        rules,
      ),
    ).toBeNull();
  });
});

describe("regex compilation is memoized per pattern", () => {
  test("RegExp is constructed once for N rows, not once per row", () => {
    const pattern: string = "^memoized_pattern_[0-9]+$";
    const rules: MetricRulesForProject = projectRules(
      regexRule({
        conditionType: MetricPipelineRuleFilterConditionType.MatchesRegex,
        pattern: pattern,
      }),
    );

    const regExpSpy: SpyLike = jest.spyOn(
      globalThis,
      "RegExp",
    ) as unknown as SpyLike;

    for (let i: number = 0; i < 200; i++) {
      MetricPipelineRuleService.applyRules(
        metricRow(`memoized_pattern_${i}`),
        undefined,
        rules,
      );
    }

    const constructionsOfPattern: number = regExpSpy.mock.calls.filter(
      (call: Array<unknown>) => {
        return call[0] === pattern;
      },
    ).length;

    expect(constructionsOfPattern).toBe(1);
  });

  test("an invalid pattern warns exactly once, not per row", () => {
    const rules: MetricRulesForProject = projectRules(
      regexRule({
        conditionType: MetricPipelineRuleFilterConditionType.MatchesRegex,
        pattern: "([unclosed",
      }),
    );

    const warnSpy: SpyLike = jest
      .spyOn(logger, "warn")
      .mockImplementation(() => {
        return undefined;
      }) as unknown as SpyLike;

    for (let i: number = 0; i < 100; i++) {
      MetricPipelineRuleService.applyRules(
        metricRow(`metric_${i}`),
        undefined,
        rules,
      );
    }

    const invalidRegexWarnings: number = warnSpy.mock.calls.filter(
      (call: Array<unknown>) => {
        return String(call[0]).includes("Invalid regex");
      },
    ).length;
    expect(invalidRegexWarnings).toBe(1);
  });

  test("an invalid pattern never matches (Drop rule keeps every row)", () => {
    const rules: MetricRulesForProject = projectRules(
      regexRule({
        conditionType: MetricPipelineRuleFilterConditionType.MatchesRegex,
        pattern: "([unclosed",
      }),
    );
    jest.spyOn(logger, "warn").mockImplementation(() => {
      return undefined;
    });

    expect(
      MetricPipelineRuleService.applyRules(
        metricRow("anything"),
        undefined,
        rules,
      ),
    ).not.toBeNull();
  });

  test("clearCache resets the memo so a fixed pattern recompiles", () => {
    const pattern: string = "^after_clear$";
    const rules: MetricRulesForProject = projectRules(
      regexRule({
        conditionType: MetricPipelineRuleFilterConditionType.MatchesRegex,
        pattern: pattern,
      }),
    );

    MetricPipelineRuleService.applyRules(
      metricRow("after_clear"),
      undefined,
      rules,
    );
    MetricPipelineRuleService.clearCache();

    const regExpSpy: SpyLike = jest.spyOn(
      globalThis,
      "RegExp",
    ) as unknown as SpyLike;
    MetricPipelineRuleService.applyRules(
      metricRow("after_clear"),
      undefined,
      rules,
    );

    const constructionsOfPattern: number = regExpSpy.mock.calls.filter(
      (call: Array<unknown>) => {
        return call[0] === pattern;
      },
    ).length;
    expect(constructionsOfPattern).toBe(1);
  });
});

describe("attributeKeys stays correct with the deferred single re-sort", () => {
  test("AddAttribute updates attributeKeys, sorted", () => {
    const rules: MetricRulesForProject = projectRules(
      attributeRule({
        ruleType: MetricPipelineRuleType.AddAttribute,
        addAttributeKey: "aaa_first",
        addAttributeValue: "v",
      }),
    );

    const result: JSONObject | null = MetricPipelineRuleService.applyRules(
      metricRow("m", { region: "eu", zone: "a" }),
      undefined,
      rules,
    );

    expect(result).not.toBeNull();
    expect(result!["attributeKeys"]).toEqual(["aaa_first", "region", "zone"]);
  });

  test("RemoveAttribute updates attributeKeys", () => {
    const rules: MetricRulesForProject = projectRules(
      attributeRule({
        ruleType: MetricPipelineRuleType.RemoveAttribute,
        addAttributeKey: "zone",
      }),
    );

    const result: JSONObject | null = MetricPipelineRuleService.applyRules(
      metricRow("m", { region: "eu", zone: "a" }),
      undefined,
      rules,
    );

    expect(result!["attributeKeys"]).toEqual(["region"]);
  });

  test("RenameAttribute updates attributeKeys", () => {
    const rules: MetricRulesForProject = projectRules(
      attributeRule({
        ruleType: MetricPipelineRuleType.RenameAttribute,
        renameFromKey: "zone",
        renameToKey: "availability_zone",
      }),
    );

    const result: JSONObject | null = MetricPipelineRuleService.applyRules(
      metricRow("m", { region: "eu", zone: "a" }),
      undefined,
      rules,
    );

    expect(result!["attributeKeys"]).toEqual(["availability_zone", "region"]);
    expect((result!["attributes"] as JSONObject)["availability_zone"]).toBe(
      "a",
    );
    expect((result!["attributes"] as JSONObject)["zone"]).toBeUndefined();
  });

  test("a chain of mutating rules yields the final combined key set", () => {
    const rules: MetricRulesForProject = projectRules(
      attributeRule({
        ruleType: MetricPipelineRuleType.AddAttribute,
        addAttributeKey: "env",
        addAttributeValue: "prod",
      }),
      attributeRule({
        ruleType: MetricPipelineRuleType.RenameAttribute,
        renameFromKey: "region",
        renameToKey: "cloud_region",
      }),
      attributeRule({
        ruleType: MetricPipelineRuleType.RemoveAttribute,
        addAttributeKey: "zone",
      }),
    );

    const result: JSONObject | null = MetricPipelineRuleService.applyRules(
      metricRow("m", { region: "eu", zone: "a" }),
      undefined,
      rules,
    );

    expect(result!["attributeKeys"]).toEqual(["cloud_region", "env"]);
    expect(Object.keys(result!["attributes"] as JSONObject).sort()).toEqual([
      "cloud_region",
      "env",
    ]);
  });

  test("a chain of mutating rules re-sorts attributeKeys exactly once", () => {
    const rules: MetricRulesForProject = projectRules(
      attributeRule({
        ruleType: MetricPipelineRuleType.AddAttribute,
        addAttributeKey: "env",
        addAttributeValue: "prod",
      }),
      attributeRule({
        ruleType: MetricPipelineRuleType.RenameAttribute,
        renameFromKey: "region",
        renameToKey: "cloud_region",
      }),
      attributeRule({
        ruleType: MetricPipelineRuleType.RemoveAttribute,
        addAttributeKey: "zone",
      }),
    );

    // Build the row before installing the spy — metricRow sorts once itself.
    const row: JSONObject = metricRow("m", { region: "eu", zone: "a" });

    const sortSpy: SpyLike = jest.spyOn(
      Array.prototype,
      "sort",
    ) as unknown as SpyLike;

    let result: JSONObject | null = null;
    let sortCallCount: number = -1;
    try {
      result = MetricPipelineRuleService.applyRules(row, undefined, rules);
      // Read before mockRestore — restoring resets the recorded calls.
      sortCallCount = sortSpy.mock.calls.length;
    } finally {
      sortSpy.mockRestore();
    }

    /*
     * Mutation guard for the deferred rebuild: three mutating rules used to
     * mean three full key re-sorts per row; the dirty-flag design runs
     * exactly one, after the last rule.
     */
    expect(sortCallCount).toBe(1);
    expect(result!["attributeKeys"]).toEqual(["cloud_region", "env"]);
  });

  test("attributeKeys is untouched when no rule mutates attributes", () => {
    const row: JSONObject = metricRow("m", { region: "eu" });
    const originalKeys: unknown = row["attributeKeys"];

    const rules: MetricRulesForProject = projectRules(
      attributeRule({
        ruleType: MetricPipelineRuleType.RenameMetric,
        renameToKey: "renamed_metric",
      }),
    );

    const result: JSONObject | null = MetricPipelineRuleService.applyRules(
      row,
      undefined,
      rules,
    );

    expect(result!["name"]).toBe("renamed_metric");
    // Same array instance: no pointless rebuild for non-attribute rules.
    expect(result!["attributeKeys"]).toBe(originalKeys);
  });

  test("RedactAttribute changes the value but not the key set", () => {
    const rules: MetricRulesForProject = projectRules(
      attributeRule({
        ruleType: MetricPipelineRuleType.RedactAttribute,
        addAttributeKey: "region",
      }),
    );

    const row: JSONObject = metricRow("m", { region: "eu" });
    const originalKeys: unknown = row["attributeKeys"];

    const result: JSONObject | null = MetricPipelineRuleService.applyRules(
      row,
      undefined,
      rules,
    );

    expect((result!["attributes"] as JSONObject)["region"]).toBe("[REDACTED]");
    expect(result!["attributeKeys"]).toBe(originalKeys);
  });

  test("AddAttribute and RenameAttribute write a key named __proto__ as an attribute", () => {
    const added: JSONObject | null = MetricPipelineRuleService.applyRules(
      metricRow("m", { region: "eu" }),
      undefined,
      projectRules(
        attributeRule({
          ruleType: MetricPipelineRuleType.AddAttribute,
          addAttributeKey: "__proto__",
          addAttributeValue: "v",
        }),
      ),
    );

    expect(JSON.stringify(added!["attributes"])).toBe(
      '{"region":"eu","__proto__":"v"}',
    );
    expect(added!["attributeKeys"]).toEqual(["__proto__", "region"]);

    const renamed: JSONObject | null = MetricPipelineRuleService.applyRules(
      metricRow("m", { region: "eu", zone: "a" }),
      undefined,
      projectRules(
        attributeRule({
          ruleType: MetricPipelineRuleType.RenameAttribute,
          renameFromKey: "zone",
          renameToKey: "__proto__",
        }),
      ),
    );

    expect(JSON.stringify(renamed!["attributes"])).toBe(
      '{"region":"eu","__proto__":"a"}',
    );
    expect(renamed!["attributeKeys"]).toEqual(["__proto__", "region"]);
  });
});

/*
 * Every name an object inherits - Object.prototype's own: constructor,
 * toString, valueOf, __proto__ and the rest - as the key a metric rule
 * names. A row without that attribute has nothing to rename, remove or
 * redact and matches no filter that needs it; a row with it (a computed
 * key, so its own, __proto__ too: the rules change the attributes in
 * place) has it read, renamed, removed and redacted like any other; and a
 * key written so is the row's own, in attributes and attributeKeys.
 */
describe.each(INHERITED_PROPERTY_NAMES)(
  "metric rules and an attribute named %s",
  (name: string) => {
    const apply: (
      attributes: JSONObject,
      rule: MetricPipelineRule,
    ) => JSONObject | null = (
      attributes: JSONObject,
      rule: MetricPipelineRule,
    ): JSONObject | null => {
      return MetricPipelineRuleService.applyRules(
        metricRow("m", attributes),
        undefined,
        projectRules(rule),
      );
    };

    const sortedKeys: (...keys: Array<string>) => Array<string> = (
      ...keys: Array<string>
    ): Array<string> => {
      return [...keys].sort();
    };

    const dropWhen: (
      conditionType: MetricPipelineRuleFilterConditionType,
      value?: string,
    ) => MetricPipelineRule = (
      conditionType: MetricPipelineRuleFilterConditionType,
      value?: string,
    ): MetricPipelineRule => {
      const rule: MetricPipelineRule = new MetricPipelineRule();
      rule.id = ObjectID.generate();
      rule.ruleType = MetricPipelineRuleType.Drop;
      rule.filters = [
        {
          checkOn: MetricPipelineRuleFilterCheckOn.Attribute,
          attributeKey: name,
          conditionType,
          value,
        },
      ];
      return rule;
    };

    test("AddAttribute and RenameAttribute write it as the row's own key", () => {
      const added: JSONObject | null = apply(
        { region: "eu" },
        attributeRule({
          ruleType: MetricPipelineRuleType.AddAttribute,
          addAttributeKey: name,
          addAttributeValue: "v",
        }),
      );

      expect(JSON.stringify(added!["attributes"])).toBe(
        `{"region":"eu","${name}":"v"}`,
      );
      expect(added!["attributeKeys"]).toEqual(sortedKeys(name, "region"));
      expect(Object.getPrototypeOf(added!["attributes"])).toBe(
        Object.prototype,
      );

      const renamed: JSONObject | null = apply(
        { region: "eu", zone: "a" },
        attributeRule({
          ruleType: MetricPipelineRuleType.RenameAttribute,
          renameFromKey: "zone",
          renameToKey: name,
        }),
      );

      expect(JSON.stringify(renamed!["attributes"])).toBe(
        `{"region":"eu","${name}":"a"}`,
      );
      expect(renamed!["attributeKeys"]).toEqual(sortedKeys(name, "region"));
    });

    test("RenameAttribute, RemoveAttribute and RedactAttribute leave a row without it as it is", () => {
      for (const rule of [
        attributeRule({
          ruleType: MetricPipelineRuleType.RenameAttribute,
          renameFromKey: name,
          renameToKey: "renamed",
        }),
        attributeRule({
          ruleType: MetricPipelineRuleType.RemoveAttribute,
          addAttributeKey: name,
        }),
        attributeRule({
          ruleType: MetricPipelineRuleType.RedactAttribute,
          addAttributeKey: name,
        }),
      ]) {
        const result: JSONObject | null = apply({ region: "eu" }, rule);

        expect({ rule: rule.ruleType, result }).toEqual({
          rule: rule.ruleType,
          result: metricRow("m", { region: "eu" }),
        });
        expect(
          Object.prototype.hasOwnProperty.call(result!["attributes"], name),
        ).toBe(false);
      }
    });

    test("RenameAttribute, RemoveAttribute and RedactAttribute change a row's own attribute", () => {
      const renamed: JSONObject | null = apply(
        { region: "eu", [name]: "a" },
        attributeRule({
          ruleType: MetricPipelineRuleType.RenameAttribute,
          renameFromKey: name,
          renameToKey: "renamed",
        }),
      );

      expect(renamed!["attributes"]).toEqual({ region: "eu", renamed: "a" });
      expect(renamed!["attributeKeys"]).toEqual(["region", "renamed"]);

      const removed: JSONObject | null = apply(
        { region: "eu", [name]: "a" },
        attributeRule({
          ruleType: MetricPipelineRuleType.RemoveAttribute,
          addAttributeKey: name,
        }),
      );

      expect(removed!["attributes"]).toEqual({ region: "eu" });
      expect(removed!["attributeKeys"]).toEqual(["region"]);

      const redacted: JSONObject | null = apply(
        { region: "eu", [name]: "secret" },
        attributeRule({
          ruleType: MetricPipelineRuleType.RedactAttribute,
          addAttributeKey: name,
        }),
      );

      expect(JSON.stringify(redacted!["attributes"])).toBe(
        `{"region":"eu","${name}":"[REDACTED]"}`,
      );
    });

    test("an attribute filter on it reads only the row's own attribute", () => {
      const inheritedText: string = String(
        (Object.create(Object.prototype) as Record<string, unknown>)[name],
      );

      for (const [conditionType, value, dropsWithout, dropsWith] of [
        [
          MetricPipelineRuleFilterConditionType.IsPresent,
          undefined,
          false,
          true,
        ],
        [
          MetricPipelineRuleFilterConditionType.IsNotPresent,
          undefined,
          true,
          false,
        ],
        [MetricPipelineRuleFilterConditionType.IsEmpty, undefined, true, false],
        [
          MetricPipelineRuleFilterConditionType.IsNotEmpty,
          undefined,
          false,
          true,
        ],
        [MetricPipelineRuleFilterConditionType.EqualTo, "a", false, true],
        [
          MetricPipelineRuleFilterConditionType.EqualTo,
          inheritedText,
          false,
          false,
        ],
        [
          MetricPipelineRuleFilterConditionType.Contains,
          "native",
          false,
          false,
        ],
        [MetricPipelineRuleFilterConditionType.NotEqualTo, "a", false, false],
      ] as Array<
        [
          MetricPipelineRuleFilterConditionType,
          string | undefined,
          boolean,
          boolean,
        ]
      >) {
        const rule: MetricPipelineRule = dropWhen(conditionType, value);

        expect({
          conditionType,
          value,
          dropsWithout: apply({ region: "eu" }, rule) === null,
          dropsWith: apply({ region: "eu", [name]: "a" }, rule) === null,
        }).toEqual({ conditionType, value, dropsWithout, dropsWith });
      }
    });
  },
);
