/*
 * WHAT A PROBE CLAIM'S DUE TIME PROMISES, FOR A PAGE THAT SHOWS IT.
 *
 * A probe is handed the rows it collects or scans by a claim: the vCenters
 * (VMwareProbeCollectionStore), the OpenStack clouds
 * (OpenStackProbeCollectionStore) and the data stores whose content it
 * scans (DataSecurityProbeClaim). Each claim reads one column, the row's
 * next due time, and moves it on when it hands the row out. A row that is
 * due but that nothing may take - archived, its scan off, no credential, a
 * probe that may not have it - is set aside instead: its due time moves a
 * quarter of an hour on, and again a quarter of an hour later, for as long
 * as nothing may take it (Server/Utils/Probe/ClaimSetAside, OneUptime issue
 * #7919).
 *
 * So the column says when the claim looks at the row next, and promises a
 * collection only when nothing stops the claim handing the row out and
 * something will ask for it. A page read it as that promise all the same:
 * a store with its scan off showed "Next Content Scan: in 17 minutes", a
 * time that kept moving and never came (OneUptime issue #8042).
 *
 * A page reads the column through readClaimDue, with the reason nothing may
 * take the row - worked out from the row by the same rule as its claim's,
 * or null when nothing stops it - and gets one of four answers. Only
 * Scheduled is a time to show as "next".
 */

export enum ClaimDueState {
  // Due later, and something will take it then: the due time is a promise.
  Scheduled = "Scheduled",
  // Due now, or never given a time (the claim makes such a row due): soon.
  DueNow = "DueNow",
  // Due for longer than taking it should take: nothing has come for it.
  Overdue = "Overdue",
  // Nothing will take it, whatever its due time says: `stop` says why.
  Stopped = "Stopped",
}

export interface ClaimDue<TStop> {
  state: ClaimDueState;
  /*
   * Scheduled: when it is due. DueNow and Overdue: since when, or null for a
   * row never given a time. Stopped: always null, so nothing shows the time
   * the set-aside wrote.
   */
  dueAt: Date | null;
  // Why nothing will take it: Stopped only, null otherwise.
  stop: TStop | null;
}

// A due time as a row holds it - a Date, or the string JSON brought - or null.
export function readDueTime(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const date: Date =
    value instanceof Date ? value : new Date(value as string | number);

  return Number.isNaN(date.getTime()) ? null : date;
}

export function readClaimDue<TStop>(data: {
  // Why nothing may take the row now, or null when nothing stops it.
  stop: TStop | null | undefined;
  dueAt: unknown;
  // On the server's clock, as the claim's own `now` is.
  now: Date;
  // How long past due a row may be before something should have taken it.
  overdueAfterInMs: number;
}): ClaimDue<TStop> {
  if (data.stop !== null && data.stop !== undefined) {
    return { state: ClaimDueState.Stopped, dueAt: null, stop: data.stop };
  }

  const dueAt: Date | null = readDueTime(data.dueAt);

  if (!dueAt) {
    return { state: ClaimDueState.DueNow, dueAt: null, stop: null };
  }

  const pastDueInMs: number = data.now.getTime() - dueAt.getTime();

  if (pastDueInMs < 0) {
    return { state: ClaimDueState.Scheduled, dueAt: dueAt, stop: null };
  }

  if (pastDueInMs > data.overdueAfterInMs) {
    return { state: ClaimDueState.Overdue, dueAt: dueAt, stop: null };
  }

  return { state: ClaimDueState.DueNow, dueAt: dueAt, stop: null };
}
