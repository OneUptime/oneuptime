import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import { MoreMenuItem } from "../../../UI/Components/Navbar/NavBar";
import NavBarMenuModal from "../../../UI/Components/Navbar/NavBarMenuModal";

/*
 * THE PRODUCTS MENU'S SEARCH BOX HAS A NAME OF ITS OWN (#7486).
 *
 * A screen reader named the box by its placeholder ("Search products…",
 * "Search admin…"), with the "…" that prompts typing. A menu now hands the
 * box its name (searchLabel) apart from its placeholder: the Dashboard
 * "Search products", the Admin Dashboard "Search admin". A menu that hands
 * no name is named by its placeholder as before, and one with neither by
 * "Search products".
 */

const ITEMS: Array<MoreMenuItem> = [
  {
    title: "Monitors",
    description: "Check uptime and availability.",
    route: new Route("/products/monitors"),
    icon: IconProp.AltGlobe,
    category: "Essentials",
  },
];

beforeAll(() => {
  Element.prototype.scrollIntoView = (): void => {};
});

afterEach(() => {
  cleanup();
});

describe("the products menu's search box", () => {
  test("is named by its label, and prompts with its placeholder", () => {
    render(
      <NavBarMenuModal
        items={ITEMS}
        onClose={() => {}}
        searchPlaceholder="Search products…"
        searchLabel="Search products"
      />,
    );

    const box: HTMLElement = screen.getByRole("combobox");
    expect(box).toHaveAccessibleName("Search products");
    expect(box).toHaveAttribute("placeholder", "Search products…");
  });

  test("the Admin Dashboard's: Search admin, without the ellipsis", () => {
    render(
      <NavBarMenuModal
        items={ITEMS}
        onClose={() => {}}
        searchPlaceholder="Search admin…"
        searchLabel="Search admin"
      />,
    );

    expect(screen.getByRole("combobox")).toHaveAccessibleName("Search admin");
  });

  test("without a label, it is named by its placeholder, as before", () => {
    render(
      <NavBarMenuModal
        items={ITEMS}
        onClose={() => {}}
        searchPlaceholder="Find a product…"
      />,
    );

    expect(screen.getByRole("combobox")).toHaveAccessibleName(
      "Find a product…",
    );
  });

  test("with neither, it is named Search products", () => {
    render(<NavBarMenuModal items={ITEMS} onClose={() => {}} />);

    expect(screen.getByRole("combobox")).toHaveAccessibleName(
      "Search products",
    );
  });
});
