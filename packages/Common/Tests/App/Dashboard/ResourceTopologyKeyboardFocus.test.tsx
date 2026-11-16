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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { SpyInstance } from "jest-mock";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { CoordinateExtent, Node } from "reactflow";
import ResourceTopologyMap from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyMap";
import {
  RESOURCE_TOPOLOGY_MIN_ZOOM,
  RESOURCE_TOPOLOGY_PAN_MARGIN,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyCanvas";
import {
  getDrawingBounds,
  getTopAlignedViewport,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyFit";
import {
  ResourceTopologyGraph,
  ResourceTopologyNodeInput,
  buildResourceTopologyGraph,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyModel";
import {
  FOCUS_REVEAL_PADDING_PX,
  WINDOW_REFOCUS_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/FlowKeyboardFocus";
import {
  StandInViewport,
  canvasSize,
  constrainToExtent,
  currentViewport,
  flowDomNode,
  flowProps,
  moveView,
  pansMade,
  resetFlowStandIn,
  setViewportCalls,
  startViewAt,
} from "./ResourceTopologyFlowStandIn";

/*
 * THE KEYBOARD'S FOCUS STAYS IN VIEW ON A RESOURCE'S TOPOLOGY MAP (#6958).
 *
 * A resource's map - a vCenter, a cluster, a host - is a tree of parts, and
 * on a phone, zoomed in far enough to read, most of it is off the canvas.
 * Tab still reaches every part's buttons, and from a part the arrows move
 * through the tree. Each one the keyboard's focus goes to is brought into
 * view with a pan of React Flow's viewport - the least that shows it whole,
 * 24px inside the canvas, from whichever side it was off, within the pan
 * extent - never a scroll of React Flow's box, which would slide the map and
 * its zoom buttons off the canvas while React Flow thinks its view never
 * moved; a scroll the browser makes anyway is turned into the same pan.
 * Focus a pointer gives is left alone: the part is under the pointer. So is
 * focus the browser hands back as the window regains it.
 *
 * The map follows the focus with the piece the Service Map and the lineage
 * drawings use (useFlowKeyboardFocus), not a copy of its own: its copy had
 * no scroll listener, no window-refocus check and no page scroll.
 *
 * The map is the real one; React Flow is the stand-in of
 * ResourceTopologyFlowStandIn, whose panBy keeps the view inside the pan
 * extent as React Flow's does. jsdom lays nothing out, so where the canvas,
 * each part and the zoom buttons are on screen is said here (layOut), from
 * the view the stand-in shows; nor does it tell the keyboard's focus from a
 * pointer's, so the tests say how focus came (focusCameBy) and
 * :focus-visible answers from it, as a browser's does.
 */

jest.mock("reactflow", () => {
  return jest.requireActual("./ResourceTopologyFlowStandIn");
});

function part(
  id: string,
  parentId: string | null,
  overrides: Partial<ResourceTopologyNodeInput> = {},
): ResourceTopologyNodeInput {
  return {
    id: id,
    parentId: parentId,
    kind: overrides.kind || "vmware.vm",
    name: overrides.name || id,
    health: overrides.health || "healthy",
    ...overrides,
  };
}

/*
 * vcenter-prod
 *   Amsterdam (the only datacenter: open by itself)
 *     ams-prod (a cluster that needs attention, a critical host inside: open)
 *       esx-1 (critical, holds 2 virtual machines), esx-2 (holds 1)
 *     ams-dev (healthy: closed)
 *     ssd-1 ... ssd-3 (datastores: chips)
 *
 * Laid out, the resource is at the top left, the hosts two columns along
 * and the datastores at the bottom: wider and taller than a phone's canvas
 * at zoom 1.
 */
function vcenterGraph(): ResourceTopologyGraph {
  return buildResourceTopologyGraph({
    rootId: "vc",
    nodes: [
      part("vc", null, { kind: "vmware.vcenter", name: "vcenter-prod" }),
      part("ams", "vc", { kind: "vmware.datacenter", name: "Amsterdam" }),
      part("ams-prod", "ams", {
        kind: "vmware.cluster",
        name: "ams-prod",
        health: "warning",
        status: { text: "1 of 2 hosts effective" },
      }),
      part("esx-1", "ams-prod", {
        kind: "vmware.host",
        name: "esx-1",
        health: "critical",
        status: { text: "Not responding" },
      }),
      part("vm-1", "esx-1", { name: "web-01" }),
      part("vm-2", "esx-1", { name: "db-01" }),
      part("esx-2", "ams-prod", { kind: "vmware.host", name: "esx-2" }),
      part("vm-3", "esx-2", { name: "cache-01" }),
      part("ams-dev", "ams", { kind: "vmware.cluster", name: "ams-dev" }),
      part("esx-3", "ams-dev", { kind: "vmware.host", name: "esx-3" }),
      part("vm-4", "esx-3", { name: "build-01" }),
      part("ssd-1", "ams", { kind: "vmware.datastore", name: "ssd-1" }),
      part("ssd-2", "ams", { kind: "vmware.datastore", name: "ssd-2" }),
      part("ssd-3", "ams", { kind: "vmware.datastore", name: "ssd-3" }),
    ],
  });
}

/*
 * WHERE THINGS ARE ON SCREEN. The canvas sits at (CANVAS_LEFT, CANVAS_TOP),
 * a phone's page gutter in, at the stand-in's canvas size: the map's
 * wrapper, React Flow's element and the renderer inside it all cover it.
 * A part's buttons are where the view the stand-in shows puts its box; the
 * zoom buttons are in the canvas's bottom left corner. The renderer and the
 * zoom buttons move with a scroll of React Flow's element, as a browser
 * moves them.
 */
const CANVAS_LEFT: number = 16;
const CANVAS_TOP: number = 180;
const CONTROLS_INSET: number = 15;
const CONTROLS_WIDTH: number = 26;
const CONTROLS_HEIGHT: number = 78;

// Zoomed in to read: the resource's card 24px inside the canvas's top left.
const READING_VIEW: StandInViewport = { x: 24, y: 24, zoom: 1 };

interface FlowBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function screenRect(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  const box: Omit<DOMRect, "toJSON"> = {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };

  return {
    ...box,
    toJSON: (): Omit<DOMRect, "toJSON"> => {
      return box;
    },
  };
}

function flowScroll(): { left: number; top: number } {
  const domNode: HTMLDivElement | null = flowDomNode();

  return { left: domNode?.scrollLeft || 0, top: domNode?.scrollTop || 0 };
}

function nodeBox(nodeId: string): FlowBox {
  const node: Node | undefined = (flowProps()?.nodes || []).find(
    (candidate: Node): boolean => {
      return candidate.id === nodeId;
    },
  );

  expect(node).toBeDefined();

  return {
    x: node!.position.x,
    y: node!.position.y,
    width: node!.width || 0,
    height: node!.height || 0,
  };
}

// A box of the drawing on screen, through the view shown and React Flow's element's scroll.
function onScreen(box: FlowBox): DOMRect {
  const view: StandInViewport = currentViewport();
  const scroll: { left: number; top: number } = flowScroll();

  return screenRect(
    CANVAS_LEFT + view.x + box.x * view.zoom - scroll.left,
    CANVAS_TOP + view.y + box.y * view.zoom - scroll.top,
    box.width * view.zoom,
    box.height * view.zoom,
  );
}

// Where the zoom buttons are while React Flow's element is not scrolled.
function controlsAtHome(): DOMRect {
  return screenRect(
    CANVAS_LEFT + CONTROLS_INSET,
    CANVAS_TOP + canvasSize().height - CONTROLS_INSET - CONTROLS_HEIGHT,
    CONTROLS_WIDTH,
    CONTROLS_HEIGHT,
  );
}

let realGetBoundingClientRect: () => DOMRect;

function layOut(): void {
  HTMLElement.prototype.getBoundingClientRect = function (
    this: HTMLElement,
  ): DOMRect {
    const size: { width: number; height: number } = canvasSize();
    const scroll: { left: number; top: number } = flowScroll();

    if (
      this.getAttribute("data-testid") === "resource-topology-canvas" ||
      this.classList.contains("react-flow")
    ) {
      return screenRect(CANVAS_LEFT, CANVAS_TOP, size.width, size.height);
    }

    if (this.classList.contains("react-flow__renderer")) {
      return screenRect(
        CANVAS_LEFT - scroll.left,
        CANVAS_TOP - scroll.top,
        size.width,
        size.height,
      );
    }

    if (this.closest(".react-flow__controls")) {
      const home: DOMRect = controlsAtHome();

      return screenRect(
        home.left - scroll.left,
        home.top - scroll.top,
        home.width,
        home.height,
      );
    }

    const wrapper: Element | null = this.closest("[data-flow-node-id]");

    if (wrapper) {
      return onScreen(nodeBox(wrapper.getAttribute("data-flow-node-id")!));
    }

    return screenRect(0, 0, 0, 0);
  };
}

/*
 * How focus last came to an element: a key (Tab, or an arrow that moved
 * it), or a pointer pressing it. :focus-visible matches the focused element
 * only for the first, as a browser's does; jsdom parses it but never
 * matches it.
 */
let focusCameBy: "keyboard" | "pointer" = "keyboard";
let matchesSpy: SpyInstance<(selectors: string) => boolean>;

function answerFocusVisible(): SpyInstance<(selectors: string) => boolean> {
  const jsdomMatches: (selectors: string) => boolean =
    Element.prototype.matches;

  return jest.spyOn(Element.prototype, "matches").mockImplementation(function (
    this: Element,
    selectors: string,
  ): boolean {
    if (selectors === ":focus-visible") {
      return focusCameBy === "keyboard" && this === document.activeElement;
    }

    return jsdomMatches.call(this, selectors);
  });
}

/*
 * The page scrolling an element into view: jsdom has no scrollIntoView, so
 * each call is written down with where the element was on screen then.
 */
interface ScrollIntoViewCall {
  element: Element;
  options: ScrollIntoViewOptions | boolean | undefined;
  box: DOMRect;
}

const scrolledIntoView: Array<ScrollIntoViewCall> = [];
const realScrollIntoView: Element["scrollIntoView"] | undefined =
  Element.prototype.scrollIntoView;

function tabOnto(element: HTMLElement): void {
  focusCameBy = "keyboard";
  act(() => {
    element.focus();
  });
  expect(document.activeElement).toBe(element);
}

function pointerFocuses(element: HTMLElement): void {
  focusCameBy = "pointer";
  act(() => {
    element.focus();
  });
  expect(document.activeElement).toBe(element);
}

// A key on the part the keyboard is on: the map's own arrows.
function press(key: string): void {
  focusCameBy = "keyboard";
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: key });
}

// The button that picks a part: its card's main button, or its chip.
function partButton(id: string): HTMLElement {
  return (
    screen.queryByTestId(`resource-topology-select-${id}`) ||
    screen.getByTestId(`resource-topology-chip-${id}`)
  );
}

function focusedItem(): string | null {
  return (document.activeElement as HTMLElement | null)?.getAttribute(
    "data-topology-item",
  ) as string | null;
}

// Whole inside the canvas, `margin` pixels in from each edge (with rounding's slack).
function isInside(box: DOMRect, margin: number): boolean {
  const slack: number = 1e-6;
  const size: { width: number; height: number } = canvasSize();

  return (
    box.left >= CANVAS_LEFT + margin - slack &&
    box.top >= CANVAS_TOP + margin - slack &&
    box.right <= CANVAS_LEFT + size.width - margin + slack &&
    box.bottom <= CANVAS_TOP + size.height - margin + slack
  );
}

function expectInView(element: HTMLElement): void {
  expect({
    element: element.getAttribute("data-testid"),
    inView: isInside(element.getBoundingClientRect(), FOCUS_REVEAL_PADDING_PX),
  }).toEqual({ element: element.getAttribute("data-testid"), inView: true });
}

function expectUnscrolled(): void {
  expect(flowDomNode()).not.toBeNull();
  expect(flowDomNode()!.scrollLeft).toBe(0);
  expect(flowDomNode()!.scrollTop).toBe(0);
}

function expectZoomButtonsAtHome(): void {
  expect(
    screen.getByTestId("flow-controls").getBoundingClientRect().toJSON(),
  ).toEqual(controlsAtHome().toJSON());
}

function panExtent(): CoordinateExtent {
  const extent: CoordinateExtent | undefined = flowProps()?.translateExtent;

  expect(extent).toBeDefined();

  return extent!;
}

// The view is one React Flow's pan extent allows: constraining it moves nothing.
function expectInsidePanExtent(): void {
  expect(
    constrainToExtent(currentViewport(), canvasSize(), panExtent()),
  ).toEqual(currentViewport());
}

function renderMap(): void {
  render(
    <MemoryRouter>
      <ResourceTopologyMap
        arrangements={[
          { id: "vcenter", label: "Hosts and clusters", graph: vcenterGraph() },
        ]}
        searchPlaceholder="Find a host, virtual machine or datastore…"
      />
    </MemoryRouter>,
  );
  expect(screen.getByTestId("mock-react-flow")).toBeInTheDocument();
}

beforeEach(() => {
  resetFlowStandIn();
  startViewAt(READING_VIEW);
  document.documentElement.removeAttribute("dir");
  window.history.replaceState({}, "", "/topology");
  realGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
  layOut();
  focusCameBy = "keyboard";
  matchesSpy = answerFocusVisible();
  scrolledIntoView.length = 0;
  Element.prototype.scrollIntoView = function (
    this: Element,
    options?: ScrollIntoViewOptions | boolean,
  ): void {
    scrolledIntoView.push({
      element: this,
      options: options,
      box: this.getBoundingClientRect(),
    });
  };
});

afterEach(() => {
  act(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  cleanup();
  matchesSpy.mockRestore();
  HTMLElement.prototype.getBoundingClientRect = realGetBoundingClientRect;
  (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView =
    realScrollIntoView;
  document.documentElement.removeAttribute("dir");
});

describe("a vCenter's map on a phone's canvas, zoomed in to read", () => {
  test("is laid out as the page lays it: the hosts off the right of the view, the datastores below it", () => {
    renderMap();

    const size: { width: number; height: number } = canvasSize();

    // The resource is in view, 24px inside the corner.
    expectInView(partButton("vc"));
    expect(partButton("esx-2").getBoundingClientRect().left).toBeGreaterThan(
      CANVAS_LEFT + size.width,
    );
    expect(partButton("esx-1").getBoundingClientRect().right).toBeGreaterThan(
      CANVAS_LEFT + size.width,
    );
    expect(partButton("ssd-3").getBoundingClientRect().top).toBeGreaterThan(
      CANVAS_TOP + size.height,
    );
    // React Flow's element is the store's, around the renderer the parts are in.
    expect(flowDomNode()).toHaveClass("react-flow");
    expect(
      flowDomNode()!
        .querySelector(".react-flow__renderer")!
        .contains(partButton("esx-2")),
    ).toBe(true);
    // The zoom buttons are beside the renderer, not in it.
    expect(
      flowDomNode()!
        .querySelector(".react-flow__renderer")!
        .contains(screen.getByTestId("flow-zoom-in")),
    ).toBe(false);
    // The map's own pan extent: the drawing, with a margin all round.
    expect(panExtent()[0]).toEqual([
      -RESOURCE_TOPOLOGY_PAN_MARGIN,
      -RESOURCE_TOPOLOGY_PAN_MARGIN,
    ]);
    expect(pansMade()).toEqual([]);
  });

  test("Tab to a part wholly right of the view pans it in from the right, 24px inside the canvas, and pans no further", () => {
    renderMap();

    const host: HTMLElement = partButton("esx-2");

    tabOnto(host);

    expectInView(host);
    // The least pan that shows it: its right edge 24px inside the canvas's.
    expect(host.getBoundingClientRect().right).toBeCloseTo(
      CANVAS_LEFT + canvasSize().width - FOCUS_REVEAL_PADDING_PX,
      6,
    );
    expect(pansMade()).toHaveLength(1);
    expect(pansMade()[0]!.x).toBeLessThan(0);
    expect(pansMade()[0]!.y).toBe(0);
    expect(currentViewport().zoom).toBe(READING_VIEW.zoom);
    expectUnscrolled();
    expectInsidePanExtent();
  });

  test("Tab to a part below the view pans it up into view, and back to the resource above pans it down again", () => {
    renderMap();

    const datastore: HTMLElement = partButton("ssd-3");

    tabOnto(datastore);

    expectInView(datastore);
    expect(datastore.getBoundingClientRect().bottom).toBeCloseTo(
      CANVAS_TOP + canvasSize().height - FOCUS_REVEAL_PADDING_PX,
      6,
    );
    expect(pansMade()).toHaveLength(1);
    expect(pansMade()[0]!.y).toBeLessThan(0);

    const resource: HTMLElement = partButton("vc");

    expect(resource.getBoundingClientRect().top).toBeLessThan(
      CANVAS_TOP + FOCUS_REVEAL_PADDING_PX,
    );

    tabOnto(resource);

    expectInView(resource);
    expect(resource.getBoundingClientRect().top).toBeCloseTo(
      CANVAS_TOP + FOCUS_REVEAL_PADDING_PX,
      6,
    );
    expect(pansMade()).toHaveLength(2);
    expect(pansMade()[1]!.y).toBeGreaterThan(0);
    expectUnscrolled();
    expectInsidePanExtent();
  });

  test("Tab to a part left of the view pans it in from the left", () => {
    renderMap();

    tabOnto(partButton("esx-2"));

    const datacenter: HTMLElement = partButton("ams");

    expect(datacenter.getBoundingClientRect().right).toBeLessThan(CANVAS_LEFT);

    tabOnto(datacenter);

    expectInView(datacenter);
    expect(datacenter.getBoundingClientRect().left).toBeCloseTo(
      CANVAS_LEFT + FOCUS_REVEAL_PADDING_PX,
      6,
    );
    expect(pansMade()).toHaveLength(2);
    expect(pansMade()[1]!.x).toBeGreaterThan(0);
    expectUnscrolled();
  });

  test("Tab on through every part's buttons keeps each one whole in view as the focus gets to it, at the zoom it was read at", () => {
    renderMap();

    const stops: Array<HTMLElement> = Array.from(
      flowDomNode()!
        .querySelector(".react-flow__renderer")!
        .querySelectorAll<HTMLElement>("button, a[href]"),
    );

    // Each part's button, and the round one of each part that holds others.
    expect(stops.length).toBeGreaterThanOrEqual(14);

    for (const stop of stops) {
      tabOnto(stop);
      expectInView(stop);
      expectUnscrolled();
      expectInsidePanExtent();
    }

    // Never zoomed: the names stay readable.
    expect(currentViewport().zoom).toBe(READING_VIEW.zoom);
    // Every pan was React Flow's own panBy: none set the view outright.
    expect(pansMade().length).toBeGreaterThan(2);
    expect(setViewportCalls()).toEqual([]);
  });

  test("a part already whole in view, 24px inside, is not panned to, nor is its other button once it is", () => {
    renderMap();

    tabOnto(partButton("vc"));

    expect(pansMade()).toEqual([]);
    expect(currentViewport()).toEqual(READING_VIEW);

    tabOnto(partButton("esx-1"));

    const pans: number = pansMade().length;
    const view: StandInViewport = currentViewport();

    // Its round button is on the same card, already in view.
    tabOnto(screen.getByTestId("resource-topology-open-esx-1"));

    expect(pansMade()).toHaveLength(pans);
    expect(currentViewport()).toEqual(view);
  });

  test("a pointer pressing a part cut by the canvas's edge pans nothing: the part is under the pointer", () => {
    renderMap();

    pointerFocuses(partButton("esx-1"));
    pointerFocuses(partButton("ssd-1"));

    expect(isInside(partButton("ssd-1").getBoundingClientRect(), 0)).toBe(
      false,
    );
    expect(pansMade()).toEqual([]);
    expect(currentViewport()).toEqual(READING_VIEW);
    expect(scrolledIntoView).toEqual([]);
  });

  test("the page is scrolled to the part where the pan has put it, not where it was", () => {
    renderMap();

    const host: HTMLElement = partButton("esx-2");

    tabOnto(host);

    const calls: Array<ScrollIntoViewCall> = scrolledIntoView.filter(
      (call: ScrollIntoViewCall): boolean => {
        return call.element === host;
      },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.options).toEqual({ block: "nearest", inline: "nearest" });
    // By then the pan had happened: the page scrolls to the part in view.
    expect(isInside(calls[0]!.box, FOCUS_REVEAL_PADDING_PX)).toBe(true);
  });
});

describe("the arrow keys", () => {
  test("move through the tree as they did, and each part they reach is panned into view", () => {
    renderMap();
    tabOnto(partButton("vc"));

    const steps: Array<[string, string]> = [
      ["ArrowRight", "ams"],
      ["ArrowRight", "ams-prod"],
      ["ArrowRight", "esx-1"],
      ["ArrowDown", "esx-2"],
      ["ArrowLeft", "ams-prod"],
      ["ArrowDown", "ams-dev"],
      ["ArrowDown", "ssd-1"],
      ["End", "ssd-3"],
      ["Home", "ams-prod"],
    ];

    for (const [key, reached] of steps) {
      press(key);

      expect({ key, focused: focusedItem() }).toEqual({
        key,
        focused: reached,
      });
      expectInView(partButton(reached));
      expectUnscrolled();
      expectInsidePanExtent();
    }

    // The hosts are off to the right, the datastores below: both were panned to.
    expect(
      pansMade().some((pan: { x: number }): boolean => {
        return pan.x < 0;
      }),
    ).toBe(true);
    expect(
      pansMade().some((pan: { y: number }): boolean => {
        return pan.y < 0;
      }),
    ).toBe(true);
    expect(currentViewport().zoom).toBe(READING_VIEW.zoom);
  });
});

describe("React Flow's box never scrolls: the map and its zoom buttons stay on the canvas", () => {
  test("the scroll Chromium makes before it tells of the focus is dropped: one pan, and the box unscrolled", () => {
    renderMap();

    const host: HTMLElement = partButton("esx-2");
    const domNode: HTMLDivElement = flowDomNode()!;

    // Chromium scrolls the box to show the part, then fires focusin.
    domNode.scrollLeft = 600;
    domNode.scrollTop = 0;

    tabOnto(host);

    expectUnscrolled();
    expectInView(host);
    expectZoomButtonsAtHome();
    expect(pansMade()).toHaveLength(1);

    // The scroll's own event, a frame later, finds nothing scrolled: no second pan.
    act(() => {
      domNode.dispatchEvent(new Event("scroll"));
    });

    expect(pansMade()).toHaveLength(1);
    expectInView(host);
  });

  test("a scroll of React Flow's box the browser makes anyway is undone into the same pan, and the zoom buttons are back in their corner", () => {
    renderMap();

    const domNode: HTMLDivElement = flowDomNode()!;

    act(() => {
      domNode.scrollLeft = 120;
      domNode.scrollTop = 40;
      domNode.dispatchEvent(new Event("scroll"));
    });

    expectUnscrolled();
    expectZoomButtonsAtHome();
    expect(pansMade()).toEqual([{ x: -120, y: -40 }]);
    expect(currentViewport()).toEqual({
      x: READING_VIEW.x - 120,
      y: READING_VIEW.y - 40,
      zoom: READING_VIEW.zoom,
    });
  });

  test("a scroll past the drawing's edge is undone into a pan the pan extent stops at, and the part the keyboard is on is shown again", () => {
    renderMap();

    const resource: HTMLElement = partButton("vc");

    tabOnto(resource);

    const domNode: HTMLDivElement = flowDomNode()!;

    act(() => {
      domNode.scrollLeft = 5000;
      domNode.dispatchEvent(new Event("scroll"));
    });

    expectUnscrolled();
    // The scroll became a pan, which the extent stopped at the drawing's far margin...
    expect(pansMade()[0]!.x).toBe(-5000);
    expect(pansMade()[0]!.y === 0).toBe(true);
    // ...and the resource, carried off the canvas by it, was brought back.
    expect(pansMade()).toHaveLength(2);
    expect(pansMade()[1]!.x).toBeGreaterThan(0);
    expectInView(resource);
    expectInsidePanExtent();
    expectZoomButtonsAtHome();
  });

  test("the zoom buttons take the keyboard without a pan, and stay in their corner", () => {
    renderMap();

    const domNode: HTMLDivElement = flowDomNode()!;

    // A scroll the browser made before the focus reached them is dropped too.
    domNode.scrollTop = 30;

    for (const id of ["flow-zoom-in", "flow-zoom-out", "flow-fit-view"]) {
      tabOnto(screen.getByTestId(id));
      expectUnscrolled();
      expectZoomButtonsAtHome();
    }

    expect(pansMade()).toEqual([]);
    expect(currentViewport()).toEqual(READING_VIEW);
  });
});

describe("focus the browser hands back as the window regains it", () => {
  test("is left where it is: the view may have moved on since", () => {
    renderMap();

    const host: HTMLElement = partButton("esx-2");

    tabOnto(host);

    // The reader drags the part away, then leaves the tab and comes back.
    const dragged: StandInViewport = { x: 24, y: 24, zoom: 1 };

    act(() => {
      moveView(dragged);
    });

    const clock: SpyInstance<() => number> = jest
      .spyOn(Event.prototype, "timeStamp", "get")
      .mockReturnValue(1000);

    act(() => {
      window.dispatchEvent(new FocusEvent("focus"));
      host.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });

    expect(pansMade()).toHaveLength(1);
    expect(currentViewport()).toEqual(dragged);

    // A focusin well after the window came back is the reader's own.
    clock.mockReturnValue(1000 + WINDOW_REFOCUS_MS);
    act(() => {
      host.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });

    expect(pansMade()).toHaveLength(2);
    expectInView(host);
    clock.mockRestore();
  });
});

describe("after a pan that followed the focus", () => {
  /*
   * The map keeps no note of whose the view is: a pan the keyboard made is
   * the reader's as a drag is, and Fit frames the whole drawing from the
   * top, as the map first frames it.
   */
  test("Fit frames the whole drawing from the top, as it does after a drag", () => {
    renderMap();

    tabOnto(partButton("esx-2"));

    expect(pansMade()).toHaveLength(1);

    fireEvent.click(screen.getByTestId("flow-fit-view"));

    const framed: StandInViewport = getTopAlignedViewport(
      getDrawingBounds(
        (flowProps()?.nodes || []).map((node: Node): FlowBox => {
          return nodeBox(node.id);
        }),
      ),
      canvasSize(),
      { maxZoom: 1, minZoom: RESOURCE_TOPOLOGY_MIN_ZOOM },
    );

    expect(setViewportCalls()).toEqual([framed]);
    expect(currentViewport()).toEqual(framed);
    // Fit is a button outside the drawing: focusing it panned nothing.
    expect(pansMade()).toHaveLength(1);
  });
});

describe("on a page read from right to left", () => {
  test("the mirrored map follows the focus the same way: the hosts, off its left, are panned in from the left", () => {
    document.documentElement.setAttribute("dir", "rtl");
    renderMap();

    expect(screen.getByTestId("resource-topology-canvas")).toHaveAttribute(
      "data-direction",
      "rtl",
    );

    // Zoomed in to read: the resource's card 24px inside the canvas's top right.
    const resource: FlowBox = nodeBox("vc");

    act(() => {
      moveView({
        x:
          canvasSize().width -
          FOCUS_REVEAL_PADDING_PX -
          (resource.x + resource.width),
        y: READING_VIEW.y,
        zoom: 1,
      });
    });
    expectInView(partButton("vc"));

    const host: HTMLElement = partButton("esx-2");

    expect(host.getBoundingClientRect().right).toBeLessThan(CANVAS_LEFT);

    tabOnto(host);

    expectInView(host);
    expect(host.getBoundingClientRect().left).toBeCloseTo(
      CANVAS_LEFT + FOCUS_REVEAL_PADDING_PX,
      6,
    );
    expect(pansMade()).toHaveLength(1);
    expect(pansMade()[0]!.x).toBeGreaterThan(0);

    // A pointer's focus is left alone here too.
    pointerFocuses(partButton("vc"));

    expect(pansMade()).toHaveLength(1);
    expectUnscrolled();
  });
});
