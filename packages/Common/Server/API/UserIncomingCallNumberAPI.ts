import UserMiddleware from "../Middleware/UserAuthorization";
import VerificationCodeRateLimit, {
  VerificationCodeRateLimitBucket,
} from "../Middleware/VerificationCodeRateLimit";
import UserIncomingCallNumberService, {
  Service as UserIncomingCallNumberServiceType,
} from "../Services/UserIncomingCallNumberService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import ChannelVerification, {
  ChannelVerificationOutcome,
  ChannelVerificationResult,
} from "../Utils/ChannelVerification";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import ChannelVerificationResendRoute from "./ChannelVerificationResendRoute";
import ChannelVerificationStatusRoute from "./ChannelVerificationStatusRoute";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import UserIncomingCallNumber from "../../Models/DatabaseModels/UserIncomingCallNumber";

/*
 * The verify and resend routes for this notification channel.
 *
 * Neither the checking of a submitted code nor the issuing of a new one lives
 * here, on purpose. The state machine is shared by all five channels
 * (Common/Server/Utils/ChannelVerification.ts) so that a control added for one
 * of them cannot quietly go missing on another — which is exactly what went
 * wrong before: five hand-written copies of "compare the column, set
 * isVerified", none of which expired the code, counted attempts, or refused a
 * caller running the comparison a million times against somebody else's phone
 * number.
 *
 * What is left here is the HTTP shape: reject malformed bodies, run the rate
 * limiter before anything costs a database read, and turn the outcome into a
 * response.
 */
export default class UserIncomingCallNumberAPI extends BaseAPI<
  UserIncomingCallNumber,
  UserIncomingCallNumberServiceType
> {
  public constructor() {
    super(UserIncomingCallNumber, UserIncomingCallNumberService);

    this.router.post(
      `/user-incoming-call-number/verify`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      VerificationCodeRateLimit.getMiddleware(
        VerificationCodeRateLimitBucket.Verify,
      ),
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

          const userId: ObjectID | undefined = (req as OneUptimeRequest)
            ?.userAuthorization?.userId;

          if (!userId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid user ID"),
            );
          }

          const result: ChannelVerificationResult =
            await ChannelVerification.verifyCode({
              service: this.service,
              itemId: new ObjectID(req.body["itemId"].toString()),
              userId: userId,
              code: req.body["code"].toString(),
            });

          if (result.outcome !== ChannelVerificationOutcome.Verified) {
            return Response.sendErrorResponse(
              req,
              res,
              ChannelVerification.getFailureException(result.outcome),
            );
          }

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          return next(err);
        }
      },
    );

    // A new code for the person's own row. See ChannelVerificationResendRoute.
    ChannelVerificationResendRoute.register({
      router: this.router,
      path: "/user-incoming-call-number",
      service: this.service,
    });

    // Where the person's own code stands, for the verify dialog.
    ChannelVerificationStatusRoute.register({
      router: this.router,
      path: "/user-incoming-call-number",
      service: this.service,
    });
  }

  /*
   * Adding one sends its first code at once, so the add is counted first:
   * per person, per kind of method and per address
   * (VerificationCodeRateLimit.checkAddAllowed).
   */
  protected override async onBeforeCreate(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    await VerificationCodeRateLimit.checkAddAllowed({
      req: req,
      res: res,
      channel: "/user-incoming-call-number",
    });
  }
}
