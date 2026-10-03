import ComponentsModal, {
  SEARCH_RESULTS_PAGE_SIZE,
} from "../../../../../UI/Components/Workflow/ComponentsModal";
import { ComponentType } from "../../../../../Types/Workflow/Component";
import getJestMockFunction from "../../../../MockType";
import {
  resolvePadding,
  resolveScrollPadding,
  resolveSpaceBelowInPx,
} from "../../../../ResponsiveSpacing";
import {
  LAPTOP_WIDTH_IN_PX,
  PHONE_WIDTH_IN_PX,
  TABLET_WIDTH_IN_PX,
  WIDE_DESKTOP_WIDTH_IN_PX,
} from "../../../../ResponsiveVisibility";
import { FixturePalette, buildFixturePalette } from "./PickerFixtures";
import { describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

/*
 * The room under the last row of each of the picker's views. "Browse all
 * resources", the last row of the start view, sat flush on the panel's
 * footer on any screen 640px or wider, because the side panel dropped its
 * bottom padding from the sm breakpoint up - and so did the last of a
 * resource's steps, the end of every resource A to Z, and the end of a
 * search. The room now comes from SideOver, the scroll container, so every
 * view has it at once; this pins it view by view, so a view that grows a
 * row below, or padding of its own, is caught here.
 *
 * jsdom lays nothing out, so the room is read from the classes through
 * ResponsiveSpacing, which resolves them the way the Tailwind build does.
 * The E2E spec (packages/E2E/WorkflowBuilder/ComponentPicker.spec.ts)
 * measures the same thing in a browser.
 */

const palette: FixturePalette = buildFixturePalette();

const WIDTHS: Array<number> = [
  PHONE_WIDTH_IN_PX,
  640,
  TABLET_WIDTH_IN_PX,
  LAPTOP_WIDTH_IN_PX,
  WIDE_DESKTOP_WIDTH_IN_PX,
];

// The panel's 1.5rem, the same as between the picker's sections.
const BOTTOM_SPACE_IN_PX: number = 24;

type RenderPickerFunction = (componentsType: ComponentType) => void;

const renderPicker: RenderPickerFunction = (
  componentsType: ComponentType,
): void => {
  render(
    <ComponentsModal
      componentsType={componentsType}
      components={palette.components}
      categories={palette.categories}
      onCloseModal={getJestMockFunction()}
      onComponentClick={getJestMockFunction()}
    />,
  );
};

type SearchFunction = (value: string) => void;

const search: SearchFunction = (value: string): void => {
  fireEvent.change(screen.getByRole("combobox"), { target: { value } });
};

type ElementFunction = () => HTMLElement;

const scrollContainer: ElementFunction = (): HTMLElement => {
  return screen.getByTestId("side-over-content");
};

const pickerBody: ElementFunction = (): HTMLElement => {
  return screen.getByTestId("workflow-component-picker-body");
};

const browseAllRow: ElementFunction = (): HTMLElement => {
  return screen.getByRole("button", { name: /^Browse all resources, \d+$/ });
};

type LastOfFunction = (elements: Array<HTMLElement>) => HTMLElement;

const lastOf: LastOfFunction = (elements: Array<HTMLElement>): HTMLElement => {
  return elements[elements.length - 1]!;
};

type ExpectRoomBelowFunction = (lastRow: HTMLElement) => void;

/*
 * The row ends 24px above the footer at every width, and what the keyboard
 * scrolls into view stops the same distance short of it. The measurement
 * also fails if anything is laid out below the row, so it pins which row is
 * the last one.
 */
const expectRoomBelow: ExpectRoomBelowFunction = (
  lastRow: HTMLElement,
): void => {
  for (const width of WIDTHS) {
    expect({
      width,
      spaceBelow: resolveSpaceBelowInPx(lastRow, scrollContainer(), width),
      scrollPaddingBottom: resolveScrollPadding(
        scrollContainer().getAttribute("class"),
        width,
      ).bottom,
    }).toEqual({
      width,
      spaceBelow: BOTTOM_SPACE_IN_PX,
      scrollPaddingBottom: BOTTOM_SPACE_IN_PX,
    });
  }
};

describe("the Add Component picker leaves room under the last row", () => {
  test("of its start view: Browse all resources, the row from the report", () => {
    renderPicker(ComponentType.Component);

    expectRoomBelow(browseAllRow());
  });

  test("of a resource's steps", () => {
    renderPicker(ComponentType.Component);

    fireEvent.click(
      screen.getByRole("button", { name: "Incident, 8 actions" }),
    );

    const steps: Array<HTMLElement> = within(
      screen.getByRole("group", { name: "Incident components" }),
    ).getAllByRole("button");

    expect(lastOf(steps)).toHaveAccessibleName("Delete Many Incidents");
    expectRoomBelow(lastOf(steps));
  });

  test("of every resource, A to Z", () => {
    renderPicker(ComponentType.Component);

    fireEvent.click(browseAllRow());

    const list: HTMLElement = screen.getByRole("group", {
      name: "All resources",
    });

    // The list is one bordered box; its last resource is its last row.
    expect(list.lastElementChild).toBe(
      lastOf(within(list).getAllByRole("button")),
    );
    expectRoomBelow(list);
  });

  test("of a search that has more results than it draws: Show more", () => {
    renderPicker(ComponentType.Component);

    search("incident");

    expect(screen.getAllByRole("option")).toHaveLength(
      SEARCH_RESULTS_PAGE_SIZE,
    );
    expectRoomBelow(screen.getByRole("button", { name: /^Show \d+ more$/ }));
  });

  test("of a search with every result drawn: its last result", () => {
    renderPicker(ComponentType.Component);

    search("incident");
    fireEvent.click(screen.getByRole("button", { name: /^Show \d+ more$/ }));

    expect(
      screen.queryByRole("button", { name: /^Show \d+ more$/ }),
    ).not.toBeInTheDocument();
    expectRoomBelow(lastOf(screen.getAllByRole("option")));
  });

  test("of a search with a single result", () => {
    renderPicker(ComponentType.Component);

    search("slack");

    expect(screen.getAllByRole("option")).toHaveLength(1);
    expectRoomBelow(screen.getByRole("option"));
  });

  test("of the start view again, after coming back from a resource", () => {
    renderPicker(ComponentType.Component);

    fireEvent.click(
      screen.getByRole("button", { name: "Incident, 8 actions" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expectRoomBelow(browseAllRow());
  });

  test("and a search that matches nothing is never flush either", () => {
    renderPicker(ComponentType.Component);

    search("zzzzqqqq");

    const clearSearch: HTMLElement = within(pickerBody()).getByRole("button", {
      name: "Clear search",
    });

    for (const width of WIDTHS) {
      expect(
        resolveSpaceBelowInPx(clearSearch, scrollContainer(), width),
      ).toBeGreaterThanOrEqual(BOTTOM_SPACE_IN_PX);
    }
  });
});

describe("the Add Trigger picker leaves room under the last row", () => {
  test("of its start view", () => {
    renderPicker(ComponentType.Trigger);

    expectRoomBelow(browseAllRow());
  });

  test("of a resource's triggers", () => {
    renderPicker(ComponentType.Trigger);

    fireEvent.click(
      screen.getByRole("button", { name: "Incident, 3 triggers" }),
    );

    expectRoomBelow(
      lastOf(
        within(
          screen.getByRole("group", { name: "Incident triggers" }),
        ).getAllByRole("button"),
      ),
    );
  });

  test("of every resource, A to Z", () => {
    renderPicker(ComponentType.Trigger);

    fireEvent.click(browseAllRow());

    expectRoomBelow(screen.getByRole("group", { name: "All resources" }));
  });

  test("of a search", () => {
    renderPicker(ComponentType.Trigger);

    search("incident created");

    expectRoomBelow(lastOf(screen.getAllByRole("option")));
  });
});

describe("the room is the panel's, in one place", () => {
  test("the picker adds no bottom padding of its own, so the room is not doubled", () => {
    renderPicker(ComponentType.Component);

    const root: HTMLElement = screen.getByTestId("workflow-component-picker");

    for (const width of WIDTHS) {
      expect({
        width,
        root: resolvePadding(root.getAttribute("class"), width).bottom,
        body: resolvePadding(pickerBody().getAttribute("class"), width).bottom,
      }).toEqual({ width, root: 0, body: 0 });
    }
  });

  test("the search box keeps its place at the top: only the bottom changed", () => {
    renderPicker(ComponentType.Component);

    // The sticky search box, flush with the top of the scroll area from sm up.
    const searchBox: HTMLElement = screen.getByTestId(
      "workflow-component-picker",
    ).firstElementChild as HTMLElement;
    const content: HTMLElement = scrollContainer()
      .firstElementChild as HTMLElement;

    for (const width of WIDTHS) {
      expect({
        width,
        aboveSearchInput:
          resolvePadding(content.getAttribute("class"), width).top +
          resolvePadding(searchBox.getAttribute("class"), width).top,
      }).toEqual({ width, aboveSearchInput: width < 640 ? 28 : 20 });
    }
  });
});
