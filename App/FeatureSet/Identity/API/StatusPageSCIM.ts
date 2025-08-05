import SCIMMiddleware from "Common/Server/Middleware/SCIMAuthorization";
import StatusPagePrivateUserService from "Common/Server/Services/StatusPagePrivateUserService";
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
import { JSONObject } from "Common/Types/JSON";
import StatusPagePrivateUser from "Common/Models/DatabaseModels/StatusPagePrivateUser";
import StatusPageSCIM from "Common/Models/DatabaseModels/StatusPageSCIM";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import {
  formatUserForSCIM,
  generateServiceProviderConfig,
  logSCIMOperation,
} from "../Utils/SCIMUtils";
import Text from "Common/Types/Text";
import HashedString from "Common/Types/HashedString";

const router: ExpressRouter = Express.getRouter();

// SCIM Service Provider Configuration - GET /status-page-scim/v2/ServiceProviderConfig
router.get(
  "/status-page-scim/v2/:statusPageScimId/ServiceProviderConfig",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      logSCIMOperation(
        "ServiceProviderConfig",
        "status-page",
        req.params["statusPageScimId"]!,
      );

      const serviceProviderConfig: JSONObject = generateServiceProviderConfig(
        req,
        req.params["statusPageScimId"]!,
        "status-page",
      );

      return Response.sendJsonObjectResponse(req, res, serviceProviderConfig);
    } catch (err) {
      logger.error(err);
      return Response.sendErrorResponse(req, res, err as BadRequestException);
    }
  },
);

// Status Page Users endpoint - GET /status-page-scim/v2/Users
router.get(
  "/status-page-scim/v2/:statusPageScimId/Users",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      logger.debug(
        `Status Page SCIM Users list request for statusPageScimId: ${req.params["statusPageScimId"]}`,
      );
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const statusPageId: ObjectID = bearerData["statusPageId"] as ObjectID;

      // Parse query parameters
      const startIndex: number =
        parseInt(req.query["startIndex"] as string) || 1;
      const count: number = Math.min(
        parseInt(req.query["count"] as string) || 100,
        LIMIT_PER_PROJECT,
      );

      logger.debug(
        `Status Page SCIM Users - statusPageId: ${statusPageId}, startIndex: ${startIndex}, count: ${count}`,
      );

      // Get all private users for this status page
      const statusPageUsers: Array<StatusPagePrivateUser> =
        await StatusPagePrivateUserService.findBy({
          query: {
            statusPageId: statusPageId,
          },
          select: {
            _id: true,
            email: true,
            createdAt: true,
            updatedAt: true,
          },
          skip: 0,
          limit: LIMIT_MAX,
          props: { isRoot: true },
        });

      logger.debug(
        `Status Page SCIM Users - found ${statusPageUsers.length} users`,
      );

      // Format users for SCIM
      const users: Array<JSONObject> = statusPageUsers.map(
        (user: StatusPagePrivateUser) => {
          return formatUserForSCIM(
            user,
            req,
            req.params["statusPageScimId"]!,
            "status-page",
          );
        },
      );

      // Paginate the results
      const paginatedUsers: Array<JSONObject> = users.slice(
        (startIndex - 1) * count,
        startIndex * count,
      );

      logger.debug(
        `Status Page SCIM Users response prepared with ${users.length} users`,
      );

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

// Get Individual Status Page User - GET /status-page-scim/v2/Users/{id}
router.get(
  "/status-page-scim/v2/:statusPageScimId/Users/:userId",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      logger.debug(
        `Status Page SCIM Get individual user request for userId: ${req.params["userId"]}, statusPageScimId: ${req.params["statusPageScimId"]}`,
      );
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const statusPageId: ObjectID = bearerData["statusPageId"] as ObjectID;
      const userId: string = req.params["userId"]!;

      logger.debug(
        `Status Page SCIM Get user - statusPageId: ${statusPageId}, userId: ${userId}`,
      );

      if (!userId) {
        throw new BadRequestException("User ID is required");
      }

      // Check if user exists and belongs to this status page
      const statusPageUser: StatusPagePrivateUser | null =
        await StatusPagePrivateUserService.findOneBy({
          query: {
            statusPageId: statusPageId,
            _id: new ObjectID(userId),
          },
          select: {
            _id: true,
            email: true,
            createdAt: true,
            updatedAt: true,
          },
          props: { isRoot: true },
        });

      if (!statusPageUser) {
        logger.debug(
          `Status Page SCIM Get user - user not found for userId: ${userId}`,
        );
        throw new NotFoundException(
          "User not found or not part of this status page",
        );
      }

      const user: JSONObject = formatUserForSCIM(
        statusPageUser,
        req,
        req.params["statusPageScimId"]!,
        "status-page",
      );

      logger.debug(
        `Status Page SCIM Get user - returning user with id: ${statusPageUser.id}`,
      );

      return Response.sendJsonObjectResponse(req, res, user);
    } catch (err) {
      logger.error(err);
      return Response.sendErrorResponse(req, res, err as BadRequestException);
    }
  },
);

// Create Status Page User - POST /status-page-scim/v2/Users
router.post(
  "/status-page-scim/v2/:statusPageScimId/Users",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      logger.debug(
        `Status Page SCIM Create user request for statusPageScimId: ${req.params["statusPageScimId"]}`,
      );
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const statusPageId: ObjectID = bearerData["statusPageId"] as ObjectID;
      const scimConfig: StatusPageSCIM = bearerData[
        "scimConfig"
      ] as StatusPageSCIM;

      if (!scimConfig.autoProvisionUsers) {
        throw new BadRequestException(
          "Auto-provisioning is disabled for this status page",
        );
      }

      const scimUser: JSONObject = req.body;

      logger.debug(
        `Status Page SCIM Create user - statusPageId: ${statusPageId}`,
      );

      logger.debug(
        `Request body for Status Page SCIM Create user: ${JSON.stringify(scimUser, null, 2)}`,
      );

      // Extract user data from SCIM payload
      const email: string =
        (scimUser["userName"] as string) ||
        ((scimUser["emails"] as JSONObject[])?.[0]?.["value"] as string);

      if (!email) {
        throw new BadRequestException("Email is required for user creation");
      }

      logger.debug(`Status Page SCIM Create user - email: ${email}`);

      // Check if user already exists for this status page
      let user: StatusPagePrivateUser | null =
        await StatusPagePrivateUserService.findOneBy({
          query: {
            statusPageId: statusPageId,
            email: new Email(email),
          },
          select: {
            _id: true,
            email: true,
            createdAt: true,
            updatedAt: true,
          },
          props: { isRoot: true },
        });

      if (!user) {
        logger.debug(
          `Status Page SCIM Create user - creating new user with email: ${email}`,
        );

        const privateUser: StatusPagePrivateUser = new StatusPagePrivateUser();
        privateUser.statusPageId = statusPageId;
        privateUser.email = new Email(email);
        privateUser.password = new HashedString(Text.generateRandomText(32));
        privateUser.projectId = bearerData["projectId"] as ObjectID;

        // Create new status page private user
        user = await StatusPagePrivateUserService.create({
          data: privateUser as any,
          props: { isRoot: true },
        });
      } else {
        logger.debug(
          `Status Page SCIM Create user - user already exists with id: ${user.id}`,
        );
      }

      const createdUser: JSONObject = formatUserForSCIM(
        user,
        req,
        req.params["statusPageScimId"]!,
        "status-page",
      );

      logger.debug(
        `Status Page SCIM Create user - returning created user with id: ${user.id}`,
      );

      res.status(201);
      return Response.sendJsonObjectResponse(req, res, createdUser);
    } catch (err) {
      logger.error(err);
      return Response.sendErrorResponse(req, res, err as BadRequestException);
    }
  },
);

// Update Status Page User - PUT /status-page-scim/v2/Users/{id}
router.put(
  "/status-page-scim/v2/:statusPageScimId/Users/:userId",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      logger.debug(
        `Status Page SCIM Update user request for userId: ${req.params["userId"]}, statusPageScimId: ${req.params["statusPageScimId"]}`,
      );
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const statusPageId: ObjectID = bearerData["statusPageId"] as ObjectID;
      const userId: string = req.params["userId"]!;
      const scimUser: JSONObject = req.body;

      logger.debug(
        `Status Page SCIM Update user - statusPageId: ${statusPageId}, userId: ${userId}`,
      );

      logger.debug(
        `Request body for Status Page SCIM Update user: ${JSON.stringify(scimUser, null, 2)}`,
      );

      if (!userId) {
        throw new BadRequestException("User ID is required");
      }

      // Check if user exists and belongs to this status page
      const statusPageUser: StatusPagePrivateUser | null =
        await StatusPagePrivateUserService.findOneBy({
          query: {
            statusPageId: statusPageId,
            _id: new ObjectID(userId),
          },
          select: {
            _id: true,
            email: true,
            createdAt: true,
            updatedAt: true,
          },
          props: { isRoot: true },
        });

      if (!statusPageUser) {
        logger.debug(
          `Status Page SCIM Update user - user not found for userId: ${userId}`,
        );
        throw new NotFoundException(
          "User not found or not part of this status page",
        );
      }

      // Update user information
      const email: string =
        (scimUser["userName"] as string) ||
        ((scimUser["emails"] as JSONObject[])?.[0]?.["value"] as string);
      const active: boolean = scimUser["active"] as boolean;

      logger.debug(
        `Status Page SCIM Update user - email: ${email}, active: ${active}`,
      );

      // Handle user deactivation by deleting from status page
      if (active === false) {
        logger.debug(
          `Status Page SCIM Update user - user marked as inactive, removing from status page`,
        );

        const scimConfig: StatusPageSCIM = bearerData[
          "scimConfig"
        ] as StatusPageSCIM;
        if (scimConfig.autoDeprovisionUsers) {
          await StatusPagePrivateUserService.deleteOneById({
            id: new ObjectID(userId),
            props: { isRoot: true },
          });

          logger.debug(
            `Status Page SCIM Update user - user removed from status page`,
          );

          // Return empty response for deleted user
          return Response.sendJsonObjectResponse(req, res, {});
        }
      }

      // Prepare update data
      const updateData: {
        email?: Email;
      } = {};

      if (email && email !== statusPageUser.email?.toString()) {
        updateData.email = new Email(email);
      }

      // Only update if there are changes
      if (Object.keys(updateData).length > 0) {
        logger.debug(
          `Status Page SCIM Update user - updating user with data: ${JSON.stringify(updateData)}`,
        );

        await StatusPagePrivateUserService.updateOneById({
          id: new ObjectID(userId),
          data: updateData,
          props: { isRoot: true },
        });

        logger.debug(
          `Status Page SCIM Update user - user updated successfully`,
        );

        // Fetch updated user
        const updatedUser: StatusPagePrivateUser | null =
          await StatusPagePrivateUserService.findOneById({
            id: new ObjectID(userId),
            select: {
              _id: true,
              email: true,
              createdAt: true,
              updatedAt: true,
            },
            props: { isRoot: true },
          });

        if (updatedUser) {
          const user: JSONObject = formatUserForSCIM(
            updatedUser,
            req,
            req.params["statusPageScimId"]!,
            "status-page",
          );
          return Response.sendJsonObjectResponse(req, res, user);
        }
      }

      logger.debug(
        `Status Page SCIM Update user - no updates made, returning existing user`,
      );

      // If no updates were made, return the existing user
      const user: JSONObject = formatUserForSCIM(
        statusPageUser,
        req,
        req.params["statusPageScimId"]!,
        "status-page",
      );

      return Response.sendJsonObjectResponse(req, res, user);
    } catch (err) {
      logger.error(err);
      return Response.sendErrorResponse(req, res, err as BadRequestException);
    }
  },
);

// Delete Status Page User - DELETE /status-page-scim/v2/Users/{id}
router.delete(
  "/status-page-scim/v2/:statusPageScimId/Users/:userId",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      logger.debug(
        `Status Page SCIM Delete user request for userId: ${req.params["userId"]}, statusPageScimId: ${req.params["statusPageScimId"]}`,
      );
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const statusPageId: ObjectID = bearerData["statusPageId"] as ObjectID;
      const scimConfig: StatusPageSCIM = bearerData[
        "scimConfig"
      ] as StatusPageSCIM;
      const userId: string = req.params["userId"]!;

      if (!scimConfig.autoDeprovisionUsers) {
        throw new BadRequestException(
          "Auto-deprovisioning is disabled for this status page",
        );
      }

      logger.debug(
        `Status Page SCIM Delete user - statusPageId: ${statusPageId}, userId: ${userId}`,
      );

      if (!userId) {
        throw new BadRequestException("User ID is required");
      }

      // Check if user exists and belongs to this status page
      const statusPageUser: StatusPagePrivateUser | null =
        await StatusPagePrivateUserService.findOneBy({
          query: {
            statusPageId: statusPageId,
            _id: new ObjectID(userId),
          },
          select: {
            _id: true,
          },
          props: { isRoot: true },
        });

      if (!statusPageUser) {
        logger.debug(
          `Status Page SCIM Delete user - user not found for userId: ${userId}`,
        );
        // SCIM spec says to return 404 for non-existent resources
        throw new NotFoundException("User not found");
      }

      // Delete the user from status page
      await StatusPagePrivateUserService.deleteOneById({
        id: new ObjectID(userId),
        props: { isRoot: true },
      });

      logger.debug(
        `Status Page SCIM Delete user - user deleted successfully for userId: ${userId}`,
      );

      // Return 204 No Content for successful deletion
      res.status(204);
      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      logger.error(err);
      return Response.sendErrorResponse(req, res, err as BadRequestException);
    }
  },
);

export default router;
