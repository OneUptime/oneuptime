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
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import DashboardNavbar from "../../../../App/FeatureSet/Dashboard/src/Components/NavBar/NavBar";
import ExploreProducts from "../../../../App/FeatureSet/Dashboard/src/Components/Home/ExploreProducts";
import OverviewStats, {
  STAT_TILE_KEYS,
  getStatTileKeysOnServer,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/OverviewStats";
import AskAI from "../../../../App/FeatureSet/Dashboard/src/Components/Header/AskAI";
import GoalQuestion from "../../../../App/FeatureSet/Dashboard/src/Components/Home/WelcomeChecklist/GoalQuestion";
import ProductsSettings from "../../../../App/FeatureSet/Dashboard/src/Components/ProjectProducts/ProductsSettings";
import { getProductSwitchTestId } from "../../../../App/FeatureSet/Dashboard/src/Components/ProjectProducts/ProjectProductsCopy";
import ServerProductGate from "../../../../App/FeatureSet/Dashboard/src/Components/ServerProducts/ServerProductGate";
import ServerProductOffPage from "../../../../App/FeatureSet/Dashboard/src/Components/ServerProducts/ServerProductOffPage";
import {
  ADMIN_SERVER_PRODUCTS_PATH,
  SERVER_PRODUCT_OFF_GO_HOME_TEST_ID,
  SERVER_PRODUCT_OFF_OPEN_SETTINGS_TEST_ID,
  SERVER_PRODUCT_OFF_PAGE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ServerProducts/ServerProductsCopy";
import {
  PALETTE_ACTION_PRODUCTS,
  PaletteActionId,
  withoutActionsOfProductsOff,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPaletteHelpers";
import { REFUSED_TOOL_CALL_DETAILS } from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import { getListedDashboardGoToShortcuts } from "../../../../App/FeatureSet/Dashboard/src/Utils/KeyboardShortcuts";
import { buildProductsMenu } from "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectProducts/ProductsMenu";
import ProjectProducts from "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectProducts/ProjectProductsStore";
import { AIToolRefusal } from "../../../Types/AI/AIChatTypes";
import ProductKey from "../../../Types/Product/ProductKey";
import { ProjectProductsChosenBy } from "../../../Types/Product/ProjectProducts";
import {
  ProjectProductsAnswer,
  getEmptyProjectProductsAnswer,
} from "../../../Types/Product/ProjectProductsAnswer";
import {
  ServerProductOffReason,
  ServerProductsOff,
  ServerProductsPreset,
  getOffByPreset,
} from "../../../Types/Product/ServerProducts";
import ProjectGoal from "../../../Types/WelcomeChecklist/ProjectGoal";
import {
  MoreMenuItem,
  NAVBAR_PINNED_ITEM_TEST_ID,
} from "../../../UI/Components/Navbar/NavBar";
import Navigation from "../../../UI/Utils/Navigation";
import User from "../../../UI/Utils/User";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import IconProp from "../../../Types/Icon/IconProp";
import {
  DESKTOP_WIDTH,
  PROJECT_ID,
  goTo,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * A PRODUCT SWITCHED OFF ON THE SERVER, ON SCREEN (#6815), with the
 * project's products answer handed to the store:
 *
 *  - gone from the products menu - not listed, not under More products,
 *    not pinned - from Home's Explore and from the shortcuts list;
 *  - on Project Settings > Products, listed as off with why, no switch;
 *  - an address of it shows one page that says it is switched off, that
 *    nothing was deleted and who can switch it on - with the way there for
 *    a master admin - and a guided setup says so for the other product it
 *    needs;
 *  - Ask AI's button, Search's actions and Home's goals leave it out.
 */

const translation: i18n = createInstance();

/*
 * On-Call's name as the products menu says it in English (#6817 renames it
 * there): the off page names a product as the reader's menu does.
 */
const ON_CALL_TITLE: string = (
  englishLocale as unknown as {
    navbar: { items: { onCallDutyTitle: string } };
  }
).navbar.items.onCallDutyTitle;
const ORIGINAL_WIDTH: number = window.innerWidth;

function given(extra: Partial<ProjectProductsAnswer>): ProjectProductsAnswer {
  const value: ProjectProductsAnswer = {
    ...getEmptyProjectProductsAnswer(),
    ...extra,
  };
  ProjectProducts.setAnswer(PROJECT_ID, value);
  return value;
}

function off(
  products: Array<ProductKey>,
  reason: ServerProductOffReason = ServerProductOffReason.SwitchedOff,
): ServerProductsOff {
  return Object.fromEntries(
    products.map((product: ProductKey) => {
      return [product, reason];
    }),
  );
}

function wrap(element: React.ReactElement): React.ReactElement {
  return <I18nextProvider i18n={translation}>{element}</I18nextProvider>;
}

function wrapAt(element: React.ReactElement, path: string): React.ReactElement {
  return wrap(<MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>);
}

let navigated: Array<string>;

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
  ProjectProducts.setFetcher(async (): Promise<ProjectProductsAnswer> => {
    return ProjectProducts.getState(PROJECT_ID).answer;
  });
  setViewportWidth(DESKTOP_WIDTH);
  goTo(`/dashboard/${PROJECT_ID}/home`);
  navigated = [];
  jest.spyOn(Navigation, "navigate").mockImplementation(((
    to: Route | URL,
  ): void => {
    navigated.push(to.toString());
  }) as never);
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  ProjectProducts.setFetcher(null);
  ProjectProducts.reset();
  setViewportWidth(ORIGINAL_WIDTH);
});

describe("the products menu", () => {
  function openProducts(): HTMLElement {
    fireEvent.click(screen.getByRole("button", { name: /Products/ }));
    return screen.getByRole("dialog", { name: "Products menu" });
  }

  test("an off product is in no category, and not under More products, even hidden", () => {
    given({
      hidden: [ProductKey.Kubernetes, ProductKey.Docker],
      offOnServer: off([ProductKey.Docker, ProductKey.Logs]),
      canChooseProducts: true,
    });

    render(wrap(<DashboardNavbar show={true} />));
    const menu: HTMLElement = openProducts();

    fireEvent.click(
      within(menu).getByRole("button", { name: "Observability" }),
    );
    expect(within(menu).queryByText("Logs")).toBeNull();
    expect(within(menu).getByText("Traces")).toBeInTheDocument();

    fireEvent.click(
      within(menu).getByRole("button", { name: "More products" }),
    );
    expect(within(menu).getByText("Kubernetes")).toBeInTheDocument();
    expect(within(menu).queryByText("Docker")).toBeNull();
  });

  test("a pin of an off product is not drawn; the others keep their place", () => {
    given({
      pinned: [ProductKey.Logs, ProductKey.StatusPages],
      offOnServer: off([ProductKey.Logs]),
    });

    render(wrap(<DashboardNavbar show={true} />));

    expect(
      screen
        .getAllByTestId(NAVBAR_PINNED_ITEM_TEST_ID)
        .map((pin: HTMLElement): string => {
          return pin.textContent ?? "";
        }),
    ).toEqual(["Status Pages"]);
  });

  test("buildProductsMenu reads the answer's off list, and a caller's own list stands in for it", () => {
    const items: Array<MoreMenuItem> = [
      ProductKey.Monitors,
      ProductKey.Logs,
      ProductKey.Traces,
    ].map((product: ProductKey): MoreMenuItem => {
      return {
        key: product,
        title: product,
        description: "",
        route: new Route(`/${product}`),
        icon: IconProp.Info,
        category: "Category",
      } as MoreMenuItem;
    });

    const answer: ProjectProductsAnswer = {
      ...getEmptyProjectProductsAnswer(),
      hidden: [ProductKey.Traces],
      pinned: [ProductKey.Logs, ProductKey.Traces],
      offOnServer: off([ProductKey.Logs]),
    };

    const fromAnswer: ReturnType<typeof buildProductsMenu> = buildProductsMenu({
      items: items,
      answer: answer,
      fixedOrderCategories: [],
    });

    expect(
      fromAnswer.listed.map((item: MoreMenuItem) => {
        return item.key;
      }),
    ).toEqual([ProductKey.Monitors]);
    expect(
      fromAnswer.hidden.map((item: MoreMenuItem) => {
        return item.key;
      }),
    ).toEqual([ProductKey.Traces]);
    expect(
      fromAnswer.pinned.map((item: MoreMenuItem) => {
        return item.key;
      }),
    ).toEqual([ProductKey.Traces]);

    expect(
      buildProductsMenu({
        items: items,
        answer: answer,
        fixedOrderCategories: [],
        offOnServer: [ProductKey.Monitors],
      }).listed.map((item: MoreMenuItem) => {
        return item.key;
      }),
    ).toEqual([ProductKey.Logs]);
  });
});

describe("Home and the shortcuts", () => {
  test("Explore leaves an off product out", () => {
    given({ offOnServer: off([ProductKey.StatusPages]) });

    render(
      wrapAt(
        <ExploreProducts projectId={PROJECT_ID} />,
        `/dashboard/${PROJECT_ID}/home`,
      ),
    );

    expect(screen.queryByText("Status Pages")).toBeNull();
    expect(screen.getAllByText("Monitors").length).toBeGreaterThan(0);
  });

  test("Home's numbers leave out the cells of products that are off, and the rest share the row", () => {
    given({
      offOnServer: off(
        getOffByPreset(ServerProductsPreset.MonitoringAndStatusPages),
      ),
    });

    render(
      wrapAt(
        <OverviewStats
          isLoading={false}
          counts={{
            activeIncidents: 1,
            activeAlerts: 2,
            notOperationalMonitors: 0,
            ongoingMaintenance: 0,
            slosNeedingAttention: 1,
            totalMonitors: 3,
            totalSlos: 1,
          }}
        />,
        `/dashboard/${PROJECT_ID}/home`,
      ),
    );

    expect(screen.getByTestId("home-stat-active-incidents")).toHaveTextContent(
      "1",
    );
    expect(screen.queryByTestId("home-stat-active-alerts")).toBeNull();
    expect(screen.queryByTestId("home-stat-slos-needing-attention")).toBeNull();
    expect(
      screen.getByTestId("home-stat-not-operational-monitors"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("home-overview-stats")).toHaveClass(
      "xl:grid-cols-3",
    );
  });

  test("every cell names its product: none off shows all five", () => {
    expect(getStatTileKeysOnServer([])).toEqual(STAT_TILE_KEYS);
    expect(getStatTileKeysOnServer([ProductKey.Slos])).toEqual(
      STAT_TILE_KEYS.filter((key: string): boolean => {
        return key !== "slos-needing-attention";
      }),
    );
  });

  test("the shortcuts list leaves out what the caller passes, off products included", () => {
    const keys: Array<string> = getListedDashboardGoToShortcuts([
      ProductKey.StatusPages,
    ]).map((shortcut: { product?: ProductKey | undefined }): string => {
      return shortcut.product || "";
    });

    expect(keys).not.toContain(ProductKey.StatusPages);
    expect(keys).toContain(ProductKey.Monitors);
  });

  test("a goal of a product that is off is not offered", () => {
    given({ offOnServer: off([ProductKey.StatusPages]) });

    render(
      wrap(
        <GoalQuestion
          initialGoals={[]}
          isChange={false}
          isSaving={false}
          onSubmit={() => {}}
          onSkip={() => {}}
        />,
      ),
    );

    expect(
      screen.queryByTestId(`welcome-goal-${ProjectGoal.StatusPage}`),
    ).toBeNull();
    expect(
      screen.getByTestId(`welcome-goal-${ProjectGoal.Uptime}`),
    ).toBeInTheDocument();
  });
});

describe("Project Settings > Products", () => {
  test("an off product is listed as off, with why and who can switch it on, and has no switch", () => {
    given({
      canChooseProducts: true,
      chosenBy: ProjectProductsChosenBy.Member,
      offOnServer: off([ProductKey.StatusPages]),
    });

    render(wrap(<ProductsSettings />));

    const id: string = getProductSwitchTestId(ProductKey.StatusPages);

    expect(screen.getByTestId(`${id}-off`)).toBeInTheDocument();
    expect(screen.getByTestId(`${id}-off-label`)).toHaveTextContent(
      "Switched off on this server",
    );
    expect(screen.getByTestId(`${id}-off-reason`)).toHaveTextContent(
      "A server admin switched this off for every project. They can switch it on in Admin Dashboard > Settings > Products.",
    );
    expect(screen.queryByTestId(id)).toBeNull();
    // A product that is on keeps its switch.
    expect(
      screen.getByTestId(getProductSwitchTestId(ProductKey.Monitors)),
    ).toBeInTheDocument();
  });

  test("stopped ingestion is named as the reason", () => {
    given({
      canChooseProducts: true,
      offOnServer: off(
        [ProductKey.Logs],
        ServerProductOffReason.TelemetryIngestionStopped,
      ),
    });

    render(wrap(<ProductsSettings />));

    const id: string = getProductSwitchTestId(ProductKey.Logs);

    expect(screen.getByTestId(`${id}-off-label`)).toHaveTextContent(
      "Off: telemetry ingestion is stopped",
    );
    expect(screen.getByTestId(`${id}-off-reason`)).toHaveTextContent(
      "DISABLE_TELEMETRY_INGESTION",
    );
  });

  test("a category whose products are all off says so", () => {
    given({
      canChooseProducts: true,
      offOnServer: off([ProductKey.SecurityEvents, ProductKey.DataSecurity]),
    });

    render(wrap(<ProductsSettings />));

    expect(
      screen.getAllByText("Switched off on this server").length,
    ).toBeGreaterThanOrEqual(3);
  });
});

describe("the page an address of an off product opens", () => {
  test("says what happened, that nothing was deleted, and who can switch it on", () => {
    render(
      wrapAt(
        <ServerProductOffPage
          product={ProductKey.StatusPages}
          reason={ServerProductOffReason.SwitchedOff}
        />,
        `/dashboard/${PROJECT_ID}/status-pages`,
      ),
    );

    const page: HTMLElement = screen.getByTestId(
      SERVER_PRODUCT_OFF_PAGE_TEST_ID,
    );

    expect(page).toHaveTextContent(
      "Status Pages is switched off on this server",
    );
    expect(page).toHaveTextContent(
      "A server admin switched Status Pages off for every project on this server. Nothing was deleted: it comes back as it was when it is switched on again.",
    );
    expect(page).toHaveTextContent(
      "Ask a server admin to switch it on in Admin Dashboard > Settings > Products.",
    );
    // Only a master admin is offered the way there.
    expect(
      screen.queryByTestId(SERVER_PRODUCT_OFF_OPEN_SETTINGS_TEST_ID),
    ).toBeNull();

    fireEvent.click(screen.getByTestId(SERVER_PRODUCT_OFF_GO_HOME_TEST_ID));
    expect(navigated).toEqual([`/dashboard/${PROJECT_ID}/home/`]);
  });

  test("a master admin opens Admin Dashboard > Settings > Products in one click", () => {
    (User.isMasterAdmin as unknown as jest.Mock).mockReturnValue(true);

    render(
      wrapAt(
        <ServerProductOffPage
          product={ProductKey.Workflows}
          reason={ServerProductOffReason.SwitchedOff}
        />,
        `/dashboard/${PROJECT_ID}/workflows`,
      ),
    );

    fireEvent.click(
      screen.getByTestId(SERVER_PRODUCT_OFF_OPEN_SETTINGS_TEST_ID),
    );

    expect(navigated).toHaveLength(1);
    expect(navigated[0]).toMatch(
      new RegExp(`/admin${ADMIN_SERVER_PRODUCTS_PATH}$`),
    );
  });

  test("names the setting that starts ingestion when that is why, without the settings button", () => {
    (User.isMasterAdmin as unknown as jest.Mock).mockReturnValue(true);

    render(
      wrapAt(
        <ServerProductOffPage
          product={ProductKey.Logs}
          reason={ServerProductOffReason.TelemetryIngestionStopped}
        />,
        `/dashboard/${PROJECT_ID}/logs`,
      ),
    );

    const page: HTMLElement = screen.getByTestId(
      SERVER_PRODUCT_OFF_PAGE_TEST_ID,
    );

    expect(page).toHaveTextContent("Logs is off on this server");
    expect(page).toHaveTextContent(
      "set DISABLE_TELEMETRY_INGESTION to false and restart OneUptime",
    );
    expect(
      screen.queryByTestId(SERVER_PRODUCT_OFF_OPEN_SETTINGS_TEST_ID),
    ).toBeNull();
  });

  test("a guided setup names the other product it needs", () => {
    render(
      wrapAt(
        <ServerProductOffPage
          product={ProductKey.OnCall}
          reason={ServerProductOffReason.SwitchedOff}
          pageProduct={ProductKey.Monitors}
        />,
        `/dashboard/${PROJECT_ID}/monitors/setup`,
      ),
    );

    expect(
      screen.getByTestId(SERVER_PRODUCT_OFF_PAGE_TEST_ID),
    ).toHaveTextContent(
      `This page also uses ${ON_CALL_TITLE}, which a server admin switched off for every project on this server. Nothing was deleted.`,
    );
  });
});

describe("the gate around every route", () => {
  const page: React.ReactElement = <p data-testid="the-page">The page</p>;

  test("a page of an off product shows the off page instead", () => {
    given({ offOnServer: off([ProductKey.Logs]) });

    render(
      wrapAt(
        <ServerProductGate>{page}</ServerProductGate>,
        `/dashboard/${PROJECT_ID}/logs/saved`,
      ),
    );

    expect(screen.queryByTestId("the-page")).toBeNull();
    expect(
      screen.getByTestId(SERVER_PRODUCT_OFF_PAGE_TEST_ID),
    ).toHaveTextContent("Logs is switched off on this server");
  });

  test("a page of a product that is on draws as before", () => {
    given({ offOnServer: off([ProductKey.Logs]) });

    render(
      wrapAt(
        <ServerProductGate>{page}</ServerProductGate>,
        `/dashboard/${PROJECT_ID}/monitors`,
      ),
    );

    expect(screen.getByTestId("the-page")).toBeInTheDocument();
    expect(screen.queryByTestId(SERVER_PRODUCT_OFF_PAGE_TEST_ID)).toBeNull();
  });

  test("the website guided setup explains itself while On-Call is off", () => {
    given({ offOnServer: off([ProductKey.OnCall]) });

    render(
      wrapAt(
        <ServerProductGate>{page}</ServerProductGate>,
        `/dashboard/${PROJECT_ID}/monitors/setup`,
      ),
    );

    expect(screen.queryByTestId("the-page")).toBeNull();
    expect(
      screen.getByTestId(SERVER_PRODUCT_OFF_PAGE_TEST_ID),
    ).toHaveTextContent(`${ON_CALL_TITLE} is switched off on this server`);
  });

  test("nothing off: every page draws", () => {
    given({});

    render(
      wrapAt(
        <ServerProductGate>{page}</ServerProductGate>,
        `/dashboard/${PROJECT_ID}/logs`,
      ),
    );

    expect(screen.getByTestId("the-page")).toBeInTheDocument();
  });
});

describe("Ask AI and Search", () => {
  test("Ask AI's button is gone while Chat is off, and there otherwise", () => {
    given({ offOnServer: off([ProductKey.AIChat]) });

    const { container, rerender } = render(wrap(<AskAI />));
    expect(container).toBeEmptyDOMElement();

    given({});
    rerender(wrap(<AskAI />));
    expect(container).not.toBeEmptyDOMElement();
  });

  test("Search's actions of an off product are not offered", () => {
    const actions: Array<PaletteActionId> = [
      "action-declare-incident",
      "action-create-monitor",
      "action-create-announcement",
      "action-ask-ai",
      "action-toggle-theme",
      "action-my-on-call-policies",
    ];

    expect(
      withoutActionsOfProductsOff(actions, [
        ProductKey.StatusPages,
        ProductKey.AIChat,
        ProductKey.OnCall,
      ]),
    ).toEqual([
      "action-declare-incident",
      "action-create-monitor",
      "action-toggle-theme",
    ]);
    expect(withoutActionsOfProductsOff(actions, [])).toEqual(actions);
    expect(PALETTE_ACTION_PRODUCTS["action-create-monitor"]).toBe(
      ProductKey.Monitors,
    );
  });

  test("Ask AI's activity says why a tool of an off product was not done", () => {
    expect(REFUSED_TOOL_CALL_DETAILS[AIToolRefusal.ProductOff]).toBe(
      "not done — this product is switched off on this server",
    );
  });
});
