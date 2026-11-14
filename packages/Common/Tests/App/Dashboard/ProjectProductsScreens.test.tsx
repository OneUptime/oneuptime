import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import DashboardNavbar from "../../../../App/FeatureSet/Dashboard/src/Components/NavBar/NavBar";
import { HIDDEN_PRODUCTS_CHOOSE_LINK_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/NavBar/HiddenProductsMenuNote";
import ExploreProducts from "../../../../App/FeatureSet/Dashboard/src/Components/Home/ExploreProducts";
import ProjectResources from "../../../../App/FeatureSet/Dashboard/src/Components/Home/ProjectResources";
import HiddenProductsWithData from "../../../../App/FeatureSet/Dashboard/src/Components/ProjectProducts/HiddenProductsWithData";
import ProductPinButton from "../../../../App/FeatureSet/Dashboard/src/Components/ProjectProducts/ProductPinButton";
import ProductsSettings from "../../../../App/FeatureSet/Dashboard/src/Components/ProjectProducts/ProductsSettings";
import {
  HIDDEN_PRODUCTS_WITH_DATA_TEST_ID,
  PRODUCT_PIN_PAGE_BUTTON_TEST_ID,
  PRODUCTS_SETTINGS_TEST_ID,
  SHOW_EVERY_PRODUCT_TEST_ID,
  getProductSwitchTestId,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProjectProducts/ProjectProductsCopy";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import { getListedDashboardGoToShortcuts } from "../../../../App/FeatureSet/Dashboard/src/Utils/KeyboardShortcuts";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import ProjectProducts from "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectProducts/ProjectProductsStore";
import * as ProjectProductsApi from "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectProducts/ProjectProductsApi";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../Types/ObjectID";
import ProductKey from "../../../Types/Product/ProductKey";
import { ProductUsage } from "../../../Types/Product/ProductUsage";
import { ProjectProductsChosenBy } from "../../../Types/Product/ProjectProducts";
import {
  ProjectProductsAnswer,
  getEmptyProjectProductsAnswer,
} from "../../../Types/Product/ProjectProductsAnswer";
import { NAVBAR_PINNED_ITEM_TEST_ID } from "../../../UI/Components/Navbar/NavBar";
import { PRODUCT_PIN_BUTTON_TEST_ID } from "../../../UI/Components/Navbar/NavBarMenuModal";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import ProductEvents from "../../../UI/Utils/ProductEvents";
import {
  DESKTOP_WIDTH,
  PROJECT_ID,
  goTo,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * PRODUCTS THAT FIT THE PROJECT, ON SCREEN (#6814), with the project's
 * products answer handed to the store and the server's routes answered here:
 *
 *  - the nav bar: the person's pins beside Home and Products, the hidden
 *    products under More products, a pin from a card;
 *  - Project Settings > Products: a switch per product, locked for whoever
 *    may not choose, Saved after a flip, back with the reason when refused,
 *    and Show Every Product;
 *  - Home: a line about a hidden product with data, Explore and Your
 *    project without the hidden products;
 *  - the pin beside a product page's title;
 *  - the shortcuts list without the hidden products;
 *  - who asks the server: the navbar and Project Settings > Products, once
 *    per page load, and nothing else.
 */

const translation: i18n = createInstance();
const ORIGINAL_WIDTH: number = window.innerWidth;

const answer: (
  extra: Partial<ProjectProductsAnswer>,
) => ProjectProductsAnswer = (
  extra: Partial<ProjectProductsAnswer>,
): ProjectProductsAnswer => {
  return { ...getEmptyProjectProductsAnswer(), ...extra };
};

function given(extra: Partial<ProjectProductsAnswer>): ProjectProductsAnswer {
  const value: ProjectProductsAnswer = answer(extra);
  ProjectProducts.setAnswer(PROJECT_ID, value);
  return value;
}

function wrap(element: React.ReactElement): React.ReactElement {
  return <I18nextProvider i18n={translation}>{element}</I18nextProvider>;
}

// Home's cards link through react-router.
function wrapInRouter(element: React.ReactElement): React.ReactElement {
  return wrap(<MemoryRouter>{element}</MemoryRouter>);
}

let sent: Array<{ name: string; properties: unknown }>;

beforeAll(async () => {
  Element.prototype.scrollIntoView = (): void => {};
  await translation.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: englishLocale } },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  window.localStorage.clear();
  ProjectProducts.reset();
  // Never the network: each test hands the store its answer.
  ProjectProducts.setFetcher(async (): Promise<ProjectProductsAnswer> => {
    return ProjectProducts.getState(PROJECT_ID).answer;
  });
  setViewportWidth(DESKTOP_WIDTH);
  goTo(`/dashboard/${PROJECT_ID}/home`);
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});
  sent = [];
  jest.spyOn(ProductEvents, "send").mockImplementation(((
    name: string,
    properties: unknown,
  ): void => {
    sent.push({ name: name, properties: properties });
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  ProjectProducts.setFetcher(null);
  ProjectProducts.reset();
  setViewportWidth(ORIGINAL_WIDTH);
});

describe("the nav bar", () => {
  function openProducts(): HTMLElement {
    fireEvent.click(screen.getByRole("button", { name: /Products/ }));
    return screen.getByRole("dialog", { name: "Products menu" });
  }

  test("the person's pins sit beside Home and Products, in their order", () => {
    given({ pinned: [ProductKey.Logs, ProductKey.StatusPages] });

    render(wrap(<DashboardNavbar show={true} />));

    expect(
      screen
        .getAllByTestId(NAVBAR_PINNED_ITEM_TEST_ID)
        .map((pin: HTMLElement): string => {
          return pin.textContent ?? "";
        }),
    ).toEqual(["Logs", "Status Pages"]);
  });

  test("the hidden products are under More products, with the way to choose them for an admin", () => {
    given({
      hidden: [ProductKey.Kubernetes, ProductKey.Docker],
      canChooseProducts: true,
    });

    render(wrap(<DashboardNavbar show={true} />));
    const menu: HTMLElement = openProducts();

    fireEvent.click(
      within(menu).getByRole("button", { name: "Infrastructure" }),
    );
    expect(within(menu).queryByText("Kubernetes")).toBeNull();

    fireEvent.click(
      within(menu).getByRole("button", { name: "More products" }),
    );
    expect(within(menu).getByText("Kubernetes")).toBeInTheDocument();
    expect(within(menu).getByText("Docker")).toBeInTheDocument();
    expect(
      within(menu).getByTestId(HIDDEN_PRODUCTS_CHOOSE_LINK_TEST_ID),
    ).toHaveAttribute("href", `/dashboard/${PROJECT_ID}/settings/products`);
  });

  test("a member who may not choose reads why, without the link", () => {
    given({ hidden: [ProductKey.Kubernetes], canChooseProducts: false });

    render(wrap(<DashboardNavbar show={true} />));
    const menu: HTMLElement = openProducts();
    fireEvent.click(
      within(menu).getByRole("button", { name: "More products" }),
    );

    expect(
      within(menu).getByText(
        "Hidden in this project. Search still finds them, and their pages work.",
      ),
    ).toBeInTheDocument();
    expect(
      within(menu).queryByTestId(HIDDEN_PRODUCTS_CHOOSE_LINK_TEST_ID),
    ).toBeNull();
  });

  test("a pin from a card keeps the product for the person, and says so", async () => {
    given({ pinned: [] });
    const post: SpyInstance<typeof ProjectProductsApi.postPinnedProducts> = jest
      .spyOn(ProjectProductsApi, "postPinnedProducts")
      .mockImplementation(
        async (
          pinned: ReadonlyArray<ProductKey>,
        ): Promise<ProjectProductsAnswer> => {
          return answer({ pinned: [...pinned] });
        },
      );

    render(wrap(<DashboardNavbar show={true} />));
    const menu: HTMLElement = openProducts();
    const monitors: HTMLElement = within(menu)
      .getAllByRole("option")
      .find((option: HTMLElement): boolean => {
        return option.textContent?.startsWith("Monitors") === true;
      }) as HTMLElement;

    await act(async () => {
      fireEvent.click(within(monitors).getByTestId(PRODUCT_PIN_BUTTON_TEST_ID));
    });

    expect(post).toHaveBeenCalledWith([ProductKey.Monitors]);
    await waitFor(() => {
      expect(screen.getAllByTestId(NAVBAR_PINNED_ITEM_TEST_ID)).toHaveLength(1);
    });
    expect(sent).toContainEqual({
      name: ProductEventName.ProductPinned,
      properties: { product: "monitors", source: "menu", pin_count: 1 },
    });
  });

  test("with five pinned, another card's pin is locked", () => {
    given({
      pinned: [
        ProductKey.Monitors,
        ProductKey.Incidents,
        ProductKey.Alerts,
        ProductKey.OnCall,
        ProductKey.StatusPages,
      ],
    });

    render(wrap(<DashboardNavbar show={true} />));
    const menu: HTMLElement = openProducts();
    const slos: HTMLElement = within(menu)
      .getAllByRole("option")
      .find((option: HTMLElement): boolean => {
        return option.textContent?.startsWith("SLOs") === true;
      }) as HTMLElement;

    expect(within(slos).getByTestId(PRODUCT_PIN_BUTTON_TEST_ID)).toBeDisabled();
  });

  test("a product not set up says so in the menu", () => {
    given({ usage: { [ProductKey.Monitors]: ProductUsage.NotSetUp } });

    render(wrap(<DashboardNavbar show={true} />));
    const menu: HTMLElement = openProducts();

    expect(
      within(menu).getByTestId("navbar-menu-not-set-up"),
    ).toBeInTheDocument();
  });
});

describe("Project Settings > Products", () => {
  test("a switch for every product but the three always shown, on for the shown ones", () => {
    given({
      hidden: [ProductKey.Kubernetes],
      canChooseProducts: true,
    });

    render(wrap(<ProductsSettings />));

    expect(screen.getByTestId(PRODUCTS_SETTINGS_TEST_ID)).toBeInTheDocument();
    expect(
      screen.getByTestId(getProductSwitchTestId(ProductKey.Monitors)),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByTestId(getProductSwitchTestId(ProductKey.Kubernetes)),
    ).toHaveAttribute("aria-checked", "false");
    expect(
      screen.queryByTestId(getProductSwitchTestId(ProductKey.ProjectSettings)),
    ).toBeNull();
    expect(
      screen.getByTestId(
        `${getProductSwitchTestId(ProductKey.ProjectSettings)}-row`,
      ),
    ).toHaveTextContent("Always shown");
    // Each category says how many it shows.
    expect(screen.getByText("11 of 12 shown")).toBeInTheDocument();
  });

  test("flipping a switch hides the product, says Saved, and sends the event", async () => {
    given({ canChooseProducts: true });
    const post: SpyInstance<typeof ProjectProductsApi.postProductShown> = jest
      .spyOn(ProjectProductsApi, "postProductShown")
      .mockResolvedValue(
        answer({ hidden: [ProductKey.Kubernetes], canChooseProducts: true }),
      );

    render(wrap(<ProductsSettings />));

    await act(async () => {
      fireEvent.click(
        screen.getByTestId(getProductSwitchTestId(ProductKey.Kubernetes)),
      );
    });

    expect(post).toHaveBeenCalledWith({
      product: ProductKey.Kubernetes,
      isShown: false,
    });
    await waitFor(() => {
      expect(
        screen.getByTestId(
          `${getProductSwitchTestId(ProductKey.Kubernetes)}-status`,
        ),
      ).toHaveTextContent("Saved");
    });
    expect(
      screen.getByTestId(getProductSwitchTestId(ProductKey.Kubernetes)),
    ).toHaveAttribute("aria-checked", "false");
    expect(sent).toContainEqual({
      name: ProductEventName.ProductHidden,
      properties: {
        product: "kubernetes",
        source: "settings",
        has_data: false,
      },
    });
  });

  test("a refused change moves the switch back and says why", async () => {
    given({ canChooseProducts: true });
    jest
      .spyOn(ProjectProductsApi, "postProductShown")
      .mockRejectedValue(
        new Error(
          "Only someone who may edit the project can choose the products it shows.",
        ),
      );

    render(wrap(<ProductsSettings />));

    await act(async () => {
      fireEvent.click(
        screen.getByTestId(getProductSwitchTestId(ProductKey.Logs)),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByTestId(`${getProductSwitchTestId(ProductKey.Logs)}-row`),
      ).toHaveTextContent(
        "Only someone who may edit the project can choose the products it shows.",
      );
    });
    expect(
      screen.getByTestId(getProductSwitchTestId(ProductKey.Logs)),
    ).toHaveAttribute("aria-checked", "true");
    expect(sent).toEqual([]);
  });

  test("whoever may not choose sees the switches locked, and why", () => {
    given({ canChooseProducts: false });

    render(wrap(<ProductsSettings />));

    expect(
      screen.getByTestId(getProductSwitchTestId(ProductKey.Logs)),
    ).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("products-settings-locked")).toBeInTheDocument();
    expect(screen.queryByTestId(SHOW_EVERY_PRODUCT_TEST_ID)).toBeNull();
  });

  test("Show Every Product is there while something is hidden, and shows them all", async () => {
    given({
      hidden: [ProductKey.Kubernetes, ProductKey.Docker],
      chosenBy: ProjectProductsChosenBy.Goals,
      canChooseProducts: true,
    });
    jest
      .spyOn(ProjectProductsApi, "postEveryProductShown")
      .mockResolvedValue(answer({ canChooseProducts: true }));

    render(wrap(<ProductsSettings />));

    // A list the goals set says so.
    expect(
      screen.getByTestId("products-settings-from-goals"),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId(SHOW_EVERY_PRODUCT_TEST_ID));
    });

    await waitFor(() => {
      expect(screen.queryByTestId(SHOW_EVERY_PRODUCT_TEST_ID)).toBeNull();
    });
    expect(
      screen.getByTestId(getProductSwitchTestId(ProductKey.Kubernetes)),
    ).toHaveAttribute("aria-checked", "true");
    expect(sent).toContainEqual({
      name: ProductEventName.AllProductsShown,
      properties: { hidden_count: 2 },
    });
  });

  test("each product says what it is to the project", () => {
    given({
      canChooseProducts: true,
      usage: {
        [ProductKey.Monitors]: ProductUsage.InUse,
        [ProductKey.Hosts]: ProductUsage.NotSetUp,
      },
      neededPlans: { [ProductKey.Workflows]: PlanType.Growth },
    });

    render(wrap(<ProductsSettings />));

    expect(
      screen.getByTestId(
        `${getProductSwitchTestId(ProductKey.Monitors)}-in-use`,
      ),
    ).toHaveTextContent("In use");
    expect(
      screen.getByTestId(
        `${getProductSwitchTestId(ProductKey.Hosts)}-not-set-up`,
      ),
    ).toHaveTextContent("Not set up");
    expect(
      screen.getByTestId(
        `${getProductSwitchTestId(ProductKey.Workflows)}-plan`,
      ),
    ).toHaveTextContent("Growth Plan");
  });
});

describe("Home's line about a hidden product with data", () => {
  test("nothing for whoever may not choose, or while nothing hidden has data", () => {
    given({
      hidden: [ProductKey.Logs],
      hiddenWithData: [ProductKey.Logs],
      canChooseProducts: false,
    });

    const { rerender } = render(wrap(<HiddenProductsWithData />));
    expect(screen.queryByTestId(HIDDEN_PRODUCTS_WITH_DATA_TEST_ID)).toBeNull();

    act(() => {
      given({ hidden: [ProductKey.Logs], canChooseProducts: true });
    });
    rerender(wrap(<HiddenProductsWithData />));
    expect(screen.queryByTestId(HIDDEN_PRODUCTS_WITH_DATA_TEST_ID)).toBeNull();
  });

  test("one product: it is hidden and has data", () => {
    given({
      hidden: [ProductKey.Logs],
      hiddenWithData: [ProductKey.Logs],
      canChooseProducts: true,
    });

    render(wrap(<HiddenProductsWithData />));

    const line: HTMLElement = screen.getByTestId(
      HIDDEN_PRODUCTS_WITH_DATA_TEST_ID,
    );
    expect(line).toHaveTextContent(
      "Logs is hidden in this project and has data.",
    );
    expect(
      within(line).getByRole("button", { name: "Show It" }),
    ).toBeInTheDocument();
  });

  test("several: they are hidden and have data", () => {
    given({
      hidden: [ProductKey.Logs, ProductKey.Traces],
      hiddenWithData: [ProductKey.Logs, ProductKey.Traces],
      canChooseProducts: true,
    });

    render(wrap(<HiddenProductsWithData />));

    const line: HTMLElement = screen.getByTestId(
      HIDDEN_PRODUCTS_WITH_DATA_TEST_ID,
    );
    expect(line).toHaveTextContent(
      "Logs and Traces are hidden in this project and have data.",
    );
    expect(
      within(line).getByRole("button", { name: "Show Them" }),
    ).toBeInTheDocument();
  });

  test("Show It shows each one, and the line goes", async () => {
    given({
      hidden: [ProductKey.Logs],
      hiddenWithData: [ProductKey.Logs],
      canChooseProducts: true,
    });
    const post: SpyInstance<typeof ProjectProductsApi.postProductShown> = jest
      .spyOn(ProjectProductsApi, "postProductShown")
      .mockResolvedValue(answer({ canChooseProducts: true }));

    render(wrap(<HiddenProductsWithData />));

    await act(async () => {
      fireEvent.click(
        screen.getByTestId(`${HIDDEN_PRODUCTS_WITH_DATA_TEST_ID}-show`),
      );
    });

    expect(post).toHaveBeenCalledWith({
      product: ProductKey.Logs,
      isShown: true,
    });
    await waitFor(() => {
      expect(
        screen.queryByTestId(HIDDEN_PRODUCTS_WITH_DATA_TEST_ID),
      ).toBeNull();
    });
    expect(sent).toContainEqual({
      name: ProductEventName.ProductShown,
      properties: { product: "logs", source: "home" },
    });
  });

  test("Keep Hidden keeps it hidden on purpose", async () => {
    given({
      hidden: [ProductKey.Logs],
      hiddenWithData: [ProductKey.Logs],
      canChooseProducts: true,
    });
    const post: SpyInstance<typeof ProjectProductsApi.postProductShown> = jest
      .spyOn(ProjectProductsApi, "postProductShown")
      .mockResolvedValue(
        answer({ hidden: [ProductKey.Logs], canChooseProducts: true }),
      );

    render(wrap(<HiddenProductsWithData />));

    await act(async () => {
      fireEvent.click(
        screen.getByTestId(`${HIDDEN_PRODUCTS_WITH_DATA_TEST_ID}-keep`),
      );
    });

    expect(post).toHaveBeenCalledWith({
      product: ProductKey.Logs,
      isShown: false,
    });
    await waitFor(() => {
      expect(
        screen.queryByTestId(HIDDEN_PRODUCTS_WITH_DATA_TEST_ID),
      ).toBeNull();
    });
    expect(sent).toContainEqual({
      name: ProductEventName.ProductHidden,
      properties: { product: "logs", source: "home", has_data: true },
    });
  });

  test("a refusal stays on the line, saying why", async () => {
    given({
      hidden: [ProductKey.Logs],
      hiddenWithData: [ProductKey.Logs],
      canChooseProducts: true,
    });
    jest
      .spyOn(ProjectProductsApi, "postProductShown")
      .mockRejectedValue(new Error("The server is busy."));

    render(wrap(<HiddenProductsWithData />));

    await act(async () => {
      fireEvent.click(
        screen.getByTestId(`${HIDDEN_PRODUCTS_WITH_DATA_TEST_ID}-show`),
      );
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "The server is busy.",
      );
    });
  });
});

describe("the pin beside a product page's title", () => {
  test("Pin pins the product for the person; Pinned unpins it", async () => {
    given({ pinned: [] });
    jest
      .spyOn(ProjectProductsApi, "postPinnedProducts")
      .mockImplementation(
        async (
          pinned: ReadonlyArray<ProductKey>,
        ): Promise<ProjectProductsAnswer> => {
          return answer({ pinned: [...pinned] });
        },
      );

    render(wrap(<ProductPinButton product={ProductKey.Logs} />));

    const button: HTMLElement = screen.getByTestId(
      PRODUCT_PIN_PAGE_BUTTON_TEST_ID,
    );
    expect(button).toHaveTextContent("Pin");
    expect(button).toHaveAttribute("aria-pressed", "false");

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(button).toHaveTextContent("Pinned");
    });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(sent).toContainEqual({
      name: ProductEventName.ProductPinned,
      properties: { product: "logs", source: "page", pin_count: 1 },
    });

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(button).toHaveAttribute("aria-pressed", "false");
    });
    expect(sent).toContainEqual({
      name: ProductEventName.ProductUnpinned,
      properties: { product: "logs", source: "page", pin_count: 0 },
    });
  });

  test("with five pinned, another product's pin is locked and says why", () => {
    given({
      pinned: [
        ProductKey.Monitors,
        ProductKey.Incidents,
        ProductKey.Alerts,
        ProductKey.OnCall,
        ProductKey.StatusPages,
      ],
    });

    render(wrap(<ProductPinButton product={ProductKey.Logs} />));

    const button: HTMLElement = screen.getByTestId(
      PRODUCT_PIN_PAGE_BUTTON_TEST_ID,
    );
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      "title",
      "You can pin up to 5 products. Unpin one first.",
    );
  });

  test("outside a project there is nothing to pin", () => {
    goTo("/dashboard");
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);

    render(wrap(<ProductPinButton product={ProductKey.Logs} />));

    expect(screen.queryByTestId(PRODUCT_PIN_PAGE_BUTTON_TEST_ID)).toBeNull();
  });
});

describe("Home without the hidden products", () => {
  test("Explore leaves hidden products out, and a category all hidden has no tab", () => {
    given({
      hidden: [
        ProductKey.SecurityEvents,
        ProductKey.DataSecurity,
        ProductKey.Logs,
      ],
    });

    render(wrapInRouter(<ExploreProducts projectId={PROJECT_ID} />));

    const tabs: Array<string> = screen
      .getAllByTestId("home-explore-tab")
      .map((tab: HTMLElement): string => {
        return tab.textContent ?? "";
      });
    expect(
      tabs.some((tab: string) => {
        return tab.startsWith("Security");
      }),
    ).toBe(false);

    fireEvent.click(
      screen.getAllByTestId("home-explore-tab").find((tab: HTMLElement) => {
        return tab.textContent?.startsWith("Observability") === true;
      }) as HTMLElement,
    );
    const panel: HTMLElement = screen.getByTestId("home-explore-panel");
    expect(within(panel).queryByText("Logs")).toBeNull();
    expect(within(panel).getByText("Metrics")).toBeInTheDocument();
  });

  test("Explore names the plan a product needs", () => {
    given({ neededPlans: { [ProductKey.Monitors]: PlanType.Growth } });

    render(wrapInRouter(<ExploreProducts projectId={PROJECT_ID} />));

    expect(screen.getByTestId("home-explore-plan")).toHaveTextContent(
      "Growth Plan",
    );
  });

  test("Your project leaves a hidden product's row out", async () => {
    given({ hidden: [ProductKey.Workflows] });
    jest.spyOn(ModelAPI, "count").mockResolvedValue(3);

    render(
      wrapInRouter(
        <ProjectResources
          projectId={new ObjectID(PROJECT_ID)}
          totalMonitors={2}
          totalSlos={0}
        />,
      ),
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("home-resource-dashboards-count"),
      ).toBeInTheDocument();
    });
    expect(screen.queryByTestId("home-resource-workflows")).toBeNull();
    expect(screen.getByTestId("home-resource-monitors")).toBeInTheDocument();
  });
});

describe("the shortcuts list", () => {
  test("leaves out the shortcuts to hidden products, and keeps every other", () => {
    const listed: Array<PageMap> = getListedDashboardGoToShortcuts([
      ProductKey.Logs,
      ProductKey.Traces,
    ]).map((shortcut: { pageMap: PageMap }): PageMap => {
      return shortcut.pageMap;
    });

    expect(listed).not.toContain(PageMap.LOGS);
    expect(listed).not.toContain(PageMap.TRACES);
    expect(listed).toContain(PageMap.HOME);
    expect(listed).toContain(PageMap.MONITORS);
    expect(getListedDashboardGoToShortcuts([])).toHaveLength(10);
  });
});

describe("who asks the server", () => {
  /*
   * The navbar, which every project page draws (shown or not), asks once per
   * page load, and so does Project Settings > Products. The pin beside a
   * title and Home's cards read what it got, so a page drawn on its own
   * makes no request it did not make before.
   */
  let asked: number;

  beforeEach(() => {
    asked = 0;
    ProjectProducts.setFetcher(async (): Promise<ProjectProductsAnswer> => {
      asked++;
      return answer({ pinned: [ProductKey.Logs] });
    });
    jest.spyOn(ModelAPI, "count").mockResolvedValue(0);
  });

  test("the pin beside a title and Home's cards ask nothing, and draw what is known", async () => {
    render(
      wrapInRouter(
        <>
          <ProductPinButton product={ProductKey.Logs} />
          <HiddenProductsWithData />
          <ExploreProducts projectId={PROJECT_ID} />
          <ProjectResources
            projectId={new ObjectID(PROJECT_ID)}
            totalMonitors={0}
            totalSlos={0}
          />
        </>,
      ),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(asked).toBe(0);
    expect(screen.getByTestId(PRODUCT_PIN_PAGE_BUTTON_TEST_ID)).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("the navbar asks once, however many read the answer, and they all draw it", async () => {
    render(
      wrap(
        <>
          <DashboardNavbar show={true} />
          <ProductPinButton product={ProductKey.Logs} />
          <ProductPinButton product={ProductKey.Metrics} />
        </>,
      ),
    );

    await waitFor(() => {
      expect(
        screen.getAllByTestId(PRODUCT_PIN_PAGE_BUTTON_TEST_ID)[0],
      ).toHaveAttribute("aria-pressed", "true");
    });
    expect(
      screen.getAllByTestId(PRODUCT_PIN_PAGE_BUTTON_TEST_ID)[1],
    ).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByTestId(NAVBAR_PINNED_ITEM_TEST_ID)).toHaveLength(1);
    expect(asked).toBe(1);
  });

  test("a navbar the page hides still asks: it is drawn on every project page", async () => {
    render(wrap(<DashboardNavbar show={false} />));

    await waitFor(() => {
      expect(asked).toBe(1);
    });
  });

  test("Project Settings > Products asks on its own", async () => {
    render(wrap(<ProductsSettings />));

    await waitFor(() => {
      expect(asked).toBe(1);
    });
  });
});
