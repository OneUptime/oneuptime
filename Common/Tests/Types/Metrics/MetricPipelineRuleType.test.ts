import MetricPipelineRuleType from "../../../Types/Metrics/MetricPipelineRuleType";
import { describe, expect, test } from "@jest/globals";

/*
 * MetricPipelineRuleType is a string-backed enum whose values are persisted
 * (MetricPipelineRule.ruleType) and used as the dispatch key in the metric
 * ingest pipeline. The string values are therefore load-bearing: renaming a
 * value silently breaks every already-stored rule. These tests pin the value
 * contract, the completeness of the member set, and the documented per-value
 * behaviour via a small pure dispatcher that mirrors the ingest semantics.
 */

/* The exact, order-independent set the enum is expected to expose. */
const EXPECTED_VALUES: Record<string, string> = {
  Filter: "Filter",
  Drop: "Drop",
  RenameMetric: "RenameMetric",
  RenameAttribute: "RenameAttribute",
  AddAttribute: "AddAttribute",
  RemoveAttribute: "RemoveAttribute",
  RedactAttribute: "RedactAttribute",
  Sample: "Sample",
};

describe("MetricPipelineRuleType", () => {
  describe("value contract", () => {
    test("each member serializes to its exact documented string", () => {
      expect(MetricPipelineRuleType.Filter).toBe("Filter");
      expect(MetricPipelineRuleType.Drop).toBe("Drop");
      expect(MetricPipelineRuleType.RenameMetric).toBe("RenameMetric");
      expect(MetricPipelineRuleType.RenameAttribute).toBe("RenameAttribute");
      expect(MetricPipelineRuleType.AddAttribute).toBe("AddAttribute");
      expect(MetricPipelineRuleType.RemoveAttribute).toBe("RemoveAttribute");
      expect(MetricPipelineRuleType.RedactAttribute).toBe("RedactAttribute");
      expect(MetricPipelineRuleType.Sample).toBe("Sample");
    });

    test("every member is a non-empty string (safe as a DB column value)", () => {
      const values: Array<MetricPipelineRuleType> = Object.values(
        MetricPipelineRuleType,
      );
      for (const value of values) {
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
        /* No stray whitespace that would corrupt an equality-based lookup. */
        expect(value).toBe(value.trim());
      }
    });
  });

  describe("member set completeness", () => {
    test("exposes exactly the expected members, no more and no fewer", () => {
      /*
       * A string enum has no reverse (numeric) mapping, so Object.values and
       * Object.keys each yield precisely the declared members.
       */
      expect([...Object.values(MetricPipelineRuleType)].sort()).toEqual(
        [...Object.values(EXPECTED_VALUES)].sort(),
      );
      expect([...Object.keys(MetricPipelineRuleType)].sort()).toEqual(
        [...Object.keys(EXPECTED_VALUES)].sort(),
      );
    });

    test("has the documented cardinality of eight rule types", () => {
      expect(Object.values(MetricPipelineRuleType)).toHaveLength(8);
    });

    test("the key equals the value for every member", () => {
      const entries: Array<[string, string]> = Object.entries(
        MetricPipelineRuleType,
      );
      for (const [key, value] of entries) {
        expect(key).toBe(value);
      }
    });

    test("all values are unique (no aliasing to the same string)", () => {
      const values: Array<MetricPipelineRuleType> = Object.values(
        MetricPipelineRuleType,
      );
      expect(new Set(values).size).toBe(values.length);
    });
  });

  describe("persistence round-trip", () => {
    test("a member survives JSON serialize/parse unchanged", () => {
      const original: MetricPipelineRuleType =
        MetricPipelineRuleType.RedactAttribute;
      const restored: MetricPipelineRuleType = JSON.parse(
        JSON.stringify(original),
      ) as MetricPipelineRuleType;

      expect(restored).toBe(original);
      expect(restored).toBe(MetricPipelineRuleType.RedactAttribute);
    });

    test("a persisted string casts back to the matching enum member", () => {
      /* Simulates reading rule.ruleType back out of the database as a string. */
      for (const value of Object.values(MetricPipelineRuleType)) {
        const persisted: string = value as string;
        const rehydrated: MetricPipelineRuleType =
          persisted as MetricPipelineRuleType;
        expect(rehydrated).toBe(value);
      }
    });

    test("an unrelated string does not collide with any member", () => {
      const values: Array<string> = Object.values(MetricPipelineRuleType);
      expect(values).not.toContain("filter");
      expect(values).not.toContain("SampleRate");
      expect(values).not.toContain("");
      expect(values).not.toContain("Unknown");
    });
  });

  describe("exhaustive Record keying (UI metadata / switch maps)", () => {
    test("supports a total Record keyed by every member", () => {
      /*
       * The dashboard builds a metadata map keyed by MetricPipelineRuleType.
       * A total Record must resolve for every member and only for members.
       */
      const labels: Record<MetricPipelineRuleType, string> = {
        [MetricPipelineRuleType.Filter]: "Filter",
        [MetricPipelineRuleType.Drop]: "Drop",
        [MetricPipelineRuleType.RenameMetric]: "Rename metric",
        [MetricPipelineRuleType.RenameAttribute]: "Rename attribute",
        [MetricPipelineRuleType.AddAttribute]: "Add attribute",
        [MetricPipelineRuleType.RemoveAttribute]: "Remove attribute",
        [MetricPipelineRuleType.RedactAttribute]: "Redact attribute",
        [MetricPipelineRuleType.Sample]: "Sample",
      };

      for (const value of Object.values(MetricPipelineRuleType)) {
        expect(labels[value]).toBeDefined();
        expect(labels[value].length).toBeGreaterThan(0);
      }
      expect(Object.keys(labels)).toHaveLength(
        Object.values(MetricPipelineRuleType).length,
      );
    });
  });
});

/*
 * Pure dispatcher mirroring OtelMetricsIngestService.applyRule() branch
 * structure, keyed entirely on MetricPipelineRuleType. It exercises each enum
 * value, the Filter allowlist precedence, the non-matching short-circuit, and
 * the default (unknown value) path. Kept deterministic: Sample is decided by a
 * caller-supplied roll instead of Math.random so there is no wall-clock or RNG
 * dependency.
 */

interface FakeRow {
  name: string;
  attributes: Record<string, string>;
}

interface ApplyOptions {
  matched: boolean;
  renameMetricTo?: string;
  renameFromKey?: string;
  renameToKey?: string;
  attributeKey?: string;
  attributeValue?: string;
  redactReplacement?: string;
  samplePercentage?: number;
  /* Deterministic stand-in for Math.random() * 100, in the range [0, 100). */
  sampleRoll?: number;
}

interface ApplyResult {
  row: FakeRow | null;
  hitDefault: boolean;
}

function applyRule(
  ruleType: MetricPipelineRuleType,
  row: FakeRow,
  options: ApplyOptions,
): ApplyResult {
  const matched: boolean = options.matched;

  /* Filter is an allowlist and is decided before the non-matching gate. */
  if (ruleType === MetricPipelineRuleType.Filter) {
    return { row: matched ? row : null, hitDefault: false };
  }

  /* All other rule types are no-ops for rows they do not match. */
  if (!matched) {
    return { row, hitDefault: false };
  }

  switch (ruleType) {
    case MetricPipelineRuleType.Drop:
      return { row: null, hitDefault: false };

    case MetricPipelineRuleType.Sample: {
      const pct: number =
        typeof options.samplePercentage === "number"
          ? options.samplePercentage
          : 100;
      const roll: number =
        typeof options.sampleRoll === "number" ? options.sampleRoll : 0;
      return { row: roll >= pct ? null : row, hitDefault: false };
    }

    case MetricPipelineRuleType.RenameMetric: {
      if (options.renameMetricTo) {
        row.name = options.renameMetricTo;
      }
      return { row, hitDefault: false };
    }

    case MetricPipelineRuleType.RenameAttribute: {
      const from: string | undefined = options.renameFromKey || undefined;
      const to: string | undefined = options.renameToKey || undefined;
      if (
        from &&
        to &&
        Object.prototype.hasOwnProperty.call(row.attributes, from)
      ) {
        row.attributes[to] = row.attributes[from] as string;
        delete row.attributes[from];
      }
      return { row, hitDefault: false };
    }

    case MetricPipelineRuleType.AddAttribute: {
      const key: string | undefined = options.attributeKey || undefined;
      if (key) {
        row.attributes[key] = options.attributeValue ?? "";
      }
      return { row, hitDefault: false };
    }

    case MetricPipelineRuleType.RemoveAttribute: {
      const key: string | undefined = options.attributeKey || undefined;
      if (key && Object.prototype.hasOwnProperty.call(row.attributes, key)) {
        delete row.attributes[key];
      }
      return { row, hitDefault: false };
    }

    case MetricPipelineRuleType.RedactAttribute: {
      const key: string | undefined = options.attributeKey || undefined;
      if (key && Object.prototype.hasOwnProperty.call(row.attributes, key)) {
        row.attributes[key] = options.redactReplacement || "[REDACTED]";
      }
      return { row, hitDefault: false };
    }

    default:
      /* An unknown / future value keeps the row untouched, like the service. */
      return { row, hitDefault: true };
  }
}

function makeRow(): FakeRow {
  return {
    name: "http_requests_total",
    attributes: { host: "a", env: "prod" },
  };
}

describe("MetricPipelineRuleType dispatch semantics", () => {
  describe("Filter (allowlist precedence)", () => {
    test("keeps a matching row", () => {
      const result: ApplyResult = applyRule(
        MetricPipelineRuleType.Filter,
        makeRow(),
        { matched: true },
      );
      expect(result.row).not.toBeNull();
    });

    test("drops a non-matching row (opposite of every other type)", () => {
      const result: ApplyResult = applyRule(
        MetricPipelineRuleType.Filter,
        makeRow(),
        { matched: false },
      );
      expect(result.row).toBeNull();
    });
  });

  describe("non-matching short-circuit for non-Filter types", () => {
    test.each([
      MetricPipelineRuleType.Drop,
      MetricPipelineRuleType.RenameMetric,
      MetricPipelineRuleType.RenameAttribute,
      MetricPipelineRuleType.AddAttribute,
      MetricPipelineRuleType.RemoveAttribute,
      MetricPipelineRuleType.RedactAttribute,
      MetricPipelineRuleType.Sample,
    ])(
      "%s leaves a non-matching row untouched",
      (ruleType: MetricPipelineRuleType) => {
        const row: FakeRow = makeRow();
        const result: ApplyResult = applyRule(ruleType, row, {
          matched: false,
        });

        expect(result.row).toBe(row);
        expect(result.hitDefault).toBe(false);
        /* Unchanged: name and attributes exactly as seeded. */
        expect(row.name).toBe("http_requests_total");
        expect(row.attributes).toEqual({ host: "a", env: "prod" });
      },
    );
  });

  describe("Drop", () => {
    test("drops a matching row", () => {
      const result: ApplyResult = applyRule(
        MetricPipelineRuleType.Drop,
        makeRow(),
        { matched: true },
      );
      expect(result.row).toBeNull();
    });
  });

  describe("Sample (deterministic boundary behaviour)", () => {
    test("a roll below the percentage keeps the row", () => {
      const result: ApplyResult = applyRule(
        MetricPipelineRuleType.Sample,
        makeRow(),
        { matched: true, samplePercentage: 50, sampleRoll: 49.9 },
      );
      expect(result.row).not.toBeNull();
    });

    test("a roll equal to the percentage drops the row (boundary is exclusive)", () => {
      const result: ApplyResult = applyRule(
        MetricPipelineRuleType.Sample,
        makeRow(),
        { matched: true, samplePercentage: 50, sampleRoll: 50 },
      );
      expect(result.row).toBeNull();
    });

    test("0% drops every matching row", () => {
      const result: ApplyResult = applyRule(
        MetricPipelineRuleType.Sample,
        makeRow(),
        { matched: true, samplePercentage: 0, sampleRoll: 0 },
      );
      expect(result.row).toBeNull();
    });

    test("an absent percentage defaults to keeping the row (100%)", () => {
      const result: ApplyResult = applyRule(
        MetricPipelineRuleType.Sample,
        makeRow(),
        { matched: true, sampleRoll: 99.999 },
      );
      expect(result.row).not.toBeNull();
    });
  });

  describe("RenameMetric", () => {
    test("renames a matching row's metric name", () => {
      const row: FakeRow = makeRow();
      applyRule(MetricPipelineRuleType.RenameMetric, row, {
        matched: true,
        renameMetricTo: "requests_total",
      });
      expect(row.name).toBe("requests_total");
    });

    test("leaves the name intact when no target is provided", () => {
      const row: FakeRow = makeRow();
      applyRule(MetricPipelineRuleType.RenameMetric, row, { matched: true });
      expect(row.name).toBe("http_requests_total");
    });
  });

  describe("RenameAttribute", () => {
    test("moves the value from the old key to the new key", () => {
      const row: FakeRow = makeRow();
      applyRule(MetricPipelineRuleType.RenameAttribute, row, {
        matched: true,
        renameFromKey: "host",
        renameToKey: "hostname",
      });
      expect(row.attributes).toEqual({ hostname: "a", env: "prod" });
    });

    test("is a no-op when the source key is absent", () => {
      const row: FakeRow = makeRow();
      applyRule(MetricPipelineRuleType.RenameAttribute, row, {
        matched: true,
        renameFromKey: "missing",
        renameToKey: "hostname",
      });
      expect(row.attributes).toEqual({ host: "a", env: "prod" });
    });

    test("is a no-op when either key is empty", () => {
      const row: FakeRow = makeRow();
      applyRule(MetricPipelineRuleType.RenameAttribute, row, {
        matched: true,
        renameFromKey: "host",
        renameToKey: "",
      });
      expect(row.attributes).toEqual({ host: "a", env: "prod" });
    });
  });

  describe("AddAttribute", () => {
    test("adds a new attribute with its value", () => {
      const row: FakeRow = makeRow();
      applyRule(MetricPipelineRuleType.AddAttribute, row, {
        matched: true,
        attributeKey: "region",
        attributeValue: "us-east-1",
      });
      expect(row.attributes["region"]).toBe("us-east-1");
    });

    test("adds an empty-string value when none is supplied", () => {
      const row: FakeRow = makeRow();
      applyRule(MetricPipelineRuleType.AddAttribute, row, {
        matched: true,
        attributeKey: "region",
      });
      expect(row.attributes["region"]).toBe("");
    });

    test("is a no-op when the key is empty", () => {
      const row: FakeRow = makeRow();
      applyRule(MetricPipelineRuleType.AddAttribute, row, {
        matched: true,
        attributeKey: "",
        attributeValue: "x",
      });
      expect(row.attributes).toEqual({ host: "a", env: "prod" });
    });
  });

  describe("RemoveAttribute", () => {
    test("removes an existing attribute", () => {
      const row: FakeRow = makeRow();
      applyRule(MetricPipelineRuleType.RemoveAttribute, row, {
        matched: true,
        attributeKey: "env",
      });
      expect(row.attributes).toEqual({ host: "a" });
    });

    test("is a no-op when the attribute does not exist", () => {
      const row: FakeRow = makeRow();
      applyRule(MetricPipelineRuleType.RemoveAttribute, row, {
        matched: true,
        attributeKey: "missing",
      });
      expect(row.attributes).toEqual({ host: "a", env: "prod" });
    });
  });

  describe("RedactAttribute", () => {
    test("replaces an existing attribute value with the replacement", () => {
      const row: FakeRow = makeRow();
      applyRule(MetricPipelineRuleType.RedactAttribute, row, {
        matched: true,
        attributeKey: "host",
        redactReplacement: "***",
      });
      expect(row.attributes["host"]).toBe("***");
    });

    test("uses the [REDACTED] default when no replacement is provided", () => {
      const row: FakeRow = makeRow();
      applyRule(MetricPipelineRuleType.RedactAttribute, row, {
        matched: true,
        attributeKey: "host",
      });
      expect(row.attributes["host"]).toBe("[REDACTED]");
    });

    test("is a no-op when the attribute does not exist", () => {
      const row: FakeRow = makeRow();
      applyRule(MetricPipelineRuleType.RedactAttribute, row, {
        matched: true,
        attributeKey: "missing",
      });
      expect(row.attributes).toEqual({ host: "a", env: "prod" });
    });
  });

  describe("unknown / future rule value (default branch)", () => {
    test("keeps the row and flags the default path for an unrecognised value", () => {
      const row: FakeRow = makeRow();
      const result: ApplyResult = applyRule(
        "SomeFutureType" as MetricPipelineRuleType,
        row,
        { matched: true },
      );

      expect(result.hitDefault).toBe(true);
      expect(result.row).toBe(row);
      expect(row.attributes).toEqual({ host: "a", env: "prod" });
    });

    test("every real enum value avoids the default branch", () => {
      for (const ruleType of Object.values(MetricPipelineRuleType)) {
        const result: ApplyResult = applyRule(ruleType, makeRow(), {
          matched: true,
          samplePercentage: 100,
          sampleRoll: 0,
        });
        expect(result.hitDefault).toBe(false);
      }
    });
  });
});
