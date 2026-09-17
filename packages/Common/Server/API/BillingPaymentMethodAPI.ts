import { IsBillingEnabled } from "../EnvironmentConfig";
import UserMiddleware from "../Middleware/UserAuthorization";
import BillingPaymentMethodService, {
  Service as BillingPaymentMethodServiceType,
} from "../Services/BillingPaymentMethodService";
import BillingService from "../Services/BillingService";
import PayAsYouGoBillingService from "../Services/PayAsYouGoBillingService";
import ProjectService from "../Services/ProjectService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission, { UserPermission } from "../../Types/Permission";
import BillingPaymentMethod from "../../Models/DatabaseModels/BillingPaymentMethod";
import Project from "../../Models/DatabaseModels/Project";

/*
 * Who may add a card, and so who may make one the default: the dashboard makes
 * a newly added card the default straight after adding it, so anyone allowed
 * to add one has to be allowed to finish that flow. Editing a payment method
 * is what choosing the default is, so that permission is accepted too.
 */
const MANAGE_PAYMENT_METHOD_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ManageProjectBilling,
  Permission.CreateBillingPaymentMethod,
  Permission.EditBillingPaymentMethod,
];

export default class UserAPI extends BaseAPI<
  BillingPaymentMethod,
  BillingPaymentMethodServiceType
> {
  public constructor() {
    super(BillingPaymentMethod, BillingPaymentMethodService);

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/setup`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          if (!IsBillingEnabled) {
            throw new BadDataException(
              "Billing is not enabled for this server",
            );
          }

          if (req.body["projectId"]) {
            throw new BadDataException(
              "projectId should not be passed in the request body. The project is resolved from the tenantid header.",
            );
          }

          const userPermissions: Array<UserPermission> = (
            await this.getPermissionsForTenant(req)
          ).filter((permission: UserPermission) => {
            return [
              Permission.ProjectOwner,
              Permission.ManageProjectBilling,
              Permission.CreateBillingPaymentMethod,
            ].includes(permission.permission);
          });

          if (userPermissions.length === 0) {
            throw new BadDataException(
              "Only project owners or members with Manage Billing access can add payment methods.",
            );
          }

          const project: Project | null = await ProjectService.findOneById({
            id: this.getTenantId(req)!,
            props: {
              isRoot: true,
            },
            select: {
              _id: true,
              paymentProviderCustomerId: true,
            },
          });

          if (!project) {
            throw new BadDataException("Project not found");
          }

          if (!project.paymentProviderCustomerId) {
            throw new BadDataException("Payment Provider customer not found");
          }

          const setupIntent: string = await BillingService.getSetupIntentSecret(
            project.paymentProviderCustomerId,
          );

          return Response.sendJsonObjectResponse(req, res, {
            setupIntent: setupIntent,
          });
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Makes one of the project's payment methods the default, and moves
     * autopay onto it.
     *
     * Autopay does not follow the customer's default on its own: a
     * subscription carrying its own default_payment_method keeps charging that
     * card. A customer whose card started declining could add a new card and
     * still see every renewal fail against the old one, because nothing in
     * OneUptime ever changed which card the subscription charged.
     * BillingService.makePaymentMethodDefault sets the default and clears
     * those stale subscription pins together.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/set-default`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          if (!IsBillingEnabled) {
            throw new BadDataException(
              "Billing is not enabled for this server",
            );
          }

          if (req.body["projectId"]) {
            throw new BadDataException(
              "projectId should not be passed in the request body. The project is resolved from the tenantid header.",
            );
          }

          const userPermissions: Array<UserPermission> = (
            await this.getPermissionsForTenant(req)
          ).filter((permission: UserPermission) => {
            return MANAGE_PAYMENT_METHOD_PERMISSIONS.includes(
              permission.permission,
            );
          });

          if (
            userPermissions.length === 0 &&
            !(req as OneUptimeRequest).userAuthorization?.isMasterAdmin
          ) {
            throw new BadDataException(
              "Only project owners or members with Manage Billing access can change the default payment method.",
            );
          }

          const tenantId: ObjectID | null = this.getTenantId(req);

          if (!tenantId) {
            throw new BadDataException("Project not found");
          }

          const project: Project | null = await ProjectService.findOneById({
            id: tenantId,
            props: {
              isRoot: true,
            },
            select: {
              _id: true,
              paymentProviderCustomerId: true,
            },
          });

          if (!project || !project.id) {
            throw new BadDataException("Project not found");
          }

          if (!project.paymentProviderCustomerId) {
            throw new BadDataException("Payment Provider customer not found");
          }

          const data: JSONObject | undefined = req.body?.["data"] as
            | JSONObject
            | undefined;

          const paymentMethodId: unknown =
            data?.["paymentProviderPaymentMethodId"];

          if (typeof paymentMethodId !== "string" || !paymentMethodId.trim()) {
            throw new BadDataException("Payment method ID not found");
          }

          /*
           * Always the project's own customer. The service refuses a payment
           * method that is not attached to it, so an id belonging to another
           * project's customer cannot be made default here.
           */
          await BillingService.makePaymentMethodDefault(
            project.paymentProviderCustomerId,
            paymentMethodId.trim(),
          );

          /*
           * The cached pay-as-you-go authorization is derived from the
           * project's payment setup, which just changed. Drop it so the next
           * check reads the setup fresh, as the payment method sync does.
           */
          PayAsYouGoBillingService.invalidate(project.id);

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
