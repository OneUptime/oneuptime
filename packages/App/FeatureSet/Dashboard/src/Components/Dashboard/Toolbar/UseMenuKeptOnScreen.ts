import { RefObject, useLayoutEffect } from "react";

/*
 * A dashboard toolbar's menu kept on the screen: the auto-refresh menu while
 * viewing, and the editing row's Default time range and Default auto-refresh.
 *
 * Each hangs from its button - the auto-refresh menu from the button's end,
 * the editing row's from its start - which keeps it over the board at a
 * laptop's width. On a phone the toolbar wraps, and a button can land at the
 * other side of its line: a German or Persian board's auto-refresh button
 * ("1 Min.", "۱ دقیقه") moves to the start of a line of its own, and its
 * menu, hung from that button's end, ran off the screen's edge with "Alle 5
 * Sek. aktualisieren" cut in half. So once a menu is drawn it moves sideways
 * just as far as it must to keep the page's gutter at both edges, and not at
 * all while it fits.
 */

// The room a menu keeps at the screen's edges: the page's own side gutter.
export const TOOLBAR_MENU_SCREEN_GUTTER_PX: number = 16;

/*
 * How far a menu moves sideways (in pixels, rightwards positive) to stay on
 * the screen, from where its button puts it. Nothing while it fits; a menu
 * wider than the screen keeps its left edge in view.
 */
export const getMenuShiftToStayOnScreen: (data: {
  // The menu's left edge, where its button puts it.
  left: number;
  width: number;
  screenWidth: number;
}) => number = (data: {
  left: number;
  width: number;
  screenWidth: number;
}): number => {
  // Not laid out (no width yet): left where it is.
  if (!(data.width > 0) || !(data.screenWidth > 0)) {
    return 0;
  }

  const gutter: number = TOOLBAR_MENU_SCREEN_GUTTER_PX;
  let shift: number = 0;

  if (data.left + data.width > data.screenWidth - gutter) {
    shift = data.screenWidth - gutter - (data.left + data.width);
  }

  if (data.left + shift < gutter) {
    shift = gutter - data.left;
  }

  return Math.round(shift);
};

// The width a fixed or absolute box can use: short of a classic scrollbar.
const getScreenWidth: () => number = (): number => {
  return document.documentElement.clientWidth || window.innerWidth;
};

const useMenuKeptOnScreen: (data: {
  isOpen: boolean;
  menuRef: RefObject<HTMLElement>;
}) => void = (data: {
  isOpen: boolean;
  menuRef: RefObject<HTMLElement>;
}): void => {
  const { isOpen, menuRef } = data;

  useLayoutEffect(() => {
    const menu: HTMLElement | null = menuRef.current;

    if (!isOpen || !menu) {
      return undefined;
    }

    /*
     * The move is set on the element itself, before the menu is painted: a
     * left edge of its own in place of the one its button gives it. Its
     * own style prop (its layer) never names left or right, so a render of
     * the menu leaves them alone.
     */
    const place: () => void = (): void => {
      // The box it hangs from: its button's wrapper, positioned for it.
      const anchor: HTMLElement | null = menu.parentElement;

      if (!anchor) {
        return;
      }

      /*
       * Where its button puts it, in its wrapper - the stylesheet's answer,
       * which nothing on the screen changes - and how wide it is.
       */
      menu.style.left = "";
      menu.style.right = "";

      const styledLeft: number = parseFloat(window.getComputedStyle(menu).left);
      const offset: number = Number.isFinite(styledLeft)
        ? styledLeft
        : menu.offsetLeft;
      const width: number = menu.offsetWidth;

      /*
       * The wrapper's place on the screen, read with the menu hung towards
       * the side a page never scrolls to (left in English, right in a
       * right-to-left language). A menu past a right-to-left phone's left
       * edge widens the page, and the browser then draws every box further
       * along than the screen it shows - a transform did not help either,
       * the page still scrolled as far as the menu's place before it.
       */
      const isRightToLeft: boolean =
        window.getComputedStyle(menu).direction === "rtl";

      menu.style.left = isRightToLeft ? "0px" : "auto";
      menu.style.right = isRightToLeft ? "auto" : "0px";

      const anchorLeft: number =
        anchor.getBoundingClientRect().left + anchor.clientLeft;
      const shift: number = getMenuShiftToStayOnScreen({
        left: anchorLeft + offset,
        width: width,
        screenWidth: getScreenWidth(),
      });

      if (shift) {
        menu.style.left = `${offset + shift}px`;
        menu.style.right = "auto";
      } else {
        menu.style.left = "";
        menu.style.right = "";
      }
    };

    place();

    /*
     * Again whenever the menu's size settles or changes - the page's
     * Tailwind runtime styles a class it has not drawn before a moment after
     * the element mounts, so the first width read can be the unstyled one -
     * and when the screen turns or the window is resized.
     */
    const observer: ResizeObserver | null =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);

    observer?.observe(menu);
    window.addEventListener("resize", place);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      menu.style.left = "";
      menu.style.right = "";
    };
  }, [isOpen, menuRef]);
};

export default useMenuKeptOnScreen;
