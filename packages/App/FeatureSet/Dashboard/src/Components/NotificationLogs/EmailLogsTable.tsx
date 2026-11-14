import React, { FunctionComponent, ReactElement, useState } from "react";
import {
  translatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import EmailLog from "Common/Models/DatabaseModels/EmailLog";
import FieldType from "Common/UI/Components/Types/FieldType";
import Columns from "Common/UI/Components/ModelTable/Columns";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import EmailStatus from "Common/Types/Mail/MailStatus";
import ProjectUtil from "Common/UI/Utils/Project";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Query from "Common/Types/BaseDatabase/Query";
import BaseModel from "Common/Types/Workflow/Components/BaseModel";
import UserElement from "../User/User";
import User from "Common/Models/DatabaseModels/User";
import ServerSendingWords, {
  SERVER_EMAIL_NOT_SET_UP_MESSAGE,
} from "Common/Types/ServerSending/ServerSendingWords";

/*
 * What View Subject says for an email sent without one: a dialog with an
 * empty body read as if the subject had failed to load.
 */
export const EMAIL_WITHOUT_SUBJECT_TEXT: string = translationKey(
  "This email was sent without a subject.",
);

export interface EmailLogsTableProps {
  query?: Query<BaseModel>;
  singularName?: string; // e.g., "incident"
}

const EmailLogsTable: FunctionComponent<EmailLogsTableProps> = (
  props: EmailLogsTableProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [showModal, setShowModal] = useState<boolean>(false);
  const [modalText, setModalText] = useState<string>("");
  const [modalTitle, setModalTitle] = useState<string>("");

  const defaultColumns: Columns<EmailLog> = [
    {
      field: { toEmail: true },
      title: "To",
      type: FieldType.Email,
    },
    {
      field: { fromEmail: true },
      title: "From",
      type: FieldType.Email,
      hideOnMobile: true,
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
      getElement: (item: EmailLog): ReactElement => {
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
          props.singularName
            ? `${props.singularName.replace(/\s+/g, "-").toLowerCase()}-email-logs-table`
            : "email-logs-table"
        }
        name="Email Logs"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        showViewIdButton={true}
        isViewable={false}
        userPreferencesKey={
          props.singularName
            ? `${props.singularName.replace(/\s+/g, "-").toLowerCase()}-email-logs-table`
            : "email-logs-table"
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
            email: true,
            profilePictureId: true,
          },
        }}
        cardProps={{
          title: "Email Logs",
          description: props.singularName
            ? translator.translateTemplate(
                "Emails sent for this {{itemName}}.",
                {
                  itemName: translatableTerm(props.singularName, {
                    inSentence: true,
                  }),
                },
              )
            : "Emails sent for this project.",
        }}
        noItemsMessage={
          props.singularName
            ? translator.translateTemplate(
                "No email logs for this {{itemName}}.",
                {
                  itemName: translatableTerm(props.singularName, {
                    inSentence: true,
                  }),
                },
              )
            : "No email logs."
        }
        showRefreshButton={true}
        columns={defaultColumns}
        filters={defaultFilters}
        actionButtons={[
          {
            title: "View Subject",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.List,
            onClick: async (item: EmailLog, onCompleteAction: VoidFunction) => {
              /*
               * The subject as it was sent, as the SMS log shows its text:
               * not a JSON string, which wrapped it in quotes and escaped it.
               * An email sent without one says so (the dialog translates it).
               */
              setModalText(
                (item["subject"] as string | undefined) ||
                  EMAIL_WITHOUT_SUBJECT_TEXT,
              );
              setModalTitle("Subject of Email Message");
              setShowModal(true);
              onCompleteAction();
            },
          },
          {
            title: "View Status Message",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Error,
            onClick: async (item: EmailLog, onCompleteAction: VoidFunction) => {
              /*
               * A send the server had no email set up for reads as that, in
               * the reader's words - not the SMTP phrase older rows hold.
               */
              const statusMessage: string = item["statusMessage"] as string;

              setModalText(
                ServerSendingWords.isServerEmailNotSetUpMessage(statusMessage)
                  ? translator.translateText(SERVER_EMAIL_NOT_SET_UP_MESSAGE) ||
                      SERVER_EMAIL_NOT_SET_UP_MESSAGE
                  : statusMessage,
              );
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
