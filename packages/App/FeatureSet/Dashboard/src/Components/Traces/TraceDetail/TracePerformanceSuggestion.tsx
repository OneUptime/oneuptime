import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import SuggestionOffer from "Common/Utils/Suggestions/SuggestionOffer";
import { TracePerformanceFixSuggestion } from "Common/Utils/Suggestions/TracePerformanceFixSuggestion";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import { formatDurationNano } from "../../../Utils/TraceDetailPresentation";
import {
  AI_IS_WORKING_ON_A_FIX,
  CONNECT_REPOSITORY_TO_FIX,
  COULD_NOT_START_THE_FIX,
  FIX_PERFORMANCE_BUTTON_TITLE,
  FIX_PERFORMANCE_BUTTON_TOOLTIP,
  PerformanceFindingWords,
  SHOW_IT,
  SHOW_THEM,
  VIEW_TASK_PROGRESS,
  getPerformanceFindingWords,
} from "./TracePerformanceSuggestionCopy";

export interface ComponentProps {
  /*
   * What the server offers for this trace (POST /ai-investigation/
   * performance-fix-suggestion). The header draws this component only when
   * the offer is not None.
   */
  suggestion: TracePerformanceFixSuggestion;
  /*
   * The fix run to link to: the one just created on this page, or the one
   * the server says is already on its way.
   */
  taskRoute: Route | null;
  // Where a repository is connected (Code).
  connectRepositoryRoute: Route;
  isCreating: boolean;
  // Why the last click did not start a fix, as the server said it.
  error: string | null;
  onFix: () => void;
  // Reveals the spans the finding is about; undefined when none is loaded.
  onShowSpans?: (() => void) | undefined;
}

const MS_TO_NANOSECONDS: number = 1_000_000;

/*
 * "Fix performance with AI", only on a trace worth fixing, saying what it
 * found: the slow pattern in plain words, what it costs, and the one next
 * step - the fix, a quiet link to connect a repository, or a link to the
 * fix already on its way. A trace with nothing worth fixing shows nothing
 * at all (the header does not draw this component).
 */
const TracePerformanceSuggestion: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const translator: Translator = useTranslator();
  const { suggestion } = props;

  if (!suggestion.finding || suggestion.offer === SuggestionOffer.None) {
    return null;
  }

  const words: PerformanceFindingWords = getPerformanceFindingWords(
    suggestion.finding,
  );

  const isWorking: boolean =
    Boolean(props.taskRoute) &&
    (suggestion.offer === SuggestionOffer.InProgress ||
      suggestion.offer === SuggestionOffer.Act);

  const name: (text: string) => ReactNode = (text: string): ReactNode => {
    return (
      <span className="font-semibold text-gray-900 [overflow-wrap:anywhere]">
        {text}
      </span>
    );
  };

  const slots: Record<string, ReactNode> = {};
  if (
    typeof words.headline === "string"
      ? words.headline.includes("{{operation}}")
      : words.headline.other.includes("{{operation}}")
  ) {
    slots["operation"] = name(words.operation);
  }
  if (
    typeof words.headline === "string"
      ? words.headline.includes("{{parent}}")
      : words.headline.other.includes("{{parent}}")
  ) {
    slots["parent"] = name(words.parent);
  }

  const detail: string = translator.translateTemplate(words.detail, {
    duration: formatDurationNano(
      suggestion.finding.combinedDurationMs * MS_TO_NANOSECONDS,
    ),
    total: formatDurationNano(
      suggestion.finding.traceDurationMs * MS_TO_NANOSECONDS,
    ),
  });

  const getAction: () => ReactElement = (): ReactElement => {
    if (isWorking && props.taskRoute) {
      return (
        <p
          className="text-sm text-gray-700"
          data-testid="trace-fix-performance-progress"
        >
          {translator.translateText(AI_IS_WORKING_ON_A_FIX)}{" "}
          <Link
            className="font-medium text-indigo-600 underline hover:text-indigo-700"
            to={props.taskRoute}
          >
            {translator.translateText(VIEW_TASK_PROGRESS)}
          </Link>
        </p>
      );
    }

    if (suggestion.offer === SuggestionOffer.SetUp) {
      return (
        <Link
          className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
          to={props.connectRepositoryRoute}
          dataTestId="trace-fix-performance-connect"
        >
          <Icon icon={IconProp.Code} className="h-4 w-4" />
          {translator.translateText(CONNECT_REPOSITORY_TO_FIX)}
        </Link>
      );
    }

    return (
      <Button
        title={FIX_PERFORMANCE_BUTTON_TITLE}
        icon={IconProp.Bolt}
        buttonStyle={ButtonStyleType.NORMAL}
        buttonSize={ButtonSize.Small}
        isLoading={props.isCreating}
        tooltip={FIX_PERFORMANCE_BUTTON_TOOLTIP}
        dataTestId="trace-fix-performance"
        className="md:!ml-0"
        onClick={props.onFix}
      />
    );
  };

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 md:flex-row md:items-center md:justify-between"
      data-testid="trace-performance-suggestion"
      data-offer={suggestion.offer}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Icon
          icon={IconProp.Bolt}
          className="mt-0.5 h-5 w-5 flex-none text-amber-600"
        />
        <div className="min-w-0 flex-1">
          <p
            className="text-sm font-medium text-gray-900 [overflow-wrap:anywhere]"
            data-testid="trace-performance-finding"
          >
            <TranslatedSentence
              template={words.headline}
              count={words.count}
              slots={slots}
            />
          </p>
          {words.query && (
            <code
              className="mt-1 block truncate font-mono text-xs text-gray-600"
              title={words.query}
              data-testid="trace-performance-query"
            >
              {words.query}
            </code>
          )}
          <p
            className="mt-1 text-sm text-gray-600"
            data-testid="trace-performance-detail"
          >
            {detail}
            {props.onShowSpans && (
              <>
                {" "}
                <button
                  type="button"
                  className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  data-testid="trace-performance-show-spans"
                  onClick={props.onShowSpans}
                >
                  {translator.translateText(
                    suggestion.finding.implicatedSpans.length > 1
                      ? SHOW_THEM
                      : SHOW_IT,
                  )}
                </button>
              </>
            )}
          </p>
          {props.error && (
            <p
              className="mt-1.5 text-sm text-red-700"
              role="alert"
              data-testid="trace-fix-performance-error"
            >
              {translator.translateTemplate(COULD_NOT_START_THE_FIX, {
                reason: props.error,
              })}
            </p>
          )}
        </div>
      </div>
      <div className="flex-none md:pl-4">{getAction()}</div>
    </div>
  );
};

export default TracePerformanceSuggestion;
