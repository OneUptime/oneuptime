import React, { useLayoutEffect, useState } from "react";

/*
 * The width of the box a table is drawn in, in whole pixels (rounded down,
 * so a table that needed a width only comes back to a box with all of it)
 * - read before the first paint, and again whenever the box changes size.
 * The box is as wide as its card, whatever the table holds: its width does
 * not follow how the table is drawn, so reading it never chases itself.
 *
 * Null until it is read, and where nothing is laid out (a box 0px wide, as
 * in jsdom): the window stands in for it then (TableFit).
 */
const useTableBoxWidth: (
  boxRef: React.RefObject<HTMLElement>,
) => number | null = (boxRef: React.RefObject<HTMLElement>): number | null => {
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const box: HTMLElement | null = boxRef.current;

    if (!box) {
      return undefined;
    }

    const read: () => void = (): void => {
      const measured: number = Math.floor(box.getBoundingClientRect().width);

      setWidth(measured > 0 ? measured : null);
    };

    read();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", read);

      return () => {
        window.removeEventListener("resize", read);
      };
    }

    let frame: number | null = null;

    /*
     * Read on the next frame, as the table's own measuring is
     * (useTableScrollState): a size read inside the observer's call that
     * changes the layout is one it cannot deliver.
     */
    const observer: ResizeObserver = new ResizeObserver(() => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }

      frame = window.requestAnimationFrame(() => {
        frame = null;
        read();
      });
    });

    observer.observe(box);

    return () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }

      observer.disconnect();
    };
  }, [boxRef]);

  return width;
};

export default useTableBoxWidth;
