import AIConversation from "Common/Models/DatabaseModels/AIConversation";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  conversations: Array<AIConversation>;
  activeConversationId: string | undefined;
  onOpenConversation: (conversationId: string) => void;
  onDeleteConversation: (conversationId: string) => void;
}

/*
 * Every conversation the person had with Ask AI in this project, newest
 * first: pick one up where it was left, or delete it. Conversations are
 * personal - the server returns only the reader's own.
 */
const AskAiHistory: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.conversations.length === 0) {
    return (
      <div
        data-testid="ai-chat-history-empty"
        className="flex h-full flex-col items-center justify-center px-6 py-16 text-center"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
          <Icon
            icon={IconProp.ChatBubbleOvalLeft}
            className="h-5 w-5 text-gray-400"
          />
        </div>
        <p className="mt-3 text-sm text-gray-500">
          {translator.translateText("No conversations yet.")}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-3 py-4 sm:px-4">
      <ul role="list" data-testid="ai-chat-history" className="space-y-px">
        {props.conversations.map(
          (conversation: AIConversation): ReactElement => {
            const conversationId: string = conversation.id?.toString() || "";
            const title: string =
              conversation.title ||
              (translator.translateText("Untitled conversation") as string);
            const isActive: boolean =
              conversationId === props.activeConversationId;

            return (
              <li
                key={conversationId}
                className={`group flex items-center gap-1 rounded-lg transition-colors hover:bg-gray-50 focus-within:bg-gray-50 ${
                  isActive ? "bg-gray-50" : ""
                }`}
              >
                <button
                  type="button"
                  aria-current={isActive ? "true" : undefined}
                  onClick={() => {
                    props.onOpenConversation(conversationId);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
                >
                  <Icon
                    icon={IconProp.ChatBubbleOvalLeft}
                    className="h-4 w-4 flex-shrink-0 text-gray-400"
                  />
                  <span
                    dir="auto"
                    className={`min-w-0 flex-1 truncate text-start text-sm ${
                      isActive
                        ? "font-medium text-gray-900"
                        : "text-gray-700 group-hover:text-gray-900"
                    }`}
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
                {/*
                 * Delete shows on the row a pointer or the keyboard is on,
                 * and always on a phone, which has neither hover nor a
                 * pointer to point with.
                 */}
                <button
                  type="button"
                  title={translator.translateText("Delete conversation")}
                  aria-label={translator.translateTemplate(
                    "Delete conversation: {{title}}",
                    { title: title },
                  )}
                  onClick={() => {
                    props.onDeleteConversation(conversationId);
                  }}
                  className="me-1 flex-shrink-0 rounded-md p-1.5 text-gray-400 transition-colors hover:bg-rose-50 hover:text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 sm:opacity-0 sm:focus:opacity-100 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                >
                  <Icon icon={IconProp.Trash} className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          },
        )}
      </ul>
    </div>
  );
};

export default AskAiHistory;
