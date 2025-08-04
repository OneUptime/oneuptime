import SCIMMiddleware from "Common/Server/Middleware/SCIMAuthorization";
import UserService from "Common/Server/Services/UserService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
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
import BadRequestException from "Common/Types/Exception/BadRequestException";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import OneUptimeDate from "Common/Types/Date";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Query from "Common/Types/BaseDatabase/Query";
import ProjectUser from "Common/Models/DatabaseModels/ProjectUser";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import User from "Common/Models/DatabaseModels/User";

const router: ExpressRouter = Express.getRouter();

// Utility functions
const parseNameFromSCIM: (scimUser: JSONObject) => string = (
  scimUser: JSONObject,
): string => {
  logger.debug(
    `Parsing name from SCIM user: ${JSON.stringify(scimUser, null, 2)}`,
  );

  const givenName: string =
    ((scimUser["name"] as JSONObject)?.["givenName"] as string) || "";
  const familyName: string =
    ((scimUser["name"] as JSONObject)?.["familyName"] as string) || "";
  const formattedName: string = (scimUser["name"] as JSONObject)?.[
    "formatted"
  ] as string;

  // Construct full name: prefer formatted, then combine given+family, then fallback to displayName
  if (formattedName) {
    return formattedName;
  } else if (givenName || familyName) {
    return `${givenName} ${familyName}`.trim();
  } else if (scimUser["displayName"]) {
    return scimUser["displayName"] as string;
  }
  return "";
};

const parseNameToSCIMFormat: (fullName: string) => {
  givenName: string;
  familyName: string;
  formatted: string;
} = (
  fullName: string,
): { givenName: string; familyName: string; formatted: string } => {
  const nameParts: string[] = fullName.trim().split(/\s+/);
  const givenName: string = nameParts[0] || "";
  const familyName: string = nameParts.slice(1).join(" ") || "";

  return {
    givenName,
    familyName,
    formatted: fullName,
  };
};

const formatUserForSCIM: (user: User, req: ExpressRequest) => JSONObject = (
  user: User,
  req: ExpressRequest,
): JSONObject => {
  const baseUrl: string = `${req.protocol}://${req.get("host")}`;
  const nameData: { givenName: string; familyName: string; formatted: string } =
    parseNameToSCIMFormat(user.name?.toString() || "");

  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: user.id?.toString(),
    userName: user.email?.toString(),
    name: {
      formatted: nameData.formatted,
      familyName: nameData.familyName,
      givenName: nameData.givenName,
    },
    emails: [
      {
        value: user.email?.toString(),
        type: "work",
        primary: true,
      },
    ],
    active: true,
    meta: {
      resourceType: "User",
      created: user.createdAt?.toISOString(),
      lastModified: user.updatedAt?.toISOString(),
      location: `${baseUrl}/scim/v2/${req.params["projectScimId"]}/Users/${user.id?.toString()}`,
    },
  };
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
      logger.debug(
        `SCIM ServiceProviderConfig request for projectScimId: ${req.params["projectScimId"]}`,
      );
      const serviceProviderConfig: JSONObject = {
        schemas: [
          "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig",
        ],
        documentationUri: "https://oneuptime.com/docs/scim",
        patch: {
          supported: true,
        },
        bulk: {
          supported: true,
          maxOperations: 1000,
          maxPayloadSize: 1048576,
        },
        filter: {
          supported: true,
          maxResults: 200,
        },
        changePassword: {
          supported: false,
        },
        sort: {
          supported: true,
        },
        etag: {
          supported: false,
        },
        authenticationSchemes: [
          {
            type: "httpbearer",
            name: "HTTP Bearer",
            description: "Authentication scheme using HTTP Bearer Token",
            primary: true,
          },
        ],
        meta: {
          location: `${req.protocol}://${req.get("host")}/scim/v2/${req.params["projectScimId"]}/ServiceProviderConfig`,
          resourceType: "ServiceProviderConfig",
          created: "2023-01-01T00:00:00Z",
          lastModified: "2023-01-01T00:00:00Z",
        },
      };

      logger.debug("SCIM ServiceProviderConfig response prepared successfully");
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
      logger.debug(
        `SCIM Users list request for projectScimId: ${req.params["projectScimId"]}`,
      );
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;

      // Parse query parameters
      const startIndex: number = parseInt(
        (req.query["startIndex"] as string) || "1",
      );
      const count: number = parseInt((req.query["count"] as string) || "20");
      const filter: string = req.query["filter"] as string;

      logger.debug(
        `SCIM Users query params - startIndex: ${startIndex}, count: ${count}, filter: ${filter || "none"}`,
      );

      // Build query for team members in this project
      const query: Query<ProjectUser> = {
        projectId: projectId,
      };

      // Handle SCIM filter for userName
      if (filter) {
        const emailMatch: RegExpMatchArray | null = filter.match(
          /userName eq "([^"]+)"/i,
        );
        if (emailMatch) {
          const email: string = emailMatch[1]!;
          logger.debug(`SCIM Users filter by email: ${email}`);
          if (email) {
            const user: User | null = await UserService.findOneBy({
              query: { email: new Email(email) },
              select: { _id: true },
              props: { isRoot: true },
            });
            if (user && user.id) {
              query.userId = user.id;
              logger.debug(
                `SCIM Users filter - found user with id: ${user.id}`,
              );
            } else {
              logger.debug(
                `SCIM Users filter - user not found for email: ${email}`,
              );
              return Response.sendJsonObjectResponse(req, res, {
                schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
                totalResults: 0,
                startIndex: startIndex,
                itemsPerPage: 0,
                Resources: [],
              });
            }
          }
        }
      }

      logger.debug(`SCIM Users query built for projectId: ${projectId}`);

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
          return formatUserForSCIM(tm.user!, req);
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

      // now paginate the results
      const paginatedUsers: Array<JSONObject> = users.slice(
        (startIndex - 1) * count,
        startIndex * count,
      );

      logger.debug(`SCIM Users response prepared with ${users.length} users`);

      return Response.sendJsonObjectResponse(req, res, {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        totalResults: users.length,
        startIndex: startIndex,
        itemsPerPage: paginatedUsers.length,
        Resources: paginatedUsers,
      });
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

      const user: JSONObject = formatUserForSCIM(projectUser.user, req);

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
        throw new NotFoundException(
          "User not found or not part of this project",
        );
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

      // Handle user deactivation by removing from teams
      if (active === false) {
        logger.debug(
          `SCIM Update user - user marked as inactive, removing from teams`,
        );
        const scimConfig: ProjectSCIM = bearerData["scimConfig"] as ProjectSCIM;
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
      if (active === true) {
        logger.debug(
          `SCIM Update user - user marked as active, adding to teams`,
        );
        const scimConfig: ProjectSCIM = bearerData["scimConfig"] as ProjectSCIM;
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
          const user: JSONObject = formatUserForSCIM(updatedUser, req);
          return Response.sendJsonObjectResponse(req, res, user);
        }
      }

      logger.debug(
        `SCIM Update user - no updates made, returning existing user`,
      );

      // If no updates were made, return the existing user
      const user: JSONObject = formatUserForSCIM(projectUser.user, req);

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

      // Add user to default teams if configured
      if (scimConfig.teams && scimConfig.teams.length > 0) {
        logger.debug(
          `SCIM Create user - adding user to ${scimConfig.teams.length} configured teams`,
        );
        await handleUserTeamOperations("add", projectId, user.id!, scimConfig);
      }

      const createdUser: JSONObject = formatUserForSCIM(user, req);

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

      // Remove user from teams the SCIM configured
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
