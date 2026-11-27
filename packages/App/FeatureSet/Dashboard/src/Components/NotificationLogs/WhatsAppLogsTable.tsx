import React, { FunctionComponent, ReactElement, useState } from "react";
import {
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import WhatsAppLog from "Common/Models/DatabaseModels/WhatsAppLog";
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
} from "./NotificationLogStatus";

export interface WhatsAppLogsTableProps {
  query?: Query<BaseModel>;
  singularName?: string;
}

const WhatsAppLogsTable: FunctionComponent<WhatsAppLogsTableProps> = (
  props: WhatsAppLogsTableProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [showModal, setShowModal] = useState<boolean>(false);
  const [modalText, setModalText] = useState<string>("");
  const [modalTitle, setModalTitle] = useState<string>("");

  const defaultColumns: Columns<WhatsAppLog> = [
    {
      field: { toNumber: true },
      title: "To",
      type: FieldType.Phone,
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
      getElement: (item: WhatsAppLog): ReactElement => {
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
      // What the status means, and what comes next: Sent, Delivered, Read (#11138).
      getElement: (item: WhatsAppLog): ReactElement => {
        return (
          <NotificationLogStatusPill
            kind={NotificationLogKind.WhatsApp}
            status={item.status}
            statusMessage={item.statusMessage}
          />
        );
      },
    },
  ];

  const defaultFilters: Array<Filter<WhatsAppLog>> = [
    { field: { createdAt: true }, title: "Sent at", type: FieldType.Date },
    {
      field: { status: true },
      title: "Status",
      type: FieldType.Dropdown,
      // Every status a WhatsApp message can have, in the order it moves through them.
      filterDropdownOptions: getNotificationLogStatusFilterOptions(
        NotificationLogKind.WhatsApp,
      ),
    },
  ];

  return (
    <>
      <ModelTable<WhatsAppLog>
        modelType={WhatsAppLog}
        id={
          props.singularName
            ? `${props.singularName.replace(/\s+/g, "-").toLowerCase()}-whatsapp-logs-table`
            : "whatsapp-logs-table"
        }
        name="WhatsApp Logs"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        showViewIdButton={true}
        isViewable={false}
        userPreferencesKey={
          props.singularName
            ? `${props.singularName.replace(/\s+/g, "-").toLowerCase()}-whatsapp-logs-table`
            : "whatsapp-logs-table"
        }
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          ...(props.query || {}),
        }}
        selectMoreFields={{
          messageText: true,
          statusMessage: true,
          whatsAppMessageId: true,
          user: {
            name: true,
            email: true,
            profilePictureId: true,
          },
        }}
        cardProps={{
          title: "WhatsApp Logs",
          description: props.singularName
            ? translator.translateTemplate(
                "WhatsApp messages sent for this {{itemName}}.",
                {
                  itemName: translatableTerm(props.singularName, {
                    inSentence: true,
                  }),
                },
              )
            : "WhatsApp messages sent for this project.",
        }}
        noItemsMessage={
          props.singularName
            ? translator.translateTemplate(
                "No WhatsApp logs for this {{itemName}}.",
                {
                  itemName: translatableTerm(props.singularName, {
                    inSentence: true,
                  }),
                },
              )
            : "No WhatsApp logs."
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
              item: WhatsAppLog,
              onCompleteAction: VoidFunction,
            ) => {
              setModalText(item["messageText"] as string);
              setModalTitle("WhatsApp Message");
              setShowModal(true);
              onCompleteAction();
            },
          },
          {
            title: "View Status Message",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Error,
            onClick: (item: WhatsAppLog, onCompleteAction: VoidFunction) => {
              const fallbackStatusMessage: string = (
                (item["statusMessage"] as string) || ""
              )
                .split(" | ")
                .join("\n");
              const fallbackMessageId: string | undefined =
                (item["whatsAppMessageId"] as string) || undefined;
              const messageParts: Array<string> = [];

              if (fallbackStatusMessage && fallbackStatusMessage !== "-") {
                messageParts.push(fallbackStatusMessage);
              }

              if (fallbackMessageId) {
                messageParts.push(
                  translator.translateTemplate("Message ID: {{id}}", {
                    id: fallbackMessageId,
                  }),
                );
              }

              setModalTitle("Status Message");
              setModalText(messageParts.join("\n") || "");
              setShowModal(true);
              onCompleteAction();
            },
          },
        ]}
      />

      {showModal && (
        <ConfirmModal
          title={modalTitle}
          description={modalText || "No data"}
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

export default WhatsAppLogsTable;
