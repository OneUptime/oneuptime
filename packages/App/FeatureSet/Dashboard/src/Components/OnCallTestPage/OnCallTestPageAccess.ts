import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Permission from "Common/Types/Permission";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";

/*
 * WHO THE DASHBOARD OFFERS A TEST PAGE TO (OnCallTestPage), as the server
 * decides it (OnCallTestPageService):
 *
 *   - yourself: anyone;
 *   - a member: who may send them a setup reminder - the project's owners
 *     and admins, the on-call admin, and whoever may change who gets paged;
 *   - a policy: whoever may edit it.
 *
 * The server asks again; this only keeps a button from being offered to
 * somebody it would refuse.
 */

export const TEST_PAGE_FOR_MEMBER_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.OnCallAdmin,
  Permission.EditProjectOnCallDutyPolicy,
];

export function canSendTestPageToMember(): boolean {
  return PermissionGate.holdsAnyOf(TEST_PAGE_FOR_MEMBER_PERMISSIONS);
}

export function getTestPolicyGate(): PermissionGateResult {
  return PermissionGate.check(new OnCallDutyPolicy(), ModelAction.Update);
}
