import DashboardNavigation from "../../Utils/Navigation";
import PageComponentProps from "../PageComponentProps";
import { Green, Red } from "Common/Types/BrandColors";
import CallStatus from "Common/Types/Call/CallStatus";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "CommonUI/src/Components/Button/Button";
import ConfirmModal from "CommonUI/src/Components/Modal/ConfirmModal";
import Filter from "CommonUI/src/Components/ModelFilter/Filter";
import Column from "CommonUI/src/Components/ModelTable/Column";
import Columns from "CommonUI/src/Components/ModelTable/Columns";
import ModelTable from "CommonUI/src/Components/ModelTable/ModelTable";
import Pill from "CommonUI/src/Components/Pill/Pill";
import SimpleLogViewer from "CommonUI/src/Components/SimpleLogViewer/SimpleLogViewer";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import { BILLING_ENABLED } from "CommonUI/src/Config";
import DropdownUtil from "CommonUI/src/Utils/Dropdown";
import CallLog from "Common/AppModels/Models/CallLog";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const CallLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [showViewCallTextModal, setShowViewCallTextModal] =
    useState<boolean>(false);
  const [callText, setCallText] = useState<string>("");
  const [callModelTitle, setCallModalTitle] = useState<string>("");

  const filters: Array<Filter<CallLog>> = [
    {
      field: {
        _id: true,
      },
      title: "Log ID",
      type: FieldType.ObjectID,
    },
    {
      field: {
        fromNumber: true,
      },

      title: "From Number",
      type: FieldType.Phone,
    },
    {
      field: {
        toNumber: true,
      },

      title: "To Number",
      type: FieldType.Phone,
    },
    {
      field: {
        createdAt: true,
      },
      title: "Sent at",
      type: FieldType.Date,
    },

    {
      field: {
        status: true,
      },
      title: "Status",
      type: FieldType.Dropdown,
      filterDropdownOptions:
        DropdownUtil.getDropdownOptionsFromEnum(CallStatus),
    },
  ];

  const modelTableColumns: Columns<CallLog> = [
    {
      field: {
        _id: true,
      },
      title: "Log ID",
      type: FieldType.ObjectID,
    },
    {
      field: {
        fromNumber: true,
      },

      title: "From Number",
      type: FieldType.Phone,
    },
    {
      field: {
        toNumber: true,
      },

      title: "To Number",
      type: FieldType.Phone,
    },
    {
      field: {
        createdAt: true,
      },
      title: "Sent at",
      type: FieldType.DateTime,
    },

    {
      field: {
        status: true,
      },
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

  if (BILLING_ENABLED) {
    modelTableColumns.push({
      field: {
        callCostInUSDCents: true,
      },
      title: "Call Cost",
      type: FieldType.USDCents,
    } as Column<CallLog>);
  }

  return (
    <Fragment>
      <>
        <ModelTable<CallLog>
          modelType={CallLog}
          id="call-logs-table"
          isDeleteable={false}
          isEditable={false}
          isCreateable={false}
          name="Call Logs"
          query={{
            projectId: DashboardNavigation.getProjectId()?.toString(),
          }}
          selectMoreFields={{
            callData: true,
            statusMessage: true,
          }}
          actionButtons={[
            {
              title: "View Call Text",
              buttonStyleType: ButtonStyleType.NORMAL,
              icon: IconProp.List,
              onClick: async (
                item: CallLog,
                onCompleteAction: VoidFunction,
              ) => {
                setCallText(JSON.stringify(item["callData"]) as string);

                setCallModalTitle("Call Text");
                setShowViewCallTextModal(true);

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
                setCallText(item["statusMessage"] as string);

                setCallModalTitle("Status Message");
                setShowViewCallTextModal(true);

                onCompleteAction();
              },
            },
          ]}
          isViewable={false}
          cardProps={{
            title: "Call Logs",
            description:
              "Logs of all the Call sent by this project in the last 30 days.",
          }}
          noItemsMessage={
            "Looks like no Call is sent by this project in the last 30 days."
          }
          showRefreshButton={true}
          filters={filters}
          columns={modelTableColumns}
        />

        {showViewCallTextModal && (
          <ConfirmModal
            title={callModelTitle}
            description={<SimpleLogViewer>{callText}</SimpleLogViewer>}
            onSubmit={() => {
              setShowViewCallTextModal(false);
            }}
            submitButtonText="Close"
            submitButtonType={ButtonStyleType.NORMAL}
          />
        )}
      </>
    </Fragment>
  );
};

export default CallLogs;
