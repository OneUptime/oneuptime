import DashboardNavigation from "../../Utils/Navigation";
import PageComponentProps from "../PageComponentProps";
import { Green, Red } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import SmsStatus from "Common/Types/SmsStatus";
import { ButtonStyleType } from "CommonUI/src/Components/Button/Button";
import ConfirmModal from "CommonUI/src/Components/Modal/ConfirmModal";
import Filter from "CommonUI/src/Components/ModelFilter/Filter";
import Column from "CommonUI/src/Components/ModelTable/Column";
import Columns from "CommonUI/src/Components/ModelTable/Columns";
import ModelTable from "CommonUI/src/Components/ModelTable/ModelTable";
import Pill from "CommonUI/src/Components/Pill/Pill";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import { BILLING_ENABLED } from "CommonUI/src/Config";
import DropdownUtil from "CommonUI/src/Utils/Dropdown";
import SmsLog from "Common/Models/DatabaseModels/SmsLog";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const SMSLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [showViewSmsTextModal, setShowViewSmsTextModal] =
    useState<boolean>(false);
  const [smsText, setSmsText] = useState<string>("");
  const [smsModelTitle, setSmsModalTitle] = useState<string>("");

  const filters: Array<Filter<SmsLog>> = [
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
      filterDropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(SmsStatus),
    },
  ];

  const modelTableColumns: Columns<SmsLog> = [
    {
      field: {
        _id: true,
      },
      title: "Log ID",
      type: FieldType.Text,
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

  if (BILLING_ENABLED) {
    modelTableColumns.push({
      field: {
        smsCostInUSDCents: true,
      },
      title: "SMS Cost",
      type: FieldType.USDCents,
    } as Column<SmsLog>);
  }

  return (
    <Fragment>
      <>
        <ModelTable<SmsLog>
          modelType={SmsLog}
          id="sms-logs-table"
          isDeleteable={false}
          isEditable={false}
          isCreateable={false}
          name="SMS Logs"
          query={{
            projectId: DashboardNavigation.getProjectId()?.toString(),
          }}
          selectMoreFields={{
            smsText: true,
            statusMessage: true,
          }}
          filters={filters}
          actionButtons={[
            {
              title: "View SMS Text",
              buttonStyleType: ButtonStyleType.NORMAL,
              icon: IconProp.List,
              onClick: async (item: SmsLog, onCompleteAction: VoidFunction) => {
                setSmsText(item["smsText"] as string);

                setSmsModalTitle("SMS Text");
                setShowViewSmsTextModal(true);

                onCompleteAction();
              },
            },
            {
              title: "View Status Message",
              buttonStyleType: ButtonStyleType.NORMAL,
              icon: IconProp.Error,
              onClick: async (item: SmsLog, onCompleteAction: VoidFunction) => {
                setSmsText(item["statusMessage"] as string);

                setSmsModalTitle("Status Message");
                setShowViewSmsTextModal(true);

                onCompleteAction();
              },
            },
          ]}
          isViewable={false}
          cardProps={{
            title: "SMS Logs",
            description:
              "Logs of all the SMS sent by this project in the last 30 days.",
          }}
          noItemsMessage={
            "Looks like no SMS is sent by this project in the last 30 days."
          }
          showRefreshButton={true}
          columns={modelTableColumns}
        />

        {showViewSmsTextModal && (
          <ConfirmModal
            title={smsModelTitle}
            description={smsText}
            onSubmit={() => {
              setShowViewSmsTextModal(false);
            }}
            submitButtonText="Close"
            submitButtonType={ButtonStyleType.NORMAL}
          />
        )}
      </>
    </Fragment>
  );
};

export default SMSLogs;
