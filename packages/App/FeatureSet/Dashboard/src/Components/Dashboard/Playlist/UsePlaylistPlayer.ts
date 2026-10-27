import { useCallback, useEffect, useRef, useState } from "react";
import { PlaylistEntry } from "./PlaylistDashboards";
import { getPlaylistTurnRemainingMs } from "./PlaylistPlayback";
import {
  INITIAL_PLAYLIST_PLAYER_STATE,
  PlaylistPlayerState,
  PlaylistPlayerStatus,
  PlaylistRound,
  advancePlaylistPlayer,
  getCurrentPlaylistEntry,
  getUpcomingPlaylistEntry,
  isTimeToReadNextRound,
  receiveNextRound,
  receivePlaylistReadError,
  receivePlaylistRound,
  togglePlaylistPlayerPause,
} from "./PlaylistPlayerState";

/*
 * The player's clock and timer (issue #5235): everything that waits.
 * PlaylistPlayerState decides what each step does; this hook reads the
 * playlist when a step asks for it and wakes up when the dashboard on
 * screen has had its time.
 *
 * The clock is handed in, so a test steps through rotations with a clock of
 * its own and waits for nothing; the player uses the browser's. One timer
 * at a time, set for the end of the turn on screen: a tab the browser let
 * sleep wakes up late and moves on one dashboard, never several.
 */

export interface PlaylistClock {
  now: () => number;
  setTimeout: (callback: () => void, delayInMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export const SYSTEM_PLAYLIST_CLOCK: PlaylistClock = {
  now: (): number => {
    return Date.now();
  },
  setTimeout: (callback: () => void, delayInMs: number): unknown => {
    return globalThis.setTimeout(callback, delayInMs);
  },
  clearTimeout: (handle: unknown): void => {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/*
 * Reads the playlist as a round: its name, its interval and the dashboards
 * of it the viewer may read. Null when the playlist is not found.
 */
export type PlaylistRoundReader = () => Promise<PlaylistRound | null>;

/*
 * How long a player with nothing on screen - an empty playlist, a failed
 * read - waits before it reads the playlist again, so a wall comes back by
 * itself.
 */
export const PLAYLIST_PLAYER_READ_AGAIN_IN_MS: number = 60 * 1000;

export interface PlaylistPlayer {
  state: PlaylistPlayerState;
  // The dashboard on screen.
  current: PlaylistEntry | null;
  // The one its turn ends on, drawn out of sight ahead of time.
  upcoming: PlaylistEntry | null;
  next: () => void;
  previous: () => void;
  togglePause: () => void;
  // Reads the playlist again at once (the error and empty states' button).
  readAgain: () => void;
}

const getDefaultErrorMessage: (error: unknown) => string = (
  error: unknown,
): string => {
  return error instanceof Error ? error.message : String(error);
};

export const usePlaylistPlayer: (data: {
  readRound: PlaylistRoundReader;
  clock?: PlaylistClock | undefined;
  readAgainInMs?: number | undefined;
  getErrorMessage?: ((error: unknown) => string) | undefined;
}) => PlaylistPlayer = (data: {
  readRound: PlaylistRoundReader;
  clock?: PlaylistClock | undefined;
  readAgainInMs?: number | undefined;
  getErrorMessage?: ((error: unknown) => string) | undefined;
}): PlaylistPlayer => {
  const clock: PlaylistClock = data.clock || SYSTEM_PLAYLIST_CLOCK;
  const readAgainInMs: number =
    data.readAgainInMs || PLAYLIST_PLAYER_READ_AGAIN_IN_MS;

  const [state, setState] = useState<PlaylistPlayerState>(
    INITIAL_PLAYLIST_PLAYER_STATE,
  );

  /*
   * Bumped to read the playlist while nothing is on screen: as the player
   * opens, after a while in the empty or failed state, and on Try again.
   */
  const [readRequest, setReadRequest] = useState<number>(0);

  const readRoundRef: React.MutableRefObject<PlaylistRoundReader> =
    useRef<PlaylistRoundReader>(data.readRound);
  readRoundRef.current = data.readRound;

  const getErrorMessageRef: React.MutableRefObject<(error: unknown) => string> =
    useRef<(error: unknown) => string>(
      data.getErrorMessage || getDefaultErrorMessage,
    );
  getErrorMessageRef.current = data.getErrorMessage || getDefaultErrorMessage;

  const isMountedRef: React.MutableRefObject<boolean> = useRef<boolean>(true);

  // The last round a read for the next round was asked for in.
  const askedForRoundRef: React.MutableRefObject<number | null> = useRef<
    number | null
  >(null);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // The playlist, read while nothing is on screen.
  useEffect(() => {
    let isCurrent: boolean = true;

    readRoundRef
      .current()
      .then((round: PlaylistRound | null) => {
        if (isCurrent && isMountedRef.current) {
          setState((previous: PlaylistPlayerState) => {
            return receivePlaylistRound(previous, round, clock.now());
          });
        }
      })
      .catch((error: unknown) => {
        if (isCurrent && isMountedRef.current) {
          setState((previous: PlaylistPlayerState) => {
            return receivePlaylistReadError(
              previous,
              getErrorMessageRef.current(error),
            );
          });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [readRequest]);

  // Nothing on screen: read the playlist again after a while.
  useEffect(() => {
    if (
      state.status !== PlaylistPlayerStatus.Empty &&
      state.status !== PlaylistPlayerStatus.Error
    ) {
      return undefined;
    }

    const handle: unknown = clock.setTimeout(() => {
      setReadRequest((request: number) => {
        return request + 1;
      });
    }, readAgainInMs);

    return () => {
      clock.clearTimeout(handle);
    };
  }, [state.status, state.roundNumber, readRequest]);

  // The turn on screen: when it is over, the next dashboard.
  useEffect(() => {
    const playback: PlaylistPlayerState["playback"] = state.playback;

    if (
      state.status !== PlaylistPlayerStatus.Playing ||
      !playback ||
      playback.isPaused
    ) {
      return undefined;
    }

    const handle: unknown = clock.setTimeout(
      () => {
        setState((previous: PlaylistPlayerState) => {
          // Only the turn this timer was set for; any other has its own.
          return previous.playback === playback
            ? advancePlaylistPlayer(previous, 1, clock.now())
            : previous;
        });
      },
      getPlaylistTurnRemainingMs(playback, clock.now()),
    );

    return () => {
      clock.clearTimeout(handle);
    };
  }, [state.status, state.playback]);

  /*
   * The round's last turn: the playlist read again, for the next round. A
   * read that fails is left alone - the round on screen plays again, and
   * its last turn asks once more.
   */
  useEffect(() => {
    if (!isTimeToReadNextRound(state)) {
      return;
    }

    const roundNumber: number = state.roundNumber;

    if (askedForRoundRef.current === roundNumber) {
      return;
    }

    askedForRoundRef.current = roundNumber;

    readRoundRef
      .current()
      .then((round: PlaylistRound | null) => {
        if (isMountedRef.current) {
          setState((previous: PlaylistPlayerState) => {
            return receiveNextRound(previous, roundNumber, round);
          });
        }
      })
      .catch(() => {
        // The round on screen plays on.
      });
  }, [state]);

  const next: () => void = useCallback((): void => {
    setState((previous: PlaylistPlayerState) => {
      return advancePlaylistPlayer(previous, 1, clock.now());
    });
  }, [clock]);

  const previous: () => void = useCallback((): void => {
    setState((current: PlaylistPlayerState) => {
      return advancePlaylistPlayer(current, -1, clock.now());
    });
  }, [clock]);

  const togglePause: () => void = useCallback((): void => {
    setState((current: PlaylistPlayerState) => {
      return togglePlaylistPlayerPause(current, clock.now());
    });
  }, [clock]);

  const readAgain: () => void = useCallback((): void => {
    setReadRequest((request: number) => {
      return request + 1;
    });
  }, []);

  return {
    state: state,
    current: getCurrentPlaylistEntry(state),
    upcoming: getUpcomingPlaylistEntry(state),
    next: next,
    previous: previous,
    togglePause: togglePause,
    readAgain: readAgain,
  };
};

export default usePlaylistPlayer;
