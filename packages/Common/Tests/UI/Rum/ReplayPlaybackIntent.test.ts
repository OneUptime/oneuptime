import { describe, expect, it } from "@jest/globals";
import {
  DEFAULT_SKIP_INACTIVE,
  END_OF_RECORDING_TOLERANCE_MS,
  FEED_AHEAD_FLOOR_MS,
  IDLE_SKIP_PREROLL_MS,
  MAX_PREFETCH_PAGES_AHEAD,
  computeFeedAheadMs,
  computePrefetchPagesAhead,
  getIdleSkipTargetMs,
  shouldRewindBeforePlay,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayPlaybackIntent";

/*
 * The two playback defaults behind the reported "Play does nothing".
 *
 * They are pinned here rather than inside the player component because both
 * are product decisions with a specific failure mode behind them, and a
 * future refactor flipping either one back would reintroduce a bug that
 * takes a browser, a real recording and a stopwatch to notice.
 */

describe("DEFAULT_SKIP_INACTIVE", () => {
  it("is off, so playback is faithful and cannot outrun the loader", () => {
    /*
     * Skip-inactive is rrweb fast-forwarding. Chunks arrive one 15-second
     * window at a time over an authenticated fetch, so a fast-forward
     * drains the fed range, rrweb emits Finish, and the stage sits stalled -
     * on the very first press of Play, for any recording that opens with a
     * few idle seconds while the page loads.
     */
    expect(DEFAULT_SKIP_INACTIVE).toBe(false);
  });
});

describe("shouldRewindBeforePlay", () => {
  it("rewinds when the playhead is sitting at the end", () => {
    /*
     * rrweb has nothing left to cast there: it emits Finish immediately and
     * stops again, so the button flips to pause and straight back while the
     * picture never moves. Every viewer who watches a session through and
     * then presses Play hits this.
     */
    expect(shouldRewindBeforePlay(60000, 60000)).toBe(true);
  });

  it("rewinds from inside one playback tick of the end", () => {
    /*
     * The last frame rarely lands on the exact millisecond the manifest
     * calls the end, so an exact comparison would miss this on nearly every
     * session.
     */
    expect(
      shouldRewindBeforePlay(60000 - END_OF_RECORDING_TOLERANCE_MS, 60000),
    ).toBe(true);
    expect(
      shouldRewindBeforePlay(60000 - END_OF_RECORDING_TOLERANCE_MS + 1, 60000),
    ).toBe(true);
  });

  it("leaves the playhead alone anywhere else in the recording", () => {
    expect(shouldRewindBeforePlay(0, 60000)).toBe(false);
    expect(shouldRewindBeforePlay(30000, 60000)).toBe(false);
    expect(
      shouldRewindBeforePlay(60000 - END_OF_RECORDING_TOLERANCE_MS - 1, 60000),
    ).toBe(false);
  });

  it("rewinds when the playhead has run past the stated duration", () => {
    /*
     * The manifest's duration and the recorder's own clock disagree by the
     * clock skew, so the playhead genuinely can end up past it. That is
     * still the end of the recording.
     */
    expect(shouldRewindBeforePlay(61000, 60000)).toBe(true);
  });

  it("never rewinds a recording whose duration is not known yet", () => {
    /*
     * Zero is what the loader reports before the manifest is read, or for a
     * session whose footage is gone. Treating it as "at the end" would fire
     * a seek to 0 on the first press of Play on every single session.
     */
    expect(shouldRewindBeforePlay(0, 0)).toBe(false);
    expect(shouldRewindBeforePlay(5000, 0)).toBe(false);
    expect(shouldRewindBeforePlay(0, -1)).toBe(false);
  });

  it("survives the non-finite values a parsed manifest can produce", () => {
    /*
     * Both sides are read off an untyped JSON projection, so NaN is
     * reachable without anything being wrong upstream.
     */
    expect(shouldRewindBeforePlay(Number.NaN, 60000)).toBe(false);
    expect(shouldRewindBeforePlay(1000, Number.NaN)).toBe(false);
    expect(shouldRewindBeforePlay(1000, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("computeFeedAheadMs", () => {
  it("keeps two flush intervals of headroom at ordinary speeds", () => {
    expect(computeFeedAheadMs(0.5)).toBe(FEED_AHEAD_FLOOR_MS);
    expect(computeFeedAheadMs(1)).toBe(FEED_AHEAD_FLOOR_MS);
    expect(computeFeedAheadMs(1.5)).toBe(FEED_AHEAD_FLOOR_MS);
  });

  it("grows with the speed so 8x cannot outrun a slow fetch", () => {
    /*
     * At 8x, 30s of footage plays out in under four seconds - less than
     * one slow /chunks round trip - so the window has to grow with speed.
     */
    expect(computeFeedAheadMs(2)).toBe(40000);
    expect(computeFeedAheadMs(4)).toBe(80000);
    expect(computeFeedAheadMs(8)).toBe(160000);
  });

  it("falls back to the floor for a nonsense speed", () => {
    expect(computeFeedAheadMs(0)).toBe(FEED_AHEAD_FLOOR_MS);
    expect(computeFeedAheadMs(Number.NaN)).toBe(FEED_AHEAD_FLOOR_MS);
  });
});

describe("computePrefetchPagesAhead", () => {
  it("warms two pages normally and four from 4x", () => {
    expect(computePrefetchPagesAhead(1)).toBe(2);
    expect(computePrefetchPagesAhead(2)).toBe(2);
    expect(computePrefetchPagesAhead(4)).toBe(4);
    expect(computePrefetchPagesAhead(8)).toBe(4);
  });

  it("never asks for more pages than MAX_PREFETCH_PAGES_AHEAD", () => {
    /*
     * ChunkLoader sizes its decoded cache from this constant. If a speed
     * could ask for more, the cache would evict footage that had been
     * fetched and not yet fed, and the feed loop would fetch it back.
     */
    for (const speed of [0.25, 0.5, 1, 2, 4, 8, 16, Number.NaN]) {
      expect(computePrefetchPagesAhead(speed)).toBeLessThanOrEqual(
        MAX_PREFETCH_PAGES_AHEAD,
      );
    }
  });
});

describe("getIdleSkipTargetMs", () => {
  it("lands one second before the band ends, never before it starts", () => {
    expect(getIdleSkipTargetMs({ startMs: 10000, endMs: 40000 })).toBe(
      40000 - IDLE_SKIP_PREROLL_MS,
    );
    expect(getIdleSkipTargetMs({ startMs: 10000, endMs: 10500 })).toBe(10000);
  });
});
