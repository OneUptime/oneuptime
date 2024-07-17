import React, { FunctionComponent, ReactElement } from "react";
import MetricAlias, { MetricAliasData } from "./MetricAlias";
import MetricFormula, { MetricFormulaData } from "./MetricFormula";
import BadDataException from "Common/Types/Exception/BadDataException";
import Card from "CommonUI/src/Components/Card/Card";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "CommonUI/src/Components/Button/Button";

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
    <Card
      buttons={[
        {
          title: "Remove",
          icon: IconProp.Close,
          buttonStyle: ButtonStyleType.ICON,
          onClick: () => {
            props.onRemove();
          },
        },
      ]}
    >
      <div>
        <MetricAlias
          data={props.data.metricAliasData}
          onDataChanged={(data: MetricAliasData) => {
            props.onDataChanged({ ...props.data, metricAliasData: data });
          }}
        />
        {props.data.metricFormulaData && (
          <MetricFormula
            data={props.data.metricFormulaData}
            onDataChanged={(data: MetricFormulaData) => {
              props.onDataChanged({ ...props.data, metricFormulaData: data });
            }}
          />
        )}
      </div>
    </Card>
  );
};

export default MetricGraphConfig;
