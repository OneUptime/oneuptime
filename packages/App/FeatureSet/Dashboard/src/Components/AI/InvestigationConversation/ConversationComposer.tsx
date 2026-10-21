import PermissionModePicker from "../../AIChat/PermissionModePicker";
import { describePermissionMode } from "./InvestigationConversationData";
import AIChatPermissionMode from "Common/Types/AI/AIChatPermissionMode";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
} from "react";

export interface ComponentProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  /*
   * Sending is gated while an answer is being written; typing never is, so
   * the next question can be composed while the current one is answered.
   */
  canSend: boolean;
  isWorking: boolean;
  /*
   * With an answer in flight the send button becomes Stop: responders learn
   * things mid-answer and are never locked out until it finishes.
   */
  onStop?: (() => void) | undefined;
  isStopping?: boolean | undefined;
  // In the reader's language: the caller translates it.
  placeholder: string;
  // The text box's accessible name, in the reader's language.
  label: string;
  permissionMode: AIChatPermissionMode;
  onPermissionModeChange: (mode: AIChatPermissionMode) => void;
}

const MAX_TEXTAREA_HEIGHT_PX: number = 160;

const BUTTON_CLASS_NAME: string =
  "flex h-8 w-8 items-center justify-center rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

const SPINNER_CLASS_NAME: string =
  "h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin";

/*
 * Where a responder types to OneUptime AI, at the foot of the AI
 * Investigation card. It is one control: the text, what the AI may do with
 * the request (and what that means, said next to the choice), and Send. It
 * looks like the dashboard's other inputs (gray-300 frame, indigo focus)
 * because it sits on a page among them; the Ask AI side panel keeps its own
 * composer (AIChat/ChatInput).
 *
 * It never takes focus by itself: loading an incident must not jump to it.
 */
const ConversationComposer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const textareaRef: React.RefObject<HTMLTextAreaElement> =
    useRef<HTMLTextAreaElement>(null);

  // Grow with the text, up to about six lines.
  useEffect(() => {
    const textarea: HTMLTextAreaElement | null = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(
      textarea.scrollHeight,
      MAX_TEXTAREA_HEIGHT_PX,
    )}px`;
  }, [props.value]);

  const isSendable: boolean = Boolean(props.value.trim()) && props.canSend;

  const trySend: () => void = (): void => {
    if (!isSendable) {
      return;
    }

    props.onSend();
    // Keep the caret in the box so the next question flows naturally.
    textareaRef.current?.focus();
  };

  return (
    <div data-testid="investigation-conversation-composer">
      <div className="rounded-xl border border-gray-300 bg-white shadow-sm transition-shadow focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500">
        <textarea
          ref={textareaRef}
          rows={1}
          value={props.value}
          aria-label={props.label}
          placeholder={props.placeholder}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
            props.onChange(event.target.value);
          }}
          onKeyDown={(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              trySend();
            }
          }}
          className="block max-h-40 w-full resize-none border-0 bg-transparent px-3.5 pb-1 pt-3 text-sm leading-6 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0"
        />
        {/*
          The sentence belongs to the choice beside it. On a phone there is
          no room between the picker and Send, so it takes the row under
          them instead of wrapping into a column a few words wide.
        */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-2.5 pb-2.5 pt-1.5">
          <PermissionModePicker
            value={props.permissionMode}
            onChange={props.onPermissionModeChange}
            menuAlign="left"
          />
          <p
            data-testid="investigation-conversation-mode"
            className="order-last basis-full text-xs leading-5 text-gray-500 sm:order-none sm:min-w-0 sm:flex-1 sm:basis-0"
          >
            {translator.translateText(
              describePermissionMode(props.permissionMode),
            )}
          </p>
          <div className="ml-auto flex-shrink-0">
            {props.isWorking && props.onStop ? (
              <button
                type="button"
                title={translator.translateText("Stop generating")}
                disabled={props.isStopping}
                onClick={() => {
                  props.onStop?.();
                }}
                className={`${BUTTON_CLASS_NAME} bg-gray-900 text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {props.isStopping ? (
                  <span className={SPINNER_CLASS_NAME} />
                ) : (
                  <span className="h-2.5 w-2.5 rounded-[2px] bg-current" />
                )}
              </button>
            ) : (
              <button
                type="button"
                title={translator.translateText("Send (Enter)")}
                disabled={!isSendable}
                onClick={trySend}
                className={`${BUTTON_CLASS_NAME} ${
                  isSendable
                    ? "bg-indigo-600 text-white shadow-sm hover:bg-indigo-500"
                    : "cursor-not-allowed bg-gray-100 text-gray-400"
                }`}
              >
                {props.isWorking ? (
                  <span className={SPINNER_CLASS_NAME} />
                ) : (
                  <Icon icon={IconProp.PaperAirplane} className="h-4 w-4" />
                )}
              </button>
            )}
          </div>
        </div>
      </div>
      {/*
        A keyboard hint is no use on a phone. The keys keep their names in
        every language; the sentence around them is translated whole.
      */}
      <p className="mt-2 text-[11px] leading-4 text-gray-400 max-sm:hidden">
        <TranslatedSentence
          template="{{enter}} to send · {{shiftEnter}} for a new line"
          slots={{
            enter: (
              <kbd className="font-sans font-medium text-gray-500">Enter</kbd>
            ),
            shiftEnter: (
              <kbd className="font-sans font-medium text-gray-500">
                Shift + Enter
              </kbd>
            ),
          }}
        />
      </p>
    </div>
  );
};

export default ConversationComposer;
