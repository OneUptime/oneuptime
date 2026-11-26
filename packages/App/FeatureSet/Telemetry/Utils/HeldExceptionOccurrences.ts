import logger from "Common/Server/Utils/Logger";
import OldestKeyMap from "Common/Utils/OldestKeyMap";
import type { TelemetryExceptionPayload } from "./Exception";

/*
 * OCCURRENCES WAITING TO KNOW WHICH EXCEPTION THEY BELONG TO (#11027).
 *
 * An occurrence's exception is the first that exists under one of its
 * fingerprints (ExceptionUtil.resolveGroupFingerprints). When that cannot be
 * read - the read failed every time it was tried, and nothing this process
 * knew settles it - the occurrence is not counted on a guess: a guess under
 * a fingerprint no exception has made a new one, a duplicate of an old
 * error that set off New Exception again and, under grouping v1's
 * fingerprint, kept every later occurrence for good. It waits here instead,
 * and goes with a later batch's upsert, once the read works: counted on the
 * exception it belongs to, at the times it happened.
 *
 * Held in this process only, as the batch upsert itself is: one that stops
 * first loses what it held, which lags the exceptions' counts, as a failed
 * upsert does - the occurrences are in ClickHouse already. Bounded: the
 * occurrences of one exception (by its fingerprints) and release are kept
 * as two - the earliest and the latest, the latest counting the ones between
 * - so a burst of one exception holds two, and at most
 * MAX_HELD_EXCEPTION_GROUPS such pairs are held, the oldest let go first.
 *
 * Each is tried again with the next batch of its project, or after
 * HELD_OCCURRENCE_RETRY_MS whatever the batch: a held occurrence of a
 * project no batch names waits no longer than that.
 */

// How many exceptions' held occurrences are kept at most.
export const MAX_HELD_EXCEPTION_GROUPS: number = 10000;

// How long a held occurrence waits before it is tried again with any batch.
export const HELD_OCCURRENCE_RETRY_MS: number = 5000;

interface HeldGroup {
  projectId: string;
  // The held occurrence that happened first: counted for itself.
  earliest: TelemetryExceptionPayload;
  // The one that happened last, counted with every one between the two.
  latest: TelemetryExceptionPayload | null;
  // When it may be tried again with a batch of another project.
  nextTryAt: number;
}

const held: OldestKeyMap<string, HeldGroup> = new OldestKeyMap<
  string,
  HeldGroup
>();

function timeOf(payload: TelemetryExceptionPayload): number {
  return payload.occurredAt instanceof Date ? payload.occurredAt.getTime() : 0;
}

function countOf(payload: TelemetryExceptionPayload): number {
  const count: number = Number(payload.occurrences);

  return Number.isFinite(count) && count >= 1 ? Math.floor(count) : 1;
}

/*
 * `into` taking in what `from` counted, as the upsert adds them up
 * (ExceptionUtil.aggregateExceptions): its occurrences, whether any escaped
 * uncaught, and the texts `into` lacks. Both are of one release.
 */
function fold(
  into: TelemetryExceptionPayload,
  from: TelemetryExceptionPayload,
): TelemetryExceptionPayload {
  const folded: TelemetryExceptionPayload = {
    ...into,
    occurrences: countOf(into) + countOf(from),
    unhandled: Boolean(into.unhandled) || Boolean(from.unhandled),
  };

  for (const field of [
    "message",
    "stackTrace",
    "exceptionType",
    "environment",
  ] as const) {
    const text: string | undefined = into[field] || from[field];

    if (text) {
      folded[field] = text;
    }
  }

  return folded;
}

export default class HeldExceptionOccurrences {
  /*
   * Holds each occurrence under `key`: its exception's fingerprints as the
   * read would answer them (groupFingerprintKey), so the occurrences of one
   * exception are kept as one.
   */
  public static hold(
    occurrences: Array<{ key: string; payload: TelemetryExceptionPayload }>,
    now: number = Date.now(),
  ): void {
    for (const occurrence of occurrences) {
      const payload: TelemetryExceptionPayload = occurrence.payload;
      const projectId: string = payload.projectId?.toString() || "";
      const key: string = `${occurrence.key}|${payload.primaryEntityId?.toString() || ""}|${payload.release || ""}`;
      const group: HeldGroup | undefined = held.get(key);

      if (!group) {
        HeldExceptionOccurrences.makeRoom();
        held.set(key, {
          projectId,
          earliest: { ...payload },
          latest: null,
          nextTryAt: now + HELD_OCCURRENCE_RETRY_MS,
        });
        continue;
      }

      const at: number = timeOf(payload);

      if (!group.latest) {
        if (at < timeOf(group.earliest)) {
          group.latest = group.earliest;
          group.earliest = { ...payload };
        } else {
          group.latest = { ...payload };
        }
      } else if (at < timeOf(group.earliest)) {
        // The earliest now: the one before it is counted with the latest.
        group.latest = fold(group.latest, group.earliest);
        group.earliest = { ...payload };
      } else if (at > timeOf(group.latest)) {
        // The latest now, counting the one it follows.
        group.latest = fold({ ...payload }, group.latest);
      } else {
        group.latest = fold(group.latest, payload);
      }

      group.nextTryAt = Math.max(
        group.nextTryAt,
        now + HELD_OCCURRENCE_RETRY_MS,
      );
    }
  }

  /*
   * The held occurrences to try now, taken out: those of the projects named
   * (a batch of theirs reads their exceptions anyway), and every one that
   * has waited HELD_OCCURRENCE_RETRY_MS.
   */
  public static take(
    now: number = Date.now(),
    projectIds: ReadonlySet<string> = new Set<string>(),
  ): Array<TelemetryExceptionPayload> {
    const taken: Array<TelemetryExceptionPayload> = [];

    for (const [key, group] of held) {
      if (group.nextTryAt > now && !projectIds.has(group.projectId)) {
        continue;
      }

      held.delete(key);
      taken.push(group.earliest);

      if (group.latest) {
        taken.push(group.latest);
      }
    }

    return taken;
  }

  // How many occurrences are held, all exceptions together.
  public static count(): number {
    let total: number = 0;

    for (const group of held.values()) {
      total +=
        countOf(group.earliest) + (group.latest ? countOf(group.latest) : 0);
    }

    return total;
  }

  // Whether anything is held.
  public static isEmpty(): boolean {
    return held.size === 0;
  }

  // Forgets everything held (tests).
  public static clear(): void {
    held.clear();
  }

  // Lets the exception held longest go, when as many as allowed are held.
  private static makeRoom(): void {
    if (held.size < MAX_HELD_EXCEPTION_GROUPS) {
      return;
    }

    const oldest: string | undefined = held.oldestKey();

    if (oldest === undefined) {
      return;
    }

    const group: HeldGroup = held.get(oldest)!;
    held.delete(oldest);

    logger.warn(
      `Let go of ${
        countOf(group.earliest) + (group.latest ? countOf(group.latest) : 0)
      } occurrences of an exception of project ${group.projectId} held while its exceptions could not be read: as many exceptions' occurrences as are held at once are held. Their exception's count lags them; the occurrences are stored.`,
    );
  }
}
