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
import BadDataException from "../../Types/Exception/BadDataException";
import Response from "../Utils/Response";
import { JSONObject } from "../../Types/JSON";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import UserTwoFactorBackupCodeService from "../Services/UserTwoFactorBackupCodeService";
import TwoFactorBackupCode from "../Utils/TwoFactorBackupCode";
import logger from "../Utils/Logger";
import TwoFactorBackupCodeNotification from "../Utils/TwoFactorBackupCodeNotification";

export default class UserWebAuthnAPI extends BaseAPI<
  UserWebAuthn,
  UserWebAuthnServiceType
> {
  public constructor() {
    super(UserWebAuthn, UserWebAuthnService);

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/generate-registration-options`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const userId: ObjectID = (req as OneUptimeRequest).userAuthorization!
            .userId;

          const result: { options: any; challenge: string } =
            await UserWebAuthnService.generateRegistrationOptions({
              userId: userId,
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

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/generate-authentication-options`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const data: JSONObject = req.body["data"] as JSONObject;

          if (!data) {
            throw new BadDataException("Data is required");
          }

          const email: string | undefined = data["email"] as string | undefined;

          if (!email) {
            throw new BadDataException("Email is required");
          }

          const result: { options: any; challenge: string; userId: string } =
            await UserWebAuthnService.generateAuthenticationOptions({
              email: email,
            });

          return Response.sendJsonObjectResponse(req, res, result);
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
