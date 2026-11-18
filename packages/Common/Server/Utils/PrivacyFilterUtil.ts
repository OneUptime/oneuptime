import Includes from "../../Types/BaseDatabase/Includes";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { FindWhereProperty } from "../../Types/BaseDatabase/Query";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import QueryHelper from "../Types/Database/QueryHelper";
import CallerPermission from "./Permission/CallerPermission";
import UserType from "../../Types/UserType";
import { And, Equal, FindOperator } from "typeorm";

// Who sees every private record of a project (incidents, alerts, episodes).
export const PRIVATE_RECORD_BYPASS_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

/*
 * Whether the caller sees every private incident, alert or episode of the
 * project, not only the ones they own: root and master-admin contexts, and
 * project owners and admins - held the way every permission check reads it
 * (CallerPermission). A block row for either role is no grant, and a block
 * with no labels on either takes it away. Seeing every private record
 * reaches the whole project, so only a grant that reaches the whole project
 * counts (projectWideOnly): one limited to some labels does not.
 *
 * A workflow's step acts as a Project Admin (WorkflowPrincipal), but is
 * never lent a Project Admin's sight of private records (#8914): whoever
 * builds a workflow decides where what its steps read goes - a webhook, an
 * email, a chat, its own run log - and that can be a Project Member who
 * may not see a private record, or whose team that owns it may only view
 * it. So a step sees and changes no private incident, alert or episode,
 * nor anything of one, as an API key without Project Owner or Project
 * Admin does not: it is no person and owns nothing.
 */
export function shouldBypassRecordPrivacy(
  props: DatabaseCommonInteractionProps,
): boolean {
  if (props.isRoot || props.isMasterAdmin) {
    return true;
  }

  if (props.userType === UserType.Workflow) {
    return false;
  }

  /*
   * A read across projects (is-multi-tenant-query) is answered with a query
   * per project of the caller's, while this is asked once, of the project
   * the request names besides (tenantid), if any: an owner of a project of
   * their own who sent both read the private incidents of every project
   * they were in. Across projects, every private record is read by its
   * owners alone.
   */
  if (!props.tenantId || props.isMultiTenantRequest) {
    return false;
  }

  return CallerPermission.holdsAnyOf(props, PRIVATE_RECORD_BYPASS_PERMISSIONS, {
    projectWideOnly: true,
  });
}

/*
 * THE SAME RULE, FOR A PRIVATE RECORD HELD IN MEMORY: one not created yet,
 * whose owners are known by id - the incident or alert a monitor's criteria
 * would open, which "When this goes down" describes (WhoIsToldService,
 * #7213). The caller may read it when they see every private record
 * (shouldBypassRecordPrivacy), when they are one of its owners, or when
 * they have accepted their invitation to a team of its owners: what the
 * SQL rule reads (getIncidentSelfPrivacyRaw and its twins: the record's
 * owner user rows, and its owner team rows joined to TeamMember with
 * hasAcceptedInvitation), by id. A caller who is no person - an API key
 * without Project Owner or Project Admin, a workflow's step - reads none.
 */
export function canReadPrivateRecordWithOwners(data: {
  props: DatabaseCommonInteractionProps;
  ownerUserIds: ReadonlyArray<string>;
  ownerTeamIds: ReadonlyArray<string>;
  // The teams whose invitation the caller has accepted, by lower-cased id.
  callerAcceptedTeamIds: ReadonlySet<string>;
}): boolean {
  if (shouldBypassRecordPrivacy(data.props)) {
    return true;
  }

  if (data.props.userType === UserType.Workflow || !data.props.userId) {
    return false;
  }

  const callerId: string = data.props.userId.toString().toLowerCase();

  if (
    data.ownerUserIds.some((id: string): boolean => {
      return id.toLowerCase() === callerId;
    })
  ) {
    return true;
  }

  return data.ownerTeamIds.some((id: string): boolean => {
    return data.callerAcceptedTeamIds.has(id.toLowerCase());
  });
}

/*
 * Combines a caller-supplied filter value with a privacy Raw clause so that
 * BOTH apply. The privacy filters used to overwrite the caller's value, which
 * silently widened per-record queries (e.g. `incidentId: <id>` on the
 * incident's Private Notes page) to every record the user was allowed to see
 * — leaking notes/feed/owner rows across incidents for non-admin users.
 *
 * Runs in onBefore* hooks, i.e. BEFORE QueryUtil.serializeQuery, so the
 * existing value can be a plain value (string/ObjectID/boolean/array), an
 * Includes operator, or an already-built TypeORM FindOperator. Values are
 * converted to TypeORM operators here because serializeQuery does not
 * transform values nested inside And().
 */
export function combineWithPrivacyClause(
  existingValue: unknown,
  privacyClause: FindWhereProperty<any>,
): FindWhereProperty<any> {
  const privacyOperator: FindOperator<any> =
    privacyClause as unknown as FindOperator<any>;

  if (existingValue === undefined || existingValue === null) {
    return privacyClause;
  }

  if (existingValue instanceof FindOperator) {
    return And(existingValue, privacyOperator) as FindWhereProperty<any>;
  }

  if (existingValue instanceof ObjectID) {
    return And(
      Equal(existingValue.toString()),
      privacyOperator,
    ) as FindWhereProperty<any>;
  }

  if (existingValue instanceof Includes) {
    return And(
      QueryHelper.any(existingValue.values) as unknown as FindOperator<any>,
      privacyOperator,
    ) as FindWhereProperty<any>;
  }

  if (Array.isArray(existingValue)) {
    return And(
      QueryHelper.any(
        existingValue as Array<string | ObjectID | number>,
      ) as unknown as FindOperator<any>,
      privacyOperator,
    ) as FindWhereProperty<any>;
  }

  if (
    typeof existingValue === "string" ||
    typeof existingValue === "number" ||
    typeof existingValue === "boolean" ||
    existingValue instanceof Date
  ) {
    return And(Equal(existingValue), privacyOperator) as FindWhereProperty<any>;
  }

  /*
   * Unrecognized operator shape (no caller passes these on privacy-filtered
   * keys today). Fail closed: the privacy clause must always apply.
   */
  return privacyClause;
}
