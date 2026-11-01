import React, { useLayoutEffect, useState } from "react";

/*
 * The width of the box a table is drawn in, and the window's.
 */
export interface TableBoxWidth {
  /*
   * The box, in whole pixels (rounded down, so a table that needed a width
   * only comes back to a box with all of it); null until it is read, and
   * where nothing is laid out (a box 0px wide, as in jsdom).
   */
  boxWidth: number | null;
  // The window, which stands in for the box where it is not read (TableFit).
  windowWidth: number;
}

const getWindowWidth: () => number = (): number => {
  return typeof window === "undefined" ? 0 : window.innerWidth;
};

/*
 * The width of the box a table is drawn in - read before the first paint,
 * and again whenever the box changes size - and the window's. The box is
 * as wide as its card, whatever the table holds: its width does not follow
 * how the table is drawn, so reading it never chases itself.
 *
 * Where the box cannot be read (no layout), the window's width is followed
 * instead, as the table always followed it.
 */
const useTableBoxWidth: (
  boxRef: React.RefObject<HTMLElement>,
) => TableBoxWidth = (boxRef: React.RefObject<HTMLElement>): TableBoxWidth => {
  const [width, setWidth] = useState<TableBoxWidth>(() => {
    return { boxWidth: null, windowWidth: getWindowWidth() };
  });

  useLayoutEffect(() => {
    const box: HTMLElement | null = boxRef.current;

    if (!box) {
      return undefined;
    }

    const read: () => void = (): void => {
      const measured: number = Math.floor(box.getBoundingClientRect().width);
      const boxWidth: number | null = measured > 0 ? measured : null;
      const windowWidth: number = getWindowWidth();

      setWidth((current: TableBoxWidth): TableBoxWidth => {
        if (
          current.boxWidth === boxWidth &&
          (boxWidth !== null || current.windowWidth === windowWidth)
        ) {
          return current;
        }

        return { boxWidth: boxWidth, windowWidth: windowWidth };
      });
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
