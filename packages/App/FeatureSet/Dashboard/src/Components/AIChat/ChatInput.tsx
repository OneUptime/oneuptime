import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
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
   * Send is gated while a response is generating; typing stays enabled so
   * composing the next question feels natural.
   */
  canSend: boolean;
  isWorking: boolean;
  /*
   * When provided and a run is working, the send button becomes a Stop button
   * that cancels the in-flight run — operators learn things mid-investigation
   * and should never be locked out for the full turn budget.
   */
  onStop?: (() => void) | undefined;
  isStopping?: boolean | undefined;
  /*
   * Controls drawn inside the composer, on its bottom row beside the send
   * button: the model and what Ask AI may do. Kept as a slot so the
   * composer stays reusable across surfaces.
   */
  leading?: ReactElement | undefined;
  /*
   * The page-context pill, drawn inside the composer above the textarea:
   * like an attachment, it shows what the question is grounded in.
   */
  contextChip?: ReactElement | undefined;
  placeholder?: string | undefined;
  // Focus the textarea when the composer is drawn. Defaults to true.
  autoFocus?: boolean | undefined;
}

const MAX_TEXTAREA_HEIGHT_PX: number = 160;

/*
 * Ask AI's composer: one box holding what the question is about, the
 * question, and the few controls that shape the answer - nothing under it.
 * Enter sends and Shift + Enter starts a new line, as in every chat; the
 * send button says so to a pointer and a screen reader.
 */
const ChatInput: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const textareaRef: React.RefObject<HTMLTextAreaElement> =
    useRef<HTMLTextAreaElement>(null);

  /*
   * Auto-grow with the content, capped at ~6 lines. Measured again a frame
   * later: the Dashboard draws its Tailwind as classes first appear, so the
   * first time the composer is drawn its padding and line height may not be
   * styled yet when it is measured, and the box set from that measure cut
   * the question in half. Its min-height keeps one whole line meanwhile.
   */
  useEffect(() => {
    const measure: () => void = (): void => {
      const textarea: HTMLTextAreaElement | null = textareaRef.current;
      if (!textarea) {
        return;
      }
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(
        textarea.scrollHeight,
        MAX_TEXTAREA_HEIGHT_PX,
      )}px`;
    };

    measure();
    const frame: number = requestAnimationFrame(measure);

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [props.value]);

  const trySend: () => void = (): void => {
    if (!props.value.trim() || !props.canSend) {
      return;
    }
    props.onSend();
    // Keep the composer focused so the next question flows naturally.
    textareaRef.current?.focus();
  };

  const isSendable: boolean = Boolean(props.value.trim()) && props.canSend;

  const placeholder: string = translator.translateText(
    props.placeholder || "Ask anything…",
  ) as string;

  return (
    <div
      data-testid="ai-chat-composer"
      className="rounded-2xl border border-gray-200 bg-white shadow-sm transition-shadow duration-150 focus-within:border-gray-300 focus-within:shadow-md motion-reduce:transition-none"
    >
      {props.contextChip && (
        <div className="flex min-w-0 px-3 pt-3">{props.contextChip}</div>
      )}
      <textarea
        ref={textareaRef}
        rows={1}
        value={props.value}
        autoFocus={props.autoFocus ?? true}
        aria-label={placeholder}
        placeholder={placeholder}
        onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
          props.onChange(event.target.value);
        }}
        onKeyDown={(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            trySend();
          }
        }}
        className="block max-h-40 min-h-[2.5rem] w-full resize-none overscroll-contain border-0 bg-transparent px-4 pb-1 pt-3 text-sm leading-6 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0"
      />
      <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {props.leading}
        </div>
        {props.isWorking && props.onStop ? (
          <button
            type="button"
            title={translator.translateText("Stop generating")}
            aria-label={translator.translateText("Stop generating")}
            data-testid="ai-chat-stop"
            disabled={props.isStopping}
            onClick={() => {
              props.onStop?.();
            }}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-900 text-white transition-colors hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            {props.isStopping ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-500 border-t-white motion-reduce:animate-none"></span>
            ) : (
              <span className="h-2.5 w-2.5 rounded-[2px] bg-white"></span>
            )}
          </button>
        ) : (
          <button
            type="button"
            title={translator.translateText("Send (Enter)")}
            aria-label={translator.translateText("Send (Enter)")}
            data-testid="ai-chat-send"
            disabled={!isSendable}
            onClick={() => {
              trySend();
            }}
            className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
              isSendable
                ? "bg-gray-900 text-white hover:bg-gray-700"
                : "bg-gray-100 text-gray-400"
            }`}
          >
            <Icon icon={IconProp.ArrowUp} className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
};

export default ChatInput;
