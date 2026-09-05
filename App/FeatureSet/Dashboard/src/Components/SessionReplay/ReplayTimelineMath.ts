import {
  SESSION_REPLAY_ACTIVE_CHUNK_MIN_EVENTS,
  SessionReplayGap,
} from "Common/Types/Rum/SessionReplay";
import { ReplayIdleBand } from "./Engine/ReplayEngineTypes";
import {
  ReplaySignal,
  ReplaySignalKind,
  ReplaySignalSeverity,
} from "./Rail/ReplaySignalTypes";
import { formatReplayDuration, formatReplayOffset } from "./ReplayTimeFormat";

/*
 * Pure geometry and bookkeeping for the timeline: track bands, activity
 * heat, marker lanes, clustering, hover previews and prev/next stepping.
 * No React, no DOM, no rrweb - ReplayTimeline.tsx draws what this file
 * computes, and App/Tests/Dashboard/ReplayTimelineMath.test.ts pins it.
 *
 * INPUTS ARE CONTRACT SHAPES ONLY. Chunks are the manifest's per-chunk
 * rows (SessionReplayChunkManifestEntry is structurally a
 * ReplayTimelineChunkInput, so the player passes its entries straight
 * through), idle bands are the engine's ReplayIdleBand, markers come from
 * ReplaySignal rows. Two fidelities coexist on purpose: a COARSE marker is
 * drawn from a chunk's counters before that chunk is decoded (so the lane
 * is never blank at t=0), an EXACT marker from a decoded signal replaces
 * it the moment the chunk lands. Coarse markers are hollow, sit at the
 * chunk midpoint and say so in their title, because the old scrubber drew
 * them as solid ticks with a to-the-second time for a +-7.5s estimate.
 */

/* Subset of SessionReplayChunkManifestEntry the timeline reads. */
export interface ReplayTimelineChunkInput {
  chunkIndex: number;
  chunkStartOffsetMs: number;
  chunkEndOffsetMs: number;
  eventCount: number;
  /* Absent on manifests from before the column existed: never drawn as 0. */
  clickCount?: number | undefined;
  errorCount: number;
  rageClickCount: number;
  deadClickCount: number;
  errorClickCount: number;
  refreshRageCount: number;
  routeCount: number;
}

/* A playback-affecting fidelity notice pinned to a moment (finding 15). */
export interface ReplayTimelineNoticeInput {
  id: string;
  offsetMs: number;
  title: string;
}

/* ---- Percent helpers. ---- */

/*
 * Everything is positioned in percent rather than pixels so the lanes stay
 * aligned across container resizes without re-measuring; pixels only enter
 * for clustering, where the question is literally "do these overlap".
 */
export function clampOffset(offsetMs: number, durationMs: number): number {
  if (!Number.isFinite(offsetMs)) {
    return 0;
  }

  return Math.min(Math.max(0, durationMs), Math.max(0, offsetMs));
}

export function offsetToPercent(offsetMs: number, durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, (offsetMs / durationMs) * 100));
}

export function percentToOffset(percent: number, durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return 0;
  }

  return clampOffset((percent / 100) * durationMs, durationMs);
}

export function nudgeOffset(
  currentTimeMs: number,
  deltaMs: number,
  durationMs: number,
): number {
  return clampOffset(currentTimeMs + deltaMs, durationMs);
}

/* ---- Track bands. ---- */

export type ReplayTrackBandKind =
  | "loaded"
  | "available"
  | "gap"
  | "idle"
  | "background-tab";

export interface ReplayTrackBand {
  kind: ReplayTrackBandKind;
  startMs: number;
  endMs: number;
  /* Accessible name and inline label: "18s missing", "42s idle". */
  label: string;
  /* Idle bands only: coarse (from counters) or exact (from decoded events). */
  fidelity?: "coarse" | "exact" | undefined;
}

export interface ReplayTrackBandsInput {
  chunks: Array<ReplayTimelineChunkInput>;
  gaps?: Array<SessionReplayGap> | undefined;
  loadedChunkIndexes: Array<number>;
  idleBands?: Array<ReplayIdleBand> | undefined;
  durationMs: number;
}

function sortChunks(
  chunks: Array<ReplayTimelineChunkInput>,
): Array<ReplayTimelineChunkInput> {
  return [...chunks].sort(
    (a: ReplayTimelineChunkInput, b: ReplayTimelineChunkInput): number => {
      return a.chunkIndex - b.chunkIndex;
    },
  );
}

/*
 * Chunk coverage as loaded/available bands (adjacent same-state chunks
 * merged into one band so a 200-chunk session is not 200 divs), then the
 * manifest gaps, then the idle bands, in that order so later bands draw
 * over earlier ones. Everything is clipped to [0, durationMs]; a chunk
 * that ends past the duration (the finalizer clamps, the recorder does
 * not) is cut rather than pushing the track past 100%.
 */
export function buildTrackBands(
  input: ReplayTrackBandsInput,
): Array<ReplayTrackBand> {
  const durationMs: number = Math.max(0, input.durationMs);
  const loaded: Set<number> = new Set<number>(input.loadedChunkIndexes);
  const chunks: Array<ReplayTimelineChunkInput> = sortChunks(input.chunks);
  const bands: Array<ReplayTrackBand> = [];

  for (const chunk of chunks) {
    const startMs: number = clampOffset(chunk.chunkStartOffsetMs, durationMs);
    const endMs: number = clampOffset(chunk.chunkEndOffsetMs, durationMs);

    if (endMs <= startMs) {
      continue;
    }

    const kind: ReplayTrackBandKind = loaded.has(chunk.chunkIndex)
      ? "loaded"
      : "available";
    const previous: ReplayTrackBand | undefined = bands[bands.length - 1];

    if (previous && previous.kind === kind && previous.endMs >= startMs) {
      previous.endMs = Math.max(previous.endMs, endMs);
      previous.label = `${formatReplayDuration(
        previous.endMs - previous.startMs,
      )} ${kind === "loaded" ? "loaded" : "not yet loaded"}`;
      continue;
    }

    bands.push({
      kind: kind,
      startMs: startMs,
      endMs: endMs,
      label: `${formatReplayDuration(endMs - startMs)} ${
        kind === "loaded" ? "loaded" : "not yet loaded"
      }`,
    });
  }

  const byIndex: Map<number, ReplayTimelineChunkInput> = new Map<
    number,
    ReplayTimelineChunkInput
  >();

  for (const chunk of chunks) {
    byIndex.set(chunk.chunkIndex, chunk);
  }

  for (const gap of input.gaps || []) {
    const before: ReplayTimelineChunkInput | undefined = byIndex.get(
      gap.fromIndex,
    );
    const after: ReplayTimelineChunkInput | undefined = byIndex.get(
      gap.toIndex,
    );

    if (!before || !after) {
      continue;
    }

    const startMs: number = clampOffset(before.chunkEndOffsetMs, durationMs);
    const endMs: number = clampOffset(after.chunkStartOffsetMs, durationMs);

    if (endMs <= startMs) {
      continue;
    }

    /*
     * The manifest's missingMs is the authoritative size (chunk bounds can
     * overlap by a few ms); the band's geometry is still the visible hole.
     */
    const missingMs: number =
      Number.isFinite(gap.missingMs) && gap.missingMs > 0
        ? gap.missingMs
        : endMs - startMs;

    bands.push({
      kind: "gap",
      startMs: startMs,
      endMs: endMs,
      label: `${formatReplayDuration(missingMs)} missing`,
    });
  }

  for (const band of input.idleBands || []) {
    const startMs: number = clampOffset(band.startMs, durationMs);
    const endMs: number = clampOffset(band.endMs, durationMs);

    if (endMs <= startMs) {
      continue;
    }

    const lengthLabel: string = formatReplayDuration(endMs - startMs);

    bands.push({
      kind: band.kind === "background-tab" ? "background-tab" : "idle",
      startMs: startMs,
      endMs: endMs,
      label:
        band.kind === "background-tab"
          ? `tab in background ${lengthLabel}`
          : `${lengthLabel} idle`,
      fidelity: band.fidelity,
    });
  }

  return bands;
}

/* ---- Activity heat. ---- */

export interface ReplayActivityBucket {
  chunkIndex: number;
  startMs: number;
  endMs: number;
  /* 0..1 relative to the busiest chunk of the session. */
  intensity: number;
  /*
   * False when nothing in the session carries a count (an empty manifest,
   * or every chunk at 0): the lane is then drawn flat, not as "quiet".
   */
  isMeasured: boolean;
}

/*
 * One bucket per chunk. eventCount is the rrweb stream (mutations, mouse
 * moves, everything), clickCount the human's clicks; when the manifest
 * carries clicks they take 40% of the weight, because a page that
 * re-renders on a timer produces mutations by the thousand with nobody
 * there. A chunk at or below the "provisionally idle" event threshold
 * reads as 0 regardless, matching the coarse idle band the engine draws
 * for the same chunk.
 */
export function buildActivityHeat(
  chunks: Array<ReplayTimelineChunkInput>,
  durationMs: number,
): Array<ReplayActivityBucket> {
  const sorted: Array<ReplayTimelineChunkInput> = sortChunks(chunks);
  let maxEvents: number = 0;
  let maxClicks: number = 0;
  let hasClickCounts: boolean = false;

  for (const chunk of sorted) {
    maxEvents = Math.max(maxEvents, Math.max(0, chunk.eventCount || 0));

    if (typeof chunk.clickCount === "number" && chunk.clickCount >= 0) {
      hasClickCounts = true;
      maxClicks = Math.max(maxClicks, chunk.clickCount);
    }
  }

  const isMeasured: boolean = maxEvents > 0 || maxClicks > 0;

  return sorted.map((chunk: ReplayTimelineChunkInput): ReplayActivityBucket => {
    const events: number = Math.max(0, chunk.eventCount || 0);
    const clicks: number =
      typeof chunk.clickCount === "number" ? Math.max(0, chunk.clickCount) : 0;

    let intensity: number = 0;

    if (isMeasured && events >= SESSION_REPLAY_ACTIVE_CHUNK_MIN_EVENTS) {
      const eventPart: number = maxEvents > 0 ? events / maxEvents : 0;

      if (hasClickCounts && maxClicks > 0) {
        intensity = 0.6 * eventPart + 0.4 * (clicks / maxClicks);
      } else {
        intensity = eventPart;
      }
    } else if (isMeasured && clicks > 0 && maxClicks > 0) {
      /* Few rrweb events but a click happened: a human was there. */
      intensity = 0.4 * (clicks / maxClicks);
    }

    return {
      chunkIndex: chunk.chunkIndex,
      startMs: clampOffset(chunk.chunkStartOffsetMs, durationMs),
      endMs: clampOffset(chunk.chunkEndOffsetMs, durationMs),
      intensity: Math.min(1, Math.max(0, intensity)),
      isMeasured: isMeasured,
    };
  });
}

/* ---- Markers. ---- */

/*
 * Three clustered lanes under the track, plus "track" for notices drawn
 * on the recording band itself.
 */
export type ReplayTimelineLane = "errors" | "network" | "navigation" | "track";

export const REPLAY_TIMELINE_LANES: ReadonlyArray<ReplayTimelineLane> = [
  "errors",
  "network",
  "navigation",
];

export const REPLAY_TIMELINE_LANE_LABELS: Record<ReplayTimelineLane, string> = {
  errors: "Errors",
  network: "Network",
  navigation: "Nav / clicks",
  track: "Recording",
};

/*
 * Colour is a tone name, not a Tailwind class, so the math stays free of
 * presentation and the component owns the palette in one table.
 */
export type ReplayTimelineMarkerTone =
  | "rose"
  | "rose-outline"
  | "rose-dot"
  | "amber"
  | "orange"
  | "sky"
  | "gray";

export interface ReplayTimelineMarker {
  id: string;
  lane: ReplayTimelineLane;
  offsetMs: number;
  kind: ReplaySignalKind | "notice";
  severity: ReplaySignalSeverity;
  /* Tooltip text; already carries the formatted time. */
  title: string;
  tone: ReplayTimelineMarkerTone;
  fidelity: "exact" | "coarse";
  /*
   * Hollow = the position is not exact: a coarse counter marker at the
   * chunk midpoint, or an unanchored telemetry row placed by server time.
   */
  isHollow: boolean;
  /* The rail row this marker selects on click; coarse markers have none. */
  signalId?: string | undefined;
  chunkIndex?: number | undefined;
}

function readNumber(
  detail: Record<string, unknown>,
  key: string,
): number | null {
  const value: unknown = detail[key];

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(detail: Record<string, unknown>, key: string): boolean {
  return detail[key] === true;
}

function markerTitle(signal: ReplaySignal): string {
  const time: string = formatReplayOffset(signal.offsetMs);
  const base: string = `${time} ${signal.title}`;

  if (signal.alignment === "unanchored") {
    return `${base} (server time; not aligned to the recording clock)`;
  }

  return base;
}

/*
 * Lane assignment per kind and severity. Anything not listed (console
 * rows, plain interactions, custom events, performance rows) stays off
 * the timeline: the lanes answer "where did it go wrong", the rail
 * answers "what happened".
 */
export function assignMarkerLane(
  signal: ReplaySignal,
): { lane: ReplayTimelineLane; tone: ReplayTimelineMarkerTone } | null {
  switch (signal.kind) {
    case "client-error":
      return { lane: "errors", tone: "rose" };
    case "server-error":
      return { lane: "errors", tone: "rose-outline" };
    case "log":
      return signal.severity === "error"
        ? { lane: "errors", tone: "rose-dot" }
        : null;
    case "network": {
      const status: number | null = readNumber(signal.detail, "status");
      const isFailed: boolean =
        readBoolean(signal.detail, "isError") || signal.severity === "error";

      if (status !== null && status >= 500) {
        return { lane: "network", tone: "rose" };
      }

      if (status !== null && status >= 400) {
        return { lane: "network", tone: "amber" };
      }

      if (isFailed) {
        return { lane: "network", tone: "rose" };
      }

      /* A slow-but-successful request: the adapter marks it warn. */
      if (signal.severity === "warn") {
        return { lane: "network", tone: "orange" };
      }

      return null;
    }
    case "span":
      return signal.severity === "error"
        ? { lane: "network", tone: "rose-outline" }
        : null;
    case "navigation":
      return { lane: "navigation", tone: "sky" };
    case "frustration":
      return { lane: "navigation", tone: "amber" };
    default:
      return null;
  }
}

export function buildExactMarkers(
  signals: Array<ReplaySignal>,
): Array<ReplayTimelineMarker> {
  const markers: Array<ReplayTimelineMarker> = [];

  for (const signal of signals) {
    const placement: {
      lane: ReplayTimelineLane;
      tone: ReplayTimelineMarkerTone;
    } | null = assignMarkerLane(signal);

    if (!placement || !Number.isFinite(signal.offsetMs)) {
      continue;
    }

    markers.push({
      id: `exact:${signal.id}`,
      lane: placement.lane,
      offsetMs: Math.max(0, signal.offsetMs),
      kind: signal.kind,
      severity: signal.severity,
      title: markerTitle(signal),
      tone: placement.tone,
      fidelity: "exact",
      isHollow: signal.alignment === "unanchored",
      signalId: signal.id,
      chunkIndex: signal.chunkIndex,
    });
  }

  return markers;
}

/*
 * Only the non-zero counters, so one dead click reads "1 dead click" and
 * not "0 rage · 1 dead · 0 error clicks · 0 refresh rage" (finding 22).
 */
export function describeFrustrationCounters(
  chunk: ReplayTimelineChunkInput,
): string | null {
  const parts: Array<string> = [];

  const push: (count: number, singular: string, plural: string) => void = (
    count: number,
    singular: string,
    plural: string,
  ): void => {
    if (count > 0) {
      parts.push(`${count} ${count === 1 ? singular : plural}`);
    }
  };

  push(chunk.rageClickCount, "rage click", "rage clicks");
  push(chunk.deadClickCount, "dead click", "dead clicks");
  push(chunk.errorClickCount, "error click", "error clicks");
  push(chunk.refreshRageCount, "refresh rage", "refresh rages");

  return parts.length > 0 ? parts.join(" · ") : null;
}

const COARSE_SUFFIX: string = "approximate, chunk not loaded yet";

function coarseTitle(
  chunk: ReplayTimelineChunkInput,
  midpointMs: number,
  what: string,
): string {
  const windowLabel: string = formatReplayDuration(
    Math.max(0, chunk.chunkEndOffsetMs - chunk.chunkStartOffsetMs),
  );

  return `~${formatReplayOffset(
    midpointMs,
  )} ${what} in this ${windowLabel} chunk (${COARSE_SUFFIX})`;
}

/*
 * Counter-derived markers for chunks that are NOT decoded yet. A loaded
 * chunk's counters are ignored here because its exact signals already
 * cover the lane; that is the coarse->exact replacement.
 */
export function buildCoarseMarkers(
  chunks: Array<ReplayTimelineChunkInput>,
  loadedChunkIndexes: Array<number>,
  durationMs: number,
): Array<ReplayTimelineMarker> {
  const loaded: Set<number> = new Set<number>(loadedChunkIndexes);
  const markers: Array<ReplayTimelineMarker> = [];

  for (const chunk of sortChunks(chunks)) {
    if (loaded.has(chunk.chunkIndex)) {
      continue;
    }

    const midpointMs: number = clampOffset(
      (chunk.chunkStartOffsetMs + chunk.chunkEndOffsetMs) / 2,
      durationMs,
    );

    if (chunk.errorCount > 0) {
      markers.push({
        id: `coarse:errors:${chunk.chunkIndex}`,
        lane: "errors",
        offsetMs: midpointMs,
        kind: "client-error",
        severity: "error",
        title: coarseTitle(
          chunk,
          midpointMs,
          `${chunk.errorCount} ${chunk.errorCount === 1 ? "error" : "errors"}`,
        ),
        tone: "rose",
        fidelity: "coarse",
        isHollow: true,
        chunkIndex: chunk.chunkIndex,
      });
    }

    const frustration: string | null = describeFrustrationCounters(chunk);

    if (frustration) {
      markers.push({
        id: `coarse:frustration:${chunk.chunkIndex}`,
        lane: "navigation",
        offsetMs: midpointMs,
        kind: "frustration",
        severity: "warn",
        title: coarseTitle(chunk, midpointMs, frustration),
        tone: "amber",
        fidelity: "coarse",
        isHollow: true,
        chunkIndex: chunk.chunkIndex,
      });
    }

    if (chunk.routeCount > 0) {
      markers.push({
        id: `coarse:routes:${chunk.chunkIndex}`,
        lane: "navigation",
        offsetMs: midpointMs,
        kind: "navigation",
        severity: "info",
        title: coarseTitle(
          chunk,
          midpointMs,
          `${chunk.routeCount} ${
            chunk.routeCount === 1 ? "route change" : "route changes"
          }`,
        ),
        tone: "sky",
        fidelity: "coarse",
        isHollow: true,
        chunkIndex: chunk.chunkIndex,
      });
    }
  }

  return markers;
}

export function buildNoticeMarkers(
  notices: Array<ReplayTimelineNoticeInput>,
  durationMs: number,
): Array<ReplayTimelineMarker> {
  return notices
    .filter((notice: ReplayTimelineNoticeInput): boolean => {
      return Number.isFinite(notice.offsetMs);
    })
    .map((notice: ReplayTimelineNoticeInput): ReplayTimelineMarker => {
      const offsetMs: number = clampOffset(notice.offsetMs, durationMs);

      return {
        id: `notice:${notice.id}`,
        lane: "track",
        offsetMs: offsetMs,
        kind: "notice",
        severity: "warn",
        title: `${formatReplayOffset(offsetMs)} ${notice.title}`,
        tone: "gray",
        fidelity: "exact",
        isHollow: false,
      };
    });
}

export interface ReplayTimelineMarkersInput {
  signals: Array<ReplaySignal>;
  chunks: Array<ReplayTimelineChunkInput>;
  loadedChunkIndexes: Array<number>;
  notices?: Array<ReplayTimelineNoticeInput> | undefined;
  durationMs: number;
}

/* Exact markers first, coarse for undecoded chunks, notices on the track. */
export function buildTimelineMarkers(
  input: ReplayTimelineMarkersInput,
): Array<ReplayTimelineMarker> {
  const markers: Array<ReplayTimelineMarker> = [
    ...buildExactMarkers(input.signals),
    ...buildCoarseMarkers(
      input.chunks,
      input.loadedChunkIndexes,
      input.durationMs,
    ),
    ...buildNoticeMarkers(input.notices || [], input.durationMs),
  ];

  return sortMarkers(markers);
}

export function sortMarkers(
  markers: Array<ReplayTimelineMarker>,
): Array<ReplayTimelineMarker> {
  return [...markers].sort(
    (a: ReplayTimelineMarker, b: ReplayTimelineMarker): number => {
      if (a.offsetMs !== b.offsetMs) {
        return a.offsetMs - b.offsetMs;
      }

      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    },
  );
}

export function getMarkersForLane(
  markers: Array<ReplayTimelineMarker>,
  lane: ReplayTimelineLane,
): Array<ReplayTimelineMarker> {
  return markers.filter((marker: ReplayTimelineMarker): boolean => {
    return marker.lane === lane;
  });
}

/* What "next error" steps through: the Errors lane, exact and coarse. */
export function getErrorMarkers(
  markers: Array<ReplayTimelineMarker>,
): Array<ReplayTimelineMarker> {
  return getMarkersForLane(markers, "errors");
}

/* What "next frustration" steps through. */
export function getFrustrationMarkers(
  markers: Array<ReplayTimelineMarker>,
): Array<ReplayTimelineMarker> {
  return markers.filter((marker: ReplayTimelineMarker): boolean => {
    return marker.kind === "frustration";
  });
}

/* ---- Clustering. ---- */

export const REPLAY_CLUSTER_THRESHOLD_PX: number = 6;

export interface ReplayMarkerCluster {
  id: string;
  lane: ReplayTimelineLane;
  /* The first marker's offset; clicking the pill seeks here. */
  offsetMs: number;
  /* The last marker's offset, for the span line behind a wide cluster. */
  endOffsetMs: number;
  markers: Array<ReplayTimelineMarker>;
  count: number;
}

/*
 * Merge ticks that would overlap at the given width into count pills. A
 * marker joins the open cluster when it sits within thresholdPx of the
 * cluster's LAST member, so a polling endpoint failing every 2s for 20
 * minutes becomes one "600" pill rather than an opaque orange bar of 600
 * unclickable buttons (finding 14). Markers must be one lane's.
 */
export function clusterMarkers(
  markers: Array<ReplayTimelineMarker>,
  durationMs: number,
  widthPx: number,
  thresholdPx: number = REPLAY_CLUSTER_THRESHOLD_PX,
): Array<ReplayMarkerCluster> {
  const sorted: Array<ReplayTimelineMarker> = sortMarkers(markers);
  const clusters: Array<ReplayMarkerCluster> = [];
  const safeWidth: number =
    Number.isFinite(widthPx) && widthPx > 0 ? widthPx : 1;

  const toPx: (offsetMs: number) => number = (offsetMs: number): number => {
    return (offsetToPercent(offsetMs, durationMs) / 100) * safeWidth;
  };

  for (const marker of sorted) {
    const open: ReplayMarkerCluster | undefined = clusters[clusters.length - 1];

    if (
      open &&
      open.lane === marker.lane &&
      toPx(marker.offsetMs) - toPx(open.endOffsetMs) <= thresholdPx
    ) {
      open.markers.push(marker);
      open.count += 1;
      open.endOffsetMs = marker.offsetMs;
      continue;
    }

    clusters.push({
      id: `cluster:${marker.lane}:${marker.id}`,
      lane: marker.lane,
      offsetMs: marker.offsetMs,
      endOffsetMs: marker.offsetMs,
      markers: [marker],
      count: 1,
    });
  }

  return clusters;
}

export const REPLAY_CLUSTER_TITLE_LIMIT: number = 5;

/* Tooltip for a pill: the first five, then "and N more". */
export function describeCluster(cluster: ReplayMarkerCluster): string {
  const lines: Array<string> = cluster.markers
    .slice(0, REPLAY_CLUSTER_TITLE_LIMIT)
    .map((marker: ReplayTimelineMarker): string => {
      return marker.title;
    });

  const remaining: number = cluster.count - lines.length;

  if (remaining > 0) {
    lines.push(`and ${remaining} more`);
  }

  return lines.join("\n");
}

/* ---- Stepping. ---- */

/* Marker clicks land a second early so the viewer sees the cause. */
export const REPLAY_MARKER_PRE_ROLL_MS: number = 1000;

/*
 * "Next" searches strictly after currentTime + this. After a jump the
 * playhead sits at marker - 1000, which is inside this window, so the
 * next press advances instead of re-finding the same marker (finding 2 /
 * player-shell-1). Wider than the pre-roll by 500ms to absorb the
 * engine's snapshot rounding.
 */
export const REPLAY_MARKER_NEXT_TOLERANCE_MS: number = 1500;

/*
 * "Previous" searches strictly before currentTime - this. Small on
 * purpose: a viewer half a second past an error who presses Shift+E
 * wants THAT error again, not the one before it.
 */
export const REPLAY_MARKER_PREV_TOLERANCE_MS: number = 250;

export function markerSeekTarget(marker: ReplayTimelineMarker): number {
  return Math.max(0, marker.offsetMs - REPLAY_MARKER_PRE_ROLL_MS);
}

export function findNextMarker(
  markers: Array<ReplayTimelineMarker>,
  currentTimeMs: number,
  toleranceMs: number = REPLAY_MARKER_NEXT_TOLERANCE_MS,
): ReplayTimelineMarker | null {
  let best: ReplayTimelineMarker | null = null;

  for (const marker of markers) {
    if (marker.offsetMs > currentTimeMs + toleranceMs) {
      if (!best || marker.offsetMs < best.offsetMs) {
        best = marker;
      }
    }
  }

  return best;
}

export function findPrevMarker(
  markers: Array<ReplayTimelineMarker>,
  currentTimeMs: number,
  toleranceMs: number = REPLAY_MARKER_PREV_TOLERANCE_MS,
): ReplayTimelineMarker | null {
  let best: ReplayTimelineMarker | null = null;

  for (const marker of markers) {
    if (marker.offsetMs < currentTimeMs - toleranceMs) {
      if (!best || marker.offsetMs > best.offsetMs) {
        best = marker;
      }
    }
  }

  return best;
}

/* ---- Hover preview. ---- */

export const REPLAY_PREVIEW_WINDOW_MS: number = 2000;
export const REPLAY_PREVIEW_SIGNAL_LIMIT: number = 2;

export interface ReplayTimelinePreview {
  offsetMs: number;
  /* The route the page was on at this moment, from the latest navigation. */
  route: string | null;
  /* Up to two signals within +-REPLAY_PREVIEW_WINDOW_MS, nearest first. */
  signals: Array<ReplaySignal>;
}

function navigationLabel(signal: ReplaySignal): string {
  const to: unknown = signal.detail["to"];

  if (typeof to === "string" && to.length > 0) {
    return to;
  }

  return signal.title;
}

export function buildHoverPreview(
  signals: Array<ReplaySignal>,
  offsetMs: number,
  windowMs: number = REPLAY_PREVIEW_WINDOW_MS,
  limit: number = REPLAY_PREVIEW_SIGNAL_LIMIT,
): ReplayTimelinePreview {
  let route: ReplaySignal | null = null;
  const nearby: Array<ReplaySignal> = [];

  for (const signal of signals) {
    if (signal.kind === "navigation" && signal.offsetMs <= offsetMs) {
      if (!route || signal.offsetMs >= route.offsetMs) {
        route = signal;
      }
    }

    if (Math.abs(signal.offsetMs - offsetMs) <= windowMs) {
      nearby.push(signal);
    }
  }

  nearby.sort((a: ReplaySignal, b: ReplaySignal): number => {
    return Math.abs(a.offsetMs - offsetMs) - Math.abs(b.offsetMs - offsetMs);
  });

  return {
    offsetMs: offsetMs,
    route: route ? navigationLabel(route) : null,
    signals: nearby.slice(0, Math.max(0, limit)),
  };
}
