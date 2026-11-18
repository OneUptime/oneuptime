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
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import {
  BELL_ITEM_PRODUCTS,
  getBellItemsOnServer,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Header/BellItemsOnServer";
import { NOTIFICATION_SETUP_NUDGE_ITEM_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Header/NotificationSetupNudge";
import { getHomeQuickActions } from "../../../../App/FeatureSet/Dashboard/src/Components/Home/HomeCommandBar";
import {
  HomeOverviewData,
  getHomeCounts,
  getHomeOverviewOnServer,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/HomeOverviewData";
import {
  ProjectHealthKind,
  getProjectHealth,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/ProjectHealth";
import ServerProductGate from "../../../../App/FeatureSet/Dashboard/src/Components/ServerProducts/ServerProductGate";
import { SERVER_PRODUCT_OFF_PAGE_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/ServerProducts/ServerProductsCopy";
import { PaletteCreateActionGates } from "../../../../App/FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPaletteHelpers";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import {
  CROSS_PROJECT_PAGE_PRODUCTS,
  getOffProductOfPath,
  getProductOfPage,
  getProductOfPath,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectProducts/ProductOfRoute";
import ProjectProducts from "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectProducts/ProjectProductsStore";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ProductKey from "../../../Types/Product/ProductKey";
import {
  ProjectProductsAnswer,
  getEmptyProjectProductsAnswer,
} from "../../../Types/Product/ProjectProductsAnswer";
import {
  ServerProductOffReason,
  ServerProductsOff,
} from "../../../Types/Product/ServerProducts";
import ProjectUtil from "../../../UI/Utils/Project";
import User from "../../../UI/Utils/User";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * A PRODUCT SWITCHED OFF ON THE SERVER IS LEFT OUT OUTSIDE A PROJECT'S
 * PAGES TOO (#7478).
 *
 *  - the header's bell draws no item of it: no active incidents while
 *    Incidents is off, no alerts while Alerts is off, their episodes with
 *    them, and no on-call duty while On-Call is off;
 *  - the pages outside a project that list one product's records from
 *    every project - Active Incidents, Active Alerts, their episodes and My
 *    On-Call Policies - say the product is switched off, as its own pages
 *    do. The server's off list is the same in every project, so the
 *    current project's answer says so;
 *  - Home's Needs attention and its headline leave its rows and numbers
 *    out, as the strip leaves out its cell, and Home offers no quick action
 *    of it.
 */

const translation: i18n = createInstance();

function off(products: Array<ProductKey>): ServerProductsOff {
  return Object.fromEntries(
    products.map((product: ProductKey) => {
      return [product, ServerProductOffReason.SwitchedOff];
    }),
  );
}

function given(extra: Partial<ProjectProductsAnswer>): void {
  ProjectProducts.setAnswer(PROJECT_ID, {
    ...getEmptyProjectProductsAnswer(),
    ...extra,
  });
}

beforeAll(async () => {
  await translation.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: englishLocale } },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  ProjectProducts.reset();
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  ProjectProducts.reset();
});

describe("the bell", () => {
  const items: Array<{ id: string }> = [
    { id: "incidents" },
    { id: "alerts" },
    { id: "alertEpisodes" },
    { id: "incidentEpisodes" },
    { id: "oncall" },
    { id: NOTIFICATION_SETUP_NUDGE_ITEM_ID },
    { id: "invitations" },
    { id: "trial" },
  ];

  const ids: (shown: Array<{ id: string }>) => Array<string> = (
    shown: Array<{ id: string }>,
  ): Array<string> => {
    return shown.map((item: { id: string }) => {
      return item.id;
    });
  };

  test("with Incidents off, shows no incident and no incident episode", () => {
    expect(
      ids(getBellItemsOnServer(items, off([ProductKey.Incidents]))),
    ).toEqual([
      "alerts",
      "alertEpisodes",
      "oncall",
      NOTIFICATION_SETUP_NUDGE_ITEM_ID,
      "invitations",
      "trial",
    ]);
  });

  test("with Alerts off, shows no alert and no alert episode", () => {
    expect(ids(getBellItemsOnServer(items, off([ProductKey.Alerts])))).toEqual(
      [
        "incidents",
        "incidentEpisodes",
        "oncall",
        NOTIFICATION_SETUP_NUDGE_ITEM_ID,
        "invitations",
        "trial",
      ],
    );
  });

  test("with On-Call off, shows no duty and does not ask to finish its setup", () => {
    expect(ids(getBellItemsOnServer(items, off([ProductKey.OnCall])))).toEqual(
      [
        "incidents",
        "alerts",
        "alertEpisodes",
        "incidentEpisodes",
        "invitations",
        "trial",
      ],
    );
  });

  test("with nothing off, every item stays", () => {
    expect(ids(getBellItemsOnServer(items, {}))).toEqual(ids(items));
  });

  test("every item of a product opens a page of that product", () => {
    expect(BELL_ITEM_PRODUCTS["incidents"]).toBe(
      getProductOfPage(PageMap.ACTIVE_INCIDENTS),
    );
    expect(BELL_ITEM_PRODUCTS["alerts"]).toBe(
      getProductOfPage(PageMap.ACTIVE_ALERTS),
    );
    expect(BELL_ITEM_PRODUCTS["alertEpisodes"]).toBe(
      getProductOfPage(PageMap.ACTIVE_ALERT_EPISODES),
    );
    expect(BELL_ITEM_PRODUCTS["incidentEpisodes"]).toBe(
      getProductOfPage(PageMap.ACTIVE_INCIDENT_EPISODES),
    );
  });
});

describe("the pages outside a project", () => {
  test.each([
    [PageMap.ACTIVE_INCIDENTS, ProductKey.Incidents],
    [PageMap.ACTIVE_INCIDENT_EPISODES, ProductKey.Incidents],
    [PageMap.ACTIVE_ALERTS, ProductKey.Alerts],
    [PageMap.ACTIVE_ALERT_EPISODES, ProductKey.Alerts],
    [PageMap.MY_ON_CALL_POLICIES, ProductKey.OnCall],
  ])("%s is %s's", (page: PageMap, product: ProductKey) => {
    expect(CROSS_PROJECT_PAGE_PRODUCTS[page]).toBe(product);

    const address: string = RouteMap[page]!.toString();

    expect(getProductOfPath(address)).toBe(product);
    expect(getProductOfPath(`${address}/`)).toBe(product);
    expect(
      getOffProductOfPath({ pathname: address, offOnServer: off([product]) }),
    ).toEqual({
      product: product,
      reason: ServerProductOffReason.SwitchedOff,
      pageProduct: null,
    });
  });

  test("a page outside a project of no product stays no product's", () => {
    expect(
      getProductOfPath(RouteMap[PageMap.PROJECT_INVITATIONS]!.toString()),
    ).toBeNull();
    expect(getProductOfPath("/dashboard/active-incidents-and-more")).toBeNull();
  });

  const page: React.ReactElement = <p data-testid="the-page">The page</p>;

  const renderAt: (path: string) => void = (path: string): void => {
    goTo(path);
    render(
      <I18nextProvider i18n={translation}>
        <MemoryRouter initialEntries={[path]}>
          <ServerProductGate>{page}</ServerProductGate>
        </MemoryRouter>
      </I18nextProvider>,
    );
  };

  test("Active Incidents says Incidents is switched off, from the last project's answer", () => {
    ProjectUtil.setLastAccessedProjectId(PROJECT_ID);
    given({ offOnServer: off([ProductKey.Incidents]) });

    renderAt("/dashboard/active-incidents");

    expect(screen.queryByTestId("the-page")).toBeNull();
    expect(
      screen.getByTestId(SERVER_PRODUCT_OFF_PAGE_TEST_ID),
    ).toHaveTextContent("Incidents is switched off on this server");
  });

  test("My On-Call Policies says On-Call is switched off", () => {
    ProjectUtil.setLastAccessedProjectId(PROJECT_ID);
    given({ offOnServer: off([ProductKey.OnCall]) });

    renderAt("/dashboard/my-on-call-policies");

    expect(screen.queryByTestId("the-page")).toBeNull();
    expect(
      screen.getByTestId(SERVER_PRODUCT_OFF_PAGE_TEST_ID),
    ).toBeInTheDocument();
  });

  test("Active Alerts draws as before while only Incidents is off", () => {
    ProjectUtil.setLastAccessedProjectId(PROJECT_ID);
    given({ offOnServer: off([ProductKey.Incidents]) });

    renderAt("/dashboard/active-alerts");

    expect(screen.getByTestId("the-page")).toBeInTheDocument();
    expect(screen.queryByTestId(SERVER_PRODUCT_OFF_PAGE_TEST_ID)).toBeNull();
  });
});

describe("Home", () => {
  const list: <T>(items: Array<T>) => { items: Array<T>; count: number } = <
    T,
  >(
    items: Array<T>,
  ): { items: Array<T>; count: number } => {
    return { items: items, count: items.length };
  };

  const data: HomeOverviewData = {
    activeIncidents: list([new Incident(), new Incident()]),
    activeAlerts: list([new Alert()]),
    notOperationalMonitors: list([new Monitor()]),
    ongoingMaintenance: list([new ScheduledMaintenance()]),
    slosNeedingAttention: list([new ServiceLevelObjective()]),
    totalMonitors: 12,
    totalSlos: 3,
  };

  test("Needs attention has no row of a product that is off, and the headline no number", () => {
    const onServer: HomeOverviewData = getHomeOverviewOnServer(data, [
      ProductKey.Incidents,
      ProductKey.Slos,
    ]);

    expect(onServer.activeIncidents).toEqual({ items: [], count: 0 });
    expect(onServer.slosNeedingAttention).toEqual({ items: [], count: 0 });
    expect(onServer.activeAlerts).toBe(data.activeAlerts);
    expect(onServer.notOperationalMonitors).toBe(data.notOperationalMonitors);
    expect(onServer.ongoingMaintenance).toBe(data.ongoingMaintenance);

    // Two incidents open, but Incidents is off: the headline is the alert and the monitor.
    expect(getProjectHealth(getHomeCounts(data)).kind).toBe(
      ProjectHealthKind.Incidents,
    );
    expect(getProjectHealth(getHomeCounts(onServer)).kind).toBe(
      ProjectHealthKind.NeedsAttention,
    );
  });

  test("with every product of the open work off, Home says nothing is wrong, never nothing is monitored", () => {
    const onServer: HomeOverviewData = getHomeOverviewOnServer(data, [
      ProductKey.Incidents,
      ProductKey.Alerts,
      ProductKey.Monitors,
      ProductKey.ScheduledMaintenance,
      ProductKey.Slos,
    ]);

    expect(getProjectHealth(getHomeCounts(onServer)).kind).toBe(
      ProjectHealthKind.Operational,
    );
    expect(onServer.totalMonitors).toBe(12);
    expect(onServer.totalSlos).toBe(3);
  });

  test("nothing off: everything as read", () => {
    expect(getHomeOverviewOnServer(data, [])).toEqual(data);
  });

  const everything: PaletteCreateActionGates = {
    canCreateIncident: true,
    canCreateMonitor: true,
    canCreateScheduledMaintenance: true,
    canCreateAnnouncement: true,
  } as PaletteCreateActionGates;

  test("offers no quick action of a product that is off", () => {
    expect(getHomeQuickActions(everything).declareIncident).not.toBeNull();

    const actions: ReturnType<typeof getHomeQuickActions> = getHomeQuickActions(
      everything,
      off([
        ProductKey.Incidents,
        ProductKey.StatusPages,
        ProductKey.ScheduledMaintenance,
      ]),
    );

    expect(actions.declareIncident).toBeNull();
    expect(
      actions.create.map((action: { key: string }) => {
        return action.key;
      }),
    ).toEqual(["create-monitor"]);
  });
});
