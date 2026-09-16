import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * SloHistoryCharts is the former Charts page body, now mounted both as the
 * Metrics page's Error Budget History tab and on the legacy Charts route. What
 * moved with it is real logic - three SloHistory aggregates, the SLO's own
 * thresholds as reference lines, Decimal coercion, empty and error states -
 * and one thing changed: the SLO id now arrives as a prop instead of from the
 * URL. These tests render the real component with the data layer and the
 * chart library replaced by recorders, and assert what it asks for and what it
 * hands the charts.
 */

const SLO_ID_STRING: string = "0193c0de-5555-4aaa-8bbb-000000000005";
const PROJECT_ID_STRING: string = "10000000-0000-4000-8000-000000000001";

const aggregateMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const lineChartMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factory runs.
 */
jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<unknown>) => {
        return aggregateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown) => {
        return (
          ((error as { message?: unknown } | null)?.message as string) ||
          "Could not load"
        );
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (props: { data: Array<{ seriesName: string }> }) => {
      lineChartMock(props);
      return <div data-testid={`line-chart-${props.data[0]?.seriesName}`} />;
    },
  };
});

jest.mock("../../../UI/Components/Card/Card", () => {
  return {
    __esModule: true,
    default: (props: {
      title?: string;
      rightElement?: React.ReactNode;
      children?: React.ReactNode;
    }) => {
      return (
        <section data-testid="card" aria-label={props.title}>
          {props.rightElement}
          {props.children}
        </section>
      );
    },
  };
});

jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="range-picker" />;
    },
  };
});

jest.mock("../../../UI/Components/ComponentLoader/ComponentLoader", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="component-loader" />;
    },
  };
});

jest.mock("../../../UI/Components/EmptyState/EmptyState", () => {
  return {
    __esModule: true,
    default: (props: { title?: string }) => {
      return <div data-testid="empty-state">{props.title}</div>;
    },
  };
});

jest.mock("../../../UI/Components/ErrorMessage/ErrorMessage", () => {
  return {
    __esModule: true,
    default: (props: { message: string }) => {
      return <div data-testid="error-message">{props.message}</div>;
    },
  };
});

import SloHistoryCharts from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloHistoryCharts";
import SloHistory from "../../../Models/AnalyticsModels/SloHistory";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import { DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE } from "../../../Utils/Slo/SloHealth";

interface AggregateCall {
  modelType: unknown;
  aggregateBy: {
    query: {
      projectId: ObjectID;
      sloId: ObjectID;
      metricName: string;
      bucketStart: unknown;
    };
    aggregationType: AggregationType;
    aggregateColumnName: string;
    aggregationTimestampColumnName: string;
    sort: Record<string, SortOrder>;
  };
}

interface ReferenceLine {
  value: number;
  label?: string;
  color: string;
}

interface LineChartProps {
  data: Array<{ seriesName: string; data: Array<{ x: Date; y: number }> }>;
  referenceLines?: Array<ReferenceLine> | undefined;
  syncid?: string;
}

type HistoryRow = { timestamp: string | null; value: string | number };

function makeSlo(input: {
  targetPercentage?: number;
  atRiskThresholdPercentage?: number;
}): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();

  if (input.targetPercentage !== undefined) {
    slo.targetPercentage = input.targetPercentage;
  }

  if (input.atRiskThresholdPercentage !== undefined) {
    slo.atRiskThresholdPercentage = input.atRiskThresholdPercentage;
  }

  return slo;
}

function makeRule(
  name: string,
  burnRateThreshold: number | undefined,
): ServiceLevelObjectiveBurnRateRule {
  const rule: ServiceLevelObjectiveBurnRateRule =
    new ServiceLevelObjectiveBurnRateRule();
  rule.name = name;

  if (burnRateThreshold !== undefined) {
    rule.burnRateThreshold = burnRateThreshold;
  }

  return rule;
}

function stubHistory(
  rowsByMetricName: Record<string, Array<HistoryRow>>,
): void {
  aggregateMock.mockImplementation((args: unknown) => {
    const metricName: string = (args as AggregateCall).aggregateBy.query
      .metricName;

    return Promise.resolve({ data: rowsByMetricName[metricName] || [] });
  });
}

function aggregateCalls(): Array<AggregateCall> {
  return aggregateMock.mock.calls.map((args: Array<unknown>): AggregateCall => {
    return args[0] as AggregateCall;
  });
}

function lastChartProps(seriesName: string): LineChartProps {
  const calls: Array<LineChartProps> = lineChartMock.mock.calls
    .map((args: Array<unknown>): LineChartProps => {
      return args[0] as LineChartProps;
    })
    .filter((props: LineChartProps): boolean => {
      return props.data[0]?.seriesName === seriesName;
    });

  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]!;
}

const FULL_HISTORY: Record<string, Array<HistoryRow>> = {
  "sli.percent": [
    // ClickHouse Decimals can arrive as strings.
    { timestamp: "2026-09-14T00:00:00.000Z", value: "99.95" },
    { timestamp: "2026-09-14T01:00:00.000Z", value: 99.9 },
    // Neither of these is a point.
    { timestamp: null, value: 99 },
    { timestamp: "2026-09-14T02:00:00.000Z", value: "not-a-number" },
  ],
  "error.budget.remaining.percent": [
    { timestamp: "2026-09-14T00:00:00.000Z", value: "42.5" },
  ],
  "burn.rate": [{ timestamp: "2026-09-14T00:00:00.000Z", value: "3.2" }],
};

describe("SloHistoryCharts", () => {
  beforeEach(() => {
    stubHistory(FULL_HISTORY);
    getItemMock.mockResolvedValue(
      makeSlo({ targetPercentage: 99.9, atRiskThresholdPercentage: 25 }),
    );
    getListMock.mockResolvedValue({
      data: [
        makeRule("Fast burn", 14.4),
        makeRule("Unset threshold", undefined),
      ],
      count: 2,
      skip: 0,
      limit: 10000,
    });
  });

  afterEach(() => {
    cleanup();
    aggregateMock.mockReset();
    getItemMock.mockReset();
    getListMock.mockReset();
    lineChartMock.mockReset();
  });

  async function renderCharts(): Promise<void> {
    render(<SloHistoryCharts sloId={new ObjectID(SLO_ID_STRING)} />);

    await waitFor(() => {
      expect(screen.getByTestId("line-chart-Burn Rate")).toBeInTheDocument();
    });
  }

  test("queries SloHistory for the SLO it is GIVEN, one server-side aggregate per series, oldest first", async () => {
    await renderCharts();

    const calls: Array<AggregateCall> = aggregateCalls();

    expect(
      calls
        .map((call: AggregateCall): string => {
          return call.aggregateBy.query.metricName;
        })
        .sort(),
    ).toEqual(
      ["burn.rate", "error.budget.remaining.percent", "sli.percent"].sort(),
    );

    for (const call of calls) {
      expect(call.modelType).toBe(SloHistory);
      expect(call.aggregateBy.query.sloId.toString()).toBe(SLO_ID_STRING);
      expect(call.aggregateBy.query.projectId.toString()).toBe(
        PROJECT_ID_STRING,
      );
      expect(call.aggregateBy.query.bucketStart).toBeInstanceOf(InBetween);
      expect(call.aggregateBy.aggregationType).toBe(AggregationType.Avg);
      expect(call.aggregateBy.aggregateColumnName).toBe("value");
      expect(call.aggregateBy.aggregationTimestampColumnName).toBe(
        "bucketStart",
      );
      expect(call.aggregateBy.sort).toEqual({
        bucketStart: SortOrder.Ascending,
      });
    }
  });

  test("reads this SLO's thresholds and only its ENABLED burn rate rules", async () => {
    await renderCharts();

    const itemArgs: { id: ObjectID; select: Record<string, boolean> } =
      getItemMock.mock.calls[0]![0] as {
        id: ObjectID;
        select: Record<string, boolean>;
      };

    expect(itemArgs.id.toString()).toBe(SLO_ID_STRING);
    expect(itemArgs.select).toEqual({
      targetPercentage: true,
      atRiskThresholdPercentage: true,
    });

    const listArgs: {
      query: { serviceLevelObjectiveId: ObjectID; isEnabled: boolean };
    } = getListMock.mock.calls[0]![0] as {
      query: { serviceLevelObjectiveId: ObjectID; isEnabled: boolean };
    };

    expect(listArgs.query.serviceLevelObjectiveId.toString()).toBe(
      SLO_ID_STRING,
    );
    expect(listArgs.query.isEnabled).toBe(true);
  });

  test("draws the target over the SLI, both budget boundaries, and every enabled rule's threshold", async () => {
    await renderCharts();

    expect(lastChartProps("SLI %").referenceLines).toEqual([
      expect.objectContaining({ value: 99.9, label: "Target 99.9%" }),
    ]);

    expect(
      (lastChartProps("Budget Remaining %").referenceLines || []).map(
        (line: ReferenceLine): number => {
          return line.value;
        },
      ),
    ).toEqual([0, 25]);

    // A rule with no threshold draws nothing rather than a line at 0.
    expect(lastChartProps("Burn Rate").referenceLines).toEqual([
      expect.objectContaining({ value: 14.4, label: "Fast burn 14.4×" }),
    ]);
  });

  test("falls back to the default at-risk line when the SLO has no threshold of its own", async () => {
    getItemMock.mockResolvedValue(makeSlo({ targetPercentage: 99 }));

    await renderCharts();

    expect(
      (lastChartProps("Budget Remaining %").referenceLines || []).map(
        (line: ReferenceLine): number => {
          return line.value;
        },
      ),
    ).toEqual([0, DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE]);
  });

  test("coerces Decimal strings and skips rows without a timestamp or a finite value", async () => {
    await renderCharts();

    const points: Array<{ x: Date; y: number }> =
      lastChartProps("SLI %").data[0]!.data;

    expect(
      points.map((point: { y: number }): number => {
        return point.y;
      }),
    ).toEqual([99.95, 99.9]);
    expect(points[0]!.x).toBeInstanceOf(Date);
  });

  test("syncs all three charts' cursors under one id scoped to this SLO", async () => {
    await renderCharts();

    for (const seriesName of ["SLI %", "Budget Remaining %", "Burn Rate"]) {
      expect(lastChartProps(seriesName).syncid).toBe(
        `slo-charts-${SLO_ID_STRING}`,
      );
    }
  });

  test("shows an empty state per chart when the range holds no history", async () => {
    stubHistory({});

    render(<SloHistoryCharts sloId={new ObjectID(SLO_ID_STRING)} />);

    await waitFor(() => {
      expect(screen.getAllByTestId("empty-state")).toHaveLength(3);
    });

    expect(screen.queryByTestId("line-chart-SLI %")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("empty-state")[0]).toHaveTextContent(
      "No history in this range",
    );
  });

  test("keeps the cards and the range picker on screen when loading fails, with the error above them", async () => {
    getItemMock.mockRejectedValue(new Error("history unavailable"));

    render(<SloHistoryCharts sloId={new ObjectID(SLO_ID_STRING)} />);

    const error: HTMLElement = await screen.findByTestId("error-message");

    expect(error).toHaveTextContent("history unavailable");
    expect(screen.getByTestId("range-picker")).toBeInTheDocument();
    expect(screen.getAllByTestId("card")).toHaveLength(3);
    expect(
      error.compareDocumentPosition(screen.getAllByTestId("card")[0]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("a parent re-rendering with a fresh ObjectID for the same SLO does not refetch", async () => {
    const { rerender } = render(
      <SloHistoryCharts sloId={new ObjectID(SLO_ID_STRING)} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("line-chart-Burn Rate")).toBeInTheDocument();
    });

    const callsBefore: number = aggregateMock.mock.calls.length;

    rerender(<SloHistoryCharts sloId={new ObjectID(SLO_ID_STRING)} />);
    rerender(<SloHistoryCharts sloId={new ObjectID(SLO_ID_STRING)} />);

    expect(aggregateMock.mock.calls.length).toBe(callsBefore);
  });
});
