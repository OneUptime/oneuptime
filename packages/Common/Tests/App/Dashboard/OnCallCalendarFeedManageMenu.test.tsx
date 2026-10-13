import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The calendar link card's ⋯ - where Regenerate link, Disable / Enable link
 * and Delete link went when they stopped being three header buttons (one a
 * loud red Delete) above the subscribe options.
 *
 * Pinned here: the menu is the same ⋯ every card header has (CardMoreMenu),
 * named for what it holds; no menu is drawn with nothing in it; every item
 * has an icon; the destructive one is red; an item the reader may not take is
 * locked and says why, reachable from the keyboard; and an item that is only
 * waiting (the card is busy) is plainly disabled.
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

import IconProp from "../../../Types/Icon/IconProp";
import {
  FeedManageAction,
  getFeedManageMenuButtons,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/FeedManageMenu";

function action(
  overrides: Partial<FeedManageAction> & { key: string; text: string },
): FeedManageAction {
  return {
    icon: IconProp.Refresh,
    onClick: (): void => {},
    dataTestId: `item-${overrides.key}`,
    ...overrides,
  };
}

function renderMenu(actions: Array<FeedManageAction>): HTMLElement | null {
  const buttons: Array<ReactElement> = getFeedManageMenuButtons({
    actions: actions,
    idPrefix: "feed",
  });

  render(<div data-testid="host">{buttons}</div>);

  return screen.queryByRole("button", { name: "Manage link" });
}

function openMenu(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: "Manage link" }));

  return screen.getByRole("menu");
}

describe("the calendar link card's Manage link menu", () => {
  afterEach(() => {
    cleanup();
  });

  test("with nothing to manage there is no menu at all, never an empty one", () => {
    expect(getFeedManageMenuButtons({ actions: [], idPrefix: "feed" })).toEqual(
      [],
    );
  });

  test("one ⋯ button, named Manage link, that opens a menu", () => {
    const trigger: HTMLElement | null = renderMenu([
      action({ key: "regenerate", text: "Regenerate link" }),
    ]);

    expect(trigger).not.toBeNull();
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("data-testid", "feed-manage");
    // An icon, not a label: the same ⋯ a table's and a feed's card header has.
    expect(trigger!.textContent?.trim()).toBe("");
    expect(trigger!.querySelector("svg")).not.toBeNull();

    openMenu();

    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  test("the items come in the order given, each with its icon, the destructive one in red", () => {
    renderMenu([
      action({ key: "regenerate", text: "Regenerate link" }),
      action({ key: "toggle", text: "Disable link", icon: IconProp.BellSlash }),
      action({
        key: "delete",
        text: "Delete link",
        icon: IconProp.Trash,
        isDestructive: true,
      }),
    ]);

    const menu: HTMLElement = openMenu();
    const items: Array<HTMLElement> = within(menu).getAllByRole("menuitem");

    expect(
      items.map((item: HTMLElement): string => {
        return (item.textContent || "").trim();
      }),
    ).toEqual(["Regenerate link", "Disable link", "Delete link"]);

    for (const item of items) {
      expect(item.querySelector("svg")).not.toBeNull();
    }

    expect(items[2]!.className).toContain("text-red-600");
    expect(items[0]!.className).not.toContain("text-red-600");
    expect(items[2]).toHaveAttribute("data-testid", "item-delete");
  });

  test("choosing an item runs it and closes the menu", () => {
    const onClick: MockFunction = getJestMockFunction();

    renderMenu([
      action({
        key: "regenerate",
        text: "Regenerate link",
        onClick: onClick as unknown as () => void,
      }),
    ]);

    fireEvent.click(
      within(openMenu()).getByRole("menuitem", { name: "Regenerate link" }),
    );

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("an item the reader may not take is locked, says why, and stays reachable", () => {
    const onClick: MockFunction = getJestMockFunction();

    renderMenu([
      action({
        key: "regenerate",
        text: "Regenerate link",
        disabledReason:
          "You need the Edit On-Call Schedule permission to change this schedule calendar link.",
        onClick: onClick as unknown as () => void,
      }),
    ]);

    const item: HTMLElement = within(openMenu())
      .getByText("Regenerate link")
      .closest("button") as HTMLElement;

    expect(item).toHaveAttribute("aria-disabled", "true");
    // Locked with a reason: focusable, so the keyboard can reach the reason.
    expect(item).not.toBeDisabled();
    expect(item).toHaveAttribute("data-focusable-when-disabled", "true");
    expect(
      document.getElementById(item.getAttribute("aria-describedby") || ""),
    ).toHaveTextContent("You need the Edit On-Call Schedule permission");

    fireEvent.click(item);

    expect(onClick).not.toHaveBeenCalled();
  });

  test("an item that only waits for the card is plainly disabled, with nothing to explain", () => {
    renderMenu([
      action({ key: "regenerate", text: "Regenerate link", isDisabled: true }),
    ]);

    const item: HTMLElement = within(openMenu())
      .getByText("Regenerate link")
      .closest("button") as HTMLElement;

    expect(item).toBeDisabled();
    expect(item).not.toHaveAttribute("aria-describedby");
  });
});
