import { getRunningBuild, RunningBuild } from "./RunningBuild";
import {
  checkServerBuild,
  FetchFunction,
  ServerBuildCheckResult,
  ServerBuildStatus,
} from "./ServerBuildCheck";
import TabMemory from "./TabMemory";
import UnsavedChanges from "./UnsavedChanges";

/*
 * A new version of OneUptime deployed under an open tab, and moving the
 * reader onto it without getting in their way.
 *
 * The tab's code names its build, and the server says which build it serves
 * now (RunningBuild, ServerBuildCheck). This looks now and then - a while
 * after the page opens, when the tab comes back into view or into focus,
 * when the browser is back online, on a navigation, every ten minutes while
 * the tab is in view, and when a newer service worker takes over - never
 * more than once in half a minute. Once the server serves another build:
 *
 *   - the next page the reader opens is loaded in full from the server, so
 *     it arrives in the new version instead of asking the server for code
 *     the old version needs and the new one no longer has
 *     (NewVersionNavigation);
 *   - the Dashboard and the Admin Dashboard say a new version is ready, with
 *     Reload (NewVersionNotice);
 *   - a part of the page that still fails to download says it is loading
 *     the new version and reloads into the same address
 *     (ChunkLoadRecovery).
 *
 * Nothing reloads by itself while the reader has unsaved changes
 * (UnsavedChanges), while the browser is offline, or twice for the same
 * build: a reload that did not reach the new version (a cache in the way)
 * is not tried again for it.
 */

export enum NewVersionAudience {
  /*
   * Dashboard, Admin Dashboard and Accounts: people who use OneUptime, told
   * that OneUptime was updated.
   */
  Members = "members",
  /*
   * Status pages and public dashboards: their visitors, who never chose
   * OneUptime and are told only that the page has a newer version.
   */
  Visitors = "visitors",
}

export enum NewVersionStatus {
  // Not looked yet, or nothing answered.
  Unknown = "unknown",
  // The server serves the build this tab runs.
  Current = "current",
  // The server serves another build.
  Available = "available",
}

export interface NewVersionState {
  status: NewVersionStatus;
  // The build the server serves (Current and Available).
  serverBuildId: string | null;
}

export type NewVersionListener = (state: NewVersionState) => void;

export interface NewVersionStartOptions {
  audience: NewVersionAudience;
  // The rest stand in for the real thing in tests and fixtures.
  runningBuild?: RunningBuild | undefined;
  fetchFunction?: FetchFunction | undefined;
  firstCheckDelayInMs?: number | undefined;
  checkIntervalInMs?: number | undefined;
  minimumCheckGapInMs?: number | undefined;
}

// Long enough to stay out of the page's own first requests.
export const NEW_VERSION_FIRST_CHECK_DELAY_IN_MS: number = 30 * 1000;
export const NEW_VERSION_CHECK_INTERVAL_IN_MS: number = 10 * 60 * 1000;
export const NEW_VERSION_MINIMUM_CHECK_GAP_IN_MS: number = 30 * 1000;

// A place older than this belongs to some earlier visit, not to this reload.
export const NEW_VERSION_PLACE_MAX_AGE_IN_MS: number = 2 * 60 * 1000;
// How long a reloaded page keeps trying to scroll back while it fills in.
export const NEW_VERSION_PLACE_RESTORE_TIMEOUT_IN_MS: number = 10 * 1000;
/*
 * Still on the old page this long after asking for a reload: it did not
 * happen. Longer than the chunk reload cooldown, so a slow reload is never
 * taken for one that did not happen.
 */
export const NEW_VERSION_RELOAD_GIVE_UP_IN_MS: number = 45 * 1000;

/*
 * During a rolling deploy, servers of both versions answer side by side.
 * Back to "current" only after two answers in a row say so, so the notice
 * does not come and go while the deploy finishes.
 */
const SAME_ANSWERS_TO_RETURN_TO_CURRENT: number = 2;

// TabMemory keys.
export const NEW_VERSION_LOADED_FOR_KEY: string =
  "oneuptime-new-version-loaded-for";
export const NEW_VERSION_DISMISSED_KEY: string =
  "oneuptime-new-version-dismissed";
export const NEW_VERSION_PLACE_KEY: string = "oneuptime-new-version-place";

/*
 * The Dashboard's index.ejs calls this when a newer service worker takes
 * over the page, in place of reloading it (see its PWA script).
 */
export const NEW_SERVICE_WORKER_HOOK: string = "oneuptimeOnNewServiceWorker";

interface SavedPlace {
  href: string;
  scrollX: number;
  scrollY: number;
  savedAt: number;
}

type WindowWithHook = Window & Record<string, unknown>;

const isOffline: () => boolean = (): boolean => {
  return typeof navigator !== "undefined" && navigator.onLine === false;
};

const isPageVisible: () => boolean = (): boolean => {
  return (
    typeof document === "undefined" || document.visibilityState !== "hidden"
  );
};

export default class NewVersion {
  private static isStarted: boolean = false;
  private static audience: NewVersionAudience = NewVersionAudience.Members;
  private static runningBuild: RunningBuild | null = null;
  private static fetchFunction: FetchFunction | undefined = undefined;
  private static minimumCheckGapInMs: number =
    NEW_VERSION_MINIMUM_CHECK_GAP_IN_MS;

  private static state: NewVersionState = {
    status: NewVersionStatus.Unknown,
    serverBuildId: null,
  };

  private static sameAnswersInARow: number = 0;
  private static lastCheckStartedAt: number = 0;
  private static checkInFlight: Promise<ServerBuildCheckResult | null> | null =
    null;
  private static isReloading: boolean = false;
  private static reloadGiveUpTimer: ReturnType<typeof setTimeout> | null =
    null;
  private static listeners: Set<NewVersionListener> =
    new Set<NewVersionListener>();
  private static stopFunctions: Array<() => void> = [];

  /*
   * Called once by each frontend's entry, before its first render. Safe to
   * call again; only the first call counts.
   */
  public static start(options: NewVersionStartOptions): void {
    if (NewVersion.isStarted) {
      return;
    }

    NewVersion.isStarted = true;
    NewVersion.audience = options.audience;
    NewVersion.runningBuild = options.runningBuild || getRunningBuild();
    NewVersion.fetchFunction = options.fetchFunction;
    NewVersion.minimumCheckGapInMs =
      options.minimumCheckGapInMs ?? NEW_VERSION_MINIMUM_CHECK_GAP_IN_MS;

    UnsavedChanges.install();
    NewVersion.restorePlace();

    if (typeof window === "undefined") {
      return;
    }

    (window as unknown as WindowWithHook)[NEW_SERVICE_WORKER_HOOK] =
      (): void => {
        void NewVersion.checkNow({ force: true });
      };

    NewVersion.stopFunctions.push((): void => {
      delete (window as unknown as WindowWithHook)[NEW_SERVICE_WORKER_HOOK];
    });

    if (!NewVersion.canCheck()) {
      return;
    }

    const firstCheck: ReturnType<typeof setTimeout> = setTimeout(
      () => {
        void NewVersion.checkNow();
      },
      options.firstCheckDelayInMs ?? NEW_VERSION_FIRST_CHECK_DELAY_IN_MS,
    );

    const interval: ReturnType<typeof setInterval> = setInterval(
      () => {
        if (isPageVisible()) {
          void NewVersion.checkNow();
        }
      },
      options.checkIntervalInMs ?? NEW_VERSION_CHECK_INTERVAL_IN_MS,
    );

    const onVisibilityChange: () => void = (): void => {
      if (isPageVisible()) {
        void NewVersion.checkNow();
      }
    };

    const onFocus: () => void = (): void => {
      void NewVersion.checkNow();
    };

    // The last check probably failed for want of a network.
    const onOnline: () => void = (): void => {
      void NewVersion.checkNow({ force: true });
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);

    NewVersion.stopFunctions.push((): void => {
      clearTimeout(firstCheck);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    });
  }

  // For tests: stops looking and forgets everything.
  public static reset(): void {
    for (const stop of NewVersion.stopFunctions) {
      stop();
    }

    NewVersion.stopFunctions = [];
    NewVersion.isStarted = false;
    NewVersion.audience = NewVersionAudience.Members;
    NewVersion.runningBuild = null;
    NewVersion.fetchFunction = undefined;
    NewVersion.minimumCheckGapInMs = NEW_VERSION_MINIMUM_CHECK_GAP_IN_MS;
    NewVersion.state = { status: NewVersionStatus.Unknown, serverBuildId: null };
    NewVersion.sameAnswersInARow = 0;
    NewVersion.lastCheckStartedAt = 0;
    NewVersion.checkInFlight = null;
    NewVersion.isReloading = false;

    if (NewVersion.reloadGiveUpTimer) {
      clearTimeout(NewVersion.reloadGiveUpTimer);
      NewVersion.reloadGiveUpTimer = null;
    }

    NewVersion.listeners.clear();
  }

  public static getAudience(): NewVersionAudience {
    return NewVersion.audience;
  }

  public static getState(): NewVersionState {
    return NewVersion.state;
  }

  public static subscribe(listener: NewVersionListener): () => void {
    NewVersion.listeners.add(listener);

    return (): void => {
      NewVersion.listeners.delete(listener);
    };
  }

  // Whether a reload into the new version has begun.
  public static isReloadInProgress(): boolean {
    return NewVersion.isReloading;
  }

  private static getRunningBuild(): RunningBuild {
    return NewVersion.runningBuild || getRunningBuild();
  }

  // A build to compare, and a manifest to compare it with.
  private static canCheck(): boolean {
    const runningBuild: RunningBuild = NewVersion.getRunningBuild();
    return Boolean(runningBuild.buildId && runningBuild.manifestUrl);
  }

  private static setState(state: NewVersionState): void {
    if (
      state.status === NewVersion.state.status &&
      state.serverBuildId === NewVersion.state.serverBuildId
    ) {
      return;
    }

    NewVersion.state = state;

    for (const listener of Array.from(NewVersion.listeners)) {
      try {
        listener(state);
      } catch {
        // One listener failing must not keep the others from hearing it.
      }
    }
  }

  private static applyResult(result: ServerBuildCheckResult): void {
    if (result.status === ServerBuildStatus.New && result.serverBuildId) {
      NewVersion.sameAnswersInARow = 0;
      NewVersion.setState({
        status: NewVersionStatus.Available,
        serverBuildId: result.serverBuildId,
      });
      return;
    }

    if (result.status === ServerBuildStatus.Same) {
      if (NewVersion.state.status === NewVersionStatus.Available) {
        NewVersion.sameAnswersInARow++;

        if (NewVersion.sameAnswersInARow < SAME_ANSWERS_TO_RETURN_TO_CURRENT) {
          return;
        }
      }

      NewVersion.sameAnswersInARow = 0;
      NewVersion.setState({
        status: NewVersionStatus.Current,
        serverBuildId: result.serverBuildId,
      });
    }

    // No answer, or no manifest: nothing learned, nothing changes.
  }

  private static runCheck(): Promise<ServerBuildCheckResult | null> {
    if (NewVersion.checkInFlight) {
      return NewVersion.checkInFlight;
    }

    const runningBuild: RunningBuild = NewVersion.getRunningBuild();

    NewVersion.lastCheckStartedAt = Date.now();

    const check: Promise<ServerBuildCheckResult | null> = checkServerBuild({
      runningBuildId: runningBuild.buildId,
      manifestUrl: runningBuild.manifestUrl,
      fetchFunction: NewVersion.fetchFunction,
    })
      .then((result: ServerBuildCheckResult): ServerBuildCheckResult => {
        NewVersion.applyResult(result);
        return result;
      })
      .catch((): null => {
        // checkServerBuild never throws; a listener might have.
        return null;
      })
      .finally(() => {
        if (NewVersion.checkInFlight === check) {
          NewVersion.checkInFlight = null;
        }
      });

    NewVersion.checkInFlight = check;

    return check;
  }

  /*
   * Looks for a new version now, unless one was looked for less than half a
   * minute ago (force skips that). Resolves to null when it did not look.
   */
  public static checkNow(options?: {
    force?: boolean | undefined;
  }): Promise<ServerBuildCheckResult | null> {
    if (!NewVersion.isStarted || !NewVersion.canCheck()) {
      return Promise.resolve(null);
    }

    if (NewVersion.checkInFlight) {
      return NewVersion.checkInFlight;
    }

    if (
      !options?.force &&
      Date.now() - NewVersion.lastCheckStartedAt <
        NewVersion.minimumCheckGapInMs
    ) {
      return Promise.resolve(null);
    }

    return NewVersion.runCheck();
  }

  /*
   * Asks the server now, for a page whose code did not download: whether a
   * new version is the reason. Works before start() too. Resolves to null
   * when this tab's code names no build to compare.
   */
  public static probe(): Promise<ServerBuildCheckResult | null> {
    if (!NewVersion.canCheck()) {
      return Promise.resolve(null);
    }

    return NewVersion.runCheck();
  }

  // A navigation to another page: a good moment to look.
  public static noteNavigation(): void {
    void NewVersion.checkNow();
  }

  /*
   * Whether the page the reader is opening should be loaded in full from
   * the server - in the new version - instead of inside this tab's old one.
   */
  public static shouldLoadNavigationInFull(): boolean {
    const state: NewVersionState = NewVersion.state;

    if (
      !NewVersion.isStarted ||
      NewVersion.isReloading ||
      state.status !== NewVersionStatus.Available ||
      !state.serverBuildId
    ) {
      return false;
    }

    // Tried already, and the load did not reach it: do not try again.
    if (TabMemory.get(NEW_VERSION_LOADED_FOR_KEY) === state.serverBuildId) {
      return false;
    }

    if (isOffline()) {
      return false;
    }

    return !UnsavedChanges.hasUnsavedChanges();
  }

  private static reload(): void {
    NewVersion.markReloading();
    window.location.reload();
  }

  // A load into the new version has begun: remember the build it was for.
  private static markReloading(): void {
    NewVersion.isReloading = true;

    if (NewVersion.state.serverBuildId) {
      TabMemory.set(NEW_VERSION_LOADED_FOR_KEY, NewVersion.state.serverBuildId);
    }

    /*
     * A reload the browser did not carry out (a prompt kept the page, a
     * script stopped it) must not leave every later recovery waiting for it.
     */
    if (NewVersion.reloadGiveUpTimer) {
      clearTimeout(NewVersion.reloadGiveUpTimer);
    }

    NewVersion.reloadGiveUpTimer = setTimeout(() => {
      NewVersion.isReloading = false;
      NewVersion.reloadGiveUpTimer = null;
    }, NEW_VERSION_RELOAD_GIVE_UP_IN_MS);
  }

  /*
   * Loads the address the reader just went to in full. The router has
   * already moved the address there, so a reload is that load.
   */
  public static loadNavigationInFull(): void {
    NewVersion.reload();
  }

  /*
   * Opens an address of this app in full, in place of a navigation inside
   * the tab (Navigation.navigate). Replace keeps it from adding a history
   * entry, as the navigation it stands for would not have.
   */
  public static openInFull(
    address: string,
    options?: { replace?: boolean | undefined },
  ): void {
    NewVersion.markReloading();

    if (options?.replace) {
      window.location.replace(address);
      return;
    }

    window.location.assign(address);
  }

  /*
   * Reloads into the new version on the same address - query, hash and
   * all - and scrolls back to where the reader was once it loads.
   */
  public static reloadKeepingPlace(): void {
    if (typeof window === "undefined") {
      return;
    }

    const place: SavedPlace = {
      href: window.location.href,
      scrollX: Math.round(window.scrollX || 0),
      scrollY: Math.round(window.scrollY || 0),
      savedAt: Date.now(),
    };

    TabMemory.set(NEW_VERSION_PLACE_KEY, JSON.stringify(place));

    NewVersion.reload();
  }

  public static isNoticeDismissed(): boolean {
    const serverBuildId: string | null = NewVersion.state.serverBuildId;

    return Boolean(
      serverBuildId &&
        TabMemory.get(NEW_VERSION_DISMISSED_KEY) === serverBuildId,
    );
  }

  // Hides the notice for this build; a later build brings it back.
  public static dismissNotice(): void {
    const serverBuildId: string | null = NewVersion.state.serverBuildId;

    if (!serverBuildId) {
      return;
    }

    TabMemory.set(NEW_VERSION_DISMISSED_KEY, serverBuildId);

    for (const listener of Array.from(NewVersion.listeners)) {
      try {
        listener(NewVersion.state);
      } catch {
        // As in setState.
      }
    }
  }

  /*
   * After a reload this tab asked for: scrolls back to where the reader was.
   * The page fills in as its data arrives, so it keeps trying until it gets
   * there, the reader scrolls by themselves, or ten seconds pass.
   */
  public static restorePlace(): void {
    if (typeof window === "undefined") {
      return;
    }

    const saved: string | null = TabMemory.get(NEW_VERSION_PLACE_KEY);

    if (!saved) {
      return;
    }

    TabMemory.remove(NEW_VERSION_PLACE_KEY);

    let place: SavedPlace | null = null;

    try {
      place = JSON.parse(saved) as SavedPlace;
    } catch {
      return;
    }

    if (
      !place ||
      place.href !== window.location.href ||
      typeof place.scrollY !== "number" ||
      typeof place.scrollX !== "number" ||
      Date.now() - place.savedAt > NEW_VERSION_PLACE_MAX_AGE_IN_MS ||
      (place.scrollY <= 0 && place.scrollX <= 0)
    ) {
      return;
    }

    const target: SavedPlace = place;
    const deadline: number = Date.now() + NEW_VERSION_PLACE_RESTORE_TIMEOUT_IN_MS;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let isStopped: boolean = false;

    const userEvents: Array<string> = [
      "wheel",
      "touchstart",
      "keydown",
      "mousedown",
    ];

    const stop: () => void = (): void => {
      isStopped = true;

      if (timer) {
        clearTimeout(timer);
      }

      for (const eventName of userEvents) {
        window.removeEventListener(eventName, stop, true);
      }
    };

    for (const eventName of userEvents) {
      window.addEventListener(eventName, stop, true);
    }

    const step: () => void = (): void => {
      if (isStopped) {
        return;
      }

      try {
        window.scrollTo(target.scrollX, target.scrollY);
      } catch {
        stop();
        return;
      }

      const isThere: boolean =
        Math.abs((window.scrollY || 0) - target.scrollY) <= 1 &&
        Math.abs((window.scrollX || 0) - target.scrollX) <= 1;

      if (isThere || Date.now() >= deadline) {
        stop();
        return;
      }

      timer = setTimeout(step, 100);
    };

    step();
  }
}
