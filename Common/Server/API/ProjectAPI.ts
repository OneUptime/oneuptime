import { IsBillingEnabled } from "../EnvironmentConfig";
import UserMiddleware from "../Middleware/UserAuthorization";
import ProjectService, {
  ProjectService as ProjectServiceType,
} from "../Services/ProjectService";
import ResellerService from "../Services/ResellerService";
import TeamMemberService from "../Services/TeamMemberService";
import Select from "../Types/Database/Select";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import BillingService from "../Services/BillingService";
import Errors from "../Utils/Errors";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import NotAuthenticatedException from "../../Types/Exception/NotAuthenticatedException";
import PositiveNumber from "../../Types/PositiveNumber";
import Project from "../../Models/DatabaseModels/Project";
import Reseller from "../../Models/DatabaseModels/Reseller";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import BadDataException from "../../Types/Exception/BadDataException";
import Permission, { UserPermission } from "../../Types/Permission";
import ObjectID from "../../Types/ObjectID";
import { JSONObject } from "../../Types/JSON";

export default class ProjectAPI extends BaseAPI<Project, ProjectServiceType> {
  public constructor() {
    super(Project, ProjectService);

    this.router.put(
      `${new this.entityType().getCrudApiPath()?.toString()}/:id/change-plan`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          if (!IsBillingEnabled) {
            throw new BadDataException(
              "Billing is not enabled for this server",
            );
          }

          const projectId: ObjectID = new ObjectID(req.params["id"] as string);

          

          const body: JSONObject = (req.body as JSONObject) || {};
          const data: JSONObject = (body["data"] as JSONObject) || {};
          const paymentProviderPlanId: string | undefined = data[
            "paymentProviderPlanId"
          ] as string | undefined;

          if (!paymentProviderPlanId) {
            throw new BadDataException("Plan ID is required to change plan");
          }


          // Check for payment methods early before making any Stripe API calls
          const project: Project | null = await ProjectService.findOneById({
            id: projectId,
            select: {
              paymentProviderCustomerId: true,
            },
            props: {
              isRoot: true,
            },
          });

          if (!project) {
            throw new BadDataException("Project not found");
          }

          if (!project.paymentProviderCustomerId) {
            throw new BadDataException("Payment Provider customer not found");
          }

          const hasPaymentMethods: boolean =
            await BillingService.hasPaymentMethods(
              project.paymentProviderCustomerId,
            );

          if (!hasPaymentMethods) {
            throw new BadDataException(Errors.BillingService.NO_PAYMENTS_METHODS);
          }

          const permissions: Array<UserPermission> =
            await this.getPermissionsForTenant(req);

          const hasBillingPermission: boolean =
            permissions.filter((permission: UserPermission) => {
              return (
                permission.permission.toString() ===
                  Permission.ProjectOwner.toString() ||
                permission.permission.toString() ===
                  Permission.ManageProjectBilling.toString()
              );
            }).length > 0;

          if (
            !hasBillingPermission &&
            !(req as OneUptimeRequest).userAuthorization?.isMasterAdmin
          ) {
            throw new BadDataException(
              `You need ${Permission.ProjectOwner} or ${Permission.ManageProjectBilling} permission to change project plan`,
            );
          }


          await ProjectService.changePlan({
            projectId: projectId,
            paymentProviderPlanId: paymentProviderPlanId,
          });

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * This API lists all the projects where user is its team member.
     * This API is usually used to show project selector dropdown in the UI
     */
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/list-user-projects`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          if (!(req as OneUptimeRequest).userAuthorization?.userId) {
            throw new NotAuthenticatedException(
              "User should be logged in to access this API",
            );
          }

          const projectSelect: Select<Project> = {
            _id: true,
            name: true,
            trialEndsAt: true,
            paymentProviderPlanId: true,
            resellerId: true,
            isFeatureFlagMonitorGroupsEnabled: true,
            paymentProviderMeteredSubscriptionStatus: true,
            paymentProviderSubscriptionStatus: true,
          };

          const teamMembers: Array<TeamMember> = await TeamMemberService.findBy(
            {
              query: {
                userId: (req as OneUptimeRequest).userAuthorization!.userId!,
                hasAcceptedInvitation: true,
              },
              select: {
                project: projectSelect,
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              props: {
                isRoot: true,
              },
            },
          );

          const projects: Array<Project> = [];

          // if billing enabled and is master admin then get all the projects with customer support enabled.

          if (
            IsBillingEnabled &&
            (req as OneUptimeRequest).userAuthorization?.isMasterAdmin
          ) {
            const customerSupportProjects: Array<Project> =
              await ProjectService.findBy({
                query: {
                  letCustomerSupportAccessProject: true,
                },
                select: projectSelect,
                limit: LIMIT_PER_PROJECT,
                skip: 0,
                props: {
                  isRoot: true,
                },
              });

            for (const customerSupportProject of customerSupportProjects) {
              if (!customerSupportProject) {
                continue;
              }

              if (!customerSupportProject._id) {
                continue;
              }

              if (
                projects.findIndex((project: Project) => {
                  return (
                    project._id?.toString() ===
                    customerSupportProject!._id?.toString()
                  );
                }) === -1
              ) {
                projects.push(customerSupportProject);
              }
            }
          }

          for (const teamMember of teamMembers) {
            if (!teamMember.project) {
              continue;
            }

            if (
              projects.findIndex((project: Project) => {
                return (
                  project._id?.toString() ===
                  teamMember.project!._id?.toString()
                );
              }) === -1
            ) {
              projects.push(teamMember.project!);
            }
          }

          // get reseller for each project.
          for (const project of projects) {
            if (project.resellerId) {
              const reseller: Reseller | null =
                await ResellerService.findOneById({
                  id: project.resellerId,
                  select: {
                    enableTelemetryFeatures: true,
                  },
                  props: {
                    isRoot: true,
                  },
                });

              if (!reseller) {
                continue;
              }

              project.reseller = reseller;
            }
          }

          return Response.sendEntityArrayResponse(
            req,
            res,
            projects,
            new PositiveNumber(projects.length),
            Project,
          );
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
