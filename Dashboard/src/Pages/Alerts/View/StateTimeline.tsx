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
import AlertState from "Common/Models/DatabaseModels/AlertState";
import ProjectUtil from "Common/UI/Utils/Project";
import AlertStateTimeline from "Common/Models/DatabaseModels/AlertStateTimeline";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";

const AlertViewStateTimeline: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [showViewLogsModal, setShowViewLogsModal] = useState<boolean>(false);
  const [logs, setLogs] = useState<string>("");

  const [showRootCause, setShowRootCause] = useState<boolean>(false);
  const [rootCause, setRootCause] = useState<string>("");

  return (
    <Fragment>
      <ModelTable<AlertStateTimeline>
        modelType={AlertStateTimeline}
        id="table-alert-status-timeline"
        name="Monitor > State Timeline"
        userPreferencesKey="alert-status-timeline-table"
        isEditable={false}
        isDeleteable={true}
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        query={{
          alertId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        selectMoreFields={{
          stateChangeLog: true,
          rootCause: true,
        }}
        actionButtons={[
          {
            title: "View Cause",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.TransparentCube,
            onClick: async (
              item: AlertStateTimeline,
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
              item: AlertStateTimeline,
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
          item: AlertStateTimeline,
        ): Promise<AlertStateTimeline> => {
          if (!props.currentProject || !props.currentProject._id) {
            throw new BadDataException("Project ID cannot be null");
          }
          item.alertId = modelId;
          item.projectId = new ObjectID(props.currentProject._id);
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Status Timeline",
          description: "Here is the status timeline for this alert",
        }}
        noItemsMessage={"No status timeline created for this alert so far."}
        sortBy="startsAt"
        sortOrder={SortOrder.Descending}
        formFields={[
          {
            field: {
              alertState: true,
            },
            title: "Alert Status",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Alert Status",
            dropdownModal: {
              type: AlertState,
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
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              alertState: {
                name: true,
              },
            },
            title: "Alert State",
            type: FieldType.Entity,
            filterEntityType: AlertState,
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
              alertState: {
                name: true,
                color: true,
              },
            },
            title: "Alert Status",
            type: FieldType.Text,

            getElement: (item: AlertStateTimeline): ReactElement => {
              if (!item["alertState"]) {
                throw new BadDataException("Alert Status not found");
              }

              return (
                <Pill
                  color={item["alertState"]["color"] as Color}
                  text={item["alertState"]["name"] as string}
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
            getElement: (item: AlertStateTimeline): ReactElement => {
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
          <SimpleLogViewer title="Alert State Log" height="500px">
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

export default AlertViewStateTimeline;
