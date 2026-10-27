import AnswerCitationChip from "../AI/InvestigationConversation/AnswerCitationChip";
import { AIChatCitation } from "Common/Types/AI/AIChatTypes";
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
 */
const SafeChatMarkdown: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const citations: Array<AIChatCitation> = props.citations || [];

  if (citations.length === 0) {
    return <MarkdownViewer text={props.text} safeMode={true} />;
  }

  return (
    <MarkdownViewer
      text={props.text}
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
};

export default SafeChatMarkdown;
