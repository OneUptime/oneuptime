import Monitor from "Common/Models/DatabaseModels/Monitor";
import Select from "Common/Types/BaseDatabase/Select";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import RecordLocks, { getRecordLabelIds } from "Common/UI/Utils/RecordLocks";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The monitor secret-key columns, and whether the signed-in user may ask for
 * them.
 *
 * These three columns are bearer credentials, so their read ACL is gated on
 * the ability to ROTATE the key rather than on the ability to view the monitor
 * (see Monitor.serverMonitorSecretKey and issue #3360). That makes them the
 * first columns on Monitor that a legitimate dashboard user can be refused --
 * and an unreadable column in a select is fatal, not degraded: ColumnPermission
 * throws and the entire getItem fails, so a Viewer opening the monitor page
 * would get an error screen instead of a monitor.
 *
 * Every page that wants a secret key spreads this into its select instead of
 * naming the columns directly, so the three pages cannot drift apart on which
 * ones they gate. The pages already render the "no key" branch (`monitor
 * ?.serverMonitorSecretKey ? ... : <></>`), so omitting the field degrades to
 * simply not offering the key -- which is the correct outcome for someone who
 * is not allowed to see it.
 */
export const MONITOR_SECRET_KEY_COLUMNS: Array<keyof Monitor> = [
  "serverMonitorSecretKey",
  "incomingRequestSecretKey",
  "incomingEmailSecretKey",
];

/*
 * Every column that carries a monitor credential: the three keys, plus an
 * Incoming Email monitor's custom address name, which replaces the
 * key-derived address while it is set and is gated exactly like the keys.
 * The pages that show an inbound address need both to know which address is
 * live, so they are fetched (and withheld) together.
 */
export const MONITOR_CREDENTIAL_COLUMNS: Array<keyof Monitor> = [
  ...MONITOR_SECRET_KEY_COLUMNS,
  "incomingEmailCustomLocalPart",
];

/*
 * Said where a key would be shown to someone who may not see it on this
 * monitor: a Viewer, or a role that reads keys only on the monitors
 * carrying some labels (#11259) - the server leaves the key out of the
 * others, and "No key generated" would say the monitor has none.
 */
export const MONITOR_SECRET_KEY_HIDDEN: string = translationKey(
  "Only people who may change this monitor can see its secret key.",
);

/*
 * Whether the reader may see `column` on this monitor, read with its labels'
 * ids: the column's read, and the monitor's labels where that read is
 * limited to some (RecordLocks.mayReadColumnOnRecord).
 */
export function canSeeMonitorCredential(
  monitor: Monitor,
  column: keyof Monitor,
): boolean {
  return RecordLocks.mayReadColumnOnRecord(
    new Monitor(),
    column as string,
    getRecordLabelIds(monitor, "labels"),
  );
}

export type GetReadableMonitorSecretKeySelectFunction = () => Select<Monitor>;

export const getReadableMonitorSecretKeySelect: GetReadableMonitorSecretKeySelectFunction =
  (): Select<Monitor> => {
    const select: Select<Monitor> = {};

    for (const column of MONITOR_CREDENTIAL_COLUMNS) {
      if (PermissionGate.canReadColumn(new Monitor(), column as string)) {
        (select as Record<string, boolean>)[column as string] = true;
      }
    }

    return select;
  };

export default getReadableMonitorSecretKeySelect;
