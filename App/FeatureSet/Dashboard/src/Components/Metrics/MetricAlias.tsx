import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Input from "Common/UI/Components/Input/Input";
import Icon, { ThickProp } from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import MetricAliasData from "Common/Types/Metrics/MetricAliasData";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import MetricUnitUtil, { UnitOption } from "Common/Utils/MetricUnitUtil";

export interface ComponentProps {
  data: MetricAliasData;
  isFormula: boolean;
  onDataChanged: (data: MetricAliasData) => void;
  hideVariableBadge?: boolean | undefined;
  /**
   * Native unit of the underlying metric (for queries) or the inferred
   * unit family of the first referenced metric (for formulas). When this
   * belongs to a known unit family (bytes/time/bits/%), the Unit field
   * becomes a dropdown of compatible units; otherwise it falls back to a
   * free-text input so uncommon units can still be labeled.
   */
  unitFamilyBasedOn?: string | undefined;
}

const MetricAlias: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const unitOptions: Array<UnitOption> = MetricUnitUtil.getCompatibleUnits(
    props.unitFamilyBasedOn,
  );

  const hasUnitFamily: boolean = MetricUnitUtil.hasCompatibleUnitFamily(
    props.unitFamilyBasedOn,
  );

  const canonicalCurrentUnit: string | undefined =
    MetricUnitUtil.getCanonicalUnitValue(props.data.legendUnit) ||
    props.data.legendUnit ||
    undefined;

  const selectedUnitOption: DropdownOption | undefined = unitOptions
    .map((o: UnitOption): DropdownOption => {
      return { value: o.value, label: o.label };
    })
    .find((o: DropdownOption) => {
      return o.value === canonicalCurrentUnit;
    });

  return (
    <Fragment>
      <div className="space-y-3">
        {/* Variable badge row — hidden when parent already shows it */}
        {!props.hideVariableBadge &&
          ((!props.isFormula && props.data.metricVariable) ||
            props.isFormula) && (
            <div className="flex items-center space-x-2">
              {props.data.metricVariable ? (
                <div className="bg-indigo-500 h-7 w-7 min-w-7 rounded flex items-center justify-center text-xs font-semibold text-white">
                  {props.data.metricVariable}
                </div>
              ) : (
                props.isFormula && (
                  <div className="bg-indigo-500 h-7 w-7 min-w-7 rounded flex items-center justify-center text-white">
                    <Icon
                      thick={ThickProp.Thick}
                      icon={IconProp.ChevronRight}
                    />
                  </div>
                )
              )}
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                {props.isFormula ? "Formula" : "Display Settings"}
              </span>
            </div>
          )}

        {/* Title and Description */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Title
            </label>
            <Input
              value={props.data.title}
              onChange={(value: string) => {
                return props.onDataChanged({
                  ...props.data,
                  metricVariable: props.data.metricVariable,
                  title: value,
                });
              }}
              placeholder="Chart title..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Description
            </label>
            <Input
              value={props.data.description}
              onChange={(value: string) => {
                return props.onDataChanged({
                  ...props.data,
                  metricVariable: props.data.metricVariable,
                  description: value,
                });
              }}
              placeholder="Chart description..."
            />
          </div>
        </div>

        {/* Legend and Unit */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Legend
            </label>
            <Input
              value={props.data.legend}
              onChange={(value: string) => {
                return props.onDataChanged({
                  ...props.data,
                  metricVariable: props.data.metricVariable,
                  legend: value,
                });
              }}
              placeholder="e.g. Response Time"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Unit
            </label>
            {hasUnitFamily && unitOptions.length > 0 ? (
              <Dropdown
                value={selectedUnitOption}
                options={unitOptions.map((o: UnitOption): DropdownOption => {
                  return { value: o.value, label: o.label };
                })}
                placeholder="Select unit"
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  return props.onDataChanged({
                    ...props.data,
                    metricVariable: props.data.metricVariable,
                    legendUnit: value ? value.toString() : "",
                  });
                }}
              />
            ) : (
              <Input
                value={props.data.legendUnit}
                onChange={(value: string) => {
                  return props.onDataChanged({
                    ...props.data,
                    metricVariable: props.data.metricVariable,
                    legendUnit: value,
                  });
                }}
                placeholder="e.g. bytes, ms, %"
              />
            )}
          </div>
        </div>
      </div>
    </Fragment>
  );
};

export default MetricAlias;
