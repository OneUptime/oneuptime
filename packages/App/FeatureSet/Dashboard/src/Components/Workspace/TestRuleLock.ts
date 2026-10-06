import WorkspaceNotificationRule from "Common/Models/DatabaseModels/WorkspaceNotificationRule";
import Permission, {
  UserGlobalAccessPermission,
  UserPermission,
  UserTenantAccessPermission,
} from "Common/Types/Permission";
import PermissionGate, {
  ModelAction,
  PermissionGateOptions,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import PermissionUtil from "Common/UI/Utils/Permission";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import User from "Common/UI/Utils/User";

/*
 * "Test Rule" on a Slack or Microsoft Teams notification rule posts a test
 * message into the rule's channels, so the server asks the permission a
 * channel's own Send Test asks: could create a notification rule
 * (WorkspaceNotificationRuleAPI). The rule's row says so rather than lead
 * into that refusal: for someone the dashboard knows may not, the button is
 * locked, and its tooltip says what it takes. Someone it does not know yet -
 * the permissions not loaded - keeps the button, and the server decides.
 *
 * "Could create a rule" is asked the server's way (CommonAPI
 * .assertCanCreateTable): a grant on the rule's create list - a team's block
 * row is no grant - and no team block on that list. A block of the whole
 * table (one with no labels) overrides every grant. A master admin is never
 * blocked.
 */

export const TEST_RULE_LOCKED_TOOLTIP: string = translationKey(
  "Sending a test needs permission to create notification rules.",
);

export interface TestRuleLock {
  isLocked: boolean;
  // Why it is locked, in English: the row's button translates it.
  tooltip?: string | undefined;
}

export interface TestRuleLockOptions extends PermissionGateOptions {
  /*
   * Overrides the project's permission rows read from storage, block rows
   * included. Only used by tests.
   */
  projectPermissions?: UserTenantAccessPermission | null | undefined;
}

const LOCKED: TestRuleLock = {
  isLocked: true,
  tooltip: TEST_RULE_LOCKED_TOOLTIP,
};

const NOT_LOCKED: TestRuleLock = { isLocked: false };

const isBlockRow: (row: UserPermission) => boolean = (
  row: UserPermission,
): boolean => {
  return row.isBlockPermission === true;
};

// The grants the server counts: the global ones, and every row but a block.
const getGrants: (
  projectPermissions: UserTenantAccessPermission | null | undefined,
) => Array<Permission> = (
  projectPermissions: UserTenantAccessPermission | null | undefined,
): Array<Permission> => {
  const globalPermissions: UserGlobalAccessPermission | null =
    PermissionUtil.getGlobalPermissions();

  return [
    ...(globalPermissions?.globalPermissions || []),
    ...(projectPermissions?.permissions || [])
      .filter((row: UserPermission): boolean => {
        return !isBlockRow(row);
      })
      .map((row: UserPermission): Permission => {
        return row.permission;
      }),
  ];
};

// Whether a team blocks creating rules: a block of the whole table.
const isCreatingRulesBlocked: (
  projectPermissions: UserTenantAccessPermission | null | undefined,
) => boolean = (
  projectPermissions: UserTenantAccessPermission | null | undefined,
): boolean => {
  const createPermissions: Array<Permission> =
    new WorkspaceNotificationRule().getCreatePermissions();

  return (projectPermissions?.permissions || []).some(
    (row: UserPermission): boolean => {
      return (
        isBlockRow(row) &&
        (!row.labelIds || row.labelIds.length === 0) &&
        createPermissions.includes(row.permission)
      );
    },
  );
};

export const getTestRuleLock: (
  options?: TestRuleLockOptions,
) => TestRuleLock = (options?: TestRuleLockOptions): TestRuleLock => {
  const projectPermissions: UserTenantAccessPermission | null | undefined =
    options && options.projectPermissions !== undefined
      ? options.projectPermissions
      : PermissionUtil.getProjectPermissions();

  const gate: PermissionGateResult = PermissionGate.check(
    new WorkspaceNotificationRule(),
    ModelAction.Create,
    {
      ...options,
      permissions: options?.permissions ?? getGrants(projectPermissions),
    },
  );

  if (!gate.isAllowed) {
    // Nothing to say means not known yet: the server decides.
    return gate.disabledReason ? LOCKED : NOT_LOCKED;
  }

  if (User.isMasterAdmin()) {
    return NOT_LOCKED;
  }

  return isCreatingRulesBlocked(projectPermissions) ? LOCKED : NOT_LOCKED;
};
