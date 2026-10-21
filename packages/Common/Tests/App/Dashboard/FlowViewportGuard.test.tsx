import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { RenderResult, act, cleanup, render } from "@testing-library/react";
import type { SpyInstance } from "jest-mock";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
} from "react";
import {
  FitViewOptions,
  Node,
  ReactFlowState,
  Viewport,
  XYPosition,
} from "reactflow";
import FlowViewportGuard, {
  ComponentProps,
  isKeyboardFocus,
  measuredRectOf,
  renderedPaneSize,
  selectDrawingInView,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/FlowViewportGuard";
import {
  FlowExtent,
  FlowRect,
  FlowTransform,
  UNBOUNDED_FLOW_EXTENT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/FlowViewport";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * FlowViewportGuard keeps the Service Map on its canvas (issue #4117).
 * Rendered inside <ReactFlow>, it decides from React Flow's own store:
 *
 * - it fits the view only once React Flow holds the drawing the map asked
 *   for, every card measured, in a pane that has a size - the size the page
 *   gives it, not one React Flow has yet to catch up with - and a viewport
 *   that is ready; a fit React Flow refuses is owed until one lands (a
 *   re-fit owed from a resize only until the user takes the view), and the
 *   same drawing is never fitted twice in the same pane;
 * - it fits again whenever the drawing changes, and when the pane is resized
 *   while the view is still the automatic framing (autoFrame), a resize being
 *   judged against the last pane size it saw; once the user has the view, a
 *   resize re-applies the pan extent instead;
 * - it follows keyboard focus: a card or connection focused off the canvas
 *   is panned the least that brings it 24 px inside, through React Flow's
 *   panBy, which keeps the view inside the pan extent, and drawn there at
 *   once, before the page is scrolled to where it now is; the scroll Chromium
 *   makes of React Flow's element before it tells of the focus is dropped
 *   first, and a scroll of that element the browser makes anyway is undone
 *   and made the same pan. Focus a pointer gives, and focus the browser hands
 *   back as the window regains focus, are left alone;
 * - it reports the measured drawing plus a margin as the pan extent, whether
 *   any card is in view, and the live instance, and withdraws all three when
 *   it unmounts.
 *
 * React Flow is replaced by a fake of the three hooks the guard calls.
 * useStore reads a small mutable state - the nodes React Flow holds, the
 * viewport transform, the pane's size, React Flow's element and its d3 zoom -
 * through useSyncExternalStore, so a store change re-renders the guard the
 * way zustand's does; useStoreApi hands out the same state for the reads the
 * guard makes inside its effects, React Flow's panBy among them, which moves
 * the view the way React Flow's does unless a test has the pan extent refuse
 * the pan. useReactFlow returns an instance that, like React Flow's, becomes
 * a new object when the viewport is initialized, and what is on screen moves
 * only once React renders the view, as React Flow's viewport does (see
 * DrawnViewport). jsdom lays nothing out, so where the canvas and what React
 * Flow draws in it are on screen is the test's to say (see flowElement); nor
 * does it tell keyboard focus from a pointer's, or let a test say when an
 * event happened, so the focus tests do both (see focusCameBy and
 * pageClockMs). The guard and its maths run for real.
 */

/* d3-zoom's behaviour as React Flow keeps it: what the guard asks of it. */
interface FakeD3Zoom {
  translateBy: MockFunction;
}

/* Stands in for d3's selection of React Flow's zoom pane. */
interface FakeD3Selection {
  selects: string;
}

interface FakeFlowState {
  nodeInternals: Map<string, Node>;
  transform: FlowTransform;
  width: number;
  height: number;
  /*
   * React Flow's own element, `.react-flow`, which React Flow records when
   * its zoom pane mounts. Null unless a test lays one out.
   */
  domNode: HTMLDivElement | null;
  d3Zoom: FakeD3Zoom | null;
  d3Selection: FakeD3Selection | null;
  /* React Flow's store.panBy (see panViewBy). */
  panBy: MockFunction;
}

interface FakeFlowInstance {
  viewportInitialized: boolean;
  fitView: MockFunction;
  getViewport: () => Viewport;
  setViewport: MockFunction;
}

/* What useStoreApi returns: the store, for reads made inside effects. */
interface FakeStoreApi {
  getState: () => FakeFlowState;
}

interface FakeFlowStore {
  state: FakeFlowState;
  instance: FakeFlowInstance;
  listeners: Set<() => void>;
  subscribe: (listener: () => void) => () => void;
  /* Replaces some of the state, then tells every subscriber, as zustand does. */
  set: (partial: Partial<FakeFlowState>) => void;
  /*
   * React Flow's d3 zoom becoming ready (or not). useReactFlow memoizes its
   * instance on it, so the instance is a new object only when this flips.
   */
  setViewportInitialized: (viewportInitialized: boolean) => void;
}

const mockFitView: MockFunction = getJestMockFunction();
const mockSetViewport: MockFunction = getJestMockFunction();
const mockTranslateBy: MockFunction = getJestMockFunction();
const mockPanBy: MockFunction = getJestMockFunction();

/*
 * Whether the pan extent lets panBy move the view. A test sets it to false
 * for a view already at the edge of the extent, which refuses a pan outright.
 */
let panByMoves: boolean = true;

/*
 * React Flow's store.panBy, which mockPanBy runs (see beforeEach): it moves
 * the view by a delta in screen pixels, positive moving the drawing right and
 * down, and says whether the view moved. React Flow keeps the view inside the
 * pan extent as it goes; here the extent lets a pan through whole unless
 * panByMoves says it refuses it. Like React Flow's, it does nothing for a zero
 * delta.
 */
function panViewBy(delta: XYPosition): boolean {
  if (!panByMoves || (!delta.x && !delta.y)) {
    return false;
  }
  const [x, y, zoom] = mockFlowStore.state.transform;
  mockFlowStore.set({ transform: [x + delta.x, y + delta.y, zoom] });
  return true;
}

/* d3's selection of the zoom pane: the guard only ever hands it back to d3. */
const D3_SELECTION: FakeD3Selection = { selects: ".react-flow__renderer" };

function emptyFlowState(): FakeFlowState {
  return {
    nodeInternals: new Map<string, Node>(),
    transform: [0, 0, 1],
    width: 0,
    height: 0,
    domNode: null,
    d3Zoom: { translateBy: mockTranslateBy },
    d3Selection: D3_SELECTION,
    panBy: mockPanBy,
  };
}

/*
 * The instance useReactFlow returns. Until its viewport is ready React
 * Flow's reports the identity viewport; once it is, the view is the store's
 * transform. setViewport is a mock that moves the view the way React Flow's
 * d3 zoom handler does, by writing the store's transform (see beforeEach).
 */
function flowInstance(viewportInitialized: boolean): FakeFlowInstance {
  return {
    viewportInitialized,
    fitView: mockFitView,
    getViewport: (): Viewport => {
      if (!viewportInitialized) {
        return { x: 0, y: 0, zoom: 1 };
      }
      const transform: FlowTransform = mockFlowStore.state.transform;
      return { x: transform[0], y: transform[1], zoom: transform[2] };
    },
    setViewport: mockSetViewport,
  };
}

function notifyFlowSubscribers(): void {
  for (const listener of Array.from(mockFlowStore.listeners)) {
    listener();
  }
}

const mockFlowStore: FakeFlowStore = {
  state: emptyFlowState(),
  instance: flowInstance(false),
  listeners: new Set<() => void>(),
  subscribe: (listener: () => void): (() => void) => {
    mockFlowStore.listeners.add(listener);
    return (): void => {
      mockFlowStore.listeners.delete(listener);
    };
  },
  set: (partial: Partial<FakeFlowState>): void => {
    mockFlowStore.state = { ...mockFlowStore.state, ...partial };
    notifyFlowSubscribers();
  },
  setViewportInitialized: (viewportInitialized: boolean): void => {
    if (mockFlowStore.instance.viewportInitialized === viewportInitialized) {
      return;
    }
    mockFlowStore.instance = flowInstance(viewportInitialized);
    notifyFlowSubscribers();
  },
};

/* One object for the life of the store, as React Flow's context gives out. */
const mockStoreApi: FakeStoreApi = {
  getState: (): FakeFlowState => {
    return mockFlowStore.state;
  },
};

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the store is only reached once a hook runs.
 */
jest.mock("reactflow", () => {
  return {
    __esModule: true,
    useStore: (selector: (state: ReactFlowState) => unknown): unknown => {
      return React.useSyncExternalStore(
        mockFlowStore.subscribe,
        (): unknown => {
          return selector(mockFlowStore.state as unknown as ReactFlowState);
        },
      );
    },
    useStoreApi: (): FakeStoreApi => {
      return mockStoreApi;
    },
    useReactFlow: (): FakeFlowInstance => {
      return React.useSyncExternalStore(
        mockFlowStore.subscribe,
        (): FakeFlowInstance => {
          return mockFlowStore.instance;
        },
      );
    },
  };
});

const CARD_WIDTH: number = 220;
const CARD_HEIGHT: number = 80;
const PANE_WIDTH: number = 800;
const PANE_HEIGHT: number = 600;
const PAN_MARGIN: number = 50;
/* Not the map's own options, so a fit is seen to use the ones it was given. */
const FIT_VIEW_OPTIONS: FitViewOptions = {
  padding: 0.25,
  minZoom: 0.2,
  maxZoom: 1.2,
};

/* A card React Flow has measured, placed at (x, y) on the drawing. */
function measuredCard(
  id: string,
  x: number,
  y: number,
  width: number = CARD_WIDTH,
  height: number = CARD_HEIGHT,
): Node {
  return {
    id,
    position: { x, y },
    positionAbsolute: { x, y },
    width,
    height,
    data: {},
  };
}

/* A card React Flow has been handed but not measured: it has no size yet. */
function unmeasuredCard(id: string, x: number, y: number): Node {
  return {
    id,
    position: { x, y },
    positionAbsolute: { x, y },
    data: {},
  };
}

/* React Flow's nodeInternals: the cards it holds, by id, in drawing order. */
function holding(...cards: Array<Node>): Map<string, Node> {
  return new Map<string, Node>(
    cards.map((card: Node): [string, Node] => {
      return [card.id, card];
    }),
  );
}

/* The drawing the map asks for unless a test says otherwise: api calls db. */
const DRAWING_KEY: string = "api|db";

function apiAndDb(): Map<string, Node> {
  return holding(measuredCard("api", 0, 0), measuredCard("db", 400, 200));
}

/* The measured boxes of api and db, grown by the pan margin. */
const API_AND_DB_EXTENT: FlowExtent = [
  [-50, -50],
  [670, 330],
];

/* A change to React Flow's store, inside act() as React Flow's would be. */
function flowChanges(partial: Partial<FakeFlowState>): void {
  act(() => {
    mockFlowStore.set(partial);
  });
}

function viewportReady(): void {
  act(() => {
    mockFlowStore.setViewportInitialized(true);
  });
}

/*
 * React Flow holding the drawing, measured, in a pane of its full size, with
 * its viewport ready: everything a fit waits for.
 */
function drawnAndReady(nodeInternals: Map<string, Node> = apiAndDb()): void {
  flowChanges({ nodeInternals, width: PANE_WIDTH, height: PANE_HEIGHT });
  viewportReady();
}

/*
 * The same, already so before the guard mounts: nothing is rendered yet, so
 * there is nobody to tell.
 */
function drawnAndReadyBeforeMount(): void {
  mockFlowStore.state = {
    ...emptyFlowState(),
    nodeInternals: apiAndDb(),
    width: PANE_WIDTH,
    height: PANE_HEIGHT,
  };
  mockFlowStore.instance = flowInstance(true);
}

/* A plain store state for the selector, the pane sized unless overridden. */
function flowState(partial: Partial<FakeFlowState>): ReactFlowState {
  return {
    ...emptyFlowState(),
    width: PANE_WIDTH,
    height: PANE_HEIGHT,
    ...partial,
  } as unknown as ReactFlowState;
}

/*
 * Where the page puts the canvas: its top-left corner in the browser's
 * viewport, in screen pixels.
 */
const CANVAS_LEFT: number = 40;
const CANVAS_TOP: number = 120;
/*
 * React Flow's controls, as Chromium lays them out: 26 x 27 px buttons in a
 * panel 15 px in from the corner.
 */
const CONTROLS_MARGIN_PX: number = 15;
const CONTROLS_BUTTON_WIDTH_PX: number = 26;
const CONTROLS_BUTTON_HEIGHT_PX: number = 27;

/* A box on screen, as getBoundingClientRect reports it. */
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

/*
 * The view as React Flow has drawn it: the transform its viewport was last
 * rendered with. A pan moves React Flow's store at once, but what is on
 * screen only once React renders the change - straight away inside
 * flushSync, otherwise after the event that asked for it - and it is what is
 * on screen that the browser measures (see onScreen).
 */
let drawnTransform: FlowTransform = [0, 0, 1];

/*
 * React Flow's viewport, down to the transform it draws the map with. It is
 * rendered beside the guard (see renderGuard), as <ReactFlow> renders both.
 */
const DrawnViewport: FunctionComponent = (): ReactElement => {
  const transform: FlowTransform = React.useSyncExternalStore(
    mockFlowStore.subscribe,
    (): FlowTransform => {
      return mockFlowStore.state.transform;
    },
  );
  React.useLayoutEffect(() => {
    drawnTransform = transform;
  }, [transform]);
  return <></>;
};

/*
 * Where React Flow draws a box of the drawing (in flow units) on screen:
 * through the view it has drawn (see drawnTransform), from the canvas's
 * top-left corner. Read when asked, so a pan moves it once React has rendered
 * the pan, the way it moves what React Flow draws.
 */
function onScreen(box: FlowRect): DOMRect {
  const [x, y, zoom] = drawnTransform;
  return screenRect(
    CANVAS_LEFT + x + box.x * zoom,
    CANVAS_TOP + y + box.y * zoom,
    box.width * zoom,
    box.height * zoom,
  );
}

/*
 * React Flow's element as the page lays it out: `.react-flow`, the store's
 * domNode, around `.react-flow__renderer`, the zoom pane React Flow measures
 * the canvas from and draws every card and connection in, and around the
 * panel of its controls, which React Flow puts beside the renderer rather
 * than in it. jsdom lays nothing out, so the renderer's size and where things
 * are on screen are the test's to set: React Flow's element, the renderer and
 * the pane inside it all cover the canvas, at (CANVAS_LEFT, CANVAS_TOP), and
 * everything in React Flow's element moves with its scroll, as a browser
 * moves it.
 */
interface FlowElement {
  domNode: HTMLDivElement;
  /* The page lays the canvas out at another size, unseen by React Flow. */
  layOut: (width: number, height: number) => void;
  /* A card React Flow draws for a box of the drawing, focusable as it makes them. */
  drawCard: (box: FlowRect) => HTMLDivElement;
  /* A connection React Flow draws: a focusable SVG group, over its box. */
  drawConnection: (box: FlowRect) => SVGGElement;
  /*
   * The controls' Fit to screen button, the lowest of three: in the canvas's
   * bottom-left corner, 15 px in, wherever the view is.
   */
  fitViewButton: HTMLButtonElement;
}

function flowElement(width: number, height: number): FlowElement {
  const domNode: HTMLDivElement = document.createElement("div");
  domNode.className = "react-flow";
  const renderer: HTMLDivElement = document.createElement("div");
  renderer.className = "react-flow__renderer";
  domNode.appendChild(renderer);
  const size: { width: number; height: number } = { width, height };
  Object.defineProperty(renderer, "offsetWidth", {
    configurable: true,
    get: (): number => {
      return size.width;
    },
  });
  Object.defineProperty(renderer, "offsetHeight", {
    configurable: true,
    get: (): number => {
      return size.height;
    },
  });
  const canvas: () => DOMRect = (): DOMRect => {
    return screenRect(CANVAS_LEFT, CANVAS_TOP, size.width, size.height);
  };
  /*
   * Where a box inside React Flow's element is on screen. A scroll of the
   * element moves all it holds - the renderer, what React Flow draws, the
   * controls - the other way, while the element stays where the page put it.
   */
  const inScroll: (box: DOMRect) => DOMRect = (box: DOMRect): DOMRect => {
    return screenRect(
      box.left - domNode.scrollLeft,
      box.top - domNode.scrollTop,
      box.width,
      box.height,
    );
  };
  const scrolledCanvas: () => DOMRect = (): DOMRect => {
    return inScroll(canvas());
  };
  domNode.getBoundingClientRect = canvas;
  renderer.getBoundingClientRect = scrolledCanvas;

  // The pane, then the viewport React Flow transforms, then what it draws.
  const pane: HTMLDivElement = document.createElement("div");
  pane.className = "react-flow__pane";
  pane.getBoundingClientRect = scrolledCanvas;
  renderer.appendChild(pane);
  const viewport: HTMLDivElement = document.createElement("div");
  viewport.className = "react-flow__viewport";
  pane.appendChild(viewport);
  const edges: SVGSVGElement = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  edges.setAttribute("class", "react-flow__edges");
  viewport.appendChild(edges);
  const nodes: HTMLDivElement = document.createElement("div");
  nodes.className = "react-flow__nodes";
  viewport.appendChild(nodes);

  const controls: HTMLDivElement = document.createElement("div");
  controls.className = "react-flow__panel react-flow__controls bottom left";
  domNode.appendChild(controls);
  const fitViewButton: HTMLButtonElement = document.createElement("button");
  fitViewButton.className = "react-flow__controls-button";
  fitViewButton.getBoundingClientRect = (): DOMRect => {
    return inScroll(
      screenRect(
        CANVAS_LEFT + CONTROLS_MARGIN_PX,
        CANVAS_TOP +
          size.height -
          CONTROLS_MARGIN_PX -
          CONTROLS_BUTTON_HEIGHT_PX,
        CONTROLS_BUTTON_WIDTH_PX,
        CONTROLS_BUTTON_HEIGHT_PX,
      ),
    );
  };
  controls.appendChild(fitViewButton);

  return {
    domNode,
    layOut: (nextWidth: number, nextHeight: number): void => {
      size.width = nextWidth;
      size.height = nextHeight;
    },
    drawCard: (box: FlowRect): HTMLDivElement => {
      const card: HTMLDivElement = document.createElement("div");
      card.className = "react-flow__node";
      card.tabIndex = 0;
      card.getBoundingClientRect = (): DOMRect => {
        return inScroll(onScreen(box));
      };
      nodes.appendChild(card);
      return card;
    },
    drawConnection: (box: FlowRect): SVGGElement => {
      const connection: SVGGElement = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "g",
      );
      connection.setAttribute("class", "react-flow__edge");
      connection.setAttribute("tabindex", "0");
      connection.getBoundingClientRect = (): DOMRect => {
        return inScroll(onScreen(box));
      };
      edges.appendChild(connection);
      return connection;
    },
    fitViewButton,
  };
}

/* The page resizes the canvas, then React Flow's ResizeObserver reports it. */
function canvasResized(flow: FlowElement, width: number, height: number): void {
  flow.layOut(width, height);
  flowChanges({ width, height });
}

/* Elements a test put on the page; afterEach takes them off again. */
const onPage: Array<Element> = [];

function putOnPage(element: Element): void {
  document.body.appendChild(element);
  onPage.push(element);
}

/* db's box on the drawing, as apiAndDb measures it. */
const DB_BOX: FlowRect = {
  x: 400,
  y: 200,
  width: CARD_WIDTH,
  height: CARD_HEIGHT,
};

/* api's box on the drawing, as apiAndDb measures it. */
const API_BOX: FlowRect = {
  x: 0,
  y: 0,
  width: CARD_WIDTH,
  height: CARD_HEIGHT,
};

/*
 * The view mapOnPage leaves, standing for where the fit put the drawing: half
 * size, db's card on screen at (340, 270)-(450, 310), well inside the canvas
 * at (40, 120)-(840, 720).
 */
const FITTED_TRANSFORM: FlowTransform = [100, 50, 0.5];

interface MapOnPage extends FlowElement {
  /* The card React Flow draws for db. */
  db: HTMLDivElement;
}

/*
 * The map on a page: React Flow's element in the document, where its cards
 * can take focus, and in the store, holding api and db measured in a canvas
 * of the pane's size, with the viewport ready and the drawing fitted.
 */
function mapOnPage(): MapOnPage {
  const flow: FlowElement = flowElement(PANE_WIDTH, PANE_HEIGHT);
  putOnPage(flow.domNode);
  flowChanges({ domNode: flow.domNode });
  drawnAndReady();
  flowChanges({ transform: FITTED_TRANSFORM });
  return { ...flow, db: flow.drawCard(DB_BOX) };
}

/*
 * How focus last came to an element: by a key (Tab, or a script focusing
 * after one), or by a pointer pressing it. A browser draws a focus ring for
 * the first and not the second, and :focus-visible matches the focused
 * element only for the first. jsdom parses :focus-visible but never matches
 * it, so the focus tests answer it from this (see answerFocusVisible).
 */
type FocusCause = "keyboard" | "pointer";
let focusCameBy: FocusCause = "keyboard";

/*
 * Element.matches answering :focus-visible the way a browser does: for the
 * focused element, when focus came to it by a key. Any other selector is
 * jsdom's to match.
 */
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
 * Keyboard focus moving onto an element, as Tab moves it: jsdom makes it the
 * document's active element and fires focusin, which bubbles up from it.
 */
function tabOnto(element: HTMLElement | SVGElement): void {
  focusCameBy = "keyboard";
  act(() => {
    element.focus();
  });
  // jsdom focuses only what is on the page and focusable: check it took.
  expect(document.activeElement).toBe(element);
}

/*
 * A pointer pressing an element: the browser focuses it, firing focusin as
 * for Tab, but draws no focus ring.
 */
function pointerFocuses(element: HTMLElement | SVGElement): void {
  focusCameBy = "pointer";
  act(() => {
    element.focus();
  });
  expect(document.activeElement).toBe(element);
}

/*
 * The window regaining focus, as it does when the user comes back to the
 * tab. The browser then hands focus back to the element that had it (see
 * focusHandedBackTo).
 */
function windowRegainsFocus(): void {
  act(() => {
    window.dispatchEvent(new FocusEvent("focus"));
  });
}

/*
 * The browser handing focus back to the element that had it before the
 * window lost focus: the element is still the document's active element, and
 * focusin fires on it again.
 */
function focusHandedBackTo(element: HTMLElement | SVGElement): void {
  expect(document.activeElement).toBe(element);
  act(() => {
    element.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  });
}

/*
 * The page's clock, in ms: when each event happened, as the browser stamps
 * it (event.timeStamp). jsdom stamps an event with the wall clock; the focus
 * tests read every event's time off this clock instead (see
 * readEventTimesOffPageClock), so events a test fires one after another
 * happen at the same moment, and a test that means time to pass moves the
 * clock on.
 */
let pageClockMs: number = 0;

function readEventTimesOffPageClock(): SpyInstance<() => number> {
  return jest
    .spyOn(Event.prototype, "timeStamp", "get")
    .mockImplementation((): number => {
      return pageClockMs;
    });
}

/*
 * The browser scrolling React Flow's overflow:hidden element, as it does to
 * bring a focused card or connection into view or to show a match of find
 * in page, and firing its scroll event.
 */
function browserScrolls(domNode: HTMLElement, left: number, top: number): void {
  act(() => {
    domNode.scrollLeft = left;
    domNode.scrollTop = top;
    domNode.dispatchEvent(new Event("scroll"));
  });
}

/*
 * The browser scrolling React Flow's element without saying so yet: its
 * scroll event comes a frame later (see scrollEventArrives). Chromium makes
 * such a scroll as Tab moves focus onto an element outside the view, before
 * it fires focusin.
 */
function browserHasScrolled(domNode: HTMLElement, scroll: XYPosition): void {
  domNode.scrollLeft = scroll.x;
  domNode.scrollTop = scroll.y;
}

/* The scroll event, a frame after the browser scrolled React Flow's element. */
function scrollEventArrives(domNode: HTMLElement): void {
  act(() => {
    domNode.dispatchEvent(new Event("scroll"));
  });
}

/* The page scrolled to show an element, with Element.scrollIntoView. */
interface PageScroll {
  element: Element;
  options: boolean | ScrollIntoViewOptions | undefined;
  /* Where the element was on screen as the page was scrolled to it. */
  box: DOMRect;
}

/*
 * Gives the page a scrollIntoView that records each call. jsdom has none;
 * the focus tests take this one away again after each test.
 */
function pageScrollsRecorded(): Array<PageScroll> {
  const scrolls: Array<PageScroll> = [];
  Element.prototype.scrollIntoView = function (
    this: Element,
    options?: boolean | ScrollIntoViewOptions,
  ): void {
    scrolls.push({ element: this, options, box: this.getBoundingClientRect() });
  };
  return scrolls;
}

/*
 * What the guard's event listeners threw. jsdom reports a throw in a
 * listener to the window, as an error event, rather than to whoever fired
 * the event, so it would otherwise go unnoticed.
 */
const thrownInListeners: Array<unknown> = [];

function noteThrown(event: ErrorEvent): void {
  thrownInListeners.push(event.error);
}

/*
 * Every pan the guard asked React Flow for, in screen pixels. React Flow's
 * panBy does nothing for a zero delta, so asking for one is no pan and is
 * left out; and it adds a delta to the view, so -0 reads as 0.
 */
function pansAskedFor(): Array<XYPosition> {
  const pans: Array<XYPosition> = [];
  for (const call of mockPanBy.mock.calls) {
    const delta: XYPosition = call[0] as XYPosition;
    if (delta.x || delta.y) {
      pans.push({ x: delta.x + 0, y: delta.y + 0 });
    }
  }
  return pans;
}

interface RenderedGuard {
  autoFrame: MutableRefObject<boolean>;
  onInstance: MockFunction;
  onExtentChange: MockFunction;
  onDrawingInViewChange: MockFunction;
  /* Renders the guard again with some props changed, as the map does. */
  rerender: (changes: Partial<ComponentProps>) => void;
  unmount: () => void;
}

interface GuardRenderOptions {
  /*
   * Inside <React.StrictMode>, which mounts the guard's effects, unmounts
   * them and mounts them again, keeping its refs.
   */
  strictMode?: boolean;
}

function renderGuard(
  changes: Partial<ComponentProps> = {},
  options: GuardRenderOptions = {},
): RenderedGuard {
  const onInstance: MockFunction = getJestMockFunction();
  const onExtentChange: MockFunction = getJestMockFunction();
  const onDrawingInViewChange: MockFunction = getJestMockFunction();
  /* The map starts on the automatic framing. */
  const autoFrame: MutableRefObject<boolean> = { current: true };
  let props: ComponentProps = {
    drawingKey: DRAWING_KEY,
    fitViewOptions: FIT_VIEW_OPTIONS,
    autoFrame,
    panMargin: PAN_MARGIN,
    onInstance,
    onExtentChange,
    onDrawingInViewChange,
    ...changes,
  };
  const element: (current: ComponentProps) => ReactElement = (
    current: ComponentProps,
  ): ReactElement => {
    const guard: ReactElement = (
      <>
        <FlowViewportGuard {...current} />
        <DrawnViewport />
      </>
    );
    return options.strictMode ? (
      <React.StrictMode>{guard}</React.StrictMode>
    ) : (
      guard
    );
  };
  const rendered: RenderResult = render(element(props));
  return {
    autoFrame: props.autoFrame,
    onInstance,
    onExtentChange,
    onDrawingInViewChange,
    rerender: (next: Partial<ComponentProps>): void => {
      props = { ...props, ...next };
      rendered.rerender(element(props));
    },
    unmount: (): void => {
      rendered.unmount();
    },
  };
}

/* Every answer the guard gave to "is any of the drawing in view?", in order. */
function inViewReports(guard: RenderedGuard): Array<boolean> {
  return guard.onDrawingInViewChange.mock.calls.map(
    (call: Array<unknown>): boolean => {
      return call[0] as boolean;
    },
  );
}

beforeEach(() => {
  mockFlowStore.state = emptyFlowState();
  mockFlowStore.instance = flowInstance(false);
  mockFlowStore.listeners.clear();
  drawnTransform = mockFlowStore.state.transform;
  mockFitView.mockReset();
  mockFitView.mockReturnValue(true);
  mockTranslateBy.mockReset();
  mockSetViewport.mockReset();
  mockSetViewport.mockImplementation((viewport: Viewport): void => {
    mockFlowStore.set({ transform: [viewport.x, viewport.y, viewport.zoom] });
  });
  panByMoves = true;
  mockPanBy.mockReset();
  mockPanBy.mockImplementation(panViewBy);
});

afterEach(() => {
  cleanup();
  for (const element of onPage.splice(0)) {
    element.remove();
  }
  /*
   * Whatever a test did, the guard never moved the view with setViewport,
   * which does not keep it inside the pan extent: the next drag would jump.
   */
  expect(mockSetViewport).not.toHaveBeenCalled();
});

describe("framing the drawing", () => {
  interface Holdup {
    name: string;
    /* Brings React Flow to everything a fit needs but one thing. */
    arrange: () => void;
    /* Supplies that thing, the way React Flow would. */
    lift: () => void;
  }

  const HOLDUPS: Array<Holdup> = [
    {
      name: "React Flow still holds the previous drawing",
      arrange: (): void => {
        drawnAndReady(
          holding(measuredCard("web", -400, 0), measuredCard("api", 0, 0)),
        );
      },
      lift: (): void => {
        flowChanges({ nodeInternals: apiAndDb() });
      },
    },
    {
      name: "a card is not measured yet",
      arrange: (): void => {
        drawnAndReady(
          holding(measuredCard("api", 0, 0), unmeasuredCard("db", 400, 200)),
        );
      },
      lift: (): void => {
        flowChanges({ nodeInternals: apiAndDb() });
      },
    },
    {
      name: "the pane has no size yet",
      arrange: (): void => {
        flowChanges({ nodeInternals: apiAndDb() });
        viewportReady();
      },
      lift: (): void => {
        flowChanges({ width: PANE_WIDTH, height: PANE_HEIGHT });
      },
    },
    {
      name: "the pane has no height yet",
      arrange: (): void => {
        flowChanges({ nodeInternals: apiAndDb(), width: PANE_WIDTH });
        viewportReady();
      },
      lift: (): void => {
        flowChanges({ height: PANE_HEIGHT });
      },
    },
    {
      name: "the viewport is not initialized",
      arrange: (): void => {
        flowChanges({
          nodeInternals: apiAndDb(),
          width: PANE_WIDTH,
          height: PANE_HEIGHT,
        });
      },
      lift: (): void => {
        viewportReady();
      },
    },
  ];

  test.each(HOLDUPS)(
    "does not fit while $name, then fits once, with the options it was given",
    (holdup: Holdup) => {
      const guard: RenderedGuard = renderGuard();
      guard.autoFrame.current = false;
      holdup.arrange();
      expect(mockFitView).not.toHaveBeenCalled();
      expect(guard.autoFrame.current).toBe(false);

      holdup.lift();
      expect(mockFitView).toHaveBeenCalledTimes(1);
      expect(mockFitView).toHaveBeenCalledWith(FIT_VIEW_OPTIONS);
      // A fit makes the view the automatic framing.
      expect(guard.autoFrame.current).toBe(true);
    },
  );

  test("never fits a drawing with no cards in it", () => {
    renderGuard({ drawingKey: "" });
    drawnAndReady(holding());
    flowChanges({ width: 1000 });
    expect(mockFitView).not.toHaveBeenCalled();
  });

  test("fits a drawing once: panning, re-measuring and re-rendering leave the view alone", () => {
    const guard: RenderedGuard = renderGuard();
    drawnAndReady();
    expect(mockFitView).toHaveBeenCalledTimes(1);

    // The user pans and zooms.
    flowChanges({ transform: [-120, 40, 0.8] });
    // React Flow takes the map's rebuilt cards, their sizes carried over.
    flowChanges({ nodeInternals: apiAndDb() });
    // React Flow measures a card at a new size.
    flowChanges({
      nodeInternals: holding(
        measuredCard("api", 0, 0, 240, 96),
        measuredCard("db", 400, 200),
      ),
    });
    /*
     * The #4117 path: the same drawing sent back to unmeasured by a new nodes
     * array, then measured again. It is still the drawing on screen.
     */
    flowChanges({
      nodeInternals: holding(
        unmeasuredCard("api", 0, 0),
        unmeasuredCard("db", 400, 200),
      ),
    });
    flowChanges({ nodeInternals: apiAndDb() });
    // The map renders the guard again with the same drawing.
    guard.rerender({});

    expect(mockFitView).toHaveBeenCalledTimes(1);
    expect(guard.autoFrame.current).toBe(true);
    // Nor is the view nudged back inside the pan extent: nothing was resized.
    expect(mockTranslateBy).not.toHaveBeenCalled();
    expect(mockSetViewport).not.toHaveBeenCalled();
  });

  test("a fit React Flow refuses counts for nothing: it is tried again on the next change, until one lands", () => {
    mockFitView.mockReturnValue(false);
    const guard: RenderedGuard = renderGuard();
    guard.autoFrame.current = false;
    drawnAndReady();
    expect(mockFitView).toHaveBeenCalledTimes(1);
    // Nothing recorded: the view has not become the automatic framing...
    expect(guard.autoFrame.current).toBe(false);

    /*
     * ...and the drawing still counts as never framed, so a resized pane
     * tries again even though the view is not the automatic framing.
     */
    flowChanges({ width: 1000 });
    expect(mockFitView).toHaveBeenCalledTimes(2);
    expect(guard.autoFrame.current).toBe(false);

    // React Flow re-measuring the drawing tries again, and this time it lands.
    mockFitView.mockReturnValue(true);
    flowChanges({
      nodeInternals: holding(
        measuredCard("api", 0, 0),
        unmeasuredCard("db", 400, 200),
      ),
    });
    expect(mockFitView).toHaveBeenCalledTimes(2);
    flowChanges({ nodeInternals: apiAndDb() });
    expect(mockFitView).toHaveBeenCalledTimes(3);
    expect(mockFitView).toHaveBeenLastCalledWith(FIT_VIEW_OPTIONS);
    expect(guard.autoFrame.current).toBe(true);

    // That one is recorded: the drawing measured again in the same pane is left alone.
    flowChanges({
      nodeInternals: holding(
        measuredCard("api", 0, 0),
        unmeasuredCard("db", 400, 200),
      ),
    });
    flowChanges({ nodeInternals: apiAndDb() });
    expect(mockFitView).toHaveBeenCalledTimes(3);
  });

  test("a refused fit is owed: a re-measure that leaves every card measured tries it again, and nothing is recorded until it lands", () => {
    mockFitView.mockReturnValue(false);
    const guard: RenderedGuard = renderGuard();
    guard.autoFrame.current = false;
    drawnAndReady();
    expect(mockFitView).toHaveBeenCalledTimes(1);

    // React Flow measures a card at a new size: the drawing is never unmeasured.
    flowChanges({
      nodeInternals: holding(
        measuredCard("api", 0, 0, 240, 96),
        measuredCard("db", 400, 200),
      ),
    });
    expect(mockFitView).toHaveBeenCalledTimes(2);
    // React Flow takes the map's rebuilt cards, their sizes carried over.
    flowChanges({
      nodeInternals: holding(
        measuredCard("api", 0, 0, 240, 96),
        measuredCard("db", 400, 200),
      ),
    });
    expect(mockFitView).toHaveBeenCalledTimes(3);
    expect(mockFitView).toHaveBeenLastCalledWith(FIT_VIEW_OPTIONS);

    /*
     * Nothing is recorded: the view is not the automatic framing, and the
     * owed fit still comes before the user's view - a resize tries it
     * rather than keeping the view inside the pan extent.
     */
    expect(guard.autoFrame.current).toBe(false);
    flowChanges({ width: 1000 });
    expect(mockFitView).toHaveBeenCalledTimes(4);
    expect(mockTranslateBy).not.toHaveBeenCalled();
    expect(guard.autoFrame.current).toBe(false);

    // The next re-measure tries it again, and it lands.
    mockFitView.mockReturnValue(true);
    flowChanges({ nodeInternals: apiAndDb() });
    expect(mockFitView).toHaveBeenCalledTimes(5);
    expect(mockFitView).toHaveBeenLastCalledWith(FIT_VIEW_OPTIONS);
    expect(guard.autoFrame.current).toBe(true);

    // Recorded: nothing more is owed.
    flowChanges({ nodeInternals: apiAndDb() });
    flowChanges({ transform: [-40, 0, 1] });
    guard.rerender({});
    expect(mockFitView).toHaveBeenCalledTimes(5);
  });

  test("a re-fit React Flow refuses after a resize is still owed once the size has settled: the next re-measure lands it", () => {
    const guard: RenderedGuard = renderGuard();
    drawnAndReady();
    expect(mockFitView).toHaveBeenCalledTimes(1);

    // A narrower window while the view is the automatic framing: refused.
    mockFitView.mockReturnValue(false);
    flowChanges({ width: 640 });
    expect(mockFitView).toHaveBeenCalledTimes(2);

    /*
     * The pane has not changed size since, and the drawing was fitted
     * before; the fit is still owed all the same.
     */
    mockFitView.mockReturnValue(true);
    flowChanges({ nodeInternals: apiAndDb() });
    expect(mockFitView).toHaveBeenCalledTimes(3);
    expect(mockFitView).toHaveBeenLastCalledWith(FIT_VIEW_OPTIONS);
    expect(guard.autoFrame.current).toBe(true);

    // Landed, so nothing more is owed.
    flowChanges({ nodeInternals: apiAndDb() });
    expect(mockFitView).toHaveBeenCalledTimes(3);
  });

  test("a re-fit still owed from a resize is dropped once the user has taken the view: it is theirs to keep", () => {
    const guard: RenderedGuard = renderGuard();
    drawnAndReady();
    expect(mockFitView).toHaveBeenCalledTimes(1);

    // A narrower window while the view is the automatic framing: the re-fit is refused.
    mockFitView.mockReturnValue(false);
    flowChanges({ width: 640 });
    expect(mockFitView).toHaveBeenCalledTimes(2);
    mockFitView.mockReturnValue(true);

    // Before it lands, the user pans and the map clears autoFrame; then React Flow re-measures the drawing.
    guard.autoFrame.current = false;
    flowChanges({ transform: [-120, 0, 1] });
    flowChanges({ nodeInternals: apiAndDb() });
    expect(mockFitView).toHaveBeenCalledTimes(2);
    expect(guard.autoFrame.current).toBe(false);

    // Their view is kept through the next resize too, inside the pan extent.
    flowChanges({ width: 560 });
    expect(mockTranslateBy).toHaveBeenCalledTimes(1);
    expect(mockFitView).toHaveBeenCalledTimes(2);

    /*
     * Dropped, not put off: once Fit to screen (the map's own fit) makes the
     * view the automatic framing again, a re-measure fits nothing.
     */
    guard.autoFrame.current = true;
    flowChanges({ nodeInternals: apiAndDb() });
    expect(mockFitView).toHaveBeenCalledTimes(2);
    expect(guard.autoFrame.current).toBe(true);
  });

  test("a new drawing's fit, refused, is still owed after the user takes the view: the next re-measure lands it", () => {
    const guard: RenderedGuard = renderGuard();
    drawnAndReady();
    expect(mockFitView).toHaveBeenCalledTimes(1);

    // The map asks for another drawing, and React Flow refuses its fit.
    mockFitView.mockReturnValue(false);
    guard.rerender({ drawingKey: "api|cache" });
    flowChanges({
      nodeInternals: holding(
        measuredCard("api", 0, 0),
        measuredCard("cache", 400, 0),
      ),
    });
    expect(mockFitView).toHaveBeenCalledTimes(2);
    mockFitView.mockReturnValue(true);

    // The user pans before it lands, and the map clears autoFrame.
    guard.autoFrame.current = false;
    flowChanges({ transform: [-120, 0, 1] });
    expect(mockFitView).toHaveBeenCalledTimes(2);

    // A new drawing is framed whoever has the view: React Flow re-measuring it tries again.
    flowChanges({
      nodeInternals: holding(
        measuredCard("api", 0, 0),
        measuredCard("cache", 400, 0),
      ),
    });
    expect(mockFitView).toHaveBeenCalledTimes(3);
    expect(mockFitView).toHaveBeenLastCalledWith(FIT_VIEW_OPTIONS);
    expect(guard.autoFrame.current).toBe(true);
  });

  test("a new drawing is fitted even after the user moved the view, which is the automatic framing again", () => {
    const guard: RenderedGuard = renderGuard();
    drawnAndReady();
    expect(mockFitView).toHaveBeenCalledTimes(1);

    // The user pans and zooms; the map clears autoFrame.
    guard.autoFrame.current = false;
    flowChanges({ transform: [-300, -120, 0.6] });

    // The map asks for another drawing. React Flow still holds the old one.
    guard.rerender({ drawingKey: "api|cache" });
    expect(mockFitView).toHaveBeenCalledTimes(1);

    // React Flow takes it; the new card is measured a frame later.
    flowChanges({
      nodeInternals: holding(
        measuredCard("api", 0, 0),
        unmeasuredCard("cache", 400, 0),
      ),
    });
    expect(mockFitView).toHaveBeenCalledTimes(1);
    flowChanges({
      nodeInternals: holding(
        measuredCard("api", 0, 0),
        measuredCard("cache", 400, 0),
      ),
    });
    expect(mockFitView).toHaveBeenCalledTimes(2);
    expect(mockFitView).toHaveBeenLastCalledWith(FIT_VIEW_OPTIONS);
    expect(guard.autoFrame.current).toBe(true);

    // Going back to the first drawing is a change too.
    guard.autoFrame.current = false;
    guard.rerender({ drawingKey: DRAWING_KEY });
    flowChanges({ nodeInternals: apiAndDb() });
    expect(mockFitView).toHaveBeenCalledTimes(3);
    expect(guard.autoFrame.current).toBe(true);
  });

  test("a resized pane is fitted again while the view is the automatic framing, and left alone once the user moved it", () => {
    const guard: RenderedGuard = renderGuard();
    drawnAndReady();
    expect(mockFitView).toHaveBeenCalledTimes(1);

    // A narrower window: the drawing is framed again.
    flowChanges({ width: 640 });
    expect(mockFitView).toHaveBeenCalledTimes(2);
    // So is a taller canvas.
    flowChanges({ height: 700 });
    expect(mockFitView).toHaveBeenCalledTimes(3);

    // The user zooms in; a resize now keeps their view.
    guard.autoFrame.current = false;
    flowChanges({ width: 720, height: 540 });
    expect(mockFitView).toHaveBeenCalledTimes(3);
    expect(guard.autoFrame.current).toBe(false);

    // Fit to screen makes the view the automatic framing again: a later resize fits.
    guard.autoFrame.current = true;
    flowChanges({ width: 900, height: 500 });
    expect(mockFitView).toHaveBeenCalledTimes(4);
    expect(mockFitView).toHaveBeenLastCalledWith(FIT_VIEW_OPTIONS);
    expect(guard.autoFrame.current).toBe(true);
  });

  test("a resize is judged against the last pane size the guard saw: after Fit to screen, going back to the size of its own last fit is fitted", () => {
    const guard: RenderedGuard = renderGuard();
    drawnAndReady();
    // Fitted 800 wide.
    expect(mockFitView).toHaveBeenCalledTimes(1);

    // The user pans, and the map clears autoFrame. A wider window keeps their view.
    guard.autoFrame.current = false;
    flowChanges({ transform: [-200, 0, 1] });
    flowChanges({ width: 1000 });
    expect(mockFitView).toHaveBeenCalledTimes(1);
    expect(mockTranslateBy).toHaveBeenCalledTimes(1);

    // Fit to screen: the map fits the view itself, and sets autoFrame.
    guard.autoFrame.current = true;
    flowChanges({ transform: [100, 120, 1] });

    // Back to 800 wide, the width of the guard's last fit: a resize all the same.
    flowChanges({ width: PANE_WIDTH });
    expect(mockFitView).toHaveBeenCalledTimes(2);
    expect(mockFitView).toHaveBeenLastCalledWith(FIT_VIEW_OPTIONS);
    expect(guard.autoFrame.current).toBe(true);
    // A fit, not the user's view kept.
    expect(mockTranslateBy).toHaveBeenCalledTimes(1);
  });

  test("a resize while the user has the view re-applies the pan extent then and there, and fits nothing", () => {
    const guard: RenderedGuard = renderGuard();
    drawnAndReady();
    expect(mockFitView).toHaveBeenCalledTimes(1);

    // While the view is the automatic framing, a resize fits the drawing again instead.
    flowChanges({ width: 640 });
    expect(mockFitView).toHaveBeenCalledTimes(2);
    expect(mockTranslateBy).not.toHaveBeenCalled();

    // The user zooms in and pans; then the window narrows and the canvas shortens.
    guard.autoFrame.current = false;
    flowChanges({ transform: [-300, -100, 1.1] });
    flowChanges({ width: 560, height: 540 });
    // d3-zoom applies the extent now, moving nothing the extent allows.
    expect(mockTranslateBy.mock.calls).toEqual([[D3_SELECTION, 0, 0]]);
    expect(mockTranslateBy.mock.calls[0]?.[0]).toBe(D3_SELECTION);
    expect(mockFitView).toHaveBeenCalledTimes(2);
    expect(guard.autoFrame.current).toBe(false);

    // Only a resize does: re-measured cards, a pan, a re-render and the same size again do not.
    flowChanges({ nodeInternals: apiAndDb() });
    flowChanges({ transform: [-320, -100, 1.1] });
    guard.rerender({});
    flowChanges({ width: 560, height: 540 });
    expect(mockTranslateBy).toHaveBeenCalledTimes(1);
    expect(mockFitView).toHaveBeenCalledTimes(2);
  });

  test("does not fit while React Flow's record of the pane size is not the size the page gives it, then fits once", () => {
    const guard: RenderedGuard = renderGuard();
    guard.autoFrame.current = false;
    // The page has laid the canvas out 400 high; React Flow still has it at 600.
    const flow: FlowElement = flowElement(1000, 400);
    flowChanges({
      domNode: flow.domNode,
      nodeInternals: apiAndDb(),
      width: 1000,
      height: 600,
    });
    viewportReady();
    expect(mockFitView).not.toHaveBeenCalled();
    // Other changes do not get a fit in first.
    flowChanges({ nodeInternals: apiAndDb() });
    expect(mockFitView).not.toHaveBeenCalled();
    expect(guard.autoFrame.current).toBe(false);

    // React Flow's ResizeObserver catches up: one fit, in the canvas on the page.
    flowChanges({ height: 400 });
    expect(mockFitView).toHaveBeenCalledTimes(1);
    expect(mockFitView).toHaveBeenCalledWith(FIT_VIEW_OPTIONS);
    expect(guard.autoFrame.current).toBe(true);

    // Exactly one: React Flow learning the size is not a resize to fit again for.
    flowChanges({ nodeInternals: apiAndDb() });
    guard.rerender({});
    expect(mockFitView).toHaveBeenCalledTimes(1);
  });

  test("a canvas resized again before React Flow has seen the first resize is fitted once, for the size it ends at", () => {
    const flow: FlowElement = flowElement(PANE_WIDTH, PANE_HEIGHT);
    const guard: RenderedGuard = renderGuard();
    flowChanges({ domNode: flow.domNode });
    drawnAndReady();
    expect(mockFitView).toHaveBeenCalledTimes(1);

    /*
     * The window narrows twice in a frame: React Flow records the first
     * width while the page already has the canvas at the second.
     */
    flow.layOut(640, PANE_HEIGHT);
    flowChanges({ width: 700 });
    expect(mockFitView).toHaveBeenCalledTimes(1);
    flowChanges({ width: 640 });
    expect(mockFitView).toHaveBeenCalledTimes(2);
    expect(mockFitView).toHaveBeenLastCalledWith(FIT_VIEW_OPTIONS);

    // Once the user has the view, the extent waits for the size the same way.
    guard.autoFrame.current = false;
    flow.layOut(560, 500);
    flowChanges({ width: 600, height: 500 });
    expect(mockTranslateBy).not.toHaveBeenCalled();
    flowChanges({ width: 560 });
    expect(mockTranslateBy).toHaveBeenCalledTimes(1);
    expect(mockFitView).toHaveBeenCalledTimes(2);
  });

  test("a canvas hidden and shown again at its size is not a resize: React Flow's 500 x 500 meanwhile is never taken for one", () => {
    const flow: FlowElement = flowElement(PANE_WIDTH, PANE_HEIGHT);
    const guard: RenderedGuard = renderGuard();
    flowChanges({ domNode: flow.domNode });
    drawnAndReady();
    expect(mockFitView).toHaveBeenCalledTimes(1);

    // Hidden: the page gives the canvas no size, and React Flow falls back to 500 x 500.
    flow.layOut(0, 0);
    flowChanges({ width: 500, height: 500 });
    // Shown again as it was: the fitted view still fits it.
    canvasResized(flow, PANE_WIDTH, PANE_HEIGHT);
    expect(mockFitView).toHaveBeenCalledTimes(1);

    // Nor, once the user has the view, is there an extent to re-apply.
    guard.autoFrame.current = false;
    flow.layOut(0, 0);
    flowChanges({ width: 500, height: 500 });
    canvasResized(flow, PANE_WIDTH, PANE_HEIGHT);
    expect(mockTranslateBy).not.toHaveBeenCalled();
    expect(mockFitView).toHaveBeenCalledTimes(1);
    expect(guard.autoFrame.current).toBe(false);
  });

  test("a new drawing that changes the canvas height is fitted once, in the canvas it ends up in", () => {
    const flow: FlowElement = flowElement(PANE_WIDTH, PANE_HEIGHT);
    const guard: RenderedGuard = renderGuard();
    flowChanges({ domNode: flow.domNode });
    drawnAndReady();
    expect(mockFitView).toHaveBeenCalledTimes(1);

    // The map asks for a smaller drawing, and the page gives it a shorter canvas.
    guard.rerender({ drawingKey: "api" });
    flow.layOut(PANE_WIDTH, 400);
    // React Flow takes the drawing and measures it before it has seen the new size.
    flowChanges({ nodeInternals: holding(measuredCard("api", 0, 0)) });
    expect(mockFitView).toHaveBeenCalledTimes(1);

    // Then it has: the one fit, for the new drawing in the new canvas.
    flowChanges({ height: 400 });
    expect(mockFitView).toHaveBeenCalledTimes(2);
    expect(mockFitView).toHaveBeenLastCalledWith(FIT_VIEW_OPTIONS);

    flowChanges({ nodeInternals: holding(measuredCard("api", 0, 0)) });
    expect(mockFitView).toHaveBeenCalledTimes(2);
  });

  test("does not fit a canvas the page has not laid out, for all React Flow's fallback says it is 500 x 500", () => {
    const guard: RenderedGuard = renderGuard();
    guard.autoFrame.current = false;
    // A canvas with no size on the page: React Flow records 500 x 500.
    const flow: FlowElement = flowElement(0, 0);
    flowChanges({
      domNode: flow.domNode,
      nodeInternals: apiAndDb(),
      width: 500,
      height: 500,
    });
    viewportReady();
    flowChanges({ nodeInternals: apiAndDb() });
    expect(mockFitView).not.toHaveBeenCalled();
    expect(guard.autoFrame.current).toBe(false);

    // Laid out, and measured by React Flow: now there is a canvas to fit.
    canvasResized(flow, PANE_WIDTH, PANE_HEIGHT);
    expect(mockFitView).toHaveBeenCalledTimes(1);
    expect(guard.autoFrame.current).toBe(true);
  });
});

describe("following keyboard focus", () => {
  let matches: SpyInstance<(selectors: string) => boolean>;
  let eventTime: SpyInstance<() => number>;

  beforeEach(() => {
    focusCameBy = "keyboard";
    matches = answerFocusVisible();
    pageClockMs = 0;
    eventTime = readEventTimesOffPageClock();
    thrownInListeners.splice(0);
    window.addEventListener("error", noteThrown);
  });

  afterEach(() => {
    matches.mockRestore();
    eventTime.mockRestore();
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    window.removeEventListener("error", noteThrown);
    // Whatever a test did, nothing the guard does on focus or scroll threw.
    expect(thrownInListeners).toEqual([]);
  });

  /*
   * At half size db's card is 110 x 40 on screen, its top-left corner at
   * (240 + x, 220 + y) for a view at [x, y, 0.5]. The canvas spans
   * (40, 120)-(840, 720), and a focused card is brought 24 px inside it:
   * within (64, 144)-(816, 696).
   */
  interface OffCanvas {
    name: string;
    /* The view when db takes focus: the automatic framing of a larger map. */
    transform: FlowTransform;
    /* The least pan that brings db 24 px inside, in screen pixels. */
    pan: XYPosition;
  }

  const OFF_CANVAS: Array<OffCanvas> = [
    {
      // db at (340, 800)-(450, 840): its bottom comes up to 696.
      name: "below the canvas",
      transform: [100, 580, 0.5],
      pan: { x: 0, y: -144 },
    },
    {
      // db at (900, 270)-(1010, 310): its right comes in to 816.
      name: "right of the canvas",
      transform: [660, 50, 0.5],
      pan: { x: -194, y: 0 },
    },
    {
      // db at (340, 20)-(450, 60): its top comes down to 144.
      name: "above the canvas",
      transform: [100, -200, 0.5],
      pan: { x: 0, y: 124 },
    },
    {
      // db at (-150, 270)-(-40, 310): its left comes in to 64.
      name: "left of the canvas",
      transform: [-390, 50, 0.5],
      pan: { x: 214, y: 0 },
    },
    {
      // db at (340, 700)-(450, 740).
      name: "cut off by the canvas's bottom edge",
      transform: [100, 480, 0.5],
      pan: { x: 0, y: -44 },
    },
    {
      // db at (900, 800)-(1010, 840): both axes in one pan.
      name: "past the canvas's bottom-right corner",
      transform: [660, 580, 0.5],
      pan: { x: -194, y: -144 },
    },
    {
      // db at (707, 657)-(817, 697).
      name: "a pixel short of 24 px inside the bottom-right corner",
      transform: [467, 437, 0.5],
      pan: { x: -1, y: -1 },
    },
  ];

  test.each(OFF_CANVAS)(
    "focus on a card $name pans the least that brings it 24 px inside the canvas, and the view is the user's from then on",
    (offCanvas: OffCanvas) => {
      const guard: RenderedGuard = renderGuard();
      const map: MapOnPage = mapOnPage();
      flowChanges({ transform: offCanvas.transform });
      expect(guard.autoFrame.current).toBe(true);

      tabOnto(map.db);
      // One pan, in screen pixels whatever the zoom.
      expect(pansAskedFor()).toEqual([offCanvas.pan]);
      const [x, y, zoom] = offCanvas.transform;
      expect(mockFlowStore.state.transform).toEqual([
        x + offCanvas.pan.x,
        y + offCanvas.pan.y,
        zoom,
      ]);
      // The view moved: it is no longer the automatic framing.
      expect(guard.autoFrame.current).toBe(false);
      expect(mockFitView).toHaveBeenCalledTimes(1);
    },
  );

  interface InView {
    name: string;
    transform: FlowTransform;
  }

  const IN_VIEW: Array<InView> = [
    // db at (340, 270)-(450, 310).
    { name: "in the middle of the canvas", transform: FITTED_TRANSFORM },
    // db at (64, 144)-(174, 184).
    {
      name: "exactly 24 px inside the top-left corner",
      transform: [-176, -76, 0.5],
    },
    // db at (706, 656)-(816, 696).
    {
      name: "exactly 24 px inside the bottom-right corner",
      transform: [466, 436, 0.5],
    },
  ];

  test.each(IN_VIEW)(
    "focus on a card $name moves nothing, and the view stays the automatic framing",
    (inView: InView) => {
      const guard: RenderedGuard = renderGuard();
      const map: MapOnPage = mapOnPage();
      flowChanges({ transform: inView.transform });

      tabOnto(map.db);
      expect(pansAskedFor()).toEqual([]);
      expect(mockFlowStore.state.transform).toEqual(inView.transform);
      expect(guard.autoFrame.current).toBe(true);
    },
  );

  test("focus on a connection is followed too, and one longer than the canvas only has to show in part", () => {
    const guard: RenderedGuard = renderGuard();
    const map: MapOnPage = mapOnPage();
    /*
     * A connection across the whole drawing and more, below the canvas: on
     * screen at (-360, 820)-(1140, 850), wider than the canvas.
     */
    const connection: SVGGElement = map.drawConnection({
      x: -1000,
      y: 1300,
      width: 3000,
      height: 60,
    });

    tabOnto(connection);
    // Up, to 24 px inside the bottom edge; across, it already shows.
    expect(pansAskedFor()).toEqual([{ x: 0, y: -154 }]);
    expect(mockFlowStore.state.transform).toEqual([100, -104, 0.5]);
    expect(guard.autoFrame.current).toBe(false);
  });

  test("focus on the map's controls moves nothing: React Flow keeps them on the canvas, outside its renderer", () => {
    const guard: RenderedGuard = renderGuard();
    const map: MapOnPage = mapOnPage();

    // The Fit to screen button, at (55, 678)-(81, 705): nearer the edges than a focused card is left.
    tabOnto(map.fitViewButton);
    expect(pansAskedFor()).toEqual([]);
    expect(mockFlowStore.state.transform).toEqual(FITTED_TRANSFORM);
    expect(guard.autoFrame.current).toBe(true);
  });

  /*
   * Tab onto a card outside the view the way Chromium goes about it: it
   * scrolls React Flow's element to show the card, centring it, and only
   * then moves focus, firing focusin; the scroll's own event comes a frame
   * later.
   */
  interface ChromiumTab {
    name: string;
    /* The view when db takes focus: the automatic framing of a larger map. */
    transform: FlowTransform;
    /* How far Chromium scrolls React Flow's element to centre db. */
    scroll: XYPosition;
    /* db's top-left corner on screen through that scroll. */
    shows: XYPosition;
    /* The one pan: the least that brings db 24 px inside. */
    pan: XYPosition;
    /* db's top-left corner on screen once it is followed. */
    lands: XYPosition;
  }

  const CHROMIUM_TABS: Array<ChromiumTab> = [
    {
      // db at (340, 3768)-(450, 3808): its bottom comes up to 696.
      name: "far below the canvas",
      transform: [100, 3548, 0.5],
      scroll: { x: 0, y: 3368 },
      shows: { x: 340, y: 400 },
      pan: { x: 0, y: -3112 },
      lands: { x: 340, y: 656 },
    },
    {
      // db at (2340, 3768)-(2450, 3808): its bottom-right corner comes in to (816, 696).
      name: "far past the canvas's bottom-right corner",
      transform: [2100, 3548, 0.5],
      scroll: { x: 1955, y: 3368 },
      shows: { x: 385, y: 400 },
      pan: { x: -1634, y: -3112 },
      lands: { x: 706, y: 656 },
    },
  ];

  test.each(CHROMIUM_TABS)(
    "Tab onto a card $name, which Chromium scrolls React Flow's element to before focusin, is followed with one pan, and the element is left unscrolled",
    (tab: ChromiumTab) => {
      const guard: RenderedGuard = renderGuard();
      const map: MapOnPage = mapOnPage();
      flowChanges({ transform: tab.transform });

      browserHasScrolled(map.domNode, tab.scroll);
      // Through the scroll, db shows in the middle of the canvas.
      expect(map.db.getBoundingClientRect()).toMatchObject({
        left: tab.shows.x,
        top: tab.shows.y,
      });
      tabOnto(map.db);
      /*
       * The pan shows db instead of the scroll, so the scroll is dropped
       * first, and the pan is the least that brings db 24 px inside.
       */
      expect(map.domNode.scrollLeft).toBe(0);
      expect(map.domNode.scrollTop).toBe(0);
      expect(pansAskedFor()).toEqual([tab.pan]);

      // The scroll's event, a frame later, finds nothing scrolled: no second pan.
      scrollEventArrives(map.domNode);
      expect(pansAskedFor()).toEqual([tab.pan]);
      const [x, y, zoom] = tab.transform;
      expect(mockFlowStore.state.transform).toEqual([
        x + tab.pan.x,
        y + tab.pan.y,
        zoom,
      ]);
      // db is on the canvas, 24 px inside its edge.
      expect(map.db.getBoundingClientRect()).toMatchObject({
        left: tab.lands.x,
        top: tab.lands.y,
        right: tab.lands.x + 110,
        bottom: tab.lands.y + 40,
      });
      expect(guard.autoFrame.current).toBe(false);
    },
  );

  test("the page is then scrolled to the focused card where the pan has put it, as little as shows it", () => {
    renderGuard();
    const map: MapOnPage = mapOnPage();
    const pageScrolls: Array<PageScroll> = pageScrollsRecorded();
    // db far below the canvas: Chromium scrolls React Flow's element to centre it, then fires focusin.
    flowChanges({ transform: [100, 3548, 0.5] });
    browserHasScrolled(map.domNode, { x: 0, y: 3368 });

    tabOnto(map.db);
    expect(pansAskedFor()).toEqual([{ x: 0, y: -3112 }]);
    /*
     * The browser may have scrolled the page towards where db was. The page
     * is scrolled to db once, the nearest way on both axes...
     */
    expect(pageScrolls).toHaveLength(1);
    expect(pageScrolls[0]?.element).toBe(map.db);
    expect(pageScrolls[0]?.options).toEqual({
      block: "nearest",
      inline: "nearest",
    });
    // ...to where db is drawn by then: where the pan put it, 24 px inside the canvas's bottom edge.
    expect(pageScrolls[0]?.box).toMatchObject({
      left: 340,
      top: 656,
      right: 450,
      bottom: 696,
    });
  });

  test("focus is followed all the same in a DOM without scrollIntoView, and nothing throws for the want of it", () => {
    const guard: RenderedGuard = renderGuard();
    const map: MapOnPage = mapOnPage();
    // jsdom has none.
    expect("scrollIntoView" in map.db).toBe(false);
    // db below the canvas.
    flowChanges({ transform: [100, 580, 0.5] });

    tabOnto(map.db);
    expect(pansAskedFor()).toEqual([{ x: 0, y: -144 }]);
    expect(guard.autoFrame.current).toBe(false);
    expect(thrownInListeners).toEqual([]);
  });

  test("focus a pointer gives a card is not followed: the card is under the pointer, and moving the map between press and release would lose the click", () => {
    const guard: RenderedGuard = renderGuard();
    const map: MapOnPage = mapOnPage();
    const pageScrolls: Array<PageScroll> = pageScrollsRecorded();
    // db cut off by the canvas's bottom edge, at (340, 700)-(450, 740): Tab would bring it up 44 px.
    flowChanges({ transform: [100, 480, 0.5] });

    /*
     * A press on db's top focuses it. Should the browser scroll React Flow's
     * element to show the rest of db, that scroll is not dropped either:
     * dropping it would move db under the pointer just the same.
     */
    browserHasScrolled(map.domNode, { x: 0, y: 20 });
    pointerFocuses(map.db);
    expect(map.db.matches(":focus-visible")).toBe(false);

    expect(pansAskedFor()).toEqual([]);
    expect(map.domNode.scrollTop).toBe(20);
    expect(pageScrolls).toEqual([]);
    expect(mockFlowStore.state.transform).toEqual([100, 480, 0.5]);
    expect(guard.autoFrame.current).toBe(true);
  });

  test("focus the browser hands back as the window regains focus is not followed, whatever the view did meanwhile; 100 ms on, focus is the user's again", () => {
    const guard: RenderedGuard = renderGuard();
    const map: MapOnPage = mapOnPage();
    const api: HTMLDivElement = map.drawCard(API_BOX);
    // Tab onto db, where it shows: nothing moves.
    tabOnto(map.db);
    expect(pansAskedFor()).toEqual([]);

    /*
     * The user goes to another tab, and the map is framed afresh meanwhile
     * (new data, say), leaving db below the canvas at (340, 800)-(450, 840)
     * and api cut off by its bottom edge at (140, 700)-(250, 740).
     */
    flowChanges({ transform: [100, 580, 0.5] });

    /*
     * A minute on, the user comes back: the window regains focus, and 99 ms
     * later the browser hands focus back to db, focus ring and all.
     */
    pageClockMs = 60000;
    windowRegainsFocus();
    pageClockMs = 60099;
    focusHandedBackTo(map.db);
    expect(map.db.matches(":focus-visible")).toBe(true);
    // The view is left as it is, and it is still the automatic framing.
    expect(pansAskedFor()).toEqual([]);
    expect(mockFlowStore.state.transform).toEqual([100, 580, 0.5]);
    expect(guard.autoFrame.current).toBe(true);

    // 100 ms after the window regained focus, Tab onto api is the user's, and is followed.
    pageClockMs = 60100;
    tabOnto(api);
    expect(pansAskedFor()).toEqual([{ x: 0, y: -44 }]);
    expect(guard.autoFrame.current).toBe(false);
  });

  test("a pan the pan extent refuses leaves the view the automatic framing, whether it follows focus or undoes a scroll", () => {
    panByMoves = false;
    const guard: RenderedGuard = renderGuard();
    const map: MapOnPage = mapOnPage();
    /*
     * The automatic framing of a larger map, the view at the edge of the pan
     * extent, with db at (340, 670)-(450, 710): on the canvas, but nearer its
     * bottom edge than a focused card is left.
     */
    flowChanges({ transform: [100, 450, 0.5] });

    tabOnto(map.db);
    expect(pansAskedFor()).toEqual([{ x: 0, y: -14 }]);
    expect(mockFlowStore.state.transform).toEqual([100, 450, 0.5]);
    expect(guard.autoFrame.current).toBe(true);

    /*
     * Find in page scrolls React Flow's element to a match lower down. The
     * scroll is undone all the same, so the map stays on its canvas; the pan
     * it becomes is refused, and so is the one to show db, still focused.
     */
    browserScrolls(map.domNode, 0, 120);
    expect(map.domNode.scrollLeft).toBe(0);
    expect(map.domNode.scrollTop).toBe(0);
    expect(pansAskedFor()).toEqual([
      { x: 0, y: -14 },
      { x: 0, y: -120 },
      { x: 0, y: -14 },
    ]);
    expect(mockFlowStore.state.transform).toEqual([100, 450, 0.5]);
    expect(guard.autoFrame.current).toBe(true);
  });

  test("a scroll of React Flow's element is undone and made the same pan, which takes the view from the automatic framing", () => {
    const guard: RenderedGuard = renderGuard();
    const map: MapOnPage = mapOnPage();
    expect(guard.autoFrame.current).toBe(true);

    // Find in page scrolls React Flow's element to a match past the canvas's bottom-right. Nothing of the map has focus.
    browserScrolls(map.domNode, 40, 300);
    // The element is back where it was, and all React Flow draws in it...
    expect(map.domNode.scrollLeft).toBe(0);
    expect(map.domNode.scrollTop).toBe(0);
    // ...and the view moves by as much instead, in screen pixels whatever the zoom.
    expect(pansAskedFor()).toEqual([{ x: -40, y: -300 }]);
    expect(mockFlowStore.state.transform).toEqual([60, -250, 0.5]);
    expect(guard.autoFrame.current).toBe(false);
    expect(mockFitView).toHaveBeenCalledTimes(1);

    // A scroll along one axis pans along that axis, from where the view now is.
    browserScrolls(map.domNode, 0, 120);
    expect(map.domNode.scrollTop).toBe(0);
    expect(pansAskedFor()).toEqual([
      { x: -40, y: -300 },
      { x: 0, y: -120 },
    ]);
    expect(mockFlowStore.state.transform).toEqual([60, -370, 0.5]);

    // So a resize now keeps the user's view, inside the pan extent, rather than fitting.
    canvasResized(map, 640, PANE_HEIGHT);
    expect(mockFitView).toHaveBeenCalledTimes(1);
    expect(mockTranslateBy).toHaveBeenCalledTimes(1);
  });

  interface ScrolledTo {
    name: string;
    /* Where the user dragged the view, with db off the canvas. */
    transform: FlowTransform;
    /* How far the browser scrolls React Flow's element to show db. */
    scroll: XYPosition;
    pans: Array<XYPosition>;
    /* The view the pans leave. */
    after: FlowTransform;
  }

  const SCROLLED_TO: Array<ScrolledTo> = [
    {
      /*
       * db at (770, 980)-(880, 1020). The least scroll that shows it leaves
       * it at (730, 680)-(840, 720), flush with the canvas's bottom-right
       * corner; a second pan brings it to (706, 656)-(816, 696).
       */
      name: "a card the scroll leaves at the canvas's edge is then brought 24 px inside",
      transform: [530, 760, 0.5],
      scroll: { x: 40, y: 300 },
      pans: [
        { x: -40, y: -300 },
        { x: -24, y: -24 },
      ],
      after: [466, 436, 0.5],
    },
    {
      /*
       * db at (340, 800)-(450, 840), centred as find in page centres a
       * match: the pan leaves it at (340, 400)-(450, 440).
       */
      name: "a card the scroll centres needs nothing more",
      transform: [100, 580, 0.5],
      scroll: { x: 0, y: 400 },
      pans: [{ x: 0, y: -400 }],
      after: [100, 180, 0.5],
    },
  ];

  test.each(SCROLLED_TO)(
    "a scroll to show the focused card is undone and made the same pan, and $name",
    (scrolledTo: ScrolledTo) => {
      const guard: RenderedGuard = renderGuard();
      const map: MapOnPage = mapOnPage();
      // db takes focus where it shows: nothing moves.
      tabOnto(map.db);
      expect(pansAskedFor()).toEqual([]);

      // The user drags db off the canvas, and the map clears autoFrame.
      guard.autoFrame.current = false;
      flowChanges({ transform: scrolledTo.transform });

      browserScrolls(map.domNode, scrolledTo.scroll.x, scrolledTo.scroll.y);
      expect(map.domNode.scrollLeft).toBe(0);
      expect(map.domNode.scrollTop).toBe(0);
      expect(pansAskedFor()).toEqual(scrolledTo.pans);
      expect(mockFlowStore.state.transform).toEqual(scrolledTo.after);
      expect(guard.autoFrame.current).toBe(false);
    },
  );

  test("a scroll while a card a pointer focused has focus is undone and made the same pan, and the card is left where the scroll put it", () => {
    const guard: RenderedGuard = renderGuard();
    const map: MapOnPage = mapOnPage();
    // A press on db, where it shows, focuses it: nothing moves.
    pointerFocuses(map.db);
    expect(pansAskedFor()).toEqual([]);

    // The user drags db off the canvas, and the map clears autoFrame.
    guard.autoFrame.current = false;
    flowChanges({ transform: [530, 760, 0.5] });

    /*
     * Find in page scrolls React Flow's element to a match in db, leaving db
     * flush with the canvas's bottom-right corner. The scroll is undone and
     * made the same pan, and that is all: had the keyboard focused db, it
     * would be brought 24 px inside as well (see above).
     */
    browserScrolls(map.domNode, 40, 300);
    expect(map.domNode.scrollLeft).toBe(0);
    expect(map.domNode.scrollTop).toBe(0);
    expect(pansAskedFor()).toEqual([{ x: -40, y: -300 }]);
    expect(mockFlowStore.state.transform).toEqual([490, 460, 0.5]);
    expect(map.db.getBoundingClientRect()).toMatchObject({
      left: 730,
      top: 680,
      right: 840,
      bottom: 720,
    });
  });

  test("a scroll event that finds nothing scrolled, as undoing a scroll fires, changes nothing, even with the focused card off the canvas", () => {
    const guard: RenderedGuard = renderGuard();
    const map: MapOnPage = mapOnPage();
    tabOnto(map.db);
    // The view moves on without the user (a re-fit, say), leaving db, still focused, below the canvas.
    flowChanges({ transform: [100, 580, 0.5] });

    browserScrolls(map.domNode, 0, 0);
    expect(pansAskedFor()).toEqual([]);
    expect(mockFlowStore.state.transform).toEqual([100, 580, 0.5]);
    // Nothing moved, so the view is still the automatic framing.
    expect(guard.autoFrame.current).toBe(true);
  });

  test("stops following once the guard is gone: focus and scrolls are left to the browser", () => {
    const guard: RenderedGuard = renderGuard();
    const map: MapOnPage = mapOnPage();
    // db below the canvas.
    flowChanges({ transform: [100, 580, 0.5] });
    guard.unmount();

    tabOnto(map.db);
    browserScrolls(map.domNode, 40, 300);
    // The element is left as the browser scrolled it, and nothing is panned.
    expect(map.domNode.scrollLeft).toBe(40);
    expect(map.domNode.scrollTop).toBe(300);
    expect(pansAskedFor()).toEqual([]);
    expect(mockFlowStore.state.transform).toEqual([100, 580, 0.5]);
  });

  test("leaves nothing listening on the window once it is gone", () => {
    const page: Window = window;
    const added: SpyInstance<
      (...args: Parameters<Window["addEventListener"]>) => void
    > = jest.spyOn(page, "addEventListener");
    const removed: SpyInstance<
      (...args: Parameters<Window["removeEventListener"]>) => void
    > = jest.spyOn(page, "removeEventListener");
    const forFocus: (
      calls: Array<Parameters<Window["removeEventListener"]>>,
    ) => Array<Parameters<Window["removeEventListener"]>> = (
      calls: Array<Parameters<Window["removeEventListener"]>>,
    ): Array<Parameters<Window["removeEventListener"]>> => {
      return calls.filter(
        (call: Parameters<Window["removeEventListener"]>): boolean => {
          return call[0] === "focus";
        },
      );
    };
    try {
      const guard: RenderedGuard = renderGuard();
      mapOnPage();
      // It listens for the window regaining focus...
      const listening: Array<Parameters<Window["removeEventListener"]>> =
        forFocus(added.mock.calls);
      expect(listening).toHaveLength(1);

      guard.unmount();
      // ...and once it is gone, it takes that same listener off, the same way.
      expect(forFocus(removed.mock.calls)).toEqual(listening);
    } finally {
      added.mockRestore();
      removed.mockRestore();
    }
  });
});

describe("isKeyboardFocus", () => {
  test("is whether the element matches :focus-visible, the focus a browser draws a ring for", () => {
    const card: HTMLDivElement = document.createElement("div");
    const matches: SpyInstance<(selectors: string) => boolean> = jest.spyOn(
      card,
      "matches",
    );
    matches.mockReturnValue(true);
    expect(isKeyboardFocus(card)).toBe(true);
    matches.mockReturnValue(false);
    expect(isKeyboardFocus(card)).toBe(false);
    expect(matches.mock.calls).toEqual([
      [":focus-visible"],
      [":focus-visible"],
    ]);
  });

  test("counts all focus as keyboard focus in a browser that cannot say: one that does not know :focus-visible throws", () => {
    const card: HTMLDivElement = document.createElement("div");
    jest.spyOn(card, "matches").mockImplementation((selectors: string) => {
      throw new DOMException(
        `'${selectors}' is not a valid selector`,
        "SyntaxError",
      );
    });
    expect(isKeyboardFocus(card)).toBe(true);
  });
});

describe("the pan extent", () => {
  test("is the measured drawing plus the pan margin, from where React Flow placed each card", () => {
    const guard: RenderedGuard = renderGuard();
    flowChanges({
      nodeInternals: holding(
        { ...measuredCard("api", 0, 0), positionAbsolute: { x: 100, y: 50 } },
        {
          ...measuredCard("db", 400, 200, 300, 120),
          positionAbsolute: { x: 500, y: 350 },
        },
      ),
    });
    // Measured boxes (100, 50)-(320, 130) and (500, 350)-(800, 470), grown by 50.
    expect(guard.onExtentChange).toHaveBeenCalledTimes(1);
    expect(guard.onExtentChange).toHaveBeenLastCalledWith([
      [50, 0],
      [850, 520],
    ]);
  });

  test("is reported once per distinct extent", () => {
    const guard: RenderedGuard = renderGuard();
    drawnAndReady();
    expect(guard.onExtentChange).toHaveBeenCalledTimes(1);
    expect(guard.onExtentChange).toHaveBeenLastCalledWith([
      [-50, -50],
      [670, 330],
    ]);

    // The same boxes again: rebuilt cards, a pan, a resize, a re-render.
    flowChanges({ nodeInternals: apiAndDb() });
    flowChanges({ transform: [-40, 10, 0.9], width: 700 });
    guard.rerender({});
    // Nor is rounding noise a new extent.
    flowChanges({
      nodeInternals: holding(
        measuredCard("api", 1e-9, 0),
        measuredCard("db", 400, 200),
      ),
    });
    expect(guard.onExtentChange).toHaveBeenCalledTimes(1);

    // A card measured at another size moves the edge.
    flowChanges({
      nodeInternals: holding(
        measuredCard("api", 0, 0),
        measuredCard("db", 400, 200, 300, 120),
      ),
    });
    expect(guard.onExtentChange).toHaveBeenCalledTimes(2);
    expect(guard.onExtentChange).toHaveBeenLastCalledWith([
      [-50, -50],
      [750, 370],
    ]);

    // So does another margin.
    guard.rerender({ panMargin: 80 });
    expect(guard.onExtentChange).toHaveBeenCalledTimes(3);
    expect(guard.onExtentChange).toHaveBeenLastCalledWith([
      [-80, -80],
      [780, 400],
    ]);
  });

  test("is not reported while a card is unmeasured or React Flow holds another drawing", () => {
    const guard: RenderedGuard = renderGuard();
    // React Flow still holds the drawing before this one...
    flowChanges({
      nodeInternals: holding(
        measuredCard("web", -600, 0),
        measuredCard("api", 0, 0),
      ),
      width: PANE_WIDTH,
      height: PANE_HEIGHT,
    });
    // ...then this one, before db is measured.
    flowChanges({
      nodeInternals: holding(
        measuredCard("api", 0, 0),
        unmeasuredCard("db", 400, 200),
      ),
    });
    expect(guard.onExtentChange).not.toHaveBeenCalled();
    flowChanges({ nodeInternals: apiAndDb() });
    expect(guard.onExtentChange).toHaveBeenCalledTimes(1);

    /*
     * The map moves on to a drawing React Flow has not taken yet: the old
     * extent stands until the new one is measured.
     */
    guard.rerender({ drawingKey: "api|cache" });
    flowChanges({
      nodeInternals: holding(
        measuredCard("api", 0, 0),
        unmeasuredCard("cache", 0, 300),
      ),
    });
    expect(guard.onExtentChange).toHaveBeenCalledTimes(1);
    flowChanges({
      nodeInternals: holding(
        measuredCard("api", 0, 0),
        measuredCard("cache", 0, 300),
      ),
    });
    expect(guard.onExtentChange).toHaveBeenCalledTimes(2);
    expect(guard.onExtentChange).toHaveBeenLastCalledWith([
      [-50, -50],
      [270, 430],
    ]);
  });

  test("is unbounded again once the guard is gone", () => {
    const guard: RenderedGuard = renderGuard();
    drawnAndReady();
    expect(guard.onExtentChange).toHaveBeenCalledTimes(1);
    guard.unmount();
    expect(guard.onExtentChange).toHaveBeenCalledTimes(2);
    expect(guard.onExtentChange).toHaveBeenLastCalledWith(
      UNBOUNDED_FLOW_EXTENT,
    );
  });
});

describe("mounted a second time with its refs kept, as StrictMode does", () => {
  test("the pan extent is reported again after the unmount withdrew it, rather than left unbounded", () => {
    drawnAndReadyBeforeMount();
    const guard: RenderedGuard = renderGuard({}, { strictMode: true });
    // Mounted, unmounted and mounted again: reported, withdrawn, reported.
    expect(guard.onExtentChange.mock.calls).toEqual([
      [API_AND_DB_EXTENT],
      [UNBOUNDED_FLOW_EXTENT],
      [API_AND_DB_EXTENT],
    ]);

    // And from then on once per distinct extent, as before.
    flowChanges({ nodeInternals: apiAndDb() });
    expect(guard.onExtentChange).toHaveBeenCalledTimes(3);
  });

  test("the instance and the in-view answer are reported again too", () => {
    drawnAndReadyBeforeMount();
    const guard: RenderedGuard = renderGuard({}, { strictMode: true });
    const reported: Array<unknown> = guard.onInstance.mock.calls.map(
      (call: Array<unknown>): unknown => {
        return call[0];
      },
    );
    expect(reported).toHaveLength(3);
    expect(reported[0]).toBe(mockFlowStore.instance);
    expect(reported[1]).toBeNull();
    expect(reported[2]).toBe(mockFlowStore.instance);
    expect(inViewReports(guard)).toEqual([true, true, true]);
  });

  test("the drawing is fitted once, not once per mount", () => {
    drawnAndReadyBeforeMount();
    const guard: RenderedGuard = renderGuard({}, { strictMode: true });
    expect(mockFitView).toHaveBeenCalledTimes(1);
    expect(mockFitView).toHaveBeenCalledWith(FIT_VIEW_OPTIONS);
    expect(guard.autoFrame.current).toBe(true);
  });
});

describe("whether the drawing is in view", () => {
  test("is in view while a measured card shows at least 8 px of itself on the pane", () => {
    const guard: RenderedGuard = renderGuard();
    drawnAndReady();
    // Panned so that only the right-hand 8 px of db (x 400-620) are left.
    flowChanges({ transform: [8 - 620, 0, 1] });
    expect(inViewReports(guard)).toEqual([true]);
    // One pixel further, a 7 px sliver is not a map.
    flowChanges({ transform: [7 - 620, 0, 1] });
    expect(inViewReports(guard)).toEqual([true, false]);
    flowChanges({ transform: [0, 0, 1] });
    expect(inViewReports(guard)).toEqual([true, false, true]);
  });

  test("is out of view once every card has left the pane", () => {
    const guard: RenderedGuard = renderGuard();
    drawnAndReady();
    flowChanges({ transform: [5000, 5000, 1] });
    expect(inViewReports(guard)).toEqual([true, false]);
    // Zoomed far out the cards are small, but they are back on the pane.
    flowChanges({ transform: [0, 0, 0.1] });
    expect(inViewReports(guard)).toEqual([true, false, true]);
  });

  test("is out of view while React Flow holds cards but has measured none", () => {
    const guard: RenderedGuard = renderGuard();
    flowChanges({
      nodeInternals: holding(
        unmeasuredCard("api", 0, 0),
        unmeasuredCard("db", 400, 200),
      ),
      width: PANE_WIDTH,
      height: PANE_HEIGHT,
    });
    expect(inViewReports(guard)).toEqual([true, false]);
    flowChanges({ nodeInternals: apiAndDb() });
    expect(inViewReports(guard)).toEqual([true, false, true]);
  });

  test("is in view with no cards at all, wherever the view is", () => {
    const guard: RenderedGuard = renderGuard({ drawingKey: "" });
    flowChanges({
      width: PANE_WIDTH,
      height: PANE_HEIGHT,
      transform: [5000, 5000, 1],
    });
    viewportReady();
    expect(inViewReports(guard)).toEqual([true]);
  });

  test("reads as in view once the guard is gone", () => {
    const guard: RenderedGuard = renderGuard();
    drawnAndReady();
    flowChanges({ transform: [5000, 5000, 1] });
    expect(inViewReports(guard)).toEqual([true, false]);
    guard.unmount();
    expect(inViewReports(guard)).toEqual([true, false, true]);
  });
});

describe("the instance", () => {
  test("is reported once the viewport is ready, as the object React Flow returns, and withdrawn on unmount", () => {
    const guard: RenderedGuard = renderGuard();
    expect(guard.onInstance.mock.calls).toEqual([[null]]);

    viewportReady();
    expect(guard.onInstance).toHaveBeenCalledTimes(2);
    expect(guard.onInstance.mock.calls[1]?.[0]).toBe(mockFlowStore.instance);

    // The drawing, the pane and the view changing do not report it again.
    flowChanges({
      nodeInternals: apiAndDb(),
      width: PANE_WIDTH,
      height: PANE_HEIGHT,
    });
    flowChanges({ transform: [-50, -50, 0.5] });
    expect(guard.onInstance).toHaveBeenCalledTimes(2);

    guard.unmount();
    expect(guard.onInstance).toHaveBeenCalledTimes(3);
    expect(guard.onInstance).toHaveBeenLastCalledWith(null);
  });

  test("new callbacks from the map are the ones called, without anything being reported again", () => {
    const guard: RenderedGuard = renderGuard();
    viewportReady();
    const onInstance: MockFunction = getJestMockFunction();
    const onExtentChange: MockFunction = getJestMockFunction();
    const onDrawingInViewChange: MockFunction = getJestMockFunction();
    guard.rerender({ onInstance, onExtentChange, onDrawingInViewChange });
    expect(onInstance).not.toHaveBeenCalled();
    expect(onDrawingInViewChange).not.toHaveBeenCalled();

    drawnAndReady();
    expect(onExtentChange.mock.calls).toEqual([
      [
        [
          [-50, -50],
          [670, 330],
        ],
      ],
    ]);

    guard.unmount();
    expect(onInstance.mock.calls).toEqual([[null]]);
    expect(onDrawingInViewChange.mock.calls).toEqual([[true]]);
    expect(onExtentChange).toHaveBeenLastCalledWith(UNBOUNDED_FLOW_EXTENT);
    // The first callbacks heard nothing after they were replaced.
    expect(guard.onInstance).toHaveBeenCalledTimes(2);
    expect(guard.onExtentChange).not.toHaveBeenCalled();
    expect(inViewReports(guard)).toEqual([true]);
  });
});

describe("measuredRectOf", () => {
  test("is a measured card's box, where React Flow placed it", () => {
    expect(
      measuredRectOf({
        ...measuredCard("api", 10, 20),
        positionAbsolute: { x: 110, y: 220 },
      }),
    ).toEqual({ x: 110, y: 220, width: CARD_WIDTH, height: CARD_HEIGHT });
  });

  test("falls back to the card's own position without an absolute one", () => {
    expect(
      measuredRectOf({
        id: "api",
        position: { x: 10, y: 20 },
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        data: {},
      }),
    ).toEqual({ x: 10, y: 20, width: CARD_WIDTH, height: CARD_HEIGHT });
  });

  test("is null until React Flow has measured both sides", () => {
    expect(measuredRectOf(unmeasuredCard("api", 0, 0))).toBeNull();
    expect(
      measuredRectOf({ ...unmeasuredCard("api", 0, 0), width: CARD_WIDTH }),
    ).toBeNull();
    expect(
      measuredRectOf({ ...unmeasuredCard("api", 0, 0), height: CARD_HEIGHT }),
    ).toBeNull();
    expect(
      measuredRectOf({
        ...unmeasuredCard("api", 0, 0),
        width: 0,
        height: CARD_HEIGHT,
      }),
    ).toBeNull();
    expect(
      measuredRectOf({
        ...unmeasuredCard("api", 0, 0),
        width: null,
        height: null,
      }),
    ).toBeNull();
  });
});

describe("renderedPaneSize", () => {
  test("is the size the page gives React Flow's zoom pane, as it is now", () => {
    const flow: FlowElement = flowElement(1000, 400);
    expect(renderedPaneSize(flow.domNode)).toEqual({
      width: 1000,
      height: 400,
    });
    flow.layOut(640, 480);
    expect(renderedPaneSize(flow.domNode)).toEqual({ width: 640, height: 480 });
  });

  test("is a zero size, not nothing, for a zoom pane the page has not laid out", () => {
    expect(renderedPaneSize(flowElement(0, 0).domNode)).toEqual({
      width: 0,
      height: 0,
    });
  });

  test("is null without React Flow's element, or before its zoom pane is in it", () => {
    expect(renderedPaneSize(null)).toBeNull();
    expect(renderedPaneSize(undefined)).toBeNull();
    const domNode: HTMLDivElement = document.createElement("div");
    domNode.className = "react-flow";
    expect(renderedPaneSize(domNode)).toBeNull();
  });
});

describe("selectDrawingInView", () => {
  test("nothing drawn is nothing lost", () => {
    expect(selectDrawingInView(flowState({ transform: [9000, 9000, 1] }))).toBe(
      true,
    );
  });

  test("a pane that has no size yet cannot be judged, so counts as in view", () => {
    expect(
      selectDrawingInView(
        flowState({
          nodeInternals: apiAndDb(),
          transform: [9000, 9000, 1],
          width: 0,
          height: 0,
        }),
      ),
    ).toBe(true);
  });

  test("needs at least 8 px of a measured card on the pane on each axis", () => {
    const inViewAt: (transform: FlowTransform) => boolean = (
      transform: FlowTransform,
    ): boolean => {
      return selectDrawingInView(
        flowState({ nodeInternals: apiAndDb(), transform }),
      );
    };
    expect(inViewAt([0, 0, 1])).toBe(true);
    // db spans x 400-620 and y 200-280; api is further up and left.
    expect(inViewAt([8 - 620, 0, 1])).toBe(true);
    expect(inViewAt([7 - 620, 0, 1])).toBe(false);
    expect(inViewAt([0, 8 - 280, 1])).toBe(true);
    expect(inViewAt([0, 7 - 280, 1])).toBe(false);
    // Coming in from the right: api's left 8 px at the pane's right edge.
    expect(inViewAt([PANE_WIDTH - 8, 0, 1])).toBe(true);
    expect(inViewAt([PANE_WIDTH - 7, 0, 1])).toBe(false);
  });

  test("is false when every card is off the pane", () => {
    expect(
      selectDrawingInView(
        flowState({ nodeInternals: apiAndDb(), transform: [-5000, 0, 1] }),
      ),
    ).toBe(false);
  });

  test("does not count cards React Flow has not measured, even on the pane", () => {
    expect(
      selectDrawingInView(
        flowState({
          nodeInternals: holding(
            unmeasuredCard("api", 0, 0),
            unmeasuredCard("db", 400, 200),
          ),
        }),
      ),
    ).toBe(false);
    expect(
      selectDrawingInView(
        flowState({
          nodeInternals: holding(
            unmeasuredCard("api", 0, 0),
            measuredCard("db", 5000, 5000),
          ),
        }),
      ),
    ).toBe(false);
    expect(
      selectDrawingInView(
        flowState({
          nodeInternals: holding(
            unmeasuredCard("api", 5000, 5000),
            measuredCard("db", 400, 200),
          ),
        }),
      ),
    ).toBe(true);
  });
});
