import AIConversationMessage, {
  AIConversationMessageFeedback,
} from "Common/Models/DatabaseModels/AIConversationMessage";
import AIRun from "Common/Models/DatabaseModels/AIRun";
import AIChatMessageRole from "Common/Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "Common/Types/AI/AIChatMessageStatus";
import { AIChatToolAction, AIChatWidget } from "Common/Types/AI/AIChatTypes";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useClipboardCopy, {
  ClipboardCopy,
  ClipboardCopyStatus,
} from "Common/UI/Utils/UseClipboardCopy";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import CitationChips from "./CitationChips";
import SafeChatMarkdown from "./SafeChatMarkdown";
import ToolApprovalCard, { ToolDecision } from "./ToolApprovalCard";
import WidgetRenderer from "./Widgets/WidgetRenderer";
import { ChatMessageFeedback } from "./useAiChat";

export interface ComponentProps {
  messages: Array<AIConversationMessage>;
  // Run of the newest completed assistant message, for the cost footer.
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
}

const ChatMessageList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  /*
   * An answer's Copy says "Copied" once the answer is on the clipboard and
   * "Copy failed" when the browser refused. It threw on a page served over
   * plain http, where the browser has no clipboard API (issue #5132).
   */
  const clipboard: ClipboardCopy = useClipboardCopy({ copiedForMs: 1500 });

  const lastCompletedAssistantId: string | undefined = [...props.messages]
    .reverse()
    .find((message: AIConversationMessage) => {
      return (
        message.role === AIChatMessageRole.Assistant &&
        message.status === AIChatMessageStatus.Completed
      );
    })
    ?.id?.toString();

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

  type RenderCopyButtonContentFunction = (messageId: string) => ReactElement;

  // The icon and the word for one answer's Copy, after what it last did.
  const renderCopyButtonContent: RenderCopyButtonContentFunction = (
    messageId: string,
  ): ReactElement => {
    const status: ClipboardCopyStatus = clipboard.statusOf(messageId);

    let icon: ReactElement = <Icon icon={IconProp.Copy} className="h-3 w-3" />;
    let text: string | undefined = translator.translateText("Copy");
    let textClassName: string = "";

    if (status === ClipboardCopyStatus.Copied) {
      icon = (
        <Icon icon={IconProp.Check} className="h-3 w-3 text-emerald-500" />
      );
      text = translator.translateText("Copied");
      textClassName = "text-emerald-500";
    } else if (status === ClipboardCopyStatus.Failed) {
      icon = <Icon icon={IconProp.Alert} className="h-3 w-3 text-red-600" />;
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

  /*
   * Assistant output reads as clean prose on the page surface — no chat bubble.
   * Only structured artifacts (widgets, tool approvals, citations) get their own
   * quiet cards below the text.
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
      <div className="space-y-3">
        {message.contentInMarkdown ? (
          <div className="text-sm leading-relaxed text-gray-800">
            <SafeChatMarkdown text={message.contentInMarkdown} />
          </div>
        ) : isWaiting ? (
          <div className="text-sm leading-relaxed text-gray-500">
            {translator.translateText(
              toolActions.length > 1
                ? "I’d like to take the actions below. Review and approve to continue."
                : "I’d like to take the action below. Review and approve to continue.",
            )}
          </div>
        ) : null}

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

        {message.citations && message.citations.length > 0 && (
          <div className="border-t border-gray-100 pt-3">
            <CitationChips citations={message.citations} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-7">
      {props.messages.map((message: AIConversationMessage) => {
        const messageId: string = message.id?.toString() || "";
        const timestamp: string = message.createdAt
          ? OneUptimeDate.fromNow(message.createdAt)
          : "";

        if (message.role === AIChatMessageRole.User) {
          return (
            <div key={messageId} className="flex justify-end">
              <div className="flex max-w-[85%] flex-col items-end">
                <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-gray-100 px-4 py-2.5 text-sm leading-relaxed text-gray-900">
                  {message.contentInMarkdown}
                </div>
                {timestamp && (
                  <div className="mt-1.5 px-1 text-[11px] text-gray-400">
                    {timestamp}
                  </div>
                )}
              </div>
            </div>
          );
        }

        const isWaiting: boolean =
          message.status === AIChatMessageStatus.WaitingForApproval;

        /*
         * A plain in-progress assistant message (no partial widgets/actions yet)
         * is represented by the live activity feed, rendered separately by the
         * panel — so render nothing here.
         */
        if (
          (message.status === AIChatMessageStatus.InProgress ||
            message.status === AIChatMessageStatus.Pending) &&
          (message.widgets || []).length === 0 &&
          (message.toolActions || []).length === 0
        ) {
          return <React.Fragment key={messageId} />;
        }

        return (
          <div key={messageId} className="flex gap-3.5">
            <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-gray-900">
              <Icon
                icon={IconProp.Sparkles}
                className="h-3.5 w-3.5 text-white"
              />
            </div>

            <div className="min-w-0 flex-1">
              {message.status === AIChatMessageStatus.Cancelled && (
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Icon icon={IconProp.StopCircle} className="h-4 w-4" />
                  <span>
                    {message.contentInMarkdown ||
                      translator.translateText("Stopped by user.")}
                  </span>
                </div>
              )}

              {message.status === AIChatMessageStatus.Error && (
                <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3">
                  <div className="flex items-start gap-2.5">
                    <Icon
                      icon={IconProp.Error}
                      className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-500"
                    />
                    <div>
                      <div className="text-sm text-rose-700">
                        {message.errorMessage ||
                          translator.translateText(
                            "Something went wrong generating this response.",
                          )}
                      </div>
                      <div className="mt-1 text-xs text-rose-500">
                        {translator.translateText("Try asking again.")}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {(message.status === AIChatMessageStatus.Completed ||
                isWaiting ||
                message.status === AIChatMessageStatus.InProgress ||
                message.status === AIChatMessageStatus.Pending) && (
                <div>
                  {renderAssistantBody(message, isWaiting)}

                  {message.status === AIChatMessageStatus.Completed && (
                    <div className="mt-2.5 flex items-center gap-2.5 text-[11px] text-gray-400">
                      {/*
                       * When it was answered, on one line: beside the run's
                       * cost on a phone it was squeezed into "a / minute /
                       * ago", one word a line.
                       */}
                      {timestamp && (
                        <span
                          data-testid="ai-chat-answer-time"
                          className="flex-shrink-0 whitespace-nowrap"
                        >
                          {timestamp}
                        </span>
                      )}
                      {props.latestRun &&
                        messageId === lastCompletedAssistantId && (
                          <span className="truncate">
                            {[
                              props.latestRun.totalCostInUSDCents
                                ? `$${(props.latestRun.totalCostInUSDCents / 100).toFixed(4)}`
                                : "",
                              props.latestRun.totalTokens
                                ? translator.translatePlural(
                                    {
                                      one: "{{count}} token",
                                      other: "{{count}} tokens",
                                    },
                                    props.latestRun.totalTokens,
                                  )
                                : "",
                              translator.translatePlural(
                                {
                                  one: "{{count}} query",
                                  other: "{{count}} queries",
                                },
                                props.latestRun.toolCallCount || 0,
                              ),
                              props.latestRun.egressManifest?.modelName || "",
                            ]
                              .filter((item: string): boolean => {
                                return item.length > 0;
                              })
                              .map((item: string): string => {
                                return `· ${item}`;
                              })
                              .join(" ")}
                          </span>
                        )}
                      <button
                        type="button"
                        title={translator.translateText("Copy answer")}
                        onClick={() => {
                          copyMessage(message);
                        }}
                        data-testid="ai-chat-copy-answer"
                        data-copy-state={clipboard.statusOf(messageId)}
                        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                      >
                        {renderCopyButtonContent(messageId)}
                      </button>
                      {props.onFeedback && (
                        <span className="flex items-center gap-0.5">
                          <button
                            type="button"
                            title={translator.translateText("Good answer")}
                            onClick={() => {
                              props.onFeedback?.(
                                messageId,
                                message.userFeedback ===
                                  AIConversationMessageFeedback.Up
                                  ? null
                                  : AIConversationMessageFeedback.Up,
                              );
                            }}
                            className={`rounded-md p-1 transition-colors hover:bg-gray-100 ${
                              message.userFeedback ===
                              AIConversationMessageFeedback.Up
                                ? "text-emerald-500"
                                : "text-gray-400 hover:text-gray-600"
                            }`}
                          >
                            <Icon
                              icon={IconProp.HandThumbUp}
                              className="h-3 w-3"
                            />
                          </button>
                          <button
                            type="button"
                            title={translator.translateText("Poor answer")}
                            onClick={() => {
                              props.onFeedback?.(
                                messageId,
                                message.userFeedback ===
                                  AIConversationMessageFeedback.Down
                                  ? null
                                  : AIConversationMessageFeedback.Down,
                              );
                            }}
                            className={`rounded-md p-1 transition-colors hover:bg-gray-100 ${
                              message.userFeedback ===
                              AIConversationMessageFeedback.Down
                                ? "text-rose-500"
                                : "text-gray-400 hover:text-gray-600"
                            }`}
                          >
                            <Icon
                              icon={IconProp.HandThumbDown}
                              className="h-3 w-3"
                            />
                          </button>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ChatMessageList;
