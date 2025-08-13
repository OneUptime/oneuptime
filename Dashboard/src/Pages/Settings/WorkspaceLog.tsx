import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import WorkspaceNotificationLog from "Common/Models/DatabaseModels/WorkspaceNotificationLog";
import FieldType from "Common/UI/Components/Types/FieldType";
import Columns from "Common/UI/Components/ModelTable/Columns";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red, Blue, Purple, Orange } from "Common/Types/BrandColors";
import WorkspaceNotificationStatus from "Common/Types/Workspace/WorkspaceNotificationStatus";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import WorkspaceLogsTable from "../../Components/NotificationLogs/WorkspaceLogsTable";
import WorkspaceNotificationActionType from "Common/Types/Workspace/WorkspaceNotificationActionType";
import Color from "Common/Types/Color";

const SettingsWorkspaceLog: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // Ensure project scope via query; no navigation guard needed here.

  const columns: Columns<WorkspaceNotificationLog> = [
    {
      field: { workspaceType: true },
      title: "Workspace",
      type: FieldType.Text,
    },
    {
      field: { actionType: true },
      title: "Action Type",
      type: FieldType.Text,
      getElement: (item: WorkspaceNotificationLog): ReactElement => {
        if (item["actionType"]) {
          let color: Color = Green;
          let text: string = item["actionType"] as string;

          // Color code different action types
          switch (item["actionType"]) {
            case WorkspaceNotificationActionType.MessageSent:
              text = "Message";
              color = Green;
              break;
            case WorkspaceNotificationActionType.ChannelCreated:
              text = "Channel Created";
              color = Blue;
              break;
            case WorkspaceNotificationActionType.UserInvited:
              text = "User Invited";
              color = Purple;
              break;
            case WorkspaceNotificationActionType.ButtonPressed:
              text = "Button Pressed";
              color = Orange;
              break;
          }

          return <Pill isMinimal={false} color={color} text={text} />;
        }
        return <></>;
      },
    },
    { field: { channelName: true }, title: "Channel", type: FieldType.Text },
    {
      field: { threadId: true },
      title: "Thread ID",
      type: FieldType.Text,
      hideOnMobile: true,
    },
    { field: { createdAt: true }, title: "Date", type: FieldType.DateTime },
    {
      field: { status: true },
      title: "Status",
      type: FieldType.Text,
      getElement: (item: WorkspaceNotificationLog): ReactElement => {
        if (item["status"]) {
          return (
            <Pill
              isMinimal={false}
              color={
                item["status"] === WorkspaceNotificationStatus.Success
                  ? Green
                  : Red
              }
              text={item["status"] as string}
            />
          );
        }
        return <></>;
      },
    },
  ];

  const filters: Array<Filter<WorkspaceNotificationLog>> = [
    { field: { createdAt: true }, title: "Date", type: FieldType.Date },
    {
      field: { actionType: true },
      title: "Action Type",
      type: FieldType.Dropdown,
      filterDropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
        WorkspaceNotificationActionType,
      ),
    },
    {
      field: { status: true },
      title: "Status",
      type: FieldType.Dropdown,
      filterDropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
        WorkspaceNotificationStatus,
      ),
    },
    {
      field: { workspaceType: true },
      title: "Workspace",
      type: FieldType.Dropdown,
      filterDropdownOptions:
        DropdownUtil.getDropdownOptionsFromEnum(WorkspaceType),
    },
  ];

  return (
    <WorkspaceLogsTable
      id="settings-workspace-logs-table"
      userPreferencesKey="settings-workspace-logs-table"
      name="Workspace Logs"
      selectMoreFields={{
        statusMessage: true,
        messageSummary: true,
        channelId: true,
      }}
      cardProps={{
        title: "Workspace Activity Logs",
        description:
          "All workspace activities including messages, channel creation, user invitations, and button interactions for Slack / Teams.",
      }}
      noItemsMessage="No workspace activity logs for this project."
      columns={columns}
      filters={filters}
      showViewIdButton
    />
  );
};

export default SettingsWorkspaceLog;
