import NotificationMethodView from "../../Components/NotificationMethods/NotificationMethod";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { withEscalatedStatusLabel } from "../../Components/OnCallPolicy/PassOn/PassedOnStatus";
import { withNotAnsweredStatusLabel } from "../../Components/OnCallPolicy/NotAnsweredStatus";
import OnCallLogNotificationStatus from "../../Components/OnCallPolicy/OnCallLogNotificationStatus";
import FieldType from "Common/UI/Components/Types/FieldType";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Navigation from "Common/UI/Utils/Navigation";
import NotificationMethodUtil from "Common/UI/Utils/NotificationMethodUtil";
import User from "Common/UI/Utils/User";
import SelectEntityField from "Common/UI/Types/SelectEntityField";
import UserOnCallLogTimeline from "Common/Models/DatabaseModels/UserOnCallLogTimeline";
import ResultLine from "../../Components/OnCallTestPage/ResultLine";
import {
  getOnCallLogNotificationWords,
  ON_CALL_LOG_DIALOG_LINE_CLASS_NAME,
  ON_CALL_PAGE_CHANNEL_COLUMNS,
} from "../../Components/OnCallPolicy/ExecutionLogs/OnCallLogLineWords";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const translator: Translator = useTranslator();
  const [showViewStatusMessageModal, setShowViewStatusMessageModal] =
    useState<boolean>(false);
  /*
   * The notification whose message the dialog shows: why it was not sent,
   * in the reader's words, read from its line and the method it went by -
   * or drawn as written (OnCallLogLineWords, #8330).
   */
  const [statusNotification, setStatusNotification] =
    useState<UserOnCallLogTimeline | null>(null);

  const getModelTable: GetReactElementFunction = (): ReactElement => {
    return (
      <ModelTable<UserOnCallLogTimeline>
        modelType={UserOnCallLogTimeline}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          userNotificationLogId: modelId.toString(),
          userId: User.getUserId()?.toString(),
        }}
        userPreferencesKey="user-notification-logs-timeline-table"
        id="notification-logs-timeline-table"
        name="User Settings > Notification Logs > Timeline"
        saveFilterProps={{
          tableId: "user-notification-logs-timeline-table",
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        cardProps={{
          title: "Notification Timeline",
          description:
            "Each notification sent to you, how it was sent and what became of it. If one failed, its status message says why.",
        }}
        selectMoreFields={{
          statusMessage: true,
          ...NotificationMethodUtil.getSelectForNotificationMethods<UserOnCallLogTimeline>(),
          /*
           * The method it went by, even when the method is gone since, and
           * whether it was a test page's: its line is worded by both (#8330).
           */
          ...ON_CALL_PAGE_CHANNEL_COLUMNS,
          userNotificationEventType: true,
        }}
        noItemsMessage={"No notifications sent out so far."}
        showRefreshButton={true}
        showViewIdButton={true}
        actionButtons={[
          {
            title: "View Status Message",
            icon: IconProp.Error,
            buttonStyleType: ButtonStyleType.NORMAL,
            onClick: async (
              item: UserOnCallLogTimeline,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setStatusNotification(item);
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
              createdAt: true,
            },
            title: "Notification Sent At",
            type: FieldType.DateTime,
          },

          {
            field: {
              status: true,
            },
            title: "Status",
            type: FieldType.Element,

            /*
             * The notification you escalated from: stored "Passed On",
             * offered as Escalated. A call you did not pick up: stored "Not
             * Answered", offered as Not answered.
             */
            filterDropdownOptions: withNotAnsweredStatusLabel(
              withEscalatedStatusLabel(
                DropdownUtil.getDropdownOptionsFromEnum(UserNotificationStatus),
              ),
            ),
          },
        ]}
        columns={[
          {
            field:
              NotificationMethodUtil.getSelectForNotificationMethods<UserOnCallLogTimeline>() as SelectEntityField<UserOnCallLogTimeline>,
            title: "Notification Method",
            type: FieldType.Element,
            getElement: (item: UserOnCallLogTimeline): ReactElement => {
              return (
                <NotificationMethodView
                  item={item}
                  modelType={UserOnCallLogTimeline}
                />
              );
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Notification Sent At",
            type: FieldType.DateTime,
            hideOnMobile: true,
          },
          {
            field: {
              status: true,
            },
            title: "Status",
            type: FieldType.Element,

            /*
             * As its own log draws it, where the notification says that for
             * certain - an email's Success, an answered call - and otherwise
             * its own status, in the colour of where it stands (#11416).
             */
            getElement: (item: UserOnCallLogTimeline): ReactElement => {
              return <OnCallLogNotificationStatus notification={item} />;
            },
          },
        ]}
      />
    );
  };

  return (
    <Fragment>
      {getModelTable()}

      {showViewStatusMessageModal ? (
        <ConfirmModal
          title={"Status Message"}
          description={
            <ResultLine
              statusMessage={statusNotification?.statusMessage || ""}
              words={
                statusNotification
                  ? getOnCallLogNotificationWords(
                      translator,
                      statusNotification,
                    )
                  : null
              }
              className={ON_CALL_LOG_DIALOG_LINE_CLASS_NAME}
              dataTestId="user-on-call-log-timeline-status-message"
            />
          }
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
