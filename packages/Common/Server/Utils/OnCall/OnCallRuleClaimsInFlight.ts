import GlobalCache from "../../Infrastructure/GlobalCache";
import ObjectID from "../../../Types/ObjectID";
import logger from "../Logger";

/*
 * A NOTIFICATION RULE'S CLAIM WHILE ITS PAGE IS ON ITS WAY (issue #8407).
 *
 * UserNotificationRuleService.executeNotificationRuleItem claims a rule on
 * the person's log (executedNotificationRules) before it sends it, so two
 * ticks never send it twice, and gives the claim back when the send fails
 * before anything of it reached a sender (OnCallSendAttempt), so the next
 * tick sends it. Two things can still keep a claim with nothing sent: the
 * give-back itself failing - the database that failed the send is often
 * still failing - and the process stopping between the claim and the send
 * (a restart, a crash), when no catch runs at all.
 *
 * So the claim is kept here, in Redis, while the page is on its way: from
 * just before the claim until the send is handed over, or the claim is
 * given back. One still here later is a page that never finished, and the
 * person's-log worker settles it at the log's next try
 * (UserOnCallLogService.settleRuleClaimInFlight): a claim whose page
 * reached no sender - one it was owed back, or one with no notification
 * row written since it was taken - is given back, and the rule is sent
 * once; one with a row may have been sent, and keeps its claim.
 *
 * One claim per log: a log's rules are sent one after another, by one tick
 * at a time. Kept well past any page, and nothing here throws - a Redis
 * that is down keeps nothing, and a claim lost then is lost as it always
 * was.
 */

export interface OnCallRuleClaimInFlight {
  // The claim's key in executedNotificationRules: the rule's id, or a repeat's key.
  claimKey: string;
  // The rule it sends.
  ruleId: string;
  // When it was claimed: the value the claim holds.
  claimedAt: Date;
  /*
   * Its send failed before anything of it reached a sender, and giving the
   * claim back failed too: it is given back without looking for a row.
   */
  owed: boolean;
}

// A claim kept in Redis: its moment in milliseconds since the epoch.
type KeptClaim = {
  claimKey: string;
  ruleId: string;
  claimedAt: number;
  owed: boolean;
};

export class OnCallRuleClaims {
  public readonly CACHE_NAMESPACE: string = "on-call-rule-claims-in-flight";

  // Six hours: far longer than any page is on its way.
  public readonly CACHE_EXPIRES_IN_SECONDS: number = 6 * 60 * 60;

  /*
   * How long a claim is left to its page before the worker settles it: a
   * page is on its way for seconds, and a tick runs every minute.
   */
  public readonly SETTLE_AFTER_MS: number = 2 * 60 * 1000;

  // The claim in flight of each of `logIds` that has one, by its id: one round trip.
  public async read(
    logIds: Array<ObjectID | null | undefined>,
  ): Promise<Map<string, OnCallRuleClaimInFlight>> {
    const claims: Map<string, OnCallRuleClaimInFlight> = new Map();
    const keys: Array<string> = logIds
      .filter((id: ObjectID | null | undefined): id is ObjectID => {
        return Boolean(id);
      })
      .map((id: ObjectID): string => {
        return id.toString();
      });

    if (keys.length === 0) {
      return claims;
    }

    try {
      const values: Array<string | null> = await GlobalCache.getStrings(
        this.CACHE_NAMESPACE,
        keys,
      );

      keys.forEach((key: string, index: number) => {
        const claim: OnCallRuleClaimInFlight | null = this.fromCacheValue(
          values[index] || null,
        );

        if (claim) {
          claims.set(key, claim);
        }
      });
    } catch (err) {
      logger.debug(
        `Could not read the notification rule claims in flight of a page of on-call logs; settling none of them: ${err}`,
      );
    }

    return claims;
  }

  // Keeps the log's claim in flight: before the claim, and again when it is owed back.
  public async keep(
    logId: ObjectID | null | undefined,
    claim: OnCallRuleClaimInFlight,
  ): Promise<void> {
    if (!logId) {
      return;
    }

    try {
      await GlobalCache.setString(
        this.CACHE_NAMESPACE,
        logId.toString(),
        this.toCacheValue(claim),
        {
          expiresInSeconds: this.CACHE_EXPIRES_IN_SECONDS,
        },
      );
    } catch (err) {
      logger.debug(
        `Could not keep the notification rule claim in flight of on-call log ${logId.toString()}: ${err}`,
      );
    }
  }

  // Forgets it: its page was handed over, or its claim given back.
  public async forget(logId: ObjectID | null | undefined): Promise<void> {
    if (!logId) {
      return;
    }

    try {
      await GlobalCache.deleteKey(this.CACHE_NAMESPACE, logId.toString());
    } catch (err) {
      logger.debug(
        `Could not forget the notification rule claim in flight of on-call log ${logId.toString()}: ${err}`,
      );
    }
  }

  // Whether the claim was taken at the moment `value` - a claim's value - says.
  public isClaimTakenAt(
    claim: OnCallRuleClaimInFlight,
    value: unknown,
  ): boolean {
    return (
      (typeof value === "string" || value instanceof Date) &&
      new Date(value).getTime() === claim.claimedAt.getTime()
    );
  }

  public toCacheValue(claim: OnCallRuleClaimInFlight): string {
    const kept: KeptClaim = {
      claimKey: claim.claimKey,
      ruleId: claim.ruleId,
      claimedAt: claim.claimedAt.getTime(),
      owed: claim.owed,
    };

    return JSON.stringify(kept);
  }

  // What was kept, or null for nothing, or for something that is not a claim.
  public fromCacheValue(
    value: string | null | undefined,
  ): OnCallRuleClaimInFlight | null {
    if (!value) {
      return null;
    }

    try {
      const kept: Partial<KeptClaim> = JSON.parse(value) as Partial<KeptClaim>;

      if (
        !kept ||
        typeof kept !== "object" ||
        typeof kept.claimKey !== "string" ||
        !kept.claimKey ||
        typeof kept.ruleId !== "string" ||
        !kept.ruleId ||
        typeof kept.claimedAt !== "number" ||
        !Number.isFinite(kept.claimedAt) ||
        kept.claimedAt <= 0
      ) {
        return null;
      }

      return {
        claimKey: kept.claimKey,
        ruleId: kept.ruleId,
        claimedAt: new Date(kept.claimedAt),
        owed: kept.owed === true,
      };
    } catch {
      return null;
    }
  }
}

const OnCallRuleClaimsInFlight: OnCallRuleClaims = new OnCallRuleClaims();

export default OnCallRuleClaimsInFlight;
