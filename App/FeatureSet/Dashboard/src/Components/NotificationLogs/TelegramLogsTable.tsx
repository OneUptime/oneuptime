import React, { FunctionComponent, ReactElement, useState } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import TelegramLog from "Common/Models/DatabaseModels/TelegramLog";
import FieldType from "Common/UI/Components/Types/FieldType";
import Columns from "Common/UI/Components/ModelTable/Columns";
import Pill from "Common/UI/Components/Pill/Pill";
import {
  Blue,
  Green,
  Grey,
  Orange,
  Red,
  Yellow,
} from "Common/Types/BrandColors";
import TelegramStatus from "Common/Types/TelegramStatus";
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

export interface TelegramLogsTableProps {
  query?: Query<BaseModel>;
  singularName?: string;
}

const TelegramLogsTable: FunctionComponent<TelegramLogsTableProps> = (
  props: TelegramLogsTableProps,
): ReactElement => {
  const [showModal, setShowModal] = useState<boolean>(false);
  const [modalText, setModalText] = useState<string>("");
  const [modalTitle, setModalTitle] = useState<string>("");

  const getStatusColor: (status?: TelegramStatus) => Color = (
    status?: TelegramStatus,
  ): Color => {
    switch (status) {
      case TelegramStatus.Success:
      case TelegramStatus.Delivered:
      case TelegramStatus.Read:
        return Green;
      case TelegramStatus.Sent:
      case TelegramStatus.Queued:
        return Blue;
      case TelegramStatus.LowBalance:
        return Orange;
      case TelegramStatus.NotVerified:
      case TelegramStatus.Unknown:
        return Grey;
      case TelegramStatus.Failed:
        return Yellow;
      default:
        return Red;
    }
  };

  const parseStatus: (status?: string) => TelegramStatus | undefined = (
    status?: string,
  ): TelegramStatus | undefined => {
    if (!status) {
      return undefined;
    }

    return (Object.values(TelegramStatus) as Array<string>).includes(status)
      ? (status as TelegramStatus)
      : undefined;
  };

  const defaultColumns: Columns<TelegramLog> = [
    {
      field: { toChatId: true },
      title: "To Chat ID",
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
      getElement: (item: TelegramLog): ReactElement => {
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
      getElement: (item: TelegramLog): ReactElement => {
        const statusValue: string | undefined =
          (item["status"] as string | undefined) || undefined;

        if (!statusValue) {
          return <></>;
        }

        const normalizedStatus: TelegramStatus | undefined =
          parseStatus(statusValue);

        const pillColor: Color = getStatusColor(normalizedStatus);

        return <Pill isMinimal={false} color={pillColor} text={statusValue} />;
      },
    },
  ];

  const defaultFilters: Array<Filter<TelegramLog>> = [
    { field: { createdAt: true }, title: "Sent at", type: FieldType.Date },
    { field: { status: true }, title: "Status", type: FieldType.Dropdown },
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
          },
        }}
        cardProps={{
          title: "Telegram Logs",
          description: props.singularName
            ? `Telegram messages sent for this ${props.singularName}.`
            : "Telegram messages sent for this project.",
        }}
        noItemsMessage={
          props.singularName
            ? `No Telegram logs for this ${props.singularName}.`
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
                (item["statusMessage"] as string) || "-"
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
                messageParts.push(`Message ID: ${fallbackMessageId}`);
              }

              setModalTitle("Status Message");
              setModalText(messageParts.join("\n") || "-");
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

export default TelegramLogsTable;
