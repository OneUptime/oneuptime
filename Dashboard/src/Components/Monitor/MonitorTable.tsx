import LabelsElement from "Common/UI/Components/Label/Labels";
import MonitorTypeUtil from "../../Utils/MonitorType";
import ProjectUtil from "Common/UI/Utils/Project";

import { Black, Gray500, Red500 } from "Common/Types/BrandColors";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import {
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
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import Query from "Common/Types/BaseDatabase/Query";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import React, { FunctionComponent, ReactElement } from "react";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import MonitorElement from "./Monitor";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import Navigation from "Common/UI/Utils/Navigation";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";

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
}

const MonitorsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
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
          ModalTableBulkDefaultActions.Delete,
        ],
      }}
      actionButtons={props.actionButtons}
      isDeleteable={false}
      showViewIdButton={true}
      isEditable={false}
      isCreateable={false}
      isViewable={true}
      query={props.query || {}}
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
      }}
      noItemsMessage={props.noItemsMessage || "No monitors found."}
      showRefreshButton={true}
      viewPageRoute={RouteUtil.populateRouteParams(RouteMap[PageMap.MONITORS]!)}
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
          title: "Monitor Type",
          type: FieldType.Text,
          field: {
            monitorType: true,
          },
          filterDropdownOptions:
            MonitorTypeUtil.monitorTypesAsDropdownOptions(),
        },
        {
          title: "Monitor Status",
          type: FieldType.Entity,
          field: {
            currentMonitorStatus: {
              color: true,
              name: true,
            },
          },
          filterEntityType: MonitorStatus,
          filterQuery: {
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
          filterDropdownField: {
            label: "name",
            value: "_id",
          },
        },
        {
          title: "Labels",
          type: FieldType.EntityArray,
          field: {
            labels: {
              name: true,
              color: true,
            },
          },
          filterEntityType: Label,
          filterQuery: {
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
          filterDropdownField: {
            label: "name",
            value: "_id",
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
      ]}
    />
  );
};

export default MonitorsTable;
