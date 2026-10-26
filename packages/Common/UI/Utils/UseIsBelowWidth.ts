import { useEffect, useState } from "react";

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
 * header's "Create Scheduled Maintenance Event" broken onto two lines for
 * a moment, then "Create".
 */
const useIsBelowWidth: (width: number) => boolean = (
  width: number,
): boolean => {
  const [isBelow, setIsBelow] = useState<boolean>((): boolean => {
    return isWindowBelowWidth(width);
  });

  useEffect(() => {
    const read: () => void = (): void => {
      setIsBelow(isWindowBelowWidth(width));
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
