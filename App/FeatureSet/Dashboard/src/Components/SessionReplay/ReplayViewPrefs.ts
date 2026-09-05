import { REPLAY_RAIL_TAB_IDS, ReplayRailTabId } from "./Rail/ReplaySignalTypes";

/*
 * Per-viewer player preferences, in localStorage under one key.
 *
 * These are the things a viewer sets once and expects to stay set: the
 * speed they watch at (finding player-shell-16: 8x had to be re-selected
 * on every open), whether idle time is skipped, which rail tab was open,
 * how wide the rail is, whether the rail follows the playhead, whether the
 * page goes wide (no side menu) and whether the mouse trail is drawn.
 *
 * Every read and write is wrapped: localStorage throws in private windows
 * on some browsers, under a storage quota, and in sandboxed frames, and a
 * preference is never worth a broken player. The store is a tiny external
 * store (subscribe/getSnapshot) so Pages/Rum/View/Layout.tsx can re-render
 * through useSyncExternalStore when "wide" flips from inside the player,
 * without a context provider threaded through ModelPage.
 */

export const REPLAY_VIEW_PREFS_STORAGE_KEY: string = "oneuptime.replay.prefs";

/*
 * Stamped by the sessions list (sessionStorage) as the viewer navigates
 * into a recording, so the header's "Sessions" link can restore the exact
 * filtered list they came from instead of the bare list route.
 */
export const REPLAY_LIST_URL_STORAGE_KEY: string = "oneuptime.replay.listUrl";

/* Playback speeds the controls offer; anything else is treated as 1x. */
export const REPLAY_PREFS_MIN_SPEED: number = 0.25;
export const REPLAY_PREFS_MAX_SPEED: number = 8;

/* The rail's drag handle range, in rem, from the design. */
export const REPLAY_RAIL_MIN_WIDTH_REM: number = 22;
export const REPLAY_RAIL_MAX_WIDTH_REM: number = 44;
export const REPLAY_RAIL_DEFAULT_WIDTH_REM: number = 30;

export type ReplayDetailsTabId = "session" | "provenance" | "fidelity";

export interface ReplayViewPrefs {
  speed: number;
  skipIdle: boolean;
  railTab: ReplayRailTabId;
  railWidthRem: number;
  /* The rail collapsed to its icon strip. */
  railCollapsed: boolean;
  follow: boolean;
  /* No side menu on the player page. Default ON: the picture needs the room. */
  wide: boolean;
  mouseTrail: boolean;
  /* The last open tab of the details panel. */
  detailsTab: ReplayDetailsTabId;
}

/* The subset of Storage the store touches, so tests can hand in a fake. */
export interface ReplayPrefsStorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export type ReplayViewPrefsListener = (prefs: ReplayViewPrefs) => void;

export function getDefaultReplayViewPrefs(): ReplayViewPrefs {
  return {
    speed: 1,
    skipIdle: false,
    railTab: "all",
    railWidthRem: REPLAY_RAIL_DEFAULT_WIDTH_REM,
    railCollapsed: false,
    follow: true,
    wide: true,
    mouseTrail: true,
    detailsTab: "session",
  };
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNumberInRange(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

function readRailTab(value: unknown): ReplayRailTabId {
  if (
    typeof value === "string" &&
    (REPLAY_RAIL_TAB_IDS as ReadonlyArray<string>).includes(value)
  ) {
    return value as ReplayRailTabId;
  }

  return "all";
}

/*
 * The details panel used to carry Logs / Errors / Correlation tabs; those
 * now live in the rail. An old stored value falls back to "session" and is
 * never written back, so the retired ids age out of storage.
 */
function readDetailsTab(value: unknown): ReplayDetailsTabId {
  if (value === "session" || value === "provenance" || value === "fidelity") {
    return value;
  }

  return "session";
}

/*
 * Merge whatever was stored onto the defaults, field by field. A single
 * malformed field (an older Dashboard, a hand-edited value) costs that
 * field only, never the whole preference set.
 */
export function parseReplayViewPrefs(raw: unknown): ReplayViewPrefs {
  const defaults: ReplayViewPrefs = getDefaultReplayViewPrefs();

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return defaults;
  }

  const row: Record<string, unknown> = raw as Record<string, unknown>;

  return {
    speed: readNumberInRange(
      row["speed"],
      REPLAY_PREFS_MIN_SPEED,
      REPLAY_PREFS_MAX_SPEED,
      defaults.speed,
    ),
    skipIdle: readBoolean(row["skipIdle"], defaults.skipIdle),
    railTab: readRailTab(row["railTab"]),
    railWidthRem: readNumberInRange(
      row["railWidthRem"],
      REPLAY_RAIL_MIN_WIDTH_REM,
      REPLAY_RAIL_MAX_WIDTH_REM,
      defaults.railWidthRem,
    ),
    railCollapsed: readBoolean(row["railCollapsed"], defaults.railCollapsed),
    follow: readBoolean(row["follow"], defaults.follow),
    wide: readBoolean(row["wide"], defaults.wide),
    mouseTrail: readBoolean(row["mouseTrail"], defaults.mouseTrail),
    detailsTab: readDetailsTab(row["detailsTab"]),
  };
}

function readPrefsFromStorage(
  storage: ReplayPrefsStorageLike | null,
): ReplayViewPrefs {
  if (!storage) {
    return getDefaultReplayViewPrefs();
  }

  try {
    const raw: string | null = storage.getItem(REPLAY_VIEW_PREFS_STORAGE_KEY);

    if (!raw) {
      return getDefaultReplayViewPrefs();
    }

    return parseReplayViewPrefs(JSON.parse(raw));
  } catch {
    /* Unreadable storage or malformed JSON: the defaults are fine. */
    return getDefaultReplayViewPrefs();
  }
}

function writePrefsToStorage(
  storage: ReplayPrefsStorageLike | null,
  prefs: ReplayViewPrefs,
): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(REPLAY_VIEW_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* Quota or a read-only context: the in-memory value still applies. */
  }
}

/*
 * The browser's localStorage, or null where touching it throws (some
 * browsers throw on the property access itself when storage is blocked).
 */
export function resolveDefaultPrefsStorage(): ReplayPrefsStorageLike | null {
  try {
    if (typeof localStorage === "undefined" || !localStorage) {
      return null;
    }

    return localStorage;
  } catch {
    return null;
  }
}

export class ReplayViewPrefsStore {
  private readonly storage: ReplayPrefsStorageLike | null;
  private readonly listeners: Set<ReplayViewPrefsListener>;
  private snapshot: ReplayViewPrefs;

  public constructor(storage: ReplayPrefsStorageLike | null) {
    this.storage = storage;
    this.listeners = new Set<ReplayViewPrefsListener>();
    this.snapshot = readPrefsFromStorage(storage);
  }

  /* Stable identity between updates, so useSyncExternalStore bails out cheaply. */
  public getSnapshot(): ReplayViewPrefs {
    return this.snapshot;
  }

  public subscribe(listener: ReplayViewPrefsListener): () => void {
    this.listeners.add(listener);

    return (): void => {
      this.listeners.delete(listener);
    };
  }

  /* Re-read storage (another tab wrote it). */
  public reload(): ReplayViewPrefs {
    this.snapshot = readPrefsFromStorage(this.storage);
    this.notify();

    return this.snapshot;
  }

  public update(patch: Partial<ReplayViewPrefs>): ReplayViewPrefs {
    /* Validate through the parser so a caller cannot store an out-of-range value. */
    const next: ReplayViewPrefs = parseReplayViewPrefs({
      ...this.snapshot,
      ...patch,
    });

    const hasChanged: boolean = (
      Object.keys(next) as Array<keyof ReplayViewPrefs>
    ).some((key: keyof ReplayViewPrefs): boolean => {
      return next[key] !== this.snapshot[key];
    });

    if (!hasChanged) {
      return this.snapshot;
    }

    this.snapshot = next;
    writePrefsToStorage(this.storage, next);
    this.notify();

    return next;
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }
}

/* The one store the player and the layout share. */
export const replayViewPrefsStore: ReplayViewPrefsStore =
  new ReplayViewPrefsStore(resolveDefaultPrefsStorage());

/* The bound accessors useSyncExternalStore wants. */
export function subscribeToReplayViewPrefs(listener: () => void): () => void {
  return replayViewPrefsStore.subscribe(listener);
}

export function getReplayViewPrefsSnapshot(): ReplayViewPrefs {
  return replayViewPrefsStore.getSnapshot();
}

/* The page origin, when there is a window to read it from. */
function resolveCurrentOrigin(): string {
  try {
    return typeof window !== "undefined" && window.location
      ? window.location.origin
      : "";
  } catch {
    return "";
  }
}

/*
 * A stored value reduced to a same-origin path, or null.
 *
 * Two shapes are accepted because the list writes the second one: a
 * relative "/path?query", and an absolute "https://this-host/path?query"
 * (SessionReplayTable stamps window.location.href / buildFilteredUrl's
 * absolute result, and a reader that only took relative paths silently
 * dropped every stamp, so the back link never restored the filters -
 * integration-002).
 *
 * Anything else is rejected. sessionStorage is writable by any script on
 * the origin, so a "back" link must never become an open redirect: a
 * cross-origin absolute URL, a protocol-relative "//host", a backslash
 * (which some parsers fold into "/") and an unparseable value all return
 * null and leave the caller on its own list route.
 */
export function toSameOriginReplayListPath(
  value: string | null | undefined,
  origin?: string | null,
): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  if (value.includes("\\")) {
    return null;
  }

  if (value.startsWith("/")) {
    return value.startsWith("//") ? null : value;
  }

  const currentOrigin: string =
    typeof origin === "string" && origin.length > 0
      ? origin
      : resolveCurrentOrigin();

  if (currentOrigin.length === 0) {
    return null;
  }

  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (parsed.origin !== currentOrigin) {
    return null;
  }

  const path: string = `${parsed.pathname}${parsed.search}${parsed.hash}`;

  return path.startsWith("/") && !path.startsWith("//") ? path : null;
}

/*
 * The list URL to return to, or null. Only a same-origin location is
 * honoured, and it is always returned as a path (see above).
 */
export function readReplayListUrl(
  storage?: ReplayPrefsStorageLike | null,
  origin?: string | null,
): string | null {
  let source: ReplayPrefsStorageLike | null | undefined = storage;

  if (source === undefined) {
    try {
      source = typeof sessionStorage === "undefined" ? null : sessionStorage;
    } catch {
      source = null;
    }
  }

  if (!source) {
    return null;
  }

  try {
    return toSameOriginReplayListPath(
      source.getItem(REPLAY_LIST_URL_STORAGE_KEY),
      origin,
    );
  } catch {
    return null;
  }
}
