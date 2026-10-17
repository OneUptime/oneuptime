import {
  CallSummaryCitation,
  CallSummaryRootCause,
  CallSummaryRootCauseOutcome,
} from "../../Types/VideoCall/CallSummary";
import FeedMarkdown, { MarkdownText, mdText } from "../Markdown/FeedMarkdown";

/*
 * THE ROOT CAUSE A PERSON STARTS FROM, when they use what OneUptime AI
 * suggested from an incident call (issue #4875).
 *
 * The suggestion, then each transcript line it rests on as a quote - time,
 * speaker, words - so the root cause keeps what it was based on. The person
 * edits it before it is saved; nothing is written to the incident before.
 *
 * Every piece is somebody else's text - the model wrote the sentence, a
 * participant said the words - so each is placed as text (mdText): an "*",
 * a "[link](...)" or an "![image](...)" in either reads as typed, never as
 * Markdown. A quote is a plain "> " quote: never a callout (the viewer
 * reads only "> [!KIND]" and "> **Note:**" as one, GuideCalloutsMarked).
 */
export default class CallSummaryMarkdown {
  public static buildRootCause(rootCause: CallSummaryRootCause): string {
    if (
      rootCause.outcome !== CallSummaryRootCauseOutcome.Suggested ||
      !rootCause.summary
    ) {
      return "";
    }

    const pieces: Array<MarkdownText> = [mdText`${rootCause.summary}`];

    for (const citation of rootCause.citations) {
      pieces.push(CallSummaryMarkdown.quote(citation));
    }

    return FeedMarkdown.join(pieces, "\n\n").toString();
  }

  // "> [00:12:03] Priya Shah: the words", each part as text.
  public static quote(citation: CallSummaryCitation): MarkdownText {
    const said: string = [
      citation.time ? `[${citation.time}]` : "",
      citation.speaker ? `${citation.speaker}:` : "",
      citation.text,
    ]
      .filter((piece: string): boolean => {
        return piece.length > 0;
      })
      .join(" ");

    return mdText`> ${said}`;
  }
}
