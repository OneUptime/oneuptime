import {
  MAX_SESSION_REPLAY_CHUNKS_PER_SESSION,
  SESSION_REPLAY_ENDED_FINALIZE_GRACE_MS,
  SESSION_REPLAY_ENDED_TRAILING_CHUNK_TOLERANCE_MS,
} from "../../Types/Rum/SessionReplay";

/*
 * Has a recording ended, judged from its stored chunk rows?
 *
 * "Not finalized" and "still recording" are different facts. Finalization
 * waits for the finalizer, while a tab that was closed said so the moment
 * its final chunk landed. Treating the first as the second is how a closed
 * tab kept its "Recording now" badge for 10-15 minutes.
 *
 * The rule is shared by the finalizer (which finalizes an ended session
 * early) and the read path (which tells the Dashboard a session has ended
 * before the finalizer has run), so the list never says "ended" about a
 * session the finalizer would still wait on, and the other way round.
 *
 * Judged per TAB, never from the header's sealedReason. The session id is
 * shared by every tab and page load of an origin, so in a multi-page app
 * page A's final chunk sets the session's "final-chunk" reason while the
 * user is already on page B. Only when every tab has ended, and the grace
 * has passed without a new tab showing up, is the recording over.
 *
 * Pure and dependency-free apart from the shared constants.
 */

/*
 * Read from the chunk table per (rumApplicationId, tabId) as
 *   max(toUInt8(isFinal))                                  -> hasFinalChunk
 *   toUnixTimestamp64Milli(maxIf(chunkEndTime, isFinal))   -> finalChunkEndUnixMs
 *   toUnixTimestamp64Milli(max(chunkStartTime))            -> lastChunkStartUnixMs
 *   max(chunkIndex)                                        -> maxChunkIndex
 *   max(version)                                           -> lastChunkStoredAtUnixMs
 * Maxima are unaffected by a redelivered chunk's duplicate row, so no
 * reader needs LIMIT 1 BY for these.
 */
export interface SessionReplayTabEndFacts {
  /* Whether any stored chunk of this tab carried isFinal. */
  hasFinalChunk: boolean;
  /*
   * Unix ms end of this tab's latest final chunk; ignored when
   * hasFinalChunk is false. Client clock, like lastChunkStartUnixMs, so the
   * two are comparable with each other and with nothing else.
   */
  finalChunkEndUnixMs: number;
  /* Unix ms start of this tab's latest-starting chunk, final or not. */
  lastChunkStartUnixMs: number;
  /* Highest chunk index stored for this tab. */
  maxChunkIndex: number;
  /*
   * SERVER unix ms at which this tab's newest chunk row was written (the
   * chunk row's `version`). The grace is measured on this clock, never on
   * the device's.
   */
  lastChunkStoredAtUnixMs: number;
}

/*
 * A tab has ended when:
 *
 * - it sent a final chunk and no chunk started meaningfully after it (the
 *   tolerance absorbs the one trailing non-final chunk older recorders post
 *   at unload; see SESSION_REPLAY_ENDED_TRAILING_CHUNK_TOLERANCE_MS), or
 * - it stored its last permitted chunk index. The ingest gate refuses every
 *   index at or past MAX_SESSION_REPLAY_CHUNKS_PER_SESSION, including the
 *   recorder's own truncation seal, so nothing more can ever land for it.
 */
export function hasTabRecordingEnded(tab: SessionReplayTabEndFacts): boolean {
  if (
    Number.isFinite(tab.maxChunkIndex) &&
    tab.maxChunkIndex >= MAX_SESSION_REPLAY_CHUNKS_PER_SESSION - 1
  ) {
    return true;
  }

  if (!tab.hasFinalChunk) {
    return false;
  }

  if (
    !Number.isFinite(tab.finalChunkEndUnixMs) ||
    !Number.isFinite(tab.lastChunkStartUnixMs)
  ) {
    return false;
  }

  return (
    tab.lastChunkStartUnixMs <=
    tab.finalChunkEndUnixMs + SESSION_REPLAY_ENDED_TRAILING_CHUNK_TOLERANCE_MS
  );
}

/*
 * A session (or one application's share of it) has ended when it has at
 * least one tab, every one of them has ended, and the newest chunk of any
 * of them was stored at least SESSION_REPLAY_ENDED_FINALIZE_GRACE_MS before
 * nowUnixMs (server clock).
 *
 * The grace is what keeps a multi-page app's navigation from reading as
 * "ended": page A's final chunk lands, and page B's first chunk follows up
 * to a flush interval later under a new tab id. No tabs means nothing is
 * known, which is not the same as "ended".
 */
export function hasSessionRecordingEnded(
  tabs: ReadonlyArray<SessionReplayTabEndFacts>,
  nowUnixMs: number,
): boolean {
  if (tabs.length === 0 || !Number.isFinite(nowUnixMs)) {
    return false;
  }

  let newestStoredAtUnixMs: number = 0;

  for (const tab of tabs) {
    if (!hasTabRecordingEnded(tab)) {
      return false;
    }

    if (!Number.isFinite(tab.lastChunkStoredAtUnixMs)) {
      return false;
    }

    newestStoredAtUnixMs = Math.max(
      newestStoredAtUnixMs,
      tab.lastChunkStoredAtUnixMs,
    );
  }

  return (
    newestStoredAtUnixMs <= nowUnixMs - SESSION_REPLAY_ENDED_FINALIZE_GRACE_MS
  );
}
