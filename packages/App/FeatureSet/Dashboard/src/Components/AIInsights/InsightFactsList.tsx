import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface InsightFact {
  label: string;
  icon: IconProp;
  value: string | ReactElement;
  // Absolute timestamp behind a relative one ("3 days ago"), shown on hover.
  title?: string | undefined;
}

export interface ComponentProps {
  facts: Array<InsightFact>;
}

/*
 * The rows' layout, for the tests and the browser suites: a row wraps, so
 * a value too long to sit beside its label moves under it, whole, instead
 * of being cut beside it ("4 minutes a..." beside German's "Zuletzt
 * gesehen" in a finding page's rail). A value longer than the whole rail -
 * a long service or metric name - is still cut at its end there, and is
 * whole under the pointer.
 */
export const INSIGHT_FACT_ROW_CLASS_NAME: string =
  "flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-2.5 first:pt-0 last:pb-0";

export const INSIGHT_FACT_VALUE_CLASS_NAME: string =
  "ms-auto min-w-0 max-w-full truncate text-end text-sm font-medium text-gray-900";

/*
 * The label/value rail on the insight detail page. Label at the start,
 * value at the end, hairline between rows — the same shape a reader
 * already knows from every other "details" sidebar, so nothing has to be
 * decoded; in a narrow rail a long value goes under its label, still at
 * the end. Each label is given in English and drawn in the reader's
 * language.
 */
const InsightFactsList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <dl className="divide-y divide-gray-100">
      {props.facts.map((fact: InsightFact, index: number) => {
        return (
          <div
            key={index}
            className={INSIGHT_FACT_ROW_CLASS_NAME}
            data-testid="insight-fact"
          >
            <dt className="flex flex-shrink-0 items-center gap-1.5 text-sm text-gray-500">
              <span className="flex-shrink-0 text-gray-400">
                <Icon icon={fact.icon} className="h-3.5 w-3.5" />
              </span>
              {translator.translateText(fact.label)}
            </dt>
            {/*
             * Fall back to the value itself so a truncated Service or Metric
             * name is still readable on hover — only the timestamps carry an
             * explicit title, and without this fallback the clipped text had
             * no way back.
             */}
            <dd
              className={INSIGHT_FACT_VALUE_CLASS_NAME}
              data-testid="insight-fact-value"
              title={
                fact.title ??
                (typeof fact.value === "string" ? fact.value : undefined)
              }
            >
              {/*
               * Text in its own direction: "5 hours ago" on a Persian page
               * read "hours ago 5".
               */}
              {typeof fact.value === "string" ? (
                <bdi>{fact.value}</bdi>
              ) : (
                fact.value
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
};

export default InsightFactsList;
