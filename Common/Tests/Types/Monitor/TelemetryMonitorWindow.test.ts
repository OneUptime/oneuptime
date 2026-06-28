import {
  DEFAULT_TELEMETRY_MONITOR_WINDOW_SECONDS,
  MAX_TELEMETRY_MONITOR_WINDOW_SECONDS,
  clampTelemetryMonitorWindowSeconds,
} from "../../../Types/Monitor/TelemetryMonitorWindow";

describe("clampTelemetryMonitorWindowSeconds", () => {
  test("returns a valid positive value unchanged", () => {
    expect(clampTelemetryMonitorWindowSeconds(60)).toBe(60);
    expect(clampTelemetryMonitorWindowSeconds(300)).toBe(300);
    expect(clampTelemetryMonitorWindowSeconds(1)).toBe(1);
  });

  test("coalesces undefined / null to the default", () => {
    expect(clampTelemetryMonitorWindowSeconds(undefined)).toBe(
      DEFAULT_TELEMETRY_MONITOR_WINDOW_SECONDS,
    );
    expect(clampTelemetryMonitorWindowSeconds(null)).toBe(
      DEFAULT_TELEMETRY_MONITOR_WINDOW_SECONDS,
    );
  });

  test("coalesces zero and negatives to the default (the defeated-bound bug)", () => {
    expect(clampTelemetryMonitorWindowSeconds(0)).toBe(
      DEFAULT_TELEMETRY_MONITOR_WINDOW_SECONDS,
    );
    expect(clampTelemetryMonitorWindowSeconds(-1)).toBe(
      DEFAULT_TELEMETRY_MONITOR_WINDOW_SECONDS,
    );
    expect(clampTelemetryMonitorWindowSeconds(-9999)).toBe(
      DEFAULT_TELEMETRY_MONITOR_WINDOW_SECONDS,
    );
  });

  test("coalesces non-finite / NaN / Infinity to the default (never unbounded)", () => {
    expect(clampTelemetryMonitorWindowSeconds(NaN)).toBe(
      DEFAULT_TELEMETRY_MONITOR_WINDOW_SECONDS,
    );
    // Infinity is not a usable window — treat it as invalid, not as the ceiling.
    expect(clampTelemetryMonitorWindowSeconds(Infinity)).toBe(
      DEFAULT_TELEMETRY_MONITOR_WINDOW_SECONDS,
    );
    expect(clampTelemetryMonitorWindowSeconds("abc" as unknown as number)).toBe(
      DEFAULT_TELEMETRY_MONITOR_WINDOW_SECONDS,
    );
  });

  test("floors fractional values, collapsing < 1 to the default", () => {
    expect(clampTelemetryMonitorWindowSeconds(90.9)).toBe(90);
    expect(clampTelemetryMonitorWindowSeconds(0.5)).toBe(
      DEFAULT_TELEMETRY_MONITOR_WINDOW_SECONDS,
    );
  });

  test("caps values above the hard ceiling", () => {
    expect(
      clampTelemetryMonitorWindowSeconds(
        MAX_TELEMETRY_MONITOR_WINDOW_SECONDS + 1,
      ),
    ).toBe(MAX_TELEMETRY_MONITOR_WINDOW_SECONDS);
    expect(clampTelemetryMonitorWindowSeconds(999999999)).toBe(
      MAX_TELEMETRY_MONITOR_WINDOW_SECONDS,
    );
  });

  test("accepts exactly the ceiling", () => {
    expect(
      clampTelemetryMonitorWindowSeconds(MAX_TELEMETRY_MONITOR_WINDOW_SECONDS),
    ).toBe(MAX_TELEMETRY_MONITOR_WINDOW_SECONDS);
  });
});
