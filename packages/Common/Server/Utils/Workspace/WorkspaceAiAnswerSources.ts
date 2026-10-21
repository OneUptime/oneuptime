import { AIChatCitation } from "../../../Types/AI/AIChatTypes";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";

/*
 * THE SOURCES UNDER AN ANSWER FROM ONEUPTIME AI IN SLACK OR MICROSOFT TEAMS.
 *
 * An answer ends with what it was read from, one line a source: its label,
 * and how many rows it gave.
 *
 *   • Monitor statuses (2 rows)
 *   • Deployments (1 row)
 *
 * Both chats wrote "(1 rows)" for a source that gave one. They write the
 * lines here now, so they count the same way.
 */
export default class WorkspaceAiAnswerSources {
  /*
   * One line a source. A label is text OneUptime minted for the query, with
   * code in backticks (FeedMarkdown.textWithCode): nothing in it acts on its
   * own in a chat.
   */
  public static getLines(
    citations: Array<AIChatCitation>,
  ): Array<MarkdownText> {
    return citations.map((citation: AIChatCitation): MarkdownText => {
      return mdText`• ${FeedMarkdown.textWithCode(citation.label)} (${WorkspaceAiAnswerSources.getRowCountText(citation.rowCount)})`;
    });
  }

  /*
   * "2 rows", "1 row", and "0 rows" for a source that was read and gave
   * nothing - which is part of the answer too.
   */
  public static getRowCountText(rowCount: number): string {
    return rowCount === 1 ? "1 row" : `${rowCount} rows`;
  }
}
