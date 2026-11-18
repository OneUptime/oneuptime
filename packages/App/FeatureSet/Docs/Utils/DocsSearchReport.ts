import DocsAnalytics from "./DocsAnalytics";
import { DEFAULT_DOCS_LANGUAGE, isSupportedDocsLanguage } from "./I18n";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import {
  ProductEventName,
  toProductEventProperties,
} from "Common/Types/Analytics/ProductEvent";
import { JSONObject, JSONValue } from "Common/Types/JSON";

/*
 * A DOCS SEARCH THAT FOUND NOTHING (issue #7207): the best sign of what the
 * docs fail at, and the one nobody could see.
 *
 * The docs' search box (Views/Partials/Scripts.ejs) reports a search once
 * it has settled with nothing found - 2 characters or more, a second after
 * the server answered with no page, or when the box closes on it - as the
 * Dashboard's Search does (search/no_results). It reports only where this
 * server sends product analytics (OneUptime Cloud: isReported, passed to
 * Views/Partials/SearchModal.ejs) and only with the reader's consent; a
 * self-hosted server's box never posts.
 *
 * What is sent, as `docs/search_found_nothing`: how long the search was,
 * the docs language, the edition, and on OneUptime Cloud the words typed,
 * cut to 40 characters, with what could name or reach a person taken out
 * first - an email address, a web address, a host name, a number
 * (Common/Types/Analytics/ProductEvent's toSearchQueryWords). Never who
 * searched: each report goes under an id of its own, with no person
 * profile, sent by this server (Utils/DocsAnalytics).
 */

// A search this short is still being typed, and is never reported.
export const DOCS_SEARCH_REPORT_MIN_LENGTH: number = 2;

// The longest search the page posts: more is cut before anything is read.
export const DOCS_SEARCH_REPORT_MAX_LENGTH: number = 500;

export interface DocsSearchFoundNothing {
  // What was typed, trimmed: words are taken from it only as the event allows.
  query: string;
  // The docs language it was searched in.
  language: string;
}

export default class DocsSearchReport {
  // Whether the docs' search box reports: only where analytics is set up.
  public static isReported(): boolean {
    return DocsAnalytics.isSetUp();
  }

  /*
   * A report as the page posts it, or null for anything else: a search of
   * fewer than DOCS_SEARCH_REPORT_MIN_LENGTH characters, or something that
   * is not one.
   */
  public static read(
    body: JSONValue | undefined,
  ): DocsSearchFoundNothing | null {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return null;
    }

    const data: JSONObject = body as JSONObject;
    const query: JSONValue | undefined = data["query"];
    const language: JSONValue | undefined = data["language"];

    if (typeof query !== "string") {
      return null;
    }

    const trimmed: string = query
      .slice(0, DOCS_SEARCH_REPORT_MAX_LENGTH)
      .trim();

    if (trimmed.length < DOCS_SEARCH_REPORT_MIN_LENGTH) {
      return null;
    }

    return {
      query: trimmed,
      language:
        typeof language === "string" && isSupportedDocsLanguage(language)
          ? language
          : DEFAULT_DOCS_LANGUAGE,
    };
  }

  // The event's properties, as the catalog lets them be sent.
  public static toEventProperties(report: DocsSearchFoundNothing): JSONObject {
    return {
      ...toProductEventProperties({
        name: ProductEventName.DocsSearchFoundNothing,
        properties: {
          query_length: report.query.length,
          query: report.query,
        },
        isCloud: IsBillingEnabled,
      }),
      edition: DocsAnalytics.getEdition(),
      language: report.language,
    };
  }

  /*
   * Sends the report to product analytics, where it is set up; does nothing
   * anywhere else. Never throws.
   */
  public static async send(report: DocsSearchFoundNothing): Promise<boolean> {
    return await DocsAnalytics.capture({
      event: ProductEventName.DocsSearchFoundNothing,
      properties: DocsSearchReport.toEventProperties(report),
      what: "A docs search that found nothing",
    });
  }
}
