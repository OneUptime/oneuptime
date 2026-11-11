import { describe, expect, test } from "@jest/globals";
import { createTranslator, Translator } from "Common/Types/Translator";
import { formatDurationCompactInLanguage } from "Common/Utils/Slo/SloDuration";
import { ReplaySignal } from "../../FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplaySignalTypes";
import { formatReplayDuration } from "../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTimeFormat";
import {
  REPLAY_TIMELINE_LANE_LABELS,
  ReplayMarkerCluster,
  ReplayTimelineChunkInput,
  ReplayTimelineMarker,
  ReplayTrackBand,
  ReplayTrackLabelledBandKind,
  buildCoarseMarkers,
  buildExactMarkers,
  buildTimelineMarkers,
  buildTrackBands,
  clusterMarkers,
  describeCluster,
  describeFrustrationCounters,
  describeTrackBand,
  describeTrackBandLabel,
  formatReplayDurationInLanguage,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTimelineMath";

/*
 * The timeline's words in the reader's language (#6369). A band's label,
 * a marker's tooltip, a coarse chunk's counters and a cluster's "and N
 * more" were English in every language. Each is now looked up whole, with
 * the translator the caller hands in: a marking translator shows every
 * sentence comes out looked up, its values in place, and its lengths
 * written in its language; without one, the English is word for word what
 * it always was.
 */

const DURATION_MS: number = 600000;

// Every lookup comes back marked, as a German reader's would come back worded.
const MARKED: Translator = createTranslator((text: string): string => {
  return `⟦${text}⟧`;
}, "de");

function chunk(
  overrides: Partial<ReplayTimelineChunkInput> & { chunkIndex: number },
): ReplayTimelineChunkInput {
  const start: number = overrides.chunkIndex * 15000;

  return {
    chunkStartOffsetMs: start,
    chunkEndOffsetMs: start + 15000,
    eventCount: 40,
    errorCount: 0,
    rageClickCount: 0,
    deadClickCount: 0,
    errorClickCount: 0,
    refreshRageCount: 0,
    routeCount: 0,
    ...overrides,
  };
}

function signal(
  overrides: Partial<ReplaySignal> & { id: string },
): ReplaySignal {
  return {
    kind: "network",
    source: "recording",
    offsetMs: 0,
    severity: "info",
    title: overrides.id,
    links: {},
    detail: {},
    ...overrides,
  };
}

function titlesOf(markers: Array<ReplayTimelineMarker>): Array<string> {
  return markers.map((marker: ReplayTimelineMarker): string => {
    return marker.title;
  });
}

describe("formatReplayDurationInLanguage", () => {
  test("writes English exactly as formatReplayDuration does", () => {
    for (const durationMs of [
      -5, 0, 400, 1000, 18000, 72000, 3600000, 7500000,
    ]) {
      expect(formatReplayDurationInLanguage(durationMs)).toBe(
        formatReplayDuration(durationMs),
      );
    }
  });

  test("writes another language's units, rounded to the second as English is", () => {
    expect(formatReplayDurationInLanguage(18000, MARKED)).toBe(
      formatDurationCompactInLanguage(18, "de"),
    );
    expect(formatReplayDurationInLanguage(17600, MARKED)).toBe(
      formatDurationCompactInLanguage(18, "de"),
    );
    expect(formatReplayDurationInLanguage(0, MARKED)).toBe(
      formatDurationCompactInLanguage(0, "de"),
    );
    /* A stretch that exists is never labelled as nothing. */
    expect(formatReplayDurationInLanguage(400, MARKED)).toBe(
      `<${formatDurationCompactInLanguage(1, "de")}`,
    );
  });
});

describe("describeTrackBandLabel and describeTrackBand", () => {
  const kinds: Array<[ReplayTrackLabelledBandKind, string, string]> = [
    ["gap", "18s missing", "{{duration}} missing"],
    [
      "background-tab",
      "tab in background 18s",
      "tab in background {{duration}}",
    ],
    ["paused", "18s paused", "{{duration}} paused"],
    ["idle", "18s idle", "{{duration}} idle"],
  ];

  test.each(kinds)(
    "words a %s band whole, its length in the sentence's language",
    (kind: ReplayTrackLabelledBandKind, english: string, key: string) => {
      const length: string = formatReplayDurationInLanguage(18000, MARKED);

      expect(describeTrackBandLabel(kind, 18000)).toBe(english);
      expect(describeTrackBandLabel(kind, 18000, MARKED)).toBe(
        `⟦${key.replace("{{duration}}", length)}⟧`,
      );
    },
  );

  test("draws a built band from its length, and a band without one as given", () => {
    const bands: Array<ReplayTrackBand> = buildTrackBands({
      chunks: [chunk({ chunkIndex: 0 }), chunk({ chunkIndex: 3 })],
      gaps: [{ fromIndex: 0, toIndex: 3, missingMs: 18000 }],
      loadedChunkIndexes: [0],
      idleBands: [
        { startMs: 50000, endMs: 92000, kind: "idle", fidelity: "exact" },
      ],
      durationMs: DURATION_MS,
    });

    const gap: ReplayTrackBand | undefined = bands.find(
      (band: ReplayTrackBand): boolean => {
        return band.kind === "gap";
      },
    );
    const idle: ReplayTrackBand | undefined = bands.find(
      (band: ReplayTrackBand): boolean => {
        return band.kind === "idle";
      },
    );
    const loaded: ReplayTrackBand | undefined = bands.find(
      (band: ReplayTrackBand): boolean => {
        return band.kind === "loaded";
      },
    );

    /* English as it always was, and the length the label states. */
    expect(gap?.label).toBe("18s missing");
    expect(gap?.lengthMs).toBe(18000);
    expect(idle?.label).toBe("42s idle");
    expect(idle?.lengthMs).toBe(42000);

    expect(describeTrackBand(gap as ReplayTrackBand, MARKED)).toBe(
      describeTrackBandLabel("gap", 18000, MARKED),
    );
    expect(describeTrackBand(idle as ReplayTrackBand, MARKED)).toBe(
      describeTrackBandLabel("idle", 42000, MARKED),
    );
    expect(describeTrackBand(gap as ReplayTrackBand)).toBe("18s missing");

    /* A loaded band's label is never drawn; it stays as built. */
    expect(loaded?.lengthMs).toBeUndefined();
    expect(describeTrackBand(loaded as ReplayTrackBand, MARKED)).toBe(
      loaded?.label,
    );

    /* A band built by hand, with no length, is drawn as it was given. */
    expect(
      describeTrackBand(
        { kind: "gap", startMs: 0, endMs: 1000, label: "1s missing" },
        MARKED,
      ),
    ).toBe("1s missing");
  });
});

describe("marker titles", () => {
  test("an unanchored row says so in one sentence; an anchored one is its time and title", () => {
    const signals: Array<ReplaySignal> = [
      signal({
        id: "exc:abc",
        kind: "server-error",
        source: "telemetry",
        severity: "error",
        offsetMs: 12000,
        alignment: "unanchored",
        title: "NullPointerException",
      }),
      signal({
        id: "rec:0:1",
        kind: "client-error",
        severity: "error",
        offsetMs: 37000,
        title: "TypeError: x is undefined",
      }),
    ];

    expect(titlesOf(buildExactMarkers(signals, MARKED))).toEqual([
      "⟦0:12 NullPointerException (server time; not aligned to the recording clock)⟧",
      "0:37 TypeError: x is undefined",
    ]);
    expect(titlesOf(buildExactMarkers(signals))).toEqual([
      "0:12 NullPointerException (server time; not aligned to the recording clock)",
      "0:37 TypeError: x is undefined",
    ]);
  });

  test("a coarse chunk's counters are one whole sentence per counter", () => {
    const counters: ReplayTimelineChunkInput = chunk({
      chunkIndex: 0,
      errorCount: 2,
      rageClickCount: 3,
      deadClickCount: 2,
      routeCount: 4,
      customSignalCount: 5,
    });
    const length: string = formatReplayDurationInLanguage(15000, MARKED);

    expect(
      titlesOf(buildCoarseMarkers([counters], [], DURATION_MS, MARKED)),
    ).toEqual([
      `⟦~0:07 2 errors in this ${length} chunk (approximate, chunk not loaded yet)⟧`,
      /* The counts are a list worded in the sentence's language too. */
      `⟦~0:07 ⟦3 rage clicks⟧ · ⟦2 dead clicks⟧ in this ${length} chunk (approximate, chunk not loaded yet)⟧`,
      `⟦~0:07 5 signals of your own in this ${length} chunk (approximate, chunk not loaded yet)⟧`,
      `⟦~0:07 4 route changes in this ${length} chunk (approximate, chunk not loaded yet)⟧`,
    ]);

    expect(titlesOf(buildCoarseMarkers([counters], [], DURATION_MS))).toEqual([
      "~0:07 2 errors in this 15s chunk (approximate, chunk not loaded yet)",
      "~0:07 3 rage clicks · 2 dead clicks in this 15s chunk (approximate, chunk not loaded yet)",
      "~0:07 5 signals of your own in this 15s chunk (approximate, chunk not loaded yet)",
      "~0:07 4 route changes in this 15s chunk (approximate, chunk not loaded yet)",
    ]);
  });

  test("a count of one reads in the singular in English", () => {
    expect(
      titlesOf(
        buildCoarseMarkers(
          [
            chunk({
              chunkIndex: 0,
              errorCount: 1,
              refreshRageCount: 1,
              routeCount: 1,
              customSignalCount: 1,
            }),
          ],
          [],
          DURATION_MS,
        ),
      ),
    ).toEqual([
      "~0:07 1 error in this 15s chunk (approximate, chunk not loaded yet)",
      "~0:07 1 refresh rage in this 15s chunk (approximate, chunk not loaded yet)",
      "~0:07 1 signal of your own in this 15s chunk (approximate, chunk not loaded yet)",
      "~0:07 1 route change in this 15s chunk (approximate, chunk not loaded yet)",
    ]);
  });

  test("a language that words the counts but not the sentence reads one English sentence", () => {
    const countsOnly: Translator = createTranslator(
      (text: string): string | undefined => {
        return text === "{{count}} rage clicks"
          ? "{{count}} Wutklicks"
          : undefined;
      },
      "de",
    );

    expect(
      titlesOf(
        buildCoarseMarkers(
          [chunk({ chunkIndex: 0, rageClickCount: 3 })],
          [],
          DURATION_MS,
          countsOnly,
        ),
      ),
    ).toEqual([
      "~0:07 3 rage clicks in this 15s chunk (approximate, chunk not loaded yet)",
    ]);
  });

  test("buildTimelineMarkers hands its translator to every builder", () => {
    const markers: Array<ReplayTimelineMarker> = buildTimelineMarkers(
      {
        signals: [
          signal({
            id: "exc:late",
            kind: "server-error",
            source: "telemetry",
            severity: "error",
            offsetMs: 90000,
            alignment: "unanchored",
            title: "Timeout",
          }),
        ],
        chunks: [chunk({ chunkIndex: 0, errorCount: 2 })],
        loadedChunkIndexes: [],
        notices: [{ id: "n1", offsetMs: 42000, title: "Snapshot too large" }],
        durationMs: DURATION_MS,
      },
      MARKED,
    );

    expect(titlesOf(markers)).toEqual([
      `⟦~0:07 2 errors in this ${formatReplayDurationInLanguage(15000, MARKED)} chunk (approximate, chunk not loaded yet)⟧`,
      /* A notice's own title is the caller's, already in its words. */
      "0:42 Snapshot too large",
      "⟦1:30 Timeout (server time; not aligned to the recording clock)⟧",
    ]);
  });
});

describe("describeFrustrationCounters", () => {
  const counters: ReplayTimelineChunkInput = chunk({
    chunkIndex: 0,
    rageClickCount: 2,
    deadClickCount: 3,
    errorClickCount: 4,
    refreshRageCount: 5,
    customSignalFrustrationCount: 6,
  });

  test("looks every count up whole and sets them off the language's way", () => {
    expect(describeFrustrationCounters(counters, MARKED)).toBe(
      "⟦2 rage clicks⟧ · ⟦3 dead clicks⟧ · ⟦4 error clicks⟧ · ⟦5 refresh rages⟧ · ⟦6 signals of your own⟧",
    );
    expect(describeFrustrationCounters(counters)).toBe(
      "2 rage clicks · 3 dead clicks · 4 error clicks · 5 refresh rages · 6 signals of your own",
    );
    expect(describeFrustrationCounters(chunk({ chunkIndex: 0 }), MARKED)).toBe(
      null,
    );
  });

  test("Persian takes the bullet that reads apart from its digits", () => {
    const persian: Translator = createTranslator(undefined, "fa");

    expect(describeFrustrationCounters(counters, persian)).toContain(" • ");
  });
});

describe("describeCluster", () => {
  test("ends a long tooltip with 'and N more' in the reader's language", () => {
    const markers: Array<ReplayTimelineMarker> = buildExactMarkers(
      Array.from(
        { length: 7 },
        (_unused: unknown, index: number): ReplaySignal => {
          return signal({
            id: `rec:0:${index}`,
            kind: "network",
            severity: "warn",
            offsetMs: 1000 + index * 500,
            title: `GET 404 /poll/${index}`,
            detail: { status: 404 },
          });
        },
      ),
    );
    const clusters: Array<ReplayMarkerCluster> = clusterMarkers(
      markers,
      DURATION_MS,
      1000,
    );

    expect(clusters).toHaveLength(1);

    const marked: Array<string> = describeCluster(
      clusters[0] as ReplayMarkerCluster,
      MARKED,
    ).split("\n");
    const english: Array<string> = describeCluster(
      clusters[0] as ReplayMarkerCluster,
    ).split("\n");

    expect(marked).toHaveLength(6);
    expect(marked[5]).toBe("⟦and 2 more⟧");
    expect(english[5]).toBe("and 2 more");
    /* The markers' own titles are listed as they were written. */
    expect(marked.slice(0, 5)).toEqual(english.slice(0, 5));
  });
});

describe("REPLAY_TIMELINE_LANE_LABELS", () => {
  test("holds the English keys the timeline looks up where it draws them", () => {
    expect(REPLAY_TIMELINE_LANE_LABELS).toEqual({
      errors: "Errors",
      network: "Network",
      navigation: "Nav / clicks",
      track: "Recording",
    });
  });
});
