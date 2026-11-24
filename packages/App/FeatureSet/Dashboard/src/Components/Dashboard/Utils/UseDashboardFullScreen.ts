import { MASTER_PAGE_MAIN_CONTENT_ID } from "Common/UI/Components/MasterPage/MasterPage";
import { getFrontmostEscapeLayer } from "Common/UI/Components/Tooltip/TooltipEscape";
import { PageInertScope, usePageInert } from "Common/UI/Utils/PageInert";
import { usePageScrollLock } from "Common/UI/Utils/PageScrollLock";
import {
  MutableRefObject,
  RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  DashboardFullScreenKeyAction,
  getDashboardFullScreenKeyAction,
} from "./DashboardFullScreenKeys";
import {
  canShowPageFullScreen,
  enterPageFullScreen,
  exitPageFullScreen,
  isPageFullScreen,
} from "./PageFullScreen";

/*
 * A DASHBOARD SHOWN FULL SCREEN (issue #10409): the dashboard alone, over the
 * whole window - no header, side menu, breadcrumbs or footer - with its
 * toolbar and its board, every control of both still working. It is the same
 * dashboard, drawn over the page rather than inside it, so nothing it holds
 * is read again or lost on the way in or out: a board being edited stays
 * edited.
 *
 * While it is up:
 *
 *   - the page behind it stays still (PageScrollLock) and out of reach: its
 *     header, menus, breadcrumbs and footer are inert, so Tab and a screen
 *     reader stay on the dashboard. The app's own layers are not - the
 *     command palette, Ask AI and the dialogs any page opens, beside the
 *     page in its <main>, and the notes beside the app in its root
 *     (getDashboardFullScreenInertScope);
 *   - Escape leaves it (DashboardFullScreenKeys), as does Exit Full Screen;
 *   - opened with Full Screen, it asks the browser for its own full screen
 *     too, where the browser allows it, so one press fills the screen and
 *     one Escape - the browser's own, which leaves that first - puts both
 *     away. Opened from its address instead (a new tab, a bookmark), it
 *     fills the window, and Fill the Screen asks the browser then: its
 *     Escape leaves only the browser's full screen, and the next one the
 *     dashboard's.
 *
 * The address says which view a tab shows; the page keeps it
 * (DashboardFullScreenAddress) and is told through onFullScreenChange.
 */

// The element the Dashboard's app is drawn in (src/Index.tsx, views/index.ejs).
export const DASHBOARD_APP_ROOT_ID: string = "root";

/*
 * How far the page behind a dashboard shown full screen goes inert: up to
 * the app's root, past the app's own layers in its <main>.
 */
export function getDashboardFullScreenInertScope(): PageInertScope {
  return {
    boundary: document.getElementById(DASHBOARD_APP_ROOT_ID),
    keepChildrenOf: [document.getElementById(MASTER_PAGE_MAIN_CONTENT_ID)],
  };
}

export interface UseDashboardFullScreenInput {
  // Whether the dashboard is shown full screen: what its address names.
  isFullScreen: boolean;
  // Asked to show it full screen, or not.
  onFullScreenChange: (isFullScreen: boolean) => void;
  // The view: what covers the page while it is full screen.
  viewRef: RefObject<HTMLElement>;
  /*
   * Where the focus goes when the view changes under it: the control that
   * changes it back (Full Screen, Exit Full Screen), which may be another
   * element after the change.
   */
  getToggle?: (() => HTMLElement | null) | undefined;
}

export interface DashboardFullScreen {
  isFullScreen: boolean;
  // Full Screen: the dashboard alone, and the browser's own full screen where it allows it.
  enter: () => void;
  // Exit Full Screen, or Escape: back to the dashboard's page, out of the browser's full screen too.
  exit: () => void;
  // Shown full screen in the window, where the browser could fill the screen and does not yet.
  canFillScreen: boolean;
  // Fill the Screen: the browser's own full screen, from the dashboard shown full screen.
  fillScreen: () => void;
}

const useDashboardFullScreen: (
  input: UseDashboardFullScreenInput,
) => DashboardFullScreen = (
  input: UseDashboardFullScreenInput,
): DashboardFullScreen => {
  const isFullScreen: boolean = input.isFullScreen;
  const viewRef: RefObject<HTMLElement> = input.viewRef;

  const [isBrowserFullScreen, setIsBrowserFullScreen] =
    useState<boolean>(isPageFullScreen);

  /*
   * Whether the browser's full screen came with the dashboard's, from one
   * press of Full Screen: the browser's Escape then puts both away. One
   * asked from the dashboard shown full screen (Fill the Screen), or none,
   * leaves the dashboard's as it is when it goes.
   */
  const browserFullScreenCameWithViewRef: MutableRefObject<boolean> =
    useRef<boolean>(false);

  // The latest of what the listeners read, so each is added once.
  const latestRef: MutableRefObject<{
    isFullScreen: boolean;
    onFullScreenChange: (isFullScreen: boolean) => void;
    getToggle: (() => HTMLElement | null) | undefined;
  }> = useRef({
    isFullScreen: isFullScreen,
    onFullScreenChange: input.onFullScreenChange,
    getToggle: input.getToggle,
  });

  latestRef.current = {
    isFullScreen: isFullScreen,
    onFullScreenChange: input.onFullScreenChange,
    getToggle: input.getToggle,
  };

  // The page behind stays still, and out of reach.
  usePageScrollLock(isFullScreen);
  usePageInert(isFullScreen, viewRef, getDashboardFullScreenInertScope);

  // The browser's full screen, as it comes and goes - by a button, or by its own Escape.
  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const onChange: () => void = (): void => {
      const isNowFullScreen: boolean = isPageFullScreen();

      setIsBrowserFullScreen(isNowFullScreen);

      if (isNowFullScreen || !browserFullScreenCameWithViewRef.current) {
        return;
      }

      browserFullScreenCameWithViewRef.current = false;

      // It came with the dashboard's: the Escape that took it takes both.
      if (latestRef.current.isFullScreen) {
        latestRef.current.onFullScreenChange(false);
      }
    };

    document.addEventListener("fullscreenchange", onChange);

    return () => {
      document.removeEventListener("fullscreenchange", onChange);
    };
  }, []);

  const enter: () => void = useCallback((): void => {
    if (latestRef.current.isFullScreen) {
      return;
    }

    /*
     * Asked straight from the press, before anything is awaited: a browser
     * grants its full screen only for a press of the person's. Refused, the
     * dashboard is full screen in the window all the same.
     */
    if (canShowPageFullScreen() && !isPageFullScreen()) {
      browserFullScreenCameWithViewRef.current = true;

      void enterPageFullScreen().then((isGranted: boolean): void => {
        if (!isGranted) {
          browserFullScreenCameWithViewRef.current = false;
        }
      });
    }

    latestRef.current.onFullScreenChange(true);
  }, []);

  const exit: () => void = useCallback((): void => {
    browserFullScreenCameWithViewRef.current = false;

    if (isPageFullScreen()) {
      exitPageFullScreen();
    }

    latestRef.current.onFullScreenChange(false);
  }, []);

  const fillScreen: () => void = useCallback((): void => {
    if (!latestRef.current.isFullScreen || isPageFullScreen()) {
      return;
    }

    // Asked from the view: the browser's Escape leaves the view as it is.
    browserFullScreenCameWithViewRef.current = false;
    void enterPageFullScreen();
  }, []);

  // Escape leaves it, when nothing in front had the key first.
  useEffect(() => {
    if (!isFullScreen) {
      return undefined;
    }

    const onKeyDown: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      const action: DashboardFullScreenKeyAction | null =
        getDashboardFullScreenKeyAction({
          event: event,
          hasOpenLayer: getFrontmostEscapeLayer(document) !== null,
          isBrowserFullScreen: isPageFullScreen(),
        });

      if (action !== DashboardFullScreenKeyAction.Exit) {
        return;
      }

      event.preventDefault();
      exit();
    };

    /*
     * Heard as the key bubbles up to the window, after what is in front of
     * the dashboard: a menu, a tooltip or a widget's drag that closes on
     * it marks it its own (preventDefault), and it is theirs alone.
     */
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isFullScreen, exit]);

  /*
   * The focus, when the view changes: kept where it is when it is still on
   * the dashboard; else on the control that changes it back, or, opening,
   * on the view itself - so Tab starts on the dashboard, never on the page
   * now out of reach behind it.
   */
  const hasDrawnRef: MutableRefObject<boolean> = useRef<boolean>(false);

  useEffect(() => {
    const view: HTMLElement | null = viewRef.current;
    const isFirstDraw: boolean = !hasDrawnRef.current;
    hasDrawnRef.current = true;

    if (!view || typeof document === "undefined") {
      return;
    }

    if (!isFirstDraw) {
      /*
       * What measures itself on a window resize - a chart, a menu kept on
       * the screen - learns its room changed: the board is as wide as the
       * window now, or as its column beside the side menu again.
       */
      window.dispatchEvent(new Event("resize"));
    }

    if (isFirstDraw && !isFullScreen) {
      return;
    }

    const active: Element | null = document.activeElement;

    if (
      active &&
      active !== document.body &&
      active.isConnected &&
      view.contains(active)
    ) {
      return;
    }

    const toggle: HTMLElement | null = latestRef.current.getToggle
      ? latestRef.current.getToggle()
      : null;

    if (toggle && !isFirstDraw) {
      toggle.focus({ preventScroll: true });
      return;
    }

    if (isFullScreen) {
      view.focus({ preventScroll: true });
    }
  }, [isFullScreen]);

  // Leaving the page while the dashboard is full screen: the browser's full screen goes with it.
  useEffect(() => {
    return () => {
      if (latestRef.current.isFullScreen && isPageFullScreen()) {
        exitPageFullScreen();
      }
    };
  }, []);

  return {
    isFullScreen: isFullScreen,
    enter: enter,
    exit: exit,
    canFillScreen:
      isFullScreen && !isBrowserFullScreen && canShowPageFullScreen(),
    fillScreen: fillScreen,
  };
};

export default useDashboardFullScreen;
