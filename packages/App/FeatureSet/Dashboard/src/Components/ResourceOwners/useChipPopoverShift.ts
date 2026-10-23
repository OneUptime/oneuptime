import { getChipPopoverShift } from "./FilterChipPopoverPlacement";
import { useLayoutEffect } from "react";

/*
 * Keeps an open chip popover on the screen (FilterChipPopoverPlacement):
 * moves it left, by its own `left`, where it would cross the screen's
 * right edge. The popover's place is its parent - the chip's `relative` box
 * it hangs from.
 *
 * Placed when it opens, and again whenever its size changes or the window's
 * does. The Dashboard writes its Tailwind CSS in the page as new classes
 * appear, so on the frame a popover first opens its width class may not
 * have landed yet: it measured as narrow as the chip, "fitted", and then
 * grew past the edge. A ResizeObserver hears it grow, before the frame is
 * drawn. Written to the element's style directly, so the placing never
 * waits for a render.
 */
const useChipPopoverShift: (
  popoverRef: { current: HTMLElement | null },
  isOpen: boolean,
) => void = (
  popoverRef: { current: HTMLElement | null },
  isOpen: boolean,
): void => {
  useLayoutEffect(() => {
    const popover: HTMLElement | null = popoverRef.current;

    if (!isOpen || !popover) {
      return;
    }

    const place: () => void = (): void => {
      const chip: HTMLElement | null = popover.parentElement;

      if (!chip) {
        return;
      }

      /*
       * In the page's own coordinates, so a page the browser has already
       * scrolled sideways to show a focused field still reads where the
       * chip really is.
       */
      const shift: number = getChipPopoverShift({
        chipLeft: chip.getBoundingClientRect().left + (window.scrollX || 0),
        popoverWidth: popover.offsetWidth,
        screenWidth: document.documentElement.clientWidth || window.innerWidth,
      });

      popover.style.left = shift > 0 ? `${-shift}px` : "";
    };

    place();

    const observer: ResizeObserver | null =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);

    observer?.observe(popover);
    window.addEventListener("resize", place);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [isOpen]);
};

export default useChipPopoverShift;
