import AskAiMark, { AskAiMarkSize } from "./AskAiMark";
import {
  getTitleDirection,
  PAGE_START_ALIGN_CLASS_NAME,
} from "./TitleDirection";
import PageContextUtil, {
  DashboardPageContext,
  SuggestedQuestion,
} from "./PageContext";
import AIConversation from "Common/Models/DatabaseModels/AIConversation";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useId } from "react";

export interface ComponentProps {
  conversations: Array<AIConversation>;
  isSending: boolean;
  onOpenConversation: (conversationId: string) => void;
  // Opens the whole history, from under the few recent conversations.
  onShowAllConversations?: (() => void) | undefined;
  onAsk: (question: string) => void;
  /*
   * What the user was looking at when they opened Ask AI. When attached, the
   * suggestions are that page's own, and the composer's pill under the
   * heading says what the question is about.
   */
  pageContext?: DashboardPageContext | null | undefined;
  isPageContextAttached?: boolean | undefined;
  /*
   * The composer, drawn under the heading: the first thing a new
   * conversation asks for is the question, so that is where it starts.
   */
  composer?: ReactElement | undefined;
}

// How many recent conversations the start shows; the rest are a click away.
export const RECENT_CONVERSATIONS_SHOWN: number = 3;

/*
 * The start of a conversation: one question. What it is about is said once,
 * by the composer's pill right under it ("This incident · #42 Checkout
 * latency above 2s") - a heading that said it again ("What would you like
 * to know about this incident?") was a second line saying the same, and a
 * sentence no language with genders could word for every kind of page.
 * With no page behind it, one sentence says where answers come from and
 * that Ask AI can act - incidents and alerts alike (#5301) - only with
 * approval.
 */
export const HOME_HEADING: string = translationKey(
  "What would you like to know?",
);

export const HOME_SENTENCE: string = translationKey(
  "It answers from your project's live data, and can create incidents and alerts with your approval.",
);

/*
 * The suggestions are English keys. Each chip shows its title in the
 * reader's language, says its whole question on hover, and asks it.
 */
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

/*
 * Ask AI's first step: one question in the middle, the composer right under
 * it, the page's own suggestions as quiet chips, and the last few
 * conversations to pick up again. The suggestions are the page's when Ask
 * AI was opened on a page it knows (an incident, a host, the logs), and
 * general ones otherwise - never both, which put eight cards and two
 * paragraphs between the person and the box they came to type in.
 */
const ChatHomeView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const recentHeadingId: string = useId();
  const context: DashboardPageContext | null | undefined =
    props.isPageContextAttached ? props.pageContext : null;

  const contextSuggestions: Array<SuggestedQuestion> = context
    ? PageContextUtil.getSuggestions(context, translator)
    : [];

  const suggestions: Array<SuggestedQuestion> =
    contextSuggestions.length > 0 ? contextSuggestions : genericSuggestions;

  const recentConversations: Array<AIConversation> = props.conversations.slice(
    0,
    RECENT_CONVERSATIONS_SHOWN,
  );

  const renderSuggestion: (suggestion: SuggestedQuestion) => ReactElement = (
    suggestion: SuggestedQuestion,
  ): ReactElement => {
    const question: string = translator.translateText(
      suggestion.question,
    ) as string;

    return (
      <button
        key={suggestion.title}
        type="button"
        title={question}
        data-testid="ai-chat-suggestion"
        disabled={props.isSending}
        onClick={() => {
          props.onAsk(question);
        }}
        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
      >
        <Icon
          icon={suggestion.icon}
          className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
        />
        <span className="truncate" dir="auto">
          {translator.translateText(suggestion.title)}
        </span>
      </button>
    );
  };

  return (
    /*
     * In the middle of the dialog when it fits (the auto margins), from the
     * top when it does not: a phone scrolls the start, never cuts its top.
     */
    <div className="flex min-h-full flex-col">
      <div
        data-testid="ai-chat-home"
        className="ou-ai-rise mx-auto my-auto flex w-full max-w-2xl flex-col px-4 py-10 sm:px-6"
      >
        <div className="flex flex-col items-center text-center">
          <AskAiMark size={AskAiMarkSize.Large} />
          <h3 className="mt-4 text-balance text-xl font-semibold tracking-tight text-gray-900">
            {translator.translateText(HOME_HEADING)}
          </h3>
          {context ? (
            <></>
          ) : (
            <p className="mt-1.5 max-w-md text-balance text-sm leading-6 text-gray-500">
              {translator.translateText(HOME_SENTENCE)}
            </p>
          )}
        </div>

        {props.composer ? <div className="mt-6">{props.composer}</div> : <></>}

        <div
          data-testid="ai-chat-suggestions"
          className="mt-4 flex flex-wrap justify-center gap-2"
        >
          {suggestions.map(renderSuggestion)}
        </div>

        {recentConversations.length > 0 ? (
          <section
            aria-labelledby={recentHeadingId}
            data-testid="ai-chat-recent"
            className="mt-10"
          >
            <div className="flex items-center justify-between gap-3 px-2.5">
              <h4
                id={recentHeadingId}
                className="text-xs font-medium text-gray-500"
              >
                {translator.translateText("Recent conversations")}
              </h4>
              {props.onShowAllConversations &&
              props.conversations.length > recentConversations.length ? (
                <button
                  type="button"
                  onClick={props.onShowAllConversations}
                  className="rounded-md text-xs font-medium text-indigo-600 transition-colors hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  {translator.translateText("All conversations")}
                </button>
              ) : (
                <></>
              )}
            </div>
            <ul role="list" className="mt-1">
              {recentConversations.map(
                (conversation: AIConversation): ReactElement => {
                  const conversationId: string =
                    conversation.id?.toString() || "";
                  const title: string =
                    conversation.title ||
                    (translator.translateText(
                      "Untitled conversation",
                    ) as string);

                  return (
                    <li key={conversationId}>
                      <button
                        type="button"
                        onClick={() => {
                          props.onOpenConversation(conversationId);
                        }}
                        className="group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-start transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
                      >
                        <Icon
                          icon={IconProp.ChatBubbleOvalLeft}
                          className="h-4 w-4 flex-shrink-0 text-gray-400"
                        />
                        {/*
                         * Read its own way, cut at its own end, beside its
                         * icon (TitleDirection).
                         */}
                        <span
                          dir={getTitleDirection(title)}
                          className={`min-w-0 flex-1 truncate text-sm text-gray-700 group-hover:text-gray-900 ${PAGE_START_ALIGN_CLASS_NAME}`}
                        >
                          {title}
                        </span>
                        {conversation.lastMessageAt ? (
                          <span className="flex-shrink-0 text-xs text-gray-400">
                            {OneUptimeDate.fromNow(conversation.lastMessageAt)}
                          </span>
                        ) : (
                          <></>
                        )}
                      </button>
                    </li>
                  );
                },
              )}
            </ul>
          </section>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default ChatHomeView;
