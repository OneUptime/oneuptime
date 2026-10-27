import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { Mock } from "jest-mock";
import React from "react";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import { MoreMenuItem } from "../../../UI/Components/Navbar/NavBar";
import NavBarMenuModal from "../../../UI/Components/Navbar/NavBarMenuModal";
import {
  RECENT_PRODUCTS_REMEMBERED,
  RECENT_PRODUCTS_SHOWN,
  RECENT_PRODUCTS_STORAGE_KEY,
} from "../../../UI/Components/Navbar/NavBarRecentProducts";
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
 * The products menu's "Recently visited" row, drawn by the real menu.
 *
 * A customer asked for six recent products instead of four, "since you have
 * the real-estate and 4 items shown now take up 2 rows anyway": the row kept
 * five products at most and left out the page the user was on, so it usually
 * drew four cards, three on one row and one alone under it. It now draws six,
 * two full rows of three, and the browser remembers enough products that the
 * row still fills when the page the user is on is left out.
 *
 * The rules on their own: NavBarRecentProducts.test.ts. The real Dashboard
 * catalog: App/Dashboard/DashboardRecentProducts.test.tsx. The layout in a
 * real browser: E2E/NavigationSearch/RecentProducts.spec.ts.
 */

function product(title: string, category: string, path: string): MoreMenuItem {
  return {
    title,
    description: `${title} does its job.`,
    route: new Route(path),
    icon: IconProp.Cube,
    category,
  };
}

const CATALOG: Array<MoreMenuItem> = [
  product("Monitors", "Essentials", "/p/monitors"),
  product("Incidents", "Essentials", "/p/incidents"),
  product("Alerts", "Essentials", "/p/alerts"),
  product("On-Call Duty", "Essentials", "/p/on-call-duty"),
  product("Logs", "Observability", "/p/logs"),
  product("Traces", "Observability", "/p/traces"),
  product("Metrics", "Observability", "/p/metrics"),
  product("Hosts", "Infrastructure", "/p/hosts"),
  product("Kubernetes", "Infrastructure", "/p/kubernetes"),
  product("Users", "Settings", "/p/users"),
  product("Teams", "Settings", "/p/teams"),
];

function routeOf(title: string): string {
  const item: MoreMenuItem | undefined = CATALOG.find(
    (candidate: MoreMenuItem): boolean => {
      return candidate.title === title;
    },
  );

  if (!item) {
    throw new Error(`No product called ${title} in the catalog.`);
  }

  return item.route.toString();
}

function remember(titles: Array<string>): void {
  window.localStorage.setItem(
    RECENT_PRODUCTS_STORAGE_KEY,
    JSON.stringify(titles.map(routeOf)),
  );
}

function rememberRoutes(routes: Array<unknown>): void {
  window.localStorage.setItem(
    RECENT_PRODUCTS_STORAGE_KEY,
    JSON.stringify(routes),
  );
}

function stored(): Array<string> | null {
  const raw: string | null = window.localStorage.getItem(
    RECENT_PRODUCTS_STORAGE_KEY,
  );
  return raw === null ? null : (JSON.parse(raw) as Array<string>);
}

// Seven products opened one after another, the newest first.
const SEVEN: Array<string> = [
  "Kubernetes",
  "Logs",
  "Users",
  "Alerts",
  "Traces",
  "Teams",
  "Metrics",
];

/*
 * Only a menu that folds its categories draws the row: the Dashboard's,
 * which opens on Essentials and folds the other categories. There it saves
 * opening a category to reach a product used a moment ago. A menu that
 * shows every category open - the Admin Dashboard's six products - draws
 * none: its row only showed the same cards twice (the last block below).
 */
const MENU_KINDS: Array<[string, Array<string> | undefined]> = [
  ["the Dashboard's menu, which folds", ["Essentials"]],
];

function goTo(pathname: string): void {
  Navigation.setLocation({
    pathname,
    search: "",
    hash: "",
    state: null,
    key: "test",
  });
}

function search(): HTMLElement {
  return screen.getByRole("combobox");
}

function press(key: string): void {
  fireEvent.keyDown(search(), { key });
}

function titlesIn(scope: HTMLElement): Array<string> {
  return within(scope)
    .queryAllByRole("option")
    .map((option: HTMLElement): string => {
      return option.querySelector("span.truncate")?.textContent ?? "";
    });
}

function recentRow(name: string = "Recent"): HTMLElement {
  return screen.getByRole("group", { name });
}

function recentTitles(name: string = "Recent"): Array<string> {
  return titlesIn(recentRow(name));
}

// A grid's column count, at a breakpoint or at none: grid-cols-1, lg:grid-cols-3.
const GRID_COLUMNS_CLASS: RegExp = /^(?:[a-z0-9]+:)?grid-cols-(\d+)$/;

// The grid the row's cards sit in.
function recentGrid(name: string = "Recent"): HTMLElement {
  const firstCard: HTMLElement = within(recentRow(name)).getAllByRole(
    "option",
  )[0]!;
  return firstCard.parentElement as HTMLElement;
}

// The row the keyboard cursor is on, read the way assistive technology does.
function cursorText(): string {
  const id: string | null = search().getAttribute("aria-activedescendant");
  expect(id).not.toBeNull();
  const element: HTMLElement | null = document.getElementById(id!);
  expect(element).not.toBeNull();
  if (element!.getAttribute("role") === "option") {
    return element!.querySelector("span.truncate")?.textContent ?? "";
  }
  return `heading:${element!.textContent}`;
}

beforeAll(() => {
  Element.prototype.scrollIntoView = (): void => {};
});

beforeEach(() => {
  window.localStorage.clear();
  goTo("/p/home");
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
});

describe.each(MENU_KINDS)(
  "the Recently visited row, in %s",
  (_kind: string, categoriesOpenByDefault: Array<string> | undefined) => {
    function renderMenu(
      props: Partial<React.ComponentProps<typeof NavBarMenuModal>> = {},
    ): ReturnType<typeof render> {
      return render(
        <NavBarMenuModal
          items={CATALOG}
          categoriesOpenByDefault={categoriesOpenByDefault}
          onClose={() => {}}
          {...props}
        />,
      );
    }

    test("seven remembered: the row draws the newest six as cards, the newest first", () => {
      remember(SEVEN);

      renderMenu();

      expect(recentTitles()).toEqual(SEVEN.slice(0, 6));
      expect(within(recentRow()).getAllByRole("option")).toHaveLength(
        RECENT_PRODUCTS_SHOWN,
      );
      // Each card is a link to its product.
      expect(
        within(recentRow())
          .getAllByRole("link")
          .map((link: HTMLElement): string | null => {
            return link.getAttribute("href");
          }),
      ).toEqual(SEVEN.slice(0, 6).map(routeOf));
    });

    test("the Dashboard's label names the row", () => {
      remember(SEVEN);

      renderMenu({ recentLabel: "Recently visited" });

      expect(
        screen.getByRole("heading", { level: 3, name: "Recently visited" }),
      ).toBeVisible();
      expect(recentTitles("Recently visited")).toEqual(SEVEN.slice(0, 6));
    });

    test("on the page of a remembered product, it is left out and the seventh takes its place", () => {
      remember(SEVEN);
      goTo("/p/users/42");

      renderMenu();

      expect(recentTitles()).toEqual([
        "Kubernetes",
        "Logs",
        "Alerts",
        "Traces",
        "Teams",
        "Metrics",
      ]);
    });

    test("on the page of the newest product, the six before it are shown", () => {
      remember(SEVEN);
      goTo("/p/kubernetes");

      renderMenu();

      expect(recentTitles()).toEqual(SEVEN.slice(1));
    });

    test("fewer than six remembered: the row draws them all, and nothing else", () => {
      remember(["Teams", "Hosts", "Monitors"]);

      renderMenu();

      expect(recentTitles()).toEqual(["Teams", "Hosts", "Monitors"]);
    });

    test("nothing remembered: there is no row", () => {
      renderMenu();

      expect(screen.queryByRole("group", { name: "Recent" })).toBeNull();
      expect(
        screen.queryByRole("heading", { level: 3, name: "Recent" }),
      ).toBeNull();
    });

    test("only the page the user is on remembered: there is no row", () => {
      remember(["Logs"]);
      goTo("/p/logs");

      renderMenu();

      expect(screen.queryByRole("group", { name: "Recent" })).toBeNull();
    });

    test("a list of five stored before the row grew: five cards, or four on the page of one", () => {
      const old: Array<string> = ["Logs", "Users", "Alerts", "Traces", "Teams"];
      remember(old);

      const { unmount } = renderMenu();
      expect(recentTitles()).toEqual(old);
      unmount();

      goTo("/p/alerts");
      renderMenu();
      expect(recentTitles()).toEqual(["Logs", "Users", "Traces", "Teams"]);
    });

    test("another project's products and the Admin Dashboard's pages are skipped, and the row still fills", () => {
      rememberRoutes([
        routeOf("Kubernetes"),
        "/dashboard/7d2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b/monitors",
        "/admin/users",
        routeOf("Logs"),
        routeOf("Users"),
        "/p/a-product-that-is-gone",
        routeOf("Alerts"),
        routeOf("Traces"),
        "/admin/settings",
        routeOf("Teams"),
        routeOf("Metrics"),
      ]);

      renderMenu();

      expect(recentTitles()).toEqual(SEVEN.slice(0, 6));
    });

    test("an address stored twice is one card, and every card has a key of its own", () => {
      const consoleError: Mock<(...args: Array<unknown>) => void> =
        jest.fn<(...args: Array<unknown>) => void>();
      jest.spyOn(console, "error").mockImplementation(consoleError);
      rememberRoutes([
        routeOf("Logs"),
        routeOf("Logs"),
        routeOf("Users"),
        routeOf("Logs"),
        42,
        null,
        routeOf("Users"),
        routeOf("Alerts"),
      ]);

      renderMenu();

      expect(recentTitles()).toEqual(["Logs", "Users", "Alerts"]);
      // React warns about two cards with one key, which breaks the cursor.
      expect(
        consoleError.mock.calls.filter((args: Array<unknown>): boolean => {
          return String(args[0]).includes(
            "Encountered two children with the same key",
          );
        }),
      ).toEqual([]);
    });

    test("a damaged stored value draws no row, and the menu still works", () => {
      window.localStorage.setItem(RECENT_PRODUCTS_STORAGE_KEY, "[oops");

      renderMenu();

      expect(screen.queryByRole("group", { name: "Recent" })).toBeNull();
      expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
    });

    test("the six cards fill every row of the row's grid: three to a row on a desktop, two below 1024px", () => {
      remember(SEVEN);

      renderMenu();

      const grid: HTMLElement = recentGrid();
      const columns: Array<number> = Array.from(grid.classList).flatMap(
        (token: string): Array<number> => {
          const match: RegExpExecArray | null = GRID_COLUMNS_CLASS.exec(token);
          return match ? [Number(match[1])] : [];
        },
      );

      // One column on a phone, two from sm and three from lg.
      expect(grid).toHaveClass(
        "grid-cols-1",
        "sm:grid-cols-2",
        "lg:grid-cols-3",
      );
      expect(columns).toEqual([1, 2, 3]);
      const cards: number = within(grid).getAllByRole("option").length;
      expect(cards).toBe(6);
      for (const count of columns) {
        expect([count, cards % count]).toEqual([count, 0]);
      }
    });

    test("search hides the row, and clearing it brings back all six", () => {
      remember(SEVEN);
      renderMenu();

      fireEvent.change(search(), { target: { value: "kube" } });

      expect(screen.queryByRole("group", { name: "Recent" })).toBeNull();
      expect(titlesIn(screen.getByRole("listbox"))).toEqual(["Kubernetes"]);

      fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

      expect(recentTitles()).toEqual(SEVEN.slice(0, 6));
    });

    test("the cursor starts on the newest card, and the arrow keys walk all six", () => {
      remember(SEVEN);
      renderMenu();

      expect(cursorText()).toBe("Kubernetes");
      for (const title of SEVEN.slice(1, 6)) {
        press("ArrowRight");
        expect(cursorText()).toBe(title);
      }

      // Past the sixth card, the cursor leaves the row for the first category.
      press("ArrowRight");
      expect(cursorText()).toBe(
        categoriesOpenByDefault ? "heading:Essentials" : "Monitors",
      );

      // And back: the sixth card is the row's last stop.
      press("ArrowLeft");
      expect(cursorText()).toBe("Teams");
    });

    test("Enter on the sixth card opens it and puts it first in the list", () => {
      const onClose: Mock<() => void> = jest.fn<() => void>();
      remember(SEVEN);
      renderMenu({ onClose });

      for (let step: number = 0; step < 5; step++) {
        press("ArrowRight");
      }
      expect(cursorText()).toBe("Teams");

      press("Enter");

      expect(Navigation.navigate).toHaveBeenCalledWith(new Route("/p/teams"));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(stored()).toEqual(
        [
          "Teams",
          "Kubernetes",
          "Logs",
          "Users",
          "Alerts",
          "Traces",
          "Metrics",
        ].map(routeOf),
      );
    });

    test("a click on a card opens it and puts it first in the list", () => {
      remember(SEVEN);
      renderMenu();

      fireEvent.click(
        within(recentRow()).getByRole("link", { name: /^Alerts/ }),
      );

      expect(Navigation.navigate).toHaveBeenCalledWith(new Route("/p/alerts"));
      expect(stored()![0]).toBe(routeOf("Alerts"));
      expect(stored()).toHaveLength(SEVEN.length);
    });
  },
);

/*
 * Where the menu opens. The list scrolls to the keyboard cursor, so a cursor
 * that started on the current page's product (Teams, Logs, Kubernetes: low
 * in the list) scrolled the six recent cards out of sight on most product
 * pages. With a Recently visited row, the cursor starts on its first card,
 * the product used before this one, and Enter goes back, as switching apps
 * does. Without a row, the menu still opens where the user is.
 */
describe.each(MENU_KINDS)(
  "where the menu opens, in %s",
  (_kind: string, categoriesOpenByDefault: Array<string> | undefined) => {
    function renderMenu(
      props: Partial<React.ComponentProps<typeof NavBarMenuModal>> = {},
    ): ReturnType<typeof render> {
      return render(
        <NavBarMenuModal
          items={CATALOG}
          categoriesOpenByDefault={categoriesOpenByDefault}
          onClose={() => {}}
          {...props}
        />,
      );
    }

    // The product card the cursor is on, by its title.
    function cursorCard(): HTMLElement {
      const option: HTMLElement = screen.getByRole("option", {
        selected: true,
      });
      expect(search()).toHaveAttribute("aria-activedescendant", option.id);
      return option;
    }

    test("on a product's page, the cursor starts on the newest recent card, not on the page's own product", () => {
      remember(SEVEN);
      // Hosts is not remembered, and sits low in the list.
      goTo("/p/hosts/42");

      renderMenu();

      expect(cursorText()).toBe("Kubernetes");
      expect(recentRow()).toContainElement(cursorCard());
      // The page's own product is still drawn, with its dot, under its category.
      const hosts: HTMLElement = screen.getByRole("option", { name: /^Hosts/ });
      expect(hosts).toHaveAttribute("aria-selected", "false");
      expect(hosts.querySelector("span.rounded-full")).not.toBeNull();
    });

    test("Enter right away opens the product used before this one", () => {
      const onClose: Mock<() => void> = jest.fn<() => void>();
      remember(SEVEN);
      // On the newest product's page, the one before it is first in the row.
      goTo("/p/kubernetes");

      renderMenu({ onClose });
      expect(cursorText()).toBe("Logs");

      press("Enter");

      expect(Navigation.navigate).toHaveBeenCalledWith(new Route("/p/logs"));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(stored()!.slice(0, 2)).toEqual([
        routeOf("Logs"),
        routeOf("Kubernetes"),
      ]);
    });

    test("the list scrolls to the recent row's first card, never down to the page's own product", () => {
      const scrolledTo: Array<string> = [];
      const original: typeof Element.prototype.scrollIntoView =
        Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (this: Element): void {
        scrolledTo.push(
          this.querySelector("span.truncate")?.textContent ??
            this.textContent ??
            "",
        );
      };

      try {
        remember(SEVEN);
        goTo("/p/hosts/42");

        renderMenu();
      } finally {
        Element.prototype.scrollIntoView = original;
      }

      expect(scrolledTo.length).toBeGreaterThan(0);
      expect(new Set(scrolledTo)).toEqual(new Set(["Kubernetes"]));
    });

    test("with nothing remembered, the menu still opens on the page's own product", () => {
      goTo("/p/hosts/42");

      renderMenu();

      expect(screen.queryByRole("group", { name: "Recent" })).toBeNull();
      expect(cursorText()).toBe("Hosts");
    });

    test("with only the page's own product remembered there is no row, and the menu opens on that product", () => {
      remember(["Hosts"]);
      goTo("/p/hosts/42");

      renderMenu();

      expect(screen.queryByRole("group", { name: "Recent" })).toBeNull();
      expect(cursorText()).toBe("Hosts");
    });

    test("a search moves the cursor to its first result, and clearing it puts the cursor back on the newest recent card", () => {
      remember(SEVEN);
      goTo("/p/hosts/42");
      renderMenu();

      fireEvent.change(search(), { target: { value: "metr" } });
      expect(cursorText()).toBe("Metrics");

      fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
      expect(cursorText()).toBe("Kubernetes");
      expect(recentRow()).toContainElement(cursorCard());
    });

    test("the arrow keys still reach the page's own product from the row", () => {
      remember(["Logs", "Users"]);
      goTo("/p/teams");
      renderMenu();
      expect(cursorText()).toBe("Logs");

      // Teams is the last product of the list; the cursor walks there.
      const visited: Array<string> = [cursorText()];
      for (let step: number = 0; step < 40; step++) {
        press("ArrowRight");
        visited.push(cursorText());
        if (cursorText() === "Teams") {
          break;
        }
      }

      expect(visited[visited.length - 1]).toBe("Teams");
    });
  },
);

describe("what opening products from the menu leaves in the row", () => {
  function renderDashboardMenu(): ReturnType<typeof render> {
    return render(
      <NavBarMenuModal
        items={CATALOG}
        categoriesOpenByDefault={["Essentials"]}
        recentLabel="Recently visited"
        onClose={() => {}}
      />,
    );
  }

  // Open a product the way someone does: search for it, then Enter.
  function openFromMenu(title: string): void {
    const { unmount } = renderDashboardMenu();
    fireEvent.change(search(), { target: { value: title } });
    expect(screen.getByRole("option", { selected: true })).toHaveTextContent(
      title,
    );
    press("Enter");
    unmount();
    // The app follows the link to the product's page.
    goTo(routeOf(title));
  }

  test("after seven products, the menu on the seventh's page shows the six before it", () => {
    const opened: Array<string> = [
      "Monitors",
      "Incidents",
      "Alerts",
      "Logs",
      "Traces",
      "Hosts",
      "Users",
    ];

    for (const title of opened) {
      openFromMenu(title);
    }

    renderDashboardMenu();

    expect(recentTitles("Recently visited")).toEqual([
      "Hosts",
      "Traces",
      "Logs",
      "Alerts",
      "Incidents",
      "Monitors",
    ]);
    expect(stored()).toEqual([...opened].reverse().map(routeOf));
  });

  test("the row grows card by card up to six, and then stays at six", () => {
    const opened: Array<string> = [
      "Monitors",
      "Incidents",
      "Alerts",
      "Logs",
      "Traces",
      "Hosts",
      "Users",
      "Teams",
      "Kubernetes",
    ];
    const shown: Array<number> = [];

    for (const title of opened) {
      openFromMenu(title);
      // Back on Home, nothing is the page the user is on.
      goTo("/p/home");
      const { unmount } = renderDashboardMenu();
      shown.push(titlesIn(recentRow("Recently visited")).length);
      unmount();
    }

    expect(shown).toEqual([1, 2, 3, 4, 5, 6, 6, 6, 6]);
  });

  test("opening a product again moves it to the front without a second card", () => {
    for (const title of ["Monitors", "Incidents", "Alerts", "Monitors"]) {
      openFromMenu(title);
    }
    goTo("/p/home");

    renderDashboardMenu();

    expect(recentTitles("Recently visited")).toEqual([
      "Monitors",
      "Alerts",
      "Incidents",
    ]);
  });

  test("the browser keeps twenty products at most", () => {
    const others: Array<string> = Array.from(
      { length: RECENT_PRODUCTS_REMEMBERED },
      (_: unknown, index: number): string => {
        return `/dashboard/7d2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b/product-${index}`;
      },
    );
    rememberRoutes(others);

    openFromMenu("Logs");

    expect(stored()).toEqual([
      routeOf("Logs"),
      ...others.slice(0, RECENT_PRODUCTS_REMEMBERED - 1),
    ]);
  });
});

/*
 * The Admin Dashboard's menu shows its six products at once, every category
 * open. A Recently visited row there drew the same cards a second time,
 * above themselves (#4922's follow-up), so a menu that folds nothing has no
 * row, opens where the user is, and remembers nothing for one.
 */
describe("a menu that shows every category", () => {
  function renderOpenMenu(): ReturnType<typeof render> {
    return render(
      <NavBarMenuModal
        items={CATALOG}
        categoriesOpenByDefault={undefined}
        recentLabel="Recently visited"
        onClose={() => {}}
      />,
    );
  }

  test("draws no Recently visited row, however many products are remembered", () => {
    remember(SEVEN);

    renderOpenMenu();

    expect(
      screen.queryByRole("group", { name: "Recently visited" }),
    ).toBeNull();
    expect(screen.queryByRole("group", { name: "Recent" })).toBeNull();
    // Each product is drawn once.
    const titles: Array<string> = screen
      .getAllByRole("option")
      .map((option: HTMLElement): string => {
        return option.querySelector("span.truncate")?.textContent ?? "";
      });
    expect(titles).toEqual(
      CATALOG.map((item: MoreMenuItem): string => {
        return item.title;
      }),
    );
  });

  test("opens with the cursor on the page's own product", () => {
    remember(SEVEN);
    goTo(routeOf("Logs"));

    renderOpenMenu();

    const option: HTMLElement = screen.getByRole("option", { selected: true });
    expect(option.querySelector("span.truncate")?.textContent).toBe("Logs");
  });

  test("opening a product from it leaves the remembered list as it was", () => {
    remember(["Monitors", "Incidents"]);
    const before: Array<string> | null = stored();

    renderOpenMenu();
    fireEvent.change(search(), { target: { value: "Teams" } });
    press("Enter");

    expect(stored()).toEqual(before);
  });
});
