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

      // Validate the bulk request
      const validation: { valid: boolean; error?: string } =
        validateBulkRequest(req.body, 1000);
      if (!validation.valid) {
        logger.debug(
          `Project SCIM Bulk - validation failed: ${validation.error}`,
        );
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

      const operations: JSONObject[] = req.body["Operations"] as JSONObject[];
      const failOnErrors: number = (req.body["failOnErrors"] as number) || 0;
      const results: SCIMBulkOperationResponse[] = [];
      let errorCount: number = 0;

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
      });

      return Response.sendJsonObjectResponse(
        req,
        res,
        bulkResponse,
      );
    } catch (err) {
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
    try {
      logger.debug(
        `Project SCIM Users list - scimId: ${req.params["projectScimId"]!}`,
      );

      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const scimConfig: ProjectSCIM = bearerData["scimConfig"] as ProjectSCIM;

      // Parse query parameters
      const { startIndex, count } = parseSCIMQueryParams(req);
      const filter: string = req.query["filter"] as string;

      logger.debug(
        `Project SCIM Users list - scimId: ${req.params["projectScimId"]!}, startIndex: ${startIndex}, count: ${count}, filter: ${filter || "none"}`,
      );

      // Build query for team members in this project
      const query: Query<TeamMember> = {
        projectId: projectId,
      };

      // Handle SCIM filter for userName
      if (filter) {
        const emailMatch: RegExpMatchArray | null = filter.match(
          /userName eq "([^"]+)"/i,
        );
        if (emailMatch) {
          const email: string = emailMatch[1]!;
          logger.debug(
            `Project SCIM Users list - scimId: ${req.params["projectScimId"]!}, filter by email: ${email}`,
          );

          if (email) {
            if (Email.isValid(email)) {
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
              } else {
                logger.debug(
                  `Project SCIM Users list - scimId: ${req.params["projectScimId"]!}, user not found for email: ${email}`,
                );

                // Check if auto-provisioning is enabled
                if (!scimConfig.autoProvisionUsers) {
                  return Response.sendJsonObjectResponse(
                    req,
                    res,
                    generateUsersListResponse([], startIndex, 0),
                  );
                }

                // Create the user
                logger.debug(
                  `Project SCIM Users list - creating new user for email: ${email}`,
                );
                const newUser: User = await UserService.createByEmail({
                  email: new Email(email),
                  name: new Name(email),
                  isEmailVerified: true,
                  generateRandomPassword: true,
                  props: { isRoot: true },
                });

                // Add user to default teams if configured and push groups is not enabled
                if (
                  scimConfig.teams &&
                  scimConfig.teams.length > 0 &&
                  !scimConfig.enablePushGroups
                ) {
                  logger.debug(
                    `Project SCIM Users list - adding user to ${scimConfig.teams.length} configured teams`,
                  );
                  await handleUserTeamOperations(
                    "add",
                    projectId,
                    newUser.id!,
                    scimConfig,
                  );
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
              return Response.sendJsonObjectResponse(
                req,
                res,
                generateUsersListResponse([], startIndex, 0),
              );
            }
          }
        }
      }

      logger.debug(
        `Project SCIM Users list - scimId: ${req.params["projectScimId"]!}, query built for projectId: ${projectId}`,
      );

      // Get team members
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

      // now paginate the results (startIndex is 1-based in SCIM)
      const paginatedUsers: Array<JSONObject> = users.slice(
        startIndex - 1,
        startIndex - 1 + count,
      );

      logger.debug(`SCIM Users response prepared with ${users.length} users`);

      const responseBody: JSONObject = generateUsersListResponse(paginatedUsers, startIndex, users.length);

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
      });

      return Response.sendJsonObjectResponse(
        req,
        res,
        responseBody,
      );
    } catch (err) {
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
    try {
      logger.debug(
        `SCIM Get individual user request for userId: ${req.params["userId"]}, projectScimId: ${req.params["projectScimId"]}`,
      );
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const userId: string = req.params["userId"]!;

      logger.debug(
        `SCIM Get user - projectId: ${projectId}, userId: ${userId}`,
      );

      if (!userId) {
        throw new BadRequestException("User ID is required");
      }

      // Check if user exists and is part of the project
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
        throw new NotFoundException(
          "User not found or not part of this project",
        );
      }

      logger.debug(`SCIM Get user - found user: ${projectUser.user.id}`);

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
        operationType: "GetUser",
        status: SCIMLogStatus.Success,
        httpMethod: "GET",
        requestPath: req.path,
        httpStatusCode: 200,
        affectedUserEmail: projectUser.user.email?.toString(),
        responseBody: user,
      });

      return Response.sendJsonObjectResponse(req, res, user);
    } catch (err) {
      // Log the error
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      void createProjectSCIMLog({
        projectId: bearerData["projectId"] as ObjectID,
        projectScimId: new ObjectID(req.params["projectScimId"]!),
        operationType: "GetUser",
        status: SCIMLogStatus.Error,
        statusMessage: (err as Error).message,
        httpMethod: "GET",
        requestPath: req.path,
        httpStatusCode: 404,
      });

      logger.error(err);
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

    logger.debug(
      `SCIM Update user - projectId: ${projectId}, userId: ${userId}`,
    );

    logger.debug(
      `Request body for SCIM Update user: ${JSON.stringify(scimUser, null, 2)}`,
    );

    if (!userId) {
      throw new BadRequestException("User ID is required");
    }

    // Check if user exists and is part of the project
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
      throw new NotFoundException("User not found or not part of this project");
    }

    // Update user information
    const email: string =
      (scimUser["userName"] as string) ||
      ((scimUser["emails"] as JSONObject[])?.[0]?.["value"] as string);
    const name: string = parseNameFromSCIM(scimUser);
    const active: boolean = scimUser["active"] as boolean;

    logger.debug(
      `SCIM Update user - email: ${email}, name: ${name}, active: ${active}`,
    );

    const scimConfig: ProjectSCIM = bearerData["scimConfig"] as ProjectSCIM;

    // Handle user deactivation by removing from teams
    if (active === false && !scimConfig.enablePushGroups) {
      logger.debug(
        `SCIM Update user - user marked as inactive, removing from teams`,
      );
      await handleUserTeamOperations(
        "remove",
        projectId,
        new ObjectID(userId),
        scimConfig,
      );
      logger.debug(
        `SCIM Update user - user successfully removed from teams due to deactivation`,
      );
    }

    // Handle user activation by adding to teams
    if (active === true && !scimConfig.enablePushGroups) {
      logger.debug(`SCIM Update user - user marked as active, adding to teams`);
      await handleUserTeamOperations(
        "add",
        projectId,
        new ObjectID(userId),
        scimConfig,
      );
      logger.debug(
        `SCIM Update user - user successfully added to teams due to activation`,
      );
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

      await UserService.updateOneById({
        id: new ObjectID(userId),
        data: updateData,
        props: { isRoot: true },
      });

      logger.debug(`SCIM Update user - user updated successfully`);

      // Fetch updated user
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
        });

        return Response.sendJsonObjectResponse(req, res, user);
      }
    }

    logger.debug(`SCIM Update user - no updates made, returning existing user`);

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
    });

    return Response.sendJsonObjectResponse(req, res, user);
  } catch (err) {
    // Log the error
    const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
    const bearerData: JSONObject =
      oneuptimeRequest.bearerTokenData as JSONObject;
    void createProjectSCIMLog({
      projectId: bearerData["projectId"] as ObjectID,
      projectScimId: new ObjectID(req.params["projectScimId"]!),
      operationType: "UpdateUser",
      status: SCIMLogStatus.Error,
      statusMessage: (err as Error).message,
      httpMethod: req.method,
      requestPath: req.path,
      httpStatusCode: 400,
      requestBody: req.body,
    });

    logger.error(err);
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
    try {
      logger.debug(
        `SCIM Groups list request for projectScimId: ${req.params["projectScimId"]}`,
      );
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;

      // Parse query parameters
      const { startIndex, count } = parseSCIMQueryParams(req);
      const filter: string = req.query["filter"] as string;

      logger.debug(
        `SCIM Groups list - projectId: ${projectId}, startIndex: ${startIndex}, count: ${count}, filter: ${filter || "none"}`,
      );

      // Build query for teams in this project
      const query: Query<Team> = {
        projectId: projectId,
      };

      // Handle SCIM filter for displayName
      if (filter) {
        const nameMatch: RegExpMatchArray | null = filter.match(
          /displayName eq "([^"]+)"/i,
        );
        if (nameMatch) {
          const displayName: string = nameMatch[1]!;
          logger.debug(
            `SCIM Groups list - filter by displayName: ${displayName}`,
          );
          query.name = displayName;
        }
      }

      // Get teams
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

      // Format teams as SCIM groups
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
      });

      return Response.sendJsonObjectResponse(req, res, responseBody);
    } catch (err) {
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
    try {
      logger.debug(
        `SCIM Get individual group request for groupId: ${req.params["groupId"]}, projectScimId: ${req.params["projectScimId"]}`,
      );
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const groupId: string = req.params["groupId"]!;

      logger.debug(
        `SCIM Get group - projectId: ${projectId}, groupId: ${groupId}`,
      );

      if (!groupId) {
        throw new BadRequestException("Group ID is required");
      }

      // Check if team exists and is part of the project
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
        throw new NotFoundException(
          "Group not found or not part of this project",
        );
      }

      logger.debug(`SCIM Get group - found team: ${team.id}`);

      const group: JSONObject = await formatTeamForSCIM(
        team,
        req.params["projectScimId"]!,
        true, // Include members for individual group request
      );

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
      });

      return Response.sendJsonObjectResponse(req, res, group);
    } catch (err) {
      // Log the error
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      void createProjectSCIMLog({
        projectId: bearerData["projectId"] as ObjectID,
        projectScimId: new ObjectID(req.params["projectScimId"]!),
        operationType: "GetGroup",
        status: SCIMLogStatus.Error,
        statusMessage: (err as Error).message,
        httpMethod: "GET",
        requestPath: req.path,
        httpStatusCode: 404,
      });

      logger.error(err);
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
    try {
      logger.debug(
        `SCIM Create group request for projectScimId: ${req.params["projectScimId"]}`,
      );
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const scimGroup: JSONObject = req.body;

      const displayName: string = scimGroup["displayName"] as string;

      logger.debug(`SCIM Create group - displayName: ${displayName}`);

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
      let createdNewTeam: boolean = false;

      if (existingTeam) {
        logger.debug(
          `SCIM Create group - team already exists with id: ${existingTeam.id}, reusing existing team`,
        );
        targetTeam = existingTeam;
      } else {
        // Create new team
        logger.debug(`SCIM Create group - creating new team: ${displayName}`);
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

        targetTeam = createdTeam;
        createdNewTeam = true;
      }

      // Handle members if provided. Adds any new members and leaves existing ones intact.
      const members: Array<SCIMMember> =
        (scimGroup["members"] as Array<SCIMMember>) || [];
      if (members.length > 0) {
        logger.debug(
          `SCIM Create group - ensuring ${members.length} members are part of team ${targetTeam.id}`,
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
                logger.debug(
                  `SCIM Create group - added user ${userId} to team ${targetTeam.id}`,
                );
              }
            }
          }
        }
      }

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
        throw new NotFoundException("Failed to retrieve group");
      }

      const groupResponse: JSONObject = await formatTeamForSCIM(
        teamForResponse,
        req.params["projectScimId"]!,
        true,
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
      });

      if (createdNewTeam) {
        res.status(201);
      } else {
        res.status(200);
      }

      return Response.sendJsonObjectResponse(req, res, groupResponse);
    } catch (err) {
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

      logger.debug(
        `SCIM Update group - projectId: ${projectId}, groupId: ${groupId}`,
      );

      logger.debug(
        `Request body for SCIM Update group: ${JSON.stringify(scimGroup, null, 2)}`,
      );

      if (!groupId) {
        throw new BadRequestException("Group ID is required");
      }

      // Check if team exists and is part of the project
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
        throw new NotFoundException(
          "Group not found or not part of this project",
        );
      }

      // Update team name if provided
      const displayName: string = scimGroup["displayName"] as string;
      if (displayName && displayName !== team.name) {
        logger.debug(`SCIM Update group - updating name to: ${displayName}`);
        await TeamService.updateOneById({
          id: team.id!,
          data: { name: displayName },
          props: { isRoot: true },
        });
      }

      // Handle members update - replace all members
      const members: Array<SCIMMember> =
        (scimGroup["members"] as Array<SCIMMember>) || [];

      logger.debug(
        `SCIM Update group - replacing members with ${members.length} members`,
      );

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
              logger.debug(`SCIM Update group - added user ${userId} to team`);
            }
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

      if (updatedTeam) {
        const updatedGroup: JSONObject = await formatTeamForSCIM(
          updatedTeam,
          req.params["projectScimId"]!,
          true,
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
        });

        return Response.sendJsonObjectResponse(req, res, updatedGroup);
      }

      throw new NotFoundException("Failed to retrieve updated group");
    } catch (err) {
      // Log the error
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      void createProjectSCIMLog({
        projectId: bearerData["projectId"] as ObjectID,
        projectScimId: new ObjectID(req.params["projectScimId"]!),
        operationType: "UpdateGroup",
        status: SCIMLogStatus.Error,
        statusMessage: (err as Error).message,
        httpMethod: "PUT",
        requestPath: req.path,
        httpStatusCode: 400,
        requestBody: req.body,
      });

      logger.error(err);
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
    try {
      logger.debug(
        `SCIM Delete group request for groupId: ${req.params["groupId"]}, projectScimId: ${req.params["projectScimId"]}`,
      );
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const groupId: string = req.params["groupId"]!;

      logger.debug(
        `SCIM Delete group - projectId: ${projectId}, groupId: ${groupId}`,
      );

      if (!groupId) {
        throw new BadRequestException("Group ID is required");
      }

      // Check if team exists and is part of the project
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
        throw new NotFoundException(
          "Group not found or not part of this project",
        );
      }

      if (!team.isTeamDeleteable) {
        throw new BadRequestException("This group cannot be deleted");
      }

      logger.debug(`SCIM Delete group - deleting team: ${team.name}`);

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
        affectedGroupName: team.name?.toString(),
      });

      res.status(204);
      return Response.sendJsonObjectResponse(req, res, {
        message: "Group deleted",
      });
    } catch (err) {
      // Log the error
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      void createProjectSCIMLog({
        projectId: bearerData["projectId"] as ObjectID,
        projectScimId: new ObjectID(req.params["projectScimId"]!),
        operationType: "DeleteGroup",
        status: SCIMLogStatus.Error,
        statusMessage: (err as Error).message,
        httpMethod: "DELETE",
        requestPath: req.path,
        httpStatusCode: 400,
      });

      logger.error(err);
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

      logger.debug(
        `SCIM Patch group - projectId: ${projectId}, groupId: ${groupId}`,
      );

      if (!groupId) {
        throw new BadRequestException("Group ID is required");
      }

      // Check if team exists and is part of the project
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
        throw new NotFoundException(
          "Group not found or not part of this project",
        );
      }

      // Handle SCIM patch operations
      const operations: JSONObject[] =
        (scimPatch["Operations"] as JSONObject[]) || [];

      for (const operation of operations) {
        const op: string = operation["op"] as string;
        const path: string = operation["path"] as string;
        const value: any = operation["value"];

        if (path === "members") {
          if (op === "replace") {
            // Replace all members
            logger.debug(`SCIM Patch group - replacing all members`);

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

      if (updatedTeam) {
        const updatedGroup: JSONObject = await formatTeamForSCIM(
          updatedTeam,
          req.params["projectScimId"]!,
          true,
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
        });

        return Response.sendJsonObjectResponse(req, res, updatedGroup);
      }

      throw new NotFoundException("Failed to retrieve updated group");
    } catch (err) {
      // Log the error
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      void createProjectSCIMLog({
        projectId: bearerData["projectId"] as ObjectID,
        projectScimId: new ObjectID(req.params["projectScimId"]!),
        operationType: "UpdateGroup",
        status: SCIMLogStatus.Error,
        statusMessage: (err as Error).message,
        httpMethod: "PATCH",
        requestPath: req.path,
        httpStatusCode: 400,
        requestBody: req.body,
      });

      logger.error(err);
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
    try {
      logger.debug(
        `SCIM Create user request for projectScimId: ${req.params["projectScimId"]}`,
      );
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const scimConfig: ProjectSCIM = bearerData["scimConfig"] as ProjectSCIM;

      if (!scimConfig.autoProvisionUsers) {
        throw new BadRequestException(
          "Auto-provisioning is disabled for this project",
        );
      }

      const scimUser: JSONObject = req.body;
      const email: string =
        (scimUser["userName"] as string) ||
        ((scimUser["emails"] as JSONObject[])?.[0]?.["value"] as string);
      const name: string = parseNameFromSCIM(scimUser);

      logger.debug(`SCIM Create user - email: ${email}, name: ${name}`);

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
      } else {
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
        logger.debug(
          `SCIM Create user - adding user to ${scimConfig.teams.length} configured teams`,
        );
        await handleUserTeamOperations("add", projectId, user.id!, scimConfig);
      }

      const createdUser: JSONObject = formatUserForSCIM(
        user,
        req,
        req.params["projectScimId"]!,
        "project",
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
      });

      res.status(201);
      return Response.sendJsonObjectResponse(req, res, createdUser);
    } catch (err) {
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
    try {
      logger.debug(
        `SCIM Delete user request for userId: ${req.params["userId"]}, projectScimId: ${req.params["projectScimId"]}`,
      );
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const scimConfig: ProjectSCIM = bearerData["scimConfig"] as ProjectSCIM;
      const userId: string = req.params["userId"]!;

      if (!scimConfig.autoDeprovisionUsers) {
        logger.debug("SCIM Delete user - auto-deprovisioning is disabled");
        throw new BadRequestException(
          "Auto-deprovisioning is disabled for this project",
        );
      }

      if (!userId) {
        throw new BadRequestException("User ID is required");
      }

      logger.debug(
        `SCIM Delete user - removing user from all teams in project: ${projectId}`,
      );

      // Remove user from teams the SCIM configured, but only if push groups is not enabled
      if (!scimConfig.enablePushGroups) {
        if (!scimConfig.teams || scimConfig.teams.length === 0) {
          logger.debug("SCIM Delete user - no teams configured for SCIM");
          throw new BadRequestException("No teams configured for SCIM");
        }

        await handleUserTeamOperations(
          "remove",
          projectId,
          new ObjectID(userId),
          scimConfig,
        );
      }

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
      });

      res.status(204);
      return Response.sendJsonObjectResponse(req, res, {
        message: "User deprovisioned",
      });
    } catch (err) {
      // Log the error
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      void createProjectSCIMLog({
        projectId: bearerData["projectId"] as ObjectID,
        projectScimId: new ObjectID(req.params["projectScimId"]!),
        operationType: "DeleteUser",
        status: SCIMLogStatus.Error,
        statusMessage: (err as Error).message,
        httpMethod: "DELETE",
        requestPath: req.path,
        httpStatusCode: 400,
      });

      logger.error(err);
      return next(err);
    }
  },
);

export default router;
