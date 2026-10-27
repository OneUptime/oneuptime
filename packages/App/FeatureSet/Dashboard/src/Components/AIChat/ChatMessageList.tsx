import AIConversationMessage, {
  AIConversationMessageFeedback,
} from "Common/Models/DatabaseModels/AIConversationMessage";
import AIRun from "Common/Models/DatabaseModels/AIRun";
import AIRunEvent from "Common/Models/DatabaseModels/AIRunEvent";
import AIChatMessageRole from "Common/Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "Common/Types/AI/AIChatMessageStatus";
import {
  AIChatCitation,
  AIChatToolAction,
  AIChatWidget,
} from "Common/Types/AI/AIChatTypes";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useClipboardCopy, {
  ClipboardCopy,
  ClipboardCopyStatus,
} from "Common/UI/Utils/UseClipboardCopy";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useId,
  useState,
} from "react";
import AnswerSources from "../AI/InvestigationConversation/AnswerSources";
import ChatActivityFeed, {
  describeLiveActivity,
  LiveActivity,
} from "./ChatActivityFeed";
import SafeChatMarkdown from "./SafeChatMarkdown";
import ToolApprovalCard, { ToolDecision } from "./ToolApprovalCard";
import WidgetRenderer from "./Widgets/WidgetRenderer";
import { ChatMessageFeedback } from "./useAiChat";

export interface ComponentProps {
  messages: Array<AIConversationMessage>;
  // Run of the newest completed assistant message: its tokens and cost.
  latestRun?: AIRun | undefined;
  isSubmittingApproval: boolean;
  onRespondToApproval: (
    assistantMessageId: string,
    decisions: Array<ToolDecision>,
  ) => void;
  // Thumbs rating on an assistant answer; clicking the active thumb clears it.
  onFeedback?:
    | ((messageId: string, feedback: ChatMessageFeedback | null) => void)
    | undefined;
  // Asks again the question a failed answer was for.
  onRetry?: ((assistantMessageId: string) => void) | undefined;
  /*
   * While an answer is being written: its run's events, drawn as one quiet
   * line at the end of the last turn that opens into its steps.
   */
  isWorking?: boolean | undefined;
  runEvents?: Array<AIRunEvent> | undefined;
  /*
   * The last turn's least height, so its question can be scrolled to the
   * top of the conversation and the answer written into the room below it,
   * with nothing above moving while it comes in.
   */
  lastTurnMinHeight?: number | undefined;
  lastTurnRef?: React.Ref<HTMLDivElement> | undefined;
}

/*
 * A turn: what the person asked and everything Ask AI answered it with.
 * Messages before the first question (none, in practice) make a turn of
 * their own. A turn is keyed by its place, not by its question's id: the
 * question shown the moment it is sent is replaced by the one the server
 * saved, under a new id, and the turn - and the question a screen reader
 * already heard - must stay the same element through that.
 */
export interface ChatTurn {
  key: string;
  messages: Array<AIConversationMessage>;
}

export function groupIntoTurns(
  messages: Array<AIConversationMessage>,
): Array<ChatTurn> {
  const turns: Array<ChatTurn> = [];

  for (const message of messages) {
    const lastTurn: ChatTurn | undefined = turns[turns.length - 1];

    if (message.role === AIChatMessageRole.User || !lastTurn) {
      turns.push({
        key: `turn-${turns.length}`,
        messages: [message],
      });
      continue;
    }

    lastTurn.messages.push(message);
  }

  return turns;
}

/*
 * An answer still being written with nothing to show yet - no chart, no
 * action - is drawn as the live line, not as an empty message.
 */
function isWrittenSoFar(message: AIConversationMessage): boolean {
  return (
    (message.status !== AIChatMessageStatus.InProgress &&
      message.status !== AIChatMessageStatus.Pending) ||
    (message.widgets || []).length > 0 ||
    (message.toolActions || []).length > 0
  );
}

const QUIET_BUTTON_CLASS_NAME: string =
  "inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

/*
 * The one line an answer being written shows, instead of each step
 * narrated as it happens: what it is doing now ("Searching logs…"), and how
 * many steps it took so far, which open into the steps themselves. A
 * screen reader hears that Ask AI is working once, not every step.
 */
const LiveLine: FunctionComponent<{ events: Array<AIRunEvent> }> = (props: {
  events: Array<AIRunEvent>;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const stepsId: string = useId();
  const live: LiveActivity = describeLiveActivity(props.events, translator);

  return (
    <div data-testid="ai-chat-live" className="ou-ai-rise">
      <div className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1">
        <span
          aria-hidden="true"
          className="ou-ai-pulse h-2 w-2 flex-shrink-0 rounded-full bg-indigo-500"
        ></span>
        <span className="sr-only">
          {translator.translateText("Ask AI is working on an answer.")}
        </span>
        <span
          aria-hidden="true"
          data-testid="ai-chat-live-step"
          className="ou-ai-shimmer min-w-0 break-words text-sm font-medium"
        >
          {live.text}…
        </span>
        {live.stepCount > 0 ? (
          <button
            type="button"
            aria-expanded={isOpen}
            aria-controls={isOpen ? stepsId : undefined}
            data-testid="ai-chat-live-steps-toggle"
            onClick={() => {
              setIsOpen((open: boolean) => {
                return !open;
              });
            }}
            className={`${QUIET_BUTTON_CLASS_NAME} text-xs`}
          >
            {isOpen
              ? translator.translateText("Hide steps")
              : translator.translatePlural(
                  { one: "{{count}} step", other: "{{count}} steps" },
                  live.stepCount,
                )}
            <Icon
              icon={IconProp.ChevronDown}
              className={`h-3 w-3 transition-transform duration-150 motion-reduce:transition-none ${
                isOpen ? "rotate-180" : ""
              }`}
            />
          </button>
        ) : (
          <></>
        )}
      </div>
      {isOpen ? (
        <div
          id={stepsId}
          data-testid="ai-chat-live-steps"
          className="mt-2 border-s-2 border-gray-100 ps-3"
        >
          <ChatActivityFeed
            events={props.events}
            hideChrome={true}
            showLiveIndicator={false}
            maxVisibleSteps={30}
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

const ChatMessageList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const listId: string = useId();
  /*
   * An answer's Copy says "Copied" once the answer is on the clipboard and
   * "Copy failed" when the browser refused. It threw on a page served over
   * plain http, where the browser has no clipboard API (issue #5132).
   */
  const clipboard: ClipboardCopy = useClipboardCopy({ copiedForMs: 1500 });
  // The answers whose sources are open.
  const [openSources, setOpenSources] = useState<Set<string>>(new Set());

  const lastCompletedAssistantId: string | undefined = [...props.messages]
    .reverse()
    .find((message: AIConversationMessage) => {
      return (
        message.role === AIChatMessageRole.Assistant &&
        message.status === AIChatMessageStatus.Completed
      );
    })
    ?.id?.toString();

  const turns: Array<ChatTurn> = groupIntoTurns(props.messages);

  const copyMessage: (message: AIConversationMessage) => void = (
    message: AIConversationMessage,
  ): void => {
    if (!message.contentInMarkdown) {
      return;
    }

    void clipboard.copy(
      message.contentInMarkdown,
      message.id?.toString() || "",
    );
  };

  const toggleSources: (messageId: string, panelId: string) => void = (
    messageId: string,
    panelId: string,
  ): void => {
    const isOpening: boolean = !openSources.has(messageId);

    setOpenSources((current: Set<string>) => {
      const next: Set<string> = new Set(current);

      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }

      return next;
    });

    /*
     * Sources opened under the last answer sit below the fold, under the
     * composer: brought into view, as little as it takes.
     */
    if (isOpening && typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        const panel: HTMLElement | null = document.getElementById(panelId);

        if (panel && typeof panel.scrollIntoView === "function") {
          panel.scrollIntoView({
            block: "nearest",
            behavior:
              typeof window.matchMedia === "function" &&
              window.matchMedia("(prefers-reduced-motion: reduce)").matches
                ? "auto"
                : "smooth",
          });
        }
      });
    }
  };

  type RenderCopyButtonContentFunction = (messageId: string) => ReactElement;

  /*
   * The icon and the word for one answer's Copy, after what it last did.
   * At rest it is an icon whose word only a screen reader hears; what a
   * copy did is said on screen.
   */
  const renderCopyButtonContent: RenderCopyButtonContentFunction = (
    messageId: string,
  ): ReactElement => {
    const status: ClipboardCopyStatus = clipboard.statusOf(messageId);

    let icon: ReactElement = (
      <Icon icon={IconProp.Copy} className="h-3.5 w-3.5" />
    );
    let text: string | undefined = translator.translateText("Copy");
    let textClassName: string = "sr-only";

    if (status === ClipboardCopyStatus.Copied) {
      icon = (
        <Icon icon={IconProp.Check} className="h-3.5 w-3.5 text-emerald-600" />
      );
      text = translator.translateText("Copied");
      textClassName = "text-emerald-600";
    } else if (status === ClipboardCopyStatus.Failed) {
      icon = (
        <Icon icon={IconProp.Alert} className="h-3.5 w-3.5 text-red-600" />
      );
      text = translator.translateText("Copy failed");
      textClassName = "text-red-600";
    }

    return (
      <>
        {icon}
        <span className={textClassName} aria-live="polite">
          {text}
        </span>
      </>
    );
  };

  // How the newest answer was made: its queries, tokens, cost and model.
  const renderRunStats: () => string = (): string => {
    if (!props.latestRun) {
      return "";
    }

    return [
      translator.translatePlural(
        {
          one: "{{count}} query",
          other: "{{count}} queries",
        },
        props.latestRun.toolCallCount || 0,
      ),
      props.latestRun.totalTokens
        ? translator.translatePlural(
            {
              one: "{{count}} token",
              other: "{{count}} tokens",
            },
            props.latestRun.totalTokens,
          )
        : "",
      props.latestRun.totalCostInUSDCents
        ? `$${(props.latestRun.totalCostInUSDCents / 100).toFixed(4)}`
        : "",
      props.latestRun.egressManifest?.modelName || "",
    ]
      .filter((item: string): boolean => {
        return item.length > 0;
      })
      .join(" · ");
  };

  /*
   * Under a finished answer, one quiet row: what it read (its sources,
   * which open into the list), when it was answered, and Copy and the two
   * thumbs. An older answer's actions show while it is pointed at or
   * focused; the newest answer's always do, as on a phone, which has no
   * pointer to point with.
   */
  const renderAnswerFooter: (
    message: AIConversationMessage,
    timestamp: string,
  ) => ReactElement = (
    message: AIConversationMessage,
    timestamp: string,
  ): ReactElement => {
    const messageId: string = message.id?.toString() || "";
    const citations: Array<AIChatCitation> = message.citations || [];
    const isLatest: boolean = messageId === lastCompletedAssistantId;
    const runStats: string = isLatest ? renderRunStats() : "";
    const hasWork: boolean = citations.length > 0 || runStats.length > 0;
    const isOpen: boolean = openSources.has(messageId);
    const toggleId: string = `${listId}-${messageId}-sources-toggle`;
    const panelId: string = `${listId}-${messageId}-sources`;

    return (
      <div data-testid="ai-chat-answer-footer">
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-gray-500">
          {hasWork ? (
            <button
              id={toggleId}
              type="button"
              aria-expanded={isOpen}
              aria-controls={isOpen ? panelId : undefined}
              data-testid="ai-chat-sources-toggle"
              onClick={() => {
                toggleSources(messageId, panelId);
              }}
              className={`${QUIET_BUTTON_CLASS_NAME} -ms-1.5 font-medium`}
            >
              {citations.length > 0
                ? translator.translatePlural(
                    { one: "{{count}} source", other: "{{count}} sources" },
                    citations.length,
                  )
                : translator.translateText("Details")}
              <Icon
                icon={IconProp.ChevronDown}
                className={`h-3 w-3 transition-transform duration-150 motion-reduce:transition-none ${
                  isOpen ? "rotate-180" : ""
                }`}
              />
            </button>
          ) : (
            <></>
          )}
          {/*
           * When it was answered, on one line: beside the run's cost on a
           * phone it was squeezed into "a / minute / ago", one word a line.
           */}
          {timestamp ? (
            <span
              data-testid="ai-chat-answer-time"
              title={
                message.createdAt
                  ? OneUptimeDate.getDateAsLocalFormattedString(
                      message.createdAt,
                    )
                  : undefined
              }
              className={`flex-shrink-0 whitespace-nowrap text-gray-400 ${
                hasWork ? "px-1" : ""
              }`}
            >
              {timestamp}
            </span>
          ) : (
            <></>
          )}
          <span
            className={`ms-auto flex items-center gap-0.5 transition-opacity duration-150 motion-reduce:transition-none ${
              isLatest
                ? ""
                : "sm:opacity-0 sm:group-hover/answer:opacity-100 sm:group-focus-within/answer:opacity-100"
            }`}
          >
            <button
              type="button"
              title={translator.translateText("Copy answer")}
              onClick={() => {
                copyMessage(message);
              }}
              data-testid="ai-chat-copy-answer"
              data-copy-state={clipboard.statusOf(messageId)}
              className={QUIET_BUTTON_CLASS_NAME}
            >
              {renderCopyButtonContent(messageId)}
            </button>
            {props.onFeedback ? (
              <>
                <button
                  type="button"
                  title={translator.translateText("Good answer")}
                  aria-label={translator.translateText("Good answer")}
                  aria-pressed={
                    message.userFeedback === AIConversationMessageFeedback.Up
                  }
                  onClick={() => {
                    props.onFeedback?.(
                      messageId,
                      message.userFeedback === AIConversationMessageFeedback.Up
                        ? null
                        : AIConversationMessageFeedback.Up,
                    );
                  }}
                  className={`${QUIET_BUTTON_CLASS_NAME} ${
                    message.userFeedback === AIConversationMessageFeedback.Up
                      ? "text-emerald-600"
                      : ""
                  }`}
                >
                  <Icon icon={IconProp.HandThumbUp} className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title={translator.translateText("Poor answer")}
                  aria-label={translator.translateText("Poor answer")}
                  aria-pressed={
                    message.userFeedback === AIConversationMessageFeedback.Down
                  }
                  onClick={() => {
                    props.onFeedback?.(
                      messageId,
                      message.userFeedback ===
                        AIConversationMessageFeedback.Down
                        ? null
                        : AIConversationMessageFeedback.Down,
                    );
                  }}
                  className={`${QUIET_BUTTON_CLASS_NAME} ${
                    message.userFeedback === AIConversationMessageFeedback.Down
                      ? "text-rose-600"
                      : ""
                  }`}
                >
                  <Icon icon={IconProp.HandThumbDown} className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <></>
            )}
          </span>
        </div>
        {isOpen ? (
          <div
            id={panelId}
            data-testid="ai-chat-sources"
            className="mt-2 border-s-2 border-gray-100 ps-3"
          >
            {citations.length > 0 ? (
              <AnswerSources
                citations={citations}
                isHeadingShown={false}
                labelledById={toggleId}
                testId="ai-chat-sources-list"
              />
            ) : (
              <></>
            )}
            {runStats ? (
              <p
                data-testid="ai-chat-run-stats"
                className="mt-1 text-[11px] leading-5 text-gray-400"
              >
                {runStats}
              </p>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  /*
   * An answer reads as prose on the dialog's own surface: no bubble, no
   * avatar beside every message. What it made - charts, tables, an action
   * waiting for approval, the card a write left - sits under its words.
   */
  const renderAssistantBody: (
    message: AIConversationMessage,
    isWaiting: boolean,
  ) => ReactElement = (
    message: AIConversationMessage,
    isWaiting: boolean,
  ): ReactElement => {
    const widgets: Array<AIChatWidget> = message.widgets || [];
    const toolActions: Array<AIChatToolAction> = message.toolActions || [];

    return (
      <div className="space-y-4">
        {message.contentInMarkdown ? (
          <div
            data-testid="ai-chat-answer-text"
            className="text-sm leading-6 text-gray-800"
          >
            <SafeChatMarkdown
              text={message.contentInMarkdown}
              citations={message.citations || []}
            />
          </div>
        ) : (
          <></>
        )}

        {widgets.length > 0 && <WidgetRenderer widgets={widgets} />}

        {toolActions.length > 0 && (
          <ToolApprovalCard
            toolActions={toolActions}
            interactive={isWaiting}
            isSubmitting={props.isSubmittingApproval}
            onRespond={(decisions: Array<ToolDecision>) => {
              props.onRespondToApproval(
                message.id?.toString() || "",
                decisions,
              );
            }}
          />
        )}
      </div>
    );
  };

  const renderMessage: (message: AIConversationMessage) => ReactElement = (
    message: AIConversationMessage,
  ): ReactElement => {
    const messageId: string = message.id?.toString() || "";
    const timestamp: string = message.createdAt
      ? OneUptimeDate.fromNow(message.createdAt)
      : "";

    if (message.role === AIChatMessageRole.User) {
      return (
        <div
          key="question"
          data-testid="ai-chat-question"
          className="flex justify-end"
        >
          {/*
           * The question reads its own way: one asked in English on a
           * Persian page keeps its question mark at its end.
           */}
          <div
            dir="auto"
            title={
              message.createdAt
                ? OneUptimeDate.getDateAsLocalFormattedString(message.createdAt)
                : undefined
            }
            className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-ee-md bg-gray-100 px-4 py-2.5 text-start text-sm leading-6 text-gray-900"
          >
            {message.contentInMarkdown}
          </div>
        </div>
      );
    }

    if (!isWrittenSoFar(message)) {
      return <React.Fragment key={messageId} />;
    }

    const isWaiting: boolean =
      message.status === AIChatMessageStatus.WaitingForApproval;

    if (message.status === AIChatMessageStatus.Cancelled) {
      return (
        <div
          key={messageId}
          data-testid="ai-chat-answer"
          className="flex items-center gap-2 text-sm text-gray-500"
        >
          <Icon icon={IconProp.StopCircle} className="h-4 w-4 flex-shrink-0" />
          <span>
            {message.contentInMarkdown ||
              translator.translateText("Stopped by user.")}
          </span>
        </div>
      );
    }

    if (message.status === AIChatMessageStatus.Error) {
      return (
        <div
          key={messageId}
          data-testid="ai-chat-answer-error"
          className="flex items-start gap-2.5 text-sm"
        >
          <div className="flex h-6 flex-shrink-0 items-center">
            <Icon icon={IconProp.Error} className="h-4 w-4 text-red-600" />
          </div>
          <div className="min-w-0">
            <p className="break-words leading-6 text-gray-900">
              {message.errorMessage ||
                translator.translateText(
                  "Something went wrong generating this response.",
                )}
            </p>
            {props.onRetry ? (
              <button
                type="button"
                data-testid="ai-chat-retry"
                onClick={() => {
                  props.onRetry?.(messageId);
                }}
                className={`${QUIET_BUTTON_CLASS_NAME} -ms-1.5 mt-0.5 text-xs font-medium`}
              >
                <Icon icon={IconProp.ArrowPath} className="h-3.5 w-3.5" />
                {translator.translateText("Try again")}
              </button>
            ) : (
              <></>
            )}
          </div>
        </div>
      );
    }

    return (
      <article
        key={messageId}
        data-testid="ai-chat-answer"
        className="group/answer ou-ai-rise space-y-3"
      >
        {renderAssistantBody(message, isWaiting)}
        {message.status === AIChatMessageStatus.Completed ? (
          renderAnswerFooter(message, timestamp)
        ) : (
          <></>
        )}
      </article>
    );
  };

  return (
    <div
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label={translator.translateText("Conversation")}
      className="flex flex-col gap-8"
    >
      {turns.map((turn: ChatTurn, index: number): ReactElement => {
        const isLastTurn: boolean = index === turns.length - 1;

        return (
          <div
            key={turn.key}
            ref={isLastTurn ? props.lastTurnRef : undefined}
            data-testid="ai-chat-turn"
            style={
              isLastTurn && props.lastTurnMinHeight
                ? { minHeight: `${props.lastTurnMinHeight}px` }
                : undefined
            }
            className="flex flex-col gap-4"
          >
            {turn.messages.map(renderMessage)}
            {isLastTurn && props.isWorking ? (
              <LiveLine events={props.runEvents || []} />
            ) : (
              <></>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default ChatMessageList;
