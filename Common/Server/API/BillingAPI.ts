import { IsBillingEnabled } from "../EnvironmentConfig";
import UserMiddleware from "../Middleware/UserAuthorization";
import BillingService from "../Services/BillingService";
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
import Permission, { UserPermission } from "../../Types/Permission";
import Project from "../../Models/DatabaseModels/Project";

export default class BillingAPI extends BaseAPI<any, any> {
  public constructor() {
    super(null as any, null as any);

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
}