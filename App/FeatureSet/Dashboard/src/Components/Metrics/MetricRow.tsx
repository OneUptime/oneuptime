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
      className="group block w-full px-4 py-3 text-left transition-colors hover:bg-indigo-50/40 focus:outline-none focus-visible:bg-indigo-50/60"
      onClick={props.onClick}
    >
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          {/* Line 1: name */}
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-xs font-semibold text-gray-900">
              {metric.name || "(unnamed)"}
            </span>
            {metric.unit && (
              <span className="flex-shrink-0 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                {metric.unit}
              </span>
            )}
          </div>
          {/* Line 2: description */}
          {metric.description && (
            <p className="mt-0.5 truncate text-[11px] text-gray-500">
              {metric.description}
            </p>
          )}
          {/* Line 3: services */}
          {services.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {services.slice(0, 4).map((service: Service): ReactElement => {
                const color: string | undefined =
                  service.serviceColor?.toString();
                return (
                  <span
                    key={service._id?.toString() || service.name}
                    className="inline-flex items-center gap-1 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-600"
                    style={color ? { borderColor: color, color } : undefined}
                  >
                    <span
                      className="h-1 w-1 rounded-full"
                      style={{ backgroundColor: color || "#9ca3af" }}
                    />
                    {service.name || "unknown"}
                  </span>
                );
              })}
              {services.length > 4 && (
                <span className="text-[10px] text-gray-400">
                  +{services.length - 4}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Sparkline + last value */}
        <div className="flex flex-shrink-0 flex-col items-end gap-1">
          <MetricSparkline
            points={props.sparklinePoints || []}
            isLoading={props.sparklineLoading}
          />
          {props.lastValue !== undefined && (
            <span className="font-mono text-[11px] tabular-nums text-gray-500">
              last: {props.lastValue.toLocaleString()}
              {metric.unit ? ` ${metric.unit}` : ""}
            </span>
          )}
        </div>
      </div>
    </button>
  );
};

export default MetricRow;
