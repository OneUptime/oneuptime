import { describe, expect, test } from "@jest/globals";
import {
  CALM_LABEL_THREAD_LIMIT,
  CALM_LINK_LIMIT,
  CALM_POSITION_LINE_LIMIT,
  DEFAULT_MAP_LAYERS,
  EMPHASIS_TRANSITION_MS,
  EMPTY_MAP_ADJACENCY,
  MAP_LAYERS_STORAGE_KEY,
  MAP_LAYER_OPTIONS,
  MUTED_OPACITY,
  MapAdjacency,
  MapFocus,
  MapInkPlan,
  MapInkWeight,
  MapLayerKey,
  MapLayerOption,
  MapLayerSettings,
  MapLineInk,
  MapLinkEnds,
  MapRole,
  MapTooltipText,
  NO_MAP_FOCUS,
  buildMapAdjacency,
  countHiddenMapLayers,
  isMapFocused,
  labelThreadInk,
  linkInk,
  linkRole,
  markerRole,
  normalizeMapLayers,
  opacityForRole,
  planMapInk,
  positionAnchorDot,
  positionLineInk,
  setMapLayer,
  splitMapTooltip,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/SiteMapInk";

/*
 * Issue #3432: "the lines on the Network Map are clutter — give me a switch
 * to hide them."
 *
 * The switch exists (MapLayerSettings, pinned at the bottom of this file),
 * but a switch alone would have been the wrong answer, and the tests here
 * are mostly about the right one. A marker is pushed off its coordinates
 * only because it would otherwise be invisible under another marker, and
 * the thread back to its real spot is the entire licence for that move.
 * Hiding the threads leaves the map drawing a store twenty pixels from
 * where the customer pinned it with nothing admitting so — decluttered and
 * quietly wrong, which is worse than cluttered.
 *
 * So the module this pins does three things instead:
 *
 *   - it gives the map an ink HIERARCHY, so a crowded frame draws its
 *     threads as hairlines rather than at the same weight as the markers,
 *     while a frame with two of them is left exactly as it was;
 *   - it decides what the map lifts out of the crowd when a reader points
 *     at something, so "what is this wired to" stops being a question you
 *     answer by tracing spaghetti with a finger;
 *   - and it keeps the switch honest: unreadable stored preferences read as
 *     "show everything", because a map that came back from a stale
 *     localStorage entry with its names missing is a bug report, not a
 *     preference.
 */

/*
 * ── The ink plan ───────────────────────────────────────────────────────
 */

function inkInput(overrides: {
  positionLineCount?: number;
  labelThreadCount?: number;
  linkCount?: number;
}): {
  positionLineCount: number;
  labelThreadCount: number;
  linkCount: number;
} {
  return {
    positionLineCount: 0,
    labelThreadCount: 0,
    linkCount: 0,
    ...overrides,
  };
}

describe("planMapInk", () => {
  test("an empty map draws every layer at full strength", () => {
    expect(planMapInk(inkInput({}))).toEqual({
      positionLines: "full",
      labelThreads: "full",
      links: "full",
    });
  });

  /*
   * The map this feature exists for. Nothing about a handful of threads is
   * clutter, and quietening them would take away a pointer somebody needs.
   */
  test("a map at the limit is still drawn exactly as it always was", () => {
    expect(
      planMapInk(
        inkInput({
          positionLineCount: CALM_POSITION_LINE_LIMIT,
          labelThreadCount: CALM_LABEL_THREAD_LIMIT,
          linkCount: CALM_LINK_LIMIT,
        }),
      ),
    ).toEqual({
      positionLines: "full",
      labelThreads: "full",
      links: "full",
    });
  });

  test("one past the limit quietens that layer", () => {
    expect(
      planMapInk(
        inkInput({
          positionLineCount: CALM_POSITION_LINE_LIMIT + 1,
          labelThreadCount: CALM_LABEL_THREAD_LIMIT + 1,
          linkCount: CALM_LINK_LIMIT + 1,
        }),
      ),
    ).toEqual({
      positionLines: "quiet",
      labelThreads: "quiet",
      links: "quiet",
    });
  });

  /*
   * Each layer is judged on its own. A map with two nudged markers and
   * thirty links has one crowd on it, not three.
   */
  test("a crowded layer does not drag the calm ones down with it", () => {
    const plan: MapInkPlan = planMapInk(
      inkInput({ positionLineCount: 2, linkCount: 40 }),
    );
    expect(plan.positionLines).toBe("full");
    expect(plan.labelThreads).toBe("full");
    expect(plan.links).toBe("quiet");
  });

  /*
   * Links survive longer than threads before they calm down: a link is a
   * fact about the network that geography cannot show, and it is the only
   * reason some customers open this map at all.
   */
  test("links are given more room than the threads that explain a nudge", () => {
    expect(CALM_LINK_LIMIT).toBeGreaterThan(CALM_POSITION_LINE_LIMIT);
    expect(CALM_LINK_LIMIT).toBeGreaterThan(CALM_LABEL_THREAD_LIMIT);
  });

  test.each([
    ["NaN", Number.NaN],
    ["infinite", Infinity],
    ["negative", -5],
  ])("a %s count is not a crowd", (_name: string, count: number) => {
    const plan: MapInkPlan = planMapInk(
      inkInput({
        positionLineCount: count,
        labelThreadCount: count,
        linkCount: count,
      }),
    );
    /*
     * Infinity is a real (if impossible) count and reads as crowded; the
     * unreadable ones fall back to leaving the map alone. Either way the
     * function returns a weight rather than propagating the junk.
     */
    for (const weight of [plan.positionLines, plan.labelThreads, plan.links]) {
      expect(["full", "quiet"]).toContain(weight);
    }
  });

  test("a NaN count specifically leaves the layer alone", () => {
    expect(
      planMapInk(inkInput({ positionLineCount: Number.NaN })).positionLines,
    ).toBe("full");
  });
});

/*
 * ── Who is wired to whom ───────────────────────────────────────────────
 */

function linkEnds(
  key: string,
  fromMarkerKey: string,
  toMarkerKey: string,
): MapLinkEnds {
  return { key, fromMarkerKey, toMarkerKey };
}

describe("buildMapAdjacency", () => {
  test("a link is walkable from both of its ends", () => {
    const adjacency: MapAdjacency = buildMapAdjacency([
      linkEnds("l1", "a", "b"),
    ]);
    expect(Array.from(adjacency.neighbours.get("a") || [])).toEqual(["b"]);
    expect(Array.from(adjacency.neighbours.get("b") || [])).toEqual(["a"]);
    expect(adjacency.endpoints.get("l1")).toEqual(["a", "b"]);
  });

  test("a marker collects every neighbour it has", () => {
    const adjacency: MapAdjacency = buildMapAdjacency([
      linkEnds("l1", "hub", "a"),
      linkEnds("l2", "b", "hub"),
      linkEnds("l3", "hub", "c"),
    ]);
    expect(Array.from(adjacency.neighbours.get("hub") || []).sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  /*
   * Two links between one pair — a fibre pair, which is exactly what this
   * map draws bowed apart — must not make either end its own neighbour
   * twice or change what lights up.
   */
  test("parallel links between one pair collapse to one neighbour", () => {
    const adjacency: MapAdjacency = buildMapAdjacency([
      linkEnds("l1", "a", "b"),
      linkEnds("l2", "a", "b"),
    ]);
    expect(Array.from(adjacency.neighbours.get("a") || [])).toEqual(["b"]);
    expect(adjacency.endpoints.get("l1")).toEqual(["a", "b"]);
    expect(adjacency.endpoints.get("l2")).toEqual(["a", "b"]);
  });

  /*
   * A marker linked to itself would otherwise be its own neighbour, and
   * "related" is supposed to mean something OTHER than the subject.
   */
  test("a self-link joins nothing", () => {
    const adjacency: MapAdjacency = buildMapAdjacency([
      linkEnds("l1", "a", "a"),
    ]);
    expect(adjacency.neighbours.get("a")).toBeUndefined();
    // It is still a link the reader can point at.
    expect(adjacency.endpoints.get("l1")).toEqual(["a", "a"]);
  });

  test("a link with an end the map is not drawing is skipped", () => {
    const adjacency: MapAdjacency = buildMapAdjacency([
      linkEnds("l1", "a", ""),
      linkEnds("l2", "", "b"),
    ]);
    expect(adjacency.neighbours.size).toBe(0);
    expect(adjacency.endpoints.size).toBe(0);
  });

  test("the shared empty index really is empty", () => {
    expect(EMPTY_MAP_ADJACENCY.neighbours.size).toBe(0);
    expect(EMPTY_MAP_ADJACENCY.endpoints.size).toBe(0);
  });
});

/*
 * ── What the reader is pointing at ─────────────────────────────────────
 */

const TRIANGLE: Array<MapLinkEnds> = [
  linkEnds("a-b", "a", "b"),
  linkEnds("b-c", "b", "c"),
];

function focusOn(overrides: Partial<MapFocus>): MapFocus {
  return { ...NO_MAP_FOCUS, ...overrides };
}

describe("isMapFocused", () => {
  test("a map with nothing under the pointer is not focused", () => {
    expect(isMapFocused(NO_MAP_FOCUS)).toBe(false);
  });

  test("either kind of subject counts", () => {
    expect(isMapFocused(focusOn({ markerKey: "a" }))).toBe(true);
    expect(isMapFocused(focusOn({ linkKey: "a-b" }))).toBe(true);
  });
});

describe("markerRole", () => {
  const adjacency: MapAdjacency = buildMapAdjacency(TRIANGLE);

  function roleOf(focus: MapFocus, markerKey: string): MapRole {
    return markerRole({ focus, adjacency, markerKey });
  }

  /*
   * The map at rest. Nothing is emphasised, so — and this is the half that
   * matters — nothing is dimmed either: a map that permanently faded most
   * of itself would be a worse map, not a calmer one.
   */
  test("with nothing under the pointer every marker is idle", () => {
    for (const key of ["a", "b", "c"]) {
      expect(roleOf(NO_MAP_FOCUS, key)).toBe("idle");
    }
  });

  test("the marker under the pointer is the subject", () => {
    expect(roleOf(focusOn({ markerKey: "b" }), "b")).toBe("active");
  });

  test("what it is wired to stays lit; everything else falls back", () => {
    const focus: MapFocus = focusOn({ markerKey: "b" });
    expect(roleOf(focus, "a")).toBe("related");
    expect(roleOf(focus, "c")).toBe("related");
    expect(roleOf(focus, "somewhere-else")).toBe("muted");
  });

  /*
   * One hop, never two. A transitive sweep would light most of a connected
   * estate, which emphasises nothing at all.
   */
  test("a neighbour's neighbour is not related", () => {
    expect(roleOf(focusOn({ markerKey: "a" }), "c")).toBe("muted");
  });

  test("pointing at a link lights both of its ends", () => {
    const focus: MapFocus = focusOn({ linkKey: "a-b" });
    expect(roleOf(focus, "a")).toBe("related");
    expect(roleOf(focus, "b")).toBe("related");
    expect(roleOf(focus, "c")).toBe("muted");
  });

  test("a map with no links mutes everything but the subject", () => {
    const bare: MapAdjacency = buildMapAdjacency([]);
    expect(
      markerRole({
        focus: focusOn({ markerKey: "a" }),
        adjacency: bare,
        markerKey: "a",
      }),
    ).toBe("active");
    expect(
      markerRole({
        focus: focusOn({ markerKey: "a" }),
        adjacency: bare,
        markerKey: "b",
      }),
    ).toBe("muted");
  });
});

describe("linkRole", () => {
  function roleOf(focus: MapFocus, link: MapLinkEnds): MapRole {
    return linkRole({ focus, link });
  }

  test("with nothing under the pointer every line is idle", () => {
    expect(roleOf(NO_MAP_FOCUS, TRIANGLE[0]!)).toBe("idle");
  });

  test("the line under the pointer is the subject", () => {
    expect(roleOf(focusOn({ linkKey: "a-b" }), TRIANGLE[0]!)).toBe("active");
    expect(roleOf(focusOn({ linkKey: "a-b" }), TRIANGLE[1]!)).toBe("muted");
  });

  /*
   * The payoff for the reader: pointing at a marker picks its own lines out
   * of the bundle crossing it.
   */
  test("pointing at a marker lights the lines that touch it", () => {
    const focus: MapFocus = focusOn({ markerKey: "b" });
    expect(roleOf(focus, TRIANGLE[0]!)).toBe("related");
    expect(roleOf(focus, TRIANGLE[1]!)).toBe("related");
    expect(roleOf(focus, linkEnds("x-y", "x", "y"))).toBe("muted");
  });
});

describe("opacityForRole", () => {
  test("only a muted element fades", () => {
    expect(opacityForRole("idle")).toBe(1);
    expect(opacityForRole("active")).toBe(1);
    expect(opacityForRole("related")).toBe(1);
    expect(opacityForRole("muted")).toBe(MUTED_OPACITY);
  });

  /*
   * Far enough back that the emphasised elements read as the subject, near
   * enough that the map is still a map — a reader tracing one link across a
   * coastline must not lose the coastline.
   */
  test("muted is a fade, not a disappearance", () => {
    expect(MUTED_OPACITY).toBeGreaterThan(0.1);
    expect(MUTED_OPACITY).toBeLessThan(0.5);
  });

  test("the fade is quick enough to read as a response", () => {
    expect(EMPHASIS_TRANSITION_MS).toBeGreaterThan(0);
    expect(EMPHASIS_TRANSITION_MS).toBeLessThanOrEqual(200);
  });
});

/*
 * ── The lines themselves ───────────────────────────────────────────────
 */

const INK_KINDS: Array<{
  name: string;
  ink: (weight: MapInkWeight, role: MapRole) => MapLineInk;
}> = [
  { name: "position lines", ink: positionLineInk },
  { name: "label threads", ink: labelThreadInk },
  { name: "links", ink: linkInk },
];

describe.each(INK_KINDS)(
  "$name",
  (kind: {
    name: string;
    ink: (weight: MapInkWeight, role: MapRole) => MapLineInk;
  }) => {
    test("quiet is lighter than full in every dimension that reads", () => {
      const full: MapLineInk = kind.ink("full", "idle");
      const quiet: MapLineInk = kind.ink("quiet", "idle");
      expect(quiet.width).toBeLessThan(full.width);
      expect(quiet.opacity).toBeLessThan(full.opacity);
      expect(quiet.haloWidth).toBeLessThan(full.haloWidth);
    });

    /*
     * "quiet" is not "off". The whole bargain of the hierarchy is that
     * nothing is hidden — a reader who looks can still see every thread on
     * the map, they just do not have to look at all of them at once.
     */
    test("quiet is still drawn", () => {
      const quiet: MapLineInk = kind.ink("quiet", "idle");
      expect(quiet.width).toBeGreaterThan(0);
      expect(quiet.opacity).toBeGreaterThan(0);
    });

    test("the subject is drawn at least as loudly as a calm map draws it", () => {
      const full: MapLineInk = kind.ink("full", "idle");
      const active: MapLineInk = kind.ink("quiet", "active");
      expect(active.width).toBeGreaterThanOrEqual(full.width);
      expect(active.opacity).toBeGreaterThanOrEqual(full.opacity);
    });

    /*
     * The rule that makes the hover worth anything: on the crowded map,
     * pointing at something hands back the weight the map took away.
     */
    test("pointing at it overrides a quiet plan", () => {
      expect(kind.ink("quiet", "active")).not.toEqual(
        kind.ink("quiet", "idle"),
      );
      expect(kind.ink("quiet", "related")).toEqual(kind.ink("full", "idle"));
    });

    test("a muted element keeps the plan's weight — the fade does the work", () => {
      expect(kind.ink("quiet", "muted")).toEqual(kind.ink("quiet", "idle"));
      expect(kind.ink("full", "muted")).toEqual(kind.ink("full", "idle"));
    });

    test("every line is drawn over an under-stroke wider than itself", () => {
      for (const weight of ["full", "quiet"] as Array<MapInkWeight>) {
        for (const role of ["idle", "active", "related"] as Array<MapRole>) {
          const ink: MapLineInk = kind.ink(weight, role);
          expect([kind.name, ink.haloWidth > ink.width]).toEqual([
            kind.name,
            true,
          ]);
        }
      }
    });
  },
);

describe("what a line is coloured with", () => {
  /*
   * A hairline is too thin to read a colour off, and a red hairline beside
   * a red marker reads as a second claim about the site rather than as the
   * bookkeeping it is.
   */
  test("a quiet position thread gives up its colour with its weight", () => {
    expect(positionLineInk("full", "idle").isColored).toBe(true);
    expect(positionLineInk("quiet", "idle").isColored).toBe(false);
  });

  test("and takes it straight back when it is pointed at", () => {
    expect(positionLineInk("quiet", "active").isColored).toBe(true);
    expect(positionLineInk("quiet", "related").isColored).toBe(true);
  });

  /*
   * A link's colour is its monitor's verdict. A link that is down has to
   * stay findable on a map that has calmed everything else down.
   */
  test("a link keeps its colour however quiet it gets", () => {
    for (const weight of ["full", "quiet"] as Array<MapInkWeight>) {
      expect(linkInk(weight, "idle").isColored).toBe(true);
      expect(linkInk(weight, "muted").isColored).toBe(true);
    }
  });

  // A name is typography, not status — its thread never carries a colour.
  test("a label thread is never coloured", () => {
    for (const weight of ["full", "quiet"] as Array<MapInkWeight>) {
      for (const role of [
        "idle",
        "active",
        "related",
        "muted",
      ] as Array<MapRole>) {
        expect(labelThreadInk(weight, role).isColored).toBe(false);
      }
    }
  });
});

describe("positionAnchorDot", () => {
  /*
   * The pip on the end of a position thread is the exact spot the marker
   * belongs to, so it has to fade WITH the thread — a full-strength full
   * stop on a hairline reads as a marker of its own.
   */
  test("the dot is sized from its own thread", () => {
    const full: MapLineInk = positionLineInk("full", "idle");
    const quiet: MapLineInk = positionLineInk("quiet", "idle");
    expect(positionAnchorDot(quiet).radius).toBeLessThan(
      positionAnchorDot(full).radius,
    );
    expect(positionAnchorDot(quiet).haloRadius).toBeLessThan(
      positionAnchorDot(full).haloRadius,
    );
  });

  test("the white pip is always bigger than the coloured centre", () => {
    for (const weight of ["full", "quiet"] as Array<MapInkWeight>) {
      const dot: { radius: number; haloRadius: number } = positionAnchorDot(
        positionLineInk(weight, "idle"),
      );
      expect(dot.haloRadius).toBeGreaterThan(dot.radius);
    }
  });

  /*
   * At full weight this is the 1.25 / 2.25 pair the map has drawn since the
   * leader lines shipped — the hierarchy changes the crowded map, never the
   * calm one.
   */
  test("a full-strength dot is exactly what the map always drew", () => {
    expect(positionAnchorDot(positionLineInk("full", "idle"))).toEqual({
      radius: 1.25,
      haloRadius: 2.25,
    });
  });
});

/*
 * ── The switch ─────────────────────────────────────────────────────────
 */

describe("map layer settings", () => {
  test("every layer starts on", () => {
    expect(DEFAULT_MAP_LAYERS).toEqual({
      names: true,
      links: true,
      positionLines: true,
    });
  });

  test("there is an option for every layer, and nothing else", () => {
    expect(
      MAP_LAYER_OPTIONS.map((option: MapLayerOption): MapLayerKey => {
        return option.key;
      }).sort(),
    ).toEqual(["links", "names", "positionLines"]);
    for (const option of MAP_LAYER_OPTIONS) {
      expect([option.key, option.label.length > 0]).toEqual([option.key, true]);
      expect([option.key, option.hint.length > 0]).toEqual([option.key, true]);
    }
  });

  /*
   * One key for every map on the page: the choice is about how a reader
   * wants maps to look, not about which level they happen to be on, and a
   * preference that reset on every drill-down would read as a control that
   * does not work.
   */
  test("the preference is stored under one stable key", () => {
    expect(MAP_LAYERS_STORAGE_KEY).toBe("oneuptime-network-map-layers");
  });

  test("setMapLayer changes one layer and leaves the rest alone", () => {
    const next: MapLayerSettings = setMapLayer(
      DEFAULT_MAP_LAYERS,
      "positionLines",
      false,
    );
    expect(next).toEqual({ names: true, links: true, positionLines: false });
    // ...and does not mutate what it was handed.
    expect(DEFAULT_MAP_LAYERS.positionLines).toBe(true);
  });

  test("the badge counts what is hidden", () => {
    expect(countHiddenMapLayers(DEFAULT_MAP_LAYERS)).toBe(0);
    expect(
      countHiddenMapLayers({
        names: false,
        links: true,
        positionLines: false,
      }),
    ).toBe(2);
  });
});

describe("normalizeMapLayers", () => {
  test("a stored preference comes back intact", () => {
    expect(
      normalizeMapLayers({ names: true, links: false, positionLines: false }),
    ).toEqual({ names: true, links: false, positionLines: false });
  });

  /*
   * localStorage is shared with every other tab and survives every deploy,
   * so this is handed values nobody in this build wrote. All of them have
   * to read as "show that layer": a map that came back with its names
   * missing because of a stale entry is a bug report, not a preference.
   */
  test.each([
    ["null", null],
    ["undefined", undefined],
    ["a string from an older shape", "names,links"],
    ["a number", 3],
    ["an array", ["names"]],
    ["an empty object", {}],
  ])("%s reads as show everything", (_name: string, value: unknown) => {
    expect(normalizeMapLayers(value)).toEqual(DEFAULT_MAP_LAYERS);
  });

  test("a half-written entry only keeps the halves it can read", () => {
    expect(normalizeMapLayers({ links: false })).toEqual({
      names: true,
      links: false,
      positionLines: true,
    });
  });

  test("a non-boolean flag reads as on rather than as off", () => {
    expect(
      normalizeMapLayers({ names: "false", links: 0, positionLines: null }),
    ).toEqual(DEFAULT_MAP_LAYERS);
  });

  test("keys nobody recognises are ignored", () => {
    expect(
      normalizeMapLayers({ names: false, borders: false, zoom: 4 }),
    ).toEqual({ names: false, links: true, positionLines: true });
  });

  test("the result is a fresh object, never the shared default", () => {
    const normalized: MapLayerSettings = normalizeMapLayers(null);
    expect(normalized).not.toBe(DEFAULT_MAP_LAYERS);
  });
});

/*
 * ── The hover card ─────────────────────────────────────────────────────
 */

describe("splitMapTooltip", () => {
  /*
   * The tooltip is one " · "-joined line because that is exactly right for
   * the marker's accessible name. On a card it is exactly wrong: a
   * twelve-word grey sentence hides the one thing the reader was pointing
   * at the marker to find out.
   */
  test("a marker's name leads, and everything qualifying it follows", () => {
    const split: MapTooltipText = splitMapTooltip(
      "Region 1300 — Region · 4 of 97 units down · 12 sites",
    );
    expect(split.title).toBe("Region 1300");
    expect(split.detail).toEqual(["Region", "4 of 97 units down", "12 sites"]);
  });

  test("a link's name leads too", () => {
    expect(splitMapTooltip("Chicago fibre — No monitor attached")).toEqual({
      title: "Chicago fibre",
      detail: ["No monitor attached"],
    });
  });

  test("a bare name is all title and no detail", () => {
    expect(splitMapTooltip("Store 41")).toEqual({
      title: "Store 41",
      detail: [],
    });
  });

  test("a cluster's roll-up survives with its commas intact", () => {
    expect(splitMapTooltip("4 sites: Alpha, Beta, Gamma, +1 more")).toEqual({
      title: "4 sites: Alpha, Beta, Gamma, +1 more",
      detail: [],
    });
  });

  test.each([
    ["empty", ""],
    ["whitespace", "   "],
  ])(
    "a %s tooltip splits into nothing at all",
    (_name: string, value: string) => {
      expect(splitMapTooltip(value)).toEqual({ title: "", detail: [] });
    },
  );

  test("empty parts are dropped rather than drawn as blank lines", () => {
    expect(splitMapTooltip("Store 41 — Unit ·  · Operational")).toEqual({
      title: "Store 41",
      detail: ["Unit", "Operational"],
    });
  });

  test("a dash with nothing after it does not invent an empty detail line", () => {
    expect(splitMapTooltip("Store 41 — ")).toEqual({
      title: "Store 41",
      detail: [],
    });
  });
});
