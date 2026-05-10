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
 * private alerts. Other users only see private alerts they own
 * (directly via AlertOwnerUser, or transitively through AlertOwnerTeam
 * + TeamMember).
 */
export function shouldBypassAlertPrivacy(
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
 * Raw clause to apply on Alert.isPrivate. Lets non-private rows through
 * unconditionally, and private rows only when the current user is an owner
 * (directly, or via team membership). Returns undefined when the caller
 * should bypass the filter entirely.
 */
export function getAlertSelfPrivacyRaw(
  props: DatabaseCommonInteractionProps,
): FindWhereProperty<any> | undefined {
  if (shouldBypassAlertPrivacy(props)) {
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
        `"Alert"."_id" IN (SELECT aou."alertId" FROM "AlertOwnerUser" aou WHERE aou."userId" = :${uidRid} AND aou."deletedAt" IS NULL) OR ` +
        `"Alert"."_id" IN (SELECT aot."alertId" FROM "AlertOwnerTeam" aot INNER JOIN "TeamMember" tm ON tm."teamId" = aot."teamId" WHERE tm."userId" = :${uidRid} AND tm."deletedAt" IS NULL AND aot."deletedAt" IS NULL))`
      );
    },
    {
      [uidRid]: props.userId.toString(),
    },
  );
}

/*
 * Raw clause to apply on a child table's alertId column. Only rows whose
 * parent Alert the user is allowed to see pass. Returns undefined when the
 * caller should bypass the filter entirely.
 */
export function getAlertRelatedRecordPrivacyRaw(
  props: DatabaseCommonInteractionProps,
): FindWhereProperty<any> | undefined {
  if (shouldBypassAlertPrivacy(props)) {
    return undefined;
  }

  if (!props.userId) {
    return Raw((alias: string): string => {
      return `(${alias} IN (SELECT a."_id" FROM "Alert" a WHERE a."deletedAt" IS NULL AND (a."isPrivate" IS NULL OR a."isPrivate" = FALSE)))`;
    });
  }

  const uidRid: string = "uidRel_" + Text.generateRandomText(10);

  return Raw(
    (alias: string): string => {
      return (
        `(${alias} IN (SELECT a."_id" FROM "Alert" a WHERE a."deletedAt" IS NULL AND (` +
        `a."isPrivate" IS NULL OR a."isPrivate" = FALSE OR ` +
        `a."_id" IN (SELECT aou."alertId" FROM "AlertOwnerUser" aou WHERE aou."userId" = :${uidRid} AND aou."deletedAt" IS NULL) OR ` +
        `a."_id" IN (SELECT aot."alertId" FROM "AlertOwnerTeam" aot INNER JOIN "TeamMember" tm ON tm."teamId" = aot."teamId" WHERE tm."userId" = :${uidRid} AND tm."deletedAt" IS NULL AND aot."deletedAt" IS NULL))))`
      );
    },
    {
      [uidRid]: props.userId.toString(),
    },
  );
}

export function applyAlertSelfPrivacyFilter<T>(
  query: T,
  props: DatabaseCommonInteractionProps,
): T {
  const rawClause: FindWhereProperty<any> | undefined =
    getAlertSelfPrivacyRaw(props);

  if (!rawClause) {
    return query;
  }

  if (!query) {
    return { isPrivate: rawClause } as unknown as T;
  }

  (query as any).isPrivate = rawClause;
  return query;
}

export function applyAlertRelatedRecordPrivacyFilter<T>(
  query: T,
  props: DatabaseCommonInteractionProps,
): T {
  const rawClause: FindWhereProperty<any> | undefined =
    getAlertRelatedRecordPrivacyRaw(props);

  if (!rawClause) {
    return query;
  }

  if (!query) {
    return { alertId: rawClause } as unknown as T;
  }

  (query as any).alertId = rawClause;
  return query;
}
