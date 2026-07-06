import AIConversationMessage from "Common/Models/DatabaseModels/AIConversationMessage";
import AIRun from "Common/Models/DatabaseModels/AIRun";
import AIChatMessageRole from "Common/Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "Common/Types/AI/AIChatMessageStatus";
import AILoader from "Common/UI/Components/AI/AILoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
} from "react";
import CitationChips from "./CitationChips";
import SafeChatMarkdown from "./SafeChatMarkdown";

export interface ComponentProps {
  messages: Array<AIConversationMessage>;
  // Run of the newest completed assistant message, for the cost footer.
  latestRun?: AIRun | undefined;
}

const ChatMessageList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const bottomRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const lastScrollSignatureRef: React.MutableRefObject<string> =
    useRef<string>("");

  /*
   * The poll replaces the messages array every 2s even when nothing changed.
   * Only auto-scroll when the conversation actually grew or the last message
   * changed state — otherwise a user scrolled up to re-read gets yanked to
   * the bottom on every tick.
   */
  useEffect(() => {
    const lastMessage: AIConversationMessage | undefined =
      props.messages[props.messages.length - 1];
    const signature: string = `${props.messages.length}:${lastMessage?.id?.toString()}:${lastMessage?.status}`;

    if (signature === lastScrollSignatureRef.current) {
      return;
    }
    lastScrollSignatureRef.current = signature;

    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [props.messages]);

  const lastAssistantMessageId: string | undefined = [...props.messages]
    .reverse()
    .find((message: AIConversationMessage) => {
      return (
        message.role === AIChatMessageRole.Assistant &&
        message.status === AIChatMessageStatus.Completed
      );
    })
    ?.id?.toString();

  return (
    <div className="flex flex-col gap-4">
      {props.messages.map((message: AIConversationMessage) => {
        const isUser: boolean = message.role === AIChatMessageRole.User;

        if (isUser) {
          return (
            <div key={message.id?.toString()} className="flex justify-end">
              <div className="max-w-lg rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white whitespace-pre-wrap">
                {message.contentInMarkdown}
              </div>
            </div>
          );
        }

        const isWorking: boolean =
          message.status === AIChatMessageStatus.InProgress ||
          message.status === AIChatMessageStatus.Pending;

        return (
          <div key={message.id?.toString()} className="flex justify-start">
            <div className="max-w-2xl w-full rounded-lg bg-gray-50 border border-gray-100 px-4 py-3 text-sm">
              {isWorking && (
                <div>
                  <AILoader />
                  {message.citations && message.citations.length > 0 && (
                    <div className="mt-2 text-xs text-gray-500">
                      Ran {message.citations.length}{" "}
                      {message.citations.length === 1 ? "query" : "queries"} so
                      far…
                    </div>
                  )}
                </div>
              )}

              {message.status === AIChatMessageStatus.Error && (
                <ErrorMessage
                  message={
                    message.errorMessage ||
                    "Something went wrong generating this response."
                  }
                />
              )}

              {message.status === AIChatMessageStatus.Completed && (
                <div>
                  <SafeChatMarkdown text={message.contentInMarkdown || ""} />
                  <CitationChips citations={message.citations || []} />
                  {props.latestRun &&
                    message.id?.toString() === lastAssistantMessageId && (
                      <div className="mt-2 text-xs text-gray-400">
                        {props.latestRun.totalCostInUSDCents
                          ? `$${(props.latestRun.totalCostInUSDCents / 100).toFixed(4)} · `
                          : ""}
                        {props.latestRun.totalTokens
                          ? `${props.latestRun.totalTokens.toLocaleString()} tokens · `
                          : "tokens n/a · "}
                        {props.latestRun.toolCallCount || 0}{" "}
                        {(props.latestRun.toolCallCount || 0) === 1
                          ? "query"
                          : "queries"}
                        {props.latestRun.egressManifest?.modelName
                          ? ` · sent to ${props.latestRun.egressManifest.modelName}`
                          : ""}
                      </div>
                    )}
                </div>
              )}
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
};

export default ChatMessageList;
