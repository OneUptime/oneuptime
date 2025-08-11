import React, { FunctionComponent, ReactElement } from "react";
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
}

const EmailLogsTable: FunctionComponent<EmailLogsTableProps> = (
  props: EmailLogsTableProps,
): ReactElement => {
  const defaultColumns: Columns<EmailLog> = [
    { field: { toEmail: true }, title: "To", type: FieldType.Email },
    {
      field: { fromEmail: true },
      title: "From",
      type: FieldType.Email,
      hideOnMobile: true,
    },
    {
      field: { subject: true },
      title: "Subject",
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
    <ModelTable<EmailLog>
      modelType={EmailLog}
      id={props.id || "email-logs-table"}
      name={props.name || "Email Logs"}
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      showViewIdButton={props.showViewIdButton ?? true}
  isViewable={props.isViewable}
      userPreferencesKey={props.userPreferencesKey || "email-logs-table"}
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
        ...(props.query || {}),
      }}
      selectMoreFields={{ statusMessage: true, ...(props.selectMoreFields || {}) }}
      cardProps={{
        title: props.cardProps?.title || "Email Logs",
        description: props.cardProps?.description || "Emails sent.",
      }}
      noItemsMessage={props.noItemsMessage || "No email logs."}
      showRefreshButton={true}
  columns={props.columns || defaultColumns}
  filters={props.filters || defaultFilters}
  actionButtons={props.actionButtons}
    />
  );
};

export default EmailLogsTable;
