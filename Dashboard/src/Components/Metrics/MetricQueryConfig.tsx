import React, { FunctionComponent, ReactElement } from "react";
import MetricAlias from "./MetricAlias";
import MetricQuery from "./MetricQuery";
import BadDataException from "Common/Types/Exception/BadDataException";
import Card from "Common/UI/Components/Card/Card";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import MetricNameAndUnit from "./Types/MetricNameAndUnit";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricAliasData from "Common/Types/Metrics/MetricAliasData";
import MetricQueryData from "Common/Types/Metrics/MetricQueryData";

export interface ComponentProps {
  data: MetricQueryConfigData;
  onChange?: ((data: MetricQueryConfigData) => void) | undefined;
  metricNameAndUnits: Array<MetricNameAndUnit>;
  telemetryAttributes: string[];
  onRemove?: (() => void) | undefined;
  error?: string | undefined;
  onFocus?: (() => void) | undefined;
  onBlur?: (() => void) | undefined;
  tabIndex?: number | undefined;
}

const MetricGraphConfig: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.data.metricAliasData) {
    throw new BadDataException("MetricAlias is required");
  }

  if (!props.data.metricQueryData) {
    throw new BadDataException("Either MetricQuery is required");
  }

  return (
    <Card>
      <div className="-mt-5" tabIndex={props.tabIndex}>
        <MetricAlias
          data={props.data.metricAliasData}
          onDataChanged={(data: MetricAliasData) => {
            props.onBlur?.();
            props.onFocus?.();
            props.onChange &&
              props.onChange({ ...props.data, metricAliasData: data });
          }}
          isFormula={false}
        />
        {props.data.metricQueryData && (
          <MetricQuery
            data={props.data.metricQueryData}
            onDataChanged={(data: MetricQueryData) => {
              props.onBlur?.();
              props.onFocus?.();
              props.onChange &&
                props.onChange({ ...props.data, metricQueryData: data });
            }}
            metricNameAndUnits={props.metricNameAndUnits}
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
                return props.onRemove && props.onRemove();
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
    </Card>
  );
};

export default MetricGraphConfig;
