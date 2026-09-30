import ChatActivityFeed, {
  hasRenderableActivity,
} from "../../AIChat/ChatActivityFeed";
import ChatInput from "../../AIChat/ChatInput";
import CitationChips from "../../AIChat/CitationChips";
import PermissionModePicker from "../../AIChat/PermissionModePicker";
import { navigateToCitationTarget } from "../../AIChat/CitationTargetNav";
import { CITATION_CHIP_CLASS_NAME } from "../InvestigationReport/InvestigationCitationChip";
import ToolApprovalCard, { ToolDecision } from "../../AIChat/ToolApprovalCard";
import WidgetRenderer from "../../AIChat/Widgets/WidgetRenderer";
import AIChatMessageRole from "Common/Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "Common/Types/AI/AIChatMessageStatus";
import { AIChatCitation, AIChatWidget } from "Common/Types/AI/AIChatTypes";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AI_DISPLAY_NAME,
  InvestigationConversationSubjectType,
  SuggestedPrompt,
  ThreadAuthor,
  ThreadMessage,
  ThreadView,
  describeAuthor,
  describePermissionMode,
  describeThreadActivity,
  findActiveAssistantMessage,
  getAvatarTone,
  getInitials,
  getSendBlocker,
  getSuggestedPrompts,
  getVisibleWidgets,
  isThreadBusy,
  isViewer,
} from "./InvestigationConversationData";
import useInvestigationConversation, {
  UseInvestigationConversation,
} from "./useInvestigationConversation";

export interface ComponentProps {
  subjectType: InvestigationConversationSubjectType;
  subjectId: ObjectID;
  /*
   * "embedded" (default): a section at the bottom of the AI Investigation
   * card. "card": its own card, for a subject no investigation ran on — the
   * conversation is useful either way.
   */
  variant?: "embedded" | "card" | undefined;
}

// Close enough to the bottom that new messages should keep it pinned there.
const PINNED_TO_BOTTOM_THRESHOLD_PX: number = 120;

const PersonAvatar: FunctionComponent<{
  author: ThreadAuthor;
  size?: "sm" | "md";
}> = (props: { author: ThreadAuthor; size?: "sm" | "md" }): ReactElement => {
  const sizeClassName: string =
    props.size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs";

  return (
    <div
      aria-hidden="true"
      title={props.author.name}
      className={`flex flex-shrink-0 items-center justify-center rounded-full font-semibold ring-2 ring-white ${sizeClassName} ${getAvatarTone(
        props.author.userId || props.author.name,
      )}`}
    >
      {getInitials(props.author.name)}
    </div>
  );
};

const AIAvatar: FunctionComponent = (): ReactElement => {
  return (
    <div
      aria-hidden="true"
      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 shadow-sm"
    >
      <Icon icon={IconProp.Sparkles} className="h-4 w-4 text-white" />
    </div>
  );
};

/*
 * An inline "[C2]" in an answer, as a small chip that names what it cites
 * and — when the evidence has a page (logs, traces, a monitor) — opens it.
 * A citation with nowhere to go (a kubectl command) stays a plain chip with
 * its label on hover, rather than a button that does nothing.
 */
const AnswerCitationChip: FunctionComponent<{
  citation: AIChatCitation;
}> = (props: { citation: AIChatCitation }): ReactElement => {
  const label: string = `Citation ${props.citation.id}: ${props.citation.label}`;

  if (!props.citation.target) {
    return (
      <span
        className={CITATION_CHIP_CLASS_NAME}
        title={props.citation.label}
        aria-label={label}
        data-citation-id={props.citation.id}
      >
        {props.citation.id}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={CITATION_CHIP_CLASS_NAME}
      title={props.citation.label}
      aria-label={label}
      data-citation-id={props.citation.id}
      onClick={() => {
        navigateToCitationTarget(props.citation.target);
      }}
    >
      {props.citation.id}
    </button>
  );
};

const MessageTime: FunctionComponent<{ date: Date | null }> = (props: {
  date: Date | null;
}): ReactElement => {
  if (!props.date) {
    return <></>;
  }

  return (
    <time
      dateTime={props.date.toISOString()}
      title={OneUptimeDate.getDateAsLocalFormattedString(props.date)}
      className="text-xs text-gray-400"
    >
      {OneUptimeDate.fromNow(props.date)}
    </time>
  );
};

/*
 * The conversation inside the AI investigation box: one shared thread per
 * incident or alert, where every responder can ask OneUptime AI follow-up
 * questions and ask it to act. Questions carry who asked them, answers
 * cite their evidence, the answer being written narrates its steps live,
 * and an action waiting for approval can be decided by anyone on the
 * incident.
 */
const InvestigationConversation: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const subjectType: InvestigationConversationSubjectType = props.subjectType;
  const subjectIdString: string = props.subjectId.toString();

  const conversation: UseInvestigationConversation =
    useInvestigationConversation({
      subjectType,
      subjectId: subjectIdString,
    });

  const view: ThreadView = conversation.view;
  const viewerUserId: string | null = view.viewerUserId;
  const isBusy: boolean = isThreadBusy(view);
  const activeMessage: ThreadMessage | undefined =
    findActiveAssistantMessage(view);
  const activityLine: string | null = describeThreadActivity(view);
  const suggestions: Array<SuggestedPrompt> = useMemo(() => {
    return getSuggestedPrompts(subjectType);
  }, [subjectType]);

  const sendBlocker: string | null = getSendBlocker({
    view,
    input: conversation.input,
    isSending: conversation.isSending,
  });

  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  // Everyone who has asked something, in order of first question.
  const participants: Array<ThreadAuthor> = useMemo(() => {
    const seen: Set<string> = new Set();
    const list: Array<ThreadAuthor> = [];

    for (const message of view.messages) {
      if (message.role !== AIChatMessageRole.User) {
        continue;
      }

      const key: string = message.author.userId || message.author.name;

      if (!seen.has(key)) {
        seen.add(key);
        list.push(message.author);
      }
    }

    return list;
  }, [view.messages]);

  /*
   * Keep the newest message in view while the reader is at the bottom;
   * someone scrolled up to re-read an answer is left where they are. A
   * question the viewer just sent always scrolls to show its answer coming.
   */
  const scrollRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const isPinnedRef: React.MutableRefObject<boolean> = useRef<boolean>(true);
  const activeEventCount: number = view.activeRun?.events.length || 0;
  const lastMessage: ThreadMessage | undefined =
    view.messages[view.messages.length - 1];

  useEffect(() => {
    const container: HTMLDivElement | null = scrollRef.current;

    if (!container) {
      return;
    }

    if (isPinnedRef.current || lastMessage?.isOptimistic) {
      container.scrollTop = container.scrollHeight;
    }
  }, [
    view.messages.length,
    activeEventCount,
    lastMessage?.id,
    lastMessage?.status,
  ]);

  const onScroll: () => void = (): void => {
    const container: HTMLDivElement | null = scrollRef.current;

    if (!container) {
      return;
    }

    isPinnedRef.current =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      PINNED_TO_BOTTOM_THRESHOLD_PX;
  };

  const copyAnswer: (message: ThreadMessage) => void = (
    message: ThreadMessage,
  ): void => {
    if (!message.content || typeof navigator === "undefined") {
      return;
    }

    navigator.clipboard
      ?.writeText(message.content)
      .then(() => {
        setCopiedMessageId(message.id);
        setTimeout(() => {
          setCopiedMessageId(null);
        }, 1500);
      })
      .catch(() => {
        // Clipboard unavailable — nothing to do.
      });
  };

  const applySuggestion: (suggestion: SuggestedPrompt) => void = (
    suggestion: SuggestedPrompt,
  ): void => {
    if (suggestion.isAction || isBusy) {
      conversation.setInput(suggestion.prompt);
      return;
    }

    conversation.sendMessage(suggestion.prompt).catch(() => {
      // handled inside sendMessage
    });
  };

  const renderQuestion: (message: ThreadMessage) => ReactElement = (
    message: ThreadMessage,
  ): ReactElement => {
    return (
      <li
        key={message.id}
        className="flex gap-3"
        data-testid="investigation-conversation-question"
      >
        <PersonAvatar author={message.author} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold text-gray-900">
              {describeAuthor(message.author, viewerUserId)}
            </span>
            {message.isOptimistic ? (
              <span className="text-xs text-gray-400">Sending…</span>
            ) : (
              <MessageTime date={message.createdAt} />
            )}
          </div>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-6 text-gray-800">
            {message.content}
          </p>
        </div>
      </li>
    );
  };

  const renderAnswerBody: (message: ThreadMessage) => ReactElement = (
    message: ThreadMessage,
  ): ReactElement => {
    const isWaiting: boolean =
      message.status === AIChatMessageStatus.WaitingForApproval;
    const isWorking: boolean =
      message.status === AIChatMessageStatus.InProgress ||
      message.status === AIChatMessageStatus.Pending;
    const widgets: Array<AIChatWidget> = getVisibleWidgets(
      message,
      viewerUserId,
    );
    const isActiveRunMessage: boolean = Boolean(
      view.activeRun &&
        activeMessage?.id === message.id &&
        (view.activeRun.assistantMessageId === null ||
          view.activeRun.assistantMessageId === message.id),
    );

    if (message.status === AIChatMessageStatus.Cancelled) {
      return (
        <p className="mt-1 flex items-center gap-2 text-sm text-gray-500">
          <Icon icon={IconProp.StopCircle} className="h-4 w-4" />
          {message.content || "Stopped."}
        </p>
      );
    }

    if (message.status === AIChatMessageStatus.Error) {
      return (
        <div className="mt-1.5 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
          <div className="flex items-start gap-2">
            <Icon
              icon={IconProp.Alert}
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-500"
            />
            <div>
              <p>
                {message.errorMessage ||
                  "Something went wrong while answering."}
              </p>
              <p className="mt-0.5 text-xs text-rose-500">
                Ask again to retry.
              </p>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="mt-1 space-y-3">
        {message.content ? (
          <div className="text-sm leading-6 text-gray-800">
            {/*
              Safe mode: the answer is shaped by telemetry an attacker can
              influence, so links and images never render — navigation is
              only through the server-minted citations.
            */}
            <MarkdownViewer
              text={message.content}
              safeMode={true}
              inlineReferences={{
                renderCitation: (citationId: string): ReactElement | null => {
                  const citation: AIChatCitation | undefined =
                    message.citations.find(
                      (candidate: AIChatCitation): boolean => {
                        return candidate.id === citationId;
                      },
                    );

                  return citation ? (
                    <AnswerCitationChip citation={citation} />
                  ) : null;
                },
              }}
            />
          </div>
        ) : isWaiting ? (
          <p className="text-sm leading-6 text-gray-700">
            {message.toolActions.length > 1
              ? "I'd like to take these actions. Review them and approve to continue."
              : "I'd like to take this action. Review it and approve to continue."}
          </p>
        ) : isWorking ? (
          <div
            role="status"
            className="flex items-center gap-2 text-sm text-gray-500"
          >
            <span className="h-3.5 w-3.5 flex-shrink-0 rounded-full border-2 border-indigo-200 border-t-indigo-600 motion-safe:animate-spin" />
            <span>
              {activityLine || `${AI_DISPLAY_NAME} is looking into it…`}
            </span>
          </div>
        ) : (
          <></>
        )}

        {isWorking &&
        isActiveRunMessage &&
        view.activeRun &&
        hasRenderableActivity(view.activeRun.events) ? (
          <div
            className="rounded-lg border border-gray-100 bg-gray-50/70 px-3 py-2.5"
            data-testid="investigation-conversation-live-steps"
          >
            <ChatActivityFeed
              events={view.activeRun.events}
              hideChrome={true}
              showLiveIndicator={false}
              maxVisibleSteps={8}
            />
          </div>
        ) : (
          <></>
        )}

        {widgets.length > 0 ? <WidgetRenderer widgets={widgets} /> : <></>}

        {message.toolActions.length > 0 ? (
          <ToolApprovalCard
            toolActions={message.toolActions}
            interactive={isWaiting}
            isSubmitting={conversation.isSubmittingApproval}
            onRespond={(decisions: Array<ToolDecision>) => {
              conversation
                .respondToApproval(message.id, decisions)
                .catch(() => {
                  // handled inside respondToApproval
                });
            }}
          />
        ) : (
          <></>
        )}

        {message.citations.length > 0 ? (
          <div className="border-t border-gray-100 pt-2.5">
            <CitationChips citations={message.citations} />
          </div>
        ) : (
          <></>
        )}

        {message.status === AIChatMessageStatus.Completed && message.content ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                copyAnswer(message);
              }}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <Icon
                icon={
                  copiedMessageId === message.id
                    ? IconProp.Check
                    : IconProp.Copy
                }
                className="h-3 w-3"
              />
              {copiedMessageId === message.id ? "Copied" : "Copy"}
            </button>
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  const renderAnswer: (message: ThreadMessage) => ReactElement = (
    message: ThreadMessage,
  ): ReactElement => {
    return (
      <li
        key={message.id}
        className="flex gap-3"
        data-testid="investigation-conversation-answer"
      >
        <AIAvatar />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold text-gray-900">
              {AI_DISPLAY_NAME}
            </span>
            {!isViewer(message.author, viewerUserId) && message.author.name ? (
              <span className="text-xs text-gray-400">
                to {message.author.name}
              </span>
            ) : (
              <></>
            )}
            <MessageTime date={message.createdAt} />
          </div>
          {renderAnswerBody(message)}
        </div>
      </li>
    );
  };

  const header: ReactElement = (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
          <Icon icon={IconProp.ChatBubbleLeftRight} className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">
            Ask {AI_DISPLAY_NAME}
          </h3>
          <p className="mt-0.5 text-xs leading-5 text-gray-500">
            Ask a follow-up question, or ask it to act. Everyone on this{" "}
            {subjectType} sees this conversation.
          </p>
        </div>
      </div>
      {participants.length > 0 ? (
        <div
          className="flex flex-shrink-0 items-center"
          aria-label={`${participants.length} ${
            participants.length === 1 ? "person has" : "people have"
          } asked in this conversation`}
          title={participants
            .map((author: ThreadAuthor): string => {
              return describeAuthor(author, viewerUserId);
            })
            .join(", ")}
        >
          <div className="flex -space-x-2">
            {participants.slice(0, 4).map((author: ThreadAuthor) => {
              return (
                <PersonAvatar
                  key={author.userId || author.name}
                  author={author}
                  size="sm"
                />
              );
            })}
          </div>
          {participants.length > 4 ? (
            <span className="ml-1.5 text-xs text-gray-500">
              +{participants.length - 4}
            </span>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}
    </div>
  );

  const emptyState: ReactElement = (
    <div
      className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-4 py-4"
      data-testid="investigation-conversation-empty"
    >
      <p className="text-sm text-gray-600">
        Nobody has asked anything yet. Start with one of these, or type your
        own:
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {suggestions.map((suggestion: SuggestedPrompt) => {
          return (
            <button
              key={suggestion.label}
              type="button"
              disabled={conversation.isSending}
              onClick={() => {
                applySuggestion(suggestion);
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon
                icon={suggestion.isAction ? IconProp.Bolt : IconProp.Sparkles}
                className="h-3.5 w-3.5 text-gray-400"
              />
              {suggestion.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  const body: ReactElement = (
    <section
      aria-label={`Conversation with ${AI_DISPLAY_NAME}`}
      data-testid="investigation-conversation"
      className={
        props.variant === "card" ? "" : "border-t border-gray-200 pt-6"
      }
    >
      {props.variant === "card" ? <></> : header}

      {!conversation.hasLoaded ? (
        <p
          role="status"
          className="mt-4 flex items-center gap-2 text-sm text-gray-500"
        >
          <span className="h-3.5 w-3.5 rounded-full border-2 border-gray-200 border-t-gray-500 motion-safe:animate-spin" />
          Loading the conversation…
        </p>
      ) : conversation.loadError && view.messages.length === 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-gray-600">
          <span>Could not load the conversation: {conversation.loadError}</span>
          <button
            type="button"
            onClick={() => {
              conversation.refresh().catch(() => {
                // handled inside refresh
              });
            }}
            className="rounded-md px-2 py-1 text-sm font-medium text-indigo-600 hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            Try again
          </button>
        </div>
      ) : view.messages.length === 0 ? (
        <div className="mt-4">{emptyState}</div>
      ) : (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="mt-5 max-h-[40rem] overflow-y-auto overscroll-contain pr-1"
        >
          <ol
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            className="space-y-6"
          >
            {view.messages.map((message: ThreadMessage) => {
              return message.role === AIChatMessageRole.User
                ? renderQuestion(message)
                : renderAnswer(message);
            })}
          </ol>
        </div>
      )}

      {conversation.actionError ? (
        <div className="mt-4">
          <Alert
            type={AlertType.DANGER}
            title={conversation.actionError}
            onClose={() => {
              conversation.clearActionError();
            }}
            dataTestId="investigation-conversation-error"
          />
        </div>
      ) : (
        <></>
      )}

      <ChatInput
        className="mt-4"
        value={conversation.input}
        onChange={conversation.setInput}
        onSend={() => {
          conversation.sendMessage().catch(() => {
            // handled inside sendMessage
          });
        }}
        canSend={sendBlocker === null}
        isWorking={isBusy || conversation.isSending}
        onStop={
          isBusy
            ? () => {
                conversation.cancel().catch(() => {
                  // handled inside cancel
                });
              }
            : undefined
        }
        isStopping={conversation.isCancelling}
        autoFocus={false}
        footerHint="Answers cite the data they used"
        placeholder={
          isBusy
            ? "Type your next question — send it when this answer finishes…"
            : `Ask about this ${subjectType}, or ask ${AI_DISPLAY_NAME} to act…`
        }
        leading={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <PermissionModePicker
              value={conversation.permissionMode}
              onChange={conversation.setPermissionMode}
            />
            <span className="text-[11px] leading-4 text-gray-500">
              {describePermissionMode(conversation.permissionMode)}
            </span>
          </div>
        }
      />
    </section>
  );

  if (props.variant === "card") {
    return (
      <Card
        title={`Ask ${AI_DISPLAY_NAME}`}
        description={`Ask a follow-up question about this ${subjectType}, or ask ${AI_DISPLAY_NAME} to act. Everyone on this ${subjectType} sees this conversation.`}
      >
        {body}
      </Card>
    );
  }

  return body;
};

export default InvestigationConversation;
