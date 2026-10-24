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

// The strip's links: quiet, and plain to see under the keyboard.
const LINK_CLASS_NAME: string =
  "rounded-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

/*
 * "Fix performance with AI", only on a trace worth fixing, saying what it
 * found: the slow pattern in plain words, what it costs, and the one next
 * step - the fix, a quiet link to connect a repository, or a link to the
 * fix already on its way. A trace with nothing worth fixing shows nothing
 * at all (the header does not draw this component).
 *
 * The clock marks a finding about time; the bolt stays the AI fix's own.
 * The next step sits under the words, lined up with them, and beside them
 * from lg up - where the words keep room enough for a sentence a line, in
 * every language. On a phone the button spans the strip, as the header's
 * own buttons do: beside the clock its label would break in two.
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

  // The next step is the fix button (not a link or a line of status).
  const isFixButton: boolean =
    !isWorking && suggestion.offer !== SuggestionOffer.SetUp;

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
      /*
       * A live dot, as Code draws a task that is working, then where to
       * follow it - in one piece where there is room, free to wrap on a
       * phone, whose longest translations would run out of the strip. A
       * status, so a screen reader says it when it takes the pressed
       * button's place.
       */
      return (
        <div
          className="flex items-start gap-2 text-sm text-gray-700"
          role="status"
          data-testid="trace-fix-performance-progress"
        >
          <span
            className="relative mt-1.5 flex h-2 w-2 flex-none"
            aria-hidden="true"
          >
            <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75 motion-safe:animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500" />
          </span>
          <p>
            {translator.translateText(AI_IS_WORKING_ON_A_FIX)}{" "}
            <Link
              className={`sm:whitespace-nowrap ${LINK_CLASS_NAME}`}
              to={props.taskRoute}
            >
              {translator.translateText(VIEW_TASK_PROGRESS)}
            </Link>
          </p>
        </div>
      );
    }

    if (suggestion.offer === SuggestionOffer.SetUp) {
      return (
        <Link
          className={`inline-flex items-start gap-1.5 text-sm ${LINK_CLASS_NAME}`}
          to={props.connectRepositoryRoute}
          dataTestId="trace-fix-performance-connect"
        >
          <Icon icon={IconProp.Code} className="mt-0.5 h-4 w-4 flex-none" />
          <span>{translator.translateText(CONNECT_REPOSITORY_TO_FIX)}</span>
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
      className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6"
      data-testid="trace-performance-suggestion"
      data-offer={suggestion.offer}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Icon
          icon={IconProp.Clock}
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
              className="mt-1 line-clamp-2 font-mono text-xs text-gray-600 [overflow-wrap:anywhere]"
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
                  className={LINK_CLASS_NAME}
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
      {/*
       * Lined up with the words (the clock and its gap are 2rem), except a
       * phone's full-width button.
       */}
      <div
        className={`flex-none lg:max-w-sm lg:pl-0 ${isFixButton ? "sm:pl-8" : "pl-8"}`}
        data-testid="trace-performance-action"
      >
        {getAction()}
      </div>
    </div>
  );
};

export default TracePerformanceSuggestion;
