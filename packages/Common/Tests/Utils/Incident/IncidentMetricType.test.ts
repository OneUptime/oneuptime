import IncidentMetricTypeUtil from "../../../Utils/Incident/IncidentMetricType";
import IncidentMetricType from "../../../Types/Incident/IncidentMetricType";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";

describe("IncidentMetricTypeUtil", () => {
  describe("getAggregationTypeByIncidentMetricType", () => {
    test.each([
      [IncidentMetricType.IncidentCount, AggregationType.Sum],
      [IncidentMetricType.SeverityChange, AggregationType.Sum],
      [IncidentMetricType.TimeToAcknowledge, AggregationType.Avg],
      [IncidentMetricType.TimeToResolve, AggregationType.Avg],
      [IncidentMetricType.IncidentDuration, AggregationType.Avg],
      [IncidentMetricType.TimeInState, AggregationType.Avg],
      [IncidentMetricType.PostmortemCompletionTime, AggregationType.Avg],
    ])(
      "%s aggregates as %s",
      (metricType: IncidentMetricType, expected: AggregationType) => {
        expect(
          IncidentMetricTypeUtil.getAggregationTypeByIncidentMetricType(
            metricType,
          ),
        ).toBe(expected);
      },
    );

    test("throws for the unhandled TimeToRootCausePosted metric type", () => {
      /*
       * TimeToRootCausePosted is written directly by the investigation
       * runner and is intentionally not part of the aggregation switch.
       */
      expect(() => {
        return IncidentMetricTypeUtil.getAggregationTypeByIncidentMetricType(
          IncidentMetricType.TimeToRootCausePosted,
        );
      }).toThrow("Invalid IncidentMetricType value");
    });

    test("throws for an unknown metric type", () => {
      expect(() => {
        return IncidentMetricTypeUtil.getAggregationTypeByIncidentMetricType(
          "not-a-real-metric" as IncidentMetricType,
        );
      }).toThrow("Invalid IncidentMetricType value");
    });
  });

  describe("getAllIncidentMetricTypes", () => {
    test("returns the four core metric types", () => {
      expect(IncidentMetricTypeUtil.getAllIncidentMetricTypes()).toEqual([
        IncidentMetricType.IncidentCount,
        IncidentMetricType.TimeToAcknowledge,
        IncidentMetricType.TimeToResolve,
        IncidentMetricType.IncidentDuration,
      ]);
    });

    test("every returned core type resolves to a valid aggregation type", () => {
      for (const metricType of IncidentMetricTypeUtil.getAllIncidentMetricTypes()) {
        expect(() => {
          return IncidentMetricTypeUtil.getAggregationTypeByIncidentMetricType(
            metricType,
          );
        }).not.toThrow();
      }
    });
  });

  describe("getTitleByIncidentMetricType", () => {
    test.each([
      [IncidentMetricType.IncidentCount, "Incident Count"],
      [IncidentMetricType.TimeToAcknowledge, "Time to Acknowledge"],
      [IncidentMetricType.TimeToResolve, "Time to Resolve"],
      [IncidentMetricType.IncidentDuration, "Incident Duration"],
      [IncidentMetricType.TimeInState, "Time in State"],
      [IncidentMetricType.SeverityChange, "Severity Changes"],
      [
        IncidentMetricType.PostmortemCompletionTime,
        "Postmortem Completion Time",
      ],
    ])("%s -> %s", (metricType: IncidentMetricType, expected: string) => {
      expect(
        IncidentMetricTypeUtil.getTitleByIncidentMetricType(metricType),
      ).toBe(expected);
    });

    test("returns empty string for an unknown metric type", () => {
      expect(
        IncidentMetricTypeUtil.getTitleByIncidentMetricType(
          "unknown" as IncidentMetricType,
        ),
      ).toBe("");
    });
  });

  describe("getDescriptionByIncidentMetricType", () => {
    test.each([
      IncidentMetricType.IncidentCount,
      IncidentMetricType.TimeToAcknowledge,
      IncidentMetricType.TimeToResolve,
      IncidentMetricType.IncidentDuration,
      IncidentMetricType.TimeInState,
      IncidentMetricType.SeverityChange,
      IncidentMetricType.PostmortemCompletionTime,
    ])("%s returns a non-empty sentence", (metricType: IncidentMetricType) => {
      const description: string =
        IncidentMetricTypeUtil.getDescriptionByIncidentMetricType(metricType);
      expect(description.length).toBeGreaterThan(0);
      expect(description.endsWith(".")).toBe(true);
    });

    test("returns empty string for an unknown metric type", () => {
      expect(
        IncidentMetricTypeUtil.getDescriptionByIncidentMetricType(
          "unknown" as IncidentMetricType,
        ),
      ).toBe("");
    });
  });

  describe("getLegendByIncidentMetricType", () => {
    test.each([
      [IncidentMetricType.IncidentCount, "Incidents"],
      [IncidentMetricType.TimeToAcknowledge, "Time to Acknowledge"],
      [IncidentMetricType.TimeToResolve, "Time to Resolve"],
      [IncidentMetricType.IncidentDuration, "Duration"],
      [IncidentMetricType.TimeInState, "Time in State"],
      [IncidentMetricType.SeverityChange, "Severity Changes"],
      [IncidentMetricType.PostmortemCompletionTime, "Postmortem Time"],
    ])("%s -> %s", (metricType: IncidentMetricType, expected: string) => {
      expect(
        IncidentMetricTypeUtil.getLegendByIncidentMetricType(metricType),
      ).toBe(expected);
    });

    test("returns empty string for an unknown metric type", () => {
      expect(
        IncidentMetricTypeUtil.getLegendByIncidentMetricType(
          "unknown" as IncidentMetricType,
        ),
      ).toBe("");
    });
  });

  describe("getLegendUnitByIncidentMetricType", () => {
    test.each([
      IncidentMetricType.IncidentCount,
      IncidentMetricType.SeverityChange,
    ])("%s has no unit", (metricType: IncidentMetricType) => {
      expect(
        IncidentMetricTypeUtil.getLegendUnitByIncidentMetricType(metricType),
      ).toBe("");
    });

    test.each([
      IncidentMetricType.TimeToAcknowledge,
      IncidentMetricType.TimeToResolve,
      IncidentMetricType.IncidentDuration,
      IncidentMetricType.TimeInState,
      IncidentMetricType.PostmortemCompletionTime,
    ])("%s is measured in seconds", (metricType: IncidentMetricType) => {
      expect(
        IncidentMetricTypeUtil.getLegendUnitByIncidentMetricType(metricType),
      ).toBe("s");
    });

    test("returns empty string for an unknown metric type", () => {
      expect(
        IncidentMetricTypeUtil.getLegendUnitByIncidentMetricType(
          "unknown" as IncidentMetricType,
        ),
      ).toBe("");
    });
  });
});
