import React, { FunctionComponent, ReactElement } from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import { LlmConversationSummary } from "Common/Types/Telemetry/LlmConversationApi";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  formatLlmCost,
  formatLlmCount,
  formatLlmDuration,
  formatLlmShare,
  formatLlmTokens,
} from "./LlmConversationFormat";

/*
 * The five numbers above the conversation list: how many conversations,
 * how many answers, how many need attention, what they cost and how long an
 * answer takes. "Need attention" is the one that leads when it is not zero -
 * clicking it narrows the list to those conversations.
 */

export interface ComponentProps {
  // null while loading, or when the summary could not be read.
  summary: LlmConversationSummary | null;
  isLoading: boolean;
  onShowProblems?: (() => void) | undefined;
}

interface TileProps {
  label: string;
  value: string;
  hint?: string | undefined;
  icon: IconProp;
  iconClassName: string;
  iconTileClassName: string;
  dataTestId: string;
  onClick?: (() => void) | undefined;
  isLoading: boolean;
}

const Tile: FunctionComponent<TileProps> = (props: TileProps): ReactElement => {
  const translator: Translator = useTranslator();

  const content: ReactElement = (
    <div className="flex items-start gap-3">
      <div
        className={`hidden h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg sm:flex ${props.iconTileClassName}`}
        aria-hidden="true"
      >
        <Icon icon={props.icon} className={`h-5 w-5 ${props.iconClassName}`} />
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-gray-500">
          {translator.translateText(props.label)}
        </div>
        {props.isLoading ? (
          <div className="mt-1.5 h-6 w-16 animate-pulse rounded bg-gray-100" />
        ) : (
          <div
            className="mt-0.5 truncate text-xl font-semibold text-gray-900"
            data-testid={`${props.dataTestId}-value`}
          >
            {props.value}
          </div>
        )}
        {props.hint && !props.isLoading ? (
          <div
            className="mt-0.5 truncate text-xs text-gray-500"
            data-testid={`${props.dataTestId}-hint`}
          >
            {props.hint}
          </div>
        ) : (
          <></>
        )}
      </div>
    </div>
  );

  const className: string =
    "rounded-lg bg-white p-4 text-left shadow ring-1 ring-gray-200/80";

  if (props.onClick) {
    return (
      <button
        type="button"
        className={`${className} transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`}
        data-testid={props.dataTestId}
        onClick={props.onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={className} data-testid={props.dataTestId}>
      {content}
    </div>
  );
};

const LlmSummaryTiles: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const summary: LlmConversationSummary | null = props.summary;
  const isLoading: boolean = props.isLoading && !summary;

  const problems: number = summary?.problemConversationCount || 0;
  const conversations: number = summary?.conversationCount || 0;

  return (
    <div
      className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5"
      data-testid="llm-summary-tiles"
    >
      <Tile
        label="Conversations"
        value={formatLlmCount(conversations)}
        icon={IconProp.ChatBubbleLeftRight}
        iconClassName="text-indigo-600"
        iconTileClassName="bg-indigo-50"
        dataTestId="llm-summary-conversations"
        isLoading={isLoading}
      />
      <Tile
        label="AI answers"
        value={formatLlmCount(summary?.answerCount || 0)}
        hint={
          summary && summary.callCount > summary.answerCount
            ? translator.translatePlural(
                {
                  one: "{{count}} AI call in all",
                  other: "{{count}} AI calls in all",
                },
                summary.callCount,
              )
            : undefined
        }
        icon={IconProp.Sparkles}
        iconClassName="text-violet-600"
        iconTileClassName="bg-violet-50"
        dataTestId="llm-summary-answers"
        isLoading={isLoading}
      />
      <Tile
        label="Need attention"
        value={formatLlmCount(problems)}
        hint={
          summary
            ? translator.translateTemplate("{{share}} of conversations", {
                share: formatLlmShare(problems, conversations),
              })
            : undefined
        }
        icon={problems > 0 ? IconProp.Alert : IconProp.CheckCircle}
        iconClassName={problems > 0 ? "text-amber-600" : "text-emerald-600"}
        iconTileClassName={problems > 0 ? "bg-amber-50" : "bg-emerald-50"}
        dataTestId="llm-summary-problems"
        onClick={problems > 0 ? props.onShowProblems : undefined}
        isLoading={isLoading}
      />
      <Tile
        label="Cost"
        value={formatLlmCost(summary?.costUsd || 0)}
        hint={
          summary
            ? translator.translateTemplate("{{tokens}} tokens", {
                tokens: formatLlmTokens(
                  (summary.inputTokens || 0) + (summary.outputTokens || 0),
                ),
              })
            : undefined
        }
        icon={IconProp.CurrencyDollar}
        iconClassName="text-emerald-600"
        iconTileClassName="bg-emerald-50"
        dataTestId="llm-summary-cost"
        isLoading={isLoading}
      />
      <Tile
        label="Typical answer time"
        value={
          summary && summary.medianAnswerMs !== null
            ? formatLlmDuration(summary.medianAnswerMs)
            : "—"
        }
        hint={
          summary && summary.p95AnswerMs !== null
            ? translator.translateTemplate("Slowest 5%: {{duration}}", {
                duration: formatLlmDuration(summary.p95AnswerMs),
              })
            : undefined
        }
        icon={IconProp.Clock}
        iconClassName="text-sky-600"
        iconTileClassName="bg-sky-50"
        dataTestId="llm-summary-latency"
        isLoading={isLoading}
      />
    </div>
  );
};

export default LlmSummaryTiles;
