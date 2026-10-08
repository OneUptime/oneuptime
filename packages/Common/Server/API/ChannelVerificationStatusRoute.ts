import UserMiddleware from "../Middleware/UserAuthorization";
import DatabaseService from "../Services/DatabaseService";
import Select from "../Types/Database/Select";
import ChannelVerification, {
  ChannelVerificationStatus,
  VerifiableChannelModel,
} from "../Utils/ChannelVerification";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";

/*
 * POST <channel>/verification-status - where the signed-in person's own
 * unverified number stands: is a code waiting and until when, when another
 * may be sent, and why none can be if that is so (ChannelVerification
 * .getStatus).
 *
 * The verify dialog asks this when it opens, instead of announcing that a
 * code was sent - which it used to do whatever had happened, including
 * nothing at all, because the project had no Twilio account. Every channel
 * with a code (email, SMS, calls, WhatsApp, incoming call numbers) registers
 * the same route through this one function, so they answer alike.
 *
 * Only the row's owner gets an answer: the same refusals, in the same words,
 * as the verify route gives anybody else. There is nothing here to guess at
 * - no code, no attempt counter - so it is not rate limited the way verify
 * and resend are.
 */

export interface ChannelWithVerificationStatus<
  TModel extends VerifiableChannelModel,
> {
  getVerificationStatus(item: TModel): Promise<ChannelVerificationStatus>;
}

// What the status is read from, beyond whose row it is.
const STATUS_COLUMNS: Record<string, boolean> = {
  userId: true,
  projectId: true,
  isVerified: true,
  verificationCodeExpiresAt: true,
  verificationCodeSentAt: true,
  verificationFailedAttempts: true,
};

export default class ChannelVerificationStatusRoute {
  /*
   * The status of one row as the route answers it, or null when there is no
   * such row. Also what a resend answers with, so the dialog shows the new
   * code's times without asking again.
   */
  public static async getStatusJSON<
    TModel extends VerifiableChannelModel,
  >(data: {
    service: DatabaseService<TModel> & ChannelWithVerificationStatus<TModel>;
    itemId: ObjectID;
  }): Promise<JSONObject | null> {
    const item: TModel | null = await data.service.findOneById({
      id: data.itemId,
      props: {
        isRoot: true,
      },
      select: STATUS_COLUMNS as Select<TModel>,
    });

    if (!item) {
      return null;
    }

    return ChannelVerification.statusToJSON(
      await data.service.getVerificationStatus(item),
    );
  }

  public static register<TModel extends VerifiableChannelModel>(data: {
    router: ExpressRouter;
    // The channel's CRUD path: "/user-sms".
    path: string;
    service: DatabaseService<TModel> & ChannelWithVerificationStatus<TModel>;
  }): void {
    data.router.post(
      `${data.path}/verification-status`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          if (!req.body?.itemId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid item ID"),
            );
          }

          const userId: ObjectID | undefined = (req as OneUptimeRequest)
            ?.userAuthorization?.userId;

          if (!userId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid user ID"),
            );
          }

          const itemId: ObjectID = new ObjectID(req.body["itemId"].toString());

          const item: TModel | null = await data.service.findOneById({
            id: itemId,
            props: {
              isRoot: true,
            },
            select: STATUS_COLUMNS as Select<TModel>,
          });

          if (!item) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Item not found"),
            );
          }

          if (item.userId?.toString() !== userId.toString()) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid user ID"),
            );
          }

          return Response.sendJsonObjectResponse(
            req,
            res,
            ChannelVerification.statusToJSON(
              await data.service.getVerificationStatus(item),
            ),
          );
        } catch (err) {
          return next(err);
        }
      },
    );
  }
}
