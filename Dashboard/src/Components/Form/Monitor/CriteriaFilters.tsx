import CriteriaFilterElement from "./CriteriaFilter";
import IconProp from "Common/Types/Icon/IconProp";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
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
}

const CriteriaFilters: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showCantDeleteModal, setShowCantDeleteModal] =
    React.useState<boolean>(false);

  const criteriaFilters: Array<CriteriaFilter> = props.value || [];

  return (
    <div>
      {criteriaFilters.map((i: CriteriaFilter, index: number) => {
        return (
          <CriteriaFilterElement
            monitorType={props.monitorType}
            key={index}
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
              const index: number = criteriaFilters.indexOf(i);
              const newCriteriaFilters: Array<CriteriaFilter> = [
                ...criteriaFilters,
              ];
              newCriteriaFilters[index] = value;
              props.onChange?.(newCriteriaFilters);
            }}
          />
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
