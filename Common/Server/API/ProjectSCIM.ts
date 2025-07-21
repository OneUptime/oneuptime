import ProjectScimService, {
  Service as ProjectScimServiceType,
} from "../Services/ProjectScimService";
import { ExpressRequest, ExpressResponse } from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import ProjectSCIM from "../../Models/DatabaseModels/ProjectScim";
import SCIMUtil from "../../../App/FeatureSet/Identity/Utils/SCIM";
import URL from "../../Types/API/URL";
import BadRequestException from "../../Types/Exception/BadRequestException";
import Exception from "../../Types/Exception/Exception";
import UserService from "../Services/UserService";
import TeamMemberService from "../Services/TeamMemberService";
import User from "../../Models/DatabaseModels/User";
import Team from "../../Models/DatabaseModels/Team";
import Select from "../Types/Database/Select";
import Email from "../../Types/Email";
import Name from "../../Types/Name";
import logger from "../Utils/Logger";

export default class ProjectScimAPI extends BaseAPI<
  ProjectSCIM,
  ProjectScimServiceType
> {
  public constructor() {
    super(ProjectSCIM, ProjectScimService);

    // SCIM Fetch API
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/:projectId/scim-list`,
      async (req: ExpressRequest, res: ExpressResponse) => {
        const projectId: ObjectID = new ObjectID(
          req.params["projectId"] as string,
        );

        if (!projectId) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Invalid project id."),
          );
        }

        const scim: Array<ProjectSCIM> = await this.service.findBy({
          query: {
            projectId: projectId,
            isEnabled: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            name: true,
            description: true,
            _id: true,
          },
          props: {
            isRoot: true,
          },
        });

        return Response.sendEntityArrayResponse(
          req,
          res,
          scim,
          new PositiveNumber(scim.length),
          ProjectSCIM,
        );
      },
    );

    // Test SCIM connection
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/test-connection`,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
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
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/:projectScimId/sync-users`,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const projectScimId: ObjectID = new ObjectID(req.params["projectScimId"] as string);
          
          const projectScim: ProjectSCIM | null = await this.service.findOneBy({
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

              const primaryEmail = scimUser.emails?.[0];
              if (!primaryEmail) {
                syncResults.errors.push(`User ${scimUser.userName} has no email address`);
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
                // Update existing user if displayName is provided
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

                  // Add user to configured teams if any
                  if (projectScim.teams && projectScim.teams.length > 0) {
                    for (const team of projectScim.teams) {
                      try {
                        // Create a new TeamMember instance
                        const newTeamMember = new (await import("../../Models/DatabaseModels/TeamMember")).default();
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

          return Response.sendJsonObjectResponse(req, res, syncResults);
        } catch (err) {
          return Response.sendErrorResponse(req, res, err as Exception);
        }
      },
    );

    // Provision user to SCIM provider
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/:projectScimId/provision-user`,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const projectScimId: ObjectID = new ObjectID(req.params["projectScimId"] as string);
          const userId: ObjectID = new ObjectID(req.body["userId"]);
          
          const projectScim: ProjectSCIM | null = await this.service.findOneBy({
            query: {
              _id: projectScimId,
            },
            select: {
              _id: true,
              scimBaseUrl: true,
              bearerToken: true,
              autoProvisionUsers: true,
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

          if (!projectScim.autoProvisionUsers) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadRequestException("Auto provisioning is disabled"),
            );
          }

          if (!projectScim.scimBaseUrl || !projectScim.bearerToken) {
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
            projectScim.scimBaseUrl,
            projectScim.bearerToken,
            user.email?.toString() || "",
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
            projectScim.scimBaseUrl,
            projectScim.bearerToken,
            scimUser,
          );

          return Response.sendJsonObjectResponse(req, res, {
            scimUserId: createdScimUser.id,
            success: true,
          });
        } catch (err) {
          return Response.sendErrorResponse(req, res, err as Exception);
        }
      },
    );

    // Deprovision user from SCIM provider
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/:projectScimId/deprovision-user`,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const projectScimId: ObjectID = new ObjectID(req.params["projectScimId"] as string);
          const userId: ObjectID = new ObjectID(req.body["userId"]);
          
          const projectScim: ProjectSCIM | null = await this.service.findOneBy({
            query: {
              _id: projectScimId,
            },
            select: {
              _id: true,
              scimBaseUrl: true,
              bearerToken: true,
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
              new BadRequestException("Auto deprovisioning is disabled"),
            );
          }

          if (!projectScim.scimBaseUrl || !projectScim.bearerToken) {
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
            projectScim.scimBaseUrl,
            projectScim.bearerToken,
            user.email?.toString() || "",
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
              projectScim.scimBaseUrl,
              projectScim.bearerToken,
              scimUser.id!,
            );
          } else {
            await SCIMUtil.deactivateUser(
              projectScim.scimBaseUrl,
              projectScim.bearerToken,
              scimUser.id!,
            );
          }

          return Response.sendJsonObjectResponse(req, res, {
            success: true,
            action: req.body["deleteUser"] ? "deleted" : "deactivated",
          });
        } catch (err) {
          return Response.sendErrorResponse(req, res, err as Exception);
        }
      },
    );
  }
}
