import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";
import Table from "../../../../UI/Components/Table/Table";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import Column from "../../../../UI/Components/Table/Types/Column";
import FieldType from "../../../../UI/Components/Types/FieldType";
import {
  TABLE_FOLDED_COLUMNS_BELOW_WIDTH_IN_PX,
  getDrawnTableColumns,
} from "../../../../UI/Components/Table/FoldedColumns";
import {
  useAreTableColumnsFolded,
  useIsTableCard,
} from "../../../../UI/Components/Table/TableCellContext";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";

/*
 * A column a table leaves out below lg (Column.hideBelowLargeScreen), its
 * value shown in another column's cell there (useAreTableColumnsFolded).
 *
 * Beside a side menu a card is 430 to 700px wide below lg: the Rule
 * Library's four columns needed 566px and a Kubernetes cluster's Events
 * 680px, and their rows ran under the sticky last column at 768px. Below
 * lg the rule's severity goes under its name and the event's count and
 * time beside its reason, and Severity, Count and Last seen are not drawn.
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

interface Rule {
  _id?: string | undefined;
  name?: string | undefined;
  severity?: string | undefined;
  data?: string | undefined;
}

const RULES: Array<Rule> = [
  { _id: "1", name: "Brute force", severity: "High", data: "Sign-in events" },
  { _id: "2", name: "Password spraying", severity: "Low", data: "Okta" },
];

// The name, and under it the severity while its column is left out.
const NameCell: (props: { rule: Rule }) => ReactElement = (props: {
  rule: Rule;
}): ReactElement => {
  const isFolded: boolean = useAreTableColumnsFolded();
  const isCard: boolean = useIsTableCard();

  return (
    <div data-testid={`name-${props.rule._id}`}>
      <span>{props.rule.name}</span>
      {isFolded ? (
        <span data-testid={`folded-severity-${props.rule._id}`}>
          {props.rule.severity}
        </span>
      ) : (
        <></>
      )}
      <span data-testid={`card-${props.rule._id}`}>
        {isCard ? "card" : "row"}
      </span>
    </div>
  );
};

const COLUMNS: Columns<Rule> = [
  {
    key: "name",
    title: "Rule",
    type: FieldType.Element,
    getElement: (rule: Rule): ReactElement => {
      return <NameCell rule={rule} />;
    },
  },
  { key: "data", title: "Data", type: FieldType.Text },
  {
    key: "severity",
    title: "Severity",
    type: FieldType.Text,
    hideBelowLargeScreen: true,
  },
];

function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

async function renderTable(
  width: number,
  columns?: Columns<Rule>,
): Promise<void> {
  setViewportWidth(width);

  render(
    <Table<Rule>
      id="rules"
      data={RULES}
      columns={columns || COLUMNS}
      singularLabel="Rule"
      pluralLabel="Rules"
      currentPageNumber={1}
      totalItemsCount={RULES.length}
      itemsOnPage={10}
      error=""
      isLoading={false}
      onNavigateToPage={(): void => {}}
      sortOrder={SortOrder.Ascending}
      sortBy={null}
      onSortChanged={(): void => {}}
    />,
  );

  // The table settles its width's layout in an effect.
  await act(async () => {
    await Promise.resolve();
  });
}

async function resizeTo(width: number): Promise<void> {
  setViewportWidth(width);
  await act(async () => {
    window.dispatchEvent(new Event("resize"));
    await Promise.resolve();
  });
}

function headerTitles(): Array<string> {
  return screen
    .queryAllByRole("columnheader")
    .map((header: HTMLElement): string => {
      return (header.textContent || "").trim();
    })
    .filter(Boolean);
}

afterEach(() => {
  cleanup();
  setViewportWidth(1024);
});

describe("which columns a table draws", () => {
  const column: (title: string, hidden?: boolean) => Column<Rule> = (
    title: string,
    hidden?: boolean,
  ): Column<Rule> => {
    return { title: title, type: FieldType.Text, hideBelowLargeScreen: hidden };
  };

  test("from lg up, every column, as given", () => {
    const columns: Columns<Rule> = [column("Rule"), column("Severity", true)];

    expect(getDrawnTableColumns<Rule>(columns, false)).toEqual({
      columns: columns,
      areColumnsFolded: false,
    });
    // The same array: nothing new to lay out.
    expect(getDrawnTableColumns<Rule>(columns, false).columns).toBe(columns);
  });

  test("below lg, all but those marked, in their order - and it says one was left out", () => {
    const rule: Column<Rule> = column("Rule");
    const data: Column<Rule> = column("Data");
    const count: Column<Rule> = column("Count", true);
    const seen: Column<Rule> = column("Last seen", true);
    const drawn: { columns: Columns<Rule>; areColumnsFolded: boolean } =
      getDrawnTableColumns<Rule>([rule, count, data, seen], true);

    expect(drawn.columns).toEqual([rule, data]);
    expect(drawn.areColumnsFolded).toBe(true);
  });

  test("below lg, a table with no such column draws them all and folds nothing", () => {
    const columns: Columns<Rule> = [column("Rule"), column("Data", false)];
    const drawn: { columns: Columns<Rule>; areColumnsFolded: boolean } =
      getDrawnTableColumns<Rule>(columns, true);

    expect(drawn.columns).toBe(columns);
    expect(drawn.areColumnsFolded).toBe(false);
  });

  test("lg is 1024px", () => {
    expect(TABLE_FOLDED_COLUMNS_BELOW_WIDTH_IN_PX).toBe(1024);
  });
});

describe("a table with a column left out below lg", () => {
  test("from 1024px: its header and its cells, and the other cells draw nothing of it", async () => {
    for (const width of [1024, 1280]) {
      await renderTable(width);

      expect([width, headerTitles()]).toEqual([
        width,
        ["Rule", "Data", "Severity"],
      ]);
      expect(screen.getByText("High")).toBeInTheDocument();
      expect(screen.queryByTestId("folded-severity-1")).toBeNull();
      cleanup();
    }
  });

  test("below 1024px, on a tablet's rows: no header nor cell of its own, its value in the name's cell", async () => {
    for (const width of [1023, 900, 768]) {
      await renderTable(width);

      expect([width, headerTitles()]).toEqual([width, ["Rule", "Data"]]);
      // Still a table's rows, not a phone's cards.
      expect(screen.getByTestId("card-1")).toHaveTextContent("row");
      expect(screen.getByTestId("folded-severity-1")).toHaveTextContent("High");
      expect(screen.getByTestId("folded-severity-2")).toHaveTextContent("Low");

      // Each value once in its row.
      const row: HTMLElement = screen
        .getByTestId("name-1")
        .closest("tr") as HTMLElement;
      expect(within(row).getAllByText("High")).toHaveLength(1);
      expect(within(row).getAllByRole("cell")).toHaveLength(2);
      cleanup();
    }
  });

  test("on a phone's card: no field of its own, its value where the cell puts it", async () => {
    await renderTable(390);

    expect(screen.queryAllByRole("columnheader")).toHaveLength(0);
    expect(screen.getByTestId("card-1")).toHaveTextContent("card");
    expect(screen.getByTestId("folded-severity-1")).toHaveTextContent("High");
    expect(screen.getAllByText("High")).toHaveLength(1);
    const terms: Array<string> = screen
      .getAllByRole("term")
      .map((term: HTMLElement): string => {
        return (term.textContent || "").trim();
      });
    expect(terms).not.toContain("Severity");
  });

  test("a window made narrower and wider again moves the value between its column and the name's cell", async () => {
    await renderTable(1280);
    expect(headerTitles()).toEqual(["Rule", "Data", "Severity"]);

    await resizeTo(900);
    expect(headerTitles()).toEqual(["Rule", "Data"]);
    expect(screen.getByTestId("folded-severity-1")).toBeInTheDocument();

    await resizeTo(1100);
    expect(headerTitles()).toEqual(["Rule", "Data", "Severity"]);
    expect(screen.queryByTestId("folded-severity-1")).toBeNull();
    expect(screen.getAllByText("High")).toHaveLength(1);
  });

  test("a table with no such column draws every column below lg, and its cells fold nothing", async () => {
    await renderTable(
      900,
      COLUMNS.map((column: Column<Rule>): Column<Rule> => {
        return { ...column, hideBelowLargeScreen: false };
      }),
    );

    expect(headerTitles()).toEqual(["Rule", "Data", "Severity"]);
    expect(screen.queryByTestId("folded-severity-1")).toBeNull();
  });

  test("outside a table's cells nothing is folded", () => {
    const Probe: () => ReactElement = (): ReactElement => {
      return <span>{useAreTableColumnsFolded() ? "folded" : "whole"}</span>;
    };

    render(<Probe />);
    expect(screen.getByText("whole")).toBeInTheDocument();
  });
});
