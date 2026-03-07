import React, { FunctionComponent, ReactElement } from "react";
import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";

export interface FacetValueRowProps {
  value: string;
  displayValue?: string | undefined;
  count: number;
  maxCount: number;
  color?: string | undefined;
  isActive?: boolean | undefined;
  onInclude: (value: string) => void;
  onExclude: (value: string) => void;
}

const FacetValueRow: FunctionComponent<FacetValueRowProps> = (
  props: FacetValueRowProps,
): ReactElement => {
  const barWidth: number =
    props.maxCount > 0
      ? Math.max(4, Math.round((props.count / props.maxCount) * 100))
      : 0;

  const displayLabel: string = props.displayValue || props.value || "(empty)";
  const isActive: boolean = props.isActive || false;

  return (
    <div className="group flex items-center gap-2 py-0.5">
      <button
        type="button"
        className={`flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-0.5 text-left transition-colors ${
          isActive
            ? "bg-indigo-50 ring-1 ring-indigo-200"
            : "hover:bg-gray-50"
        }`}
        onClick={() => {
          props.onInclude(props.value);
        }}
        title={isActive ? `Remove filter: ${displayLabel}` : `Filter to ${displayLabel}`}
      >
        {isActive ? (
          <span className="flex h-3.5 w-3.5 flex-none items-center justify-center rounded bg-indigo-500">
            <Icon icon={IconProp.Check} className="h-2.5 w-2.5 text-white" />
          </span>
        ) : props.color ? (
          <span
            className="h-2.5 w-2.5 flex-none rounded-full"
            style={{ backgroundColor: props.color }}
          />
        ) : (
          <span className="h-2.5 w-2.5 flex-none rounded-full bg-gray-300" />
        )}
        <span
          className={`min-w-0 truncate text-[12px] ${
            isActive ? "font-medium text-indigo-700" : "text-gray-700"
          }`}
        >
          {displayLabel}
        </span>
      </button>

      <div className="flex items-center gap-1.5">
        <div className="w-12">
          <div className="h-1.5 w-full rounded-full bg-gray-100">
            <div
              className={`h-1.5 rounded-full transition-all ${isActive ? "opacity-100" : "opacity-70"}`}
              style={{
                width: `${barWidth}%`,
                backgroundColor: isActive
                  ? "#6366f1"
                  : props.color || "#9ca3af",
              }}
            />
          </div>
        </div>
        <span
          className={`min-w-[2rem] text-right font-mono text-[10px] tabular-nums ${
            isActive ? "font-medium text-indigo-600" : "text-gray-400"
          }`}
        >
          {props.count.toLocaleString()}
        </span>
      </div>

      <button
        type="button"
        className="hidden h-5 w-5 items-center justify-center rounded text-[10px] text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 group-hover:flex"
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          props.onExclude(props.value);
        }}
        title={`Exclude ${displayLabel}`}
      >
        -
      </button>
    </div>
  );
};

export default FacetValueRow;
