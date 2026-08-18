import CriteriaFilterElement from "./CriteriaFilter";
import CriteriaFilterUiUtil from "../../../Utils/Form/Monitor/CriteriaFilter";
import IconProp from "Common/Types/Icon/IconProp";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
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
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
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
          title={
            props.monitorType === MonitorType.Kubernetes ||
            props.monitorType === MonitorType.Docker ||
            props.monitorType === MonitorType.Host ||
            props.monitorType === MonitorType.Podman ||
            props.monitorType === MonitorType.DockerSwarm ||
            props.monitorType === MonitorType.Proxmox ||
            props.monitorType === MonitorType.Ceph ||
            props.monitorType === MonitorType.Metrics
              ? "Add Rule"
              : "Add Filter"
          }
          buttonSize={ButtonSize.Small}
          icon={IconProp.Add}
          onClick={() => {
            const newCriteriaFilters: Array<CriteriaFilter> = [
              ...criteriaFilters,
            ];

            const isMetricOnly: boolean =
              props.monitorType === MonitorType.Kubernetes ||
              props.monitorType === MonitorType.Metrics;

            /*
             * Seed with a check this monitor type actually supports. This used
             * to hard-code CheckOn.IsOnline with FilterType.EqualTo for every
             * non-metric type. On SSL Certificate and DNSSEC neither value was
             * in the type's dropdown, so both selects rendered blank over a
             * live value - a user who touched only the second select ended up
             * saving a filter they never knowingly chose, and on DNSSEC no
             * evaluator read it at all, so the criteria could never fire.
             *
             * filterType is intentionally left undefined rather than
             * defaulted: EqualTo is invalid for most boolean checks, and an
             * empty required select is a visible prompt where a wrong
             * prefilled one is not.
             */
            const checkOnOptions: Array<DropdownOption> =
              CriteriaFilterUiUtil.getCheckOnOptionsByMonitorType(
                props.monitorType,
              );

            newCriteriaFilters.push(
              isMetricOnly
                ? {
                    checkOn: CheckOn.MetricValue,
                    filterType: FilterType.GreaterThan,
                    value: "",
                    metricMonitorOptions: {
                      metricAggregationType: EvaluateOverTimeType.AnyValue,
                    },
                  }
                : {
                    checkOn:
                      (checkOnOptions[0]?.value as CheckOn) || CheckOn.IsOnline,
                    filterType: undefined,
                    value: "",
                  },
            );

            props.onChange?.(newCriteriaFilters);
          }}
        />
      </div>
      {showCantDeleteModal ? (
        <ConfirmModal
          description={
            props.monitorType === MonitorType.Kubernetes ||
            props.monitorType === MonitorType.Docker ||
            props.monitorType === MonitorType.Host ||
            props.monitorType === MonitorType.Podman ||
            props.monitorType === MonitorType.DockerSwarm ||
            props.monitorType === MonitorType.Proxmox ||
            props.monitorType === MonitorType.Ceph ||
            props.monitorType === MonitorType.Metrics
              ? `At least one alert rule is required. If you don't need rules, you can delete the entire criteria instead.`
              : `We need at least one filter for this criteria. We cant delete one remaining filter. If you don't need filters, please feel free to delete criteria instead.`
          }
          title={
            props.monitorType === MonitorType.Kubernetes ||
            props.monitorType === MonitorType.Docker ||
            props.monitorType === MonitorType.Host ||
            props.monitorType === MonitorType.Podman ||
            props.monitorType === MonitorType.DockerSwarm ||
            props.monitorType === MonitorType.Proxmox ||
            props.monitorType === MonitorType.Ceph ||
            props.monitorType === MonitorType.Metrics
              ? `Cannot delete last remaining rule.`
              : `Cannot delete last remaining filter.`
          }
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
