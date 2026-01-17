import UserMiddleware from "../Middleware/UserAuthorization";
import UserIncomingCallNumberService, {
  Service as UserIncomingCallNumberServiceType,
} from "../Services/UserIncomingCallNumberService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import BadDataException from "../../Types/Exception/BadDataException";
import UserIncomingCallNumber from "../../Models/DatabaseModels/UserIncomingCallNumber";

export default class UserIncomingCallNumberAPI extends BaseAPI<
  UserIncomingCallNumber,
  UserIncomingCallNumberServiceType
> {
  public constructor() {
    super(UserIncomingCallNumber, UserIncomingCallNumberService);

    this.router.post(
      `/user-incoming-call-number/verify`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          req = req as OneUptimeRequest;

          if (!req.body.itemId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid item ID"),
            );
          }

          if (!req.body.code) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid code"),
            );
          }

          // Check if the code matches and verify the phone number
          const item: UserIncomingCallNumber | null =
            await this.service.findOneById({
              id: req.body["itemId"],
              props: {
                isRoot: true,
              },
              select: {
                userId: true,
                verificationCode: true,
              },
            });

          if (!item) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Item not found"),
            );
          }

          // Check user ID
          if (
            item.userId?.toString() !==
            (req as OneUptimeRequest)?.userAuthorization?.userId?.toString()
          ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid user ID"),
            );
          }

          if (item.verificationCode !== req.body["code"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid code"),
            );
          }

          await this.service.updateOneById({
            id: item.id!,
            props: {
              isRoot: true,
            },
            data: {
              isVerified: true,
            },
          });

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          return next(err);
        }
      },
    );

    this.router.post(
      `/user-incoming-call-number/resend-verification-code`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          req = req as OneUptimeRequest;

          if (!req.body.itemId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid item ID"),
            );
          }

          await this.service.resendVerificationCode(req.body.itemId);

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          return next(err);
        }
      },
    );
  }
}
