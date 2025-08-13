import React, { FunctionComponent, ReactElement, useState } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import SmsLog from "Common/Models/DatabaseModels/SmsLog";
import FieldType from "Common/UI/Components/Types/FieldType";
import Columns from "Common/UI/Components/ModelTable/Columns";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import SmsStatus from "Common/Types/SmsStatus";
import ProjectUtil from "Common/UI/Utils/Project";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Query from "Common/Types/BaseDatabase/Query";
import BaseModel from "Common/Types/Workflow/Components/BaseModel";
import UserElement from "../User/User";
import User from "Common/Models/DatabaseModels/User";

export interface SmsLogsTableProps {
  query?: Query<BaseModel>;
  singularName?: string;
}

const SmsLogsTable: FunctionComponent<SmsLogsTableProps> = (
  props: SmsLogsTableProps,
): ReactElement => {
  const [showModal, setShowModal] = useState<boolean>(false);
  const [modalText, setModalText] = useState<string>("");
  const [modalTitle, setModalTitle] = useState<string>("");
  const defaultColumns: Columns<SmsLog> = [
    {
      field: { toNumber: true },
      title: "To",
      type: FieldType.Phone,
      noValueMessage: "-",
    },
    {
      field: { fromNumber: true },
      title: "From",
      type: FieldType.Phone,
      hideOnMobile: true,
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
      getElement: (item: SmsLog): ReactElement => {
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
      getElement: (item: SmsLog): ReactElement => {
        if (item["status"]) {
          return (
            <Pill
              isMinimal={false}
              color={item["status"] === SmsStatus.Success ? Green : Red}
              text={item["status"] as string}
            />
          );
        }
        return <></>;
      },
    },
  ];

  const defaultFilters: Array<Filter<SmsLog>> = [
    { field: { createdAt: true }, title: "Sent at", type: FieldType.Date },
    { field: { status: true }, title: "Status", type: FieldType.Dropdown },
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
          },
        }}
        cardProps={{
          title: "SMS Logs",
          description: props.singularName
            ? `SMS sent for this ${props.singularName}.`
            : "SMS sent for this project.",
        }}
        noItemsMessage={
          props.singularName
            ? `No SMS logs for this ${props.singularName}.`
            : "No SMS logs."
        }
        showRefreshButton={true}
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
