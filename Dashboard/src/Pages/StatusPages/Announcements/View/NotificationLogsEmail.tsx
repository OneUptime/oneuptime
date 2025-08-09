import PageComponentProps from "../../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
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

const AnnouncementEmailLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const columns: Columns<EmailLog> = [
    { field: { toEmail: true }, title: "To", type: FieldType.Email },
    { field: { fromEmail: true }, title: "From", type: FieldType.Email, hideOnMobile: true },
    { field: { subject: true }, title: "Subject", type: FieldType.Text, hideOnMobile: true },
    { field: { createdAt: true }, title: "Sent at", type: FieldType.DateTime },
    { field: { status: true }, title: "Status", type: FieldType.Text, getElement: (item: EmailLog): ReactElement => {
      if (item["status"]) {
        return (
          <Pill isMinimal={false} color={item["status"] === EmailStatus.Success ? Green : Red} text={item["status"] as string} />
        );
      }
      return <></>;
    } },
  ];

  const filters: Array<Filter<EmailLog>> = [
    { field: { createdAt: true }, title: "Sent at", type: FieldType.Date },
    { field: { status: true }, title: "Status", type: FieldType.Dropdown },
  ];

  return (
    <ModelTable<EmailLog>
      modelType={EmailLog}
      id="announcement-email-logs-table"
      name="Email Logs"
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      showViewIdButton={true}
      userPreferencesKey="announcement-email-logs-table"
      query={{ projectId: ProjectUtil.getCurrentProjectId()!, statusPageAnnouncementId: modelId }}
      selectMoreFields={{ statusMessage: true }}
      cardProps={{ title: "Email Logs", description: "Emails sent for this announcement." }}
      noItemsMessage="No email logs for this announcement."
      showRefreshButton={true}
      columns={columns}
      filters={filters}
    />
  );
};

export default AnnouncementEmailLogs;
