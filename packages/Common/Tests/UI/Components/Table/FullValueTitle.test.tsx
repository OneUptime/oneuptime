import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import {
  FULL_VALUE_TITLE_MAX_LENGTH,
  TABLE_FOLDED_MAIN_ATTRIBUTE,
  showFullValueWhenCutShort,
} from "../../../../UI/Components/Table/FullValueTitle";
import TableFoldedValues, {
  TABLE_FOLDED_VALUE_TEST_ID,
} from "../../../../UI/Components/Table/TableFoldedValues";

/*
 * A value cut short by its column shows in full under the pointer
 * (FullValueTitle). Where other columns' values are folded under a cell's
 * own (TableFoldedValues, TableFit), the tooltip names the cell's own value
 * only: an incident's title cut short showed, under the pointer, its labels
 * and its owners after it - which are on lines of their own already.
 *
 * jsdom lays nothing out: how wide each part is is handed to it here.
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

afterEach(() => {
  cleanup();
});

type SizeFunction = (
  element: Element,
  size: {
    scrollWidth?: number;
    clientWidth?: number;
    scrollHeight?: number;
    clientHeight?: number;
  },
) => void;

const size: SizeFunction = (
  element: Element,
  sizes: {
    scrollWidth?: number;
    clientWidth?: number;
    scrollHeight?: number;
    clientHeight?: number;
  },
): void => {
  for (const [key, value] of Object.entries(sizes)) {
    Object.defineProperty(element, key, { configurable: true, value: value });
  }
};

const TITLE: string =
  "Checkout requests time out for customers in every EU region";

function Cell(props: { children: React.ReactNode }): ReactElement {
  return (
    <div data-testid="value" onMouseEnter={showFullValueWhenCutShort}>
      {props.children}
    </div>
  );
}

describe("a value cut short shows in full under the pointer", () => {
  test("cut short on its line: its whole words are its title", () => {
    render(<Cell>{TITLE}</Cell>);

    const value: HTMLElement = screen.getByTestId("value");

    size(value, { scrollWidth: 640, clientWidth: 320 });
    fireEvent.mouseEnter(value);

    expect(value).toHaveAttribute("title", TITLE);
  });

  test("a value that fits gets no title repeating it, and loses one it had", () => {
    render(<Cell>Checkout API</Cell>);

    const value: HTMLElement = screen.getByTestId("value");

    value.title = "stale";
    size(value, { scrollWidth: 120, clientWidth: 320 });
    fireEvent.mouseEnter(value);

    expect(value).not.toHaveAttribute("title");
  });

  test("a title longer than a thousand characters says nothing more", () => {
    const long: string = "a".repeat(FULL_VALUE_TITLE_MAX_LENGTH + 200);

    render(<Cell>{long}</Cell>);

    const value: HTMLElement = screen.getByTestId("value");

    size(value, { scrollWidth: 9000, clientWidth: 320 });
    fireEvent.mouseEnter(value);

    expect(value.title).toHaveLength(FULL_VALUE_TITLE_MAX_LENGTH);
  });
});

describe("a cell with other columns' values folded under its own", () => {
  const FOLDED: ReactElement = (
    <Cell>
      <TableFoldedValues
        main={<span>{TITLE}</span>}
        folded={[
          { title: "Labels", content: <span>Customer facing, EU</span> },
          { title: "Owners", content: <span>Grace Hopper</span> },
        ]}
      />
    </Cell>
  );

  test("marks the line that is the cell's own value", () => {
    render(FOLDED);

    const main: Element | null = screen
      .getByTestId("value")
      .querySelector(`[${TABLE_FOLDED_MAIN_ATTRIBUTE}]`);

    expect(TABLE_FOLDED_MAIN_ATTRIBUTE).toBe("data-table-folded-main");
    expect(main).not.toBeNull();
    expect(main).toHaveTextContent(TITLE);
    // Its folded values are lines of their own, not part of it.
    expect(main?.textContent).not.toContain("Grace Hopper");
    expect(screen.getAllByTestId(TABLE_FOLDED_VALUE_TEST_ID)).toHaveLength(2);
  });

  test("its own value cut short: the tooltip is that value in full, over its line - not its labels and owners after it, nor over them", () => {
    render(FOLDED);

    const value: HTMLElement = screen.getByTestId("value");
    const main: Element = value.querySelector(
      `[${TABLE_FOLDED_MAIN_ATTRIBUTE}]`,
    ) as Element;

    // A title the cell had before it was folded is not left on it.
    value.title = "stale";

    // The cell's lines each fit their box; the title's line is cut.
    size(value, { scrollWidth: 320, clientWidth: 320 });
    size(main, { scrollWidth: 903, clientWidth: 320 });
    fireEvent.mouseEnter(value);

    expect(main).toHaveAttribute("title", TITLE);
    expect(value).not.toHaveAttribute("title");
    for (const line of screen.getAllByTestId(TABLE_FOLDED_VALUE_TEST_ID)) {
      expect(line).not.toHaveAttribute("title");
    }
  });

  test("its own value whole: no tooltip, however long the folded lines run", () => {
    render(FOLDED);

    const value: HTMLElement = screen.getByTestId("value");
    const main: Element = value.querySelector(
      `[${TABLE_FOLDED_MAIN_ATTRIBUTE}]`,
    ) as Element;

    // The folded lines wrap: the cell is taller than one line, and that is all.
    size(value, {
      scrollWidth: 320,
      clientWidth: 320,
      scrollHeight: 108,
      clientHeight: 80,
    });
    size(main, { scrollWidth: 300, clientWidth: 320 });
    (main as HTMLElement).title = "stale";
    fireEvent.mouseEnter(value);

    expect(value).not.toHaveAttribute("title");
    expect(main).not.toHaveAttribute("title");
  });

  test("a cell whose folded values all have nothing to say is drawn as its value alone, its tooltip as any other's", () => {
    render(
      <Cell>
        <TableFoldedValues
          main={<span>{TITLE}</span>}
          folded={[{ title: "Labels", content: null }]}
        />
      </Cell>,
    );

    const value: HTMLElement = screen.getByTestId("value");

    expect(value.querySelector(`[${TABLE_FOLDED_MAIN_ATTRIBUTE}]`)).toBeNull();

    size(value, { scrollWidth: 903, clientWidth: 320 });
    fireEvent.mouseEnter(value);

    expect(value).toHaveAttribute("title", TITLE);
  });
});
