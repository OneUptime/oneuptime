import React, { FunctionComponent, ReactElement } from "react";

export interface StackedProgressBarSegment {
  value: number;
  color: string; // Tailwind bg class, e.g. "bg-green-500"
  label: string;
  tooltip?: string | undefined;
}

export interface ComponentProps {
  segments: Array<StackedProgressBarSegment>;
  totalValue?: number | undefined;
  heightClassName?: string | undefined;
  showLegend?: boolean | undefined;
  className?: string | undefined;
}

const StackedProgressBar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const total: number =
    props.totalValue ||
    props.segments.reduce((sum: number, seg: StackedProgressBarSegment) => {
      return sum + seg.value;
    }, 0);

  const heightClass: string = props.heightClassName || "h-4";
  const showLegend: boolean = props.showLegend !== false;

  return (
    <div className={props.className || ""}>
      <div
        className={`flex ${heightClass} rounded-full overflow-hidden bg-gray-100`}
        role="progressbar"
        aria-label="Stacked progress bar"
      >
        {props.segments.map(
          (segment: StackedProgressBarSegment, index: number) => {
            if (segment.value <= 0 || total <= 0) {
              return null;
            }
            const widthPercent: number = (segment.value / total) * 100;
            return (
              <div
                key={index}
                className={`${segment.color} ${heightClass} transition-all duration-300`}
                style={{ width: `${widthPercent}%` }}
                title={segment.tooltip || `${segment.label}: ${segment.value}`}
              />
            );
          },
        )}
      </div>
      {showLegend && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2.5">
          {props.segments
            .filter((seg: StackedProgressBarSegment) => {
              return seg.value > 0;
            })
            .map((segment: StackedProgressBarSegment, index: number) => {
              return (
                <div key={index} className="flex items-center gap-1.5">
                  <span
                    className={`inline-block w-2.5 h-2.5 rounded-full ${segment.color}`}
                  />
                  <span className="text-sm text-gray-600">
                    {segment.label}{" "}
                    <span className="font-medium text-gray-800">
                      ({segment.value})
                    </span>
                  </span>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
};

export default StackedProgressBar;
