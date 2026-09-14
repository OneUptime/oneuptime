/*
 * Paint order on a dashboard page, in one place.
 *
 * github.com/OneUptime/oneuptime/issues/3660. A tile that had been clicked
 * once painted ON TOP of the toolbar's auto-refresh dropdown, so the picker
 * opened into a white rectangle the user could not see. Both numbers behind
 * that were reasonable on their own - the canvas raises a selected tile so it
 * sits above the tiles it overlaps, and the dropdown asked for a modest
 * layer - but neither element sat inside a stacking context of its own, so
 * "above my neighbours on the board" and "above the toolbar card" were
 * silently resolved against each other in the ROOT stacking context, and the
 * larger number won.
 *
 * Numbers alone cannot fix that; the next person to raise a widget by one
 * step re-breaks it. So the contract has two halves and both live here:
 *
 *   1. The canvas positioner establishes its OWN stacking context
 *      (CANVAS_ISOLATION below). Every z-index inside the canvas is then a
 *      statement about the other things ON THE BOARD, and cannot outrank page
 *      chrome however large it grows. This is what actually fixes the bug -
 *      and it fixes the unreported half of it too, because a selected tile at
 *      20 and a dragged tile at 60 were also outranking the app's own sticky
 *      header (`sticky top-0 z-10`, Common/UI/Components/MasterPage).
 *
 *   2. The toolbar's hand-rolled auto-refresh menu sits at TOOLBAR_POPUP, the
 *      layer MoreMenu already uses (`z-50`,
 *      Common/UI/Components/MoreMenu/MoreMenu.tsx), so the two menus in that
 *      one toolbar stop disagreeing about how high a menu opens.
 *
 * These are plain numbers rather than Tailwind classes on purpose: the
 * relationship between them is the thing that matters, and a relationship
 * spelled as `z-10` in one file and `zIndex: 20` in another is exactly what
 * broke. Written this way it is one import, and a test can assert the
 * ordering instead of trusting two string literals to stay in step.
 */

export interface DashboardStackingLayerScale {
  /**
   * The dashed drop-target outline shown while a widget is dragged or
   * resized. Below the widget being moved, so the card stays readable as it
   * crosses its own placeholder.
   */
  canvasPlaceholder: number;

  /**
   * The selected widget. Raised so its selection ring and resize handles
   * are not clipped by the neighbours they overlap.
   */
  canvasSelectedComponent: number;

  /**
   * The widget under an active drag or resize. Above everything else on the
   * board, including the placeholder it is heading for, and held there until
   * the settle transition finishes (see UseDashboardGridDnd).
   */
  canvasDraggingComponent: number;

  /**
   * Menus and panels anchored to the dashboard toolbar. Above the canvas -
   * which, being isolated, cannot compete - and above the app's sticky
   * header, matching MoreMenu.
   */
  toolbarPopup: number;
}

const DashboardStackingLayers: DashboardStackingLayerScale = {
  canvasPlaceholder: 5,
  canvasSelectedComponent: 20,
  canvasDraggingComponent: 60,
  toolbarPopup: 50,
};

/**
 * The `isolation` value the dashboard canvas positioner carries.
 *
 * `isolate` is the property whose only job is to open a stacking context: it
 * changes no layout, clips nothing, and - unlike `transform` or `filter` -
 * does not become the containing block for `position: fixed` descendants, so
 * portalled popups and fullscreen keep working exactly as they did.
 */
export type DashboardCanvasIsolation = "isolate";

export const DASHBOARD_CANVAS_ISOLATION: DashboardCanvasIsolation = "isolate";

export default DashboardStackingLayers;
