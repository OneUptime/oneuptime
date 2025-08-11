import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import WorkspaceNotificationLog from "Common/Models/DatabaseModels/WorkspaceNotificationLog";
import FieldType from "Common/UI/Components/Types/FieldType";
import Columns from "Common/UI/Components/ModelTable/Columns";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import WorkspaceNotificationStatus from "Common/Types/Workspace/WorkspaceNotificationStatus";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import WorkspaceLogsTable from "../../Components/NotificationLogs/WorkspaceLogsTable";

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
    { field: { channelName: true }, title: "Channel", type: FieldType.Text },
    {
      field: { threadId: true },
      title: "Thread ID",
      type: FieldType.Text,
      hideOnMobile: true,
    },
    { field: { createdAt: true }, title: "Sent at", type: FieldType.DateTime },
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
    { field: { createdAt: true }, title: "Sent at", type: FieldType.Date },
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
        title: "Workspace Logs",
        description: "Messages sent to Slack / Teams from this project.",
      }}
      noItemsMessage="No Workspace logs for this project."
      columns={columns}
      filters={filters}
      showViewIdButton
    />
  );
};

export default SettingsWorkspaceLog;
