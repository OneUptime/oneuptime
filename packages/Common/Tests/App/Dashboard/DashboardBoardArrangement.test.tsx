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
import React, { ReactElement } from "react";

/*
 * The dashboard's board, rendered for real, in the width it is given - the
 * canvas the dashboard inside OneUptime, a public dashboard and a
 * playlist's turn all draw. It used to be drawn at least 1000px wide, so a
 * phone scrolled it sideways (and, inside OneUptime, a 1280px window beside
 * the side menu did too). Now it lays its widgets out in its own width
 * (Common/Utils/Dashboard/DashboardBoardLayout):
 *
 * - wide, the square grid it always was;
 * - narrower, the grid with narrower columns and rows that keep 70px;
 * - on a phone, one widget under another, in the order the grid is read,
 *   each the board's width - and a chart tall enough for its plot;
 * - while editing on a phone, the grid at 500px, the board scrolling it
 *   sideways.
 *
 * jsdom lays nothing out, so the board's width is given to it: clientWidth
 * of the board's outer box, which the canvas measures, and a ResizeObserver
 * the test can fire. Widgets are stubs that publish the size the canvas
 * hands them, and count their mounts.
 */

jest.setTimeout(120000);

const mounts: Record<string, number> = {};

// Every widget kind the boards here hold: a stub that shows the size it is given.
function stubWidget(kind: string): () => {
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

      reactModule.useEffect(() => {
        mounts[id] = (mounts[id] || 0) + 1;
      }, []);

      return reactModule.createElement("div", {
        "data-testid": `widget-${id}`,
        "data-kind": kind,
        "data-width": String(props["dashboardComponentWidthInPx"]),
        "data-height": String(props["dashboardComponentHeightInPx"]),
      });
    };

    return { __esModule: true, default: Stub };
  };
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTextComponent",
  stubWidget("text"),
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardValueComponent",
  stubWidget("value"),
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardChartComponent",
  stubWidget("chart"),
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardGaugeComponent",
  stubWidget("gauge"),
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
  DASHBOARD_BOARD_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/Index";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import { DashboardBoardArrangement } from "../../../Utils/Dashboard/DashboardBoardLayout";

// The board's padding on each side: the widgets get its width less 16px.
const BOARD_PADDING: number = 8;

let boardClientWidth: number = 0;

// ResizeObservers the canvas made, to tell them the board changed width.
const observers: Array<() => void> = [];

class FakeResizeObserver {
  private callback: () => void;

  public constructor(callback: () => void) {
    this.callback = callback;
  }

  public observe(): void {
    observers.push(this.callback);
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

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    FakeResizeObserver;

  // The board's outer box is as wide as the test says; jsdom lays out nothing else.
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement): number {
      return this.getAttribute("data-testid") === DASHBOARD_BOARD_TEST_ID
        ? boardClientWidth
        : 0;
    },
  });
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
});

beforeEach(() => {
  boardClientWidth = 0;
  for (const key of Object.keys(mounts)) {
    delete mounts[key];
  }
});

afterEach(() => {
  cleanup();
  observers.splice(0, observers.length);
});

const ID: Record<string, string> = {
  title: "550e8400-e29b-41d4-a716-446655440001",
  latency: "550e8400-e29b-41d4-a716-446655440002",
  errors: "550e8400-e29b-41d4-a716-446655440003",
  requests: "550e8400-e29b-41d4-a716-446655440004",
  cpu: "550e8400-e29b-41d4-a716-446655440005",
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
 * A board as an author arranged it, listed out of reading order on
 * purpose: a title across the top, then a gauge on the left beside a chart
 * on the right, then two values side by side under them.
 *
 *   row 0      [ title ......................................... ]
 *   rows 1-3   [ cpu (gauge) ][ requests (chart) ............... ]
 *   row 4      [ latency (value) ][ errors (value) ]
 */
const CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  heightInDashboardUnits: 5,
  components: [
    widget({
      id: ID["errors"]!,
      type: DashboardComponentType.Value,
      left: 3,
      top: 4,
      width: 3,
      height: 1,
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
      id: ID["title"]!,
      type: DashboardComponentType.Text,
      left: 0,
      top: 0,
      width: 12,
      height: 1,
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
      id: ID["cpu"]!,
      type: DashboardComponentType.Gauge,
      left: 0,
      top: 1,
      width: 3,
      height: 3,
    }),
  ],
};

function canvas(isEditMode: boolean = false): ReactElement {
  return (
    <DashboardCanvas
      dashboardViewConfig={CONFIG}
      onDashboardViewConfigChange={() => {}}
      isEditMode={isEditMode}
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
  return render(canvas(isEditMode));
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

function drawnOrder(): Array<string> {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[id^="dashboard-component-"]'),
  ).map((element: HTMLElement) => {
    const id: string = element.id.slice("dashboard-component-".length);

    return Object.keys(ID).find((key: string) => {
      return ID[key] === id;
    })!;
  });
}

function sizeGiven(key: string): { width: number; height: number } {
  const stub: HTMLElement = screen.getByTestId(`widget-${ID[key]}`);

  return {
    width: Number(stub.getAttribute("data-width")),
    height: Number(stub.getAttribute("data-height")),
  };
}

describe("a phone: the widgets one under another", () => {
  // A 390px phone's board: 374px across inside the page, 358px for widgets.
  const OUTER: number = 374;
  const WIDTH: number = OUTER - 2 * BOARD_PADDING;

  test("the board says it is stacked, and the widgets come in the order the grid is read", () => {
    renderAt(OUTER);

    expect(board()).toHaveAttribute(
      "data-arrangement",
      DashboardBoardArrangement.Stacked,
    );
    expect(drawnOrder()).toEqual([
      "title",
      "cpu",
      "requests",
      "latency",
      "errors",
    ]);
  });

  test("each widget is the board's width, in the flow of the page, not placed on a grid", () => {
    renderAt(OUTER);

    for (const key of Object.keys(ID)) {
      const element: HTMLElement = wrapper(key);

      expect(element.style.position).toBe("relative");
      expect(element.style.width).toBe("100%");
      expect(element.style.transform).toBe("");
      expect(sizeGiven(key).width).toBe(WIDTH);
    }
  });

  test("each is as tall as on the narrowest grid, and the chart tall enough for its plot", () => {
    renderAt(OUTER);

    expect(sizeGiven("title").height).toBe(70);
    expect(sizeGiven("latency").height).toBe(70);
    expect(sizeGiven("cpu").height).toBe(230);
    expect(sizeGiven("requests").height).toBe(400);
    expect(wrapper("requests").style.height).toBe("400px");
    expect(wrapper("cpu").style.height).toBe("230px");
  });

  test("the widgets stack with the grid's gap between them, and the board does not scroll", () => {
    renderAt(OUTER);

    const positioner: HTMLElement = wrapper("title").parentElement!;

    expect(positioner.style.display).toBe("flex");
    expect(positioner.style.flexDirection).toBe("column");
    expect(positioner.style.gap).toBe("10px");
    expect(positioner.style.height).toBe("");
    expect(positioner.style.width).toBe("100%");
    expect(board().className).not.toContain("overflow-x-auto");
  });
});

describe("a narrower board: the grid, its columns narrower and its rows 70px", () => {
  // 1024px beside the side menu: about 600px for the board.
  const OUTER: number = 616;
  const WIDTH: number = OUTER - 2 * BOARD_PADDING;
  const COLUMN: number = (WIDTH - 110) / 12;

  test("the widgets keep the author's arrangement, columns sharing the board's width", () => {
    renderAt(OUTER);

    expect(board()).toHaveAttribute(
      "data-arrangement",
      DashboardBoardArrangement.Grid,
    );

    const chart: HTMLElement = wrapper("requests");

    expect(chart.style.position).toBe("absolute");
    expect(chart.style.transform).toBe(
      `translate(${3 * (COLUMN + 10)}px, ${1 * 80}px)`,
    );
    expect(sizeGiven("requests").width).toBeCloseTo(9 * COLUMN + 80, 6);
    expect(sizeGiven("requests").height).toBe(230);
    expect(sizeGiven("title").width).toBeCloseTo(WIDTH, 6);
  });

  test("the grid is as tall as its rows of 70px, and nothing scrolls sideways", () => {
    renderAt(OUTER);

    const positioner: HTMLElement = wrapper("title").parentElement!;

    expect(positioner.style.height).toBe(`${5 * 70 + 4 * 10}px`);
    expect(positioner.style.width).toBe("100%");
    expect(positioner.style.display).toBe("");
    expect(board().className).not.toContain("overflow-x-auto");
  });
});

describe("a wide board: the square grid it always was", () => {
  const OUTER: number = 1216;
  const WIDTH: number = OUTER - 2 * BOARD_PADDING;
  const UNIT: number = (WIDTH - 110) / 12;

  test("units are as tall as they are wide", () => {
    renderAt(OUTER);

    expect(board()).toHaveAttribute(
      "data-arrangement",
      DashboardBoardArrangement.Grid,
    );
    expect(sizeGiven("cpu").width).toBeCloseTo(3 * UNIT + 20, 6);
    expect(sizeGiven("cpu").height).toBeCloseTo(3 * UNIT + 20, 6);
    expect(wrapper("errors").style.transform).toBe(
      `translate(${3 * (UNIT + 10)}px, ${4 * (UNIT + 10)}px)`,
    );
  });
});

describe("the board follows its width as it changes", () => {
  test("turning a phone on its side and back restacks the same widgets, never mounting them again", () => {
    renderAt(374);

    expect(board()).toHaveAttribute(
      "data-arrangement",
      DashboardBoardArrangement.Stacked,
    );

    resizeTo(816);

    expect(board()).toHaveAttribute(
      "data-arrangement",
      DashboardBoardArrangement.Grid,
    );
    expect(wrapper("requests").style.position).toBe("absolute");

    resizeTo(374);

    expect(board()).toHaveAttribute(
      "data-arrangement",
      DashboardBoardArrangement.Stacked,
    );
    expect(drawnOrder()).toEqual([
      "title",
      "cpu",
      "requests",
      "latency",
      "errors",
    ]);

    // One mount each: their data is not read again for a new arrangement.
    for (const key of Object.keys(ID)) {
      expect(mounts[ID[key]!]).toBe(1);
    }
  });

  test("a board not measured yet is drawn as the grid, as it was before it was measured", () => {
    renderAt(0);

    expect(board()).toHaveAttribute(
      "data-arrangement",
      DashboardBoardArrangement.Grid,
    );
  });
});

describe("editing on a phone: the grid, scrolled sideways", () => {
  test("the grid keeps 500px and the board scrolls it, padding included", () => {
    renderAt(374, true);

    expect(board()).toHaveAttribute(
      "data-arrangement",
      DashboardBoardArrangement.Grid,
    );
    expect(board().className).toContain("overflow-x-auto");

    const positioner: HTMLElement = wrapper("title").parentElement!;

    expect(positioner.style.width).toBe("500px");
    expect(positioner.parentElement!.style.width).toBe(
      `${500 + 2 * BOARD_PADDING}px`,
    );
    expect(sizeGiven("title").width).toBeCloseTo(500, 6);
  });

  test("on a board 500px or wider, editing is laid out as viewing is, and nothing scrolls", () => {
    renderAt(616, true);

    expect(board().className).not.toContain("overflow-x-auto");
    expect(wrapper("title").parentElement!.style.width).toBe("100%");
  });

  test("the edit grid's dots are spaced by the column's and the row's own pitch", () => {
    renderAt(616, true);

    const column: number = (600 - 110) / 12;
    const positioner: HTMLElement = wrapper("title").parentElement!;

    expect(positioner.style.backgroundSize).toBe(
      `${column + 10}px ${70 + 10}px`,
    );
  });
});
