import LogsSavedViewsDropdown, {
  SavedViewsDropdownProps,
} from "../../../UI/Components/LogsViewer/components/SavedViewsDropdown";
import TelemetrySavedViewsDropdown from "../../../UI/Components/TelemetryViewer/components/SavedViewsDropdown";
import { LogsSavedViewOption } from "../../../UI/Components/LogsViewer/types";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { FunctionComponent } from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Issue 3319 again, on the two dropdowns: the logs explorer carries its own
 * copy and the shared telemetry viewer (traces, metrics, saved-view tables)
 * carries another. Both listed every view with no way to narrow it, so both
 * get the same search box and "+N more" tail — and both are held to it here,
 * from one table of cases, so the copies cannot drift apart.
 */

const SEARCH_LABEL: string = "Search saved views...";
const MENU_PROBE: string = "+ Save Current View";
const NO_MATCHES: string = "No matches found";

interface DropdownUnderTest {
  label: string;
  Component: FunctionComponent<SavedViewsDropdownProps>;
}

/*
 * The telemetry dropdown's props are the logs ones plus a few optional
 * presentation flags, so a component typed for the logs props stands in for
 * both and every case below runs twice.
 */
const DROPDOWNS: Array<DropdownUnderTest> = [
  { label: "LogsViewer", Component: LogsSavedViewsDropdown },
  { label: "TelemetryViewer", Component: TelemetrySavedViewsDropdown },
];

function makeViews(count: number): Array<LogsSavedViewOption> {
  const views: Array<LogsSavedViewOption> = [];

  for (let index: number = 1; index <= count; index++) {
    views.push({ id: `view-${index}`, name: `View ${index}` });
  }

  return views;
}

const NAMED_VIEWS: Array<LogsSavedViewOption> = [
  { id: "ims", name: "IMS Logs" },
  { id: "qa", name: "QA-JDE", isDefault: true },
  { id: "checkout", name: "Checkout errors" },
  { id: "staging", name: "Staging checkout" },
  { id: "prod", name: "Prod fatals" },
  { id: "slow", name: "Slow requests" },
];

interface Handlers {
  onSelect: (viewId: string) => void;
  onClear: () => void;
  onCreate: () => void;
}

function makeHandlers(): Handlers {
  return {
    onSelect: jest.fn(),
    onClear: jest.fn(),
    onCreate: jest.fn(),
  };
}

function renderDropdown(
  Component: FunctionComponent<SavedViewsDropdownProps>,
  savedViews: Array<LogsSavedViewOption>,
  selectedSavedViewId: string | null = null,
): Handlers {
  const handlers: Handlers = makeHandlers();

  render(
    <Component
      savedViews={savedViews}
      selectedSavedViewId={selectedSavedViewId}
      onSelect={handlers.onSelect}
      onClear={handlers.onClear}
      onCreate={handlers.onCreate}
    />,
  );

  return handlers;
}

function trigger(): HTMLElement {
  return screen.getAllByRole("button")[0]!;
}

function openMenu(): void {
  fireEvent.click(trigger());
}

function isMenuOpen(): boolean {
  return screen.queryByText(MENU_PROBE) !== null;
}

function searchBox(): HTMLElement {
  return screen.getByPlaceholderText(SEARCH_LABEL);
}

function typeSearch(text: string): void {
  fireEvent.change(searchBox(), { target: { value: text } });
}

/*
 * Saved-view rows are the only buttons that report a pressed state, which
 * makes aria-pressed a sharper handle than the name — the dropdown trigger
 * echoes the applied view's name and would otherwise be counted as a row.
 */
function visibleViewNames(): Array<string> {
  return screen
    .queryAllByRole("button")
    .filter((element: HTMLElement): boolean => {
      return element.hasAttribute("aria-pressed");
    })
    .map((element: HTMLElement): string => {
      return element.getAttribute("aria-label") || element.textContent || "";
    });
}

describe.each(DROPDOWNS)(
  "$label SavedViewsDropdown — the search box earns its space",
  ({ Component }: DropdownUnderTest) => {
    afterEach(() => {
      cleanup();
    });

    test("a short list gets no search box", () => {
      renderDropdown(Component, makeViews(5));
      openMenu();

      expect(screen.queryByPlaceholderText(SEARCH_LABEL)).toBeNull();
      expect(visibleViewNames()).toHaveLength(5);
    });

    test("a long enough list gets one", () => {
      renderDropdown(Component, makeViews(6));
      openMenu();

      expect(searchBox()).toBeInTheDocument();
      expect(
        screen.getByRole("textbox", { name: SEARCH_LABEL }),
      ).toBeInTheDocument();
    });

    test("no saved views at all still says so rather than offering a search", () => {
      renderDropdown(Component, []);
      openMenu();

      expect(screen.getByText("No saved views yet.")).toBeInTheDocument();
      expect(screen.queryByPlaceholderText(SEARCH_LABEL)).toBeNull();
    });
  },
);

describe.each(DROPDOWNS)(
  "$label SavedViewsDropdown — searching narrows the list",
  ({ Component }: DropdownUnderTest) => {
    afterEach(() => {
      cleanup();
    });

    test("typing filters views by name, ignoring case", () => {
      renderDropdown(Component, NAMED_VIEWS);
      openMenu();

      typeSearch("CHECKOUT");

      expect(
        screen.getByRole("button", { name: "Checkout errors" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Staging checkout" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "IMS Logs" })).toBeNull();
    });

    test("a search that matches nothing says so, and does not claim there are none", () => {
      renderDropdown(Component, NAMED_VIEWS);
      openMenu();

      typeSearch("nothing here");

      expect(screen.getByText(NO_MATCHES)).toBeInTheDocument();
      expect(screen.queryByText("No saved views yet.")).toBeNull();
    });

    test("typing leaves the menu open", () => {
      renderDropdown(Component, NAMED_VIEWS);
      openMenu();

      typeSearch("checkout");

      expect(isMenuOpen()).toBe(true);
    });

    test("selecting a searched view applies it and closes the menu", () => {
      const handlers: Handlers = renderDropdown(Component, NAMED_VIEWS);
      openMenu();

      typeSearch("slow");
      fireEvent.click(screen.getByRole("button", { name: "Slow requests" }));

      expect(handlers.onSelect).toHaveBeenCalledWith("slow");
      expect(isMenuOpen()).toBe(false);
    });

    test("the trigger keeps counting every view, not the matches", () => {
      renderDropdown(Component, NAMED_VIEWS);
      openMenu();

      typeSearch("checkout");

      expect(trigger()).toHaveTextContent(String(NAMED_VIEWS.length));
    });

    test("a search does not survive closing and reopening the menu", () => {
      renderDropdown(Component, NAMED_VIEWS);
      openMenu();
      typeSearch("checkout");

      // Close through the trigger, then come back.
      openMenu();
      openMenu();

      expect(searchBox()).toHaveValue("");
      expect(
        screen.getByRole("button", { name: "IMS Logs" }),
      ).toBeInTheDocument();
    });
  },
);

describe.each(DROPDOWNS)(
  "$label SavedViewsDropdown — the tail collapses behind +N more",
  ({ Component }: DropdownUnderTest) => {
    afterEach(() => {
      cleanup();
    });

    test("only the first few views show, with the rest counted", () => {
      renderDropdown(Component, makeViews(12));
      openMenu();

      expect(visibleViewNames()).toEqual([
        "View 1",
        "View 2",
        "View 3",
        "View 4",
        "View 5",
      ]);
      expect(
        screen.getByRole("button", { name: "+7 more" }),
      ).toBeInTheDocument();
    });

    test("expanding shows the rest and offers to collapse again", () => {
      renderDropdown(Component, makeViews(12));
      openMenu();

      fireEvent.click(screen.getByRole("button", { name: "+7 more" }));

      expect(visibleViewNames()).toHaveLength(12);
      expect(isMenuOpen()).toBe(true);

      fireEvent.click(screen.getByRole("button", { name: "Show less" }));

      expect(visibleViewNames()).toHaveLength(5);
    });

    test("a list that already fits offers no toggle", () => {
      renderDropdown(Component, makeViews(5));
      openMenu();

      expect(screen.queryByRole("button", { name: /more$/ })).toBeNull();
      expect(screen.queryByRole("button", { name: "Show less" })).toBeNull();
    });

    test("neither half of the toggle sits beside a search result", () => {
      renderDropdown(Component, makeViews(12));
      openMenu();

      typeSearch("view 1");

      expect(visibleViewNames()).toEqual([
        "View 1",
        "View 10",
        "View 11",
        "View 12",
      ]);
      expect(screen.queryByRole("button", { name: /more$/ })).toBeNull();
      expect(screen.queryByRole("button", { name: "Show less" })).toBeNull();
    });

    test("the applied view stays in sight even when it sorts past the cut", () => {
      renderDropdown(Component, makeViews(12), "view-11");
      openMenu();

      expect(visibleViewNames()).toEqual([
        "View 1",
        "View 2",
        "View 3",
        "View 4",
        "View 5",
        "View 11",
      ]);
      expect(screen.getByRole("button", { name: "View 11" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    test("an expanded list collapses again on the next visit", () => {
      renderDropdown(Component, makeViews(12));
      openMenu();
      fireEvent.click(screen.getByRole("button", { name: "+7 more" }));

      // Close through the trigger, then come back.
      openMenu();
      openMenu();

      expect(visibleViewNames()).toHaveLength(5);
    });
  },
);

describe.each(DROPDOWNS)(
  "$label SavedViewsDropdown — the rest of the menu is unaffected",
  ({ Component }: DropdownUnderTest) => {
    afterEach(() => {
      cleanup();
    });

    test("Clear view still sits above a searchable list", () => {
      const handlers: Handlers = renderDropdown(Component, NAMED_VIEWS, "ims");
      openMenu();

      expect(searchBox()).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Clear view" }));

      expect(handlers.onClear).toHaveBeenCalledTimes(1);
    });

    test("Save Current View still sits below it", () => {
      const handlers: Handlers = renderDropdown(Component, NAMED_VIEWS);
      openMenu();

      typeSearch("nothing here");
      fireEvent.click(screen.getByRole("button", { name: MENU_PROBE }));

      expect(handlers.onCreate).toHaveBeenCalledTimes(1);
    });

    test("clicking the applied view still clears it", () => {
      const handlers: Handlers = renderDropdown(Component, NAMED_VIEWS, "ims");
      openMenu();

      fireEvent.click(screen.getByRole("button", { name: "IMS Logs" }));

      expect(handlers.onClear).toHaveBeenCalledTimes(1);
      expect(handlers.onSelect).not.toHaveBeenCalled();
    });

    test("a default view still announces the word", () => {
      renderDropdown(Component, NAMED_VIEWS);
      openMenu();

      expect(
        screen.getByRole("button", { name: "QA-JDE (default)" }),
      ).toBeInTheDocument();
    });
  },
);
