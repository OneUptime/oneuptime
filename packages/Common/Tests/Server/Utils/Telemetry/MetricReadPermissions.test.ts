import Metric from "../../../../Models/AnalyticsModels/Metric";
import { getMetricReadPermissions } from "../../../../Server/Utils/Telemetry/MetricReadPermissions";
import Permission from "../../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * The list the /telemetry/metrics/* routes and the AI metric tools ask for.
 * It is the Metric model's own read list, read once and handed out as a
 * copy.
 */
describe("getMetricReadPermissions", () => {
  test("is the Metric model's read list", () => {
    expect([...getMetricReadPermissions()].sort()).toEqual(
      [...new Metric().getReadPermissions()].sort(),
    );
  });

  test("names the metric permission, not the trace or log one", () => {
    const permissions: Array<Permission> = getMetricReadPermissions();

    expect(permissions).toContain(Permission.ReadTelemetryServiceMetrics);
    expect(permissions).not.toContain(Permission.ReadTelemetryServiceTraces);
    expect(permissions).not.toContain(Permission.ReadTelemetryServiceLog);
  });

  test("a caller that changes its copy changes nobody else's", () => {
    const first: Array<Permission> = getMetricReadPermissions();
    first.push(Permission.ReadTelemetryServiceTraces);
    first.splice(first.indexOf(Permission.ReadTelemetryServiceMetrics), 1);

    const second: Array<Permission> = getMetricReadPermissions();

    expect(second).not.toBe(first);
    expect(second).toContain(Permission.ReadTelemetryServiceMetrics);
    expect(second).not.toContain(Permission.ReadTelemetryServiceTraces);
  });
});
