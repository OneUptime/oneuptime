import SavedViewsDropdown, {
  SavedViewsDropdownProps,
} from "../../../UI/Components/LogsViewer/components/SavedViewsDropdown";
import LogsViewerToolbar from "../../../UI/Components/LogsViewer/components/LogsViewerToolbar";
import LogsFacetSidebar from "../../../UI/Components/LogsViewer/components/LogsFacetSidebar";
import { LogsSavedViewOption } from "../../../UI/Components/LogsViewer/types";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  RenderResult,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The logs explorer grew its saved views before the shared telemetry viewer
 * did, so it carries its own copy of the dropdown — and its own copy of the
 * bug in issue 3189: a view could be applied but never taken back off.
 *
 * Everything the telemetry dropdown gained is pinned here for the logs one
 * too, plus the two extra surfaces logs has that traces does not: the toolbar
 * that mounts the dropdown, and the facet sidebar, which lists the same views
 * again down the left-hand side and re-applied them on click.
 */

const VIEWS: Array<LogsSavedViewOption> = [
  { id: "errors", name: "Errors only" },
  { id: "checkout", name: "Checkout service", isDefault: true },
];

const CLEAR_LABEL: string = "Clear view";
const MENU_PROBE: string = "+ Save Current View";

interface Handlers {
  onSelect: (viewId: string) => void;
  onClear: () => void;
  onCreate: () => void;
  onEdit: (viewId: string) => void;
  onDelete: (viewId: string) => void;
  onUpdateCurrent: () => void;
}

function makeHandlers(): Handlers {
  return {
    onSelect: jest.fn(),
    onClear: jest.fn(),
    onCreate: jest.fn(),
    onEdit: jest.fn(),
    onDelete: jest.fn(),
    onUpdateCurrent: jest.fn(),
  };
}

function renderDropdown(
  overrides: Partial<SavedViewsDropdownProps> = {},
  handlers: Handlers = makeHandlers(),
): { handlers: Handlers; result: RenderResult } {
  const props: SavedViewsDropdownProps = {
    savedViews: VIEWS,
    selectedSavedViewId: null,
    ...handlers,
    ...overrides,
  };

  return { handlers, result: render(<SavedViewsDropdown {...props} />) };
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

function rowFor(name: string): HTMLElement {
  return screen.getByRole("button", { name: name });
}

describe("LogsViewer SavedViewsDropdown — clearing the applied view", () => {
  afterEach(() => {
    cleanup();
  });

  test("clicking the applied view clears it instead of re-applying it", () => {
    const { handlers } = renderDropdown({ selectedSavedViewId: "errors" });

    openMenu();
    fireEvent.click(rowFor("Errors only"));

    expect(handlers.onClear).toHaveBeenCalledTimes(1);
    expect(handlers.onSelect).not.toHaveBeenCalled();
    expect(isMenuOpen()).toBe(false);
  });

  test("the explicit Clear view row clears and closes the menu", () => {
    const { handlers } = renderDropdown({ selectedSavedViewId: "errors" });

    openMenu();
    fireEvent.click(rowFor(CLEAR_LABEL));

    expect(handlers.onClear).toHaveBeenCalledTimes(1);
    expect(handlers.onSelect).not.toHaveBeenCalled();
    expect(isMenuOpen()).toBe(false);
  });

  test("the Clear view row is offered only while a view is applied", () => {
    renderDropdown({ selectedSavedViewId: null });

    openMenu();

    expect(screen.queryByText(CLEAR_LABEL)).toBeNull();
  });

  test("a selection pointing at a view that no longer exists offers no clear row", () => {
    renderDropdown({ selectedSavedViewId: "deleted-view" });

    openMenu();

    expect(screen.queryByText(CLEAR_LABEL)).toBeNull();
  });

  test("clicking a different view still applies it", () => {
    const { handlers } = renderDropdown({ selectedSavedViewId: "errors" });

    openMenu();
    fireEvent.click(rowFor("Checkout service (default)"));

    expect(handlers.onSelect).toHaveBeenCalledWith("checkout");
    expect(handlers.onClear).not.toHaveBeenCalled();
  });

  test("aria-pressed tracks which view is applied", () => {
    renderDropdown({ selectedSavedViewId: "errors" });

    openMenu();

    expect(rowFor("Errors only")).toHaveAttribute("aria-pressed", "true");
    expect(rowFor("Checkout service (default)")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("without onClear the applied view is still merely re-applied", () => {
    const { handlers } = renderDropdown({
      selectedSavedViewId: "errors",
      onClear: undefined,
    });

    openMenu();

    expect(screen.queryByText(CLEAR_LABEL)).toBeNull();

    fireEvent.click(rowFor("Errors only"));

    expect(handlers.onSelect).toHaveBeenCalledWith("errors");
    expect(handlers.onClear).not.toHaveBeenCalled();
  });

  test("Edit and Delete on the applied row do not clear it", () => {
    const { handlers } = renderDropdown({ selectedSavedViewId: "errors" });

    openMenu();
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);

    expect(handlers.onEdit).toHaveBeenCalledWith("errors");

    openMenu();
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]!);

    expect(handlers.onDelete).toHaveBeenCalledWith("errors");
    expect(handlers.onClear).not.toHaveBeenCalled();
  });
});

/*
 * The toolbar is the only thing that mounts the dropdown in the real logs
 * explorer, so a clear handler that never reaches it is the same bug wearing
 * a different hat. This renders the real toolbar rather than asserting on
 * prop names.
 */
describe("LogsViewerToolbar hands the clear handler to the dropdown", () => {
  afterEach(() => {
    cleanup();
  });

  test("Clear view appears in the toolbar's dropdown and fires the host handler", () => {
    const onClearSavedView: () => void = jest.fn();
    const onSavedViewSelect: (viewId: string) => void = jest.fn();

    render(
      <LogsViewerToolbar
        resultCount={12}
        savedViews={VIEWS}
        selectedSavedViewId="errors"
        onSavedViewSelect={onSavedViewSelect}
        onClearSavedView={onClearSavedView}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Errors only/ }));
    fireEvent.click(screen.getByRole("button", { name: CLEAR_LABEL }));

    expect(onClearSavedView).toHaveBeenCalledTimes(1);
    expect(onSavedViewSelect).not.toHaveBeenCalled();
  });

  test("a toolbar without a clear handler shows no Clear view row", () => {
    render(
      <LogsViewerToolbar
        resultCount={12}
        savedViews={VIEWS}
        selectedSavedViewId="errors"
        onSavedViewSelect={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Errors only/ }));

    expect(screen.queryByText(CLEAR_LABEL)).toBeNull();
  });
});

/*
 * The sidebar lists the same saved views a second time. It has no room for a
 * "Clear view" row, so the toggle is the whole affordance there — and without
 * it the sidebar quietly stayed a one-way door even after the dropdown was
 * fixed.
 */
describe("LogsFacetSidebar toggles the applied view off", () => {
  afterEach(() => {
    cleanup();
  });

  function renderSidebar(
    onClearSavedView: (() => void) | undefined,
    onSavedViewSelect: (viewId: string) => void,
  ): void {
    render(
      <LogsFacetSidebar
        facetData={{}}
        isLoading={false}
        serviceMap={{}}
        onIncludeFilter={jest.fn()}
        onExcludeFilter={jest.fn()}
        savedViews={VIEWS}
        selectedSavedViewId="errors"
        onSavedViewSelect={onSavedViewSelect}
        onClearSavedView={onClearSavedView}
      />,
    );
  }

  test("clicking the applied view clears it", () => {
    const onClearSavedView: () => void = jest.fn();
    const onSavedViewSelect: (viewId: string) => void = jest.fn();

    renderSidebar(onClearSavedView, onSavedViewSelect);
    fireEvent.click(screen.getByRole("button", { name: /Errors only/ }));

    expect(onClearSavedView).toHaveBeenCalledTimes(1);
    expect(onSavedViewSelect).not.toHaveBeenCalled();
  });

  test("clicking another view still applies it", () => {
    const onClearSavedView: () => void = jest.fn();
    const onSavedViewSelect: (viewId: string) => void = jest.fn();

    renderSidebar(onClearSavedView, onSavedViewSelect);
    fireEvent.click(screen.getByRole("button", { name: /Checkout service/ }));

    expect(onSavedViewSelect).toHaveBeenCalledWith("checkout");
    expect(onClearSavedView).not.toHaveBeenCalled();
  });

  test("the applied row reports itself as pressed", () => {
    renderSidebar(jest.fn(), jest.fn());

    expect(screen.getByRole("button", { name: /Errors only/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("button", { name: /Checkout service/ }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  test("a sidebar without a clear handler re-applies as before", () => {
    const onSavedViewSelect: (viewId: string) => void = jest.fn();

    renderSidebar(undefined, onSavedViewSelect);
    fireEvent.click(screen.getByRole("button", { name: /Errors only/ }));

    expect(onSavedViewSelect).toHaveBeenCalledWith("errors");
  });
});
