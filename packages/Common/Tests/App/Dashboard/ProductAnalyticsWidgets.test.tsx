import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
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
import { MemoryRouter, useLocation } from "react-router-dom";
import RumProductAnalyticsSavedView from "../../../Models/DatabaseModels/RumProductAnalyticsSavedView";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DashboardProductAnalyticsFunnelComponent from "../../../Types/Dashboard/DashboardComponents/DashboardProductAnalyticsFunnelComponent";
import DashboardProductAnalyticsRetentionComponent from "../../../Types/Dashboard/DashboardComponents/DashboardProductAnalyticsRetentionComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { ProductAnalyticsSavedViewType } from "../../../Types/Rum/ProductAnalyticsSavedViews";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import ProjectUtil from "../../../UI/Utils/Project";
import DashboardProductAnalyticsFunnelComponentUtil from "../../../Utils/Dashboard/Components/DashboardProductAnalyticsFunnelComponent";
import DashboardProductAnalyticsRetentionComponentUtil from "../../../Utils/Dashboard/Components/DashboardProductAnalyticsRetentionComponent";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import {
  ProductAnalyticsTestAnswer,
  answerProductAnalyticsReads,
  lastProductAnalyticsRequestTo,
  productAnalyticsRequestsTo,
} from "../../UI/Rum/ProductAnalyticsEventsPageKit";

/*
 * The Funnel and Retention dashboard widgets (issue #6630): each shows a
 * funnel or a retention table saved on a RUM application's page, read with
 * the dashboard's time range through the pages' own read routes. Its title
 * is the saved one's name unless the widget names it; "Open in Funnels" or
 * "Open in User Retention" opens the page on it, in the board's range; and
 * where there is nothing to draw it says why - none picked, deleted or not
 * this reader's, a definition this version cannot read, a refused read.
 *
 * Every read is stood in for: the saved one through ModelAPI.getItem, the
 * funnel and the retention table through API.post.
 */

const postMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        return error instanceof HTTPErrorResponse || error instanceof Error
          ? error.message
          : String(error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
    },
  };
});

import DashboardProductAnalyticsFunnelComponentElement, {
  FUNNEL_WIDGET_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardProductAnalyticsFunnelComponent";
import DashboardProductAnalyticsRetentionComponentElement, {
  RETENTION_WIDGET_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardProductAnalyticsRetentionComponent";
import {
  PRODUCT_ANALYTICS_WIDGET_WORDS,
  ProductAnalyticsWidgetSavedView,
  ProductAnalyticsWidgetState,
  areProductAnalyticsWidgetPropsEqual,
  getProductAnalyticsWidgetSavedView,
  readProductAnalyticsWidgetSavedViewId,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardProductAnalyticsWidget";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import {
  PublicDashboardContext,
  setPublicDashboardContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import { ProductAnalyticsRead } from "../../../../App/FeatureSet/Dashboard/src/Components/ProductAnalytics/useProductAnalyticsRead";
import {
  DASHBOARD_WIDGET_ERROR_LINE_CLASS_NAME,
  DASHBOARD_WIDGET_ERROR_LINE_TEST_ID,
  DashboardWidgetPlace,
  getDashboardWidgetSetupLine,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetSetupCopy";
import { DASHBOARD_WIDGET_ERROR_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetError";

const PROJECT_ID: string = "6a305555-0000-4000-8000-000000000001";

/*
 * A refused read is every widget's error line (issue #7330): under the
 * widget's icon, readable, never a page's error with a page's margins.
 */
function expectWidgetErrorLine(words: string): void {
  const line: HTMLElement = screen.getByTestId(
    DASHBOARD_WIDGET_ERROR_LINE_TEST_ID,
  );

  expect(line).toHaveTextContent(words);
  expect(line.className).toBe(DASHBOARD_WIDGET_ERROR_LINE_CLASS_NAME);
  expect(screen.getByTestId(DASHBOARD_WIDGET_ERROR_TEST_ID)).toContainElement(
    line,
  );
  expect(line.closest(".my-10")).toBeNull();
}
const APP_ID: string = "6a305555-0000-4000-8000-000000000002";
const FUNNEL_ID: string = "6a305555-0000-4000-8000-000000000003";
const RETENTION_ID: string = "6a305555-0000-4000-8000-000000000004";
const OTHER_ID: string = "6a305555-0000-4000-8000-000000000005";

const DAY_MS: number = 24 * 60 * 60 * 1000;

const COMPONENT_ID: ObjectID = new ObjectID(
  "6a305555-0000-4000-8000-000000000006",
);

// A CUSTOM range: the window never depends on the clock.
const BOARD_START: Date = new Date("2026-11-01T00:00:00.000Z");
const BOARD_END: Date = new Date("2026-11-08T00:00:00.000Z");

const BOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(BOARD_START, BOARD_END),
};

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 60,
};

const FUNNEL_DEFINITION: JSONObject = {
  steps: [
    { kind: "page", name: "/pricing" },
    { kind: "custom", name: "Purchased" },
  ],
  windowMs: 7 * DAY_MS,
  filters: [{ field: "country", key: "", value: "DE" }],
};

const RETENTION_DEFINITION: JSONObject = {
  startEvent: { kind: "custom", name: "Signed up" },
  returnEvent: { kind: "custom", name: "Purchased" },
  period: "day",
  filters: [{ field: "userProperty", key: "plan", value: "pro" }],
};

function savedRow(data: {
  id: string;
  name: string;
  viewType: ProductAnalyticsSavedViewType;
  definition: JSONObject;
}): RumProductAnalyticsSavedView {
  const row: RumProductAnalyticsSavedView = new RumProductAnalyticsSavedView(
    new ObjectID(data.id),
  );

  row.name = data.name;
  row.viewType = data.viewType;
  row.rumApplicationId = new ObjectID(APP_ID);
  row.definition = data.definition;

  return row;
}

function savedFunnel(definition?: JSONObject): RumProductAnalyticsSavedView {
  return savedRow({
    id: FUNNEL_ID,
    name: "Pricing to purchase",
    viewType: ProductAnalyticsSavedViewType.Funnel,
    definition: definition || FUNNEL_DEFINITION,
  });
}

function savedRetention(): RumProductAnalyticsSavedView {
  return savedRow({
    id: RETENTION_ID,
    name: "Buyers who come back",
    viewType: ProductAnalyticsSavedViewType.Retention,
    definition: RETENTION_DEFINITION,
  });
}

// Each step's people, as the Funnels page suite answers them.
function funnelAnswer(data: JSONObject): JSONObject {
  const steps: Array<JSONObject> = data["steps"] as Array<JSONObject>;
  const people: Array<number> = [400, 100, 40];

  return {
    windowMs: data["windowMs"] as number,
    steps: steps.map((step: JSONObject, index: number): JSONObject => {
      const reached: number = people[index] ?? 1;
      const previous: number = index === 0 ? reached : people[index - 1]!;

      return {
        ...step,
        people: reached,
        conversionFromStart: reached / people[0]!,
        conversionFromPrevious: index === 0 ? 1 : reached / previous,
        droppedOff: index === 0 ? 0 : previous - reached,
        medianMsFromPrevious: index === 0 ? null : 90 * 1000,
      };
    }),
  };
}

function retentionAnswer(data: JSONObject): JSONObject {
  return {
    period: data["period"] as string,
    timeZone: data["timeZone"] as string,
    cohorts: [
      { start: "2026-11-01", people: 200, returning: [200, 90, 40] },
      { start: "2026-11-02", people: 100, returning: [100, 30, null] },
      { start: "2026-11-03", people: 50, returning: [50, null, null] },
    ],
  };
}

function answerReads(
  answers?: Partial<
    Record<
      string,
      | ProductAnalyticsTestAnswer
      | ((data: JSONObject) => ProductAnalyticsTestAnswer)
    >
  >,
): void {
  answerProductAnalyticsReads(postMock, {
    funnel: funnelAnswer,
    retention: retentionAnswer,
    ...(answers as Record<
      string,
      | ProductAnalyticsTestAnswer
      | ((data: JSONObject) => ProductAnalyticsTestAnswer)
    >),
  });
}

function buildProps(
  overrides?: Partial<DashboardBaseComponentProps>,
): DashboardBaseComponentProps {
  return {
    componentId: COMPONENT_ID,
    isEditMode: false,
    isSelected: false,
    key: "product-analytics-widget",
    onComponentUpdate: (): void => {
      // The widget never writes back through this.
    },
    totalCurrentDashboardWidthInPx: 1200,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1200,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 390,
    dashboardComponentWidthInPx: 480,
    dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
    dashboardStartAndEndDate: BOARD_RANGE,
    metricTypes: [],
    refreshTick: 0,
    variables: undefined,
    dashboardId: "6a305555-0000-4000-8000-000000000007",
    ...overrides,
  };
}

function funnelComponent(
  args: DashboardProductAnalyticsFunnelComponent["arguments"],
): DashboardProductAnalyticsFunnelComponent {
  const component: DashboardProductAnalyticsFunnelComponent =
    DashboardProductAnalyticsFunnelComponentUtil.getDefaultComponent();

  component.componentId = COMPONENT_ID;
  component.arguments = args;

  return component;
}

function retentionComponent(
  args: DashboardProductAnalyticsRetentionComponent["arguments"],
): DashboardProductAnalyticsRetentionComponent {
  const component: DashboardProductAnalyticsRetentionComponent =
    DashboardProductAnalyticsRetentionComponentUtil.getDefaultComponent();

  component.componentId = COMPONENT_ID;
  component.arguments = args;

  return component;
}

/*
 * A board is drawn in the app's router: the link to the page is a link
 * (AppLink). Kept through a rerender.
 */
function InRouter(props: { children?: React.ReactNode }): React.ReactElement {
  return <MemoryRouter>{props.children}</MemoryRouter>;
}

function renderFunnel(
  args: DashboardProductAnalyticsFunnelComponent["arguments"],
  overrides?: Partial<DashboardBaseComponentProps>,
): ReturnType<typeof render> {
  return render(
    <DashboardProductAnalyticsFunnelComponentElement
      {...buildProps(overrides)}
      component={funnelComponent(args)}
    />,
    { wrapper: InRouter },
  );
}

function renderRetention(
  args: DashboardProductAnalyticsRetentionComponent["arguments"],
  overrides?: Partial<DashboardBaseComponentProps>,
): ReturnType<typeof render> {
  return render(
    <DashboardProductAnalyticsRetentionComponentElement
      {...buildProps(overrides)}
      component={retentionComponent(args)}
    />,
    { wrapper: InRouter },
  );
}

// Where a widget's link goes: its page, and what its address says.
function linkTarget(link: HTMLElement): {
  pathname: string;
  params: URLSearchParams;
} {
  const [pathname, search] = (link.getAttribute("href") || "").split("?") as [
    string,
    string,
  ];

  return { pathname: pathname, params: new URLSearchParams(search) };
}

function read(
  data: Partial<ProductAnalyticsRead<RumProductAnalyticsSavedView | null>>,
): ProductAnalyticsRead<RumProductAnalyticsSavedView | null> {
  return {
    data: null,
    isLoading: false,
    error: "",
    reload: (): void => {
      // Never reloaded here.
    },
    ...data,
  };
}

// The id each saved-one read asked for.
function savedViewReads(): Array<string> {
  return getItemMock.mock.calls.map((call: Array<unknown>): string => {
    return String((call[0] as { id: ObjectID }).id);
  });
}

beforeEach(() => {
  postMock.mockReset();
  getItemMock.mockReset();
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
});

afterEach(() => {
  cleanup();
  setPublicDashboardContext(null);
  jest.restoreAllMocks();
});

describe("what a widget makes of its saved one", () => {
  test("on a public dashboard: nothing to read, whatever it names or holds", () => {
    expect(
      getProductAnalyticsWidgetSavedView({
        savedViewId: FUNNEL_ID,
        viewType: ProductAnalyticsSavedViewType.Funnel,
        isPublic: true,
        read: read({ data: savedFunnel() }),
      }),
    ).toEqual({
      state: ProductAnalyticsWidgetState.NotOnPublic,
      view: null,
      error: "",
    });
  });

  test("none picked yet: its settings are where to pick one", () => {
    expect(
      getProductAnalyticsWidgetSavedView({
        savedViewId: null,
        viewType: ProductAnalyticsSavedViewType.Funnel,
        isPublic: false,
        read: read({}),
      }).state,
    ).toBe(ProductAnalyticsWidgetState.Setup);
  });

  test("a refused read: the server's words", () => {
    expect(
      getProductAnalyticsWidgetSavedView({
        savedViewId: FUNNEL_ID,
        viewType: ProductAnalyticsSavedViewType.Funnel,
        isPublic: false,
        read: read({ error: "Your plan does not include this." }),
      }),
    ).toEqual({
      state: ProductAnalyticsWidgetState.Error,
      view: null,
      error: "Your plan does not include this.",
    });
  });

  test("the first read on its way: loading", () => {
    expect(
      getProductAnalyticsWidgetSavedView({
        savedViewId: FUNNEL_ID,
        viewType: ProductAnalyticsSavedViewType.Funnel,
        isPublic: false,
        read: read({ isLoading: true }),
      }).state,
    ).toBe(ProductAnalyticsWidgetState.Loading);
  });

  test("read, and nothing came back: deleted, or not this reader's to see", () => {
    expect(
      getProductAnalyticsWidgetSavedView({
        savedViewId: FUNNEL_ID,
        viewType: ProductAnalyticsSavedViewType.Funnel,
        isPublic: false,
        read: read({ data: null, isLoading: false }),
      }).state,
    ).toBe(ProductAnalyticsWidgetState.Missing);
  });

  test("a saved one of the other kind is none of this widget's", () => {
    const retentionUnderFunnelId: RumProductAnalyticsSavedView = savedRow({
      id: FUNNEL_ID,
      name: "Buyers who come back",
      viewType: ProductAnalyticsSavedViewType.Retention,
      definition: RETENTION_DEFINITION,
    });

    expect(
      getProductAnalyticsWidgetSavedView({
        savedViewId: FUNNEL_ID,
        viewType: ProductAnalyticsSavedViewType.Funnel,
        isPublic: false,
        read: read({ data: retentionUnderFunnelId }),
      }).state,
    ).toBe(ProductAnalyticsWidgetState.Missing);
  });

  test("a definition this version cannot read: named, never drawn", () => {
    const saved: ProductAnalyticsWidgetSavedView<ProductAnalyticsSavedViewType.Funnel> =
      getProductAnalyticsWidgetSavedView({
        savedViewId: FUNNEL_ID,
        viewType: ProductAnalyticsSavedViewType.Funnel,
        isPublic: false,
        read: read({ data: savedFunnel({ steps: [], windowMs: DAY_MS }) }),
      });

    expect(saved.state).toBe(ProductAnalyticsWidgetState.Unreadable);
    expect(saved.view?.name).toBe("Pricing to purchase");
    expect(saved.view?.definition).toBeNull();
  });

  test("read: ready, with the steps, the window and the segment it keeps", () => {
    const saved: ProductAnalyticsWidgetSavedView<ProductAnalyticsSavedViewType.Funnel> =
      getProductAnalyticsWidgetSavedView({
        savedViewId: FUNNEL_ID,
        viewType: ProductAnalyticsSavedViewType.Funnel,
        isPublic: false,
        read: read({ data: savedFunnel() }),
      });

    expect(saved.state).toBe(ProductAnalyticsWidgetState.Ready);
    expect(saved.view?.id).toBe(FUNNEL_ID);
    expect(saved.view?.rumApplicationId).toBe(APP_ID);
    expect(saved.view?.definition).toEqual(FUNNEL_DEFINITION);
  });

  test("a refresh keeps it on screen while it is read again", () => {
    expect(
      getProductAnalyticsWidgetSavedView({
        savedViewId: FUNNEL_ID,
        viewType: ProductAnalyticsSavedViewType.Funnel,
        isPublic: false,
        read: read({ data: savedFunnel(), isLoading: true }),
      }).state,
    ).toBe(ProductAnalyticsWidgetState.Ready);
  });

  test("the last setting's saved one while the next is read: loading, never the other one", () => {
    const saved: ProductAnalyticsWidgetSavedView<ProductAnalyticsSavedViewType.Funnel> =
      getProductAnalyticsWidgetSavedView({
        savedViewId: OTHER_ID,
        viewType: ProductAnalyticsSavedViewType.Funnel,
        isPublic: false,
        read: read({ data: savedFunnel(), isLoading: true }),
      });

    expect(saved.state).toBe(ProductAnalyticsWidgetState.Loading);
    expect(saved.view).toBeNull();
  });
});

describe("a widget's saved id", () => {
  test.each([
    [FUNNEL_ID, FUNNEL_ID],
    ["", null],
    ["   ", null],
    [undefined, null],
    [null, null],
    [42, null],
    [[FUNNEL_ID], null],
    ["pricing-to-purchase", null],
    [{ id: FUNNEL_ID }, null],
    [{ _type: "ObjectID", value: "pricing-to-purchase" }, null],
    [{ _type: "Includes", value: [FUNNEL_ID] }, null],
  ])("%p is read as %p", (value: unknown, expected: string | null) => {
    expect(readProductAnalyticsWidgetSavedViewId(value)).toBe(expected);
  });

  /*
   * As every board reads a widget's ids (DashboardWidgetIds): the API,
   * Terraform or a script may store the id as an ObjectID's JSON, and a
   * board that could not revive the rest of the widget hands it on as that.
   */
  test("an ObjectID, or its JSON, is read as the id it names", () => {
    expect(readProductAnalyticsWidgetSavedViewId(new ObjectID(FUNNEL_ID))).toBe(
      FUNNEL_ID,
    );
    expect(
      readProductAnalyticsWidgetSavedViewId({
        _type: "ObjectID",
        value: RETENTION_ID,
      }),
    ).toBe(RETENTION_ID);
  });
});

describe("the Funnel widget", () => {
  test("reads the saved funnel in the dashboard's range, and draws each step under its name", async () => {
    getItemMock.mockResolvedValue(savedFunnel());
    answerReads();

    renderFunnel({ savedViewId: FUNNEL_ID });

    await waitFor(() => {
      expect(
        screen.getAllByTestId(`${FUNNEL_WIDGET_TEST_ID}-chart-step`),
      ).toHaveLength(2);
    });

    expect(savedViewReads()).toEqual([FUNNEL_ID]);

    const request: JSONObject = lastProductAnalyticsRequestTo(
      postMock,
      "funnel",
    );

    expect(request["rumApplicationId"]).toBe(APP_ID);
    expect(request["steps"]).toEqual(FUNNEL_DEFINITION["steps"]);
    expect(request["windowMs"]).toBe(7 * DAY_MS);
    expect(request["filters"]).toEqual(FUNNEL_DEFINITION["filters"]);
    expect(new Date(request["startTime"] as string).toISOString()).toBe(
      BOARD_START.toISOString(),
    );
    expect(new Date(request["endTime"] as string).toISOString()).toBe(
      BOARD_END.toISOString(),
    );
    expect(productAnalyticsRequestsTo(postMock, "funnel")).toHaveLength(1);

    expect(
      screen.getByTestId(`${FUNNEL_WIDGET_TEST_ID}-title`),
    ).toHaveTextContent("Pricing to purchase");
    expect(
      screen.getByTestId(`${FUNNEL_WIDGET_TEST_ID}-completion`),
    ).toHaveTextContent("25% did every step");
  });

  test("its own title wins over the saved funnel's name", async () => {
    getItemMock.mockResolvedValue(savedFunnel());
    answerReads();

    renderFunnel({ savedViewId: FUNNEL_ID, title: "  Checkout watch  " });

    await screen.findAllByTestId(`${FUNNEL_WIDGET_TEST_ID}-chart-step`);
    expect(
      screen.getByTestId(`${FUNNEL_WIDGET_TEST_ID}-title`),
    ).toHaveTextContent("Checkout watch");
    expect(screen.queryByText("Pricing to purchase")).not.toBeInTheDocument();
  });

  test("Open in Funnels links to the page on the saved funnel, in the dashboard's range, and is no click on the widget", async () => {
    getItemMock.mockResolvedValue(savedFunnel());
    answerReads();

    const onWidgetClick: MockFunction = getJestMockFunction();

    // Where the router went, once the link is followed.
    const LocationProbe: () => React.ReactElement = (): React.ReactElement => {
      const location: ReturnType<typeof useLocation> = useLocation();

      return (
        <div data-testid="location">{`${location.pathname}${location.search}`}</div>
      );
    };

    render(
      <MemoryRouter>
        <div onClick={onWidgetClick as never}>
          <DashboardProductAnalyticsFunnelComponentElement
            {...buildProps()}
            component={funnelComponent({ savedViewId: FUNNEL_ID })}
          />
        </div>
        <LocationProbe />
      </MemoryRouter>,
    );

    await screen.findAllByTestId(`${FUNNEL_WIDGET_TEST_ID}-chart-step`);

    /*
     * An icon at the title's end, named by its words - to assistive tech,
     * and on hover - as the Chart widget's Open in Metric Explorer is.
     */
    const open: HTMLElement = screen.getByRole("link", {
      name: "Open in Funnels",
    });

    expect(open).toHaveAttribute(
      "data-testid",
      `${FUNNEL_WIDGET_TEST_ID}-open`,
    );
    expect(open).toHaveAttribute("title", "Open in Funnels");

    const { pathname, params } = linkTarget(open);

    expect(pathname).toBe(
      `/dashboard/${PROJECT_ID}/rum/${APP_ID}/product-analytics-funnels`,
    );
    expect(params.get("view")).toBe(FUNNEL_ID);
    expect(params.get("startTime")).toBe(BOARD_START.toISOString());
    expect(params.get("endTime")).toBe(BOARD_END.toISOString());
    // The page opens what the saved funnel keeps: no steps in the link.
    expect(params.has("step")).toBe(false);

    await act(async () => {
      fireEvent.click(open);
    });

    expect(screen.getByTestId("location")).toHaveTextContent(
      open.getAttribute("href") || "-",
    );
    expect(onWidgetClick).not.toHaveBeenCalled();
  });

  test.each([
    ["while the board is edited", { isEditMode: true }],
    ["on a playlist's screen", { isPlayback: true }],
  ])(
    "no link %s, and the funnel as before",
    async (_when: string, overrides: Partial<DashboardBaseComponentProps>) => {
      getItemMock.mockResolvedValue(savedFunnel());
      answerReads();

      renderFunnel({ savedViewId: FUNNEL_ID }, overrides);

      await screen.findAllByTestId(`${FUNNEL_WIDGET_TEST_ID}-chart-step`);
      expect(
        screen.getByTestId(`${FUNNEL_WIDGET_TEST_ID}-title`),
      ).toHaveTextContent("Pricing to purchase");
      expect(
        screen.queryByTestId(`${FUNNEL_WIDGET_TEST_ID}-open`),
      ).not.toBeInTheDocument();
    },
  );

  /*
   * Out of edit mode a reader cannot open the widget's settings, and may
   * not be allowed to: the widget says what is missing (issue #7160).
   */
  test("none picked: says so on a reader's board, and reads nothing", async () => {
    renderFunnel({});

    expect(
      await screen.findByText(
        getDashboardWidgetSetupLine(
          PRODUCT_ANALYTICS_WIDGET_WORDS[ProductAnalyticsSavedViewType.Funnel]
            .setupNeed,
          DashboardWidgetPlace.Board,
        ),
      ),
    ).toHaveTextContent("No saved funnel picked yet.");
    expect(
      screen.queryByText("Pick a saved funnel in this widget's settings."),
    ).not.toBeInTheDocument();
    expect(getItemMock).not.toHaveBeenCalled();
    expect(postMock).not.toHaveBeenCalled();
    // Nothing to name it by, nothing to open.
    expect(
      screen.queryByTestId(`${FUNNEL_WIDGET_TEST_ID}-title`),
    ).not.toBeInTheDocument();
  });

  test("none picked, on the board being edited: says where to pick one", async () => {
    renderFunnel({}, { isEditMode: true });

    expect(
      await screen.findByText("Pick a saved funnel in this widget's settings."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No saved funnel picked yet."),
    ).not.toBeInTheDocument();
    expect(getItemMock).not.toHaveBeenCalled();
  });

  test("an id that is no id is none picked", async () => {
    renderFunnel({ savedViewId: "not-an-id" });

    expect(
      await screen.findByText("No saved funnel picked yet."),
    ).toBeInTheDocument();
    expect(getItemMock).not.toHaveBeenCalled();
  });

  test("deleted, or not this reader's: says so, and reads no funnel", async () => {
    getItemMock.mockResolvedValue(null);
    answerReads();

    renderFunnel({ savedViewId: FUNNEL_ID });

    expect(
      await screen.findByText(
        "The saved funnel this widget shows was deleted, or you cannot see it.",
      ),
    ).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId(`${FUNNEL_WIDGET_TEST_ID}-open`),
    ).not.toBeInTheDocument();
  });

  test("a saved retention table where a funnel should be: none of this widget's", async () => {
    getItemMock.mockResolvedValue(
      savedRow({
        id: FUNNEL_ID,
        name: "Buyers who come back",
        viewType: ProductAnalyticsSavedViewType.Retention,
        definition: RETENTION_DEFINITION,
      }),
    );
    answerReads();

    renderFunnel({ savedViewId: FUNNEL_ID });

    expect(
      await screen.findByText(
        "The saved funnel this widget shows was deleted, or you cannot see it.",
      ),
    ).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  test("a saved funnel this version cannot read: named, and what to do", async () => {
    getItemMock.mockResolvedValue(savedFunnel({ steps: "everything" }));
    answerReads();

    renderFunnel({ savedViewId: FUNNEL_ID });

    expect(
      await screen.findByText(
        "Pricing to purchase cannot be opened: reload the page, or delete it and save it again.",
      ),
    ).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId(`${FUNNEL_WIDGET_TEST_ID}-open`),
    ).not.toBeInTheDocument();
  });

  test("the saved funnel's read refused: the server's words, as an error", async () => {
    getItemMock.mockRejectedValue(
      new Error(
        "You do not have permission to read Saved Product Analytics Views.",
      ),
    );

    renderFunnel({ savedViewId: FUNNEL_ID });

    expect(
      await screen.findByText(
        "You do not have permission to read Saved Product Analytics Views.",
      ),
    ).toBeInTheDocument();
    expectWidgetErrorLine(
      "You do not have permission to read Saved Product Analytics Views.",
    );
    expect(postMock).not.toHaveBeenCalled();
  });

  test("the funnel's read refused: the server's words, under its title", async () => {
    getItemMock.mockResolvedValue(savedFunnel());
    answerReads({
      funnel: new HTTPErrorResponse(
        400,
        { message: "A funnel read covers at most 90 days." },
        {},
      ),
    });

    renderFunnel({ savedViewId: FUNNEL_ID });

    expect(
      await screen.findByText("A funnel read covers at most 90 days."),
    ).toBeInTheDocument();
    expectWidgetErrorLine("A funnel read covers at most 90 days.");
    expect(
      screen.getByTestId(`${FUNNEL_WIDGET_TEST_ID}-title`),
    ).toHaveTextContent("Pricing to purchase");
  });

  test("nobody did the first step: says so, with no chart", async () => {
    getItemMock.mockResolvedValue(savedFunnel());
    answerReads({
      funnel: {
        windowMs: 7 * DAY_MS,
        steps: [
          {
            kind: "page",
            name: "/pricing",
            people: 0,
            conversionFromStart: 0,
            conversionFromPrevious: 1,
            droppedOff: 0,
            medianMsFromPrevious: null,
          },
          {
            kind: "custom",
            name: "Purchased",
            people: 0,
            conversionFromStart: 0,
            conversionFromPrevious: 0,
            droppedOff: 0,
            medianMsFromPrevious: null,
          },
        ],
      },
    });

    renderFunnel({ savedViewId: FUNNEL_ID });

    expect(
      await screen.findByTestId(`${FUNNEL_WIDGET_TEST_ID}-nobody`),
    ).toHaveTextContent("Nobody did the first step in this range and segment.");
    expect(
      screen.queryByTestId(`${FUNNEL_WIDGET_TEST_ID}-chart`),
    ).not.toBeInTheDocument();
  });

  test("a refresh reads both again, the funnel on screen meanwhile; a rename shows", async () => {
    getItemMock.mockResolvedValue(savedFunnel());
    answerReads();

    const view: ReturnType<typeof render> = renderFunnel({
      savedViewId: FUNNEL_ID,
    });

    await screen.findAllByTestId(`${FUNNEL_WIDGET_TEST_ID}-chart-step`);

    let answerSaved: (row: RumProductAnalyticsSavedView) => void = (): void => {
      // Set below.
    };

    getItemMock.mockImplementation((): Promise<unknown> => {
      return new Promise((resolve: (row: unknown) => void): void => {
        answerSaved = resolve;
      });
    });

    view.rerender(
      <DashboardProductAnalyticsFunnelComponentElement
        {...buildProps({ refreshTick: 1 })}
        component={funnelComponent({ savedViewId: FUNNEL_ID })}
      />,
    );

    // Read again, and still drawn: no loader in its place.
    expect(savedViewReads()).toEqual([FUNNEL_ID, FUNNEL_ID]);
    expect(
      screen.getAllByTestId(`${FUNNEL_WIDGET_TEST_ID}-chart-step`),
    ).toHaveLength(2);
    expect(screen.queryByTestId("component-loader")).not.toBeInTheDocument();

    const renamed: RumProductAnalyticsSavedView = savedFunnel();

    renamed.name = "Pricing to first purchase";

    await act(async () => {
      answerSaved(renamed);
    });

    await waitFor(() => {
      expect(
        screen.getByTestId(`${FUNNEL_WIDGET_TEST_ID}-title`),
      ).toHaveTextContent("Pricing to first purchase");
    });
    await waitFor(() => {
      expect(productAnalyticsRequestsTo(postMock, "funnel")).toHaveLength(2);
    });
  });

  test("another saved funnel picked: the last one is not shown while the next is read", async () => {
    getItemMock.mockResolvedValue(savedFunnel());
    answerReads();

    const view: ReturnType<typeof render> = renderFunnel({
      savedViewId: FUNNEL_ID,
    });

    await screen.findAllByTestId(`${FUNNEL_WIDGET_TEST_ID}-chart-step`);

    getItemMock.mockImplementation((): Promise<unknown> => {
      return new Promise((): void => {
        // Still on its way.
      });
    });

    view.rerender(
      <DashboardProductAnalyticsFunnelComponentElement
        {...buildProps()}
        component={funnelComponent({ savedViewId: OTHER_ID })}
      />,
    );

    expect(await screen.findByTestId("component-loader")).toBeInTheDocument();
    expect(screen.queryByText("Pricing to purchase")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(`${FUNNEL_WIDGET_TEST_ID}-open`),
    ).not.toBeInTheDocument();
    expect(savedViewReads()).toEqual([FUNNEL_ID, OTHER_ID]);
  });

  test("on a public dashboard: the placeholder, and no read at all", async () => {
    setPublicDashboardContext({
      dashboardId: new ObjectID("6a305555-0000-4000-8000-000000000008"),
    } as unknown as PublicDashboardContext);

    renderFunnel({ savedViewId: FUNNEL_ID });

    expect(
      await screen.findByText(
        "Funnels are not available on public dashboards.",
      ),
    ).toBeInTheDocument();
    expect(getItemMock).not.toHaveBeenCalled();
    expect(postMock).not.toHaveBeenCalled();
  });
});

describe("the Retention widget", () => {
  test("reads the saved table in the dashboard's range and the reader's zone: All cohorts over the cohorts", async () => {
    getItemMock.mockResolvedValue(savedRetention());
    answerReads();

    renderRetention({ savedViewId: RETENTION_ID });

    await waitFor(() => {
      expect(
        screen.getAllByTestId(`${RETENTION_WIDGET_TEST_ID}-table-row`),
      ).toHaveLength(3);
    });

    expect(savedViewReads()).toEqual([RETENTION_ID]);

    const request: JSONObject = lastProductAnalyticsRequestTo(
      postMock,
      "retention",
    );

    expect(request["rumApplicationId"]).toBe(APP_ID);
    expect(request["startEvent"]).toEqual(RETENTION_DEFINITION["startEvent"]);
    expect(request["returnEvent"]).toEqual(RETENTION_DEFINITION["returnEvent"]);
    expect(request["period"]).toBe("day");
    expect(request["filters"]).toEqual(RETENTION_DEFINITION["filters"]);
    expect(typeof request["timeZone"]).toBe("string");
    expect((request["timeZone"] as string).length).toBeGreaterThan(0);
    expect(new Date(request["startTime"] as string).toISOString()).toBe(
      BOARD_START.toISOString(),
    );
    expect(new Date(request["endTime"] as string).toISOString()).toBe(
      BOARD_END.toISOString(),
    );

    const table: HTMLElement = screen.getByTestId(
      `${RETENTION_WIDGET_TEST_ID}-table`,
    );

    expect(
      within(table).getByTestId(
        `${RETENTION_WIDGET_TEST_ID}-table-average-row`,
      ),
    ).toHaveTextContent("All cohorts");
    expect(
      screen.getByTestId(`${RETENTION_WIDGET_TEST_ID}-title`),
    ).toHaveTextContent("Buyers who come back");
    // A day over a week of days: read by day, nothing to say.
    expect(
      screen.queryByTestId(`${RETENTION_WIDGET_TEST_ID}-period-fitted`),
    ).not.toBeInTheDocument();
  });

  test("Open in User Retention links to the page on the saved table, in the dashboard's range", async () => {
    getItemMock.mockResolvedValue(savedRetention());
    answerReads();

    renderRetention({ savedViewId: RETENTION_ID });

    const open: HTMLElement = await screen.findByRole("link", {
      name: "Open in User Retention",
    });

    expect(open).toHaveAttribute(
      "data-testid",
      `${RETENTION_WIDGET_TEST_ID}-open`,
    );
    expect(open).toHaveAttribute("title", "Open in User Retention");

    const { pathname, params } = linkTarget(open);

    expect(pathname).toBe(
      `/dashboard/${PROJECT_ID}/rum/${APP_ID}/product-analytics-retention`,
    );
    expect(params.get("view")).toBe(RETENTION_ID);
    expect(params.get("startTime")).toBe(BOARD_START.toISOString());
    expect(params.get("endTime")).toBe(BOARD_END.toISOString());
  });

  test("a range too long for its period: read by the next longer one, and said", async () => {
    getItemMock.mockResolvedValue(savedRetention());
    answerReads();

    renderRetention(
      { savedViewId: RETENTION_ID },
      {
        dashboardStartAndEndDate: {
          range: TimeRange.CUSTOM,
          startAndEndDate: new InBetween<Date>(
            new Date("2026-08-01T00:00:00.000Z"),
            new Date("2026-11-01T00:00:00.000Z"),
          ),
        },
      },
    );

    expect(
      await screen.findByTestId(`${RETENTION_WIDGET_TEST_ID}-period-fitted`),
    ).toHaveTextContent(
      "This range has too many periods to show one row each, so its cohorts are longer.",
    );
    expect(lastProductAnalyticsRequestTo(postMock, "retention")["period"]).toBe(
      "week",
    );
  });

  test("nobody did the start event: says so, with no table", async () => {
    getItemMock.mockResolvedValue(savedRetention());
    answerReads({
      retention: {
        period: "day",
        timeZone: "UTC",
        cohorts: [{ start: "2026-11-01", people: 0, returning: [0] }],
      },
    });

    renderRetention({ savedViewId: RETENTION_ID });

    expect(
      await screen.findByTestId(`${RETENTION_WIDGET_TEST_ID}-nobody`),
    ).toHaveTextContent(
      "Nobody did the start event in this range and segment.",
    );
    expect(
      screen.queryByTestId(`${RETENTION_WIDGET_TEST_ID}-table`),
    ).not.toBeInTheDocument();
  });

  test("a saved funnel where a retention table should be: none of this widget's", async () => {
    getItemMock.mockResolvedValue(
      savedRow({
        id: RETENTION_ID,
        name: "Pricing to purchase",
        viewType: ProductAnalyticsSavedViewType.Funnel,
        definition: FUNNEL_DEFINITION,
      }),
    );
    answerReads();

    renderRetention({ savedViewId: RETENTION_ID });

    expect(
      await screen.findByText(
        "The saved retention table this widget shows was deleted, or you cannot see it.",
      ),
    ).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  test("none picked: says so on a reader's board", async () => {
    renderRetention({});

    expect(
      await screen.findByText("No saved retention table picked yet."),
    ).toBeInTheDocument();
    expect(getItemMock).not.toHaveBeenCalled();
  });

  test("none picked, on the board being edited: says where to pick one", async () => {
    renderRetention({}, { isEditMode: true });

    expect(
      await screen.findByText(
        "Pick a saved retention table in this widget's settings.",
      ),
    ).toBeInTheDocument();
    expect(getItemMock).not.toHaveBeenCalled();
  });

  /*
   * The table drawn compact, as the board's other tables are set, so the
   * default widget holds a month's weeks: the cohorts leave their year out
   * when every one is this year's. The board reads its own CUSTOM range, so
   * only the clock's year is at stake here: only Date is faked, and timers
   * run as usual.
   */
  describe("drawn compact", () => {
    function pinClock(now: Date): void {
      jest.useFakeTimers({
        now: now,
        doNotFake: [
          "hrtime",
          "nextTick",
          "performance",
          "queueMicrotask",
          "requestAnimationFrame",
          "cancelAnimationFrame",
          "requestIdleCallback",
          "cancelIdleCallback",
          "setImmediate",
          "clearImmediate",
          "setInterval",
          "clearInterval",
          "setTimeout",
          "clearTimeout",
        ],
      });
    }

    async function drawnCohorts(): Promise<Array<string>> {
      getItemMock.mockResolvedValue(savedRetention());
      answerReads();

      renderRetention({ savedViewId: RETENTION_ID });

      await waitFor(() => {
        expect(
          screen.getAllByTestId(`${RETENTION_WIDGET_TEST_ID}-table-row`),
        ).toHaveLength(3);
      });

      return within(screen.getByTestId(`${RETENTION_WIDGET_TEST_ID}-table`))
        .getAllByRole("rowheader")
        .map((header: HTMLElement): string => {
          return (header.textContent || "").trim();
        });
    }

    afterEach(() => {
      jest.useRealTimers();
    });

    test("small type and narrow cells; every cohort this year's, so no year", async () => {
      pinClock(new Date("2026-11-11T12:00:00.000Z"));

      expect(await drawnCohorts()).toEqual([
        "All cohorts",
        "Nov 1",
        "Nov 2",
        "Nov 3",
      ]);

      const table: HTMLElement = within(
        screen.getByTestId(`${RETENTION_WIDGET_TEST_ID}-table`),
      ).getByRole("table");

      expect(table).toHaveClass("text-xs");
      expect(table).not.toHaveClass("text-sm");

      for (const header of within(table).getAllByRole("columnheader")) {
        expect(header).toHaveClass("px-1.5", "py-1", "text-[11px]");
      }

      const cells: Array<HTMLElement> = [
        ...within(table).getAllByTestId(
          `${RETENTION_WIDGET_TEST_ID}-table-average-cell`,
        ),
        ...within(table).getAllByTestId(
          `${RETENTION_WIDGET_TEST_ID}-table-cell`,
        ),
      ];

      expect(cells).toHaveLength(9);

      for (const cell of cells) {
        expect(cell).toHaveClass("min-w-[2.75rem]", "px-1.5", "py-1");
        expect(cell).not.toHaveClass("min-w-[3.5rem]");
      }
    });

    test("read in the new year: last year's cohorts keep their year", async () => {
      pinClock(new Date("2027-01-04T12:00:00.000Z"));

      expect(await drawnCohorts()).toEqual([
        "All cohorts",
        "Nov 1, 2026",
        "Nov 2, 2026",
        "Nov 3, 2026",
      ]);
    });
  });
});

describe("a widget draws again only for what it shows", () => {
  type MemoProps = DashboardBaseComponentProps & {
    component: { arguments: unknown };
  };

  function memoProps(
    overrides?: Partial<DashboardBaseComponentProps>,
    args?: JSONObject,
  ): MemoProps {
    return {
      ...buildProps(overrides),
      component: { arguments: args || { savedViewId: FUNNEL_ID } },
    };
  }

  test("the board's own moves and equal settings in new objects: not drawn again", () => {
    expect(
      areProductAnalyticsWidgetPropsEqual(
        memoProps(),
        memoProps(
          {
            dashboardCanvasTopInPx: 120,
            dashboardCanvasLeftInPx: 40,
            totalCurrentDashboardWidthInPx: 900,
            metricTypes: [],
            onComponentUpdate: (): void => {
              // Another function, the same widget.
            },
            dashboardStartAndEndDate: {
              range: TimeRange.CUSTOM,
              startAndEndDate: new InBetween<Date>(
                new Date(BOARD_START.getTime()),
                new Date(BOARD_END.getTime()),
              ),
            },
          },
          { savedViewId: FUNNEL_ID },
        ),
      ),
    ).toBe(true);
  });

  test.each([
    ["a refresh", { refreshTick: 1 }, undefined],
    ["the board edited", { isEditMode: true }, undefined],
    ["the widget selected", { isSelected: true }, undefined],
    ["a playlist's screen", { isPlayback: true }, undefined],
    ["a new width", { dashboardComponentWidthInPx: 600 }, undefined],
    ["a new height", { dashboardComponentHeightInPx: 200 }, undefined],
    [
      "a new range",
      {
        dashboardStartAndEndDate: {
          range: TimeRange.PAST_ONE_DAY,
          startAndEndDate: new InBetween<Date>(BOARD_START, BOARD_END),
        },
      },
      undefined,
    ],
    [
      "another widget",
      { componentId: new ObjectID("6a305555-0000-4000-8000-000000000009") },
      undefined,
    ],
    ["another saved one", undefined, { savedViewId: OTHER_ID }],
    ["a title", undefined, { savedViewId: FUNNEL_ID, title: "Checkout" }],
  ])(
    "%s: drawn again",
    (
      _what: string,
      overrides: Partial<DashboardBaseComponentProps> | undefined,
      args: JSONObject | undefined,
    ) => {
      expect(
        areProductAnalyticsWidgetPropsEqual(
          memoProps(),
          memoProps(overrides, args),
        ),
      ).toBe(false);
    },
  );
});
