import ObjectID from "../../Types/ObjectID";
import Hostname from "../../Types/API/Hostname";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import OneUptimeDate from "../../Types/Date";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import { DashboardRoute } from "../../ServiceRoute";
import DatabaseConfig from "../DatabaseConfig";
import MailService from "../Services/MailService";
import UserService from "../Services/UserService";
import User from "../../Models/DatabaseModels/User";
import UserMiddleware from "../Middleware/UserAuthorization";
import UserTwoFactorBackupCodeService, {
  Service as UserTwoFactorBackupCodeServiceType,
  TwoFactorBackupCodeStatus,
} from "../Services/UserTwoFactorBackupCodeService";
import TwoFactorBackupCode from "../Utils/TwoFactorBackupCode";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import BaseAPI from "./BaseAPI";
import UserTwoFactorBackupCode from "../../Models/DatabaseModels/UserTwoFactorBackupCode";
import NotAuthenticatedException from "../../Types/Exception/NotAuthenticatedException";
import Response from "../Utils/Response";
import logger from "../Utils/Logger";

/**
 * The two routes a signed-in user needs to manage their recovery codes.
 *
 * Both act on the CALLER's own codes and nobody else's. There is deliberately
 * no `:userId` parameter anywhere here: the owner is read from the validated
 * access token, so there is no id for a caller to substitute and no ownership
 * check to get wrong. `UserMiddleware.getUserMiddleware` is what puts it
 * there.
 */
export default class UserTwoFactorBackupCodeAPI extends BaseAPI<
  UserTwoFactorBackupCode,
  UserTwoFactorBackupCodeServiceType
> {
  public constructor() {
    super(UserTwoFactorBackupCode, UserTwoFactorBackupCodeService);

    const crudApiPath: string =
      new this.entityType().getCrudApiPath()?.toString() || "";

    /*
     * Mint a fresh set and return the plaintext codes.
     *
     * THIS RESPONSE IS THE ONLY COPY. Nothing is stored but keyed digests, so
     * if the user closes the tab the codes are gone -- not recoverable by
     * them, by an operator, or by anybody with the database. The UI is
     * expected to make that unmissable, and the count of a previous set is
     * returned alongside so the page can say what was just invalidated.
     *
     * It is a POST because it is destructive: calling it throws away every
     * code the user was previously holding. A GET that silently voided a
     * printed list -- on a browser prefetch, say -- would be a lockout with no
     * user action behind it.
     *
     * NOT gated on `enableTwoFactorAuth`. Generating codes before turning two
     * factor auth on is the sensible order to do it in, and refusing here
     * would push users into the exact sequence -- enable first, find recovery
     * later -- that produces the lost-device support ticket this whole feature
     * exists to prevent.
     */
    this.router.post(
      `${crudApiPath}/generate`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const userId: ObjectID =
            UserTwoFactorBackupCodeAPI.getCurrentUserId(req);

          const previousStatus: TwoFactorBackupCodeStatus =
            await UserTwoFactorBackupCodeService.getStatusForUser({
              userId: userId,
            });

          const codes: Array<string> =
            await UserTwoFactorBackupCodeService.regenerateForUser({
              userId: userId,
            });

          /*
           * The codes themselves are NEVER logged -- they are sign-in
           * credentials, and logger output reaches stdout, the recent-log
           * buffer and telemetry at once. The fact that a set was minted is
           * worth recording: it is how an operator later reconstructs "who
           * invalidated the codes this user says they had".
           */
          logger.info(
            `Two factor backup codes regenerated for user: ${userId.toString()}`,
          );

          /*
           * Tell the account holder, at their address rather than in this
           * browser.
           *
           * This route is the destructive one and it is the one with the least
           * standing in front of it: a session alone -- no password, no second
           * factor -- silently voids every recovery code the user is holding.
           * Somebody who has stolen a session can therefore remove the owner's
           * way back in and leave no trace the owner would ever look at, and
           * the owner finds out at the next sign-in they cannot complete.
           *
           * The mail does not prevent that; it makes it visible, which is the
           * same bargain `sendTwoFactorBackupCodeUsedEmail` strikes on the
           * login path. Re-prompting for the password here would be stronger
           * still, and is the obvious next step -- it needs a re-authentication
           * mechanism this codebase does not have yet, so it is deliberately
           * not invented on this route alone.
           *
           * Detached and never awaited: an unreachable mail server must not
           * fail a regeneration that has already replaced the user's codes,
           * because the response carries the only copy of the new ones.
           */
          UserTwoFactorBackupCodeAPI.notifyCodesRegenerated({
            userId: userId,
            newCodeCount: codes.length,
          }).catch((err: Error) => {
            logger.error(err);
          });

          return Response.sendJsonObjectResponse(req, res, {
            /*
             * Hyphenated for the page to render as-is. The verify route
             * normalizes whatever comes back, so a user may type them with
             * the hyphen, without it, or with whatever spacing their password
             * manager pasted in.
             */
            codes: codes.map((code: string) => {
              return TwoFactorBackupCode.formatForDisplay(code);
            }),
            replacedCodeCount: previousStatus.total,
          });
        } catch (err) {
          return next(err);
        }
      },
    );

    /*
     * How many codes the caller has left.
     *
     * Carries no code material of any kind -- three numbers and a date -- so
     * it is safe for the profile page to poll and safe to render anywhere a
     * session already exists.
     */
    this.router.get(
      `${crudApiPath}/status`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const userId: ObjectID =
            UserTwoFactorBackupCodeAPI.getCurrentUserId(req);

          const status: TwoFactorBackupCodeStatus =
            await UserTwoFactorBackupCodeService.getStatusForUser({
              userId: userId,
            });

          /*
           * A stale "you have 8 codes left" served out of a browser cache
           * after the user has just regenerated is a user who thinks the
           * button did nothing.
           */
          Response.setNoCacheHeaders(res);

          return Response.sendJsonObjectResponse(req, res, {
            total: status.total,
            unused: status.unused,
            generatedAt: status.generatedAt
              ? status.generatedAt.toISOString()
              : null,
          });
        } catch (err) {
          return next(err);
        }
      },
    );
  }

  /**
   * Mail the owner that their backup codes were replaced.
   *
   * Separate from the handler so the handler stays readable, and `private
   * static` because nothing outside this route should be announcing a
   * regeneration that did not happen here.
   *
   * Reads the address itself rather than taking it from the request: the only
   * thing the caller proved is which user they are, and the address this goes
   * to has to be the one on the account, not one they supplied.
   */
  private static async notifyCodesRegenerated(data: {
    userId: ObjectID;
    newCodeCount: number;
  }): Promise<void> {
    const user: User | null = await UserService.findOneById({
      id: data.userId,
      select: {
        email: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user || !user.email) {
      return;
    }

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    await MailService.sendMail({
      toEmail: user.email,
      subject: "Your OneUptime two factor backup codes were replaced",
      templateType: EmailTemplateType.TwoFactorBackupCodesRegenerated,
      vars: {
        generatedAt: OneUptimeDate.getCurrentDateAsFormattedString(),
        newCodeCount: data.newCodeCount.toString(),
        twoFactorAuthUrl: new URL(
          httpProtocol,
          host,
          new Route(DashboardRoute.toString()).addRoute(
            "/user-profile/two-factor-auth",
          ),
        ).toString(),
        homeUrl: new URL(httpProtocol, host).toString(),
      },
    });
  }

  /**
   * The signed-in caller, from the token the middleware validated.
   *
   * Throws rather than returning null: every route in this file acts on the
   * caller's own credentials, so "no caller" is not a case any of them can
   * meaningfully proceed with. The middleware ahead of them should already
   * have refused, which makes this a second lock rather than the first.
   */
  private static getCurrentUserId(req: ExpressRequest): ObjectID {
    const userId: ObjectID | undefined = (req as OneUptimeRequest)
      .userAuthorization?.userId;

    if (!userId) {
      throw new NotAuthenticatedException(
        "You are not authenticated. Please sign in.",
      );
    }

    return userId;
  }
}
