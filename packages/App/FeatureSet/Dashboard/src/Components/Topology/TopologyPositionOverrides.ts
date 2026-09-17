import { TopologyPoint } from "../NetworkDevice/TopologyGraphUtil";
import { MAX_WORLD_COORDINATE, clampWorldPoint } from "./TopologyViewport";

/*
 * User-arranged node positions — what a drag produces and what survives
 * the sixty-second refresh.
 *
 * The computed layout is only ever a starting point. An operator who
 * drags the core switch to the top of the map has made a statement about
 * how they want to read their network, and nothing — not a refresh, not a
 * new device appearing, not a re-layout — is allowed to undo it. These
 * overrides are that statement, kept separately from the layout so the
 * layout stays a pure function of the graph and the arrangement stays a
 * pure function of the user.
 *
 * Free of localStorage on purpose: the component injects a storage
 * object, so persistence is testable without a DOM.
 */

export type PositionOverrides = ReadonlyMap<string, TopologyPoint>;

export type TopologyLayoutMode =
  | "force"
  | "tiered"
  | "radial"
  | "star"
  | "parentChild";

export const PERSISTED_OVERRIDES_VERSION: number = 1;
/*
 * Upper bound on how many positions are read back. The topology endpoint
 * caps endpoints at two thousand, so five thousand is generous; the point
 * is that a corrupt or hostile entry cannot make the app allocate without
 * limit.
 */
export const MAX_PERSISTED_OVERRIDES: number = 5000;
export const MAX_PERSISTED_KEY_LENGTH: number = 256;

export const EMPTY_OVERRIDES: PositionOverrides = new Map<
  string,
  TopologyPoint
>();

/** The subset of the Storage interface this module needs. */
export interface TopologyOverrideStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

/**
 * Storage key for one arrangement.
 *
 * Keyed by layout mode because force, tiered, radial, star and
 * parent-child are all different coordinate systems — a position saved in
 * tiered mode would fling the node off-screen in force mode. Keyed by site
 * because the node set and the framing differ. The version appears in the
 * key AND inside the payload so a future format change is a clean miss
 * rather than a half-understood read.
 *
 * Adding a mode therefore costs nothing here: the new mode simply names a
 * key nobody has written yet and starts with an empty arrangement, and
 * every arrangement saved under the older modes keeps its own key and
 * stays valid.
 */
export const positionOverridesStorageKey: (
  projectId: string,
  siteId: string | undefined,
  layoutMode: TopologyLayoutMode,
) => string = (
  projectId: string,
  siteId: string | undefined,
  layoutMode: TopologyLayoutMode,
): string => {
  return [
    "oneuptime.networkTopology.positions",
    `v${PERSISTED_OVERRIDES_VERSION}`,
    projectId || "unknown",
    siteId || "project",
    layoutMode,
  ].join(".");
};

/**
 * Layer user positions over a computed layout.
 *
 * The returned map's key set is exactly `base`'s: an override for a node
 * that is not in the layout is ignored rather than added. A phantom entry
 * would be invisible in the render loop yet would still widen the graph
 * bounds, so fit-to-view would frame a large empty region around a
 * device that no longer exists.
 */
export const mergePositionOverrides: (
  base: ReadonlyMap<string, TopologyPoint>,
  overrides: PositionOverrides,
) => Map<string, TopologyPoint> = (
  base: ReadonlyMap<string, TopologyPoint>,
  overrides: PositionOverrides,
): Map<string, TopologyPoint> => {
  const merged: Map<string, TopologyPoint> = new Map<string, TopologyPoint>();
  for (const [nodeId, point] of base) {
    const override: TopologyPoint | undefined = overrides.get(nodeId);
    if (
      override &&
      Number.isFinite(override.x) &&
      Number.isFinite(override.y)
    ) {
      merged.set(nodeId, { x: override.x, y: override.y });
    } else {
      merged.set(nodeId, point);
    }
  }
  return merged;
};

/**
 * Drop overrides for nodes that are no longer in the topology.
 *
 * Returns the SAME instance when nothing is dropped. That identity is
 * load-bearing: the poll runs every sixty seconds, and allocating a fresh
 * map each time would invalidate every memo downstream and re-render the
 * whole graph forever.
 */
export const prunePositionOverrides: (
  overrides: PositionOverrides,
  liveNodeIds: ReadonlySet<string>,
) => PositionOverrides = (
  overrides: PositionOverrides,
  liveNodeIds: ReadonlySet<string>,
): PositionOverrides => {
  let hasStale: boolean = false;
  for (const nodeId of overrides.keys()) {
    if (!liveNodeIds.has(nodeId)) {
      hasStale = true;
      break;
    }
  }
  if (!hasStale) {
    return overrides;
  }
  const pruned: Map<string, TopologyPoint> = new Map<string, TopologyPoint>();
  for (const [nodeId, point] of overrides) {
    if (liveNodeIds.has(nodeId)) {
      pruned.set(nodeId, point);
    }
  }
  return pruned;
};

/** One node moved. Always returns a new map. */
export const withPositionOverride: (
  overrides: PositionOverrides,
  nodeId: string,
  point: TopologyPoint,
) => PositionOverrides = (
  overrides: PositionOverrides,
  nodeId: string,
  point: TopologyPoint,
): PositionOverrides => {
  return withPositionOverrides(overrides, [{ nodeId: nodeId, point: point }]);
};

/** Several nodes moved in one gesture. Always returns a new map. */
export const withPositionOverrides: (
  overrides: PositionOverrides,
  moved: ReadonlyArray<{ nodeId: string; point: TopologyPoint }>,
) => PositionOverrides = (
  overrides: PositionOverrides,
  moved: ReadonlyArray<{ nodeId: string; point: TopologyPoint }>,
): PositionOverrides => {
  const next: Map<string, TopologyPoint> = new Map<string, TopologyPoint>(
    overrides,
  );
  for (const entry of moved) {
    if (
      !entry ||
      typeof entry.nodeId !== "string" ||
      entry.nodeId.length === 0 ||
      !entry.point ||
      !Number.isFinite(entry.point.x) ||
      !Number.isFinite(entry.point.y)
    ) {
      continue;
    }
    next.set(entry.nodeId, clampWorldPoint(entry.point));
  }
  return next;
};

/** Forget one node's position, restoring it to the computed layout. */
export const withoutPositionOverride: (
  overrides: PositionOverrides,
  nodeId: string,
) => PositionOverrides = (
  overrides: PositionOverrides,
  nodeId: string,
): PositionOverrides => {
  if (!overrides.has(nodeId)) {
    return overrides;
  }
  const next: Map<string, TopologyPoint> = new Map<string, TopologyPoint>(
    overrides,
  );
  next.delete(nodeId);
  return next;
};

interface PersistedOverridesPayload {
  version: number;
  positions: Record<string, [number, number]>;
}

/**
 * Serialize an arrangement.
 *
 * Coordinates are tuples rather than {x, y} objects (materially smaller
 * at a couple of thousand endpoints), keys are sorted and values rounded
 * to two decimals, so the same arrangement always produces byte-identical
 * output. That makes the result testable and lets the caller skip a write
 * when nothing actually changed.
 */
export const serializePersistedOverrides: (
  overrides: PositionOverrides,
) => string = (overrides: PositionOverrides): string => {
  const positions: Record<string, [number, number]> = {};
  const keys: Array<string> = Array.from(overrides.keys()).sort();
  for (const key of keys) {
    const point: TopologyPoint = overrides.get(key)!;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      continue;
    }
    positions[key] = [
      Math.round(point.x * 100) / 100,
      Math.round(point.y * 100) / 100,
    ];
  }
  const payload: PersistedOverridesPayload = {
    version: PERSISTED_OVERRIDES_VERSION,
    positions: positions,
  };
  return JSON.stringify(payload);
};

/**
 * Read an arrangement back from untrusted text.
 *
 * NEVER throws and always returns a Map. localStorage is user-writable
 * and survives app upgrades, so this input is genuinely untrusted: a
 * single NaN reaching an SVG attribute makes that element disappear, and
 * a NaN reaching the bounds calculation blanks the whole graph.
 *
 * A partly corrupt payload keeps its valid entries — the same
 * "drop malformed rows, render the rest" rule the topology response
 * parser already follows. Results are built into a Map rather than an
 * object literal, which is also what makes a `__proto__` or `constructor`
 * key inert instead of dangerous.
 */
export const parsePersistedOverrides: (
  raw: string | null | undefined,
) => PositionOverrides = (
  raw: string | null | undefined,
): PositionOverrides => {
  const result: Map<string, TopologyPoint> = new Map<string, TopologyPoint>();
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return result;
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return result;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return result;
  }

  const payload: Record<string, unknown> = parsed as Record<string, unknown>;
  if (payload["version"] !== PERSISTED_OVERRIDES_VERSION) {
    return result;
  }

  const positions: unknown = payload["positions"];
  if (
    typeof positions !== "object" ||
    positions === null ||
    Array.isArray(positions)
  ) {
    return result;
  }

  const entries: Record<string, unknown> = positions as Record<string, unknown>;
  for (const key of Object.keys(entries)) {
    if (result.size >= MAX_PERSISTED_OVERRIDES) {
      break;
    }
    if (key.length === 0 || key.length > MAX_PERSISTED_KEY_LENGTH) {
      continue;
    }
    const value: unknown = entries[key];
    if (!Array.isArray(value) || value.length !== 2) {
      continue;
    }
    const x: unknown = value[0];
    const y: unknown = value[1];
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      continue;
    }
    result.set(key, clampWorldPoint({ x: x, y: y }));
  }

  return result;
};

/** Load an arrangement, tolerating storage that throws or is absent. */
export const readPersistedOverrides: (
  storage: TopologyOverrideStorage | null | undefined,
  key: string,
) => PositionOverrides = (
  storage: TopologyOverrideStorage | null | undefined,
  key: string,
): PositionOverrides => {
  if (!storage) {
    return EMPTY_OVERRIDES;
  }
  try {
    return parsePersistedOverrides(storage.getItem(key));
  } catch {
    /*
     * Safari in private mode throws on access, not just on write. Losing
     * a saved arrangement is a small disappointment; a topology page that
     * cannot render is not.
     */
    return EMPTY_OVERRIDES;
  }
};

/** Save an arrangement, or clear the entry when there is nothing to save. */
export const writePersistedOverrides: (
  storage: TopologyOverrideStorage | null | undefined,
  key: string,
  overrides: PositionOverrides,
) => void = (
  storage: TopologyOverrideStorage | null | undefined,
  key: string,
  overrides: PositionOverrides,
): void => {
  if (!storage) {
    return;
  }
  try {
    if (overrides.size === 0) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, serializePersistedOverrides(overrides));
  } catch {
    // Quota exhausted or storage disabled — persistence is best effort.
  }
};

/**
 * The persistence side of one topology view: the arrangement currently on
 * screen, the storage key it belongs to, and — the whole point — when
 * each of those two is allowed to move.
 *
 * They do not move together, and that is what makes this worth a type of
 * its own. Picking a new layout mode re-renders the view with the
 * INCOMING mode's storage key while the arrangement in state is still the
 * OUTGOING mode's coordinates, and the flush that saves the outgoing
 * arrangement runs inside exactly that window. Pair the two up there and
 * the write files tiered coordinates under the star key, the load that
 * immediately follows reads them straight back, and the node is drawn at
 * a position from a coordinate system it was never in — the off-screen
 * fling the mode-keyed storage exists to prevent. Worse, the star
 * arrangement the operator actually built is gone, overwritten by the
 * mode they just left.
 *
 * So {@link ArrangementPersistence.hold} carries coordinates and never
 * touches the key, {@link ArrangementPersistence.adopt} is the only thing
 * that moves the key and it moves it together with the arrangement it
 * just read from that key, and a flush is therefore always a write of an
 * arrangement to the key it came from.
 */
export interface ArrangementPersistence {
  /** The key the held arrangement belongs to. */
  keyInUse: () => string;
  /** The arrangement a flush would write. */
  held: () => PositionOverrides;
  /** The coordinates moved — a drag, a prune — but the mode did not. */
  hold: (overrides: PositionOverrides) => void;
  /**
   * Switch to `key`: load its arrangement and make that the held one.
   * Returns what was loaded so the caller can put it on screen.
   */
  adopt: (key: string) => PositionOverrides;
  /** Write what is held, under the key it belongs to. */
  flush: () => void;
}

export const createArrangementPersistence: (
  storage: TopologyOverrideStorage | null | undefined,
  key: string,
) => ArrangementPersistence = (
  storage: TopologyOverrideStorage | null | undefined,
  key: string,
): ArrangementPersistence => {
  let heldKey: string = key;
  let heldOverrides: PositionOverrides = EMPTY_OVERRIDES;

  return {
    keyInUse: (): string => {
      return heldKey;
    },
    held: (): PositionOverrides => {
      return heldOverrides;
    },
    hold: (overrides: PositionOverrides): void => {
      heldOverrides = overrides;
    },
    adopt: (nextKey: string): PositionOverrides => {
      const loaded: PositionOverrides = readPersistedOverrides(
        storage,
        nextKey,
      );
      heldKey = nextKey;
      heldOverrides = loaded;
      return loaded;
    },
    flush: (): void => {
      writePersistedOverrides(storage, heldKey, heldOverrides);
    },
  };
};

export { MAX_WORLD_COORDINATE };
