/*
 * WHO MAY ARRANGE COVER FOR EVERY POLICY: the app's copy of the server's
 * rule (Common/Types/OnCallDutyPolicy/GlobalUserOverrideAccess), which it
 * cannot import - the app is built without Common's runtime code.
 *
 * Cover arranged in the app is a global user override: it names no policy,
 * so it applies to every on-call policy in the project, another team's as
 * much as the person's own. The server takes a permission to add user
 * overrides held over the whole project for one (issue #5617). A permission
 * limited to some labels, or to the policies the person's team owns, adds
 * overrides on those policies only, and a team's block on it for some
 * labels takes global ones away as well. Without this check the sheet let
 * such a person pick a teammate and a duration, and refused it on Confirm.
 *
 * What the person holds comes from the server itself: every answer about a
 * project carries their permission rows there in its `project-permissions`
 * header, which api/projectPermissions keeps. A master admin may arrange
 * any.
 *
 * This file imports nothing on purpose:
 * Common/Tests/Types/OnCallDutyPolicy/GlobalUserOverrideAccessMobileParity
 * compiles it as it is and runs it beside the server's rule over thousands
 * of generated permission rows, so neither can change alone.
 */

// The permissions that add a user override (its table's create list).
export const USER_OVERRIDE_CREATE_PERMISSIONS: ReadonlyArray<string> = [
  "ProjectOwner",
  "ProjectAdmin",
  "ProjectMember",
  "OnCallAdmin",
  "OnCallMember",
  "CreateOnCallDutyPolicyUserOverride",
];

/*
 * The roles no scope narrows (PermissionHelper.isScopeApplicable): one held
 * as All reaches the whole project whatever labels its row carries, and so
 * does one held as Owned.
 */
const ROLES_NO_SCOPE_NARROWS: ReadonlyArray<string> = [
  "ProjectOwner",
  "ProjectAdmin",
  "SettingsAdmin",
  "SettingsMember",
  "SettingsViewer",
  "BillingAdmin",
  "BillingMember",
  "BillingViewer",
];

// One permission row, as the `project-permissions` header carries it.
export interface ProjectPermissionRow {
  permission: string;
  labelIds?: ReadonlyArray<unknown> | null | undefined;
  // "All", "Owned" or "Labels"; absent on a legacy row.
  scope?: string | null | undefined;
  isBlockPermission?: boolean | null | undefined;
}

/*
 * - allowed: they may add a global override (a master admin among them);
 * - limited: they may add overrides, but only on some policies;
 * - not-allowed: they may not add overrides at all;
 * - unknown: no word from the server about the project yet.
 */
export type GlobalOverrideAccess =
  | "allowed"
  | "limited"
  | "not-allowed"
  | "unknown";

export const GLOBAL_OVERRIDE_LIMITED_REASON: string =
  "Cover arranged in the app applies to every on-call policy in this project, and your permission to add user overrides covers only some of them. Add the override on the policy's own User Overrides page on the web instead.";

export const GLOBAL_OVERRIDE_NOT_ALLOWED_REASON: string =
  "You do not have permission to add user overrides in this project, so cover cannot be arranged in the app.";

// A row that takes its permission away, rather than granting it.
function isBlockRow(row: ProjectPermissionRow): boolean {
  return row.isBlockPermission === true;
}

function hasLabels(row: ProjectPermissionRow): boolean {
  return Boolean(row.labelIds && row.labelIds.length > 0);
}

// PermissionHelper.isLimitedToLabels.
function isLimitedToLabels(row: ProjectPermissionRow): boolean {
  if (!hasLabels(row)) {
    return false;
  }

  if (row.scope === "Owned") {
    return false;
  }

  return !(
    row.scope === "All" && ROLES_NO_SCOPE_NARROWS.includes(row.permission)
  );
}

// HeldPermissionsUtil.isProjectWideRow: one that reaches every policy.
function isProjectWideRow(row: ProjectPermissionRow): boolean {
  if (row.scope === "Owned") {
    return ROLES_NO_SCOPE_NARROWS.includes(row.permission);
  }

  return !isLimitedToLabels(row);
}

export function getGlobalOverrideAccess(data: {
  rows: ReadonlyArray<ProjectPermissionRow> | null;
  isMasterAdmin: boolean;
}): GlobalOverrideAccess {
  if (data.isMasterAdmin) {
    return "allowed";
  }

  if (!data.rows) {
    return "unknown";
  }

  const rows: Array<ProjectPermissionRow> = data.rows.filter(
    (row: ProjectPermissionRow): boolean => {
      return Boolean(
        row && USER_OVERRIDE_CREATE_PERMISSIONS.includes(row.permission),
      );
    },
  );

  const blocks: Array<ProjectPermissionRow> = rows.filter(isBlockRow);
  const allows: Array<ProjectPermissionRow> = rows.filter(
    (row: ProjectPermissionRow): boolean => {
      return !isBlockRow(row);
    },
  );

  // Nothing grants it, or a block with no labels takes it away outright.
  if (
    allows.length === 0 ||
    blocks.some((row: ProjectPermissionRow): boolean => {
      return !hasLabels(row);
    })
  ) {
    return "not-allowed";
  }

  // A block for some labels takes it away on the policies carrying them.
  if (blocks.length > 0) {
    return "limited";
  }

  return allows.some(isProjectWideRow) ? "allowed" : "limited";
}

// Why cover for every policy cannot be arranged, or null when it can.
export function getGlobalOverrideLockReason(
  access: GlobalOverrideAccess,
): string | null {
  if (access === "limited") {
    return GLOBAL_OVERRIDE_LIMITED_REASON;
  }

  if (access === "not-allowed") {
    return GLOBAL_OVERRIDE_NOT_ALLOWED_REASON;
  }

  return null;
}

// An id as the header writes one: a string, or an ObjectID as JSON.
function readId(value: unknown): string {
  if (typeof value === "string") {
    return value.trim().toLowerCase();
  }

  if (value && typeof value === "object") {
    const inner: unknown = (value as Record<string, unknown>)["value"];

    return typeof inner === "string" ? inner.trim().toLowerCase() : "";
  }

  return "";
}

/*
 * The rows a `project-permissions` header carries for `projectId`, or null
 * when it carries none that can be read - or names another project.
 */
export function readProjectPermissionRows(
  header: unknown,
  projectId: string,
): Array<ProjectPermissionRow> | null {
  if (typeof header !== "string" || !header) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(header);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const snapshot: Record<string, unknown> = parsed as Record<string, unknown>;
  const namedProjectId: string = readId(snapshot["projectId"]);

  if (namedProjectId && namedProjectId !== projectId.trim().toLowerCase()) {
    return null;
  }

  const permissions: unknown = snapshot["permissions"];

  if (!Array.isArray(permissions)) {
    return null;
  }

  const rows: Array<ProjectPermissionRow> = [];

  for (const item of permissions) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record: Record<string, unknown> = item as Record<string, unknown>;
    const permission: unknown = record["permission"];

    if (typeof permission !== "string" || !permission) {
      continue;
    }

    rows.push({
      permission: permission,
      labelIds: Array.isArray(record["labelIds"]) ? record["labelIds"] : [],
      scope: typeof record["scope"] === "string" ? record["scope"] : undefined,
      isBlockPermission: record["isBlockPermission"] === true,
    });
  }

  return rows;
}
