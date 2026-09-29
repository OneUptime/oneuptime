import { describe, expect, test } from "@jest/globals";
import { TopologyPoint } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyGraphUtil";
import {
  ArrangementPersistence,
  EMPTY_OVERRIDES,
  MAX_PERSISTED_KEY_LENGTH,
  MAX_PERSISTED_OVERRIDES,
  MAX_WORLD_COORDINATE,
  PERSISTED_OVERRIDES_VERSION,
  PositionOverrides,
  TopologyLayoutMode,
  TopologyOverrideStorage,
  createArrangementPersistence,
  mergePositionOverrides,
  parsePersistedOverrides,
  positionOverridesStorageKey,
  prunePositionOverrides,
  readPersistedOverrides,
  serializePersistedOverrides,
  withPositionOverride,
  withPositionOverrides,
  withoutPositionOverride,
  writePersistedOverrides,
} from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyPositionOverrides";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

interface MovedNode {
  nodeId: string;
  point: TopologyPoint;
}

type MakeMapFunction = (
  entries: ReadonlyArray<[string, TopologyPoint]>,
) => Map<string, TopologyPoint>;

const makeMap: MakeMapFunction = (
  entries: ReadonlyArray<[string, TopologyPoint]>,
): Map<string, TopologyPoint> => {
  return new Map<string, TopologyPoint>(entries);
};

/*
 * Deterministic pseudo-random unit value. Math.random would make the
 * round-trip fixtures irreproducible, so an xorshift step over an integer
 * seed stands in for it.
 */
type SeededUnitFunction = (seed: number) => number;

const seededUnit: SeededUnitFunction = (seed: number): number => {
  let x: number = seed >>> 0;
  if (x === 0) {
    x = 0x9e3779b9;
  }
  x ^= x << 13;
  x >>>= 0;
  x ^= x >> 17;
  x >>>= 0;
  x ^= x << 5;
  x >>>= 0;
  return x / 4294967296;
};

/* A persisted payload of the current version wrapping raw positions JSON. */
type RawPayloadFunction = (positionsJson: string) => string;

const rawPayload: RawPayloadFunction = (positionsJson: string): string => {
  return `{"version":${String(
    PERSISTED_OVERRIDES_VERSION,
  )},"positions":${positionsJson}}`;
};

/* The same, built from a live object so JSON.stringify does the escaping. */
type PayloadForFunction = (positions: Record<string, unknown>) => string;

const payloadFor: PayloadForFunction = (
  positions: Record<string, unknown>,
): string => {
  return JSON.stringify({
    version: PERSISTED_OVERRIDES_VERSION,
    positions: positions,
  });
};

/* A recording stand-in for window.localStorage. */
interface FakeStorage extends TopologyOverrideStorage {
  data: Map<string, string>;
  getCalls: Array<string>;
  setCalls: Array<{ key: string; value: string }>;
  removeCalls: Array<string>;
}

type MakeFakeStorageFunction = () => FakeStorage;

const makeFakeStorage: MakeFakeStorageFunction = (): FakeStorage => {
  const data: Map<string, string> = new Map<string, string>();
  const getCalls: Array<string> = [];
  const setCalls: Array<{ key: string; value: string }> = [];
  const removeCalls: Array<string> = [];
  return {
    data: data,
    getCalls: getCalls,
    setCalls: setCalls,
    removeCalls: removeCalls,
    getItem: (key: string): string | null => {
      getCalls.push(key);
      if (!data.has(key)) {
        return null;
      }
      return data.get(key)!;
    },
    setItem: (key: string, value: string): void => {
      setCalls.push({ key: key, value: value });
      data.set(key, value);
    },
    removeItem: (key: string): void => {
      removeCalls.push(key);
      data.delete(key);
    },
  };
};

/* Safari in private mode: every storage access throws, reads included. */
type MakeThrowingStorageFunction = () => TopologyOverrideStorage;

const makeThrowingStorage: MakeThrowingStorageFunction =
  (): TopologyOverrideStorage => {
    return {
      getItem: (): string | null => {
        throw new Error("SecurityError: the operation is insecure");
      },
      setItem: (): void => {
        throw new Error("QuotaExceededError");
      },
      removeItem: (): void => {
        throw new Error("QuotaExceededError");
      },
    };
  };

const STORAGE_KEY: string = "test.topology.positions";

/*
 * Every mode the layout switcher can select, in toolbar order. Force,
 * tiered and radial shipped first; star and parent-child were added
 * beside them without a version bump, so the list doubles as the record
 * of which keys must already exist in the wild.
 */
const ALL_LAYOUT_MODES: Array<TopologyLayoutMode> = [
  "force",
  "tiered",
  "radial",
  "star",
  "parentChild",
];

const LEGACY_LAYOUT_MODES: Array<TopologyLayoutMode> = [
  "force",
  "tiered",
  "radial",
];

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

describe("module constants", () => {
  test("the empty arrangement is genuinely empty and shared", () => {
    expect(EMPTY_OVERRIDES.size).toBe(0);
    expect(EMPTY_OVERRIDES instanceof Map).toBe(true);
    expect(Array.from(EMPTY_OVERRIDES.keys())).toEqual([]);
  });

  test("limits are positive and the world bound is re-exported", () => {
    expect(PERSISTED_OVERRIDES_VERSION).toBe(1);
    expect(MAX_PERSISTED_OVERRIDES).toBe(5000);
    expect(MAX_PERSISTED_KEY_LENGTH).toBe(256);
    expect(MAX_WORLD_COORDINATE).toBe(100000);
  });
});

/* ------------------------------------------------------------------ */
/* positionOverridesStorageKey                                         */
/* ------------------------------------------------------------------ */

describe("positionOverridesStorageKey", () => {
  test("the key carries project, site, layout mode and version", () => {
    const key: string = positionOverridesStorageKey(
      "proj-1",
      "site-9",
      "tiered",
    );
    expect(key).toContain("proj-1");
    expect(key).toContain("site-9");
    expect(key).toContain("tiered");
    expect(key).toContain(`v${String(PERSISTED_OVERRIDES_VERSION)}`);
    expect(key).toBe(
      "oneuptime.networkTopology.positions.v1.proj-1.site-9.tiered",
    );
  });

  test("an absent site falls back to the literal 'project' segment", () => {
    expect(positionOverridesStorageKey("proj-1", undefined, "force")).toBe(
      "oneuptime.networkTopology.positions.v1.proj-1.project.force",
    );
    // An empty string is the same "whole project" case.
    expect(positionOverridesStorageKey("proj-1", "", "force")).toBe(
      "oneuptime.networkTopology.positions.v1.proj-1.project.force",
    );
  });

  test("an absent project falls back to the literal 'unknown' segment", () => {
    expect(positionOverridesStorageKey("", "site-9", "radial")).toBe(
      "oneuptime.networkTopology.positions.v1.unknown.site-9.radial",
    );
  });

  test("every project/site/mode combination gets its own key", () => {
    /*
     * Force, tiered and radial are different coordinate systems, and a
     * position saved under one would fling the node off-screen under
     * another — so the mode has to be part of the namespace, not just the
     * project and site.
     */
    const projects: Array<string> = ["proj-1", "proj-2"];
    const sites: Array<string | undefined> = [undefined, "site-a", "site-b"];
    const modes: Array<TopologyLayoutMode> = ["force", "tiered", "radial"];
    const keys: Set<string> = new Set<string>();
    for (const projectId of projects) {
      for (const siteId of sites) {
        for (const layoutMode of modes) {
          keys.add(positionOverridesStorageKey(projectId, siteId, layoutMode));
        }
      }
    }
    expect(keys.size).toBe(projects.length * sites.length * modes.length);
  });

  test("the key is pure — repeated calls agree", () => {
    expect(positionOverridesStorageKey("p", "s", "force")).toBe(
      positionOverridesStorageKey("p", "s", "force"),
    );
  });

  test("all five layout modes name their own key for one project and site", () => {
    /*
     * Star and parent-child are coordinate systems of their own — a hub
     * placed at the origin in star mode means nothing in the tiered grid —
     * so the two newer modes have to namespace their arrangements exactly
     * the way the original three already do.
     */
    const keys: Set<string> = new Set<string>();
    for (const layoutMode of ALL_LAYOUT_MODES) {
      keys.add(positionOverridesStorageKey("proj-1", "site-9", layoutMode));
    }
    expect(keys.size).toBe(ALL_LAYOUT_MODES.length);
    expect(Array.from(keys)).toEqual([
      "oneuptime.networkTopology.positions.v1.proj-1.site-9.force",
      "oneuptime.networkTopology.positions.v1.proj-1.site-9.tiered",
      "oneuptime.networkTopology.positions.v1.proj-1.site-9.radial",
      "oneuptime.networkTopology.positions.v1.proj-1.site-9.star",
      "oneuptime.networkTopology.positions.v1.proj-1.site-9.parentChild",
    ]);
  });

  test("star and parent-child differ from each other and from the older three", () => {
    const starKey: string = positionOverridesStorageKey(
      "proj-1",
      "site-9",
      "star",
    );
    const parentChildKey: string = positionOverridesStorageKey(
      "proj-1",
      "site-9",
      "parentChild",
    );
    expect(starKey).not.toBe(parentChildKey);
    for (const layoutMode of LEGACY_LAYOUT_MODES) {
      const legacyKey: string = positionOverridesStorageKey(
        "proj-1",
        "site-9",
        layoutMode,
      );
      expect(starKey).not.toBe(legacyKey);
      expect(parentChildKey).not.toBe(legacyKey);
    }
    expect(starKey).toContain("star");
    expect(parentChildKey).toContain("parentChild");
    // The mode is the only segment that moved: everything else is shared.
    expect(starKey).toContain("proj-1");
    expect(starKey).toContain("site-9");
    expect(parentChildKey).toContain(`v${String(PERSISTED_OVERRIDES_VERSION)}`);
  });

  test("the key stays pure for the two new modes as well", () => {
    for (const layoutMode of ALL_LAYOUT_MODES) {
      expect(positionOverridesStorageKey("proj-1", "site-9", layoutMode)).toBe(
        positionOverridesStorageKey("proj-1", "site-9", layoutMode),
      );
      expect(positionOverridesStorageKey("proj-1", undefined, layoutMode)).toBe(
        positionOverridesStorageKey("proj-1", undefined, layoutMode),
      );
    }
  });

  test("the site-less and project-less fallbacks apply to the new modes too", () => {
    expect(positionOverridesStorageKey("proj-1", undefined, "star")).toBe(
      "oneuptime.networkTopology.positions.v1.proj-1.project.star",
    );
    expect(positionOverridesStorageKey("", "site-9", "parentChild")).toBe(
      "oneuptime.networkTopology.positions.v1.unknown.site-9.parentChild",
    );
  });
});

/* ------------------------------------------------------------------ */
/* mergePositionOverrides                                              */
/* ------------------------------------------------------------------ */

describe("mergePositionOverrides — identity invariants", () => {
  const base: Map<string, TopologyPoint> = makeMap([
    ["core", { x: 10, y: 20 }],
    ["switch-a", { x: 30, y: 40 }],
  ]);
  const overrides: PositionOverrides = makeMap([
    ["switch-a", { x: 99, y: 98 }],
  ]);

  test("the result is a new map, not either argument", () => {
    const merged: Map<string, TopologyPoint> = mergePositionOverrides(
      base,
      overrides,
    );
    expect(merged).not.toBe(base);
    expect(merged).not.toBe(overrides);
    expect(merged instanceof Map).toBe(true);
  });

  test("neither argument is mutated", () => {
    mergePositionOverrides(base, overrides);
    expect(base.size).toBe(2);
    expect(base.get("switch-a")).toEqual({ x: 30, y: 40 });
    expect(overrides.size).toBe(1);
    expect(overrides.get("switch-a")).toEqual({ x: 99, y: 98 });
    expect(overrides.has("core")).toBe(false);
  });

  test("an override for an id absent from base is ignored, never added", () => {
    /*
     * A phantom entry would be invisible in the render loop yet would
     * still widen the graph bounds, so fit-to-view would frame a large
     * empty region around a device that no longer exists.
     */
    const ghosted: PositionOverrides = makeMap([
      ["switch-a", { x: 99, y: 98 }],
      ["decommissioned-switch", { x: 50000, y: 50000 }],
    ]);
    const merged: Map<string, TopologyPoint> = mergePositionOverrides(
      base,
      ghosted,
    );
    expect(merged.size).toBe(base.size);
    expect(merged.has("decommissioned-switch")).toBe(false);
    expect(Array.from(merged.keys()).sort()).toEqual(
      Array.from(base.keys()).sort(),
    );
  });

  test("the key set is exactly base's even when every override is foreign", () => {
    const allForeign: PositionOverrides = makeMap([
      ["ghost-1", { x: 1, y: 1 }],
      ["ghost-2", { x: 2, y: 2 }],
    ]);
    const merged: Map<string, TopologyPoint> = mergePositionOverrides(
      base,
      allForeign,
    );
    expect(merged.size).toBe(2);
    expect(merged.get("core")).toBe(base.get("core"));
    expect(merged.get("switch-a")).toBe(base.get("switch-a"));
  });

  test("an overridden node takes the user's coordinates, copied not aliased", () => {
    const point: TopologyPoint = { x: 99, y: 98 };
    const merged: Map<string, TopologyPoint> = mergePositionOverrides(
      base,
      makeMap([["switch-a", point]]),
    );
    expect(merged.get("switch-a")).toEqual({ x: 99, y: 98 });
    // A copy, so a later drag mutating the override cannot alias the layout.
    expect(merged.get("switch-a")).not.toBe(point);
  });

  test("a non-finite override coordinate falls through to the base point", () => {
    const cases: Array<TopologyPoint> = [
      { x: Number.NaN, y: 5 },
      { x: 5, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 5 },
      { x: 5, y: Number.NEGATIVE_INFINITY },
      { x: Number.NaN, y: Number.NaN },
    ];
    for (const bad of cases) {
      const merged: Map<string, TopologyPoint> = mergePositionOverrides(
        base,
        makeMap([["switch-a", bad]]),
      );
      // Identity, not just equality: the base point passes straight through.
      expect(merged.get("switch-a")).toBe(base.get("switch-a"));
      expect(merged.size).toBe(2);
    }
  });

  test("an empty override map reproduces the base layout exactly", () => {
    const merged: Map<string, TopologyPoint> = mergePositionOverrides(
      base,
      EMPTY_OVERRIDES,
    );
    expect(merged).not.toBe(base);
    expect(merged.size).toBe(base.size);
    for (const [nodeId, point] of base) {
      expect(merged.get(nodeId)).toBe(point);
    }
  });

  test("an empty base yields an empty result no matter the overrides", () => {
    const merged: Map<string, TopologyPoint> = mergePositionOverrides(
      new Map<string, TopologyPoint>(),
      makeMap([["anything", { x: 1, y: 2 }]]),
    );
    expect(merged.size).toBe(0);
  });

  test("merging is idempotent — merging the result again changes nothing", () => {
    const once: Map<string, TopologyPoint> = mergePositionOverrides(
      base,
      overrides,
    );
    const twice: Map<string, TopologyPoint> = mergePositionOverrides(
      once,
      overrides,
    );
    expect(Array.from(twice.entries())).toEqual(Array.from(once.entries()));
  });
});

/* ------------------------------------------------------------------ */
/* prunePositionOverrides                                              */
/* ------------------------------------------------------------------ */

describe("prunePositionOverrides — identity invariants", () => {
  const overrides: PositionOverrides = makeMap([
    ["core", { x: 1, y: 2 }],
    ["switch-a", { x: 3, y: 4 }],
  ]);

  test("nothing dropped returns the SAME instance", () => {
    /*
     * Load-bearing: the topology poll runs every sixty seconds, and
     * allocating a fresh map each time would invalidate every downstream
     * memo and re-render the whole graph forever.
     */
    const live: Set<string> = new Set<string>(["core", "switch-a"]);
    expect(prunePositionOverrides(overrides, live)).toBe(overrides);
  });

  test("a live set that is a strict superset still returns the same instance", () => {
    const live: Set<string> = new Set<string>([
      "core",
      "switch-a",
      "endpoint:new",
    ]);
    expect(prunePositionOverrides(overrides, live)).toBe(overrides);
  });

  test("an empty override map returns the same instance", () => {
    const empty: PositionOverrides = new Map<string, TopologyPoint>();
    expect(prunePositionOverrides(empty, new Set<string>())).toBe(empty);
    expect(prunePositionOverrides(EMPTY_OVERRIDES, new Set<string>())).toBe(
      EMPTY_OVERRIDES,
    );
  });

  test("dropping a stale id returns a NEW instance with only live nodes", () => {
    const live: Set<string> = new Set<string>(["core"]);
    const pruned: PositionOverrides = prunePositionOverrides(overrides, live);
    expect(pruned).not.toBe(overrides);
    expect(pruned.size).toBe(1);
    expect(pruned.has("core")).toBe(true);
    expect(pruned.has("switch-a")).toBe(false);
    // The surviving point is carried over untouched, not rebuilt.
    expect(pruned.get("core")).toBe(overrides.get("core"));
  });

  test("pruning does not mutate the input map", () => {
    prunePositionOverrides(overrides, new Set<string>(["core"]));
    expect(overrides.size).toBe(2);
    expect(overrides.has("switch-a")).toBe(true);
  });

  test("an empty live set drops everything into a new empty map", () => {
    const pruned: PositionOverrides = prunePositionOverrides(
      overrides,
      new Set<string>(),
    );
    expect(pruned).not.toBe(overrides);
    expect(pruned.size).toBe(0);
  });

  test("pruning is stable — a second prune returns the first result itself", () => {
    const live: Set<string> = new Set<string>(["core"]);
    const first: PositionOverrides = prunePositionOverrides(overrides, live);
    expect(prunePositionOverrides(first, live)).toBe(first);
  });

  test("a live set unrelated to the overrides drops all of them", () => {
    const pruned: PositionOverrides = prunePositionOverrides(
      overrides,
      new Set<string>(["endpoint:a", "endpoint:b"]),
    );
    expect(pruned.size).toBe(0);
    expect(pruned).not.toBe(overrides);
  });
});

/* ------------------------------------------------------------------ */
/* withPositionOverride / withPositionOverrides                        */
/* ------------------------------------------------------------------ */

describe("withPositionOverride", () => {
  const overrides: PositionOverrides = makeMap([["core", { x: 1, y: 2 }]]);

  test("a drag always produces a new map and leaves the old one alone", () => {
    const next: PositionOverrides = withPositionOverride(
      overrides,
      "switch-a",
      { x: 5, y: 6 },
    );
    expect(next).not.toBe(overrides);
    expect(next.size).toBe(2);
    expect(next.get("switch-a")).toEqual({ x: 5, y: 6 });
    expect(overrides.size).toBe(1);
    expect(overrides.has("switch-a")).toBe(false);
  });

  test("dropping a node back where it already was still yields a new map", () => {
    const next: PositionOverrides = withPositionOverride(overrides, "core", {
      x: 1,
      y: 2,
    });
    expect(next).not.toBe(overrides);
    expect(next.get("core")).toEqual({ x: 1, y: 2 });
  });

  test("re-dragging a node replaces rather than duplicates its entry", () => {
    const next: PositionOverrides = withPositionOverride(overrides, "core", {
      x: 7,
      y: 8,
    });
    expect(next.size).toBe(1);
    expect(next.get("core")).toEqual({ x: 7, y: 8 });
  });

  test("coordinates are clamped to the world bound", () => {
    const next: PositionOverrides = withPositionOverride(
      EMPTY_OVERRIDES,
      "runaway",
      { x: 1e9, y: -1e9 },
    );
    expect(next.get("runaway")!.x).toBe(MAX_WORLD_COORDINATE);
    expect(next.get("runaway")!.y).toBe(-MAX_WORLD_COORDINATE);
    // Exactly on the bound is left alone.
    const onBound: PositionOverrides = withPositionOverride(
      EMPTY_OVERRIDES,
      "edge",
      { x: MAX_WORLD_COORDINATE, y: -MAX_WORLD_COORDINATE },
    );
    expect(onBound.get("edge")).toEqual({
      x: MAX_WORLD_COORDINATE,
      y: -MAX_WORLD_COORDINATE,
    });
  });

  test("the shared empty arrangement is never mutated by a drag", () => {
    withPositionOverride(EMPTY_OVERRIDES, "core", { x: 1, y: 1 });
    expect(EMPTY_OVERRIDES.size).toBe(0);
  });

  test("a non-finite drop is skipped but still returns a new map", () => {
    const bad: Array<TopologyPoint> = [
      { x: Number.NaN, y: 0 },
      { x: 0, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 0 },
      { x: 0, y: Number.NEGATIVE_INFINITY },
    ];
    for (const point of bad) {
      const next: PositionOverrides = withPositionOverride(
        overrides,
        "switch-a",
        point,
      );
      expect(next).not.toBe(overrides);
      expect(next.has("switch-a")).toBe(false);
      expect(next.size).toBe(1);
    }
  });

  test("an empty node id is skipped", () => {
    const next: PositionOverrides = withPositionOverride(overrides, "", {
      x: 1,
      y: 1,
    });
    expect(next.size).toBe(1);
    expect(next.has("")).toBe(false);
  });
});

describe("withPositionOverrides — multi-node gestures", () => {
  const overrides: PositionOverrides = makeMap([["core", { x: 1, y: 2 }]]);

  test("every node in a marquee drag is recorded", () => {
    const next: PositionOverrides = withPositionOverrides(overrides, [
      { nodeId: "a", point: { x: 10, y: 11 } },
      { nodeId: "b", point: { x: 12, y: 13 } },
      { nodeId: "c", point: { x: 14, y: 15 } },
    ]);
    expect(next.size).toBe(4);
    expect(next.get("a")).toEqual({ x: 10, y: 11 });
    expect(next.get("b")).toEqual({ x: 12, y: 13 });
    expect(next.get("c")).toEqual({ x: 14, y: 15 });
    expect(next.get("core")).toEqual({ x: 1, y: 2 });
  });

  test("an empty gesture still returns a new map with the same content", () => {
    const next: PositionOverrides = withPositionOverrides(overrides, []);
    expect(next).not.toBe(overrides);
    expect(Array.from(next.entries())).toEqual(Array.from(overrides.entries()));
  });

  test("malformed entries are skipped while the good ones still apply", () => {
    const moved: ReadonlyArray<MovedNode> = [
      { nodeId: "good-1", point: { x: 1, y: 2 } },
      null as unknown as MovedNode,
      undefined as unknown as MovedNode,
      { nodeId: "", point: { x: 3, y: 4 } },
      { nodeId: 42 as unknown as string, point: { x: 3, y: 4 } },
      { nodeId: "no-point", point: null as unknown as TopologyPoint },
      { nodeId: "nan", point: { x: Number.NaN, y: 0 } },
      { nodeId: "inf", point: { x: 0, y: Number.POSITIVE_INFINITY } },
      { nodeId: "good-2", point: { x: 5, y: 6 } },
    ];
    const next: PositionOverrides = withPositionOverrides(overrides, moved);
    expect(next.size).toBe(3);
    expect(next.get("good-1")).toEqual({ x: 1, y: 2 });
    expect(next.get("good-2")).toEqual({ x: 5, y: 6 });
    expect(next.has("no-point")).toBe(false);
    expect(next.has("nan")).toBe(false);
    expect(next.has("inf")).toBe(false);
    expect(next.has("")).toBe(false);
  });

  test("the last entry for an id wins", () => {
    const next: PositionOverrides = withPositionOverrides(overrides, [
      { nodeId: "a", point: { x: 1, y: 1 } },
      { nodeId: "a", point: { x: 2, y: 2 } },
    ]);
    expect(next.size).toBe(2);
    expect(next.get("a")).toEqual({ x: 2, y: 2 });
  });

  test("every coordinate in a gesture is clamped", () => {
    const next: PositionOverrides = withPositionOverrides(EMPTY_OVERRIDES, [
      { nodeId: "a", point: { x: 1e12, y: 0 } },
      { nodeId: "b", point: { x: 0, y: -1e12 } },
    ]);
    expect(next.get("a")!.x).toBe(MAX_WORLD_COORDINATE);
    expect(next.get("b")!.y).toBe(-MAX_WORLD_COORDINATE);
    expect(EMPTY_OVERRIDES.size).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* withoutPositionOverride                                             */
/* ------------------------------------------------------------------ */

describe("withoutPositionOverride", () => {
  const overrides: PositionOverrides = makeMap([
    ["core", { x: 1, y: 2 }],
    ["switch-a", { x: 3, y: 4 }],
  ]);

  test("forgetting an absent id returns the SAME instance", () => {
    expect(withoutPositionOverride(overrides, "never-dragged")).toBe(overrides);
    expect(withoutPositionOverride(overrides, "")).toBe(overrides);
    expect(withoutPositionOverride(EMPTY_OVERRIDES, "anything")).toBe(
      EMPTY_OVERRIDES,
    );
  });

  test("forgetting a present id returns a new map without it", () => {
    const next: PositionOverrides = withoutPositionOverride(
      overrides,
      "switch-a",
    );
    expect(next).not.toBe(overrides);
    expect(next.size).toBe(1);
    expect(next.has("switch-a")).toBe(false);
    expect(next.get("core")).toBe(overrides.get("core"));
    // The input keeps both entries.
    expect(overrides.size).toBe(2);
  });

  test("forgetting the last entry leaves an empty new map", () => {
    const single: PositionOverrides = makeMap([["core", { x: 1, y: 2 }]]);
    const next: PositionOverrides = withoutPositionOverride(single, "core");
    expect(next).not.toBe(single);
    expect(next.size).toBe(0);
  });

  test("a second forget of the same id is a no-op returning the same map", () => {
    const once: PositionOverrides = withoutPositionOverride(
      overrides,
      "switch-a",
    );
    expect(withoutPositionOverride(once, "switch-a")).toBe(once);
  });
});

/* ------------------------------------------------------------------ */
/* serializePersistedOverrides                                         */
/* ------------------------------------------------------------------ */

describe("serializePersistedOverrides", () => {
  test("output is byte-identical for the same logical arrangement", () => {
    const forward: PositionOverrides = makeMap([
      ["alpha", { x: 1, y: 2 }],
      ["beta", { x: 3, y: 4 }],
      ["gamma", { x: 5, y: 6 }],
    ]);
    const reverse: PositionOverrides = makeMap([
      ["gamma", { x: 5, y: 6 }],
      ["beta", { x: 3, y: 4 }],
      ["alpha", { x: 1, y: 2 }],
    ]);
    expect(serializePersistedOverrides(forward)).toBe(
      '{"version":1,"positions":{"alpha":[1,2],"beta":[3,4],"gamma":[5,6]}}',
    );
    expect(serializePersistedOverrides(reverse)).toBe(
      serializePersistedOverrides(forward),
    );
  });

  test("numeric-looking node ids are still order independent", () => {
    const forward: PositionOverrides = makeMap([
      ["10", { x: 1, y: 1 }],
      ["2", { x: 2, y: 2 }],
    ]);
    const reverse: PositionOverrides = makeMap([
      ["2", { x: 2, y: 2 }],
      ["10", { x: 1, y: 1 }],
    ]);
    expect(serializePersistedOverrides(reverse)).toBe(
      serializePersistedOverrides(forward),
    );
  });

  test("coordinates are rounded to two decimals", () => {
    const overrides: PositionOverrides = makeMap([
      ["a", { x: 10.567, y: -3.14159 }],
      ["b", { x: 1 / 3, y: 2 / 3 }],
    ]);
    expect(serializePersistedOverrides(overrides)).toBe(
      '{"version":1,"positions":{"a":[10.57,-3.14],"b":[0.33,0.67]}}',
    );
  });

  test("an empty arrangement serializes to an empty positions object", () => {
    expect(serializePersistedOverrides(EMPTY_OVERRIDES)).toBe(
      '{"version":1,"positions":{}}',
    );
  });

  test("non-finite points are dropped rather than written as null", () => {
    /*
     * JSON.stringify turns NaN and Infinity into `null`, which would parse
     * back as a non-number and silently lose the entry anyway — dropping
     * it here keeps the payload honest.
     */
    const overrides: PositionOverrides = makeMap([
      ["good", { x: 1, y: 2 }],
      ["nan", { x: Number.NaN, y: 0 }],
      ["inf", { x: 0, y: Number.POSITIVE_INFINITY }],
    ]);
    const text: string = serializePersistedOverrides(overrides);
    expect(text).toBe('{"version":1,"positions":{"good":[1,2]}}');
    expect(text).not.toContain("null");
  });

  test("the payload always carries the current version", () => {
    const parsed: Record<string, unknown> = JSON.parse(
      serializePersistedOverrides(makeMap([["a", { x: 0, y: 0 }]])),
    ) as Record<string, unknown>;
    expect(parsed["version"]).toBe(PERSISTED_OVERRIDES_VERSION);
  });

  test("serializing does not mutate the arrangement", () => {
    const overrides: PositionOverrides = makeMap([
      ["a", { x: 10.567, y: -3.14159 }],
    ]);
    serializePersistedOverrides(overrides);
    expect(overrides.get("a")).toEqual({ x: 10.567, y: -3.14159 });
  });
});

describe("serialize / parse round trip", () => {
  const overrides: Map<string, TopologyPoint> = new Map<
    string,
    TopologyPoint
  >();
  for (let i: number = 0; i < 40; i++) {
    overrides.set(`endpoint:${String(i).padStart(3, "0")}`, {
      x: (seededUnit(i * 2654435761 + 1) - 0.5) * 2000,
      y: (seededUnit(i * 40503 + 7919) - 0.5) * 2000,
    });
  }

  test("every coordinate survives a round trip to two decimals", () => {
    const restored: PositionOverrides = parsePersistedOverrides(
      serializePersistedOverrides(overrides),
    );
    expect(restored.size).toBe(overrides.size);
    for (const [nodeId, point] of overrides) {
      const back: TopologyPoint = restored.get(nodeId)!;
      expect(back.x).toBeCloseTo(Math.round(point.x * 100) / 100, 6);
      expect(back.y).toBeCloseTo(Math.round(point.y * 100) / 100, 6);
    }
  });

  test("serialize is a fixed point after one round trip", () => {
    const once: string = serializePersistedOverrides(overrides);
    const twice: string = serializePersistedOverrides(
      parsePersistedOverrides(once),
    );
    expect(twice).toBe(once);
  });
});

/* ------------------------------------------------------------------ */
/* parsePersistedOverrides — hostile input                             */
/* ------------------------------------------------------------------ */

interface HostileCase {
  label: string;
  raw: string | null | undefined;
}

describe("parsePersistedOverrides — never throws on untrusted text", () => {
  /*
   * localStorage is user-writable and survives app upgrades, so this
   * input is genuinely untrusted: a single NaN reaching an SVG attribute
   * makes that element disappear, and a NaN reaching the bounds
   * calculation blanks the whole graph.
   */
  const cases: Array<HostileCase> = [
    { label: "null", raw: null },
    { label: "undefined", raw: undefined },
    { label: "empty string", raw: "" },
    { label: "whitespace", raw: "   " },
    { label: "newlines and tabs", raw: "\n\t \r" },
    { label: "a lone open brace", raw: "{" },
    { label: "a lone close brace", raw: "}" },
    { label: "truncated payload", raw: '{"version":1,"positions":{"a":[1,' },
    { label: "an empty array", raw: "[]" },
    { label: "an array of entries", raw: '[["a",[1,2]]]' },
    { label: "the literal null", raw: "null" },
    { label: "a bare number", raw: "7" },
    { label: "a JSON string literal", raw: '"hello"' },
    { label: "a JSON boolean", raw: "true" },
    { label: "a future version", raw: '{"version":2,"positions":{"a":[1,2]}}' },
    { label: "a past version", raw: '{"version":0,"positions":{"a":[1,2]}}' },
    {
      label: "a version as a string",
      raw: '{"version":"1","positions":{"a":[1,2]}}',
    },
    { label: "no version at all", raw: '{"positions":{"a":[1,2]}}' },
    { label: "positions missing", raw: '{"version":1}' },
    { label: "positions null", raw: '{"version":1,"positions":null}' },
    {
      label: "positions as an array",
      raw: '{"version":1,"positions":[[1,2]]}',
    },
    { label: "positions as a string", raw: '{"version":1,"positions":"a"}' },
    { label: "positions as a number", raw: '{"version":1,"positions":5}' },
    { label: "positions as a boolean", raw: '{"version":1,"positions":true}' },
    /*
     * NaN and Infinity are not JSON tokens, so a payload containing them
     * fails at JSON.parse and the whole arrangement is discarded. The
     * entry-level non-finite path is exercised separately via 1e999,
     * which is how an Infinity actually reaches this parser.
     */
    {
      label: "a raw NaN token",
      raw: '{"version":1,"positions":{"a":[NaN,0]}}',
    },
    {
      label: "a raw Infinity token",
      raw: '{"version":1,"positions":{"a":[Infinity,0]}}',
    },
    { label: "an empty object", raw: "{}" },
  ];

  test("every malformed payload yields an empty Map without throwing", () => {
    for (const hostile of cases) {
      let result: PositionOverrides = EMPTY_OVERRIDES;
      expect((): void => {
        result = parsePersistedOverrides(hostile.raw);
      }).not.toThrow();
      expect(result instanceof Map).toBe(true);
      expect(result.size).toBe(0);
    }
  });

  test("a fresh empty Map is returned each time, never a shared singleton", () => {
    const first: PositionOverrides = parsePersistedOverrides("");
    const second: PositionOverrides = parsePersistedOverrides("");
    expect(first).not.toBe(second);
  });
});

describe("parsePersistedOverrides — partial validity", () => {
  test("malformed entries are dropped and the good ones survive", () => {
    const raw: string = payloadFor({
      "good-1": [1, 2],
      "string-coords": ["1", "2"],
      "too-short": [1],
      "too-long": [1, 2, 3],
      "good-2": [3, 4],
      "null-value": null,
      "object-value": { x: 1, y: 2 },
      "empty-array": [],
      "bool-value": true,
      "string-value": "1,2",
      "nested-arrays": [[1], [2]],
      "good-3": [5, 6],
    });
    const result: PositionOverrides = parsePersistedOverrides(raw);
    expect(result.size).toBe(3);
    expect(result.get("good-1")).toEqual({ x: 1, y: 2 });
    expect(result.get("good-2")).toEqual({ x: 3, y: 4 });
    expect(result.get("good-3")).toEqual({ x: 5, y: 6 });
    expect(result.has("string-coords")).toBe(false);
    expect(result.has("too-short")).toBe(false);
    expect(result.has("too-long")).toBe(false);
    expect(result.has("null-value")).toBe(false);
    expect(result.has("object-value")).toBe(false);
  });

  test("three good entries beside two malformed ones yields exactly three", () => {
    const raw: string = payloadFor({
      a: [1, 1],
      bad1: [1],
      b: [2, 2],
      bad2: null,
      c: [3, 3],
    });
    const result: PositionOverrides = parsePersistedOverrides(raw);
    expect(result.size).toBe(3);
    expect(Array.from(result.keys()).sort()).toEqual(["a", "b", "c"]);
  });

  test("a non-finite coordinate drops only its own entry", () => {
    /* 1e999 overflows to Infinity on JSON.parse — the real-world route. */
    const raw: string = rawPayload(
      '{"pos-inf":[1e999,0],"neg-inf":[0,-1e999],"good":[3,4]}',
    );
    const result: PositionOverrides = parsePersistedOverrides(raw);
    expect(result.size).toBe(1);
    expect(result.get("good")).toEqual({ x: 3, y: 4 });
    expect(result.has("pos-inf")).toBe(false);
    expect(result.has("neg-inf")).toBe(false);
  });

  test("an empty key and an over-long key are both dropped", () => {
    const longKey: string = "k".repeat(300);
    const positions: Record<string, unknown> = { good: [1, 2] };
    positions[""] = [3, 4];
    positions[longKey] = [5, 6];
    const result: PositionOverrides = parsePersistedOverrides(
      payloadFor(positions),
    );
    expect(result.size).toBe(1);
    expect(result.has("")).toBe(false);
    expect(result.has(longKey)).toBe(false);
    expect(result.get("good")).toEqual({ x: 1, y: 2 });
  });

  test("the key length limit is inclusive at the boundary", () => {
    const atLimit: string = "k".repeat(MAX_PERSISTED_KEY_LENGTH);
    const overLimit: string = "k".repeat(MAX_PERSISTED_KEY_LENGTH + 1);
    const positions: Record<string, unknown> = {};
    positions[atLimit] = [1, 2];
    positions[overLimit] = [3, 4];
    const result: PositionOverrides = parsePersistedOverrides(
      payloadFor(positions),
    );
    expect(result.size).toBe(1);
    expect(result.has(atLimit)).toBe(true);
    expect(result.has(overLimit)).toBe(false);
  });

  test("an empty positions object yields an empty Map", () => {
    expect(parsePersistedOverrides(payloadFor({})).size).toBe(0);
  });

  test("integer coordinates and negative zero come back intact", () => {
    const result: PositionOverrides = parsePersistedOverrides(
      rawPayload('{"a":[0,-0],"b":[-12,-34]}'),
    );
    expect(result.get("a")!.x).toBe(0);
    expect(result.get("b")).toEqual({ x: -12, y: -34 });
  });
});

describe("parsePersistedOverrides — prototype pollution", () => {
  test("a __proto__ key is stored inertly and pollutes nothing", () => {
    /*
     * Results are built into a Map rather than an object literal, which is
     * exactly what makes `__proto__` and `constructor` inert here. This
     * test is the regression record for that choice.
     */
    const raw: string =
      '{"version":1,"positions":{"__proto__":[1,2],"constructor":[3,4],"prototype":[5,6],"good":[7,8]}}';
    const result: PositionOverrides = parsePersistedOverrides(raw);

    expect(result.size).toBe(4);
    expect(result.get("__proto__")).toEqual({ x: 1, y: 2 });
    expect(result.get("constructor")).toEqual({ x: 3, y: 4 });
    expect(result.get("good")).toEqual({ x: 7, y: 8 });

    const probe: Record<string, unknown> = {};
    expect(probe["x"]).toBeUndefined();
    expect(probe["y"]).toBeUndefined();
    expect(Object.getPrototypeOf(probe)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "x")).toBe(
      false,
    );
  });

  test("a top-level __proto__ payload leaves Object.prototype untouched", () => {
    const raw: string =
      '{"version":1,"__proto__":{"polluted":true},"positions":{"good":[1,2]}}';
    const result: PositionOverrides = parsePersistedOverrides(raw);
    expect(result.size).toBe(1);

    const probe: Record<string, unknown> = {};
    expect(probe["polluted"]).toBeUndefined();
    expect(
      Object.prototype.hasOwnProperty.call(Object.prototype, "polluted"),
    ).toBe(false);
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });
});

describe("parsePersistedOverrides — bounds", () => {
  test("coordinates beyond the world bound are clamped, not rejected", () => {
    const result: PositionOverrides = parsePersistedOverrides(
      rawPayload('{"far":[1e9,-1e9],"near":[10,20]}'),
    );
    expect(result.get("far")).toEqual({
      x: MAX_WORLD_COORDINATE,
      y: -MAX_WORLD_COORDINATE,
    });
    expect(result.get("near")).toEqual({ x: 10, y: 20 });
    for (const point of result.values()) {
      expect(Math.abs(point.x)).toBeLessThanOrEqual(MAX_WORLD_COORDINATE);
      expect(Math.abs(point.y)).toBeLessThanOrEqual(MAX_WORLD_COORDINATE);
    }
  });

  test("a payload of 6000 entries yields exactly the persisted cap", () => {
    /*
     * A corrupt or hostile payload must not be able to make the app
     * allocate without limit.
     */
    const positions: Record<string, unknown> = {};
    for (let i: number = 0; i < 6000; i++) {
      // Non-numeric key prefix keeps object key order = insertion order.
      positions[`n-${String(i).padStart(4, "0")}`] = [i, i];
    }
    const result: PositionOverrides = parsePersistedOverrides(
      payloadFor(positions),
    );
    expect(result.size).toBe(MAX_PERSISTED_OVERRIDES);
    expect(result.has("n-0000")).toBe(true);
    expect(
      result.has(`n-${String(MAX_PERSISTED_OVERRIDES - 1).padStart(4, "0")}`),
    ).toBe(true);
    expect(
      result.has(`n-${String(MAX_PERSISTED_OVERRIDES).padStart(4, "0")}`),
    ).toBe(false);
    expect(result.has("n-5999")).toBe(false);
  });

  test("exactly the cap many entries are all kept", () => {
    const positions: Record<string, unknown> = {};
    for (let i: number = 0; i < MAX_PERSISTED_OVERRIDES; i++) {
      positions[`n-${String(i).padStart(4, "0")}`] = [i, i];
    }
    expect(parsePersistedOverrides(payloadFor(positions)).size).toBe(
      MAX_PERSISTED_OVERRIDES,
    );
  });
});

/* ------------------------------------------------------------------ */
/* readPersistedOverrides / writePersistedOverrides                    */
/* ------------------------------------------------------------------ */

describe("readPersistedOverrides", () => {
  test("a stored arrangement is loaded from the requested key", () => {
    const storage: FakeStorage = makeFakeStorage();
    storage.data.set(STORAGE_KEY, payloadFor({ core: [10, 20] }));
    const result: PositionOverrides = readPersistedOverrides(
      storage,
      STORAGE_KEY,
    );
    expect(result.size).toBe(1);
    expect(result.get("core")).toEqual({ x: 10, y: 20 });
    expect(storage.getCalls).toEqual([STORAGE_KEY]);
  });

  test("a missing key reads as an empty arrangement", () => {
    const storage: FakeStorage = makeFakeStorage();
    expect(readPersistedOverrides(storage, STORAGE_KEY).size).toBe(0);
  });

  test("absent storage yields the shared empty arrangement", () => {
    expect(readPersistedOverrides(null, STORAGE_KEY)).toBe(EMPTY_OVERRIDES);
    expect(readPersistedOverrides(undefined, STORAGE_KEY).size).toBe(0);
  });

  test("storage that throws on read never propagates the error", () => {
    /* Safari in private mode throws on access, not just on write. */
    const storage: TopologyOverrideStorage = makeThrowingStorage();
    let result: PositionOverrides = makeMap([["stale", { x: 1, y: 1 }]]);
    expect((): void => {
      result = readPersistedOverrides(storage, STORAGE_KEY);
    }).not.toThrow();
    expect(result).toBe(EMPTY_OVERRIDES);
    expect(result.size).toBe(0);
  });

  test("corrupt stored text degrades to an empty arrangement, not a crash", () => {
    const storage: FakeStorage = makeFakeStorage();
    storage.data.set(STORAGE_KEY, "{not json at all");
    expect((): void => {
      readPersistedOverrides(storage, STORAGE_KEY);
    }).not.toThrow();
    expect(readPersistedOverrides(storage, STORAGE_KEY).size).toBe(0);
  });
});

describe("writePersistedOverrides", () => {
  test("an arrangement is written as its canonical serialization", () => {
    const storage: FakeStorage = makeFakeStorage();
    const overrides: PositionOverrides = makeMap([
      ["core", { x: 1, y: 2 }],
      ["switch-a", { x: 3, y: 4 }],
    ]);
    writePersistedOverrides(storage, STORAGE_KEY, overrides);
    expect(storage.setCalls.length).toBe(1);
    expect(storage.setCalls[0]!.key).toBe(STORAGE_KEY);
    expect(storage.setCalls[0]!.value).toBe(
      serializePersistedOverrides(overrides),
    );
    expect(storage.removeCalls.length).toBe(0);
  });

  test("an empty arrangement removes the entry instead of writing one", () => {
    /*
     * Writing `{"version":1,"positions":{}}` would leave a stale key
     * behind forever; clearing the arrangement should clear the storage.
     */
    const storage: FakeStorage = makeFakeStorage();
    storage.data.set(STORAGE_KEY, payloadFor({ core: [1, 2] }));
    writePersistedOverrides(storage, STORAGE_KEY, EMPTY_OVERRIDES);
    expect(storage.removeCalls).toEqual([STORAGE_KEY]);
    expect(storage.setCalls.length).toBe(0);
    expect(storage.data.has(STORAGE_KEY)).toBe(false);
  });

  test("absent storage is a silent no-op", () => {
    expect((): void => {
      writePersistedOverrides(
        null,
        STORAGE_KEY,
        makeMap([["a", { x: 1, y: 2 }]]),
      );
    }).not.toThrow();
    expect((): void => {
      writePersistedOverrides(undefined, STORAGE_KEY, EMPTY_OVERRIDES);
    }).not.toThrow();
  });

  test("storage that throws on write never propagates the error", () => {
    const storage: TopologyOverrideStorage = makeThrowingStorage();
    expect((): void => {
      writePersistedOverrides(
        storage,
        STORAGE_KEY,
        makeMap([["a", { x: 1, y: 2 }]]),
      );
    }).not.toThrow();
    // ...and the removeItem path is just as protected.
    expect((): void => {
      writePersistedOverrides(storage, STORAGE_KEY, EMPTY_OVERRIDES);
    }).not.toThrow();
  });

  test("writing does not mutate the arrangement it was handed", () => {
    const storage: FakeStorage = makeFakeStorage();
    const overrides: PositionOverrides = makeMap([
      ["core", { x: 1.005, y: 2 }],
    ]);
    writePersistedOverrides(storage, STORAGE_KEY, overrides);
    expect(overrides.size).toBe(1);
    expect(overrides.get("core")).toEqual({ x: 1.005, y: 2 });
  });
});

describe("storage round trip", () => {
  test("what is written is what is read back, to two decimals", () => {
    const storage: FakeStorage = makeFakeStorage();
    const key: string = positionOverridesStorageKey(
      "proj-1",
      "site-9",
      "tiered",
    );
    const overrides: PositionOverrides = makeMap([
      ["core", { x: 12.3456, y: -78.9012 }],
      ["switch-a", { x: 0, y: 0 }],
      ["endpoint:pos-1", { x: -1.5, y: 2.25 }],
    ]);

    writePersistedOverrides(storage, key, overrides);
    const restored: PositionOverrides = readPersistedOverrides(storage, key);

    expect(restored.size).toBe(3);
    expect(restored.get("core")!.x).toBeCloseTo(12.35, 6);
    expect(restored.get("core")!.y).toBeCloseTo(-78.9, 6);
    expect(restored.get("switch-a")).toEqual({ x: 0, y: 0 });
    expect(restored.get("endpoint:pos-1")).toEqual({ x: -1.5, y: 2.25 });
    expect(storage.getCalls).toEqual([key]);
  });

  test("a saved arrangement re-applies to a fresh layout after a poll", () => {
    /*
     * End to end: drag two nodes, persist, reload, prune against the node
     * set the poll returned, and merge back over a recomputed layout.
     */
    const storage: FakeStorage = makeFakeStorage();
    const key: string = positionOverridesStorageKey(
      "proj-1",
      undefined,
      "force",
    );

    let dragged: PositionOverrides = EMPTY_OVERRIDES;
    dragged = withPositionOverride(dragged, "core", { x: 500, y: -250 });
    dragged = withPositionOverride(dragged, "gone-tomorrow", { x: 1, y: 1 });
    writePersistedOverrides(storage, key, dragged);

    const loaded: PositionOverrides = readPersistedOverrides(storage, key);
    expect(loaded.size).toBe(2);

    const layout: Map<string, TopologyPoint> = makeMap([
      ["core", { x: 0, y: 0 }],
      ["switch-a", { x: 100, y: 100 }],
    ]);
    const live: Set<string> = new Set<string>(layout.keys());
    const pruned: PositionOverrides = prunePositionOverrides(loaded, live);
    expect(pruned.size).toBe(1);
    expect(pruned.has("gone-tomorrow")).toBe(false);

    const merged: Map<string, TopologyPoint> = mergePositionOverrides(
      layout,
      pruned,
    );
    expect(merged.size).toBe(2);
    expect(merged.get("core")).toEqual({ x: 500, y: -250 });
    expect(merged.get("switch-a")).toEqual({ x: 100, y: 100 });
  });

  test("an arrangement saved under one mode is invisible to the other four", () => {
    /*
     * The five modes put the same device in five different places, so a
     * star hub coordinate leaking into the tiered map would fling that
     * node off the grid the instant the operator switched views. Isolation
     * is the whole reason the mode is in the key.
     */
    const storage: FakeStorage = makeFakeStorage();
    const starKey: string = positionOverridesStorageKey(
      "proj-1",
      "site-9",
      "star",
    );
    writePersistedOverrides(
      storage,
      starKey,
      makeMap([["core", { x: 42, y: -17 }]]),
    );

    expect(readPersistedOverrides(storage, starKey).get("core")).toEqual({
      x: 42,
      y: -17,
    });
    for (const layoutMode of ALL_LAYOUT_MODES) {
      if (layoutMode === "star") {
        continue;
      }
      const otherKey: string = positionOverridesStorageKey(
        "proj-1",
        "site-9",
        layoutMode,
      );
      expect(readPersistedOverrides(storage, otherKey).size).toBe(0);
    }
  });

  test("each of the five modes keeps its own arrangement side by side", () => {
    const storage: FakeStorage = makeFakeStorage();
    /* One-based so no mode's coordinate is the -0 that JSON flattens to 0. */
    for (let i: number = 0; i < ALL_LAYOUT_MODES.length; i++) {
      const layoutMode: TopologyLayoutMode = ALL_LAYOUT_MODES[i]!;
      writePersistedOverrides(
        storage,
        positionOverridesStorageKey("proj-1", "site-9", layoutMode),
        makeMap([["core", { x: (i + 1) * 10, y: (i + 1) * -10 }]]),
      );
    }
    expect(storage.data.size).toBe(ALL_LAYOUT_MODES.length);

    for (let i: number = 0; i < ALL_LAYOUT_MODES.length; i++) {
      const layoutMode: TopologyLayoutMode = ALL_LAYOUT_MODES[i]!;
      const restored: PositionOverrides = readPersistedOverrides(
        storage,
        positionOverridesStorageKey("proj-1", "site-9", layoutMode),
      );
      expect(restored.size).toBe(1);
      expect(restored.get("core")).toEqual({
        x: (i + 1) * 10,
        y: (i + 1) * -10,
      });
    }
  });

  test("arrangements saved before star and parent-child existed still load", () => {
    /*
     * Adding the two modes did not bump PERSISTED_OVERRIDES_VERSION, so
     * every arrangement an operator saved beforehand has to survive the
     * upgrade untouched. One key is spelled out literally: a rename of the
     * prefix or of a mode would orphan those saved layouts silently — the
     * map would simply come back unarranged, with nothing to show that a
     * drag had ever been remembered.
     */
    const storage: FakeStorage = makeFakeStorage();
    for (const layoutMode of LEGACY_LAYOUT_MODES) {
      writePersistedOverrides(
        storage,
        positionOverridesStorageKey("proj-1", "site-9", layoutMode),
        makeMap([
          ["core", { x: 10, y: 20 }],
          [`switch-${layoutMode}`, { x: 30.125, y: -40.5 }],
        ]),
      );
    }

    expect(
      storage.data.has(
        "oneuptime.networkTopology.positions.v1.proj-1.site-9.tiered",
      ),
    ).toBe(true);

    for (const layoutMode of LEGACY_LAYOUT_MODES) {
      const restored: PositionOverrides = readPersistedOverrides(
        storage,
        positionOverridesStorageKey("proj-1", "site-9", layoutMode),
      );
      expect(restored.size).toBe(2);
      expect(restored.get("core")).toEqual({ x: 10, y: 20 });
      expect(restored.get(`switch-${layoutMode}`)).toEqual({
        x: 30.13,
        y: -40.5,
      });
    }

    // The new modes inherit nothing — they open on the computed layout.
    expect(
      readPersistedOverrides(
        storage,
        positionOverridesStorageKey("proj-1", "site-9", "star"),
      ).size,
    ).toBe(0);
    expect(
      readPersistedOverrides(
        storage,
        positionOverridesStorageKey("proj-1", "site-9", "parentChild"),
      ).size,
    ).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* The arrangement / key pairing                                       */
/* ------------------------------------------------------------------ */

/*
 * NetworkTopologyLiveView's persistence hooks, replayed by hand.
 *
 * React is deliberately absent from App's resolution path (these modules
 * are react-free so they can be tested in plain Node), so this
 * transcribes the component's three effects rather than mounting it, in
 * the order React actually runs them: the render phase first, then EVERY
 * cleanup, then EVERY effect body. That order is the whole subject —
 * switching layout mode re-renders with the incoming mode's key while
 * state still holds the outgoing mode's coordinates, and the flush
 * happens inside that window.
 */
interface TopologyViewSession {
  /** A drag: new coordinates, same mode. */
  drag: (overrides: PositionOverrides) => void;
  /** The user clicks another layout pill. */
  switchTo: (key: string) => void;
  /** Navigating away. */
  unmount: () => void;
  /** The arrangement the graph is currently drawing. */
  onScreen: () => PositionOverrides;
}

type MountViewFunction = (
  storage: TopologyOverrideStorage,
  initialKey: string,
) => TopologyViewSession;

const mountTopologyView: MountViewFunction = (
  storage: TopologyOverrideStorage,
  initialKey: string,
): TopologyViewSession => {
  const persistence: ArrangementPersistence = createArrangementPersistence(
    storage,
    initialKey,
  );
  let onScreen: PositionOverrides = EMPTY_OVERRIDES;

  // Mount: render, then the load effect, then the re-render it causes.
  persistence.hold(onScreen);
  onScreen = persistence.adopt(initialKey);
  persistence.hold(onScreen);

  return {
    drag: (overrides: PositionOverrides): void => {
      onScreen = overrides;
      persistence.hold(onScreen);
    },
    switchTo: (key: string): void => {
      // Render: the key has advanced, the arrangement in state has not.
      persistence.hold(onScreen);
      // Cleanup of the flush effect, which runs before any effect body.
      persistence.flush();
      // Load effect body, then the re-render its state update causes.
      onScreen = persistence.adopt(key);
      persistence.hold(onScreen);
    },
    unmount: (): void => {
      persistence.flush();
    },
    onScreen: (): PositionOverrides => {
      return onScreen;
    },
  };
};

const TIERED_KEY: string = positionOverridesStorageKey(
  "proj-1",
  "site-9",
  "tiered",
);
const STAR_KEY: string = positionOverridesStorageKey(
  "proj-1",
  "site-9",
  "star",
);
const FORCE_KEY: string = positionOverridesStorageKey(
  "proj-1",
  "site-9",
  "force",
);

describe("createArrangementPersistence — the key never leads the arrangement", () => {
  test("holding new coordinates cannot move the key they will be filed under", () => {
    const storage: FakeStorage = makeFakeStorage();
    const persistence: ArrangementPersistence = createArrangementPersistence(
      storage,
      TIERED_KEY,
    );
    persistence.hold(makeMap([["core", { x: 4800, y: 3000 }]]));
    expect(persistence.keyInUse()).toBe(TIERED_KEY);

    persistence.flush();
    expect(storage.data.has(STAR_KEY)).toBe(false);
    expect(readPersistedOverrides(storage, TIERED_KEY).get("core")).toEqual({
      x: 4800,
      y: 3000,
    });
  });

  test("adopting a key moves the key and the arrangement together", () => {
    const storage: FakeStorage = makeFakeStorage();
    writePersistedOverrides(
      storage,
      STAR_KEY,
      makeMap([["core", { x: 12, y: 34 }]]),
    );
    const persistence: ArrangementPersistence = createArrangementPersistence(
      storage,
      TIERED_KEY,
    );
    persistence.hold(makeMap([["core", { x: 4800, y: 3000 }]]));

    expect(persistence.adopt(STAR_KEY).get("core")).toEqual({ x: 12, y: 34 });
    expect(persistence.keyInUse()).toBe(STAR_KEY);
    expect(persistence.held().get("core")).toEqual({ x: 12, y: 34 });
  });

  test("a flush with nothing held clears only its own key", () => {
    const storage: FakeStorage = makeFakeStorage();
    writePersistedOverrides(
      storage,
      STAR_KEY,
      makeMap([["core", { x: 12, y: 34 }]]),
    );
    const persistence: ArrangementPersistence = createArrangementPersistence(
      storage,
      TIERED_KEY,
    );
    persistence.hold(EMPTY_OVERRIDES);
    persistence.flush();

    expect(storage.removeCalls).toEqual([TIERED_KEY]);
    expect(storage.data.has(STAR_KEY)).toBe(true);
  });
});

describe("switching layout mode", () => {
  test("a tiered arrangement is never written into the star entry", () => {
    /*
     * The failure this exists for: the tiered coordinate lands under the
     * star key, the load that immediately follows reads it back, and the
     * node is drawn at (4800, 3000) in a coordinate system it was never
     * in — the off-screen fling the mode-keyed storage exists to prevent.
     */
    const storage: FakeStorage = makeFakeStorage();
    writePersistedOverrides(
      storage,
      TIERED_KEY,
      makeMap([["core", { x: 4800, y: 3000 }]]),
    );
    writePersistedOverrides(
      storage,
      STAR_KEY,
      makeMap([["core", { x: 12, y: 34 }]]),
    );

    const view: TopologyViewSession = mountTopologyView(storage, TIERED_KEY);
    expect(view.onScreen().get("core")).toEqual({ x: 4800, y: 3000 });

    view.switchTo(STAR_KEY);
    expect(view.onScreen().get("core")).toEqual({ x: 12, y: 34 });
    expect(readPersistedOverrides(storage, STAR_KEY).get("core")).toEqual({
      x: 12,
      y: 34,
    });
    expect(readPersistedOverrides(storage, TIERED_KEY).get("core")).toEqual({
      x: 4800,
      y: 3000,
    });
  });

  test("leaving a mode with no arrangement does not delete the next mode's", () => {
    /*
     * The same bug with an empty outgoing arrangement: the write becomes
     * a removeItem, so the star arrangement the operator built earlier is
     * silently deleted by the act of opening star mode.
     */
    const storage: FakeStorage = makeFakeStorage();
    writePersistedOverrides(
      storage,
      STAR_KEY,
      makeMap([["core", { x: 12, y: 34 }]]),
    );

    const view: TopologyViewSession = mountTopologyView(storage, TIERED_KEY);
    expect(view.onScreen().size).toBe(0);

    view.switchTo(STAR_KEY);
    expect(storage.data.has(STAR_KEY)).toBe(true);
    expect(view.onScreen().get("core")).toEqual({ x: 12, y: 34 });
    expect(storage.removeCalls).toEqual([TIERED_KEY]);
  });

  test("a drag inside the debounce window is saved to the mode it happened in", () => {
    /*
     * Drag in force mode, switch to star before the 500ms write fires.
     * The debounce is cancelled by the switch, so the flush is the only
     * thing that saves the drag — and it has to save it under the FORCE
     * key, not under whichever mode the user landed in.
     */
    const storage: FakeStorage = makeFakeStorage();
    const view: TopologyViewSession = mountTopologyView(storage, FORCE_KEY);
    view.drag(makeMap([["core", { x: 5000, y: 200 }]]));
    view.switchTo(STAR_KEY);

    expect(readPersistedOverrides(storage, FORCE_KEY).get("core")).toEqual({
      x: 5000,
      y: 200,
    });
    expect(readPersistedOverrides(storage, STAR_KEY).size).toBe(0);
    expect(view.onScreen().size).toBe(0);
  });

  test("a round trip through another mode brings the arrangement back", () => {
    const storage: FakeStorage = makeFakeStorage();
    const view: TopologyViewSession = mountTopologyView(storage, TIERED_KEY);
    view.drag(
      makeMap([
        ["core", { x: 120, y: 240 }],
        ["switch-a", { x: 300, y: 480 }],
      ]),
    );

    view.switchTo(STAR_KEY);
    view.drag(makeMap([["core", { x: 12, y: 34 }]]));
    view.switchTo(TIERED_KEY);

    expect(view.onScreen().get("core")).toEqual({ x: 120, y: 240 });
    expect(view.onScreen().get("switch-a")).toEqual({ x: 300, y: 480 });
    expect(readPersistedOverrides(storage, STAR_KEY).get("core")).toEqual({
      x: 12,
      y: 34,
    });
  });

  test("navigating away saves the mode that is actually on screen", () => {
    const storage: FakeStorage = makeFakeStorage();
    const view: TopologyViewSession = mountTopologyView(storage, TIERED_KEY);
    view.switchTo(STAR_KEY);
    view.drag(makeMap([["core", { x: 12, y: 34 }]]));
    view.unmount();

    expect(readPersistedOverrides(storage, STAR_KEY).get("core")).toEqual({
      x: 12,
      y: 34,
    });
    expect(storage.data.has(TIERED_KEY)).toBe(false);
  });

  test("switching sites is the same rule and keeps the two apart", () => {
    const storage: FakeStorage = makeFakeStorage();
    const siteNine: string = positionOverridesStorageKey(
      "proj-1",
      "site-9",
      "tiered",
    );
    const siteTen: string = positionOverridesStorageKey(
      "proj-1",
      "site-10",
      "tiered",
    );
    const view: TopologyViewSession = mountTopologyView(storage, siteNine);
    view.drag(makeMap([["core", { x: 700, y: 100 }]]));
    view.switchTo(siteTen);

    expect(readPersistedOverrides(storage, siteNine).get("core")).toEqual({
      x: 700,
      y: 100,
    });
    expect(readPersistedOverrides(storage, siteTen).size).toBe(0);
  });

  test("storage that throws on every access never breaks a mode switch", () => {
    const view: TopologyViewSession = mountTopologyView(
      makeThrowingStorage(),
      TIERED_KEY,
    );
    view.drag(makeMap([["core", { x: 1, y: 2 }]]));
    expect(() => {
      view.switchTo(STAR_KEY);
      view.unmount();
    }).not.toThrow();
    expect(view.onScreen().size).toBe(0);
  });
});
