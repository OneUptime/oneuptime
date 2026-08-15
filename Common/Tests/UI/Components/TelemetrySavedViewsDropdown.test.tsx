import SavedViewsDropdown, {
  SavedViewsDropdownProps,
} from "../../../UI/Components/TelemetryViewer/components/SavedViewsDropdown";
import { SavedViewOption } from "../../../UI/Components/TelemetryViewer/types";
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
 * Applying a saved view used to be a one-way door. The dropdown drew a
 * checkmark next to the active view, but clicking that row just re-applied it
 * and there was no other control that meant "none" — so anyone who picked a
 * view on the Traces explorer was stuck inside it for the rest of the session
 * (github.com/OneUptime/oneuptime/issues/3189).
 *
 * Two affordances undo it, and both are pinned here: the checkmark behaves
 * like the checkbox it looks like, and an explicit "Clear view" row spells the
 * same thing out for anyone who never thinks to click a selected item twice.
 *
 * Nothing about deselection is allowed to leak into hosts that do not support
 * it — a dropdown rendered without onClear must behave exactly as it did
 * before, which the back-compat block below holds to.
 */

const VIEWS: Array<SavedViewOption> = [
  { id: "wb-ims", name: "WB - IMS" },
  { id: "checkout", name: "Errors in checkout", isDefault: true },
];

const CLEAR_LABEL: string = "Clear view";
// Only ever rendered inside the open panel, so it doubles as an "is open" probe.
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

function rerenderDropdown(
  result: RenderResult,
  handlers: Handlers,
  overrides: Partial<SavedViewsDropdownProps>,
): void {
  const props: SavedViewsDropdownProps = {
    savedViews: VIEWS,
    selectedSavedViewId: null,
    ...handlers,
    ...overrides,
  };

  result.rerender(<SavedViewsDropdown {...props} />);
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

describe("SavedViewsDropdown — clearing the applied view", () => {
  afterEach(() => {
    cleanup();
  });

  test("clicking the applied view clears it instead of re-applying it", () => {
    const { handlers } = renderDropdown({ selectedSavedViewId: "wb-ims" });

    openMenu();
    fireEvent.click(rowFor("WB - IMS"));

    expect(handlers.onClear).toHaveBeenCalledTimes(1);
    // Re-applying what is already applied is the behaviour being replaced.
    expect(handlers.onSelect).not.toHaveBeenCalled();
    expect(isMenuOpen()).toBe(false);
  });

  test("the explicit Clear view row clears and closes the menu", () => {
    const { handlers } = renderDropdown({ selectedSavedViewId: "wb-ims" });

    openMenu();
    fireEvent.click(rowFor(CLEAR_LABEL));

    expect(handlers.onClear).toHaveBeenCalledTimes(1);
    expect(handlers.onSelect).not.toHaveBeenCalled();
    expect(isMenuOpen()).toBe(false);
  });

  test("the Clear view row is offered only while a view is applied", () => {
    const { handlers, result } = renderDropdown({ selectedSavedViewId: null });

    openMenu();
    // Nothing is applied, so there is nothing the row could undo.
    expect(screen.queryByText(CLEAR_LABEL)).toBeNull();

    rerenderDropdown(result, handlers, { selectedSavedViewId: "checkout" });

    expect(screen.getByText(CLEAR_LABEL)).toBeInTheDocument();
  });

  test("a selection pointing at a view that no longer exists offers no clear row", () => {
    /*
     * The host nulls a stale id in an effect, so for one render the dropdown
     * holds an id matching nothing. Offering "Clear view" then would be a
     * button that undoes a view the user cannot see.
     */
    renderDropdown({ selectedSavedViewId: "deleted-view" });

    openMenu();

    expect(screen.queryByText(CLEAR_LABEL)).toBeNull();
  });

  test("clicking a different view still applies it", () => {
    const { handlers } = renderDropdown({ selectedSavedViewId: "wb-ims" });

    openMenu();
    fireEvent.click(rowFor("Errors in checkout (default)"));

    expect(handlers.onSelect).toHaveBeenCalledTimes(1);
    expect(handlers.onSelect).toHaveBeenCalledWith("checkout");
    expect(handlers.onClear).not.toHaveBeenCalled();
    expect(isMenuOpen()).toBe(false);
  });

  test("the trigger drops back to the generic label once the view is cleared", () => {
    const { handlers, result } = renderDropdown({
      selectedSavedViewId: "wb-ims",
    });

    expect(trigger()).toHaveTextContent("WB - IMS");

    // What the host renders after onClear runs.
    rerenderDropdown(result, handlers, { selectedSavedViewId: null });

    expect(trigger()).toHaveTextContent("Saved Views");
    expect(trigger()).not.toHaveTextContent("WB - IMS");
  });

  test("the cleared menu has nothing left to clear", () => {
    const { handlers, result } = renderDropdown({
      selectedSavedViewId: "wb-ims",
    });

    openMenu();
    fireEvent.click(rowFor(CLEAR_LABEL));

    rerenderDropdown(result, handlers, { selectedSavedViewId: null });
    openMenu();

    expect(screen.queryByText(CLEAR_LABEL)).toBeNull();
    expect(handlers.onClear).toHaveBeenCalledTimes(1);
    // Every row is now selectable again rather than being a toggle-off.
    expect(rowFor("WB - IMS")).toHaveAttribute("aria-pressed", "false");
  });

  test("clearing then picking the same view again re-applies it", () => {
    const { handlers, result } = renderDropdown({
      selectedSavedViewId: "wb-ims",
    });

    openMenu();
    fireEvent.click(rowFor("WB - IMS"));

    rerenderDropdown(result, handlers, { selectedSavedViewId: null });
    openMenu();
    fireEvent.click(rowFor("WB - IMS"));

    expect(handlers.onClear).toHaveBeenCalledTimes(1);
    expect(handlers.onSelect).toHaveBeenCalledTimes(1);
    expect(handlers.onSelect).toHaveBeenCalledWith("wb-ims");
  });
});

describe("SavedViewsDropdown — the row reports its own state", () => {
  afterEach(() => {
    cleanup();
  });

  test("aria-pressed tracks which view is applied", () => {
    renderDropdown({ selectedSavedViewId: "wb-ims" });

    openMenu();

    expect(rowFor("WB - IMS")).toHaveAttribute("aria-pressed", "true");
    expect(rowFor("Errors in checkout (default)")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("the accessible name is the view name, not the checkmark glyph", () => {
    renderDropdown({ selectedSavedViewId: "wb-ims" });

    openMenu();

    // "✓ WB - IMS" would be the computed name if the glyph leaked into it.
    expect(rowFor("WB - IMS")).toBeInTheDocument();
  });

  test("the default badge is announced as a word, not dropped", () => {
    /*
     * The badge is inside the button, so an aria-label of just the view name
     * would hide "default" from a screen reader while sighted users see it.
     */
    renderDropdown({ selectedSavedViewId: null });

    openMenu();

    expect(rowFor("Errors in checkout (default)")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Errors in checkout" }),
    ).toBeNull();
  });
});

describe("SavedViewsDropdown — hosts that do not support clearing", () => {
  afterEach(() => {
    cleanup();
  });

  test("no Clear view row is rendered without onClear", () => {
    renderDropdown({ selectedSavedViewId: "wb-ims", onClear: undefined });

    openMenu();

    expect(screen.queryByText(CLEAR_LABEL)).toBeNull();
  });

  test("clicking the applied view falls back to re-applying it", () => {
    const { handlers } = renderDropdown({
      selectedSavedViewId: "wb-ims",
      onClear: undefined,
    });

    openMenu();
    fireEvent.click(rowFor("WB - IMS"));

    expect(handlers.onSelect).toHaveBeenCalledWith("wb-ims");
    expect(handlers.onClear).not.toHaveBeenCalled();
  });
});

describe("SavedViewsDropdown — the rest of the menu is unaffected", () => {
  afterEach(() => {
    cleanup();
  });

  test("Edit on the applied row edits and does not clear", () => {
    const { handlers } = renderDropdown({ selectedSavedViewId: "wb-ims" });

    openMenu();
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);

    expect(handlers.onEdit).toHaveBeenCalledWith("wb-ims");
    expect(handlers.onClear).not.toHaveBeenCalled();
    expect(handlers.onSelect).not.toHaveBeenCalled();
  });

  test("Delete on the applied row deletes and does not clear", () => {
    const { handlers } = renderDropdown({ selectedSavedViewId: "wb-ims" });

    openMenu();
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]!);

    expect(handlers.onDelete).toHaveBeenCalledWith("wb-ims");
    expect(handlers.onClear).not.toHaveBeenCalled();
  });

  test("Update on the applied row saves over it and does not clear", () => {
    const { handlers } = renderDropdown({ selectedSavedViewId: "wb-ims" });

    openMenu();
    fireEvent.click(rowFor("Update"));

    expect(handlers.onUpdateCurrent).toHaveBeenCalledTimes(1);
    expect(handlers.onClear).not.toHaveBeenCalled();
  });

  test("Save Current View still creates and does not clear", () => {
    const { handlers } = renderDropdown({ selectedSavedViewId: "wb-ims" });

    openMenu();
    fireEvent.click(rowFor(MENU_PROBE));

    expect(handlers.onCreate).toHaveBeenCalledTimes(1);
    expect(handlers.onClear).not.toHaveBeenCalled();
  });

  test("an empty view list still renders its empty state and no clear row", () => {
    renderDropdown({ savedViews: [], selectedSavedViewId: null });

    openMenu();

    expect(screen.getByText("No saved views yet.")).toBeInTheDocument();
    expect(screen.queryByText(CLEAR_LABEL)).toBeNull();
  });
});
