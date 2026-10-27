import { PlaylistEntry } from "./PlaylistDashboards";
import {
  PlaylistPlayback,
  getNextPlaylistIndex,
  isLastInPlaylistRound,
  pausePlaylist,
  resumePlaylist,
  showNextPlaylistDashboard,
  showPlaylistIndex,
  showPreviousPlaylistDashboard,
  startNextPlaylistRound,
  startPlaylistPlayback,
  togglePlaylistPause,
} from "./PlaylistPlayback";

/*
 * Everything the player knows, as plain data with pure transitions (issue
 * #5235). The hook (UsePlaylistPlayer) holds one of these, reads the
 * playlist when a transition asks for it, and runs the timer; what happens
 * at each step is decided here, where a test can step through a whole
 * evening of rotation without waiting for any of it.
 *
 * A ROUND is the playlist as read once: its name, its interval and the
 * dashboards of it the viewer may read, in order. The rotation plays a
 * round from its first dashboard to its last, and reads the playlist again
 * while the last one is on screen. The round read then is played from the
 * next turn on: a dashboard someone added, removed or moved since reaches
 * the screen within a round, without a reload, and one deleted or archived
 * in the meantime is gone from it. A read that fails keeps the round the
 * screen has, so a network blip never empties a wall.
 */

export enum PlaylistPlayerStatus {
  // Reading the playlist for the first time.
  Loading = "Loading",
  // A rotation is on screen.
  Playing = "Playing",
  /*
   * The playlist has no dashboard the viewer may read: none named, or all
   * of them deleted, archived or out of their reach. Read again now and
   * then, so the screen comes back once one is there.
   */
  Empty = "Empty",
  // The playlist was deleted, or the viewer may not read it.
  NotFound = "NotFound",
  // Reading the playlist failed. Tried again now and then.
  Error = "Error",
}

export interface PlaylistRound {
  name: string;
  intervalInSeconds: number;
  entries: Array<PlaylistEntry>;
}

export interface PlaylistPlayerState {
  status: PlaylistPlayerStatus;
  // The round on screen (Playing), or the last one read (Empty).
  round: PlaylistRound | null;
  // Where the rotation is in its round. Null unless Playing.
  playback: PlaylistPlayback | null;
  /*
   * Counts the rounds, so a read for a round that has ended is told apart
   * from one for the round now playing.
   */
  roundNumber: number;
  /*
   * The playlist read again during this round's last turn: what the next
   * round plays. Undefined until it is read; null when the read found the
   * playlist gone.
   */
  nextRound: PlaylistRound | null | undefined;
  errorMessage: string | null;
}

export const INITIAL_PLAYLIST_PLAYER_STATE: PlaylistPlayerState = {
  status: PlaylistPlayerStatus.Loading,
  round: null,
  playback: null,
  roundNumber: 0,
  nextRound: undefined,
  errorMessage: null,
};

const MILLISECONDS_PER_SECOND: number = 1000;

export function getPlaylistRoundIntervalMs(round: PlaylistRound): number {
  return round.intervalInSeconds * MILLISECONDS_PER_SECOND;
}

/*
 * A round to play from its first dashboard, its turn starting now - or the
 * player's word that there is nothing to play. `isPaused` carries a pause
 * over from the round before.
 */
function playRound(
  state: PlaylistPlayerState,
  round: PlaylistRound,
  now: number,
  isPaused: boolean,
): PlaylistPlayerState {
  if (round.entries.length === 0) {
    return {
      ...state,
      status: PlaylistPlayerStatus.Empty,
      round: round,
      playback: null,
      roundNumber: state.roundNumber + 1,
      nextRound: undefined,
      errorMessage: null,
    };
  }

  return {
    ...state,
    status: PlaylistPlayerStatus.Playing,
    round: round,
    playback: startPlaylistPlayback({
      count: round.entries.length,
      intervalMs: getPlaylistRoundIntervalMs(round),
      now: now,
      index: 0,
      isPaused: isPaused,
    }),
    roundNumber: state.roundNumber + 1,
    nextRound: undefined,
    errorMessage: null,
  };
}

/*
 * The playlist as read when the player has nothing on screen: as it opens,
 * and each time an empty or failed one is read again. Null means it was not
 * found. While a rotation is on screen, a read goes to receiveNextRound.
 */
export function receivePlaylistRound(
  state: PlaylistPlayerState,
  round: PlaylistRound | null,
  now: number,
): PlaylistPlayerState {
  if (state.status === PlaylistPlayerStatus.Playing) {
    return state;
  }

  if (!round) {
    return {
      ...state,
      status: PlaylistPlayerStatus.NotFound,
      round: null,
      playback: null,
      nextRound: undefined,
      errorMessage: null,
    };
  }

  return playRound(state, round, now, false);
}

/*
 * A read that failed while nothing was on screen. A failed read during a
 * rotation changes nothing: the round on screen plays on.
 */
export function receivePlaylistReadError(
  state: PlaylistPlayerState,
  message: string,
): PlaylistPlayerState {
  if (state.status === PlaylistPlayerStatus.Playing) {
    return state;
  }

  return {
    ...state,
    status: PlaylistPlayerStatus.Error,
    playback: null,
    errorMessage: message,
  };
}

/*
 * Whether the playlist should be read again for the next round: a rotation
 * on screen, in its round's last turn, and that round's read not asked for
 * yet (the hook keeps the round numbers it asked for).
 */
export function isTimeToReadNextRound(state: PlaylistPlayerState): boolean {
  return (
    state.status === PlaylistPlayerStatus.Playing &&
    state.playback !== null &&
    isLastInPlaylistRound(state.playback) &&
    state.nextRound === undefined
  );
}

/*
 * The playlist read again during round `roundNumber`'s last turn. Kept for
 * the next turn, which starts the next round; a read for a round that has
 * already ended is dropped.
 */
export function receiveNextRound(
  state: PlaylistPlayerState,
  roundNumber: number,
  round: PlaylistRound | null,
): PlaylistPlayerState {
  if (
    roundNumber !== state.roundNumber ||
    state.status !== PlaylistPlayerStatus.Playing
  ) {
    return state;
  }

  return { ...state, nextRound: round };
}

/*
 * The next dashboard, when its turn comes or Next is pressed; Previous with
 * `direction` -1. Past the last dashboard the next round starts, with the
 * playlist as it was read again - or, when that read found the playlist
 * gone, the player says so. Previous on the first dashboard goes to the
 * last one of this round.
 */
export function advancePlaylistPlayer(
  state: PlaylistPlayerState,
  direction: 1 | -1,
  now: number,
): PlaylistPlayerState {
  if (
    state.status !== PlaylistPlayerStatus.Playing ||
    !state.playback ||
    !state.round
  ) {
    return state;
  }

  if (direction === -1) {
    return {
      ...state,
      playback: showPreviousPlaylistDashboard(state.playback, now),
    };
  }

  if (!isLastInPlaylistRound(state.playback)) {
    return {
      ...state,
      playback: showNextPlaylistDashboard(state.playback, now),
    };
  }

  // The end of the round.
  if (state.nextRound === null) {
    return {
      ...state,
      status: PlaylistPlayerStatus.NotFound,
      round: null,
      playback: null,
      nextRound: undefined,
    };
  }

  if (state.nextRound) {
    if (state.nextRound.entries.length === 0) {
      return playRound(state, state.nextRound, now, false);
    }

    return {
      ...state,
      round: state.nextRound,
      playback: startNextPlaylistRound(state.playback, {
        count: state.nextRound.entries.length,
        intervalMs: getPlaylistRoundIntervalMs(state.nextRound),
        now: now,
      }),
      roundNumber: state.roundNumber + 1,
      nextRound: undefined,
    };
  }

  // The read again has not answered, or failed: this round once more.
  return {
    ...state,
    playback: showPlaylistIndex(state.playback, 0, now),
    roundNumber: state.roundNumber + 1,
    nextRound: undefined,
  };
}

export function togglePlaylistPlayerPause(
  state: PlaylistPlayerState,
  now: number,
): PlaylistPlayerState {
  if (!state.playback) {
    return state;
  }

  return { ...state, playback: togglePlaylistPause(state.playback, now) };
}

export function pausePlaylistPlayer(
  state: PlaylistPlayerState,
  now: number,
): PlaylistPlayerState {
  if (!state.playback) {
    return state;
  }

  return { ...state, playback: pausePlaylist(state.playback, now) };
}

export function resumePlaylistPlayer(
  state: PlaylistPlayerState,
  now: number,
): PlaylistPlayerState {
  if (!state.playback) {
    return state;
  }

  return { ...state, playback: resumePlaylist(state.playback, now) };
}

// The dashboard on screen.
export function getCurrentPlaylistEntry(
  state: PlaylistPlayerState,
): PlaylistEntry | null {
  if (!state.playback || !state.round) {
    return null;
  }

  return state.round.entries[state.playback.index] || null;
}

/*
 * The dashboard that comes next, as far as the player knows: in this
 * round, or the first of the next round once it is read. The player draws
 * it out of sight ahead of its turn, so it is ready when its turn comes.
 */
export function getUpcomingPlaylistEntry(
  state: PlaylistPlayerState,
): PlaylistEntry | null {
  if (!state.playback || !state.round) {
    return null;
  }

  if (isLastInPlaylistRound(state.playback) && state.nextRound) {
    return state.nextRound.entries[0] || null;
  }

  if (isLastInPlaylistRound(state.playback) && state.nextRound === null) {
    return null;
  }

  return state.round.entries[getNextPlaylistIndex(state.playback)] || null;
}
