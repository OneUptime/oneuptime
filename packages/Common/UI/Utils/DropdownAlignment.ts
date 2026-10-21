import React, { useEffect, useState } from "react";

/*
 * Horizontal edge of the trigger that a popup pins itself to.
 * "Left" means the popup grows rightwards from the trigger's left edge
 * (Tailwind `left-0`), "Right" means it grows leftwards from the trigger's
 * right edge (Tailwind `right-0`).
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
  const [alignment, setAlignment] = useState<DropdownHorizontalAlignment>(
    DropdownHorizontalAlignment.Left,
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

      setAlignment(
        getDropdownHorizontalAlignment({
          anchorLeft: anchorRect.left,
          anchorRight: anchorRect.right,
          dropdownWidth: getDropdownWidthToFit({
            measuredWidthInPx: measuredWidth,
            dropdownWidthInPx: dropdownWidthInPx,
          }),
          viewportWidth: window.innerWidth,
          viewportMargin: viewportMargin,
        }),
      );
    };

    measure();

    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);

    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [isOpen, anchorRef, dropdownRef, dropdownWidthInPx, viewportMargin]);

  return alignment;
}
