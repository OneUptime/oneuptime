/*
 * THE CLOCK OF A CONVERSATION REPLAY.
 *
 * A conversation replays the way a session replay does: press play and the
 * messages arrive in the order and at the pace they really arrived, with the
 * "AI is answering" pause between a question and its answer. Real
 * conversations have long silences - a person reads an answer for two
 * minutes before typing the next question - so, like session replay's skip
 * idle, "Skip waiting" (on by default) shortens every gap longer than
 * IDLE_GAP_THRESHOLD_MS to SKIPPED_GAP_MS. The messages still say the real
 * time they arrived; only the replay clock is shortened.
 *
 * Everything here is pure arithmetic over the step times, so the player
 * component stays a thin shell (requestAnimationFrame + state) and every
 * rule - where play starts, what Next and Previous do at the edges, what
 * the scrubber shows - is pinned by tests.
 *
 * Replay time 0 is the first step. A step is VISIBLE once the clock reaches
 * its replay time.
 */

export const IDLE_GAP_THRESHOLD_MS: number = 3000;
export const SKIPPED_GAP_MS: number = 1200;

// Room after the last step, so the final answer is on screen before the end.
export const REPLAY_TAIL_MS: number = 800;

export const REPLAY_SPEEDS: ReadonlyArray<number> = [1, 2, 4, 8];

export interface LlmReplayStepTime {
  // When the step happened (epoch ms).
  atMs: number;
}

export interface LlmReplayTimeline {
  // Replay time of each step, in step order.
  points: Array<number>;
  // Real time of each step, in step order (epoch ms).
  realTimes: Array<number>;
  // Length of the replay, the tail included.
  durationMs: number;
  // Real length of the conversation, first step to last.
  realDurationMs: number;
  // Whether any gap was shortened.
  hasSkippedGaps: boolean;
}

export interface LlmReplayOptions {
  skipWaiting: boolean;
}

export default class LlmConversationReplay {
  public static buildTimeline(
    steps: ReadonlyArray<LlmReplayStepTime>,
    options: LlmReplayOptions,
  ): LlmReplayTimeline {
    const points: Array<number> = [];
    const realTimes: Array<number> = [];
    let hasSkippedGaps: boolean = false;

    for (let index: number = 0; index < steps.length; index++) {
      const atMs: number = Number(steps[index]?.atMs) || 0;
      realTimes.push(atMs);

      if (index === 0) {
        points.push(0);
        continue;
      }

      const previousReal: number = realTimes[index - 1] as number;
      // Steps are in order; a clock skew between services must not run backwards.
      let gap: number = Math.max(0, atMs - previousReal);

      if (options.skipWaiting && gap > IDLE_GAP_THRESHOLD_MS) {
        gap = SKIPPED_GAP_MS;
        hasSkippedGaps = true;
      }

      points.push((points[index - 1] as number) + gap);
    }

    const lastPoint: number = points.length
      ? (points[points.length - 1] as number)
      : 0;

    return {
      points: points,
      realTimes: realTimes,
      durationMs: points.length ? lastPoint + REPLAY_TAIL_MS : 0,
      realDurationMs: realTimes.length
        ? Math.max(
            0,
            (realTimes[realTimes.length - 1] as number) -
              (realTimes[0] as number),
          )
        : 0,
      hasSkippedGaps: hasSkippedGaps,
    };
  }

  // How many steps are on screen at this replay time.
  public static visibleCount(
    timeline: LlmReplayTimeline,
    clockMs: number,
  ): number {
    let count: number = 0;

    for (const point of timeline.points) {
      if (point <= clockMs) {
        count++;
      } else {
        break;
      }
    }

    return count;
  }

  /*
   * The index of the newest visible step, or -1 before the first one (only
   * possible with no steps, since the first step is at 0).
   */
  public static currentIndex(
    timeline: LlmReplayTimeline,
    clockMs: number,
  ): number {
    return LlmConversationReplay.visibleCount(timeline, clockMs) - 1;
  }

  // Replay time of a step, clamped to the timeline.
  public static timeOfStep(timeline: LlmReplayTimeline, index: number): number {
    if (timeline.points.length === 0) {
      return 0;
    }

    const clamped: number = Math.min(
      Math.max(0, index),
      timeline.points.length - 1,
    );

    return timeline.points[clamped] as number;
  }

  /*
   * Where "Next" goes: the next step that is not yet visible. The last
   * message is the end of the conversation, so Next to it goes straight to
   * the end of the replay - everything on screen and the replay finished
   * (Replay, not Play) - rather than to the last message with the tail
   * still to run.
   */
  public static nextStepTime(
    timeline: LlmReplayTimeline,
    clockMs: number,
  ): number {
    const lastPoint: number | undefined =
      timeline.points[timeline.points.length - 1];

    for (const point of timeline.points) {
      if (point > clockMs) {
        return point === lastPoint ? timeline.durationMs : point;
      }
    }

    return timeline.durationMs;
  }

  /*
   * Where "Previous" goes: back one step - the step before the newest
   * visible one, so pressing it shows one message fewer. From the first
   * step it stays at the start.
   */
  public static previousStepTime(
    timeline: LlmReplayTimeline,
    clockMs: number,
  ): number {
    const current: number = LlmConversationReplay.currentIndex(
      timeline,
      clockMs,
    );

    if (current <= 0) {
      return 0;
    }

    /*
     * Several steps can share a replay time (an answer and the tool call it
     * asks for). Previous must land before the newest of them, or it would
     * show the same screen again.
     */
    const currentPoint: number = timeline.points[current] as number;
    let target: number = current - 1;

    while (target > 0 && (timeline.points[target] as number) === currentPoint) {
      target--;
    }

    const targetPoint: number = timeline.points[target] as number;

    return targetPoint === currentPoint ? 0 : targetPoint;
  }

  /*
   * The real time at a replay time: the time of the newest visible step plus
   * how far the clock has run past it, so a "waiting for the answer" pause
   * counts up in real seconds. Inside a shortened gap it stays on the
   * previous step's time plus the real elapsed share of the gap.
   */
  public static realTimeAt(
    timeline: LlmReplayTimeline,
    clockMs: number,
  ): number {
    if (timeline.points.length === 0) {
      return 0;
    }

    const current: number = Math.max(
      0,
      LlmConversationReplay.currentIndex(timeline, clockMs),
    );
    const point: number = timeline.points[current] as number;
    const real: number = timeline.realTimes[current] as number;
    const nextIndex: number = current + 1;

    if (nextIndex >= timeline.points.length) {
      return real + Math.max(0, Math.min(clockMs - point, REPLAY_TAIL_MS));
    }

    const nextPoint: number = timeline.points[nextIndex] as number;
    const nextReal: number = timeline.realTimes[nextIndex] as number;
    const replaySpan: number = nextPoint - point;

    if (replaySpan <= 0) {
      return real;
    }

    const share: number = Math.min(
      1,
      Math.max(0, (clockMs - point) / replaySpan),
    );

    return real + share * Math.max(0, nextReal - real);
  }

  // The scrubber position (0..1) of a replay time.
  public static progress(timeline: LlmReplayTimeline, clockMs: number): number {
    if (timeline.durationMs <= 0) {
      return 0;
    }

    return Math.min(1, Math.max(0, clockMs / timeline.durationMs));
  }

  // The replay time at a scrubber position (0..1).
  public static clockAtProgress(
    timeline: LlmReplayTimeline,
    progress: number,
  ): number {
    const clamped: number = Math.min(1, Math.max(0, progress));

    return clamped * timeline.durationMs;
  }

  /*
   * The next speed in the cycle 1x -> 2x -> 4x -> 8x -> 1x. Anything else
   * restarts the cycle.
   */
  public static nextSpeed(speed: number): number {
    const index: number = REPLAY_SPEEDS.indexOf(speed);

    if (index < 0 || index === REPLAY_SPEEDS.length - 1) {
      return REPLAY_SPEEDS[0] as number;
    }

    return REPLAY_SPEEDS[index + 1] as number;
  }

  /*
   * Where pressing play starts: from the current position, unless the replay
   * is at (or past) its end, where play starts over.
   */
  public static playFrom(timeline: LlmReplayTimeline, clockMs: number): number {
    if (timeline.durationMs <= 0 || clockMs >= timeline.durationMs) {
      return 0;
    }

    return Math.max(0, clockMs);
  }

  /*
   * The replay time of a step after the timeline was rebuilt (skip waiting
   * switched), so toggling it keeps the same messages on screen.
   */
  public static carryOver(data: {
    from: LlmReplayTimeline;
    to: LlmReplayTimeline;
    clockMs: number;
  }): number {
    if (data.clockMs >= data.from.durationMs) {
      return data.to.durationMs;
    }

    const index: number = LlmConversationReplay.currentIndex(
      data.from,
      data.clockMs,
    );

    if (index < 0) {
      return 0;
    }

    const offset: number = Math.max(
      0,
      data.clockMs - (data.from.points[index] as number),
    );

    const base: number = LlmConversationReplay.timeOfStep(data.to, index);
    let carried: number = base + offset;

    /*
     * The offset into a gap the new timeline shortened must not run past
     * the next step, or switching would reveal a message.
     */
    const next: number | undefined = data.to.points[index + 1];

    if (next !== undefined && carried >= next) {
      carried = Math.max(base, next - 1);
    }

    return Math.min(carried, data.to.durationMs);
  }
}
