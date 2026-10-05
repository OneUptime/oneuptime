import Label from "Common/Models/DatabaseModels/Label";
import Team from "Common/Models/DatabaseModels/Team";
import TeamPermission from "Common/Models/DatabaseModels/TeamPermission";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import GrantablePermission, {
  TeamPermissionGrant,
} from "Common/UI/Utils/GrantablePermission";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * WHICH TEAMS THE PERSON FILLING IN A PROVIDER FORM COULD PUT ON IT.
 *
 * Someone who signs in with a project's SAML or OIDC provider for the first
 * time joins the provider's teams, and joining a team hands them everything
 * the team may do. So the server saves a provider only with teams the
 * person saving it could invite someone to - the ceiling Invite User meets
 * (Common/Server/Utils/SsoProviderTeamGrant). The provider forms say so
 * under Teams the moment such a team is picked, instead of at Save, and
 * name it (SsoTeamsGrantNote).
 *
 * Every team's own permission rows are read with their scopes and labels
 * and weighed the way the server weighs them (GrantablePermission
 * .canGrantTeamPermission), so the note never warns about a team the server
 * would accept. A lookup that fails - no permission to read teams, a slow
 * server - only means nothing is said, and the server still explains its
 * refusal on Save.
 *
 * React-free: the note, and the tests, read it.
 */

export interface SsoTeamGrant {
  // The team's id, in lower case.
  id: string;
  name: string;
  // Whether the person filling in the form could add someone to it.
  canGrant: boolean;
}

export interface SsoTeamPermissionRow {
  teamId: string;
  permission: Permission;
  scope?: PermissionScope | undefined;
  labelIds: Array<string>;
}

// Whether the person filling in the form could add someone to such a team.
export type CanGrantTeamFunction = (
  grants: Array<TeamPermissionGrant>,
) => boolean;

export const canSignedInUserGrantTeam: CanGrantTeamFunction = (
  grants: Array<TeamPermissionGrant>,
): boolean => {
  return GrantablePermission.canCurrentUserGrantTeam(grants);
};

type ToIdFunction = (value: unknown) => string | null;

// One id a form value names: an id, an ObjectID, a model or a dropdown pick.
const toId: ToIdFunction = (value: unknown): string | null => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string") {
    return value.trim() ? value.trim().toLowerCase() : null;
  }

  if (value instanceof ObjectID) {
    return toId(value.toString());
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;

  for (const key of ["_id", "id", "value"]) {
    const id: string | null = toId(record[key]);

    if (id) {
      return id;
    }
  }

  return null;
};

// The team ids a Teams field holds, in the order it holds them.
export const getFormTeamIds: (value: unknown) => Array<string> = (
  value: unknown,
): Array<string> => {
  const entries: Array<unknown> = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];

  const ids: Array<string> = [];

  for (const entry of entries) {
    const id: string | null = toId(entry);

    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
};

type BuildSsoTeamGrantsFunction = (data: {
  // Every team in the project, oldest first.
  teams: Array<{ id: string; name: string }>;
  // Every permission row of those teams, allows and blocks.
  permissionRows: Array<SsoTeamPermissionRow>;
  canGrantTeam: CanGrantTeamFunction;
}) => Array<SsoTeamGrant>;

export const buildSsoTeamGrants: BuildSsoTeamGrantsFunction = (data: {
  teams: Array<{ id: string; name: string }>;
  permissionRows: Array<SsoTeamPermissionRow>;
  canGrantTeam: CanGrantTeamFunction;
}): Array<SsoTeamGrant> => {
  return data.teams.map((team: { id: string; name: string }): SsoTeamGrant => {
    const teamId: string = team.id.toLowerCase();

    const grants: Array<TeamPermissionGrant> = data.permissionRows
      .filter((row: SsoTeamPermissionRow): boolean => {
        return row.teamId.toLowerCase() === teamId;
      })
      .map((row: SsoTeamPermissionRow): TeamPermissionGrant => {
        return {
          permission: row.permission,
          scope: row.scope,
          labelIds: row.labelIds,
        };
      });

    return {
      id: teamId,
      name: team.name,
      canGrant: data.canGrantTeam(grants),
    };
  });
};

type FetchSsoTeamGrantsFunction = (data: {
  projectId: ObjectID;
  modelAPI?: typeof ModelAPI | undefined;
  // Defaults to the signed-in user's own permissions.
  canGrantTeam?: CanGrantTeamFunction | undefined;
}) => Promise<Array<SsoTeamGrant>>;

/*
 * The project's teams and their permission rows, both small lists, read in
 * parallel. Throws when either cannot be read.
 */
export const fetchSsoTeamGrants: FetchSsoTeamGrantsFunction = async (data: {
  projectId: ObjectID;
  modelAPI?: typeof ModelAPI | undefined;
  canGrantTeam?: CanGrantTeamFunction | undefined;
}): Promise<Array<SsoTeamGrant>> => {
  const modelAPI: typeof ModelAPI = data.modelAPI || ModelAPI;

  const [teams, permissions]: [ListResult<Team>, ListResult<TeamPermission>] =
    await Promise.all([
      modelAPI.getList<Team>({
        modelType: Team,
        query: {
          projectId: data.projectId,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
          name: true,
          createdAt: true,
        },
        sort: {
          createdAt: SortOrder.Ascending,
        },
      }),
      modelAPI.getList<TeamPermission>({
        modelType: TeamPermission,
        query: {
          projectId: data.projectId,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
          teamId: true,
          permission: true,
          isBlockPermission: true,
          scope: true,
          labels: {
            _id: true,
          },
        },
        sort: {},
      }),
    ]);

  return buildSsoTeamGrants({
    teams: teams.data
      .filter((team: Team): boolean => {
        return Boolean(team.id);
      })
      .map((team: Team): { id: string; name: string } => {
        return {
          id: team.id!.toString(),
          name: team.name?.toString() || "",
        };
      }),
    permissionRows: permissions.data
      .filter((row: TeamPermission): boolean => {
        return Boolean(row.teamId && row.permission);
      })
      .map((row: TeamPermission): SsoTeamPermissionRow => {
        return {
          teamId: row.teamId!.toString(),
          permission: row.permission as Permission,
          scope: row.scope,
          // As written, the way the server compares them.
          labelIds: (row.labels || [])
            .map((label: Label): string => {
              return label.id?.toString() || label._id?.toString() || "";
            })
            .filter((labelId: string): boolean => {
              return Boolean(labelId);
            }),
        };
      }),
    canGrantTeam: data.canGrantTeam || canSignedInUserGrantTeam,
  });
};

/**
 * The names of the picked teams the person filling in the form could not
 * put on the provider, in the order the project lists its teams. Empty
 * while the grants are not known.
 */
export const getTeamsBeyondGrant: (data: {
  selectedTeams: unknown;
  grants: Array<SsoTeamGrant> | null;
}) => Array<string> = (data: {
  selectedTeams: unknown;
  grants: Array<SsoTeamGrant> | null;
}): Array<string> => {
  if (!data.grants) {
    return [];
  }

  const selected: Set<string> = new Set<string>(
    getFormTeamIds(data.selectedTeams),
  );

  return data.grants
    .filter((team: SsoTeamGrant): boolean => {
      return selected.has(team.id) && !team.canGrant;
    })
    .map((team: SsoTeamGrant): string => {
      return team.name;
    });
};
