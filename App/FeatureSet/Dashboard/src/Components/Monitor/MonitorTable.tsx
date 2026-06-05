import LabelsElement from "Common/UI/Components/Label/Labels";
import MonitorTypeUtil from "../../Utils/MonitorType";
import ProjectUtil from "Common/UI/Utils/Project";

import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import { Black, Gray500, Red500 } from "Common/Types/BrandColors";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import {
  ModalTableBulkDefaultActions,
  SaveFilterProps,
} from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import Query from "Common/Types/BaseDatabase/Query";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorOwnerTeam from "Common/Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "Common/Models/DatabaseModels/MonitorOwnerUser";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import Probe from "Common/Models/DatabaseModels/Probe";
import MonitorProbe from "Common/Models/DatabaseModels/MonitorProbe";
import React, {
  FunctionComponent,
  ReactElement,
  useState,
  useEffect,
} from "react";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import MonitorElement from "./Monitor";
import OwnersCell from "../ResourceOwners/OwnersCell";
import useResourceOwners, {
  ResourceFacet,
  buildEntityFacetQuery,
  buildEnumFacetQuery,
} from "../ResourceOwners/useResourceOwners";
import {
  FilterChipDropdownOption,
  FilterOperator,
} from "../ResourceOwners/FilterChipDropdown";
import Includes from "Common/Types/BaseDatabase/Includes";
import Search from "Common/Types/BaseDatabase/Search";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import Navigation from "Common/UI/Utils/Navigation";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ObjectID from "Common/Types/ObjectID";
import ProbeUtil from "../../Utils/Probe";

export interface ComponentProps {
  query?: Query<Monitor> | undefined;
  noItemsMessage?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  disableCreate?: boolean | undefined;
  actionButtons?: Array<ActionButtonSchema<Monitor>> | undefined;
  cardButtons?: Array<CardButtonSchema> | undefined;
  saveFilterProps?: SaveFilterProps | undefined;
  videoLink?: Route | URL | undefined;
  refreshToggle?: string | undefined;
}

const MonitorsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [probes, setProbes] = useState<Array<Probe>>([]);
  const [showAddProbesModal, setShowAddProbesModal] = useState<boolean>(false);
  const [showRemoveProbesModal, setShowRemoveProbesModal] =
    useState<boolean>(false);
  const [bulkActionProps, setBulkActionProps] =
    useState<BulkActionOnClickProps<Monitor> | null>(null);

  const monitorExtraFacets: Array<ResourceFacet> = [
    {
      key: "currentMonitorStatus",
      label: "Status",
      icon: IconProp.Heartbeat,
      isMultiSelect: true,
      searchPlaceholder: "Search statuses...",
      loadOptions: async (
        projectId: ObjectID,
        searchTerm: string,
      ): Promise<Array<FilterChipDropdownOption>> => {
        const query: Query<MonitorStatus> = {
          projectId: projectId,
        } as Query<MonitorStatus>;
        if (searchTerm.trim()) {
          (query as unknown as Record<string, unknown>)["name"] = new Search(
            searchTerm.trim(),
          );
        }
        const result: ListResult<MonitorStatus> =
          await ModelAPI.getList<MonitorStatus>({
            modelType: MonitorStatus,
            query: query,
            limit: 50,
            skip: 0,
            select: { _id: true, name: true, priority: true, color: true },
            sort: { priority: SortOrder.Ascending },
          });
        return result.data.map((s: MonitorStatus) => {
          return {
            value: s.id?.toString() || "",
            label: s.name?.toString() || "",
            color: s.color?.toString() || "#9ca3af",
          };
        });
      },
      resolveOptions: async (
        projectId: ObjectID,
        values: Array<string>,
      ): Promise<Array<FilterChipDropdownOption>> => {
        if (values.length === 0) {
          return [];
        }
        const result: ListResult<MonitorStatus> =
          await ModelAPI.getList<MonitorStatus>({
            modelType: MonitorStatus,
            query: {
              projectId: projectId,
              _id: new Includes(values),
            } as Query<MonitorStatus>,
            limit: values.length,
            skip: 0,
            select: { _id: true, name: true, color: true },
            sort: {},
          });
        return result.data.map((s: MonitorStatus) => {
          return {
            value: s.id?.toString() || "",
            label: s.name?.toString() || "",
            color: s.color?.toString() || "#9ca3af",
          };
        });
      },
      toQueryValue: (
        values: Array<string>,
        operator: FilterOperator,
      ): unknown => {
        return buildEntityFacetQuery(values, operator, true);
      },
    },
    {
      key: "monitorType",
      label: "Type",
      icon: IconProp.Cube,
      isMultiSelect: true,
      searchPlaceholder: "Search monitor types...",
      options: MonitorTypeUtil.monitorTypesAsDropdownOptions().map(
        (o: DropdownOption): FilterChipDropdownOption => {
          return {
            value: o.value.toString(),
            label: o.label,
          };
        },
      ),
      toQueryValue: (
        values: Array<string>,
        operator: FilterOperator,
      ): unknown => {
        return buildEnumFacetQuery(values, operator);
      },
    },
  ];

  const {
    getOwnersForResource,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<Monitor>({
    ownerUserModelType: MonitorOwnerUser,
    ownerTeamModelType: MonitorOwnerTeam,
    resourceIdField: "monitorId",
    showLabelsFacet: true,
    extraFacets: monitorExtraFacets,
    persistKey: props.saveFilterProps?.tableId,
  });

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<Monitor>({ modelType: Monitor });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<Monitor>({
      ownerUserModelType: MonitorOwnerUser,
      ownerTeamModelType: MonitorOwnerTeam,
      resourceIdField: "monitorId",
    });

  useEffect(() => {
    const fetchProbes: () => Promise<void> = async (): Promise<void> => {
      try {
        const allProbes: Array<Probe> = await ProbeUtil.getAllProbes();
        setProbes(allProbes);
      } catch {
        // probes will remain empty, bulk actions will still work
      }
    };

    fetchProbes();
  }, []);

  const handleBulkAddProbes: (probeId: ObjectID) => Promise<void> = async (
    probeId: ObjectID,
  ): Promise<void> => {
    if (!bulkActionProps) {
      return;
    }

    const { items, onProgressInfo, onBulkActionStart, onBulkActionEnd } =
      bulkActionProps;

    onBulkActionStart();

    const inProgressItems: Array<Monitor> = [...items];
    const totalItems: Array<Monitor> = [...items];
    const successItems: Array<Monitor> = [];
    const failedItems: Array<BulkActionFailed<Monitor>> = [];

    for (const monitor of totalItems) {
      inProgressItems.splice(inProgressItems.indexOf(monitor), 1);

      try {
        if (!monitor.id) {
          throw new BadDataException("Monitor ID not found");
        }

        if (
          !monitor.monitorType ||
          !MonitorTypeHelper.isProbableMonitor(
            monitor.monitorType as MonitorType,
          )
        ) {
          failedItems.push({
            item: monitor,
            failedMessage: "This monitor type does not support probes",
          });

          onProgressInfo({
            totalItems: totalItems,
            failed: failedItems,
            successItems: successItems,
            inProgressItems: inProgressItems,
          });

          continue;
        }

        // Check if this probe is already assigned to this monitor
        const existingProbes: ListResult<MonitorProbe> =
          await ModelAPI.getList<MonitorProbe>({
            modelType: MonitorProbe,
            query: {
              monitorId: monitor.id,
              probeId: probeId,
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            limit: 1,
            skip: 0,
            select: {
              _id: true,
            },
            sort: {},
          });

        if (existingProbes.data.length > 0) {
          failedItems.push({
            item: monitor,
            failedMessage: "Probe is already assigned to this monitor",
          });
        } else {
          const monitorProbe: MonitorProbe = new MonitorProbe();
          monitorProbe.monitorId = monitor.id;
          monitorProbe.probeId = probeId;
          monitorProbe.projectId = ProjectUtil.getCurrentProjectId()!;
          monitorProbe.isEnabled = true;

          await ModelAPI.create<MonitorProbe>({
            model: monitorProbe,
            modelType: MonitorProbe,
          });

          successItems.push(monitor);
        }
      } catch (err) {
        failedItems.push({
          item: monitor,
          failedMessage: API.getFriendlyMessage(err),
        });
      }

      onProgressInfo({
        totalItems: totalItems,
        failed: failedItems,
        successItems: successItems,
        inProgressItems: inProgressItems,
      });
    }

    onBulkActionEnd();
    setShowAddProbesModal(false);
    setBulkActionProps(null);
  };

  const handleBulkRemoveProbes: (probeId: ObjectID) => Promise<void> = async (
    probeId: ObjectID,
  ): Promise<void> => {
    if (!bulkActionProps) {
      return;
    }

    const { items, onProgressInfo, onBulkActionStart, onBulkActionEnd } =
      bulkActionProps;

    onBulkActionStart();

    const inProgressItems: Array<Monitor> = [...items];
    const totalItems: Array<Monitor> = [...items];
    const successItems: Array<Monitor> = [];
    const failedItems: Array<BulkActionFailed<Monitor>> = [];

    for (const monitor of totalItems) {
      inProgressItems.splice(inProgressItems.indexOf(monitor), 1);

      try {
        if (!monitor.id) {
          throw new BadDataException("Monitor ID not found");
        }

        if (
          !monitor.monitorType ||
          !MonitorTypeHelper.isProbableMonitor(
            monitor.monitorType as MonitorType,
          )
        ) {
          failedItems.push({
            item: monitor,
            failedMessage: "This monitor type does not support probes",
          });

          onProgressInfo({
            totalItems: totalItems,
            failed: failedItems,
            successItems: successItems,
            inProgressItems: inProgressItems,
          });

          continue;
        }

        // Find the MonitorProbe record to delete
        const existingProbes: ListResult<MonitorProbe> =
          await ModelAPI.getList<MonitorProbe>({
            modelType: MonitorProbe,
            query: {
              monitorId: monitor.id,
              probeId: probeId,
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            limit: 1,
            skip: 0,
            select: {
              _id: true,
            },
            sort: {},
          });

        if (existingProbes.data.length === 0) {
          failedItems.push({
            item: monitor,
            failedMessage: "Probe is not assigned to this monitor",
          });
        } else {
          await ModelAPI.deleteItem<MonitorProbe>({
            modelType: MonitorProbe,
            id: existingProbes.data[0]!.id!,
          });

          successItems.push(monitor);
        }
      } catch (err) {
        failedItems.push({
          item: monitor,
          failedMessage: API.getFriendlyMessage(err),
        });
      }

      onProgressInfo({
        totalItems: totalItems,
        failed: failedItems,
        successItems: successItems,
        inProgressItems: inProgressItems,
      });
    }

    onBulkActionEnd();
    setShowRemoveProbesModal(false);
    setBulkActionProps(null);
  };

  const getBulkAddProbesAction: () => BulkActionButtonSchema<Monitor> =
    (): BulkActionButtonSchema<Monitor> => {
      return {
        title: "Add Probe",
        buttonStyleType: ButtonStyleType.NORMAL,
        icon: IconProp.Signal,
        onClick: async (
          actionProps: BulkActionOnClickProps<Monitor>,
        ): Promise<void> => {
          setBulkActionProps(actionProps);
          setShowAddProbesModal(true);
        },
      };
    };

  const getBulkRemoveProbesAction: () => BulkActionButtonSchema<Monitor> =
    (): BulkActionButtonSchema<Monitor> => {
      return {
        title: "Remove Probe",
        buttonStyleType: ButtonStyleType.NORMAL,
        icon: IconProp.Close,
        onClick: async (
          actionProps: BulkActionOnClickProps<Monitor>,
        ): Promise<void> => {
          setBulkActionProps(actionProps);
          setShowRemoveProbesModal(true);
        },
      };
    };

  let cardbuttons: Array<CardButtonSchema> = props.cardButtons
    ? [...props.cardButtons]
    : [];

  if (!props.disableCreate) {
    // then add a card button that takes to monitor create page
    cardbuttons = [
      ...(props.cardButtons || []),
      {
        title: "Create Monitor",
        onClick: () => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITOR_CREATE] as Route,
            ),
          );
        },
        buttonStyle: ButtonStyleType.NORMAL,
        icon: IconProp.Add,
      },
    ];
  }

  return (
    <div>
      <ModelTable<Monitor>
        modelType={Monitor}
        name="Monitors"
        userPreferencesKey="monitors-table"
        id="Monitors-table"
        saveFilterProps={props.saveFilterProps}
        bulkActions={{
          buttons: [
            {
              title: "Disable Monitor",
              buttonStyleType: ButtonStyleType.NORMAL,
              onClick: async (props: BulkActionOnClickProps<Monitor>) => {
                const inProgressItems: Array<Monitor> = [...props.items]; // items to be disabled
                const totalItems: Array<Monitor> = [...props.items]; // total items
                const successItems: Array<Monitor> = []; // items that are disabled
                const failedItems: Array<BulkActionFailed<Monitor>> = []; // items that failed to disable

                props.onBulkActionStart();

                for (const monitor of totalItems) {
                  // remove this item from inProgressItems

                  inProgressItems.splice(inProgressItems.indexOf(monitor), 1);

                  try {
                    if (!monitor.id) {
                      throw new BadDataException("Monitor ID not found");
                    }

                    await ModelAPI.updateById<Monitor>({
                      id: monitor.id,
                      modelType: Monitor,
                      data: {
                        disableActiveMonitoring: true,
                      },
                    });

                    successItems.push(monitor);
                  } catch (err) {
                    failedItems.push({
                      item: monitor,
                      failedMessage: API.getFriendlyMessage(err),
                    });
                  }

                  props.onProgressInfo({
                    totalItems: totalItems,
                    failed: failedItems,
                    successItems: successItems,
                    inProgressItems: inProgressItems,
                  });
                }

                props.onBulkActionEnd();
              },

              icon: IconProp.Stop,
              confirmTitle: (items: Array<Monitor>) => {
                return `Disable ${items.length} Monitor(s)`;
              },
              confirmMessage: (items: Array<Monitor>) => {
                return `Are you sure you want to disable ${items.length} monitor(s)?`;
              },
            },
            {
              title: "Enable Monitor",
              buttonStyleType: ButtonStyleType.NORMAL,
              onClick: async (props: BulkActionOnClickProps<Monitor>) => {
                const inProgressItems: Array<Monitor> = [...props.items]; // items to be disabled
                const totalItems: Array<Monitor> = [...props.items]; // total items
                const successItems: Array<Monitor> = []; // items that are disabled
                const failedItems: Array<BulkActionFailed<Monitor>> = []; // items that failed to disable

                props.onBulkActionStart();

                for (const monitor of totalItems) {
                  // remove this item from inProgressItems

                  inProgressItems.splice(inProgressItems.indexOf(monitor), 1);

                  try {
                    if (!monitor.id) {
                      throw new BadDataException("Monitor ID not found");
                    }

                    await ModelAPI.updateById<Monitor>({
                      id: monitor.id,
                      modelType: Monitor,
                      data: {
                        disableActiveMonitoring: false,
                      },
                    });

                    successItems.push(monitor);
                  } catch (err) {
                    failedItems.push({
                      item: monitor,
                      failedMessage: API.getFriendlyMessage(err),
                    });
                  }

                  props.onProgressInfo({
                    totalItems: totalItems,
                    failed: failedItems,
                    successItems: successItems,
                    inProgressItems: inProgressItems,
                  });
                }

                props.onBulkActionEnd();
              },

              icon: IconProp.Play,
              confirmTitle: (items: Array<Monitor>) => {
                return `Enable ${items.length} Monitor(s)`;
              },
              confirmMessage: (items: Array<Monitor>) => {
                return `Are you sure you want to enable ${items.length} monitor(s) for active monitoring?`;
              },
            },
            getBulkAddProbesAction(),
            getBulkRemoveProbesAction(),
            ...labelBulkActions,
            ...ownerBulkActions,
            ModalTableBulkDefaultActions.Delete,
          ],
        }}
        actionButtons={props.actionButtons}
        isDeleteable={false}
        showViewIdButton={true}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        refreshToggle={props.refreshToggle}
        topContent={filterBar}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery(props.query)}
        onFetchSuccess={(data: Array<Monitor>) => {
          onResourcesFetched(data);
        }}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: props.title || "Monitors",
          description:
            props.description || "Here is a list of monitors for this project.",
          buttons: cardbuttons,
        }}
        videoLink={props.videoLink}
        selectMoreFields={{
          disableActiveMonitoring: true,
          isNoProbeEnabledOnThisMonitor: true,
          isAllProbesDisconnectedFromThisMonitor: true,
          monitorType: true,
        }}
        noItemsMessage={props.noItemsMessage || "No monitors found."}
        showRefreshButton={true}
        searchableFields={["name", "description"]}
        viewPageRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.MONITORS]!,
        )}
        filters={[
          {
            title: "Monitor ID",
            type: FieldType.Text,
            field: {
              _id: true,
            },
          },
          {
            title: "Name",
            type: FieldType.Text,
            field: {
              name: true,
            },
          },
          {
            title: "Created At",
            type: FieldType.Date,
            field: {
              createdAt: true,
            },
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: Monitor): ReactElement => {
              return <MonitorElement monitor={item} />;
            },
          },
          {
            field: {
              monitorType: true,
            },
            title: "Monitor Type",
            type: FieldType.Text,
            hideOnMobile: true,
          },
          {
            field: {
              currentMonitorStatus: {
                color: true,
                name: true,
              },
            },

            title: "Monitor Status",
            type: FieldType.Entity,

            getElement: (item: Monitor): ReactElement => {
              if (!item["currentMonitorStatus"]) {
                throw new BadDataException("Monitor Status not found");
              }

              if (item && item["disableActiveMonitoring"]) {
                return (
                  <Statusbubble
                    shouldAnimate={false}
                    color={Gray500}
                    text={"Disabled"}
                  />
                );
              }

              if (item && item.isNoProbeEnabledOnThisMonitor) {
                return (
                  <Statusbubble
                    shouldAnimate={false}
                    color={Red500}
                    text={"Probes Not Enabled"}
                  />
                );
              }

              if (item && item.isAllProbesDisconnectedFromThisMonitor) {
                return (
                  <Statusbubble
                    shouldAnimate={false}
                    color={Red500}
                    text={"Probes Disconnected"}
                  />
                );
              }

              return (
                <Statusbubble
                  color={item.currentMonitorStatus.color || Black}
                  shouldAnimate={true}
                  text={item.currentMonitorStatus.name || "Unknown"}
                />
              );
            },
          },
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,
            hideOnMobile: true,

            getElement: (item: Monitor): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
          {
            field: {
              _id: true,
            },
            title: "Owners",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: Monitor): ReactElement => {
              return (
                <OwnersCell
                  owners={getOwnersForResource(item)}
                  isLoading={isLoadingOwners}
                />
              );
            },
          },
        ]}
      />

      {showAddProbesModal && (
        <BasicFormModal
          title="Add Probe to Monitors"
          description="Select a probe to add to the selected monitors. Monitors that already have this probe assigned will be skipped."
          onClose={() => {
            setShowAddProbesModal(false);
            setBulkActionProps(null);
          }}
          submitButtonText="Add Probe"
          onSubmit={async (formData: { probeId: ObjectID }) => {
            await handleBulkAddProbes(formData.probeId);
          }}
          formProps={{
            fields: [
              {
                field: {
                  probeId: true,
                },
                title: "Select Probe",
                fieldType: FormFieldSchemaType.Dropdown,
                required: true,
                dropdownOptions: probes.map((probe: Probe) => {
                  return {
                    label: probe.name || "",
                    value: probe.id?.toString() || "",
                  };
                }),
              },
            ],
          }}
        />
      )}

      {labelBulkActionModals}
      {ownerBulkActionModals}

      {showRemoveProbesModal && (
        <BasicFormModal
          title="Remove Probe from Monitors"
          description="Select a probe to remove from the selected monitors. Monitors that do not have this probe assigned will be skipped."
          onClose={() => {
            setShowRemoveProbesModal(false);
            setBulkActionProps(null);
          }}
          submitButtonText="Remove Probe"
          onSubmit={async (formData: { probeId: ObjectID }) => {
            await handleBulkRemoveProbes(formData.probeId);
          }}
          formProps={{
            fields: [
              {
                field: {
                  probeId: true,
                },
                title: "Select Probe",
                fieldType: FormFieldSchemaType.Dropdown,
                required: true,
                dropdownOptions: probes.map((probe: Probe) => {
                  return {
                    label: probe.name || "",
                    value: probe.id?.toString() || "",
                  };
                }),
              },
            ],
          }}
        />
      )}
    </div>
  );
};

export default MonitorsTable;
