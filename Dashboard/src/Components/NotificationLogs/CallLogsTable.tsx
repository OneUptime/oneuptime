import React, { FunctionComponent, ReactElement, useState } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import CallLog from "Common/Models/DatabaseModels/CallLog";
import FieldType from "Common/UI/Components/Types/FieldType";
import Columns from "Common/UI/Components/ModelTable/Columns";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import CallStatus from "Common/Types/Call/CallStatus";
import ProjectUtil from "Common/UI/Utils/Project";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";

export interface CallLogsTableProps {
  id?: string;
  userPreferencesKey?: string;
  name?: string;
  cardProps?: { title: string; description?: string };
  noItemsMessage?: string;
  query?: Record<string, any>;
  selectMoreFields?: Record<string, boolean>;
  showViewIdButton?: boolean;
  isViewable?: boolean;
  actionButtons?: Array<ActionButtonSchema<CallLog>>;
  columns?: Columns<CallLog>;
  filters?: Array<Filter<CallLog>>;
  singularName?: string;
  pluralName?: string;
}

const CallLogsTable: FunctionComponent<CallLogsTableProps> = (
  props: CallLogsTableProps,
): ReactElement => {
  const [showModal, setShowModal] = useState<boolean>(false);
  const [modalText, setModalText] = useState<string>("");
  const [modalTitle, setModalTitle] = useState<string>("");
  const defaultColumns: Columns<CallLog> = [
    { field: { toNumber: true }, title: "To", type: FieldType.Phone },
    {
      field: { fromNumber: true },
      title: "From",
      type: FieldType.Phone,
      hideOnMobile: true,
    },
    {
      field: { user: { name: true } },
      title: "Initiated by",
      type: FieldType.Text,
      hideOnMobile: true,
    },
    { field: { createdAt: true }, title: "Sent at", type: FieldType.DateTime },
    {
      field: { status: true },
      title: "Status",
      type: FieldType.Text,
      getElement: (item: CallLog): ReactElement => {
        if (item["status"]) {
          return (
            <Pill
              isMinimal={false}
              color={item["status"] === CallStatus.Success ? Green : Red}
              text={item["status"] as string}
            />
          );
        }
        return <></>;
      },
    },
  ];

  const defaultFilters: Array<Filter<CallLog>> = [
    { field: { createdAt: true }, title: "Sent at", type: FieldType.Date },
    { field: { status: true }, title: "Status", type: FieldType.Dropdown },
  ];

  return (
    <>
      <ModelTable<CallLog>
        modelType={CallLog}
        id={
          props.id ||
          (props.singularName
            ? `${props.singularName.replace(/\s+/g, "-").toLowerCase()}-call-logs-table`
            : "call-logs-table")
        }
        name={props.name || "Call Logs"}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        showViewIdButton={props.showViewIdButton ?? true}
        isViewable={props.isViewable}
        userPreferencesKey={
          props.userPreferencesKey ||
          (props.singularName
            ? `${props.singularName.replace(/\s+/g, "-").toLowerCase()}-call-logs-table`
            : "call-logs-table")
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
          },
          ...(props.selectMoreFields || {}),
        }}
        cardProps={{
          title: props.cardProps?.title || "Call Logs",
          description:
            props.cardProps?.description ||
            (props.singularName
              ? `Calls made for this ${props.singularName}.`
              : "Calls made."),
        }}
        noItemsMessage={
          props.noItemsMessage ||
          (props.singularName
            ? `No call logs for this ${props.singularName}.`
            : props.pluralName
              ? `No ${props.pluralName.toLowerCase()} call logs.`
              : "No call logs.")
        }
        showRefreshButton={true}
        columns={props.columns || defaultColumns}
        filters={props.filters || defaultFilters}
        actionButtons={
          props.actionButtons || [
            {
              title: "View Call Text",
              buttonStyleType: ButtonStyleType.NORMAL,
              icon: IconProp.List,
              onClick: async (
                item: CallLog,
                onCompleteAction: VoidFunction,
              ) => {
                setModalText(JSON.stringify(item["callData"]) as string);
                setModalTitle("Call Text");
                setShowModal(true);
                onCompleteAction();
              },
            },
            {
              title: "View Status Message",
              buttonStyleType: ButtonStyleType.NORMAL,
              icon: IconProp.Error,
              onClick: async (
                item: CallLog,
                onCompleteAction: VoidFunction,
              ) => {
                setModalText(item["statusMessage"] as string);
                setModalTitle("Status Message");
                setShowModal(true);
                onCompleteAction();
              },
            },
          ]
        }
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
