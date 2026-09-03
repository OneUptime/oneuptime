import MonitorCriteriaInstanceElement from "./MonitorCriteriaInstance";
import { NetworkDeviceOidCatalogueEntry } from "./CriteriaFilter";
import { IncidentRoleOption } from "./MonitorCriteriaIncidentForm";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import CriteriaFilterUtil from "../../../Utils/Form/Monitor/CriteriaFilter";
import MonitorCriteriaSummaryUtil from "../../../Utils/Form/Monitor/MonitorCriteriaSummary";
import MonitorCriteriaDuplicateUtil from "../../../Utils/Form/Monitor/MonitorCriteriaDuplicate";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import NetworkDeviceAlertPackUtil from "Common/Types/Monitor/SnmpMonitor/NetworkDeviceAlertPack";
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

/*
 * Collapsed/expanded per criteria id. Absent means "whatever the list's
 * default is" - see isCriteriaCollapsed - so the default can depend on how
 * many criteria there are without having to seed this map up front.
 */
interface CriteriaCollapsedState {
  [key: string]: boolean;
}

const MonitorCriteriaElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showCantDeleteModal, setShowCantDeleteModal] =
    React.useState<boolean>(false);

  const monitorCriteria: MonitorCriteria = props.value || new MonitorCriteria();

  const criteriaInstances: Array<MonitorCriteriaInstance> =
    monitorCriteria.data?.monitorCriteriaInstanceArray || [];

  const [collapsedState, setCollapsedState] = useState<CriteriaCollapsedState>(
    {},
  );

  /*
   * A monitor ships with two criteria and users add more. Opening every
   * one of them expanded made this the longest form in the product - the
   * "Default Monitor Status" dropdown under the list sat several
   * thousand pixels below the fold, and finding a specific criteria meant
   * scrolling past all the others' filters and action sub-forms.
   *
   * So a list of more than one starts collapsed: the rows say what each
   * criteria does (getCriteriaSummary) and the user expands the one they
   * came for. A single criteria has nothing to scroll past and nothing to
   * choose between, so it stays open.
   */
  const collapseByDefault: boolean = criteriaInstances.length > 1;

  const isCriteriaCollapsed: (criteriaId: string) => boolean = (
    criteriaId: string,
  ): boolean => {
    const explicitState: boolean | undefined = collapsedState[criteriaId];

    return explicitState === undefined ? collapseByDefault : explicitState;
  };

  const toggleCriteriaCollapsed: (id: string) => void = (id: string): void => {
    setCollapsedState((prev: CriteriaCollapsedState) => {
      const current: boolean =
        prev[id] === undefined ? collapseByDefault : prev[id]!;

      return {
        ...prev,
        [id]: !current,
      };
    });
  };

  const getCriteriaId: (
    instance: MonitorCriteriaInstance,
    index: number,
  ) => string = (instance: MonitorCriteriaInstance, index: number): string => {
    return instance.data?.id || `criteria-${index}`;
  };

  // Expand All / Collapse All write an explicit state for every row.
  const setAllCollapsed: (isCollapsed: boolean) => void = (
    isCollapsed: boolean,
  ): void => {
    const next: CriteriaCollapsedState = {};

    criteriaInstances.forEach(
      (instance: MonitorCriteriaInstance, index: number) => {
        next[getCriteriaId(instance, index)] = isCollapsed;
      },
    );

    setCollapsedState(next);
  };

  const areAllExpanded: boolean =
    criteriaInstances.length > 0 &&
    criteriaInstances.every(
      (instance: MonitorCriteriaInstance, index: number) => {
        return !isCriteriaCollapsed(getCriteriaId(instance, index));
      },
    );

  const emitChange: (newInstances: Array<MonitorCriteriaInstance>) => void = (
    newInstances: Array<MonitorCriteriaInstance>,
  ): void => {
    props.onChange?.(
      MonitorCriteria.fromJSON({
        _type: "MonitorCriteria",
        value: {
          monitorCriteriaInstanceArray: newInstances,
        },
      }),
    );
  };

  const getCriteriaSummary: (instance: MonitorCriteriaInstance) => string = (
    instance: MonitorCriteriaInstance,
  ): string => {
    return MonitorCriteriaSummaryUtil.getCriteriaSummary({
      criteriaInstance: instance,
      monitorStatusOptions: props.monitorStatusDropdownOptions,
    });
  };

  const getCriteriaHeaderColor: (
    instance: MonitorCriteriaInstance,
  ) => string = (instance: MonitorCriteriaInstance): string => {
    if (instance.data?.isEnabled === false) {
      return "border-l-gray-300";
    }
    return "border-l-blue-500";
  };

  const handleDragEnd: (result: DropResult) => void = (
    result: DropResult,
  ): void => {
    if (!result.destination) {
      return;
    }

    const sourceIndex: number = result.source.index;
    const destinationIndex: number = result.destination.index;

    if (sourceIndex === destinationIndex) {
      return;
    }

    const newMonitorCriterias: Array<MonitorCriteriaInstance> = [
      ...criteriaInstances,
    ];
    const [movedItem] = newMonitorCriterias.splice(sourceIndex, 1);
    if (!movedItem) {
      return;
    }
    newMonitorCriterias.splice(destinationIndex, 0, movedItem);

    emitChange(newMonitorCriterias);
  };

  const deleteCriteria: (criteriaId: string | undefined) => void = (
    criteriaId: string | undefined,
  ): void => {
    if (criteriaInstances.length === 1) {
      setShowCantDeleteModal(true);
      return;
    }

    const criteriaIndex: number = criteriaInstances.findIndex(
      (item: MonitorCriteriaInstance) => {
        return item.data?.id === criteriaId;
      },
    );

    if (criteriaIndex < 0) {
      return;
    }

    const newMonitorCriterias: Array<MonitorCriteriaInstance> = [
      ...criteriaInstances,
    ];
    newMonitorCriterias.splice(criteriaIndex, 1);

    emitChange(newMonitorCriterias);
  };

  const duplicateCriteria: (criteriaId: string | undefined) => void = (
    criteriaId: string | undefined,
  ): void => {
    const result: {
      criteriaInstances: Array<MonitorCriteriaInstance>;
      duplicate: MonitorCriteriaInstance | undefined;
    } = MonitorCriteriaDuplicateUtil.insertDuplicateAfter({
      criteriaInstances: criteriaInstances,
      criteriaId: criteriaId,
    });

    if (!result.duplicate) {
      return;
    }

    // The copy is what the user is about to edit, so open it.
    const duplicateId: string | undefined = result.duplicate.data?.id;

    if (duplicateId) {
      setCollapsedState((prev: CriteriaCollapsedState) => {
        return {
          ...prev,
          [duplicateId]: false,
        };
      });
    }

    emitChange(result.criteriaInstances);
  };

  const evaluationOrderHint: string =
    MonitorCriteriaSummaryUtil.getEvaluationOrderHint({
      monitorType: props.monitorType,
      monitorStep: props.monitorStep,
      criteriaInstances: criteriaInstances,
    });

  return (
    <div className="mt-4">
      {/*
       * The list header: how many criteria there are, in what order they
       * are read, and one control to open or close all of them.
       */}
      {criteriaInstances.length > 0 && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900">
              {criteriaInstances.length} criteria
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              {evaluationOrderHint}
            </p>
          </div>
          {criteriaInstances.length > 1 && (
            <Button
              title={areAllExpanded ? "Collapse all" : "Expand all"}
              buttonSize={ButtonSize.Small}
              buttonStyle={ButtonStyleType.SECONDARY_LINK}
              icon={areAllExpanded ? IconProp.ChevronUp : IconProp.ChevronDown}
              onClick={() => {
                setAllCollapsed(areAllExpanded);
              }}
            />
          )}
        </div>
      )}

      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="monitor-criteria-list">
          {(droppableProvided: DroppableProvided) => {
            return (
              <div
                ref={droppableProvided.innerRef}
                {...droppableProvided.droppableProps}
              >
                {criteriaInstances.map(
                  (i: MonitorCriteriaInstance, index: number) => {
                    const criteriaId: string = getCriteriaId(i, index);
                    const isCollapsed: boolean =
                      isCriteriaCollapsed(criteriaId);
                    const criteriaName: string =
                      i.data?.name || "Unnamed Criteria";
                    const isCriteriaDisabled: boolean =
                      i.data?.isEnabled === false;

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
                              className={`mb-3 border rounded-lg overflow-hidden border-l-4 bg-white ${getCriteriaHeaderColor(i)}`}
                            >
                              {/* Collapsible Header */}
                              <div
                                className="flex items-center justify-between gap-2 px-3 py-2.5 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
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
                                  <div
                                    {...draggableProvided.dragHandleProps}
                                    onClick={(e: React.MouseEvent) => {
                                      e.stopPropagation();
                                    }}
                                    onKeyDown={(e: React.KeyboardEvent) => {
                                      e.stopPropagation();
                                    }}
                                    className="mr-2 flex-shrink-0 cursor-ns-resize text-gray-400 hover:text-gray-600"
                                    aria-label="Drag to reorder criteria"
                                    title="Drag to reorder"
                                  >
                                    <Icon
                                      icon={IconProp.GripVertical}
                                      className="w-4 h-4"
                                    />
                                  </div>
                                  <Icon
                                    icon={
                                      isCollapsed
                                        ? IconProp.ChevronRight
                                        : IconProp.ChevronDown
                                    }
                                    className="w-4 h-4 text-gray-500 mr-2 flex-shrink-0"
                                  />
                                  <span className="mr-2 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-gray-200 text-[11px] font-semibold text-gray-600">
                                    {index + 1}
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center flex-wrap gap-2">
                                      <span
                                        className={`text-sm font-semibold ${
                                          isCriteriaDisabled
                                            ? "text-gray-500"
                                            : "text-gray-900"
                                        }`}
                                      >
                                        {criteriaName}
                                      </span>
                                      {isCriteriaDisabled && (
                                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-600 font-medium">
                                          Disabled
                                        </span>
                                      )}
                                    </div>
                                    {/*
                                     * What this criteria does, in words, on
                                     * the row itself - collapsed or not. It
                                     * is the only way to tell two criteria
                                     * apart without opening both.
                                     */}
                                    <p className="mt-0.5 truncate text-xs text-gray-500">
                                      {getCriteriaSummary(i)}
                                    </p>
                                  </div>
                                </div>
                                <div
                                  className="flex flex-shrink-0 items-center gap-1"
                                  onClick={(e: React.MouseEvent) => {
                                    e.stopPropagation();
                                  }}
                                  onKeyDown={(e: React.KeyboardEvent) => {
                                    e.stopPropagation();
                                  }}
                                >
                                  <button
                                    type="button"
                                    aria-label={`Duplicate ${criteriaName}`}
                                    title="Duplicate this criteria"
                                    className="rounded p-1.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                                    onClick={() => {
                                      duplicateCriteria(i.data?.id);
                                    }}
                                  >
                                    <Icon
                                      icon={IconProp.Copy}
                                      className="h-4 w-4"
                                    />
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={`Delete ${criteriaName}`}
                                    title="Delete this criteria"
                                    className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                                    onClick={() => {
                                      deleteCriteria(i.data?.id);
                                    }}
                                  >
                                    <Icon
                                      icon={IconProp.Trash}
                                      className="h-4 w-4"
                                    />
                                  </button>
                                </div>
                              </div>

                              {/* Collapsible Content */}
                              {!isCollapsed && (
                                <div className="px-4 pb-4 bg-white">
                                  <MonitorCriteriaInstanceElement
                                    monitorType={props.monitorType}
                                    monitorStep={props.monitorStep}
                                    networkDeviceOidCatalogue={
                                      props.networkDeviceOidCatalogue
                                    }
                                    networkDeviceInterfaceNames={
                                      props.networkDeviceInterfaceNames
                                    }
                                    isNetworkDeviceCatalogueLoaded={
                                      props.isNetworkDeviceCatalogueLoaded
                                    }
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
                                    labelDropdownOptions={
                                      props.labelDropdownOptions
                                    }
                                    teamDropdownOptions={
                                      props.teamDropdownOptions
                                    }
                                    userDropdownOptions={
                                      props.userDropdownOptions
                                    }
                                    incidentRoleOptions={
                                      props.incidentRoleOptions
                                    }
                                    value={i}
                                    onChange={(
                                      value: MonitorCriteriaInstance,
                                    ) => {
                                      const criteriaIndex: number =
                                        criteriaInstances.findIndex(
                                          (item: MonitorCriteriaInstance) => {
                                            return (
                                              item.data?.id === value.data?.id
                                            );
                                          },
                                        );

                                      if (criteriaIndex < 0) {
                                        return;
                                      }

                                      const newMonitorCriterias: Array<MonitorCriteriaInstance> =
                                        [...criteriaInstances];
                                      newMonitorCriterias[criteriaIndex] =
                                        value;

                                      emitChange(newMonitorCriterias);
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
      <div className="mt-4 -ml-3 flex">
        <Button
          title="Add Criteria"
          buttonSize={ButtonSize.Small}
          icon={IconProp.Add}
          onClick={() => {
            const newMonitorCriterias: Array<MonitorCriteriaInstance> = [
              ...criteriaInstances,
            ];

            const newMonitorCriteria: MonitorCriteriaInstance =
              new MonitorCriteriaInstance();

            /*
             * The type-agnostic seed filter on a fresh criteria is an
             * "Is Online" check, which most monitor types do not offer.
             * Replace it with one this monitor type can actually render,
             * so the new criteria opens with both dropdowns filled in.
             */
            if (newMonitorCriteria.data) {
              newMonitorCriteria.data.filters = [
                CriteriaFilterUtil.getDefaultCriteriaFilter(props.monitorType),
              ];
            }

            newMonitorCriterias.push(newMonitorCriteria);

            /*
             * A criteria the user just asked for is one they are about to
             * fill in, so it opens even though the rest of a multi-criteria
             * list defaults to collapsed.
             */
            const newCriteriaId: string | undefined =
              newMonitorCriteria.data?.id;

            if (newCriteriaId) {
              setCollapsedState((prev: CriteriaCollapsedState) => {
                return {
                  ...prev,
                  [newCriteriaId]: false,
                };
              });
            }

            emitChange(newMonitorCriterias);
          }}
        />
        {props.monitorType === MonitorType.NetworkDevice ? (
          <Button
            title="Add Recommended Alerts"
            buttonSize={ButtonSize.Small}
            icon={IconProp.Star}
            onClick={() => {
              const newMonitorCriterias: Array<MonitorCriteriaInstance> = [
                ...criteriaInstances,
                ...NetworkDeviceAlertPackUtil.buildCriteriaInstances({
                  downMonitorStatusId: props.offlineMonitorStatusId,
                }),
              ];

              emitChange(newMonitorCriterias);
            }}
          />
        ) : (
          <></>
        )}
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
