import PublicDashboardSloHistoryPolicy, {
  PublicDashboardSloHistoryPolicyResult,
} from "../../../../Server/Utils/Dashboard/PublicDashboardSloHistoryPolicy";
import PublicDashboardSloWidget, {
  PublicDashboardSloWidgetConfig,
} from "../../../../Server/Utils/Dashboard/PublicDashboardSloWidget";
import AggregationInterval from "../../../../Types/BaseDatabase/AggregationInterval";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import DashboardComponentType from "../../../../Types/Dashboard/DashboardComponentType";
import {
  SloWidgetDisplayType,
  SloWidgetMetric,
} from "../../../../Types/Dashboard/DashboardComponents/DashboardSloComponent";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, it } from "@jest/globals";

/*
 * The SLO history route is unauthenticated, so this policy is the whole
 * boundary between "the series this dashboard publishes" and "any SloHistory
 * row in the owning project". Everything below is written from that angle:
 * what the caller can move, and what it provably cannot.
 */

const SLO_ID: ObjectID = ObjectID.generate();

const RANGE_START: Date = new Date("2026-08-09T00:00:00.000Z");
const RANGE_END: Date = new Date("2026-08-09T06:00:00.000Z");

type WidgetArguments = Record<string, unknown>;

function sloWidget(argumentsObject: WidgetArguments = {}): WidgetArguments {
  return {
    componentType: DashboardComponentType.Slo,
    componentId: ObjectID.generate().toString(),
    arguments: {
      serviceLevelObjectiveId: SLO_ID.toString(),
      displayType: SloWidgetDisplayType.Chart,
      ...argumentsObject,
    },
  };
}

/*
 * Deliberately hostile: every field other than the window names something the
 * widget's author never published — another project, another SLO, another
 * series, an unbounded page, and an aggregation over the write-version
 * column. Not one of them may appear in the result.
 */
function aggregateBy(overrides: WidgetArguments = {}): WidgetArguments {
  return {
    query: {
      projectId: ObjectID.generate(),
      sloId: ObjectID.generate(),
      metricName: "burn.rate",
    },
    aggregationType: "Max",
    aggregateColumnName: "version",
    aggregationTimestampColumnName: "version",
    aggregationInterval: AggregationInterval.Total,
    startTimestamp: RANGE_START,
    endTimestamp: RANGE_END,
    limit: 999999,
    skip: 500,
    ...overrides,
  };
}

function build(data: {
  widgetArguments?: WidgetArguments | undefined;
  requestedAggregateBy?: unknown;
}): PublicDashboardSloHistoryPolicyResult {
  return PublicDashboardSloHistoryPolicy.build({
    widget: sloWidget(data.widgetArguments),
    requestedAggregateBy:
      "requestedAggregateBy" in data
        ? data.requestedAggregateBy
        : aggregateBy(),
  });
}

describe("PublicDashboardSloHistoryPolicy", () => {
  describe("what the stored widget decides", () => {
    it("reads the SLO id from the widget and never from the request", () => {
      expect(build({}).serviceLevelObjectiveId.toString()).toBe(
        SLO_ID.toString(),
      );
    });

    it("maps each stored metric to its own SloHistory series", () => {
      const expectedMetricNames: Record<SloWidgetMetric, string> = {
        [SloWidgetMetric.Sli]: "sli.percent",
        [SloWidgetMetric.ErrorBudgetRemaining]:
          "error.budget.remaining.percent",
        [SloWidgetMetric.BurnRate]: "burn.rate",
      };

      for (const sloMetric of Object.values(SloWidgetMetric)) {
        expect(build({ widgetArguments: { sloMetric } }).metricName).toBe(
          expectedMetricNames[sloMetric],
        );
      }
    });

    it("defaults to the SLI series when the widget predates the metric picker", () => {
      for (const sloMetric of [undefined, null, ""]) {
        expect(build({ widgetArguments: { sloMetric } }).metricName).toBe(
          "sli.percent",
        );
      }
    });

    it("rejects a stored metric it does not recognise", () => {
      for (const sloMetric of ["sli.percent", "Everything", 3, ["Sli"]]) {
        expect(() => {
          return build({ widgetArguments: { sloMetric } });
        }).toThrow(BadDataException);
      }
    });

    it("serves history only for a Chart widget", () => {
      expect(() => {
        return build({
          widgetArguments: { displayType: SloWidgetDisplayType.Tile },
        });
      }).toThrow(BadDataException);

      /*
       * A widget saved before the display picker existed defaults to Tile, so
       * it publishes its current numbers and nothing more.
       */
      expect(() => {
        return build({ widgetArguments: { displayType: undefined } });
      }).toThrow(BadDataException);

      expect(() => {
        return build({ widgetArguments: { displayType: "Raw" } });
      }).toThrow(BadDataException);
    });

    it("fails closed on a widget that names no SLO or names it badly", () => {
      for (const brokenId of [
        undefined,
        null,
        "",
        "   ",
        "not-a-uuid",
        42,
        [SLO_ID.toString()],
      ]) {
        expect(() => {
          return build({
            widgetArguments: { serviceLevelObjectiveId: brokenId },
          });
        }).toThrow(BadDataException);
      }
    });

    it("fails closed on a widget that is not a widget", () => {
      for (const brokenWidget of [
        null,
        undefined,
        "widget",
        7,
        [],
        {},
        { arguments: 3 },
        { arguments: null },
        { arguments: [] },
      ]) {
        expect(() => {
          return PublicDashboardSloHistoryPolicy.build({
            widget: brokenWidget,
            requestedAggregateBy: aggregateBy(),
          });
        }).toThrow(BadDataException);
      }
    });
  });

  describe("what the caller may move", () => {
    it("keeps the requested window and nothing else from aggregateBy", () => {
      const result: PublicDashboardSloHistoryPolicyResult = build({});

      expect(result.startDate.toISOString()).toBe(RANGE_START.toISOString());
      expect(result.endDate.toISOString()).toBe(RANGE_END.toISOString());

      /*
       * The forged project, SLO, series, aggregation columns, interval, limit
       * and skip are all absent: the result carries no field they could ride
       * out on.
       */
      expect(Object.keys(result).sort()).toEqual([
        "aggregationInterval",
        "endDate",
        "limit",
        "metricName",
        "serviceLevelObjectiveId",
        "startDate",
      ]);
      expect(result.serviceLevelObjectiveId.toString()).toBe(SLO_ID.toString());
      expect(result.metricName).toBe("sli.percent");
    });

    it("accepts ISO date strings, which is what a JSON round trip produces", () => {
      const result: PublicDashboardSloHistoryPolicyResult = build({
        requestedAggregateBy: aggregateBy({
          startTimestamp: RANGE_START.toISOString(),
          endTimestamp: RANGE_END.toISOString(),
        }),
      });

      expect(result.startDate.toISOString()).toBe(RANGE_START.toISOString());
      expect(result.endDate.toISOString()).toBe(RANGE_END.toISOString());
    });

    it("recomputes the bucket size from the window rather than trusting it", () => {
      const intervalCases: Array<{
        hours: number;
        expected: AggregationInterval;
      }> = [
        { hours: 1, expected: AggregationInterval.FiveMinutes },
        { hours: 12, expected: AggregationInterval.FiveMinutes },
        { hours: 24, expected: AggregationInterval.ThirtyMinutes },
        { hours: 24 * 7, expected: AggregationInterval.Hour },
        { hours: 24 * 90, expected: AggregationInterval.Day },
      ];

      for (const intervalCase of intervalCases) {
        const endDate: Date = new Date(
          RANGE_START.getTime() + intervalCase.hours * 60 * 60 * 1000,
        );

        const result: PublicDashboardSloHistoryPolicyResult = build({
          requestedAggregateBy: aggregateBy({
            endTimestamp: endDate,
            // Deliberately the coarsest possible ask; it must be discarded.
            aggregationInterval: AggregationInterval.Total,
          }),
        });

        expect(result.aggregationInterval).toBe(intervalCase.expected);
      }
    });

    it("pins the page size to the project ceiling", () => {
      expect(
        build({ requestedAggregateBy: aggregateBy({ limit: 1 }) }).limit,
      ).toBe(LIMIT_PER_PROJECT);
      expect(
        build({ requestedAggregateBy: aggregateBy({ limit: -5, skip: 900 }) })
          .limit,
      ).toBe(LIMIT_PER_PROJECT);
    });
  });

  describe("window validation", () => {
    it("rejects a missing or non-object aggregateBy", () => {
      for (const broken of [undefined, null, "aggregateBy", 5, []]) {
        expect(() => {
          return build({ requestedAggregateBy: broken });
        }).toThrow(BadDataException);
      }
    });

    it("rejects timestamps that are not dates", () => {
      const brokenDates: Array<unknown> = [
        undefined,
        null,
        "yesterday",
        {},
        [],
        new Date("nope"),
        // Longer than the accepted date-string bound.
        "2026-08-09T00:00:00.000Z".padEnd(200, " "),
      ];

      for (const brokenDate of brokenDates) {
        expect(() => {
          return build({
            requestedAggregateBy: aggregateBy({ startTimestamp: brokenDate }),
          });
        }).toThrow(BadDataException);

        expect(() => {
          return build({
            requestedAggregateBy: aggregateBy({ endTimestamp: brokenDate }),
          });
        }).toThrow(BadDataException);
      }
    });

    it("rejects an inverted or empty window", () => {
      expect(() => {
        return build({
          requestedAggregateBy: aggregateBy({
            startTimestamp: RANGE_END,
            endTimestamp: RANGE_START,
          }),
        });
      }).toThrow(BadDataException);

      expect(() => {
        return build({
          requestedAggregateBy: aggregateBy({
            startTimestamp: RANGE_START,
            endTimestamp: RANGE_START,
          }),
        });
      }).toThrow(BadDataException);
    });

    /*
     * A window longer than the history's own retention is CLAMPED rather than
     * refused: the public range picker is unbounded and the metric widgets
     * beside this one just render whatever the range holds, so throwing would
     * make the SLO chart the only tile on the page showing an error.
     */
    it("clamps a window longer than the history's own retention", () => {
      const retentionInMs: number = 400 * 24 * 60 * 60 * 1000;
      const justInside: Date = new Date(RANGE_START.getTime() + retentionInMs);
      const wayOutside: Date = new Date(
        RANGE_START.getTime() + retentionInMs * 3,
      );

      const inside: PublicDashboardSloHistoryPolicyResult = build({
        requestedAggregateBy: aggregateBy({ endTimestamp: justInside }),
      });
      expect(inside.startDate.toISOString()).toBe(RANGE_START.toISOString());
      expect(inside.aggregationInterval).toBe(AggregationInterval.Day);

      const clamped: PublicDashboardSloHistoryPolicyResult = build({
        requestedAggregateBy: aggregateBy({ endTimestamp: wayOutside }),
      });

      // The end the viewer asked for is kept; only the reach back is cut.
      expect(clamped.endDate.toISOString()).toBe(wayOutside.toISOString());
      expect(clamped.startDate.toISOString()).toBe(
        new Date(wayOutside.getTime() - retentionInMs).toISOString(),
      );
      expect(clamped.startDate.getTime()).toBeGreaterThan(
        RANGE_START.getTime(),
      );
      /*
       * Any window big enough to be clamped is far past the 45-day tier, so
       * the client's interval (computed from the unclamped window) and the
       * server's (from the clamped one) still agree — the chart's x-axis and
       * the buckets it receives stay on the same grid.
       */
      expect(clamped.aggregationInterval).toBe(AggregationInterval.Day);
    });
  });
});

describe("PublicDashboardSloWidget", () => {
  it("reads the same config from a widget and from its arguments", () => {
    const widget: WidgetArguments = sloWidget({
      sloMetric: SloWidgetMetric.ErrorBudgetRemaining,
    });

    const fromWidget: PublicDashboardSloWidgetConfig =
      PublicDashboardSloWidget.readConfig(widget);
    const fromArguments: PublicDashboardSloWidgetConfig =
      PublicDashboardSloWidget.readConfigFromArguments(
        widget["arguments"] as WidgetArguments,
      );

    expect(fromWidget.serviceLevelObjectiveId.toString()).toBe(
      fromArguments.serviceLevelObjectiveId.toString(),
    );
    expect(fromWidget.sloMetric).toBe(SloWidgetMetric.ErrorBudgetRemaining);
    expect(fromArguments.sloMetric).toBe(SloWidgetMetric.ErrorBudgetRemaining);
    expect(fromWidget.displayType).toBe(SloWidgetDisplayType.Chart);
  });

  it("trims a stored id before validating it", () => {
    expect(
      PublicDashboardSloWidget.readConfigFromArguments({
        serviceLevelObjectiveId: `  ${SLO_ID.toString()}  `,
      }).serviceLevelObjectiveId.toString(),
    ).toBe(SLO_ID.toString());
  });
});
