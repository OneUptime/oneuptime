/*
 * These tests exercise applyRules/clearCache only — loadRules (the one
 * Postgres touchpoint) is never called, so stub the DatabaseService module
 * out before it drags the whole server-side service graph into the ts-jest
 * compile.
 */
jest.mock("Common/Server/Services/DatabaseService", () => {
  return {
    __esModule: true,
    default: class DatabaseServiceStub {},
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
});
