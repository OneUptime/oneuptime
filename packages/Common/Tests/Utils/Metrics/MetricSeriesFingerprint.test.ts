import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import { JSONObject } from "../../../Types/JSON";
import MetricSeriesFingerprint from "../../../Utils/Metrics/MetricSeriesFingerprint";
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
