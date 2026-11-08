import FilterCondition from "Common/Types/Filter/FilterCondition";
import MonitorEvaluationDetails, {
  MonitorEvaluationExcerptOmission,
  MonitorEvaluationFilterDetails,
} from "Common/Types/Monitor/MonitorEvaluationDetails";
import { translationKey } from "Common/Types/Translator";

/*
 * What the Evaluation details section of an incident's or an alert's What
 * happened card says, and which of it shows - React-free, so the rules can
 * be read by tests without a page.
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

export const MATCHED_TEXT_MASKED: string = translationKey(
  "The matched text looks like a secret or personal data, so it was not kept.",
);

export const BODY_WAS_EMPTY: string = translationKey("The body was empty.");

export const SECRETS_ARE_MASKED: string = translationKey(
  "Secrets and personal data in the response are masked.",
);

export const DETAILS_WERE_TRIMMED: string = translationKey(
  "Part of these details was left out to keep them short.",
);

export const MORE_FILTERS_THAN_SHOWN: string = translationKey(
  "This criteria has more filters than are shown here.",
);

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
