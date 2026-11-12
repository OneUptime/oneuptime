import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import URL from "../../../Types/API/URL";
import IconProp from "../../../Types/Icon/IconProp";
import HeaderIconDropdownButton from "../../../UI/Components/Header/HeaderIconDropdownButton";
import IconDropdownItem from "../../../UI/Components/Header/IconDropdown/IconDropdownItem";
import IconDropdownMenu from "../../../UI/Components/Header/IconDropdown/IconDropdownMenu";
import IconDropdownRow from "../../../UI/Components/Header/IconDropdown/IconDropdownRow";
import KeyboardKey from "../../../UI/Components/KeyboardShortcut/KeyboardKey";

/*
 * The header's icon menus - Help and the profile menu, in the Dashboard and
 * the Admin Dashboard - each named by its own button, and put away with
 * Escape (#7037's review).
 *
 * Every header button with a menu took the id "user-menu-button", and every
 * menu was aria-labelledby that id. With Help in the header beside the
 * profile button (from 768px since #7037, and always in the Admin
 * Dashboard), the page had the id twice, and a screen reader named the
 * profile menu after the first button with it: Help. Each button now has an
 * id of its own (React's useId), handed to its menu (HeaderMenuContext).
 *
 * And Escape did nothing to an open menu: a keyboard could open Help but had
 * to click elsewhere to put it away. Escape now closes it, and gives the
 * focus back to the button when the focus was in the menu or on the button.
 */

afterEach(() => {
  cleanup();
});

/*
 * A header menu as the Dashboard's Help and UserProfile draw one: the
 * caller's own open state, set on click.
 */
function HeaderMenu(props: {
  name: string;
  rows: Array<string>;
  openAtFirst?: boolean | undefined;
}): ReactElement {
  const [isOpen, setIsOpen] = useState<boolean>(Boolean(props.openAtFirst));

  return (
    <HeaderIconDropdownButton
      icon={IconProp.Help}
      name={props.name}
      showDropdown={isOpen}
      onClick={() => {
        setIsOpen(true);
      }}
    >
      <IconDropdownMenu>
        <IconDropdownRow>
          {props.rows.map((row: string): ReactElement => {
            return (
              <IconDropdownItem
                key={row}
                title={row}
                icon={IconProp.Book}
                // A page to open, as Help's rows do.
                url={URL.fromString(
                  `https://oneuptime.com/docs/${row.split(" ").join("-")}`,
                )}
                openInNewTab={true}
                onClick={() => {
                  setIsOpen(false);
                }}
              />
            );
          })}
        </IconDropdownRow>
      </IconDropdownMenu>
    </HeaderIconDropdownButton>
  );
}

function renderRail(options: { openAtFirst?: boolean } = {}): void {
  render(
    <div>
      <HeaderIconDropdownButton
        icon={IconProp.Search}
        name="Search"
        title="Search"
        shortcut={[KeyboardKey.Mod, "K"]}
        showDropdown={false}
      />
      <HeaderMenu
        name="Help"
        rows={["Quickstart", "Glossary"]}
        openAtFirst={options.openAtFirst}
      />
      <HeaderMenu
        name="User Profile"
        rows={["Profile", "Log out"]}
        openAtFirst={options.openAtFirst}
      />
      <button type="button">Elsewhere on the page</button>
    </div>,
  );
}

function menuButton(name: string): HTMLElement {
  return screen.getByRole("button", { name: name });
}

describe("each header menu is named by its own button", () => {
  test("no two buttons share an id, and the old shared id is gone", () => {
    renderRail();

    const help: HTMLElement = menuButton("Help");
    const profile: HTMLElement = menuButton("User Profile");

    expect(help.id).not.toBe("");
    expect(profile.id).not.toBe("");
    expect(help.id).not.toBe(profile.id);
    expect(document.getElementById("user-menu-button")).toBeNull();

    const ids: Array<string> = Array.from(
      document.querySelectorAll("[id]"),
    ).map((element: Element): string => {
      return element.id;
    });
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("with both open, Help's menu is named Help and the profile menu User Profile", () => {
    renderRail({ openAtFirst: true });

    const helpMenu: HTMLElement = screen.getByRole("menu", { name: "Help" });
    const profileMenu: HTMLElement = screen.getByRole("menu", {
      name: "User Profile",
    });

    expect(helpMenu).toHaveAttribute("aria-labelledby", menuButton("Help").id);
    expect(profileMenu).toHaveAttribute(
      "aria-labelledby",
      menuButton("User Profile").id,
    );
    expect(helpMenu).toHaveTextContent("Quickstart");
    expect(profileMenu).toHaveTextContent("Log out");
  });

  test("the profile menu opened alone is named by the profile button, not by Help before it", () => {
    renderRail();

    fireEvent.click(menuButton("User Profile"));

    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(screen.getByRole("menu")).toHaveAccessibleName("User Profile");
  });

  test("a button with no menu (Search) takes no id", () => {
    renderRail();

    expect(
      screen.getByRole("button", { name: /^Search\b/ }).hasAttribute("id"),
    ).toBe(false);
  });

  test("a menu drawn outside a header button names nothing", () => {
    render(
      <IconDropdownMenu>
        <IconDropdownItem title="Profile" onClick={() => {}} />
      </IconDropdownMenu>,
    );

    expect(screen.getByRole("menu").hasAttribute("aria-labelledby")).toBe(
      false,
    );
  });
});

describe("Escape puts an open header menu away", () => {
  test("from a row of the menu: the menu closes and the focus goes back to its button", () => {
    renderRail();

    fireEvent.click(menuButton("Help"));
    const row: HTMLElement = screen.getByRole("link", { name: "Glossary" });
    row.focus();
    expect(document.activeElement).toBe(row);
    expect(menuButton("Help")).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(row, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(menuButton("Help"));
    expect(menuButton("Help")).toHaveAttribute("aria-expanded", "false");
  });

  test("from the button itself: the menu closes and the focus stays on the button", () => {
    renderRail();

    const help: HTMLElement = menuButton("Help");
    fireEvent.click(help);
    help.focus();

    fireEvent.keyDown(help, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(help);
  });

  test("with the focus elsewhere on the page, the menu closes and the focus is left where it is", () => {
    renderRail();

    fireEvent.click(menuButton("User Profile"));
    const elsewhere: HTMLElement = screen.getByRole("button", {
      name: "Elsewhere on the page",
    });
    elsewhere.focus();

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
  });

  test("only the open menu closes; the button opens it again after", () => {
    renderRail();

    fireEvent.click(menuButton("Help"));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(menuButton("Help"));
    expect(screen.getByRole("menu")).toHaveAccessibleName("Help");

    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.click(menuButton("User Profile"));
    expect(screen.getByRole("menu")).toHaveAccessibleName("User Profile");
  });

  test("another key leaves the menu open", () => {
    renderRail();

    fireEvent.click(menuButton("Help"));
    fireEvent.keyDown(document.body, { key: "Enter" });
    fireEvent.keyDown(document.body, { key: "Tab" });

    expect(screen.getByRole("menu")).toHaveAccessibleName("Help");
  });

  test("an Escape something else already handled (a dialog over the page) leaves the menu open", () => {
    renderRail();

    fireEvent.click(menuButton("Help"));
    const handled: KeyboardEvent = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    handled.preventDefault();
    document.body.dispatchEvent(handled);

    expect(screen.getByRole("menu")).toHaveAccessibleName("Help");
  });

  test("with no menu open, Escape changes nothing and moves no focus", () => {
    renderRail();

    const elsewhere: HTMLElement = screen.getByRole("button", {
      name: "Elsewhere on the page",
    });
    elsewhere.focus();

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
  });
});
