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
import { CATEGORY_FOLDS_STORAGE_KEY } from "../../../UI/Components/Navbar/NavBarMenuCatalog";
import NavBarMenuModal from "../../../UI/Components/Navbar/NavBarMenuModal";
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
 * The products menu opens on the essentials instead of every product.
 *
 * The maintainer asked to "reduce decision / choice paralysis as much as
 * possible: show people as few options as possible". A menu that names the
 * categories it opens on (the Dashboard names Essentials) shows those as
 * cards and folds every other category to one line: its name, how many
 * products it holds and what they are called. Nothing is gone: a click or
 * Enter opens a category, search finds every product, the category of the
 * page the user is on opens by itself, and what someone opens or folds is
 * remembered on their browser.
 */

const RECENT_STORAGE_KEY: string = "oneuptime-navbar-recent-products";

function product(
  title: string,
  category: string,
  path: string,
  keywords?: Array<string>,
): MoreMenuItem {
  return {
    title,
    description: `${title} does its job.`,
    route: new Route(path),
    icon: IconProp.Cube,
    category,
    ...(keywords ? { keywords } : {}),
  };
}

const CATALOG: Array<MoreMenuItem> = [
  product("Monitors", "Essentials", "/p/monitors", ["uptime"]),
  product("Incidents", "Essentials", "/p/incidents", ["outage"]),
  product("Alerts", "Essentials", "/p/alerts"),
  product("Logs", "Observability", "/p/logs", ["syslog", "telemetry"]),
  product("Traces", "Observability", "/p/traces", ["spans"]),
  product("Tasks", "Code", "/p/tasks", ["github", "telemetry"]),
  product("Real User Monitoring", "Resources", "/p/rum", ["RUM"]),
  product("Hosts", "Infrastructure", "/p/hosts", ["linux", "telemetry"]),
  product("Kubernetes", "Infrastructure", "/p/kubernetes", ["k8s"]),
  product("Docker", "Infrastructure", "/p/docker"),
  product("Users", "Settings", "/p/users"),
];

const FOLDED_CATEGORIES: Array<string> = [
  "Observability",
  "Code",
  "Resources",
  "Infrastructure",
  "Settings",
];

function renderMenu(
  props: Partial<React.ComponentProps<typeof NavBarMenuModal>> = {},
): ReturnType<typeof render> {
  return render(
    <NavBarMenuModal
      items={CATALOG}
      categoriesOpenByDefault={["Essentials"]}
      onClose={() => {}}
      {...props}
    />,
  );
}

function search(): HTMLElement {
  return screen.getByRole("combobox");
}

function press(key: string): void {
  fireEvent.keyDown(search(), { key });
}

function queryFor(value: string): void {
  fireEvent.change(search(), { target: { value } });
}

function productTitles(): Array<string> {
  return screen.queryAllByRole("option").map((option: HTMLElement): string => {
    return option.querySelector("span.truncate")?.textContent ?? "";
  });
}

function heading(category: string): HTMLElement {
  return screen.getByRole("button", { name: category });
}

function categoryButtons(): Array<HTMLElement> {
  return screen
    .queryAllByRole("button")
    .filter((button: HTMLElement): boolean => {
      return button.hasAttribute("aria-expanded");
    });
}

function foldedCategories(): Array<string> {
  return categoryButtons()
    .filter((button: HTMLElement): boolean => {
      return button.getAttribute("aria-expanded") === "false";
    })
    .map((button: HTMLElement): string => {
      return button.textContent ?? "";
    });
}

// The row the keyboard cursor is on, read the way assistive technology does.
function cursor(): HTMLElement {
  const id: string | null = search().getAttribute("aria-activedescendant");
  expect(id).not.toBeNull();
  const element: HTMLElement | null = document.getElementById(id!);
  expect(element).not.toBeNull();
  return element!;
}

function cursorText(): string {
  const element: HTMLElement = cursor();
  if (element.getAttribute("role") === "option") {
    return element.querySelector("span.truncate")?.textContent ?? "";
  }
  return `heading:${element.textContent}`;
}

// The folded line of a category: the row around its heading button.
function line(category: string): HTMLElement {
  return heading(category).closest("div.relative") as HTMLElement;
}

function goTo(pathname: string): void {
  Navigation.setLocation({
    pathname,
    search: "",
    hash: "",
    state: null,
    key: "test",
  });
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

describe("the products menu opens on the essentials", () => {
  test("only the essentials are cards; every other category is one folded line", () => {
    renderMenu();

    expect(productTitles()).toEqual(["Monitors", "Incidents", "Alerts"]);
    expect(foldedCategories()).toEqual(FOLDED_CATEGORIES);
    expect(heading("Essentials")).toHaveAttribute("aria-expanded", "true");
  });

  test("a folded line names the category, counts its products and lists them", () => {
    renderMenu();

    const infrastructure: HTMLElement = line("Infrastructure");

    expect(
      within(infrastructure).getByRole("heading", { level: 3 }),
    ).toHaveTextContent(/^Infrastructure$/);
    expect(infrastructure).toHaveTextContent("3");
    expect(infrastructure).toHaveTextContent("Hosts, Kubernetes, Docker");
    // Screen readers hear the count and the names with the heading.
    expect(heading("Infrastructure")).toHaveAccessibleDescription(
      "3 products Hosts, Kubernetes, Docker",
    );
  });

  test("a category with one product says so in the singular", () => {
    renderMenu();

    expect(heading("Code")).toHaveAccessibleDescription("1 product Tasks");
  });

  test("the products of a folded category are not on screen at all", () => {
    renderMenu();

    for (const hidden of ["Logs", "Traces", "Hosts", "Kubernetes", "Users"]) {
      expect(
        screen.queryByRole("link", { name: new RegExp(`^${hidden}`) }),
      ).toBeNull();
    }
  });

  test("an open category's heading says it is open and has no summary", () => {
    renderMenu();

    expect(heading("Essentials")).not.toHaveAttribute("aria-describedby");
    expect(line("Essentials")).not.toHaveTextContent("Monitors, Incidents");
  });

  test("each category is a group named by its heading", () => {
    renderMenu();

    for (const category of ["Essentials", ...FOLDED_CATEGORIES]) {
      expect(screen.getByRole("group", { name: category })).toBeInTheDocument();
    }
    expect(
      within(screen.getByRole("group", { name: "Essentials" })).getAllByRole(
        "option",
      ),
    ).toHaveLength(3);
  });

  test("the cursor starts on the first product, never on a heading", () => {
    renderMenu();

    expect(cursorText()).toBe("Monitors");
    expect(screen.getByRole("option", { selected: true })).toHaveTextContent(
      "Monitors",
    );
  });
});

describe("opening and folding a category", () => {
  test("clicking a folded line opens it under its heading", () => {
    renderMenu();

    fireEvent.click(heading("Infrastructure"));

    expect(heading("Infrastructure")).toHaveAttribute("aria-expanded", "true");
    const body: HTMLElement = document.getElementById(
      heading("Infrastructure").getAttribute("aria-controls")!,
    )!;
    expect(
      within(body)
        .getAllByRole("link")
        .map((link: HTMLElement): string | null => {
          return link.getAttribute("href");
        }),
    ).toEqual(["/p/hosts", "/p/kubernetes", "/p/docker"]);
    expect(productTitles()).toEqual([
      "Monitors",
      "Incidents",
      "Alerts",
      "Hosts",
      "Kubernetes",
      "Docker",
    ]);
    // The cursor follows the click.
    expect(cursorText()).toBe("heading:Infrastructure");
  });

  test("clicking an open heading folds it again", () => {
    renderMenu();

    fireEvent.click(heading("Observability"));
    expect(productTitles()).toContain("Logs");

    fireEvent.click(heading("Observability"));

    expect(heading("Observability")).toHaveAttribute("aria-expanded", "false");
    expect(productTitles()).not.toContain("Logs");
  });

  test("the essentials fold like any other category", () => {
    renderMenu();

    fireEvent.click(heading("Essentials"));

    expect(productTitles()).toEqual([]);
    expect(foldedCategories()).toEqual(["Essentials", ...FOLDED_CATEGORIES]);
    expect(heading("Essentials")).toHaveAccessibleDescription(
      "3 products Monitors, Incidents, Alerts",
    );
  });

  test("a click opens a category without taking focus from the search box", () => {
    renderMenu();
    expect(search()).toHaveFocus();

    // mousedown's default (moving focus to the button) is prevented.
    expect(fireEvent.mouseDown(heading("Settings"))).toBe(false);
    fireEvent.click(heading("Settings"));

    expect(search()).toHaveFocus();
    expect(productTitles()).toContain("Users");
  });

  test("the whole line is the click target, not just the word", () => {
    renderMenu();

    expect(line("Infrastructure")).toHaveClass("relative");
    expect(heading("Infrastructure")).toHaveClass(
      "after:absolute",
      "after:inset-0",
    );
  });

  test("opening a category brings its products into view; folding one scrolls nothing", () => {
    const scrolled: Array<Element> = [];
    const originalScrollIntoView: typeof Element.prototype.scrollIntoView =
      Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element): void {
      scrolled.push(this);
    };

    try {
      renderMenu();
      fireEvent.mouseMove(line("Infrastructure"));
      scrolled.length = 0;

      fireEvent.click(heading("Infrastructure"));

      expect(scrolled).toContain(
        screen.getByRole("group", { name: "Infrastructure" }),
      );

      scrolled.length = 0;
      fireEvent.click(heading("Infrastructure"));

      expect(scrolled).toEqual([]);
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  test("every category is reachable: opening each folded line shows all of its products", () => {
    renderMenu();

    for (const category of FOLDED_CATEGORIES) {
      fireEvent.click(heading(category));
    }

    expect(foldedCategories()).toEqual([]);
    expect(productTitles()).toEqual(
      CATALOG.map((item: MoreMenuItem): string => {
        return item.title;
      }),
    );
  });
});

describe("the keyboard moves over headings and the products on screen", () => {
  test("ArrowRight walks the essentials, then the folded headings, never their hidden products", () => {
    renderMenu();

    const visited: Array<string> = [cursorText()];
    for (let step: number = 0; step < 10; step++) {
      press("ArrowRight");
      visited.push(cursorText());
    }

    expect(visited).toEqual([
      "Monitors",
      "Incidents",
      "Alerts",
      "heading:Observability",
      "heading:Code",
      "heading:Resources",
      "heading:Infrastructure",
      "heading:Settings",
      // The last row holds.
      "heading:Settings",
      "heading:Settings",
      "heading:Settings",
    ]);
  });

  test("ArrowLeft from the first product reaches the essentials' own heading", () => {
    renderMenu();

    press("ArrowLeft");

    expect(cursorText()).toBe("heading:Essentials");
    expect(cursor()).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("option", { selected: true })).toBeNull();
  });

  test("Enter on a folded heading opens it and keeps the cursor there; ArrowRight goes into it", () => {
    const onClose: Mock<() => void> = jest.fn<() => void>();
    renderMenu({ onClose });

    for (let step: number = 0; step < 6; step++) {
      press("ArrowRight");
    }
    expect(cursorText()).toBe("heading:Infrastructure");

    press("Enter");

    expect(heading("Infrastructure")).toHaveAttribute("aria-expanded", "true");
    expect(cursorText()).toBe("heading:Infrastructure");
    expect(Navigation.navigate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    press("ArrowRight");
    expect(cursorText()).toBe("Hosts");
    press("ArrowRight");
    expect(cursorText()).toBe("Kubernetes");

    press("Enter");

    expect(Navigation.navigate).toHaveBeenCalledWith(
      new Route("/p/kubernetes"),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(window.localStorage.getItem(RECENT_STORAGE_KEY)!),
    ).toEqual(["/p/kubernetes"]);
  });

  test("Enter on an open heading folds it, and the cursor stays on it", () => {
    renderMenu();

    press("ArrowLeft");
    press("Enter");

    expect(heading("Essentials")).toHaveAttribute("aria-expanded", "false");
    expect(cursorText()).toBe("heading:Essentials");

    press("ArrowRight");
    expect(cursorText()).toBe("heading:Observability");
  });

  test("ArrowLeft from a category's first product goes back to its heading", () => {
    renderMenu();
    fireEvent.click(heading("Observability"));

    press("ArrowRight");
    expect(cursorText()).toBe("Logs");

    press("ArrowLeft");
    expect(cursorText()).toBe("heading:Observability");
  });

  test("folding the category of the selected product leaves the cursor on its heading", () => {
    renderMenu();
    fireEvent.click(heading("Observability"));
    press("ArrowRight");
    press("ArrowRight");
    expect(cursorText()).toBe("Traces");

    fireEvent.click(heading("Observability"));

    expect(cursorText()).toBe("heading:Observability");
    press("ArrowRight");
    expect(cursorText()).toBe("heading:Code");
  });

  test("moving the mouse over a heading moves the cursor to it", () => {
    renderMenu();

    fireEvent.mouseMove(line("Resources"));

    expect(cursorText()).toBe("heading:Resources");
    expect(line("Resources")).toHaveClass("border-indigo-300", "bg-indigo-50");
    expect(line("Code")).toHaveClass("border-transparent");
  });

  test("the cursor on a heading points assistive technology at its button", () => {
    renderMenu();

    press("ArrowLeft");

    const id: string | null = search().getAttribute("aria-activedescendant");
    expect(id).toBe(heading("Essentials").id);
    expect(id).toMatch(/^navbar-menu-category-\d+$/);
  });
});

describe("search ignores folding", () => {
  test.each([
    ["k8s", "Kubernetes"],
    ["RUM", "Real User Monitoring"],
    ["syslog", "Logs"],
    ["users", "Users"],
    ["docker", "Docker"],
  ])(
    "%j finds %s, though its category is folded",
    (query: string, title: string) => {
      renderMenu();

      queryFor(query);

      expect(productTitles()).toEqual([title]);
      expect(cursorText()).toBe(title);
    },
  );

  test("while searching, categories are plain headings and the cursor moves over products only", () => {
    renderMenu();

    queryFor("telemetry");

    expect(categoryButtons()).toEqual([]);
    expect(
      screen
        .getAllByRole("heading", { level: 3 })
        .map((element: HTMLElement): string => {
          return element.textContent ?? "";
        }),
    ).toEqual(["Observability", "Code", "Infrastructure"]);
    expect(productTitles()).toEqual(["Logs", "Tasks", "Hosts"]);

    const visited: Array<string> = [cursorText()];
    for (let step: number = 0; step < 3; step++) {
      press("ArrowRight");
      visited.push(cursorText());
    }
    press("ArrowLeft");
    visited.push(cursorText());
    expect(visited).toEqual(["Logs", "Tasks", "Hosts", "Hosts", "Tasks"]);
  });

  test("Enter on a result opens it, wherever its category is folded", () => {
    const onClose: Mock<() => void> = jest.fn<() => void>();
    renderMenu({ onClose });

    queryFor("linux");
    press("Enter");

    expect(Navigation.navigate).toHaveBeenCalledWith(new Route("/p/hosts"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("clearing the search brings the menu back as it was, categories opened before included", () => {
    renderMenu();
    fireEvent.click(heading("Code"));

    queryFor("k8s");
    expect(productTitles()).toEqual(["Kubernetes"]);

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(search()).toHaveValue("");
    expect(foldedCategories()).toEqual(
      FOLDED_CATEGORIES.filter((category: string): boolean => {
        return category !== "Code";
      }),
    );
    expect(productTitles()).toEqual([
      "Monitors",
      "Incidents",
      "Alerts",
      "Tasks",
    ]);
    expect(cursorText()).toBe("Monitors");
  });

  test("a whitespace-only query keeps the folded menu and the recent products", () => {
    window.localStorage.setItem(
      RECENT_STORAGE_KEY,
      JSON.stringify(["/p/kubernetes"]),
    );
    renderMenu();

    queryFor(" \t ");

    expect(screen.getByRole("heading", { name: "Recent" })).toBeVisible();
    expect(productTitles()).toEqual([
      "Kubernetes",
      "Monitors",
      "Incidents",
      "Alerts",
    ]);
    expect(foldedCategories()).toEqual(FOLDED_CATEGORIES);
    expect(screen.queryByText("No results found.")).toBeNull();
  });

  test("no match still says so", () => {
    renderMenu();

    queryFor("no-such-product");

    expect(screen.getByText("No results found.")).toBeVisible();
    expect(search()).not.toHaveAttribute("aria-activedescendant");
  });
});

describe("where the user is", () => {
  test("the category of the current page opens by itself, with its product selected", () => {
    goTo("/p/kubernetes/clusters");

    renderMenu();

    expect(heading("Infrastructure")).toHaveAttribute("aria-expanded", "true");
    expect(foldedCategories()).toEqual([
      "Observability",
      "Code",
      "Resources",
      "Settings",
    ]);
    expect(cursorText()).toBe("Kubernetes");
    // Opening by itself is not a choice to remember.
    expect(window.localStorage.getItem(CATEGORY_FOLDS_STORAGE_KEY)).toBeNull();
  });

  test("the recent row is listed above the essentials and never folds", () => {
    window.localStorage.setItem(
      RECENT_STORAGE_KEY,
      JSON.stringify(["/p/hosts", "/p/logs"]),
    );

    renderMenu();

    const recent: HTMLElement = screen.getByRole("group", { name: "Recent" });
    expect(within(recent).queryByRole("button")).toBeNull();
    expect(productTitles().slice(0, 2)).toEqual(["Hosts", "Logs"]);
    // Their categories stay folded below.
    expect(foldedCategories()).toEqual(FOLDED_CATEGORIES);
    expect(cursorText()).toBe("Hosts");

    press("ArrowRight");
    expect(cursorText()).toBe("Logs");
    press("ArrowRight");
    expect(cursorText()).toBe("heading:Essentials");
  });
});

describe("what someone opens or folds is remembered on this browser", () => {
  test("a category opened in one menu is open in the next", () => {
    const { unmount } = renderMenu();
    fireEvent.click(heading("Infrastructure"));
    unmount();

    renderMenu();

    expect(heading("Infrastructure")).toHaveAttribute("aria-expanded", "true");
    expect(productTitles()).toContain("Kubernetes");
    expect(
      JSON.parse(window.localStorage.getItem(CATEGORY_FOLDS_STORAGE_KEY)!),
    ).toEqual({ Infrastructure: true });
  });

  test("a category folded in one menu is folded in the next, essentials included", () => {
    const { unmount } = renderMenu();
    fireEvent.click(heading("Essentials"));
    unmount();

    renderMenu();

    expect(heading("Essentials")).toHaveAttribute("aria-expanded", "false");
    expect(productTitles()).toEqual([]);
    // With nothing open, the cursor starts on the first heading.
    expect(cursorText()).toBe("heading:Essentials");
  });

  test("blocked storage means the defaults, and folding still works in the open menu", () => {
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError: storage is disabled");
    });
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError: storage is disabled");
    });

    renderMenu();

    expect(foldedCategories()).toEqual(FOLDED_CATEGORIES);
    fireEvent.click(heading("Settings"));
    expect(productTitles()).toContain("Users");
  });
});

describe("a menu that names no categories to open on (the Admin Dashboard's)", () => {
  test("shows every category open, under plain headings with nothing to fold", () => {
    renderMenu({ categoriesOpenByDefault: undefined });

    expect(categoryButtons()).toEqual([]);
    expect(productTitles()).toEqual(
      CATALOG.map((item: MoreMenuItem): string => {
        return item.title;
      }),
    );
  });

  test("moves the cursor over products only", () => {
    renderMenu({ categoriesOpenByDefault: undefined });

    press("ArrowLeft");
    expect(cursorText()).toBe("Monitors");
    press("ArrowRight");
    press("ArrowRight");
    press("ArrowRight");
    expect(cursorText()).toBe("Logs");
  });

  test("ignores and never writes the remembered folds", () => {
    window.localStorage.setItem(
      CATEGORY_FOLDS_STORAGE_KEY,
      JSON.stringify({ Essentials: false }),
    );

    renderMenu({ categoriesOpenByDefault: undefined });

    expect(productTitles()).toContain("Monitors");
    expect(
      JSON.parse(window.localStorage.getItem(CATEGORY_FOLDS_STORAGE_KEY)!),
    ).toEqual({ Essentials: false });
  });
});
