import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import {
  LLM_LOG_EVENTS_FAILED,
  LLM_LOG_EVENTS_NOT_ALLOWED,
} from "./LlmConversationCopy";

/*
 * WHY THE PROMPTS AND ANSWERS SENT AS LOG EVENTS ARE NOT ON SCREEN.
 *
 * One note for a conversation (LlmConversationView) and for one call's
 * details in the trace view (LlmSpanPanel), so both say it the same way:
 *
 *   - notAllowed: the reader may not read the app's logs. A quiet grey note
 *     with a lock, as the product shows what a permission hides ("Probes are
 *     hidden: you need permission ..."): nothing is broken, and there is
 *     nothing on this page to press.
 *   - failed: the logs could not be read. An amber note with the warning
 *     sign and Try again, the one thing to do.
 */

export type LlmLogEventsNoteState = "notAllowed" | "failed";

export interface ComponentProps {
  state: LlmLogEventsNoteState;
  // Reads the log events again (shown for "failed" only).
  onRetry: () => void;
  // "llm-conversation" or "llm-span": the note's and its button's test ids.
  testIdPrefix: string;
  // Spacing from what comes before it.
  className?: string | undefined;
  // Announce the note when it replaces a read in progress (the span panel).
  isAnnounced?: boolean | undefined;
}

const LlmLogEventsNote: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isFailed: boolean = props.state === "failed";

  return (
    <div
      className={`flex items-start gap-2 rounded-md px-3 py-2 text-xs ${
        isFailed ? "bg-amber-50 text-amber-800" : "bg-gray-50 text-gray-600"
      } ${props.className || ""}`.trim()}
      data-testid={`${props.testIdPrefix}-log-events-note`}
      data-state={props.state}
      {...(props.isAnnounced && isFailed ? { role: "alert" } : {})}
    >
      <Icon
        icon={isFailed ? IconProp.Alert : IconProp.Lock}
        className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
          isFailed ? "text-amber-600" : "text-gray-400"
        }`}
      />
      <div className="min-w-0">
        {isFailed
          ? translator.translateText(LLM_LOG_EVENTS_FAILED)
          : translator.translateText(LLM_LOG_EVENTS_NOT_ALLOWED)}
        {isFailed ? (
          <>
            {" "}
            <button
              type="button"
              className="rounded font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              data-testid={`${props.testIdPrefix}-log-events-retry`}
              onClick={props.onRetry}
            >
              {translator.translateText("Try again")}
            </button>
          </>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default LlmLogEventsNote;
