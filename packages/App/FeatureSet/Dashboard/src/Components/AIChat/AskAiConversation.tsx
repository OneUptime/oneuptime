import ChatMessageList from "./ChatMessageList";
import { ToolDecision } from "./ToolApprovalCard";
import { ChatMessageFeedback, UseAiChat } from "./useAiChat";
import AIConversationMessage from "Common/Models/DatabaseModels/AIConversationMessage";
import AIChatMessageRole from "Common/Types/AI/AIChatMessageRole";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  chat: UseAiChat;
}

// The room left above a question scrolled to the top: the thread's padding.
const QUESTION_TOP_GAP_PX: number = 24;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/*
 * The conversation, and how it scrolls. Nothing follows the answer as it
 * comes in: a question just asked is scrolled to the top, and the answer
 * is written into the room below it - the last turn is at least as tall as
 * the conversation's window - so nothing on screen moves while it arrives,
 * and a long answer is read from its first line, not caught at its last.
 * A conversation opened from the history shows its last question the same
 * way.
 */
const AskAiConversation: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const chat: UseAiChat = props.chat;
  const scrollRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const lastTurnRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const [viewportHeight, setViewportHeight] = useState<number>(0);

  // The conversation window's height, followed as the dialog resizes.
  useLayoutEffect(() => {
    const container: HTMLDivElement | null = scrollRef.current;

    if (!container) {
      return undefined;
    }

    const measure: () => void = (): void => {
      setViewportHeight(container.clientHeight);
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => {
        window.removeEventListener("resize", measure);
      };
    }

    const observer: ResizeObserver = new ResizeObserver(measure);
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, []);

  const questionCount: number = chat.messages.filter(
    (message: AIConversationMessage): boolean => {
      return message.role === AIChatMessageRole.User;
    },
  ).length;

  const scrollToLastQuestion: (isSmooth: boolean) => void = (
    isSmooth: boolean,
  ): void => {
    const container: HTMLDivElement | null = scrollRef.current;
    const lastTurn: HTMLDivElement | null = lastTurnRef.current;

    if (!container || !lastTurn || typeof container.scrollTo !== "function") {
      return;
    }

    const top: number =
      lastTurn.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop -
      QUESTION_TOP_GAP_PX;

    container.scrollTo({
      top: Math.max(top, 0),
      behavior: isSmooth && !prefersReducedMotion() ? "smooth" : "auto",
    });
  };

  /*
   * A question just asked: scrolled to the top as it is sent. A
   * conversation that comes into view - opened from the history, or the
   * dialog opened again on it - shows its last question at once.
   */
  const shownConversationRef: React.MutableRefObject<string | null> = useRef<
    string | null
  >(null);
  const questionCountRef: React.MutableRefObject<number> = useRef<number>(0);

  useEffect(() => {
    const conversationKey: string = chat.activeConversationId || "";

    if (chat.isLoadingConversation) {
      return;
    }

    if (conversationKey !== shownConversationRef.current) {
      const isFirstSend: boolean =
        shownConversationRef.current === "" && questionCount <= 1;
      shownConversationRef.current = conversationKey;
      questionCountRef.current = questionCount;

      // The first question of a conversation started here is already on top.
      if (!isFirstSend) {
        scrollToLastQuestion(false);
      }
      return;
    }

    if (questionCount > questionCountRef.current) {
      scrollToLastQuestion(true);
    }

    questionCountRef.current = questionCount;
  }, [chat.activeConversationId, chat.isLoadingConversation, questionCount]);

  return (
    <div
      ref={scrollRef}
      data-testid="ai-chat-thread"
      /*
       * overscroll-contain in addition to the page lock, not instead of
       * it: it stops the wheel past the end of the thread from chaining
       * outward at all, so no rubber-band or pull-to-refresh fires on the
       * surface behind.
       */
      className="h-full overflow-y-auto overscroll-contain"
    >
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        {chat.isLoadingConversation && chat.messages.length === 0 ? (
          <div
            role="status"
            data-testid="ai-chat-thread-loading"
            className="flex justify-center py-16"
          >
            <span className="sr-only">
              {translator.translateText("Loading…")}
            </span>
            <span
              aria-hidden="true"
              className="h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500 motion-reduce:animate-none"
            ></span>
          </div>
        ) : (
          <ChatMessageList
            /*
             * One log region per conversation: a conversation opened from
             * the history is read as it is, not announced message by
             * message as if it were being written.
             */
            key={chat.activeConversationId || "new"}
            messages={chat.messages}
            latestRun={chat.latestRun}
            isWorking={chat.isWorking}
            runEvents={chat.runEvents}
            lastTurnRef={lastTurnRef}
            lastTurnMinHeight={
              viewportHeight > 0
                ? Math.max(viewportHeight - 2 * QUESTION_TOP_GAP_PX, 0)
                : undefined
            }
            isSubmittingApproval={chat.isSubmittingApproval}
            onRespondToApproval={(
              assistantMessageId: string,
              decisions: Array<ToolDecision>,
            ) => {
              chat
                .respondToApproval(assistantMessageId, decisions)
                .catch(() => {
                  // handled in the hook
                });
            }}
            onFeedback={(
              messageId: string,
              feedback: ChatMessageFeedback | null,
            ) => {
              chat.sendFeedback(messageId, feedback).catch(() => {
                // handled in the hook
              });
            }}
            onRetry={(assistantMessageId: string) => {
              chat.retryAnswer(assistantMessageId);
            }}
          />
        )}
      </div>
    </div>
  );
};

export default AskAiConversation;
