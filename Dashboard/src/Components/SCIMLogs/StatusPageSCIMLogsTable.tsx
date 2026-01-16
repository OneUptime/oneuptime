import React, { FunctionComponent, ReactElement, useState } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import StatusPageSCIMLog from "Common/Models/DatabaseModels/StatusPageSCIMLog";
import FieldType from "Common/UI/Components/Types/FieldType";
import Columns from "Common/UI/Components/ModelTable/Columns";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red, Yellow } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import SCIMLogStatus from "Common/Types/SCIM/SCIMLogStatus";
import ProjectUtil from "Common/UI/Utils/Project";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import SimpleLogViewer from "Common/UI/Components/SimpleLogViewer/SimpleLogViewer";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Query from "Common/Types/BaseDatabase/Query";
import BaseModel from "Common/Types/Workflow/Components/BaseModel";

export interface StatusPageSCIMLogsTableProps {
  query?: Query<BaseModel>;
}

const StatusPageSCIMLogsTable: FunctionComponent<
  StatusPageSCIMLogsTableProps
> = (props: StatusPageSCIMLogsTableProps): ReactElement => {
  const [showLogModal, setShowLogModal] = useState<boolean>(false);
  const [logModalText, setLogModalText] = useState<string>("");
  const [showStatusModal, setShowStatusModal] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("");

  const getStatusColor = (status: SCIMLogStatus): Color => {
    switch (status) {
      case SCIMLogStatus.Success:
        return Green;
      case SCIMLogStatus.Warning:
        return Yellow;
      case SCIMLogStatus.Error:
        return Red;
      default:
        return Green;
    }
  };

  const defaultColumns: Columns<StatusPageSCIMLog> = [
    {
      field: { operationType: true },
      title: "Operation",
      type: FieldType.Text,
      noValueMessage: "-",
    },
    {
      field: { affectedUserEmail: true },
      title: "User Email",
      type: FieldType.Email,
      hideOnMobile: true,
      noValueMessage: "-",
    },
    {
      field: { createdAt: true },
      title: "Time",
      type: FieldType.DateTime,
    },
    {
      field: { status: true },
      title: "Status",
      type: FieldType.Text,
      getElement: (item: StatusPageSCIMLog): ReactElement => {
        if (item["status"]) {
          return (
            <Pill
              isMinimal={false}
              color={getStatusColor(item["status"] as SCIMLogStatus)}
              text={item["status"] as string}
            />
          );
        }
        return <></>;
      },
    },
  ];

  const defaultFilters: Array<Filter<StatusPageSCIMLog>> = [
    { field: { createdAt: true }, title: "Time", type: FieldType.Date },
    { field: { status: true }, title: "Status", type: FieldType.Dropdown },
    {
      field: { operationType: true },
      title: "Operation Type",
      type: FieldType.Dropdown,
    },
  ];

  return (
    <>
      <ModelTable<StatusPageSCIMLog>
        modelType={StatusPageSCIMLog}
        id="status-page-scim-logs-table"
        name="SCIM Logs"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        userPreferencesKey="status-page-scim-logs-table"
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          ...(props.query || {}),
        }}
        selectMoreFields={{
          logBody: true,
          statusMessage: true,
          requestPath: true,
        }}
        cardProps={{
          title: "SCIM Logs",
          description:
            "Logs of all SCIM provisioning operations for this status page.",
        }}
        noItemsMessage="No SCIM logs yet."
        showRefreshButton={true}
        columns={defaultColumns}
        filters={defaultFilters}
        actionButtons={[
          {
            title: "View Details",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Info,
            onClick: async (
              item: StatusPageSCIMLog,
              onCompleteAction: VoidFunction,
            ) => {
              let logDetails: string = "";
              if (item["logBody"]) {
                try {
                  const parsed: object = JSON.parse(item["logBody"] as string);
                  logDetails = JSON.stringify(parsed, null, 2);
                } catch {
                  logDetails = item["logBody"] as string;
                }
              }
              if (item["statusMessage"]) {
                logDetails =
                  `Status Message: ${item["statusMessage"]}\n\n` + logDetails;
              }
              if (item["requestPath"]) {
                logDetails =
                  `Request Path: ${item["requestPath"]}\n\n` + logDetails;
              }
              setLogModalText(logDetails || "No details available");
              setShowLogModal(true);
              onCompleteAction();
            },
          },
          {
            title: "View Status Message",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Error,
            onClick: async (
              item: StatusPageSCIMLog,
              onCompleteAction: VoidFunction,
            ) => {
              setStatusMessage(
                (item["statusMessage"] as string) || "No status message",
              );
              setShowStatusModal(true);
              onCompleteAction();
            },
          },
        ]}
      />

      {showLogModal && (
        <Modal
          title="SCIM Operation Details"
          description="Log details for this SCIM operation"
          isLoading={false}
          modalWidth={ModalWidth.Large}
          onSubmit={() => {
            setShowLogModal(false);
          }}
          submitButtonText="Close"
          submitButtonStyleType={ButtonStyleType.NORMAL}
        >
          <SimpleLogViewer title="Log Output" height="500px">
            {logModalText}
          </SimpleLogViewer>
        </Modal>
      )}

      {showStatusModal && (
        <ConfirmModal
          title="Status Message"
          description={statusMessage}
          onSubmit={() => {
            setShowStatusModal(false);
          }}
          submitButtonText="Close"
          submitButtonType={ButtonStyleType.NORMAL}
        />
      )}
    </>
  );
};

export default StatusPageSCIMLogsTable;
