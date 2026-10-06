import UserMiddleware from "../Middleware/UserAuthorization";
import AIBillingService from "../Services/AIBillingService";
import { IsBillingEnabled } from "../EnvironmentConfig";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import CallerPermission from "../Utils/Permission/CallerPermission";
import BadDataException from "../../Types/Exception/BadDataException";
import JSONFunctions from "../../Types/JSONFunctions";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import PositiveNumber from "../../Types/PositiveNumber";

const router: ExpressRouter = Express.getRouter();

/*
 * Who may add AI credits, charging the project's card. Asked the way every
 * permission check is (CallerPermission): a team's block row is no grant,
 * and a block with no labels on either takes it away.
 */
export const AI_RECHARGE_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.ProjectOwner,
  Permission.ManageProjectBilling,
];

router.post(
  "/ai/recharge",
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      if (!IsBillingEnabled) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Billing is not enabled"),
        );
      }

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
          AI_RECHARGE_PERMISSIONS,
          { projectId: projectId },
        )
      ) {
        await AIBillingService.rechargeBalance(projectId, amount);
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

export default router;
