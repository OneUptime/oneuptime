import { describe, expect, test } from "@jest/globals";
import { ReplayIdleBand } from "../../FeatureSet/Dashboard/src/Components/SessionReplay/Engine/ReplayEngineTypes";
import { ReplaySignal } from "../../FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplaySignalTypes";
import {
  REPLAY_MARKER_NEXT_TOLERANCE_MS,
  REPLAY_MARKER_PRE_ROLL_MS,
  ReplayActivityBucket,
  ReplayMarkerCluster,
  ReplayTimelineChunkInput,
  ReplayTimelineMarker,
  ReplayTimelinePreview,
  ReplayTrackBand,
  assignMarkerLane,
  buildActivityHeat,
  buildCoarseMarkers,
  buildExactMarkers,
  buildHoverPreview,
  buildNoticeMarkers,
  buildTimelineMarkers,
  buildTrackBands,
  clampOffset,
  clusterMarkers,
  describeCluster,
  describeFrustrationCounters,
  findNextMarker,
  findPrevMarker,
  getErrorMarkers,
  getFrustrationMarkers,
  getMarkersForLane,
  markerSeekTarget,
  nudgeOffset,
  offsetToPercent,
  percentToOffset,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTimelineMath";

/*
 * Pure timeline geometry: bands from chunks/gaps/idle, activity heat,
 * lane assignment, the coarse->exact marker replacement, pixel-threshold
 * clustering, prev/next stepping with the pre-roll, and the hover
 * preview. No DOM.
 */

const DURATION_MS: number = 600000;

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

describe("percent helpers", () => {
  test("clamp to [0, duration] and survive a zero duration", () => {
    expect(clampOffset(-5, DURATION_MS)).toBe(0);
    expect(clampOffset(DURATION_MS + 1, DURATION_MS)).toBe(DURATION_MS);
    expect(clampOffset(Number.NaN, DURATION_MS)).toBe(0);
    expect(offsetToPercent(300000, DURATION_MS)).toBe(50);
    expect(offsetToPercent(900000, DURATION_MS)).toBe(100);
    expect(offsetToPercent(1000, 0)).toBe(0);
    expect(percentToOffset(25, DURATION_MS)).toBe(150000);
    expect(percentToOffset(25, 0)).toBe(0);
    expect(nudgeOffset(1000, -5000, DURATION_MS)).toBe(0);
    expect(nudgeOffset(DURATION_MS - 100, 5000, DURATION_MS)).toBe(DURATION_MS);
  });
});

describe("buildTrackBands", () => {
  test("merges adjacent same-state chunks and labels loaded vs not yet loaded", () => {
    const bands: Array<ReplayTrackBand> = buildTrackBands({
      chunks: [
        chunk({ chunkIndex: 0 }),
        chunk({ chunkIndex: 1 }),
        chunk({ chunkIndex: 2 }),
      ],
      loadedChunkIndexes: [0, 1],
      durationMs: 45000,
    });

    expect(bands).toEqual([
      { kind: "loaded", startMs: 0, endMs: 30000, label: "30s loaded" },
      {
        kind: "available",
        startMs: 30000,
        endMs: 45000,
        label: "15s not yet loaded",
      },
    ]);
  });

  test("draws a manifest gap between the two chunks it names, labelled with missingMs", () => {
    const bands: Array<ReplayTrackBand> = buildTrackBands({
      chunks: [chunk({ chunkIndex: 0 }), chunk({ chunkIndex: 3 })],
      gaps: [{ fromIndex: 0, toIndex: 3, missingMs: 18000 }],
      loadedChunkIndexes: [],
      durationMs: 60000,
    });

    const gap: ReplayTrackBand | undefined = bands.find(
      (band: ReplayTrackBand): boolean => {
        return band.kind === "gap";
      },
    );

    expect(gap).toEqual({
      kind: "gap",
      startMs: 15000,
      endMs: 45000,
      label: "18s missing",
    });
  });

  test("skips a gap whose chunks are not in the manifest slice", () => {
    const bands: Array<ReplayTrackBand> = buildTrackBands({
      chunks: [chunk({ chunkIndex: 0 })],
      gaps: [{ fromIndex: 0, toIndex: 9, missingMs: 1000 }],
      loadedChunkIndexes: [],
      durationMs: 60000,
    });

    expect(
      bands.some((band: ReplayTrackBand) => {
        return band.kind === "gap";
      }),
    ).toBe(false);
  });

  test("clips idle bands to the duration and labels them by kind and fidelity", () => {
    const idleBands: Array<ReplayIdleBand> = [
      { startMs: 10000, endMs: 52000, kind: "idle", fidelity: "exact" },
      {
        startMs: 55000,
        endMs: 200000,
        kind: "background-tab",
        fidelity: "coarse",
      },
      { startMs: 70000, endMs: 60000, kind: "idle", fidelity: "exact" },
    ];

    const bands: Array<ReplayTrackBand> = buildTrackBands({
      chunks: [],
      loadedChunkIndexes: [],
      idleBands: idleBands,
      durationMs: 60000,
    });

    expect(bands).toEqual([
      {
        kind: "idle",
        startMs: 10000,
        endMs: 52000,
        label: "42s idle",
        fidelity: "exact",
      },
      {
        kind: "background-tab",
        startMs: 55000,
        endMs: 60000,
        label: "tab in background 5s",
        fidelity: "coarse",
      },
    ]);
  });

  test("a chunk ending past the duration is cut, not drawn past 100%", () => {
    const bands: Array<ReplayTrackBand> = buildTrackBands({
      chunks: [chunk({ chunkIndex: 0, chunkEndOffsetMs: 99000 })],
      loadedChunkIndexes: [0],
      durationMs: 20000,
    });

    expect(bands[0]?.endMs).toBe(20000);
  });
});

describe("buildActivityHeat", () => {
  test("normalises eventCount against the busiest chunk", () => {
    const buckets: Array<ReplayActivityBucket> = buildActivityHeat(
      [
        chunk({ chunkIndex: 0, eventCount: 100 }),
        chunk({ chunkIndex: 1, eventCount: 50 }),
        chunk({ chunkIndex: 2, eventCount: 2 }),
      ],
      45000,
    );

    expect(
      buckets.map((bucket: ReplayActivityBucket) => {
        return bucket.intensity;
      }),
    ).toEqual([1, 0.5, 0]);
    expect(
      buckets.every((bucket: ReplayActivityBucket) => {
        return bucket.isMeasured;
      }),
    ).toBe(true);
  });

  test("weights clicks in when the manifest carries them", () => {
    const buckets: Array<ReplayActivityBucket> = buildActivityHeat(
      [
        chunk({ chunkIndex: 0, eventCount: 100, clickCount: 0 }),
        chunk({ chunkIndex: 1, eventCount: 100, clickCount: 10 }),
      ],
      30000,
    );

    expect(buckets[0]?.intensity).toBeCloseTo(0.6);
    expect(buckets[1]?.intensity).toBeCloseTo(1);
  });

  test("reports nothing measured when every count is zero", () => {
    const buckets: Array<ReplayActivityBucket> = buildActivityHeat(
      [chunk({ chunkIndex: 0, eventCount: 0 })],
      15000,
    );

    expect(buckets[0]?.isMeasured).toBe(false);
    expect(buckets[0]?.intensity).toBe(0);
  });
});

describe("assignMarkerLane", () => {
  const cases: Array<[string, Partial<ReplaySignal>, string | null]> = [
    [
      "client error",
      { kind: "client-error", severity: "error" },
      "errors/rose",
    ],
    [
      "server exception",
      { kind: "server-error", severity: "error" },
      "errors/rose-outline",
    ],
    ["error log", { kind: "log", severity: "error" }, "errors/rose-dot"],
    ["info log", { kind: "log", severity: "info" }, null],
    [
      "4xx",
      { kind: "network", severity: "warn", detail: { status: 404 } },
      "network/amber",
    ],
    [
      "5xx",
      { kind: "network", severity: "error", detail: { status: 502 } },
      "network/rose",
    ],
    [
      "failed request without a status",
      { kind: "network", severity: "error", detail: { isError: true } },
      "network/rose",
    ],
    [
      "slow 200",
      { kind: "network", severity: "warn", detail: { status: 200 } },
      "network/orange",
    ],
    [
      "plain 200",
      { kind: "network", severity: "info", detail: { status: 200 } },
      null,
    ],
    ["error span", { kind: "span", severity: "error" }, "network/rose-outline"],
    ["ok span", { kind: "span", severity: "success" }, null],
    ["route", { kind: "navigation", severity: "info" }, "navigation/sky"],
    [
      "rage click",
      { kind: "frustration", severity: "warn" },
      "navigation/amber",
    ],
    ["console", { kind: "console", severity: "error" }, null],
    ["plain click", { kind: "interaction", severity: "info" }, null],
    /*
     * ux-06: a subresource that failed to load is a network warning, not
     * a client error - the recorder keeps it out of its trigger counts -
     * and the recorder's own "capture stopped" marker is no error at all.
     */
    [
      "resource load failure",
      {
        kind: "client-error",
        severity: "warn",
        detail: { kind: "resource", isCapMarker: false },
      },
      "network/amber",
    ],
    [
      "error cap marker",
      {
        kind: "client-error",
        severity: "warn",
        detail: { kind: "error", isCapMarker: true },
      },
      null,
    ],
  ];

  test.each(cases)(
    "%s",
    (
      _name: string,
      overrides: Partial<ReplaySignal>,
      expected: string | null,
    ) => {
      const placement: { lane: string; tone: string } | null = assignMarkerLane(
        signal({ id: "x", ...overrides }),
      );

      expect(placement ? `${placement.lane}/${placement.tone}` : null).toBe(
        expected,
      );
    },
  );
});

describe("buildExactMarkers", () => {
  test("carries the signal id, chunk and a time-prefixed title", () => {
    const markers: Array<ReplayTimelineMarker> = buildExactMarkers([
      signal({
        id: "rec:2:4",
        kind: "client-error",
        severity: "error",
        offsetMs: 37000,
        chunkIndex: 2,
        title: "TypeError: x is undefined",
      }),
    ]);

    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      id: "exact:rec:2:4",
      lane: "errors",
      offsetMs: 37000,
      fidelity: "exact",
      isHollow: false,
      signalId: "rec:2:4",
      chunkIndex: 2,
      title: "0:37 TypeError: x is undefined",
    });
  });

  test("an unanchored telemetry row is hollow and says so", () => {
    const markers: Array<ReplayTimelineMarker> = buildExactMarkers([
      signal({
        id: "exc:abc",
        kind: "server-error",
        source: "telemetry",
        severity: "error",
        offsetMs: 12000,
        alignment: "unanchored",
        title: "NullPointerException",
      }),
    ]);

    expect(markers[0]?.isHollow).toBe(true);
    expect(markers[0]?.title).toContain("server time");
  });
});

describe("buildCoarseMarkers and the coarse->exact replacement", () => {
  test("draws counters for undecoded chunks at the midpoint, hollow, titled approximate", () => {
    const markers: Array<ReplayTimelineMarker> = buildCoarseMarkers(
      [
        chunk({
          chunkIndex: 4,
          errorCount: 2,
          routeCount: 1,
          deadClickCount: 1,
        }),
      ],
      [],
      DURATION_MS,
    );

    expect(
      markers.map((marker: ReplayTimelineMarker) => {
        return marker.id;
      }),
    ).toEqual(["coarse:errors:4", "coarse:frustration:4", "coarse:routes:4"]);

    for (const marker of markers) {
      expect(marker.offsetMs).toBe(67500);
      expect(marker.isHollow).toBe(true);
      expect(marker.fidelity).toBe("coarse");
      expect(marker.title).toContain("approximate, chunk not loaded yet");
      expect(marker.title.startsWith("~1:07")).toBe(true);
      expect(marker.signalId).toBeUndefined();
    }

    expect(markers[0]?.title).toContain("2 errors");
    expect(markers[1]?.title).toContain("1 dead click");
    expect(markers[2]?.title).toContain("1 route change");
  });

  test("a loaded chunk contributes no coarse markers; its exact signals take over", () => {
    const chunks: Array<ReplayTimelineChunkInput> = [
      chunk({ chunkIndex: 0, errorCount: 1 }),
      chunk({ chunkIndex: 1, errorCount: 1 }),
    ];

    const before: Array<ReplayTimelineMarker> = buildTimelineMarkers({
      signals: [],
      chunks: chunks,
      loadedChunkIndexes: [],
      durationMs: 30000,
    });

    expect(
      before.map((marker: ReplayTimelineMarker) => {
        return marker.id;
      }),
    ).toEqual(["coarse:errors:0", "coarse:errors:1"]);

    const after: Array<ReplayTimelineMarker> = buildTimelineMarkers({
      signals: [
        signal({
          id: "rec:0:1",
          kind: "client-error",
          severity: "error",
          offsetMs: 3200,
          chunkIndex: 0,
        }),
      ],
      chunks: chunks,
      loadedChunkIndexes: [0],
      durationMs: 30000,
    });

    expect(
      after.map((marker: ReplayTimelineMarker) => {
        return marker.id;
      }),
    ).toEqual(["exact:rec:0:1", "coarse:errors:1"]);
    expect(after[0]?.offsetMs).toBe(3200);
    expect(after[0]?.isHollow).toBe(false);
  });

  test("the frustration tooltip lists only non-zero counters", () => {
    expect(
      describeFrustrationCounters(chunk({ chunkIndex: 0, deadClickCount: 1 })),
    ).toBe("1 dead click");
    expect(
      describeFrustrationCounters(
        chunk({ chunkIndex: 0, rageClickCount: 2, refreshRageCount: 1 }),
      ),
    ).toBe("2 rage clicks · 1 refresh rage");
    expect(describeFrustrationCounters(chunk({ chunkIndex: 0 }))).toBeNull();
  });
});

describe("buildNoticeMarkers", () => {
  test("pins a playback-affecting notice to the track at its offset", () => {
    const markers: Array<ReplayTimelineMarker> = buildNoticeMarkers(
      [
        {
          id: "bfcache-1",
          offsetMs: 42000,
          title: "Restored from back/forward cache",
        },
        { id: "bad", offsetMs: Number.NaN, title: "ignored" },
      ],
      DURATION_MS,
    );

    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      id: "notice:bfcache-1",
      lane: "track",
      kind: "notice",
      offsetMs: 42000,
      title: "0:42 Restored from back/forward cache",
    });
  });
});

describe("clusterMarkers", () => {
  function marker(
    id: string,
    offsetMs: number,
    lane: "errors" | "network" | "navigation" = "network",
  ): ReplayTimelineMarker {
    return {
      id: id,
      lane: lane,
      offsetMs: offsetMs,
      kind: "network",
      severity: "warn",
      title: `${id} at ${offsetMs}`,
      tone: "amber",
      fidelity: "exact",
      isHollow: false,
      signalId: id,
    };
  }

  test("merges ticks within the pixel threshold and counts them", () => {
    /* 600s over 1000px = 0.6s per px; 6px = 3.6s. */
    const clusters: Array<ReplayMarkerCluster> = clusterMarkers(
      [
        marker("a", 1000),
        marker("b", 3000),
        marker("c", 5000),
        marker("d", 60000),
      ],
      DURATION_MS,
      1000,
    );

    expect(
      clusters.map((cluster: ReplayMarkerCluster) => {
        return cluster.count;
      }),
    ).toEqual([3, 1]);
    expect(clusters[0]?.offsetMs).toBe(1000);
    expect(clusters[0]?.endOffsetMs).toBe(5000);
    expect(clusters[1]?.markers[0]?.id).toBe("d");
  });

  test("the threshold is in pixels, so a wider track separates the same markers", () => {
    const narrow: Array<ReplayMarkerCluster> = clusterMarkers(
      [marker("a", 1000), marker("b", 4000)],
      DURATION_MS,
      500,
    );
    const wide: Array<ReplayMarkerCluster> = clusterMarkers(
      [marker("a", 1000), marker("b", 4000)],
      DURATION_MS,
      4000,
    );

    expect(narrow).toHaveLength(1);
    expect(wide).toHaveLength(2);
  });

  test("the tooltip lists the first five and counts the rest", () => {
    const markers: Array<ReplayTimelineMarker> = [];

    for (let index: number = 0; index < 8; index++) {
      markers.push(marker(`m${index}`, index * 100));
    }

    const clusters: Array<ReplayMarkerCluster> = clusterMarkers(
      markers,
      DURATION_MS,
      1000,
    );

    expect(clusters).toHaveLength(1);

    const lines: Array<string> = describeCluster(clusters[0]!).split("\n");

    expect(lines).toHaveLength(6);
    expect(lines[5]).toBe("and 3 more");
  });
});

describe("prev/next stepping", () => {
  const errors: Array<ReplayTimelineMarker> = buildExactMarkers([
    signal({
      id: "e1",
      kind: "client-error",
      severity: "error",
      offsetMs: 20000,
    }),
    signal({
      id: "e2",
      kind: "client-error",
      severity: "error",
      offsetMs: 21000,
    }),
    signal({
      id: "e3",
      kind: "client-error",
      severity: "error",
      offsetMs: 60000,
    }),
  ]);

  test("marker clicks land one second early", () => {
    expect(markerSeekTarget(errors[0]!)).toBe(
      20000 - REPLAY_MARKER_PRE_ROLL_MS,
    );
    expect(markerSeekTarget({ ...errors[0]!, offsetMs: 400 })).toBe(0);
  });

  test("next advances from the marker just jumped to, never re-finding it", () => {
    /*
     * Finding scrubber-devtools-2 / player-shell-1: after a jump the
     * playhead is at marker - 1s, which is still before the marker, so a
     * naive "first marker after currentTime" returned the same marker.
     */
    let currentTimeMs: number = 0;
    const visited: Array<string> = [];

    for (let step: number = 0; step < 5; step++) {
      const next: ReplayTimelineMarker | null = findNextMarker(
        errors,
        currentTimeMs,
      );

      if (!next) {
        break;
      }

      visited.push(next.signalId!);
      currentTimeMs = markerSeekTarget(next);
    }

    expect(visited).toEqual(["e1", "e2", "e3"]);
    expect(REPLAY_MARKER_NEXT_TOLERANCE_MS).toBeGreaterThan(
      REPLAY_MARKER_PRE_ROLL_MS,
    );
  });

  test("previous steps back through the same markers and re-finds the one just passed", () => {
    expect(findPrevMarker(errors, 59000)?.signalId).toBe("e2");
    expect(findPrevMarker(errors, 20000)?.signalId).toBeUndefined();
    /* Half a second past e3: Shift+E means "that one again". */
    expect(findPrevMarker(errors, 60500)?.signalId).toBe("e3");
    expect(findPrevMarker(errors, 0)).toBeNull();
    expect(findNextMarker(errors, 60000)).toBeNull();
  });

  test("getErrorMarkers / getFrustrationMarkers pick the lane and kind", () => {
    const all: Array<ReplayTimelineMarker> = buildTimelineMarkers({
      signals: [
        signal({ id: "n", kind: "network", severity: "error", offsetMs: 5000 }),
        signal({
          id: "f",
          kind: "frustration",
          severity: "warn",
          offsetMs: 8000,
        }),
        signal({
          id: "r",
          kind: "navigation",
          severity: "info",
          offsetMs: 9000,
        }),
      ],
      chunks: [chunk({ chunkIndex: 9, errorCount: 1, rageClickCount: 1 })],
      loadedChunkIndexes: [],
      durationMs: DURATION_MS,
    });

    expect(
      getErrorMarkers(all).map((marker: ReplayTimelineMarker) => {
        return marker.id;
      }),
    ).toEqual(["coarse:errors:9"]);
    expect(
      getFrustrationMarkers(all).map((marker: ReplayTimelineMarker) => {
        return marker.id;
      }),
    ).toEqual(["exact:f", "coarse:frustration:9"]);
  });

  /*
   * ux-06: E / Shift+E and the Errors lane step through real errors. A
   * 404 image and the recorder's cap notice are rows in the rail, not
   * errors to be walked through.
   */
  test("resource failures and cap markers never reach the error stepping", () => {
    const markers: Array<ReplayTimelineMarker> = buildExactMarkers([
      signal({
        id: "real",
        kind: "client-error",
        severity: "error",
        offsetMs: 4000,
        detail: { kind: "error", isCapMarker: false },
      }),
      signal({
        id: "resource",
        kind: "client-error",
        severity: "warn",
        offsetMs: 5000,
        detail: { kind: "resource", isCapMarker: false },
      }),
      signal({
        id: "cap",
        kind: "client-error",
        severity: "warn",
        offsetMs: 6000,
        detail: { kind: "error", isCapMarker: true },
      }),
    ]);

    expect(
      getErrorMarkers(markers).map((marker: ReplayTimelineMarker) => {
        return marker.signalId;
      }),
    ).toEqual(["real"]);
    /* The resource failure is still drawn - in the network lane. */
    expect(
      getMarkersForLane(markers, "network").map(
        (marker: ReplayTimelineMarker) => {
          return marker.signalId;
        },
      ),
    ).toEqual(["resource"]);
  });
});

describe("buildHoverPreview", () => {
  const signals: Array<ReplaySignal> = [
    signal({
      id: "nav1",
      kind: "navigation",
      offsetMs: 1000,
      detail: { to: "/cart" },
    }),
    signal({
      id: "nav2",
      kind: "navigation",
      offsetMs: 30000,
      detail: { to: "/checkout" },
    }),
    signal({ id: "a", offsetMs: 29500, title: "GET 200 /api/a" }),
    signal({ id: "b", offsetMs: 31900, title: "POST 500 /api/b" }),
    signal({ id: "c", offsetMs: 30100, title: "console warn" }),
    signal({ id: "far", offsetMs: 40000, title: "far away" }),
  ];

  test("names the route at that moment and the two nearest signals within 2s", () => {
    const preview: ReplayTimelinePreview = buildHoverPreview(signals, 30000);

    expect(preview.route).toBe("/checkout");
    expect(
      preview.signals.map((entry: ReplaySignal) => {
        return entry.id;
      }),
    ).toEqual(["nav2", "c"]);
  });

  test("falls back to the earlier route before the next navigation", () => {
    expect(buildHoverPreview(signals, 15000).route).toBe("/cart");
    expect(buildHoverPreview(signals, 500).route).toBeNull();
  });
});
