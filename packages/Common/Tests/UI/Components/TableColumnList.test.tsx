import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React, { ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import TableColumnListComponent, {
  getTableColumnListVisibleCount,
  TABLE_COLUMN_LIST_TOGGLE_CLASS_NAME,
  TABLE_COLUMN_LIST_TOGGLE_LINE_CLASS_NAME,
  TABLE_COLUMN_LIST_VISIBLE_COUNT,
} from "../../../UI/Components/TableColumnList/TableColumnListComponent";

/*
 * The list a table cell draws for a row's labels (LabelsElement) and similar
 * many-valued columns: three items, then "N more" - or all four, when "N
 * more" would hide just one (OneUptime issue #5187: a monitor's fourth
 * label, behind "1 more label" on every row).
 *
 * A table reuses a row's cell for whichever row lands in its place, so one
 * mounted list goes from some items to none and back when the table is
 * filtered, searched or paged. Every hook has to run on every render: a hook
 * below the empty-list return made React throw "Rendered fewer hooks than
 * expected" and the whole table vanish (the Incoming Call Policies offline
 * suite caught it when its Enabled filter left a row without labels).
 *
 * i18next is set up the way the Dashboard sets it up. Without an instance,
 * useTranslation() returns before calling any hook of its own, and React
 * cannot notice a hook count that changes from zero, so the crash only shows
 * with translations switched on.
 */

const GERMAN: Record<string, string> = {
  "No labels attached.": "Keine Labels zugeordnet.",
  "Show less": "Weniger anzeigen",
  "more resources": "weitere Ressourcen",
};

interface Item {
  name: string;
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: false,
    resources: { de: { translation: GERMAN } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

function items(...names: Array<string>): Array<Item> {
  return names.map((name: string): Item => {
    return { name };
  });
}

function list(listItems: Array<Item>): ReactElement {
  return (
    <TableColumnListComponent<Item>
      items={listItems}
      moreText="more labels"
      noItemsMessage="No labels attached."
      getEachElement={(item: Item): ReactElement => {
        return <span data-testid="item">{item.name}</span>;
      }}
    />
  );
}

function shownItems(): Array<string> {
  return screen.queryAllByTestId("item").map((item: HTMLElement): string => {
    return item.textContent || "";
  });
}

describe("TableColumnListComponent", () => {
  test("one mounted list goes from items to none and back without throwing", () => {
    const { rerender } = render(list(items("Production", "Finance")));
    expect(shownItems()).toEqual(["Production", "Finance"]);

    rerender(list([]));
    expect(shownItems()).toEqual([]);
    expect(screen.getByText("Keine Labels zugeordnet.")).toBeInTheDocument();

    rerender(list(items("EU", "Night", "Desk", "Pager", "Voice")));
    expect(shownItems()).toEqual(["EU", "Night", "Desk"]);
    expect(
      screen.getByRole("button", { name: "2 more labels" }),
    ).toBeInTheDocument();

    rerender(list([]));
    expect(shownItems()).toEqual([]);
    expect(screen.getByText("Keine Labels zugeordnet.")).toBeInTheDocument();
  });

  test("the more button reveals the rest, and Show less folds them again", () => {
    render(list(items("A", "B", "C", "D", "E")));
    expect(shownItems()).toEqual(["A", "B", "C"]);

    fireEvent.click(screen.getByRole("button", { name: "2 more labels" }));
    expect(shownItems()).toEqual(["A", "B", "C", "D", "E"]);
    expect(
      screen.queryByRole("button", { name: "2 more labels" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Weniger anzeigen" }));
    expect(shownItems()).toEqual(["A", "B", "C"]);
  });

  /*
   * The words after the count are the page's, and the locale files have
   * them ("more resources": "weitere Ressourcen"). The whole title is no
   * key, so they were never looked up: German read "2 more resources".
   */
  test("the words after the count are looked up in the reader's language", () => {
    render(
      <TableColumnListComponent<Item>
        items={items("EU", "Night", "Desk", "Pager", "Voice")}
        moreText="more resources"
        noItemsMessage="No resources."
        getEachElement={(item: Item): ReactElement => {
          return <span data-testid="item">{item.name}</span>;
        }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "2 weitere Ressourcen" }),
    ).toBeInTheDocument();
  });

  test("words with no translation stay as the page wrote them", () => {
    render(list(items("A", "B", "C", "D", "E")));

    expect(
      screen.getByRole("button", { name: "2 more labels" }),
    ).toBeInTheDocument();
  });

  /*
   * The "N more" button takes a line of its own, taller than an item's: a
   * fold that hid one item saved nothing and only hid it.
   */
  test("never folds a single item: four are all shown, five fold two", () => {
    render(list(items("A", "B", "C", "D")));

    expect(shownItems()).toEqual(["A", "B", "C", "D"]);
    expect(screen.queryByRole("button")).toBeNull();

    cleanup();

    render(list(items("A", "B", "C", "D", "E")));

    expect(shownItems()).toEqual(["A", "B", "C"]);
    expect(
      screen.getByRole("button", { name: "2 more labels" }),
    ).toBeInTheDocument();
  });

  test("how many of a list are shown before 'N more'", () => {
    expect(TABLE_COLUMN_LIST_VISIBLE_COUNT).toBe(3);
    expect(
      [0, 1, 2, 3, 4, 5, 6, 12].map((count: number): number => {
        return getTableColumnListVisibleCount(count);
      }),
    ).toEqual([0, 1, 2, 3, 4, 3, 3, 3]);

    // So "N more" always says two or more.
    for (let count: number = 0; count < 40; count++) {
      const folded: number = count - getTableColumnListVisibleCount(count);
      expect([count, folded === 0 || folded >= 2]).toEqual([count, true]);
    }
  });

  test("a page's test id names the list, its 'N more' and its 'Show less'", () => {
    render(
      <TableColumnListComponent<Item>
        items={items("A", "B", "C", "D", "E")}
        moreText="more labels"
        noItemsMessage="No labels attached."
        dataTestId="row-labels"
        getEachElement={(item: Item): ReactElement => {
          return <span data-testid="item">{item.name}</span>;
        }}
      />,
    );

    expect(screen.getByTestId("row-labels")).toContainElement(
      screen.getByTestId("row-labels-more"),
    );

    fireEvent.click(screen.getByTestId("row-labels-more"));

    expect(screen.queryByTestId("row-labels-more")).toBeNull();
    expect(screen.getByTestId("row-labels-less")).toHaveAccessibleName(
      "Weniger anzeigen",
    );
  });

  test("without a test id, the list and its buttons carry none", () => {
    const { container } = render(list(items("A", "B", "C", "D", "E")));

    expect(container.querySelector("[data-testid$='-more']")).toBeNull();
  });

  /*
   * A page that words the button as a sentence of its own - "1 more
   * template", "2 more templates", each language with its plural forms -
   * hands the count to getMoreText, and the button reads what it returns.
   */
  test("a page's own sentence for the count takes the place of count and words", () => {
    const counts: Array<number> = [];

    render(
      <TableColumnListComponent<Item>
        items={items("A", "B", "C", "D", "E", "F")}
        moreText="more labels"
        getMoreText={(count: number): string => {
          counts.push(count);
          return count === 1
            ? "1 weitere Vorlage"
            : `${count} weitere Vorlagen`;
        }}
        noItemsMessage="No labels attached."
        getEachElement={(item: Item): ReactElement => {
          return <span data-testid="item">{item.name}</span>;
        }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "3 weitere Vorlagen" }),
    ).toBeInTheDocument();
    expect(counts).toContain(3);

    fireEvent.click(screen.getByRole("button", { name: "3 weitere Vorlagen" }));
    expect(shownItems()).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(
      screen.getByRole("button", { name: "Weniger anzeigen" }),
    ).toBeInTheDocument();
  });
});

/*
 * "N more" and "Show less" are one button: it opens the list and folds it
 * again, so a keyboard that pressed it is still on it. They were two
 * buttons, one put in place of the other, and the focus fell to the page's
 * body as the one pressed went away. It sits on a 24px line of its own
 * under the items, in the indigo of the product's other show-more links -
 * not a padded button 36px tall in a grey that read at 2.5:1.
 */
describe("the button that opens and folds the list", () => {
  function toggle(): HTMLElement {
    return screen.getByRole("button");
  }

  test("is one button: pressing it keeps the focus on it, and it says which way it goes", () => {
    render(list(items("A", "B", "C", "D", "E")));

    const button: HTMLElement = toggle();

    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(button).toHaveAccessibleName("2 more labels");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-expanded", "false");

    button.focus();
    fireEvent.click(button);

    // The same element, still focused, now folding the list.
    expect(toggle()).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(button).toHaveAccessibleName("Weniger anzeigen");
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(shownItems()).toEqual(["A", "B", "C", "D", "E"]);

    fireEvent.click(button);

    expect(toggle()).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(button).toHaveAccessibleName("2 more labels");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(shownItems()).toEqual(["A", "B", "C"]);
  });

  test("its test id says which way it goes, on the same element", () => {
    render(
      <TableColumnListComponent<Item>
        items={items("A", "B", "C", "D", "E")}
        moreText="more labels"
        noItemsMessage="No labels attached."
        dataTestId="row-labels"
        getEachElement={(item: Item): ReactElement => {
          return <span data-testid="item">{item.name}</span>;
        }}
      />,
    );

    const more: HTMLElement = screen.getByTestId("row-labels-more");

    fireEvent.click(more);

    expect(screen.getByTestId("row-labels-less")).toBe(more);
    expect(screen.queryByTestId("row-labels-more")).toBeNull();
  });

  test("sits on a line of its own under the items, the list's last line", () => {
    render(list(items("A", "B", "C", "D", "E")));

    const button: HTMLElement = toggle();
    const line: HTMLElement = button.parentElement as HTMLElement;

    expect(line.className).toBe(TABLE_COLUMN_LIST_TOGGLE_LINE_CLASS_NAME);
    expect(line).toHaveClass("min-h-6");
    expect(line.parentElement?.lastElementChild).toBe(line);

    fireEvent.click(button);

    // Under every item once the list is open, still its last line.
    expect(line.parentElement?.lastElementChild).toBe(line);
    expect(
      screen.getAllByTestId("item").every((item: HTMLElement): boolean => {
        return Boolean(
          item.compareDocumentPosition(button) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        );
      }),
    ).toBe(true);
  });

  test("reads as the product's show-more link: small indigo words, underlined under the pointer, ringed inside its box for the keyboard", () => {
    render(list(items("A", "B", "C", "D", "E")));

    const button: HTMLElement = toggle();

    expect(button.className).toBe(TABLE_COLUMN_LIST_TOGGLE_CLASS_NAME);

    for (const token of [
      "text-xs",
      "font-medium",
      "text-indigo-600",
      "hover:text-indigo-700",
      "hover:underline",
      "focus-visible:ring-2",
      // A cell clips at the column's edges: a ring outside lost its left side.
      "focus-visible:ring-inset",
      "focus-visible:ring-indigo-500",
    ]) {
      expect([token, button.classList.contains(token)]).toEqual([token, true]);
    }

    // Not the grey that read at 2.5:1, nor the button's 36px of padding.
    for (const token of ["text-gray-400", "py-2", "px-3", "-ml-3", "md:ml-3"]) {
      expect([token, button.classList.contains(token)]).toEqual([token, false]);
    }
  });

  test("a list that shows every item has no button at all, nor its line", () => {
    const { container } = render(list(items("A", "B", "C", "D")));

    expect(screen.queryByRole("button")).toBeNull();
    expect(
      Array.from(container.querySelectorAll("div")).filter(
        (element: HTMLDivElement): boolean => {
          return element.className === TABLE_COLUMN_LIST_TOGGLE_LINE_CLASS_NAME;
        },
      ),
    ).toEqual([]);
  });
});
