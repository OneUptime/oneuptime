import NewVersion from "./NewVersion";
import TabMemory from "./TabMemory";

/*
 * A part of the app that will not download.
 *
 * Every frontend splits its code: each page (and some heavy components) is a
 * chunk of its own, fetched the first time it is shown, under a name that
 * changes with every build. A tab opened before a deploy still asks for the
 * chunks of the build it runs, and after the deploy the server no longer
 * has them: the import rejects, and the error reaches the nearest error
 * boundary. That boundary hands it to ChunkLoadRecovery, which finds out why
 * and moves the page onto the new version (see NewVersion).
 *
 * Browsers word this failure differently, hence the list.
 */
const CHUNK_LOAD_ERROR_PATTERNS: Array<RegExp> = [
  /Loading chunk \S+ failed/i,
  /Loading CSS chunk \S+ failed/i,
  /ChunkLoadError/i,
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Unable to preload CSS/i,
];

// TabMemory key holding the time of the last reload for a chunk that failed.
export const CHUNK_LOAD_RELOAD_STORAGE_KEY: string =
  "oneuptime-chunk-load-reload-at";

/*
 * If a reload does not fix the chunk error, reloading again will not either.
 * Only reload by itself when the last attempt is older than this, so a part
 * that is gone for good says so instead of reloading in a loop.
 */
export const CHUNK_LOAD_RELOAD_COOLDOWN_IN_MS: number = 30 * 1000;

export type IsChunkLoadErrorFunction = (error: unknown) => boolean;

export const isChunkLoadError: IsChunkLoadErrorFunction = (
  error: unknown,
): boolean => {
  if (!error) {
    return false;
  }

  const name: string =
    typeof (error as Error).name === "string" ? (error as Error).name : "";
  const message: string =
    typeof (error as Error).message === "string"
      ? (error as Error).message
      : String(error);

  const text: string = `${name} ${message}`;

  return CHUNK_LOAD_ERROR_PATTERNS.some((pattern: RegExp) => {
    return pattern.test(text);
  });
};

export type HasRecentlyReloadedFunction = (now: number) => boolean;

/*
 * Kept in TabMemory: sessionStorage, or window.name when site data is
 * blocked - so a tab that cannot use storage still remembers it just
 * reloaded, rather than reloading forever.
 */
export const hasRecentlyReloadedForChunkLoadError: HasRecentlyReloadedFunction =
  (now: number): boolean => {
    const lastReloadedAt: string | null = TabMemory.get(
      CHUNK_LOAD_RELOAD_STORAGE_KEY,
    );

    if (!lastReloadedAt) {
      return false;
    }

    const lastReloadedAtInMs: number = Number(lastReloadedAt);

    if (!Number.isFinite(lastReloadedAtInMs)) {
      return false;
    }

    return now - lastReloadedAtInMs < CHUNK_LOAD_RELOAD_COOLDOWN_IN_MS;
  };

export type MarkChunkLoadErrorReloadFunction = (now: number) => void;

export const markChunkLoadErrorReload: MarkChunkLoadErrorReloadFunction = (
  now: number,
): void => {
  TabMemory.set(CHUNK_LOAD_RELOAD_STORAGE_KEY, now.toString());
};

export type ReloadPageFunction = () => void;

export const reloadPage: ReloadPageFunction = (): void => {
  window.location.reload();
};

/*
 * Leaving a page aborts whatever the document is still downloading, and
 * Firefox rejects a lazy route bundle cut off that way with the very "error
 * loading dynamically imported module" a stale deploy produces. Reloading then
 * is not a recovery: window.location.reload() replaces the navigation that was
 * just started, so the page being left loads again and the destination never
 * does. Anyone who leaves a page, or is sent on by a forced navigation, while a
 * route bundle is still downloading is bounced back. The E2E onboarding showed
 * it on every Firefox run: opening /dashboard/welcome while /dashboard/ was
 * still fetching its Init route bundle reloaded /dashboard/ instead.
 *
 * The browser fires beforeunload before it cancels those downloads, so a chunk
 * error arriving after it is a side effect of leaving, not a missing asset.
 * pageshow marks the document as in use again (a back/forward cache restore).
 * If a beforeunload prompt keeps the user on the page, a later chunk error
 * is handled as any other.
 */
let isDocumentUnloading: boolean = false;

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (): void => {
    isDocumentUnloading = true;
  });

  window.addEventListener("pageshow", (): void => {
    isDocumentUnloading = false;
  });
}

export const isPageBeingLeft: () => boolean = (): boolean => {
  return isDocumentUnloading;
};

/*
 * Reloads once for a chunk that failed: into the same address, scrolled back
 * to where the reader was (NewVersion.reloadKeepingPlace). Returns true when
 * it reloaded, false when it would not: not a chunk error, the page is being
 * left, or it reloaded for one less than CHUNK_LOAD_RELOAD_COOLDOWN_IN_MS ago.
 */
export type HandleChunkLoadErrorFunction = (error: unknown) => boolean;

export const handleChunkLoadError: HandleChunkLoadErrorFunction = (
  error: unknown,
): boolean => {
  if (!isChunkLoadError(error)) {
    return false;
  }

  /*
   * Checked before the cooldown is recorded: the cooldown outlives this
   * document, and the page being navigated to must not inherit one for an
   * error that never called for a reload.
   */
  if (isDocumentUnloading) {
    return false;
  }

  const now: number = Date.now();

  if (hasRecentlyReloadedForChunkLoadError(now)) {
    return false;
  }

  markChunkLoadErrorReload(now);
  NewVersion.reloadKeepingPlace();

  return true;
};
