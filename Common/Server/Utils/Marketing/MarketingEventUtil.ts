import Attribution from "../Attribution";
import MarketingEventWebhook from "./MarketingEventWebhook";
import {
  UtmPropertyKeys,
  UtmUrlPropertyKey,
  UtmWireKeyToPropertyKey,
} from "../../../Types/Marketing/Attribution";
import Queue, { QueueName } from "../../Infrastructure/Queue";
import { JSONObject } from "../../../Types/JSON";
import {
  MARKETING_EVENT_SCHEMA_VERSION,
  MarketingEvent,
  MarketingEventAttribution,
  MarketingEventType,
} from "../../../Types/Marketing/MarketingEvent";
import logger from "../Logger";

/*
 * How many times the queue delivers one event before giving up, and the base
 * for its exponential backoff. Five attempts at 30s exponential spans roughly
 * eight minutes, which covers a rolling deploy of the receiver.
 *
 * There is no dead-letter store and deliberately so: the point of this design
 * is that OneUptime does not hold marketing data. An event that exhausts its
 * attempts is logged as an error and lost, which is the cost of not keeping a
 * ledger and should be alerted on rather than engineered around here.
 */
const DELIVERY_ATTEMPTS: number = 5;
const DELIVERY_BACKOFF_MS: number = 30_000;

/*
 * Anything carrying the attribution columns. User and Project both do —
 * ProjectService copies them off the creating user at project creation — so
 * one shape serves every caller and they cannot drift apart.
 */
export interface AttributionSource {
  utmSource?: string | undefined;
  utmMedium?: string | undefined;
  utmCampaign?: string | undefined;
  utmTerm?: string | undefined;
  utmContent?: string | undefined;
  utmId?: string | undefined;
  utmSourcePlatform?: string | undefined;
  utmCreativeFormat?: string | undefined;
  utmMarketingTactic?: string | undefined;
  utmUrl?: string | undefined;
  clickIds?: JSONObject | undefined;
  firstTouchAttribution?: JSONObject | undefined;
}

/*
 * The campaign columns as snake_case analytics properties, driven from the
 * shared contract so a key added there cannot be reported by the browser and
 * the receiver while silently missing from PostHog.
 */
export function utmAnalyticsProperties(row: {
  [key: string]: unknown;
}): JSONObject {
  const properties: JSONObject = {};

  for (const [wireKey, propertyKey] of Object.entries(
    UtmWireKeyToPropertyKey,
  )) {
    properties[wireKey] = (row[propertyKey] as string | undefined) || "";
  }

  return properties;
}

export default class MarketingEventUtil {
  /*
   * Driven from UtmPropertyKeys rather than hand-listed. Hand-listing is how
   * utm_id and its three GA4 siblings reached the browser, the User row and
   * the Cal booking metadata while silently never reaching a receiver.
   *
   * Additive only, so the schema version does not move
   * (Docs/analytics/marketing-event-webhooks.md).
   */
  public static buildAttribution(
    source: AttributionSource | undefined,
  ): MarketingEventAttribution {
    const sourceRow: JSONObject = (source || {}) as unknown as JSONObject;

    const attribution: MarketingEventAttribution = {
      clickIds: source?.clickIds || {},
      firstTouch: source?.firstTouchAttribution || {},
    };

    for (const propertyKey of [...UtmPropertyKeys, UtmUrlPropertyKey]) {
      attribution[propertyKey] = sourceRow[propertyKey];
    }

    return attribution;
  }

  public static buildEvent(data: {
    eventType: MarketingEventType;
    eventId: string;
    occurredAt: Date;
    email?: string | undefined;
    attributionSource?: AttributionSource | undefined;
    data?: JSONObject | undefined;
  }): MarketingEvent {
    const emailHash: string | null = Attribution.hashEmail(data.email);

    return {
      schemaVersion: MARKETING_EVENT_SCHEMA_VERSION,
      eventId: data.eventId,
      eventType: data.eventType,
      occurredAt: data.occurredAt.toISOString(),
      email: data.email,
      emailHash: emailHash || undefined,
      attribution: this.buildAttribution(data.attributionSource),
      data: data.data || {},
    };
  }

  /*
   * Hand one event to the queue.
   *
   * Never throws and never awaits delivery. Every caller is a commercial code
   * path — a signup completing, a plan change being written, a booking being
   * accepted — and none of them may fail, block, or slow down because a
   * marketing endpoint is unreachable. Enqueue is the only synchronous part
   * and it is a single Redis write.
   */
  public static async emit(event: MarketingEvent): Promise<void> {
    if (MarketingEventWebhook.isMisconfigured()) {
      logger.error(
        `MarketingEvent: MARKETING_WEBHOOK_URL is set but MARKETING_WEBHOOK_SECRET is not — refusing to send ${event.eventType} unsigned. Set the secret or unset the URL.`,
      );
      return;
    }

    if (!MarketingEventWebhook.isConfigured()) {
      return;
    }

    try {
      await Queue.addJob(
        QueueName.MarketingEvent,
        event.eventId,
        event.eventType,
        event as JSONObject,
        {
          attempts: DELIVERY_ATTEMPTS,
          backoffDelayInMs: DELIVERY_BACKOFF_MS,
        },
      );

      logger.debug(
        `MarketingEvent: queued ${event.eventType} (${event.eventId})`,
      );
    } catch (err) {
      logger.error(
        `MarketingEvent: failed to queue ${event.eventType} (${event.eventId}): ${err}`,
      );
    }
  }

  /*
   * Fire-and-forget wrapper for callers that are not async or must not await.
   *
   * Guarantees it neither throws nor rejects. Every caller is inside a
   * commercial transaction that has already succeeded by the time it gets
   * here — a user is created, a plan is changed, a booking is verified — so
   * the one thing this must never do is turn a completed action into a failed
   * one. The rejection path is covered by .catch and the synchronous path by
   * the try, because an argument expression that throws (buildEvent on a
   * malformed row) would otherwise propagate straight into the caller.
   */
  public static emitInBackground(event: MarketingEvent): void {
    try {
      this.emit(event).catch((err: Error) => {
        logger.error(
          `MarketingEvent: failed to emit ${event.eventType}: ${err}`,
        );
      });
    } catch (err) {
      logger.error(`MarketingEvent: failed to emit ${event.eventType}: ${err}`);
    }
  }
}
