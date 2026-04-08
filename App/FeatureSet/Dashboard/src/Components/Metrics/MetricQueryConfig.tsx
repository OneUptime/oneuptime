import React, { FunctionComponent, ReactElement, useState } from "react";
import MetricAlias from "./MetricAlias";
import MetricQuery from "./MetricQuery";
import Card from "Common/UI/Components/Card/Card";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricAliasData from "Common/Types/Metrics/MetricAliasData";
import MetricQueryData from "Common/Types/Metrics/MetricQueryData";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Dictionary from "Common/Types/Dictionary";

export interface ComponentProps {
  data: MetricQueryConfigData;
  onChange?: ((data: MetricQueryConfigData) => void) | undefined;
  metricTypes: Array<MetricType>;
  telemetryAttributes: string[];
  onRemove?: (() => void) | undefined;
  error?: string | undefined;
  onFocus?: (() => void) | undefined;
  onBlur?: (() => void) | undefined;
  tabIndex?: number | undefined;
  hideCard?: boolean | undefined;
  onAdvancedFiltersToggle?:
    | undefined
    | ((showAdvancedFilters: boolean) => void);
  attributesLoading?: boolean | undefined;
  attributesError?: string | undefined;
  onAttributesRetry?: (() => void) | undefined;
  onMetricNameChanged?: ((metricName: string) => void) | undefined;
  telemetryAttributeValueSuggestions?:
    | Record<string, Array<string>>
    | undefined;
  onAttributeKeySelected?: ((key: string) => void) | undefined;
}

const MetricGraphConfig: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [showDisplaySettings, setShowDisplaySettings] =
    useState<boolean>(false);

  const defaultAliasData: MetricAliasData = {
    metricVariable: undefined,
    title: undefined,
    description: undefined,
    legend: undefined,
    legendUnit: undefined,
  };

  // Compute active attribute count for the header summary
  const attributes: Dictionary<string | number | boolean> | undefined = (
    props.data?.metricQueryData?.filterData as Record<string, unknown>
  )?.["attributes"] as Dictionary<string | number | boolean> | undefined;

  const activeAttributeCount: number = attributes
    ? Object.keys(attributes).length
    : 0;

  const metricName: string =
    props.data?.metricQueryData?.filterData?.metricName?.toString() ||
    "No metric selected";

  const aggregationType: string =
    props.data?.metricQueryData?.filterData?.aggegationType?.toString() ||
    "Avg";

  // Remove a single attribute filter
  const handleRemoveAttribute: (key: string) => void = (key: string): void => {
    if (!attributes) {
      return;
    }

    const newAttributes: Dictionary<string | number | boolean> = {
      ...attributes,
    };
    delete newAttributes[key];

    const newFilterData: Record<string, unknown> = {
      ...(props.data.metricQueryData.filterData as Record<string, unknown>),
    };

    if (Object.keys(newAttributes).length > 0) {
      newFilterData["attributes"] = newAttributes;
    } else {
      delete newFilterData["attributes"];
    }

    if (props.onChange) {
      props.onChange({
        ...props.data,
        metricQueryData: {
          ...props.data.metricQueryData,
          filterData: newFilterData as MetricQueryData["filterData"],
        },
      });
    }
  };

  // Clear all attribute filters
  const handleClearAllAttributes: () => void = (): void => {
    const newFilterData: Record<string, unknown> = {
      ...(props.data.metricQueryData.filterData as Record<string, unknown>),
    };
    delete newFilterData["attributes"];

    if (props.onChange) {
      props.onChange({
        ...props.data,
        metricQueryData: {
          ...props.data.metricQueryData,
          filterData: newFilterData as MetricQueryData["filterData"],
        },
      });
    }
  };

  const getHeader: () => ReactElement = (): ReactElement => {
    return (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {/* Variable badge */}
          {props.data?.metricAliasData?.metricVariable && (
            <div className="bg-indigo-500 h-8 w-8 min-w-8 rounded-lg flex items-center justify-center text-sm font-bold text-white shadow-sm">
              {props.data.metricAliasData.metricVariable}
            </div>
          )}
          {/* Summary info */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-gray-900 truncate">
                {metricName}
              </span>
              <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                {aggregationType}
              </span>
              {activeAttributeCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-xs font-medium text-indigo-700">
                  <Icon
                    icon={IconProp.Filter}
                    className="h-3 w-3 text-indigo-500"
                  />
                  {activeAttributeCount}{" "}
                  {activeAttributeCount === 1 ? "filter" : "filters"}
                </span>
              )}
            </div>
            {props.data?.metricAliasData?.title &&
              props.data.metricAliasData.title !== metricName && (
                <p className="text-xs text-gray-500 mt-0.5 truncate">
                  {props.data.metricAliasData.title}
                </p>
              )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 ml-3">
          <button
            type="button"
            className="inline-flex items-center justify-center h-7 w-7 rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            onClick={() => {
              setIsExpanded(!isExpanded);
            }}
            title={isExpanded ? "Collapse" : "Expand"}
          >
            <Icon
              icon={isExpanded ? IconProp.ChevronUp : IconProp.ChevronDown}
              className="h-4 w-4"
            />
          </button>
          {props.onRemove && (
            <button
              type="button"
              className="inline-flex items-center justify-center h-7 w-7 rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
              onClick={() => {
                props.onBlur?.();
                props.onFocus?.();
                return props.onRemove?.();
              }}
              title="Remove query"
            >
              <Icon icon={IconProp.Trash} className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    );
  };

  const getAttributeChips: () => ReactElement | null =
    (): ReactElement | null => {
      if (!attributes || activeAttributeCount === 0) {
        return null;
      }

      return (
        <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t border-gray-100">
          <span className="text-xs text-gray-400 font-medium mr-1">
            Filtered by:
          </span>
          {Object.entries(attributes).map(
            ([key, value]: [string, string | number | boolean]) => {
              return (
                <span
                  key={key}
                  className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 py-0.5 pl-2 pr-1 text-xs text-indigo-700"
                >
                  <span className="font-medium text-indigo-500">{key}:</span>
                  <span>{String(value)}</span>
                  <button
                    type="button"
                    className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded text-indigo-400 transition-colors hover:bg-indigo-100 hover:text-indigo-600"
                    onClick={() => {
                      handleRemoveAttribute(key);
                    }}
                    title={`Remove ${key}: ${String(value)}`}
                  >
                    <Icon icon={IconProp.Close} className="h-2.5 w-2.5" />
                  </button>
                </span>
              );
            },
          )}
          {activeAttributeCount > 1 && (
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-[11px] font-medium text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              onClick={handleClearAllAttributes}
            >
              Clear all
            </button>
          )}
        </div>
      );
    };

  const getContent: () => ReactElement = (): ReactElement => {
    return (
      <div>
        {/* Header with summary */}
        {getHeader()}

        {/* Attribute filter chips - always visible */}
        {!isExpanded && getAttributeChips()}

        {/* Expandable content */}
        {isExpanded && (
          <div className="mt-4 space-y-4">
            {/* Metric query selection */}
            {props.data?.metricQueryData && (
              <MetricQuery
                data={props.data?.metricQueryData || {}}
                onDataChanged={(data: MetricQueryData) => {
                  props.onBlur?.();
                  props.onFocus?.();
                  if (props.onChange) {
                    const selectedMetricName: string | undefined =
                      data.filterData?.metricName?.toString();
                    const previousMetricName: string | undefined =
                      props.data?.metricQueryData?.filterData?.metricName?.toString();

                    // If metric changed, prefill all alias fields from MetricType and reload attributes
                    if (
                      selectedMetricName &&
                      selectedMetricName !== previousMetricName
                    ) {
                      props.onMetricNameChanged?.(selectedMetricName);
                      const metricType: MetricType | undefined =
                        props.metricTypes.find((m: MetricType) => {
                          return m.name === selectedMetricName;
                        });

                      if (metricType) {
                        const currentAlias: MetricAliasData =
                          props.data.metricAliasData || defaultAliasData;

                        props.onChange({
                          ...props.data,
                          metricQueryData: data,
                          metricAliasData: {
                            ...currentAlias,
                            title: metricType.name || "",
                            description: metricType.description || "",
                            legend: metricType.name || "",
                            legendUnit: metricType.unit || "",
                          },
                        });
                        return;
                      }
                    }

                    props.onChange({ ...props.data, metricQueryData: data });
                  }
                }}
                metricTypes={props.metricTypes}
                telemetryAttributes={props.telemetryAttributes}
                telemetryAttributeValueSuggestions={
                  props.telemetryAttributeValueSuggestions
                }
                onAttributeKeySelected={props.onAttributeKeySelected}
                onAdvancedFiltersToggle={props.onAdvancedFiltersToggle}
                isAttributesLoading={props.attributesLoading}
                attributesError={props.attributesError}
                onAttributesRetry={props.onAttributesRetry}
              />
            )}

            {/* Attribute filter chips */}
            {getAttributeChips()}

            {/* Display Settings - collapsible */}
            <div className="border-t border-gray-200 pt-3">
              <button
                type="button"
                className="flex items-center gap-2 text-xs font-medium text-gray-500 uppercase tracking-wide hover:text-gray-700 transition-colors w-full"
                onClick={() => {
                  setShowDisplaySettings(!showDisplaySettings);
                }}
              >
                <Icon
                  icon={
                    showDisplaySettings
                      ? IconProp.ChevronDown
                      : IconProp.ChevronRight
                  }
                  className="h-3 w-3"
                />
                <span>Display Settings</span>
                {(props.data?.metricAliasData?.title ||
                  props.data?.warningThreshold !== undefined ||
                  props.data?.criticalThreshold !== undefined) && (
                  <span className="inline-flex h-1.5 w-1.5 rounded-full bg-indigo-400" />
                )}
              </button>

              {showDisplaySettings && (
                <div className="mt-3 space-y-4">
                  <MetricAlias
                    data={props.data?.metricAliasData || defaultAliasData}
                    onDataChanged={(data: MetricAliasData) => {
                      props.onBlur?.();
                      props.onFocus?.();
                      if (props.onChange) {
                        props.onChange({
                          ...props.data,
                          metricAliasData: data,
                        });
                      }
                    }}
                    isFormula={false}
                    hideVariableBadge={true}
                  />

                  {/* Thresholds */}
                  <div className="flex space-x-3">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        Warning Threshold
                      </label>
                      <Input
                        value={props.data?.warningThreshold?.toString() || ""}
                        type={InputType.NUMBER}
                        onChange={(value: string) => {
                          props.onBlur?.();
                          props.onFocus?.();
                          if (props.onChange) {
                            props.onChange({
                              ...props.data,
                              warningThreshold: value
                                ? Number(value)
                                : undefined,
                            });
                          }
                        }}
                        placeholder="e.g. 80"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        Critical Threshold
                      </label>
                      <Input
                        value={props.data?.criticalThreshold?.toString() || ""}
                        type={InputType.NUMBER}
                        onChange={(value: string) => {
                          props.onBlur?.();
                          props.onFocus?.();
                          if (props.onChange) {
                            props.onChange({
                              ...props.data,
                              criticalThreshold: value
                                ? Number(value)
                                : undefined,
                            });
                          }
                        }}
                        placeholder="e.g. 95"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {props.error && (
          <p data-testid="error-message" className="mt-3 text-sm text-red-400">
            {props.error}
          </p>
        )}
      </div>
    );
  };

  if (props.hideCard) {
    return getContent();
  }

  return (
    <Card>
      <div className="-mt-5" tabIndex={props.tabIndex}>
        {getContent()}
      </div>
    </Card>
  );
};

export default MetricGraphConfig;
