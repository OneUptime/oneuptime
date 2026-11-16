import { toFeedbackTopic } from "../../../Types/ProductFeedback/ProductFeedback";

/*
 * A HELP DIALOG'S CONTENT (#8889).
 *
 * What a list's help (?) opens: a title and a line under it, in English,
 * which the dialog looks up in the reader's language, and a document in
 * plain markdown, which stays English, as the docs it summarizes do.
 *
 * The document has one shape, so every help dialog reads the same way:
 *
 *   One to three sentences that say what the thing is and what it does
 *   for you. The dialog shows them first, as "In short".
 *
 *   ## A Topic
 *
 *   What a person needs to do comes first; reference (match criteria,
 *   statuses, limits) after it. Each "##" heading is a topic the dialog
 *   lists and opens on its own (HelpDocument), so the document is never a
 *   wall to scroll through. "###" headings stay inside their topic.
 *
 * No heading repeats the dialog's title, and nothing draws a line between
 * the topics: the dialog draws its own. Docs/ux/README.md#help-dialogs
 * holds the rules, and HelpDialogsGuard keeps every page to them.
 */
export interface HelpContent {
  // In English: the dialog looks it up ("How SLOs Work").
  title: string;
  // One line under the title, in English: looked up too.
  description?: string | undefined;
  // The document: a lead, then "##" topics. English, drawn as written.
  markdown: string;
}

/*
 * The topic "Was this clear?" keeps a help dialog's answers under: its
 * English title, as a word the code chose ("help.how_slos_work"), so an
 * answer is filed the same way in every language.
 */
export const HELP_FEEDBACK_TOPIC_PREFIX: string = "help.";

export const getHelpFeedbackTopic: (title: string) => string = (
  title: string,
): string => {
  return toFeedbackTopic(`${HELP_FEEDBACK_TOPIC_PREFIX}${title}`)
    .replace(/_+/g, "_")
    .replace(/_$/, "");
};
