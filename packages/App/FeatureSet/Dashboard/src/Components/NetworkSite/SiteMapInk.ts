/*
 * Pure, react-free ink policy for the Network Map: how loudly each kind of
 * line is drawn, and what the map lifts out of the crowd while the reader
 * is pointing at something.
 *
 * Kept out of the component so the decisions can be imported (and
 * unit-tested) in a plain Node/TypeScript environment — see
 * Geo/GeoProjection.ts for why.
 *
 * WHY THIS EXISTS
 *
 * The map draws four kinds of ink at once: the markers themselves, the
 * thread from a marker that had to be moved back to the spot it belongs to,
 * the thread from a name that could not fit against its marker, and the
 * links between connected sites. Every one of them earns its place, and
 * every one of them used to be drawn at full strength all of the time.
 *
 * On a real franchise estate — forty regions piled over one country, wired
 * together — that is not four layers. It is a web. Issue #3432 reported the
 * symptom and asked for the obvious fix: a switch that hides the threads.
 *
 * A switch alone is the wrong fix, and it is worth being precise about why.
 * The threads are not decoration: a marker is pushed off its coordinates
 * only because it would otherwise be invisible under another one, and the
 * thread is the entire licence for that move. Hide it and the map still
 * draws a store twenty pixels from where the customer pinned it, with
 * nothing on screen admitting so. The clutter would be gone and the map
 * would be quietly wrong, which is worse.
 *
 * What was actually missing is a HIERARCHY. Everything on the map shouted,
 * so nothing was legible. So:
 *
 *   - At rest, on a crowded map, the threads drop to a hairline and the
 *     links thin out. They are still there — nothing is hidden, and a
 *     reader who looks can still see exactly where a marker belongs — but
 *     they stop competing with the markers for attention. On a map with
 *     only a few of them there is no crowd to fix, and they are drawn at
 *     full strength exactly as before.
 *
 *   - On hover or keyboard focus, one marker becomes the subject: its
 *     thread, its name and its links go to full strength, the markers it is
 *     connected to stay lit, and everything else fades back. That turns the
 *     web into an answer to "what is this, where is it really, and what is
 *     it wired to" — which is what a reader was trying to trace through the
 *     spaghetti by eye.
 *
 *   - And the switch is still there (see MapLayerSettings), because a
 *     customer who wants a bare map of dots should have one. It is the
 *     escape hatch, not the design.
 *
 * Everything here is deterministic: same input, same output, no randomness
 * and no clock access.
 */

/*
 * ── How loud a kind of line is drawn ───────────────────────────────────
 *
 * "quiet" is not "off". It is the same line at a hairline weight and a low
 * opacity, which is what lets a crowded map keep every one of its threads
 * without any of them shouting.
 */
export type MapInkWeight = "full" | "quiet";

/*
 * What the map is about to draw. Counts, not markers — this decides a
 * weight for a whole layer, and a layer is crowded or it is not.
 */
export interface MapInkInput {
  // Markers that had to be moved, and therefore carry a thread.
  positionLineCount: number;
  // Names that could not fit against their marker, and carry one too.
  labelThreadCount: number;
  linkCount: number;
}

export interface MapInkPlan {
  positionLines: MapInkWeight;
  labelThreads: MapInkWeight;
  links: MapInkWeight;
}

/*
 * The counts at which a layer stops being a few pointers and starts being a
 * texture.
 *
 * Deliberately low. The failure this fixes is not "a hundred lines"; it is
 * the handful of lines that a reader has to visually subtract from the map
 * before they can count the markers. Half a dozen threads over a country is
 * already that. Below these numbers the lines genuinely help — three nudged
 * markers on an otherwise empty map want saying so — so nothing changes for
 * the maps that were never crowded.
 */
export const CALM_POSITION_LINE_LIMIT: number = 4;
export const CALM_LABEL_THREAD_LIMIT: number = 4;
/*
 * Links get more room before they quieten: a link is a fact about the
 * network that geography cannot show, and it is the only reason some
 * customers open this map at all. It has to survive longer than a thread
 * whose whole job is to explain a nudge.
 */
export const CALM_LINK_LIMIT: number = 8;

const weightForCount: (count: number, limit: number) => MapInkWeight = (
  count: number,
  limit: number,
): MapInkWeight => {
  // A count the caller could not produce is not a crowd.
  const safeCount: number = Number.isFinite(count) ? count : 0;
  return safeCount > limit ? "quiet" : "full";
};

/**
 * Decide how loudly each layer is drawn at rest, from how much of it there
 * is. Each layer is judged on its own: a map with two nudged markers and
 * thirty links quietens the links and leaves the two threads alone.
 */
export const planMapInk: (input: MapInkInput) => MapInkPlan = (
  input: MapInkInput,
): MapInkPlan => {
  return {
    positionLines: weightForCount(
      input.positionLineCount,
      CALM_POSITION_LINE_LIMIT,
    ),
    labelThreads: weightForCount(
      input.labelThreadCount,
      CALM_LABEL_THREAD_LIMIT,
    ),
    links: weightForCount(input.linkCount, CALM_LINK_LIMIT),
  };
};

/*
 * ── What the reader is pointing at ─────────────────────────────────────
 *
 * "idle" is the whole map at rest: nothing is emphasised, so nothing is
 * dimmed either. The other three only ever appear together — the moment one
 * element is "active", every other element on the map is "related" or
 * "muted", and that is what makes the emphasis read.
 */
export type MapRole = "idle" | "active" | "related" | "muted";

export interface MapFocus {
  // The marker under the pointer, or holding keyboard focus.
  markerKey: string | null;
  // The link under the pointer. Never set at the same time as markerKey.
  linkKey: string | null;
}

export const NO_MAP_FOCUS: MapFocus = { markerKey: null, linkKey: null };

export const isMapFocused: (focus: MapFocus) => boolean = (
  focus: MapFocus,
): boolean => {
  return focus.markerKey !== null || focus.linkKey !== null;
};

// What the adjacency index needs off a drawn link: its ends, by marker.
export interface MapLinkEnds {
  key: string;
  fromMarkerKey: string;
  toMarkerKey: string;
}

/**
 * Who is wired to whom, in the two directions the emphasis has to answer:
 * "which markers does this marker reach" and "which markers does this link
 * join".
 *
 * Built once per frame rather than searched per marker — a level with forty
 * markers and sixty links would otherwise walk the whole link list forty
 * times on every pointer move.
 */
export interface MapAdjacency {
  neighbours: Map<string, Set<string>>;
  endpoints: Map<string, Array<string>>;
}

export const buildMapAdjacency: (links: Array<MapLinkEnds>) => MapAdjacency = (
  links: Array<MapLinkEnds>,
): MapAdjacency => {
  const neighbours: Map<string, Set<string>> = new Map<string, Set<string>>();
  const endpoints: Map<string, Array<string>> = new Map<
    string,
    Array<string>
  >();

  const join: (from: string, to: string) => void = (
    from: string,
    to: string,
  ): void => {
    const existing: Set<string> | undefined = neighbours.get(from);
    if (existing) {
      existing.add(to);
      return;
    }
    neighbours.set(from, new Set<string>([to]));
  };

  for (const link of links) {
    /*
     * A link with an end the map is not drawing cannot emphasise anything,
     * and a self-link joins a marker to itself — which would light the whole
     * of its own neighbourhood for no reason.
     */
    if (!link.fromMarkerKey || !link.toMarkerKey) {
      continue;
    }
    endpoints.set(link.key, [link.fromMarkerKey, link.toMarkerKey]);
    if (link.fromMarkerKey === link.toMarkerKey) {
      continue;
    }
    join(link.fromMarkerKey, link.toMarkerKey);
    join(link.toMarkerKey, link.fromMarkerKey);
  }

  return { neighbours: neighbours, endpoints: endpoints };
};

/*
 * What a map with no links to speak of hands to the emphasis. Shared rather
 * than rebuilt per frame, and READ-ONLY by contract — nothing may write into
 * it, or every map in the tab inherits the entry.
 */
export const EMPTY_MAP_ADJACENCY: MapAdjacency = buildMapAdjacency([]);

/**
 * What one marker is, relative to whatever the reader is pointing at.
 *
 * A marker is "related" when it is one hop from the marker in focus, or an
 * end of the link in focus. One hop, never two: the point is to answer
 * "what does this reach", and a transitive sweep would light most of a
 * connected estate and emphasise nothing.
 */
export const markerRole: (input: {
  focus: MapFocus;
  adjacency: MapAdjacency;
  markerKey: string;
}) => MapRole = (input: {
  focus: MapFocus;
  adjacency: MapAdjacency;
  markerKey: string;
}): MapRole => {
  if (!isMapFocused(input.focus)) {
    return "idle";
  }
  if (input.focus.markerKey === input.markerKey) {
    return "active";
  }
  if (
    input.focus.markerKey !== null &&
    input.adjacency.neighbours.get(input.focus.markerKey)?.has(input.markerKey)
  ) {
    return "related";
  }
  if (
    input.focus.linkKey !== null &&
    input.adjacency.endpoints
      .get(input.focus.linkKey)
      ?.includes(input.markerKey)
  ) {
    return "related";
  }
  return "muted";
};

/**
 * What one link is, relative to the same focus: the link itself when it is
 * the thing being pointed at, and every link touching the marker in focus.
 */
export const linkRole: (input: {
  focus: MapFocus;
  link: MapLinkEnds;
}) => MapRole = (input: { focus: MapFocus; link: MapLinkEnds }): MapRole => {
  if (!isMapFocused(input.focus)) {
    return "idle";
  }
  if (input.focus.linkKey === input.link.key) {
    return "active";
  }
  if (
    input.focus.markerKey !== null &&
    (input.focus.markerKey === input.link.fromMarkerKey ||
      input.focus.markerKey === input.link.toMarkerKey)
  ) {
    return "related";
  }
  return "muted";
};

/*
 * How far back a muted element goes. Far enough that the emphasised ones
 * read as the subject, near enough that the map is still a map — a reader
 * who hovers a marker to trace one link must not lose the coastline they
 * are tracing it across, or the shape of the estate around it.
 */
export const MUTED_OPACITY: number = 0.22;

export const opacityForRole: (role: MapRole) => number = (
  role: MapRole,
): number => {
  return role === "muted" ? MUTED_OPACITY : 1;
};

/*
 * How long the fade takes. Long enough not to flash as the pointer crosses
 * a marker on its way somewhere else, short enough that the emphasis feels
 * like a response rather than an animation.
 */
export const EMPHASIS_TRANSITION_MS: number = 120;

/*
 * ── The lines themselves ───────────────────────────────────────────────
 *
 * Widths are SCREEN units, the same units marker radii are in: the renderer
 * divides by the zoom, so a line stays the same weight on screen however
 * far the map is zoomed.
 *
 * Every line on this map is drawn twice — a pale under-stroke first, then
 * the line itself — so it survives crossing a coastline or a dark landmass.
 * The halo is part of the line's weight, so it belongs here rather than
 * being a constant in the renderer that quietly stops matching.
 */
export interface MapLineInk {
  width: number;
  opacity: number;
  haloWidth: number;
  haloOpacity: number;
  /*
   * Whether the line carries its subject's own colour. A quiet position
   * thread goes neutral: at a hairline weight the colour is not readable as
   * a status anyway, and a red hairline beside a red marker is a second
   * claim about the site that nobody can act on.
   */
  isColored: boolean;
}

/*
 * The thread from a nudged marker back to the spot it belongs to. "full" is
 * exactly what the map has always drawn.
 */
const POSITION_LINE_INK: Record<MapInkWeight, MapLineInk> = {
  full: {
    width: 1.25,
    opacity: 0.9,
    haloWidth: 3.5,
    haloOpacity: 0.9,
    isColored: true,
  },
  quiet: {
    width: 0.7,
    opacity: 0.4,
    haloWidth: 2.2,
    haloOpacity: 0.6,
    isColored: false,
  },
};

// The same thread, emphasised: the marker under the pointer.
const POSITION_LINE_EMPHASIS: MapLineInk = {
  width: 1.6,
  opacity: 1,
  haloWidth: 4,
  haloOpacity: 1,
  isColored: true,
};

// The thread from a marker to a name that could not sit against it.
const LABEL_THREAD_INK: Record<MapInkWeight, MapLineInk> = {
  full: {
    width: 0.9,
    opacity: 0.75,
    haloWidth: 3,
    haloOpacity: 0.9,
    isColored: false,
  },
  quiet: {
    width: 0.65,
    opacity: 0.38,
    haloWidth: 2.2,
    haloOpacity: 0.6,
    isColored: false,
  },
};

const LABEL_THREAD_EMPHASIS: MapLineInk = {
  width: 1.1,
  opacity: 1,
  haloWidth: 3.5,
  haloOpacity: 1,
  isColored: false,
};

/*
 * A link line. It keeps its colour even when quiet: the colour is the
 * monitor's verdict, and a link that is down has to stay findable on a map
 * that has calmed everything else down.
 */
const LINK_INK: Record<MapInkWeight, MapLineInk> = {
  full: {
    width: 1.75,
    opacity: 0.95,
    haloWidth: 4,
    haloOpacity: 0.85,
    isColored: true,
  },
  quiet: {
    width: 1.05,
    opacity: 0.5,
    haloWidth: 2.8,
    haloOpacity: 0.6,
    isColored: true,
  },
};

const LINK_EMPHASIS: MapLineInk = {
  width: 2.4,
  opacity: 1,
  haloWidth: 5,
  haloOpacity: 1,
  isColored: true,
};

/*
 * The rule every layer shares: the thing being pointed at is drawn at its
 * loudest, whatever the map decided at rest; everything one hop from it is
 * drawn as though the map were calm; and everything else keeps the weight
 * the plan chose, on top of which the muted opacity is applied by the
 * renderer.
 */
const inkForRole: (
  table: Record<MapInkWeight, MapLineInk>,
  emphasis: MapLineInk,
  weight: MapInkWeight,
  role: MapRole,
) => MapLineInk = (
  table: Record<MapInkWeight, MapLineInk>,
  emphasis: MapLineInk,
  weight: MapInkWeight,
  role: MapRole,
): MapLineInk => {
  if (role === "active") {
    return emphasis;
  }
  if (role === "related") {
    return table["full"];
  }
  return table[weight];
};

export const positionLineInk: (
  weight: MapInkWeight,
  role: MapRole,
) => MapLineInk = (weight: MapInkWeight, role: MapRole): MapLineInk => {
  return inkForRole(POSITION_LINE_INK, POSITION_LINE_EMPHASIS, weight, role);
};

export const labelThreadInk: (
  weight: MapInkWeight,
  role: MapRole,
) => MapLineInk = (weight: MapInkWeight, role: MapRole): MapLineInk => {
  return inkForRole(LABEL_THREAD_INK, LABEL_THREAD_EMPHASIS, weight, role);
};

export const linkInk: (weight: MapInkWeight, role: MapRole) => MapLineInk = (
  weight: MapInkWeight,
  role: MapRole,
): MapLineInk => {
  return inkForRole(LINK_INK, LINK_EMPHASIS, weight, role);
};

/**
 * The pip on the far end of a position thread — the exact spot the marker
 * belongs to.
 *
 * Sized from the thread's own weight rather than from a constant of its
 * own, so the dot fades WITH the line. A full-strength full stop on the end
 * of a hairline reads as a marker in its own right, which is the one thing
 * this dot must never be mistaken for.
 *
 * At full weight the radii come out at exactly the 1.25 / 2.25 pair the map
 * has drawn since the leader lines shipped, so a calm map is the same
 * picture it always was. (The pip now carries its thread's opacity rather
 * than a flat 1, which on a 2px dot is a difference nobody can see and one
 * fewer constant that can drift.)
 */
export const positionAnchorDot: (ink: MapLineInk) => {
  radius: number;
  haloRadius: number;
} = (ink: MapLineInk): { radius: number; haloRadius: number } => {
  return { radius: ink.width, haloRadius: ink.width + 1 };
};

/*
 * ── The escape hatch ───────────────────────────────────────────────────
 *
 * Issue #3432 asked for a switch, and it gets one — three, in fact, one per
 * layer. The hierarchy above is what makes the DEFAULT map readable; these
 * are for the customer who wants a bare map of dots and knows what they are
 * giving up.
 *
 * Every layer defaults to ON, and an unreadable stored value reads as ON:
 * a map that came back from a stale localStorage entry with its names
 * missing is a bug report, not a preference.
 */
export type MapLayerKey = "names" | "links" | "positionLines";

export interface MapLayerSettings {
  names: boolean;
  links: boolean;
  positionLines: boolean;
}

export const DEFAULT_MAP_LAYERS: MapLayerSettings = {
  names: true,
  links: true,
  positionLines: true,
};

/*
 * One key for every map on the page — the choice is about how a reader
 * wants maps to look, not about which level they happen to be on, and a
 * preference that reset every time somebody drilled into a region would
 * read as a control that does not work.
 */
export const MAP_LAYERS_STORAGE_KEY: string = "oneuptime-network-map-layers";

export interface MapLayerOption {
  key: MapLayerKey;
  label: string;
  hint: string;
}

/*
 * In the order they matter to a reader who is turning things off: the names
 * are the map's content, the links are the network, and the position lines
 * are the bookkeeping that explains the other two.
 */
export const MAP_LAYER_OPTIONS: Array<MapLayerOption> = [
  {
    key: "names",
    label: "Site names",
    hint: "The name beside each marker.",
  },
  {
    key: "links",
    label: "Site links",
    hint: "The lines between connected sites.",
  },
  {
    key: "positionLines",
    label: "Position lines",
    hint: "The thread from a marker or a name back to the exact spot it belongs to.",
  },
];

const readLayerFlag: (
  source: Record<string, unknown>,
  key: string,
) => boolean = (source: Record<string, unknown>, key: string): boolean => {
  const value: unknown = source[key];
  return typeof value === "boolean" ? value : true;
};

/**
 * A stored preference, made safe to draw with.
 *
 * localStorage is shared with every other tab and survives every deploy, so
 * this is handed a value nobody in this build wrote: a string from an older
 * shape, a null, an array, an object with two of the three keys. All of it
 * reads as "show that layer", which is the only default that cannot hide
 * something a customer is looking for.
 */
export const normalizeMapLayers: (value: unknown) => MapLayerSettings = (
  value: unknown,
): MapLayerSettings => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_MAP_LAYERS };
  }
  const source: Record<string, unknown> = value as Record<string, unknown>;
  return {
    names: readLayerFlag(source, "names"),
    links: readLayerFlag(source, "links"),
    positionLines: readLayerFlag(source, "positionLines"),
  };
};

export const setMapLayer: (
  layers: MapLayerSettings,
  key: MapLayerKey,
  isVisible: boolean,
) => MapLayerSettings = (
  layers: MapLayerSettings,
  key: MapLayerKey,
  isVisible: boolean,
): MapLayerSettings => {
  return { ...layers, [key]: isVisible };
};

/*
 * How many layers are off — the badge on the control, so a map that is
 * missing its names says so without being opened.
 */
export const countHiddenMapLayers: (layers: MapLayerSettings) => number = (
  layers: MapLayerSettings,
): number => {
  return MAP_LAYER_OPTIONS.filter((option: MapLayerOption): boolean => {
    return !layers[option.key];
  }).length;
};

/*
 * ── The hover card ─────────────────────────────────────────────────────
 *
 * Marker and link tooltips are built as one line of " · "-joined parts, and
 * that line is also the marker's accessible name — which is exactly right
 * for a screen reader and exactly wrong for a card, where a twelve-word
 * grey sentence hides the one thing the reader wanted: the name.
 *
 * So the card splits it back apart. The name leads, in the page's text
 * colour; everything else follows as quieter detail.
 */
export interface MapTooltipText {
  title: string;
  detail: Array<string>;
}

const TOOLTIP_PART_SEPARATOR: string = " · ";
/*
 * Both tooltip builders put the subject first and qualify it after an em
 * dash — "Region 12 — Region", "Chicago fibre — No monitor attached" — so
 * the first dash in the first part is where the name ends.
 *
 * The trailing space is optional because the qualifier can be blank: a site
 * type is free text on a per-project row, and an empty one leaves the
 * tooltip ending on a dangling dash that has no business on a card.
 *
 * A site whose own name contains a dash loses its tail to the detail line.
 * It is still on the card, and threading a structured tooltip through every
 * caller to avoid that would buy nothing else.
 */
const TOOLTIP_TITLE_SEPARATOR: RegExp = new RegExp("\\s—\\s*");

export const splitMapTooltip: (tooltip: string) => MapTooltipText = (
  tooltip: string,
): MapTooltipText => {
  const text: string = (tooltip || "").trim();
  if (!text) {
    return { title: "", detail: [] };
  }

  const parts: Array<string> = text
    .split(TOOLTIP_PART_SEPARATOR)
    .map((part: string): string => {
      return part.trim();
    })
    .filter((part: string): boolean => {
      return part.length > 0;
    });

  const head: string = parts.shift() || text;
  const dash: RegExpExecArray | null = TOOLTIP_TITLE_SEPARATOR.exec(head);
  // A head that IS the qualifier has no name to lead with.
  if (!dash || dash.index <= 0) {
    return { title: head, detail: parts };
  }

  const tail: string = head.slice(dash.index + dash[0].length).trim();
  return {
    title: head.slice(0, dash.index).trim(),
    detail: tail ? [tail, ...parts] : parts,
  };
};
