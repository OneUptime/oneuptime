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
import { SpyInstance } from "jest-mock";
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
  isCategoryFoldRemembered,
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
 * categories are open (the ones a menu opens on, the Dashboard's
 * Essentials, every time it opens), and the per-browser memory of what
 * someone opened or folded among the others. The menus that draw them are
 * covered in NavBarMenuFolding.test.tsx (desktop), NavBar.test.tsx and
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

describe("which choices are remembered", () => {
  test("never one about a category the menu opens on; about every other one, always", () => {
    expect(isCategoryFoldRemembered("Essentials", foldState({}))).toBe(false);
    for (const category of ["Observability", "Infrastructure", "Other"]) {
      expect([
        category,
        isCategoryFoldRemembered(category, foldState({})),
      ]).toEqual([category, true]);
    }
  });

  test("a menu can open on several categories, and remembers nothing about any of them", () => {
    const state: CategoryFoldState = foldState({
      openByDefault: ["Essentials", "Settings"],
    });

    expect(isCategoryFoldRemembered("Essentials", state)).toBe(false);
    expect(isCategoryFoldRemembered("Settings", state)).toBe(false);
    expect(isCategoryFoldRemembered("Infrastructure", state)).toBe(true);
  });

  test("names are matched exactly, as the catalog spells them", () => {
    expect(isCategoryFoldRemembered("essentials", foldState({}))).toBe(true);
    expect(isCategoryFoldRemembered("Essentials ", foldState({}))).toBe(true);
  });

  test("where the user is, or what they chose, never decides what is remembered", () => {
    expect(
      isCategoryFoldRemembered(
        "Essentials",
        foldState({
          holdingCurrentPage: ["Essentials"],
          remembered: new Map([["Essentials", false]]),
          chosenNow: new Map([["Essentials", false]]),
        }),
      ),
    ).toBe(false);
    expect(
      isCategoryFoldRemembered(
        "Infrastructure",
        foldState({
          holdingCurrentPage: ["Infrastructure"],
          chosenNow: new Map([["Infrastructure", true]]),
        }),
      ),
    ).toBe(true);
  });

  test("a menu that opens on no category remembers every choice", () => {
    for (const category of ["Essentials", "Observability"]) {
      expect([
        category,
        isCategoryFoldRemembered(category, foldState({ openByDefault: [] })),
      ]).toEqual([category, true]);
    }
  });
});

describe("whether a category is open", () => {
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

  test("a remembered choice opens or folds a category the menu does not open on", () => {
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

  test("the essentials are open when the menu opens, whatever was remembered or visited", () => {
    // A fold remembered from when a fold of the essentials was remembered.
    expect(
      isCategoryOpen(
        "Essentials",
        foldState({ remembered: new Map([["Essentials", false]]) }),
      ),
    ).toBe(true);
    expect(
      isCategoryOpen(
        "Essentials",
        foldState({
          holdingCurrentPage: ["Infrastructure"],
          remembered: new Map([["Essentials", false]]),
        }),
      ),
    ).toBe(true);
  });

  test("a fold of the essentials made in this menu folds them, and opening them again opens them", () => {
    expect(
      isCategoryOpen(
        "Essentials",
        foldState({ chosenNow: new Map([["Essentials", false]]) }),
      ),
    ).toBe(false);
    expect(
      isCategoryOpen(
        "Essentials",
        foldState({
          remembered: new Map([["Essentials", false]]),
          chosenNow: new Map([["Essentials", true]]),
        }),
      ),
    ).toBe(true);
  });

  test("a fold of the essentials made in this menu holds on one of their own pages too", () => {
    expect(
      isCategoryOpen(
        "Essentials",
        foldState({
          holdingCurrentPage: ["Essentials"],
          chosenNow: new Map([["Essentials", false]]),
        }),
      ),
    ).toBe(false);
  });

  test("every category a menu opens on is open, until it is folded in this menu", () => {
    const state: CategoryFoldState = foldState({
      openByDefault: ["Essentials", "Settings"],
      remembered: new Map([
        ["Essentials", false],
        ["Settings", false],
      ]),
    });

    expect(isCategoryOpen("Essentials", state)).toBe(true);
    expect(isCategoryOpen("Settings", state)).toBe(true);
    expect(isCategoryOpen("Observability", state)).toBe(false);
    expect(
      isCategoryOpen("Settings", {
        ...state,
        chosenNow: new Map([["Settings", false]]),
      }),
    ).toBe(false);
  });

  test("with nothing to open on, every category starts folded", () => {
    expect(
      ["Essentials", "Observability"].map((category: string): boolean => {
        return isCategoryOpen(category, foldState({ openByDefault: [] }));
      }),
    ).toEqual([false, false]);
  });

  test("with nothing to open on, a remembered choice holds for the essentials too", () => {
    expect(
      isCategoryOpen(
        "Essentials",
        foldState({
          openByDefault: [],
          remembered: new Map([["Essentials", true]]),
        }),
      ),
    ).toBe(true);
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
      expect([category, current().isOpen(category)]).toEqual([category, true]);
    }

    act(() => {
      current().toggle("Observability");
      current().toggle("Essentials");
    });

    expect(current().isOpen("Observability")).toBe(true);
    expect(current().isOpen("Essentials")).toBe(true);
    expect(storedFolds()).toBeNull();
  });

  test("a menu that names its categories opens on them and folds the rest", () => {
    render(<Probe items={CATALOG} openByDefault={["Essentials"]} />);

    expect(current().isEnabled).toBe(true);
    expect(current().isOpen("Essentials")).toBe(true);
    for (const category of ["Observability", "Infrastructure", "Other"]) {
      expect([category, current().isOpen(category)]).toEqual([category, false]);
    }
  });

  test("the essentials fold and open again in this menu, and nothing is stored", () => {
    render(<Probe items={CATALOG} openByDefault={["Essentials"]} />);

    act(() => {
      current().toggle("Essentials");
    });
    expect(current().isOpen("Essentials")).toBe(false);
    expect(storedFolds()).toBeNull();

    act(() => {
      current().toggle("Essentials");
    });
    expect(current().isOpen("Essentials")).toBe(true);
    expect(storedFolds()).toBeNull();
  });

  test("the next menu opens on the essentials again, however this one left them", () => {
    const { unmount } = render(
      <Probe items={CATALOG} openByDefault={["Essentials"]} />,
    );
    act(() => {
      current().toggle("Essentials");
    });
    expect(current().isOpen("Essentials")).toBe(false);
    unmount();

    render(<Probe items={CATALOG} openByDefault={["Essentials"]} />);

    expect(current().isOpen("Essentials")).toBe(true);
    expect(storedFolds()).toBeNull();
  });

  test("folding the essentials leaves what is stored for the other categories as it was", () => {
    window.localStorage.setItem(
      CATEGORY_FOLDS_STORAGE_KEY,
      JSON.stringify({ Infrastructure: true, Observability: false }),
    );
    render(<Probe items={CATALOG} openByDefault={["Essentials"]} />);

    act(() => {
      current().toggle("Essentials");
    });
    act(() => {
      current().toggle("Essentials");
    });
    act(() => {
      current().toggle("Essentials");
    });

    expect(current().isOpen("Essentials")).toBe(false);
    expect(storedFolds()).toEqual({
      Infrastructure: true,
      Observability: false,
    });
  });

  test("a fold of the essentials remembered on this browser is ignored, and left as it is", () => {
    // What the menu stored when a fold of the essentials was remembered.
    window.localStorage.setItem(
      CATEGORY_FOLDS_STORAGE_KEY,
      JSON.stringify({ Essentials: false, Infrastructure: true }),
    );

    render(<Probe items={CATALOG} openByDefault={["Essentials"]} />);

    expect(current().isOpen("Essentials")).toBe(true);
    // The other remembered choices still hold.
    expect(current().isOpen("Infrastructure")).toBe(true);
    expect(current().isOpen("Observability")).toBe(false);

    // Opening and folding the essentials neither rewrites nor drops it.
    act(() => {
      current().toggle("Essentials");
    });
    act(() => {
      current().toggle("Essentials");
    });
    expect(current().isOpen("Essentials")).toBe(true);
    expect(storedFolds()).toEqual({ Essentials: false, Infrastructure: true });
  });

  test("a menu that opens on several categories opens on each of them every time", () => {
    window.localStorage.setItem(
      CATEGORY_FOLDS_STORAGE_KEY,
      JSON.stringify({ Observability: false }),
    );
    const { unmount } = render(
      <Probe items={CATALOG} openByDefault={["Essentials", "Observability"]} />,
    );

    expect(current().isOpen("Essentials")).toBe(true);
    expect(current().isOpen("Observability")).toBe(true);
    expect(current().isOpen("Infrastructure")).toBe(false);

    act(() => {
      current().toggle("Observability");
    });
    expect(current().isOpen("Observability")).toBe(false);
    unmount();

    expect(storedFolds()).toEqual({ Observability: false });

    render(
      <Probe items={CATALOG} openByDefault={["Essentials", "Observability"]} />,
    );
    expect(current().isOpen("Observability")).toBe(true);
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

  test("the next menu starts from what was remembered, with the essentials open", () => {
    const { unmount } = render(
      <Probe items={CATALOG} openByDefault={["Essentials"]} />,
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
    expect(current().isOpen("Essentials")).toBe(false);
    unmount();

    expect(storedFolds()).toEqual({
      Infrastructure: true,
      Observability: false,
    });

    render(<Probe items={CATALOG} openByDefault={["Essentials"]} />);

    expect(current().isOpen("Infrastructure")).toBe(true);
    expect(current().isOpen("Observability")).toBe(false);
    expect(current().isOpen("Essentials")).toBe(true);
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

  test("on one of the essentials' own pages, folding them holds for this menu only", () => {
    goTo("/p/incidents/1");
    const { unmount } = render(
      <Probe items={CATALOG} openByDefault={["Essentials"]} />,
    );

    expect(current().isOpen("Essentials")).toBe(true);
    act(() => {
      current().toggle("Essentials");
    });
    expect(current().isOpen("Essentials")).toBe(false);
    unmount();

    render(<Probe items={CATALOG} openByDefault={["Essentials"]} />);
    expect(current().isOpen("Essentials")).toBe(true);
    expect(storedFolds()).toBeNull();
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
    expect(current().isOpen("Essentials")).toBe(true);
    act(() => {
      current().toggle("Observability");
      current().toggle("Essentials");
    });
    expect(current().isOpen("Observability")).toBe(true);
    expect(current().isOpen("Essentials")).toBe(false);
  });

  test("folding the essentials never touches storage at all", () => {
    const getItem: SpyInstance<StorageMethods["getItem"]> = jest.spyOn(
      STORAGE_METHODS,
      "getItem",
    );
    render(<Probe items={CATALOG} openByDefault={["Essentials"]} />);
    // Read once, when the menu opened.
    expect(getItem).toHaveBeenCalledTimes(1);

    const setItem: SpyInstance<StorageMethods["setItem"]> = jest.spyOn(
      STORAGE_METHODS,
      "setItem",
    );
    act(() => {
      current().toggle("Essentials");
    });

    expect(getItem).toHaveBeenCalledTimes(1);
    expect(setItem).not.toHaveBeenCalled();
  });
});
