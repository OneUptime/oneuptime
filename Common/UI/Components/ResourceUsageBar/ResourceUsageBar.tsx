import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  label: string;
  value: number; // percentage 0-100
  valueLabel?: string | undefined;
  secondaryLabel?: string | undefined;
  heightClassName?: string | undefined;
  className?: string | undefined;
  labelWidthClassName?: string | undefined;
}

function getBarColor(percent: number): string {
  if (percent > 80) {
    return "bg-red-500";
  }
  if (percent > 60) {
    return "bg-amber-500";
  }
  return "bg-emerald-500";
}

const ResourceUsageBar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const percent: number = Math.min(Math.max(props.value, 0), 100);
  const heightClass: string = props.heightClassName || "h-2";
  const labelWidthClass: string = props.labelWidthClassName || "w-40";

  return (
    <div className={`flex items-center gap-3 ${props.className || ""}`}>
      <div
        className={`${labelWidthClass} truncate text-sm text-gray-800 font-medium`}
        title={props.label}
      >
        {props.label}
      </div>
      {props.secondaryLabel && (
        <span className="inline-flex px-1.5 py-0.5 text-xs rounded bg-blue-50 text-blue-700">
          {props.secondaryLabel}
        </span>
      )}
      <div className={`flex-1 bg-gray-100 rounded-full ${heightClass}`}>
        <div
          className={`${heightClass} rounded-full transition-all duration-300 ${getBarColor(percent)}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      {props.valueLabel && (
        <span className="text-xs text-gray-600 w-16 text-right font-medium tabular-nums">
          {props.valueLabel}
        </span>
      )}
    </div>
  );
};

export default ResourceUsageBar;
