/*
 * These tests exercise pure attribute-key helpers only — nothing here
 * touches Postgres. Stub the DatabaseService base class out before
 * TelemetryUtil's import graph (MetricTypeService -> DatabaseService ->
 * PasswordHash, which has a known TS5.9 compile failure under ts-jest)
 * drags the whole server-side service layer into the suite. Mirrors
 * App/Tests/Telemetry/MetricRowIngestionStamp.test.ts.
 */
jest.mock("../../../../Server/Services/DatabaseService", () => {
  return {
    __esModule: true,
    default: class DatabaseServiceStub {},
  };
});

import TelemetryUtil, {
  AttributeType,
} from "../../../../Server/Utils/Telemetry/Telemetry";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * The two helpers the OTel ingest hot-path restructure leans on:
 *
 *   1. mergeAttributeKeysWithSortedBase — the per-datapoint replacement for
 *      `Object.keys(mergedAttributes).sort()`. Its whole contract is ORDER
 *      IDENTITY with the full sort: metric rows store attributeKeys sorted,
 *      and the pipeline rule engine re-sorts after attribute mutations, so
 *      any divergence between "merge of two sorted lists" and "sort of the
 *      union" would make rule-touched and untouched rows disagree. Every
 *      test here therefore asserts against the reference derivation
 *      (`Object.keys(Object.assign({}, base, extra)).sort()`), not against
 *      hand-written expectations that could encode the same mistake twice.
 *
 *   2. getPrefixedScopeAttributes — the once-per-scope replacement for the
 *      per-record `scope.` prefix loop the three ingest services carried.
 */

type MergeInput = {
  sortedBaseAttributeKeys: Array<string>;
  additionalAttributeKeys: Array<string>;
};

function referenceSortedUnion(
  baseKeys: Array<string>,
  additionalKeys: Array<string>,
): Array<string> {
  const union: Record<string, boolean> = {};
  for (const key of baseKeys) {
    union[key] = true;
  }
  for (const key of additionalKeys) {
    union[key] = true;
  }
  return Object.keys(union).sort();
}

function merge(data: MergeInput): Array<string> {
  return TelemetryUtil.mergeAttributeKeysWithSortedBase(data);
}

describe("TelemetryUtil.mergeAttributeKeysWithSortedBase", () => {
  test("empty additional keys returns the base list content unchanged", () => {
    const base: Array<string> = ["a", "b", "c"];

    expect(
      merge({ sortedBaseAttributeKeys: base, additionalAttributeKeys: [] }),
    ).toEqual(["a", "b", "c"]);
  });

  test("empty additional keys returns a FRESH array, never the base reference", () => {
    /*
     * Rows must not share an attributeKeys array: pipeline rules replace a
     * row's key list independently of its siblings, and the base list is
     * reused for every datapoint of a metric.
     */
    const base: Array<string> = ["a", "b"];
    const merged: Array<string> = merge({
      sortedBaseAttributeKeys: base,
      additionalAttributeKeys: [],
    });

    expect(merged).not.toBe(base);
    merged.push("mutated");
    expect(base).toEqual(["a", "b"]);
  });

  test("does not mutate either input list", () => {
    const base: Array<string> = ["a", "m", "z"];
    const additional: Array<string> = ["c", "b"];

    merge({
      sortedBaseAttributeKeys: base,
      additionalAttributeKeys: additional,
    });

    expect(base).toEqual(["a", "m", "z"]);
    // In particular the internal sort must run on a copy.
    expect(additional).toEqual(["c", "b"]);
  });

  test("interleaved keys merge into the exact full-sort order", () => {
    const base: Array<string> = ["alpha", "gamma", "omega"];
    const additional: Array<string> = ["zeta", "beta", "delta"];

    expect(
      merge({
        sortedBaseAttributeKeys: base,
        additionalAttributeKeys: additional,
      }),
    ).toEqual(referenceSortedUnion(base, additional));
  });

  test("a per-row key overriding a base key appears exactly once", () => {
    const base: Array<string> = ["resource.service.name", "shared.key"];
    const additional: Array<string> = ["shared.key", "datapoint.only"];

    const merged: Array<string> = merge({
      sortedBaseAttributeKeys: base,
      additionalAttributeKeys: additional,
    });

    expect(merged).toEqual(referenceSortedUnion(base, additional));
    expect(
      merged.filter((key: string) => {
        return key === "shared.key";
      }),
    ).toHaveLength(1);
  });

  test("all additional keys sorting before the base keys", () => {
    const base: Array<string> = ["x", "y", "z"];
    const additional: Array<string> = ["c", "a", "b"];

    expect(
      merge({
        sortedBaseAttributeKeys: base,
        additionalAttributeKeys: additional,
      }),
    ).toEqual(["a", "b", "c", "x", "y", "z"]);
  });

  test("all additional keys sorting after the base keys", () => {
    const base: Array<string> = ["a", "b"];
    const additional: Array<string> = ["z", "y"];

    expect(
      merge({
        sortedBaseAttributeKeys: base,
        additionalAttributeKeys: additional,
      }),
    ).toEqual(["a", "b", "y", "z"]);
  });

  test("empty base list yields the sorted additional keys", () => {
    expect(
      merge({
        sortedBaseAttributeKeys: [],
        additionalAttributeKeys: ["b", "a"],
      }),
    ).toEqual(["a", "b"]);
  });

  test("both lists empty yields an empty list", () => {
    expect(
      merge({ sortedBaseAttributeKeys: [], additionalAttributeKeys: [] }),
    ).toEqual([]);
  });

  test("UTF-16 code-unit ordering matches the default sort (uppercase before lowercase, multibyte last)", () => {
    /*
     * The default Array.prototype.sort comparator orders by UTF-16 code
     * units: "Z" (0x5A) < "a" (0x61) < "é" (0xE9) < "日" (0x65E5). The
     * merge relies on `<`/`>` applying the same ordering — this test fails
     * if anyone "fixes" either side to use localeCompare.
     */
    const base: Array<string> = ["Zebra", "apple"].sort();
    const additional: Array<string> = ["日本語", "é-accent", "Banana"];

    expect(
      merge({
        sortedBaseAttributeKeys: base,
        additionalAttributeKeys: additional,
      }),
    ).toEqual(referenceSortedUnion(base, additional));
  });

  test("integer-like keys follow string sort order, not the Object.keys numeric-first order", () => {
    /*
     * Object.keys lists integer-like keys first in ascending numeric order
     * ("2" before "10"), but the stored attributeKeys was always the
     * SORTED list, where "10" < "2" lexicographically. The merge must
     * reproduce the sorted view.
     */
    const attributes: Dictionary<AttributeType> = {
      "10": "ten",
      "2": "two",
      name: "x",
    };
    const base: Array<string> = Object.keys(attributes).sort();
    const additional: Array<string> = ["11", "1"];

    expect(
      merge({
        sortedBaseAttributeKeys: base,
        additionalAttributeKeys: additional,
      }),
    ).toEqual(referenceSortedUnion(base, additional));
  });

  test("randomized inputs always equal the reference full sort (order included)", () => {
    /*
     * Deterministic pseudo-random sweep: many shapes of overlap, sizes and
     * key alphabets, each checked element-for-element against the
     * reference derivation the old per-datapoint code used.
     */
    let seed: number = 42;
    const nextRandom: () => number = (): number => {
      // Park-Miller minimal standard PRNG — deterministic across runs.
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };

    const alphabet: Array<string> = [
      "a",
      "B",
      "resource.service.name",
      "scope.name",
      "http.status_code",
      "0",
      "10",
      "2",
      "é",
      "日本",
      "_underscore",
      "UPPER",
      "shared.key",
      "z.last",
    ];

    for (let round: number = 0; round < 200; round++) {
      const baseSet: Record<string, boolean> = {};
      const additionalSet: Record<string, boolean> = {};

      for (const key of alphabet) {
        if (nextRandom() < 0.5) {
          baseSet[key] = true;
        }
        if (nextRandom() < 0.3) {
          additionalSet[key] = true;
        }
      }

      const base: Array<string> = Object.keys(baseSet).sort();
      const additional: Array<string> = Object.keys(additionalSet);

      expect(
        merge({
          sortedBaseAttributeKeys: base,
          additionalAttributeKeys: additional,
        }),
      ).toEqual(referenceSortedUnion(base, additional));
    }
  });
});

describe("TelemetryUtil.getPrefixedScopeAttributes", () => {
  test("prefixes every scope key with 'scope.'", () => {
    const scope: JSONObject = {
      name: "my-instrumentation",
      version: "1.2.3",
    };

    expect(TelemetryUtil.getPrefixedScopeAttributes(scope)).toEqual({
      "scope.name": "my-instrumentation",
      "scope.version": "1.2.3",
    });
  });

  test("preserves values verbatim, including non-string ones", () => {
    /*
     * The historical inline loop cast whatever the scope object carried
     * (`scopeAttributes[key] as AttributeType`) without transforming it —
     * the helper must not start coercing.
     */
    const nested: JSONObject = { droppedAttributesCount: 0 };
    const scope: JSONObject = {
      name: "scope-with-odd-values",
      attributes: nested,
      flag: true,
      count: 7,
    };

    const prefixed: Dictionary<AttributeType | Array<AttributeType>> =
      TelemetryUtil.getPrefixedScopeAttributes(scope);

    expect(prefixed["scope.name"]).toBe("scope-with-odd-values");
    expect(prefixed["scope.attributes"]).toBe(
      nested as unknown as AttributeType,
    );
    expect(prefixed["scope.flag"]).toBe(true);
    expect(prefixed["scope.count"]).toBe(7);
  });

  test("undefined, null and empty scopes all produce an empty map", () => {
    expect(TelemetryUtil.getPrefixedScopeAttributes(undefined)).toEqual({});
    expect(TelemetryUtil.getPrefixedScopeAttributes(null)).toEqual({});
    expect(TelemetryUtil.getPrefixedScopeAttributes({})).toEqual({});
  });

  test("returns a fresh object per call (scopes must not share prefixed maps)", () => {
    const first: Dictionary<AttributeType | Array<AttributeType>> =
      TelemetryUtil.getPrefixedScopeAttributes({});
    const second: Dictionary<AttributeType | Array<AttributeType>> =
      TelemetryUtil.getPrefixedScopeAttributes({});

    expect(first).not.toBe(second);
  });

  test("merging the prefixed map last reproduces the historical per-record loop", () => {
    /*
     * The ingest services replaced `spread resource+record attrs, then loop
     * scope keys in` with `Object.assign({}, resource, record, prefixed)`.
     * Equivalence proof at the helper level: same winners on collision and
     * same key insertion order as the loop-based construction.
     */
    const resourceAttributes: Dictionary<AttributeType> = {
      "resource.service.name": "svc",
      "scope.name": "resource-level-collision",
    };
    const recordAttributes: Dictionary<AttributeType> = {
      "http.method": "GET",
      "scope.name": "record-level-collision",
    };
    const scope: JSONObject = { name: "the-scope", version: "9" };

    // Historical construction.
    const legacy: Dictionary<AttributeType> = {
      ...resourceAttributes,
      ...recordAttributes,
    };
    for (const key of Object.keys(scope)) {
      legacy[`scope.${key}`] = scope[key] as AttributeType;
    }

    // New construction.
    const merged: Dictionary<AttributeType | Array<AttributeType>> =
      Object.assign(
        {},
        resourceAttributes,
        recordAttributes,
        TelemetryUtil.getPrefixedScopeAttributes(scope),
      );

    expect(merged).toEqual(legacy);
    expect(Object.keys(merged)).toEqual(Object.keys(legacy));
    // Scope wins the collision, exactly as the loop-based code had it.
    expect(merged["scope.name"]).toBe("the-scope");
  });
});
