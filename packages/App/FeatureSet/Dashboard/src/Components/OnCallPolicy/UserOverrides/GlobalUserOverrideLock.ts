import OnCallDutyPolicyUserOverride from "Common/Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import { HeldPermissions } from "Common/Types/HeldPermissions";
import GlobalUserOverrideAccess, {
  GLOBAL_USER_OVERRIDE_ADD_REFUSAL,
  GLOBAL_USER_OVERRIDE_DELETE_REFUSAL,
  GLOBAL_USER_OVERRIDE_EDIT_REFUSAL,
} from "Common/Types/OnCallDutyPolicy/GlobalUserOverrideAccess";
import Permission from "Common/Types/Permission";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import User from "Common/UI/Utils/User";

/*
 * WHY ADD, EDIT OR DELETE IS LOCKED ON THE GLOBAL USER OVERRIDES PAGE.
 *
 * A global override applies to every on-call policy, so adding, editing or
 * deleting one takes a permission to add (to edit, to delete) user
 * overrides over the whole project (GlobalUserOverrideAccess, which the
 * server holds every write to - issue #5617). Someone whose permission
 * covers only some policies - limited to their team's policies, or to its
 * label - would otherwise fill in Add User Override and be refused on save.
 * The page locks Add, and each row's Edit and Delete, for them instead,
 * saying why and where their overrides go: on each policy's own User
 * Overrides page. A global override listed on a schedule (its active
 * overrides card) locks its Edit the same way.
 *
 * The shortcuts that would add a global override - "Skip until..." on a
 * person in a schedule layer, and "Get cover" on an upcoming shift - ask
 * the server instead which policies they may cover, and offer those
 * (getGlobalUserOverrideShortcut, UserOverridePolicies). Where it allows
 * none they lock the same way, with the same words.
 *
 * React-free, so its tests read the snapshot they hand it.
 */

export type GlobalUserOverrideAction =
  | ModelAction.Create
  | ModelAction.Update
  | ModelAction.Delete;

// The permissions of the table that `action` takes.
const getActionPermissions: (
  model: OnCallDutyPolicyUserOverride,
  action: GlobalUserOverrideAction,
) => Array<Permission> = (
  model: OnCallDutyPolicyUserOverride,
  action: GlobalUserOverrideAction,
): Array<Permission> => {
  if (action === ModelAction.Create) {
    return model.getCreatePermissions() || [];
  }

  if (action === ModelAction.Update) {
    return model.getUpdatePermissions() || [];
  }

  return model.getDeletePermissions() || [];
};

const REFUSALS: Record<GlobalUserOverrideAction, string> = {
  [ModelAction.Create]: GLOBAL_USER_OVERRIDE_ADD_REFUSAL,
  [ModelAction.Update]: GLOBAL_USER_OVERRIDE_EDIT_REFUSAL,
  [ModelAction.Delete]: GLOBAL_USER_OVERRIDE_DELETE_REFUSAL,
};

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

  if (
    GlobalUserOverrideAccess.mayChange(
      PermissionGate.getHeldPermissions({ held: options?.held }),
      getActionPermissions(model, action),
    )
  ) {
    return null;
  }

  return REFUSALS[action];
};

/*
 * What a shortcut that would add a global override does for the reader -
 * "Skip until..." on a person in a schedule layer, "Get cover" on an
 * upcoming shift:
 *
 *   - Global: it adds a global override, as it always did - the reader may
 *     add one (a master admin included), or the snapshot has not landed
 *     and the server decides, as before;
 *   - Locked: the reader holds no permission to add overrides at all, and
 *     `reason` names the permission it takes (PermissionGate);
 *   - SomePolicies: the reader's permission covers only some policies. The
 *     shortcut asks the server which of the policies it would reach they
 *     may cover (UserOverrideAddAccess) and offers those, one override on
 *     each; where it allows none - or until it has answered - the shortcut
 *     is locked with `reason`, the global page's (getGlobalUserOverrideLock).
 *     Only the server weighs which policies a permission limited to labels
 *     or to owned policies reaches, so the Dashboard never guesses.
 */
export enum GlobalUserOverrideShortcutKind {
  Global = "Global",
  Locked = "Locked",
  SomePolicies = "SomePolicies",
}

export interface GlobalUserOverrideShortcut {
  kind: GlobalUserOverrideShortcutKind;
  // Why it is locked, in English for the shared components to translate; null for Global.
  reason: string | null;
}

export const getGlobalUserOverrideShortcut: (
  options?: GlobalUserOverrideLockOptions,
) => GlobalUserOverrideShortcut = (
  options?: GlobalUserOverrideLockOptions,
): GlobalUserOverrideShortcut => {
  const gate: PermissionGateResult = PermissionGate.check(
    new OnCallDutyPolicyUserOverride(),
    ModelAction.Create,
    { held: options?.held },
  );

  if (!gate.isAllowed) {
    return {
      kind: GlobalUserOverrideShortcutKind.Locked,
      reason: gate.disabledReason || null,
    };
  }

  const reason: string | null = getGlobalUserOverrideLock(
    ModelAction.Create,
    options,
  );

  return reason
    ? { kind: GlobalUserOverrideShortcutKind.SomePolicies, reason: reason }
    : { kind: GlobalUserOverrideShortcutKind.Global, reason: null };
};

/*
 * Why a shortcut that would add a global override cannot add one for the
 * reader, or null when it can (getGlobalUserOverrideShortcut): the
 * permission it takes, or - for a reader whose permission covers only some
 * policies - the global page's reason.
 */
export const getGlobalUserOverrideShortcutLock: (
  options?: GlobalUserOverrideLockOptions,
) => string | null = (
  options?: GlobalUserOverrideLockOptions,
): string | null => {
  return getGlobalUserOverrideShortcut(options).reason;
};
