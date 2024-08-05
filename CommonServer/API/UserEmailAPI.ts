import UserMiddleware from "../Middleware/UserAuthorization";
import UserEmailService, {
  Service as UserEmailServiceType,
} from "../Services/UserEmailService";
import {
  ExpressRequest,
  ExpressResponse,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import BadDataException from "Common/Types/Exception/BadDataException";
import UserEmail from "Common/AppModels/Models/UserEmail";

export default class UserEmailAPI extends BaseAPI<
  UserEmail,
  UserEmailServiceType
> {
  public constructor() {
    super(UserEmail, UserEmailService);

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/verify`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
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

        // Check if the code matches and verify the email.
        const item: UserEmail | null = await this.service.findOneById({
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

        //check user id

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
      },
    );

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/resend-verification-code`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
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
      },
    );
  }
}
