import React, { FunctionComponent, ReactElement, useState } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import PushNotificationLog from "Common/Models/DatabaseModels/PushNotificationLog";
import FieldType from "Common/UI/Components/Types/FieldType";
import Columns from "Common/UI/Components/ModelTable/Columns";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import PushStatus from "Common/Types/PushNotification/PushStatus";
import ProjectUtil from "Common/UI/Utils/Project";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";

export interface PushLogsTableProps {
  id?: string;
  userPreferencesKey?: string;
  name?: string;
  cardProps?: { title: string; description?: string };
  noItemsMessage?: string;
  query?: Record<string, any>;
  selectMoreFields?: Record<string, boolean>;
  showViewIdButton?: boolean;
  isViewable?: boolean;
  actionButtons?: Array<ActionButtonSchema<PushNotificationLog>>;
  columns?: Columns<PushNotificationLog>;
  filters?: Array<Filter<PushNotificationLog>>;
  singularName?: string;
  pluralName?: string;
}

const PushLogsTable: FunctionComponent<PushLogsTableProps> = (
  props: PushLogsTableProps,
): ReactElement => {
  const [showModal, setShowModal] = useState<boolean>(false);
  const [modalText, setModalText] = useState<string>("");
  const [modalTitle, setModalTitle] = useState<string>("");
  const defaultColumns: Columns<PushNotificationLog> = [
    { field: { title: true }, title: "Title", type: FieldType.Text },
    {
      field: { deviceType: true },
      title: "Device Type",
      type: FieldType.Text,
      hideOnMobile: true,
    },
    { field: { createdAt: true }, title: "Sent at", type: FieldType.DateTime },
    {
      field: { status: true },
      title: "Status",
      type: FieldType.Text,
      getElement: (item: PushNotificationLog): ReactElement => {
        if (item["status"]) {
          return (
            <Pill
              isMinimal={false}
              color={item["status"] === PushStatus.Success ? Green : Red}
              text={item["status"] as string}
            />
          );
        }
        return <></>;
      },
    },
  ];

  const defaultFilters: Array<Filter<PushNotificationLog>> = [
    { field: { createdAt: true }, title: "Sent at", type: FieldType.Date },
    {
      field: { status: true },
      title: "Status",
      type: FieldType.Dropdown,
      filterDropdownOptions:
        DropdownUtil.getDropdownOptionsFromEnum(PushStatus),
    },
  ];

  return (
    <>
      <ModelTable<PushNotificationLog>
        modelType={PushNotificationLog}
        id={
          props.id ||
          (props.singularName
            ? `${props.singularName.replace(/\s+/g, "-").toLowerCase()}-push-logs-table`
            : "push-logs-table")
        }
        name={props.name || "Push Logs"}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        showViewIdButton={props.showViewIdButton ?? true}
        isViewable={props.isViewable}
        userPreferencesKey={
          props.userPreferencesKey ||
          (props.singularName
            ? `${props.singularName.replace(/\s+/g, "-").toLowerCase()}-push-logs-table`
            : "push-logs-table")
        }
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          ...(props.query || {}),
        }}
        selectMoreFields={{
          statusMessage: true,
          body: true,
          ...(props.selectMoreFields || {}),
        }}
        cardProps={{
          title: props.cardProps?.title || "Push Logs",
          description:
            props.cardProps?.description ||
            (props.singularName
              ? `Push notifications sent for this ${props.singularName}.`
              : "Push notifications sent."),
        }}
        noItemsMessage={
          props.noItemsMessage ||
          (props.singularName
            ? `No Push logs for this ${props.singularName}.`
            : "No Push logs.")
        }
        showRefreshButton={true}
        columns={props.columns || defaultColumns}
        filters={props.filters || defaultFilters}
        actionButtons={
          props.actionButtons || [
            {
              title: "View Body",
              buttonStyleType: ButtonStyleType.NORMAL,
              icon: IconProp.List,
              onClick: async (
                item: PushNotificationLog,
                onCompleteAction: VoidFunction,
              ) => {
                setModalText(item["body"] as string);
                setModalTitle("Body");
                setShowModal(true);
                onCompleteAction();
              },
            },
            {
              title: "View Status Message",
              buttonStyleType: ButtonStyleType.NORMAL,
              icon: IconProp.Error,
              onClick: async (
                item: PushNotificationLog,
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

export default PushLogsTable;
