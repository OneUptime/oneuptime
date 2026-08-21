import { MutableMetricService } from "../../../Server/Services/MutableMetricService";
import AlertMetricType from "../../../Types/Alerts/AlertMetricType";
import IncidentMetricType from "../../../Types/Incident/IncidentMetricType";

/*
 * isMutableMetricName decides whether a read goes to the mutable metric
 * table or the immutable one. Every consumer of it fails SILENTLY EMPTY on a
 * wrong answer -- an empty chart, no error, no log -- so this predicate is
 * pinned rather than left to be noticed in production.
 */
describe("MutableMetricService.isMutableMetricName", () => {
  describe("existing built-in metric names still route to the mutable table", () => {
    test.each(Object.values(IncidentMetricType))(
      "%s is a mutable metric name",
      (metricType: IncidentMetricType) => {
        expect(MutableMetricService.isMutableMetricName(metricType)).toBe(true);
      },
    );

    test.each(Object.values(AlertMetricType))(
      "%s is a mutable metric name",
      (metricType: AlertMetricType) => {
        expect(MutableMetricService.isMutableMetricName(metricType)).toBe(true);
      },
    );
  });

  describe("user-defined measurement names route to the mutable table", () => {
    test.each([
      "oneuptime.incident.measurement.time-to-detect",
      "oneuptime.incident.measurement.time-to-mitigate",
      "oneuptime.alert.measurement.time-to-triage",
      "oneuptime.scheduled-maintenance.measurement.overrun",
    ])("%s is a mutable metric name", (metricName: string) => {
      expect(MutableMetricService.isMutableMetricName(metricName)).toBe(true);
    });
  });

  describe("everything else stays on the immutable table", () => {
    test.each([
      "http.server.request.duration",
      "process.cpu.utilization",
      "my.custom.metric",
      // A near-miss that must not be captured by the prefix test.
      "oneuptime.monitor.uptime",
      "oneuptimeincident.something",
      // Prefixes are anchored at the start, not matched anywhere.
      "vendor.oneuptime.incident.time-to-resolve",
    ])("%s is not a mutable metric name", (metricName: string) => {
      expect(MutableMetricService.isMutableMetricName(metricName)).toBe(false);
    });

    test.each([undefined, ""])("%p is not a mutable metric name", (value?: string) => {
      expect(MutableMetricService.isMutableMetricName(value)).toBe(false);
    });
  });

  test("every built-in metric name sits under one of the declared prefixes", () => {
    /*
     * Guards the inverse direction: if someone adds a metric type outside the
     * reserved namespaces, the routing test above would pass only because the
     * new name was never enumerated here.
     */
    const prefixes: ReadonlyArray<string> =
      MutableMetricService.getMutableMetricNamePrefixes();

    const allNames: Array<string> = [
      ...Object.values(IncidentMetricType),
      ...Object.values(AlertMetricType),
    ];

    for (const name of allNames) {
      expect(
        prefixes.some((prefix: string) => {
          return name.startsWith(prefix);
        }),
      ).toBe(true);
    }
  });
});
