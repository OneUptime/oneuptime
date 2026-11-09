import AnswerCitationChip from "../AI/InvestigationConversation/AnswerCitationChip";
import InvestigationStopNote from "../AI/InvestigationReport/InvestigationStopNote";
import { AIChatCitation } from "Common/Types/AI/AIChatTypes";
import {
  AnswerStopNoteSplit,
  splitAnswerStopNote,
} from "Common/Utils/AI/InvestigationReport";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  text: string;
  /*
   * The server-minted citations of the answer. Its "[C3]" marks are drawn
   * as small chips that name what they cite and open it, instead of the
   * bare "[C3]" text an answer otherwise reads with after every claim. A
   * mark with no citation behind it stays plain text.
   */
  citations?: Array<AIChatCitation> | undefined;
}

/*
 * Renders assistant markdown with the exfiltration channels removed. The
 * assistant's answer is derived from attacker-influenceable telemetry, so a
 * prompt-injected response must not be able to render a tracking pixel or a
 * clickable exfil URL. Neutralization happens inside MarkdownViewer on the
 * PARSED markdown tree (safeMode): links become plain text and images are
 * never fetched. Doing it there — rather than regex-stripping the raw string
 * here — is what makes it robust: no CommonMark syntax edge case can slip a
 * link or image past the parser. Navigation happens only through the
 * server-minted citations: the chips in the text and the answer's sources.
 *
 * An answer a limit stopped ends with OneUptime's line saying so (issue
 * #6440). It is drawn under the answer as the AI card draws it - its own
 * line with an amber mark, the setting it names a link the Dashboard builds
 * (InvestigationStopNote), never the note's own address - instead of an
 * italic paragraph whose link was dotted text that went nowhere.
 */
const SafeChatMarkdown: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const citations: Array<AIChatCitation> = props.citations || [];
  const split: AnswerStopNoteSplit = splitAnswerStopNote(props.text);

  const answer: ReactElement =
    citations.length === 0 ? (
      <MarkdownViewer text={split.answerMarkdown} safeMode={true} />
    ) : (
      <MarkdownViewer
        text={split.answerMarkdown}
        safeMode={true}
        inlineReferences={{
          renderCitation: (citationId: string): ReactElement | null => {
            const citation: AIChatCitation | undefined = citations.find(
              (candidate: AIChatCitation): boolean => {
                return candidate.id === citationId;
              },
            );

            return citation ? <AnswerCitationChip citation={citation} /> : null;
          },
        }}
      />
    );

  if (!split.stopNote) {
    return answer;
  }

  return (
    <div className="space-y-3">
      {split.answerMarkdown.trim() ? answer : <></>}
      <InvestigationStopNote note={split.stopNote} />
    </div>
  );
};

export default SafeChatMarkdown;
