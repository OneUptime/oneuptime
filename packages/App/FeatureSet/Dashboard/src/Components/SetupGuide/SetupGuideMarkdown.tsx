import React, { FunctionComponent, ReactElement } from "react";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";

export interface ComponentProps {
  text: string;
  /*
   * Wrap a code line too long for its box instead of scrolling it sideways
   * (SetupGuideContent.wrapLongLines).
   */
  wrapLongLines?: boolean | undefined;
}

/*
 * The code blocks' lines wrap, at a space where there is one and anywhere
 * in a long address or key where there is not. The highlighter writes
 * `white-space: pre` on the <pre> and its <code> as inline styles, so only
 * an !important rule takes it back.
 */
export const SETUP_GUIDE_WRAP_LONG_LINES_CLASS_NAME: string =
  "[&_pre]:!whitespace-pre-wrap [&_pre]:![overflow-wrap:anywhere] [&_pre_code]:!whitespace-pre-wrap [&_pre_code]:![overflow-wrap:anywhere]";

/*
 * A piece of a setup guide — a step's body, a folded topic — rendered as
 * markdown. The viewer spaces its blocks for a standalone document, so the
 * first block's top margin and the last block's bottom margin are removed
 * here: the guide's own layout spaces the pieces.
 */
const SetupGuideMarkdown: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.text.trim()) {
    return <></>;
  }

  return (
    <div
      className={[
        "min-w-0 [&>div>*:first-child]:mt-0 [&>div>*:last-child]:mb-0",
        props.wrapLongLines ? SETUP_GUIDE_WRAP_LONG_LINES_CLASS_NAME : "",
      ]
        .join(" ")
        .trim()}
    >
      <MarkdownViewer text={props.text} />
    </div>
  );
};

export default SetupGuideMarkdown;
