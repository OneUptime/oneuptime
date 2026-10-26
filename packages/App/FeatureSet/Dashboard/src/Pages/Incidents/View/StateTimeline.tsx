import PageComponentProps from "../../PageComponentProps";
import { INCIDENT_FINAL_STATE } from "../../../Components/StateTimeline/StateTimelineFinalState";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import ModelStatusTimeline from "Common/UI/Components/StatusTimeline/ModelStatusTimeline";
import StatusTimelineViewSwitch, {
  StatusTimelineView,
  useStatusTimelineView,
} from "Common/UI/Components/StatusTimeline/StatusTimelineView";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import StateTimelineSubscriberNotification from "../../../Components/StateTimeline/StateTimelineSubscriberNotification";
import Pill from "Common/UI/Components/Pill/Pill";
import SimpleLogViewer from "Common/UI/Components/SimpleLogViewer/SimpleLogViewer";
import {
  getStateTimelineDurationColumn,
  getStateTimelineEndsAtColumn,
} from "Common/UI/Components/StateTimeline/StateTimelineColumns";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import useStateTimelineRowDelete, {
  StateTimelineRowDeleteProps,
} from "../../../Components/StateTimeline/StateTimelineRowDelete";
import { StateTimelineRecord } from "Common/Utils/StateTimeline/StateTimelineRowDelete";
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
import useTranslator from "Common/UI/Utils/UseTranslator";

/*
 * What adding a state asks: the state, when it began (now, unless earlier),
 * and whether status page subscribers hear of it. The timeline and the
 * table ask the same.
 */
export const INCIDENT_STATE_TIMELINE_FORM_FIELDS: Array<
  ModelField<IncidentStateTimeline>
> = [
  {
    field: {
      incidentState: true,
    },
    title: "Incident Status",
    description: "The status the incident changed to.",
    fieldType: FormFieldSchemaType.Dropdown,
    required: true,
    placeholder: "Incident Status",
    dropdownModal: {
      type: IncidentState,
      labelField: "name",
      valueField: "_id",
      sort: {
        order: SortOrder.Ascending,
      },
    },
  },
  {
    field: {
      startsAt: true,
    },
    title: "Starts At",
    /*
     * Its own words, not the column's: the column's are written for the
     * API, and speak of correcting a time that a new row does not have yet.
     */
    description: "When the incident changed to this status.",
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
];

const NO_ROOT_CAUSE_TEXT: string = translationKey("No root cause identified.");
const NO_LOGS_TEXT: string = translationKey("No logs for this state event.");
const LOGS_DESCRIPTION: string = translationKey(
  "What OneUptime recorded when this incident changed to this status, such as the monitor check that caused it.",
);

const IncidentViewStateTimeline: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  /*
   * The incident's only state can't be deleted, and every other row's Delete
   * says what deleting it does (StateTimelineRowDelete).
   */
  const stateRowDelete: StateTimelineRowDeleteProps<IncidentStateTimeline> =
    useStateTimelineRowDelete<IncidentStateTimeline>({
      record: StateTimelineRecord.Incident,
      modelType: IncidentStateTimeline,
      recordIdColumn: "incidentId",
      recordId: modelId,
      stateColumn: "incidentState",
    });
  const [showViewLogsModal, setShowViewLogsModal] = useState<boolean>(false);
  const [logs, setLogs] = useState<string>("");
  const [showRootCause, setShowRootCause] = useState<boolean>(false);
  const [rootCause, setRootCause] = useState<string>("");
  const [refreshToggle, setRefreshToggle] = useState<boolean>(false);
  const translator: Translator = useTranslator();

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

  const onBeforeCreate: (
    item: IncidentStateTimeline,
  ) => Promise<IncidentStateTimeline> = (
    item: IncidentStateTimeline,
  ): Promise<IncidentStateTimeline> => {
    if (!props.currentProject || !props.currentProject._id) {
      throw new BadDataException("Project ID cannot be null");
    }
    item.incidentId = modelId;
    item.projectId = new ObjectID(props.currentProject._id);
    return Promise.resolve(item);
  };

  /*
   * The incident's states as a timeline (ModelStatusTimeline), fitted to
   * its whole life, with the table it used to be one click away.
   */
  const [view, setView] = useStatusTimelineView();

  const viewSwitch: ReactElement = (
    <StatusTimelineViewSwitch
      key="status-timeline-view-switch"
      value={view}
      onChange={setView}
    />
  );

  if (view === StatusTimelineView.Timeline) {
    return (
      <ModelStatusTimeline<IncidentStateTimeline>
        modelType={IncidentStateTimeline}
        id="incident-status-timeline"
        name="Incident > State Timeline"
        title="State Timeline"
        description="Each state this incident has been in, when it began and how long it lasted."
        headerElement={viewSwitch}
        query={{
          incidentId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        stateColumn="incidentState"
        stateSelect={INCIDENT_FINAL_STATE.stateSelect}
        getFinalStateRule={INCIDENT_FINAL_STATE.getFinalStateRule}
        ariaLabel="State timeline of this incident"
        emptyMessage="No state recorded for this incident yet."
        isCreateable={true}
        formFields={INCIDENT_STATE_TIMELINE_FORM_FIELDS}
        onBeforeCreate={onBeforeCreate}
        singularName={stateRowDelete.singularName}
        isDeleteable={true}
        getDeleteDisabledReason={stateRowDelete.getDeleteDisabledReason}
        getDeleteConfirmation={stateRowDelete.getDeleteConfirmation}
        getItemName={stateRowDelete.getItemName}
        deleteConfirmationWarning={stateRowDelete.deleteConfirmationWarning}
        onFetchSuccess={stateRowDelete.onFetchSuccess}
        causeColumn="rootCause"
        noCauseText={NO_ROOT_CAUSE_TEXT}
        logColumn="stateChangeLog"
        logsDescription={LOGS_DESCRIPTION}
        logViewerTitle="Incident State Log"
        noLogsText={NO_LOGS_TEXT}
        showViewIdButton={true}
        refreshToggle={refreshToggle.toString()}
        selectMoreFields={{
          subscriberNotificationStatus: true,
          subscriberNotificationStatusMessage: true,
        }}
        renderEntryDetails={(item: IncidentStateTimeline): ReactElement => {
          return (
            <StateTimelineSubscriberNotification
              status={item.subscriberNotificationStatus}
              message={item.subscriberNotificationStatusMessage}
              onResendNotification={() => {
                void handleResendNotification(item);
              }}
            />
          );
        }}
      />
    );
  }

  return (
    <Fragment>
      <ModelTable<IncidentStateTimeline>
        modelType={IncidentStateTimeline}
        id="table-incident-status-timeline"
        name="Incident > State Timeline"
        userPreferencesKey="incident-status-timeline-table"
        saveFilterProps={{
          tableId: "incident-status-timeline-table",
        }}
        isEditable={false}
        isDeleteable={true}
        getDeleteDisabledReason={stateRowDelete.getDeleteDisabledReason}
        getDeleteConfirmation={stateRowDelete.getDeleteConfirmation}
        getItemName={stateRowDelete.getItemName}
        singularName={stateRowDelete.singularName}
        pluralName={stateRowDelete.pluralName}
        deleteConfirmationWarning={stateRowDelete.deleteConfirmationWarning}
        onFetchSuccess={stateRowDelete.onFetchSuccess}
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
                  : translator.translateText(NO_ROOT_CAUSE_TEXT) ||
                      NO_ROOT_CAUSE_TEXT,
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
                  : translator.translateText(NO_LOGS_TEXT) || NO_LOGS_TEXT,
              );
              setShowViewLogsModal(true);

              onCompleteAction();
            },
          },
        ]}
        onBeforeCreate={onBeforeCreate}
        cardProps={{
          title: "State Timeline",
          description:
            "Each state this incident has been in, when it began and how long it lasted.",
          rightElement: viewSwitch,
        }}
        noItemsMessage={"No state recorded for this incident yet."}
        formFields={INCIDENT_STATE_TIMELINE_FORM_FIELDS}
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
          getStateTimelineEndsAtColumn<IncidentStateTimeline>(),
          getStateTimelineDurationColumn<IncidentStateTimeline>(),
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
          description={LOGS_DESCRIPTION}
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
