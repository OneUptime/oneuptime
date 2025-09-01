import SCIMMiddleware from "Common/Server/Middleware/SCIMAuthorization";
import StatusPagePrivateUserService from "Common/Server/Services/StatusPagePrivateUserService";
import StatusPageSCIMUserService from "Common/Server/Services/StatusPageSCIMUserService";
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
import StatusPageSCIMUser from "Common/Models/DatabaseModels/StatusPageSCIMUser";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
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
import Text from "Common/Types/Text";
import HashedString from "Common/Types/HashedString";

const router: ExpressRouter = Express.getRouter();

// Helper function to find user by external ID or email
const findUserByExternalIdOrEmail: (
  userName: string,
  statusPageId: ObjectID,
  projectId: ObjectID,
  scimConfigId: ObjectID,
) => Promise<StatusPagePrivateUser | null> = async (
  userName: string,
  statusPageId: ObjectID,
  projectId: ObjectID,
  scimConfigId: ObjectID,
): Promise<StatusPagePrivateUser | null> => {
  // First check if userName is an external ID (not an email)
  if (!isUserNameEmail(userName)) {
    logSCIMOperation(
      "User lookup",
      "status-page",
      scimConfigId.toString(),
      `Looking for external ID: ${userName}`,
    );
    
    // Look up by external ID
    const scimUser: StatusPageSCIMUser | null = await StatusPageSCIMUserService.findOneBy({
      query: {
        externalId: userName,
        statusPageId: statusPageId,
        projectId: projectId,
        scimConfigId: scimConfigId,
      },
      select: {
        statusPagePrivateUserId: true,
        statusPagePrivateUser: {
          _id: true,
          email: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      props: { isRoot: true },
    });
    
    if (scimUser && scimUser.statusPagePrivateUser) {
      logSCIMOperation(
        "User lookup",
        "status-page",
        scimConfigId.toString(),
        `Found user by external ID: ${scimUser.statusPagePrivateUser.id}`,
      );
      return scimUser.statusPagePrivateUser;
    }
  }
  
  // Fall back to email lookup
  try {
    logSCIMOperation(
      "User lookup",
      "status-page",
      scimConfigId.toString(),
      `Looking for email: ${userName}`,
    );
    
    const user: StatusPagePrivateUser | null = await StatusPagePrivateUserService.findOneBy({
      query: { 
        email: new Email(userName),
        statusPageId: statusPageId,
      },
      select: {
        _id: true,
        email: true,
        createdAt: true,
        updatedAt: true,
      },
      props: { isRoot: true },
    });
    
    if (user) {
      logSCIMOperation(
        "User lookup",
        "status-page",
        scimConfigId.toString(),
        `Found user by email: ${user.id}`,
      );
    }
    
    return user;
  } catch (error) {
    // If email validation fails, userName is likely an external ID but no mapping exists
    logSCIMOperation(
      "User lookup",
      "status-page",
      scimConfigId.toString(),
      `Email validation failed for: ${userName}, treating as external ID with no mapping`,
    );
    return null;
  }
};

// Helper function to create or update SCIM user mapping
const createOrUpdateSCIMUserMapping: (
  user: StatusPagePrivateUser,
  externalId: string,
  statusPageId: ObjectID,
  projectId: ObjectID,
  scimConfigId: ObjectID,
) => Promise<void> = async (
  user: StatusPagePrivateUser,
  externalId: string,
  statusPageId: ObjectID,
  projectId: ObjectID,
  scimConfigId: ObjectID,
): Promise<void> => {
  // Check if mapping already exists
  const existingMapping: StatusPageSCIMUser | null = await StatusPageSCIMUserService.findOneBy({
    query: {
      statusPagePrivateUserId: user.id!,
      statusPageId: statusPageId,
      projectId: projectId,
      scimConfigId: scimConfigId,
    },
    select: { _id: true, externalId: true },
    props: { isRoot: true },
  });
  
  if (existingMapping) {
    // Update existing mapping if external ID changed
    if (existingMapping.externalId !== externalId) {
      await StatusPageSCIMUserService.updateOneById({
        id: existingMapping.id!,
        data: { externalId: externalId },
        props: { isRoot: true },
      });
      
      logSCIMOperation(
        "SCIM mapping",
        "status-page",
        scimConfigId.toString(),
        `Updated external ID mapping for user ${user.id} from ${existingMapping.externalId} to ${externalId}`,
      );
    }
  } else {
    // Create new mapping
    const scimUser: StatusPageSCIMUser = new StatusPageSCIMUser();
    scimUser.statusPageId = statusPageId;
    scimUser.projectId = projectId;
    scimUser.scimConfigId = scimConfigId;
    scimUser.statusPagePrivateUserId = user.id!;
    scimUser.externalId = externalId;
    
    await StatusPageSCIMUserService.create({
      data: scimUser,
      props: { isRoot: true },
    });
    
    logSCIMOperation(
      "SCIM mapping",
      "status-page",
      scimConfigId.toString(),
      `Created external ID mapping for user ${user.id} with external ID ${externalId}`,
    );
  }
};

// Helper function to resolve user ID (could be internal ID or external ID)
const resolveUserId: (
  userIdParam: string,
  statusPageId: ObjectID,
  projectId: ObjectID,
  scimConfigId: ObjectID,
) => Promise<ObjectID | null> = async (
  userIdParam: string,
  statusPageId: ObjectID,
  projectId: ObjectID,
  scimConfigId: ObjectID,
): Promise<ObjectID | null> => {
  // First try to parse as ObjectID (internal user ID)
  try {
    const objectId: ObjectID = new ObjectID(userIdParam);
    
    // Verify this user exists in the status page
    const statusPageUser: StatusPagePrivateUser | null = await StatusPagePrivateUserService.findOneBy({
      query: {
        _id: objectId,
        statusPageId: statusPageId,
      },
      select: { _id: true },
      props: { isRoot: true },
    });
    
    if (statusPageUser) {
      return objectId;
    }
  } catch (error) {
    // Not a valid ObjectID, continue to external ID lookup
  }
  
  // Try to find by external ID
  const scimUser: StatusPageSCIMUser | null = await StatusPageSCIMUserService.findOneBy({
    query: {
      externalId: userIdParam,
      statusPageId: statusPageId,
      projectId: projectId,
      scimConfigId: scimConfigId,
    },
    select: { statusPagePrivateUserId: true },
    props: { isRoot: true },
  });
  
  if (scimUser && scimUser.statusPagePrivateUserId) {
    return scimUser.statusPagePrivateUserId;
  }
  
  return null;
};

// Helper function to get external ID for a user
const getExternalIdForUser: (
  userId: ObjectID,
  statusPageId: ObjectID,
  projectId: ObjectID,
  scimConfigId: ObjectID,
) => Promise<string | null> = async (
  userId: ObjectID,
  statusPageId: ObjectID,
  projectId: ObjectID,
  scimConfigId: ObjectID,
): Promise<string | null> => {
  const scimUser: StatusPageSCIMUser | null = await StatusPageSCIMUserService.findOneBy({
    query: {
      statusPagePrivateUserId: userId,
      statusPageId: statusPageId,
      projectId: projectId,
      scimConfigId: scimConfigId,
    },
    select: { externalId: true },
    props: { isRoot: true },
  });
  
  return scimUser?.externalId || null;
};

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
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const scimConfig: StatusPageSCIM = bearerData["scimConfig"] as StatusPageSCIM;

      // Parse query parameters
      const { startIndex, count } = parseSCIMQueryParams(req);
      const filter: string = req.query["filter"] as string;

      logSCIMOperation(
        "Users list",
        "status-page",
        req.params["statusPageScimId"]!,
        `statusPageId: ${statusPageId}, startIndex: ${startIndex}, count: ${count}, filter: ${filter || "none"}`,
      );

      let users: Array<StatusPagePrivateUser> = [];

      // Handle SCIM filter for userName
      if (filter) {
        const emailMatch: RegExpMatchArray | null = filter.match(
          /userName eq "([^"]+)"/i,
        );
        if (emailMatch) {
          const userName: string = emailMatch[1]!;
          logSCIMOperation(
            "Users list",
            "status-page",
            req.params["statusPageScimId"]!,
            `filter by userName: ${userName}`,
          );

          if (userName) {
            const user: StatusPagePrivateUser | null = await findUserByExternalIdOrEmail(
              userName,
              statusPageId,
              projectId,
              scimConfig.id!,
            );
            
            if (user) {
              users = [user];
              logSCIMOperation(
                "Users list",
                "status-page",
                req.params["statusPageScimId"]!,
                `found user with id: ${user.id}`,
              );
            } else {
              logSCIMOperation(
                "Users list",
                "status-page",
                req.params["statusPageScimId"]!,
                `user not found for userName: ${userName}`,
              );
              users = [];
            }
          }
        }
      } else {
        // Get all private users for this status page
        users = await StatusPagePrivateUserService.findBy({
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
      }

      logger.debug(
        `Status Page SCIM Users - found ${users.length} users`,
      );

      // Format users for SCIM with external IDs
      const formattedUsers: Array<JSONObject> = [];
      
      for (const user of users) {
        // Get external ID for this user if it exists
        const externalId: string | null = await getExternalIdForUser(
          user.id!,
          statusPageId,
          projectId,
          scimConfig.id!,
        );
        
        const userFormatted: JSONObject = formatUserForSCIM(
          user,
          req,
          req.params["statusPageScimId"]!,
          "status-page",
          externalId,
        );
        
        formattedUsers.push(userFormatted);
      }

      // Paginate the results
      const paginatedUsers: Array<JSONObject> = formattedUsers.slice(
        (startIndex - 1) * count,
        startIndex * count,
      );

      logger.debug(
        `Status Page SCIM Users response prepared with ${formattedUsers.length} users`,
      );

      return Response.sendJsonObjectResponse(
        req,
        res,
        generateUsersListResponse(paginatedUsers, startIndex, formattedUsers.length),
      );
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
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const scimConfig: StatusPageSCIM = bearerData["scimConfig"] as StatusPageSCIM;
      const userIdParam: string = req.params["userId"]!;

      logger.debug(
        `Status Page SCIM Get user - statusPageId: ${statusPageId}, userIdParam: ${userIdParam}`,
      );

      if (!userIdParam) {
        throw new BadRequestException("User ID is required");
      }

      // Resolve user ID (could be internal ID or external ID)
      const userId: ObjectID | null = await resolveUserId(
        userIdParam,
        statusPageId,
        projectId,
        scimConfig.id!,
      );

      if (!userId) {
        logger.debug(
          `Status Page SCIM Get user - could not resolve user ID for param: ${userIdParam}`,
        );
        throw new NotFoundException(
          "User not found or not part of this status page",
        );
      }

      // Check if user exists and belongs to this status page
      const statusPageUser: StatusPagePrivateUser | null =
        await StatusPagePrivateUserService.findOneBy({
          query: {
            statusPageId: statusPageId,
            _id: userId,
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
          `Status Page SCIM Get user - user not found for resolved userId: ${userId}`,
        );
        throw new NotFoundException(
          "User not found or not part of this status page",
        );
      }

      // Get external ID for this user if it exists
      const externalId: string | null = await getExternalIdForUser(
        statusPageUser.id!,
        statusPageId,
        projectId,
        scimConfig.id!,
      );

      const user: JSONObject = formatUserForSCIM(
        statusPageUser,
        req,
        req.params["statusPageScimId"]!,
        "status-page",
        externalId,
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
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const scimConfig: StatusPageSCIM = bearerData[
        "scimConfig"
      ] as StatusPageSCIM;

      if (!scimConfig.autoProvisionUsers) {
        throw new BadRequestException(
          "Auto-provisioning is disabled for this status page",
        );
      }

      const scimUser: JSONObject = req.body;
      const userName: string = extractEmailFromSCIM(scimUser);
      const externalId: string | null = extractExternalIdFromSCIM(scimUser);
      const name: string = parseNameFromSCIM(scimUser);

      logger.debug(
        `Status Page SCIM Create user - statusPageId: ${statusPageId}`,
      );

      logger.debug(
        `Request body for Status Page SCIM Create user: ${JSON.stringify(scimUser, null, 2)}`,
      );

      logger.debug(`Status Page SCIM Create user - userName: ${userName}, externalId: ${externalId}, name: ${name}`);

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
      let user: StatusPagePrivateUser | null = null;
      
      if (externalId) {
        user = await findUserByExternalIdOrEmail(
          externalId,
          statusPageId,
          projectId,
          scimConfig.id!,
        );
      }
      
      if (!user && email) {
        try {
          user = await StatusPagePrivateUserService.findOneBy({
            query: { 
              email: new Email(email),
              statusPageId: statusPageId,
            },
            select: {
              _id: true,
              email: true,
              createdAt: true,
              updatedAt: true,
            },
            props: { isRoot: true },
          });
        } catch (error) {
          // Email validation failed, continue without email lookup
          logger.debug(`Status Page SCIM Create user - email validation failed for: ${email}`);
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
          `Status Page SCIM Create user - creating new user with email: ${email}`,
        );

        const privateUser: StatusPagePrivateUser = new StatusPagePrivateUser();
        privateUser.statusPageId = statusPageId;
        privateUser.email = new Email(email);
        privateUser.password = new HashedString(Text.generateRandomText(32));
        privateUser.projectId = projectId;

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

      // Create or update SCIM user mapping if we have an external ID
      if (externalId && user.id) {
        await createOrUpdateSCIMUserMapping(
          user,
          externalId,
          statusPageId,
          projectId,
          scimConfig.id!,
        );
      }

      const createdUser: JSONObject = formatUserForSCIM(
        user,
        req,
        req.params["statusPageScimId"]!,
        "status-page",
        externalId,
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
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const scimConfig: StatusPageSCIM = bearerData["scimConfig"] as StatusPageSCIM;
      const userIdParam: string = req.params["userId"]!;
      const scimUser: JSONObject = req.body;

      logger.debug(
        `Status Page SCIM Update user - statusPageId: ${statusPageId}, userIdParam: ${userIdParam}`,
      );

      logger.debug(
        `Request body for Status Page SCIM Update user: ${JSON.stringify(scimUser, null, 2)}`,
      );

      if (!userIdParam) {
        throw new BadRequestException("User ID is required");
      }

      // Resolve user ID (could be internal ID or external ID)
      const userId: ObjectID | null = await resolveUserId(
        userIdParam,
        statusPageId,
        projectId,
        scimConfig.id!,
      );

      if (!userId) {
        logger.debug(
          `Status Page SCIM Update user - could not resolve user ID for param: ${userIdParam}`,
        );
        throw new NotFoundException(
          "User not found or not part of this status page",
        );
      }

      // Check if user exists and belongs to this status page
      const statusPageUser: StatusPagePrivateUser | null =
        await StatusPagePrivateUserService.findOneBy({
          query: {
            statusPageId: statusPageId,
            _id: userId,
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
          `Status Page SCIM Update user - user not found for resolved userId: ${userId}`,
        );
        throw new NotFoundException(
          "User not found or not part of this status page",
        );
      }

      // Update user information
      const userName: string = extractEmailFromSCIM(scimUser);
      const externalId: string | null = extractExternalIdFromSCIM(scimUser);
      const active: boolean = scimUser["active"] as boolean;

      logger.debug(
        `Status Page SCIM Update user - userName: ${userName}, externalId: ${externalId}, active: ${active}`,
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
          statusPageUser,
          externalId,
          statusPageId,
          projectId,
          scimConfig.id!,
        );
      }

      // Handle user deactivation by deleting from status page
      if (active === false) {
        logger.debug(
          `Status Page SCIM Update user - user marked as inactive, removing from status page`,
        );

        if (scimConfig.autoDeprovisionUsers) {
          await StatusPagePrivateUserService.deleteOneById({
            id: userId,
            props: { isRoot: true },
          });

          logger.debug(
            `Status Page SCIM Update user - user removed from status page`,
          );

          // Return empty response for deleted user
          res.status(204);
          return Response.sendJsonObjectResponse(req, res, {
            message: "User deprovisioned",
          });
        }
      }

      // Update email if provided and changed
      if (email && email !== statusPageUser.email?.toString()) {
        logger.debug(
          `Status Page SCIM Update user - updating email from ${statusPageUser.email?.toString()} to ${email}`,
        );

        await StatusPagePrivateUserService.updateOneById({
          id: userId,
          data: { email: new Email(email) },
          props: { isRoot: true },
        });

        // Fetch updated user
        const updatedUser: StatusPagePrivateUser | null = await StatusPagePrivateUserService.findOneById({
          id: userId,
          select: {
            _id: true,
            email: true,
            createdAt: true,
            updatedAt: true,
          },
          props: { isRoot: true },
        });

        if (updatedUser) {
          const userExternalId: string | null = await getExternalIdForUser(
            updatedUser.id!,
            statusPageId,
            projectId,
            scimConfig.id!,
          );
          
          const user: JSONObject = formatUserForSCIM(
            updatedUser,
            req,
            req.params["statusPageScimId"]!,
            "status-page",
            userExternalId,
          );
          return Response.sendJsonObjectResponse(req, res, user);
        }
      }

      logger.debug(
        `Status Page SCIM Update user - no updates made, returning existing user`,
      );

      // If no updates were made, return the existing user
      const userExternalId: string | null = await getExternalIdForUser(
        statusPageUser.id!,
        statusPageId,
        projectId,
        scimConfig.id!,
      );
      
      const user: JSONObject = formatUserForSCIM(
        statusPageUser,
        req,
        req.params["statusPageScimId"]!,
        "status-page",
        userExternalId,
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
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const scimConfig: StatusPageSCIM = bearerData["scimConfig"] as StatusPageSCIM;
      const userIdParam: string = req.params["userId"]!;

      if (!scimConfig.autoDeprovisionUsers) {
        throw new BadRequestException(
          "Auto-deprovisioning is disabled for this status page",
        );
      }

      logger.debug(
        `Status Page SCIM Delete user - statusPageId: ${statusPageId}, userIdParam: ${userIdParam}`,
      );

      if (!userIdParam) {
        throw new BadRequestException("User ID is required");
      }

      // Resolve user ID (could be internal ID or external ID)
      const userId: ObjectID | null = await resolveUserId(
        userIdParam,
        statusPageId,
        projectId,
        scimConfig.id!,
      );

      if (!userId) {
        logger.debug(
          `Status Page SCIM Delete user - could not resolve user ID for param: ${userIdParam}`,
        );
        throw new NotFoundException("User not found");
      }

      // Check if user exists and belongs to this status page
      const statusPageUser: StatusPagePrivateUser | null =
        await StatusPagePrivateUserService.findOneBy({
          query: {
            statusPageId: statusPageId,
            _id: userId,
          },
          select: {
            _id: true,
          },
          props: { isRoot: true },
        });

      if (!statusPageUser) {
        logger.debug(
          `Status Page SCIM Delete user - user not found for resolved userId: ${userId}`,
        );
        // SCIM spec says to return 404 for non-existent resources
        throw new NotFoundException("User not found");
      }

      // Delete the user from status page
      await StatusPagePrivateUserService.deleteOneById({
        id: userId,
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
