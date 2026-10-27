import {
  MutableRefObject,
  RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";

/*
 * The reader's place in a page that MasterPage puts away while the browser
 * is offline: how far the window was scrolled, and the field (or button)
 * that had focus - its caret stays in it. A page put away is not laid out,
 * so under the "You're offline" card the window scrolls back to the top and
 * what had focus loses it. Both come back with the page, so it is there
 * just as the reader left it. Boxes scrolled inside the page keep their own
 * place.
 *
 * Taken as the browser says it is offline, before the page is put away,
 * and given back only at the same address: a page opened meanwhile starts
 * where it starts. Focus goes back only when nothing else took it
 * meanwhile.
 */

export interface OfflinePlace {
  address: string;
  scrollX: number;
  scrollY: number;
  // What had focus in the page, if anything there had it.
  focused: HTMLElement | null;
}

export type TakeOfflinePlaceFunction = (
  page: HTMLElement | null,
) => OfflinePlace;

export const takeOfflinePlace: TakeOfflinePlaceFunction = (
  page: HTMLElement | null,
): OfflinePlace => {
  const active: Element | null = document.activeElement;

  return {
    address: window.location.href,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    focused:
      page && active instanceof HTMLElement && page.contains(active)
        ? active
        : null,
  };
};

export type GiveBackOfflinePlaceFunction = (place: OfflinePlace) => void;

export const giveBackOfflinePlace: GiveBackOfflinePlaceFunction = (
  place: OfflinePlace,
): void => {
  if (place.address !== window.location.href) {
    return;
  }

  if (window.scrollX !== place.scrollX || window.scrollY !== place.scrollY) {
    window.scrollTo(place.scrollX, place.scrollY);
  }

  const active: Element | null = document.activeElement;
  const isFocusFree: boolean = !active || active === document.body;

  if (place.focused && place.focused.isConnected && isFocusFree) {
    // The window is where it was: focusing must not move it.
    place.focused.focus({ preventScroll: true });
  }
};

const useOfflinePlace: (
  pageRef: RefObject<HTMLElement>,
  isOffline: boolean,
) => void = (pageRef: RefObject<HTMLElement>, isOffline: boolean): void => {
  const place: MutableRefObject<OfflinePlace | null> =
    useRef<OfflinePlace | null>(null);
  const isPutAway: MutableRefObject<boolean> = useRef<boolean>(isOffline);

  useEffect(() => {
    const remember: () => void = (): void => {
      // A page already put away has no place left to take: keep the first.
      if (isPutAway.current) {
        return;
      }

      place.current = takeOfflinePlace(pageRef.current);
    };

    /*
     * Capturing, so it runs before the listener that puts the page away
     * (UseBrowserOffline), while the page is laid out as the reader left it.
     */
    window.addEventListener("offline", remember, true);

    return () => {
      window.removeEventListener("offline", remember, true);
    };
  }, [pageRef]);

  // Before the page is painted again, so it never shows at the top first.
  useLayoutEffect(() => {
    isPutAway.current = isOffline;

    if (isOffline) {
      return;
    }

    const kept: OfflinePlace | null = place.current;

    place.current = null;

    if (kept) {
      giveBackOfflinePlace(kept);
    }
  }, [isOffline]);
};

export default useOfflinePlace;
