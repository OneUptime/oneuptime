import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React, { ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import TableColumnListComponent from "../../../UI/Components/TableColumnList/TableColumnListComponent";

/*
 * The list a table cell draws for a row's labels (LabelsElement) and similar
 * many-valued columns: three items, then "N more".
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
    render(list(items("A", "B", "C", "D")));

    expect(
      screen.getByRole("button", { name: "1 more labels" }),
    ).toBeInTheDocument();
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
