import { AIChatWidget, AIChatWidgetStat } from "Common/Types/AI/AIChatTypes";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  widget: AIChatWidget;
}

const StatCardsWidget: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const stats: Array<AIChatWidgetStat> = props.widget.data.stats || [];

  if (stats.length === 0) {
    return <></>;
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {stats.map((stat: AIChatWidgetStat, index: number) => {
        return (
          <div
            key={index}
            className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-800/40"
          >
            <div className="text-[10px] font-medium uppercase tracking-wider text-gray-400">
              {stat.label}
            </div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">
              {typeof stat.value === "number"
                ? stat.value.toLocaleString()
                : stat.value}
              {stat.unit ? (
                <span className="ml-1 text-xs font-normal text-gray-400">
                  {stat.unit}
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default StatCardsWidget;
