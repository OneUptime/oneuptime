import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { Location } from "react-router-dom";
import getJestMockFunction from "../../MockType";
import {
  LAPTOP_WIDTH_IN_PX,
  PHONE_WIDTH_IN_PX,
  TABLET_WIDTH_IN_PX,
  TAILWIND_BREAKPOINTS_IN_PX,
  VisibilityOptions,
  WIDE_DESKTOP_WIDTH_IN_PX,
  describeVisibility,
  resolveDisplay,
} from "../../ResponsiveVisibility";

/*
 * The shared components under a foreign `.hidden` rule.
 *
 * A customer's dashboard showed no navigation bar at all — no Home, no
 * Products — so an invited user could not reach a single product. Their
 * browser carried `.hidden { display: none !important }`, a rule Bootstrap 3
 * and HTML5 Boilerplate ship verbatim and that extensions and user stylesheets
 * inject into every page they touch. Our markup hid desktop-only chrome with
 * `hidden md:flex`: the bare `hidden` class is exactly what that rule matches,
 * and `!important` (or merely being appended after Tailwind's <style>) beats
 * `md:flex`, so the element vanished at every width, not just below md.
 *
 * The fix spells the phone half as `max-md:hidden md:flex`: identical on a
 * clean page, and the element no longer carries the class the foreign rule
 * targets. This file renders the real shared components the fix touched and
 * checks, per component:
 *
 *  - the desktop-only part is on screen at and above its breakpoint, on a
 *    clean page and with the foreign rule;
 *  - it is still off screen below the breakpoint, either way — the fix must
 *    not turn a phone layout into a desktop one;
 *  - a control: the component's pre-fix class string, rebuilt from the
 *    rendered markup and compared with the literal from the diff, is visible on
 *    a clean page and gone under the rule. That is the bug, written down, and
 *    it is what these assertions would have caught.
 *
 * jsdom has no stylesheet, so ResponsiveVisibility reads the class attributes
 * and resolves `display` per width the way the Tailwind cascade does, and its
 * `withForeignHiddenRule` option models the rule on the page.
 */

/*
 * CardModelDetail and BaseModelTable check permissions, read the current user
 * and load their rows. None of that is what this file is about: the stubs
 * below let both render their header buttons and nothing more.
 */
jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return ["ProjectAdmin"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

// Assertions read as the English words on screen.
jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<null> => {
        return null;
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
    },
  };
});

import Banner from "../../../UI/Components/Banner/Banner";
import Card from "../../../UI/Components/Card/Card";
import HeaderIconDropdownButton from "../../../UI/Components/Header/HeaderIconDropdownButton";
import KeyboardKey from "../../../UI/Components/KeyboardShortcut/KeyboardKey";
import ModalFooter from "../../../UI/Components/Modal/ModalFooter";
import CardModelDetail from "../../../UI/Components/ModelDetail/CardModelDetail";
import BaseModelTable, {
  BaseTableCallbacks,
  ComponentProps as BaseModelTableProps,
} from "../../../UI/Components/ModelTable/BaseModelTable";
import Navbar, {
  MoreMenuItem,
  NavItem,
} from "../../../UI/Components/Navbar/NavBar";
import NavBarMenuModal from "../../../UI/Components/Navbar/NavBarMenuModal";
import Page from "../../../UI/Components/Page/Page";
import Pagination from "../../../UI/Components/Pagination/Pagination";
import SideMenu from "../../../UI/Components/SideMenu/SideMenu";
import FieldType from "../../../UI/Components/Types/FieldType";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

const FOREIGN_RULE: VisibilityOptions = { withForeignHiddenRule: true };

const SM_IN_PX: number = TAILWIND_BREAKPOINTS_IN_PX["sm"]!;
const MD_IN_PX: number = TAILWIND_BREAKPOINTS_IN_PX["md"]!;
const LG_IN_PX: number = TAILWIND_BREAKPOINTS_IN_PX["lg"]!;

/*
 * Widths either side of the two breakpoints the fixed markup uses, including
 * the last pixel before each one and the customer's own 1917px window.
 */
const WIDTHS_BELOW_SM: Array<number> = [320, PHONE_WIDTH_IN_PX, SM_IN_PX - 1];
const WIDTHS_FROM_SM: Array<number> = [
  SM_IN_PX,
  TABLET_WIDTH_IN_PX,
  LG_IN_PX,
  LAPTOP_WIDTH_IN_PX,
  WIDE_DESKTOP_WIDTH_IN_PX,
];
const WIDTHS_BELOW_MD: Array<number> = [
  PHONE_WIDTH_IN_PX,
  SM_IN_PX,
  MD_IN_PX - 1,
];
const WIDTHS_FROM_MD: Array<number> = [
  TABLET_WIDTH_IN_PX,
  LG_IN_PX,
  LAPTOP_WIDTH_IN_PX,
  WIDE_DESKTOP_WIDTH_IN_PX,
];

const ORIGINAL_INNER_WIDTH: number = window.innerWidth;

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";

function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

function goTo(pathname: string): void {
  Navigation.setLocation({
    pathname: pathname,
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as Location);
}

// Painted at each width: on a clean page, and with the foreign rule.
function expectOnScreenAt(
  element: Element | null,
  widths: Array<number>,
): void {
  for (const width of widths) {
    expect(describeVisibility(element, width)).toBe(`visible at ${width}px`);
    expect(describeVisibility(element, width, FOREIGN_RULE)).toBe(
      `visible at ${width}px with a foreign .hidden rule on the page`,
    );
  }
}

/*
 * Rendered, and still off screen at each width, rule or no rule. The explicit
 * presence check keeps an element that was never rendered from passing as
 * "hidden".
 */
function expectOffScreenAt(
  element: Element | null,
  widths: Array<number>,
): void {
  expect(element).toBeInTheDocument();

  for (const width of widths) {
    expect(describeVisibility(element, width)).toContain(
      `hidden at ${width}px`,
    );
    expect(describeVisibility(element, width, FOREIGN_RULE)).toContain(
      `hidden at ${width}px`,
    );
  }
}

/*
 * Every element under `root` that paints at some width on a clean page and at
 * none once the foreign rule is there — markup that is only on screen because
 * a responsive utility overrides a bare `hidden`. An element meant to be
 * hidden at every width (a bare `hidden` with nothing overriding it) is hidden
 * either way and is not listed.
 */
function elementsLostToForeignRule(root: Element): Array<string> {
  const widths: Array<number> = [
    320,
    ...Object.values(TAILWIND_BREAKPOINTS_IN_PX),
  ];

  return Array.from(root.querySelectorAll("[class]"))
    .filter((element: Element): boolean => {
      const classAttribute: string | null = element.getAttribute("class");

      return widths.some((width: number): boolean => {
        return (
          resolveDisplay(classAttribute, width) !== "hidden" &&
          resolveDisplay(classAttribute, width, FOREIGN_RULE) === "hidden"
        );
      });
    })
    .map((element: Element): string => {
      return `<${element.tagName.toLowerCase()} class="${element.getAttribute(
        "class",
      )}">`;
    });
}

interface ClassChange {
  // The class string exactly as the pre-fix source had it.
  before: string;
  // ... and exactly as it reads now.
  after: string;
}

// The token the fix put where the bare `hidden` used to be.
const FIXED_HIDDEN_TOKEN: RegExp = /^max-(sm|md|lg|xl|2xl):hidden$/;

function tokensOf(classAttribute: string): Array<string> {
  return classAttribute.split(/\s+/).filter(Boolean);
}

/*
 * The pre-fix class attribute of `carrier`, rebuilt from what rendered by
 * putting the diff's old string back where the new one is. It is checked to
 * differ from the rendered attribute only by the swapped `hidden` token, so the
 * control below runs against the markup that actually shipped, not against a
 * paraphrase of it.
 */
function preFixClassAttribute(carrier: Element, change: ClassChange): string {
  const current: string = carrier.getAttribute("class") || "";

  expect(current).toContain(change.after);

  const preFix: string = current.replace(change.after, change.before);

  expect(tokensOf(preFix)).toEqual(
    tokensOf(current).map((token: string): string => {
      return FIXED_HIDDEN_TOKEN.test(token) ? "hidden" : token;
    }),
  );

  return preFix;
}

/*
 * The control: a detached copy of `carrier` wearing its pre-fix classes. On a
 * clean page it paints at every width it is meant for — which is why nothing
 * flagged it — and with the foreign rule it paints at none of them.
 */
function expectPreFixMarkupLostToForeignRule(
  carrier: Element,
  change: ClassChange,
  widths: Array<number>,
): void {
  const preFix: string = preFixClassAttribute(carrier, change);
  const copy: Element = carrier.cloneNode(false) as Element;
  copy.setAttribute("class", preFix);

  for (const width of widths) {
    expect(describeVisibility(copy, width)).toBe(`visible at ${width}px`);
    expect(describeVisibility(copy, width, FOREIGN_RULE)).toBe(
      `hidden at ${width}px with a foreign .hidden rule on the page by <${copy.tagName.toLowerCase()} class="${preFix}">`,
    );
  }
}

describe("Shared components under a foreign .hidden rule", () => {
  beforeAll(() => {
    // The products menu scrolls its active option into view; jsdom has no layout.
    Element.prototype.scrollIntoView = (): void => {};
  });

  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/home`);
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    setViewportWidth(ORIGINAL_INNER_WIDTH);
  });

  describe("NavBar", () => {
    const home: NavItem = {
      id: "home-nav-bar-item",
      title: "Home",
      icon: IconProp.Home,
      route: new Route(`/dashboard/${PROJECT_ID}/home`),
    };

    const settings: NavItem = {
      id: "settings-nav-bar-item",
      title: "Project Settings",
      icon: IconProp.Settings,
      route: new Route(`/dashboard/${PROJECT_ID}/settings`),
    };

    const products: Array<MoreMenuItem> = [
      {
        title: "Monitors",
        description: "Check uptime and availability.",
        icon: IconProp.AltGlobe,
        route: new Route(`/dashboard/${PROJECT_ID}/monitors`),
      },
      {
        title: "Logs",
        description: "Investigate application events.",
        icon: IconProp.Logs,
        route: new Route(`/dashboard/${PROJECT_ID}/logs`),
      },
    ];

    const DESKTOP_ROW_CHANGE: ClassChange = {
      before: "bg-white flex text-center items-center lg:py-2 hidden md:flex",
      after:
        "bg-white flex text-center items-center lg:py-2 max-md:hidden md:flex",
    };

    function renderNavbar(): ReturnType<typeof render> {
      return render(
        <Navbar
          items={[home]}
          moreMenuItems={products}
          rightElement={settings}
        />,
      );
    }

    function productsButton(): HTMLElement | null {
      return screen.getByText("Products").closest("button");
    }

    /*
     * Rendered once per width with innerWidth set to it, so the desktop branch
     * is the one the component itself picks there — this is the bar the
     * customer's 1917px window should have shown.
     */
    test("the nav row, Home and the Products button are on screen from 768px up with the rule", () => {
      for (const width of WIDTHS_FROM_MD) {
        setViewportWidth(width);
        const { unmount } = renderNavbar();

        expect(screen.queryByTestId("mobile-nav-toggle")).toBeNull();
        expectOnScreenAt(screen.getByTestId("nav-children"), [width]);
        expectOnScreenAt(document.getElementById("home-nav-bar-item"), [width]);
        expectOnScreenAt(productsButton(), [width]);

        unmount();
      }
    });

    test("the right-hand element's container, which shares the row's classes, survives the rule too", () => {
      setViewportWidth(LAPTOP_WIDTH_IN_PX);
      renderNavbar();

      const rightElement: HTMLElement | null = screen
        .getByText("Project Settings")
        .closest("a");
      const container: HTMLElement = rightElement!.parentElement!;

      expect(container).not.toBe(screen.getByTestId("nav-children"));
      expect(container.getAttribute("class")).toBe(DESKTOP_ROW_CHANGE.after);
      expectOnScreenAt(rightElement, WIDTHS_FROM_MD);
    });

    /*
     * The component starts out assuming a desktop and only switches to the
     * phone branch once its effect has measured the window, so on a phone the
     * very first paint is the desktop row. The class is what keeps that row
     * off a narrow screen, and it still has to, rule or no rule.
     */
    test("the desktop row is still off screen below 768px", () => {
      setViewportWidth(LAPTOP_WIDTH_IN_PX);
      renderNavbar();

      expectOffScreenAt(screen.getByTestId("nav-children"), WIDTHS_BELOW_MD);
      expectOffScreenAt(
        document.getElementById("home-nav-bar-item"),
        WIDTHS_BELOW_MD,
      );
      expectOffScreenAt(productsButton(), WIDTHS_BELOW_MD);
    });

    test("the phone branch still shows its menu toggle with the rule, and only below 768px", () => {
      setViewportWidth(PHONE_WIDTH_IN_PX);
      renderNavbar();

      const toggle: HTMLElement = screen.getByTestId("mobile-nav-toggle");

      expect(screen.queryByTestId("nav-children")).toBeNull();
      expectOnScreenAt(toggle, [320, PHONE_WIDTH_IN_PX, MD_IN_PX - 1]);
      expectOffScreenAt(toggle, WIDTHS_FROM_MD);
    });

    test("nothing in either branch is only on screen by overriding a bare hidden", () => {
      setViewportWidth(LAPTOP_WIDTH_IN_PX);
      const { unmount } = renderNavbar();

      expect(elementsLostToForeignRule(document.body)).toEqual([]);

      unmount();
      setViewportWidth(PHONE_WIDTH_IN_PX);
      renderNavbar();

      expect(elementsLostToForeignRule(document.body)).toEqual([]);
    });

    test("control: the pre-fix row class takes the whole bar away under the rule", () => {
      setViewportWidth(WIDE_DESKTOP_WIDTH_IN_PX);
      renderNavbar();

      expectPreFixMarkupLostToForeignRule(
        screen.getByTestId("nav-children"),
        DESKTOP_ROW_CHANGE,
        WIDTHS_FROM_MD,
      );
    });
  });

  describe("SideMenu", () => {
    const ASIDE_CHANGE: ClassChange = {
      before: "hidden md:block w-56 lg:w-64 flex-shrink-0 mb-10",
      after: "max-md:hidden md:block w-56 lg:w-64 flex-shrink-0 mb-10",
    };

    function renderSideMenu(): void {
      render(
        <SideMenu
          items={[
            {
              link: {
                title: "Overview",
                to: new Route(`/dashboard/${PROJECT_ID}/home`),
              },
              icon: IconProp.Home,
            },
            {
              link: {
                title: "Monitors",
                to: new Route(`/dashboard/${PROJECT_ID}/monitors`),
              },
              icon: IconProp.AltGlobe,
            },
          ]}
        />,
      );
    }

    function desktopAside(): HTMLElement {
      return screen.getByRole("navigation", { name: "Main navigation" });
    }

    test("the desktop menu and its links are on screen from 768px up with the rule", () => {
      setViewportWidth(LAPTOP_WIDTH_IN_PX);
      renderSideMenu();

      expect(desktopAside().tagName).toBe("ASIDE");
      expectOnScreenAt(desktopAside(), WIDTHS_FROM_MD);
      expectOnScreenAt(screen.getByText("Monitors"), WIDTHS_FROM_MD);
      expect(elementsLostToForeignRule(document.body)).toEqual([]);
    });

    test("the desktop menu is still off screen below 768px", () => {
      setViewportWidth(LAPTOP_WIDTH_IN_PX);
      renderSideMenu();

      expectOffScreenAt(desktopAside(), WIDTHS_BELOW_MD);
    });

    test("the phone branch still shows its toggle with the rule", () => {
      setViewportWidth(PHONE_WIDTH_IN_PX);
      renderSideMenu();

      const toggle: HTMLElement = screen.getByTestId("mobile-sidemenu-toggle");

      expectOnScreenAt(toggle, [PHONE_WIDTH_IN_PX, MD_IN_PX - 1]);
      expectOffScreenAt(toggle, WIDTHS_FROM_MD);
    });

    test("control: the pre-fix aside class takes the whole menu away under the rule", () => {
      setViewportWidth(WIDE_DESKTOP_WIDTH_IN_PX);
      renderSideMenu();

      expectPreFixMarkupLostToForeignRule(
        desktopAside(),
        ASIDE_CHANGE,
        WIDTHS_FROM_MD,
      );
    });
  });

  describe("Card description", () => {
    const DESCRIPTION_CHANGE: ClassChange = {
      before:
        "mt-1.5 text-sm text-gray-500 w-full hidden md:block leading-relaxed",
      after:
        "mt-1.5 text-sm text-gray-500 w-full max-md:hidden md:block leading-relaxed",
    };

    test("is on screen from 768px up with the rule, and still off screen below it", () => {
      render(<Card title="Monitors" description="Every monitor you own." />);

      const description: HTMLElement = screen.getByTestId("card-description");

      expectOnScreenAt(description, WIDTHS_FROM_MD);
      expectOffScreenAt(description, WIDTHS_BELOW_MD);
      // The title is not desktop-only and never was.
      expectOnScreenAt(screen.getByText("Monitors"), [PHONE_WIDTH_IN_PX]);
      expect(elementsLostToForeignRule(document.body)).toEqual([]);
    });

    test("control: the pre-fix description class is gone under the rule", () => {
      render(<Card title="Monitors" description="Every monitor you own." />);

      expectPreFixMarkupLostToForeignRule(
        screen.getByTestId("card-description"),
        DESCRIPTION_CHANGE,
        WIDTHS_FROM_MD,
      );
    });
  });

  describe("Pagination", () => {
    const PAGE_ITEM_CHANGE: ClassChange = {
      before: "hidden sm:flex",
      after: "max-sm:hidden sm:flex",
    };

    function renderPagination(hasMore?: boolean | undefined): void {
      render(
        <Pagination
          currentPageNumber={1}
          totalItemsCount={240}
          itemsOnPage={10}
          onNavigateToPage={getJestMockFunction()}
          isLoading={false}
          isError={false}
          singularLabel="Monitor"
          pluralLabel="Monitors"
          hasMore={hasMore}
        />,
      );
    }

    test("the numbered pages and the ellipsis are on screen from 640px up with the rule", () => {
      renderPagination();

      for (const testId of [
        "pagination-page-1",
        "pagination-page-2",
        "pagination-ellipsis-end",
        "pagination-page-24",
      ]) {
        expectOnScreenAt(screen.getByTestId(testId), WIDTHS_FROM_SM);
      }

      expect(elementsLostToForeignRule(document.body)).toEqual([]);
    });

    test("below 640px the numbers still give way to the single page indicator", () => {
      renderPagination();

      expectOffScreenAt(
        screen.getByTestId("pagination-page-2"),
        WIDTHS_BELOW_SM,
      );
      expectOnScreenAt(
        screen.getByTestId("pagination-current-page-indicator"),
        WIDTHS_BELOW_SM,
      );
      expectOffScreenAt(
        screen.getByTestId("pagination-current-page-indicator"),
        WIDTHS_FROM_SM,
      );
    });

    test("the has-more indicator is on screen from 640px up with the rule", () => {
      renderPagination(true);

      const indicator: HTMLElement = screen.getByTestId(
        "pagination-current-page-indicator-desktop",
      );

      expectOnScreenAt(indicator, WIDTHS_FROM_SM);
      expectOffScreenAt(indicator, WIDTHS_BELOW_SM);
    });

    test("control: the pre-fix page item class is gone under the rule", () => {
      renderPagination();

      expectPreFixMarkupLostToForeignRule(
        screen.getByTestId("pagination-page-2").parentElement!,
        PAGE_ITEM_CHANGE,
        WIDTHS_FROM_SM,
      );
    });
  });

  describe("Page header labels", () => {
    const LABELS_CHANGE: ClassChange = {
      before:
        "hidden sm:flex sm:flex-wrap sm:items-center sm:justify-end sm:gap-3",
      after:
        "max-sm:hidden sm:flex sm:flex-wrap sm:items-center sm:justify-end sm:gap-3",
    };

    function renderPage(): void {
      const label: Label = new Label();
      label.id = new ObjectID("33333333-3333-4333-8333-333333333330");
      label.name = "Production";

      render(
        <Page title="Monitors" labels={[label]}>
          <div>Body</div>
        </Page>,
      );
    }

    function labelsGroup(): HTMLElement {
      return screen.getByText("Labels").parentElement!;
    }

    test("are on screen from 640px up with the rule, and still off screen below it", () => {
      renderPage();

      expectOnScreenAt(screen.getByText("Production"), WIDTHS_FROM_SM);
      expectOffScreenAt(labelsGroup(), WIDTHS_BELOW_SM);
      expectOnScreenAt(screen.getByText("Monitors"), [PHONE_WIDTH_IN_PX]);
      expect(elementsLostToForeignRule(document.body)).toEqual([]);
    });

    test("control: the pre-fix labels class is gone under the rule", () => {
      renderPage();

      expectPreFixMarkupLostToForeignRule(
        labelsGroup(),
        LABELS_CHANGE,
        WIDTHS_FROM_SM,
      );
    });
  });

  describe("HeaderIconDropdownButton shortcut keycaps", () => {
    const KEYCAP_CHANGE: ClassChange = {
      before: "ml-0.5 hidden sm:inline-flex",
      after: "ml-0.5 max-sm:hidden sm:inline-flex",
    };

    function renderButton(): HTMLElement {
      render(
        <HeaderIconDropdownButton
          name="Ask AI"
          title="Ask AI"
          icon={IconProp.Sparkles}
          showDropdown={false}
          shortcut={[KeyboardKey.Mod, "I"]}
        />,
      );

      // The keycaps' wrapper is the KeyboardShortcut root, the <kbd>s' parent.
      return screen.getByText("Ask AI").closest("button")!.querySelector("kbd")!
        .parentElement!;
    }

    test("are on screen from 640px up with the rule, beside a label that never hides", () => {
      const keycaps: HTMLElement = renderButton();

      expectOnScreenAt(keycaps, WIDTHS_FROM_SM);
      expectOffScreenAt(keycaps, WIDTHS_BELOW_SM);
      expectOnScreenAt(screen.getByText("Ask AI"), [
        ...WIDTHS_BELOW_SM,
        ...WIDTHS_FROM_SM,
      ]);
      expect(elementsLostToForeignRule(document.body)).toEqual([]);
    });

    test("control: the pre-fix keycap class is gone under the rule", () => {
      expectPreFixMarkupLostToForeignRule(
        renderButton(),
        KEYCAP_CHANGE,
        WIDTHS_FROM_SM,
      );
    });
  });

  describe("NavBarMenuModal keyboard hints", () => {
    const SHORTCUT_HINT_CHANGE: ClassChange = {
      before: "hidden sm:inline-flex",
      after: "max-sm:hidden sm:inline-flex",
    };

    const FOOTER_HINTS_CHANGE: ClassChange = {
      before:
        "hidden flex-shrink-0 items-center gap-2 text-xs text-gray-400 md:flex",
      after:
        "max-md:hidden flex-shrink-0 items-center gap-2 text-xs text-gray-400 md:flex",
    };

    const KEYBOARD_HINT: string =
      "Use the arrow keys to move and Enter to open";

    function renderModal(): void {
      render(
        <NavBarMenuModal
          items={[
            {
              title: "Monitors",
              description: "Check uptime and availability.",
              icon: IconProp.AltGlobe,
              route: new Route(`/dashboard/${PROJECT_ID}/monitors`),
            },
          ]}
          footer={{
            title: "OneUptime on GitHub",
            description: "Star the project.",
            link: URL.fromString("https://github.com/OneUptime/oneuptime"),
          }}
          keyboardHint={KEYBOARD_HINT}
          onClose={getJestMockFunction()}
        />,
      );
    }

    // The Cmd/Ctrl+K keycaps sit in the search header, beside the input.
    function commandKHint(): HTMLElement {
      return screen.getByRole("combobox").parentElement!.querySelector("kbd")!
        .parentElement!;
    }

    function footerHints(): HTMLElement {
      return screen.getByLabelText(KEYBOARD_HINT);
    }

    test("the Cmd/Ctrl+K hint is on screen from 640px up with the rule", () => {
      renderModal();

      expectOnScreenAt(commandKHint(), WIDTHS_FROM_SM);
      expectOffScreenAt(commandKHint(), WIDTHS_BELOW_SM);
    });

    test("the footer's arrow/Enter/Esc hints are on screen from 768px up with the rule", () => {
      renderModal();

      expectOnScreenAt(footerHints(), WIDTHS_FROM_MD);
      expectOffScreenAt(footerHints(), WIDTHS_BELOW_MD);
      expect(elementsLostToForeignRule(document.body)).toEqual([]);
    });

    test("control: both pre-fix hint classes are gone under the rule", () => {
      renderModal();

      expectPreFixMarkupLostToForeignRule(
        commandKHint(),
        SHORTCUT_HINT_CHANGE,
        WIDTHS_FROM_SM,
      );
      expectPreFixMarkupLostToForeignRule(
        footerHints(),
        FOOTER_HINTS_CHANGE,
        WIDTHS_FROM_MD,
      );
    });
  });

  describe("ModalFooter spacer", () => {
    const SPACER_CHANGE: ClassChange = {
      before: "hidden sm:block",
      after: "max-sm:hidden sm:block",
    };

    /*
     * With no left-hand element the footer puts an empty spacer first, and
     * `justify-between` is what then pushes Cancel and Save to the right. Lose
     * the spacer and the buttons slide over to the left edge of the modal.
     */
    function renderFooter(): HTMLElement {
      render(
        <ModalFooter
          onClose={getJestMockFunction()}
          onSubmit={getJestMockFunction()}
        />,
      );

      return screen.getByTestId("modal-footer")
        .firstElementChild as HTMLElement;
    }

    test("is in the row from 640px up with the rule, and out of it below", () => {
      const spacer: HTMLElement = renderFooter();

      expect(spacer).toBeEmptyDOMElement();
      expectOnScreenAt(spacer, WIDTHS_FROM_SM);
      expectOffScreenAt(spacer, WIDTHS_BELOW_SM);
      expect(elementsLostToForeignRule(document.body)).toEqual([]);
    });

    test("control: the pre-fix spacer class is gone under the rule", () => {
      expectPreFixMarkupLostToForeignRule(
        renderFooter(),
        SPACER_CHANGE,
        WIDTHS_FROM_SM,
      );
    });
  });

  describe("Banner", () => {
    const HIDE_ON_MOBILE_CHANGE: ClassChange = {
      before: "hidden md:flex",
      after: "max-md:hidden md:flex",
    };

    function renderBanner(hideOnMobile: boolean): HTMLElement {
      render(
        <Banner
          title="New in OneUptime"
          description="Try the redesigned status pages."
          hideOnMobile={hideOnMobile}
        />,
      );

      return screen.getByText("New in OneUptime").closest("div")!;
    }

    test("hideOnMobile keeps it on screen from 768px up with the rule, and off below", () => {
      const banner: HTMLElement = renderBanner(true);

      expectOnScreenAt(banner, WIDTHS_FROM_MD);
      expectOffScreenAt(banner, WIDTHS_BELOW_MD);
      expect(elementsLostToForeignRule(document.body)).toEqual([]);
    });

    test("without hideOnMobile it is on screen at every width", () => {
      const banner: HTMLElement = renderBanner(false);

      expectOnScreenAt(banner, [...WIDTHS_BELOW_MD, ...WIDTHS_FROM_MD]);
    });

    test("control: the pre-fix hideOnMobile classes are gone under the rule", () => {
      expectPreFixMarkupLostToForeignRule(
        renderBanner(true),
        HIDE_ON_MOBILE_CHANGE,
        WIDTHS_FROM_MD,
      );
    });
  });

  describe("CardModelDetail documentation and demo buttons", () => {
    const BUTTON_CHANGE: ClassChange = {
      before: "hidden md:flex",
      after: "max-md:hidden md:flex",
    };

    function findButton(label: string): HTMLButtonElement | null {
      return (
        Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
          (button: HTMLButtonElement): boolean => {
            return (button.textContent || "").trim() === label;
          },
        ) || null
      );
    }

    async function renderCardModelDetail(): Promise<void> {
      render(
        <CardModelDetail<Monitor>
          name="Monitor Details"
          cardProps={{
            title: "Monitor Details",
            description: "Key facts about this monitor.",
          }}
          isEditable={false}
          documentationLink={new Route("/docs/monitor")}
          videoLink={URL.fromString("https://www.youtube.com/watch?v=demo")}
          modelDetailProps={{
            modelType: Monitor,
            id: "monitor-detail",
            modelId: new ObjectID("11111111-1111-4111-8111-111111111111"),
            fields: [
              {
                field: { name: true },
                title: "Name",
                fieldType: FieldType.Text,
              },
            ],
          }}
        />,
      );

      await waitFor(() => {
        expect(findButton("Watch Demo")).not.toBeNull();
      });
    }

    beforeEach(() => {
      PermissionGate.clearPermissionPropsCache();
    });

    test("are on screen from 768px up with the rule, and still off screen below it", async () => {
      await renderCardModelDetail();

      for (const label of ["View Documentation", "Watch Demo"]) {
        expectOnScreenAt(findButton(label), WIDTHS_FROM_MD);
        expectOffScreenAt(findButton(label), WIDTHS_BELOW_MD);
      }

      expect(elementsLostToForeignRule(document.body)).toEqual([]);
    });

    test("control: the pre-fix button class is gone under the rule", async () => {
      await renderCardModelDetail();

      for (const label of ["View Documentation", "Watch Demo"]) {
        expectPreFixMarkupLostToForeignRule(
          findButton(label)!,
          BUTTON_CHANGE,
          WIDTHS_FROM_MD,
        );
      }
    });
  });

  describe("BaseModelTable header", () => {
    const SEARCH_KEYCAP_CHANGE: ClassChange = {
      before:
        "hidden flex-none select-none items-center rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-gray-500 sm:inline-flex",
      after:
        "max-sm:hidden flex-none select-none items-center rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-gray-500 sm:inline-flex",
    };

    function makeProps(): BaseModelTableProps<Monitor> {
      const callbacks: BaseTableCallbacks<Monitor> = {
        deleteItem: async (): Promise<void> => {
          return undefined;
        },
        getModelFromJSON: (item: JSONObject): Monitor => {
          return item as unknown as Monitor;
        },
        getJSONFromModel: (item: Monitor): JSONObject => {
          return item as unknown as JSONObject;
        },
        addSlugToSelect: (select: unknown): unknown => {
          return select;
        },
        getList: async (data: {
          skip: number;
          limit: number;
        }): Promise<ListResult<Monitor>> => {
          return { data: [], count: 0, skip: data.skip, limit: data.limit };
        },
        toJSONArray: (): Array<JSONObject> => {
          return [];
        },
        updateById: async (): Promise<void> => {
          return undefined;
        },
        showCreateEditModal: (): React.ReactElement => {
          return <div data-testid="create-edit-modal" />;
        },
      } as unknown as BaseTableCallbacks<Monitor>;

      return {
        modelType: Monitor,
        id: "foreign-hidden-rule-table",
        name: "Foreign Hidden Rule",
        userPreferencesKey: "foreign-hidden-rule-table",
        urlStateKey: "foreign-hidden-rule-table",
        columns: [
          { field: { name: true }, title: "Name", type: FieldType.Text },
        ],
        filters: [],
        searchableFields: ["name"],
        cardProps: { title: "Monitors", description: "All monitors" },
        documentationLink: new Route("/docs/monitor"),
        videoLink: URL.fromString("https://www.youtube.com/watch?v=demo"),
        isCreateable: false,
        isEditable: false,
        isDeleteable: false,
        isViewable: false,
        callbacks: callbacks,
      } as unknown as BaseModelTableProps<Monitor>;
    }

    function moreOptionsButton(): HTMLElement {
      return screen.getByRole("button", { name: "More options" });
    }

    // The "/" keycaps: one on the collapsed search pill, one on the open bar.
    function searchKeycaps(): Array<HTMLElement> {
      const onPill: HTMLElement | null = screen
        .getByRole("button", { name: "Open search" })
        .querySelector("kbd");
      const onBar: HTMLElement | null = document.querySelector(
        'kbd[title="Press / to focus search"]',
      );

      expect(onPill).not.toBeNull();
      expect(onBar).not.toBeNull();

      return [onPill!, onBar!];
    }

    async function renderTable(): Promise<void> {
      render(<BaseModelTable<Monitor> {...makeProps()} />);

      await waitFor(() => {
        expect(moreOptionsButton()).toBeInTheDocument();
      });
    }

    beforeEach(() => {
      PermissionGate.clearPermissionPropsCache();
      window.history.replaceState(
        window.history.state,
        "",
        "/dashboard/monitors",
      );
      TableFilterUrlState.resetClaimedKeys();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("the search keycaps are on screen from 640px up with the rule, and still off below", async () => {
      await renderTable();

      for (const keycap of searchKeycaps()) {
        expectOnScreenAt(keycap, WIDTHS_FROM_SM);
        expectOffScreenAt(keycap, WIDTHS_BELOW_SM);
      }

      expect(elementsLostToForeignRule(document.body)).toEqual([]);
    });

    /*
     * The table also marks its View Documentation and Watch Demo schemas
     * `max-md:hidden md:flex` (formerly `hidden md:flex`), but neither is ever
     * the header's main button, so both are rendered as entries of the ⋯ menu
     * — and a menu entry does not take the schema's className. What reaches
     * the screen is therefore the menu entry, and that is what is checked.
     */
    test("the documentation and demo entries in the ⋯ menu are on screen from 768px up with the rule", async () => {
      await renderTable();

      fireEvent.click(moreOptionsButton());

      for (const label of ["View Documentation", "Watch Demo"]) {
        const entry: HTMLElement | null = screen
          .getByText(label)
          .closest('[role="menuitem"]');

        expect(entry).not.toBeNull();
        expect(entry!.getAttribute("class")).not.toContain("md:flex");
        expectOnScreenAt(entry, WIDTHS_FROM_MD);
      }

      expect(elementsLostToForeignRule(document.body)).toEqual([]);
    });

    test("control: the pre-fix search keycap class is gone under the rule", async () => {
      await renderTable();

      for (const keycap of searchKeycaps()) {
        expectPreFixMarkupLostToForeignRule(
          keycap,
          SEARCH_KEYCAP_CHANGE,
          WIDTHS_FROM_SM,
        );
      }
    });
  });
});
