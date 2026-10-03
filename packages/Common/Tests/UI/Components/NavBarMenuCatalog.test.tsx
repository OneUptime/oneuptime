import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render } from "@testing-library/react";
import React from "react";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import {
  MoreMenuItem,
  isMoreMenuItemActive as isMoreMenuItemActiveFromNavBar,
} from "../../../UI/Components/Navbar/NavBar";
import {
  CATEGORY_FOLDS_STORAGE_KEY,
  CategoryFoldState,
  CategoryFolds,
  MenuCategory,
  UNCATEGORIZED_TITLE,
  categoryOf,
  groupItemsByCategory,
  isCategoryOpen,
  isMoreMenuItemActive,
  readRememberedCategoryFolds,
  rememberCategoryFold,
  useCategoryFolds,
} from "../../../UI/Components/Navbar/NavBarMenuCatalog";
import Navigation from "../../../UI/Utils/Navigation";

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

/*
 * The products menu's catalog rules, on their own: grouping, which category
 * starts folded, and the per-browser memory of what someone opened or
 * folded. The menus that draw them are covered in NavBarMenuFolding.test.tsx
 * (desktop) and NavBarMobileMenuFolding.test.tsx (phone).
 */

function item(
  title: string,
  category: string | undefined,
  path: string,
): MoreMenuItem {
  return {
    title,
    description: `${title} description.`,
    route: new Route(path),
    icon: IconProp.Cube,
    ...(category ? { category } : {}),
  };
}

const MONITORS: MoreMenuItem = item("Monitors", "Essentials", "/p/monitors");
const LOGS: MoreMenuItem = item("Logs", "Observability", "/p/logs");
const INCIDENTS: MoreMenuItem = item("Incidents", "Essentials", "/p/incidents");
const HOSTS: MoreMenuItem = item("Hosts", "Infrastructure", "/p/hosts");
const TRACES: MoreMenuItem = item("Traces", "Observability", "/p/traces");
const REPORTS: MoreMenuItem = item("Reports", undefined, "/p/reports");

const CATALOG: Array<MoreMenuItem> = [
  MONITORS,
  LOGS,
  INCIDENTS,
  HOSTS,
  TRACES,
  REPORTS,
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

function storedFolds(): unknown {
  const raw: string | null = window.localStorage.getItem(
    CATEGORY_FOLDS_STORAGE_KEY,
  );
  return raw === null ? null : JSON.parse(raw);
}

function foldState(overrides: Partial<CategoryFoldState>): CategoryFoldState {
  return {
    openByDefault: ["Essentials"],
    holdingCurrentPage: [],
    remembered: new Map(),
    chosenNow: new Map(),
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  goTo("/p/home");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
});

describe("grouping products by category", () => {
  test("keeps the catalog's own order of categories and of products", () => {
    const groups: Array<MenuCategory> = groupItemsByCategory(CATALOG);

    expect(
      groups.map((group: MenuCategory): [string, Array<string>] => {
        return [
          group.title,
          group.items.map((entry: MoreMenuItem): string => {
            return entry.title;
          }),
        ];
      }),
    ).toEqual([
      ["Essentials", ["Monitors", "Incidents"]],
      ["Observability", ["Logs", "Traces"]],
      ["Infrastructure", ["Hosts"]],
      [UNCATEGORIZED_TITLE, ["Reports"]],
    ]);
  });

  test("a product without a category is listed under Other", () => {
    expect(UNCATEGORIZED_TITLE).toBe("Other");
    expect(categoryOf(REPORTS)).toBe("Other");
    expect(categoryOf(LOGS)).toBe("Observability");
  });

  test("an empty catalog has no categories", () => {
    expect(groupItemsByCategory([])).toEqual([]);
  });
});

describe("which product is the page the user is on", () => {
  test("NavBar still exports the same function its callers import", () => {
    expect(isMoreMenuItemActiveFromNavBar).toBe(isMoreMenuItemActive);
  });

  test("matches the product's active route, or its route when it has none", () => {
    const exceptions: MoreMenuItem = {
      ...item("Exceptions", "Observability", "/p/exceptions/unresolved"),
      activeRoute: new Route("/p/exceptions"),
    };

    goTo("/p/exceptions/overview");
    expect(isMoreMenuItemActive(exceptions)).toBe(true);
    expect(isMoreMenuItemActive(LOGS)).toBe(false);

    goTo("/p/logs/view/1");
    expect(isMoreMenuItemActive(LOGS)).toBe(true);
  });

  test("matches any of the product's additional active routes", () => {
    const tasks: MoreMenuItem = {
      ...item("Tasks", "Code", "/p/ai/agents"),
      additionalActiveRoutes: [new Route("/p/code-repository")],
    };

    goTo("/p/code-repository/1");
    expect(isMoreMenuItemActive(tasks)).toBe(true);

    goTo("/p/home");
    expect(isMoreMenuItemActive(tasks)).toBe(false);
  });
});

describe("whether a category starts open", () => {
  test("only the categories the menu opens on start open", () => {
    expect(isCategoryOpen("Essentials", foldState({}))).toBe(true);
    expect(isCategoryOpen("Observability", foldState({}))).toBe(false);
    expect(isCategoryOpen("Unknown", foldState({}))).toBe(false);
  });

  test("the category holding the current page opens by itself", () => {
    expect(
      isCategoryOpen(
        "Infrastructure",
        foldState({ holdingCurrentPage: ["Infrastructure"] }),
      ),
    ).toBe(true);
  });

  test("a remembered choice beats the default, both ways", () => {
    const remembered: Map<string, boolean> = new Map([
      ["Infrastructure", true],
      ["Essentials", false],
    ]);

    expect(isCategoryOpen("Infrastructure", foldState({ remembered }))).toBe(
      true,
    );
    expect(isCategoryOpen("Essentials", foldState({ remembered }))).toBe(false);
  });

  test("the current page beats a remembered fold, so the menu shows where the user is", () => {
    expect(
      isCategoryOpen(
        "Infrastructure",
        foldState({
          holdingCurrentPage: ["Infrastructure"],
          remembered: new Map([["Infrastructure", false]]),
        }),
      ),
    ).toBe(true);
  });

  test("a choice made in this menu beats everything else", () => {
    expect(
      isCategoryOpen(
        "Infrastructure",
        foldState({
          holdingCurrentPage: ["Infrastructure"],
          remembered: new Map([["Infrastructure", true]]),
          chosenNow: new Map([["Infrastructure", false]]),
        }),
      ),
    ).toBe(false);
    expect(
      isCategoryOpen(
        "Observability",
        foldState({ chosenNow: new Map([["Observability", true]]) }),
      ),
    ).toBe(true);
  });
});

describe("remembering folds on this browser", () => {
  test("nothing stored reads as no choices", () => {
    expect(readRememberedCategoryFolds().size).toBe(0);
  });

  test("a stored choice is merged with the ones already there", () => {
    rememberCategoryFold("Infrastructure", true);
    rememberCategoryFold("Essentials", false);
    rememberCategoryFold("Infrastructure", false);

    expect(storedFolds()).toEqual({ Infrastructure: false, Essentials: false });
    expect(Array.from(readRememberedCategoryFolds().entries())).toEqual([
      ["Infrastructure", false],
      ["Essentials", false],
    ]);
  });

  test.each([
    ["not JSON", "{oops"],
    ["a list", JSON.stringify(["Infrastructure"])],
    ["a number", "42"],
    ["null", "null"],
  ])(
    "a damaged value (%s) reads as no choices",
    (_label: string, raw: string) => {
      window.localStorage.setItem(CATEGORY_FOLDS_STORAGE_KEY, raw);

      expect(readRememberedCategoryFolds().size).toBe(0);
    },
  );

  test("only true/false values are read", () => {
    window.localStorage.setItem(
      CATEGORY_FOLDS_STORAGE_KEY,
      JSON.stringify({
        Infrastructure: true,
        Observability: "yes",
        Code: 1,
        AI: null,
        Settings: false,
      }),
    );

    expect(Array.from(readRememberedCategoryFolds().entries())).toEqual([
      ["Infrastructure", true],
      ["Settings", false],
    ]);
  });

  test("a category named like an object property is just a name", () => {
    window.localStorage.setItem(
      CATEGORY_FOLDS_STORAGE_KEY,
      '{"__proto__": true, "constructor": false}',
    );

    const folds: Map<string, boolean> = readRememberedCategoryFolds();

    expect(folds.get("__proto__")).toBe(true);
    expect(folds.get("constructor")).toBe(false);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  test("writing over a damaged value replaces it with a sound one", () => {
    window.localStorage.setItem(CATEGORY_FOLDS_STORAGE_KEY, "{oops");

    rememberCategoryFold("Code", true);

    expect(storedFolds()).toEqual({ Code: true });
  });

  test("storage that refuses to be read means the defaults, not a crash", () => {
    window.localStorage.setItem(
      CATEGORY_FOLDS_STORAGE_KEY,
      JSON.stringify({ Infrastructure: true }),
    );
    expect(readRememberedCategoryFolds().size).toBe(1);

    jest.spyOn(STORAGE_METHODS, "getItem").mockImplementation((): never => {
      throw new Error("SecurityError: storage is disabled");
    });

    expect(readRememberedCategoryFolds().size).toBe(0);
  });

  test("storage that refuses a write is ignored", () => {
    jest.spyOn(STORAGE_METHODS, "setItem").mockImplementation((): never => {
      throw new Error("QuotaExceededError");
    });

    expect(() => {
      rememberCategoryFold("Code", true);
    }).not.toThrow();
    expect(STORAGE_METHODS.setItem).toHaveBeenCalledWith(
      CATEGORY_FOLDS_STORAGE_KEY,
      JSON.stringify({ Code: true }),
    );
    expect(storedFolds()).toBeNull();
  });
});

describe("the fold state of one open menu", () => {
  let folds: CategoryFolds | undefined;

  const Probe: React.FunctionComponent<{
    items: Array<MoreMenuItem>;
    openByDefault?: Array<string> | undefined;
  }> = (props: {
    items: Array<MoreMenuItem>;
    openByDefault?: Array<string> | undefined;
  }): React.ReactElement => {
    folds = useCategoryFolds(props.items, props.openByDefault);
    return <></>;
  };

  function current(): CategoryFolds {
    expect(folds).toBeDefined();
    return folds!;
  }

  beforeEach(() => {
    folds = undefined;
  });

  test("a menu that names no categories folds nothing and stores nothing", () => {
    render(<Probe items={CATALOG} />);

    expect(current().isEnabled).toBe(false);
    for (const category of ["Essentials", "Observability", "Other"]) {
      expect(current().isOpen(category)).toBe(true);
    }

    act(() => {
      current().toggle("Observability");
    });

    expect(current().isOpen("Observability")).toBe(true);
    expect(storedFolds()).toBeNull();
  });

  test("a menu that names its categories opens on them and folds the rest", () => {
    render(<Probe items={CATALOG} openByDefault={["Essentials"]} />);

    expect(current().isEnabled).toBe(true);
    expect(current().isOpen("Essentials")).toBe(true);
    expect(current().isOpen("Observability")).toBe(false);
    expect(current().isOpen("Infrastructure")).toBe(false);
    expect(current().isOpen("Other")).toBe(false);
  });

  test("toggling opens a folded category, folds it again, and remembers both", () => {
    render(<Probe items={CATALOG} openByDefault={["Essentials"]} />);

    act(() => {
      current().toggle("Observability");
    });
    expect(current().isOpen("Observability")).toBe(true);
    expect(storedFolds()).toEqual({ Observability: true });

    act(() => {
      current().toggle("Observability");
    });
    expect(current().isOpen("Observability")).toBe(false);
    expect(storedFolds()).toEqual({ Observability: false });
  });

  test("the next menu starts from what was remembered", () => {
    const { unmount } = render(
      <Probe items={CATALOG} openByDefault={["Essentials"]} />,
    );
    act(() => {
      current().toggle("Infrastructure");
      current().toggle("Essentials");
    });
    unmount();

    render(<Probe items={CATALOG} openByDefault={["Essentials"]} />);

    expect(current().isOpen("Infrastructure")).toBe(true);
    expect(current().isOpen("Essentials")).toBe(false);
  });

  test("an open menu reads the memory once, when it opens", () => {
    render(<Probe items={CATALOG} openByDefault={["Essentials"]} />);

    window.localStorage.setItem(
      CATEGORY_FOLDS_STORAGE_KEY,
      JSON.stringify({ Infrastructure: true }),
    );

    expect(current().isOpen("Infrastructure")).toBe(false);
  });

  test("the category of the page the user is on opens by itself, without being remembered", () => {
    goTo("/p/hosts/overview");

    render(<Probe items={CATALOG} openByDefault={["Essentials"]} />);

    expect(current().isOpen("Infrastructure")).toBe(true);
    expect(storedFolds()).toBeNull();
  });

  test("folding the current page's category works in this menu, and it opens again next time", () => {
    goTo("/p/hosts/overview");
    const { unmount } = render(
      <Probe items={CATALOG} openByDefault={["Essentials"]} />,
    );

    act(() => {
      current().toggle("Infrastructure");
    });
    expect(current().isOpen("Infrastructure")).toBe(false);
    expect(storedFolds()).toEqual({ Infrastructure: false });
    unmount();

    render(<Probe items={CATALOG} openByDefault={["Essentials"]} />);
    expect(current().isOpen("Infrastructure")).toBe(true);

    // On any other page the remembered fold holds.
    cleanup();
    goTo("/p/home");
    render(<Probe items={CATALOG} openByDefault={["Essentials"]} />);
    expect(current().isOpen("Infrastructure")).toBe(false);
  });

  test("a menu whose storage is blocked still folds and opens while it is open", () => {
    jest.spyOn(STORAGE_METHODS, "getItem").mockImplementation((): never => {
      throw new Error("SecurityError");
    });
    jest.spyOn(STORAGE_METHODS, "setItem").mockImplementation((): never => {
      throw new Error("SecurityError");
    });

    render(<Probe items={CATALOG} openByDefault={["Essentials"]} />);

    expect(current().isOpen("Observability")).toBe(false);
    act(() => {
      current().toggle("Observability");
    });
    expect(current().isOpen("Observability")).toBe(true);
  });
});
