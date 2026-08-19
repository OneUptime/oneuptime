/*
 * The dashboard's command palette owns Cmd/Ctrl+K, so the NavBar grew a
 * `disableCommandKShortcut` prop that stops it registering its own document
 * keydown for the products menu. These tests pin the contract in BOTH
 * directions: with the prop the menu must NOT open on Cmd+K (or the palette
 * and the menu would double-fire on one keystroke), and without the prop the
 * legacy shortcut must keep working for every other NavBar consumer.
 */

/*
 * NavBar and its children translate labels through useTranslateValue, which
 * needs a live i18next instance. Identity translations keep the test focused
 * on the shortcut wiring. The factory must sit above the component import.
 */
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

/*
 * Navigation's current-route reads come from a location hook that only the
 * real router wires up (Navigation.getCurrentRoute throws without it). Active
 * state and navigation are irrelevant here, so stub the statics NavBar and its
 * items touch.
 */
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

/*
 * jsdom does not implement scrollIntoView; the menu modal calls it to keep the
 * keyboard selection visible. A no-op is all the tests need.
 */
beforeAll(() => {
  Element.prototype.scrollIntoView = (): void => {};
});

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

function pressCommandK(): void {
  fireEvent.keyDown(document, { key: "k", metaKey: true });
}

describe("NavBar Cmd/Ctrl+K gating", () => {
  afterEach(() => {
    cleanup();
  });

  test("without the prop, Cmd+K still toggles the products menu (legacy consumers keep their shortcut)", () => {
    render(<Navbar items={[homeItem]} moreMenuItems={moreMenuItems} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    pressCommandK();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // And the same chord closes it again — it is a toggle, not just an opener.
    pressCommandK();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("Ctrl+K works the same as Cmd+K when the shortcut is enabled", () => {
    render(<Navbar items={[homeItem]} moreMenuItems={moreMenuItems} />);

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("with disableCommandKShortcut, Cmd+K does NOT open the products menu", () => {
    render(
      <Navbar
        items={[homeItem]}
        moreMenuItems={moreMenuItems}
        disableCommandKShortcut={true}
      />,
    );

    pressCommandK();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("with disableCommandKShortcut, the menu still opens from its trigger button", () => {
    /*
     * Disabling the shortcut must not disable the menu: the button path is the
     * remaining way in, so it has to keep working.
     */
    render(
      <Navbar
        items={[homeItem]}
        moreMenuItems={moreMenuItems}
        disableCommandKShortcut={true}
      />,
    );

    fireEvent.click(screen.getByText("Products"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("with disableCommandKShortcut, Cmd+K's default is not prevented (the palette may claim it)", () => {
    render(
      <Navbar
        items={[homeItem]}
        moreMenuItems={moreMenuItems}
        disableCommandKShortcut={true}
      />,
    );

    /*
     * fireEvent returns false when some handler called preventDefault. With
     * the NavBar listener unregistered, nothing here may swallow the chord —
     * the whole point is leaving it free for the command palette's handler.
     */
    const defaultAllowed: boolean = fireEvent.keyDown(document, {
      key: "k",
      metaKey: true,
    });
    expect(defaultAllowed).toBe(true);
  });
});
