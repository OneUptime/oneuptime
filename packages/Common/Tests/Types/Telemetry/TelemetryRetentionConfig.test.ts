import TelemetryRetentionConfig, {
  HARDCODED_DEFAULT_TELEMETRY_RETENTION_IN_DAYS,
  resolveTelemetryRetentionInDays,
} from "../../../Types/Telemetry/TelemetryRetentionConfig";
import LogSeverity from "../../../Types/Log/LogSeverity";
import { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import { describe, expect, it } from "@jest/globals";

type RetentionInput = {
  pillar: "logs";
  bucketKey?: LogSeverity | null;
  serviceConfig?: TelemetryRetentionConfig | null;
  serviceRetentionInDays?: number | null;
  projectConfig?: TelemetryRetentionConfig | null;
  projectRetentionInDays?: number | null;
};

describe("resolveTelemetryRetentionInDays", () => {
  describe("hardcoded fallback", () => {
    it("returns the hardcoded default when nothing is configured", () => {
      expect(resolveTelemetryRetentionInDays({ pillar: "logs" })).toBe(
        HARDCODED_DEFAULT_TELEMETRY_RETENTION_IN_DAYS,
      );
    });

    it("keeps the hardcoded default at 15 days", () => {
      // Pinning the constant guards the sessionReplay comment's assumptions.
      expect(HARDCODED_DEFAULT_TELEMETRY_RETENTION_IN_DAYS).toBe(15);
    });

    it("falls back to hardcoded default when every candidate is non-positive", () => {
      expect(
        resolveTelemetryRetentionInDays({
          pillar: "metrics",
          serviceRetentionInDays: 0,
          projectRetentionInDays: -5,
          serviceConfig: { metrics: { default: 0 } },
          projectConfig: { metrics: { default: null } },
        }),
      ).toBe(HARDCODED_DEFAULT_TELEMETRY_RETENTION_IN_DAYS);
    });
  });

  describe("precedence order (narrowest first)", () => {
    /*
     * A fully-populated config where every one of the six levels holds a
     * distinct positive value, so each test can prove exactly which level won
     * by the number it returns.
     */
    const fullInput: () => RetentionInput = (): RetentionInput => {
      return {
        pillar: "logs",
        bucketKey: LogSeverity.Error,
        serviceConfig: {
          logs: { default: 2, bySeverity: { [LogSeverity.Error]: 1 } },
        },
        serviceRetentionInDays: 3,
        projectConfig: {
          logs: { default: 5, bySeverity: { [LogSeverity.Error]: 4 } },
        },
        projectRetentionInDays: 6,
      };
    };

    it("1. service bucket value wins over everything else", () => {
      expect(resolveTelemetryRetentionInDays(fullInput())).toBe(1);
    });

    it("2. service pillar default wins when no service bucket value", () => {
      const input: RetentionInput = fullInput();
      input.serviceConfig = { logs: { default: 2 } };
      expect(resolveTelemetryRetentionInDays(input)).toBe(2);
    });

    it("3. service retention days wins when no service pillar config", () => {
      const input: RetentionInput = fullInput();
      input.serviceConfig = null;
      expect(resolveTelemetryRetentionInDays(input)).toBe(3);
    });

    it("4. project bucket value wins when no service-level value", () => {
      const input: RetentionInput = fullInput();
      input.serviceConfig = null;
      input.serviceRetentionInDays = null;
      expect(resolveTelemetryRetentionInDays(input)).toBe(4);
    });

    it("5. project pillar default wins when no project bucket value", () => {
      const input: RetentionInput = fullInput();
      input.serviceConfig = null;
      input.serviceRetentionInDays = null;
      input.projectConfig = { logs: { default: 5 } };
      expect(resolveTelemetryRetentionInDays(input)).toBe(5);
    });

    it("6. project retention days is the last configured candidate", () => {
      const input: RetentionInput = fullInput();
      input.serviceConfig = null;
      input.serviceRetentionInDays = null;
      input.projectConfig = null;
      expect(resolveTelemetryRetentionInDays(input)).toBe(6);
    });
  });

  describe("non-positive values are skipped, not treated as configured", () => {
    it("skips a zero service bucket value and falls to the next candidate", () => {
      expect(
        resolveTelemetryRetentionInDays({
          pillar: "logs",
          bucketKey: LogSeverity.Warning,
          serviceConfig: {
            logs: { default: 30, bySeverity: { [LogSeverity.Warning]: 0 } },
          },
        }),
      ).toBe(30);
    });

    it("skips a negative pillar default and falls through to project retention", () => {
      expect(
        resolveTelemetryRetentionInDays({
          pillar: "metrics",
          serviceConfig: { metrics: { default: -10 } },
          projectRetentionInDays: 45,
        }),
      ).toBe(45);
    });

    it("treats a null bucket value as unset", () => {
      expect(
        resolveTelemetryRetentionInDays({
          pillar: "traces",
          bucketKey: SpanStatus.Error,
          serviceConfig: {
            traces: { default: 12, byStatus: { [SpanStatus.Error]: null } },
          },
        }),
      ).toBe(12);
    });
  });

  describe("bucket keys", () => {
    it("ignores the bucket when bucketKey is not provided", () => {
      expect(
        resolveTelemetryRetentionInDays({
          pillar: "logs",
          serviceConfig: {
            logs: { default: 20, bySeverity: { [LogSeverity.Error]: 99 } },
          },
        }),
      ).toBe(20);
    });

    it("only matches the bucket for the exact key", () => {
      const config: TelemetryRetentionConfig = {
        logs: {
          default: 20,
          bySeverity: {
            [LogSeverity.Error]: 99,
            [LogSeverity.Warning]: 50,
          },
        },
      };
      expect(
        resolveTelemetryRetentionInDays({
          pillar: "logs",
          bucketKey: LogSeverity.Warning,
          serviceConfig: config,
        }),
      ).toBe(50);
      expect(
        resolveTelemetryRetentionInDays({
          pillar: "logs",
          bucketKey: LogSeverity.Fatal,
          serviceConfig: config,
        }),
      ).toBe(20);
    });

    it("resolves trace retention by span status bucket", () => {
      expect(
        resolveTelemetryRetentionInDays({
          pillar: "traces",
          bucketKey: SpanStatus.Ok,
          serviceConfig: {
            traces: { default: 10, byStatus: { [SpanStatus.Ok]: 7 } },
          },
        }),
      ).toBe(7);
    });

    it("ignores a bucketKey for pillars that have no buckets", () => {
      // metrics has no per-bucket overrides; bucketKey must be a no-op.
      expect(
        resolveTelemetryRetentionInDays({
          pillar: "metrics",
          bucketKey: LogSeverity.Error,
          serviceConfig: { metrics: { default: 8 } },
        }),
      ).toBe(8);
    });
  });

  describe("null and undefined configs", () => {
    it("handles null configs alongside a positive project retention", () => {
      expect(
        resolveTelemetryRetentionInDays({
          pillar: "profiles",
          serviceConfig: null,
          projectConfig: null,
          projectRetentionInDays: 21,
        }),
      ).toBe(21);
    });

    it("handles a config object that omits the requested pillar", () => {
      expect(
        resolveTelemetryRetentionInDays({
          pillar: "profiles",
          serviceConfig: { logs: { default: 30 } },
          serviceRetentionInDays: 9,
        }),
      ).toBe(9);
    });
  });
});
