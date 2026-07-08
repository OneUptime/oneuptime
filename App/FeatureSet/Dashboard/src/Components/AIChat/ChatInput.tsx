import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
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
   * Optional control rendered on the left of the composer footer (the model
   * switcher). Kept as a slot so the composer stays reusable across surfaces.
   */
  leading?: ReactElement | undefined;
  placeholder?: string | undefined;
}

const MAX_TEXTAREA_HEIGHT_PX: number = 160;

const ChatInput: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const textareaRef: React.RefObject<HTMLTextAreaElement> =
    useRef<HTMLTextAreaElement>(null);

  // Auto-grow with the content, capped at ~6 lines.
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

  const trySend: () => void = (): void => {
    if (!props.value.trim() || !props.canSend) {
      return;
    }
    props.onSend();
    // Keep the composer focused so the next question flows naturally.
    textareaRef.current?.focus();
  };

  const isSendable: boolean = Boolean(props.value.trim()) && props.canSend;

  return (
    <div className="border-t border-gray-200 bg-white px-4 pb-4 pt-3">
      <div className="flex items-end gap-2 rounded-2xl border border-gray-200 bg-white px-3.5 py-2.5 transition-all focus-within:border-gray-300 focus-within:ring-4 focus-within:ring-gray-900/[0.04]">
        <textarea
          ref={textareaRef}
          rows={1}
          value={props.value}
          autoFocus={true}
          placeholder={
            props.placeholder ||
            (props.isWorking
              ? "Type your next question — it can be sent when this answer finishes…"
              : "Ask about your logs, traces, metrics, incidents…")
          }
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
            props.onChange(event.target.value);
          }}
          onKeyDown={(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              trySend();
            }
          }}
          className="max-h-40 flex-1 resize-none border-0 bg-transparent p-0 text-sm leading-6 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0"
        />
        <button
          type="button"
          title="Send (Enter)"
          disabled={!isSendable}
          onClick={() => {
            trySend();
          }}
          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-colors ${
            isSendable
              ? "bg-gray-900 text-white hover:bg-gray-800"
              : "bg-gray-100 text-gray-300"
          }`}
        >
          {props.isWorking ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-200 border-t-gray-400"></span>
          ) : (
            <Icon icon={IconProp.PaperAirplane} className="h-4 w-4" />
          )}
        </button>
      </div>
      <div className="mt-2.5 space-y-2 px-1">
        {/*
         * Controls (model + permission pickers) get their own row so they can
         * breathe and never collide with the hint text on narrow surfaces.
         */}
        {props.leading}
        <div className="flex items-center justify-between gap-2 text-[11px] text-gray-400">
          <span className="min-w-0 truncate">
            <span className="font-medium text-gray-500">Enter</span> to send ·{" "}
            <span className="font-medium text-gray-500">Shift + Enter</span> for
            a new line
          </span>
          <span className="hidden flex-shrink-0 sm:inline">
            Every answer cites its queries
          </span>
        </div>
      </div>
    </div>
  );
};

export default ChatInput;
