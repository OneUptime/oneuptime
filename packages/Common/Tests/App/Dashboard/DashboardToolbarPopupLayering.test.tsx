import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import TimeRange from "../../../Types/Time/TimeRange";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import DashboardMode from "../../../Types/Dashboard/DashboardMode";
import DashboardViewConfig, {
  AutoRefreshInterval,
} from "../../../Types/Dashboard/DashboardViewConfig";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardTextComponentUtil from "../../../Utils/Dashboard/Components/DashboardTextComponent";
import DefaultDashboardSize from "../../../Types/Dashboard/DashboardSize";
import DashboardStackingLayers from "../../../UI/Utils/DashboardStackingLayers";

/*
 * github.com/OneUptime/oneuptime/issues/3660.
 *
 * "Click the topmost tile once, then open the auto-refresh picker: it is
 * hidden behind the tile. Click a tile further down and the picker appears as
 * intended."
 *
 * The click is the whole story. Clicking a widget selects it - in VIEW mode
 * too, where selection has no other visible effect at all - and the canvas
 * raised the selected tile's wrapper to z-index 20 so its ring and resize
 * handles clear its neighbours. But the wrapper's only positioned ancestors
 * were `position: relative` with `z-index: auto`, which creates no stacking
 * context, so that 20 was resolved in the ROOT stacking context, against the
 * toolbar menu's 10. Clicking a tile further down did not fix the layering;
 * it just moved the raised box out from under the menu.
 *
 * What is asserted here is the relationship, not the numbers: the menu is
 * painted after the selected tile, in a real DOM shaped exactly as the
 * dashboard shell shapes it. `paintsAbove` below implements CSS 2.1
 * Appendix E over the rendered tree, so the assertion fails the moment the
 * canvas stops isolating - and the last test in this file proves that by
 * taking the isolation away and watching the bug come back.
 *
 * jsdom has no stylesheet (Tailwind arrives via the Play CDN at runtime), so
 * only INLINE style is computable here. Every property this file reads -
 * isolation, position, z-index, transform - is inline in the components under
 * test, which is why the fix is written as inline style rather than as a
 * Tailwind class. The Tailwind-class side of the same contract is pinned
 * against the sources in App/Tests/Dashboard/DashboardCanvasLayering.test.ts.
 */

/*
 * The one mock. DashboardBaseComponent is the fan-out to ~60 widget
 * implementations and none of them are under test; the tile WRAPPER, which is
 * where the bug lives, stays real. The stub keeps the two things the wrapper's
 * behaviour depends on: it forwards the click that selects, and it carries a
 * transform, because the real card always sets `transform: scale(1)` and that
 * makes the card a stacking context of its own.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent",
  () => {
    const reactModule: typeof React = jest.requireActual(
      "react",
    ) as typeof React;

    return {
      __esModule: true,
      default: (props: {
        componentId: { toString: () => string };
        onClick: () => void;
      }) => {
        return reactModule.createElement("div", {
          "data-testid": `widget-${props.componentId.toString()}`,
          style: { transform: "scale(1)" },
          onClick: () => {
            props.onClick();
          },
        });
      },
    };
  },
);

import DashboardCanvas from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/Index";
import DashboardToolbar from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardToolbar";

// ── a model of CSS painting order ──────────────────────────────────────

/*
 * Which properties open a stacking context. Only the ones reachable in jsdom
 * are listed - a class-driven one would read as absent here AND is absent from
 * the real chain this file models, so leaving it out changes no answer.
 */
function createsStackingContext(element: HTMLElement): boolean {
  if (element === element.ownerDocument.documentElement) {
    return true;
  }

  const style: CSSStyleDeclaration = window.getComputedStyle(element);

  if (style.isolation === "isolate") {
    return true;
  }

  if (style.position === "fixed" || style.position === "sticky") {
    return true;
  }

  if (
    (style.position === "relative" || style.position === "absolute") &&
    style.zIndex !== "" &&
    style.zIndex !== "auto"
  ) {
    return true;
  }

  if (style.transform !== "" && style.transform !== "none") {
    return true;
  }

  if (style.filter !== "" && style.filter !== "none") {
    return true;
  }

  if (style.opacity !== "" && Number(style.opacity) < 1) {
    return true;
  }

  if (style.mixBlendMode !== "" && style.mixBlendMode !== "normal") {
    return true;
  }

  return false;
}

/** The nearest ancestor that boxes `element` into a stacking context. */
function stackingContextOf(element: HTMLElement): HTMLElement {
  let node: HTMLElement | null = element.parentElement;

  while (node) {
    if (createsStackingContext(node)) {
      return node;
    }

    node = node.parentElement;
  }

  return element.ownerDocument.documentElement;
}

/** Root-first list of the stacking contexts `element` sits inside. */
function stackingContextChain(element: HTMLElement): Array<HTMLElement> {
  const chain: Array<HTMLElement> = [];
  let context: HTMLElement = stackingContextOf(element);

  for (;;) {
    chain.unshift(context);

    if (context === element.ownerDocument.documentElement) {
      return chain;
    }

    context = stackingContextOf(context);
  }
}

/*
 * The ancestor-or-self of `element` that competes directly inside `context`.
 * Everything below it is painted with it, atomically, wherever it lands.
 */
function participantIn(
  element: HTMLElement,
  context: HTMLElement,
): HTMLElement {
  let node: HTMLElement = element;

  while (stackingContextOf(node) !== context) {
    const parent: HTMLElement | null = node.parentElement;

    if (!parent) {
      throw new Error(
        "participantIn was given an element that does not live inside the context it was asked about.",
      );
    }

    node = parent;
  }

  return node;
}

/*
 * The stack level a box competes at inside its own context. `auto` and `0` are
 * the same level (CSS 2.1 Appendix E paints them together in tree order), and
 * an element that opens a stacking context for some other reason - a transform,
 * say - joins them there.
 *
 * A browser would ignore a z-index on a static box; this deliberately does
 * not, because jsdom cannot see class-driven `position`. The toolbar panel is
 * positioned by Tailwind's `absolute` and carries only its z-index inline, so
 * requiring positioned-ness here would silently read the real, load-bearing
 * layer of the element under test as zero. Erring the other way costs nothing:
 * a z-index that a browser would ignore is a mistake this file should surface,
 * not quietly agree with.
 */
function stackLevelOf(element: HTMLElement): number {
  const zIndex: string = window.getComputedStyle(element).zIndex;

  if (zIndex === "" || zIndex === "auto") {
    return 0;
  }

  return Number(zIndex);
}

/**
 * True when `a` is painted after - and so over - `b`, per CSS 2.1 Appendix E.
 *
 * Both boxes are reduced to whichever ancestor competes inside their deepest
 * shared stacking context, since a stacking context is painted atomically. The
 * winner is the higher stack level, or, at equal levels, the one later in the
 * document.
 */
function paintsAbove(a: HTMLElement, b: HTMLElement): boolean {
  const chainA: Array<HTMLElement> = stackingContextChain(a);
  const chainB: Array<HTMLElement> = stackingContextChain(b);

  let shared: HTMLElement = a.ownerDocument.documentElement;

  for (
    let depth: number = 0;
    depth < Math.min(chainA.length, chainB.length);
    depth++
  ) {
    if (chainA[depth] !== chainB[depth]) {
      break;
    }

    shared = chainA[depth]!;
  }

  const boxA: HTMLElement = participantIn(a, shared);
  const boxB: HTMLElement = participantIn(b, shared);

  if (boxA === boxB) {
    throw new Error(
      "paintsAbove was asked to order two boxes that are painted as one. Give it elements that really do compete.",
    );
  }

  const levelA: number = stackLevelOf(boxA);
  const levelB: number = stackLevelOf(boxB);

  if (levelA !== levelB) {
    return levelA > levelB;
  }

  return Boolean(
    boxB.compareDocumentPosition(boxA) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

// ── the board under test ───────────────────────────────────────────────

const TOP_TILE_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const LOWER_TILE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

function makeTile(componentId: ObjectID, top: number): DashboardBaseComponent {
  return {
    ...DashboardTextComponentUtil.getDefaultComponent(),
    componentId,
    topInDashboardUnits: top,
    leftInDashboardUnits: 0,
  };
}

const VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [makeTile(TOP_TILE_ID, 0), makeTile(LOWER_TILE_ID, 3)],
  heightInDashboardUnits: DefaultDashboardSize.heightInDashboardUnits,
};

const RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_HOUR,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-09-08T10:00:00.000Z"),
    new Date("2026-09-08T11:00:00.000Z"),
  ),
};

function noop(): void {
  return undefined;
}

/*
 * The dashboard shell's own shape: the toolbar and the canvas as siblings
 * under one plain wrapper, exactly as
 * App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardView.tsx renders
 * them. Neither wrapper carries a stacking context, and that is the point -
 * the fix must not depend on one appearing above the canvas.
 */
const DashboardShell: React.FunctionComponent = (): React.ReactElement => {
  const [selectedComponentId, setSelectedComponentId] =
    React.useState<ObjectID | null>(null);

  return (
    <div className="min-h-screen">
      <DashboardToolbar
        dashboardMode={DashboardMode.View}
        dashboardName="Monitor Dashboard"
        dashboardViewConfig={VIEW_CONFIG}
        isSaving={false}
        canEditDashboard={true}
        startAndEndDate={RANGE}
        onStartAndEndDateChange={noop}
        autoRefreshInterval={AutoRefreshInterval.OFF}
        onAutoRefreshIntervalChange={noop}
        onEditClick={noop}
        onSaveClick={noop}
        onCancelEditClick={noop}
        onFullScreenClick={noop}
        onAddComponentClick={noop}
      />
      <div className="px-1 pb-4 mx-3 mb-4 rounded-2xl border border-gray-200/60">
        <DashboardCanvas
          dashboardViewConfig={VIEW_CONFIG}
          onDashboardViewConfigChange={noop}
          isEditMode={false}
          currentTotalDashboardWidthInPx={1200}
          selectedComponentId={selectedComponentId}
          onComponentSelected={(componentId: ObjectID) => {
            setSelectedComponentId(componentId);
          }}
          onComponentUnselected={() => {
            setSelectedComponentId(null);
          }}
          metrics={{ metricTypes: [], telemetryAttributes: [] }}
          dashboardStartAndEndDate={RANGE}
        />
      </div>
    </div>
  );
};

function tileWrapperOf(componentId: ObjectID): HTMLElement {
  const wrapper: HTMLElement | null = document.getElementById(
    `dashboard-component-${componentId.toString()}`,
  );

  if (!wrapper) {
    throw new Error(
      `The canvas no longer renders a tile wrapper with id dashboard-component-${componentId.toString()}. Re-point this test at whatever now carries the tile's z-index.`,
    );
  }

  return wrapper;
}

function positionerElement(): HTMLElement {
  const positioner: HTMLElement | null =
    tileWrapperOf(TOP_TILE_ID).parentElement;

  if (!positioner) {
    throw new Error("The tile wrapper is no longer inside a positioner.");
  }

  return positioner;
}

function selectTile(componentId: ObjectID): void {
  fireEvent.click(screen.getByTestId(`widget-${componentId.toString()}`));
}

/*
 * Opens the picker and hands back its panel. The panel is found as "the
 * wrapper's child that is not the trigger" rather than by text, so a reworded
 * interval label cannot silently turn these assertions into no-ops - and the
 * option count is checked, so a panel that rendered empty would fail loudly
 * instead of passing a layering test about nothing.
 */
function openAutoRefreshMenu(): HTMLElement {
  const trigger: HTMLElement = screen.getByTitle("Auto-refresh settings");

  fireEvent.click(trigger);

  const wrapper: HTMLElement | null = trigger.parentElement;

  if (!wrapper) {
    throw new Error("The auto-refresh trigger is no longer inside a wrapper.");
  }

  const panel: HTMLElement | undefined = Array.from(wrapper.children).find(
    (child: Element): boolean => {
      return child !== trigger;
    },
  ) as HTMLElement | undefined;

  if (!panel) {
    throw new Error(
      "Clicking the auto-refresh trigger no longer opens a panel next to it.",
    );
  }

  expect(panel.querySelectorAll("button")).toHaveLength(
    Object.values(AutoRefreshInterval).length,
  );

  return panel;
}

beforeEach(() => {
  render(<DashboardShell />);
});

afterEach(() => {
  cleanup();
});

describe("the auto-refresh picker opens above the board (issue #3660)", () => {
  test("the reported gesture: click the topmost tile, then open the picker", () => {
    selectTile(TOP_TILE_ID);

    const tile: HTMLElement = tileWrapperOf(TOP_TILE_ID);
    const panel: HTMLElement = openAutoRefreshMenu();

    /* The tile really is raised - this is not passing because nothing happened. */
    expect(tile.style.zIndex).toBe(
      String(DashboardStackingLayers.canvasSelectedComponent),
    );

    expect(paintsAbove(panel, tile)).toBe(true);
  });

  test("and with no tile clicked at all, which always worked", () => {
    const tile: HTMLElement = tileWrapperOf(TOP_TILE_ID);
    const panel: HTMLElement = openAutoRefreshMenu();

    expect(tile.style.zIndex).toBe("");
    expect(paintsAbove(panel, tile)).toBe(true);
  });

  test("clicking a tile further down does not put the first one back on top", () => {
    /*
     * The report's workaround. Both tiles are checked, because the bug was
     * never about which tile was clicked - only about which one happened to
     * sit under the menu.
     */
    selectTile(LOWER_TILE_ID);

    const panel: HTMLElement = openAutoRefreshMenu();

    expect(paintsAbove(panel, tileWrapperOf(TOP_TILE_ID))).toBe(true);
    expect(paintsAbove(panel, tileWrapperOf(LOWER_TILE_ID))).toBe(true);
  });

  test("nor can the highest layer the board is able to reach", () => {
    /*
     * UseDashboardGridDnd elevates a grabbed card imperatively, to a number
     * well above the one the menu asks for. A real drag only happens in edit
     * mode, where this picker is not mounted - but the arithmetic is what the
     * boundary has to hold, and holding it here is what keeps the board from
     * covering the dialogs that DO open over it while it is edited.
     */
    const tile: HTMLElement = tileWrapperOf(TOP_TILE_ID);
    tile.style.zIndex = String(DashboardStackingLayers.canvasDraggingComponent);

    const panel: HTMLElement = openAutoRefreshMenu();

    expect(DashboardStackingLayers.canvasDraggingComponent).toBeGreaterThan(
      DashboardStackingLayers.toolbarPopup,
    );
    expect(paintsAbove(panel, tile)).toBe(true);
  });
});

describe("the canvas keeps its layers to itself", () => {
  test("the positioner is the stacking context every tile lives in", () => {
    selectTile(TOP_TILE_ID);

    expect(stackingContextOf(tileWrapperOf(TOP_TILE_ID))).toBe(
      positionerElement(),
    );
    expect(window.getComputedStyle(positionerElement()).isolation).toBe(
      "isolate",
    );
  });

  test("the positioner claims no z-index of its own", () => {
    /*
     * An isolated box that also took a z-index would re-enter the competition
     * it was added to leave, and the whole board would outrank the toolbar
     * again as one piece.
     */
    expect(positionerElement().style.zIndex).toBe("");
  });

  test("the toolbar's menu and the board are not even in the same contest", () => {
    selectTile(TOP_TILE_ID);

    const panel: HTMLElement = openAutoRefreshMenu();

    expect(stackingContextOf(panel)).not.toBe(
      stackingContextOf(tileWrapperOf(TOP_TILE_ID)),
    );
  });

  test("the raise still does its job: a selected tile covers its neighbours", () => {
    /*
     * The other way to make this bug go away is to stop raising the tile,
     * which would put the selection ring and the resize handles back under
     * the neighbouring cards they overhang.
     */
    selectTile(TOP_TILE_ID);

    expect(
      paintsAbove(tileWrapperOf(TOP_TILE_ID), tileWrapperOf(LOWER_TILE_ID)),
    ).toBe(true);
  });
});

describe("the isolation is what is holding this up", () => {
  /*
   * Proof that the assertions above are load-bearing rather than trivially
   * true. Both cases take the isolation away and watch the canvas's numbers
   * escape into the page again - which is also why raising the menu on its own
   * was never the fix.
   */

  test("without it, the shipped-before layering reproduces the report exactly", () => {
    selectTile(TOP_TILE_ID);

    const tile: HTMLElement = tileWrapperOf(TOP_TILE_ID);
    const panel: HTMLElement = openAutoRefreshMenu();

    expect(paintsAbove(panel, tile)).toBe(true);

    /* The board and the menu as they shipped before the fix. */
    positionerElement().style.isolation = "";
    panel.style.zIndex = "10";

    expect(paintsAbove(panel, tile)).toBe(false);
  });

  test("without it, even the menu's new layer loses to a widget mid-drag", () => {
    const tile: HTMLElement = tileWrapperOf(TOP_TILE_ID);
    const panel: HTMLElement = openAutoRefreshMenu();

    tile.style.zIndex = String(DashboardStackingLayers.canvasDraggingComponent);

    expect(paintsAbove(panel, tile)).toBe(true);

    positionerElement().style.isolation = "";

    expect(paintsAbove(panel, tile)).toBe(false);
  });
});
