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
 *
 * A place too busy to read to its end in one read moves on all the same,
 * so no read is stuck on the same stretch forever:
 *
 *   - a log listed newest first (CloudTrail, the Azure Activity Log) has
 *     its newest changes read, and the next read starts from now - the
 *     oldest changes of that stretch are left out, and the read says so;
 *   - a log listed oldest first (Google Cloud's audit log) resumes exactly
 *     at the newest change read (changeResume), with no overlap: what came
 *     before it was read.
 */

export const CLOUD_CHANGE_FIRST_LOOK_BACK_MS: number = 2 * 60 * 60 * 1000;
export const CLOUD_CHANGE_OVERLAP_MS: number = 20 * 60 * 1000;
export const CLOUD_CHANGE_MAX_LOOK_BACK_MS: number = 24 * 60 * 60 * 1000;
// Changes remembered per place at most; the oldest go first.
export const CLOUD_CHANGE_RECENT_IDS_MAX: number = 500;

// The order a log lists its changes in, which decides how a busy read moves on.
export type CloudChangeLogOrder = "newest-first" | "oldest-first";

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

  const oldest: number = data.now.getTime() - CLOUD_CHANGE_MAX_LOOK_BACK_MS;
  const resume: number = Date.parse(
    data.state.changeResume?.[data.place] || "",
  );

  // A busy log read oldest first carries on exactly where it stopped.
  if (Number.isFinite(resume)) {
    return new Date(Math.max(resume, oldest));
  }

  const cursor: number = Date.parse(
    data.state.changeCursors?.[data.place] || "",
  );

  if (!Number.isFinite(cursor)) {
    return new Date(data.now.getTime() - CLOUD_CHANGE_FIRST_LOOK_BACK_MS);
  }

  return new Date(Math.max(cursor - CLOUD_CHANGE_OVERLAP_MS, oldest));
}

/*
 * The changes of a place not seen before, in time order; and the place's
 * cursor and seen changes moved on, unless this is an investigation's look
 * back. A read that stopped part way (`complete` false: the place had more
 * pages than one read takes) moves on by the log's order, as the header
 * says. Of the changes seen, only the ones the next read can bring in
 * again - from where it will start - are kept.
 */
export function keepNewChanges(data: {
  state: CloudConnectionPullState;
  place: string;
  changes: Array<CloudChange>;
  now: Date;
  complete: boolean;
  isLookBack: boolean;
  // How the log lists its changes; newest first when not said.
  order?: CloudChangeLogOrder | undefined;
}): Array<CloudChange> {
  const seen: Record<string, number> = {
    ...(data.state.recentChanges?.[data.place] || {}),
  };
  const fresh: Array<CloudChange> = [];
  const sorted: Array<CloudChange> = [...data.changes].sort(
    (a: CloudChange, b: CloudChange): number => {
      return a.time.getTime() - b.time.getTime();
    },
  );

  for (const change of sorted) {
    if (!change.eventId || seen[change.eventId] !== undefined) {
      continue;
    }

    seen[change.eventId] = change.time.getTime();
    fresh.push(change);
  }

  if (data.isLookBack) {
    return fresh;
  }

  const resume: Record<string, string> = {
    ...(data.state.changeResume || {}),
  };
  const newest: CloudChange | undefined = sorted[sorted.length - 1];

  if (data.complete || data.order !== "oldest-first") {
    data.state.changeCursors = {
      ...(data.state.changeCursors || {}),
      [data.place]: data.now.toISOString(),
    };
    delete resume[data.place];
  } else if (newest) {
    resume[data.place] = newest.time.toISOString();
  }

  if (Object.keys(resume).length > 0) {
    data.state.changeResume = resume;
  } else {
    delete data.state.changeResume;
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
  const keepRecent: (
    times: Record<string, string> | undefined,
  ) => Record<string, string> = (
    times: Record<string, string> | undefined,
  ): Record<string, string> => {
    const kept: Record<string, string> = {};

    for (const [place, time] of Object.entries(times || {})) {
      if (Date.parse(time) >= oldest) {
        kept[place] = time;
      }
    }

    return kept;
  };

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
    state.changeCursors = keepRecent(state.changeCursors);
  }

  if (state.changeResume) {
    const resume: Record<string, string> = keepRecent(state.changeResume);

    if (Object.keys(resume).length > 0) {
      state.changeResume = resume;
    } else {
      delete state.changeResume;
    }
  }

  if (state.recentChanges) {
    state.recentChanges = recentChanges;
  }

  // An account's health read further back than a day starts a day back anyway.
  if (state.accountHealthReadAt) {
    const kept: Record<string, string> = keepRecent(state.accountHealthReadAt);

    if (Object.keys(kept).length > 0) {
      state.accountHealthReadAt = kept;
    } else {
      delete state.accountHealthReadAt;
    }
  }

  // A pause that is over is forgotten.
  if (state.healthPausedAccounts) {
    const paused: Record<string, string> = {};

    for (const [account, until] of Object.entries(state.healthPausedAccounts)) {
      if (Date.parse(until) > now.getTime()) {
        paused[account] = until;
      }
    }

    if (Object.keys(paused).length > 0) {
      state.healthPausedAccounts = paused;
    } else {
      delete state.healthPausedAccounts;
    }
  }
}

/*
 * When an account's health events are next read from: where its own last
 * read got to - or, before it was read on its own, where the last read of
 * every account's got to - a little before, as the activity logs are, and
 * a day back at most.
 */
export function getHealthWindowStart(data: {
  state: CloudConnectionPullState;
  accountId: string;
  now: Date;
}): Date {
  const oldest: number = data.now.getTime() - CLOUD_CHANGE_MAX_LOOK_BACK_MS;
  const readAt: number = Date.parse(
    data.state.accountHealthReadAt?.[data.accountId] ||
      data.state.healthReadAt ||
      "",
  );

  if (!Number.isFinite(readAt)) {
    return new Date(oldest);
  }

  return new Date(Math.max(readAt - CLOUD_CHANGE_OVERLAP_MS, oldest));
}

// Whether an account's health events may be asked for now.
export function isHealthPaused(data: {
  state: CloudConnectionPullState;
  accountId: string;
  now: Date;
}): boolean {
  const until: number = Date.parse(
    data.state.healthPausedAccounts?.[data.accountId] || "",
  );

  return Number.isFinite(until) && until > data.now.getTime();
}

// An account's health read, recorded: the next one starts from here.
export function markHealthRead(data: {
  state: CloudConnectionPullState;
  accountId: string;
  now: Date;
}): void {
  data.state.accountHealthReadAt = {
    ...(data.state.accountHealthReadAt || {}),
    [data.accountId]: data.now.toISOString(),
  };
}

// An account whose health events may not be read: not asked again for a day.
export function pauseHealth(data: {
  state: CloudConnectionPullState;
  accountId: string;
  now: Date;
  forMs: number;
}): void {
  data.state.healthPausedAccounts = {
    ...(data.state.healthPausedAccounts || {}),
    [data.accountId]: new Date(data.now.getTime() + data.forMs).toISOString(),
  };
}

/*
 * Where every place's read had got to before a read of the changes: kept
 * so that a read whose changes could not all be written can be read again
 * (restoreChangeWindow).
 */
export interface CloudChangeWindowSnapshot {
  changeCursors?: Record<string, string> | undefined;
  changeResume?: Record<string, string> | undefined;
  healthReadAt?: string | undefined;
  accountHealthReadAt?: Record<string, string> | undefined;
  recentChanges?: Record<string, Record<string, number>> | undefined;
}

export function snapshotChangeWindow(
  state: CloudConnectionPullState,
): CloudChangeWindowSnapshot {
  const recentChanges: Record<string, Record<string, number>> | undefined =
    state.recentChanges ? {} : undefined;

  for (const [place, seen] of Object.entries(state.recentChanges || {})) {
    recentChanges![place] = { ...(seen || {}) };
  }

  return {
    changeCursors: state.changeCursors ? { ...state.changeCursors } : undefined,
    changeResume: state.changeResume ? { ...state.changeResume } : undefined,
    healthReadAt: state.healthReadAt,
    accountHealthReadAt: state.accountHealthReadAt
      ? { ...state.accountHealthReadAt }
      : undefined,
    recentChanges,
  };
}

/*
 * A read whose changes were not all written, or that failed part way:
 * every place goes back to where it was, so the next read reads the same
 * stretch again.
 *
 *   - `unwrittenEventIds` given (the read went through, and the change
 *     store did not take some of what it brought in): those are forgotten
 *     as seen, so the next read writes them; the ones that were written
 *     stay seen, and are not written twice.
 *   - not given (the read itself failed, and nothing it brought in was
 *     written): what was seen goes back to where it was too.
 */
export function restoreChangeWindow(data: {
  state: CloudConnectionPullState;
  snapshot: CloudChangeWindowSnapshot;
  unwrittenEventIds?: Array<string> | undefined;
}): void {
  const state: CloudConnectionPullState = data.state;

  if (!data.unwrittenEventIds) {
    if (data.snapshot.recentChanges) {
      state.recentChanges = data.snapshot.recentChanges;
    } else {
      delete state.recentChanges;
    }
  }

  if (data.snapshot.changeCursors) {
    state.changeCursors = { ...data.snapshot.changeCursors };
  } else {
    delete state.changeCursors;
  }

  if (data.snapshot.changeResume) {
    state.changeResume = { ...data.snapshot.changeResume };
  } else {
    delete state.changeResume;
  }

  if (data.snapshot.healthReadAt) {
    state.healthReadAt = data.snapshot.healthReadAt;
  } else {
    delete state.healthReadAt;
  }

  if (data.snapshot.accountHealthReadAt) {
    state.accountHealthReadAt = { ...data.snapshot.accountHealthReadAt };
  } else {
    delete state.accountHealthReadAt;
  }

  const unwritten: Set<string> = new Set<string>(data.unwrittenEventIds || []);

  if (unwritten.size === 0 || !state.recentChanges) {
    return;
  }

  const recentChanges: Record<string, Record<string, number>> = {};

  for (const [place, seen] of Object.entries(state.recentChanges)) {
    const kept: Array<[string, number]> = Object.entries(seen || {}).filter(
      (entry: [string, number]): boolean => {
        return !unwritten.has(entry[0]);
      },
    );

    if (kept.length > 0) {
      recentChanges[place] = Object.fromEntries(kept);
    }
  }

  state.recentChanges = recentChanges;
}
