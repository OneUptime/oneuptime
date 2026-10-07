import UserMiddleware from "../Middleware/UserAuthorization";
import NotificationService from "../Services/NotificationService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import CallerPermission from "../Utils/Permission/CallerPermission";
import AutoRechargeStateRequest from "../Utils/Billing/AutoRechargeStateRequest";
import AutoRechargeState from "../../Types/Billing/AutoRechargeState";
import ProjectBalanceType from "../../Types/Billing/ProjectBalanceType";
import { PROJECT_BALANCE_AUTO_RECHARGE_STATE_ROUTE } from "../../Utils/Project/ProjectBalance";
import BadDataException from "../../Types/Exception/BadDataException";
import JSONFunctions from "../../Types/JSONFunctions";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import PositiveNumber from "../../Types/PositiveNumber";

const router: ExpressRouter = Express.getRouter();

/*
 * Who may add SMS and call balance, charging the project's card. Asked the
 * way every permission check is (CallerPermission): a team's block row is
 * no grant, and a block with no labels on either takes it away.
 */
export const NOTIFICATION_RECHARGE_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.ProjectOwner,
  Permission.ManageProjectBilling,
];

router.post(
  "/notification/recharge",
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      let amount: number | PositiveNumber = JSONFunctions.deserializeValue(
        req.body.amount,
      ) as number | PositiveNumber;

      if (amount instanceof PositiveNumber) {
        amount = amount.toNumber();
      }

      if (typeof amount === "string") {
        amount = parseInt(amount);
      }

      const projectId: ObjectID = JSONFunctions.deserializeValue(
        req.body.projectId,
      ) as ObjectID;

      if (!amount || typeof amount !== "number") {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid amount"),
        );
      }

      if (amount > 1000) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Amount cannot be greater than 1000"),
        );
      }

      if (amount < 20) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Amount cannot be less than 20"),
        );
      }

      if (!projectId || !projectId.toString()) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid projectId"),
        );
      }

      // get permissions. if user has permission to recharge, then recharge

      if (
        !(req as OneUptimeRequest).userTenantAccessPermission ||
        !(req as OneUptimeRequest).userTenantAccessPermission![
          projectId.toString()
        ]
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Permission for this user not found"),
        );
      }

      if (
        CallerPermission.holdsAnyOf(
          req as OneUptimeRequest,
          NOTIFICATION_RECHARGE_PERMISSIONS,
          { projectId: projectId },
        )
      ) {
        await NotificationService.rechargeBalance(projectId, amount);
      } else {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "User does not have permission to recharge. You need any one of these permissions - ProjectOwner, CanManageProjectBilling",
          ),
        );
      }
    } catch (err) {
      return next(err);
    }

    return Response.sendEmptySuccessResponse(req, res);
  },
);

/*
 * What Auto Recharge of the project's SMS and call balance would do now:
 * Off, Ready, or Failed (its last automatic charge did not go through, and
 * it waits before trying the card again). Project Settings > Notification
 * Settings shows Failed at the top, so nobody has to wait for the owners'
 * email. Any member of the project may ask
 * (Utils/Billing/AutoRechargeStateRequest).
 */
router.get(
  PROJECT_BALANCE_AUTO_RECHARGE_STATE_ROUTE[ProjectBalanceType.SmsOrCall],
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const state: AutoRechargeState = await AutoRechargeStateRequest.getState({
        req: req as OneUptimeRequest,
        balance: ProjectBalanceType.SmsOrCall,
      });

      return Response.sendJsonObjectResponse(req, res, {
        state: state,
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
