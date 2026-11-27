import React, { FunctionComponent, ReactElement, useState } from "react";
import {
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import TelegramLog from "Common/Models/DatabaseModels/TelegramLog";
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

export interface TelegramLogsTableProps {
  query?: Query<BaseModel>;
  singularName?: string;
}

const TelegramLogsTable: FunctionComponent<TelegramLogsTableProps> = (
  props: TelegramLogsTableProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [showModal, setShowModal] = useState<boolean>(false);
  const [modalText, setModalText] = useState<string>("");
  const [modalTitle, setModalTitle] = useState<string>("");

  const defaultColumns: Columns<TelegramLog> = [
    {
      field: { toChatId: true },
      title: "To Chat ID",
      type: FieldType.Text,
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
      getElement: (item: TelegramLog): ReactElement => {
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
       * What the status means: Sent is a message Telegram posted in its
       * chat, and its last status - Telegram reports nothing after (#11138).
       */
      getElement: (item: TelegramLog): ReactElement => {
        return (
          <NotificationLogStatusPill
            kind={NotificationLogKind.Telegram}
            status={item.status}
            statusMessage={item.statusMessage}
          />
        );
      },
    },
  ];

  const defaultFilters: Array<Filter<TelegramLog>> = [
    { field: { createdAt: true }, title: "Sent at", type: FieldType.Date },
    {
      field: { status: true },
      title: "Status",
      type: FieldType.Dropdown,
      // Every status a Telegram message can have.
      filterDropdownOptions: getNotificationLogStatusFilterOptions(
        NotificationLogKind.Telegram,
      ),
    },
  ];

  return (
    <>
      <ModelTable<TelegramLog>
        modelType={TelegramLog}
        id={
          props.singularName
            ? `${props.singularName.replace(/\s+/g, "-").toLowerCase()}-telegram-logs-table`
            : "telegram-logs-table"
        }
        name="Telegram Logs"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        showViewIdButton={true}
        isViewable={false}
        userPreferencesKey={
          props.singularName
            ? `${props.singularName.replace(/\s+/g, "-").toLowerCase()}-telegram-logs-table`
            : "telegram-logs-table"
        }
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          ...(props.query || {}),
        }}
        selectMoreFields={{
          messageText: true,
          statusMessage: true,
          telegramMessageId: true,
          user: {
            name: true,
            email: true,
            profilePictureId: true,
          },
        }}
        cardProps={{
          title: "Telegram Logs",
          description: props.singularName
            ? translator.translateTemplate(
                "Telegram messages sent for this {{itemName}}.",
                {
                  itemName: translatableTerm(props.singularName, {
                    inSentence: true,
                  }),
                },
              )
            : "Telegram messages sent for this project.",
        }}
        noItemsMessage={
          props.singularName
            ? translator.translateTemplate(
                "No Telegram logs for this {{itemName}}.",
                {
                  itemName: translatableTerm(props.singularName, {
                    inSentence: true,
                  }),
                },
              )
            : "No Telegram logs."
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
              item: TelegramLog,
              onCompleteAction: VoidFunction,
            ) => {
              setModalText(item["messageText"] as string);
              setModalTitle("Telegram Message");
              setShowModal(true);
              onCompleteAction();
            },
          },
          {
            title: "View Status Message",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Error,
            onClick: (item: TelegramLog, onCompleteAction: VoidFunction) => {
              const fallbackStatusMessage: string = (
                (item["statusMessage"] as string) || ""
              )
                .split(" | ")
                .join("\n");
              const fallbackMessageId: string | undefined =
                (item["telegramMessageId"] as string) || undefined;
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

export default TelegramLogsTable;
