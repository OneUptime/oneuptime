import MoreMenu, {
  PORTALED_MENU_WIDTH,
  WIDE_MENU_MAX_WIDTH,
  WIDE_MENU_WIDTH,
} from "../../../UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "../../../UI/Components/MoreMenu/MoreMenuItem";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

/*
 * A wide MoreMenu (isMenuWide) for items whose names are long - a kind of
 * log ("Azure activity and Entra ID logs"), a product - so each keeps one
 * line instead of wrapping in the 14rem every other menu has: 20rem, set on
 * the element itself in place or portalled, and never past a phone's edges.
 * A menu that does not ask for it keeps its width.
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

afterEach(() => {
  cleanup();
});

async function openMenu(props: {
  isMenuWide?: boolean;
  isMenuPortaled?: boolean;
}): Promise<HTMLElement> {
  render(
    <MoreMenu text="Examples" {...props}>
      <MoreMenuItem
        text="Azure activity and Entra ID logs"
        onClick={() => {}}
      />
      <MoreMenuItem text="Google Cloud audit logs" onClick={() => {}} />
    </MoreMenu>,
  );

  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "Examples" }));
  });

  return screen.getByRole("menu");
}

describe("MoreMenu - a wide menu", () => {
  test("in place: 20rem on the element itself, over w-56, and never past the viewport", async () => {
    const menu: HTMLElement = await openMenu({ isMenuWide: true });

    expect(WIDE_MENU_WIDTH).toBe("20rem");
    expect(menu.style.width).toBe(WIDE_MENU_WIDTH);
    expect(menu.style.maxWidth).toBe(WIDE_MENU_MAX_WIDTH);
    expect(WIDE_MENU_MAX_WIDTH).toBe("calc(100vw - 1rem)");
  });

  test("portalled: 20rem in place of the 14rem, and never past the viewport", async () => {
    const menu: HTMLElement = await openMenu({
      isMenuWide: true,
      isMenuPortaled: true,
    });

    expect(menu.style.position).toBe("fixed");
    expect(menu.style.width).toBe(WIDE_MENU_WIDTH);
    expect(menu.style.maxWidth).toBe(WIDE_MENU_MAX_WIDTH);
  });

  test("a menu that does not ask keeps the width every other menu has", async () => {
    const inPlace: HTMLElement = await openMenu({});

    expect(inPlace.style.width).toBe("");
    expect(inPlace.style.maxWidth).toBe("");
    expect(inPlace).toHaveClass("w-56");

    cleanup();

    const portalled: HTMLElement = await openMenu({ isMenuPortaled: true });

    expect(portalled.style.width).toBe(PORTALED_MENU_WIDTH);
    expect(portalled.style.maxWidth).toBe("");
  });
});
