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
  canCategoryFold,
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
 * The products menu's catalog rules, on their own: grouping, which
 * categories fold (never the ones a menu keeps open, the Dashboard's
 * Essentials), which are open, and the per-browser memory of what someone
 * opened or folded. The menus that draw them are covered in
 * NavBarMenuFolding.test.tsx (desktop), NavBar.test.tsx and
 * App/Dashboard/DashboardPhoneProductsMenu.test.tsx (phone).
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
    alwaysOpen: ["Essentials"],
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

describe("which categories fold", () => {
  test("the categories the menu keeps open never fold; every other one does", () => {
    expect(canCategoryFold("Essentials", foldState({}))).toBe(false);
    for (const category of ["Observability", "Infrastructure", "Other"]) {
      expect([category, canCategoryFold(category, foldState({}))]).toEqual([
        category,
        true,
      ]);
    }
  });

  test("a menu can keep several categories open", () => {
    const state: CategoryFoldState = foldState({
      alwaysOpen: ["Essentials", "Settings"],
    });

    expect(canCategoryFold("Essentials", state)).toBe(false);
    expect(canCategoryFold("Settings", state)).toBe(false);
    expect(canCategoryFold("Infrastructure", state)).toBe(true);
  });

  test("names are matched exactly, as the catalog spells them", () => {
    expect(canCategoryFold("essentials", foldState({}))).toBe(true);
    expect(canCategoryFold("Essentials ", foldState({}))).toBe(true);
  });

  test("where the user is, or what they chose, never decides whether a category folds", () => {
    expect(
      canCategoryFold(
        "Essentials",
        foldState({
          holdingCurrentPage: ["Infrastructure"],
          remembered: new Map([["Essentials", false]]),
          chosenNow: new Map([["Essentials", false]]),
        }),
      ),
    ).toBe(false);
    expect(
      canCategoryFold(
        "Infrastructure",
        foldState({ holdingCurrentPage: ["Infrastructure"] }),
      ),
    ).toBe(true);
  });
});

describe("whether a category is open", () => {
  test("only the categories the menu keeps open start open", () => {
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

  test("a remembered choice opens or folds a category that folds", () => {
    const remembered: Map<string, boolean> = new Map([
      ["Infrastructure", true],
      ["Observability", false],
    ]);

    expect(isCategoryOpen("Infrastructure", foldState({ remembered }))).toBe(
      true,
    );
    expect(isCategoryOpen("Observability", foldState({ remembered }))).toBe(
      false,
    );
  });

  test("the essentials are open whatever was remembered, chosen or visited", () => {
    // A fold remembered from before the essentials were always open.
    expect(
      isCategoryOpen(
        "Essentials",
        foldState({ remembered: new Map([["Essentials", false]]) }),
      ),
    ).toBe(true);
    expect(
      isCategoryOpen(
        "Essentials",
        foldState({ chosenNow: new Map([["Essentials", false]]) }),
      ),
    ).toBe(true);
    expect(
      isCategoryOpen(
        "Essentials",
        foldState({
          holdingCurrentPage: ["Infrastructure"],
          remembered: new Map([["Essentials", false]]),
          chosenNow: new Map([["Essentials", false]]),
        }),
      ),
    ).toBe(true);
  });

  test("every category a menu keeps open is open", () => {
    const state: CategoryFoldState = foldState({
      alwaysOpen: ["Essentials", "Settings"],
      remembered: new Map([
        ["Essentials", false],
        ["Settings", false],
      ]),
    });

    expect(isCategoryOpen("Essentials", state)).toBe(true);
    expect(isCategoryOpen("Settings", state)).toBe(true);
    expect(isCategoryOpen("Observability", state)).toBe(false);
  });

  test("with nothing kept open, every category starts folded", () => {
    expect(
      ["Essentials", "Observability"].map((category: string): boolean => {
        return isCategoryOpen(category, foldState({ alwaysOpen: [] }));
      }),
    ).toEqual([false, false]);
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
    rememberCategoryFold("Settings", true);
    rememberCategoryFold("Infrastructure", false);

    expect(storedFolds()).toEqual({ Infrastructure: false, Settings: true });
    expect(Array.from(readRememberedCategoryFolds().entries())).toEqual([
      ["Infrastructure", false],
      ["Settings", true],
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
    alwaysOpen?: Array<string> | undefined;
  }> = (props: {
    items: Array<MoreMenuItem>;
    alwaysOpen?: Array<string> | undefined;
  }): React.ReactElement => {
    folds = useCategoryFolds(props.items, props.alwaysOpen);
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
      expect(current().canFold(category)).toBe(false);
    }

    act(() => {
      current().toggle("Observability");
    });

    expect(current().isOpen("Observability")).toBe(true);
    expect(storedFolds()).toBeNull();
  });

  test("a menu that names its categories keeps them open and folds the rest", () => {
    render(<Probe items={CATALOG} alwaysOpen={["Essentials"]} />);

    expect(current().isEnabled).toBe(true);
    expect(current().isOpen("Essentials")).toBe(true);
    expect(current().canFold("Essentials")).toBe(false);
    for (const category of ["Observability", "Infrastructure", "Other"]) {
      expect([category, current().isOpen(category)]).toEqual([category, false]);
      expect([category, current().canFold(category)]).toEqual([category, true]);
    }
  });

  test("the essentials cannot be folded: toggling them changes and stores nothing", () => {
    render(<Probe items={CATALOG} alwaysOpen={["Essentials"]} />);

    act(() => {
      current().toggle("Essentials");
    });
    expect(current().isOpen("Essentials")).toBe(true);

    act(() => {
      current().toggle("Essentials");
      current().toggle("Essentials");
      current().toggle("Essentials");
    });
    expect(current().isOpen("Essentials")).toBe(true);
    expect(storedFolds()).toBeNull();
  });

  test("a fold of the essentials remembered on this browser is ignored", () => {
    // What the menu stored when the essentials could still be folded.
    window.localStorage.setItem(
      CATEGORY_FOLDS_STORAGE_KEY,
      JSON.stringify({ Essentials: false, Infrastructure: true }),
    );

    render(<Probe items={CATALOG} alwaysOpen={["Essentials"]} />);

    expect(current().isOpen("Essentials")).toBe(true);
    expect(current().canFold("Essentials")).toBe(false);
    // The other remembered choices still hold.
    expect(current().isOpen("Infrastructure")).toBe(true);
    expect(current().isOpen("Observability")).toBe(false);
  });

  test("a menu that keeps several categories open never folds any of them", () => {
    window.localStorage.setItem(
      CATEGORY_FOLDS_STORAGE_KEY,
      JSON.stringify({ Observability: false }),
    );
    render(
      <Probe items={CATALOG} alwaysOpen={["Essentials", "Observability"]} />,
    );

    act(() => {
      current().toggle("Observability");
    });

    expect(current().isOpen("Essentials")).toBe(true);
    expect(current().isOpen("Observability")).toBe(true);
    expect(current().canFold("Observability")).toBe(false);
    expect(current().isOpen("Infrastructure")).toBe(false);
    expect(storedFolds()).toEqual({ Observability: false });
  });

  test("toggling opens a folded category, folds it again, and remembers both", () => {
    render(<Probe items={CATALOG} alwaysOpen={["Essentials"]} />);

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

  test("the next menu starts from what was remembered, with the essentials open", () => {
    const { unmount } = render(
      <Probe items={CATALOG} alwaysOpen={["Essentials"]} />,
    );
    act(() => {
      current().toggle("Infrastructure");
      current().toggle("Essentials");
    });
    act(() => {
      current().toggle("Observability");
    });
    act(() => {
      current().toggle("Observability");
    });
    unmount();

    expect(storedFolds()).toEqual({
      Infrastructure: true,
      Observability: false,
    });

    render(<Probe items={CATALOG} alwaysOpen={["Essentials"]} />);

    expect(current().isOpen("Infrastructure")).toBe(true);
    expect(current().isOpen("Observability")).toBe(false);
    expect(current().isOpen("Essentials")).toBe(true);
  });

  test("an open menu reads the memory once, when it opens", () => {
    render(<Probe items={CATALOG} alwaysOpen={["Essentials"]} />);

    window.localStorage.setItem(
      CATEGORY_FOLDS_STORAGE_KEY,
      JSON.stringify({ Infrastructure: true }),
    );

    expect(current().isOpen("Infrastructure")).toBe(false);
  });

  test("the category of the page the user is on opens by itself, without being remembered", () => {
    goTo("/p/hosts/overview");

    render(<Probe items={CATALOG} alwaysOpen={["Essentials"]} />);

    expect(current().isOpen("Infrastructure")).toBe(true);
    expect(storedFolds()).toBeNull();
  });

  test("folding the current page's category works in this menu, and it opens again next time", () => {
    goTo("/p/hosts/overview");
    const { unmount } = render(
      <Probe items={CATALOG} alwaysOpen={["Essentials"]} />,
    );

    act(() => {
      current().toggle("Infrastructure");
    });
    expect(current().isOpen("Infrastructure")).toBe(false);
    expect(storedFolds()).toEqual({ Infrastructure: false });
    unmount();

    render(<Probe items={CATALOG} alwaysOpen={["Essentials"]} />);
    expect(current().isOpen("Infrastructure")).toBe(true);

    // On any other page the remembered fold holds.
    cleanup();
    goTo("/p/home");
    render(<Probe items={CATALOG} alwaysOpen={["Essentials"]} />);
    expect(current().isOpen("Infrastructure")).toBe(false);
  });

  test("a menu whose storage is blocked still folds and opens while it is open", () => {
    jest.spyOn(STORAGE_METHODS, "getItem").mockImplementation((): never => {
      throw new Error("SecurityError");
    });
    jest.spyOn(STORAGE_METHODS, "setItem").mockImplementation((): never => {
      throw new Error("SecurityError");
    });

    render(<Probe items={CATALOG} alwaysOpen={["Essentials"]} />);

    expect(current().isOpen("Observability")).toBe(false);
    act(() => {
      current().toggle("Observability");
    });
    expect(current().isOpen("Observability")).toBe(true);
  });
});
