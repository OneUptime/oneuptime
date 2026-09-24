import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Table from "../../../UI/Components/Table/Table";
import TableHeader from "../../../UI/Components/Table/TableHeader";
import Column from "../../../UI/Components/Table/Types/Column";
import Columns from "../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../UI/Components/Types/FieldType";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Column.headerTooltip: an (i) beside a table header that says what the
 * column's values mean - "CPU" summed over pods, "Restarts" since when.
 *
 * A sortable header is a <button>, and a button may not contain another
 * button, so for a sortable column with a tooltip the sort button shrinks
 * to its content and the (i) follows it inside the same cell. A column
 * without a tooltip must render exactly as it did before. And
 * Column.description - which ModelTable fills from the database column for
 * other purposes - must never produce an (i).
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

interface Row {
  _id?: string | undefined;
  name?: string | undefined;
  cpu?: number | undefined;
  restarts?: number | undefined;
  notes?: string | undefined;
}

const CPU_TIP: string =
  "Processor time used by all pods of the workload, summed - 100% is one full CPU core, so it can exceed 100%.";
const RESTARTS_TIP: string =
  "How many times the containers were restarted since they were created.";

type OnSort = (sortBy: keyof Row | null, sortOrder: SortOrder) => void;

interface HeaderOptions {
  columns: Columns<Row>;
  sortBy?: keyof Row | null | undefined;
  sortOrder?: SortOrder | undefined;
  onSortChanged?: OnSort | undefined;
}

function renderHeader(options: HeaderOptions): void {
  render(
    <table>
      <TableHeader<Row>
        id="test-header"
        columns={options.columns}
        onSortChanged={options.onSortChanged ?? (() => {})}
        isBulkActionsEnabled={false}
        onAllItemsOnThePageSelected={undefined}
        onAllItemsDeselected={undefined}
        hasTableItems={true}
        isAllItemsOnThePageSelected={false}
        sortBy={options.sortBy ?? null}
        sortOrder={options.sortOrder ?? SortOrder.Ascending}
      />
    </table>,
  );
}

function headerCell(title: string): HTMLElement {
  const cells: Array<HTMLElement> = screen.getAllByRole("columnheader");
  const cell: HTMLElement | undefined = cells.find(
    (c: HTMLElement): boolean => {
      return (c.textContent || "").trim() === title;
    },
  );

  if (!cell) {
    throw new Error(`No header cell "${title}"`);
  }

  return cell;
}

async function hover(trigger: HTMLElement): Promise<void> {
  fireEvent.mouseEnter(trigger);
  await act(async () => {
    jest.advanceTimersByTime(200);
  });
}

const setViewportWidth: (width: number) => void = (width: number): void => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
};

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  setViewportWidth(1024);
});

describe("a sortable column with a header tooltip", () => {
  const columns: Columns<Row> = [
    { title: "Name", type: FieldType.Text, key: "name" },
    {
      title: "CPU",
      type: FieldType.Number,
      key: "cpu",
      headerTooltip: CPU_TIP,
    },
  ];

  test("the (i) sits in the header cell, beside the sort button and not inside it", () => {
    renderHeader({ columns });

    const cell: HTMLElement = headerCell("CPU");
    const sortButton: HTMLElement = within(cell).getByRole("button", {
      name: "CPU",
    });
    const info: HTMLElement = within(cell).getByRole("button", {
      name: "About CPU",
    });

    expect(sortButton).not.toContainElement(info);
    expect(info.parentElement?.closest("button")).toBeNull();
    expect(sortButton.nextElementSibling).toBe(info);
  });

  test("the cell still announces itself as sortable", () => {
    renderHeader({ columns });

    expect(headerCell("CPU")).toHaveAttribute("aria-sort", "none");
  });

  test("clicking the sort button still sorts", () => {
    const onSortChanged: MockFunction = getJestMockFunction();
    renderHeader({ columns, onSortChanged });

    fireEvent.click(screen.getByRole("button", { name: "CPU" }));

    expect(onSortChanged).toHaveBeenCalledTimes(1);
    expect(onSortChanged).toHaveBeenCalledWith("cpu", SortOrder.Descending);
  });

  test("the sort direction round-trips on a tooltip column", () => {
    const onSortChanged: MockFunction = getJestMockFunction();
    renderHeader({
      columns,
      onSortChanged,
      sortBy: "cpu",
      sortOrder: SortOrder.Descending,
    });

    expect(headerCell("CPU")).toHaveAttribute("aria-sort", "descending");

    fireEvent.click(screen.getByRole("button", { name: "CPU" }));

    expect(onSortChanged).toHaveBeenCalledWith("cpu", SortOrder.Ascending);
  });

  test("the sort chevron stays inside the sort button, before the (i)", () => {
    renderHeader({ columns, sortBy: "cpu", sortOrder: SortOrder.Ascending });

    const cell: HTMLElement = headerCell("CPU");
    const sortButton: HTMLElement = within(cell).getByRole("button", {
      name: "CPU",
    });
    const info: HTMLElement = within(cell).getByRole("button", {
      name: "About CPU",
    });

    expect(sortButton.querySelector("svg")).not.toBeNull();
    expect(info.compareDocumentPosition(sortButton)).toBe(
      Node.DOCUMENT_POSITION_PRECEDING,
    );
  });

  test("clicking the (i) does not sort", () => {
    const onSortChanged: MockFunction = getJestMockFunction();
    renderHeader({ columns, onSortChanged });

    fireEvent.click(screen.getByRole("button", { name: "About CPU" }));

    expect(onSortChanged).not.toHaveBeenCalled();
  });

  test.each([
    ["Enter", "Enter"],
    ["Space", " "],
  ])("pressing %s on the (i) does not sort", (_: string, key: string) => {
    const onSortChanged: MockFunction = getJestMockFunction();
    renderHeader({ columns, onSortChanged });

    fireEvent.keyDown(screen.getByRole("button", { name: "About CPU" }), {
      key,
    });

    expect(onSortChanged).not.toHaveBeenCalled();
  });

  test("a real keyboard Enter on the focused (i) does not sort, and on the sort button does", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
      advanceTimers: (ms: number) => {
        jest.advanceTimersByTime(ms);
      },
    });
    const onSortChanged: MockFunction = getJestMockFunction();
    renderHeader({ columns, onSortChanged });

    act(() => {
      screen.getByRole("button", { name: "About CPU" }).focus();
    });
    await user.keyboard("{Enter}");

    expect(onSortChanged).not.toHaveBeenCalled();

    act(() => {
      screen.getByRole("button", { name: "CPU" }).focus();
    });
    await user.keyboard("{Enter}");

    expect(onSortChanged).toHaveBeenCalledTimes(1);
  });

  test("hovering the (i) shows what the column means", async () => {
    renderHeader({ columns });

    await hover(screen.getByRole("button", { name: "About CPU" }));

    expect(screen.getByRole("tooltip")).toHaveTextContent(CPU_TIP);
  });

  test("the sort button shrinks to its content and the pair shares the cell", () => {
    renderHeader({ columns });

    const cell: HTMLElement = headerCell("CPU");
    const sortButton: HTMLElement = within(cell).getByRole("button", {
      name: "CPU",
    });
    const wrapper: HTMLElement = sortButton.parentElement as HTMLElement;

    expect(wrapper.parentElement).toBe(cell);
    expect(wrapper).toHaveClass("flex", "w-full", "items-center");
    expect(sortButton).toHaveClass("pl-6", "pr-1", "py-3");
    expect(sortButton).not.toHaveClass("w-full");
    expect(sortButton).not.toHaveClass("px-6");
    expect(sortButton).toHaveAttribute("type", "button");
    expect(within(cell).getByRole("button", { name: "About CPU" })).toHaveClass(
      "mr-6",
      "font-normal",
    );
  });

  test("a sibling column without a tooltip is untouched", () => {
    renderHeader({ columns });

    const cell: HTMLElement = headerCell("Name");

    expect(within(cell).getAllByRole("button")).toHaveLength(1);
    expect(within(cell).getByRole("button", { name: "Name" })).toHaveClass(
      "w-full",
      "px-6",
    );
  });
});

describe("a non-sortable column with a header tooltip", () => {
  const NON_SORTABLE: Array<[string, Column<Row>]> = [
    [
      "disableSort",
      {
        title: "Restarts",
        type: FieldType.Number,
        key: "restarts",
        disableSort: true,
        headerTooltip: RESTARTS_TIP,
      },
    ],
    [
      "no key",
      {
        title: "Restarts",
        type: FieldType.Number,
        headerTooltip: RESTARTS_TIP,
      },
    ],
  ];

  test.each(NON_SORTABLE)(
    "(%s) shows the (i) beside a plain title",
    async (_: string, column: Column<Row>) => {
      const onSortChanged: MockFunction = getJestMockFunction();
      renderHeader({ columns: [column], onSortChanged });

      const cell: HTMLElement = headerCell("Restarts");
      const buttons: Array<HTMLElement> = within(cell).getAllByRole("button");

      expect(buttons).toHaveLength(1);
      expect(buttons[0]).toHaveAccessibleName("About Restarts");
      expect(cell).not.toHaveAttribute("aria-sort");

      const content: HTMLElement = buttons[0]!.parentElement as HTMLElement;
      expect(content.className).toBe(
        "flex w-full px-6 py-3 justify-start items-center",
      );
      expect(buttons[0]).toHaveClass("ml-1", "font-normal");

      fireEvent.click(buttons[0]!);
      expect(onSortChanged).not.toHaveBeenCalled();

      await hover(buttons[0]!);
      expect(screen.getByRole("tooltip")).toHaveTextContent(RESTARTS_TIP);
    },
  );

  test("an actions-type column keeps its right alignment", () => {
    renderHeader({
      columns: [
        {
          title: "Actions",
          type: FieldType.Actions,
          headerTooltip: "What you can do with each row.",
        },
      ],
    });

    const info: HTMLElement = screen.getByRole("button", {
      name: "About Actions",
    });

    expect(info.parentElement?.className).toBe(
      "flex w-full px-6 py-3 justify-end items-center",
    );
  });
});

describe("columns without a header tooltip render exactly as before", () => {
  const columns: Columns<Row> = [
    { title: "Name", type: FieldType.Text, key: "name" },
    { title: "Notes", type: FieldType.Text },
    { title: "Actions", type: FieldType.Actions },
  ];

  test("no (i) anywhere", () => {
    renderHeader({ columns });

    expect(
      screen.queryByRole("button", { name: /^About / }),
    ).not.toBeInTheDocument();
  });

  test("a sortable header is one full-width button, directly in the cell", () => {
    renderHeader({ columns });

    const cell: HTMLElement = headerCell("Name");
    const button: HTMLElement = within(cell).getByRole("button", {
      name: "Name",
    });

    expect(button.parentElement).toBe(cell);
    expect(button.className).toContain("flex w-full px-6 py-3 justify-start");
    expect(button).not.toHaveClass("pl-6");
  });

  test("a non-sortable header is the plain content div, without the tooltip alignment", () => {
    renderHeader({ columns });

    const notes: HTMLElement = headerCell("Notes");
    const actions: HTMLElement = headerCell("Actions");

    expect(within(notes).queryByRole("button")).not.toBeInTheDocument();
    expect((notes.firstElementChild as HTMLElement).className).toBe(
      "flex w-full px-6 py-3 justify-start",
    );
    expect((actions.firstElementChild as HTMLElement).className).toBe(
      "flex w-full px-6 py-3 justify-end",
    );
  });

  test.each([
    ["empty", ""],
    ["undefined", undefined],
  ])(
    "an %s headerTooltip on a sortable column keeps the full-width sort button",
    (_: string, headerTooltip: string | undefined) => {
      renderHeader({
        columns: [
          { title: "Name", type: FieldType.Text, key: "name", headerTooltip },
        ],
      });

      const button: HTMLElement = screen.getByRole("button", { name: "Name" });

      expect(button.className).toContain("w-full px-6");
      expect(screen.getAllByRole("button")).toHaveLength(1);
    },
  );
});

describe("Column.description is never an (i)", () => {
  test("a description alone draws nothing, on sortable and plain columns", () => {
    renderHeader({
      columns: [
        {
          title: "Name",
          type: FieldType.Text,
          key: "name",
          description: "The monitor name as stored in the database.",
        },
        {
          title: "Notes",
          type: FieldType.Text,
          description: "Free text notes.",
        },
      ],
    });

    expect(
      screen.queryByRole("button", { name: /^About / }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("The monitor name as stored in the database."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Free text notes.")).not.toBeInTheDocument();
    // The sortable one keeps its original full-width button.
    expect(screen.getByRole("button", { name: "Name" })).toHaveClass("w-full");
  });

  test("with both, the (i) shows the headerTooltip and never the description", async () => {
    renderHeader({
      columns: [
        {
          title: "CPU",
          type: FieldType.Number,
          key: "cpu",
          description: "Database column description.",
          headerTooltip: CPU_TIP,
        },
      ],
    });

    await hover(screen.getByRole("button", { name: "About CPU" }));

    expect(screen.getByRole("tooltip")).toHaveTextContent(CPU_TIP);
    expect(
      screen.queryByText("Database column description."),
    ).not.toBeInTheDocument();
  });
});

describe("mobile", () => {
  test("a column hidden on mobile takes its (i) with it", () => {
    setViewportWidth(500);

    renderHeader({
      columns: [
        { title: "Name", type: FieldType.Text, key: "name" },
        {
          title: "CPU",
          type: FieldType.Number,
          key: "cpu",
          headerTooltip: CPU_TIP,
          hideOnMobile: true,
        },
      ],
    });

    expect(
      screen.queryByRole("button", { name: "About CPU" }),
    ).not.toBeInTheDocument();
  });
});

describe("through the full Table", () => {
  const data: Array<Row> = [
    { _id: "1", name: "api", cpu: 12, restarts: 0 },
    { _id: "2", name: "web", cpu: 140, restarts: 3 },
  ];

  function renderTable(onSortChanged: OnSort): void {
    render(
      <Table<Row>
        id="tooltip-table"
        data={data}
        columns={[
          { title: "Name", type: FieldType.Text, key: "name" },
          {
            title: "CPU",
            type: FieldType.Number,
            key: "cpu",
            headerTooltip: CPU_TIP,
          },
          {
            title: "Restarts",
            type: FieldType.Number,
            key: "restarts",
            disableSort: true,
            headerTooltip: RESTARTS_TIP,
          },
        ]}
        currentPageNumber={1}
        totalItemsCount={data.length}
        itemsOnPage={10}
        error=""
        isLoading={false}
        singularLabel="Workload"
        pluralLabel="Workloads"
        sortOrder={SortOrder.Ascending}
        sortBy={null}
        onSortChanged={onSortChanged}
        onNavigateToPage={() => {}}
      />,
    );
  }

  test("every tooltip column gets one (i) in the header, and sorting still works", async () => {
    const onSortChanged: MockFunction = getJestMockFunction();
    renderTable(onSortChanged);

    const infos: Array<HTMLElement> = screen.getAllByRole("button", {
      name: /^About /,
    });

    expect(
      infos.map((b: HTMLElement): string => {
        return b.getAttribute("aria-label") || "";
      }),
    ).toEqual(["About CPU", "About Restarts"]);

    for (const info of infos) {
      expect(info.closest("thead")).not.toBeNull();
    }

    fireEvent.click(infos[0]!);
    expect(onSortChanged).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "CPU" }));
    expect(onSortChanged).toHaveBeenCalledWith("cpu", SortOrder.Descending);

    await hover(infos[1]!);
    expect(screen.getByRole("tooltip")).toHaveTextContent(RESTARTS_TIP);
  });

  test("the rows are unaffected by header tooltips", () => {
    renderTable(() => {});

    expect(screen.getAllByText("api").length).toBeGreaterThan(0);
    expect(screen.getAllByText("140").length).toBeGreaterThan(0);
  });
});

describe("ModelTable hands headerTooltip through", () => {
  /*
   * ModelTable builds the Table's columns by spreading its own; the field
   * exists on both Column types so a page can set it once on a ModelTable
   * column. Pinned at the source: rendering a ModelTable needs the whole
   * API layer.
   */
  const COMMON_UI: string = path.join(__dirname, "..", "..", "..", "UI");

  test("both Column types declare headerTooltip", () => {
    for (const file of [
      "Components/Table/Types/Column.ts",
      "Components/ModelTable/Column.ts",
    ]) {
      const source: string = fs.readFileSync(
        path.join(COMMON_UI, ...file.split("/")),
        "utf8",
      );

      expect(source).toContain("headerTooltip?: string | undefined;");
    }
  });

  test("BaseModelTable spreads the column into the table column", () => {
    const source: string = fs.readFileSync(
      path.join(COMMON_UI, "Components", "ModelTable", "BaseModelTable.tsx"),
      "utf8",
    );
    const push: number = source.indexOf("columns.push({");

    expect(push).toBeGreaterThan(-1);
    expect(source.slice(push, push + 80)).toContain("...column,");
  });
});
