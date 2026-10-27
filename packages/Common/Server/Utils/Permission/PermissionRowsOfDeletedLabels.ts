import ApiKeyPermissionService from "../../Services/ApiKeyPermissionService";
import CustomRolePermissionService from "../../Services/CustomRolePermissionService";
import TeamPermissionService from "../../Services/TeamPermissionService";
import QueryHelper from "../../Types/Database/QueryHelper";
import CustomRoleSync from "../CustomRole/CustomRoleSync";
import CaptureSpan from "../Telemetry/CaptureSpan";
import ApiKeyPermission from "../../../Models/DatabaseModels/ApiKeyPermission";
import CustomRolePermission from "../../../Models/DatabaseModels/CustomRolePermission";
import Label from "../../../Models/DatabaseModels/Label";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";

/*
 * A PERMISSION LIMITED TO LABELS THAT ARE DELETED GOES WITH THEM.
 *
 * A team's permission, an API key's permission and a custom role's
 * permission are limited to labels through join rows the database deletes
 * with the label (ON DELETE CASCADE). A row whose every label is deleted
 * would be left with none - and a row with no labels reaches the whole
 * project (PermissionHelper.isLimitedToLabels): a member limited to one
 * customer's incidents who may delete labels could delete that customer's
 * label and read every incident, and an admin tidying up labels would
 * widen permissions without knowing.
 *
 * Such a row reaches nothing once its labels are gone - no record carries
 * a deleted label - and a block limited to them takes nothing away. So it
 * is removed before the labels are (LabelService.onBeforeDelete), which
 * leaves what everyone may do exactly as it was:
 *
 *   - a custom role's permission through its own service, which removes
 *     every team's and key's copy of it with it (CustomRoleSync) and
 *     refreshes the people and keys holding them;
 *   - a team's own permission and a key's own permission directly, as
 *     OneUptime: the label decides, not the person deleting it, whose
 *     permission to delete the label is what was checked. The people on the
 *     team are refreshed, and every server forgets the keys' permissions.
 *
 * A row that keeps one of its labels keeps that label's limit and is left
 * as it is. A removal that fails refuses the label's delete, so a label is
 * never deleted while a permission limited to it alone stays behind.
 */

// A row limited to labels, and whether it is a copy of a custom role's.
interface LabelledRow {
  id: ObjectID;
  projectId: ObjectID;
  labelIds: Array<string>;
  isRoleCopy: boolean;
  teamId?: ObjectID | undefined;
}

// The rows a delete of labels leaves without any.
export interface RowsLimitedOnlyTo {
  teamPermissions: Array<LabelledRow>;
  apiKeyPermissions: Array<LabelledRow>;
  customRolePermissions: Array<LabelledRow>;
}

const idText: (id: ObjectID | string | undefined | null) => string = (
  id: ObjectID | string | undefined | null,
): string => {
  return id ? id.toString().toLowerCase() : "";
};

const labelIdsOf: (labels: Array<Label> | undefined) => Array<string> = (
  labels: Array<Label> | undefined,
): Array<string> => {
  return (labels || [])
    .map((label: Label): string => {
      return idText(label.id || label._id);
    })
    .filter((labelId: string): boolean => {
      return Boolean(labelId);
    });
};

export default class PermissionRowsOfDeletedLabels {
  /*
   * The permission rows that carry only labels of `labelIds`: every label
   * they carry is one of them. A copy of a custom role's permission is the
   * role's, and goes with the role's own row.
   */
  @CaptureSpan()
  public static async findRowsLimitedOnlyTo(data: {
    labelIds: Array<ObjectID>;
  }): Promise<RowsLimitedOnlyTo> {
    const deleted: Set<string> = new Set<string>(
      data.labelIds.map((labelId: ObjectID): string => {
        return idText(labelId);
      }),
    );

    if (deleted.size === 0) {
      return {
        teamPermissions: [],
        apiKeyPermissions: [],
        customRolePermissions: [],
      };
    }

    const isLimitedOnlyToDeleted: (row: LabelledRow) => boolean = (
      row: LabelledRow,
    ): boolean => {
      return (
        row.labelIds.length > 0 &&
        row.labelIds.every((labelId: string): boolean => {
          return deleted.has(labelId);
        })
      );
    };

    const [teamPermissions, apiKeyPermissions, customRolePermissions]: [
      Array<LabelledRow>,
      Array<LabelledRow>,
      Array<LabelledRow>,
    ] = await Promise.all([
      PermissionRowsOfDeletedLabels.findTeamPermissions(data.labelIds),
      PermissionRowsOfDeletedLabels.findApiKeyPermissions(data.labelIds),
      PermissionRowsOfDeletedLabels.findCustomRolePermissions(data.labelIds),
    ]);

    return {
      teamPermissions: teamPermissions.filter((row: LabelledRow): boolean => {
        return !row.isRoleCopy && isLimitedOnlyToDeleted(row);
      }),
      apiKeyPermissions: apiKeyPermissions.filter(
        (row: LabelledRow): boolean => {
          return !row.isRoleCopy && isLimitedOnlyToDeleted(row);
        },
      ),
      customRolePermissions: customRolePermissions.filter(
        isLimitedOnlyToDeleted,
      ),
    };
  }

  /*
   * Removes the permission rows that carry only labels of `labelIds`, and
   * refreshes whoever held them. See the class comment.
   */
  @CaptureSpan()
  public static async removeRowsLimitedOnlyTo(data: {
    labelIds: Array<ObjectID>;
  }): Promise<RowsLimitedOnlyTo> {
    const rows: RowsLimitedOnlyTo =
      await PermissionRowsOfDeletedLabels.findRowsLimitedOnlyTo(data);

    // A role's permission, with its copies, through the role's own service.
    for (const projectRows of PermissionRowsOfDeletedLabels.byProject(
      rows.customRolePermissions,
    )) {
      await CustomRolePermissionService.deleteBy({
        query: {
          _id: QueryHelper.any(
            projectRows.map((row: LabelledRow): ObjectID => {
              return row.id;
            }),
          ),
          projectId: projectRows[0]!.projectId,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });
    }

    for (const projectRows of PermissionRowsOfDeletedLabels.byProject(
      rows.teamPermissions,
    )) {
      const projectId: ObjectID = projectRows[0]!.projectId;

      await TeamPermissionService.deleteBy({
        query: {
          _id: QueryHelper.any(
            projectRows.map((row: LabelledRow): ObjectID => {
              return row.id;
            }),
          ),
          projectId: projectId,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

      // Each team once, its members' permissions rebuilt.
      const teamIds: Map<string, ObjectID> = new Map<string, ObjectID>();

      for (const row of projectRows) {
        if (row.teamId) {
          teamIds.set(idText(row.teamId), row.teamId);
        }
      }

      await CustomRoleSync.refreshMembersOfTeams({
        projectId: projectId,
        teamIds: Array.from(teamIds.values()),
      });
    }

    const apiKeyProjects: Array<Array<LabelledRow>> =
      PermissionRowsOfDeletedLabels.byProject(rows.apiKeyPermissions);

    for (const projectRows of apiKeyProjects) {
      await ApiKeyPermissionService.deleteBy({
        query: {
          _id: QueryHelper.any(
            projectRows.map((row: LabelledRow): ObjectID => {
              return row.id;
            }),
          ),
          projectId: projectRows[0]!.projectId,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
    }

    if (apiKeyProjects.length > 0) {
      await ApiKeyPermissionService.forgetPermissionsOfProjects(
        apiKeyProjects.map((projectRows: Array<LabelledRow>): ObjectID => {
          return projectRows[0]!.projectId;
        }),
      );
    }

    return rows;
  }

  // Rows grouped by their project, each group in the order the rows came.
  private static byProject(
    rows: Array<LabelledRow>,
  ): Array<Array<LabelledRow>> {
    const groups: Map<string, Array<LabelledRow>> = new Map<
      string,
      Array<LabelledRow>
    >();

    for (const row of rows) {
      const key: string = idText(row.projectId);
      const group: Array<LabelledRow> = groups.get(key) || [];
      group.push(row);
      groups.set(key, group);
    }

    return Array.from(groups.values());
  }

  /*
   * The ids of the rows that name one of the labels. Their labels are read
   * again by those ids alone (readTeamPermissions and the like): a relation
   * filter trims the labels it returns to the ones it matched.
   */
  private static async findTeamPermissions(
    labelIds: Array<ObjectID>,
  ): Promise<Array<LabelledRow>> {
    const matched: Array<TeamPermission> = await TeamPermissionService.findBy({
      query: { labels: labelIds },
      select: { _id: true },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    if (matched.length === 0) {
      return [];
    }

    const rows: Array<TeamPermission> = await TeamPermissionService.findBy({
      query: {
        _id: QueryHelper.any(
          matched.map((row: TeamPermission): ObjectID => {
            return row.id!;
          }),
        ),
      },
      select: {
        _id: true,
        projectId: true,
        teamId: true,
        teamCustomRoleId: true,
        customRolePermissionId: true,
        labels: { _id: true },
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    return rows.map((row: TeamPermission): LabelledRow => {
      return {
        id: row.id!,
        projectId: row.projectId!,
        teamId: row.teamId,
        labelIds: labelIdsOf(row.labels),
        isRoleCopy: Boolean(row.teamCustomRoleId || row.customRolePermissionId),
      };
    });
  }

  private static async findApiKeyPermissions(
    labelIds: Array<ObjectID>,
  ): Promise<Array<LabelledRow>> {
    const matched: Array<ApiKeyPermission> =
      await ApiKeyPermissionService.findBy({
        query: { labels: labelIds },
        select: { _id: true },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

    if (matched.length === 0) {
      return [];
    }

    const rows: Array<ApiKeyPermission> = await ApiKeyPermissionService.findBy(
      {
        query: {
          _id: QueryHelper.any(
            matched.map((row: ApiKeyPermission): ObjectID => {
              return row.id!;
            }),
          ),
        },
        select: {
          _id: true,
          projectId: true,
          apiKeyCustomRoleId: true,
          customRolePermissionId: true,
          labels: { _id: true },
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      },
    );

    return rows.map((row: ApiKeyPermission): LabelledRow => {
      return {
        id: row.id!,
        projectId: row.projectId!,
        labelIds: labelIdsOf(row.labels),
        isRoleCopy: Boolean(
          row.apiKeyCustomRoleId || row.customRolePermissionId,
        ),
      };
    });
  }

  private static async findCustomRolePermissions(
    labelIds: Array<ObjectID>,
  ): Promise<Array<LabelledRow>> {
    const matched: Array<CustomRolePermission> =
      await CustomRolePermissionService.findBy({
        query: { labels: labelIds },
        select: { _id: true },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

    if (matched.length === 0) {
      return [];
    }

    const rows: Array<CustomRolePermission> =
      await CustomRolePermissionService.findBy({
        query: {
          _id: QueryHelper.any(
            matched.map((row: CustomRolePermission): ObjectID => {
              return row.id!;
            }),
          ),
        },
        select: {
          _id: true,
          projectId: true,
          labels: { _id: true },
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

    return rows.map((row: CustomRolePermission): LabelledRow => {
      return {
        id: row.id!,
        projectId: row.projectId!,
        labelIds: labelIdsOf(row.labels),
        isRoleCopy: false,
      };
    });
  }
}
