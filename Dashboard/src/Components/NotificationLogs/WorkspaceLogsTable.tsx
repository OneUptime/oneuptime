import React, { FunctionComponent, ReactElement } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import WorkspaceNotificationLog from "Common/Models/DatabaseModels/WorkspaceNotificationLog";
import FieldType from "Common/UI/Components/Types/FieldType";
import Columns from "Common/UI/Components/ModelTable/Columns";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import WorkspaceNotificationStatus from "Common/Types/Workspace/WorkspaceNotificationStatus";
import ProjectUtil from "Common/UI/Utils/Project";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";

export interface WorkspaceLogsTableProps {
  id?: string;
  userPreferencesKey?: string;
  name?: string;
  cardProps?: { title: string; description?: string };
  noItemsMessage?: string;
  query?: Record<string, any>;
  selectMoreFields?: Record<string, boolean>;
  showViewIdButton?: boolean;
  isViewable?: boolean;
  actionButtons?: Array<ActionButtonSchema<WorkspaceNotificationLog>>;
  columns?: Columns<WorkspaceNotificationLog>;
  filters?: Array<Filter<WorkspaceNotificationLog>>;
}

const WorkspaceLogsTable: FunctionComponent<WorkspaceLogsTableProps> = (
  props: WorkspaceLogsTableProps,
): ReactElement => {
  const defaultColumns: Columns<WorkspaceNotificationLog> = [
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

  const defaultFilters: Array<Filter<WorkspaceNotificationLog>> = [
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
    <ModelTable<WorkspaceNotificationLog>
      modelType={WorkspaceNotificationLog}
      id={props.id || "workspace-logs-table"}
      name={props.name || "Workspace Logs"}
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      showViewIdButton={props.showViewIdButton ?? true}
  isViewable={props.isViewable}
      userPreferencesKey={props.userPreferencesKey || "workspace-logs-table"}
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
        ...(props.query || {}),
      }}
      selectMoreFields={{
        statusMessage: true,
        messageSummary: true,
        channelId: true,
        ...(props.selectMoreFields || {}),
      }}
      cardProps={{
        title: props.cardProps?.title || "Workspace Logs",
        description:
          props.cardProps?.description ||
          "Messages sent to Slack / Teams.",
      }}
      noItemsMessage={props.noItemsMessage || "No Workspace logs."}
      showRefreshButton={true}
  columns={props.columns || defaultColumns}
  filters={props.filters || defaultFilters}
  actionButtons={props.actionButtons}
    />
  );
};

export default WorkspaceLogsTable;
