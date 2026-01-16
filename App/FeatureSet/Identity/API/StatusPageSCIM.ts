import SCIMMiddleware from "Common/Server/Middleware/SCIMAuthorization";
import StatusPagePrivateUserService from "Common/Server/Services/StatusPagePrivateUserService";
import { createStatusPageSCIMLog } from "../Utils/SCIMLogger";
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
import { JSONObject } from "Common/Types/JSON";
import StatusPagePrivateUser from "Common/Models/DatabaseModels/StatusPagePrivateUser";
import StatusPageSCIM from "Common/Models/DatabaseModels/StatusPageSCIM";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import {
  formatUserForSCIM,
  generateServiceProviderConfig,
  generateSchemasResponse,
  generateResourceTypesResponse,
  validateBulkRequest,
  parseBulkOperationPath,
  generateBulkResponse,
  SCIMBulkOperationResponse,
  generateSCIMErrorResponse,
  SCIMErrorType,
} from "../Utils/SCIMUtils";
import Text from "Common/Types/Text";
import HashedString from "Common/Types/HashedString";

const router: ExpressRouter = Express.getRouter();

// SCIM Service Provider Configuration - GET /status-page-scim/v2/ServiceProviderConfig
router.get(
  "/status-page-scim/v2/:statusPageScimId/ServiceProviderConfig",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      logger.debug(
        `Status Page SCIM ServiceProviderConfig - scimId: ${req.params["statusPageScimId"]!}`,
      );

      const serviceProviderConfig: JSONObject = generateServiceProviderConfig(
        req,
        req.params["statusPageScimId"]!,
        "status-page",
      );

      return Response.sendJsonObjectResponse(req, res, serviceProviderConfig);
    } catch (err) {
      logger.error(err);
      return next(err);
    }
  },
);

// SCIM Schemas endpoint - GET /status-page-scim/v2/Schemas
router.get(
  "/status-page-scim/v2/:statusPageScimId/Schemas",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      logger.debug(
        `Status Page SCIM Schemas - scimId: ${req.params["statusPageScimId"]!}`,
      );

      const schemasResponse: JSONObject = generateSchemasResponse(
        req,
        req.params["statusPageScimId"]!,
        "status-page",
      );

      logger.debug("Status Page SCIM Schemas response prepared successfully");
      return Response.sendJsonObjectResponse(req, res, schemasResponse);
    } catch (err) {
      logger.error(err);
      return next(err);
    }
  },
);

// SCIM ResourceTypes endpoint - GET /status-page-scim/v2/ResourceTypes
router.get(
  "/status-page-scim/v2/:statusPageScimId/ResourceTypes",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      logger.debug(
        `Status Page SCIM ResourceTypes - scimId: ${req.params["statusPageScimId"]!}`,
      );

      const resourceTypesResponse: JSONObject = generateResourceTypesResponse(
        req,
        req.params["statusPageScimId"]!,
        "status-page",
      );

      logger.debug(
        "Status Page SCIM ResourceTypes response prepared successfully",
      );
      return Response.sendJsonObjectResponse(req, res, resourceTypesResponse);
    } catch (err) {
      logger.error(err);
      return next(err);
    }
  },
);

// SCIM Bulk Operations endpoint - POST /status-page-scim/v2/Bulk
router.post(
  "/status-page-scim/v2/:statusPageScimId/Bulk",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    const executionSteps: string[] = [];
    executionSteps.push("Received SCIM BulkOperation request");

    // Counters for tracking operations
    let usersCreated: number = 0;
    let usersUpdated: number = 0;
    let usersDeleted: number = 0;
    let usersDeactivated: number = 0;

    try {
      logger.debug(
        `Status Page SCIM Bulk request - scimId: ${req.params["statusPageScimId"]!}`,
      );

      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const statusPageId: ObjectID = bearerData["statusPageId"] as ObjectID;
      const projectId: ObjectID = bearerData["projectId"] as ObjectID;
      const scimConfig: StatusPageSCIM = bearerData[
        "scimConfig"
      ] as StatusPageSCIM;
      const statusPageScimId: string = req.params["statusPageScimId"]!;

      executionSteps.push("Authenticated and extracted status page context");

      // Validate the bulk request
      executionSteps.push("Validating bulk request structure");
      const validation: { valid: boolean; error?: string } =
        validateBulkRequest(req.body, 1000);
      if (!validation.valid) {
        executionSteps.push(`Validation failed: ${validation.error}`);
        logger.debug(
          `Status Page SCIM Bulk - validation failed: ${validation.error}`,
        );

        void createStatusPageSCIMLog({
          projectId: projectId,
          statusPageId: statusPageId,
          statusPageScimId: new ObjectID(statusPageScimId),
          operationType: "BulkOperation",
          status: SCIMLogStatus.Error,
          statusMessage: `Validation failed: ${validation.error}`,
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
        `Processing ${operations.length} operations (failOnErrors=${failOnErrors})`,
      );
      logger.debug(
        `Status Page SCIM Bulk - processing ${operations.length} operations`,
      );

      for (let opIndex: number = 0; opIndex < operations.length; opIndex++) {
        const operation: JSONObject = operations[opIndex]!;
        const method: string = (operation["method"] as string).toUpperCase();
        const path: string = operation["path"] as string;
        const bulkId: string | undefined = operation["bulkId"] as
          | string
          | undefined;
        const data: JSONObject | undefined = operation["data"] as
          | JSONObject
          | undefined;

        const { resourceType, resourceId } = parseBulkOperationPath(path);
        executionSteps.push(
          `Operation ${opIndex + 1}: ${method} ${path} (resourceType=${resourceType}, resourceId=${resourceId || "N/A"})`,
        );

        let operationResult: SCIMBulkOperationResponse = {
          method: method,
          bulkId: bulkId,
          status: "400",
        };

        try {
          // Handle Users operations only (Status Page SCIM doesn't support Groups)
          if (resourceType === "Users") {
            if (method === "POST") {
              // Create User
              executionSteps.push(
                `  [POST User] Checking auto-provisioning status`,
              );
              if (!scimConfig.autoProvisionUsers) {
                executionSteps.push(
                  `  [POST User] Auto-provisioning is disabled`,
                );
                throw new BadRequestException(
                  "Auto-provisioning is disabled for this status page",
                );
              }

              const email: string =
                (data!["userName"] as string) ||
                ((data!["emails"] as JSONObject[])?.[0]?.["value"] as string);

              executionSteps.push(
                `  [POST User] Extracted email: ${email || "not found"}`,
              );
              if (!email) {
                throw new BadRequestException(
                  "Email is required for user creation",
                );
              }

              // Check if user already exists for this status page
              executionSteps.push(
                `  [POST User] Checking if user already exists`,
              );
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
                executionSteps.push(
                  `  [POST User] User does not exist, creating new user`,
                );
                const privateUser: StatusPagePrivateUser =
                  new StatusPagePrivateUser();
                privateUser.statusPageId = statusPageId;
                privateUser.email = new Email(email);
                privateUser.password = new HashedString(
                  Text.generateRandomText(32),
                );
                privateUser.projectId = projectId;

                user = await StatusPagePrivateUserService.create({
                  data: privateUser as StatusPagePrivateUser,
                  props: { isRoot: true },
                });
                usersCreated++;
                executionSteps.push(
                  `  [POST User] User created with ID: ${user.id?.toString()}`,
                );
              } else {
                executionSteps.push(
                  `  [POST User] User already exists with ID: ${user.id?.toString()}`,
                );
              }

              const createdUser: JSONObject = formatUserForSCIM(
                user,
                req,
                statusPageScimId,
                "status-page",
              );

              operationResult = {
                method: method,
                bulkId: bulkId,
                status: "201",
                location: `/status-page-scim/v2/${statusPageScimId}/Users/${user.id?.toString()}`,
                response: createdUser,
              };
              executionSteps.push(
                `  [POST User] Operation completed successfully`,
              );
            } else if (method === "PUT" || method === "PATCH") {
              // Update User
              executionSteps.push(`  [${method} User] Starting user update`);
              if (!resourceId) {
                executionSteps.push(
                  `  [${method} User] Error: User ID is required`,
                );
                throw new BadRequestException("User ID is required");
              }

              const userId: ObjectID = new ObjectID(resourceId);

              // Check if user exists and belongs to this status page
              executionSteps.push(`  [${method} User] Checking if user exists`);
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
                executionSteps.push(`  [${method} User] User not found`);
                throw new NotFoundException(
                  "User not found or not part of this status page",
                );
              }
              executionSteps.push(
                `  [${method} User] User found: ${statusPageUser.email?.toString()}`,
              );

              // Update user information
              const email: string =
                (data!["userName"] as string) ||
                ((data!["emails"] as JSONObject[])?.[0]?.["value"] as string);
              const active: boolean = data!["active"] as boolean;

              executionSteps.push(
                `  [${method} User] Update data - email: ${email || "not provided"}, active: ${active !== undefined ? active : "not provided"}`,
              );

              // Handle user deactivation by deleting from status page
              if (active === false && scimConfig.autoDeprovisionUsers) {
                executionSteps.push(
                  `  [${method} User] User marked inactive, deleting from status page`,
                );
                await StatusPagePrivateUserService.deleteOneById({
                  id: userId,
                  props: { isRoot: true },
                });
                usersDeactivated++;
                executionSteps.push(
                  `  [${method} User] User deleted via deactivation`,
                );

                operationResult = {
                  method: method,
                  bulkId: bulkId,
                  status: "204",
                  location: `/status-page-scim/v2/${statusPageScimId}/Users/${resourceId}`,
                };
              } else {
                // Update email if provided
                if (email && email !== statusPageUser.email?.toString()) {
                  executionSteps.push(
                    `  [${method} User] Updating email from ${statusPageUser.email?.toString()} to ${email}`,
                  );
                  await StatusPagePrivateUserService.updateOneById({
                    id: userId,
                    data: { email: new Email(email) },
                    props: { isRoot: true },
                  });
                  usersUpdated++;
                } else {
                  executionSteps.push(
                    `  [${method} User] No email change needed`,
                  );
                }

                // Fetch updated user
                const updatedUser: StatusPagePrivateUser | null =
                  await StatusPagePrivateUserService.findOneById({
                    id: userId,
                    select: {
                      _id: true,
                      email: true,
                      createdAt: true,
                      updatedAt: true,
                    },
                    props: { isRoot: true },
                  });

                const userResponse: JSONObject = formatUserForSCIM(
                  updatedUser || statusPageUser,
                  req,
                  statusPageScimId,
                  "status-page",
                );

                operationResult = {
                  method: method,
                  bulkId: bulkId,
                  status: "200",
                  location: `/status-page-scim/v2/${statusPageScimId}/Users/${resourceId}`,
                  response: userResponse,
                };
                executionSteps.push(
                  `  [${method} User] Operation completed successfully`,
                );
              }
            } else if (method === "DELETE") {
              // Delete User
              executionSteps.push(`  [DELETE User] Starting user deletion`);
              if (!resourceId) {
                executionSteps.push(
                  `  [DELETE User] Error: User ID is required`,
                );
                throw new BadRequestException("User ID is required");
              }

              if (!scimConfig.autoDeprovisionUsers) {
                executionSteps.push(
                  `  [DELETE User] Auto-deprovisioning is disabled`,
                );
                throw new BadRequestException(
                  "Auto-deprovisioning is disabled for this status page",
                );
              }

              const userId: ObjectID = new ObjectID(resourceId);

              // Check if user exists
              executionSteps.push(`  [DELETE User] Checking if user exists`);
              const statusPageUser: StatusPagePrivateUser | null =
                await StatusPagePrivateUserService.findOneBy({
                  query: {
                    statusPageId: statusPageId,
                    _id: userId,
                  },
                  select: { _id: true, email: true },
                  props: { isRoot: true },
                });

              if (!statusPageUser) {
                executionSteps.push(`  [DELETE User] User not found`);
                throw new NotFoundException("User not found");
              }
              executionSteps.push(
                `  [DELETE User] User found: ${statusPageUser.email?.toString()}`,
              );

              // Delete the user from status page
              executionSteps.push(
                `  [DELETE User] Deleting user from status page`,
              );
              await StatusPagePrivateUserService.deleteOneById({
                id: userId,
                props: { isRoot: true },
              });
              usersDeleted++;
              executionSteps.push(`  [DELETE User] User deleted successfully`);

              operationResult = {
                method: method,
                bulkId: bulkId,
                status: "204",
                location: `/status-page-scim/v2/${statusPageScimId}/Users/${resourceId}`,
              };
            }
          } else if (resourceType === "Groups") {
            executionSteps.push(
              `  [Groups] Groups are not supported for Status Page SCIM`,
            );
            throw new BadRequestException(
              "Groups are not supported for Status Page SCIM. Only Users are available.",
            );
          } else {
            executionSteps.push(`  Unknown resource type: ${resourceType}`);
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

          executionSteps.push(
            `  Operation ${opIndex + 1} failed: ${error.message} (status=${status})`,
          );

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
            `Status Page SCIM Bulk - operation failed: ${error.message}`,
          );

          // Check if we should stop processing due to failOnErrors
          if (failOnErrors > 0 && errorCount >= failOnErrors) {
            executionSteps.push(
              `Stopping due to failOnErrors threshold (${failOnErrors} errors reached)`,
            );
            logger.debug(
              `Status Page SCIM Bulk - stopping due to failOnErrors threshold (${failOnErrors})`,
            );
            results.push(operationResult);
            break;
          }
        }

        results.push(operationResult);
      }

      executionSteps.push(
        `Bulk operation completed: ${results.length} operations processed`,
      );
      executionSteps.push(
        `Summary: ${usersCreated} created, ${usersUpdated} updated, ${usersDeleted} deleted, ${usersDeactivated} deactivated, ${errorCount} errors`,
      );
      logger.debug(
        `Status Page SCIM Bulk - completed processing ${results.length} operations with ${errorCount} errors`,
      );

      const bulkResponse: JSONObject = generateBulkResponse(results);

      // Log the bulk operation
      void createStatusPageSCIMLog({
        projectId: projectId,
        statusPageId: statusPageId,
        statusPageScimId: new ObjectID(statusPageScimId),
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
          processedOperations: results.length,
          usersCreated: usersCreated,
          usersUpdated: usersUpdated,
          usersDeleted: usersDeleted,
          usersDeactivated: usersDeactivated,
          errorCount: errorCount,
          failOnErrors: failOnErrors,
          stoppedEarly: results.length < operations.length,
        },
      });

      return Response.sendJsonObjectResponse(req, res, bulkResponse);
    } catch (err) {
      executionSteps.push(`Error occurred: ${(err as Error).message}`);
      // Log the error
      const oneuptimeRequestErr: OneUptimeRequest = req as OneUptimeRequest;
      const bearerDataErr: JSONObject =
        oneuptimeRequestErr.bearerTokenData as JSONObject;
      void createStatusPageSCIMLog({
        projectId: bearerDataErr["projectId"] as ObjectID,
        statusPageId: bearerDataErr["statusPageId"] as ObjectID,
        statusPageScimId: new ObjectID(req.params["statusPageScimId"]!),
        operationType: "BulkOperation",
        status: SCIMLogStatus.Error,
        statusMessage: (err as Error).message,
        httpMethod: "POST",
        requestPath: req.path,
        httpStatusCode: 500,
        requestBody: req.body,
        steps: executionSteps,
        additionalContext: {
          usersCreated: usersCreated,
          usersUpdated: usersUpdated,
          usersDeleted: usersDeleted,
          usersDeactivated: usersDeactivated,
        },
      });

      logger.error(err);
      return next(err);
    }
  },
);

// Status Page Users endpoint - GET /status-page-scim/v2/Users
router.get(
  "/status-page-scim/v2/:statusPageScimId/Users",
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
        `Status Page SCIM Users list request for statusPageScimId: ${req.params["statusPageScimId"]}`,
      );
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const statusPageId: ObjectID = bearerData["statusPageId"] as ObjectID;

      executionSteps.push("Authenticated and extracted status page context");

      // Parse query parameters
      const startIndex: number =
        parseInt(req.query["startIndex"] as string) || 1;
      const count: number = Math.min(
        parseInt(req.query["count"] as string) || 100,
        LIMIT_PER_PROJECT,
      );
      const filter: string = req.query["filter"] as string;
      executionSteps.push(
        `Parsed query params: startIndex=${startIndex}, count=${count}, filter=${filter || "none"}`,
      );

      logger.debug(
        `Status Page SCIM Users - statusPageId: ${statusPageId}, startIndex: ${startIndex}, count: ${count}, filter: ${filter || "none"}`,
      );

      // Build query for status page users
      const query: any = {
        statusPageId: statusPageId,
      };

      // Handle SCIM filter for userName
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
            `Status Page SCIM Users list - statusPageScimId: ${req.params["statusPageScimId"]!}, filter by email: ${email}`,
          );
          executionSteps.push(`Filter parsed: userName eq "${email}"`);

          if (email) {
            if (Email.isValid(email)) {
              query.email = new Email(email);
              logger.debug(
                `Status Page SCIM Users list - statusPageScimId: ${req.params["statusPageScimId"]!}, filtering by email: ${email}`,
              );
              executionSteps.push(`Valid email, filtering by: ${email}`);
            } else {
              logger.debug(
                `Status Page SCIM Users list - statusPageScimId: ${req.params["statusPageScimId"]!}, invalid email format in filter: ${email}`,
              );
              executionSteps.push(
                `Invalid email format: ${email}, returning empty list`,
              );
              const emptyResponse: JSONObject = {
                schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
                totalResults: 0,
                startIndex: startIndex,
                itemsPerPage: 0,
                Resources: [],
              };
              void createStatusPageSCIMLog({
                projectId: bearerData["projectId"] as ObjectID,
                statusPageId: statusPageId,
                statusPageScimId: new ObjectID(req.params["statusPageScimId"]!),
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

      // Get all private users for this status page
      executionSteps.push("Querying status page private users from database");
      const statusPageUsers: Array<StatusPagePrivateUser> =
        await StatusPagePrivateUserService.findBy({
          query: query,
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
      executionSteps.push(`Found ${statusPageUsers.length} users`);

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

      // Paginate the results (startIndex is 1-based in SCIM)
      const paginatedUsers: Array<JSONObject> = users.slice(
        startIndex - 1,
        startIndex - 1 + count,
      );
      executionSteps.push(
        `Paginated results: returning ${paginatedUsers.length} users (page ${Math.floor((startIndex - 1) / count) + 1})`,
      );

      logger.debug(
        `Status Page SCIM Users response prepared with ${users.length} users`,
      );

      const responseBody: JSONObject = {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        totalResults: users.length,
        startIndex: startIndex,
        itemsPerPage: paginatedUsers.length,
        Resources: paginatedUsers,
      };
      executionSteps.push("Generated SCIM-compliant ListResponse");

      // Log the operation
      void createStatusPageSCIMLog({
        projectId: bearerData["projectId"] as ObjectID,
        statusPageId: statusPageId,
        statusPageScimId: new ObjectID(req.params["statusPageScimId"]!),
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
          totalUsersOnStatusPage: users.length,
          returnedUsersCount: paginatedUsers.length,
          filterEmail: filterEmail || null,
        },
      });

      return Response.sendJsonObjectResponse(req, res, responseBody);
    } catch (err) {
      executionSteps.push(`Error occurred: ${(err as Error).message}`);
      // Log the error
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      void createStatusPageSCIMLog({
        projectId: bearerData["projectId"] as ObjectID,
        statusPageId: bearerData["statusPageId"] as ObjectID,
        statusPageScimId: new ObjectID(req.params["statusPageScimId"]!),
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

// Get Individual Status Page User - GET /status-page-scim/v2/Users/{id}
router.get(
  "/status-page-scim/v2/:statusPageScimId/Users/:userId",
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
        `Status Page SCIM Get individual user request for userId: ${req.params["userId"]}, statusPageScimId: ${req.params["statusPageScimId"]}`,
      );
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      const statusPageId: ObjectID = bearerData["statusPageId"] as ObjectID;
      const userId: string = req.params["userId"]!;

      executionSteps.push("Authenticated and extracted status page context");
      executionSteps.push(`Target user ID: ${userId}`);

      logger.debug(
        `Status Page SCIM Get user - statusPageId: ${statusPageId}, userId: ${userId}`,
      );

      if (!userId) {
        executionSteps.push("Error: User ID is missing from request");
        throw new BadRequestException("User ID is required");
      }

      // Check if user exists and belongs to this status page
      executionSteps.push("Querying database for user");
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
        executionSteps.push(`User not found with ID: ${userId}`);
        logger.debug(
          `Status Page SCIM Get user - user not found for userId: ${userId}`,
        );
        throw new NotFoundException(
          "User not found or not part of this status page",
        );
      }

      executionSteps.push(`User found: ${statusPageUser.email?.toString()}`);

      const user: JSONObject = formatUserForSCIM(
        statusPageUser,
        req,
        req.params["statusPageScimId"]!,
        "status-page",
      );
      executionSteps.push("Formatted user for SCIM response");

      logger.debug(
        `Status Page SCIM Get user - returning user with id: ${statusPageUser.id}`,
      );

      // Log the operation
      void createStatusPageSCIMLog({
        projectId: bearerData["projectId"] as ObjectID,
        statusPageId: statusPageId,
        statusPageScimId: new ObjectID(req.params["statusPageScimId"]!),
        operationType: "GetUser",
        status: SCIMLogStatus.Success,
        httpMethod: "GET",
        requestPath: req.path,
        httpStatusCode: 200,
        affectedUserEmail: statusPageUser.email?.toString(),
        responseBody: user,
        steps: executionSteps,
        userInfo: {
          userId: statusPageUser.id?.toString() || null,
          email: statusPageUser.email?.toString() || null,
          createdAt: statusPageUser.createdAt?.toISOString() || null,
          updatedAt: statusPageUser.updatedAt?.toISOString() || null,
        },
      });

      return Response.sendJsonObjectResponse(req, res, user);
    } catch (err) {
      executionSteps.push(`Error occurred: ${(err as Error).message}`);
      // Log the error
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      void createStatusPageSCIMLog({
        projectId: bearerData["projectId"] as ObjectID,
        statusPageId: bearerData["statusPageId"] as ObjectID,
        statusPageScimId: new ObjectID(req.params["statusPageScimId"]!),
        operationType: "GetUser",
        status: SCIMLogStatus.Error,
        statusMessage: (err as Error).message,
        httpMethod: "GET",
        requestPath: req.path,
        httpStatusCode: 404,
        steps: executionSteps,
      });

      logger.error(err);
      return next(err);
    }
  },
);

// Create Status Page User - POST /status-page-scim/v2/Users
router.post(
  "/status-page-scim/v2/:statusPageScimId/Users",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    const executionSteps: string[] = [];
    executionSteps.push("Received SCIM CreateUser request");

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

      executionSteps.push("Authenticated and extracted status page context");

      if (!scimConfig.autoProvisionUsers) {
        executionSteps.push(
          "Error: Auto-provisioning is disabled for this status page",
        );
        throw new BadRequestException(
          "Auto-provisioning is disabled for this status page",
        );
      }
      executionSteps.push(
        "Auto-provisioning is enabled, proceeding with user creation",
      );

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

      executionSteps.push(
        `Extracted email from SCIM payload: ${email || "not found"}`,
      );

      if (!email) {
        executionSteps.push(
          "Error: Email is required but not found in request",
        );
        throw new BadRequestException("Email is required for user creation");
      }

      logger.debug(`Status Page SCIM Create user - email: ${email}`);

      // Check if user already exists for this status page
      executionSteps.push(
        "Checking if user already exists on this status page",
      );
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

      let isNewUser: boolean = false;
      if (!user) {
        isNewUser = true;
        executionSteps.push(
          "User does not exist, creating new status page private user",
        );
        logger.debug(
          `Status Page SCIM Create user - creating new user with email: ${email}`,
        );

        const privateUser: StatusPagePrivateUser = new StatusPagePrivateUser();
        privateUser.statusPageId = statusPageId;
        privateUser.email = new Email(email);
        privateUser.password = new HashedString(Text.generateRandomText(32));
        privateUser.projectId = bearerData["projectId"] as ObjectID;

        executionSteps.push("Generated random password for new user");

        // Create new status page private user
        user = await StatusPagePrivateUserService.create({
          data: privateUser as any,
          props: { isRoot: true },
        });
        executionSteps.push(
          `User created successfully with ID: ${user.id?.toString()}`,
        );
      } else {
        executionSteps.push(
          `User already exists with ID: ${user.id?.toString()}, returning existing user`,
        );
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
      executionSteps.push("Formatted user for SCIM response");

      logger.debug(
        `Status Page SCIM Create user - returning created user with id: ${user.id}`,
      );

      // Log the operation
      void createStatusPageSCIMLog({
        projectId: bearerData["projectId"] as ObjectID,
        statusPageId: statusPageId,
        statusPageScimId: new ObjectID(req.params["statusPageScimId"]!),
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
          userId: user.id?.toString() || null,
          email: user.email?.toString() || null,
          createdAt: user.createdAt?.toISOString() || null,
        },
        additionalContext: {
          isNewUser: isNewUser,
          userAlreadyExisted: !isNewUser,
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
      void createStatusPageSCIMLog({
        projectId: bearerData["projectId"] as ObjectID,
        statusPageId: bearerData["statusPageId"] as ObjectID,
        statusPageScimId: new ObjectID(req.params["statusPageScimId"]!),
        operationType: "CreateUser",
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

const handleStatusPageUserUpdate: (
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
      `Status Page SCIM Update user request for userId: ${req.params["userId"]}, statusPageScimId: ${req.params["statusPageScimId"]}`,
    );
    const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
    const bearerData: JSONObject =
      oneuptimeRequest.bearerTokenData as JSONObject;
    const statusPageId: ObjectID = bearerData["statusPageId"] as ObjectID;
    const userId: string = req.params["userId"]!;
    const scimUser: JSONObject = req.body;

    executionSteps.push("Authenticated and extracted status page context");
    executionSteps.push(`Target user ID: ${userId}`);

    logger.debug(
      `Status Page SCIM Update user - statusPageId: ${statusPageId}, userId: ${userId}`,
    );

    logger.debug(
      `Request body for Status Page SCIM Update user: ${JSON.stringify(scimUser, null, 2)}`,
    );

    if (!userId) {
      executionSteps.push("Error: User ID is missing from request");
      throw new BadRequestException("User ID is required");
    }

    // Check if user exists and belongs to this status page
    executionSteps.push("Querying database for existing user");
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
      executionSteps.push(`User not found with ID: ${userId}`);
      logger.debug(
        `Status Page SCIM Update user - user not found for userId: ${userId}`,
      );
      throw new NotFoundException(
        "User not found or not part of this status page",
      );
    }

    const previousEmail: string | undefined = statusPageUser.email?.toString();
    executionSteps.push(`User found: ${previousEmail}`);

    // Update user information
    const email: string =
      (scimUser["userName"] as string) ||
      ((scimUser["emails"] as JSONObject[])?.[0]?.["value"] as string);
    const active: boolean = scimUser["active"] as boolean;

    executionSteps.push(
      `Parsed update data - email: ${email || "not provided"}, active: ${active !== undefined ? active : "not provided"}`,
    );

    logger.debug(
      `Status Page SCIM Update user - email: ${email}, active: ${active}`,
    );

    // Handle user deactivation by deleting from status page
    if (active === false) {
      executionSteps.push("User marked as inactive (active=false)");
      logger.debug(
        `Status Page SCIM Update user - user marked as inactive, removing from status page`,
      );

      const scimConfig: StatusPageSCIM = bearerData[
        "scimConfig"
      ] as StatusPageSCIM;
      if (scimConfig.autoDeprovisionUsers) {
        executionSteps.push(
          "Auto-deprovisioning is enabled, deleting user from status page",
        );
        await StatusPagePrivateUserService.deleteOneById({
          id: new ObjectID(userId),
          props: { isRoot: true },
        });

        executionSteps.push("User deleted successfully from status page");
        logger.debug(
          `Status Page SCIM Update user - user removed from status page`,
        );

        // Log the operation
        void createStatusPageSCIMLog({
          projectId: bearerData["projectId"] as ObjectID,
          statusPageId: statusPageId,
          statusPageScimId: new ObjectID(req.params["statusPageScimId"]!),
          operationType: "UpdateUser",
          status: SCIMLogStatus.Success,
          statusMessage: "User deactivated and removed from status page",
          httpMethod: req.method,
          requestPath: req.path,
          httpStatusCode: 200,
          affectedUserEmail: previousEmail,
          requestBody: scimUser,
          steps: executionSteps,
          userInfo: {
            userId: userId,
            email: previousEmail || null,
            wasDeactivated: true,
          },
          additionalContext: {
            action: "deactivation",
            userRemoved: true,
          },
        });

        // Return empty response for deleted user
        return Response.sendJsonObjectResponse(req, res, {});
      }
      executionSteps.push(
        "Auto-deprovisioning is disabled, user will not be deleted",
      );
    }

    // Prepare update data
    const updateData: {
      email?: Email;
    } = {};

    let emailUpdated: boolean = false;
    if (email && email !== statusPageUser.email?.toString()) {
      updateData.email = new Email(email);
      emailUpdated = true;
      executionSteps.push(
        `Email will be updated: ${previousEmail} -> ${email}`,
      );
    } else {
      executionSteps.push("No email change detected");
    }

    // Only update if there are changes
    if (Object.keys(updateData).length > 0) {
      executionSteps.push("Updating user in database");
      logger.debug(
        `Status Page SCIM Update user - updating user with data: ${JSON.stringify(updateData)}`,
      );

      await StatusPagePrivateUserService.updateOneById({
        id: new ObjectID(userId),
        data: updateData,
        props: { isRoot: true },
      });

      executionSteps.push("User updated successfully in database");
      logger.debug(`Status Page SCIM Update user - user updated successfully`);

      // Fetch updated user
      executionSteps.push("Fetching updated user from database");
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
        executionSteps.push("Updated user retrieved successfully");
        const user: JSONObject = formatUserForSCIM(
          updatedUser,
          req,
          req.params["statusPageScimId"]!,
          "status-page",
        );
        executionSteps.push("Formatted user for SCIM response");

        // Log the operation
        void createStatusPageSCIMLog({
          projectId: bearerData["projectId"] as ObjectID,
          statusPageId: statusPageId,
          statusPageScimId: new ObjectID(req.params["statusPageScimId"]!),
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
            userId: updatedUser.id?.toString() || null,
            email: updatedUser.email?.toString() || null,
            previousEmail: previousEmail || null,
            updatedAt: updatedUser.updatedAt?.toISOString() || null,
          },
          additionalContext: {
            emailUpdated: emailUpdated,
            fieldsUpdated: Object.keys(updateData),
          },
        });

        return Response.sendJsonObjectResponse(req, res, user);
      }
    }

    executionSteps.push("No changes detected, returning existing user");
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
    executionSteps.push("Formatted existing user for SCIM response");

    // Log the operation
    void createStatusPageSCIMLog({
      projectId: bearerData["projectId"] as ObjectID,
      statusPageId: statusPageId,
      statusPageScimId: new ObjectID(req.params["statusPageScimId"]!),
      operationType: "UpdateUser",
      status: SCIMLogStatus.Success,
      httpMethod: req.method,
      requestPath: req.path,
      httpStatusCode: 200,
      affectedUserEmail: statusPageUser.email?.toString(),
      requestBody: scimUser,
      responseBody: user,
      steps: executionSteps,
      userInfo: {
        userId: statusPageUser.id?.toString() || null,
        email: statusPageUser.email?.toString() || null,
      },
      additionalContext: {
        noChangesDetected: true,
      },
    });

    return Response.sendJsonObjectResponse(req, res, user);
  } catch (err) {
    executionSteps.push(`Error occurred: ${(err as Error).message}`);
    // Log the error
    const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
    const bearerData: JSONObject =
      oneuptimeRequest.bearerTokenData as JSONObject;
    void createStatusPageSCIMLog({
      projectId: bearerData["projectId"] as ObjectID,
      statusPageId: bearerData["statusPageId"] as ObjectID,
      statusPageScimId: new ObjectID(req.params["statusPageScimId"]!),
      operationType: "UpdateUser",
      status: SCIMLogStatus.Error,
      statusMessage: (err as Error).message,
      httpMethod: req.method,
      requestPath: req.path,
      httpStatusCode: 400,
      requestBody: req.body,
      steps: executionSteps,
    });

    logger.error(err);
    return next(err);
  }
};

// Update Status Page User - PUT /status-page-scim/v2/Users/{id}
router.put(
  "/status-page-scim/v2/:statusPageScimId/Users/:userId",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  handleStatusPageUserUpdate,
);

// Update Status Page User - PATCH /status-page-scim/v2/Users/{id}
router.patch(
  "/status-page-scim/v2/:statusPageScimId/Users/:userId",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  handleStatusPageUserUpdate,
);

// Delete Status Page User - DELETE /status-page-scim/v2/Users/{id}
router.delete(
  "/status-page-scim/v2/:statusPageScimId/Users/:userId",
  SCIMMiddleware.isAuthorizedSCIMRequest,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    const executionSteps: string[] = [];
    executionSteps.push("Received SCIM DeleteUser request");

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

      executionSteps.push("Authenticated and extracted status page context");
      executionSteps.push(`Target user ID: ${userId}`);

      if (!scimConfig.autoDeprovisionUsers) {
        executionSteps.push(
          "Error: Auto-deprovisioning is disabled for this status page",
        );
        throw new BadRequestException(
          "Auto-deprovisioning is disabled for this status page",
        );
      }
      executionSteps.push(
        "Auto-deprovisioning is enabled, proceeding with user deletion",
      );

      logger.debug(
        `Status Page SCIM Delete user - statusPageId: ${statusPageId}, userId: ${userId}`,
      );

      if (!userId) {
        executionSteps.push("Error: User ID is missing from request");
        throw new BadRequestException("User ID is required");
      }

      // Check if user exists and belongs to this status page
      executionSteps.push("Querying database to verify user exists");
      const statusPageUser: StatusPagePrivateUser | null =
        await StatusPagePrivateUserService.findOneBy({
          query: {
            statusPageId: statusPageId,
            _id: new ObjectID(userId),
          },
          select: {
            _id: true,
            email: true,
          },
          props: { isRoot: true },
        });

      if (!statusPageUser) {
        executionSteps.push(`User not found with ID: ${userId}`);
        logger.debug(
          `Status Page SCIM Delete user - user not found for userId: ${userId}`,
        );
        // SCIM spec says to return 404 for non-existent resources
        throw new NotFoundException("User not found");
      }

      const userEmail: string | undefined = statusPageUser.email?.toString();
      executionSteps.push(`User found: ${userEmail}`);

      // Delete the user from status page
      executionSteps.push("Deleting user from status page");
      await StatusPagePrivateUserService.deleteOneById({
        id: new ObjectID(userId),
        props: { isRoot: true },
      });

      executionSteps.push("User deleted successfully");
      logger.debug(
        `Status Page SCIM Delete user - user deleted successfully for userId: ${userId}`,
      );

      // Log the operation
      void createStatusPageSCIMLog({
        projectId: bearerData["projectId"] as ObjectID,
        statusPageId: statusPageId,
        statusPageScimId: new ObjectID(req.params["statusPageScimId"]!),
        operationType: "DeleteUser",
        status: SCIMLogStatus.Success,
        httpMethod: "DELETE",
        requestPath: req.path,
        httpStatusCode: 204,
        affectedUserEmail: userEmail,
        steps: executionSteps,
        userInfo: {
          userId: userId,
          email: userEmail || null,
          wasDeleted: true,
        },
        additionalContext: {
          action: "deletion",
          userRemoved: true,
        },
      });

      // Return 204 No Content for successful deletion
      res.status(204);
      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      executionSteps.push(`Error occurred: ${(err as Error).message}`);
      // Log the error
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
      const bearerData: JSONObject =
        oneuptimeRequest.bearerTokenData as JSONObject;
      void createStatusPageSCIMLog({
        projectId: bearerData["projectId"] as ObjectID,
        statusPageId: bearerData["statusPageId"] as ObjectID,
        statusPageScimId: new ObjectID(req.params["statusPageScimId"]!),
        operationType: "DeleteUser",
        status: SCIMLogStatus.Error,
        statusMessage: (err as Error).message,
        httpMethod: "DELETE",
        requestPath: req.path,
        httpStatusCode: 400,
        steps: executionSteps,
      });

      logger.error(err);
      return next(err);
    }
  },
);

export default router;
