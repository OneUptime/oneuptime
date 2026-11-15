import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorEvaluationDetails, {
  MonitorEvaluationExcerpt,
  MonitorEvaluationFieldValue,
  MonitorEvaluationFilterDetails,
} from "Common/Types/Monitor/MonitorEvaluationDetails";
import Icon from "Common/UI/Components/Icon/Icon";
import { getProbeFailureCauseText } from "Common/Utils/Monitor/ProbeFailureReading";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useId,
  useState,
} from "react";
import {
  EVALUATION_DETAILS_HEADING,
  EVALUATION_FACT_LABELS,
  FIELD_VALUE_NOT_FOUND,
  FILTER_FACT_LABELS,
  FILTER_MATCHED,
  FILTER_NOT_MATCHED,
  HIDE_EVALUATION_DETAILS,
  MORE_FILTERS_THAN_SHOWN,
  DETAILS_WERE_TRIMMED,
  SHOW_EVALUATION_DETAILS,
  STEP_OF_STEPS,
  WINDOW_SENTENCE,
  getContentNotKeptNote,
  getCriteriaSentence,
  getExcerptOmissionNote,
  getFilterValueText,
  getRequestText,
  getSecretsMaskedNote,
  getShownActual,
  getShownFilters,
  hasDetailsToShow,
  isFilterSentenceShown,
  isFilterValueOnItsOwnLine,
  showsResponseContent,
} from "./EventEvaluationDetailsCopy";
import { wordEvaluationText } from "../../Utils/EvaluationText";
import { formatMilliseconds } from "../../Utils/Milliseconds";

/*
 * EVALUATION DETAILS: WHY THE MONITOR OPENED THIS INCIDENT OR ALERT.
 *
 * The last section of the What happened card, under the root cause. Folded,
 * it says why: the criteria that matched, and each filter that matched with
 * what the check found and where - the JSON path or the header, the value,
 * the window it was judged over - and how the check failed, when it did.
 * That is what the page keeps of the monitor's reason once somebody writes
 * the real root cause over the one the monitor wrote. Show details, beside
 * the heading, adds the evidence that takes room - a JavaScript
 * expression's values, a few lines of the response around the match, the
 * filters that did not match - and the check itself: the request, when it
 * ran, from which probe and what came back. A check with nothing more to
 * say than when it ran has no Show details.
 *
 * Everything shown was redacted and bounded on the server before it was
 * stored. Nothing inside is a box, as nothing in the card is: rows divided
 * by hairlines, facts as label and value, and code set as code.
 */

export interface ComponentProps {
  details: MonitorEvaluationDetails;
}

// A fact: a label and its value.
interface Fact {
  key: string;
  label: string;
  value: ReactNode;
  // A long value: a line of its own when facts sit two to a line.
  isWide?: boolean | undefined;
}

const LABEL_CLASS_NAME: string = "text-xs font-medium text-gray-500";

/*
 * Where there is room, a fact's label is a column of its own. A filter's
 * facts start after its mark (16px and a 12px gap), so the check's facts,
 * which start at the section's edge, take a label column that much wider:
 * every value of the section starts on one line.
 */
const FILTER_FACT_LABEL_WIDTH_CLASS_NAME: string =
  "[@container(min-width:30rem)]:w-28";

const CHECK_FACT_LABEL_WIDTH_CLASS_NAME: string =
  "[@container(min-width:30rem)]:w-[8.75rem]";

/*
 * A monospace block's own children keep its font: every frontend gives
 * every element Inter (index.ejs), which a <mark> inside would otherwise
 * take.
 */
const CODE_CLASS_NAME: string =
  "font-mono [&_*]:[font-family:inherit] [overflow-wrap:anywhere]";

// Code on its own lines: an excerpt, a list of values, an expression.
const CODE_BLOCK_CLASS_NAME: string = `rounded-md bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-800 ${CODE_CLASS_NAME}`;

const EventEvaluationDetails: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const headingId: string = useId();
  const contentId: string = useId();
  const [isOpen, setIsOpen] = useState<boolean>(false);

  const details: MonitorEvaluationDetails = props.details;

  const criteriaSentence: { template: string; hasName: boolean } =
    getCriteriaSentence(details);

  const hasToggle: boolean = hasDetailsToShow(details);
  const isShowingDetails: boolean = hasToggle && isOpen;

  const filters: Array<MonitorEvaluationFilterDetails> = getShownFilters(
    details.filters,
    isShowingDetails,
  );

  return (
    <section
      aria-labelledby={headingId}
      data-testid="what-happened-evaluation"
      className="mt-4 border-t border-gray-100 pt-4 [container-type:inline-size]"
    >
      {/*
       * The toggle beside the heading, where it stays while the section
       * grows under it - as the AI card's View full report sits beside its
       * own label.
       */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <h3 id={headingId} className="text-sm font-semibold text-gray-900">
          {translator.translateText(EVALUATION_DETAILS_HEADING)}
        </h3>
        {hasToggle ? (
          <button
            type="button"
            onClick={() => {
              setIsOpen(!isOpen);
            }}
            aria-expanded={isOpen}
            aria-controls={contentId}
            data-testid="evaluation-details-toggle"
            className="-my-1 -mr-1.5 ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-50 hover:text-indigo-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            {isOpen
              ? translator.translateText(HIDE_EVALUATION_DETAILS)
              : translator.translateText(SHOW_EVALUATION_DETAILS)}
            <Icon
              icon={IconProp.ChevronDown}
              className={`h-3.5 w-3.5 motion-safe:transition-transform ${
                isOpen ? "rotate-180" : ""
              }`}
            />
          </button>
        ) : (
          <></>
        )}
      </div>

      <div id={contentId} data-testid="evaluation-details-content">
        <p
          data-testid="evaluation-criteria"
          className="mt-1 break-words text-sm text-gray-700"
        >
          {criteriaSentence.hasName ? (
            <TranslatedSentence
              template={criteriaSentence.template}
              slots={{
                criteria: (
                  <span className="font-medium text-gray-900">
                    “{details.criteriaName}”
                  </span>
                ),
              }}
            />
          ) : (
            translator.translateText(criteriaSentence.template)
          )}
        </p>

        <ul
          data-testid="evaluation-filters"
          className="mt-1 divide-y divide-gray-100"
        >
          {filters.map(
            (filter: MonitorEvaluationFilterDetails, index: number) => {
              return (
                <FilterRow
                  key={`${filter.checkOn}-${filter.met ? "met" : "not-met"}-${index}`}
                  filter={filter}
                  isOpen={isShowingDetails}
                />
              );
            },
          )}
        </ul>

        <CheckFacts details={details} isOpen={isShowingDetails} />
      </div>
    </section>
  );
};

/*
 * The check that opened the record. How it failed, when it did, is part of
 * why and shows folded, first; the rest - the request, when it ran, from
 * which probe, what came back, and what was masked or left out - shows
 * with the details, after it, so nothing moves when they open.
 */
const CheckFacts: FunctionComponent<{
  details: MonitorEvaluationDetails;
  isOpen: boolean;
}> = (props: {
  details: MonitorEvaluationDetails;
  isOpen: boolean;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const details: MonitorEvaluationDetails = props.details;
  const facts: Array<Fact> = [];

  /*
   * Why the check failed: the probe's own timeout sentence in the reader's
   * language (ProbeFailureReading), any other cause as written, in the
   * direction of its own words.
   */
  if (details.response?.failureCause) {
    facts.push({
      key: "failure",
      label: translator.translateText(EVALUATION_FACT_LABELS.failure) || "",
      value: (
        <span dir="auto">
          {getProbeFailureCauseText({
            translator: translator,
            failureCause: details.response.failureCause,
          })}
        </span>
      ),
      isWide: true,
    });
  }

  if (!props.isOpen) {
    return facts.length > 0 ? (
      <CheckFactsFrame facts={facts} notes={[]} />
    ) : (
      <></>
    );
  }

  const requestText: string | undefined = getRequestText(details.request);

  if (requestText) {
    facts.push({
      key: "request",
      label: translator.translateText(EVALUATION_FACT_LABELS.request) || "",
      value: (
        <code
          dir="ltr"
          data-testid="evaluation-request"
          className={`${CODE_CLASS_NAME} text-xs text-gray-800`}
        >
          {requestText}
        </code>
      ),
      isWide: true,
    });
  }

  if (details.stepNumber && details.stepCount && details.stepCount > 1) {
    facts.push({
      key: "step",
      label: translator.translateText(EVALUATION_FACT_LABELS.step) || "",
      value: translator.translateTemplate(STEP_OF_STEPS, {
        step: details.stepNumber,
        count: details.stepCount,
      }),
    });
  }

  facts.push({
    key: "checked",
    label: translator.translateText(EVALUATION_FACT_LABELS.checked) || "",
    value: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
      details.evaluatedAt,
    ),
  });

  if (details.probeName) {
    facts.push({
      key: "probe",
      label: translator.translateText(EVALUATION_FACT_LABELS.probe) || "",
      value: <span dir="auto">{details.probeName}</span>,
    });
  }

  if (typeof details.response?.statusCode === "number") {
    facts.push({
      key: "status-code",
      label: translator.translateText(EVALUATION_FACT_LABELS.statusCode) || "",
      value: String(details.response.statusCode),
    });
  }

  if (typeof details.response?.responseTimeInMs === "number") {
    facts.push({
      key: "response-time",
      label:
        translator.translateText(EVALUATION_FACT_LABELS.responseTime) || "",
      value: formatMilliseconds(translator, details.response.responseTimeInMs),
    });
  }

  const notes: Array<{ key: string; text: string }> = [];

  if (details.areResponseExcerptsOff) {
    notes.push({
      key: "not-kept",
      text:
        translator.translateText(getContentNotKeptNote(details.monitorType)) ||
        "",
    });
  } else if (showsResponseContent(details)) {
    notes.push({
      key: "masked",
      text:
        translator.translateText(getSecretsMaskedNote(details.monitorType)) ||
        "",
    });
  }

  if (details.areFiltersTruncated) {
    notes.push({
      key: "more-filters",
      text: translator.translateText(MORE_FILTERS_THAN_SHOWN) || "",
    });
  }

  if (details.isTrimmedToSizeLimit) {
    notes.push({
      key: "trimmed",
      text: translator.translateText(DETAILS_WERE_TRIMMED) || "",
    });
  }

  return <CheckFactsFrame facts={facts} notes={notes} />;
};

const CheckFactsFrame: FunctionComponent<{
  facts: Array<Fact>;
  notes: Array<{ key: string; text: string }>;
}> = (props: {
  facts: Array<Fact>;
  notes: Array<{ key: string; text: string }>;
}): ReactElement => {
  const notes: Array<{ key: string; text: string }> = props.notes;

  return (
    <div
      data-testid="evaluation-check"
      className="mt-1 border-t border-gray-100 pt-3"
    >
      <FactRows
        facts={props.facts}
        dataTestId="evaluation-facts"
        factTestIdPrefix="evaluation-facts"
        labelWidthClassName={CHECK_FACT_LABEL_WIDTH_CLASS_NAME}
        isTwoColumnsWhenNarrow={true}
      />

      {notes.length > 0 ? (
        <div data-testid="evaluation-notes" className="mt-3 space-y-1">
          {notes.map((note: { key: string; text: string }) => {
            return (
              <p
                key={note.key}
                data-testid={`evaluation-note-${note.key}`}
                className="text-xs text-gray-500"
              >
                {note.text}
              </p>
            );
          })}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

/*
 * Facts as label and value: the label beside its value where the section
 * has room, over it on a narrow card - where short facts can sit two to a
 * line (isTwoColumnsWhenNarrow), a long one on a line of its own.
 */
const FactRows: FunctionComponent<{
  facts: Array<Fact>;
  dataTestId: string;
  // Each fact's data-testid is this, a dash and its key.
  factTestIdPrefix: string;
  // The label column's width, where labels sit beside their values.
  labelWidthClassName: string;
  isTwoColumnsWhenNarrow?: boolean | undefined;
}> = (props: {
  facts: Array<Fact>;
  dataTestId: string;
  factTestIdPrefix: string;
  labelWidthClassName: string;
  isTwoColumnsWhenNarrow?: boolean | undefined;
}): ReactElement => {
  return (
    <dl
      data-testid={props.dataTestId}
      className={
        props.isTwoColumnsWhenNarrow
          ? "grid grid-cols-2 gap-x-6 gap-y-3 [@container(min-width:30rem)]:grid-cols-1 [@container(min-width:30rem)]:gap-y-2"
          : "grid grid-cols-1 gap-y-2"
      }
    >
      {props.facts.map((fact: Fact) => {
        return (
          <div
            key={fact.key}
            data-testid={`${props.factTestIdPrefix}-${fact.key}`}
            className={`flex min-w-0 flex-col gap-0.5 [@container(min-width:30rem)]:flex-row [@container(min-width:30rem)]:items-baseline [@container(min-width:30rem)]:gap-4 ${
              props.isTwoColumnsWhenNarrow && fact.isWide
                ? "col-span-2 [@container(min-width:30rem)]:col-span-1"
                : ""
            }`}
          >
            <dt
              className={`${LABEL_CLASS_NAME} shrink-0 ${props.labelWidthClassName}`}
            >
              {fact.label}
            </dt>
            <dd className="min-w-0 flex-1 break-words text-sm text-gray-900">
              {fact.value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
};

// One filter of the criteria: what it checked, and what it found.
const FilterRow: FunctionComponent<{
  filter: MonitorEvaluationFilterDetails;
  isOpen: boolean;
}> = (props: {
  filter: MonitorEvaluationFilterDetails;
  isOpen: boolean;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const filter: MonitorEvaluationFilterDetails = props.filter;
  const valueText: string | undefined = getFilterValueText(filter);
  const isValueOnItsOwnLine: boolean = isFilterValueOnItsOwnLine(filter);
  const actual: string | undefined = getShownActual(filter);

  const facts: Array<Fact> = [];

  if (filter.field) {
    facts.push({
      key: "field",
      label: translator.translateText(FILTER_FACT_LABELS.field) || "",
      value: (
        <code dir="ltr" className={`${CODE_CLASS_NAME} text-xs text-gray-800`}>
          {filter.field}
        </code>
      ),
    });
  }

  if (actual) {
    facts.push({
      key: "actual",
      label:
        translator.translateText(
          filter.windowMinutes
            ? FILTER_FACT_LABELS.latestCheck
            : FILTER_FACT_LABELS.actual,
        ) || "",
      value: (
        <span dir="auto" className="break-words">
          {getActualText(filter, actual, translator)}
        </span>
      ),
    });
  }

  if (filter.windowMinutes) {
    facts.push({
      key: "window",
      label: translator.translateText(FILTER_FACT_LABELS.window) || "",
      value: (
        <span dir="auto">
          {translator.translatePlural(WINDOW_SENTENCE, filter.windowMinutes, {
            type: filter.windowType
              ? translator.translateTerm(filter.windowType)
              : "",
          })}
        </span>
      ),
    });
  }

  const omissionNote: string | undefined = props.isOpen
    ? getExcerptOmissionNote(filter.excerptOmission)
    : undefined;

  return (
    <li
      data-testid="evaluation-filter"
      data-matched={filter.met ? "true" : "false"}
      className="flex gap-3 py-3"
    >
      <div aria-hidden="true" className="mt-0.5 shrink-0">
        <Icon
          icon={filter.met ? IconProp.CheckCircle : IconProp.MinusCircle}
          className={`h-4 w-4 ${filter.met ? "text-green-600" : "text-gray-400"}`}
        />
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <p
          data-testid="evaluation-filter-title"
          className="break-words text-sm text-gray-900"
        >
          <span className="sr-only">
            {translator.translateText(
              filter.met ? FILTER_MATCHED : FILTER_NOT_MATCHED,
            )}
            {": "}
          </span>
          <span className="font-medium">
            {translator.translateTerm(filter.checkOn)}
          </span>
          {filter.filterType ? (
            <span className="text-gray-600">
              {" "}
              {translator.translateTerm(filter.filterType)}
            </span>
          ) : (
            <></>
          )}
          {valueText && !isValueOnItsOwnLine ? (
            <>
              {" "}
              <code
                dir="ltr"
                data-testid="evaluation-filter-value"
                className={`${CODE_CLASS_NAME} rounded bg-gray-50 px-1 py-0.5 text-xs text-gray-800`}
              >
                {valueText}
              </code>
            </>
          ) : (
            <></>
          )}
          {!filter.met ? (
            <span
              aria-hidden="true"
              data-testid="evaluation-filter-not-matched"
              className="ml-2 whitespace-nowrap text-xs font-medium text-gray-500"
            >
              {translator.translateText(FILTER_NOT_MATCHED)}
            </span>
          ) : (
            <></>
          )}
        </p>

        {valueText && isValueOnItsOwnLine ? (
          <code
            dir="ltr"
            data-testid="evaluation-filter-value"
            className={`block ${CODE_BLOCK_CLASS_NAME}`}
          >
            {valueText}
          </code>
        ) : (
          <></>
        )}

        {facts.length > 0 ? (
          <FactRows
            facts={facts}
            dataTestId="evaluation-filter-facts"
            factTestIdPrefix="evaluation-filter"
            labelWidthClassName={FILTER_FACT_LABEL_WIDTH_CLASS_NAME}
          />
        ) : (
          <></>
        )}

        {props.isOpen && filter.fieldValues && filter.fieldValues.length > 0 ? (
          <FieldValues filter={filter} />
        ) : (
          <></>
        )}

        {props.isOpen && filter.excerpt ? (
          <Excerpt excerpt={filter.excerpt} />
        ) : (
          <></>
        )}

        {omissionNote ? (
          <p
            data-testid="evaluation-filter-omission"
            className="text-xs text-gray-500"
          >
            {translator.translateText(omissionNote)}
          </p>
        ) : (
          <></>
        )}

        {/*
         * The filter's finding in the reader's language, from the sentence
         * the engine stored with it, as the root cause above and the
         * monitor's evaluation log word it; as stored when it has none.
         */}
        {isFilterSentenceShown(filter, props.isOpen) ? (
          <p
            dir="auto"
            data-testid="evaluation-filter-message"
            className="break-words text-xs text-gray-500"
          >
            {wordEvaluationText(
              translator,
              filter.message,
              filter.messageSentence,
            )}
          </p>
        ) : (
          <></>
        )}
      </div>
    </li>
  );
};

// What each value a JavaScript expression reads held when it ran.
const FieldValues: FunctionComponent<{
  filter: MonitorEvaluationFilterDetails;
}> = (props: { filter: MonitorEvaluationFilterDetails }): ReactElement => {
  const translator: Translator = useTranslator();
  const values: Array<MonitorEvaluationFieldValue> =
    props.filter.fieldValues || [];

  return (
    <div data-testid="evaluation-filter-values">
      <div className={LABEL_CLASS_NAME}>
        {translator.translateText(FILTER_FACT_LABELS.values)}
      </div>
      <ul dir="ltr" className={`mt-1 space-y-1 ${CODE_BLOCK_CLASS_NAME}`}>
        {values.map((value: MonitorEvaluationFieldValue, index: number) => {
          return (
            <li key={`${value.path}-${index}`}>
              <span className="text-gray-500">{value.path}</span>
              {" = "}
              {value.isMissing ? (
                <span className="italic text-gray-500">
                  {translator.translateText(FIELD_VALUE_NOT_FOUND)}
                </span>
              ) : (
                <span>
                  {value.value}
                  {value.isTruncated ? "…" : ""}
                </span>
              )}
            </li>
          );
        })}
        {props.filter.areFieldValuesTruncated ? <li>…</li> : <></>}
      </ul>
    </div>
  );
};

/*
 * A few lines of the response around the match, the match marked. A
 * response is written left to right, whatever the page's language.
 */
const Excerpt: FunctionComponent<{
  excerpt: MonitorEvaluationExcerpt;
}> = (props: { excerpt: MonitorEvaluationExcerpt }): ReactElement => {
  const translator: Translator = useTranslator();
  const excerpt: MonitorEvaluationExcerpt = props.excerpt;

  return (
    <div data-testid="evaluation-filter-excerpt">
      <div className={LABEL_CLASS_NAME}>
        {translator.translateText(FILTER_FACT_LABELS.excerpt)}
      </div>
      <pre
        dir="ltr"
        className={`mt-1 whitespace-pre-wrap ${CODE_BLOCK_CLASS_NAME}`}
      >
        {excerpt.isCutAtStart ? (
          <span className="text-gray-400">…</span>
        ) : (
          <></>
        )}
        {excerpt.before}
        {excerpt.match ? (
          <mark
            data-testid="evaluation-excerpt-match"
            className="rounded-sm bg-yellow-100 px-0.5 font-semibold text-gray-900"
          >
            {excerpt.match}
          </mark>
        ) : (
          <></>
        )}
        {excerpt.after}
        {excerpt.isCutAtEnd ? <span className="text-gray-400">…</span> : <></>}
      </pre>
    </div>
  );
};

/*
 * An actual value as the section writes it: a measurement's number the
 * reader's way with its unit, true and false as the criteria form names its
 * True and False conditions, anything else as it was found.
 */
const getActualText: (
  filter: MonitorEvaluationFilterDetails,
  actual: string,
  translator: Translator,
) => string = (
  filter: MonitorEvaluationFilterDetails,
  actual: string,
  translator: Translator,
): string => {
  if (typeof filter.actualNumber === "number") {
    const number: string = translator.formatNumber(filter.actualNumber);

    if (!filter.actualUnit) {
      return number;
    }

    return filter.actualUnit === "%"
      ? `${number}%`
      : `${number} ${filter.actualUnit}`;
  }

  if (actual === "true") {
    return translator.translateTerm("True");
  }

  if (actual === "false") {
    return translator.translateTerm("False");
  }

  return actual;
};

export default EventEvaluationDetails;
