import NewVersion from "./NewVersion/NewVersion";
import {
  ServerBuildCheckResult,
  ServerBuildStatus,
} from "./NewVersion/ServerBuildCheck";
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * Whether the browser is offline under an open page, as the page should
 * treat it: offline from the moment the browser says so (navigator.onLine,
 * the offline event) until it says it is back (the online event) - or, when
 * the reader asks to try again, until anything answers: a browser that
 * still says it is offline while the server answers is wrong, and the page
 * comes back.
 *
 * The page itself is never thrown away for it: MasterPage keeps it as it is
 * - what was typed, where it was scrolled - and shows OfflineScreen in its
 * place until this says the network is back.
 */

// The spinner a Try again draws stays this long, so the check is seen.
export const OFFLINE_CHECK_MINIMUM_IN_MS: number = 600;

export interface BrowserOffline {
  isOffline: boolean;
  // A Try again asking right now.
  isChecking: boolean;
  // Looks again: the browser back online, or the server answering after all.
  checkNow: () => void;
}

export type IsServerReachableFunction = () => Promise<boolean | null>;

const isBrowserOffline: () => boolean = (): boolean => {
  return typeof navigator !== "undefined" && navigator.onLine === false;
};

/*
 * Whether the server answers at all: anything but no answer (a new build, the
 * same one, a page instead of the manifest, even a 503) means the network is
 * there. Null when this tab's code names no manifest to ask for (a build
 * made outside Common's build(), a test).
 */
export const isServerReachable: IsServerReachableFunction = async (): Promise<
  boolean | null
> => {
  const result: ServerBuildCheckResult | null = await NewVersion.probe();

  if (!result) {
    return null;
  }

  return result.status !== ServerBuildStatus.Unreachable;
};

const wait: (ms: number) => Promise<void> = (ms: number): Promise<void> => {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, ms);
  });
};

const useBrowserOffline: (options?: {
  isServerReachable?: IsServerReachableFunction | undefined;
  checkMinimumInMs?: number | undefined;
}) => BrowserOffline = (options?: {
  isServerReachable?: IsServerReachableFunction | undefined;
  checkMinimumInMs?: number | undefined;
}): BrowserOffline => {
  const [isOffline, setIsOffline] = useState<boolean>(isBrowserOffline);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const isMounted: MutableRefObject<boolean> = useRef<boolean>(true);
  const checkInFlight: MutableRefObject<boolean> = useRef<boolean>(false);

  const probe: IsServerReachableFunction =
    options?.isServerReachable || isServerReachable;
  const checkMinimumInMs: number =
    options?.checkMinimumInMs ?? OFFLINE_CHECK_MINIMUM_IN_MS;

  useEffect(() => {
    isMounted.current = true;

    const onOnline: () => void = (): void => {
      setIsOffline(false);
    };

    const onOffline: () => void = (): void => {
      setIsOffline(true);
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    // Whatever changed between the first render and now.
    setIsOffline(isBrowserOffline());

    return () => {
      isMounted.current = false;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const checkNow: () => void = useCallback((): void => {
    if (checkInFlight.current) {
      return;
    }

    checkInFlight.current = true;
    setIsChecking(true);

    const startedAt: number = Date.now();

    void (async (): Promise<void> => {
      let isBack: boolean = !isBrowserOffline();

      if (!isBack) {
        try {
          isBack = (await probe()) === true;
        } catch {
          isBack = false;
        }
      }

      const shownFor: number = Date.now() - startedAt;

      if (shownFor < checkMinimumInMs) {
        await wait(checkMinimumInMs - shownFor);
      }

      checkInFlight.current = false;

      if (!isMounted.current) {
        return;
      }

      setIsChecking(false);

      if (isBack) {
        setIsOffline(false);
      }
    })();
  }, [probe, checkMinimumInMs]);

  return { isOffline, isChecking, checkNow };
};

export default useBrowserOffline;
