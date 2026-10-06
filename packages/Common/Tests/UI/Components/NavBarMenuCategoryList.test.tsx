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
import React from "react";
import Route from "../../../Types/API/Route";
import Dictionary from "../../../Types/Dictionary";
import IconProp from "../../../Types/Icon/IconProp";
import Icon from "../../../UI/Components/Icon/Icon";
import { MoreMenuItem } from "../../../UI/Components/Navbar/NavBar";
import {
  CATEGORY_LIST_COLUMNS,
  DEFAULT_CATEGORY_ICON,
} from "../../../UI/Components/Navbar/NavBarCategoryToggle";
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
 * The products menu's folded categories, drawn as one list.
 *
 * The menu opens on Essentials as cards and folds every other category. Each
 * folded category used to be a line of small spaced capitals (the style of
 * the Essentials heading) followed by a run-on list of its products, so the
 * bottom of the menu read as a stack of headings with nothing under them,
 * every list of products starting somewhere else.
 *
 * Now the folded categories are the rows of one bordered list below the
 * cards: each row is the category's icon, its name, the products it holds,
 * how many and a chevron, and the list's columns line every row up. An
 * opened category's products are drawn inside the list, under its row.
 */

const RECENT_STORAGE_KEY: string = "oneuptime-navbar-recent-products";

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
  product("Logs", "Observability", "/p/logs"),
  product("Traces", "Observability", "/p/traces"),
  product("Tasks", "Code", "/p/tasks"),
  product("Real User Monitoring", "Resources", "/p/rum"),
  product("Hosts", "Infrastructure", "/p/hosts"),
  product("Kubernetes", "Infrastructure", "/p/kubernetes"),
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

const CATEGORY_ICONS: Dictionary<IconProp> = {
  Observability: IconProp.PresentationChartLine,
  Code: IconProp.Code,
  Resources: IconProp.Layers,
  Infrastructure: IconProp.ServerStack,
  Settings: IconProp.Settings,
};

function renderMenu(
  props: Partial<React.ComponentProps<typeof NavBarMenuModal>> = {},
): ReturnType<typeof render> {
  return render(
    <NavBarMenuModal
      items={CATALOG}
      categoriesAlwaysOpen={["Essentials"]}
      categoryIcons={CATEGORY_ICONS}
      onClose={() => {}}
      {...props}
    />,
  );
}

function listbox(): HTMLElement {
  return screen.getByRole("listbox");
}

function search(): HTMLElement {
  return screen.getByRole("combobox");
}

function heading(category: string): HTMLElement {
  return screen.getByRole("button", { name: category });
}

// A category's row: the element its button's ::after covers.
function row(category: string): HTMLElement {
  return heading(category).closest("div.relative") as HTMLElement;
}

function group(category: string): HTMLElement {
  return screen.getByRole("group", { name: category });
}

// The lists of categories: the elements laid out on the list's columns.
function categoryLists(): Array<HTMLElement> {
  return Array.from(listbox().querySelectorAll<HTMLElement>("div")).filter(
    (element: HTMLElement): boolean => {
      return element.classList.contains(CATEGORY_LIST_COLUMNS);
    },
  );
}

// The categories in a list, by the names on their rows, in order.
function categoriesIn(list: HTMLElement): Array<string> {
  return within(list)
    .queryAllByRole("button")
    .filter((button: HTMLElement): boolean => {
      return button.hasAttribute("aria-expanded");
    })
    .map((button: HTMLElement): string => {
      return button.textContent ?? "";
    });
}

function productTitles(scope: HTMLElement): Array<string> {
  return within(scope)
    .queryAllByRole("option")
    .map((option: HTMLElement): string => {
      return option.querySelector("span.truncate")?.textContent ?? "";
    });
}

// The glyph a category's row draws for it: the first svg in the row.
function drawnIcon(category: string): string {
  return row(category).querySelector("svg")!.innerHTML;
}

function glyphOf(icon: IconProp): string {
  const { container, unmount } = render(<Icon icon={icon} />);
  const markup: string = container.querySelector("svg")!.innerHTML;
  unmount();
  return markup;
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

describe("the folded categories are one list below the cards", () => {
  test("every folded category is a row of the same list, in the catalog's order", () => {
    renderMenu();

    expect(categoryLists()).toHaveLength(1);
    expect(categoriesIn(categoryLists()[0]!)).toEqual(FOLDED_CATEGORIES);
  });

  test("the list is drawn as one bordered box with a rule between its rows", () => {
    renderMenu();

    expect(categoryLists()[0]).toHaveClass(
      "grid",
      "rounded-xl",
      "border",
      "border-gray-200",
      "divide-y",
      "divide-gray-100",
      "overflow-hidden",
    );
  });

  test("the list comes after the essentials, outside their group", () => {
    renderMenu();

    const list: HTMLElement = categoryLists()[0]!;
    const essentials: HTMLElement = group("Essentials");

    expect(essentials).not.toContainElement(list);
    expect(list).not.toContainElement(essentials);
    expect(
      essentials.compareDocumentPosition(list) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Spaced from the cards above it as one group is from the next.
    expect(list).toHaveClass("mb-6", "last:mb-1");
  });

  test("each category is still a group named by its row, and a row of the list", () => {
    renderMenu();

    const list: HTMLElement = categoryLists()[0]!;

    for (const category of FOLDED_CATEGORIES) {
      expect(group(category)).toBeInTheDocument();
      expect(group(category).parentElement).toBe(list);
      expect(group(category)).toContainElement(row(category));
    }
  });

  test("the essentials stay cards under their plain heading, out of the list", () => {
    renderMenu();

    expect(productTitles(group("Essentials"))).toEqual([
      "Monitors",
      "Incidents",
      "Alerts",
    ]);
    for (const list of categoryLists()) {
      expect(categoriesIn(list)).not.toContain("Essentials");
    }
  });
});

describe("the list's columns line every row up", () => {
  test("the list lays out the columns: icon, name, products, count, chevron", () => {
    renderMenu();

    expect(categoryLists()[0]).toHaveClass(CATEGORY_LIST_COLUMNS, "gap-x-3");
  });

  test("each category's group and row take those columns as subgrids, across the whole list", () => {
    renderMenu();

    for (const category of FOLDED_CATEGORIES) {
      expect(group(category)).toHaveClass(
        "col-span-full",
        "grid",
        "grid-cols-subgrid",
      );
      expect(row(category)).toHaveClass(
        "col-span-full",
        "grid",
        "grid-cols-subgrid",
      );
    }
  });

  test("every row places its products, count and chevron in the same columns", () => {
    renderMenu();

    for (const category of FOLDED_CATEGORIES) {
      const parts: Array<Element> = Array.from(row(category).children);

      expect([category, parts.length]).toEqual([category, 5]);
      expect(parts[2]).toHaveClass("col-start-3");
      expect(parts[3]).toHaveClass("col-start-4");
      expect(parts[4]).toHaveClass("col-start-5");
    }
  });

  test("each row says what its category holds and how many", () => {
    renderMenu();

    expect(row("Infrastructure")).toHaveTextContent(
      "Hosts, Kubernetes, Docker",
    );
    expect(heading("Infrastructure")).toHaveAccessibleDescription(
      "3 products Hosts, Kubernetes, Docker",
    );
    expect(row("Observability")).toHaveTextContent("Logs, Traces");
    expect(heading("Code")).toHaveAccessibleDescription("1 product Tasks");
  });

  test("the row names its category as a product's title is named, not in small capitals", () => {
    renderMenu();

    for (const category of FOLDED_CATEGORIES) {
      expect(heading(category)).toHaveClass("font-medium", "text-gray-900");
      expect(heading(category)).not.toHaveClass("uppercase");
    }
    // The plain heading of the essentials keeps the small capitals.
    expect(
      screen.getByRole("heading", { level: 3, name: "Essentials" }),
    ).toHaveClass("uppercase");
  });
});

describe("each row is drawn with its category's icon", () => {
  test.each(Object.entries(CATEGORY_ICONS))(
    "%s is drawn with the icon the menu was given for it",
    (category: string, icon: IconProp) => {
      const expected: string = glyphOf(icon);

      renderMenu();

      expect(drawnIcon(category)).toBe(expected);
    },
  );

  test("a category the menu was given no icon for gets the products menu's own", () => {
    const expected: string = glyphOf(DEFAULT_CATEGORY_ICON);

    renderMenu({ categoryIcons: { Observability: IconProp.Eye } });

    expect(drawnIcon("Observability")).toBe(glyphOf(IconProp.Eye));
    for (const category of FOLDED_CATEGORIES.slice(1)) {
      expect([category, drawnIcon(category)]).toEqual([category, expected]);
    }
  });

  test("with no icons at all, every row still has one", () => {
    const expected: string = glyphOf(DEFAULT_CATEGORY_ICON);

    renderMenu({ categoryIcons: undefined });

    for (const category of FOLDED_CATEGORIES) {
      expect([category, drawnIcon(category)]).toEqual([category, expected]);
    }
  });

  test("an icon given for a category that never folds draws nothing on its plain heading", () => {
    renderMenu({
      categoryIcons: { ...CATEGORY_ICONS, Essentials: IconProp.Alert },
    });

    const essentialsHeading: HTMLElement = screen.getByRole("heading", {
      level: 3,
      name: "Essentials",
    });

    expect(essentialsHeading.parentElement!.querySelector("svg")).toBeNull();
  });

  test("an icon is looked up by the category's name as the items carry it", () => {
    renderMenu({
      items: [
        product("Monitors", "Essentials", "/p/monitors"),
        product("Hôtes", "Infrastructure (FR)", "/p/hosts"),
      ],
      categoryIcons: { "Infrastructure (FR)": IconProp.ServerStack },
    });

    expect(drawnIcon("Infrastructure (FR)")).toBe(
      glyphOf(IconProp.ServerStack),
    );
  });
});

describe("an opened category is drawn inside the list", () => {
  test("its products are cards inside the list, right under its row", () => {
    renderMenu();

    fireEvent.click(heading("Infrastructure"));

    const list: HTMLElement = categoryLists()[0]!;
    const body: HTMLElement = document.getElementById(
      heading("Infrastructure").getAttribute("aria-controls")!,
    )!;

    expect(list).toContainElement(body);
    expect(body.parentElement).toBe(group("Infrastructure"));
    expect(body.previousElementSibling).toBe(row("Infrastructure"));
    expect(productTitles(body)).toEqual(["Hosts", "Kubernetes", "Docker"]);
    // It spans the whole list, inset from its frame.
    expect(body).toHaveClass("col-span-full", "px-2", "pb-2");
  });

  test("the list stays one list, the categories after it still rows of it", () => {
    renderMenu();

    fireEvent.click(heading("Code"));

    expect(categoryLists()).toHaveLength(1);
    expect(categoriesIn(categoryLists()[0]!)).toEqual(FOLDED_CATEGORIES);
  });

  test("the opened row keeps its icon and count, and drops the products it lists", () => {
    renderMenu();

    fireEvent.click(heading("Infrastructure"));

    expect(drawnIcon("Infrastructure")).toBe(glyphOf(IconProp.ServerStack));
    expect(row("Infrastructure")).toHaveTextContent(/^Infrastructure3$/);
  });

  test("the category of the current page opens inside the list, its product selected", () => {
    goTo("/p/kubernetes/clusters");

    renderMenu();

    const list: HTMLElement = categoryLists()[0]!;
    const selected: HTMLElement = screen.getByRole("option", {
      selected: true,
    });

    expect(heading("Infrastructure")).toHaveAttribute("aria-expanded", "true");
    expect(list).toContainElement(selected);
    expect(group("Infrastructure")).toContainElement(selected);
    expect(selected).toHaveTextContent("Kubernetes");
  });

  test("the keyboard walks from a row into its products and on to the next row", () => {
    renderMenu();
    // A click opens the category and puts the cursor on its row.
    fireEvent.click(heading("Observability"));

    const cursor: () => string = (): string => {
      const id: string = search().getAttribute("aria-activedescendant")!;
      const element: HTMLElement = document.getElementById(id)!;
      return element.getAttribute("role") === "option"
        ? element.querySelector("span.truncate")?.textContent ?? ""
        : `row:${element.textContent}`;
    };

    const visited: Array<string> = [cursor()];
    for (let step: number = 0; step < 3; step++) {
      fireEvent.keyDown(search(), { key: "ArrowRight" });
      visited.push(cursor());
    }
    fireEvent.keyDown(search(), { key: "ArrowLeft" });
    visited.push(cursor());

    expect(visited).toEqual([
      "row:Observability",
      "Logs",
      "Traces",
      "row:Code",
      "Traces",
    ]);
  });
});

describe("a category that never folds, between ones that do, ends one list and starts the next", () => {
  test("the order on screen stays the catalog's", () => {
    renderMenu({ categoriesAlwaysOpen: ["Essentials", "Code"] });

    const lists: Array<HTMLElement> = categoryLists();

    expect(lists).toHaveLength(2);
    expect(categoriesIn(lists[0]!)).toEqual(["Observability"]);
    expect(categoriesIn(lists[1]!)).toEqual([
      "Resources",
      "Infrastructure",
      "Settings",
    ]);

    const code: HTMLElement = group("Code");
    expect(productTitles(code)).toEqual(["Tasks"]);
    expect(
      lists[0]!.compareDocumentPosition(code) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      code.compareDocumentPosition(lists[1]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    for (const list of lists) {
      expect(list).not.toContainElement(code);
    }
  });

  test("a category that never folds at the end leaves one list before it", () => {
    renderMenu({ categoriesAlwaysOpen: ["Essentials", "Settings"] });

    expect(categoryLists()).toHaveLength(1);
    expect(categoriesIn(categoryLists()[0]!)).toEqual([
      "Observability",
      "Code",
      "Resources",
      "Infrastructure",
    ]);
    expect(productTitles(group("Settings"))).toEqual(["Users"]);
  });

  test("with nothing kept open, every category, Essentials too, is a row of one list", () => {
    renderMenu({ categoriesAlwaysOpen: ["Nothing by this name"] });

    expect(categoryLists()).toHaveLength(1);
    expect(categoriesIn(categoryLists()[0]!)).toEqual([
      "Essentials",
      ...FOLDED_CATEGORIES,
    ]);
  });
});

describe("where there is nothing folded, there is no list", () => {
  test("while searching, every match is a card under a plain heading", () => {
    renderMenu();

    fireEvent.change(search(), { target: { value: "o" } });

    expect(categoryLists()).toEqual([]);
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
  });

  test("clearing the search brings the list back", () => {
    renderMenu();

    fireEvent.change(search(), { target: { value: "kube" } });
    expect(categoryLists()).toEqual([]);

    fireEvent.change(search(), { target: { value: "" } });

    expect(categoryLists()).toHaveLength(1);
    expect(categoriesIn(categoryLists()[0]!)).toEqual(FOLDED_CATEGORIES);
  });

  test("a menu that names no categories to keep open (the Admin Dashboard's) draws no list", () => {
    renderMenu({ categoriesAlwaysOpen: undefined });

    expect(categoryLists()).toEqual([]);
    expect(productTitles(listbox())).toEqual(
      CATALOG.map((item: MoreMenuItem): string => {
        return item.title;
      }),
    );
  });

  test("the plain headings of an unfolding menu keep their own inset", () => {
    renderMenu({ categoriesAlwaysOpen: undefined });

    const essentialsHeading: HTMLElement = screen.getByRole("heading", {
      level: 3,
      name: "Essentials",
    });

    expect(essentialsHeading.parentElement).toHaveClass("px-1");
    expect(essentialsHeading.parentElement).not.toHaveClass("px-3");
  });
});

describe("the plain headings line up with the icons of the cards and rows", () => {
  test("Recent and Essentials are inset as far as a card's icon and a row's icon", () => {
    window.localStorage.setItem(
      RECENT_STORAGE_KEY,
      JSON.stringify(["/p/hosts"]),
    );
    renderMenu();

    for (const name of ["Recent", "Essentials"]) {
      // A transparent 1px border and px-3: a card's border and padding.
      expect(
        screen.getByRole("heading", { level: 3, name }).parentElement,
      ).toHaveClass("border", "border-transparent", "px-3");
    }
    // A row's icon: the list's 1px border, then the row's px-3.
    expect(row("Infrastructure")).toHaveClass("px-3");
    expect(categoryLists()[0]).toHaveClass("border");
  });

  test("Recent stays cards, above the essentials, never in the list", () => {
    window.localStorage.setItem(
      RECENT_STORAGE_KEY,
      JSON.stringify(["/p/hosts", "/p/logs"]),
    );
    renderMenu();

    const recent: HTMLElement = group("Recent");

    expect(productTitles(recent)).toEqual(["Hosts", "Logs"]);
    for (const list of categoryLists()) {
      expect(list).not.toContainElement(recent);
    }
  });
});
