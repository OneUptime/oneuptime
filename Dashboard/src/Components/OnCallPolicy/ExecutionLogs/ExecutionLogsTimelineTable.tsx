import DashboardNavigation from "../../../Utils/Navigation";
import UserElement from "../../User/User";
import EscalationRule from "../EscalationRule/EscalationRule";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { Green, Red, Yellow } from "Common/Types/BrandColors";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "Common/Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import { ButtonStyleType } from "Common/UI/src/Components/Button/Button";
import ConfirmModal from "Common/UI/src/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/src/Components/ModelTable/ModelTable";
import Pill from "Common/UI/src/Components/Pill/Pill";
import FieldType from "Common/UI/src/Components/Types/FieldType";
import { GetReactElementFunction } from "Common/UI/src/Types/FunctionTypes";
import DropdownUtil from "Common/UI/src/Utils/Dropdown";
import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLogTimeline from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import User from "Common/Models/DatabaseModels/User";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  onCallPolicyExecutionLogId: ObjectID;
}

const ExecutionLogTimelineTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showViewStatusMessageModal, setShowViewStatusMessageModal] =
    useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("");

  const getModelTable: GetReactElementFunction = (): ReactElement => {
    return (
      <ModelTable<OnCallDutyPolicyExecutionLogTimeline>
        modelType={OnCallDutyPolicyExecutionLogTimeline}
        query={{
          projectId: DashboardNavigation.getProjectId()?.toString(),
          onCallDutyPolicyExecutionLogId:
            props.onCallPolicyExecutionLogId.toString(),
        }}
        id="notification-logs-timeline-table"
        name="On-Call > Execution Logs > Timeline"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        cardProps={{
          title: "Policy Execution Timeline",
          description:
            "You can view the timeline of the execution of the policy here. You can also view the status of the notification sent out to the users.",
        }}
        selectMoreFields={{
          statusMessage: true,
        }}
        noItemsMessage={"No notifications sent out so far."}
        showRefreshButton={true}
        showViewIdButton={true}
        actionButtons={[
          {
            title: "View Status Message",
            buttonStyleType: ButtonStyleType.NORMAL,
            onClick: async (
              item: OnCallDutyPolicyExecutionLogTimeline,
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
        filters={[
          {
            field: {
              onCallDutyPolicyEscalationRule: true,
            },
            type: FieldType.Entity,
            title: "Escalation Rule",
            filterEntityType: OnCallDutyPolicyEscalationRule,
            filterQuery: {
              projectId: DashboardNavigation.getProjectId()?.toString(),
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              createdAt: true,
            },
            type: FieldType.Date,
            title: "Started At",
          },
          {
            field: {
              acknowledgedAt: true,
            },
            type: FieldType.Date,
            title: "Acknowledged At",
          },
          {
            field: {
              status: true,
            },
            type: FieldType.Dropdown,
            title: "Status",
            filterDropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              OnCallDutyExecutionLogTimelineStatus,
            ),
          },
        ]}
        columns={[
          {
            field: {
              onCallDutyPolicyEscalationRule: {
                name: true,
                onCallDutyPolicyId: true,
              },
            },
            title: "Escalation Rule",
            type: FieldType.Element,
            getElement: (
              item: OnCallDutyPolicyExecutionLogTimeline,
            ): ReactElement => {
              if (item && item["onCallDutyPolicyEscalationRule"]) {
                return (
                  <EscalationRule
                    escalationRule={
                      item[
                        "onCallDutyPolicyEscalationRule"
                      ] as OnCallDutyPolicyEscalationRule
                    }
                  />
                );
              }
              return <p>No escalation rule found.</p>;
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Started At",
            type: FieldType.DateTime,
          },
          {
            field: {
              alertSentToUser: {
                name: true,
                email: true,
              },
            },
            title: "Notification Sent To",
            type: FieldType.Element,
            getElement: (
              item: OnCallDutyPolicyExecutionLogTimeline,
            ): ReactElement => {
              if (item["alertSentToUser"]) {
                return (
                  <UserElement
                    user={
                      BaseModel.fromJSON(item["alertSentToUser"], User) as User
                    }
                  />
                );
              }

              return <p>-</p>;
            },
          },
          {
            field: {
              acknowledgedAt: true,
            },
            title: "Acknowledged At",
            type: FieldType.DateTime,

            noValueMessage: "-",
          },
          {
            field: {
              status: true,
            },
            title: "Status",
            type: FieldType.Element,

            getElement: (
              item: OnCallDutyPolicyExecutionLogTimeline,
            ): ReactElement => {
              if (
                item["status"] ===
                OnCallDutyExecutionLogTimelineStatus.NotificationSent
              ) {
                return (
                  <Pill
                    color={Green}
                    text={OnCallDutyExecutionLogTimelineStatus.NotificationSent}
                  />
                );
              } else if (
                item["status"] ===
                OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged
              ) {
                return (
                  <Pill
                    color={Green}
                    text={
                      OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged
                    }
                  />
                );
              } else if (
                item["status"] === OnCallDutyExecutionLogTimelineStatus.Error
              ) {
                return (
                  <Pill
                    color={Red}
                    text={OnCallDutyExecutionLogTimelineStatus.Error}
                  />
                );
              } else if (
                item["status"] === OnCallDutyExecutionLogTimelineStatus.Skipped
              ) {
                return (
                  <Pill
                    color={Yellow}
                    text={OnCallDutyExecutionLogTimelineStatus.Skipped}
                  />
                );
              } else if (
                item["status"] ===
                OnCallDutyExecutionLogTimelineStatus.Executing
              ) {
                return (
                  <Pill
                    color={Yellow}
                    text={OnCallDutyExecutionLogTimelineStatus.Executing}
                  />
                );
              } else if (
                item["status"] === OnCallDutyExecutionLogTimelineStatus.Started
              ) {
                return (
                  <Pill
                    color={Yellow}
                    text={OnCallDutyExecutionLogTimelineStatus.Started}
                  />
                );
              }

              return (
                <Pill
                  color={Red}
                  text={OnCallDutyExecutionLogTimelineStatus.Error}
                />
              );
            },
          },
        ]}
      />
    );
  };

  return (
    <>
      {getModelTable()}

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
    </>
  );
};

export default ExecutionLogTimelineTable;
