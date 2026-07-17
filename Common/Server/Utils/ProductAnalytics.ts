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

  public static capture(data: {
    event: string;
    distinctId: string;
    properties?: JSONObject | undefined;
  }): void {
    try {
      if (!this.isConfigured()) {
        return;
      }

      if (!data.distinctId) {
        return;
      }

      API.post({
        url: URL.fromString(AnalyticsHost.toString()).addRoute("/capture/"),
        data: {
          api_key: AnalyticsKey,
          event: data.event,
          distinct_id: data.distinctId,
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
