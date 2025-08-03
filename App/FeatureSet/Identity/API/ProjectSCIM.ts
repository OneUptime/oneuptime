import SCIMUtil from "../Utils/SCIM";
import URL from "Common/Types/API/URL";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import Exception from "Common/Types/Exception/Exception";
import ObjectID from "Common/Types/ObjectID";
import ProjectScimService from "Common/Server/Services/ProjectScimService";
import UserService from "Common/Server/Services/UserService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import Select from "Common/Server/Types/Database/Select";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import ProjectScim from "Common/Models/DatabaseModels/ProjectScim";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";

const router: ExpressRouter = Express.getRouter();

// Test SCIM connection
router.post(
  "/test-connection",
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
        URL.fromString(scimBaseUrl),
        bearerToken,
      );

      return Response.sendJsonObjectResponse(req, res, {
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
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      const projectScimId: ObjectID = new ObjectID(req.params["projectScimId"]!);
      
      const projectScim: ProjectScim | null = await ProjectScimService.findOneBy({
        query: {
          _id: projectScimId,
        },
        select: {
          _id: true,
          scimBaseUrl: true,
          bearerToken: true,
          projectId: true,
          teams: {
            _id: true,
            name: true,
          } as Select<Team>,
          autoProvisionUsers: true,
          autoDeprovisionUsers: true,
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

      if (!projectScim.scimBaseUrl || !projectScim.bearerToken) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("SCIM configuration is incomplete"),
        );
      }

      // Get users from SCIM provider
      const scimUsers = await SCIMUtil.listUsers(
        projectScim.scimBaseUrl,
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
          if (!primaryEmail) {
            syncResults.errors.push(`User ${scimUser.userName} has no valid email address`);
            continue;
          }
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

          if (user && projectScim.autoProvisionUsers) {
            // Update existing user - only update if displayName exists
            if (scimUser.displayName) {
              await UserService.updateOneById({
                id: user.id!,
                data: {
                  name: new Name(scimUser.displayName),
                },
                props: {
                  isRoot: true,
                },
              });
            }
            
            syncResults.updatedUsers++;
          } else if (!user && projectScim.autoProvisionUsers) {
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

              // Add user to teams if specified
              if (projectScim.teams && projectScim.teams.length > 0) {
                for (const team of projectScim.teams) {
                  try {
                    // Create a new TeamMember instance
                    const newTeamMember = new TeamMember();
                    newTeamMember.teamId = team.id!;
                    newTeamMember.userId = createdUser.id!;
                    newTeamMember.projectId = projectScim.projectId!;
                    newTeamMember.hasAcceptedInvitation = true;
                    
                    await TeamMemberService.create({
                      data: newTeamMember,
                      props: {
                        isRoot: true,
                      },
                    });
                  } catch (teamError) {
                    logger.error(`Error adding user to team: ${teamError}`);
                  }
                }
              }
            }
          }
        } catch (userError) {
          syncResults.errors.push(`Error processing user ${scimUser.userName}: ${userError}`);
          logger.error(`Error processing SCIM user: ${userError}`);
        }
      }

      return Response.sendJsonObjectResponse(req, res, syncResults);
    } catch (err) {
      return Response.sendErrorResponse(req, res, err as Exception);
    }
  },
);

// Deprovision users from SCIM provider
router.post(
  "/:projectScimId/deprovision-users",
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      const projectScimId: ObjectID = new ObjectID(req.params["projectScimId"]!);
      
      const projectScim: ProjectScim | null = await ProjectScimService.findOneBy({
        query: {
          _id: projectScimId,
        },
        select: {
          _id: true,
          scimBaseUrl: true,
          bearerToken: true,
          projectId: true,
          autoDeprovisionUsers: true,
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

      if (!projectScim.autoDeprovisionUsers) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Auto-deprovisioning is not enabled"),
        );
      }

      if (!projectScim.scimBaseUrl || !projectScim.bearerToken) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("SCIM configuration is incomplete"),
        );
      }

      // Get all users from the project by finding team members
      const teamMembers = await TeamMemberService.findBy({
        query: {
          projectId: projectScim.projectId!,
        },
        select: {
          _id: true,
          user: {
            _id: true,
            email: true,
            name: true,
          } as Select<User>,
        },
        limit: 1000,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      // Extract unique users from team members
      const uniqueUserIds = new Set<string>();
      const projectUsers: User[] = teamMembers
        .map(tm => tm.user!)
        .filter(user => {
          if (user && user.id && !uniqueUserIds.has(user.id.toString())) {
            uniqueUserIds.add(user.id.toString());
            return true;
          }
          return false;
        });

      const deprovisionResults = {
        totalProjectUsers: projectUsers.length,
        processedUsers: 0,
        deprovisionedUsers: 0,
        errors: [] as string[],
      };

      // Process each project user
      for (const user of projectUsers) {
        try {
          deprovisionResults.processedUsers++;

          if (!user.email) {
            deprovisionResults.errors.push(`User ${user.id} has no email address`);
            continue;
          }

          // Check if user exists in SCIM provider
          const scimUser = await SCIMUtil.getUserByUserName(
            projectScim.scimBaseUrl,
            projectScim.bearerToken,
            user.email.toString(),
          );

          if (!scimUser) {
            // User not found in SCIM provider, deprovision from project
            try {
              // Remove user from all teams in this project
              const teamMembers = await TeamMemberService.findBy({
                query: {
                  userId: user.id!,
                  projectId: projectScim.projectId!,
                },
                select: {
                  _id: true,
                },
                limit: 1000,
                skip: 0,
                props: {
                  isRoot: true,
                },
              });

              for (const teamMember of teamMembers) {
                await TeamMemberService.deleteOneById({
                  id: teamMember.id!,
                  props: {
                    isRoot: true,
                  },
                });
              }

              deprovisionResults.deprovisionedUsers++;
              logger.info(`Deprovisioned user ${user.email} from project due to SCIM removal`);
            } catch (deprovisionError) {
              deprovisionResults.errors.push(`Error deprovisioning user ${user.email}: ${deprovisionError}`);
              logger.error(`Error deprovisioning user: ${deprovisionError}`);
            }
          }
        } catch (userError) {
          deprovisionResults.errors.push(`Error processing user ${user.email}: ${userError}`);
          logger.error(`Error processing user for deprovisioning: ${userError}`);
        }
      }

      return Response.sendJsonObjectResponse(req, res, deprovisionResults);
    } catch (err) {
      return Response.sendErrorResponse(req, res, err as Exception);
    }
  },
);

// Deprovision specific user
router.post(
  "/:projectScimId/deprovision-user",
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      const projectScimId: ObjectID = new ObjectID(req.params["projectScimId"]!);
      
      const projectScim: ProjectScim | null = await ProjectScimService.findOneBy({
        query: {
          _id: projectScimId,
        },
        select: {
          _id: true,
          scimBaseUrl: true,
          bearerToken: true,
          projectId: true,
          autoDeprovisionUsers: true,
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

      if (!projectScim.autoDeprovisionUsers) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Auto-deprovisioning is not enabled"),
        );
      }

      if (!projectScim.scimBaseUrl || !projectScim.bearerToken) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("SCIM configuration is incomplete"),
        );
      }

      const userId: ObjectID = new ObjectID(req.body["userId"]);
      
      // Get user details
      const user: User | null = await UserService.findOneBy({
        query: {
          _id: userId,
        },
        select: {
          _id: true,
          email: true,
          name: true,
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

      if (!user.email) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("User has no email address"),
        );
      }

      // Find user in SCIM provider first
      const scimUser = await SCIMUtil.getUserByUserName(
        projectScim.scimBaseUrl,
        projectScim.bearerToken,
        user.email.toString(),
      );

      if (scimUser) {
        // Remove user from SCIM provider (deactivate instead of delete to preserve audit trail)
        await SCIMUtil.deactivateUser(
          projectScim.scimBaseUrl,
          projectScim.bearerToken,
          scimUser.id!,
        );
        logger.info(`Deactivated user ${user.email} in SCIM provider`);
      } else {
        logger.warn(`User ${user.email} not found in SCIM provider, proceeding with local removal only`);
      }

      // Remove user from all teams in this project
      const teamMembers = await TeamMemberService.findBy({
        query: {
          userId: user.id!,
          projectId: projectScim.projectId!,
        },
        select: {
          _id: true,
        },
        limit: 1000,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      for (const teamMember of teamMembers) {
        await TeamMemberService.deleteOneById({
          id: teamMember.id!,
          props: {
            isRoot: true,
          },
        });
      }

      logger.info(`Removed user ${user.email} from ${teamMembers.length} teams in project`);

      return Response.sendJsonObjectResponse(req, res, {
        success: true,
        message: "User deprovisioned successfully",
      });
    } catch (err) {
      return Response.sendErrorResponse(req, res, err as Exception);
    }
  },
);

export default router;
