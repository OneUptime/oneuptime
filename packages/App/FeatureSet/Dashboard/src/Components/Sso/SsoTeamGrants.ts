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
import User from "Common/UI/Utils/User";

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

// What is read for a project: its teams and their permission rows.
export interface SsoTeamData {
  // Every team in the project, oldest first.
  teams: Array<{ id: string; name: string }>;
  // Every permission row of those teams, allows and blocks.
  permissionRows: Array<SsoTeamPermissionRow>;
}

type BuildSsoTeamGrantsFunction = (
  data: SsoTeamData & {
    canGrantTeam: CanGrantTeamFunction;
  },
) => Array<SsoTeamGrant>;

export const buildSsoTeamGrants: BuildSsoTeamGrantsFunction = (
  data: SsoTeamData & {
    canGrantTeam: CanGrantTeamFunction;
  },
): Array<SsoTeamGrant> => {
  // Every team's rows, gathered in one pass.
  const grantsByTeam: Map<string, Array<TeamPermissionGrant>> = new Map<
    string,
    Array<TeamPermissionGrant>
  >();

  for (const row of data.permissionRows) {
    const teamId: string = row.teamId.toLowerCase();
    const grants: Array<TeamPermissionGrant> = grantsByTeam.get(teamId) || [];

    grants.push({
      permission: row.permission,
      scope: row.scope,
      labelIds: row.labelIds,
    });
    grantsByTeam.set(teamId, grants);
  }

  return data.teams.map((team: { id: string; name: string }): SsoTeamGrant => {
    const teamId: string = team.id.toLowerCase();

    return {
      id: teamId,
      name: team.name,
      canGrant: data.canGrantTeam(grantsByTeam.get(teamId) || []),
    };
  });
};

type FetchSsoTeamDataFunction = (data: {
  projectId: ObjectID;
  modelAPI?: typeof ModelAPI | undefined;
}) => Promise<SsoTeamData>;

/*
 * The project's teams and their permission rows, both small lists, read in
 * parallel. Throws when either cannot be read.
 */
export const fetchSsoTeamData: FetchSsoTeamDataFunction = async (data: {
  projectId: ObjectID;
  modelAPI?: typeof ModelAPI | undefined;
}): Promise<SsoTeamData> => {
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
        // Allows and blocks alike: both are handed on with the team.
        select: {
          _id: true,
          teamId: true,
          permission: true,
          scope: true,
          labels: {
            _id: true,
          },
        },
        sort: {},
      }),
    ]);

  return {
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
    /*
     * A row whose permission did not come back still counts against its
     * team - nobody holds an unknown permission - as it does on the server.
     */
    permissionRows: permissions.data
      .filter((row: TeamPermission): boolean => {
        return Boolean(row.teamId);
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
  };
};

/*
 * What a project's teams mean for the signed-in user, with the permissions
 * they hold at this moment. Worked out each time it is asked, so the answer
 * follows their permissions even when the rows were read before those had
 * loaded.
 */
export const getSignedInUserTeamGrants: (
  teamData: SsoTeamData,
) => Array<SsoTeamGrant> = (teamData: SsoTeamData): Array<SsoTeamGrant> => {
  return buildSsoTeamGrants({
    ...teamData,
    canGrantTeam: canSignedInUserGrantTeam,
  });
};

/*
 * How long the note keeps what it read for a project. The Teams field's
 * footer is drawn afresh whenever the form comes back to its step, and a
 * project's teams do not change between two clicks of Next and Back.
 */
export const SSO_TEAM_GRANTS_CACHE_TTL_MS: number = 30000;

interface CachedSsoTeamData {
  readAt: number;
  teamData: Promise<SsoTeamData>;
}

const cachedTeamData: Map<string, CachedSsoTeamData> = new Map<
  string,
  CachedSsoTeamData
>();

type GetCacheKeyFunction = (projectId: ObjectID) => string;

// One entry per signed-in user and project: what someone may read is theirs.
const getCacheKey: GetCacheKeyFunction = (projectId: ObjectID): string => {
  let userId: string = "";

  try {
    userId = User.getUserId()?.toString() || "";
  } catch {
    userId = "";
  }

  return `${userId}|${projectId.toString()}`.toLowerCase();
};

/*
 * fetchSsoTeamData, read once per signed-in user and project for
 * SSO_TEAM_GRANTS_CACHE_TTL_MS. A read that fails is not kept. What the rows
 * mean for the person is getSignedInUserTeamGrants's to say, when asked.
 */
export const fetchSsoTeamDataOnce: (data: {
  projectId: ObjectID;
  now?: (() => number) | undefined;
}) => Promise<SsoTeamData> = (data: {
  projectId: ObjectID;
  now?: (() => number) | undefined;
}): Promise<SsoTeamData> => {
  const now: number = (data.now || Date.now)();
  const key: string = getCacheKey(data.projectId);
  const cached: CachedSsoTeamData | undefined = cachedTeamData.get(key);

  if (cached && now - cached.readAt < SSO_TEAM_GRANTS_CACHE_TTL_MS) {
    return cached.teamData;
  }

  const teamData: Promise<SsoTeamData> = fetchSsoTeamData({
    projectId: data.projectId,
  });

  cachedTeamData.set(key, { readAt: now, teamData: teamData });

  teamData.catch(() => {
    if (cachedTeamData.get(key)?.teamData === teamData) {
      cachedTeamData.delete(key);
    }
  });

  return teamData;
};

// Forgets everything read (the tests start each case afresh).
export const clearSsoTeamGrantsCache: () => void = (): void => {
  cachedTeamData.clear();
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
