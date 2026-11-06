import crypto from "crypto";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";

/*
 * A GROUPING RULE THAT WAITS FOR MORE INCIDENTS (OR ALERTS) BEFORE IT OPENS
 * AN EPISODE (issue #5374).
 *
 * With "Wait for more incidents" on (Common/Utils/Episode/
 * EpisodeOpeningThreshold), a matching incident that finds no open episode of
 * its group to join, and no resolved one to reopen, does not open one on its
 * own. It waits: the engine writes the group it waits in on the incident
 * (Incident.groupingWaitKey, Alert.groupingWaitKey) and leaves it alone, so
 * it pages only its own on-call policies, as an incident no rule matches
 * does. When a later incident of the same group finds enough of them, the
 * rule opens the episode with all of them and itself, and their marks are
 * cleared.
 *
 * Which waiting incidents count, read when the next one arrives:
 *
 *   - those of the same rule and group - the same grouping key - that are
 *     in no episode and still ongoing: one resolved meanwhile is over, so a
 *     monitor that keeps failing and recovering is one incident at a time,
 *     and never opens the episode by itself;
 *   - with the rule's time window on, only the run of them that arrived
 *     close together - each within the window of the next one, the newest
 *     within the window of the incident now arriving - exactly as an open
 *     episode keeps taking incidents (getRecordsArrivedTogether). With it
 *     off, every one still ongoing.
 *
 * The mark is written by the engine for itself, not as an edit of the
 * incident: no hooks, workflows, audit log or updatedAt.
 */

/*
 * The mark a record waits under: the rule and the grouping key as built,
 * hashed. One rule's groups never share a mark with another's, a private
 * record's title is not kept in it, and it fits a short text column whatever
 * the key holds. It is internal - no API reads it - so a plain hash is
 * enough: it only has to tell groups apart.
 */
export const getGroupingWaitKey: (data: {
  ruleId: ObjectID;
  groupingKey: string;
}) => string = (data: { ruleId: ObjectID; groupingKey: string }): string => {
  return crypto
    .createHash("sha256")
    .update(`${data.ruleId.toString()}:${data.groupingKey}`)
    .digest("hex");
};

export interface RecordWaitingForEpisode {
  createdAt?: Date | undefined;
}

type ArrivalFunction = (record: RecordWaitingForEpisode) => number | null;

// When a record arrived, in milliseconds, or null when that is not known.
const getArrival: ArrivalFunction = (
  record: RecordWaitingForEpisode,
): number | null => {
  if (!record.createdAt) {
    return null;
  }

  const arrival: number = OneUptimeDate.fromString(record.createdAt).getTime();

  return Number.isFinite(arrival) ? arrival : null;
};

/*
 * Of the records waiting in a group, the ones that count toward opening the
 * episode now, newest first. With no time window, all of them. With one, the
 * run that arrived close together: walking back from `now`, each record must
 * have arrived within the window of the one after it, and the first gap
 * longer than that ends the run - nothing before it can join a run that
 * starts later. A record whose arrival is not known ends it too.
 */
export const getRecordsArrivedTogether: <
  T extends RecordWaitingForEpisode,
>(data: {
  waiting: Array<T>;
  timeWindowMinutes: number | null;
  now: Date;
}) => Array<T> = <T extends RecordWaitingForEpisode>(data: {
  waiting: Array<T>;
  timeWindowMinutes: number | null;
  now: Date;
}): Array<T> => {
  // Newest first, those of no known arrival last, whatever order they came in.
  const newestFirst: Array<T> = [...data.waiting].sort(
    (first: T, second: T): number => {
      const firstArrival: number | null = getArrival(first);
      const secondArrival: number | null = getArrival(second);

      if (firstArrival === secondArrival) {
        return 0;
      }

      if (firstArrival === null) {
        return 1;
      }

      if (secondArrival === null) {
        return -1;
      }

      return secondArrival - firstArrival;
    },
  );

  if (data.timeWindowMinutes === null) {
    return newestFirst;
  }

  const windowInMs: number = data.timeWindowMinutes * 60 * 1000;
  const together: Array<T> = [];
  let nextArrival: number = data.now.getTime();

  for (const record of newestFirst) {
    const arrival: number | null = getArrival(record);

    if (arrival === null || nextArrival - arrival > windowInMs) {
      break;
    }

    together.push(record);
    nextArrival = arrival;
  }

  return together;
};
