import MoreMenu, {
  MENU_ITEM_SELECTOR,
} from "../../../UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "../../../UI/Components/MoreMenu/MoreMenuItem";
import MoreMenuSection from "../../../UI/Components/MoreMenu/MoreMenuSection";
import IconProp from "../../../Types/Icon/IconProp";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import React, { act } from "react";

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

/*
 * A menu can hold a choice of several - a feed's sort order - beside its
 * actions. A choice is a menuitemradio with aria-checked, so a screen reader
 * hears which one is in use, and MoreMenu treats it like any other item: in
 * the arrow-key order, picked with Enter or a click, closing the menu. Before
 * this, MoreMenu's promotion of plain buttons rewrote such a role to
 * "menuitem", and its roving focus skipped anything else.
 */

type ClickMock = ReturnType<typeof jest.fn<() => void>>;
type UserEventController = ReturnType<typeof userEvent.setup>;

async function userKeyboard(
  user: UserEventController,
  keys: string,
): Promise<void> {
  await act(async () => {
    await user.keyboard(keys);
  });
}

interface Rendered {
  newest: ClickMock;
  oldest: ClickMock;
  refresh: ClickMock;
  toggle: ClickMock;
}

const renderMenu: () => Rendered = (): Rendered => {
  const newest: ClickMock = jest.fn<() => void>();
  const oldest: ClickMock = jest.fn<() => void>();
  const refresh: ClickMock = jest.fn<() => void>();
  const toggle: ClickMock = jest.fn<() => void>();

  render(
    <MoreMenu menuIcon={IconProp.EllipsisHorizontal} text="">
      {[
        <MoreMenuSection key="sort" title="Sort by time">
          {[
            <MoreMenuItem
              key="newest"
              text="Newest first"
              icon={IconProp.Check}
              isIconSpaceReserved={true}
              isChecked={true}
              onClick={newest}
            />,
            <MoreMenuItem
              key="oldest"
              text="Oldest first"
              isIconSpaceReserved={true}
              isChecked={false}
              onClick={oldest}
            />,
          ]}
        </MoreMenuSection>,
        <MoreMenuItem
          key="refresh"
          text="Refresh"
          icon={IconProp.Refresh}
          onClick={refresh}
        />,
        // A caller's own on/off item.
        <button
          key="toggle"
          type="button"
          role="menuitemcheckbox"
          aria-checked="false"
          onClick={toggle}
        >
          Show archived
        </button>,
      ]}
    </MoreMenu>,
  );

  return { newest, oldest, refresh, toggle };
};

const openMenu: () => HTMLElement = (): HTMLElement => {
  fireEvent.click(screen.getByRole("button", { name: "More options" }));

  return screen.getByRole("menu");
};

afterEach(() => {
  cleanup();
});

describe("MoreMenuItem isChecked", () => {
  test("makes a choice a menuitemradio that says whether it is the one in use", () => {
    renderMenu();

    const menu: HTMLElement = openMenu();

    expect(
      within(menu).getByRole("menuitemradio", { name: "Newest first" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      within(menu).getByRole("menuitemradio", { name: "Oldest first" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  test("leaves an item without it an ordinary menuitem, with no aria-checked", () => {
    renderMenu();

    const refresh: HTMLElement = within(openMenu()).getByRole("menuitem", {
      name: "Refresh",
    });

    expect(refresh).not.toHaveAttribute("aria-checked");
  });
});

describe("MoreMenu with choices among its items", () => {
  test("keeps each item's own role when it opens", () => {
    renderMenu();

    const menu: HTMLElement = openMenu();

    // The promotion of plain buttons to menuitem leaves choices alone.
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(2);
    expect(
      within(menu).getByRole("menuitemcheckbox", { name: "Show archived" }),
    ).toBeInTheDocument();
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item: HTMLElement): string => {
          return (item.textContent || "").trim();
        }),
    ).toEqual(["Refresh"]);
  });

  test("names every item role in its selector", () => {
    expect(MENU_ITEM_SELECTOR).toContain('[role="menuitem"]');
    expect(MENU_ITEM_SELECTOR).toContain('[role="menuitemradio"]');
    expect(MENU_ITEM_SELECTOR).toContain('[role="menuitemcheckbox"]');
  });

  test("walks choices and actions alike with the arrow keys, Home and End", async () => {
    const user: UserEventController = userEvent.setup();

    renderMenu();
    const menu: HTMLElement = openMenu();

    const newest: HTMLElement = within(menu).getByRole("menuitemradio", {
      name: "Newest first",
    });
    const oldest: HTMLElement = within(menu).getByRole("menuitemradio", {
      name: "Oldest first",
    });
    const refresh: HTMLElement = within(menu).getByRole("menuitem", {
      name: "Refresh",
    });
    const toggle: HTMLElement = within(menu).getByRole("menuitemcheckbox", {
      name: "Show archived",
    });

    // The section heading is not an item; focus starts on the first choice.
    expect(newest).toHaveFocus();

    await userKeyboard(user, "{ArrowDown}");
    expect(oldest).toHaveFocus();
    await userKeyboard(user, "{ArrowDown}");
    expect(refresh).toHaveFocus();
    await userKeyboard(user, "{ArrowDown}");
    expect(toggle).toHaveFocus();
    await userKeyboard(user, "{ArrowDown}");
    expect(newest).toHaveFocus();
    await userKeyboard(user, "{ArrowUp}");
    expect(toggle).toHaveFocus();
    await userKeyboard(user, "{Home}");
    expect(newest).toHaveFocus();
    await userKeyboard(user, "{End}");
    expect(toggle).toHaveFocus();

    // One tab stop at a time: the focused item, whatever its role.
    expect(toggle).toHaveAttribute("tabindex", "0");
    expect(newest).toHaveAttribute("tabindex", "-1");
    expect(oldest).toHaveAttribute("tabindex", "-1");
    expect(refresh).toHaveAttribute("tabindex", "-1");
  });

  test("picks a choice with Enter once, and closes", async () => {
    const user: UserEventController = userEvent.setup();
    const { oldest, newest } = renderMenu();

    openMenu();
    await userKeyboard(user, "{ArrowDown}");
    await userKeyboard(user, "{Enter}");

    expect(oldest).toHaveBeenCalledTimes(1);
    expect(newest).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("picks a choice with a click once, closes, and hands focus back to the trigger", async () => {
    const { oldest } = renderMenu();

    fireEvent.click(
      within(openMenu()).getByRole("menuitemradio", { name: "Oldest first" }),
    );

    expect(oldest).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });

    expect(screen.getByRole("button", { name: "More options" })).toHaveFocus();
  });

  test("closes after a caller's own menuitemcheckbox is clicked", () => {
    const { toggle } = renderMenu();

    fireEvent.click(
      within(openMenu()).getByRole("menuitemcheckbox", {
        name: "Show archived",
      }),
    );

    expect(toggle).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("skips a disabled choice, as it skips a disabled action", async () => {
    const user: UserEventController = userEvent.setup();
    const picked: ClickMock = jest.fn<() => void>();

    render(
      <MoreMenu menuIcon={IconProp.EllipsisHorizontal} text="">
        {[
          <MoreMenuItem
            key="a"
            text="Newest first"
            icon={IconProp.Check}
            isIconSpaceReserved={true}
            isChecked={true}
            onClick={picked}
          />,
          <MoreMenuItem
            key="b"
            text="Oldest first"
            isIconSpaceReserved={true}
            isChecked={false}
            isDisabled={true}
            onClick={picked}
          />,
          <MoreMenuItem
            key="c"
            text="Refresh"
            icon={IconProp.Refresh}
            onClick={picked}
          />,
        ]}
      </MoreMenu>,
    );

    const menu: HTMLElement = openMenu();

    expect(
      within(menu).getByRole("menuitemradio", { name: "Newest first" }),
    ).toHaveFocus();

    await userKeyboard(user, "{ArrowDown}");

    expect(
      within(menu).getByRole("menuitem", { name: "Refresh" }),
    ).toHaveFocus();
  });
});
