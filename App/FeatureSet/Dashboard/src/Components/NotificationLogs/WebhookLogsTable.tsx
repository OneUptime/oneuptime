import React, { FunctionComponent, ReactElement, useState } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import WebhookLog from "Common/Models/DatabaseModels/WebhookLog";
import FieldType from "Common/UI/Components/Types/FieldType";
import Columns from "Common/UI/Components/ModelTable/Columns";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Grey, Red } from "Common/Types/BrandColors";
import WebhookStatus from "Common/Types/WebhookStatus";
import ProjectUtil from "Common/UI/Utils/Project";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Query from "Common/Types/BaseDatabase/Query";
import BaseModel from "Common/Types/Workflow/Components/BaseModel";
import UserElement from "../User/User";
import User from "Common/Models/DatabaseModels/User";
import Color from "Common/Types/Color";

export interface WebhookLogsTableProps {
  query?: Query<BaseModel>;
  singularName?: string;
}

const WebhookLogsTable: FunctionComponent<WebhookLogsTableProps> = (
  props: WebhookLogsTableProps,
): ReactElement => {
  const [showModal, setShowModal] = useState<boolean>(false);
  const [modalText, setModalText] = useState<string>("");
  const [modalTitle, setModalTitle] = useState<string>("");

  const getStatusColor: (status?: WebhookStatus) => Color = (
    status?: WebhookStatus,
  ): Color => {
    switch (status) {
      case WebhookStatus.Success:
        return Green;
      case WebhookStatus.Error:
        return Red;
      default:
        return Grey;
    }
  };

  const defaultColumns: Columns<WebhookLog> = [
    {
      field: { webhookUrl: true },
      title: "Webhook URL",
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
      getElement: (item: WebhookLog): ReactElement => {
        if (!item["user"]) {
          return <p>-</p>;
        }
        return <UserElement user={item["user"] as User} />;
      },
    },
    {
      field: { responseStatusCode: true },
      title: "HTTP Status",
      type: FieldType.Number,
      noValueMessage: "-",
    },
    { field: { createdAt: true }, title: "Sent at", type: FieldType.DateTime },
    {
      field: { status: true },
      title: "Status",
      type: FieldType.Text,
      getElement: (item: WebhookLog): ReactElement => {
        const statusValue: string | undefined =
          (item["status"] as string | undefined) || undefined;

        if (!statusValue) {
          return <></>;
        }

        const normalizedStatus: WebhookStatus | undefined = (
          Object.values(WebhookStatus) as Array<string>
        ).includes(statusValue)
          ? (statusValue as WebhookStatus)
          : undefined;

        return (
          <Pill
            isMinimal={false}
            color={getStatusColor(normalizedStatus)}
            text={statusValue}
          />
        );
      },
    },
  ];

  const defaultFilters: Array<Filter<WebhookLog>> = [
    { field: { createdAt: true }, title: "Sent at", type: FieldType.Date },
    { field: { status: true }, title: "Status", type: FieldType.Dropdown },
  ];

  return (
    <>
      <ModelTable<WebhookLog>
        modelType={WebhookLog}
        id={
          props.singularName
            ? `${props.singularName.replace(/\s+/g, "-").toLowerCase()}-webhook-logs-table`
            : "webhook-logs-table"
        }
        name="Webhook Logs"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        showViewIdButton={true}
        isViewable={false}
        userPreferencesKey={
          props.singularName
            ? `${props.singularName.replace(/\s+/g, "-").toLowerCase()}-webhook-logs-table`
            : "webhook-logs-table"
        }
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          ...(props.query || {}),
        }}
        selectMoreFields={{
          requestBody: true,
          responseBody: true,
          statusMessage: true,
          user: {
            name: true,
          },
        }}
        cardProps={{
          title: "Webhook Logs",
          description: props.singularName
            ? `Outbound webhook requests sent for this ${props.singularName}.`
            : "Outbound webhook requests sent for this project.",
        }}
        noItemsMessage={
          props.singularName
            ? `No webhook logs for this ${props.singularName}.`
            : "No webhook logs."
        }
        showRefreshButton={true}
        columns={defaultColumns}
        filters={defaultFilters}
        actionButtons={[
          {
            title: "View Request",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.List,
            onClick: async (
              item: WebhookLog,
              onCompleteAction: VoidFunction,
            ) => {
              setModalText((item["requestBody"] as string) || "-");
              setModalTitle("Request Body");
              setShowModal(true);
              onCompleteAction();
            },
          },
          {
            title: "View Response",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.List,
            onClick: (item: WebhookLog, onCompleteAction: VoidFunction) => {
              setModalTitle("Response");
              const parts: Array<string> = [];
              const status: string | undefined = (
                item["responseStatusCode"] as number | undefined
              )?.toString();
              if (status) {
                parts.push(`HTTP ${status}`);
              }
              const body: string | undefined = item["responseBody"] as
                | string
                | undefined;
              if (body) {
                parts.push(body);
              }
              setModalText(parts.join("\n\n") || "-");
              setShowModal(true);
              onCompleteAction();
            },
          },
          {
            title: "View Status Message",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Error,
            onClick: (item: WebhookLog, onCompleteAction: VoidFunction) => {
              setModalTitle("Status Message");
              setModalText((item["statusMessage"] as string) || "-");
              setShowModal(true);
              onCompleteAction();
            },
          },
        ]}
      />

      {showModal && (
        <ConfirmModal
          title={modalTitle}
          description={modalText || "-"}
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

export default WebhookLogsTable;
