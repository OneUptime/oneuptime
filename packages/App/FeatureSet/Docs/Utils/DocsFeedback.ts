import DocsNav, { NavGroup, NavLink } from "./Nav";
import { DEFAULT_DOCS_LANGUAGE, isSupportedDocsLanguage } from "./I18n";
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
import {
  ProductEventName,
  toProductEventProperties,
} from "Common/Types/Analytics/ProductEvent";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import { getNewGitHubIssueUrl } from "Common/Types/ProductFeedback/NewGitHubIssue";
import API from "Common/Utils/API";
import crypto from "crypto";

/*
 * "WAS THIS PAGE HELPFUL?" (issue #6822).
 *
 * Every docs page ends with the question: yes or no, and after a no, what
 * went wrong, in one click. Where the answer goes depends on the
 * installation, and the page knows before anyone answers (isSent, passed
 * to Views/Partials/PageFeedback.ejs):
 *
 *   - Where product analytics is set up - ANALYTICS_KEY and ANALYTICS_HOST,
 *     which OneUptime Cloud sets and a self-hosted server does not - the
 *     page posts the answer to /docs/feedback, and this sends it on as
 *     `docs/feedback_given` (Common/Types/Analytics/ProductEvent), with the
 *     same rules as every product event: only the properties the catalog
 *     lists, the page's address and a reason the page chose, never words
 *     anyone wrote. The page asks only with the reader's consent (no
 *     "Reject all", no Global Privacy Control), as the Dashboard does.
 *   - Anywhere else nothing leaves the server, an air-gapped one included:
 *     the page posts nothing, and a no offers "Tell us on GitHub" with the
 *     page's name filled in, which the reader may send or not.
 *
 * A reader is never identified: each answer goes under an id of its own,
 * and PostHog keeps no person profile for it.
 */

// What went wrong, as a no can say it in one click (Locales: ui.feedbackReason*).
export const DOCS_FEEDBACK_REASONS: ReadonlyArray<string> = [
  "unclear",
  "missing",
  "wrong",
  "not_found",
];

export interface DocsFeedbackAnswer {
  // The page's address under /docs/<lang>/: "monitor/website-monitor".
  page: string;
  isHelpful: boolean;
  // Only for a no, and only one of DOCS_FEEDBACK_REASONS.
  reason?: string | undefined;
  // The docs language the page was read in.
  language: string;
}

const NAV_PAGES: Set<string> = new Set<string>(
  (DocsNav as Array<NavGroup>).flatMap((group: NavGroup): Array<string> => {
    return (group.links as Array<NavLink>)
      .filter((link: NavLink): boolean => {
        return link.url.startsWith("/docs/");
      })
      .map((link: NavLink): string => {
        return link.url.slice("/docs/".length);
      });
  }),
);

export default class DocsFeedback {
  // Whether an answer leaves the server: only where product analytics is set up.
  public static isSent(): boolean {
    return Boolean(AnalyticsKey && AnalyticsHost);
  }

  /*
   * A new GitHub issue about the page, its title and address filled in, for
   * a reader to finish and send, or not. In English, as the maintainers
   * read the issues; the page's name is its English nav title.
   */
  public static getGitHubIssueUrl(data: {
    page: string;
    title: string;
    lang: string;
  }): string {
    const title: string = `Docs: ${data.title}`;
    const body: string = [
      `Page: /docs/${data.lang}/${data.page}`,
      "",
      "What was missing, wrong or hard to follow?",
      "",
    ].join("\n");

    // The builder Give feedback in the Dashboard uses too (#6832).
    return getNewGitHubIssueUrl({
      title: title,
      body: body,
      labels: ["documentation"],
    });
  }

  public static getEdition(): string {
    if (IsBillingEnabled) {
      return "cloud";
    }

    return IsEnterpriseEdition ? "enterprise" : "community";
  }

  /*
   * An answer as the page posts it, or null for anything else: a page the
   * nav does not list, a yes or no that is not true or false, a reason that
   * is not one of the page's, or a reason with a yes.
   */
  public static read(body: JSONValue | undefined): DocsFeedbackAnswer | null {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return null;
    }

    const data: JSONObject = body as JSONObject;
    const page: JSONValue | undefined = data["page"];
    const isHelpful: JSONValue | undefined = data["isHelpful"];
    const reason: JSONValue | undefined = data["reason"];
    const language: JSONValue | undefined = data["language"];

    if (
      typeof page !== "string" ||
      !NAV_PAGES.has(page) ||
      typeof isHelpful !== "boolean"
    ) {
      return null;
    }

    if (reason !== undefined && reason !== null) {
      if (
        isHelpful ||
        typeof reason !== "string" ||
        !DOCS_FEEDBACK_REASONS.includes(reason)
      ) {
        return null;
      }
    }

    return {
      page,
      isHelpful,
      ...(typeof reason === "string" ? { reason } : {}),
      language:
        typeof language === "string" && isSupportedDocsLanguage(language)
          ? language
          : DEFAULT_DOCS_LANGUAGE,
    };
  }

  // The event's properties, as the catalog lets them be sent.
  public static toEventProperties(answer: DocsFeedbackAnswer): JSONObject {
    return {
      ...toProductEventProperties({
        name: ProductEventName.DocsFeedbackGiven,
        properties: {
          page: answer.page,
          is_helpful: answer.isHelpful,
          ...(answer.reason ? { reason: answer.reason } : {}),
        },
        isCloud: IsBillingEnabled,
      }),
      edition: DocsFeedback.getEdition(),
      language: answer.language,
    };
  }

  /*
   * Sends the answer to product analytics, where it is set up; does nothing
   * anywhere else. Never throws: an answer is never worth an error.
   */
  public static async send(answer: DocsFeedbackAnswer): Promise<boolean> {
    if (!DocsFeedback.isSent()) {
      return false;
    }

    try {
      const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(AnalyticsHost.toString()).addRoute("/capture/"),
          data: {
            api_key: AnalyticsKey,
            event: ProductEventName.DocsFeedbackGiven,
            distinct_id: crypto.randomUUID(),
            properties: {
              source: "oneuptime-docs",
              $process_person_profile: false,
              ...DocsFeedback.toEventProperties(answer),
            },
          },
        });

      if (result instanceof HTTPErrorResponse) {
        logger.error(
          `Docs feedback could not be sent: HTTP ${result.statusCode} ${result.message}`,
        );
        return false;
      }

      return true;
    } catch (err) {
      logger.error("Docs feedback could not be sent:");
      logger.error(err as Error);
      return false;
    }
  }
}
