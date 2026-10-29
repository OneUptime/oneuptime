import "@testing-library/jest-dom";
import {
  afterEach,
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
  within,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import DashboardSortableColumnHeader from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardSortableColumnHeader";
import useDashboardWidgetColumns, {
  DashboardWidgetColumns,
  DashboardWidgetIdContext,
  getDashboardWidgetColumnWidthsKey,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetColumns";
import { getDashboardWidgetSortHeaderTestId } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetSortCopy";
import { DashboardWidgetSortKind } from "../../../Types/Dashboard/DashboardWidgetSort";
import { ColumnWidthKind } from "../../../UI/Components/Table/ColumnResize/ColumnWidths";
import { COLUMN_RESIZE_HANDLE_TEST_ID } from "../../../UI/Components/Table/ColumnResize/ColumnResizeLayout";
import User from "../../../UI/Utils/User";
import ObjectID from "../../../Types/ObjectID";
import { UserPreferenceType } from "../../../Utils/UserPreferences";

/*
 * A dashboard widget's table sizes its columns as every table does, through
 * the header its widgets share (DashboardSortableColumnHeader): each widget
 * keeps its own widths for each person, under the widget's id, so two lists
 * on two dashboards are sized apart; a header that sorts still sorts, and a
 * press on its edge never does; and with no ⋯ on a widget, Reset column
 * widths is beside its last column's name while a column is sized. A widget
 * drawn with no id - a preview - sizes its columns only while it is open.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
        i18n: { language: "en" },
      };
    },
  };
});

const PERSON: string = "8a3b0c3e-0000-4000-8000-0000000000dd";

const FIRST_WIDGET: string = "widget-hosts";
const SECOND_WIDGET: string = "widget-services";

const sortClicks: Array<string> = [];

const HostsWidget: FunctionComponent = (): ReactElement => {
  const columns: DashboardWidgetColumns = useDashboardWidgetColumns([
    { id: "name", kind: ColumnWidthKind.Name },
    { id: "cpu", kind: ColumnWidthKind.Whole },
  ]);

  return (
    <div>
      {columns.resizable.styles}
      <table
        className={columns.tableWidthClassName}
        {...columns.resizable.tableAttributes}
        data-testid="widget-table"
      >
        <thead>
          <tr>
            <DashboardSortableColumnHeader
              label="Name"
              sortColumn={{
                key: "name",
                title: "Name",
                kind: DashboardWidgetSortKind.Text,
              }}
              sort={null}
              onSortClick={(columnKey: string) => {
                sortClicks.push(columnKey);
              }}
              resize={columns.getResize("name")}
            />
            <DashboardSortableColumnHeader
              label="CPU"
              alignRight={true}
              resize={columns.getResize("cpu")}
            />
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>web-1</td>
            <td>42%</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

const widget: (widgetId: string | null) => ReactElement = (
  widgetId: string | null,
): ReactElement => {
  return (
    <DashboardWidgetIdContext.Provider
      value={widgetId}
      key={widgetId || "none"}
    >
      <div data-testid={`widget-${widgetId || "preview"}`}>
        <HostsWidget />
      </div>
    </DashboardWidgetIdContext.Provider>
  );
};

const storageKey: (widgetId: string) => string = (widgetId: string): string => {
  return `${UserPreferenceType.TableColumnWidths}.${PERSON}.${getDashboardWidgetColumnWidthsKey(widgetId)}`;
};

const stored: (widgetId: string) => { [id: string]: number } | null = (
  widgetId: string,
): { [id: string]: number } | null => {
  const value: string | null = window.localStorage.getItem(
    storageKey(widgetId),
  );

  return value ? (JSON.parse(value) as { [id: string]: number }) : null;
};

const widenWithKeyboard: (container: HTMLElement, columnId: string) => void = (
  container: HTMLElement,
  columnId: string,
): void => {
  const edge: HTMLElement = container.querySelector(
    `[data-testid="${COLUMN_RESIZE_HANDLE_TEST_ID}"][data-column-id="${columnId}"]`,
  ) as HTMLElement;

  act(() => {
    fireEvent.keyDown(edge, { key: "ArrowRight" });
  });
  act(() => {
    fireEvent.keyUp(edge, { key: "ArrowRight" });
  });
};

beforeEach(() => {
  sortClicks.length = 0;
  window.localStorage.clear();
  jest.spyOn(User, "getUserId").mockImplementation((): ObjectID => {
    return new ObjectID(PERSON);
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
});

describe("a dashboard widget's columns", () => {
  test("each header has an edge named after its words, the sortable one too", () => {
    render(widget(FIRST_WIDGET));

    expect(
      screen.getByRole("separator", { name: "Resize the Name column" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("separator", { name: "Resize the CPU column" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveAttribute(
      "aria-sort",
      "none",
    );
  });

  test("are remembered per widget: two widgets are sized apart", () => {
    render(
      <>
        {widget(FIRST_WIDGET)}
        {widget(SECOND_WIDGET)}
      </>,
    );

    widenWithKeyboard(screen.getByTestId(`widget-${FIRST_WIDGET}`), "name");

    const first: { [id: string]: number } | null = stored(FIRST_WIDGET);

    expect(first).not.toBeNull();
    expect(Object.keys(first || {})).toEqual(["name"]);
    expect(stored(SECOND_WIDGET)).toBeNull();

    const secondName: HTMLElement = within(
      screen.getByTestId(`widget-${SECOND_WIDGET}`),
    ).getByRole("columnheader", { name: "Name" });

    expect(secondName.style.width).toBe("");
  });

  test("a widget drawn with no id - a preview - sizes its columns but keeps nothing", () => {
    render(widget(null));

    widenWithKeyboard(screen.getByTestId("widget-preview"), "name");

    expect(
      screen.getByRole("columnheader", { name: "Name" }).style.width,
    ).toMatch(/^\d+px$/);
    expect(window.localStorage.length).toBe(0);
  });

  test("a header that sorts still sorts; a press on its edge does not", () => {
    render(widget(FIRST_WIDGET));

    const edge: HTMLElement = screen.getByRole("separator", {
      name: "Resize the Name column",
    });

    act(() => {
      fireEvent.click(edge);
    });

    expect(sortClicks).toEqual([]);

    act(() => {
      fireEvent.click(
        screen.getByTestId(getDashboardWidgetSortHeaderTestId("name")),
      );
    });

    expect(sortClicks).toEqual(["name"]);
  });

  test("with no ⋯ on a widget, Reset column widths is beside its last column's name while a column is sized", () => {
    render(widget(FIRST_WIDGET));

    expect(
      screen.queryByRole("button", { name: "Reset column widths" }),
    ).toBeNull();

    widenWithKeyboard(screen.getByTestId(`widget-${FIRST_WIDGET}`), "name");

    const lastHeader: HTMLElement = screen.getByRole("columnheader", {
      name: "CPU",
    });
    const reset: HTMLElement = within(lastHeader).getByRole("button", {
      name: "Reset column widths",
    });

    act(() => {
      fireEvent.click(reset);
    });

    expect(stored(FIRST_WIDGET)).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Name" }).style.width).toBe(
      "",
    );
  });

  test("the table is the widget's width until every column is sized, then as wide as its columns", () => {
    render(widget(FIRST_WIDGET));

    const table: HTMLElement = screen.getByTestId("widget-table");

    expect(table.className.split(" ")).toContain("w-full");

    widenWithKeyboard(screen.getByTestId(`widget-${FIRST_WIDGET}`), "name");
    widenWithKeyboard(screen.getByTestId(`widget-${FIRST_WIDGET}`), "cpu");

    expect(table.className.split(" ")).toContain("w-max");
  });
});
