import CriteriaFilterElement from "./CriteriaFilter";
import IconProp from "Common/Types/Icon/IconProp";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
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
  const [showCantDeleteModal, setShowCantDeleteModal] =
    React.useState<boolean>(false);

  const criteriaFilters: Array<CriteriaFilter> = props.value || [];
  const filterCondition: FilterCondition =
    props.filterCondition || FilterCondition.All;

  const getConnectorLabel: () => string = (): string => {
    return filterCondition === FilterCondition.All ? "AND" : "OR";
  };

  const getConnectorColorClass: () => string = (): string => {
    return filterCondition === FilterCondition.All
      ? "bg-blue-100 text-blue-700 border-blue-200"
      : "bg-amber-100 text-amber-700 border-amber-200";
  };

  return (
    <div>
      {criteriaFilters.map((i: CriteriaFilter, index: number) => {
        const isLastFilter: boolean = index === criteriaFilters.length - 1;

        return (
          <div key={index} className="relative">
            <CriteriaFilterElement
              monitorType={props.monitorType}
              value={i}
              monitorStep={props.monitorStep}
              onDelete={() => {
                if (criteriaFilters.length === 1) {
                  setShowCantDeleteModal(true);
                  return;
                }

                // remove the criteria filter

                const newCriteriaFilters: Array<CriteriaFilter> = [
                  ...criteriaFilters,
                ];

                // remove the criteria filter
                newCriteriaFilters.splice(index, 1);

                props.onChange?.(newCriteriaFilters);
              }}
              onChange={(value: CriteriaFilter) => {
                const filterIndex: number = criteriaFilters.indexOf(i);
                const newCriteriaFilters: Array<CriteriaFilter> = [
                  ...criteriaFilters,
                ];
                newCriteriaFilters[filterIndex] = value;
                props.onChange?.(newCriteriaFilters);
              }}
            />

            {/* Visual connector between filters */}
            {!isLastFilter && criteriaFilters.length > 1 && (
              <div className="flex items-center justify-center my-2">
                <div className="flex-1 border-t border-gray-200"></div>
                <span
                  className={`mx-3 px-3 py-1 text-xs font-semibold rounded-full border ${getConnectorColorClass()}`}
                >
                  {getConnectorLabel()}
                </span>
                <div className="flex-1 border-t border-gray-200"></div>
              </div>
            )}
          </div>
        );
      })}
      <div className="mt-3 -ml-3">
        <Button
          title="Add Filter"
          buttonSize={ButtonSize.Small}
          icon={IconProp.Add}
          onClick={() => {
            const newCriteriaFilters: Array<CriteriaFilter> = [
              ...criteriaFilters,
            ];
            newCriteriaFilters.push({
              checkOn: CheckOn.IsOnline,
              filterType: FilterType.EqualTo,
              value: "",
            });

            props.onChange?.(newCriteriaFilters);
          }}
        />
      </div>
      {showCantDeleteModal ? (
        <ConfirmModal
          description={`We need at least one filter for this criteria. We cant delete one remaining filter. If you don't need filters, please feel free to delete criteria instead.`}
          title={`Cannot delete last remaining filter.`}
          onSubmit={() => {
            setShowCantDeleteModal(false);
          }}
          submitButtonType={ButtonStyleType.NORMAL}
          submitButtonText="Close"
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default CriteriaFilters;
