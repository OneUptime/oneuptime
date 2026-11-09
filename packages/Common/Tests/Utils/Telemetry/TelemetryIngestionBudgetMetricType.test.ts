import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import TelemetryIngestionBudgetMetricType from "../../../Types/Telemetry/TelemetryIngestionBudgetMetricType";
import TelemetryIngestionBudgetMetricTypeUtil, {
  TELEMETRY_INGESTION_BUDGET_METRIC_INTERVAL_MINUTES,
  TELEMETRY_INGESTION_BUDGET_METRIC_NAME_PREFIX,
} from "../../../Utils/Telemetry/TelemetryIngestionBudgetMetricType";
import { describe, expect, test } from "@jest/globals";

/*
 * The oneuptime.telemetry.budget.* names (issue #5917) are a public,
 * append-only contract: monitors watch them by name. These pins keep the
 * list, the reserved prefix and the catalog metadata in step.
 */

const ALL: Array<TelemetryIngestionBudgetMetricType> = Object.values(
  TelemetryIngestionBudgetMetricType,
) as Array<TelemetryIngestionBudgetMetricType>;

describe("TelemetryIngestionBudgetMetricType", () => {
  test("names are spelled once, under the reserved prefix, apart from #6355's usage names", () => {
    expect([...ALL].sort()).toEqual(
      [
        "oneuptime.telemetry.budget.dropped.bytes",
        "oneuptime.telemetry.budget.throttled.requests",
        "oneuptime.telemetry.budget.used.bytes",
        "oneuptime.telemetry.budget.used.percent",
      ].sort(),
    );

    for (const name of ALL) {
      expect(
        name.startsWith(TELEMETRY_INGESTION_BUDGET_METRIC_NAME_PREFIX),
      ).toBe(true);
      expect(name.startsWith("oneuptime.telemetry.usage.")).toBe(false);
    }
  });

  test("getAll lists every member of the enum, so none goes unwritten or billed", () => {
    expect([...TelemetryIngestionBudgetMetricTypeUtil.getAll()].sort()).toEqual(
      [...ALL].sort(),
    );
  });

  test("reserves the whole prefix, in any case and padding, and nothing wider", () => {
    expect(
      TelemetryIngestionBudgetMetricTypeUtil.isReservedMetricName(
        "OneUptime.Telemetry.Budget.Used.Percent",
      ),
    ).toBe(true);
    expect(
      TelemetryIngestionBudgetMetricTypeUtil.isReservedMetricName(
        "  oneuptime.telemetry.budget.something.new ",
      ),
    ).toBe(true);
    expect(
      TelemetryIngestionBudgetMetricTypeUtil.isReservedMetricName(
        "oneuptime.telemetry.budgets",
      ),
    ).toBe(false);
    expect(
      TelemetryIngestionBudgetMetricTypeUtil.isReservedMetricName(
        "oneuptime.telemetry.usage.bytes",
      ),
    ).toBe(false);
    expect(
      TelemetryIngestionBudgetMetricTypeUtil.isReservedMetricName(null),
    ).toBe(false);
  });

  test("registers a title, a description and a unit for each, aggregated by Max", () => {
    for (const name of ALL) {
      expect(TelemetryIngestionBudgetMetricTypeUtil.getTitle(name)).not.toBe(
        "",
      );
      expect(
        TelemetryIngestionBudgetMetricTypeUtil.getDescription(name),
      ).toContain(
        `every ${TELEMETRY_INGESTION_BUDGET_METRIC_INTERVAL_MINUTES} minutes`,
      );
      expect(
        TelemetryIngestionBudgetMetricTypeUtil.getAggregationType(name),
      ).toBe(AggregationType.Max);
    }

    expect(
      TelemetryIngestionBudgetMetricTypeUtil.getUnit(
        TelemetryIngestionBudgetMetricType.UsedBytes,
      ),
    ).toBe("By");
    expect(
      TelemetryIngestionBudgetMetricTypeUtil.getUnit(
        TelemetryIngestionBudgetMetricType.UsedPercent,
      ),
    ).toBe("%");
    expect(
      TelemetryIngestionBudgetMetricTypeUtil.getUnit(
        TelemetryIngestionBudgetMetricType.DroppedBytes,
      ),
    ).toBe("By");
    expect(
      TelemetryIngestionBudgetMetricTypeUtil.getUnit(
        TelemetryIngestionBudgetMetricType.ThrottledRequests,
      ),
    ).toBe("{request}");
  });

  test("throws on a value that is not one of them", () => {
    expect(() => {
      TelemetryIngestionBudgetMetricTypeUtil.getTitle(
        "nope" as TelemetryIngestionBudgetMetricType,
      );
    }).toThrow();
  });
});
