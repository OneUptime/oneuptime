import { useCallback, useEffect, useState } from "react";

/*
 * What a screen nobody touches needs from the browser, for the playlist
 * player (issue #5235): the page full screen, and the display kept awake.
 * Both are asked of the browser and may be refused - a browser without
 * them, a page in a frame, a tab out of sight - and a refusal changes
 * nothing else.
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
 * The whole page full screen, not the board alone: the player's bar, and
 * the menus and dialogs the page draws above everything, stay on screen.
 */
export function enterPageFullScreen(): void {
  const page: FullScreenDocument | null = getFullScreenDocument();

  if (!page || typeof page.documentElement.requestFullscreen !== "function") {
    return;
  }

  page.documentElement.requestFullscreen().catch(() => {
    // Refused (no gesture, a frame that may not): the page stays as it is.
  });
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

// The page's full screen, as it changes - by the player's button or by Escape.
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
      enterPageFullScreen();
    }
  }, []);

  return {
    isFullScreen: isFullScreen,
    canGoFullScreen: canShowPageFullScreen(),
    toggle: toggle,
    exit: exitPageFullScreen,
  };
};

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

interface WakeLockLike {
  request: (type: "screen") => Promise<WakeLockSentinelLike>;
}

function getWakeLock(): WakeLockLike | null {
  if (typeof navigator === "undefined") {
    return null;
  }

  const wakeLock: unknown = (navigator as unknown as { wakeLock?: unknown })
    .wakeLock;

  return wakeLock &&
    typeof (wakeLock as Partial<WakeLockLike>).request === "function"
    ? (wakeLock as WakeLockLike)
    : null;
}

/*
 * Keeps the display from going dark while `isActive`: a wall screen must
 * not sleep between two dashboards. The browser lets go of the lock when
 * the tab goes out of sight, so it is asked again each time the tab comes
 * back.
 */
export const useScreenWakeLock: (isActive: boolean) => void = (
  isActive: boolean,
): void => {
  useEffect(() => {
    const wakeLock: WakeLockLike | null = getWakeLock();

    if (!isActive || !wakeLock || typeof document === "undefined") {
      return undefined;
    }

    let sentinel: WakeLockSentinelLike | null = null;
    let isReleased: boolean = false;

    const release: (held: WakeLockSentinelLike) => void = (
      held: WakeLockSentinelLike,
    ): void => {
      held.release().catch(() => {
        // Already let go.
      });
    };

    const request: () => void = (): void => {
      if (document.visibilityState !== "visible") {
        return;
      }

      wakeLock
        .request("screen")
        .then((held: WakeLockSentinelLike) => {
          if (isReleased) {
            release(held);
            return;
          }

          sentinel = held;
        })
        .catch(() => {
          // Refused (a battery saver, a policy): the screen may sleep.
        });
    };

    const onVisibilityChange: () => void = (): void => {
      if (document.visibilityState === "visible") {
        request();
      }
    };

    request();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      isReleased = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);

      if (sentinel) {
        release(sentinel);
      }
    };
  }, [isActive]);
};
