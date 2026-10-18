import UserMiddleware from "../Middleware/UserAuthorization";
import VerificationCodeRateLimit, {
  VerificationCodeRateLimitBucket,
} from "../Middleware/VerificationCodeRateLimit";
import DatabaseService from "../Services/DatabaseService";
import Select from "../Types/Database/Select";
import { VerifiableChannelModel } from "../Utils/ChannelVerification";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import ChannelVerificationStatusRoute, {
  ChannelWithVerificationStatus,
} from "./ChannelVerificationStatusRoute";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";

/*
 * POST <channel>/resend-verification-code - a new code for the signed-in
 * person's own unverified email address, SMS number, call number, WhatsApp
 * number or incoming call number.
 *
 * Every channel with a code registers the same route through this one
 * function, as they do the status route (ChannelVerificationStatusRoute), so
 * a control added to one cannot quietly go missing on another.
 *
 * In order:
 *
 *   - a signed-in person (requireUserAuthentication answers an expired
 *     session with a 401 first), within the resend budget
 *     (VerificationCodeRateLimit, before anything costs a read);
 *   - a row id, and a person: a request whose session names nobody is
 *     refused before any row is read, so no comparison of two missing ids
 *     can ever pass for ownership;
 *   - the row is theirs - anybody else's is refused, or the route would make
 *     somebody else's phone ring on demand;
 *   - and the channel's own service does the rest
 *     (resendVerificationCode): the row's project still has them as a member
 *     (ChannelVerification.assertOwnerIsProjectMember), the row is not
 *     verified yet, the project can send, the per-row cooldown has passed.
 *
 * Answered with where the new code stands, so the verify dialog shows its
 * times and the next cooldown without asking again.
 */

// What a resend needs of the channel's service besides reading its rows.
export interface ChannelWithResend {
  resendVerificationCode(itemId: ObjectID): Promise<void>;
}

export default class ChannelVerificationResendRoute {
  public static register<TModel extends VerifiableChannelModel>(data: {
    router: ExpressRouter;
    // The channel's CRUD path: "/user-sms".
    path: string;
    service: DatabaseService<TModel> &
      ChannelWithVerificationStatus<TModel> &
      ChannelWithResend;
  }): void {
    data.router.post(
      `${data.path}/resend-verification-code`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      VerificationCodeRateLimit.getMiddleware(
        VerificationCodeRateLimitBucket.Resend,
      ),
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

          const item: TModel | null = await data.service.findOneById({
            id: req.body["itemId"],
            props: {
              isRoot: true,
            },
            select: {
              userId: true,
            } as Select<TModel>,
          });

          if (!item) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Item not found"),
            );
          }

          /*
           * A caller may only ask for a code to be sent to a row they own.
           * Without this the resend route is a way to make somebody else's
           * device ring on demand.
           */
          if (item.userId?.toString() !== userId.toString()) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid user ID"),
            );
          }

          await data.service.resendVerificationCode(req.body["itemId"]);

          return Response.sendJsonObjectResponse(
            req,
            res,
            (await ChannelVerificationStatusRoute.getStatusJSON({
              service: data.service,
              itemId: new ObjectID(req.body["itemId"].toString()),
            })) || {},
          );
        } catch (err) {
          return next(err);
        }
      },
    );
  }
}
