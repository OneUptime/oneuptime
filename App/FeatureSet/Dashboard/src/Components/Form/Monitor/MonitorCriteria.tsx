import MonitorCriteriaInstanceElement from "./MonitorCriteriaInstance";
import { NetworkDeviceOidCatalogueEntry } from "./CriteriaFilter";
import { IncidentRoleOption } from "./MonitorCriteriaIncidentForm";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import CriteriaFilterUtil from "../../../Utils/Form/Monitor/CriteriaFilter";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import NetworkDeviceAlertPackUtil from "Common/Types/Monitor/SnmpMonitor/NetworkDeviceAlertPack";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import { CriteriaFilter } from "Common/Types/Monitor/CriteriaFilter";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement, useState } from "react";
import {
  DragDropContext,
  Draggable,
  DraggableProvided,
  Droppable,
  DroppableProvided,
  DropResult,
} from "react-beautiful-dnd";

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
  /*
   * For Network Device monitors: the effective health-OID list of the device
   * this step points at, and the names and aliases of the interfaces its last
   * walk found. Fetched once per step in MonitorStep and forwarded to each
   * criteria so the SNMP OID and interface pickers have real values to offer.
   *
   * isNetworkDeviceCatalogueLoaded says whether that fetch has answered for
   * the currently selected device; until it has, the pickers must not read an
   * empty catalogue as proof that a saved value is gone.
   */
  networkDeviceOidCatalogue?: Array<NetworkDeviceOidCatalogueEntry> | undefined;
  networkDeviceInterfaceNames?: Array<string> | undefined;
  isNetworkDeviceCatalogueLoaded?: boolean | undefined;
  /*
   * The project's offline (worst, non-operational) monitor status.
   * Pack-generated criteria that change monitor status use it as the
   * status to move to, so applying a pack yields working criteria
   * instead of "change status to <nothing>".
   */
  offlineMonitorStatusId?: ObjectID | undefined;
}

const MonitorCriteriaElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [emptyCriteria] = useState<MonitorCriteria>(() => {
    return new MonitorCriteria();
  });
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);
  const [showCantDeleteModal, setShowCantDeleteModal] =
    useState<boolean>(false);
  const [reorderAnnouncement, setReorderAnnouncement] = useState<string>("");
  const monitorCriteria: MonitorCriteria = props.value || emptyCriteria;
  const rules: Array<MonitorCriteriaInstance> =
    monitorCriteria.data?.monitorCriteriaInstanceArray || [];

  const updateRules: (value: Array<MonitorCriteriaInstance>) => void = (
    value: Array<MonitorCriteriaInstance>,
  ): void => {
    props.onChange?.(
      MonitorCriteria.fromJSON({
        _type: "MonitorCriteria",
        value: { monitorCriteriaInstanceArray: value },
      }),
    );
  };

  const moveRule: (source: number, destination: number) => void = (
    source: number,
    destination: number,
  ): void => {
    if (
      source === destination ||
      destination < 0 ||
      destination >= rules.length
    ) {
      return;
    }
    const reordered: Array<MonitorCriteriaInstance> = [...rules];
    const [movedRule] = reordered.splice(source, 1);
    if (!movedRule) {
      return;
    }
    reordered.splice(destination, 0, movedRule);
    updateRules(reordered);
    setReorderAnnouncement(
      `${movedRule.data?.name || "Rule"} moved to position ${destination + 1} of ${rules.length}.`,
    );
  };

  const handleDragEnd: (result: DropResult) => void = (
    result: DropResult,
  ): void => {
    if (result.destination) {
      moveRule(result.source.index, result.destination.index);
    }
  };

  const getConditionSummary: (instance: MonitorCriteriaInstance) => string = (
    instance: MonitorCriteriaInstance,
  ): string => {
    const filters: Array<CriteriaFilter> = instance.data?.filters || [];
    if (filters.length === 0) {
      return "Add a condition to decide when this rule applies";
    }
    const connector: string =
      instance.data?.filterCondition === FilterCondition.Any ? " or " : " and ";
    const summary: string = filters
      .slice(0, 2)
      .map((filter: CriteriaFilter) => {
        if (!filter?.checkOn || !filter?.filterType) {
          return "Choose a check and condition";
        }
        return CriteriaFilterUtil.translateFilterToText(filter)
          .replace(/^Check if /, "")
          .trim()
          .replace(/\.$/, "");
      })
      .join(connector);
    return `${summary}${filters.length > 2 ? ` · +${filters.length - 2} more` : ""}`;
  };

  const getActionSummary: (instance: MonitorCriteriaInstance) => string = (
    instance: MonitorCriteriaInstance,
  ): string => {
    const actions: Array<string> = [];
    if (instance.data?.changeMonitorStatus) {
      const status: DropdownOption | undefined =
        props.monitorStatusDropdownOptions.find((option: DropdownOption) => {
          return (
            option.value.toString() ===
            instance.data?.monitorStatusId?.toString()
          );
        });
      actions.push(
        status ? `Set status to ${status.label}` : "Choose a monitor status",
      );
    }
    if (instance.data?.createAlerts) {
      actions.push("Create an alert");
    }
    if (instance.data?.createIncidents) {
      actions.push("Declare an incident");
    }
    return actions.length > 0 ? actions.join(" · ") : "No actions selected";
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Rules run from top to bottom. Put higher-priority rules first.
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {reorderAnnouncement}
      </p>
      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable
          droppableId={`monitor-criteria-list-${props.monitorStep.data?.id || "step"}`}
        >
          {(droppableProvided: DroppableProvided) => {
            return (
              <div
                ref={droppableProvided.innerRef}
                {...droppableProvided.droppableProps}
                className="space-y-3"
              >
                {rules.map(
                  (instance: MonitorCriteriaInstance, index: number) => {
                    const criteriaId: string =
                      instance.data?.id || `criteria-${index}`;
                    const isExpanded: boolean = expandedRuleId === criteriaId;
                    const ruleName: string =
                      instance.data?.name || `Rule ${index + 1}`;
                    const isDisabled: boolean =
                      instance.data?.isEnabled === false;
                    const panelId: string = `rule-editor-${criteriaId}`;
                    return (
                      <Draggable
                        draggableId={criteriaId}
                        index={index}
                        key={criteriaId}
                      >
                        {(draggableProvided: DraggableProvided) => {
                          return (
                            <div
                              ref={draggableProvided.innerRef}
                              {...draggableProvided.draggableProps}
                              className={`rounded-xl border bg-white transition-colors ${isExpanded ? "border-indigo-300 shadow-sm" : "border-gray-200"}`}
                              data-testid="monitor-rule-card"
                            >
                              <div className="relative">
                                <div
                                  {...draggableProvided.dragHandleProps}
                                  className="absolute left-2 top-2 z-10 flex h-8 w-8 cursor-grab items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  aria-label={`Drag to reorder rule: ${ruleName}`}
                                >
                                  <Icon
                                    icon={IconProp.GripVertical}
                                    className="h-4 w-4"
                                  />
                                </div>
                                <button
                                  type="button"
                                  className="block w-full rounded-lg p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                                  aria-label={`${isExpanded ? "Close" : "Edit"} rule: ${ruleName}`}
                                  aria-expanded={isExpanded}
                                  aria-controls={
                                    isExpanded ? panelId : undefined
                                  }
                                  onClick={() => {
                                    setExpandedRuleId(
                                      isExpanded ? null : criteriaId,
                                    );
                                  }}
                                >
                                  <span
                                    className={`flex min-h-8 min-w-0 items-center gap-2 pl-7 ${isExpanded ? "pr-24" : "pr-6"}`}
                                  >
                                    <span className="text-xs font-medium text-gray-500">
                                      {index + 1}.
                                    </span>
                                    <span
                                      className={`min-w-0 flex-1 truncate text-sm font-semibold ${isDisabled ? "text-gray-500" : "text-gray-900"}`}
                                      title={ruleName}
                                    >
                                      {ruleName}
                                    </span>
                                    {(!isExpanded || isDisabled) && (
                                      <span
                                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${isDisabled ? "bg-gray-100 text-gray-600" : "bg-emerald-50 text-emerald-700"}`}
                                      >
                                        {isDisabled ? "Disabled" : "Enabled"}
                                      </span>
                                    )}
                                  </span>
                                  {!isExpanded && (
                                    <span
                                      data-testid="monitor-rule-summary"
                                      className="mt-1 block"
                                    >
                                      <span className="block break-words text-sm text-gray-700">
                                        <span className="font-medium">
                                          When{" "}
                                        </span>
                                        {getConditionSummary(instance)}
                                      </span>
                                      <span className="mt-1 flex min-h-8 items-center break-words pr-20 text-xs text-gray-600">
                                        <span>
                                          <span className="font-medium">
                                            Then{" "}
                                          </span>
                                          {getActionSummary(instance)}
                                        </span>
                                      </span>
                                    </span>
                                  )}
                                  <Icon
                                    icon={
                                      isExpanded
                                        ? IconProp.ChevronUp
                                        : IconProp.ChevronDown
                                    }
                                    className="absolute right-3 top-5 h-4 w-4 text-gray-500"
                                  />
                                </button>
                                <div
                                  className={`absolute flex items-center ${isExpanded ? "right-9 top-3" : "bottom-3 right-3"}`}
                                >
                                  <button
                                    type="button"
                                    disabled={index === 0}
                                    aria-label={`Move rule up: ${ruleName}`}
                                    title="Move up"
                                    className="flex h-8 w-8 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-30"
                                    onClick={() => {
                                      moveRule(index, index - 1);
                                    }}
                                  >
                                    <Icon
                                      icon={IconProp.ArrowUp}
                                      className="h-4 w-4"
                                    />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={index === rules.length - 1}
                                    aria-label={`Move rule down: ${ruleName}`}
                                    title="Move down"
                                    className="flex h-8 w-8 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-30"
                                    onClick={() => {
                                      moveRule(index, index + 1);
                                    }}
                                  >
                                    <Icon
                                      icon={IconProp.ArrowDown}
                                      className="h-4 w-4"
                                    />
                                  </button>
                                </div>
                              </div>
                              {isExpanded && (
                                <div
                                  id={panelId}
                                  className="border-t border-gray-200 p-3 sm:p-4"
                                >
                                  <MonitorCriteriaInstanceElement
                                    {...props}
                                    value={instance}
                                    onDelete={() => {
                                      if (rules.length === 1) {
                                        setShowCantDeleteModal(true);
                                        return;
                                      }
                                      updateRules(
                                        rules.filter(
                                          (
                                            _: MonitorCriteriaInstance,
                                            ruleIndex: number,
                                          ) => {
                                            return ruleIndex !== index;
                                          },
                                        ),
                                      );
                                      setExpandedRuleId(null);
                                    }}
                                    onChange={(
                                      value: MonitorCriteriaInstance,
                                    ) => {
                                      const updated: Array<MonitorCriteriaInstance> =
                                        [...rules];
                                      updated[index] = value;
                                      updateRules(updated);
                                    }}
                                  />
                                </div>
                              )}
                            </div>
                          );
                        }}
                      </Draggable>
                    );
                  },
                )}
                {droppableProvided.placeholder}
              </div>
            );
          }}
        </Droppable>
      </DragDropContext>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          title="Add rule"
          buttonStyle={ButtonStyleType.OUTLINE}
          buttonSize={ButtonSize.Small}
          icon={IconProp.Add}
          onClick={() => {
            const newRule: MonitorCriteriaInstance =
              new MonitorCriteriaInstance();
            if (newRule.data) {
              newRule.data.name = "New rule";
              newRule.data.filters = [
                CriteriaFilterUtil.getDefaultCriteriaFilter(props.monitorType),
              ];
              setExpandedRuleId(newRule.data.id);
            }
            updateRules([...rules, newRule]);
          }}
        />
        {props.monitorType === MonitorType.NetworkDevice && (
          <Button
            title="Add recommended alerts"
            buttonSize={ButtonSize.Small}
            icon={IconProp.Star}
            onClick={() => {
              updateRules([
                ...rules,
                ...NetworkDeviceAlertPackUtil.buildCriteriaInstances({
                  downMonitorStatusId: props.offlineMonitorStatusId,
                }),
              ]);
            }}
          />
        )}
      </div>
      {showCantDeleteModal && (
        <ConfirmModal
          description="Keep at least one rule so this monitor can determine its status. You can edit or disable this rule instead."
          title="Keep one rule"
          onSubmit={() => {
            setShowCantDeleteModal(false);
          }}
          submitButtonType={ButtonStyleType.NORMAL}
          submitButtonText="Got it"
        />
      )}
    </div>
  );
};

export default MonitorCriteriaElement;
