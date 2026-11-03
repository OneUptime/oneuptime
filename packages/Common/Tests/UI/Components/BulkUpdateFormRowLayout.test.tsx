import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import BulkUpdateForm, {
  BULK_ALL_SELECTED_SHORT_COUNT,
  BULK_ROW_ACTIONS_BUTTON_CLASS_NAME,
  BULK_ROW_ACTIONS_TEST_ID,
  BULK_ROW_CLEAR_TEST_ID,
  BULK_ROW_COUNT_CHIP_CLASS_NAME,
  BULK_ROW_COUNT_TEST_ID,
  BULK_ROW_ERROR_CLASS_NAME,
  BULK_ROW_ERROR_TEST_ID,
  BULK_ROW_SELECT_ALL_CLASS_NAME,
  BULK_ROW_SELECT_ALL_SLOT_CLASS_NAME,
  BULK_ROW_SELECT_ALL_TEST_ID,
  BULK_ROW_TEST_ID,
  BULK_SELECTED_OF_MATCHING_SHORT_COUNT,
  BULK_SELECTED_SHORT_COUNT,
  BulkActionButtonSchema,
  BulkActionOnClickProps,
  BulkUpdateBarLayout,
  ComponentProps,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import { runBulkAction } from "../../../UI/Components/BulkUpdate/BulkActionRunner";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import IconProp from "../../../Types/Icon/IconProp";

/*
 * THE BULK ACTIONS BAR AS ONE LINE OF A LIST'S HEADER (BulkUpdateBarLayout.Row).
 *
 * The exceptions list put a table's bar - a grey card with a count badge,
 * Clear Selection and Bulk Actions - between its page box and its rows. The
 * card appeared the moment the first row was ticked and pushed every row
 * down under the pointer (some 110px on a desktop), and on a phone it took
 * three lines and some 170px of the screen. The list's header line now says
 * it all: after the page box, the count in a chip whose × lets go of the
 * selection, and Bulk Actions at the line's end, in the list's own small
 * type. A table keeps its bar (the Card, still the default).
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
  _id: string;
  name: string;
}

const ROWS: Array<Row> = [
  { _id: "1", name: "TypeError: x is undefined" },
  { _id: "2", name: "RangeError: too deep" },
  { _id: "3", name: "Error: socket hang up" },
];

const done: Array<string> = [];

const ARCHIVE: BulkActionButtonSchema<Row> = {
  title: "Archive",
  icon: IconProp.Archive,
  buttonStyleType: ButtonStyleType.NORMAL,
  onClick: async (actionProps: BulkActionOnClickProps<Row>): Promise<void> => {
    await runBulkAction<Row>({
      actionProps: actionProps,
      step: async (row: Row): Promise<void> => {
        done.push(row._id);
      },
    });
  },
};

function renderBar(overrides: Partial<ComponentProps<Row>> = {}): RenderResult {
  const props: ComponentProps<Row> = {
    selectedItems: ROWS,
    isAllItemsSelected: false,
    onSelectAllClick: () => {},
    onClearSelectionClick: () => {},
    singularLabel: "Exception",
    pluralLabel: "Exceptions",
    buttons: [ARCHIVE],
    itemToString: (row: Row): string => {
      return row.name;
    },
    layout: BulkUpdateBarLayout.Row,
    ...overrides,
  };

  return render(<BulkUpdateForm<Row> {...props} />);
}

afterEach(() => {
  cleanup();
  done.length = 0;
});

describe("a table's bar (the Card, left as it was)", () => {
  test("is still the default: a bar of its own with the badge, Select All, Clear Selection and Bulk Actions", () => {
    const { container } = renderBar({ layout: undefined });

    expect(screen.getByText("3 Exceptions Selected")).toBeVisible();
    expect(screen.getByText("Select All Exceptions")).toBeVisible();
    expect(screen.getByText("Clear Selection")).toBeVisible();
    expect(screen.getByText("Bulk Actions")).toBeVisible();
    expect(container.querySelector(".rounded-xl.bg-gray-50")).not.toBeNull();
    expect(screen.queryByTestId(BULK_ROW_TEST_ID)).toBeNull();
  });

  test("is what an explicit Card draws too", () => {
    const { container } = renderBar({ layout: BulkUpdateBarLayout.Card });

    expect(screen.getByText("3 Exceptions Selected")).toBeVisible();
    expect(container.querySelector(".rounded-xl.bg-gray-50")).not.toBeNull();
    expect(screen.queryByTestId(BULK_ROW_TEST_ID)).toBeNull();
  });
});

describe("a list's header line (the Row)", () => {
  test("draws nothing while nothing is ticked", () => {
    const { container } = renderBar({ selectedItems: [] });

    expect(container).toBeEmptyDOMElement();
  });

  test("says how many are selected in a chip, short, as the list's page box already names what it holds", () => {
    renderBar();

    const chip: HTMLElement = screen.getByTestId(BULK_ROW_COUNT_TEST_ID);

    expect(chip).toHaveTextContent("3 selected");
    expect(chip.className).toBe(BULK_ROW_COUNT_CHIP_CLASS_NAME);
    // An active filter's chip: what is picked, in indigo.
    for (const name of [
      "rounded-md",
      "border-indigo-200",
      "bg-indigo-50",
      "text-xs",
      "text-indigo-700",
    ]) {
      expect(BULK_ROW_COUNT_CHIP_CLASS_NAME.split(" ")).toContain(name);
    }

    cleanup();
    renderBar({ selectedItems: [ROWS[0]!] });

    expect(screen.getByTestId(BULK_ROW_COUNT_TEST_ID)).toHaveTextContent(
      "1 selected",
    );
  });

  test("words the count as one translation key, the form for one beside it", () => {
    expect(BULK_SELECTED_SHORT_COUNT).toEqual({
      one: "{{count}} selected",
      other: "{{count}} selected",
    });
  });

  test("has no Select All of its own, nor a bar of its own: the list's page box selects the page", () => {
    const { container } = renderBar({ isAllItemsSelected: false });

    expect(screen.queryByText("Select All Exceptions")).toBeNull();
    expect(screen.queryByText("3 Exceptions Selected")).toBeNull();
    expect(container.querySelector(".rounded-xl.bg-gray-50")).toBeNull();
  });

  test("clears the selection from the chip's ×, named Clear Selection", () => {
    const onClear: MockFunction = getJestMockFunction();

    renderBar({ onClearSelectionClick: onClear });

    const clear: HTMLElement = screen.getByRole("button", {
      name: "Clear Selection",
    });

    expect(clear).toBe(screen.getByTestId(BULK_ROW_CLEAR_TEST_ID));
    expect(clear).toHaveAttribute("title", "Clear Selection");
    expect(screen.getByTestId(BULK_ROW_COUNT_TEST_ID)).toContainElement(clear);

    fireEvent.click(clear);

    expect(onClear).toHaveBeenCalledTimes(1);
  });

  test("offers Bulk Actions at the line's end, as a button named by its words, that opens the actions", () => {
    renderBar();

    const line: HTMLElement = screen.getByTestId(BULK_ROW_TEST_ID);
    const end: HTMLElement = screen.getByTestId(BULK_ROW_ACTIONS_TEST_ID);
    const trigger: HTMLElement = screen.getByRole("button", {
      name: "Bulk Actions",
    });

    expect(line).toContainElement(end);
    expect(end).toContainElement(trigger);
    // At the end however the line wraps.
    expect(end).toHaveClass("ml-auto");
    expect(line.lastElementChild).toBe(end);
    // A real button, not "More options".
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(screen.queryByRole("button", { name: "More options" })).toBeNull();
    expect(trigger.className).toBe(BULK_ROW_ACTIONS_BUTTON_CLASS_NAME);

    fireEvent.click(trigger);

    expect(screen.getByRole("menuitem", { name: "Archive" })).toBeVisible();
  });

  test("draws Bulk Actions as a telemetry toolbar's button, in the list's small type", () => {
    for (const name of [
      "rounded-md",
      "border-gray-200",
      "bg-white",
      "px-2.5",
      "py-1.5",
      "text-xs",
      "font-medium",
    ]) {
      expect(BULK_ROW_ACTIONS_BUTTON_CLASS_NAME.split(" ")).toContain(name);
    }
  });

  test("keeps to one line on a phone: the bolt and the chevron step aside there, the words stay", () => {
    renderBar();

    const trigger: HTMLElement = screen.getByRole("button", {
      name: "Bulk Actions",
    });
    const parts: Array<Element> = Array.from(trigger.children);

    expect(parts).toHaveLength(3);
    expect(parts[0]).toHaveClass("max-sm:hidden");
    expect(parts[0]!.querySelector("svg")).not.toBeNull();
    expect(parts[1]!.tagName).toBe("SPAN");
    expect(parts[1]).toHaveTextContent("Bulk Actions");
    expect(parts[1]).not.toHaveClass("max-sm:hidden");
    expect(parts[2]).toHaveClass("max-sm:hidden");
    expect(parts[2]!.querySelector("svg")).not.toBeNull();
  });

  test("leaves Bulk Actions out when no action takes any of the selection", () => {
    renderBar({
      buttons: [
        {
          ...ARCHIVE,
          isVisible: (): boolean => {
            return false;
          },
        },
      ],
    });

    expect(screen.getByTestId(BULK_ROW_COUNT_TEST_ID)).toBeVisible();
    expect(screen.queryByTestId(BULK_ROW_ACTIONS_TEST_ID)).toBeNull();
  });

  test("says a failure of its own under the line, as an alert", () => {
    renderBar({ errorMessage: "Could not read the exceptions." });

    const alert: HTMLElement = screen.getByRole("alert");

    expect(alert).toHaveTextContent("Could not read the exceptions.");
    expect(alert).toHaveClass("basis-full");
    expect(screen.getByTestId(BULK_ROW_TEST_ID)).toContainElement(alert);
  });

  test("runs an action with a table's progress and result dialog, drawn beside the line, not in it", async () => {
    const onStart: MockFunction = getJestMockFunction();
    const onEnd: MockFunction = getJestMockFunction();

    renderBar({ onActionStart: onStart, onActionEnd: onEnd });

    fireEvent.click(screen.getByRole("button", { name: "Bulk Actions" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    });

    const dialog: HTMLElement = await screen.findByRole("dialog");

    await waitFor(() => {
      expect(within(dialog).getByText("3 Exceptions succeeded")).toBeVisible();
    });
    expect(done.sort()).toEqual(["1", "2", "3"]);
    expect(onStart).toHaveBeenCalledTimes(1);
    // A dialog's root takes no room in the line, nor a gap of its own.
    expect(screen.getByTestId(BULK_ROW_TEST_ID)).not.toContainElement(dialog);

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

/*
 * EVERY ROW THAT MATCHES, NOT ONLY THE PAGE'S (the Row's selectAllMatching).
 *
 * "Select every matching exception across pages, not just the page shown" -
 * the maintainer's follow-up to #5344. Once every row on the page is ticked
 * and more rows match, the line offers them all, naming how many - and,
 * past the most one selection holds, that it takes the first of them -
 * before anything is read. The same line is the band over a table's cards
 * on a phone, where the table's Select All lives now.
 */
describe("a list's header line, offering every row that matches", () => {
  function offer(): HTMLElement | null {
    return screen.queryByTestId(BULK_ROW_SELECT_ALL_TEST_ID);
  }

  test("offers every match once the page is all ticked and more rows match, naming how many", () => {
    const onSelectAll: MockFunction = getJestMockFunction();

    renderBar({
      onSelectAllClick: onSelectAll,
      selectAllMatching: { isPageSelected: true, matchingCount: 4213 },
    });

    const button: HTMLElement = screen.getByRole("button", {
      name: "Select all 4,213 exceptions",
    });

    expect(button).toBe(offer());
    expect(button.className).toBe(BULK_ROW_SELECT_ALL_CLASS_NAME);
    // In the line, after the count it grows, before Bulk Actions.
    const line: HTMLElement = screen.getByTestId(BULK_ROW_TEST_ID);
    expect(line).toContainElement(button);
    expect(
      screen
        .getByTestId(BULK_ROW_COUNT_TEST_ID)
        .compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      button.compareDocumentPosition(
        screen.getByTestId(BULK_ROW_ACTIONS_TEST_ID),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(button);

    expect(onSelectAll).toHaveBeenCalledTimes(1);
  });

  test("offers nothing while only some of the page is ticked, when the page is all there is, or when the list does not offer it", () => {
    renderBar({
      selectAllMatching: { isPageSelected: false, matchingCount: 4213 },
    });
    expect(offer()).toBeNull();
    cleanup();

    renderBar({
      selectAllMatching: { isPageSelected: true, matchingCount: 3 },
    });
    expect(offer()).toBeNull();
    cleanup();

    renderBar({ selectAllMatching: undefined });
    expect(offer()).toBeNull();
    // Nor the table's own Select All: the Row has no button of that name.
    expect(screen.queryByText("Select All Exceptions")).toBeNull();
  });

  test("past the most one selection holds, says it takes the first of them, before anything is read", () => {
    renderBar({
      selectAllMatching: { isPageSelected: true, matchingCount: 12345 },
    });

    expect(offer()).toHaveTextContent(
      "Select the first 10,000 of 12,345 exceptions",
    );
  });

  test("a list that only knows more rows follow offers them without a number, in a table's own words", () => {
    renderBar({ selectAllMatching: { isPageSelected: true, hasMore: true } });

    expect(offer()).toHaveTextContent("Select All Exceptions");
  });

  test("while it reads them, the offer is busy - a spinner, and words that say so - and cannot start a second read", () => {
    const onSelectAll: MockFunction = getJestMockFunction();

    renderBar({
      onSelectAllClick: onSelectAll,
      isSelectingAllItems: true,
      selectAllMatching: { isPageSelected: true, matchingCount: 4213 },
    });

    const button: HTMLElement = offer() as HTMLElement;

    /*
     * Busy, not disabled: a disabled button drops a keyboard's focus to the
     * page, so it says it cannot be pressed and ignores a press instead.
     */
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.querySelector("svg")).not.toBeNull();
    expect(button).toHaveTextContent(/^Selecting 4,213 exceptions…$/);

    fireEvent.click(button);

    expect(onSelectAll).not.toHaveBeenCalled();
  });

  test("past the ceiling, while it reads, it names the first of them it is reading", () => {
    renderBar({
      isSelectingAllItems: true,
      selectAllMatching: { isPageSelected: true, matchingCount: 12345 },
    });

    expect(offer()).toHaveTextContent(/^Selecting 10,000 exceptions…$/);
  });

  test("a list that only knows more rows follow says it is selecting them all, in a table's own words", () => {
    renderBar({
      isSelectingAllItems: true,
      selectAllMatching: { isPageSelected: true, hasMore: true },
    });

    expect(offer()).toHaveTextContent(/^Selecting All Exceptions\.\.\.$/);
  });

  test("its box is the count chip's - border, start padding, corners - so its words line up under the chip's on a phone", () => {
    const classes: Array<string> = BULK_ROW_SELECT_ALL_CLASS_NAME.split(" ");
    const chip: Array<string> = BULK_ROW_COUNT_CHIP_CLASS_NAME.split(" ");

    // The chip: a 1px border, 8px before its words, rounded-md.
    expect(chip).toEqual(
      expect.arrayContaining(["border", "pl-2", "rounded-md"]),
    );
    // The offer: the same border, kept clear, and the same 8px.
    expect(classes).toEqual(
      expect.arrayContaining([
        "border",
        "border-transparent",
        "px-2",
        "rounded-md",
      ]),
    );
    expect(classes).not.toContain("px-1.5");
  });

  test("pressed from the keyboard, the offer keeps the focus while it reads, then hands it to Bulk Actions", async () => {
    const props: ComponentProps<Row> = {
      selectedItems: ROWS,
      isAllItemsSelected: false,
      onSelectAllClick: () => {},
      onClearSelectionClick: () => {},
      singularLabel: "Exception",
      pluralLabel: "Exceptions",
      buttons: [ARCHIVE],
      itemToString: (row: Row): string => {
        return row.name;
      },
      layout: BulkUpdateBarLayout.Row,
      selectAllMatching: { isPageSelected: true, matchingCount: 4213 },
    };

    const view: RenderResult = render(<BulkUpdateForm<Row> {...props} />);

    offer()!.focus();
    expect(document.activeElement).toBe(offer());

    // Reading: still the offer that has the focus.
    view.rerender(
      <BulkUpdateForm<Row> {...props} isSelectingAllItems={true} />,
    );
    expect(document.activeElement).toBe(offer());

    // Every match selected: the offer is gone, and Bulk Actions is next.
    view.rerender(
      <BulkUpdateForm<Row>
        {...props}
        isSelectingAllItems={false}
        isAllItemsSelected={true}
        totalMatchingItemsCount={3}
        selectAllMatching={{ isPageSelected: true, matchingCount: 3 }}
      />,
    );
    expect(offer()).toBeNull();

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Bulk Actions" }),
      );
    });
  });

  test("an offer that goes while the focus is elsewhere moves nothing", async () => {
    const props: ComponentProps<Row> = {
      selectedItems: ROWS,
      isAllItemsSelected: false,
      onSelectAllClick: () => {},
      onClearSelectionClick: () => {},
      singularLabel: "Exception",
      pluralLabel: "Exceptions",
      buttons: [ARCHIVE],
      itemToString: (row: Row): string => {
        return row.name;
      },
      layout: BulkUpdateBarLayout.Row,
      selectAllMatching: { isPageSelected: true, matchingCount: 4213 },
    };

    const view: RenderResult = render(<BulkUpdateForm<Row> {...props} />);

    // A row's box was unticked: the focus is on it, not on the offer.
    const clear: HTMLElement = screen.getByTestId(BULK_ROW_CLEAR_TEST_ID);
    clear.focus();

    view.rerender(
      <BulkUpdateForm<Row>
        {...props}
        selectAllMatching={{ isPageSelected: false, matchingCount: 4213 }}
      />,
    );
    expect(offer()).toBeNull();

    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 10);
      });
    });

    expect(document.activeElement).toBe(clear);
  });

  test("once every match is selected, the count says so and the offer is gone", () => {
    renderBar({
      isAllItemsSelected: true,
      totalMatchingItemsCount: 3,
      selectAllMatching: { isPageSelected: true, matchingCount: 3 },
    });

    expect(screen.getByTestId(BULK_ROW_COUNT_TEST_ID)).toHaveTextContent(
      "All 3 selected",
    );
    expect(offer()).toBeNull();
    expect(screen.queryByText(/of 3 selected/)).toBeNull();
    expect(BULK_ALL_SELECTED_SHORT_COUNT).toEqual({
      one: "All {{count}} selected",
      other: "All {{count}} selected",
    });
  });

  test("a row unticked since: the count is a count of some of them again", () => {
    renderBar({
      selectedItems: ROWS.slice(0, 2),
      isAllItemsSelected: true,
      totalMatchingItemsCount: 3,
    });

    expect(screen.getByTestId(BULK_ROW_COUNT_TEST_ID)).toHaveTextContent(
      /^2 selected$/,
    );
  });

  test("stopped at the ceiling: the count says how many of how many, with no note under the line", () => {
    renderBar({
      isAllItemsSelected: true,
      isSelectionTruncated: true,
      totalMatchingItemsCount: 12345,
    });

    expect(screen.getByTestId(BULK_ROW_COUNT_TEST_ID)).toHaveTextContent(
      /^3 of 12,345 selected$/,
    );
    // The three sentences that said it under the line are gone from it.
    expect(
      screen.queryByText(/You can only select/, { exact: false }),
    ).toBeNull();
    expect(BULK_SELECTED_OF_MATCHING_SHORT_COUNT).toEqual({
      one: "{{count}} of {{total}} selected",
      other: "{{count}} of {{total}} selected",
    });
  });

  test("stopped at the ceiling, the first of them are not offered again (a regression: the same read again)", () => {
    const onSelectAll: MockFunction = getJestMockFunction();

    /*
     * "Select the first 10,000 of 12,345 exceptions" taken: every row on
     * the page is still ticked and 12,345 still match - and the offer stayed
     * beside "10,000 selected", to read the same 10,000 again.
     */
    renderBar({
      onSelectAllClick: onSelectAll,
      isAllItemsSelected: true,
      isSelectionTruncated: true,
      totalMatchingItemsCount: 12345,
      selectAllMatching: { isPageSelected: true, matchingCount: 12345 },
    });

    expect(offer()).toBeNull();
    expect(screen.queryByText(/Select the first/, { exact: false })).toBeNull();
    expect(onSelectAll).not.toHaveBeenCalled();
  });

  test("a table's selection stopped at the ceiling, a row unticked since: still how many of how many, nothing offered", () => {
    // A table keeps its select-all's state while rows are unticked.
    renderBar({
      selectedItems: ROWS.slice(0, 2),
      isAllItemsSelected: true,
      isSelectionTruncated: true,
      totalMatchingItemsCount: 12345,
      selectAllMatching: { isPageSelected: true, matchingCount: 12345 },
    });

    expect(screen.getByTestId(BULK_ROW_COUNT_TEST_ID)).toHaveTextContent(
      /^2 of 12,345 selected$/,
    );
    expect(offer()).toBeNull();
  });

  test("on a phone the offer takes a line of its own under the count, and Bulk Actions keeps the first line's end", () => {
    renderBar({
      selectAllMatching: { isPageSelected: true, matchingCount: 4213 },
      errorMessage: "Could not read the exceptions.",
    });

    const slot: HTMLElement = (offer() as HTMLElement).parentElement!;

    expect(slot.className).toBe(BULK_ROW_SELECT_ALL_SLOT_CLASS_NAME);
    expect(BULK_ROW_SELECT_ALL_SLOT_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining(["max-sm:order-1", "max-sm:basis-full"]),
    );
    // The first line keeps the count and Bulk Actions, in the order drawn.
    expect(
      screen.getByTestId(BULK_ROW_ACTIONS_TEST_ID).className.split(" "),
    ).not.toEqual(expect.arrayContaining([expect.stringMatching(/order-/)]));
    // The failure comes after the offer's line on a phone.
    expect(screen.getByRole("alert")).toHaveClass("order-3");
  });

  test("a read that failed says why under the line, in its small type, with the offer still there to try again", () => {
    const onSelectAll: MockFunction = getJestMockFunction();

    renderBar({
      onSelectAllClick: onSelectAll,
      selectAllMatching: { isPageSelected: true, matchingCount: 4213 },
      errorMessage:
        "Error connecting to server. Please try again in few minutes.",
    });

    const alert: HTMLElement = screen.getByRole("alert");

    expect(alert).toBe(screen.getByTestId(BULK_ROW_ERROR_TEST_ID));
    expect(alert).toHaveTextContent(
      "Error connecting to server. Please try again in few minutes.",
    );
    expect(alert.className).toBe(BULK_ROW_ERROR_CLASS_NAME);
    // A line of the line's own small type, not a box heavier than the line.
    expect(BULK_ROW_ERROR_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining(["basis-full", "text-xs", "text-red-700"]),
    );
    for (const heavy of ["rounded-lg", "bg-red-50", "p-3", "text-sm"]) {
      expect(BULK_ROW_ERROR_CLASS_NAME.split(" ")).not.toContain(heavy);
    }
    // Marked with the alert icon, beside the words.
    expect(alert.querySelector("svg")).not.toBeNull();
    expect(screen.getByTestId(BULK_ROW_TEST_ID)).toContainElement(alert);
    /*
     * The server's words, often English, read the way they are written:
     * on a Persian page their full stop stays at their end.
     */
    expect(alert.querySelector("bdi")).toHaveAttribute("dir", "ltr");

    // The offer is still there, and tries again.
    fireEvent.click(offer()!);

    expect(onSelectAll).toHaveBeenCalledTimes(1);
  });
});

describe("a list's header line drawn in a line of its host's (rowContainer)", () => {
  test("is drawn into the element its host hands it, and nowhere else", () => {
    const band: HTMLDivElement = document.createElement("div");
    document.body.appendChild(band);

    const view: RenderResult = renderBar({ rowContainer: band });

    expect(band).toContainElement(screen.getByTestId(BULK_ROW_TEST_ID));
    expect(view.container).not.toContainElement(
      screen.getByTestId(BULK_ROW_TEST_ID),
    );

    view.unmount();
    band.remove();
  });

  test("with nowhere to go yet, draws no line", () => {
    renderBar({ rowContainer: null });

    expect(screen.queryByTestId(BULK_ROW_TEST_ID)).toBeNull();
  });

  test("a run's dialog stays with the bar when its line has nowhere to go any more", async () => {
    const band: HTMLDivElement = document.createElement("div");
    document.body.appendChild(band);
    const onEnd: MockFunction = getJestMockFunction();

    const props: ComponentProps<Row> = {
      selectedItems: ROWS,
      isAllItemsSelected: false,
      onSelectAllClick: () => {},
      onClearSelectionClick: () => {},
      singularLabel: "Exception",
      pluralLabel: "Exceptions",
      buttons: [ARCHIVE],
      itemToString: (row: Row): string => {
        return row.name;
      },
      layout: BulkUpdateBarLayout.Row,
      rowContainer: band,
      onActionEnd: onEnd,
    };

    const view: RenderResult = render(<BulkUpdateForm<Row> {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Bulk Actions" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    });

    const dialog: HTMLElement = await screen.findByRole("dialog");
    expect(band).not.toContainElement(dialog);

    // The band left the page (the list emptied under the result).
    view.rerender(<BulkUpdateForm<Row> {...props} rowContainer={null} />);
    band.remove();

    expect(screen.queryByTestId(BULK_ROW_TEST_ID)).toBeNull();
    expect(screen.getByRole("dialog")).toBe(dialog);
    await waitFor(() => {
      expect(within(dialog).getByText("3 Exceptions succeeded")).toBeVisible();
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
