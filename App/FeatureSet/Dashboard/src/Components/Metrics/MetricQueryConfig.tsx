import React, { FunctionComponent, ReactElement } from "react";
import MetricAlias from "./MetricAlias";
import MetricQuery from "./MetricQuery";
import Card from "Common/UI/Components/Card/Card";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricAliasData from "Common/Types/Metrics/MetricAliasData";
import MetricQueryData from "Common/Types/Metrics/MetricQueryData";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Input, { InputType } from "Common/UI/Components/Input/Input";

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
}

const MetricGraphConfig: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const defaultAliasData: MetricAliasData = {
    metricVariable: undefined,
    title: undefined,
    description: undefined,
    legend: undefined,
    legendUnit: undefined,
  };

  const getContent: GetReactElementFunction = (): ReactElement => {
    return (
      <div>
        <MetricAlias
          data={props.data?.metricAliasData || defaultAliasData}
          onDataChanged={(data: MetricAliasData) => {
            props.onBlur?.();
            props.onFocus?.();
            if (props.onChange) {
              props.onChange({ ...props.data, metricAliasData: data });
            }
          }}
          isFormula={false}
        />
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

                // If metric changed, prefill legend and unit from MetricType
                if (
                  selectedMetricName &&
                  selectedMetricName !== previousMetricName
                ) {
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
                        legend: currentAlias.legend || metricType.name || "",
                        legendUnit:
                          currentAlias.legendUnit || metricType.unit || "",
                        description:
                          currentAlias.description ||
                          metricType.description ||
                          "",
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
            onAdvancedFiltersToggle={props.onAdvancedFiltersToggle}
            isAttributesLoading={props.attributesLoading}
            attributesError={props.attributesError}
            onAttributesRetry={props.onAttributesRetry}
          />
        )}
        <div className="flex space-x-3 mt-3">
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
                    warningThreshold: value ? Number(value) : undefined,
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
                    criticalThreshold: value ? Number(value) : undefined,
                  });
                }
              }}
              placeholder="e.g. 95"
            />
          </div>
        </div>
        {props.onRemove && (
          <div className="-ml-3">
            <Button
              title={"Remove"}
              onClick={() => {
                props.onBlur?.();
                props.onFocus?.();
                return props.onRemove?.();
              }}
              buttonSize={ButtonSize.Small}
              buttonStyle={ButtonStyleType.DANGER_OUTLINE}
            />
          </div>
        )}
        {props.error && (
          <p data-testid="error-message" className="mt-1 text-sm text-red-400">
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
