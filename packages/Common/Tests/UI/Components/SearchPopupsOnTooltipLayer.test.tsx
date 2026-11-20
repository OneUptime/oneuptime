import LogSearchBar from "../../../UI/Components/LogsViewer/components/LogSearchBar";
import { LOG_SEARCH_HELP_TEST_ID } from "../../../UI/Components/LogsViewer/components/LogSearchHelp";
import TelemetrySearchBar from "../../../UI/Components/TelemetryViewer/components/TelemetrySearchBar";
import { SEARCH_SUGGESTIONS_TEST_ID } from "../../../UI/Components/TelemetryViewer/components/TelemetrySearchSuggestions";
import { SearchHelpRow } from "../../../UI/Components/TelemetryViewer/types";
import {
  LAYERED_POPOVER_AS_WIDE_AS_ANCHOR_CLASS_NAME,
  LAYERED_POPOVER_CLASS_NAME,
} from "../../../UI/Components/Tooltip/LayeredPopover";
import { wasPressConsumedByAnAnchoredPopup } from "../../../UI/Types/LayeredDismissal";
import getJestMockFunction, { MockFunction } from "../../MockType";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import React, { ReactElement, useState } from "react";

/*
 * THE EXPLORERS' AND THE LOGS SEARCH'S POPUPS ARE DRAWN ON THE TOOLTIP
 * LAYER, AND STILL BEHAVE AS A COMBOBOX'S POPUPS (#9909).
 *
 * The search box's suggestions and its syntax help were drawn `absolute`
 * under the box, in place, and inside an investigation drawer's scrolling
 * body a list or a panel taller than the viewer under it ran into the
 * drawer's scroll area. They are drawn on the page's body now, against the
 * box (LayeredPopover's isFieldPopup), as every menu is since #9859 - and
 * nothing else about them changed:
 *
 *   - the focus stays in the search, and a press on a suggestion or a help
 *     row keeps it there (the press is spent: preventDefault);
 *   - the arrows move the selection and keep the caret where it is (the
 *     key is spent while the list shows, and left to the field when not);
 *     Enter applies the selection;
 *   - Tab in the search is the browser's: never into the list;
 *   - Escape is the search's: it closes the list and the help, and is not
 *     spent, as before;
 *   - a press outside the search closes them, and a press on them is a
 *     press inside the search;
 *   - a screen reader still meets the open popup right after the search:
 *     the search owns it (aria-owns).
 *
 * Both bars draw one suggestions list (TelemetrySearchSuggestions), so each
 * case runs for both.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

const HELP_ROWS: Array<SearchHelpRow> = [
  {
    syntax: "service:<name>",
    description: "Filter by service",
    example: "service:api",
  },
  {
    syntax: "@<attr>:<value>",
    description: "Filter by attribute",
    example: "@http.status_code:500",
  },
];

// Ten fields that start with "s": eight are listed, and "+2 more..." after them.
const FIELDS: Array<string> = [
  "service",
  "severity",
  "span",
  "spanId",
  "status",
  "statusCode",
  "source",
  "session",
  "scope",
  "sdk",
];

type BarKind = "explorers" | "logs";

interface HarnessProps {
  kind: BarKind;
  initialValue?: string | undefined;
  onSubmit?: (() => void) | undefined;
}

/*
 * A search as an investigation drawer holds it: in a short body that
 * scrolls, with a control after it.
 */
function SearchInDrawer(props: HarnessProps): ReactElement {
  const [value, setValue] = useState<string>(props.initialValue || "");
  const onSubmit: () => void = props.onSubmit || ((): void => {});

  return (
    <div>
      <p>Elsewhere on the page</p>
      <div
        data-testid="drawer-body"
        style={{ height: "160px", overflowY: "auto" }}
      >
        {props.kind === "explorers" ? (
          <TelemetrySearchBar
            value={value}
            onChange={setValue}
            onSubmit={onSubmit}
            suggestions={FIELDS}
            helpRows={HELP_ROWS}
          />
        ) : (
          <LogSearchBar
            value={value}
            onChange={setValue}
            onSubmit={onSubmit}
            suggestions={FIELDS}
          />
        )}
        <button type="button">After the search</button>
      </div>
    </div>
  );
}

const KINDS: Array<[string, BarKind]> = [
  ["the explorers' search", "explorers"],
  ["the logs search", "logs"],
];

function input(): HTMLInputElement {
  return screen.getByRole("textbox") as HTMLInputElement;
}

function focusInput(): void {
  act(() => {
    input().focus();
  });
}

function typeInto(value: string): void {
  fireEvent.change(input(), { target: { value: value } });
}

function suggestions(): HTMLElement {
  return screen.getByTestId(SEARCH_SUGGESTIONS_TEST_ID);
}

function help(kind: BarKind): HTMLElement {
  return kind === "explorers"
    ? (screen
        .getByText("Search syntax")
        .closest("div.rounded-lg") as HTMLElement)
    : screen.getByTestId(LOG_SEARCH_HELP_TEST_ID);
}

// The search's box: what its popups hang from, and own.
function searchBox(): HTMLElement {
  return input().closest("div.relative") as HTMLElement;
}

function layerOf(popup: HTMLElement): HTMLElement {
  const layer: HTMLElement | null = popup.closest<HTMLElement>(
    `.${LAYERED_POPOVER_CLASS_NAME}`,
  );

  expect(layer).not.toBeNull();

  return layer!;
}

function suggestionButton(name: string): HTMLElement {
  return within(suggestions()).getByRole("button", {
    name: new RegExp(`^${name}$`),
  });
}

afterEach(() => {
  cleanup();
});

describe.each(KINDS)("%s's suggestions", (_name: string, kind: BarKind) => {
  test("open on the tooltip layer, outside the drawer's scrolling body, hung from the search and as wide as it", () => {
    render(<SearchInDrawer kind={kind} />);
    focusInput();
    typeInto("s");

    const list: HTMLElement = suggestions();
    const layer: HTMLElement = layerOf(list);

    expect(screen.getByTestId("drawer-body")).not.toContainElement(list);
    expect(layer.parentElement).toBe(document.body);
    expect(layer).toHaveAttribute("data-popper-placement", "bottom-start");
    expect(
      (layer as HTMLElement & { _tippy?: { reference: Element } })._tippy
        ?.reference,
    ).toBe(searchBox());
    expect(list).toHaveClass(LAYERED_POPOVER_AS_WIDE_AS_ANCHOR_CLASS_NAME);
    // No place of its own any more: the layer places it.
    expect(list).not.toHaveClass("absolute", "left-0", "right-0", "top-full");
  });

  test("list eight of the fields typed for, and say how many more", () => {
    render(<SearchInDrawer kind={kind} />);
    focusInput();
    typeInto("s");

    expect(within(suggestions()).getAllByRole("button")).toHaveLength(8);
    expect(suggestions()).toHaveTextContent("+2 more...");
  });

  test("are owned by the search while they show, so a screen reader meets them right after it", () => {
    render(<SearchInDrawer kind={kind} />);
    focusInput();
    typeInto("se");

    const list: HTMLElement = suggestions();

    expect(list.id).not.toBe("");
    expect(searchBox()).toHaveAttribute("aria-owns", list.id);

    fireEvent.keyDown(input(), { key: "Escape" });

    expect(searchBox()).not.toHaveAttribute("aria-owns");
  });

  test("the arrows move the selection and keep the caret where it is; Enter applies it", () => {
    render(<SearchInDrawer kind={kind} />);
    focusInput();
    typeInto("se");

    // Spent while the list shows: the caret does not jump to an end.
    expect(fireEvent.keyDown(input(), { key: "ArrowDown" })).toBe(false);
    expect(suggestionButton("service")).toHaveClass("bg-indigo-50");

    expect(fireEvent.keyDown(input(), { key: "ArrowDown" })).toBe(false);
    expect(suggestionButton("severity")).toHaveClass("bg-indigo-50");
    expect(suggestionButton("service")).not.toHaveClass("bg-indigo-50");

    expect(fireEvent.keyDown(input(), { key: "ArrowUp" })).toBe(false);
    expect(suggestionButton("service")).toHaveClass("bg-indigo-50");

    fireEvent.keyDown(input(), { key: "Enter" });

    expect(input().value).toBe("service:");
    expect(input()).toHaveFocus();
  });

  test("with no list shown, the arrows are the field's, as before", () => {
    render(<SearchInDrawer kind={kind} initialValue="zzz" />);
    focusInput();
    typeInto("zzzz");

    expect(screen.queryByTestId(SEARCH_SUGGESTIONS_TEST_ID)).toBeNull();
    expect(fireEvent.keyDown(input(), { key: "ArrowDown" })).toBe(true);
    expect(fireEvent.keyDown(input(), { key: "ArrowUp" })).toBe(true);
  });

  test("a press on a suggestion keeps the focus in the search and applies it", () => {
    render(<SearchInDrawer kind={kind} />);
    focusInput();
    typeInto("sev");

    // Spent on the suggestion: the search never loses the focus.
    expect(fireEvent.mouseDown(suggestionButton("severity"))).toBe(false);
    expect(input()).toHaveFocus();
    expect(input().value).toBe("severity:");
  });

  test("Tab in the search is the browser's: never taken into the list", () => {
    render(<SearchInDrawer kind={kind} />);
    focusInput();
    typeInto("se");

    expect(fireEvent.keyDown(input(), { key: "Tab", code: "Tab" })).toBe(true);
    expect(suggestions()).not.toContainElement(
      document.activeElement as HTMLElement,
    );
  });

  test("Escape is the search's: it closes the list, and is not spent", () => {
    const pageEscape: MockFunction = getJestMockFunction();
    const listener: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      if (event.key === "Escape") {
        pageEscape();
      }
    };
    document.addEventListener("keydown", listener);

    try {
      render(<SearchInDrawer kind={kind} />);
      focusInput();
      typeInto("se");

      expect(fireEvent.keyDown(input(), { key: "Escape" })).toBe(true);
      expect(screen.queryByTestId(SEARCH_SUGGESTIONS_TEST_ID)).toBeNull();
      expect(pageEscape).toHaveBeenCalledTimes(1);
      expect(input()).toHaveFocus();
    } finally {
      document.removeEventListener("keydown", listener);
    }
  });

  test("a press on the list's own words is a press inside the search: the list stays", () => {
    render(<SearchInDrawer kind={kind} />);
    focusInput();
    typeInto("s");

    fireEvent.mouseDown(within(suggestions()).getByText("+2 more..."));

    expect(suggestions()).toBeInTheDocument();
  });

  test("a press outside the search closes the list, and is not spent on it", () => {
    render(<SearchInDrawer kind={kind} />);
    focusInput();
    typeInto("se");

    const press: MouseEvent = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      screen.getByText("Elsewhere on the page").dispatchEvent(press);
    });

    expect(screen.queryByTestId(SEARCH_SUGGESTIONS_TEST_ID)).toBeNull();
    expect(wasPressConsumedByAnAnchoredPopup(press)).toBe(false);
  });

  test("the focus leaving the search closes the list", () => {
    render(<SearchInDrawer kind={kind} />);
    focusInput();
    typeInto("se");

    act(() => {
      screen.getByRole("button", { name: "After the search" }).focus();
    });

    expect(screen.queryByTestId(SEARCH_SUGGESTIONS_TEST_ID)).toBeNull();
  });
});

describe.each(KINDS)("%s's syntax help", (_name: string, kind: BarKind) => {
  test("opens on the tooltip layer while the search is focused and empty, outside the drawer", () => {
    render(<SearchInDrawer kind={kind} />);
    focusInput();

    const panel: HTMLElement = help(kind);
    const layer: HTMLElement = layerOf(panel);

    expect(screen.getByTestId("drawer-body")).not.toContainElement(panel);
    expect(layer.parentElement).toBe(document.body);
    expect(layer).toHaveAttribute("data-popper-placement", "bottom-start");
    // 36rem from md up, never wider than the window, as wide as the search below md.
    expect(panel).toHaveClass(
      "w-[36rem]",
      "max-w-[calc(100vw-1rem)]",
      "max-md:w-[var(--layered-popover-anchor-width)]",
    );
    expect(searchBox()).toHaveAttribute("aria-owns", panel.id);
    expect(input()).toHaveFocus();
  });

  test("a press on a row types its example in and keeps the focus in the search", () => {
    render(<SearchInDrawer kind={kind} />);
    focusInput();

    const row: HTMLElement = within(help(kind)).getAllByRole("row")[0]!;

    expect(fireEvent.mouseDown(row)).toBe(false);
    expect(input()).toHaveFocus();
    expect(input().value.length).toBeGreaterThan(0);
  });

  test("goes as the reader types, and Escape puts it away without spending the key", () => {
    render(<SearchInDrawer kind={kind} />);
    focusInput();

    expect(help(kind)).toBeInTheDocument();
    expect(fireEvent.keyDown(input(), { key: "Escape" })).toBe(true);
    expect(screen.queryByText("Search syntax")).toBeNull();
  });

  test("Tab in the search is the browser's, the help being out of its way", () => {
    render(<SearchInDrawer kind={kind} />);
    focusInput();

    expect(fireEvent.keyDown(input(), { key: "Tab", code: "Tab" })).toBe(true);
  });

  test("a press outside closes it", () => {
    render(<SearchInDrawer kind={kind} />);
    focusInput();

    fireEvent.mouseDown(screen.getByText("Elsewhere on the page"));

    expect(screen.queryByText("Search syntax")).toBeNull();
  });
});

describe("the logs search's help on a phone", () => {
  test("lays each row out as the explorers' help does: token and example on one line below sm", () => {
    render(<SearchInDrawer kind="logs" />);
    focusInput();

    const panel: HTMLElement = help("logs");
    const row: HTMLElement = within(panel).getAllByRole("row")[0]!;

    expect(row).toHaveClass("max-sm:grid");
    expect(within(panel).getByRole("table")).toHaveClass("max-sm:block");
  });
});
