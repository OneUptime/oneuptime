import PageComponentProps from "../../PageComponentProps";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/MarkdownViewer";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import SimpleLogViewer from "Common/UI/Components/SimpleLogViewer/SimpleLogViewer";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import SubscriberNotificationStatus from "../../../Components/StatusPageSubscribers/SubscriberNotificationStatus";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ProjectUtil from "Common/UI/Utils/Project";

const IncidentViewStateTimeline: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [showViewLogsModal, setShowViewLogsModal] = useState<boolean>(false);
  const [logs, setLogs] = useState<string>("");
  const [showRootCause, setShowRootCause] = useState<boolean>(false);
  const [rootCause, setRootCause] = useState<string>("");
  const [refreshToggle, setRefreshToggle] = useState<boolean>(false);

  const handleResendNotification: (
    item: IncidentStateTimeline,
  ) => Promise<void> = async (item: IncidentStateTimeline): Promise<void> => {
    try {
      await ModelAPI.updateById({
        modelType: IncidentStateTimeline,
        id: item.id!,
        data: {
          subscriberNotificationStatus:
            StatusPageSubscriberNotificationStatus.Pending,
          subscriberNotificationStatusMessage: null,
        },
      });
      setRefreshToggle(!refreshToggle);
    } catch {
      // Error resending notification: handle appropriately
    }
  };

  return (
    <Fragment>
      <ModelTable<IncidentStateTimeline>
        modelType={IncidentStateTimeline}
        id="table-incident-status-timeline"
        name="Monitor > State Timeline"
        userPreferencesKey="incident-status-timeline-table"
        isEditable={false}
        isDeleteable={true}
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        refreshToggle={refreshToggle.toString()}
        query={{
          incidentId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        selectMoreFields={{
          stateChangeLog: true,
          rootCause: true,
          subscriberNotificationStatusMessage: true,
        }}
        sortBy="startsAt"
        sortOrder={SortOrder.Descending}
        actionButtons={[
          {
            title: "View Cause",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.TransparentCube,
            onClick: async (
              item: IncidentStateTimeline,
              onCompleteAction: VoidFunction,
            ) => {
              setRootCause(
                item["rootCause"]
                  ? item["rootCause"].toString()
                  : "No root cause identified.",
              );
              setShowRootCause(true);

              onCompleteAction();
            },
          },
          {
            title: "View Logs",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.List,
            onClick: async (
              item: IncidentStateTimeline,
              onCompleteAction: VoidFunction,
            ) => {
              setLogs(
                item["stateChangeLog"]
                  ? JSON.stringify(item["stateChangeLog"], null, 2)
                  : "No logs for this state event.",
              );
              setShowViewLogsModal(true);

              onCompleteAction();
            },
          },
        ]}
        onBeforeCreate={(
          item: IncidentStateTimeline,
        ): Promise<IncidentStateTimeline> => {
          if (!props.currentProject || !props.currentProject._id) {
            throw new BadDataException("Project ID cannot be null");
          }
          item.incidentId = modelId;
          item.projectId = new ObjectID(props.currentProject._id);
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Status Timeline",
          description: "Here is the status timeline for this incident",
        }}
        noItemsMessage={"No status timeline created for this incident so far."}
        formFields={[
          {
            field: {
              incidentState: true,
            },
            title: "Incident Status",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Incident Status",
            dropdownModal: {
              type: IncidentState,
              labelField: "name",
              valueField: "_id",
            },
          },
          {
            field: {
              startsAt: true,
            },
            title: "Starts At",
            fieldType: FormFieldSchemaType.DateTime,
            required: true,
            placeholder: "Starts At",
            getDefaultValue: () => {
              return OneUptimeDate.getCurrentDate();
            },
          },
          {
            field: {
              shouldStatusPageSubscribersBeNotified: true,
            },

            title: "Notify Status Page Subscribers",
            description: "Should status page subscribers be notified?",
            fieldType: FormFieldSchemaType.Checkbox,
            defaultValue: true,
            required: false,
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              incidentState: {
                name: true,
              },
            },
            title: "Incident State",
            type: FieldType.Entity,
            filterEntityType: IncidentState,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              startsAt: true,
            },
            title: "Starts At",
            type: FieldType.Date,
          },
          {
            field: {
              endsAt: true,
            },
            title: "Ends At",
            type: FieldType.Date,
          },
        ]}
        columns={[
          {
            field: {
              incidentState: {
                name: true,
                color: true,
              },
            },
            title: "Incident Status",
            type: FieldType.Text,

            getElement: (item: IncidentStateTimeline): ReactElement => {
              if (!item["incidentState"]) {
                throw new BadDataException("Incident Status not found");
              }

              return (
                <Pill
                  color={item["incidentState"]["color"] as Color}
                  text={item["incidentState"]["name"] as string}
                />
              );
            },
          },
          {
            field: {
              startsAt: true,
            },
            title: "Starts At",
            type: FieldType.DateTime,
          },
          {
            field: {
              endsAt: true,
            },
            title: "Ends At",
            type: FieldType.DateTime,
            noValueMessage: "Currently Active",
          },
          {
            field: {
              endsAt: true,
            },
            title: "Duration",
            type: FieldType.Text,
            getElement: (item: IncidentStateTimeline): ReactElement => {
              return (
                <p>
                  {OneUptimeDate.differenceBetweenTwoDatesAsFromattedString(
                    item["startsAt"] as Date,
                    (item["endsAt"] as Date) || OneUptimeDate.getCurrentDate(),
                  )}
                </p>
              );
            },
          },
          {
            field: {
              subscriberNotificationStatus: true,
            },
            title: "Subscriber Notification Status",
            type: FieldType.Text,
            getElement: (item: IncidentStateTimeline): ReactElement => {
              return (
                <SubscriberNotificationStatus
                  status={item.subscriberNotificationStatus}
                  subscriberNotificationStatusMessage={
                    item.subscriberNotificationStatusMessage
                  }
                  onResendNotification={() => {
                    return handleResendNotification(item);
                  }}
                />
              );
            },
          },
        ]}
      />
      {showViewLogsModal ? (
        <Modal
          title={"Why did the status change?"}
          description="Here is more information about why the status changed for this monitor."
          isLoading={false}
          modalWidth={ModalWidth.Large}
          onSubmit={() => {
            setShowViewLogsModal(false);
          }}
          submitButtonText={"Close"}
          submitButtonStyleType={ButtonStyleType.NORMAL}
        >
          <SimpleLogViewer title="Incident State Log" height="500px">
            {logs}
          </SimpleLogViewer>
        </Modal>
      ) : (
        <></>
      )}

      {showRootCause ? (
        <ConfirmModal
          title={"Root Cause"}
          description={
            <div>
              <MarkdownViewer text={rootCause} />
            </div>
          }
          isLoading={false}
          onSubmit={() => {
            setShowRootCause(false);
          }}
          submitButtonText={"Close"}
          submitButtonType={ButtonStyleType.NORMAL}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default IncidentViewStateTimeline;
