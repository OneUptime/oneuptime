import AlertMetricTypeUtil from "../../../Utils/Alerts/AlertMetricType";
import AlertMetricType from "../../../Types/Alerts/AlertMetricType";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";

describe("AlertMetricTypeUtil", () => {
  describe("getAggregationTypeByAlertMetricType", () => {
    test("AlertCount aggregates as Sum", () => {
      expect(
        AlertMetricTypeUtil.getAggregationTypeByAlertMetricType(
          AlertMetricType.AlertCount,
        ),
      ).toBe(AggregationType.Sum);
    });

    test.each([
      AlertMetricType.TimeToAcknowledge,
      AlertMetricType.TimeToResolve,
      AlertMetricType.AlertDuration,
    ])("%s aggregates as Avg", (metricType: AlertMetricType) => {
      expect(
        AlertMetricTypeUtil.getAggregationTypeByAlertMetricType(metricType),
      ).toBe(AggregationType.Avg);
    });

    test("throws for an unknown metric type", () => {
      expect(() => {
        return AlertMetricTypeUtil.getAggregationTypeByAlertMetricType(
          "not-a-real-metric" as AlertMetricType,
        );
      }).toThrow("Invalid AlertMetricType value");
    });
  });

  describe("getAllAlertMetricTypes", () => {
    test("returns exactly the four supported metric types", () => {
      expect(AlertMetricTypeUtil.getAllAlertMetricTypes()).toEqual([
        AlertMetricType.AlertCount,
        AlertMetricType.TimeToAcknowledge,
        AlertMetricType.TimeToResolve,
        AlertMetricType.AlertDuration,
      ]);
    });

    test("every returned type resolves to a valid aggregation type", () => {
      for (const metricType of AlertMetricTypeUtil.getAllAlertMetricTypes()) {
        expect(() => {
          return AlertMetricTypeUtil.getAggregationTypeByAlertMetricType(
            metricType,
          );
        }).not.toThrow();
      }
    });
  });

  describe("getTitleByAlertMetricType", () => {
    test.each([
      [AlertMetricType.AlertCount, "Alert Count"],
      [AlertMetricType.TimeToAcknowledge, "Time to Acknowledge"],
      [AlertMetricType.TimeToResolve, "Time to Resolve"],
      [AlertMetricType.AlertDuration, "Alert Duration"],
    ])("%s -> %s", (metricType: AlertMetricType, expected: string) => {
      expect(AlertMetricTypeUtil.getTitleByAlertMetricType(metricType)).toBe(
        expected,
      );
    });

    test("returns empty string for an unknown metric type", () => {
      expect(
        AlertMetricTypeUtil.getTitleByAlertMetricType(
          "unknown" as AlertMetricType,
        ),
      ).toBe("");
    });
  });

  describe("getDescriptionByAlertMetricType", () => {
    test("returns a non-empty sentence for each known type", () => {
      for (const metricType of AlertMetricTypeUtil.getAllAlertMetricTypes()) {
        const description: string =
          AlertMetricTypeUtil.getDescriptionByAlertMetricType(metricType);
        expect(description.length).toBeGreaterThan(0);
        expect(description.endsWith(".")).toBe(true);
      }
    });

    test("returns empty string for an unknown metric type", () => {
      expect(
        AlertMetricTypeUtil.getDescriptionByAlertMetricType(
          "unknown" as AlertMetricType,
        ),
      ).toBe("");
    });
  });

  describe("getLegendByAlertMetricType", () => {
    test.each([
      [AlertMetricType.AlertCount, "Alerts"],
      [AlertMetricType.TimeToAcknowledge, "Time to Acknowledge"],
      [AlertMetricType.TimeToResolve, "Time to Resolve"],
      [AlertMetricType.AlertDuration, "Duration"],
    ])("%s -> %s", (metricType: AlertMetricType, expected: string) => {
      expect(AlertMetricTypeUtil.getLegendByAlertMetricType(metricType)).toBe(
        expected,
      );
    });

    test("returns empty string for an unknown metric type", () => {
      expect(
        AlertMetricTypeUtil.getLegendByAlertMetricType(
          "unknown" as AlertMetricType,
        ),
      ).toBe("");
    });
  });

  describe("getLegendUnitByAlertMetricType", () => {
    test("AlertCount has no unit", () => {
      expect(
        AlertMetricTypeUtil.getLegendUnitByAlertMetricType(
          AlertMetricType.AlertCount,
        ),
      ).toBe("");
    });

    test.each([
      AlertMetricType.TimeToAcknowledge,
      AlertMetricType.TimeToResolve,
      AlertMetricType.AlertDuration,
    ])("%s is measured in seconds", (metricType: AlertMetricType) => {
      expect(
        AlertMetricTypeUtil.getLegendUnitByAlertMetricType(metricType),
      ).toBe("s");
    });

    test("returns empty string for an unknown metric type", () => {
      expect(
        AlertMetricTypeUtil.getLegendUnitByAlertMetricType(
          "unknown" as AlertMetricType,
        ),
      ).toBe("");
    });
  });
});
