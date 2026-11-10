import React, { FunctionComponent, ReactElement } from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  ProductAnalyticsFunnelDto,
  ProductAnalyticsFunnelStepDto,
} from "Common/Types/Rum/ProductAnalyticsEventReads";
import {
  formatProductAnalyticsCount,
  formatProductAnalyticsDuration,
  formatProductAnalyticsShare,
} from "./ProductAnalyticsFormat";
import { describeProductAnalyticsEvent } from "./ProductAnalyticsEventsFormat";

/*
 * A funnel's steps as bars on one baseline (issue #6444, part two): each
 * step's people as a share of the first step's, every figure printed, and
 * between two steps what happened on the way - how many went on, how many
 * dropped off, and how long the ones who went on took.
 */

export interface ProductAnalyticsFunnelRow {
  key: string;
  // "1", "2": the step's place, in the reader's digits.
  number: string;
  label: string;
  people: string;
  // Of the first step's people, as a percent.
  share: string;
  // The bar's length, 0..100.
  width: number;
  // Between the step before and this one; absent on the first step.
  transition?:
    | {
        continued: string;
        droppedOff: string;
        median: string | null;
      }
    | undefined;
}

export function buildProductAnalyticsFunnelRows(data: {
  funnel: ProductAnalyticsFunnelDto;
  translator: Translator;
}): Array<ProductAnalyticsFunnelRow> {
  const translator: Translator = data.translator;

  return data.funnel.steps.map(
    (
      step: ProductAnalyticsFunnelStepDto,
      index: number,
    ): ProductAnalyticsFunnelRow => {
      const row: ProductAnalyticsFunnelRow = {
        key: `${index}:${step.kind}:${step.name}`,
        number: translator.formatNumber(index + 1),
        label: describeProductAnalyticsEvent(step, translator),
        people: translator.translatePlural(
          { one: "{{count}} person", other: "{{count}} people" },
          step.people,
        ),
        share: formatProductAnalyticsShare({
          part: step.conversionFromStart,
          whole: 1,
          language: translator.language,
        }),
        width: Math.max(0, Math.min(100, step.conversionFromStart * 100)),
      };

      if (index > 0) {
        row.transition = {
          continued: translator.translateTemplate("{{percent}} went on", {
            percent: formatProductAnalyticsShare({
              part: step.conversionFromPrevious,
              whole: 1,
              language: translator.language,
            }),
          }),
          droppedOff: translator.translateTemplate("{{count}} dropped off", {
            count: formatProductAnalyticsCount(step.droppedOff, translator),
          }),
          median:
            step.medianMsFromPrevious === null
              ? null
              : translator.translateTemplate("Median time {{duration}}", {
                  duration: formatProductAnalyticsDuration(
                    step.medianMsFromPrevious,
                    translator.language,
                  ),
                }),
        };
      }

      return row;
    },
  );
}

/* The funnel in one line: of the first step's people, the share who did every step. */
export function describeProductAnalyticsFunnelCompletion(data: {
  funnel: ProductAnalyticsFunnelDto;
  translator: Translator;
}): string | null {
  const first: ProductAnalyticsFunnelStepDto | undefined = data.funnel.steps[0];
  const last: ProductAnalyticsFunnelStepDto | undefined =
    data.funnel.steps[data.funnel.steps.length - 1];

  if (!first || !last || data.funnel.steps.length < 2 || first.people <= 0) {
    return null;
  }

  return data.translator.translateTemplate("{{percent}} did every step", {
    percent: formatProductAnalyticsShare({
      part: last.conversionFromStart,
      whole: 1,
      language: data.translator.language,
    }),
  });
}

const ProductAnalyticsFunnelChart: FunctionComponent<{
  funnel: ProductAnalyticsFunnelDto;
  dataTestId: string;
}> = (props: {
  funnel: ProductAnalyticsFunnelDto;
  dataTestId: string;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const rows: Array<ProductAnalyticsFunnelRow> =
    buildProductAnalyticsFunnelRows({
      funnel: props.funnel,
      translator: translator,
    });

  return (
    <ol className="space-y-1" data-testid={props.dataTestId}>
      {rows.map((row: ProductAnalyticsFunnelRow): ReactElement => {
        return (
          <li key={row.key} data-testid={`${props.dataTestId}-step`}>
            {row.transition ? (
              <div
                className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-2.5 pt-3 ps-9 text-xs text-gray-500"
                data-testid={`${props.dataTestId}-transition`}
              >
                <span className="font-medium text-gray-700">
                  {row.transition.continued}
                </span>
                <span>{row.transition.droppedOff}</span>
                {row.transition.median ? (
                  <span>{row.transition.median}</span>
                ) : (
                  <></>
                )}
              </div>
            ) : (
              <></>
            )}
            <div className="flex items-start gap-3">
              <span
                className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-indigo-50 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200"
                aria-hidden="true"
              >
                {row.number}
              </span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                  <span
                    className="min-w-0 truncate text-sm font-medium text-gray-900"
                    dir="auto"
                    title={row.label}
                  >
                    {row.label}
                  </span>
                  <span className="flex-none text-sm tabular-nums text-gray-900">
                    {row.people}
                    <span className="ms-2 text-gray-500">{row.share}</span>
                  </span>
                </div>
                <div
                  className="h-2 rounded-full bg-gray-100"
                  aria-hidden="true"
                >
                  <div
                    className="h-2 rounded-full bg-indigo-500"
                    style={{ width: `${row.width}%` }}
                    data-testid={`${props.dataTestId}-bar`}
                  />
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
};

export default ProductAnalyticsFunnelChart;
