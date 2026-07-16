import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageContextUtil, {
  DashboardPageContext,
  SuggestedQuestion,
} from "./PageContext";
import AIConversation from "Common/Models/DatabaseModels/AIConversation";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
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
  /*
   * True when the provider list has loaded and is empty — the first message
   * would fail, so surface the setup notice up front instead. Left false while
   * loading or when the fetch errors (fail open).
   */
  showNoProviderNotice?: boolean | undefined;
  /*
   * What the user was looking at when they opened the chat. When attached, the
   * hero and suggestions speak about that page ("What would you like to know
   * about this incident?") instead of the generic pitch.
   */
  pageContext?: DashboardPageContext | null | undefined;
  isPageContextAttached?: boolean | undefined;
}

const genericSuggestions: Array<SuggestedQuestion> = [
  {
    icon: IconProp.ChartBar,
    title: "Latency chart",
    question:
      "Chart the p95 latency of my slowest endpoints over the last 24 hours.",
  },
  {
    icon: IconProp.Logs,
    title: "Error volume",
    question: "Show me error log volume over the last 6 hours by severity.",
  },
  {
    icon: IconProp.Error,
    title: "Top exceptions",
    question: "What are the top exceptions this week?",
  },
  {
    icon: IconProp.Alert,
    title: "Investigate & act",
    question:
      "Investigate the most recent errors, and if it looks like an outage, open an incident.",
  },
];

const ChatHomeView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const llmProvidersRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SETTINGS_AI_LLM_PROVIDERS] as Route,
  );

  const context: DashboardPageContext | null | undefined =
    props.isPageContextAttached ? props.pageContext : null;

  const contextSuggestions: Array<SuggestedQuestion> = context
    ? PageContextUtil.getSuggestions(context)
    : [];

  const renderSuggestion: (suggestion: SuggestedQuestion) => ReactElement = (
    suggestion: SuggestedQuestion,
  ): ReactElement => {
    return (
      <button
        key={suggestion.title}
        type="button"
        disabled={props.isSending}
        onClick={() => {
          props.onAsk(suggestion.question);
        }}
        className="group flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-3.5 text-left transition-colors hover:border-gray-300 hover:bg-gray-50 disabled:opacity-50"
      >
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 transition-colors group-hover:bg-gray-900 group-hover:text-white">
          <Icon icon={suggestion.icon} className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-900">
            {suggestion.title}
          </div>
          <div className="mt-0.5 text-xs leading-relaxed text-gray-500">
            {suggestion.question}
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="flex min-h-full flex-col px-6 py-10">
      {/* Hero — speaks about the page the user came from when context exists. */}
      <div className="mb-8">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-gray-900">
          <Icon
            icon={context ? context.icon : IconProp.Sparkles}
            className="h-5 w-5 text-white"
          />
        </div>
        {context ? (
          <>
            <h3 className="text-lg font-semibold tracking-tight text-gray-900">
              {context.isEntity
                ? `What would you like to know about this ${context.noun}?`
                : `What would you like to know about your ${context.noun}?`}
            </h3>
            {context.entityTitle && (
              <div className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
                <Icon
                  icon={context.icon}
                  className="h-3.5 w-3.5 flex-shrink-0 text-indigo-500"
                />
                <span className="truncate">{context.entityTitle}</span>
              </div>
            )}
            <p className="mt-1.5 max-w-md text-sm leading-relaxed text-gray-500">
              Answers are grounded in this page — OneUptime AI runs real queries
              against your telemetry and cites them. Remove the context chip in
              the composer to ask about anything else.
            </p>
          </>
        ) : (
          <>
            <h3 className="text-lg font-semibold tracking-tight text-gray-900">
              Ask AI about your data — or tell it to act
            </h3>
            <p className="mt-1.5 max-w-md text-sm leading-relaxed text-gray-500">
              OneUptime AI runs real queries against your logs, traces, metrics,
              incidents and monitors — rendering charts and tables inline — and
              can create incidents or acknowledge alerts, always with your
              approval.
            </p>
          </>
        )}
      </div>

      {props.showNoProviderNotice && (
        <div className="mb-8 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
          <Icon
            icon={IconProp.Info}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500"
          />
          <div className="text-sm leading-relaxed text-amber-800">
            <span className="font-medium">
              No LLM provider is configured for this project.
            </span>{" "}
            Messages need a provider to run — add one in{" "}
            <Link to={llmProvidersRoute} className="font-medium underline">
              Settings → AI → LLM Providers
            </Link>{" "}
            to start chatting.
          </div>
        </div>
      )}

      {contextSuggestions.length > 0 && (
        <div className="mb-8 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {contextSuggestions.map(renderSuggestion)}
        </div>
      )}

      <div className="mb-8">
        {contextSuggestions.length > 0 && (
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">
            Or explore everything
          </div>
        )}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {genericSuggestions.map(renderSuggestion)}
        </div>
      </div>

      {!props.hideConversations && props.conversations.length > 0 && (
        <div className="min-h-0 flex-1">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">
            Recent conversations
          </div>
          <div className="space-y-px">
            {props.conversations.map((conversation: AIConversation) => {
              const conversationId: string = conversation.id?.toString() || "";
              return (
                <div
                  key={conversationId}
                  className="group flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-gray-100/70"
                  onClick={() => {
                    props.onOpenConversation(conversationId);
                  }}
                >
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-400 group-hover:text-gray-600">
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
                      props.onDeleteConversation(conversationId);
                    }}
                    className="rounded-md p-1.5 text-gray-400 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                  >
                    <Icon icon={IconProp.Trash} className="h-3.5 w-3.5" />
                  </button>
                  <Icon
                    icon={IconProp.ChevronRight}
                    className="h-3.5 w-3.5 flex-shrink-0 text-gray-300 group-hover:text-gray-400"
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
