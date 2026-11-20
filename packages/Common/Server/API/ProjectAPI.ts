import { IsBillingEnabled, getAllEnvVars } from "../EnvironmentConfig";
import SubscriptionPlan from "../../Types/Billing/SubscriptionPlan";
import { isSamePlanChoice } from "../../Types/Billing/SubscriptionPlanPricing";
import MasterAdminAuthorization from "../Middleware/MasterAdminAuthorization";
import UserMiddleware from "../Middleware/UserAuthorization";
import ProjectService, {
  ProjectService as ProjectServiceType,
  ProjectBalanceAdjustmentResult,
} from "../Services/ProjectService";
import BillingInvoiceService, {
  BILLING_DISABLED_NO_INVOICES_MESSAGE,
} from "../Services/BillingInvoiceService";
import {
  AdminProjectInvoice,
  toAdminProjectInvoiceJSON,
} from "../../Types/Billing/AdminProjectInvoice";
import ResellerService from "../Services/ResellerService";
import TeamMemberService from "../Services/TeamMemberService";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import QueryHelper from "../Types/Database/QueryHelper";
import Select from "../Types/Database/Select";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import JSONWebToken from "../Utils/JsonWebToken";
import JsonWebTokenPurpose from "../../Types/JsonWebTokenPurpose";
import Response from "../Utils/Response";
import logger from "../Utils/Logger";
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
import Permission from "../../Types/Permission";
import CallerPermission from "../Utils/Permission/CallerPermission";
import { PROJECT_CHANGE_PLAN_PERMISSIONS } from "../../Utils/Project/ProjectBilling";
import ProjectBalanceType from "../../Types/Billing/ProjectBalanceType";
import BalanceAdjustmentType from "../../Types/Billing/BalanceAdjustmentType";
import ObjectID from "../../Types/ObjectID";
import { JSONArray, JSONObject, JSONValue } from "../../Types/JSON";
import {
  NUMBERED_RECORD_KINDS,
  NumberedRecordKind,
  RecordNumbering,
} from "../../Utils/Project/NextNumber";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import ProjectSignInClearing from "../Utils/ProjectSignInClearing";
import {
  CLEAR_PROJECT_SIGN_IN_OWNERS_ONLY_MESSAGE,
  ClearSavedSignInSettingsAnswer,
  PROJECT_CLEAR_SAVED_SIGN_IN_SETTINGS_ACTION,
  PROJECT_SAVED_SIGN_IN_SETTINGS_ACTION,
  SavedSignInSettingsAnswer,
} from "../../Types/SSO/LocalSignInClearing";
import ResolvedRecordRetention, {
  DueRecordsCount,
} from "../Utils/Retention/ResolvedRecordRetention";
import {
  ResolvedRecordKind,
  ResolvedRecordRetentionServerLimits,
  readKeptPostmortemStatusIds,
} from "../../Types/Retention/ResolvedRecordRetention";
import ResolvedRecordRetentionAnswers, {
  DueRecordsCountRequest,
  RESOLVED_RECORD_RETENTION_COUNT_ROUTE,
  RESOLVED_RECORD_RETENTION_ROUTE,
} from "../../Types/Retention/ResolvedRecordRetentionAnswers";

/*
 * The reason is free text a customer types into the delete confirmation. The
 * column is unbounded text, so the cap is here.
 */
export const MAX_DELETION_REASON_LENGTH: number = 5000;

/*
 * Who may read the server's retention maximum for a project ("read"), and
 * who may count what a change of the kind's retention deletes ("update"):
 * the read and update lists of the project's own retention column, so the
 * Data Retention routes follow the setting they serve.
 */
export function getRetentionPermissions(
  kind: ResolvedRecordKind,
  access: "read" | "update",
): Array<Permission> {
  const column: string =
    kind === ResolvedRecordKind.Incident
      ? "incidentRetentionInDays"
      : "alertRetentionInDays";

  const accessControl:
    | { read?: Array<Permission>; update?: Array<Permission> }
    | undefined = new Project().getColumnAccessControlFor(column) || undefined;

  return (
    (access === "read" ? accessControl?.read : accessControl?.update) || []
  );
}

/*
 * Who may read where a project's numbers stand (GET /project/:id/numbering):
 * those who may read where they start - the read list of the columns that
 * hold it, one list for all five kinds (ProjectNumberingApi.test holds them
 * to it) - so the route tells no one more than the model API would.
 */
export function getNumberingReadPermissions(): Array<Permission> {
  return (
    new Project().getColumnAccessControlFor(
      NUMBERED_RECORD_KINDS[0]!.startsAtColumn,
    )?.read || []
  );
}

/*
 * The master admin a request comes from, for the audit line a master-admin
 * route writes, or undefined when it cannot be read. The master admin
 * middleware checks the session but does not put it on the request, so the
 * token is read again here. Only the log line uses it, so a failure to read
 * it never blocks the action.
 */
function readMasterAdminUserId(req: ExpressRequest): ObjectID | undefined {
  try {
    const accessToken: string | undefined =
      UserMiddleware.getAccessTokenFromExpressRequest(req);

    if (!accessToken) {
      return undefined;
    }

    return JSONWebToken.decode(accessToken, JsonWebTokenPurpose.UserSession)
      .userId;
  } catch {
    return undefined;
  }
}

/*
 * The project a master-admin route acts on, from its address. A master admin
 * reaches any project, so an id that is not one is refused here rather than
 * handed on to a query.
 */
export const ADMIN_PROJECT_ID_NOT_VALID_MESSAGE: string =
  "The project ID in the address is not valid. Open the project from the Projects list, then try again.";

function readProjectIdFromAddress(req: ExpressRequest): ObjectID {
  const idParam: string = String(req.params["id"] || "");

  if (!ObjectID.isValidUUID(idParam)) {
    throw new BadDataException(ADMIN_PROJECT_ID_NOT_VALID_MESSAGE);
  }

  return new ObjectID(idParam);
}

/*
 * A payment provider's invoice id: letters, digits and underscores
 * ("in_1QdX..."). Anything else is refused before it reaches the provider's
 * address for the invoice.
 */
const PAYMENT_PROVIDER_INVOICE_ID: RegExp = /^[A-Za-z0-9_]{1,255}$/;

export const ADMIN_INVOICE_ID_NOT_VALID_MESSAGE: string =
  "This is not an invoice ID. Reload the list, then try again.";

export default class ProjectAPI extends BaseAPI<Project, ProjectServiceType> {
  public constructor() {
    super(Project, ProjectService);

    this.router.put(
      `${new this.entityType().getCrudApiPath()?.toString()}/:id/change-plan`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
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

          const isMasterAdmin: boolean = Boolean(
            (req as OneUptimeRequest).userAuthorization?.isMasterAdmin,
          );

          // Check for payment methods early before making any Stripe API calls
          const project: Project | null = await ProjectService.findOneById({
            id: projectId,
            select: {
              paymentProviderCustomerId: true,
              billingMarketplace: true,
            },
            props: {
              isRoot: true,
            },
          });

          if (!project) {
            throw new BadDataException("Project not found");
          }

          if (project.billingMarketplace) {
            /*
             * A cloud marketplace pays for this project, so no card is
             * needed. A custom-priced plan (Enterprise) is agreed with
             * OneUptime's sales team as a private offer on the marketplace,
             * and set by OneUptime once it is - never picked here.
             */
            if (
              SubscriptionPlan.isCustomPricingPlan(
                paymentProviderPlanId,
                getAllEnvVars(),
              ) &&
              !isMasterAdmin
            ) {
              throw new BadDataException(
                "This plan is arranged with OneUptime's sales team. Please contact sales to move to it.",
              );
            }
          } else {
            if (!project.paymentProviderCustomerId) {
              throw new BadDataException("Payment Provider customer not found");
            }

            /*
             * A master admin moves a project whatever its customer has on
             * file, as the Admin Dashboard's admin-change-plan does; anyone
             * else needs a payment method first.
             */
            if (!isMasterAdmin) {
              const hasPaymentMethods: boolean =
                await BillingService.hasPaymentMethods(
                  project.paymentProviderCustomerId,
                );

              if (!hasPaymentMethods) {
                throw new BadDataException(
                  Errors.BillingService.NO_PAYMENTS_METHODS,
                );
              }
            }
          }

          const hasBillingPermission: boolean = CallerPermission.holdsAnyOf(
            req as OneUptimeRequest,
            PROJECT_CHANGE_PLAN_PERMISSIONS,
          );

          if (!hasBillingPermission && !isMasterAdmin) {
            throw new BadDataException(
              `You need ${Permission.ProjectOwner} or ${Permission.ManageProjectBilling} permission to change project plan`,
            );
          }

          await ProjectService.changePlan({
            projectId: projectId,
            paymentProviderPlanId: paymentProviderPlanId,
            ...(isMasterAdmin ? { requirePaymentMethod: false } : {}),
          });

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Where each kind of number stands in the project - its prefix, the
     * highest number given out so far and the number the next record gets
     * (Utils/Project/NextNumber) - for the Numbering pages' Next Number
     * card, and for anyone automating a move from another tool.
     *
     * The counters behind it are no caller's to read through the model API,
     * so the answer is read as OneUptime and this route checks its caller
     * itself, on every request: credentials (401 without - an expired
     * session is refreshed and sent again), a member or API key of the
     * project the URL names (getUserMiddleware takes the project from the
     * caller's own tenantid header, so the two must match), and a
     * permission that reads the project's numbering settings - the read list
     * of the columns that hold where numbers start, so the route says no
     * more than the model API would.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/:id/numbering`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectPrincipal(props);

          const idParam: string = String(req.params["id"] || "");

          if (
            !ObjectID.isValidUUID(idParam) ||
            idParam.toLowerCase() !== projectId.toString().toLowerCase()
          ) {
            throw new NotAuthorizedException(
              "You are not authorized to access this project's data.",
            );
          }

          CommonAPI.assertPermittedInProject({
            databaseProps: props,
            allowedPermissions: getNumberingReadPermissions(),
            errorMessage:
              "You do not have permission to read this project's numbering.",
          });

          const numbering: Array<RecordNumbering> =
            await ProjectService.getNumbering(projectId);

          // Every record created moves it on: never answered from a cache.
          Response.setNoCacheHeaders(res);

          return Response.sendJsonObjectResponse(req, res, {
            numbering: numbering.map((entry: RecordNumbering): JSONObject => {
              return {
                kind: entry.kind as NumberedRecordKind,
                prefix: entry.prefix,
                highestNumber: entry.highestNumber,
                nextNumber: entry.nextNumber,
                numbersStartAt: entry.numbersStartAt,
              };
            }) as JSONArray,
          });
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * The server's maximum on how long a project keeps resolved incidents
     * and alerts (issue #6941, Admin Dashboard > Settings > Data Retention),
     * for the project's Data Retention cards: what the project cannot keep
     * longer, locked there with a line that says so. GlobalConfig is no
     * caller's to read, so the answer is read as OneUptime, for a member or
     * API key of the project the URL names with a permission that reads the
     * project's retention - the column's own read list.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/:id/${RESOLVED_RECORD_RETENTION_ROUTE}`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const projectId: ObjectID = await this.assertRetentionCaller(
            req,
            "read",
          );

          const incident: ResolvedRecordRetentionServerLimits =
            await ResolvedRecordRetention.getServerLimits(
              ResolvedRecordKind.Incident,
            );
          const alert: ResolvedRecordRetentionServerLimits =
            await ResolvedRecordRetention.getServerLimits(
              ResolvedRecordKind.Alert,
            );

          logger.debug(
            `Read the server's retention maximum for project ${projectId.toString()}.`,
          );

          // A master admin may change it any time: never answered from a cache.
          Response.setNoCacheHeaders(res);

          return Response.sendJsonObjectResponse(
            req,
            res,
            ResolvedRecordRetentionAnswers.toLimitsJSON({
              incidentMaximumInDays: incident.maximumInDays,
              alertMaximumInDays: alert.maximumInDays,
            }),
          );
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * How many incidents (alerts) a Data Retention setting deletes now
     * (issue #6943): the setting as the card would save it - its length,
     * and for incidents the postmortem switch and statuses, the project's
     * saved ones where the request leaves them out - counted with the
     * purge's own filters under the server's maximum
     * (ResolvedRecordRetention.countDueRecords). Project Owners and Admins,
     * who may change the setting. A count that fails or takes too long is
     * answered with no count, so the card asks its question without one.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/:id/${RESOLVED_RECORD_RETENTION_COUNT_ROUTE}`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const request: DueRecordsCountRequest | null =
            ResolvedRecordRetentionAnswers.readCountRequest(req.body);

          if (!request) {
            throw new BadDataException(
              "Say what to count: the kind (Incident or Alert) and a retention in days, one of the choices or 0.",
            );
          }

          const projectId: ObjectID = await this.assertRetentionCaller(
            req,
            "update",
            request.kind,
          );

          Response.setNoCacheHeaders(res);

          try {
            const saved: Project | null = await ProjectService.findOneById({
              id: projectId,
              select: {
                keepIncidentsWithCompletedPostmortem: true,
                keepIncidentsInPostmortemStatusIds: true,
              },
              props: {
                isRoot: true,
              },
            });

            const limits: ResolvedRecordRetentionServerLimits =
              await ResolvedRecordRetention.getServerLimits(request.kind);

            const count: DueRecordsCount =
              await ResolvedRecordRetention.countDueRecords({
                kind: request.kind,
                projectId: projectId,
                retentionInDays: request.retentionInDays,
                keepCompletedPostmortems:
                  request.keepIncidentsWithCompletedPostmortem ??
                  saved?.keepIncidentsWithCompletedPostmortem !== false,
                keptPostmortemStatusIds: readKeptPostmortemStatusIds(
                  request.keepIncidentsInPostmortemStatusIds ??
                    saved?.keepIncidentsInPostmortemStatusIds,
                ),
                maximumInDays: limits.maximumInDays,
              });

            return Response.sendJsonObjectResponse(
              req,
              res,
              ResolvedRecordRetentionAnswers.toCountJSON(count),
            );
          } catch (countError) {
            logger.warn(
              `Counting what a retention setting deletes in project ${projectId.toString()} failed; the question is asked without the count: ${String(countError)}`,
            );

            return Response.sendJsonObjectResponse(req, res, {
              count: null,
              isAtLeast: false,
            });
          }
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * GET /project/:id/saved-sign-in-settings - how many of the project's
     * people the signed-in owner may clear the saved sign-in settings of
     * (#9820, Server/Utils/ProjectSignInClearing): people whose every
     * project manages sign-in with SSO and is one this owner owns, master
     * admins never. What Project Settings > Security > SSO says under
     * Manage Sign-In with SSO before it offers to clear them.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/:id/${PROJECT_SAVED_SIGN_IN_SETTINGS_ACTION}`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const caller: { projectId: ObjectID; ownerUserId: ObjectID } =
            await ProjectAPI.assertSignInClearingOwner(req);

          Response.setNoCacheHeaders(res);

          const answer: SavedSignInSettingsAnswer = {
            peopleCount:
              await ProjectSignInClearing.countClearablePeople(caller),
          };

          return Response.sendJsonObjectResponse(
            req,
            res,
            answer as unknown as JSONObject,
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    /*
     * POST /project/:id/saved-sign-in-settings/clear - the owner clearing
     * those people's saved sign-in settings (#9820,
     * ProjectSignInClearing.clearForProject): never anybody with a project
     * this owner does not own, never a master admin, never the owner;
     * each person recorded in their projects' audit logs and emailed.
     * Refused while the project does not manage sign-in with SSO. It cannot
     * be undone, and the card asks first. Takes no body.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/:id/${PROJECT_CLEAR_SAVED_SIGN_IN_SETTINGS_ACTION}`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const caller: { projectId: ObjectID; ownerUserId: ObjectID } =
            await ProjectAPI.assertSignInClearingOwner(req);

          const answer: ClearSavedSignInSettingsAnswer = {
            peopleCleared: await ProjectSignInClearing.clearForProject(caller),
          };

          return Response.sendJsonObjectResponse(
            req,
            res,
            answer as unknown as JSONObject,
          );
        } catch (err) {
          return next(err);
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

          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectsDeleted: number = await ProjectService.deleteOneById({
            id: projectId,
            deletionReason: deletionReason,
            props: props,
          });

          // A delete that removed nothing says so, as the plain route does.
          if (projectsDeleted === 0) {
            throw await ProjectService.getUnwrittenByIdError({
              id: projectId,
              props: props,
              type: DatabaseRequestType.Delete,
            });
          }

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

          // Who granted the extension is the only audit trail this action has.
          const extendedByUserId: ObjectID | undefined =
            readMasterAdminUserId(req);

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
     * Moves a project to another plan, from the Admin Dashboard (issue
     * #6771). Master-admin only, like extend-trial: OneUptime staff act on a
     * project they are not a member of, so change-plan's checks - the
     * caller's own project, a billing permission in it - cannot apply, and
     * the master admin middleware is the whole check.
     *
     * The move itself is the one the customer makes
     * (ProjectService.changePlan): the payment provider is changed first, a
     * running trial carries over, and a project a cloud marketplace bills
     * moves without a card. Unlike the customer's, it does not need a
     * payment method on file. A custom-priced plan (Enterprise) can be
     * picked here, as change-plan lets a master admin pick it.
     */
    this.router.put(
      `${new this.entityType().getCrudApiPath()?.toString()}/:id/admin-change-plan`,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          if (!IsBillingEnabled) {
            throw new BadDataException(
              "Billing is not enabled on this server, so projects have no plan to change.",
            );
          }

          const idParam: string = String(req.params["id"] || "");

          if (!ObjectID.isValidUUID(idParam)) {
            throw new BadDataException(
              "The project ID in the address is not valid. Open the project from the Projects list, then try again.",
            );
          }

          const projectId: ObjectID = new ObjectID(idParam);

          const body: JSONObject = (req.body as JSONObject) || {};
          const data: JSONObject = (body["data"] as JSONObject) || {};
          const planIdValue: JSONValue = data["paymentProviderPlanId"];

          const paymentProviderPlanId: string =
            typeof planIdValue === "string" ? planIdValue.trim() : "";

          if (!paymentProviderPlanId) {
            throw new BadDataException(
              "Choose the plan to move this project to.",
            );
          }

          const plans: Array<SubscriptionPlan> =
            SubscriptionPlan.getSubscriptionPlans(getAllEnvVars());

          if (
            !SubscriptionPlan.isValidPlanId(
              paymentProviderPlanId,
              getAllEnvVars(),
            )
          ) {
            throw new BadDataException(
              "That plan is not one this server offers. Choose one of the plans shown, then try again.",
            );
          }

          const project: Project | null = await ProjectService.findOneById({
            id: projectId,
            select: {
              paymentProviderPlanId: true,
            },
            props: {
              isRoot: true,
            },
          });

          if (!project) {
            throw new BadDataException(
              "This project no longer exists. It may have been deleted.",
            );
          }

          /*
           * The dialog opens on the plan the project is on. A submit that
           * changes nothing would still swap the price for itself at the
           * payment provider and report a plan change, so it is refused.
           */
          if (
            isSamePlanChoice(
              plans,
              project.paymentProviderPlanId,
              paymentProviderPlanId,
            )
          ) {
            throw new BadDataException(
              "This project is already on that plan. Choose another plan to move it to.",
            );
          }

          // Who moved the project is the only audit trail this action has.
          const changedByUserId: ObjectID | undefined =
            readMasterAdminUserId(req);

          /*
           * Staff move a project whatever the customer has on file: a
           * project with no payment method moves too, and anything the new
           * plan owes waits on an invoice the customer pays once they add one
           * (StripeBillingProvider.changePlan). The customer's own change
           * still needs a payment method.
           */
          await ProjectService.changePlan({
            projectId: projectId,
            paymentProviderPlanId: paymentProviderPlanId,
            requirePaymentMethod: false,
          });

          logger.info(
            `Plan for project ${projectId.toString()} changed from ${
              project.paymentProviderPlanId || "none"
            } to ${paymentProviderPlanId} by master admin ${
              changedByUserId?.toString() || "unknown"
            }`,
          );

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Manually corrects a project's SMS/Call or AI balance. Master-admin only,
     * for the same reason extend-trial is: it hands out (or claws back) paid
     * service with no payment behind it, so project-level billing permissions
     * must not reach it - only OneUptime staff acting from the Admin
     * Dashboard.
     */
    this.router.put(
      `${new this.entityType().getCrudApiPath()?.toString()}/:id/adjust-balance`,
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

          const balanceTypeValue: JSONValue = data["balanceType"];
          const adjustmentTypeValue: JSONValue = data["adjustmentType"];
          const amountInUSDValue: JSONValue = data["amountInUSD"];
          const reasonValue: JSONValue = data["reason"];

          if (
            !balanceTypeValue ||
            typeof balanceTypeValue !== "string" ||
            !Object.values(ProjectBalanceType).includes(
              balanceTypeValue as ProjectBalanceType,
            )
          ) {
            throw new BadDataException(
              `Balance type must be one of: ${Object.values(
                ProjectBalanceType,
              ).join(", ")}`,
            );
          }

          if (
            !adjustmentTypeValue ||
            typeof adjustmentTypeValue !== "string" ||
            !Object.values(BalanceAdjustmentType).includes(
              adjustmentTypeValue as BalanceAdjustmentType,
            )
          ) {
            throw new BadDataException(
              `Adjustment type must be one of: ${Object.values(
                BalanceAdjustmentType,
              ).join(", ")}`,
            );
          }

          /*
           * The form posts dollars because that is what staff think in, but
           * the column is cents. A JSON body can carry a numeric string, so
           * accept both and reject anything that does not parse - Number("")
           * and Number([]) are 0, which would otherwise read as a real
           * "set to zero" instruction.
           */
          if (
            typeof amountInUSDValue !== "number" &&
            typeof amountInUSDValue !== "string"
          ) {
            throw new BadDataException("Amount is not a valid number");
          }

          const amountInUSD: number =
            typeof amountInUSDValue === "number"
              ? amountInUSDValue
              : Number(amountInUSDValue.trim());

          if (
            !Number.isFinite(amountInUSD) ||
            (typeof amountInUSDValue === "string" &&
              amountInUSDValue.trim() === "")
          ) {
            throw new BadDataException("Amount is not a valid number");
          }

          if (typeof reasonValue !== "string" || !reasonValue.trim()) {
            throw new BadDataException(
              "A reason is required to adjust the balance",
            );
          }

          /*
           * Dollars carry at most two decimal places, and floating point
           * multiplication does not (20.15 * 100 is 2014.9999...). Round to
           * the nearest cent so the stored amount is the one that was typed.
           */
          const amountInUSDCents: number = Math.round(amountInUSD * 100);

          // Who moved the balance is the only audit trail this action has.
          const adjustedByUserId: ObjectID | undefined =
            readMasterAdminUserId(req);

          const result: ProjectBalanceAdjustmentResult =
            await ProjectService.adjustBalance({
              projectId: projectId,
              balanceType: balanceTypeValue as ProjectBalanceType,
              adjustmentType: adjustmentTypeValue as BalanceAdjustmentType,
              amountInUSDCents: amountInUSDCents,
              reason: reasonValue,
              adjustedByUserId: adjustedByUserId,
            });

          return Response.sendJsonObjectResponse(req, res, {
            previousBalanceInUSDCents: result.previousBalanceInUSDCents,
            newBalanceInUSDCents: result.newBalanceInUSDCents,
          });
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * A project's invoices, newest first, read live from the payment
     * provider for the Admin Dashboard's Invoices page. Master-admin only,
     * like extend-trial: OneUptime staff read the invoices of a project they
     * are not a member of, so the master admin middleware is the whole check.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/:id/admin-invoices`,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          if (!IsBillingEnabled) {
            throw new BadDataException(BILLING_DISABLED_NO_INVOICES_MESSAGE);
          }

          const projectId: ObjectID = readProjectIdFromAddress(req);

          const invoices: Array<AdminProjectInvoice> =
            await BillingInvoiceService.getInvoicesForAdmin(projectId);

          return Response.sendJsonObjectResponse(req, res, {
            invoices: invoices.map(toAdminProjectInvoiceJSON),
          });
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Voids one of a project's invoices, from the Admin Dashboard: the
     * customer no longer owes it, and the payment provider stops collecting
     * it. Master-admin only, for the same reason extend-trial is - it waives
     * what a customer owes, so project-level billing permissions must not
     * reach it. BillingInvoiceService.voidInvoiceForProject holds the invoice
     * to this project and to the statuses that can be voided.
     */
    this.router.put(
      `${new this.entityType().getCrudApiPath()?.toString()}/:id/admin-void-invoice`,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          if (!IsBillingEnabled) {
            throw new BadDataException(BILLING_DISABLED_NO_INVOICES_MESSAGE);
          }

          const projectId: ObjectID = readProjectIdFromAddress(req);

          const body: JSONObject = (req.body as JSONObject) || {};
          const data: JSONObject = (body["data"] as JSONObject) || {};
          const invoiceIdValue: JSONValue = data["paymentProviderInvoiceId"];

          const invoiceId: string =
            typeof invoiceIdValue === "string" ? invoiceIdValue.trim() : "";

          if (!invoiceId) {
            throw new BadDataException("Choose the invoice to void.");
          }

          if (!PAYMENT_PROVIDER_INVOICE_ID.test(invoiceId)) {
            throw new BadDataException(ADMIN_INVOICE_ID_NOT_VALID_MESSAGE);
          }

          // Who voided the invoice is the only audit trail this action has.
          const voidedByUserId: ObjectID | undefined =
            readMasterAdminUserId(req);

          await BillingInvoiceService.voidInvoiceForProject({
            projectId: projectId,
            paymentProviderInvoiceId: invoiceId,
            voidedByUserId: voidedByUserId,
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
              "You must be signed in to use this API.",
            );
          }

          const projectSelect: Select<Project> = {
            _id: true,
            name: true,
            trialEndsAt: true,
            paymentProviderPlanId: true,
            resellerId: true,
            // A marketplace-billed project has no card to ask for (Header).
            billingMarketplace: true,
            isFeatureFlagMonitorGroupsEnabled: true,
            /*
             * The project's one AI switch: with AI off, the Dashboard draws
             * no AI action at all (Common/Utils/Suggestions/AiSuggestion),
             * instead of offering one the server would refuse.
             */
            enableAi: true,
            /*
             * The columns the project's lists show everyone who has not
             * chosen their own (Project.defaultTableColumns): read with the
             * project, so a list draws them from its first paint, with no
             * read of its own (ModelTable/ProjectDefaultColumns).
             */
            defaultTableColumns: true,
            /*
             * The products the project hides (issue #6814,
             * Project.productSettings): read with the project, so the
             * products menu, Home and Search draw the project's products on
             * their first paint, before the products answer arrives.
             */
            productSettings: true,
            paymentProviderMeteredSubscriptionStatus: true,
            paymentProviderSubscriptionStatus: true,
            /*
             * A project a master admin blocked stays in the list, marked: the
             * Dashboard shows it as blocked rather than as a project that
             * vanished, and its picker still switches to the others. Its own
             * members are told only that their project is blocked.
             */
            isBlocked: true,
            /*
             * Who created the project, so the Dashboard's analytics events
             * can say whether the person created it (is_project_creator,
             * Docs/analytics/activation.md) - an id, compared in the
             * browser and never sent.
             */
            createdByUserId: true,
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
              /*
               * Who sold the plan, and how to reach them: a product the
               * plan leaves out says who to ask to add it
               * (Dashboard's Components/Billing/ResellerPlanNotice).
               */
              select: {
                _id: true,
                enableTelemetryFeatures: true,
                name: true,
                description: true,
                changePlanLink: true,
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

  /*
   * The project a Data Retention route answers about (issues #6941,
   * #6943): the one the request is authenticated for - a member or API key
   * of it, named in the URL too - with a permission that reads ("read") or
   * changes ("update") the kind's retention: the column's own lists, so a
   * route says no more, and counts for nobody more, than the model API
   * would.
   */
  private async assertRetentionCaller(
    req: ExpressRequest,
    access: "read" | "update",
    kind: ResolvedRecordKind = ResolvedRecordKind.Incident,
  ): Promise<ObjectID> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const projectId: ObjectID =
      CommonAPI.assertAuthenticatedProjectPrincipal(props);

    const idParam: string = String(req.params["id"] || "");

    if (
      !ObjectID.isValidUUID(idParam) ||
      idParam.toLowerCase() !== projectId.toString().toLowerCase()
    ) {
      throw new NotAuthorizedException(
        "You are not authorized to access this project's data.",
      );
    }

    CommonAPI.assertPermittedInProject({
      databaseProps: props,
      allowedPermissions: getRetentionPermissions(kind, access),
      errorMessage:
        access === "read"
          ? "You do not have permission to read how long this project keeps resolved incidents and alerts."
          : "Only Project Owners and Project Admins can see what a change to how long resolved incidents and alerts are kept deletes.",
    });

    return projectId;
  }

  /*
   * Who may count and clear the sign-in settings a project's people saved
   * (#9820): a signed-in person - never a project API key, which a leak
   * would turn into a way to strip people's sign-in - who is a Project
   * Owner of the project in the path, read from their own permission rows
   * (CallerPermission: a team's block is no grant) and never from
   * master-admin standing, which has the Admin Dashboard's clears instead.
   * The project in the path must be the one the request is authorized for.
   */
  private static async assertSignInClearingOwner(
    req: ExpressRequest,
  ): Promise<{ projectId: ObjectID; ownerUserId: ObjectID }> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    // A signed-in member: 401 without credentials, refused for an API key.
    const projectId: ObjectID =
      CommonAPI.assertAuthenticatedProjectMember(props);

    const idParam: string = String(req.params["id"] || "");

    if (
      !ObjectID.isValidUUID(idParam) ||
      idParam.toLowerCase() !== projectId.toString().toLowerCase()
    ) {
      throw new NotAuthorizedException(
        "You are not authorized to access this project's data.",
      );
    }

    if (
      !props.userId ||
      !CallerPermission.holdsAnyOf(props, [Permission.ProjectOwner])
    ) {
      throw new NotAuthorizedException(
        CLEAR_PROJECT_SIGN_IN_OWNERS_ONLY_MESSAGE,
      );
    }

    return { projectId: projectId, ownerUserId: props.userId };
  }
}
