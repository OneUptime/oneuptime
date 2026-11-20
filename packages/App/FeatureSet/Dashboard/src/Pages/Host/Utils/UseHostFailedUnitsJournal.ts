import OneUptimeDate from "Common/Types/Date";
import { useEffect, useState } from "react";
import { SystemdUnitJournalLine } from "./SystemdUnitFailure";
import {
  getSystemdUnitJournalWindow,
  readSystemdFailedUnitsJournal,
} from "./SystemdUnitJournal";

/*
 * WHY A HOST'S FAILED UNITS FAILED, FOR ITS OVERVIEW (#10129).
 *
 * A host's Needs attention, and what its Degraded opens, listed each failed
 * systemd unit as "Failed", a step from the unit's page: the reader opened
 * the unit to learn why. The Overview now reads why they failed, as the
 * Systemd Units list's count does: one bounded read of what systemd said of
 * those units (their result and exit lines, readSystemdFailedUnitsJournal),
 * so another unit's chatter never pushes a failure out of it.
 *
 * It reads when the page opens with failed units, when the units that
 * failed change, and on Refresh (refreshToken) - never on a tick of the
 * page's auto-refresh, which reads the host again every few seconds. A read
 * that has not landed, or failed, answers null: the rows say Failed, as
 * they did. A read again keeps the last one's lines while it runs.
 */
export function useHostFailedUnitsJournal(data: {
  hostIdentifier: string | null | undefined;
  // The units to read about, as getHostFailedUnitNames lists them.
  unitNames: ReadonlyArray<string>;
  // Changed by the page's Refresh: read again.
  refreshToken: number;
}): ReadonlyArray<SystemdUnitJournalLine> | null {
  const hostIdentifier: string = (data.hostIdentifier || "").trim();
  // What the lines are of: a read of other units' is no answer about these.
  const readKey: string = [hostIdentifier, ...data.unitNames].join("\n");

  const [read, setRead] = useState<{
    key: string;
    lines: Array<SystemdUnitJournalLine>;
  } | null>(null);

  useEffect(() => {
    if (!hostIdentifier || data.unitNames.length === 0) {
      return undefined;
    }

    let isCancelled: boolean = false;

    readSystemdFailedUnitsJournal({
      hostIdentifier: hostIdentifier,
      unitNames: data.unitNames,
      window: getSystemdUnitJournalWindow(OneUptimeDate.getCurrentDate()),
    })
      .then((lines: Array<SystemdUnitJournalLine>) => {
        if (!isCancelled) {
          setRead({ key: readKey, lines: lines });
        }
      })
      .catch(() => {
        /*
         * The rows say Failed, as before: what is wrong is still listed, a
         * step from each unit's page, which reads its own journal again.
         */
      });

    return () => {
      isCancelled = true;
    };
  }, [readKey, data.refreshToken]);

  return read && read.key === readKey ? read.lines : null;
}
