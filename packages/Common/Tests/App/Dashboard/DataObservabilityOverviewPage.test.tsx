import "@testing-library/jest-dom";
/*
 * jest itself is the global one: @jest/globals types jest.spyOn() as a mock
 * the global jest.SpiedFunction annotations here do not accept, and
 * jest.requireActual() as unknown.
 */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import DataAssetOwnerTeam from "../../../Models/DatabaseModels/DataAssetOwnerTeam";
import DataAssetOwnerUser from "../../../Models/DatabaseModels/DataAssetOwnerUser";
import DataProduct from "../../../Models/DatabaseModels/DataProduct";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import {
  DataObservabilityCollector,
  DataObservabilityOverview,
  DataObservabilityStoreSummary,
} from "../../../Types/DataObservability/DataObservabilityApiTypes";
import {
  DataAttentionItem,
  DataAttentionKind,
  DataObservabilitySetup,
  DataObservabilitySetupStep,
} from "../../../Types/DataObservability/DataObservabilityAttention";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import DataObservabilityApi from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataObservabilityApi";
import {
  ATTENTION_ITEM_TEST_ID,
  ATTENTION_OWNERS_TEST_ID,
  NEEDS_ATTENTION_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/OverviewNeedsAttention";
import { getSetupDismissedKey } from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/OverviewAttention";
import {
  SETUP_STEPS_DISMISS_TEST_ID,
  SETUP_STEPS_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/OverviewSetupSteps";
import { STORE_ALERT_STATUS_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/StoreAlertStatus";
import { PRODUCT_SHOWCASE_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/ProductOnboarding/ProductShowcase";
import DataObservabilityOverviewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/Overview";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";

jest.setTimeout(60000);

/*
 * The reader's language, as a test sets it: a word found here reads as
 * given, any other as written. Empty but for the test that reads the page
 * in another language.
 */
const mockTranslations: Record<string, string> = {};

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return mockTranslations[value] ?? value;
        },
      };
    },
  };
});

// The database a stand-in for the connect form connects.
const MOCK_CONNECTED_STORE: string = "10000000-0000-4000-8000-000000000009";

/*
 * The connect form is pinned on its own: a stand-in here, that connects a
 * database when asked, so what the Overview does next can be seen.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/ConnectDatabaseModal",
  () => {
    const mockReact: typeof React = jest.requireActual("react");
    const MockObjectID: typeof ObjectID = jest.requireActual(
      "../../../Types/ObjectID",
    ).default;

    return {
      __esModule: true,
      default: (props: { onConnected: (id: ObjectID) => void }) => {
        return mockReact.createElement(
          "button",
          {
            type: "button",
            onClick: () => {
              props.onConnected(new MockObjectID(MOCK_CONNECTED_STORE));
            },
          },
          "Stub: connected",
        );
      },
    };
  },
);

/*
 * DATA OBSERVABILITY'S OVERVIEW, RENDERED FOR REAL WITH THE NETWORK STUBBED.
 *
 * Someone new opens it and must see, in a minute, what it watches, what
 * is wrong now and what to do:
 *
 *   - no database yet: how it works and the way to connect one, nothing
 *     else;
 *   - until it is set up, the steps that make it useful, each with its
 *     page - turn on the alerts of the database that has none, say who owns
 *     the tables, add a check, send the pipelines' runs - away for good
 *     once dismissed, and gone once done;
 *   - what needs someone now, worst first, as the server ordered it: each
 *     with what it means, its error, who owns it, whether anyone was told
 *     (its open alert) or that nobody will be (its database's alerts are
 *     off), and the page where it is put right;
 *   - each database, and whether its alerts are on;
 *   - a read that fails says so, and Refresh reads again; a server a
 *     version behind is read without failing.
 */

const STORE_ALERTED: string = "10000000-0000-4000-8000-000000000001";
const STORE_SILENT: string = "10000000-0000-4000-8000-000000000002";
const TABLE_PAYMENTS: string = "10000000-0000-4000-8000-000000000101";
const TABLE_ORDERS: string = "10000000-0000-4000-8000-000000000102";
const TABLE_EVENTS: string = "10000000-0000-4000-8000-000000000103";
const PIPELINE: string = "10000000-0000-4000-8000-000000000201";
const CHECK: string = "10000000-0000-4000-8000-000000000301";
const PRODUCT: string = "10000000-0000-4000-8000-000000000501";
const ALERT: string = "10000000-0000-4000-8000-000000000801";

const DO_PATH: string = `/dashboard/${PROJECT_ID}/data-observability`;

const pageProps: PageComponentProps = {
  pageRoute: new Route(DO_PATH),
  currentProject: null,
  hasPaymentMethod: true,
};

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function routeTo(page: PageMap, modelId?: string): string {
  return RouteUtil.populateRouteParams(
    RouteMap[page] as Route,
    modelId ? { modelId: new ObjectID(modelId) } : undefined,
  ).toString();
}

function store(
  dataStoreId: string,
  fields: Partial<DataObservabilityStoreSummary>,
): DataObservabilityStoreSummary {
  return {
    dataStoreId,
    name: "",
    kind: "PostgreSQL",
    isTableHealthEnabled: true,
    collector: DataObservabilityCollector.OneUptime,
    probeName: null,
    status: "Collected",
    message: null,
    collectedAt: hoursAgo(0.1),
    assetCount: 3,
    lateAssetCount: 0,
    alertMonitorCount: 0,
    ...fields,
  };
}

function item(
  kind: DataAttentionKind,
  name: string,
  fields: Partial<DataAttentionItem> = {},
): DataAttentionItem {
  return {
    kind,
    name,
    where: null,
    message: null,
    overdueBySeconds: 0,
    since: null,
    dataStoreId: null,
    dataAssetId: null,
    dataPipelineId: null,
    dataCheckId: null,
    dataProductId: null,
    dataReconciliationId: null,
    alert: null,
    ...fields,
  };
}

const SETUP: DataObservabilitySetup = {
  storeCount: 2,
  storesWithAlertsCount: 1,
  firstStoreWithoutAlertsId: STORE_SILENT,
  checkCount: 0,
  pipelineCount: 1,
  tableOwnerCount: 2,
  ownerRuleCount: 0,
};

function busyOverview(
  fields: Partial<DataObservabilityOverview> = {},
): DataObservabilityOverview {
  return {
    storeCount: 2,
    assetCount: 1840,
    lateAssetCount: 2,
    droppedAssetCount: 0,
    unusedAssetCount: 0,
    unusedSizeInBytes: 0,
    schemaChangeCount: 0,
    failingStoreCount: 1,
    lateAssets: [],
    recentChanges: [],
    stores: [
      store(STORE_ALERTED, { name: "orders-db", alertMonitorCount: 4 }),
      store(STORE_SILENT, {
        name: "warehouse",
        kind: "Snowflake",
        status: "Failed",
        message: "password authentication failed",
      }),
    ],
    attention: [
      item(DataAttentionKind.CollectionFailed, "warehouse", {
        where: "Snowflake",
        message: "password authentication failed for user oneuptime_reader",
        since: hoursAgo(1),
        dataStoreId: STORE_SILENT,
      }),
      item(DataAttentionKind.PipelineFailed, "nightly_load", {
        where: "airflow",
        message: "relation staging.orders does not exist",
        since: hoursAgo(2),
        dataPipelineId: PIPELINE,
      }),
      item(DataAttentionKind.CheckFailing, "no duplicate orders", {
        where: "public.orders",
        since: hoursAgo(1),
        dataCheckId: CHECK,
        dataAssetId: TABLE_ORDERS,
        alert: { alertId: ALERT, number: "ALT-7", title: "duplicates" },
      }),
      item(DataAttentionKind.DataProductLate, "Finance dashboard", {
        since: hoursAgo(3),
        dataProductId: PRODUCT,
      }),
      item(DataAttentionKind.TableLate, "public.payments", {
        where: "orders-db",
        overdueBySeconds: 4 * 3600,
        since: hoursAgo(6),
        dataAssetId: TABLE_PAYMENTS,
        dataStoreId: STORE_ALERTED,
      }),
      item(DataAttentionKind.TableLate, "events.clicks", {
        where: "warehouse",
        overdueBySeconds: 30 * 60,
        since: hoursAgo(2),
        dataAssetId: TABLE_EVENTS,
        dataStoreId: STORE_SILENT,
      }),
    ],
    attentionCount: 6,
    failingCheckCount: 1,
    setup: SETUP,
    ...fields,
  };
}

let overviewAnswer: DataObservabilityOverview | Error;
let ownersRead: Error | null;
// The data product's Owner Team, or none.
let productOwnerTeam: { _id: string; name: string } | null;
let overviewSpy: jest.SpiedFunction<typeof DataObservabilityApi.getOverview>;
let navigateSpy: jest.SpiedFunction<typeof Navigation.navigate>;
interface OwnerQuery {
  modelType: unknown;
  query: Record<string, unknown>;
}

let ownerQueries: Array<OwnerQuery>;

function list<T>(data: Array<T>): {
  data: Array<T>;
  count: number;
  skip: number;
  limit: number;
} {
  return { data, count: data.length, skip: 0, limit: 500 };
}

function owner<T>(Type: { new (): T }, fields: Record<string, unknown>): T {
  const row: T = new Type();
  Object.assign(row as unknown as Record<string, unknown>, fields);
  return row;
}

beforeEach(() => {
  goTo(DO_PATH);
  window.localStorage.clear();

  overviewAnswer = busyOverview();
  ownersRead = null;
  productOwnerTeam = { _id: "t3", name: "Finance Analytics" };
  ownerQueries = [];

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  getJestSpyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  navigateSpy = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {
      return;
    });

  overviewSpy = jest
    .spyOn(DataObservabilityApi, "getOverview")
    .mockImplementation(async (): Promise<DataObservabilityOverview> => {
      if (overviewAnswer instanceof Error) {
        throw overviewAnswer;
      }
      return overviewAnswer;
    });
  jest
    .spyOn(DataObservabilityApi, "getQuality")
    .mockRejectedValue(new Error("not stubbed") as never);
  jest
    .spyOn(DataObservabilityApi, "getWatchedTables")
    .mockRejectedValue(new Error("not stubbed") as never);
  jest
    .spyOn(DataObservabilityApi, "getSourceSuggestions")
    .mockResolvedValue([]);

  getJestSpyOn(ModelAPI, "getList").mockImplementation(
    async (request: {
      modelType: unknown;
      query: Record<string, unknown>;
    }): Promise<unknown> => {
      if (
        request.modelType === DataAssetOwnerUser ||
        request.modelType === DataAssetOwnerTeam ||
        request.modelType === DataProduct
      ) {
        ownerQueries.push(request);

        if (ownersRead) {
          throw ownersRead;
        }
      }

      if (request.modelType === DataAssetOwnerUser) {
        return list([
          owner(DataAssetOwnerUser, {
            dataAssetId: new ObjectID(TABLE_PAYMENTS),
            user: { _id: "u1", name: "Ada Lovelace", email: "ada@example.com" },
          }),
          owner(DataAssetOwnerUser, {
            dataAssetId: new ObjectID(TABLE_PAYMENTS),
            user: { _id: "u2", name: "Grace Hopper" },
          }),
        ]);
      }

      if (request.modelType === DataAssetOwnerTeam) {
        return list([
          owner(DataAssetOwnerTeam, {
            dataAssetId: new ObjectID(TABLE_PAYMENTS),
            team: { _id: "t1", name: "Payments" },
          }),
          owner(DataAssetOwnerTeam, {
            dataAssetId: new ObjectID(TABLE_PAYMENTS),
            team: { _id: "t2", name: "Data Platform" },
          }),
        ]);
      }

      if (request.modelType === DataProduct) {
        return list([
          owner(
            DataProduct,
            productOwnerTeam
              ? { _id: PRODUCT, ownerTeam: productOwnerTeam }
              : { _id: PRODUCT },
          ),
        ]);
      }

      // The data sources nobody dismissed, and anything else: none.
      return list([]);
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
  for (const key of Object.keys(mockTranslations)) {
    delete mockTranslations[key];
  }
});

async function openPage(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <DataObservabilityOverviewPage {...pageProps} />
      </MemoryRouter>,
    );
  });
}

function attentionItems(): Array<HTMLElement> {
  return screen.queryAllByTestId(ATTENTION_ITEM_TEST_ID);
}

function itemNamed(name: string): HTMLElement {
  const found: HTMLElement | undefined = attentionItems().find(
    (element: HTMLElement): boolean => {
      return within(element).queryByText(name) !== null;
    },
  );

  expect(found).toBeDefined();

  return found!;
}

function hrefOf(element: HTMLElement): string | null {
  return element.closest("a")?.getAttribute("href") || null;
}

// A tile of the strip, by its label: its value as drawn.
function tileValue(label: string): string | null {
  const tiles: Array<HTMLElement> = screen
    .getAllByText(label, { selector: "span" })
    .map((element: HTMLElement): HTMLElement => {
      return element.parentElement!.parentElement!;
    })
    .filter((tile: HTMLElement): boolean => {
      return Boolean(tile.children[1]?.className.includes("text-lg"));
    });

  expect(tiles).toHaveLength(1);

  return tiles[0]!.children[1]!.textContent;
}

function step(name: DataObservabilitySetupStep): HTMLElement {
  return screen.getByTestId(`data-observability-setup-step-${name}`);
}

describe("a project with no database yet", () => {
  beforeEach(() => {
    overviewAnswer = busyOverview({
      storeCount: 0,
      stores: [],
      attention: [],
      attentionCount: 0,
      setup: { ...SETUP, storeCount: 0, storesWithAlertsCount: 0 },
    });
  });

  test("how it works and the way to connect one - not the steps or a list of nothing", async () => {
    await openPage();

    const showcase: HTMLElement = await screen.findByTestId(
      PRODUCT_SHOWCASE_TEST_ID,
    );

    expect(showcase).toHaveAttribute("data-product", "data-observability");
    expect(
      within(showcase).getByText(
        "Know when your data is late, wrong or changed",
      ),
    ).toBeInTheDocument();
    expect(
      within(showcase).getByRole("button", { name: /Connect a Database/ }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId(SETUP_STEPS_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(NEEDS_ATTENTION_TEST_ID)).toBeNull();
  });
});

describe("the first steps", () => {
  test("each step, done or to do, and the page each is done on", async () => {
    await openPage();

    const steps: HTMLElement = await screen.findByTestId(SETUP_STEPS_TEST_ID);

    // A region named by its title, as the product's other first-steps cards are.
    expect(
      screen.getByRole("region", {
        name: "Finish setting up Data Observability",
      }),
    ).toBe(steps);
    expect(
      within(steps).getByRole("heading", {
        name: "Finish setting up Data Observability",
      }),
    ).toBeInTheDocument();
    expect(
      within(steps).getByText(
        "These steps make sure the right people hear when a table breaks.",
      ),
    ).toBeInTheDocument();

    // How many are done, in words and as a bar: three of five.
    const progress: HTMLElement = within(steps).getByTestId(
      "data-observability-setup-progress",
    );

    expect(progress).toHaveTextContent("3 of 5 done");
    expect(
      (progress.querySelector("span > span") as HTMLElement).style.width,
    ).toBe("60%");

    expect(
      [
        DataObservabilitySetupStep.Connect,
        DataObservabilitySetupStep.Alerts,
        DataObservabilitySetupStep.Owners,
        DataObservabilitySetupStep.Checks,
        DataObservabilitySetupStep.Pipelines,
      ].map((name: DataObservabilitySetupStep) => {
        return step(name).getAttribute("data-done");
      }),
    ).toEqual(["true", "false", "true", "false", "true"]);

    // Set Up Alerts opens the alerts of the database that has none.
    expect(
      hrefOf(
        within(step(DataObservabilitySetupStep.Alerts)).getByText(
          "Set Up Alerts",
        ),
      ),
    ).toBe(
      routeTo(
        PageMap.DATA_OBSERVABILITY_STORE_VIEW_RECOMMENDATIONS,
        STORE_SILENT,
      ),
    );
    expect(
      hrefOf(
        within(step(DataObservabilitySetupStep.Checks)).getByText(
          "Open Tables",
        ),
      ),
    ).toBe(routeTo(PageMap.DATA_OBSERVABILITY_TABLES));

    // A step done says so, and offers nothing more to do.
    expect(
      within(step(DataObservabilitySetupStep.Owners)).queryByRole("link"),
    ).toBeNull();
    expect(
      within(step(DataObservabilitySetupStep.Owners)).getByText("(done)"),
    ).toBeInTheDocument();
  });

  test("Dismiss puts them away in this browser, for this project only", async () => {
    await openPage();

    const dismiss: HTMLElement = await screen.findByTestId(
      SETUP_STEPS_DISMISS_TEST_ID,
    );

    // Dismiss, as Home's and Security's first steps word it.
    expect(dismiss).toHaveTextContent("Dismiss");
    fireEvent.click(dismiss);

    expect(screen.queryByTestId(SETUP_STEPS_TEST_ID)).toBeNull();
    expect(
      window.localStorage.getItem(getSetupDismissedKey(PROJECT_ID)),
    ).not.toBeNull();

    cleanup();
    await openPage();
    await screen.findByTestId(NEEDS_ATTENTION_TEST_ID);
    expect(screen.queryByTestId(SETUP_STEPS_TEST_ID)).toBeNull();

    // Another project still sees its own.
    window.localStorage.clear();
    window.localStorage.setItem(
      getSetupDismissedKey("99999999-9999-4999-8999-999999999999"),
      "true",
    );
    cleanup();
    await openPage();
    expect(await screen.findByTestId(SETUP_STEPS_TEST_ID)).toBeInTheDocument();
  });

  test("a browser that keeps nothing still shows them, and still hides them for the visit", async () => {
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    await openPage();

    fireEvent.click(await screen.findByTestId(SETUP_STEPS_DISMISS_TEST_ID));

    expect(screen.queryByTestId(SETUP_STEPS_TEST_ID)).toBeNull();
  });

  test("every step done: they are gone", async () => {
    overviewAnswer = busyOverview({
      setup: {
        ...SETUP,
        storesWithAlertsCount: 2,
        firstStoreWithoutAlertsId: null,
        checkCount: 3,
      },
    });

    await openPage();

    await screen.findByTestId(NEEDS_ATTENTION_TEST_ID);
    expect(screen.queryByTestId(SETUP_STEPS_TEST_ID)).toBeNull();
  });
});

describe("what needs someone now", () => {
  test("worst first, as the server ordered them, each with what it means", async () => {
    await openPage();

    await screen.findByTestId(NEEDS_ATTENTION_TEST_ID);

    expect(
      attentionItems().map((element: HTMLElement) => {
        return element.getAttribute("data-kind");
      }),
    ).toEqual([
      DataAttentionKind.CollectionFailed,
      DataAttentionKind.PipelineFailed,
      DataAttentionKind.CheckFailing,
      DataAttentionKind.DataProductLate,
      DataAttentionKind.TableLate,
      DataAttentionKind.TableLate,
    ]);

    const warehouse: HTMLElement = itemNamed("warehouse");

    // Named as the Databases card names it: "Collection failed".
    expect(
      within(warehouse).getByText("Collection Failed"),
    ).toBeInTheDocument();
    expect(
      within(warehouse).getByText(
        "OneUptime could not read this database, so none of its tables is watched until it can.",
      ),
    ).toBeInTheDocument();
    expect(
      within(warehouse).getByText(
        "password authentication failed for user oneuptime_reader",
      ),
    ).toBeInTheDocument();
    expect(within(warehouse).getByText(/Last tried/)).toBeInTheDocument();
  });

  test("a late table says by how much, and each item opens the page where it is put right", async () => {
    await openPage();

    const payments: HTMLElement = await waitFor(() => {
      return itemNamed("public.payments");
    });

    expect(within(payments).getByText("Late by 4 hours")).toBeInTheDocument();
    expect(hrefOf(within(payments).getByText("Open Table"))).toBe(
      routeTo(PageMap.DATA_OBSERVABILITY_TABLE_VIEW, TABLE_PAYMENTS),
    );
    expect(
      hrefOf(within(itemNamed("warehouse")).getByText("Open Database")),
    ).toBe(routeTo(PageMap.DATA_OBSERVABILITY_STORE_VIEW, STORE_SILENT));
    expect(
      hrefOf(within(itemNamed("nightly_load")).getByText("Open Pipeline")),
    ).toBe(routeTo(PageMap.DATA_OBSERVABILITY_PIPELINE_VIEW, PIPELINE));
    expect(
      hrefOf(within(itemNamed("no duplicate orders")).getByText("Open Checks")),
    ).toBe(routeTo(PageMap.DATA_OBSERVABILITY_TABLE_VIEW_CHECKS, TABLE_ORDERS));
    expect(
      hrefOf(
        within(itemNamed("Finance dashboard")).getByText("Open Data Product"),
      ),
    ).toBe(routeTo(PageMap.DATA_OBSERVABILITY_DATA_PRODUCT_VIEW, PRODUCT));
  });

  test("who owns it, by name - three, then how many more; or no owner, and where to add one", async () => {
    await openPage();

    await waitFor(() => {
      expect(
        within(itemNamed("public.payments")).getByTestId(
          ATTENTION_OWNERS_TEST_ID,
        ),
      ).toHaveTextContent("Ada Lovelace");
    });

    const owners: HTMLElement = within(
      itemNamed("public.payments"),
    ).getByTestId(ATTENTION_OWNERS_TEST_ID);

    expect(owners).toHaveTextContent(
      "OwnersAda Lovelace, Grace Hopper, Paymentsand 1 more",
    );
    expect(owners).not.toHaveTextContent("Data Platform");

    // A data product: its own owner.
    expect(
      within(itemNamed("Finance dashboard")).getByTestId(
        ATTENTION_OWNERS_TEST_ID,
      ),
    ).toHaveTextContent("Finance Analytics");

    // A table nobody owns: where its owners are named.
    const clicks: HTMLElement = itemNamed("events.clicks");

    expect(within(clicks).getByText("No owner")).toBeInTheDocument();
    expect(hrefOf(within(clicks).getByText("Add one"))).toBe(
      routeTo(PageMap.DATA_OBSERVABILITY_TABLE_VIEW_OWNERS, TABLE_EVENTS),
    );

    // Only the tables and products told of are asked about.
    const assetQuery: Includes = ownerQueries.find(
      (query: OwnerQuery): boolean => {
        return query.modelType === DataAssetOwnerUser;
      },
    )!.query["dataAssetId"] as Includes;

    expect([...assetQuery.values].map(String).sort()).toEqual(
      [TABLE_ORDERS, TABLE_PAYMENTS, TABLE_EVENTS].sort(),
    );
  });

  test("a data product nobody owns: Add one opens its Settings, where its Owner Team is set", async () => {
    productOwnerTeam = null;

    await openPage();

    await waitFor(() => {
      expect(
        within(itemNamed("Finance dashboard")).getByText("No owner"),
      ).toBeInTheDocument();
    });

    expect(
      hrefOf(within(itemNamed("Finance dashboard")).getByText("Add one")),
    ).toBe(
      routeTo(PageMap.DATA_OBSERVABILITY_DATA_PRODUCT_VIEW_SETTINGS, PRODUCT),
    );
  });

  test("owners that cannot be read: nothing is said of who owns what, rather than no owner", async () => {
    ownersRead = new Error("You do not have permission");

    await openPage();

    await screen.findByTestId(NEEDS_ATTENTION_TEST_ID);
    await waitFor(() => {
      expect(ownerQueries.length).toBeGreaterThan(0);
    });

    expect(screen.queryByTestId(ATTENTION_OWNERS_TEST_ID)).toBeNull();
    expect(screen.queryByText("No owner")).toBeNull();
  });

  test("whether anyone was told: its open alert - or that nobody is, its database's alerts being off", async () => {
    await openPage();

    await screen.findByTestId(NEEDS_ATTENTION_TEST_ID);

    const alert: HTMLElement = within(
      itemNamed("no duplicate orders"),
    ).getByText("Alert ALT-7 is open");

    expect(hrefOf(alert)).toBe(routeTo(PageMap.ALERT_VIEW, ALERT));

    // events.clicks is in warehouse, which has no alert on.
    const clicks: HTMLElement = itemNamed("events.clicks");

    expect(
      within(clicks).getByText("Nobody is told: its alerts are off"),
    ).toBeInTheDocument();
    expect(hrefOf(within(clicks).getByText("Set Up Alerts"))).toBe(
      routeTo(
        PageMap.DATA_OBSERVABILITY_STORE_VIEW_RECOMMENDATIONS,
        STORE_SILENT,
      ),
    );

    // public.payments is in orders-db, whose alerts are on.
    expect(
      within(itemNamed("public.payments")).queryByText(
        "Nobody is told: its alerts are off",
      ),
    ).toBeNull();
  });

  test("the strip counts what needs someone, and says when the list is cut short", async () => {
    overviewAnswer = busyOverview({ attentionCount: 25 });

    await openPage();

    const card: HTMLElement = await screen.findByTestId(
      NEEDS_ATTENTION_TEST_ID,
    );

    expect(
      within(card).getByText(
        "The 6 most urgent of 25, worst first: what failed, then what is late.",
      ),
    ).toBeInTheDocument();

    expect(tileValue("Needs Attention")).toBe("25");
    expect(tileValue("Failing Checks")).toBe("1");
    expect(tileValue("Tables Watched")).toBe("1,840");
    expect(tileValue("Late Tables")).toBe("2");
  });

  test("the strip is one bar of cells, whose numbers wrap rather than being cut short", async () => {
    await openPage();

    const bar: HTMLElement = await screen.findByRole("group", {
      name: "Data health",
    });

    for (const label of [
      "Tables Watched",
      "Needs Attention",
      "Late Tables",
      "Failing Checks",
    ]) {
      const tile: HTMLElement = within(bar).getByText(label, {
        selector: "span",
      }).parentElement!.parentElement!;

      // A cell of the bar (EventStatTile variant="segment"), not a card in a card.
      expect(tile.className).not.toContain("rounded-xl");
      expect(tile.children[1]!.className).toContain("break-words");
      expect(tile.children[1]!.className).not.toContain("truncate");
    }

    /*
     * Laid out by its own width, not the window's: beside the side menu on
     * a laptop, four tiles go two by two until each label fits on a line.
     */
    expect(bar.parentElement!.className).toContain(
      "[container-type:inline-size]",
    );
    expect(bar.className).toContain(
      "[@container(min-width:56rem)]:grid-cols-4",
    );
    expect(bar.className).not.toContain("lg:grid-cols-4");
  });

  test("every word on the strip is looked up in the reader's language: its name, each tile's name and the line under it", async () => {
    const words: Array<string> = [
      "Data health",
      "Tables Watched",
      "In {{count}} connected databases.",
      "Needs Attention",
      "Broken, late or drifting now.",
      "Late Tables",
      "Tables that have gone well past their usual interval without a change.",
      "Failing Checks",
      "Checks whose alert is open.",
    ];
    for (const word of words) {
      mockTranslations[word] = `«${word}»`;
    }

    await openPage();

    const bar: HTMLElement = await screen.findByRole("group", {
      name: "«Data health»",
    });

    for (const word of words.slice(1)) {
      expect(
        within(bar).getByText(
          word === "In {{count}} connected databases."
            ? "«In 2 connected databases.»"
            : `«${word}»`,
        ),
      ).toBeInTheDocument();
    }
  });

  test("nothing wrong: it says what was looked at and found well", async () => {
    overviewAnswer = busyOverview({ attention: [], attentionCount: 0 });

    await openPage();

    const card: HTMLElement = await screen.findByTestId(
      NEEDS_ATTENTION_TEST_ID,
    );

    expect(
      within(card).getByText("Nothing is broken or late right now."),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(
        "Every database was read, no pipeline run failed, no check is failing, and every table is changing as often as it usually does.",
      ),
    ).toBeInTheDocument();
    expect(ownerQueries).toHaveLength(0);
  });

  test("nothing wrong yet, but a database just connected is not read: it never says every database was read", async () => {
    overviewAnswer = busyOverview({
      attention: [],
      attentionCount: 0,
      stores: [
        store(STORE_ALERTED, { name: "orders-db", alertMonitorCount: 4 }),
        store(STORE_SILENT, {
          name: "warehouse",
          kind: "Snowflake",
          status: null,
          collectedAt: null,
          assetCount: 0,
        }),
      ],
    });

    await openPage();

    const card: HTMLElement = await screen.findByTestId(
      NEEDS_ATTENTION_TEST_ID,
    );

    expect(
      within(card).getByText(
        "A database just connected is read for the first time within a few minutes, and its tables are watched from then on.",
      ),
    ).toBeInTheDocument();
    expect(within(card).queryByText(/^Every database was read/)).toBeNull();
  });
});

describe("the databases", () => {
  test("each says whether its alerts are on", async () => {
    await openPage();

    await screen.findByTestId(NEEDS_ATTENTION_TEST_ID);

    const statuses: Array<HTMLElement> = screen.getAllByTestId(
      STORE_ALERT_STATUS_TEST_ID,
    );

    expect(
      statuses.map((element: HTMLElement) => {
        return [element.getAttribute("data-alerts"), element.textContent];
      }),
    ).toEqual([
      ["on", "4 alerts on"],
      ["none", "No alerts on"],
    ]);
  });

  test("how each one's last read went: its tables, a failed read, or - just connected - its first read awaited, never 0 tables", async () => {
    overviewAnswer = busyOverview({
      stores: [
        store(STORE_ALERTED, { name: "orders-db", assetCount: 184 }),
        store(STORE_SILENT, {
          name: "warehouse",
          status: "Failed",
          message: "password authentication failed",
        }),
        store("10000000-0000-4000-8000-000000000003", {
          name: "billing-db",
          status: null,
          collectedAt: null,
          assetCount: 0,
        }),
        store("10000000-0000-4000-8000-000000000004", {
          name: "legacy-reports",
          isTableHealthEnabled: false,
          status: null,
          assetCount: 0,
        }),
      ],
    });

    await openPage();

    await screen.findByTestId(NEEDS_ATTENTION_TEST_ID);

    expect(
      screen
        .getAllByTestId("data-observability-store-row")
        .map((row: HTMLElement): string => {
          return row.children[1]!.textContent || "";
        }),
    ).toEqual([
      "184 tables",
      "Collection failed",
      "Waiting for first collection",
      "Not watched",
    ]);
  });
});

describe("a read that fails, and a server a version behind", () => {
  test("the Overview not read: says why, and Refresh reads it again", async () => {
    overviewAnswer = new Error("Data Observability is not reachable");

    await openPage();

    expect(
      await screen.findByText("Data Observability is not reachable"),
    ).toBeInTheDocument();

    overviewAnswer = busyOverview();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    });

    expect(await screen.findByTestId(NEEDS_ATTENTION_TEST_ID)).toBeVisible();
    expect(overviewSpy).toHaveBeenCalledTimes(2);
  });

  test("an answer with no attention, no setup and no alert counts: the page still says what it can", async () => {
    const old: Partial<DataObservabilityOverview> = { ...busyOverview() };

    delete old.attention;
    delete old.attentionCount;
    delete old.failingCheckCount;
    delete old.setup;
    old.stores = old.stores!.map((each: DataObservabilityStoreSummary) => {
      const copy: Partial<DataObservabilityStoreSummary> = { ...each };
      delete copy.alertMonitorCount;
      return copy as DataObservabilityStoreSummary;
    });
    overviewAnswer = old as DataObservabilityOverview;

    await openPage();

    const card: HTMLElement = await screen.findByTestId(
      NEEDS_ATTENTION_TEST_ID,
    );

    expect(
      within(card).getByText("Nothing is broken or late right now."),
    ).toBeInTheDocument();
    // What it cannot know, it does not guess.
    expect(screen.queryByTestId(SETUP_STEPS_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(STORE_ALERT_STATUS_TEST_ID)).toBeNull();
    expect(screen.getByText("orders-db")).toBeInTheDocument();
  });
});

describe("connecting a database", () => {
  test("from the Databases card: the new database opens on its alerts, which nobody hears of its tables without", async () => {
    await openPage();

    await screen.findByTestId(NEEDS_ATTENTION_TEST_ID);

    fireEvent.click(screen.getByRole("button", { name: /Connect a Database/ }));
    fireEvent.click(await screen.findByText("Stub: connected"));

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy.mock.calls[0]![0]!.toString()).toBe(
      routeTo(
        PageMap.DATA_OBSERVABILITY_STORE_VIEW_RECOMMENDATIONS,
        MOCK_CONNECTED_STORE,
      ),
    );
  });

  test("from how it works, on a project with none: the same", async () => {
    overviewAnswer = busyOverview({
      storeCount: 0,
      stores: [],
      attention: [],
      attentionCount: 0,
    });

    await openPage();

    fireEvent.click(
      await screen.findByRole("button", { name: /Connect a Database/ }),
    );
    fireEvent.click(await screen.findByText("Stub: connected"));

    expect(navigateSpy.mock.calls[0]![0]!.toString()).toBe(
      routeTo(
        PageMap.DATA_OBSERVABILITY_STORE_VIEW_RECOMMENDATIONS,
        MOCK_CONNECTED_STORE,
      ),
    );
  });
});
