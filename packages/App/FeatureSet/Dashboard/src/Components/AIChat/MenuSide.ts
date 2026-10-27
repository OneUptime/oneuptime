import { RefObject, useLayoutEffect, useState } from "react";

/*
 * Which side of its button a composer's menu opens on: the model picker's
 * and the "what Ask AI may do" picker's.
 *
 * The side asked for, unless the menu does not fit there and fits better
 * on the other. Ask AI's start draws its composer in the middle of the
 * dialog and asks for "bottom", but on a laptop window 800 px tall the
 * permission menu ran 70 px past the dialog's foot, which cut its last
 * choice in half. A composer at the foot asks for "top" and keeps it.
 */
export type MenuSide = "top" | "bottom";

export interface MenuSideMeasure {
  preferred: MenuSide;
  buttonTop: number;
  buttonBottom: number;
  menuHeight: number;
  // What can show the menu: the window, cut by every box that clips it.
  boundaryTop: number;
  boundaryBottom: number;
  // The space between the button and the menu.
  gap: number;
}

export function chooseMenuSide(measure: MenuSideMeasure): MenuSide {
  // Not drawn yet, or nowhere to measure (a test's DOM): as asked.
  if (!(measure.menuHeight > 0)) {
    return measure.preferred;
  }

  const spaceBelow: number =
    measure.boundaryBottom - measure.buttonBottom - measure.gap;
  const spaceAbove: number =
    measure.buttonTop - measure.boundaryTop - measure.gap;
  const fitsBelow: boolean = measure.menuHeight <= spaceBelow;
  const fitsAbove: boolean = measure.menuHeight <= spaceAbove;

  if (measure.preferred === "bottom") {
    return fitsBelow || (!fitsAbove && spaceBelow >= spaceAbove)
      ? "bottom"
      : "top";
  }

  return fitsAbove || (!fitsBelow && spaceAbove >= spaceBelow)
    ? "top"
    : "bottom";
}

const CLIPPING_OVERFLOW: Set<string> = new Set([
  "hidden",
  "auto",
  "scroll",
  "clip",
]);

/*
 * The part of the window an element's menu can be seen in: the window, cut
 * by every ancestor that clips what overflows it (the dialog, which rounds
 * its corners with overflow: hidden, and the start's scrolling column).
 */
export function getVisibleBounds(element: Element): {
  top: number;
  bottom: number;
} {
  let top: number = 0;
  let bottom: number =
    typeof window !== "undefined" ? window.innerHeight : Infinity;
  let node: Element | null = element.parentElement;

  while (node && node !== document.body && node !== document.documentElement) {
    const style: CSSStyleDeclaration = window.getComputedStyle(node);

    if (CLIPPING_OVERFLOW.has(style.overflowY)) {
      const rect: DOMRect = node.getBoundingClientRect();
      top = Math.max(top, rect.top);
      bottom = Math.min(bottom, rect.bottom);
    }

    node = node.parentElement;
  }

  return { top, bottom };
}

/*
 * The side a menu is drawn on while it is open. It is first drawn on the
 * side asked for, then measured and moved before the browser paints it (a
 * layout effect), so it never flashes on the wrong side - and measured
 * again whenever its size changes: the Dashboard draws its Tailwind as a
 * class first appears, so a menu opened for the first time can still be
 * unstyled, and shorter than it will be, at that first measure.
 */
export function useMenuSide(options: {
  isOpen: boolean;
  preferred: MenuSide;
  gap: number;
  buttonRef: RefObject<HTMLElement>;
  menuRef: RefObject<HTMLElement>;
}): MenuSide {
  const [side, setSide] = useState<MenuSide>(options.preferred);

  useLayoutEffect(() => {
    if (!options.isOpen) {
      // Each opening starts from the side asked for.
      setSide(options.preferred);
      return undefined;
    }

    const button: HTMLElement | null = options.buttonRef.current;
    const menu: HTMLElement | null = options.menuRef.current;

    if (!button || !menu) {
      return undefined;
    }

    const measure: () => void = (): void => {
      const buttonRect: DOMRect = button.getBoundingClientRect();
      const bounds: { top: number; bottom: number } = getVisibleBounds(button);

      setSide(
        chooseMenuSide({
          preferred: options.preferred,
          buttonTop: buttonRect.top,
          buttonBottom: buttonRect.bottom,
          menuHeight: menu.offsetHeight,
          boundaryTop: bounds.top,
          boundaryBottom: bounds.bottom,
          gap: options.gap,
        }),
      );
    };

    measure();

    // Moving the menu to the other side does not change its size: no loop.
    const observer: ResizeObserver | null =
      typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(menu);
    const frame: number | null =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(measure)
        : null;

    return () => {
      observer?.disconnect();

      if (frame !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(frame);
      }
    };
  }, [options.isOpen, options.preferred, options.gap]);

  return side;
}
