import GlobalCache from "../../Infrastructure/GlobalCache";
import ObjectID from "../../../Types/ObjectID";
import logger from "../Logger";

/*
 * A PAGE AGAIN BETWEEN ITS CLOCK STOP AND ITS START (issue #8549).
 *
 * A page again is claimed by stopping its run's acknowledgement clock
 * (stopAcknowledgementTimeoutClock), so two ticks page again once; then
 * its run is written (startPageAgain), and its start kept in flight until
 * its rule is recorded (OnCallLevelsInFlight, issue #8514). A process that
 * stopped between the clock stop and that start - a deploy, an OOM kill -
 * left the clock stopped and, with no run, nobody to page, or a run with no
 * start, which the stuck-run job handed over from the policy's first level.
 * Either way the person who acknowledged was never reminded.
 *
 * So each page again is kept here, in Redis, from just before its clock
 * stop until its start is kept: the clock's moment, where it starts, who
 * acknowledged, and its run once written. The page-again tick settles one
 * still here SETTLE_AFTER_MS after its claim (OnCallAcknowledgementTimeout):
 * a run never written has its clock given back, and is paged again by that
 * very tick; a run written has its start kept, for the stuck-run job and
 * the policy-run worker to start it from where it starts.
 *
 * Only the page-again tick stops a clock, one tick at a time, so the page
 * agains in flight are kept together, under one key. Nothing here throws:
 * a Redis that is down keeps nothing, and the window is open as it was.
 */

export interface OnCallPageAgainClaim {
  // When the clock was stopped: the claim.
  claimedAt: Date;
  // The clock's moment, which a give-back puts back.
  clockStartedAt: Date;
  pageAgainNumber: number;
  // What its start needs (OnCallLevelsInFlight's pageAgain), and when it was due.
  startAtRuleId: string | null;
  acknowledgedByUserId: string | null;
  minutes: number;
  dueAt: Date;
  // Its run, once written.
  pageAgainRunId: string | null;
}

// A claim kept in Redis: its moments in milliseconds since the epoch.
type KeptClaim = {
  claimedAt: number;
  clockStartedAt: number;
  pageAgainNumber: number;
  startAtRuleId: string | null;
  acknowledgedByUserId: string | null;
  minutes: number;
  dueAt: number;
  pageAgainRunId: string | null;
};

export class OnCallPageAgainClaims {
  public readonly CACHE_NAMESPACE: string = "on-call-pages-again-in-flight";

  // Every page again in flight, under one key.
  public readonly CACHE_KEY: string = "claims";

  // Six hours: far longer than any page again takes to start.
  public readonly CACHE_EXPIRES_IN_SECONDS: number = 6 * 60 * 60;

  /*
   * How long after its claim a page again is left to start: it writes its
   * run and keeps its start in seconds, and a tick runs every minute - at
   * about the same second, so with a tick's slack.
   */
  public readonly SETTLE_AFTER_MS: number = 2 * 60 * 1000;
  public readonly TICK_SLACK_MS: number = 30 * 1000;

  // Every page again in flight, by the run whose clock it stopped. None when Redis cannot be read.
  public async readAll(): Promise<Map<string, OnCallPageAgainClaim>> {
    try {
      return await this.readKept();
    } catch (err) {
      logger.debug(
        `Could not read the pages again in flight; settling none of them: ${err}`,
      );
      return new Map();
    }
  }

  // Keeps the run's page again in flight: before its clock stop, and as it goes on.
  public async keep(
    runId: ObjectID | null | undefined,
    claim: OnCallPageAgainClaim,
  ): Promise<void> {
    if (!runId) {
      return;
    }

    await this.write((claims: Map<string, OnCallPageAgainClaim>) => {
      claims.set(runId.toString(), claim);
    });
  }

  // Forgets it: its start was kept, or it was settled.
  public async forget(runId: ObjectID | null | undefined): Promise<void> {
    if (!runId) {
      return;
    }

    await this.write((claims: Map<string, OnCallPageAgainClaim>) => {
      claims.delete(runId.toString());
    });
  }

  // Whether a page again in flight never started, and is settled now.
  public isToSettle(claim: OnCallPageAgainClaim, now: Date): boolean {
    return (
      now.getTime() - claim.claimedAt.getTime() >=
      this.SETTLE_AFTER_MS - this.TICK_SLACK_MS
    );
  }

  // What Redis holds. Throws when it cannot be read; a value that cannot be parsed holds nothing.
  private async readKept(): Promise<Map<string, OnCallPageAgainClaim>> {
    const claims: Map<string, OnCallPageAgainClaim> = new Map();

    const value: string | null = await GlobalCache.getString(
      this.CACHE_NAMESPACE,
      this.CACHE_KEY,
    );

    if (!value) {
      return claims;
    }

    let kept: unknown = null;

    try {
      kept = JSON.parse(value);
    } catch {
      return claims;
    }

    if (!kept || typeof kept !== "object" || Array.isArray(kept)) {
      return claims;
    }

    for (const [runId, entry] of Object.entries(
      kept as Record<string, unknown>,
    )) {
      const claim: OnCallPageAgainClaim | null = this.fromKept(entry);

      if (claim) {
        claims.set(runId, claim);
      }
    }

    return claims;
  }

  /*
   * Changes what Redis holds. A read that fails writes nothing: written
   * over what could not be read, the other pages again in flight would be
   * lost.
   */
  private async write(
    change: (claims: Map<string, OnCallPageAgainClaim>) => void,
  ): Promise<void> {
    try {
      const claims: Map<string, OnCallPageAgainClaim> = await this.readKept();
      change(claims);

      if (claims.size === 0) {
        await GlobalCache.deleteKey(this.CACHE_NAMESPACE, this.CACHE_KEY);
        return;
      }

      const kept: Record<string, KeptClaim> = {};

      for (const [runId, claim] of claims) {
        kept[runId] = {
          claimedAt: claim.claimedAt.getTime(),
          clockStartedAt: claim.clockStartedAt.getTime(),
          pageAgainNumber: claim.pageAgainNumber,
          startAtRuleId: claim.startAtRuleId,
          acknowledgedByUserId: claim.acknowledgedByUserId,
          minutes: claim.minutes,
          dueAt: claim.dueAt.getTime(),
          pageAgainRunId: claim.pageAgainRunId,
        };
      }

      await GlobalCache.setString(
        this.CACHE_NAMESPACE,
        this.CACHE_KEY,
        JSON.stringify(kept),
        {
          expiresInSeconds: this.CACHE_EXPIRES_IN_SECONDS,
        },
      );
    } catch (err) {
      logger.debug(`Could not keep the pages again in flight: ${err}`);
    }
  }

  private fromKept(entry: unknown): OnCallPageAgainClaim | null {
    const kept: Partial<KeptClaim> = (entry || {}) as Partial<KeptClaim>;

    const isMoment: (value: unknown) => boolean = (value: unknown): boolean => {
      return typeof value === "number" && Number.isFinite(value) && value > 0;
    };

    const textOrNull: (value: unknown) => string | null = (
      value: unknown,
    ): string | null => {
      return typeof value === "string" && value ? value : null;
    };

    if (
      !isMoment(kept.claimedAt) ||
      !isMoment(kept.clockStartedAt) ||
      !isMoment(kept.dueAt) ||
      typeof kept.pageAgainNumber !== "number" ||
      typeof kept.minutes !== "number"
    ) {
      return null;
    }

    return {
      claimedAt: new Date(kept.claimedAt as number),
      clockStartedAt: new Date(kept.clockStartedAt as number),
      pageAgainNumber: kept.pageAgainNumber,
      startAtRuleId: textOrNull(kept.startAtRuleId),
      acknowledgedByUserId: textOrNull(kept.acknowledgedByUserId),
      minutes: kept.minutes,
      dueAt: new Date(kept.dueAt as number),
      pageAgainRunId: textOrNull(kept.pageAgainRunId),
    };
  }
}

const OnCallPageAgainClaimsInFlight: OnCallPageAgainClaims =
  new OnCallPageAgainClaims();

export default OnCallPageAgainClaimsInFlight;
