import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { FindWhereProperty } from "../../../Types/BaseDatabase/Query";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import Text from "../../../Types/Text";
import { combineWithPrivacyClause } from "../PrivacyFilterUtil";
import { Raw } from "typeorm";

export function shouldBypassAlertEpisodePrivacy(
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

export function getAlertEpisodeSelfPrivacyRaw(
  props: DatabaseCommonInteractionProps,
): FindWhereProperty<any> | undefined {
  if (shouldBypassAlertEpisodePrivacy(props)) {
    return undefined;
  }

  if (!props.userId) {
    return Raw((alias: string): string => {
      return `(${alias} IS NULL OR ${alias} = FALSE)`;
    });
  }

  const uidRid: string = "uidAEpiPriv_" + Text.generateRandomText(10);

  return Raw(
    (alias: string): string => {
      return (
        `(${alias} IS NULL OR ${alias} = FALSE OR ` +
        `"AlertEpisode"."_id" IN (SELECT aeou."alertEpisodeId" FROM "AlertEpisodeOwnerUser" aeou WHERE aeou."userId" = :${uidRid} AND aeou."deletedAt" IS NULL) OR ` +
        `"AlertEpisode"."_id" IN (SELECT aeot."alertEpisodeId" FROM "AlertEpisodeOwnerTeam" aeot INNER JOIN "TeamMember" tm ON tm."teamId" = aeot."teamId" WHERE tm."userId" = :${uidRid} AND tm."deletedAt" IS NULL AND aeot."deletedAt" IS NULL))`
      );
    },
    {
      [uidRid]: props.userId.toString(),
    },
  );
}

export function getAlertEpisodeRelatedRecordPrivacyRaw(
  props: DatabaseCommonInteractionProps,
): FindWhereProperty<any> | undefined {
  if (shouldBypassAlertEpisodePrivacy(props)) {
    return undefined;
  }

  if (!props.userId) {
    return Raw((alias: string): string => {
      return `(${alias} IN (SELECT ae."_id" FROM "AlertEpisode" ae WHERE ae."deletedAt" IS NULL AND (ae."isPrivate" IS NULL OR ae."isPrivate" = FALSE)))`;
    });
  }

  const uidRid: string = "uidAEpiRel_" + Text.generateRandomText(10);

  return Raw(
    (alias: string): string => {
      return (
        `(${alias} IN (SELECT ae."_id" FROM "AlertEpisode" ae WHERE ae."deletedAt" IS NULL AND (` +
        `ae."isPrivate" IS NULL OR ae."isPrivate" = FALSE OR ` +
        `ae."_id" IN (SELECT aeou."alertEpisodeId" FROM "AlertEpisodeOwnerUser" aeou WHERE aeou."userId" = :${uidRid} AND aeou."deletedAt" IS NULL) OR ` +
        `ae."_id" IN (SELECT aeot."alertEpisodeId" FROM "AlertEpisodeOwnerTeam" aeot INNER JOIN "TeamMember" tm ON tm."teamId" = aeot."teamId" WHERE tm."userId" = :${uidRid} AND tm."deletedAt" IS NULL AND aeot."deletedAt" IS NULL))))`
      );
    },
    {
      [uidRid]: props.userId.toString(),
    },
  );
}

export function applyAlertEpisodeSelfPrivacyFilter<T>(
  query: T,
  props: DatabaseCommonInteractionProps,
): T {
  const rawClause: FindWhereProperty<any> | undefined =
    getAlertEpisodeSelfPrivacyRaw(props);

  if (!rawClause) {
    return query;
  }

  if (!query) {
    return { isPrivate: rawClause } as unknown as T;
  }

  (query as any).isPrivate = combineWithPrivacyClause(
    (query as any).isPrivate,
    rawClause,
  );
  return query;
}

export function applyAlertEpisodeRelatedRecordPrivacyFilter<T>(
  query: T,
  props: DatabaseCommonInteractionProps,
): T {
  const rawClause: FindWhereProperty<any> | undefined =
    getAlertEpisodeRelatedRecordPrivacyRaw(props);

  if (!rawClause) {
    return query;
  }

  if (!query) {
    return { alertEpisodeId: rawClause } as unknown as T;
  }

  (query as any).alertEpisodeId = combineWithPrivacyClause(
    (query as any).alertEpisodeId,
    rawClause,
  );
  return query;
}
