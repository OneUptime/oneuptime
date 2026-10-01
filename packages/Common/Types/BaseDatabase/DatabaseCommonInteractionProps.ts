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
  /*
   * Which credential the caller used, carried for the audit trail only: no
   * permission check reads them. An API key request has no userId, so without
   * these an audit entry could say that "an API key" made a change but not
   * which; and a change an MCP client makes for a member would be
   * indistinguishable from one the member made in the dashboard.
   */
  apiKeyId?: ObjectID | undefined;
  apiKeyName?: string | undefined;
  mcpOAuthGrantId?: ObjectID | undefined;
  mcpClientName?: string | undefined;
  /*
   * The caller's credential was issued for reading only: an MCP client its
   * user authorized as read-only. Every create, update and delete made with
   * these props is refused, whatever the caller's permissions would allow
   * (DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite). The MCP
   * server already refuses the tools that change things for such a client;
   * this is the same promise kept by the API itself, so it does not rest on
   * every tool being classified correctly.
   */
  isReadOnlyCredential?: boolean | undefined;
}
