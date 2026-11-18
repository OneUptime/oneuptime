import React, { useEffect, useRef, useState } from "react";

// Tailwind's md: below it a page is laid out for a phone.
export const PHONE_BELOW_WIDTH_IN_PX: number = 768;

// Whether the window is narrower than a width, now; never on a server.
export const isWindowBelowWidth: (width: number) => boolean = (
  width: number,
): boolean => {
  return typeof window !== "undefined" && window.innerWidth < width;
};

/*
 * Whether the window is narrower than a width - a breakpoint, as the
 * Table's phone layout reads it (window.innerWidth) - read again as the
 * window is resized. Read from the window as it is first drawn, too: a
 * phone never paints a frame laid out for a wide window first - a table
 * header's "Create Maintenance Event" broken onto two lines for
 * a moment, then "Create".
 */
const useIsBelowWidth: (width: number) => boolean = (
  width: number,
): boolean => {
  const [isBelow, setIsBelow] = useState<boolean>((): boolean => {
    return isWindowBelowWidth(width);
  });

  /*
   * What was last asked for, which every read is compared with: the first
   * read, and each of the window's resize events, mostly find the window on
   * the same side of the width, and ask for nothing then. Asked for all the
   * same, an unchanged answer stayed in React's queue at the priority it was
   * asked at - a resize's is above a page's - and the next update at a lower
   * one (rows arriving from the server) passed it by, then drew the
   * component once more to take it up: after a window was resized, every
   * table, its header and each of its rows drew their next page twice
   * (#7707).
   */
  const askedIsBelow: React.MutableRefObject<boolean> =
    useRef<boolean>(isBelow);

  useEffect(() => {
    const read: () => void = (): void => {
      const next: boolean = isWindowBelowWidth(width);

      if (next === askedIsBelow.current) {
        return;
      }

      askedIsBelow.current = next;
      setIsBelow(next);
    };

    read();
    window.addEventListener("resize", read);

    return () => {
      window.removeEventListener("resize", read);
    };
  }, [width]);

  return isBelow;
};

export default useIsBelowWidth;
