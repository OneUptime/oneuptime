import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
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
 * The label/value rail on the insight detail page. Label left, value right,
 * hairline between rows — the same shape a reader already knows from every
 * other "details" sidebar, so nothing has to be decoded.
 */
const InsightFactsList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <dl className="divide-y divide-gray-100">
      {props.facts.map((fact: InsightFact, index: number) => {
        return (
          <div
            key={index}
            className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
          >
            <dt className="flex flex-shrink-0 items-center gap-1.5 text-sm text-gray-500">
              <span className="flex-shrink-0 text-gray-400">
                <Icon icon={fact.icon} className="h-3.5 w-3.5" />
              </span>
              {fact.label}
            </dt>
            {/*
             * Fall back to the value itself so a truncated Service or Metric
             * name is still readable on hover — only the timestamps carry an
             * explicit title, and without this fallback the clipped text had
             * no way back.
             */}
            <dd
              className="min-w-0 truncate text-right text-sm font-medium text-gray-900"
              title={
                fact.title ??
                (typeof fact.value === "string" ? fact.value : undefined)
              }
            >
              {fact.value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
};

export default InsightFactsList;
