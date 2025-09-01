import SCIMMiddleware from "Common/Server/Middleware/SCIMAuthorization";
import UserService from "Common/Server/Services/UserService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import SCIMUserService from "Common/Server/Services/SCIMUserService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
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
import SCIMUser from "Common/Models/DatabaseModels/SCIMUser";
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
  logSCIMOperation,
  extractEmailFromSCIM,
  extractExternalIdFromSCIM,
  isUserNameEmail,
} from "../Utils/SCIMUtils";
import { DocsClientUrl } from "Common/Server/EnvironmentConfig";

const router: ExpressRouter = Express.getRouter();

// Helper function to find user by external ID or email
const findUserByExternalIdOrEmail: (
  userName: string,
  projectId: ObjectID,
  scimConfigId: ObjectID,
) => Promise<User | null> = async (
  userName: string,
  projectId: ObjectID,
  scimConfigId: ObjectID,
): Promise<User | null> => {
  // First check if userName is an external ID (not an email)
  if (!isUserNameEmail(userName)) {
    logSCIMOperation(
      "User lookup",
      "project",
      scimConfigId.toString(),
      `Looking for external ID: ${userName}`,
    );
    
    // Look up by external ID
    const scimUser: SCIMUser | null = await SCIMUserService.findOneBy({
      query: {
        externalId: userName,
        projectId: projectId,
        scimConfigId: scimConfigId,
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
    
    if (scimUser && scimUser.user) {
      logSCIMOperation(
        "User lookup",
        "project",
        scimConfigId.toString(),
        `Found user by external ID: ${scimUser.user.id}`,
      );
      return scimUser.user;
    }
  }
  
  // Fall back to email lookup
  try {
    logSCIMOperation(
      "User lookup",
      "project",
      scimConfigId.toString(),
      `Looking for email: ${userName}`,
    );
    
    const user: User | null = await UserService.findOneBy({
      query: { email: new Email(userName) },
      select: {
        _id: true,
        email: true,
        name: true,
        createdAt: true,
        updatedAt: true,
      },
      props: { isRoot: true },
    });
    
    if (user) {
      logSCIMOperation(
        "User lookup",
        "project",
        scimConfigId.toString(),
        `Found user by email: ${user.id}`,
      );
    }
    
    return user;
  } catch (error) {
    // If email validation fails, userName is likely an external ID but no mapping exists
    logSCIMOperation(
      "User lookup",
      "project",
      scimConfigId.toString(),
      `Email validation failed for: ${userName}, treating as external ID with no mapping`,
    );
    return null;
  }
};

// Helper function to create or update SCIM user mapping
const createOrUpdateSCIMUserMapping: (
  user: User,
  externalId: string,
  projectId: ObjectID,
  scimConfigId: ObjectID,
) => Promise<void> = async (
  user: User,
  externalId: string,
  projectId: ObjectID,
  scimConfigId: ObjectID,
): Promise<void> => {
  // Check if mapping already exists
  const existingMapping: SCIMUser | null = await SCIMUserService.findOneBy({
    query: {
      userId: user.id!,
      projectId: projectId,
      scimConfigId: scimConfigId,
    },
    select: { _id: true, externalId: true },
    props: { isRoot: true },
  });
  
  if (existingMapping) {
    // Update existing mapping if external ID changed
    if (existingMapping.externalId !== externalId) {
      await SCIMUserService.updateOneById({
        id: existingMapping.id!,
        data: { externalId: externalId },
        props: { isRoot: true },
      });
      
      logSCIMOperation(
        "SCIM mapping",
        "project",
        scimConfigId.toString(),
        `Updated external ID mapping for user ${user.id} from ${existingMapping.externalId} to ${externalId}`,
      );
    }
  } else {
    // Create new mapping
    const scimUser: SCIMUser = new SCIMUser();
    scimUser.projectId = projectId;
    scimUser.scimConfigId = scimConfigId;
    scimUser.userId = user.id!;
    scimUser.externalId = externalId;
    
    await SCIMUserService.create({
      data: scimUser,
      props: { isRoot: true },
    });
    
    logSCIMOperation(
      "SCIM mapping",
      "project",
      scimConfigId.toString(),
      `Created external ID mapping for user ${user.id} with external ID ${externalId}`,
    );
  }
};

// Helper function to resolve user ID (could be internal ID or external ID)
const resolveUserId: (
  userIdParam: string,
  projectId: ObjectID,
  scimConfigId: ObjectID,
) => Promise<ObjectID | null> = async (
  userIdParam: string,
  projectId: ObjectID,
  scimConfigId: ObjectID,
): Promise<ObjectID | null> => {
  // First try to parse as ObjectID (internal user ID)
  try {
    const objectId: ObjectID = new ObjectID(userIdParam);
    
    // Verify this user exists in the project
    const teamMember: TeamMember | null = await TeamMemberService.findOneBy({
      query: {
        projectId: projectId,
        userId: objectId,
      },
      select: { userId: true },
      props: { isRoot: true },
    });
    
    if (teamMember) {
      return objectId;
    }
  } catch (error) {
    // Not a valid ObjectID, continue to external ID lookup
  }
  
  // Try to find by external ID
  const scimUser: SCIMUser | null = await SCIMUserService.findOneBy({
    query: {
      externalId: userIdParam,
      projectId: projectId,
      scimConfigId: scimConfigId,
    },
    select: { userId: true },
    props: { isRoot: true },
  });
  
  if (scimUser && scimUser.userId) {
    return scimUser.userId;
  }
  
  return null;
};

// Helper function to get external ID for a user
const getExternalIdForUser: (
  userId: ObjectID,
  projectId: ObjectID,
  scimConfigId: ObjectID,
) => Promise<string | null> = async (
  userId: ObjectID,
  projectId: ObjectID,
  scimConfigId: ObjectID,
): Promise<string | null> => {
  const scimUser: SCIMUser | null = await SCIMUserService.findOneBy({
    query: {
      userId: userId,
      projectId: projectId,
      scimConfigId: scimConfigId,
    },
    select: { externalId: true },
    props: { isRoot: true },
  });
  
  return scimUser?.externalId || null;
};

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
            ignoreHooks: true,
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

// SCIM Service Provider Configuration - GET /scim/v2/ServiceProviderConfig
router.get(
  "/scim/v2/:projectScimId/ServiceProviderConfig",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      logSCIMOperation(
        "ServiceProviderConfig",
        "project",
        req.params["projectScimId"]!,
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
      return Response.sendErrorResponse(req, res, err as BadRequestException);
    }
  },
);

// Basic Users endpoint - GET /scim/v2/Users
router.get(
  "/scim/v2/:projectScimId/Users",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      logSCIMOperation("Users list", "project", req.params["projectScimId"]!);

      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;

      // Parse query parameters
      const { startIndex, count } = parseSCIMQueryParams(req);
      const filter: string = req.query["filter"] as string;

      logSCIMOperation(
        "Users list",
        "project",
        req.params["projectScimId"]!,
        `startIndex: ${startIndex}, count: ${count}, filter: ${filter || "none"}`,
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
          const userName: string = emailMatch[1]!;
          logSCIMOperation(
            "Users list",
            "project",
            req.params["projectScimId"]!,
            `filter by userName: ${userName}`,
          );

          if (userName) {
            const user: User | null = await findUserByExternalIdOrEmail(
              userName,
              projectId,
              new ObjectID(req.params["projectScimId"]!),
            );
            
            if (user && user.id) {
              query.userId = user.id;
              logSCIMOperation(
                "Users list",
                "project",
                req.params["projectScimId"]!,
                `found user with id: ${user.id}`,
              );
            } else {
              logSCIMOperation(
                "Users list",
                "project",
                req.params["projectScimId"]!,
                `user not found for userName: ${userName}`,
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

      logSCIMOperation(
        "Users list",
        "project",
        req.params["projectScimId"]!,
        `query built for projectId: ${projectId}`,
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
      const usersInProjects: Array<JSONObject> = [];
      
      for (const tm of teamMembers) {
        if (tm.user && tm.user.id) {
          // Get external ID for this user if it exists
          const externalId: string | null = await getExternalIdForUser(
            tm.user.id,
            projectId,
            new ObjectID(req.params["projectScimId"]!),
          );
          
          const userFormatted: JSONObject = formatUserForSCIM(
            tm.user,
            req,
            req.params["projectScimId"]!,
            "project",
            externalId,
          );
          
          usersInProjects.push(userFormatted);
        }
      }

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

      // now paginate the results
      const paginatedUsers: Array<JSONObject> = users.slice(
        (startIndex - 1) * count,
        startIndex * count,
      );

      logger.debug(`SCIM Users response prepared with ${users.length} users`);

      return Response.sendJsonObjectResponse(
        req,
        res,
        generateUsersListResponse(paginatedUsers, startIndex, users.length),
      );
    } catch (err) {
      logger.error(err);
      return Response.sendErrorResponse(req, res, err as BadRequestException);
    }
  },
);

// Get Individual User - GET /scim/v2/Users/{id}
router.get(
  "/scim/v2/:projectScimId/Users/:userId",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      logger.debug(
        `SCIM Get individual user request for userId: ${req.params["userId"]}, projectScimId: ${req.params["projectScimId"]}`,
      );
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const scimConfig: ProjectSCIM = bearerData["scimConfig"] as ProjectSCIM;
      const userIdParam: string = req.params["userId"]!;

      logger.debug(
        `SCIM Get user - projectId: ${projectId}, userIdParam: ${userIdParam}`,
      );

      if (!userIdParam) {
        throw new BadRequestException("User ID is required");
      }

      // Resolve user ID (could be internal ID or external ID)
      const userId: ObjectID | null = await resolveUserId(
        userIdParam,
        projectId,
        scimConfig.id!,
      );

      if (!userId) {
        logger.debug(
          `SCIM Get user - could not resolve user ID for param: ${userIdParam}`,
        );
        throw new NotFoundException(
          "User not found or not part of this project",
        );
      }

      // Check if user exists and is part of the project
      const projectUser: TeamMember | null = await TeamMemberService.findOneBy({
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
        logger.debug(
          `SCIM Get user - user not found or not part of project for resolved userId: ${userId}`,
        );
        throw new NotFoundException(
          "User not found or not part of this project",
        );
      }

      logger.debug(`SCIM Get user - found user: ${projectUser.user.id}`);

      // Get external ID for this user if it exists
      const externalId: string | null = await getExternalIdForUser(
        projectUser.user.id!,
        projectId,
        scimConfig.id!,
      );

      const user: JSONObject = formatUserForSCIM(
        projectUser.user,
        req,
        req.params["projectScimId"]!,
        "project",
        externalId,
      );

      return Response.sendJsonObjectResponse(req, res, user);
    } catch (err) {
      logger.error(err);
      return Response.sendErrorResponse(req, res, err as BadRequestException);
    }
  },
);

// Update User - PUT /scim/v2/Users/{id}
router.put(
  "/scim/v2/:projectScimId/Users/:userId",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      logger.debug(
        `SCIM Update user request for userId: ${req.params["userId"]}, projectScimId: ${req.params["projectScimId"]}`,
      );
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const scimConfig: ProjectSCIM = bearerData["scimConfig"] as ProjectSCIM;
      const userIdParam: string = req.params["userId"]!;
      const scimUser: JSONObject = req.body;

      logger.debug(
        `SCIM Update user - projectId: ${projectId}, userIdParam: ${userIdParam}`,
      );

      logger.debug(
        `Request body for SCIM Update user: ${JSON.stringify(scimUser, null, 2)}`,
      );

      if (!userIdParam) {
        throw new BadRequestException("User ID is required");
      }

      // Resolve user ID (could be internal ID or external ID)
      const userId: ObjectID | null = await resolveUserId(
        userIdParam,
        projectId,
        scimConfig.id!,
      );

      if (!userId) {
        logger.debug(
          `SCIM Update user - could not resolve user ID for param: ${userIdParam}`,
        );
        throw new NotFoundException(
          "User not found or not part of this project",
        );
      }

      // Check if user exists and is part of the project
      const projectUser: TeamMember | null = await TeamMemberService.findOneBy({
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
        logger.debug(
          `SCIM Update user - user not found or not part of project for resolved userId: ${userId}`,
        );
        throw new NotFoundException(
          "User not found or not part of this project",
        );
      }

      // Update user information
      const userName: string = extractEmailFromSCIM(scimUser);
      const externalId: string | null = extractExternalIdFromSCIM(scimUser);
      const name: string = parseNameFromSCIM(scimUser);
      const active: boolean = scimUser["active"] as boolean;

      logger.debug(
        `SCIM Update user - userName: ${userName}, externalId: ${externalId}, name: ${name}, active: ${active}`,
      );

      // Extract email from emails array if userName is not an email
      let email: string = "";
      if (isUserNameEmail(userName)) {
        email = userName;
      } else {
        // Look for email in the emails array
        const emailsArray: JSONObject[] = scimUser["emails"] as JSONObject[];
        if (emailsArray && emailsArray.length > 0) {
          email = emailsArray[0]?.["value"] as string;
        }
      }

      // Create or update SCIM user mapping if we have an external ID
      if (externalId) {
        await createOrUpdateSCIMUserMapping(
          projectUser.user,
          externalId,
          projectId,
          scimConfig.id!,
        );
      }

      // Handle user deactivation by removing from teams
      if (active === false) {
        logger.debug(
          `SCIM Update user - user marked as inactive, removing from teams`,
        );
        await handleUserTeamOperations(
          "remove",
          projectId,
          userId,
          scimConfig,
        );
        logger.debug(
          `SCIM Update user - user successfully removed from teams due to deactivation`,
        );
      }

      // Handle user activation by adding to teams
      if (active === true) {
        logger.debug(
          `SCIM Update user - user marked as active, adding to teams`,
        );
        await handleUserTeamOperations(
          "add",
          projectId,
          userId,
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
          id: userId,
          data: updateData,
          props: { isRoot: true },
        });

        logger.debug(`SCIM Update user - user updated successfully`);

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

        if (updatedUser) {
          const userExternalId: string | null = await getExternalIdForUser(
            updatedUser.id!,
            projectId,
            scimConfig.id!,
          );
          
          const user: JSONObject = formatUserForSCIM(
            updatedUser,
            req,
            req.params["projectScimId"]!,
            "project",
            userExternalId,
          );
          return Response.sendJsonObjectResponse(req, res, user);
        }
      }

      logger.debug(
        `SCIM Update user - no updates made, returning existing user`,
      );

      // If no updates were made, return the existing user
      const userExternalId: string | null = await getExternalIdForUser(
        projectUser.user.id!,
        projectId,
        scimConfig.id!,
      );
      
      const user: JSONObject = formatUserForSCIM(
        projectUser.user,
        req,
        req.params["projectScimId"]!,
        "project",
        userExternalId,
      );

      return Response.sendJsonObjectResponse(req, res, user);
    } catch (err) {
      logger.error(err);
      return Response.sendErrorResponse(req, res, err as BadRequestException);
    }
  },
);

// Groups endpoint - GET /scim/v2/Groups
router.get(
  "/scim/v2/:projectScimId/Groups",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      logger.debug(
        `SCIM Groups list request for projectScimId: ${req.params["projectScimId"]}`,
      );
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const scimConfig: ProjectSCIM = bearerData["scimConfig"] as ProjectSCIM;

      logger.debug(
        `SCIM Groups - found ${scimConfig.teams?.length || 0} configured teams`,
      );

      // Return configured teams as groups
      const groups: JSONObject[] = (scimConfig.teams || []).map((team: any) => {
        return {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
          id: team.id?.toString(),
          displayName: team.name?.toString(),
          members: [],
          meta: {
            resourceType: "Group",
            location: `${req.protocol}://${req.get("host")}/scim/v2/${req.params["projectScimId"]}/Groups/${team.id?.toString()}`,
          },
        };
      });

      return Response.sendJsonObjectResponse(req, res, {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        totalResults: groups.length,
        startIndex: 1,
        itemsPerPage: groups.length,
        Resources: groups,
      });
    } catch (err) {
      logger.error(err);
      return Response.sendErrorResponse(req, res, err as BadRequestException);
    }
  },
);

// Create User - POST /scim/v2/Users
router.post(
  "/scim/v2/:projectScimId/Users",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
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
      const userName: string = extractEmailFromSCIM(scimUser);
      const externalId: string | null = extractExternalIdFromSCIM(scimUser);
      const name: string = parseNameFromSCIM(scimUser);

      logger.debug(`SCIM Create user - userName: ${userName}, externalId: ${externalId}, name: ${name}`);

      // Extract email from emails array if userName is not an email
      let email: string = "";
      if (isUserNameEmail(userName)) {
        email = userName;
      } else {
        // Look for email in the emails array
        const emailsArray: JSONObject[] = scimUser["emails"] as JSONObject[];
        if (emailsArray && emailsArray.length > 0) {
          email = emailsArray[0]?.["value"] as string;
        }
      }

      if (!email && !externalId) {
        throw new BadRequestException(
          "Either a valid email address or external ID is required",
        );
      }

      // Check if user already exists (by external ID first, then email)
      let user: User | null = null;
      
      if (externalId) {
        user = await findUserByExternalIdOrEmail(
          externalId,
          projectId,
          scimConfig.id!,
        );
      }
      
      if (!user && email) {
        try {
          user = await UserService.findOneBy({
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
        } catch (error) {
          // Email validation failed, continue without email lookup
          logger.debug(`SCIM Create user - email validation failed for: ${email}`);
        }
      }

      // Create user if doesn't exist
      if (!user) {
        if (!email) {
          throw new BadRequestException(
            "A valid email address is required to create a new user",
          );
        }
        
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

      // Create or update SCIM user mapping if we have an external ID
      if (externalId && user.id) {
        await createOrUpdateSCIMUserMapping(
          user,
          externalId,
          projectId,
          scimConfig.id!,
        );
      }

      // Add user to default teams if configured
      if (scimConfig.teams && scimConfig.teams.length > 0) {
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
        externalId,
      );

      logger.debug(
        `SCIM Create user - returning created user with id: ${user.id}`,
      );

      res.status(201);
      return Response.sendJsonObjectResponse(req, res, createdUser);
    } catch (err) {
      logger.error(err);
      return Response.sendErrorResponse(req, res, err as BadRequestException);
    }
  },
);

// Delete User - DELETE /scim/v2/Users/{id}
router.delete(
  "/scim/v2/:projectScimId/Users/:userId",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      logger.debug(
        `SCIM Delete user request for userId: ${req.params["userId"]}, projectScimId: ${req.params["projectScimId"]}`,
      );
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const scimConfig: ProjectSCIM = bearerData["scimConfig"] as ProjectSCIM;
      const userIdParam: string = req.params["userId"]!;

      if (!scimConfig.autoDeprovisionUsers) {
        logger.debug("SCIM Delete user - auto-deprovisioning is disabled");
        throw new BadRequestException(
          "Auto-deprovisioning is disabled for this project",
        );
      }

      if (!userIdParam) {
        throw new BadRequestException("User ID is required");
      }

      // Resolve user ID (could be internal ID or external ID)
      const userId: ObjectID | null = await resolveUserId(
        userIdParam,
        projectId,
        scimConfig.id!,
      );

      if (!userId) {
        logger.debug(
          `SCIM Delete user - could not resolve user ID for param: ${userIdParam}`,
        );
        throw new NotFoundException(
          "User not found or not part of this project",
        );
      }

      logger.debug(
        `SCIM Delete user - removing user from all teams in project: ${projectId}`,
      );

      // Remove user from teams the SCIM configured
      if (!scimConfig.teams || scimConfig.teams.length === 0) {
        logger.debug("SCIM Delete user - no teams configured for SCIM");
        throw new BadRequestException("No teams configured for SCIM");
      }

      await handleUserTeamOperations(
        "remove",
        projectId,
        userId,
        scimConfig,
      );

      logger.debug(
        `SCIM Delete user - user successfully deprovisioned from project`,
      );

      res.status(204);
      return Response.sendJsonObjectResponse(req, res, {
        message: "User deprovisioned",
      });
    } catch (err) {
      logger.error(err);
      return Response.sendErrorResponse(req, res, err as BadRequestException);
    }
  },
);

export default router;
