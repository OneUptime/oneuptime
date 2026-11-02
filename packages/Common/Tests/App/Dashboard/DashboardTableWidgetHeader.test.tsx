import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock } from "jest-mock";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import DashboardTableComponentElement, {
  DASHBOARD_TABLE_CONTROLS_TEST_ID,
  DASHBOARD_TABLE_HEADER_TEST_ID,
  DASHBOARD_TABLE_TITLE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTableComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import DashboardTableComponent, {
  TableColumnKind,
} from "../../../Types/Dashboard/DashboardComponents/DashboardTableComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

/*
 * A metric table's header line on the dashboard: its title (and
 * description) and its controls, the row search and the row count.
 *
 * On a phone the board shows its widgets one under another, each the
 * screen's width (Common/Utils/Dashboard/DashboardBoardLayout, the #5284
 * follow-up), and a table is that narrow. The header was one line that
 * never wrapped, its controls never shrinking: beside the 14rem search
 * the title was squeezed to nothing and its description to one word a
 * line. The header wraps now: the title keeps 10rem before the controls
 * move under it, at its start, and the search narrows with a widget
 * narrower than itself. jsdom lays nothing out, so this pins the classes
 * that do it; DashboardTableThresholds' browser suite measures them, at
 * 1280 and on a phone.
 */

type FetchResults = (data: unknown) => Promise<Array<AggregatedResult>>;

const fetchResultsMock: Mock<FetchResults> = jest.fn<FetchResults>();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (data: unknown) => {
          return fetchResultsMock(data);
        },
      },
    };
  },
);

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyErrorMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

const COMPONENT_ID: ObjectID = new ObjectID(
  "c0000000-0000-4000-8000-000000005284",
);

const DASHBOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-10-30T09:00:00.000Z"),
    new Date("2026-10-30T10:00:00.000Z"),
  ),
};

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 60,
};

const TITLE: string = "Host saturation";
const DESCRIPTION: string = "CPU, memory and disk, per host";

function point(host: string, value: number): AggregatedModel {
  return {
    timestamp: new Date("2026-10-30T09:30:00.000Z"),
    value,
    attributes: { "host.name": host },
  } as unknown as AggregatedModel;
}

function tableComponent(
  widgetArguments: JSONObject = {},
): DashboardTableComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.Table,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 12,
    heightInDashboardUnits: 6,
    minWidthInDashboardUnits: 4,
    minHeightInDashboardUnits: 3,
    arguments: {
      columns: [
        {
          id: "cpu",
          variable: "a",
          header: "CPU",
          kind: TableColumnKind.Metric,
          metricName: "system.cpu.utilization",
          aggregation: MetricsAggregationType.Avg,
        },
      ],
      groupByAttributes: [{ key: "host.name", header: "Host" }],
      maxRows: 25,
      ...widgetArguments,
    } as DashboardTableComponent["arguments"],
  };
}

function props(
  component: DashboardTableComponent,
): DashboardBaseComponentProps & {
  component: DashboardTableComponent;
} {
  return {
    componentId: COMPONENT_ID,
    isEditMode: false,
    isSelected: false,
    key: "table-widget",
    onComponentUpdate: (): void => {},
    // A phone's stacked board: the widget is the screen's width.
    totalCurrentDashboardWidthInPx: 358,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 358,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 400,
    dashboardComponentWidthInPx: 358,
    dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
    dashboardStartAndEndDate: DASHBOARD_RANGE,
    metricTypes: [],
    refreshTick: 0,
    dashboardId: "d0000000-0000-4000-8000-000000005284",
    component: component,
  };
}

function classesOf(testId: string): Array<string> {
  return screen.getByTestId(testId).className.split(/\s+/);
}

async function renderTable(widgetArguments: JSONObject): Promise<void> {
  render(
    <DashboardTableComponentElement
      {...props(tableComponent(widgetArguments))}
    />,
  );

  await screen.findByText("web-1");
}

beforeEach(() => {
  fetchResultsMock.mockReset();
  fetchResultsMock.mockResolvedValue([
    {
      data: [point("web-1", 0.42), point("db-1", 0.8)],
    } as AggregatedResult,
  ]);
});

afterEach(() => {
  cleanup();
});

describe("a metric table's header line", () => {
  test("the title, then the controls: the row search and the count", async () => {
    await renderTable({ tableTitle: TITLE, tableDescription: DESCRIPTION });

    const header: HTMLElement = screen.getByTestId(
      DASHBOARD_TABLE_HEADER_TEST_ID,
    );
    const title: HTMLElement = screen.getByTestId(
      DASHBOARD_TABLE_TITLE_TEST_ID,
    );
    const controls: HTMLElement = screen.getByTestId(
      DASHBOARD_TABLE_CONTROLS_TEST_ID,
    );

    expect(Array.from(header.children)).toEqual([title, controls]);
    expect(title).toHaveTextContent(TITLE);
    expect(title).toHaveTextContent(DESCRIPTION);
    expect(
      controls.contains(screen.getByRole("textbox", { name: "Search rows" })),
    ).toBe(true);
    expect(controls).toHaveTextContent("2 rows");
  });

  test("wraps: the controls move under the title when both do not fit, at its start", async () => {
    await renderTable({ tableTitle: TITLE, tableDescription: DESCRIPTION });

    const header: Array<string> = classesOf(DASHBOARD_TABLE_HEADER_TEST_ID);

    expect(header).toEqual(
      expect.arrayContaining([
        "flex",
        "flex-wrap",
        // Beside the title they sit at the line's end; alone, at its start.
        "justify-between",
        "gap-x-3",
        "gap-y-2",
      ]),
    );
  });

  test("the title keeps 10rem of its line before the controls give way to it", async () => {
    await renderTable({ tableTitle: TITLE, tableDescription: DESCRIPTION });

    expect(classesOf(DASHBOARD_TABLE_TITLE_TEST_ID)).toEqual(
      expect.arrayContaining(["min-w-0", "flex-1", "basis-40"]),
    );
  });

  test("the controls narrow with a widget narrower than they are, the search with them", async () => {
    await renderTable({ tableTitle: TITLE, tableDescription: DESCRIPTION });

    const controls: Array<string> = classesOf(DASHBOARD_TABLE_CONTROLS_TEST_ID);

    expect(controls).toEqual(expect.arrayContaining(["min-w-0", "max-w-full"]));
    expect(controls).not.toContain("flex-shrink-0");
    expect(controls).not.toContain("shrink-0");

    const search: HTMLElement = screen.getByRole("textbox", {
      name: "Search rows",
    }).parentElement as HTMLElement;

    expect(search.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["min-w-0", "w-56", "max-w-full"]),
    );
  });

  test("with no title and no description, the controls keep the whole line", async () => {
    await renderTable({});

    const title: HTMLElement = screen.getByTestId(
      DASHBOARD_TABLE_TITLE_TEST_ID,
    );

    // Nothing in it, so it holds no room for words that are not there.
    expect(title).toBeEmptyDOMElement();
    expect(title.className.split(/\s+/)).not.toContain("basis-40");
    expect(
      screen.getByTestId(DASHBOARD_TABLE_CONTROLS_TEST_ID),
    ).toHaveTextContent("2 rows");
  });

  test("a title alone keeps its 10rem too", async () => {
    await renderTable({ tableTitle: TITLE });

    expect(classesOf(DASHBOARD_TABLE_TITLE_TEST_ID)).toContain("basis-40");
    expect(screen.getByRole("heading", { name: TITLE })).toHaveClass(
      "truncate",
    );
  });
});
