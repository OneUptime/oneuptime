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
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectScim";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import OneUptimeDate from "Common/Types/Date";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";

const router = Express.getRouter();

// SCIM Service Provider Configuration - GET /scim/v2/ServiceProviderConfig
router.get(
  "/scim/v2/:projectScimId/ServiceProviderConfig",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      const serviceProviderConfig = {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
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
      const oneuptimeRequest = req as OneUptimeRequest;
      const bearerData = oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId = bearerData["projectId"] as ObjectID;

      // Parse query parameters
      const startIndex = parseInt((req.query["startIndex"] as string) || "1");
      const count = parseInt((req.query["count"] as string) || "20");
      const filter = req.query["filter"] as string;

      // Build query for team members in this project
      let query: any = {
        projectId: projectId,
        hasAcceptedInvitation: true,
      };

      // Handle SCIM filter for userName
      if (filter) {
        const emailMatch = filter.match(/userName eq "([^"]+)"/i);
        if (emailMatch) {
          const email = emailMatch[1];
          if (email) {
            const user = await UserService.findOneBy({
              query: { email: new Email(email) },
              select: { _id: true },
              props: { isRoot: true },
            });
            if (user) {
              query.userId = user.id;
            } else {
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

      // Get team members
      const teamMembers = await TeamMemberService.findBy({
        query: query,
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
        skip: startIndex - 1,
        limit: count,
        props: { isRoot: true },
      });

      const totalCount = await TeamMemberService.countBy({
        query: query,
        props: { isRoot: true },
      });

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const users = teamMembers
        .filter((tm: any) => tm.user)
        .map((tm: any) => ({
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          id: tm.user.id?.toString(),
          userName: tm.user.email?.toString(),
          name: {
            formatted: tm.user.name?.toString() || "",
            familyName: "",
            givenName: tm.user.name?.toString() || "",
          },
          emails: [
            {
              value: tm.user.email?.toString(),
              type: "work",
              primary: true,
            },
          ],
          active: true,
          meta: {
            resourceType: "User",
            created: tm.user.createdAt?.toISOString(),
            lastModified: tm.user.updatedAt?.toISOString(),
            location: `${baseUrl}/scim/v2/${req.params["projectScimId"]}/Users/${tm.user.id?.toString()}`,
          },
        }));

      return Response.sendJsonObjectResponse(req, res, {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        totalResults: totalCount.toNumber(),
        startIndex: startIndex,
        itemsPerPage: users.length,
        Resources: users,
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
      const oneuptimeRequest = req as OneUptimeRequest;
      const bearerData = oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId = bearerData["projectId"] as ObjectID;
      const userId = req.params["userId"];

      if (!userId) {
        throw new BadRequestException("User ID is required");
      }

      // Check if user exists and is part of the project
      const teamMember = await TeamMemberService.findOneBy({
        query: {
          projectId: projectId,
          userId: new ObjectID(userId),
          hasAcceptedInvitation: true,
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

      if (!teamMember || !teamMember.user) {
        throw new NotFoundException("User not found or not part of this project");
      }

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const user = {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        id: teamMember.user.id?.toString(),
        userName: teamMember.user.email?.toString(),
        name: {
          formatted: teamMember.user.name?.toString() || "",
          familyName: "",
          givenName: teamMember.user.name?.toString() || "",
        },
        emails: [
          {
            value: teamMember.user.email?.toString(),
            type: "work",
            primary: true,
          },
        ],
        active: true,
        meta: {
          resourceType: "User",
          created: teamMember.user.createdAt?.toISOString(),
          lastModified: teamMember.user.updatedAt?.toISOString(),
          location: `${baseUrl}/scim/v2/${req.params["projectScimId"]}/Users/${teamMember.user.id?.toString()}`,
        },
      };

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
      const oneuptimeRequest = req as OneUptimeRequest;
      const bearerData = oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId = bearerData["projectId"] as ObjectID;
      const userId = req.params["userId"];
      const scimUser = req.body;

      if (!userId) {
        throw new BadRequestException("User ID is required");
      }

      // Check if user exists and is part of the project
      const teamMember = await TeamMemberService.findOneBy({
        query: {
          projectId: projectId,
          userId: new ObjectID(userId),
          hasAcceptedInvitation: true,
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

      if (!teamMember || !teamMember.user) {
        throw new NotFoundException("User not found or not part of this project");
      }

      // Update user information
      const email = scimUser.userName || scimUser.emails?.[0]?.value;
      const name = scimUser.name?.formatted || scimUser.name?.givenName || scimUser.displayName;

      if (email || name) {
        const updateData: any = {};
        if (email) updateData.email = new Email(email);
        if (name) updateData.name = new Name(name);

        await UserService.updateOneById({
          id: new ObjectID(userId),
          data: updateData,
          props: { isRoot: true },
        });

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

      // If no updates were made, return the existing user
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const user = {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        id: teamMember.user.id?.toString(),
        userName: teamMember.user.email?.toString(),
        name: {
          formatted: teamMember.user.name?.toString() || "",
          familyName: "",
          givenName: teamMember.user.name?.toString() || "",
        },
        emails: [
          {
            value: teamMember.user.email?.toString(),
            type: "work",
            primary: true,
          },
        ],
        active: true,
        meta: {
          resourceType: "User",
          created: teamMember.user.createdAt?.toISOString(),
          lastModified: teamMember.user.updatedAt?.toISOString(),
          location: `${baseUrl}/scim/v2/${req.params["projectScimId"]}/Users/${teamMember.user.id?.toString()}`,
        },
      };

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
      const oneuptimeRequest = req as OneUptimeRequest;
      const bearerData = oneuptimeRequest.bearerTokenData as JSONObject;
      const scimConfig = bearerData["scimConfig"] as ProjectSCIM;

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
  },
);

// Create User - POST /scim/v2/Users
router.post(
  "/scim/v2/:projectScimId/Users",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      const oneuptimeRequest = req as OneUptimeRequest;
      const bearerData = oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId = bearerData["projectId"] as ObjectID;
      const scimConfig = bearerData["scimConfig"] as ProjectSCIM;

      if (!scimConfig.autoProvisionUsers) {
        throw new BadRequestException("Auto-provisioning is disabled for this project");
      }

      const scimUser = req.body;
      const email = scimUser.userName || scimUser.emails?.[0]?.value;
      const name = scimUser.name?.formatted || scimUser.name?.givenName || scimUser.displayName;

      if (!email) {
        throw new BadRequestException("userName or email is required");
      }

      // Check if user already exists
      let user = await UserService.findOneBy({
        query: { email: new Email(email) },
        select: { _id: true, email: true, name: true, createdAt: true, updatedAt: true },
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

      // Add user to default teams if configured
      if (scimConfig.teams && scimConfig.teams.length > 0) {
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
      const oneuptimeRequest = req as OneUptimeRequest;
      const bearerData = oneuptimeRequest.bearerTokenData as JSONObject;
      const projectId = bearerData["projectId"] as ObjectID;
      const scimConfig = bearerData["scimConfig"] as ProjectSCIM;
      const userId = req.params["userId"];

      if (!scimConfig.autoDeprovisionUsers) {
        throw new BadRequestException("Auto-deprovisioning is disabled for this project");
      }

      if (!userId) {
        throw new BadRequestException("User ID is required");
      }

      // Remove user from all teams in this project
      await TeamMemberService.deleteBy({
        query: {
          projectId: projectId,
          userId: new ObjectID(userId),
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      });

      res.status(204);
      return Response.sendJsonObjectResponse(req, res, { message: "User deprovisioned" });
    } catch (err) {
      logger.error(err);
      return Response.sendErrorResponse(req, res, err as BadRequestException);
    }
  },
);

export default router;
