import ChatActivityFeed, {
  hasRenderableActivity,
} from "../../AIChat/ChatActivityFeed";
import { navigateToCitationTarget } from "../../AIChat/CitationTargetNav";
import { AIInvestigationStage } from "../AIInvestigationStatus";
import InvestigationNotice, { noticeFailedIcon } from "../InvestigationNotice";
import { CITATION_CHIP_CLASS_NAME } from "../InvestigationReport/InvestigationCitationChip";
import ToolApprovalCard, { ToolDecision } from "../../AIChat/ToolApprovalCard";
import WidgetRenderer from "../../AIChat/Widgets/WidgetRenderer";
import AnswerSources from "./AnswerSources";
import ConversationComposer from "./ConversationComposer";
import AIChatMessageRole from "Common/Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "Common/Types/AI/AIChatMessageStatus";
import {
  AIChatCitation,
  AIChatToolAction,
  AIChatWidget,
} from "Common/Types/AI/AIChatTypes";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
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
  ThreadTail,
  ThreadView,
  ToolActionOutcome,
  describeAuthor,
  describeConversation,
  describeThreadActivity,
  describeToolActionOutcome,
  findActiveAssistantMessage,
  getAvatarTone,
  getInitials,
  getSendBlocker,
  getSuggestedPrompts,
  getThreadTail,
  getVisibleWidgets,
  isThreadBusy,
  isToolActionAwaitingApproval,
  isViewer,
} from "./InvestigationConversationData";
import useInvestigationConversation, {
  UseInvestigationConversation,
} from "./useInvestigationConversation";

export interface ComponentProps {
  subjectType: InvestigationConversationSubjectType;
  subjectId: ObjectID;
  /*
   * Where the automatic investigation above the conversation stands (see
   * AIInvestigationStage). The card passes it so the conversation can say
   * "follow-up" only under a report, and lead its suggestions with the
   * root-cause question when there is no report to read. Left out, the
   * conversation behaves as it does while one is underway.
   */
  investigationStage?: AIInvestigationStage | undefined;
}

// The section's title, and the name of the text box it ends with.
export const CONVERSATION_TITLE: string = `Ask ${AI_DISPLAY_NAME}`;

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

/*
 * OneUptime AI's mark in the thread: the solid indigo sparkle the event
 * header uses for its root-cause summary, so the AI looks like one author
 * across the page.
 */
const AIAvatar: FunctionComponent = (): ReactElement => {
  return (
    <div
      aria-hidden="true"
      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white"
    >
      <Icon icon={IconProp.Sparkles} className="h-4 w-4" />
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
 * A message is its author's mark, a line saying who and when, and what was
 * said. From sm up the mark stands beside both, so the text lines up under
 * the name. On a phone the text takes the row under the mark instead, at the
 * card's full width: an answer with a table or its sources in it has no 44px
 * to give away there.
 */
const MESSAGE_CLASS_NAME: string =
  "grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3";
const MESSAGE_MARK_CLASS_NAME: string = "self-start sm:row-span-2";
const MESSAGE_BYLINE_CLASS_NAME: string =
  "flex min-w-0 flex-wrap items-baseline gap-x-2 self-center";
const MESSAGE_BODY_CLASS_NAME: string =
  "col-span-2 mt-1.5 min-w-0 sm:col-span-1 sm:col-start-2 sm:mt-0";

const SPINNER_CLASS_NAME: string =
  "h-3.5 w-3.5 flex-shrink-0 rounded-full border-2 border-indigo-200 border-t-indigo-600 motion-safe:animate-spin";

/*
 * The conversation that closes the AI Investigation card: one shared thread
 * per incident or alert, where every responder can ask OneUptime AI
 * questions and ask it to act. Questions carry who asked them, answers cite
 * their evidence, the answer being written narrates its steps live, and an
 * action waiting for approval can be decided by anyone on the incident.
 *
 * It is a section of the card, drawn like the rest of it: the card's
 * heading style, plain text, and no panel of its own. The thread is part of
 * the page rather than a scrolling box inside the card, so a long one opens
 * on its newest messages.
 */
const InvestigationConversation: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const subjectType: InvestigationConversationSubjectType = props.subjectType;
  const subjectIdString: string = props.subjectId.toString();
  const subjectKey: string = `${subjectType}:${subjectIdString}`;
  const stage: AIInvestigationStage | undefined = props.investigationStage;

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
    return getSuggestedPrompts(subjectType, stage);
  }, [subjectType, stage]);

  const sendBlocker: string | null = getSendBlocker({
    view,
    input: conversation.input,
    isSending: conversation.isSending,
  });

  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  /*
   * The subject whose whole thread the reader asked to see. Keyed by the
   * subject, so the next incident opens folded again.
   */
  const [unfoldedSubjectKey, setUnfoldedSubjectKey] = useState<string | null>(
    null,
  );
  const tail: ThreadTail = getThreadTail(
    view.messages,
    unfoldedSubjectKey === subjectKey,
  );
  const threadRef: React.RefObject<HTMLOListElement> =
    useRef<HTMLOListElement>(null);
  const shouldFocusThreadRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  /*
   * Unfolding removes the button that was pressed. Hand focus to the thread
   * it revealed, or a keyboard reader is dropped at the top of the page.
   */
  useEffect(() => {
    if (shouldFocusThreadRef.current) {
      shouldFocusThreadRef.current = false;
      threadRef.current?.focus({ preventScroll: true });
    }
  }, [unfoldedSubjectKey]);

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
        className={MESSAGE_CLASS_NAME}
        data-testid="investigation-conversation-question"
      >
        <div className={MESSAGE_MARK_CLASS_NAME}>
          <PersonAvatar author={message.author} />
        </div>
        <div className={MESSAGE_BYLINE_CLASS_NAME}>
          <span className="text-sm font-semibold text-gray-900">
            {describeAuthor(message.author, viewerUserId)}
          </span>
          {message.isOptimistic ? (
            <span className="text-xs text-gray-400">Sending…</span>
          ) : (
            <MessageTime date={message.createdAt} />
          )}
        </div>
        <div className={MESSAGE_BODY_CLASS_NAME}>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-6 text-gray-900">
            {message.content}
          </p>
        </div>
      </li>
    );
  };

  /*
   * An action nobody is waiting on any more: a mark, what it was and how it
   * ended, as a line of the answer. It used to be a bordered gray row with
   * a coloured chip in it.
   */
  const renderSettledAction: (action: AIChatToolAction) => ReactElement = (
    action: AIChatToolAction,
  ): ReactElement => {
    const outcome: ToolActionOutcome = describeToolActionOutcome(action.status);

    return (
      <li
        key={action.id}
        data-status={action.status}
        className="flex items-start gap-2 text-sm leading-6"
      >
        {/* A div, not a span: Icon renders its own div around the svg. */}
        <div className="flex h-6 flex-shrink-0 items-center">
          <Icon
            icon={outcome.icon}
            className={`h-4 w-4 ${outcome.iconClassName}`}
          />
        </div>
        <p className="min-w-0 break-words text-gray-700">
          {action.title}
          <span className="text-gray-500"> · {outcome.label}</span>
        </p>
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
    const awaitingApproval: Array<AIChatToolAction> =
      message.toolActions.filter(isToolActionAwaitingApproval);
    const settledActions: Array<AIChatToolAction> = message.toolActions.filter(
      (action: AIChatToolAction): boolean => {
        return !isToolActionAwaitingApproval(action);
      },
    );

    /*
     * What the answer has already done. It is listed under a stopped or a
     * failed answer too: an action that ran before the answer ended still
     * changed something, and the thread is where a responder finds out.
     */
    const settledActionList: ReactElement =
      settledActions.length > 0 ? (
        <ul
          role="list"
          aria-label="Actions"
          data-testid="investigation-conversation-actions"
          className="space-y-0.5"
        >
          {settledActions.map(renderSettledAction)}
        </ul>
      ) : (
        <></>
      );

    if (message.status === AIChatMessageStatus.Cancelled) {
      return (
        <div className="mt-0.5 space-y-3">
          <div className="flex items-start gap-2 text-sm leading-6 text-gray-500">
            <div className="flex h-6 flex-shrink-0 items-center">
              <Icon icon={IconProp.StopCircle} className="h-4 w-4" />
            </div>
            <p className="min-w-0 break-words">
              {message.content || "Stopped."}
            </p>
          </div>
          {settledActionList}
        </div>
      );
    }

    /*
     * A failed answer is a line with a red mark, like the card's own "The
     * investigation stopped before it could report": no red box.
     */
    if (message.status === AIChatMessageStatus.Error) {
      return (
        <div className="mt-0.5 space-y-3">
          <div
            data-testid="investigation-conversation-answer-error"
            className="flex items-start gap-2 text-sm leading-6"
          >
            <div className="flex h-6 flex-shrink-0 items-center">
              <Icon icon={IconProp.Alert} className="h-4 w-4 text-red-600" />
            </div>
            <div className="min-w-0">
              <p className="break-words text-gray-900">
                {message.errorMessage ||
                  "Something went wrong while answering."}
              </p>
              <p className="text-xs leading-5 text-gray-500">
                Ask again to retry.
              </p>
            </div>
          </div>
          {settledActionList}
        </div>
      );
    }

    return (
      <div className="mt-0.5 space-y-3">
        {message.content ? (
          <div className="text-sm leading-6 text-gray-700">
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
            {awaitingApproval.length > 1
              ? "I'd like to take these actions. Review them and approve to continue."
              : "I'd like to take this action. Review it and approve to continue."}
          </p>
        ) : isWorking ? (
          <div
            role="status"
            className="flex items-center gap-2 text-sm leading-6 text-gray-600"
          >
            <span className={SPINNER_CLASS_NAME} />
            <span>
              {activityLine || `${AI_DISPLAY_NAME} is looking into it…`}
            </span>
          </div>
        ) : (
          <></>
        )}

        {/*
          The steps of the answer being written hang from a rule on their
          left, the way a quote does: a trail of the answer above them, with
          no box around it.
        */}
        {isWorking &&
        isActiveRunMessage &&
        view.activeRun &&
        hasRenderableActivity(view.activeRun.events) ? (
          <div
            className="border-l-2 border-gray-200 pl-3"
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

        {/*
          Charts and tables are figures: each keeps the frame it has
          everywhere else it is drawn, grouped and named for a screen reader.
        */}
        {widgets.length > 0 ? (
          <div role="group" aria-label="Data from this answer">
            <WidgetRenderer widgets={widgets} />
          </div>
        ) : (
          <></>
        )}

        {settledActionList}

        {/*
          The one place the card raises its voice: OneUptime AI is about to
          change something and is waiting for a person to say yes. It keeps
          the approval prompt of the Ask AI panel, as a group of controls.
        */}
        {awaitingApproval.length > 0 ? (
          <div role="group" aria-label="Actions waiting for approval">
            <ToolApprovalCard
              toolActions={awaitingApproval}
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
          </div>
        ) : (
          <></>
        )}

        <AnswerSources citations={message.citations} />

        {message.status === AIChatMessageStatus.Completed && message.content ? (
          <div>
            <button
              type="button"
              onClick={() => {
                copyAnswer(message);
              }}
              className="-ml-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <Icon
                icon={
                  copiedMessageId === message.id
                    ? IconProp.Check
                    : IconProp.Copy
                }
                className="h-3.5 w-3.5"
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
        className={MESSAGE_CLASS_NAME}
        data-testid="investigation-conversation-answer"
        data-status={message.status}
      >
        <div className={MESSAGE_MARK_CLASS_NAME}>
          <AIAvatar />
        </div>
        <div className={MESSAGE_BYLINE_CLASS_NAME}>
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
        <div className={MESSAGE_BODY_CLASS_NAME}>
          {renderAnswerBody(message)}
        </div>
      </li>
    );
  };

  /*
   * The title and the quieter line under it are styled exactly like the
   * card's other rows ("Act on this investigation", the verdict), so the
   * conversation reads as the card's next row. It used to open with an
   * indigo icon tile in front of its title: a card header inside the card.
   */
  const header: ReactElement = (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-gray-900">
          {CONVERSATION_TITLE}
        </h3>
        <p className="mt-1 text-xs leading-5 text-gray-500">
          {describeConversation(subjectType, stage)}
        </p>
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
          {/*
            Barely overlapped: these are initials, and a deeper overlap
            covers the second letter of every avatar but the last.
          */}
          <div className="flex -space-x-1">
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

  const loading: ReactElement = (
    <p role="status" className="flex items-center gap-2 text-sm text-gray-500">
      <span className="h-3.5 w-3.5 flex-shrink-0 rounded-full border-2 border-gray-200 border-t-gray-500 motion-safe:animate-spin" />
      Loading the conversation…
    </p>
  );

  /*
   * Nobody has asked yet: the questions worth asking first, one click away,
   * straight above the box they would otherwise be typed in. Plain chips
   * and nothing else: a sentence saying the thread is empty only repeated
   * what the empty space already says.
   */
  const suggestionChips: ReactElement = (
    <div
      role="group"
      aria-label="Suggested questions"
      data-testid="investigation-conversation-empty"
      className="flex flex-wrap gap-2"
    >
      {suggestions.map((suggestion: SuggestedPrompt) => {
        return (
          <button
            key={suggestion.label}
            type="button"
            disabled={conversation.isSending}
            data-suggestion-kind={suggestion.isAction ? "action" : "question"}
            onClick={() => {
              applySuggestion(suggestion);
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {/*
              Only a request to change something carries a mark: it is put
              in the box for the responder to send, where a question is
              asked on the click.
            */}
            {suggestion.isAction ? (
              <Icon
                icon={IconProp.Bolt}
                className="h-3.5 w-3.5 text-gray-400"
              />
            ) : (
              <></>
            )}
            {suggestion.label}
          </button>
        );
      })}
    </div>
  );

  let body: ReactElement;

  if (!conversation.hasLoaded) {
    body = loading;
  } else if (conversation.loadError && view.messages.length === 0) {
    body = (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600">
        <span>Could not load the conversation: {conversation.loadError}</span>
        <button
          type="button"
          onClick={() => {
            conversation.refresh().catch(() => {
              // handled inside refresh
            });
          }}
          className="-mx-2 rounded-md px-2 py-1 text-sm font-medium text-indigo-600 hover:bg-indigo-50 hover:text-indigo-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          Try again
        </button>
      </div>
    );
  } else if (view.messages.length === 0) {
    /*
     * The suggestions depend on whether the card has a report, so they wait
     * for the card to know: showing five and then squeezing a sixth in
     * front of them would move the chips under the pointer.
     */
    body = stage === "checking" ? loading : suggestionChips;
  } else {
    body = (
      <div className="space-y-5">
        {tail.hiddenCount > 0 ? (
          <button
            type="button"
            data-testid="investigation-conversation-show-earlier"
            onClick={() => {
              shouldFocusThreadRef.current = true;
              setUnfoldedSubjectKey(subjectKey);
            }}
            className="-mx-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <Icon icon={IconProp.ChevronUp} className="h-3.5 w-3.5" />
            {/* Always plural: a thread never folds fewer than two away. */}
            Show {tail.hiddenCount} earlier messages
          </button>
        ) : (
          <></>
        )}
        <ol
          ref={threadRef}
          tabIndex={-1}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          className="space-y-5 focus:outline-none"
        >
          {tail.messages.map((message: ThreadMessage) => {
            return message.role === AIChatMessageRole.User
              ? renderQuestion(message)
              : renderAnswer(message);
          })}
        </ol>
      </div>
    );
  }

  return (
    <section
      aria-label={`Conversation with ${AI_DISPLAY_NAME}`}
      data-testid="investigation-conversation"
      className="space-y-4 border-t border-gray-200 pt-5"
    >
      {header}

      {body}

      {/*
        A question that was refused, a decision or a stop that did not go
        through: said in the card's own notice, where it was a red box
        between the thread and the composer.
      */}
      {conversation.actionError ? (
        <InvestigationNotice
          role="alert"
          testId="investigation-conversation-error"
          indicator={noticeFailedIcon}
          title={conversation.actionError}
          onDismiss={() => {
            conversation.clearActionError();
          }}
        />
      ) : (
        <></>
      )}

      <ConversationComposer
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
        label={CONVERSATION_TITLE}
        placeholder={
          isBusy
            ? "Type your next question — send it when this answer finishes…"
            : `Ask about this ${subjectType}, or ask ${AI_DISPLAY_NAME} to act…`
        }
        permissionMode={conversation.permissionMode}
        onPermissionModeChange={conversation.setPermissionMode}
      />
    </section>
  );
};

export default InvestigationConversation;
