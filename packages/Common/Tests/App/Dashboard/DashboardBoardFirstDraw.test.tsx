import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
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
import { SpyInstance } from "jest-mock";
import React, { ReactElement } from "react";

/*
 * A dashboard's board draws each widget once, at its own size.
 *
 * On load the board used to draw every widget a few pixels across first -
 * laid out for a board of no width, before it had measured its own - and
 * reading its width then made the browser style the widgets at that size,
 * so their real size came in through their transition: each widget grew
 * from a sliver to its size with its rows already in it (14.0.95's gate
 * trace, and master's App Test on 10-30, which read a list in 153px of a
 * widget that settles far wider). The board's own width never changed.
 *
 * Now the board measures its box before it draws a widget, in the same
 * frame (a layout effect, before the browser paints), and a widget's box
 * only moves with a transition while the board is edited. This suite pins
 * both, in jsdom: the board's outer box is as wide as the test says, the
 * ResizeObserver is one the test fires, animation frames run when the test
 * says, and the widgets are stubs that record every size the board hands
 * them. Real frames, in a browser, are checked by
 * packages/E2E/DashboardWidgetSort ("each widget is drawn once").
 */

jest.setTimeout(120000);

interface DrawnSize {
  width: number;
  height: number;
}

// Every size each widget was rendered with, in order, and its mounts.
const renders: Record<string, Array<DrawnSize>> = {};
const mounts: Record<string, number> = {};

// A widget of any kind: a stub that records the size it is given.
function stubWidget(): () => {
  __esModule: boolean;
  default: (props: Record<string, unknown>) => ReactElement;
} {
  return () => {
    const reactModule: typeof React = jest.requireActual(
      "react",
    ) as typeof React;

    const Stub: (props: Record<string, unknown>) => ReactElement = (
      props: Record<string, unknown>,
    ): ReactElement => {
      const id: string = String(
        (props["componentId"] as { toString: () => string }).toString(),
      );

      (renders[id] = renders[id] || []).push({
        width: Number(props["dashboardComponentWidthInPx"]),
        height: Number(props["dashboardComponentHeightInPx"]),
      });

      reactModule.useEffect(() => {
        mounts[id] = (mounts[id] || 0) + 1;
      }, []);

      return reactModule.createElement("div", {
        "data-testid": `widget-${id}`,
      });
    };

    return { __esModule: true, default: Stub };
  };
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTextComponent",
  stubWidget(),
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardValueComponent",
  stubWidget(),
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardChartComponent",
  stubWidget(),
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardGaugeComponent",
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
        return reactModule.createElement("div", {
          "data-testid": "arguments-form-stub",
        });
      },
    };
  },
);

import DashboardCanvas, {
  DASHBOARD_BOARD_MEASURING_TEST_ID,
  DASHBOARD_BOARD_TEST_ID,
  DASHBOARD_BOARD_WIDTH_PROBE_TEST_ID,
  EDITED_BOARD_HEIGHT_TRANSITION,
  getWidgetBoxTransition,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/Index";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import { GRID_ITEM_TRANSITION } from "../../../UI/Utils/UseDashboardGridDnd";
import DashboardBoardLayoutUtil, {
  DashboardBoardArrangement,
  DashboardBoardLayout,
} from "../../../Utils/Dashboard/DashboardBoardLayout";
import GridLayoutUtil, { GridRect } from "../../../Utils/Dashboard/GridLayout";

// The board's padding on each side: the widgets get its width less 16px.
const BOARD_PADDING: number = 8;

let boardClientWidth: number = 0;

// The board's outer box's height, as getBoundingClientRect reads it.
let boardHeight: number = 0;

/*
 * What the board held each time the canvas read its width: the widgets on
 * it then, and whether it was its measuring box.
 */
interface BoardAtMeasure {
  widgets: number;
  isMeasuringBox: boolean;
}

const boardAtMeasures: Array<BoardAtMeasure> = [];

// The measuring box the board held at each read, when it held one.
const measuringBoxes: Array<Element> = [];

// ResizeObservers the canvas made, to tell them the board changed width.
const observers: Array<() => void> = [];

// The elements they were asked to watch.
const observed: Array<Element> = [];

/*
 * Whether a stand-in reports at once, inside observe() itself, as some
 * tests' stand-ins do and no browser does.
 */
let reportsInsideObserve: boolean = false;

class FakeResizeObserver {
  private callback: () => void;

  public constructor(callback: () => void) {
    this.callback = callback;
  }

  public observe(target: Element): void {
    observers.push(this.callback);
    observed.push(target);

    if (reportsInsideObserve) {
      this.callback();
    }
  }

  public unobserve(): void {
    // Nothing to stop.
  }

  public disconnect(): void {
    const index: number = observers.indexOf(this.callback);

    if (index >= 0) {
      observers.splice(index, 1);
    }
  }
}

const ORIGINAL_RESIZE_OBSERVER: unknown = (
  globalThis as unknown as { ResizeObserver: unknown }
).ResizeObserver;

const ORIGINAL_CLIENT_WIDTH: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");

const ORIGINAL_BOUNDING_RECT: typeof HTMLElement.prototype.getBoundingClientRect =
  HTMLElement.prototype.getBoundingClientRect;

const ORIGINAL_REQUEST_FRAME: typeof window.requestAnimationFrame =
  window.requestAnimationFrame;
const ORIGINAL_CANCEL_FRAME: typeof window.cancelAnimationFrame =
  window.cancelAnimationFrame;

// Animation frames asked for, run when a test says (runFrames).
const frames: Map<number, FrameRequestCallback> = new Map();
let nextFrame: number = 1;

// Runs the frames asked for so far, as a browser runs a frame's callbacks.
function runFrames(): void {
  act(() => {
    const pending: Array<FrameRequestCallback> = Array.from(frames.values());

    frames.clear();

    for (const callback of pending) {
      callback(0);
    }
  });
}

function widgetsOnThePage(): Array<HTMLElement> {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[id^="dashboard-component-"]'),
  );
}

beforeAll(() => {
  /*
   * The board's outer box is as wide as the test says, and every read of
   * it is recorded with what the board held at that moment; jsdom lays out
   * nothing else.
   */
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement): number {
      if (this.getAttribute("data-testid") !== DASHBOARD_BOARD_TEST_ID) {
        return 0;
      }

      const measuringBox: Element | null = this.querySelector(
        `[data-testid="${DASHBOARD_BOARD_MEASURING_TEST_ID}"]`,
      );

      boardAtMeasures.push({
        widgets: widgetsOnThePage().length,
        isMeasuringBox: Boolean(measuringBox),
      });

      if (measuringBox) {
        measuringBoxes.push(measuringBox);
      }

      return boardClientWidth;
    },
  });

  HTMLElement.prototype.getBoundingClientRect = function (
    this: HTMLElement,
  ): DOMRect {
    if (this.getAttribute("data-testid") !== DASHBOARD_BOARD_TEST_ID) {
      return ORIGINAL_BOUNDING_RECT.call(this);
    }

    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: boardClientWidth,
      bottom: boardHeight,
      width: boardClientWidth,
      height: boardHeight,
      toJSON: (): Record<string, never> => {
        return {};
      },
    };
  };
});

afterAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    ORIGINAL_RESIZE_OBSERVER;

  if (ORIGINAL_CLIENT_WIDTH) {
    Object.defineProperty(
      HTMLElement.prototype,
      "clientWidth",
      ORIGINAL_CLIENT_WIDTH,
    );
  }

  HTMLElement.prototype.getBoundingClientRect = ORIGINAL_BOUNDING_RECT;
  window.requestAnimationFrame = ORIGINAL_REQUEST_FRAME;
  window.cancelAnimationFrame = ORIGINAL_CANCEL_FRAME;
});

beforeEach(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    FakeResizeObserver;
  boardClientWidth = 0;
  boardHeight = 0;
  frames.clear();
  window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    const id: number = nextFrame++;
    frames.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = (id: number): void => {
    frames.delete(id);
  };
  boardAtMeasures.splice(0, boardAtMeasures.length);
  measuringBoxes.splice(0, measuringBoxes.length);

  for (const key of Object.keys(renders)) {
    delete renders[key];
  }

  for (const key of Object.keys(mounts)) {
    delete mounts[key];
  }
});

afterEach(() => {
  cleanup();
  observers.splice(0, observers.length);
  observed.splice(0, observed.length);
  reportsInsideObserve = false;
});

const ID: Record<string, string> = {
  title: "550e8400-e29b-41d4-a716-446655440011",
  latency: "550e8400-e29b-41d4-a716-446655440012",
  errors: "550e8400-e29b-41d4-a716-446655440013",
  requests: "550e8400-e29b-41d4-a716-446655440014",
  cpu: "550e8400-e29b-41d4-a716-446655440015",
};

function widget(data: {
  id: string;
  type: DashboardComponentType;
  left: number;
  top: number;
  width: number;
  height: number;
}): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: new ObjectID(data.id),
    componentType: data.type,
    topInDashboardUnits: data.top,
    leftInDashboardUnits: data.left,
    widthInDashboardUnits: data.width,
    heightInDashboardUnits: data.height,
    minWidthInDashboardUnits: 1,
    minHeightInDashboardUnits: 1,
    arguments: {},
  };
}

/*
 *   row 0      [ title ......................................... ]
 *   rows 1-3   [ cpu (gauge) ][ requests (chart) ............... ]
 *   row 4      [ latency (value) ][ errors (value) ]
 */
const COMPONENTS: Array<DashboardBaseComponent> = [
  widget({
    id: ID["title"]!,
    type: DashboardComponentType.Text,
    left: 0,
    top: 0,
    width: 12,
    height: 1,
  }),
  widget({
    id: ID["cpu"]!,
    type: DashboardComponentType.Gauge,
    left: 0,
    top: 1,
    width: 3,
    height: 3,
  }),
  widget({
    id: ID["requests"]!,
    type: DashboardComponentType.Chart,
    left: 3,
    top: 1,
    width: 9,
    height: 3,
  }),
  widget({
    id: ID["latency"]!,
    type: DashboardComponentType.Value,
    left: 0,
    top: 4,
    width: 3,
    height: 1,
  }),
  widget({
    id: ID["errors"]!,
    type: DashboardComponentType.Value,
    left: 3,
    top: 4,
    width: 3,
    height: 1,
  }),
];

function configWith(
  components: Array<DashboardBaseComponent>,
): DashboardViewConfig {
  return {
    _type: ObjectType.DashboardViewConfig,
    heightInDashboardUnits: 5,
    components,
  };
}

function canvas(
  data: {
    isEditMode?: boolean;
    components?: Array<DashboardBaseComponent>;
  } = {},
): ReactElement {
  return (
    <DashboardCanvas
      dashboardViewConfig={configWith(data.components || COMPONENTS)}
      onDashboardViewConfigChange={() => {}}
      isEditMode={Boolean(data.isEditMode)}
      currentTotalDashboardWidthInPx={1200}
      onComponentSelected={() => {}}
      onComponentUnselected={() => {}}
      selectedComponentId={null}
      metrics={{ metricTypes: [], telemetryAttributes: [] }}
      dashboardStartAndEndDate={{ range: TimeRange.PAST_ONE_HOUR }}
      refreshTick={0}
    />
  );
}

// Renders the board at an outer width: the widgets get it less the padding.
function renderAt(
  outerWidth: number,
  isEditMode: boolean = false,
): ReturnType<typeof render> {
  boardClientWidth = outerWidth;
  return render(canvas({ isEditMode }));
}

// The same, drawn into a container the test watches from before the board is.
function renderInto(
  container: HTMLElement,
  outerWidth: number,
  isEditMode: boolean = false,
): ReturnType<typeof render> {
  boardClientWidth = outerWidth;
  return render(canvas({ isEditMode }), { container });
}

function resizeTo(outerWidth: number): void {
  boardClientWidth = outerWidth;
  act(() => {
    for (const notify of [...observers]) {
      notify();
    }
  });
}

function board(): HTMLElement {
  return screen.getByTestId(DASHBOARD_BOARD_TEST_ID);
}

function wrapper(key: string): HTMLElement {
  return document.getElementById(`dashboard-component-${ID[key]}`)!;
}

function positioner(): HTMLElement {
  return wrapper("title").parentElement!;
}

/*
 * The size each widget gets on a board of this outer width, worked out by
 * the board's own rules (DashboardBoardLayout): what it must be drawn at.
 */
function sizesOnABoardOf(outerWidth: number): Record<string, DrawnSize> {
  const layout: DashboardBoardLayout = DashboardBoardLayoutUtil.getLayout({
    boardWidthInPx: Math.max(outerWidth - 2 * BOARD_PADDING, 0),
    isEditMode: false,
  });
  const rects: Array<GridRect> =
    GridLayoutUtil.fromDashboardComponents(COMPONENTS);
  const sizes: Record<string, DrawnSize> = {};

  COMPONENTS.forEach((component: DashboardBaseComponent, index: number) => {
    const key: string = Object.keys(ID).find((name: string) => {
      return ID[name] === component.componentId.toString();
    })!;
    const rect: GridRect = rects[index]!;

    sizes[key] =
      layout.arrangement === DashboardBoardArrangement.Stacked
        ? {
            width: layout.widthInPx,
            height: DashboardBoardLayoutUtil.getStackedHeightInPx({
              heightInUnits: rect.height,
              componentType: component.componentType,
            }),
          }
        : {
            width: DashboardBoardLayoutUtil.getGridBox(rect, layout).width,
            height: DashboardBoardLayoutUtil.getGridBox(rect, layout).height,
          };
  });

  return sizes;
}

/*
 * Records every change of a style attribute under the container, from
 * before the board is drawn: a widget's box written twice is one.
 */
function watchStyles(container: HTMLElement): {
  styleChangesOf: (element: HTMLElement) => number;
  stop: () => void;
} {
  const records: Array<MutationRecord> = [];
  const observer: MutationObserver = new MutationObserver(
    (batch: Array<MutationRecord>) => {
      records.push(...batch);
    },
  );

  observer.observe(container, {
    subtree: true,
    attributes: true,
    attributeFilter: ["style"],
  });

  return {
    styleChangesOf: (element: HTMLElement): number => {
      records.push(...observer.takeRecords());

      return records.filter((record: MutationRecord) => {
        return record.target === element;
      }).length;
    },
    stop: (): void => {
      observer.disconnect();
    },
  };
}

// The three widths a board meets: wide, beside the side menu, a phone.
const WIDTHS: Array<{ name: string; outerWidth: number }> = [
  { name: "a wide board (the square grid)", outerWidth: 1216 },
  { name: "a board beside the side menu (narrower columns)", outerWidth: 616 },
  { name: "a phone's board (one widget under another)", outerWidth: 374 },
];

describe("the board measures its width before it draws a widget", () => {
  for (const { name, outerWidth } of WIDTHS) {
    test(`${name}: when its width is read, it holds its measuring box and no widget yet`, () => {
      renderAt(outerWidth);

      expect(boardAtMeasures.length).toBeGreaterThanOrEqual(1);
      expect(boardAtMeasures[0]).toEqual({ widgets: 0, isMeasuringBox: true });

      // Then every widget, and the measuring box gone: it is never painted.
      expect(widgetsOnThePage()).toHaveLength(COMPONENTS.length);
      expect(
        screen.queryByTestId(DASHBOARD_BOARD_MEASURING_TEST_ID),
      ).not.toBeInTheDocument();
    });

    test(`${name}: every widget is first drawn at its own size, and never at another`, () => {
      renderAt(outerWidth);

      const sizes: Record<string, DrawnSize> = sizesOnABoardOf(outerWidth);

      for (const key of Object.keys(ID)) {
        const drawn: Array<DrawnSize> = renders[ID[key]!] || [];

        expect(drawn.length).toBeGreaterThanOrEqual(1);
        expect(drawn[0]!.width).toBeCloseTo(sizes[key]!.width, 6);
        expect(drawn[0]!.height).toBeCloseTo(sizes[key]!.height, 6);

        for (const size of drawn) {
          expect(size.width).toBeCloseTo(sizes[key]!.width, 6);
          expect(size.height).toBeCloseTo(sizes[key]!.height, 6);
        }

        expect(mounts[ID[key]!]).toBe(1);
      }
    });
  }

  test("a widget's box is written once: its style never changes after it is added", () => {
    const container: HTMLElement = document.createElement("div");
    document.body.appendChild(container);
    const styles: ReturnType<typeof watchStyles> = watchStyles(container);

    renderInto(container, 1216);

    for (const key of Object.keys(ID)) {
      expect(styles.styleChangesOf(wrapper(key))).toBe(0);
    }

    styles.stop();
  });

  for (const isEditMode of [false, true]) {
    test(`${isEditMode ? "editing" : "viewing"}: the board's grid is added at its measured height - a box of its own, not the measuring box restyled`, () => {
      const container: HTMLElement = document.createElement("div");
      document.body.appendChild(container);
      const styles: ReturnType<typeof watchStyles> = watchStyles(container);

      // A wide board's rows are as tall as its units are wide: taller than 70px.
      renderInto(container, 1216, isEditMode);

      const unit: number = (1200 - 110) / 12;
      // Editing keeps 4 empty rows under the lowest widget, 12 at least.
      const rows: number = isEditMode ? 12 : 5;

      expect(positioner().style.height).toBe(
        `${rows * unit + (rows - 1) * 10}px`,
      );
      expect(styles.styleChangesOf(positioner())).toBe(0);

      // The box that was measured is gone, and the grid is not it.
      expect(measuringBoxes).toHaveLength(1);
      expect(measuringBoxes[0]!.isConnected).toBe(false);
      expect(positioner()).not.toBe(measuringBoxes[0]);

      styles.stop();
    });
  }
});

describe("viewing, a widget takes its new size at once; editing, it glides", () => {
  test("viewing, no widget's box and not the board's height move with a transition", () => {
    renderAt(1216);

    for (const key of Object.keys(ID)) {
      expect(wrapper(key).style.transition).toBe("none");
    }

    expect(positioner().style.transition).toBe("");
  });

  test("a new width - a window resized, Full Screen - redraws every widget at its new size, without mounting it again", () => {
    renderAt(1216);
    resizeTo(816);

    const sizes: Record<string, DrawnSize> = sizesOnABoardOf(816);

    for (const key of Object.keys(ID)) {
      const drawn: Array<DrawnSize> = renders[ID[key]!]!;
      const last: DrawnSize = drawn[drawn.length - 1]!;

      expect(last.width).toBeCloseTo(sizes[key]!.width, 6);
      expect(last.height).toBeCloseTo(sizes[key]!.height, 6);
      expect(wrapper(key).style.width).toBe(`${sizes[key]!.width}px`);
      expect(wrapper(key).style.transition).toBe("none");
      expect(mounts[ID[key]!]).toBe(1);
    }

    expect(positioner().style.transition).toBe("");
  });

  test("editing, an idle widget glides into its place, and the board's height follows its rows", () => {
    renderAt(1216, true);

    for (const key of Object.keys(ID)) {
      expect(wrapper(key).style.transition).toBe(GRID_ITEM_TRANSITION);
    }

    expect(positioner().style.transition).toBe(EDITED_BOARD_HEIGHT_TRANSITION);
  });

  test("editing, the widget being dragged follows the pointer with none of its own", () => {
    expect(getWidgetBoxTransition({ isEditMode: true, isActive: false })).toBe(
      GRID_ITEM_TRANSITION,
    );
    expect(getWidgetBoxTransition({ isEditMode: true, isActive: true })).toBe(
      "none",
    );
    expect(getWidgetBoxTransition({ isEditMode: false, isActive: false })).toBe(
      "none",
    );
    expect(getWidgetBoxTransition({ isEditMode: false, isActive: true })).toBe(
      "none",
    );
  });

  test("the board's height moves only while it is edited", () => {
    expect(EDITED_BOARD_HEIGHT_TRANSITION).toMatch(/^height /);
    expect(GRID_ITEM_TRANSITION).toContain("width");
    expect(GRID_ITEM_TRANSITION).toContain("transform");
  });
});

/*
 * A board's width can change after it is first measured and before the
 * browser paints it - the Tailwind runtime styles the margins of a card
 * the board opens in a moment after they are added - and at any time
 * after. The board reads it again before the browser lays a frame out: in
 * its first frame, and in the window's resize event. Its ResizeObserver
 * reports what else changes it, after the browser lays the frame out and
 * before it paints it: the widgets take the new width there and then, and
 * the board keeps its height until the next frame, so nothing outside it
 * changes size inside the observer's call - the browser's "ResizeObserver
 * loop completed with undelivered notifications", which the page raised
 * when the side menu (it watches the page's body) shared the frame.
 */
describe("the board follows a new width in the frame it comes in", () => {
  test("its observer watches a box of no height across the board, which only a new width resizes", () => {
    renderAt(1216);

    expect(observed).toHaveLength(1);

    const probe: Element = observed[0]!;

    expect(probe).toHaveAttribute(
      "data-testid",
      DASHBOARD_BOARD_WIDTH_PROBE_TEST_ID,
    );
    expect((probe as HTMLElement).style.height).toBe("0px");
    expect(probe).toHaveAttribute("aria-hidden", "true");
    // Across the board itself, before its padding and its widgets.
    expect(probe.parentElement).toBe(board());
    expect(board().firstElementChild).toBe(probe);
  });

  test("a new width is laid out inside the observer's own callback, not left for React to draw a frame later", () => {
    renderAt(1216);

    const sizes: Record<string, DrawnSize> = sizesOnABoardOf(1184);

    act(() => {
      boardClientWidth = 1184;

      for (const notify of [...observers]) {
        notify();
      }

      // Before the callback's work is over: the widgets already have it.
      for (const key of Object.keys(ID)) {
        expect(wrapper(key).style.width).toBe(`${sizes[key]!.width}px`);
      }
    });
  });

  test("laid out inside the observer's call, the board keeps its height until the next frame: nothing outside it changes size in the call", () => {
    renderAt(1216);
    boardHeight = 712.5;
    // The board's first frame: the width it was measured at.
    runFrames();

    const sizes: Record<string, DrawnSize> = sizesOnABoardOf(1184);

    act(() => {
      boardClientWidth = 1184;

      for (const notify of [...observers]) {
        notify();
      }

      // In the call: the widgets have the new width, the board its height.
      expect(board().style.height).toBe("712.5px");

      for (const key of Object.keys(ID)) {
        expect(wrapper(key).style.width).toBe(`${sizes[key]!.width}px`);
      }
    });

    // The next frame lets the height go, before the browser lays it out.
    expect(frames.size).toBe(1);
    runFrames();
    expect(board().style.height).toBe("");

    for (const key of Object.keys(ID)) {
      expect(mounts[ID[key]!]).toBe(1);
    }
  });

  test("a report of the width the widgets already have holds nothing and draws nothing again", () => {
    renderAt(1216);
    boardHeight = 712.5;
    runFrames();

    const drawnBefore: number = renders[ID["title"]!]!.length;

    resizeTo(1216);

    expect(board().style.height).toBe("");
    expect(frames.size).toBe(0);
    expect(renders[ID["title"]!]!).toHaveLength(drawnBefore);
  });

  test("a resized window is laid out in its resize event, before the frame is laid out: the board's height is never held", () => {
    renderAt(1216);
    boardHeight = 712.5;
    runFrames();

    const sizes: Record<string, DrawnSize> = sizesOnABoardOf(816);

    act(() => {
      boardClientWidth = 816;
      window.dispatchEvent(new Event("resize"));

      // In the event itself.
      for (const key of Object.keys(ID)) {
        expect(wrapper(key).style.width).toBe(`${sizes[key]!.width}px`);
      }
    });

    expect(board().style.height).toBe("");

    // The observer then reports the width the widgets have: nothing to do.
    resizeTo(816);
    expect(board().style.height).toBe("");

    for (const key of Object.keys(ID)) {
      expect(mounts[ID[key]!]).toBe(1);
    }
  });

  test("the board reads its width again in its first frame, before the browser lays it out: a card styled a moment late", () => {
    // Measured before the card's margins and padding are styled: 32px wider.
    renderAt(1248);

    expect(wrapper("title").style.width).toBe(
      `${sizesOnABoardOf(1248)["title"]!.width}px`,
    );

    // The runtime styles the card before the frame; the frame reads it.
    boardClientWidth = 1216;
    runFrames();

    const sizes: Record<string, DrawnSize> = sizesOnABoardOf(1216);

    for (const key of Object.keys(ID)) {
      expect(wrapper(key).style.width).toBe(`${sizes[key]!.width}px`);
      expect(mounts[ID[key]!]).toBe(1);
    }

    // Read before the frame was laid out: no height to hold.
    expect(board().style.height).toBe("");
  });

  test("gone, the board follows nothing: no frame of its own left, the window's resize unheard, a held height let go", () => {
    const view: ReturnType<typeof render> = renderAt(1216);
    boardHeight = 712.5;

    act(() => {
      boardClientWidth = 1184;

      for (const notify of [...observers]) {
        notify();
      }
    });

    const element: HTMLElement = board();

    expect(element.style.height).toBe("712.5px");

    view.unmount();

    expect(element.style.height).toBe("");
    expect(frames.size).toBe(0);
    expect(observers).toHaveLength(0);

    const drawnBefore: number = renders[ID["title"]!]!.length;

    act(() => {
      boardClientWidth = 600;
      window.dispatchEvent(new Event("resize"));
    });

    expect(renders[ID["title"]!]!).toHaveLength(drawnBefore);
  });

  test("the card a board opens in styled after its first frame: the widgets take the board's new width before it is painted", () => {
    // Measured before the card's margins and padding are styled: 32px wider.
    renderAt(1248);

    expect(wrapper("title").style.width).toBe(
      `${sizesOnABoardOf(1248)["title"]!.width}px`,
    );

    // The runtime styles the card; the browser lays the board out again.
    resizeTo(1216);

    const sizes: Record<string, DrawnSize> = sizesOnABoardOf(1216);

    for (const key of Object.keys(ID)) {
      expect(wrapper(key).style.width).toBe(`${sizes[key]!.width}px`);
      expect(mounts[ID[key]!]).toBe(1);
    }
  });

  test("a stand-in observer that reports inside observe() is measured as the layout effect measures, with no warning from React", () => {
    reportsInsideObserve = true;

    const errors: Array<string> = [];
    const errorSpy: SpyInstance<typeof console.error> = jest
      .spyOn(console, "error")
      .mockImplementation((...args: Array<unknown>): void => {
        errors.push(args.map(String).join(" "));
      });

    try {
      renderAt(1216);
    } finally {
      errorSpy.mockRestore();
    }

    expect(
      errors.filter((error: string) => {
        return error.includes("flushSync");
      }),
    ).toEqual([]);

    const sizes: Record<string, DrawnSize> = sizesOnABoardOf(1216);

    for (const key of Object.keys(ID)) {
      expect(renders[ID[key]!]![0]!.width).toBeCloseTo(sizes[key]!.width, 6);
    }
  });
});

describe("a board measured again", () => {
  test("emptied while editing and given a widget again, it is measured again before that widget is drawn", () => {
    const view: ReturnType<typeof render> = renderAt(1216, true);

    // Every widget deleted: the empty board, which has no box to measure.
    view.rerender(canvas({ isEditMode: true, components: [] }));
    expect(widgetsOnThePage()).toHaveLength(0);

    // The window narrows meanwhile; then the first widget comes back.
    boardClientWidth = 616;
    boardAtMeasures.splice(0, boardAtMeasures.length);
    delete renders[ID["title"]!];

    view.rerender(canvas({ isEditMode: true, components: [COMPONENTS[0]!] }));

    expect(boardAtMeasures[0]).toEqual({ widgets: 0, isMeasuringBox: true });

    // Drawn at the width it has now, from its first render.
    const drawn: Array<DrawnSize> = renders[ID["title"]!]!;

    expect(drawn[0]!.width).toBeCloseTo(600, 6);
    for (const size of drawn) {
      expect(size.width).toBeCloseTo(600, 6);
    }
  });

  test("a board measured 0 wide - not shown - is laid out as the narrowest grid, and drawn at its size once it has one", () => {
    renderAt(0);

    expect(board()).toHaveAttribute(
      "data-arrangement",
      DashboardBoardArrangement.Grid,
    );
    // As before it measured: a column of 1px, the gaps between them.
    expect(renders[ID["title"]!]![0]!.width).toBe(12 + 11 * 10);

    resizeTo(1216);

    const sizes: Record<string, DrawnSize> = sizesOnABoardOf(1216);

    for (const key of Object.keys(ID)) {
      const drawn: Array<DrawnSize> = renders[ID[key]!]!;

      expect(drawn[drawn.length - 1]!.width).toBeCloseTo(sizes[key]!.width, 6);
      expect(wrapper(key).style.transition).toBe("none");
      expect(mounts[ID[key]!]).toBe(1);
    }
  });

  test("without a ResizeObserver, the board is measured once, its widgets drawn at that width, and it follows the window's resize", () => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      undefined;

    renderAt(816);

    expect(observers).toHaveLength(0);

    const sizes: Record<string, DrawnSize> = sizesOnABoardOf(816);

    for (const key of Object.keys(ID)) {
      const drawn: Array<DrawnSize> = renders[ID[key]!]!;

      expect(drawn[0]!.width).toBeCloseTo(sizes[key]!.width, 6);
      expect(drawn[drawn.length - 1]!.width).toBeCloseTo(sizes[key]!.width, 6);
    }

    act(() => {
      boardClientWidth = 1216;
      window.dispatchEvent(new Event("resize"));
    });

    const wider: Record<string, DrawnSize> = sizesOnABoardOf(1216);

    for (const key of Object.keys(ID)) {
      expect(wrapper(key).style.width).toBe(`${wider[key]!.width}px`);
    }
  });
});
