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
import ExploreProducts, {
  HOME_EXPLORE_HIDDEN_NOTE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/ExploreProducts";
import ProjectResources from "../../../../App/FeatureSet/Dashboard/src/Components/Home/ProjectResources";
import HiddenProductsWithData from "../../../../App/FeatureSet/Dashboard/src/Components/ProjectProducts/HiddenProductsWithData";
import ProductsSettings from "../../../../App/FeatureSet/Dashboard/src/Components/ProjectProducts/ProductsSettings";
import {
  HIDDEN_PRODUCTS_WITH_DATA_TEST_ID,
  MONITORS_WITH_GROUPS_TEST_ID,
  PRODUCTS_SETTINGS_TEST_ID,
  SHOW_EVERY_PRODUCT_TEST_ID,
  getProductSwitchTestId,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProjectProducts/ProjectProductsCopy";
import { MONITOR_GROUPS_SWITCH_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/MonitorGroup/MonitorGroupsSwitchCopy";
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
import { ServerProductOffReason } from "../../../Types/Product/ServerProducts";
import {
  ProjectProductsAnswer,
  getEmptyProjectProductsAnswer,
} from "../../../Types/Product/ProjectProductsAnswer";
import { NAVBAR_PINNED_ITEM_TEST_ID } from "../../../UI/Components/Navbar/NavBar";
import { PRODUCT_PIN_BUTTON_TEST_ID } from "../../../UI/Components/Navbar/NavBarMenuModal";
import Project from "../../../Models/DatabaseModels/Project";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import Navigation from "../../../UI/Utils/Navigation";
import ProductEvents from "../../../UI/Utils/ProductEvents";
import ProjectUtil from "../../../UI/Utils/Project";
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

// ModelAPI's generic update, as jest.spyOn types a spy on it.
type UpdateById = (
  data: Parameters<typeof ModelAPI.updateById>[0],
) => ReturnType<typeof ModelAPI.updateById>;

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

  /*
   * Products that are not set up used to land under More products, hidden
   * by the project's goals. Only a member's choice moves one there now.
   */
  test("with nothing hidden, products not set up stay in their category and there is no More products", () => {
    given({
      usage: {
        [ProductKey.Kubernetes]: ProductUsage.NotSetUp,
        [ProductKey.Docker]: ProductUsage.NotSetUp,
        [ProductKey.Logs]: ProductUsage.NotSetUp,
      },
      canChooseProducts: true,
    });

    render(wrap(<DashboardNavbar show={true} />));
    const menu: HTMLElement = openProducts();

    expect(
      within(menu).queryByRole("button", { name: "More products" }),
    ).toBeNull();

    fireEvent.click(
      within(menu).getByRole("button", { name: "Infrastructure" }),
    );
    expect(within(menu).getByText("Kubernetes")).toBeInTheDocument();
    expect(within(menu).getByText("Docker")).toBeInTheDocument();
  });

  test("a list the goals set before, as the project row has it, moves nothing under More products", () => {
    const project: Project = new Project();
    project._id = PROJECT_ID;
    project.productSettings = {
      hidden: [ProductKey.Kubernetes, ProductKey.Docker, ProductKey.Logs],
      keptHiddenWithData: [],
      chosenBy: "goals",
    };
    jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(project);

    render(wrap(<DashboardNavbar show={true} />));
    const menu: HTMLElement = openProducts();

    expect(
      within(menu).queryByRole("button", { name: "More products" }),
    ).toBeNull();

    fireEvent.click(
      within(menu).getByRole("button", { name: "Infrastructure" }),
    );
    expect(within(menu).getByText("Kubernetes")).toBeInTheDocument();
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

  /*
   * #7324: Feature Flags' one switch, Monitor Groups, is a row under
   * Monitors, read off the project the page hands in.
   */
  test("Monitor Groups is a switch under Monitors, on with the project's groups on", () => {
    given({ canChooseProducts: true });
    jest.spyOn(PermissionGate, "checkColumnUpdate").mockReturnValue({
      isAllowed: true,
    });

    const project: Project = new Project();
    project._id = PROJECT_ID;
    project.isFeatureFlagMonitorGroupsEnabled = true;

    render(wrap(<ProductsSettings currentProject={project} />));

    const monitors: HTMLElement = screen.getByTestId(
      MONITORS_WITH_GROUPS_TEST_ID,
    );

    // Monitors' own switch first, then Monitor Groups', with no line between.
    expect(
      within(monitors).getByTestId(getProductSwitchTestId(ProductKey.Monitors)),
    ).toBeInTheDocument();
    expect(
      within(monitors).getByTestId(MONITOR_GROUPS_SWITCH_TEST_ID),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      within(monitors).getByRole("switch", { name: "Monitor Groups" }),
    ).not.toHaveAttribute("aria-disabled");
    expect(screen.getAllByTestId(MONITOR_GROUPS_SWITCH_TEST_ID)).toHaveLength(
      1,
    );
  });

  test("flipping Monitor Groups saves the project's column, not the products", async () => {
    given({ canChooseProducts: true });
    jest.spyOn(PermissionGate, "checkColumnUpdate").mockReturnValue({
      isAllowed: true,
    });
    const update: SpyInstance<UpdateById> = jest
      .spyOn(ModelAPI, "updateById")
      .mockResolvedValue(undefined as never);
    const post: SpyInstance<typeof ProjectProductsApi.postProductShown> =
      jest.spyOn(ProjectProductsApi, "postProductShown");

    const project: Project = new Project();
    project._id = PROJECT_ID;

    render(wrap(<ProductsSettings currentProject={project} />));

    await act(async () => {
      fireEvent.click(screen.getByTestId(MONITOR_GROUPS_SWITCH_TEST_ID));
    });

    await waitFor(() => {
      expect(
        screen.getByTestId(`${MONITOR_GROUPS_SWITCH_TEST_ID}-status`),
      ).toHaveTextContent("Saved");
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(
      (update.mock.calls[0]![0] as unknown as { data: unknown }).data,
    ).toEqual({ isFeatureFlagMonitorGroupsEnabled: true });
    expect(post).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  test("with Monitors switched off on the server, there is no Monitor Groups switch", () => {
    given({
      canChooseProducts: true,
      offOnServer: {
        [ProductKey.Monitors]: ServerProductOffReason.SwitchedOff,
      },
    });

    const project: Project = new Project();
    project._id = PROJECT_ID;

    render(wrap(<ProductsSettings currentProject={project} />));

    expect(screen.queryByTestId(MONITOR_GROUPS_SWITCH_TEST_ID)).toBeNull();
    expect(
      screen.getByTestId(`${getProductSwitchTestId(ProductKey.Monitors)}-off`),
    ).toBeInTheDocument();
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
      chosenBy: ProjectProductsChosenBy.Member,
      canChooseProducts: true,
    });
    jest
      .spyOn(ProjectProductsApi, "postEveryProductShown")
      .mockResolvedValue(answer({ canChooseProducts: true }));

    render(wrap(<ProductsSettings />));

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

  /*
   * "Everything OneUptime can do" (#7468): the products the project hides
   * are not left out of the card, but under its last tab, More products -
   * the products menu's name for them - with the menu's note that they
   * still work.
   */
  test("Explore lists the hidden products under its last tab, More products, and opens each", () => {
    given({
      hidden: [ProductKey.Logs, ProductKey.SecurityEvents],
      canChooseProducts: true,
    });

    render(wrapInRouter(<ExploreProducts projectId={PROJECT_ID} />));

    const tabs: Array<HTMLElement> = screen.getAllByTestId("home-explore-tab");
    const last: HTMLElement = tabs[tabs.length - 1]!;

    expect(last.textContent).toBe("More products2");
    expect(
      tabs.filter((tab: HTMLElement): boolean => {
        return (tab.textContent || "").startsWith("More products");
      }),
    ).toHaveLength(1);
    // No note until the tab is opened.
    expect(screen.queryByTestId(HOME_EXPLORE_HIDDEN_NOTE_TEST_ID)).toBeNull();

    fireEvent.click(last);

    const panel: HTMLElement = screen.getByTestId("home-explore-panel");
    expect(within(panel).getByText("Logs")).toBeInTheDocument();
    expect(
      within(panel)
        .getAllByTestId("home-explore-product")
        .map((product: HTMLElement): string => {
          return product.querySelector(".truncate")?.textContent || "";
        }),
    ).toHaveLength(2);
    expect(
      screen.getByTestId(HOME_EXPLORE_HIDDEN_NOTE_TEST_ID),
    ).toHaveTextContent(
      "Hidden in this project. Search still finds them, and their pages work.",
    );
    // Whoever may choose the products can show them again from here.
    expect(
      within(screen.getByTestId(HOME_EXPLORE_HIDDEN_NOTE_TEST_ID)).getByTestId(
        HIDDEN_PRODUCTS_CHOOSE_LINK_TEST_ID,
      ),
    ).toHaveTextContent("Choose products");
    // A hidden product opens as any other does.
    expect(
      within(panel).getByText("Logs").closest("a")?.getAttribute("href"),
    ).toContain(`/dashboard/${PROJECT_ID}/logs`);
  });

  test("someone who may not choose the products reads the note without the way to change it", () => {
    given({ hidden: [ProductKey.Logs], canChooseProducts: false });

    render(wrapInRouter(<ExploreProducts projectId={PROJECT_ID} />));

    const tabs: Array<HTMLElement> = screen.getAllByTestId("home-explore-tab");
    fireEvent.click(tabs[tabs.length - 1]!);

    expect(
      screen.getByTestId(HOME_EXPLORE_HIDDEN_NOTE_TEST_ID),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(HIDDEN_PRODUCTS_CHOOSE_LINK_TEST_ID),
    ).toBeNull();
  });

  test("nothing hidden: no More products tab", () => {
    given({});

    render(wrapInRouter(<ExploreProducts projectId={PROJECT_ID} />));

    expect(
      screen
        .getAllByTestId("home-explore-tab")
        .some((tab: HTMLElement): boolean => {
          return (tab.textContent || "").startsWith("More products");
        }),
    ).toBe(false);
  });

  test("a product switched off on the server is in no tab, More products included", () => {
    given({
      hidden: [ProductKey.Logs],
      offOnServer: { [ProductKey.Logs]: ServerProductOffReason.SwitchedOff },
    });

    render(wrapInRouter(<ExploreProducts projectId={PROJECT_ID} />));

    expect(
      screen
        .getAllByTestId("home-explore-tab")
        .some((tab: HTMLElement): boolean => {
          return (tab.textContent || "").startsWith("More products");
        }),
    ).toBe(false);
  });

  test("each tab has an id of its own, whatever script its name is in", () => {
    given({ hidden: [ProductKey.Logs] });

    render(wrapInRouter(<ExploreProducts projectId={PROJECT_ID} />));

    const ids: Array<string> = screen
      .getAllByTestId("home-explore-tab")
      .map((tab: HTMLElement): string => {
        return tab.id;
      });

    expect(new Set(ids).size).toBe(ids.length);
    expect(
      screen.getByTestId("home-explore-panel").getAttribute("aria-labelledby"),
    ).toBe(ids[0]);
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
   * page load, and so does Project Settings > Products. Home's cards read
   * what it got, so a page drawn on its own makes no request it did not
   * make before.
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

  test("Home's cards ask nothing, and draw what is known", async () => {
    render(
      wrapInRouter(
        <>
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
  });

  test("the navbar asks once, and draws what is pinned", async () => {
    render(wrap(<DashboardNavbar show={true} />));

    await waitFor(() => {
      expect(screen.getAllByTestId(NAVBAR_PINNED_ITEM_TEST_ID)).toHaveLength(1);
    });
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
