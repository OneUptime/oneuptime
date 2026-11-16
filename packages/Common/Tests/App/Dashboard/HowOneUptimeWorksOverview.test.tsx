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
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as fs from "fs";
import { createInstance, i18n } from "i18next";
import * as path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { MemoryRouter, useLocation } from "react-router-dom";
import { getExploreCategories } from "../../../../App/FeatureSet/Dashboard/src/Components/Home/ExploreProducts";
import {
  FEEDS_INFRASTRUCTURE_TEXT,
  FEEDS_TELEMETRY_TEXT,
  HOW_IT_WORKS_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/HowOneUptimeWorks";
import HowOneUptimeWorksDialog, {
  HOW_ONEUPTIME_WORKS_DESCRIPTION,
  HOW_ONEUPTIME_WORKS_DIALOG_TEST_ID,
  HowOneUptimeWorksOpenedFrom,
  openHowOneUptimeWorks,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/HowOneUptimeWorksDialog";
import HowOneUptimeWorksOverview, {
  HOW_IT_WORKS_CATEGORY_SUMMARIES,
  HOW_IT_WORKS_LOOP,
  HOW_IT_WORKS_LOOP_INTRO,
  HOW_IT_WORKS_LOOP_TAB,
  HOW_IT_WORKS_NEXT,
  HOW_IT_WORKS_PRODUCTS_LABEL,
  HOW_ONEUPTIME_WORKS_NEXT_TEST_ID,
  HOW_ONEUPTIME_WORKS_OVERVIEW_TEST_ID,
  HOW_ONEUPTIME_WORKS_PANEL_TEST_ID,
  HOW_ONEUPTIME_WORKS_PLAN_TEST_ID,
  HOW_ONEUPTIME_WORKS_PRODUCT_TEST_ID,
  HOW_ONEUPTIME_WORKS_TAB_TEST_ID,
  HowItWorksCategorySummary,
  HowItWorksLoopStep,
  HowItWorksProductPlace,
  HowItWorksSection,
  LOOP_SECTION_KEY,
  getHowItWorksSections,
  getLoopStepProducts,
  getScrollingBox,
  getSectionForKey,
  getSlotsOf,
  scrollBackToStart,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/HowOneUptimeWorksOverview";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import {
  DashboardNavigationItems,
  useDashboardNavigationItems,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/NavigationItems";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import ProjectProducts from "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectProducts/ProjectProductsStore";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import ProductKey, { PRODUCT_KEYS } from "../../../Types/Product/ProductKey";
import {
  ProjectProductsAnswer,
  getEmptyProjectProductsAnswer,
} from "../../../Types/Product/ProjectProductsAnswer";
import { ServerProductOffReason } from "../../../Types/Product/ServerProducts";
import { DOCS_URL } from "../../../UI/Config";
import { DEFINED_TERM_TEST_ID } from "../../../UI/Components/Glossary/DefinedTerm";
import { WAS_THIS_CLEAR_TEST_ID } from "../../../UI/Components/Feedback/WasThisClear";
import { MoreMenuItem } from "../../../UI/Components/Navbar/NavBar";
import { MenuCategory } from "../../../UI/Components/Navbar/NavBarMenuCatalog";
import ProductEvents from "../../../UI/Utils/ProductEvents";
import ProductFeedback from "../../../UI/Utils/ProductFeedback";
import { PROJECT_ID, goTo, routeFor } from "./SideMenuHarness";

/*
 * HOW ONEUPTIME WORKS, AS AN OVERVIEW OF THE WHOLE PRODUCT (#8891).
 *
 * The dialog named four products and said, in one dense sentence, that the
 * rest were optional. It is now an explorer that stays simple:
 *
 *   - How it fits together first: Detect, Respond, Communicate, Improve,
 *     each one sentence with the products that do it, each a link;
 *   - then every product, one category at a time, in the products menu's
 *     own categories, words and order, each category with a line that says
 *     what it is for;
 *   - a list of sections down the side, walked with the arrow keys (the
 *     other way round on a page read right to left), with Next at the foot
 *     of each section;
 *   - fitted to the project as the products menu is: hidden and switched
 *     off products are left out, a plan a product needs is named before the
 *     click, and with no project nothing is a link.
 *
 * A real i18next answers from the Dashboard's REAL locale files, nested keys
 * and the reader's language included, so the words asserted are the words
 * a reader sees.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

type LocaleData = Record<string, unknown>;

const readLocale: (code: string) => LocaleData = (code: string): LocaleData => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as LocaleData;
};

const GERMAN: LocaleData = readLocale("de");
const PERSIAN: LocaleData = readLocale("fa");

const translation: i18n = createInstance();

const answer: (
  extra: Partial<ProjectProductsAnswer>,
) => ProjectProductsAnswer = (
  extra: Partial<ProjectProductsAnswer>,
): ProjectProductsAnswer => {
  return { ...getEmptyProjectProductsAnswer(), ...extra };
};

const given: (extra: Partial<ProjectProductsAnswer>) => void = (
  extra: Partial<ProjectProductsAnswer>,
): void => {
  ProjectProducts.setAnswer(PROJECT_ID, answer(extra));
};

let sent: Array<{ name: string; properties: Record<string, unknown> }>;
let productOpened: jest.Mock;

// Where the router is: a product opened in place moves it.
const LocationProbe: () => ReactElement = (): ReactElement => {
  const location: ReturnType<typeof useLocation> = useLocation();

  return <div data-testid="location">{location.pathname}</div>;
};

const HOME: string = `/dashboard/${PROJECT_ID}/home`;

const wrap: (element: ReactElement) => ReactElement = (
  element: ReactElement,
): ReactElement => {
  return (
    <I18nextProvider i18n={translation}>
      <MemoryRouter initialEntries={[HOME]}>
        {element}
        <LocationProbe />
      </MemoryRouter>
    </I18nextProvider>
  );
};

const renderOverview: (options?: { hasProject: boolean }) => void = (
  options: { hasProject: boolean } = { hasProject: true },
): void => {
  render(
    wrap(
      <HowOneUptimeWorksOverview
        projectId={options.hasProject ? PROJECT_ID : undefined}
        onProductOpened={productOpened}
      />,
    ),
  );
};

/*
 * A press with Ctrl, Cmd, Shift or Alt is the browser's to open in a new
 * tab, and react-router leaves it alone: jsdom has no tabs, so the page
 * cancels it once the product's own handlers have run.
 */
const cancelTheBrowsersOwnStep: (event: MouseEvent) => void = (
  event: MouseEvent,
): void => {
  event.preventDefault();
};

const inLanguage: (language: string) => Promise<void> = async (
  language: string,
): Promise<void> => {
  await act(async () => {
    await translation.changeLanguage(language);
  });
};

// The products menu's catalog, as the Dashboard builds it.
const catalog: () => DashboardNavigationItems =
  (): DashboardNavigationItems => {
    return renderHook(
      () => {
        return useDashboardNavigationItems();
      },
      {
        wrapper: ({ children }: { children: React.ReactNode }) => {
          return (
            <I18nextProvider i18n={translation}>{children}</I18nextProvider>
          );
        },
      },
    ).result.current;
  };

const expectedCategories: () => Array<MenuCategory> =
  (): Array<MenuCategory> => {
    return getExploreCategories({
      items: catalog().moreMenuItems,
      settingsCategory: translation.t("navbar.categories.settings"),
    });
  };

const itemOf: (product: ProductKey) => MoreMenuItem = (
  product: ProductKey,
): MoreMenuItem => {
  return catalog().moreMenuItems.find((item: MoreMenuItem): boolean => {
    return item.key === product;
  })!;
};

const tabs: () => Array<HTMLElement> = (): Array<HTMLElement> => {
  return screen.getAllByTestId(HOW_ONEUPTIME_WORKS_TAB_TEST_ID);
};

const tabTitles: () => Array<string> = (): Array<string> => {
  return tabs().map((tab: HTMLElement): string => {
    return (tab.firstChild?.textContent || "").trim();
  });
};

const panel: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId(HOW_ONEUPTIME_WORKS_PANEL_TEST_ID);
};

const step: (key: string) => HTMLElement = (key: string): HTMLElement => {
  return screen.getByTestId(`how-oneuptime-works-step-${key}`);
};

const productsIn: (element: HTMLElement) => Array<HTMLElement> = (
  element: HTMLElement,
): Array<HTMLElement> => {
  return within(element).queryAllByTestId(HOW_ONEUPTIME_WORKS_PRODUCT_TEST_ID);
};

const namesOf: (products: Array<HTMLElement>) => Array<string> = (
  products: Array<HTMLElement>,
): Array<string> => {
  return products.map((product: HTMLElement): string => {
    return (product.textContent || "").trim();
  });
};

const selectSection: (title: string) => void = (title: string): void => {
  const tab: HTMLElement | undefined = tabs().find(
    (candidate: HTMLElement): boolean => {
      return (candidate.firstChild?.textContent || "").trim() === title;
    },
  );

  expect(tab).toBeDefined();
  fireEvent.click(tab!);
};

const productOpenedEvents: () => Array<Record<string, unknown>> = (): Array<
  Record<string, unknown>
> => {
  return sent
    .filter((event: { name: string }): boolean => {
      return event.name === ProductEventName.HowItWorksProductOpened;
    })
    .map((event: { properties: Record<string, unknown> }) => {
      return event.properties;
    });
};

beforeAll(async () => {
  await translation.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
      de: { translation: GERMAN },
      fa: { translation: PERSIAN },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await inLanguage("en");
  window.localStorage.clear();
  ProjectProducts.reset();
  ProjectProducts.setFetcher(async (): Promise<ProjectProductsAnswer> => {
    return ProjectProducts.getState(PROJECT_ID).answer;
  });
  goTo(HOME);
  sent = [];
  jest.spyOn(ProductEvents, "send").mockImplementation(((
    name: string,
    properties: Record<string, unknown>,
  ): void => {
    sent.push({ name: name, properties: properties || {} });
  }) as never);
  productOpened = jest.fn();
  document.addEventListener("click", cancelTheBrowsersOwnStep);
});

afterEach(() => {
  document.removeEventListener("click", cancelTheBrowsersOwnStep);
  cleanup();
  jest.restoreAllMocks();
  ProjectProducts.setFetcher(null);
  ProjectProducts.reset();
  ProductFeedback.setSettings(null);
});

describe("How it fits together", () => {
  test("opens first, on the four steps a problem moves through, numbered in order", () => {
    renderOverview();

    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs()[0]).toHaveAttribute("data-section", LOOP_SECTION_KEY);
    expect(tabTitles()[0]).toBe(HOW_IT_WORKS_LOOP_TAB);
    expect(panel()).toHaveAttribute("data-section", LOOP_SECTION_KEY);
    expect(panel()).toHaveTextContent(HOW_IT_WORKS_LOOP_INTRO);

    expect(
      HOW_IT_WORKS_LOOP.map((loopStep: HowItWorksLoopStep): string => {
        return loopStep.title;
      }),
    ).toEqual(["Detect", "Respond", "Communicate", "Improve"]);

    const steps: Array<HTMLElement> = within(panel()).getAllByTestId(
      /^how-oneuptime-works-step-/,
    );

    expect(steps).toHaveLength(4);
    HOW_IT_WORKS_LOOP.forEach(
      (loopStep: HowItWorksLoopStep, index: number): void => {
        expect(steps[index]).toHaveAttribute(
          "data-testid",
          `how-oneuptime-works-step-${loopStep.key}`,
        );
        // Its number, then its title, as an ordered list reads.
        expect(steps[index]!.textContent).toMatch(
          new RegExp(`^${index + 1}${loopStep.title}`),
        );
        expect(steps[index]!.closest("ol")).not.toBeNull();
      },
    );
    // Each sentence says what the step does.
    expect(step("respond")).toHaveTextContent(
      "Open an incident when users are affected, or an alert for your team, and page whoever is on call.",
    );
    expect(step("communicate")).toHaveTextContent(
      "Tell your customers what is happening while you fix it, and announce maintenance ahead of time.",
    );
    expect(step("improve")).toHaveTextContent(
      "Track reliability against your targets, learn from each incident and automate the next response.",
    );
  });

  test("each step offers the products that do it, by the products menu's names, each opening its page in this project", () => {
    renderOverview();

    const expected: Record<string, Array<ProductKey>> = {
      detect: [
        ProductKey.Monitors,
        ProductKey.Logs,
        ProductKey.Metrics,
        ProductKey.Traces,
      ],
      respond: [ProductKey.Incidents, ProductKey.Alerts, ProductKey.OnCall],
      communicate: [ProductKey.StatusPages, ProductKey.ScheduledMaintenance],
      improve: [
        ProductKey.Slos,
        ProductKey.Dashboards,
        ProductKey.Workflows,
        ProductKey.Runbooks,
      ],
    };

    for (const [key, products] of Object.entries(expected)) {
      const links: Array<HTMLElement> = productsIn(step(key));

      expect([key, namesOf(links)]).toEqual([
        key,
        products.map((product: ProductKey): string => {
          return itemOf(product).title;
        }),
      ]);

      links.forEach((link: HTMLElement, index: number): void => {
        expect(link.tagName).toBe("A");
        expect(link.getAttribute("href")).toBe(
          itemOf(products[index]!).route.toString(),
        );
        expect(link.getAttribute("href")).toContain(PROJECT_ID);
      });
    }

    expect(productsIn(step("detect"))[0]!.getAttribute("href")).toBe(
      routeFor(PageMap.MONITORS),
    );
  });

  test("Detect's sentence marks telemetry and infrastructure, each with its definition, in the middle of the sentence", () => {
    renderOverview();

    const sentence: HTMLElement = within(step("detect")).getByText(
      /Check your websites, APIs and servers around the clock/,
    );
    const words: Array<HTMLElement> =
      within(sentence).getAllByTestId(DEFINED_TERM_TEST_ID);

    expect(
      words.map((word: HTMLElement): string | null => {
        return word.getAttribute("data-glossary-term");
      }),
    ).toEqual(["telemetry", "infrastructure"]);
    expect(
      words.map((word: HTMLElement): string => {
        return word.textContent || "";
      }),
    ).toEqual(["telemetry", "infrastructure"]);
    expect(sentence).toHaveTextContent(
      "Check your websites, APIs and servers around the clock, and watch your telemetry and infrastructure for problems.",
    );
    // Only Detect names them: a page marks a word once.
    expect(within(panel()).getAllByTestId(DEFINED_TERM_TEST_ID)).toHaveLength(
      2,
    );
    expect(FEEDS_TELEMETRY_TEXT).toBe("Telemetry");
    expect(FEEDS_INFRASTRUCTURE_TEXT).toBe("Infrastructure");
  });

  test("the steps name each product once, and only products the products menu has", () => {
    const named: Array<ProductKey> = HOW_IT_WORKS_LOOP.flatMap(
      (loopStep: HowItWorksLoopStep): Array<ProductKey> => {
        return [...loopStep.products];
      },
    );
    const inMenu: Array<string> = catalog().moreMenuItems.map(
      (item: MoreMenuItem): string => {
        return item.key || "";
      },
    );

    expect(new Set(named).size).toBe(named.length);
    for (const product of named) {
      expect(PRODUCT_KEYS).toContain(product);
      expect(inMenu).toContain(product);
    }
    expect(
      new Set(
        HOW_IT_WORKS_LOOP.map((loopStep: HowItWorksLoopStep): string => {
          return loopStep.key;
        }),
      ).size,
    ).toBe(HOW_IT_WORKS_LOOP.length);
  });

  test("names the core products in the order a problem meets them: monitors, incidents, on-call, status pages", () => {
    // The four core products, by the page each opens.
    const corePages: Array<PageMap> = [
      PageMap.MONITORS,
      PageMap.INCIDENTS,
      PageMap.ON_CALL_DUTY,
      PageMap.STATUS_PAGES,
    ];
    const loopPages: Array<string> = HOW_IT_WORKS_LOOP.flatMap(
      (loopStep: HowItWorksLoopStep): Array<string> => {
        return loopStep.products.map((product: ProductKey): string => {
          return itemOf(product).route.toString();
        });
      },
    );
    const positions: Array<number> = corePages.map((page: PageMap): number => {
      return loopPages.indexOf(routeFor(page));
    });

    expect(
      positions.every((position: number): boolean => {
        return position >= 0;
      }),
    ).toBe(true);
    expect(
      [...positions].sort((a: number, b: number): number => {
        return a - b;
      }),
    ).toEqual(positions);
  });
});

describe("every product, by category", () => {
  test("lists the products menu's categories after the steps, in its order, without Settings, each with how many products it holds", () => {
    const categories: Array<MenuCategory> = expectedCategories();

    renderOverview();

    expect(categories.length).toBeGreaterThanOrEqual(8);
    expect(tabTitles()).toEqual([
      HOW_IT_WORKS_LOOP_TAB,
      ...categories.map((category: MenuCategory): string => {
        return category.title;
      }),
    ]);
    expect(tabTitles()).not.toContain(
      translation.t("navbar.categories.settings"),
    );
    tabs()
      .slice(1)
      .forEach((tab: HTMLElement, index: number): void => {
        expect(tab).toHaveTextContent(String(categories[index]!.items.length));
        expect(tab).toHaveAttribute("data-section", categories[index]!.title);
      });
    // The products menu's own word over the categories.
    expect(
      screen.getByTestId(HOW_ONEUPTIME_WORKS_OVERVIEW_TEST_ID),
    ).toHaveTextContent(HOW_IT_WORKS_PRODUCTS_LABEL);
  });

  test("every category says in a line what it is for, and every line is a category's", () => {
    const categories: Array<MenuCategory> = expectedCategories();
    const titles: Array<string> = HOW_IT_WORKS_CATEGORY_SUMMARIES.map(
      (entry: HowItWorksCategorySummary): string => {
        return translation.t(entry.categoryKey);
      },
    );

    expect(titles.sort()).toEqual(
      categories
        .map((category: MenuCategory): string => {
          return category.title;
        })
        .sort(),
    );

    renderOverview();

    for (const entry of HOW_IT_WORKS_CATEGORY_SUMMARIES) {
      selectSection(translation.t(entry.categoryKey));
      expect([entry.categoryKey, panel().textContent]).toEqual([
        entry.categoryKey,
        expect.stringContaining(entry.summary),
      ]);
    }
  });

  test("a category shows each of its products: its name, what it does, and a link to its page", () => {
    const observability: MenuCategory = expectedCategories()[1]!;

    renderOverview();
    selectSection(observability.title);

    expect(panel()).toHaveAttribute("data-section", observability.title);
    expect(within(panel()).getByRole("heading")).toHaveTextContent(
      observability.title,
    );

    const cards: Array<HTMLElement> = productsIn(panel());

    expect(cards).toHaveLength(observability.items.length);
    cards.forEach((card: HTMLElement, index: number): void => {
      const item: MoreMenuItem = observability.items[index]!;

      expect(card).toHaveTextContent(item.title);
      expect(card).toHaveTextContent(item.description);
      expect(card.tagName).toBe("A");
      expect(card.getAttribute("href")).toBe(item.route.toString());
    });
    expect(namesOf(cards).join(" ")).toContain(itemOf(ProductKey.Logs).title);
  });

  test("the sections are a tab list: the panel is labelled by its tab, and only the selected tab is a tab stop", () => {
    renderOverview();

    const list: HTMLElement = screen.getByRole("tablist");

    expect(list).toHaveAttribute("aria-label", HOW_IT_WORKS_TITLE);
    expect(panel()).toHaveAttribute("role", "tabpanel");
    expect(panel().getAttribute("aria-labelledby")).toBe(tabs()[0]!.id);
    expect(tabs()[0]).toHaveAttribute("aria-controls", panel().id);
    expect(tabs()[0]).toHaveAttribute("tabindex", "0");
    for (const tab of tabs().slice(1)) {
      expect(tab).toHaveAttribute("tabindex", "-1");
      expect(tab).toHaveAttribute("aria-selected", "false");
    }

    fireEvent.click(tabs()[2]!);

    expect(tabs()[2]).toHaveAttribute("aria-selected", "true");
    expect(tabs()[2]).toHaveAttribute("tabindex", "0");
    expect(tabs()[0]).toHaveAttribute("tabindex", "-1");
    expect(panel().getAttribute("aria-labelledby")).toBe(tabs()[2]!.id);
    // The panel takes the focus when its section starts with words.
    expect(panel()).toHaveAttribute("tabindex", "0");
  });
});

describe("the keyboard", () => {
  test("the arrows walk the sections both ways and wrap round, Home and End jump to the ends, and the focus follows", () => {
    renderOverview();
    const count: number = tabs().length;

    fireEvent.keyDown(tabs()[0]!, { key: "ArrowDown" });
    expect(tabs()[1]).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(tabs()[1]);

    fireEvent.keyDown(tabs()[1]!, { key: "ArrowRight" });
    expect(tabs()[2]).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(tabs()[2]);

    fireEvent.keyDown(tabs()[2]!, { key: "ArrowUp" });
    expect(tabs()[1]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(tabs()[1]!, { key: "ArrowLeft" });
    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(tabs()[0]!, { key: "ArrowUp" });
    expect(tabs()[count - 1]).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(tabs()[count - 1]);

    fireEvent.keyDown(tabs()[count - 1]!, { key: "ArrowDown" });
    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(tabs()[0]!, { key: "End" });
    expect(tabs()[count - 1]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(tabs()[count - 1]!, { key: "Home" });
    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(tabs()[0]);
  });

  test("another key moves nothing", () => {
    renderOverview();

    fireEvent.keyDown(tabs()[0]!, { key: "a" });
    fireEvent.keyDown(tabs()[0]!, { key: "Enter" });

    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");
  });

  test("on a page read right to left, Left goes on and Right goes back", async () => {
    await inLanguage("fa");
    renderOverview();

    fireEvent.keyDown(tabs()[0]!, { key: "ArrowLeft" });
    expect(tabs()[1]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(tabs()[1]!, { key: "ArrowRight" });
    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");

    // Up and down are the same either way.
    fireEvent.keyDown(tabs()[0]!, { key: "ArrowDown" });
    expect(tabs()[1]).toHaveAttribute("aria-selected", "true");
  });

  test("Next at the foot of a section says which comes next, moves on to it and puts the focus on its tab", () => {
    const categories: Array<MenuCategory> = expectedCategories();

    renderOverview();

    const next: HTMLElement = screen.getByTestId(
      HOW_ONEUPTIME_WORKS_NEXT_TEST_ID,
    );

    expect(next.tagName).toBe("BUTTON");
    expect(next).toHaveTextContent(`Next: ${categories[0]!.title}`);

    fireEvent.click(next);

    expect(tabs()[1]).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(tabs()[1]);
    expect(
      screen.getByTestId(HOW_ONEUPTIME_WORKS_NEXT_TEST_ID),
    ).toHaveTextContent(`Next: ${categories[1]!.title}`);
  });

  test("the last section has no Next", () => {
    renderOverview();

    fireEvent.keyDown(tabs()[0]!, { key: "End" });

    expect(screen.queryByTestId(HOW_ONEUPTIME_WORKS_NEXT_TEST_ID)).toBeNull();
  });
});

describe("opening a product", () => {
  test("a step's product opens its page in place, and says it was opened from the steps", () => {
    renderOverview();

    fireEvent.click(productsIn(step("respond"))[2]!);

    expect(screen.getByTestId("location")).toHaveTextContent(
      routeFor(PageMap.ON_CALL_DUTY),
    );
    expect(productOpened).toHaveBeenCalledTimes(1);
    expect(productOpenedEvents()).toEqual([
      { product: ProductKey.OnCall, place: HowItWorksProductPlace.Loop },
    ]);
  });

  test("a category's product does the same, and says it was opened from its category", () => {
    const observability: MenuCategory = expectedCategories()[1]!;

    renderOverview();
    selectSection(observability.title);

    const logs: HTMLElement = productsIn(panel()).find(
      (card: HTMLElement): boolean => {
        return (
          card.getAttribute("href") === itemOf(ProductKey.Logs).route.toString()
        );
      },
    )!;

    fireEvent.click(logs);

    expect(screen.getByTestId("location")).toHaveTextContent(
      itemOf(ProductKey.Logs).route.toString(),
    );
    expect(productOpened).toHaveBeenCalledTimes(1);
    expect(productOpenedEvents()).toEqual([
      { product: ProductKey.Logs, place: HowItWorksProductPlace.Category },
    ]);
  });

  test.each([["ctrlKey"], ["metaKey"], ["shiftKey"], ["altKey"]])(
    "opened in a new tab or window (%s), it leaves the page and the dialog where they are",
    (modifier: string) => {
      renderOverview();

      fireEvent.click(productsIn(step("detect"))[0]!, { [modifier]: true });

      expect(screen.getByTestId("location")).toHaveTextContent(HOME);
      expect(productOpened).not.toHaveBeenCalled();
      // Still counted: it was opened.
      expect(productOpenedEvents()).toEqual([
        { product: ProductKey.Monitors, place: HowItWorksProductPlace.Loop },
      ]);

      // The next plain press opens in place again.
      fireEvent.click(productsIn(step("detect"))[1]!);
      expect(productOpened).toHaveBeenCalledTimes(1);
    },
  );

  test("a press on a section opens nothing", () => {
    renderOverview();

    fireEvent.click(tabs()[1]!);

    expect(productOpened).not.toHaveBeenCalled();
    expect(productOpenedEvents()).toEqual([]);
    expect(screen.getByTestId("location")).toHaveTextContent(HOME);
  });
});

describe("fitted to the project", () => {
  test("a hidden product is left out of the steps and of its category, and a category with nothing left has no section", () => {
    given({
      hidden: [
        ProductKey.Logs,
        ProductKey.StatusPages,
        ProductKey.SecurityEvents,
        ProductKey.DataSecurity,
      ],
    });

    renderOverview();

    expect(namesOf(productsIn(step("detect")))).not.toContain(
      itemOf(ProductKey.Logs).title,
    );
    expect(namesOf(productsIn(step("detect")))).toContain(
      itemOf(ProductKey.Metrics).title,
    );
    expect(namesOf(productsIn(step("communicate")))).toEqual([
      itemOf(ProductKey.ScheduledMaintenance).title,
    ]);
    expect(tabTitles()).not.toContain(
      translation.t("navbar.categories.security"),
    );

    selectSection(translation.t("navbar.categories.observability"));
    expect(namesOf(productsIn(panel()))).not.toContain(
      itemOf(ProductKey.Logs).title,
    );
  });

  test("a step whose products are all hidden still says what it does", () => {
    given({
      hidden: [ProductKey.StatusPages, ProductKey.ScheduledMaintenance],
    });

    renderOverview();

    expect(productsIn(step("communicate"))).toEqual([]);
    expect(step("communicate")).toHaveTextContent(
      "Tell your customers what is happening while you fix it",
    );
  });

  test("a product switched off on the server is left out too", () => {
    given({
      offOnServer: {
        [ProductKey.Traces]: ServerProductOffReason.SwitchedOff,
        [ProductKey.Cloud]: ServerProductOffReason.SwitchedOff,
        [ProductKey.AppPlatforms]: ServerProductOffReason.SwitchedOff,
        [ProductKey.Serverless]: ServerProductOffReason.SwitchedOff,
      },
    });

    renderOverview();

    // Its category has nothing left, so it has no section either.
    expect(tabTitles()).not.toContain(translation.t("navbar.categories.cloud"));
    expect(namesOf(productsIn(step("detect")))).not.toContain(
      itemOf(ProductKey.Traces).title,
    );
  });

  test("a product the project's plan cannot use names the plan that can, in its step and in its category", () => {
    given({ neededPlans: { [ProductKey.Workflows]: PlanType.Growth } });

    renderOverview();

    const workflows: HTMLElement = productsIn(step("improve")).find(
      (link: HTMLElement): boolean => {
        return (link.textContent || "").startsWith(
          itemOf(ProductKey.Workflows).title,
        );
      },
    )!;

    expect(
      within(workflows).getByTestId(HOW_ONEUPTIME_WORKS_PLAN_TEST_ID),
    ).toHaveTextContent("Growth Plan");
    expect(
      within(step("improve")).getAllByTestId(HOW_ONEUPTIME_WORKS_PLAN_TEST_ID),
    ).toHaveLength(1);

    selectSection(translation.t("navbar.categories.analyticsAutomation"));
    expect(
      within(panel()).getAllByTestId(HOW_ONEUPTIME_WORKS_PLAN_TEST_ID),
    ).toHaveLength(1);
    expect(panel()).toHaveTextContent("Growth Plan");
  });

  test("with no project picked yet, every product says what it does and opens nothing", () => {
    renderOverview({ hasProject: false });

    const monitors: HTMLElement = productsIn(step("detect"))[0]!;

    expect(monitors.tagName).toBe("SPAN");
    expect(monitors).not.toHaveAttribute("href");
    fireEvent.click(monitors);

    selectSection(translation.t("navbar.categories.essentials"));
    const cards: Array<HTMLElement> = productsIn(panel());

    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.tagName).toBe("SPAN");
      expect(within(panel()).queryAllByRole("link")).toEqual([]);
    }
    // What each does is still said.
    expect(panel()).toHaveTextContent(itemOf(ProductKey.Incidents).description);
    fireEvent.click(cards[0]!);
    expect(productOpened).not.toHaveBeenCalled();
    expect(productOpenedEvents()).toEqual([]);
    expect(screen.getByTestId("location")).toHaveTextContent(HOME);
  });
});

describe("in the reader's language", () => {
  test("in German, every word of it is German", async () => {
    await inLanguage("de");
    renderOverview();

    const overview: HTMLElement = screen.getByTestId(
      HOW_ONEUPTIME_WORKS_OVERVIEW_TEST_ID,
    );
    const german: (english: string) => string = (english: string): string => {
      const value: unknown = GERMAN[english];

      expect([english, typeof value]).toEqual([english, "string"]);
      expect([english, value]).not.toEqual([english, english]);
      return value as string;
    };

    for (const english of [
      HOW_IT_WORKS_LOOP_TAB,
      HOW_IT_WORKS_LOOP_INTRO,
      HOW_IT_WORKS_PRODUCTS_LABEL,
      ...HOW_IT_WORKS_LOOP.map((loopStep: HowItWorksLoopStep): string => {
        return loopStep.title;
      }),
      HOW_IT_WORKS_LOOP[1]!.description,
      HOW_IT_WORKS_LOOP[2]!.description,
      HOW_IT_WORKS_LOOP[3]!.description,
    ]) {
      expect(overview).toHaveTextContent(german(english));
    }

    // Detect's sentence, with its two words in German.
    expect(step("detect")).toHaveTextContent(
      german(HOW_IT_WORKS_LOOP[0]!.description)
        .replace("{{telemetry}}", "Telemetrie")
        .replace("{{infrastructure}}", "Infrastruktur"),
    );
    expect(
      screen.getByTestId(HOW_ONEUPTIME_WORKS_NEXT_TEST_ID),
    ).toHaveTextContent(
      german(HOW_IT_WORKS_NEXT).replace(
        "{{section}}",
        translation.t("navbar.categories.essentials"),
      ),
    );
    expect(overview).not.toHaveTextContent("How it fits together");

    for (const entry of HOW_IT_WORKS_CATEGORY_SUMMARIES) {
      selectSection(translation.t(entry.categoryKey));
      expect(panel()).toHaveTextContent(german(entry.summary));
    }
  });

  test("in Persian, the steps are numbered in Persian digits", async () => {
    await inLanguage("fa");
    renderOverview();

    expect(step("detect").textContent).toMatch(/^۱/);
    expect(step("improve").textContent).toMatch(/^۴/);
    expect(tabs()[1]!.textContent).toMatch(/[۰-۹]+$/);
  });

  test("every word it draws is worded in every language, with the English's placeholders", () => {
    const english: Array<string> = [
      HOW_ONEUPTIME_WORKS_DESCRIPTION,
      HOW_IT_WORKS_LOOP_TAB,
      HOW_IT_WORKS_LOOP_INTRO,
      HOW_IT_WORKS_NEXT,
      ...HOW_IT_WORKS_LOOP.flatMap(
        (loopStep: HowItWorksLoopStep): Array<string> => {
          return [loopStep.title, loopStep.description];
        },
      ),
      ...HOW_IT_WORKS_CATEGORY_SUMMARIES.map(
        (entry: HowItWorksCategorySummary): string => {
          return entry.summary;
        },
      ),
    ];
    const placeholders: (text: string) => Array<string> = (
      text: string,
    ): Array<string> => {
      return (text.match(/\{\{[^}]+\}\}/g) || []).sort();
    };

    for (const code of fs
      .readdirSync(LOCALES_DIR)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      })
      .map((file: string): string => {
        return file.replace(/\.json$/, "");
      })) {
      const locale: LocaleData = readLocale(code);

      for (const text of english) {
        const value: unknown = locale[text];

        expect([code, text, typeof value]).toEqual([code, text, "string"]);
        expect([code, text, placeholders(value as string)]).toEqual([
          code,
          text,
          placeholders(text),
        ]);

        if (code !== "en") {
          expect([code, text, value]).not.toEqual([code, text, text]);
        }
      }
    }
  });
});

describe("the dialog", () => {
  const dialog: () => HTMLElement | null = (): HTMLElement | null => {
    return screen.queryByTestId(HOW_ONEUPTIME_WORKS_DIALOG_TEST_ID);
  };

  const openDialog: () => Promise<HTMLElement> =
    async (): Promise<HTMLElement> => {
      render(wrap(<HowOneUptimeWorksDialog />));

      act(() => {
        openHowOneUptimeWorks(HowOneUptimeWorksOpenedFrom.Help);
      });

      return waitFor(() => {
        return screen.getByTestId(HOW_ONEUPTIME_WORKS_DIALOG_TEST_ID);
      });
    };

  test("is How OneUptime works: its title, a line that says what it holds, the overview, and the docs", async () => {
    const shown: HTMLElement = await openDialog();

    expect(screen.getByRole("dialog")).toHaveTextContent(HOW_IT_WORKS_TITLE);
    expect(screen.getByTestId("modal-description")).toHaveTextContent(
      HOW_ONEUPTIME_WORKS_DESCRIPTION,
    );
    expect(
      within(shown).getByTestId(HOW_ONEUPTIME_WORKS_OVERVIEW_TEST_ID),
    ).toBeInTheDocument();
    expect(
      within(shown).getByTestId("how-oneuptime-works-docs-core-concepts"),
    ).toHaveAttribute(
      "href",
      `${DOCS_URL.toString()}/en/introduction/core-concepts`,
    );
    expect(
      within(shown).getByTestId("how-oneuptime-works-docs-glossary"),
    ).toHaveAttribute("target", "_blank");
    expect(
      sent.map((event: { name: string }): string => {
        return event.name;
      }),
    ).toEqual([ProductEventName.HowItWorksOpened]);
  });

  test("the focus starts on the first section, so the arrow keys work at once", async () => {
    await openDialog();

    await waitFor(() => {
      expect(document.activeElement).toBe(tabs()[0]);
    });
  });

  test("asks whether it was clear only where OneUptime may ask", async () => {
    ProductFeedback.setSettings({ isOn: true, isAskingMe: true } as never);
    const shown: HTMLElement = await openDialog();

    expect(
      within(shown).getByTestId(WAS_THIS_CLEAR_TEST_ID),
    ).toBeInTheDocument();

    cleanup();
    ProductFeedback.setSettings(null);
    const again: HTMLElement = await openDialog();

    expect(within(again).queryByTestId(WAS_THIS_CLEAR_TEST_ID)).toBeNull();
  });

  test("closes once a product opens in place, on that product's page", async () => {
    const shown: HTMLElement = await openDialog();

    fireEvent.click(
      productsIn(
        within(shown).getByTestId("how-oneuptime-works-step-communicate"),
      )[0]!,
    );

    await waitFor(() => {
      expect(dialog()).toBeNull();
    });
    expect(screen.getByTestId("location")).toHaveTextContent(
      routeFor(PageMap.STATUS_PAGES),
    );
  });

  test("stays open for the next product when one opens in a new tab", async () => {
    const shown: HTMLElement = await openDialog();

    fireEvent.click(
      productsIn(
        within(shown).getByTestId("how-oneuptime-works-step-detect"),
      )[0]!,
      {
        metaKey: true,
      },
    );

    expect(dialog()).not.toBeNull();
  });

  test("opens on the first section every time", async () => {
    await openDialog();

    fireEvent.click(tabs()[3]!);
    expect(tabs()[3]).toHaveAttribute("aria-selected", "true");

    const closeButtons: Array<HTMLElement> = screen.getAllByRole("button", {
      name: "Close",
    });
    fireEvent.click(closeButtons[closeButtons.length - 1]!);
    await waitFor(() => {
      expect(dialog()).toBeNull();
    });

    act(() => {
      openHowOneUptimeWorks(HowOneUptimeWorksOpenedFrom.Home);
    });
    await waitFor(() => {
      expect(dialog()).not.toBeNull();
    });
    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");
  });
});

describe("its parts, on their own", () => {
  test("the sections are the steps, then the categories in their order", () => {
    const categories: Array<MenuCategory> = [
      { title: "Essentials", items: [] },
      { title: "Observability", items: [] },
    ];
    const sections: Array<HowItWorksSection> =
      getHowItWorksSections(categories);

    expect(
      sections.map((section: HowItWorksSection): string => {
        return section.kind === "loop" ? "loop" : section.category.title;
      }),
    ).toEqual(["loop", "Essentials", "Observability"]);
    expect(getHowItWorksSections([])).toEqual([{ kind: "loop" }]);
  });

  /*
   * Regression: every step's sentence was handed Detect's two words, and a
   * sentence handed a slot it does not name reads as one its language has
   * not worded - Respond, Communicate and Improve were English in German.
   */
  test("a sentence is handed only the slots it names", () => {
    const words: Record<string, React.ReactNode> = {
      telemetry: <b>telemetry</b>,
      infrastructure: <b>infrastructure</b>,
    };

    expect(
      Object.keys(getSlotsOf(HOW_IT_WORKS_LOOP[0]!.description, words)),
    ).toEqual(["telemetry", "infrastructure"]);
    for (const loopStep of HOW_IT_WORKS_LOOP.slice(1)) {
      expect([
        loopStep.key,
        Object.keys(getSlotsOf(loopStep.description, words)),
      ]).toEqual([loopStep.key, []]);
    }
    expect(Object.keys(getSlotsOf("{{telemetry}} only", words))).toEqual([
      "telemetry",
    ]);
  });

  test("a step's products keep the step's order and skip what the project does not list", () => {
    const listed: Array<MoreMenuItem> = [
      itemOf(ProductKey.Traces),
      itemOf(ProductKey.Monitors),
      itemOf(ProductKey.Metrics),
    ];

    expect(
      getLoopStepProducts({ step: HOW_IT_WORKS_LOOP[0]!, listed: listed }).map(
        (item: MoreMenuItem): string | undefined => {
          return item.key;
        },
      ),
    ).toEqual([ProductKey.Monitors, ProductKey.Metrics, ProductKey.Traces]);
    expect(
      getLoopStepProducts({ step: HOW_IT_WORKS_LOOP[1]!, listed: listed }),
    ).toEqual([]);
  });

  test.each([
    ["ArrowDown", 2, false, 3],
    ["ArrowUp", 2, false, 1],
    ["ArrowRight", 2, false, 3],
    ["ArrowLeft", 2, false, 1],
    ["ArrowRight", 2, true, 1],
    ["ArrowLeft", 2, true, 3],
    ["ArrowDown", 2, true, 3],
    ["ArrowDown", 4, false, 0],
    ["ArrowUp", 0, false, 4],
    ["ArrowLeft", 4, true, 0],
    ["Home", 3, false, 0],
    ["End", 1, true, 4],
  ])(
    "%s from section %i (right to left: %s) goes to section %i of five",
    (key: string, index: number, isRightToLeft: boolean, expected: number) => {
      expect(
        getSectionForKey({
          key: key,
          index: index,
          count: 5,
          isRightToLeft: isRightToLeft,
        }),
      ).toBe(expected);
    },
  );

  test("a key that moves nothing, or a list with no sections, gives no section", () => {
    for (const key of ["Enter", " ", "Tab", "a", "PageDown"]) {
      expect(
        getSectionForKey({
          key: key,
          index: 1,
          count: 5,
          isRightToLeft: false,
        }),
      ).toBeNull();
    }
    expect(
      getSectionForKey({
        key: "ArrowDown",
        index: 0,
        count: 0,
        isRightToLeft: false,
      }),
    ).toBeNull();
  });

  describe("back to a section's start", () => {
    const scrollingBox: (data: {
      scrollTop: number;
      top: number;
    }) => HTMLElement = (data: {
      scrollTop: number;
      top: number;
    }): HTMLElement => {
      const box: HTMLElement = document.createElement("div");

      box.style.overflowY = "auto";
      Object.defineProperty(box, "scrollHeight", { value: 2000 });
      Object.defineProperty(box, "clientHeight", { value: 600 });
      box.scrollTop = data.scrollTop;
      box.getBoundingClientRect = (): DOMRect => {
        return { top: data.top } as DOMRect;
      };
      document.body.appendChild(box);

      return box;
    };

    const inside: (box: HTMLElement, top: number) => HTMLElement = (
      box: HTMLElement,
      top: number,
    ): HTMLElement => {
      const element: HTMLElement = document.createElement("div");

      element.getBoundingClientRect = (): DOMRect => {
        return { top: top } as DOMRect;
      };
      box.appendChild(element);

      return element;
    };

    afterEach(() => {
      document.body.innerHTML = "";
    });

    test("a section scrolled up out of its box comes back to its top", () => {
      const box: HTMLElement = scrollingBox({ scrollTop: 900, top: 100 });
      const section: HTMLElement = inside(box, -700);

      expect(getScrollingBox(section)).toBe(box);
      scrollBackToStart(section);

      expect(box.scrollTop).toBe(100);
    });

    test("a section whose top is in view stays where it is", () => {
      const box: HTMLElement = scrollingBox({ scrollTop: 0, top: 100 });
      const section: HTMLElement = inside(box, 120);

      scrollBackToStart(section);

      expect(box.scrollTop).toBe(0);
    });

    test("nothing scrolls where no box around it does", () => {
      const plain: HTMLElement = document.createElement("div");
      const section: HTMLElement = document.createElement("div");

      plain.appendChild(section);
      document.body.appendChild(plain);

      expect(getScrollingBox(section)).toBeNull();
      expect(() => {
        scrollBackToStart(section);
      }).not.toThrow();
    });
  });
});
