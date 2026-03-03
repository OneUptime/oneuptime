import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import User from "Common/UI/Utils/User";
import UserNotificationSetting from "Common/Models/DatabaseModels/UserNotificationSetting";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Includes from "Common/Types/BaseDatabase/Includes";
import { ShowAs } from "Common/UI/Components/ModelTable/BaseModelTable";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Color from "Common/Types/Color";
import {
  Blue500,
  Gray500,
  Green500,
  Orange500,
  Purple500,
  Sky500,
} from "Common/Types/BrandColors";

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
        userPreferencesKey="user-notification-settings-table"
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          userId: User.getUserId().toString(),
          eventType: new Includes(options.eventOptions),
        }}
        onBeforeCreate={(
          model: UserNotificationSetting,
        ): Promise<UserNotificationSetting> => {
          model.projectId = ProjectUtil.getCurrentProjectId()!;
          model.userId = User.getUserId();
          return Promise.resolve(model);
        }}
        createVerb={"Add"}
        showAs={ShowAs.List}
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
              alertByWhatsApp: true,
            },
            title: "Alert By WhatsApp",
            description: "Select if you want to be alerted by WhatsApp.",
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
          {
            field: {
              alertByPush: true,
            },
            title: "Alert By Push Notification",
            description:
              "Select if you want to be alerted by push notifications.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
        ]}
        showRefreshButton={true}
        filters={[]}
        selectMoreFields={{
          alertBySMS: true,
          alertByWhatsApp: true,
          alertByCall: true,
          alertByPush: true,
        }}
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
            title: "Delivery Channels",
            type: FieldType.Element,
            getElement: (item: UserNotificationSetting): ReactElement => {
              type ChannelDescriptor = {
                key: string;
                label: string;
                enabled: boolean;
                icon: IconProp;
                color: Color;
              };

              const channels: Array<ChannelDescriptor> = [
                {
                  key: "email",
                  label: "Email",
                  enabled: Boolean(item.alertByEmail),
                  icon: IconProp.Email,
                  color: Blue500,
                },
                {
                  key: "sms",
                  label: "SMS",
                  enabled: Boolean(item.alertBySMS),
                  icon: IconProp.SMS,
                  color: Purple500,
                },
                {
                  key: "call",
                  label: "Call",
                  enabled: Boolean(item.alertByCall),
                  icon: IconProp.Call,
                  color: Orange500,
                },
                {
                  key: "push",
                  label: "Push",
                  enabled: Boolean(item.alertByPush),
                  icon: IconProp.Notification,
                  color: Sky500,
                },
                {
                  key: "whatsapp",
                  label: "WhatsApp",
                  enabled: Boolean(item.alertByWhatsApp),
                  icon: IconProp.WhatsApp,
                  color: Green500,
                },
              ];

              return (
                <div className="flex flex-wrap gap-2 mt-2">
                  {channels.map((channel: ChannelDescriptor) => {
                    const stateClasses: string = channel.enabled
                      ? "border-emerald-500/60 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200"
                      : "border-gray-200 bg-gray-100 text-gray-500 dark:border-gray-600 dark:bg-gray-700/60 dark:text-gray-300";

                    return (
                      <span
                        key={channel.key}
                        aria-label={`${channel.label} alerts ${channel.enabled ? "enabled" : "disabled"}`}
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${stateClasses}`}
                      >
                        <Icon
                          icon={channel.icon}
                          className="h-3 w-3"
                          size={SizeProp.Small}
                          color={channel.enabled ? channel.color : Gray500}
                        />
                        <span>{channel.label}</span>
                        <span
                          className={`text-[10px] font-semibold uppercase tracking-wide ${channel.enabled ? "text-emerald-600 dark:text-emerald-200" : "text-gray-400 dark:text-gray-400"}`}
                        >
                          {channel.enabled ? "On" : "Off"}
                        </span>
                      </span>
                    );
                  })}
                </div>
              );
            },
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
            NotificationSettingEventType.SEND_ALERT_NOTE_POSTED_OWNER_NOTIFICATION,
            NotificationSettingEventType.SEND_ALERT_OWNER_ADDED_NOTIFICATION,
            NotificationSettingEventType.SEND_ALERT_CREATED_OWNER_NOTIFICATION,
            NotificationSettingEventType.SEND_ALERT_STATE_CHANGED_OWNER_NOTIFICATION,
          ],
          title: "Alert Notifications",
          description:
            "Here are the list of notification methods we will use when an event happens on an alert.",
        })}
      </div>

      <div>
        {getModelTable({
          eventOptions: [
            NotificationSettingEventType.SEND_ALERT_EPISODE_NOTE_POSTED_OWNER_NOTIFICATION,
            NotificationSettingEventType.SEND_ALERT_EPISODE_OWNER_ADDED_NOTIFICATION,
            NotificationSettingEventType.SEND_ALERT_EPISODE_CREATED_OWNER_NOTIFICATION,
            NotificationSettingEventType.SEND_ALERT_EPISODE_STATE_CHANGED_OWNER_NOTIFICATION,
          ],
          title: "Alert Episode Notifications",
          description:
            "Here are the list of notification methods we will use when an event happens on an alert episode.",
        })}
      </div>

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
            NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER,
            NotificationSettingEventType.SEND_WHEN_USER_IS_NEXT_ON_CALL_ROSTER,
            NotificationSettingEventType.SEND_WHEN_USER_IS_ADDED_TO_ON_CALL_POLICY,
            NotificationSettingEventType.SEND_WHEN_USER_IS_REMOVED_FROM_ON_CALL_POLICY,
            NotificationSettingEventType.SEND_WHEN_USER_IS_NO_LONGER_ACTIVE_ON_ON_CALL_ROSTER,
          ],
          title: "On-Call Notifications",
          description:
            "Here are the list of notification methods we will use when an event happens on an alert.",
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
