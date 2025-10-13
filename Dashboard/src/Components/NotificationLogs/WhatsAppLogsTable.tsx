import React, { FunctionComponent, ReactElement, useState } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import WhatsAppLog from "Common/Models/DatabaseModels/WhatsAppLog";
import FieldType from "Common/UI/Components/Types/FieldType";
import Columns from "Common/UI/Components/ModelTable/Columns";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import WhatsAppStatus from "Common/Types/WhatsAppStatus";
import ProjectUtil from "Common/UI/Utils/Project";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Query from "Common/Types/BaseDatabase/Query";
import BaseModel from "Common/Types/Workflow/Components/BaseModel";
import UserElement from "../User/User";
import User from "Common/Models/DatabaseModels/User";
import API from "Common/UI/Utils/API/API";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";
import { JSONObject } from "Common/Types/JSON";

export interface WhatsAppLogsTableProps {
  query?: Query<BaseModel>;
  singularName?: string;
}

const WhatsAppLogsTable: FunctionComponent<WhatsAppLogsTableProps> = (
  props: WhatsAppLogsTableProps,
): ReactElement => {
  const [showModal, setShowModal] = useState<boolean>(false);
  const [modalText, setModalText] = useState<string>("");
  const [modalTitle, setModalTitle] = useState<string>("");

  const defaultColumns: Columns<WhatsAppLog> = [
    {
      field: { toNumber: true },
      title: "To",
      type: FieldType.Phone,
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
      getElement: (item: WhatsAppLog): ReactElement => {
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
      getElement: (item: WhatsAppLog): ReactElement => {
        if (item["status"]) {
          return (
            <Pill
              isMinimal={false}
              color={item["status"] === WhatsAppStatus.Success ? Green : Red}
              text={item["status"] as string}
            />
          );
        }

        return <></>;
      },
    },
  ];

  const defaultFilters: Array<Filter<WhatsAppLog>> = [
    { field: { createdAt: true }, title: "Sent at", type: FieldType.Date },
    { field: { status: true }, title: "Status", type: FieldType.Dropdown },
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
          },
        }}
        cardProps={{
          title: "WhatsApp Logs",
          description: props.singularName
            ? `WhatsApp messages sent for this ${props.singularName}.`
            : "WhatsApp messages sent for this project.",
        }}
        noItemsMessage={
          props.singularName
            ? `No WhatsApp logs for this ${props.singularName}.`
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
            onClick: async (
              item: WhatsAppLog,
              onCompleteAction: VoidFunction,
            ) => {
              setModalTitle("Status Message");
              setModalText("Fetching latest status...");
              setShowModal(true);

              const fallbackStatusMessage: string =
                ((item["statusMessage"] as string) || "-")
                  .split(" | ")
                  .join("\n");
              const fallbackMessageId: string | undefined =
                (item["whatsAppMessageId"] as string) || undefined;
              try {
                if (!item._id) {
                  throw new Error("WhatsApp log ID not found.");
                }

                const response = await API.post<JSONObject>({
                  url: URL.fromURL(APP_API_URL).addRoute(
                    `/whatsapp-log/${item._id.toString()}/get-status`,
                  ),
                });

                if (response.isFailure()) {
                  const failureParts: Array<string> = [
                    API.getFriendlyMessage(response),
                  ];

                  if (
                    fallbackStatusMessage &&
                    fallbackStatusMessage !== "-"
                  ) {
                    failureParts.push(
                      `Last known status: ${fallbackStatusMessage}`,
                    );
                  }

                  if (fallbackMessageId) {
                    failureParts.push(`Message ID: ${fallbackMessageId}`);
                  }

                  setModalText(failureParts.join("\n"));
                } else {
                  const responseData: JSONObject = response.data as JSONObject;
                  const statusMessageFromServer: string | undefined =
                    (responseData["statusMessage"] as string) || undefined;

                  const formattedStatusMessage: string | undefined =
                    statusMessageFromServer
                      ?.split(" | ")
                      .join("\n");

                  setModalText(
                    formattedStatusMessage || fallbackStatusMessage,
                  );
                }
              } catch (error) {
                const messageParts: Array<string> = [
                  API.getFriendlyMessage(error),
                ];

                if (fallbackStatusMessage && fallbackStatusMessage !== "-") {
                  messageParts.push(
                    `Last known status: ${fallbackStatusMessage}`,
                  );
                }

                if (fallbackMessageId) {
                  messageParts.push(`Message ID: ${fallbackMessageId}`);
                }

                setModalText(messageParts.join("\n"));
              } finally {
                onCompleteAction();
              }
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

export default WhatsAppLogsTable;
