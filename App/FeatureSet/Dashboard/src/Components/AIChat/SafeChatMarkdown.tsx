import MarkdownViewer from "Common/UI/Components/Markdown.tsx/MarkdownViewer";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  text: string;
}

/*
 * Renders assistant markdown with the exfiltration channels removed: every
 * form of link/image markdown is stripped down to its text, and bare URLs
 * are wrapped in code spans so remark-gfm's autolink-literal extension does
 * not turn them into clickable anchors. Telemetry content is
 * attacker-influenceable, so a prompt-injected answer must not be able to
 * render a tracking pixel or a clickable exfil URL. Navigation happens only
 * through server-minted citation chips.
 */
const SafeChatMarkdown: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  let text: string = props.text;

  // Reference definitions: [ref]: https://url "title" -> removed entirely.
  text = text.replace(/^[ \t]{0,3}\[[^\]]+\]:[ \t]+\S+.*$/gm, "");

  // Images, inline or reference-style: ![alt](url) / ![alt][ref] -> alt
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/!\[([^\]]*)\]\[[^\]]*\]/g, "$1");

  // Links, inline or reference-style: [text](url) / [text][ref] -> text
  text = text.replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1");
  text = text.replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1");

  // Autolinks: <https://example.com> -> bare text (neutralized below).
  text = text.replace(/<(https?:\/\/[^>]+)>/g, "$1");

  /*
   * Bare URLs and www. literals: remark-gfm autolinks them. Wrap in code
   * spans (unless already inside backticks) so they render as plain text.
   */
  text = text.replace(
    /(^|[^`])((?:https?:\/\/|www\.)[^\s`<>"')\]]+)/g,
    (_full: string, prefix: string, url: string): string => {
      return `${prefix}\`${url}\``;
    },
  );

  return <MarkdownViewer text={text} />;
};

export default SafeChatMarkdown;
