import CustomSMTPElement from "../../Components/CustomSMTP/CustomSMTPView";
import PageComponentProps from "../PageComponentProps";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Columns from "Common/UI/Components/ModelTable/Columns";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import FieldType from "Common/UI/Components/Types/FieldType";
import EmailLog from "Common/Models/DatabaseModels/EmailLog";
import ProjectSmtpConfig from "Common/Models/DatabaseModels/ProjectSmtpConfig";
import React, { Fragment, FunctionComponent, ReactElement, useState } from "react";
import EmailLogsTable from "../../Components/NotificationLogs/EmailLogsTable";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import EmailStatus from "Common/Types/Mail/MailStatus";
import DropdownUtil from "Common/UI/Utils/Dropdown";

const EmailLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [showViewEmailTextModal, setShowViewEmailTextModal] =
    useState<boolean>(false);
  const [EmailText, setEmailText] = useState<string>("");
  const [EmailModelTitle, setEmailModalTitle] = useState<string>("");

  const filters: Array<Filter<EmailLog>> = [
    { field: { _id: true }, title: "Log ID", type: FieldType.ObjectID },
    { field: { fromEmail: true }, title: "From Email", type: FieldType.Email },
    { field: { toEmail: true }, title: "To Email", type: FieldType.Email },
    { field: { createdAt: true }, title: "Sent at", type: FieldType.Date },
    {
      field: { status: true },
      title: "Status",
      type: FieldType.Dropdown,
      filterDropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(EmailStatus),
    },
  ];

  return (
    <Fragment>
      <>
        <EmailLogsTable
          id="Email-logs-table"
          userPreferencesKey="email-logs-table"
          name="Email Logs"
          showViewIdButton
          selectMoreFields={{ subject: true, statusMessage: true }}
          columns={[
            {
              field: { projectSmtpConfig: { name: true } },
              title: "SMTP Server",
              type: FieldType.Element,
              getElement: (item: EmailLog): ReactElement => (
                <CustomSMTPElement
                  smtp={item["projectSmtpConfig"] as ProjectSmtpConfig}
                />
              ),
            },
            { field: { fromEmail: true }, title: "From Email", type: FieldType.Email, hideOnMobile: true },
            { field: { toEmail: true }, title: "To Email", type: FieldType.Email },
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
          ] as Columns<EmailLog>}
          filters={filters}
          actionButtons={[
            {
              title: "View Subject",
              buttonStyleType: ButtonStyleType.NORMAL,
              icon: IconProp.List,
              onClick: async (
                item: EmailLog,
                onCompleteAction: VoidFunction,
              ) => {
                setEmailText(JSON.stringify(item["subject"]) as string);
                setEmailModalTitle("Subject of Email Message");
                setShowViewEmailTextModal(true);
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
                setEmailText(item["statusMessage"] as string);
                setEmailModalTitle("Status Message");
                setShowViewEmailTextModal(true);
                onCompleteAction();
              },
            },
          ]}
          cardProps={{
            title: "Email Logs",
            description:
              "Logs of all the emails sent by this project in the last 30 days.",
          }}
          noItemsMessage={
            "Looks like no email is sent by this project in the last 30 days."
          }
        />

        {showViewEmailTextModal && (
          <ConfirmModal
            title={EmailModelTitle}
            description={EmailText}
            onSubmit={() => {
              setShowViewEmailTextModal(false);
            }}
            submitButtonText="Close"
            submitButtonType={ButtonStyleType.NORMAL}
          />
        )}
      </>
    </Fragment>
  );
};

export default EmailLogs;
