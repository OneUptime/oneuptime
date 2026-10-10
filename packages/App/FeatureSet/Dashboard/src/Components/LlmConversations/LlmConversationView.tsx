import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router-dom";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import OneUptimeDate from "Common/Types/Date";
import Route from "Common/Types/API/Route";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import {
  LlmConversationKey,
  LlmConversationKeyKind,
  LlmConversationKeyUtil,
} from "Common/Types/Telemetry/LlmConversationApi";
import {
  LlmTranscript,
  LlmTranscriptStep,
} from "Common/Utils/Telemetry/LlmConversationTranscript";
import {
  LlmAnswerIssue,
  LlmAnswerIssueUtil,
} from "Common/Types/Telemetry/LlmAnswerIssue";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import LlmIssueBadge from "./LlmIssueBadge";
import LlmReplayBar from "./LlmReplayBar";
import LlmTranscriptStepView from "./LlmTranscriptStepView";
import {
  LlmConversationView as LlmConversationViewData,
  fetchLlmConversation,
} from "./LlmConversationsApi";
import {
  getLlmPageRoute,
  getLlmTraceRoute,
  readLlmConversationKeyFromPath,
} from "./LlmConversationRoutes";
import {
  LlmConversationReplayController,
  useLlmConversationReplay,
} from "./useLlmConversationReplay";
import {
  LlmPendingAnswer,
  getLlmPendingAnswer,
  readLlmStepParam,
} from "./LlmReplayModel";
import { LlmReplayKeyAction, getLlmReplayKeyAction } from "./LlmReplayKeyboard";
import {
  formatLlmCost,
  formatLlmDuration,
  formatLlmTokens,
  truncateLlmText,
} from "./LlmConversationFormat";
import { LlmServiceNames, useLlmServiceNames } from "./useLlmServiceNames";

/*
 * ONE CONVERSATION, TO READ OR TO REPLAY.
 *
 * Opens with the whole conversation on screen, the way a chat app shows its
 * history: what the person said on the right, the AI's answers on the left
 * with their model, time, tokens and cost, tool calls between them, and
 * what went wrong marked where it happened.
 *
 * The bar at the bottom replays it the way session replay replays a visit:
 * from the first message (or from any message - its time is a button), at
 * the pace it really happened with long silences shortened, "AI is
 * answering…" counting up while an answer is on its way. While a replay is
 * part-way, the messages still to come are hidden and the end of the
 * transcript says how many, with a way back to the whole conversation. The
 * URL keeps the message a replay stopped at (?step=), so a link points at
 * that moment.
 */

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; data: LlmConversationViewData }
  | { kind: "error"; message: string }
  | { kind: "invalid" };

const NO_STEPS: Array<LlmTranscriptStep> = [];

interface Fact {
  key: string;
  icon: IconProp;
  text: string;
}

export function getLlmConversationTitle(data: {
  transcript: LlmTranscript;
  kind: LlmConversationKeyKind;
  conversationId: string;
  translator: Translator;
}): string {
  if (data.transcript.title) {
    return truncateLlmText(data.transcript.title, 200);
  }

  const firstTraceId: string = data.transcript.steps[0]?.call.traceId || "";

  return data.kind === LlmConversationKeyKind.Request
    ? data.translator.translateTemplate("Request {{id}}", {
        id: firstTraceId.slice(0, 8),
      })
    : data.translator.translateTemplate("Conversation {{id}}", {
        id: truncateLlmText(data.conversationId, 40),
      });
}

const LlmConversationView: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const location: ReturnType<typeof useLocation> = useLocation();
  const services: LlmServiceNames = useLlmServiceNames();

  const key: LlmConversationKey | null = useMemo(() => {
    return readLlmConversationKeyFromPath(location.pathname);
  }, [location.pathname]);

  const query: URLSearchParams = useMemo(() => {
    return new URLSearchParams(location.search);
  }, [location.search]);

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reloadToken, setReloadToken] = useState<number>(0);

  useEffect(() => {
    if (!key) {
      setState({ kind: "invalid" });
      return;
    }

    let cancelled: boolean = false;
    setState({ kind: "loading" });

    fetchLlmConversation({
      key: LlmConversationKeyUtil.encode(key),
      startTime: query.get("from") || undefined,
      endTime: query.get("to") || undefined,
    })
      .then((data: LlmConversationViewData | null) => {
        if (cancelled) {
          return;
        }

        setState(
          data
            ? { kind: "loaded", data: data }
            : {
                kind: "error",
                message:
                  translator.translateText(
                    "The conversation could not be read.",
                  ) || "",
              },
        );
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setState({
          kind: "error",
          message: API.getFriendlyMessage(error as Error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [key?.kind, key?.value, reloadToken]);

  const transcript: LlmTranscript | null =
    state.kind === "loaded" ? state.data.transcript : null;
  const steps: Array<LlmTranscriptStep> = transcript?.steps || NO_STEPS;

  const initialStep: number | null = readLlmStepParam(
    query.get("step"),
    steps.length,
  );

  const replay: LlmConversationReplayController = useLlmConversationReplay(
    steps,
    initialStep,
  );

  /*
   * A ?step= link arrives before the transcript does: once it has loaded,
   * put the clock on that step.
   */
  const appliedStepRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  useEffect(() => {
    if (appliedStepRef.current || steps.length === 0) {
      return;
    }

    appliedStepRef.current = true;

    if (initialStep !== null) {
      replay.goToStep(initialStep);
    }
  }, [steps]);

  // Keep the URL on the message the replay stopped at.
  useEffect(() => {
    if (replay.isPlaying || steps.length === 0) {
      return;
    }

    Navigation.setQueryString({
      step: replay.isAtEnd ? null : String(Math.max(0, replay.currentIndex)),
    });
  }, [replay.currentIndex, replay.isPlaying, replay.isAtEnd, steps.length]);

  // Follow the newest message while playing.
  const stepRefs: React.MutableRefObject<Map<string, HTMLDivElement>> = useRef<
    Map<string, HTMLDivElement>
  >(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (!replay.isPlaying || replay.currentIndex < 0) {
      return;
    }

    const step: LlmTranscriptStep | undefined = steps[replay.currentIndex];
    const element: HTMLDivElement | undefined = step
      ? stepRefs.current.get(step.id)
      : undefined;

    element?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [replay.currentIndex, replay.isPlaying]);

  // The replay's keys, while this page is open (see LlmReplayKeyboard).
  const handleKey: (event: KeyboardEvent) => void = useCallback(
    (event: KeyboardEvent): void => {
      const target: HTMLElement | null = event.target as HTMLElement | null;
      const action: LlmReplayKeyAction | null = getLlmReplayKeyAction({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        targetTagName: target?.tagName || "",
        targetRole: target?.getAttribute?.("role") || "",
        targetIsContentEditable: Boolean(target?.isContentEditable),
      });

      if (!action || steps.length === 0) {
        return;
      }

      event.preventDefault();

      switch (action) {
        case "toggle":
          replay.togglePlay();
          break;
        case "previous":
          replay.pause();
          replay.previous();
          break;
        case "next":
          replay.pause();
          replay.next();
          break;
      }
    },
    [replay, steps.length],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKey);

    return () => {
      window.removeEventListener("keydown", handleKey);
    };
  }, [handleKey]);

  const listRoute: Route = getLlmPageRoute(PageMap.LLM_CONVERSATIONS);
  const setupRoute: Route = getLlmPageRoute(PageMap.LLM_DOCUMENTATION);

  if (state.kind === "invalid") {
    return (
      <div
        className="rounded-lg bg-white shadow"
        data-testid="llm-conversation-invalid"
      >
        <TableEmptyState
          kind={TableEmptyStateKind.Filtered}
          icon={IconProp.ChatBubbleLeftRight}
          title="This link does not point to a conversation"
          description="Open the conversation again from the list."
          actions={[
            {
              title: "All conversations",
              icon: IconProp.ArrowLeft,
              dataTestId: "llm-conversation-back",
              onClick: () => {
                Navigation.navigate(listRoute);
              },
            },
          ]}
        />
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div
        className="rounded-lg bg-white shadow"
        data-testid="llm-conversation-error"
      >
        <TableEmptyState
          kind={TableEmptyStateKind.Error}
          title="Couldn't load this conversation"
          description={state.message}
          actions={[
            {
              title: "Try again",
              icon: IconProp.Refresh,
              dataTestId: "refresh-button",
              onClick: () => {
                setReloadToken(reloadToken + 1);
              },
            },
          ]}
        />
      </div>
    );
  }

  if (state.kind === "loading" || !transcript) {
    return (
      <div className="space-y-4" data-testid="llm-conversation-loading">
        <div className="h-28 animate-pulse rounded-lg bg-white shadow" />
        <div className="space-y-3 rounded-lg bg-white p-6 shadow">
          <div className="ml-auto h-10 w-1/2 animate-pulse rounded-2xl bg-gray-100" />
          <div className="h-20 w-2/3 animate-pulse rounded-2xl bg-gray-100" />
          <div className="ml-auto h-10 w-1/3 animate-pulse rounded-2xl bg-gray-100" />
        </div>
      </div>
    );
  }

  const data: LlmConversationViewData = state.data;

  if (steps.length === 0) {
    return (
      <div
        className="rounded-lg bg-white shadow"
        data-testid="llm-conversation-not-found"
      >
        <TableEmptyState
          kind={TableEmptyStateKind.Filtered}
          icon={IconProp.ChatBubbleLeftRight}
          title="No AI calls found for this conversation"
          description="It may be older than your telemetry retention, or in an app you cannot see."
          actions={[
            {
              title: "All conversations",
              icon: IconProp.ArrowLeft,
              dataTestId: "llm-conversation-back",
              onClick: () => {
                Navigation.navigate(listRoute);
              },
            },
          ]}
        />
      </div>
    );
  }

  const issues: Array<LlmAnswerIssue> =
    LlmAnswerIssueUtil.getAllIssues().filter(
      (issue: LlmAnswerIssue): boolean => {
        return (transcript.issueCounts[issue] || 0) > 0;
      },
    );

  const appNames: Array<string> = transcript.serviceIds
    .map((id: string): string => {
      return services.names.get(id) || "";
    })
    .filter((name: string): boolean => {
      return name.length > 0;
    });

  const firstTraceId: string = steps[0]?.call.traceId || "";
  const personLabel: string = transcript.users[0] || "";

  const facts: Array<Fact> = [];

  if (personLabel) {
    facts.push({
      key: "person",
      icon: IconProp.User,
      text: transcript.users.join(", "),
    });
  }

  if (appNames.length > 0) {
    facts.push({ key: "app", icon: IconProp.Cube, text: appNames.join(", ") });
  }

  if (transcript.models.length > 0) {
    facts.push({
      key: "models",
      icon: IconProp.Sparkles,
      text: transcript.models.join(", "),
    });
  }

  facts.push({
    key: "started",
    icon: IconProp.Calendar,
    text: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
      new Date(transcript.startMs),
    ),
  });

  facts.push({
    key: "duration",
    icon: IconProp.Clock,
    text: formatLlmDuration(transcript.endMs - transcript.startMs),
  });

  facts.push({
    key: "answers",
    icon: IconProp.ChatBubbleLeftRight,
    text: translator.translatePlural(
      { one: "{{count}} answer", other: "{{count}} answers" },
      transcript.answerCount,
    ),
  });

  if (transcript.costUsd > 0) {
    facts.push({
      key: "cost",
      icon: IconProp.CurrencyDollar,
      text: formatLlmCost(transcript.costUsd),
    });
  }

  if (transcript.inputTokens + transcript.outputTokens > 0) {
    facts.push({
      key: "tokens",
      icon: IconProp.Hashtag,
      text: translator.translateTemplate("{{tokens}} tokens", {
        tokens: formatLlmTokens(
          transcript.inputTokens + transcript.outputTokens,
        ),
      }),
    });
  }

  const title: string = getLlmConversationTitle({
    transcript: transcript,
    kind: data.kind,
    conversationId: data.conversationId,
    translator: translator,
  });

  const visibleSteps: Array<LlmTranscriptStep> = steps.slice(
    0,
    replay.visibleCount,
  );
  const hiddenCount: number = steps.length - visibleSteps.length;

  const pending: LlmPendingAnswer | null = getLlmPendingAnswer(
    steps,
    replay.visibleCount,
    replay.realTimeMs,
  );

  return (
    <div data-testid="llm-conversation-view">
      <div className="mb-3">
        <AppLink
          to={listRoute}
          className="inline-flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-900"
        >
          <Icon icon={IconProp.ArrowLeft} className="h-4 w-4" />
          <span>{translator.translateText("All conversations")}</span>
        </AppLink>
      </div>

      <div
        className="rounded-lg bg-white p-5 shadow sm:p-6"
        data-testid="llm-conversation-header"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div
              className="hidden h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-indigo-50 sm:flex"
              aria-hidden="true"
            >
              <Icon
                icon={IconProp.ChatBubbleLeftRight}
                className="h-6 w-6 text-indigo-600"
              />
            </div>
            <div className="min-w-0">
              <h2
                className="break-words text-lg font-semibold leading-7 text-gray-900"
                data-testid="llm-conversation-title"
              >
                {title}
              </h2>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-gray-500">
                {facts.map((fact: Fact) => {
                  return (
                    <div
                      key={fact.key}
                      className="flex min-w-0 items-center gap-1.5"
                      data-fact={fact.key}
                    >
                      <Icon
                        icon={fact.icon}
                        className="h-4 w-4 flex-shrink-0 text-gray-400"
                      />
                      <div className="truncate">{fact.text}</div>
                    </div>
                  );
                })}
              </div>
              {issues.length > 0 ? (
                <div
                  className="mt-3 flex flex-wrap gap-1.5"
                  data-testid="llm-conversation-issues"
                >
                  {issues.map((issue: LlmAnswerIssue) => {
                    return (
                      <LlmIssueBadge
                        key={issue}
                        issue={issue}
                        count={transcript.issueCounts[issue]}
                      />
                    );
                  })}
                </div>
              ) : (
                <></>
              )}
            </div>
          </div>
          {firstTraceId ? (
            <div className="flex flex-shrink-0 flex-wrap gap-2 lg:justify-end">
              <AppLink
                to={getLlmTraceRoute(firstTraceId)}
                className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
              >
                <Icon icon={IconProp.Waterfall} className="h-4 w-4" />
                <span>{translator.translateText("Open in Traces")}</span>
              </AppLink>
            </div>
          ) : (
            <></>
          )}
        </div>

        {data.kind === LlmConversationKeyKind.Request ? (
          <div
            className="mt-4 flex items-start gap-2 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600"
            data-testid="llm-conversation-request-note"
          >
            <Icon
              icon={IconProp.Info}
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
            />
            <div>
              {translator.translateText(
                "Your app did not send a conversation id, so this shows one request: every AI call it made.",
              )}{" "}
              <AppLink
                to={setupRoute}
                className="font-medium text-indigo-600 hover:text-indigo-700"
              >
                {translator.translateText("Group calls into conversations") ||
                  ""}
              </AppLink>
            </div>
          </div>
        ) : (
          <></>
        )}

        {!transcript.contentRecorded ? (
          <div
            className="mt-4 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800"
            data-testid="llm-conversation-no-content-note"
          >
            <Icon
              icon={IconProp.Info}
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600"
            />
            <div>
              {translator.translateText(
                "Prompts and answers were not recorded for this conversation, so only its timing, cost and problems show.",
              )}{" "}
              <AppLink
                to={setupRoute}
                className="font-medium text-indigo-600 hover:text-indigo-700"
              >
                {translator.translateText(
                  "How to record prompts and answers",
                ) || ""}
              </AppLink>
            </div>
          </div>
        ) : (
          <></>
        )}

        {data.truncated ? (
          <div
            className="mt-4 text-xs text-gray-500"
            data-testid="llm-conversation-truncated-note"
          >
            {translator.translateText(
              "This conversation is long: it shows its first 500 AI calls.",
            )}
          </div>
        ) : (
          <></>
        )}
      </div>

      {transcript.instructions ? (
        <details
          className="mt-4 rounded-lg bg-white px-5 py-3 shadow"
          data-testid="llm-conversation-instructions"
        >
          <summary className="cursor-pointer select-none text-sm font-medium text-gray-700">
            {translator.translateText("Instructions the AI was given")}
          </summary>
          <div className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700 ring-1 ring-inset ring-gray-200">
            {truncateLlmText(transcript.instructions, 50_000)}
          </div>
        </details>
      ) : (
        <></>
      )}

      <div
        className="mt-4 space-y-5 rounded-lg bg-white p-4 shadow sm:p-6"
        data-testid="llm-transcript"
      >
        {visibleSteps.map((step: LlmTranscriptStep, index: number) => {
          return (
            <div
              key={step.id}
              className="scroll-mb-28"
              ref={(element: HTMLDivElement | null) => {
                if (element) {
                  stepRefs.current.set(step.id, element);
                } else {
                  stepRefs.current.delete(step.id);
                }
              }}
            >
              <LlmTranscriptStepView
                step={step}
                isCurrent={!replay.isAtEnd && index === replay.currentIndex}
                personLabel={personLabel}
                traceRoute={getLlmTraceRoute(
                  step.call.traceId,
                  step.call.spanId,
                )}
                setupRoute={setupRoute}
                onReplayFromHere={() => {
                  replay.goToStep(index);
                  replay.play();
                }}
              />
            </div>
          );
        })}

        {pending ? (
          <div
            className="flex items-center gap-3"
            data-testid="llm-replay-pending-answer"
          >
            <div
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-violet-100"
              aria-hidden="true"
            >
              <Icon
                icon={IconProp.Sparkles}
                className="h-4 w-4 text-violet-600"
              />
            </div>
            <div className="inline-flex items-center gap-2 rounded-2xl rounded-tl-sm bg-gray-100 px-4 py-2 text-sm text-gray-600">
              <span className="flex gap-1" aria-hidden="true">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
              </span>
              <span>
                {pending.elapsedMs < 100
                  ? pending.isTool
                    ? translator.translateText("Running the tool…")
                    : translator.translateText("AI is answering…")
                  : pending.isTool
                    ? translator.translateTemplate(
                        "Running the tool… {{duration}}",
                        { duration: formatLlmDuration(pending.elapsedMs) },
                      )
                    : translator.translateTemplate(
                        "AI is answering… {{duration}}",
                        { duration: formatLlmDuration(pending.elapsedMs) },
                      )}
              </span>
            </div>
          </div>
        ) : (
          <></>
        )}

        {hiddenCount > 0 && !replay.isPlaying ? (
          <div
            className="flex flex-col items-center gap-1 border-t border-dashed border-gray-200 pt-4 text-center text-xs text-gray-500"
            data-testid="llm-replay-hidden-note"
          >
            <span>
              {translator.translatePlural(
                {
                  one: "{{count}} more message to come in the replay",
                  other: "{{count}} more messages to come in the replay",
                },
                hiddenCount,
              )}
            </span>
            <button
              type="button"
              className="rounded font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              data-testid="llm-replay-show-all"
              onClick={() => {
                replay.goToEnd();
              }}
            >
              {translator.translateText("Show the whole conversation")}
            </button>
          </div>
        ) : (
          <></>
        )}
      </div>

      <LlmReplayBar controller={replay} steps={steps} />
    </div>
  );
};

export default LlmConversationView;
