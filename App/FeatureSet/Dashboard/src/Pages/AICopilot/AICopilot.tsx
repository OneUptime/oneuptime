import PageComponentProps from "../PageComponentProps";
import AIPlanGate from "../../Components/AI/AIPlanGate";
import ChatActivityFeed from "../../Components/AIChat/ChatActivityFeed";
import ChatHomeView from "../../Components/AIChat/ChatHomeView";
import ChatInput from "../../Components/AIChat/ChatInput";
import ChatMessageList from "../../Components/AIChat/ChatMessageList";
import ProviderPicker from "../../Components/AIChat/ProviderPicker";
import PermissionModePicker from "../../Components/AIChat/PermissionModePicker";
import { useAiChat, UseAiChat } from "../../Components/AIChat/useAiChat";
import AIConversation from "Common/Models/DatabaseModels/AIConversation";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Page from "Common/UI/Components/Page/Page";
import UiAnalytics from "Common/UI/Utils/Analytics";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

/*
 * Meaningful, non-redundant page header copy. The title is the feature name;
 * the description stays high level (the chat card below already lists the data
 * types it queries), leading with what the assistant does — answer and act.
 */
const AI_CHAT_DESCRIPTION: string =
  "Ask across your observability data and act on what you find — answers cite the real queries behind them, and actions run with your approval.";

/*
 * The full-page AI Copilot: a calm, focused workspace for asking the OneUptime
 * observability assistant about the project's telemetry. A quiet left rail holds
 * conversation history; the main column is the live thread with a model switcher
 * in the composer. All chat behavior lives in the shared useAiChat hook so this
 * page and the quick-launch popover stay in lockstep.
 */
const AICopilot: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const chat: UseAiChat = useAiChat({ enabled: true });

  /*
   * Page-view analytics: previously driven by breadcrumbLinks (now removed as a
   * redundant self-duplicate of the title), captured explicitly instead.
   */
  useEffect(() => {
    UiAnalytics.capture("dashboard/ai-copilot", {
      projectId: ProjectUtil.getCurrentProjectId()?.toString() || "",
    });
  }, []);

  const composerLeading: ReactElement = (
    <div className="flex flex-wrap items-center gap-1.5">
      <ProviderPicker
        providers={chat.providers}
        selectedProviderId={chat.selectedProviderId}
        onSelect={chat.setSelectedProviderId}
        disabled={false}
      />
      <PermissionModePicker
        value={chat.permissionMode}
        onChange={chat.setPermissionMode}
        disabled={chat.isWorking}
      />
    </div>
  );

  return (
    <Page title="AI" description={AI_CHAT_DESCRIPTION}>
      <AIPlanGate />
      <div
        className="flex overflow-hidden rounded-2xl border border-gray-200 bg-white"
        style={{ height: "calc(100vh - 220px)", minHeight: "560px" }}
      >
        {/* Conversation rail */}
        <div className="hidden w-[264px] flex-shrink-0 flex-col border-r border-gray-200 bg-gray-50/70 md:flex">
          <div className="px-3 pt-3">
            <button
              type="button"
              onClick={() => {
                chat.newConversation();
              }}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800"
            >
              <Icon icon={IconProp.Add} className="h-4 w-4" />
              New chat
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-4">
            <div className="mb-2 px-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">
              Recent
            </div>
            {chat.conversations.length === 0 && (
              <div className="px-2 py-2 text-xs text-gray-400">
                No conversations yet.
              </div>
            )}
            <div className="space-y-px">
              {chat.conversations.map((conversation: AIConversation) => {
                const conversationId: string =
                  conversation.id?.toString() || "";
                const isActive: boolean =
                  conversationId === chat.activeConversationId;
                return (
                  <div
                    key={conversationId}
                    onClick={() => {
                      chat.openConversation(conversationId);
                    }}
                    className={`group flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${
                      isActive
                        ? "bg-gray-200/70 text-gray-900"
                        : "text-gray-600 hover:bg-gray-200/40"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div
                        className={`truncate text-[13px] ${
                          isActive
                            ? "font-medium text-gray-900"
                            : "text-gray-700"
                        }`}
                      >
                        {conversation.title || "Untitled conversation"}
                      </div>
                      {conversation.lastMessageAt && (
                        <div className="mt-0.5 text-[11px] text-gray-400">
                          {OneUptimeDate.fromNow(conversation.lastMessageAt)}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      title="Delete conversation"
                      onClick={(event: React.MouseEvent) => {
                        event.stopPropagation();
                        chat.deleteConversation(conversationId);
                      }}
                      className="rounded-md p-1.5 text-gray-400 opacity-0 transition-all hover:bg-rose-50 hover:text-rose-500 focus:opacity-100 group-hover:opacity-100"
                    >
                      <Icon icon={IconProp.Trash} className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Main thread */}
        <div className="flex min-w-0 flex-1 flex-col bg-white">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-200 px-6 py-3.5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-900">
                <Icon icon={IconProp.Sparkles} className="h-4 w-4 text-white" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-gray-900">
                  {chat.isConversationView
                    ? chat.activeConversationTitle
                    : "AI"}
                </div>
                <div className="truncate text-xs text-gray-400">
                  {chat.isWorking
                    ? "Investigating your data…"
                    : "Grounded in your logs, traces, metrics, incidents & monitors"}
                </div>
              </div>
            </div>
            {chat.isConversationView && (
              <button
                type="button"
                title="New chat"
                onClick={() => {
                  chat.newConversation();
                }}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900"
              >
                <Icon icon={IconProp.Add} className="h-3.5 w-3.5" />
                New chat
              </button>
            )}
          </div>

          {/* Error banner */}
          {chat.error && (
            <div className="flex items-start justify-between gap-2 border-b border-rose-100 bg-rose-50 px-6 py-2.5">
              <div className="flex items-start gap-2 text-xs text-rose-700">
                <Icon
                  icon={IconProp.Error}
                  className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-rose-500"
                />
                {chat.error}
              </div>
              <button
                type="button"
                title="Dismiss"
                onClick={() => {
                  chat.setError("");
                }}
                className="-m-1 rounded p-1 text-rose-500 transition-colors hover:bg-rose-100 hover:text-rose-700"
              >
                <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Body */}
          <div
            ref={chat.scrollContainerRef}
            onScroll={chat.onBodyScroll}
            className="min-h-0 flex-1 overflow-y-auto"
          >
            {!chat.isConversationView && (
              <div className="mx-auto max-w-2xl">
                <ChatHomeView
                  conversations={chat.conversations}
                  isSending={chat.isSending}
                  hideConversations={true}
                  showNoProviderNotice={
                    chat.providersLoaded && chat.providers.length === 0
                  }
                  onOpenConversation={chat.openConversation}
                  onDeleteConversation={chat.deleteConversation}
                  onAsk={(question: string) => {
                    chat.sendMessage(question).catch(() => {
                      // handled in the hook
                    });
                  }}
                />
              </div>
            )}

            {chat.isConversationView && (
              <div className="mx-auto max-w-3xl px-6 py-8">
                <ChatMessageList
                  messages={chat.messages}
                  latestRun={chat.latestRun}
                  isSubmittingApproval={chat.isSubmittingApproval}
                  onRespondToApproval={(
                    assistantMessageId: string,
                    decisions: Array<{ toolCallId: string; approved: boolean }>,
                  ) => {
                    chat
                      .respondToApproval(assistantMessageId, decisions)
                      .catch(() => {
                        // handled in the hook
                      });
                  }}
                />

                {chat.isWorking && (
                  <div className={chat.messages.length > 0 ? "mt-6" : ""}>
                    <ChatActivityFeed events={chat.runEvents} />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="mx-auto w-full max-w-3xl">
            <ChatInput
              value={chat.inputValue}
              onChange={chat.setInputValue}
              canSend={
                !chat.isSending && !chat.isWorking && !chat.isAwaitingApproval
              }
              isWorking={chat.isWorking}
              leading={composerLeading}
              onSend={() => {
                chat.sendMessage().catch(() => {
                  // handled in the hook
                });
              }}
            />
          </div>
        </div>
      </div>
    </Page>
  );
};

export default AICopilot;
