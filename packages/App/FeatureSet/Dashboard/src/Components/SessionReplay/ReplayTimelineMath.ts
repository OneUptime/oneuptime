import {
  SESSION_REPLAY_ACTIVE_CHUNK_MIN_EVENTS,
  SessionReplayGap,
} from "Common/Types/Rum/SessionReplay";
import {
  ComposedValue,
  composedValue,
  createTranslator,
  DEFAULT_LANGUAGE,
  formatInline,
  PluralTemplate,
  TemplateValues,
  translationKey,
  Translator,
} from "Common/Types/Translator";
import { formatDurationCompactInLanguage } from "Common/Utils/Slo/SloDuration";
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
 *
 * WORDS. Every sentence this file writes is in the reader's language when
 * the caller hands its Translator in (the player passes useTranslator()),
 * and in English, word for word as it always was, without one - what a
 * node test gets. A band's label is worded again where the timeline draws
 * it (describeTrackBandLabel), from the length the band carries, so the
 * sentence that names the band and the label inside it are always in one
 * language.
 */

const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

function isEnglish(translator: Translator): boolean {
  return (translator.language || DEFAULT_LANGUAGE)
    .toLowerCase()
    .startsWith(DEFAULT_LANGUAGE);
}

/*
 * A length of time as formatReplayDuration writes it ("18s", "1m 12s",
 * "2h 5m"), in the translator's language: word for word in English, and in
 * the units another language abbreviates with ("18 Sek.", "1 Min., 12
 * Sek.") through formatDurationCompactInLanguage. Inside a sentence it goes
 * in as a composedValue, so it is written in the sentence's language.
 */
export function formatReplayDurationInLanguage(
  durationMs: number,
  translator: Translator = ENGLISH,
): string {
  if (isEnglish(translator)) {
    return formatReplayDuration(durationMs);
  }

  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return formatDurationCompactInLanguage(0, translator.language);
  }

  const totalSeconds: number = Math.round(durationMs / 1000);

  /* "<1s": a stretch that exists is never labelled as nothing. */
  if (totalSeconds < 1) {
    return `<${formatDurationCompactInLanguage(1, translator.language)}`;
  }

  return formatDurationCompactInLanguage(totalSeconds, translator.language);
}

/* The same length, as a value of a sentence: in the sentence's language. */
function durationValue(durationMs: number): ComposedValue {
  return composedValue((sentence: Translator): string => {
    return formatReplayDurationInLanguage(durationMs, sentence);
  });
}

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
  /*
   * The application's own signals (issue #6443): every hit, and the hits
   * that counted as frustration. Absent from an older server: none drawn.
   */
  customSignalCount?: number | undefined;
  customSignalFrustrationCount?: number | undefined;
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
  | "background-tab"
  /* The recorder paused capture because nobody touched the page. */
  | "paused";

export interface ReplayTrackBand {
  kind: ReplayTrackBandKind;
  startMs: number;
  endMs: number;
  /*
   * Accessible name and inline label: "18s missing", "42s idle",
   * "23m paused". In English: the timeline draws a gap, idle,
   * background-tab or paused band's label in the reader's language from
   * lengthMs (describeTrackBandLabel), and draws no loaded or available
   * band's label at all.
   */
  label: string;
  /*
   * The length the label states: the manifest's missingMs for a gap, the
   * clipped stretch for an idle, background-tab or paused band. Absent on
   * a loaded or available band, and on a band built before it existed,
   * whose label is then drawn as given.
   */
  lengthMs?: number | undefined;
  /*
   * Idle, background-tab and paused bands only: coarse (from counters) or
   * exact (from decoded events). Paused bands are always exact.
   */
  fidelity?: "coarse" | "exact" | undefined;
}

/* The bands drawn full height over the track, each with a label. */
export type ReplayTrackLabelledBandKind = Exclude<
  ReplayTrackBandKind,
  "loaded" | "available"
>;

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
      label: describeTrackBandLabel("gap", missingMs),
      lengthMs: missingMs,
    });
  }

  for (const band of input.idleBands || []) {
    const startMs: number = clampOffset(band.startMs, durationMs);
    const endMs: number = clampOffset(band.endMs, durationMs);

    if (endMs <= startMs) {
      continue;
    }

    bands.push({
      kind: band.kind,
      startMs: startMs,
      endMs: endMs,
      label: describeTrackBandLabel(band.kind, endMs - startMs),
      lengthMs: endMs - startMs,
      fidelity: band.fidelity,
    });
  }

  return bands;
}

/*
 * The inline label of a full-height band, by kind: "18s missing", "tab in
 * background 5s", "23m paused", "42s idle". A paused stretch is named for
 * what it is - capture stopped - rather than as idle: there is nothing in
 * it to watch, and playback jumps it. In the translator's language, its
 * length too; English without one.
 */
export function describeTrackBandLabel(
  kind: ReplayTrackLabelledBandKind,
  lengthMs: number,
  translator: Translator = ENGLISH,
): string {
  const values: TemplateValues = { duration: durationValue(lengthMs) };

  switch (kind) {
    case "gap":
      return translator.translateTemplate("{{duration}} missing", values);
    case "background-tab":
      return translator.translateTemplate(
        "tab in background {{duration}}",
        values,
      );
    case "paused":
      return translator.translateTemplate("{{duration}} paused", values);
    case "idle":
      return translator.translateTemplate("{{duration}} idle", values);
    default: {
      /* Exhaustiveness: a new band kind needs its own words. */
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

/*
 * A band's label as the timeline draws it: worded from its length in the
 * translator's language, or as given when the band carries no length.
 */
export function describeTrackBand(
  band: ReplayTrackBand,
  translator: Translator = ENGLISH,
): string {
  if (
    band.kind === "loaded" ||
    band.kind === "available" ||
    typeof band.lengthMs !== "number"
  ) {
    return band.label;
  }

  return describeTrackBandLabel(band.kind, band.lengthMs, translator);
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

/* English keys: the timeline looks each one up where it draws it. */
export const REPLAY_TIMELINE_LANE_LABELS: Record<ReplayTimelineLane, string> = {
  errors: translationKey("Errors"),
  network: translationKey("Network"),
  navigation: translationKey("Nav / clicks"),
  track: translationKey("Recording"),
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

/*
 * "0:37 TypeError: x is undefined": the time, then the signal's own title
 * as the rail wrote it. An unanchored row says it is placed by server time.
 */
function markerTitle(signal: ReplaySignal, translator: Translator): string {
  const time: string = formatReplayOffset(signal.offsetMs);

  if (signal.alignment === "unanchored") {
    return translator.translateTemplate(
      "{{time}} {{title}} (server time; not aligned to the recording clock)",
      { time: time, title: signal.title },
    );
  }

  return `${time} ${signal.title}`;
}

/*
 * Lane assignment per kind and severity. Anything not listed (console
 * rows, plain interactions, the page's own track() events, performance
 * rows) stays off the timeline: the lanes answer "where did it go wrong",
 * the rail answers "what happened". The application's own signals are the
 * exception among custom rows - the customer named them to be found.
 */
export function assignMarkerLane(
  signal: ReplaySignal,
): { lane: ReplayTimelineLane; tone: ReplayTimelineMarkerTone } | null {
  switch (signal.kind) {
    case "client-error": {
      /*
       * A subresource that failed to load belongs in the network lane, in
       * amber: the recorder keeps resource failures out of its trigger
       * counts, and drawing a 404 image as a rose error tick sent viewers
       * hunting a crash that never happened. The recorder's own "capture
       * stopped" marker is not an error either and gets no tick at all -
       * the rail carries it as a notice row.
       */
      if (readBoolean(signal.detail, "isCapMarker")) {
        return null;
      }

      if (signal.detail["kind"] === "resource") {
        return { lane: "network", tone: "amber" };
      }

      return { lane: "errors", tone: "rose" };
    }
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
    case "custom":
      /*
       * One of the application's own signals that only marks the moment
       * (issue #6443): a grey tick beside the clicks, where a frustrating
       * one is amber. The page's own track() events stay off the timeline.
       */
      return signal.detail["customSignalTrigger"]
        ? { lane: "navigation", tone: "gray" }
        : null;
    default:
      return null;
  }
}

export function buildExactMarkers(
  signals: Array<ReplaySignal>,
  translator: Translator = ENGLISH,
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
      title: markerTitle(signal, translator),
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
 * Each count in the translator's plural, set off from the next the way
 * its language does (formatInline).
 */
export function describeFrustrationCounters(
  chunk: ReplayTimelineChunkInput,
  translator: Translator = ENGLISH,
): string | null {
  const parts: Array<string> = [];

  const push: (count: number, template: PluralTemplate) => void = (
    count: number,
    template: PluralTemplate,
  ): void => {
    if (count > 0) {
      parts.push(translator.translatePlural(template, count));
    }
  };

  push(chunk.rageClickCount, {
    one: "{{count}} rage click",
    other: "{{count}} rage clicks",
  });
  push(chunk.deadClickCount, {
    one: "{{count}} dead click",
    other: "{{count}} dead clicks",
  });
  push(chunk.errorClickCount, {
    one: "{{count}} error click",
    other: "{{count}} error clicks",
  });
  push(chunk.refreshRageCount, {
    one: "{{count}} refresh rage",
    other: "{{count}} refresh rages",
  });
  push(chunk.customSignalFrustrationCount ?? 0, {
    one: "{{count}} signal of your own",
    other: "{{count}} signals of your own",
  });

  return parts.length > 0 ? formatInline(parts, translator) : null;
}

/*
 * What every coarse title puts around its count: "~1:07" (where the
 * marker sits) and the chunk's length ("15s"), in the sentence's language.
 */
function coarseValues(
  chunk: ReplayTimelineChunkInput,
  midpointMs: number,
): TemplateValues {
  return {
    time: formatReplayOffset(midpointMs),
    window: durationValue(
      Math.max(0, chunk.chunkEndOffsetMs - chunk.chunkStartOffsetMs),
    ),
  };
}

/*
 * Counter-derived markers for chunks that are NOT decoded yet. A loaded
 * chunk's counters are ignored here because its exact signals already
 * cover the lane; that is the coarse->exact replacement.
 *
 * The title is one whole sentence per counter, its count and noun worded
 * together: "~1:07 2 errors in this 15s chunk (approximate, chunk not
 * loaded yet)".
 */
export function buildCoarseMarkers(
  chunks: Array<ReplayTimelineChunkInput>,
  loadedChunkIndexes: Array<number>,
  durationMs: number,
  translator: Translator = ENGLISH,
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
    const values: TemplateValues = coarseValues(chunk, midpointMs);

    if (chunk.errorCount > 0) {
      markers.push({
        id: `coarse:errors:${chunk.chunkIndex}`,
        lane: "errors",
        offsetMs: midpointMs,
        kind: "client-error",
        severity: "error",
        title: translator.translatePlural(
          {
            one: "~{{time}} {{count}} error in this {{window}} chunk (approximate, chunk not loaded yet)",
            other:
              "~{{time}} {{count}} errors in this {{window}} chunk (approximate, chunk not loaded yet)",
          },
          chunk.errorCount,
          values,
        ),
        tone: "rose",
        fidelity: "coarse",
        isHollow: true,
        chunkIndex: chunk.chunkIndex,
      });
    }

    if (describeFrustrationCounters(chunk) !== null) {
      markers.push({
        id: `coarse:frustration:${chunk.chunkIndex}`,
        lane: "navigation",
        offsetMs: midpointMs,
        kind: "frustration",
        severity: "warn",
        /* Several counts: a list, worded in the sentence's language. */
        title: translator.translateTemplate(
          "~{{time}} {{counts}} in this {{window}} chunk (approximate, chunk not loaded yet)",
          {
            ...values,
            counts: composedValue((sentence: Translator): string => {
              return describeFrustrationCounters(chunk, sentence) || "";
            }),
          },
        ),
        tone: "amber",
        fidelity: "coarse",
        isHollow: true,
        chunkIndex: chunk.chunkIndex,
      });
    }

    /*
     * The application's own signals that only mark the moment (issue
     * #6443): the frustrating ones are already in the amber marker above.
     */
    const markerSignalCount: number = Math.max(
      0,
      (chunk.customSignalCount ?? 0) -
        (chunk.customSignalFrustrationCount ?? 0),
    );

    if (markerSignalCount > 0) {
      markers.push({
        id: `coarse:signals:${chunk.chunkIndex}`,
        lane: "navigation",
        offsetMs: midpointMs,
        kind: "custom",
        severity: "info",
        title: translator.translatePlural(
          {
            one: "~{{time}} {{count}} signal of your own in this {{window}} chunk (approximate, chunk not loaded yet)",
            other:
              "~{{time}} {{count}} signals of your own in this {{window}} chunk (approximate, chunk not loaded yet)",
          },
          markerSignalCount,
          values,
        ),
        tone: "gray",
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
        title: translator.translatePlural(
          {
            one: "~{{time}} {{count}} route change in this {{window}} chunk (approximate, chunk not loaded yet)",
            other:
              "~{{time}} {{count}} route changes in this {{window}} chunk (approximate, chunk not loaded yet)",
          },
          chunk.routeCount,
          values,
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

/*
 * Exact markers first, coarse for undecoded chunks, notices on the track.
 * Their titles in the translator's language: the player passes its own.
 */
export function buildTimelineMarkers(
  input: ReplayTimelineMarkersInput,
  translator: Translator = ENGLISH,
): Array<ReplayTimelineMarker> {
  const markers: Array<ReplayTimelineMarker> = [
    ...buildExactMarkers(input.signals, translator),
    ...buildCoarseMarkers(
      input.chunks,
      input.loadedChunkIndexes,
      input.durationMs,
      translator,
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

/*
 * Tooltip for a pill: the first five, then "and N more" in the
 * translator's language.
 */
export function describeCluster(
  cluster: ReplayMarkerCluster,
  translator: Translator = ENGLISH,
): string {
  const lines: Array<string> = cluster.markers
    .slice(0, REPLAY_CLUSTER_TITLE_LIMIT)
    .map((marker: ReplayTimelineMarker): string => {
      return marker.title;
    });

  const remaining: number = cluster.count - lines.length;

  if (remaining > 0) {
    lines.push(
      translator.translatePlural(
        { one: "and {{count}} more", other: "and {{count}} more" },
        remaining,
      ),
    );
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
