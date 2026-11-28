import React, { FunctionComponent, ReactElement, useState } from "react";
import {
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import SmsLog from "Common/Models/DatabaseModels/SmsLog";
import FieldType from "Common/UI/Components/Types/FieldType";
import Columns from "Common/UI/Components/ModelTable/Columns";
import ProjectUtil from "Common/UI/Utils/Project";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Query from "Common/Types/BaseDatabase/Query";
import BaseModel from "Common/Types/Workflow/Components/BaseModel";
import UserElement from "../User/User";
import User from "Common/Models/DatabaseModels/User";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import NotificationLogStatusPill from "./NotificationLogStatusPill";
import {
  getNotificationLogStatusFilterOptions,
  NotificationLogKind,
  NOTIFICATION_LOGS_DOCUMENTATION,
} from "./NotificationLogStatus";

export interface SmsLogsTableProps {
  query?: Query<BaseModel>;
  singularName?: string;
}

const SmsLogsTable: FunctionComponent<SmsLogsTableProps> = (
  props: SmsLogsTableProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [showModal, setShowModal] = useState<boolean>(false);
  const [modalText, setModalText] = useState<string>("");
  const [modalTitle, setModalTitle] = useState<string>("");
  const defaultColumns: Columns<SmsLog> = [
    {
      field: { toNumber: true },
      title: "To",
      type: FieldType.Phone,
    },
    {
      field: { fromNumber: true },
      title: "From",
      type: FieldType.Phone,
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
      getElement: (item: SmsLog): ReactElement => {
        if (!item["user"]) {
          return <TableEmptyValue />;
        }

        return <UserElement user={item["user"] as User} />;
      },
    },
    { field: { createdAt: true }, title: "Sent at", type: FieldType.DateTime },
    {
      field: { status: true },
      title: "Status",
      type: FieldType.Text,
      /*
       * What the status means, and what comes next: Sent is the carrier's
       * and still on its way to Delivered, unless the server's own gateway
       * took it, which says nothing after (#11138).
       */
      getElement: (item: SmsLog): ReactElement => {
        return (
          <NotificationLogStatusPill
            kind={NotificationLogKind.SMS}
            status={item.status}
            statusMessage={item.statusMessage}
          />
        );
      },
    },
    {
      field: { errorCode: true },
      title: "Error Code",
      type: FieldType.Text,
      hideOnMobile: true,
    },
  ];

  const defaultFilters: Array<Filter<SmsLog>> = [
    { field: { createdAt: true }, title: "Sent at", type: FieldType.Date },
    {
      field: { status: true },
      title: "Status",
      type: FieldType.Dropdown,
      // Every status an SMS can have, in the order it moves through them.
      filterDropdownOptions: getNotificationLogStatusFilterOptions(
        NotificationLogKind.SMS,
      ),
    },
  ];

  return (
    <>
      <ModelTable<SmsLog>
        modelType={SmsLog}
        id={
          props.singularName
            ? `${props.singularName.replace(/\s+/g, "-").toLowerCase()}-sms-logs-table`
            : "sms-logs-table"
        }
        name="SMS Logs"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        showViewIdButton={true}
        isViewable={false}
        userPreferencesKey={
          props.singularName
            ? `${props.singularName.replace(/\s+/g, "-").toLowerCase()}-sms-logs-table`
            : "sms-logs-table"
        }
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          ...(props.query || {}),
        }}
        selectMoreFields={{
          smsText: true,
          statusMessage: true,
          user: {
            name: true,
            email: true,
            profilePictureId: true,
          },
        }}
        cardProps={{
          title: "SMS Logs",
          description: props.singularName
            ? translator.translateTemplate("SMS sent for this {{itemName}}.", {
                itemName: translatableTerm(props.singularName, {
                  inSentence: true,
                }),
              })
            : "SMS sent for this project.",
        }}
        noItemsMessage={
          props.singularName
            ? translator.translateTemplate(
                "No SMS logs for this {{itemName}}.",
                {
                  itemName: translatableTerm(props.singularName, {
                    inSentence: true,
                  }),
                },
              )
            : "No SMS logs."
        }
        showRefreshButton={true}
        documentationLink={NOTIFICATION_LOGS_DOCUMENTATION}
        columns={defaultColumns}
        filters={defaultFilters}
        actionButtons={[
          {
            title: "View SMS Text",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.List,
            onClick: async (item: SmsLog, onCompleteAction: VoidFunction) => {
              setModalText(item["smsText"] as string);
              setModalTitle("SMS Text");
              setShowModal(true);
              onCompleteAction();
            },
          },
          {
            title: "View Status Message",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Error,
            onClick: async (item: SmsLog, onCompleteAction: VoidFunction) => {
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

export default SmsLogsTable;
