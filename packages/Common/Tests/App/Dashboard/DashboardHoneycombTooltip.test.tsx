import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock } from "jest-mock";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  waitFor,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import DashboardMonitorListComponentElement, {
  ComponentProps as MonitorListProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardMonitorListComponent";
import DashboardResourceHoneycomb, {
  getHoneycombTooltipContainer,
  HONEYCOMB_TILE_TEST_ID,
  HONEYCOMB_TOOLTIP_TEST_ID,
  HoneycombTile,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardResourceHoneycomb";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import { setPublicDashboardContext } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import { Gray500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import DashboardMonitorListComponentUtil from "../../../Utils/Dashboard/Components/DashboardMonitorListComponent";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * A HONEYCOMB TILE'S TOOLTIP, ON A DASHBOARD (issue #6966).
 *
 * A list widget drawn as a honeycomb says what a tile is only in the tooltip
 * under the pointer: its name, its status and its details. Since #6953 a
 * monitor whose monitoring is off is a gray tile, and the Monitor List's
 * honeycomb has no legend, so the tooltip is the only place that says gray
 * means Disabled.
 *
 * The tooltip is position:fixed, at the tile's viewport coordinates. Every
 * widget's card on a board is overflow-hidden and transformed
 * (DashboardBaseComponent: scale(1) when still), and a transform makes the
 * card the containing block of a fixed descendant - so a tooltip drawn
 * inside the card was placed against the card and cut off by it: nobody
 * saw it. It is drawn outside the card: on the page's body, or on the
 * full-screen element while the board is in full screen (the browser then
 * draws nothing outside that element).
 *
 * Drawn here through the real Monitor List widget, in a card shaped like the
 * board's, with ModelAPI stubbed to hand over the monitors. jsdom has no
 * layout, so what is held is where the tooltip is in the document - the
 * thing the browser's clipping follows - and what it says.
 */

type ListRequest = {
  query: JSONObject;
  limit: number;
  skip: number;
  select: JSONObject;
  sort: JSONObject;
};

type ListResponse = { data: Array<Monitor>; count: number };

const listMock: Mock<(request: ListRequest) => Promise<ListResponse>> =
  jest.fn<(request: ListRequest) => Promise<ListResponse>>();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (request: ListRequest) => {
        return listMock(request);
      },
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return PROJECT_ID;
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyErrorMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: { children: React.ReactNode }) => {
        return <span>{props.children}</span>;
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap", () => {
  return {
    __esModule: true,
    default: {},
    RouteUtil: {
      populateRouteParams: () => {
        return {
          toString: () => {
            return "/dashboard/monitors/view";
          },
        };
      },
    },
  };
});

const RED: string = "#ef4444";
const GREEN: string = "#10b981";

// A widget that draws through one of the two list bases.
const LIST_BASE_PATTERN: RegExp = /<Dashboard(Model)?ResourceListBase\b/;

// A fixed layer, drawn by a class name or by a style.
const FIXED_CLASS_PATTERN: RegExp = /className=["{`][^"}`]*\bfixed\b/;
const FIXED_STYLE_PATTERN: RegExp = /position:\s*["']fixed["']/;

const dashboardViewConfig: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 12,
};

function honeycombProps(): MonitorListProps {
  const component: MonitorListProps["component"] =
    DashboardMonitorListComponentUtil.getDefaultComponent();
  component.arguments = {
    title: "Monitors",
    maxRows: 25,
    viewMode: "honeycomb",
  } as MonitorListProps["component"]["arguments"];

  const base: Omit<DashboardBaseComponentProps, "componentId"> & {
    componentId: ObjectID;
  } = {
    componentId: component.componentId,
    key: component.componentId.toString(),
    isEditMode: false,
    isSelected: false,
    onComponentUpdate: () => {},
    totalCurrentDashboardWidthInPx: 1280,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1280,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 320,
    dashboardComponentWidthInPx: 480,
    dashboardViewConfig,
    dashboardStartAndEndDate: { range: TimeRange.PAST_ONE_HOUR },
    metricTypes: [],
    refreshTick: 0,
    variables: [],
    dashboardId: "d0000000-0000-4000-8000-000000000066",
  };

  return { ...base, component };
}

function monitor(data: {
  name: string;
  status: string;
  color: string;
  monitorType: MonitorType;
  disableActiveMonitoring: boolean;
}): Monitor {
  const value: Monitor = new Monitor();
  value._id = ObjectID.generate().toString();
  value.name = data.name;
  value.monitorType = data.monitorType;
  value.disableActiveMonitoring = data.disableActiveMonitoring;

  const status: MonitorStatus = new MonitorStatus();
  status.name = data.status;
  status.color = Color.fromString(data.color);
  value.currentMonitorStatus = status;

  return value;
}

/*
 * The board from the issue: an Offline monitor whose monitoring is turned
 * off - a gray tile - beside two that are checked.
 */
const MONITORS: Array<Monitor> = [
  monitor({
    name: "checkout",
    status: "Offline",
    color: RED,
    monitorType: MonitorType.Website,
    disableActiveMonitoring: true,
  }),
  monitor({
    name: "search",
    status: "Offline",
    color: RED,
    monitorType: MonitorType.Ping,
    disableActiveMonitoring: false,
  }),
  monitor({
    name: "api",
    status: "Operational",
    color: GREEN,
    monitorType: MonitorType.API,
    disableActiveMonitoring: false,
  }),
];

const CARD_TEST_ID: string = "widget-card";

/*
 * A widget's card as the board draws it (DashboardBaseComponent): it clips
 * what overflows it, and it is transformed - scale(1) when still - which
 * makes it the containing block of a fixed descendant.
 */
function InCard(props: { children: React.ReactNode }): ReactElement {
  return (
    <div
      data-testid={CARD_TEST_ID}
      className="overflow-hidden"
      style={{ transform: "scale(1)", overflow: "hidden" }}
    >
      {props.children}
    </div>
  );
}

function card(): HTMLElement {
  return document.querySelector(
    `[data-testid="${CARD_TEST_ID}"]`,
  ) as HTMLElement;
}

function tiles(): Array<HTMLElement> {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      `[data-testid="${HONEYCOMB_TILE_TEST_ID}"]`,
    ),
  );
}

function openTooltips(): Array<HTMLElement> {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      `[data-testid="${HONEYCOMB_TOOLTIP_TEST_ID}"]`,
    ),
  );
}

function openTooltip(): HTMLElement {
  const tooltips: Array<HTMLElement> = openTooltips();
  expect(tooltips).toHaveLength(1);
  return tooltips[0]!;
}

// The value beside a label in the tooltip's rows ("Status", "Type").
function valueBeside(tooltip: HTMLElement, label: string): string {
  const labelElement: HTMLElement = within(tooltip).getByText(label);
  return labelElement.nextElementSibling?.textContent || "";
}

function toRgb(hex: string): string {
  const value: number = parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}

async function drawBoard(wrap?: (node: ReactElement) => ReactElement): Promise<{
  rendered: RenderResult;
}> {
  const widget: ReactElement = (
    <InCard>
      <DashboardMonitorListComponentElement {...honeycombProps()} />
    </InCard>
  );

  const rendered: RenderResult = render(wrap ? wrap(widget) : widget);

  await waitFor(() => {
    expect(tiles()).toHaveLength(MONITORS.length);
  });

  return { rendered };
}

// The honeycomb watches its width; jsdom has no layout to report.
class StillResizeObserver {
  public observe(): void {
    return;
  }

  public unobserve(): void {
    return;
  }

  public disconnect(): void {
    return;
  }
}

let originalResizeObserver: PropertyDescriptor | undefined;
let fullscreenElement: Element | null = null;

/*
 * jsdom has no Fullscreen API: document.fullscreenElement is what the
 * browser reports while an element is in full screen, so the test sets it.
 */
function enterFullscreen(element: Element): void {
  fullscreenElement = element;
  act(() => {
    document.dispatchEvent(new Event("fullscreenchange"));
  });
}

function leaveFullscreen(): void {
  fullscreenElement = null;
  act(() => {
    document.dispatchEvent(new Event("fullscreenchange"));
  });
}

beforeEach(() => {
  listMock.mockReset();
  listMock.mockResolvedValue({ data: MONITORS, count: MONITORS.length });
  window.localStorage.clear();
  setPublicDashboardContext(null);

  originalResizeObserver = Object.getOwnPropertyDescriptor(
    window,
    "ResizeObserver",
  );
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: StillResizeObserver,
  });

  fullscreenElement = null;
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: (): Element | null => {
      return fullscreenElement;
    },
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  setPublicDashboardContext(null);

  if (originalResizeObserver) {
    Object.defineProperty(window, "ResizeObserver", originalResizeObserver);
  } else {
    delete (window as unknown as { ResizeObserver?: unknown }).ResizeObserver;
  }

  fullscreenElement = null;
  delete (document as unknown as { fullscreenElement?: unknown })
    .fullscreenElement;

  // A full-screen element a test appended by hand.
  document.body.innerHTML = "";
});

describe("the tooltip is drawn outside the widget's card", () => {
  test("pointing at the gray tile draws its tooltip on the page's body, not in the card that would cut it off", async () => {
    await drawBoard();

    // The monitor whose monitoring is off: the gray tile, first in list order.
    expect(tiles()[0]!.style.backgroundColor).toBe(toRgb(Gray500.toString()));
    expect(openTooltips()).toHaveLength(0);

    fireEvent.mouseEnter(tiles()[0]!);

    const tooltip: HTMLElement = openTooltip();
    expect(tooltip.parentElement).toBe(document.body);
    expect(card().contains(tooltip)).toBe(false);
    // Still a layer nothing under the pointer reaches, over the widgets.
    expect(tooltip).toHaveClass("fixed", "z-50", "pointer-events-none");
    expect(tooltip).toHaveAttribute("role", "tooltip");
  });

  test("it says what the gray tile is: its name, Disabled, its details and that it opens", async () => {
    await drawBoard();

    fireEvent.mouseEnter(tiles()[0]!);

    const tooltip: HTMLElement = openTooltip();
    expect(within(tooltip).getByText("checkout")).toBeInTheDocument();
    expect(valueBeside(tooltip, "Status")).toBe("Disabled");
    expect(valueBeside(tooltip, "Type")).toBe(MonitorType.Website);
    expect(within(tooltip).getByText("Click to open")).toBeInTheDocument();
    // The status its last check left is not what it says.
    expect(tooltip).not.toHaveTextContent("Offline");
    // Its dot is the tile's gray.
    expect(
      (tooltip.querySelector("span.rounded-full") as HTMLElement).style
        .backgroundColor,
    ).toBe(toRgb(Gray500.toString()));
  });

  test("a checked monitor's tile says its own status, beside the gray one", async () => {
    await drawBoard();

    fireEvent.mouseEnter(tiles()[1]!);
    let tooltip: HTMLElement = openTooltip();
    expect(within(tooltip).getByText("search")).toBeInTheDocument();
    expect(valueBeside(tooltip, "Status")).toBe("Offline");
    expect(valueBeside(tooltip, "Type")).toBe(MonitorType.Ping);
    fireEvent.mouseLeave(tiles()[1]!);

    fireEvent.mouseEnter(tiles()[2]!);
    tooltip = openTooltip();
    expect(within(tooltip).getByText("api")).toBeInTheDocument();
    expect(valueBeside(tooltip, "Status")).toBe("Operational");
    expect(valueBeside(tooltip, "Type")).toBe(MonitorType.API);
    expect(tooltip.parentElement).toBe(document.body);
  });

  test("one tooltip at a time, gone when the pointer leaves the tile", async () => {
    await drawBoard();

    fireEvent.mouseEnter(tiles()[0]!);
    fireEvent.mouseLeave(tiles()[0]!);
    expect(openTooltips()).toHaveLength(0);

    fireEvent.mouseEnter(tiles()[1]!);
    fireEvent.mouseEnter(tiles()[2]!);
    expect(openTooltips()).toHaveLength(1);
    expect(within(openTooltip()).getByText("api")).toBeInTheDocument();
  });

  test("taking the widget off the board takes its open tooltip with it", async () => {
    const { rendered } = await drawBoard();

    fireEvent.mouseEnter(tiles()[0]!);
    expect(openTooltips()).toHaveLength(1);

    rendered.unmount();

    expect(openTooltips()).toHaveLength(0);
  });

  /*
   * Viewport coordinates are what the tooltip is placed by, and they hold
   * only outside a transformed card: the tile's place in the window, the
   * tooltip centred over it, kept inside the window, and under the tile
   * when there is no room above it.
   */
  test.each([
    {
      where: "in the middle of the window",
      rect: { left: 600, top: 300, width: 40, height: 46 },
      expected: { left: 500, top: 192 },
    },
    {
      where: "at the window's right edge",
      rect: { left: 1000, top: 300, width: 40, height: 46 },
      // 1024 wide, 240 across, 8 from the edge.
      expected: { left: 776, top: 192 },
    },
    {
      where: "at the window's left edge",
      rect: { left: 0, top: 300, width: 40, height: 46 },
      expected: { left: 8, top: 192 },
    },
    {
      where: "with no room above it",
      rect: { left: 600, top: 40, width: 40, height: 46 },
      // Below the tile: 40 + 46 + 8.
      expected: { left: 500, top: 94 },
    },
  ])(
    "a tile $where: the tooltip sits where the tile is in the window",
    async ({
      rect,
      expected,
    }: {
      rect: { left: number; top: number; width: number; height: number };
      expected: { left: number; top: number };
    }) => {
      await drawBoard();

      const tile: HTMLElement = tiles()[0]!;
      jest.spyOn(tile, "getBoundingClientRect").mockReturnValue({
        ...rect,
        x: rect.left,
        y: rect.top,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        toJSON: (): JSONObject => {
          return {};
        },
      } as DOMRect);

      expect(window.innerWidth).toBe(1024);

      fireEvent.mouseEnter(tile);

      const tooltip: HTMLElement = openTooltip();
      expect(tooltip.style.left).toBe(`${expected.left}px`);
      expect(tooltip.style.top).toBe(`${expected.top}px`);
      expect(tooltip.style.width).toBe("240px");
    },
  );
});

describe("while the board is in full screen", () => {
  /*
   * DashboardView puts its canvas in full screen with requestFullscreen,
   * and the browser then draws only that element's subtree: a tooltip on
   * the body would be in the document and drawn nowhere.
   */
  test("the tooltip is drawn on the full-screen element, still outside the card", async () => {
    const canvas: HTMLDivElement = document.createElement("div");
    canvas.setAttribute("data-testid", "dashboard-canvas");
    document.body.appendChild(canvas);

    render(
      <InCard>
        <DashboardMonitorListComponentElement {...honeycombProps()} />
      </InCard>,
      { container: canvas },
    );
    await waitFor(() => {
      expect(tiles()).toHaveLength(MONITORS.length);
    });

    enterFullscreen(canvas);

    fireEvent.mouseEnter(tiles()[0]!);

    const tooltip: HTMLElement = openTooltip();
    expect(tooltip.parentElement).toBe(canvas);
    expect(card().contains(tooltip)).toBe(false);
    expect(valueBeside(tooltip, "Status")).toBe("Disabled");
  });

  test("entering full screen closes an open tooltip; the next one is drawn on the full-screen element", async () => {
    const canvas: HTMLDivElement = document.createElement("div");
    document.body.appendChild(canvas);

    render(
      <InCard>
        <DashboardMonitorListComponentElement {...honeycombProps()} />
      </InCard>,
      { container: canvas },
    );
    await waitFor(() => {
      expect(tiles()).toHaveLength(MONITORS.length);
    });

    fireEvent.mouseEnter(tiles()[0]!);
    expect(openTooltip().parentElement).toBe(document.body);

    enterFullscreen(canvas);

    // The tooltip on the body would not be drawn in full screen: it closed.
    expect(openTooltips()).toHaveLength(0);

    fireEvent.mouseEnter(tiles()[0]!);
    expect(openTooltip().parentElement).toBe(canvas);
  });

  test("leaving full screen closes it too, and the next one is on the body again", async () => {
    const canvas: HTMLDivElement = document.createElement("div");
    document.body.appendChild(canvas);

    render(
      <InCard>
        <DashboardMonitorListComponentElement {...honeycombProps()} />
      </InCard>,
      { container: canvas },
    );
    await waitFor(() => {
      expect(tiles()).toHaveLength(MONITORS.length);
    });

    enterFullscreen(canvas);
    fireEvent.mouseEnter(tiles()[0]!);
    expect(openTooltip().parentElement).toBe(canvas);

    leaveFullscreen();
    expect(openTooltips()).toHaveLength(0);

    fireEvent.mouseEnter(tiles()[0]!);
    expect(openTooltip().parentElement).toBe(document.body);
  });

  test("a honeycomb taken off the board stops listening for full screen", async () => {
    const addSpy: jest.SpiedFunction<typeof document.addEventListener> =
      jest.spyOn(document, "addEventListener");
    const removeSpy: jest.SpiedFunction<typeof document.removeEventListener> =
      jest.spyOn(document, "removeEventListener");

    function fullscreenListeners(
      spy:
        | jest.SpiedFunction<typeof document.addEventListener>
        | jest.SpiedFunction<typeof document.removeEventListener>,
    ): Array<unknown> {
      return spy.mock.calls
        .filter((call: Array<unknown>): boolean => {
          return call[0] === "fullscreenchange";
        })
        .map((call: Array<unknown>): unknown => {
          return call[1];
        });
    }

    try {
      const { rendered } = await drawBoard();

      // The honeycomb's effects run once its tiles are in the document.
      await waitFor(() => {
        expect(fullscreenListeners(addSpy)).toHaveLength(1);
      });
      expect(fullscreenListeners(removeSpy)).toHaveLength(0);

      rendered.unmount();

      // The very listener it added, and no other.
      expect(fullscreenListeners(removeSpy)).toEqual(
        fullscreenListeners(addSpy),
      );
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });
});

describe("getHoneycombTooltipContainer", () => {
  test("the page's body when nothing is in full screen", () => {
    expect(getHoneycombTooltipContainer()).toBe(document.body);
  });

  test("the full-screen element when there is one", () => {
    const canvas: HTMLDivElement = document.createElement("div");
    document.body.appendChild(canvas);
    fullscreenElement = canvas;

    expect(getHoneycombTooltipContainer()).toBe(canvas);
  });

  // An SVG or MathML element in full screen is not where a div is drawn.
  test("the body when what is in full screen is not an HTML element", () => {
    fullscreenElement = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );

    expect(getHoneycombTooltipContainer()).toBe(document.body);
  });
});

describe("in the reader's language", () => {
  const instances: Record<string, i18n> = {};

  beforeAll(async () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const instance: i18n = createInstance();
      await instance.init({
        lng: language,
        resources: {
          [language]: {
            translation: readDashboardLocale(language),
          },
        },
        interpolation: { escapeValue: false },
        keySeparator: false,
        nsSeparator: false,
      });
      instances[language] = instance;
    }
  });

  function inLanguage(language: string): (node: ReactElement) => ReactElement {
    const wrapInLanguage: (node: ReactElement) => ReactElement = (
      node: ReactElement,
    ): ReactElement => {
      return (
        <I18nextProvider i18n={instances[language]!}>{node}</I18nextProvider>
      );
    };

    return wrapInLanguage;
  }

  test("on a German board the gray tile says Deaktiviert, and its labels are German", async () => {
    await drawBoard(inLanguage("de"));

    fireEvent.mouseEnter(tiles()[0]!);

    const tooltip: HTMLElement = openTooltip();
    expect(tooltip.parentElement).toBe(document.body);
    expect(within(tooltip).getByText("checkout")).toBeInTheDocument();
    expect(valueBeside(tooltip, "Status")).toBe("Deaktiviert");
    expect(valueBeside(tooltip, "Typ")).toBe(MonitorType.Website);
    expect(within(tooltip).getByText("Zum Öffnen klicken")).toBeInTheDocument();
    expect(tooltip).not.toHaveTextContent("Disabled");
    expect(tooltip).not.toHaveTextContent("Click to open");
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "in %s the gray tile's tooltip says the Dashboard's word for Disabled",
    async (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const disabled: string = words["Disabled"]!;
      const status: string = words["Status"] || "Status";

      expect(disabled).toBeTruthy();
      expect(disabled).not.toBe("Disabled");

      await drawBoard(inLanguage(language));

      fireEvent.mouseEnter(tiles()[0]!);

      const tooltip: HTMLElement = openTooltip();
      expect(tooltip.parentElement).toBe(document.body);
      expect(valueBeside(tooltip, status)).toBe(disabled);
    },
  );
});

/*
 * Every honeycomb on a board is this one component: the Monitor List, the
 * Incident and Alert Lists, the Kubernetes, Docker and Podman lists, the SLO
 * List and the rest go through DashboardResourceListBase or
 * DashboardModelResourceListBase, which draw DashboardResourceHoneycomb. So
 * the tooltip is outside the card for all of them - unless a widget draws a
 * fixed layer of its own inside its card, which would be cut off the same
 * way. None does.
 */
describe("one tooltip for every honeycomb on a board", () => {
  const DASHBOARD_SRC: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src",
  );

  function read(relativePath: string): string {
    return fs.readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8");
  }

  function widgetSources(): Array<{ file: string; source: string }> {
    const directory: string = path.join(
      DASHBOARD_SRC,
      "Components/Dashboard/Components",
    );

    return fs
      .readdirSync(directory)
      .filter((file: string): boolean => {
        return file.endsWith(".tsx");
      })
      .map((file: string): { file: string; source: string } => {
        return {
          file,
          source: fs.readFileSync(path.join(directory, file), "utf8"),
        };
      });
  }

  function sourcesUnder(directory: string): Array<{
    file: string;
    source: string;
  }> {
    const found: Array<{ file: string; source: string }> = [];

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        found.push(...sourcesUnder(full));
      } else if (entry.name.endsWith(".tsx")) {
        found.push({
          file: path.relative(DASHBOARD_SRC, full),
          source: fs.readFileSync(full, "utf8"),
        });
      }
    }

    return found;
  }

  test("DashboardResourceListBase is the one place a honeycomb is drawn, and the model list base draws through it", () => {
    const drawers: Array<string> = sourcesUnder(DASHBOARD_SRC)
      .filter(({ source }: { file: string; source: string }): boolean => {
        return source.includes("<DashboardResourceHoneycomb");
      })
      .map(({ file }: { file: string; source: string }): string => {
        return file;
      });

    expect(drawers).toEqual([
      path.join(
        "Components",
        "Dashboard",
        "Components",
        "DashboardResourceListBase.tsx",
      ),
    ]);

    expect(
      read("Components/Infrastructure/DashboardModelResourceListBase.tsx"),
    ).toContain("<DashboardResourceListBase");
  });

  test("every widget that hands over honeycomb tiles hands them to a list base", () => {
    const widgets: Array<{ file: string; source: string }> = sourcesUnder(
      DASHBOARD_SRC,
    ).filter(({ source }: { file: string; source: string }): boolean => {
      return source.includes("honeycombTiles={");
    });

    // The Monitor, Incident and Alert Lists, and the infrastructure lists.
    expect(widgets.length).toBeGreaterThan(10);

    for (const widget of widgets) {
      expect({
        file: widget.file,
        drawsThroughABase: LIST_BASE_PATTERN.test(widget.source),
      }).toEqual({ file: widget.file, drawsThroughABase: true });
    }
  });

  test("no widget draws a fixed layer inside its card but the honeycomb's portalled tooltip", () => {
    const withFixedLayer: Array<string> = widgetSources()
      .filter(({ source }: { file: string; source: string }): boolean => {
        return (
          FIXED_CLASS_PATTERN.test(source) || FIXED_STYLE_PATTERN.test(source)
        );
      })
      .map(({ file }: { file: string; source: string }): string => {
        return file;
      });

    expect(withFixedLayer).toEqual(["DashboardResourceHoneycomb.tsx"]);

    const honeycomb: string = read(
      "Components/Dashboard/Components/DashboardResourceHoneycomb.tsx",
    );
    expect(honeycomb).toContain("ReactDOM.createPortal(");
    expect(honeycomb).toContain("getHoneycombTooltipContainer(),");
  });

  test("a honeycomb drawn on its own, with no list around it, draws its tooltip outside its card too", () => {
    const TILES: Array<HoneycombTile> = [
      {
        id: "pod-1",
        status: "Running",
        color: GREEN,
        tooltip: {
          title: "checkout-api-7d9f8b6c4-x2x9z",
          details: [{ label: "Namespace", value: "payments" }],
        },
      },
    ];

    render(
      <InCard>
        <DashboardResourceHoneycomb tiles={TILES} />
      </InCard>,
    );

    fireEvent.mouseEnter(tiles()[0]!);

    const tooltip: HTMLElement = openTooltip();
    expect(tooltip.parentElement).toBe(document.body);
    expect(card().contains(tooltip)).toBe(false);
    expect(valueBeside(tooltip, "Namespace")).toBe("payments");
    // No page to open: nothing says it opens one.
    expect(within(tooltip).queryByText("Click to open")).toBeNull();
  });
});
