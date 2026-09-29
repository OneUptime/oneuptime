import PublicDashboardSloHistoryPolicy, {
  PublicDashboardSloHistoryPolicyResult,
} from "../../../../Server/Utils/Dashboard/PublicDashboardSloHistoryPolicy";
import PublicDashboardSloWidget, {
  PUBLIC_SLO_WIDGET_MULTIPLE_SELECTION_MESSAGE,
  PUBLIC_SLO_WIDGET_NO_SELECTION_MESSAGE,
  PUBLIC_SLO_WIDGET_NOT_CONFIGURED_MESSAGE,
  PUBLIC_SLO_WIDGET_VARIABLE_MISSING_MESSAGE,
  PublicDashboardSloWidgetConfig,
  PublicDashboardSloWidgetTarget,
  PublicDashboardSloWidgetTargetKind,
} from "../../../../Server/Utils/Dashboard/PublicDashboardSloWidget";
import AggregationInterval from "../../../../Types/BaseDatabase/AggregationInterval";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import DashboardComponentType from "../../../../Types/Dashboard/DashboardComponentType";
import {
  SloWidgetDisplayType,
  SloWidgetMetric,
} from "../../../../Types/Dashboard/DashboardComponents/DashboardSloComponent";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../../Types/Dashboard/DashboardVariable";
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
const VARIABLE_ID: string = "slo-variable";
const PICKED_SLO: string = "Checkout API";

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

// A chart that follows the dashboard's SLO variable instead of pinning an SLO.
function followingWidget(
  argumentsObject: WidgetArguments = {},
): WidgetArguments {
  return sloWidget({
    serviceLevelObjectiveId: undefined,
    serviceLevelObjectiveVariableId: VARIABLE_ID,
    ...argumentsObject,
  });
}

/*
 * The shape resolveDashboardVariableSelections hands the policy: the STORED
 * variable (id, type, key) with the viewer's selection applied.
 */
function sloVariable(
  overrides: Partial<DashboardVariable> = {},
): DashboardVariable {
  return {
    id: VARIABLE_ID,
    name: "slo",
    type: DashboardVariableType.TelemetryAttribute,
    attributeKey: "sloName",
    isMultiSelect: false,
    selectedValue: PICKED_SLO,
    ...overrides,
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
      name: "Some Other SLO",
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

function buildFollowing(data: {
  widgetArguments?: WidgetArguments | undefined;
  variables?: Array<DashboardVariable> | undefined;
}): PublicDashboardSloHistoryPolicyResult {
  return PublicDashboardSloHistoryPolicy.build({
    widget: followingWidget(data.widgetArguments),
    requestedAggregateBy: aggregateBy(),
    variables: "variables" in data ? data.variables : [sloVariable()],
  });
}

function pinnedIdOf(target: PublicDashboardSloWidgetTarget): string {
  if (target.kind !== PublicDashboardSloWidgetTargetKind.Pinned) {
    throw new Error(`Expected a pinned target, got ${target.kind}`);
  }

  return target.serviceLevelObjectiveId.toString();
}

describe("PublicDashboardSloHistoryPolicy", () => {
  describe("what the stored widget decides", () => {
    it("reads the SLO id from the widget and never from the request", () => {
      expect(pinnedIdOf(build({}).target)).toBe(SLO_ID.toString());
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

  describe("a chart that follows the dashboard's SLO variable", () => {
    /*
     * The binding is the author's opt-in to charting whichever ACTIVE SLO a
     * viewer picks — so the policy hands the route a NAME, which the route
     * resolves inside the dashboard's own project. The request's own query
     * (which names another SLO here) plays no part.
     */
    it("targets the picked SLO by name, whatever the request's query names", () => {
      expect(buildFollowing({}).target).toEqual({
        kind: PublicDashboardSloWidgetTargetKind.Selected,
        serviceLevelObjectiveName: PICKED_SLO,
      });
    });

    it("follows a one-pick multi-select the same way", () => {
      expect(
        buildFollowing({
          variables: [
            sloVariable({
              isMultiSelect: true,
              selectedValue: undefined,
              selectedValues: [PICKED_SLO],
            }),
          ],
        }).target,
      ).toEqual({
        kind: PublicDashboardSloWidgetTargetKind.Selected,
        serviceLevelObjectiveName: PICKED_SLO,
      });
    });

    /*
     * An author who pinned one SLO meant that SLO: the binding the template
     * left behind must not widen a pinned chart into one any viewer can point.
     */
    it("ignores the variable when an SLO is pinned", () => {
      expect(
        pinnedIdOf(
          PublicDashboardSloHistoryPolicy.build({
            widget: followingWidget({
              serviceLevelObjectiveId: SLO_ID.toString(),
            }),
            requestedAggregateBy: aggregateBy(),
            variables: [sloVariable()],
          }).target,
        ),
      ).toBe(SLO_ID.toString());
    });

    /*
     * A malformed pinned id fails closed. It must never fall through to the
     * variable binding: that would turn a broken pin into "any SLO the viewer
     * names".
     */
    it("refuses a malformed pinned id instead of falling back to the variable", () => {
      for (const brokenId of ["not-a-uuid", 42, [SLO_ID.toString()], {}]) {
        let target: PublicDashboardSloWidgetTarget | null = null;

        expect(() => {
          target = buildFollowing({
            widgetArguments: { serviceLevelObjectiveId: brokenId },
          }).target;
        }).toThrow(BadDataException);

        expect(target).toBeNull();
      }
    });

    it("refuses while the toolbar is on All", () => {
      for (const variable of [
        sloVariable({ selectedValue: "" }),
        sloVariable({ selectedValue: undefined }),
        sloVariable({
          isMultiSelect: true,
          selectedValue: undefined,
          selectedValues: [],
        }),
      ]) {
        expect(() => {
          return buildFollowing({ variables: [variable] });
        }).toThrow(PUBLIC_SLO_WIDGET_NO_SELECTION_MESSAGE);
      }
    });

    it("refuses to choose one of several picks", () => {
      expect(() => {
        return buildFollowing({
          variables: [
            sloVariable({
              isMultiSelect: true,
              selectedValue: undefined,
              selectedValues: [PICKED_SLO, "Search API"],
            }),
          ],
        });
      }).toThrow(PUBLIC_SLO_WIDGET_MULTIPLE_SELECTION_MESSAGE);
    });

    it("refuses a binding to a variable the dashboard does not have, or not a Telemetry Attribute one", () => {
      for (const variables of [
        undefined,
        [],
        [sloVariable({ id: "another-variable" })],
        [sloVariable({ type: DashboardVariableType.ProjectLabel })],
        [sloVariable({ type: DashboardVariableType.CustomList })],
      ]) {
        expect(() => {
          return buildFollowing({ variables });
        }).toThrow(PUBLIC_SLO_WIDGET_VARIABLE_MISSING_MESSAGE);
      }
    });

    it("refuses a binding that is not a bounded string", () => {
      for (const brokenVariableId of [
        42,
        ["slo-variable"],
        {},
        "v".repeat(300),
      ]) {
        expect(() => {
          return buildFollowing({
            widgetArguments: {
              serviceLevelObjectiveVariableId: brokenVariableId,
            },
          });
        }).toThrow(
          "Dashboard widget serviceLevelObjectiveVariableId is invalid.",
        );
      }
    });

    it("treats an empty or whitespace-only binding as no SLO at all", () => {
      for (const blank of ["", "   ", null]) {
        expect(() => {
          return buildFollowing({
            widgetArguments: { serviceLevelObjectiveVariableId: blank },
          });
        }).toThrow(PUBLIC_SLO_WIDGET_NOT_CONFIGURED_MESSAGE);
      }
    });

    it("refuses a picked name longer than any variable value can be", () => {
      expect(() => {
        return buildFollowing({
          variables: [sloVariable({ selectedValue: "x".repeat(1025) })],
        });
      }).toThrow(BadDataException);
    });

    it("still serves history only for a Chart widget", () => {
      expect(() => {
        return buildFollowing({
          widgetArguments: { displayType: SloWidgetDisplayType.Tile },
        });
      }).toThrow("This dashboard widget does not chart SLO history.");
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
        "startDate",
        "target",
      ]);
      expect(pinnedIdOf(result.target)).toBe(SLO_ID.toString());
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

    expect(pinnedIdOf(fromWidget.target)).toBe(
      pinnedIdOf(fromArguments.target),
    );
    expect(fromWidget.sloMetric).toBe(SloWidgetMetric.ErrorBudgetRemaining);
    expect(fromArguments.sloMetric).toBe(SloWidgetMetric.ErrorBudgetRemaining);
    expect(fromWidget.displayType).toBe(SloWidgetDisplayType.Chart);
  });

  it("reads the same followed target from a widget and from its arguments", () => {
    const widget: WidgetArguments = followingWidget();
    const variables: Array<DashboardVariable> = [sloVariable()];

    expect(
      PublicDashboardSloWidget.readConfig(widget, variables).target,
    ).toEqual(
      PublicDashboardSloWidget.readConfigFromArguments(
        widget["arguments"] as WidgetArguments,
        variables,
      ).target,
    );
  });

  it("trims a stored id before validating it", () => {
    expect(
      pinnedIdOf(
        PublicDashboardSloWidget.readConfigFromArguments({
          serviceLevelObjectiveId: `  ${SLO_ID.toString()}  `,
        }).target,
      ),
    ).toBe(SLO_ID.toString());
  });

  /*
   * The exact messages are what a public page shows in place of the widget,
   * and they say four DIFFERENT things.
   */
  it("says what is missing in each refusal", () => {
    expect(PUBLIC_SLO_WIDGET_NOT_CONFIGURED_MESSAGE).toBe(
      "This dashboard widget has no Service Level Objective selected.",
    );
    expect(PUBLIC_SLO_WIDGET_NO_SELECTION_MESSAGE).toContain("toolbar");
    expect(PUBLIC_SLO_WIDGET_MULTIPLE_SELECTION_MESSAGE).toContain("single");
    expect(PUBLIC_SLO_WIDGET_VARIABLE_MISSING_MESSAGE).toContain("variable");
  });
});
