import { IsBillingEnabled } from "../EnvironmentConfig";
import UserMiddleware from "../Middleware/UserAuthorization";
import ProjectService, {
  Service as ProjectServiceType,
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
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";
import PositiveNumber from "Common/Types/PositiveNumber";
import Project from "Common/AppModels/Models/Project";
import Reseller from "Common/AppModels/Models/Reseller";
import TeamMember from "Common/AppModels/Models/TeamMember";

export default class ProjectAPI extends BaseAPI<Project, ProjectServiceType> {
  public constructor() {
    super(Project, ProjectService);

    /// This API lists all the projects where user is its team member.
    /// This API is usually used to show project selector dropdown in the UI
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
