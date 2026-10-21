import Monitor from "../../../../Models/DatabaseModels/Monitor";
import StatusPageResource from "../../../../Models/DatabaseModels/StatusPageResource";
import ResourceGrid from "../../../../UI/Components/StatusPage/ResourceGrid";
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import React, { ReactElement } from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { Mock } from "jest-mock";

/*
 * Contract under test - what can be done to a resource on a grid group, and
 * where it is done from.
 *
 * A grid chip used to carry an edit button and a trash button side by side,
 * and so did every resource that fell off the grid. A list row carries an edit
 * button and a ⋯ menu holding the id and a red "Remove from status page". The
 * two are the same resources in a different arrangement, so a grid now carries
 * exactly what a list row does: edit stays one click away, and the rest waits
 * behind ⋯, with the removal last and in red.
 *
 * These tests drive it the way a person does - look at the chip, open its ⋯,
 * pick an item - and check the right thing happens to the right resource.
 */

jest.setTimeout(30000);

type MakeResourceFunction = (data: {
  id?: string | undefined;
  monitorName: string;
  rowAxisValue?: string | undefined;
  columnAxisValue?: string | undefined;
}) => StatusPageResource;

const makeResource: MakeResourceFunction = (data: {
  id?: string | undefined;
  monitorName: string;
  rowAxisValue?: string | undefined;
  columnAxisValue?: string | undefined;
}): StatusPageResource => {
  const resource: StatusPageResource = new StatusPageResource();

  if (data.id) {
    resource._id = data.id;
  }

  const monitor: Monitor = new Monitor();
  monitor._id = `monitor-${data.id || "none"}`;
  monitor.name = data.monitorName;
  resource.monitor = monitor;

  if (data.rowAxisValue) {
    resource.rowAxisValue = data.rowAxisValue;
  }

  if (data.columnAxisValue) {
    resource.columnAxisValue = data.columnAxisValue;
  }

  return resource;
};

const AUTH_US: StatusPageResource = makeResource({
  id: "resource-auth-us",
  monitorName: "Auth US",
  rowAxisValue: "Auth",
  columnAxisValue: "US-East",
});
/*
 * In the same row as Auth US, so the two sit side by side: acting on one must
 * never reach the other.
 */
const AUTH_EU: StatusPageResource = makeResource({
  id: "resource-auth-eu",
  monitorName: "Auth EU",
  rowAxisValue: "Auth",
  columnAxisValue: "EU-West",
});
/* Its row is not one this group defines, so it never reaches a cell. */
const STRANDED: StatusPageResource = makeResource({
  id: "resource-stranded",
  monitorName: "Stranded",
  rowAxisValue: "Renamed",
  columnAxisValue: "US-East",
});

type ResourceCallback = (statusPageResource: StatusPageResource) => void;

const onEdit: Mock<ResourceCallback> = jest.fn<ResourceCallback>();
const onDelete: Mock<ResourceCallback> = jest.fn<ResourceCallback>();
const onShowId: Mock<ResourceCallback> = jest.fn<ResourceCallback>();

interface RenderOptions {
  isEditable?: boolean | undefined;
  isDeleteable?: boolean | undefined;
}

type RenderGridFunction = (
  options?: RenderOptions,
) => ReturnType<typeof render>;

const renderGrid: RenderGridFunction = (
  options: RenderOptions = {},
): ReturnType<typeof render> => {
  return render(
    <ResourceGrid
      rowLabel="Service"
      columnLabel="Region"
      rowValues={["Auth", "API"]}
      columnValues={["US-East", "EU-West"]}
      statusPageResources={[AUTH_US, AUTH_EU, STRANDED]}
      getResourceElement={(
        statusPageResource: StatusPageResource,
      ): ReactElement => {
        return <span>{statusPageResource.monitor?.name || "Unknown"}</span>;
      }}
      isCreateable={true}
      isEditable={options.isEditable === undefined ? true : options.isEditable}
      isDeleteable={
        options.isDeleteable === undefined ? true : options.isDeleteable
      }
      isSelectable={true}
      selectedResourceIds={new Set<string>()}
      onToggleResourceSelected={() => {}}
      onAddToCell={() => {}}
      onEdit={onEdit}
      onDelete={onDelete}
      onShowId={onShowId}
    />,
  );
};

type ChipByNameFunction = (name: string) => HTMLElement;

/* A chip in a cell, or a row in the list of resources not on the grid. */
const chipByName: ChipByNameFunction = (name: string): HTMLElement => {
  const chip: HTMLElement | undefined = [
    ...screen.queryAllByTestId("status-page-resource-grid-cell-item"),
    ...screen.queryAllByTestId("status-page-resource-grid-orphan"),
  ].find((candidate: HTMLElement) => {
    return (candidate.textContent || "").includes(name);
  });

  if (!chip) {
    throw new Error(`No chip called ${name} is on screen`);
  }

  return chip;
};

type ActionsOfFunction = (name: string) => HTMLElement;

const actionsOf: ActionsOfFunction = (name: string): HTMLElement => {
  return within(chipByName(name)).getByTestId(
    "status-page-resource-grid-actions",
  );
};

type OpenMenuFunction = (name: string) => HTMLElement;

/* Opens the named chip's ⋯ and hands back the menu it opened. */
const openMenu: OpenMenuFunction = (name: string): HTMLElement => {
  fireEvent.click(
    within(chipByName(name)).getByTestId("status-page-resource-grid-more"),
  );

  return screen.getByRole("menu");
};

type MenuItemNamesFunction = (menu: HTMLElement) => Array<string>;

const menuItemNames: MenuItemNamesFunction = (
  menu: HTMLElement,
): Array<string> => {
  return within(menu)
    .getAllByRole("menuitem")
    .map((item: HTMLElement) => {
      return (item.textContent || "").trim();
    });
};

type ButtonNamesFunction = (container: HTMLElement) => Array<string>;

const buttonNames: ButtonNamesFunction = (
  container: HTMLElement,
): Array<string> => {
  return within(container)
    .getAllByRole("button")
    .map((button: HTMLElement) => {
      return button.getAttribute("aria-label") || "";
    });
};

describe("ResourceGrid - a resource's actions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("a chip in a cell", () => {
    test("shows its edit button and a ⋯, and nothing else", () => {
      renderGrid();

      expect(buttonNames(actionsOf("Auth US"))).toEqual([
        "Edit Auth US",
        "More actions for Auth US",
      ]);

      /* The trash button that used to sit on the chip is gone. */
      expect(
        within(chipByName("Auth US")).queryByLabelText("Remove Auth US"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("status-page-resource-grid-delete"),
      ).not.toBeInTheDocument();

      /* Nothing is open until somebody asks for it. */
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    test("its ⋯ lists Show ID, then the removal last and in red", () => {
      renderGrid();

      const menu: HTMLElement = openMenu("Auth US");

      expect(menuItemNames(menu)).toEqual([
        "Show ID",
        "Remove from status page",
      ]);

      const items: Array<HTMLElement> = within(menu).getAllByRole("menuitem");

      expect(items[items.length - 1]!.className).toContain("text-red-600");
      expect(items[0]!.className).not.toContain("text-red-600");
    });

    test("the ⋯ says whose actions it holds", () => {
      renderGrid();

      const trigger: HTMLElement = within(chipByName("Auth EU")).getByTestId(
        "status-page-resource-grid-more",
      );

      expect(trigger).toHaveAttribute("aria-label", "More actions for Auth EU");
      expect(trigger).toHaveAttribute("aria-haspopup", "menu");
      expect(trigger).toHaveAttribute("aria-expanded", "false");
    });

    test("removing from the menu removes that chip's resource, not its neighbour's", () => {
      renderGrid();

      const menu: HTMLElement = openMenu("Auth EU");

      fireEvent.click(
        within(menu).getByRole("menuitem", {
          name: "Remove from status page",
        }),
      );

      expect(onDelete).toHaveBeenCalledTimes(1);
      expect(onDelete.mock.calls[0]![0]).toBe(AUTH_EU);
      expect(onEdit).not.toHaveBeenCalled();
      expect(onShowId).not.toHaveBeenCalled();

      /* Choosing an item is the end of the menu's job. */
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    test("Show ID from the menu asks for that chip's resource", () => {
      renderGrid();

      const menu: HTMLElement = openMenu("Auth EU");

      fireEvent.click(within(menu).getByRole("menuitem", { name: "Show ID" }));

      expect(onShowId).toHaveBeenCalledTimes(1);
      expect(onShowId.mock.calls[0]![0]).toBe(AUTH_EU);
      expect(onDelete).not.toHaveBeenCalled();
    });

    test("edit is still one click away, on the chip itself", () => {
      renderGrid();

      fireEvent.click(
        within(chipByName("Auth EU")).getByTestId(
          "status-page-resource-grid-edit",
        ),
      );

      expect(onEdit).toHaveBeenCalledTimes(1);
      expect(onEdit.mock.calls[0]![0]).toBe(AUTH_EU);
      expect(onDelete).not.toHaveBeenCalled();
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    /*
     * The grid scrolls sideways inside an overflow-x-auto box, which clips
     * anything absolutely positioned inside it - a menu under a chip in the
     * bottom row would be cut off, or would scroll the grid instead of showing.
     */
    test("its menu opens outside the grid, where no cell can clip it", () => {
      renderGrid();

      const menu: HTMLElement = openMenu("Auth US");

      expect(menu.parentElement).toBe(document.body);
      expect(menu.style.position).toBe("fixed");
      expect(
        screen.getByTestId("status-page-resource-grid").contains(menu),
      ).toBe(false);
    });

    /*
     * The actions fade in on hover and on focus. Neither survives opening the
     * menu - the pointer leaves the chip to reach it and focus moves into it -
     * so the cluster also shows while it contains an expanded trigger. jsdom
     * cannot evaluate :has(), so this checks both halves of what the rule
     * relies on: the class is there, and the trigger it looks for is expanded
     * exactly while the menu is open.
     */
    test("its actions fade in on hover but stay shown while the menu is open", () => {
      renderGrid();

      const actions: HTMLElement = actionsOf("Auth US");

      expect(actions.className).toContain("opacity-0");
      expect(actions.className).toContain("group-hover:opacity-100");
      expect(actions.className).toContain("focus-within:opacity-100");
      expect(actions.className).toContain(
        "has-[[aria-expanded=true]]:opacity-100",
      );
      expect(
        actions.querySelector('[aria-expanded="true"]'),
      ).not.toBeInTheDocument();

      const menu: HTMLElement = openMenu("Auth US");

      const trigger: HTMLElement = within(actions).getByTestId(
        "status-page-resource-grid-more",
      );

      expect(actions.querySelector('[aria-expanded="true"]')).toBe(trigger);

      fireEvent.keyDown(within(menu).getAllByRole("menuitem")[0]!, {
        key: "Escape",
      });

      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(
        actions.querySelector('[aria-expanded="true"]'),
      ).not.toBeInTheDocument();
      /* Escape hands focus back to the trigger, which keeps it shown. */
      expect(document.activeElement).toBe(trigger);
    });

    test("opening a second chip's menu closes the first", () => {
      renderGrid();

      openMenu("Auth US");
      openMenu("Auth EU");

      expect(screen.getAllByRole("menu").length).toBe(1);
      expect(
        within(chipByName("Auth US")).getByTestId(
          "status-page-resource-grid-more",
        ),
      ).toHaveAttribute("aria-expanded", "false");
      expect(
        within(chipByName("Auth EU")).getByTestId(
          "status-page-resource-grid-more",
        ),
      ).toHaveAttribute("aria-expanded", "true");

      fireEvent.click(
        within(screen.getByRole("menu")).getByRole("menuitem", {
          name: "Remove from status page",
        }),
      );

      expect(onDelete.mock.calls[0]![0]).toBe(AUTH_EU);
    });

    test("the menu can be driven from the keyboard", async () => {
      renderGrid();

      const menu: HTMLElement = openMenu("Auth EU");

      /* Let the portalled menu be placed; the first item is focused then. */
      await act(async () => {
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 0);
        });
      });

      const items: Array<HTMLElement> = within(menu).getAllByRole("menuitem");

      expect(document.activeElement).toBe(items[0]);

      fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });

      expect(document.activeElement).toBe(items[1]);

      fireEvent.keyDown(document.activeElement!, { key: "Enter" });

      expect(onDelete).toHaveBeenCalledTimes(1);
      expect(onDelete.mock.calls[0]![0]).toBe(AUTH_EU);
    });
  });

  describe("a resource that is not on the grid", () => {
    test("shows the same edit button and ⋯ as a chip", () => {
      renderGrid();

      expect(buttonNames(actionsOf("Stranded"))).toEqual([
        "Edit Stranded",
        "More actions for Stranded",
      ]);
      expect(
        within(chipByName("Stranded")).queryByLabelText("Remove Stranded"),
      ).not.toBeInTheDocument();
    });

    /*
     * It is invisible to visitors until somebody fixes it, so its actions are
     * not held back behind a hover the way a chip's are.
     */
    test("keeps its actions in view without a hover", () => {
      renderGrid();

      expect(actionsOf("Stranded").className).not.toContain("opacity-0");
    });

    test("its ⋯ lists the same items, removal last and in red", () => {
      renderGrid();

      const menu: HTMLElement = openMenu("Stranded");

      expect(menuItemNames(menu)).toEqual([
        "Show ID",
        "Remove from status page",
      ]);
      expect(
        within(menu).getByRole("menuitem", {
          name: "Remove from status page",
        }).className,
      ).toContain("text-red-600");
      expect(
        screen.getByTestId("status-page-resource-grid-orphans").contains(menu),
      ).toBe(false);
    });

    test("each item acts on the stranded resource", () => {
      renderGrid();

      fireEvent.click(
        within(openMenu("Stranded")).getByRole("menuitem", {
          name: "Remove from status page",
        }),
      );

      expect(onDelete).toHaveBeenCalledTimes(1);
      expect(onDelete.mock.calls[0]![0]).toBe(STRANDED);

      fireEvent.click(
        within(openMenu("Stranded")).getByRole("menuitem", {
          name: "Show ID",
        }),
      );

      expect(onShowId).toHaveBeenCalledTimes(1);
      expect(onShowId.mock.calls[0]![0]).toBe(STRANDED);

      fireEvent.click(
        within(chipByName("Stranded")).getByTestId(
          "status-page-resource-grid-edit",
        ),
      );

      expect(onEdit).toHaveBeenCalledTimes(1);
      expect(onEdit.mock.calls[0]![0]).toBe(STRANDED);
    });
  });

  describe("what an operator may do", () => {
    test("somebody who may not remove gets no removal anywhere", () => {
      renderGrid({ isDeleteable: false });

      expect(menuItemNames(openMenu("Auth US"))).toEqual(["Show ID"]);

      fireEvent.keyDown(
        within(screen.getByRole("menu")).getByRole("menuitem"),
        { key: "Escape" },
      );

      expect(menuItemNames(openMenu("Stranded"))).toEqual(["Show ID"]);
      expect(
        screen.queryByRole("menuitem", { name: "Remove from status page" }),
      ).not.toBeInTheDocument();
    });

    test("somebody who may not edit gets only the ⋯", () => {
      renderGrid({ isEditable: false });

      expect(buttonNames(actionsOf("Auth US"))).toEqual([
        "More actions for Auth US",
      ]);
      expect(buttonNames(actionsOf("Stranded"))).toEqual([
        "More actions for Stranded",
      ]);
      expect(
        screen.queryByTestId("status-page-resource-grid-edit"),
      ).not.toBeInTheDocument();

      expect(menuItemNames(openMenu("Auth US"))).toEqual([
        "Show ID",
        "Remove from status page",
      ]);
    });

    /*
     * As on a list row: the id is something anybody who can see the resource
     * may ask for, so the ⋯ is there even when nothing else is.
     */
    test("somebody who may do neither can still read the id", () => {
      renderGrid({ isEditable: false, isDeleteable: false });

      expect(buttonNames(actionsOf("Auth US"))).toEqual([
        "More actions for Auth US",
      ]);

      const menu: HTMLElement = openMenu("Auth US");

      expect(menuItemNames(menu)).toEqual(["Show ID"]);

      fireEvent.click(within(menu).getByRole("menuitem", { name: "Show ID" }));

      expect(onShowId.mock.calls[0]![0]).toBe(AUTH_US);
    });
  });
});
