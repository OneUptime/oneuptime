import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorEvaluationDetails, {
  MonitorEvaluationExcerpt,
  MonitorEvaluationFieldValue,
  MonitorEvaluationFilterDetails,
  MonitorEvaluationRequest,
} from "Common/Types/Monitor/MonitorEvaluationDetails";
import Icon from "Common/UI/Components/Icon/Icon";
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
  RESPONSE_CONTENT_NOT_KEPT,
  SECRETS_ARE_MASKED,
  SHOW_EVALUATION_DETAILS,
  STEP_OF_STEPS,
  WINDOW_SENTENCE,
  getCriteriaSentence,
  getExcerptOmissionNote,
  getFilterValueText,
  orderFilters,
  showsResponseContent,
} from "./EventEvaluationDetailsCopy";

/*
 * EVALUATION DETAILS: WHY THE MONITOR OPENED THIS INCIDENT OR ALERT.
 *
 * The last section of the What happened card, under the root cause: the
 * check the monitor made - when, from which probe, what came back - and,
 * one click away, the criteria that matched and each of its filters with
 * what it found and where: the JSON path or header, a JavaScript
 * expression's values, a few lines of the response around the match.
 * Folded by default: the root cause above already says why in one
 * sentence, and this is the evidence behind it.
 *
 * Everything shown was redacted and bounded on the server before it was
 * stored. Nothing inside is a box, as nothing in the card is: sections under
 * hairlines, rows divided by hairlines, and the excerpt set as code.
 */

export interface ComponentProps {
  details: MonitorEvaluationDetails;
}

// The facts of a section or a filter, side by side when there is room.
interface Fact {
  key: string;
  label: string;
  value: ReactNode;
}

const FACT_LABEL_CLASS_NAME: string = "text-xs font-medium text-gray-500";

const FACT_VALUE_CLASS_NAME: string =
  "mt-0.5 min-w-0 break-words text-sm text-gray-900";

/*
 * A monospace block's own children keep its font: every frontend gives
 * every element Inter (index.ejs), which a <mark> inside would otherwise
 * take.
 */
const CODE_CLASS_NAME: string =
  "font-mono [&_*]:[font-family:inherit] [overflow-wrap:anywhere]";

const EventEvaluationDetails: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const headingId: string = useId();
  const contentId: string = useId();
  const [isOpen, setIsOpen] = useState<boolean>(false);

  const details: MonitorEvaluationDetails = props.details;

  // What the check was: on show while folded.
  const checkFacts: Array<Fact> = [];

  checkFacts.push({
    key: "checked",
    label: translator.translateText(EVALUATION_FACT_LABELS.checked) || "",
    value: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
      details.evaluatedAt,
    ),
  });

  if (details.probeName) {
    checkFacts.push({
      key: "probe",
      label: translator.translateText(EVALUATION_FACT_LABELS.probe) || "",
      value: details.probeName,
    });
  }

  if (typeof details.response?.statusCode === "number") {
    checkFacts.push({
      key: "status-code",
      label: translator.translateText(EVALUATION_FACT_LABELS.statusCode) || "",
      value: String(details.response.statusCode),
    });
  }

  if (typeof details.response?.responseTimeInMs === "number") {
    checkFacts.push({
      key: "response-time",
      label:
        translator.translateText(EVALUATION_FACT_LABELS.responseTime) || "",
      value: `${translator.formatNumber(details.response.responseTimeInMs)} ms`,
    });
  }

  // What the request was, and how it failed: with the details.
  const requestFacts: Array<Fact> = [];

  const requestText: string | undefined = getRequestText(details.request);

  if (requestText) {
    requestFacts.push({
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
    });
  }

  if (details.stepNumber && details.stepCount && details.stepCount > 1) {
    requestFacts.push({
      key: "step",
      label: translator.translateText(EVALUATION_FACT_LABELS.step) || "",
      value: translator.translateTemplate(STEP_OF_STEPS, {
        step: details.stepNumber,
        count: details.stepCount,
      }),
    });
  }

  if (details.response?.failureCause) {
    requestFacts.push({
      key: "failure",
      label: translator.translateText(EVALUATION_FACT_LABELS.failure) || "",
      value: <span dir="auto">{details.response.failureCause}</span>,
    });
  }

  const criteriaSentence: { template: string; hasName: boolean } =
    getCriteriaSentence(details);

  const notes: Array<{ key: string; text: string }> = [];

  if (details.areResponseExcerptsOff) {
    notes.push({
      key: "not-kept",
      text: translator.translateText(RESPONSE_CONTENT_NOT_KEPT) || "",
    });
  } else if (showsResponseContent(details)) {
    notes.push({
      key: "masked",
      text: translator.translateText(SECRETS_ARE_MASKED) || "",
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

  return (
    <section
      aria-labelledby={headingId}
      data-testid="what-happened-evaluation"
      className="mt-4 border-t border-gray-100 pt-4 [container-type:inline-size]"
    >
      <h3 id={headingId} className="text-sm font-semibold text-gray-900">
        {translator.translateText(EVALUATION_DETAILS_HEADING)}
      </h3>

      <FactList facts={checkFacts} dataTestId="evaluation-facts" />

      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
        }}
        aria-expanded={isOpen}
        aria-controls={contentId}
        data-testid="evaluation-details-toggle"
        className="-ml-1.5 mt-2 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-50 hover:text-indigo-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
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

      {isOpen ? (
        <div
          id={contentId}
          data-testid="evaluation-details-body"
          className="mt-3 space-y-4"
        >
          {requestFacts.length > 0 ? (
            <FactList
              facts={requestFacts}
              dataTestId="evaluation-request-facts"
            />
          ) : (
            <></>
          )}

          <div>
            <p
              data-testid="evaluation-criteria"
              className="text-sm text-gray-700"
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
              className="mt-2 divide-y divide-gray-100 border-t border-gray-100"
            >
              {orderFilters(details.filters).map(
                (filter: MonitorEvaluationFilterDetails, index: number) => {
                  return (
                    <FilterRow
                      key={`${filter.checkOn}-${index}`}
                      filter={filter}
                    />
                  );
                },
              )}
            </ul>
          </div>

          {notes.length > 0 ? (
            <div data-testid="evaluation-notes" className="space-y-1">
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
      ) : (
        <></>
      )}
    </section>
  );
};

// A list of facts: labels over values, two to a row, four where there is room.
const FactList: FunctionComponent<{
  facts: Array<Fact>;
  dataTestId: string;
}> = (props: { facts: Array<Fact>; dataTestId: string }): ReactElement => {
  return (
    <dl
      data-testid={props.dataTestId}
      className="mt-2 grid grid-cols-2 gap-x-6 gap-y-3 [@container(min-width:36rem)]:grid-cols-4"
    >
      {props.facts.map((fact: Fact) => {
        return (
          <div
            key={fact.key}
            data-testid={`${props.dataTestId}-${fact.key}`}
            className={`min-w-0 ${
              fact.key === "request" || fact.key === "failure"
                ? "col-span-2 [@container(min-width:36rem)]:col-span-4"
                : ""
            }`}
          >
            <dt className={FACT_LABEL_CLASS_NAME}>{fact.label}</dt>
            <dd className={FACT_VALUE_CLASS_NAME}>{fact.value}</dd>
          </div>
        );
      })}
    </dl>
  );
};

// One filter of the criteria: what it checked, and what it found.
const FilterRow: FunctionComponent<{
  filter: MonitorEvaluationFilterDetails;
}> = (props: { filter: MonitorEvaluationFilterDetails }): ReactElement => {
  const translator: Translator = useTranslator();
  const filter: MonitorEvaluationFilterDetails = props.filter;
  const valueText: string | undefined = getFilterValueText(filter);

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

  if (filter.actual) {
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
          {getActualText(filter, translator)}
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

  const omissionNote: string | undefined = getExcerptOmissionNote(
    filter.excerptOmission,
  );

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
          {valueText ? (
            <>
              {" "}
              <code
                dir="ltr"
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

        {facts.length > 0 ? (
          <dl data-testid="evaluation-filter-facts" className="space-y-2">
            {facts.map((fact: Fact) => {
              /*
               * Label over value on a narrow card; beside it, in a column
               * of its own, where there is room.
               */
              return (
                <div
                  key={fact.key}
                  data-testid={`evaluation-filter-${fact.key}`}
                  className="flex flex-col gap-0.5 [@container(min-width:30rem)]:flex-row [@container(min-width:30rem)]:items-baseline [@container(min-width:30rem)]:gap-4"
                >
                  <dt
                    className={`${FACT_LABEL_CLASS_NAME} shrink-0 [@container(min-width:30rem)]:w-28`}
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
        ) : (
          <></>
        )}

        {filter.fieldValues && filter.fieldValues.length > 0 ? (
          <div data-testid="evaluation-filter-values">
            <div className={FACT_LABEL_CLASS_NAME}>
              {translator.translateText(FILTER_FACT_LABELS.values)}
            </div>
            <ul
              dir="ltr"
              className={`mt-1 space-y-1 rounded-md bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-800 ${CODE_CLASS_NAME}`}
            >
              {filter.fieldValues.map(
                (value: MonitorEvaluationFieldValue, index: number) => {
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
                },
              )}
              {filter.areFieldValuesTruncated ? <li>…</li> : <></>}
            </ul>
          </div>
        ) : (
          <></>
        )}

        {filter.excerpt ? <Excerpt excerpt={filter.excerpt} /> : <></>}

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

        {filter.message ? (
          <p
            dir="auto"
            data-testid="evaluation-filter-message"
            className="break-words text-xs text-gray-500"
          >
            {filter.message}
          </p>
        ) : (
          <></>
        )}
      </div>
    </li>
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
      <div className={FACT_LABEL_CLASS_NAME}>
        {translator.translateText(FILTER_FACT_LABELS.excerpt)}
      </div>
      <pre
        dir="ltr"
        className={`mt-1 whitespace-pre-wrap rounded-md bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-800 ${CODE_CLASS_NAME}`}
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

// The request line: GET https://..., or the host and its port.
const getRequestText: (
  request: MonitorEvaluationRequest | undefined,
) => string | undefined = (
  request: MonitorEvaluationRequest | undefined,
): string | undefined => {
  if (!request) {
    return undefined;
  }

  if (request.url) {
    return request.method ? `${request.method} ${request.url}` : request.url;
  }

  if (request.destination) {
    return request.port
      ? `${request.destination}:${request.port}`
      : request.destination;
  }

  return request.method || undefined;
};

/*
 * An actual value as the section writes it: a measurement's number the
 * reader's way with its unit, true and false as the criteria form names its
 * True and False conditions, anything else as it was found.
 */
const getActualText: (
  filter: MonitorEvaluationFilterDetails,
  translator: Translator,
) => string = (
  filter: MonitorEvaluationFilterDetails,
  translator: Translator,
): string => {
  const actual: string = filter.actual || "";

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
