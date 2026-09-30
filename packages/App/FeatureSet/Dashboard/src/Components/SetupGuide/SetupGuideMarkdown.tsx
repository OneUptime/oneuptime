import React, { FunctionComponent, ReactElement } from "react";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";

export interface ComponentProps {
  text: string;
}

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
    <div className="min-w-0 [&>div>*:first-child]:mt-0 [&>div>*:last-child]:mb-0">
      <MarkdownViewer text={props.text} />
    </div>
  );
};

export default SetupGuideMarkdown;
