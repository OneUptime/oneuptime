import SCIMMiddleware from "Common/Server/Middleware/SCIMAuthorization";
import UserService from "Common/Server/Services/UserService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import Express, {
  ExpressRequest,
  ExpressResponse,
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

const router = Express.getRouter();

// SCIM Service Provider Configuration - GET /scim/v2/ServiceProviderConfig
router.get(
  "/scim/v2/:projectScimId/ServiceProviderConfig",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      logger.debug(
        `SCIM ServiceProviderConfig request for projectScimId: ${req.params["projectScimId"]}`
      );
      const serviceProviderConfig = {
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
  }
);

// Basic Users endpoint - GET /scim/v2/Users
router.get(
  "/scim/v2/:projectScimId/Users",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      logger.debug(
        `SCIM Users list request for projectScimId: ${req.params["projectScimId"]}`
      );
      const oneuptimeRequest = req as OneUptimeRequest;
      const bearerData = oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId = bearerData["projectId"] as ObjectID;

      // Parse query parameters
      const startIndex = parseInt((req.query["startIndex"] as string) || "1");
      const count = parseInt((req.query["count"] as string) || "20");
      const filter = req.query["filter"] as string;

      logger.debug(
        `SCIM Users query params - startIndex: ${startIndex}, count: ${count}, filter: ${filter || "none"}`
      );

      // Build query for team members in this project
      let query: Query<ProjectUser> = {
        projectId: projectId,
      };

      // Handle SCIM filter for userName
      if (filter) {
        const emailMatch = filter.match(/userName eq "([^"]+)"/i);
        if (emailMatch) {
          const email = emailMatch[1];
          logger.debug(`SCIM Users filter by email: ${email}`);
          if (email) {
            const user = await UserService.findOneBy({
              query: { email: new Email(email) },
              select: { _id: true },
              props: { isRoot: true },
            });
            if (user && user.id) {
              query.userId = user.id;
              logger.debug(
                `SCIM Users filter - found user with id: ${user.id}`
              );
            } else {
              logger.debug(
                `SCIM Users filter - user not found for email: ${email}`
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
        .filter((tm: TeamMember) => tm.user && tm.user.id)
        .map((tm: TeamMember) => ({
          id: tm.user!.id?.toString(),
          userName: tm.user!.email?.toString(),
          name: {
            formatted: tm.user!.name?.toString() || "",
            familyName: "",
            givenName: tm.user!.name?.toString() || "",
          },
          emails: [
            {
              value: tm.user!.email?.toString(),
              type: "work",
              primary: true,
            },
          ],
          active: true,
          meta: {
            resourceType: "User",
            created: tm.user!.createdAt?.toISOString(),
            lastModified: tm.user!.updatedAt?.toISOString(),
            location: `${req.protocol}://${req.get("host")}/scim/v2/${req.params["projectScimId"]}/Users/${tm.user!.id!.toString()}`,
          },
        }));

        // remove duplicates
      const uniqueUserIds = new Set<string>();
      const users: Array<JSONObject> = usersInProjects.filter((user: JSONObject) => {
        if (uniqueUserIds.has(user['id']?.toString() || "")) {
          return false;
        }
        uniqueUserIds.add(user['id']?.toString() || "");
        return true;
      }); 


      // now paginate the results
      const paginatedUsers = users.slice(
        (startIndex - 1) * count,
        startIndex * count
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
  }
);

// Get Individual User - GET /scim/v2/Users/{id}
router.get(
  "/scim/v2/:projectScimId/Users/:userId",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      logger.debug(
        `SCIM Get individual user request for userId: ${req.params["userId"]}, projectScimId: ${req.params["projectScimId"]}`
      );
      const oneuptimeRequest = req as OneUptimeRequest;
      const bearerData = oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId = bearerData["projectId"] as ObjectID;
      const userId = req.params["userId"];


      logger.debug(`SCIM Get user - projectId: ${projectId}, userId: ${userId}`);

      if (!userId) {
        throw new BadRequestException("User ID is required");
      }

      // Check if user exists and is part of the project
      const projectUser = await TeamMemberService.findOneBy({
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
          `SCIM Get user - user not found or not part of project for userId: ${userId}`
        );
        throw new NotFoundException(
          "User not found or not part of this project"
        );
      }

      logger.debug(`SCIM Get user - found user: ${projectUser.user.id}`);

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const user = {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        id: projectUser.user.id?.toString(),
        userName: projectUser.user.email?.toString(),
        name: {
          formatted: projectUser.user.name?.toString() || "",
          familyName: "",
          givenName: projectUser.user.name?.toString() || "",
        },
        emails: [
          {
            value: projectUser.user.email?.toString(),
            type: "work",
            primary: true,
          },
        ],
        active: true,
        meta: {
          resourceType: "User",
          created: projectUser.user.createdAt?.toISOString(),
          lastModified: projectUser.user.updatedAt?.toISOString(),
          location: `${baseUrl}/scim/v2/${req.params["projectScimId"]}/Users/${projectUser.user.id?.toString()}`,
        },
      };

      return Response.sendJsonObjectResponse(req, res, user);
    } catch (err) {
      logger.error(err);
      return Response.sendErrorResponse(req, res, err as BadRequestException);
    }
  }
);

// Update User - PUT /scim/v2/Users/{id}
router.put(
  "/scim/v2/:projectScimId/Users/:userId",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      logger.debug(
        `SCIM Update user request for userId: ${req.params["userId"]}, projectScimId: ${req.params["projectScimId"]}`
      );
      const oneuptimeRequest = req as OneUptimeRequest;
      const bearerData = oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId = bearerData["projectId"] as ObjectID;
      const userId = req.params["userId"];
      const scimUser = req.body;

      logger.debug(
        `SCIM Update user - projectId: ${projectId}, userId: ${userId}`
      );


      logger.debug(
        `Request body for SCIM Update user: ${JSON.stringify(scimUser, null, 2)}`
      );

      if (!userId) {
        throw new BadRequestException("User ID is required");
      }

      // Check if user exists and is part of the project
      const projectUser = await TeamMemberService.findOneBy({
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
          `SCIM Update user - user not found or not part of project for userId: ${userId}`
        );
        throw new NotFoundException(
          "User not found or not part of this project"
        );
      }

      // Update user information
      const email = scimUser.userName || scimUser.emails?.[0]?.value;
      const name =
        scimUser.name?.formatted ||
        scimUser.name?.givenName ||
        scimUser.displayName;

      logger.debug(`SCIM Update user - email: ${email}, name: ${name}`);

      if (email || name) {
        const updateData: any = {};
        if (email) updateData.email = new Email(email);
        if (name) updateData.name = new Name(name);

        logger.debug(
          `SCIM Update user - updating user with data: ${JSON.stringify(updateData)}`
        );

        await UserService.updateOneById({
          id: new ObjectID(userId),
          data: updateData,
          props: { isRoot: true },
        });

        logger.debug(`SCIM Update user - user updated successfully`);

        // Fetch updated user
        const updatedUser = await UserService.findOneById({
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
          const baseUrl = `${req.protocol}://${req.get("host")}`;
          const user = {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
            id: updatedUser.id?.toString(),
            userName: updatedUser.email?.toString(),
            name: {
              formatted: updatedUser.name?.toString() || "",
              familyName: "",
              givenName: updatedUser.name?.toString() || "",
            },
            emails: [
              {
                value: updatedUser.email?.toString(),
                type: "work",
                primary: true,
              },
            ],
            active: true,
            meta: {
              resourceType: "User",
              created: updatedUser.createdAt?.toISOString(),
              lastModified: updatedUser.updatedAt?.toISOString(),
              location: `${baseUrl}/scim/v2/${req.params["projectScimId"]}/Users/${updatedUser.id?.toString()}`,
            },
          };

          return Response.sendJsonObjectResponse(req, res, user);
        }
      }

      logger.debug(
        `SCIM Update user - no updates made, returning existing user`
      );

      // If no updates were made, return the existing user
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const user = {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        id: projectUser.user.id?.toString(),
        userName: projectUser.user.email?.toString(),
        name: {
          formatted: projectUser.user.name?.toString() || "",
          familyName: "",
          givenName: projectUser.user.name?.toString() || "",
        },
        emails: [
          {
            value: projectUser.user.email?.toString(),
            type: "work",
            primary: true,
          },
        ],
        active: true,
        meta: {
          resourceType: "User",
          created: projectUser.user.createdAt?.toISOString(),
          lastModified: projectUser.user.updatedAt?.toISOString(),
          location: `${baseUrl}/scim/v2/${req.params["projectScimId"]}/Users/${projectUser.user.id?.toString()}`,
        },
      };

      return Response.sendJsonObjectResponse(req, res, user);
    } catch (err) {
      logger.error(err);
      return Response.sendErrorResponse(req, res, err as BadRequestException);
    }
  }
);

// Groups endpoint - GET /scim/v2/Groups
router.get(
  "/scim/v2/:projectScimId/Groups",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      logger.debug(
        `SCIM Groups list request for projectScimId: ${req.params["projectScimId"]}`
      );
      const oneuptimeRequest = req as OneUptimeRequest;
      const bearerData = oneuptimeRequest.bearerTokenData as JSONObject;
      const scimConfig = bearerData["scimConfig"] as ProjectSCIM;

      logger.debug(
        `SCIM Groups - found ${scimConfig.teams?.length || 0} configured teams`
      );

      // Return configured teams as groups
      const groups = (scimConfig.teams || []).map((team: any) => ({
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
        id: team.id?.toString(),
        displayName: team.name?.toString(),
        members: [],
        meta: {
          resourceType: "Group",
          location: `${req.protocol}://${req.get("host")}/scim/v2/${req.params["projectScimId"]}/Groups/${team.id?.toString()}`,
        },
      }));

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
  }
);

// Create User - POST /scim/v2/Users
router.post(
  "/scim/v2/:projectScimId/Users",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      logger.debug(
        `SCIM Create user request for projectScimId: ${req.params["projectScimId"]}`
      );
      const oneuptimeRequest = req as OneUptimeRequest;
      const bearerData = oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId = bearerData["projectId"] as ObjectID;
      const scimConfig = bearerData["scimConfig"] as ProjectSCIM;

      if (!scimConfig.autoProvisionUsers) {
        throw new BadRequestException(
          "Auto-provisioning is disabled for this project"
        );
      }

      const scimUser = req.body;
      const email = scimUser.userName || scimUser.emails?.[0]?.value;
      const name =
        scimUser.name?.formatted ||
        scimUser.name?.givenName ||
        scimUser.displayName;

      logger.debug(`SCIM Create user - email: ${email}, name: ${name}`);

      if (!email) {
        throw new BadRequestException("userName or email is required");
      }

      // Check if user already exists
      let user = await UserService.findOneBy({
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
          `SCIM Create user - creating new user for email: ${email}`
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
          `SCIM Create user - user already exists with id: ${user.id}`
        );
      }

      // Add user to default teams if configured
      if (scimConfig.teams && scimConfig.teams.length > 0) {
        logger.debug(
          `SCIM Create user - adding user to ${scimConfig.teams.length} configured teams`
        );
        for (const team of scimConfig.teams) {
          const existingMember = await TeamMemberService.findOneBy({
            query: {
              projectId: projectId,
              userId: user.id!,
              teamId: team.id!,
            },
            select: { _id: true },
            props: { isRoot: true },
          });

          if (!existingMember) {
            logger.debug(`SCIM Create user - adding user to team: ${team.id}`);
            let teamMember: TeamMember = new TeamMember();
            teamMember.projectId = projectId;
            teamMember.userId = user.id!;
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
              `SCIM Create user - user already member of team: ${team.id}`
            );
          }
        }
      }

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const createdUser = {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        id: user.id?.toString(),
        userName: user.email?.toString(),
        name: {
          formatted: user.name?.toString() || "",
          familyName: "",
          givenName: user.name?.toString() || "",
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

      logger.debug(
        `SCIM Create user - returning created user with id: ${user.id}`
      );

      res.status(201);
      return Response.sendJsonObjectResponse(req, res, createdUser);
    } catch (err) {
      logger.error(err);
      return Response.sendErrorResponse(req, res, err as BadRequestException);
    }
  }
);

// Delete User - DELETE /scim/v2/Users/{id}
router.delete(
  "/scim/v2/:projectScimId/Users/:userId",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      logger.debug(
        `SCIM Delete user request for userId: ${req.params["userId"]}, projectScimId: ${req.params["projectScimId"]}`
      );
      const oneuptimeRequest = req as OneUptimeRequest;
      const bearerData = oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId = bearerData["projectId"] as ObjectID;
      const scimConfig = bearerData["scimConfig"] as ProjectSCIM;
      const userId = req.params["userId"];

      if (!scimConfig.autoDeprovisionUsers) {
        logger.debug("SCIM Delete user - auto-deprovisioning is disabled");
        throw new BadRequestException(
          "Auto-deprovisioning is disabled for this project"
        );
      }

      if (!userId) {
        throw new BadRequestException("User ID is required");
      }

      logger.debug(
        `SCIM Delete user - removing user from all teams in project: ${projectId}`
      );

     // remove user from teams the SCIM configured

     const teamsIds: Array<ObjectID> = scimConfig.teams?.map(
        (team: any) => team.id
      ) || [];

      if (teamsIds.length === 0) {
        logger.debug("SCIM Delete user - no teams configured for SCIM");
        throw new BadRequestException("No teams configured for SCIM");
      }

      // Remove user from teamsIds teams in the project

      await TeamMemberService.deleteBy({
        query: {
          projectId: projectId,
          userId: new ObjectID(userId),
          teamId: QueryHelper.any(teamsIds),
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });


      logger.debug(
        `SCIM Delete user - user successfully deprovisioned from project`
      );

      res.status(204);
      return Response.sendJsonObjectResponse(req, res, {
        message: "User deprovisioned",
      });
    } catch (err) {
      logger.error(err);
      return Response.sendErrorResponse(req, res, err as BadRequestException);
    }
  }
);

export default router;
