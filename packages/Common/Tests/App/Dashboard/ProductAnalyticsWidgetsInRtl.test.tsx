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
import DashboardProductAnalyticsFunnelComponent from "../../../Types/Dashboard/DashboardComponents/DashboardProductAnalyticsFunnelComponent";
import DashboardProductAnalyticsRetentionComponent from "../../../Types/Dashboard/DashboardComponents/DashboardProductAnalyticsRetentionComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { ProductAnalyticsSavedViewType } from "../../../Types/Rum/ProductAnalyticsSavedViews";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import { Translator } from "../../../Types/Translator";
import { LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME } from "../../../UI/Utils/LineDirection";
import ProjectUtil from "../../../UI/Utils/Project";
import DashboardProductAnalyticsFunnelComponentUtil from "../../../Utils/Dashboard/Components/DashboardProductAnalyticsFunnelComponent";
import DashboardProductAnalyticsRetentionComponentUtil from "../../../Utils/Dashboard/Components/DashboardProductAnalyticsRetentionComponent";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import {
  DrawnLine,
  drawLine,
  getDrawnText,
  isDrawnAsWritten,
} from "../../Helpers/BidiLayout";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import {
  EmittedRule,
  addClassNames,
  declarationsForSelector,
  loadPlayCdn,
  unloadPlayCdn,
} from "../../Helpers/TailwindPlayCdn";
import { answerProductAnalyticsReads } from "../../UI/Rum/ProductAnalyticsEventsPageKit";

/*
 * THE FUNNEL AND USER RETENTION WIDGETS ON AN ARABIC OR PERSIAN BOARD
 * (#6858).
 *
 * Three faults, each drawn here for real:
 *
 * - The widget's title is words someone wrote - or the saved funnel's or
 *   table's name - in their language whatever the board's, cut where the
 *   widget ends. On a board read from the right an English title was cut
 *   at its start: "Buyers who buy again (8 units, monthly range)" read
 *   "...y again (8 units, monthly range)". It now reads its own way (dir),
 *   so it is cut at its own end, lined up on the board's side.
 *
 * - A funnel step that is a page view is a sentence around the page's
 *   path, "شاهد /pricing": the path's leading "/" sat between an Arabic
 *   word and a Latin one and took the sentence's way, and the step read
 *   "pricing/". The path is now set apart from the sentence in an isolate.
 *
 * - A step's people and their share were one line, the share a span with
 *   a margin inside it: Arabic writes the count last ("الأشخاص: 4,210"), so
 *   the two numbers met in one run, "4,210100%", the margin drawn outside
 *   it. They are now a flex row's two boxes, a gap apart.
 *
 * A German or English board, and a public dashboard (an English page), are
 * drawn as they always were. The CSS the boxes' classes get is the page's
 * own: the vendored Tailwind runtime and the reading-direction script, run
 * over the classes the widget draws (last in the file).
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
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import {
  PublicDashboardContext,
  setPublicDashboardContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import { formatProductAnalyticsShare } from "../../../../App/FeatureSet/Dashboard/src/Components/ProductAnalytics/ProductAnalyticsFormat";

const PROJECT_ID: string = "68580000-0000-4000-8000-000000000001";
const APP_ID: string = "68580000-0000-4000-8000-000000000002";
const FUNNEL_ID: string = "68580000-0000-4000-8000-000000000003";
const RETENTION_ID: string = "68580000-0000-4000-8000-000000000004";

const COMPONENT_ID: ObjectID = new ObjectID(
  "68580000-0000-4000-8000-000000000005",
);

const DAY_MS: number = 24 * 60 * 60 * 1000;

// A CUSTOM range: the window never depends on the clock.
const BOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-11-01T00:00:00.000Z"),
    new Date("2026-11-08T00:00:00.000Z"),
  ),
};

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 60,
};

const PUBLIC_DASHBOARD: PublicDashboardContext = {
  dashboardId: new ObjectID("68580000-0000-4000-8000-000000000006"),
} as unknown as PublicDashboardContext;

// The titles the issue reports, as someone gave them to the widgets.
const FUNNEL_TITLE: string = "Pricing to purchase (EU West, last 7 days)";
const RETENTION_TITLE: string = "Buyers who buy again (8 units, monthly range)";

// The saved ones' own names: the title of a widget that has none.
const FUNNEL_NAME: string = "Pricing to purchase";
const RETENTION_NAME: string = "Buyers who come back";

const ARABIC_TITLE: string = "المشترون الذين يعودون للشراء";
const PERSIAN_TITLE: string = "خریدارانی که دوباره می‌خرند";

// The title's box, as the widget always drew it.
const TITLE_CLASS_NAME: string =
  "min-w-0 truncate text-sm font-medium text-gray-700";

const PAGE_PATH: string = "/pricing";
const CUSTOM_EVENT: string = "Purchased";

const FUNNEL_DEFINITION: JSONObject = {
  steps: [
    { kind: "page", name: PAGE_PATH },
    { kind: "custom", name: CUSTOM_EVENT },
  ],
  windowMs: 7 * DAY_MS,
  filters: [],
};

const RETENTION_DEFINITION: JSONObject = {
  startEvent: { kind: "custom", name: "Signed up" },
  returnEvent: { kind: "custom", name: CUSTOM_EVENT },
  period: "day",
  filters: [],
};

// Each step's people: four figures with a group separator, as reported.
const PEOPLE: ReadonlyArray<number> = [4210, 1263];

const PEOPLE_PLURAL: { one: string; other: string } = {
  one: "{{count}} person",
  other: "{{count}} people",
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

function savedFunnel(name?: string): RumProductAnalyticsSavedView {
  return savedRow({
    id: FUNNEL_ID,
    name: name || FUNNEL_NAME,
    viewType: ProductAnalyticsSavedViewType.Funnel,
    definition: FUNNEL_DEFINITION,
  });
}

function savedRetention(name?: string): RumProductAnalyticsSavedView {
  return savedRow({
    id: RETENTION_ID,
    name: name || RETENTION_NAME,
    viewType: ProductAnalyticsSavedViewType.Retention,
    definition: RETENTION_DEFINITION,
  });
}

function funnelAnswer(data: JSONObject): JSONObject {
  const steps: Array<JSONObject> = data["steps"] as Array<JSONObject>;
  const first: number = PEOPLE[0]!;

  return {
    windowMs: data["windowMs"] as number,
    steps: steps.map((step: JSONObject, index: number): JSONObject => {
      const reached: number = PEOPLE[index] ?? 1;
      const previous: number = index === 0 ? reached : PEOPLE[index - 1]!;

      return {
        ...step,
        people: reached,
        conversionFromStart: reached / first,
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

function buildProps(): DashboardBaseComponentProps {
  return {
    componentId: COMPONENT_ID,
    isEditMode: false,
    isSelected: false,
    key: "product-analytics-widget-in-rtl",
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
    dashboardId: "68580000-0000-4000-8000-000000000007",
  };
}

// A board is drawn in the app's router: the link to the page is a link.
function InRouter(props: { children?: React.ReactNode }): React.ReactElement {
  return <MemoryRouter>{props.children}</MemoryRouter>;
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

function answerReads(): void {
  answerProductAnalyticsReads(postMock, {
    funnel: funnelAnswer,
    retention: retentionAnswer,
  });
}

// The Funnel widget on a saved funnel, drawn once its steps are in.
async function drawFunnel(data: {
  title?: string | undefined;
  savedName?: string | undefined;
}): Promise<Array<HTMLElement>> {
  getItemMock.mockResolvedValue(savedFunnel(data.savedName));
  answerReads();

  render(
    <DashboardProductAnalyticsFunnelComponentElement
      {...buildProps()}
      component={funnelComponent({
        savedViewId: FUNNEL_ID,
        title: data.title,
      })}
    />,
    { wrapper: InRouter },
  );

  await waitFor(() => {
    expect(
      screen.getAllByTestId(`${FUNNEL_WIDGET_TEST_ID}-chart-step`),
    ).toHaveLength(2);
  });

  return screen.getAllByTestId(`${FUNNEL_WIDGET_TEST_ID}-chart-step`);
}

// The User Retention widget on a saved table, drawn once its cohorts are in.
async function drawRetention(data: {
  title?: string | undefined;
  savedName?: string | undefined;
}): Promise<void> {
  getItemMock.mockResolvedValue(savedRetention(data.savedName));
  answerReads();

  render(
    <DashboardProductAnalyticsRetentionComponentElement
      {...buildProps()}
      component={retentionComponent({
        savedViewId: RETENTION_ID,
        title: data.title,
      })}
    />,
    { wrapper: InRouter },
  );

  await waitFor(() => {
    expect(
      screen.getAllByTestId(`${RETENTION_WIDGET_TEST_ID}-table-row`),
    ).toHaveLength(3);
  });
}

function funnelTitle(): HTMLElement {
  return screen.getByTestId(`${FUNNEL_WIDGET_TEST_ID}-title`);
}

function retentionTitle(): HTMLElement {
  return screen.getByTestId(`${RETENTION_WIDGET_TEST_ID}-title`);
}

/*
 * A title that reads the other way from the board: its own way, so it is
 * cut at its own end, and lined up on the board's side (its end), whole
 * under the pointer.
 */
function expectReadItsOwnWay(
  title: HTMLElement,
  text: string,
  direction: "ltr" | "rtl",
): void {
  expect(title.textContent).toBe(text);
  expect(title).toHaveAttribute("dir", direction);
  expect(title).toHaveClass(
    "min-w-0",
    "truncate",
    LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
  );
  expect(title).toHaveAttribute("title", text);
}

// A title that reads the board's way: drawn exactly as it always was.
function expectDrawnAsItWas(title: HTMLElement, text: string): void {
  expect(title.textContent).toBe(text);
  expect(title).not.toHaveAttribute("dir");
  expect(title.className).toBe(TITLE_CLASS_NAME);
  expect(title).toHaveAttribute("title", text);
}

// A step's name: the sentence, or the event's own name.
function stepLabel(step: HTMLElement): HTMLElement {
  return within(step).getByTestId(`${FUNNEL_WIDGET_TEST_ID}-chart-label`);
}

function stepFigures(step: HTMLElement): {
  figures: HTMLElement;
  people: HTMLElement;
  share: HTMLElement;
} {
  const figures: HTMLElement = within(step).getByTestId(
    `${FUNNEL_WIDGET_TEST_ID}-chart-figures`,
  );

  return {
    figures: figures,
    people: within(figures).getByTestId(
      `${FUNNEL_WIDGET_TEST_ID}-chart-people`,
    ),
    share: within(figures).getByTestId(`${FUNNEL_WIDGET_TEST_ID}-chart-share`),
  };
}

// Whether the units of `part` in `text` are drawn as written in a line read `direction`.
function isPartDrawnAsWritten(
  text: string,
  part: string,
  direction: "ltr" | "rtl",
): boolean {
  const at: number = text.indexOf(part);

  expect(at).toBeGreaterThanOrEqual(0);

  return isDrawnAsWritten(drawLine(text, direction), at, at + part.length);
}

async function inLanguage(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      de: { translation: readDashboardLocale("de") },
      ar: { translation: readDashboardLocale("ar") },
      fa: { translation: readDashboardLocale("fa") },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  postMock.mockReset();
  getItemMock.mockReset();
  setPublicDashboardContext(null);
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  await inLanguage("en");
});

afterEach(() => {
  cleanup();
  setPublicDashboardContext(null);
  jest.restoreAllMocks();
});

describe.each(["ar", "fa"])(
  "the widget's title on a %s board",
  (language: string) => {
    beforeEach(async () => {
      await inLanguage(language);
    });

    test("the Funnel widget's own English title reads left to right: cut at its own end, lined up on the board's side", async () => {
      await drawFunnel({ title: FUNNEL_TITLE });

      expectReadItsOwnWay(funnelTitle(), FUNNEL_TITLE, "ltr");
    });

    test("a Funnel widget with no title of its own: the saved funnel's English name reads left to right too", async () => {
      await drawFunnel({ title: undefined });

      expectReadItsOwnWay(funnelTitle(), FUNNEL_NAME, "ltr");
    });

    test("the User Retention widget's own English title - the one reported - reads left to right", async () => {
      await drawRetention({ title: RETENTION_TITLE });

      expectReadItsOwnWay(retentionTitle(), RETENTION_TITLE, "ltr");
    });

    test("a User Retention widget with no title of its own: the saved table's English name reads left to right too", async () => {
      await drawRetention({ title: undefined });

      expectReadItsOwnWay(retentionTitle(), RETENTION_NAME, "ltr");
    });

    test("a title in the board's own script is drawn as it always was", async () => {
      const ownTitle: string = language === "ar" ? ARABIC_TITLE : PERSIAN_TITLE;

      await drawFunnel({ title: ownTitle });
      expectDrawnAsItWas(funnelTitle(), ownTitle);
      cleanup();

      await drawRetention({ title: ownTitle });
      expectDrawnAsItWas(retentionTitle(), ownTitle);
    });

    test("the link to the page stays beside the title, outside it: the title's box holds the title alone", async () => {
      await drawFunnel({ title: FUNNEL_TITLE });

      const title: HTMLElement = funnelTitle();
      const link: HTMLElement = screen.getByTestId(
        `${FUNNEL_WIDGET_TEST_ID}-open`,
      );

      expect(title.children).toHaveLength(0);
      expect(title.contains(link)).toBe(false);
      expect(title.parentElement).toBe(link.parentElement?.parentElement);
    });
  },
);

describe("the widget's title on a board read from the left", () => {
  test.each(["de", "en"])(
    "%s: an English title, and the saved one's English name, are drawn as they always were",
    async (language: string) => {
      await inLanguage(language);

      await drawFunnel({ title: FUNNEL_TITLE });
      expectDrawnAsItWas(funnelTitle(), FUNNEL_TITLE);
      cleanup();

      await drawRetention({ title: undefined });
      expectDrawnAsItWas(retentionTitle(), RETENTION_NAME);
    },
  );

  test("de: an Arabic title reads right to left, cut at its own end, lined up on the board's side", async () => {
    await inLanguage("de");

    await drawRetention({ title: ARABIC_TITLE });

    expectReadItsOwnWay(retentionTitle(), ARABIC_TITLE, "rtl");
  });
});

describe("the widget's title on a public dashboard - an English page, whatever its visitor reads", () => {
  test("an English title is drawn as the page draws it, though the visitor reads Arabic", async () => {
    await inLanguage("ar");
    setPublicDashboardContext(PUBLIC_DASHBOARD);

    getItemMock.mockResolvedValue(savedFunnel());
    answerReads();

    render(
      <DashboardProductAnalyticsFunnelComponentElement
        {...buildProps()}
        component={funnelComponent({
          savedViewId: FUNNEL_ID,
          title: FUNNEL_TITLE,
        })}
      />,
      { wrapper: InRouter },
    );

    // Nothing is read on a public dashboard: the title over its notice.
    expectDrawnAsItWas(
      await screen.findByTestId(`${FUNNEL_WIDGET_TEST_ID}-title`),
      FUNNEL_TITLE,
    );
    expect(postMock).not.toHaveBeenCalled();
  });

  test("an Arabic title reads right to left on that English page", async () => {
    await inLanguage("ar");
    setPublicDashboardContext(PUBLIC_DASHBOARD);

    render(
      <DashboardProductAnalyticsRetentionComponentElement
        {...buildProps()}
        component={retentionComponent({
          savedViewId: RETENTION_ID,
          title: ARABIC_TITLE,
        })}
      />,
      { wrapper: InRouter },
    );

    expectReadItsOwnWay(
      await screen.findByTestId(`${RETENTION_WIDGET_TEST_ID}-title`),
      ARABIC_TITLE,
      "rtl",
    );
  });
});

describe.each(["ar", "fa"])(
  "a funnel step's page on a %s board",
  (language: string) => {
    beforeEach(async () => {
      await inLanguage(language);
    });

    test("the page's path is set apart from the sentence around it, and drawn as written: /pricing, never pricing/", async () => {
      const steps: Array<HTMLElement> = await drawFunnel({
        title: FUNNEL_TITLE,
      });
      const label: HTMLElement = stepLabel(steps[0]!);
      const text: string = label.textContent || "";

      expect(text).toBe(
        readDashboardLocale(language)["Viewed {{page}}"]!.replace(
          "{{page}}",
          isolated(PAGE_PATH),
        ),
      );
      // Its paragraph reads the way its first letter does: the sentence's.
      expect(label).toHaveAttribute("dir", "auto");
      expect(label).toHaveClass("min-w-0", "truncate");
      expect(label).toHaveAttribute("title", text);

      const line: DrawnLine = drawLine(text, "rtl");

      expect(isPartDrawnAsWritten(text, PAGE_PATH, "rtl")).toBe(true);
      expect(getDrawnText(line)).toContain(PAGE_PATH);
    });

    test("as it was - the sentence filled with the bare path - its '/' took the sentence's way: pricing/", async () => {
      const steps: Array<HTMLElement> = await drawFunnel({
        title: FUNNEL_TITLE,
      });
      const bare: string = withoutIsolateMarks(
        stepLabel(steps[0]!).textContent || "",
      );

      expect(isPartDrawnAsWritten(bare, PAGE_PATH, "rtl")).toBe(false);
      expect(getDrawnText(drawLine(bare, "rtl"))).toContain("pricing/");
    });

    test("a step that is one of the application's own events is its name as sent: nothing set apart", async () => {
      const steps: Array<HTMLElement> = await drawFunnel({
        title: FUNNEL_TITLE,
      });
      const label: HTMLElement = stepLabel(steps[1]!);

      expect(label.textContent).toBe(CUSTOM_EVENT);
      expect(label).toHaveAttribute("dir", "auto");
      expect(label).toHaveAttribute("title", CUSTOM_EVENT);
    });
  },
);

describe("a funnel step's page on a board read from the left", () => {
  test.each([
    ["de", `${PAGE_PATH} aufgerufen`],
    ["en", `Viewed ${PAGE_PATH}`],
  ])(
    "%s: the sentence is filled as it always was - %s, no isolate's marks",
    async (language: string, expected: string) => {
      await inLanguage(language);

      const steps: Array<HTMLElement> = await drawFunnel({
        title: FUNNEL_TITLE,
      });
      const label: HTMLElement = stepLabel(steps[0]!);

      expect(label.textContent).toBe(expected);
      expect(label).toHaveAttribute("title", expected);
      expect(isPartDrawnAsWritten(expected, PAGE_PATH, "ltr")).toBe(true);
    },
  );
});

describe("a funnel step's people and their share", () => {
  /*
   * The two figures as the flex row's two items: side by side, neither in
   * the other - each a box of its own, laid out as a line of its own.
   */
  function expectTwoBoxes(step: HTMLElement): {
    people: HTMLElement;
    share: HTMLElement;
  } {
    const { figures, people, share } = stepFigures(step);

    expect(figures).toHaveClass(
      "flex",
      "flex-none",
      "items-baseline",
      "gap-2",
      "tabular-nums",
    );
    expect(Array.from(figures.children)).toEqual([people, share]);
    expect(people.contains(share)).toBe(false);
    expect(share.contains(people)).toBe(false);
    // The gap sets them apart: no margin of a box's own, drawn on its far side.
    expect(people.className).not.toMatch(/(?:^|\s)-?m[sexl]?-/);
    expect(share.className).not.toMatch(/(?:^|\s)-?m[sexl]?-/);

    return { people, share };
  }

  test("ar: 4,210 people and 100% are two boxes a gap apart - never the one run 4,210100%", async () => {
    await inLanguage("ar");

    const translator: Translator = dashboardTranslator("ar");
    const steps: Array<HTMLElement> = await drawFunnel({ title: FUNNEL_TITLE });
    const { people, share } = expectTwoBoxes(steps[0]!);
    const peopleText: string = people.textContent || "";
    const shareText: string = share.textContent || "";

    expect(peopleText).toBe(translator.translatePlural(PEOPLE_PLURAL, 4210));
    expect(peopleText).toContain("4,210");
    expect(shareText).toBe(
      formatProductAnalyticsShare({ part: 1, whole: 1, language: "ar" }),
    );

    // Each box is laid out on its own: its number drawn as written.
    expect(isPartDrawnAsWritten(peopleText, "4,210", "rtl")).toBe(true);
    expect(getDrawnText(drawLine(shareText, "rtl"))).toBe("100%");

    // As one line, the way they were drawn, the two numbers met in one run.
    expect(
      getDrawnText(drawLine(`${peopleText}${shareText}`, "rtl")),
    ).toContain("4,210100%");
  });

  test("ar: the next step's figures are two boxes too: 1,263 people, 30%", async () => {
    await inLanguage("ar");

    const translator: Translator = dashboardTranslator("ar");
    const steps: Array<HTMLElement> = await drawFunnel({ title: FUNNEL_TITLE });
    const { people, share } = expectTwoBoxes(steps[1]!);

    expect(people.textContent).toBe(
      translator.translatePlural(PEOPLE_PLURAL, 1263),
    );
    expect(share.textContent).toBe(
      formatProductAnalyticsShare({ part: 0.3, whole: 1, language: "ar" }),
    );
  });

  test("fa: Persian's own digits, in the same two boxes", async () => {
    await inLanguage("fa");

    const translator: Translator = dashboardTranslator("fa");
    const steps: Array<HTMLElement> = await drawFunnel({ title: FUNNEL_TITLE });
    const { people, share } = expectTwoBoxes(steps[0]!);

    expect(people.textContent).toBe(
      translator.translatePlural(PEOPLE_PLURAL, 4210),
    );
    expect(people.textContent).toContain("۴٬۲۱۰");
    expect(share.textContent).toBe(
      formatProductAnalyticsShare({ part: 1, whole: 1, language: "fa" }),
    );
  });

  test.each(["de", "en"])(
    "%s: the same two boxes, the count and the share as they always read",
    async (language: string) => {
      await inLanguage(language);

      const translator: Translator = dashboardTranslator(language);
      const steps: Array<HTMLElement> = await drawFunnel({
        title: FUNNEL_TITLE,
      });
      const { people, share } = expectTwoBoxes(steps[0]!);

      expect(people.textContent).toBe(
        translator.translatePlural(PEOPLE_PLURAL, 4210),
      );
      expect(share.textContent).toBe(
        formatProductAnalyticsShare({ part: 1, whole: 1, language: language }),
      );
    },
  );
});

/*
 * jsdom has no stylesheet, so the class names alone prove nothing: the
 * Dashboard styles itself with the vendored Tailwind runtime and the
 * reading-direction script (its index.ejs), run here over the classes the
 * Funnel widget draws on an Arabic board - read from it before the runtime
 * is loaded. Last in the file: the runtime watches the page from here on.
 */
describe("the CSS the page writes for the title, a step's name and its figures", () => {
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

  const drawn: {
    title: string;
    label: string;
    figures: string;
    people: string;
    share: string;
  } = { title: "", label: "", figures: "", people: "", share: "" };

  let rules: Array<EmittedRule> = [];

  beforeAll(async () => {
    getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
      new ObjectID(PROJECT_ID),
    );
    await inLanguage("ar");

    const steps: Array<HTMLElement> = await drawFunnel({ title: FUNNEL_TITLE });
    const { figures, people, share } = stepFigures(steps[0]!);

    drawn.title = funnelTitle().className;
    drawn.label = stepLabel(steps[0]!).className;
    drawn.figures = figures.className;
    drawn.people = people.className;
    drawn.share = share.className;

    cleanup();
    jest.restoreAllMocks();
    await inLanguage("en");

    await loadPlayCdn({
      withReadingDirection: true,
      config: DASHBOARD_CONFIG,
    });

    rules = await addClassNames([
      drawn.title,
      drawn.label,
      drawn.figures,
      drawn.people,
      drawn.share,
    ]);
  }, 60000);

  afterAll(() => {
    unloadPlayCdn();
  });

  test("the title: one line, cut with an ellipsis where the widget ends, lined up at its end - the board's start", () => {
    expect(drawn.title.split(" ")).toEqual(
      expect.arrayContaining(["min-w-0", "truncate", "text-end"]),
    );
    expect(declarationsForSelector(rules, ".truncate")).toEqual({
      overflow: "hidden",
      "text-overflow": "ellipsis",
      "white-space": "nowrap",
    });
    expect(declarationsForSelector(rules, ".text-end")).toEqual({
      "text-align": "end",
    });
    expect(declarationsForSelector(rules, ".min-w-0")).toEqual({
      "min-width": "0px",
    });
  });

  test("a step's name: one line, cut where its box ends", () => {
    expect(drawn.label.split(" ")).toEqual(
      expect.arrayContaining(["min-w-0", "truncate"]),
    );
  });

  test("a step's figures: a flex row of two boxes, 0.5rem apart, on one baseline, never squeezed", () => {
    expect(drawn.figures.split(" ")).toEqual(
      expect.arrayContaining(["flex", "flex-none", "items-baseline", "gap-2"]),
    );
    expect(declarationsForSelector(rules, ".flex")).toEqual({
      display: "flex",
    });
    expect(declarationsForSelector(rules, ".gap-2")).toEqual({
      gap: "0.5rem",
    });
    expect(declarationsForSelector(rules, ".items-baseline")).toEqual({
      "align-items": "baseline",
    });
    expect(declarationsForSelector(rules, ".flex-none")).toEqual({
      flex: "none",
    });
  });

  test("the people and the share keep their colours, and nothing of a margin's own", () => {
    expect(drawn.people).toBe("text-gray-900");
    expect(drawn.share).toBe("text-gray-500");
    expect(
      declarationsForSelector(rules, ".text-gray-900")["color"],
    ).toBeDefined();
    expect(
      declarationsForSelector(rules, ".text-gray-500")["color"],
    ).toBeDefined();
  });
});
