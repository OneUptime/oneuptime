import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  normalizeSloMetricQueryConfig,
  SloMetricKind,
  SloMetricQueryConfig,
  SloMetricQueryPart,
} from "Common/Utils/Slo/SloMetricSli";
import React, { FunctionComponent, ReactElement } from "react";
import { SLO_METRIC_FIELD_TITLES } from "../../Pages/Slo/SloMetricQueryFields";

/*
 * A Metric SLO's metric as Settings shows it (#8445): its name, then what
 * makes one of its events good and which of its series count - each under
 * the title the form asks it with, its value as written, in code, since a
 * metric name and a search are the same in every language.
 */

export interface ComponentProps {
  metricQueryConfig: unknown;
}

const CODE_CLASS: string =
  "break-all rounded bg-gray-100 px-1.5 py-0.5 font-mono text-sm text-gray-900";

const SloMetricSummary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const config: SloMetricQueryConfig | null = normalizeSloMetricQueryConfig(
    props.metricQueryConfig,
  );

  if (!config || !config.metricName) {
    return (
      <p
        className="font-medium text-yellow-700"
        data-testid="slo-settings-metric-missing"
      >
        {translator.translateText("No metric chosen")}
      </p>
    );
  }

  const rows: Array<{ part: SloMetricQueryPart; value: string }> = [];

  if (config.kind === SloMetricKind.Counter && config.goodFilter) {
    rows.push({
      part: SloMetricQueryPart.GoodFilter,
      value: config.goodFilter,
    });
  }

  if (
    config.kind === SloMetricKind.Histogram &&
    config.goodAtOrUnder !== undefined
  ) {
    rows.push({
      part: SloMetricQueryPart.GoodAtOrUnder,
      value: translator.formatNumber(config.goodAtOrUnder),
    });
  }

  if (config.filter) {
    rows.push({ part: SloMetricQueryPart.Filter, value: config.filter });
  }

  return (
    <div data-testid="slo-settings-metric">
      <code className={CODE_CLASS} data-testid="slo-settings-metric-name">
        {config.metricName}
      </code>
      {rows.length > 0 ? (
        <dl className="mt-2 grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 text-sm">
          {rows.map((row: { part: SloMetricQueryPart; value: string }) => {
            const title: string = SLO_METRIC_FIELD_TITLES[row.part];

            return (
              <React.Fragment key={row.part}>
                <dt className="text-gray-500">
                  {translator.translateText(title) || title}
                </dt>
                <dd data-testid={`slo-settings-metric-${row.part}`}>
                  <code className={CODE_CLASS}>{row.value}</code>
                </dd>
              </React.Fragment>
            );
          })}
        </dl>
      ) : null}
    </div>
  );
};

export default SloMetricSummary;
