import React, { FunctionComponent, ReactElement, useState } from "react";
import {
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import CallLog from "Common/Models/DatabaseModels/CallLog";
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
import { JSONObject } from "Common/Types/JSON";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import NotificationLogStatusPill from "./NotificationLogStatusPill";
import {
  getNotificationLogStatusFilterOptions,
  NotificationLogKind,
} from "./NotificationLogStatus";

export interface CallLogsTableProps {
  query?: Query<BaseModel>;
  singularName?: string;
}

const CallLogsTable: FunctionComponent<CallLogsTableProps> = (
  props: CallLogsTableProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [showModal, setShowModal] = useState<boolean>(false);
  const [modalText, setModalText] = useState<string>("");
  const [modalTitle, setModalTitle] = useState<string>("");
  const defaultColumns: Columns<CallLog> = [
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
      getElement: (item: CallLog): ReactElement => {
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
       * What the status means: Calling while it rings, then how it ended -
       * Success when it was answered, yellow when nobody picked up (a missed
       * call, a busy line, voicemail), red when it could not be made
       * (#11138, #6586, #6594).
       */
      getElement: (item: CallLog): ReactElement => {
        return (
          <NotificationLogStatusPill
            kind={NotificationLogKind.Call}
            status={item.status}
            statusMessage={item.statusMessage}
          />
        );
      },
    },
  ];

  const defaultFilters: Array<Filter<CallLog>> = [
    { field: { createdAt: true }, title: "Sent at", type: FieldType.Date },
    {
      field: { status: true },
      title: "Status",
      type: FieldType.Dropdown,
      // Every status a call can have, in the order it moves through them.
      filterDropdownOptions: getNotificationLogStatusFilterOptions(
        NotificationLogKind.Call,
      ),
    },
  ];

  return (
    <>
      <ModelTable<CallLog>
        modelType={CallLog}
        id={
          props.singularName
            ? `${props.singularName.replace(/\s+/g, "-").toLowerCase()}-call-logs-table`
            : "call-logs-table"
        }
        name="Call Logs"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        showViewIdButton={true}
        isViewable={false}
        userPreferencesKey={
          props.singularName
            ? `${props.singularName.replace(/\s+/g, "-").toLowerCase()}-call-logs-table`
            : "call-logs-table"
        }
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          ...(props.query || {}),
        }}
        selectMoreFields={{
          callData: true,
          statusMessage: true,
          user: {
            name: true,
            email: true,
            profilePictureId: true,
          },
        }}
        cardProps={{
          title: "Call Logs",
          description: props.singularName
            ? translator.translateTemplate(
                "Calls made for this {{itemName}}.",
                {
                  itemName: translatableTerm(props.singularName, {
                    inSentence: true,
                  }),
                },
              )
            : "Calls made for this project.",
        }}
        noItemsMessage={
          props.singularName
            ? translator.translateTemplate(
                "No call logs for this {{itemName}}.",
                {
                  itemName: translatableTerm(props.singularName, {
                    inSentence: true,
                  }),
                },
              )
            : "No call logs."
        }
        showRefreshButton={true}
        columns={defaultColumns}
        filters={defaultFilters}
        actionButtons={[
          {
            title: "View Call Text",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.List,
            onClick: async (item: CallLog, onCompleteAction: VoidFunction) => {
              const callData: JSONObject | undefined = item["callData"] as
                | JSONObject
                | undefined;
              const displayText: string =
                callData && typeof callData === "object" && callData["message"]
                  ? (callData["message"] as string)
                  : JSON.stringify(callData);
              setModalText(displayText as string);
              setModalTitle("Call Text");
              setShowModal(true);
              onCompleteAction();
            },
          },
          {
            title: "View Status Message",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Error,
            onClick: async (item: CallLog, onCompleteAction: VoidFunction) => {
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

export default CallLogsTable;
