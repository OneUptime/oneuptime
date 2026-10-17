import { afterEach, describe, expect, test } from "@jest/globals";
import {
  ROW_CONTROL_SELECTOR,
  RowClickEventLike,
  hasTextSelection,
  isNewTabClick,
  isRowOpeningClick,
} from "../../../../UI/Components/Table/RowClick";

/*
 * A row that opens its record on a click anywhere on it, without taking a
 * click that belongs to something inside it (Common/UI/Components/Table/
 * RowClick.ts). Real DOM nodes, so the decision is tested on what a browser
 * hands the row's handler: a target inside the row (or not), a button.
 */

interface RowFixture {
  row: HTMLElement;
  text: HTMLElement;
  textNode: Text;
}

type BuildRowFunction = (innerHtml?: string) => RowFixture;

const buildRow: BuildRowFunction = (innerHtml?: string): RowFixture => {
  const table: HTMLTableElement = document.createElement("table");
  const body: HTMLTableSectionElement = document.createElement("tbody");
  const row: HTMLTableRowElement = document.createElement("tr");
  const cell: HTMLTableCellElement = document.createElement("td");
  const text: HTMLSpanElement = document.createElement("span");

  text.textContent = "Checkout API";
  cell.appendChild(text);
  row.appendChild(cell);

  if (innerHtml) {
    const extra: HTMLTableCellElement = document.createElement("td");
    extra.innerHTML = innerHtml;
    row.appendChild(extra);
  }

  body.appendChild(row);
  table.appendChild(body);
  document.body.appendChild(table);

  return { row, text, textNode: text.firstChild as Text };
};

type ClickOnFunction = (
  row: HTMLElement,
  target: EventTarget | null,
  extra?: Partial<RowClickEventLike>,
) => RowClickEventLike;

const clickOn: ClickOnFunction = (
  row: HTMLElement,
  target: EventTarget | null,
  extra?: Partial<RowClickEventLike>,
): RowClickEventLike => {
  return {
    target: target,
    currentTarget: row,
    button: 0,
    defaultPrevented: false,
    ...extra,
  };
};

afterEach(() => {
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
});

describe("a click on the row itself opens the record", () => {
  test("on a value's element", () => {
    const { row, text } = buildRow();

    expect(
      isRowOpeningClick(clickOn(row, text), { hasTextSelection: false }),
    ).toBe(true);
  });

  test("on a value's text node (the target a click on words lands on)", () => {
    const { row, textNode } = buildRow();

    expect(
      isRowOpeningClick(clickOn(row, textNode), { hasTextSelection: false }),
    ).toBe(true);
  });

  test("on the cell's padding", () => {
    const { row, text } = buildRow();

    expect(
      isRowOpeningClick(clickOn(row, text.parentElement), {
        hasTextSelection: false,
      }),
    ).toBe(true);
  });

  test("on a pill or an avatar, which do nothing of their own", () => {
    const { row } = buildRow(
      '<span data-testid="pill"><span>Operational</span></span><div class="h-6 w-6 rounded-full">AL</div>',
    );

    for (const selector of ['[data-testid="pill"] span', "div.rounded-full"]) {
      expect(
        isRowOpeningClick(clickOn(row, row.querySelector(selector)), {
          hasTextSelection: false,
        }),
      ).toBe(true);
    }
  });

  test("with the middle button (to a new tab)", () => {
    const { row, text } = buildRow();

    expect(
      isRowOpeningClick(clickOn(row, text, { button: 1 }), {
        hasTextSelection: false,
      }),
    ).toBe(true);
  });
});

describe("a click on a control inside the row is that control's", () => {
  const CONTROLS: Array<[string, string, string]> = [
    ["a link", '<a href="/incidents/2"><span>INC-2</span></a>', "a span"],
    ["a button (View, the ⋯)", "<button><span>View</span></button>", "button span"],
    ["a select box", '<input type="checkbox" />', "input"],
    ["a label", "<label><span>Select</span></label>", "label span"],
    ["a dropdown", "<select><option>1</option></select>", "select"],
    ["a text field", "<textarea></textarea>", "textarea"],
    ["a drag grip", '<span role="button" tabindex="0"><svg></svg></span>', '[role="button"]'],
    ["a link drawn as a button", '<span role="link">Docs</span>', '[role="link"]'],
    ["a menu item", '<div role="menuitem"><span>Edit</span></div>', '[role="menuitem"] span'],
    ["a checkbox role", '<div role="checkbox"></div>', '[role="checkbox"]'],
    ["a switch", '<div role="switch"></div>', '[role="switch"]'],
    ["a disclosure", "<details><summary>More</summary></details>", "summary"],
    [
      "a cell a page marks as its own (a column's help)",
      '<div data-row-click-ignore="true"><span>?</span></div>',
      "[data-row-click-ignore] span",
    ],
    [
      "editable text",
      '<div contenteditable="true"><span>note</span></div>',
      '[contenteditable="true"] span',
    ],
  ];

  test.each(CONTROLS)("%s", (_label: string, html: string, selector: string) => {
    const { row } = buildRow(html);
    const target: Element | null = row.querySelector(selector);

    expect(target).not.toBeNull();
    expect(
      isRowOpeningClick(clickOn(row, target), { hasTextSelection: false }),
    ).toBe(false);
  });

  test("the selector covers every kind of control above", () => {
    for (const part of [
      "a[href]",
      "button",
      "input",
      "select",
      "textarea",
      "label",
      "summary",
      "[role='button']",
      "[role='link']",
      "[role='menuitem']",
      "[role='checkbox']",
      "[role='switch']",
      "[data-row-click-ignore]",
    ]) {
      expect([part, ROW_CONTROL_SELECTOR.includes(part)]).toEqual([part, true]);
    }
  });

  test("an <a> without an address does nothing, so a click on it opens the row", () => {
    const { row } = buildRow("<a><span>plain</span></a>");

    expect(
      isRowOpeningClick(clickOn(row, row.querySelector("a span")), {
        hasTextSelection: false,
      }),
    ).toBe(true);
  });

  test("a control around the whole table does not make every row inert", () => {
    const wrapper: HTMLLabelElement = document.createElement("label");
    document.body.appendChild(wrapper);
    const { row, text } = buildRow();
    wrapper.appendChild(row.closest("table") as HTMLElement);

    expect(
      isRowOpeningClick(clickOn(row, text), { hasTextSelection: false }),
    ).toBe(true);
  });
});

describe("a click that is not the row's", () => {
  test("lands outside the row's own elements - a menu or a dialog drawn in document.body", () => {
    const { row } = buildRow();
    const portal: HTMLDivElement = document.createElement("div");
    portal.innerHTML = '<div class="modal-backdrop"><p>Delete?</p></div>';
    document.body.appendChild(portal);

    expect(
      isRowOpeningClick(clickOn(row, portal.querySelector("p")), {
        hasTextSelection: false,
      }),
    ).toBe(false);
  });

  test("was handled already", () => {
    const { row, text } = buildRow();

    expect(
      isRowOpeningClick(clickOn(row, text, { defaultPrevented: true }), {
        hasTextSelection: false,
      }),
    ).toBe(false);
  });

  test("is the right button (a context menu)", () => {
    const { row, text } = buildRow();

    expect(
      isRowOpeningClick(clickOn(row, text, { button: 2 }), {
        hasTextSelection: false,
      }),
    ).toBe(false);
  });

  test("ends a drag over a value's text, to copy it", () => {
    const { row, text } = buildRow();

    expect(
      isRowOpeningClick(clickOn(row, text), { hasTextSelection: true }),
    ).toBe(false);
  });

  test("has no target or no row", () => {
    const { row, text } = buildRow();

    expect(
      isRowOpeningClick(clickOn(row, null), { hasTextSelection: false }),
    ).toBe(false);
    expect(
      isRowOpeningClick(
        { target: text, currentTarget: null, button: 0 },
        { hasTextSelection: false },
      ),
    ).toBe(false);
  });
});

describe("the reader's text selection", () => {
  test("nothing selected", () => {
    window.getSelection()?.removeAllRanges();

    expect(hasTextSelection()).toBe(false);
  });

  test("a value's words selected", () => {
    const { text, textNode, row } = buildRow();
    const range: Range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 8);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    expect(hasTextSelection()).toBe(true);
    // And the decision reads it when it is not handed one.
    expect(isRowOpeningClick(clickOn(row, text))).toBe(false);
  });

  test("a selection that is only blank space does not count", () => {
    const { row } = buildRow("<span> </span>");
    const blank: Text = row.querySelectorAll("span")[1]!.firstChild as Text;
    const range: Range = document.createRange();
    range.setStart(blank, 0);
    range.setEnd(blank, 1);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    expect(hasTextSelection()).toBe(false);
  });
});

describe("a new tab", () => {
  const CASES: Array<[string, Partial<RowClickEventLike>, boolean]> = [
    ["a plain click", {}, false],
    ["Cmd held", { metaKey: true }, true],
    ["Ctrl held", { ctrlKey: true }, true],
    ["Shift held", { shiftKey: true }, true],
    ["the middle button", { button: 1 }, true],
  ];

  test.each(CASES)(
    "%s",
    (_label: string, extra: Partial<RowClickEventLike>, expected: boolean) => {
      const { row, text } = buildRow();

      expect(isNewTabClick(clickOn(row, text, extra))).toBe(expected);
    },
  );
});
