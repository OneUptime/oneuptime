import FilterCondition from "Common/Types/Filter/FilterCondition";
import { CheckOn, FilterType } from "Common/Types/Monitor/CriteriaFilter";
import MonitorEvaluationDetails, {
  MonitorEvaluationExcerptOmission,
  MonitorEvaluationFilterDetails,
  MonitorEvaluationRequest,
} from "Common/Types/Monitor/MonitorEvaluationDetails";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { translationKey } from "Common/Types/Translator";

/*
 * What the Evaluation details section of an incident's or an alert's What
 * happened card says, and which of it shows - React-free, so the rules can
 * be read by tests without a page.
 *
 * Folded, the section says why the monitor opened the record: the criteria
 * that matched and each filter that matched, with what the check found and
 * where. That is what nothing else on the page keeps once somebody writes
 * the real root cause over the one the monitor wrote. Show details adds the
 * evidence that takes room - the values a JavaScript expression read, the
 * excerpt of the response, the filters that did not match - and the check
 * itself: the request, when it ran, from which probe and what came back
 * (the stat bar above already says when the record was declared and by
 * which probe, so they are not repeated before they are asked for).
 */

export const EVALUATION_DETAILS_HEADING: string =
  translationKey("Evaluation details");

export const SHOW_EVALUATION_DETAILS: string = translationKey("Show details");

export const HIDE_EVALUATION_DETAILS: string = translationKey("Hide details");

// The facts of the check, by what they say.
export const EVALUATION_FACT_LABELS: {
  readonly checked: string;
  readonly probe: string;
  readonly statusCode: string;
  readonly responseTime: string;
  readonly request: string;
  readonly step: string;
  readonly failure: string;
} = {
  checked: translationKey("Checked"),
  probe: translationKey("Probe"),
  statusCode: translationKey("Status code"),
  responseTime: translationKey("Response time"),
  request: translationKey("Request"),
  step: translationKey("Step"),
  failure: translationKey("Failure"),
};

export const STEP_OF_STEPS: string = translationKey("{{step}} of {{count}}");

/*
 * How the criteria matched, as one sentence: by all of its filters, by one
 * of them, or by the one it has. {{criteria}} is its name.
 */
export const CRITERIA_MATCHED_ALL: string = translationKey(
  "{{criteria}} matched when all of its filters did.",
);

export const CRITERIA_MATCHED_ANY: string = translationKey(
  "{{criteria}} matched when one of its filters did.",
);

export const CRITERIA_MATCHED: string = translationKey("{{criteria}} matched.");

// The same, for a criteria saved without a name.
export const UNNAMED_CRITERIA_MATCHED_ALL: string = translationKey(
  "The criteria matched when all of its filters did.",
);

export const UNNAMED_CRITERIA_MATCHED_ANY: string = translationKey(
  "The criteria matched when one of its filters did.",
);

export const UNNAMED_CRITERIA_MATCHED: string = translationKey(
  "The criteria matched.",
);

export const FILTER_MATCHED: string = translationKey("Matched");

export const FILTER_NOT_MATCHED: string = translationKey("Did not match");

// The facts of one filter.
export const FILTER_FACT_LABELS: {
  readonly field: string;
  readonly actual: string;
  readonly latestCheck: string;
  readonly window: string;
  readonly values: string;
  readonly excerpt: string;
} = {
  field: translationKey("Found at"),
  actual: translationKey("Actual"),
  latestCheck: translationKey("Latest check"),
  window: translationKey("Window"),
  values: translationKey("Values"),
  excerpt: translationKey("Excerpt"),
};

export const FIELD_VALUE_NOT_FOUND: string = translationKey("not found");

/*
 * A filter judged over a window: its minutes, and how its values were
 * judged ({{type}} is an Evaluate Over Time type the criteria form names:
 * Average, All Values...).
 */
export const WINDOW_SENTENCE: { one: string; other: string } = {
  one: translationKey("The last minute, {{type}}"),
  other: translationKey("The last {{count}} minutes, {{type}}"),
};

export const RESPONSE_CONTENT_NOT_KEPT: string = translationKey(
  "The monitor keeps no response content on its incidents and alerts.",
);

// The same, for an Incoming Request monitor: what it keeps is a request.
export const REQUEST_CONTENT_NOT_KEPT: string = translationKey(
  "The monitor keeps no request content on its incidents and alerts.",
);

export const MATCHED_TEXT_MASKED: string = translationKey(
  "The matched text looks like a secret or personal data, so it was not kept.",
);

export const BODY_WAS_EMPTY: string = translationKey("The body was empty.");

export const SECRETS_ARE_MASKED: string = translationKey(
  "Secrets and personal data in the response are masked.",
);

// The same, for an Incoming Request monitor.
export const SECRETS_IN_REQUEST_ARE_MASKED: string = translationKey(
  "Secrets and personal data in the request are masked.",
);

export const DETAILS_WERE_TRIMMED: string = translationKey(
  "Part of these details was left out to keep them short.",
);

export const MORE_FILTERS_THAN_SHOWN: string = translationKey(
  "This criteria has more filters than are shown here.",
);

/*
 * A filter's value longer than this, or a JavaScript expression, is set
 * under the filter's title as a block of code rather than in its line: an
 * expression wraps over several lines, and a code chip cut across lines
 * reads as several.
 */
export const LONG_FILTER_VALUE_CHARS: number = 40;

// The sentence that says how the criteria matched, and whether it names it.
export const getCriteriaSentence: (details: MonitorEvaluationDetails) => {
  template: string;
  hasName: boolean;
} = (
  details: MonitorEvaluationDetails,
): { template: string; hasName: boolean } => {
  const hasName: boolean = Boolean(details.criteriaName?.trim());
  const hasSeveralFilters: boolean = details.filters.length > 1;

  if (!hasSeveralFilters) {
    return {
      template: hasName ? CRITERIA_MATCHED : UNNAMED_CRITERIA_MATCHED,
      hasName: hasName,
    };
  }

  if (details.filterCondition === FilterCondition.Any) {
    return {
      template: hasName ? CRITERIA_MATCHED_ANY : UNNAMED_CRITERIA_MATCHED_ANY,
      hasName: hasName,
    };
  }

  return {
    template: hasName ? CRITERIA_MATCHED_ALL : UNNAMED_CRITERIA_MATCHED_ALL,
    hasName: hasName,
  };
};

// Why a filter that reads a body shows no excerpt, as the section says it.
export const getExcerptOmissionNote: (
  omission: MonitorEvaluationExcerptOmission | undefined,
) => string | undefined = (
  omission: MonitorEvaluationExcerptOmission | undefined,
): string | undefined => {
  switch (omission) {
    case "matched-text-masked":
      return MATCHED_TEXT_MASKED;
    case "empty-body":
      return BODY_WAS_EMPTY;
    /*
     * Said once for the whole section (RESPONSE_CONTENT_NOT_KEPT), not on
     * every filter.
     */
    case "response-excerpts-off":
    default:
      return undefined;
  }
};

/*
 * Does the section show anything read from the response - an excerpt, a
 * field's value? Then it says that secrets are masked in it.
 */
export const showsResponseContent: (
  details: MonitorEvaluationDetails,
) => boolean = (details: MonitorEvaluationDetails): boolean => {
  return details.filters.some((filter: MonitorEvaluationFilterDetails) => {
    return Boolean(
      filter.excerpt || (filter.fieldValues && filter.fieldValues.length > 0),
    );
  });
};

/*
 * What the section's notes call what the check read: an Incoming Request
 * monitor reads the request it receives, every other monitor the response
 * it gets.
 */
export const getContentNotKeptNote: (monitorType: MonitorType) => string = (
  monitorType: MonitorType,
): string => {
  return monitorType === MonitorType.IncomingRequest
    ? REQUEST_CONTENT_NOT_KEPT
    : RESPONSE_CONTENT_NOT_KEPT;
};

export const getSecretsMaskedNote: (monitorType: MonitorType) => string = (
  monitorType: MonitorType,
): string => {
  return monitorType === MonitorType.IncomingRequest
    ? SECRETS_IN_REQUEST_ARE_MASKED
    : SECRETS_ARE_MASKED;
};

/*
 * The filters as the section lists them: the ones that matched first, in
 * the criteria's order, then the ones that did not - which matter only for
 * a criteria that needed one of them.
 */
export const orderFilters: (
  filters: Array<MonitorEvaluationFilterDetails>,
) => Array<MonitorEvaluationFilterDetails> = (
  filters: Array<MonitorEvaluationFilterDetails>,
): Array<MonitorEvaluationFilterDetails> => {
  return [
    ...filters.filter((filter: MonitorEvaluationFilterDetails) => {
      return filter.met;
    }),
    ...filters.filter((filter: MonitorEvaluationFilterDetails) => {
      return !filter.met;
    }),
  ];
};

/*
 * The filters the section lists: folded, the ones that matched - why the
 * record opened; opened, every one, those that did not match last. A
 * section with no filter that matched (none is stored so) lists them all
 * rather than nothing.
 */
export const getShownFilters: (
  filters: Array<MonitorEvaluationFilterDetails>,
  isOpen: boolean,
) => Array<MonitorEvaluationFilterDetails> = (
  filters: Array<MonitorEvaluationFilterDetails>,
  isOpen: boolean,
): Array<MonitorEvaluationFilterDetails> => {
  const ordered: Array<MonitorEvaluationFilterDetails> = orderFilters(filters);

  if (isOpen) {
    return ordered;
  }

  const matched: Array<MonitorEvaluationFilterDetails> = ordered.filter(
    (filter: MonitorEvaluationFilterDetails) => {
      return filter.met;
    },
  );

  return matched.length > 0 ? matched : ordered;
};

/*
 * A filter's value as written in its title: a number as written, a text
 * quoted as the criteria list quotes it. A boolean condition (True, False)
 * and the empty ones have none.
 */
export const getFilterValueText: (
  filter: MonitorEvaluationFilterDetails,
) => string | undefined = (
  filter: MonitorEvaluationFilterDetails,
): string | undefined => {
  if (filter.value === undefined || filter.value === null) {
    return undefined;
  }

  const text: string = String(filter.value).trim();

  return text || undefined;
};

// Whether the value goes under the title, as code, rather than in its line.
export const isFilterValueOnItsOwnLine: (
  filter: MonitorEvaluationFilterDetails,
) => boolean = (filter: MonitorEvaluationFilterDetails): boolean => {
  const text: string | undefined = getFilterValueText(filter);

  if (!text) {
    return false;
  }

  return (
    filter.checkOn === CheckOn.JavaScriptExpression ||
    text.length > LONG_FILTER_VALUE_CHARS ||
    text.includes("\n")
  );
};

// The conditions that are a yes or a no.
const YES_OR_NO_FILTER_TYPES: ReadonlyArray<FilterType> = [
  FilterType.True,
  FilterType.False,
  FilterType.EvaluatesToTrue,
];

/*
 * The actual value the section shows for a filter. None where it would only
 * repeat the filter: a JavaScript expression that matched evaluated to true,
 * and an Is Online filter of False that matched found false.
 */
export const getShownActual: (
  filter: MonitorEvaluationFilterDetails,
) => string | undefined = (
  filter: MonitorEvaluationFilterDetails,
): string | undefined => {
  if (!filter.actual) {
    return undefined;
  }

  const isYesOrNo: boolean = Boolean(
    filter.filterType && YES_OR_NO_FILTER_TYPES.includes(filter.filterType),
  );

  if (
    filter.met &&
    isYesOrNo &&
    (filter.actual === "true" || filter.actual === "false")
  ) {
    return undefined;
  }

  return filter.actual;
};

// Whether the section can say what a filter found other than in a sentence.
export const hasFoundValues: (
  filter: MonitorEvaluationFilterDetails,
) => boolean = (filter: MonitorEvaluationFilterDetails): boolean => {
  return Boolean(
    getShownActual(filter) ||
      filter.field ||
      filter.excerpt ||
      (filter.fieldValues && filter.fieldValues.length > 0),
  );
};

/*
 * Whether a filter's own sentence shows - the evaluation's, in English
 * ("Response Status Code was 200 (expected to be greater than 499).").
 * Where the section can say what the filter found, the sentence only says
 * it again ("Response body contains degraded."), so it shows:
 *   - when it is the only account of what the filter found: a filter of a
 *     monitor type the section has no values for, a filter that did not
 *     match;
 *   - opened, for a filter judged over a window: it says what the window
 *     held ("ranged from 2,180 ms to 2,412 ms across all 3 readings");
 *   - never for a JavaScript expression that matched: its title is the
 *     expression, its values are listed under it.
 */
export const isFilterSentenceShown: (
  filter: MonitorEvaluationFilterDetails,
  isOpen: boolean,
) => boolean = (
  filter: MonitorEvaluationFilterDetails,
  isOpen: boolean,
): boolean => {
  if (!filter.message?.trim()) {
    return false;
  }

  if (filter.met && filter.checkOn === CheckOn.JavaScriptExpression) {
    return false;
  }

  if (!hasFoundValues(filter)) {
    return true;
  }

  return isOpen && Boolean(filter.windowMinutes);
};

// The request line: GET https://..., or the host and its port.
export const getRequestText: (
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
 * Whether Show details has anything to add to what the folded section
 * says. When a check was made of nothing the section reads - a Logs
 * monitor's count, say - all it could add is when the check ran, which the
 * stat bar's Declared tile already says: then the section has no toggle.
 */
export const hasDetailsToShow: (
  details: MonitorEvaluationDetails,
) => boolean = (details: MonitorEvaluationDetails): boolean => {
  if (getRequestText(details.request)) {
    return true;
  }

  if (details.probeName?.trim()) {
    return true;
  }

  if (details.stepNumber && details.stepCount && details.stepCount > 1) {
    return true;
  }

  if (
    typeof details.response?.statusCode === "number" ||
    typeof details.response?.responseTimeInMs === "number"
  ) {
    return true;
  }

  if (
    details.areResponseExcerptsOff ||
    details.areFiltersTruncated ||
    details.isTrimmedToSizeLimit
  ) {
    return true;
  }

  return details.filters.some(
    (filter: MonitorEvaluationFilterDetails): boolean => {
      return (
        !filter.met ||
        Boolean(filter.excerpt) ||
        Boolean(filter.fieldValues && filter.fieldValues.length > 0) ||
        Boolean(getExcerptOmissionNote(filter.excerptOmission)) ||
        isFilterSentenceShown(filter, true) !==
          isFilterSentenceShown(filter, false)
      );
    },
  );
};
