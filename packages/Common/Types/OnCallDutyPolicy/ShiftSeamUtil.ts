/*
 * Seam normalisation for resolved on-call segments.
 *
 * The rotation engine and its post-processors leave one-second artefacts at
 * every boundary: LayerUtil resumes each segment one second after the
 * previous one ends (Layer.ts advances with addRemoveSeconds(end, 1)), the
 * multi-layer priority merge trims to `start - 1s` / `end + 1s`, and the
 * override splitter cuts at the exact instant. Fed straight into a calendar
 * that renders as 09:00:01 -> 16:59:59, with adjacent shifts that neither
 * touch nor overlap — which Google's week view draws side by side.
 *
 * Handoff and restriction times are minute-granular by construction, so the
 * artefacts are unambiguous: a start on second 1 means the minute, an end on
 * second 59 means the next minute, and two segments a second apart are
 * meant to touch. Everything else is left alone.
 */

export interface TimeSegment {
  start: Date;
  end: Date;
}

// Segments this close together (in ms) are made to touch exactly.
export const SEAM_TOLERANCE_MILLISECONDS: number = 1000;

const MILLISECONDS_PER_MINUTE: number = 60 * 1000;

export default class ShiftSeamUtil {
  /*
   * Returns a NEW array (sorted by start, then end) of NEW segment objects
   * with the seams normalised; neither the input array nor its segments are
   * mutated. Any extra properties on the segments are preserved, so this can
   * run on OnCallShift / MaterializedShift objects directly.
   *
   * Rules, in order:
   *  1. a start whose seconds == 1 snaps DOWN to the minute;
   *  2. an end whose seconds == 59 snaps UP to the next minute;
   *  3. walking in start order, when the next segment starts 0..1 s after
   *     this one ends, this one's end becomes exactly the next one's start.
   * Snapping only ever widens a segment, so it cannot create an empty or
   * inverted one; a segment that is already empty or inverted is left alone.
   */
  public static normalizeSeams<T extends TimeSegment>(
    segments: Array<T>,
  ): Array<T> {
    const normalized: Array<T> = segments.map((segment: T) => {
      const snappedStart: Date = ShiftSeamUtil.snapStart(segment.start);
      const snappedEnd: Date = ShiftSeamUtil.snapEnd(segment.end);

      const keepSnaps: boolean =
        segment.end.getTime() > segment.start.getTime() &&
        snappedEnd.getTime() > snappedStart.getTime();

      return {
        ...segment,
        start: keepSnaps ? snappedStart : new Date(segment.start.getTime()),
        end: keepSnaps ? snappedEnd : new Date(segment.end.getTime()),
      };
    });

    normalized.sort((a: T, b: T) => {
      const byStart: number = a.start.getTime() - b.start.getTime();
      if (byStart !== 0) {
        return byStart;
      }
      return a.end.getTime() - b.end.getTime();
    });

    for (let i: number = 0; i < normalized.length - 1; i++) {
      const segment: T = normalized[i]!;
      const next: T = normalized[i + 1]!;

      const delta: number = next.start.getTime() - segment.end.getTime();

      if (delta >= 0 && delta <= SEAM_TOLERANCE_MILLISECONDS) {
        segment.end = new Date(next.start.getTime());
      }
    }

    return normalized;
  }

  // 10:00:01(.xxx) -> 10:00:00.000; anything else is returned as a copy.
  public static snapStart(date: Date): Date {
    if (date.getUTCSeconds() === 1) {
      return new Date(
        Math.floor(date.getTime() / MILLISECONDS_PER_MINUTE) *
          MILLISECONDS_PER_MINUTE,
      );
    }

    return new Date(date.getTime());
  }

  // 16:59:59(.xxx) -> 17:00:00.000; anything else is returned as a copy.
  public static snapEnd(date: Date): Date {
    if (date.getUTCSeconds() === 59) {
      return new Date(
        (Math.floor(date.getTime() / MILLISECONDS_PER_MINUTE) + 1) *
          MILLISECONDS_PER_MINUTE,
      );
    }

    return new Date(date.getTime());
  }
}
