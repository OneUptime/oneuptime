import MonitorCriteriaInstanceElement from "./MonitorCriteriaInstance";
import { IncidentRoleOption } from "./MonitorCriteriaIncidentForm";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  value: MonitorCriteria | undefined;
  onChange?: undefined | ((value: MonitorCriteria) => void);
  monitorStatusDropdownOptions: Array<DropdownOption>;
  incidentSeverityDropdownOptions: Array<DropdownOption>;
  alertSeverityDropdownOptions: Array<DropdownOption>;
  onCallPolicyDropdownOptions: Array<DropdownOption>;
  labelDropdownOptions: Array<DropdownOption>;
  teamDropdownOptions: Array<DropdownOption>;
  userDropdownOptions: Array<DropdownOption>;
  incidentRoleOptions?: Array<IncidentRoleOption> | undefined;
  monitorType: MonitorType;
  monitorStep: MonitorStep;
}

interface CriteriaCollapsedState {
  [key: string]: boolean;
}

const MonitorCriteriaElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showCantDeleteModal, setShowCantDeleteModal] =
    React.useState<boolean>(false);

  const monitorCriteria: MonitorCriteria = props.value || new MonitorCriteria();

  // Track collapsed state for each criteria instance
  const [collapsedState, setCollapsedState] = useState<CriteriaCollapsedState>(
    {},
  );

  const toggleCriteriaCollapsed: (id: string) => void = (id: string): void => {
    setCollapsedState((prev: CriteriaCollapsedState) => {
      return {
        ...prev,
        [id]: !prev[id],
      };
    });
  };

  const getCriteriaSummary: (instance: MonitorCriteriaInstance) => string = (
    instance: MonitorCriteriaInstance,
  ): string => {
    const parts: Array<string> = [];

    // Filter count
    const filterCount: number = instance.data?.filters?.length || 0;
    const filterCondition: FilterCondition =
      instance.data?.filterCondition || FilterCondition.All;
    parts.push(
      `${filterCount} filter${filterCount !== 1 ? "s" : ""}${filterCount > 1 ? ` (${filterCondition === FilterCondition.All ? "ALL" : "ANY"})` : ""}`,
    );

    // Actions
    const actions: Array<string> = [];
    if (instance.data?.monitorStatusId) {
      actions.push("status change");
    }
    if (instance.data?.createAlerts) {
      actions.push("alerts");
    }
    if (instance.data?.createIncidents) {
      actions.push("incidents");
    }

    if (actions.length > 0) {
      parts.push(actions.join(", "));
    }

    return parts.join(" | ");
  };

  const getCriteriaHeaderColor: (
    instance: MonitorCriteriaInstance,
  ) => string = (instance: MonitorCriteriaInstance): string => {
    const name: string = instance.data?.name?.toLowerCase() || "";

    if (
      name.includes("online") ||
      name.includes("success") ||
      name.includes("healthy")
    ) {
      return "border-l-green-500";
    }
    if (
      name.includes("offline") ||
      name.includes("error") ||
      name.includes("down")
    ) {
      return "border-l-red-500";
    }
    if (
      name.includes("degraded") ||
      name.includes("warning") ||
      name.includes("slow")
    ) {
      return "border-l-yellow-500";
    }
    return "border-l-blue-500";
  };

  return (
    <div className="mt-4">
      {monitorCriteria.data?.monitorCriteriaInstanceArray.map(
        (i: MonitorCriteriaInstance, index: number) => {
          const criteriaId: string = i.data?.id || `criteria-${index}`;
          const isCollapsed: boolean = collapsedState[criteriaId] || false;
          const criteriaName: string = i.data?.name || "Unnamed Criteria";

          return (
            <div
              className={`mb-4 border rounded-lg overflow-hidden border-l-4 ${getCriteriaHeaderColor(i)}`}
              key={criteriaId}
            >
              {/* Collapsible Header */}
              <div
                className="flex items-center justify-between px-4 py-3 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
                onClick={() => {
                  toggleCriteriaCollapsed(criteriaId);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e: React.KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleCriteriaCollapsed(criteriaId);
                  }
                }}
                aria-expanded={!isCollapsed}
              >
                <div className="flex items-center flex-1 min-w-0">
                  <Icon
                    icon={
                      isCollapsed ? IconProp.ChevronRight : IconProp.ChevronDown
                    }
                    className="w-4 h-4 text-gray-500 mr-2 flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center flex-wrap gap-2">
                      <span className="text-sm font-semibold text-gray-900">
                        {criteriaName}
                      </span>
                      {isCollapsed && (
                        <span className="text-xs text-gray-500 truncate">
                          {getCriteriaSummary(i)}
                        </span>
                      )}
                    </div>
                    {!isCollapsed && i.data?.description && (
                      <p className="text-xs text-gray-500 mt-0.5 truncate">
                        {i.data.description}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center ml-2">
                  <span className="text-xs text-gray-400 mr-2">
                    {index + 1} of{" "}
                    {monitorCriteria.data?.monitorCriteriaInstanceArray.length}
                  </span>
                </div>
              </div>

              {/* Collapsible Content */}
              <div
                className={`transition-all duration-200 ease-in-out overflow-hidden ${
                  isCollapsed ? "max-h-0" : "max-h-[5000px]"
                }`}
              >
                <div className="px-4 pb-4 bg-white">
                  <MonitorCriteriaInstanceElement
                    monitorType={props.monitorType}
                    monitorStep={props.monitorStep}
                    monitorStatusDropdownOptions={
                      props.monitorStatusDropdownOptions
                    }
                    incidentSeverityDropdownOptions={
                      props.incidentSeverityDropdownOptions
                    }
                    alertSeverityDropdownOptions={
                      props.alertSeverityDropdownOptions
                    }
                    onCallPolicyDropdownOptions={
                      props.onCallPolicyDropdownOptions
                    }
                    labelDropdownOptions={props.labelDropdownOptions}
                    teamDropdownOptions={props.teamDropdownOptions}
                    userDropdownOptions={props.userDropdownOptions}
                    incidentRoleOptions={props.incidentRoleOptions}
                    value={i}
                    onDelete={() => {
                      if (
                        monitorCriteria.data?.monitorCriteriaInstanceArray
                          .length === 1
                      ) {
                        setShowCantDeleteModal(true);
                        return;
                      }

                      // remove the criteria filter
                      const criteriaIndex: number | undefined =
                        monitorCriteria.data?.monitorCriteriaInstanceArray.findIndex(
                          (item: MonitorCriteriaInstance) => {
                            return item.data?.id === i.data?.id;
                          },
                        );

                      if (criteriaIndex === undefined) {
                        return;
                      }

                      const newMonitorCriterias: Array<MonitorCriteriaInstance> =
                        [
                          ...(monitorCriteria.data
                            ?.monitorCriteriaInstanceArray || []),
                        ];
                      newMonitorCriterias.splice(criteriaIndex, 1);
                      props.onChange?.(
                        MonitorCriteria.fromJSON({
                          _type: "MonitorCriteria",
                          value: {
                            monitorCriteriaInstanceArray: [
                              ...newMonitorCriterias,
                            ],
                          },
                        }),
                      );
                    }}
                    onChange={(value: MonitorCriteriaInstance) => {
                      const criteriaIndex: number | undefined =
                        monitorCriteria.data?.monitorCriteriaInstanceArray.findIndex(
                          (item: MonitorCriteriaInstance) => {
                            return item.data?.id === value.data?.id;
                          },
                        );

                      if (criteriaIndex === undefined) {
                        return;
                      }
                      const newMonitorCriterias: Array<MonitorCriteriaInstance> =
                        [
                          ...(monitorCriteria.data
                            ?.monitorCriteriaInstanceArray || []),
                        ];
                      newMonitorCriterias[criteriaIndex] = value;
                      props.onChange?.(
                        MonitorCriteria.fromJSON({
                          _type: "MonitorCriteria",
                          value: {
                            monitorCriteriaInstanceArray: newMonitorCriterias,
                          },
                        }),
                      );
                    }}
                  />
                </div>
              </div>
            </div>
          );
        },
      )}
      <div className="mt-4 -ml-3">
        <Button
          title="Add Criteria"
          buttonSize={ButtonSize.Small}
          icon={IconProp.Add}
          onClick={() => {
            const newMonitorCriterias: Array<MonitorCriteriaInstance> = [
              ...(monitorCriteria.data?.monitorCriteriaInstanceArray || []),
            ];
            newMonitorCriterias.push(new MonitorCriteriaInstance());
            props.onChange?.(
              MonitorCriteria.fromJSON({
                _type: "MonitorCriteria",
                value: {
                  monitorCriteriaInstanceArray: newMonitorCriterias,
                },
              }),
            );
          }}
        />
      </div>
      {showCantDeleteModal ? (
        <ConfirmModal
          description={`We need at least one criteria for this monitor. We cant delete one remaining criteria.`}
          title={`Cannot delete last remaining criteria.`}
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

export default MonitorCriteriaElement;
