import MonitorCriteriaInstanceElement from "./MonitorCriteriaInstance";
import { NetworkDeviceOidCatalogueEntry } from "./CriteriaFilter";
import { IncidentRoleOption } from "./MonitorCriteriaIncidentForm";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import CriteriaFilterUtil from "../../../Utils/Form/Monitor/CriteriaFilter";
import CriteriaNameUtil from "../../../Utils/Form/Monitor/CriteriaName";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import NetworkDeviceAlertPackUtil from "Common/Types/Monitor/SnmpMonitor/NetworkDeviceAlertPack";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Icon from "Common/UI/Components/Icon/Icon";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useRef,
  useState,
} from "react";
import {
  DragDropContext,
  Draggable,
  DraggableProvided,
  Droppable,
  DroppableProvided,
  DropResult,
} from "react-beautiful-dnd";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

export interface ComponentProps {
  value: MonitorCriteria | undefined;
  onChange?: undefined | ((value: MonitorCriteria) => void);
  monitorStatusDropdownOptions: Array<DropdownOption>;
  incidentSeverityDropdownOptions: Array<DropdownOption>;
  alertSeverityDropdownOptions: Array<DropdownOption>;
  onCallPolicyDropdownOptions: Array<DropdownOption>;
  labelDropdownOptions: Array<DropdownOption>;
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
  /*
   * Start each criteria folded to its one-line header (name, what it checks,
   * what it does), not open across a screen of filters and actions. Create
   * Monitor turns this on: a new monitor's criteria are defaults that suit
   * most monitors, and the step should open on what to check. A criteria
   * added with Add Criteria still opens (it is about to be filled in), and
   * so does one that cannot be saved as it stands (it needs attention).
   * Pressing a header always wins.
   */
  foldDefaultCriteria?: boolean | undefined;
}

interface CriteriaCollapsedState {
  [key: string]: boolean;
}

const MonitorCriteriaElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [showCantDeleteModal, setShowCantDeleteModal] =
    React.useState<boolean>(false);

  const monitorCriteria: MonitorCriteria = props.value || new MonitorCriteria();

  /*
   * The criteria the user opened or closed, by id. A criteria not in here
   * shows its default (isCriteriaCollapsed).
   */
  const [collapsedState, setCollapsedState] = useState<CriteriaCollapsedState>(
    {},
  );

  // The criteria Add Criteria made here: they open, to be filled in.
  const addedCriteriaIds: MutableRefObject<Set<string>> = useRef<Set<string>>(
    new Set<string>(),
  );

  const isCriteriaCollapsed: (
    instance: MonitorCriteriaInstance,
    criteriaId: string,
  ) => boolean = (
    instance: MonitorCriteriaInstance,
    criteriaId: string,
  ): boolean => {
    const toggled: boolean | undefined = collapsedState[criteriaId];

    if (toggled !== undefined) {
      return toggled;
    }

    if (!props.foldDefaultCriteria) {
      return false;
    }

    if (addedCriteriaIds.current.has(criteriaId)) {
      return false;
    }

    // A criteria that would not save stays open, where its problem is.
    return !MonitorCriteriaInstance.getValidationError(
      instance,
      props.monitorType,
    );
  };

  const toggleCriteriaCollapsed: (
    instance: MonitorCriteriaInstance,
    criteriaId: string,
  ) => void = (instance: MonitorCriteriaInstance, criteriaId: string): void => {
    const isCollapsed: boolean = isCriteriaCollapsed(instance, criteriaId);

    setCollapsedState((prev: CriteriaCollapsedState) => {
      return {
        ...prev,
        [criteriaId]: !isCollapsed,
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
      filterCount > 1
        ? translator.translatePlural(
            {
              one: "{{count}} filter ({{condition}})",
              other: "{{count}} filters ({{condition}})",
            },
            filterCount,
            {
              condition: translator.translateText(
                filterCondition === FilterCondition.All ? "ALL" : "ANY",
              ) as string,
            },
          )
        : translator.translatePlural(
            { one: "{{count}} filter", other: "{{count}} filters" },
            filterCount,
          ),
    );

    // Actions
    const actions: Array<string> = [];
    if (instance.data?.monitorStatusId) {
      actions.push(translator.translateText("status change") as string);
    }
    if (instance.data?.createAlerts) {
      actions.push(translator.translateText("alerts") as string);
    }
    if (instance.data?.createIncidents) {
      actions.push(translator.translateText("incidents") as string);
    }

    if (actions.length > 0) {
      parts.push(actions.join(", "));
    }

    return parts.join(" | ");
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
      ...(monitorCriteria.data?.monitorCriteriaInstanceArray || []),
    ];
    const [movedItem] = newMonitorCriterias.splice(sourceIndex, 1);
    if (!movedItem) {
      return;
    }
    newMonitorCriterias.splice(destinationIndex, 0, movedItem);

    props.onChange?.(
      MonitorCriteria.fromJSON({
        _type: "MonitorCriteria",
        value: {
          monitorCriteriaInstanceArray: newMonitorCriterias,
        },
      }),
    );
  };

  return (
    <div className="mt-4">
      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="monitor-criteria-list">
          {(droppableProvided: DroppableProvided) => {
            return (
              <div
                ref={droppableProvided.innerRef}
                {...droppableProvided.droppableProps}
              >
                {monitorCriteria.data?.monitorCriteriaInstanceArray.map(
                  (i: MonitorCriteriaInstance, index: number) => {
                    const criteriaId: string =
                      i.data?.id || `criteria-${index}`;
                    const isCollapsed: boolean = isCriteriaCollapsed(
                      i,
                      criteriaId,
                    );
                    const criteriaName: string =
                      i.data?.name ||
                      (translator.translateText("Unnamed Criteria") as string);
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
                              className={`mb-4 border rounded-lg overflow-hidden border-l-4 bg-white ${getCriteriaHeaderColor(i)}`}
                            >
                              {/*
                               * Collapsible Header: the drag handle, and the
                               * button that opens and closes the criteria,
                               * side by side. The header used to be one
                               * role="button" holding the handle, which a
                               * screen reader reads as one control: the
                               * handle was lost inside it. The button still
                               * answers a press anywhere on the header (its
                               * ::after covers the header); the handle sits
                               * above that.
                               */}
                              <div
                                data-testid="monitor-criteria-header"
                                className="relative flex items-center px-4 py-3 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
                              >
                                <div
                                  {...draggableProvided.dragHandleProps}
                                  className="relative z-10 mr-2 flex-shrink-0 cursor-ns-resize text-gray-400 hover:text-gray-600"
                                  aria-label={translator.translateText(
                                    "Drag to reorder criteria",
                                  )}
                                  title={translator.translateText(
                                    "Drag to reorder",
                                  )}
                                >
                                  <Icon
                                    icon={IconProp.GripVertical}
                                    className="w-4 h-4"
                                  />
                                </div>
                                <button
                                  type="button"
                                  aria-expanded={!isCollapsed}
                                  onClick={() => {
                                    toggleCriteriaCollapsed(i, criteriaId);
                                  }}
                                  className="flex min-w-0 flex-1 items-center justify-between text-left after:absolute after:inset-0 focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-indigo-500"
                                >
                                  <div className="flex items-center flex-1 min-w-0">
                                    <Icon
                                      icon={
                                        isCollapsed
                                          ? IconProp.ChevronRight
                                          : IconProp.ChevronDown
                                      }
                                      className="w-4 h-4 text-gray-500 mr-2 flex-shrink-0"
                                    />
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
                                            {translator.translateText(
                                              "Disabled",
                                            )}
                                          </span>
                                        )}
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
                                      {translator.translateTemplate(
                                        "{{position}} of {{total}}",
                                        {
                                          position: index + 1,
                                          total:
                                            monitorCriteria.data
                                              ?.monitorCriteriaInstanceArray
                                              .length || 0,
                                        },
                                      )}
                                    </span>
                                  </div>
                                </button>
                              </div>

                              {/*
                               * Collapsible Content. Folded, it is hidden
                               * from the keyboard and from screen readers
                               * too (invisible), not only clipped to no
                               * height: Tab used to walk through every field
                               * of a folded criteria without showing one.
                               * And it holds its absolutely placed pieces
                               * (screen reader text, a picker's live region)
                               * inside the clip (relative): left to the page
                               * they stretched it by the folded criteria's
                               * whole height, a screen of blank space under
                               * the form.
                               */}
                              <div
                                data-testid="monitor-criteria-body"
                                aria-hidden={isCollapsed}
                                className={`transition-all duration-200 ease-in-out overflow-hidden ${
                                  isCollapsed
                                    ? "relative max-h-0 invisible"
                                    : "max-h-[5000px]"
                                }`}
                              >
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
                                    userDropdownOptions={
                                      props.userDropdownOptions
                                    }
                                    incidentRoleOptions={
                                      props.incidentRoleOptions
                                    }
                                    value={i}
                                    onDelete={() => {
                                      if (
                                        monitorCriteria.data
                                          ?.monitorCriteriaInstanceArray
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
                                            ?.monitorCriteriaInstanceArray ||
                                            []),
                                        ];
                                      newMonitorCriterias.splice(
                                        criteriaIndex,
                                        1,
                                      );
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
                                    onChange={(
                                      value: MonitorCriteriaInstance,
                                    ) => {
                                      const criteriaIndex: number | undefined =
                                        monitorCriteria.data?.monitorCriteriaInstanceArray.findIndex(
                                          (item: MonitorCriteriaInstance) => {
                                            return (
                                              item.data?.id === value.data?.id
                                            );
                                          },
                                        );

                                      if (criteriaIndex === undefined) {
                                        return;
                                      }
                                      const newMonitorCriterias: Array<MonitorCriteriaInstance> =
                                        [
                                          ...(monitorCriteria.data
                                            ?.monitorCriteriaInstanceArray ||
                                            []),
                                        ];
                                      newMonitorCriterias[criteriaIndex] =
                                        value;
                                      props.onChange?.(
                                        MonitorCriteria.fromJSON({
                                          _type: "MonitorCriteria",
                                          value: {
                                            monitorCriteriaInstanceArray:
                                              newMonitorCriterias,
                                          },
                                        }),
                                      );
                                    }}
                                  />
                                </div>
                              </div>
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
              ...(monitorCriteria.data?.monitorCriteriaInstanceArray || []),
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

              /*
               * Named after that filter, so the criteria is ready to save
               * without anyone inventing a name. The name follows the
               * filters as they are edited, until the user types their own.
               */
              newMonitorCriteria.setName(
                CriteriaNameUtil.getNameForCriteria(newMonitorCriteria),
              );
            }

            if (newMonitorCriteria.data?.id) {
              addedCriteriaIds.current.add(newMonitorCriteria.data.id);
            }

            newMonitorCriterias.push(newMonitorCriteria);
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
        {props.monitorType === MonitorType.NetworkDevice ? (
          <Button
            title="Add Recommended Alerts"
            buttonSize={ButtonSize.Small}
            icon={IconProp.Star}
            onClick={() => {
              const newMonitorCriterias: Array<MonitorCriteriaInstance> = [
                ...(monitorCriteria.data?.monitorCriteriaInstanceArray || []),
                ...NetworkDeviceAlertPackUtil.buildCriteriaInstances({
                  downMonitorStatusId: props.offlineMonitorStatusId,
                }),
              ];
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
