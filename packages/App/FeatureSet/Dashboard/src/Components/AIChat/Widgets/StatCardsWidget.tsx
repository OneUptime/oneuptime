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

  /*
   * As many tiles to a row as the card has room for, all the same width:
   * four in a row on a laptop and two by two on a phone. Three to a row
   * left a fourth tile alone on a row of its own.
   */
  return (
    <div
      data-testid="ai-chat-stat-cards"
      className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2"
    >
      {stats.map((stat: AIChatWidgetStat, index: number) => {
        return (
          <div
            key={index}
            className="rounded-lg border border-gray-200 bg-gray-50/70 px-3 py-2.5"
          >
            <div className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
              {stat.label}
            </div>
            <div className="mt-1 break-words text-lg font-semibold tabular-nums text-gray-900">
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
