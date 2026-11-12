import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import IconProp from "../../../Types/Icon/IconProp";
import IconDropdownItem from "../../../UI/Components/Header/IconDropdown/IconDropdownItem";
import IconDropdownMenu, {
  ICON_DROPDOWN_MENU_WIDTH_CLASS_NAME,
} from "../../../UI/Components/Header/IconDropdown/IconDropdownMenu";
import IconDropdownRow from "../../../UI/Components/Header/IconDropdown/IconDropdownRow";

/*
 * The header's icon menus - Help and the profile menu, in the Dashboard and
 * the Admin Dashboard - are as wide as their longest entry (#7037).
 *
 * The menu was w-64 (16rem) whatever it held. In the Help menu, the entry
 * that opens How OneUptime works is longer than that in French ("Comment
 * fonctionne OneUptime"), Portuguese, Spanish, Italian, German ("So
 * funktioniert OneUpt…") and Russian, and so is Japanese's keyboard
 * shortcuts row with its keycap: each was cut short in the menu someone
 * opens to learn the product, now reachable on a tablet too. It is at least
 * 16rem still (a short menu keeps its width) and never wider than the
 * screen less 1rem a side, where a long entry is cut as before.
 *
 * jsdom lays nothing out, so this holds the classes that say so; the
 * NavigationSearch browser suite (HeaderAtTabletWidths.spec.ts) measures
 * the German Help menu in a real browser.
 */

afterEach(() => {
  cleanup();
});

function renderMenu(): HTMLElement {
  render(
    <IconDropdownMenu>
      <IconDropdownRow dataTestId="learn">
        <IconDropdownItem
          title="Comment fonctionne OneUptime"
          icon={IconProp.Map}
          onClick={() => {}}
        />
      </IconDropdownRow>
    </IconDropdownMenu>,
  );

  return screen.getByRole("menu");
}

describe("the header's icon menu width", () => {
  test("sizes itself to its longest entry: w-max, at least 16rem, at most the screen less 2rem", () => {
    const menu: HTMLElement = renderMenu();
    const classes: Array<string> = menu.className.split(" ");

    expect(ICON_DROPDOWN_MENU_WIDTH_CLASS_NAME.split(" ")).toEqual([
      "w-max",
      "min-w-[16rem]",
      "max-w-[calc(100vw-2rem)]",
    ]);
    for (const token of ICON_DROPDOWN_MENU_WIDTH_CLASS_NAME.split(" ")) {
      expect(classes).toContain(token);
    }
  });

  test("no longer carries a fixed width that would cut a long entry on a wide screen", () => {
    const classes: Array<string> = renderMenu().className.split(" ");
    const FIXED_WIDTH: RegExp = /^w-(\d+|\[[^\]]+\])$/;

    expect(
      classes.filter((token: string): boolean => {
        return FIXED_WIDTH.test(token);
      }),
    ).toEqual([]);
  });

  test("still hangs from the button's end, over the page", () => {
    const classes: Array<string> = renderMenu().className.split(" ");

    for (const token of ["absolute", "right-0", "z-10", "mt-2"]) {
      expect(classes).toContain(token);
    }
  });

  test("an entry is cut, not pushed out of the menu, only where the screen is narrower than it", () => {
    renderMenu();

    const title: HTMLElement = screen.getByText("Comment fonctionne OneUptime");

    // Cut with an ellipsis once the menu is at its widest (the max-w).
    expect(title.className.split(" ")).toEqual(
      expect.arrayContaining(["min-w-0", "flex-1", "truncate"]),
    );
  });
});
