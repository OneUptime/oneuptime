import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DASHBOARD_LINKED_WIDGET_MISSING,
  DASHBOARD_WIDGET_LANDED_ATTRIBUTE,
  DASHBOARD_WIDGET_LANDED_IN_MS,
  getDashboardWidgetLandingBlock,
  getStickyHeaderHeightInPx,
  landOnDashboardWidget,
} from "../../../UI/Utils/DashboardWidgetLanding";
import {
  PAGE_ANCHOR_FOCUSED_ATTRIBUTE,
  PAGE_ANCHOR_SETTLE_IN_MS,
} from "../../../UI/Utils/PageAnchor";

/*
 * A DASHBOARD OPENED AT ONE OF ITS WIDGETS (#10084): the page lands on the
 * widget a link names (UI/Utils/DashboardWidgetLanding) the way a link
 * lands on a place on a page (PageAnchor).
 *
 * Pinned here:
 *   - where it lands: its middle in the middle of the window, or its top
 *     under the sticky header when it is taller than the room under it;
 *   - brought into view once the browser draws a frame, instantly, and
 *     again as the page settles, until the person scrolls or clicks;
 *   - outlined for a moment, and the mark gone after it - or at once, when
 *     whoever landed on it stops;
 *   - the keyboard's focus given to it when nothing else holds it, never
 *     taken from a field the person is typing in;
 *   - Styles/Theme.css draws the mark: a ring that follows the card's
 *     corners and fades, held still for a reader who asks for less motion,
 *     in the dark theme's indigo too, under the sticky header when it
 *     lands at its top.
 */

let frames: Map<number, FrameRequestCallback> = new Map();
let nextFrame: number = 1;

function drawFrames(): void {
  const drawn: Array<FrameRequestCallback> = Array.from(frames.values());
  frames = new Map();

  for (const callback of drawn) {
    callback(0);
  }
}

class FakeResizeObserver {
  public static instances: Array<FakeResizeObserver> = [];

  private callback: () => void;

  public constructor(callback: () => void) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  public observe(): void {
    // Every page change is told by resize().
  }

  public unobserve(): void {
    // Nothing is observed one by one here.
  }

  public disconnect(): void {
    FakeResizeObserver.instances = FakeResizeObserver.instances.filter(
      (instance: FakeResizeObserver): boolean => {
        return instance !== this;
      },
    );
  }

  public resize(): void {
    this.callback();
  }
}

type GlobalSlots = Record<string, unknown>;

const globalSlots: GlobalSlots = globalThis as unknown as GlobalSlots;
const windowSlots: GlobalSlots = window as unknown as GlobalSlots;

let originals: Record<string, unknown> = {};
let scrolls: Array<{ element: Element; options: unknown }> = [];

// A widget's box on the board, of a height.
function widgetBox(heightInPx: number = 300): HTMLElement {
  const element: HTMLElement = document.createElement("div");

  element.id = "dashboard-component-0192f1a0-0000-7000-8000-0000000e9421";
  element.setAttribute("data-dashboard-widget-box", "true");
  (element as unknown as GlobalSlots)["scrollIntoView"] = (
    options: unknown,
  ): void => {
    scrolls.push({ element, options });
  };
  element.getBoundingClientRect = (): DOMRect => {
    return { height: heightInPx, width: 400, top: 0, left: 0 } as DOMRect;
  };
  document.body.appendChild(element);

  return element;
}

beforeEach(() => {
  originals = {
    requestAnimationFrame: windowSlots["requestAnimationFrame"],
    cancelAnimationFrame: windowSlots["cancelAnimationFrame"],
    ResizeObserver: globalSlots["ResizeObserver"],
    innerHeight: window.innerHeight,
  };

  jest.useFakeTimers();

  frames = new Map();
  nextFrame = 1;
  scrolls = [];
  FakeResizeObserver.instances = [];

  windowSlots["requestAnimationFrame"] = (
    callback: FrameRequestCallback,
  ): number => {
    const id: number = nextFrame++;
    frames.set(id, callback);
    return id;
  };
  windowSlots["cancelAnimationFrame"] = (id: number): void => {
    frames.delete(id);
  };
  globalSlots["ResizeObserver"] = FakeResizeObserver;
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 900,
  });
});

afterEach(() => {
  jest.useRealTimers();

  windowSlots["requestAnimationFrame"] = originals["requestAnimationFrame"];
  windowSlots["cancelAnimationFrame"] = originals["cancelAnimationFrame"];

  if (originals["ResizeObserver"] === undefined) {
    delete globalSlots["ResizeObserver"];
  } else {
    globalSlots["ResizeObserver"] = originals["ResizeObserver"];
  }

  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: originals["innerHeight"],
  });
  document.documentElement.style.removeProperty("--app-header-height");
  document.body.innerHTML = "";
});

describe("where a widget lands", () => {
  test("its middle in the middle of the window, with the widgets around it in sight", () => {
    expect(
      getDashboardWidgetLandingBlock({
        widgetHeightInPx: 300,
        windowHeightInPx: 900,
        headerHeightInPx: 64,
      }),
    ).toBe("center");
    // Exactly the room under the header still fits.
    expect(
      getDashboardWidgetLandingBlock({
        widgetHeightInPx: 836,
        windowHeightInPx: 900,
        headerHeightInPx: 64,
      }),
    ).toBe("center");
  });

  test("its top under the header when it is taller than the room there, so its title is in sight", () => {
    expect(
      getDashboardWidgetLandingBlock({
        widgetHeightInPx: 837,
        windowHeightInPx: 900,
        headerHeightInPx: 64,
      }),
    ).toBe("start");
    // A public dashboard: nothing sticks above it.
    expect(
      getDashboardWidgetLandingBlock({
        widgetHeightInPx: 1200,
        windowHeightInPx: 900,
        headerHeightInPx: 0,
      }),
    ).toBe("start");
    // A window with no room to speak of: its middle, as the browser can.
    expect(
      getDashboardWidgetLandingBlock({
        widgetHeightInPx: 300,
        windowHeightInPx: 0,
        headerHeightInPx: 64,
      }),
    ).toBe("center");
  });

  test("the sticky header's height is the one MasterPage publishes, and none where there is none", () => {
    expect(getStickyHeaderHeightInPx()).toBe(0);

    document.documentElement.style.setProperty("--app-header-height", "64px");
    expect(getStickyHeaderHeightInPx()).toBe(64);

    document.documentElement.style.setProperty("--app-header-height", "auto");
    expect(getStickyHeaderHeightInPx()).toBe(0);
  });
});

describe("landing on a widget", () => {
  test("is brought into view once a frame is drawn, instantly, in the middle of the window", () => {
    const box: HTMLElement = widgetBox(300);

    landOnDashboardWidget(box);

    expect(scrolls).toHaveLength(0);
    drawFrames();
    expect(scrolls).toEqual([{ element: box, options: { block: "center" } }]);
  });

  test("a widget taller than the window lands at its top, under the header", () => {
    document.documentElement.style.setProperty("--app-header-height", "64px");

    const box: HTMLElement = widgetBox(1000);

    landOnDashboardWidget(box);
    drawFrames();

    expect(scrolls).toEqual([{ element: box, options: { block: "start" } }]);
  });

  test("is kept in view while the page settles, then left where the person puts it", () => {
    const box: HTMLElement = widgetBox();

    landOnDashboardWidget(box);
    drawFrames();

    // The toolbar above the board settles: the widget is brought back.
    FakeResizeObserver.instances[0]!.resize();
    drawFrames();
    expect(scrolls).toHaveLength(2);

    // The person scrolls: from then on the page is theirs.
    window.dispatchEvent(new Event("wheel"));
    expect(FakeResizeObserver.instances).toHaveLength(0);
    expect(scrolls).toHaveLength(2);
  });

  test("is outlined for a moment, then not", () => {
    const box: HTMLElement = widgetBox();

    landOnDashboardWidget(box);

    expect(box.getAttribute(DASHBOARD_WIDGET_LANDED_ATTRIBUTE)).toBe("true");

    jest.advanceTimersByTime(DASHBOARD_WIDGET_LANDED_IN_MS - 1);
    expect(box.hasAttribute(DASHBOARD_WIDGET_LANDED_ATTRIBUTE)).toBe(true);

    jest.advanceTimersByTime(1);
    expect(box.hasAttribute(DASHBOARD_WIDGET_LANDED_ATTRIBUTE)).toBe(false);
    // Longer than the page is kept in view: the eye finds it after it settles.
    expect(DASHBOARD_WIDGET_LANDED_IN_MS).toBeGreaterThan(
      PAGE_ANCHOR_SETTLE_IN_MS,
    );
  });

  test("stopped, it is unmarked and left at once: a board that goes away", () => {
    const box: HTMLElement = widgetBox();
    const stop: () => void = landOnDashboardWidget(box);

    stop();
    drawFrames();

    expect(box.hasAttribute(DASHBOARD_WIDGET_LANDED_ATTRIBUTE)).toBe(false);
    expect(scrolls).toHaveLength(0);
    expect(FakeResizeObserver.instances).toHaveLength(0);
  });

  test("takes the keyboard's focus when nothing else holds it, and gives back the tabindex it took", () => {
    const box: HTMLElement = widgetBox();
    const after: HTMLButtonElement = document.createElement("button");

    document.body.appendChild(after);
    landOnDashboardWidget(box);

    expect(document.activeElement).toBe(box);
    expect(box.getAttribute("tabindex")).toBe("-1");
    expect(box.getAttribute(PAGE_ANCHOR_FOCUSED_ATTRIBUTE)).toBe("true");

    // Tab goes on from it.
    after.focus();
    expect(box.hasAttribute("tabindex")).toBe(false);
    expect(box.hasAttribute(PAGE_ANCHOR_FOCUSED_ATTRIBUTE)).toBe(false);
  });

  test("never takes the focus from a field the person is typing in", () => {
    const field: HTMLInputElement = document.createElement("input");

    document.body.appendChild(field);
    field.focus();

    const box: HTMLElement = widgetBox();

    landOnDashboardWidget(box);

    expect(document.activeElement).toBe(field);
    expect(box.hasAttribute("tabindex")).toBe(false);
    // Still outlined: the eye finds it all the same.
    expect(box.getAttribute(DASHBOARD_WIDGET_LANDED_ATTRIBUTE)).toBe("true");
  });

  test("says why a board opens at its top when the widget is gone", () => {
    expect(DASHBOARD_LINKED_WIDGET_MISSING).toBe(
      "The widget this link points to is no longer on this dashboard.",
    );
  });
});

describe("how Theme.css draws the mark", () => {
  const css: string = fs.readFileSync(
    path.resolve(__dirname, "../../../UI/Styles/Theme.css"),
    "utf8",
  );
  const rule: (selector: string) => string = (selector: string): string => {
    const start: number = css.indexOf(`${selector} {`);

    expect(start).toBeGreaterThan(-1);

    return css.slice(start, css.indexOf("}", start) + 1);
  };

  test("a ring round the card's corners, inside the board's gap, under the sticky header", () => {
    const landed: string = rule(`[${DASHBOARD_WIDGET_LANDED_ATTRIBUTE}]`);

    expect(landed).toContain("border-radius: 0.75rem");
    expect(landed).toMatch(
      /outline: 3px solid var\(--ou-dashboard-widget-landed-ring\)/,
    );
    expect(landed).toContain("outline-offset: 2px");
    // 3px + 2px reaches 5px past the card: the board keeps 10px between two.
    expect(landed).toContain(
      "scroll-margin-top: calc(var(--app-header-height, 0px) + 1.5rem)",
    );
    expect(rule(`html.dark [${DASHBOARD_WIDGET_LANDED_ATTRIBUTE}]`)).toContain(
      "--ou-dashboard-widget-landed-ring: #818cf8",
    );
  });

  test("it fades only for a reader who has not asked for less motion, over the time the mark lasts", () => {
    const motion: number = css.indexOf(
      "@media (prefers-reduced-motion: no-preference) {\n  [data-dashboard-widget-landed]",
    );

    expect(motion).toBeGreaterThan(-1);
    expect(css.slice(motion, css.indexOf("}\n}", motion))).toContain(
      `animation: ou-dashboard-widget-landed ${DASHBOARD_WIDGET_LANDED_IN_MS / 1000}s ease-out forwards`,
    );
    // No rule takes the ring away for less motion: it is held, still, until the mark goes.
    expect(css).not.toMatch(
      /prefers-reduced-motion: reduce\) \{\s*\[data-dashboard-widget-landed\]\s*\{[^}]*outline: none/,
    );
  });

  test("a widget focused by its landing is ringed the same way for a keyboard reader", () => {
    expect(
      rule(
        "[data-dashboard-widget-box][data-page-anchor-focused]:focus-visible",
      ),
    ).toContain("outline: 3px solid #6366f1");
  });
});
