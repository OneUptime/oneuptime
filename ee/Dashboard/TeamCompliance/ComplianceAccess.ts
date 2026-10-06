import TeamComplianceSetting from "Common/Models/DatabaseModels/TeamComplianceSetting";
import Permission from "Common/Types/Permission";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import UserUtil from "Common/UI/Utils/User";

/*
 * What the signed-in person may do on the Compliance page.
 *
 * Rule create / edit / delete are decided exactly the way ModelTable decides
 * its own buttons (PermissionGate over TeamComplianceSetting's table access
 * control), so this page and every other settings table agree on who is an
 * editor - and a person whose permissions have not loaded yet is shown a
 * read-only page rather than told they lack a permission they may hold.
 */
export interface ComplianceAccess {
  create: PermissionGateResult;
  update: PermissionGateResult;
  delete: PermissionGateResult;
  /*
   * May open another member's on-call setup (Users > View > On-call
   * readiness). The same triple that page itself checks
   * (Pages/Users/View/OnCall/Context.tsx, NOTIFICATION_RULE_READ_PERMISSIONS):
   * the two administration roles alongside the granular permission, because
   * roles are what existing projects actually hand out.
   */
  canViewMemberSetup: boolean;
  // "" when the session has no user id.
  currentUserId: string;
}

export const MEMBER_SETUP_READ_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ReadProjectUserNotificationRule,
];

// The noun the locked-button tooltips use ("... to create this compliance rule").
const GATE_OPTIONS: { singularName: string } = {
  singularName: "compliance rule",
};

export const getComplianceAccess: () => ComplianceAccess =
  (): ComplianceAccess => {
    const model: TeamComplianceSetting = new TeamComplianceSetting();

    return {
      create: PermissionGate.check(model, ModelAction.Create, GATE_OPTIONS),
      update: PermissionGate.check(model, ModelAction.Update, GATE_OPTIONS),
      delete: PermissionGate.check(model, ModelAction.Delete, GATE_OPTIONS),
      canViewMemberSetup:
        UserUtil.isMasterAdmin() ||
        PermissionGate.holdsAnyOf([...MEMBER_SETUP_READ_PERMISSIONS]),
      currentUserId: UserUtil.getUserId().toString(),
    };
  };
