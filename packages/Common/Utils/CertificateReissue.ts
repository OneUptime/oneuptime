import OneUptimeDate from "../Types/Date";

/*
 * The cooldown that sits behind the "Reissue SSL Certificate" button on a
 * custom domain.
 *
 * OneUptime orders certificates from Let's Encrypt against a single ACME
 * account shared by every customer on the installation, so a button that any
 * customer can press is a button that spends everybody's allowance. Two of
 * Let's Encrypt's limits are the ones this guards:
 *
 *  - 5 failed validations per account, per hostname, per hour. A domain whose
 *    CNAME is half-broken fails validation every single time, so an
 *    unthrottled button is a way to burn that hostname's whole hourly budget
 *    in seconds - including the budget the automated renewal cron needs.
 *  - 5 duplicate certificates per week for the same exact set of hostnames.
 *    A reissue is by definition a duplicate certificate: same hostname, no
 *    change. This is the limit a determined presser reaches second.
 *
 * Deliberately pure and synchronous, and deliberately in Common/Utils rather
 * than Common/Server: the dashboard renders the very same countdown the API
 * will enforce, so the button explains itself before it is pressed instead of
 * only after the request comes back rejected.
 *
 * The cooldown is keyed off when a reissue was REQUESTED, not when one
 * succeeded. A request that fails at the CA still cost a validation attempt,
 * and a failing domain is exactly the domain a frustrated customer presses
 * again - so a failed attempt must start the clock just as a successful one
 * does.
 */
export default class CertificateReissueUtil {
  /*
   * Note on the value: 24 hours permits 7 reissues a week, which is above the
   * 5-duplicate-certificates-per-week limit described above. That is a
   * deliberate choice, not an oversight - reaching it needs a customer to
   * press the button on six consecutive days, and the failure that follows is
   * a clear, temporary error from the CA rather than the sustained burst the
   * per-hour validation limit punishes. The value is a single constant so the
   * trade can be revisited in one place.
   */
  public static readonly COOLDOWN_IN_HOURS: number = 24;

  /*
   * The newest "requested at" stamp that is already out of cooldown.
   *
   * A row is eligible for another reissue when its stamp is null or is at or
   * before this instant. The server turns this into the WHERE clause it
   * claims the row with, so the comparison that decides eligibility is the
   * same one on both sides.
   */
  public static getCooldownCutoff(now: Date): Date {
    return OneUptimeDate.addRemoveHours(
      OneUptimeDate.fromString(now),
      -CertificateReissueUtil.COOLDOWN_IN_HOURS,
    );
  }

  // When the domain may be reissued again, given its last request.
  public static getNextReissueAllowedAt(lastRequestedAt: Date): Date {
    return OneUptimeDate.addRemoveHours(
      OneUptimeDate.fromString(lastRequestedAt),
      CertificateReissueUtil.COOLDOWN_IN_HOURS,
    );
  }

  /*
   * A domain that has never been reissued is never cooling down, which is why
   * null is accepted here rather than being the caller's problem.
   */
  public static isInCooldown(
    lastRequestedAt: Date | null | undefined,
    now: Date,
  ): boolean {
    if (!lastRequestedAt) {
      return false;
    }

    return OneUptimeDate.isAfter(
      CertificateReissueUtil.getNextReissueAllowedAt(lastRequestedAt),
      OneUptimeDate.fromString(now),
    );
  }

  /*
   * How much longer the customer has to wait, in words. Whole minutes, since
   * the countdown is only ever read by a person deciding whether to come back
   * later.
   */
  public static getTimeRemainingText(lastRequestedAt: Date, now: Date): string {
    const nextAllowedAt: Date =
      CertificateReissueUtil.getNextReissueAllowedAt(lastRequestedAt);

    const totalMinutes: number = Math.max(
      0,
      OneUptimeDate.getMinutesBetweenTwoDates(
        OneUptimeDate.fromString(now),
        nextAllowedAt,
      ),
    );

    if (totalMinutes < 1) {
      return "less than a minute";
    }

    const hours: number = Math.floor(totalMinutes / 60);
    const minutes: number = totalMinutes % 60;

    const parts: Array<string> = [];

    if (hours > 0) {
      parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
    }

    if (minutes > 0) {
      parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
    }

    return parts.join(" ");
  }

  /*
   * The one sentence the API returns and the dashboard shows. Kept here so a
   * customer reads the same explanation wherever they hit the limit.
   */
  public static getCooldownMessage(lastRequestedAt: Date, now: Date): string {
    return `A certificate reissue was already requested for this domain in the last ${CertificateReissueUtil.COOLDOWN_IN_HOURS} hours. Certificates are issued by Let's Encrypt, which rate limits how often the same domain can be issued, so a reissue can only be requested once every ${CertificateReissueUtil.COOLDOWN_IN_HOURS} hours. Please try again in ${CertificateReissueUtil.getTimeRemainingText(lastRequestedAt, now)}.`;
  }
}
