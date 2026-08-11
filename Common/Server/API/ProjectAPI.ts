import { IsBillingEnabled } from "../EnvironmentConfig";
import MasterAdminAuthorization from "../Middleware/MasterAdminAuthorization";
import UserMiddleware from "../Middleware/UserAuthorization";
import ProjectService, {
  ProjectService as ProjectServiceType,
} from "../Services/ProjectService";
import ResellerService from "../Services/ResellerService";
import TeamMemberService from "../Services/TeamMemberService";
import QueryHelper from "../Types/Database/QueryHelper";
import Select from "../Types/Database/Select";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import JSONWebToken from "../Utils/JsonWebToken";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import BillingService from "../Services/BillingService";
import Errors from "../Utils/Errors";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import NotAuthenticatedException from "../../Types/Exception/NotAuthenticatedException";
import PositiveNumber from "../../Types/PositiveNumber";
import Project from "../../Models/DatabaseModels/Project";
import Reseller from "../../Models/DatabaseModels/Reseller";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import BadDataException from "../../Types/Exception/BadDataException";
import OneUptimeDate from "../../Types/Date";
import Permission, { UserPermission } from "../../Types/Permission";
import ObjectID from "../../Types/ObjectID";
import { JSONObject, JSONValue } from "../../Types/JSON";

/*
 * The reason is free text a customer types into the delete confirmation. The
 * column is unbounded text, so the cap is here.
 */
export const MAX_DELETION_REASON_LENGTH: number = 5000;

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

          /*
           * The permission check below is bound to the authenticated tenant
           * (resolved from the tenantid header), so the project being
           * mutated must be that same tenant — otherwise permissions on one
           * project would authorize changing the plan (and charging the
           * payment method) of another.
           */
          const tenantId: ObjectID | null = this.getTenantId(req);

          if (!tenantId || tenantId.toString() !== projectId.toString()) {
            throw new BadDataException(
              "Project ID in the URL does not match the project the request is authenticated for",
            );
          }

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
            throw new BadDataException(
              Errors.BillingService.NO_PAYMENTS_METHODS,
            );
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
     * Deletes a project, carrying the reason the customer gave for deleting it.
     * The plain DELETE /project/:id route still works and still records the
     * deletion - this one exists only because a DELETE has nowhere to put the
     * answer to "why are you deleting this project?".
     *
     * The delete itself goes through deleteOneById with the caller's own props,
     * so ModelPermission enforces ProjectOwner / DeleteProject exactly as it
     * does on the plain route.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/:id/delete-project`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const idParam: string = req.params["id"] as string;
          ObjectID.validateUUID(idParam);
          const projectId: ObjectID = new ObjectID(idParam);

          /*
           * Same guard as change-plan: permissions are resolved for the
           * authenticated tenant, so the project in the URL has to be that
           * tenant or permissions on one project would authorize deleting
           * another.
           */
          const tenantId: ObjectID | null = this.getTenantId(req);

          if (!tenantId || tenantId.toString() !== projectId.toString()) {
            throw new BadDataException(
              "Project ID in the URL does not match the project the request is authenticated for",
            );
          }

          const body: JSONObject = (req.body as JSONObject) || {};
          const data: JSONObject = (body["data"] as JSONObject) || {};
          const deletionReasonValue: JSONValue = data["deletionReason"];

          let deletionReason: string | undefined = undefined;

          if (typeof deletionReasonValue === "string") {
            /*
             * Free text from a form field. Bound what a client can store, and
             * drop NUL bytes: Postgres rejects them in a text column, and the
             * write that fails here is the audit record of a project that has
             * already been deleted - there is no second chance at it.
             */
            const cleaned: string = deletionReasonValue
              // eslint-disable-next-line no-control-regex
              .replace(/\u0000/g, "")
              .trim()
              .substring(0, MAX_DELETION_REASON_LENGTH);

            if (cleaned) {
              deletionReason = cleaned;
            }
          }

          await ProjectService.deleteOneById({
            id: projectId,
            deletionReason: deletionReason,
            props: await CommonAPI.getDatabaseCommonInteractionProps(req),
          });

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Extends a project's trial. Master-admin only: this hands out free
     * service and moves the customer's next invoice, so it is deliberately not
     * reachable with project-level billing permissions - only OneUptime staff
     * acting from the Admin Dashboard can call it.
     */
    this.router.put(
      `${new this.entityType().getCrudApiPath()?.toString()}/:id/extend-trial`,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
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
          const trialEndsAtValue: JSONValue = data["trialEndsAt"];

          if (!trialEndsAtValue) {
            throw new BadDataException(
              "Trial end date is required to extend the trial",
            );
          }

          /*
           * OneUptimeDate.fromString only parses strings and Dates - anything
           * else comes back as its own error text, not a Date - so reject a
           * non-string body value here rather than letting it through.
           */
          if (typeof trialEndsAtValue !== "string") {
            throw new BadDataException("Trial end date is not a valid date");
          }

          const trialEndsAt: Date = OneUptimeDate.fromString(trialEndsAtValue);

          if (isNaN(trialEndsAt.getTime())) {
            throw new BadDataException("Trial end date is not a valid date");
          }

          /*
           * The master admin middleware verifies the token but does not put
           * the decoded payload on the request, so read it again here - who
           * granted the extension is the only audit trail this action has.
           */
          let extendedByUserId: ObjectID | undefined = undefined;

          try {
            const accessToken: string | undefined =
              UserMiddleware.getAccessTokenFromExpressRequest(req);

            if (accessToken) {
              extendedByUserId = JSONWebToken.decode(accessToken).userId;
            }
          } catch {
            // Only used for the log line - never block the extension on it.
          }

          await ProjectService.extendTrial({
            projectId: projectId,
            trialEndsAt: trialEndsAt,
            extendedByUserId: extendedByUserId,
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

          /*
           * Batch-fetch resellers for every project in one query instead of
           * one findOneById per project.
           */
          const resellerIds: Array<ObjectID> = [];
          const seenResellerIds: Set<string> = new Set<string>();
          for (const project of projects) {
            if (
              project.resellerId &&
              !seenResellerIds.has(project.resellerId.toString())
            ) {
              seenResellerIds.add(project.resellerId.toString());
              resellerIds.push(project.resellerId);
            }
          }

          if (resellerIds.length > 0) {
            const resellers: Array<Reseller> = await ResellerService.findBy({
              query: {
                _id: QueryHelper.any(
                  resellerIds.map((id: ObjectID) => {
                    return id.toString();
                  }),
                ),
              },
              select: {
                _id: true,
                enableTelemetryFeatures: true,
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              props: {
                isRoot: true,
              },
            });

            const resellersById: Map<string, Reseller> = new Map<
              string,
              Reseller
            >();
            for (const reseller of resellers) {
              if (reseller._id) {
                resellersById.set(reseller._id.toString(), reseller);
              }
            }

            for (const project of projects) {
              if (project.resellerId) {
                const reseller: Reseller | undefined = resellersById.get(
                  project.resellerId.toString(),
                );
                if (reseller) {
                  project.reseller = reseller;
                }
              }
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
