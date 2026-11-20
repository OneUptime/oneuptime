import "@testing-library/jest-dom";
import { act, cleanup, render } from "@testing-library/react";
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

/*
 * A DASHBOARD OPENED AT ONE OF ITS WIDGETS (#10084), on the board itself:
 * the real DashboardCanvas, which the dashboard inside OneUptime and its
 * public link both draw, handed the widget a link names (landingWidgetId).
 *
 * Pinned here:
 *   - once the board is drawn, the widget's own box is brought into view,
 *     outlined for a moment and given the focus - found by the id it is
 *     drawn under, in whatever case the link wrote it;
 *   - once for each link: the board's own changes after it - a refresh, a
 *     moved widget, a new time range - never bring the page back;
 *   - a widget the board does not have (deleted since the link was made),
 *     or an empty board, opens the board at its top: nothing is scrolled
 *     to or outlined, and the page is told once, to say so;
 *   - no link, no landing; a board that goes away takes its mark with it,
 *     and drawn again it lands again (React's StrictMode does both).
 *
 * The widgets are stubs; the browser's frames are run when a test says.
 * Real frames, scrolling and the ring are checked in a browser by
 * packages/E2E/DashboardTimeRange (DashboardWidgetLink.spec.ts).
 */

jest.setTimeout(120000);

function stubWidget(): () => {
  __esModule: boolean;
  default: (props: Record<string, unknown>) => ReactElement;
} {
  return () => {
    const reactModule: typeof React = jest.requireActual(
      "react",
    ) as typeof React;

    return {
      __esModule: true,
      default: (props: Record<string, unknown>): ReactElement => {
        return reactModule.createElement("div", {
          "data-testid": `widget-${String(
            (props["componentId"] as { toString: () => string }).toString(),
          )}`,
        });
      },
    };
  };
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTextComponent",
  stubWidget(),
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardChartComponent",
  stubWidget(),
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
        return reactModule.createElement("div");
      },
    };
  },
);

import DashboardCanvas, {
  DASHBOARD_WIDGET_BOX_ATTRIBUTE,
  getDashboardWidgetBoxId,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/Index";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import StoredDashboardViewConfig from "../../../Utils/Dashboard/StoredDashboardViewConfig";
import {
  DASHBOARD_WIDGET_LANDED_ATTRIBUTE,
  DASHBOARD_WIDGET_LANDED_IN_MS,
} from "../../../UI/Utils/DashboardWidgetLanding";

const ID: Record<string, string> = {
  title: "6a1e0c00-0000-4000-8000-000000000001",
  cpu: "6a1e0c00-0000-4000-8000-000000000002",
  latency: "6a1e0c00-0000-4000-8000-000000000003",
};

const ORIGINAL_REQUEST_FRAME: typeof window.requestAnimationFrame =
  window.requestAnimationFrame;
const ORIGINAL_CANCEL_FRAME: typeof window.cancelAnimationFrame =
  window.cancelAnimationFrame;
const ORIGINAL_SCROLL_INTO_VIEW: unknown = (
  HTMLElement.prototype as unknown as { scrollIntoView: unknown }
).scrollIntoView;

// Animation frames asked for, run when a test says (runFrames).
const frames: Map<number, FrameRequestCallback> = new Map();
let nextFrame: number = 1;

// What was scrolled into view, and how.
let scrolls: Array<{ id: string; options: unknown }> = [];

function runFrames(): void {
  act(() => {
    const pending: Array<FrameRequestCallback> = Array.from(frames.values());

    frames.clear();

    for (const callback of pending) {
      callback(0);
    }
  });
}

function widget(data: {
  id: unknown;
  type: DashboardComponentType;
  top: number;
}): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: data.id as ObjectID,
    componentType: data.type,
    topInDashboardUnits: data.top,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 3,
    minWidthInDashboardUnits: 1,
    minHeightInDashboardUnits: 1,
    arguments: {},
  };
}

const COMPONENTS: Array<DashboardBaseComponent> = [
  widget({
    id: new ObjectID(ID["title"]!),
    type: DashboardComponentType.Text,
    top: 0,
  }),
  widget({
    id: new ObjectID(ID["cpu"]!),
    type: DashboardComponentType.Chart,
    top: 3,
  }),
  widget({
    id: new ObjectID(ID["latency"]!),
    type: DashboardComponentType.Chart,
    top: 6,
  }),
];

function canvas(
  data: {
    landingWidgetId?: string | undefined;
    onLandingWidgetMissing?: (() => void) | undefined;
    components?: Array<DashboardBaseComponent>;
    refreshTick?: number;
  } = {},
): ReactElement {
  const config: DashboardViewConfig = {
    _type: ObjectType.DashboardViewConfig,
    heightInDashboardUnits: 9,
    components: data.components || COMPONENTS,
  };

  return (
    <DashboardCanvas
      dashboardViewConfig={config}
      onDashboardViewConfigChange={() => {}}
      isEditMode={false}
      currentTotalDashboardWidthInPx={1200}
      onComponentSelected={() => {}}
      onComponentUnselected={() => {}}
      selectedComponentId={null}
      metrics={{ metricTypes: [], telemetryAttributes: [] }}
      dashboardStartAndEndDate={{ range: TimeRange.PAST_ONE_HOUR }}
      refreshTick={data.refreshTick ?? 0}
      landingWidgetId={data.landingWidgetId}
      onLandingWidgetMissing={data.onLandingWidgetMissing}
    />
  );
}

function box(key: string): HTMLElement {
  return document.getElementById(getDashboardWidgetBoxId(ID[key]!))!;
}

function landedBoxes(): Array<string> {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      `[${DASHBOARD_WIDGET_LANDED_ATTRIBUTE}]`,
    ),
  ).map((element: HTMLElement): string => {
    return element.id;
  });
}

beforeAll(() => {
  (
    HTMLElement.prototype as unknown as { scrollIntoView: unknown }
  ).scrollIntoView = function (this: HTMLElement, options: unknown): void {
    scrolls.push({ id: this.id, options });
  };
});

afterAll(() => {
  (
    HTMLElement.prototype as unknown as { scrollIntoView: unknown }
  ).scrollIntoView = ORIGINAL_SCROLL_INTO_VIEW;
  window.requestAnimationFrame = ORIGINAL_REQUEST_FRAME;
  window.cancelAnimationFrame = ORIGINAL_CANCEL_FRAME;
});

beforeEach(() => {
  scrolls = [];
  frames.clear();
  window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    const id: number = nextFrame++;
    frames.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = (id: number): void => {
    frames.delete(id);
  };
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("a link that names a widget of the board", () => {
  test("lands on it once the board is drawn: in view, outlined and focused, by the id it is drawn under in any case", () => {
    render(canvas({ landingWidgetId: ID["latency"]!.toUpperCase() }));

    // Every widget is a box a link can land on.
    expect(
      document.querySelectorAll(`[${DASHBOARD_WIDGET_BOX_ATTRIBUTE}="true"]`),
    ).toHaveLength(3);
    expect(landedBoxes()).toEqual([getDashboardWidgetBoxId(ID["latency"]!)]);
    expect(document.activeElement).toBe(box("latency"));
    expect(box("latency").getAttribute("tabindex")).toBe("-1");

    // Brought into view once the browser draws a frame, and only it.
    runFrames();
    expect(
      scrolls.map((scroll: { id: string }): string => {
        return scroll.id;
      }),
    ).toContain(getDashboardWidgetBoxId(ID["latency"]!));
    expect(
      scrolls.every((scroll: { id: string }): boolean => {
        return scroll.id === getDashboardWidgetBoxId(ID["latency"]!);
      }),
    ).toBe(true);
  });

  test("the mark goes after a moment; the widget stays where the person is", () => {
    jest.useFakeTimers();
    render(canvas({ landingWidgetId: ID["cpu"]! }));

    expect(landedBoxes()).toEqual([getDashboardWidgetBoxId(ID["cpu"]!)]);

    act(() => {
      jest.advanceTimersByTime(DASHBOARD_WIDGET_LANDED_IN_MS);
    });

    expect(landedBoxes()).toEqual([]);
    expect(box("cpu")).toBeInTheDocument();
  });

  test("once for each link: the board's own changes after it never bring the page back", () => {
    const { rerender } = render(canvas({ landingWidgetId: ID["latency"]! }));

    runFrames();

    const scrolled: number = scrolls.length;
    const missing: jest.Mock = jest.fn();

    // A refresh, then a widget moved: the same link, the same board.
    rerender(
      canvas({
        landingWidgetId: ID["latency"]!,
        refreshTick: 1,
        onLandingWidgetMissing: missing,
      }),
    );
    rerender(
      canvas({
        landingWidgetId: ID["latency"]!,
        refreshTick: 2,
        components: [COMPONENTS[2]!, COMPONENTS[0]!, COMPONENTS[1]!],
        onLandingWidgetMissing: missing,
      }),
    );
    runFrames();

    expect(scrolls).toHaveLength(scrolled);
    expect(missing).not.toHaveBeenCalled();

    // A new link is a new landing.
    rerender(canvas({ landingWidgetId: ID["title"]! }));
    expect(landedBoxes()).toEqual([getDashboardWidgetBoxId(ID["title"]!)]);
  });

  test("a widget stored with its id as an ObjectID's JSON, as text in capitals, or with none, is the one its link names", () => {
    // As both pages hand the board its config: read from what was stored.
    const stored: DashboardViewConfig = StoredDashboardViewConfig.read({
      _type: ObjectType.DashboardViewConfig,
      heightInDashboardUnits: 9,
      components: [
        {
          ...COMPONENTS[0]!,
          componentId: { _type: ObjectType.ObjectID, value: ID["title"]! },
        },
        { ...COMPONENTS[1]!, componentId: ` ${ID["cpu"]!.toUpperCase()} ` },
        // No id of its own: the one every reader derives for it.
        { ...COMPONENTS[2]!, componentId: undefined },
      ],
    });
    const derivedId: string = stored.components[2]!.componentId.toString();

    for (const linked of [ID["title"]!, ID["cpu"]!, derivedId]) {
      cleanup();
      render(
        canvas({ landingWidgetId: linked, components: stored.components }),
      );

      expect(landedBoxes()).toHaveLength(1);
      expect(landedBoxes()[0]!.toLowerCase()).toBe(
        getDashboardWidgetBoxId(linked).toLowerCase(),
      );
    }

    expect(derivedId).toBe("00000000-0000-4000-8000-000000000001");
  });
});

describe("a link to a widget the board does not have", () => {
  test("opens the board at its top: nothing scrolled to or outlined, and the page told once", () => {
    const missing: jest.Mock = jest.fn();
    const { rerender } = render(
      canvas({
        landingWidgetId: "6a1e0c00-0000-4000-8000-0000000000ff",
        onLandingWidgetMissing: missing,
      }),
    );

    runFrames();

    expect(missing).toHaveBeenCalledTimes(1);
    expect(landedBoxes()).toEqual([]);
    expect(scrolls).toEqual([]);
    expect(document.activeElement).toBe(document.body);

    // Drawn again, it is not said again.
    rerender(
      canvas({
        landingWidgetId: "6a1e0c00-0000-4000-8000-0000000000ff",
        onLandingWidgetMissing: missing,
        refreshTick: 1,
      }),
    );
    expect(missing).toHaveBeenCalledTimes(1);
  });

  test("an empty board has none of them: told too", () => {
    const missing: jest.Mock = jest.fn();

    render(
      canvas({
        landingWidgetId: ID["cpu"]!,
        onLandingWidgetMissing: missing,
        components: [],
      }),
    );

    expect(missing).toHaveBeenCalledTimes(1);
  });
});

describe("no link, and a board that comes and goes", () => {
  test("no link: nothing lands, and nothing is told", () => {
    const missing: jest.Mock = jest.fn();

    render(canvas({ onLandingWidgetMissing: missing }));
    runFrames();

    expect(landedBoxes()).toEqual([]);
    expect(scrolls).toEqual([]);
    expect(missing).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });

  test("a board that goes away takes its mark with it; drawn again, it lands again", () => {
    const first: ReturnType<typeof render> = render(
      canvas({ landingWidgetId: ID["cpu"]! }),
    );

    expect(landedBoxes()).toHaveLength(1);
    first.unmount();
    expect(frames.size).toBe(0);

    render(canvas({ landingWidgetId: ID["cpu"]! }));
    expect(landedBoxes()).toEqual([getDashboardWidgetBoxId(ID["cpu"]!)]);
  });

  test("under React's StrictMode, which draws every effect twice, the widget is still landed on", () => {
    render(
      <React.StrictMode>
        {canvas({ landingWidgetId: ID["cpu"]! })}
      </React.StrictMode>,
    );

    expect(landedBoxes()).toEqual([getDashboardWidgetBoxId(ID["cpu"]!)]);
    expect(document.activeElement).toBe(box("cpu"));
  });
});
