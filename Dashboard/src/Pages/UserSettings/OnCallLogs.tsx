import EscalationRuleView from "../../Components/OnCallPolicy/EscalationRule/EscalationRule";
import OnCallDutyPolicyView from "../../Components/OnCallPolicy/OnCallPolicy";
import DashboardNavigation from "../../Utils/Navigation";
import PageComponentProps from "../PageComponentProps";
import { Green, Red, Yellow } from "Common/Types/BrandColors";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import UserNotificationExecutionStatus from "Common/Types/UserNotification/UserNotificationExecutionStatus";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Navigation from "Common/UI/Utils/Navigation";
import User from "Common/UI/Utils/User";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import UserOnCallLog from "Common/Models/DatabaseModels/UserOnCallLog";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [showViewStatusMessageModal, setShowViewStatusMessageModal] =
    useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("");

  return (
    <Fragment>
      <ModelTable<UserOnCallLog>
        modelType={UserOnCallLog}
        query={{
          projectId: DashboardNavigation.getProjectId()!,
          userId: User.getUserId()?.toString(),
        }}
        id="notification-logs-table"
        name="User Settings > Notification Logs"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        cardProps={{
          title: "Notification Logs",
          description:
            "Here are all the notification logs. This will help you to debug any notification issues that you may face.",
        }}
        selectMoreFields={{
          statusMessage: true,
        }}
        noItemsMessage={"No notifications sent out so far."}
        viewPageRoute={Navigation.getCurrentRoute()}
        showRefreshButton={true}
        showViewIdButton={true}
        isViewable={true}
        actionButtons={[
          {
            title: "View Status Message",
            buttonStyleType: ButtonStyleType.NORMAL,
            onClick: async (
              item: UserOnCallLog,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setStatusMessage(item["statusMessage"] as string);
                setShowViewStatusMessageModal(true);

                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
        ]}
        viewButtonText={"View Timeline"}
        filters={[
          {
            field: {
              onCallDutyPolicy: {
                name: true,
              },
            },
            filterEntityType: OnCallDutyPolicy,
            filterQuery: {
              projectId: DashboardNavigation.getProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
            title: "On-Call Policy",
            type: FieldType.Entity,
          },
          {
            field: {
              onCallDutyPolicyEscalationRule: {
                name: true,
              },
            },
            filterEntityType: OnCallDutyPolicyEscalationRule,
            filterQuery: {
              projectId: DashboardNavigation.getProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
            title: "Escalation Rule",
            type: FieldType.Entity,
          },
          {
            field: {
              status: true,
            },
            title: "Status",
            type: FieldType.Dropdown,
            filterDropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              UserNotificationExecutionStatus,
            ),
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created At",
            type: FieldType.Date,
          },
        ]}
        columns={[
          {
            field: {
              onCallDutyPolicy: {
                name: true,
              },
            },
            title: "On-Call Policy",
            type: FieldType.Element,

            getElement: (item: UserOnCallLog): ReactElement => {
              if (item["onCallDutyPolicy"]) {
                return (
                  <OnCallDutyPolicyView
                    onCallPolicy={item["onCallDutyPolicy"] as OnCallDutyPolicy}
                  />
                );
              }
              return <p>No on-call policy.</p>;
            },
          },
          {
            field: {
              onCallDutyPolicyEscalationRule: {
                name: true,
              },
            },
            title: "Escalation Rule",
            type: FieldType.Element,

            getElement: (item: UserOnCallLog): ReactElement => {
              if (item["onCallDutyPolicyEscalationRule"]) {
                return (
                  <EscalationRuleView
                    escalationRule={
                      item[
                        "onCallDutyPolicyEscalationRule"
                      ] as OnCallDutyPolicyEscalationRule
                    }
                  />
                );
              }
              return <p>No escalation rule.</p>;
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created At",
            type: FieldType.DateTime,
          },
          {
            field: {
              status: true,
            },
            title: "Status",
            type: FieldType.Element,

            getElement: (item: UserOnCallLog): ReactElement => {
              if (
                item["status"] === UserNotificationExecutionStatus.Completed
              ) {
                return (
                  <Pill
                    color={Green}
                    text={UserNotificationExecutionStatus.Completed}
                  />
                );
              } else if (
                item["status"] === UserNotificationExecutionStatus.Started
              ) {
                return (
                  <Pill
                    color={Yellow}
                    text={UserNotificationExecutionStatus.Started}
                  />
                );
              } else if (
                item["status"] === UserNotificationExecutionStatus.Scheduled
              ) {
                return (
                  <Pill
                    color={Yellow}
                    text={UserNotificationExecutionStatus.Scheduled}
                  />
                );
              } else if (
                item["status"] === UserNotificationExecutionStatus.Executing
              ) {
                return (
                  <Pill
                    color={Yellow}
                    text={UserNotificationExecutionStatus.Executing}
                  />
                );
              }

              return (
                <Pill
                  color={Red}
                  text={UserNotificationExecutionStatus.Error}
                />
              );
            },
          },
        ]}
      />

      {showViewStatusMessageModal ? (
        <ConfirmModal
          title={"Status Message"}
          description={statusMessage}
          submitButtonText={"Close"}
          onSubmit={async () => {
            setShowViewStatusMessageModal(false);
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default Settings;
