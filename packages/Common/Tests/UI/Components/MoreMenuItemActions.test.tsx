import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import IconProp from "../../../Types/Icon/IconProp";
import MoreMenu from "../../../UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem, {
  MORE_MENU_ITEM_ACTION_CLASS_NAME,
} from "../../../UI/Components/MoreMenu/MoreMenuItem";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * AN ITEM'S ACTIONS BESIDE IT, EACH A MENU ITEM OF ITS OWN (#6922).
 *
 * A saved view's Rename and Delete were icons drawn inside the view's own
 * menu item: a mouse could press them, a keyboard could not reach them, a
 * screen reader had no name for them, and a click on one went on to the
 * view. An item's actions (MoreMenuItem's `actions`) sit beside it on its
 * row: real buttons, menu items the menu's arrow keys reach after the item,
 * each named in the reader's words with what it acts on.
 */

afterEach(() => {
  cleanup();
});

interface Pressed {
  applied: MockFunction;
  renamed: MockFunction;
  deleted: MockFunction;
}

function renderMenu(): Pressed {
  const pressed: Pressed = {
    applied: getJestMockFunction(),
    renamed: getJestMockFunction(),
    deleted: getJestMockFunction(),
  };

  render(
    <MoreMenu text="Saved Views">
      {[
        <MoreMenuItem
          key="errors"
          text="Errors"
          isUserContent={true}
          icon={IconProp.Window}
          onClick={() => {
            pressed.applied();
          }}
          actions={[
            {
              icon: IconProp.Edit,
              label: "Rename view Errors",
              dataTestId: "rename",
              onClick: () => {
                pressed.renamed();
              },
            },
            {
              icon: IconProp.Trash,
              label: "Delete view Errors",
              isDestructive: true,
              dataTestId: "delete",
              onClick: () => {
                pressed.deleted();
              },
            },
          ]}
        />,
        <MoreMenuItem
          key="save"
          text="Save as New View"
          icon={IconProp.Add}
          onClick={() => {}}
        />,
      ]}
    </MoreMenu>,
  );

  return pressed;
}

describe("an item's actions", () => {
  test("are buttons beside the item, menu items named for what they do, never inside it", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Saved Views" }));

    const item: HTMLElement = screen.getByRole("menuitem", { name: "Errors" });
    const rename: HTMLElement = screen.getByRole("menuitem", {
      name: "Rename view Errors",
    });
    const remove: HTMLElement = screen.getByRole("menuitem", {
      name: "Delete view Errors",
    });

    for (const action of [rename, remove]) {
      expect(action.tagName).toBe("BUTTON");
      expect(action).toHaveAttribute("type", "button");
      expect(action).not.toBe(item);
      expect(item).not.toContainElement(action);
      expect(action).toHaveClass(
        ...MORE_MENU_ITEM_ACTION_CLASS_NAME.split(" "),
      );
    }

    // The row is only where they sit: no control, no role of its own.
    expect(item.parentElement).toHaveAttribute("role", "none");
    expect(item.parentElement).toContainElement(rename);
    expect(document.querySelectorAll("button button")).toHaveLength(0);
    // Delete is red under the pointer and the keys; Rename is not.
    expect(remove.className).toContain("hover:text-red-600");
    expect(rename.className).not.toContain("red");
  });

  test("an item with no actions is drawn as it always was", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Saved Views" }));

    const save: HTMLElement = screen.getByRole("menuitem", {
      name: "Save as New View",
    });

    expect(save).toHaveClass("mx-1", "w-[calc(100%-0.5rem)]");
    expect(save.parentElement).not.toHaveAttribute("role", "none");
  });

  test("the arrow keys reach the item, then each action, then the next item", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    renderMenu();
    screen.getByRole("button", { name: "Saved Views" }).focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("menuitem", { name: "Errors" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(
      screen.getByRole("menuitem", { name: "Rename view Errors" }),
    ).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(
      screen.getByRole("menuitem", { name: "Delete view Errors" }),
    ).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(
      screen.getByRole("menuitem", { name: "Save as New View" }),
    ).toHaveFocus();
  });

  test("Enter on an action does it alone - the item is not applied - and closes the menu", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    const pressed: Pressed = renderMenu();
    screen.getByRole("button", { name: "Saved Views" }).focus();
    await user.keyboard("{Enter}{ArrowDown}{Enter}");

    expect(pressed.renamed).toHaveBeenCalledTimes(1);
    expect(pressed.applied).not.toHaveBeenCalled();
    expect(pressed.deleted).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  test("a click on an action does it alone, and on the item applies the item", () => {
    const pressed: Pressed = renderMenu();

    fireEvent.click(screen.getByRole("button", { name: "Saved Views" }));
    fireEvent.click(screen.getByTestId("delete"));

    expect(pressed.deleted).toHaveBeenCalledTimes(1);
    expect(pressed.applied).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Saved Views" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Errors" }));

    expect(pressed.applied).toHaveBeenCalledTimes(1);
    expect(pressed.renamed).not.toHaveBeenCalled();
  });
});
