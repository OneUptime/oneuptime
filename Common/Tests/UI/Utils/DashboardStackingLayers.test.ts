import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import DashboardStackingLayers, {
  DASHBOARD_CANVAS_ISOLATION,
} from "../../../UI/Utils/DashboardStackingLayers";

/*
 * github.com/OneUptime/oneuptime/issues/3660.
 *
 * A dashboard tile that had been clicked once painted over the toolbar's
 * auto-refresh menu, so opening the picker produced a blank white rectangle.
 * Nothing was misconfigured: the canvas raised the selected tile to 20 so it
 * would clear the tiles it overlaps, the toolbar menu asked for 10, and
 * because neither box lived inside a stacking context of its own those two
 * unrelated numbers were resolved against each other in the ROOT stacking
 * context. 20 beat 10.
 *
 * So the numbers alone were never the fix and raising the menu alone would
 * never have been either - the drag code elevates a tile to 60 while it is
 * being moved, which outranks the menu, the Modal layer and everything else
 * the page has. What makes the values safe is the canvas isolating itself, so
 * that "above my neighbours on the board" stops being a claim about the page.
 *
 * This file pins the arithmetic. The DOM half - that the canvas really does
 * isolate, and that a selected tile therefore cannot be compared with the menu
 * at all - is asserted against real rendered elements in
 * Common/Tests/App/Dashboard/DashboardToolbarPopupLayering.test.tsx, and the
 * sources are pinned in App/Tests/Dashboard/DashboardCanvasLayering.test.ts.
 */

const COMMON_ROOT: string = path.join(__dirname, "..", "..", "..");

function readCommonCode(...relativeParts: Array<string>): string {
  return fs.readFileSync(path.join(COMMON_ROOT, ...relativeParts), "utf8");
}

/*
 * The shell sticks its header at this layer. Read out of MasterPage rather
 * than written down here, so moving the header moves the assertions with it.
 */
function appHeaderZIndex(): number {
  const source: string = readCommonCode(
    "UI",
    "Components",
    "MasterPage",
    "MasterPage.tsx",
  );

  const match: RegExpMatchArray | null = source.match(
    /makeTopSectionUnstick \? "" : "sticky top-0 z-(\d+)"/,
  );

  if (!match || match[1] === undefined) {
    throw new Error(
      "MasterPage no longer sticks its top section with a single `sticky top-0 z-N` class. Issue #3660 depends on dashboard widgets never competing with that layer - if the shell's layering changed, update this test to match.",
    );
  }

  return Number(match[1]);
}

/* The layer every other anchored menu in the app already uses. */
function moreMenuZIndex(): number {
  const source: string = readCommonCode(
    "UI",
    "Components",
    "MoreMenu",
    "MoreMenu.tsx",
  );

  const match: RegExpMatchArray | null = source.match(
    /absolute right-0 z-(\d+) mt-2 w-56 origin-top-right/,
  );

  if (!match || match[1] === undefined) {
    throw new Error(
      "MoreMenu's panel no longer declares its layer as a single `z-N` class in the class list this test anchors on. The dashboard toolbar's own menu is meant to sit on the same layer - re-point this reader before changing either.",
    );
  }

  return Number(match[1]);
}

/*
 * The layer every dialog in the app opens at - including the widget settings
 * dialog the canvas itself renders, and the Add Widget / Variables / discard
 * dialogs the toolbar opens while a board is being edited. Those are the
 * overlays a widget mid-drag is actually in a position to cover.
 */
function modalZIndex(): number {
  const source: string = readCommonCode(
    "UI",
    "Components",
    "Modal",
    "Modal.tsx",
  );

  const match: RegExpMatchArray | null = source.match(
    /<div className="relative z-(\d+)">/,
  );

  if (!match || match[1] === undefined) {
    throw new Error(
      "Modal's root no longer declares its layer as a single `relative z-N` class. Re-point this reader before changing either Modal or the dashboard's scale.",
    );
  }

  return Number(match[1]);
}

describe("dashboard stacking layers (issue #3660)", () => {
  describe("the order the board is painted in", () => {
    test("the drop placeholder sits under the widget being dragged onto it", () => {
      expect(DashboardStackingLayers.canvasPlaceholder).toBeLessThan(
        DashboardStackingLayers.canvasDraggingComponent,
      );
    });

    test("the drop placeholder sits under the selected widget", () => {
      /*
       * The placeholder is a hint about where the card is going. Painting it
       * over the card would hide the thing being positioned.
       */
      expect(DashboardStackingLayers.canvasPlaceholder).toBeLessThan(
        DashboardStackingLayers.canvasSelectedComponent,
      );
    });

    test("a widget under an active gesture outranks the merely selected one", () => {
      /*
       * Selection persists; a drag is momentary and has to clear whatever it
       * is crossing, including the card that was selected before the grab.
       */
      expect(DashboardStackingLayers.canvasSelectedComponent).toBeLessThan(
        DashboardStackingLayers.canvasDraggingComponent,
      );
    });
  });

  describe("the toolbar's menus", () => {
    test("open above a selected widget - the bug in the report", () => {
      expect(DashboardStackingLayers.toolbarPopup).toBeGreaterThan(
        DashboardStackingLayers.canvasSelectedComponent,
      );
    });

    test("sit on the same layer as every other anchored menu in the app", () => {
      /*
       * The auto-refresh menu is hand-rolled rather than a MoreMenu, which is
       * the only reason it could drift to a different layer in the first
       * place. Two menus in one toolbar disagreeing about their layer is a
       * bug waiting for the first time they overlap.
       */
      expect(DashboardStackingLayers.toolbarPopup).toBe(moreMenuZIndex());
    });

    test("clear the app's sticky header", () => {
      expect(DashboardStackingLayers.toolbarPopup).toBeGreaterThan(
        appHeaderZIndex(),
      );
    });
  });

  describe("why the canvas has to isolate", () => {
    test("it does isolate", () => {
      expect(DASHBOARD_CANVAS_ISOLATION).toBe("isolate");
    });

    test("a dragged widget would otherwise outrank every dialog the app opens", () => {
      /*
       * This is the assertion that stops #3660 being "fixed" by raising the
       * menu and deleting the boundary. Dragging happens in edit mode, and
       * edit mode is full of things this number would cover in a shared
       * stacking context: the widget settings dialog the canvas renders, the
       * Add Widget and Variables dialogs, the discard confirmation. The
       * elevation is held for a further 260ms after the drop, so this is not
       * only about the frames the pointer is down for.
       */
      expect(DashboardStackingLayers.canvasDraggingComponent).toBeGreaterThan(
        modalZIndex(),
      );
    });

    test("a selected widget would otherwise outrank the app's sticky header", () => {
      /*
       * The unreported half of the same bug: scroll a board with a tile
       * selected and the tile rides up over the navbar. Lowering the raise
       * instead would put the selection ring and the resize handles back
       * underneath the neighbours they are meant to overlap.
       */
      expect(
        DashboardStackingLayers.canvasSelectedComponent,
      ).toBeGreaterThanOrEqual(appHeaderZIndex());
    });
  });
});
