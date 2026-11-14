import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
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

  test("a placeholder the page words already does not take the label's place", () => {
    render(
      <NavBarMenuModal
        items={ITEMS}
        onClose={() => {}}
        searchPlaceholder="Produkte suchen…"
        isSearchPlaceholderTranslated={true}
        searchLabel="Search products"
      />,
    );

    const box: HTMLElement = screen.getByRole("combobox");
    expect(box).toHaveAccessibleName("Search products");
    expect(box).toHaveAttribute("placeholder", "Produkte suchen…");
  });
});

describe("the label, in the reader's language", () => {
  /*
   * A label handed over in English is looked up once, by the box (#7682):
   * where its translation is itself an English key ("Network" is Spanish
   * "Red", and "Red" is "Rojo"), a second lookup would say the wrong word.
   */
  async function renderWith(
    words: Record<string, string>,
    label: string,
  ): Promise<void> {
    const instance: i18n = createInstance();
    await instance.init({
      lng: "es",
      fallbackLng: false,
      resources: { es: { translation: words } },
      interpolation: { escapeValue: false },
    });

    render(
      <I18nextProvider i18n={instance}>
        <NavBarMenuModal
          items={ITEMS}
          onClose={() => {}}
          searchPlaceholder="Buscar…"
          isSearchPlaceholderTranslated={true}
          searchLabel={label}
        />
      </I18nextProvider>,
    );
  }

  test("is looked up once: the translation's own translation is never said", async () => {
    await renderWith({ Network: "Red", Red: "Rojo" }, "Network");

    expect(screen.getByRole("combobox")).toHaveAccessibleName("Red");
  });

  test("Spanish names the box as its locale words Search products", async () => {
    await renderWith(
      { "Search products": "Buscar productos" },
      "Search products",
    );

    expect(screen.getByRole("combobox")).toHaveAccessibleName(
      "Buscar productos",
    );
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "placeholder",
      "Buscar…",
    );
  });
});
