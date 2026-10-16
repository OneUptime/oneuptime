import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { Mock } from "jest-mock";
import React from "react";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import IconProp from "../../../Types/Icon/IconProp";
import { MoreMenuItem } from "../../../UI/Components/Navbar/NavBar";
import NavBarMenuModal from "../../../UI/Components/Navbar/NavBarMenuModal";

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
      };
    },
  };
});

/*
 * The products menu's footer: the link to report a bug or ask for a
 * feature, with an arrow that shows on hover. Icon draws a div, and the
 * footer's title row was a p: a div cannot sit in a p, so React logged
 * "validateDOMNesting: <div> cannot appear as a descendant of <p>" every
 * time someone opened the menu, on the Dashboard and the Admin Dashboard.
 */

const FOOTER_LINK: string =
  "https://github.com/OneUptime/oneuptime/issues/new/choose";

const ITEMS: Array<MoreMenuItem> = [
  {
    title: "Monitors",
    description: "Check websites, APIs and servers.",
    route: new Route("/p/monitors"),
    icon: IconProp.Globe,
    category: "Essentials",
  },
  {
    title: "Logs",
    description: "Search and analyze logs.",
    route: new Route("/p/logs"),
    icon: IconProp.Logs,
    category: "Observability",
  },
];

function renderMenu(
  categoriesOpenByDefault: Array<string> | undefined,
): ReturnType<typeof render> {
  return render(
    <NavBarMenuModal
      items={ITEMS}
      categoriesOpenByDefault={categoriesOpenByDefault}
      footer={{
        title: "Report a bug or request a feature.",
        description: "Report any issue you find on GitHub.",
        link: URL.fromString(FOOTER_LINK),
      }}
      keyboardHint="Arrows to move, Enter to open, Esc to close"
      recentLabel="Recently visited"
      onClose={() => {}}
    />,
  );
}

beforeAll(() => {
  // jsdom lays nothing out; the menu scrolls its cursor into view.
  Element.prototype.scrollIntoView = (): void => {};
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
});

describe.each([
  ["the Dashboard's menu, which folds", ["Essentials"]],
  ["a menu that shows every category", undefined],
])(
  "the products menu's footer, in %s",
  (_kind: string, categoriesOpenByDefault: Array<string> | undefined) => {
    test("opening the menu logs no nesting warning", () => {
      const consoleError: Mock<(...args: Array<unknown>) => void> =
        jest.fn<(...args: Array<unknown>) => void>();
      jest.spyOn(console, "error").mockImplementation(consoleError);
      window.localStorage.setItem(
        "oneuptime-navbar-recent-products",
        JSON.stringify(["/p/logs"]),
      );

      renderMenu(categoriesOpenByDefault);

      expect(
        consoleError.mock.calls.filter((args: Array<unknown>): boolean => {
          return args.some((arg: unknown): boolean => {
            return String(arg).includes("validateDOMNesting");
          });
        }),
      ).toEqual([]);
    });

    test("no paragraph in the menu holds a div", () => {
      renderMenu(categoriesOpenByDefault);

      const dialog: HTMLElement = screen.getByRole("dialog", {
        name: "Products menu",
      });
      expect(dialog.querySelectorAll("p div")).toHaveLength(0);
    });

    test("its title and description are one link to GitHub, in a new tab", () => {
      renderMenu(categoriesOpenByDefault);

      const title: HTMLElement = screen.getByText(
        "Report a bug or request a feature.",
      );
      const link: HTMLElement | null = title.closest("a");
      expect(link).not.toBeNull();
      expect(link).toHaveAttribute("href", FOOTER_LINK);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toContainElement(
        screen.getByText("Report any issue you find on GitHub."),
      );
      // The arrow beside the title, shown on hover, is part of the link.
      expect(title.parentElement!.tagName).toBe("DIV");
      expect(title.parentElement!.querySelector("svg")).not.toBeNull();
    });
  },
);
