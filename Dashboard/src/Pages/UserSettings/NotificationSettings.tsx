import DashboardNavigation from "../../Utils/Navigation";
import PageComponentProps from "../PageComponentProps";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import User from "Common/UI/Utils/User";
import UserNotificationSetting from "Common/Models/DatabaseModels/UserNotificationSetting";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  type GetModelTableFunctionProps = {
    eventOptions: Array<NotificationSettingEventType>;
    title: string;
    description: string;
  };

  type GetModelTableFuncitonType = (
    options: GetModelTableFunctionProps,
  ) => ReactElement;

  const getModelTable: GetModelTableFuncitonType = (
    options: GetModelTableFunctionProps,
  ): ReactElement => {
    return (
      <ModelTable<UserNotificationSetting>
        modelType={UserNotificationSetting}
        query={{
          projectId: DashboardNavigation.getProjectId()!,
          userId: User.getUserId().toString(),
          eventType: options.eventOptions,
        }}
        onBeforeCreate={(
          model: UserNotificationSetting,
        ): Promise<UserNotificationSetting> => {
          model.projectId = DashboardNavigation.getProjectId()!;
          model.userId = User.getUserId();
          return Promise.resolve(model);
        }}
        createVerb={"Add"}
        id="notification-settings"
        name={`User Settings > Notification Rules > ${options.title}`}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        cardProps={{
          title: options.title,
          description: options.description,
        }}
        noItemsMessage={
          "No notification settings found. Please add one to receive notifications."
        }
        formFields={[
          {
            field: {
              eventType: true,
            },
            title: "Event Type",
            description: "Select the event type.",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Select an event type",
            dropdownOptions: DropdownUtil.getDropdownOptionsFromArray(
              options.eventOptions,
            ),
          },
          {
            field: {
              alertByEmail: true,
            },
            title: "Alert By Email",
            description: "Select if you want to be alerted by email.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
          {
            field: {
              alertBySMS: true,
            },
            title: "Alert By SMS",
            description: "Select if you want to be alerted by SMS.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
          {
            field: {
              alertByCall: true,
            },
            title: "Alert By Call",
            description: "Select if you want to be alerted by call.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
        ]}
        showRefreshButton={true}
        filters={[]}
        columns={[
          {
            field: {
              eventType: true,
            },
            title: "Event Type",
            type: FieldType.Text,
          },
          {
            field: {
              alertByEmail: true,
            },
            title: "Email Alerts",
            type: FieldType.Boolean,
          },
          {
            field: {
              alertBySMS: true,
            },
            title: "SMS Alerts",
            type: FieldType.Boolean,
          },
          {
            field: {
              alertByCall: true,
            },
            title: "Call Alerts",
            type: FieldType.Boolean,
          },
        ]}
      />
    );
  };

  return (
    <Fragment>
      <div>
        {getModelTable({
          eventOptions: [
            NotificationSettingEventType.SEND_INCIDENT_NOTE_POSTED_OWNER_NOTIFICATION,
            NotificationSettingEventType.SEND_INCIDENT_OWNER_ADDED_NOTIFICATION,
            NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
            NotificationSettingEventType.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION,
          ],
          title: "Incident Notifications",
          description:
            "Here are the list of notification methods we will use when an event happens on an incident.",
        })}
      </div>

      <div>
        {getModelTable({
          eventOptions: [
            NotificationSettingEventType.SEND_MONITOR_OWNER_ADDED_NOTIFICATION,
            NotificationSettingEventType.SEND_MONITOR_CREATED_OWNER_NOTIFICATION,
            NotificationSettingEventType.SEND_MONITOR_STATUS_CHANGED_OWNER_NOTIFICATION,
            NotificationSettingEventType.SEND_MONITOR_NOTIFICATION_WHEN_NO_PROBES_ARE_MONITORING_THE_MONITOR,
            NotificationSettingEventType.SEND_MONITOR_NOTIFICATION_WHEN_PORBE_STATUS_CHANGES,
          ],
          title: "Monitor Notifications",
          description:
            "Here are the list of notification methods we will use when an event happens on a monitor.",
        })}
      </div>

      <div>
        {getModelTable({
          eventOptions: [
            NotificationSettingEventType.SEND_STATUS_PAGE_CREATED_OWNER_NOTIFICATION,
            NotificationSettingEventType.SEND_STATUS_PAGE_OWNER_ADDED_NOTIFICATION,
            NotificationSettingEventType.SEND_STATUS_PAGE_ANNOUNCEMENT_CREATED_OWNER_NOTIFICATION,
          ],
          title: "Status Page Notifications",
          description:
            "Here are the list of notification methods we will use when an event happens on a status page.",
        })}
      </div>

      <div>
        {getModelTable({
          eventOptions: [
            NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_NOTE_POSTED_OWNER_NOTIFICATION,
            NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_OWNER_ADDED_NOTIFICATION,
            NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_CREATED_OWNER_NOTIFICATION,
            NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_STATE_CHANGED_OWNER_NOTIFICATION,
          ],
          title: "Scheduled Maintenance Notifications",
          description:
            "Here are the list of notification methods we will use when an event happens on an incident.",
        })}
      </div>

      <div>
        {getModelTable({
          eventOptions: [
            NotificationSettingEventType.SEND_PROBE_STATUS_CHANGED_OWNER_NOTIFICATION,
            NotificationSettingEventType.SEND_PROBE_OWNER_ADDED_NOTIFICATION,
          ],
          title: "Probe Notifications",
          description:
            "Here are the list of notification methods we will use when an event happens on a custom probe.",
        })}
      </div>
    </Fragment>
  );
};

export default Settings;
