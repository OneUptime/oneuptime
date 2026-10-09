import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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
import React, { ReactElement } from "react";
import { SpyInstance } from "jest-mock";

/*
 * The dashboard canvas, rendered for real, holding widgets that cannot be
 * drawn (issue #4571). The canvas is shared by the dashboard and the public
 * dashboard, so what is pinned here holds on both:
 *
 * - the canvas never reads its widget list off a config that has none (the
 *   line that threw "Cannot read properties of undefined (reading
 *   'length')"), whoever hands it the config;
 * - a widget that throws is replaced in its own place, and its boundary
 *   starts over on the next refresh, a new time range, or a change to the
 *   widget - so a failure that came from one answer clears with the next;
 * - Edit widget is offered only when the canvas was handed the way to it,
 *   and names the widget it was offered on.
 */

jest.setTimeout(120000);

let clockThrows: boolean = false;
let clockRenders: number = 0;

// The Clock widget, made to throw while it draws when the test says so.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardClockComponent",
  () => {
    const reactModule: typeof React = jest.requireActual(
      "react",
    ) as typeof React;

    return {
      __esModule: true,
      default: () => {
        clockRenders++;

        if (clockThrows) {
          throw new Error("Clock exploded");
        }

        return reactModule.createElement(
          "div",
          { "data-testid": "clock-widget" },
          "Clock drawn",
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ArgumentsForm",
  () => {
    const reactModule: typeof React = jest.requireActual(
      "react",
    ) as typeof React;

    return {
      __esModule: true,
      default: () => {
        return reactModule.createElement("div", {
          "data-testid": "arguments-form-stub",
        });
      },
    };
  },
);

import DashboardCanvas, {
  getCanvasComponents,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/Index";
import {
  COMPACT_WIDGET_FALLBACK_HEIGHT_IN_PX,
  DASHBOARD_WIDGET_FALLBACK_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetFallback";
import DashboardBaseComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import StoredDashboardViewConfig from "../../../Utils/Dashboard/StoredDashboardViewConfig";

const CLOCK_ID: string = "550e8400-e29b-41d4-a716-446655440001";
const UNKNOWN_ID: string = "550e8400-e29b-41d4-a716-446655440002";

function widget(
  id: string,
  componentType: string,
  left: number,
  widgetArguments: Record<string, unknown> = {},
): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: new ObjectID(id),
    componentType: componentType as DashboardComponentType,
    topInDashboardUnits: 0,
    leftInDashboardUnits: left,
    widthInDashboardUnits: 4,
    heightInDashboardUnits: 3,
    minWidthInDashboardUnits: 1,
    minHeightInDashboardUnits: 1,
    arguments: widgetArguments,
  };
}

function board(components: Array<DashboardBaseComponent>): DashboardViewConfig {
  return {
    _type: ObjectType.DashboardViewConfig,
    heightInDashboardUnits: 12,
    components: components,
  };
}

const PAST_HOUR: RangeStartAndEndDateTime = { range: TimeRange.PAST_ONE_HOUR };

interface CanvasOptions {
  config: DashboardViewConfig;
  refreshTick?: number;
  range?: RangeStartAndEndDateTime;
  isEditMode?: boolean;
  selectedComponentId?: ObjectID | null;
  onEditWidgetClick?: ((componentId: ObjectID) => void) | undefined;
}

function canvas(options: CanvasOptions): ReactElement {
  return (
    <DashboardCanvas
      dashboardViewConfig={options.config}
      onDashboardViewConfigChange={() => {}}
      isEditMode={Boolean(options.isEditMode)}
      currentTotalDashboardWidthInPx={1200}
      onComponentSelected={() => {}}
      onComponentUnselected={() => {}}
      selectedComponentId={options.selectedComponentId || null}
      metrics={{ metricTypes: [], telemetryAttributes: [] }}
      dashboardStartAndEndDate={options.range || PAST_HOUR}
      refreshTick={options.refreshTick ?? 0}
      onEditWidgetClick={options.onEditWidgetClick}
    />
  );
}

function fallbacks(): Array<HTMLElement> {
  return screen.queryAllByTestId(DASHBOARD_WIDGET_FALLBACK_TEST_ID);
}

class FakeResizeObserver {
  private callback: ResizeObserverCallback;

  public constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  public observe(): void {
    this.callback(
      [{ contentRect: { width: 800 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }

  public unobserve(): void {
    // Nothing to stop observing.
  }

  public disconnect(): void {
    // Nothing to disconnect.
  }
}

const ORIGINAL_RESIZE_OBSERVER: unknown = (
  globalThis as unknown as { ResizeObserver: unknown }
).ResizeObserver;

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    FakeResizeObserver;
});

afterAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    ORIGINAL_RESIZE_OBSERVER;
});

let consoleErrorSpy: SpyInstance<typeof console.error>;

beforeEach(() => {
  clockThrows = false;
  clockRenders = 0;
  consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  consoleErrorSpy.mockRestore();
});

describe("the canvas never reads a widget list off a config that has none", () => {
  test.each([
    ["no components key", { _type: ObjectType.DashboardViewConfig }],
    ["components null", { components: null }],
    ["components an object", { components: {} }],
    ["components text", { components: "x" }],
  ])(
    "a config with %s draws the empty board instead of throwing",
    (_name: string, config: unknown) => {
      render(canvas({ config: config as DashboardViewConfig }));

      expect(screen.getByTestId("dashboard-blank-canvas")).toBeInTheDocument();
    },
  );

  test("getCanvasComponents hands back the list, or one stable empty list", () => {
    const list: Array<DashboardBaseComponent> = [
      widget(CLOCK_ID, DashboardComponentType.Clock, 0),
    ];

    expect(getCanvasComponents(board(list))).toBe(list);

    const empty: Array<DashboardBaseComponent> = getCanvasComponents(undefined);
    expect(empty).toEqual([]);
    // The same list every time, so memos keyed on it do not recompute.
    expect(getCanvasComponents(null)).toBe(empty);
    expect(
      getCanvasComponents({
        components: "x",
      } as unknown as DashboardViewConfig),
    ).toBe(empty);
  });
});

describe("a widget that throws", () => {
  const CONFIG: DashboardViewConfig = board([
    widget(CLOCK_ID, DashboardComponentType.Clock, 0),
  ]);

  test("is replaced in its own place", () => {
    clockThrows = true;

    render(canvas({ config: CONFIG }));

    const [fallback] = fallbacks();
    expect(fallback).toHaveAttribute("data-problem", "Crashed");
    expect(
      fallback!.closest(`#dashboard-component-${CLOCK_ID}`),
    ).not.toBeNull();
  });

  test("starts over on the next refresh", () => {
    clockThrows = true;
    const { rerender } = render(canvas({ config: CONFIG, refreshTick: 1 }));
    expect(fallbacks()).toHaveLength(1);

    clockThrows = false;

    // The same tick leaves it as it is...
    rerender(canvas({ config: CONFIG, refreshTick: 1 }));
    expect(fallbacks()).toHaveLength(1);

    // ...the next one draws it again.
    rerender(canvas({ config: CONFIG, refreshTick: 2 }));
    expect(fallbacks()).toHaveLength(0);
    expect(screen.getByTestId("clock-widget")).toBeInTheDocument();
  });

  test("starts over on a new time range", () => {
    clockThrows = true;
    const { rerender } = render(canvas({ config: CONFIG, range: PAST_HOUR }));
    expect(fallbacks()).toHaveLength(1);

    clockThrows = false;
    rerender(
      canvas({ config: CONFIG, range: { range: TimeRange.PAST_ONE_DAY } }),
    );

    expect(screen.getByTestId("clock-widget")).toBeInTheDocument();
  });

  test("starts over when the widget is changed", () => {
    clockThrows = true;
    const { rerender } = render(canvas({ config: CONFIG }));
    expect(fallbacks()).toHaveLength(1);

    clockThrows = false;
    rerender(
      canvas({
        config: board([
          widget(CLOCK_ID, DashboardComponentType.Clock, 0, {
            timezone: "UTC",
          }),
        ]),
      }),
    );

    expect(screen.getByTestId("clock-widget")).toBeInTheDocument();
  });

  test("a widget that keeps throwing is not drawn over and over by unrelated renders", () => {
    clockThrows = true;
    const { rerender } = render(canvas({ config: CONFIG }));
    const rendersAfterFirstFailure: number = clockRenders;

    rerender(canvas({ config: CONFIG }));
    rerender(canvas({ config: CONFIG }));

    expect(clockRenders).toBe(rendersAfterFirstFailure);
    expect(fallbacks()).toHaveLength(1);
  });
});

describe("the note on a short widget", () => {
  const CONFIG: DashboardViewConfig = StoredDashboardViewConfig.read({
    components: [{ componentId: UNKNOWN_ID, componentType: "HostMetricChart" }],
  });

  function card(heightInPx: number): ReactElement {
    return (
      <DashboardBaseComponentElement
        componentId={new ObjectID(UNKNOWN_ID)}
        isEditMode={false}
        isSelected={false}
        key="card"
        onComponentUpdate={() => {}}
        totalCurrentDashboardWidthInPx={1200}
        dashboardCanvasTopInPx={0}
        dashboardCanvasLeftInPx={0}
        dashboardCanvasWidthInPx={1200}
        dashboardCanvasHeightInPx={800}
        dashboardComponentWidthInPx={300}
        dashboardComponentHeightInPx={heightInPx}
        dashboardViewConfig={CONFIG}
        dashboardStartAndEndDate={PAST_HOUR}
        metricTypes={[]}
        onClick={() => {}}
        dndActiveMode={null}
        isAnyGestureActive={false}
        onMovePointerDown={() => {}}
        onResizePointerDown={() => {}}
      />
    );
  }

  test.each([
    [120, false],
    [190, false],
    [COMPACT_WIDGET_FALLBACK_HEIGHT_IN_PX - 1, false],
    [COMPACT_WIDGET_FALLBACK_HEIGHT_IN_PX, true],
    [400, true],
  ])(
    "a widget %ipx tall shows the icon: %p",
    (heightInPx: number, showsIcon: boolean) => {
      render(card(heightInPx));

      expect(fallbacks()).toHaveLength(1);
      expect(
        Boolean(screen.queryByTestId("dashboard-widget-fallback-icon")),
      ).toBe(showsIcon);
    },
  );
});

describe("Edit widget, from the canvas", () => {
  const CONFIG: DashboardViewConfig = StoredDashboardViewConfig.read({
    components: [
      {
        componentId: UNKNOWN_ID,
        componentType: "HostMetricChart",
        widthInDashboardUnits: 4,
        heightInDashboardUnits: 3,
      },
    ],
  });

  test("is offered when the canvas was handed the way to it, and names the widget", () => {
    const onEditWidgetClick: jest.Mock<(componentId: ObjectID) => void> =
      jest.fn<(componentId: ObjectID) => void>();

    render(canvas({ config: CONFIG, onEditWidgetClick }));

    fireEvent.click(
      within(fallbacks()[0]!).getByTestId("dashboard-widget-fallback-edit"),
    );

    expect(onEditWidgetClick).toHaveBeenCalledTimes(1);
    expect(onEditWidgetClick.mock.calls[0]![0].toString()).toBe(UNKNOWN_ID);
  });

  test("is not offered when the canvas was handed none (a reader, the public dashboard)", () => {
    render(canvas({ config: CONFIG }));

    expect(
      within(fallbacks()[0]!).queryByTestId("dashboard-widget-fallback-edit"),
    ).toBeNull();
  });

  test("a selected widget of an unknown type, while editing, opens settings that say why there are none", () => {
    render(
      canvas({
        config: CONFIG,
        isEditMode: true,
        selectedComponentId: new ObjectID(UNKNOWN_ID),
      }),
    );

    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: "Component Settings",
    });

    expect(
      within(dialog).getByTestId("widget-settings-unknown-type"),
    ).toHaveTextContent('OneUptime has no "HostMetricChart" widget');
    expect(within(dialog).queryByTestId("arguments-form-stub")).toBeNull();
    expect(within(dialog).queryByText("Duplicate Widget")).toBeNull();

    // Its live preview shows the same note as the board.
    expect(
      within(dialog).getByTestId(DASHBOARD_WIDGET_FALLBACK_TEST_ID),
    ).toHaveTextContent("This widget could not be shown");
  });

  test("a selected widget of a known type opens its settings form and can be copied", () => {
    render(
      canvas({
        config: board([widget(CLOCK_ID, DashboardComponentType.Clock, 0)]),
        isEditMode: true,
        selectedComponentId: new ObjectID(CLOCK_ID),
      }),
    );

    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: "Component Settings",
    });

    expect(
      within(dialog).getByTestId("arguments-form-stub"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Duplicate Widget")).toBeInTheDocument();
  });

  test("a selection that names no widget on the board opens nothing, and does not throw", () => {
    render(
      canvas({
        config: board([widget(CLOCK_ID, DashboardComponentType.Clock, 0)]),
        isEditMode: true,
        selectedComponentId: new ObjectID(
          "00000000-0000-4000-8000-00000000dead",
        ),
      }),
    );

    expect(
      screen.queryByRole("dialog", { name: "Component Settings" }),
    ).toBeNull();
    expect(screen.getByTestId("clock-widget")).toBeInTheDocument();
  });
});
