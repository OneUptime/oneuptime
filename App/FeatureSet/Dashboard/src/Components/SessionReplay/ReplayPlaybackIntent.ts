/*
 * The two playback decisions the player makes that are worth stating once,
 * in one place, and holding to in a test.
 *
 * Both of them are answers to the same reported bug: pressing Play and
 * watching nothing happen. Neither is a rendering concern, so neither lives
 * in the component - and keeping them here means they can be exercised
 * without a Replayer, a DOM or a network.
 */

/*
 * Whether the recording should skip stretches with no user interaction.
 *
 * OFF, and that is a deliberate reversal. Skip-inactive is rrweb
 * fast-forwarding, and on a chunk-streamed player it outruns the transport:
 * events arrive one 15-second chunk at a time over an authenticated fetch,
 * so a fast-forward drains everything rrweb has been fed, rrweb emits
 * Finish, and playback sits stalled until the next chunk lands. A recording
 * that opens with a few idle seconds - which is most of them, because the
 * page has to load - therefore froze on the very first press of Play, and
 * the thing that reliably got it moving was clicking a row in the events
 * list, because that seeks to a moment with activity.
 *
 * It remains one checkbox away, and ReplayStage caps how fast it may skip.
 * But faithful playback is the right default for a tool whose whole claim is
 * showing what the user actually saw.
 */
export const DEFAULT_SKIP_INACTIVE: boolean = false;

/*
 * How close to the end counts AS the end.
 *
 * One playback tick. The last frame of a recording rarely lands on the exact
 * millisecond the manifest calls the end, so an exact comparison would miss
 * the case this exists for on nearly every session.
 */
export const END_OF_RECORDING_TOLERANCE_MS: number = 250;

/*
 * Whether pressing Play has to rewind first.
 *
 * rrweb has no events after the playhead at the end of a recording, so it
 * emits Finish immediately and stops again: the button flips to "pause" and
 * straight back, and the picture never moves. That is indistinguishable from
 * a broken Play button, and it is what a viewer hits every single time they
 * watch a session through to the end and then press Play again.
 *
 * A duration of zero means the manifest has not been read yet (or carries no
 * footage), and rewinding on that would restart a recording that has not
 * started - so it is not treated as "at the end".
 */
export function shouldRewindBeforePlay(
  currentTimeMs: number,
  durationMs: number,
): boolean {
  if (!isFinite(durationMs) || durationMs <= 0) {
    return false;
  }

  if (!isFinite(currentTimeMs)) {
    return false;
  }

  return currentTimeMs >= durationMs - END_OF_RECORDING_TOLERANCE_MS;
}
