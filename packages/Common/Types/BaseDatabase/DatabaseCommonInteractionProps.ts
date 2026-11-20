import { PlanType } from "../Billing/SubscriptionPlan";
import Dictionary from "../Dictionary";
import ObjectID from "../ObjectID";
import RequestOrigin from "../RequestOrigin";
import {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../Permission";
import UserType from "../UserType";
import { WorkflowRunAsAudit } from "../Workflow/WorkflowRunAs";
import WriteSource from "./WriteSource";
import ReadAudience from "./ReadAudience";

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
   * Team membership for the requesting user within the current tenant.
   * Absent for non-user callers (API keys, Probes). The `Owned` permission
   * scope does not read it: each permission row names the team it is
   * granted on (UserPermission.teamId), and an Owned row reaches what the
   * user and that team own - not what the user's other teams own
   * (OwnedScopePermission.getOwningTeamIds).
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
   * The workflow whose step made the change (UserType.Workflow), for the
   * audit trail only, like the credential above: no permission check reads
   * them. A workflow is no person, so these are how an audit entry names it.
   */
  workflowId?: ObjectID | undefined;
  workflowName?: string | undefined;
  /*
   * What the workflow whose step this is runs as, when it is more than the
   * default permissions (Types/Workflow/WorkflowRunAs: ProjectOwner or
   * CustomRole). Set by WorkflowPrincipal alone, and read by one check: a
   * step of a workflow that runs with the default permissions - no mark -
   * changes nobody's access (WorkflowPrincipal.assertDoesNotChangeAccess).
   * What the step may do is in its permission rows, as for anyone.
   */
  workflowRunAs?: string | undefined;
  /*
   * What the workflow whose step this is ran as, and with whose
   * permissions - Default, or Project Owner or a custom role given by a
   * person or a project API key (#9766) - for the audit trail only, like
   * workflowId and workflowName: no permission check reads it. Set by
   * WorkflowPrincipal on every step's props, so each audit entry a step's
   * change makes says it (AuditLogRecorder).
   */
  workflowRunAsAudit?: WorkflowRunAsAudit | undefined;
  /*
   * Where the change came from when it was not made by the person's own
   * hand: Ask AI, acting for them (Server/Utils/AI/Toolbox/
   * WorkflowBuilderTools). For attribution only, like the credential above:
   * no permission check reads it, and the change is still the person's. A
   * workflow's version history keeps such a change as a version of its own
   * (WorkflowVersionPolicy, issue #6258).
   */
  writeSource?: WriteSource | undefined;
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
  /*
   * Where the request that made the change came from - its address, place
   * and device (Server/Utils/RequestOrigin) - for the security emails a
   * write sends its owner, and for nothing else: no permission check reads
   * it. "Your password was changed" (UserService) says from where.
   */
  requestOrigin?: RequestOrigin | undefined;
  /*
   * The signed-in session the request was made with (its access token's
   * session, which UserAuthorization.readRequestSession found live and the
   * token's person's), and only that: none for an API key, an MCP client
   * or a workflow. Read by one check: a change to how its person signs in
   * waits until this session has confirmed it's theirs
   * (Server/Utils/Reauthentication, #10155).
   */
  sessionId?: ObjectID | undefined;
  /*
   * A run of OneUptime's own whose writing everyone who may see its subject
   * reads - an AI investigation's report, in its incident's or alert's feed
   * and channels (#9576). Read with isRoot only: the run reads as root, but
   * only what every one of those readers may read - the permission layer
   * narrows each read by it (ReadAudienceScope), as it narrows a person's by
   * their grants. Never a permission: it only ever takes records away.
   */
  readAudience?: ReadAudience | undefined;
}
