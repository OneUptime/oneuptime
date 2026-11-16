import { JSONObject } from "Common/Types/JSON";
import DictionaryFilterSentence from "Common/UI/Components/Dictionary/DictionaryFilterSentence";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // The filters as stored: a bare value (=) or an operator's, by key.
  filters: JSONObject;
}

/*
 * A log, trace or security events monitor's attribute filters on its
 * detail page, one sentence each in the reader's language - "http.route
 * stimmt überein /api/*" - its key and value as written, its words where the
 * language puts them (#8309). The view model hands them over as stored
 * (MonitorStepViewValueType.AttributeFilters); tabulated as "key | contains
 * web", the operator read English in every language, and a language that
 * puts its verb last could not move it.
 */
const AttributeFilterSentences: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ul
      className="space-y-1 text-sm text-gray-900"
      data-testid="monitor-step-attribute-filters"
    >
      {Object.keys(props.filters).map((key: string): ReactElement => {
        return (
          <li key={key}>
            <DictionaryFilterSentence
              attributeKey={key}
              value={props.filters[key]}
              keyClassName="font-medium text-gray-900"
              wordsClassName="text-gray-500"
              dataTestId="monitor-step-attribute-filter"
            />
          </li>
        );
      })}
    </ul>
  );
};

export default AttributeFilterSentences;
