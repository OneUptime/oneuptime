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
import React, { ReactElement } from "react";
import SizedColumnsStyle, {
  SIZED_COLUMNS_STYLE_ATTRIBUTE,
  SizedColumn,
} from "../../../../../UI/Components/Table/ColumnResize/SizedColumnsStyle";
import ColumnWidthsStore from "../../../../../UI/Components/Table/ColumnResize/ColumnWidthsStore";
import {
  EMPTY_COLUMN_WIDTHS,
  getSizedColumnsCss,
} from "../../../../../UI/Components/Table/ColumnResize/ColumnWidths";
import Table, {
  ComponentProps as TableProps,
} from "../../../../../UI/Components/Table/Table";
import Card from "../../../../../UI/Components/Card/Card";
import CardMoreMenu from "../../../../../UI/Components/Card/CardMoreMenu";
import MoreMenuItem from "../../../../../UI/Components/MoreMenu/MoreMenuItem";
import Columns from "../../../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../../../UI/Components/Types/FieldType";
import { COLUMN_RESIZE_HANDLE_TEST_ID } from "../../../../../UI/Components/Table/ColumnResize/ColumnResizeLayout";
import User from "../../../../../UI/Utils/User";
import ObjectID from "../../../../../Types/ObjectID";
import IconProp from "../../../../../Types/Icon/IconProp";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import GenericObject from "../../../../../Types/GenericObject";
import { UserPreferenceType } from "../../../../../Utils/UserPreferences";
import { ButtonStyleType } from "../../../../../UI/Components/Button/Button";

/*
 * "After Reset column widths a table draws for a frame at its unfitted
 * widths before it fits its card again" - the 14.0.100 release gate.
 *
 * The shared Table fits its card by measuring itself (useTableScrollState):
 * its values are held at the widths the last measuring gave them. A column a
 * person sized has a rule of its own (SizedColumnsStyle) that overrules
 * them; when the rules go - Reset column widths, a column given back with
 * Delete - the values were drawn at their held widths until the table
 * measured itself on the next frame, after that frame was painted:
 * Affected Resources 340px wide in a 1214px card, then 187px.
 *
 * SizedColumnsStyle now says when its rules change after their first
 * write, once they are on the page, and the table measures itself again
 * right there - in the commit, before the page is painted. jsdom lays
 * nothing out and has no ResizeObserver, so the table's own reads of its
 * box (getBoundingClientRect) are what show it measured itself; the browser
 * suite (ModelTables/ColumnResize.spec.ts) reads every frame after the
 * click.
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

const PERSON: string = "8a3b0c3e-0000-4000-8000-0000000000bb";

const SCOPE: string = "services";

const COLUMNS: ReadonlyArray<SizedColumn> = [
  { id: "name", cellNumber: 1 },
  { id: "status", cellNumber: 2 },
];

const styleText: () => string = (): string => {
  return (
    document.querySelector(`[${SIZED_COLUMNS_STYLE_ATTRIBUTE}="${SCOPE}"]`)
      ?.textContent || ""
  );
};

describe("SizedColumnsStyle tells its table when its rules change", () => {
  test("not as they are first written: a table drawn with widths kept is measured as it is drawn", () => {
    const store: ColumnWidthsStore = new ColumnWidthsStore({ name: 300 });
    const onRulesChange: jest.Mock<() => void> = jest.fn<() => void>();

    render(
      <SizedColumnsStyle
        store={store}
        scope={SCOPE}
        columns={COLUMNS}
        onRulesChange={onRulesChange}
      />,
    );

    expect(styleText()).toBe(
      getSizedColumnsCss({ scope: SCOPE, cellNumbers: [1] }),
    );
    expect(onRulesChange).not.toHaveBeenCalled();
  });

  test("once a column is sized for the first time, with its rule already on the page", () => {
    const store: ColumnWidthsStore = new ColumnWidthsStore();
    const textsWhenTold: Array<string> = [];
    const onRulesChange: jest.Mock<() => void> = jest.fn<() => void>(() => {
      textsWhenTold.push(styleText());
    });

    render(
      <SizedColumnsStyle
        store={store}
        scope={SCOPE}
        columns={COLUMNS}
        onRulesChange={onRulesChange}
      />,
    );

    expect(onRulesChange).not.toHaveBeenCalled();

    act(() => {
      store.setWidths({ status: 180 });
    });

    expect(onRulesChange).toHaveBeenCalledTimes(1);
    expect(textsWhenTold).toEqual([
      getSizedColumnsCss({ scope: SCOPE, cellNumbers: [2] }),
    ]);
  });

  test("not when a sized column's width changes: its rule is the same, only its header cell's width is not", () => {
    const store: ColumnWidthsStore = new ColumnWidthsStore({ status: 180 });
    const onRulesChange: jest.Mock<() => void> = jest.fn<() => void>();

    render(
      <SizedColumnsStyle
        store={store}
        scope={SCOPE}
        columns={COLUMNS}
        onRulesChange={onRulesChange}
      />,
    );

    act(() => {
      store.setWidths({ status: 240 });
    });

    expect(onRulesChange).not.toHaveBeenCalled();
  });

  test("when every column is reset, with the rules already gone", () => {
    const store: ColumnWidthsStore = new ColumnWidthsStore({
      name: 300,
      status: 180,
    });
    const textsWhenTold: Array<string> = [];

    render(
      <SizedColumnsStyle
        store={store}
        scope={SCOPE}
        columns={COLUMNS}
        onRulesChange={() => {
          textsWhenTold.push(styleText());
        }}
      />,
    );

    act(() => {
      store.setWidths(EMPTY_COLUMN_WIDTHS);
    });

    expect(textsWhenTold).toEqual([""]);
  });

  test("and when one column is given back while another stays sized", () => {
    const store: ColumnWidthsStore = new ColumnWidthsStore({
      name: 300,
      status: 180,
    });
    const textsWhenTold: Array<string> = [];

    render(
      <SizedColumnsStyle
        store={store}
        scope={SCOPE}
        columns={COLUMNS}
        onRulesChange={() => {
          textsWhenTold.push(styleText());
        }}
      />,
    );

    act(() => {
      store.setWidths({ name: 300 });
    });

    expect(textsWhenTold).toEqual([
      getSizedColumnsCss({ scope: SCOPE, cellNumbers: [1] }),
    ]);
  });
});

interface Row extends GenericObject {
  _id: string;
  name: string;
  status: string;
}

const ROWS: Array<Row> = [
  {
    _id: "10000000-0000-4000-8000-000000000011",
    name: "Checkout API",
    status: "Operational",
  },
  {
    _id: "10000000-0000-4000-8000-000000000012",
    name: "Marketing Website",
    status: "Degraded",
  },
];

const COLUMNS_OF_ROWS: Columns<Row> = [
  { title: "Name", type: FieldType.Text, key: "name", id: "name" },
  { title: "Status", type: FieldType.Text, key: "status", id: "status" },
  { title: "Actions", type: FieldType.Actions },
];

const tableProps: () => TableProps<Row> = (): TableProps<Row> => {
  return {
    id: "services-table",
    data: ROWS,
    columns: COLUMNS_OF_ROWS,
    onNavigateToPage: () => {},
    currentPageNumber: 1,
    totalItemsCount: ROWS.length,
    itemsOnPage: 10,
    error: "",
    isLoading: false,
    singularLabel: "Service",
    pluralLabel: "Services",
    sortOrder: SortOrder.Ascending,
    sortBy: null,
    onSortChanged: () => {},
    actionButtons: [
      {
        title: "View",
        buttonStyleType: ButtonStyleType.NORMAL,
        icon: IconProp.ChevronRight,
        onClick: () => {},
      },
    ],
  };
};

const keepWidths: (widths: Record<string, number>) => void = (
  widths: Record<string, number>,
): void => {
  window.localStorage.setItem(
    `${UserPreferenceType.TableColumnWidths}.${PERSON}.services-table`,
    JSON.stringify(widths),
  );
};

/*
 * How many times the table read the box its rows are drawn in while `work`
 * ran: its measuring reads it in every reading (whether the rows fit it),
 * and nothing else these presses do reads it.
 */
const boxReadsDuring: (work: () => void) => number = (
  work: () => void,
): number => {
  let reads: number = 0;
  const original: () => DOMRect = Element.prototype.getBoundingClientRect;
  const spy: jest.SpiedFunction<() => DOMRect> = jest
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: Element): DOMRect {
      if (this.getAttribute("data-testid") === "table-scroll") {
        reads++;
      }

      return original.call(this);
    });

  try {
    work();
  } finally {
    spy.mockRestore();
  }

  return reads;
};

describe("the shared Table measures itself again as its sized columns' rules change", () => {
  beforeEach(() => {
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

  const openCardMenu: () => HTMLElement = (): HTMLElement => {
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "More options" }));
    });

    return screen.getByRole("menu");
  };

  test("Reset column widths: in the click's own commit, before the page is painted - no frame waits for it", () => {
    keepWidths({ name: 300, status: 180 });

    render(
      <Card
        title="Services"
        buttons={[
          <CardMoreMenu key="more">
            {[
              <MoreMenuItem
                key="refresh"
                text="Refresh"
                icon={IconProp.Refresh}
                onClick={() => {}}
              />,
            ]}
          </CardMoreMenu>,
        ]}
      >
        <Table<Row> {...tableProps()} />
      </Card>,
    );

    const menu: HTMLElement = openCardMenu();

    // Read inside the click's act: measured there and then.
    const reads: number = boxReadsDuring(() => {
      act(() => {
        fireEvent.click(within(menu).getByText("Reset column widths"));
      });
    });

    expect(reads).toBeGreaterThan(0);
    expect(
      (document.querySelector("thead th") as HTMLElement).style.width,
    ).toBe("");
  });

  test("Delete gives one column back: measured in the key's own commit too", () => {
    keepWidths({ status: 180 });

    render(<Table<Row> {...tableProps()} />);

    const edge: HTMLElement = document.querySelector(
      `[data-testid="${COLUMN_RESIZE_HANDLE_TEST_ID}"][data-column-id="status"]`,
    ) as HTMLElement;

    const reads: number = boxReadsDuring(() => {
      act(() => {
        fireEvent.keyDown(edge, { key: "Delete" });
      });
    });

    expect(reads).toBeGreaterThan(0);
    expect(
      (
        document.querySelector(
          `thead th[data-column-id="status"]`,
        ) as HTMLElement
      ).style.width,
    ).toBe("");
  });
});
