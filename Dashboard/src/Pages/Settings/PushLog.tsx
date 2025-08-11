import PageComponentProps from "../PageComponentProps";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import Columns from "Common/UI/Components/ModelTable/Columns";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import PushNotificationLog from "Common/Models/DatabaseModels/PushNotificationLog";
import PushStatus from "Common/Types/PushNotification/PushStatus";
import PushLogsTable from "../../Components/NotificationLogs/PushLogsTable";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";

const PushLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [showModal, setShowModal] = useState<boolean>(false);
  const [text, setText] = useState<string>("");
  const [title, setTitle] = useState<string>("");

  const filters: Array<Filter<PushNotificationLog>> = [
    { field: { _id: true }, title: "Log ID", type: FieldType.ObjectID },
    { field: { title: true }, title: "Title", type: FieldType.Text },
    { field: { createdAt: true }, title: "Sent at", type: FieldType.Date },
    {
      field: { status: true },
      title: "Status",
      type: FieldType.Dropdown,
      filterDropdownOptions:
        DropdownUtil.getDropdownOptionsFromEnum(PushStatus),
    },
  ];

  const columns: Columns<PushNotificationLog> = [
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

  return (
    <Fragment>
      <>
        <PushLogsTable
          id="push-logs-table"
          userPreferencesKey="push-logs-table"
          name="Push Logs"
          selectMoreFields={{ body: true, statusMessage: true }}
          actionButtons={[
            {
              title: "View Body",
              buttonStyleType: ButtonStyleType.NORMAL,
              icon: IconProp.List,
              onClick: async (
                item: PushNotificationLog,
                onCompleteAction: VoidFunction,
              ) => {
                setText(item["body"] as string);
                setTitle("Body");
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
                setText(item["statusMessage"] as string);
                setTitle("Status Message");
                setShowModal(true);
                onCompleteAction();
              },
            },
          ]}
          isViewable={false}
          cardProps={{
            title: "Push Logs",
            description:
              "Logs of all the Push notifications sent by this project in the last 30 days.",
          }}
          noItemsMessage={
            "Looks like no Push notifications were sent by this project in the last 30 days."
          }
          filters={filters}
          columns={columns}
        />

        {showModal && (
          <ConfirmModal
            title={title}
            description={text}
            onSubmit={() => {
              setShowModal(false);
            }}
            submitButtonText="Close"
            submitButtonType={ButtonStyleType.NORMAL}
          />
        )}
      </>
    </Fragment>
  );
};

export default PushLogs;
