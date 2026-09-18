import MetricDownsamplingRetentionDays, {
  DEFAULT_METRIC_CARDINALITY_BUDGET,
  DEFAULT_METRIC_DOWNSAMPLING_RETENTION_DAYS,
  resolveTierRetentionDays,
} from "../../../Types/Metrics/MetricDownsamplingRetentionDays";
import { describe, expect, test } from "@jest/globals";

describe("MetricDownsamplingRetentionDays", () => {
  describe("defaults", () => {
    test("exposes the documented per-tier default retention", () => {
      expect(DEFAULT_METRIC_DOWNSAMPLING_RETENTION_DAYS).toEqual({
        raw: 7,
        "1m": 14,
        "5m": 30,
        "1h": 90,
        "1d": 365,
      });
    });

    test("exposes the default cardinality budget", () => {
      expect(DEFAULT_METRIC_CARDINALITY_BUDGET).toBe(10000);
    });
  });

  describe("resolveTierRetentionDays", () => {
    test("prefers a positive service override over everything else", () => {
      const serviceOverride: MetricDownsamplingRetentionDays = { raw: 3 };
      const projectDefault: MetricDownsamplingRetentionDays = { raw: 20 };

      expect(
        resolveTierRetentionDays("raw", serviceOverride, projectDefault),
      ).toBe(3);
    });

    test("falls back to the project default when the service override is missing", () => {
      const projectDefault: MetricDownsamplingRetentionDays = { "1m": 21 };

      expect(resolveTierRetentionDays("1m", null, projectDefault)).toBe(21);
      expect(resolveTierRetentionDays("1m", {}, projectDefault)).toBe(21);
      expect(resolveTierRetentionDays("1m", undefined, projectDefault)).toBe(
        21,
      );
    });

    test("falls back to the hardcoded default when neither override is set", () => {
      expect(resolveTierRetentionDays("5m", null, null)).toBe(30);
      expect(resolveTierRetentionDays("1h", undefined, undefined)).toBe(90);
      expect(resolveTierRetentionDays("1d", {}, {})).toBe(365);
    });

    test("ignores non-positive service values and continues the fallback chain", () => {
      const projectDefault: MetricDownsamplingRetentionDays = { raw: 12 };

      // 0 and negative must NOT win — they fall through to the project default.
      expect(resolveTierRetentionDays("raw", { raw: 0 }, projectDefault)).toBe(
        12,
      );
      expect(resolveTierRetentionDays("raw", { raw: -5 }, projectDefault)).toBe(
        12,
      );
    });

    test("ignores null service values and uses the project default", () => {
      const projectDefault: MetricDownsamplingRetentionDays = { raw: 9 };

      expect(
        resolveTierRetentionDays("raw", { raw: null }, projectDefault),
      ).toBe(9);
    });

    test("ignores a non-positive project default and uses the hardcoded default", () => {
      // service missing, project default is 0 -> hardcoded default (7).
      expect(resolveTierRetentionDays("raw", null, { raw: 0 })).toBe(7);
      expect(resolveTierRetentionDays("raw", null, { raw: -1 })).toBe(7);
    });
  });
});
