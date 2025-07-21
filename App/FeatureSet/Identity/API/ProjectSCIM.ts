import SCIMUtil from "../Utils/SCIM";
import { DashboardRoute } from "Common/ServiceRoute";
import URL from "Common/Types/API/URL";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import Exception from "Common/Types/Exception/Exception";
import ServerException from "Common/Types/Exception/ServerException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PermissionUtil from "Common/Server/Utils/Permission";
import ProjectScimService from "Common/Server/Services/ProjectScimService";
import TeamService from "Common/Server/Services/TeamService";
import UserService from "Common/Server/Services/UserService";
import Select from "Common/Server/Types/Database/Select";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import BaseAPI from "Common/Server/API/BaseAPI";
import CommonAPI from "Common/Server/API/CommonAPI";
import CreateBy from "Common/Server/Types/Database/CreateBy";
import DatabaseService from "Common/Server/Services/DatabaseService";
import JSONAPI from "Common/Server/API/JSONAPI";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectScim from "Common/Models/DatabaseModels/ProjectScim";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import { PermissionHelper } from "Common/Server/Helpers/PermissionHelper";
import Permission, { 
  UserPermission, 
  UserTenantAccessPermission 
} from "Common/Types/Permission";
import Email from "Common/Types/Email";

const router: ExpressRouter = Express.getRouter();

// Test SCIM connection
router.post(
  "/test-connection",
  PermissionUtil.getMiddleware(UserPermission.ProjectOwner),
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      const projectId: ObjectID = req.params["projectId"]
        ? new ObjectID(req.params["projectId"])
        : req.body["projectId"];

      if (!projectId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Project ID is required"),
        );
      }

      const scimBaseUrl: string = req.body["scimBaseUrl"];
      const bearerToken: string = req.body["bearerToken"];

      if (!scimBaseUrl || !bearerToken) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("SCIM Base URL and Bearer Token are required"),
        );
      }

      const isConnected: boolean = await SCIMUtil.testConnection(
        new URL(scimBaseUrl),
        bearerToken,
      );

      return Response.sendJSONObjectResponse(req, res, {
        isConnected,
      });
    } catch (err) {
      return Response.sendErrorResponse(req, res, err as Exception);
    }
  },
);

// Sync users from SCIM provider
router.post(
  "/:projectScimId/sync-users",
  PermissionUtil.getMiddleware(UserPermission.ProjectOwner),
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      const projectScimId: ObjectID = new ObjectID(req.params["projectScimId"]);
      
      const projectScim: ProjectScim | null = await ProjectScimService.findOneBy({
        query: {
          _id: projectScimId,
        },
        select: {
          _id: true,
          scimBaseURL: true,
          bearerToken: true,
          projectId: true,
          teams: {
            _id: true,
            name: true,
          } as Select<Team>,
          shouldAutoProvisionUsers: true,
          shouldAutoDeprovisionUsers: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!projectScim) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("SCIM configuration not found"),
        );
      }

      if (!projectScim.scimBaseURL || !projectScim.bearerToken) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("SCIM configuration is incomplete"),
        );
      }

      // Get users from SCIM provider
      const scimUsers = await SCIMUtil.listUsers(
        projectScim.scimBaseURL,
        projectScim.bearerToken,
      );

      const syncResults = {
        totalScimUsers: scimUsers.totalResults,
        processedUsers: 0,
        createdUsers: 0,
        updatedUsers: 0,
        errors: [] as string[],
      };

      // Process each SCIM user
      for (const scimUser of scimUsers.Resources) {
        try {
          syncResults.processedUsers++;

          if (!scimUser.emails || scimUser.emails.length === 0) {
            syncResults.errors.push(`User ${scimUser.userName} has no email address`);
            continue;
          }

          const primaryEmail = scimUser.emails.find(e => e.primary) || scimUser.emails[0];
          const email = new Email(primaryEmail.value);

          // Check if user exists
          let user: User | null = await UserService.findOneBy({
            query: { email },
            select: {
              _id: true,
              name: true,
              email: true,
            },
            props: {
              isRoot: true,
            },
          });

          if (user && projectScim.shouldAutoProvisionUsers) {
            // Update existing user
            const updatedUser = await UserService.updateOneById({
              id: user.id!,
              data: {
                name: scimUser.displayName ? new Name(scimUser.displayName) : user.name,
              },
              props: {
                isRoot: true,
              },
            });
            
            if (updatedUser) {
              syncResults.updatedUsers++;
            }
          } else if (!user && projectScim.shouldAutoProvisionUsers) {
            // Create new user
            const newUser = new User();
            newUser.name = new Name(scimUser.displayName || scimUser.userName);
            newUser.email = email;
            newUser.isEmailVerified = true;
            
            const createdUser = await UserService.create({
              data: newUser,
              props: {
                isRoot: true,
              },
            });

            if (createdUser) {
              syncResults.createdUsers++;

              // Add user to configured teams if any
              if (projectScim.teams && projectScim.teams.length > 0) {
                for (const team of projectScim.teams) {
                  try {
                    await PermissionHelper.addUserToTeam({
                      projectId: projectScim.projectId!,
                      userId: createdUser.id!,
                      teamId: team.id!,
                      props: {
                        isRoot: true,
                      },
                    });
                  } catch (teamErr) {
                    logger.error(`Failed to add user ${email.toString()} to team ${team.name}: ${teamErr}`);
                  }
                }
              }
            }
          }
        } catch (userErr) {
          syncResults.errors.push(`Error processing user ${scimUser.userName}: ${userErr}`);
          logger.error(`SCIM user sync error: ${userErr}`);
        }
      }

      return Response.sendJSONObjectResponse(req, res, syncResults);
    } catch (err) {
      return Response.sendErrorResponse(req, res, err as Exception);
    }
  },
);

// Provision user to SCIM provider
router.post(
  "/:projectScimId/provision-user",
  PermissionUtil.getMiddleware(UserPermission.ProjectOwner),
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      const projectScimId: ObjectID = new ObjectID(req.params["projectScimId"]);
      const userId: ObjectID = new ObjectID(req.body["userId"]);
      
      const projectScim: ProjectScim | null = await ProjectScimService.findOneBy({
        query: {
          _id: projectScimId,
        },
        select: {
          _id: true,
          scimBaseURL: true,
          bearerToken: true,
          shouldAutoProvisionUsers: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!projectScim) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("SCIM configuration not found"),
        );
      }

      if (!projectScim.shouldAutoProvisionUsers) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Auto provisioning is disabled"),
        );
      }

      if (!projectScim.scimBaseURL || !projectScim.bearerToken) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("SCIM configuration is incomplete"),
        );
      }

      const user: User | null = await UserService.findOneById({
        id: userId,
        select: {
          _id: true,
          name: true,
          email: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!user) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("User not found"),
        );
      }

      // Check if user already exists in SCIM provider
      const existingScimUser = await SCIMUtil.getUserByUserName(
        projectScim.scimBaseURL,
        projectScim.bearerToken,
        user.email.toString(),
      );

      if (existingScimUser) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("User already exists in SCIM provider"),
        );
      }

      // Create SCIM user
      const scimUser = SCIMUtil.convertUserToSCIMUser(user);
      const createdScimUser = await SCIMUtil.createUser(
        projectScim.scimBaseURL,
        projectScim.bearerToken,
        scimUser,
      );

      return Response.sendJSONObjectResponse(req, res, {
        scimUserId: createdScimUser.id,
        success: true,
      });
    } catch (err) {
      return Response.sendErrorResponse(req, res, err as Exception);
    }
  },
);

// Deprovision user from SCIM provider
router.post(
  "/:projectScimId/deprovision-user",
  PermissionUtil.getMiddleware(UserPermission.ProjectOwner),
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      const projectScimId: ObjectID = new ObjectID(req.params["projectScimId"]);
      const userId: ObjectID = new ObjectID(req.body["userId"]);
      
      const projectScim: ProjectScim | null = await ProjectScimService.findOneBy({
        query: {
          _id: projectScimId,
        },
        select: {
          _id: true,
          scimBaseURL: true,
          bearerToken: true,
          shouldAutoDeprovisionUsers: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!projectScim) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("SCIM configuration not found"),
        );
      }

      if (!projectScim.shouldAutoDeprovisionUsers) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Auto deprovisioning is disabled"),
        );
      }

      if (!projectScim.scimBaseURL || !projectScim.bearerToken) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("SCIM configuration is incomplete"),
        );
      }

      const user: User | null = await UserService.findOneById({
        id: userId,
        select: {
          _id: true,
          email: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!user) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("User not found"),
        );
      }

      // Find user in SCIM provider
      const scimUser = await SCIMUtil.getUserByUserName(
        projectScim.scimBaseURL,
        projectScim.bearerToken,
        user.email.toString(),
      );

      if (!scimUser) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("User not found in SCIM provider"),
        );
      }

      // Deactivate or delete the user based on preference
      if (req.body["deleteUser"]) {
        await SCIMUtil.deleteUser(
          projectScim.scimBaseURL,
          projectScim.bearerToken,
          scimUser.id!,
        );
      } else {
        await SCIMUtil.deactivateUser(
          projectScim.scimBaseURL,
          projectScim.bearerToken,
          scimUser.id!,
        );
      }

      return Response.sendJSONObjectResponse(req, res, {
        success: true,
        action: req.body["deleteUser"] ? "deleted" : "deactivated",
      });
    } catch (err) {
      return Response.sendErrorResponse(req, res, err as Exception);
    }
  },
);

// Create SCIM API using the common BaseAPI pattern
const ProjectScimAPI: BaseAPI<ProjectScim, typeof ProjectScim> = new BaseAPI(
  ProjectScim,
  {
    ...CommonAPI.defaultProps,
    read: {
      ...CommonAPI.defaultPropsRead,
      query: {
        projectId: new ObjectID(req.params['projectId'])
      }
    },
    create: {
      ...CommonAPI.defaultPropsCreate,
      override: {
        projectId: new ObjectID(req.params['projectId'])
      }
    },
    update: CommonAPI.defaultPropsUpdate,
    delete: CommonAPI.defaultPropsDelete,
  },
);

// Mount the base API routes
router.use("/", ProjectScimAPI.router);

export default router;
