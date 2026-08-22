import LogsSavedViewsDropdown, {
  SavedViewsDropdownProps,
} from "../../../UI/Components/LogsViewer/components/SavedViewsDropdown";
import TelemetrySavedViewsDropdown from "../../../UI/Components/TelemetryViewer/components/SavedViewsDropdown";
import { LogsSavedViewOption } from "../../../UI/Components/LogsViewer/types";
import "@testing-library/jest-dom";
import {
  RenderResult,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
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

/*
 * Everything above mounts a dropdown once and never touches its props again.
 * The cases below need the second render: hosts swap the saved-views array
 * out from under an open panel — TelemetrySavedViewsControl refetches after
 * every create, edit and delete — and the panel's own state has to survive
 * that, or fail visibly.
 */
type RerenderDropdown = (
  savedViews: Array<LogsSavedViewOption>,
  selectedSavedViewId: string | null,
) => void;

interface MountedDropdown {
  handlers: Handlers;
  rerender: RerenderDropdown;
}

function dropdownElement(
  Component: FunctionComponent<SavedViewsDropdownProps>,
  savedViews: Array<LogsSavedViewOption>,
  selectedSavedViewId: string | null,
  handlers: Handlers,
): ReactElement {
  return (
    <Component
      savedViews={savedViews}
      selectedSavedViewId={selectedSavedViewId}
      onSelect={handlers.onSelect}
      onClear={handlers.onClear}
      onCreate={handlers.onCreate}
    />
  );
}

function mountDropdown(
  Component: FunctionComponent<SavedViewsDropdownProps>,
  savedViews: Array<LogsSavedViewOption>,
  selectedSavedViewId: string | null = null,
): MountedDropdown {
  const handlers: Handlers = makeHandlers();

  const result: RenderResult = render(
    dropdownElement(Component, savedViews, selectedSavedViewId, handlers),
  );

  const rerender: RerenderDropdown = (
    nextSavedViews: Array<LogsSavedViewOption>,
    nextSelectedSavedViewId: string | null,
  ): void => {
    result.rerender(
      dropdownElement(
        Component,
        nextSavedViews,
        nextSelectedSavedViewId,
        handlers,
      ),
    );
  };

  return { handlers: handlers, rerender: rerender };
}

/*
 * The real consumers hand the dropdown its per-row actions too. The table
 * above leaves them off, so nothing there ever renders an Edit, Delete or
 * Update button — which is exactly where a search or a collapsed tail would
 * lose them.
 */
interface RowHandlers extends Handlers {
  onEdit: (viewId: string) => void;
  onDelete: (viewId: string) => void;
  onUpdateCurrent: () => void;
}

function renderDropdownWithRowActions(
  Component: FunctionComponent<SavedViewsDropdownProps>,
  savedViews: Array<LogsSavedViewOption>,
  selectedSavedViewId: string | null = null,
): RowHandlers {
  const handlers: RowHandlers = {
    ...makeHandlers(),
    onEdit: jest.fn(),
    onDelete: jest.fn(),
    onUpdateCurrent: jest.fn(),
  };

  render(
    <Component
      savedViews={savedViews}
      selectedSavedViewId={selectedSavedViewId}
      onSelect={handlers.onSelect}
      onClear={handlers.onClear}
      onCreate={handlers.onCreate}
      onEdit={handlers.onEdit}
      onDelete={handlers.onDelete}
      onUpdateCurrent={handlers.onUpdateCurrent}
    />,
  );

  return handlers;
}

/*
 * Every row carries an identically named Delete, so the actions are reached
 * through the row that owns them rather than by name across the whole menu.
 */
function rowFor(viewName: string): HTMLElement {
  return screen.getByRole("button", { name: viewName }).parentElement!;
}

// Same rows visibleViewNames() counts, reporting what they say is applied.
function visibleViewPressedStates(): Array<string | null> {
  return screen
    .queryAllByRole("button")
    .filter((element: HTMLElement): boolean => {
      return element.hasAttribute("aria-pressed");
    })
    .map((element: HTMLElement): string | null => {
      return element.getAttribute("aria-pressed");
    });
}

describe.each(DROPDOWNS)(
  "$label SavedViewsDropdown — closing the panel takes the search with it",
  ({ Component }: DropdownUnderTest) => {
    afterEach(() => {
      cleanup();
    });

    test("clicking away closes the menu and drops the search with it", () => {
      renderDropdown(Component, makeViews(6));
      openMenu();
      typeSearch("view 3");

      fireEvent.click(document.body);

      expect(isMenuOpen()).toBe(false);

      openMenu();

      expect(searchBox()).toHaveValue("");
      expect(visibleViewNames()).toEqual([
        "View 1",
        "View 2",
        "View 3",
        "View 4",
        "View 5",
      ]);
    });

    test("clicking into the search box does not dismiss the menu", () => {
      renderDropdown(Component, makeViews(6));
      openMenu();

      fireEvent.click(searchBox());

      expect(isMenuOpen()).toBe(true);
      expect(searchBox()).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "+1 more" }));

      expect(isMenuOpen()).toBe(true);
      expect(visibleViewNames()).toHaveLength(6);
    });

    test("Clear view closes the menu and leaves no search behind", () => {
      const handlers: Handlers = renderDropdown(Component, NAMED_VIEWS, "ims");
      openMenu();
      typeSearch("checkout");

      fireEvent.click(screen.getByRole("button", { name: "Clear view" }));

      expect(handlers.onClear).toHaveBeenCalledTimes(1);
      expect(isMenuOpen()).toBe(false);

      openMenu();

      expect(searchBox()).toHaveValue("");
    });
  },
);

describe.each(DROPDOWNS)(
  "$label SavedViewsDropdown — the list changes underneath an open menu",
  ({ Component }: DropdownUnderTest) => {
    afterEach(() => {
      cleanup();
    });

    test("an expanded list stays expanded when a view is added underneath it", () => {
      const dropdown: MountedDropdown = mountDropdown(Component, makeViews(12));
      openMenu();
      fireEvent.click(screen.getByRole("button", { name: "+7 more" }));

      dropdown.rerender(makeViews(13), null);

      expect(visibleViewNames()).toHaveLength(13);
      expect(screen.queryByRole("button", { name: /more$/ })).toBeNull();
    });

    test("the search box arrives when the list crosses the threshold mid-visit", () => {
      const dropdown: MountedDropdown = mountDropdown(Component, makeViews(5));
      openMenu();

      expect(screen.queryByPlaceholderText(SEARCH_LABEL)).toBeNull();

      dropdown.rerender(makeViews(6), null);

      expect(searchBox()).toHaveValue("");
      expect(visibleViewNames()).toEqual([
        "View 1",
        "View 2",
        "View 3",
        "View 4",
        "View 5",
      ]);
      expect(
        screen.getByRole("button", { name: "+1 more" }),
      ).toBeInTheDocument();
    });

    test("the applied view disappearing from the list takes Clear view with it", () => {
      const dropdown: MountedDropdown = mountDropdown(
        Component,
        makeViews(6),
        "view-1",
      );
      openMenu();

      expect(
        screen.getByRole("button", { name: "Clear view" }),
      ).toBeInTheDocument();
      expect(within(trigger()).getByText("View 1")).toBeInTheDocument();

      dropdown.rerender(
        makeViews(6).filter((view: LogsSavedViewOption): boolean => {
          return view.id !== "view-1";
        }),
        "view-1",
      );

      expect(screen.queryByRole("button", { name: "Clear view" })).toBeNull();
      expect(within(trigger()).getByText("Saved Views")).toBeInTheDocument();
      expect(within(trigger()).queryByText("View 1")).toBeNull();
      expect(visibleViewNames()).toEqual([
        "View 2",
        "View 3",
        "View 4",
        "View 5",
        "View 6",
      ]);
      expect(visibleViewPressedStates()).toEqual([
        "false",
        "false",
        "false",
        "false",
        "false",
      ]);
    });

    test("changing the applied view does not disturb an in-progress search", () => {
      const dropdown: MountedDropdown = mountDropdown(Component, NAMED_VIEWS);
      openMenu();
      typeSearch("checkout");

      dropdown.rerender(NAMED_VIEWS, "checkout");

      expect(searchBox()).toHaveValue("checkout");
      expect(visibleViewNames()).toEqual([
        "Checkout errors",
        "Staging checkout",
      ]);
      expect(visibleViewPressedStates()).toEqual(["true", "false"]);
    });
  },
);

describe.each(DROPDOWNS)(
  "$label SavedViewsDropdown — the collapsed list counts and orders itself honestly",
  ({ Component }: DropdownUnderTest) => {
    afterEach(() => {
      cleanup();
    });

    test("a list at exactly the threshold gets both a search box and a collapsed tail", () => {
      renderDropdown(Component, makeViews(6));
      openMenu();

      expect(searchBox()).toBeInTheDocument();
      expect(visibleViewNames()).toEqual([
        "View 1",
        "View 2",
        "View 3",
        "View 4",
        "View 5",
      ]);
      expect(
        screen.getByRole("button", { name: "+1 more" }),
      ).toBeInTheDocument();
    });

    test("a pinned applied row is counted honestly by the toggle", () => {
      renderDropdown(Component, makeViews(12), "view-11");
      openMenu();

      expect(visibleViewNames()).toHaveLength(6);
      expect(
        screen.getByRole("button", { name: "+6 more" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "+7 more" })).toBeNull();
    });

    test("the pinned row returns to its sorted place when the list expands", () => {
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

      fireEvent.click(screen.getByRole("button", { name: "+6 more" }));

      expect(visibleViewNames()).toEqual(
        makeViews(12).map((view: LogsSavedViewOption): string => {
          return view.name;
        }),
      );
    });

    test("whitespace typed into the box is not a search", () => {
      renderDropdown(Component, makeViews(12));
      openMenu();

      typeSearch("   ");

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
      expect(screen.queryByText(NO_MATCHES)).toBeNull();
    });

    test("the trigger keeps naming the applied view while a search hides its row", () => {
      renderDropdown(Component, NAMED_VIEWS, "ims");
      openMenu();

      typeSearch("checkout");

      expect(visibleViewNames()).toEqual([
        "Checkout errors",
        "Staging checkout",
      ]);
      expect(within(trigger()).getByText("IMS Logs")).toBeInTheDocument();
      expect(
        within(trigger()).getByText(String(NAMED_VIEWS.length)),
      ).toBeInTheDocument();
    });
  },
);

describe.each(DROPDOWNS)(
  "$label SavedViewsDropdown — a row keeps its actions wherever the list puts it",
  ({ Component }: DropdownUnderTest) => {
    afterEach(() => {
      cleanup();
    });

    test("a searched row keeps its Edit and Delete actions", () => {
      const handlers: RowHandlers = renderDropdownWithRowActions(
        Component,
        makeViews(12),
      );
      openMenu();

      typeSearch("view 9");

      expect(visibleViewNames()).toEqual(["View 9"]);
      expect(
        within(rowFor("View 9")).getByRole("button", { name: "Delete" }),
      ).toBeInTheDocument();

      fireEvent.click(
        within(rowFor("View 9")).getByRole("button", { name: "Edit" }),
      );

      expect(handlers.onEdit).toHaveBeenCalledWith("view-9");
      expect(isMenuOpen()).toBe(false);
    });

    test("the pinned applied row still offers Update", () => {
      const handlers: RowHandlers = renderDropdownWithRowActions(
        Component,
        makeViews(12),
        "view-11",
      );
      openMenu();

      expect(screen.getAllByRole("button", { name: "Update" })).toHaveLength(1);

      fireEvent.click(
        within(rowFor("View 11")).getByRole("button", { name: "Update" }),
      );

      expect(handlers.onUpdateCurrent).toHaveBeenCalledTimes(1);
      expect(isMenuOpen()).toBe(false);
    });

    test("deleting a searched view closes the menu and clears the search behind it", () => {
      const handlers: RowHandlers = renderDropdownWithRowActions(
        Component,
        makeViews(12),
      );
      openMenu();
      typeSearch("view 9");

      fireEvent.click(
        within(rowFor("View 9")).getByRole("button", { name: "Delete" }),
      );

      expect(handlers.onDelete).toHaveBeenCalledWith("view-9");
      expect(isMenuOpen()).toBe(false);

      openMenu();

      expect(searchBox()).toHaveValue("");
      expect(visibleViewNames()).toEqual([
        "View 1",
        "View 2",
        "View 3",
        "View 4",
        "View 5",
      ]);
    });

    test("deleting the applied view does not also clear it", () => {
      const handlers: RowHandlers = renderDropdownWithRowActions(
        Component,
        NAMED_VIEWS,
        "ims",
      );
      openMenu();

      fireEvent.click(
        within(rowFor("IMS Logs")).getByRole("button", { name: "Delete" }),
      );

      expect(handlers.onDelete).toHaveBeenCalledWith("ims");
      expect(handlers.onClear).not.toHaveBeenCalled();
      expect(handlers.onSelect).not.toHaveBeenCalled();
    });
  },
);

/*
 * The panel gained a text field, and a text field brings obligations a bare
 * menu never had: a way out with the keyboard, a filter that cannot outlive
 * the box that set it, and a drag-select that does not dismiss the thing you
 * are selecting in. These pin all three, on both copies.
 */
describe.each(DROPDOWNS)(
  "$label SavedViewsDropdown — a panel that holds a text field",
  ({ Component }: DropdownUnderTest) => {
    afterEach(() => {
      cleanup();
    });

    test("a list that shrinks below the threshold does not strand the menu's filter", () => {
      const mounted: MountedDropdown = mountDropdown(Component, makeViews(6));

      openMenu();
      typeSearch("zzz");
      expect(screen.getByText(NO_MATCHES)).toBeInTheDocument();

      // Three views deleted while the menu is open; the box goes with them.
      mounted.rerender(makeViews(3), null);

      expect(screen.queryByPlaceholderText(SEARCH_LABEL)).toBeNull();
      expect(visibleViewNames()).toEqual(["View 1", "View 2", "View 3"]);
      expect(screen.queryByText(NO_MATCHES)).toBeNull();
    });

    test("Escape closes the panel from inside the search box", () => {
      renderDropdown(Component, makeViews(6));

      openMenu();
      typeSearch("View 2");
      fireEvent.keyDown(searchBox(), { key: "Escape" });

      expect(isMenuOpen()).toBe(false);

      openMenu();
      expect(searchBox()).toHaveValue("");
    });

    test("Escape hands focus back to the trigger rather than dropping it", () => {
      renderDropdown(Component, makeViews(6));

      openMenu();
      searchBox().focus();
      fireEvent.keyDown(searchBox(), { key: "Escape" });

      /*
       * Without this the panel unmounts under the caret and focus falls to
       * <body>, which for a keyboard user is the same as being returned to
       * the top of the page.
       */
      expect(trigger()).toHaveFocus();
    });

    test("a key that is not Escape leaves the panel alone", () => {
      renderDropdown(Component, makeViews(6));

      openMenu();
      fireEvent.keyDown(searchBox(), { key: "a" });
      fireEvent.keyDown(searchBox(), { key: "Enter" });

      expect(isMenuOpen()).toBe(true);
    });

    test("a drag that starts in the search box and ends outside keeps the menu", () => {
      renderDropdown(Component, makeViews(6));

      openMenu();
      typeSearch("View 2");

      /*
       * Selecting the text and overshooting the panel fires the click on the
       * common ancestor of press and release — outside. Dismissing on that
       * threw away the query the user was in the middle of editing.
       */
      fireEvent.mouseDown(searchBox());
      fireEvent.click(document.body);

      expect(isMenuOpen()).toBe(true);
      expect(searchBox()).toHaveValue("View 2");
    });

    test("a click that starts outside still dismisses the menu", () => {
      renderDropdown(Component, makeViews(6));

      openMenu();

      // The narrowing above must not have cost the ordinary dismissal.
      fireEvent.mouseDown(document.body);
      fireEvent.click(document.body);

      expect(isMenuOpen()).toBe(false);
    });

    test("the panel names itself, so its search box is not the sidebar's", () => {
      renderDropdown(Component, makeViews(6));

      openMenu();

      const panel: HTMLElement = screen.getByRole("dialog", {
        name: "Saved views",
      });

      /*
       * The logs sidebar renders a search box with the identical accessible
       * name a few hundred pixels away. The panel's own name is what tells a
       * screen reader which of the two the caret is in.
       */
      expect(
        within(panel).getByRole("textbox", { name: SEARCH_LABEL }),
      ).toBeInTheDocument();
    });

    test("the collapse toggle sits outside the scrolling list", () => {
      renderDropdown(Component, makeViews(30));

      openMenu();

      const scroller: HTMLElement | null = document.querySelector(
        '[class*="overflow-y-auto"]',
      );
      const toggle: HTMLElement = screen.getByRole("button", {
        name: "+25 more",
      });

      expect(scroller).not.toBeNull();
      expect(scroller!.contains(rowFor("View 1"))).toBe(true);
      /*
       * Inside the scroller, expanding pushed "Show less" off the bottom and
       * slid a view row under the cursor, so a second click in the same spot
       * applied whichever view had taken its place.
       */
      expect(scroller!.contains(toggle)).toBe(false);
    });

    test("expanding leaves the toggle where the cursor left it", () => {
      const mounted: MountedDropdown = mountDropdown(Component, makeViews(30));

      openMenu();
      fireEvent.click(screen.getByRole("button", { name: "+25 more" }));

      const toggle: HTMLElement = screen.getByRole("button", {
        name: "Show less",
      });
      const scroller: HTMLElement | null = document.querySelector(
        '[class*="overflow-y-auto"]',
      );

      expect(scroller!.contains(toggle)).toBe(false);
      expect(visibleViewNames()).toHaveLength(30);

      // A second click in the same place collapses, and applies nothing.
      fireEvent.click(toggle);

      expect(visibleViewNames()).toHaveLength(5);
      expect(mounted.handlers.onSelect).not.toHaveBeenCalled();
    });

    test("an expanded list that shrinks to fit retires its toggle", () => {
      const mounted: MountedDropdown = mountDropdown(Component, makeViews(12));

      openMenu();
      fireEvent.click(screen.getByRole("button", { name: "+7 more" }));
      expect(visibleViewNames()).toHaveLength(12);

      mounted.rerender(makeViews(4), null);

      expect(visibleViewNames()).toHaveLength(4);
      expect(screen.queryByRole("button", { name: "Show less" })).toBeNull();
      expect(screen.queryByRole("button", { name: /more$/ })).toBeNull();
    });
  },
);
