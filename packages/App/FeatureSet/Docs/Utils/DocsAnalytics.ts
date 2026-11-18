import {
  AnalyticsHost,
  AnalyticsKey,
  IsBillingEnabled,
  IsEnterpriseEdition,
} from "Common/Server/EnvironmentConfig";
import logger from "Common/Server/Utils/Logger";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { ProductEventName } from "Common/Types/Analytics/ProductEvent";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import crypto from "crypto";

/*
 * WHAT THE DOCS SEND TO PRODUCT ANALYTICS, AND ONLY WHERE IT IS SET UP
 * (issues #6822, #7207).
 *
 * Two events leave the docs server: "Was this page helpful?"
 * (docs/feedback_given, Utils/DocsFeedback) and a search that found
 * nothing (docs/search_found_nothing, Utils/DocsSearchReport). Each goes to
 * PostHog only where ANALYTICS_KEY and ANALYTICS_HOST are set - OneUptime
 * Cloud sets them, a self-hosted server does not - and the page posts it
 * only with the reader's consent (Views/Partials/Scripts.ejs,
 * isMeasurementAllowed). Anywhere else nothing is sent, whatever arrives.
 *
 * A reader is never identified: each event goes under an id of its own,
 * PostHog keeps no person profile for it, and it is sent by this server,
 * so the reader's address never reaches PostHog.
 */
export default class DocsAnalytics {
  // Whether anything may leave the server: only where product analytics is set up.
  public static isSetUp(): boolean {
    return Boolean(AnalyticsKey && AnalyticsHost);
  }

  public static getEdition(): string {
    if (IsBillingEnabled) {
      return "cloud";
    }

    return IsEnterpriseEdition ? "enterprise" : "community";
  }

  /*
   * Sends one event, its properties already as the catalog lets them go
   * (toProductEventProperties), where analytics is set up; does nothing
   * anywhere else. Never throws: an event is never worth an error. Whether
   * it was sent.
   */
  public static async capture(data: {
    event: ProductEventName;
    properties: JSONObject;
    // What failed, for the log: "Docs feedback".
    what: string;
  }): Promise<boolean> {
    if (!DocsAnalytics.isSetUp()) {
      return false;
    }

    try {
      const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(AnalyticsHost.toString()).addRoute("/capture/"),
          data: {
            api_key: AnalyticsKey,
            event: data.event,
            distinct_id: crypto.randomUUID(),
            properties: {
              source: "oneuptime-docs",
              $process_person_profile: false,
              ...data.properties,
            },
          },
        });

      if (result instanceof HTTPErrorResponse) {
        logger.error(
          `${data.what} could not be sent: HTTP ${result.statusCode} ${result.message}`,
        );
        return false;
      }

      return true;
    } catch (err) {
      logger.error(`${data.what} could not be sent:`);
      logger.error(err as Error);
      return false;
    }
  }
}
