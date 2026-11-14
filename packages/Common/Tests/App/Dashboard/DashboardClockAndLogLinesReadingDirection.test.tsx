import "@testing-library/jest-dom";
import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock } from "jest-mock";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import React from "react";
import { initReactI18next } from "react-i18next";
import DashboardClockComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardClockComponent";
import DashboardLogStreamComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardLogStreamComponent";
import DashboardResourceListBase, {
  RESOURCE_LIST_COUNT_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardResourceListBase";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardClockComponent from "../../../Types/Dashboard/DashboardComponents/DashboardClockComponent";
import DashboardLogStreamComponent from "../../../Types/Dashboard/DashboardComponents/DashboardLogStreamComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import { LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME } from "../../../UI/Utils/LineDirection";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

/*
 * A CLOCK'S CAPTION AND A LOG STREAM'S LINES, ON AN ARABIC OR PERSIAN
 * BOARD (#6858, #6927).
 *
 * Both cut a line where the widget ends (truncate), and on an Arabic or
 * Persian board a cut line ends at the left - where an English one
 * starts. A clock captioned "San Francisco office (Pacific)" read "...O
 * OFFICE (PACIFIC)", and a log stream's lines, which share their start
 * ("Connection to db-primary...", "Connection to db-replica..."), all lost
 * the start that tells them apart. Each line now reads the way its words
 * are written: an English one is cut at its own end and lined up on the
 * board's side; an Arabic one, and every line on a German or English
 * board, is drawn as it was.
 *
 * And a list's count, and a Log stream's, stay one line beside a title that
 * wraps: squeezed by a long title in a narrow widget, "3 sites" broke in
 * two.
 */

type ListRequest = { query: JSONObject; limit: number };
type ListResponse = { data: Array<JSONObject>; count: number };

const analyticsListMock: Mock<(request: ListRequest) => Promise<ListResponse>> =
  jest.fn<(request: ListRequest) => Promise<ListResponse>>();

// Lazy dereference: jest.mock factories are hoisted above these assignments.
jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (request: ListRequest) => {
        return analyticsListMock(request);
      },
    },
  };
});

const ENGLISH_CAPTION: string = "San Francisco office (Pacific)";
const ARABIC_CAPTION: string = "مكتب الرياض";
const ENGLISH_LINE: string =
  "Connection to db-primary.internal:5432 refused after 3 retries";
const ARABIC_LINE: string = "تمت معالجة الطلب بنجاح";

const COMPONENT_ID: ObjectID = new ObjectID(
  "c0000000-0000-4000-8000-0000000000f1",
);

const DASHBOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-11-10T10:00:00.000Z"),
    new Date("2026-11-10T11:00:00.000Z"),
  ),
};

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 60,
};

function baseProps(): DashboardBaseComponentProps {
  return {
    componentId: COMPONENT_ID,
    isEditMode: false,
    isSelected: false,
    key: "lined-widget",
    onComponentUpdate: (): void => {
      // The widgets never write back through this.
    },
    totalCurrentDashboardWidthInPx: 1280,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1280,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 240,
    dashboardComponentWidthInPx: 320,
    dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
    dashboardStartAndEndDate: DASHBOARD_RANGE,
    metricTypes: [],
    refreshTick: 0,
  };
}

// The one element that draws `text` and nothing else.
function lineOf(text: string): HTMLElement {
  return screen.getByText((_content: string, element: Element | null) => {
    return (
      element !== null &&
      element.children.length === 0 &&
      (element.textContent || "").trim() === text
    );
  });
}

function expectOneLineReadLeftToRight(element: Element | null): void {
  expect(element).toHaveAttribute("dir", "ltr");
  expect(element).toHaveClass("truncate", LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
}

function expectDrawnAsItWas(element: Element | null): void {
  expect(element).not.toHaveAttribute("dir");
  expect(element).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
  expect(element).toHaveClass("truncate");
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
  analyticsListMock.mockReset();
  await inLanguage("en");
});

afterEach(() => {
  cleanup();
});

describe("a Clock's caption", () => {
  function renderClock(label: string): void {
    const component: DashboardClockComponent = {
      _type: ObjectType.DashboardComponent,
      componentId: COMPONENT_ID,
      componentType: DashboardComponentType.Clock,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      widthInDashboardUnits: 3,
      heightInDashboardUnits: 3,
      minWidthInDashboardUnits: 2,
      minHeightInDashboardUnits: 2,
      arguments: {
        timezone: "America/Los_Angeles",
        label: label,
        showDate: true,
      },
    } as unknown as DashboardClockComponent;

    render(
      <DashboardClockComponentElement {...baseProps()} component={component} />,
    );
  }

  test.each(["ar", "fa"])(
    "on a %s board an English caption reads left to right, cut at its own end, and is whole on hover",
    async (language: string) => {
      await inLanguage(language);
      renderClock(ENGLISH_CAPTION);

      const caption: HTMLElement = lineOf(ENGLISH_CAPTION);

      expectOneLineReadLeftToRight(caption);
      expect(caption.getAttribute("title")).toContain(ENGLISH_CAPTION);
      expect(caption.getAttribute("title")).toContain("America/Los_Angeles");
    },
  );

  test("on an Arabic board an Arabic caption, and on German and English boards an English one, are drawn as they were", async () => {
    await inLanguage("ar");
    renderClock(ARABIC_CAPTION);
    expectDrawnAsItWas(lineOf(ARABIC_CAPTION));
    cleanup();

    for (const language of ["de", "en"]) {
      await inLanguage(language);
      renderClock(ENGLISH_CAPTION);

      const caption: HTMLElement = lineOf(ENGLISH_CAPTION);

      expectDrawnAsItWas(caption);
      expect(caption.tagName).toBe("SPAN");
      expect(caption.className).toBe(
        "text-[11px] font-medium text-gray-400 uppercase tracking-wider truncate",
      );
      cleanup();
    }
  });
});

describe("a Log stream's lines", () => {
  async function renderLogStream(): Promise<void> {
    analyticsListMock.mockResolvedValue({
      data: [
        {
          time: "2026-11-10T10:42:00.000Z",
          severityText: "Error",
          body: ENGLISH_LINE,
        },
        {
          time: "2026-11-10T10:41:00.000Z",
          severityText: "Info",
          body: ARABIC_LINE,
        },
      ],
      count: 2,
    });

    const component: DashboardLogStreamComponent = {
      _type: ObjectType.DashboardComponent,
      componentId: COMPONENT_ID,
      componentType: DashboardComponentType.LogStream,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 4,
      minWidthInDashboardUnits: 3,
      minHeightInDashboardUnits: 3,
      arguments: { title: "Checkout logs (EU West)", maxRows: 10 },
    } as unknown as DashboardLogStreamComponent;

    render(
      <DashboardLogStreamComponentElement
        {...baseProps()}
        component={component}
      />,
    );

    await screen.findByText(ENGLISH_LINE);
  }

  test.each(["ar", "fa"])(
    "on a %s board an English line reads left to right, cut at its own end; an Arabic one is drawn as it was",
    async (language: string) => {
      await inLanguage(language);
      await renderLogStream();

      const englishLine: HTMLElement = lineOf(ENGLISH_LINE);

      expectOneLineReadLeftToRight(englishLine);
      expect(englishLine).toHaveClass("flex-1", "font-mono");
      expectDrawnAsItWas(lineOf(ARABIC_LINE));
    },
  );

  test("on German and English boards an English line is drawn as it always was, at the size it always was", async () => {
    for (const language of ["de", "en"]) {
      await inLanguage(language);
      await renderLogStream();

      const line: HTMLElement = lineOf(ENGLISH_LINE);

      expectDrawnAsItWas(line);
      expect(line.tagName).toBe("SPAN");
      // 11px on the 16px line text-xs gave it, written as classes.
      expect(line).toHaveClass("text-[11px]", "leading-4", "flex-1");
      cleanup();
    }
  });

  test("its count stays one line, and keeps its room, beside its title", async () => {
    await inLanguage("en");
    await renderLogStream();

    const count: HTMLElement = screen.getByText("2 entries");

    expect(count).toHaveClass("whitespace-nowrap", "shrink-0");
    expect(count.parentElement).toHaveClass("justify-between", "gap-2");
  });
});

describe("a list's count beside its title", () => {
  test("stays one line, and keeps its room, beside a title that wraps", () => {
    render(
      <DashboardResourceListBase
        title="European sites and offices (all regions, live)"
        countLabel={{ one: "{{count}} site", other: "{{count}} sites" }}
        columns={[{ label: "Site", widthPct: "100%" }]}
        count={3}
        isLoading={false}
        error={null}
        isEmpty={true}
        emptyMessage="No sites yet"
        emptyIcon={IconProp.Globe}
      />,
    );

    const count: HTMLElement = screen.getByTestId(RESOURCE_LIST_COUNT_TEST_ID);

    expect(count).toHaveTextContent("3 sites");
    expect(count).toHaveClass("whitespace-nowrap", "shrink-0");
    // A gap between them when the title runs up to it.
    expect(count.parentElement).toHaveClass("justify-between", "gap-2");
  });
});
