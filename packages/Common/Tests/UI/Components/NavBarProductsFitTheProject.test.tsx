import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import Navbar, {
  MoreMenuItem,
  NAVBAR_PINNED_ITEM_TEST_ID,
  NavItem,
} from "../../../UI/Components/Navbar/NavBar";
import {
  DEFAULT_HIDDEN_PRODUCTS_TITLE,
  getMenuItemsWithHidden,
} from "../../../UI/Components/Navbar/NavBarMenuCatalog";
import NavBarMenuModal, {
  PRODUCT_PIN_BUTTON_TEST_ID,
} from "../../../UI/Components/Navbar/NavBarMenuModal";
import NavBarMobileMenu, {
  MOBILE_MENU_PINNED_TEST_ID,
  MOBILE_MENU_RECENT_TEST_ID,
} from "../../../UI/Components/Navbar/NavBarMobileMenu";
import { RECENT_PRODUCTS_STORAGE_KEY } from "../../../UI/Components/Navbar/NavBarRecentProducts";
import Navigation from "../../../UI/Utils/Navigation";

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
 * PRODUCTS THAT FIT THE PROJECT, IN THE SHARED NAV BAR (#6814).
 *
 *  - The products a project hides are one more row at the foot of the
 *    products menu, More products: not under their own category, not in
 *    Recently visited, still found by search, and open by themselves on one
 *    of their own pages.
 *  - Each card has a pin when the caller takes pins; five pinned lock the
 *    others. The pinned products sit in the bar beside Home and Products,
 *    and first in the phone's menu.
 *  - A product nothing is in says "Not set up"; one the plan cannot use
 *    names the plan that can.
 */

function product(
  key: string,
  title: string,
  category: string,
  extra?: Partial<MoreMenuItem>,
): MoreMenuItem {
  return {
    key: key,
    title: title,
    description: `${title} does its job.`,
    route: new Route(`/p/${key}`),
    icon: IconProp.Cube,
    category: category,
    ...extra,
  };
}

const MONITORS: MoreMenuItem = product("monitors", "Monitors", "Essentials");
const INCIDENTS: MoreMenuItem = product("incidents", "Incidents", "Essentials");
const LOGS: MoreMenuItem = product("logs", "Logs", "Observability", {
  keywords: ["syslog"],
});
const WORKFLOWS: MoreMenuItem = product(
  "workflows",
  "Workflows",
  "Automation",
  { neededPlan: "Growth", isNotSetUp: true },
);
const HOSTS: MoreMenuItem = product("hosts", "Hosts", "Infrastructure", {
  isNotSetUp: true,
});
const KUBERNETES: MoreMenuItem = product(
  "kubernetes",
  "Kubernetes",
  "Infrastructure",
  { keywords: ["k8s"] },
);
const DOCKER: MoreMenuItem = product("docker", "Docker", "Infrastructure");

const LISTED: Array<MoreMenuItem> = [
  MONITORS,
  INCIDENTS,
  LOGS,
  WORKFLOWS,
  HOSTS,
];
const HIDDEN: Array<MoreMenuItem> = [KUBERNETES, DOCKER];

function goTo(pathname: string): void {
  Navigation.setLocation({
    pathname: pathname,
    search: "",
    hash: "",
    state: null,
    key: "test",
  });
}

function setWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

function renderMenu(
  props: Partial<React.ComponentProps<typeof NavBarMenuModal>> = {},
): ReturnType<typeof render> {
  return render(
    <NavBarMenuModal
      items={LISTED}
      hiddenItems={HIDDEN}
      categoriesOpenByDefault={["Essentials"]}
      onClose={() => {}}
      {...props}
    />,
  );
}

function optionTitles(container: HTMLElement = document.body): Array<string> {
  return within(container)
    .queryAllByRole("option")
    .map((option: HTMLElement): string => {
      return option.querySelector("span.truncate")?.textContent ?? "";
    });
}

function row(title: string): HTMLElement {
  return screen.getByRole("button", { name: title });
}

const ORIGINAL_WIDTH: number = window.innerWidth;

beforeAll(() => {
  Element.prototype.scrollIntoView = (): void => {};
});

beforeEach(() => {
  window.localStorage.clear();
  goTo("/p/home");
  setWidth(1280);
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
  setWidth(ORIGINAL_WIDTH);
});

describe("the hidden products' row", () => {
  test("hidden products are listed under their own row, last, after every listed one", () => {
    expect(
      getMenuItemsWithHidden({
        items: LISTED,
        hiddenItems: HIDDEN,
        hiddenTitle: "More products",
      }).map((item: MoreMenuItem): string => {
        return `${item.title}:${item.category}`;
      }),
    ).toEqual([
      "Monitors:Essentials",
      "Incidents:Essentials",
      "Logs:Observability",
      "Workflows:Automation",
      "Hosts:Infrastructure",
      "Kubernetes:More products",
      "Docker:More products",
    ]);
    expect(DEFAULT_HIDDEN_PRODUCTS_TITLE).toBe("More products");
  });

  test("the menu ends with More products, folded, naming what it holds", () => {
    renderMenu();

    const buttons: Array<string> = screen
      .getAllByRole("button")
      .filter((button: HTMLElement): boolean => {
        return button.hasAttribute("aria-expanded");
      })
      .map((button: HTMLElement): string => {
        return button.textContent ?? "";
      });

    expect(buttons[buttons.length - 1]).toBe("More products");
    expect(row("More products")).toHaveAttribute("aria-expanded", "false");

    const line: HTMLElement = row("More products").closest(
      "div.relative",
    ) as HTMLElement;
    expect(line).toHaveTextContent("Kubernetes, Docker");
  });

  test("a hidden product is not under its own category", () => {
    renderMenu();

    fireEvent.click(row("Infrastructure"));

    expect(optionTitles()).toContain("Hosts");
    expect(optionTitles()).not.toContain("Kubernetes");
    expect(optionTitles()).not.toContain("Docker");
  });

  test("opening the row shows the hidden products and the caller's note", () => {
    const close: Mock = jest.fn();
    let closeHanded: (() => void) | undefined = undefined;

    renderMenu({
      onClose: close as unknown as () => void,
      hiddenFooter: (closeMenu: () => void): React.ReactElement => {
        closeHanded = closeMenu;
        return <span>Hidden in this project.</span>;
      },
    });

    expect(screen.queryByText("Hidden in this project.")).toBeNull();

    fireEvent.click(row("More products"));

    expect(optionTitles()).toEqual(
      expect.arrayContaining(["Kubernetes", "Docker"]),
    );
    expect(screen.getByTestId("navbar-menu-hidden-footer")).toHaveTextContent(
      "Hidden in this project.",
    );
    // The note is handed the function that closes the menu.
    closeHanded!();
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("the row takes the caller's name", () => {
    renderMenu({ hiddenTitle: "Weitere Produkte" });

    expect(row("Weitere Produkte")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More products" })).toBeNull();
  });

  test("on a hidden product's page the row opens by itself, the product marked as current", () => {
    goTo("/p/kubernetes/clusters");

    renderMenu();

    expect(row("More products")).toHaveAttribute("aria-expanded", "true");
    const current: HTMLElement | null = document.querySelector(
      '[aria-current="page"]',
    );
    expect(current).toHaveTextContent("Kubernetes");
  });

  test("search finds a hidden product, under the row's name", () => {
    renderMenu();

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "k8s" },
    });

    expect(optionTitles()).toEqual(["Kubernetes"]);
    expect(
      screen.getByRole("heading", { level: 3, name: "More products" }),
    ).toBeInTheDocument();
    // No note while searching.
    expect(screen.queryByTestId("navbar-menu-hidden-footer")).toBeNull();
  });

  test("Recently visited leaves hidden products out", () => {
    window.localStorage.setItem(
      RECENT_PRODUCTS_STORAGE_KEY,
      JSON.stringify(["/p/kubernetes", "/p/logs"]),
    );

    renderMenu();

    const recent: HTMLElement = screen
      .getByRole("heading", { level: 3, name: "Recent" })
      .closest('[role="group"]') as HTMLElement;

    expect(optionTitles(recent)).toEqual(["Logs"]);
  });

  test("a menu without hidden products has no such row", () => {
    renderMenu({ hiddenItems: [] });

    expect(screen.queryByRole("button", { name: "More products" })).toBeNull();
  });
});

describe("pinning from the products menu", () => {
  function pinOf(title: string): HTMLElement {
    const option: HTMLElement = screen
      .getAllByRole("option")
      .find((candidate: HTMLElement): boolean => {
        return candidate.querySelector("span.truncate")?.textContent === title;
      }) as HTMLElement;

    return within(option).getByTestId(PRODUCT_PIN_BUTTON_TEST_ID);
  }

  test("without a way to pin, cards have no pin", () => {
    renderMenu();

    expect(screen.queryAllByTestId(PRODUCT_PIN_BUTTON_TEST_ID)).toHaveLength(0);
  });

  test("each card has a pin that says whether it is pinned", () => {
    renderMenu({
      onTogglePin: () => {},
      pinnedItems: [INCIDENTS],
      canPinMore: true,
    });

    expect(pinOf("Monitors")).toHaveAttribute("aria-pressed", "false");
    expect(pinOf("Monitors")).toHaveAccessibleName("Pin Monitors");
    expect(pinOf("Incidents")).toHaveAttribute("aria-pressed", "true");
    expect(pinOf("Incidents")).toHaveAccessibleName("Unpin Incidents");
  });

  test("a press pins the product, and neither opens it nor closes the menu", () => {
    const toggle: Mock = jest.fn();
    const close: Mock = jest.fn();

    renderMenu({
      onTogglePin: toggle as unknown as (item: MoreMenuItem) => void,
      onClose: close as unknown as () => void,
      canPinMore: true,
    });

    fireEvent.click(pinOf("Monitors"));

    expect(toggle).toHaveBeenCalledTimes(1);
    expect((toggle.mock.calls[0]![0] as MoreMenuItem).key).toBe("monitors");
    expect(close).not.toHaveBeenCalled();
    expect(Navigation.navigate).not.toHaveBeenCalled();
  });

  test("the pin sits beside the card's link, never inside it", () => {
    renderMenu({ onTogglePin: () => {}, canPinMore: true });

    expect(pinOf("Monitors").closest("a")).toBeNull();
  });

  test("with five pinned, the others' pins are locked and say why; the pinned ones still unpin", () => {
    renderMenu({
      onTogglePin: () => {},
      pinnedItems: [INCIDENTS],
      canPinMore: false,
    });

    expect(pinOf("Monitors")).toBeDisabled();
    expect(pinOf("Monitors")).toHaveAttribute(
      "title",
      "You can pin up to 5 products. Unpin one first.",
    );
    expect(pinOf("Incidents")).not.toBeDisabled();
  });

  test("an item with no key cannot be pinned", () => {
    const withoutKey: MoreMenuItem = { ...LOGS };
    delete withoutKey.key;

    renderMenu({
      items: [MONITORS, withoutKey],
      hiddenItems: [],
      onTogglePin: () => {},
      canPinMore: true,
      categoriesOpenByDefault: ["Essentials", "Observability"],
    });

    expect(screen.getAllByTestId(PRODUCT_PIN_BUTTON_TEST_ID)).toHaveLength(1);
  });
});

describe("what a product is to the project", () => {
  test("nothing in it says Not set up; a plan it needs says the plan instead", () => {
    renderMenu({
      categoriesOpenByDefault: ["Essentials", "Automation", "Infrastructure"],
    });

    const hosts: HTMLElement = screen
      .getAllByRole("option")
      .find((option: HTMLElement): boolean => {
        return option.textContent?.startsWith("Hosts") === true;
      }) as HTMLElement;
    const workflows: HTMLElement = screen
      .getAllByRole("option")
      .find((option: HTMLElement): boolean => {
        return option.textContent?.startsWith("Workflows") === true;
      }) as HTMLElement;
    const monitors: HTMLElement = screen
      .getAllByRole("option")
      .find((option: HTMLElement): boolean => {
        return option.textContent?.startsWith("Monitors") === true;
      }) as HTMLElement;

    expect(
      within(hosts).getByTestId("navbar-menu-not-set-up"),
    ).toHaveTextContent("Not set up");
    expect(within(workflows).getByTestId("navbar-menu-plan")).toHaveTextContent(
      "Growth Plan",
    );
    expect(
      within(workflows).queryByTestId("navbar-menu-not-set-up"),
    ).toBeNull();
    expect(within(monitors).queryByTestId("navbar-menu-not-set-up")).toBeNull();
    expect(within(monitors).queryByTestId("navbar-menu-plan")).toBeNull();
  });
});

describe("the phone's menu", () => {
  const HOME: NavItem = {
    id: "home-nav-bar-item",
    title: "Home",
    icon: IconProp.Home,
    route: new Route("/p/home"),
  };

  function renderPhoneMenu(
    props: Partial<React.ComponentProps<typeof NavBarMobileMenu>> = {},
  ): ReturnType<typeof render> {
    return render(
      <NavBarMobileMenu
        items={[HOME]}
        moreMenuItems={LISTED}
        hiddenItems={HIDDEN}
        categoriesOpenByDefault={["Essentials"]}
        onNavigate={() => {}}
        {...props}
      />,
    );
  }

  function linkTitles(container: HTMLElement): Array<string> {
    return within(container)
      .getAllByRole("link")
      .map((link: HTMLElement): string => {
        return link.querySelector("span")?.textContent ?? "";
      });
  }

  test("the pinned products come first after Home, in their order", () => {
    const { container } = renderPhoneMenu({
      pinnedItems: [LOGS, KUBERNETES],
    });

    const pinned: HTMLElement = screen.getByTestId(MOBILE_MENU_PINNED_TEST_ID);
    expect(pinned).toHaveTextContent("Pinned");
    expect(linkTitles(pinned)).toEqual(["Logs", "Kubernetes"]);
    // Home, then the pins, before any category.
    expect(linkTitles(container).slice(0, 3)).toEqual([
      "Home",
      "Logs",
      "Kubernetes",
    ]);
  });

  test("a pinned product is left out of Recently visited", () => {
    window.localStorage.setItem(
      RECENT_PRODUCTS_STORAGE_KEY,
      JSON.stringify(["/p/logs", "/p/hosts"]),
    );

    renderPhoneMenu({ pinnedItems: [LOGS] });

    expect(linkTitles(screen.getByTestId(MOBILE_MENU_RECENT_TEST_ID))).toEqual([
      "Hosts",
    ]);
  });

  test("no pins, no pinned group", () => {
    renderPhoneMenu();

    expect(screen.queryByTestId(MOBILE_MENU_PINNED_TEST_ID)).toBeNull();
  });

  test("the hidden products are one more folded row at the end", () => {
    renderPhoneMenu();

    const toggles: Array<HTMLElement> = screen
      .getAllByRole("button")
      .filter((button: HTMLElement): boolean => {
        return button.hasAttribute("aria-expanded");
      });

    expect(toggles[toggles.length - 1]).toHaveTextContent("More products");
    expect(toggles[toggles.length - 1]).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    fireEvent.click(toggles[toggles.length - 1]!);

    expect(
      screen.getByRole("link", { name: /Kubernetes/ }),
    ).toBeInTheDocument();
  });

  test("a product's row carries its marks", () => {
    renderPhoneMenu({
      categoriesOpenByDefault: ["Essentials", "Automation", "Infrastructure"],
    });

    expect(screen.getByTestId("navbar-mobile-plan")).toHaveTextContent(
      "Growth Plan",
    );
    expect(screen.getByTestId("navbar-mobile-not-set-up")).toHaveTextContent(
      "Not set up",
    );
  });
});

describe("the bar", () => {
  const HOME: NavItem = {
    id: "home-nav-bar-item",
    title: "Home",
    icon: IconProp.Home,
    route: new Route("/p/home"),
    activeRoute: new Route("/p/home"),
  };

  function renderBar(
    props: Partial<React.ComponentProps<typeof Navbar>> = {},
  ): ReturnType<typeof render> {
    return render(
      <Navbar
        items={[HOME]}
        moreMenuItems={LISTED}
        moreMenuHiddenItems={HIDDEN}
        moreMenuCategoriesOpenByDefault={["Essentials"]}
        {...props}
      />,
    );
  }

  test("the pinned products sit beside Home and Products, in their order", () => {
    renderBar({ pinnedItems: [LOGS, KUBERNETES] });

    const pins: Array<HTMLElement> = screen.getAllByTestId(
      NAVBAR_PINNED_ITEM_TEST_ID,
    );

    expect(
      pins.map((pin: HTMLElement): string => {
        return pin.textContent ?? "";
      }),
    ).toEqual(["Logs", "Kubernetes"]);
    expect(screen.getByTestId("navbar-pinned")).toHaveAttribute(
      "aria-label",
      "Pinned",
    );
    // Each opens its product.
    expect(pins[0]).toHaveAttribute("href", "/p/logs");
    // Named on hover, and read by a screen reader where only the icon shows.
    expect(pins[0]).toHaveAttribute("title", "Logs");
    expect(pins[0]!.querySelector("span")).toHaveClass("max-xl:sr-only");
  });

  test("the pin of the page the person is on is lit", () => {
    goTo("/p/logs/explorer");

    renderBar({ pinnedItems: [LOGS, KUBERNETES] });

    const pins: Array<HTMLElement> = screen.getAllByTestId(
      NAVBAR_PINNED_ITEM_TEST_ID,
    );

    expect(pins[0]).toHaveAttribute("aria-current", "page");
    expect(pins[1]).not.toHaveAttribute("aria-current");
  });

  test("no pins, nothing beside Products", () => {
    renderBar();

    expect(screen.queryByTestId("navbar-pinned")).toBeNull();
  });

  test("on a hidden product's page the bar still names the product", () => {
    goTo("/p/kubernetes/clusters");

    renderBar();

    expect(
      screen.getByRole("button", { name: /Kubernetes/ }),
    ).toBeInTheDocument();
  });

  test("on a phone the pins come first in the menu, not in the bar", () => {
    setWidth(390);

    renderBar({ pinnedItems: [LOGS] });

    expect(screen.queryByTestId("navbar-pinned")).toBeNull();
    fireEvent.click(screen.getByTestId("mobile-nav-toggle"));
    expect(screen.getByTestId(MOBILE_MENU_PINNED_TEST_ID)).toHaveTextContent(
      "Logs",
    );
  });
});
