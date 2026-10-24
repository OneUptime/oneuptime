import { CustomRoleReach } from "./CustomRoleCopy";
import ApiKeyCustomRole from "Common/Models/DatabaseModels/ApiKeyCustomRole";
import TeamCustomRole from "Common/Models/DatabaseModels/TeamCustomRole";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import Includes from "Common/Types/BaseDatabase/Includes";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * WHO A CUSTOM ROLE REACHES: the teams given it, and the people on them who
 * have accepted their invitation, each once, and the API keys given it -
 * what a change to the role changes at once, and what deleting it takes
 * access from. Read when the role's page opens and when its Delete is
 * asked. React-free.
 *
 * A reader who may not read the teams' members still learns the teams: the
 * people are then not counted (memberCount null), and the sentences name
 * the teams only. A reader who may not read the project's API keys learns
 * nothing of them (apiKeyCount null), and the sentences name the teams
 * only.
 */

export interface TeamWithRole {
  // The TeamCustomRole row: what Remove takes away.
  teamCustomRoleId: string;
  teamId: string;
  teamName: string;
}

export interface CustomRoleReachDetails extends CustomRoleReach {
  teams: Array<TeamWithRole>;
}

export const loadCustomRoleReach: (data: {
  customRoleId: ObjectID;
  projectId: ObjectID;
  modelAPI?: typeof ModelAPI | undefined;
}) => Promise<CustomRoleReachDetails> = async (data: {
  customRoleId: ObjectID;
  projectId: ObjectID;
  modelAPI?: typeof ModelAPI | undefined;
}): Promise<CustomRoleReachDetails> => {
  const modelAPI: typeof ModelAPI = data.modelAPI || ModelAPI;

  const given: ListResult<TeamCustomRole> = await modelAPI.getList({
    modelType: TeamCustomRole,
    query: {
      customRoleId: data.customRoleId,
      projectId: data.projectId,
    },
    select: {
      _id: true,
      teamId: true,
      team: {
        name: true,
      },
    },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    sort: {},
  });

  const teams: Array<TeamWithRole> = given.data.map(
    (row: TeamCustomRole): TeamWithRole => {
      return {
        teamCustomRoleId: row.id?.toString() || "",
        teamId: row.teamId?.toString() || "",
        teamName: row.team?.name || "",
      };
    },
  );

  const apiKeyCount: number | null = await countApiKeysGivenRole({
    customRoleId: data.customRoleId,
    projectId: data.projectId,
    modelAPI: modelAPI,
  });

  if (teams.length === 0) {
    return { teams: [], teamCount: 0, memberCount: 0, apiKeyCount };
  }

  let memberCount: number | null = null;

  try {
    const members: ListResult<TeamMember> = await modelAPI.getList({
      modelType: TeamMember,
      query: {
        teamId: new Includes(
          teams.map((team: TeamWithRole): string => {
            return team.teamId;
          }),
        ),
        projectId: data.projectId,
        hasAcceptedInvitation: true,
      },
      select: {
        userId: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      sort: {},
    });

    memberCount = new Set<string>(
      members.data
        .map((member: TeamMember): string => {
          return member.userId?.toString().toLowerCase() || "";
        })
        .filter((userId: string): boolean => {
          return Boolean(userId);
        }),
    ).size;
  } catch {
    // Teams only: the members are not the reader's to read.
    memberCount = null;
  }

  return { teams, teamCount: teams.length, memberCount, apiKeyCount };
};

/*
 * How many API keys are given the role, or null when the reader may not
 * read the project's API keys.
 */
const countApiKeysGivenRole: (data: {
  customRoleId: ObjectID;
  projectId: ObjectID;
  modelAPI: typeof ModelAPI;
}) => Promise<number | null> = async (data: {
  customRoleId: ObjectID;
  projectId: ObjectID;
  modelAPI: typeof ModelAPI;
}): Promise<number | null> => {
  try {
    const given: ListResult<ApiKeyCustomRole> = await data.modelAPI.getList({
      modelType: ApiKeyCustomRole,
      query: {
        customRoleId: data.customRoleId,
        projectId: data.projectId,
      },
      select: {
        apiKeyId: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      sort: {},
    });

    return new Set<string>(
      given.data
        .map((row: ApiKeyCustomRole): string => {
          return row.apiKeyId?.toString().toLowerCase() || "";
        })
        .filter((apiKeyId: string): boolean => {
          return Boolean(apiKeyId);
        }),
    ).size;
  } catch {
    // The keys are not the reader's to read: the sentences name the teams only.
    return null;
  }
};
