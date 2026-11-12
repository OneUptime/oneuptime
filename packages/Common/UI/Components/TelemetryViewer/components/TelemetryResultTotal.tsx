import React, { FunctionComponent, ReactElement } from "react";
import {
  TemplateValues,
  translatableTerm,
  Translator,
  translationKey,
} from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import TranslatedSentence from "../../TranslatedSentence/TranslatedSentence";
import {
  ResultTotal,
  ResultTotalStatus,
  ResultTotalUnavailableReason,
} from "../../../Utils/Telemetry/ResultTotal";
import {
  TelemetryItemLabels,
  TelemetryTotalTemplates,
  getTelemetryItemLabels,
  getTelemetryTotalTemplates,
} from "./TelemetryItemLabel";
import InlineSeparator from "../../InlineSeparator/InlineSeparator";

export const TELEMETRY_RESULT_TOTAL_TEST_ID: string = "telemetry-result-total";

export interface TelemetryResultTotalProps {
  total: ResultTotal;
  /*
   * Rows the list has shown up to the end of this page. All an uncounted
   * total can still vouch for: "50+ spans".
   */
  rowsThroughPage: number;
  itemLabel?: string | undefined;
}

const UNAVAILABLE_EXPLANATION: Record<ResultTotalUnavailableReason, string> = {
  [ResultTotalUnavailableReason.TooManyToCount]: translationKey(
    "Too many to count in time. Narrow the time range for an exact total.",
  ),
  [ResultTotalUnavailableReason.CountFailed]: translationKey(
    "The total could not be counted.",
  ),
};

/*
 * The size of the result set, at the head of the list it describes: the
 * number a reader looks for to judge volume and to check that a filter did
 * what they meant (issue #4202). It never claims more than it knows — while
 * counting it says so, and a total that could not be counted is printed as
 * what the list has proven, with a "+".
 */
const TelemetryResultTotal: FunctionComponent<TelemetryResultTotalProps> = (
  props: TelemetryResultTotalProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const labels: TelemetryItemLabels = getTelemetryItemLabels(props.itemLabel);
  /*
   * "1,234 spans" and "50+ spans" in the kind's own sentences, which each
   * language words around its noun: "الامتدادات: 1,234" in Arabic.
   */
  const totals: TelemetryTotalTemplates = getTelemetryTotalTemplates(
    props.itemLabel,
  );
  const status: ResultTotalStatus = props.total.status;
  const itemWords: TemplateValues = {
    itemName: translatableTerm(labels.singular, { inSentence: true }),
    itemsName: translatableTerm(labels.plural, { inSentence: true }),
  };

  let content: ReactElement;

  if (status === ResultTotalStatus.Exact) {
    const count: number = props.total.count || 0;

    content = (
      <TranslatedSentence
        template={totals.exact}
        count={count}
        values={itemWords}
        slots={{
          count: (
            <span className="font-semibold tabular-nums text-gray-900">
              {translator.formatNumber(count)}
            </span>
          ),
        }}
      />
    );
  } else if (status === ResultTotalStatus.Unavailable) {
    const reason: ResultTotalUnavailableReason =
      props.total.unavailableReason || ResultTotalUnavailableReason.CountFailed;

    content = (
      <>
        <TranslatedSentence
          template={totals.lowerBound}
          values={itemWords}
          slots={{
            count: (
              <span className="font-semibold tabular-nums text-gray-900">
                {translator.formatNumber(props.rowsThroughPage)}
              </span>
            ),
          }}
        />
        <span className="text-gray-400">
          <InlineSeparator />
          {translator.translateText(UNAVAILABLE_EXPLANATION[reason])}
        </span>
      </>
    );
  } else {
    content = (
      <>{translator.translateTemplate("Counting {{itemsName}}…", itemWords)}</>
    );
  }

  return (
    <p
      className="text-xs text-gray-500"
      data-testid={TELEMETRY_RESULT_TOTAL_TEST_ID}
      data-status={status}
    >
      {content}
    </p>
  );
};

export default TelemetryResultTotal;
