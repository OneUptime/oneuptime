import * as fs from "fs";
import * as path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import RumProductAnalyticsSavedView from "../../../Models/DatabaseModels/RumProductAnalyticsSavedView";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  ProductAnalyticsEventField,
  ProductAnalyticsEventRef,
  ProductAnalyticsRetentionPeriod,
  ProductAnalyticsSegmentFilter,
} from "../../../Types/Rum/ProductAnalyticsEventReads";
import { ProductAnalyticsEventKind } from "../../../Types/Rum/ProductAnalyticsEvents";
import {
  PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS,
  ProductAnalyticsFunnelDefinition,
  ProductAnalyticsRetentionDefinition,
  ProductAnalyticsSavedViewType,
} from "../../../Types/Rum/ProductAnalyticsSavedViews";
import TimeRange from "../../../Types/Time/TimeRange";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import ProjectUtil from "../../../UI/Utils/Project";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * What the Funnels and User Retention pages and the dashboard widgets share
 * of saved funnels and retention tables (issue #6630), apart from React:
 * the words each kind is named with, the page's address (`?view=<id>`
 * beside the definition's own keys), the definition read off a page's
 * state and put back on it, the reads and writes of the saved views, and
 * the widget settings' list naming each one's application.
 */

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();
const deleteItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
      deleteItem: (...args: Array<unknown>): unknown => {
        return deleteItemMock(...args);
      },
    },
  };
});

import {
  PRODUCT_ANALYTICS_DEFINITION_URL_KEYS,
  PRODUCT_ANALYTICS_SAVED_VIEW_WORDS,
  ProductAnalyticsSavedView,
  ProductAnalyticsSavedViewAddress,
  SAVED_VIEW_CHANGED_TEMPLATE,
  SAVED_VIEW_DELETE_WIDGETS_NOTE,
  SAVED_VIEW_NAME_DESCRIPTION,
  SAVED_VIEW_UNREADABLE,
  SAVED_VIEW_UNREADABLE_NOTICE,
  applyProductAnalyticsFunnelDefinition,
  applyProductAnalyticsRetentionDefinition,
  deleteProductAnalyticsSavedView,
  describeProductAnalyticsSavedViewOptions,
  getProductAnalyticsSavedView,
  getProductAnalyticsSavedViewRoute,
  hasProductAnalyticsDefinitionInAddress,
  listProductAnalyticsSavedViews,
  nameProductAnalyticsSavedViewApplications,
  readProductAnalyticsSavedViewAddress,
  readProductAnalyticsSavedViewId,
  toProductAnalyticsFunnelDefinition,
  toProductAnalyticsRetentionDefinition,
  toProductAnalyticsSavedView,
  updateProductAnalyticsSavedViewDefinition,
  writeProductAnalyticsSavedViewId,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProductAnalytics/ProductAnalyticsSavedViews";
import {
  PRODUCT_ANALYTICS_EVENTS_URL_KEYS,
  ProductAnalyticsEventsUrlState,
  readProductAnalyticsEventsUrlState,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProductAnalytics/ProductAnalyticsEventsFormat";

const PROJECT_ID: string = "6a301111-0000-4000-8000-000000000001";
const APP_ID: string = "6a301111-0000-4000-8000-000000000002";
const OTHER_APP_ID: string = "6a301111-0000-4000-8000-000000000003";
const VIEW_ID: string = "6a301111-0000-4000-8000-000000000004";
const OTHER_VIEW_ID: string = "6a301111-0000-4000-8000-000000000005";

const DAY_MS: number = 24 * 60 * 60 * 1000;

const SIGN_UP: ProductAnalyticsEventRef = {
  kind: ProductAnalyticsEventKind.Custom,
  name: "Signed up",
};
const PURCHASED: ProductAnalyticsEventRef = {
  kind: ProductAnalyticsEventKind.Custom,
  name: "Purchased",
};
const SESSION: ProductAnalyticsEventRef = {
  kind: ProductAnalyticsEventKind.Session,
  name: "",
};
const PLAN: ProductAnalyticsSegmentFilter = {
  field: ProductAnalyticsEventField.Property,
  key: "plan",
  value: "pro",
};

const FUNNEL: ProductAnalyticsFunnelDefinition = {
  steps: [SIGN_UP, PURCHASED],
  windowMs: 7 * DAY_MS,
  filters: [PLAN],
};

const RETENTION: ProductAnalyticsRetentionDefinition = {
  startEvent: SIGN_UP,
  returnEvent: SESSION,
  period: ProductAnalyticsRetentionPeriod.Day,
  filters: [],
};

function row(data: {
  id?: string;
  name?: string;
  viewType?: string;
  definition?: unknown;
  rumApplicationId?: string;
}): RumProductAnalyticsSavedView {
  const saved: RumProductAnalyticsSavedView = new RumProductAnalyticsSavedView(
    new ObjectID(data.id || VIEW_ID),
  );

  saved.name = data.name === undefined ? "Sign-up to purchase" : data.name;
  saved.viewType = (data.viewType ||
    ProductAnalyticsSavedViewType.Funnel) as ProductAnalyticsSavedViewType;
  saved.definition = (
    data.definition === undefined ? FUNNEL : data.definition
  ) as JSONObject;
  saved.rumApplicationId = new ObjectID(data.rumApplicationId || APP_ID);

  return saved;
}

function application(id: string, name: string): RumApplication {
  const app: RumApplication = new RumApplication(new ObjectID(id));

  app.name = name;

  return app;
}

function firstCallArgument(mock: MockFunction): JSONObject {
  expect(mock).toHaveBeenCalledTimes(1);

  return mock.mock.calls[0]![0] as JSONObject;
}

beforeEach(() => {
  getListMock.mockReset();
  getItemMock.mockReset();
  updateByIdMock.mockReset();
  deleteItemMock.mockReset();
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the words each kind is named with", () => {
  const english: JSONObject = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Locales/en.json",
      ),
      "utf8",
    ),
  ) as JSONObject;

  test("a funnel's are of funnels, a retention table's of retention tables", () => {
    const funnel: Record<string, string> = PRODUCT_ANALYTICS_SAVED_VIEW_WORDS[
      ProductAnalyticsSavedViewType.Funnel
    ] as unknown as Record<string, string>;
    const retention: Record<string, string> =
      PRODUCT_ANALYTICS_SAVED_VIEW_WORDS[
        ProductAnalyticsSavedViewType.Retention
      ] as unknown as Record<string, string>;

    expect(Object.keys(funnel)).toEqual(Object.keys(retention));

    for (const key of Object.keys(funnel)) {
      expect([key, funnel[key] === retention[key]]).toEqual([key, false]);
    }

    expect(funnel["list"]).toBe("Saved funnels");
    expect(funnel["create"]).toBe("+ Save funnel");
    expect(retention["list"]).toBe("Saved retention tables");
    expect(retention["create"]).toBe("+ Save retention table");
    // The name field's example, as a team would name each.
    expect(funnel["namePlaceholder"]).toBe("Sign-up to first purchase");
    expect(retention["namePlaceholder"]).toBe("Weekly return after sign-up");
  });

  test("every one is translated: a key of the Dashboard's locale files", () => {
    const words: Array<string> = [
      ...Object.values(
        PRODUCT_ANALYTICS_SAVED_VIEW_WORDS[
          ProductAnalyticsSavedViewType.Funnel
        ],
      ),
      ...Object.values(
        PRODUCT_ANALYTICS_SAVED_VIEW_WORDS[
          ProductAnalyticsSavedViewType.Retention
        ],
      ),
      SAVED_VIEW_DELETE_WIDGETS_NOTE,
      SAVED_VIEW_CHANGED_TEMPLATE,
      SAVED_VIEW_NAME_DESCRIPTION,
      SAVED_VIEW_UNREADABLE,
      SAVED_VIEW_UNREADABLE_NOTICE,
    ] as Array<string>;

    for (const word of words) {
      expect([word, english[word]]).toEqual([word, word]);
    }

    expect(SAVED_VIEW_CHANGED_TEMPLATE).toContain("{{name}}");
    expect(SAVED_VIEW_UNREADABLE_NOTICE).toContain("{{name}}");
  });
});

describe("the page's address", () => {
  test("names a saved view by its id alone: anything else in `view` is no saved view", () => {
    expect(readProductAnalyticsSavedViewId(`?view=${VIEW_ID}`)).toBe(VIEW_ID);
    expect(
      readProductAnalyticsSavedViewId(`?range=Past%201%20Week&view=${VIEW_ID}`),
    ).toBe(VIEW_ID);

    for (const search of [
      "",
      "?view=",
      "?view=funnel",
      "?view=1",
      `?view=${VIEW_ID}x`,
      "?view=%3Cscript%3E",
      `?saved=${VIEW_ID}`,
    ]) {
      expect([search, readProductAnalyticsSavedViewId(search)]).toEqual([
        search,
        null,
      ]);
    }
  });

  test("writes the open one in, replaces it and takes it out, keeping the rest", () => {
    const base: string = `https://oneuptime.example/dashboard/${PROJECT_ID}/rum/${APP_ID}/product-analytics-funnels?step=custom%3ASigned+up&range=Past+1+Week`;

    const written: URL = new URL(
      writeProductAnalyticsSavedViewId(base, VIEW_ID),
    );

    expect(written.searchParams.get("view")).toBe(VIEW_ID);
    expect(written.searchParams.get("step")).toBe("custom:Signed up");
    expect(written.searchParams.get("range")).toBe("Past 1 Week");

    const replaced: URL = new URL(
      writeProductAnalyticsSavedViewId(written.toString(), OTHER_VIEW_ID),
    );

    expect(replaced.searchParams.getAll("view")).toEqual([OTHER_VIEW_ID]);

    const cleared: URL = new URL(
      writeProductAnalyticsSavedViewId(replaced.toString(), null),
    );

    expect(cleared.searchParams.has("view")).toBe(false);
    expect(cleared.searchParams.get("step")).toBe("custom:Signed up");
    expect(cleared.pathname).toBe(
      `/dashboard/${PROJECT_ID}/rum/${APP_ID}/product-analytics-funnels`,
    );
  });

  test("a funnel's address says what to read by its steps, window or segment; a retention table's by its events, period or segment", () => {
    expect(
      PRODUCT_ANALYTICS_DEFINITION_URL_KEYS[
        ProductAnalyticsSavedViewType.Funnel
      ],
    ).toEqual([
      PRODUCT_ANALYTICS_EVENTS_URL_KEYS.step,
      PRODUCT_ANALYTICS_EVENTS_URL_KEYS.window,
      PRODUCT_ANALYTICS_EVENTS_URL_KEYS.segment,
    ]);
    expect(
      PRODUCT_ANALYTICS_DEFINITION_URL_KEYS[
        ProductAnalyticsSavedViewType.Retention
      ],
    ).toEqual([
      PRODUCT_ANALYTICS_EVENTS_URL_KEYS.start,
      PRODUCT_ANALYTICS_EVENTS_URL_KEYS.return,
      PRODUCT_ANALYTICS_EVENTS_URL_KEYS.period,
      PRODUCT_ANALYTICS_EVENTS_URL_KEYS.segment,
    ]);

    for (const key of ["step", "within", "segment"]) {
      expect(
        hasProductAnalyticsDefinitionInAddress(
          `?${key}=x&view=${VIEW_ID}`,
          ProductAnalyticsSavedViewType.Funnel,
        ),
      ).toBe(true);
    }

    for (const key of ["start", "return", "per", "segment"]) {
      expect(
        hasProductAnalyticsDefinitionInAddress(
          `?${key}=x`,
          ProductAnalyticsSavedViewType.Retention,
        ),
      ).toBe(true);
    }

    // The range, the other page's keys and the saved view itself say nothing to read.
    expect(
      hasProductAnalyticsDefinitionInAddress(
        `?range=Past+1+Week&startTime=x&endTime=y&per=day&start=x&view=${VIEW_ID}`,
        ProductAnalyticsSavedViewType.Funnel,
      ),
    ).toBe(false);
    expect(
      hasProductAnalyticsDefinitionInAddress(
        `?step=x&within=86400000&view=${VIEW_ID}`,
        ProductAnalyticsSavedViewType.Retention,
      ),
    ).toBe(false);
  });

  test("opens the saved view it names when it says nothing else to read; a shared link's own definition wins", () => {
    const widgetLink: ProductAnalyticsSavedViewAddress =
      readProductAnalyticsSavedViewAddress(
        `?range=Past+1+Week&view=${VIEW_ID}`,
        ProductAnalyticsSavedViewType.Funnel,
      );

    expect(widgetLink).toEqual({
      savedViewId: VIEW_ID,
      isDefinitionInAddress: false,
      isOpening: true,
    });

    expect(
      readProductAnalyticsSavedViewAddress(
        `?step=custom%3ASigned+up&step=custom%3APurchased&view=${VIEW_ID}`,
        ProductAnalyticsSavedViewType.Funnel,
      ),
    ).toEqual({
      savedViewId: VIEW_ID,
      isDefinitionInAddress: true,
      isOpening: false,
    });

    expect(
      readProductAnalyticsSavedViewAddress(
        "?per=day",
        ProductAnalyticsSavedViewType.Retention,
      ),
    ).toEqual({
      savedViewId: null,
      isDefinitionInAddress: true,
      isOpening: false,
    });

    expect(
      readProductAnalyticsSavedViewAddress(
        "?view=not-an-id",
        ProductAnalyticsSavedViewType.Retention,
      ),
    ).toEqual({
      savedViewId: null,
      isDefinitionInAddress: false,
      isOpening: false,
    });
  });

  test("a saved view opens on its application's page, in the range given", () => {
    const funnelRoute: Route = getProductAnalyticsSavedViewRoute({
      rumApplicationId: new ObjectID(APP_ID),
      viewType: ProductAnalyticsSavedViewType.Funnel,
      savedViewId: VIEW_ID,
    });

    expect(funnelRoute.toString()).toBe(
      `/dashboard/${PROJECT_ID}/rum/${APP_ID}/product-analytics-funnels?view=${VIEW_ID}`,
    );

    const retentionRoute: Route = getProductAnalyticsSavedViewRoute({
      rumApplicationId: APP_ID,
      viewType: ProductAnalyticsSavedViewType.Retention,
      savedViewId: VIEW_ID,
      timeRange: {
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(
          new Date("2026-11-01T00:00:00.000Z"),
          new Date("2026-11-08T00:00:00.000Z"),
        ),
      },
    });
    const [pathname, search] = retentionRoute.toString().split("?") as [
      string,
      string,
    ];
    const params: URLSearchParams = new URLSearchParams(search);

    expect(pathname).toBe(
      `/dashboard/${PROJECT_ID}/rum/${APP_ID}/product-analytics-retention`,
    );
    expect(params.get("startTime")).toBe("2026-11-01T00:00:00.000Z");
    expect(params.get("endTime")).toBe("2026-11-08T00:00:00.000Z");
    expect(params.get("view")).toBe(VIEW_ID);

    // The link says only the saved view and the range: the page opens what it keeps.
    expect(
      readProductAnalyticsSavedViewAddress(
        `?${search}`,
        ProductAnalyticsSavedViewType.Retention,
      ).isOpening,
    ).toBe(true);

    const pastWeek: URLSearchParams = new URLSearchParams(
      getProductAnalyticsSavedViewRoute({
        rumApplicationId: APP_ID,
        viewType: ProductAnalyticsSavedViewType.Funnel,
        savedViewId: VIEW_ID,
        timeRange: { range: TimeRange.PAST_ONE_WEEK },
      })
        .toString()
        .split("?")[1],
    );

    expect(pastWeek.get("range")).toBe(TimeRange.PAST_ONE_WEEK);
    expect(pastWeek.get("view")).toBe(VIEW_ID);
  });
});

describe("a page's state and a definition", () => {
  function pageState(search: string): ProductAnalyticsEventsUrlState {
    return readProductAnalyticsEventsUrlState(search);
  }

  test("a funnel is nothing to save until its steps are known", () => {
    expect(
      toProductAnalyticsFunnelDefinition({
        steps: null,
        windowMs: DAY_MS,
        filters: [],
      }),
    ).toBeNull();
    expect(
      toProductAnalyticsFunnelDefinition({
        steps: [SIGN_UP],
        windowMs: DAY_MS,
        filters: [],
      }),
    ).toBeNull();
    expect(
      toProductAnalyticsFunnelDefinition({
        steps: [SIGN_UP, PURCHASED],
        windowMs: 7 * DAY_MS,
        filters: [PLAN],
      }),
    ).toEqual(FUNNEL);
  });

  test("a retention table keeps the period picked, its events and its segment", () => {
    const state: ProductAnalyticsEventsUrlState = pageState(
      "?start=custom%3ASigned+up&per=day",
    );

    expect(toProductAnalyticsRetentionDefinition(state)).toEqual(RETENTION);
  });

  test("opening a saved one puts what it keeps on the page and leaves the range", () => {
    const before: ProductAnalyticsEventsUrlState = pageState(
      "?range=Past+1+Week&step=session%3A&step=page%3A%2Fpricing&within=3600000&event=custom%3AOther",
    );

    const funnel: ProductAnalyticsEventsUrlState =
      applyProductAnalyticsFunnelDefinition(before, FUNNEL);

    expect(funnel.steps).toEqual(FUNNEL.steps);
    expect(funnel.windowMs).toBe(FUNNEL.windowMs);
    expect(funnel.filters).toEqual(FUNNEL.filters);
    expect(funnel.timeRange).toEqual(before.timeRange);
    expect(funnel.event).toEqual(before.event);
    expect(funnel.startEvent).toEqual(before.startEvent);
    // What it opened is what it saves again, unchanged.
    expect(
      toProductAnalyticsFunnelDefinition({
        steps: funnel.steps,
        windowMs: funnel.windowMs,
        filters: funnel.filters,
      }),
    ).toEqual(FUNNEL);

    const retention: ProductAnalyticsEventsUrlState =
      applyProductAnalyticsRetentionDefinition(before, RETENTION);

    expect(retention.startEvent).toEqual(RETENTION.startEvent);
    expect(retention.returnEvent).toEqual(RETENTION.returnEvent);
    expect(retention.period).toBe(RETENTION.period);
    expect(retention.filters).toEqual(RETENTION.filters);
    expect(retention.steps).toEqual(before.steps);
    expect(retention.timeRange).toEqual(before.timeRange);
    expect(toProductAnalyticsRetentionDefinition(retention)).toEqual(RETENTION);
  });
});

describe("a saved view as the pages and widgets hold it", () => {
  test("a row of its kind, its definition read as untrusted", () => {
    expect(
      toProductAnalyticsSavedView(
        row({}),
        ProductAnalyticsSavedViewType.Funnel,
      ),
    ).toEqual({
      id: VIEW_ID,
      name: "Sign-up to purchase",
      rumApplicationId: APP_ID,
      viewType: ProductAnalyticsSavedViewType.Funnel,
      definition: FUNNEL,
      problem: null,
    });
  });

  test("a row of the other kind is none of this kind's", () => {
    expect(
      toProductAnalyticsSavedView(
        row({ viewType: ProductAnalyticsSavedViewType.Retention }),
        ProductAnalyticsSavedViewType.Funnel,
      ),
    ).toBeNull();
  });

  test("a definition this version cannot read is said, not shown", () => {
    const view: ProductAnalyticsSavedView<ProductAnalyticsSavedViewType.Funnel> | null =
      toProductAnalyticsSavedView(
        row({ definition: { steps: [SIGN_UP] } }),
        ProductAnalyticsSavedViewType.Funnel,
      );

    expect(view?.definition).toBeNull();
    expect(view?.problem).toBe(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.steps);
    expect(view?.name).toBe("Sign-up to purchase");
  });
});

describe("the reads and writes", () => {
  test("lists an application's saved views of one kind, by name, the whole list, in the current project", async () => {
    getListMock.mockResolvedValue({
      data: [
        row({ id: VIEW_ID, name: "A funnel" }),
        // A row of the other kind, which a script may have written past the query.
        row({
          id: OTHER_VIEW_ID,
          name: "A table",
          viewType: ProductAnalyticsSavedViewType.Retention,
          definition: RETENTION,
        }),
      ],
      count: 2,
      skip: 0,
      limit: 100,
    });

    const views: Array<
      ProductAnalyticsSavedView<ProductAnalyticsSavedViewType.Funnel>
    > = await listProductAnalyticsSavedViews({
      rumApplicationId: new ObjectID(APP_ID),
      viewType: ProductAnalyticsSavedViewType.Funnel,
    });

    expect(
      views.map(
        (
          view: ProductAnalyticsSavedView<ProductAnalyticsSavedViewType.Funnel>,
        ): string => {
          return view.name;
        },
      ),
    ).toEqual(["A funnel"]);

    const request: JSONObject = firstCallArgument(getListMock);
    const query: JSONObject = request["query"] as JSONObject;

    expect(request["modelType"]).toBe(RumProductAnalyticsSavedView);
    expect((query["projectId"] as ObjectID).toString()).toBe(PROJECT_ID);
    expect((query["rumApplicationId"] as ObjectID).toString()).toBe(APP_ID);
    expect(query["viewType"]).toBe(ProductAnalyticsSavedViewType.Funnel);
    expect(request["limit"]).toBe(100);
    expect(request["skip"]).toBe(0);
    expect(request["sort"]).toEqual({ name: SortOrder.Ascending });
    expect(request["select"]).toEqual({
      _id: true,
      name: true,
      rumApplicationId: true,
      viewType: true,
      definition: true,
    });
  });

  test("reads one by its id, as a widget and a link do", async () => {
    const saved: RumProductAnalyticsSavedView = row({});

    getItemMock.mockResolvedValue(saved);

    expect(await getProductAnalyticsSavedView(VIEW_ID)).toBe(saved);

    const request: JSONObject = firstCallArgument(getItemMock);

    expect(request["modelType"]).toBe(RumProductAnalyticsSavedView);
    expect((request["id"] as ObjectID).toString()).toBe(VIEW_ID);
    expect(request["select"]).toEqual({
      _id: true,
      name: true,
      rumApplicationId: true,
      viewType: true,
      definition: true,
    });
  });

  test("Update writes the definition on screen, and nothing else", async () => {
    updateByIdMock.mockResolvedValue(undefined);

    await updateProductAnalyticsSavedViewDefinition({
      savedViewId: VIEW_ID,
      definition: FUNNEL,
    });

    const request: JSONObject = firstCallArgument(updateByIdMock);

    expect(request["modelType"]).toBe(RumProductAnalyticsSavedView);
    expect((request["id"] as ObjectID).toString()).toBe(VIEW_ID);
    expect(request["data"]).toEqual({ definition: FUNNEL });
  });

  test("Delete deletes that one", async () => {
    deleteItemMock.mockResolvedValue(undefined);

    await deleteProductAnalyticsSavedView(VIEW_ID);

    const request: JSONObject = firstCallArgument(deleteItemMock);

    expect(request["modelType"]).toBe(RumProductAnalyticsSavedView);
    expect((request["id"] as ObjectID).toString()).toBe(VIEW_ID);
  });
});

describe("a widget's settings name each saved view's application", () => {
  function options(names: Array<string>): Array<DropdownOption> {
    return names.map((name: string, index: number): DropdownOption => {
      return { label: name, value: `${index}` };
    });
  }

  test("under each option, by the row it was made from", () => {
    const listed: Array<DropdownOption> = options([
      "Sign-up",
      "Sign-up",
      "Ghost",
    ]);

    nameProductAnalyticsSavedViewApplications({
      items: [
        row({ id: VIEW_ID, name: "Sign-up", rumApplicationId: APP_ID }),
        row({
          id: OTHER_VIEW_ID,
          name: "Sign-up",
          rumApplicationId: OTHER_APP_ID,
        }),
        row({
          id: "6a301111-0000-4000-8000-000000000009",
          name: "Ghost",
          rumApplicationId: "6a301111-0000-4000-8000-00000000000a",
        }),
      ],
      options: listed,
      applicationNames: new Map<string, string>([
        [APP_ID, "Web shop"],
        [OTHER_APP_ID, "Mobile app"],
      ]),
    });

    expect(listed[0]?.description).toBe("Web shop");
    expect(listed[1]?.description).toBe("Mobile app");
    // An application this reader cannot see leaves the name alone.
    expect(listed[2]?.description).toBeUndefined();
  });

  test("reads the applications' names once, by their ids, in the project", async () => {
    getListMock.mockResolvedValue({
      data: [
        application(APP_ID, "Web shop"),
        application(OTHER_APP_ID, "Mobile app"),
      ],
      count: 2,
      skip: 0,
      limit: 2,
    });

    const listed: Array<DropdownOption> = options(["A", "B", "C"]);

    await describeProductAnalyticsSavedViewOptions({
      items: [
        row({ id: VIEW_ID, rumApplicationId: APP_ID }),
        row({ id: OTHER_VIEW_ID, rumApplicationId: OTHER_APP_ID }),
        row({
          id: "6a301111-0000-4000-8000-000000000009",
          rumApplicationId: APP_ID,
        }),
      ],
      options: listed,
      projectId: new ObjectID(PROJECT_ID),
    });

    expect(
      listed.map((option: DropdownOption): string | undefined => {
        return option.description;
      }),
    ).toEqual(["Web shop", "Mobile app", "Web shop"]);

    const request: JSONObject = firstCallArgument(getListMock);
    const query: JSONObject = request["query"] as JSONObject;
    const ids: Includes = query["_id"] as Includes;

    expect(request["modelType"]).toBe(RumApplication);
    expect((query["projectId"] as ObjectID).toString()).toBe(PROJECT_ID);
    expect(ids).toBeInstanceOf(Includes);
    expect(
      ids.values.map((id: unknown): string => {
        return String(id);
      }),
    ).toEqual([APP_ID, OTHER_APP_ID]);
    expect(request["limit"]).toBe(2);
    expect(request["select"]).toEqual({ _id: true, name: true });
  });

  test("a reader who may not list applications keeps the names alone", async () => {
    getListMock.mockRejectedValue(new Error("You do not have permission"));

    const listed: Array<DropdownOption> = options(["A"]);

    await expect(
      describeProductAnalyticsSavedViewOptions({
        items: [row({})],
        options: listed,
        projectId: new ObjectID(PROJECT_ID),
      }),
    ).resolves.toBeUndefined();
    expect(listed[0]?.description).toBeUndefined();
  });

  test("reads nothing when no option names an application", async () => {
    await describeProductAnalyticsSavedViewOptions({
      items: [],
      options: [],
      projectId: new ObjectID(PROJECT_ID),
    });

    expect(getListMock).not.toHaveBeenCalled();
  });
});
