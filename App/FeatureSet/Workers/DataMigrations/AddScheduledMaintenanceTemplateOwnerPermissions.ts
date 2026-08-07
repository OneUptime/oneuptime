import DataMigrationBase from "./DataMigrationBase";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import Permission from "Common/Types/Permission";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import ObjectID from "Common/Types/ObjectID";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import ApiKeyPermissionService from "Common/Server/Services/ApiKeyPermissionService";
import TeamPermissionService from "Common/Server/Services/TeamPermissionService";
import APIKeyPermission from "Common/Models/DatabaseModels/ApiKeyPermission";
import TeamPermission from "Common/Models/DatabaseModels/TeamPermission";
import Label from "Common/Models/DatabaseModels/Label";
import logger from "Common/Server/Utils/Logger";

/*
 * Backfill for the ScheduledMaintenanceTemplate owner permission fix.
 *
 * Permission.CreateScheduledMaintenanceTemplateOwnerUser and
 * ...OwnerTeam shipped carrying the string values of their NON-template
 * counterparts, so the two capabilities were a single permission wearing two
 * names. Those two enum values are now distinct. Permission values are stored
 * as plain varchar in TeamPermission.permission and ApiKeyPermission.permission,
 * so nothing in any database contains the new strings — without this migration
 * every existing grant silently stops covering the template owner tables, and
 * every existing *block* silently stops denying them.
 *
 * The rule is COPY, NEVER RENAME. The old strings still legitimately mean the
 * non-template permission, so rewriting them in place would revoke access that
 * is genuinely held.
 *
 * Which rows get a sibling, and why:
 *
 *   Block rows (isBlockPermission = true) — copied 1:1 for BOTH families.
 *   Block enforcement is table-level only (TablePermission
 *   .checkTableLevelBlockPermissions); a block on the old string currently
 *   intersects the template model's createRecordPermissions and denies. Not
 *   copying it would turn a deliberate denial into silent access. Blocking
 *   more than before is the fail-safe direction.
 *
 *   Allow rows, Team family — copied 1:1. ScheduledMaintenanceTemplateOwnerTeam
 *   gates every one of its columns on the old Team string alone, so holding it
 *   was necessary and sufficient. The new string reproduces exactly that.
 *
 *   Allow rows, User family — copied ONLY when the same grantee also holds the
 *   old Team allow. Creating a ScheduledMaintenanceTemplateOwnerUser row needed
 *   the old User string for the table gate AND the old Team string for the
 *   required, non-nullable scheduledMaintenanceTemplateId column (that column
 *   was mis-keyed to the Team permission, fixed in the same change). A blanket
 *   copy would hand template-owner-user creation to principals who cannot do it
 *   today, which is a widening this migration must not perform.
 *
 * Idempotent: every insert is guarded by an existence check on
 * (grantee, permission, isBlockPermission), and the migration runner is not
 * serialized across processes.
 *
 * Writes go through the services rather than raw SQL so
 * TeamPermissionService.onCreateSuccess refreshes each affected member's cached
 * permissions. The cache is Redis-backed with a 30-day TTL and is only
 * re-derived on a miss, so a raw-SQL backfill would leave users stale for up to
 * a month — during which the block-path regression above would be live.
 */

const OLD_USER: Permission = Permission.CreateScheduledMaintenanceOwnerUser;
const OLD_TEAM: Permission = Permission.CreateScheduledMaintenanceOwnerTeam;
const NEW_USER: Permission =
  Permission.CreateScheduledMaintenanceTemplateOwnerUser;
const NEW_TEAM: Permission =
  Permission.CreateScheduledMaintenanceTemplateOwnerTeam;

/*
 * Key a grant by its grantee and allow/block list, so the two families can be
 * matched up per team (or per API key) rather than across the whole project.
 */
function groupKey(granteeId: ObjectID, isBlock: boolean): string {
  return `${granteeId.toString()}:${isBlock ? "block" : "allow"}`;
}

export default class AddScheduledMaintenanceTemplateOwnerPermissions extends DataMigrationBase {
  public constructor() {
    super("AddScheduledMaintenanceTemplateOwnerPermissions");
  }

  public override async migrate(): Promise<void> {
    await this.backfillTeamPermissions();
    await this.backfillApiKeyPermissions();
  }

  private async backfillTeamPermissions(): Promise<void> {
    const rows: Array<TeamPermission> = await TeamPermissionService.findBy({
      query: {
        permission: QueryHelper.any([OLD_USER, OLD_TEAM]),
      },
      select: {
        _id: true,
        teamId: true,
        projectId: true,
        permission: true,
        isBlockPermission: true,
        scope: true,
        labels: {
          _id: true,
        },
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    // Which (team, list) pairs hold the old Team grant — the User copy needs it.
    const hasOldTeam: Set<string> = new Set<string>();
    for (const row of rows) {
      if (row.teamId && row.permission === OLD_TEAM) {
        hasOldTeam.add(groupKey(row.teamId, Boolean(row.isBlockPermission)));
      }
    }

    for (const row of rows) {
      if (!row.teamId || !row.projectId || !row.permission) {
        continue;
      }

      const isBlock: boolean = Boolean(row.isBlockPermission);
      const newPermission: Permission =
        row.permission === OLD_TEAM ? NEW_TEAM : NEW_USER;

      if (
        newPermission === NEW_USER &&
        !isBlock &&
        !hasOldTeam.has(groupKey(row.teamId, false))
      ) {
        /*
         * Allow-side User grant without the companion Team grant: this team
         * cannot create template owner-user rows today, so granting the new
         * permission would widen their access.
         */
        continue;
      }

      const existing: TeamPermission | null =
        await TeamPermissionService.findOneBy({
          query: {
            teamId: row.teamId,
            permission: newPermission,
            isBlockPermission: isBlock,
          },
          select: { _id: true },
          props: { isRoot: true },
        });

      if (existing) {
        continue;
      }

      const copy: TeamPermission = new TeamPermission();
      copy.teamId = row.teamId;
      copy.projectId = row.projectId;
      copy.permission = newPermission;
      copy.isBlockPermission = isBlock;
      copy.scope = row.scope || PermissionScope.All;
      copy.labels = (row.labels || []).map((label: Label) => {
        return label;
      });

      try {
        await TeamPermissionService.create({
          data: copy,
          props: { isRoot: true },
        });
      } catch (err) {
        /*
         * A locked team (isPermissionsEditable false) rejects new permissions.
         * Those teams hold ProjectOwner / ProjectAdmin rather than these
         * granular grants so they should never match, but a throw here would
         * halt every migration queued after this one — log and continue.
         */
        logger.error(
          `AddScheduledMaintenanceTemplateOwnerPermissions: could not copy ${newPermission} for team ${row.teamId.toString()}`,
        );
        logger.error(err);
      }
    }
  }

  private async backfillApiKeyPermissions(): Promise<void> {
    const rows: Array<APIKeyPermission> = await ApiKeyPermissionService.findBy({
      query: {
        permission: QueryHelper.any([OLD_USER, OLD_TEAM]),
      },
      select: {
        _id: true,
        apiKeyId: true,
        projectId: true,
        permission: true,
        isBlockPermission: true,
        labels: {
          _id: true,
        },
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    const hasOldTeam: Set<string> = new Set<string>();
    for (const row of rows) {
      if (row.apiKeyId && row.permission === OLD_TEAM) {
        hasOldTeam.add(groupKey(row.apiKeyId, Boolean(row.isBlockPermission)));
      }
    }

    for (const row of rows) {
      if (!row.apiKeyId || !row.projectId || !row.permission) {
        continue;
      }

      const isBlock: boolean = Boolean(row.isBlockPermission);
      const newPermission: Permission =
        row.permission === OLD_TEAM ? NEW_TEAM : NEW_USER;

      if (
        newPermission === NEW_USER &&
        !isBlock &&
        !hasOldTeam.has(groupKey(row.apiKeyId, false))
      ) {
        continue;
      }

      const existing: APIKeyPermission | null =
        await ApiKeyPermissionService.findOneBy({
          query: {
            apiKeyId: row.apiKeyId,
            permission: newPermission,
            isBlockPermission: isBlock,
          },
          select: { _id: true },
          props: { isRoot: true },
        });

      if (existing) {
        continue;
      }

      const copy: APIKeyPermission = new APIKeyPermission();
      copy.apiKeyId = row.apiKeyId;
      copy.projectId = row.projectId;
      copy.permission = newPermission;
      copy.isBlockPermission = isBlock;
      copy.labels = (row.labels || []).map((label: Label) => {
        return label;
      });

      try {
        await ApiKeyPermissionService.create({
          data: copy,
          props: { isRoot: true },
        });
      } catch (err) {
        logger.error(
          `AddScheduledMaintenanceTemplateOwnerPermissions: could not copy ${newPermission} for API key ${row.apiKeyId.toString()}`,
        );
        logger.error(err);
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
