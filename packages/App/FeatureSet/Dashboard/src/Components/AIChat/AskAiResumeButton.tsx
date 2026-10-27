import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // An answer is still being written; otherwise one came in, unread.
  isWorking: boolean;
  onOpen: () => void;
  onDismiss: () => void;
}

/*
 * The way back into a conversation the person stepped out of while Ask AI
 * was still answering: closing the dialog to look at the page loses
 * nothing, and this says when the answer is ready. Shown only then - while
 * an answer is being written, and once it came in until it is read - under
 * side panels and dialogs, where nothing else of the app floats: the
 * bottom corner the new version notice leaves free, and on a phone, where
 * that notice spans the whole foot of the screen, just under the header.
 */
const AskAiResumeButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const label: string = props.isWorking
    ? (translator.translateText("Ask AI is answering…") as string)
    : (translator.translateText("Ask AI has answered") as string);

  return (
    <div
      data-testid="ask-ai-resume"
      className="ou-ai-rise fixed end-4 top-20 z-[25] flex items-center gap-0.5 rounded-full bg-white p-1 shadow-lg ring-1 ring-black/5 print:hidden sm:bottom-6 sm:end-6 sm:top-auto"
    >
      <button
        type="button"
        data-testid="ask-ai-resume-open"
        onClick={props.onOpen}
        className="flex items-center gap-2 rounded-full py-1.5 pe-3 ps-2.5 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        {props.isWorking ? (
          <span
            aria-hidden="true"
            className="ou-ai-pulse h-2 w-2 flex-shrink-0 rounded-full bg-indigo-500"
          ></span>
        ) : (
          <Icon
            icon={IconProp.Sparkles}
            className="h-4 w-4 flex-shrink-0 text-indigo-500"
          />
        )}
        <span role="status">{label}</span>
      </button>
      <button
        type="button"
        title={translator.translateText("Dismiss")}
        aria-label={translator.translateText("Dismiss")}
        data-testid="ask-ai-resume-dismiss"
        onClick={props.onDismiss}
        className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

export default AskAiResumeButton;
