import SavedViewsDropdown, {
  SavedViewsDropdownProps,
} from "../../../UI/Components/TelemetryViewer/components/SavedViewsDropdown";
import { SavedViewOption } from "../../../UI/Components/TelemetryViewer/types";
import IconProp from "../../../Types/Icon/IconProp";
import "@testing-library/jest-dom";
import {
  RenderResult,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * THE SAVED VIEWS DROPDOWN, NAMED BY ITS HOST.
 *
 * Security Events' Hunts list is the telemetry explorers' saved views
 * dropdown, so it looks and works as Traces' and Metrics' do; what it keeps
 * is hunts, so its host names it: the trigger, the panel, the empty list,
 * the footer's save and the search box take the host's words. The save can
 * be locked, saying why under it (nothing on screen to save, a role that
 * may not); a row can carry a short detail (a hunt's schedule); the
 * trigger can keep its own name while a hunt is ticked (the hunt's page
 * names it in its header); and the host hears the panel open, to read its
 * list afresh. A host that names nothing gets the views it always had.
 */

const HUNTS: Array<SavedViewOption> = [
  { id: "h1", name: "Admin sign-ins outside the office", detail: "Every Hour" },
  { id: "h2", name: "Encoded PowerShell", detail: "Every Day" },
  { id: "h3", name: "Threat intel matches" },
];

const LABELS: SavedViewsDropdownProps["labels"] = {
  trigger: "Hunts",
  panel: "Hunts",
  empty: "No hunts yet.",
  create: "+ Save as Hunt",
  search: "Search hunts...",
};

function draw(overrides: Partial<SavedViewsDropdownProps> = {}): RenderResult {
  const props: SavedViewsDropdownProps = {
    savedViews: HUNTS,
    selectedSavedViewId: null,
    onSelect: jest.fn(),
    onCreate: jest.fn(),
    labels: LABELS,
    dataTestId: "security-events-hunts-menu",
    ...overrides,
  };

  return render(<SavedViewsDropdown {...props} />);
}

function trigger(): HTMLElement {
  return within(screen.getByTestId("security-events-hunts-menu")).getAllByRole(
    "button",
  )[0]!;
}

function open(): HTMLElement {
  fireEvent.click(trigger());
  return screen.getByRole("dialog");
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the host's words", () => {
  test("name the trigger, with the count, and the panel", () => {
    draw();

    expect(trigger()).toHaveTextContent(/^Hunts3$/);
    expect(open()).toHaveAttribute("aria-label", "Hunts");
  });

  test("name the footer's save and the empty list", () => {
    draw({ savedViews: [] });

    const panel: HTMLElement = open();

    expect(within(panel).getByText("No hunts yet.")).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "+ Save as Hunt" }),
    ).toBeEnabled();
    expect(within(panel).queryByText("No saved views yet.")).toBeNull();
  });

  test("name the search box a long list grows", () => {
    draw({
      savedViews: Array.from(
        { length: 12 },
        (_: unknown, index: number): SavedViewOption => {
          return { id: `h${index}`, name: `Hunt ${index}` };
        },
      ),
    });

    expect(
      within(open()).getByRole("textbox", { name: "Search hunts..." }),
    ).toBeInTheDocument();
  });

  test("left out, read as views, as they always did", () => {
    draw({ labels: undefined, savedViews: [] });

    const panel: HTMLElement = open();

    expect(trigger()).toHaveTextContent(/^Saved Views/);
    expect(panel).toHaveAttribute("aria-label", "Saved views");
    expect(within(panel).getByText("No saved views yet.")).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "+ Save Current View" }),
    ).toBeInTheDocument();
  });
});

describe("the save", () => {
  test("saves what is on screen, and closes the panel", () => {
    const onCreate: jest.Mock = jest.fn();
    draw({ onCreate });

    fireEvent.click(
      within(open()).getByRole("button", { name: "+ Save as Hunt" }),
    );

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("locked says why, under it, and does nothing", () => {
    const onCreate: jest.Mock = jest.fn();
    draw({
      onCreate,
      createDisabledReason:
        "Type a search or pick a filter first: a hunt saves the search on screen.",
    });

    const panel: HTMLElement = open();
    const save: HTMLElement = within(panel).getByRole("button", {
      name: "+ Save as Hunt",
    });

    expect(save).toBeDisabled();
    expect(
      within(panel).getByText(
        "Type a search or pick a filter first: a hunt saves the search on screen.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(save);

    expect(onCreate).not.toHaveBeenCalled();
    // Still open: the reason stays to be read.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("the rows", () => {
  test("carry their detail after the name; a row without one shows only its name", () => {
    draw();

    const panel: HTMLElement = open();
    const row: HTMLElement = within(panel).getByRole("button", {
      name: "Encoded PowerShell",
    });

    expect(row).toHaveTextContent("Encoded PowerShellEvery Day");
    expect(
      within(panel).getByRole("button", { name: "Threat intel matches" }),
    ).toHaveTextContent(/^Threat intel matches$/);
  });

  test("give a long name whole on hover", () => {
    draw();

    expect(
      within(open()).getByTitle("Admin sign-ins outside the office"),
    ).toBeInTheDocument();
  });

  test("a default view still says default, not its detail", () => {
    draw({
      labels: undefined,
      savedViews: [
        { id: "v1", name: "Errors", isDefault: true, detail: "ignored" },
      ],
    });

    const panel: HTMLElement = open();

    expect(within(panel).getByText("default")).toBeInTheDocument();
    expect(within(panel).queryByText("ignored")).toBeNull();
  });

  test("choosing one opens it", () => {
    const onSelect: jest.Mock = jest.fn();
    draw({ onSelect });

    fireEvent.click(
      within(open()).getByRole("button", { name: "Threat intel matches" }),
    );

    expect(onSelect).toHaveBeenCalledWith("h3");
  });
});

describe("the trigger", () => {
  test("names the ticked one, unless its host names it elsewhere", () => {
    draw({ selectedSavedViewId: "h2" });
    expect(trigger()).toHaveTextContent(/^Encoded PowerShell3$/);
    cleanup();

    draw({ selectedSavedViewId: "h2", showSelectedNameInTrigger: false });
    expect(trigger()).toHaveTextContent(/^Hunts3$/);

    // Still ticked in the list.
    expect(
      within(open()).getByRole("button", { name: "Encoded PowerShell" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("draws the host's icon, a bookmark unless named", () => {
    const { container: own } = draw({
      showTriggerIcon: true,
      triggerIcon: IconProp.ViewfinderCircle,
    });
    const ownPaths: string = own.querySelector("svg")!.innerHTML;
    cleanup();

    const { container: plain } = draw({ showTriggerIcon: true });
    const plainPaths: string = plain.querySelector("svg")!.innerHTML;

    expect(ownPaths).not.toBe(plainPaths);
  });

  test("tells its host the panel opens, each time, and not as it closes", () => {
    const onOpen: jest.Mock = jest.fn();
    draw({ onOpen });

    fireEvent.click(trigger());
    expect(onOpen).toHaveBeenCalledTimes(1);

    fireEvent.click(trigger());
    expect(onOpen).toHaveBeenCalledTimes(1);

    fireEvent.click(trigger());
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});
