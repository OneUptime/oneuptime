import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Mock } from "jest-mock";
import React from "react";
import NavBarCategoryToggle, {
  CATEGORY_LIST_COLUMNS,
  COLUMN_PLACEMENT,
  ComponentProps,
  NavBarCategoryToggleLayout,
} from "../../../UI/Components/Navbar/NavBarCategoryToggle";

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
 * A category's row in the products menu, which folds and opens the products
 * under it.
 *
 * It used to be a line of small spaced capitals - the same style as the
 * Essentials heading - with a run-on list of products after it, so a folded
 * category read as a heading with nothing under it. It is now a row to
 * open: the category's name drawn as a product's title is, what it holds,
 * how many, and a chevron. It has no icon: it heads its products and is not
 * one of them. On the desktop the rows are a list whose columns line up (a
 * subgrid of the list); on a phone the name sits over what it holds.
 */

const HOSTS: Array<string> = ["Hosts", "Kubernetes", "Docker"];

function renderRow(props: Partial<ComponentProps> = {}): HTMLElement {
  render(
    <NavBarCategoryToggle
      title="Infrastructure"
      itemTitles={HOSTS}
      isOpen={false}
      onToggle={() => {}}
      {...props}
    />,
  );
  return row();
}

function button(): HTMLElement {
  return screen.getByRole("button", { name: "Infrastructure" });
}

// The row: the element the button's ::after covers.
function row(): HTMLElement {
  return button().closest("div.relative") as HTMLElement;
}

function summary(): HTMLElement | null {
  const id: string | null = button().getAttribute("aria-describedby");
  return id ? document.getElementById(id) : null;
}

// The count drawn on the row (hidden from screen readers, who hear it said).
function countPill(): HTMLElement {
  const pill: HTMLElement | undefined = Array.from(
    row().querySelectorAll<HTMLElement>('span[aria-hidden="true"]'),
  ).find((element: HTMLElement): boolean => {
    return element.classList.contains("rounded-full");
  });
  expect(pill).toBeDefined();
  return pill!;
}

function svgs(): Array<SVGElement> {
  return Array.from(row().querySelectorAll<SVGElement>("svg"));
}

// The chevron: the last svg in the row.
function chevron(): SVGElement {
  return svgs()[svgs().length - 1]!;
}

afterEach(() => {
  cleanup();
});

describe("a folded category row", () => {
  test("is a heading whose text is the category's name, with a button that says it is folded", () => {
    renderRow();

    expect(
      screen.getByRole("heading", { level: 3, name: "Infrastructure" }),
    ).toContainElement(button());
    expect(button()).toHaveAttribute("type", "button");
    expect(button()).toHaveAttribute("aria-expanded", "false");
    expect(button()).not.toHaveAttribute("aria-controls");
  });

  test("names what it holds, and screen readers hear the count before the names", () => {
    renderRow();

    expect(summary()).not.toBeNull();
    expect(summary()).toHaveTextContent("Hosts, Kubernetes, Docker");
    expect(button()).toHaveAccessibleDescription(
      "3 products Hosts, Kubernetes, Docker",
    );
  });

  test("a category of one product says so in the singular", () => {
    renderRow({ itemTitles: ["Tasks"] });

    expect(button()).toHaveAccessibleDescription("1 product Tasks");
  });

  test("draws the count as a pill that screen readers skip", () => {
    renderRow();

    expect(countPill()).toHaveTextContent(/^3$/);
    expect(countPill()).toHaveAttribute("aria-hidden", "true");
    expect(countPill()).toHaveClass("tabular-nums", "bg-gray-100");
  });

  test("draws its name as a product's title is, not as the small capitals of a section heading", () => {
    renderRow();

    expect(button()).toHaveClass("font-medium", "text-gray-900");
    expect(button()).not.toHaveClass("uppercase");
    expect(button().className).not.toMatch(/tracking-/);
    expect(button().className).not.toMatch(/text-\[11px\]/);
  });

  test("its chevron points right", () => {
    renderRow();

    expect(chevron()).toHaveClass("-rotate-90");
    expect(chevron()).not.toHaveClass("rotate-0");
  });

  test("a click anywhere on it is a click on its button: the button's ::after covers the row", () => {
    const onToggle: Mock<() => void> = jest.fn<() => void>();
    renderRow({ onToggle });

    expect(row()).toHaveClass("relative");
    expect(button()).toHaveClass(
      "after:absolute",
      "after:inset-0",
      "after:content-['']",
    );

    fireEvent.click(button());

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  test("the keyboard focus ring is drawn inside the row, so a list's frame cannot clip it", () => {
    renderRow({ layout: NavBarCategoryToggleLayout.Columns });

    expect(button()).toHaveClass(
      "focus:outline-none",
      "focus-visible:after:ring-2",
      "focus-visible:after:ring-inset",
      "focus-visible:after:ring-indigo-500",
    );
  });

  test("a long name wraps rather than spilling out of the row", () => {
    renderRow({ title: "Infrastructure" });

    expect(button()).toHaveClass("break-words", "min-w-0", "text-left");
  });
});

describe("an open category row", () => {
  test("says it is open and which element holds its products", () => {
    renderRow({ isOpen: true, controlsId: "the-products" });

    expect(button()).toHaveAttribute("aria-expanded", "true");
    expect(button()).toHaveAttribute("aria-controls", "the-products");
  });

  test("drops the list of products, which are right below it, and keeps its count", () => {
    renderRow({ isOpen: true });

    expect(button()).not.toHaveAttribute("aria-describedby");
    expect(row()).not.toHaveTextContent("Hosts, Kubernetes, Docker");
    expect(countPill()).toHaveTextContent(/^3$/);
  });

  test("its chevron points down", () => {
    renderRow({ isOpen: true });

    expect(chevron()).toHaveClass("rotate-0");
    expect(chevron()).not.toHaveClass("-rotate-90");
  });
});

describe("no icon for the category", () => {
  test.each([
    [NavBarCategoryToggleLayout.Columns],
    [NavBarCategoryToggleLayout.Stacked],
  ])("%s: the chevron is the row's only glyph", (layout: string) => {
    renderRow({ layout: layout as NavBarCategoryToggleLayout });

    expect(svgs()).toHaveLength(1);
    expect(svgs()[0]).toBe(chevron());
    expect(
      screen.getByRole("heading", { level: 3 }).querySelector("svg"),
    ).toBeNull();
  });

  test.each([[false], [true]])(
    "open: %s, the row draws no icon tile",
    (isOpen: boolean) => {
      renderRow({ layout: NavBarCategoryToggleLayout.Columns, isOpen });

      expect(row().querySelector(".ring-1")).toBeNull();
      expect(row().querySelector(".h-8.w-8")).toBeNull();
    },
  );

  test("the chevron is decoration: the row's name is the category's name alone", () => {
    renderRow();

    expect(button()).toHaveAccessibleName("Infrastructure");
    expect(button()).not.toContainElement(chevron() as unknown as HTMLElement);
  });
});

describe("in the desktop menu's list (columns)", () => {
  function columnsRow(props: Partial<ComponentProps> = {}): HTMLElement {
    return renderRow({ layout: NavBarCategoryToggleLayout.Columns, ...props });
  }

  test("the row takes its columns from the list, as a subgrid spanning all of them", () => {
    columnsRow();

    expect(row()).toHaveClass(
      "col-span-full",
      "grid",
      "grid-cols-subgrid",
      "items-center",
    );
    expect(row()).not.toHaveClass("flex");
  });

  test("from sm up the list's columns are name, products, count and chevron", () => {
    expect(CATEGORY_LIST_COLUMNS.split(" ")).toEqual([
      // Narrower: name over products, count, chevron.
      "grid-cols-[minmax(0,1fr)_auto_auto]",
      "sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]",
    ]);
  });

  test("its parts are in that order, and every one is placed on the list's columns", () => {
    columnsRow();

    const parts: Array<Element> = Array.from(row().children);

    expect(parts).toHaveLength(4);
    // The name, first.
    expect(parts[0]!.tagName).toBe("H3");
    expect(parts[0]).toHaveClass(COLUMN_PLACEMENT.name);
    // The products, the count and the chevron, pinned to their columns.
    expect(parts[1]).toBe(summary());
    expect(parts[1]).toHaveClass(
      COLUMN_PLACEMENT.products,
      "min-w-0",
      "truncate",
    );
    expect(parts[2]).toBe(countPill());
    expect(parts[2]).toHaveClass(COLUMN_PLACEMENT.count, "justify-self-end");
    expect(parts[3]).toHaveClass(COLUMN_PLACEMENT.chevron);
    expect(parts[3]).toContainElement(chevron() as unknown as HTMLElement);
  });

  test("from sm up, the row is one line: each part in its own column of the first row", () => {
    expect(COLUMN_PLACEMENT).toEqual({
      name: "col-start-1 row-start-1",
      products: expect.stringContaining("sm:col-start-2 sm:row-start-1"),
      count: expect.stringContaining("sm:col-start-3 sm:row-end-2"),
      chevron: expect.stringContaining("sm:col-start-4 sm:row-end-2"),
    });
  });

  test("narrower, the products go under the name, and the count and chevron sit across both lines", () => {
    const narrow: (placement: string) => Array<string> = (
      placement: string,
    ): Array<string> => {
      return placement.split(" ").filter((token: string): boolean => {
        return !token.startsWith("sm:");
      });
    };

    expect(narrow(COLUMN_PLACEMENT.name)).toEqual([
      "col-start-1",
      "row-start-1",
    ]);
    expect(narrow(COLUMN_PLACEMENT.products)).toEqual([
      "col-start-1",
      "row-start-2",
    ]);
    expect(narrow(COLUMN_PLACEMENT.count)).toEqual([
      "col-start-2",
      "row-start-1",
      "row-end-3",
    ]);
    expect(narrow(COLUMN_PLACEMENT.chevron)).toEqual([
      "col-start-3",
      "row-start-1",
      "row-end-3",
    ]);
  });

  test("every part is placed by both its column and its row, so none is left to auto-placement", () => {
    for (const placement of Object.values(COLUMN_PLACEMENT)) {
      expect(placement).toMatch(/(^|\s)col-start-\d/);
      expect(placement).toMatch(/(^|\s)row-start-\d/);
    }
  });

  test("open, the count and the chevron keep their columns where the products were", () => {
    columnsRow({ isOpen: true });

    const parts: Array<Element> = Array.from(row().children);

    expect(parts).toHaveLength(3);
    expect(parts[1]).toBe(countPill());
    expect(parts[1]).toHaveClass(COLUMN_PLACEMENT.count);
    expect(parts[2]).toHaveClass(COLUMN_PLACEMENT.chevron);
  });

  test("from sm up the name keeps some room before the products column; narrower, it needs it for itself", () => {
    columnsRow();

    const heading: HTMLElement = screen.getByRole("heading", { level: 3 });

    expect(heading).toHaveClass("sm:pr-3");
    expect(heading).not.toHaveClass("pr-3");
  });

  test("the products are one line, cut off with an ellipsis", () => {
    columnsRow();

    expect(summary()).toHaveClass("truncate", "text-sm", "text-gray-500");
    /*
     * The names are a block cut off at the column's edge, so the box a
     * click or a test finds is the box drawn, not the whole list's width.
     */
    const names: HTMLElement = screen.getByText("Hosts, Kubernetes, Docker");
    expect(names.parentElement).toBe(summary());
    expect(names).toHaveClass("block", "truncate");
  });

  test("the row has no corners or border of its own: the list draws the frame and the rules", () => {
    columnsRow();

    expect(row().className).not.toMatch(/(^|\s)rounded/);
    expect(row().className).not.toMatch(/(^|\s)border/);
    expect(button().className).not.toMatch(/after:rounded/);
  });
});

describe("on a phone (stacked, the default)", () => {
  test("is the default layout", () => {
    renderRow();

    expect(row()).toHaveClass("flex", "items-center", "rounded-md");
    expect(row()).not.toHaveClass("grid-cols-subgrid");
  });

  test("draws its name in the type of the product rows around it (NavBarItem), with no icon before it", () => {
    renderRow({ layout: NavBarCategoryToggleLayout.Stacked });

    const heading: HTMLElement = screen.getByRole("heading", { level: 3 });

    expect(heading.querySelector("svg")).toBeNull();
    expect(heading.firstElementChild).toBe(button());
    expect(button()).toHaveClass("text-base", "font-medium");
  });

  test("lists the products on a line below the name, lined up with the name", () => {
    renderRow();

    expect(summary()).toHaveClass("block", "text-xs", "truncate");
    // No icon before the name, so nothing to indent past.
    expect(summary()).not.toHaveClass("pl-5");
    // In the name's column, not beside it.
    expect(summary()!.parentElement).toBe(
      screen.getByRole("heading", { level: 3 }).parentElement,
    );
  });

  test("its count and chevron sit at the end of the row", () => {
    renderRow();

    const parts: Array<Element> = Array.from(row().children);

    expect(parts).toHaveLength(3);
    expect(parts[0]).toHaveClass("min-w-0", "flex-1");
    expect(parts[1]).toBe(countPill());
    expect(parts[2]).toContainElement(chevron() as unknown as HTMLElement);
  });

  test("its focus ring has the row's rounded corners", () => {
    renderRow();

    expect(button()).toHaveClass("after:rounded-md");
  });
});

describe("the products menu's keyboard cursor", () => {
  test("off the row, a hover lights it", () => {
    renderRow({ layout: NavBarCategoryToggleLayout.Columns });

    expect(row()).toHaveClass("hover:bg-gray-50");
    expect(row()).not.toHaveClass("bg-indigo-50");
    expect(countPill()).toHaveClass("bg-gray-100", "text-gray-600");
    expect(chevron()).toHaveClass("text-gray-400");
  });

  test("on the row, the row, its count and its chevron are lit", () => {
    renderRow({ layout: NavBarCategoryToggleLayout.Columns, isActive: true });

    expect(row()).toHaveClass("bg-indigo-50");
    expect(row()).not.toHaveClass("hover:bg-gray-50");
    expect(countPill()).toHaveClass("bg-indigo-100", "text-indigo-700");
    expect(chevron()).toHaveClass("text-indigo-500");
  });

  test("points assistive technology at the button by its id", () => {
    renderRow({ id: "navbar-menu-category-4" });

    expect(button()).toHaveAttribute("id", "navbar-menu-category-4");
  });

  test("hands the row element to the menu, to scroll it into view and find the rows around it", () => {
    let element: HTMLDivElement | null = null;

    renderRow({
      rowRef: (next: HTMLDivElement | null) => {
        element = next;
      },
    });

    expect(element).toBe(row());
  });

  test("a mouse moving over the row moves the cursor to it", () => {
    const onMouseMove: Mock<() => void> = jest.fn<() => void>();
    renderRow({ onMouseMove });

    fireEvent.mouseMove(row());

    expect(onMouseMove).toHaveBeenCalledTimes(1);
  });

  test("a click keeps focus in the search box when asked to", () => {
    renderRow({ keepsFocusOnClick: true });

    // mousedown's default (moving focus to the button) is prevented.
    expect(fireEvent.mouseDown(button())).toBe(false);
  });

  test("otherwise a click focuses the button, as any button's does", () => {
    renderRow();

    expect(fireEvent.mouseDown(button())).toBe(true);
  });
});

describe("counts are written for the reader", () => {
  test("a large count is formatted as a number", () => {
    renderRow({
      itemTitles: Array.from({ length: 1200 }, (_: unknown, index: number) => {
        return `Product ${index}`;
      }),
    });

    expect(countPill()).toHaveTextContent(/^1,200$/);
  });

  test("an empty category says it holds no products", () => {
    renderRow({ itemTitles: [] });

    expect(countPill()).toHaveTextContent(/^0$/);
    expect(button()).toHaveAccessibleDescription("0 products");
  });
});
