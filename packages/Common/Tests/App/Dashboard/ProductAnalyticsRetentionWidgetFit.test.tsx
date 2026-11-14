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
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import RumProductAnalyticsSavedView from "../../../Models/DatabaseModels/RumProductAnalyticsSavedView";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DashboardProductAnalyticsRetentionComponent from "../../../Types/Dashboard/DashboardComponents/DashboardProductAnalyticsRetentionComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  ProductAnalyticsRetentionDto,
  ProductAnalyticsRetentionPeriod,
} from "../../../Types/Rum/ProductAnalyticsEventReads";
import { ProductAnalyticsSavedViewType } from "../../../Types/Rum/ProductAnalyticsSavedViews";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import ProjectUtil from "../../../UI/Utils/Project";
import DashboardProductAnalyticsRetentionComponentUtil from "../../../Utils/Dashboard/Components/DashboardProductAnalyticsRetentionComponent";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import {
  ProductAnalyticsTestAnswer,
  answerProductAnalyticsReads,
} from "../../UI/Rum/ProductAnalyticsEventsPageKit";

/*
 * THE RETENTION WIDGET DRAWS THE PERIODS THAT FIT, AND SAYS HOW MANY IT
 * LEAVES OUT (issue #6721).
 *
 * The widget's table scrolled sideways once its periods were wider than
 * the widget - a scroll a dashboard's reader rarely finds, inside a board
 * that may scroll too. It now measures its table with every period drawn,
 * before the browser paints, and draws the periods that fit beside the
 * cohort and people columns, from the first; under the table, "2 more
 * weeks" (days, months: the table's period) says how many it left out and
 * opens the saved table on the User Retention page, which shows them all.
 * A widget made wider, a refresh with fewer periods, or a language with
 * shorter headings gets them back. The page itself draws every period, as
 * it did.
 *
 * A table measured before the page had written the styles for its classes
 * (Tailwind's runtime writes them as they first appear) or before its font
 * was in was measured at widths it is not drawn at - the first widget of a
 * board drew eleven weeks in room for six. A fitted table that changes
 * size by itself, or a font that comes in, measures it again; and the line
 * keeps to the widget's foot, where a widget of many cohorts scrolled it
 * out of sight.
 *
 * Where not even the first period fits beside the cohort and people
 * columns - a widget at its least, four units, beside the side menu at
 * 1024, or German's longer headings at 1280 - the People column gives way
 * (issue #6841): the cohort and the periods that fit beside it, never a
 * table that scrolls by a period cut in half. Each cell still says its
 * cohort's people, and the page keeps its People column.
 *
 * jsdom lays nothing out, so a table is measured here as a browser would
 * lay it out: the cohort column 90px, the people column (its heading set
 * to the line's end, text-end) 50px, each period column as wide as its
 * longest text at 7px a character and 12px of padding, and 2px of
 * border-spacing around every cell (border-spacing-0.5). "Week 0" is 6
 * characters: 54px a period, 56 with its spacing, and the table's other
 * columns take 146px. A 521px widget (the default eight units at 1280)
 * leaves 495px for its table: six of eight weeks.
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

import DashboardProductAnalyticsRetentionComponentElement, {
  RETENTION_LEFT_OUT_CLASS_NAME,
  RETENTION_PERIODS_LEFT_OUT,
  RETENTION_WIDGET_CHROME_IN_PX,
  RETENTION_WIDGET_TEST_ID,
  getRetentionWidgetTableWidthInPx,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardProductAnalyticsRetentionComponent";
import {
  ProductAnalyticsWidgetState,
  isProductAnalyticsWidgetLinked,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardProductAnalyticsWidget";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import { DashboardWidgetPreviewProvider } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetPreview";
import ProductAnalyticsRetentionTable, {
  ProductAnalyticsRetentionTableFit,
  RETENTION_COHORT_COLUMN_CLASS_NAME,
  RETENTION_TABLE_MAX_REMEASURES,
  countProductAnalyticsRetentionPeriodsThatFit,
  fitProductAnalyticsRetentionTable,
  readProductAnalyticsRetentionTableWidths,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProductAnalytics/ProductAnalyticsRetentionTable";
import {
  EmittedRule,
  addClassNames,
  declarationsForSelector,
  loadPlayCdn,
  unloadPlayCdn,
} from "../../Helpers/TailwindPlayCdn";

const PROJECT_ID: string = "6721aaaa-0000-4000-8000-000000000001";
const APP_ID: string = "6721aaaa-0000-4000-8000-000000000002";
const RETENTION_ID: string = "6721aaaa-0000-4000-8000-000000000003";

const COMPONENT_ID: ObjectID = new ObjectID(
  "6721aaaa-0000-4000-8000-000000000004",
);

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

const TABLE_TEST_ID: string = `${RETENTION_WIDGET_TEST_ID}-table`;
const LEFT_OUT_TEST_ID: string = `${RETENTION_WIDGET_TEST_ID}-left-out`;
const LEFT_OUT_LINK_TEST_ID: string = `${RETENTION_WIDGET_TEST_ID}-left-out-open`;

// ---- The layout a browser would give the table ----

const COHORT_COLUMN_PX: number = 90;
const PEOPLE_COLUMN_PX: number = 50;
const CHARACTER_PX: number = 7;
const CELL_PADDING_PX: number = 12;
const SPACING_PX: number = 2;

// The table's box, as wide as the widget unless a test narrows it (a scrollbar).
let boxClientWidth: number = 0;

/*
 * How much narrower each period column is than it is drawn: before the
 * page's styles for its classes are in, it has no padding yet.
 */
let periodShortfallPx: number = 0;

// A row's height, as a browser draws the compact table.
const ROW_PX: number = 20;

// The People column: the one heading the table sets to the line's end.
function isPeopleColumn(table: HTMLTableElement, index: number): boolean {
  return Boolean(
    table.tHead?.rows[0]?.cells[index]?.classList.contains("text-end"),
  );
}

function columnWidth(table: HTMLTableElement, index: number): number {
  if (index === 0) {
    return COHORT_COLUMN_PX;
  }

  if (isPeopleColumn(table, index)) {
    return PEOPLE_COLUMN_PX;
  }

  let longest: number = 0;

  for (const row of Array.from(table.rows)) {
    // The spacer row under All cohorts: one cell across the table.
    if (row.cells.length < 2) {
      continue;
    }

    const cell: HTMLTableCellElement | undefined = row.cells[index];

    if (cell) {
      longest = Math.max(longest, (cell.textContent || "").length);
    }
  }

  return longest * CHARACTER_PX + CELL_PADDING_PX - periodShortfallPx;
}

function tableWidth(table: HTMLTableElement): number {
  const columns: number = table.tHead?.rows[0]?.cells.length || 0;
  let width: number = SPACING_PX * (columns + 1);

  for (let index: number = 0; index < columns; index++) {
    width += columnWidth(table, index);
  }

  return width;
}

function rect(width: number): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: 20,
    right: width,
    width: width,
    height: 20,
    toJSON: (): unknown => {
      return {};
    },
  } as DOMRect;
}

const ORIGINAL_RECT: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(Element.prototype, "getBoundingClientRect");
const ORIGINAL_CLIENT_WIDTH: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
const ORIGINAL_OFFSET_WIDTH: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
const ORIGINAL_OFFSET_HEIGHT: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");

/*
 * jsdom has no ResizeObserver. This one tells its callback of a change
 * only when a test says the browser would have (notifyTableObservers).
 */
class FakeResizeObserver {
  public static instances: Array<FakeResizeObserver> = [];
  public observed: Array<Element> = [];
  public isDisconnected: boolean = false;
  private callback: ResizeObserverCallback;

  public constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  public observe(element: Element): void {
    this.observed.push(element);
  }

  public unobserve(): void {
    // Nothing a test reads.
  }

  public disconnect(): void {
    this.isDisconnected = true;
  }

  public notify(): void {
    if (!this.isDisconnected) {
      this.callback([], this as unknown as ResizeObserver);
    }
  }
}

type ResizeObserverHost = { ResizeObserver?: unknown };

const ORIGINAL_RESIZE_OBSERVER: unknown = (
  globalThis as unknown as ResizeObserverHost
).ResizeObserver;

function tableObservers(): Array<FakeResizeObserver> {
  return FakeResizeObserver.instances.filter(
    (observer: FakeResizeObserver): boolean => {
      return observer.observed.some((element: Element): boolean => {
        return element instanceof HTMLTableElement;
      });
    },
  );
}

// What a browser does once the drawn table's size has changed: tells each observer.
function notifyTableObservers(): void {
  act(() => {
    for (const observer of tableObservers()) {
      observer.notify();
    }
  });
}

// How often a table was measured: its headings' widths read, as a browser lays them out.
let measuredTables: number = 0;

beforeAll(async () => {
  Object.defineProperty(Element.prototype, "getBoundingClientRect", {
    configurable: true,
    value: function (this: Element): DOMRect {
      if (this instanceof HTMLTableElement) {
        measuredTables += 1;
        return rect(tableWidth(this));
      }

      if (this instanceof HTMLTableCellElement) {
        const table: HTMLTableElement | null = this.closest("table");

        return rect(table ? columnWidth(table, this.cellIndex) : 0);
      }

      return rect(0);
    },
  });

  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement): number {
      return this.getAttribute("data-testid") === TABLE_TEST_ID
        ? boxClientWidth
        : 0;
    },
  });

  // The table's drawn size, as it is laid out now.
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement): number {
      return this instanceof HTMLTableElement ? tableWidth(this) : 0;
    },
  });

  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement): number {
      return this instanceof HTMLTableElement ? this.rows.length * ROW_PX : 0;
    },
  });

  (globalThis as unknown as ResizeObserverHost).ResizeObserver =
    FakeResizeObserver;

  const resources: Record<string, { translation: Record<string, string> }> = {
    en: { translation: readDashboardLocale("en") },
  };

  for (const language of ["de", "fa"]) {
    resources[language] = { translation: readDashboardLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
  });
});

afterAll(() => {
  if (ORIGINAL_RECT) {
    Object.defineProperty(
      Element.prototype,
      "getBoundingClientRect",
      ORIGINAL_RECT,
    );
  }

  if (ORIGINAL_CLIENT_WIDTH) {
    Object.defineProperty(
      HTMLElement.prototype,
      "clientWidth",
      ORIGINAL_CLIENT_WIDTH,
    );
  }

  if (ORIGINAL_OFFSET_WIDTH) {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetWidth",
      ORIGINAL_OFFSET_WIDTH,
    );
  }

  if (ORIGINAL_OFFSET_HEIGHT) {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetHeight",
      ORIGINAL_OFFSET_HEIGHT,
    );
  }

  (globalThis as unknown as ResizeObserverHost).ResizeObserver =
    ORIGINAL_RESIZE_OBSERVER;
});

beforeEach(() => {
  postMock.mockReset();
  getItemMock.mockReset();
  boxClientWidth = 0;
  periodShortfallPx = 0;
  measuredTables = 0;
  FakeResizeObserver.instances = [];
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await i18next.changeLanguage("en");
});

// ---- The saved table and its reads ----

function savedRetention(
  period: ProductAnalyticsRetentionPeriod,
): RumProductAnalyticsSavedView {
  const row: RumProductAnalyticsSavedView = new RumProductAnalyticsSavedView(
    new ObjectID(RETENTION_ID),
  );

  row.name = "Buyers who come back";
  row.viewType = ProductAnalyticsSavedViewType.Retention;
  row.rumApplicationId = new ObjectID(APP_ID);
  row.definition = {
    startEvent: { kind: "custom", name: "Signed up" },
    returnEvent: { kind: "custom", name: "Purchased" },
    period: period,
    filters: [],
  };

  return row;
}

/*
 * Three cohorts, each with `periods` periods: the oldest has reached them
 * all, the youngest only its first two.
 */
function retentionAnswer(periods: number): (data: JSONObject) => JSONObject {
  return (data: JSONObject): JSONObject => {
    const returning: (
      people: number,
      reached: number,
    ) => Array<number | null> = (
      people: number,
      reached: number,
    ): Array<number | null> => {
      return Array.from(
        { length: periods },
        (_value: unknown, index: number): number | null => {
          return index < reached ? Math.round(people / (index + 1)) : null;
        },
      );
    };

    return {
      period: data["period"] as string,
      timeZone: "UTC",
      cohorts: [
        {
          start: "2026-09-07",
          people: 200,
          returning: returning(200, periods),
        },
        {
          start: "2026-09-14",
          people: 100,
          returning: returning(100, Math.max(periods - 1, 1)),
        },
        { start: "2026-09-21", people: 50, returning: returning(50, 2) },
      ],
    };
  };
}

function answerReads(periods: number): void {
  answerProductAnalyticsReads(postMock, {
    retention: retentionAnswer(periods) as (
      data: JSONObject,
    ) => ProductAnalyticsTestAnswer,
  });
}

function buildProps(
  overrides?: Partial<DashboardBaseComponentProps>,
): DashboardBaseComponentProps {
  return {
    componentId: COMPONENT_ID,
    isEditMode: false,
    isSelected: false,
    key: "retention-widget",
    onComponentUpdate: (): void => {
      // The widget never writes back through this.
    },
    totalCurrentDashboardWidthInPx: 1200,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1200,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 390,
    dashboardComponentWidthInPx: 521,
    dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
    dashboardStartAndEndDate: BOARD_RANGE,
    metricTypes: [],
    refreshTick: 0,
    variables: undefined,
    dashboardId: "6721aaaa-0000-4000-8000-000000000005",
    ...overrides,
  };
}

function retentionComponent(): DashboardProductAnalyticsRetentionComponent {
  const component: DashboardProductAnalyticsRetentionComponent =
    DashboardProductAnalyticsRetentionComponentUtil.getDefaultComponent();

  component.componentId = COMPONENT_ID;
  component.arguments = { savedViewId: RETENTION_ID };

  return component;
}

/*
 * The widget, on a card whose click a test can see - or in the widget
 * settings' live preview, which DashboardBaseComponentElement draws it in
 * when the settings dialog asks (isPreview).
 */
function Board(props: {
  widgetProps: DashboardBaseComponentProps;
  onCardClick?: (() => void) | undefined;
}): React.ReactElement {
  return (
    <MemoryRouter>
      <div
        data-testid="card"
        onClick={() => {
          props.onCardClick?.();
        }}
      >
        <DashboardWidgetPreviewProvider
          isPreview={Boolean(props.widgetProps.isPreview)}
        >
          <DashboardProductAnalyticsRetentionComponentElement
            {...props.widgetProps}
            component={retentionComponent()}
          />
        </DashboardWidgetPreviewProvider>
      </div>
    </MemoryRouter>
  );
}

function renderWidget(
  overrides?: Partial<DashboardBaseComponentProps>,
  onCardClick?: () => void,
): ReturnType<typeof render> {
  return render(
    <Board widgetProps={buildProps(overrides)} onCardClick={onCardClick} />,
  );
}

function rerenderWidget(
  view: ReturnType<typeof render>,
  overrides?: Partial<DashboardBaseComponentProps>,
): void {
  view.rerender(<Board widgetProps={buildProps(overrides)} />);
}

function headings(): Array<string> {
  return within(screen.getByTestId(TABLE_TEST_ID))
    .getAllByRole("columnheader")
    .map((heading: HTMLElement): string => {
      return withoutIsolateMarks((heading.textContent || "").trim());
    });
}

// The table's rows under its headings: All cohorts, then each cohort's.
function bodyRows(): Array<HTMLElement> {
  return within(screen.getByTestId(TABLE_TEST_ID))
    .getAllByRole("row")
    .filter((row: HTMLElement): boolean => {
      return row.getAttribute("aria-hidden") !== "true";
    })
    .slice(1);
}

// A row's people cell, set to the line's end as its heading is; null where the column gave way.
function peopleCell(row: HTMLElement): HTMLTableCellElement | null {
  return (
    Array.from(row.querySelectorAll("td")).find(
      (cell: HTMLTableCellElement): boolean => {
        return cell.classList.contains("text-end");
      },
    ) || null
  );
}

// Each row's cells after its cohort and its people: a cell a period drawn.
function periodCellsPerRow(): Array<number> {
  return bodyRows().map((row: HTMLElement): number => {
    return (
      row.querySelectorAll("td").length - (peopleCell(row) === null ? 0 : 1)
    );
  });
}

// The table as it is drawn, as wide as the layout above lays it out.
function drawnTable(): HTMLTableElement {
  return within(screen.getByTestId(TABLE_TEST_ID)).getByRole(
    "table",
  ) as HTMLTableElement;
}

function leftOutText(): string {
  return withoutIsolateMarks(
    (screen.getByTestId(LEFT_OUT_TEST_ID).textContent || "").trim(),
  );
}

async function waitForTable(): Promise<void> {
  await waitFor(() => {
    expect(
      screen.getAllByTestId(`${TABLE_TEST_ID}-row`).length,
    ).toBeGreaterThan(0);
  });
}

function weeks(count: number): Array<string> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return `Week ${index}`;
  });
}

describe("the Retention widget's periods in its width", () => {
  test("a widget wide enough for the whole table: every period, nothing under it", async () => {
    getItemMock.mockResolvedValue(
      savedRetention(ProductAnalyticsRetentionPeriod.Week),
    );
    answerReads(8);

    // 594px of table, 620 of widget less its 26 of border and padding.
    renderWidget({ dashboardComponentWidthInPx: 620 });
    await waitForTable();

    expect(headings()).toEqual(["Cohort", "People", ...weeks(8)]);
    expect(periodCellsPerRow()).toEqual([8, 8, 8, 8]);
    expect(screen.queryByTestId(LEFT_OUT_TEST_ID)).not.toBeInTheDocument();
    // Measured once with every period, then drawn to fill the widget.
    expect(
      within(screen.getByTestId(TABLE_TEST_ID)).getByRole("table"),
    ).toHaveClass("min-w-full");
    expect(
      within(screen.getByTestId(TABLE_TEST_ID)).getByRole("table"),
    ).not.toHaveClass("w-max");
    expect(measuredTables).toBe(1);
  });

  test("the default widget: the first six weeks, and the two it leaves out open the page on the saved table", async () => {
    getItemMock.mockResolvedValue(
      savedRetention(ProductAnalyticsRetentionPeriod.Week),
    );
    answerReads(8);

    renderWidget();
    await waitForTable();

    expect(headings()).toEqual(["Cohort", "People", ...weeks(6)]);
    // All cohorts and every cohort: six periods each, empty or not.
    expect(periodCellsPerRow()).toEqual([6, 6, 6, 6]);
    expect(leftOutText()).toBe("2 more weeks");

    const link: HTMLElement = screen.getByTestId(LEFT_OUT_LINK_TEST_ID);

    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("title", "Open in User Retention");
    expect(link).toHaveTextContent("2 more weeks");

    const [pathname, search] = (link.getAttribute("href") || "").split("?") as [
      string,
      string,
    ];
    const params: URLSearchParams = new URLSearchParams(search);

    expect(pathname).toBe(
      `/dashboard/${PROJECT_ID}/rum/${APP_ID}/product-analytics-retention`,
    );
    expect(params.get("view")).toBe(RETENTION_ID);
    expect(params.get("startTime")).toBe(BOARD_START.toISOString());
    expect(params.get("endTime")).toBe(BOARD_END.toISOString());

    // The corner's link is still there, to the same place.
    expect(
      screen.getByTestId(`${RETENTION_WIDGET_TEST_ID}-open`),
    ).toHaveAttribute("href", link.getAttribute("href"));

    // The spacer under All cohorts spans what is drawn, not what was read.
    expect(
      screen
        .getByTestId(TABLE_TEST_ID)
        .querySelector('tr[aria-hidden="true"] td'),
    ).toHaveAttribute("colspan", "8");
  });

  test("a click on the link is the link's, not also the card's", async () => {
    getItemMock.mockResolvedValue(
      savedRetention(ProductAnalyticsRetentionPeriod.Week),
    );
    answerReads(8);

    const onCardClick: MockFunction = getJestMockFunction();

    renderWidget({}, onCardClick as unknown as () => void);
    await waitForTable();

    fireEvent.click(screen.getByTestId(LEFT_OUT_LINK_TEST_ID));

    expect(onCardClick).not.toHaveBeenCalled();
  });

  test.each([
    // [widget width, periods drawn, words under the table, its People column]
    [620, 8, null, true],
    // One pixel less than the whole table.
    [619, 7, "1 more week", true],
    [521, 6, "2 more weeks", true],
    [400, 4, "4 more weeks", true],
    [300, 2, "6 more weeks", true],
    // One period beside both columns, to the pixel: 2 + 92 + 52 + 56 = 202 of table.
    [228, 1, "7 more weeks", true],
    // A pixel short of it: the People column gives way to the period.
    [227, 1, "7 more weeks", false],
    // Too narrow for a period beside the cohorts alone: still one, scrolled to.
    [150, 1, "7 more weeks", false],
    // Not laid out yet (no width at all): nothing to fit to, every period.
    [0, 8, null, true],
  ])(
    "a %dpx widget draws %d periods",
    async (
      width: number,
      drawn: number,
      words: string | null,
      showsPeople: boolean,
    ) => {
      getItemMock.mockResolvedValue(
        savedRetention(ProductAnalyticsRetentionPeriod.Week),
      );
      answerReads(8);

      renderWidget({ dashboardComponentWidthInPx: width });
      await waitForTable();

      expect(headings()).toEqual([
        "Cohort",
        ...(showsPeople ? ["People"] : []),
        ...weeks(drawn),
      ]);

      if (words === null) {
        expect(screen.queryByTestId(LEFT_OUT_TEST_ID)).not.toBeInTheDocument();
      } else {
        expect(leftOutText()).toBe(words);
      }
    },
  );

  test("made wider, it gets its periods back; made narrower again, it leaves them out again", async () => {
    getItemMock.mockResolvedValue(
      savedRetention(ProductAnalyticsRetentionPeriod.Week),
    );
    answerReads(8);

    const view: ReturnType<typeof render> = renderWidget();
    await waitForTable();

    expect(headings()).toHaveLength(8);
    expect(leftOutText()).toBe("2 more weeks");

    rerenderWidget(view, { dashboardComponentWidthInPx: 900 });

    await waitFor(() => {
      expect(headings()).toEqual(["Cohort", "People", ...weeks(8)]);
    });
    expect(screen.queryByTestId(LEFT_OUT_TEST_ID)).not.toBeInTheDocument();

    rerenderWidget(view, { dashboardComponentWidthInPx: 300 });

    await waitFor(() => {
      expect(headings()).toEqual(["Cohort", "People", ...weeks(2)]);
    });
    expect(leftOutText()).toBe("6 more weeks");
  });

  test("a refresh that reads fewer periods is measured again: all of them fit", async () => {
    getItemMock.mockResolvedValue(
      savedRetention(ProductAnalyticsRetentionPeriod.Week),
    );
    answerReads(8);

    const view: ReturnType<typeof render> = renderWidget();
    await waitForTable();

    expect(leftOutText()).toBe("2 more weeks");

    answerReads(4);
    rerenderWidget(view, { refreshTick: 1 });

    await waitFor(() => {
      expect(headings()).toEqual(["Cohort", "People", ...weeks(4)]);
    });
    expect(screen.queryByTestId(LEFT_OUT_TEST_ID)).not.toBeInTheDocument();
  });

  test("a table box narrower than the widget (a scrollbar down its side): fitted to the box", async () => {
    getItemMock.mockResolvedValue(
      savedRetention(ProductAnalyticsRetentionPeriod.Week),
    );
    answerReads(8);
    boxClientWidth = 400;

    renderWidget();
    await waitForTable();

    // 400px of box, where the widget would leave 495: four weeks.
    expect(headings()).toEqual(["Cohort", "People", ...weeks(4)]);
    expect(leftOutText()).toBe("4 more weeks");
  });

  test("a table box wider than the widget says: the widget's width is what counts", async () => {
    getItemMock.mockResolvedValue(
      savedRetention(ProductAnalyticsRetentionPeriod.Week),
    );
    answerReads(8);
    boxClientWidth = 2000;

    renderWidget();
    await waitForTable();

    expect(headings()).toHaveLength(8);
    expect(leftOutText()).toBe("2 more weeks");
  });

  test.each([
    // "Day 0" is 47px: seven of eight days in 495px.
    [ProductAnalyticsRetentionPeriod.Day, ["Day 0", "Day 6"], "1 more day"],
    // "Month 0" is 61px: five of eight months.
    [
      ProductAnalyticsRetentionPeriod.Month,
      ["Month 0", "Month 4"],
      "3 more months",
    ],
  ])(
    "a table by %s says what it leaves out in its own period",
    async (
      period: ProductAnalyticsRetentionPeriod,
      firstAndLast: Array<string>,
      words: string,
    ) => {
      getItemMock.mockResolvedValue(savedRetention(period));
      answerReads(8);

      renderWidget();
      await waitForTable();

      const drawn: Array<string> = headings().slice(2);

      expect(drawn[0]).toBe(firstAndLast[0]);
      expect(drawn[drawn.length - 1]).toBe(firstAndLast[1]);
      expect(leftOutText()).toBe(words);
    },
  );

  test("while the board is edited: the same words, but no link (a navigation would drop the edit)", async () => {
    getItemMock.mockResolvedValue(
      savedRetention(ProductAnalyticsRetentionPeriod.Week),
    );
    answerReads(8);

    renderWidget({ isEditMode: true });
    await waitForTable();

    expect(leftOutText()).toBe("2 more weeks");
    expect(screen.queryByTestId(LEFT_OUT_LINK_TEST_ID)).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId(LEFT_OUT_TEST_ID)).queryByRole("link"),
    ).not.toBeInTheDocument();
  });

  test("in the widget settings' live preview, over a board being edited: the same words, no link (issue #6859)", async () => {
    getItemMock.mockResolvedValue(
      savedRetention(ProductAnalyticsRetentionPeriod.Week),
    );
    answerReads(8);

    renderWidget({ isPreview: true });
    await waitForTable();

    expect(leftOutText()).toBe("2 more weeks");
    expect(screen.queryByTestId(LEFT_OUT_LINK_TEST_ID)).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId(LEFT_OUT_TEST_ID)).queryByRole("link"),
    ).not.toBeInTheDocument();
    // Nor the corner's: nothing in the preview leaves the board.
    expect(
      screen.queryByTestId(`${RETENTION_WIDGET_TEST_ID}-open`),
    ).not.toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toEqual([]);
  });

  test("on a playlist's screen, which nobody drives: the same words, no link", async () => {
    getItemMock.mockResolvedValue(
      savedRetention(ProductAnalyticsRetentionPeriod.Week),
    );
    answerReads(8);

    renderWidget({ isPlayback: true });
    await waitForTable();

    expect(leftOutText()).toBe("2 more weeks");
    expect(screen.queryByTestId(LEFT_OUT_LINK_TEST_ID)).not.toBeInTheDocument();
  });

  test("in German: the longer headings leave out more, and say so in German", async () => {
    await act(async () => {
      await i18next.changeLanguage("de");
    });
    getItemMock.mockResolvedValue(
      savedRetention(ProductAnalyticsRetentionPeriod.Week),
    );
    answerReads(8);

    renderWidget();
    await waitForTable();

    // "Woche 0" is 61px: five weeks where English draws six.
    expect(headings().slice(2)).toEqual([
      "Woche 0",
      "Woche 1",
      "Woche 2",
      "Woche 3",
      "Woche 4",
    ]);
    expect(leftOutText()).toBe("3 weitere Wochen");
    expect(screen.getByTestId(LEFT_OUT_LINK_TEST_ID)).toHaveAttribute(
      "title",
      readDashboardLocale("de")["Open in User Retention"],
    );
  });

  test("a change of language measures again: back to English, six weeks", async () => {
    await act(async () => {
      await i18next.changeLanguage("de");
    });
    getItemMock.mockResolvedValue(
      savedRetention(ProductAnalyticsRetentionPeriod.Week),
    );
    answerReads(8);

    renderWidget();
    await waitForTable();

    expect(headings()).toHaveLength(7);

    await act(async () => {
      await i18next.changeLanguage("en");
    });

    await waitFor(() => {
      expect(headings()).toEqual(["Cohort", "People", ...weeks(6)]);
    });
    expect(leftOutText()).toBe("2 more weeks");
  });

  test("in Persian: its words and its digits", async () => {
    await act(async () => {
      await i18next.changeLanguage("fa");
    });
    getItemMock.mockResolvedValue(
      savedRetention(ProductAnalyticsRetentionPeriod.Week),
    );
    answerReads(8);

    renderWidget();
    await waitForTable();

    const leftOut: number = 8 - (headings().length - 2);
    const persianCount: string = new Intl.NumberFormat("fa").format(leftOut);

    expect(leftOut).toBeGreaterThan(0);
    expect(leftOutText()).toBe(
      readDashboardLocale("fa")["{{count}} more weeks"]!.replace(
        "{{count}}",
        persianCount,
      ),
    );
    expect(leftOutText()).toContain(persianCount);
    expect(leftOutText()).not.toMatch(/[0-9]/);
  });
});

describe("where not even one period fits beside the People column, it gives way (issue #6841)", () => {
  async function renderAt(
    width: number,
    overrides?: Partial<DashboardBaseComponentProps>,
  ): Promise<ReturnType<typeof render>> {
    getItemMock.mockResolvedValue(
      savedRetention(ProductAnalyticsRetentionPeriod.Week),
    );
    answerReads(8);

    const view: ReturnType<typeof render> = renderWidget({
      dashboardComponentWidthInPx: width,
      ...overrides,
    });
    await waitForTable();

    return view;
  }

  test("the cohort and its first period, with no People column in any row, and nothing that scrolls", async () => {
    // 201px of table: 202 with the People column, 150 without it.
    await renderAt(227);

    expect(headings()).toEqual(["Cohort", "Week 0"]);
    expect(
      bodyRows().map((row: HTMLElement): HTMLTableCellElement | null => {
        return peopleCell(row);
      }),
    ).toEqual([null, null, null, null]);
    expect(periodCellsPerRow()).toEqual([1, 1, 1, 1]);
    expect(drawnTable().offsetWidth).toBeLessThanOrEqual(
      getRetentionWidgetTableWidthInPx(227),
    );
    expect(leftOutText()).toBe("7 more weeks");
    // The spacer under All cohorts spans the cohort and the one period.
    expect(
      screen
        .getByTestId(TABLE_TEST_ID)
        .querySelector('tr[aria-hidden="true"] td'),
    ).toHaveAttribute("colspan", "2");
    // All cohorts still first.
    expect(screen.getByTestId(`${TABLE_TEST_ID}-average-row`)).toBe(
      bodyRows()[0],
    );
  });

  test("each cell still says how many people its cohort has, to the pointer and to a screen reader", async () => {
    await renderAt(227);

    const cohortCells: Array<HTMLElement> = screen.getAllByTestId(
      `${TABLE_TEST_ID}-cell`,
    );

    expect(cohortCells[0]).toHaveAttribute(
      "title",
      expect.stringContaining("of 200 came back"),
    );
    expect(cohortCells[0]).toHaveAttribute(
      "aria-label",
      cohortCells[0]!.getAttribute("title"),
    );
    expect(cohortCells[1]).toHaveAttribute(
      "title",
      expect.stringContaining("of 100 came back"),
    );
  });

  test("one period beside both columns, to the pixel: the People column stays", async () => {
    await renderAt(228);

    expect(headings()).toEqual(["Cohort", "People", "Week 0"]);
    expect(peopleCell(bodyRows()[1]!)).toHaveTextContent("200");
  });

  test("made wide enough for the whole table, the People column comes back with every period; made narrow again, it gives way again", async () => {
    const view: ReturnType<typeof render> = await renderAt(227);

    expect(headings()).toEqual(["Cohort", "Week 0"]);

    rerenderWidget(view, { dashboardComponentWidthInPx: 620 });

    await waitFor(() => {
      expect(headings()).toEqual(["Cohort", "People", ...weeks(8)]);
    });
    expect(screen.queryByTestId(LEFT_OUT_TEST_ID)).not.toBeInTheDocument();
    expect(peopleCell(bodyRows()[1]!)).toHaveTextContent("200");

    rerenderWidget(view, { dashboardComponentWidthInPx: 227 });

    await waitFor(() => {
      expect(headings()).toEqual(["Cohort", "Week 0"]);
    });
  });

  test("measured again with its People column after giving it way: the periods that fit beside it, to the pixel", async () => {
    const view: ReturnType<typeof render> = await renderAt(227);

    /*
     * 482px of table: 146 + 6 x 56, six weeks beside the People column. A
     * table measured without it would count its first week as a label
     * column and draw five.
     */
    rerenderWidget(view, { dashboardComponentWidthInPx: 508 });

    await waitFor(() => {
      expect(headings()).toEqual(["Cohort", "People", ...weeks(6)]);
    });
    expect(leftOutText()).toBe("2 more weeks");
  });

  test("a refresh measures it again, by the same rule", async () => {
    const view: ReturnType<typeof render> = await renderAt(227);

    answerReads(4);
    rerenderWidget(view, {
      dashboardComponentWidthInPx: 227,
      refreshTick: 1,
    });

    await waitFor(() => {
      expect(leftOutText()).toBe("3 more weeks");
    });
    expect(headings()).toEqual(["Cohort", "Week 0"]);
  });

  test("while the board is edited, and on a playlist: the same table", async () => {
    await renderAt(227, { isEditMode: true });

    expect(headings()).toEqual(["Cohort", "Week 0"]);
    expect(leftOutText()).toBe("7 more weeks");
    cleanup();

    await renderAt(227, { isPlayback: true });

    expect(headings()).toEqual(["Cohort", "Week 0"]);
  });

  test("in German: its own words", async () => {
    await act(async () => {
      await i18next.changeLanguage("de");
    });

    await renderAt(150);

    expect(headings()).toEqual(["Kohorte", "Woche 0"]);
    expect(leftOutText()).toBe("7 weitere Wochen");
  });

  test("the User Retention page keeps its People column, however narrow its box", () => {
    boxClientWidth = 100;

    const retention: ProductAnalyticsRetentionDto = retentionAnswer(8)({
      period: ProductAnalyticsRetentionPeriod.Week,
    }) as unknown as ProductAnalyticsRetentionDto;

    render(
      <ProductAnalyticsRetentionTable
        retention={retention}
        dataTestId={TABLE_TEST_ID}
      />,
    );

    expect(headings()).toEqual(["Cohort", "People", ...weeks(8)]);
    expect(peopleCell(bodyRows()[1]!)).toHaveTextContent("200");
  });
});

describe("a fitted table that changes size by itself is measured again", () => {
  /*
   * A FontFaceSet as the page has one: a test tells it a font came in.
   * jsdom has none, so it is put on the document for the test and taken
   * off after.
   */
  function withFonts(): EventTarget {
    const fonts: EventTarget = new EventTarget();

    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: fonts,
    });

    return fonts;
  }

  afterEach(() => {
    delete (document as unknown as { fonts?: unknown }).fonts;
  });

  async function renderDefaultWidget(): Promise<ReturnType<typeof render>> {
    getItemMock.mockResolvedValue(
      savedRetention(ProductAnalyticsRetentionPeriod.Week),
    );
    answerReads(8);

    const view: ReturnType<typeof render> = renderWidget();
    await waitForTable();

    return view;
  }

  test("measured before its styles were in, it is measured again once they are: the six weeks that fit", async () => {
    // No padding yet: 36px a period with its spacing, all eight in 495px.
    periodShortfallPx = 20;

    await renderDefaultWidget();

    expect(headings()).toEqual(["Cohort", "People", ...weeks(8)]);
    expect(screen.queryByTestId(LEFT_OUT_TEST_ID)).not.toBeInTheDocument();
    expect(measuredTables).toBe(1);

    // The styles are in: the table is drawn wider than its widget.
    periodShortfallPx = 0;
    notifyTableObservers();

    expect(headings()).toEqual(["Cohort", "People", ...weeks(6)]);
    expect(periodCellsPerRow()).toEqual([6, 6, 6, 6]);
    expect(leftOutText()).toBe("2 more weeks");
    expect(measuredTables).toBe(2);
    expect(
      within(screen.getByTestId(TABLE_TEST_ID)).getByRole("table"),
    ).toHaveClass("min-w-full");
  });

  test("measured too wide, it gets its periods back once its drawn size changes", async () => {
    // Before its styles: each period 20px wider than it is drawn.
    periodShortfallPx = -20;

    await renderDefaultWidget();

    // 76px a period: four in 495px.
    expect(headings()).toEqual(["Cohort", "People", ...weeks(4)]);
    expect(leftOutText()).toBe("4 more weeks");

    periodShortfallPx = 0;
    notifyTableObservers();

    expect(headings()).toEqual(["Cohort", "People", ...weeks(6)]);
    expect(leftOutText()).toBe("2 more weeks");
  });

  test("drawn again for something else before it is told of a change of size: still measured again once told", async () => {
    periodShortfallPx = 20;

    const view: ReturnType<typeof render> = await renderDefaultWidget();

    expect(headings()).toEqual(["Cohort", "People", ...weeks(8)]);

    // The styles are in, and the board is edited before the browser tells it.
    periodShortfallPx = 0;
    rerenderWidget(view, { isEditMode: true });

    expect(headings()).toEqual(["Cohort", "People", ...weeks(8)]);
    expect(measuredTables).toBe(1);

    notifyTableObservers();

    expect(headings()).toEqual(["Cohort", "People", ...weeks(6)]);
    expect(leftOutText()).toBe("2 more weeks");
  });

  test("told of a size it already has: not measured again", async () => {
    await renderDefaultWidget();

    expect(measuredTables).toBe(1);

    notifyTableObservers();
    notifyTableObservers();

    expect(measuredTables).toBe(1);
    expect(headings()).toEqual(["Cohort", "People", ...weeks(6)]);
    expect(leftOutText()).toBe("2 more weeks");
  });

  test("one observer, on the widget's own table; gone with the widget", async () => {
    const view: ReturnType<typeof render> = await renderDefaultWidget();

    expect(tableObservers()).toHaveLength(1);
    expect(tableObservers()[0]!.observed).toEqual([
      within(screen.getByTestId(TABLE_TEST_ID)).getByRole("table"),
    ]);

    view.unmount();

    expect(tableObservers()[0]!.isDisconnected).toBe(true);
  });

  test("a font that comes in measures it again, though no change of size showed it", async () => {
    const fonts: EventTarget = withFonts();
    periodShortfallPx = 20;

    await renderDefaultWidget();

    expect(headings()).toEqual(["Cohort", "People", ...weeks(8)]);

    /*
     * Drawn as wide as its widget either way (min-w-full), its size does
     * not change: only the font says so.
     */
    periodShortfallPx = 0;
    act(() => {
      fonts.dispatchEvent(new Event("loadingdone"));
    });

    expect(headings()).toEqual(["Cohort", "People", ...weeks(6)]);
    expect(leftOutText()).toBe("2 more weeks");
    expect(measuredTables).toBe(2);
  });

  test("its font listener goes with the widget", async () => {
    const fonts: EventTarget = withFonts();
    const added: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      fonts,
      "addEventListener",
    );
    const removed: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      fonts,
      "removeEventListener",
    );

    const view: ReturnType<typeof render> = await renderDefaultWidget();

    expect(added).toHaveBeenCalledTimes(1);
    expect(added.mock.calls[0]![0]).toBe("loadingdone");

    view.unmount();

    expect(removed).toHaveBeenCalledWith(
      "loadingdone",
      added.mock.calls[0]![1],
    );

    // Nothing is measured for a widget no longer there.
    periodShortfallPx = 20;
    fonts.dispatchEvent(new Event("loadingdone"));
    expect(measuredTables).toBe(1);
  });

  test(`never more than ${RETENTION_TABLE_MAX_REMEASURES} times for its size alone; a new width is measured afresh, and may be again`, async () => {
    const view: ReturnType<typeof render> = await renderDefaultWidget();

    expect(measuredTables).toBe(1);

    // A layout that moves each time the table is drawn.
    for (let change: number = 1; change <= 6; change++) {
      periodShortfallPx = change % 2 === 1 ? 10 : 0;
      notifyTableObservers();
    }

    expect(measuredTables).toBe(1 + RETENTION_TABLE_MAX_REMEASURES);

    rerenderWidget(view, { dashboardComponentWidthInPx: 620 });

    await waitFor(() => {
      expect(measuredTables).toBe(2 + RETENTION_TABLE_MAX_REMEASURES);
    });

    periodShortfallPx = periodShortfallPx === 0 ? 10 : 0;
    notifyTableObservers();

    expect(measuredTables).toBe(3 + RETENTION_TABLE_MAX_REMEASURES);
  });

  test("a font is one of those times too", async () => {
    const fonts: EventTarget = withFonts();

    await renderDefaultWidget();

    for (let font: number = 1; font <= 5; font++) {
      act(() => {
        fonts.dispatchEvent(new Event("loadingdone"));
      });
    }

    expect(measuredTables).toBe(1 + RETENTION_TABLE_MAX_REMEASURES);
  });

  test("the User Retention page, which draws every period, keeps no observer and no font listener", () => {
    const fonts: EventTarget = withFonts();
    const added: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      fonts,
      "addEventListener",
    );
    const retention: ProductAnalyticsRetentionDto = retentionAnswer(8)({
      period: ProductAnalyticsRetentionPeriod.Week,
    }) as unknown as ProductAnalyticsRetentionDto;

    render(
      <ProductAnalyticsRetentionTable
        retention={retention}
        dataTestId={TABLE_TEST_ID}
      />,
    );

    expect(headings()).toEqual(["Cohort", "People", ...weeks(8)]);
    expect(tableObservers()).toHaveLength(0);
    expect(added).not.toHaveBeenCalled();
    expect(measuredTables).toBe(0);
  });
});

describe("the line that says how many periods are left out", () => {
  test("keeps to the widget's foot, over the rows that scroll under it", async () => {
    getItemMock.mockResolvedValue(
      savedRetention(ProductAnalyticsRetentionPeriod.Week),
    );
    answerReads(8);

    renderWidget();
    await waitForTable();

    const line: HTMLElement = screen.getByTestId(LEFT_OUT_TEST_ID);

    expect(line.className).toBe(RETENTION_LEFT_OUT_CLASS_NAME);
    expect(line).toHaveClass("sticky", "bottom-0", "bg-white", "z-20");
    // Under the table, inside the widget's body: what it keeps to the foot of.
    expect(
      screen.getByTestId(TABLE_TEST_ID).compareDocumentPosition(line) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByTestId(RETENTION_WIDGET_TEST_ID).contains(line)).toBe(
      true,
    );
  });

  test("over the cohort column too, which holds its own place above the rows", () => {
    const layer: (classNames: string) => number = (
      classNames: string,
    ): number => {
      const match: RegExpMatchArray | null = classNames.match(/\bz-(\d+)\b/);

      return match ? Number(match[1]) : 0;
    };

    expect(layer(RETENTION_COHORT_COLUMN_CLASS_NAME)).toBe(10);
    expect(layer(RETENTION_LEFT_OUT_CLASS_NAME)).toBeGreaterThan(
      layer(RETENTION_COHORT_COLUMN_CLASS_NAME),
    );
  });
});

describe("how many periods fit", () => {
  // The default widget's table: 90 + 50, then 54 a period, 2px around each.
  const LABELS: ReadonlyArray<number> = [90, 50];
  const EIGHT_WEEKS: ReadonlyArray<number> = [54, 54, 54, 54, 54, 54, 54, 54];

  function fit(widthInPx: number, periods?: ReadonlyArray<number>): number {
    return countProductAnalyticsRetentionPeriodsThatFit({
      widthInPx: widthInPx,
      labelColumnsInPx: LABELS,
      periodColumnsInPx: periods || EIGHT_WEEKS,
      spacingInPx: 2,
    });
  }

  test("all of them in exactly the table's width; one fewer a pixel short", () => {
    // 2 + 92 + 52 + 8 x 56 = 594.
    expect(fit(594)).toBe(8);
    expect(fit(593)).toBe(7);
    expect(fit(10000)).toBe(8);
  });

  test("each period's column and its spacing: one more each 56px", () => {
    expect(fit(146 + 56 * 3)).toBe(3);
    expect(fit(146 + 56 * 3 - 1)).toBe(2);
    expect(fit(495)).toBe(6);
  });

  test("a fraction of a pixel of rounding leaves nothing out", () => {
    expect(fit(593.995)).toBe(8);
    expect(fit(593.98)).toBe(7);
  });

  test("never fewer than one, however narrow", () => {
    expect(fit(150)).toBe(1);
    expect(fit(1)).toBe(1);
    expect(fit(146 + 55)).toBe(1);
  });

  test.each([
    ["nothing", 0],
    ["less than nothing", -20],
    ["no number", Number.NaN],
    ["no end", Number.POSITIVE_INFINITY],
  ])(
    "a width of %s is nothing to measure against: every period",
    (_name: string, width: number) => {
      expect(fit(width)).toBe(8);
    },
  );

  test("a table with no periods: none", () => {
    expect(fit(495, [])).toBe(0);
    expect(fit(0, [])).toBe(0);
  });

  test("periods of different widths: from the first, while they fit", () => {
    // 146 + (40 + 2) + (120 + 2) = 310, then 60 + 2 more is 372.
    expect(fit(310, [40, 120, 60])).toBe(2);
    expect(fit(372, [40, 120, 60])).toBe(3);
    // A narrow later period does not jump the queue past a wide one.
    expect(fit(250, [40, 120, 10])).toBe(1);
  });

  test("seeded: every count fits its periods and the next one would not, and a wider width never draws fewer", () => {
    const random: SeededRandom = seededRandom(6721);

    for (let run: number = 0; run < 2000; run++) {
      const labels: Array<number> = [20 + random(150), 20 + random(80)];
      const periods: Array<number> = Array.from(
        { length: 1 + random(16) },
        (): number => {
          return 30 + random(70) + random();
        },
      );
      const spacing: number = random(5);
      const width: number = random(1600) + random();

      const used: (count: number) => number = (count: number): number => {
        let total: number = spacing;

        for (const label of labels) {
          total += label + spacing;
        }

        for (const period of periods.slice(0, count)) {
          total += period + spacing;
        }

        return total;
      };

      const count: number = countProductAnalyticsRetentionPeriodsThatFit({
        widthInPx: width,
        labelColumnsInPx: labels,
        periodColumnsInPx: periods,
        spacingInPx: spacing,
      });

      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(periods.length);

      // What it draws fits, unless it is the one it always draws.
      if (count > 1) {
        expect(used(count)).toBeLessThanOrEqual(width + 0.01);
      }

      // One more would not have.
      if (count < periods.length) {
        expect(used(count + 1)).toBeGreaterThan(width + 0.01);
      }

      const wider: number = countProductAnalyticsRetentionPeriodsThatFit({
        widthInPx: width + random(200),
        labelColumnsInPx: labels,
        periodColumnsInPx: periods,
        spacingInPx: spacing,
      });

      expect(wider).toBeGreaterThanOrEqual(count);
    }
  });
});

describe("what of a table fits: its periods, and whether its People column", () => {
  // The default widget's table: 90 + 50, then 54 a period, 2px around each.
  const LABELS: ReadonlyArray<number> = [90, 50];
  const EIGHT_WEEKS: ReadonlyArray<number> = [54, 54, 54, 54, 54, 54, 54, 54];

  function fitTable(
    widthInPx: number,
    options?: {
      labels?: ReadonlyArray<number>;
      periods?: ReadonlyArray<number>;
    },
  ): ProductAnalyticsRetentionTableFit {
    return fitProductAnalyticsRetentionTable({
      widthInPx: widthInPx,
      labelColumnsInPx: options?.labels || LABELS,
      periodColumnsInPx: options?.periods || EIGHT_WEEKS,
      spacingInPx: 2,
    });
  }

  test("a period fits beside both columns: the People column stays, and the count is the periods that fit", () => {
    expect(fitTable(594)).toEqual({ periods: 8, showsPeople: true });
    expect(fitTable(495)).toEqual({ periods: 6, showsPeople: true });
    // 2 + 92 + 52 + 56: one, to the pixel.
    expect(fitTable(202)).toEqual({ periods: 1, showsPeople: true });
    expect(fitTable(201.995)).toEqual({ periods: 1, showsPeople: true });
  });

  test("not even the first: the People column gives way, and the periods that fit beside the cohort alone", () => {
    expect(fitTable(201)).toEqual({ periods: 1, showsPeople: false });
    // Where the People column is wider than a period, two fit in its place.
    expect(fitTable(200, { labels: [90, 80], periods: [40, 40, 40] })).toEqual({
      periods: 2,
      showsPeople: false,
    });
    expect(fitTable(218, { labels: [90, 80], periods: [40, 40, 40] })).toEqual({
      periods: 1,
      showsPeople: true,
    });
  });

  test("not even one beside the cohort alone: still one period, without the People column", () => {
    expect(fitTable(150)).toEqual({ periods: 1, showsPeople: false });
    expect(fitTable(1)).toEqual({ periods: 1, showsPeople: false });
  });

  test.each([
    ["nothing", 0],
    ["less than nothing", -20],
    ["no number", Number.NaN],
    ["no end", Number.POSITIVE_INFINITY],
  ])(
    "a width of %s is nothing to fit to: every period and the People column",
    (_name: string, width: number) => {
      expect(fitTable(width)).toEqual({ periods: 8, showsPeople: true });
    },
  );

  test("a table with no periods, or no People column to give: as it is", () => {
    expect(fitTable(100, { periods: [] })).toEqual({
      periods: 0,
      showsPeople: true,
    });
    expect(fitTable(100, { labels: [90] })).toEqual({
      periods: 1,
      showsPeople: true,
    });
  });

  test("seeded: the People column gives way only where no period fits beside it, what is drawn fits unless it is the one period always drawn, and a wider width never takes it away", () => {
    const random: SeededRandom = seededRandom(6841);

    const used: (
      labels: ReadonlyArray<number>,
      periods: ReadonlyArray<number>,
      spacing: number,
    ) => number = (
      labels: ReadonlyArray<number>,
      periods: ReadonlyArray<number>,
      spacing: number,
    ): number => {
      let total: number = spacing;

      for (const width of [...labels, ...periods]) {
        total += width + spacing;
      }

      return total;
    };

    for (let run: number = 0; run < 2000; run++) {
      const labels: Array<number> = [20 + random(150), 20 + random(80)];
      const periods: Array<number> = Array.from(
        { length: 1 + random(16) },
        (): number => {
          return 30 + random(70) + random();
        },
      );
      const spacing: number = random(5);
      const width: number = 1 + random(800) + random();
      const data: {
        widthInPx: number;
        labelColumnsInPx: Array<number>;
        periodColumnsInPx: Array<number>;
        spacingInPx: number;
      } = {
        widthInPx: width,
        labelColumnsInPx: labels,
        periodColumnsInPx: periods,
        spacingInPx: spacing,
      };
      const fit: ProductAnalyticsRetentionTableFit =
        fitProductAnalyticsRetentionTable(data);
      const firstBesideBoth: boolean =
        used(labels, periods.slice(0, 1), spacing) <= width + 0.01;

      expect(fit.showsPeople).toBe(firstBesideBoth);
      expect(fit.periods).toBeGreaterThanOrEqual(1);
      expect(fit.periods).toBeLessThanOrEqual(periods.length);

      const drawnLabels: Array<number> = fit.showsPeople
        ? labels
        : labels.slice(0, 1);

      if (fit.periods > 1) {
        expect(
          used(drawnLabels, periods.slice(0, fit.periods), spacing),
        ).toBeLessThanOrEqual(width + 0.01);
      }

      if (fit.periods < periods.length) {
        expect(
          used(drawnLabels, periods.slice(0, fit.periods + 1), spacing),
        ).toBeGreaterThan(width + 0.01);
      }

      // With its People column, the count is the one the widget always counted.
      if (fit.showsPeople) {
        expect(fit.periods).toBe(
          countProductAnalyticsRetentionPeriodsThatFit(data),
        );
      }

      const wider: ProductAnalyticsRetentionTableFit =
        fitProductAnalyticsRetentionTable({
          ...data,
          widthInPx: width + random(200),
        });

      if (fit.showsPeople) {
        expect(wider.showsPeople).toBe(true);
        expect(wider.periods).toBeGreaterThanOrEqual(fit.periods);
      }
    }
  });
});

describe("a table's widths, as drawn", () => {
  function table(headings: Array<string>): HTMLTableElement {
    const element: HTMLTableElement = document.createElement("table");
    const head: HTMLTableSectionElement = element.createTHead();
    const row: HTMLTableRowElement = head.insertRow();

    for (const heading of headings) {
      const cell: HTMLTableCellElement = document.createElement("th");

      cell.textContent = heading;
      // At the line's end, as the table sets its People heading.
      cell.className = heading === "People" ? "text-end" : "";
      row.appendChild(cell);
    }

    document.body.appendChild(element);

    return element;
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("each heading's width, and the spacing once more than there are columns", () => {
    const element: HTMLTableElement = table([
      "Cohort",
      "People",
      "Week 0",
      "Week 1",
    ]);

    // 90 + 50 + 54 + 54, and 2px five times.
    expect(readProductAnalyticsRetentionTableWidths(element)).toEqual({
      columnsInPx: [90, 50, 54, 54],
      spacingInPx: 2,
    });
  });

  test("no headings: no columns and no spacing", () => {
    const element: HTMLTableElement = document.createElement("table");

    document.body.appendChild(element);

    expect(readProductAnalyticsRetentionTableWidths(element)).toEqual({
      columnsInPx: [],
      spacingInPx: 0,
    });
  });

  test("a table no wider than its cells: no spacing, never less than none", () => {
    const element: HTMLTableElement = table(["Cohort", "People"]);

    getJestSpyOn(element, "getBoundingClientRect").mockReturnValue(rect(100));

    expect(readProductAnalyticsRetentionTableWidths(element)).toEqual({
      columnsInPx: [90, 50],
      spacingInPx: 0,
    });
  });
});

describe("the widget's room and its words", () => {
  test("the table has the widget's width less its border and padding, never less than none", () => {
    expect(RETENTION_WIDGET_CHROME_IN_PX).toBe(26);
    expect(getRetentionWidgetTableWidthInPx(521)).toBe(495);
    expect(getRetentionWidgetTableWidthInPx(620)).toBe(594);
    expect(getRetentionWidgetTableWidthInPx(26)).toBe(0);
    expect(getRetentionWidgetTableWidthInPx(10)).toBe(0);
  });

  test("it links only once its saved table is read, and never while edited, in the settings' preview or on a playlist", () => {
    const ready: {
      state: ProductAnalyticsWidgetState;
      hasView: boolean;
      isEditMode: boolean;
      isPreview: boolean;
      isPlayback: boolean;
    } = {
      state: ProductAnalyticsWidgetState.Ready,
      hasView: true,
      isEditMode: false,
      isPreview: false,
      isPlayback: false,
    };

    expect(isProductAnalyticsWidgetLinked(ready)).toBe(true);
    expect(isProductAnalyticsWidgetLinked({ ...ready, hasView: false })).toBe(
      false,
    );
    expect(isProductAnalyticsWidgetLinked({ ...ready, isEditMode: true })).toBe(
      false,
    );
    // Issue #6859: the preview is drawn over a board being edited.
    expect(isProductAnalyticsWidgetLinked({ ...ready, isPreview: true })).toBe(
      false,
    );
    expect(isProductAnalyticsWidgetLinked({ ...ready, isPlayback: true })).toBe(
      false,
    );

    for (const state of Object.values(ProductAnalyticsWidgetState)) {
      if (state !== ProductAnalyticsWidgetState.Ready) {
        expect(isProductAnalyticsWidgetLinked({ ...ready, state: state })).toBe(
          false,
        );
      }
    }
  });

  test("one sentence a period, each with its count, the general form the key", () => {
    expect(Object.keys(RETENTION_PERIODS_LEFT_OUT).sort()).toEqual(
      Object.values(ProductAnalyticsRetentionPeriod).sort(),
    );

    const english: Record<string, string> = readDashboardLocale("en");

    for (const sentence of Object.values(RETENTION_PERIODS_LEFT_OUT)) {
      expect(sentence.one).toContain("{{count}}");
      expect(sentence.other).toContain("{{count}}");
      expect(english[sentence.other]).toBe(sentence.other);
      expect(english[`${sentence.other}_one`]).toBe(sentence.one);
    }
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "%s words what the widget leaves out, keeping the count",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const sentence of Object.values(RETENTION_PERIODS_LEFT_OUT)) {
        for (const key of [sentence.other, `${sentence.other}_one`]) {
          expect(isWordedInDashboardLocale(key, language)).toBe(true);
          expect(words[key]).toContain("{{count}}");
        }
      }
    },
  );
});

/*
 * jsdom has no stylesheet, so the class names alone prove nothing: the
 * Dashboard styles itself with the vendored Tailwind runtime and the
 * reading-direction script (its index.ejs), run here over the line's and
 * the cohort column's classes. Last in the file: the runtime watches the
 * page from here on.
 */
describe("the CSS the page writes for the line", () => {
  const DASHBOARD_CONFIG: Record<string, unknown> = {
    darkMode: "class",
    theme: {
      extend: {
        fontFamily: {
          display: ["Inter", "sans-serif"],
          body: ["Inter", "sans-serif"],
        },
      },
    },
  };

  let rules: Array<EmittedRule> = [];

  beforeAll(async () => {
    await loadPlayCdn({
      withReadingDirection: true,
      config: DASHBOARD_CONFIG,
    });

    rules = await addClassNames([
      RETENTION_LEFT_OUT_CLASS_NAME,
      RETENTION_COHORT_COLUMN_CLASS_NAME,
    ]);
  }, 60000);

  afterAll(() => {
    unloadPlayCdn();
  });

  test("held to the foot of what scrolls it, over the cohort column, on the card's background", () => {
    expect(declarationsForSelector(rules, ".sticky")).toEqual({
      position: "sticky",
    });
    expect(declarationsForSelector(rules, ".bottom-0")).toEqual({
      bottom: "0px",
    });
    expect(declarationsForSelector(rules, ".z-20")).toEqual({
      "z-index": "20",
    });
    expect(declarationsForSelector(rules, ".z-10")).toEqual({
      "z-index": "10",
    });
    expect(
      declarationsForSelector(rules, ".bg-white")["background-color"],
    ).toContain("255 255 255");
  });

  test("its words at the line's end, in a language read from the right too", () => {
    expect(declarationsForSelector(rules, ".justify-end")).toEqual({
      "justify-content": "flex-end",
    });
    expect(declarationsForSelector(rules, ".start-0")).toEqual({
      "inset-inline-start": "0px",
    });
  });
});
