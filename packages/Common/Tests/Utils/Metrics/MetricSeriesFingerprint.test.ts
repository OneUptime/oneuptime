import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import MetricSeriesFingerprint from "../../../Utils/Metrics/MetricSeriesFingerprint";
import { readOwnValue, writeOwnValue } from "../../../Utils/LookupTable";
import { INHERITED_PROPERTY_NAMES } from "../../Helpers/InheritedNames";
import { createHash } from "crypto";
import { describe, expect, test } from "@jest/globals";

/*
 * MetricSeriesFingerprint keys incidents/alerts by the metric series that
 * breached. The fingerprint MUST be stable across evaluations (key order,
 * dropped attributes) or the same host would spawn duplicate incidents. These
 * tests lock the canonicalization rules and a couple of known hash values so a
 * change to the hashing scheme is caught (it would re-bucket every open
 * incident).
 */

describe("MetricSeriesFingerprint.computeFingerprint", () => {
  test("empty labels map to the whole-monitor sentinel", () => {
    expect(MetricSeriesFingerprint.computeFingerprint({})).toBe("__all__");
    expect(
      MetricSeriesFingerprint.computeFingerprint(
        undefined as unknown as JSONObject,
      ),
    ).toBe("__all__");
    expect(MetricSeriesFingerprint.WholeMonitorFingerprint).toBe("__all__");
  });

  test("produces a stable 16-char hex fingerprint", () => {
    const fp: string = MetricSeriesFingerprint.computeFingerprint({
      host: "web1",
    });
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
    // Locked against the known sha256("host=web1")[:16].
    expect(fp).toBe("5a9c211a2005a4bb");
  });

  test("is independent of key insertion order", () => {
    const a: string = MetricSeriesFingerprint.computeFingerprint({
      a: "1",
      b: "2",
    });
    const b: string = MetricSeriesFingerprint.computeFingerprint({
      b: "2",
      a: "1",
    });
    expect(a).toBe(b);
    expect(a).toBe("95a180ca2b5d1603");
  });

  test("null and undefined values canonicalize to empty string", () => {
    const withNull: string = MetricSeriesFingerprint.computeFingerprint({
      a: null as unknown as string,
    });
    const withUndefined: string = MetricSeriesFingerprint.computeFingerprint({
      a: undefined as unknown as string,
    });
    const withEmpty: string = MetricSeriesFingerprint.computeFingerprint({
      a: "",
    });
    expect(withNull).toBe(withEmpty);
    expect(withUndefined).toBe(withEmpty);
  });

  test("different label values yield different fingerprints", () => {
    expect(
      MetricSeriesFingerprint.computeFingerprint({ host: "web1" }),
    ).not.toBe(MetricSeriesFingerprint.computeFingerprint({ host: "web2" }));
  });
});

describe("MetricSeriesFingerprint.extractSeriesLabels", () => {
  test("pulls the requested attribute keys out of the sample's attributes", () => {
    const sample: AggregatedModel = {
      timestamp: new Date(),
      value: 5,
      attributes: { "host.name": "web1", region: "us-east" },
    } as unknown as AggregatedModel;

    const labels: JSONObject = MetricSeriesFingerprint.extractSeriesLabels({
      sample,
      attributeKeys: ["host.name"],
    });

    expect(labels).toEqual({ "host.name": "web1" });
  });

  test("preserves a requested-but-missing attribute key as empty string", () => {
    const sample: AggregatedModel = {
      timestamp: new Date(),
      value: 5,
      attributes: { region: "us-east" },
    } as unknown as AggregatedModel;

    const labels: JSONObject = MetricSeriesFingerprint.extractSeriesLabels({
      sample,
      attributeKeys: ["host.name", "region"],
    });

    expect(labels).toEqual({ "host.name": "", region: "us-east" });
  });

  test("without attributeKeys, uses every non-reserved top-level key", () => {
    const sample: AggregatedModel = {
      timestamp: new Date(),
      value: 5,
      host: "web1",
      region: "us-east",
    } as unknown as AggregatedModel;

    const labels: JSONObject = MetricSeriesFingerprint.extractSeriesLabels({
      sample,
    });

    expect(labels).toEqual({ host: "web1", region: "us-east" });
    // timestamp and value are reserved and excluded.
    expect(labels).not.toHaveProperty("timestamp");
    expect(labels).not.toHaveProperty("value");
  });

  test("without attributeKeys, skips null/undefined top-level values", () => {
    const sample: AggregatedModel = {
      timestamp: new Date(),
      value: 5,
      host: "web1",
      region: null,
    } as unknown as AggregatedModel;

    const labels: JSONObject = MetricSeriesFingerprint.extractSeriesLabels({
      sample,
    });

    expect(labels).toEqual({ host: "web1" });
  });

  test("extracted labels fingerprint identically regardless of dropped attribute ordering", () => {
    const s1: AggregatedModel = {
      timestamp: new Date(),
      value: 1,
      attributes: { a: "x", b: "y" },
    } as unknown as AggregatedModel;
    const s2: AggregatedModel = {
      timestamp: new Date(),
      value: 2,
      attributes: { b: "y", a: "x" },
    } as unknown as AggregatedModel;

    const fp1: string = MetricSeriesFingerprint.computeFingerprint(
      MetricSeriesFingerprint.extractSeriesLabels({
        sample: s1,
        attributeKeys: ["a", "b"],
      }),
    );
    const fp2: string = MetricSeriesFingerprint.computeFingerprint(
      MetricSeriesFingerprint.extractSeriesLabels({
        sample: s2,
        attributeKeys: ["a", "b"],
      }),
    );

    expect(fp1).toBe(fp2);
  });
});

/*
 * Issue #8026: a metric monitor grouped by an attribute named like what
 * every object inherits (constructor, toString, valueOf, hasOwnProperty).
 * extractSeriesLabels read each group-by key with a plain read, which for a
 * sample without that attribute found the inherited function: the label was
 * the function, and the fingerprint hashed its source text
 * ("function Object() { [native code] }"), not the "" a missing key means.
 * A key named __proto__ (#8025) was not written at all, so a monitor grouped
 * by it alone keyed every series as the whole monitor.
 */
describe("MetricSeriesFingerprint with a group-by key named like what every object inherits (issues #8026, #8025)", () => {
  // The fingerprint of one canonical text, as computeFingerprint hashes it.
  const sha256Fingerprint: (canonical: string) => string = (
    canonical: string,
  ): string => {
    return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  };

  const sample: (attributes: JSONObject | undefined) => AggregatedModel = (
    attributes: JSONObject | undefined,
  ): AggregatedModel => {
    return {
      timestamp: new Date("2026-11-15T10:00:00.000Z"),
      value: 1,
      attributes,
    } as unknown as AggregatedModel;
  };

  // The labels { [name]: value }, with name as an own key, __proto__ too.
  const labelsOf: (name: string, value: string) => JSONObject = (
    name: string,
    value: string,
  ): JSONObject => {
    const labels: JSONObject = {};
    writeOwnValue<JSONValue>(labels, name, value);
    return labels;
  };

  test('the issue\'s case: grouped by constructor, a sample without it is labelled "", and one with it its own value', () => {
    const without: JSONObject = MetricSeriesFingerprint.extractSeriesLabels({
      sample: sample({ "host.name": "web-1" }),
      attributeKeys: ["constructor"],
    });

    expect(Object.keys(without)).toEqual(["constructor"]);
    expect(readOwnValue(without, "constructor")).toBe("");
    expect(typeof without["constructor"]).toBe("string");

    const withIt: JSONObject = MetricSeriesFingerprint.extractSeriesLabels({
      sample: sample({ "host.name": "web-1", constructor: "builder" }),
      attributeKeys: ["constructor"],
    });

    expect(readOwnValue(withIt, "constructor")).toBe("builder");
  });

  test('the issue\'s case: the fingerprint of a sample without constructor is that of { constructor: "" }', () => {
    const fingerprint: string = MetricSeriesFingerprint.computeFingerprint(
      MetricSeriesFingerprint.extractSeriesLabels({
        sample: sample({ "host.name": "web-1" }),
        attributeKeys: ["constructor"],
      }),
    );

    expect(fingerprint).toBe(
      MetricSeriesFingerprint.computeFingerprint({ constructor: "" }),
    );
    expect(fingerprint).toBe(sha256Fingerprint("constructor="));
    expect(fingerprint).not.toBe(
      sha256Fingerprint("constructor=function Object() { [native code] }"),
    );
  });

  test.each(INHERITED_PROPERTY_NAMES)(
    'grouped by %s: a sample without it, or without attributes at all, is labelled "" and keyed as such',
    (name: string) => {
      for (const attributes of [
        { "host.name": "web-1" },
        {},
        undefined,
      ] as Array<JSONObject | undefined>) {
        const labels: JSONObject = MetricSeriesFingerprint.extractSeriesLabels({
          sample: sample(attributes),
          attributeKeys: [name],
        });

        expect(Object.keys(labels)).toEqual([name]);
        expect(readOwnValue(labels, name)).toBe("");
        expect(Object.getPrototypeOf(labels)).toBe(Object.prototype);
        expect(MetricSeriesFingerprint.computeFingerprint(labels)).toBe(
          sha256Fingerprint(`${name}=`),
        );
        expect(MetricSeriesFingerprint.computeFingerprint(labels)).toBe(
          MetricSeriesFingerprint.computeFingerprint(labelsOf(name, "")),
        );
      }
    },
  );

  test.each(INHERITED_PROPERTY_NAMES)(
    "grouped by %s: a sample with it is labelled and keyed by its own value",
    (name: string) => {
      // As ClickHouse's JSON answer carries the map: own keys, __proto__ too.
      const attributes: JSONObject = JSON.parse(
        JSON.stringify({ "host.name": "web-1", [name]: "own" }),
      ) as JSONObject;

      const labels: JSONObject = MetricSeriesFingerprint.extractSeriesLabels({
        sample: sample(attributes),
        attributeKeys: [name, "host.name"],
      });

      expect(Object.keys(labels)).toEqual([name, "host.name"]);
      expect(readOwnValue(labels, name)).toBe("own");
      expect(JSON.stringify(labels)).toBe(
        `{"${name}":"own","host.name":"web-1"}`,
      );

      const canonical: string = [`${name}=own`, "host.name=web-1"]
        .sort()
        .join("|");

      expect(MetricSeriesFingerprint.computeFingerprint(labels)).toBe(
        sha256Fingerprint(canonical),
      );
    },
  );

  test.each(INHERITED_PROPERTY_NAMES)(
    "grouped by %s: two values of it are two series, and neither is the whole monitor",
    (name: string) => {
      const fingerprintOf: (value: string) => string = (
        value: string,
      ): string => {
        return MetricSeriesFingerprint.computeFingerprint(
          MetricSeriesFingerprint.extractSeriesLabels({
            sample: sample(
              JSON.parse(JSON.stringify({ [name]: value })) as JSONObject,
            ),
            attributeKeys: [name],
          }),
        );
      };

      expect(fingerprintOf("web")).not.toBe(fingerprintOf("api"));
      expect(fingerprintOf("web")).not.toBe(
        MetricSeriesFingerprint.WholeMonitorFingerprint,
      );
      expect(fingerprintOf("")).not.toBe(
        MetricSeriesFingerprint.WholeMonitorFingerprint,
      );
    },
  );

  test.each(INHERITED_PROPERTY_NAMES)(
    "without attributeKeys: a top-level column named %s is a label",
    (name: string) => {
      const row: AggregatedModel = JSON.parse(
        JSON.stringify({ value: 1, [name]: "column", region: "eu" }),
      ) as AggregatedModel;

      const labels: JSONObject = MetricSeriesFingerprint.extractSeriesLabels({
        sample: row,
      });

      expect(Object.keys(labels)).toEqual([name, "region"]);
      expect(readOwnValue(labels, name)).toBe("column");
    },
  );
});
