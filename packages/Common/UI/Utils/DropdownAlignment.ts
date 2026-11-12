import React, { useEffect, useState } from "react";

/*
 * Horizontal edge of the trigger that a popup pins itself to.
 * "Left" means the popup grows rightwards from the trigger's left edge
 * (Tailwind `left-0`), "Right" means it grows leftwards from the trigger's
 * right edge (Tailwind `right-0`). On a page that reads right to left both
 * mirror, as Tailwind's left and right do there: "Left" is the line's start
 * (getDropdownAnchorEdges).
 */
export enum DropdownHorizontalAlignment {
  Left = "left",
  Right = "right",
}

// Breathing room we keep between a popup and the edge of the viewport.
export const DEFAULT_DROPDOWN_VIEWPORT_MARGIN_IN_PX: number = 8;

export interface DropdownAlignmentInput {
  // Viewport-relative left edge of the trigger, as reported by getBoundingClientRect().
  anchorLeft: number;
  // Viewport-relative right edge of the trigger.
  anchorRight: number;
  // Rendered width of the popup in pixels.
  dropdownWidth: number;
  // Width of the viewport in pixels.
  viewportWidth: number;
  // Optional override for the viewport gutter.
  viewportMargin?: number | undefined;
}

/*
 * Picks the edge a popup should align to so that it stays inside the viewport.
 *
 * Left alignment is preferred because it reads naturally next to the trigger.
 * We only flip to the right edge when left alignment would spill past the right
 * side of the viewport, and we never flip if doing so would spill past the left
 * side by even more (which is what produced the off-screen popup on the metric
 * explorer toolbar, where the trigger sits at the far left of the page).
 */
export function getDropdownHorizontalAlignment(
  input: DropdownAlignmentInput,
): DropdownHorizontalAlignment {
  const margin: number =
    input.viewportMargin === undefined
      ? DEFAULT_DROPDOWN_VIEWPORT_MARGIN_IN_PX
      : input.viewportMargin;

  /*
   * Before the popup is laid out (or in a non-visual environment) measurements
   * come back as zero. There is nothing to solve for, so keep the default.
   */
  if (
    !Number.isFinite(input.dropdownWidth) ||
    !Number.isFinite(input.viewportWidth) ||
    input.dropdownWidth <= 0 ||
    input.viewportWidth <= 0
  ) {
    return DropdownHorizontalAlignment.Left;
  }

  // How far a left-aligned popup would poke past the right gutter.
  const leftAlignedOverflow: number =
    input.anchorLeft + input.dropdownWidth - (input.viewportWidth - margin);

  // How far a right-aligned popup would poke past the left gutter.
  const rightAlignedOverflow: number =
    margin - (input.anchorRight - input.dropdownWidth);

  if (leftAlignedOverflow <= 0) {
    return DropdownHorizontalAlignment.Left;
  }

  if (rightAlignedOverflow <= 0) {
    return DropdownHorizontalAlignment.Right;
  }

  // Neither edge fits. Pick whichever clips the least, preferring left on a tie.
  return leftAlignedOverflow <= rightAlignedOverflow
    ? DropdownHorizontalAlignment.Left
    : DropdownHorizontalAlignment.Right;
}

export interface DropdownWidthToFitInput {
  // The popup's offsetWidth as measured, 0 before it is laid out.
  measuredWidthInPx: number;
  // The width the popup is styled to (288 for Tailwind `w-72`).
  dropdownWidthInPx: number;
}

/*
 * The width a popup has to find room for: at least the width it is styled
 * to. The popup can be measured before its width applies - the Dashboard's
 * Tailwind runtime writes a class's rule only after the first element that
 * uses it is in the page - and a time range dropdown opened for the first
 * time measured 131px, not its 288px. Its picker at the right of a table's
 * header then opened from its left edge and ran off the screen, until it
 * was closed and opened again. A popup wider than it is styled to (its
 * content) is taken at its measured width.
 */
export function getDropdownWidthToFit(input: DropdownWidthToFitInput): number {
  const measured: number = Number.isFinite(input.measuredWidthInPx)
    ? input.measuredWidthInPx
    : 0;

  return Math.max(measured, input.dropdownWidthInPx);
}

/*
 * The trigger's edges as the resolver above reads them, on a page that
 * reads right to left too. Tailwind's left-0 and right-0 mean the start and
 * the end of the line in every frontend (Styles/TailwindReadingDirection.js),
 * so on a Persian page "Left" pins the popup to the trigger's right edge and
 * grows it leftwards. Measured from the right instead - the viewport
 * mirrored - the same resolver keeps that popup on the screen: a trigger at
 * the page's left end, the toolbar's last, opens from its left edge.
 */
export function getDropdownAnchorEdges(data: {
  anchorLeft: number;
  anchorRight: number;
  viewportWidth: number;
  isRightToLeft: boolean;
}): { anchorLeft: number; anchorRight: number } {
  if (!data.isRightToLeft) {
    return { anchorLeft: data.anchorLeft, anchorRight: data.anchorRight };
  }

  return {
    anchorLeft: data.viewportWidth - data.anchorRight,
    anchorRight: data.viewportWidth - data.anchorLeft,
  };
}

/*
 * The width a popup has to stay inside: the page's (the root element's
 * client width), and the window's only where the page reads none (jsdom).
 * On a phone the window's grows with whatever runs past the screen: a panel
 * first drawn past the edge of a 390px phone made innerWidth 500, which had
 * room for it there, and the panel stayed off the screen with the page
 * scrolling sideways under it. The page's width leaves a scrollbar out too.
 */
export function getDropdownViewportWidth(data: {
  pageWidth: number;
  windowWidth: number;
}): number {
  return Number.isFinite(data.pageWidth) && data.pageWidth > 0
    ? data.pageWidth
    : data.windowWidth;
}

// Whether the page lays the element out right to left (a Persian page).
function isRightToLeftElement(element: HTMLElement): boolean {
  try {
    return window.getComputedStyle(element).direction === "rtl";
  } catch {
    return false;
  }
}

/*
 * Tailwind positioning class for an alignment. Kept next to the resolver so
 * callers cannot drift out of sync with the enum.
 */
export function getDropdownAlignmentClassName(
  alignment: DropdownHorizontalAlignment,
): string {
  return alignment === DropdownHorizontalAlignment.Right ? "right-0" : "left-0";
}

export interface UseDropdownHorizontalAlignmentOptions {
  // Only measure while the popup is actually on screen.
  isOpen: boolean;
  // The trigger the popup hangs off.
  anchorRef: React.RefObject<HTMLElement>;
  // The popup itself. When it has not been laid out we fall back to the declared width.
  dropdownRef?: React.RefObject<HTMLElement> | undefined;
  // Width the popup is styled to (e.g. 288 for Tailwind `w-72`).
  dropdownWidthInPx: number;
  viewportMargin?: number | undefined;
}

/*
 * Keeps a popup's horizontal alignment in sync with the space available around
 * its trigger. Re-measures when the popup opens and whenever the viewport
 * changes size or scrolls the trigger somewhere new.
 */
export function useDropdownHorizontalAlignment(
  options: UseDropdownHorizontalAlignmentOptions,
): DropdownHorizontalAlignment {
  return useDropdownPlacement(options).alignment;
}

/*
 * HOW FAR A POPUP SLIDES TO STAY ON THE SCREEN.
 *
 * getDropdownHorizontalAlignment picks the edge of the trigger a popup hangs
 * from. A popup wider than the room on either side of its trigger - a 28rem
 * picker under a button in the middle of a 390px phone - still runs off the
 * screen at whichever edge it picks. This is how far it then slides along
 * the line, away from the edge it hangs from, to sit inside the viewport's
 * gutters: 0 when it fits where it hangs. It never slides past the far
 * gutter, so a popup wider than the room between them keeps its own start
 * on the screen.
 *
 * The popup is taken at most as wide as the viewport between its gutters,
 * as every dropdown is styled (max-w-[calc(100vw-1rem)] for the default
 * 8px gutters): a 448px picker on a 390px phone is 374px wide there.
 */
export function getDropdownShiftToFit(
  input: DropdownAlignmentInput & { alignment: DropdownHorizontalAlignment },
): number {
  const margin: number =
    input.viewportMargin === undefined
      ? DEFAULT_DROPDOWN_VIEWPORT_MARGIN_IN_PX
      : input.viewportMargin;

  if (
    !Number.isFinite(input.dropdownWidth) ||
    !Number.isFinite(input.viewportWidth) ||
    !Number.isFinite(input.anchorLeft) ||
    !Number.isFinite(input.anchorRight) ||
    input.dropdownWidth <= 0 ||
    input.viewportWidth <= 0
  ) {
    return 0;
  }

  const width: number = Math.min(
    input.dropdownWidth,
    Math.max(0, input.viewportWidth - 2 * margin),
  );

  if (input.alignment === DropdownHorizontalAlignment.Right) {
    // Grows leftwards from the trigger's right edge: slides right.
    const overflow: number = margin - (input.anchorRight - width);
    const room: number = input.viewportWidth - margin - input.anchorRight;

    return Math.max(0, Math.min(overflow, room));
  }

  // Grows rightwards from the trigger's left edge: slides left.
  const overflow: number =
    input.anchorLeft + width - (input.viewportWidth - margin);
  const room: number = input.anchorLeft - margin;

  return Math.max(0, Math.min(overflow, room));
}

// The edge a popup hangs from, and how far it slides from there to fit.
export interface DropdownPlacement {
  alignment: DropdownHorizontalAlignment;
  shiftInPx: number;
}

export const DEFAULT_DROPDOWN_PLACEMENT: DropdownPlacement = {
  alignment: DropdownHorizontalAlignment.Left,
  shiftInPx: 0,
};

// Where a popup goes: the edge with room (or the least short of it), then the slide that keeps it on the screen.
export function getDropdownPlacement(
  input: DropdownAlignmentInput,
): DropdownPlacement {
  const alignment: DropdownHorizontalAlignment =
    getDropdownHorizontalAlignment(input);

  return {
    alignment: alignment,
    shiftInPx: getDropdownShiftToFit({ ...input, alignment: alignment }),
  };
}

/*
 * The inline style that slides a popup by its placement's shift: a negative
 * inset on the side it hangs from, pulling it past its trigger's edge. Written
 * with logical properties, so on a page that reads right to left it slides
 * the mirrored way, as getDropdownAlignmentClassName's left-0 and right-0 do
 * (Styles/TailwindReadingDirection.js); the shift is measured in that
 * mirrored frame (getDropdownAnchorEdges). Empty when the popup fits.
 */
export function getDropdownShiftStyle(
  placement: DropdownPlacement,
): React.CSSProperties {
  if (!(placement.shiftInPx > 0)) {
    return {};
  }

  return placement.alignment === DropdownHorizontalAlignment.Right
    ? { insetInlineEnd: `${-placement.shiftInPx}px` }
    : { insetInlineStart: `${-placement.shiftInPx}px` };
}

/*
 * useDropdownHorizontalAlignment's edge, with the slide that keeps a popup
 * too wide for either side of its trigger on the screen (getDropdownShiftToFit).
 * Hand the alignment to getDropdownAlignmentClassName and the placement to
 * getDropdownShiftStyle.
 */
export function useDropdownPlacement(
  options: UseDropdownHorizontalAlignmentOptions,
): DropdownPlacement {
  const [placement, setPlacement] = useState<DropdownPlacement>(
    DEFAULT_DROPDOWN_PLACEMENT,
  );

  const {
    isOpen,
    anchorRef,
    dropdownRef,
    dropdownWidthInPx,
    viewportMargin,
  }: UseDropdownHorizontalAlignmentOptions = options;

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const measure: () => void = (): void => {
      const anchor: HTMLElement | null = anchorRef.current;

      if (!anchor || typeof anchor.getBoundingClientRect !== "function") {
        return;
      }

      const anchorRect: DOMRect = anchor.getBoundingClientRect();
      const measuredWidth: number = dropdownRef?.current?.offsetWidth || 0;
      const viewportWidth: number = getDropdownViewportWidth({
        pageWidth: document.documentElement?.clientWidth || 0,
        windowWidth: window.innerWidth,
      });
      const edges: { anchorLeft: number; anchorRight: number } =
        getDropdownAnchorEdges({
          anchorLeft: anchorRect.left,
          anchorRight: anchorRect.right,
          viewportWidth: viewportWidth,
          isRightToLeft: isRightToLeftElement(anchor),
        });
      const next: DropdownPlacement = getDropdownPlacement({
        anchorLeft: edges.anchorLeft,
        anchorRight: edges.anchorRight,
        dropdownWidth: getDropdownWidthToFit({
          measuredWidthInPx: measuredWidth,
          dropdownWidthInPx: dropdownWidthInPx,
        }),
        viewportWidth: viewportWidth,
        viewportMargin: viewportMargin,
      });

      // The same placement keeps its object, so a scroll re-renders nothing.
      setPlacement((current: DropdownPlacement): DropdownPlacement => {
        return current.alignment === next.alignment &&
          current.shiftInPx === next.shiftInPx
          ? current
          : next;
      });
    };

    measure();

    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);

    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [isOpen, anchorRef, dropdownRef, dropdownWidthInPx, viewportMargin]);

  return placement;
}
