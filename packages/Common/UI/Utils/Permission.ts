import {
  DropdownOption,
  DropdownOptionGroup,
} from "../Components/Dropdown/Dropdown";
import LocalStorage from "./LocalStorage";
import ProjectUtil from "./Project";
import { JSONObject, JSONValue } from "../../Types/JSON";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../Types/HeldPermissions";
import ObjectID from "../../Types/ObjectID";
import Permission, {
  PermissionGroup,
  PermissionHelper,
  PermissionProps,
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../Types/Permission";

/*
 * Where the browser keeps the signed-in user's permission snapshot, as the
 * API's permission headers leave it: their global permissions, and their
 * rows in each project they open.
 *
 * Every tab open on the Dashboard's address shares this storage. A
 * project's snapshot used to be kept under one name for every project
 * ("project_permissions", and its hash under "project-permissions-hash"),
 * so with two projects open in two tabs, each tab's answers overwrote the
 * other's: one tab's buttons and pages followed the other project's role
 * until its own next answer came back, and its requests sent the other
 * project's hash, so the server sent the snapshot again every time. A page
 * that read several projects at once (My On-Call Policies) left the last
 * of them as the tab's role in the same way.
 *
 * Each project's snapshot, and its hash, are now kept under names that end
 * in the project's id: a tab reads the snapshot of the project it shows
 * (ProjectUtil.getCurrentProjectId, the project its requests name), and a
 * request sends the hash of the project its tenantid header names
 * (Utils/API/API.ts). The two old names are left where they are and never
 * read or written: a tab still running the version before keeps using them
 * until it reloads, and signing out clears them with everything else
 * (KeptAfterSignOut.ts).
 *
 * The global snapshot stays one name for every tab, on purpose: it is the
 * person's own - the permissions they hold everywhere and the projects they
 * belong to - and every tab of this browser is signed in as the same person.
 *
 * This is what the browser shows and offers, not what is allowed: the
 * server decides every request from its own copy of the person's
 * permissions, and reads the hashes only to tell whether to send the
 * snapshot again.
 */

export const PROJECT_PERMISSIONS_STORAGE_KEY_PREFIX: string =
  "project_permissions:";

export const PROJECT_PERMISSIONS_HASH_STORAGE_KEY_PREFIX: string =
  "project-permissions-hash:";

export const GLOBAL_PERMISSIONS_STORAGE_KEY: string = "global_permissions";

export const GLOBAL_PERMISSIONS_HASH_STORAGE_KEY: string =
  "global-permissions-hash";

/*
 * A project id as the snapshot's names carry it: trimmed, in lower case, as
 * the API writes ids, and a real uuid - anything else names no project, so
 * nothing is kept or read for it.
 */
export function toPermissionsProjectId(
  projectId: ObjectID | string | null | undefined,
): string | null {
  const id: string = (projectId?.toString() || "").trim().toLowerCase();

  return id && ObjectID.isValidUUID(id) ? id : null;
}

// The name a project's snapshot is kept under, or null for no project.
export function getProjectPermissionsStorageKey(
  projectId: ObjectID | string | null | undefined,
): string | null {
  const id: string | null = toPermissionsProjectId(projectId);

  return id ? `${PROJECT_PERMISSIONS_STORAGE_KEY_PREFIX}${id}` : null;
}

// The name the hash of a project's snapshot is kept under, or null.
export function getProjectPermissionsHashStorageKey(
  projectId: ObjectID | string | null | undefined,
): string | null {
  const id: string | null = toPermissionsProjectId(projectId);

  return id ? `${PROJECT_PERMISSIONS_HASH_STORAGE_KEY_PREFIX}${id}` : null;
}

/*
 * Storage can be missing, full or refused (a private window, blocked site
 * data). A snapshot that cannot be read reads as none - the gates then hide
 * what they would otherwise lock, as before the first answer - and one
 * that cannot be written is not kept. Neither ever fails the request whose
 * answer carried it.
 */
function readStored(key: string): JSONValue {
  try {
    return LocalStorage.getItem(key);
  } catch {
    return null;
  }
}

function removeStored(key: string): void {
  try {
    LocalStorage.removeItem(key);
  } catch {
    // Nothing kept to remove, or a storage that refuses access.
  }
}

// Every project snapshot this browser keeps, but the one for `keepId`.
function forgetOtherProjectsPermissions(keepId: string): void {
  let keys: Array<string> = [];

  try {
    keys = Object.keys(LocalStorage.getAllItems());
  } catch {
    return;
  }

  for (const key of keys) {
    const isProjectSnapshot: boolean =
      key.startsWith(PROJECT_PERMISSIONS_STORAGE_KEY_PREFIX) ||
      key.startsWith(PROJECT_PERMISSIONS_HASH_STORAGE_KEY_PREFIX);

    if (isProjectSnapshot && !key.endsWith(keepId)) {
      removeStored(key);
    }
  }
}

/*
 * Writes one project's snapshot, or its hash. A browser whose storage is
 * full makes room by forgetting the other projects' snapshots - the server
 * sends each of them again with that project's next answer - and tries
 * once more.
 */
function writeProjectStored(
  projectId: string,
  key: string,
  value: JSONValue,
): boolean {
  try {
    LocalStorage.setItem(key, value);
    return true;
  } catch {
    forgetOtherProjectsPermissions(projectId);
  }

  try {
    LocalStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function writeStored(key: string, value: JSONValue): void {
  try {
    LocalStorage.setItem(key, value);
  } catch {
    // Not kept: the server sends it again with the next answer.
  }
}

/*
 * Whether the user may do something is decided by PermissionGate
 * (holdsAnyOf, check, canReadColumn), which reads this snapshot by the rule
 * the server follows (Types/HeldPermissions). Nothing else decides from the
 * raw rows (Tests/UI/Utils/PermissionGateGuard).
 */
export default class PermissionUtil {
  public static getGlobalPermissions(): UserGlobalAccessPermission | null {
    const globalPermissions: JSONObject | null = readStored(
      GLOBAL_PERMISSIONS_STORAGE_KEY,
    ) as JSONObject | null;

    if (!globalPermissions || typeof globalPermissions !== "object") {
      return null;
    }

    return globalPermissions as UserGlobalAccessPermission;
  }

  /*
   * What the user holds, read by the one rule (HeldPermissionsUtil): their
   * global permissions, every allow row, and what their blocks take away.
   */
  public static getHeldPermissions(): HeldPermissions {
    return HeldPermissionsUtil.fromRows({
      rows: this.getProjectPermissions()?.permissions || [],
      globalPermissions: this.getGlobalPermissions()?.globalPermissions || [],
    });
  }

  /*
   * The permissions the user holds, as a flat list: what their allow rows
   * (and global permissions) grant, less what a block with no labels takes
   * away. A block row is never in it. Empty until the snapshot has loaded.
   */
  public static getAllPermissions(): Array<Permission> {
    return HeldPermissionsUtil.getUnblockedPermissions(
      this.getHeldPermissions(),
    );
  }

  /*
   * The project this tab shows: the one its address names, else the one it
   * was showing (ProjectUtil.getCurrentProjectId) - the project every
   * request of the tab names in its tenantid header. Null when the tab
   * shows none, or its storage cannot be read.
   */
  public static getTabProjectId(): string | null {
    try {
      return toPermissionsProjectId(ProjectUtil.getCurrentProjectId());
    } catch {
      return null;
    }
  }

  /*
   * The user's rows in a project: by default the project this tab shows,
   * and never another project's - a snapshot kept under a project's name
   * that names another project is not read. Null until that project's
   * first answer has come back, or when the tab shows no project.
   */
  public static getProjectPermissions(
    projectId?: ObjectID | string | null | undefined,
  ): UserTenantAccessPermission | null {
    const id: string | null =
      projectId === undefined
        ? this.getTabProjectId()
        : toPermissionsProjectId(projectId);

    const key: string | null = getProjectPermissionsStorageKey(id);

    if (!id || !key) {
      return null;
    }

    const permissions: JSONObject | null = readStored(
      key,
    ) as JSONObject | null;

    if (
      !permissions ||
      typeof permissions !== "object" ||
      toPermissionsProjectId(permissions["projectId"] as string) !== id
    ) {
      return null;
    }

    const userTenantAccessPermission: UserTenantAccessPermission =
      permissions as UserTenantAccessPermission;
    userTenantAccessPermission._type = "UserTenantAccessPermission";
    return userTenantAccessPermission;
  }

  /*
   * The hash of the snapshot this browser keeps for a project - what a
   * request about that project tells the server it already has. Only while
   * the snapshot itself is kept too: without it, the server must send it.
   */
  public static getProjectPermissionsHash(
    projectId: ObjectID | string | null | undefined,
  ): string | null {
    const key: string | null = getProjectPermissionsHashStorageKey(projectId);

    if (!key || !this.getProjectPermissions(projectId || null)) {
      return null;
    }

    const hash: JSONValue = readStored(key);

    return typeof hash === "string" && hash ? hash : null;
  }

  public static getGlobalPermissionsHash(): string | null {
    const hash: JSONValue = readStored(GLOBAL_PERMISSIONS_HASH_STORAGE_KEY);

    return typeof hash === "string" && hash ? hash : null;
  }

  public static projectPermissionsAsDropdownOptions(): Array<DropdownOptionGroup> {
    const permissions: Array<PermissionProps> =
      PermissionHelper.getTenantPermissionProps();

    const groupMap: Map<PermissionGroup, Array<DropdownOption>> = new Map();

    for (const permissionProp of permissions) {
      const group: PermissionGroup = permissionProp.group;

      if (!groupMap.has(group)) {
        groupMap.set(group, []);
      }

      groupMap.get(group)!.push({
        value: permissionProp.permission,
        label: permissionProp.title,
      });
    }

    const groups: Array<DropdownOptionGroup> = [];

    for (const [group, options] of groupMap) {
      groups.push({
        label: group,
        options,
      });
    }

    return groups;
  }

  public static setGlobalPermissions(
    permissions: UserGlobalAccessPermission,
  ): void {
    writeStored(GLOBAL_PERMISSIONS_STORAGE_KEY, permissions);
  }

  public static setGlobalPermissionsHash(hash: string): void {
    writeStored(GLOBAL_PERMISSIONS_HASH_STORAGE_KEY, hash);
  }

  /*
   * Keeps a project's snapshot under that project's names - the project the
   * snapshot itself names (its projectId), whichever tab's answer carried
   * it - with the hash the server sent beside it. A snapshot that names no
   * project is not kept: there is no telling whose it is. Without a hash,
   * any hash kept for the project goes, so the server sends the snapshot
   * again rather than trusting one it may not match.
   */
  public static setProjectPermissions(
    permissions: UserTenantAccessPermission,
    options?: { hash?: string | null | undefined } | undefined,
  ): void {
    const id: string | null = toPermissionsProjectId(
      permissions?.projectId as ObjectID | string | undefined,
    );
    const key: string | null = getProjectPermissionsStorageKey(id);
    const hashKey: string | null = getProjectPermissionsHashStorageKey(id);

    if (!id || !key || !hashKey) {
      return;
    }

    if (!writeProjectStored(id, key, permissions)) {
      // Not kept: nothing stale stays in its place, and the server sends it again.
      this.clearProjectPermissions(id);
      return;
    }

    const hash: string | null =
      typeof options?.hash === "string" && options.hash ? options.hash : null;

    if (!hash || !writeProjectStored(id, hashKey, hash)) {
      removeStored(hashKey);
    }
  }

  /*
   * Forgets a project's snapshot and its hash - by default those of the
   * project this tab shows - and no other project's: another tab may be
   * showing one.
   */
  public static clearProjectPermissions(
    projectId?: ObjectID | string | null | undefined,
  ): void {
    const id: string | null =
      projectId === undefined
        ? this.getTabProjectId()
        : toPermissionsProjectId(projectId);
    const key: string | null = getProjectPermissionsStorageKey(id);
    const hashKey: string | null = getProjectPermissionsHashStorageKey(id);

    if (key) {
      removeStored(key);
    }

    if (hashKey) {
      removeStored(hashKey);
    }
  }
}
