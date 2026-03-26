import UserMiddleware from "../Middleware/UserAuthorization";
import DashboardService, {
  Service as DashboardServiceType,
} from "../Services/DashboardService";
import CookieUtil from "../Utils/Cookie";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import BadDataException from "../../Types/Exception/BadDataException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import HashedString from "../../Types/HashedString";
import ObjectID from "../../Types/ObjectID";
import Dashboard from "../../Models/DatabaseModels/Dashboard";
import { EncryptionSecret } from "../EnvironmentConfig";
import { DASHBOARD_MASTER_PASSWORD_INVALID_MESSAGE } from "../../Types/Dashboard/MasterPassword";

export default class DashboardAPI extends BaseAPI<
  Dashboard,
  DashboardServiceType
> {
  public constructor() {
    super(Dashboard, DashboardService);

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/master-password/:dashboardId`,
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ) => {
        try {
          if (!req.params["dashboardId"]) {
            throw new BadDataException("Dashboard ID not found");
          }

          const dashboardId: ObjectID = new ObjectID(
            req.params["dashboardId"] as string,
          );

          const password: string | undefined =
            req.body && (req.body["password"] as string);

          if (!password) {
            throw new BadDataException("Master password is required.");
          }

          const dashboard: Dashboard | null =
            await DashboardService.findOneById({
              id: dashboardId,
              select: {
                _id: true,
                projectId: true,
                enableMasterPassword: true,
                masterPassword: true,
                isPublicDashboard: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!dashboard) {
            throw new NotFoundException("Dashboard not found");
          }

          if (dashboard.isPublicDashboard) {
            throw new BadDataException(
              "This dashboard is already visible to everyone.",
            );
          }

          if (
            !dashboard.enableMasterPassword ||
            !dashboard.masterPassword
          ) {
            throw new BadDataException(
              "Master password has not been configured for this dashboard.",
            );
          }

          const hashedInput: string = await HashedString.hashValue(
            password,
            EncryptionSecret,
          );

          if (hashedInput !== dashboard.masterPassword.toString()) {
            throw new BadDataException(
              DASHBOARD_MASTER_PASSWORD_INVALID_MESSAGE,
            );
          }

          CookieUtil.setDashboardMasterPasswordCookie({
            expressResponse: res,
            dashboardId,
          });

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
