import React, { FunctionComponent, ReactElement, useState } from "react";
import MetricAlias from "./MetricAlias";
import MetricFormula from "./MetricFormula";
import BadDataException from "Common/Types/Exception/BadDataException";
import Card from "Common/UI/Components/Card/Card";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricAliasData from "Common/Types/Metrics/MetricAliasData";
import MetricFormulaData from "Common/Types/Metrics/MetricFormulaData";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

export interface ComponentProps {
  data: MetricFormulaConfigData;
  onDataChanged: (data: MetricFormulaConfigData) => void;
  onRemove: () => void;
  availableVariables?: Array<string>;
  hideCard?: boolean | undefined;
  /**
   * Unit to seed the "Unit" dropdown with when this formula's inputs
   * share a known unit family (e.g. time). Lets a formula like `$a + $b`
   * — where both operands are in seconds — offer ms/sec/min/hours as
   * display options. Falls back to a free-text input when the inputs
   * don't share a recognized family.
   */
  unitFamilyBasedOn?: string | undefined;
}

const MetricFormulaConfigComponent: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.data.metricAliasData) {
    throw new BadDataException("MetricAlias is required");
  }

  if (!props.data.metricFormulaData) {
    throw new BadDataException("Either MetricQuery is required");
  }

  const [showDisplaySettings, setShowDisplaySettings] =
    useState<boolean>(false);

  const content: ReactElement = (
    <div>
      <MetricAlias
        data={props.data.metricAliasData}
        onDataChanged={(data: MetricAliasData) => {
          props.onDataChanged({ ...props.data, metricAliasData: data });
        }}
        isFormula={true}
        unitFamilyBasedOn={props.unitFamilyBasedOn}
      />
      {props.data.metricFormulaData && (
        <MetricFormula
          data={props.data.metricFormulaData}
          onDataChanged={(data: MetricFormulaData) => {
            props.onDataChanged({ ...props.data, metricFormulaData: data });
          }}
          availableVariables={props.availableVariables}
        />
      )}

      <div className="border-t border-gray-200 pt-3 mt-4">
        <button
          type="button"
          className="flex items-center gap-2 text-xs font-medium text-gray-500 uppercase tracking-wide hover:text-gray-700 transition-colors w-full"
          onClick={() => {
            setShowDisplaySettings(!showDisplaySettings);
          }}
        >
          <Icon
            icon={
              showDisplaySettings ? IconProp.ChevronDown : IconProp.ChevronRight
            }
            className="h-3 w-3"
          />
          <span>Thresholds</span>
          {(props.data?.warningThreshold !== undefined ||
            props.data?.criticalThreshold !== undefined) && (
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-indigo-400" />
          )}
        </button>

        {showDisplaySettings && (
          <div className="flex space-x-3 mt-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Warning Threshold
              </label>
              <Input
                value={props.data?.warningThreshold?.toString() || ""}
                type={InputType.NUMBER}
                onChange={(value: string) => {
                  props.onDataChanged({
                    ...props.data,
                    warningThreshold: value ? Number(value) : undefined,
                  });
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
                  props.onDataChanged({
                    ...props.data,
                    criticalThreshold: value ? Number(value) : undefined,
                  });
                }}
                placeholder="e.g. 95"
              />
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 pt-3 border-t border-gray-100 flex justify-end">
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
  );

  if (props.hideCard) {
    return content;
  }

  return (
    <Card>
      <div className="-mt-5 mb-2">{content}</div>
    </Card>
  );
};

export default MetricFormulaConfigComponent;
