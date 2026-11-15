import GlobalCache from "../../Infrastructure/GlobalCache";
import ObjectID from "../../../Types/ObjectID";
import logger from "../Logger";
import {
  NotificationSchedule,
  OnCallPageStart,
} from "../Telemetry/NotificationDeliveryMetrics";

/*
 * AN ESCALATION LEVEL WHILE IT PAGES ITS PEOPLE (issue #8406).
 *
 * An escalation rule starts by being recorded on its run
 * (OnCallDutyPolicyEscalationRuleService.startRuleExecution), then pages
 * each person it names, one after another. A database error in the middle
 * of that - paging the second of five people, say - or a process that
 * stops there left the rest of the level unpaged for good: the rule was
 * recorded, so trying the step again could not start the level again
 * without paging the first person twice, and the run waited out the
 * level's wait and moved on.
 *
 * So the level is kept here, in Redis, while it pages: from just after its
 * rule is recorded until every person it names was handed a page, with a
 * sign of life after each one. A level still here whose paging failed
 * (stopped), or that has shown no sign of life for RESUME_AFTER_MS, never
 * finished paging, and the policy-run worker resumes it at the run's next
 * try (OnCallEscalationAdvance.resumeLevel): the people this run has not
 * paged for the rule since the level started are paged, and nobody it
 * paged is paged again.
 *
 * One level per run: a run pages one level at a time. Kept well past any
 * level, and nothing here throws - a Redis that is down keeps nothing, and
 * a level that stops then is lost as it always was.
 */

/*
 * A page again's start, kept before its rule is recorded (issue #8514):
 * where it starts, who acknowledged, and its timeout's minutes, for its
 * status message - what the policy-run worker needs to start it when its
 * start failed or stopped (startHandedOverPageAgain).
 */
export interface OnCallPageAgainInFlight {
  startAtRuleId: string | null;
  acknowledgedByUserId: string | null;
  minutes: number;
}

export interface OnCallLevelInFlight {
  // The level's escalation rule: none (empty) for a page again's start that names none.
  ruleId: string;
  // When it started paging: whoever this run paged for the rule since is paged.
  startedAt: Date;
  // The last sign of life of whoever pages it.
  heartbeatAt: Date;
  // Its paging failed part way: it is resumed at the run's next try.
  stopped: boolean;
  /*
   * People it pages before its own: a page again's acknowledger
   * (OnCallAcknowledgementTimeout, alsoPageUserIds). A resume pages them
   * first too (issue #8471).
   */
  firstUserIds?: Array<string> | undefined;
  /*
   * How its pages were timed as it started (issue #8471): a scheduled send
   * due when the wait before it ran out (OnCallSendLag), or a page's start
   * (OnCallPageTiming). A resume is timed the same way, so a page it sends
   * late shows as late.
   */
  scheduledSend?: { dueAt: Date; schedule: NotificationSchedule } | undefined;
  pageStart?: { startedAt: Date; start: OnCallPageStart } | undefined;
  // A page again's start, before its rule is recorded (issue #8514).
  pageAgain?: OnCallPageAgainInFlight | undefined;
}

// A level kept in Redis: its moments in milliseconds since the epoch.
type KeptLevel = {
  ruleId: string;
  startedAt: number;
  heartbeatAt: number;
  stopped: boolean;
  firstUserIds?: Array<string>;
  scheduledSend?: { dueAt: number; schedule: string };
  pageStart?: { startedAt: number; start: string };
  pageAgain?: {
    startAtRuleId: string | null;
    acknowledgedByUserId: string | null;
    minutes: number;
  };
};

export class OnCallLevels {
  public readonly CACHE_NAMESPACE: string = "on-call-levels-in-flight";

  // Six hours: far longer than any level takes to page.
  public readonly CACHE_EXPIRES_IN_SECONDS: number = 6 * 60 * 60;

  /*
   * How long a level may show no sign of life before it is resumed: each
   * of its people is paged in seconds, and a tick runs every minute.
   */
  public readonly RESUME_AFTER_MS: number = 2 * 60 * 1000;

  // The level in flight of each of `runIds` that has one, by its id: one round trip.
  public async read(
    runIds: Array<ObjectID | null | undefined>,
  ): Promise<Map<string, OnCallLevelInFlight>> {
    const levels: Map<string, OnCallLevelInFlight> = new Map();
    const keys: Array<string> = runIds
      .filter((id: ObjectID | null | undefined): id is ObjectID => {
        return Boolean(id);
      })
      .map((id: ObjectID): string => {
        return id.toString();
      });

    if (keys.length === 0) {
      return levels;
    }

    try {
      const values: Array<string | null> = await GlobalCache.getStrings(
        this.CACHE_NAMESPACE,
        keys,
      );

      keys.forEach((key: string, index: number) => {
        const level: OnCallLevelInFlight | null = this.fromCacheValue(
          values[index] || null,
        );

        if (level) {
          levels.set(key, level);
        }
      });
    } catch (err) {
      logger.debug(
        `Could not read the escalation levels in flight of a page of on-call runs; resuming none of them: ${err}`,
      );
    }

    return levels;
  }

  // Keeps the run's level in flight: as it starts, at each sign of life, and when it stops.
  public async keep(
    runId: ObjectID | null | undefined,
    level: OnCallLevelInFlight,
  ): Promise<void> {
    if (!runId) {
      return;
    }

    try {
      await GlobalCache.setString(
        this.CACHE_NAMESPACE,
        runId.toString(),
        this.toCacheValue(level),
        {
          expiresInSeconds: this.CACHE_EXPIRES_IN_SECONDS,
        },
      );
    } catch (err) {
      logger.debug(
        `Could not keep the escalation level in flight of on-call run ${runId.toString()}: ${err}`,
      );
    }
  }

  // Forgets it: every person it names was handed a page.
  public async forget(runId: ObjectID | null | undefined): Promise<void> {
    if (!runId) {
      return;
    }

    try {
      await GlobalCache.deleteKey(this.CACHE_NAMESPACE, runId.toString());
    } catch (err) {
      logger.debug(
        `Could not forget the escalation level in flight of on-call run ${runId.toString()}: ${err}`,
      );
    }
  }

  /*
   * Whether a level in flight never finished paging, and is resumed now: it
   * stopped, or has shown no sign of life for RESUME_AFTER_MS.
   */
  public isToResume(level: OnCallLevelInFlight, now: Date): boolean {
    return (
      level.stopped ||
      now.getTime() - level.heartbeatAt.getTime() >= this.RESUME_AFTER_MS
    );
  }

  public toCacheValue(level: OnCallLevelInFlight): string {
    const kept: KeptLevel = {
      ruleId: level.ruleId,
      startedAt: level.startedAt.getTime(),
      heartbeatAt: level.heartbeatAt.getTime(),
      stopped: level.stopped,
      ...(level.firstUserIds && level.firstUserIds.length > 0
        ? { firstUserIds: level.firstUserIds }
        : {}),
      ...(level.scheduledSend
        ? {
            scheduledSend: {
              dueAt: level.scheduledSend.dueAt.getTime(),
              schedule: level.scheduledSend.schedule,
            },
          }
        : {}),
      ...(level.pageStart
        ? {
            pageStart: {
              startedAt: level.pageStart.startedAt.getTime(),
              start: level.pageStart.start,
            },
          }
        : {}),
      ...(level.pageAgain ? { pageAgain: level.pageAgain } : {}),
    };

    return JSON.stringify(kept);
  }

  // What was kept, or null for nothing, or for something that is not a level.
  public fromCacheValue(
    value: string | null | undefined,
  ): OnCallLevelInFlight | null {
    if (!value) {
      return null;
    }

    try {
      const kept: Partial<KeptLevel> = JSON.parse(value) as Partial<KeptLevel>;

      if (
        !kept ||
        typeof kept !== "object" ||
        typeof kept.ruleId !== "string" ||
        // Only a page again's start may name no rule.
        (!kept.ruleId && !kept.pageAgain) ||
        !this.isMoment(kept.startedAt) ||
        !this.isMoment(kept.heartbeatAt)
      ) {
        return null;
      }

      const firstUserIds: Array<string> = Array.isArray(kept.firstUserIds)
        ? kept.firstUserIds.filter((userId: unknown): userId is string => {
            return typeof userId === "string" && userId.length > 0;
          })
        : [];

      const schedules: Array<string> = Object.values(NotificationSchedule);
      const scheduledSend:
        | { dueAt: Date; schedule: NotificationSchedule }
        | undefined =
        kept.scheduledSend &&
        this.isMoment(kept.scheduledSend.dueAt) &&
        schedules.includes(kept.scheduledSend.schedule)
          ? {
              dueAt: new Date(kept.scheduledSend.dueAt),
              schedule: kept.scheduledSend.schedule as NotificationSchedule,
            }
          : undefined;

      const starts: Array<string> = Object.values(OnCallPageStart);
      const pageStart: { startedAt: Date; start: OnCallPageStart } | undefined =
        kept.pageStart &&
        this.isMoment(kept.pageStart.startedAt) &&
        starts.includes(kept.pageStart.start)
          ? {
              startedAt: new Date(kept.pageStart.startedAt),
              start: kept.pageStart.start as OnCallPageStart,
            }
          : undefined;

      const pageAgain: OnCallPageAgainInFlight | undefined =
        kept.pageAgain &&
        typeof kept.pageAgain === "object" &&
        typeof kept.pageAgain.minutes === "number" &&
        Number.isFinite(kept.pageAgain.minutes)
          ? {
              startAtRuleId:
                typeof kept.pageAgain.startAtRuleId === "string" &&
                kept.pageAgain.startAtRuleId
                  ? kept.pageAgain.startAtRuleId
                  : null,
              acknowledgedByUserId:
                typeof kept.pageAgain.acknowledgedByUserId === "string" &&
                kept.pageAgain.acknowledgedByUserId
                  ? kept.pageAgain.acknowledgedByUserId
                  : null,
              minutes: kept.pageAgain.minutes,
            }
          : undefined;

      if (!kept.ruleId && !pageAgain) {
        return null;
      }

      return {
        ruleId: kept.ruleId,
        startedAt: new Date(kept.startedAt as number),
        heartbeatAt: new Date(kept.heartbeatAt as number),
        stopped: kept.stopped === true,
        ...(firstUserIds.length > 0 ? { firstUserIds: firstUserIds } : {}),
        ...(scheduledSend ? { scheduledSend: scheduledSend } : {}),
        ...(pageStart ? { pageStart: pageStart } : {}),
        ...(pageAgain ? { pageAgain: pageAgain } : {}),
      };
    } catch {
      return null;
    }
  }

  private isMoment(value: unknown): boolean {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
  }
}

const OnCallLevelsInFlight: OnCallLevels = new OnCallLevels();

export default OnCallLevelsInFlight;
