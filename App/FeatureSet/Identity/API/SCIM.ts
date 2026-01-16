import SCIMMiddleware from "Common/Server/Middleware/SCIMAuthorization";
import UserService from "Common/Server/Services/UserService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import TeamService from "Common/Server/Services/TeamService";
import { createProjectSCIMLog } from "../Utils/SCIMLogger";
import SCIMLogStatus from "Common/Types/SCIM/SCIMLogStatus";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  OneUptimeRequest,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import { JSONObject } from "Common/Types/JSON";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import Team from "Common/Models/DatabaseModels/Team";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import OneUptimeDate from "Common/Types/Date";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Query from "Common/Types/BaseDatabase/Query";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import User from "Common/Models/DatabaseModels/User";
import {
  parseNameFromSCIM,
  formatUserForSCIM,
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
  SCIMErrorType,
} from "../Utils/SCIMUtils";
import {
  AppApiClientUrl,
  DocsClientUrl,
} from "Common/Server/EnvironmentConfig";

type SCIMMember = {
  value: string;
  display: string;
  $ref: string;
};

const router: ExpressRouter = Express.getRouter();

const handleUserTeamOperations: (
  operation: "add" | "remove",
  projectId: ObjectID,
  userId: ObjectID,
  scimConfig: ProjectSCIM,
) => Promise<void> = async (
  operation: "add" | "remove",
  projectId: ObjectID,
  userId: ObjectID,
  scimConfig: ProjectSCIM,
): Promise<void> => {
  const teamsIds: Array<ObjectID> =
    scimConfig.teams?.map((team: any) => {
      return team.id;
    }) || [];

  if (teamsIds.length === 0) {
    logger.debug(`SCIM Team operations - no teams configured for SCIM`);
    return;
  }

  if (operation === "add") {
    logger.debug(
      `SCIM Team operations - adding user to ${teamsIds.length} configured teams`,
    );

    for (const team of scimConfig.teams || []) {
      const existingMember: TeamMember | null =
        await TeamMemberService.findOneBy({
          query: {
            projectId: projectId,
            userId: userId,
            teamId: team.id!,
          },
          select: { _id: true },
          props: { isRoot: true },
        });

      if (!existingMember) {
        logger.debug(`SCIM Team operations - adding user to team: ${team.id}`);
        const teamMember: TeamMember = new TeamMember();
        teamMember.projectId = projectId;
        teamMember.userId = userId;
        teamMember.teamId = team.id!;
        teamMember.hasAcceptedInvitation = true;
        teamMember.invitationAcceptedAt = OneUptimeDate.getCurrentDate();

        await TeamMemberService.create({
          data: teamMember,
          props: {
            isRoot: true,
          },
        });

        logger.debug(`SCIM Team operations - user added to team: ${team.id}`);
      } else {
        logger.debug(
          `SCIM Team operations - user already member of team: ${team.id}`,
        );
      }
    }
  } else if (operation === "remove") {
    logger.debug(
      `SCIM Team operations - removing user from ${teamsIds.length} configured teams`,
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
    );
  }

  return unassignedTeam;
};

// Helper function to add user to the "Unassigned" team
const addUserToUnassignedTeam: (
  projectId: ObjectID,
  userId: ObjectID,
) => Promise<Team> = async (
  projectId: ObjectID,
  userId: ObjectID,
): Promise<Team> => {
  const unassignedTeam: Team = await getOrCreateUnassignedTeam(projectId);

  // Check if user is already a member
  const existingMember: TeamMember | null = await TeamMemberService.findOneBy({
    query: {
      projectId: projectId,
      userId: userId,
      teamId: unassignedTeam.id!,
    },
    select: { _id: true },
    props: { isRoot: true },
  });

  if (!existingMember) {
    logger.debug(
      `SCIM - Adding user ${userId.toString()} to "Unassigned" team`,
    );

    const teamMember: TeamMember = new TeamMember();
    teamMember.projectId = projectId;
    teamMember.userId = userId;
    teamMember.teamId = unassignedTeam.id!;
    teamMember.hasAcceptedInvitation = true;
    teamMember.invitationAcceptedAt = OneUptimeDate.getCurrentDate();

    await TeamMemberService.create({
      data: teamMember,
      props: { isRoot: true },
    });

    logger.debug(
      `SCIM - User added to "Unassigned" team: ${unassignedTeam.id?.toString()}`,
    );
  } else {
    logger.debug(
      `SCIM - User ${userId.toString()} already in "Unassigned" team`,
    );
  }

  return unassignedTeam;
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
    );
  }
};

// Helper function to format team as SCIM group
const formatTeamForSCIM: (
  team: Team,
  projectScimId: string,
  includeMembers?: boolean,
) => Promise<JSONObject> = async (
  team: Team,
  projectScimId: string,
  includeMembers: boolean = true,
): Promise<JSONObject> => {
  let members: Array<SCIMMember> = [];

  if (includeMembers) {
    const teamMembers: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        teamId: team.id!,
        projectId: team.projectId!,
      },
      select: {
        user: {
          _id: true,
          email: true,
        },
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    members = teamMembers
      .filter((member: TeamMember) => {
        return member.user;
      })
      .map((member: TeamMember) => {
        return {
          value: member.user!.id!.toString(),
          display: member.user!.email!.toString(),
          $ref: `${AppApiClientUrl.toString()}scim/v2/${projectScimId}/Users/${member.user!.id!.toString()}`,
        };
      });
  }

  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    id: team.id?.toString(),
    displayName: team.name?.toString(),
    members: members,
    meta: {
      resourceType: "Group",
      created: team.createdAt?.toISOString(),
      lastModified: team.updatedAt?.toISOString(),
      location: `${AppApiClientUrl.toString()}scim/v2/${projectScimId}/Groups/${team.id?.toString()}`,
    },
  };
};

// SCIM Service Provider Configuration - GET /scim/v2/ServiceProviderConfig
router.get(
  "/scim/v2/:projectScimId/ServiceProviderConfig",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      logger.debug(
        `Project SCIM ServiceProviderConfig - scimId: ${req.params["projectScimId"]!}`,
      );

      const serviceProviderConfig: JSONObject = generateServiceProviderConfig(
        req,
        req.params["projectScimId"]!,
        "project",
        DocsClientUrl.toString() + "/identity/scim",
      );

      logger.debug(
        "Project SCIM ServiceProviderConfig response prepared successfully",
      );
      return Response.sendJsonObjectResponse(req, res, serviceProviderConfig);
    } catch (err) {
      logger.error(err);
      return next(err);
    }
  },
);

// SCIM Schemas endpoint - GET /scim/v2/Schemas
router.get(
  "/scim/v2/:projectScimId/Schemas",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      logger.debug(
        `Project SCIM Schemas - scimId: ${req.params["projectScimId"]!}`,
      );

      const schemasResponse: JSONObject = generateSchemasResponse(
        req,
        req.params["projectScimId"]!,
        "project",
      );

      logger.debug("Project SCIM Schemas response prepared successfully");
      return Response.sendJsonObjectResponse(req, res, schemasResponse);
    } catch (err) {
      logger.error(err);
      return next(err);
    }
  },
);

// SCIM ResourceTypes endpoint - GET /scim/v2/ResourceTypes
router.get(
  "/scim/v2/:projectScimId/ResourceTypes",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      logger.debug(
        `Project SCIM ResourceTypes - scimId: ${req.params["projectScimId"]!}`,
      );

      const resourceTypesResponse: JSONObject = generateResourceTypesResponse(
        req,
        req.params["projectScimId"]!,
        "project",
      );

      logger.debug("Project SCIM ResourceTypes response prepared successfully");
      return Response.sendJsonObjectResponse(req, res, resourceTypesResponse);
    } catch (err) {
      logger.error(err);
      return next(err);
    }
  },
);

// SCIM Bulk Operations endpoint - POST /scim/v2/Bulk
router.post(
  "/scim/v2/:projectScimId/Bulk",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
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
        res.status(400);
        return Response.sendJsonObjectResponse(
          req,
          res,
          generateSCIMErrorResponse(
            400,
            validation.error!,
            SCIMErrorType.InvalidValue,
          ),
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
            if (method === "POST") {
              // Create User
              if (!scimConfig.autoProvisionUsers) {
                throw new BadRequestException(
                  "Auto-provisioning is disabled for this project",
                );
              }

              const email: string =
                (data!["userName"] as string) ||
                ((data!["emails"] as JSONObject[])?.[0]?.["value"] as string);
              const name: string = parseNameFromSCIM(data!);

              if (!email) {
                throw new BadRequestException("userName or email is required");
              }

              // Check if user already exists
              let user: User | null = await UserService.findOneBy({
                query: { email: new Email(email) },
                select: {
                  _id: true,
                  email: true,
                  name: true,
                  createdAt: true,
                  updatedAt: true,
                },
                props: { isRoot: true },
              });

              // Create user if doesn't exist
              if (!user) {
                user = await UserService.createByEmail({
                  email: new Email(email),
                  name: name ? new Name(name) : new Name("Unknown"),
                  isEmailVerified: true,
                  generateRandomPassword: true,
                  props: { isRoot: true },
                });
              }

              // Add user to default teams if configured and push groups is not enabled
              if (
                scimConfig.teams &&
                scimConfig.teams.length > 0 &&
                !scimConfig.enablePushGroups
              ) {
                await handleUserTeamOperations(
                  "add",
                  projectId,
                  user.id!,
                  scimConfig,
                );
              }

              const createdUser: JSONObject = formatUserForSCIM(
                user,
                req,
                projectScimId,
                "project",
              );

              operationResult = {
                method: method,
                bulkId: bulkId,
                status: "201",
                location: `/scim/v2/${projectScimId}/Users/${user.id?.toString()}`,
                response: createdUser,
              };
            } else if (method === "PUT" || method === "PATCH") {
              // Update User
              if (!resourceId) {
                throw new BadRequestException("User ID is required");
              }

              const userId: ObjectID = new ObjectID(resourceId);

              // Check if user exists and is part of the project
              const projectUser: TeamMember | null =
                await TeamMemberService.findOneBy({
                  query: {
                    projectId: projectId,
                    userId: userId,
                  },
                  select: {
                    userId: true,
                    user: {
                      _id: true,
                      email: true,
                      name: true,
                      createdAt: true,
                      updatedAt: true,
                    },
                  },
                  props: { isRoot: true },
                });

              if (!projectUser || !projectUser.user) {
                throw new NotFoundException(
                  "User not found or not part of this project",
                );
              }

              // Update user information
              const email: string =
                (data!["userName"] as string) ||
                ((data!["emails"] as JSONObject[])?.[0]?.["value"] as string);
              const name: string = parseNameFromSCIM(data!);
              const active: boolean = data!["active"] as boolean;

              // Handle user deactivation by removing from teams
              if (active === false && !scimConfig.enablePushGroups) {
                await handleUserTeamOperations(
                  "remove",
                  projectId,
                  userId,
                  scimConfig,
                );
              }

              // Handle user activation by adding to teams
              if (active === true && !scimConfig.enablePushGroups) {
                await handleUserTeamOperations(
                  "add",
                  projectId,
                  userId,
                  scimConfig,
                );
              }

              if (email || name) {
                const updateData: { email?: Email; name?: Name } = {};
                if (email) {
                  updateData.email = new Email(email);
                }
                if (name) {
                  updateData.name = new Name(name);
                }

                await UserService.updateOneById({
                  id: userId,
                  data: updateData,
                  props: { isRoot: true },
                });
              }

              // Fetch updated user
              const updatedUser: User | null = await UserService.findOneById({
                id: userId,
                select: {
                  _id: true,
                  email: true,
                  name: true,
                  createdAt: true,
                  updatedAt: true,
                },
                props: { isRoot: true },
              });

              const userResponse: JSONObject = formatUserForSCIM(
                updatedUser || projectUser.user,
                req,
                projectScimId,
                "project",
              );

              operationResult = {
                method: method,
                bulkId: bulkId,
                status: "200",
                location: `/scim/v2/${projectScimId}/Users/${resourceId}`,
                response: userResponse,
              };
            } else if (method === "DELETE") {
              // Delete User
              if (!resourceId) {
                throw new BadRequestException("User ID is required");
              }

              if (!scimConfig.autoDeprovisionUsers) {
                throw new BadRequestException(
                  "Auto-deprovisioning is disabled for this project",
                );
              }

              const userId: ObjectID = new ObjectID(resourceId);

              // Remove user from teams the SCIM configured
              if (!scimConfig.enablePushGroups) {
                if (!scimConfig.teams || scimConfig.teams.length === 0) {
                  throw new BadRequestException("No teams configured for SCIM");
                }

                await handleUserTeamOperations(
                  "remove",
                  projectId,
                  userId,
                  scimConfig,
                );
              }

              operationResult = {
                method: method,
                bulkId: bulkId,
                status: "204",
                location: `/scim/v2/${projectScimId}/Users/${resourceId}`,
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
              for (const member of members) {
                const userId: string = member["value"] as string;
                if (userId) {
                  const userExists: User | null = await UserService.findOneById(
                    {
                      id: new ObjectID(userId),
                      select: { _id: true },
                      props: { isRoot: true },
                    },
                  );

                  if (userExists) {
                    const existingMember: TeamMember | null =
                      await TeamMemberService.findOneBy({
                        query: {
                          projectId: projectId,
                          userId: new ObjectID(userId),
                          teamId: targetTeam.id!,
                        },
                        select: { _id: true },
                        props: { isRoot: true },
                      });

                    if (!existingMember) {
                      const newTeamMember: TeamMember = new TeamMember();
                      newTeamMember.projectId = projectId;
                      newTeamMember.userId = new ObjectID(userId);
                      newTeamMember.teamId = targetTeam.id!;
                      newTeamMember.hasAcceptedInvitation = true;
                      newTeamMember.invitationAcceptedAt =
                        OneUptimeDate.getCurrentDate();

                      await TeamMemberService.create({
                        data: newTeamMember,
                        props: { isRoot: true },
                      });

                      // Remove user from Unassigned team since they now have a real group
                      await removeUserFromUnassignedTeam(
                        projectId,
                        new ObjectID(userId),
                      );
                    }
                  }
                }
              }

              const groupResponse: JSONObject = await formatTeamForSCIM(
                targetTeam,
                projectScimId,
                true,
              );

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

              // Update team name if provided
              const displayName: string = data!["displayName"] as string;
              if (displayName && displayName !== team.name) {
                await TeamService.updateOneById({
                  id: team.id!,
                  data: { name: displayName },
                  props: { isRoot: true },
                });
              }

              // Handle members update - replace all members
              const members: Array<SCIMMember> =
                (data!["members"] as Array<SCIMMember>) || [];

              // Remove all existing members
              await TeamMemberService.deleteBy({
                query: {
                  projectId: projectId,
                  teamId: team.id!,
                },
                limit: LIMIT_MAX,
                skip: 0,
                props: { isRoot: true },
              });

              // Add new members
              for (const member of members) {
                const userId: string = member["value"] as string;
                if (userId) {
                  const userExists: User | null = await UserService.findOneById(
                    {
                      id: new ObjectID(userId),
                      select: { _id: true },
                      props: { isRoot: true },
                    },
                  );

                  if (userExists) {
                    const newTeamMember: TeamMember = new TeamMember();
                    newTeamMember.projectId = projectId;
                    newTeamMember.userId = new ObjectID(userId);
                    newTeamMember.teamId = team.id!;
                    newTeamMember.hasAcceptedInvitation = true;
                    newTeamMember.invitationAcceptedAt =
                      OneUptimeDate.getCurrentDate();

                    await TeamMemberService.create({
                      data: newTeamMember,
                      props: { isRoot: true },
                    });

                    // Remove user from Unassigned team since they now have a real group
                    await removeUserFromUnassignedTeam(
                      projectId,
                      new ObjectID(userId),
                    );
                  }
                }
              }

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

              const groupResponse: JSONObject = await formatTeamForSCIM(
                updatedTeam || team,
                projectScimId,
                true,
              );

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

              // Handle SCIM patch operations
              const patchOperations: JSONObject[] =
                (data!["Operations"] as JSONObject[]) || [];

              for (const patchOp of patchOperations) {
                const op: string = patchOp["op"] as string;
                const patchPath: string = patchOp["path"] as string;
                const value: SCIMMember[] | string = patchOp["value"] as
                  | SCIMMember[]
                  | string;

                if (patchPath === "members") {
                  if (op === "replace") {
                    // Remove all existing members
                    await TeamMemberService.deleteBy({
                      query: {
                        projectId: projectId,
                        teamId: team.id!,
                      },
                      limit: LIMIT_MAX,
                      skip: 0,
                      props: { isRoot: true },
                    });

                    // Add new members
                    const membersToAdd: Array<SCIMMember> =
                      (value as SCIMMember[]) || [];
                    for (const member of membersToAdd) {
                      const userId: string = member["value"] as string;
                      if (userId) {
                        const userExists: User | null =
                          await UserService.findOneById({
                            id: new ObjectID(userId),
                            select: { _id: true },
                            props: { isRoot: true },
                          });

                        if (userExists) {
                          const newTeamMember: TeamMember = new TeamMember();
                          newTeamMember.projectId = projectId;
                          newTeamMember.userId = new ObjectID(userId);
                          newTeamMember.teamId = team.id!;
                          newTeamMember.hasAcceptedInvitation = true;
                          newTeamMember.invitationAcceptedAt =
                            OneUptimeDate.getCurrentDate();

                          await TeamMemberService.create({
                            data: newTeamMember,
                            props: { isRoot: true },
                          });

                          // Remove user from Unassigned team since they now have a real group
                          await removeUserFromUnassignedTeam(
                            projectId,
                            new ObjectID(userId),
                          );
                        }
                      }
                    }
                  } else if (op === "add") {
                    const membersToAdd: Array<SCIMMember> =
                      (value as SCIMMember[]) || [];
                    for (const member of membersToAdd) {
                      const userId: string = member["value"] as string;
                      if (userId) {
                        const existingMember: TeamMember | null =
                          await TeamMemberService.findOneBy({
                            query: {
                              projectId: projectId,
                              userId: new ObjectID(userId),
                              teamId: team.id!,
                            },
                            select: { _id: true },
                            props: { isRoot: true },
                          });

                        if (!existingMember) {
                          const userExists: User | null =
                            await UserService.findOneById({
                              id: new ObjectID(userId),
                              select: { _id: true },
                              props: { isRoot: true },
                            });

                          if (userExists) {
                            const newTeamMember: TeamMember = new TeamMember();
                            newTeamMember.projectId = projectId;
                            newTeamMember.userId = new ObjectID(userId);
                            newTeamMember.teamId = team.id!;
                            newTeamMember.hasAcceptedInvitation = true;
                            newTeamMember.invitationAcceptedAt =
                              OneUptimeDate.getCurrentDate();

                            await TeamMemberService.create({
                              data: newTeamMember,
                              props: { isRoot: true },
                            });

                            // Remove user from Unassigned team since they now have a real group
                            await removeUserFromUnassignedTeam(
                              projectId,
                              new ObjectID(userId),
                            );
                          }
                        }
                      }
                    }
                  } else if (op === "remove") {
                    const membersToRemove: Array<SCIMMember> =
                      (value as SCIMMember[]) || [];
                    for (const member of membersToRemove) {
                      const userId: string = member["value"] as string;
                      if (userId) {
                        await TeamMemberService.deleteBy({
                          query: {
                            projectId: projectId,
                            userId: new ObjectID(userId),
                            teamId: team.id!,
                          },
                          limit: LIMIT_MAX,
                          skip: 0,
                          props: { isRoot: true },
                        });
                      }
                    }
                  }
                } else if (patchPath === "displayName" && op === "replace") {
                  const newName: string = value as string;
                  if (newName) {
                    await TeamService.updateOneById({
                      id: team.id!,
                      data: { name: newName },
                      props: { isRoot: true },
                    });
                  }
                }
              }

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

              const groupResponse: JSONObject = await formatTeamForSCIM(
                updatedTeam || team,
                projectScimId,
                true,
              );

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
          const error: Error = err as Error;
          let status: number = 500;
          let scimType: SCIMErrorType | undefined;

          if (error.constructor.name === "BadRequestException") {
            status = 400;
            scimType = SCIMErrorType.InvalidValue;
          } else if (error.constructor.name === "NotFoundException") {
            status = 404;
            scimType = SCIMErrorType.NoTarget;
          }

          operationResult = {
            method: method,
            bulkId: bulkId,
            status: status.toString(),
            response: generateSCIMErrorResponse(
              status,
              error.message,
              scimType,
            ),
          };

          logger.debug(
            `Project SCIM Bulk - operation failed: ${error.message}`,
          );

          // Check if we should stop processing due to failOnErrors
          if (failOnErrors > 0 && errorCount >= failOnErrors) {
            logger.debug(
              `Project SCIM Bulk - stopping due to failOnErrors threshold (${failOnErrors})`,
            );
            results.push(operationResult);
            break;
          }
        }

        results.push(operationResult);
      }

      logger.debug(
        `Project SCIM Bulk - completed processing ${results.length} operations with ${errorCount} errors`,
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

      return Response.sendJsonObjectResponse(req, res, bulkResponse);
    } catch (err) {
      executionSteps.push(`Error occurred: ${(err as Error).message}`);
      // Log the error
      const oneuptimeRequestErr: OneUptimeRequest = req as OneUptimeRequest;
      const bearerDataErr: JSONObject =
        oneuptimeRequestErr.bearerTokenData as JSONObject;
      void createProjectSCIMLog({
        projectId: bearerDataErr["projectId"] as ObjectID,
        projectScimId: new ObjectID(req.params["projectScimId"]!),
        operationType: "BulkOperation",
        status: SCIMLogStatus.Error,
        statusMessage: (err as Error).message,
        httpMethod: "POST",
        requestPath: req.path,
        httpStatusCode: 500,
        requestBody: req.body,
        steps: executionSteps,
      });

      logger.error(err);
      return next(err);
    }
  },
);

// Basic Users endpoint - GET /scim/v2/Users
router.get(
  "/scim/v2/:projectScimId/Users",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    const executionSteps: string[] = [];
    executionSteps.push("Received SCIM ListUsers request");

    try {
      logger.debug(
        `Project SCIM Users list - scimId: ${req.params["projectScimId"]!}`,
      );

      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const scimConfig: ProjectSCIM = bearerData["scimConfig"] as ProjectSCIM;

      executionSteps.push("Authenticated and extracted project context");

      // Parse query parameters
      const { startIndex, count } = parseSCIMQueryParams(req);
      const filter: string = req.query["filter"] as string;
      executionSteps.push(
        `Parsed query params: startIndex=${startIndex}, count=${count}, filter=${filter || "none"}`,
      );

      logger.debug(
        `Project SCIM Users list - scimId: ${req.params["projectScimId"]!}, startIndex: ${startIndex}, count: ${count}, filter: ${filter || "none"}`,
      );

      // Build query for team members in this project
      const query: Query<TeamMember> = {
        projectId: projectId,
      };

      // Handle SCIM filter for userName
      let userCreatedDuringFilter: boolean = false;
      let filterEmail: string | undefined;
      if (filter) {
        executionSteps.push("Processing SCIM filter");
        const emailMatch: RegExpMatchArray | null = filter.match(
          /userName eq "([^"]+)"/i,
        );
        if (emailMatch) {
          const email: string = emailMatch[1]!;
          filterEmail = email;
          logger.debug(
            `Project SCIM Users list - scimId: ${req.params["projectScimId"]!}, filter by email: ${email}`,
          );
          executionSteps.push(`Filter parsed: userName eq "${email}"`);

          if (email) {
            if (Email.isValid(email)) {
              executionSteps.push(`Looking up user by email: ${email}`);
              const user: User | null = await UserService.findOneBy({
                query: { email: new Email(email) },
                select: { _id: true },
                props: { isRoot: true },
              });
              if (user && user.id) {
                query.userId = user.id;
                logger.debug(
                  `Project SCIM Users list - scimId: ${req.params["projectScimId"]!}, found user with id: ${user.id}`,
                );
                executionSteps.push(`Found existing user with ID: ${user.id}`);
              } else {
                logger.debug(
                  `Project SCIM Users list - scimId: ${req.params["projectScimId"]!}, user not found for email: ${email}`,
                );
                executionSteps.push(`User not found for email: ${email}`);

                // Check if auto-provisioning is enabled
                if (!scimConfig.autoProvisionUsers) {
                  executionSteps.push(
                    "Auto-provisioning disabled, returning empty list",
                  );
                  const emptyResponse: JSONObject = generateUsersListResponse(
                    [],
                    startIndex,
                    0,
                  );
                  void createProjectSCIMLog({
                    projectId: projectId,
                    projectScimId: new ObjectID(req.params["projectScimId"]!),
                    operationType: "ListUsers",
                    status: SCIMLogStatus.Success,
                    httpMethod: "GET",
                    requestPath: req.path,
                    httpStatusCode: 200,
                    responseBody: emptyResponse,
                    queryParams: { filter, startIndex, count } as JSONObject,
                    steps: executionSteps,
                    additionalContext: {
                      filterEmail: email,
                      userFound: false,
                      autoProvisionEnabled: false,
                    },
                  });
                  return Response.sendJsonObjectResponse(
                    req,
                    res,
                    emptyResponse,
                  );
                }

                // Create the user
                logger.debug(
                  `Project SCIM Users list - creating new user for email: ${email}`,
                );
                executionSteps.push(
                  `Auto-provisioning enabled, creating new user for: ${email}`,
                );
                const newUser: User = await UserService.createByEmail({
                  email: new Email(email),
                  name: new Name(email),
                  isEmailVerified: true,
                  generateRandomPassword: true,
                  props: { isRoot: true },
                });
                userCreatedDuringFilter = true;
                executionSteps.push(`Created new user with ID: ${newUser.id}`);

                // Add user to default teams if configured and push groups is not enabled
                if (
                  scimConfig.teams &&
                  scimConfig.teams.length > 0 &&
                  !scimConfig.enablePushGroups
                ) {
                  logger.debug(
                    `Project SCIM Users list - adding user to ${scimConfig.teams.length} configured teams`,
                  );
                  executionSteps.push(
                    `Adding user to ${scimConfig.teams.length} default teams`,
                  );
                  await handleUserTeamOperations(
                    "add",
                    projectId,
                    newUser.id!,
                    scimConfig,
                  );
                  executionSteps.push("User added to default teams");
                }

                query.userId = newUser.id!;
                logger.debug(
                  `Project SCIM Users list - created user with id: ${newUser.id}`,
                );
              }
            } else {
              logger.debug(
                `Project SCIM Users list - scimId: ${req.params["projectScimId"]!}, invalid email format in filter: ${email}`,
              );
              executionSteps.push(
                `Invalid email format in filter: ${email}, returning empty list`,
              );
              const emptyResponse: JSONObject = generateUsersListResponse(
                [],
                startIndex,
                0,
              );
              void createProjectSCIMLog({
                projectId: projectId,
                projectScimId: new ObjectID(req.params["projectScimId"]!),
                operationType: "ListUsers",
                status: SCIMLogStatus.Warning,
                statusMessage: `Invalid email format in filter: ${email}`,
                httpMethod: "GET",
                requestPath: req.path,
                httpStatusCode: 200,
                responseBody: emptyResponse,
                queryParams: { filter, startIndex, count } as JSONObject,
                steps: executionSteps,
              });
              return Response.sendJsonObjectResponse(req, res, emptyResponse);
            }
          }
        } else {
          executionSteps.push(
            `Filter present but not a userName filter: ${filter}`,
          );
        }
      } else {
        executionSteps.push("No filter provided, listing all users");
      }

      logger.debug(
        `Project SCIM Users list - scimId: ${req.params["projectScimId"]!}, query built for projectId: ${projectId}`,
      );

      // Get team members
      executionSteps.push("Querying team members from database");
      const teamMembers: Array<TeamMember> = await TeamMemberService.findBy({
        query: query,
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
        select: {
          userId: true,
          user: {
            _id: true,
            email: true,
            name: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      });
      executionSteps.push(`Found ${teamMembers.length} team member records`);

      // now get unique users.
      const usersInProjects: Array<JSONObject> = teamMembers
        .filter((tm: TeamMember) => {
          return tm.user && tm.user.id;
        })
        .map((tm: TeamMember) => {
          return formatUserForSCIM(
            tm.user!,
            req,
            req.params["projectScimId"]!,
            "project",
          );
        });

      // remove duplicates
      const uniqueUserIds: Set<string> = new Set<string>();
      const users: Array<JSONObject> = usersInProjects.filter(
        (user: JSONObject) => {
          if (uniqueUserIds.has(user["id"]?.toString() || "")) {
            return false;
          }
          uniqueUserIds.add(user["id"]?.toString() || "");
          return true;
        },
      );
      executionSteps.push(`Deduplicated to ${users.length} unique users`);

      // now paginate the results (startIndex is 1-based in SCIM)
      const paginatedUsers: Array<JSONObject> = users.slice(
        startIndex - 1,
        startIndex - 1 + count,
      );
      executionSteps.push(
        `Paginated results: returning ${paginatedUsers.length} users (page ${Math.floor((startIndex - 1) / count) + 1})`,
      );

      logger.debug(`SCIM Users response prepared with ${users.length} users`);

      const responseBody: JSONObject = generateUsersListResponse(
        paginatedUsers,
        startIndex,
        users.length,
      );
      executionSteps.push("Generated SCIM-compliant ListResponse");

      // Log the operation
      void createProjectSCIMLog({
        projectId: projectId,
        projectScimId: new ObjectID(req.params["projectScimId"]!),
        operationType: "ListUsers",
        status: SCIMLogStatus.Success,
        httpMethod: "GET",
        requestPath: req.path,
        httpStatusCode: 200,
        responseBody: responseBody,
        queryParams: {
          filter: filter || null,
          startIndex,
          count,
        } as JSONObject,
        steps: executionSteps,
        additionalContext: {
          totalUsersInProject: users.length,
          returnedUsersCount: paginatedUsers.length,
          filterEmail: filterEmail || null,
          userCreatedDuringFilter: userCreatedDuringFilter,
          autoProvisionEnabled: scimConfig.autoProvisionUsers,
          pushGroupsEnabled: scimConfig.enablePushGroups,
        },
      });

      return Response.sendJsonObjectResponse(req, res, responseBody);
    } catch (err) {
      executionSteps.push(`Error occurred: ${(err as Error).message}`);
      // Log the error
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      void createProjectSCIMLog({
        projectId: bearerData["projectId"] as ObjectID,
        projectScimId: new ObjectID(req.params["projectScimId"]!),
        operationType: "ListUsers",
        status: SCIMLogStatus.Error,
        statusMessage: (err as Error).message,
        httpMethod: "GET",
        requestPath: req.path,
        httpStatusCode: 500,
        queryParams: {
          filter: req.query["filter"] || null,
          startIndex: req.query["startIndex"] || 1,
          count: req.query["count"] || 100,
        } as JSONObject,
        steps: executionSteps,
      });

      logger.error(err);
      return next(err);
    }
  },
);

// Get Individual User - GET /scim/v2/Users/{id}
router.get(
  "/scim/v2/:projectScimId/Users/:userId",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    const executionSteps: string[] = [];
    executionSteps.push("Received SCIM GetUser request");

    try {
      logger.debug(
        `SCIM Get individual user request for userId: ${req.params["userId"]}, projectScimId: ${req.params["projectScimId"]}`,
      );
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const userId: string = req.params["userId"]!;

      executionSteps.push("Authenticated and extracted project context");
      executionSteps.push(`Looking up user with ID: ${userId}`);

      logger.debug(
        `SCIM Get user - projectId: ${projectId}, userId: ${userId}`,
      );

      if (!userId) {
        executionSteps.push("User ID missing from request");
        throw new BadRequestException("User ID is required");
      }

      // Check if user exists and is part of the project
      executionSteps.push("Querying team membership for user in project");
      const projectUser: TeamMember | null = await TeamMemberService.findOneBy({
        query: {
          projectId: projectId,
          userId: new ObjectID(userId),
        },
        select: {
          userId: true,
          user: {
            _id: true,
            email: true,
            name: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        props: { isRoot: true },
      });

      if (!projectUser || !projectUser.user) {
        logger.debug(
          `SCIM Get user - user not found or not part of project for userId: ${userId}`,
        );
        executionSteps.push(`User not found or not part of project: ${userId}`);
        throw new NotFoundException(
          "User not found or not part of this project",
        );
      }

      logger.debug(`SCIM Get user - found user: ${projectUser.user.id}`);
      executionSteps.push(`Found user: ${projectUser.user.email?.toString()}`);

      const user: JSONObject = formatUserForSCIM(
        projectUser.user,
        req,
        req.params["projectScimId"]!,
        "project",
      );
      executionSteps.push("Formatted user for SCIM response");

      // Log the operation
      void createProjectSCIMLog({
        projectId: projectId,
        projectScimId: new ObjectID(req.params["projectScimId"]!),
        operationType: "GetUser",
        status: SCIMLogStatus.Success,
        httpMethod: "GET",
        requestPath: req.path,
        httpStatusCode: 200,
        affectedUserEmail: projectUser.user.email?.toString(),
        responseBody: user,
        steps: executionSteps,
        userInfo: {
          userId: projectUser.user.id?.toString(),
          email: projectUser.user.email?.toString(),
          name: projectUser.user.name?.toString(),
        },
      });

      return Response.sendJsonObjectResponse(req, res, user);
    } catch (err) {
      executionSteps.push(`Error occurred: ${(err as Error).message}`);
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;

      // Not found is expected behavior for SCIM providers checking if user exists
      const isNotFound: boolean = err instanceof NotFoundException;

      void createProjectSCIMLog({
        projectId: bearerData["projectId"] as ObjectID,
        projectScimId: new ObjectID(req.params["projectScimId"]!),
        operationType: "GetUser",
        status: isNotFound ? SCIMLogStatus.Success : SCIMLogStatus.Error,
        statusMessage: (err as Error).message,
        httpMethod: "GET",
        requestPath: req.path,
        httpStatusCode: isNotFound ? 404 : 500,
        steps: executionSteps,
        additionalContext: {
          requestedUserId: req.params["userId"],
        },
      });

      if (!isNotFound) {
        logger.error(err);
      }
      return next(err);
    }
  },
);

const handleUserUpdate: (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void> = async (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): Promise<void> => {
  const executionSteps: string[] = [];
  executionSteps.push(`Received SCIM UpdateUser request (${req.method})`);

  try {
    logger.debug(
      `SCIM Update user request for userId: ${req.params["userId"]}, projectScimId: ${req.params["projectScimId"]}`,
    );
    const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
    const bearerData: JSONObject =
      oneuptimeRequest.bearerTokenData as JSONObject;
    const projectId: ObjectID = bearerData["projectId"] as ObjectID;
    const userId: string = req.params["userId"]!;
    const scimUser: JSONObject = req.body;

    executionSteps.push("Authenticated and extracted project context");
    executionSteps.push(`Target user ID: ${userId}`);

    logger.debug(
      `SCIM Update user - projectId: ${projectId}, userId: ${userId}`,
    );

    logger.debug(
      `Request body for SCIM Update user: ${JSON.stringify(scimUser, null, 2)}`,
    );

    if (!userId) {
      executionSteps.push("User ID missing from request");
      throw new BadRequestException("User ID is required");
    }

    // Check if user exists and is part of the project
    executionSteps.push("Querying team membership for user in project");
    const projectUser: TeamMember | null = await TeamMemberService.findOneBy({
      query: {
        projectId: projectId,
        userId: new ObjectID(userId),
      },
      select: {
        userId: true,
        user: {
          _id: true,
          email: true,
          name: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      props: { isRoot: true },
    });

    if (!projectUser || !projectUser.user) {
      logger.debug(
        `SCIM Update user - user not found or not part of project for userId: ${userId}`,
      );
      executionSteps.push(`User not found or not part of project: ${userId}`);
      throw new NotFoundException("User not found or not part of this project");
    }
    executionSteps.push(
      `Found existing user: ${projectUser.user.email?.toString()}`,
    );

    // Update user information
    const email: string =
      (scimUser["userName"] as string) ||
      ((scimUser["emails"] as JSONObject[])?.[0]?.["value"] as string);
    const name: string = parseNameFromSCIM(scimUser);
    const active: boolean = scimUser["active"] as boolean;

    executionSteps.push(
      `Parsed update fields - email: ${email || "unchanged"}, name: ${name || "unchanged"}, active: ${active !== undefined ? active : "unchanged"}`,
    );

    logger.debug(
      `SCIM Update user - email: ${email}, name: ${name}, active: ${active}`,
    );

    const scimConfig: ProjectSCIM = bearerData["scimConfig"] as ProjectSCIM;
    let teamOperationPerformed: string | null = null;

    // Handle user deactivation by removing from teams
    if (active === false && !scimConfig.enablePushGroups) {
      logger.debug(
        `SCIM Update user - user marked as inactive, removing from teams`,
      );
      executionSteps.push(
        "User marked as inactive, removing from configured teams",
      );
      await handleUserTeamOperations(
        "remove",
        projectId,
        new ObjectID(userId),
        scimConfig,
      );
      teamOperationPerformed = "removed_from_teams";
      logger.debug(
        `SCIM Update user - user successfully removed from teams due to deactivation`,
      );
      executionSteps.push("User successfully removed from configured teams");
    }

    // Handle user activation by adding to teams
    if (active === true && !scimConfig.enablePushGroups) {
      logger.debug(`SCIM Update user - user marked as active, adding to teams`);
      executionSteps.push("User marked as active, adding to configured teams");
      await handleUserTeamOperations(
        "add",
        projectId,
        new ObjectID(userId),
        scimConfig,
      );
      teamOperationPerformed = "added_to_teams";
      logger.debug(
        `SCIM Update user - user successfully added to teams due to activation`,
      );
      executionSteps.push("User successfully added to configured teams");
    }

    if (email || name) {
      const updateData: any = {};
      if (email) {
        updateData.email = new Email(email);
      }
      if (name) {
        updateData.name = new Name(name);
      }

      logger.debug(
        `SCIM Update user - updating user with data: ${JSON.stringify(updateData)}`,
      );
      executionSteps.push(`Updating user record in database`);

      await UserService.updateOneById({
        id: new ObjectID(userId),
        data: updateData,
        props: { isRoot: true },
      });

      logger.debug(`SCIM Update user - user updated successfully`);
      executionSteps.push("User record updated successfully");

      // Fetch updated user
      executionSteps.push("Fetching updated user from database");
      const updatedUser: User | null = await UserService.findOneById({
        id: new ObjectID(userId),
        select: {
          _id: true,
          email: true,
          name: true,
          createdAt: true,
          updatedAt: true,
        },
        props: { isRoot: true },
      });

      if (updatedUser) {
        const user: JSONObject = formatUserForSCIM(
          updatedUser,
          req,
          req.params["projectScimId"]!,
          "project",
        );
        executionSteps.push("Formatted updated user for SCIM response");

        // Log the operation
        void createProjectSCIMLog({
          projectId: projectId,
          projectScimId: new ObjectID(req.params["projectScimId"]!),
          operationType: "UpdateUser",
          status: SCIMLogStatus.Success,
          httpMethod: req.method,
          requestPath: req.path,
          httpStatusCode: 200,
          affectedUserEmail: email,
          requestBody: scimUser,
          responseBody: user,
          steps: executionSteps,
          userInfo: {
            userId: updatedUser.id?.toString(),
            email: updatedUser.email?.toString(),
            name: updatedUser.name?.toString(),
            previousEmail: projectUser.user.email?.toString(),
            previousName: projectUser.user.name?.toString(),
          },
          additionalContext: {
            httpMethod: req.method,
            activeStatus: active,
            teamOperationPerformed: teamOperationPerformed,
            pushGroupsEnabled: scimConfig.enablePushGroups,
            fieldsUpdated: Object.keys(updateData),
          },
        });

        return Response.sendJsonObjectResponse(req, res, user);
      }
    }

    logger.debug(`SCIM Update user - no updates made, returning existing user`);
    executionSteps.push("No field updates required, returning existing user");

    // If no updates were made, return the existing user
    const user: JSONObject = formatUserForSCIM(
      projectUser.user,
      req,
      req.params["projectScimId"]!,
      "project",
    );

    // Log the operation
    void createProjectSCIMLog({
      projectId: projectId,
      projectScimId: new ObjectID(req.params["projectScimId"]!),
      operationType: "UpdateUser",
      status: SCIMLogStatus.Success,
      httpMethod: req.method,
      requestPath: req.path,
      httpStatusCode: 200,
      affectedUserEmail: projectUser.user.email?.toString(),
      requestBody: scimUser,
      responseBody: user,
      steps: executionSteps,
      userInfo: {
        userId: projectUser.user.id?.toString(),
        email: projectUser.user.email?.toString(),
        name: projectUser.user.name?.toString(),
      },
      additionalContext: {
        httpMethod: req.method,
        activeStatus: active,
        teamOperationPerformed: teamOperationPerformed,
        pushGroupsEnabled: scimConfig.enablePushGroups,
        noFieldsUpdated: true,
      },
    });

    return Response.sendJsonObjectResponse(req, res, user);
  } catch (err) {
    executionSteps.push(`Error occurred: ${(err as Error).message}`);
    const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
    const bearerData: JSONObject =
      oneuptimeRequest.bearerTokenData as JSONObject;

    // Not found is expected behavior for SCIM providers
    const isNotFound: boolean = err instanceof NotFoundException;

    void createProjectSCIMLog({
      projectId: bearerData["projectId"] as ObjectID,
      projectScimId: new ObjectID(req.params["projectScimId"]!),
      operationType: "UpdateUser",
      status: isNotFound ? SCIMLogStatus.Success : SCIMLogStatus.Error,
      statusMessage: (err as Error).message,
      httpMethod: req.method,
      requestPath: req.path,
      httpStatusCode: isNotFound ? 404 : 400,
      requestBody: req.body,
      steps: executionSteps,
      additionalContext: {
        requestedUserId: req.params["userId"],
      },
    });

    if (!isNotFound) {
      logger.error(err);
    }
    return next(err);
  }
};

// Update User - PUT /scim/v2/Users/{id}
router.put(
  "/scim/v2/:projectScimId/Users/:userId",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  handleUserUpdate,
);

// Update User - PATCH /scim/v2/Users/{id}
router.patch(
  "/scim/v2/:projectScimId/Users/:userId",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  handleUserUpdate,
);

// Groups endpoint - GET /scim/v2/Groups
router.get(
  "/scim/v2/:projectScimId/Groups",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    const executionSteps: string[] = [];
    executionSteps.push("Received SCIM ListGroups request");

    try {
      logger.debug(
        `SCIM Groups list request for projectScimId: ${req.params["projectScimId"]}`,
      );
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;

      executionSteps.push("Authenticated and extracted project context");

      // Parse query parameters
      const { startIndex, count } = parseSCIMQueryParams(req);
      const filter: string = req.query["filter"] as string;
      executionSteps.push(
        `Parsed query params: startIndex=${startIndex}, count=${count}, filter=${filter || "none"}`,
      );

      logger.debug(
        `SCIM Groups list - projectId: ${projectId}, startIndex: ${startIndex}, count: ${count}, filter: ${filter || "none"}`,
      );

      // Build query for teams in this project
      const query: Query<Team> = {
        projectId: projectId,
      };

      // Handle SCIM filter for displayName
      let filterDisplayName: string | undefined;
      if (filter) {
        executionSteps.push("Processing SCIM filter");
        const nameMatch: RegExpMatchArray | null = filter.match(
          /displayName eq "([^"]+)"/i,
        );
        if (nameMatch) {
          const displayName: string = nameMatch[1]!;
          filterDisplayName = displayName;
          logger.debug(
            `SCIM Groups list - filter by displayName: ${displayName}`,
          );
          executionSteps.push(`Filter parsed: displayName eq "${displayName}"`);
          query.name = displayName;
        } else {
          executionSteps.push(
            `Filter present but not a displayName filter: ${filter}`,
          );
        }
      } else {
        executionSteps.push("No filter provided, listing all groups");
      }

      // Get teams
      executionSteps.push("Querying teams from database");
      const teams: Array<Team> = await TeamService.findBy({
        query: query,
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
        select: {
          _id: true,
          name: true,
          createdAt: true,
          updatedAt: true,
          projectId: true,
        },
      });
      executionSteps.push(`Found ${teams.length} teams`);

      // Format teams as SCIM groups
      executionSteps.push("Formatting teams as SCIM groups");
      const groupsPromises: Array<Promise<JSONObject>> = teams.map(
        (team: Team) => {
          return formatTeamForSCIM(team, req.params["projectScimId"]!, false);
        }, // Don't include members for list to avoid performance issues
      );

      const groups: Array<JSONObject> = await Promise.all(groupsPromises);

      // Paginate results (startIndex is 1-based in SCIM)
      const paginatedGroups: Array<JSONObject> = groups.slice(
        startIndex - 1,
        startIndex - 1 + count,
      );
      executionSteps.push(
        `Paginated results: returning ${paginatedGroups.length} groups (page ${Math.floor((startIndex - 1) / count) + 1})`,
      );

      logger.debug(
        `SCIM Groups response prepared with ${groups.length} groups`,
      );

      const responseBody: JSONObject = {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        totalResults: groups.length,
        startIndex: startIndex,
        itemsPerPage: paginatedGroups.length,
        Resources: paginatedGroups,
      };
      executionSteps.push("Generated SCIM-compliant ListResponse");

      // Log the operation
      void createProjectSCIMLog({
        projectId: projectId,
        projectScimId: new ObjectID(req.params["projectScimId"]!),
        operationType: "ListGroups",
        status: SCIMLogStatus.Success,
        httpMethod: "GET",
        requestPath: req.path,
        httpStatusCode: 200,
        responseBody: responseBody,
        queryParams: {
          filter: filter || null,
          startIndex,
          count,
        } as JSONObject,
        steps: executionSteps,
        additionalContext: {
          totalGroupsInProject: groups.length,
          returnedGroupsCount: paginatedGroups.length,
          filterDisplayName: filterDisplayName || null,
        },
      });

      return Response.sendJsonObjectResponse(req, res, responseBody);
    } catch (err) {
      executionSteps.push(`Error occurred: ${(err as Error).message}`);
      // Log the error
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      void createProjectSCIMLog({
        projectId: bearerData["projectId"] as ObjectID,
        projectScimId: new ObjectID(req.params["projectScimId"]!),
        operationType: "ListGroups",
        status: SCIMLogStatus.Error,
        statusMessage: (err as Error).message,
        httpMethod: "GET",
        requestPath: req.path,
        httpStatusCode: 500,
        queryParams: {
          filter: req.query["filter"] || null,
          startIndex: req.query["startIndex"] || 1,
          count: req.query["count"] || 100,
        } as JSONObject,
        steps: executionSteps,
      });

      logger.error(err);
      return next(err);
    }
  },
);

// Get Individual Group - GET /scim/v2/Groups/{id}
router.get(
  "/scim/v2/:projectScimId/Groups/:groupId",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    const executionSteps: string[] = [];
    executionSteps.push("Received SCIM GetGroup request");

    try {
      logger.debug(
        `SCIM Get individual group request for groupId: ${req.params["groupId"]}, projectScimId: ${req.params["projectScimId"]}`,
      );
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const groupId: string = req.params["groupId"]!;

      executionSteps.push("Authenticated and extracted project context");
      executionSteps.push(`Looking up group with ID: ${groupId}`);

      logger.debug(
        `SCIM Get group - projectId: ${projectId}, groupId: ${groupId}`,
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
        },
        props: { isRoot: true },
      });

      if (!team) {
        logger.debug(
          `SCIM Get group - team not found or not part of project for groupId: ${groupId}`,
        );
        executionSteps.push(
          `Team not found or not part of project: ${groupId}`,
        );
        throw new NotFoundException(
          "Group not found or not part of this project",
        );
      }

      logger.debug(`SCIM Get group - found team: ${team.id}`);
      executionSteps.push(`Found team: ${team.name?.toString()}`);

      executionSteps.push("Formatting team as SCIM group with members");
      const group: JSONObject = await formatTeamForSCIM(
        team,
        req.params["projectScimId"]!,
        true, // Include members for individual group request
      );
      const memberCount: number = (group["members"] as Array<any>)?.length || 0;
      executionSteps.push(`Group formatted with ${memberCount} members`);

      // Log the operation
      void createProjectSCIMLog({
        projectId: projectId,
        projectScimId: new ObjectID(req.params["projectScimId"]!),
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

      return Response.sendJsonObjectResponse(req, res, group);
    } catch (err) {
      executionSteps.push(`Error occurred: ${(err as Error).message}`);
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;

      // Not found is expected behavior for SCIM providers checking if group exists
      const isNotFound: boolean = err instanceof NotFoundException;

      void createProjectSCIMLog({
        projectId: bearerData["projectId"] as ObjectID,
        projectScimId: new ObjectID(req.params["projectScimId"]!),
        operationType: "GetGroup",
        status: isNotFound ? SCIMLogStatus.Success : SCIMLogStatus.Error,
        statusMessage: (err as Error).message,
        httpMethod: "GET",
        requestPath: req.path,
        httpStatusCode: isNotFound ? 404 : 500,
        steps: executionSteps,
        additionalContext: {
          requestedGroupId: req.params["groupId"],
        },
      });

      if (!isNotFound) {
        logger.error(err);
      }
      return next(err);
    }
  },
);

// Create Group - POST /scim/v2/Groups
router.post(
  "/scim/v2/:projectScimId/Groups",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    const executionSteps: string[] = [];
    executionSteps.push("Received SCIM CreateGroup request");

    try {
      logger.debug(
        `SCIM Create group request for projectScimId: ${req.params["projectScimId"]}`,
      );
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const scimGroup: JSONObject = req.body;

      executionSteps.push("Authenticated and extracted project context");

      const displayName: string = scimGroup["displayName"] as string;

      logger.debug(`SCIM Create group - displayName: ${displayName}`);
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
        );
        executionSteps.push(
          `Team already exists with ID: ${existingTeam.id}, reusing`,
        );
        targetTeam = existingTeam;
      } else {
        // Create new team
        logger.debug(`SCIM Create group - creating new team: ${displayName}`);
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
        );
        executionSteps.push(`Created new team with ID: ${createdTeam.id}`);

        targetTeam = createdTeam;
        createdNewTeam = true;
      }

      // Handle members if provided. Adds any new members and leaves existing ones intact.
      const members: Array<SCIMMember> =
        (scimGroup["members"] as Array<SCIMMember>) || [];
      let membersAdded: number = 0;
      let membersSkipped: number = 0;
      if (members.length > 0) {
        logger.debug(
          `SCIM Create group - ensuring ${members.length} members are part of team ${targetTeam.id}`,
        );
        executionSteps.push(
          `Processing ${members.length} members from request`,
        );
        for (const member of members) {
          const userId: string = member["value"] as string;
          if (userId) {
            // Check if user exists
            const userExists: User | null = await UserService.findOneById({
              id: new ObjectID(userId),
              select: { _id: true },
              props: { isRoot: true },
            });

            if (userExists) {
              // Check if user is already a member of the team
              const existingMember: TeamMember | null =
                await TeamMemberService.findOneBy({
                  query: {
                    projectId: projectId,
                    userId: new ObjectID(userId),
                    teamId: targetTeam.id!,
                  },
                  select: { _id: true },
                  props: { isRoot: true },
                });

              if (!existingMember) {
                // Add user to the team
                const newTeamMember: TeamMember = new TeamMember();
                newTeamMember.projectId = projectId;
                newTeamMember.userId = new ObjectID(userId);
                newTeamMember.teamId = targetTeam.id!;
                newTeamMember.hasAcceptedInvitation = true;
                newTeamMember.invitationAcceptedAt =
                  OneUptimeDate.getCurrentDate();

                await TeamMemberService.create({
                  data: newTeamMember,
                  props: {
                    isRoot: true,
                  },
                });

                // Remove user from "Unassigned" team since they now have a real group
                await removeUserFromUnassignedTeam(projectId, new ObjectID(userId));

                membersAdded++;
                logger.debug(
                  `SCIM Create group - added user ${userId} to team ${targetTeam.id}`,
                );
              } else {
                membersSkipped++;
              }
            } else {
              membersSkipped++;
            }
          }
        }
        executionSteps.push(
          `Members processed: ${membersAdded} added, ${membersSkipped} skipped (already members or not found)`,
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

      const groupResponse: JSONObject = await formatTeamForSCIM(
        teamForResponse,
        req.params["projectScimId"]!,
        true,
      );
      const finalMemberCount: number =
        (groupResponse["members"] as Array<any>)?.length || 0;
      executionSteps.push(
        `Group formatted with ${finalMemberCount} total members`,
      );

      logger.debug(
        `SCIM Create group - returning group with id: ${teamForResponse.id}`,
      );

      // Log the operation
      void createProjectSCIMLog({
        projectId: projectId,
        projectScimId: new ObjectID(req.params["projectScimId"]!),
        operationType: "CreateGroup",
        status: SCIMLogStatus.Success,
        httpMethod: "POST",
        requestPath: req.path,
        httpStatusCode: createdNewTeam ? 201 : 200,
        affectedGroupName: displayName,
        requestBody: scimGroup,
        responseBody: groupResponse,
        steps: executionSteps,
        groupInfo: {
          groupId: teamForResponse.id?.toString(),
          displayName: displayName,
          wasNewlyCreated: createdNewTeam,
          membersAdded: membersAdded,
          membersSkipped: membersSkipped,
          totalMembers: finalMemberCount,
        },
      });

      if (createdNewTeam) {
        res.status(201);
      } else {
        res.status(200);
      }

      return Response.sendJsonObjectResponse(req, res, groupResponse);
    } catch (err) {
      executionSteps.push(`Error occurred: ${(err as Error).message}`);
      // Log the error
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      void createProjectSCIMLog({
        projectId: bearerData["projectId"] as ObjectID,
        projectScimId: new ObjectID(req.params["projectScimId"]!),
        operationType: "CreateGroup",
        status: SCIMLogStatus.Error,
        statusMessage: (err as Error).message,
        httpMethod: "POST",
        requestPath: req.path,
        httpStatusCode: 400,
        requestBody: req.body,
        steps: executionSteps,
      });

      logger.error(err);
      return next(err);
    }
  },
);

// Update Group - PUT /scim/v2/Groups/{id}
router.put(
  "/scim/v2/:projectScimId/Groups/:groupId",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    const executionSteps: string[] = [];
    executionSteps.push("Received SCIM UpdateGroup (PUT) request");

    try {
      logger.debug(
        `SCIM Update group request for groupId: ${req.params["groupId"]}, projectScimId: ${req.params["projectScimId"]}`,
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
      );

      logger.debug(
        `Request body for SCIM Update group: ${JSON.stringify(scimGroup, null, 2)}`,
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

      // Update team name if provided
      const displayName: string = scimGroup["displayName"] as string;
      let nameUpdated: boolean = false;
      if (displayName && displayName !== team.name) {
        logger.debug(`SCIM Update group - updating name to: ${displayName}`);
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
      );
      executionSteps.push(
        `Replacing all members with ${members.length} members from request`,
      );

      // Remove all existing members
      executionSteps.push("Removing all existing team members");
      await TeamMemberService.deleteBy({
        query: {
          projectId: projectId,
          teamId: team.id!,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

      // Add new members
      let membersAdded: number = 0;
      let membersSkipped: number = 0;
      for (const member of members) {
        const userId: string = member["value"] as string;
        if (userId) {
          // Check if user exists
          const userExists: User | null = await UserService.findOneById({
            id: new ObjectID(userId),
            select: { _id: true },
            props: { isRoot: true },
          });

          if (userExists) {
            // Check if user is already a member of the team
            const existingMember: TeamMember | null =
              await TeamMemberService.findOneBy({
                query: {
                  projectId: projectId,
                  userId: new ObjectID(userId),
                  teamId: team.id!,
                },
                select: { _id: true },
                props: { isRoot: true },
              });

            if (!existingMember) {
              const newTeamMember: TeamMember = new TeamMember();
              newTeamMember.projectId = projectId;
              newTeamMember.userId = new ObjectID(userId);
              newTeamMember.teamId = team.id!;
              newTeamMember.hasAcceptedInvitation = true;
              newTeamMember.invitationAcceptedAt =
                OneUptimeDate.getCurrentDate();

              await TeamMemberService.create({
                data: newTeamMember,
                props: {
                  isRoot: true,
                },
              });

              // Remove user from "Unassigned" team since they now have a real group
              await removeUserFromUnassignedTeam(projectId, new ObjectID(userId));

              membersAdded++;
              logger.debug(`SCIM Update group - added user ${userId} to team`);
            } else {
              membersSkipped++;
            }
          } else {
            membersSkipped++;
          }
        }
      }
      executionSteps.push(
        `Members added: ${membersAdded}, skipped: ${membersSkipped}`,
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
        const updatedGroup: JSONObject = await formatTeamForSCIM(
          updatedTeam,
          req.params["projectScimId"]!,
          true,
        );
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
            membersSkipped: membersSkipped,
            totalMembers: finalMemberCount,
          },
        });

        return Response.sendJsonObjectResponse(req, res, updatedGroup);
      }

      executionSteps.push("Failed to retrieve team after update");
      throw new NotFoundException("Failed to retrieve updated group");
    } catch (err) {
      executionSteps.push(`Error occurred: ${(err as Error).message}`);
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;

      // Not found is expected behavior for SCIM providers
      const isNotFound: boolean = err instanceof NotFoundException;

      void createProjectSCIMLog({
        projectId: bearerData["projectId"] as ObjectID,
        projectScimId: new ObjectID(req.params["projectScimId"]!),
        operationType: "UpdateGroup",
        status: isNotFound ? SCIMLogStatus.Success : SCIMLogStatus.Error,
        statusMessage: (err as Error).message,
        httpMethod: "PUT",
        requestPath: req.path,
        httpStatusCode: isNotFound ? 404 : 400,
        requestBody: req.body,
        steps: executionSteps,
        additionalContext: {
          requestedGroupId: req.params["groupId"],
        },
      });

      if (!isNotFound) {
        logger.error(err);
      }
      return next(err);
    }
  },
);

// Delete Group - DELETE /scim/v2/Groups/{id}
router.delete(
  "/scim/v2/:projectScimId/Groups/:groupId",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    const executionSteps: string[] = [];
    executionSteps.push("Received SCIM DeleteGroup request");

    try {
      logger.debug(
        `SCIM Delete group request for groupId: ${req.params["groupId"]}, projectScimId: ${req.params["projectScimId"]}`,
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

      logger.debug(`SCIM Delete group - deleting team: ${team.name}`);
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

      logger.debug(`SCIM Delete group - team successfully deleted`);

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

      res.status(204);
      return Response.sendJsonObjectResponse(req, res, {
        message: "Group deleted",
      });
    } catch (err) {
      executionSteps.push(`Error occurred: ${(err as Error).message}`);
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;

      // Not found is expected behavior for SCIM providers
      const isNotFound: boolean = err instanceof NotFoundException;

      void createProjectSCIMLog({
        projectId: bearerData["projectId"] as ObjectID,
        projectScimId: new ObjectID(req.params["projectScimId"]!),
        operationType: "DeleteGroup",
        status: isNotFound ? SCIMLogStatus.Success : SCIMLogStatus.Error,
        statusMessage: (err as Error).message,
        httpMethod: "DELETE",
        requestPath: req.path,
        httpStatusCode: isNotFound ? 404 : 400,
        steps: executionSteps,
        additionalContext: {
          requestedGroupId: req.params["groupId"],
        },
      });

      if (!isNotFound) {
        logger.error(err);
      }
      return next(err);
    }
  },
);

// Update Group Memberships - PATCH /scim/v2/Groups/{id}
router.patch(
  "/scim/v2/:projectScimId/Groups/:groupId",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    const executionSteps: string[] = [];
    executionSteps.push("Received SCIM PatchGroup request");
    let membersAdded: number = 0;
    let membersRemoved: number = 0;
    let membersReplaced: boolean = false;
    let nameUpdated: boolean = false;

    try {
      logger.debug(
        `SCIM Patch group request for groupId: ${req.params["groupId"]}, projectScimId: ${req.params["projectScimId"]}`,
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

      // Handle SCIM patch operations
      const operations: JSONObject[] =
        (scimPatch["Operations"] as JSONObject[]) || [];
      executionSteps.push(`Processing ${operations.length} PATCH operations`);

      for (const operation of operations) {
        const op: string = operation["op"] as string;
        const path: string = operation["path"] as string;
        const value: any = operation["value"];

        executionSteps.push(
          `Processing operation: ${op} on path: ${path || "root"}`,
        );

        if (path === "members") {
          if (op === "replace") {
            // Replace all members
            logger.debug(`SCIM Patch group - replacing all members`);
            executionSteps.push(
              "Replacing all members - removing existing members",
            );
            membersReplaced = true;

            // Remove all existing members
            await TeamMemberService.deleteBy({
              query: {
                projectId: projectId,
                teamId: team.id!,
              },
              limit: LIMIT_MAX,
              skip: 0,
              props: { isRoot: true },
            });

            // Add new members
            const members: Array<SCIMMember> = value || [];
            executionSteps.push(
              `Adding ${members.length} new members after replace`,
            );
            for (const member of members) {
              const userId: string = member["value"] as string;
              if (userId) {
                const userExists: User | null = await UserService.findOneById({
                  id: new ObjectID(userId),
                  select: { _id: true },
                  props: { isRoot: true },
                });

                if (userExists) {
                  // Check if user is already a member of the team
                  const existingMember: TeamMember | null =
                    await TeamMemberService.findOneBy({
                      query: {
                        projectId: projectId,
                        userId: new ObjectID(userId),
                        teamId: team.id!,
                      },
                      select: { _id: true },
                      props: { isRoot: true },
                    });

                  if (!existingMember) {
                    const newTeamMember: TeamMember = new TeamMember();
                    newTeamMember.projectId = projectId;
                    newTeamMember.userId = new ObjectID(userId);
                    newTeamMember.teamId = team.id!;
                    newTeamMember.hasAcceptedInvitation = true;
                    newTeamMember.invitationAcceptedAt =
                      OneUptimeDate.getCurrentDate();

                    await TeamMemberService.create({
                      data: newTeamMember,
                      props: {
                        isRoot: true,
                      },
                    });

                    // Remove user from "Unassigned" team since they now have a real group
                    await removeUserFromUnassignedTeam(
                      projectId,
                      new ObjectID(userId),
                    );

                    membersAdded++;
                    logger.debug(
                      `SCIM Patch group - added user ${userId} to team`,
                    );
                  }
                }
              }
            }
          } else if (op === "add") {
            // Add members
            logger.debug(`SCIM Patch group - adding members`);
            const members: Array<SCIMMember> = value || [];
            executionSteps.push(`Adding ${members.length} members`);
            for (const member of members) {
              const userId: string = member["value"] as string;
              if (userId) {
                // Check if user is already a member
                const existingMember: TeamMember | null =
                  await TeamMemberService.findOneBy({
                    query: {
                      projectId: projectId,
                      userId: new ObjectID(userId),
                      teamId: team.id!,
                    },
                    select: { _id: true },
                    props: { isRoot: true },
                  });

                if (!existingMember) {
                  const userExists: User | null = await UserService.findOneById(
                    {
                      id: new ObjectID(userId),
                      select: { _id: true },
                      props: { isRoot: true },
                    },
                  );

                  if (userExists) {
                    const newTeamMember: TeamMember = new TeamMember();
                    newTeamMember.projectId = projectId;
                    newTeamMember.userId = new ObjectID(userId);
                    newTeamMember.teamId = team.id!;
                    newTeamMember.hasAcceptedInvitation = true;
                    newTeamMember.invitationAcceptedAt =
                      OneUptimeDate.getCurrentDate();

                    await TeamMemberService.create({
                      data: newTeamMember,
                      props: {
                        isRoot: true,
                      },
                    });

                    // Remove user from Unassigned team since they now have a real group
                    await removeUserFromUnassignedTeam(
                      projectId,
                      new ObjectID(userId),
                    );

                    membersAdded++;
                    logger.debug(
                      `SCIM Patch group - added user ${userId} to team`,
                    );
                  }
                }
              }
            }
          } else if (op === "remove") {
            // Remove members
            logger.debug(`SCIM Patch group - removing members`);
            const members: Array<SCIMMember> = value || [];
            executionSteps.push(`Removing ${members.length} members`);
            for (const member of members) {
              const userId: string = member["value"] as string;
              if (userId) {
                await TeamMemberService.deleteBy({
                  query: {
                    projectId: projectId,
                    userId: new ObjectID(userId),
                    teamId: team.id!,
                  },
                  limit: LIMIT_MAX,
                  skip: 0,
                  props: { isRoot: true },
                });
                membersRemoved++;
                logger.debug(
                  `SCIM Patch group - removed user ${userId} from team`,
                );
              }
            }
          }
        } else if (path === "displayName" && op === "replace") {
          // Update display name
          const newName: string = value as string;
          if (newName) {
            logger.debug(
              `SCIM Patch group - updating displayName to: ${newName}`,
            );
            executionSteps.push(
              `Updating displayName from "${team.name}" to "${newName}"`,
            );
            await TeamService.updateOneById({
              id: team.id!,
              data: { name: newName },
              props: { isRoot: true },
            });
            nameUpdated = true;
          }
        }
      }
      executionSteps.push(
        `Operations completed: ${membersAdded} added, ${membersRemoved} removed, replaced=${membersReplaced}, nameUpdated=${nameUpdated}`,
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
        const updatedGroup: JSONObject = await formatTeamForSCIM(
          updatedTeam,
          req.params["projectScimId"]!,
          true,
        );
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
            membersRemoved: membersRemoved,
            membersReplaced: membersReplaced,
            totalMembers: finalMemberCount,
            operationsCount: operations.length,
          },
        });

        return Response.sendJsonObjectResponse(req, res, updatedGroup);
      }

      executionSteps.push("Failed to retrieve team after update");
      throw new NotFoundException("Failed to retrieve updated group");
    } catch (err) {
      executionSteps.push(`Error occurred: ${(err as Error).message}`);
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;

      // Not found is expected behavior for SCIM providers
      const isNotFound: boolean = err instanceof NotFoundException;

      void createProjectSCIMLog({
        projectId: bearerData["projectId"] as ObjectID,
        projectScimId: new ObjectID(req.params["projectScimId"]!),
        operationType: "UpdateGroup",
        status: isNotFound ? SCIMLogStatus.Success : SCIMLogStatus.Error,
        statusMessage: (err as Error).message,
        httpMethod: "PATCH",
        requestPath: req.path,
        httpStatusCode: isNotFound ? 404 : 400,
        requestBody: req.body,
        steps: executionSteps,
        additionalContext: {
          requestedGroupId: req.params["groupId"],
        },
      });

      if (!isNotFound) {
        logger.error(err);
      }
      return next(err);
    }
  },
);

// Create User - POST /scim/v2/Users
router.post(
  "/scim/v2/:projectScimId/Users",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    const executionSteps: string[] = [];
    let email: string = "";
    let name: string = "";
    let userWasCreated: boolean = false;
    let teamsAdded: string[] = [];

    try {
      executionSteps.push("Received SCIM CreateUser request");
      logger.debug(
        `SCIM Create user request for projectScimId: ${req.params["projectScimId"]}`,
      );
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const scimConfig: ProjectSCIM = bearerData["scimConfig"] as ProjectSCIM;

      executionSteps.push(
        "Validated SCIM authentication and extracted project configuration",
      );

      if (!scimConfig.autoProvisionUsers) {
        executionSteps.push(
          "Auto-provisioning is disabled - rejecting request",
        );
        throw new BadRequestException(
          "Auto-provisioning is disabled for this project",
        );
      }

      executionSteps.push("Auto-provisioning is enabled - proceeding");

      const scimUser: JSONObject = req.body;
      email =
        (scimUser["userName"] as string) ||
        ((scimUser["emails"] as JSONObject[])?.[0]?.["value"] as string);
      name = parseNameFromSCIM(scimUser);

      executionSteps.push(
        `Parsed user data from request: email=${email}, name=${name || "not provided"}`,
      );

      logger.debug(`SCIM Create user - email: ${email}, name: ${name}`);

      if (!email) {
        executionSteps.push(
          "Email validation failed - no userName or email provided",
        );
        throw new BadRequestException("userName or email is required");
      }

      executionSteps.push("Checking if user already exists in database");

      // Check if user already exists
      let user: User | null = await UserService.findOneBy({
        query: { email: new Email(email) },
        select: {
          _id: true,
          email: true,
          name: true,
          createdAt: true,
          updatedAt: true,
        },
        props: { isRoot: true },
      });

      // Create user if doesn't exist
      if (!user) {
        executionSteps.push(
          `User does not exist - creating new user with email: ${email}`,
        );
        logger.debug(
          `SCIM Create user - creating new user for email: ${email}`,
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
      } else {
        executionSteps.push(
          `User already exists with ID: ${user.id?.toString()} - will link to project`,
        );
        logger.debug(
          `SCIM Create user - user already exists with id: ${user.id}`,
        );
      }

      // Add user to default teams if configured and push groups is not enabled
      if (
        scimConfig.teams &&
        scimConfig.teams.length > 0 &&
        !scimConfig.enablePushGroups
      ) {
        executionSteps.push(
          `Adding user to ${scimConfig.teams.length} configured default teams`,
        );
        logger.debug(
          `SCIM Create user - adding user to ${scimConfig.teams.length} configured teams`,
        );
        await handleUserTeamOperations("add", projectId, user.id!, scimConfig);
        teamsAdded = scimConfig.teams.map((t: Team) => {
          return t.name || t.id?.toString() || "unknown";
        });
        executionSteps.push(`User added to teams: ${teamsAdded.join(", ")}`);
      } else if (scimConfig.enablePushGroups) {
        executionSteps.push(
          "Push groups enabled - adding user to 'Unassigned' team until group assignment",
        );
        // Add user to "Unassigned" team until they get assigned to a real group
        const unassignedTeam: Team = await addUserToUnassignedTeam(
          projectId,
          user.id!,
        );
        teamsAdded = [UNASSIGNED_TEAM_NAME];
        executionSteps.push(
          `User added to "Unassigned" team (ID: ${unassignedTeam.id?.toString()})`,
        );
      } else {
        executionSteps.push(
          "No default teams configured - adding user to 'Unassigned' team",
        );
        // Add user to "Unassigned" team when no default teams configured
        const unassignedTeam: Team = await addUserToUnassignedTeam(
          projectId,
          user.id!,
        );
        teamsAdded = [UNASSIGNED_TEAM_NAME];
        executionSteps.push(
          `User added to "Unassigned" team (ID: ${unassignedTeam.id?.toString()})`,
        );
      }

      const createdUser: JSONObject = formatUserForSCIM(
        user,
        req,
        req.params["projectScimId"]!,
        "project",
      );

      executionSteps.push("Formatted user response in SCIM format");
      executionSteps.push(
        `Operation completed successfully - returning user with ID: ${user.id?.toString()}`,
      );

      logger.debug(
        `SCIM Create user - returning created user with id: ${user.id}`,
      );

      // Log the operation
      void createProjectSCIMLog({
        projectId: projectId,
        projectScimId: new ObjectID(req.params["projectScimId"]!),
        operationType: "CreateUser",
        status: SCIMLogStatus.Success,
        httpMethod: "POST",
        requestPath: req.path,
        httpStatusCode: 201,
        affectedUserEmail: email,
        requestBody: scimUser,
        responseBody: createdUser,
        steps: executionSteps,
        userInfo: {
          userId: user.id?.toString(),
          email: email,
          name: name || "Unknown",
          wasNewlyCreated: userWasCreated,
        },
        additionalContext: {
          autoProvisionEnabled: scimConfig.autoProvisionUsers,
          pushGroupsEnabled: scimConfig.enablePushGroups,
          teamsAssigned: teamsAdded,
          defaultTeamsCount: scimConfig.teams?.length || 0,
        },
      });

      res.status(201);
      return Response.sendJsonObjectResponse(req, res, createdUser);
    } catch (err) {
      executionSteps.push(`Error occurred: ${(err as Error).message}`);

      // Log the error
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      void createProjectSCIMLog({
        projectId: bearerData["projectId"] as ObjectID,
        projectScimId: new ObjectID(req.params["projectScimId"]!),
        operationType: "CreateUser",
        status: SCIMLogStatus.Error,
        statusMessage: (err as Error).message,
        httpMethod: "POST",
        requestPath: req.path,
        httpStatusCode: 400,
        requestBody: req.body,
        steps: executionSteps,
        userInfo: email ? { email: email, name: name || undefined } : undefined,
      });

      logger.error(err);
      return next(err);
    }
  },
);

// Delete User - DELETE /scim/v2/Users/{id}
router.delete(
  "/scim/v2/:projectScimId/Users/:userId",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    const executionSteps: string[] = [];
    let userId: string = "";
    let teamsRemoved: string[] = [];

    try {
      executionSteps.push("Received SCIM DeleteUser request");
      logger.debug(
        `SCIM Delete user request for userId: ${req.params["userId"]}, projectScimId: ${req.params["projectScimId"]}`,
      );
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const scimConfig: ProjectSCIM = bearerData["scimConfig"] as ProjectSCIM;
      userId = req.params["userId"]!;

      executionSteps.push(`Processing delete request for user ID: ${userId}`);

      if (!scimConfig.autoDeprovisionUsers) {
        executionSteps.push(
          "Auto-deprovisioning is disabled - rejecting request",
        );
        logger.debug("SCIM Delete user - auto-deprovisioning is disabled");
        throw new BadRequestException(
          "Auto-deprovisioning is disabled for this project",
        );
      }

      executionSteps.push("Auto-deprovisioning is enabled - proceeding");

      if (!userId) {
        executionSteps.push("User ID validation failed - no user ID provided");
        throw new BadRequestException("User ID is required");
      }

      logger.debug(
        `SCIM Delete user - removing user from all teams in project: ${projectId}`,
      );

      // Remove user from teams the SCIM configured, but only if push groups is not enabled
      if (!scimConfig.enablePushGroups) {
        if (!scimConfig.teams || scimConfig.teams.length === 0) {
          executionSteps.push(
            "No teams configured for SCIM - cannot deprovision",
          );
          logger.debug("SCIM Delete user - no teams configured for SCIM");
          throw new BadRequestException("No teams configured for SCIM");
        }

        executionSteps.push(
          `Removing user from ${scimConfig.teams.length} configured teams`,
        );
        await handleUserTeamOperations(
          "remove",
          projectId,
          new ObjectID(userId),
          scimConfig,
        );
        teamsRemoved = scimConfig.teams.map((t: Team) => {
          return t.name || t.id?.toString() || "unknown";
        });
        executionSteps.push(
          `User removed from teams: ${teamsRemoved.join(", ")}`,
        );
      } else {
        executionSteps.push(
          "Push groups enabled - skipping team removal (managed via groups)",
        );
      }

      executionSteps.push("User successfully deprovisioned from project");

      logger.debug(
        `SCIM Delete user - user successfully deprovisioned from project`,
      );

      // Log the operation
      void createProjectSCIMLog({
        projectId: projectId,
        projectScimId: new ObjectID(req.params["projectScimId"]!),
        operationType: "DeleteUser",
        status: SCIMLogStatus.Success,
        httpMethod: "DELETE",
        requestPath: req.path,
        httpStatusCode: 204,
        steps: executionSteps,
        userInfo: {
          userId: userId,
        },
        additionalContext: {
          autoDeprovisionEnabled: scimConfig.autoDeprovisionUsers,
          pushGroupsEnabled: scimConfig.enablePushGroups,
          teamsRemovedFrom: teamsRemoved,
        },
      });

      res.status(204);
      return Response.sendJsonObjectResponse(req, res, {
        message: "User deprovisioned",
      });
    } catch (err) {
      executionSteps.push(`Error occurred: ${(err as Error).message}`);
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;

      // Not found is expected behavior for SCIM providers
      const isNotFound: boolean = err instanceof NotFoundException;

      void createProjectSCIMLog({
        projectId: bearerData["projectId"] as ObjectID,
        projectScimId: new ObjectID(req.params["projectScimId"]!),
        operationType: "DeleteUser",
        status: isNotFound ? SCIMLogStatus.Success : SCIMLogStatus.Error,
        statusMessage: (err as Error).message,
        httpMethod: "DELETE",
        requestPath: req.path,
        httpStatusCode: isNotFound ? 404 : 400,
        steps: executionSteps,
        userInfo: userId ? { userId: userId } : undefined,
      });

      if (!isNotFound) {
        logger.error(err);
      }
      return next(err);
    }
  },
);

export default router;
