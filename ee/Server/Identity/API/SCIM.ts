import SCIMMiddleware from "../Middleware/SCIMAuthorization";
import LicensedFeatureGate from "../Middleware/LicensedFeatureGate";
import UserService from "Common/Server/Services/UserService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import TeamService from "Common/Server/Services/TeamService";
import { createProjectSCIMLog } from "../Utils/SCIMLogger";
import ProjectSCIMAccountPolicy, {
  ProjectSCIMTeamAddOutcome,
} from "../Utils/ProjectSCIMAccountPolicy";
import SCIMLogStatus from "Common/Types/SCIM/SCIMLogStatus";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  OneUptimeRequest,
} from "Common/Server/Utils/Express";
import logger, {
  getLogAttributesFromRequest,
  type RequestLike,
} from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import { JSONObject } from "Common/Types/JSON";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import Team from "Common/Models/DatabaseModels/Team";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import User from "Common/Models/DatabaseModels/User";
import {
  generateServiceProviderConfig,
  generateUsersListResponse,
  parseSCIMQueryParams,
  generateSchemasResponse,
  generateResourceTypesResponse,
  validateBulkRequest,
  parseBulkOperationPath,
  generateBulkResponse,
  SCIMBulkOperationResponse,
  generateSCIMErrorResponse,
  getScimBaseUrl,
  getScimErrorStatus,
  SCIMErrorType,
  SCIMException,
  sendScimError,
  sendScimResponse,
} from "../Utils/SCIMUtils";
import {
  applyScimUserPatch,
  getAccountEmail,
  getAccountName,
  getRecordDataOfScimUserResource,
  getScimUserResourceOfAccount,
  getScimUserResourceOfRecord,
  readScimUserResource,
  renderScimUser,
  ScimUserAccount,
  ScimUserResource,
} from "../Utils/ProjectSCIMUserResource";
import {
  getScimFilterText,
  isScimAttribute,
  parseScimFilter,
  ScimEqualityFilter,
} from "../Utils/SCIMFilter";
import {
  getScimGroupPatchBelowPlan,
  getScimGroupReplaceBelowPlan,
  getScimMemberUserId,
  getScimMissingPlan,
  getScimUserUpdateBelowPlan,
  planScimGroupPatch,
  SCIM_BELOW_PLAN_STATUS,
  ScimBelowPlanRefusal,
  ScimGroupPatchAction,
  ScimGroupPatchBelowPlan,
  ScimUpdateBelowPlan,
  sendScimBelowPlanRefusal,
  toComparableUserId,
} from "../Utils/SCIMBelowPlan";
import ProjectSCIMUserService from "Common/Server/Services/ProjectSCIMUserService";
import ProjectSCIMUser from "Common/Models/DatabaseModels/ProjectSCIMUser";
import Select from "Common/Server/Types/Database/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { getScimStoppedMessage } from "Common/Types/Billing/PlanCutoffCredentials";
import { DocsClientUrl } from "Common/Server/EnvironmentConfig";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";

type SCIMMember = {
  value: string;
  display: string;
  $ref: string;
};

const router: ExpressRouter = Express.getRouter();

/*
 * Adds an account to, or removes it from, the teams this SCIM configuration
 * provisions into. Whether an add is an accepted membership or an invitation
 * is ProjectSCIMAccountPolicy's call; the outcomes say which each one was.
 */
const handleUserTeamOperations: (
  operation: "add" | "remove",
  projectId: ObjectID,
  userId: ObjectID,
  scimConfig: ProjectSCIM,
  options?: { userWasCreatedByScim?: boolean | undefined },
) => Promise<Array<ProjectSCIMTeamAddOutcome>> = async (
  operation: "add" | "remove",
  projectId: ObjectID,
  userId: ObjectID,
  scimConfig: ProjectSCIM,
  options?: { userWasCreatedByScim?: boolean | undefined },
): Promise<Array<ProjectSCIMTeamAddOutcome>> => {
  const outcomes: Array<ProjectSCIMTeamAddOutcome> = [];
  const teamsIds: Array<ObjectID> =
    scimConfig.teams?.map((team: any) => {
      return team.id;
    }) || [];

  if (teamsIds.length === 0) {
    logger.debug(`SCIM Team operations - no teams configured for SCIM`, {
      projectId: projectId?.toString(),
    });
    return outcomes;
  }

  if (operation === "add") {
    logger.debug(
      `SCIM Team operations - adding user to ${teamsIds.length} configured teams`,
      { projectId: projectId?.toString() },
    );

    for (const team of scimConfig.teams || []) {
      const outcome: ProjectSCIMTeamAddOutcome =
        await ProjectSCIMAccountPolicy.addUserToTeam({
          projectId: projectId,
          userId: userId,
          teamId: team.id!,
          userWasCreatedByScim: options?.userWasCreatedByScim,
        });

      outcomes.push(outcome);

      logger.debug(`SCIM Team operations - team ${team.id}: ${outcome}`, {
        projectId: projectId?.toString(),
      });
    }
  } else if (operation === "remove") {
    logger.debug(
      `SCIM Team operations - removing user from ${teamsIds.length} configured teams`,
      { projectId: projectId?.toString() },
    );

    await TeamMemberService.deleteBy({
      query: {
        projectId: projectId,
        userId: userId,
        teamId: QueryHelper.any(teamsIds),
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });
  }

  return outcomes;
};

/*
 * Whether an update's active true would add the account to a team: the
 * connection adds an activated account to its configured teams
 * (handleUserTeamOperations) - unless it pushes groups instead - and only to
 * the ones the account is not in yet (ProjectSCIMAccountPolicy.addUserToTeam
 * finds a row, accepted or pending, and adds nothing). What below the plan
 * tells a reactivation from an active true that changes nothing.
 */
const wouldActivationAddToTeams: (data: {
  projectId: ObjectID;
  userId: ObjectID;
  scimConfig: ProjectSCIM;
}) => Promise<boolean> = async (data: {
  projectId: ObjectID;
  userId: ObjectID;
  scimConfig: ProjectSCIM;
}): Promise<boolean> => {
  if (data.scimConfig.enablePushGroups) {
    return false;
  }

  const teamIds: Array<ObjectID> = (data.scimConfig.teams || [])
    .map((team: Team): ObjectID | undefined => {
      return team.id || undefined;
    })
    .filter((id: ObjectID | undefined): id is ObjectID => {
      return Boolean(id);
    });

  if (teamIds.length === 0) {
    return false;
  }

  const memberships: Array<TeamMember> = await TeamMemberService.findBy({
    query: {
      projectId: data.projectId,
      userId: data.userId,
      teamId: QueryHelper.any(teamIds),
    },
    select: {
      _id: true,
      teamId: true,
    },
    limit: LIMIT_MAX,
    skip: 0,
    props: { isRoot: true },
  });

  const teamsTheyAreIn: Set<string> = new Set<string>(
    memberships.map((membership: TeamMember): string => {
      return (membership.teamId?.toString() || "").toLowerCase();
    }),
  );

  return teamIds.some((teamId: ObjectID): boolean => {
    return !teamsTheyAreIn.has(teamId.toString().toLowerCase());
  });
};

// Says, for the execution log, what adding an account to teams amounted to.
const describeTeamAddOutcomes: (
  outcomes: Array<ProjectSCIMTeamAddOutcome>,
) => string = (outcomes: Array<ProjectSCIMTeamAddOutcome>): string => {
  const count: (outcome: ProjectSCIMTeamAddOutcome) => number = (
    outcome: ProjectSCIMTeamAddOutcome,
  ): number => {
    return outcomes.filter((item: ProjectSCIMTeamAddOutcome) => {
      return item === outcome;
    }).length;
  };

  return `${count(ProjectSCIMTeamAddOutcome.AddedAsMember)} added as member, ${count(ProjectSCIMTeamAddOutcome.Invited)} invited (pending acceptance), ${count(ProjectSCIMTeamAddOutcome.AlreadyInTeam)} already in team`;
};

// Constants for special teams
const UNASSIGNED_TEAM_NAME: string = "Unassigned";
const UNASSIGNED_TEAM_DESCRIPTION: string =
  "Users provisioned via SCIM without a group assignment are placed in this team. This team has no permissions.";

// Helper function to get or create the "Unassigned" team for SCIM provisioning
const getOrCreateUnassignedTeam: (
  projectId: ObjectID,
) => Promise<Team> = async (projectId: ObjectID): Promise<Team> => {
  // First, try to find existing "Unassigned" team
  let unassignedTeam: Team | null = await TeamService.findOneBy({
    query: {
      projectId: projectId,
      name: UNASSIGNED_TEAM_NAME,
    },
    select: {
      _id: true,
      name: true,
      projectId: true,
    },
    props: { isRoot: true },
  });

  if (!unassignedTeam) {
    // Create the "Unassigned" team
    logger.debug(
      `SCIM - Creating "Unassigned" team for project: ${projectId.toString()}`,
      { projectId: projectId?.toString() },
    );

    const newTeam: Team = new Team();
    newTeam.projectId = projectId;
    newTeam.name = UNASSIGNED_TEAM_NAME;
    newTeam.description = UNASSIGNED_TEAM_DESCRIPTION;
    newTeam.isPermissionsEditable = false;
    newTeam.isTeamDeleteable = false;
    newTeam.isTeamEditable = false;
    newTeam.shouldHaveAtLeastOneMember = false;

    unassignedTeam = await TeamService.create({
      data: newTeam,
      props: { isRoot: true },
    });

    logger.debug(
      `SCIM - Created "Unassigned" team with ID: ${unassignedTeam.id?.toString()}`,
      { projectId: projectId?.toString() },
    );
  }

  return unassignedTeam;
};

// Helper function to add user to the "Unassigned" team
const addUserToUnassignedTeam: (
  projectId: ObjectID,
  userId: ObjectID,
  options?: { userWasCreatedByScim?: boolean | undefined },
) => Promise<{ team: Team; outcome: ProjectSCIMTeamAddOutcome }> = async (
  projectId: ObjectID,
  userId: ObjectID,
  options?: { userWasCreatedByScim?: boolean | undefined },
): Promise<{ team: Team; outcome: ProjectSCIMTeamAddOutcome }> => {
  const unassignedTeam: Team = await getOrCreateUnassignedTeam(projectId);

  const outcome: ProjectSCIMTeamAddOutcome =
    await ProjectSCIMAccountPolicy.addUserToTeam({
      projectId: projectId,
      userId: userId,
      teamId: unassignedTeam.id!,
      userWasCreatedByScim: options?.userWasCreatedByScim,
    });

  logger.debug(
    `SCIM - User ${userId.toString()} and "Unassigned" team ${unassignedTeam.id?.toString()}: ${outcome}`,
    { projectId: projectId?.toString() },
  );

  return { team: unassignedTeam, outcome: outcome };
};

// Helper function to remove user from the "Unassigned" team (when they get assigned to a real group)
const removeUserFromUnassignedTeam: (
  projectId: ObjectID,
  userId: ObjectID,
) => Promise<void> = async (
  projectId: ObjectID,
  userId: ObjectID,
): Promise<void> => {
  // Find the "Unassigned" team
  const unassignedTeam: Team | null = await TeamService.findOneBy({
    query: {
      projectId: projectId,
      name: UNASSIGNED_TEAM_NAME,
    },
    select: { _id: true },
    props: { isRoot: true },
  });

  if (unassignedTeam) {
    // Remove user from "Unassigned" team
    await TeamMemberService.deleteBy({
      query: {
        projectId: projectId,
        userId: userId,
        teamId: unassignedTeam.id!,
      },
      skip: 0,
      limit: 1,
      props: { isRoot: true },
    });

    logger.debug(
      `SCIM - Removed user ${userId.toString()} from "Unassigned" team`,
      { projectId: projectId?.toString() },
    );
  }
};

/*
 * The same for several users at once. `exceptTeamId` is the team the users
 * were just confirmed in: when that is the "Unassigned" team itself, their
 * rows there are the ones to keep.
 */
const removeUsersFromUnassignedTeam: (data: {
  projectId: ObjectID;
  userIds: Array<ObjectID>;
  exceptTeamId: ObjectID;
}) => Promise<void> = async (data: {
  projectId: ObjectID;
  userIds: Array<ObjectID>;
  exceptTeamId: ObjectID;
}): Promise<void> => {
  if (data.userIds.length === 0) {
    return;
  }

  const unassignedTeam: Team | null = await TeamService.findOneBy({
    query: {
      projectId: data.projectId,
      name: UNASSIGNED_TEAM_NAME,
    },
    select: { _id: true },
    props: { isRoot: true },
  });

  if (
    !unassignedTeam ||
    unassignedTeam.id!.toString().toLowerCase() ===
      data.exceptTeamId.toString().toLowerCase()
  ) {
    return;
  }

  await TeamMemberService.deleteBy({
    query: {
      projectId: data.projectId,
      teamId: unassignedTeam.id!,
      userId: QueryHelper.any(data.userIds),
    },
    limit: LIMIT_MAX,
    skip: 0,
    props: { isRoot: true },
  });
};

/*
 * Adds the accounts a SCIM group request lists to one of the project's teams,
 * through ProjectSCIMAccountPolicy, and takes each one that lands in the team
 * out of the "Unassigned" team.
 */
const addGroupMembersToTeam: (data: {
  projectId: ObjectID;
  teamId: ObjectID;
  members: Array<SCIMMember>;
}) => Promise<{
  added: number;
  invited: number;
  skipped: number;
}> = async (data: {
  projectId: ObjectID;
  teamId: ObjectID;
  members: Array<SCIMMember>;
}): Promise<{ added: number; invited: number; skipped: number }> => {
  const counts: { added: number; invited: number; skipped: number } = {
    added: 0,
    invited: 0,
    skipped: 0,
  };

  for (const member of data.members) {
    // Trimmed, as the below-plan check reads it (getScimMemberUserId).
    const memberValue: string | null = member
      ? getScimMemberUserId(member as unknown as JSONObject)
      : null;

    if (!memberValue) {
      continue;
    }

    const userId: ObjectID = new ObjectID(memberValue);

    const outcome: ProjectSCIMTeamAddOutcome =
      await ProjectSCIMAccountPolicy.addUserToTeam({
        projectId: data.projectId,
        userId: userId,
        teamId: data.teamId,
      });

    if (
      outcome !== ProjectSCIMTeamAddOutcome.AddedAsMember &&
      outcome !== ProjectSCIMTeamAddOutcome.Invited
    ) {
      counts.skipped++;
      continue;
    }

    if (outcome === ProjectSCIMTeamAddOutcome.AddedAsMember) {
      counts.added++;
    } else {
      counts.invited++;
    }

    // Remove user from "Unassigned" team since they now have a real group
    await removeUserFromUnassignedTeam(data.projectId, userId);
  }

  return counts;
};

/*
 * The memberships of one of the project's teams, accepted or pending: what a
 * group replace writes the difference against (replaceGroupMembersOfTeam),
 * and what a group update below the plan is compared with
 * (getTeamMemberUserIds).
 */
const findTeamMembers: (data: {
  projectId: ObjectID;
  teamId: ObjectID;
}) => Promise<Array<TeamMember>> = async (data: {
  projectId: ObjectID;
  teamId: ObjectID;
}): Promise<Array<TeamMember>> => {
  return await TeamMemberService.findBy({
    query: {
      projectId: data.projectId,
      teamId: data.teamId,
    },
    select: {
      _id: true,
      userId: true,
    },
    limit: LIMIT_MAX,
    skip: 0,
    props: { isRoot: true },
  });
};

/*
 * Makes the accounts a SCIM group replace (PUT, or PATCH "replace" on
 * members) lists the team's members, by writing only the difference: the rows
 * of accounts the list leaves out are deleted, and the accounts the team lacks
 * are added through addGroupMembersToTeam. An account already in the team
 * keeps its row, accepted or pending. Member ids are compared trimmed and in
 * lower case, as the below-plan check compares them (toComparableUserId): an
 * IdP may echo an id back in another case.
 *
 * Deleting every row and re-adding the list would put each kept account
 * through TeamMemberService's leave cleanups whenever this is its only team in
 * the project -- on-call assignments, incident roles and owner rows, workspace
 * links and notification settings, all gone -- and IdPs such as Okta send a
 * replace with every membership change.
 *
 * `removeOnly`, below the plan SCIM needs: only the removals are written. The
 * replace was let through for adding no one (Utils/SCIMBelowPlan); an account
 * it lists that the team no longer has - another request removed it after
 * that check - is skipped, not added back.
 */
const replaceGroupMembersOfTeam: (data: {
  projectId: ObjectID;
  teamId: ObjectID;
  members: Array<SCIMMember>;
  removeOnly?: boolean | undefined;
}) => Promise<{
  added: number;
  invited: number;
  skipped: number;
  kept: number;
  removed: number;
}> = async (data: {
  projectId: ObjectID;
  teamId: ObjectID;
  members: Array<SCIMMember>;
  removeOnly?: boolean | undefined;
}): Promise<{
  added: number;
  invited: number;
  skipped: number;
  kept: number;
  removed: number;
}> => {
  const currentMembers: Array<TeamMember> = await findTeamMembers({
    projectId: data.projectId,
    teamId: data.teamId,
  });

  // Keyed by comparable user id: an IdP may echo an id back in a different case.
  const currentUserIds: Map<string, ObjectID> = new Map<string, ObjectID>();

  for (const teamMember of currentMembers) {
    if (teamMember.userId) {
      currentUserIds.set(
        toComparableUserId(teamMember.userId.toString()),
        teamMember.userId,
      );
    }
  }

  const listedUserIds: Set<string> = new Set<string>();
  const keptUserIds: Array<ObjectID> = [];
  const membersToAdd: Array<SCIMMember> = [];

  for (const member of data.members) {
    // Trimmed, as the below-plan check reads it (getScimMemberUserId).
    const memberValue: string | null = member
      ? getScimMemberUserId(member as unknown as JSONObject)
      : null;

    if (!memberValue) {
      continue;
    }

    const key: string = toComparableUserId(memberValue);

    if (listedUserIds.has(key)) {
      continue;
    }

    listedUserIds.add(key);

    const currentUserId: ObjectID | undefined = currentUserIds.get(key);

    if (currentUserId) {
      keptUserIds.push(currentUserId);
    } else {
      membersToAdd.push(member);
    }
  }

  const userIdsToRemove: Array<ObjectID> = [];

  for (const [key, userId] of currentUserIds) {
    if (!listedUserIds.has(key)) {
      userIdsToRemove.push(userId);
    }
  }

  if (userIdsToRemove.length > 0) {
    await TeamMemberService.deleteBy({
      query: {
        projectId: data.projectId,
        teamId: data.teamId,
        userId: QueryHelper.any(userIdsToRemove),
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });
  }

  const counts: { added: number; invited: number; skipped: number } =
    data.removeOnly
      ? { added: 0, invited: 0, skipped: membersToAdd.length }
      : await addGroupMembersToTeam({
          projectId: data.projectId,
          teamId: data.teamId,
          members: membersToAdd,
        });

  /*
   * A kept account has a real group too, so it leaves the "Unassigned" team
   * just as an added one does.
   */
  await removeUsersFromUnassignedTeam({
    projectId: data.projectId,
    userIds: keptUserIds,
    exceptTeamId: data.teamId,
  });

  return {
    ...counts,
    kept: keptUserIds.length,
    removed: userIdsToRemove.length,
  };
};

/*
 * The ids of the accounts in one of the project's teams, accepted or
 * pending: what a group update below the plan is compared with
 * (Utils/SCIMBelowPlan), read as replaceGroupMembersOfTeam reads them
 * (findTeamMembers).
 */
const getTeamMemberUserIds: (data: {
  projectId: ObjectID;
  teamId: ObjectID;
}) => Promise<Array<string>> = async (data: {
  projectId: ObjectID;
  teamId: ObjectID;
}): Promise<Array<string>> => {
  const members: Array<TeamMember> = await findTeamMembers(data);

  return members
    .map((member: TeamMember): string => {
      return member.userId?.toString() || "";
    })
    .filter(Boolean);
};

// What applying a group PATCH did, for the response and the SCIM log.
interface GroupPatchResult {
  added: number;
  invited: number;
  removed: number;
  kept: number;
  replaced: boolean;
  nameUpdated: boolean;
}

/*
 * Applies a group PATCH's operations, as planScimGroupPatch reads them, in
 * order, to one of the project's teams: members removed (each through
 * TeamMemberService, so a leaver's own settings go with their last
 * membership), added, or replaced, and the team renamed. Operations it does
 * not know are left alone, as they always were. The single PATCH route and
 * Bulk share it, so both read the same operations the same way - and below
 * the plan, what was checked is exactly what is done.
 *
 * `removeOnly`, below the plan SCIM needs: a replace writes its removals
 * only, no member is added, whatever another request did since the check
 * (replaceGroupMembersOfTeam), and the group keeps its name - so a caller
 * that skipped the check still takes access away only.
 */
const applyGroupPatchActions: (data: {
  projectId: ObjectID;
  team: Team;
  actions: Array<ScimGroupPatchAction>;
  executionSteps: Array<string>;
  req: ExpressRequest;
  removeOnly: boolean;
}) => Promise<GroupPatchResult> = async (data: {
  projectId: ObjectID;
  team: Team;
  actions: Array<ScimGroupPatchAction>;
  executionSteps: Array<string>;
  req: ExpressRequest;
  removeOnly: boolean;
}): Promise<GroupPatchResult> => {
  const result: GroupPatchResult = {
    added: 0,
    invited: 0,
    removed: 0,
    kept: 0,
    replaced: false,
    nameUpdated: false,
  };

  for (const action of data.actions) {
    if (action.kind === "replaceMembers") {
      logger.debug(
        `SCIM Patch group - replacing all members`,
        getLogAttributesFromRequest(data.req as any),
      );
      result.replaced = true;
      data.executionSteps.push(
        `Replacing all members with ${action.members.length} members from request`,
      );

      const counts: {
        added: number;
        invited: number;
        skipped: number;
        kept: number;
        removed: number;
      } = await replaceGroupMembersOfTeam({
        projectId: data.projectId,
        teamId: data.team.id!,
        members: action.members as Array<SCIMMember>,
        removeOnly: data.removeOnly,
      });
      result.added += counts.added + counts.invited;
      result.invited += counts.invited;
      result.removed += counts.removed;
      result.kept += counts.kept;
      data.executionSteps.push(
        `Members kept: ${counts.kept}, removed: ${counts.removed}, added: ${counts.added + counts.invited} (${counts.invited} of them invited, pending acceptance)`,
      );
      continue;
    }

    if (action.kind === "addMembers") {
      if (data.removeOnly) {
        data.executionSteps.push(
          `Below the plan no member is added: ${action.members.length} members not added`,
        );
        continue;
      }

      logger.debug(
        `SCIM Patch group - adding members`,
        getLogAttributesFromRequest(data.req as any),
      );
      data.executionSteps.push(`Adding ${action.members.length} members`);
      const counts: { added: number; invited: number; skipped: number } =
        await addGroupMembersToTeam({
          projectId: data.projectId,
          teamId: data.team.id!,
          members: action.members as Array<SCIMMember>,
        });
      result.added += counts.added + counts.invited;
      result.invited += counts.invited;
      continue;
    }

    if (action.kind === "removeMembers") {
      logger.debug(
        `SCIM Patch group - removing members`,
        getLogAttributesFromRequest(data.req as any),
      );
      data.executionSteps.push(`Removing ${action.userIds.length} members`);

      for (const userId of action.userIds) {
        await TeamMemberService.deleteBy({
          query: {
            projectId: data.projectId,
            userId: new ObjectID(userId),
            teamId: data.team.id!,
          },
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        });
        result.removed++;
        logger.debug(
          `SCIM Patch group - removed user ${userId} from team`,
          getLogAttributesFromRequest(data.req as any),
        );
      }
      continue;
    }

    if (action.kind === "rename") {
      if (data.removeOnly) {
        data.executionSteps.push(
          `Below the plan the group keeps its name: the rename to "${action.displayName}" is not applied`,
        );
        continue;
      }

      logger.debug(
        `SCIM Patch group - updating displayName to: ${action.displayName}`,
        getLogAttributesFromRequest(data.req as any),
      );
      data.executionSteps.push(
        `Updating displayName from "${data.team.name}" to "${action.displayName}"`,
      );
      await TeamService.updateOneById({
        id: data.team.id!,
        data: { name: action.displayName },
        props: { isRoot: true },
      });
      result.nameUpdated = true;
      continue;
    }

    data.executionSteps.push(
      `Operation left alone: ${action.op || "(no op)"} on path: ${action.path || "root"}`,
    );
  }

  return result;
};

/*
 * Answers a request below the plan SCIM needs with the refusal
 * (Utils/SCIMBelowPlan) and writes it to the connection's SCIM log, as the
 * handlers log every request they answer. Nothing of the request was
 * applied.
 */
const refuseBelowPlan: (data: {
  req: ExpressRequest;
  res: ExpressResponse;
  missingPlan: PlanType;
  projectId: ObjectID;
  // As the SCIM log names the request: UpdateUser, UpdateGroup.
  operationType: string;
  // Why it gives or changes access, for the execution steps.
  reason: string;
  executionSteps: Array<string>;
  requestBody: JSONObject | undefined;
  affectedUserEmail?: string | undefined;
  affectedGroupName?: string | undefined;
  userInfo?: JSONObject | undefined;
  groupInfo?: JSONObject | undefined;
}) => void = (data: {
  req: ExpressRequest;
  res: ExpressResponse;
  missingPlan: PlanType;
  projectId: ObjectID;
  operationType: string;
  reason: string;
  executionSteps: Array<string>;
  requestBody: JSONObject | undefined;
  affectedUserEmail?: string | undefined;
  affectedGroupName?: string | undefined;
  userInfo?: JSONObject | undefined;
  groupInfo?: JSONObject | undefined;
}): void => {
  logger.debug(
    `SCIM ${data.operationType} - refused below the ${data.missingPlan} plan: ${data.reason}`,
    getLogAttributesFromRequest(data.req as any),
  );
  data.executionSteps.push(
    `Refused below the ${data.missingPlan} plan: ${data.reason}`,
  );

  const refusal: ScimBelowPlanRefusal = sendScimBelowPlanRefusal({
    res: data.res,
    missingPlan: data.missingPlan,
  });

  void createProjectSCIMLog({
    projectId: data.projectId,
    projectScimId: new ObjectID(data.req.params["projectScimId"]!),
    operationType: data.operationType,
    status: SCIMLogStatus.Error,
    statusMessage: refusal.message,
    httpMethod: data.req.method,
    requestPath: data.req.path,
    httpStatusCode: refusal.statusCode,
    affectedUserEmail: data.affectedUserEmail,
    affectedGroupName: data.affectedGroupName,
    requestBody: data.requestBody,
    responseBody: refusal.body,
    steps: data.executionSteps,
    userInfo: data.userInfo,
    groupInfo: data.groupInfo,
    additionalContext: {
      httpMethod: data.req.method,
      refusedBelowPlan: data.missingPlan,
    },
  });
};

/*
 * The group PATCH operations to apply. On the plan, all of them. Below the
 * plan SCIM needs (Utils/SCIMBelowPlan), only an update that takes access
 * away, or changes nothing, goes through - without its renames, as the
 * group keeps its name; one that adds anyone, or only renames the group,
 * is answered with the refusal, and null is returned. Read before anything
 * is written, so a refused update changes nothing.
 */
const getGroupPatchActionsToApply: (data: {
  req: ExpressRequest;
  res: ExpressResponse;
  projectId: ObjectID;
  team: Team;
  actions: Array<ScimGroupPatchAction>;
  executionSteps: Array<string>;
}) => Promise<Array<ScimGroupPatchAction> | null> = async (data: {
  req: ExpressRequest;
  res: ExpressResponse;
  projectId: ObjectID;
  team: Team;
  actions: Array<ScimGroupPatchAction>;
  executionSteps: Array<string>;
}): Promise<Array<ScimGroupPatchAction> | null> => {
  const missingPlan: PlanType | null = getScimMissingPlan(data.req);

  if (!missingPlan) {
    return data.actions;
  }

  const belowPlan: ScimGroupPatchBelowPlan = await getScimGroupPatchBelowPlan({
    actions: data.actions,
    currentName: data.team.name?.toString(),
    getCurrentMemberIds: (): Promise<Array<string>> => {
      return getTeamMemberUserIds({
        projectId: data.projectId,
        teamId: data.team.id!,
      });
    },
  });

  if (belowPlan.verdict === ScimUpdateBelowPlan.Refused) {
    refuseBelowPlan({
      req: data.req,
      res: data.res,
      missingPlan: missingPlan,
      projectId: data.projectId,
      operationType: "UpdateGroup",
      reason: "the update would add members, or only rename the group",
      executionSteps: data.executionSteps,
      requestBody: data.req.body,
      affectedGroupName: data.team.name?.toString(),
      groupInfo: {
        groupId: data.team.id?.toString(),
        displayName: data.team.name?.toString(),
      },
    });

    return null;
  }

  if (belowPlan.dropsRename) {
    data.executionSteps.push(
      `Below the ${missingPlan} plan the group keeps its name: the rename is not applied`,
    );
  }

  if (belowPlan.verdict === ScimUpdateBelowPlan.Removal) {
    data.executionSteps.push(
      `Below the ${missingPlan} plan: this update removes members, so it goes through`,
    );
  }

  return belowPlan.actions;
};

// Whether an id from a request is one at all: ids are UUIDs.
const isUuid: (value: string) => boolean = (value: string): boolean => {
  return ObjectID.isValidUUID(value);
};

/*
 * The members of the teams `teamIds`, as SCIM lists a group's members -
 * every membership, accepted or pending - keyed by team id in lower case.
 * One read for all of them, however many groups a list holds.
 */
const getTeamMembersForSCIM: (data: {
  req: ExpressRequest;
  projectId: ObjectID;
  projectScimId: string;
  teamIds: Array<ObjectID>;
}) => Promise<Map<string, Array<SCIMMember>>> = async (data: {
  req: ExpressRequest;
  projectId: ObjectID;
  projectScimId: string;
  teamIds: Array<ObjectID>;
}): Promise<Map<string, Array<SCIMMember>>> => {
  const membersByTeam: Map<string, Array<SCIMMember>> = new Map<
    string,
    Array<SCIMMember>
  >();

  if (data.teamIds.length === 0) {
    return membersByTeam;
  }

  const teamMembers: Array<TeamMember> = await TeamMemberService.findBy({
    query: {
      projectId: data.projectId,
      teamId: QueryHelper.any(data.teamIds),
    },
    select: {
      teamId: true,
      user: {
        _id: true,
        email: true,
      },
    },
    limit: LIMIT_MAX,
    skip: 0,
    props: { isRoot: true },
  });

  const usersUrl: string = `${getScimBaseUrl({
    req: data.req,
    scimId: data.projectScimId,
    scimType: "project",
  })}/Users`;

  for (const teamMember of teamMembers) {
    if (!teamMember.user?.id || !teamMember.teamId) {
      continue;
    }

    const key: string = teamMember.teamId.toString().toLowerCase();
    const members: Array<SCIMMember> = membersByTeam.get(key) || [];
    const userId: string = teamMember.user.id.toString();

    if (
      !members.some((member: SCIMMember): boolean => {
        return member.value === userId;
      })
    ) {
      members.push({
        value: userId,
        display: teamMember.user.email?.toString() || "",
        $ref: `${usersUrl}/${userId}`,
      });
    }

    membersByTeam.set(key, members);
  }

  return membersByTeam;
};

/*
 * A team, as the SCIM group it is. Its members are listed unless the request
 * leaves them out (excludedAttributes=members), from `membersByTeam` when the
 * caller read them for several groups at once.
 */
const formatTeamForSCIM: (data: {
  req: ExpressRequest;
  team: Team;
  projectScimId: string;
  includeMembers?: boolean | undefined;
  membersByTeam?: Map<string, Array<SCIMMember>> | undefined;
}) => Promise<JSONObject> = async (data: {
  req: ExpressRequest;
  team: Team;
  projectScimId: string;
  includeMembers?: boolean | undefined;
  membersByTeam?: Map<string, Array<SCIMMember>> | undefined;
}): Promise<JSONObject> => {
  const group: JSONObject = {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    id: data.team.id?.toString(),
    displayName: data.team.name?.toString(),
  };

  if (data.includeMembers !== false) {
    const membersByTeam: Map<string, Array<SCIMMember>> = data.membersByTeam ||
    (await getTeamMembersForSCIM({
      req: data.req,
      projectId: data.team.projectId!,
      projectScimId: data.projectScimId,
      teamIds: [data.team.id!],
    }));

    group["members"] = (membersByTeam.get(
      data.team.id!.toString().toLowerCase(),
    ) || []) as unknown as Array<JSONObject>;
  }

  group["meta"] = {
    resourceType: "Group",
    created: data.team.createdAt?.toISOString(),
    lastModified: data.team.updatedAt?.toISOString(),
    location: `${getScimBaseUrl({
      req: data.req,
      scimId: data.projectScimId,
      scimType: "project",
    })}/Groups/${data.team.id?.toString()}`,
  };

  return group;
};

/*
 * Whether a request leaves a group's members out: excludedAttributes names
 * them, or attributes names others and not them (RFC 7644, 3.4.2.5).
 * Microsoft Entra ID looks groups up with excludedAttributes=members.
 */
const includesGroupMembers: (req: ExpressRequest) => boolean = (
  req: ExpressRequest,
): boolean => {
  const names: (parameter: string) => Array<string> | null = (
    parameter: string,
  ): Array<string> | null => {
    const value: unknown = req.query[parameter];

    if (typeof value !== "string") {
      return null;
    }

    return value.split(",").map((name: string): string => {
      return name.trim().toLowerCase();
    });
  };

  const excluded: Array<string> | null = names("excludedAttributes");

  if (excluded && excluded.includes("members")) {
    return false;
  }

  const attributes: Array<string> | null = names("attributes");

  if (attributes && !attributes.includes("members")) {
    return false;
  }

  return true;
};

// The filters a group list answers.
const GROUP_FILTER_ATTRIBUTES: ReadonlyArray<string> = [
  "displayName",
  "id",
  "members.value",
  "members",
];

const SCIM_GROUP_SELECT: Select<Team> = {
  _id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  projectId: true,
};

/*
 * The project's teams, as SCIM groups, that meet every equality of
 * `filters` - all of them when there are none, oldest first. Okta and
 * Microsoft Entra ID look a group up by its displayName, which is not
 * case-exact; members[value eq "<id>"] (or members eq) asks for the groups
 * a user is in.
 */
const listProjectScimGroups: (data: {
  projectId: ObjectID;
  filters: Array<ScimEqualityFilter>;
}) => Promise<Array<Team>> = async (data: {
  projectId: ObjectID;
  filters: Array<ScimEqualityFilter>;
}): Promise<Array<Team>> => {
  for (const filter of data.filters) {
    const isSupported: boolean = GROUP_FILTER_ATTRIBUTES.some(
      (name: string): boolean => {
        return isScimAttribute(filter.attribute, name);
      },
    );

    if (!isSupported) {
      throw new SCIMException({
        statusCode: 400,
        scimType: SCIMErrorType.InvalidFilter,
        message: "OneUptime filters groups by displayName, id and members.",
      });
    }
  }

  const isMembersFilter: (filter: ScimEqualityFilter) => boolean = (
    filter: ScimEqualityFilter,
  ): boolean => {
    return (
      isScimAttribute(filter.attribute, "members.value") ||
      isScimAttribute(filter.attribute, "members")
    );
  };

  // The teams each user a filter names is in.
  const teamsOfUser: Map<string, Set<string>> = new Map<string, Set<string>>();

  const getTeamsOfUser: (userId: string) => Promise<Set<string>> = async (
    userId: string,
  ): Promise<Set<string>> => {
    const key: string = userId.toLowerCase();
    const known: Set<string> | undefined = teamsOfUser.get(key);

    if (known) {
      return known;
    }

    const teamIds: Set<string> = new Set<string>();

    if (isUuid(userId)) {
      const memberships: Array<TeamMember> = await TeamMemberService.findBy({
        query: {
          projectId: data.projectId,
          userId: new ObjectID(userId),
        },
        select: { teamId: true },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

      for (const membership of memberships) {
        if (membership.teamId) {
          teamIds.add(membership.teamId.toString().toLowerCase());
        }
      }
    }

    teamsOfUser.set(key, teamIds);
    return teamIds;
  };

  const first: ScimEqualityFilter | undefined = data.filters[0];
  const firstText: string | null = first
    ? getScimFilterText(first.value)
    : null;
  let teams: Array<Team> = [];

  if (!first) {
    teams = await TeamService.findBy({
      query: { projectId: data.projectId },
      select: SCIM_GROUP_SELECT,
      sort: { createdAt: SortOrder.Ascending },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });
  } else if (firstText === null) {
    teams = [];
  } else if (isScimAttribute(first.attribute, "displayName")) {
    teams = await TeamService.findBy({
      query: {
        projectId: data.projectId,
        name: QueryHelper.findWithSameText(firstText),
      },
      select: SCIM_GROUP_SELECT,
      sort: { createdAt: SortOrder.Ascending },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });
  } else if (isScimAttribute(first.attribute, "id")) {
    const team: Team | null = isUuid(firstText)
      ? await TeamService.findOneBy({
          query: { projectId: data.projectId, _id: new ObjectID(firstText) },
          select: SCIM_GROUP_SELECT,
          props: { isRoot: true },
        })
      : null;

    teams = team ? [team] : [];
  } else {
    const teamIds: Set<string> = await getTeamsOfUser(firstText);

    teams =
      teamIds.size === 0
        ? []
        : await TeamService.findBy({
            query: {
              projectId: data.projectId,
              _id: QueryHelper.any(
                Array.from(teamIds).map((teamId: string): ObjectID => {
                  return new ObjectID(teamId);
                }),
              ),
            },
            select: SCIM_GROUP_SELECT,
            sort: { createdAt: SortOrder.Ascending },
            limit: LIMIT_MAX,
            skip: 0,
            props: { isRoot: true },
          });
  }

  const matches: Array<Team> = [];

  for (const team of teams) {
    let matchesAll: boolean = true;

    for (const filter of data.filters) {
      const text: string | null = getScimFilterText(filter.value);

      if (text === null) {
        matchesAll = false;
      } else if (isScimAttribute(filter.attribute, "displayName")) {
        matchesAll =
          (team.name?.toString() || "").toLowerCase() === text.toLowerCase();
      } else if (isScimAttribute(filter.attribute, "id")) {
        matchesAll =
          (team.id?.toString() || "").toLowerCase() === text.toLowerCase();
      } else if (isMembersFilter(filter)) {
        matchesAll = (await getTeamsOfUser(text)).has(
          (team.id?.toString() || "").toLowerCase(),
        );
      }

      if (!matchesAll) {
        break;
      }
    }

    if (matchesAll) {
      matches.push(team);
    }
  }

  return matches;
};

/*
 * ---------------------------------------------------------------------------
 * PROJECT SCIM USERS.
 *
 * A SCIM user of this connection is an account the connection keeps a record
 * of (ProjectSCIMUser: what the identity provider sent, and whether it has
 * the person active) or, for a member of the project it has not written yet,
 * the account as it is. The routes below and Bulk share these operations, so
 * a user is created, read, changed and deleted the same way whichever way
 * the identity provider asks.
 * ---------------------------------------------------------------------------
 */

// What a SCIM user's account is read with.
const SCIM_ACCOUNT_SELECT: Select<User> = {
  _id: true,
  email: true,
  name: true,
  createdAt: true,
  updatedAt: true,
};

interface ProjectScimUser {
  account: User;
  record: ProjectSCIMUser | null;
}

// The filters a user list answers (RFC 7644, section 3.4.2.2).
const USER_FILTER_ATTRIBUTES: ReadonlyArray<string> = [
  "userName",
  "externalId",
  "id",
];

const toScimAccount: (account: User) => ScimUserAccount = (
  account: User,
): ScimUserAccount => {
  return {
    id: account.id!,
    email: account.email?.toString() || "",
    name: account.name?.toString() || "",
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
};

// The SCIM user to answer with.
const renderProjectScimUser: (data: {
  req: ExpressRequest;
  projectScimId: string;
  user: ProjectScimUser;
}) => JSONObject = (data: {
  req: ExpressRequest;
  projectScimId: string;
  user: ProjectScimUser;
}): JSONObject => {
  return renderScimUser({
    account: toScimAccount(data.user.account),
    record: data.user.record,
    location: `${getScimBaseUrl({
      req: data.req,
      scimId: data.projectScimId,
      scimType: "project",
    })}/Users/${data.user.account.id!.toString()}`,
  });
};

// The accounts of `records`, beside them. A record whose account is gone is no user.
const withAccounts: (
  records: Array<ProjectSCIMUser>,
) => Promise<Array<ProjectScimUser>> = async (
  records: Array<ProjectSCIMUser>,
): Promise<Array<ProjectScimUser>> => {
  if (records.length === 0) {
    return [];
  }

  const accounts: Array<User> = await UserService.findBy({
    query: {
      _id: QueryHelper.any(
        records.map((record: ProjectSCIMUser): ObjectID => {
          return record.userId!;
        }),
      ),
    },
    select: SCIM_ACCOUNT_SELECT,
    limit: LIMIT_MAX,
    skip: 0,
    props: { isRoot: true },
  });

  const accountsById: Map<string, User> = new Map<string, User>();

  for (const account of accounts) {
    accountsById.set(account.id!.toString().toLowerCase(), account);
  }

  const users: Array<ProjectScimUser> = [];

  for (const record of records) {
    const account: User | undefined = accountsById.get(
      record.userId!.toString().toLowerCase(),
    );

    if (account) {
      users.push({ account: account, record: record });
    }
  }

  return users;
};

/*
 * The SCIM user `userId` names, as this connection sees it, or null: an id
 * that is neither an account it keeps a record of nor a member of the
 * project is no user of this connection, whatever else it is.
 */
const findProjectScimUser: (data: {
  projectId: ObjectID;
  projectScimId: ObjectID;
  userId: string;
}) => Promise<ProjectScimUser | null> = async (data: {
  projectId: ObjectID;
  projectScimId: ObjectID;
  userId: string;
}): Promise<ProjectScimUser | null> => {
  if (!isUuid(data.userId)) {
    return null;
  }

  const userId: ObjectID = new ObjectID(data.userId);

  const record: ProjectSCIMUser | null =
    await ProjectSCIMUserService.findRecord({
      projectScimId: data.projectScimId,
      userId: userId,
    });

  const membership: TeamMember | null = await TeamMemberService.findOneBy({
    query: {
      projectId: data.projectId,
      userId: userId,
    },
    select: {
      userId: true,
      user: SCIM_ACCOUNT_SELECT,
    },
    props: { isRoot: true },
  });

  if (membership?.user) {
    return { account: membership.user, record: record };
  }

  if (!record) {
    return null;
  }

  const account: User | null = await UserService.findOneById({
    id: userId,
    select: SCIM_ACCOUNT_SELECT,
    props: { isRoot: true },
  });

  return account ? { account: account, record: record } : null;
};

/*
 * Every SCIM user of the connection, in an order that holds from one page to
 * the next: the users it keeps a record of, oldest first, then the members
 * of the project it has not written, by when they joined.
 */
const listAllProjectScimUsers: (data: {
  projectId: ObjectID;
  projectScimId: ObjectID;
}) => Promise<Array<ProjectScimUser>> = async (data: {
  projectId: ObjectID;
  projectScimId: ObjectID;
}): Promise<Array<ProjectScimUser>> => {
  const users: Array<ProjectScimUser> = await withAccounts(
    await ProjectSCIMUserService.findRecordsOfConnection(data.projectScimId),
  );

  const listed: Set<string> = new Set<string>(
    users.map((user: ProjectScimUser): string => {
      return user.account.id!.toString().toLowerCase();
    }),
  );

  const memberships: Array<TeamMember> = await TeamMemberService.findBy({
    query: {
      projectId: data.projectId,
    },
    select: {
      userId: true,
      createdAt: true,
      user: SCIM_ACCOUNT_SELECT,
    },
    sort: {
      createdAt: SortOrder.Ascending,
    },
    limit: LIMIT_MAX,
    skip: 0,
    props: { isRoot: true },
  });

  for (const membership of memberships) {
    if (!membership.user?.id) {
      continue;
    }

    const key: string = membership.user.id.toString().toLowerCase();

    if (listed.has(key)) {
      continue;
    }

    listed.add(key);
    users.push({ account: membership.user, record: null });
  }

  return users;
};

// Whether `user` meets one equality of a filter.
const matchesUserFilter: (
  user: ProjectScimUser,
  filter: ScimEqualityFilter,
) => boolean = (user: ProjectScimUser, filter: ScimEqualityFilter): boolean => {
  const text: string | null = getScimFilterText(filter.value);

  if (text === null) {
    return false;
  }

  if (isScimAttribute(filter.attribute, "userName")) {
    const userName: string =
      user.record?.userName || user.account.email?.toString() || "";

    return userName.toLowerCase() === text.toLowerCase();
  }

  if (isScimAttribute(filter.attribute, "externalId")) {
    return user.record?.externalId === text;
  }

  if (isScimAttribute(filter.attribute, "id")) {
    return user.account.id!.toString().toLowerCase() === text.toLowerCase();
  }

  return false;
};

/*
 * The SCIM users that meet every equality of `filters` - all of them when
 * there are none - looked up by the first equality and held to the rest.
 *
 * A lookup never creates anyone: an identity provider asks before it
 * creates, and a user it has not created yet is answered as none (200, an
 * empty list), which is what Okta and Microsoft Entra ID go on to create.
 * Filtering by an attribute OneUptime does not keep is an invalid filter,
 * never "every user".
 */
const listProjectScimUsers: (data: {
  projectId: ObjectID;
  projectScimId: ObjectID;
  filters: Array<ScimEqualityFilter>;
}) => Promise<Array<ProjectScimUser>> = async (data: {
  projectId: ObjectID;
  projectScimId: ObjectID;
  filters: Array<ScimEqualityFilter>;
}): Promise<Array<ProjectScimUser>> => {
  for (const filter of data.filters) {
    const isSupported: boolean = USER_FILTER_ATTRIBUTES.some(
      (name: string): boolean => {
        return isScimAttribute(filter.attribute, name);
      },
    );

    if (!isSupported) {
      throw new SCIMException({
        statusCode: 400,
        scimType: SCIMErrorType.InvalidFilter,
        message: "OneUptime filters users by userName, externalId and id.",
      });
    }
  }

  const first: ScimEqualityFilter | undefined = data.filters[0];

  if (!first) {
    return await listAllProjectScimUsers(data);
  }

  const text: string | null = getScimFilterText(first.value);
  let candidates: Array<ProjectScimUser> = [];

  if (text === null) {
    candidates = [];
  } else if (isScimAttribute(first.attribute, "userName")) {
    candidates = await withAccounts(
      await ProjectSCIMUserService.findRecordsByUserName({
        projectScimId: data.projectScimId,
        userName: text,
      }),
    );

    /*
     * A member of the project the connection has not written is its user
     * by the account's address - as long as the connection keeps no record
     * of the account under another userName.
     */
    if (text.length <= 320 && Email.isValid(text)) {
      const account: User | null = await UserService.findOneBy({
        query: { email: new Email(text) },
        select: SCIM_ACCOUNT_SELECT,
        props: { isRoot: true },
      });

      const alreadyListed: boolean = candidates.some(
        (candidate: ProjectScimUser): boolean => {
          return (
            candidate.account.id!.toString().toLowerCase() ===
            account?.id?.toString().toLowerCase()
          );
        },
      );

      if (account?.id && !alreadyListed) {
        const user: ProjectScimUser | null = await findProjectScimUser({
          projectId: data.projectId,
          projectScimId: data.projectScimId,
          userId: account.id.toString(),
        });

        if (user && !user.record) {
          candidates.push(user);
        }
      }
    }
  } else if (isScimAttribute(first.attribute, "externalId")) {
    candidates = await withAccounts(
      await ProjectSCIMUserService.findRecordsByExternalId({
        projectScimId: data.projectScimId,
        externalId: text,
      }),
    );
  } else {
    const user: ProjectScimUser | null = await findProjectScimUser({
      projectId: data.projectId,
      projectScimId: data.projectScimId,
      userId: text,
    });

    candidates = user ? [user] : [];
  }

  return candidates.filter((user: ProjectScimUser): boolean => {
    return data.filters.every((filter: ScimEqualityFilter): boolean => {
      return matchesUserFilter(user, filter);
    });
  });
};

// A user that exists already: RFC 7644, section 3.3, answers 409 uniqueness.
const userExistsException: (userName: string) => SCIMException = (
  userName: string,
): SCIMException => {
  return new SCIMException({
    statusCode: 409,
    scimType: SCIMErrorType.Uniqueness,
    message: `A user with the userName "${userName}" is already provisioned by this SCIM connection.`,
  });
};

interface CreatedProjectScimUser {
  user: ProjectScimUser;
  email: string;
  name: string;
  userWasCreated: boolean;
  teamsAdded: Array<string>;
}

/*
 * Creates the SCIM user a POST describes: the OneUptime account with its
 * address (or the one that exists), added to the connection's teams unless
 * the identity provider creates the user inactive, and the connection's
 * record of what was sent. A userName the connection has already, or an
 * account it keeps a record of, is a conflict (409).
 */
const createProjectScimUser: (data: {
  projectId: ObjectID;
  projectScimId: ObjectID;
  scimConfig: ProjectSCIM;
  body: unknown;
  executionSteps: Array<string>;
}) => Promise<CreatedProjectScimUser> = async (data: {
  projectId: ObjectID;
  projectScimId: ObjectID;
  scimConfig: ProjectSCIM;
  body: unknown;
  executionSteps: Array<string>;
}): Promise<CreatedProjectScimUser> => {
  const executionSteps: Array<string> = data.executionSteps;
  const scimConfig: ProjectSCIM = data.scimConfig;

  if (!scimConfig.autoProvisionUsers) {
    executionSteps.push("Auto-provisioning is disabled - rejecting request");
    throw new BadRequestException(
      "Auto-provisioning is disabled for this project",
    );
  }

  executionSteps.push("Auto-provisioning is enabled - proceeding");

  const resource: ScimUserResource = readScimUserResource(data.body);
  const email: string | null = getAccountEmail(resource);
  const name: string = getAccountName(resource);

  executionSteps.push(
    `Parsed user data from request: email=${email || "none"}, name=${name || "not provided"}`,
  );

  if (!email) {
    executionSteps.push(
      "Email validation failed - neither userName nor emails is an email address",
    );
    throw new SCIMException({
      statusCode: 400,
      scimType: SCIMErrorType.InvalidValue,
      message:
        "A userName that is an email address is required, or an email address in emails: it is the address the person signs in to OneUptime with.",
    });
  }

  const userName: string = resource.userName || email;

  if (
    (
      await ProjectSCIMUserService.findRecordsByUserName({
        projectScimId: data.projectScimId,
        userName: userName,
      })
    ).length > 0
  ) {
    executionSteps.push(
      `A user with userName ${userName} is already provisioned by this connection - conflict`,
    );
    throw userExistsException(userName);
  }

  executionSteps.push("Checking if user already exists in database");

  let user: User | null = await UserService.findOneBy({
    query: { email: new Email(email) },
    select: SCIM_ACCOUNT_SELECT,
    props: { isRoot: true },
  });

  let userWasCreated: boolean = false;

  if (user) {
    if (
      await ProjectSCIMUserService.findRecord({
        projectScimId: data.projectScimId,
        userId: user.id!,
      })
    ) {
      executionSteps.push(
        `User ${user.id?.toString()} is already provisioned by this connection - conflict`,
      );
      throw userExistsException(userName);
    }

    executionSteps.push(
      `User already exists with ID: ${user.id?.toString()} - will link to project`,
    );

    /*
     * Update user's name if provided in SCIM request and user's name is
     * missing or different -- but only for an account this project already
     * manages (see ProjectSCIMAccountPolicy). Judged before the account is
     * added to any team below.
     */
    const currentName: string = user.name?.toString() || "";
    const mayChangeName: boolean =
      Boolean(name) &&
      currentName !== name &&
      (await ProjectSCIMAccountPolicy.mayChangeName({
        projectId: data.projectId,
        userId: user.id!,
      }));

    if (name && currentName !== name && !mayChangeName) {
      executionSteps.push(
        "Name not updated: this account has not joined this project, belongs to another project, or is a OneUptime administrator",
      );
    }

    if (mayChangeName) {
      executionSteps.push(
        `Updating user name from "${currentName || "(empty)"}" to "${name}"`,
      );
      await UserService.updateOneById({
        id: user.id!,
        data: {
          name: new Name(name),
        },
        props: { isRoot: true },
      });
      user.name = new Name(name);
      executionSteps.push(`User name updated successfully`);
    }
  } else {
    executionSteps.push(
      `User does not exist - creating new user with email: ${email}`,
    );
    user = await UserService.createByEmail({
      email: new Email(email),
      name: name ? new Name(name) : new Name("Unknown"),
      isEmailVerified: true,
      generateRandomPassword: true,
      props: { isRoot: true },
    });
    userWasCreated = true;
    executionSteps.push(
      `New user created successfully with ID: ${user.id?.toString()}`,
    );
  }

  const isActive: boolean = resource.active !== false;
  let teamsAdded: Array<string> = [];

  if (!isActive) {
    executionSteps.push(
      "The identity provider created the user inactive - not added to any team",
    );
  } else if (
    scimConfig.teams &&
    scimConfig.teams.length > 0 &&
    !scimConfig.enablePushGroups
  ) {
    executionSteps.push(
      `Adding user to ${scimConfig.teams.length} configured default teams`,
    );
    const addOutcomes: Array<ProjectSCIMTeamAddOutcome> =
      await handleUserTeamOperations(
        "add",
        data.projectId,
        user.id!,
        scimConfig,
        {
          userWasCreatedByScim: userWasCreated,
        },
      );
    teamsAdded = scimConfig.teams.map((t: Team) => {
      return t.name || t.id?.toString() || "unknown";
    });
    executionSteps.push(
      `User added to teams: ${teamsAdded.join(", ")} (${describeTeamAddOutcomes(addOutcomes)})`,
    );
  } else {
    executionSteps.push(
      scimConfig.enablePushGroups
        ? "Push groups enabled - adding user to 'Unassigned' team until group assignment"
        : "No default teams configured - adding user to 'Unassigned' team",
    );
    const unassigned: { team: Team; outcome: ProjectSCIMTeamAddOutcome } =
      await addUserToUnassignedTeam(data.projectId, user.id!, {
        userWasCreatedByScim: userWasCreated,
      });
    teamsAdded = [UNASSIGNED_TEAM_NAME];
    executionSteps.push(
      `User added to "Unassigned" team (ID: ${unassigned.team.id?.toString()}, ${describeTeamAddOutcomes([unassigned.outcome])})`,
    );
  }

  const record: ProjectSCIMUser = await ProjectSCIMUserService.saveRecord(
    getRecordDataOfScimUserResource({
      resource: { ...resource, userName: userName },
      projectId: data.projectId,
      projectScimId: data.projectScimId,
      userId: user.id!,
      isActive: isActive,
    }),
  );

  executionSteps.push("Recorded the user for this SCIM connection");

  return {
    user: { account: user, record: record },
    email: email,
    name: name,
    userWasCreated: userWasCreated,
    teamsAdded: teamsAdded,
  };
};

type UpdatedProjectScimUser =
  | {
      refused: true;
      missingPlan: PlanType;
      user: ProjectScimUser;
    }
  | {
      refused: false;
      user: ProjectScimUser;
      active: boolean | undefined;
      teamOperationPerformed: string | null;
      fieldsUpdated: Array<string>;
      previousEmail: string;
      previousName: string;
    };

/*
 * Applies a PUT (the whole user) or PATCH (its Operations) to a SCIM user:
 * the connection's record takes what the identity provider sent, and the
 * account changes as far as ProjectSCIMAccountPolicy lets this project
 * change it. An address the policy will not let SCIM give the account - on
 * the hosted service, any - stays on the record, and the account keeps the
 * one it signs in with: SCIM never answers a new address with an error,
 * which an identity provider would keep retrying, and Microsoft Entra ID
 * can quarantine a job for. A deactivation takes the user out of the
 * connection's teams, as it always has, and the user stays, inactive.
 *
 * Below the plan SCIM needs (Utils/SCIMBelowPlan) the request is judged
 * before anything is written, as it always was: a deactivation goes through
 * and changes nothing else, a reactivation or a change of address or name
 * is refused, and the attributes only the record keeps are left as they
 * are.
 */
const updateProjectScimUser: (data: {
  projectId: ObjectID;
  projectScimId: ObjectID;
  scimConfig: ProjectSCIM;
  userId: string;
  method: string;
  body: unknown;
  executionSteps: Array<string>;
  missingPlan: PlanType | null;
}) => Promise<UpdatedProjectScimUser> = async (data: {
  projectId: ObjectID;
  projectScimId: ObjectID;
  scimConfig: ProjectSCIM;
  userId: string;
  method: string;
  body: unknown;
  executionSteps: Array<string>;
  missingPlan: PlanType | null;
}): Promise<UpdatedProjectScimUser> => {
  const executionSteps: Array<string> = data.executionSteps;
  const scimConfig: ProjectSCIM = data.scimConfig;
  const missingPlan: PlanType | null = data.missingPlan;

  executionSteps.push("Looking up the user in this connection");

  const found: ProjectScimUser | null = await findProjectScimUser({
    projectId: data.projectId,
    projectScimId: data.projectScimId,
    userId: data.userId,
  });

  if (!found) {
    executionSteps.push(`User not found in this connection: ${data.userId}`);
    throw new NotFoundException("User not found or not part of this project");
  }

  const userId: ObjectID = found.account.id!;
  const previousEmail: string = found.account.email?.toString() || "";
  const previousName: string = found.account.name?.toString() || "";

  executionSteps.push(`Found existing user: ${previousEmail}`);

  const current: ScimUserResource = found.record
    ? getScimUserResourceOfRecord(found.record)
    : getScimUserResourceOfAccount(toScimAccount(found.account));

  const body: JSONObject =
    data.body && typeof data.body === "object" && !Array.isArray(data.body)
      ? (data.body as JSONObject)
      : {};

  const isPut: boolean = data.method.toUpperCase() === "PUT";

  /*
   * A PATCH's Operations - or, from an identity provider that sends a PATCH
   * as attributes with no Operations, those attributes, replaced, as they
   * always were.
   */
  const operations: unknown = Array.isArray(body["Operations"])
    ? body["Operations"]
    : [{ op: "replace", value: body }];

  const requested: ScimUserResource = isPut
    ? readScimUserResource(body)
    : applyScimUserPatch(current, operations);

  // What the request says of active, when it says anything.
  const active: boolean | undefined = isPut
    ? requested.active
    : applyScimUserPatch({}, operations).active;

  const next: ScimUserResource = {
    ...requested,
    active: active ?? current.active ?? true,
  };

  const email: string | null = getAccountEmail(next);
  const name: string = getAccountName(next);

  executionSteps.push(
    `Parsed update fields - email: ${email || "unchanged"}, name: ${name || "unchanged"}, active: ${active !== undefined ? active : "unchanged"}`,
  );

  /*
   * ProjectSCIMAccountPolicy decides whether this account's profile is this
   * project's to change. Checked before anything is written.
   */
  const isEmailChanging: boolean =
    Boolean(email) &&
    ProjectSCIMAccountPolicy.isEmailChanging({
      currentEmail: previousEmail,
      newEmail: email!,
    });

  const isNameChanging: boolean = Boolean(name) && name !== previousName;

  /*
   * Whether the identity provider's addresses for the person - its userName
   * and emails - are others than the ones the connection has: what below the
   * plan counts as a change of email, whether or not the account would take
   * it (getAccountEmail). The same address in another case, or with spaces
   * around it, is the same address.
   */
  const getAddresses: (resource: ScimUserResource) => string = (
    resource: ScimUserResource,
  ): string => {
    const addresses: Set<string> = new Set<string>();

    for (const address of [
      resource.userName,
      ...(resource.emails || []).map((entry: { value: string }): string => {
        return entry.value;
      }),
    ]) {
      if (typeof address === "string" && address.trim()) {
        addresses.add(address.trim().toLowerCase());
      }
    }

    return Array.from(addresses).sort().join("\n");
  };

  const isAddressChanging: boolean =
    getAddresses(next) !== getAddresses(current);

  /*
   * Whether the new name is this project's to give
   * (ProjectSCIMAccountPolicy.mayChangeName) - read once, and only when it
   * matters.
   */
  let mayChangeNameRead: boolean | null = null;

  const getMayChangeName: () => Promise<boolean> =
    async (): Promise<boolean> => {
      if (mayChangeNameRead === null) {
        mayChangeNameRead =
          isNameChanging &&
          (await ProjectSCIMAccountPolicy.mayChangeName({
            projectId: data.projectId,
            userId: userId,
          }));
      }

      return mayChangeNameRead;
    };

  /*
   * Below the plan SCIM needs (Utils/SCIMBelowPlan), a deactivation goes
   * through and changes nothing else: the person keeps their email and
   * name. Reactivating them - active true, when it would add them to one
   * of the connection's teams they are not in - or changing only their
   * email or name, is refused. An active true that would add them to no
   * team is no reactivation: Okta sends it with every PUT. Nor is an
   * active false a deactivation on a connection that removes no one when
   * it is sent (auto-deprovisioning off, or groups pushed instead): what
   * else it asks is a change on its own. Checked before anything is
   * written, so a refused update changes nothing at all.
   */
  let profileLeftAsItIs: boolean = false;

  if (missingPlan) {
    const belowPlan: ScimUpdateBelowPlan = getScimUserUpdateBelowPlan({
      reactivates:
        active === true &&
        (await wouldActivationAddToTeams({
          projectId: data.projectId,
          userId: userId,
          scimConfig: scimConfig,
        })),
      deactivates:
        active === false &&
        Boolean(scimConfig.autoDeprovisionUsers) &&
        !scimConfig.enablePushGroups,
      isEmailChanging: isEmailChanging || isAddressChanging,
      isNameChanging: await getMayChangeName(),
    });

    if (belowPlan === ScimUpdateBelowPlan.Refused) {
      return { refused: true, missingPlan: missingPlan, user: found };
    }

    if (
      belowPlan === ScimUpdateBelowPlan.Removal &&
      (isEmailChanging || isAddressChanging || (await getMayChangeName()))
    ) {
      executionSteps.push(
        `Below the ${missingPlan} plan the deactivation goes through, and the user's email and name are left as they are`,
      );
    }

    // Below the plan, nothing but active changes: the record keeps the rest.
    profileLeftAsItIs = true;
  }

  let changesEmail: boolean = isEmailChanging && !profileLeftAsItIs;

  if (changesEmail) {
    const emailChangeRefusal: string | null =
      await ProjectSCIMAccountPolicy.getEmailChangeRefusal({
        projectId: data.projectId,
        userId: userId,
      });

    if (emailChangeRefusal) {
      changesEmail = false;
      executionSteps.push(
        `Email change not applied to the OneUptime account: ${emailChangeRefusal} The SCIM user keeps the address the identity provider sent.`,
      );
    }
  }

  const mayChangeName: boolean = await getMayChangeName();
  const changesName: boolean = mayChangeName && !profileLeftAsItIs;

  if (isNameChanging && !mayChangeName) {
    executionSteps.push(
      "Name change skipped: this account has not joined this project, belongs to another project, or is a OneUptime administrator",
    );
  }

  let teamOperationPerformed: string | null = null;

  if (active === false && !scimConfig.autoDeprovisionUsers) {
    executionSteps.push(
      "Auto-deprovisioning is disabled, user will not be removed from teams",
    );
  }

  if (
    active === false &&
    scimConfig.autoDeprovisionUsers &&
    !scimConfig.enablePushGroups
  ) {
    executionSteps.push(
      "User marked as inactive, removing from configured teams",
    );
    await handleUserTeamOperations(
      "remove",
      data.projectId,
      userId,
      scimConfig,
    );
    teamOperationPerformed = "removed_from_teams";
    executionSteps.push("User successfully removed from configured teams");
  }

  /*
   * Handle user activation by adding to teams - not below the plan, where
   * an activation that got this far adds no one (see above), and must not
   * add anyone another request removed meanwhile.
   */
  if (active === true && !scimConfig.enablePushGroups && missingPlan) {
    executionSteps.push(
      `Below the ${missingPlan} plan the user is not added to the configured teams`,
    );
  }

  if (active === true && !scimConfig.enablePushGroups && !missingPlan) {
    executionSteps.push("User marked as active, adding to configured teams");
    const addOutcomes: Array<ProjectSCIMTeamAddOutcome> =
      await handleUserTeamOperations("add", data.projectId, userId, scimConfig);
    teamOperationPerformed = "added_to_teams";
    executionSteps.push(
      `Configured teams: ${describeTeamAddOutcomes(addOutcomes)}`,
    );
  }

  const fieldsUpdated: Array<string> = [];
  let account: User = found.account;

  if (changesEmail || changesName) {
    const updateData: { email?: Email; name?: Name } = {};

    if (changesEmail) {
      updateData.email = new Email(email!);
      fieldsUpdated.push("email");
    }

    if (changesName) {
      updateData.name = new Name(name);
      fieldsUpdated.push("name");
    }

    executionSteps.push(`Updating user record in database`);

    await UserService.updateOneById({
      id: userId,
      data: updateData,
      props: { isRoot: true },
    });

    executionSteps.push("User record updated successfully");

    account =
      (await UserService.findOneById({
        id: userId,
        select: SCIM_ACCOUNT_SELECT,
        props: { isRoot: true },
      })) || account;
  }

  const record: ProjectSCIMUser = await ProjectSCIMUserService.saveRecord(
    getRecordDataOfScimUserResource({
      resource: profileLeftAsItIs ? current : next,
      projectId: data.projectId,
      projectScimId: data.projectScimId,
      userId: userId,
      isActive: next.active !== false,
    }),
  );

  executionSteps.push("Recorded what the identity provider sent");

  return {
    refused: false,
    user: { account: account, record: record },
    active: active,
    teamOperationPerformed: teamOperationPerformed,
    fieldsUpdated: fieldsUpdated,
    previousEmail: previousEmail,
    previousName: previousName,
  };
};

/*
 * Deletes a SCIM user: out of the teams the connection put them in - its
 * default teams and the "Unassigned" team; with Push Groups, the teams its
 * groups manage are the identity provider's to change - and the
 * connection's record of them gone, so the identity provider finds them no
 * more (404). The OneUptime account stays.
 */
const deleteProjectScimUser: (data: {
  projectId: ObjectID;
  projectScimId: ObjectID;
  scimConfig: ProjectSCIM;
  userId: string;
  executionSteps: Array<string>;
}) => Promise<{
  user: ProjectScimUser;
  teamsRemoved: Array<string>;
}> = async (data: {
  projectId: ObjectID;
  projectScimId: ObjectID;
  scimConfig: ProjectSCIM;
  userId: string;
  executionSteps: Array<string>;
}): Promise<{ user: ProjectScimUser; teamsRemoved: Array<string> }> => {
  const executionSteps: Array<string> = data.executionSteps;
  const scimConfig: ProjectSCIM = data.scimConfig;

  const found: ProjectScimUser | null = await findProjectScimUser({
    projectId: data.projectId,
    projectScimId: data.projectScimId,
    userId: data.userId,
  });

  if (!found) {
    executionSteps.push(`User not found in this connection: ${data.userId}`);
    throw new NotFoundException("User not found or not part of this project");
  }

  if (!scimConfig.autoDeprovisionUsers) {
    executionSteps.push("Auto-deprovisioning is disabled - rejecting request");
    throw new BadRequestException(
      "Auto-deprovisioning is disabled for this project",
    );
  }

  executionSteps.push("Auto-deprovisioning is enabled - proceeding");

  const userId: ObjectID = found.account.id!;
  const teamsRemoved: Array<string> = [];

  if (
    !scimConfig.enablePushGroups &&
    scimConfig.teams &&
    scimConfig.teams.length > 0
  ) {
    executionSteps.push(
      `Removing user from ${scimConfig.teams.length} configured teams`,
    );
    await handleUserTeamOperations(
      "remove",
      data.projectId,
      userId,
      scimConfig,
    );
    teamsRemoved.push(
      ...scimConfig.teams.map((t: Team) => {
        return t.name || t.id?.toString() || "unknown";
      }),
    );
  }

  if (scimConfig.enablePushGroups) {
    executionSteps.push(
      "Push groups enabled - the teams its groups manage are left to group provisioning",
    );
  }

  await removeUserFromUnassignedTeam(data.projectId, userId);
  teamsRemoved.push(UNASSIGNED_TEAM_NAME);

  await ProjectSCIMUserService.deleteRecord({
    projectScimId: data.projectScimId,
    userId: userId,
  });

  executionSteps.push(
    `User removed from teams: ${teamsRemoved.join(", ")}, and this connection's record of them deleted`,
  );

  return { user: found, teamsRemoved: teamsRemoved };
};

/*
 * Answers a project SCIM request that failed with `err` in the SCIM error
 * format, with the status it calls for (sendScimError), and writes it to the
 * connection's SCIM log with that status. A user or group the identity
 * provider looked for and that is not here (404) is an answer it expects,
 * not an error.
 */
const failProjectScimRequest: (data: {
  req: ExpressRequest;
  res: ExpressResponse;
  err: unknown;
  operationType: string;
  executionSteps: Array<string>;
  requestBody?: JSONObject | undefined;
  queryParams?: JSONObject | undefined;
  userInfo?: JSONObject | undefined;
  groupInfo?: JSONObject | undefined;
  additionalContext?: JSONObject | undefined;
}) => void = (data: {
  req: ExpressRequest;
  res: ExpressResponse;
  err: unknown;
  operationType: string;
  executionSteps: Array<string>;
  requestBody?: JSONObject | undefined;
  queryParams?: JSONObject | undefined;
  userInfo?: JSONObject | undefined;
  groupInfo?: JSONObject | undefined;
  additionalContext?: JSONObject | undefined;
}): void => {
  const status: {
    statusCode: number;
    scimType: SCIMErrorType | undefined;
    message: string;
  } = getScimErrorStatus(data.err);

  data.executionSteps.push(`Error occurred: ${(data.err as Error)?.message}`);

  const bearerData: JSONObject | undefined = (data.req as OneUptimeRequest)
    .bearerTokenData as JSONObject | undefined;

  if (bearerData?.["projectId"]) {
    void createProjectSCIMLog({
      projectId: bearerData["projectId"] as ObjectID,
      projectScimId: new ObjectID(data.req.params["projectScimId"]!),
      operationType: data.operationType,
      status:
        status.statusCode === 404 ? SCIMLogStatus.Success : SCIMLogStatus.Error,
      statusMessage: status.message,
      httpMethod: data.req.method,
      requestPath: data.req.path,
      httpStatusCode: status.statusCode,
      requestBody: data.requestBody,
      responseBody: generateSCIMErrorResponse(
        status.statusCode,
        status.message,
        status.scimType,
      ),
      queryParams: data.queryParams,
      steps: data.executionSteps,
      userInfo: data.userInfo,
      groupInfo: data.groupInfo,
      additionalContext: data.additionalContext,
    });
  }

  if (status.statusCode >= 500) {
    logger.error(
      data.err,
      getLogAttributesFromRequest(data.req as RequestLike),
    );
  }

  sendScimError(data.req, data.res, data.err);
};

// The request's body, when it is a JSON object, for the SCIM log.
const getRequestBody: (req: ExpressRequest) => JSONObject | undefined = (
  req: ExpressRequest,
): JSONObject | undefined => {
  const body: unknown = req.body;

  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as JSONObject)
    : undefined;
};

// SCIM Service Provider Configuration - GET /scim/v2/ServiceProviderConfig
router.get(
  "/scim/v2/:projectScimId/ServiceProviderConfig",
  LicensedFeatureGate.forScim,
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      logger.debug(
        `Project SCIM ServiceProviderConfig - scimId: ${req.params["projectScimId"]!}`,
        getLogAttributesFromRequest(req as any),
      );

      const serviceProviderConfig: JSONObject = generateServiceProviderConfig(
        req,
        req.params["projectScimId"]!,
        "project",
        DocsClientUrl.toString() + "/identity/scim",
      );

      logger.debug(
        "Project SCIM ServiceProviderConfig response prepared successfully",
        getLogAttributesFromRequest(req as any),
      );
      return sendScimResponse(req, res, serviceProviderConfig);
    } catch (err) {
      logger.error(err, getLogAttributesFromRequest(req as RequestLike));
      return sendScimError(req, res, err);
    }
  },
);

// SCIM Schemas endpoint - GET /scim/v2/Schemas
router.get(
  "/scim/v2/:projectScimId/Schemas",
  LicensedFeatureGate.forScim,
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      logger.debug(
        `Project SCIM Schemas - scimId: ${req.params["projectScimId"]!}`,
        getLogAttributesFromRequest(req as any),
      );

      const schemasResponse: JSONObject = generateSchemasResponse(
        req,
        req.params["projectScimId"]!,
        "project",
      );

      logger.debug(
        "Project SCIM Schemas response prepared successfully",
        getLogAttributesFromRequest(req as any),
      );
      return sendScimResponse(req, res, schemasResponse);
    } catch (err) {
      logger.error(err, getLogAttributesFromRequest(req as RequestLike));
      return sendScimError(req, res, err);
    }
  },
);

// SCIM ResourceTypes endpoint - GET /scim/v2/ResourceTypes
router.get(
  "/scim/v2/:projectScimId/ResourceTypes",
  LicensedFeatureGate.forScim,
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      logger.debug(
        `Project SCIM ResourceTypes - scimId: ${req.params["projectScimId"]!}`,
        getLogAttributesFromRequest(req as any),
      );

      const resourceTypesResponse: JSONObject = generateResourceTypesResponse(
        req,
        req.params["projectScimId"]!,
        "project",
      );

      logger.debug(
        "Project SCIM ResourceTypes response prepared successfully",
        getLogAttributesFromRequest(req as any),
      );
      return sendScimResponse(req, res, resourceTypesResponse);
    } catch (err) {
      logger.error(err, getLogAttributesFromRequest(req as RequestLike));
      return sendScimError(req, res, err);
    }
  },
);

// SCIM Bulk Operations endpoint - POST /scim/v2/Bulk
router.post(
  "/scim/v2/:projectScimId/Bulk",
  LicensedFeatureGate.forScim,
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    const executionSteps: string[] = [];
    executionSteps.push("Received SCIM BulkOperation request");
    const usersCreated: number = 0;
    const usersUpdated: number = 0;
    const usersDeleted: number = 0;
    const groupsCreated: number = 0;
    const groupsUpdated: number = 0;
    const groupsDeleted: number = 0;

    try {
      logger.debug(
        `Project SCIM Bulk request - scimId: ${req.params["projectScimId"]!}`,
        getLogAttributesFromRequest(req as any),
      );

      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const scimConfig: ProjectSCIM = bearerData["scimConfig"] as ProjectSCIM;
      const projectScimId: string = req.params["projectScimId"]!;

      executionSteps.push("Authenticated and extracted project context");

      // Validate the bulk request
      executionSteps.push("Validating bulk request");
      const validation: { valid: boolean; error?: string } =
        validateBulkRequest(req.body, 1000);
      if (!validation.valid) {
        logger.debug(
          `Project SCIM Bulk - validation failed: ${validation.error}`,
          getLogAttributesFromRequest(req as any),
        );
        executionSteps.push(`Validation failed: ${validation.error}`);
        void createProjectSCIMLog({
          projectId: projectId,
          projectScimId: new ObjectID(projectScimId),
          operationType: "BulkOperation",
          status: SCIMLogStatus.Error,
          statusMessage: validation.error,
          httpMethod: "POST",
          requestPath: req.path,
          httpStatusCode: 400,
          requestBody: req.body,
          steps: executionSteps,
        });
        return sendScimResponse(
          req,
          res,
          generateSCIMErrorResponse(
            400,
            validation.error!,
            SCIMErrorType.InvalidValue,
          ),
          400,
        );
      }
      executionSteps.push("Bulk request validation passed");

      const operations: JSONObject[] = req.body["Operations"] as JSONObject[];
      const failOnErrors: number = (req.body["failOnErrors"] as number) || 0;
      const results: SCIMBulkOperationResponse[] = [];
      let errorCount: number = 0;

      executionSteps.push(
        `Processing ${operations.length} operations (failOnErrors: ${failOnErrors})`,
      );

      logger.debug(
        `Project SCIM Bulk - processing ${operations.length} operations`,
        getLogAttributesFromRequest(req as any),
      );

      for (const operation of operations) {
        const method: string = (operation["method"] as string).toUpperCase();
        const path: string = operation["path"] as string;
        const bulkId: string | undefined = operation["bulkId"] as
          | string
          | undefined;
        const data: JSONObject | undefined = operation["data"] as
          | JSONObject
          | undefined;

        const { resourceType, resourceId } = parseBulkOperationPath(path);

        let operationResult: SCIMBulkOperationResponse = {
          method: method,
          bulkId: bulkId,
          status: "400",
        };

        try {
          // Handle Users operations
          if (resourceType === "Users") {
            // The same operations the Users routes run.
            const userLocation: string = `${getScimBaseUrl({
              req: req,
              scimId: projectScimId,
              scimType: "project",
            })}/Users`;

            if (method === "POST") {
              const created: CreatedProjectScimUser =
                await createProjectScimUser({
                  projectId: projectId,
                  projectScimId: new ObjectID(projectScimId),
                  scimConfig: scimConfig,
                  body: data,
                  executionSteps: executionSteps,
                });

              operationResult = {
                method: method,
                bulkId: bulkId,
                status: "201",
                location: `${userLocation}/${created.user.account.id?.toString()}`,
                response: renderProjectScimUser({
                  req: req,
                  projectScimId: projectScimId,
                  user: created.user,
                }),
              };
            } else if (method === "PUT" || method === "PATCH") {
              if (!resourceId) {
                throw new BadRequestException("User ID is required");
              }

              /*
               * Below the plan the door lets no Bulk PUT or PATCH through;
               * were one to get here, it is judged as the routes judge it.
               */
              const outcome: UpdatedProjectScimUser =
                await updateProjectScimUser({
                  projectId: projectId,
                  projectScimId: new ObjectID(projectScimId),
                  scimConfig: scimConfig,
                  userId: resourceId,
                  method: method,
                  body: data,
                  executionSteps: executionSteps,
                  missingPlan: getScimMissingPlan(req),
                });

              if (outcome.refused) {
                throw new SCIMException({
                  statusCode: SCIM_BELOW_PLAN_STATUS,
                  message: getScimStoppedMessage(outcome.missingPlan),
                });
              }

              operationResult = {
                method: method,
                bulkId: bulkId,
                status: "200",
                location: `${userLocation}/${resourceId}`,
                response: renderProjectScimUser({
                  req: req,
                  projectScimId: projectScimId,
                  user: outcome.user,
                }),
              };
            } else if (method === "DELETE") {
              if (!resourceId) {
                throw new BadRequestException("User ID is required");
              }

              await deleteProjectScimUser({
                projectId: projectId,
                projectScimId: new ObjectID(projectScimId),
                scimConfig: scimConfig,
                userId: resourceId,
                executionSteps: executionSteps,
              });

              operationResult = {
                method: method,
                bulkId: bulkId,
                status: "204",
                location: `${userLocation}/${resourceId}`,
              };
            }
          }
          // Handle Groups operations
          else if (resourceType === "Groups") {
            if (method === "POST") {
              // Create Group
              const displayName: string = data!["displayName"] as string;

              if (!displayName) {
                throw new BadRequestException("displayName is required");
              }

              // Check if team already exists
              const existingTeam: Team | null = await TeamService.findOneBy({
                query: {
                  projectId: projectId,
                  name: displayName,
                },
                select: {
                  _id: true,
                  name: true,
                  createdAt: true,
                  updatedAt: true,
                  projectId: true,
                },
                props: { isRoot: true },
              });

              let targetTeam: Team;

              if (existingTeam) {
                targetTeam = existingTeam;
              } else {
                // Create new team
                const team: Team = new Team();
                team.projectId = projectId;
                team.name = displayName;
                team.isTeamEditable = true;
                team.isTeamDeleteable = true;
                team.shouldHaveAtLeastOneMember = false;

                targetTeam = await TeamService.create({
                  data: team,
                  props: { isRoot: true },
                });
              }

              // Handle members if provided
              const members: Array<SCIMMember> =
                (data!["members"] as Array<SCIMMember>) || [];
              await addGroupMembersToTeam({
                projectId: projectId,
                teamId: targetTeam.id!,
                members: members,
              });

              const groupResponse: JSONObject = await formatTeamForSCIM({
                req: req,
                team: targetTeam,
                projectScimId: projectScimId,
              });

              operationResult = {
                method: method,
                bulkId: bulkId,
                status: existingTeam ? "200" : "201",
                location: `/scim/v2/${projectScimId}/Groups/${targetTeam.id?.toString()}`,
                response: groupResponse,
              };
            } else if (method === "PUT") {
              // Update Group (Replace)
              if (!resourceId) {
                throw new BadRequestException("Group ID is required");
              }

              const groupId: ObjectID = new ObjectID(resourceId);

              // Check if team exists
              const team: Team | null = await TeamService.findOneBy({
                query: {
                  projectId: projectId,
                  _id: groupId,
                },
                select: {
                  _id: true,
                  name: true,
                  createdAt: true,
                  updatedAt: true,
                  projectId: true,
                },
                props: { isRoot: true },
              });

              if (!team) {
                throw new NotFoundException(
                  "Group not found or not part of this project",
                );
              }

              /*
               * Below the plan the door lets no Bulk PUT through; were one
               * to get here, it would take access away only, as the PUT
               * route does: removals only, and no rename.
               */
              const bulkMissingPlan: PlanType | null = getScimMissingPlan(req);

              // Update team name if provided
              const displayName: string = data!["displayName"] as string;
              if (
                !bulkMissingPlan &&
                displayName &&
                displayName !== team.name
              ) {
                await TeamService.updateOneById({
                  id: team.id!,
                  data: { name: displayName },
                  props: { isRoot: true },
                });
              }

              // Handle members update - replace all members
              const members: Array<SCIMMember> =
                (data!["members"] as Array<SCIMMember>) || [];

              await replaceGroupMembersOfTeam({
                projectId: projectId,
                teamId: team.id!,
                members: members,
                removeOnly: Boolean(bulkMissingPlan),
              });

              // Fetch updated team
              const updatedTeam: Team | null = await TeamService.findOneById({
                id: team.id!,
                select: {
                  _id: true,
                  name: true,
                  createdAt: true,
                  updatedAt: true,
                  projectId: true,
                },
                props: { isRoot: true },
              });

              const groupResponse: JSONObject = await formatTeamForSCIM({
                req: req,
                team: updatedTeam || team,
                projectScimId: projectScimId,
              });

              operationResult = {
                method: method,
                bulkId: bulkId,
                status: "200",
                location: `/scim/v2/${projectScimId}/Groups/${resourceId}`,
                response: groupResponse,
              };
            } else if (method === "PATCH") {
              // Patch Group
              if (!resourceId) {
                throw new BadRequestException("Group ID is required");
              }

              const groupId: ObjectID = new ObjectID(resourceId);

              // Check if team exists
              const team: Team | null = await TeamService.findOneBy({
                query: {
                  projectId: projectId,
                  _id: groupId,
                },
                select: {
                  _id: true,
                  name: true,
                  createdAt: true,
                  updatedAt: true,
                  projectId: true,
                },
                props: { isRoot: true },
              });

              if (!team) {
                throw new NotFoundException(
                  "Group not found or not part of this project",
                );
              }

              // Handle SCIM patch operations, as the PATCH route does.
              await applyGroupPatchActions({
                projectId: projectId,
                team: team,
                actions: planScimGroupPatch(data!["Operations"]),
                executionSteps: executionSteps,
                req: req,
                removeOnly: Boolean(getScimMissingPlan(req)),
              });

              // Fetch updated team
              const updatedTeam: Team | null = await TeamService.findOneById({
                id: team.id!,
                select: {
                  _id: true,
                  name: true,
                  createdAt: true,
                  updatedAt: true,
                  projectId: true,
                },
                props: { isRoot: true },
              });

              const groupResponse: JSONObject = await formatTeamForSCIM({
                req: req,
                team: updatedTeam || team,
                projectScimId: projectScimId,
              });

              operationResult = {
                method: method,
                bulkId: bulkId,
                status: "200",
                location: `/scim/v2/${projectScimId}/Groups/${resourceId}`,
                response: groupResponse,
              };
            } else if (method === "DELETE") {
              // Delete Group
              if (!resourceId) {
                throw new BadRequestException("Group ID is required");
              }

              const groupId: ObjectID = new ObjectID(resourceId);

              // Check if team exists
              const team: Team | null = await TeamService.findOneBy({
                query: {
                  projectId: projectId,
                  _id: groupId,
                },
                select: {
                  _id: true,
                  name: true,
                  isTeamDeleteable: true,
                },
                props: { isRoot: true },
              });

              if (!team) {
                throw new NotFoundException(
                  "Group not found or not part of this project",
                );
              }

              if (!team.isTeamDeleteable) {
                throw new BadRequestException("This group cannot be deleted");
              }

              // Remove all team members first
              await TeamMemberService.deleteBy({
                query: {
                  projectId: projectId,
                  teamId: team.id!,
                },
                limit: LIMIT_MAX,
                skip: 0,
                props: { isRoot: true },
              });

              // Delete the team
              await TeamService.deleteBy({
                query: {
                  projectId: projectId,
                  _id: team.id!,
                },
                limit: LIMIT_MAX,
                skip: 0,
                props: { isRoot: true },
              });

              operationResult = {
                method: method,
                bulkId: bulkId,
                status: "204",
                location: `/scim/v2/${projectScimId}/Groups/${resourceId}`,
              };
            }
          } else {
            throw new BadRequestException(
              `Unknown resource type: ${resourceType}`,
            );
          }
        } catch (err: unknown) {
          errorCount++;

          // Each operation fails as the route it stands for would.
          const failure: {
            statusCode: number;
            scimType: SCIMErrorType | undefined;
            message: string;
          } = getScimErrorStatus(err);

          operationResult = {
            method: method,
            bulkId: bulkId,
            status: failure.statusCode.toString(),
            response: generateSCIMErrorResponse(
              failure.statusCode,
              failure.message,
              failure.scimType,
            ),
          };

          logger.debug(
            `Project SCIM Bulk - operation failed: ${(err as Error)?.message}`,
            getLogAttributesFromRequest(req as any),
          );

          // Check if we should stop processing due to failOnErrors
          if (failOnErrors > 0 && errorCount >= failOnErrors) {
            logger.debug(
              `Project SCIM Bulk - stopping due to failOnErrors threshold (${failOnErrors})`,
              getLogAttributesFromRequest(req as any),
            );
            results.push(operationResult);
            break;
          }
        }

        results.push(operationResult);
      }

      logger.debug(
        `Project SCIM Bulk - completed processing ${results.length} operations with ${errorCount} errors`,
        getLogAttributesFromRequest(req as any),
      );
      executionSteps.push(
        `Completed processing ${results.length} operations with ${errorCount} errors`,
      );
      executionSteps.push(
        `Users: ${usersCreated} created, ${usersUpdated} updated, ${usersDeleted} deleted`,
      );
      executionSteps.push(
        `Groups: ${groupsCreated} created, ${groupsUpdated} updated, ${groupsDeleted} deleted`,
      );

      const bulkResponse: JSONObject = generateBulkResponse(results);

      // Log the bulk operation
      void createProjectSCIMLog({
        projectId: projectId,
        projectScimId: new ObjectID(projectScimId),
        operationType: "BulkOperation",
        status: errorCount > 0 ? SCIMLogStatus.Warning : SCIMLogStatus.Success,
        statusMessage: `Processed ${results.length} operations with ${errorCount} errors`,
        httpMethod: "POST",
        requestPath: req.path,
        httpStatusCode: 200,
        requestBody: req.body,
        responseBody: bulkResponse,
        steps: executionSteps,
        additionalContext: {
          totalOperations: operations.length,
          successfulOperations: results.length - errorCount,
          failedOperations: errorCount,
          failOnErrors: failOnErrors,
          usersCreated: usersCreated,
          usersUpdated: usersUpdated,
          usersDeleted: usersDeleted,
          groupsCreated: groupsCreated,
          groupsUpdated: groupsUpdated,
          groupsDeleted: groupsDeleted,
        },
      });

      return sendScimResponse(req, res, bulkResponse);
    } catch (err) {
      return failProjectScimRequest({
        req: req,
        res: res,
        err: err,
        operationType: "BulkOperation",
        executionSteps: executionSteps,
        requestBody: getRequestBody(req),
      });
    }
  },
);

// Basic Users endpoint - GET /scim/v2/Users
router.get(
  "/scim/v2/:projectScimId/Users",
  LicensedFeatureGate.forScim,
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    const executionSteps: string[] = [];
    executionSteps.push("Received SCIM ListUsers request");
    const filter: unknown = req.query["filter"];
    const queryParams: JSONObject = {
      filter: typeof filter === "string" ? filter : null,
      startIndex: (req.query["startIndex"] as string) || null,
      count: (req.query["count"] as string) || null,
    };

    try {
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const scimConfig: ProjectSCIM = bearerData["scimConfig"] as ProjectSCIM;
      const projectScimId: string = req.params["projectScimId"]!;

      executionSteps.push("Authenticated and extracted project context");

      const { startIndex, count } = parseSCIMQueryParams(req);

      if (filter !== undefined && typeof filter !== "string") {
        throw new SCIMException({
          statusCode: 400,
          scimType: SCIMErrorType.InvalidFilter,
          message: "A list of users takes one filter.",
        });
      }

      const filters: Array<ScimEqualityFilter> = filter
        ? parseScimFilter(filter)
        : [];

      executionSteps.push(
        `Parsed query params: startIndex=${startIndex}, count=${count}, filter=${filter || "none"}`,
      );

      const users: Array<ProjectScimUser> = await listProjectScimUsers({
        projectId: projectId,
        projectScimId: new ObjectID(projectScimId),
        filters: filters,
      });

      executionSteps.push(`Found ${users.length} matching users`);

      // startIndex is 1-based (RFC 7644, section 3.4.2.4).
      const page: Array<ProjectScimUser> = users.slice(
        startIndex - 1,
        startIndex - 1 + count,
      );

      const responseBody: JSONObject = generateUsersListResponse(
        page.map((user: ProjectScimUser): JSONObject => {
          return renderProjectScimUser({
            req: req,
            projectScimId: projectScimId,
            user: user,
          });
        }),
        startIndex,
        users.length,
      );

      executionSteps.push(
        `Returning ${page.length} users from index ${startIndex}`,
      );

      void createProjectSCIMLog({
        projectId: projectId,
        projectScimId: new ObjectID(projectScimId),
        operationType: "ListUsers",
        status: SCIMLogStatus.Success,
        httpMethod: "GET",
        requestPath: req.path,
        httpStatusCode: 200,
        responseBody: responseBody,
        queryParams: queryParams,
        steps: executionSteps,
        additionalContext: {
          totalResults: users.length,
          returnedUsersCount: page.length,
          autoProvisionEnabled: Boolean(scimConfig.autoProvisionUsers),
          pushGroupsEnabled: Boolean(scimConfig.enablePushGroups),
        },
      });

      return sendScimResponse(req, res, responseBody);
    } catch (err) {
      return failProjectScimRequest({
        req: req,
        res: res,
        err: err,
        operationType: "ListUsers",
        executionSteps: executionSteps,
        queryParams: queryParams,
      });
    }
  },
);

// Get Individual User - GET /scim/v2/Users/{id}
router.get(
  "/scim/v2/:projectScimId/Users/:userId",
  LicensedFeatureGate.forScim,
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    const executionSteps: string[] = [];
    executionSteps.push("Received SCIM GetUser request");

    try {
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const projectScimId: string = req.params["projectScimId"]!;
      const userId: string = req.params["userId"]!;

      executionSteps.push("Authenticated and extracted project context");
      executionSteps.push(`Looking up user with ID: ${userId}`);

      const user: ProjectScimUser | null = await findProjectScimUser({
        projectId: projectId,
        projectScimId: new ObjectID(projectScimId),
        userId: userId,
      });

      if (!user) {
        executionSteps.push(`User not found in this connection: ${userId}`);
        throw new NotFoundException(
          "User not found or not part of this project",
        );
      }

      executionSteps.push(`Found user: ${user.account.email?.toString()}`);

      const responseBody: JSONObject = renderProjectScimUser({
        req: req,
        projectScimId: projectScimId,
        user: user,
      });

      void createProjectSCIMLog({
        projectId: projectId,
        projectScimId: new ObjectID(projectScimId),
        operationType: "GetUser",
        status: SCIMLogStatus.Success,
        httpMethod: "GET",
        requestPath: req.path,
        httpStatusCode: 200,
        affectedUserEmail: user.account.email?.toString(),
        responseBody: responseBody,
        steps: executionSteps,
        userInfo: {
          userId: user.account.id?.toString(),
          email: user.account.email?.toString(),
          name: user.account.name?.toString(),
          active: user.record ? user.record.isActive !== false : true,
        },
      });

      return sendScimResponse(req, res, responseBody);
    } catch (err) {
      return failProjectScimRequest({
        req: req,
        res: res,
        err: err,
        operationType: "GetUser",
        executionSteps: executionSteps,
        additionalContext: {
          requestedUserId: req.params["userId"] || null,
        },
      });
    }
  },
);

const handleUserUpdate: (
  req: ExpressRequest,
  res: ExpressResponse,
) => Promise<void> = async (
  req: ExpressRequest,
  res: ExpressResponse,
): Promise<void> => {
  const executionSteps: string[] = [];
  executionSteps.push(`Received SCIM UpdateUser request (${req.method})`);

  try {
    const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
    const bearerData: JSONObject =
      oneuptimeRequest.bearerTokenData as JSONObject;
    const projectId: ObjectID = bearerData["projectId"] as ObjectID;
    const scimConfig: ProjectSCIM = bearerData["scimConfig"] as ProjectSCIM;
    const projectScimId: string = req.params["projectScimId"]!;

    executionSteps.push("Authenticated and extracted project context");
    executionSteps.push(`Target user ID: ${req.params["userId"]}`);

    const outcome: UpdatedProjectScimUser = await updateProjectScimUser({
      projectId: projectId,
      projectScimId: new ObjectID(projectScimId),
      scimConfig: scimConfig,
      userId: req.params["userId"]!,
      method: req.method,
      body: req.body,
      executionSteps: executionSteps,
      missingPlan: getScimMissingPlan(req),
    });

    if (outcome.refused) {
      refuseBelowPlan({
        req: req,
        res: res,
        missingPlan: outcome.missingPlan,
        projectId: projectId,
        operationType: "UpdateUser",
        reason:
          "the update would reactivate the user, or only change their email or name",
        executionSteps: executionSteps,
        requestBody: getRequestBody(req),
        affectedUserEmail: outcome.user.account.email?.toString(),
        userInfo: {
          userId: outcome.user.account.id?.toString(),
          email: outcome.user.account.email?.toString(),
          name: outcome.user.account.name?.toString(),
        },
      });

      return;
    }

    const responseBody: JSONObject = renderProjectScimUser({
      req: req,
      projectScimId: projectScimId,
      user: outcome.user,
    });

    executionSteps.push("Formatted updated user for SCIM response");

    void createProjectSCIMLog({
      projectId: projectId,
      projectScimId: new ObjectID(projectScimId),
      operationType: "UpdateUser",
      status: SCIMLogStatus.Success,
      httpMethod: req.method,
      requestPath: req.path,
      httpStatusCode: 200,
      affectedUserEmail: outcome.user.account.email?.toString(),
      requestBody: getRequestBody(req),
      responseBody: responseBody,
      steps: executionSteps,
      userInfo: {
        userId: outcome.user.account.id?.toString(),
        email: outcome.user.account.email?.toString(),
        name: outcome.user.account.name?.toString(),
        previousEmail: outcome.previousEmail,
        previousName: outcome.previousName,
      },
      additionalContext: {
        httpMethod: req.method,
        activeStatus: outcome.active === undefined ? null : outcome.active,
        teamOperationPerformed: outcome.teamOperationPerformed,
        pushGroupsEnabled: Boolean(scimConfig.enablePushGroups),
        fieldsUpdated: outcome.fieldsUpdated,
      },
    });

    return sendScimResponse(req, res, responseBody);
  } catch (err) {
    return failProjectScimRequest({
      req: req,
      res: res,
      err: err,
      operationType: "UpdateUser",
      executionSteps: executionSteps,
      requestBody: getRequestBody(req),
      additionalContext: {
        requestedUserId: req.params["userId"] || null,
      },
    });
  }
};

// Update User - PUT /scim/v2/Users/{id}
router.put(
  "/scim/v2/:projectScimId/Users/:userId",
  LicensedFeatureGate.forScim,
  SCIMMiddleware.isAuthorizedSCIMRequest,
  handleUserUpdate,
);

// Update User - PATCH /scim/v2/Users/{id}
router.patch(
  "/scim/v2/:projectScimId/Users/:userId",
  LicensedFeatureGate.forScim,
  SCIMMiddleware.isAuthorizedSCIMRequest,
  handleUserUpdate,
);

// Groups endpoint - GET /scim/v2/Groups
router.get(
  "/scim/v2/:projectScimId/Groups",
  LicensedFeatureGate.forScim,
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    const executionSteps: string[] = [];
    executionSteps.push("Received SCIM ListGroups request");
    const filter: unknown = req.query["filter"];
    const queryParams: JSONObject = {
      filter: typeof filter === "string" ? filter : null,
      startIndex: (req.query["startIndex"] as string) || null,
      count: (req.query["count"] as string) || null,
      excludedAttributes: (req.query["excludedAttributes"] as string) || null,
    };

    try {
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const projectScimId: string = req.params["projectScimId"]!;

      executionSteps.push("Authenticated and extracted project context");

      const { startIndex, count } = parseSCIMQueryParams(req);

      if (filter !== undefined && typeof filter !== "string") {
        throw new SCIMException({
          statusCode: 400,
          scimType: SCIMErrorType.InvalidFilter,
          message: "A list of groups takes one filter.",
        });
      }

      const filters: Array<ScimEqualityFilter> = filter
        ? parseScimFilter(filter)
        : [];
      const includeMembers: boolean = includesGroupMembers(req);

      executionSteps.push(
        `Parsed query params: startIndex=${startIndex}, count=${count}, filter=${filter || "none"}, members ${includeMembers ? "included" : "excluded"}`,
      );

      const teams: Array<Team> = await listProjectScimGroups({
        projectId: projectId,
        filters: filters,
      });

      executionSteps.push(`Found ${teams.length} matching groups`);

      // startIndex is 1-based (RFC 7644, section 3.4.2.4).
      const page: Array<Team> = teams.slice(
        startIndex - 1,
        startIndex - 1 + count,
      );

      const membersByTeam: Map<string, Array<SCIMMember>> | undefined =
        includeMembers
          ? await getTeamMembersForSCIM({
              req: req,
              projectId: projectId,
              projectScimId: projectScimId,
              teamIds: page.map((team: Team): ObjectID => {
                return team.id!;
              }),
            })
          : undefined;

      const groups: Array<JSONObject> = [];

      for (const team of page) {
        groups.push(
          await formatTeamForSCIM({
            req: req,
            team: team,
            projectScimId: projectScimId,
            includeMembers: includeMembers,
            membersByTeam: membersByTeam,
          }),
        );
      }

      const responseBody: JSONObject = {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        totalResults: teams.length,
        startIndex: startIndex,
        itemsPerPage: groups.length,
        Resources: groups,
      };

      executionSteps.push(
        `Returning ${groups.length} groups from index ${startIndex}`,
      );

      void createProjectSCIMLog({
        projectId: projectId,
        projectScimId: new ObjectID(projectScimId),
        operationType: "ListGroups",
        status: SCIMLogStatus.Success,
        httpMethod: "GET",
        requestPath: req.path,
        httpStatusCode: 200,
        responseBody: responseBody,
        queryParams: queryParams,
        steps: executionSteps,
        additionalContext: {
          totalResults: teams.length,
          returnedGroupsCount: groups.length,
          membersIncluded: includeMembers,
        },
      });

      return sendScimResponse(req, res, responseBody);
    } catch (err) {
      return failProjectScimRequest({
        req: req,
        res: res,
        err: err,
        operationType: "ListGroups",
        executionSteps: executionSteps,
        queryParams: queryParams,
      });
    }
  },
);

// Get Individual Group - GET /scim/v2/Groups/{id}
router.get(
  "/scim/v2/:projectScimId/Groups/:groupId",
  LicensedFeatureGate.forScim,
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    const executionSteps: string[] = [];
    executionSteps.push("Received SCIM GetGroup request");

    try {
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const projectScimId: string = req.params["projectScimId"]!;
      const groupId: string = req.params["groupId"]!;

      executionSteps.push("Authenticated and extracted project context");
      executionSteps.push(`Looking up group with ID: ${groupId}`);

      const team: Team | null = isUuid(groupId)
        ? await TeamService.findOneBy({
            query: {
              projectId: projectId,
              _id: new ObjectID(groupId),
            },
            select: SCIM_GROUP_SELECT,
            props: { isRoot: true },
          })
        : null;

      if (!team) {
        executionSteps.push(
          `Team not found or not part of project: ${groupId}`,
        );
        throw new NotFoundException(
          "Group not found or not part of this project",
        );
      }

      executionSteps.push(`Found team: ${team.name?.toString()}`);

      const group: JSONObject = await formatTeamForSCIM({
        req: req,
        team: team,
        projectScimId: projectScimId,
        includeMembers: includesGroupMembers(req),
      });

      const memberCount: number =
        (group["members"] as Array<JSONObject> | undefined)?.length || 0;
      executionSteps.push(`Group formatted with ${memberCount} members`);

      void createProjectSCIMLog({
        projectId: projectId,
        projectScimId: new ObjectID(projectScimId),
        operationType: "GetGroup",
        status: SCIMLogStatus.Success,
        httpMethod: "GET",
        requestPath: req.path,
        httpStatusCode: 200,
        affectedGroupName: team.name?.toString(),
        responseBody: group,
        steps: executionSteps,
        groupInfo: {
          groupId: team.id?.toString(),
          displayName: team.name?.toString(),
          memberCount: memberCount,
        },
      });

      return sendScimResponse(req, res, group);
    } catch (err) {
      return failProjectScimRequest({
        req: req,
        res: res,
        err: err,
        operationType: "GetGroup",
        executionSteps: executionSteps,
        additionalContext: {
          requestedGroupId: req.params["groupId"] || null,
        },
      });
    }
  },
);

// Create Group - POST /scim/v2/Groups
router.post(
  "/scim/v2/:projectScimId/Groups",
  LicensedFeatureGate.forScim,
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    const executionSteps: string[] = [];
    executionSteps.push("Received SCIM CreateGroup request");

    try {
      logger.debug(
        `SCIM Create group request for projectScimId: ${req.params["projectScimId"]}`,
        getLogAttributesFromRequest(req as any),
      );
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const scimGroup: JSONObject = req.body;

      executionSteps.push("Authenticated and extracted project context");

      const displayName: string = scimGroup["displayName"] as string;

      logger.debug(
        `SCIM Create group - displayName: ${displayName}`,
        getLogAttributesFromRequest(req as any),
      );
      executionSteps.push(`Group displayName: ${displayName}`);

      if (!displayName) {
        executionSteps.push("displayName missing from request");
        throw new BadRequestException("displayName is required");
      }

      // Check if team already exists
      executionSteps.push("Checking if team already exists");
      const existingTeam: Team | null = await TeamService.findOneBy({
        query: {
          projectId: projectId,
          name: displayName,
        },
        select: {
          _id: true,
          name: true,
          createdAt: true,
          updatedAt: true,
          projectId: true,
        },
        props: { isRoot: true },
      });

      let targetTeam: Team;
      let createdNewTeam: boolean = false;

      if (existingTeam) {
        logger.debug(
          `SCIM Create group - team already exists with id: ${existingTeam.id}, reusing existing team`,
          getLogAttributesFromRequest(req as any),
        );
        executionSteps.push(
          `Team already exists with ID: ${existingTeam.id}, reusing`,
        );
        targetTeam = existingTeam;
      } else {
        // Create new team
        logger.debug(
          `SCIM Create group - creating new team: ${displayName}`,
          getLogAttributesFromRequest(req as any),
        );
        executionSteps.push(`Creating new team: ${displayName}`);
        const team: Team = new Team();
        team.projectId = projectId;
        team.name = displayName;
        team.isTeamEditable = true; // Allow editing SCIM-created teams
        team.isTeamDeleteable = true; // Allow deleting SCIM-created teams
        team.shouldHaveAtLeastOneMember = false; // SCIM groups can be empty

        const createdTeam: Team = await TeamService.create({
          data: team,
          props: { isRoot: true },
        });

        logger.debug(
          `SCIM Create group - created team with id: ${createdTeam.id}`,
          getLogAttributesFromRequest(req as any),
        );
        executionSteps.push(`Created new team with ID: ${createdTeam.id}`);

        targetTeam = createdTeam;
        createdNewTeam = true;
      }

      // Handle members if provided. Adds any new members and leaves existing ones intact.
      const members: Array<SCIMMember> =
        (scimGroup["members"] as Array<SCIMMember>) || [];
      let membersAdded: number = 0;
      let membersInvited: number = 0;
      let membersSkipped: number = 0;
      if (members.length > 0) {
        logger.debug(
          `SCIM Create group - ensuring ${members.length} members are part of team ${targetTeam.id}`,
          getLogAttributesFromRequest(req as any),
        );
        executionSteps.push(
          `Processing ${members.length} members from request`,
        );
        const counts: { added: number; invited: number; skipped: number } =
          await addGroupMembersToTeam({
            projectId: projectId,
            teamId: targetTeam.id!,
            members: members,
          });
        membersAdded = counts.added + counts.invited;
        membersInvited = counts.invited;
        membersSkipped = counts.skipped;
        executionSteps.push(
          `Members processed: ${membersAdded} added (${membersInvited} of them invited, pending acceptance), ${membersSkipped} skipped (already members or not found)`,
        );
      } else {
        executionSteps.push("No members provided in request");
      }

      executionSteps.push("Fetching final team state for response");
      const teamForResponse: Team | null = await TeamService.findOneById({
        id: targetTeam.id!,
        select: {
          _id: true,
          name: true,
          createdAt: true,
          updatedAt: true,
          projectId: true,
        },
        props: { isRoot: true },
      });

      if (!teamForResponse) {
        executionSteps.push("Failed to retrieve team after creation");
        throw new NotFoundException("Failed to retrieve group");
      }

      const groupResponse: JSONObject = await formatTeamForSCIM({
        req: req,
        team: teamForResponse,
        projectScimId: req.params["projectScimId"]!,
      });
      const finalMemberCount: number =
        (groupResponse["members"] as Array<any>)?.length || 0;
      executionSteps.push(
        `Group formatted with ${finalMemberCount} total members`,
      );

      logger.debug(
        `SCIM Create group - returning group with id: ${teamForResponse.id}`,
        getLogAttributesFromRequest(req as any),
      );

      // RFC 7644: 201 for a new group, 200 when an existing team is reused.
      const httpStatusCode: number = createdNewTeam ? 201 : 200;

      // Log the operation
      void createProjectSCIMLog({
        projectId: projectId,
        projectScimId: new ObjectID(req.params["projectScimId"]!),
        operationType: "CreateGroup",
        status: SCIMLogStatus.Success,
        httpMethod: "POST",
        requestPath: req.path,
        httpStatusCode: httpStatusCode,
        affectedGroupName: displayName,
        requestBody: scimGroup,
        responseBody: groupResponse,
        steps: executionSteps,
        groupInfo: {
          groupId: teamForResponse.id?.toString(),
          displayName: displayName,
          wasNewlyCreated: createdNewTeam,
          membersAdded: membersAdded,
          membersInvited: membersInvited,
          membersSkipped: membersSkipped,
          totalMembers: finalMemberCount,
        },
      });

      return sendScimResponse(req, res, groupResponse, httpStatusCode);
    } catch (err) {
      return failProjectScimRequest({
        req: req,
        res: res,
        err: err,
        operationType: "CreateGroup",
        executionSteps: executionSteps,
        requestBody: getRequestBody(req),
      });
    }
  },
);

// Update Group - PUT /scim/v2/Groups/{id}
router.put(
  "/scim/v2/:projectScimId/Groups/:groupId",
  LicensedFeatureGate.forScim,
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    const executionSteps: string[] = [];
    executionSteps.push("Received SCIM UpdateGroup (PUT) request");

    try {
      logger.debug(
        `SCIM Update group request for groupId: ${req.params["groupId"]}, projectScimId: ${req.params["projectScimId"]}`,
        getLogAttributesFromRequest(req as any),
      );
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const groupId: string = req.params["groupId"]!;
      const scimGroup: JSONObject = req.body;

      executionSteps.push("Authenticated and extracted project context");
      executionSteps.push(`Target group ID: ${groupId}`);

      logger.debug(
        `SCIM Update group - projectId: ${projectId}, groupId: ${groupId}`,
        getLogAttributesFromRequest(req as any),
      );

      logger.debug(
        `Request body for SCIM Update group: ${JSON.stringify(scimGroup, null, 2)}`,
        getLogAttributesFromRequest(req as any),
      );

      if (!groupId) {
        executionSteps.push("Group ID missing from request");
        throw new BadRequestException("Group ID is required");
      }

      // Check if team exists and is part of the project
      executionSteps.push("Querying team from database");
      const team: Team | null = await TeamService.findOneBy({
        query: {
          projectId: projectId,
          _id: new ObjectID(groupId),
        },
        select: {
          _id: true,
          name: true,
          createdAt: true,
          updatedAt: true,
          projectId: true,
          isTeamEditable: true,
        },
        props: { isRoot: true },
      });

      if (!team) {
        logger.debug(
          `SCIM Update group - team not found or not part of project for groupId: ${groupId}`,
          getLogAttributesFromRequest(req as any),
        );
        executionSteps.push(
          `Team not found or not part of project: ${groupId}`,
        );
        throw new NotFoundException(
          "Group not found or not part of this project",
        );
      }
      executionSteps.push(`Found existing team: ${team.name?.toString()}`);
      const previousName: string | undefined = team.name?.toString();

      /*
       * Below the plan SCIM needs, a replace goes through only when every
       * member it lists is already in the group (Utils/SCIMBelowPlan): the
       * members it leaves out are removed, as on every plan, and the group
       * keeps its name. One that lists anyone new, or only renames the
       * group, is refused. Checked before anything is written, so a refused
       * replace changes nothing.
       */
      const missingPlan: PlanType | null = getScimMissingPlan(req);

      if (missingPlan) {
        const belowPlan: ScimUpdateBelowPlan = getScimGroupReplaceBelowPlan({
          displayName: scimGroup["displayName"],
          currentName: previousName,
          listedMembers: scimGroup["members"],
          currentMemberIds: await getTeamMemberUserIds({
            projectId: projectId,
            teamId: team.id!,
          }),
        });

        if (belowPlan === ScimUpdateBelowPlan.Refused) {
          refuseBelowPlan({
            req: req,
            res: res,
            missingPlan: missingPlan,
            projectId: projectId,
            operationType: "UpdateGroup",
            reason: "the replace would add members, or only rename the group",
            executionSteps: executionSteps,
            requestBody: scimGroup,
            affectedGroupName: previousName,
            groupInfo: {
              groupId: team.id?.toString(),
              displayName: previousName,
            },
          });

          return;
        }

        executionSteps.push(
          `Below the ${missingPlan} plan: this replace adds no one, so it goes through, and the group keeps its name`,
        );
      }

      // Update team name if provided - not below the plan.
      const displayName: string = scimGroup["displayName"] as string;
      let nameUpdated: boolean = false;
      if (missingPlan && displayName && displayName !== team.name) {
        executionSteps.push(
          `Below the ${missingPlan} plan the group keeps its name: the rename to "${displayName}" is not applied`,
        );
      } else if (displayName && displayName !== team.name) {
        logger.debug(
          `SCIM Update group - updating name to: ${displayName}`,
          getLogAttributesFromRequest(req as any),
        );
        executionSteps.push(
          `Updating team name from "${team.name}" to "${displayName}"`,
        );
        await TeamService.updateOneById({
          id: team.id!,
          data: { name: displayName },
          props: { isRoot: true },
        });
        nameUpdated = true;
        executionSteps.push("Team name updated");
      } else {
        executionSteps.push("Team name unchanged");
      }

      // Handle members update - replace all members
      const members: Array<SCIMMember> =
        (scimGroup["members"] as Array<SCIMMember>) || [];

      logger.debug(
        `SCIM Update group - replacing members with ${members.length} members`,
        getLogAttributesFromRequest(req as any),
      );
      executionSteps.push(
        `Replacing all members with ${members.length} members from request`,
      );

      const counts: {
        added: number;
        invited: number;
        skipped: number;
        kept: number;
        removed: number;
      } = await replaceGroupMembersOfTeam({
        projectId: projectId,
        teamId: team.id!,
        members: members,
        /*
         * Below the plan, removals only: see replaceGroupMembersOfTeam. It
         * reads the members again rather than reusing the check's read, so
         * what it writes is the difference against the team as it is now.
         */
        removeOnly: Boolean(missingPlan),
      });
      const membersAdded: number = counts.added + counts.invited;
      const membersInvited: number = counts.invited;
      const membersSkipped: number = counts.skipped;
      executionSteps.push(
        `Members kept: ${counts.kept}, removed: ${counts.removed}, added: ${membersAdded} (${membersInvited} of them invited, pending acceptance), skipped: ${membersSkipped}`,
      );

      // Fetch updated team
      executionSteps.push("Fetching final team state for response");
      const updatedTeam: Team | null = await TeamService.findOneById({
        id: team.id!,
        select: {
          _id: true,
          name: true,
          createdAt: true,
          updatedAt: true,
          projectId: true,
        },
        props: { isRoot: true },
      });

      if (updatedTeam) {
        const updatedGroup: JSONObject = await formatTeamForSCIM({
          req: req,
          team: updatedTeam,
          projectScimId: req.params["projectScimId"]!,
        });
        const finalMemberCount: number =
          (updatedGroup["members"] as Array<any>)?.length || 0;
        executionSteps.push(
          `Group formatted with ${finalMemberCount} total members`,
        );

        // Log the operation
        void createProjectSCIMLog({
          projectId: projectId,
          projectScimId: new ObjectID(req.params["projectScimId"]!),
          operationType: "UpdateGroup",
          status: SCIMLogStatus.Success,
          httpMethod: "PUT",
          requestPath: req.path,
          httpStatusCode: 200,
          affectedGroupName: displayName || updatedTeam.name?.toString(),
          requestBody: scimGroup,
          responseBody: updatedGroup,
          steps: executionSteps,
          groupInfo: {
            groupId: team.id?.toString(),
            displayName: updatedTeam.name?.toString(),
            previousName: previousName,
            nameUpdated: nameUpdated,
            membersAdded: membersAdded,
            membersInvited: membersInvited,
            membersSkipped: membersSkipped,
            membersKept: counts.kept,
            membersRemoved: counts.removed,
            totalMembers: finalMemberCount,
          },
        });

        return sendScimResponse(req, res, updatedGroup);
      }

      executionSteps.push("Failed to retrieve team after update");
      throw new NotFoundException("Failed to retrieve updated group");
    } catch (err) {
      return failProjectScimRequest({
        req: req,
        res: res,
        err: err,
        operationType: "UpdateGroup",
        executionSteps: executionSteps,
        requestBody: getRequestBody(req),
        additionalContext: {
          requestedGroupId: req.params["groupId"] || null,
        },
      });
    }
  },
);

// Delete Group - DELETE /scim/v2/Groups/{id}
router.delete(
  "/scim/v2/:projectScimId/Groups/:groupId",
  LicensedFeatureGate.forScim,
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    const executionSteps: string[] = [];
    executionSteps.push("Received SCIM DeleteGroup request");

    try {
      logger.debug(
        `SCIM Delete group request for groupId: ${req.params["groupId"]}, projectScimId: ${req.params["projectScimId"]}`,
        getLogAttributesFromRequest(req as any),
      );
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const groupId: string = req.params["groupId"]!;

      executionSteps.push("Authenticated and extracted project context");
      executionSteps.push(`Target group ID: ${groupId}`);

      logger.debug(
        `SCIM Delete group - projectId: ${projectId}, groupId: ${groupId}`,
        getLogAttributesFromRequest(req as any),
      );

      if (!groupId) {
        executionSteps.push("Group ID missing from request");
        throw new BadRequestException("Group ID is required");
      }

      // Check if team exists and is part of the project
      executionSteps.push("Querying team from database");
      const team: Team | null = await TeamService.findOneBy({
        query: {
          projectId: projectId,
          _id: new ObjectID(groupId),
        },
        select: {
          _id: true,
          name: true,
          isTeamDeleteable: true,
        },
        props: { isRoot: true },
      });

      if (!team) {
        logger.debug(
          `SCIM Delete group - team not found or not part of project for groupId: ${groupId}`,
          getLogAttributesFromRequest(req as any),
        );
        executionSteps.push(
          `Team not found or not part of project: ${groupId}`,
        );
        throw new NotFoundException(
          "Group not found or not part of this project",
        );
      }
      executionSteps.push(`Found team: ${team.name?.toString()}`);

      if (!team.isTeamDeleteable) {
        executionSteps.push(`Team is not deleteable: ${team.name?.toString()}`);
        throw new BadRequestException("This group cannot be deleted");
      }

      logger.debug(
        `SCIM Delete group - deleting team: ${team.name}`,
        getLogAttributesFromRequest(req as any),
      );
      const teamName: string | undefined = team.name?.toString();

      // Remove all team members first
      executionSteps.push("Removing all team members");
      await TeamMemberService.deleteBy({
        query: {
          projectId: projectId,
          teamId: team.id!,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });
      executionSteps.push("All team members removed");

      // Delete the team
      executionSteps.push("Deleting team from database");
      await TeamService.deleteBy({
        query: {
          projectId: projectId,
          _id: team.id!,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });
      executionSteps.push("Team successfully deleted");

      logger.debug(
        `SCIM Delete group - team successfully deleted`,
        getLogAttributesFromRequest(req as any),
      );

      // Log the operation
      void createProjectSCIMLog({
        projectId: projectId,
        projectScimId: new ObjectID(req.params["projectScimId"]!),
        operationType: "DeleteGroup",
        status: SCIMLogStatus.Success,
        httpMethod: "DELETE",
        requestPath: req.path,
        httpStatusCode: 204,
        affectedGroupName: teamName,
        steps: executionSteps,
        groupInfo: {
          groupId: groupId,
          displayName: teamName,
        },
      });

      // RFC 7644 section 3.6: a successful DELETE is 204 No Content, no body.
      res.status(204).send();
      return;
    } catch (err) {
      return failProjectScimRequest({
        req: req,
        res: res,
        err: err,
        operationType: "DeleteGroup",
        executionSteps: executionSteps,
        additionalContext: {
          requestedGroupId: req.params["groupId"] || null,
        },
      });
    }
  },
);

// Update Group Memberships - PATCH /scim/v2/Groups/{id}
router.patch(
  "/scim/v2/:projectScimId/Groups/:groupId",
  LicensedFeatureGate.forScim,
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    const executionSteps: string[] = [];
    executionSteps.push("Received SCIM PatchGroup request");
    let membersAdded: number = 0;
    let membersInvited: number = 0;
    let membersRemoved: number = 0;
    let membersKept: number = 0;
    let membersReplaced: boolean = false;
    let nameUpdated: boolean = false;

    try {
      logger.debug(
        `SCIM Patch group request for groupId: ${req.params["groupId"]}, projectScimId: ${req.params["projectScimId"]}`,
        getLogAttributesFromRequest(req as any),
      );
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const groupId: string = req.params["groupId"]!;
      const scimPatch: JSONObject = req.body;

      executionSteps.push("Authenticated and extracted project context");
      executionSteps.push(`Target group ID: ${groupId}`);

      logger.debug(
        `SCIM Patch group - projectId: ${projectId}, groupId: ${groupId}`,
        getLogAttributesFromRequest(req as any),
      );

      if (!groupId) {
        executionSteps.push("Group ID missing from request");
        throw new BadRequestException("Group ID is required");
      }

      // Check if team exists and is part of the project
      executionSteps.push("Querying team from database");
      const team: Team | null = await TeamService.findOneBy({
        query: {
          projectId: projectId,
          _id: new ObjectID(groupId),
        },
        select: {
          _id: true,
          name: true,
          createdAt: true,
          updatedAt: true,
          projectId: true,
          isTeamEditable: true,
        },
        props: { isRoot: true },
      });

      if (!team) {
        logger.debug(
          `SCIM Patch group - team not found or not part of project for groupId: ${groupId}`,
          getLogAttributesFromRequest(req as any),
        );
        executionSteps.push(
          `Team not found or not part of project: ${groupId}`,
        );
        throw new NotFoundException(
          "Group not found or not part of this project",
        );
      }
      executionSteps.push(`Found existing team: ${team.name?.toString()}`);
      const previousName: string | undefined = team.name?.toString();

      /*
       * Handle SCIM patch operations: read them all first
       * (planScimGroupPatch) - Entra ID's member removals with a value list
       * and Okta's members[value eq "..."] alike - then apply them in order.
       */
      const operations: Array<ScimGroupPatchAction> = planScimGroupPatch(
        scimPatch["Operations"],
      );
      executionSteps.push(`Processing ${operations.length} PATCH operations`);

      /*
       * Below the plan SCIM needs, the update goes through only when it
       * takes access away, without its renames (Utils/SCIMBelowPlan).
       * Checked before anything is written, so a refused update changes
       * nothing.
       */
      const operationsToApply: Array<ScimGroupPatchAction> | null =
        await getGroupPatchActionsToApply({
          req: req,
          res: res,
          projectId: projectId,
          team: team,
          actions: operations,
          executionSteps: executionSteps,
        });

      if (!operationsToApply) {
        logger.debug(
          `SCIM Patch group - refused below the plan: the update would add members, or only rename the group`,
          getLogAttributesFromRequest(req as any),
        );
        return;
      }

      const applied: GroupPatchResult = await applyGroupPatchActions({
        projectId: projectId,
        team: team,
        actions: operationsToApply,
        executionSteps: executionSteps,
        req: req,
        removeOnly: Boolean(getScimMissingPlan(req)),
      });
      membersAdded = applied.added;
      membersInvited = applied.invited;
      membersRemoved = applied.removed;
      membersKept = applied.kept;
      membersReplaced = applied.replaced;
      nameUpdated = applied.nameUpdated;

      executionSteps.push(
        `Operations completed: ${membersAdded} added (${membersInvited} of them invited, pending acceptance), ${membersRemoved} removed, replaced=${membersReplaced}, nameUpdated=${nameUpdated}`,
      );

      // Fetch updated team
      executionSteps.push("Fetching final team state for response");
      const updatedTeam: Team | null = await TeamService.findOneById({
        id: team.id!,
        select: {
          _id: true,
          name: true,
          createdAt: true,
          updatedAt: true,
          projectId: true,
        },
        props: { isRoot: true },
      });

      if (updatedTeam) {
        const updatedGroup: JSONObject = await formatTeamForSCIM({
          req: req,
          team: updatedTeam,
          projectScimId: req.params["projectScimId"]!,
        });
        const finalMemberCount: number =
          (updatedGroup["members"] as Array<any>)?.length || 0;
        executionSteps.push(
          `Group formatted with ${finalMemberCount} total members`,
        );

        // Log the operation
        void createProjectSCIMLog({
          projectId: projectId,
          projectScimId: new ObjectID(req.params["projectScimId"]!),
          operationType: "UpdateGroup",
          status: SCIMLogStatus.Success,
          httpMethod: "PATCH",
          requestPath: req.path,
          httpStatusCode: 200,
          affectedGroupName: updatedTeam.name?.toString(),
          requestBody: scimPatch,
          responseBody: updatedGroup,
          steps: executionSteps,
          groupInfo: {
            groupId: team.id?.toString(),
            displayName: updatedTeam.name?.toString(),
            previousName: previousName,
            nameUpdated: nameUpdated,
            membersAdded: membersAdded,
            membersInvited: membersInvited,
            membersRemoved: membersRemoved,
            membersKept: membersKept,
            membersReplaced: membersReplaced,
            totalMembers: finalMemberCount,
            operationsCount: operations.length,
          },
        });

        return sendScimResponse(req, res, updatedGroup);
      }

      executionSteps.push("Failed to retrieve team after update");
      throw new NotFoundException("Failed to retrieve updated group");
    } catch (err) {
      return failProjectScimRequest({
        req: req,
        res: res,
        err: err,
        operationType: "UpdateGroup",
        executionSteps: executionSteps,
        requestBody: getRequestBody(req),
        additionalContext: {
          requestedGroupId: req.params["groupId"] || null,
        },
      });
    }
  },
);

// Create User - POST /scim/v2/Users
router.post(
  "/scim/v2/:projectScimId/Users",
  LicensedFeatureGate.forScim,
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    const executionSteps: string[] = [];
    executionSteps.push("Received SCIM CreateUser request");

    try {
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const scimConfig: ProjectSCIM = bearerData["scimConfig"] as ProjectSCIM;
      const projectScimId: string = req.params["projectScimId"]!;

      executionSteps.push(
        "Validated SCIM authentication and extracted project configuration",
      );

      const created: CreatedProjectScimUser = await createProjectScimUser({
        projectId: projectId,
        projectScimId: new ObjectID(projectScimId),
        scimConfig: scimConfig,
        body: req.body,
        executionSteps: executionSteps,
      });

      const responseBody: JSONObject = renderProjectScimUser({
        req: req,
        projectScimId: projectScimId,
        user: created.user,
      });

      executionSteps.push(
        `Operation completed successfully - returning user with ID: ${created.user.account.id?.toString()}`,
      );

      void createProjectSCIMLog({
        projectId: projectId,
        projectScimId: new ObjectID(projectScimId),
        operationType: "CreateUser",
        status: SCIMLogStatus.Success,
        httpMethod: "POST",
        requestPath: req.path,
        httpStatusCode: 201,
        affectedUserEmail: created.email,
        requestBody: getRequestBody(req),
        responseBody: responseBody,
        steps: executionSteps,
        userInfo: {
          userId: created.user.account.id?.toString(),
          email: created.email,
          name: created.name || "Unknown",
          wasNewlyCreated: created.userWasCreated,
        },
        additionalContext: {
          autoProvisionEnabled: Boolean(scimConfig.autoProvisionUsers),
          pushGroupsEnabled: Boolean(scimConfig.enablePushGroups),
          teamsAssigned: created.teamsAdded,
          defaultTeamsCount: scimConfig.teams?.length || 0,
        },
      });

      return sendScimResponse(req, res, responseBody, 201);
    } catch (err) {
      return failProjectScimRequest({
        req: req,
        res: res,
        err: err,
        operationType: "CreateUser",
        executionSteps: executionSteps,
        requestBody: getRequestBody(req),
      });
    }
  },
);

// Delete User - DELETE /scim/v2/Users/{id}
router.delete(
  "/scim/v2/:projectScimId/Users/:userId",
  LicensedFeatureGate.forScim,
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    const executionSteps: string[] = [];
    executionSteps.push("Received SCIM DeleteUser request");

    try {
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const scimConfig: ProjectSCIM = bearerData["scimConfig"] as ProjectSCIM;
      const projectScimId: string = req.params["projectScimId"]!;

      executionSteps.push(
        `Processing delete request for user ID: ${req.params["userId"]}`,
      );

      const deleted: { user: ProjectScimUser; teamsRemoved: Array<string> } =
        await deleteProjectScimUser({
          projectId: projectId,
          projectScimId: new ObjectID(projectScimId),
          scimConfig: scimConfig,
          userId: req.params["userId"]!,
          executionSteps: executionSteps,
        });

      executionSteps.push("User successfully deprovisioned from project");

      void createProjectSCIMLog({
        projectId: projectId,
        projectScimId: new ObjectID(projectScimId),
        operationType: "DeleteUser",
        status: SCIMLogStatus.Success,
        httpMethod: "DELETE",
        requestPath: req.path,
        httpStatusCode: 204,
        affectedUserEmail: deleted.user.account.email?.toString(),
        steps: executionSteps,
        userInfo: {
          userId: deleted.user.account.id?.toString(),
          email: deleted.user.account.email?.toString(),
        },
        additionalContext: {
          autoDeprovisionEnabled: Boolean(scimConfig.autoDeprovisionUsers),
          pushGroupsEnabled: Boolean(scimConfig.enablePushGroups),
          teamsRemovedFrom: deleted.teamsRemoved,
        },
      });

      // RFC 7644 section 3.6: a successful DELETE is 204 No Content, no body.
      res.status(204).send();
      return;
    } catch (err) {
      return failProjectScimRequest({
        req: req,
        res: res,
        err: err,
        operationType: "DeleteUser",
        executionSteps: executionSteps,
        userInfo: req.params["userId"]
          ? { userId: req.params["userId"] }
          : undefined,
      });
    }
  },
);

export default router;
