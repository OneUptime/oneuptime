import EscalationRuleView from "../../Components/OnCallPolicy/EscalationRule/EscalationRule";
import OnCallDutyPolicyView from "../../Components/OnCallPolicy/OnCallPolicy";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import { Green, Red, Yellow } from "Common/Types/BrandColors";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import { isOnCallDirectPage } from "Common/Types/OnCallDutyPolicy/OnCallDirectPage";
import UserNotificationExecutionStatus from "Common/Types/UserNotification/UserNotificationExecutionStatus";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import DirectPageLabel from "Common/UI/Components/OnCallDirectPage/DirectPageLabel";
import Pill from "Common/UI/Components/Pill/Pill";
import { PASS_ON_PAGE_TEXT } from "../../Components/OnCallPolicy/PassOn/PassOnPage";
import { withEscalatedStatusLabel } from "../../Components/OnCallPolicy/PassOn/PassedOnStatus";
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
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [showViewStatusMessageModal, setShowViewStatusMessageModal] =
    useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("");

  return (
    <Fragment>
      <ModelTable<UserOnCallLog>
        modelType={UserOnCallLog}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          userId: User.getUserId()?.toString(),
        }}
        userPreferencesKey="user-notification-logs-table"
        id="notification-logs-table"
        name="User Settings > On-Call Logs"
        saveFilterProps={{
          tableId: "user-notification-logs-table",
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        cardProps={{
          /*
           * The page's own name, as its menu entry, its trail and the docs
           * call it. "Notification Logs" is the project's log of everything
           * it sent (Project Settings > Notifications), not this list of the
           * times you were paged.
           */
          title: "On-Call Logs",
          description:
            "Each time you were paged in this project, by an on-call policy or directly. Open one to see every notification sent and whether it was delivered.",
        }}
        selectMoreFields={{
          statusMessage: true,
          // Read with every row: a row with none is a direct page.
          onCallDutyPolicyId: true,
        }}
        noItemsMessage={"No notifications sent out so far."}
        viewPageRoute={Navigation.getCurrentRoute()}
        showRefreshButton={true}
        showViewIdButton={true}
        isViewable={true}
        actionButtons={[
          {
            title: "View Status Message",
            icon: IconProp.Error,
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
              projectId: ProjectUtil.getCurrentProjectId()!,
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
              projectId: ProjectUtil.getCurrentProjectId()!,
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
            // A page you escalated is stored "Passed On" and offered as Escalated.
            filterDropdownOptions: withEscalatedStatusLabel(
              DropdownUtil.getDropdownOptionsFromEnum(
                UserNotificationExecutionStatus,
              ),
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

              // Paged with no on-call policy behind the page: a workflow's Page step.
              if (isOnCallDirectPage(item)) {
                return <DirectPageLabel />;
              }

              return <p>{translator.translateText("No on-call policy.")}</p>;
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
              // A direct page has no rules to name.
              if (isOnCallDirectPage(item)) {
                return <p>-</p>;
              }

              return <p>{translator.translateText("No escalation rule.")}</p>;
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created At",
            type: FieldType.DateTime,
            hideOnMobile: true,
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
              } else if (
                // You could not take it, and escalated it (stored "Passed On").
                item["status"] === UserNotificationExecutionStatus.PassedOn
              ) {
                return (
                  <Pill
                    color={Yellow}
                    text={PASS_ON_PAGE_TEXT.passedOnStatus}
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
