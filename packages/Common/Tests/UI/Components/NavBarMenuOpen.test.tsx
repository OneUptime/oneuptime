/*
 * THE BAR SAYS WHEN ITS MENU OPENS (onMenuOpen, #7465).
 *
 * The Dashboard's products menu kept "Not set up" on a product set up
 * since the page loaded. It now asks for its marks again as the menu is
 * read, so the bar tells whoever draws it each time the products menu
 * opens - by its button or by Cmd/Ctrl+K - or the phone's menu does: once
 * per opening, never as it closes, and with the latest callback it was
 * given.
 */

// Identity translations keep the test on the wiring (see NavBarCommandKGating).
jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined) => {
          return value;
        },
        translateValue: (value: unknown) => {
          return value;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      isStartWith: () => {
        return false;
      },
      isOnThisPage: () => {
        return false;
      },
      navigate: () => {},
    },
  };
});

import Navbar, {
  MoreMenuItem,
  NavItem,
  PHONE_MENU_BELOW_WIDTH_IN_PX,
} from "../../../UI/Components/Navbar/NavBar";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

beforeAll(() => {
  Element.prototype.scrollIntoView = (): void => {};
});

const ORIGINAL_WIDTH: number = window.innerWidth;

function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

const homeItem: NavItem = {
  id: "home-nav-bar-item",
  title: "Home",
  icon: IconProp.Home,
  route: new Route("/dashboard/home"),
  activeRoute: new Route("/dashboard/home"),
};

const moreMenuItems: Array<MoreMenuItem> = [
  {
    title: "Monitors",
    description: "Monitor anything that can go down.",
    route: new Route("/dashboard/project-id/monitors"),
    icon: IconProp.AltGlobe,
    iconColor: "blue",
    category: "Essentials",
  },
];

function openProducts(): void {
  fireEvent.click(screen.getByText("Products"));
}

function productsMenu(): HTMLElement | null {
  return screen.queryByRole("dialog", { name: "Products menu" });
}

describe("onMenuOpen", () => {
  afterEach(() => {
    cleanup();
    setViewportWidth(ORIGINAL_WIDTH);
  });

  test("is not called while no menu is open", () => {
    const onMenuOpen: Mock = jest.fn();

    render(
      <Navbar
        items={[homeItem]}
        moreMenuItems={moreMenuItems}
        onMenuOpen={onMenuOpen as () => void}
      />,
    );

    expect(onMenuOpen).not.toHaveBeenCalled();
  });

  test("is called once each time the products menu opens from its button, never as it closes", () => {
    const onMenuOpen: Mock = jest.fn();

    render(
      <Navbar
        items={[homeItem]}
        moreMenuItems={moreMenuItems}
        onMenuOpen={onMenuOpen as () => void}
      />,
    );

    openProducts();
    expect(productsMenu()).toBeInTheDocument();
    expect(onMenuOpen).toHaveBeenCalledTimes(1);

    // Escape in its search box closes it.
    const search: HTMLInputElement | null =
      productsMenu()!.querySelector("input");
    expect(search).not.toBeNull();
    fireEvent.keyDown(search!, { key: "Escape" });
    expect(productsMenu()).not.toBeInTheDocument();
    expect(onMenuOpen).toHaveBeenCalledTimes(1);

    openProducts();
    expect(productsMenu()).toBeInTheDocument();
    expect(onMenuOpen).toHaveBeenCalledTimes(2);
  });

  test("Cmd/Ctrl+K opening the menu calls it, and closing it does not", () => {
    const onMenuOpen: Mock = jest.fn();

    render(
      <Navbar
        items={[homeItem]}
        moreMenuItems={moreMenuItems}
        onMenuOpen={onMenuOpen as () => void}
      />,
    );

    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(productsMenu()).toBeInTheDocument();
    expect(onMenuOpen).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(productsMenu()).not.toBeInTheDocument();
    expect(onMenuOpen).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(productsMenu()).toBeInTheDocument();
    expect(onMenuOpen).toHaveBeenCalledTimes(2);
  });

  test("the phone's menu opening calls it too", () => {
    setViewportWidth(PHONE_MENU_BELOW_WIDTH_IN_PX - 1);
    const onMenuOpen: Mock = jest.fn();

    render(
      <Navbar
        items={[homeItem]}
        moreMenuItems={moreMenuItems}
        onMenuOpen={onMenuOpen as () => void}
      />,
    );

    fireEvent.click(screen.getByTestId("mobile-nav-toggle"));
    expect(onMenuOpen).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("mobile-nav-toggle"));
    expect(onMenuOpen).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("mobile-nav-toggle"));
    expect(onMenuOpen).toHaveBeenCalledTimes(2);
  });

  test("the latest callback is the one called, and a new one each render calls nothing more", () => {
    const first: Mock = jest.fn();
    const second: Mock = jest.fn();

    const { rerender } = render(
      <Navbar
        items={[homeItem]}
        moreMenuItems={moreMenuItems}
        onMenuOpen={first as () => void}
      />,
    );

    rerender(
      <Navbar
        items={[homeItem]}
        moreMenuItems={moreMenuItems}
        onMenuOpen={() => {
          (second as () => void)();
        }}
      />,
    );
    rerender(
      <Navbar
        items={[homeItem]}
        moreMenuItems={moreMenuItems}
        onMenuOpen={() => {
          (second as () => void)();
        }}
      />,
    );

    expect(second).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "k", metaKey: true });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  test("a bar given none opens its menus as before", () => {
    render(<Navbar items={[homeItem]} moreMenuItems={moreMenuItems} />);

    openProducts();

    expect(productsMenu()).toBeInTheDocument();
  });
});
