/** @timezone UTC */
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
  RenderResult,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Monitor List widget's State Timeline view (issue #3503): one lane per
 * monitor, each lane a run of status-coloured bars across the dashboard's time
 * range.
 *
 * Two things are asserted here that nothing else can catch.
 *
 * The REQUESTS: the timeline is a second read, and it must only happen in the
 * mode that draws it (a list or honeycomb widget must not pay for status
 * history), it must be ONE query for all monitors rather than one per monitor,
 * and on a public dashboard it must go through the dashboard-scoped endpoint
 * rather than the private CRUD route whose 401 sends the viewer to
 * /accounts/login.
 *
 * The GEOMETRY: the bars are positioned in percentages, so a wrong percentage
 * is a wrong answer on a wall display rather than a crash. jsdom measures
 * every element as 0x0, which is exactly why the widget computes percentages
 * instead of pixels — and why they can be asserted here at all.
 */

const getListMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the compiled
 * requires, so the mock variables above are still unassigned when the factory
 * runs. Dereferencing them lazily, at call time, is what makes this work.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (...args: Array<any>) => {
        return getCurrentProjectIdMock(...args);
      },
    },
  };
});

import DashboardMonitorListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardMonitorListComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import {
  PublicDashboardContext,
  setPublicDashboardContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import GreaterThanOrNull from "../../../Types/BaseDatabase/GreaterThanOrNull";
import Includes from "../../../Types/BaseDatabase/Includes";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import LessThanOrEqual from "../../../Types/BaseDatabase/LessThanOrEqual";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { Green, Red } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardMonitorListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardMonitorListComponent";
import MonitorStateTimelineTooltipField from "../../../Types/Dashboard/MonitorStateTimelineTooltipField";
import PublicDashboardMonitorStateTimelinePolicy from "../../../Server/Utils/Dashboard/PublicDashboardMonitorStateTimelinePolicy";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

const COMPONENT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DASHBOARD_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const MONITOR_A_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const MONITOR_B_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const OPERATIONAL_STATUS_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

/*
 * A CUSTOM range pins the window to fixed instants; a relative range would
 * resolve against the wall clock and make every percentage in this file drift.
 * Four hours, so the fractions below are round numbers.
 */
const START_DATE: Date = new Date("2026-09-01T08:00:00.000Z");
const END_DATE: Date = new Date("2026-09-01T12:00:00.000Z");

const DASHBOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(START_DATE, END_DATE),
};

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 60,
};

/** Every postJSON call the public dashboard client received. */
interface PublicRequest {
  route: string;
  body: JSONObject;
}

let publicRequests: Array<PublicRequest> = [];

const PUBLIC_DASHBOARD_CONTEXT: PublicDashboardContext = {
  dashboardId: DASHBOARD_ID,
  apiUrl: {
    toString: (): string => {
      return "http://localhost/public-dashboard-api";
    },
  },
  postJSON: (route: string, body: JSONObject) => {
    publicRequests.push({ route, body });
    return Promise.resolve({
      data: { data: [] },
    } as unknown as HTTPResponse<JSONObject>);
  },
} as unknown as PublicDashboardContext;

type BuildMonitorFunction = (data: {
  id: ObjectID;
  name: string;
  statusName?: string | undefined;
  statusColor?: Color | undefined;
}) => Monitor;

const buildMonitor: BuildMonitorFunction = (data: {
  id: ObjectID;
  name: string;
  statusName?: string | undefined;
  statusColor?: Color | undefined;
}): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor.id = data.id;
  monitor.name = data.name;
  monitor.monitorType = MonitorType.Ping;

  const status: MonitorStatus = new MonitorStatus();
  status.name = data.statusName || "Operational";
  status.color = data.statusColor || Green;
  monitor.currentMonitorStatus = status;

  return monitor;
};

type BuildTimelineFunction = (data: {
  monitorId: ObjectID;
  statusId: ObjectID;
  statusName: string;
  color: Color;
  isOperationalState: boolean;
  priority: number;
  startsAt: string;
  endsAt?: string | undefined;
}) => MonitorStatusTimeline;

const buildTimeline: BuildTimelineFunction = (data: {
  monitorId: ObjectID;
  statusId: ObjectID;
  statusName: string;
  color: Color;
  isOperationalState: boolean;
  priority: number;
  startsAt: string;
  endsAt?: string | undefined;
}): MonitorStatusTimeline => {
  const status: MonitorStatus = new MonitorStatus();
  status.id = data.statusId;
  status.name = data.statusName;
  status.color = data.color;
  status.isOperationalState = data.isOperationalState;
  status.priority = data.priority;

  const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
  timeline.monitorId = data.monitorId;
  timeline.monitorStatusId = data.statusId;
  timeline.monitorStatus = status;
  timeline.startsAt = new Date(data.startsAt);
  if (data.endsAt) {
    timeline.endsAt = new Date(data.endsAt);
  }

  return timeline;
};

type OperationalFunction = (
  monitorId: ObjectID,
  startsAt: string,
  endsAt?: string | undefined,
) => MonitorStatusTimeline;

const operational: OperationalFunction = (
  monitorId: ObjectID,
  startsAt: string,
  endsAt?: string | undefined,
): MonitorStatusTimeline => {
  return buildTimeline({
    monitorId,
    statusId: OPERATIONAL_STATUS_ID,
    statusName: "Operational",
    color: Green,
    isOperationalState: true,
    priority: 1,
    startsAt,
    endsAt,
  });
};

const offline: OperationalFunction = (
  monitorId: ObjectID,
  startsAt: string,
  endsAt?: string | undefined,
): MonitorStatusTimeline => {
  return buildTimeline({
    monitorId,
    statusId: OFFLINE_STATUS_ID,
    statusName: "Offline",
    color: Red,
    isOperationalState: false,
    priority: 3,
    startsAt,
    endsAt,
  });
};

/*
 * The widget makes up to two list calls. They are told apart by modelType, not
 * by call order, so a future reordering does not silently retarget the stubs.
 */
type ListArgs = { modelType: unknown; query: JSONObject; sort: JSONObject };

let monitorsResponse: Array<Monitor> = [];
let timelinesResponse: Array<MonitorStatusTimeline> = [];

type CallsForFunction = (modelType: { new (): unknown }) => Array<ListArgs>;

const callsFor: CallsForFunction = (modelType: {
  new (): unknown;
}): Array<ListArgs> => {
  return (getListMock.mock.calls as Array<Array<ListArgs>>)
    .map((call: Array<ListArgs>): ListArgs => {
      return call[0] as ListArgs;
    })
    .filter((args: ListArgs) => {
      return args.modelType === modelType;
    });
};

type BuildPropsFunction = (
  overrides?: Partial<DashboardBaseComponentProps>,
) => DashboardBaseComponentProps;

const buildBaseProps: BuildPropsFunction = (
  overrides: Partial<DashboardBaseComponentProps> = {},
): DashboardBaseComponentProps => {
  return {
    componentId: COMPONENT_ID,
    isEditMode: false,
    isSelected: false,
    key: "monitor-list-widget",
    onComponentUpdate: (): void => {
      // The widget never writes back through this.
    },
    totalCurrentDashboardWidthInPx: 1200,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1200,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 320,
    dashboardComponentWidthInPx: 480,
    dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
    dashboardStartAndEndDate: DASHBOARD_RANGE,
    metricTypes: [],
    refreshTick: 0,
    variables: undefined,
    ...overrides,
  };
};

type RenderWidgetFunction = (
  args?: DashboardMonitorListComponent["arguments"] | undefined,
) => RenderResult;

const renderWidget: RenderWidgetFunction = (
  args?: DashboardMonitorListComponent["arguments"] | undefined,
): RenderResult => {
  const component: DashboardMonitorListComponent = {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.MonitorList,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 4,
    minWidthInDashboardUnits: 6,
    minHeightInDashboardUnits: 3,
    arguments: args || { viewMode: "timeline" },
  } as unknown as DashboardMonitorListComponent;

  /*
   * The list view links each monitor with AppLink, which needs a router in
   * context. The timeline view does not, but the widget builds both trees, so
   * every render goes through the router.
   */
  return render(
    <MemoryRouter>
      <DashboardMonitorListComponentElement
        {...buildBaseProps()}
        component={component}
      />
    </MemoryRouter>,
  );
};

type SegmentStyleFunction = () => Array<{ left: string; width: string }>;

const segmentStyles: SegmentStyleFunction = (): Array<{
  left: string;
  width: string;
}> => {
  return screen
    .queryAllByTestId("state-timeline-segment")
    .map((element: HTMLElement): { left: string; width: string } => {
      return {
        left: element.style.left,
        width: element.style.width,
      };
    });
};

beforeEach((): void => {
  jest.clearAllMocks();
  publicRequests = [];
  monitorsResponse = [
    buildMonitor({ id: MONITOR_A_ID, name: "core-switch-01" }),
    buildMonitor({
      id: MONITOR_B_ID,
      name: "ap-lobby-02",
      statusName: "Offline",
      statusColor: Red,
    }),
  ];
  timelinesResponse = [];
  getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);

  getListMock.mockImplementation((...args: Array<any>) => {
    const request: ListArgs = args[0] as ListArgs;

    if (request.modelType === MonitorStatusTimeline) {
      return Promise.resolve({
        data: timelinesResponse,
        count: timelinesResponse.length,
      });
    }

    return Promise.resolve({
      data: monitorsResponse,
      count: monitorsResponse.length,
    });
  });
});

afterEach((): void => {
  cleanup();
  setPublicDashboardContext(null);
});

describe("Monitor List widget — State Timeline", () => {
  describe("when to read status history at all", () => {
    test("does not read status history in the default list view", async (): Promise<void> => {
      renderWidget({});

      await screen.findByText("core-switch-01");

      /*
       * The list view renders only the CURRENT status, which the monitor row
       * already carries. A second read here would double every list widget's
       * cost for data it never draws.
       */
      expect(callsFor(MonitorStatusTimeline)).toHaveLength(0);
    });

    test("does not read status history in honeycomb view", async (): Promise<void> => {
      renderWidget({ viewMode: "honeycomb" });

      await waitFor((): void => {
        expect(callsFor(Monitor).length).toBeGreaterThan(0);
      });

      expect(callsFor(MonitorStatusTimeline)).toHaveLength(0);
    });

    test("reads status history once for every monitor in timeline view", async (): Promise<void> => {
      renderWidget({ viewMode: "timeline" });

      await waitFor((): void => {
        expect(callsFor(MonitorStatusTimeline)).toHaveLength(1);
      });

      /*
       * One IN query, not one request per monitor: a widget showing 25
       * devices on a wall display would otherwise blow the public
       * dashboard's per-IP rate limit on its own.
       */
      const query: JSONObject = callsFor(MonitorStatusTimeline)[0]!.query;
      const monitorId: Includes = query["monitorId"] as unknown as Includes;

      expect(monitorId).toBeInstanceOf(Includes);
      expect(
        monitorId.values.map((value: unknown) => {
          return String(value);
        }),
      ).toEqual([MONITOR_A_ID.toString(), MONITOR_B_ID.toString()]);
    });

    test("asks for every row overlapping the window, not just rows inside it", async (): Promise<void> => {
      renderWidget({ viewMode: "timeline" });

      await waitFor((): void => {
        expect(callsFor(MonitorStatusTimeline)).toHaveLength(1);
      });

      const call: ListArgs = callsFor(MonitorStatusTimeline)[0]!;

      /*
       * A device that went Offline yesterday has exactly ONE row and it
       * starts before the window. Querying `startsAt BETWEEN` would render an
       * empty lane for the device that has been down the whole time.
       */
      expect(call.query["startsAt"]).toBeInstanceOf(LessThanOrEqual);
      expect(
        (call.query["startsAt"] as unknown as LessThanOrEqual<Date>).value,
      ).toEqual(END_DATE);
      expect(call.query["endsAt"]).toBeInstanceOf(GreaterThanOrNull);
      expect(
        (call.query["endsAt"] as unknown as GreaterThanOrNull<Date>).value,
      ).toEqual(START_DATE);
    });

    test("orders history by startsAt, the clock the timeline math uses", async (): Promise<void> => {
      renderWidget({ viewMode: "timeline" });

      await waitFor((): void => {
        expect(callsFor(MonitorStatusTimeline)).toHaveLength(1);
      });

      /*
       * startsAt and createdAt are different clocks (DB now() vs worker
       * moment()) with real skew; sorting by createdAt can put segments out
       * of order and make the last one — the "current status" — wrong.
       */
      expect(callsFor(MonitorStatusTimeline)[0]!.sort).toEqual({
        startsAt: SortOrder.Ascending,
      });
    });

    test("scopes the history read to the current project", async (): Promise<void> => {
      renderWidget({ viewMode: "timeline" });

      await waitFor((): void => {
        expect(callsFor(MonitorStatusTimeline)).toHaveLength(1);
      });

      expect(callsFor(MonitorStatusTimeline)[0]!.query["projectId"]).toEqual(
        PROJECT_ID,
      );
    });
  });

  describe("lane geometry", () => {
    test("draws one lane per monitor, labelled with its name", async (): Promise<void> => {
      renderWidget({ viewMode: "timeline" });

      await waitFor((): void => {
        expect(screen.queryAllByTestId("state-timeline-row")).toHaveLength(2);
      });

      expect(screen.getByText("core-switch-01")).toBeInTheDocument();
      expect(screen.getByText("ap-lobby-02")).toBeInTheDocument();
    });

    test("positions each bar by its share of the visible window", async (): Promise<void> => {
      monitorsResponse = [
        buildMonitor({ id: MONITOR_A_ID, name: "core-switch-01" }),
      ];
      timelinesResponse = [
        operational(
          MONITOR_A_ID,
          "2026-09-01T08:00:00.000Z",
          "2026-09-01T10:00:00.000Z",
        ),
        offline(
          MONITOR_A_ID,
          "2026-09-01T10:00:00.000Z",
          "2026-09-01T11:00:00.000Z",
        ),
        operational(MONITOR_A_ID, "2026-09-01T11:00:00.000Z"),
      ];

      renderWidget({ viewMode: "timeline" });

      await waitFor((): void => {
        expect(segmentStyles()).toHaveLength(3);
      });

      // 2h operational, 1h offline, 1h operational, in a 4h window.
      expect(segmentStyles()).toEqual([
        { left: "0%", width: "50%" },
        { left: "50%", width: "25%" },
        { left: "75%", width: "25%" },
      ]);
    });

    test("fills the lane for a monitor that was down before the window opened", async (): Promise<void> => {
      monitorsResponse = [
        buildMonitor({
          id: MONITOR_A_ID,
          name: "core-switch-01",
          statusName: "Offline",
          statusColor: Red,
        }),
      ];
      timelinesResponse = [offline(MONITOR_A_ID, "2026-08-30T00:00:00.000Z")];

      renderWidget({ viewMode: "timeline" });

      await waitFor((): void => {
        expect(segmentStyles()).toHaveLength(1);
      });

      expect(segmentStyles()[0]).toEqual({ left: "0%", width: "100%" });
    });

    test("paints each bar with the status's configured colour", async (): Promise<void> => {
      monitorsResponse = [
        buildMonitor({ id: MONITOR_A_ID, name: "core-switch-01" }),
      ];
      timelinesResponse = [
        operational(
          MONITOR_A_ID,
          "2026-09-01T08:00:00.000Z",
          "2026-09-01T10:00:00.000Z",
        ),
        offline(MONITOR_A_ID, "2026-09-01T10:00:00.000Z"),
      ];

      renderWidget({ viewMode: "timeline" });

      await waitFor((): void => {
        expect(screen.queryAllByTestId("state-timeline-segment")).toHaveLength(
          2,
        );
      });

      /*
       * Monitor status colours are a per-project setting (Monitors →
       * Settings → Monitor Status). A literal palette here would silently
       * override whatever the operator configured.
       */
      const colors: Array<string> = screen
        .getAllByTestId("state-timeline-segment")
        .map((element: HTMLElement): string => {
          return element.style.backgroundColor;
        });

      expect(colors[0]).toBe("rgb(42, 181, 125)");
      expect(colors[1]).toBe("rgb(253, 98, 94)");
    });

    test("says so, rather than drawing nothing, when a monitor has no history", async (): Promise<void> => {
      monitorsResponse = [
        buildMonitor({ id: MONITOR_A_ID, name: "core-switch-01" }),
      ];
      timelinesResponse = [];

      renderWidget({ viewMode: "timeline" });

      expect(
        await screen.findByTestId("state-timeline-no-data"),
      ).toHaveTextContent("No status history");
      expect(
        screen.queryAllByTestId("state-timeline-trailing-label"),
      ).toHaveLength(0);
    });

    test("shows the uptime for the visible range beside the lane", async (): Promise<void> => {
      monitorsResponse = [
        buildMonitor({ id: MONITOR_A_ID, name: "core-switch-01" }),
      ];
      timelinesResponse = [
        operational(
          MONITOR_A_ID,
          "2026-09-01T06:00:00.000Z",
          "2026-09-01T11:00:00.000Z",
        ),
        offline(MONITOR_A_ID, "2026-09-01T11:00:00.000Z"),
      ];

      renderWidget({ viewMode: "timeline" });

      // 1 hour offline out of the 4 hour window.
      expect(
        await screen.findByTestId("state-timeline-trailing-label"),
      ).toHaveTextContent("75%");
    });

    test("reserves the same trailing column on every lane, even the empty ones", async (): Promise<void> => {
      /*
       * Only monitor A has history, so only monitor A has an uptime figure.
       * If the trailing slot were rendered per-lane, B's track would be wider
       * than A's and the bars would stop lining up down the column — which is
       * the entire point of stacking them.
       */
      timelinesResponse = [operational(MONITOR_A_ID, "2026-09-01T08:00:00.000Z")];

      renderWidget({ viewMode: "timeline" });

      await waitFor((): void => {
        expect(screen.queryAllByTestId("state-timeline-row")).toHaveLength(2);
      });

      const trailing: Array<HTMLElement> = screen.getAllByTestId(
        "state-timeline-trailing-label",
      );

      expect(trailing).toHaveLength(2);
      expect(trailing[0]).toHaveTextContent("100%");
      expect(trailing[1]?.textContent).toBe("");
    });

    test("summarises the lane for a screen reader", async (): Promise<void> => {
      monitorsResponse = [
        buildMonitor({ id: MONITOR_A_ID, name: "core-switch-01" }),
      ];
      timelinesResponse = [offline(MONITOR_A_ID, "2026-09-01T08:00:00.000Z")];

      renderWidget({ viewMode: "timeline" });

      /*
       * The bars themselves are aria-hidden — a screen reader reading out
       * fifty coloured divs is noise — so the lane carries the summary.
       */
      const lane: HTMLElement = await screen.findByTestId(
        "state-timeline-lane",
      );
      expect(lane).toHaveAttribute(
        "aria-label",
        "core-switch-01: currently Offline, 0% uptime in this time range.",
      );
    });

    test("labels the axis at both edges of the window", async (): Promise<void> => {
      renderWidget({ viewMode: "timeline" });

      await waitFor((): void => {
        expect(
          screen.queryAllByTestId("state-timeline-axis-tick").length,
        ).toBeGreaterThan(1);
      });

      const ticks: Array<HTMLElement> = screen.getAllByTestId(
        "state-timeline-axis-tick",
      );

      expect(ticks[0]).toHaveTextContent("08:00");
      expect(ticks[ticks.length - 1]).toHaveTextContent("12:00");
    });

    test("explains only the statuses actually drawn", async (): Promise<void> => {
      monitorsResponse = [
        buildMonitor({ id: MONITOR_A_ID, name: "core-switch-01" }),
      ];
      timelinesResponse = [
        operational(
          MONITOR_A_ID,
          "2026-09-01T08:00:00.000Z",
          "2026-09-01T10:00:00.000Z",
        ),
        offline(MONITOR_A_ID, "2026-09-01T10:00:00.000Z"),
      ];

      renderWidget({ viewMode: "timeline" });

      await waitFor((): void => {
        expect(
          screen.queryAllByTestId("state-timeline-legend-item"),
        ).toHaveLength(2);
      });

      expect(
        screen
          .getAllByTestId("state-timeline-legend-item")
          .map((element: HTMLElement): string | null => {
            return element.textContent;
          }),
      ).toEqual(["Operational", "Offline"]);
    });
  });

  describe("the hover card", () => {
    beforeEach((): void => {
      monitorsResponse = [
        buildMonitor({ id: MONITOR_A_ID, name: "core-switch-01" }),
      ];
      timelinesResponse = [
        operational(
          MONITOR_A_ID,
          "2026-09-01T08:00:00.000Z",
          "2026-09-01T10:00:00.000Z",
        ),
        offline(MONITOR_A_ID, "2026-09-01T10:00:00.000Z"),
      ];
    });

    test("shows nothing until a bar is hovered", async (): Promise<void> => {
      renderWidget({ viewMode: "timeline" });

      await waitFor((): void => {
        expect(screen.queryAllByTestId("state-timeline-segment")).toHaveLength(
          2,
        );
      });

      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });

    test("names the monitor and the default rows when a bar is hovered", async (): Promise<void> => {
      renderWidget({ viewMode: "timeline" });

      await waitFor((): void => {
        expect(screen.queryAllByTestId("state-timeline-segment")).toHaveLength(
          2,
        );
      });

      fireEvent.mouseEnter(
        screen.getAllByTestId("state-timeline-segment")[1] as HTMLElement,
      );

      const tooltip: HTMLElement = await screen.findByRole("tooltip");

      expect(tooltip).toHaveTextContent("core-switch-01");
      expect(tooltip).toHaveTextContent("Status");
      expect(tooltip).toHaveTextContent("Offline");
      expect(tooltip).toHaveTextContent("Started");
      expect(tooltip).toHaveTextContent("Ended");
      expect(tooltip).toHaveTextContent("Duration");
      expect(tooltip).toHaveTextContent("2 hours");

      // Not in the default set.
      expect(tooltip).not.toHaveTextContent("Uptime in range");
    });

    test("shows exactly the rows the widget was configured with", async (): Promise<void> => {
      renderWidget({
        viewMode: "timeline",
        timelineTooltipFields: [
          MonitorStateTimelineTooltipField.UptimePercent,
          MonitorStateTimelineTooltipField.MonitorType,
        ],
      });

      await waitFor((): void => {
        expect(screen.queryAllByTestId("state-timeline-segment")).toHaveLength(
          2,
        );
      });

      fireEvent.mouseEnter(
        screen.getAllByTestId("state-timeline-segment")[1] as HTMLElement,
      );

      const tooltip: HTMLElement = await screen.findByRole("tooltip");

      expect(tooltip).toHaveTextContent("Uptime in range");
      expect(tooltip).toHaveTextContent("50%");
      expect(tooltip).toHaveTextContent("Monitor type");
      expect(tooltip).toHaveTextContent(MonitorType.Ping);
      expect(tooltip).not.toHaveTextContent("Duration");
    });

    test("honours an explicitly emptied selection instead of restoring defaults", async (): Promise<void> => {
      /*
       * Clearing the field is a choice. Falling back to the defaults here
       * would make the control look broken — clear it, save, and every row
       * comes straight back.
       */
      renderWidget({ viewMode: "timeline", timelineTooltipFields: [] });

      await waitFor((): void => {
        expect(screen.queryAllByTestId("state-timeline-segment")).toHaveLength(
          2,
        );
      });

      fireEvent.mouseEnter(
        screen.getAllByTestId("state-timeline-segment")[0] as HTMLElement,
      );

      const tooltip: HTMLElement = await screen.findByRole("tooltip");

      expect(tooltip).toHaveTextContent("core-switch-01");
      expect(tooltip).not.toHaveTextContent("Duration");
      expect(tooltip).not.toHaveTextContent("Started");
    });

    test("disappears when the pointer leaves the bar", async (): Promise<void> => {
      renderWidget({ viewMode: "timeline" });

      await waitFor((): void => {
        expect(screen.queryAllByTestId("state-timeline-segment")).toHaveLength(
          2,
        );
      });

      const segment: HTMLElement = screen.getAllByTestId(
        "state-timeline-segment",
      )[0] as HTMLElement;

      fireEvent.mouseEnter(segment);
      expect(await screen.findByRole("tooltip")).toBeInTheDocument();

      fireEvent.mouseLeave(segment);
      await waitFor((): void => {
        expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
      });
    });
  });

  describe("on a public dashboard", () => {
    beforeEach((): void => {
      setPublicDashboardContext(PUBLIC_DASHBOARD_CONTEXT);
    });

    test("reads status history through the dashboard-scoped endpoint", async (): Promise<void> => {
      renderWidget({ viewMode: "timeline" });

      await waitFor((): void => {
        expect(publicRequests).toHaveLength(1);
      });

      /*
       * Never the private CRUD route: its 401 redirects an anonymous viewer
       * to /accounts/login instead of showing the dashboard they were sent.
       */
      expect(publicRequests[0]!.route).toBe(
        `/monitor-status-timeline/${DASHBOARD_ID.toString()}`,
      );
      expect(callsFor(MonitorStatusTimeline)).toHaveLength(0);
    });

    test("sends the component id and the window, and no monitor ids", async (): Promise<void> => {
      renderWidget({ viewMode: "timeline" });

      await waitFor((): void => {
        expect(publicRequests).toHaveLength(1);
      });

      const body: JSONObject = publicRequests[0]!.body;

      /*
       * The monitor set is a SELECTOR, and the public route re-derives it
       * from the stored widget precisely so an anonymous caller never gets to
       * choose it. Sending ids from here would hand that back.
       */
      expect(body["componentId"]).toBe(COMPONENT_ID.toString());
      expect(body["monitorIds"]).toBeUndefined();

      const window: JSONObject = body["startAndEndDate"] as JSONObject;
      expect(window["_type"]).toBe(ObjectType.InBetween);
      expect(new Date(window["startValue"] as string)).toEqual(START_DATE);
      expect(new Date(window["endValue"] as string)).toEqual(END_DATE);
    });

    test("sends a window the server-side policy actually accepts", async (): Promise<void> => {
      /*
       * The one assertion that spans the wire. The body is round-tripped
       * through JSON first, because that is what an HTTP request does to it,
       * and then handed to the real policy the public route runs.
       *
       * This is not hypothetical: wrapping the window in
       * JSONFunctions.serialize (as the other public widget bodies do) encodes
       * each bound as {_type: "DateTime", value}, InBetween.fromJSON copies
       * those objects across verbatim, and the route rejects every request
       * with "range contains an invalid date". Nothing on either side of the
       * wire catches that alone.
       */
      renderWidget({ viewMode: "timeline" });

      await waitFor((): void => {
        expect(publicRequests).toHaveLength(1);
      });

      const overTheWire: JSONObject = JSON.parse(
        JSON.stringify(publicRequests[0]!.body),
      ) as JSONObject;

      const window: InBetween<Date> =
        PublicDashboardMonitorStateTimelinePolicy.resolveWindowFromBody(
          overTheWire,
        );

      expect(window.startValue).toEqual(START_DATE);
      expect(window.endValue).toEqual(END_DATE);
    });

    test("still renders lanes when the public endpoint returns no history", async (): Promise<void> => {
      renderWidget({ viewMode: "timeline" });

      await waitFor((): void => {
        expect(screen.queryAllByTestId("state-timeline-row")).toHaveLength(2);
      });

      expect(screen.queryAllByTestId("state-timeline-no-data")).toHaveLength(2);
    });
  });

  describe("the other view modes still work", () => {
    test("renders the table rows in list view", async (): Promise<void> => {
      renderWidget({});

      expect(await screen.findByText("core-switch-01")).toBeInTheDocument();
      expect(screen.queryAllByTestId("state-timeline-row")).toHaveLength(0);
    });

    test("treats an unknown stored viewMode as the list view", async (): Promise<void> => {
      /*
       * A dashboard saved by a newer version could name a mode this build
       * does not have; falling through to the list is the one mode that
       * always has something to draw.
       */
      renderWidget({ viewMode: "heatmap" as "list" });

      expect(await screen.findByText("core-switch-01")).toBeInTheDocument();
      expect(callsFor(MonitorStatusTimeline)).toHaveLength(0);
    });
  });
});
