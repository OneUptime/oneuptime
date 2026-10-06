import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Mock } from "jest-mock";
import React from "react";
import IconProp from "../../../Types/Icon/IconProp";
import Icon from "../../../UI/Components/Icon/Icon";
import NavBarCategoryToggle, {
  CATEGORY_LIST_COLUMNS,
  ComponentProps,
  DEFAULT_CATEGORY_ICON,
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
 * open: the category's icon, its name drawn as a product's title is, what it
 * holds, how many, and a chevron. On the desktop the rows are a list whose
 * columns line up (a subgrid of the list); on a phone the row is drawn as
 * the product rows around it are.
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

// The glyph a row draws for its category: the first svg in it.
function drawnIcon(): string {
  return svgs()[0]!.innerHTML;
}

// The chevron: the last svg in the row.
function chevron(): SVGElement {
  return svgs()[svgs().length - 1]!;
}

// What <Icon icon={icon} /> draws, to compare the row's glyph against.
function glyphOf(icon: IconProp): string {
  const { container, unmount } = render(<Icon icon={icon} />);
  const markup: string = container.querySelector("svg")!.innerHTML;
  unmount();
  return markup;
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

describe("the category's icon", () => {
  test.each([[IconProp.ServerStack], [IconProp.Sparkles], [IconProp.Code]])(
    "draws %s when given it",
    (icon: IconProp) => {
      const expected: string = glyphOf(icon);

      renderRow({ icon });

      expect(drawnIcon()).toBe(expected);
    },
  );

  test("a category given no icon gets the products menu's own", () => {
    const expected: string = glyphOf(DEFAULT_CATEGORY_ICON);

    renderRow();

    expect(DEFAULT_CATEGORY_ICON).toBe(IconProp.Squares);
    expect(drawnIcon()).toBe(expected);
  });

  test("the icon is decoration: the row's name is the category's name alone", () => {
    renderRow({ icon: IconProp.ServerStack });

    expect(button()).toHaveAccessibleName("Infrastructure");
    for (const svg of svgs()) {
      expect(svg.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  test("a row draws exactly two glyphs: its icon and its chevron", () => {
    renderRow({ icon: IconProp.ServerStack });

    expect(svgs()).toHaveLength(2);
    expect(drawnIcon()).not.toBe(chevron().innerHTML);
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

  test("the list's columns are icon, name, products, count and chevron", () => {
    expect(CATEGORY_LIST_COLUMNS).toBe(
      "grid-cols-[auto_auto_minmax(0,1fr)_auto_auto]",
    );
  });

  test("its parts are in that order, and each one past the name is placed in its own column", () => {
    columnsRow({ icon: IconProp.ServerStack });

    const parts: Array<Element> = Array.from(row().children);

    expect(parts).toHaveLength(5);
    // The icon's tile.
    expect(parts[0]).toHaveClass("h-8", "w-8", "rounded-lg", "ring-1");
    expect(parts[0]).toHaveAttribute("aria-hidden", "true");
    // The name.
    expect(parts[1]!.tagName).toBe("H3");
    // The products, the count and the chevron, pinned to their columns.
    expect(parts[2]).toBe(summary());
    expect(parts[2]).toHaveClass("col-start-3", "min-w-0", "truncate");
    expect(parts[3]).toBe(countPill());
    expect(parts[3]).toHaveClass("col-start-4", "justify-self-end");
    expect(parts[4]).toHaveClass("col-start-5");
    expect(parts[4]).toContainElement(chevron() as unknown as HTMLElement);
  });

  test("open, the count and the chevron keep their columns where the products were", () => {
    columnsRow({ isOpen: true });

    const parts: Array<Element> = Array.from(row().children);

    expect(parts).toHaveLength(4);
    expect(parts[2]).toBe(countPill());
    expect(parts[2]).toHaveClass("col-start-4");
    expect(parts[3]).toHaveClass("col-start-5");
  });

  test("the name keeps some room before the products column", () => {
    columnsRow();

    expect(screen.getByRole("heading", { level: 3 })).toHaveClass("pr-3");
  });

  test("the products are one line, cut off with an ellipsis", () => {
    columnsRow();

    expect(summary()).toHaveClass("truncate", "text-sm", "text-gray-500");
  });

  test("the row has no corners or border of its own: the list draws the frame and the rules", () => {
    columnsRow();

    expect(row().className).not.toMatch(/(^|\s)rounded/);
    expect(row().className).not.toMatch(/(^|\s)border/);
    expect(button().className).not.toMatch(/after:rounded/);
  });

  test("its icon sits in a tile, as a product card's does", () => {
    columnsRow({ icon: IconProp.ServerStack });

    const tile: Element = row().children[0]!;

    expect(tile).toHaveClass("bg-gray-50", "ring-gray-200");
    expect(tile.querySelector("svg")).toHaveClass(
      "h-4",
      "w-4",
      "text-gray-500",
    );
    expect(tile.querySelector("svg")!.innerHTML).toBe(
      glyphOf(IconProp.ServerStack),
    );
  });
});

describe("on a phone (stacked, the default)", () => {
  test("is the default layout", () => {
    renderRow();

    expect(row()).toHaveClass("flex", "items-center", "rounded-md");
    expect(row()).not.toHaveClass("grid-cols-subgrid");
  });

  test("draws its icon before its name, as the product rows around it do (NavBarItem)", () => {
    renderRow({
      icon: IconProp.ServerStack,
      layout: NavBarCategoryToggleLayout.Stacked,
    });

    const heading: HTMLElement = screen.getByRole("heading", { level: 3 });
    const icon: SVGElement | null = heading.querySelector("svg");

    expect(heading).toHaveClass("flex", "items-center");
    expect(icon).not.toBeNull();
    // The same size, gap and stroke as a product row's icon.
    expect(icon).toHaveClass("mr-1", "h-4", "w-4");
    expect(icon).toHaveClass("stroke-2");
    expect(icon!.innerHTML).toBe(glyphOf(IconProp.ServerStack));
    // Before the button, not inside it: the name stays the name.
    expect(
      icon!.compareDocumentPosition(button()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(button()).toHaveClass("text-base", "font-medium");
  });

  test("has no icon tile", () => {
    renderRow({ icon: IconProp.ServerStack });

    expect(row().querySelector(".ring-1")).toBeNull();
  });

  test("lists the products on a line below the name, lined up with the name", () => {
    renderRow();

    expect(summary()).toHaveClass("block", "pl-5", "text-xs", "truncate");
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

  test("on the row, the row, its icon, its count and its chevron are lit", () => {
    renderRow({ layout: NavBarCategoryToggleLayout.Columns, isActive: true });

    const tile: Element = row().children[0]!;

    expect(row()).toHaveClass("bg-indigo-50");
    expect(row()).not.toHaveClass("hover:bg-gray-50");
    expect(tile).toHaveClass("bg-white", "ring-indigo-200");
    expect(tile.querySelector("svg")).toHaveClass("text-indigo-600");
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
