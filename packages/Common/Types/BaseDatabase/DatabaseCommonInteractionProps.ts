import { PlanType } from "../Billing/SubscriptionPlan";
import Dictionary from "../Dictionary";
import ObjectID from "../ObjectID";
import {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../Permission";
import UserType from "../UserType";

export default interface DatabaseCommonInteractionProps {
  userId?: ObjectID | undefined;
  userGlobalAccessPermission?: UserGlobalAccessPermission | undefined;
  userTenantAccessPermission?:
    | Dictionary<UserTenantAccessPermission> // tenantId <-> UserTenantAccessPermission
    | undefined;
  userType?: UserType | undefined;
  tenantId?: ObjectID | undefined;
  isRoot?: boolean | undefined;
  isMultiTenantRequest?: boolean | undefined;
  ignoreHooks?: boolean | undefined;
  currentPlan?: PlanType | undefined;
  isSubscriptionUnpaid?: boolean | undefined;
  isMasterAdmin?: boolean | undefined;
  /*
   * Team membership for the requesting user within the current tenant. Used by
   * the `Owned` permission scope to filter resources by team ownership. Absent
   * for non-user callers (API keys, Probes), in which case `Owned` evaluates
   * as `All`.
   */
  userTeamIds?: Array<ObjectID> | undefined;
}
