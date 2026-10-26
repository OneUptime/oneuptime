import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useState,
} from "react";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Service from "Common/Models/DatabaseModels/Service";
import ValueFormatter from "Common/Utils/ValueFormatter";
import OneUptimeDate from "Common/Types/Date";
import MetricSparkline, { SparklinePoint } from "./MetricSparkline";
import ObjectID from "Common/Types/ObjectID";
import { getVisibleMetricServices } from "./MetricRowData";
import { getMetricServicesWithin } from "./Utils/MetricRowScope";
import {
  METRIC_ROW_CONTAINER_CLASS_NAME,
  METRIC_ROW_DESCRIPTION_CLASS_NAME,
  METRIC_ROW_INFO_CLASS_NAME,
  METRIC_ROW_LAYOUT_CLASS_NAME,
  METRIC_ROW_NAME_CLASS_NAME,
  METRIC_ROW_VALUE_CLASS_NAME,
} from "./MetricRowLayout";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

export interface MetricRowProps {
  metric: MetricType;
  sparklinePoints?: Array<SparklinePoint> | undefined;
  sparklineLoading?: boolean;
  lastValue?: number | undefined;
  serviceIds?: Array<ObjectID> | undefined;
  /*
   * When set, the row names only these services — strictly, so an empty
   * list names none. An entity-scoped list passes the services that
   * reported the metric under its keys (see Utils/MetricRowScope); left
   * unset, `serviceIds` applies as before.
   */
  restrictServicesToIds?: ReadonlyArray<string> | undefined;
  // Appended to the value, e.g. "/s" when the host charts a rate.
  valueSuffix?: string | undefined;
  // One short line under the value saying what the number is.
  valueCaption?: string | undefined;
  /*
   * The unit the value is in, when the host knows the metric's declared
   * unit is wrong for its scope. Unset: the metric's own unit.
   */
  valueUnit?: string | undefined;
  /*
   * Without a handler the row is a plain entry: no button, no "Explore"
   * affordance (a host that cannot drill down with its scope intact — see
   * MetricsViewer's disableMetricDrillDown).
   */
  onClick?: (() => void) | undefined;
}

const MetricRow: FunctionComponent<MetricRowProps> = (
  props: MetricRowProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { metric } = props;

  /*
   * While the cursor is over the sparkline, swap the displayed value
   * for the hovered data point so the number on the left tracks the
   * chart, and surface the data point's timestamp underneath. Reset
   * to null on mouse-out to fall back to lastValue.
   */
  const [hoveredPoint, setHoveredPoint] = useState<SparklinePoint | null>(null);

  const handleHoverPoint: (point: SparklinePoint | null) => void = useCallback(
    (point: SparklinePoint | null): void => {
      setHoveredPoint(point);
    },
    [],
  );

  const displayedValue: number | undefined = hoveredPoint
    ? hoveredPoint.value
    : props.lastValue;
  const displayedTime: string | null = hoveredPoint
    ? OneUptimeDate.getDateAsLocalFormattedString(hoveredPoint.time)
    : null;

  const services: Array<Service> = props.restrictServicesToIds
    ? getMetricServicesWithin({
        services: metric.services,
        allowedServiceIds: props.restrictServicesToIds,
      })
    : getVisibleMetricServices({
        services: metric.services,
        serviceIds: props.serviceIds,
      });
  const rawUnit: string = props.valueUnit || metric.unit || "";
  const formatterOptions: { metricName: string } = {
    metricName: metric.name || "",
  };
  const readableUnit: string = ValueFormatter.getReadableUnit(
    rawUnit,
    formatterOptions,
  );

  const isInteractive: boolean = Boolean(props.onClick);

  /*
   * Side by side - the metric on the left, its value and sparkline on the
   * right - only while the row is wide enough for both: the right side
   * takes about 15rem, which on a phone, or in a card beside a resource's
   * side menu, left the metric's name a few letters (follow-up of #5076).
   * Narrower, the name and description take the whole row and the value
   * and sparkline sit under them. Keyed to the row's own width
   * (METRIC_ROW_CONTAINER_CLASS_NAME), not the window's.
   */
  const content: ReactElement = (
    <div
      data-testid="metric-row-layout"
      className={METRIC_ROW_LAYOUT_CLASS_NAME}
    >
      {/* Left: metric info */}
      <div className={METRIC_ROW_INFO_CLASS_NAME}>
        {/* Name + unit */}
        <div className="flex items-center gap-2">
          <span
            data-testid="metric-row-name"
            className={METRIC_ROW_NAME_CLASS_NAME}
          >
            {metric.name || "(unnamed)"}
          </span>
          {readableUnit && (
            <span className="flex-shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-600">
              {readableUnit}
            </span>
          )}
        </div>
        {/* Description */}
        {metric.description && (
          <p className={METRIC_ROW_DESCRIPTION_CLASS_NAME}>
            {metric.description}
          </p>
        )}
        {/* Services */}
        {services.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {services.slice(0, 4).map((service: Service): ReactElement => {
              const color: string =
                service.serviceColor?.toString() || "#9ca3af";
              return (
                <span
                  key={service._id?.toString() || service.name}
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-gray-700"
                >
                  <span
                    className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="truncate">{service.name}</span>
                </span>
              );
            })}
            {services.length > 4 && (
              <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium text-gray-500">
                {translator.translateTemplate("+{{count}} more", {
                  count: translator.formatNumber(services.length - 4),
                })}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Right: sparkline + last value */}
      <div
        data-testid="metric-row-value"
        className={METRIC_ROW_VALUE_CLASS_NAME}
      >
        {displayedValue !== undefined && (
          <div className="text-right">
            <div className="font-mono text-sm font-semibold tabular-nums text-gray-900">
              {ValueFormatter.formatValue(
                displayedValue,
                rawUnit,
                formatterOptions,
              )}
              {props.valueSuffix || ""}
            </div>
            {displayedTime && (
              <div className="mt-0.5 font-mono text-[10px] text-gray-400 tabular-nums">
                {displayedTime}
              </div>
            )}
            {!displayedTime && props.valueCaption && (
              <div
                data-testid="metric-row-value-caption"
                className="mt-0.5 text-[10px] text-gray-400"
              >
                {props.valueCaption}
              </div>
            )}
          </div>
        )}
        <MetricSparkline
          points={props.sparklinePoints || []}
          isLoading={props.sparklineLoading}
          widthClassName="w-40"
          heightClassName="h-10"
          onHoverPoint={handleHoverPoint}
        />
        {/* Deep-link affordance — visible on hover/focus */}
        {isInteractive && (
          <span
            aria-hidden="true"
            className="max-sm:hidden items-center gap-0.5 text-xs font-medium text-gray-400 opacity-0 transition-opacity group-hover:text-indigo-600 group-hover:opacity-100 group-focus-visible:opacity-100 sm:flex"
          >
            {translator.translateText("Explore")}
            <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
          </span>
        )}
      </div>
    </div>
  );

  if (!isInteractive) {
    return (
      <div
        data-testid="metric-row"
        className={`block w-full border-b border-gray-100 px-5 py-4 text-left ${METRIC_ROW_CONTAINER_CLASS_NAME}`}
      >
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid="metric-row"
      className={`group block w-full border-b border-gray-100 px-5 py-4 text-left transition-all hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400 ${METRIC_ROW_CONTAINER_CLASS_NAME}`}
      onClick={props.onClick}
    >
      {content}
    </button>
  );
};

export default MetricRow;
