import { useEffect, useState } from "react";

/*
 * Tailwind's 2xl breakpoint. Below it the Databases tables leave their
 * low-priority columns hidden by default (the column picker still offers
 * them): at a 1440 px laptop the list was 1852 px wide inside a 1098 px
 * card, so Last Seen and the View button sat off-screen.
 */
export const DATABASE_WIDE_TABLE_MIN_WIDTH_PX: number = 1536;

export function isDatabaseWideTableViewport(
  width: number | null | undefined,
): boolean {
  return (
    typeof width === "number" &&
    Number.isFinite(width) &&
    width >= DATABASE_WIDE_TABLE_MIN_WIDTH_PX
  );
}

function currentViewportWidth(): number | null {
  return typeof window === "undefined" ? null : window.innerWidth;
}

/** Whether the viewport is wide enough for every column; follows resizes. */
export default function useDatabaseWideTable(): boolean {
  const [isWide, setIsWide] = useState<boolean>((): boolean => {
    return isDatabaseWideTableViewport(currentViewportWidth());
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const onResize: () => void = (): void => {
      setIsWide(isDatabaseWideTableViewport(currentViewportWidth()));
    };
    window.addEventListener("resize", onResize);
    return (): void => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return isWide;
}
