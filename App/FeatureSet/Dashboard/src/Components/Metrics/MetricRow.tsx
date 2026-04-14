import React, { FunctionComponent, ReactElement } from "react";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Service from "Common/Models/DatabaseModels/Service";
import MetricSparkline, { SparklinePoint } from "./MetricSparkline";

export interface MetricRowProps {
  metric: MetricType;
  sparklinePoints?: Array<SparklinePoint> | undefined;
  sparklineLoading?: boolean;
  lastValue?: number | undefined;
  onClick?: () => void;
}

const MetricRow: FunctionComponent<MetricRowProps> = (
  props: MetricRowProps,
): ReactElement => {
  const { metric } = props;

  const services: Array<Service> = metric.services || [];

  return (
    <button
      type="button"
      className="group block w-full border-b border-gray-100 px-5 py-4 text-left transition-all hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400"
      onClick={props.onClick}
    >
      <div className="flex items-center gap-6">
        {/* Left: metric info */}
        <div className="min-w-0 flex-1">
          {/* Name + unit */}
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-sm font-semibold text-gray-900 group-hover:text-indigo-700">
              {metric.name || "(unnamed)"}
            </span>
            {metric.unit && (
              <span className="flex-shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-600">
                {metric.unit}
              </span>
            )}
          </div>
          {/* Description */}
          {metric.description && (
            <p className="mt-1 truncate text-xs text-gray-500">
              {metric.description}
            </p>
          )}
          {/* Services */}
          {services.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {services.slice(0, 4).map((service: Service): ReactElement => {
                const color: string | undefined =
                  service.serviceColor?.toString();
                return (
                  <span
                    key={service._id?.toString() || service.name}
                    className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-medium text-gray-600 shadow-sm"
                    style={color ? { borderColor: color, color } : undefined}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: color || "#9ca3af" }}
                    />
                    {service.name || "unknown"}
                  </span>
                );
              })}
              {services.length > 4 && (
                <span className="text-[10px] text-gray-400">
                  +{services.length - 4} more
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right: sparkline + last value */}
        <div className="flex flex-shrink-0 items-center gap-4">
          {props.lastValue !== undefined && (
            <div className="text-right">
              <span className="font-mono text-sm font-semibold tabular-nums text-gray-900">
                {props.lastValue.toLocaleString()}
              </span>
              {metric.unit && (
                <span className="ml-1 text-xs text-gray-400">
                  {metric.unit}
                </span>
              )}
            </div>
          )}
          <MetricSparkline
            points={props.sparklinePoints || []}
            isLoading={props.sparklineLoading}
            widthClassName="w-40"
            heightClassName="h-10"
          />
        </div>
      </div>
    </button>
  );
};

export default MetricRow;
