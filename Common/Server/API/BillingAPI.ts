import { BillingWebhookSecret, IsBillingEnabled } from "../EnvironmentConfig";
import UserMiddleware from "../Middleware/UserAuthorization";
import BillingService from "../Services/BillingService";
import ProjectService from "../Services/ProjectService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BadDataException from "../../Types/Exception/BadDataException";
import Permission, { UserPermission } from "../../Types/Permission";
import Project from "../../Models/DatabaseModels/Project";
import CommonAPI from "./CommonAPI";
import ObjectID from "../../Types/ObjectID";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import logger from "../Utils/Logger";

export default class BillingAPI {
  public router: ExpressRouter;

  public constructor() {
    this.router = Express.getRouter();

    // Stripe webhook endpoint - uses raw body captured by JSON parser for signature verification
    this.router.post(
      `/billing/webhook`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          logger.debug(
            `[Invoice Email] Webhook endpoint hit - /billing/webhook`,
          );

          if (!IsBillingEnabled) {
            logger.debug(
              `[Invoice Email] Billing not enabled, returning early`,
            );
            return Response.sendJsonObjectResponse(req, res, {
              message: "Billing is not enabled",
            });
          }

          if (!BillingWebhookSecret) {
            logger.error(
              `[Invoice Email] Billing webhook secret is not configured`,
            );
            throw new BadDataException(
              "Billing webhook secret is not configured",
            );
          }

          const signature: string = req.headers["stripe-signature"] as string;
          logger.debug(
            `[Invoice Email] Stripe signature header present: ${Boolean(signature)}`,
          );

          if (!signature) {
            logger.error(`[Invoice Email] Missing Stripe signature header`);
            throw new BadDataException("Missing Stripe signature header");
          }

          const rawBody: string | undefined = (req as OneUptimeRequest).rawBody;
          logger.debug(
            `[Invoice Email] Raw body present: ${Boolean(rawBody)}, length: ${rawBody?.length || 0}`,
          );

          if (!rawBody) {
            logger.error(
              `[Invoice Email] Missing raw body for webhook verification`,
            );
            throw new BadDataException(
              "Missing raw body for webhook verification",
            );
          }

          logger.debug(`[Invoice Email] Verifying webhook signature...`);
          const event: Stripe.Event = BillingService.verifyWebhookSignature(
            rawBody,
            signature,
          );
          logger.debug(
            `[Invoice Email] Webhook signature verified successfully, event type: ${event.type}`,
          );

          // Handle the event asynchronously
          logger.debug(`[Invoice Email] Handling webhook event...`);
          await BillingService.handleWebhookEvent(event);
          logger.debug(`[Invoice Email] Webhook event handled successfully`);

          return Response.sendJsonObjectResponse(req, res, {
            received: true,
          });
        } catch (err) {
          logger.error(`[Invoice Email] Stripe webhook error: ${err}`);
          next(err);
        }
      },
    );

    this.router.get(
      `/billing/customer-balance`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          if (!IsBillingEnabled) {
            throw new BadDataException(
              "Billing is not enabled for this server",
            );
          }

          const userPermissions: Array<UserPermission> = (
            await this.getPermissionsForTenant(req)
          ).filter((permission: UserPermission) => {
            return (
              permission.permission.toString() ===
                Permission.ProjectOwner.toString() ||
              permission.permission.toString() ===
                Permission.ManageProjectBilling.toString()
            );
          });

          if (
            userPermissions.length === 0 &&
            !(req as OneUptimeRequest).userAuthorization?.isMasterAdmin
          ) {
            throw new BadDataException(
              `You need ${Permission.ProjectOwner} or ${Permission.ManageProjectBilling} permission to view billing balance.`,
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

          const balance: number = await BillingService.getCustomerBalance(
            project.paymentProviderCustomerId,
          );

          return Response.sendJsonObjectResponse(req, res, {
            balance: balance,
          });
        } catch (err) {
          next(err);
        }
      },
    );
  }

  public async getPermissionsForTenant(
    req: ExpressRequest,
  ): Promise<Array<UserPermission>> {
    const permissions: Array<UserPermission> = [];

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    if (
      props &&
      props.userTenantAccessPermission &&
      props.userTenantAccessPermission[props.tenantId?.toString() || ""]
    ) {
      return (
        props.userTenantAccessPermission[props.tenantId?.toString() || ""]
          ?.permissions || []
      );
    }

    return permissions;
  }

  public getTenantId(req: ExpressRequest): ObjectID | null {
    if ((req as OneUptimeRequest).tenantId) {
      return (req as OneUptimeRequest).tenantId as ObjectID;
    }

    return null;
  }

  public getRouter(): ExpressRouter {
    return this.router;
  }
}
