import { useEffect } from "react";

/*
 * What a screen nobody touches needs from the browser, for the playlist
 * player (issue #5235): the display kept awake. It is asked of the browser
 * and may be refused - a browser without it, a tab out of sight - and a
 * refusal changes nothing else. The page's full screen, which the player
 * asks for too, is the dashboard's own (Utils/PageFullScreen): a dashboard
 * shown full screen asks for it as well (issue #10409).
 */

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
