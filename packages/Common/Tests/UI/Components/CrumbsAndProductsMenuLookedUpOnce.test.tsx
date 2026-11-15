import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { Location } from "react-router-dom";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import Link from "../../../Types/Link";
import Breadcrumbs from "../../../UI/Components/Breadcrumbs/Breadcrumbs";
import { MoreMenuItem } from "../../../UI/Components/Navbar/NavBar";
import {
  doesItemMatchSearch,
  getCategoryHeading,
  getItemDescription,
  getItemTitle,
  getMenuItemsWithHidden,
  groupItemsByCategory,
  MenuCategory,
  MenuWordLookup,
  UNCATEGORIZED_TITLE,
} from "../../../UI/Components/Navbar/NavBarMenuCatalog";
import NavBarMenuModal from "../../../UI/Components/Navbar/NavBarMenuModal";
import NavBarMobileMenu from "../../../UI/Components/Navbar/NavBarMobileMenu";
import Page from "../../../UI/Components/Page/Page";
import PageTrailEndContext from "../../../UI/Components/Page/PageTrailEnd";
import { getCrumbTitle } from "../../../UI/Components/Page/RecordNameInTrail";
import SideMenu from "../../../UI/Components/SideMenu/SideMenu";
import SideMenuItem from "../../../UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "../../../UI/Components/SideMenu/SideMenuSection";
import Navigation from "../../../UI/Utils/Navigation";

/*
 * A CRUMB'S TITLE AND A PRODUCTS MENU ITEM'S WORDS ARE LOOKED UP ONCE
 * (#8075).
 *
 * The Admin Dashboard and the status pages word their crumbs themselves,
 * and Breadcrumbs, the browser tab's title and the phone's menu looked each
 * one up again. The products menu, the other way round, drew an item's
 * words as given, so the Admin Dashboard's menu, handed over in English,
 * read English in every language.
 *
 * The rule now, for both: English goes over and is looked up once where it
 * is drawn; a text the page has put in the reader's words already says so
 * (Link.isTitleTranslated; MoreMenuItem's isTitleTranslated,
 * isDescriptionTranslated and isCategoryTranslated) and is drawn as given.
 *
 * In this test's Spanish every translation is also a key that reads "Rojo",
 * as the Dashboard's "Red" (Network) does: a word looked up once reads its
 * Spanish, and looked up twice reads "Rojo".
 */

const TWICE: string = "Rojo";

// English, its Spanish, and the Spanish itself a key.
const WORDS: Record<string, string> = {
  Network: "Red",
  Settings: "Ajustes",
  Users: "Usuarios",
  Projects: "Proyectos",
  "Manage all users.": "Gestiona a todos los usuarios.",
  "Every project.": "Todos los proyectos.",
  Management: "Gestión",
  Monitoring: "Monitoreo",
  "More products": "Más productos",
  Other: "Otros",
  Reports: "Informes",
  "Export summaries.": "Exporta resúmenes.",
};

const SPANISH: Record<string, string> = {
  ...WORDS,
  ...Object.fromEntries(
    Object.values(WORDS).map((spanish: string): [string, string] => {
      return [spanish, TWICE];
    }),
  ),
  "Pin {{product}}": "Fijar {{product}}",
  "Products menu": "Menú de productos",
};

let spanish: i18n;

// A lookup as a shared component makes it, in this test's Spanish.
const lookUp: MenuWordLookup = (text: string): string => {
  return spanish.t(text, {
    defaultValue: text,
    keySeparator: false,
    nsSeparator: false,
  }) as string;
};

// The same lookup, as useTranslateValue's translateString takes it.
const translateString: (value: string | undefined) => string | undefined = (
  value: string | undefined,
): string | undefined => {
  return value === undefined ? undefined : lookUp(value);
};

function inSpanish(element: ReactElement): ReactElement {
  return <I18nextProvider i18n={spanish}>{element}</I18nextProvider>;
}

/*
 * A category row: its heading, and - folded - the names of what it holds,
 * the summary its button is described by.
 */
function categoryRows(scope: HTMLElement): Array<[string, string]> {
  return within(scope)
    .getAllByRole("button")
    .filter((button: HTMLElement): boolean => {
      return button.hasAttribute("aria-expanded");
    })
    .map((button: HTMLElement): [string, string] => {
      const summaryId: string | null = button.getAttribute("aria-describedby");

      return [
        (button.textContent || "").trim(),
        summaryId
          ? (document.getElementById(summaryId)?.textContent || "").trim()
          : "",
      ];
    });
}

function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

const DESKTOP_WIDTH: number = 1280;
const PHONE_WIDTH: number = 375;

function goTo(pathname: string): void {
  window.history.pushState({}, "", pathname);
  Navigation.setLocation({
    pathname,
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as Location);
}

const HOME: Route = new Route("/admin");

beforeAll(async () => {
  Element.prototype.scrollIntoView = (): void => {};

  spanish = createInstance();

  await spanish.init({
    lng: "es",
    fallbackLng: "es",
    resources: { es: { translation: SPANISH } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  window.localStorage.clear();
  setViewportWidth(DESKTOP_WIDTH);
  goTo("/admin/elsewhere");
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  setViewportWidth(DESKTOP_WIDTH);
});

describe("the words the cases below lean on", () => {
  test("each Spanish word is also a key: looked up once it reads Spanish, twice Rojo", () => {
    for (const [english, word] of Object.entries(WORDS)) {
      expect([lookUp(english), lookUp(lookUp(english))]).toEqual([word, TWICE]);
    }
  });
});

describe("a crumb's title", () => {
  test("is English looked up once, or as given when the page says it is translated or a record's name", () => {
    expect(getCrumbTitle({ title: "Network", to: HOME }, translateString)).toBe(
      "Red",
    );
    expect(
      getCrumbTitle(
        { title: "Red", isTitleTranslated: true, to: HOME },
        translateString,
      ),
    ).toBe("Red");
    expect(
      getCrumbTitle(
        { title: "Red", isRecordName: true, to: HOME },
        translateString,
      ),
    ).toBe("Red");
    // Looked up again, a translation reads another word: what the flag is for.
    expect(getCrumbTitle({ title: "Red", to: HOME }, translateString)).toBe(
      TWICE,
    );
  });

  test("reads once in the trail: the page's English looked up, the page's Spanish as given", () => {
    render(
      inSpanish(
        <Breadcrumbs
          links={[
            { title: "Network", to: HOME },
            { title: "Ajustes", isTitleTranslated: true, to: HOME },
            { title: "Red", isRecordName: true, to: HOME },
          ]}
        />,
      ),
    );

    const crumbs: Array<string> = Array.from(
      document.body.querySelectorAll("li.breadcrumb-item"),
    ).map((crumb: Element): string => {
      return (crumb.textContent || "").trim();
    });

    expect(crumbs).toEqual(["Red", "Ajustes", "Red"]);
    expect(screen.queryByText(TWICE)).toBeNull();
  });

  test("reads once in the browser tab", async () => {
    await act(async () => {
      render(
        inSpanish(
          <Page
            title="Settings"
            breadcrumbLinks={[
              { title: "Network", to: HOME },
              { title: "Ajustes", isTitleTranslated: true, to: HOME },
            ]}
          >
            <div />
          </Page>,
        ),
      );
    });

    expect(document.title).toContain("Red - Ajustes");
    expect(document.title).not.toContain(TWICE);
  });

  test("reads once on the phone's menu button, in the reader's language", async () => {
    setViewportWidth(PHONE_WIDTH);
    goTo("/admin/settings/backups");

    const trailEnd: Link = {
      title: "Ajustes",
      isTitleTranslated: true,
      to: new Route("/admin/settings/backups"),
    };

    await act(async () => {
      render(
        inSpanish(
          <PageTrailEndContext.Provider value={trailEnd}>
            <SideMenu>
              <SideMenuSection title="Basic">
                <SideMenuItem
                  link={{
                    title: "Users",
                    to: new Route("/admin/settings/users"),
                  }}
                />
              </SideMenuSection>
            </SideMenu>
          </PageTrailEndContext.Provider>,
        ),
      );
    });

    const heading: HTMLElement = within(
      screen.getByTestId("mobile-sidemenu-toggle"),
    ).getByRole("heading", { level: 3 });

    expect(heading).toHaveTextContent("Ajustes");
    expect(heading).not.toHaveTextContent(TWICE);
    // Its words are the reader's: it says so, for its language's line breaks.
    expect(heading.querySelector("span[lang]")?.getAttribute("lang")).toBe(
      "es",
    );
  });
});

// The Admin Dashboard's way: English, for the menu to look up.
const ENGLISH_ITEMS: Array<MoreMenuItem> = [
  {
    title: "Users",
    description: "Manage all users.",
    route: new Route("/admin/users"),
    icon: IconProp.User,
    category: "Management",
    key: "users",
  },
  {
    title: "Projects",
    description: "Every project.",
    route: new Route("/admin/projects"),
    icon: IconProp.Folder,
    category: "Management",
    key: "projects",
  },
  {
    title: "Settings",
    description: "Manage all users.",
    route: new Route("/admin/settings"),
    icon: IconProp.Settings,
    category: "Monitoring",
  },
];

// The Dashboard's way: in the reader's words already, and said so.
const SPANISH_ITEMS: Array<MoreMenuItem> = ENGLISH_ITEMS.map(
  (item: MoreMenuItem): MoreMenuItem => {
    return {
      ...item,
      title: WORDS[item.title]!,
      isTitleTranslated: true,
      description: WORDS[item.description]!,
      isDescriptionTranslated: true,
      category: WORDS[item.category!]!,
      isCategoryTranslated: true,
    };
  },
);

describe("a products menu item's words, by the catalog's rules", () => {
  test("its title, description and category are English looked up once, or as given when it says they are translated", () => {
    const english: MoreMenuItem = ENGLISH_ITEMS[0]!;
    const translated: MoreMenuItem = SPANISH_ITEMS[0]!;

    expect([
      getItemTitle(english, lookUp),
      getItemDescription(english, lookUp),
      getCategoryHeading(groupItemsByCategory([english])[0]!, lookUp),
    ]).toEqual(["Usuarios", "Gestiona a todos los usuarios.", "Gestión"]);
    expect([
      getItemTitle(translated, lookUp),
      getItemDescription(translated, lookUp),
      getCategoryHeading(groupItemsByCategory([translated])[0]!, lookUp),
    ]).toEqual(["Usuarios", "Gestiona a todos los usuarios.", "Gestión"]);
  });

  test("each flag speaks for its own word only", () => {
    const item: MoreMenuItem = {
      ...ENGLISH_ITEMS[0]!,
      title: "Usuarios",
      isTitleTranslated: true,
    };

    expect(getItemTitle(item, lookUp)).toBe("Usuarios");
    expect(getItemDescription(item, lookUp)).toBe(
      "Gestiona a todos los usuarios.",
    );
    expect(getCategoryHeading(groupItemsByCategory([item])[0]!, lookUp)).toBe(
      "Gestión",
    );
  });

  test("a product without a category is under the menu's own Other, looked up", () => {
    const category: MenuCategory = groupItemsByCategory([
      {
        title: "Reports",
        description: "Export summaries.",
        route: new Route("/reports"),
        icon: IconProp.ChartPie,
      },
    ])[0]!;

    expect(category.title).toBe(UNCATEGORIZED_TITLE);
    expect(getCategoryHeading(category, lookUp)).toBe("Otros");
  });

  test("the hidden products' row is under its English title, looked up once, whatever their own categories said", () => {
    const items: Array<MoreMenuItem> = getMenuItemsWithHidden({
      items: [],
      hiddenItems: SPANISH_ITEMS,
      hiddenTitle: "More products",
    });

    expect(
      items.map((item: MoreMenuItem) => {
        return [item.category, item.isCategoryTranslated];
      }),
    ).toEqual([
      ["More products", false],
      ["More products", false],
      ["More products", false],
    ]);
    expect(getCategoryHeading(groupItemsByCategory(items)[0]!, lookUp)).toBe(
      "Más productos",
    );
  });

  test("search finds an item by its words as drawn and by its English, whichever way it was handed", () => {
    for (const item of [ENGLISH_ITEMS[0]!, SPANISH_ITEMS[0]!]) {
      expect(doesItemMatchSearch(item, "usuarios", lookUp)).toBe(true);
      expect(doesItemMatchSearch(item, "  GESTIONA ", lookUp)).toBe(true);
      expect(doesItemMatchSearch(item, "projects", lookUp)).toBe(false);
      expect(doesItemMatchSearch(item, "", lookUp)).toBe(true);
    }

    expect(doesItemMatchSearch(ENGLISH_ITEMS[0]!, "users", lookUp)).toBe(true);
    expect(
      doesItemMatchSearch(
        { ...ENGLISH_ITEMS[0]!, keywords: ["members"] },
        "member",
        lookUp,
      ),
    ).toBe(true);
  });
});

describe("the products menu", () => {
  const cards: (menu: HTMLElement) => Array<[string, string]> = (
    menu: HTMLElement,
  ): Array<[string, string]> => {
    return within(menu)
      .getAllByRole("option")
      .map((option: HTMLElement): [string, string] => {
        return [
          (option.querySelector("span.truncate")?.textContent || "").trim(),
          (option.querySelector("p.text-xs")?.textContent || "").trim(),
        ];
      });
  };

  const headings: (menu: HTMLElement) => Array<string> = (
    menu: HTMLElement,
  ): Array<string> => {
    return within(menu)
      .getAllByRole("heading", { level: 3 })
      .map((heading: HTMLElement): string => {
        return (heading.textContent || "").trim();
      });
  };

  const openMenu: (items: Array<MoreMenuItem>) => HTMLElement = (
    items: Array<MoreMenuItem>,
  ): HTMLElement => {
    render(
      inSpanish(
        <NavBarMenuModal
          items={items}
          onClose={() => {}}
          onTogglePin={() => {}}
          canPinMore={true}
        />,
      ),
    );

    return screen.getByRole("dialog", { name: "Menú de productos" });
  };

  const EXPECTED_CARDS: Array<[string, string]> = [
    ["Usuarios", "Gestiona a todos los usuarios."],
    ["Proyectos", "Todos los proyectos."],
    ["Ajustes", "Gestiona a todos los usuarios."],
  ];

  test.each([
    ["handed in English, as the Admin Dashboard's", ENGLISH_ITEMS],
    ["handed in Spanish and said so, as the Dashboard's", SPANISH_ITEMS],
  ])(
    "draws each item's title, description and heading once, %s",
    (_how: string, items: Array<MoreMenuItem>) => {
      const menu: HTMLElement = openMenu(items);

      expect(cards(menu)).toEqual(EXPECTED_CARDS);
      expect(headings(menu)).toEqual(["Gestión", "Monitoreo"]);
      expect(within(menu).queryByText(TWICE)).toBeNull();
      // A pin's name for a screen reader says the product as the card does.
      expect(
        within(menu).getAllByRole("button", { name: "Fijar Usuarios" }),
      ).toHaveLength(1);
    },
  );

  test("finds an item by the Spanish it is drawn in, and marks the match in that word", () => {
    const menu: HTMLElement = openMenu(ENGLISH_ITEMS);

    fireEvent.change(within(menu).getByRole("combobox"), {
      target: { value: "proyec" },
    });

    expect(cards(menu)).toEqual([["Proyectos", "Todos los proyectos."]]);
    expect(
      Array.from(menu.querySelectorAll("mark")).map((mark: Element) => {
        return mark.textContent;
      }),
    ).toEqual(["Proyec", "proyec"]);
  });

  test("a folding menu's category rows name the category and its items once", () => {
    render(
      inSpanish(
        <NavBarMenuModal
          items={ENGLISH_ITEMS}
          categoriesOpenByDefault={["Management"]}
          onClose={() => {}}
        />,
      ),
    );

    const menu: HTMLElement = screen.getByRole("dialog", {
      name: "Menú de productos",
    });

    expect(categoryRows(menu)).toEqual([
      // Open: its products are below it.
      ["Gestión", ""],
      // Folded: it lists what it holds, by the names the cards say.
      ["Monitoreo", "1 product Ajustes"],
    ]);
    expect(within(menu).queryByText(TWICE)).toBeNull();
  });

  test("the hidden products' row heads its products with its English title looked up once", () => {
    render(
      inSpanish(
        <NavBarMenuModal
          items={SPANISH_ITEMS.slice(0, 1)}
          hiddenItems={SPANISH_ITEMS.slice(1)}
          hiddenTitle="More products"
          onClose={() => {}}
        />,
      ),
    );

    const menu: HTMLElement = screen.getByRole("dialog", {
      name: "Menú de productos",
    });

    expect(headings(menu)).toEqual(["Gestión", "Más productos"]);
    expect(within(menu).queryByText(TWICE)).toBeNull();
  });
});

describe("the phone's menu", () => {
  test.each([
    ["handed in English", ENGLISH_ITEMS],
    ["handed in Spanish and said so", SPANISH_ITEMS],
  ])(
    "names each category row and what it holds once, %s",
    (_how: string, items: Array<MoreMenuItem>) => {
      render(
        inSpanish(
          <NavBarMobileMenu
            items={[]}
            moreMenuItems={items}
            categoriesOpenByDefault={[items[0]!.category!]}
            onNavigate={() => {}}
          />,
        ),
      );

      expect(categoryRows(document.body)).toEqual([
        ["Gestión", ""],
        ["Monitoreo", "1 product Ajustes"],
      ]);
      expect(document.body.textContent).not.toContain(TWICE);
      // The open category's rows: each product's name, once.
      expect(screen.getByText("Usuarios")).toBeInTheDocument();
      expect(screen.getByText("Proyectos")).toBeInTheDocument();
    },
  );
});
