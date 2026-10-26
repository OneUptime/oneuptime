import { useEffect, useState } from "react";

// Tailwind's md: below it a page is laid out for a phone.
export const PHONE_BELOW_WIDTH_IN_PX: number = 768;

/*
 * Whether the window is narrower than a width - a breakpoint, as the
 * Table's phone layout reads it (window.innerWidth) - read again as the
 * window is resized. False until its first effect has run, as the Table's
 * is, so what is drawn before then is drawn for a wide window.
 */
const useIsBelowWidth: (width: number) => boolean = (
  width: number,
): boolean => {
  const [isBelow, setIsBelow] = useState<boolean>(false);

  useEffect(() => {
    const read: () => void = (): void => {
      setIsBelow(window.innerWidth < width);
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
