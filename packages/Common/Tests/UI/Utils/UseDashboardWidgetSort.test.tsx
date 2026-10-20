import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render } from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import useDashboardWidgetSort, {
  DashboardWidgetSortState,
  useReportDashboardWidgetSortColumns,
} from "../../../UI/Utils/UseDashboardWidgetSort";
import RememberedChoice from "../../../UI/Utils/RememberedChoice";
import {
  DashboardWidgetSortChoice,
  DashboardWidgetSortColumnInfo,
  DashboardWidgetSortColumns,
  DashboardWidgetSortDirection,
  DashboardWidgetSortKind,
} from "../../../Types/Dashboard/DashboardWidgetSort";

/*
 * useDashboardWidgetSort (Common/UI/Utils/UseDashboardWidgetSort.ts, issue
 * #5082): one list or table widget's order as one viewer has it, read
 * through a real component as every sortable widget reads it.
 *
 *   - The rows are in the viewer's own pick, else the widget's own sort (an
 *     editor's), else its built-in order.
 *   - A header click: the column's first direction, the other way, then
 *     back to the widget's own order - which forgets the pick.
 *   - The pick is remembered in the browser per widget and dashboard, so it
 *     is still there after a refresh, and nowhere else.
 *   - An editor changing the widget's own sort moves the viewer onto it.
 *   - In the settings' live preview, clicks set the widget's own sort.
 */

const DASHBOARD_ID: string = "db000000-0000-4000-8000-0000000000a1";
const OTHER_DASHBOARD_ID: string = "db000000-0000-4000-8000-0000000000b2";
const WIDGET_ID: string = "c0000000-0000-4000-8000-000000000001";
const OTHER_WIDGET_ID: string = "c0000000-0000-4000-8000-000000000002";

const PICK_KEY: string = `oneuptime-dashboard-widget-sort-${WIDGET_ID}:${DASHBOARD_ID}`;

const ASC: DashboardWidgetSortDirection = DashboardWidgetSortDirection.Ascending;
const DESC: DashboardWidgetSortDirection =
  DashboardWidgetSortDirection.Descending;

const COLUMNS: Array<DashboardWidgetSortColumnInfo> = [
  { key: "name", title: "Name", kind: DashboardWidgetSortKind.Text },
  { key: "status", title: "Status", kind: DashboardWidgetSortKind.Status },
  { key: "type", title: "Type", kind: DashboardWidgetSortKind.Text },
];

const BUILT_IN: DashboardWidgetSortChoice = { column: "name", direction: ASC };

interface ProbeProps {
  dashboardId?: string | undefined;
  componentId?: string | undefined;
  columns?: Array<DashboardWidgetSortColumnInfo> | undefined;
  areColumnsKnown?: boolean | undefined;
  savedSort?: unknown;
  builtInSort?: DashboardWidgetSortChoice | null | undefined;
  onSavedSortChange?: ((sort: string | null) => void) | undefined;
}

let latest: DashboardWidgetSortState | null = null;

const Probe: FunctionComponent<ProbeProps> = (
  props: ProbeProps,
): ReactElement => {
  const state: DashboardWidgetSortState = useDashboardWidgetSort({
    dashboardId:
      props.dashboardId === undefined ? DASHBOARD_ID : props.dashboardId,
    componentId: props.componentId || WIDGET_ID,
    columns: props.columns || COLUMNS,
    areColumnsKnown: props.areColumnsKnown,
    savedSort: props.savedSort,
    builtInSort: props.builtInSort === undefined ? BUILT_IN : props.builtInSort,
    onSavedSortChange: props.onSavedSortChange,
  });

  latest = state;

  return (
    <span data-testid="order">
      {state.sort ? `${state.sort.column}:${state.sort.direction}` : "none"}
    </span>
  );
};

function current(): DashboardWidgetSortState {
  if (!latest) {
    throw new Error("The probe has not rendered.");
  }

  return latest;
}

function click(columnKey: string): void {
  act(() => {
    current().onColumnClick(columnKey);
  });
}

function shown(): string {
  const sort: DashboardWidgetSortChoice | null = current().sort;
  return sort ? `${sort.column}:${sort.direction}` : "none";
}

beforeEach(() => {
  latest = null;
  window.localStorage.clear();
  RememberedChoice.clearHeldForThisPage();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  RememberedChoice.clearHeldForThisPage();
});

describe("the order a widget opens on", () => {
  test("its built-in order, when nobody chose one", () => {
    render(<Probe />);

    expect(shown()).toBe("name:asc");
    expect(current().widgetSort).toEqual(BUILT_IN);
    expect(current().viewerPick).toBeNull();
  });

  test("its own sort, an editor's, over the built-in one", () => {
    render(<Probe savedSort="status:desc" />);

    expect(shown()).toBe("status:desc");
    expect(current().widgetSort).toEqual({ column: "status", direction: DESC });
  });

  test("the viewer's remembered pick, over the widget's own sort", () => {
    window.localStorage.setItem(PICK_KEY, "type:desc");

    render(<Probe savedSort="status:desc" />);

    expect(shown()).toBe("type:desc");
    expect(current().viewerPick).toEqual({ column: "type", direction: DESC });
  });

  test("a saved sort or a pick naming a column the widget no longer has is read as none", () => {
    window.localStorage.setItem(PICK_KEY, "uptime:desc");

    render(<Probe savedSort="severity:desc" />);

    expect(shown()).toBe("name:asc");
    expect(current().viewerPick).toBeNull();
  });

  test("a widget with no order of its own shows none until someone picks one", () => {
    render(<Probe builtInSort={null} />);

    expect(shown()).toBe("none");
  });

  test("before a widget's columns are known, its saved sort and pick wait unchecked", () => {
    window.localStorage.setItem(PICK_KEY, "revenue:desc");

    render(
      <Probe
        columns={[]}
        areColumnsKnown={false}
        builtInSort={null}
        savedSort="region:asc"
      />,
    );

    expect(shown()).toBe("revenue:desc");
    expect(current().widgetSort).toEqual({ column: "region", direction: ASC });
  });
});

describe("a click on a column header", () => {
  test("goes worst first, best first, then back to the widget's own order", () => {
    render(<Probe />);

    click("status");
    expect(shown()).toBe("status:desc");
    expect(window.localStorage.getItem(PICK_KEY)).toBe("status:desc");

    click("status");
    expect(shown()).toBe("status:asc");
    expect(window.localStorage.getItem(PICK_KEY)).toBe("status:asc");

    // The third click forgets the pick: the widget's own order again.
    click("status");
    expect(shown()).toBe("name:asc");
    expect(window.localStorage.getItem(PICK_KEY)).toBeNull();
  });

  test("on the column the widget sorts by, turns it round, then back", () => {
    render(<Probe />);

    click("name");
    expect(shown()).toBe("name:desc");
    expect(window.localStorage.getItem(PICK_KEY)).toBe("name:desc");

    click("name");
    expect(shown()).toBe("name:asc");
    expect(window.localStorage.getItem(PICK_KEY)).toBeNull();
  });

  test("on another column starts that column at its first direction", () => {
    render(<Probe />);

    click("status");
    click("type");

    expect(shown()).toBe("type:asc");
  });

  test("on a column the widget does not sort by does nothing", () => {
    render(<Probe />);

    click("cpu");

    expect(shown()).toBe("name:asc");
    expect(window.localStorage.getItem(PICK_KEY)).toBeNull();
  });

  test("is still there after a refresh: the pick is read back as the page opens", () => {
    const first: ReturnType<typeof render> = render(<Probe />);

    click("status");
    first.unmount();

    render(<Probe />);
    expect(shown()).toBe("status:desc");
  });

  test("is this widget's on this dashboard only", () => {
    render(<Probe />);
    click("status");
    cleanup();

    render(<Probe componentId={OTHER_WIDGET_ID} />);
    expect(shown()).toBe("name:asc");
    cleanup();

    render(<Probe dashboardId={OTHER_DASHBOARD_ID} />);
    expect(shown()).toBe("name:asc");
  });

  test("a widget handed no dashboard keeps its pick for the page, and in nothing it reads back", () => {
    render(<Probe dashboardId="" />);

    click("status");

    expect(shown()).toBe("status:desc");
    expect(window.localStorage.length).toBe(0);
  });

  test("a widget with no order of its own goes back to none on the third click", () => {
    render(<Probe builtInSort={null} />);

    click("type");
    click("type");
    click("type");

    expect(shown()).toBe("none");
  });
});

describe("an editor changing the widget's own sort", () => {
  test("moves a viewer who had a pick onto it", () => {
    const view: ReturnType<typeof render> = render(<Probe />);

    click("type");
    expect(shown()).toBe("type:asc");

    view.rerender(<Probe savedSort="status:desc" />);

    expect(shown()).toBe("status:desc");
    expect(window.localStorage.getItem(PICK_KEY)).toBeNull();
  });

  test("leaves a viewer with no pick on the widget's sort, as it is", () => {
    const view: ReturnType<typeof render> = render(<Probe />);

    view.rerender(<Probe savedSort="type:desc" />);

    expect(shown()).toBe("type:desc");
  });

  test("the first sort a widget opens with is no change: a remembered pick stays", () => {
    window.localStorage.setItem(PICK_KEY, "type:asc");

    render(<Probe savedSort="status:desc" />);

    expect(shown()).toBe("type:asc");
    expect(window.localStorage.getItem(PICK_KEY)).toBe("type:asc");
  });
});

describe("in the widget settings' live preview", () => {
  test("a click sets the widget's own sort, never the viewer's pick", () => {
    const changes: Array<string | null> = [];
    const onSavedSortChange: (sort: string | null) => void = jest.fn(
      (sort: string | null) => {
        changes.push(sort);
      },
    );

    window.localStorage.setItem(PICK_KEY, "type:desc");

    const view: ReturnType<typeof render> = render(
      <Probe onSavedSortChange={onSavedSortChange} />,
    );

    // The preview shows the widget as everyone sees it: not the pick.
    expect(shown()).toBe("name:asc");

    click("status");
    expect(changes).toEqual(["status:desc"]);

    view.rerender(
      <Probe onSavedSortChange={onSavedSortChange} savedSort="status:desc" />,
    );
    click("status");
    expect(changes).toEqual(["status:desc", "status:asc"]);

    view.rerender(
      <Probe onSavedSortChange={onSavedSortChange} savedSort="status:asc" />,
    );
    // Back to the built-in order: the saved sort is taken away.
    click("status");
    expect(changes).toEqual(["status:desc", "status:asc", null]);

    // The viewer's own pick was neither read nor changed.
    expect(window.localStorage.getItem(PICK_KEY)).toBe("type:desc");
  });

  test("a click that would only repeat the built-in order saves no sort", () => {
    const changes: Array<string | null> = [];

    render(
      <Probe
        onSavedSortChange={(sort: string | null) => {
          changes.push(sort);
        }}
        savedSort="name:desc"
      />,
    );

    click("name");
    expect(changes).toEqual([null]);
  });
});

describe("a widget that says what it can be sorted by", () => {
  const Reporter: FunctionComponent<{
    sortColumns: DashboardWidgetSortColumns;
    onChange: (sortColumns: DashboardWidgetSortColumns) => void;
  }> = (props: {
    sortColumns: DashboardWidgetSortColumns;
    onChange: (sortColumns: DashboardWidgetSortColumns) => void;
  }): ReactElement => {
    useReportDashboardWidgetSortColumns(props.onChange, props.sortColumns);
    return <span />;
  };

  test("tells the settings once, and again only when the columns change", () => {
    const reported: Array<DashboardWidgetSortColumns> = [];
    const onChange: (sortColumns: DashboardWidgetSortColumns) => void = (
      sortColumns: DashboardWidgetSortColumns,
    ): void => {
      reported.push(sortColumns);
    };

    const view: ReturnType<typeof render> = render(
      <Reporter
        sortColumns={{ columns: COLUMNS, builtInSort: BUILT_IN }}
        onChange={onChange}
      />,
    );

    // A fresh but equal object is no change.
    view.rerender(
      <Reporter
        sortColumns={{ columns: [...COLUMNS], builtInSort: { ...BUILT_IN } }}
        onChange={onChange}
      />,
    );

    view.rerender(
      <Reporter
        sortColumns={{ columns: COLUMNS.slice(0, 1), builtInSort: null }}
        onChange={onChange}
      />,
    );

    expect(reported).toEqual([
      { columns: COLUMNS, builtInSort: BUILT_IN },
      { columns: COLUMNS.slice(0, 1), builtInSort: null },
    ]);
  });

  test("a widget handed nothing to tell tells nobody", () => {
    expect(() => {
      render(
        <Reporter
          sortColumns={{ columns: COLUMNS, builtInSort: BUILT_IN }}
          onChange={undefined as unknown as () => void}
        />,
      );
    }).not.toThrow();
  });
});
