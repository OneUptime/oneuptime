import React, { FunctionComponent, ReactElement } from "react";

export interface FacetValueRowProps {
  value: string;
  displayValue?: string | undefined;
  count: number;
  maxCount: number;
  color?: string | undefined;
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

  return (
    <div className="group flex items-center gap-2 py-1">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-0.5 text-left transition-colors hover:bg-gray-50"
        onClick={() => {
          props.onInclude(props.value);
        }}
        title={`Filter to ${displayLabel}`}
      >
        {props.color && (
          <span
            className="h-2.5 w-2.5 flex-none rounded-full"
            style={{ backgroundColor: props.color }}
          />
        )}
        <span className="min-w-0 truncate text-[12px] text-gray-700">
          {displayLabel}
        </span>
      </button>

      <div className="flex items-center gap-1.5">
        <div className="w-12">
          <div className="h-1.5 w-full rounded-full bg-gray-100">
            <div
              className="h-1.5 rounded-full opacity-70 transition-all"
              style={{
                width: `${barWidth}%`,
                backgroundColor: props.color || undefined,
              }}
            />
          </div>
        </div>
        <span className="min-w-[2rem] text-right font-mono text-[10px] tabular-nums text-gray-400">
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
