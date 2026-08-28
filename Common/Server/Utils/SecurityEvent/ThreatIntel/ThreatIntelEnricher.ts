import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  ENRICHMENT_CONFIDENCE_ATTRIBUTE,
  ENRICHMENT_FEED_ATTRIBUTE,
  ENRICHMENT_FEED_ID_ATTRIBUTE,
  ENRICHMENT_INDICATOR_ID_ATTRIBUTE,
  ENRICHMENT_INDICATOR_TYPE_ATTRIBUTE,
  ENRICHMENT_INDICATOR_VALUE_ATTRIBUTE,
  ENRICHMENT_MATCHED_ATTRIBUTE,
  ENRICHMENT_MATCHED_VALUE,
  ENRICHMENT_MATCH_COUNT_ATTRIBUTE,
} from "../../../../Types/SecurityEvent/ThreatIntelConstants";
import InMemoryTTLCache from "../../../Infrastructure/InMemoryTTLCache";
import ThreatIntelIndicatorService, {
  ActiveIndicator,
} from "../../../Services/ThreatIntelIndicatorService";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * Ingest-time IOC enrichment: stamp threat.* attributes onto normalized
 * security events whose observables match an active indicator, BEFORE
 * the rows are built (buildSecurityEventDbRow derives attributeKeys from
 * attributes, so stamped keys become filterable everywhere for free).
 *
 * This sits on the hot ingest path, so its cost model is strict:
 *  - a per-project "has any indicators at all?" probe, cached in-process
 *    for a minute and invalidated by the poller on ingest, short-circuits
 *    the overwhelmingly common case of projects with no threat intel;
 *  - one batched ClickHouse lookup per ingest batch (chunked IN query
 *    over the batch's distinct observables), never a per-event query;
 *  - any failure logs and leaves the batch unenriched — enrichment must
 *    never cost a customer their events.
 *
 * Events ingested BEFORE an indicator arrives are never retro-stamped
 * (ClickHouse rows are immutable in practice); the scheduled matcher is
 * the lane that catches late-arriving intel.
 */

const HAS_INDICATORS_CACHE_TTL_IN_MS: number = 60 * 1000;

// IN-list chunk per lookup query.
const MAX_VALUES_PER_LOOKUP_QUERY: number = 5000;

/*
 * Safety valve for pathological batches: at most this many distinct
 * observables are looked up per batch; the rest go unenriched (the
 * scheduled matcher still sees those events).
 */
const MAX_DISTINCT_VALUES_PER_BATCH: number = 50000;

export interface EnrichmentResult {
  eventsMatched: number;
  valuesLookedUp: number;
}

export default class ThreatIntelEnricher {
  private static hasIndicatorsCache: InMemoryTTLCache<boolean> =
    new InMemoryTTLCache<boolean>();

  /*
   * Called by the feed poller after ingesting new indicator rows so the
   * next batch's probe sees them instead of a cached "no".
   */
  public static invalidateProjectCache(projectId: ObjectID): void {
    this.hasIndicatorsCache.delete(projectId.toString());
  }

  // Test seam.
  public static clearCaches(): void {
    this.hasIndicatorsCache.clear();
  }

  @CaptureSpan()
  public static async enrichNormalizedEvents(data: {
    projectId: ObjectID;
    events: Array<NormalizedSecurityEvent>;
  }): Promise<EnrichmentResult> {
    const result: EnrichmentResult = {
      eventsMatched: 0,
      valuesLookedUp: 0,
    };

    try {
      if (data.events.length === 0) {
        return result;
      }

      if (!(await this.projectHasIndicators(data.projectId))) {
        return result;
      }

      /*
       * Distinct canonical (lowercased) observables across the batch,
       * plus each event's own canonical set for the stamping pass.
       */
      const distinctValues: Array<string> = [];
      const seenValues: Set<string> = new Set<string>();
      const canonicalPerEvent: Array<Array<string>> = [];

      for (const event of data.events) {
        const canonicalValues: Array<string> = [];

        for (const observable of event.observables || []) {
          const canonical: string = (observable || "").trim().toLowerCase();

          if (!canonical) {
            continue;
          }

          canonicalValues.push(canonical);

          if (
            !seenValues.has(canonical) &&
            seenValues.size < MAX_DISTINCT_VALUES_PER_BATCH
          ) {
            seenValues.add(canonical);
            distinctValues.push(canonical);
          }
        }

        canonicalPerEvent.push(canonicalValues);
      }

      if (distinctValues.length === 0) {
        return result;
      }

      result.valuesLookedUp = distinctValues.length;

      const now: Date = OneUptimeDate.getCurrentDate();

      /*
       * One winner per value: the service returns one row per (feed,
       * value) identity, and when several feeds carry the same value the
       * highest confidence wins the stamp.
       */
      const bestByValue: Map<string, ActiveIndicator> = new Map<
        string,
        ActiveIndicator
      >();

      for (
        let offset: number = 0;
        offset < distinctValues.length;
        offset += MAX_VALUES_PER_LOOKUP_QUERY
      ) {
        const chunk: Array<string> = distinctValues.slice(
          offset,
          offset + MAX_VALUES_PER_LOOKUP_QUERY,
        );

        const indicators: Array<ActiveIndicator> =
          await ThreatIntelIndicatorService.findActiveIndicatorsByValues({
            projectId: data.projectId,
            values: chunk,
            now,
          });

        for (const indicator of indicators) {
          const existing: ActiveIndicator | undefined = bestByValue.get(
            indicator.indicatorValue,
          );

          if (!existing || indicator.confidence > existing.confidence) {
            bestByValue.set(indicator.indicatorValue, indicator);
          }
        }
      }

      if (bestByValue.size === 0) {
        return result;
      }

      for (let index: number = 0; index < data.events.length; index++) {
        const event: NormalizedSecurityEvent = data.events[index]!;
        const canonicalValues: Array<string> = canonicalPerEvent[index]!;

        let best: ActiveIndicator | null = null;
        let matchedValueCount: number = 0;

        for (const canonical of canonicalValues) {
          const indicator: ActiveIndicator | undefined =
            bestByValue.get(canonical);

          if (!indicator) {
            continue;
          }

          matchedValueCount++;

          if (!best || indicator.confidence > best.confidence) {
            best = indicator;
          }
        }

        if (!best) {
          continue;
        }

        event.attributes = {
          ...event.attributes,
          [ENRICHMENT_MATCHED_ATTRIBUTE]: ENRICHMENT_MATCHED_VALUE,
          [ENRICHMENT_INDICATOR_ID_ATTRIBUTE]: best.stixId,
          [ENRICHMENT_INDICATOR_TYPE_ATTRIBUTE]: best.indicatorType,
          [ENRICHMENT_INDICATOR_VALUE_ATTRIBUTE]: best.indicatorValue,
          [ENRICHMENT_FEED_ATTRIBUTE]: best.feedName,
          [ENRICHMENT_FEED_ID_ATTRIBUTE]: best.feedId,
          [ENRICHMENT_CONFIDENCE_ATTRIBUTE]: String(best.confidence),
          [ENRICHMENT_MATCH_COUNT_ATTRIBUTE]: String(matchedValueCount),
        };

        result.eventsMatched++;
      }

      return result;
    } catch (error) {
      logger.error(
        `ThreatIntelEnricher: enrichment failed for project ${data.projectId.toString()}; events continue unenriched.`,
      );
      logger.error(error);

      return result;
    }
  }

  private static async projectHasIndicators(
    projectId: ObjectID,
  ): Promise<boolean> {
    const cacheKey: string = projectId.toString();

    const cached: boolean | undefined = this.hasIndicatorsCache.get(cacheKey);

    if (cached !== undefined) {
      return cached;
    }

    const hasIndicators: boolean =
      await ThreatIntelIndicatorService.hasIndicatorsForProject(projectId);

    this.hasIndicatorsCache.set(
      cacheKey,
      hasIndicators,
      HAS_INDICATORS_CACHE_TTL_IN_MS,
    );

    return hasIndicators;
  }
}
