import Monitor from "Common/Models/DatabaseModels/Monitor";
import Select from "Common/Types/BaseDatabase/Select";
import PermissionGate from "Common/UI/Utils/PermissionGate";

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

export type GetReadableMonitorSecretKeySelectFunction = () => Select<Monitor>;

export const getReadableMonitorSecretKeySelect: GetReadableMonitorSecretKeySelectFunction =
  (): Select<Monitor> => {
    const select: Select<Monitor> = {};

    for (const column of MONITOR_SECRET_KEY_COLUMNS) {
      if (PermissionGate.canReadColumn(new Monitor(), column as string)) {
        (select as Record<string, boolean>)[column as string] = true;
      }
    }

    return select;
  };

export default getReadableMonitorSecretKeySelect;
