import GlobalCache from "../../Infrastructure/GlobalCache";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import { CheckOn, CriteriaFilter } from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import ObjectID from "../../../Types/ObjectID";

/**
 * Alert hysteresis for monitor criteria (default OFF — enabled per
 * criteria via `minimumBreachedEvaluations` / `reopenCooldownSeconds` on
 * MonitorCriteriaInstance's data, serialized inside the monitor-step
 * JSON).
 *
 * Scope: gates incident/alert CREATION only. Monitor status changes and
 * auto-resolution behave exactly as before — resolves are never delayed.
 *
 * State store: Redis via GlobalCache.
 *
 * Key schema (GlobalCache prefixes keys with `<namespace>-`):
 *
 *   Consecutive-breach counters — ONE key per (monitor, criteria)
 *   holding a JSON map of fingerprint → consecutive matched-tick count:
 *
 *     monitor-hysteresis-<monitorId>:<criteriaId>
 *       => { "<fingerprint or '_'>": <count>, ... }
 *
 *   Legacy (non-series) monitors use the sentinel fingerprint "_". A
 *   single JSON map (instead of one key per fingerprint) lets a tick
 *   where the criteria matches reset the counters of every fingerprint
 *   that did NOT match on that tick — per-series fingerprints are not
 *   enumerable from the criteria config, so per-fingerprint keys could
 *   not be reset without a key scan.
 *
 *   Reopen cooldowns — one key per (monitor, criteria, fingerprint),
 *   written on auto-resolve with TTL = reopenCooldownSeconds:
 *
 *     monitor-hysteresis-cooldown:<monitorId>:<criteriaId>:<fingerprint or '_'>
 *       => "1"
 *
 * Counter TTL scales with the monitor's evaluation cadence:
 * `max(15 min, 2 * cadence + grace)` — probe monitors support intervals
 * up to weekly, and a fixed 15-minute TTL would expire between ticks and
 * make thresholds >= 2 unreachable. 2x cadence preserves the "one missed
 * tick does not wipe state" property; the 15-minute floor covers
 * telemetry monitors (cadence unknown, evaluate every minute). A Redis
 * flush merely restarts counting: the counters rebuild from zero over
 * the next N evaluations, which delays (never loses) creation.
 *
 * Event-driven monitors (grouped incoming-request / webhook): each
 * webhook tick carries ONLY its own payload's keys, so absence of a key
 * from a tick is not recovery. For those monitors the counter map is
 * seeded from the existing map (keys absent from the payload keep their
 * counters, garbage-collected by TTL) and the unmatched-criteria reset
 * is skipped entirely by MonitorResource.
 *
 * Failure policy: FAIL OPEN. Any cache error falls back to the current
 * (pre-hysteresis) behavior — alerting is never blocked because Redis
 * hiccuped. When neither setting is enabled on a criteria, this module
 * performs zero cache operations.
 */

export const MonitorHysteresisCacheNamespace: string = "monitor-hysteresis";

/**
 * Sentinel fingerprint used for the legacy (non-per-series) create path
 * where incidents/alerts are per-monitor, not per-fingerprint.
 */
export const LegacySeriesFingerprintKey: string = "_";

/**
 * FLOOR TTL for consecutive-breach counters — used as-is when the
 * monitor's evaluation cadence is unknown (telemetry monitors evaluate
 * every minute, so 15 minutes is comfortably above cadence there). For
 * monitors with a known cadence the effective TTL is
 * `max(this, 2 * cadence + BreachCounterTtlGraceInSeconds)`.
 */
export const BreachCounterTtlInSeconds: number = 15 * 60;

/**
 * Grace added on top of 2x cadence when scaling the counter TTL, so a
 * tick that runs slightly late does not land after key expiry.
 */
export const BreachCounterTtlGraceInSeconds: number = 300;

/**
 * The (fixed, enumerable) monitoringInterval cron strings offered by the
 * dashboard (App/.../Utils/MonitorIntervalDropdownOptions.ts) mapped to
 * seconds. Unknown/custom values map to undefined and the TTL falls back
 * to the floor.
 */
const MonitoringIntervalToSeconds: Dictionary<number> = {
  "* * * * *": 60,
  "*/2 * * * *": 2 * 60,
  "*/5 * * * *": 5 * 60,
  "*/10 * * * *": 10 * 60,
  "*/15 * * * *": 15 * 60,
  "*/30 * * * *": 30 * 60,
  "0 * * * *": 60 * 60,
  "0 0 * * *": 24 * 60 * 60,
  "0 0 * * 0": 7 * 24 * 60 * 60,
};

export interface HysteresisCreationGate {
  /**
   * Fingerprint keys (seriesFingerprint, or "_" for the legacy path)
   * for which incident/alert creation is suppressed on this tick.
   */
  suppressedFingerprintKeys: Set<string>;
  /** Human-readable reason per suppressed fingerprint key. */
  suppressionReasons: Dictionary<string>;
}

export default class MonitorHysteresis {
  public static getFingerprintKey(fingerprint: string | undefined): string {
    return fingerprint || LegacySeriesFingerprintKey;
  }

  public static getEmptyGate(): HysteresisCreationGate {
    return {
      suppressedFingerprintKeys: new Set<string>(),
      suppressionReasons: {},
    };
  }

  public static isCreationSuppressed(
    gate: HysteresisCreationGate | undefined,
    fingerprint: string | undefined,
  ): boolean {
    if (!gate) {
      return false;
    }

    return gate.suppressedFingerprintKeys.has(
      this.getFingerprintKey(fingerprint),
    );
  }

  public static getSuppressionReason(
    gate: HysteresisCreationGate | undefined,
    fingerprint: string | undefined,
  ): string | undefined {
    if (!gate) {
      return undefined;
    }

    return gate.suppressionReasons[this.getFingerprintKey(fingerprint)];
  }

  /**
   * Seconds between evaluations for the given monitoringInterval cron
   * string, or undefined when unknown (telemetry monitors have no
   * monitoringInterval; the caller then falls back to the floor TTL).
   */
  public static getEvaluationCadenceSecondsFromMonitoringInterval(
    monitoringInterval: string | undefined,
  ): number | undefined {
    if (!monitoringInterval) {
      return undefined;
    }

    return MonitoringIntervalToSeconds[monitoringInterval];
  }

  /**
   * Effective counter TTL for a monitor: `max(floor, 2 * cadence +
   * grace)`. 2x cadence keeps the "one missed tick does not wipe state"
   * property for slow-cadence probe monitors (30m / hourly / daily /
   * weekly); the floor covers unknown cadence.
   */
  public static getBreachCounterTtlInSeconds(
    evaluationCadenceSeconds: number | undefined,
  ): number {
    if (
      typeof evaluationCadenceSeconds !== "number" ||
      evaluationCadenceSeconds <= 0
    ) {
      return BreachCounterTtlInSeconds;
    }

    return Math.max(
      BreachCounterTtlInSeconds,
      2 * evaluationCadenceSeconds + BreachCounterTtlGraceInSeconds,
    );
  }

  /**
   * ServerMonitor CheckOnlineStatus cron re-evaluations
   * (onlyCheckRequestReceivedAt=true) skip every CPU/memory/disk/process
   * filter — only IsOnline is evaluated — so a resource criteria
   * structurally CANNOT match on such a tick. Treating that as "did not
   * match" would wipe its consecutive-breach counter between real agent
   * reports (agents reporting less often than every 3 minutes always
   * have cron ticks interleaved). Restrict the unmatched-criteria reset
   * on those ticks to the criteria that were actually evaluable: the
   * ones containing a CheckOn.IsOnline filter.
   */
  public static filterCriteriaResettableOnServerHeartbeatOnlyTick(
    criteriaInstances: Array<MonitorCriteriaInstance>,
  ): Array<MonitorCriteriaInstance> {
    return criteriaInstances.filter(
      (criteriaInstance: MonitorCriteriaInstance) => {
        return (criteriaInstance.data?.filters || []).some(
          (filter: CriteriaFilter) => {
            return filter.checkOn === CheckOn.IsOnline;
          },
        );
      },
    );
  }

  private static isBreachThresholdEnabled(
    criteriaInstance: MonitorCriteriaInstance,
  ): boolean {
    const threshold: number | undefined =
      criteriaInstance.data?.minimumBreachedEvaluations;

    return typeof threshold === "number" && threshold > 1;
  }

  private static isReopenCooldownEnabled(
    criteriaInstance: MonitorCriteriaInstance,
  ): boolean {
    const cooldownSeconds: number | undefined =
      criteriaInstance.data?.reopenCooldownSeconds;

    return typeof cooldownSeconds === "number" && cooldownSeconds > 0;
  }

  private static getCounterCacheKey(input: {
    monitorId: ObjectID;
    criteriaId: string;
  }): string {
    return `${input.monitorId.toString()}:${input.criteriaId}`;
  }

  private static getCooldownCacheKey(input: {
    monitorId: ObjectID;
    criteriaId: string;
    fingerprintKey: string;
  }): string {
    return `cooldown:${input.monitorId.toString()}:${input.criteriaId}:${input.fingerprintKey}`;
  }

  /**
   * Called once per evaluation tick for the criteria that matched.
   * Increments the consecutive-breach counter for every fingerprint that
   * matched on this tick (implicitly resetting counters of fingerprints
   * that did not), then returns which fingerprints must be suppressed
   * from incident/alert creation — either because the counter has not
   * reached `minimumBreachedEvaluations` yet, or because a reopen
   * cooldown from a recent auto-resolve is still active.
   *
   * `matchedFingerprints` is undefined for the legacy (non-per-series)
   * path; the sentinel "_" fingerprint is used instead. An empty array
   * (grouped webhook with no firing keys) performs no cache operations —
   * the create loop iterates zero series anyway, and event-driven ticks
   * must not reset per-key counters by absence.
   *
   * `isEventDriven` (grouped incoming-request / webhook monitors): each
   * tick carries ONLY its own payload's keys, so a firing webhook for
   * key B must not zero key A's counter. When set, the counter map is
   * seeded from the existing map — keys absent from this payload keep
   * their counters (TTL garbage-collects stale ones) instead of being
   * reset by absence.
   *
   * `evaluationCadenceSeconds` scales the counter TTL so slow-cadence
   * probe monitors (30m/hourly/daily/weekly) don't lose their counters
   * between ticks — see getBreachCounterTtlInSeconds.
   *
   * Fails open: any cache error returns an unsuppressed gate for the
   * affected stage so behavior degrades to today's create-immediately.
   */
  @CaptureSpan()
  public static async evaluateCreationGateForMatchedCriteria(input: {
    monitorId: ObjectID;
    criteriaInstance: MonitorCriteriaInstance;
    matchedFingerprints: Array<string> | undefined;
    isEventDriven?: boolean | undefined;
    evaluationCadenceSeconds?: number | undefined;
  }): Promise<HysteresisCreationGate> {
    const gate: HysteresisCreationGate = this.getEmptyGate();

    const criteriaId: string | undefined =
      input.criteriaInstance.data?.id?.toString();

    if (!criteriaId) {
      return gate;
    }

    const isThresholdEnabled: boolean = this.isBreachThresholdEnabled(
      input.criteriaInstance,
    );
    const isCooldownEnabled: boolean = this.isReopenCooldownEnabled(
      input.criteriaInstance,
    );

    // Default-off fast path: no settings, no cache traffic, no behavior change.
    if (!isThresholdEnabled && !isCooldownEnabled) {
      return gate;
    }

    const fingerprintKeys: Array<string> = (
      input.matchedFingerprints ?? [undefined]
    ).map((fingerprint: string | undefined) => {
      return this.getFingerprintKey(fingerprint);
    });

    if (fingerprintKeys.length === 0) {
      return gate;
    }

    if (isThresholdEnabled) {
      const threshold: number =
        input.criteriaInstance.data!.minimumBreachedEvaluations!;

      try {
        const counterCacheKey: string = this.getCounterCacheKey({
          monitorId: input.monitorId,
          criteriaId: criteriaId,
        });

        const existingCounters: JSONObject | null =
          await GlobalCache.getJSONObject(
            MonitorHysteresisCacheNamespace,
            counterCacheKey,
          );

        /*
         * Snapshot-driven monitors: rebuild the map from ONLY this
         * tick's matched fingerprints — a fingerprint absent from this
         * tick stopped matching, so its counter resets by being dropped
         * from the stored map.
         *
         * Event-driven monitors: seed from the EXISTING map — a webhook
         * only describes its own payload's keys, so absence is not
         * recovery and other keys' counters must survive this tick
         * (stale entries age out via the TTL).
         */
        const updatedCounters: JSONObject =
          input.isEventDriven && existingCounters
            ? { ...existingCounters }
            : {};
        const suppressedThisStage: Dictionary<string> = {};

        for (const fingerprintKey of fingerprintKeys) {
          const previousCount: number =
            existingCounters &&
            typeof existingCounters[fingerprintKey] === "number"
              ? (existingCounters[fingerprintKey] as number)
              : 0;

          const consecutiveCount: number = previousCount + 1;
          updatedCounters[fingerprintKey] = consecutiveCount;

          if (consecutiveCount < threshold) {
            suppressedThisStage[fingerprintKey] =
              `Criteria has matched on ${consecutiveCount} consecutive evaluation(s); ${threshold} consecutive breaching evaluations are required before incidents/alerts are created (minimumBreachedEvaluations).`;
          }
        }

        await GlobalCache.setJSON(
          MonitorHysteresisCacheNamespace,
          counterCacheKey,
          updatedCounters,
          {
            expiresInSeconds: this.getBreachCounterTtlInSeconds(
              input.evaluationCadenceSeconds,
            ),
          },
        );

        /*
         * Merge suppressions only after both the read AND the write
         * succeeded — a half-failed cache round trip falls open to the
         * current create-immediately behavior instead of suppressing
         * based on state we could not persist.
         */
        for (const fingerprintKey of Object.keys(suppressedThisStage)) {
          gate.suppressedFingerprintKeys.add(fingerprintKey);
          gate.suppressionReasons[fingerprintKey] =
            suppressedThisStage[fingerprintKey]!;
        }
      } catch (err) {
        logger.error(
          `${input.monitorId.toString()} - Alert hysteresis: failed to read/update consecutive-breach counters for criteria ${criteriaId}. Failing open (incidents/alerts will be created as if hysteresis were off).`,
        );
        logger.error(err);
      }
    }

    if (isCooldownEnabled) {
      const cooldownSeconds: number =
        input.criteriaInstance.data!.reopenCooldownSeconds!;

      /*
       * Batch ALL cooldown lookups into ONE Redis round trip (MGET).
       * Fleet-scale per-series monitors can match thousands of
       * fingerprints per tick, and this gate runs while the per-monitor
       * evaluation mutex is held — N sequential GETs here would starve
       * concurrent evaluations of the same monitor. Fingerprints already
       * suppressed by the counter stage are skipped. Fails open for the
       * WHOLE batch on any error.
       */
      const candidateFingerprintKeys: Array<string> = fingerprintKeys.filter(
        (fingerprintKey: string) => {
          return !gate.suppressedFingerprintKeys.has(fingerprintKey);
        },
      );

      if (candidateFingerprintKeys.length > 0) {
        try {
          const cooldownValues: Array<string | null> =
            await GlobalCache.getStrings(
              MonitorHysteresisCacheNamespace,
              candidateFingerprintKeys.map((fingerprintKey: string) => {
                return this.getCooldownCacheKey({
                  monitorId: input.monitorId,
                  criteriaId: criteriaId,
                  fingerprintKey: fingerprintKey,
                });
              }),
            );

          for (
            let keyIndex: number = 0;
            keyIndex < candidateFingerprintKeys.length;
            keyIndex++
          ) {
            if (!cooldownValues[keyIndex]) {
              continue;
            }

            const fingerprintKey: string = candidateFingerprintKeys[keyIndex]!;

            gate.suppressedFingerprintKeys.add(fingerprintKey);
            gate.suppressionReasons[fingerprintKey] =
              `An incident/alert for this criteria auto-resolved recently and re-creation is suppressed for ${cooldownSeconds} second(s) after auto-resolve (reopenCooldownSeconds).`;
          }
        } catch (err) {
          logger.error(
            `${input.monitorId.toString()} - Alert hysteresis: failed to read reopen-cooldown keys for criteria ${criteriaId}. Failing open for the whole batch (creation allowed).`,
          );
          logger.error(err);
        }
      }
    }

    return gate;
  }

  /**
   * Called once per evaluation tick AFTER the matched criteria (if any)
   * is known. Resets (deletes) the consecutive-breach counters of every
   * criteria in the evaluated step that did NOT match on this tick —
   * "consecutive" means an evaluation where the criteria does not match
   * restarts the count. Only criteria that actually enabled the
   * threshold incur a cache operation. Fails open (a failed delete just
   * means the counter survives until its TTL; worst case creation
   * happens up to `threshold` ticks early, i.e. today's behavior).
   */
  @CaptureSpan()
  public static async resetBreachCountersForUnmatchedCriteria(input: {
    monitorId: ObjectID;
    criteriaInstances: Array<MonitorCriteriaInstance>;
    matchedCriteriaId: string | undefined;
  }): Promise<void> {
    for (const criteriaInstance of input.criteriaInstances) {
      const criteriaId: string | undefined =
        criteriaInstance.data?.id?.toString();

      if (!criteriaId || criteriaId === input.matchedCriteriaId) {
        continue;
      }

      if (!this.isBreachThresholdEnabled(criteriaInstance)) {
        continue;
      }

      try {
        await GlobalCache.deleteKey(
          MonitorHysteresisCacheNamespace,
          this.getCounterCacheKey({
            monitorId: input.monitorId,
            criteriaId: criteriaId,
          }),
        );
      } catch (err) {
        logger.error(
          `${input.monitorId.toString()} - Alert hysteresis: failed to reset consecutive-breach counter for criteria ${criteriaId}. Failing open.`,
        );
        logger.error(err);
      }
    }
  }

  /**
   * Called by the auto-resolve paths right after an incident/alert is
   * resolved. When the criteria that CREATED the resolved item opted
   * into `reopenCooldownSeconds`, writes a cooldown key with that TTL so
   * the creation gate suppresses re-creation inside the window. The
   * lookup map is keyed by criteria id because the resolve paths only
   * know the resolved item's `createdCriteriaId`, not the full criteria
   * instance. Never throws — a failed write only means the cooldown is
   * not enforced (today's behavior), and resolution has already
   * happened by the time this runs.
   */
  @CaptureSpan()
  public static async registerAutoResolveCooldown(input: {
    monitorId: ObjectID;
    criteriaId: string | undefined;
    fingerprint: string | undefined;
    reopenCooldownSecondsByCriteriaId: Dictionary<number> | undefined;
  }): Promise<void> {
    if (!input.criteriaId || !input.reopenCooldownSecondsByCriteriaId) {
      return;
    }

    const cooldownSeconds: number | undefined =
      input.reopenCooldownSecondsByCriteriaId[input.criteriaId];

    if (typeof cooldownSeconds !== "number" || cooldownSeconds <= 0) {
      return;
    }

    try {
      await GlobalCache.setString(
        MonitorHysteresisCacheNamespace,
        this.getCooldownCacheKey({
          monitorId: input.monitorId,
          criteriaId: input.criteriaId,
          fingerprintKey: this.getFingerprintKey(input.fingerprint),
        }),
        "1",
        {
          expiresInSeconds: cooldownSeconds,
        },
      );
    } catch (err) {
      logger.error(
        `${input.monitorId.toString()} - Alert hysteresis: failed to write reopen-cooldown key for criteria ${input.criteriaId}. Failing open (re-creation will not be suppressed).`,
      );
      logger.error(err);
    }
  }
}
