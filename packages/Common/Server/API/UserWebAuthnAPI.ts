import ObjectID from "../../Types/ObjectID";
import UserMiddleware from "../Middleware/UserAuthorization";
import UserWebAuthnService, {
  Service as UserWebAuthnServiceType,
} from "../Services/UserWebAuthnService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import BaseAPI from "./BaseAPI";
import UserWebAuthn from "../../Models/DatabaseModels/UserWebAuthn";
import Response from "../Utils/Response";
import { JSONObject } from "../../Types/JSON";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import UserTwoFactorBackupCodeService from "../Services/UserTwoFactorBackupCodeService";
import TwoFactorBackupCode from "../Utils/TwoFactorBackupCode";
import logger from "../Utils/Logger";
import TwoFactorBackupCodeNotification from "../Utils/TwoFactorBackupCodeNotification";
import RequestOriginUtil from "../Utils/RequestOrigin/RequestOriginUtil";

export default class UserWebAuthnAPI extends BaseAPI<
  UserWebAuthn,
  UserWebAuthnServiceType
> {
  public constructor() {
    super(UserWebAuthn, UserWebAuthnService);

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/generate-registration-options`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const userId: ObjectID = (req as OneUptimeRequest).userAuthorization!
            .userId;

          const result: { options: any; challenge: string } =
            await UserWebAuthnService.generateRegistrationOptions({
              userId: userId,
              isPasskey: req.body?.["isPasskey"] === true,
            });

          return Response.sendJsonObjectResponse(req, res, result);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/verify-registration`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const data: JSONObject = req.body;

          const databaseProps: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const credential: any = data["credential"];
          const name: string = data["name"] as string;

          await UserWebAuthnService.verifyRegistration({
            credential: credential,
            name: name,
            props: databaseProps,
          });

          /*
           * A security key is a second factor that can be left in a taxi, so
           * registering one is a moment that needs a recovery route behind it.
           * Minted here for the same reason -- and with the same
           * only-if-there-are-none rule -- as on the TOTP validate route; see
           * the note there. A key added ALONGSIDE an authenticator app finds
           * codes already present and changes nothing.
           *
           * Never fatal to the registration: the credential is already saved
           * at this point, so an error here would report a failure for work
           * that succeeded.
           */
          let backupCodes: Array<string> | null = null;

          if (databaseProps.userId) {
            try {
              backupCodes =
                await UserTwoFactorBackupCodeService.generateForUserIfNone({
                  userId: databaseProps.userId,
                });
            } catch (backupCodeError) {
              logger.error(backupCodeError);
            }
          }

          /* See the note on the TOTP validate route. */
          if (backupCodes && backupCodes.length > 0 && databaseProps.userId) {
            TwoFactorBackupCodeNotification.notifyCodesCreated({
              userId: databaseProps.userId,
              codeCount: backupCodes.length,
              origin: RequestOriginUtil.fromRequest(req),
            });
          }

          return Response.sendJsonObjectResponse(req, res, {
            backupCodes: backupCodes
              ? backupCodes.map((code: string) => {
                  return TwoFactorBackupCode.formatForDisplay(code);
                })
              : [],
          });
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * No route here answers anybody who is not signed in. The options for a
     * security key's prompt at sign-in used to come from one that did -
     * POST /user-webauthn/generate-authentication-options, which took an
     * email address alone and said whether it had an account with a key
     * (#9822). They now come from the sign-in itself, once the password or
     * the sign-in link has proved the account (POST
     * /identity/security-key-sign-in-options, Types/Accounts/
     * SecurityKeySignIn).
     */
  }
}
