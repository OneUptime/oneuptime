import UserMiddleware from "../Middleware/UserAuthorization";
import UserWhatsAppService, {
  Service as UserWhatsAppServiceType,
} from "../Services/UserWhatsAppService";
import {
  ExpressRequest,
  ExpressResponse,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import BadDataException from "../../Types/Exception/BadDataException";
import UserWhatsApp from "../../Models/DatabaseModels/UserWhatsApp";

export default class UserWhatsAppAPI extends BaseAPI<UserWhatsApp, UserWhatsAppServiceType> {
  public constructor() {
    super(UserWhatsApp, UserWhatsAppService);

    this.router.post(
      `/user-whatsapp/verify`,
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

        // Check if the code matches and verify the phone number.
        const item: UserWhatsApp | null = await this.service.findOneById({
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
      `/user-whatsapp/resend-verification-code`,
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