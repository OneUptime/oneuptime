import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import OneUptimeDate from "Common/Types/Date";
import Route from "Common/Types/API/Route";
import LazyMarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import {
  LlmTranscriptStep,
  LlmTranscriptStepType,
} from "Common/Utils/Telemetry/LlmConversationTranscript";
import { LlmMessagePart } from "Common/Utils/Telemetry/LlmMessageParser";
import {
  LlmAnswerIssue,
  LlmAnswerIssueUtil,
  LlmEvaluationResult,
} from "Common/Types/Telemetry/LlmAnswerIssue";
import { LlmCallKind } from "Common/Types/Telemetry/LlmCallKind";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import AppLink from "../AppLink/AppLink";
import LlmIssueBadge from "./LlmIssueBadge";
import { LLM_ACTIVITY_LABELS } from "./LlmConversationCopy";
import {
  collapseLlmWhitespace,
  compactLlmArguments,
  formatLlmCost,
  formatLlmDuration,
  formatLlmTokens,
  prettyLlmJson,
  truncateLlmText,
} from "./LlmConversationFormat";

/*
 * One moment of a conversation, drawn the way a chat reads:
 *
 *   - what the person said, on the right;
 *   - what the AI answered, on the left, under its avatar, with the model,
 *     how long the answer took, its tokens and cost, and what went wrong
 *     with it - "Details" opens the finish reason, the evaluations and a
 *     link to the call in Traces;
 *   - a tool the AI asked for, and what the tool returned, as compact cards;
 *   - a search or an embedding as a quiet line;
 *   - a failed call as a red card with its error;
 *   - an answer whose content was not recorded, with how to record it.
 *
 * Long text is folded behind "Show more": a conversation with a pasted
 * document must not become a page of scrolling. AI answers render as
 * Markdown in safe mode (links are not clickable and images never load), and
 * people's messages render as the text they typed.
 */

// Text longer than this is folded.
export const LLM_STEP_FOLD_LENGTH: number = 1200;

export interface ComponentProps {
  step: LlmTranscriptStep;
  // The step the replay is on: drawn with a ring.
  isCurrent: boolean;
  // The person who wrote the user messages ("" when unknown).
  personLabel: string;
  // Where "Open in Traces" goes for the step's call.
  traceRoute: (step: LlmTranscriptStep) => Route;
  // Where "How to record content" goes.
  setupRoute: Route;
  onSelect: () => void;
}

const FoldableText: FunctionComponent<{
  text: string;
  markdown: boolean;
  dataTestId: string;
}> = (props: {
  text: string;
  markdown: boolean;
  dataTestId: string;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const isLong: boolean = props.text.length > LLM_STEP_FOLD_LENGTH;
  const [isOpen, setIsOpen] = useState<boolean>(false);

  const shown: string =
    isLong && !isOpen
      ? truncateLlmText(props.text, LLM_STEP_FOLD_LENGTH)
      : props.text;

  return (
    <div data-testid={props.dataTestId}>
      {props.markdown ? (
        <div className="text-sm leading-6 text-gray-800">
          <LazyMarkdownViewer text={shown} safeMode={true} />
        </div>
      ) : (
        <div className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-900">
          {shown}
        </div>
      )}
      {isLong ? (
        <button
          type="button"
          className="mt-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
          data-testid={`${props.dataTestId}-toggle`}
          onClick={(event: React.MouseEvent) => {
            event.stopPropagation();
            setIsOpen(!isOpen);
          }}
        >
          {isOpen
            ? translator.translateText("Show less")
            : translator.translateText("Show more")}
        </button>
      ) : (
        <></>
      )}
    </div>
  );
};

const CodeBlock: FunctionComponent<{
  value: string;
  dataTestId: string;
}> = (props: { value: string; dataTestId: string }): ReactElement => {
  return (
    <pre
      className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-gray-50 px-3 py-2 font-mono text-xs leading-5 text-gray-800 ring-1 ring-inset ring-gray-200"
      data-testid={props.dataTestId}
    >
      {props.value}
    </pre>
  );
};

function issuesOf(step: LlmTranscriptStep): Array<LlmAnswerIssue> {
  return LlmAnswerIssueUtil.fromValues(step.call.issues);
}

const StepTime: FunctionComponent<{ atMs: number }> = (props: {
  atMs: number;
}): ReactElement => {
  const date: Date = new Date(props.atMs);

  if (Number.isNaN(date.getTime()) || props.atMs <= 0) {
    return <></>;
  }

  // The time on the message; the full date on hover.
  return (
    <span
      className="text-xs text-gray-400"
      data-testid="llm-step-time"
      title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        date,
        false,
        true,
      )}
    >
      {OneUptimeDate.getLocalTimeString(date, {
        includeSeconds: true,
        use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
      })}
    </span>
  );
};

const MediaList: FunctionComponent<{
  media: Array<LlmMessagePart>;
}> = (props: { media: Array<LlmMessagePart> }): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.media.length === 0) {
    return <></>;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {props.media.map((part: LlmMessagePart, index: number) => {
        const icon: IconProp =
          part.modality === "image"
            ? IconProp.Image
            : part.modality === "audio"
              ? IconProp.Microphone
              : IconProp.File;

        return (
          <div
            key={index}
            className="inline-flex max-w-full items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
            data-testid="llm-step-media"
          >
            <Icon icon={icon} className="h-3 w-3 flex-shrink-0" />
            <div className="truncate">
              {part.uri
                ? truncateLlmText(part.uri, 60)
                : translator.translateTemplate("Attached {{modality}}", {
                    modality: part.modality || "file",
                  })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/*
 * "gpt-4o · 2.3 s · 1.2k tokens · $0.0021", the issues, and a Details
 * toggle with everything else about the call.
 */
const AnswerMeta: FunctionComponent<{
  step: LlmTranscriptStep;
  traceRoute: Route;
}> = (props: { step: LlmTranscriptStep; traceRoute: Route }): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const step: LlmTranscriptStep = props.step;
  const issues: Array<LlmAnswerIssue> = issuesOf(step);
  const tokens: number = step.call.inputTokens + step.call.outputTokens;

  const facts: Array<string> = [];

  if (step.call.model) {
    facts.push(step.call.model);
  }

  facts.push(formatLlmDuration(step.call.durationMs));

  if (tokens > 0) {
    facts.push(
      translator.translateTemplate("{{tokens}} tokens", {
        tokens: formatLlmTokens(tokens),
      }),
    );
  }

  if (step.call.costUsd > 0) {
    facts.push(formatLlmCost(step.call.costUsd));
  }

  return (
    <div className="mt-2" data-testid="llm-step-meta">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-gray-500">
        {facts.map((fact: string, index: number) => {
          return (
            <React.Fragment key={index}>
              {index > 0 ? (
                <span className="text-gray-300" aria-hidden="true">
                  ·
                </span>
              ) : (
                <></>
              )}
              <span>{fact}</span>
            </React.Fragment>
          );
        })}
        {issues.map((issue: LlmAnswerIssue) => {
          return <LlmIssueBadge key={issue} issue={issue} />;
        })}
        <button
          type="button"
          className="ml-1 inline-flex items-center gap-0.5 font-medium text-gray-500 hover:text-gray-900"
          aria-expanded={isOpen}
          data-testid="llm-step-details-toggle"
          onClick={(event: React.MouseEvent) => {
            event.stopPropagation();
            setIsOpen(!isOpen);
          }}
        >
          {isOpen
            ? translator.translateText("Hide details")
            : translator.translateText("Details")}
          <Icon
            icon={isOpen ? IconProp.ChevronUp : IconProp.ChevronDown}
            className="h-3 w-3"
          />
        </button>
      </div>
      {isOpen ? (
        <div
          className="mt-2 space-y-2 rounded-md bg-gray-50 px-3 py-2.5 text-xs text-gray-600 ring-1 ring-inset ring-gray-200"
          data-testid="llm-step-details"
        >
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {step.call.provider ? (
              <div className="flex gap-1.5">
                <dt className="text-gray-500">
                  {translator.translateText("Provider")}
                </dt>
                <dd className="font-medium text-gray-800">
                  {step.call.provider}
                </dd>
              </div>
            ) : (
              <></>
            )}
            <div className="flex gap-1.5">
              <dt className="text-gray-500">
                {translator.translateText("Tokens in / out")}
              </dt>
              <dd className="font-medium text-gray-800">
                {`${step.call.inputTokens.toLocaleString()} / ${step.call.outputTokens.toLocaleString()}`}
              </dd>
            </div>
            {step.call.finishReasons.length > 0 ? (
              <div className="flex gap-1.5">
                <dt className="text-gray-500">
                  {translator.translateText("Stopped because")}
                </dt>
                <dd className="font-mono font-medium text-gray-800">
                  {step.call.finishReasons.join(", ")}
                </dd>
              </div>
            ) : (
              <></>
            )}
            {step.call.agentName ? (
              <div className="flex gap-1.5">
                <dt className="text-gray-500">
                  {translator.translateText("Agent")}
                </dt>
                <dd className="font-medium text-gray-800">
                  {step.call.agentName}
                </dd>
              </div>
            ) : (
              <></>
            )}
          </dl>
          {issues.length > 0 ? (
            <ul className="space-y-1" data-testid="llm-step-issue-explanations">
              {issues.map((issue: LlmAnswerIssue) => {
                return (
                  <li key={issue} className="flex items-start gap-1.5">
                    <Icon
                      icon={IconProp.Info}
                      className="mt-0.5 h-3 w-3 flex-shrink-0 text-gray-400"
                    />
                    <div>
                      {translator.translateText(
                        LlmAnswerIssueUtil.getInfo(issue).description,
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <></>
          )}
          {step.call.evaluations.length > 0 ? (
            <div data-testid="llm-step-evaluations">
              <div className="font-medium text-gray-700">
                {translator.translateText("Evaluations")}
              </div>
              <ul className="mt-1 space-y-1">
                {step.call.evaluations.map(
                  (evaluation: LlmEvaluationResult, index: number) => {
                    const failing: boolean =
                      LlmAnswerIssueUtil.isFailingEvaluation(evaluation);

                    return (
                      <li key={index} className="flex flex-wrap gap-x-1.5">
                        <span className="font-medium text-gray-800">
                          {evaluation.name ||
                            translator.translateText("Evaluation")}
                        </span>
                        <span
                          className={
                            failing ? "text-violet-700" : "text-gray-600"
                          }
                        >
                          {evaluation.label ||
                            (evaluation.score !== null
                              ? String(evaluation.score)
                              : "")}
                        </span>
                        {evaluation.explanation ? (
                          <span className="text-gray-500">
                            {`— ${evaluation.explanation}`}
                          </span>
                        ) : (
                          <></>
                        )}
                      </li>
                    );
                  },
                )}
              </ul>
            </div>
          ) : (
            <></>
          )}
          <div>
            <AppLink
              to={props.traceRoute}
              className="font-medium text-indigo-600 hover:text-indigo-700"
            >
              {translator.translateText("Open this call in Traces")}
            </AppLink>
          </div>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

const Avatar: FunctionComponent<{
  icon: IconProp;
  tileClassName: string;
  iconClassName: string;
}> = (props: {
  icon: IconProp;
  tileClassName: string;
  iconClassName: string;
}): ReactElement => {
  return (
    <div
      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${props.tileClassName}`}
      aria-hidden="true"
    >
      <Icon icon={props.icon} className={`h-4 w-4 ${props.iconClassName}`} />
    </div>
  );
};

const CURRENT_RING: string = "ring-2 ring-indigo-400";

const LlmTranscriptStepView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const step: LlmTranscriptStep = props.step;
  const traceRoute: Route = useMemo(() => {
    return props.traceRoute(step);
  }, [step]);

  const select: () => void = (): void => {
    props.onSelect();
  };

  const currentRing: string = props.isCurrent ? CURRENT_RING : "";

  switch (step.type) {
    case LlmTranscriptStepType.UserMessage:
      return (
        <div
          className="flex justify-end"
          data-testid="llm-step"
          data-step-type={step.type}
          data-step-id={step.id}
        >
          <div className="flex max-w-[92%] flex-col items-end sm:max-w-[80%]">
            <div className="mb-1 flex items-center gap-2 text-xs text-gray-500">
              <span className="font-medium text-gray-700">
                {props.personLabel || translator.translateText("User")}
              </span>
              <StepTime atMs={step.atMs} />
            </div>
            <div
              role="button"
              tabIndex={0}
              onClick={select}
              onKeyDown={(event: React.KeyboardEvent) => {
                if (event.key === "Enter") {
                  select();
                }
              }}
              className={`cursor-pointer rounded-2xl rounded-tr-sm bg-indigo-50 px-4 py-2.5 text-left ring-1 ring-inset ring-indigo-100 ${currentRing}`}
            >
              {step.text ? (
                <FoldableText
                  text={step.text}
                  markdown={false}
                  dataTestId="llm-step-text"
                />
              ) : (
                <></>
              )}
              <MediaList media={step.media} />
            </div>
          </div>
        </div>
      );

    case LlmTranscriptStepType.AssistantMessage:
      return (
        <div
          className="flex items-start gap-3"
          data-testid="llm-step"
          data-step-type={step.type}
          data-step-id={step.id}
        >
          <Avatar
            icon={IconProp.Sparkles}
            tileClassName="bg-violet-100"
            iconClassName="text-violet-600"
          />
          <div className="min-w-0 max-w-[92%] flex-1 sm:max-w-[85%]">
            <div className="mb-1 flex items-center gap-2 text-xs text-gray-500">
              <span className="font-medium text-gray-700">
                {translator.translateText("AI")}
              </span>
              {step.fromHistory ? (
                <span
                  className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600"
                  data-testid="llm-step-from-history"
                >
                  {translator.translateText("Earlier answer, from the app")}
                </span>
              ) : (
                <StepTime atMs={step.atMs} />
              )}
            </div>
            <div
              role="button"
              tabIndex={0}
              onClick={select}
              onKeyDown={(event: React.KeyboardEvent) => {
                if (event.key === "Enter") {
                  select();
                }
              }}
              className={`cursor-pointer rounded-2xl rounded-tl-sm bg-white px-4 py-3 text-left shadow-sm ring-1 ring-inset ring-gray-200 ${currentRing}`}
            >
              {step.reasoning ? (
                <details
                  className="mb-2 text-xs text-gray-500"
                  data-testid="llm-step-reasoning"
                  onClick={(event: React.MouseEvent) => {
                    event.stopPropagation();
                  }}
                >
                  <summary className="cursor-pointer select-none font-medium text-gray-600">
                    {translator.translateText("Thinking")}
                  </summary>
                  <div className="mt-1 whitespace-pre-wrap border-l-2 border-gray-200 pl-3 italic">
                    {truncateLlmText(step.reasoning, 20_000)}
                  </div>
                </details>
              ) : (
                <></>
              )}
              {step.text ? (
                <FoldableText
                  text={step.text}
                  markdown={true}
                  dataTestId="llm-step-text"
                />
              ) : (
                <div
                  className="text-sm italic text-gray-500"
                  data-testid="llm-step-empty-answer"
                >
                  {translator.translateText(
                    "The AI returned an empty answer.",
                  )}
                </div>
              )}
              <MediaList media={step.media} />
              {step.fromHistory ? (
                <></>
              ) : (
                <AnswerMeta step={step} traceRoute={traceRoute} />
              )}
            </div>
          </div>
        </div>
      );

    case LlmTranscriptStepType.ToolCall:
      return (
        <ToolCard
          step={step}
          isCurrent={props.isCurrent}
          onSelect={select}
          traceRoute={traceRoute}
        />
      );

    case LlmTranscriptStepType.ToolResult:
      return (
        <ToolCard
          step={step}
          isCurrent={props.isCurrent}
          onSelect={select}
          traceRoute={traceRoute}
        />
      );

    case LlmTranscriptStepType.Failure:
      return (
        <div
          className="flex items-start gap-3"
          data-testid="llm-step"
          data-step-type={step.type}
          data-step-id={step.id}
        >
          <Avatar
            icon={IconProp.Error}
            tileClassName="bg-red-50"
            iconClassName="text-red-600"
          />
          <div
            role="button"
            tabIndex={0}
            onClick={select}
            onKeyDown={(event: React.KeyboardEvent) => {
              if (event.key === "Enter") {
                select();
              }
            }}
            className={`min-w-0 max-w-[92%] flex-1 cursor-pointer rounded-2xl rounded-tl-sm bg-red-50 px-4 py-3 text-left ring-1 ring-inset ring-red-200 sm:max-w-[85%] ${currentRing}`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-red-700">
                {step.call.kind === LlmCallKind.Tool
                  ? translator.translateTemplate("The tool {{tool}} failed", {
                      tool: step.toolName || step.call.name,
                    })
                  : translator.translateText("The AI call failed")}
              </div>
              <StepTime atMs={step.atMs} />
            </div>
            {step.text ? (
              <div
                className="mt-1 break-words font-mono text-xs text-red-700"
                data-testid="llm-step-error"
              >
                {truncateLlmText(step.text, 2000)}
              </div>
            ) : (
              <div className="mt-1 text-xs text-red-700">
                {translator.translateText("No error message was reported.")}
              </div>
            )}
            <AnswerMeta step={step} traceRoute={traceRoute} />
          </div>
        </div>
      );

    case LlmTranscriptStepType.SilentAnswer:
      return (
        <div
          className="flex items-start gap-3"
          data-testid="llm-step"
          data-step-type={step.type}
          data-step-id={step.id}
        >
          <Avatar
            icon={IconProp.Sparkles}
            tileClassName="bg-gray-100"
            iconClassName="text-gray-500"
          />
          <div
            role="button"
            tabIndex={0}
            onClick={select}
            onKeyDown={(event: React.KeyboardEvent) => {
              if (event.key === "Enter") {
                select();
              }
            }}
            className={`min-w-0 max-w-[92%] flex-1 cursor-pointer rounded-2xl rounded-tl-sm border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-left sm:max-w-[85%] ${currentRing}`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm text-gray-600">
                {translator.translateText(
                  "The AI answered. What it said was not recorded.",
                )}
              </div>
              <StepTime atMs={step.atMs} />
            </div>
            <AppLink
              to={props.setupRoute}
              className="mt-1 inline-block text-xs font-medium text-indigo-600 hover:text-indigo-700"
            >
              {translator.translateText("How to record prompts and answers")}
            </AppLink>
            <AnswerMeta step={step} traceRoute={traceRoute} />
          </div>
        </div>
      );

    case LlmTranscriptStepType.Activity:
      return (
        <div
          className="flex items-center justify-center"
          data-testid="llm-step"
          data-step-type={step.type}
          data-step-id={step.id}
        >
          <button
            type="button"
            onClick={select}
            className={`inline-flex max-w-full items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600 hover:bg-gray-200 ${currentRing}`}
          >
            <Icon
              icon={
                step.call.kind === LlmCallKind.Retrieval
                  ? IconProp.Search
                  : IconProp.CPUChip
              }
              className="h-3.5 w-3.5 flex-shrink-0 text-gray-500"
            />
            <span className="truncate">
              {translator.translateText(LLM_ACTIVITY_LABELS[step.call.kind])}
              {step.call.model ? ` · ${step.call.model}` : ""}
              {` · ${formatLlmDuration(step.call.durationMs)}`}
            </span>
          </button>
        </div>
      );

    case LlmTranscriptStepType.Instructions:
      return (
        <div
          className="flex items-center gap-3"
          data-testid="llm-step"
          data-step-type={step.type}
          data-step-id={step.id}
        >
          <div className="h-px flex-1 bg-gray-200" />
          <details
            className="max-w-[80%] text-xs text-gray-500"
            onClick={select}
          >
            <summary className="cursor-pointer select-none text-center font-medium text-gray-600">
              {translator.translateText("The AI's instructions changed")}
            </summary>
            <div className="mt-2 whitespace-pre-wrap rounded-md bg-gray-50 px-3 py-2 text-gray-700 ring-1 ring-inset ring-gray-200">
              {truncateLlmText(step.text, 20_000)}
            </div>
          </details>
          <div className="h-px flex-1 bg-gray-200" />
        </div>
      );

    default:
      return <></>;
  }
};

/*
 * A tool the AI asked for, or what the tool returned: an indented card so
 * the eye can skip it while reading the conversation, with the arguments
 * or the result on one line and the full JSON a click away.
 */
const ToolCard: FunctionComponent<{
  step: LlmTranscriptStep;
  isCurrent: boolean;
  onSelect: () => void;
  traceRoute: Route;
}> = (props: {
  step: LlmTranscriptStep;
  isCurrent: boolean;
  onSelect: () => void;
  traceRoute: Route;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const step: LlmTranscriptStep = props.step;
  const isCall: boolean = step.type === LlmTranscriptStepType.ToolCall;
  const value: string = isCall ? step.toolArguments : step.text;
  const oneLine: string = isCall
    ? compactLlmArguments(value)
    : truncateLlmText(collapseLlmWhitespace(value, 2000), 400);
  const toolName: string =
    step.toolName || translator.translateText("a tool") || "";

  return (
    <div
      className="flex items-start gap-3 pl-11"
      data-testid="llm-step"
      data-step-type={step.type}
      data-step-id={step.id}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={props.onSelect}
        onKeyDown={(event: React.KeyboardEvent) => {
          if (event.key === "Enter") {
            props.onSelect();
          }
        }}
        className={`min-w-0 max-w-full flex-1 cursor-pointer rounded-lg bg-white px-3 py-2 text-left ring-1 ring-inset ring-gray-200 sm:max-w-[85%] ${
          props.isCurrent ? CURRENT_RING : ""
        }`}
      >
        <div className="flex items-center gap-2">
          <div
            className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md ${
              isCall ? "bg-cyan-50" : "bg-teal-50"
            }`}
            aria-hidden="true"
          >
            <Icon
              icon={isCall ? IconProp.Wrench : IconProp.ArrowUturnLeft}
              className={`h-3.5 w-3.5 ${isCall ? "text-cyan-600" : "text-teal-600"}`}
            />
          </div>
          <div className="min-w-0 flex-1 text-xs text-gray-600">
            <span data-testid="llm-tool-heading">
              {isCall
                ? translator.translateTemplate("Called {{tool}}", {
                    tool: toolName,
                  })
                : translator.translateTemplate("{{tool}} returned", {
                    tool: toolName,
                  })}
            </span>
          </div>
          {value ? (
            <button
              type="button"
              className="flex-shrink-0 text-xs font-medium text-gray-500 hover:text-gray-900"
              aria-expanded={isOpen}
              data-testid="llm-tool-toggle"
              onClick={(event: React.MouseEvent) => {
                event.stopPropagation();
                setIsOpen(!isOpen);
              }}
            >
              {isOpen
                ? translator.translateText("Hide")
                : translator.translateText("Show")}
            </button>
          ) : (
            <></>
          )}
        </div>
        {value && !isOpen ? (
          <div
            className="mt-1 truncate font-mono text-xs text-gray-500"
            data-testid="llm-tool-one-line"
          >
            {oneLine}
          </div>
        ) : (
          <></>
        )}
        {value && isOpen ? (
          <CodeBlock value={prettyLlmJson(value)} dataTestId="llm-tool-value" />
        ) : (
          <></>
        )}
        {!value && !isCall ? (
          <div className="mt-1 text-xs italic text-gray-500">
            {translator.translateText("The result was not recorded.")}
          </div>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default LlmTranscriptStepView;
