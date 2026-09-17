import {
  MAX_SESSION_REPLAY_CHUNKS_PER_SESSION,
  SESSION_REPLAY_ENDED_FINALIZE_GRACE_MS,
  SESSION_REPLAY_ENDED_TRAILING_CHUNK_TOLERANCE_MS,
  SESSION_REPLAY_FLUSH_INTERVAL_MS,
  SESSION_REPLAY_IDLE_FINALIZE_MS,
} from "../../../Types/Rum/SessionReplay";
import {
  SessionReplayTabEndFacts,
  hasSessionRecordingEnded,
  hasTabRecordingEnded,
} from "../../../Utils/Rum/SessionReplayRecordingEnded";
import { describe, expect, test } from "@jest/globals";

/*
 * The shared "has this recording ended?" rule. Both the finalizer (which
 * finalizes an ended session early) and the read path (which tells the
 * Dashboard a session has ended before the finalizer has run) call it, so
 * these tests pin the one definition both sides agree on.
 *
 * The regression it exists for: a user closed the tab, the recorder sent
 * its final chunk, and the sessions table kept saying "Recording now" for
 * 10-15 minutes because "not finalized" was read as "still recording".
 *
 * The facts below are built the way the recorder actually dates chunks and
 * the way the readers actually aggregate them, not from convenient
 * numbers:
 *
 * - A chunk with events is dated by them: its start is its FIRST buffered
 *   event and its end is its LAST (Chunker). A chunk closed by pagehide
 *   therefore ends at the last thing the user did, which can be up to one
 *   flush interval before pagehide when they sat still before closing.
 * - A chunk with no events (an empty seal) is dated "now".
 * - Every recorder init mints a new tab id, so a second page of a
 *   multi-page app, or a stop() followed by a start(), is a SECOND tab.
 *   Nothing records under the same (session, tab) after a seal except an
 *   older recorder's one trailing visibility chunk, or an older recorder
 *   resuming a page restored from the back/forward cache.
 * - Readers fold a tab's chunk rows into facts with maxima (see
 *   SessionReplayTabEndFacts); tabFromChunks below does the same fold.
 */

/* Device clock: the moment the browser fired pagehide on the tab. */
const PAGEHIDE: number = 1_757_000_000_000;

/*
 * Server clock: when the tab's last chunk row was written. Deliberately
 * unrelated to PAGEHIDE - the grace is judged on this clock only.
 */
const STORED_AT: number = 1_757_000_004_321;

/* The first server "now" at which STORED_AT is past the grace. */
const GRACE_PASSED: number = STORED_AT + SESSION_REPLAY_ENDED_FINALIZE_GRACE_MS;

/* One stored chunk row, reduced to the columns the rule is judged on. */
interface ChunkRow {
  chunkIndex: number;
  isFinal: boolean;
  chunkStartUnixMs: number;
  chunkEndUnixMs: number;
  storedAtUnixMs: number;
}

/*
 * The per-tab fold the readers run in SQL:
 *   max(toUInt8(isFinal)), maxIf(chunkEndTime, isFinal),
 *   max(chunkStartTime), max(chunkIndex), max(version)
 * maxIf over no final rows is the column default, epoch.
 */
function tabFromChunks(rows: Array<ChunkRow>): SessionReplayTabEndFacts {
  const finalRows: Array<ChunkRow> = rows.filter((row: ChunkRow): boolean => {
    return row.isFinal;
  });

  return {
    hasFinalChunk: finalRows.length > 0,
    finalChunkEndUnixMs:
      finalRows.length > 0
        ? Math.max(
            ...finalRows.map((row: ChunkRow): number => {
              return row.chunkEndUnixMs;
            }),
          )
        : 0,
    lastChunkStartUnixMs: Math.max(
      ...rows.map((row: ChunkRow): number => {
        return row.chunkStartUnixMs;
      }),
    ),
    maxChunkIndex: Math.max(
      ...rows.map((row: ChunkRow): number => {
        return row.chunkIndex;
      }),
    ),
    lastChunkStoredAtUnixMs: Math.max(
      ...rows.map((row: ChunkRow): number => {
        return row.storedAtUnixMs;
      }),
    ),
  };
}

/*
 * A tab that recorded a few flushes and was closed: its final chunk's last
 * event was `idleBeforePagehideMs` before pagehide.
 */
function closedTabChunks(idleBeforePagehideMs: number): Array<ChunkRow> {
  const finalEnd: number = PAGEHIDE - idleBeforePagehideMs;

  return [
    {
      chunkIndex: 0,
      isFinal: false,
      chunkStartUnixMs: finalEnd - 40_000,
      chunkEndUnixMs: finalEnd - 30_000,
      storedAtUnixMs: STORED_AT - 30_000,
    },
    {
      chunkIndex: 1,
      isFinal: false,
      chunkStartUnixMs: finalEnd - 28_000,
      chunkEndUnixMs: finalEnd - 16_000,
      storedAtUnixMs: STORED_AT - 15_000,
    },
    {
      chunkIndex: 2,
      isFinal: true,
      chunkStartUnixMs: finalEnd - 12_000,
      chunkEndUnixMs: finalEnd,
      storedAtUnixMs: STORED_AT,
    },
  ];
}

/*
 * An older recorder's trailing chunk. On a visible tab the browser fires
 * pagehide BEFORE visibilitychange(hidden); that recorder's hidden handler
 * recorded a Visibility event and flushed it as one more non-final chunk,
 * a chunk of that single event dated a moment after pagehide.
 */
function trailingVisibilityChunk(
  chunkIndex: number,
  startUnixMs: number = PAGEHIDE + 3,
): ChunkRow {
  return {
    chunkIndex: chunkIndex,
    isFinal: false,
    chunkStartUnixMs: startUnixMs,
    chunkEndUnixMs: startUnixMs,
    storedAtUnixMs: STORED_AT + 40,
  };
}

/* A realistic ended tab: closed after 5 s of stillness, no trailing chunk. */
function endedTab(
  overrides: Partial<SessionReplayTabEndFacts> = {},
): SessionReplayTabEndFacts {
  return { ...tabFromChunks(closedTabChunks(5_000)), ...overrides };
}

/* A tab still recording: flushes, no final chunk, far from the cap. */
function liveTab(
  overrides: Partial<SessionReplayTabEndFacts> = {},
): SessionReplayTabEndFacts {
  return {
    ...tabFromChunks(
      closedTabChunks(0).map((row: ChunkRow): ChunkRow => {
        return { ...row, isFinal: false };
      }),
    ),
    ...overrides,
  };
}

describe("SessionReplayRecordingEnded constants", () => {
  test("the trailing-chunk tolerance covers a final chunk dated a whole flush interval before pagehide", () => {
    /*
     * A chunk's end is its last buffered event and the flush timer drains
     * the buffer only every flush interval, so the gap between the final
     * chunk's end and a trailing chunk at pagehide can be the whole
     * interval. A tolerance at or under it misjudges users who sat still.
     */
    expect(SESSION_REPLAY_ENDED_TRAILING_CHUNK_TOLERANCE_MS).toBeGreaterThan(
      SESSION_REPLAY_FLUSH_INTERVAL_MS,
    );
    expect(SESSION_REPLAY_ENDED_TRAILING_CHUNK_TOLERANCE_MS).toBeLessThan(
      SESSION_REPLAY_IDLE_FINALIZE_MS,
    );
  });

  test("the grace covers the next page's first flush and stays short next to the idle window", () => {
    expect(SESSION_REPLAY_ENDED_FINALIZE_GRACE_MS).toBeGreaterThan(
      SESSION_REPLAY_FLUSH_INTERVAL_MS,
    );
    expect(SESSION_REPLAY_ENDED_FINALIZE_GRACE_MS).toBeLessThan(
      SESSION_REPLAY_IDLE_FINALIZE_MS,
    );
  });
});

describe("hasTabRecordingEnded", () => {
  test("a closed tab whose final chunk is its newest has ended (the closed-tab regression)", () => {
    expect(hasTabRecordingEnded(tabFromChunks(closedTabChunks(0)))).toBe(true);
    expect(hasTabRecordingEnded(tabFromChunks(closedTabChunks(9_000)))).toBe(
      true,
    );
  });

  test("a tab whose only chunk is an empty seal dated at pagehide has ended", () => {
    expect(
      hasTabRecordingEnded(
        tabFromChunks([
          {
            chunkIndex: 0,
            isFinal: true,
            chunkStartUnixMs: PAGEHIDE,
            chunkEndUnixMs: PAGEHIDE,
            storedAtUnixMs: STORED_AT,
          },
        ]),
      ),
    ).toBe(true);
  });

  test("a tab without a final chunk has not ended, whatever its clocks say", () => {
    expect(hasTabRecordingEnded(liveTab())).toBe(false);

    /*
     * Even with clocks that would otherwise pass: hasFinalChunk false means
     * finalChunkEndUnixMs is maxIf's default and meaningless.
     */
    expect(
      hasTabRecordingEnded(
        liveTab({
          finalChunkEndUnixMs: PAGEHIDE,
          lastChunkStartUnixMs: PAGEHIDE - 15_000,
        }),
      ),
    ).toBe(false);
  });

  /*
   * The old-recorder case the tolerance exists for, with the real timing:
   * the final chunk ended at the user's last event, N ms before pagehide,
   * and the trailing visibility chunk starts just after pagehide.
   */
  test.each([
    ["0 ms", 0],
    ["9 s", 9_000],
    ["11 s", 11_000],
    ["14.9 s", 14_900],
    ["a whole flush interval", SESSION_REPLAY_FLUSH_INTERVAL_MS],
  ] as Array<[string, number]>)(
    "a final chunk whose last event was %s before pagehide, followed by an older recorder's trailing visibility chunk, has ended",
    (_label: string, idleBeforePagehideMs: number) => {
      const rows: Array<ChunkRow> = [
        ...closedTabChunks(idleBeforePagehideMs),
        trailingVisibilityChunk(3),
      ];

      const tab: SessionReplayTabEndFacts = tabFromChunks(rows);

      /* The facts are what the scenario says: a trailing start after the seal. */
      expect(tab.hasFinalChunk).toBe(true);
      expect(tab.lastChunkStartUnixMs).toBe(PAGEHIDE + 3);
      expect(tab.lastChunkStartUnixMs - tab.finalChunkEndUnixMs).toBe(
        idleBeforePagehideMs + 3,
      );

      expect(hasTabRecordingEnded(tab)).toBe(true);
    },
  );

  test("a trailing chunk starting exactly at the tolerance has ended; 1 ms past it has not", () => {
    const finalEnd: number = PAGEHIDE - 5_000;

    expect(
      hasTabRecordingEnded(
        tabFromChunks([
          ...closedTabChunks(5_000),
          trailingVisibilityChunk(
            3,
            finalEnd + SESSION_REPLAY_ENDED_TRAILING_CHUNK_TOLERANCE_MS,
          ),
        ]),
      ),
    ).toBe(true);

    expect(
      hasTabRecordingEnded(
        tabFromChunks([
          ...closedTabChunks(5_000),
          trailingVisibilityChunk(
            3,
            finalEnd + SESSION_REPLAY_ENDED_TRAILING_CHUNK_TOLERANCE_MS + 1,
          ),
        ]),
      ),
    ).toBe(false);
  });

  test("an older recorder resuming the same tab from the back/forward cache minutes after its seal has not ended", () => {
    /*
     * Current recorders give a restored page a new tab id. An older one
     * kept the tab id and cleared its seal, so its next flushes land under
     * the tab that already has a final chunk - and they start well past
     * the tolerance.
     */
    const rows: Array<ChunkRow> = [
      ...closedTabChunks(2_000),
      {
        chunkIndex: 3,
        isFinal: false,
        chunkStartUnixMs: PAGEHIDE + 4 * 60 * 1000,
        chunkEndUnixMs: PAGEHIDE + 4 * 60 * 1000 + 12_000,
        storedAtUnixMs: STORED_AT + 4 * 60 * 1000 + 15_000,
      },
    ];

    expect(hasTabRecordingEnded(tabFromChunks(rows))).toBe(false);
  });

  /*
   * The ingest gate refuses every chunk index at or past the per-session
   * cap, the recorder's truncation seal included, so a tab that stored the
   * last permitted index can never send a final chunk that lands.
   */
  test("a tab that stored the last permitted chunk index has ended without a final chunk", () => {
    expect(
      hasTabRecordingEnded(
        liveTab({ maxChunkIndex: MAX_SESSION_REPLAY_CHUNKS_PER_SESSION - 1 }),
      ),
    ).toBe(true);
  });

  test("a tab one index short of the cap, without a final chunk, has not ended", () => {
    expect(
      hasTabRecordingEnded(
        liveTab({ maxChunkIndex: MAX_SESSION_REPLAY_CHUNKS_PER_SESSION - 2 }),
      ),
    ).toBe(false);
  });

  test("the cap ends a tab even when its other facts would not", () => {
    expect(
      hasTabRecordingEnded(
        endedTab({
          lastChunkStartUnixMs:
            PAGEHIDE + SESSION_REPLAY_ENDED_TRAILING_CHUNK_TOLERANCE_MS * 4,
          maxChunkIndex: MAX_SESSION_REPLAY_CHUNKS_PER_SESSION - 1,
        }),
      ),
    ).toBe(true);
  });

  test.each([
    ["finalChunkEndUnixMs NaN", { finalChunkEndUnixMs: Number.NaN }],
    [
      "finalChunkEndUnixMs Infinity",
      { finalChunkEndUnixMs: Number.POSITIVE_INFINITY },
    ],
    ["lastChunkStartUnixMs NaN", { lastChunkStartUnixMs: Number.NaN }],
    [
      "lastChunkStartUnixMs -Infinity",
      { lastChunkStartUnixMs: Number.NEGATIVE_INFINITY },
    ],
  ] as Array<[string, Partial<SessionReplayTabEndFacts>]>)(
    "a sealed tab with a non-finite clock (%s) is never read as ended",
    (_label: string, overrides: Partial<SessionReplayTabEndFacts>) => {
      /*
       * A clock that could not be measured must not pass the comparison:
       * -Infinity as the last start, or +Infinity as the final end, would
       * otherwise make any tab look ended.
       */
      expect(hasTabRecordingEnded(endedTab(overrides))).toBe(false);
    },
  );

  test.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ] as Array<[string, number]>)(
    "a non-finite maxChunkIndex (%s) never reads as capped, and does not unseal a sealed tab",
    (_label: string, maxChunkIndex: number) => {
      expect(
        hasTabRecordingEnded(liveTab({ maxChunkIndex: maxChunkIndex })),
      ).toBe(false);
      expect(
        hasTabRecordingEnded(endedTab({ maxChunkIndex: maxChunkIndex })),
      ).toBe(true);
    },
  );

  test("a final chunk whose clock sits at epoch 0 is still judged by the comparison, not by truthiness", () => {
    expect(
      hasTabRecordingEnded(
        endedTab({ finalChunkEndUnixMs: 0, lastChunkStartUnixMs: 0 }),
      ),
    ).toBe(true);
  });
});

describe("hasSessionRecordingEnded", () => {
  test("no tabs is 'not known', never 'ended'", () => {
    expect(hasSessionRecordingEnded([], GRACE_PASSED)).toBe(false);
    expect(hasSessionRecordingEnded([], Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  test("a single ended tab ends the session once the grace has passed", () => {
    expect(hasSessionRecordingEnded([endedTab()], GRACE_PASSED)).toBe(true);
  });

  /*
   * Grace boundaries, on the server write time of the newest chunk. This
   * is what keeps a multi-page app's navigation from reading as "ended"
   * while the next page has not stored its first chunk yet.
   */
  test("exactly the grace after the last chunk was stored is ended; 1 ms less is not", () => {
    expect(hasSessionRecordingEnded([endedTab()], GRACE_PASSED)).toBe(true);
    expect(hasSessionRecordingEnded([endedTab()], GRACE_PASSED - 1)).toBe(
      false,
    );
  });

  test("a tab sealed moments ago is not ended yet, however old its device clocks look", () => {
    expect(
      hasSessionRecordingEnded(
        [
          endedTab({
            finalChunkEndUnixMs: PAGEHIDE - 6 * 60 * 60 * 1000,
            lastChunkStartUnixMs: PAGEHIDE - 6 * 60 * 60 * 1000 - 12_000,
          }),
        ],
        STORED_AT + 1_000,
      ),
    ).toBe(false);
  });

  test("the newest tab's stored time decides the grace", () => {
    const pageA: SessionReplayTabEndFacts = endedTab({
      lastChunkStoredAtUnixMs: STORED_AT - 10 * 60 * 1000,
    });
    const pageB: SessionReplayTabEndFacts = endedTab({
      lastChunkStoredAtUnixMs: STORED_AT,
    });

    /* Page A alone is long past the grace. */
    expect(
      hasSessionRecordingEnded(
        [pageA],
        STORED_AT - 10 * 60 * 1000 + SESSION_REPLAY_ENDED_FINALIZE_GRACE_MS,
      ),
    ).toBe(true);

    /* With page B, the session waits on B, in either order. */
    expect(hasSessionRecordingEnded([pageA, pageB], GRACE_PASSED - 1)).toBe(
      false,
    );
    expect(hasSessionRecordingEnded([pageB, pageA], GRACE_PASSED - 1)).toBe(
      false,
    );
    expect(hasSessionRecordingEnded([pageA, pageB], GRACE_PASSED)).toBe(true);
    expect(hasSessionRecordingEnded([pageB, pageA], GRACE_PASSED)).toBe(true);
  });

  test("a capped tab ends the session after the grace, and not before", () => {
    const capped: SessionReplayTabEndFacts = liveTab({
      maxChunkIndex: MAX_SESSION_REPLAY_CHUNKS_PER_SESSION - 1,
    });

    expect(hasSessionRecordingEnded([capped], GRACE_PASSED)).toBe(true);
    expect(hasSessionRecordingEnded([capped], GRACE_PASSED - 1)).toBe(false);
    expect(
      hasSessionRecordingEnded(
        [
          liveTab({
            maxChunkIndex: MAX_SESSION_REPLAY_CHUNKS_PER_SESSION - 2,
          }),
        ],
        GRACE_PASSED,
      ),
    ).toBe(false);
  });

  test("a single live tab keeps the session recording, however long ago it was stored", () => {
    expect(
      hasSessionRecordingEnded([liveTab()], GRACE_PASSED + 60 * 60 * 1000),
    ).toBe(false);
  });

  test("every tab ended ends the session", () => {
    const tabs: Array<SessionReplayTabEndFacts> = [
      endedTab(),
      tabFromChunks([...closedTabChunks(14_900), trailingVisibilityChunk(3)]),
    ];

    /*
     * The trailing chunk was stored after the second tab's seal, so it is
     * the newest row of the session and the grace runs from it.
     */
    const newestStoredAt: number = tabs[1]!.lastChunkStoredAtUnixMs;
    expect(newestStoredAt).toBeGreaterThan(STORED_AT);

    expect(
      hasSessionRecordingEnded(
        tabs,
        newestStoredAt + SESSION_REPLAY_ENDED_FINALIZE_GRACE_MS,
      ),
    ).toBe(true);
    expect(
      hasSessionRecordingEnded(
        tabs,
        newestStoredAt + SESSION_REPLAY_ENDED_FINALIZE_GRACE_MS - 1,
      ),
    ).toBe(false);
  });

  test("a multi-page app: page A closed, page B (its own tab id) still recording, is not ended", () => {
    expect(
      hasSessionRecordingEnded(
        [
          endedTab({ lastChunkStoredAtUnixMs: STORED_AT - 5 * 60 * 1000 }),
          liveTab(),
        ],
        GRACE_PASSED + 60 * 60 * 1000,
      ),
    ).toBe(false);
  });

  test("one live tab among ended ones keeps the whole session recording", () => {
    expect(
      hasSessionRecordingEnded(
        [endedTab(), liveTab(), endedTab()],
        GRACE_PASSED,
      ),
    ).toBe(false);
  });

  test.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ] as Array<[string, number]>)(
    "a non-finite lastChunkStoredAtUnixMs (%s) on any tab keeps the session recording",
    (_label: string, storedAt: number) => {
      expect(
        hasSessionRecordingEnded(
          [endedTab({ lastChunkStoredAtUnixMs: storedAt })],
          GRACE_PASSED,
        ),
      ).toBe(false);
      expect(
        hasSessionRecordingEnded(
          [endedTab(), endedTab({ lastChunkStoredAtUnixMs: storedAt })],
          Number.MAX_SAFE_INTEGER,
        ),
      ).toBe(false);
    },
  );

  test.each([
    ["finalChunkEndUnixMs NaN", { finalChunkEndUnixMs: Number.NaN }],
    [
      "finalChunkEndUnixMs Infinity",
      { finalChunkEndUnixMs: Number.POSITIVE_INFINITY },
    ],
    ["lastChunkStartUnixMs NaN", { lastChunkStartUnixMs: Number.NaN }],
    [
      "lastChunkStartUnixMs Infinity",
      { lastChunkStartUnixMs: Number.POSITIVE_INFINITY },
    ],
  ] as Array<[string, Partial<SessionReplayTabEndFacts>]>)(
    "one tab with an unmeasurable device clock (%s) keeps the session recording",
    (_label: string, overrides: Partial<SessionReplayTabEndFacts>) => {
      expect(
        hasSessionRecordingEnded(
          [endedTab(), endedTab(overrides)],
          GRACE_PASSED,
        ),
      ).toBe(false);
    },
  );

  test.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ] as Array<[string, number]>)(
    "a non-finite maxChunkIndex (%s) does not make a live tab end the session",
    (_label: string, maxChunkIndex: number) => {
      expect(
        hasSessionRecordingEnded(
          [liveTab({ maxChunkIndex: maxChunkIndex })],
          GRACE_PASSED,
        ),
      ).toBe(false);
    },
  );

  test.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ] as Array<[string, number]>)(
    "a non-finite now (%s) is never 'ended'",
    (_label: string, nowUnixMs: number) => {
      /* +Infinity would otherwise put every stored time past the grace. */
      expect(hasSessionRecordingEnded([endedTab()], nowUnixMs)).toBe(false);
    },
  );

  test("accepts a readonly array and does not mutate it", () => {
    const tab: SessionReplayTabEndFacts = endedTab();
    const tabs: ReadonlyArray<SessionReplayTabEndFacts> = Object.freeze([tab]);

    expect(hasSessionRecordingEnded(tabs, GRACE_PASSED)).toBe(true);
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toEqual(endedTab());
  });
});
