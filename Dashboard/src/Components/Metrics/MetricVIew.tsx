import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import MetricQueryConfig, { MetricQueryConfigData } from "./MetricQueryConfig";
import MetricGraphConfig, {
  MetricFormulaConfigData,
} from "./MetricFormulaConfig";
import Button, { ButtonSize } from "CommonUI/src/Components/Button/Button";
import Text from "Common/Types/Text";
import HorizontalRule from "CommonUI/src/Components/HorizontalRule/HorizontalRule";

export interface MetricViewData {
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData>;
}

export interface ComponentProps {
  data: MetricViewData;
}

const MetricView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [currentQueryVariable, setCurrentQueryVariable] = useState<string>(
    Text.getLetterFromAByNumber(props.data.queryConfigs.length),
  );

  type GetEmptyQueryConfigFunction = () => MetricQueryConfigData;

  const getEmptyQueryConfigData: GetEmptyQueryConfigFunction =
    (): MetricQueryConfigData => {
      const currentVar: string = currentQueryVariable;
      setCurrentQueryVariable(Text.getNextLowercaseLetter(currentVar));

      return {
        metricAliasData: { metricVariable: currentVar, title: "", description: "" },
        metricQueryData: {
          filterData: {},
        },
      };
    };

  const [queryConfigs, setQueryConfigs] = useState<
    Array<MetricQueryConfigData>
  >(props.data.queryConfigs || [getEmptyQueryConfigData()]);

  const [formulaConfigs, setFormulaConfigs] = useState<
    Array<MetricFormulaConfigData>
  >(props.data.formulaConfigs);

  type GetEmptyFormulaConfigFunction = () => MetricFormulaConfigData;

  const getEmptyFormulaConfigData: GetEmptyFormulaConfigFunction =
    (): MetricFormulaConfigData => {
      return {
        metricAliasData: { metricVariable: "", title: "", description: "" },
        metricFormulaData: {
          metricFormula: "",
        },
      };
    };

  return (
    <Fragment>
      <div className="space-y-3">
        {queryConfigs.map(
          (queryConfig: MetricQueryConfigData, index: number) => {
            return (
              <MetricQueryConfig
                key={index}
                onDataChanged={(data: MetricQueryConfigData) => {
                  const newGraphConfigs: Array<MetricQueryConfigData> = [
                    ...queryConfigs,
                  ];
                  newGraphConfigs[index] = data;
                  setQueryConfigs(newGraphConfigs);
                }}
                data={queryConfig}
                onRemove={() => {
                  const newGraphConfigs: Array<MetricQueryConfigData> = [
                    ...queryConfigs,
                  ];
                  newGraphConfigs.splice(index, 1);
                  setQueryConfigs(newGraphConfigs);
                }}
              />
            );
          },
        )}
      </div>
      <div className="space-y-3">
        {formulaConfigs.map(
          (formulaConfig: MetricFormulaConfigData, index: number) => {
            return (
              <MetricGraphConfig
                key={index}
                onDataChanged={(data: MetricFormulaConfigData) => {
                  const newGraphConfigs: Array<MetricFormulaConfigData> = [
                    ...formulaConfigs,
                  ];
                  newGraphConfigs[index] = data;
                  setFormulaConfigs(newGraphConfigs);
                }}
                data={formulaConfig}
                onRemove={() => {
                  const newGraphConfigs: Array<MetricFormulaConfigData> = [
                    ...formulaConfigs,
                  ];
                  newGraphConfigs.splice(index, 1);
                  setFormulaConfigs(newGraphConfigs);
                }}
              />
            );
          },
        )}
      </div>
      <div>
        <div className="flex -ml-3">
          <Button
            title="Add Query"
            buttonSize={ButtonSize.Small}
            onClick={() => {
              setQueryConfigs([...queryConfigs, getEmptyQueryConfigData()]);
            }}
          />
          <Button
            title="Add Formula"
            buttonSize={ButtonSize.Small}
            onClick={() => {
              setFormulaConfigs([
                ...formulaConfigs,
                getEmptyFormulaConfigData(),
              ]);
            }}
          />
        </div>
      </div>
      <HorizontalRule />
    </Fragment>
  );
};

export default MetricView;
