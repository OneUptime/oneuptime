import { describe, expect, test } from "@jest/globals";
import {
  PlaylistPlayback,
  getNextPlaylistIndex,
  getPlaylistTurnElapsedMs,
  getPlaylistTurnRemainingMs,
  getPreviousPlaylistIndex,
  isLastInPlaylistRound,
  isPlaylistTurnOver,
  pausePlaylist,
  resumePlaylist,
  showNextPlaylistDashboard,
  showPlaylistIndex,
  showPreviousPlaylistDashboard,
  startNextPlaylistRound,
  startPlaylistPlayback,
  togglePlaylistPause,
  wrapPlaylistIndex,
} from "../../FeatureSet/Dashboard/src/Components/Dashboard/Playlist/PlaylistPlayback";

/*
 * A playlist's rotation as plain data (issue #5235): which dashboard is on
 * screen, how much of its turn has passed, and whether the rotation is
 * paused. Every step takes the time it happens at, so these tests walk
 * whole rotations - minutes, a night - with numbers instead of waits.
 */

const T0: number = Date.UTC(2026, 9, 27, 10, 0, 0);
const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;

function play(count: number, intervalMs: number = MINUTE): PlaylistPlayback {
  return startPlaylistPlayback({ count, intervalMs, now: T0 });
}

describe("starting a rotation", () => {
  test("starts on the first dashboard, playing, with the whole turn ahead", () => {
    const playback: PlaylistPlayback = play(3);

    expect(playback.index).toBe(0);
    expect(playback.count).toBe(3);
    expect(playback.intervalMs).toBe(MINUTE);
    expect(playback.isPaused).toBe(false);
    expect(getPlaylistTurnElapsedMs(playback, T0)).toBe(0);
    expect(getPlaylistTurnRemainingMs(playback, T0)).toBe(MINUTE);
  });

  test("starts where asked, paused if asked, and keeps the index inside the rotation", () => {
    expect(
      startPlaylistPlayback({ count: 3, intervalMs: MINUTE, now: T0, index: 2 })
        .index,
    ).toBe(2);
    expect(
      startPlaylistPlayback({ count: 3, intervalMs: MINUTE, now: T0, index: 4 })
        .index,
    ).toBe(1);
    expect(
      startPlaylistPlayback({
        count: 3,
        intervalMs: MINUTE,
        now: T0,
        isPaused: true,
      }).isPaused,
    ).toBe(true);
  });

  test("never has a turn of no time, nor fewer than no dashboards", () => {
    expect(
      startPlaylistPlayback({ count: 2, intervalMs: 0, now: T0 }).intervalMs,
    ).toBe(1);
    expect(
      startPlaylistPlayback({ count: -1, intervalMs: 5, now: T0 }).count,
    ).toBe(0);
  });
});

describe("a turn's time", () => {
  test("passes with the clock, and is over once the interval has passed", () => {
    const playback: PlaylistPlayback = play(3);

    expect(isPlaylistTurnOver(playback, T0 + 59 * SECOND)).toBe(false);
    expect(getPlaylistTurnRemainingMs(playback, T0 + 59 * SECOND)).toBe(SECOND);
    expect(isPlaylistTurnOver(playback, T0 + MINUTE)).toBe(true);
    expect(isPlaylistTurnOver(playback, T0 + 10 * MINUTE)).toBe(true);
  });

  test("is held between none and the whole interval, whatever the clock says", () => {
    const playback: PlaylistPlayback = play(2);

    // A clock moved back (a time sync) reads as the turn's start.
    expect(getPlaylistTurnElapsedMs(playback, T0 - 5 * SECOND)).toBe(0);
    expect(getPlaylistTurnRemainingMs(playback, T0 - 5 * SECOND)).toBe(MINUTE);
    // A tab the browser let sleep reads as the turn's end.
    expect(getPlaylistTurnElapsedMs(playback, T0 + 3 * MINUTE)).toBe(MINUTE);
    expect(getPlaylistTurnRemainingMs(playback, T0 + 3 * MINUTE)).toBe(0);
  });

  test("a rotation with nothing to show never ends a turn", () => {
    expect(isPlaylistTurnOver(play(0), T0 + 10 * MINUTE)).toBe(false);
  });
});

describe("pausing", () => {
  test("stops the turn where it is, however long the pause", () => {
    const paused: PlaylistPlayback = pausePlaylist(play(3), T0 + 20 * SECOND);

    expect(paused.isPaused).toBe(true);
    expect(getPlaylistTurnElapsedMs(paused, T0 + 20 * SECOND)).toBe(
      20 * SECOND,
    );
    expect(getPlaylistTurnElapsedMs(paused, T0 + 2 * 60 * MINUTE)).toBe(
      20 * SECOND,
    );
    expect(isPlaylistTurnOver(paused, T0 + 2 * 60 * MINUTE)).toBe(false);
  });

  test("resuming gives the dashboard the rest of its turn, not a new one", () => {
    const paused: PlaylistPlayback = pausePlaylist(play(3), T0 + 20 * SECOND);
    const resumed: PlaylistPlayback = resumePlaylist(paused, T0 + 5 * MINUTE);

    expect(resumed.isPaused).toBe(false);
    expect(getPlaylistTurnRemainingMs(resumed, T0 + 5 * MINUTE)).toBe(
      40 * SECOND,
    );
    expect(isPlaylistTurnOver(resumed, T0 + 5 * MINUTE + 39 * SECOND)).toBe(
      false,
    );
    expect(isPlaylistTurnOver(resumed, T0 + 5 * MINUTE + 40 * SECOND)).toBe(
      true,
    );
  });

  test("pausing a paused rotation, or resuming a playing one, changes nothing", () => {
    const paused: PlaylistPlayback = pausePlaylist(play(3), T0 + SECOND);

    expect(pausePlaylist(paused, T0 + MINUTE)).toBe(paused);

    const playing: PlaylistPlayback = play(3);

    expect(resumePlaylist(playing, T0 + MINUTE)).toBe(playing);
  });

  test("Space toggles one way and back", () => {
    const toggled: PlaylistPlayback = togglePlaylistPause(play(2), T0 + SECOND);

    expect(toggled.isPaused).toBe(true);
    expect(togglePlaylistPause(toggled, T0 + 2 * SECOND).isPaused).toBe(false);
  });

  test("a pause in the last second of a turn still keeps it on screen", () => {
    const paused: PlaylistPlayback = pausePlaylist(play(2), T0 + 59 * SECOND);

    expect(isPlaylistTurnOver(paused, T0 + 61 * SECOND)).toBe(false);
    expect(getPlaylistTurnRemainingMs(paused, T0 + 61 * SECOND)).toBe(SECOND);
  });
});

describe("Next and Previous", () => {
  test("Next goes on one dashboard and starts its turn now", () => {
    const next: PlaylistPlayback = showNextPlaylistDashboard(
      play(3),
      T0 + 10 * SECOND,
    );

    expect(next.index).toBe(1);
    expect(getPlaylistTurnRemainingMs(next, T0 + 10 * SECOND)).toBe(MINUTE);
  });

  test("Next after the last dashboard goes back to the first", () => {
    const last: PlaylistPlayback = showPlaylistIndex(play(3), 2, T0);

    expect(isLastInPlaylistRound(last)).toBe(true);
    expect(getNextPlaylistIndex(last)).toBe(0);
    expect(showNextPlaylistDashboard(last, T0).index).toBe(0);
  });

  test("Previous goes back one, and from the first to the last", () => {
    expect(getPreviousPlaylistIndex(play(3))).toBe(2);
    expect(showPreviousPlaylistDashboard(play(3), T0).index).toBe(2);
    expect(
      showPreviousPlaylistDashboard(showPlaylistIndex(play(3), 2, T0), T0)
        .index,
    ).toBe(1);
  });

  test("while paused, Next and Previous move and stay paused, the new turn untouched", () => {
    const paused: PlaylistPlayback = pausePlaylist(play(3), T0 + 30 * SECOND);
    const next: PlaylistPlayback = showNextPlaylistDashboard(
      paused,
      T0 + 40 * SECOND,
    );

    expect(next.isPaused).toBe(true);
    expect(next.index).toBe(1);
    expect(getPlaylistTurnElapsedMs(next, T0 + 10 * MINUTE)).toBe(0);
    expect(
      getPlaylistTurnRemainingMs(
        resumePlaylist(next, T0 + 11 * MINUTE),
        T0 + 11 * MINUTE,
      ),
    ).toBe(MINUTE);
  });

  test("one dashboard: every turn ends a round, and Next shows it again", () => {
    const single: PlaylistPlayback = play(1);

    expect(isLastInPlaylistRound(single)).toBe(true);
    expect(getNextPlaylistIndex(single)).toBe(0);
    expect(getPreviousPlaylistIndex(single)).toBe(0);
    expect(showNextPlaylistDashboard(single, T0 + MINUTE).index).toBe(0);
  });

  test("nothing to show is never the last of a round", () => {
    expect(isLastInPlaylistRound(play(0))).toBe(false);
  });
});

describe("a whole evening of rotation", () => {
  test("three dashboards at a minute each come round in order, every three minutes", () => {
    let playback: PlaylistPlayback = play(3);
    const shown: Array<number> = [playback.index];
    let now: number = T0;

    for (let turn: number = 0; turn < 12; turn++) {
      now = now + MINUTE;
      expect(isPlaylistTurnOver(playback, now)).toBe(true);
      playback = showNextPlaylistDashboard(playback, now);
      shown.push(playback.index);
    }

    expect(shown).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0]);
  });

  test("a turn woken late moves on one dashboard, never several", () => {
    const late: PlaylistPlayback = showNextPlaylistDashboard(
      play(5),
      T0 + 30 * MINUTE,
    );

    expect(late.index).toBe(1);
  });
});

describe("a new round", () => {
  test("starts from the first dashboard of the playlist as read again, with its own count and interval", () => {
    const last: PlaylistPlayback = showPlaylistIndex(play(3), 2, T0);
    const round: PlaylistPlayback = startNextPlaylistRound(last, {
      count: 5,
      intervalMs: 30 * SECOND,
      now: T0 + MINUTE,
    });

    expect(round.index).toBe(0);
    expect(round.count).toBe(5);
    expect(round.intervalMs).toBe(30 * SECOND);
    expect(getPlaylistTurnRemainingMs(round, T0 + MINUTE)).toBe(30 * SECOND);
  });

  test("keeps a pause", () => {
    const paused: PlaylistPlayback = pausePlaylist(play(2), T0);

    expect(
      startNextPlaylistRound(paused, { count: 2, intervalMs: MINUTE, now: T0 })
        .isPaused,
    ).toBe(true);
  });
});

describe("wrapping an index round the rotation", () => {
  test("in either direction, and to the start with nothing to show", () => {
    expect(wrapPlaylistIndex(3, 3)).toBe(0);
    expect(wrapPlaylistIndex(-1, 3)).toBe(2);
    expect(wrapPlaylistIndex(-4, 3)).toBe(2);
    expect(wrapPlaylistIndex(7, 3)).toBe(1);
    expect(wrapPlaylistIndex(5, 0)).toBe(0);
  });
});
