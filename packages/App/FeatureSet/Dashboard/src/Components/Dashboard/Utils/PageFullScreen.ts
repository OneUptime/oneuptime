import { useCallback, useEffect, useState } from "react";

/*
 * The browser's own full screen, for the whole page: the playlist player on
 * a wall (issue #5235) and a dashboard shown full screen (issue #10409).
 * It is asked of the browser and may be refused - a browser without it, a
 * phone that keeps it for videos, a page in a frame, a press the browser
 * does not count as the person's - and a refusal changes nothing else.
 *
 * The whole page, never one part of it: the toolbars, and the menus and
 * dialogs the page draws above everything on its <body>, stay on screen.
 */

interface FullScreenDocument {
  fullscreenElement?: Element | null | undefined;
  fullscreenEnabled?: boolean | undefined;
  exitFullscreen?: (() => Promise<void>) | undefined;
  documentElement: {
    requestFullscreen?: (() => Promise<void>) | undefined;
  };
}

function getFullScreenDocument(): FullScreenDocument | null {
  return typeof document === "undefined"
    ? null
    : (document as unknown as FullScreenDocument);
}

// Whether this browser can show the page full screen.
export function canShowPageFullScreen(): boolean {
  const page: FullScreenDocument | null = getFullScreenDocument();

  return Boolean(
    page &&
      typeof page.documentElement.requestFullscreen === "function" &&
      page.fullscreenEnabled !== false,
  );
}

export function isPageFullScreen(): boolean {
  const page: FullScreenDocument | null = getFullScreenDocument();

  return Boolean(page && page.fullscreenElement);
}

/*
 * Asks for the whole page full screen. Called straight from a press, before
 * anything is awaited: a browser grants it only for a press of the person's.
 * Resolves to whether it was granted.
 */
export function enterPageFullScreen(): Promise<boolean> {
  const page: FullScreenDocument | null = getFullScreenDocument();

  if (!page || typeof page.documentElement.requestFullscreen !== "function") {
    return Promise.resolve(false);
  }

  try {
    return page.documentElement.requestFullscreen().then(
      (): boolean => {
        return true;
      },
      (): boolean => {
        // Refused (no press of the person's, a frame that may not): as it is.
        return false;
      },
    );
  } catch {
    // An older browser that throws instead of rejecting.
    return Promise.resolve(false);
  }
}

export function exitPageFullScreen(): void {
  const page: FullScreenDocument | null = getFullScreenDocument();

  if (
    !page ||
    !page.fullscreenElement ||
    typeof page.exitFullscreen !== "function"
  ) {
    return;
  }

  page.exitFullscreen().catch(() => {
    // Already out of it.
  });
}

export interface PageFullScreen {
  isFullScreen: boolean;
  canGoFullScreen: boolean;
  toggle: () => void;
  exit: () => void;
}

// The page's full screen, as it changes - by a button, or by the browser's own Escape.
export const usePageFullScreen: () => PageFullScreen = (): PageFullScreen => {
  const [isFullScreen, setIsFullScreen] = useState<boolean>(isPageFullScreen);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const onChange: () => void = (): void => {
      setIsFullScreen(isPageFullScreen());
    };

    document.addEventListener("fullscreenchange", onChange);

    return () => {
      document.removeEventListener("fullscreenchange", onChange);
    };
  }, []);

  const toggle: () => void = useCallback((): void => {
    if (isPageFullScreen()) {
      exitPageFullScreen();
    } else {
      void enterPageFullScreen();
    }
  }, []);

  return {
    isFullScreen: isFullScreen,
    canGoFullScreen: canShowPageFullScreen(),
    toggle: toggle,
    exit: exitPageFullScreen,
  };
};
