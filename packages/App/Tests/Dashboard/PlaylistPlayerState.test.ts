import { describe, expect, test } from "@jest/globals";
import { PlaylistEntry } from "../../FeatureSet/Dashboard/src/Components/Dashboard/Playlist/PlaylistDashboards";
import {
  getPlaylistTurnRemainingMs,
  isLastInPlaylistRound,
} from "../../FeatureSet/Dashboard/src/Components/Dashboard/Playlist/PlaylistPlayback";
import {
  INITIAL_PLAYLIST_PLAYER_STATE,
  PlaylistPlayerState,
  PlaylistPlayerStatus,
  PlaylistRound,
  advancePlaylistPlayer,
  getCurrentPlaylistEntry,
  getPlaylistRoundIntervalMs,
  getUpcomingPlaylistEntry,
  isTimeToReadNextRound,
  pausePlaylistPlayer,
  receiveNextRound,
  receivePlaylistReadError,
  receivePlaylistRound,
  resumePlaylistPlayer,
  togglePlaylistPlayerPause,
} from "../../FeatureSet/Dashboard/src/Components/Dashboard/Playlist/PlaylistPlayerState";

/*
 * The player's state and its steps (issue #5235), with the clock handed in:
 * the playlist read as a round, a turn after a turn, the playlist read
 * again in each round's last turn and played from the next turn on, and
 * what the player says when there is nothing to play - empty, gone, or a
 * read that failed.
 */

const T0: number = Date.UTC(2026, 9, 27, 22, 0, 0);
const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;

function entry(key: string, name: string): PlaylistEntry {
  return {
    key: key,
    dashboardId: `5f8b9c0d-e1a2-4b3c-8d5e-${key.padStart(12, "0")}`,
    name: name,
  };
}

const OVERVIEW: PlaylistEntry = entry("1", "Production overview");
const CLUSTERS: PlaylistEntry = entry("2", "Kubernetes clusters");
const DATABASES: PlaylistEntry = entry("3", "Databases");
const QUEUES: PlaylistEntry = entry("4", "Queues");

function round(
  entries: Array<PlaylistEntry>,
  intervalInSeconds: number = 60,
  name: string = "NOC wall",
): PlaylistRound {
  return { name, intervalInSeconds, entries };
}

function playing(
  entries: Array<PlaylistEntry> = [OVERVIEW, CLUSTERS, DATABASES],
): PlaylistPlayerState {
  return receivePlaylistRound(
    INITIAL_PLAYLIST_PLAYER_STATE,
    round(entries),
    T0,
  );
}

function names(state: PlaylistPlayerState): string | null {
  return getCurrentPlaylistEntry(state)?.name || null;
}

describe("opening the player", () => {
  test("starts in Loading, with nothing on screen", () => {
    expect(INITIAL_PLAYLIST_PLAYER_STATE.status).toBe(
      PlaylistPlayerStatus.Loading,
    );
    expect(getCurrentPlaylistEntry(INITIAL_PLAYLIST_PLAYER_STATE)).toBeNull();
    expect(getUpcomingPlaylistEntry(INITIAL_PLAYLIST_PLAYER_STATE)).toBeNull();
  });

  test("a playlist with dashboards plays its first, the next one coming", () => {
    const state: PlaylistPlayerState = playing();

    expect(state.status).toBe(PlaylistPlayerStatus.Playing);
    expect(names(state)).toBe("Production overview");
    expect(getUpcomingPlaylistEntry(state)).toBe(CLUSTERS);
    expect(state.playback?.intervalMs).toBe(MINUTE);
    expect(state.roundNumber).toBe(1);
    expect(state.nextRound).toBeUndefined();
    expect(state.errorMessage).toBeNull();
  });

  test("a playlist with no dashboard the viewer may see shows nothing - and remembers the playlist", () => {
    const state: PlaylistPlayerState = receivePlaylistRound(
      INITIAL_PLAYLIST_PLAYER_STATE,
      round([], 30, "Draft"),
      T0,
    );

    expect(state.status).toBe(PlaylistPlayerStatus.Empty);
    expect(state.playback).toBeNull();
    expect(state.round?.name).toBe("Draft");
    expect(getCurrentPlaylistEntry(state)).toBeNull();
  });

  test("a playlist that is not found says so", () => {
    const state: PlaylistPlayerState = receivePlaylistRound(
      INITIAL_PLAYLIST_PLAYER_STATE,
      null,
      T0,
    );

    expect(state.status).toBe(PlaylistPlayerStatus.NotFound);
    expect(state.round).toBeNull();
  });

  test("a read that failed says why", () => {
    const state: PlaylistPlayerState = receivePlaylistReadError(
      INITIAL_PLAYLIST_PLAYER_STATE,
      "The network is down.",
    );

    expect(state.status).toBe(PlaylistPlayerStatus.Error);
    expect(state.errorMessage).toBe("The network is down.");
  });

  test("a playlist read again after a failure plays", () => {
    const failed: PlaylistPlayerState = receivePlaylistReadError(
      INITIAL_PLAYLIST_PLAYER_STATE,
      "Down.",
    );
    const state: PlaylistPlayerState = receivePlaylistRound(
      failed,
      round([OVERVIEW]),
      T0,
    );

    expect(state.status).toBe(PlaylistPlayerStatus.Playing);
    expect(state.errorMessage).toBeNull();
  });

  test("an empty playlist read again with dashboards starts playing them", () => {
    const empty: PlaylistPlayerState = receivePlaylistRound(
      INITIAL_PLAYLIST_PLAYER_STATE,
      round([]),
      T0,
    );
    const state: PlaylistPlayerState = receivePlaylistRound(
      empty,
      round([QUEUES]),
      T0 + MINUTE,
    );

    expect(state.status).toBe(PlaylistPlayerStatus.Playing);
    expect(names(state)).toBe("Queues");
  });

  test("while a rotation plays, a stray first read or failure changes nothing", () => {
    const state: PlaylistPlayerState = playing();

    expect(receivePlaylistRound(state, round([QUEUES]), T0)).toBe(state);
    expect(receivePlaylistRound(state, null, T0)).toBe(state);
    expect(receivePlaylistReadError(state, "Down.")).toBe(state);
  });

  test("the round's interval in milliseconds", () => {
    expect(getPlaylistRoundIntervalMs(round([OVERVIEW], 45))).toBe(45 * SECOND);
  });
});

describe("turn after turn", () => {
  test("Next and the end of a turn go on in the playlist's order", () => {
    let state: PlaylistPlayerState = playing();

    state = advancePlaylistPlayer(state, 1, T0 + MINUTE);
    expect(names(state)).toBe("Kubernetes clusters");
    expect(getUpcomingPlaylistEntry(state)).toBe(DATABASES);

    state = advancePlaylistPlayer(state, 1, T0 + 2 * MINUTE);
    expect(names(state)).toBe("Databases");
    expect(getUpcomingPlaylistEntry(state)).toBe(OVERVIEW);
  });

  test("Previous goes back, and from the first to the round's last", () => {
    let state: PlaylistPlayerState = playing();

    state = advancePlaylistPlayer(state, -1, T0 + SECOND);
    expect(names(state)).toBe("Databases");

    state = advancePlaylistPlayer(state, -1, T0 + 2 * SECOND);
    expect(names(state)).toBe("Kubernetes clusters");
  });

  test("each new turn has the whole interval ahead", () => {
    const state: PlaylistPlayerState = advancePlaylistPlayer(
      playing(),
      1,
      T0 + 40 * SECOND,
    );

    expect(getPlaylistTurnRemainingMs(state.playback!, T0 + 40 * SECOND)).toBe(
      MINUTE,
    );
  });

  test("a dashboard the playlist names twice is shown twice, as two turns", () => {
    const overviewAgain: PlaylistEntry = entry("5", "Production overview");
    let state: PlaylistPlayerState = playing([
      OVERVIEW,
      CLUSTERS,
      overviewAgain,
    ]);

    state = advancePlaylistPlayer(state, 1, T0 + MINUTE);
    state = advancePlaylistPlayer(state, 1, T0 + 2 * MINUTE);

    expect(getCurrentPlaylistEntry(state)).toBe(overviewAgain);
    expect(getCurrentPlaylistEntry(state)?.key).not.toBe(OVERVIEW.key);
  });

  test("steps do nothing while nothing plays", () => {
    const empty: PlaylistPlayerState = receivePlaylistRound(
      INITIAL_PLAYLIST_PLAYER_STATE,
      round([]),
      T0,
    );

    expect(advancePlaylistPlayer(empty, 1, T0)).toBe(empty);
    expect(advancePlaylistPlayer(INITIAL_PLAYLIST_PLAYER_STATE, -1, T0)).toBe(
      INITIAL_PLAYLIST_PLAYER_STATE,
    );
    expect(togglePlaylistPlayerPause(empty, T0)).toBe(empty);
    expect(pausePlaylistPlayer(empty, T0)).toBe(empty);
    expect(resumePlaylistPlayer(empty, T0)).toBe(empty);
  });
});

describe("pausing the player", () => {
  test("pauses and plays again, the dashboard on screen kept", () => {
    const paused: PlaylistPlayerState = pausePlaylistPlayer(
      playing(),
      T0 + 10 * SECOND,
    );

    expect(paused.playback?.isPaused).toBe(true);
    expect(names(paused)).toBe("Production overview");

    const resumed: PlaylistPlayerState = resumePlaylistPlayer(
      paused,
      T0 + 10 * MINUTE,
    );

    expect(resumed.playback?.isPaused).toBe(false);
    expect(
      getPlaylistTurnRemainingMs(resumed.playback!, T0 + 10 * MINUTE),
    ).toBe(50 * SECOND);
  });

  test("toggles", () => {
    const once: PlaylistPlayerState = togglePlaylistPlayerPause(playing(), T0);

    expect(once.playback?.isPaused).toBe(true);
    expect(togglePlaylistPlayerPause(once, T0).playback?.isPaused).toBe(false);
  });
});

describe("reading the playlist again, once a round", () => {
  test("is asked for in the round's last turn, and only then", () => {
    let state: PlaylistPlayerState = playing();

    expect(isTimeToReadNextRound(state)).toBe(false);

    state = advancePlaylistPlayer(state, 1, T0 + MINUTE);
    expect(isTimeToReadNextRound(state)).toBe(false);

    state = advancePlaylistPlayer(state, 1, T0 + 2 * MINUTE);
    expect(isLastInPlaylistRound(state.playback!)).toBe(true);
    expect(isTimeToReadNextRound(state)).toBe(true);

    state = receiveNextRound(state, state.roundNumber, round([OVERVIEW]));
    expect(isTimeToReadNextRound(state)).toBe(false);
  });

  test("with one dashboard, every turn is a round's last", () => {
    expect(isTimeToReadNextRound(playing([OVERVIEW]))).toBe(true);
  });

  test("the playlist as read again plays from the next turn: added, removed and moved dashboards, a new interval", () => {
    let state: PlaylistPlayerState = playing();

    state = advancePlaylistPlayer(state, 1, T0 + MINUTE);
    state = advancePlaylistPlayer(state, 1, T0 + 2 * MINUTE);

    const roundNumber: number = state.roundNumber;

    state = receiveNextRound(
      state,
      roundNumber,
      round([QUEUES, OVERVIEW], 30, "NOC wall (night)"),
    );

    // What comes next is already the new round's first: drawn ahead of its turn.
    expect(names(state)).toBe("Databases");
    expect(getUpcomingPlaylistEntry(state)).toBe(QUEUES);

    state = advancePlaylistPlayer(state, 1, T0 + 3 * MINUTE);

    expect(state.roundNumber).toBe(roundNumber + 1);
    expect(state.round?.name).toBe("NOC wall (night)");
    expect(names(state)).toBe("Queues");
    expect(state.playback?.count).toBe(2);
    expect(state.playback?.intervalMs).toBe(30 * SECOND);
    expect(state.nextRound).toBeUndefined();
    expect(getUpcomingPlaylistEntry(state)).toBe(OVERVIEW);
  });

  test("a read again that has not answered, or failed, plays the same round once more", () => {
    let state: PlaylistPlayerState = playing([OVERVIEW, CLUSTERS]);

    state = advancePlaylistPlayer(state, 1, T0 + MINUTE);

    const roundNumber: number = state.roundNumber;

    state = advancePlaylistPlayer(state, 1, T0 + 2 * MINUTE);

    expect(names(state)).toBe("Production overview");
    expect(state.roundNumber).toBe(roundNumber + 1);
    expect(state.round?.entries).toEqual([OVERVIEW, CLUSTERS]);
  });

  test("an answer for a round that has ended is dropped", () => {
    let state: PlaylistPlayerState = playing([OVERVIEW]);
    const stale: number = state.roundNumber;

    state = advancePlaylistPlayer(state, 1, T0 + MINUTE);
    state = receiveNextRound(state, stale, round([QUEUES]));

    expect(state.nextRound).toBeUndefined();
  });

  test("a playlist emptied since - every dashboard removed, deleted or archived - shows the empty screen at the round's end", () => {
    let state: PlaylistPlayerState = playing([OVERVIEW]);

    state = receiveNextRound(state, state.roundNumber, round([], 60));
    expect(getUpcomingPlaylistEntry(state)).toBeNull();

    state = advancePlaylistPlayer(state, 1, T0 + MINUTE);

    expect(state.status).toBe(PlaylistPlayerStatus.Empty);
    expect(state.playback).toBeNull();
  });

  test("a playlist deleted since ends with the round, and says it is gone", () => {
    let state: PlaylistPlayerState = playing([OVERVIEW, CLUSTERS]);

    state = advancePlaylistPlayer(state, 1, T0 + MINUTE);
    state = receiveNextRound(state, state.roundNumber, null);

    // Still on screen until its turn ends: a wall never goes blank mid-turn.
    expect(names(state)).toBe("Kubernetes clusters");
    expect(getUpcomingPlaylistEntry(state)).toBeNull();

    state = advancePlaylistPlayer(state, 1, T0 + 2 * MINUTE);

    expect(state.status).toBe(PlaylistPlayerStatus.NotFound);
    expect(state.round).toBeNull();
  });

  test("a new round keeps a pause", () => {
    let state: PlaylistPlayerState = playing([OVERVIEW]);

    state = pausePlaylistPlayer(state, T0 + SECOND);
    state = receiveNextRound(state, state.roundNumber, round([CLUSTERS]));
    state = advancePlaylistPlayer(state, 1, T0 + 2 * SECOND);

    expect(names(state)).toBe("Kubernetes clusters");
    expect(state.playback?.isPaused).toBe(true);
  });

  test("Previous in the round's last turn stays in the round", () => {
    let state: PlaylistPlayerState = playing();

    state = advancePlaylistPlayer(state, -1, T0 + SECOND);
    state = receiveNextRound(state, state.roundNumber, round([QUEUES]));
    state = advancePlaylistPlayer(state, -1, T0 + 2 * SECOND);

    expect(names(state)).toBe("Kubernetes clusters");
    expect(state.round?.entries).toEqual([OVERVIEW, CLUSTERS, DATABASES]);
  });

  test("a read again is ignored once the player has stopped playing", () => {
    const empty: PlaylistPlayerState = receivePlaylistRound(
      INITIAL_PLAYLIST_PLAYER_STATE,
      round([]),
      T0,
    );

    expect(receiveNextRound(empty, empty.roundNumber, round([OVERVIEW]))).toBe(
      empty,
    );
  });
});
