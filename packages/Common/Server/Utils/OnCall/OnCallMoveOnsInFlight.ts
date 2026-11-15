import GlobalCache from "../../Infrastructure/GlobalCache";
import ObjectID from "../../../Types/ObjectID";
import logger from "../Logger";

/*
 * A RUN'S MOVE ON WHILE IT IS UNDER WAY (issue #8410).
 *
 * A run is moved on to its next escalation rule (OnCallEscalationAdvance)
 * by a claim first: one conditional UPDATE that moves the run's
 * lastEscalationRuleExecutedAt to the moment of the claim. The same column
 * starts the wait of the rule the run is on, so a move that stops after
 * its claim and before its next rule is recorded leaves the run to wait
 * that rule's whole wait again - half an hour, say - before it moves on. A
 * move that fails gives its claim back (giveBackEscalationAdvance); a
 * process that stops there (a deploy, an OOM kill) never did.
 *
 * So what giving the claim back needs is kept here, in Redis, while the
 * move is under way: from just before the claim until the move is done,
 * or its claim is given back. One still here GIVE_BACK_AFTER_MS after its
 * claim never finished, and the policy-run worker gives its claim back at
 * the run's next try - only while the run is still as the claim left it,
 * so a move whose next rule started keeps it - and moves the run on then.
 *
 * One per run: a run moves on one step at a time. Nothing here throws - a
 * Redis that is down keeps nothing, and the run waits its rule's wait
 * again, as it always did.
 */

export interface OnCallMoveOnInFlight {
  // The moment the claim wrote on the run.
  claimedAt: Date;
  // What the claim found there, and a give-back puts back.
  previousLastEscalationRuleExecutedAt: Date | null;
  // The rule the run was on, and its pass, when it was claimed.
  lastExecutedEscalationRuleId: string | null;
  onCallPolicyExecutionRepeatCount: number | null;
}

// A move on kept in Redis: its moments in milliseconds since the epoch.
type KeptMoveOn = {
  claimedAt: number;
  previousLastEscalationRuleExecutedAt: number | null;
  lastExecutedEscalationRuleId: string | null;
  onCallPolicyExecutionRepeatCount: number | null;
};

export class OnCallMoveOns {
  public readonly CACHE_NAMESPACE: string = "on-call-move-ons-in-flight";

  // Six hours: far longer than any move on takes.
  public readonly CACHE_EXPIRES_IN_SECONDS: number = 6 * 60 * 60;

  /*
   * How long after its claim a move on is left to finish: it reads the next
   * rule and records it in seconds, and a tick runs every minute.
   */
  public readonly GIVE_BACK_AFTER_MS: number = 2 * 60 * 1000;

  // The move on in flight of each of `runIds` that has one, by its id: one round trip.
  public async read(
    runIds: Array<ObjectID | null | undefined>,
  ): Promise<Map<string, OnCallMoveOnInFlight>> {
    const moveOns: Map<string, OnCallMoveOnInFlight> = new Map();
    const keys: Array<string> = runIds
      .filter((id: ObjectID | null | undefined): id is ObjectID => {
        return Boolean(id);
      })
      .map((id: ObjectID): string => {
        return id.toString();
      });

    if (keys.length === 0) {
      return moveOns;
    }

    try {
      const values: Array<string | null> = await GlobalCache.getStrings(
        this.CACHE_NAMESPACE,
        keys,
      );

      keys.forEach((key: string, index: number) => {
        const moveOn: OnCallMoveOnInFlight | null = this.fromCacheValue(
          values[index] || null,
        );

        if (moveOn) {
          moveOns.set(key, moveOn);
        }
      });
    } catch (err) {
      logger.debug(
        `Could not read the move-ons in flight of a page of on-call runs; giving none of them back: ${err}`,
      );
    }

    return moveOns;
  }

  // Keeps the run's move on in flight, just before its claim.
  public async keep(
    runId: ObjectID | null | undefined,
    moveOn: OnCallMoveOnInFlight,
  ): Promise<void> {
    if (!runId) {
      return;
    }

    try {
      await GlobalCache.setString(
        this.CACHE_NAMESPACE,
        runId.toString(),
        this.toCacheValue(moveOn),
        {
          expiresInSeconds: this.CACHE_EXPIRES_IN_SECONDS,
        },
      );
    } catch (err) {
      logger.debug(
        `Could not keep the move-on in flight of on-call run ${runId.toString()}: ${err}`,
      );
    }
  }

  // Forgets it: the move is done, or its claim was given back.
  public async forget(runId: ObjectID | null | undefined): Promise<void> {
    if (!runId) {
      return;
    }

    try {
      await GlobalCache.deleteKey(this.CACHE_NAMESPACE, runId.toString());
    } catch (err) {
      logger.debug(
        `Could not forget the move-on in flight of on-call run ${runId.toString()}: ${err}`,
      );
    }
  }

  // Whether a move on in flight never finished, and its claim is given back now.
  public isToGiveBack(moveOn: OnCallMoveOnInFlight, now: Date): boolean {
    return (
      now.getTime() - moveOn.claimedAt.getTime() >= this.GIVE_BACK_AFTER_MS
    );
  }

  public toCacheValue(moveOn: OnCallMoveOnInFlight): string {
    const kept: KeptMoveOn = {
      claimedAt: moveOn.claimedAt.getTime(),
      previousLastEscalationRuleExecutedAt:
        moveOn.previousLastEscalationRuleExecutedAt
          ? moveOn.previousLastEscalationRuleExecutedAt.getTime()
          : null,
      lastExecutedEscalationRuleId: moveOn.lastExecutedEscalationRuleId,
      onCallPolicyExecutionRepeatCount: moveOn.onCallPolicyExecutionRepeatCount,
    };

    return JSON.stringify(kept);
  }

  // What was kept, or null for nothing, or for something that is not a move on.
  public fromCacheValue(
    value: string | null | undefined,
  ): OnCallMoveOnInFlight | null {
    if (!value) {
      return null;
    }

    try {
      const kept: Partial<KeptMoveOn> = JSON.parse(
        value,
      ) as Partial<KeptMoveOn>;

      if (
        !kept ||
        typeof kept !== "object" ||
        !this.isMoment(kept.claimedAt) ||
        (kept.previousLastEscalationRuleExecutedAt !== null &&
          !this.isMoment(kept.previousLastEscalationRuleExecutedAt)) ||
        (kept.lastExecutedEscalationRuleId !== null &&
          typeof kept.lastExecutedEscalationRuleId !== "string") ||
        (kept.onCallPolicyExecutionRepeatCount !== null &&
          typeof kept.onCallPolicyExecutionRepeatCount !== "number")
      ) {
        return null;
      }

      return {
        claimedAt: new Date(kept.claimedAt as number),
        previousLastEscalationRuleExecutedAt:
          kept.previousLastEscalationRuleExecutedAt
            ? new Date(kept.previousLastEscalationRuleExecutedAt)
            : null,
        lastExecutedEscalationRuleId: kept.lastExecutedEscalationRuleId || null,
        onCallPolicyExecutionRepeatCount:
          kept.onCallPolicyExecutionRepeatCount ?? null,
      };
    } catch {
      return null;
    }
  }

  private isMoment(value: unknown): boolean {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
  }
}

const OnCallMoveOnsInFlight: OnCallMoveOns = new OnCallMoveOns();

export default OnCallMoveOnsInFlight;
