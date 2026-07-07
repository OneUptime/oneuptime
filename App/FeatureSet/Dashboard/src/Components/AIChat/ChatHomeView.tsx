import AIConversation from "Common/Models/DatabaseModels/AIConversation";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  conversations: Array<AIConversation>;
  isSending: boolean;
  onOpenConversation: (conversationId: string) => void;
  onDeleteConversation: (conversationId: string) => void;
  onAsk: (question: string) => void;
  /*
   * The full-page Copilot shows conversations in its own rail, so it hides the
   * list here and keeps only the hero + suggested prompts.
   */
  hideConversations?: boolean | undefined;
}

interface SuggestedQuestion {
  icon: IconProp;
  iconClassName: string;
  title: string;
  question: string;
}

const suggestions: Array<SuggestedQuestion> = [
  {
    icon: IconProp.ChartBar,
    iconClassName: "bg-indigo-50 text-indigo-500",
    title: "Latency chart",
    question:
      "Chart the p95 latency of my slowest endpoints over the last 24 hours.",
  },
  {
    icon: IconProp.Logs,
    iconClassName: "bg-amber-50 text-amber-600",
    title: "Error volume",
    question: "Show me error log volume over the last 6 hours by severity.",
  },
  {
    icon: IconProp.Error,
    iconClassName: "bg-rose-50 text-rose-500",
    title: "Top exceptions",
    question: "What are the top exceptions this week?",
  },
  {
    icon: IconProp.Alert,
    iconClassName: "bg-emerald-50 text-emerald-600",
    title: "Investigate & act",
    question:
      "Investigate the most recent errors, and if it looks like an outage, open an incident.",
  },
];

const ChatHomeView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="flex min-h-full flex-col px-5 py-6">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-md">
          <Icon icon={IconProp.Sparkles} className="h-6 w-6 text-white" />
        </div>
        <h3 className="text-base font-semibold text-gray-900">
          Ask about your data — or tell me to act
        </h3>
        <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-gray-400">
          I run real queries against your logs, traces, metrics, incidents and
          monitors — rendering charts and tables inline — and I can create
          incidents or acknowledge alerts, always with your approval.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-2">
        {suggestions.map((suggestion: SuggestedQuestion) => {
          return (
            <button
              key={suggestion.title}
              type="button"
              disabled={props.isSending}
              onClick={() => {
                props.onAsk(suggestion.question);
              }}
              className="group rounded-xl border border-gray-200 bg-white p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow disabled:opacity-50"
            >
              <div
                className={`mb-2 flex h-7 w-7 items-center justify-center rounded-lg ${suggestion.iconClassName}`}
              >
                <Icon icon={suggestion.icon} className="h-4 w-4" />
              </div>
              <div className="text-xs font-semibold text-gray-800 group-hover:text-indigo-700">
                {suggestion.title}
              </div>
              <div className="mt-0.5 text-[11px] leading-4 text-gray-400">
                {suggestion.question}
              </div>
            </button>
          );
        })}
      </div>

      {!props.hideConversations && props.conversations.length > 0 && (
        <div className="min-h-0 flex-1">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Recent conversations
          </div>
          <div className="space-y-0.5">
            {props.conversations.map((conversation: AIConversation) => {
              const conversationId: string = conversation.id?.toString() || "";
              return (
                <div
                  key={conversationId}
                  className="group flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-gray-50"
                  onClick={() => {
                    props.onOpenConversation(conversationId);
                  }}
                >
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-400 group-hover:bg-indigo-50 group-hover:text-indigo-500">
                    <Icon
                      icon={IconProp.ChatBubbleOvalLeft}
                      className="h-3.5 w-3.5"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-gray-700 group-hover:text-gray-900">
                      {conversation.title || "Untitled conversation"}
                    </div>
                    {conversation.lastMessageAt && (
                      <div className="text-[10px] text-gray-300">
                        {OneUptimeDate.fromNow(conversation.lastMessageAt)}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    title="Delete conversation"
                    onClick={(event: React.MouseEvent) => {
                      event.stopPropagation();
                      props.onDeleteConversation(conversationId);
                    }}
                    className="rounded-md p-1.5 text-gray-300 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                  >
                    <Icon icon={IconProp.Trash} className="h-3.5 w-3.5" />
                  </button>
                  <Icon
                    icon={IconProp.ChevronRight}
                    className="h-3.5 w-3.5 flex-shrink-0 text-gray-200 group-hover:text-gray-400"
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatHomeView;
