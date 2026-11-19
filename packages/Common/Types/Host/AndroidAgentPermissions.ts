/*
 * THE GRANTS THE ONEUPTIME ANDROID AGENT STILL LACKS ON A DEVICE (#9967).
 *
 * The agent reads every app's crash stacks, native crashes and reboot
 * reasons from DropBox, and every app's logs, once it has READ_LOGS, usage
 * access and, on Android 15 and later, READ_DROPBOX_DATA. No app and no
 * device policy can give them - READ_LOGS and READ_DROPBOX_DATA are
 * `signature|privileged|development` permissions, which a device owner's
 * setPermissionGrantState refuses (it grants only runtime permissions), and
 * usage access is an app op - so each is granted with adb, or usage access
 * by the person at the device in Settings.
 *
 * Every report of the agent says which it still lacks, as the resource
 * attribute `oneuptime.agent.permissions.missing`: the adb names of the
 * missing grants ("READ_LOGS GET_USAGE_STATS"), or "none". Inventory keeps
 * it with the device's item (InventoryItem's descriptive attributes), and
 * its Agent Permissions filter and column list the devices of a fleet that
 * still need them.
 */

export const ANDROID_AGENT_PERMISSIONS_ATTRIBUTE: string =
  "oneuptime.agent.permissions.missing";

// What the agent sends once it lacks nothing.
export const ANDROID_AGENT_PERMISSIONS_NONE: string = "none";

export enum AndroidAgentPermission {
  ReadLogs = "READ_LOGS",
  ReadDropBoxData = "READ_DROPBOX_DATA",
  UsageAccess = "GET_USAGE_STATS",
}

export enum AndroidAgentPermissionsStatus {
  Missing = "missing",
  Granted = "granted",
}

// The adb command that grants each, as the agent's screen and the docs write it.
export const ANDROID_AGENT_GRANT_COMMANDS: Readonly<
  Record<AndroidAgentPermission, string>
> = {
  [AndroidAgentPermission.ReadLogs]:
    "adb shell pm grant com.oneuptime.androidagent android.permission.READ_LOGS",
  [AndroidAgentPermission.ReadDropBoxData]:
    "adb shell pm grant com.oneuptime.androidagent android.permission.READ_DROPBOX_DATA",
  [AndroidAgentPermission.UsageAccess]:
    "adb shell appops set com.oneuptime.androidagent GET_USAGE_STATS allow",
};

const KNOWN: ReadonlyArray<string> = Object.values(AndroidAgentPermission);

// Names the agent writes, one space apart: the same test as the SQL below.
const MISSING_LIST: RegExp = new RegExp(
  `^(${KNOWN.join("|")})( (${KNOWN.join("|")}))*$`,
);

export default class AndroidAgentPermissions {
  /*
   * The grants a value says are missing, in the agent's order: an empty
   * list for "none", undefined when the value is none the agent sends.
   */
  public static readMissing(
    value: unknown,
  ): Array<AndroidAgentPermission> | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const text: string = value.trim();

    if (text === ANDROID_AGENT_PERMISSIONS_NONE) {
      return [];
    }

    if (!MISSING_LIST.test(text)) {
      return undefined;
    }

    const names: Array<string> = text.split(" ");

    return (KNOWN as Array<AndroidAgentPermission>).filter(
      (permission: AndroidAgentPermission): boolean => {
        return names.includes(permission);
      },
    );
  }

  public static getStatus(
    value: unknown,
  ): AndroidAgentPermissionsStatus | undefined {
    const missing: Array<AndroidAgentPermission> | undefined =
      AndroidAgentPermissions.readMissing(value);

    if (!missing) {
      return undefined;
    }

    return missing.length > 0
      ? AndroidAgentPermissionsStatus.Missing
      : AndroidAgentPermissionsStatus.Granted;
  }

  /*
   * The status as a Postgres expression over an Inventory item's
   * descriptiveAttributes under `tableAlias` (already quoted): the
   * `agentPermissionsStatus` virtual column. Null for an item the agent
   * does not run on, or one that says something else.
   */
  public static getStatusSql(tableAlias: string): string {
    const value: string = `btrim(${tableAlias}."descriptiveAttributes" ->> '${ANDROID_AGENT_PERMISSIONS_ATTRIBUTE}')`;
    const names: string = KNOWN.join("|");

    return `CASE
        WHEN ${value} = '${ANDROID_AGENT_PERMISSIONS_NONE}' THEN '${AndroidAgentPermissionsStatus.Granted}'
        WHEN ${value} ~ '^(${names})( (${names}))*$' THEN '${AndroidAgentPermissionsStatus.Missing}'
        ELSE NULL
      END`;
  }
}
