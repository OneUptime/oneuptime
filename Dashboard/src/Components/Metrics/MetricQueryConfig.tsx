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
  onDataChanged: (data: MetricQueryConfigData) => void;
  metricNameAndUnits: Array<MetricNameAndUnit>;
  telemetryAttributes: string[];
  onRemove: () => void;
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
      <div className="-mt-5">
        <MetricAlias
          data={props.data.metricAliasData}
          onDataChanged={(data: MetricAliasData) => {
            props.onDataChanged({ ...props.data, metricAliasData: data });
          }}
          isFormula={false}
        />
        {props.data.metricQueryData && (
          <MetricQuery
            data={props.data.metricQueryData}
            onDataChanged={(data: MetricQueryData) => {
              props.onDataChanged({ ...props.data, metricQueryData: data });
            }}
            metricNameAndUnits={props.metricNameAndUnits}
            telemetryAttributes={props.telemetryAttributes}
          />
        )}
        <div className="-ml-3">
          <Button
            title={"Remove"}
            onClick={() => {
              return props.onRemove();
            }}
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.DANGER_OUTLINE}
          />
        </div>
      </div>
    </Card>
  );
};

export default MetricGraphConfig;
