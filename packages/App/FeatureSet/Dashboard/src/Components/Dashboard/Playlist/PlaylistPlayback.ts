/*
 * A playlist's rotation as plain data: which dashboard is on screen, how
 * long it has been there, and whether the rotation is paused (issue #5235).
 *
 * Every function takes the time it is called at (`now`, epoch ms) and
 * returns a new value; nothing here reads a clock, starts a timer or
 * touches React or the DOM. The player's hook (UsePlaylistPlayer) owns the
 * clock and the timer, so the rules - a turn lasts the playlist's
 * interval, a pause stops it where it is, Next and Previous start the next
 * turn at once - can be pinned with any time a test chooses.
 *
 * A turn's time is kept as when it started: while playing, the turn ends
 * at turnStartedAt + intervalMs. A pause keeps how much of the turn had
 * passed; resuming starts the clock again from there, so a dashboard paused
 * with ten seconds left still gets its ten seconds.
 */

export interface PlaylistPlayback {
  // How many dashboards the rotation goes through.
  count: number;
  // The one on screen, from 0.
  index: number;
  // How long each is shown.
  intervalMs: number;
  isPaused: boolean;
  /*
   * While playing: when the turn on screen began, moved on by any pause in
   * it. Ignored while paused.
   */
  turnStartedAt: number;
  // While paused: how much of the turn had passed. 0 while playing.
  pausedElapsedMs: number;
}

// The index that many places on, round the rotation in either direction.
export function wrapPlaylistIndex(index: number, count: number): number {
  if (count <= 0) {
    return 0;
  }

  return ((index % count) + count) % count;
}

export function startPlaylistPlayback(data: {
  count: number;
  intervalMs: number;
  now: number;
  index?: number | undefined;
  isPaused?: boolean | undefined;
}): PlaylistPlayback {
  return {
    count: Math.max(0, data.count),
    index: wrapPlaylistIndex(data.index || 0, data.count),
    intervalMs: Math.max(1, data.intervalMs),
    isPaused: Boolean(data.isPaused),
    turnStartedAt: data.now,
    pausedElapsedMs: 0,
  };
}

// How much of the turn on screen has passed, from 0 to the interval.
export function getPlaylistTurnElapsedMs(
  playback: PlaylistPlayback,
  now: number,
): number {
  const elapsed: number = playback.isPaused
    ? playback.pausedElapsedMs
    : now - playback.turnStartedAt;

  return Math.min(playback.intervalMs, Math.max(0, elapsed));
}

// How long until the next dashboard, from the interval down to 0.
export function getPlaylistTurnRemainingMs(
  playback: PlaylistPlayback,
  now: number,
): number {
  return playback.intervalMs - getPlaylistTurnElapsedMs(playback, now);
}

/*
 * Whether the turn on screen is over: playing, with something to play, and
 * the interval passed. A paused rotation's turn is never over.
 */
export function isPlaylistTurnOver(
  playback: PlaylistPlayback,
  now: number,
): boolean {
  return (
    !playback.isPaused &&
    playback.count > 0 &&
    now - playback.turnStartedAt >= playback.intervalMs
  );
}

/*
 * The dashboard at `index` on screen, its turn starting now. A paused
 * rotation stays paused, with all of the new turn ahead of it.
 */
export function showPlaylistIndex(
  playback: PlaylistPlayback,
  index: number,
  now: number,
): PlaylistPlayback {
  return {
    ...playback,
    index: wrapPlaylistIndex(index, playback.count),
    turnStartedAt: now,
    pausedElapsedMs: 0,
  };
}

// The index Next goes to: the next one, the first after the last.
export function getNextPlaylistIndex(playback: PlaylistPlayback): number {
  return wrapPlaylistIndex(playback.index + 1, playback.count);
}

// The index Previous goes to: the one before, the last before the first.
export function getPreviousPlaylistIndex(playback: PlaylistPlayback): number {
  return wrapPlaylistIndex(playback.index - 1, playback.count);
}

/*
 * Whether the dashboard on screen ends a round: the next one is the first
 * again. With one dashboard, every turn ends a round.
 */
export function isLastInPlaylistRound(playback: PlaylistPlayback): boolean {
  return playback.count > 0 && playback.index === playback.count - 1;
}

export function showNextPlaylistDashboard(
  playback: PlaylistPlayback,
  now: number,
): PlaylistPlayback {
  return showPlaylistIndex(playback, getNextPlaylistIndex(playback), now);
}

export function showPreviousPlaylistDashboard(
  playback: PlaylistPlayback,
  now: number,
): PlaylistPlayback {
  return showPlaylistIndex(playback, getPreviousPlaylistIndex(playback), now);
}

export function pausePlaylist(
  playback: PlaylistPlayback,
  now: number,
): PlaylistPlayback {
  if (playback.isPaused) {
    return playback;
  }

  return {
    ...playback,
    isPaused: true,
    pausedElapsedMs: getPlaylistTurnElapsedMs(playback, now),
  };
}

export function resumePlaylist(
  playback: PlaylistPlayback,
  now: number,
): PlaylistPlayback {
  if (!playback.isPaused) {
    return playback;
  }

  return {
    ...playback,
    isPaused: false,
    turnStartedAt: now - playback.pausedElapsedMs,
    pausedElapsedMs: 0,
  };
}

export function togglePlaylistPause(
  playback: PlaylistPlayback,
  now: number,
): PlaylistPlayback {
  return playback.isPaused
    ? resumePlaylist(playback, now)
    : pausePlaylist(playback, now);
}

/*
 * A new round with a playlist read again - its dashboards, or its interval,
 * may have changed since the last round: from its first dashboard, its turn
 * starting now, paused if the rotation was.
 */
export function startNextPlaylistRound(
  playback: PlaylistPlayback,
  data: { count: number; intervalMs: number; now: number },
): PlaylistPlayback {
  return startPlaylistPlayback({
    count: data.count,
    intervalMs: data.intervalMs,
    now: data.now,
    index: 0,
    isPaused: playback.isPaused,
  });
}
