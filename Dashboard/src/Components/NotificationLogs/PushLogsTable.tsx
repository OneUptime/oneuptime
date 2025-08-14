import React, { FunctionComponent, ReactElement, useState } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import PushNotificationLog from "Common/Models/DatabaseModels/PushNotificationLog";
import FieldType from "Common/UI/Components/Types/FieldType";
import Columns from "Common/UI/Components/ModelTable/Columns";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import PushStatus from "Common/Types/PushNotification/PushStatus";
import ProjectUtil from "Common/UI/Utils/Project";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Query from "Common/Types/BaseDatabase/Query";
import BaseModel from "Common/Types/Workflow/Components/BaseModel";
import UserElement from "../User/User";
import User from "Common/Models/DatabaseModels/User";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/MarkdownViewer";

export interface PushLogsTableProps {
  query?: Query<BaseModel>;
  singularName?: string;
}

const PushLogsTable: FunctionComponent<PushLogsTableProps> = (
  props: PushLogsTableProps,
): ReactElement => {
  const [showModal, setShowModal] = useState<boolean>(false);
  const [modalText, setModalText] = useState<string>("");
  const [modalTitle, setModalTitle] = useState<string>("");
  const defaultColumns: Columns<PushNotificationLog> = [
    {
      field: { deviceName: true },
      title: "Device Name",
      type: FieldType.Text,
      hideOnMobile: true,
      noValueMessage: "Unknown Device",
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
      getElement: (item: PushNotificationLog): ReactElement => {
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
      getElement: (item: PushNotificationLog): ReactElement => {
        if (item["status"]) {
          return (
            <Pill
              isMinimal={false}
              color={item["status"] === PushStatus.Success ? Green : Red}
              text={item["status"] as string}
            />
          );
        }
        return <></>;
      },
    },
  ];

  const defaultFilters: Array<Filter<PushNotificationLog>> = [
    { field: { createdAt: true }, title: "Sent at", type: FieldType.Date },
    {
      field: { deviceName: true },
      title: "Device Name",
      type: FieldType.Text,
    },
    {
      field: { status: true },
      title: "Status",
      type: FieldType.Dropdown,
      filterDropdownOptions:
        DropdownUtil.getDropdownOptionsFromEnum(PushStatus),
    },
  ];

  return (
    <>
      <ModelTable<PushNotificationLog>
        modelType={PushNotificationLog}
        id={
          props.singularName
            ? `${props.singularName.replace(/\s+/g, "-").toLowerCase()}-push-logs-table`
            : "push-logs-table"
        }
        name="Push Logs"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        showViewIdButton={true}
        isViewable={false}
        userPreferencesKey={
          props.singularName
            ? `${props.singularName.replace(/\s+/g, "-").toLowerCase()}-push-logs-table`
            : "push-logs-table"
        }
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          ...(props.query || {}),
        }}
        selectMoreFields={{
          title: true,
          statusMessage: true,
          body: true,
          deviceName: true,
          user: {
            name: true,
          },
        }}
        cardProps={{
          title: "Push Logs",
          description: props.singularName
            ? `Push notifications sent for this ${props.singularName}.`
            : "Push notifications sent for this project.",
        }}
        noItemsMessage={
          props.singularName
            ? `No Push logs for this ${props.singularName}.`
            : "No Push logs."
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
              item: PushNotificationLog,
              onCompleteAction: VoidFunction,
            ) => {
              const title: string = item["title"] as string;
              const body: string = item["body"] as string;
              const combinedMessage: string = `${title ? `**${title}**\n\n` : ""}${body ? `${body}` : ""}`;
              setModalText(combinedMessage);
              setModalTitle("Push Notification Message");
              setShowModal(true);
              onCompleteAction();
            },
          },
          {
            title: "View Status Message",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Error,
            onClick: async (
              item: PushNotificationLog,
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

export default PushLogsTable;
