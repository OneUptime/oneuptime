import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * The y-axis of a database's engine charts, against what the UI
 * re-verification read off them:
 *
 *   - whole-number counts drawn with fractional ticks: Databases
 *     "0 | 0.5 | 1 | 1.5 | 2", Nodes "0 | 0.25 | 0.5 | 0.75 | 1", SQL
 *     Server User connections "0 | 0.5 | …", Mongo Connections
 *     "0 | 0.75 | 1.5 | 2.25 | 3";
 *   - an idle Memcached's all-zero "Memory used" drawn over
 *     "0.0 B | 1.0 B | 2.0 B | 3.0 B | 4.0 B";
 *   - Redis's "COMMANDS PER SECOND (OPS/S)", the rate said twice.
 *
 * The charts render for real down to the chart library, which is replaced
 * by a marker that records the axis it was asked for (recharts itself
 * draws integer ticks for allowDecimals=false, and ticks 0 and 1 for the
 * fixed 0-1 domain).
 */

interface LibraryChartProps {
  categories: Array<string>;
  allowDecimals?: boolean;
  minValue?: number;
  maxValue?: number;
  valueFormatter?: (value: number) => string;
}

const libraryChartMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();
const getListAnalyticsMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../UI/Components/Charts/ChartLibrary/LineChart/LineChart",
  () => {
    return {
      __esModule: true,
      // Recorded as given; chartFor reads them back as LibraryChartProps.
      LineChart: (props: Record<string, unknown>) => {
        libraryChartMock(props);
        return <div data-testid="library-line-chart" />;
      },
    };
  },
);

// The arrow wrappers are load bearing: jest.mock is hoisted above the mocks.
jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<unknown>) => {
        return aggregateMock(...args);
      },
      getList: (...args: Array<unknown>) => {
        return getListAnalyticsMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Components/Modal/Modal", () => {
  return {
    __esModule: true,
    ModalWidth: { Normal: 0, Medium: 1, Large: 2 },
    default: (props: { children?: React.ReactNode }) => {
      return <section role="dialog">{props.children}</section>;
    },
  };
});

jest.mock(
  "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="time-range-picker" />;
      },
    };
  },
);

import DatabaseEngineMetricsSection, {
  getDatabaseEngineMetricChartTitle,
  getDatabaseEngineMetricChartYAxis,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseEngineMetricsSection";
import DatabaseMetricChartModal from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseMetricChartModal";
import ChartCard from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ChartCard";
import {
  DatabaseEngineMetricResult,
  DatabaseTimePoint,
  toEngineMetricResult,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerTelemetryQueries";
import {
  DatabaseEngineMetricsStatus,
  formatDatabaseMetricAxisValue,
  getDatabaseChartYAxis,
  isDatabaseMetricUnitWholeNumber,
  isDatabaseMetricWholeNumberUnit,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerPresentation";
import {
  DatabaseServerMetricDefinition,
  findDatabaseServerMetricByName,
} from "../../../Types/DatabaseServer/DatabaseServerMetricCatalog";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";

const MODEL_ID: ObjectID = new ObjectID("84858d6c-1111-4aaa-8bbb-000000000001");
const START: Date = new Date("2026-09-25T01:00:00.000Z");

function at(minute: number): Date {
  return new Date(START.getTime() + minute * 60 * 1000);
}

function metric(system: string, name: string): DatabaseServerMetricDefinition {
  const definition: DatabaseServerMetricDefinition | null | undefined =
    findDatabaseServerMetricByName(system, name);
  if (!definition) {
    throw new Error(`${system} has no catalog entry ${name}`);
  }
  return definition;
}

function steady(value: number): Array<DatabaseTimePoint> {
  return [0, 1, 2, 3].map((minute: number): DatabaseTimePoint => {
    return { x: at(minute), y: value };
  });
}

// What the chart library was last asked to draw for a series.
function chartFor(seriesName: string): LibraryChartProps {
  const calls: Array<LibraryChartProps> = libraryChartMock.mock.calls
    .map((call: Array<unknown>): LibraryChartProps => {
      return call[0] as LibraryChartProps;
    })
    .filter((props: LibraryChartProps): boolean => {
      return props.categories[0] === seriesName;
    });
  if (calls.length === 0) {
    throw new Error(`No chart was drawn for "${seriesName}".`);
  }
  return calls[calls.length - 1]!;
}

beforeEach(() => {
  libraryChartMock.mockReset();
  aggregateMock.mockReset();
  getListAnalyticsMock.mockReset();
  getListAnalyticsMock.mockResolvedValue({ data: [], count: 0 });
  goTo(`/dashboard/${PROJECT_ID}/databases/${MODEL_ID.toString()}`);
});

afterEach(() => {
  cleanup();
});

describe("which engine charts count whole things", () => {
  test("the counts the re-verification saw with fractional ticks, and bytes", () => {
    for (const [system, name] of [
      ["postgresql", "postgresql.database.count"],
      ["elasticsearch", "elasticsearch.cluster.nodes"],
      ["microsoft.sql_server", "sqlserver.user.connection.count"],
      ["mongodb", "mongodb.connection.count"],
      ["memcached", "memcached.bytes"],
      ["mysql", "mysql.buffer_pool.pages"],
    ] as Array<[string, string]>) {
      const definition: DatabaseServerMetricDefinition = metric(system, name);
      expect([
        name,
        isDatabaseMetricWholeNumberUnit(definition.unit, definition.kind),
      ]).toEqual([name, true]);
    }
  });

  test("rates, shares, ratios and durations keep their decimals", () => {
    for (const [system, name] of [
      ["redis", "redis.commands"],
      ["redis", "redis.memory.fragmentation_ratio"],
      ["oracle.db", "oracledb.tablespace.utilization"],
      ["microsoft.sql_server", "sqlserver.page.buffer_cache.hit_ratio"],
      ["postgresql", "postgresql.wal.age"],
      ["postgresql", "postgresql.commits"],
    ] as Array<[string, string]>) {
      const definition: DatabaseServerMetricDefinition = metric(system, name);
      expect([
        name,
        isDatabaseMetricWholeNumberUnit(definition.unit, definition.kind),
      ]).toEqual([name, false]);
    }
    // A counter is charted as a per-second rate, whatever it counts.
    expect(isDatabaseMetricWholeNumberUnit("connections", "counter")).toBe(
      false,
    );
    expect(isDatabaseMetricWholeNumberUnit("seconds", "gauge")).toBe(false);
    expect(isDatabaseMetricWholeNumberUnit("ms", "gauge")).toBe(false);
    expect(isDatabaseMetricWholeNumberUnit("", "gauge")).toBe(false);
  });

  test("outside the catalog, a count annotation read as it is", () => {
    const plain: { isRate: boolean; isDistribution: boolean } = {
      isRate: false,
      isDistribution: false,
    };
    expect(isDatabaseMetricUnitWholeNumber("{connections}", plain)).toBe(true);
    expect(
      isDatabaseMetricUnitWholeNumber("{connections}", {
        ...plain,
        isRate: true,
      }),
    ).toBe(false);
    expect(
      isDatabaseMetricUnitWholeNumber("{requests}", {
        ...plain,
        isDistribution: true,
      }),
    ).toBe(false);
    expect(isDatabaseMetricUnitWholeNumber("s", plain)).toBe(false);
    expect(isDatabaseMetricUnitWholeNumber("1", plain)).toBe(false);
    expect(isDatabaseMetricUnitWholeNumber(undefined, plain)).toBe(false);
  });
});

describe("getDatabaseChartYAxis", () => {
  test("a count gets whole-number ticks, the rest keep decimals; both fit the data", () => {
    expect(getDatabaseChartYAxis([2, 2, 1.5], true)).toEqual({
      yMax: undefined,
      allowDecimals: false,
    });
    expect(getDatabaseChartYAxis([0.2, 0.4], false)).toEqual({
      yMax: undefined,
      allowDecimals: true,
    });
  });

  test("a series at 0 throughout is drawn on 0 to 1, not spread over 0-4", () => {
    for (const wholeNumbers of [true, false]) {
      expect(getDatabaseChartYAxis([0, 0, 0], wholeNumbers)).toEqual({
        yMax: 1,
        allowDecimals: false,
      });
    }
    // Gaps do not make a series non-zero; one non-zero value does.
    expect(getDatabaseChartYAxis([0, NaN, 0], true).yMax).toBe(1);
    expect(getDatabaseChartYAxis([0, 0, 3], true).yMax).toBeUndefined();
    // No points: nothing is drawn, and nothing is fixed.
    expect(getDatabaseChartYAxis([], true).yMax).toBeUndefined();
  });

  test("its two ticks read '0 B' and '1 B', not '0.0 B' and '1.0 B'", () => {
    expect(formatDatabaseMetricAxisValue(0, "bytes")).toBe("0 B");
    expect(formatDatabaseMetricAxisValue(1, "bytes")).toBe("1 B");
    expect(formatDatabaseMetricAxisValue(5 * 1024 ** 3, "bytes")).toBe("5 GiB");
    expect(formatDatabaseMetricAxisValue(1536, "bytes")).toBe("1.5 KiB");
    expect(formatDatabaseMetricAxisValue(134217728, "bytes")).toBe("128 MiB");
  });
});

describe("engine chart titles", () => {
  test("'Commands per second' in ops/s does not say the rate twice", () => {
    expect(
      getDatabaseEngineMetricChartTitle(metric("redis", "redis.commands")),
    ).toBe("Commands per second");
    // A gauge whose title does not say it still gets its unit.
    expect(
      getDatabaseEngineMetricChartTitle({
        title: "Commands",
        unit: "ops/s",
        kind: "gauge",
      }),
    ).toBe("Commands (ops/s)");
    expect(
      getDatabaseEngineMetricChartTitle(
        metric("elasticsearch", "elasticsearch.cluster.nodes"),
      ),
    ).toBe("Nodes");
  });
});

describe("the Overview's engine charts", () => {
  function renderSection(results: Array<DatabaseEngineMetricResult>): void {
    render(
      <MemoryRouter>
        <DatabaseEngineMetricsSection
          modelId={MODEL_ID}
          engineLabel="Engine"
          status={DatabaseEngineMetricsStatus.Connected}
          hasCatalog={true}
          dbSystem="postgresql"
          results={results}
          isLoading={false}
          windowStart={at(0)}
          windowEnd={at(4)}
        />
      </MemoryRouter>,
    );
  }

  test("counts draw whole-number ticks, an all-zero chart 0 to 1, a rate its decimals", () => {
    const databases: DatabaseServerMetricDefinition = metric(
      "postgresql",
      "postgresql.database.count",
    );
    const nodes: DatabaseServerMetricDefinition = metric(
      "elasticsearch",
      "elasticsearch.cluster.nodes",
    );
    const memory: DatabaseServerMetricDefinition = metric(
      "memcached",
      "memcached.bytes",
    );
    const commits: DatabaseServerMetricDefinition = metric(
      "postgresql",
      "postgresql.commits",
    );

    renderSection([
      toEngineMetricResult(databases, steady(2)),
      toEngineMetricResult(nodes, steady(1)),
      toEngineMetricResult(memory, steady(0)),
      toEngineMetricResult(commits, steady(0.4)),
    ]);

    expect(chartFor(databases.title).allowDecimals).toBe(false);
    expect(chartFor(databases.title).maxValue).toBeUndefined();
    expect(chartFor(nodes.title).allowDecimals).toBe(false);

    expect(chartFor(memory.title).allowDecimals).toBe(false);
    expect(chartFor(memory.title).minValue).toBe(0);
    expect(chartFor(memory.title).maxValue).toBe(1);
    expect(chartFor(memory.title).valueFormatter!(1)).toBe("1 B");

    expect(chartFor(commits.title).allowDecimals).toBe(true);
    expect(chartFor(commits.title).maxValue).toBeUndefined();

    expect(
      getDatabaseEngineMetricChartYAxis(
        toEngineMetricResult(memory, steady(0)),
      ),
    ).toEqual({ yMax: 1, allowDecimals: false });
  });
});

describe("the Metrics tab's chart of one metric", () => {
  function renderModal(metricName: string, dbSystem: string): void {
    render(
      <MemoryRouter>
        <DatabaseMetricChartModal
          metricName={metricName}
          keys={["0123456789abcdef"]}
          projectId={PROJECT_ID}
          dbSystem={dbSystem}
          databaseServerId={MODEL_ID}
          initialTimeRange={{ range: TimeRange.PAST_ONE_HOUR }}
          onClose={(): void => {}}
        />
      </MemoryRouter>,
    );
  }

  function serveGauge(value: number): void {
    aggregateMock.mockResolvedValue({
      data: [0, 1, 2].map((minute: number) => {
        return { timestamp: at(minute), value: value };
      }),
    });
  }

  test("a curated count draws whole-number ticks", async () => {
    serveGauge(2);
    const databases: DatabaseServerMetricDefinition = metric(
      "postgresql",
      "postgresql.database.count",
    );

    renderModal("postgresql.database.count", "postgresql");

    await waitFor(() => {
      expect(chartFor(databases.title).allowDecimals).toBe(false);
    });
    expect(chartFor(databases.title).maxValue).toBeUndefined();
  });

  test("an idle Memcached's memory is drawn on 0 to 1", async () => {
    serveGauge(0);
    const memory: DatabaseServerMetricDefinition = metric(
      "memcached",
      "memcached.bytes",
    );

    renderModal("memcached.bytes", "memcached");

    await waitFor(() => {
      expect(chartFor(memory.title).maxValue).toBe(1);
    });
    expect(chartFor(memory.title).allowDecimals).toBe(false);
  });
});

describe("ChartCard, shared with every other product", () => {
  test("without yAllowDecimals the axis keeps its decimal ticks, as before", () => {
    render(
      <ChartCard
        title="Requests"
        icon={IconProp.ChartBar}
        iconColor="blue"
        series={[{ seriesName: "Requests", data: steady(0.5) }]}
        windowStart={at(0)}
        windowEnd={at(4)}
        syncId="service"
      />,
    );

    expect(chartFor("Requests").allowDecimals).toBe(true);
    expect(chartFor("Requests").maxValue).toBeUndefined();
  });
});
