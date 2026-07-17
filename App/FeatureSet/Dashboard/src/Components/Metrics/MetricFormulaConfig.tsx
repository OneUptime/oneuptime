import React, { FunctionComponent, ReactElement, useState } from "react";
import MetricAlias from "./MetricAlias";
import MetricFormula from "./MetricFormula";
import SeriesColorSelector from "./SeriesColorSelector";
import BadDataException from "Common/Types/Exception/BadDataException";
import Card from "Common/UI/Components/Card/Card";
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

  const formulaExpression: string =
    props.data.metricFormulaData?.metricFormula || "";
  const formulaTitle: string =
    props.data.metricAliasData?.title ||
    props.data.metricAliasData?.legend ||
    formulaExpression ||
    "New formula";

  const content: ReactElement = (
    <div>
      {/* Header — matches the query-card look (badge, title line, actions) */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {props.data.metricAliasData?.metricVariable && (
            <div className="flex h-6 w-6 min-w-6 items-center justify-center rounded-md border border-violet-200 bg-violet-50 text-xs font-bold text-violet-700">
              {props.data.metricAliasData.metricVariable}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-gray-900 truncate">
                {formulaTitle}
              </span>
              <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                Formula
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 ml-3">
          <button
            type="button"
            aria-label="Remove formula"
            className="inline-flex items-center justify-center h-7 w-7 rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            onClick={() => {
              return props.onRemove();
            }}
            title="Remove formula"
          >
            <Icon icon={IconProp.Trash} className="h-4 w-4" />
          </button>
        </div>
      </div>

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
          aria-expanded={showDisplaySettings}
          className="flex w-full items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 transition-colors hover:text-gray-600"
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
          <span>Display Settings</span>
          {(props.data?.metricAliasData?.title ||
            props.data?.color ||
            props.data?.warningThreshold !== undefined ||
            props.data?.criticalThreshold !== undefined) && (
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-indigo-400" />
          )}
        </button>

        {showDisplaySettings && (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <MetricAlias
                data={props.data.metricAliasData}
                onDataChanged={(data: MetricAliasData) => {
                  props.onDataChanged({ ...props.data, metricAliasData: data });
                }}
                isFormula={true}
                hideVariableBadge={true}
                unitFamilyBasedOn={props.unitFamilyBasedOn}
              />
            </div>
            <SeriesColorSelector
              value={props.data?.color}
              onChange={(color: string | undefined) => {
                props.onDataChanged({
                  ...props.data,
                  color: color,
                });
              }}
            />
            <div>
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
            <div>
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
