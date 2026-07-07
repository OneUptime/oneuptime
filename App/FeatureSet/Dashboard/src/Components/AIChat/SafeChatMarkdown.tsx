import MarkdownViewer from "Common/UI/Components/Markdown.tsx/MarkdownViewer";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  text: string;
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
 * server-minted citation chips rendered alongside the message.
 */
const SafeChatMarkdown: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return <MarkdownViewer text={props.text} safeMode={true} />;
};

export default SafeChatMarkdown;
