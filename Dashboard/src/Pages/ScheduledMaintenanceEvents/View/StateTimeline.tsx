import PageComponentProps from "../../PageComponentProps";
import { Black } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import CheckboxViewer from "Common/UI/Components/Checkbox/CheckboxViewer";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ProjectUtil from "Common/UI/Utils/Project";

const ScheduledMaintenanceDelete: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelTable<ScheduledMaintenanceStateTimeline>
        modelType={ScheduledMaintenanceStateTimeline}
        id="table-scheduledMaintenance-status-timeline"
        userPreferencesKey="scheduled-maintenance-status-timeline-table"
        name="Scheduled Maintenance Events > State Timeline"
        isDeleteable={true}
        isCreateable={true}
        showViewIdButton={true}
        isViewable={false}
        query={{
          scheduledMaintenanceId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(
          item: ScheduledMaintenanceStateTimeline,
        ): Promise<ScheduledMaintenanceStateTimeline> => {
          if (!props.currentProject || !props.currentProject._id) {
            throw new BadDataException("Project ID cannot be null");
          }
          item.scheduledMaintenanceId = modelId;
          item.projectId = new ObjectID(props.currentProject._id);
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Status Timeline",
          description:
            "Here is the status timeline for this Scheduled Maintenance",
        }}
        noItemsMessage={
          "No status timeline created for this Scheduled Maintenance so far."
        }
        formFields={[
          {
            field: {
              scheduledMaintenanceState: true,
            },
            title: "Scheduled Maintenance Status",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Scheduled Maintenance Status",
            dropdownModal: {
              type: ScheduledMaintenanceState,
              labelField: "name",
              valueField: "_id",
            },
          },
          {
            field: {
              startsAt: true,
            },
            title: "Starts At",
            fieldType: FormFieldSchemaType.DateTime,
            required: true,
            placeholder: "Starts At",
            getDefaultValue: () => {
              return OneUptimeDate.getCurrentDate();
            },
          },
          {
            field: {
              shouldStatusPageSubscribersBeNotified: true,
            },

            title: "Notify Status Page Subscribers",
            description: "Should status page subscribers be notified?",
            fieldType: FormFieldSchemaType.Checkbox,
            defaultValue: true,
            required: false,
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        sortBy="startsAt"
        sortOrder={SortOrder.Descending}
        filters={[
          {
            field: {
              scheduledMaintenanceState: {
                name: true,
              },
            },
            title: "Scheduled Maintenance Status",
            type: FieldType.Text,
          },
          {
            field: {
              startsAt: true,
            },
            title: "Starts At",
            type: FieldType.DateTime,
          },
          {
            field: {
              endsAt: true,
            },
            title: "Ends At",
            type: FieldType.DateTime,
          },
          {
            field: {
              shouldStatusPageSubscribersBeNotified: true,
            },
            title: "Subscribers Notified",
            type: FieldType.Boolean,
          },
        ]}
        columns={[
          {
            field: {
              scheduledMaintenanceState: {
                name: true,
                color: true,
              },
            },
            title: "Scheduled Maintenance Status",
            type: FieldType.Text,

            getElement: (
              item: ScheduledMaintenanceStateTimeline,
            ): ReactElement => {
              if (!item["scheduledMaintenanceState"]) {
                throw new BadDataException(
                  "Scheduled Maintenance Status not found",
                );
              }

              return (
                <Pill
                  color={item.scheduledMaintenanceState.color || Black}
                  text={item.scheduledMaintenanceState.name || "Unknown"}
                />
              );
            },
          },
          {
            field: {
              startsAt: true,
            },
            title: "Starts At",
            type: FieldType.DateTime,
          },
          {
            field: {
              endsAt: true,
            },
            title: "Ends At",
            type: FieldType.DateTime,
            noValueMessage: "Currently Active",
          },
          {
            field: {
              endsAt: true,
            },
            title: "Duration",
            type: FieldType.Text,
            getElement: (
              item: ScheduledMaintenanceStateTimeline,
            ): ReactElement => {
              return (
                <p>
                  {OneUptimeDate.differenceBetweenTwoDatesAsFromattedString(
                    item["startsAt"] as Date,
                    (item["endsAt"] as Date) || OneUptimeDate.getCurrentDate(),
                  )}
                </p>
              );
            },
          },
          {
            field: {
              shouldStatusPageSubscribersBeNotified: true,
            },
            title: "Notification Enabled",
            type: FieldType.Boolean,
            getElement: (item: ScheduledMaintenanceStateTimeline): ReactElement => {
              return (
                <CheckboxViewer
                  isChecked={item.shouldStatusPageSubscribersBeNotified as boolean}
                  text={item.shouldStatusPageSubscribersBeNotified ? "Yes" : "No"}
                />
              );
            },
          },
          {
            field: {
              subscriberNotificationStatus: true,
            },
            title: "Notification Status",
            type: FieldType.Text,
            getElement: (item: ScheduledMaintenanceStateTimeline): ReactElement => {
              const status = item.subscriberNotificationStatus;
              let statusColor = "gray";
              
              switch(status) {
                case StatusPageSubscriberNotificationStatus.Success:
                  statusColor = "green";
                  break;
                case StatusPageSubscriberNotificationStatus.Failed:
                  statusColor = "red";
                  break;
                case StatusPageSubscriberNotificationStatus.InProgress:
                  statusColor = "blue";
                  break;
                case StatusPageSubscriberNotificationStatus.Pending:
                  statusColor = "yellow";
                  break;
                case StatusPageSubscriberNotificationStatus.Skipped:
                  statusColor = "gray";
                  break;
              }
              
              return (
                <div>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-${statusColor}-100 text-${statusColor}-800`}>
                    {status || "Unknown"}
                  </span>
                  {item.notificationFailureReason && (
                    <div className="text-xs text-red-600 mt-1">
                      {item.notificationFailureReason}
                    </div>
                  )}
                </div>
              );
            },
          },
        ]}
        actionButtons={[
          {
            title: "Retry Notification",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Refresh,
            isVisible: (item: ScheduledMaintenanceStateTimeline) => {
              return item.subscriberNotificationStatus === StatusPageSubscriberNotificationStatus.Failed;
            },
            onClick: async (
              item: ScheduledMaintenanceStateTimeline,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                await ModelAPI.updateById({
                  modelType: ScheduledMaintenanceStateTimeline,
                  id: item.id!,
                  data: {
                    subscriberNotificationStatus: StatusPageSubscriberNotificationStatus.Pending,
                    notificationFailureReason: null,
                  },
                });
                onCompleteAction();
              } catch (err) {
                onError(err as Error);
              }
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default ScheduledMaintenanceDelete;
