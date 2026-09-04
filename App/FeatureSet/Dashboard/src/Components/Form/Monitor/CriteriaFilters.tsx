import CriteriaFilterElement from "./CriteriaFilter";
import CriteriaFilterUtil from "../../../Utils/Form/Monitor/CriteriaFilter";
import IconProp from "Common/Types/Icon/IconProp";
import { CriteriaFilter } from "Common/Types/Monitor/CriteriaFilter";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  value: Array<CriteriaFilter> | undefined;
  onChange?: undefined | ((value: Array<CriteriaFilter>) => void);
  monitorType: MonitorType;
  monitorStep: MonitorStep;
  filterCondition?: FilterCondition;
}

const CriteriaFilters: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const criteriaFilters: Array<CriteriaFilter> = props.value || [];
  const matchAll: boolean = props.filterCondition !== FilterCondition.Any;

  return (
    <div className="space-y-3">
      {criteriaFilters.map((filter: CriteriaFilter, index: number) => {
        return (
          <div key={index}>
            {index > 0 && (
              <div className="mb-3 flex items-center gap-3" aria-hidden="true">
                <span className="h-px flex-1 bg-gray-200" />
                <span
                  className={`text-xs font-semibold ${matchAll ? "text-indigo-600" : "text-amber-700"}`}
                >
                  {matchAll ? "AND" : "OR"}
                </span>
                <span className="h-px flex-1 bg-gray-200" />
              </div>
            )}
            <CriteriaFilterElement
              monitorType={props.monitorType}
              value={filter}
              monitorStep={props.monitorStep}
              conditionIndex={index}
              disableDelete={criteriaFilters.length === 1}
              onDelete={() => {
                if (criteriaFilters.length <= 1) {
                  return;
                }
                props.onChange?.(
                  criteriaFilters.filter(
                    (_: CriteriaFilter, filterIndex: number) => {
                      return filterIndex !== index;
                    },
                  ),
                );
              }}
              onChange={(value: CriteriaFilter) => {
                const updated: Array<CriteriaFilter> = [...criteriaFilters];
                updated[index] = value;
                props.onChange?.(updated);
              }}
            />
          </div>
        );
      })}
      <Button
        title="Add condition"
        buttonStyle={ButtonStyleType.SECONDARY_LINK}
        buttonSize={ButtonSize.Small}
        icon={IconProp.Add}
        onClick={() => {
          props.onChange?.([
            ...criteriaFilters,
            CriteriaFilterUtil.getDefaultCriteriaFilter(props.monitorType),
          ]);
        }}
      />
    </div>
  );
};

export default CriteriaFilters;
