import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import { MoreMenuItem } from "../../../UI/Components/Navbar/NavBar";
import {
  RECENT_PRODUCTS_REMEMBERED,
  RECENT_PRODUCTS_SHOWN,
  RECENT_PRODUCTS_STORAGE_KEY,
  doesMenuShowRecentProducts,
  getVisitedProductRoute,
  pickRecentProducts,
  readRecentProductRoutes,
  rememberRecentProductRoute,
} from "../../../UI/Components/Navbar/NavBarRecentProducts";

/*
 * The products menu's "Recently visited" row, on its own: what the browser
 * remembers, and which of it the row shows.
 *
 * A customer asked for six recent products instead of four, "since you have
 * the real-estate and 4 items shown now take up 2 rows anyway": the menu
 * draws three cards to a row, and the row kept five products at most,
 * leaving out the page the user was on, so it usually showed four - a full
 * row and one card alone under it. Six fill two rows of three. The menu that
 * draws the row is covered in NavBarMenuRecentProducts.test.tsx, the real
 * Dashboard catalog in App/Dashboard/DashboardRecentProducts.test.tsx, and a
 * real browser's layout in E2E/NavigationSearch/RecentProducts.spec.ts.
 */

/*
 * Storage's string index signature makes @jest/globals type a spy on
 * Storage.prototype as never; spy through its two methods instead.
 */
interface StorageMethods {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

const STORAGE_METHODS: StorageMethods =
  Storage.prototype as unknown as StorageMethods;

const PROJECT: string = "/dashboard/8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const OTHER_PROJECT: string = "/dashboard/7d2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

function product(title: string, path: string): MoreMenuItem {
  return {
    title,
    description: `${title} does its job.`,
    route: new Route(`${PROJECT}/${path}`),
    icon: IconProp.Cube,
  };
}

// Ten products of one project, as a Dashboard menu lists them.
const CATALOG: Array<MoreMenuItem> = [
  product("Monitors", "monitors"),
  product("Incidents", "incidents"),
  product("Alerts", "alerts"),
  product("On-Call Duty", "on-call-duty"),
  product("Status Pages", "status-pages"),
  product("Logs", "logs"),
  product("Traces", "traces"),
  product("Metrics", "metrics"),
  product("Kubernetes", "kubernetes"),
  product("Users", "users"),
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

function routesOf(titles: Array<string>): Array<string> {
  return titles.map(routeOf);
}

function titlesOf(items: Array<MoreMenuItem>): Array<string> {
  return items.map((item: MoreMenuItem): string => {
    return item.title;
  });
}

function store(value: unknown): void {
  window.localStorage.setItem(
    RECENT_PRODUCTS_STORAGE_KEY,
    typeof value === "string" ? value : JSON.stringify(value),
  );
}

function stored(): unknown {
  const raw: string | null = window.localStorage.getItem(
    RECENT_PRODUCTS_STORAGE_KEY,
  );
  return raw === null ? null : JSON.parse(raw);
}

// No product is the page the user is on (they are on Home).
function onHome(): boolean {
  return false;
}

// The user is on the page of the product with this title.
function onPageOf(title: string): (item: MoreMenuItem) => boolean {
  return (item: MoreMenuItem): boolean => {
    return item.title === title;
  };
}

// Distinct addresses of products this menu does not list.
function otherRoutes(count: number): Array<string> {
  return Array.from({ length: count }, (_: unknown, index: number): string => {
    return `${OTHER_PROJECT}/product-${index}`;
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
  window.localStorage.clear();
});

describe("how many recent products the row shows and the browser remembers", () => {
  test("the row shows six: two full rows of three cards", () => {
    expect(RECENT_PRODUCTS_SHOWN).toBe(6);
    // The menu draws three cards to a row on a desktop, two below 1024px.
    expect(RECENT_PRODUCTS_SHOWN % 3).toBe(0);
    expect(RECENT_PRODUCTS_SHOWN % 2).toBe(0);
  });

  test("the browser remembers more than the row shows, so leaving the current page out still fills it", () => {
    expect(RECENT_PRODUCTS_REMEMBERED).toBeGreaterThanOrEqual(
      RECENT_PRODUCTS_SHOWN + 1,
    );
  });

  test("what the browser remembers stays a short list", () => {
    expect(RECENT_PRODUCTS_REMEMBERED).toBe(20);
  });

  test("lists stored before the row grew are read from the same place", () => {
    expect(RECENT_PRODUCTS_STORAGE_KEY).toBe(
      "oneuptime-navbar-recent-products",
    );
  });
});

describe("reading what the browser remembers", () => {
  test("nothing stored reads as no recent products", () => {
    expect(readRecentProductRoutes()).toEqual([]);
  });

  test("a list of five, stored before the row grew, reads as it is", () => {
    const routes: Array<string> = routesOf([
      "Logs",
      "Monitors",
      "Users",
      "Alerts",
      "Traces",
    ]);
    store(routes);

    expect(readRecentProductRoutes()).toEqual(routes);
  });

  test.each([
    ["not JSON", "[oops"],
    ["an object", JSON.stringify({ 0: `${PROJECT}/logs` })],
    ["a number", "42"],
    ["a string", JSON.stringify(`${PROJECT}/logs`)],
    ["null", "null"],
    ["an empty string", ""],
  ])(
    "a damaged value (%s) reads as no recent products",
    (_label: string, raw: string) => {
      store(raw);

      expect(readRecentProductRoutes()).toEqual([]);
    },
  );

  test("only addresses are read: anything else in the list is skipped", () => {
    store([
      routeOf("Logs"),
      42,
      null,
      { route: routeOf("Users") },
      [routeOf("Alerts")],
      true,
      routeOf("Monitors"),
    ]);

    expect(readRecentProductRoutes()).toEqual(routesOf(["Logs", "Monitors"]));
  });

  test("an address listed twice is read once, where it was most recent", () => {
    store(routesOf(["Logs", "Monitors", "Logs", "Users", "Monitors"]));

    expect(readRecentProductRoutes()).toEqual(
      routesOf(["Logs", "Monitors", "Users"]),
    );
  });

  test("a list longer than the limit reads as its newest twenty addresses", () => {
    const routes: Array<string> = otherRoutes(RECENT_PRODUCTS_REMEMBERED + 15);
    store(routes);

    expect(readRecentProductRoutes()).toEqual(
      routes.slice(0, RECENT_PRODUCTS_REMEMBERED),
    );
  });

  test("duplicates do not count towards the limit", () => {
    const routes: Array<string> = otherRoutes(RECENT_PRODUCTS_REMEMBERED);
    store([routes[0], routes[0], routes[0], ...routes.slice(1)]);

    expect(readRecentProductRoutes()).toEqual(routes);
  });

  test("storage that refuses to be read means no recent products, not a crash", () => {
    store(routesOf(["Logs"]));
    expect(readRecentProductRoutes()).toEqual(routesOf(["Logs"]));

    jest.spyOn(STORAGE_METHODS, "getItem").mockImplementation((): never => {
      throw new Error("SecurityError: storage is disabled");
    });

    expect(readRecentProductRoutes()).toEqual([]);
  });
});

describe("remembering a product opened from the menu", () => {
  test("the first product opened is the whole list", () => {
    rememberRecentProductRoute(routeOf("Logs"));

    expect(stored()).toEqual(routesOf(["Logs"]));
  });

  test("the newest product goes first, and the others keep their order", () => {
    for (const title of ["Monitors", "Incidents", "Alerts"]) {
      rememberRecentProductRoute(routeOf(title));
    }

    expect(stored()).toEqual(routesOf(["Alerts", "Incidents", "Monitors"]));
  });

  test("opening a remembered product again moves it to the front, once", () => {
    store(routesOf(["Alerts", "Incidents", "Monitors"]));

    rememberRecentProductRoute(routeOf("Monitors"));

    expect(stored()).toEqual(routesOf(["Monitors", "Alerts", "Incidents"]));
  });

  test("opening the newest product again changes nothing", () => {
    store(routesOf(["Alerts", "Incidents", "Monitors"]));

    rememberRecentProductRoute(routeOf("Alerts"));

    expect(stored()).toEqual(routesOf(["Alerts", "Incidents", "Monitors"]));
  });

  test("a list of five, stored before the row grew, now grows past five", () => {
    const old: Array<string> = routesOf([
      "Logs",
      "Monitors",
      "Users",
      "Alerts",
      "Traces",
    ]);
    store(old);

    rememberRecentProductRoute(routeOf("Metrics"));
    rememberRecentProductRoute(routeOf("Kubernetes"));

    expect(stored()).toEqual([...routesOf(["Kubernetes", "Metrics"]), ...old]);
  });

  test("the browser keeps the newest twenty, and forgets the oldest", () => {
    const routes: Array<string> = otherRoutes(RECENT_PRODUCTS_REMEMBERED + 5);

    for (const route of routes) {
      rememberRecentProductRoute(route);
    }

    const expected: Array<string> = [...routes]
      .reverse()
      .slice(0, RECENT_PRODUCTS_REMEMBERED);
    expect(stored()).toEqual(expected);
    expect(stored()).not.toContain(routes[0]);
  });

  test("a full list stays full: one in, the oldest out", () => {
    const routes: Array<string> = otherRoutes(RECENT_PRODUCTS_REMEMBERED);
    store(routes);

    rememberRecentProductRoute(routeOf("Logs"));

    expect(stored()).toEqual([
      routeOf("Logs"),
      ...routes.slice(0, RECENT_PRODUCTS_REMEMBERED - 1),
    ]);
  });

  test("another project's products and the Admin Dashboard's pages are kept", () => {
    const remembered: Array<string> = [
      `${OTHER_PROJECT}/monitors`,
      "/admin/users",
      routeOf("Logs"),
      "/admin/settings",
    ];
    store(remembered);

    rememberRecentProductRoute(routeOf("Alerts"));

    expect(stored()).toEqual([routeOf("Alerts"), ...remembered]);
  });

  test("an over-long list stored by something else is cut to twenty", () => {
    const routes: Array<string> = otherRoutes(RECENT_PRODUCTS_REMEMBERED * 3);
    store(routes);

    rememberRecentProductRoute(routeOf("Logs"));

    expect(stored()).toEqual([
      routeOf("Logs"),
      ...routes.slice(0, RECENT_PRODUCTS_REMEMBERED - 1),
    ]);
  });

  test("writing over a damaged value replaces it with a sound list", () => {
    store("{oops");

    rememberRecentProductRoute(routeOf("Logs"));

    expect(stored()).toEqual(routesOf(["Logs"]));
  });

  test("anything but addresses is dropped from the list on the next write", () => {
    store([routeOf("Logs"), 7, null, routeOf("Logs"), routeOf("Users")]);

    rememberRecentProductRoute(routeOf("Alerts"));

    expect(stored()).toEqual(routesOf(["Alerts", "Logs", "Users"]));
  });

  test("storage that refuses a write is ignored", () => {
    jest.spyOn(STORAGE_METHODS, "setItem").mockImplementation((): never => {
      throw new Error("QuotaExceededError");
    });

    expect(() => {
      rememberRecentProductRoute(routeOf("Logs"));
    }).not.toThrow();
    expect(STORAGE_METHODS.setItem).toHaveBeenCalledWith(
      RECENT_PRODUCTS_STORAGE_KEY,
      JSON.stringify(routesOf(["Logs"])),
    );
    expect(stored()).toBeNull();
  });

  test("storage that refuses to be read still takes the newest product", () => {
    store(routesOf(["Users"]));
    jest.spyOn(STORAGE_METHODS, "getItem").mockImplementationOnce((): never => {
      throw new Error("SecurityError: storage is disabled");
    });

    expect(() => {
      rememberRecentProductRoute(routeOf("Logs"));
    }).not.toThrow();
    expect(stored()).toEqual(routesOf(["Logs"]));
  });
});

describe("which remembered products the row shows", () => {
  test("six, the most recent first, when seven or more are remembered", () => {
    const titles: Array<string> = [
      "Logs",
      "Monitors",
      "Users",
      "Alerts",
      "Traces",
      "Metrics",
      "Kubernetes",
      "Incidents",
    ];

    expect(
      titlesOf(pickRecentProducts(routesOf(titles), CATALOG, onHome)),
    ).toEqual(titles.slice(0, 6));
  });

  test("never more than six, however many are remembered", () => {
    const everything: Array<string> = titlesOf(CATALOG);

    expect(
      pickRecentProducts(routesOf(everything), CATALOG, onHome),
    ).toHaveLength(RECENT_PRODUCTS_SHOWN);
  });

  test("the product of the page the user is on is left out, and the seventh takes its place", () => {
    const titles: Array<string> = [
      "Logs",
      "Monitors",
      "Users",
      "Alerts",
      "Traces",
      "Metrics",
      "Kubernetes",
    ];

    expect(
      titlesOf(
        pickRecentProducts(routesOf(titles), CATALOG, onPageOf("Users")),
      ),
    ).toEqual([
      "Logs",
      "Monitors",
      "Alerts",
      "Traces",
      "Metrics",
      "Kubernetes",
    ]);
  });

  test("on the page of the newest product, the next six are shown", () => {
    const titles: Array<string> = [
      "Logs",
      "Monitors",
      "Users",
      "Alerts",
      "Traces",
      "Metrics",
      "Kubernetes",
    ];

    expect(
      titlesOf(pickRecentProducts(routesOf(titles), CATALOG, onPageOf("Logs"))),
    ).toEqual(titles.slice(1));
  });

  test("fewer than six remembered: all of them, nothing added", () => {
    const titles: Array<string> = ["Kubernetes", "Status Pages", "Users"];

    expect(
      titlesOf(pickRecentProducts(routesOf(titles), CATALOG, onHome)),
    ).toEqual(titles);
  });

  test("a list of five stored before the row grew shows five, or four on the page of one", () => {
    const old: Array<string> = [
      "Logs",
      "Monitors",
      "Users",
      "Alerts",
      "Traces",
    ];

    expect(
      titlesOf(pickRecentProducts(routesOf(old), CATALOG, onHome)),
    ).toEqual(old);
    expect(
      titlesOf(pickRecentProducts(routesOf(old), CATALOG, onPageOf("Users"))),
    ).toEqual(["Logs", "Monitors", "Alerts", "Traces"]);
  });

  test("nothing remembered, nothing shown", () => {
    expect(pickRecentProducts([], CATALOG, onHome)).toEqual([]);
  });

  test("an empty menu shows nothing, whatever is remembered", () => {
    expect(pickRecentProducts(routesOf(["Logs", "Users"]), [], onHome)).toEqual(
      [],
    );
  });

  test("addresses this menu does not list are skipped, and later products fill the row", () => {
    const routes: Array<string> = [
      routeOf("Logs"),
      `${OTHER_PROJECT}/monitors`,
      "/admin/users",
      routeOf("Monitors"),
      `${PROJECT}/a-product-that-is-gone`,
      routeOf("Users"),
      routeOf("Alerts"),
      "/admin/settings",
      routeOf("Traces"),
      routeOf("Metrics"),
      routeOf("Kubernetes"),
    ];

    expect(titlesOf(pickRecentProducts(routes, CATALOG, onHome))).toEqual([
      "Logs",
      "Monitors",
      "Users",
      "Alerts",
      "Traces",
      "Metrics",
    ]);
  });

  test("each product is shown once, even if its address is listed twice", () => {
    const routes: Array<string> = routesOf([
      "Logs",
      "Logs",
      "Monitors",
      "Logs",
      "Users",
      "Monitors",
      "Alerts",
      "Traces",
      "Metrics",
      "Kubernetes",
    ]);

    expect(titlesOf(pickRecentProducts(routes, CATALOG, onHome))).toEqual([
      "Logs",
      "Monitors",
      "Users",
      "Alerts",
      "Traces",
      "Metrics",
    ]);
  });

  test("the order is the order they were opened in, not the catalog's", () => {
    const titles: Array<string> = ["Users", "Kubernetes", "Monitors"];

    expect(
      titlesOf(pickRecentProducts(routesOf(titles), CATALOG, onHome)),
    ).toEqual(titles);
  });

  test("the row shows the menu's own products, with their current names", () => {
    const renamed: Array<MoreMenuItem> = CATALOG.map(
      (item: MoreMenuItem): MoreMenuItem => {
        return item.title === "Logs" ? { ...item, title: "Journaux" } : item;
      },
    );

    const picked: Array<MoreMenuItem> = pickRecentProducts(
      routesOf(["Logs", "Users"]),
      renamed,
      onHome,
    );

    expect(titlesOf(picked)).toEqual(["Journaux", "Users"]);
    expect(picked[0]).toBe(renamed[5]);
  });

  test("another project's menu shows that project's products only", () => {
    const otherCatalog: Array<MoreMenuItem> = CATALOG.map(
      (item: MoreMenuItem): MoreMenuItem => {
        return {
          ...item,
          route: new Route(
            item.route.toString().replace(PROJECT, OTHER_PROJECT),
          ),
        };
      },
    );
    const routes: Array<string> = [
      `${OTHER_PROJECT}/traces`,
      routeOf("Logs"),
      `${OTHER_PROJECT}/users`,
      routeOf("Monitors"),
    ];

    expect(titlesOf(pickRecentProducts(routes, otherCatalog, onHome))).toEqual([
      "Traces",
      "Users",
    ]);
    expect(titlesOf(pickRecentProducts(routes, CATALOG, onHome))).toEqual([
      "Logs",
      "Monitors",
    ]);
  });

  test("the current page is asked about the products of the row, and nothing else", () => {
    const asked: Array<string> = [];
    const routes: Array<string> = [
      "/admin/users",
      ...routesOf(["Logs", "Monitors"]),
    ];

    pickRecentProducts(routes, CATALOG, (item: MoreMenuItem): boolean => {
      asked.push(item.title);
      return false;
    });

    expect(asked).toEqual(["Logs", "Monitors"]);
  });

  test("the row stops looking once it has six", () => {
    const asked: Array<string> = [];

    pickRecentProducts(
      routesOf(titlesOf(CATALOG)),
      CATALOG,
      (item: MoreMenuItem): boolean => {
        asked.push(item.title);
        return false;
      },
    );

    expect(asked).toHaveLength(RECENT_PRODUCTS_SHOWN);
  });
});

describe("remembering and showing together", () => {
  test("after opening seven products one after another, the menu on the seventh's page shows the six before it", () => {
    const opened: Array<string> = [
      "Monitors",
      "Incidents",
      "Alerts",
      "Logs",
      "Traces",
      "Metrics",
      "Kubernetes",
    ];

    for (const title of opened) {
      rememberRecentProductRoute(routeOf(title));
    }

    expect(
      titlesOf(
        pickRecentProducts(
          readRecentProductRoutes(),
          CATALOG,
          onPageOf("Kubernetes"),
        ),
      ),
    ).toEqual(["Metrics", "Traces", "Logs", "Alerts", "Incidents", "Monitors"]);
  });

  test("work in another project in between still leaves this project's row full", () => {
    for (const title of [
      "Monitors",
      "Incidents",
      "Alerts",
      "Logs",
      "Traces",
      "Metrics",
    ]) {
      rememberRecentProductRoute(routeOf(title));
    }
    // A day in another project, and a visit to the Admin Dashboard.
    for (const route of [
      ...otherRoutes(8),
      "/admin/users",
      "/admin/projects",
    ]) {
      rememberRecentProductRoute(route);
    }

    expect(
      titlesOf(pickRecentProducts(readRecentProductRoutes(), CATALOG, onHome)),
    ).toEqual(["Metrics", "Traces", "Logs", "Alerts", "Incidents", "Monitors"]);
  });
});

/*
 * Which menus have the row at all, and which product a page counts as.
 * The navbar remembers the product of every page it is drawn on, however
 * the user got there (#4922's follow-up), but only for a menu that draws
 * the row: one that folds its categories, as the Dashboard's.
 */
describe("which menus remember products", () => {
  test("a menu that names the categories it opens on, and so folds the rest, has the row", () => {
    expect(doesMenuShowRecentProducts(["Essentials"])).toBe(true);
    // Folding with nothing open by default still folds.
    expect(doesMenuShowRecentProducts([])).toBe(true);
  });

  test("a menu that shows every category at once has none", () => {
    expect(doesMenuShowRecentProducts(undefined)).toBe(false);
  });
});

describe("the product a page counts as (getVisitedProductRoute)", () => {
  test("is the menu's product that marks the page as its own", () => {
    expect(
      getVisitedProductRoute(CATALOG, (item: MoreMenuItem): boolean => {
        return item.title === "Logs";
      }),
    ).toBe(routeOf("Logs"));
  });

  // Logs comes before Traces in the menu.
  test("is the first such product, as the menu itself marks it", () => {
    expect(
      getVisitedProductRoute(CATALOG, (item: MoreMenuItem): boolean => {
        return item.title === "Traces" || item.title === "Logs";
      }),
    ).toBe(routeOf("Logs"));
  });

  test("is nothing on a page of no product, or in an empty menu", () => {
    expect(getVisitedProductRoute(CATALOG, onHome)).toBeUndefined();
    expect(
      getVisitedProductRoute([], (): boolean => {
        return true;
      }),
    ).toBeUndefined();
  });
});
