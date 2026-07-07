import AIConversationMessage from "Common/Models/DatabaseModels/AIConversationMessage";
import AIRun from "Common/Models/DatabaseModels/AIRun";
import AIChatMessageRole from "Common/Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "Common/Types/AI/AIChatMessageStatus";
import { AIChatToolAction, AIChatWidget } from "Common/Types/AI/AIChatTypes";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement, useState } from "react";
import CitationChips from "./CitationChips";
import SafeChatMarkdown from "./SafeChatMarkdown";
import ToolApprovalCard, { ToolDecision } from "./ToolApprovalCard";
import WidgetRenderer from "./Widgets/WidgetRenderer";

export interface ComponentProps {
  messages: Array<AIConversationMessage>;
  // Run of the newest completed assistant message, for the cost footer.
  latestRun?: AIRun | undefined;
  userInitials: string;
  isSubmittingApproval: boolean;
  onRespondToApproval: (
    assistantMessageId: string,
    decisions: Array<ToolDecision>,
  ) => void;
}

const ChatMessageList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [copiedMessageId, setCopiedMessageId] = useState<string>("");

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
    navigator.clipboard
      .writeText(message.contentInMarkdown)
      .then(() => {
        setCopiedMessageId(message.id?.toString() || "");
        setTimeout(() => {
          setCopiedMessageId("");
        }, 1500);
      })
      .catch(() => {
        // clipboard unavailable — ignore
      });
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
            I&rsquo;d like to take the action{toolActions.length > 1 ? "s" : ""}{" "}
            below. Review and approve to continue.
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
              {message.status === AIChatMessageStatus.Error && (
                <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3">
                  <div className="flex items-start gap-2.5">
                    <Icon
                      icon={IconProp.Error}
                      className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400"
                    />
                    <div>
                      <div className="text-sm text-red-700">
                        {message.errorMessage ||
                          "Something went wrong generating this response."}
                      </div>
                      <div className="mt-1 text-xs text-red-400">
                        Try asking again.
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
                      {timestamp && <span>{timestamp}</span>}
                      {props.latestRun &&
                        messageId === lastCompletedAssistantId && (
                          <span className="truncate">
                            {props.latestRun.totalCostInUSDCents
                              ? `· $${(props.latestRun.totalCostInUSDCents / 100).toFixed(4)} `
                              : ""}
                            {props.latestRun.totalTokens
                              ? `· ${props.latestRun.totalTokens.toLocaleString()} tokens `
                              : ""}
                            · {props.latestRun.toolCallCount || 0}{" "}
                            {(props.latestRun.toolCallCount || 0) === 1
                              ? "query"
                              : "queries"}
                            {props.latestRun.egressManifest?.modelName
                              ? ` · ${props.latestRun.egressManifest.modelName}`
                              : ""}
                          </span>
                        )}
                      <button
                        type="button"
                        title="Copy answer"
                        onClick={() => {
                          copyMessage(message);
                        }}
                        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                      >
                        {copiedMessageId === messageId ? (
                          <>
                            <Icon
                              icon={IconProp.Check}
                              className="h-3 w-3 text-emerald-500"
                            />
                            <span className="text-emerald-500">Copied</span>
                          </>
                        ) : (
                          <>
                            <Icon icon={IconProp.Copy} className="h-3 w-3" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
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
