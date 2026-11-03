import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A public dashboard reads no logs, traces, security events or external
 * data sources, and each widget of those says so where its data would be.
 * They said it two ways: the lists and the Data Source widgets an icon and
 * their sentence in the middle of the widget, the log and trace charts, the
 * trace table and the security events flow a line near the widget's top -
 * a card of empty space under it. Each now shows the same placeholder
 * (WidgetPlaceholder): its kind's icon and its sentence, in the middle of
 * its box, in words dark enough to read (text-gray-500). Inside OneUptime a
 * read that fails is still the error it was.
 *
 * Every read is stood in for; on a public dashboard none is made.
 */

const apiPostMock: MockFunction = getJestMockFunction();
const analyticsListMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factory runs. Dereferencing them lazily, at call time, is what makes
 * this work.
 */
jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return apiPostMock(...args);
      },
      getFriendlyErrorMessage: (err: Error) => {
        return err.message;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return analyticsListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

import DashboardLogChartComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardLogChartComponent";
import DashboardTraceChartComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTraceChartComponent";
import DashboardTraceTableComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTraceTableComponent";
import DashboardSecurityEventsFlowComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardSecurityEventsFlowComponent";
import DashboardSecurityEventsListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardSecurityEventsListComponent";
import DashboardDataSourceChartComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDataSourceChartComponent";
import { WIDGET_PLACEHOLDER_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/WidgetPlaceholder";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import {
  PublicDashboardContext,
  setPublicDashboardContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import DashboardLogChartComponentUtil from "../../../Utils/Dashboard/Components/DashboardLogChartComponent";
import DashboardTraceChartComponentUtil from "../../../Utils/Dashboard/Components/DashboardTraceChartComponent";
import DashboardTraceTableComponentUtil from "../../../Utils/Dashboard/Components/DashboardTraceTableComponent";
import DashboardSecurityEventsFlowComponentUtil from "../../../Utils/Dashboard/Components/DashboardSecurityEventsFlowComponent";
import DashboardSecurityEventsListComponentUtil from "../../../Utils/Dashboard/Components/DashboardSecurityEventsListComponent";
import DashboardDataSourceChartComponentUtil from "../../../Utils/Dashboard/Components/DashboardDataSourceChartComponent";

const COMPONENT_ID: ObjectID = new ObjectID(
  "5e5e5e5e-1111-4111-8111-5e5e5e5e5e5e",
);

// A CUSTOM range: the window never depends on the clock.
const BOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-11-03T10:00:00.000Z"),
    new Date("2026-11-03T11:00:00.000Z"),
  ),
};

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 60,
};

function buildBaseProps(): DashboardBaseComponentProps {
  return {
    componentId: COMPONENT_ID,
    isEditMode: false,
    isSelected: false,
    key: "placeholder-widget",
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
    dashboardId: "5e5e5e5e-2222-4222-8222-5e5e5e5e5e5e",
  };
}

interface WidgetUnderTest {
  name: string;
  // The sentence it says on a public dashboard.
  sentence: string;
  component: () => DashboardBaseComponent;
  element: (
    props: DashboardBaseComponentProps,
    component: DashboardBaseComponent,
  ) => React.ReactElement;
}

/*
 * The widgets in DashboardComponents' own types are cast: each element
 * takes its own kind of component, built here by its own utility.
 */
const WIDGETS: Array<WidgetUnderTest> = [
  {
    name: "Log Chart",
    sentence: "Log charts are not available on public dashboards.",
    component: (): DashboardBaseComponent => {
      return DashboardLogChartComponentUtil.getDefaultComponent();
    },
    element: (
      props: DashboardBaseComponentProps,
      component: DashboardBaseComponent,
    ): React.ReactElement => {
      return (
        <DashboardLogChartComponentElement
          {...props}
          component={component as never}
        />
      );
    },
  },
  {
    name: "Trace Chart",
    sentence: "Trace charts are not available on public dashboards.",
    component: (): DashboardBaseComponent => {
      return DashboardTraceChartComponentUtil.getDefaultComponent();
    },
    element: (
      props: DashboardBaseComponentProps,
      component: DashboardBaseComponent,
    ): React.ReactElement => {
      return (
        <DashboardTraceChartComponentElement
          {...props}
          component={component as never}
        />
      );
    },
  },
  {
    name: "Trace Table",
    sentence: "Trace tables are not available on public dashboards.",
    component: (): DashboardBaseComponent => {
      return DashboardTraceTableComponentUtil.getDefaultComponent();
    },
    element: (
      props: DashboardBaseComponentProps,
      component: DashboardBaseComponent,
    ): React.ReactElement => {
      return (
        <DashboardTraceTableComponentElement
          {...props}
          component={component as never}
        />
      );
    },
  },
  {
    name: "Security Events Flow",
    sentence: "Security event widgets are not available on public dashboards.",
    component: (): DashboardBaseComponent => {
      return DashboardSecurityEventsFlowComponentUtil.getDefaultComponent();
    },
    element: (
      props: DashboardBaseComponentProps,
      component: DashboardBaseComponent,
    ): React.ReactElement => {
      return (
        <DashboardSecurityEventsFlowComponentElement
          {...props}
          component={component as never}
        />
      );
    },
  },
  {
    name: "Security Events",
    sentence: "Security event widgets are not available on public dashboards.",
    component: (): DashboardBaseComponent => {
      return DashboardSecurityEventsListComponentUtil.getDefaultComponent();
    },
    element: (
      props: DashboardBaseComponentProps,
      component: DashboardBaseComponent,
    ): React.ReactElement => {
      return (
        <DashboardSecurityEventsListComponentElement
          {...props}
          component={component as never}
        />
      );
    },
  },
  {
    name: "Data Source Chart",
    sentence: "External data sources are not available on public dashboards.",
    component: (): DashboardBaseComponent => {
      return DashboardDataSourceChartComponentUtil.getDefaultComponent();
    },
    element: (
      props: DashboardBaseComponentProps,
      component: DashboardBaseComponent,
    ): React.ReactElement => {
      return (
        <DashboardDataSourceChartComponentElement
          {...props}
          component={component as never}
        />
      );
    },
  },
];

// Stands for the public board: the page registers this context on mount.
function enterPublicBoard(): void {
  setPublicDashboardContext({
    dashboardId: new ObjectID("5e5e5e5e-3333-4333-8333-5e5e5e5e5e5e"),
  } as unknown as PublicDashboardContext);
}

beforeEach(() => {
  apiPostMock.mockReset();
  analyticsListMock.mockReset();
});

afterEach(() => {
  cleanup();
  setPublicDashboardContext(null);
});

describe("on a public dashboard, every widget it cannot draw shows one placeholder", () => {
  for (const widget of WIDGETS) {
    test(`${widget.name}: its kind's icon and its sentence, in the middle of its box, with no read made`, async () => {
      enterPublicBoard();
      render(widget.element(buildBaseProps(), widget.component()));

      const sentence: HTMLElement = await screen.findByText(widget.sentence);
      const placeholder: HTMLElement = screen.getByTestId(
        WIDGET_PLACEHOLDER_TEST_ID,
      );

      expect(placeholder).toContainElement(sentence);
      // In the middle of the room it has, across and down.
      expect(placeholder).toHaveClass(
        "flex",
        "h-full",
        "w-full",
        "flex-col",
        "items-center",
        "justify-center",
      );
      // Words dark enough to read: 4.5:1 on the widget.
      expect(sentence).toHaveClass("text-xs", "text-gray-500", "text-center");
      expect(sentence).not.toHaveClass("text-gray-400");
      // An icon for what the widget would draw.
      expect(placeholder.querySelector("svg")).not.toBeNull();

      expect(apiPostMock).not.toHaveBeenCalled();
      expect(analyticsListMock).not.toHaveBeenCalled();
    });
  }

  test("the placeholders are one look: the same box and the same words, whatever the widget", async () => {
    const looks: Array<string> = [];

    for (const widget of WIDGETS) {
      enterPublicBoard();
      const view: ReturnType<typeof render> = render(
        widget.element(buildBaseProps(), widget.component()),
      );
      const sentence: HTMLElement = await screen.findByText(widget.sentence);
      const placeholder: HTMLElement = screen.getByTestId(
        WIDGET_PLACEHOLDER_TEST_ID,
      );

      looks.push(`${placeholder.className} | ${sentence.className}`);
      view.unmount();
    }

    expect(new Set(looks).size).toBe(1);
  });
});

describe("inside OneUptime, a read that fails is still an error", () => {
  /*
   * The log and trace charts, the trace table (API.post) and the security
   * events flow (AnalyticsModelAPI): a read refused says why, as the error
   * it is - the placeholder is a public dashboard's.
   */
  for (const name of [
    "Log Chart",
    "Trace Chart",
    "Trace Table",
    "Security Events Flow",
  ]) {
    test(`${name}: a read that fails says why, as an error, not as a placeholder`, async () => {
      apiPostMock.mockImplementation(() => {
        return Promise.reject(new Error("analytics unavailable"));
      });
      analyticsListMock.mockImplementation(() => {
        return Promise.reject(new Error("analytics unavailable"));
      });

      const widget: WidgetUnderTest = WIDGETS.find(
        (candidate: WidgetUnderTest): boolean => {
          return candidate.name === name;
        },
      )!;

      render(widget.element(buildBaseProps(), widget.component()));

      await waitFor(() => {
        expect(screen.getByText("analytics unavailable")).toBeInTheDocument();
      });
      expect(
        screen.queryByTestId(WIDGET_PLACEHOLDER_TEST_ID),
      ).not.toBeInTheDocument();
    });
  }
});
