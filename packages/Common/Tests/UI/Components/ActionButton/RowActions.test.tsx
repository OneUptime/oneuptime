import ActionButtonSchema, {
  ActionButtonPlacement,
} from "../../../../UI/Components/ActionButton/ActionButtonSchema";
import RowActions from "../../../../UI/Components/ActionButton/RowActions";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";
import IconProp from "../../../../Types/Icon/IconProp";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

/*
 * RowActions is what every table row, list card and ordered-states item now
 * draws in place of its old row of buttons: one button, and a ⋯ menu with the
 * rest. These tests drive it the way a person does - look at the row, open
 * the menu, pick an item - and check that the right action runs for the right
 * row, that nothing is lost on the way into the menu (disabled state, the
 * tooltip that explains it, errors), and that the menu escapes the row.
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

jest.setTimeout(30000);

interface Member {
  id: string;
  name: string;
}

const ADA: Member = { id: "ada", name: "Ada Lovelace" };

type OnClick = ActionButtonSchema<Member>["onClick"];

interface Actions {
  showId: ActionButtonSchema<Member>;
  view: ActionButtonSchema<Member>;
  edit: ActionButtonSchema<Member>;
  remove: ActionButtonSchema<Member>;
  onShowId: jest.Mock<OnClick>;
  onView: jest.Mock<OnClick>;
  onEdit: jest.Mock<OnClick>;
  onRemove: jest.Mock<OnClick>;
}

const makeActions: () => Actions = (): Actions => {
  const onShowId: jest.Mock<OnClick> = jest.fn<OnClick>();
  const onView: jest.Mock<OnClick> = jest.fn<OnClick>();
  const onEdit: jest.Mock<OnClick> = jest.fn<OnClick>();
  const onRemove: jest.Mock<OnClick> = jest.fn<OnClick>();

  return {
    showId: {
      title: "Show ID",
      buttonStyleType: ButtonStyleType.OUTLINE,
      hideOnMobile: true,
      placement: ActionButtonPlacement.MoreMenu,
      onClick: onShowId,
    },
    view: {
      title: "View User",
      buttonStyleType: ButtonStyleType.NORMAL,
      placement: ActionButtonPlacement.Primary,
      onClick: onView,
    },
    edit: {
      title: "Edit",
      buttonStyleType: ButtonStyleType.OUTLINE,
      onClick: onEdit,
    },
    remove: {
      title: "Remove from Project",
      icon: IconProp.Trash,
      buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
      onClick: onRemove,
    },
    onShowId,
    onView,
    onEdit,
    onRemove,
  };
};

type RenderRowFunction = (
  actionButtons: Array<ActionButtonSchema<Member>> | undefined,
  options?: { isMobile?: boolean; className?: string; item?: Member },
) => RenderResult;

const renderRow: RenderRowFunction = (
  actionButtons: Array<ActionButtonSchema<Member>> | undefined,
  options?: { isMobile?: boolean; className?: string; item?: Member },
): RenderResult => {
  return render(
    <div data-testid="row">
      <RowActions<Member>
        item={options?.item || ADA}
        actionButtons={actionButtons}
        isMobile={options?.isMobile}
        className={options?.className}
      />
    </div>,
  );
};

const queryMoreButton: () => HTMLElement | null = (): HTMLElement | null => {
  return screen.queryByTestId("row-actions-more-button");
};

const openMenu: () => HTMLElement = (): HTMLElement => {
  const trigger: HTMLElement | null = queryMoreButton();

  if (!trigger) {
    throw new Error("The row has no ⋯ menu.");
  }

  fireEvent.click(trigger);

  return screen.getByRole("menu");
};

const menuItemLabels: (menu: HTMLElement) => Array<string> = (
  menu: HTMLElement,
): Array<string> => {
  return within(menu)
    .getAllByRole("menuitem")
    .map((item: HTMLElement) => {
      return (item.textContent || "").trim();
    });
};

describe("RowActions", () => {
  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  describe("what the row shows", () => {
    test("renders nothing at all for a row with no actions", () => {
      renderRow([]);

      expect(screen.queryByTestId("row-actions")).toBeNull();
      expect(screen.getByTestId("row")).toBeEmptyDOMElement();
    });

    test("renders nothing when every action is hidden for this row", () => {
      const actions: Actions = makeActions();

      renderRow([
        {
          ...actions.edit,
          isVisible: () => {
            return false;
          },
        },
      ]);

      expect(screen.getByTestId("row")).toBeEmptyDOMElement();
    });

    test("a single action is a plain button with no ⋯ menu", () => {
      const actions: Actions = makeActions();

      renderRow([actions.edit]);

      expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
      expect(queryMoreButton()).toBeNull();
    });

    test("View User stays on the row and Remove from Project is in the menu", () => {
      const actions: Actions = makeActions();

      renderRow([actions.view, actions.remove]);

      const row: HTMLElement = screen.getByTestId("row");

      expect(
        within(row).getByRole("button", { name: "View User" }),
      ).toBeInTheDocument();
      expect(within(row).queryByText("Remove from Project")).toBeNull();
      expect(queryMoreButton()).toBeInTheDocument();

      expect(menuItemLabels(openMenu())).toEqual(["Remove from Project"]);
    });

    test("a Show ID only row shows the ⋯ menu and no button", () => {
      const actions: Actions = makeActions();

      renderRow([actions.showId]);

      expect(screen.queryByRole("button", { name: "Show ID" })).toBeNull();
      expect(
        within(screen.getByTestId("row-actions")).getAllByRole("button"),
      ).toHaveLength(1);

      expect(menuItemLabels(openMenu())).toEqual(["Show ID"]);
    });

    test("the full ModelTable set shows View and folds Show ID, Edit and Delete in that order", () => {
      const actions: Actions = makeActions();

      renderRow([actions.showId, actions.view, actions.edit, actions.remove]);

      expect(
        within(screen.getByTestId("row-actions")).getAllByRole("button"),
      ).toHaveLength(2);
      expect(menuItemLabels(openMenu())).toEqual([
        "Show ID",
        "Edit",
        "Remove from Project",
      ]);
    });

    test("right-aligns by default and takes a caller's alignment instead", () => {
      const actions: Actions = makeActions();

      const { unmount } = renderRow([actions.view, actions.remove]);

      expect(screen.getByTestId("row-actions")).toHaveClass("justify-end");

      unmount();

      renderRow([actions.view, actions.remove], {
        className: "justify-center",
      });

      expect(screen.getByTestId("row-actions")).toHaveClass("justify-center");
      expect(screen.getByTestId("row-actions")).not.toHaveClass("justify-end");
    });

    test("on mobile, actions marked hideOnMobile are left out entirely", () => {
      const actions: Actions = makeActions();

      renderRow([actions.showId, actions.view], { isMobile: true });

      expect(
        screen.getByRole("button", { name: "View User" }),
      ).toBeInTheDocument();
      expect(queryMoreButton()).toBeNull();
    });
  });

  describe("the ⋯ trigger", () => {
    test("is a named menu button that reports whether it is open", () => {
      const actions: Actions = makeActions();

      renderRow([actions.view, actions.remove]);

      const trigger: HTMLElement = queryMoreButton()!;

      expect(trigger).toHaveAttribute("aria-label", "More actions");
      expect(trigger).toHaveAttribute("aria-haspopup", "menu");
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(trigger).toHaveAttribute("type", "button");

      openMenu();

      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(trigger).toHaveAttribute(
        "aria-controls",
        screen.getByRole("menu").id,
      );
    });

    test("the menu is closed until the trigger is clicked, and a second click closes it", () => {
      const actions: Actions = makeActions();

      renderRow([actions.view, actions.remove]);

      expect(screen.queryByRole("menu")).toBeNull();

      openMenu();

      expect(screen.getByRole("menu")).toBeInTheDocument();

      fireEvent.click(queryMoreButton()!);

      expect(screen.queryByRole("menu")).toBeNull();
    });
  });

  describe("the menu", () => {
    /*
     * A table row lives inside an overflow-x-auto scroller. A menu drawn
     * inside the row would be clipped under the last rows of every table, so
     * it has to be rendered outside the row entirely.
     */
    test("is rendered outside the row, at the end of the document body", () => {
      const actions: Actions = makeActions();

      renderRow([actions.view, actions.remove]);

      const menu: HTMLElement = openMenu();

      expect(screen.getByTestId("row")).not.toContainElement(menu);
      expect(menu.parentElement).toBe(document.body);
      expect(menu.style.position).toBe("fixed");
    });

    test("puts a divider between the everyday actions and the destructive ones", () => {
      const actions: Actions = makeActions();

      renderRow([actions.showId, actions.view, actions.edit, actions.remove]);

      const menu: HTMLElement = openMenu();
      const children: Array<Element> = Array.from(menu.children);
      const removeItem: HTMLElement = within(menu).getByRole("menuitem", {
        name: /Remove from Project/,
      });
      const removeIndex: number = children.findIndex((child: Element) => {
        return child === removeItem || child.contains(removeItem);
      });

      expect(children[removeIndex - 1]).toHaveAttribute("role", "none");
    });

    test("draws destructive actions in red and everyday ones in grey", () => {
      const actions: Actions = makeActions();

      renderRow([actions.view, actions.edit, actions.remove]);

      const menu: HTMLElement = openMenu();

      expect(
        within(menu).getByRole("menuitem", { name: /Remove from Project/ }),
      ).toHaveClass("text-red-600");
      expect(within(menu).getByRole("menuitem", { name: "Edit" })).toHaveClass(
        "text-gray-700",
      );
      expect(
        within(menu).getByRole("menuitem", { name: "Edit" }),
      ).not.toHaveClass("text-red-600");
    });

    test("lines up labels when only some items have an icon", () => {
      const actions: Actions = makeActions();

      renderRow([actions.view, actions.edit, actions.remove]);

      const editItem: HTMLElement = within(openMenu()).getByRole("menuitem", {
        name: "Edit",
      });
      const spacer: Element | null = editItem.querySelector(
        'span[aria-hidden="true"]',
      );

      expect(spacer).not.toBeNull();
      expect(spacer).toHaveClass("w-4");
    });

    test("reserves no icon gutter when no item has an icon", () => {
      const actions: Actions = makeActions();

      renderRow([actions.view, actions.showId, actions.edit]);

      const editItem: HTMLElement = within(openMenu()).getByRole("menuitem", {
        name: "Edit",
      });

      expect(editItem.querySelector('span[aria-hidden="true"]')).toBeNull();
    });
  });

  describe("running actions", () => {
    test("the row button runs its action for this row", () => {
      const actions: Actions = makeActions();

      renderRow([actions.view, actions.remove]);

      fireEvent.click(screen.getByRole("button", { name: "View User" }));

      expect(actions.onView).toHaveBeenCalledTimes(1);
      expect(actions.onView.mock.calls[0]?.[0]).toBe(ADA);
      expect(actions.onRemove).not.toHaveBeenCalled();
    });

    test("a menu item runs its action for this row and closes the menu", () => {
      const actions: Actions = makeActions();

      renderRow([actions.view, actions.remove]);

      fireEvent.click(
        within(openMenu()).getByRole("menuitem", {
          name: /Remove from Project/,
        }),
      );

      expect(actions.onRemove).toHaveBeenCalledTimes(1);
      expect(actions.onRemove.mock.calls[0]?.[0]).toBe(ADA);
      expect(actions.onView).not.toHaveBeenCalled();
      expect(screen.queryByRole("menu")).toBeNull();
    });

    test("each row's menu acts on its own row", () => {
      const actions: Actions = makeActions();
      const grace: Member = { id: "grace", name: "Grace Hopper" };

      render(
        <div>
          <div data-testid="row-ada">
            <RowActions<Member>
              item={ADA}
              actionButtons={[actions.view, actions.remove]}
            />
          </div>
          <div data-testid="row-grace">
            <RowActions<Member>
              item={grace}
              actionButtons={[actions.view, actions.remove]}
            />
          </div>
        </div>,
      );

      fireEvent.click(
        within(screen.getByTestId("row-grace")).getByTestId(
          "row-actions-more-button",
        ),
      );
      fireEvent.click(
        within(screen.getByRole("menu")).getByRole("menuitem", {
          name: /Remove from Project/,
        }),
      );

      expect(actions.onRemove).toHaveBeenCalledTimes(1);
      expect(actions.onRemove.mock.calls[0]?.[0]).toBe(grace);
    });

    test("a disabled row button stays on screen, locked, and does nothing", () => {
      const actions: Actions = makeActions();

      renderRow([
        { ...actions.edit, disabled: true, tooltip: "You cannot edit" },
        actions.remove,
      ]);

      const edit: HTMLElement = screen.getByRole("button", { name: "Edit" });

      expect(edit).toBeDisabled();

      fireEvent.click(edit);

      expect(actions.onEdit).not.toHaveBeenCalled();
    });

    test("a disabled menu item is listed, locked, explains itself and does nothing", () => {
      const actions: Actions = makeActions();

      renderRow([
        actions.edit,
        {
          ...actions.remove,
          disabled: true,
          tooltip: "Only admins can remove members",
        },
      ]);

      const removeItem: HTMLElement = within(openMenu()).getByRole(
        "menuitem",
        { name: /Remove from Project/ },
      );

      expect(removeItem).toBeDisabled();

      fireEvent.click(removeItem);

      expect(actions.onRemove).not.toHaveBeenCalled();

      fireEvent.mouseEnter(removeItem.parentElement as HTMLElement);

      expect(screen.getByRole("tooltip")).toHaveTextContent(
        "Only admins can remove members",
      );
    });

    test("an action that fails from the menu reports its error in a dialog", () => {
      const actions: Actions = makeActions();

      renderRow([
        actions.view,
        {
          ...actions.remove,
          onClick: (
            _item: Member,
            _onComplete: () => void,
            onError: (error: Error) => void,
          ) => {
            onError(new Error("Could not remove Ada from the project."));
          },
        },
      ]);

      fireEvent.click(
        within(openMenu()).getByRole("menuitem", {
          name: /Remove from Project/,
        }),
      );

      expect(
        screen.getByText("Could not remove Ada from the project."),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(
        screen.queryByText("Could not remove Ada from the project."),
      ).toBeNull();
    });

    test("an action that fails from the row button reports its error too", () => {
      renderRow([
        {
          title: "Verify",
          buttonStyleType: ButtonStyleType.NORMAL,
          onClick: (
            _item: Member,
            _onComplete: () => void,
            onError: (error: Error) => void,
          ) => {
            onError(new Error("The TXT record was not found."));
          },
        },
      ]);

      fireEvent.click(screen.getByRole("button", { name: "Verify" }));

      expect(
        screen.getByText("The TXT record was not found."),
      ).toBeInTheDocument();
    });

    test("passes working completion callbacks to the handler", () => {
      const onComplete: jest.Mock<() => void> = jest.fn<() => void>();

      renderRow([
        {
          title: "Verify",
          buttonStyleType: ButtonStyleType.NORMAL,
          onClick: (_item: Member, complete: () => void) => {
            complete();
            onComplete();
          },
        },
      ]);

      fireEvent.click(screen.getByRole("button", { name: "Verify" }));

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "Verify" })).not.toBeDisabled();
    });
  });

  describe("keyboard", () => {
    test("opening the menu focuses its first item and arrows move through it", () => {
      const actions: Actions = makeActions();

      renderRow([actions.showId, actions.view, actions.edit, actions.remove]);

      const menu: HTMLElement = openMenu();
      const items: Array<HTMLElement> = within(menu).getAllByRole("menuitem");

      expect(items[0]).toHaveFocus();

      fireEvent.keyDown(items[0]!, { key: "ArrowDown" });

      expect(items[1]).toHaveFocus();

      fireEvent.keyDown(items[1]!, { key: "End" });

      expect(items[2]).toHaveFocus();
    });

    test("Enter on a focused item runs it", () => {
      const actions: Actions = makeActions();

      renderRow([actions.view, actions.edit, actions.remove]);

      const menu: HTMLElement = openMenu();
      const editItem: HTMLElement = within(menu).getByRole("menuitem", {
        name: "Edit",
      });

      fireEvent.keyDown(editItem, { key: "Enter" });

      expect(actions.onEdit).toHaveBeenCalledTimes(1);
      expect(actions.onRemove).not.toHaveBeenCalled();
    });

    test("Escape closes the menu and hands focus back to the ⋯ trigger", () => {
      const actions: Actions = makeActions();

      renderRow([actions.view, actions.remove]);

      const menu: HTMLElement = openMenu();

      fireEvent.keyDown(within(menu).getAllByRole("menuitem")[0]!, {
        key: "Escape",
      });

      expect(screen.queryByRole("menu")).toBeNull();
      expect(queryMoreButton()).toHaveFocus();
    });

    test("Tab closes the menu from the ⋯ trigger, not from the end of the page", () => {
      const actions: Actions = makeActions();

      renderRow([actions.view, actions.remove]);

      const menu: HTMLElement = openMenu();

      act(() => {
        fireEvent.keyDown(within(menu).getAllByRole("menuitem")[0]!, {
          key: "Tab",
        });
      });

      expect(screen.queryByRole("menu")).toBeNull();
      expect(queryMoreButton()).toHaveFocus();
    });
  });
});
