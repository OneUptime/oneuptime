import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { ResourceAttentionDialogRead } from "../../../Components/ResourcePart/ResourceAttentionDialog";
import {
  SYSTEMD_FAILED_UNITS_LISTED,
  SystemdFailedUnit,
  SystemdUnitJournalLine,
  getSystemdFailedUnitItems,
  getSystemdUnitFailedItem,
  getSystemdUnitItemKey,
} from "./SystemdUnitFailure";
import {
  getSystemdUnitJournalWindow,
  readSystemdFailedUnitsJournal,
  readSystemdUnitJournal,
} from "./SystemdUnitJournal";

/*
 * WHAT THE DIALOGS BEHIND A FAILED SYSTEMD UNIT READ, WHEN THEY OPEN.
 *
 * One unit's Failed - in its page's hero (#9748), or on its row of the host's
 * Systemd Units list (#9960) - reads the unit's journal again and lists it:
 * why, as systemd said it, since when, and what it printed. From the list
 * its row has View, to the unit's page; on that page it is "This unit".
 *
 * The list's count of failed units opens all of them at once (#9960): one
 * read of what systemd said of why those units failed (their result and
 * exit lines, SystemdUnitJournal), the newest failure first, at most
 * SYSTEMD_FAILED_UNITS_LISTED of them - the dialog says when there are more.
 */

// How many failed units the list's count opens, the newest failure first.
export { SYSTEMD_FAILED_UNITS_LISTED };

export async function loadSystemdUnitFailure(data: {
  hostIdentifier: string;
  unitName: string;
  translator: Translator;
  // From a list: the unit's page, which its row's View opens.
  unitRoute?: Route | undefined;
  now?: Date | undefined;
}): Promise<ResourceAttentionDialogRead> {
  const lines: Array<SystemdUnitJournalLine> = await readSystemdUnitJournal({
    hostIdentifier: data.hostIdentifier,
    unitName: data.unitName,
    window: getSystemdUnitJournalWindow(
      data.now || OneUptimeDate.getCurrentDate(),
    ),
  });

  return {
    items: [
      getSystemdUnitFailedItem({
        unitName: data.unitName,
        lines: lines,
        translator: data.translator,
        // From a list it is a row of its own; on its page, "This unit".
        key: data.unitRoute ? getSystemdUnitItemKey(data.unitName) : undefined,
        route: data.unitRoute,
      }),
    ],
  };
}

export async function loadSystemdFailedUnits(data: {
  hostIdentifier: string;
  units: ReadonlyArray<SystemdFailedUnit>;
  translator: Translator;
  now?: Date | undefined;
}): Promise<ResourceAttentionDialogRead> {
  const units: Array<SystemdFailedUnit> = [...data.units]
    .sort((a: SystemdFailedUnit, b: SystemdFailedUnit): number => {
      return a.name.localeCompare(b.name);
    })
    .slice(0, SYSTEMD_FAILED_UNITS_LISTED);

  const lines: Array<SystemdUnitJournalLine> =
    await readSystemdFailedUnitsJournal({
      hostIdentifier: data.hostIdentifier,
      unitNames: units.map((unit: SystemdFailedUnit): string => {
        return unit.name;
      }),
      window: getSystemdUnitJournalWindow(
        data.now || OneUptimeDate.getCurrentDate(),
      ),
    });

  return {
    items: getSystemdFailedUnitItems({
      units: units,
      lines: lines,
      translator: data.translator,
    }),
    isTruncated: data.units.length > units.length,
  };
}
