import { jest } from "@jest/globals";
import { FindOperator } from "typeorm";
import ApiKeyPermission from "../../Models/DatabaseModels/ApiKeyPermission";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import TeamPermission from "../../Models/DatabaseModels/TeamPermission";
import ApiKeyPermissionService from "../../Server/Services/ApiKeyPermissionService";
import TeamMemberService from "../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../Server/Services/TeamPermissionService";
import PermissionScope from "../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";

/*
 * A PROJECT'S TEAMS, MEMBERS AND API KEYS, as the database answers the
 * reads ReadAudienceReader makes of them (#9632): the permission rows that
 * narrow somebody's reads, the rows that grant a permission reading where a
 * run posts, and who is on which team. Each read is answered by its own
 * query - its scope, its labels, the permissions, teams, keys and people it
 * asks for - so a read that asks for the wrong rows gets the wrong answer,
 * as it would from Postgres. Not a test file itself (jest only collects
 * *.test.ts). The spies are restored with jest.restoreAllMocks.
 */

export interface ProjectTeamRow {
  teamId: string;
  permission: Permission;
  scope?: PermissionScope | undefined;
  // Limited to these labels - or, for a block, blocked for them.
  labelIds?: Array<string> | undefined;
  isBlock?: boolean | undefined;
}

export interface ProjectKeyRow {
  apiKeyId: string;
  permission: Permission;
  labelIds?: Array<string> | undefined;
  isBlock?: boolean | undefined;
}

export interface ProjectMembership {
  teamId: string;
  userId: string;
  // An invitation not yet accepted, when false.
  hasAcceptedInvitation?: boolean | undefined;
}

export interface ProjectPermissionRows {
  // The project whose rows these are; any project's reads, when none.
  projectId?: ObjectID | undefined;
  teamRows?: Array<ProjectTeamRow> | undefined;
  keyRows?: Array<ProjectKeyRow> | undefined;
  members?: Array<ProjectMembership> | undefined;
}

// Every read made of the rows, by table, as asked.
export interface ProjectPermissionReads {
  teamPermission: Array<Record<string, unknown>>;
  apiKeyPermission: Array<Record<string, unknown>>;
  teamMember: Array<Record<string, unknown>>;
}

// The values an IN condition (QueryHelper.any) asks for, lower case.
function valuesOf(condition: unknown): Array<string> {
  const parameters: Record<string, unknown> =
    (condition as FindOperator<unknown>).objectLiteralParameters || {};

  return (Object.values(parameters)[0] as Array<string>).map(
    (value: string): string => {
      return value.toString().toLowerCase();
    },
  );
}

// Whether `value` meets the query's condition on a column; no condition: yes.
function meets(condition: unknown, value: string | undefined): boolean {
  if (condition === undefined) {
    return true;
  }

  if (typeof condition === "string" || condition instanceof ObjectID) {
    return condition.toString().toLowerCase() === (value || "").toLowerCase();
  }

  return valuesOf(condition).includes((value || "").toLowerCase());
}

// Whether the query asks for the rows that carry some label (TeamPermissionLabel...).
function asksForLabelledRows(query: Record<string, unknown>): boolean {
  const condition: FindOperator<unknown> | undefined = query["_id"] as
    | FindOperator<unknown>
    | undefined;

  if (!condition) {
    return false;
  }

  const sql: string = condition.getSql!('"_id"');

  if (!sql.includes("PermissionLabel")) {
    throw new Error(`An unexpected read of the permission rows: ${sql}`);
  }

  return true;
}

// Whether a read asks for the project's own rows: every read must name one.
function ofProject(
  query: Record<string, unknown>,
  projectId: ObjectID | undefined,
): boolean {
  if (query["projectId"] === undefined) {
    return false;
  }

  return (
    !projectId ||
    query["projectId"]!.toString().toLowerCase() ===
      projectId.toString().toLowerCase()
  );
}

export function stubProjectPermissionRows(
  project: ProjectPermissionRows,
): ProjectPermissionReads {
  const reads: ProjectPermissionReads = {
    teamPermission: [],
    apiKeyPermission: [],
    teamMember: [],
  };

  jest
    .spyOn(TeamPermissionService, "findAllBy")
    .mockImplementation((async (findAllBy: {
      query: Record<string, unknown>;
    }): Promise<Array<TeamPermission>> => {
      const query: Record<string, unknown> = findAllBy.query;
      reads.teamPermission.push(query);

      if (!ofProject(query, project.projectId)) {
        return [];
      }

      const labelled: boolean = asksForLabelledRows(query);

      return (project.teamRows || [])
        .filter((row: ProjectTeamRow): boolean => {
          return (
            (query["scope"] === undefined || query["scope"] === row.scope) &&
            (!labelled || (row.labelIds || []).length > 0) &&
            meets(query["permission"], row.permission) &&
            meets(query["teamId"], row.teamId)
          );
        })
        .map((row: ProjectTeamRow): TeamPermission => {
          const permission: TeamPermission = new TeamPermission();
          permission.permission = row.permission;
          permission.teamId = new ObjectID(row.teamId);
          permission.isBlockPermission = row.isBlock === true;
          permission.scope = row.scope || PermissionScope.All;
          return permission;
        });
    }) as never);

  jest
    .spyOn(ApiKeyPermissionService, "findAllBy")
    .mockImplementation((async (findAllBy: {
      query: Record<string, unknown>;
    }): Promise<Array<ApiKeyPermission>> => {
      const query: Record<string, unknown> = findAllBy.query;
      reads.apiKeyPermission.push(query);

      if (!ofProject(query, project.projectId)) {
        return [];
      }

      const labelled: boolean = asksForLabelledRows(query);

      return (project.keyRows || [])
        .filter((row: ProjectKeyRow): boolean => {
          return (
            (!labelled || (row.labelIds || []).length > 0) &&
            meets(query["permission"], row.permission) &&
            meets(query["apiKeyId"], row.apiKeyId)
          );
        })
        .map((row: ProjectKeyRow): ApiKeyPermission => {
          const permission: ApiKeyPermission = new ApiKeyPermission();
          permission.permission = row.permission;
          permission.apiKeyId = new ObjectID(row.apiKeyId);
          permission.isBlockPermission = row.isBlock === true;
          return permission;
        });
    }) as never);

  jest
    .spyOn(TeamMemberService, "findAllBy")
    .mockImplementation((async (findAllBy: {
      query: Record<string, unknown>;
    }): Promise<Array<TeamMember>> => {
      const query: Record<string, unknown> = findAllBy.query;
      reads.teamMember.push(query);

      if (!ofProject(query, project.projectId)) {
        return [];
      }

      return (project.members || [])
        .filter((member: ProjectMembership): boolean => {
          return (
            meets(query["teamId"], member.teamId) &&
            meets(query["userId"], member.userId) &&
            (query["hasAcceptedInvitation"] === undefined ||
              query["hasAcceptedInvitation"] ===
                (member.hasAcceptedInvitation !== false))
          );
        })
        .map((member: ProjectMembership): TeamMember => {
          const row: TeamMember = new TeamMember();
          row.teamId = new ObjectID(member.teamId);
          row.userId = new ObjectID(member.userId);
          row.hasAcceptedInvitation = member.hasAcceptedInvitation !== false;
          return row;
        });
    }) as never);

  return reads;
}
