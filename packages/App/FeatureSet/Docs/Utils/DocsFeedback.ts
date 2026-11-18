import DocsNav, { NavGroup, NavLink } from "./Nav";
import { DEFAULT_DOCS_LANGUAGE, isSupportedDocsLanguage } from "./I18n";
import DocsAnalytics from "./DocsAnalytics";
import DocsFeedbackStore from "./DocsFeedbackStore";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import {
  ProductEventName,
  toProductEventProperties,
} from "Common/Types/Analytics/ProductEvent";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import { getNewGitHubIssueUrl } from "Common/Types/ProductFeedback/NewGitHubIssue";
import { DOCS_FEEDBACK_REASONS as REASONS } from "Common/Types/ProductFeedback/ProductFeedback";

/*
 * "WAS THIS PAGE HELPFUL?" (issues #6822, #7209).
 *
 * Every docs page ends with the question: yes or no, and after a no, what
 * went wrong, in one click. Where the answer goes depends on the
 * installation, and the page knows before anyone answers (getMode, passed
 * to Views/Partials/PageFeedback.ejs):
 *
 *   - send: where product analytics is set up - ANALYTICS_KEY and
 *     ANALYTICS_HOST, which OneUptime Cloud sets and a self-hosted server
 *     does not - the page posts the answer to /docs/feedback, only with the
 *     reader's consent (no "Reject all", no Global Privacy Control), as the
 *     Dashboard does, and this sends it on as `docs/feedback_given`
 *     (Common/Types/Analytics/ProductEvent), with the same rules as every
 *     product event: only the properties the catalog lists, the page's
 *     address and a reason the page chose, never words anyone wrote.
 *   - keep: where a master admin switched keeping them on (#7209, Admin
 *     Dashboard > Feedback, Utils/DocsFeedbackStore), the page posts the
 *     answer and says, under the question, that it goes to this server's
 *     admins: it is kept in this server's own database, for them, and sent
 *     nowhere else. It names nobody and no address, so the page needs no
 *     consent to post it; it is the answer the reader chose to give.
 *   - local: anywhere else nothing leaves the page, an air-gapped server
 *     included: a no offers "Tell us on GitHub" with the page's name filled
 *     in, which the reader may send or not.
 *
 * Where analytics is set up and the answers are kept too, the page posts as
 * it sends, with consent, and the server keeps what it was sent.
 *
 * A reader is never identified: each answer goes under an id of its own,
 * and PostHog keeps no person profile for it (Utils/DocsAnalytics).
 */

// What went wrong, as a no can say it in one click (Locales: ui.feedbackReason*).
export const DOCS_FEEDBACK_REASONS: ReadonlyArray<string> = REASONS;

export enum DocsFeedbackMode {
  Send = "send",
  Keep = "keep",
  Local = "local",
}

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
  // Whether an answer goes to product analytics: only where it is set up.
  public static isSent(): boolean {
    return DocsAnalytics.isSetUp();
  }

  /*
   * What the page does with an answer (see the header): send it where
   * analytics is set up, keep it where a master admin switched that on, or
   * nothing.
   */
  public static async getMode(): Promise<DocsFeedbackMode> {
    if (DocsFeedback.isSent()) {
      return DocsFeedbackMode.Send;
    }

    return (await DocsFeedbackStore.isKept())
      ? DocsFeedbackMode.Keep
      : DocsFeedbackMode.Local;
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
    return DocsAnalytics.getEdition();
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
    return await DocsAnalytics.capture({
      event: ProductEventName.DocsFeedbackGiven,
      properties: DocsFeedback.toEventProperties(answer),
      what: "Docs feedback",
    });
  }

  /*
   * What /docs/feedback does with an answer: sends it where analytics is
   * set up, and keeps it where the server keeps answers - each only there.
   */
  public static async take(answer: DocsFeedbackAnswer): Promise<void> {
    await Promise.all([
      DocsFeedback.send(answer),
      DocsFeedbackStore.keep(answer),
    ]);
  }
}
