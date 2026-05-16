import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { FindWhereProperty } from "../../../Types/BaseDatabase/Query";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import Text from "../../../Types/Text";
import { Raw } from "typeorm";

/*
 * Project owners and admins, plus root/master-admin contexts, see all
 * private incidents. Other users only see private incidents they own
 * (directly via IncidentOwnerUser, or transitively through IncidentOwnerTeam
 * + TeamMember).
 */
export function shouldBypassIncidentPrivacy(
  props: DatabaseCommonInteractionProps,
): boolean {
  if (props.isRoot || props.isMasterAdmin) {
    return true;
  }

  if (props.tenantId && props.userTenantAccessPermission) {
    const tenantPerm: UserTenantAccessPermission | undefined =
      props.userTenantAccessPermission[props.tenantId.toString()];

    if (
      tenantPerm?.permissions?.some((p: UserPermission): boolean => {
        return (
          p.permission === Permission.ProjectOwner ||
          p.permission === Permission.ProjectAdmin
        );
      })
    ) {
      return true;
    }
  }

  return false;
}

/*
 * Raw clause to apply on Incident.isPrivate. Lets non-private rows through
 * unconditionally, and private rows only when the current user is an owner
 * (directly, or via team membership). Returns undefined when the caller
 * should bypass the filter entirely.
 */
export function getIncidentSelfPrivacyRaw(
  props: DatabaseCommonInteractionProps,
): FindWhereProperty<any> | undefined {
  if (shouldBypassIncidentPrivacy(props)) {
    return undefined;
  }

  if (!props.userId) {
    return Raw((alias: string): string => {
      return `(${alias} IS NULL OR ${alias} = FALSE)`;
    });
  }

  const uidRid: string = "uidPriv_" + Text.generateRandomText(10);

  return Raw(
    (alias: string): string => {
      return (
        `(${alias} IS NULL OR ${alias} = FALSE OR ` +
        `"Incident"."_id" IN (SELECT iou."incidentId" FROM "IncidentOwnerUser" iou WHERE iou."userId" = :${uidRid} AND iou."deletedAt" IS NULL) OR ` +
        `"Incident"."_id" IN (SELECT iot."incidentId" FROM "IncidentOwnerTeam" iot INNER JOIN "TeamMember" tm ON tm."teamId" = iot."teamId" WHERE tm."userId" = :${uidRid} AND tm."deletedAt" IS NULL AND iot."deletedAt" IS NULL))`
      );
    },
    {
      [uidRid]: props.userId.toString(),
    },
  );
}

/*
 * Raw clause to apply on a child table's incidentId column. Only rows whose
 * parent Incident the user is allowed to see pass. Returns undefined when the
 * caller should bypass the filter entirely.
 */
export function getIncidentRelatedRecordPrivacyRaw(
  props: DatabaseCommonInteractionProps,
): FindWhereProperty<any> | undefined {
  if (shouldBypassIncidentPrivacy(props)) {
    return undefined;
  }

  if (!props.userId) {
    return Raw((alias: string): string => {
      return `(${alias} IN (SELECT i."_id" FROM "Incident" i WHERE i."deletedAt" IS NULL AND (i."isPrivate" IS NULL OR i."isPrivate" = FALSE)))`;
    });
  }

  const uidRid: string = "uidRel_" + Text.generateRandomText(10);

  return Raw(
    (alias: string): string => {
      return (
        `(${alias} IN (SELECT i."_id" FROM "Incident" i WHERE i."deletedAt" IS NULL AND (` +
        `i."isPrivate" IS NULL OR i."isPrivate" = FALSE OR ` +
        `i."_id" IN (SELECT iou."incidentId" FROM "IncidentOwnerUser" iou WHERE iou."userId" = :${uidRid} AND iou."deletedAt" IS NULL) OR ` +
        `i."_id" IN (SELECT iot."incidentId" FROM "IncidentOwnerTeam" iot INNER JOIN "TeamMember" tm ON tm."teamId" = iot."teamId" WHERE tm."userId" = :${uidRid} AND tm."deletedAt" IS NULL AND iot."deletedAt" IS NULL))))`
      );
    },
    {
      [uidRid]: props.userId.toString(),
    },
  );
}

export function applyIncidentSelfPrivacyFilter<T>(
  query: T,
  props: DatabaseCommonInteractionProps,
): T {
  const rawClause: FindWhereProperty<any> | undefined =
    getIncidentSelfPrivacyRaw(props);

  if (!rawClause) {
    return query;
  }

  if (!query) {
    return { isPrivate: rawClause } as unknown as T;
  }

  (query as any).isPrivate = rawClause;
  return query;
}

export function applyIncidentRelatedRecordPrivacyFilter<T>(
  query: T,
  props: DatabaseCommonInteractionProps,
): T {
  const rawClause: FindWhereProperty<any> | undefined =
    getIncidentRelatedRecordPrivacyRaw(props);

  if (!rawClause) {
    return query;
  }

  if (!query) {
    return { incidentId: rawClause } as unknown as T;
  }

  (query as any).incidentId = rawClause;
  return query;
}
