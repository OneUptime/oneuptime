import OnCallDutyPolicyUserOverride from "Common/Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import { HeldPermissions } from "Common/Types/HeldPermissions";
import GlobalUserOverrideAccess, {
  GLOBAL_USER_OVERRIDE_ADD_REFUSAL,
  GLOBAL_USER_OVERRIDE_DELETE_REFUSAL,
} from "Common/Types/OnCallDutyPolicy/GlobalUserOverrideAccess";
import Permission from "Common/Types/Permission";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import User from "Common/UI/Utils/User";

/*
 * WHY ADD OR DELETE IS LOCKED ON THE GLOBAL USER OVERRIDES PAGE.
 *
 * A global override applies to every on-call policy, so adding or deleting
 * one takes a permission to add (or to delete) user overrides over the
 * whole project (GlobalUserOverrideAccess, which the server holds every
 * write to - issue #5617). Someone whose permission covers only some
 * policies - limited to their team's policies, or to its label - would
 * otherwise fill in Add User Override and be refused on save. The page
 * locks Add, and each row's Delete, for them instead, saying why and where
 * their overrides go: on each policy's own User Overrides page.
 *
 * The shortcuts that add a global override lock the same way, with the same
 * words (getGlobalUserOverrideShortcutLock): "Skip until..." on a person in
 * a schedule layer, and "Get cover" on an upcoming shift.
 *
 * React-free, so its tests read the snapshot they hand it.
 */

export type GlobalUserOverrideAction = ModelAction.Create | ModelAction.Delete;

export interface GlobalUserOverrideLockOptions {
  // The permission snapshot to read; the stored one when left out.
  held?: HeldPermissions | undefined;
}

/*
 * Why `action` is locked on the Global User Overrides page for the reader,
 * in English for the shared components to translate - or null when it is
 * not locked for this reason: the reader may take it, a master admin
 * included, or holds no permission for it at all, which the table's own
 * gate locks, naming the permission (PermissionGate).
 */
export const getGlobalUserOverrideLock: (
  action: GlobalUserOverrideAction,
  options?: GlobalUserOverrideLockOptions,
) => string | null = (
  action: GlobalUserOverrideAction,
  options?: GlobalUserOverrideLockOptions,
): string | null => {
  const model: OnCallDutyPolicyUserOverride =
    new OnCallDutyPolicyUserOverride();

  if (
    User.isMasterAdmin() ||
    !PermissionGate.check(model, action, { held: options?.held }).isAllowed
  ) {
    return null;
  }

  const permissions: Array<Permission> =
    (action === ModelAction.Create
      ? model.getCreatePermissions()
      : model.getDeletePermissions()) || [];

  if (
    GlobalUserOverrideAccess.mayChange(
      PermissionGate.getHeldPermissions({ held: options?.held }),
      permissions,
    )
  ) {
    return null;
  }

  return action === ModelAction.Create
    ? GLOBAL_USER_OVERRIDE_ADD_REFUSAL
    : GLOBAL_USER_OVERRIDE_DELETE_REFUSAL;
};

/*
 * Why a shortcut that adds a global override is locked for the reader -
 * "Skip until..." on a person in a schedule layer, "Get cover" on an
 * upcoming shift - or null when it is not. Each opens a form that saves an
 * override naming no policy, so where the save would be refused the
 * shortcut is locked up front: for a reader who holds no permission to add
 * overrides at all, with the permission it takes (PermissionGate), and for
 * one whose permission covers only some policies, with the global page's
 * reason (getGlobalUserOverrideLock). There is no shortcut to the policies
 * they do cover: the server alone weighs which policies a permission
 * limited to labels or to owned policies reaches. Null as well while the
 * snapshot has not landed: the server decides then, as before.
 */
export const getGlobalUserOverrideShortcutLock: (
  options?: GlobalUserOverrideLockOptions,
) => string | null = (
  options?: GlobalUserOverrideLockOptions,
): string | null => {
  const gate: PermissionGateResult = PermissionGate.check(
    new OnCallDutyPolicyUserOverride(),
    ModelAction.Create,
    { held: options?.held },
  );

  if (!gate.isAllowed) {
    return gate.disabledReason || null;
  }

  return getGlobalUserOverrideLock(ModelAction.Create, options);
};
