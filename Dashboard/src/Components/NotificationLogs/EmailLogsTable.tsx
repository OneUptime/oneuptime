import React, { FunctionComponent, ReactElement, useState } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import EmailLog from "Common/Models/DatabaseModels/EmailLog";
import FieldType from "Common/UI/Components/Types/FieldType";
import Columns from "Common/UI/Components/ModelTable/Columns";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import EmailStatus from "Common/Types/Mail/MailStatus";
import ProjectUtil from "Common/UI/Utils/Project";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";

export interface EmailLogsTableProps {
  id?: string;
  userPreferencesKey?: string;
  name?: string;
  cardProps?: { title: string; description?: string };
  noItemsMessage?: string;
  query?: Record<string, any>;
  selectMoreFields?: Record<string, boolean>;
  showViewIdButton?: boolean;
  isViewable?: boolean;
  actionButtons?: Array<ActionButtonSchema<EmailLog>>;
  columns?: Columns<EmailLog>;
  filters?: Array<Filter<EmailLog>>;
  singularName?: string; // e.g., "incident"
  pluralName?: string; // e.g., "incidents"
}

const EmailLogsTable: FunctionComponent<EmailLogsTableProps> = (
  props: EmailLogsTableProps,
): ReactElement => {
  const [showModal, setShowModal] = useState<boolean>(false);
  const [modalText, setModalText] = useState<string>("");
  const [modalTitle, setModalTitle] = useState<string>("");

  const defaultColumns: Columns<EmailLog> = [
    { field: { toEmail: true }, title: "To", type: FieldType.Email },
    {
      field: { fromEmail: true },
      title: "From",
      type: FieldType.Email,
      hideOnMobile: true,
    },
    {
      field: { user: { name: true } },
      title: "User",
      type: FieldType.Text,
      hideOnMobile: true,
    },
    { field: { createdAt: true }, title: "Sent at", type: FieldType.DateTime },
    {
      field: { status: true },
      title: "Status",
      type: FieldType.Text,
      getElement: (item: EmailLog): ReactElement => {
        if (item["status"]) {
          return (
            <Pill
              isMinimal={false}
              color={item["status"] === EmailStatus.Success ? Green : Red}
              text={item["status"] as string}
            />
          );
        }
        return <></>;
      },
    },
  ];

  const defaultFilters: Array<Filter<EmailLog>> = [
    { field: { createdAt: true }, title: "Sent at", type: FieldType.Date },
    { field: { status: true }, title: "Status", type: FieldType.Dropdown },
  ];

  return (
    <>
      <ModelTable<EmailLog>
        modelType={EmailLog}
        id={
          props.id ||
          (props.singularName
            ? `${props.singularName.replace(/\s+/g, "-").toLowerCase()}-email-logs-table`
            : "email-logs-table")
        }
        name={props.name || "Email Logs"}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        showViewIdButton={props.showViewIdButton ?? true}
        isViewable={props.isViewable}
        userPreferencesKey={
          props.userPreferencesKey ||
          (props.singularName
            ? `${props.singularName.replace(/\s+/g, "-").toLowerCase()}-email-logs-table`
            : "email-logs-table")
        }
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          ...(props.query || {}),
        }}
        selectMoreFields={{
          subject: true,
          statusMessage: true,
          user: {
            name: true,
          },
          ...(props.selectMoreFields || {}),
        }}
        cardProps={{
          title: props.cardProps?.title || "Email Logs",
          description:
            props.cardProps?.description ||
            (props.singularName
              ? `Emails sent for this ${props.singularName}.`
              : "Emails sent for this project."),
        }}
        noItemsMessage={
          props.noItemsMessage ||
          (props.singularName
            ? `No email logs for this ${props.singularName}.`
            : props.pluralName
              ? `No ${props.pluralName.toLowerCase()} email logs.`
              : "No email logs.")
        }
        showRefreshButton={true}
        columns={props.columns || defaultColumns}
        filters={props.filters || defaultFilters}
        actionButtons={
          props.actionButtons || [
            {
              title: "View Subject",
              buttonStyleType: ButtonStyleType.NORMAL,
              icon: IconProp.List,
              onClick: async (
                item: EmailLog,
                onCompleteAction: VoidFunction,
              ) => {
                setModalText(JSON.stringify(item["subject"]) as string);
                setModalTitle("Subject of Email Message");
                setShowModal(true);
                onCompleteAction();
              },
            },
            {
              title: "View Status Message",
              buttonStyleType: ButtonStyleType.NORMAL,
              icon: IconProp.Error,
              onClick: async (
                item: EmailLog,
                onCompleteAction: VoidFunction,
              ) => {
                setModalText(item["statusMessage"] as string);
                setModalTitle("Status Message");
                setShowModal(true);
                onCompleteAction();
              },
            },
          ]
        }
      />

      {showModal && (
        <ConfirmModal
          title={modalTitle}
          description={modalText}
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

export default EmailLogsTable;
