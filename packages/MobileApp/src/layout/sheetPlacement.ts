import { getScreenBottomPadding } from "../theme/layout";
import { spacing } from "../theme/tokens";
import type { LayoutInsets, WindowLayout } from "./windowLayout";

/*
 * Where a bottom sheet rises - the note sheet, the project switcher, a
 * security case's decisions, the person picker.
 *
 * On a phone, a tablet, and a foldable lying flat or half open like a book, a
 * sheet rises from the bottom edge as it always has, up to its own limit.
 *
 * Half open on a table, a sheet that rose that far lay across the crease,
 * with its title on one half and its buttons on the other. It rises over the
 * half lying on the table instead, and stops at the band around the fold:
 * the half under the reader's hand is where Material puts a tabletop's
 * controls, and Apple's own sheets slide clear of the iPhone Duo's fold too.
 * With the keyboard up, the keys take that half, so the sheet moves above the
 * fold - the screen up, the keys down, as on a laptop - rather than being
 * pushed up across the crease.
 */

export type SheetAnchor = "bottom" | "top";

export interface SheetPlacement {
  /**
   * "bottom": the sheet rises from the window's bottom edge. "top": it hangs
   * from the window's top, above a tabletop fold while the keyboard is up.
   */
  anchor: SheetAnchor;
  /** The tallest the sheet may be, in points; undefined keeps the sheet's own limit. */
  maxHeight: number | undefined;
  /**
   * Whether the sheet rises above the keyboard itself (KeyboardAvoidingView).
   * Not across a tabletop fold, where the placement already keeps it clear.
   */
  avoidsKeyboard: boolean;
  /** Room above a sheet hung from the top: the window's top inset. */
  paddingTop: number;
  /**
   * Room after the sheet's last button: the window's bottom inset for a
   * sheet on the bottom edge - whatever pane opened it - and plain spacing
   * for one hung above the fold.
   */
  paddingBottom: number;
}

export type SheetPlacementLayout = Pick<
  WindowLayout,
  "paneArrangement" | "detailPaneHeight" | "listPaneHeight" | "insets"
>;

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** How the dimmed screen behind a sheet places it: on the bottom edge, or hung from the top. */
export function getSheetBackdropLayout(placement: SheetPlacement): {
  justifyContent: "flex-start" | "flex-end";
  paddingTop: number;
} {
  return {
    justifyContent: placement.anchor === "top" ? "flex-start" : "flex-end",
    paddingTop: placement.paddingTop,
  };
}

/**
 * The corners a sheet rounds: its top two where it rises from the bottom
 * edge, all four where it hangs above a tabletop fold, clear of every edge.
 */
export function getSheetCorners(
  placement: SheetPlacement,
  cornerRadius: number,
): {
  borderTopLeftRadius: number;
  borderTopRightRadius: number;
  borderBottomLeftRadius: number;
  borderBottomRightRadius: number;
} {
  const bottom: number = placement.anchor === "top" ? cornerRadius : 0;
  return {
    borderTopLeftRadius: cornerRadius,
    borderTopRightRadius: cornerRadius,
    borderBottomLeftRadius: bottom,
    borderBottomRightRadius: bottom,
  };
}

/**
 * Where a sheet goes in this window, with the keyboard up or not. A sheet
 * reads the window's own insets (layout.insets): one opened from the pane
 * above a tabletop fold still reaches the window's bottom edge.
 */
export function getSheetPlacement(
  layout: SheetPlacementLayout,
  keyboardShown: boolean,
): SheetPlacement {
  const insets: LayoutInsets = layout.insets;
  const bottomEdgePadding: number = getScreenBottomPadding(
    nonNegative(insets.bottom),
    false,
  );

  if (layout.paneArrangement !== "stacked") {
    return {
      anchor: "bottom",
      maxHeight: undefined,
      avoidsKeyboard: true,
      paddingTop: 0,
      paddingBottom: bottomEdgePadding,
    };
  }

  if (keyboardShown) {
    const top: number = nonNegative(insets.top);
    return {
      anchor: "top",
      maxHeight: Math.max(0, layout.detailPaneHeight - top),
      avoidsKeyboard: false,
      paddingTop: top,
      paddingBottom: spacing.xl,
    };
  }

  return {
    anchor: "bottom",
    maxHeight: nonNegative(layout.listPaneHeight),
    avoidsKeyboard: false,
    paddingTop: 0,
    paddingBottom: bottomEdgePadding,
  };
}
