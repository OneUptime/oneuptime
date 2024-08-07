import React, { FunctionComponent, ReactElement } from "react";
import MetricAlias, { MetricAliasData } from "./MetricAlias";
import MetricFormula, { MetricFormulaData } from "./MetricFormula";
import BadDataException from "Common/Types/Exception/BadDataException";
import Card from "Common/UI/Components/Card/Card";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";

export interface MetricFormulaConfigData {
  metricAliasData: MetricAliasData;
  metricFormulaData: MetricFormulaData;
}

export interface ComponentProps {
  data: MetricFormulaConfigData;
  onDataChanged: (data: MetricFormulaConfigData) => void;
  onRemove: () => void;
}

const MetricGraphConfig: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.data.metricAliasData) {
    throw new BadDataException("MetricAlias is required");
  }

  if (!props.data.metricFormulaData) {
    throw new BadDataException("Either MetricQuery is required");
  }

  return (
    <Card>
      <div className="-mt-5 mb-2">
        <MetricAlias
          data={props.data.metricAliasData}
          onDataChanged={(data: MetricAliasData) => {
            props.onDataChanged({ ...props.data, metricAliasData: data });
          }}
          isFormula={true}
        />
        {props.data.metricFormulaData && (
          <MetricFormula
            data={props.data.metricFormulaData}
            onDataChanged={(data: MetricFormulaData) => {
              props.onDataChanged({ ...props.data, metricFormulaData: data });
            }}
          />
        )}
        <div className="-ml-3 mt-5 -mb-2">
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
