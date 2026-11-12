import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, within } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ISSUE #6859: THE FUNNEL AND USER RETENTION WIDGETS' LINK TO THEIR PAGE,
 * IN THE WIDGET SETTINGS' LIVE PREVIEW.
 *
 * Each widget's corner links to its saved funnel or retention table on
 * its page. The link was left out while the board is edited
 * (isProductAnalyticsWidgetLinked), but the settings dialog draws its
 * preview out of edit mode - over a board being edited, with nothing to
 * ask before leaving it - so the preview had it, and a click on it left
 * the board and its unsaved widgets. In the preview the widget is drawn
 * with its title and what it read, and no link; on the board, out of edit
 * mode, the link is there and goes to the page.
 *
 * The saved one is read through ModelAPI.getItem and the funnel and the
 * table through API.post, each stood in for.
 */

jest.setTimeout(120000);

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
        return error instanceof Error ? error.message : String(error);
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

// The settings form is not under test; the preview above it is.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ArgumentsForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

import { FUNNEL_WIDGET_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardProductAnalyticsFunnelComponent";
import { RETENTION_WIDGET_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardProductAnalyticsRetentionComponent";
import RumProductAnalyticsSavedView from "../../../Models/DatabaseModels/RumProductAnalyticsSavedView";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { ProductAnalyticsSavedViewType } from "../../../Types/Rum/ProductAnalyticsSavedViews";
import ProjectUtil from "../../../UI/Utils/Project";
import DashboardProductAnalyticsFunnelComponentUtil from "../../../Utils/Dashboard/Components/DashboardProductAnalyticsFunnelComponent";
import DashboardProductAnalyticsRetentionComponentUtil from "../../../Utils/Dashboard/Components/DashboardProductAnalyticsRetentionComponent";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import {
  ProductAnalyticsTestAnswer,
  answerProductAnalyticsReads,
} from "../../UI/Rum/ProductAnalyticsEventsPageKit";
import {
  BOARD_PATH,
  PREVIEW_WIDGET_ID,
  PreviewResizeObserver,
  boardCard,
  currentPath,
  drawWidgetOnBoard,
  linksIn,
  openWidgetSettings,
  previewBox,
} from "./WidgetPreviewHarness";

const PROJECT_ID: string = "6a305555-0000-4000-8000-000000006859";
const APP_ID: string = "6a305555-0000-4000-8000-000000000002";
const FUNNEL_ID: string = "6a305555-0000-4000-8000-000000000003";
const RETENTION_ID: string = "6a305555-0000-4000-8000-000000000004";

const DAY_MS: number = 24 * 60 * 60 * 1000;

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

const SAVED_FUNNEL: RumProductAnalyticsSavedView = savedRow({
  id: FUNNEL_ID,
  name: "Pricing to purchase",
  viewType: ProductAnalyticsSavedViewType.Funnel,
  definition: {
    steps: [
      { kind: "page", name: "/pricing" },
      { kind: "custom", name: "Purchased" },
    ],
    windowMs: 7 * DAY_MS,
    filters: [],
  },
});

const SAVED_RETENTION: RumProductAnalyticsSavedView = savedRow({
  id: RETENTION_ID,
  name: "Buyers who come back",
  viewType: ProductAnalyticsSavedViewType.Retention,
  definition: {
    startEvent: { kind: "custom", name: "Signed up" },
    returnEvent: { kind: "custom", name: "Purchased" },
    period: "day",
    filters: [],
  },
});

function funnelAnswer(data: JSONObject): JSONObject {
  const steps: Array<JSONObject> = data["steps"] as Array<JSONObject>;
  const people: Array<number> = [400, 100];

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
    ],
  };
}

interface ProductAnalyticsWidgetCase {
  name: string;
  testId: string;
  title: string;
  saved: RumProductAnalyticsSavedView;
  component: () => DashboardBaseComponent;
  // What it draws once read, in the preview and on the board alike.
  drawn: string;
}

const WIDGETS: Array<ProductAnalyticsWidgetCase> = [
  {
    name: "Funnel",
    testId: FUNNEL_WIDGET_TEST_ID,
    title: "Pricing to purchase",
    saved: SAVED_FUNNEL,
    component: (): DashboardBaseComponent => {
      const component: DashboardBaseComponent =
        DashboardProductAnalyticsFunnelComponentUtil.getDefaultComponent();

      component.componentId = PREVIEW_WIDGET_ID;
      component.arguments = { savedViewId: FUNNEL_ID };

      return component;
    },
    drawn: "/pricing",
  },
  {
    name: "User Retention",
    testId: RETENTION_WIDGET_TEST_ID,
    title: "Buyers who come back",
    saved: SAVED_RETENTION,
    component: (): DashboardBaseComponent => {
      const component: DashboardBaseComponent =
        DashboardProductAnalyticsRetentionComponentUtil.getDefaultComponent();

      component.componentId = PREVIEW_WIDGET_ID;
      component.arguments = { savedViewId: RETENTION_ID };

      return component;
    },
    drawn: "All cohorts",
  },
];

function casesOf(): Array<[string, ProductAnalyticsWidgetCase]> {
  return WIDGETS.map(
    (
      widget: ProductAnalyticsWidgetCase,
    ): [string, ProductAnalyticsWidgetCase] => {
      return [widget.name, widget];
    },
  );
}

const ORIGINAL_RESIZE_OBSERVER: unknown = (
  globalThis as unknown as { ResizeObserver: unknown }
).ResizeObserver;

beforeAll(async () => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    PreviewResizeObserver;

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: readDashboardLocale("en") } },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  postMock.mockReset();
  getItemMock.mockReset();
  answerProductAnalyticsReads(postMock, {
    funnel: funnelAnswer as (data: JSONObject) => ProductAnalyticsTestAnswer,
    retention: retentionAnswer as (
      data: JSONObject,
    ) => ProductAnalyticsTestAnswer,
  });
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

afterAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    ORIGINAL_RESIZE_OBSERVER;
});

describe("a product analytics widget's link to its page", () => {
  test.each(casesOf())(
    "%s: in the settings' preview, its title and what it read, and no link",
    async (_name: string, widget: ProductAnalyticsWidgetCase) => {
      getItemMock.mockResolvedValue(widget.saved);

      openWidgetSettings(widget.component());

      await within(previewBox()).findByText(widget.drawn, { exact: false });

      expect(
        within(previewBox()).getByTestId(`${widget.testId}-title`),
      ).toHaveTextContent(widget.title);
      expect(
        within(previewBox()).queryByTestId(`${widget.testId}-open`),
      ).toBeNull();
      expect(linksIn(previewBox())).toEqual([]);
      expect(within(previewBox()).queryByRole("link")).toBeNull();
      expect(currentPath()).toBe(BOARD_PATH);
    },
  );

  test.each(casesOf())(
    "%s: on the board, out of edit mode, the corner links to the saved one's page",
    async (_name: string, widget: ProductAnalyticsWidgetCase) => {
      getItemMock.mockResolvedValue(widget.saved);

      drawWidgetOnBoard(widget.component());

      await within(boardCard()).findByText(widget.drawn, { exact: false });

      const link: HTMLElement = within(boardCard()).getByTestId(
        `${widget.testId}-open`,
      );

      expect(link.tagName).toBe("A");
      expect(link.getAttribute("href")).toContain(
        `/dashboard/${PROJECT_ID}/rum/${APP_ID}/`,
      );

      fireEvent.click(link);

      // The board's page is left for the saved one's.
      expect(currentPath()).not.toBe(BOARD_PATH);
      expect(currentPath()).toContain(`/rum/${APP_ID}/`);
    },
  );
});
