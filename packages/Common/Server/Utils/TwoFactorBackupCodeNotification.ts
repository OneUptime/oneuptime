import Hostname from "../../Types/API/Hostname";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import OneUptimeDate from "../../Types/Date";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import ObjectID from "../../Types/ObjectID";
import { DashboardRoute } from "../../ServiceRoute";
import User from "../../Models/DatabaseModels/User";
import DatabaseConfig from "../DatabaseConfig";
import MailService from "../Services/MailService";
import UserService from "../Services/UserService";
import logger from "./Logger";

/**
 * Tell the account holder, at their own address, that a set of recovery codes
 * was just created for them.
 *
 * WHY THIS EXISTS AT ALL
 *
 * Backup codes are sign-in credentials. The self-service regenerate route has
 * always mailed the owner when a set changed -- not to prevent anything, but
 * so that a change the owner did not make is VISIBLE to them, at an address
 * rather than in the browser that made it. Enrolment now mints codes too, and
 * it mints them on a route authenticated by a session alone: somebody holding
 * a stolen session can register a security key of their own and walk away with
 * ten recovery codes for an account they do not own. Without this mail the
 * real owner finds out at the sign-in they cannot complete.
 *
 * NOTHING SENSITIVE TRAVELS. The codes themselves are never mailed -- a count
 * and a timestamp, and a link to the page where the owner can replace the set.
 * Mailing a recovery credential would hand the account to whoever later reads
 * the mailbox, which is exactly the second factor's job to prevent.
 *
 * NEVER FATAL. Every caller invokes this without awaiting it. The codes are
 * already written and already on their way to the user's screen by the time it
 * runs, so an unreachable mail server must not fail the request that carries
 * the only copy of them.
 */
export default class TwoFactorBackupCodeNotification {
  public static async sendCodesCreatedEmail(data: {
    userId: ObjectID;
    codeCount: number;
  }): Promise<void> {
    /*
     * The address is read off the account rather than taken from the caller.
     * The caller proved which user they are; it did not prove where that
     * user's mail should go, and this notice is worth nothing if it can be
     * pointed somewhere else.
     */
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
      subject: "Backup codes were created for your OneUptime account",
      templateType: EmailTemplateType.TwoFactorBackupCodesCreated,
      vars: {
        generatedAt: OneUptimeDate.getCurrentDateAsFormattedString(),
        newCodeCount: data.codeCount.toString(),
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
   * Fire-and-forget wrapper, so a caller does not have to repeat the same
   * detached-and-logged shape at every mint site.
   *
   * Deliberately returns void rather than the promise: a caller holding one
   * would be tempted to await it, and awaiting is the thing this must never
   * do. The mint sites run inside requests whose response carries the only
   * copy of the codes.
   */
  public static notifyCodesCreated(data: {
    userId: ObjectID;
    codeCount: number;
  }): void {
    TwoFactorBackupCodeNotification.sendCodesCreatedEmail(data).catch(
      (err: Error) => {
        logger.error(err);
      },
    );
  }
}
