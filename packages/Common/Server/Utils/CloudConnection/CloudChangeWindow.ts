import { CloudChange, CloudConnectionPullState } from "./CloudConnectorTypes";

/*
 * WHICH STRETCH OF A CLOUD'S ACTIVITY LOG EACH READ LOOKS AT, PER PLACE.
 *
 * A place is an account and a Region ("123456789012|eu-west-1"), or an
 * account alone where the log is not split by Region. The activity logs
 * deliver late - CloudTrail up to about fifteen minutes after the event,
 * the Azure Activity Log and Google Cloud's audit log within a few - so a
 * read starts CLOUD_CHANGE_OVERLAP_MS before where the last one stopped,
 * and the changes it saw then (recentChanges: each id with its time) keep
 * what it reads again from being written twice.
 *
 *   - A place never read starts CLOUD_CHANGE_FIRST_LOOK_BACK_MS back: an
 *     investigation of an incident that opens right after a connection is
 *     made still sees what changed just before.
 *   - After a long pause a read goes back CLOUD_CHANGE_MAX_LOOK_BACK_MS at
 *     most: what is older than a day explains no incident opening now.
 */

export const CLOUD_CHANGE_FIRST_LOOK_BACK_MS: number = 2 * 60 * 60 * 1000;
export const CLOUD_CHANGE_OVERLAP_MS: number = 20 * 60 * 1000;
export const CLOUD_CHANGE_MAX_LOOK_BACK_MS: number = 24 * 60 * 60 * 1000;
// Changes remembered per place at most; the oldest go first.
export const CLOUD_CHANGE_RECENT_IDS_MAX: number = 500;

export function getChangePlace(accountId: string, region: string): string {
  return region ? `${accountId}|${region}` : accountId;
}

// Where a place's read starts.
export function getChangeWindowStart(data: {
  state: CloudConnectionPullState;
  place: string;
  now: Date;
  // An investigation's look back, which moves no cursor.
  since?: Date | undefined;
}): Date {
  if (data.since) {
    return data.since;
  }

  const cursor: number = Date.parse(
    data.state.changeCursors?.[data.place] || "",
  );
  const oldest: number = data.now.getTime() - CLOUD_CHANGE_MAX_LOOK_BACK_MS;

  if (!Number.isFinite(cursor)) {
    return new Date(data.now.getTime() - CLOUD_CHANGE_FIRST_LOOK_BACK_MS);
  }

  return new Date(Math.max(cursor - CLOUD_CHANGE_OVERLAP_MS, oldest));
}

/*
 * The changes of a place not seen before, in time order; and the place's
 * cursor and seen changes moved on, unless this is an investigation's look
 * back. A place read only in part keeps its cursor, so the next read
 * covers what this one missed. Of the changes seen, only the ones the next
 * read can bring in again - from where it will start - are kept.
 */
export function keepNewChanges(data: {
  state: CloudConnectionPullState;
  place: string;
  changes: Array<CloudChange>;
  now: Date;
  complete: boolean;
  isLookBack: boolean;
}): Array<CloudChange> {
  const seen: Record<string, number> = {
    ...(data.state.recentChanges?.[data.place] || {}),
  };
  const fresh: Array<CloudChange> = [];

  for (const change of [...data.changes].sort(
    (a: CloudChange, b: CloudChange): number => {
      return a.time.getTime() - b.time.getTime();
    },
  )) {
    if (!change.eventId || seen[change.eventId] !== undefined) {
      continue;
    }

    seen[change.eventId] = change.time.getTime();
    fresh.push(change);
  }

  if (data.isLookBack) {
    return fresh;
  }

  if (data.complete) {
    data.state.changeCursors = {
      ...(data.state.changeCursors || {}),
      [data.place]: data.now.toISOString(),
    };
  }

  const keepFrom: number = getChangeWindowStart({
    state: data.state,
    place: data.place,
    now: data.now,
  }).getTime();

  const kept: Array<[string, number]> = Object.entries(seen)
    .filter((entry: [string, number]): boolean => {
      return entry[1] >= keepFrom;
    })
    .sort((a: [string, number], b: [string, number]): number => {
      return b[1] - a[1];
    })
    .slice(0, CLOUD_CHANGE_RECENT_IDS_MAX);

  const recentChanges: Record<string, Record<string, number>> = {
    ...(data.state.recentChanges || {}),
  };

  if (kept.length > 0) {
    recentChanges[data.place] = Object.fromEntries(kept);
  } else {
    delete recentChanges[data.place];
  }

  data.state.recentChanges = recentChanges;

  return fresh;
}

/*
 * The places no read has reached for longer than a read ever looks back -
 * an account that left the organization, a Region no longer used -
 * forgotten, so the state stays the size of what is read. Read again, such
 * a place starts like a new one.
 */
export function forgetStalePlaces(
  state: CloudConnectionPullState,
  now: Date,
): void {
  const oldest: number = now.getTime() - CLOUD_CHANGE_MAX_LOOK_BACK_MS;
  const cursors: Record<string, string> = {};

  for (const [place, cursor] of Object.entries(state.changeCursors || {})) {
    if (Date.parse(cursor) >= oldest) {
      cursors[place] = cursor;
    }
  }

  const recentChanges: Record<string, Record<string, number>> = {};

  for (const [place, seen] of Object.entries(state.recentChanges || {})) {
    const kept: Array<[string, number]> = Object.entries(seen || {}).filter(
      (entry: [string, number]): boolean => {
        return entry[1] >= oldest;
      },
    );

    if (kept.length > 0) {
      recentChanges[place] = Object.fromEntries(kept);
    }
  }

  if (state.changeCursors) {
    state.changeCursors = cursors;
  }

  if (state.recentChanges) {
    state.recentChanges = recentChanges;
  }
}
