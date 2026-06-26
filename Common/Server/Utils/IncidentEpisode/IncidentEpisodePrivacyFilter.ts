import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { FindWhereProperty } from "../../../Types/BaseDatabase/Query";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import Text from "../../../Types/Text";
import { combineWithPrivacyClause } from "../PrivacyFilterUtil";
import { Raw } from "typeorm";

/*
 * Project owners and admins, plus root/master-admin contexts, see all
 * private incident episodes. Other users only see private episodes they
 * own (directly via IncidentEpisodeOwnerUser, or transitively through
 * IncidentEpisodeOwnerTeam + TeamMember).
 */
export function shouldBypassIncidentEpisodePrivacy(
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

export function getIncidentEpisodeSelfPrivacyRaw(
  props: DatabaseCommonInteractionProps,
): FindWhereProperty<any> | undefined {
  if (shouldBypassIncidentEpisodePrivacy(props)) {
    return undefined;
  }

  if (!props.userId) {
    return Raw((alias: string): string => {
      return `(${alias} IS NULL OR ${alias} = FALSE)`;
    });
  }

  const uidRid: string = "uidEpiPriv_" + Text.generateRandomText(10);

  return Raw(
    (alias: string): string => {
      return (
        `(${alias} IS NULL OR ${alias} = FALSE OR ` +
        `"IncidentEpisode"."_id" IN (SELECT ieou."incidentEpisodeId" FROM "IncidentEpisodeOwnerUser" ieou WHERE ieou."userId" = :${uidRid} AND ieou."deletedAt" IS NULL) OR ` +
        `"IncidentEpisode"."_id" IN (SELECT ieot."incidentEpisodeId" FROM "IncidentEpisodeOwnerTeam" ieot INNER JOIN "TeamMember" tm ON tm."teamId" = ieot."teamId" WHERE tm."userId" = :${uidRid} AND tm."deletedAt" IS NULL AND ieot."deletedAt" IS NULL))`
      );
    },
    {
      [uidRid]: props.userId.toString(),
    },
  );
}

export function getIncidentEpisodeRelatedRecordPrivacyRaw(
  props: DatabaseCommonInteractionProps,
): FindWhereProperty<any> | undefined {
  if (shouldBypassIncidentEpisodePrivacy(props)) {
    return undefined;
  }

  if (!props.userId) {
    return Raw((alias: string): string => {
      return `(${alias} IN (SELECT ie."_id" FROM "IncidentEpisode" ie WHERE ie."deletedAt" IS NULL AND (ie."isPrivate" IS NULL OR ie."isPrivate" = FALSE)))`;
    });
  }

  const uidRid: string = "uidEpiRel_" + Text.generateRandomText(10);

  return Raw(
    (alias: string): string => {
      return (
        `(${alias} IN (SELECT ie."_id" FROM "IncidentEpisode" ie WHERE ie."deletedAt" IS NULL AND (` +
        `ie."isPrivate" IS NULL OR ie."isPrivate" = FALSE OR ` +
        `ie."_id" IN (SELECT ieou."incidentEpisodeId" FROM "IncidentEpisodeOwnerUser" ieou WHERE ieou."userId" = :${uidRid} AND ieou."deletedAt" IS NULL) OR ` +
        `ie."_id" IN (SELECT ieot."incidentEpisodeId" FROM "IncidentEpisodeOwnerTeam" ieot INNER JOIN "TeamMember" tm ON tm."teamId" = ieot."teamId" WHERE tm."userId" = :${uidRid} AND tm."deletedAt" IS NULL AND ieot."deletedAt" IS NULL))))`
      );
    },
    {
      [uidRid]: props.userId.toString(),
    },
  );
}

export function applyIncidentEpisodeSelfPrivacyFilter<T>(
  query: T,
  props: DatabaseCommonInteractionProps,
): T {
  const rawClause: FindWhereProperty<any> | undefined =
    getIncidentEpisodeSelfPrivacyRaw(props);

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

export function applyIncidentEpisodeRelatedRecordPrivacyFilter<T>(
  query: T,
  props: DatabaseCommonInteractionProps,
): T {
  const rawClause: FindWhereProperty<any> | undefined =
    getIncidentEpisodeRelatedRecordPrivacyRaw(props);

  if (!rawClause) {
    return query;
  }

  if (!query) {
    return { incidentEpisodeId: rawClause } as unknown as T;
  }

  (query as any).incidentEpisodeId = combineWithPrivacyClause(
    (query as any).incidentEpisodeId,
    rawClause,
  );
  return query;
}
