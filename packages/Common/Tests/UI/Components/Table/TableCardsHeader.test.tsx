import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { Mock } from "jest-mock";
import * as React from "react";
import TableCardsHeader, {
  TABLE_CARDS_BULK_LINE_TEST_ID,
  TABLE_CARDS_HEADER_TEST_ID,
  TABLE_CARDS_HEADER_TEXT,
  TABLE_CARDS_SORT_TEST_ID,
  getSortableCardColumns,
} from "../../../../UI/Components/Table/TableCardsHeader";
import {
  TABLE_CARDS_BOX_SLOT_CLASS_NAME,
  TABLE_CARDS_BULK_LINE_CLASS_NAME,
  TABLE_CARDS_HEADER_CLASS_NAME,
} from "../../../../UI/Components/Table/TableLayout";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import GenericObject from "../../../../Types/GenericObject";

/*
 * Over a list drawn as cards - a phone, or a card too narrow for the rows
 * (TableFit) - the band the header row draws over rows, doing what the
 * header row does there: the box that selects every row on the page, and
 * the order the list is in ("Sorted by Declared ↓"), which the cards would
 * otherwise not say and could not change. A phone could not sort a list.
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

afterEach(() => {
  cleanup();
});

interface Incident extends GenericObject {
  title: string;
  declaredAt: string;
  owner: string;
}

const COLUMNS: Columns<Incident> = [
  { key: "title", title: "Title", type: FieldType.Text },
  { key: "declaredAt", title: "Declared", type: FieldType.DateTime },
  // Not sortable: the header could not sort it either.
  { key: "owner", title: "Owner", type: FieldType.Text, disableSort: true },
  { title: "Actions", type: FieldType.Actions },
];

interface DrawProps {
  columns?: Columns<Incident>;
  sortBy?: keyof Incident | null;
  sortOrder?: SortOrder;
  onSortChanged?: (sortBy: keyof Incident | null, order: SortOrder) => void;
  isBulkActionsEnabled?: boolean;
  hasTableItems?: boolean;
  isAllItemsOnThePageSelected?: boolean;
  isSomeItemsOnThePageSelected?: boolean;
  onAllItemsOnThePageSelected?: () => void;
  onAllItemsDeselected?: () => void;
  hasBulkSelection?: boolean;
  bulkLineRef?: (element: HTMLElement | null) => void;
}

const draw: (props?: DrawProps) => void = (props?: DrawProps): void => {
  render(
    <TableCardsHeader<Incident>
      columns={props?.columns || COLUMNS}
      sortBy={props?.sortBy === undefined ? "declaredAt" : props.sortBy}
      sortOrder={props?.sortOrder || SortOrder.Descending}
      onSortChanged={props?.onSortChanged || ((): void => {})}
      isBulkActionsEnabled={props?.isBulkActionsEnabled}
      hasTableItems={props?.hasTableItems ?? true}
      isAllItemsOnThePageSelected={props?.isAllItemsOnThePageSelected}
      isSomeItemsOnThePageSelected={props?.isSomeItemsOnThePageSelected}
      onAllItemsOnThePageSelected={props?.onAllItemsOnThePageSelected}
      onAllItemsDeselected={props?.onAllItemsDeselected}
      hasBulkSelection={props?.hasBulkSelection}
      bulkLineRef={props?.bulkLineRef}
    />,
  );
};

const openSort: () => void = (): void => {
  act(() => {
    fireEvent.click(screen.getByTestId(TABLE_CARDS_SORT_TEST_ID));
  });
};

describe("the columns cards may be sorted by", () => {
  test("those a header could sort: never the row's actions, a column that does not sort, or one with no key", () => {
    expect(
      getSortableCardColumns<Incident>([
        ...COLUMNS,
        { title: "Computed", type: FieldType.Text },
      ]).map((column: Columns<Incident>[number]): string => {
        return column.title;
      }),
    ).toEqual(["Title", "Declared"]);
  });
});

describe("the band over a list's cards", () => {
  test("is the header row's band: light, ruled, as tall as the header row", () => {
    draw();

    const band: HTMLElement = screen.getByTestId(TABLE_CARDS_HEADER_TEST_ID);

    expect(band.className).toBe(TABLE_CARDS_HEADER_CLASS_NAME);
    expect(TABLE_CARDS_HEADER_CLASS_NAME).toContain("min-h-[2.25rem]");
    expect(TABLE_CARDS_HEADER_CLASS_NAME).toContain("border-y");
  });

  test("says the order the list is in, and which way", () => {
    draw();

    const sort: HTMLElement = screen.getByTestId(TABLE_CARDS_SORT_TEST_ID);

    expect(sort).toHaveTextContent("Sorted by Declared");
    expect(sort).toHaveAttribute("aria-label", "Sorted by Declared");
    expect(TABLE_CARDS_HEADER_TEXT.sortedBy).toBe("Sorted by {{column}}");
  });

  test("a list in no particular order says Sort", () => {
    draw({ sortBy: null });

    expect(screen.getByTestId(TABLE_CARDS_SORT_TEST_ID)).toHaveTextContent(
      /^Sort$/,
    );
  });

  test("a list in no particular order offers its columns, none ticked, and no order until one is picked", () => {
    const sorted: Mock<
      (sortBy: keyof Incident | null, order: SortOrder) => void
    > = jest.fn<(sortBy: keyof Incident | null, order: SortOrder) => void>();

    draw({ sortBy: null, onSortChanged: sorted });
    openSort();

    expect(
      screen.getByTestId(`${TABLE_CARDS_SORT_TEST_ID}-title`),
    ).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByTestId(`${TABLE_CARDS_SORT_TEST_ID}-declaredAt`),
    ).toHaveAttribute("aria-checked", "false");
    // No "Ascending" ticked over a list sorted by nothing.
    expect(
      screen.queryByTestId(`${TABLE_CARDS_SORT_TEST_ID}-ascending`),
    ).toBeNull();
    expect(
      screen.queryByTestId(`${TABLE_CARDS_SORT_TEST_ID}-descending`),
    ).toBeNull();

    act(() => {
      fireEvent.click(
        screen.getByTestId(`${TABLE_CARDS_SORT_TEST_ID}-declaredAt`),
      );
    });

    expect(sorted).toHaveBeenLastCalledWith("declaredAt", SortOrder.Descending);
  });

  test("offers the columns that sort, the one sorted by ticked, and the two orders", () => {
    draw();
    openSort();

    expect(
      screen.getByTestId(`${TABLE_CARDS_SORT_TEST_ID}-title`),
    ).toHaveTextContent("Title");
    expect(
      screen.getByTestId(`${TABLE_CARDS_SORT_TEST_ID}-declaredAt`),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByTestId(`${TABLE_CARDS_SORT_TEST_ID}-title`),
    ).toHaveAttribute("aria-checked", "false");
    expect(
      screen.queryByTestId(`${TABLE_CARDS_SORT_TEST_ID}-owner`),
    ).toBeNull();
    expect(
      screen.getByTestId(`${TABLE_CARDS_SORT_TEST_ID}-descending`),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByTestId(`${TABLE_CARDS_SORT_TEST_ID}-ascending`),
    ).toHaveAttribute("aria-checked", "false");
  });

  test("a column picked sorts by it, in the order the list is in; an order picked keeps the column", () => {
    const sorted: Mock<
      (sortBy: keyof Incident | null, order: SortOrder) => void
    > = jest.fn<(sortBy: keyof Incident | null, order: SortOrder) => void>();

    draw({ onSortChanged: sorted });
    openSort();
    act(() => {
      fireEvent.click(screen.getByTestId(`${TABLE_CARDS_SORT_TEST_ID}-title`));
    });

    expect(sorted).toHaveBeenLastCalledWith("title", SortOrder.Descending);

    openSort();
    act(() => {
      fireEvent.click(
        screen.getByTestId(`${TABLE_CARDS_SORT_TEST_ID}-ascending`),
      );
    });

    expect(sorted).toHaveBeenLastCalledWith("declaredAt", SortOrder.Ascending);
  });

  test("picking what the list is already sorted by asks for nothing", () => {
    const sorted: Mock<
      (sortBy: keyof Incident | null, order: SortOrder) => void
    > = jest.fn<(sortBy: keyof Incident | null, order: SortOrder) => void>();

    draw({ onSortChanged: sorted });
    openSort();
    act(() => {
      fireEvent.click(
        screen.getByTestId(`${TABLE_CARDS_SORT_TEST_ID}-declaredAt`),
      );
    });

    expect(sorted).not.toHaveBeenCalled();
  });
});

describe("the band's select-all box", () => {
  test("is there only where rows can be selected", () => {
    draw();

    expect(screen.queryByRole("checkbox")).toBeNull();

    cleanup();
    draw({ isBulkActionsEnabled: true });

    expect(
      screen.getByRole("checkbox", { name: "Select all items" }),
    ).toBeInTheDocument();
  });

  test("selects every card on the page, and lets them go again", () => {
    const selected: Mock<() => void> = jest.fn<() => void>();
    const deselected: Mock<() => void> = jest.fn<() => void>();

    draw({
      isBulkActionsEnabled: true,
      onAllItemsOnThePageSelected: selected,
      onAllItemsDeselected: deselected,
    });

    act(() => {
      fireEvent.click(screen.getByRole("checkbox"));
    });
    expect(selected).toHaveBeenCalledTimes(1);

    cleanup();
    draw({
      isBulkActionsEnabled: true,
      isAllItemsOnThePageSelected: true,
      onAllItemsOnThePageSelected: selected,
      onAllItemsDeselected: deselected,
    });

    expect(screen.getByRole("checkbox")).toBeChecked();
    act(() => {
      fireEvent.click(screen.getByRole("checkbox"));
    });
    expect(deselected).toHaveBeenCalledTimes(1);
  });

  test("some selected: neither ticked nor empty", () => {
    draw({ isBulkActionsEnabled: true, isSomeItemsOnThePageSelected: true });

    expect(
      (screen.getByRole("checkbox") as HTMLInputElement).indeterminate,
    ).toBe(true);
  });

  test("a list with no cards has nothing to select", () => {
    draw({ isBulkActionsEnabled: true, hasTableItems: false });

    expect(screen.getByRole("checkbox")).toBeDisabled();
  });
});

describe("a band with nothing to do", () => {
  test("is the rule over the cards, as before", () => {
    draw({
      columns: [
        {
          key: "owner",
          title: "Owner",
          type: FieldType.Text,
          disableSort: true,
        },
      ],
    });

    expect(screen.queryByTestId(TABLE_CARDS_HEADER_TEST_ID)).toBeNull();
    expect(document.querySelector(".border-t.border-gray-200")).not.toBeNull();
  });
});

/*
 * While cards are ticked, the band's line after its box is the table's
 * Bulk Actions (BulkUpdateForm's Row, drawn into the element the band hands
 * the table): a phone drew a bar of its own over the band - three lines,
 * some 170px - that pushed every card down under the finger that ticked one.
 */
describe("the band's Bulk Actions line", () => {
  test("is handed to the table where the order sits, and holds nothing while nothing is ticked", () => {
    const lines: Array<HTMLElement | null> = [];

    draw({
      isBulkActionsEnabled: true,
      bulkLineRef: (element: HTMLElement | null): void => {
        lines.push(element);
      },
    });

    const line: HTMLElement = screen.getByTestId(TABLE_CARDS_BULK_LINE_TEST_ID);

    expect(lines[lines.length - 1]).toBe(line);
    expect(screen.getByTestId(TABLE_CARDS_HEADER_TEST_ID)).toContainElement(
      line,
    );
    // Nothing ticked: no room taken, and the order where it always was.
    expect(line).toHaveClass("hidden");
    expect(screen.getByTestId(TABLE_CARDS_SORT_TEST_ID)).toBeVisible();
  });

  test("while cards are ticked, takes the rest of the band, and the order steps aside", () => {
    draw({
      isBulkActionsEnabled: true,
      hasBulkSelection: true,
      isSomeItemsOnThePageSelected: true,
      bulkLineRef: (): void => {},
    });

    const line: HTMLElement = screen.getByTestId(TABLE_CARDS_BULK_LINE_TEST_ID);

    expect(line.className).toBe(TABLE_CARDS_BULK_LINE_CLASS_NAME);
    expect(TABLE_CARDS_BULK_LINE_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining(["flex-1", "min-w-0"]),
    );
    expect(screen.queryByTestId(TABLE_CARDS_SORT_TEST_ID)).toBeNull();
  });

  test("is not there on a list whose rows cannot be selected", () => {
    draw({ isBulkActionsEnabled: false, bulkLineRef: (): void => {} });

    expect(screen.queryByTestId(TABLE_CARDS_BULK_LINE_TEST_ID)).toBeNull();
    expect(screen.getByTestId(TABLE_CARDS_SORT_TEST_ID)).toBeVisible();
  });

  test("the box sits at the band's start, level with its first line, with no room kept for words it has none of", () => {
    draw({ isBulkActionsEnabled: true, bulkLineRef: (): void => {} });

    const band: HTMLElement = screen.getByTestId(TABLE_CARDS_HEADER_TEST_ID);
    const slot: HTMLElement = band.firstElementChild as HTMLElement;
    const box: HTMLElement = screen.getByRole("checkbox", {
      name: TABLE_CARDS_HEADER_TEXT.selectAll,
    });

    expect(slot.className).toBe(TABLE_CARDS_BOX_SLOT_CLASS_NAME);
    expect(slot).toContainElement(box);
    // The box's own words' slot takes no room: the count follows the box.
    expect(slot.querySelector(".relative.flex")).toHaveClass(
      "[&>div:last-child]:ml-0",
    );
    // 30px - Bulk Actions' height - inside the band's 36: it never grows.
    expect(TABLE_CARDS_BOX_SLOT_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining(["h-[1.875rem]", "self-start", "flex-none"]),
    );
    expect(TABLE_CARDS_HEADER_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining(["min-h-[2.25rem]", "py-0.5"]),
    );
  });
});
