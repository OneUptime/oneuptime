import { AnalyticsHost, AnalyticsKey } from "../EnvironmentConfig";
import UserService from "../Services/UserService";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import URL from "../../Types/API/URL";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import User from "../../Models/DatabaseModels/User";
import API from "../../Utils/API";
import logger from "./Logger";
import crypto from "crypto";

/*
 * Server-side product analytics (PostHog).
 *
 * Client-side events are lost to ad blockers — common with OneUptime's
 * developer audience — so revenue and activation events are also captured
 * here, where they cannot be blocked.
 *
 * Events are identified by the user's email (the same distinct id the
 * frontends use via posthog.identify) so server and client events join into
 * one person profile.
 *
 * No-ops when ANALYTICS_KEY / ANALYTICS_HOST are not configured (the default
 * for self-hosted installs). Never throws — analytics must not break the
 * product.
 */
export default class ProductAnalytics {
  public static isConfigured(): boolean {
    return Boolean(AnalyticsKey && AnalyticsHost);
  }

  /*
   * The same UUID for the same key, every time. PostHog stores events that
   * share a uuid, name, distinct id and timestamp once, so an event captured
   * again under the key and moment it was first captured with is stored once.
   */
  public static getDeterministicUuid(key: string): string {
    const bytes: Buffer = crypto
      .createHash("sha256")
      .update(key, "utf8")
      .digest()
      .subarray(0, 16);

    // Version 8 (RFC 9562: a custom layout) and the RFC 4122 variant.
    bytes[6] = ((bytes[6] as number) & 0x0f) | 0x80;
    bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;

    const hex: string = bytes.toString("hex");

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }

  public static capture(data: {
    event: string;
    distinctId: string;
    properties?: JSONObject | undefined;
    /*
     * For an event that can be raised twice for one occurrence - a Stripe
     * webhook sent again - the key of that occurrence (a marketing event's
     * eventId), with the moment it happened: PostHog then stores it once.
     */
    deduplicationKey?: string | undefined;
    timestamp?: Date | undefined;
  }): void {
    try {
      if (!this.isConfigured()) {
        return;
      }

      if (!data.distinctId) {
        return;
      }

      API.post<JSONObject>({
        url: URL.fromString(AnalyticsHost.toString()).addRoute("/capture/"),
        data: {
          api_key: AnalyticsKey,
          event: data.event,
          distinct_id: data.distinctId,
          ...(data.deduplicationKey
            ? { uuid: this.getDeterministicUuid(data.deduplicationKey) }
            : {}),
          ...(data.timestamp
            ? { timestamp: data.timestamp.toISOString() }
            : {}),
          properties: {
            source: "oneuptime-server",
            ...(data.properties || {}),
          },
        },
      })
        .then((result: HTTPResponse<JSONObject> | HTTPErrorResponse) => {
          /*
           * API.post resolves (does not reject) on HTTP error statuses, so a
           * misconfigured ANALYTICS_KEY (401) or malformed body (400) must be
           * surfaced here or events vanish with no log signal.
           */
          if (result instanceof HTTPErrorResponse) {
            logger.error(
              `ProductAnalytics capture failed for event ${data.event}: HTTP ${result.statusCode} ${result.message}`,
            );
          }
        })
        .catch((err: Error) => {
          logger.error("ProductAnalytics capture failed:");
          logger.error(err);
        });
    } catch (err) {
      /*
       * e.g. URL.fromString throws on a malformed ANALYTICS_HOST. Analytics
       * runs inside request-path hooks (signup, project create, plan change)
       * and must never fail those requests.
       */
      logger.error("ProductAnalytics capture failed:");
      logger.error(err as Error);
    }
  }

  /*
   * Capture an event attributed to a user by id, resolving the user's email
   * to use as the distinct id. Skips silently when the user cannot be
   * resolved (e.g. records created by probes, workflows or API keys).
   */
  public static captureForUser(data: {
    userId: ObjectID | undefined | null;
    event: string;
    properties?: JSONObject | undefined;
  }): void {
    try {
      if (!this.isConfigured()) {
        return;
      }

      if (!data.userId) {
        return;
      }

      UserService.findOneById({
        id: data.userId,
        select: {
          email: true,
        },
        props: {
          isRoot: true,
        },
      })
        .then((user: User | null) => {
          if (!user || !user.email) {
            return;
          }

          this.capture({
            event: data.event,
            distinctId: user.email.toString(),
            properties: data.properties,
          });
        })
        .catch((err: Error) => {
          logger.error("ProductAnalytics captureForUser failed:");
          logger.error(err);
        });
    } catch (err) {
      logger.error("ProductAnalytics captureForUser failed:");
      logger.error(err as Error);
    }
  }
}
