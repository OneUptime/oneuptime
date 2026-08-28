import ObjectID from "../../Types/ObjectID";
import UserMiddleware from "../Middleware/UserAuthorization";
import UserTotpAuthService, {
  Service as UserTotpAuthServiceType,
} from "../Services/UserTotpAuthService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import BaseAPI from "./BaseAPI";
import UserTotpAuth from "../../Models/DatabaseModels/UserTotpAuth";
import BadDataException from "../../Types/Exception/BadDataException";
import TotpAuth from "../Utils/TotpAuth";
import TwoFactorBackupCode from "../Utils/TwoFactorBackupCode";
import Response from "../Utils/Response";
import User from "../../Models/DatabaseModels/User";
import UserService from "../Services/UserService";
import UserTwoFactorBackupCodeService from "../Services/UserTwoFactorBackupCodeService";
import logger from "../Utils/Logger";
import TwoFactorBackupCodeNotification from "../Utils/TwoFactorBackupCodeNotification";

export default class UserTotpAuthAPI extends BaseAPI<
  UserTotpAuth,
  UserTotpAuthServiceType
> {
  public constructor() {
    super(UserTotpAuth, UserTotpAuthService);

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/validate`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const userTotpAuth: UserTotpAuth | null =
            await UserTotpAuthService.findOneById({
              id: new ObjectID(req.body["id"]),
              select: {
                twoFactorSecret: true,
                userId: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!userTotpAuth) {
            throw new BadDataException("TOTP auth not found");
          }

          if (
            userTotpAuth.userId?.toString() !==
            (req as OneUptimeRequest).userAuthorization?.userId.toString()
          ) {
            throw new BadDataException("Two factor auth not found");
          }

          if (!userTotpAuth.userId) {
            throw new BadDataException("User not found");
          }

          // get user email.
          const user: User | null = await UserService.findOneById({
            id: userTotpAuth.userId!,
            select: {
              email: true,
            },
            props: {
              isRoot: true,
            },
          });

          if (!user) {
            throw new BadDataException("User not found");
          }

          if (!user.email) {
            throw new BadDataException("User email not found");
          }

          const isValid: boolean = TotpAuth.verifyToken({
            secret: userTotpAuth.twoFactorSecret || "",
            token: req.body["code"] || "",
            email: user.email!,
          });

          if (!isValid) {
            throw new BadDataException("Invalid code");
          }

          // update this 2fa code as verified

          await UserTotpAuthService.updateOneById({
            id: userTotpAuth.id!,
            data: {
              isVerified: true,
            },
            props: {
              isRoot: true,
            },
          });

          /*
           * The account now has a second factor, which means it now has
           * something to lose. Mint the recovery codes here rather than
           * leaving them to a button the user has to go and find: a set that
           * is never generated is the same as no recovery route at all, which
           * is the state this endpoint used to leave every account in.
           *
           * `generateForUserIfNone` and not a regeneration -- adding a SECOND
           * authenticator app must not void the codes the user printed when
           * they added the first. It returns null in that case and the
           * response simply carries no codes.
           *
           * THE RESPONSE IS THE ONLY COPY. Only keyed digests are stored, so
           * whatever is returned here is the one and only time these strings
           * exist; the profile page is expected to raise the same
           * acknowledge-before-closing modal it raises for a manual
           * regeneration. That is also why nothing is minted anywhere the user
           * is not looking at a screen that can show it.
           *
           * A failure to mint must not fail the validation. The factor IS
           * verified by this point -- the row is written -- so throwing here
           * would tell the user their authenticator did not work when it did,
           * and send them round the enrolment loop again. The profile card
           * already warns an account holding no codes, so the fallback is a
           * state the product knows how to talk about.
           */
          let backupCodes: Array<string> | null = null;

          try {
            backupCodes =
              await UserTwoFactorBackupCodeService.generateForUserIfNone({
                userId: userTotpAuth.userId!,
              });
          } catch (backupCodeError) {
            logger.error(backupCodeError);
          }

          /*
           * Tell the account holder, at their address rather than in this
           * browser. Ten sign-in credentials have just come into existence on
           * this account, and this route is authenticated by a session alone
           * -- so a stolen session is enough to create them. The mail does not
           * prevent that; it makes it visible to the person it was done to.
           */
          if (backupCodes && backupCodes.length > 0) {
            TwoFactorBackupCodeNotification.notifyCodesCreated({
              userId: userTotpAuth.userId!,
              codeCount: backupCodes.length,
            });
          }

          return Response.sendJsonObjectResponse(req, res, {
            /*
             * Hyphenated for the page to render as-is, exactly as the
             * regenerate route does. The verify route normalizes whatever
             * comes back.
             */
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
  }
}
