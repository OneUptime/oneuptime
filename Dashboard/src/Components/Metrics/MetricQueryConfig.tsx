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
}

const MetricGraphConfig: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const getContent: GetReactElementFunction = (): ReactElement => {
    return (
      <div>
        {props.data?.metricAliasData && (
          <MetricAlias
            data={props.data?.metricAliasData || {}}
            onDataChanged={(data: MetricAliasData) => {
              props.onBlur?.();
              props.onFocus?.();
              if (props.onChange) {
                props.onChange({ ...props.data, metricAliasData: data });
              }
            }}
            isFormula={false}
          />
        )}
        {props.data?.metricQueryData && (
          <MetricQuery
            data={props.data?.metricQueryData || {}}
            onDataChanged={(data: MetricQueryData) => {
              props.onBlur?.();
              props.onFocus?.();
              if (props.onChange) {
                props.onChange({ ...props.data, metricQueryData: data });
              }
            }}
            metricTypes={props.metricTypes}
            telemetryAttributes={props.telemetryAttributes}
          />
        )}
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
