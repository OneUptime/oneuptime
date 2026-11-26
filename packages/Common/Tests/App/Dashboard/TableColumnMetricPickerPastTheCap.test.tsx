import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import CappedListServer, {
  CappedListCall,
  namesSortingFirst,
} from "./CappedListServer";
import TableColumnsEditor, {
  getTableColumnMetricOptions,
  getTableColumnMetricPickerTestId,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/TableColumnsEditor";
import { METRIC_TYPE_SEARCH_LIMIT } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricTypeSearch";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import Includes from "../../../Types/BaseDatabase/Includes";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import {
  TableColumn,
  TableColumnKind,
} from "../../../Types/Dashboard/DashboardComponents/DashboardTableComponent";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import ObjectID from "../../../Types/ObjectID";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";

/*
 * A DASHBOARD TABLE'S METRIC COLUMN, PAST THE PROJECT'S FIRST 10,000 METRIC
 * TYPES (#10764).
 *
 * A table widget's column picker offered the board's metric types - the
 * project's first 10,000 by name - as a fixed list: a metric past them could
 * be charted (the query picker searches) but not picked as a column, and a
 * column holding a metric no list had showed "Pick a metric", as if it held
 * none. Each column's picker searches the server as it is typed in, keeps
 * what it holds named, and knows its unit. On a fake project of 10,050
 * metric types and one past them (CappedListServer), as the list route
 * answers.
 */

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

// Sorts after all 10,050 below, so past the board's list.
const LATE_METRIC: string = "zz.kiosk.requests";
const LATE_METRIC_UNIT: string = "req/s";
// Another past the list, found by another search.
const OTHER_LATE_METRIC: string = "zz.warehouse.picks";

// A metric a column was saved with that the project sends no more.
const GONE_METRIC: string = "retired.queue.depth";

const METRICS_BEFORE_IT: number = LIMIT_PER_PROJECT + 50;

let server: CappedListServer;

// What the board read: the project's first 10,000 by name, without them.
let boardMetricTypes: Array<MetricType>;

beforeAll(() => {
  const names: Array<string> = namesSortingFirst(METRICS_BEFORE_IT, "k8s.a");

  server = new CappedListServer();
  server.add(
    MetricType,
    names.map((name: string): Record<string, unknown> => {
      return { _id: ObjectID.generate().toString(), name: name, unit: "1" };
    }),
  );
  server.add(MetricType, [
    {
      _id: ObjectID.generate().toString(),
      name: LATE_METRIC,
      unit: LATE_METRIC_UNIT,
      isMonotonic: true,
    },
    {
      _id: ObjectID.generate().toString(),
      name: OTHER_LATE_METRIC,
      unit: "By",
    },
  ]);

  boardMetricTypes = names
    .slice(0, LIMIT_PER_PROJECT)
    .map((name: string): MetricType => {
      const metricType: MetricType = new MetricType();
      metricType.name = name;
      metricType.unit = "1";
      return metricType;
    });
});

beforeEach(() => {
  server.calls.length = 0;
  server.install();
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function metricColumn(overrides: Partial<TableColumn>): TableColumn {
  return {
    id: "requests",
    variable: "a",
    header: "Requests",
    kind: TableColumnKind.Metric,
    metricName: undefined,
    aggregation: MetricsAggregationType.Sum,
    showAsColumn: true,
    ...overrides,
  };
}

let saved: Array<Array<TableColumn>>;

// The widget's columns, kept by the test the way ArgumentsForm keeps them.
function EditorHarness(props: { initial: Array<TableColumn> }): ReactElement {
  const [columns, setColumns] = useState<Array<TableColumn>>(props.initial);

  return (
    <TableColumnsEditor
      columns={columns}
      metricTypes={boardMetricTypes}
      onChange={(next: Array<TableColumn>): void => {
        saved.push(next);
        setColumns(next);
      }}
    />
  );
}

function picker(columnId: string): HTMLElement {
  return screen.getByTestId(getTableColumnMetricPickerTestId(columnId));
}

async function typeInPicker(columnId: string, text: string): Promise<void> {
  await act(async () => {
    fireEvent.change(within(picker(columnId)).getByRole("combobox"), {
      target: { value: text },
    });
  });
}

async function pickOption(name: string): Promise<void> {
  const option: HTMLElement = await screen.findByRole("option", { name });

  await act(async () => {
    fireEvent.mouseDown(option);
    fireEvent.click(option);
  });
}

// The searches the pickers sent for what was typed, in order.
function searches(): Array<string> {
  return server
    .callsFor(MetricType)
    .filter((call: CappedListCall): boolean => {
      return call.query["name"] instanceof Search;
    })
    .map((call: CappedListCall): string => {
      return (call.query["name"] as Search<string>).toString();
    });
}

// The names read by name (a held column's metric), in order.
function namesReadByName(): Array<string> {
  return server
    .callsFor(MetricType)
    .filter((call: CappedListCall): boolean => {
      return call.query["name"] instanceof Includes;
    })
    .flatMap((call: CappedListCall): Array<string> => {
      return (call.query["name"] as Includes).values.map(
        (value: unknown): string => {
          return String(value);
        },
      );
    });
}

function lastSaved(): Array<TableColumn> {
  expect(saved.length).toBeGreaterThan(0);
  return saved[saved.length - 1]!;
}

beforeEach(() => {
  saved = [];
});

describe("getTableColumnMetricOptions", () => {
  function names(options: Array<DropdownOption>): Array<string> {
    return options.map((option: DropdownOption): string => {
      return String(option.value);
    });
  }

  function metricTypeOf(name: string): MetricType {
    const metricType: MetricType = new MetricType();
    metricType.name = name;
    return metricType;
  }

  test("the board's metrics, then what the search found past them, then the column's - each once", () => {
    expect(
      names(
        getTableColumnMetricOptions({
          metricTypes: [metricTypeOf("a.one"), metricTypeOf("b.two")],
          found: [metricTypeOf("b.two"), metricTypeOf(LATE_METRIC)],
          metricName: LATE_METRIC,
        }),
      ),
    ).toEqual(["a.one", "b.two", LATE_METRIC]);
  });

  test("REGRESSION: a metric the column holds that no list has is still offered, so it is never shown as none", () => {
    const options: Array<DropdownOption> = getTableColumnMetricOptions({
      metricTypes: [metricTypeOf("a.one")],
      found: [],
      metricName: GONE_METRIC,
    });

    expect(names(options)).toEqual(["a.one", GONE_METRIC]);
    expect(options[1]!.label).toBe(GONE_METRIC);
  });

  test("a column with no metric adds nothing", () => {
    expect(
      names(
        getTableColumnMetricOptions({
          metricTypes: [metricTypeOf("a.one")],
          found: [],
          metricName: undefined,
        }),
      ),
    ).toEqual(["a.one"]);
  });
});

describe("a table widget's metric column picker", () => {
  test("REGRESSION: a metric past the board's first 10,000 is found on the server by what is typed, and picked as the column's metric", async () => {
    render(<EditorHarness initial={[metricColumn({})]} />);

    await typeInPicker("requests", "kiosk");

    await waitFor(() => {
      expect(searches()).toEqual(["kiosk"]);
    });

    const [call] = server
      .callsFor(MetricType)
      .filter((read: CappedListCall): boolean => {
        return read.query["name"] instanceof Search;
      });

    // 50 by name, from the server - never the whole list again.
    expect(call!.limit).toBe(METRIC_TYPE_SEARCH_LIMIT);
    expect(call!.sort).toEqual({ name: SortOrder.Ascending });

    await pickOption(LATE_METRIC);

    expect(lastSaved()[0]!.metricName).toBe(LATE_METRIC);
    expect(within(picker("requests")).getByText(LATE_METRIC)).toBeVisible();
  });

  test("the metric picked from the search keeps its unit - the column's thresholds are in it - without reading it again", async () => {
    render(
      <EditorHarness
        initial={[metricColumn({ thresholds: { warning: 100 } })]}
      />,
    );

    await typeInPicker("requests", "kiosk");
    await pickOption(LATE_METRIC);

    expect(
      screen.getByTestId("table-column-thresholds-warning-requests-unit"),
    ).toHaveTextContent(LATE_METRIC_UNIT);

    // Known from the search that found it: not read by its name as well.
    expect(namesReadByName()).toEqual([]);
  });

  test("REGRESSION: a column saved with a metric past the first 10,000 is named - never 'Pick a metric' - and its unit read by its name, once", async () => {
    render(
      <EditorHarness
        initial={[
          metricColumn({
            metricName: LATE_METRIC,
            thresholds: { warning: 100 },
          }),
        ]}
      />,
    );

    expect(within(picker("requests")).getByText(LATE_METRIC)).toBeVisible();
    expect(
      within(picker("requests")).queryByText("Pick a metric"),
    ).not.toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByTestId("table-column-thresholds-warning-requests-unit"),
      ).toHaveTextContent(LATE_METRIC_UNIT);
    });

    expect(namesReadByName()).toEqual([LATE_METRIC]);
    // Nothing was saved just by opening it.
    expect(saved).toEqual([]);
  });

  test("a column's metric the board's list has is not read again", async () => {
    render(
      <EditorHarness
        initial={[metricColumn({ metricName: boardMetricTypes[0]!.name })]}
      />,
    );

    expect(
      within(picker("requests")).getByText(boardMetricTypes[0]!.name!),
    ).toBeVisible();

    // Give a read the chance to go out: none does.
    await act(async () => {
      await Promise.resolve();
    });

    expect(server.callsFor(MetricType)).toEqual([]);
  });

  test("REGRESSION: a column saved with a metric the project sends no more is still named, and kept through the column's other edits", async () => {
    render(
      <EditorHarness initial={[metricColumn({ metricName: GONE_METRIC })]} />,
    );

    expect(within(picker("requests")).getByText(GONE_METRIC)).toBeVisible();

    // Read by its name once, and not found: it stays as it was saved.
    await waitFor(() => {
      expect(namesReadByName()).toEqual([GONE_METRIC]);
    });

    await act(async () => {
      fireEvent.change(screen.getByDisplayValue("Requests"), {
        target: { value: "Queue depth" },
      });
    });

    expect(lastSaved()[0]!.header).toBe("Queue depth");
    expect(lastSaved()[0]!.metricName).toBe(GONE_METRIC);
    expect(within(picker("requests")).getByText(GONE_METRIC)).toBeVisible();
    // Never asked for again as the board re-renders.
    expect(namesReadByName()).toEqual([GONE_METRIC]);
  });

  test("each column searches on its own: what is typed into one is not what another offers", async () => {
    render(
      <EditorHarness
        initial={[
          metricColumn({ id: "requests", variable: "a" }),
          metricColumn({ id: "picks", variable: "b", header: "Picks" }),
        ]}
      />,
    );

    await typeInPicker("requests", "kiosk");
    await pickOption(LATE_METRIC);

    await typeInPicker("picks", "warehouse");
    await pickOption(OTHER_LATE_METRIC);

    expect(
      lastSaved().map((column: TableColumn): string | undefined => {
        return column.metricName;
      }),
    ).toEqual([LATE_METRIC, OTHER_LATE_METRIC]);
    expect(searches()).toEqual(["kiosk", "warehouse"]);

    // Both stay named as the searches come and go.
    expect(within(picker("requests")).getByText(LATE_METRIC)).toBeVisible();
    expect(within(picker("picks")).getByText(OTHER_LATE_METRIC)).toBeVisible();
  });

  test("nothing is asked for an empty box, and a search that fails leaves the board's list offered", async () => {
    render(<EditorHarness initial={[metricColumn({})]} />);

    await typeInPicker("requests", "   ");

    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 400);
      });
    });

    expect(searches()).toEqual([]);

    jest.spyOn(server, "list").mockImplementation((): never => {
      throw new Error("Payment required");
    });

    await typeInPicker("requests", boardMetricTypes[1]!.name!);
    await pickOption(boardMetricTypes[1]!.name!);

    expect(lastSaved()[0]!.metricName).toBe(boardMetricTypes[1]!.name);
  });

  test("a metric picked past the first 10,000 survives the save: the board reopened names it, with its unit", async () => {
    render(
      <EditorHarness
        initial={[metricColumn({ thresholds: { warning: 100 } })]}
      />,
    );

    await typeInPicker("requests", "kiosk");
    await pickOption(LATE_METRIC);

    const savedColumns: Array<TableColumn> = JSON.parse(
      JSON.stringify(lastSaved()),
    ) as Array<TableColumn>;

    expect(savedColumns[0]!.metricName).toBe(LATE_METRIC);

    // The widget closed, and opened again from what was saved.
    cleanup();
    server.calls.length = 0;

    render(<EditorHarness initial={savedColumns} />);

    expect(within(picker("requests")).getByText(LATE_METRIC)).toBeVisible();

    await waitFor(() => {
      expect(
        screen.getByTestId("table-column-thresholds-warning-requests-unit"),
      ).toHaveTextContent(LATE_METRIC_UNIT);
    });

    expect(namesReadByName()).toEqual([LATE_METRIC]);
    expect(boardMetricTypes).toHaveLength(LIMIT_PER_PROJECT);
  });
});
