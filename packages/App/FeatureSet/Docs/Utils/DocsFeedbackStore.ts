import { AppVersion } from "Common/Server/EnvironmentConfig";
import logger from "Common/Server/Utils/Logger";
import {
  DocsFeedbackReason,
  ProductFeedbackSubmission,
  toDocsFeedbackSubmission,
} from "Common/Types/ProductFeedback/ProductFeedback";

/*
 * "WAS THIS PAGE HELPFUL?", KEPT ON THIS SERVER FOR ITS ADMINS (#7209).
 *
 * Off by default. A master admin may switch it on (Admin Dashboard >
 * Feedback, GlobalConfig.keepDocsFeedback): each answer is then kept in
 * this server's own database - the page, its language, yes or no, for a no
 * what went wrong, and the version - and never sent anywhere else. Admin
 * Dashboard > Feedback lists the pages that fail people first.
 *
 * The docs reach the database through a keeper the App hands them when it
 * starts (App/Index.ts: ProductFeedbackService), never on their own: the
 * docs' pages are drawn without a database in their own tests, and with no
 * keeper nothing is kept, as before.
 */

export interface DocsFeedbackKeeper {
  isDocsFeedbackKept(): Promise<boolean>;
  keepDocsAnswer(submission: ProductFeedbackSubmission): Promise<boolean>;
}

// An answer as Utils/DocsFeedback read it from the page.
export interface DocsFeedbackAnswerToKeep {
  page: string;
  isHelpful: boolean;
  reason?: string | undefined;
  language: string;
}

export default class DocsFeedbackStore {
  private static keeper: DocsFeedbackKeeper | null = null;

  // The App's: ProductFeedbackService. Null keeps nothing.
  public static useKeeper(keeper: DocsFeedbackKeeper | null): void {
    DocsFeedbackStore.keeper = keeper;
  }

  /*
   * Whether this server keeps the answers: only once a master admin has
   * switched it on, and never when that cannot be read.
   */
  public static async isKept(): Promise<boolean> {
    if (!DocsFeedbackStore.keeper) {
      return false;
    }

    try {
      return await DocsFeedbackStore.keeper.isDocsFeedbackKept();
    } catch (err) {
      logger.error("Whether docs feedback is kept could not be read:");
      logger.error(err as Error);
      return false;
    }
  }

  /*
   * Keeps an answer, while the server keeps them: the page, its language,
   * yes or no, a no's reason and the version - nothing else. Never throws:
   * an answer is never worth an error. Whether it was kept.
   */
  public static async keep(answer: DocsFeedbackAnswerToKeep): Promise<boolean> {
    if (!DocsFeedbackStore.keeper) {
      return false;
    }

    const submission: ProductFeedbackSubmission | null =
      toDocsFeedbackSubmission({
        page: answer.page,
        language: answer.language,
        isHelpful: answer.isHelpful,
        reason: answer.reason as DocsFeedbackReason | undefined,
        // The release this server runs; "unknown" where APP_VERSION is unset.
        version:
          typeof AppVersion === "string" && AppVersion !== "unknown"
            ? AppVersion
            : "",
      });

    if (!submission) {
      return false;
    }

    try {
      return await DocsFeedbackStore.keeper.keepDocsAnswer(submission);
    } catch (err) {
      logger.error("Docs feedback could not be kept:");
      logger.error(err as Error);
      return false;
    }
  }
}
