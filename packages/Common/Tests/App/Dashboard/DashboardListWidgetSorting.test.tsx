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
import React, { act } from "react";
import {
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import DashboardMonitorListComponentElement, {
  ComponentProps as MonitorListProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardMonitorListComponent";
import DashboardIncidentListComponentElement, {
  ComponentProps as IncidentListProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardIncidentListComponent";
import DashboardKubernetesPodListComponentElement, {
  ComponentProps as PodListProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardKubernetesPodListComponent";
import DashboardProxmoxNodeListComponentElement, {
  ComponentProps as ProxmoxNodeListProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardProxmoxNodeListComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import { DASHBOARD_LIST_TABLE_CLASS_NAME } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardResourceListBase";
import {
  DASHBOARD_WIDGET_SORT_ARROW_TEST_ID,
  getDashboardWidgetSortHeaderTestId,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetSortCopy";
import {
  PublicDashboardContext,
  setPublicDashboardContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import DashboardMonitorListComponentUtil from "../../../Utils/Dashboard/Components/DashboardMonitorListComponent";
import DashboardIncidentListComponentUtil from "../../../Utils/Dashboard/Components/DashboardIncidentListComponent";
import DashboardKubernetesPodListComponentUtil from "../../../Utils/Dashboard/Components/DashboardKubernetesPodListComponent";
import DashboardProxmoxNodeListComponentUtil from "../../../Utils/Dashboard/Components/DashboardProxmoxNodeListComponent";
import { KUBERNETES_POD_PHASE_RANKS } from "../../../Utils/Dashboard/DashboardWidgetSorts";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import URL from "../../../Types/API/URL";

/*
 * Click-to-sort on the dashboard's list widgets (issue #5082), read through
 * the real widgets: their headers, the reads they send, and what a viewer's
 * pick leaves in the browser.
 *
 *   - Every column the server can order the whole list by is a header that
 *     sorts; the one the rows are in says so (aria-sort, an arrow, a hint).
 *   - A click sorts the column worst / newest / highest / A to Z first,
 *     then the other way, then back to the widget's own order.
 *   - The database orders the whole list: the read's `sort` changes, never
 *     the rows already fetched. A status kept as a word (a pod's phase) is
 *     read rank by rank, worst rank first, until the widget has its rows.
 *   - The pick is kept per widget per dashboard in the browser, so a
 *     refresh keeps it; the widget's own (saved) sort comes next.
 *   - On a public dashboard only the pick travels, as `widgetSort`.
 */

type ListRequest = {
  query: JSONObject;
  limit: number;
  skip: number;
  select: JSONObject;
  sort: JSONObject;
  requestOptions?:
    | {
        overrideRequestUrl?: URL | undefined;
        additionalRequestBody?: JSONObject | undefined;
      }
    | undefined;
};

type ListResponse = { data: Array<JSONObject>; count: number };

const listMock: Mock<(request: ListRequest) => Promise<ListResponse>> =
  jest.fn<(request: ListRequest) => Promise<ListResponse>>();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (request: ListRequest) => {
        return listMock(request);
      },
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return PROJECT_ID;
      },
    },
  };
});

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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: { children: React.ReactNode }) => {
        return <span>{props.children}</span>;
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap", () => {
  return {
    __esModule: true,
    default: {},
    RouteUtil: {
      populateRouteParams: () => {
        return {
          toString: () => {
            return "/resource";
          },
        };
      },
    },
  };
});

const DASHBOARD_ID: string = "d0000000-0000-4000-8000-000000000001";
const OTHER_DASHBOARD_ID: string = "d0000000-0000-4000-8000-000000000002";
// Stands in for the public dashboard's API class; ModelAPI is mocked here.
const PUBLIC_API_CLIENT: PublicDashboardContext["apiClient"] =
  {} as unknown as PublicDashboardContext["apiClient"];

const ASC: SortOrder = SortOrder.Ascending;
const DESC: SortOrder = SortOrder.Descending;
const DESC_NULLS_LAST: JSONObject = { direction: DESC, nulls: "LAST" };

const dashboardViewConfig: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 12,
};

function baseProps(componentId: ObjectID): Omit<
  DashboardBaseComponentProps,
  "componentId"
> & {
  componentId: ObjectID;
} {
  return {
    componentId,
    key: componentId.toString(),
    isEditMode: false,
    isSelected: false,
    onComponentUpdate: () => {},
    totalCurrentDashboardWidthInPx: 1200,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1200,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 320,
    dashboardComponentWidthInPx: 480,
    dashboardViewConfig,
    dashboardStartAndEndDate: { range: TimeRange.PAST_ONE_HOUR },
    metricTypes: [],
    refreshTick: 0,
    variables: [],
    dashboardId: DASHBOARD_ID,
  };
}

function monitorListProps(
  widgetArguments: JSONObject = {},
  overrides: Partial<MonitorListProps> = {},
): MonitorListProps {
  const component: MonitorListProps["component"] =
    DashboardMonitorListComponentUtil.getDefaultComponent();
  component.arguments = {
    title: "Monitors",
    maxRows: 25,
    ...widgetArguments,
  } as MonitorListProps["component"]["arguments"];

  return {
    ...baseProps(component.componentId),
    component,
    ...overrides,
  };
}

function pickKey(componentId: ObjectID, dashboardId: string): string {
  return `oneuptime-dashboard-widget-sort-${componentId.toString()}:${dashboardId}`;
}

function monitor(name: string, status: string, type: string): JSONObject {
  return {
    _id: ObjectID.generate().toString(),
    name,
    monitorType: type,
    currentMonitorStatus: { name: status, color: undefined },
  } as unknown as JSONObject;
}

const MONITORS: Array<JSONObject> = [
  monitor("api", "Operational", "API"),
  monitor("checkout", "Offline", "Website"),
  monitor("search", "Degraded", "API"),
];

function lastRequest(): ListRequest {
  const calls: Array<[ListRequest]> = listMock.mock.calls;
  const last: [ListRequest] | undefined = calls[calls.length - 1];

  if (!last) {
    throw new Error("The widget read nothing.");
  }

  return last[0];
}

function headerCell(columnKey: string): HTMLElement {
  return screen
    .getByTestId(getDashboardWidgetSortHeaderTestId(columnKey))
    .closest("th") as HTMLElement;
}

function sortButton(columnKey: string): HTMLElement {
  return screen.getByTestId(getDashboardWidgetSortHeaderTestId(columnKey));
}

async function clickHeader(
  columnKey: string,
  expectedReads: number,
): Promise<void> {
  fireEvent.click(sortButton(columnKey));

  await waitFor(() => {
    expect(listMock).toHaveBeenCalledTimes(expectedReads);
  });
}

beforeEach(() => {
  listMock.mockReset();
  listMock.mockResolvedValue({ data: MONITORS, count: MONITORS.length });
  window.localStorage.clear();
  setPublicDashboardContext(null);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  setPublicDashboardContext(null);
});

describe("a monitor list's column headers", () => {
  test("every column sorts, and the one the rows are in says so", async () => {
    render(<DashboardMonitorListComponentElement {...monitorListProps()} />);

    expect(await screen.findByText("checkout")).toBeInTheDocument();

    // Built in: by name, A to Z.
    expect(headerCell("name")).toHaveAttribute("aria-sort", "ascending");
    expect(headerCell("status")).toHaveAttribute("aria-sort", "none");
    expect(headerCell("type")).toHaveAttribute("aria-sort", "none");

    expect(sortButton("name")).toHaveAttribute("title", "Sorted: A to Z");
    expect(sortButton("status")).toHaveAttribute("title", "Sort: Worst first");
    expect(sortButton("type")).toHaveAttribute("title", "Sort: A to Z");

    // One arrow: on the column the rows are in.
    expect(
      screen.getAllByTestId(DASHBOARD_WIDGET_SORT_ARROW_TEST_ID),
    ).toHaveLength(1);
    expect(
      within(sortButton("name")).getByTestId(
        DASHBOARD_WIDGET_SORT_ARROW_TEST_ID,
      ),
    ).toBeInTheDocument();

    // The headers keep their words and are real buttons.
    expect(screen.getByRole("button", { name: "Status" })).toBe(
      sortButton("status"),
    );
  });

  test("the first read is by name, and reads the status's priority a Status sort orders by", async () => {
    render(<DashboardMonitorListComponentElement {...monitorListProps()} />);

    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(1);
    });

    expect(lastRequest().sort).toEqual({ name: ASC });
    expect(lastRequest().select).toEqual({
      _id: true,
      name: true,
      monitorType: true,
      currentMonitorStatus: { name: true, color: true, priority: true },
    });
    expect(lastRequest().limit).toBe(25);
  });

  test("Status sorts worst first, then best first, then back to by name - each a new read of the whole list", async () => {
    const props: MonitorListProps = monitorListProps();
    render(<DashboardMonitorListComponentElement {...props} />);
    await screen.findByText("checkout");

    // Worst first: the highest priority (Offline) on top, nameless last.
    await clickHeader("status", 2);
    expect(lastRequest().sort).toEqual({
      currentMonitorStatus: { priority: DESC_NULLS_LAST },
      name: ASC,
    });
    expect(lastRequest().limit).toBe(25);
    await waitFor(() => {
      expect(headerCell("status")).toHaveAttribute("aria-sort", "descending");
    });
    expect(headerCell("name")).toHaveAttribute("aria-sort", "none");
    expect(sortButton("status")).toHaveAttribute(
      "title",
      "Sorted: Worst first",
    );
    expect(
      window.localStorage.getItem(pickKey(props.componentId, DASHBOARD_ID)),
    ).toBe("status:desc");

    // Best first.
    await clickHeader("status", 3);
    expect(lastRequest().sort).toEqual({
      currentMonitorStatus: { priority: ASC },
      name: ASC,
    });
    await waitFor(() => {
      expect(headerCell("status")).toHaveAttribute("aria-sort", "ascending");
    });
    expect(sortButton("status")).toHaveAttribute("title", "Sorted: Best first");
    expect(
      window.localStorage.getItem(pickKey(props.componentId, DASHBOARD_ID)),
    ).toBe("status:asc");

    // Back to the widget's own order, and the pick is forgotten.
    await clickHeader("status", 4);
    expect(lastRequest().sort).toEqual({ name: ASC });
    await waitFor(() => {
      expect(headerCell("name")).toHaveAttribute("aria-sort", "ascending");
    });
    expect(headerCell("status")).toHaveAttribute("aria-sort", "none");
    expect(
      window.localStorage.getItem(pickKey(props.componentId, DASHBOARD_ID)),
    ).toBeNull();
  });

  test("the column the widget is sorted by goes the other way, then back", async () => {
    const props: MonitorListProps = monitorListProps();
    render(<DashboardMonitorListComponentElement {...props} />);
    await screen.findByText("checkout");

    await clickHeader("name", 2);
    expect(lastRequest().sort).toEqual({ name: DESC_NULLS_LAST });
    await waitFor(() => {
      expect(headerCell("name")).toHaveAttribute("aria-sort", "descending");
    });
    expect(sortButton("name")).toHaveAttribute("title", "Sorted: Z to A");

    await clickHeader("name", 3);
    expect(lastRequest().sort).toEqual({ name: ASC });
    expect(
      window.localStorage.getItem(pickKey(props.componentId, DASHBOARD_ID)),
    ).toBeNull();
  });

  test("a text column sorts A to Z first", async () => {
    render(<DashboardMonitorListComponentElement {...monitorListProps()} />);
    await screen.findByText("checkout");

    await clickHeader("type", 2);
    expect(lastRequest().sort).toEqual({ monitorType: ASC, name: ASC });

    await clickHeader("type", 3);
    expect(lastRequest().sort).toEqual({
      monitorType: DESC_NULLS_LAST,
      name: ASC,
    });
  });

  test("a refresh keeps the viewer's pick: it is read before the first read", async () => {
    const props: MonitorListProps = monitorListProps();
    window.localStorage.setItem(
      pickKey(props.componentId, DASHBOARD_ID),
      "status:desc",
    );

    render(<DashboardMonitorListComponentElement {...props} />);
    await screen.findByText("checkout");

    expect(listMock).toHaveBeenCalledTimes(1);
    expect(lastRequest().sort).toEqual({
      currentMonitorStatus: { priority: DESC_NULLS_LAST },
      name: ASC,
    });
    expect(headerCell("status")).toHaveAttribute("aria-sort", "descending");
  });

  test("the pick is the viewer's for this widget on this dashboard only", async () => {
    const props: MonitorListProps = monitorListProps();
    window.localStorage.setItem(
      pickKey(props.componentId, OTHER_DASHBOARD_ID),
      "status:desc",
    );
    window.localStorage.setItem(
      pickKey(ObjectID.generate(), DASHBOARD_ID),
      "type:desc",
    );

    render(<DashboardMonitorListComponentElement {...props} />);

    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(1);
    });
    expect(lastRequest().sort).toEqual({ name: ASC });
  });

  test("a remembered pick naming a column the widget does not have is not used", async () => {
    const props: MonitorListProps = monitorListProps();
    window.localStorage.setItem(
      pickKey(props.componentId, DASHBOARD_ID),
      "severity:desc",
    );

    render(<DashboardMonitorListComponentElement {...props} />);
    await screen.findByText("checkout");

    expect(listMock).toHaveBeenCalledTimes(1);
    expect(lastRequest().sort).toEqual({ name: ASC });
    expect(headerCell("name")).toHaveAttribute("aria-sort", "ascending");
  });

  test("the widget's saved sort is its order; going back from a pick returns to it", async () => {
    const props: MonitorListProps = monitorListProps({ sort: "status:desc" });
    render(<DashboardMonitorListComponentElement {...props} />);
    await screen.findByText("checkout");

    expect(listMock).toHaveBeenCalledTimes(1);
    expect(lastRequest().sort).toEqual({
      currentMonitorStatus: { priority: DESC_NULLS_LAST },
      name: ASC,
    });
    expect(headerCell("status")).toHaveAttribute("aria-sort", "descending");
    expect(sortButton("status")).toHaveAttribute(
      "title",
      "Sorted: Worst first",
    );

    // The other way is the viewer's own.
    await clickHeader("status", 2);
    expect(lastRequest().sort).toEqual({
      currentMonitorStatus: { priority: ASC },
      name: ASC,
    });
    expect(
      window.localStorage.getItem(pickKey(props.componentId, DASHBOARD_ID)),
    ).toBe("status:asc");

    // Then back to the saved sort, which is not kept as a pick.
    await clickHeader("status", 3);
    expect(lastRequest().sort).toEqual({
      currentMonitorStatus: { priority: DESC_NULLS_LAST },
      name: ASC,
    });
    expect(
      window.localStorage.getItem(pickKey(props.componentId, DASHBOARD_ID)),
    ).toBeNull();
  });

  test("a saved sort naming a column the widget does not have keeps the order it always had", async () => {
    render(
      <DashboardMonitorListComponentElement
        {...monitorListProps({ sort: "uptime:desc" })}
      />,
    );

    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(1);
    });
    expect(lastRequest().sort).toEqual({ name: ASC });
  });

  test("an editor saving a new sort moves the viewer off their pick", async () => {
    const props: MonitorListProps = monitorListProps();
    const view: RenderResult = render(
      <DashboardMonitorListComponentElement {...props} />,
    );
    await screen.findByText("checkout");

    await clickHeader("type", 2);
    expect(
      window.localStorage.getItem(pickKey(props.componentId, DASHBOARD_ID)),
    ).toBe("type:asc");

    const saved: MonitorListProps = monitorListProps(
      { sort: "status:desc" },
      { component: { ...props.component } },
    );
    saved.component.arguments = {
      ...props.component.arguments,
      sort: "status:desc",
    } as MonitorListProps["component"]["arguments"];

    view.rerender(
      <DashboardMonitorListComponentElement
        {...props}
        component={saved.component}
      />,
    );

    await waitFor(() => {
      expect(lastRequest().sort).toEqual({
        currentMonitorStatus: { priority: DESC_NULLS_LAST },
        name: ASC,
      });
    });
    expect(
      window.localStorage.getItem(pickKey(props.componentId, DASHBOARD_ID)),
    ).toBeNull();
    await waitFor(() => {
      expect(headerCell("status")).toHaveAttribute("aria-sort", "descending");
    });
  });

  test("a header click is the header's, not the card's", async () => {
    const onCardClick: Mock<() => void> = jest.fn<() => void>();

    render(
      <div onClick={onCardClick}>
        <DashboardMonitorListComponentElement {...monitorListProps()} />
      </div>,
    );
    await screen.findByText("checkout");

    await clickHeader("status", 2);
    expect(onCardClick).not.toHaveBeenCalled();
  });

  test("a slower read for the order the viewer left cannot replace the one they picked", async () => {
    render(<DashboardMonitorListComponentElement {...monitorListProps()} />);
    await screen.findByText("checkout");

    let resolveByStatus: (response: ListResponse) => void = () => {};
    listMock.mockImplementationOnce(() => {
      return new Promise<ListResponse>(
        (resolve: (response: ListResponse) => void) => {
          resolveByStatus = resolve;
        },
      );
    });
    listMock.mockResolvedValueOnce({
      data: [monitor("zeta", "Offline", "API")],
      count: 1,
    });

    // Worst first (slow), then best first (answered at once).
    await clickHeader("status", 2);
    await clickHeader("status", 3);
    expect(await screen.findByText("zeta")).toBeInTheDocument();

    await act(async () => {
      resolveByStatus({ data: [monitor("stale", "Offline", "API")], count: 1 });
    });

    expect(screen.queryByText("stale")).not.toBeInTheDocument();
    expect(screen.getByText("zeta")).toBeInTheDocument();
  });

  test("a honeycomb has no headers, and is laid out in the widget's own sort", async () => {
    render(
      <DashboardMonitorListComponentElement
        {...monitorListProps({ viewMode: "honeycomb", sort: "status:desc" })}
      />,
    );

    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(1);
    });
    expect(lastRequest().sort).toEqual({
      currentMonitorStatus: { priority: DESC_NULLS_LAST },
      name: ASC,
    });
    expect(
      screen.queryByTestId(getDashboardWidgetSortHeaderTestId("status")),
    ).not.toBeInTheDocument();
  });

  test("with no dashboard to keep it for, a pick still sorts but is not kept", async () => {
    render(
      <DashboardMonitorListComponentElement
        {...monitorListProps({}, { dashboardId: undefined })}
      />,
    );
    await screen.findByText("checkout");

    await clickHeader("status", 2);
    expect(lastRequest().sort).toEqual({
      currentMonitorStatus: { priority: DESC_NULLS_LAST },
      name: ASC,
    });
    expect(window.localStorage.length).toBe(0);
  });
});

describe("a monitor list on a public dashboard", () => {
  beforeEach(() => {
    setPublicDashboardContext({
      dashboardId: new ObjectID(DASHBOARD_ID),
      apiUrl: URL.fromString("https://dev.oneuptime.com/public-dashboard-api"),
      postJSON: async () => {
        throw new Error("Unexpected public request");
      },
      apiClient: PUBLIC_API_CLIENT,
    });
  });

  test("sends only the viewer's pick, as widgetSort, and nothing once they go back", async () => {
    const props: MonitorListProps = monitorListProps();
    render(<DashboardMonitorListComponentElement {...props} />);
    await screen.findByText("checkout");

    expect(lastRequest().requestOptions?.additionalRequestBody).toEqual({
      componentId: props.componentId.toString(),
      variables: [],
    });

    await clickHeader("status", 2);
    expect(lastRequest().requestOptions?.overrideRequestUrl?.toString()).toBe(
      `https://dev.oneuptime.com/public-dashboard-api/resource-list/${DASHBOARD_ID}/monitor`,
    );
    expect(lastRequest().requestOptions?.additionalRequestBody).toEqual({
      componentId: props.componentId.toString(),
      variables: [],
      widgetSort: "status:desc",
    });

    await clickHeader("status", 3);
    expect(
      lastRequest().requestOptions?.additionalRequestBody?.["widgetSort"],
    ).toBe("status:asc");

    await clickHeader("status", 4);
    expect(lastRequest().requestOptions?.additionalRequestBody).toEqual({
      componentId: props.componentId.toString(),
      variables: [],
    });
  });

  test("the widget's own saved sort is not sent: the server reads it from the stored widget", async () => {
    const props: MonitorListProps = monitorListProps({ sort: "status:desc" });
    render(<DashboardMonitorListComponentElement {...props} />);
    await screen.findByText("checkout");

    expect(listMock).toHaveBeenCalledTimes(1);
    expect(
      lastRequest().requestOptions?.additionalRequestBody?.["widgetSort"],
    ).toBeUndefined();
    expect(headerCell("status")).toHaveAttribute("aria-sort", "descending");
  });

  test("a remembered pick travels with the first read", async () => {
    const props: MonitorListProps = monitorListProps();
    window.localStorage.setItem(
      pickKey(props.componentId, DASHBOARD_ID),
      "type:desc",
    );

    render(<DashboardMonitorListComponentElement {...props} />);

    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(1);
    });
    expect(
      lastRequest().requestOptions?.additionalRequestBody?.["widgetSort"],
    ).toBe("type:desc");
  });
});

describe("an incident list's severity and state", () => {
  function incidentListProps(
    widgetArguments: JSONObject = {},
  ): IncidentListProps {
    const component: IncidentListProps["component"] =
      DashboardIncidentListComponentUtil.getDefaultComponent();
    component.arguments = {
      title: "Incidents",
      maxRows: 10,
      ...widgetArguments,
    } as IncidentListProps["component"]["arguments"];

    return {
      ...baseProps(component.componentId),
      component,
    };
  }

  beforeEach(() => {
    listMock.mockResolvedValue({
      data: [
        {
          _id: ObjectID.generate().toString(),
          title: "Checkout is down",
          createdAt: new Date("2026-10-19T10:00:00.000Z"),
          currentIncidentState: { name: "Identified" },
          incidentSeverity: { name: "Critical" },
        } as unknown as JSONObject,
      ],
      count: 1,
    });
  });

  test("newest first is the order it always had, and both orders it ranks by are read", async () => {
    render(<DashboardIncidentListComponentElement {...incidentListProps()} />);
    await screen.findByText("Checkout is down");

    expect(lastRequest().sort).toEqual({ createdAt: DESC });
    expect(lastRequest().select).toMatchObject({
      currentIncidentState: { name: true, color: true, order: true },
      incidentSeverity: { name: true, color: true, order: true },
    });
    expect(headerCell("declared")).toHaveAttribute("aria-sort", "descending");
    expect(sortButton("declared")).toHaveAttribute(
      "title",
      "Sorted: Newest first",
    );
  });

  /*
   * At 6 units an incident's long title, drawn whole on its line, made the
   * table wider than the widget: the rows scrolled sideways, and Declared -
   * the column the rows are in, its arrow - was out of sight. A cell that
   * ends its words in ... gives its text's width up, keeping 6rem.
   */
  test("its table fits its widget: a title that ends in ... gives way, keeping 6rem", async () => {
    render(<DashboardIncidentListComponentElement {...incidentListProps()} />);
    const title: HTMLElement = await screen.findByText("Checkout is down");

    const table: HTMLElement = title.closest("table") as HTMLElement;
    expect(table.className).toBe(DASHBOARD_LIST_TABLE_CLASS_NAME);
    expect(DASHBOARD_LIST_TABLE_CLASS_NAME.split(" ")).toEqual([
      "w-full",
      "text-sm",
      "text-left",
      "[&_td.truncate]:max-w-0",
      "[&_td.truncate]:min-w-[6rem]",
    ]);

    // The title's cell is one that ends its words in ...
    const cell: HTMLElement = title.closest("td") as HTMLElement;
    expect(cell).toHaveClass("truncate");
    // ...and Declared is its last column, the one its arrow is on.
    const headers: Array<HTMLElement> = Array.from(
      table.querySelectorAll("thead th"),
    );
    expect(headers[headers.length - 1]).toBe(headerCell("declared"));
  });

  test("Severity sorts the project's worst severity first - the lowest order - then the other way", async () => {
    render(<DashboardIncidentListComponentElement {...incidentListProps()} />);
    await screen.findByText("Checkout is down");

    await clickHeader("severity", 2);
    expect(lastRequest().sort).toEqual({
      incidentSeverity: { order: ASC },
      createdAt: DESC,
    });

    await clickHeader("severity", 3);
    expect(lastRequest().sort).toEqual({
      incidentSeverity: { order: DESC_NULLS_LAST },
      createdAt: DESC,
    });
  });

  test("State sorts by the project's state order, earliest (least handled) first", async () => {
    render(<DashboardIncidentListComponentElement {...incidentListProps()} />);
    await screen.findByText("Checkout is down");

    await clickHeader("state", 2);
    expect(lastRequest().sort).toEqual({
      currentIncidentState: { order: ASC },
      createdAt: DESC,
    });
  });

  test("Declared goes oldest first, then back to newest first", async () => {
    render(<DashboardIncidentListComponentElement {...incidentListProps()} />);
    await screen.findByText("Checkout is down");

    await clickHeader("declared", 2);
    expect(lastRequest().sort).toEqual({ createdAt: ASC });
    expect(sortButton("declared")).toHaveAttribute(
      "title",
      "Sorted: Oldest first",
    );

    await clickHeader("declared", 3);
    expect(lastRequest().sort).toEqual({ createdAt: DESC });
  });
});

describe("a pod list's phase, read rank by rank", () => {
  function podListProps(widgetArguments: JSONObject = {}): PodListProps {
    const component: PodListProps["component"] =
      DashboardKubernetesPodListComponentUtil.getDefaultComponent();
    component.arguments = {
      title: "Pods",
      maxRows: 3,
      ...widgetArguments,
    } as PodListProps["component"]["arguments"];

    return {
      ...baseProps(component.componentId),
      component,
    };
  }

  function pod(name: string, phase: string): JSONObject {
    return {
      _id: ObjectID.generate().toString(),
      name,
      namespaceKey: "shop",
      phase,
      kubernetesCluster: { name: "prod" },
    } as unknown as JSONObject;
  }

  const PODS_BY_PHASE: Record<string, Array<JSONObject>> = {
    Failed: [pod("crashing", "Failed")],
    Unknown: [],
    Pending: [pod("waiting-1", "Pending"), pod("waiting-2", "Pending")],
    Running: [pod("web-1", "Running"), pod("web-2", "Running")],
  };

  function phasesOf(request: ListRequest): string | null {
    const phase: unknown = request.query["phase"];

    if (phase instanceof Includes) {
      return (phase.values as Array<string>).join("+");
    }

    if (phase instanceof IncludesNone) {
      return "other";
    }

    if (phase instanceof IsNull) {
      return "none";
    }

    return null;
  }

  beforeEach(() => {
    listMock.mockImplementation(
      async (request: ListRequest): Promise<ListResponse> => {
        const phase: unknown = request.query["phase"];
        let rows: Array<JSONObject> = [];

        if (phase instanceof Includes) {
          for (const value of phase.values as Array<string>) {
            rows = rows.concat(PODS_BY_PHASE[value] || []);
          }
        } else if (phase === undefined) {
          rows = [...PODS_BY_PHASE["Running"]!, ...PODS_BY_PHASE["Pending"]!];
        }

        return {
          data: rows.slice(0, request.limit),
          count: rows.length,
        };
      },
    );
  });

  test("the list keeps its namespace-then-name order until a viewer sorts it", async () => {
    render(<DashboardKubernetesPodListComponentElement {...podListProps()} />);
    await screen.findByText("web-1");

    expect(listMock).toHaveBeenCalledTimes(1);
    expect(lastRequest().sort).toEqual({ namespaceKey: ASC, name: ASC });
    expect(headerCell("namespace")).toHaveAttribute("aria-sort", "ascending");
    expect(sortButton("phase")).toHaveAttribute("title", "Sort: Worst first");
  });

  test("worst first reads Failed, then Unknown, then Pending - and stops once the widget is full", async () => {
    render(<DashboardKubernetesPodListComponentElement {...podListProps()} />);
    await screen.findByText("web-1");
    listMock.mockClear();

    fireEvent.click(sortButton("phase"));
    expect(await screen.findByText("crashing")).toBeInTheDocument();
    await screen.findByText("waiting-2");

    const reads: Array<ListRequest> = listMock.mock.calls.map(
      (call: [ListRequest]): ListRequest => {
        return call[0];
      },
    );

    expect(reads.map(phasesOf)).toEqual(["Failed", "Unknown", "Pending"]);
    // Each read asks only for the rows still wanted.
    expect(
      reads.map((read: ListRequest): number => {
        return read.limit;
      }),
    ).toEqual([3, 2, 2]);
    // Within a rank, the list's own order.
    for (const read of reads) {
      expect(read.sort).toEqual({ namespaceKey: ASC, name: ASC });
      expect(read.query["kind"]).toBe("Pod");
    }

    const names: Array<string> = Array.from(
      document.querySelectorAll("tbody tr td:first-child"),
    ).map((cell: Element): string => {
      return (cell.textContent || "").trim();
    });
    expect(names).toEqual(["crashing", "waiting-1", "waiting-2"]);
    expect(headerCell("phase")).toHaveAttribute("aria-sort", "descending");
  });

  test("best first reads the healthy phases first, and pods with no known phase still last", async () => {
    render(
      <DashboardKubernetesPodListComponentElement
        {...podListProps({ maxRows: 50 })}
      />,
    );
    await screen.findByText("web-1");

    // Worst first: every rank, and the rest.
    fireEvent.click(sortButton("phase"));
    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(1 + 6);
    });
    await screen.findByText("crashing");
    listMock.mockClear();

    fireEvent.click(sortButton("phase"));
    await waitFor(() => {
      expect(headerCell("phase")).toHaveAttribute("aria-sort", "ascending");
    });
    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(6);
    });

    expect(
      listMock.mock.calls.map((call: [ListRequest]): string | null => {
        return phasesOf(call[0]);
      }),
    ).toEqual([
      [...KUBERNETES_POD_PHASE_RANKS].reverse()[0]!.join("+"),
      "Pending",
      "Unknown",
      "Failed",
      "other",
      "none",
    ]);
  });

  test("a rank read the viewer's next click replaced reads no further ranks", async () => {
    render(
      <DashboardKubernetesPodListComponentElement
        {...podListProps({ maxRows: 50 })}
      />,
    );
    await screen.findByText("web-1");

    let releaseFailed: (response: ListResponse) => void = () => {};
    listMock.mockImplementationOnce(() => {
      return new Promise<ListResponse>(
        (resolve: (response: ListResponse) => void) => {
          releaseFailed = resolve;
        },
      );
    });

    // Worst first: its first rank's read hangs.
    fireEvent.click(sortButton("phase"));
    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(2);
    });

    // Best first replaces it, and reads its six steps.
    fireEvent.click(sortButton("phase"));
    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(2 + 6);
    });
    await screen.findByText("waiting-1");

    await act(async () => {
      releaseFailed({ data: [pod("replaced", "Failed")], count: 1 });
    });

    // The replaced read stopped where it was, and drew nothing.
    expect(listMock).toHaveBeenCalledTimes(2 + 6);
    expect(screen.queryByText("replaced")).not.toBeInTheDocument();
    expect(headerCell("phase")).toHaveAttribute("aria-sort", "ascending");
  });

  test("the widget's own phase filter narrows the ranks it reads", async () => {
    render(
      <DashboardKubernetesPodListComponentElement
        {...podListProps({ podPhases: ["Pending", "Failed"], maxRows: 50 })}
      />,
    );
    await screen.findByText("waiting-1");
    listMock.mockClear();

    fireEvent.click(sortButton("phase"));
    await screen.findByText("crashing");
    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(2);
    });

    expect(
      listMock.mock.calls.map((call: [ListRequest]): string | null => {
        return phasesOf(call[0]);
      }),
    ).toEqual(["Failed", "Pending"]);
  });

  test("on a public dashboard one read carries the pick: the server reads the ranks itself", async () => {
    setPublicDashboardContext({
      dashboardId: new ObjectID(DASHBOARD_ID),
      apiUrl: URL.fromString("https://dev.oneuptime.com/public-dashboard-api"),
      postJSON: async () => {
        throw new Error("Unexpected public request");
      },
      apiClient: PUBLIC_API_CLIENT,
    });

    render(<DashboardKubernetesPodListComponentElement {...podListProps()} />);
    await screen.findByText("web-1");
    listMock.mockClear();

    fireEvent.click(sortButton("phase"));
    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(1);
    });

    expect(lastRequest().query["phase"]).toBeUndefined();
    expect(
      lastRequest().requestOptions?.additionalRequestBody?.["widgetSort"],
    ).toBe("phase:desc");
  });
});

describe("an up or down flag (a Proxmox node's status)", () => {
  function proxmoxNodeListProps(): ProxmoxNodeListProps {
    const component: ProxmoxNodeListProps["component"] =
      DashboardProxmoxNodeListComponentUtil.getDefaultComponent();
    component.arguments = {
      title: "Nodes",
      maxRows: 10,
    } as ProxmoxNodeListProps["component"]["arguments"];

    return {
      ...baseProps(component.componentId),
      component,
    };
  }

  beforeEach(() => {
    listMock.mockResolvedValue({
      data: [
        {
          _id: ObjectID.generate().toString(),
          name: "pve-1",
          isUp: false,
          proxmoxCluster: { name: "lab" },
        } as unknown as JSONObject,
      ],
      count: 1,
    });
  });

  test("worst first puts the nodes that are down first, and nodes that never said last", async () => {
    render(
      <DashboardProxmoxNodeListComponentElement {...proxmoxNodeListProps()} />,
    );
    await screen.findByText("pve-1");

    await clickHeader("status", 2);
    expect(lastRequest().sort).toEqual({ isUp: ASC, name: ASC });

    await clickHeader("status", 3);
    expect(lastRequest().sort).toEqual({
      isUp: DESC_NULLS_LAST,
      name: ASC,
    });
  });

  test("a number sorts highest first, keeping nodes with no reading last", async () => {
    render(
      <DashboardProxmoxNodeListComponentElement {...proxmoxNodeListProps()} />,
    );
    await screen.findByText("pve-1");

    await clickHeader("cpu", 2);
    expect(lastRequest().sort).toEqual({
      latestCpuPercent: DESC_NULLS_LAST,
      name: ASC,
    });
    expect(sortButton("cpu")).toHaveAttribute("title", "Sorted: Highest first");

    await clickHeader("cpu", 3);
    expect(lastRequest().sort).toEqual({ latestCpuPercent: ASC, name: ASC });
    expect(sortButton("cpu")).toHaveAttribute("title", "Sorted: Lowest first");
  });
});
