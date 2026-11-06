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
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import BulkUpdateForm, {
  BULK_ACTIONS_TRIGGER_SELECTOR,
  BULK_CARD_COUNT_TEST_ID,
  BULK_CARD_SELECT_ALL_TEST_ID,
  BULK_ROW_ACTIONS_TEST_ID,
  BULK_SELECTED_OF_MATCHING_SHORT_COUNT,
  BulkActionButtonSchema,
  BulkUpdateBarLayout,
  ComponentProps,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import IconProp from "../../../Types/Icon/IconProp";

/*
 * A DESKTOP TABLE'S BULK BAR (BulkUpdateBarLayout.Card): ITS SELECT ALL AND
 * ITS COUNT AT THE CEILING.
 *
 * #5587's follow-ups: "a desktop table's grey Card bar still disables Select
 * All while it reads every match, so the keyboard loses its place, and still
 * shows the long ceiling note" - where the phone's band (the Row) and the
 * exceptions list already kept the focus (aria-disabled) and said "10,000
 * of 12,345 selected".
 *
 *   - Select All pressed from the keyboard keeps the focus while it reads:
 *     busy - its spinner, "Selecting All Monitors..." - and refusing a
 *     second press, but not disabled, since a disabled button drops the
 *     focus to the page (Chromium does; jsdom keeps it, so the browser suite
 *     ModelTables/CardsBulkLine.spec.ts reads the focus there too). Once
 *     every match is selected the button is gone, and the focus moves on to
 *     Bulk Actions, the next thing to do - or Clear Selection where there
 *     are no Bulk Actions - never back to the top of the page.
 *   - A select-all stopped at the most one selection holds says so in its
 *     count, as the Row does: "10,000 of 12,345 selected". The three
 *     sentences under the bar ("Selected 10,000 of 12,345 matching
 *     monitors. You can only select 10,000 monitors at a time, for
 *     performance reasons, ...") are gone.
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

const rowsOf: (count: number) => Array<Row> = (count: number): Array<Row> => {
  const rows: Array<Row> = [];

  for (let index: number = 0; index < count; index++) {
    rows.push({ _id: `id-${index}`, name: `Monitor ${index}` });
  }

  return rows;
};

const DISABLE: BulkActionButtonSchema<Row> = {
  title: "Disable",
  icon: IconProp.Stop,
  buttonStyleType: ButtonStyleType.NORMAL,
  onClick: (): Promise<void> => {
    return Promise.resolve();
  },
};

const baseProps: (
  overrides?: Partial<ComponentProps<Row>>,
) => ComponentProps<Row> = (
  overrides?: Partial<ComponentProps<Row>>,
): ComponentProps<Row> => {
  return {
    selectedItems: rowsOf(3),
    isAllItemsSelected: false,
    onSelectAllClick: () => {},
    onClearSelectionClick: () => {},
    singularLabel: "Monitor",
    pluralLabel: "Monitors",
    buttons: [DISABLE],
    itemToString: (row: Row): string => {
      return row.name;
    },
    ...overrides,
  };
};

const selectAll: () => HTMLElement | null = (): HTMLElement | null => {
  return screen.queryByTestId(BULK_CARD_SELECT_ALL_TEST_ID);
};

const bulkActions: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("button", { name: /Bulk Actions/ });
};

// Long enough for the hand-off's timer (a 0 ms setTimeout) to run.
const aMomentLater: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 10);
    });
  });
};

afterEach(() => {
  cleanup();
});

describe("a desktop table's Select All keeps the keyboard's place", () => {
  test("it is the Card's: the bar a table's rows have when no layout is asked for", () => {
    render(<BulkUpdateForm<Row> {...baseProps()} />);

    expect(selectAll()).not.toBeNull();
    expect(selectAll()).toHaveTextContent(/^Select All Monitors$/);
    // Not the Row's line.
    expect(screen.queryByTestId(BULK_ROW_ACTIONS_TEST_ID)).toBeNull();
  });

  test("while it reads every match it is busy - a spinner, words that say so - and refuses a second press, but is not disabled", () => {
    const onSelectAllClick: MockFunction = getJestMockFunction();

    render(
      <BulkUpdateForm<Row>
        {...baseProps({
          isSelectingAllItems: true,
          onSelectAllClick: onSelectAllClick as unknown as () => void,
        })}
      />,
    );

    const button: HTMLElement = selectAll() as HTMLElement;

    // Busy, not disabled: a disabled button drops the focus to the page.
    expect(button).not.toBeDisabled();
    expect(button).not.toHaveAttribute("disabled");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveTextContent(/^Selecting All Monitors\.\.\.$/);
    expect(button.querySelector("svg")).not.toBeNull();
    // No pointer that promises a press it refuses.
    expect(button.className.split(" ")).toContain("cursor-default");

    fireEvent.click(button);

    expect(onSelectAllClick).not.toHaveBeenCalled();
  });

  test("at rest it is an ordinary button: pressable, nothing said about being busy", () => {
    const onSelectAllClick: MockFunction = getJestMockFunction();

    render(
      <BulkUpdateForm<Row>
        {...baseProps({
          onSelectAllClick: onSelectAllClick as unknown as () => void,
        })}
      />,
    );

    const button: HTMLElement = selectAll() as HTMLElement;

    expect(button).not.toHaveAttribute("aria-disabled");
    expect(button).not.toHaveAttribute("aria-busy");
    expect(button.className.split(" ")).not.toContain("cursor-default");

    fireEvent.click(button);

    expect(onSelectAllClick).toHaveBeenCalledTimes(1);
  });

  test("pressed from the keyboard it keeps the focus while it reads, then hands it to Bulk Actions", async () => {
    const props: ComponentProps<Row> = baseProps();
    const view: RenderResult = render(<BulkUpdateForm<Row> {...props} />);

    selectAll()!.focus();
    expect(document.activeElement).toBe(selectAll());

    // Reading: still Select All that has the focus.
    view.rerender(
      <BulkUpdateForm<Row> {...props} isSelectingAllItems={true} />,
    );
    expect(document.activeElement).toBe(selectAll());

    // Every match selected: Select All is gone, and Bulk Actions is next.
    view.rerender(
      <BulkUpdateForm<Row>
        {...props}
        selectedItems={rowsOf(34)}
        isSelectingAllItems={false}
        isAllItemsSelected={true}
        totalMatchingItemsCount={34}
      />,
    );
    expect(selectAll()).toBeNull();

    await waitFor(() => {
      expect(document.activeElement).toBe(bulkActions());
    });
  });

  test("with no Bulk Actions to offer, the focus moves on to Clear Selection", async () => {
    const props: ComponentProps<Row> = baseProps({ buttons: [] });
    const view: RenderResult = render(<BulkUpdateForm<Row> {...props} />);

    selectAll()!.focus();

    view.rerender(
      <BulkUpdateForm<Row>
        {...props}
        selectedItems={rowsOf(34)}
        isAllItemsSelected={true}
        totalMatchingItemsCount={34}
      />,
    );
    expect(selectAll()).toBeNull();

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: /Clear Selection/ }),
      );
    });
  });

  test("a Select All that goes while the focus is elsewhere moves nothing", async () => {
    const props: ComponentProps<Row> = baseProps();
    const view: RenderResult = render(<BulkUpdateForm<Row> {...props} />);

    const clear: HTMLElement = screen.getByRole("button", {
      name: /Clear Selection/,
    });
    clear.focus();

    view.rerender(
      <BulkUpdateForm<Row>
        {...props}
        selectedItems={rowsOf(34)}
        isAllItemsSelected={true}
        totalMatchingItemsCount={34}
      />,
    );
    expect(selectAll()).toBeNull();

    await aMomentLater();

    expect(document.activeElement).toBe(clear);
  });

  test("a read that fails leaves Select All where it was, with the focus on it, to try again", async () => {
    const props: ComponentProps<Row> = baseProps();
    const view: RenderResult = render(<BulkUpdateForm<Row> {...props} />);

    selectAll()!.focus();

    view.rerender(
      <BulkUpdateForm<Row> {...props} isSelectingAllItems={true} />,
    );
    view.rerender(
      <BulkUpdateForm<Row>
        {...props}
        isSelectingAllItems={false}
        errorMessage="Network request failed"
      />,
    );

    await aMomentLater();

    expect(selectAll()).not.toBeNull();
    expect(document.activeElement).toBe(selectAll());
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Network request failed",
    );
  });

  test("Bulk Actions' trigger in the Card is the menu's button-like wrapper, which the hand-off finds", () => {
    render(<BulkUpdateForm<Row> {...baseProps()} />);

    const trigger: HTMLElement = bulkActions();

    expect(trigger.matches(BULK_ACTIONS_TRIGGER_SELECTOR)).toBe(true);
    // Reachable from the keyboard.
    expect(trigger.tabIndex).toBe(0);
  });
});

describe("a desktop table's count at the ceiling", () => {
  test("a select-all stopped at the most one selection holds says how many of how many: the Row's words", () => {
    render(
      <BulkUpdateForm<Row>
        {...baseProps({
          selectedItems: rowsOf(LIMIT_PER_PROJECT),
          isAllItemsSelected: true,
          isSelectionTruncated: true,
          totalMatchingItemsCount: 12345,
        })}
      />,
    );

    expect(screen.getByTestId(BULK_CARD_COUNT_TEST_ID)).toHaveTextContent(
      new RegExp(
        `^${LIMIT_PER_PROJECT.toLocaleString()} of ${(12345).toLocaleString()} selected$`,
      ),
    );
    // The same template the Row's chip reads.
    expect(BULK_SELECTED_OF_MATCHING_SHORT_COUNT.other).toBe(
      "{{count}} of {{total}} selected",
    );
  });

  test("and no note under the bar: the three sentences about the limit are gone", () => {
    const { container } = render(
      <BulkUpdateForm<Row>
        {...baseProps({
          selectedItems: rowsOf(LIMIT_PER_PROJECT),
          isAllItemsSelected: true,
          isSelectionTruncated: true,
          totalMatchingItemsCount: 12345,
        })}
      />,
    );

    expect(container.textContent).not.toMatch(/You can only select/);
    expect(container.textContent).not.toMatch(/for performance reasons/);
    expect(container.textContent).not.toMatch(/matching Monitors/);
  });

  test("a row unticked since the select-all: still how many of how many, as a table keeps its select-all's state", () => {
    render(
      <BulkUpdateForm<Row>
        {...baseProps({
          selectedItems: rowsOf(LIMIT_PER_PROJECT - 1),
          isAllItemsSelected: true,
          isSelectionTruncated: true,
          totalMatchingItemsCount: 12345,
        })}
      />,
    );

    expect(screen.getByTestId(BULK_CARD_COUNT_TEST_ID)).toHaveTextContent(
      new RegExp(
        `^${(LIMIT_PER_PROJECT - 1).toLocaleString()} of ${(12345).toLocaleString()} selected$`,
      ),
    );
    // Nothing more to offer: the same first 10,000 would be read again.
    expect(selectAll()).toBeNull();
  });

  test("a selection that is no select-all's counts as any other, whatever the last read said", () => {
    render(
      <BulkUpdateForm<Row>
        {...baseProps({
          selectedItems: rowsOf(7),
          isAllItemsSelected: false,
          isSelectionTruncated: true,
          totalMatchingItemsCount: 12345,
        })}
      />,
    );

    expect(screen.getByTestId(BULK_CARD_COUNT_TEST_ID)).toHaveTextContent(
      /^7 Monitors Selected$/,
    );
    expect(selectAll()).not.toBeNull();
  });

  test("every match selected under the ceiling is counted as ever, with the table's word", () => {
    render(
      <BulkUpdateForm<Row>
        {...baseProps({
          selectedItems: rowsOf(34),
          isAllItemsSelected: true,
          isSelectionTruncated: false,
          totalMatchingItemsCount: 34,
        })}
      />,
    );

    expect(screen.getByTestId(BULK_CARD_COUNT_TEST_ID)).toHaveTextContent(
      /^34 Monitors Selected$/,
    );
  });

  test("one selected is one Monitor, not one Monitors", () => {
    render(
      <BulkUpdateForm<Row> {...baseProps({ selectedItems: rowsOf(1) })} />,
    );

    expect(screen.getByTestId(BULK_CARD_COUNT_TEST_ID)).toHaveTextContent(
      /^1 Monitor Selected$/,
    );
  });

  test("the Row draws its own count, never the Card's", () => {
    render(
      <BulkUpdateForm<Row>
        {...baseProps({
          layout: BulkUpdateBarLayout.Row,
          selectedItems: rowsOf(LIMIT_PER_PROJECT),
          isAllItemsSelected: true,
          isSelectionTruncated: true,
          totalMatchingItemsCount: 12345,
        })}
      />,
    );

    expect(screen.queryByTestId(BULK_CARD_COUNT_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(BULK_CARD_SELECT_ALL_TEST_ID)).toBeNull();
  });
});
