import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import AccessTokenService from "../../Services/AccessTokenService";
import CustomRolePermissionService from "../../Services/CustomRolePermissionService";
import TeamCustomRoleService from "../../Services/TeamCustomRoleService";
import TeamMemberService from "../../Services/TeamMemberService";
import TeamPermissionService from "../../Services/TeamPermissionService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import CustomRolePermission from "../../../Models/DatabaseModels/CustomRolePermission";
import Label from "../../../Models/DatabaseModels/Label";
import TeamCustomRole from "../../../Models/DatabaseModels/TeamCustomRole";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import {
  planRoleCopies,
  RoleCopyPlan,
  RoleGivenToTeam,
  RolePermissionRow,
  TeamPermissionCopyRow,
  TeamPermissionCopyToCreate,
} from "../../../Types/Team/CustomRoleCopyPlan";

/*
 * KEEPS EVERY TEAM GIVEN A CUSTOM ROLE HOLDING EXACTLY WHAT THE ROLE HOLDS.
 *
 * A team given a role holds a copy of each of the role's permissions as an
 * ordinary team permission row (Types/Team/CustomRoleCopyPlan). Whenever a
 * role is given to a team, a permission is added to a role or changed in
 * it, the copies are brought to what the roles hold here, and the cached
 * permissions of every member of each team whose rows changed are rebuilt
 * at once (AccessTokenService), which tells their open pages too.
 *
 * Taking something away needs no sync: a copy goes with what it copies -
 * the role given to the team, the role's permission, the role itself - in
 * the same DELETE (ON DELETE CASCADE), and the services that delete those
 * refresh the members after (refreshMembersOfTeams).
 *
 * Every sync reads the roles, the teams given them and the copies afresh,
 * deletes what no longer matches before it creates what is missing, and
 * runs one at a time in a project (a lock in Valkey), so two changes made
 * at once - a permission added to a role while the role is given to a team
 * - end with the copies both of them call for, and a sync never passes
 * through a moment where a team holds more than its roles give. It writes
 * the copies as OneUptime (root, no hooks): no request may write them
 * (TeamPermission's columns for them are closed to every write), and the
 * checks were made on the change that called for them.
 */

// How long a sync may keep the project's lock, and wait for it.
const LOCK_TIMEOUT_IN_MS: number = 60 * 1000;
const LOCK_ACQUIRE_TIMEOUT_IN_MS: number = 30 * 1000;

const idText: (id: ObjectID | string | undefined | null) => string = (
  id: ObjectID | string | undefined | null,
): string => {
  return id ? id.toString() : "";
};

const uniqueIds: (ids: Array<ObjectID | string>) => Array<ObjectID> = (
  ids: Array<ObjectID | string>,
): Array<ObjectID> => {
  const seen: Map<string, ObjectID> = new Map<string, ObjectID>();

  for (const id of ids) {
    const text: string = idText(id).toLowerCase();

    if (text && !seen.has(text)) {
      seen.set(text, typeof id === "string" ? new ObjectID(id) : id);
    }
  }

  return Array.from(seen.values());
};

const labelIdsOf: (labels: Array<Label> | undefined) => Array<string> = (
  labels: Array<Label> | undefined,
): Array<string> => {
  return (labels || [])
    .map((label: Label): string => {
      return idText(label.id);
    })
    .filter((id: string): boolean => {
      return Boolean(id);
    });
};

const labelsOf: (labelIds: Array<string>) => Array<Label> = (
  labelIds: Array<string>,
): Array<Label> => {
  return labelIds.map((labelId: string): Label => {
    const label: Label = new Label();
    label.id = new ObjectID(labelId);
    return label;
  });
};

export default class CustomRoleSync {
  public static readonly LOCK_NAMESPACE: string = "CustomRoleSync";

  /*
   * Brings the copies of these roles' permissions, on every team given one
   * of them, to what the roles hold now, then rebuilds the cached
   * permissions of every member of each team whose rows changed. The teams
   * whose rows changed.
   */
  @CaptureSpan()
  public static async syncRoles(data: {
    projectId: ObjectID;
    customRoleIds: Array<ObjectID>;
  }): Promise<Array<ObjectID>> {
    const customRoleIds: Array<ObjectID> = uniqueIds(data.customRoleIds);

    if (customRoleIds.length === 0) {
      return [];
    }

    const changedTeamIds: Array<ObjectID> = await this.inProjectLock(
      data.projectId,
      async (): Promise<Array<ObjectID>> => {
        return await this.reconcile({
          projectId: data.projectId,
          customRoleIds: customRoleIds,
        });
      },
    );

    await this.refreshMembersOfTeams({
      projectId: data.projectId,
      teamIds: changedTeamIds,
    });

    return changedTeamIds;
  }

  /*
   * The sync itself, without the lock or the refresh: read the roles given
   * to teams, the roles' permissions and the copies, then delete what no
   * longer matches and create what is missing (planRoleCopies). The teams
   * whose rows changed.
   */
  @CaptureSpan()
  public static async reconcile(data: {
    projectId: ObjectID;
    customRoleIds: Array<ObjectID>;
  }): Promise<Array<ObjectID>> {
    const customRoleIds: Array<ObjectID> = uniqueIds(data.customRoleIds);

    if (customRoleIds.length === 0) {
      return [];
    }

    const givenToTeams: Array<TeamCustomRole> =
      await TeamCustomRoleService.findAllBy({
        query: {
          projectId: data.projectId,
          customRoleId: QueryHelper.any(customRoleIds),
        },
        select: {
          _id: true,
          teamId: true,
          customRoleId: true,
        },
        props: {
          isRoot: true,
        },
      });

    const rolePermissions: Array<CustomRolePermission> =
      await CustomRolePermissionService.findAllBy({
        query: {
          projectId: data.projectId,
          customRoleId: QueryHelper.any(customRoleIds),
        },
        select: {
          _id: true,
          customRoleId: true,
          permission: true,
          scope: true,
          labels: {
            _id: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

    const copies: Array<TeamPermission> = await TeamPermissionService.findAllBy(
      {
        query: {
          projectId: data.projectId,
          customRoleId: QueryHelper.any(customRoleIds),
        },
        select: {
          _id: true,
          teamId: true,
          customRoleId: true,
          teamCustomRoleId: true,
          customRolePermissionId: true,
          permission: true,
          scope: true,
          isBlockPermission: true,
          labels: {
            _id: true,
          },
        },
        props: {
          isRoot: true,
        },
      },
    );

    const plan: RoleCopyPlan = planRoleCopies({
      rolesGivenToTeams: givenToTeams.map(
        (given: TeamCustomRole): RoleGivenToTeam => {
          return {
            id: idText(given.id),
            teamId: idText(given.teamId),
            customRoleId: idText(given.customRoleId),
          };
        },
      ),
      rolePermissions: rolePermissions.map(
        (row: CustomRolePermission): RolePermissionRow => {
          return {
            id: idText(row.id),
            customRoleId: idText(row.customRoleId),
            permission: row.permission!,
            scope: row.scope,
            labelIds: labelIdsOf(row.labels),
          };
        },
      ),
      copies: copies.map((copy: TeamPermission): TeamPermissionCopyRow => {
        return {
          id: idText(copy.id),
          teamId: idText(copy.teamId),
          customRoleId: idText(copy.customRoleId) || null,
          teamCustomRoleId: idText(copy.teamCustomRoleId) || null,
          customRolePermissionId: idText(copy.customRolePermissionId) || null,
          permission: copy.permission!,
          scope: copy.scope,
          labelIds: labelIdsOf(copy.labels),
          isBlockPermission: copy.isBlockPermission,
        };
      }),
    });

    // What no longer matches goes first: a team never holds more than its roles give.
    await this.deleteCopies({
      projectId: data.projectId,
      ids: plan.toDelete,
    });

    for (const copy of plan.toCreate) {
      await this.createCopy({
        projectId: data.projectId,
        copy: copy,
      });
    }

    return uniqueIds(plan.changedTeamIds);
  }

  /*
   * Deletes the copies of these permissions of a role from every team, now:
   * a change to them is about to be written (CustomRolePermissionService
   * .onUpdatePermitted), and a team must never hold the old one while the
   * role holds the new. The sync that follows the change creates the new
   * copies. The teams whose rows were deleted, for their members' refresh.
   */
  @CaptureSpan()
  public static async removeCopiesOfRolePermissions(data: {
    projectId: ObjectID;
    customRolePermissionIds: Array<ObjectID>;
  }): Promise<Array<ObjectID>> {
    const ids: Array<ObjectID> = uniqueIds(data.customRolePermissionIds);

    if (ids.length === 0) {
      return [];
    }

    const copies: Array<TeamPermission> = await TeamPermissionService.findAllBy(
      {
        query: {
          projectId: data.projectId,
          customRolePermissionId: QueryHelper.any(ids),
        },
        select: {
          _id: true,
          teamId: true,
        },
        props: {
          isRoot: true,
        },
      },
    );

    await this.deleteCopies({
      projectId: data.projectId,
      ids: copies.map((copy: TeamPermission): string => {
        return idText(copy.id);
      }),
    });

    return uniqueIds(
      copies.map((copy: TeamPermission): string => {
        return idText(copy.teamId);
      }),
    );
  }

  // The teams these roles are given to, in the project.
  @CaptureSpan()
  public static async getTeamIdsGivenRoles(data: {
    projectId: ObjectID;
    customRoleIds: Array<ObjectID>;
  }): Promise<Array<ObjectID>> {
    const customRoleIds: Array<ObjectID> = uniqueIds(data.customRoleIds);

    if (customRoleIds.length === 0) {
      return [];
    }

    const givenToTeams: Array<TeamCustomRole> =
      await TeamCustomRoleService.findAllBy({
        query: {
          projectId: data.projectId,
          customRoleId: QueryHelper.any(customRoleIds),
        },
        select: {
          teamId: true,
        },
        props: {
          isRoot: true,
        },
      });

    return uniqueIds(
      givenToTeams.map((given: TeamCustomRole): string => {
        return idText(given.teamId);
      }),
    );
  }

  /*
   * The people whose permissions come from these teams: their accepted
   * members, each once. Someone invited who has not accepted holds no
   * permission of the project yet.
   */
  @CaptureSpan()
  public static async getMemberIdsOfTeams(data: {
    projectId: ObjectID;
    teamIds: Array<ObjectID>;
  }): Promise<Array<ObjectID>> {
    const teamIds: Array<ObjectID> = uniqueIds(data.teamIds);

    if (teamIds.length === 0) {
      return [];
    }

    const members: Array<TeamMember> = await TeamMemberService.findAllBy({
      query: {
        projectId: data.projectId,
        teamId: QueryHelper.any(teamIds),
        hasAcceptedInvitation: true,
      },
      select: {
        userId: true,
      },
      props: {
        isRoot: true,
      },
    });

    return uniqueIds(
      members
        .map((member: TeamMember): string => {
          return idText(member.userId);
        })
        .filter((id: string): boolean => {
          return Boolean(id);
        }),
    );
  }

  /*
   * Rebuilds, at once, the cached permissions in the project of everyone on
   * these teams, and tells their open pages (AccessTokenService). A refresh
   * that fails drops what is cached instead, so the next request rebuilds
   * it from the teams: nobody keeps a permission a change took away.
   */
  @CaptureSpan()
  public static async refreshMembersOfTeams(data: {
    projectId: ObjectID;
    teamIds: Array<ObjectID>;
  }): Promise<void> {
    const memberIds: Array<ObjectID> = await this.getMemberIdsOfTeams(data);

    for (const userId of memberIds) {
      try {
        await AccessTokenService.refreshUserTenantAccessPermission(
          userId,
          data.projectId,
        );
      } catch (err) {
        logger.error(err, {
          projectId: data.projectId.toString(),
          userId: userId.toString(),
        } as LogAttributes);

        await AccessTokenService.clearCachedPermissions(userId, data.projectId);
      }
    }
  }

  private static async deleteCopies(data: {
    projectId: ObjectID;
    ids: Array<string>;
  }): Promise<void> {
    for (let start: number = 0; start < data.ids.length; start += LIMIT_MAX) {
      const ids: Array<string> = data.ids.slice(start, start + LIMIT_MAX);

      await TeamPermissionService.deleteBy({
        query: {
          projectId: data.projectId,
          _id: QueryHelper.any(ids),
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
    }
  }

  private static async createCopy(data: {
    projectId: ObjectID;
    copy: TeamPermissionCopyToCreate;
  }): Promise<void> {
    const row: TeamPermission = new TeamPermission();
    row.projectId = data.projectId;
    row.teamId = new ObjectID(data.copy.teamId);
    row.permission = data.copy.permission;
    row.scope = data.copy.scope;
    row.isBlockPermission = false;
    row.labels = labelsOf(data.copy.labelIds);
    row.customRoleId = new ObjectID(data.copy.customRoleId);
    row.teamCustomRoleId = new ObjectID(data.copy.teamCustomRoleId);
    row.customRolePermissionId = new ObjectID(data.copy.customRolePermissionId);

    await TeamPermissionService.create({
      data: row,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });
  }

  /*
   * Runs `work` while holding the project's sync lock, so the syncs of a
   * project run one at a time. When Valkey cannot give the lock in time,
   * the sync runs anyway: it reads everything afresh, so it is right on its
   * own, and refusing the change that called for it would leave its teams
   * further from their roles.
   */
  private static async inProjectLock<T>(
    projectId: ObjectID,
    work: () => Promise<T>,
  ): Promise<T> {
    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: projectId.toString(),
        namespace: this.LOCK_NAMESPACE,
        lockTimeout: LOCK_TIMEOUT_IN_MS,
        acquireTimeout: LOCK_ACQUIRE_TIMEOUT_IN_MS,
      });
    } catch (err) {
      logger.error(err, {
        projectId: projectId.toString(),
      } as LogAttributes);
    }

    try {
      return await work();
    } finally {
      if (mutex) {
        try {
          await Semaphore.release(mutex);
        } catch (err) {
          logger.error(err, {
            projectId: projectId.toString(),
          } as LogAttributes);
        }
      }
    }
  }
}
