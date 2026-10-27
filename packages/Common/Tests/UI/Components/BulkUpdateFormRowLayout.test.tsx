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
  BULK_ROW_ACTIONS_BUTTON_CLASS_NAME,
  BULK_ROW_ACTIONS_TEST_ID,
  BULK_ROW_CLEAR_TEST_ID,
  BULK_ROW_COUNT_CHIP_CLASS_NAME,
  BULK_ROW_COUNT_TEST_ID,
  BULK_ROW_TEST_ID,
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

  test("has no Select All, nor a bar of its own: the list's page box selects the page", () => {
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
