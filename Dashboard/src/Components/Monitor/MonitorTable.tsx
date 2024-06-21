import LabelsElement from "../../Components/Label/Labels";
import MonitoringInterval from "../../Utils/MonitorIntervalDropdownOptions";
import MonitorTypeUtil from "../../Utils/MonitorType";
import DashboardNavigation from "../../Utils/Navigation";
import MonitorSteps from "../Form/Monitor/MonitorSteps";
import { Black, Gray500 } from "Common/Types/BrandColors";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorStepsType from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import {
  BulkActionFailed,
  BulkActionOnClickProps,
} from "CommonUI/src/Components/BulkUpdate/BulkUpdateForm";
import { ButtonStyleType } from "CommonUI/src/Components/Button/Button";
import { DropdownOption } from "CommonUI/src/Components/Dropdown/Dropdown";
import {
  CustomElementProps,
  FormFieldStyleType,
} from "CommonUI/src/Components/Forms/Types/Field";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "CommonUI/src/Components/Forms/Types/FormValues";
import { ModalWidth } from "CommonUI/src/Components/Modal/Modal";
import { ModalTableBulkDefaultActions } from "CommonUI/src/Components/ModelTable/BaseModelTable";
import ModelTable from "CommonUI/src/Components/ModelTable/ModelTable";
import Statusbubble from "CommonUI/src/Components/StatusBubble/StatusBubble";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import API from "CommonUI/src/Utils/API/API";
import Query from "CommonUI/src/Utils/BaseDatabase/Query";
import ModelAPI from "CommonUI/src/Utils/ModelAPI/ModelAPI";
import Label from "Model/Models/Label";
import Monitor from "Model/Models/Monitor";
import MonitorStatus from "Model/Models/MonitorStatus";
import React, { FunctionComponent, ReactElement } from "react";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import MonitorElement from "./Monitor";

export interface ComponentProps {
  query?: Query<Monitor> | undefined;
  noItemsMessage?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
}

const MonitorsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ModelTable<Monitor>
      modelType={Monitor}
      name="Monitors"
      id="Monitors-table"
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
      isDeleteable={false}
      showViewIdButton={true}
      isEditable={false}
      isCreateable={true}
      isViewable={true}
      query={props.query || {}}
      createEditModalWidth={ModalWidth.Large}
      formSteps={[
        {
          title: "Monitor Info",
          id: "monitor-info",
        },
        {
          title: "Criteria",
          id: "criteria",
          showIf: (values: FormValues<Monitor>) => {
            return values.monitorType !== MonitorType.Manual;
          },
        },
        {
          title: "Interval",
          id: "monitoring-interval",
          showIf: (values: FormValues<Monitor>) => {
            return (
              values.monitorType !== MonitorType.Manual &&
              values.monitorType !== MonitorType.IncomingRequest &&
              values.monitorType !== MonitorType.Server
            );
          },
        },
      ]}
      cardProps={{
        title: props.title || "Monitors",
        description:
          props.description || "Here is a list of monitors for this project.",
      }}
      selectMoreFields={{
        disableActiveMonitoring: true,
      }}
      noItemsMessage={props.noItemsMessage || "No monitors found."}
      formFields={[
        {
          field: {
            name: true,
          },
          title: "Name",
          stepId: "monitor-info",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Monitor Name",
          validation: {
            minLength: 2,
          },
        },
        {
          field: {
            description: true,
          },
          stepId: "monitor-info",
          title: "Description",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
          placeholder: "Description",
        },
        {
          field: {
            monitorType: true,
          },
          title: "Monitor Type",
          stepId: "monitor-info",
          fieldType: FormFieldSchemaType.Dropdown,
          required: true,
          placeholder: "Select Monitor Type",
          dropdownOptions: MonitorTypeUtil.monitorTypesAsDropdownOptions(),
        },
        {
          field: {
            monitorSteps: true,
          },
          stepId: "criteria",
          styleType: FormFieldStyleType.Heading,
          title: "Monitor Details",
          fieldType: FormFieldSchemaType.CustomComponent,
          required: true,
          customValidation: (values: FormValues<Monitor>) => {
            const error: string | null = MonitorStepsType.getValidationError(
              values.monitorSteps as MonitorStepsType,
              values.monitorType as MonitorType,
            );

            return error;
          },
          getCustomElement: (
            value: FormValues<Monitor>,
            props: CustomElementProps,
          ) => {
            return (
              <MonitorSteps
                {...props}
                monitorType={value.monitorType || MonitorType.Manual}
                monitorName={value.name || ""}
              />
            );
          },
        },
        {
          field: {
            monitoringInterval: true,
          },
          stepId: "monitoring-interval",
          title: "Monitoring Interval",
          fieldType: FormFieldSchemaType.Dropdown,
          required: true,
          fetchDropdownOptions: (item: FormValues<Monitor>) => {
            let interval: Array<DropdownOption> = [...MonitoringInterval];

            if (
              item &&
              (item.monitorType === MonitorType.SyntheticMonitor ||
                item.monitorType === MonitorType.CustomJavaScriptCode ||
                item.monitorType === MonitorType.SSLCertificate)
            ) {
              // remove the every minute option, every 5 minsm every 10 minutes
              interval = interval.filter((option: DropdownOption) => {
                return (
                  option.value !== "* * * * *" &&
                  option.value !== "*/5 * * * *" &&
                  option.value !== "*/10 * * * *"
                );
              });

              return Promise.resolve(interval);
            }

            return Promise.resolve(interval);
          },

          placeholder: "Select Monitoring Interval",
        },
      ]}
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
            projectId: DashboardNavigation.getProjectId()?.toString(),
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
            projectId: DashboardNavigation.getProjectId()?.toString(),
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

          getElement: (item: Monitor): ReactElement => {
            return <LabelsElement labels={item["labels"] || []} />;
          },
        },
      ]}
    />
  );
};

export default MonitorsTable;
