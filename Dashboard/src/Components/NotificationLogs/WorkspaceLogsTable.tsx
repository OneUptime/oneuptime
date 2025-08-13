import React, { FunctionComponent, ReactElement, useState } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import WorkspaceNotificationLog from "Common/Models/DatabaseModels/WorkspaceNotificationLog";
import FieldType from "Common/UI/Components/Types/FieldType";
import Columns from "Common/UI/Components/ModelTable/Columns";
import Pill from "Common/UI/Components/Pill/Pill";
import {
  Green,
  Red,
  Blue,
  Purple,
  Orange,
  Yellow,
} from "Common/Types/BrandColors";
import WorkspaceNotificationStatus from "Common/Types/Workspace/WorkspaceNotificationStatus";
import WorkspaceNotificationActionType from "Common/Types/Workspace/WorkspaceNotificationActionType";
import ProjectUtil from "Common/UI/Utils/Project";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/MarkdownViewer";
import Query from "Common/Types/BaseDatabase/Query";
import BaseModel from "Common/Types/Workflow/Components/BaseModel";
import UserElement from "../User/User";
import User from "Common/Models/DatabaseModels/User";

export interface WorkspaceLogsTableProps {
  query?: Query<BaseModel>;
  singularName?: string;
}

const WorkspaceLogsTable: FunctionComponent<WorkspaceLogsTableProps> = (
  props: WorkspaceLogsTableProps,
): ReactElement => {
  const [showModal, setShowModal] = useState<boolean>(false);
  const [modalText, setModalText] = useState<string>("");
  const [modalTitle, setModalTitle] = useState<string>("");
  const defaultColumns: Columns<WorkspaceNotificationLog> = [
    {
      field: { workspaceType: true },
      title: "Workspace",
      type: FieldType.Text,
      noValueMessage: "-",
    },
    {
      field: { actionType: true },
      title: "Action",
      type: FieldType.Text,
      getElement: (item: WorkspaceNotificationLog): ReactElement => {
        const actionType: WorkspaceNotificationActionType | undefined = item[
          "actionType"
        ] as WorkspaceNotificationActionType | undefined;

        if (!actionType) {
          return <></>;
        }

        // Map action type to a brand color
        const colorMap: Record<WorkspaceNotificationActionType, typeof Blue> = {
          [WorkspaceNotificationActionType.SendMessage]: Blue,
          [WorkspaceNotificationActionType.CreateChannel]: Purple,
          [WorkspaceNotificationActionType.InviteUser]: Orange,
          [WorkspaceNotificationActionType.ButtonPressed]: Yellow,
        };

        const textMap: Record<WorkspaceNotificationActionType, string> = {
          [WorkspaceNotificationActionType.SendMessage]: "Send Message",
          [WorkspaceNotificationActionType.CreateChannel]: "Create Channel",
          [WorkspaceNotificationActionType.InviteUser]: "Invite User",
          [WorkspaceNotificationActionType.ButtonPressed]: "Button Pressed",
        };

        return (
          <Pill
            isMinimal={true}
            color={colorMap[actionType] || Blue}
            text={textMap[actionType] || "Unknown Action"}
          />
        );
      },
    },
    {
      field: { channelName: true },
      title: "Channel",
      type: FieldType.Text,
      noValueMessage: "-",
    },
    {
      field: {
        user: {
          name: true,
          email: true,
          profilePictureId: true,
        },
      },
      title: "User",
      type: FieldType.Text,
      hideOnMobile: true,
      noValueMessage: "-",
      getElement: (item: WorkspaceNotificationLog): ReactElement => {
        if (!item["user"]) {
          return <p>-</p>;
        }

        return <UserElement user={item["user"] as User} />;
      },
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
    <>
      <ModelTable<WorkspaceNotificationLog>
        modelType={WorkspaceNotificationLog}
        id={
          props.singularName
            ? `${props.singularName.replace(/\s+/g, "-").toLowerCase()}-workspace-logs-table`
            : "workspace-logs-table"
        }
        name="Workspace Logs"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        showViewIdButton={true}
        isViewable={false}
        userPreferencesKey={
          props.singularName
            ? `${props.singularName.replace(/\s+/g, "-").toLowerCase()}-workspace-logs-table`
            : "workspace-logs-table"
        }
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          ...(props.query || {}),
        }}
        selectMoreFields={{
          statusMessage: true,
          message: true,
          channelId: true,
          user: {
            name: true,
          },
        }}
        cardProps={{
          title: "Workspace Logs",
          description: props.singularName
            ? `Messages sent to Slack / Teams for this ${props.singularName}.`
            : "Messages sent to Slack / Teams.",
        }}
        noItemsMessage={
          props.singularName
            ? `No Workspace logs for this ${props.singularName}.`
            : "No Workspace logs."
        }
        showRefreshButton={true}
        columns={defaultColumns}
        filters={defaultFilters}
        actionButtons={[
          {
            title: "View Message",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.List,
            onClick: async (
              item: WorkspaceNotificationLog,
              onCompleteAction: VoidFunction,
            ) => {
              setModalText(item["message"] as string);
              setModalTitle("Message");
              setShowModal(true);
              onCompleteAction();
            },
          },
          {
            title: "View Status Message",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Error,
            onClick: async (
              item: WorkspaceNotificationLog,
              onCompleteAction: VoidFunction,
            ) => {
              setModalText(item["statusMessage"] as string);
              setModalTitle("Status Message");
              setShowModal(true);
              onCompleteAction();
            },
          },
        ]}
      />

      {showModal && (
        <ConfirmModal
          title={modalTitle}
          description={<MarkdownViewer text={modalText} />}
          onSubmit={() => {
            setShowModal(false);
          }}
          submitButtonText="Close"
          submitButtonType={ButtonStyleType.NORMAL}
        />
      )}
    </>
  );
};

export default WorkspaceLogsTable;
