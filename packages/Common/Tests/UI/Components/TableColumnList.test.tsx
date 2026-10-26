import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React, { ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import TableColumnListComponent, {
  getTableColumnListMoreText,
  getTableColumnListVisibleCount,
  TABLE_COLUMN_LIST_TOGGLE_CLASS_NAME,
  TABLE_COLUMN_LIST_TOGGLE_LINE_CLASS_NAME,
  TABLE_COLUMN_LIST_VISIBLE_COUNT,
} from "../../../UI/Components/TableColumnList/TableColumnListComponent";
import {
  createTranslator,
  PluralTemplate,
} from "../../../UI/Utils/TranslateTemplate";

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

/*
 * The list's fold is one sentence with its count ("{{count}} more
 * resources"), looked up whole; the labels' sentence is left untranslated
 * here, so it reads as the English it falls back to.
 */
const GERMAN: Record<string, string> = {
  "No labels attached.": "Keine Labels zugeordnet.",
  "Show less": "Weniger anzeigen",
  "{{count}} more resources": "{{count}} weitere Ressourcen",
  "{{count}} more resources_one": "{{count}} weitere Ressource",
};

const LABELS_MORE: PluralTemplate = {
  one: "{{count}} more label",
  other: "{{count}} more labels",
};

const RESOURCES_MORE: PluralTemplate = {
  one: "{{count}} more resource",
  other: "{{count}} more resources",
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
      moreTemplate={LABELS_MORE}
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
   * The fold is the list's own sentence, count and words together, looked
   * up whole: "2 weitere Ressourcen".
   */
  test("the fold's sentence is looked up whole, in the reader's language", () => {
    render(
      <TableColumnListComponent<Item>
        items={items("EU", "Night", "Desk", "Pager", "Voice")}
        moreTemplate={RESOURCES_MORE}
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
        moreTemplate={LABELS_MORE}
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

  test("the count is the one the fold hides, and the open list folds back to the same sentence", () => {
    render(
      <TableColumnListComponent<Item>
        items={items("A", "B", "C", "D", "E", "F")}
        moreTemplate={RESOURCES_MORE}
        noItemsMessage="No resources."
        getEachElement={(item: Item): ReactElement => {
          return <span data-testid="item">{item.name}</span>;
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "3 weitere Ressourcen" }),
    );
    expect(shownItems()).toEqual(["A", "B", "C", "D", "E", "F"]);
    fireEvent.click(screen.getByRole("button", { name: "Weniger anzeigen" }));
    expect(
      screen.getByRole("button", { name: "3 weitere Ressourcen" }),
    ).toBeInTheDocument();
  });
});

/*
 * The fold's words are one sentence in each language, with that language's
 * plural forms: a count followed by words looked up on their own read "2
 * ещё мониторов" in Russian and "2 件のモニター（ほか）" in Japanese, and kept
 * the words English in every language but German and Spanish.
 */
describe("the fold's sentence, in every language's plural forms", () => {
  const MONITORS: PluralTemplate = {
    one: "{{count}} more monitor",
    other: "{{count}} more monitors",
  };

  function moreText(
    language: string,
    words: Record<string, string>,
    count: number,
  ): string {
    return getTableColumnListMoreText({
      translator: createTranslator((key: string): string | undefined => {
        return words[key];
      }, language),
      template: MONITORS,
      count: count,
    });
  }

  test("English: the template's own two forms", () => {
    expect(moreText("en", {}, 2)).toBe("2 more monitors");
    expect(moreText("en", {}, 1)).toBe("1 more monitor");
    expect(moreText("en", {}, 12)).toBe("12 more monitors");
  });

  test("Russian: its general form for 2, 5 and 11, its 'one' form for 21", () => {
    const words: Record<string, string> = {
      "{{count}} more monitors": "Ещё мониторов: {{count}}",
      "{{count}} more monitors_one": "Ещё {{count}} монитор",
    };

    expect(moreText("ru", words, 2)).toBe("Ещё мониторов: 2");
    expect(moreText("ru", words, 5)).toBe("Ещё мониторов: 5");
    expect(moreText("ru", words, 11)).toBe("Ещё мониторов: 11");
    expect(moreText("ru", words, 21)).toBe("Ещё 21 монитор");
  });

  test("Japanese, Korean and Chinese: one form, the count inside the sentence", () => {
    expect(
      moreText(
        "ja",
        { "{{count}} more monitors": "ほか {{count}} 件のモニター" },
        2,
      ),
    ).toBe("ほか 2 件のモニター");
    expect(
      moreText("ko", { "{{count}} more monitors": "모니터 {{count}}개 더" }, 3),
    ).toBe("모니터 3개 더");
    expect(
      moreText(
        "zh-CN",
        { "{{count}} more monitors": "另外 {{count}} 个监视器" },
        4,
      ),
    ).toBe("另外 4 个监视器");
  });

  test("German writes a big count its own way", () => {
    expect(
      moreText(
        "de",
        { "{{count}} more monitors": "{{count}} weitere Monitore" },
        1234,
      ),
    ).toBe("1.234 weitere Monitore");
  });

  test("a language that left the sentence in English reads the English sentence, not a count glued to English words", () => {
    expect(
      moreText(
        "fr",
        { "{{count}} more monitors": "{{count}} more monitors" },
        2,
      ),
    ).toBe("2 more monitors");
    expect(moreText("fr", {}, 2)).toBe("2 more monitors");
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
        moreTemplate={LABELS_MORE}
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
