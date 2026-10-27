import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";

export enum AskAiMarkSize {
  Small = "Small",
  Large = "Large",
}

export interface ComponentProps {
  size: AskAiMarkSize;
}

/*
 * Ask AI's mark: the sparkles on an indigo-to-violet tile, the colours of
 * the header's Ask AI. Small beside the dialog's title, large over its
 * start. Decoration only: the words beside it name what it marks.
 */
const AskAiMark: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isLarge: boolean = props.size === AskAiMarkSize.Large;

  return (
    <div
      aria-hidden="true"
      data-testid="ask-ai-mark"
      className={`flex flex-shrink-0 items-center justify-center bg-gradient-to-br from-indigo-500 to-violet-600 text-white ${
        isLarge
          ? "h-12 w-12 rounded-2xl shadow-lg shadow-indigo-500/25"
          : "h-7 w-7 rounded-lg"
      }`}
    >
      <Icon
        icon={IconProp.Sparkles}
        className={isLarge ? "h-6 w-6" : "h-4 w-4"}
      />
    </div>
  );
};

export default AskAiMark;
